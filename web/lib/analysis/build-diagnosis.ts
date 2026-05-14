import type { UserContext } from "@/lib/types/user-context";
import type { ContextValidationItem } from "@/lib/analysis/validate-user-context";
import type { IncidentFeatures } from "@/lib/analysis/incident-features";
import type { StabilityFeatures } from "@/lib/analysis/stability-features";
import type { PidRecommendation } from "@/lib/analysis/pid-recommendation";

export type JitterHypothesis = {
  tag: string;
  user_visible: string;
  confidence: number;
  evidence_metrics: Record<string, number>;
};

/** 大模型根据「日志简报」生成的通俗解读与可执行步骤（可选；无 API Key 时不存在） */
export type LlmGuidance = {
  overview: string;
  sop: string[];
  safety: string[];
};

export type DiagnosisReport = {
  summary: string;
  /** 配置 LLM 且调用成功时附带，用于报告页优先展示 */
  llm_guidance?: LlmGuidance;
  user_context: UserContext;
  context_validation: ContextValidationItem[];
  incident_timeline: { t0: number; t1: number; type: string; note: string }[];
  hypotheses: {
    type: string;
    confidence: number;
    evidence: { metric: string; value: number; note?: string }[];
    user_context_boost?: string;
  }[];
  stability_analysis: {
    jitter_hypotheses: JitterHypothesis[];
    metrics: Record<string, number>;
    plot_refs: string[];
  };
  pid_recommendation: PidRecommendation;
  actions: string[];
  disclaimer: string;
  privacy_note: string;
};

/**
 * 将确定性特征组装为 PRD §1.5 风格的诊断 JSON（MVP：无外部 LLM 时仍可完整出报告）。
 */
export function buildDiagnosisReport(input: {
  userContext: UserContext;
  contextValidation: ContextValidationItem[];
  incident: IncidentFeatures;
  stability: StabilityFeatures;
  pid: PidRecommendation;
  rowCount: number;
}): DiagnosisReport {
  const { userContext, contextValidation, incident, stability, pid, rowCount } = input;

  const hypotheses: DiagnosisReport["hypotheses"] = [];

  if (incident.esc_desync_score > 0.25) {
    hypotheses.push({
      type: "esc_desync",
      confidence: Math.min(0.85, 0.4 + incident.esc_desync_score),
      evidence: [
        { metric: "esc_desync_score", value: incident.esc_desync_score },
        { metric: "motor_max_spread_last_sec", value: incident.motor_max_spread_last_sec },
      ],
    });
  }

  if (incident.motor_asymmetry_p95 > 400) {
    hypotheses.push({
      type: "motor_failure",
      confidence: 0.45,
      evidence: [{ metric: "motor_asymmetry_p95", value: incident.motor_asymmetry_p95 }],
    });
  }

  if (incident.gyro_peak_last_500ms > 1500) {
    hypotheses.push({
      type: "gyro_saturation",
      confidence: 0.5,
      evidence: [{ metric: "gyro_peak_last_500ms", value: incident.gyro_peak_last_500ms }],
    });
  }

  const recentProp = userContext.recent_changes?.some((c) =>
    /桨|prop/i.test(c.description),
  );
  if (recentProp && stability.hf_150_plus_ratio > 0.15) {
    hypotheses.push({
      type: "prop_imbalance_or_loose",
      confidence: 0.55,
      evidence: [{ metric: "hf_150_plus_ratio", value: stability.hf_150_plus_ratio }],
      user_context_boost: "用户近期变更含桨相关描述，提高该机率排序权重。",
    });
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      type: "unknown",
      confidence: 0.2,
      evidence: [{ metric: "rows_analyzed", value: rowCount, note: "启发式未触发强特征" }],
    });
  }

  const jitter: JitterHypothesis[] = [];
  if (stability.hf_150_plus_ratio > 0.2) {
    jitter.push({
      tag: "prop_imbalance_or_loose",
      user_visible: "高频陀螺能量偏高，可能与桨平衡、螺丝松动或减震有关。",
      confidence: 0.55,
      evidence_metrics: { hf_150_plus_ratio: stability.hf_150_plus_ratio },
    });
  }
  if (stability.band_40_100_ratio > 0.12) {
    jitter.push({
      tag: "mechanical_resonance",
      user_visible: "40–100Hz 段能量偏高，需关注机架共振与滤波/陷波设置。",
      confidence: 0.5,
      evidence_metrics: { band_40_100_ratio: stability.band_40_100_ratio, dominant_peak_hz: stability.dominant_peak_hz },
    });
  }
  if (stability.tracking_error_rms !== null && stability.tracking_error_rms > 350) {
    jitter.push({
      tag: "pid_tune_instability",
      user_visible: "setpoint 跟踪误差偏大，可能与 PID 或滤波相位有关（需结合装机排除）。",
      confidence: 0.45,
      evidence_metrics: { tracking_error_rms: stability.tracking_error_rms },
    });
  }

  const summaryParts: string[] = [];
  if (hypotheses[0]?.type !== "unknown") {
    summaryParts.push(`末段日志启发式提示：${hypotheses[0]!.type} 可能性需重点排查。`);
  } else {
    summaryParts.push("未触发强单因假设，建议结合更长日志与装机信息复核。");
  }
  if (jitter.length) summaryParts.push(`抖动分析：${jitter[0]!.user_visible}`);

  return {
    summary: summaryParts.join(" "),
    user_context: userContext,
    context_validation: contextValidation,
    incident_timeline: [
      {
        t0: Math.max(0, rowCount - Math.round(stability.sample_rate_hz)),
        t1: rowCount,
        type: "oscillation",
        note: "MVP 以末段约 1s 窗口作异常聚焦占位。",
      },
    ],
    hypotheses,
    stability_analysis: {
      jitter_hypotheses: jitter,
      metrics: {
        row_count: rowCount,
        sample_rate_hz: stability.sample_rate_hz,
        band_40_100_ratio: stability.band_40_100_ratio,
        hf_150_plus_ratio: stability.hf_150_plus_ratio,
        dominant_peak_hz: stability.dominant_peak_hz,
        tracking_error_rms: stability.tracking_error_rms ?? -1,
      },
      plot_refs: ["spectrum_placeholder"],
    },
    pid_recommendation: pid,
    actions: [
      "地面检查：桨向/桨紧、电机转向、机臂螺丝、飞控减震。",
      "Configurator 导出 diff 与完整日志一并留存，便于下次对比。",
      "阅读 Betaflight 官方 PID Tuning Guide 后再逐项小改。",
    ],
    disclaimer:
      "本报告为实验性 AI/启发式辅助诊断，非适航认证；任何 PID 与参数修改可能导致失控，须自担风险并逐步试飞验证。",
    privacy_note: "若日志含 GPS 等敏感字段，请勿公开分享原始文件；本服务 MVP 未做坐标脱敏。",
  };
}
