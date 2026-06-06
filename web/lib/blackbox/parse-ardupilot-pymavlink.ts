import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ParsedBlackbox, ParsedBlackboxExtras } from "@/lib/blackbox/parse-csv";
import { normalizeHeaderName } from "@/lib/blackbox/normalize-header";

/** 从 ENV 覆盖 python 命令；Windows 无 alias 时也常配置 `py` */
const PYTHON_BIN = process.env.PYMAVLINK_PYTHON?.trim() || process.env.PYTHON_BIN?.trim() || "python";

/** Python 解析脚本相对仓库根的路径；Next 运行时 cwd = web/ */
const SCRIPT_REL = "scripts/parse_ardupilot_bin.py";

const GYRO_SCALE = 2000;
const MAX_ROWS = 120_000;

type RawTable = { headers: string[]; data: number[][] };

type RawPymavlinkOut = {
  meta?: { source?: string; vehicle_type?: string; fw_string?: string };
  sample_rate_hz?: number;
  imu?: RawTable;
  rcou?: RawTable;
  bat?: RawTable;
  att_summary?: ParsedBlackboxExtras["attitude_summary"];
  vibe_summary?: ParsedBlackboxExtras["vibration_summary"];
  mode_events?: ParsedBlackboxExtras["mode_events"];
  ev_events?: { time_us: number; event_id: number | null }[];
  params?: Record<string, number>;
  error?: string;
};

/** 检查 python + 脚本是否可用；缓存结果，失败一次后本进程内不再重试。 */
let cachedAvailability: boolean | null = null;
export async function isPymavlinkAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  cachedAvailability = await new Promise<boolean>((resolve) => {
    const proc = spawn(PYTHON_BIN, ["-c", "import pymavlink"], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
  return cachedAvailability;
}

function runPython(binPath: string): Promise<string> {
  const scriptPath = path.join(process.cwd(), SCRIPT_REL);
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [scriptPath, binPath], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (b: Buffer) => out.push(b));
    proc.stderr.on("data", (b: Buffer) => err.push(b));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(err).toString("utf8");
        reject(new Error(`pymavlink parser exit ${code}: ${stderr.slice(0, 800) || "no stderr"}`));
        return;
      }
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

/**
 * 调用 Python pymavlink 解析 ArduPilot DataFlash .bin，并抹平为 ParsedBlackbox（与 CSV 同 schema），
 * 顺带把 PARM / ATT / VIBE / MODE 写进 extras 供下游与 LLM 用。
 */
export async function parseArduPilotBinViaPymavlink(bytes: Uint8Array): Promise<ParsedBlackbox> {
  const dir = await mkdtemp(path.join(tmpdir(), "agri-bin-"));
  const tmpFile = path.join(dir, "log.bin");
  await writeFile(tmpFile, bytes);
  let raw: RawPymavlinkOut;
  try {
    const json = await runPython(tmpFile);
    raw = JSON.parse(json) as RawPymavlinkOut;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (raw.error) throw new Error(`pymavlink parser: ${raw.error}`);

  const imu = raw.imu;
  if (!imu || !imu.data || imu.data.length < 64) {
    throw new Error("pymavlink parser: IMU 行数不足，无法做频域分析。");
  }

  const rcRows = raw.rcou?.data ?? [];
  const batRows = raw.bat?.data ?? [];

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

  const rcSorted = [...rcRows].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const batSorted = [...batRows].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));

  function nearestRow(arr: number[][], t: number): number[] | null {
    if (arr.length === 0) return null;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if ((arr[mid]![0] ?? 0) <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = arr[lo]!;
    const b = arr[Math.min(lo + 1, arr.length - 1)]!;
    return Math.abs((a[0] ?? 0) - t) <= Math.abs((b[0] ?? 0) - t) ? a : b;
  }

  const stride = Math.max(1, Math.floor(imu.data.length / MAX_ROWS));
  const data: number[][] = [];
  for (let i = 0; i < imu.data.length && data.length < MAX_ROWS; i += stride) {
    const row = imu.data[i]!;
    const t = row[0] ?? 0;
    const gx = row[1] ?? NaN;
    const gy = row[2] ?? NaN;
    const gz = row[3] ?? NaN;
    const out: number[] = new Array(headers.length).fill(NaN);
    out[0] = t;
    out[1] = gx * GYRO_SCALE;
    out[2] = gy * GYRO_SCALE;
    out[3] = gz * GYRO_SCALE;
    const rc = nearestRow(rcSorted, t);
    if (rc) {
      for (let m = 0; m < 8; m++) out[4 + m] = rc[1 + m] ?? NaN;
    }
    const bat = nearestRow(batSorted, t);
    if (bat) out[12] = bat[1] ?? NaN;
    data.push(out);
  }

  if (data.length < 64) throw new Error("pymavlink parser: 抽样后数据行过少。");

  let sampleRateHz = raw.sample_rate_hz && raw.sample_rate_hz > 0 ? raw.sample_rate_hz : 0;
  if (!sampleRateHz) {
    const diffs: number[] = [];
    for (let i = 1; i < Math.min(data.length, 5000); i++) {
      const dt = (data[i]![0]! - data[i - 1]![0]!) / 1e6;
      if (Number.isFinite(dt) && dt > 1e-5 && dt < 0.5) diffs.push(1 / dt);
    }
    if (diffs.length > 20) {
      diffs.sort((a, b) => a - b);
      sampleRateHz = Math.round(diffs[Math.floor(diffs.length / 2)]!);
    } else {
      sampleRateHz = 1000;
    }
  }
  sampleRateHz = Math.min(32_000, Math.max(50, sampleRateHz));

  const meta: Record<string, string> = {
    source: "ardupilot_bin_pymavlink",
  };
  if (raw.meta?.vehicle_type) meta.vehicle_type = String(raw.meta.vehicle_type);
  if (raw.meta?.fw_string) meta.fw_string = String(raw.meta.fw_string);

  const extras: ParsedBlackboxExtras = {
    parser_source: "pymavlink",
    vehicle_type: raw.meta?.vehicle_type || undefined,
    fw_string: raw.meta?.fw_string || undefined,
    params: raw.params && Object.keys(raw.params).length ? raw.params : undefined,
    attitude_summary: raw.att_summary ?? undefined,
    vibration_summary: raw.vibe_summary ?? undefined,
    mode_events: raw.mode_events?.length ? raw.mode_events : undefined,
  };

  return {
    meta,
    columnNorm,
    colIndex,
    data,
    headers,
    sampleRateHz,
    extras,
  };
}
