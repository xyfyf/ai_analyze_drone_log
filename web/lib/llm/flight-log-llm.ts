import OpenAI from "openai";
import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";
import type { DiagnosisReport, LlmGuidance } from "@/lib/analysis/build-diagnosis";
import type { IncidentFeatures } from "@/lib/analysis/incident-features";
import { getLlmModel } from "@/lib/llm/create-client";
import type { AppLocale } from "@/lib/i18n/translate";

const BRIEFING_MAX_CHARS = 28_000;
const TAIL_ROWS_FOR_STATS = 3_000;

/**
 * 按列名粗略打分，优先把陀螺/电机/加速度等「飞手关心」的通道放进简报，便于模型理解物理含义。
 */
function scoreHeaderForBriefing(name: string): number {
  const h = name.toLowerCase();
  let s = 0;
  if (/gyro|gyr/.test(h)) s += 12;
  if (/motor|moto/.test(h)) s += 12;
  if (/acc|accel/.test(h)) s += 8;
  if (/setpoint|setp|rccommand|rc_/.test(h)) s += 8;
  if (/pid|dterm|pterm|iterm|debug/.test(h)) s += 6;
  if (/time/.test(h)) s += 4;
  if (/vbat|volt|curr|mah/.test(h)) s += 5;
  return s;
}

/**
 * 对指定列在尾部窗口做 min/max/mean，供简报中的「可核对数值」段落（非原始全量曲线）。
 */
function tailColumnStats(parsed: ParsedBlackbox, colIdx: number): { min: number; max: number; mean: number; n: number } | null {
  const nRows = parsed.data.length;
  if (nRows < 1 || colIdx < 0 || colIdx >= parsed.headers.length) return null;
  const start = Math.max(0, nRows - TAIL_ROWS_FOR_STATS);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let cnt = 0;
  for (let i = start; i < nRows; i++) {
    const v = parsed.data[i]![colIdx]!;
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    cnt++;
  }
  if (!cnt) return null;
  return { min, max, mean: sum / cnt, n: cnt };
}

function pickColumnIndicesForStats(parsed: ParsedBlackbox, maxCols: number): number[] {
  const scored = parsed.headers.map((h, i) => ({ i, s: scoreHeaderForBriefing(h) }));
  scored.sort((a, b) => b.s - a.s);
  const out: number[] = [];
  for (const { i, s } of scored) {
    if (s <= 0 && out.length >= 8) break;
    if (!out.includes(i)) out.push(i);
    if (out.length >= maxCols) break;
  }
  if (out.length < 6) {
    for (let j = 0; j < parsed.headers.length && out.length < 10; j++) {
      if (!out.includes(j)) out.push(j);
    }
  }
  return out;
}

function slimMeta(meta: Record<string, string>, maxChars: number): string {
  const entries = Object.entries(meta);
  let lines = entries.map(([k, v]) => `- ${k}: ${v}`);
  let text = ["## 文件内元数据（节选）", ...lines].join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…(meta 已截断)";
  return text;
}

/**
 * 将解析结果 + 规则引擎诊断压缩为 Markdown 简报：供大模型阅读，避免直接塞原始二进制或十万行 CSV。
 */
export function buildFlightLogBriefingMarkdown(
  parsed: ParsedBlackbox,
  fileName: string,
  diagnosis: DiagnosisReport,
  incident: IncidentFeatures,
): string {
  const lower = fileName.toLowerCase();
  const formatGuess = lower.endsWith(".ulg")
    ? "PX4 ULog (.ulg)"
    : lower.endsWith(".bin")
      ? "ArduPilot DataFlash (.bin)"
      : "表格日志（多为 Betaflight Blackbox 导出 CSV）";

  const headerList = parsed.headers.join(", ");
  const headerBlock =
    headerList.length > 6_000 ? `${headerList.slice(0, 6_000)}\n…(表头列表已截断，共 ${parsed.headers.length} 列)` : headerList;

  const idxs = pickColumnIndicesForStats(parsed, 14);
  const statLines: string[] = ["| 列名 | 尾段样本数 | min | max | mean |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const idx of idxs) {
    const name = parsed.headers[idx] ?? `col_${idx}`;
    const st = tailColumnStats(parsed, idx);
    if (!st) continue;
    statLines.push(`| ${name} | ${st.n} | ${st.min.toFixed(4)} | ${st.max.toFixed(4)} | ${st.mean.toFixed(4)} |`);
  }

  const structured = {
    user_context: diagnosis.user_context,
    context_validation: diagnosis.context_validation,
    incident_features: incident,
    hypotheses: diagnosis.hypotheses,
    stability_metrics: diagnosis.stability_analysis.metrics,
    jitter_hypotheses: diagnosis.stability_analysis.jitter_hypotheses.map((j) => ({
      tag: j.tag,
      note: j.user_visible,
      confidence: j.confidence,
    })),
    pid_current: diagnosis.pid_recommendation.current,
    pid_proposed: diagnosis.pid_recommendation.proposed,
    pid_notes: diagnosis.pid_recommendation.why,
    pid_safety_checklist: diagnosis.pid_recommendation.safety_checklist,
    rule_engine_actions: diagnosis.actions,
    deterministic_summary: diagnosis.summary,
  };

  const parts = [
    `# 飞行日志结构化简报`,
    `> 说明：本简报由服务端从原始日志解析与统计得到，供你（大模型）生成通俗解读与可执行 SOP；非完整原始数据。`,
    ``,
    `## 文件与格式`,
    `- 文件名: ${fileName}`,
    `- 格式推断: ${formatGuess}`,
    `- 采样率(Hz): ${parsed.sampleRateHz}`,
    `- 数据行数: ${parsed.data.length}`,
    ``,
    slimMeta(parsed.meta, 2_500),
    ``,
    `## 全部列名`,
    headerBlock,
    ``,
    `## 尾部窗口数值统计（便于理解量级与噪声，非频谱原始数组）`,
    ...statLines,
    ``,
    `## 规则引擎已算出的结构化结论（JSON）`,
    "```json",
    JSON.stringify(structured, null, 2),
    "```",
  ];

  let md = parts.join("\n");
  if (md.length > BRIEFING_MAX_CHARS) {
    md = md.slice(0, BRIEFING_MAX_CHARS) + "\n\n…(简报过长已截断，请仅依据以上可见内容推断)\n";
  }
  return md;
}

function normalizeStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max);
}

/**
 * 将简报发给大模型，要求其返回 summary + 通俗 overview + SOP 列表 + 安全提醒；解析失败返回 null。
 */
export async function runFlightLogAnalystLlm(
  client: OpenAI,
  briefingMarkdown: string,
  locale: AppLocale,
): Promise<{ summary: string; guidance: LlmGuidance } | null> {
  const systemEn = `You are a careful small-UAS flight-log analyst. You receive a Markdown briefing built from parsed log statistics plus an internal heuristic JSON block.

Hard rules:
1) Use ONLY facts present in the briefing. Do not invent crashes, hardware faults, GPS coordinates, or numeric values not stated.
2) If evidence is weak or the briefing says "unknown / insufficient evidence", say that clearly in plain language.
3) Output ONLY valid JSON with exactly these keys:
   {"summary": string, "overview": string, "sop": string[], "safety": string[]}
4) "summary": one concise English sentence.
5) "overview": 2–4 short paragraphs, non-technical where possible, for the pilot/mechanic.
6) "sop": 4–8 ordered, actionable steps (ground checks, config exports, incremental tuning workflow). No markdown inside strings.
7) "safety": 2–5 reminders about incremental changes and flight testing risk.`;

  const systemZh = `你是严谨的小型无人机飞行日志分析助手。用户消息中是一份 Markdown「结构化简报」，由服务端从日志解析、统计以及内部规则引擎 JSON 组成。

硬性要求：
1）只根据简报中已出现的信息下结论，不得编造事故、故障件、GPS 细节或简报未给出的数值。
2）若证据弱或简报标明 unknown / 证据不足，必须在 overview 中明确说明不确定性。
3）只输出合法 JSON，且仅包含以下键：
   {"summary": string, "overview": string, "sop": string[], "safety": string[]}
4）summary：一句中文摘要。
5）overview：2–4 段通俗中文，面向飞手/维护人员，少用内部字段名。
6）sop：4–8 条有序、可执行步骤（地面检查、导出配置、小步试飞与调参顺序等）；字符串内不要用 markdown。
7）safety：2–5 条安全与试飞风险提示（改参须小步、自担风险等）。`;

  const userPayload =
    locale === "en"
      ? `Below is the structured flight-log briefing (Markdown). Read it and return the JSON object.\n\n${briefingMarkdown}`
      : `以下为结构化飞行日志简报（Markdown）。请阅读后只输出 JSON。\n\n${briefingMarkdown}`;

  try {
    const completion = await client.chat.completions.create({
      model: getLlmModel(),
      temperature: 0.25,
      max_tokens: 3_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: locale === "en" ? systemEn : systemZh },
        { role: "user", content: userPayload },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const j = JSON.parse(raw) as {
      summary?: string;
      overview?: string;
      sop?: unknown;
      safety?: unknown;
    };
    const summary = typeof j.summary === "string" ? j.summary.trim() : "";
    const overview = typeof j.overview === "string" ? j.overview.trim() : "";
    const sop = normalizeStringArray(j.sop, 10);
    const safety = normalizeStringArray(j.safety, 8);
    if (!summary || !overview || sop.length < 1) return null;
    return {
      summary,
      guidance: { overview, sop, safety: safety.length ? safety : ["改参后须小步验证，实飞风险自担。"] },
    };
  } catch {
    return null;
  }
}
