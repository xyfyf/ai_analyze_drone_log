import type { UserContext } from "@/lib/types/user-context";
import { getColumnSeries } from "@/lib/blackbox/parse-csv";
import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";

export type ContextValidationItem = {
  code: string;
  level: "info" | "warn" | "error";
  message: string;
};

/**
 * 将用户填写的 UserContext 与日志可观测字段做交叉校验（PRD §1.2 一致性）。
 */
export function validateUserContextAgainstLog(
  ctx: UserContext,
  parsed: ParsedBlackbox,
): ContextValidationItem[] {
  const out: ContextValidationItem[] = [];

  const vbat = getColumnSeries(parsed, ["vbat", "vbatlatest", "vbatt"]);
  if (ctx.cell_count && vbat.length) {
    const maxV = Math.max(...vbat.filter((x) => Number.isFinite(x)));
    const minNominal = (ctx.cell_count - 0.5) * 3.7;
    if (Number.isFinite(maxV) && maxV < minNominal) {
      out.push({
        code: "cell_count_vs_vbat",
        level: "warn",
        message: `声明为 ${ctx.cell_count}S，但日志电压峰值约 ${maxV.toFixed(2)}V，与常见标称不符；分析以日志为准。`,
      });
    }
  }

  if (ctx.aircraft_class === "multicopter" && ctx.wheelbase_mm && ctx.wheelbase_mm > 0 && ctx.wheelbase_mm < 70) {
    out.push({
      code: "multicopter_wheelbase_tiny",
      level: "info",
      message: "多旋翼轴距很小，请确认是否为微型机；若填写错误可能影响 PID 先验提示。",
    });
  }

  if (ctx.aircraft_class === "multicopter" && ctx.rotor_count && (ctx.rotor_count < 3 || ctx.rotor_count % 1 !== 0)) {
    out.push({
      code: "rotor_count_unusual",
      level: "info",
      message: `电机数量为 ${ctx.rotor_count}，较少见；常规多旋翼为 3/4/6/8。`,
    });
  }

  return out;
}
