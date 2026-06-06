import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";
import type { DiagnosisReport, LlmGuidance, LlmBilingualPayload } from "@/lib/analysis/build-diagnosis";
import type { IncidentFeatures } from "@/lib/analysis/incident-features";
import type { LlmChatClient } from "@/lib/llm/create-client";
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

/** ArduPilot 参数太多（动辄 700+），按农植机/通用调参最常关注的前缀挑出来给模型看。 */
const PARAM_PREFIXES_KEEP: ReadonlyArray<string> = [
  "ATC_RAT_RLL_",
  "ATC_RAT_PIT_",
  "ATC_RAT_YAW_",
  "ATC_ANG_",
  "ATC_ACCEL_",
  "ATC_THR_MIX_",
  "ATC_INPUT_TC",
  "INS_HNTCH_",
  "INS_HNTC2_",
  "INS_GYRO_FILTER",
  "INS_ACCEL_FILTER",
  "PSC_VELXY_",
  "PSC_POSXY_",
  "PSC_VELZ_",
  "PSC_POSZ_",
  "PSC_ACCZ_",
  "MOT_THST_HOVER",
  "MOT_THST_EXPO",
  "MOT_BAT_",
  "MOT_PWM_",
  "MOT_SPIN_",
  "EK3_",
  "GPS_",
  "WPNAV_",
  "RC_OPTIONS",
  "FRAME_TYPE",
  "FRAME_CLASS",
  "Q_",
];

const PARAM_MAX_KEEP = 80;

function pickAgriRelevantParams(params: Record<string, number>): [string, number][] {
  const out: [string, number][] = [];
  const seen = new Set<string>();
  for (const prefix of PARAM_PREFIXES_KEEP) {
    for (const [k, v] of Object.entries(params)) {
      if (seen.has(k)) continue;
      if (k === prefix || k.startsWith(prefix)) {
        out.push([k, v]);
        seen.add(k);
        if (out.length >= PARAM_MAX_KEEP) return out;
      }
    }
  }
  return out;
}

function formatParamValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return v.toString();
  if (Math.abs(v) < 0.01) return v.toExponential(3);
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
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

  const extras = parsed.extras;
  const extrasSections: string[] = [];
  if (extras) {
    extrasSections.push("", `## ArduPilot 解析专属字段（${extras.parser_source ?? "pymavlink"}）`);
    if (extras.vehicle_type || extras.fw_string) {
      extrasSections.push(
        `- vehicle_type: ${extras.vehicle_type ?? "-"}`,
        `- fw_string: ${extras.fw_string ?? "-"}`,
      );
    }

    if (extras.attitude_summary) {
      const a = extras.attitude_summary;
      extrasSections.push(
        ``,
        `### ATT 跟踪误差（度，RMS；${a.samples} 采样）`,
        `- err_rp_deg(直接):  ${a.rms_err_rp_deg?.toFixed(3) ?? "-"}`,
        `- err_yaw_deg(直接): ${a.rms_err_yaw_deg?.toFixed(3) ?? "-"}`,
        `- err_roll_deg(由 DesRoll-Roll 算): ${a.rms_err_roll_deg?.toFixed(3) ?? "-"}`,
        `- err_pitch_deg(由 DesPitch-Pitch 算): ${a.rms_err_pitch_deg?.toFixed(3) ?? "-"}`,
      );
    }

    if (extras.vibration_summary) {
      const v = extras.vibration_summary;
      extrasSections.push(
        ``,
        `### VIBE 振动（ArduPilot 自带，单位 m/s²；${v.samples} 采样；阈值约 30 报警 / 60 危险）`,
        `- max_vibe_x: ${v.max_vibe_x?.toFixed(2) ?? "-"}, mean: ${v.mean_vibe_x?.toFixed(2) ?? "-"}`,
        `- max_vibe_y: ${v.max_vibe_y?.toFixed(2) ?? "-"}, mean: ${v.mean_vibe_y?.toFixed(2) ?? "-"}`,
        `- max_vibe_z: ${v.max_vibe_z?.toFixed(2) ?? "-"}, mean: ${v.mean_vibe_z?.toFixed(2) ?? "-"}`,
        `- clip0_max: ${v.clip0_max ?? "-"}, clip1_max: ${v.clip1_max ?? "-"}, clip2_max: ${v.clip2_max ?? "-"}`,
      );
    }

    if (extras.mode_events && extras.mode_events.length) {
      const events = extras.mode_events.slice(0, 30);
      extrasSections.push(``, `### MODE 切换事件（最多 30 条）`);
      for (const ev of events) {
        const sec = (ev.time_us / 1e6).toFixed(1);
        extrasSections.push(`- t=${sec}s mode=${String(ev.mode)} mode_num=${String(ev.mode_num)} reason=${String(ev.reason)}`);
      }
    }

    if (extras.params) {
      const keep = pickAgriRelevantParams(extras.params);
      if (keep.length) {
        extrasSections.push(``, `### PARM：飞控当前参数（节选 ${keep.length} 项，按 ATC_* / INS_* / PSC_* / MOT_* / GPS_* / EK3_* / WPNAV_* / RC* 优先）`);
        const lines: string[] = ["| 参数名 | 值 |", "| --- | ---: |"];
        for (const [k, v] of keep) lines.push(`| ${k} | ${formatParamValue(v)} |`);
        extrasSections.push(...lines);
      }
    }
  }

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
    ...extrasSections,
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

function parseSection(j: Record<string, unknown> | undefined): { summary: string; guidance: LlmGuidance } | null {
  if (!j || typeof j !== "object") return null;
  const summary = typeof j.summary === "string" ? j.summary.trim() : "";
  const overview = typeof j.overview === "string" ? j.overview.trim() : "";
  const sop = normalizeStringArray(j.sop, 10);
  const safety = normalizeStringArray(j.safety, 8);
  if (!summary || !overview || sop.length < 1) return null;
  return { summary, guidance: { overview, sop, safety } };
}

const FALLBACK_SAFETY_ZH = "改参后须小步验证，实飞风险自担。";
const FALLBACK_SAFETY_EN = "Apply parameter changes incrementally and assume all in-flight risk yourself.";

/**
 * 将简报发给大模型，要求其**一次性**同时返回 ZH 与 EN 两个语种的 summary/overview/sop/safety。
 * 用户切换 UI 语种时，报告页直接挑对应语种内容，无需再次调 LLM。
 */
export async function runFlightLogAnalystLlm(
  client: LlmChatClient,
  briefingMarkdown: string,
  /** 仅作日志/调试标记；输出永远是双语 */
  _locale: AppLocale,
): Promise<LlmBilingualPayload | null> {
  void _locale;
  const system = `You are a careful small-UAS flight-log analyst. The user message is a Markdown briefing built from parsed log statistics plus an internal heuristic JSON block.

Hard rules:
1) Use ONLY facts present in the briefing. Never invent crashes, hardware faults, GPS coordinates, or numeric values that are not stated.
2) If evidence is weak or the briefing says "unknown / 证据不足 / insufficient evidence", you MUST say so explicitly in the overview.
3) Output ONLY valid JSON with EXACTLY these top-level keys:
   {
     "zh": {"summary": string, "overview": string, "sop": string[], "safety": string[]},
     "en": {"summary": string, "overview": string, "sop": string[], "safety": string[]}
   }
4) The two language sections MUST describe the SAME conclusions, just translated; do not draw different conclusions in different languages.
5) summary: one concise sentence in that language.
6) overview: 2–4 short paragraphs in plain language for a pilot/mechanic.
7) sop: 4–8 ordered, actionable steps. No markdown inside strings.
8) safety: 2–5 reminders about incremental changes and flight-test risk.`;

  const userPayload = `下面是结构化飞行日志简报（Markdown）。Below is the structured flight-log briefing.\n请仅输出按上述 schema 的 JSON / Output JSON only.\n\n${briefingMarkdown}`;

  const raw = await client.chatJson({
    system,
    user: userPayload,
    maxTokens: 5_500,
    temperature: 0.25,
  });
  if (!raw) return null;

  let root: Record<string, unknown>;
  try {
    root = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const zh = parseSection(root.zh as Record<string, unknown> | undefined);
  const en = parseSection(root.en as Record<string, unknown> | undefined);
  if (!zh && !en) return null;

  const out: LlmBilingualPayload = {};
  if (zh) {
    out.zh = {
      summary: zh.summary,
      guidance: {
        overview: zh.guidance.overview,
        sop: zh.guidance.sop,
        safety: zh.guidance.safety.length ? zh.guidance.safety : [FALLBACK_SAFETY_ZH],
      },
    };
  }
  if (en) {
    out.en = {
      summary: en.summary,
      guidance: {
        overview: en.guidance.overview,
        sop: en.guidance.sop,
        safety: en.guidance.safety.length ? en.guidance.safety : [FALLBACK_SAFETY_EN],
      },
    };
  }
  return out;
}
