import type { UserContext } from "@/lib/types/user-context";

/** 平台类型枚举值（界面标签由 i18n `aircraft.*` 提供） */
export const AIRCRAFT_CLASS_VALUES = [
  "multicopter",
  "fixed_wing",
  "vtol",
  "helicopter",
  "rover",
  "boat",
] as const satisfies readonly UserContext["aircraft_class"][];
