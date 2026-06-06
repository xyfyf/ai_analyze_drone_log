import { z } from "zod";

/**
 * §1.2 UserContext：与日志一并提交，经 Zod 校验后入库与进特征管道。
 */
export const UserContextSchema = z.object({
  /** 平台类型：多旋翼 / 固定翼 / VTOL / 直升机 / 车 / 船 */
  aircraft_class: z.enum(["multicopter", "fixed_wing", "vtol", "helicopter", "rover", "boat"]),
  fc_stack: z.enum(["betaflight", "ardupilot", "px4"]),
  wheelbase_mm: z.coerce.number().positive().optional(),
  cell_count: z.coerce.number().int().min(1).max(14).optional(),
  battery_mah: z.coerce.number().positive().optional(),
  battery_brand_series: z.string().max(200).optional(),
  prop_size_inch: z.coerce.number().positive().optional(),
  prop_blade_count: z.coerce.number().int().min(2).max(4).optional(),
  prop_brand_model: z.string().max(200).optional(),
  motor_kv: z.coerce.number().positive().optional(),
  motor_model: z.string().max(200).optional(),
  esc_protocol: z.string().max(120).optional(),
  takeoff_weight_g: z.coerce.number().positive().optional(),
  /** 电机数量（多旋翼/直升机适用），如四旋翼=4、六旋翼=6、八旋翼=8 */
  rotor_count: z.coerce.number().int().min(1).max(16).optional(),
  recent_changes: z
    .array(
      z.object({
        type: z.enum(["hardware", "software", "tune"]),
        description: z.string().max(500),
        approx_date: z.string().max(80).optional(),
      }),
    )
    .max(20)
    .optional(),
  recent_param_diff: z.string().max(8000).optional(),
  gyro_imu_hardware: z.string().max(120).optional(),
  frame_material: z.string().max(120).optional(),
  damping_notes: z.string().max(500).optional(),
  rx_link: z.string().max(200).optional(),
  user_hypothesis: z.string().max(500).optional(),
});

export type UserContext = z.infer<typeof UserContextSchema>;
