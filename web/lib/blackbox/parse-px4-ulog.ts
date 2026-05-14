import { ULog, MessageType } from "@foxglove/ulog";
import { BlobReader } from "@foxglove/ulog/web.js";
import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";
import { normalizeHeaderName } from "@/lib/blackbox/normalize-header";
import { ParseLogError } from "@/lib/blackbox/parse-errors";

const MAX_ROWS = 120_000;
const GYRO_SCALE = 2000;

function asRecord(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/** 从 PX4 常见 topic 中取出三轴角速度（rad/s 量级），再缩放以匹配 BF gyroADC 启发式 */
function gyroTripletFromTopic(name: string, v: Record<string, unknown>): [number, number, number] | null {
  if (name === "sensor_combined") {
    const g = v.gyro_rad;
    if (Array.isArray(g) && g.length >= 3) {
      const a = Number(g[0]);
      const b = Number(g[1]);
      const c = Number(g[2]);
      if ([a, b, c].every(Number.isFinite)) return [a, b, c];
    }
  }
  if (name === "vehicle_angular_velocity") {
    const xyz = v.xyz;
    if (Array.isArray(xyz) && xyz.length >= 3) {
      const a = Number(xyz[0]);
      const b = Number(xyz[1]);
      const c = Number(xyz[2]);
      if ([a, b, c].every(Number.isFinite)) return [a, b, c];
    }
  }
  if (name === "vehicle_attitude") {
    const r = v.rollspeed;
    const p = v.pitchspeed;
    const y = v.yawspeed;
    if (typeof r === "number" && typeof p === "number" && typeof y === "number") return [r, p, y];
  }
  return null;
}

function motorsFromActuator(v: Record<string, unknown>): number[] {
  const o = v.output;
  if (Array.isArray(o)) {
    return o.map((x) => Number(x)).filter((x) => Number.isFinite(x)).slice(0, 8);
  }
  const vals: number[] = [];
  for (let i = 0; i < 16; i++) {
    const k = `output[${i}]`;
    if (typeof v[k] === "number" && Number.isFinite(v[k] as number)) vals.push(v[k] as number);
  }
  return vals.slice(0, 8);
}

function tsToUs(ts: bigint): number {
  const n = Number(ts);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 解析 PX4 ULog（`.ulg`），选取 gyro 与 actuator 类 topic 对齐为 Betaflight 风格列。
 */
export async function parsePx4Ulog(bytes: Uint8Array): Promise<ParsedBlackbox> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy]);
  const ulog = new ULog(new BlobReader(blob));
  try {
    await ulog.open();
  } catch {
    throw new ParseLogError("api.parse_ulog_failed");
  }

  const idToName = new Map<number, string>();
  for (const [id, sub] of ulog.subscriptions) {
    idToName.set(id, sub.name);
  }

  type Sample = { tUs: number; gx: number; gy: number; gz: number };
  const gyroSamples: Sample[] = [];
  const actSamples: { tUs: number; motors: number[] }[] = [];

  for await (const msg of ulog.readMessages()) {
    if (msg.type !== MessageType.Data) continue;
    if (!("value" in msg) || !msg.value) continue;
    const name = idToName.get(msg.msgId);
    if (!name) continue;
    const v = asRecord(msg.value);
    const g = gyroTripletFromTopic(name, v);
    if (g) {
      const tUs = tsToUs(msg.value.timestamp);
      if (Number.isFinite(tUs)) {
        gyroSamples.push({ tUs, gx: g[0] * GYRO_SCALE, gy: g[1] * GYRO_SCALE, gz: g[2] * GYRO_SCALE });
      }
    }
    if (name === "actuator_outputs" || name === "actuator_motors") {
      const motors = motorsFromActuator(v);
      if (motors.length) {
        const tUs = tsToUs(msg.value.timestamp);
        if (Number.isFinite(tUs)) actSamples.push({ tUs, motors });
      }
    }
  }

  gyroSamples.sort((a, b) => a.tUs - b.tUs);
  actSamples.sort((a, b) => a.tUs - b.tUs);
  if (gyroSamples.length < 64) throw new ParseLogError("api.parse_px4_no_gyro");

  function nearestAct(t: number): number[] {
    if (!actSamples.length) return [];
    let lo = 0;
    let hi = actSamples.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (actSamples[mid]!.tUs <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const a = actSamples[i]!;
    const b = actSamples[Math.min(i + 1, actSamples.length - 1)]!;
    const pick = Math.abs(a.tUs - t) <= Math.abs(b.tUs - t) ? a : b;
    return pick.motors;
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
  const stride = Math.max(1, Math.floor(gyroSamples.length / MAX_ROWS));
  for (let i = 0; i < gyroSamples.length && data.length < MAX_ROWS; i += stride) {
    const s = gyroSamples[i]!;
    const motors = nearestAct(s.tUs);
    const row = new Array(headers.length).fill(NaN);
    row[0] = s.tUs;
    row[1] = s.gx;
    row[2] = s.gy;
    row[3] = s.gz;
    for (let m = 0; m < 8; m++) row[4 + m] = motors[m] ?? NaN;
    data.push(row);
  }

  let sampleRateHz = 250;
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
    meta: { source: "px4_ulg" },
    columnNorm,
    colIndex,
    data,
    headers,
    sampleRateHz,
  };
}
