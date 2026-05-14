import { getColumnSeries } from "@/lib/blackbox/parse-csv";
import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";

export type IncidentFeatures = {
  motor_asymmetry_p95: number;
  motor_max_spread_last_sec: number;
  gyro_peak_last_500ms: number;
  vbat_min: number | null;
  vbat_max: number | null;
  /** 末段是否存在某一电机通道明显高于其他（desync 启发式） */
  esc_desync_score: number;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * 第一步坠机/异常相关：电机对称性、末段陀螺尖峰、电压范围等确定性特征。
 */
export function computeIncidentFeatures(parsed: ParsedBlackbox): IncidentFeatures {
  const n = parsed.data.length;
  const motors: number[][] = [];
  for (let m = 0; m < 8; m++) {
    const series = getColumnSeries(parsed, [`motor[${m}]`, `motor${m}`]);
    if (series.length === n && series.some((x) => Number.isFinite(x) && x !== 0)) {
      motors.push(series);
    }
  }

  let motor_asymmetry_p95 = 0;
  if (motors.length >= 2) {
    const spreads: number[] = [];
    const L = Math.min(n, 8000);
    const start = Math.max(0, n - L);
    for (let i = start; i < n; i++) {
      const vals = motors.map((ch) => ch[i]!).filter((x) => Number.isFinite(x));
      if (vals.length < 2) continue;
      const mx = Math.max(...vals);
      const mn = Math.min(...vals);
      spreads.push(mx - mn);
    }
    if (spreads.length) {
      const s = [...spreads].sort((a, b) => a - b);
      motor_asymmetry_p95 = percentile(s, 95);
    }
  }

  let motor_max_spread_last_sec = 0;
  const samples1s = Math.min(n, Math.max(50, Math.round(parsed.sampleRateHz)));
  if (motors.length >= 2) {
    const start = Math.max(0, n - samples1s);
    for (let i = start; i < n; i++) {
      const vals = motors.map((ch) => ch[i]!).filter((x) => Number.isFinite(x));
      if (vals.length < 2) continue;
      motor_max_spread_last_sec = Math.max(motor_max_spread_last_sec, Math.max(...vals) - Math.min(...vals));
    }
  }

  const gyro0 = getColumnSeries(parsed, ["gyroadc[0]"]);
  const gyro1 = getColumnSeries(parsed, ["gyroadc[1]"]);
  const gyro2 = getColumnSeries(parsed, ["gyroadc[2]"]);
  let gyro_peak_last_500ms = 0;
  const win = Math.min(n, Math.max(20, Math.round(parsed.sampleRateHz * 0.5)));
  const g0 = gyro0.length === n ? gyro0 : [];
  const g1 = gyro1.length === n ? gyro1 : [];
  const g2 = gyro2.length === n ? gyro2 : [];
  if (g0.length || g1.length || g2.length) {
    for (let i = n - win; i < n; i++) {
      const mag = Math.hypot(g0[i] ?? 0, g1[i] ?? 0, g2[i] ?? 0);
      gyro_peak_last_500ms = Math.max(gyro_peak_last_500ms, mag);
    }
  }

  const vbat = getColumnSeries(parsed, ["vbat", "vbatlatest"]);
  const vb = vbat.filter((x) => Number.isFinite(x));
  const vbat_min = vb.length ? Math.min(...vb) : null;
  const vbat_max = vb.length ? Math.max(...vb) : null;

  let esc_desync_score = 0;
  if (motors.length >= 4) {
    const start = Math.max(0, n - samples1s);
    for (let i = start; i < n; i++) {
      const vals = motors.map((ch) => ch[i]!).filter((x) => Number.isFinite(x));
      if (vals.length < 4) continue;
      const mx = Math.max(...vals);
      const mn = Math.min(...vals);
      if (mx > 1800 && mx - mn > 1200) esc_desync_score += 1;
    }
    esc_desync_score = Math.min(1, esc_desync_score / (samples1s * 0.05));
  }

  return {
    motor_asymmetry_p95,
    motor_max_spread_last_sec,
    gyro_peak_last_500ms,
    vbat_min,
    vbat_max,
    esc_desync_score,
  };
}
