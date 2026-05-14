import { getColumnSeries } from "@/lib/blackbox/parse-csv";
import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FFT = require("fft.js") as new (n: number) => {
  createComplexArray(): number[];
  realTransform(out: number[], data: number[]): void;
  completeSpectrum(spectrum: number[]): void;
};

export type StabilityFeatures = {
  sample_rate_hz: number;
  /** 40–100Hz 频段能量占陀螺频谱总能量的比例（0~1） */
  band_40_100_ratio: number;
  /** >150Hz 高频能量占比，偏大常与桨不平衡/机械松旷相关 */
  hf_150_plus_ratio: number;
  /** 主频峰 Hz（粗略） */
  dominant_peak_hz: number;
  /** setpoint 与 gyro 简单跟踪误差 RMS（若列存在） */
  tracking_error_rms: number | null;
};

function nextPow2Down(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return Math.max(256, p);
}

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1 || 1)));
  }
  return w;
}

/**
 * 第二步：对陀螺模长做 FFT，估计 40–100Hz 与高频能量占比及主峰。
 */
export function computeStabilityFeatures(parsed: ParsedBlackbox): StabilityFeatures {
  const fs = parsed.sampleRateHz;
  const n = parsed.data.length;
  const g0 = getColumnSeries(parsed, ["gyroadc[0]"]);
  const g1 = getColumnSeries(parsed, ["gyroadc[1]"]);
  const g2 = getColumnSeries(parsed, ["gyroadc[2]"]);
  const len = g0.length === n && g1.length === n && g2.length === n ? n : 0;

  let band_40_100_ratio = 0;
  let hf_150_plus_ratio = 0;
  let dominant_peak_hz = 0;

  if (len > 512) {
    const N = nextPow2Down(Math.min(len, 8192));
    const start = len - N;
    const buf = new Float64Array(N);
    const win = hannWindow(N);
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      buf[i] = Math.hypot(g0[idx]!, g1[idx]!, g2[idx]!) * win[i]!;
    }
    const mean = buf.reduce((a, b) => a + b, 0) / N;
    for (let i = 0; i < N; i++) buf[i] -= mean;

    const fft = new FFT(N);
    const spectrum = fft.createComplexArray();
    fft.realTransform(spectrum, Array.from(buf));
    fft.completeSpectrum(spectrum);

    const magn = new Float64Array(N / 2);
    let total = 0;
    let e40_100 = 0;
    let e150p = 0;
    let peakMag = 0;
    let peakBin = 1;
    for (let k = 1; k < N / 2; k++) {
      const re = spectrum[2 * k]!;
      const im = spectrum[2 * k + 1]!;
      const mag = re * re + im * im;
      magn[k] = mag;
      total += mag;
      const f = (k * fs) / N;
      if (f >= 40 && f <= 100) e40_100 += mag;
      if (f >= 150) e150p += mag;
      if (mag > peakMag) {
        peakMag = mag;
        peakBin = k;
      }
    }
    band_40_100_ratio = total > 1e-12 ? e40_100 / total : 0;
    hf_150_plus_ratio = total > 1e-12 ? e150p / total : 0;
    dominant_peak_hz = (peakBin * fs) / N;
  }

  let tracking_error_rms: number | null = null;
  const sp0 = getColumnSeries(parsed, ["setpoint[0]", "setpoint0"]);
  const sp1 = getColumnSeries(parsed, ["setpoint[1]", "setpoint1"]);
  const sp2 = getColumnSeries(parsed, ["setpoint[2]", "setpoint2"]);
  const g0b = getColumnSeries(parsed, ["gyroadc[0]"]);
  const g1b = getColumnSeries(parsed, ["gyroadc[1]"]);
  const g2b = getColumnSeries(parsed, ["gyroadc[2]"]);
  if (
    sp0.length === n &&
    sp1.length === n &&
    sp2.length === n &&
    g0b.length === n &&
    g1b.length === n &&
    g2b.length === n
  ) {
    const L = Math.min(n, 4000);
    const s0 = n - L;
    let sum = 0;
    let cnt = 0;
    for (let i = s0; i < n; i++) {
      const e = Math.hypot(sp0[i]! - g0b[i]!, sp1[i]! - g1b[i]!, sp2[i]! - g2b[i]!);
      sum += e * e;
      cnt++;
    }
    tracking_error_rms = cnt ? Math.sqrt(sum / cnt) : null;
  }

  return {
    sample_rate_hz: fs,
    band_40_100_ratio,
    hf_150_plus_ratio,
    dominant_peak_hz,
    tracking_error_rms,
  };
}
