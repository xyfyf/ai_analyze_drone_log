import Papa from "papaparse";
import { normalizeHeaderName } from "./normalize-header";

/** 单字段解析失败时写入 NaN，便于下游用 isFinite 过滤 */
function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export type ParsedBlackbox = {
  /** # 开头的元数据键值（尽力解析） */
  meta: Record<string, string>;
  /** 原始列名 -> 规范名映射 */
  columnNorm: Map<string, string>;
  /** 规范列名 -> 下标（仅数值列） */
  colIndex: Map<string, number>;
  /** 行主序数值矩阵，shape = [numRows][numCols]，列顺序为 originalHeaders */
  data: number[][];
  /** 表头原始名称数组 */
  headers: string[];
  /** 推断的采样率 Hz（由 time 列差分中位数得到） */
  sampleRateHz: number;
};

const MAX_ROWS = 120_000;

/**
 * 解析 Betaflight Blackbox 导出的 CSV：跳过注释行，识别表头，推断采样率。
 */
export function parseBlackboxCsv(rawText: string): ParsedBlackbox {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const lines = text.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let headerLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("#")) {
      const body = line.slice(1).trim();
      const m = body.match(/^([^:]+):\s*(.*)$/);
      if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
      continue;
    }
    if (line.includes(",") && !line.startsWith("#")) {
      headerLineIndex = i;
      break;
    }
  }

  if (headerLineIndex < 0) {
    throw new Error("未找到 CSV 表头行，请确认是 Betaflight Blackbox 解码后的 CSV。");
  }

  const body = lines.slice(headerLineIndex).join("\n");
  const parsed = Papa.parse<string[]>(body, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length) {
    const msg = parsed.errors[0]?.message ?? "CSV 解析错误";
    throw new Error(`CSV 解析失败：${msg}`);
  }

  const rowsUnknown = parsed.data as unknown as Record<string, string>[];
  const headers = parsed.meta.fields ?? [];
  if (!headers.length) throw new Error("CSV 无列名。");

  const columnNorm = new Map<string, string>();
  for (const h of headers) {
    columnNorm.set(h, normalizeHeaderName(h));
  }

  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeaderName(h), idx));

  const data: number[][] = [];
  for (let r = 0; r < rowsUnknown.length && data.length < MAX_ROWS; r++) {
    const obj = rowsUnknown[r];
    if (!obj) continue;
    const row = headers.map((h) => toNumber(obj[h]));
    if (row.every((v) => !Number.isFinite(v))) continue;
    data.push(row);
  }

  if (data.length < 64) {
    throw new Error("有效数据行过少，无法做频谱与事件分析。");
  }

  const timeNorms = ["time(us)", "time", "looptime"];
  let timeIdx = -1;
  for (const cand of timeNorms) {
    const idx = colIndex.get(cand);
    if (idx !== undefined) {
      timeIdx = idx;
      break;
    }
  }
  if (timeIdx < 0) {
    const alt = [...colIndex.entries()].find(([k]) => k.includes("time") && k.includes("us"));
    if (alt) timeIdx = alt[1];
  }

  let sampleRateHz = 8000;
  if (timeIdx >= 0) {
    const diffs: number[] = [];
    for (let i = 1; i < Math.min(data.length, 5000); i++) {
      const dt = data[i][timeIdx] - data[i - 1][timeIdx];
      if (Number.isFinite(dt) && dt > 0 && dt < 1e6) diffs.push(dt);
    }
    if (diffs.length > 20) {
      diffs.sort((a, b) => a - b);
      const med = diffs[Math.floor(diffs.length / 2)] || 125;
      sampleRateHz = Math.round(1e6 / med);
      sampleRateHz = Math.min(32000, Math.max(100, sampleRateHz));
    }
  }

  return { meta, columnNorm, colIndex, data, headers, sampleRateHz };
}

/**
 * 按规范列名取一列浮点序列（长度与 data 行数一致）。
 */
export function getColumnSeries(parsed: ParsedBlackbox, normNames: string[]): number[] {
  let idx = -1;
  for (const n of normNames) {
    const i = parsed.colIndex.get(n);
    if (i !== undefined) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    for (const [norm, i] of parsed.colIndex) {
      if (normNames.some((n) => norm === n || norm.includes(n.replace(/[\[\]]/g, "")))) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    for (const [norm, i] of parsed.colIndex) {
      if (normNames.some((n) => norm.startsWith(n.replace(/[\[\]]/g, "").slice(0, 5)))) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return [];
  return parsed.data.map((row) => row[idx]!);
}
