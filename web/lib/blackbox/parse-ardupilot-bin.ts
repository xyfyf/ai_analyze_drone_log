import { parseBuffer } from "dataflashlog";
import { Buffer } from "node:buffer";
import { DataflashParser } from "js-dataflash-parser";
import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";
import { normalizeHeaderName } from "@/lib/blackbox/normalize-header";
import { ParseLogError } from "@/lib/blackbox/parse-errors";

type LogEvent = { name: string; TimeUS: number; [k: string]: unknown };

const MAX_ROWS = 120_000;

/** 新版 ArduPilot 二进制日志每条消息头两字节（与旧 dataflashlog 包格式不同） */
const AP_LOGGER_MAGIC = [0xa3, 0x95] as const;

/** js-dataflash-parser 只拉取分析所需类型，避免 20MB+ 全量消息撑爆内存 */
const JS_PARSER_MSG_TYPES = ["IMU", "IMU2", "IMU3", "IMU4", "GYR", "GYR2", "GYR3", "RCOU", "BAT"];

/** 将 ArduPilot 陀螺读数放大到与 Betaflight gyroADC 同量级，便于复用既有阈值 */
const GYRO_SCALE = 2000;

function num(ev: LogEvent, keys: string[]): number {
  for (const k of keys) {
    const v = ev[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return NaN;
}

function gyroTriplet(ev: LogEvent): [number, number, number] | null {
  const pairs: [string, string, string][] = [
    ["GyrX", "GyrY", "GyrZ"],
    ["GyrAX", "GyrAY", "GyrAZ"],
    ["GX", "GY", "GZ"],
    ["GyrCompX", "GyrCompY", "GyrCompZ"],
  ];
  for (const [ax, ay, az] of pairs) {
    const x = num(ev, [ax]);
    const y = num(ev, [ay]);
    const z = num(ev, [az]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  }
  return null;
}

function motorsFromRc(ev: LogEvent): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 16; i++) {
    const v = num(ev, [`C${i}`, `Chan${i}`, `Ch${i}`]);
    if (!Number.isFinite(v)) break;
    out.push(v);
  }
  return out;
}

/**
 * 将 RCOU 等按 TimeUS 排序，供 IMU 行就近匹配电机输出。
 */
function nearestRcout(rcs: LogEvent[], t: number): LogEvent | null {
  if (!rcs.length) return null;
  let lo = 0;
  let hi = rcs.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (rcs[mid]!.TimeUS <= t) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const a = rcs[i]!;
  const b = rcs[Math.min(i + 1, rcs.length - 1)]!;
  return Math.abs(a.TimeUS - t) <= Math.abs(b.TimeUS - t) ? a : b;
}

/** js-dataflash-parser 返回的扁平消息 → 与旧库一致的 LogEvent */
function mapJsParserMessages(raw: unknown[]): LogEvent[] {
  const out: LogEvent[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = o.name;
    if (typeof name !== "string") continue;
    const tu = o.TimeUS ?? o.TimeUs;
    const TimeUS = typeof tu === "number" && Number.isFinite(tu) ? tu : NaN;
    if (!Number.isFinite(TimeUS)) continue;
    const ev: LogEvent = { name, TimeUS };
    for (const [k, v] of Object.entries(o)) {
      if (k === "name" || k === "fieldnames") continue;
      ev[k] = v;
    }
    out.push(ev);
  }
  return out;
}

function isApLoggerV2(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === AP_LOGGER_MAGIC[0] && bytes[1] === AP_LOGGER_MAGIC[1];
}

/**
 * 加载原始 DataFlash 消息：优先新版（0xA395），否则走旧 dataflashlog。
 */
async function loadApMessages(bytes: Uint8Array): Promise<LogEvent[]> {
  if (isApLoggerV2(bytes)) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const parser = new DataflashParser();
    const r = parser.processData(copy.buffer, JS_PARSER_MSG_TYPES);
    if (r.error && (!r.messages || r.messages.length === 0)) {
      throw new ParseLogError("api.parse_ap_failed");
    }
    return mapJsParserMessages(r.messages ?? []);
  }
  try {
    const eventLog = await parseBuffer(Buffer.from(bytes));
    if (!eventLog.messages?.length) throw new ParseLogError("api.parse_ap_failed");
    return eventLog.messages as LogEvent[];
  } catch {
    throw new ParseLogError("api.parse_ap_failed");
  }
}

/**
 * 解析 ArduPilot DataFlash `.bin`（新版 AP_Logger 与旧版），合成与 Betaflight CSV 对齐的列名。
 */
export async function parseArduPilotBin(bytes: Uint8Array): Promise<ParsedBlackbox> {
  const msgs = await loadApMessages(bytes);
  const imuLike = msgs.filter((m) => /^IMU|^GYR/i.test(m.name) && gyroTriplet(m));
  imuLike.sort((a, b) => a.TimeUS - b.TimeUS);
  if (imuLike.length < 64) throw new ParseLogError("api.parse_ap_no_imu");

  const rcouts = msgs.filter((m) => m.name === "RCOU" || m.name.startsWith("RCO")).sort((a, b) => a.TimeUS - b.TimeUS);
  const bats = msgs.filter((m) => m.name === "BAT").sort((a, b) => a.TimeUS - b.TimeUS);

  function vbatAt(t: number): number {
    if (!bats.length) return NaN;
    let best = bats[0]!;
    let bestDt = Math.abs(best.TimeUS - t);
    for (const b of bats) {
      const dt = Math.abs(b.TimeUS - t);
      if (dt < bestDt) {
        best = b;
        bestDt = dt;
      }
    }
    return num(best, ["Volt", "Voltage"]);
  }

  const headers = [
    "time(us)",
    "gyroADC[0]",
    "gyroADC[1]",
    "gyroADC[2]",
    ...Array.from({ length: 8 }, (_, i) => `motor[${i}]`),
    "vbat",
  ];

  const columnNorm = new Map<string, string>();
  for (const h of headers) columnNorm.set(h, normalizeHeaderName(h));
  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeaderName(h), idx));

  const data: number[][] = [];
  const stride = Math.max(1, Math.floor(imuLike.length / MAX_ROWS));
  for (let i = 0; i < imuLike.length && data.length < MAX_ROWS; i += stride) {
    const ev = imuLike[i]!;
    const g = gyroTriplet(ev);
    if (!g) continue;
    const t = ev.TimeUS;
    const row = new Array(headers.length).fill(NaN);
    row[0] = t;
    row[1] = g[0] * GYRO_SCALE;
    row[2] = g[1] * GYRO_SCALE;
    row[3] = g[2] * GYRO_SCALE;
    const rc = nearestRcout(rcouts, t);
    const motors = rc ? motorsFromRc(rc) : [];
    for (let m = 0; m < 8; m++) row[4 + m] = motors[m] ?? NaN;
    row[12] = vbatAt(t);
    data.push(row);
  }

  if (data.length < 64) throw new ParseLogError("api.parse_ap_no_imu");

  let sampleRateHz = 1000;
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(data.length, 5000); i++) {
    const dt = (data[i]![0]! - data[i - 1]![0]!) / 1e6;
    if (Number.isFinite(dt) && dt > 1e-5 && dt < 0.5) diffs.push(1 / dt);
  }
  if (diffs.length > 20) {
    diffs.sort((a, b) => a - b);
    sampleRateHz = Math.round(diffs[Math.floor(diffs.length / 2)]!);
    sampleRateHz = Math.min(32000, Math.max(50, sampleRateHz));
  }

  return {
    meta: { source: isApLoggerV2(bytes) ? "ardupilot_bin_v2" : "ardupilot_bin_legacy" },
    columnNorm,
    colIndex,
    data,
    headers,
    sampleRateHz,
  };
}
