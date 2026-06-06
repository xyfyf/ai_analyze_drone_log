import { parseFlightLog } from "@/lib/blackbox/parse-flight-log";
import { validateUserContextAgainstLog } from "@/lib/analysis/validate-user-context";
import { computeIncidentFeatures } from "@/lib/analysis/incident-features";
import { computeStabilityFeatures } from "@/lib/analysis/stability-features";
import { buildPidRecommendation } from "@/lib/analysis/pid-recommendation";
import { buildDiagnosisReport } from "@/lib/analysis/build-diagnosis";
import type { UserContext } from "@/lib/types/user-context";
import { createLlmClient } from "@/lib/llm/create-client";
import { buildFlightLogBriefingMarkdown, runFlightLogAnalystLlm } from "@/lib/llm/flight-log-llm";
import type { AppLocale } from "@/lib/i18n/translate";

/**
 * 串起解析 → 校验 → 特征 → PID 草案 → 诊断 JSON；若配置 LLM，则将「Markdown 简报」发给模型
 * 一次性生成 ZH+EN 两版的通俗解读与 SOP，存到诊断 JSON，让用户切语种时直接挑对应语种。
 *
 * @param fileBytes 原始文件字节（.csv / .bin / .ulg）
 * @param fileName 用于按扩展名选择解析器
 * @param locale 仅用于决定老字段 `summary` / `llm_guidance` 默认填哪种语言（兼容旧报告页）
 */
export async function runAnalysisPipeline(
  fileBytes: Uint8Array,
  fileName: string,
  userContext: UserContext,
  locale: AppLocale = "zh",
) {
  const parsed = await parseFlightLog(fileBytes, fileName);
  const contextValidation = validateUserContextAgainstLog(userContext, parsed);
  const incident = computeIncidentFeatures(parsed);
  const stability = computeStabilityFeatures(parsed);
  const pid = buildPidRecommendation(userContext, incident, stability);
  let diagnosis = buildDiagnosisReport({
    userContext,
    contextValidation,
    incident,
    stability,
    pid,
    rowCount: parsed.data.length,
  });

  const client = createLlmClient();
  if (client) {
    const briefing = buildFlightLogBriefingMarkdown(parsed, fileName, diagnosis, incident);
    const llmOut = await runFlightLogAnalystLlm(client, briefing, locale);
    if (llmOut) {
      const preferred = locale === "en" ? llmOut.en ?? llmOut.zh : llmOut.zh ?? llmOut.en;
      diagnosis = {
        ...diagnosis,
        summary: preferred?.summary ?? diagnosis.summary,
        llm_guidance: preferred?.guidance,
        llm_bilingual: llmOut,
      };
    }
  }

  return {
    rowCount: parsed.data.length,
    parsedMeta: parsed.meta,
    sampleRateHz: parsed.sampleRateHz,
    features: { incident, stability, pid, userContext, contextValidation },
    diagnosis,
  };
}
