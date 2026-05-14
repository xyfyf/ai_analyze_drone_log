import type { UserContext } from "@/lib/types/user-context";
import type { StabilityFeatures } from "@/lib/analysis/stability-features";
import type { IncidentFeatures } from "@/lib/analysis/incident-features";

export type PidAxis = { P: number; I: number; D: number };

export type PidRecommendation = {
  current: { roll: PidAxis; pitch: PidAxis; yaw: PidAxis };
  proposed: { roll: PidAxis; pitch: PidAxis; yaw: PidAxis };
  delta_policy: { max_relative_change_percent: number; notes: string };
  why: string[];
  safety_checklist: string[];
};

/** 按平台类型的保守默认 PID（MVP 占位；车/船/翼与多旋翼量纲不同，仅作同结构示意，实飞须按栈文档重调） */
const CLASS_PRESETS: Record<UserContext["aircraft_class"], { roll: PidAxis; pitch: PidAxis; yaw: PidAxis }> = {
  multicopter: {
    roll: { P: 42, I: 75, D: 30 },
    pitch: { P: 42, I: 75, D: 30 },
    yaw: { P: 45, I: 80, D: 0 },
  },
  fixed_wing: {
    roll: { P: 40, I: 30, D: 8 },
    pitch: { P: 40, I: 30, D: 8 },
    yaw: { P: 35, I: 0, D: 0 },
  },
  vtol: {
    roll: { P: 38, I: 45, D: 14 },
    pitch: { P: 38, I: 45, D: 14 },
    yaw: { P: 40, I: 50, D: 0 },
  },
  helicopter: {
    roll: { P: 35, I: 55, D: 12 },
    pitch: { P: 35, I: 55, D: 12 },
    yaw: { P: 38, I: 60, D: 0 },
  },
  rover: {
    roll: { P: 18, I: 40, D: 4 },
    pitch: { P: 0, I: 0, D: 0 },
    yaw: { P: 22, I: 50, D: 2 },
  },
  boat: {
    roll: { P: 15, I: 35, D: 3 },
    pitch: { P: 0, I: 0, D: 0 },
    yaw: { P: 20, I: 45, D: 2 },
  },
};

function scaleAxis(axis: PidAxis, factor: number): PidAxis {
  return {
    P: Math.round(axis.P * factor * 10) / 10,
    I: Math.round(axis.I * factor * 10) / 10,
    D: Math.round(axis.D * factor * 10) / 10,
  };
}

/**
 * 第三步：基于稳定性特征与平台先验，给出「小步」PID 调整草案（非自动调参结论）。
 */
export function buildPidRecommendation(
  ctx: UserContext,
  incident: IncidentFeatures,
  stability: StabilityFeatures,
): PidRecommendation {
  const base = CLASS_PRESETS[ctx.aircraft_class];
  const current = JSON.parse(JSON.stringify(base)) as typeof base;

  const reasons: string[] = [];
  let rollF = 1;
  let pitchF = 1;
  let yawF = 1;

  if (stability.hf_150_plus_ratio > 0.25) {
    rollF *= 0.92;
    pitchF *= 0.92;
    reasons.push("高频陀螺能量占比偏高：略降 Roll/Pitch P/D 以减轻噪声放大（须配合机械检查桨平衡与螺丝）。");
  }
  if (stability.band_40_100_ratio > 0.18) {
    rollF *= 0.95;
    pitchF *= 0.95;
    reasons.push("40–100Hz 带内能量偏高：可能存在结构共振或滤波不足，建议先检查机架/飞控减震再微调 PID。");
  }
  if (stability.tracking_error_rms !== null && stability.tracking_error_rms > 400) {
    rollF *= 1.04;
    pitchF *= 1.04;
    reasons.push("setpoint 与陀螺跟踪误差偏大：微升 Roll/Pitch P（小步），并确认无装机类问题。");
  }
  if (incident.esc_desync_score > 0.35) {
    yawF *= 0.9;
    reasons.push("末段电机输出差异启发式偏高：优先排查电调/电机，Yaw 侧勿盲目加增益。");
  }

  const freezePid =
    incident.motor_max_spread_last_sec > 1500 && incident.gyro_peak_last_500ms > 2000;

  const maxPct = freezePid ? 3 : ctx.wheelbase_mm && ctx.wheelbase_mm > 280 ? 12 : 15;

  const proposed = {
    roll: scaleAxis(current.roll, freezePid ? 1 : rollF),
    pitch: scaleAxis(current.pitch, freezePid ? 1 : pitchF),
    yaw: scaleAxis(current.yaw, freezePid ? 1 : yawF),
  };

  if (freezePid) {
    reasons.unshift("检测到强烈电机不对称或陀螺尖峰启发式：冻结大幅 PID 修改，请先地面排除装机与电调问题。");
  }

  if (ctx.aircraft_class === "rover" || ctx.aircraft_class === "boat") {
    reasons.push("车/船与多旋翼控制对象不同：上表 P/I/D 仅为占位，请以 ArduPilot/Rover 或 Boat 官方调参文档为准。");
  }

  return {
    current,
    proposed,
    delta_policy: {
      max_relative_change_percent: maxPct,
      notes: "单次改动建议在地面站/Configurator 中小步验证；以日志与实飞为准。",
    },
    why: reasons,
    safety_checklist: [
      "多旋翼：桨上紧、电机转向与混控定义一致后再试飞。",
      "先在低风险环境确认无哨叫与过热，再做大动作。",
      "对照各栈官方 PID 文档（Betaflight / ArduPilot / PX4）。",
    ],
  };
}
