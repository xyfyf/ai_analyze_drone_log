# 无人机黑匣子日志 AI 诊断 SaaS — 开发待办清单（Architecture / PRD 级）

> 工作目录：`c:\Users\Administrator\Desktop\WORK\ai_analyze_drone_log`（可与仓库同名）  
> 目标：网页端 SaaS，用户上传 **ArduPilot / PX4 / Betaflight** 黑匣子日志，按 **四步产品链路** 交付：**(1) 坠机/异常原因** → **(2) 抖动与不稳定成因解析** → **(3) 基于日志内已有 PID/滤波参数给出新一版推荐值** → **(4) 对话式交互**：根据用户自然语言需求推荐飞控参数修改，并**强制引用官网参数说明**以降低幻觉；全程可 **订阅/按次计费**。**商业化、获客与品牌口径** 见 **§8**。  
> 设计原则：**确定性算法产出“事实与指标”，LLM 负责“解释、归纳与行动建议”**；凡涉及 **参数名与取值**，须 **可追溯到官方文档或日志内实测字段**，禁止凭空捏造参数符号。上传日志时 **同步采集飞机类型、轴距、电池与动力链、近期软硬件与参数改动**（`UserContext`），与日志解析结果 **交叉校验**，显著降低误判与幻觉。

---

## 一、产品边界与输入输出（PRD 摘要）

### 1.1 支持的日志类型（需分阶段）

| 栈 | 典型扩展名 / 容器 | 解析难度 | MVP 建议 |
|---|-------------------|----------|----------|
| ArduPilot | `.bin`（DataFlash） | 中-高 | Phase 2：Python `pymavlink`/DFReader 或成熟工具链 |
| PX4 | `.ulg`（ULog） | 中 | Phase 2：`pyulog` 或官方库 |
| Betaflight | `.bbl`、`.bfl`、`CSV`（解码后） | 中（解码步骤） | **Phase 1 优先**：已有 CSV 最易打通 FFT 与闭环 |

**结论（范围控制）**：MVP 先锁定 **一种格式跑通全链路**（推荐 **Betaflight 解码后的 CSV** 或 **单轴 ULog 子集**），再抽象 `LogAdapter` 扩展到 PX4/ArduPilot。

### 1.2 协同输入 — 飞机与配置问卷（`UserContext`，与日志同时提交）

**目的**：黑匣子只记录「发生了什么」，不记录「机架轴距、桨径、最近换了什么」；这些上下文对 **共振频段预估、PID 先验、装机类假设排序、第三步 delta 松紧** 至关重要。应在 **同一上传流** 中收集（表单 + 可选附件），写入 `logs.user_context`（JSONB）并与 `features.json` 一并喂给规则引擎与 LLM。

**推荐字段（分「必填 / 强烈建议 / 可选」）**

| 层级 | 字段示例 | 用途（算法与报告） |
|------|----------|-------------------|
| 必填 | `aircraft_class`：`whoop` / `5inch_fpv` / `7_10inch` / `cinelifter` / `fixed_wing` / `other` | 决定默认 PID 先验、FFT 关注频段、文案模板 |
| 必填 | `fc_stack`：`betaflight` / `ardupilot` / `px4`（可与文件魔数互校） | 路由解析器与 RAG 索引版本 |
| 强烈建议 | `wheelbase_mm` 或对角电机距（mm） | 机体柔性/共振先验；洗桨与油门曲线解释 |
| 强烈建议 | `cell_count`（如 4S/6S）+ **标称** `battery_mah`、`battery_brand_series`（可选） | 与日志 `vbat` 曲线对照，识别 sag / 低压误配 |
| 强烈建议 | `prop_size_inch` + `prop_blade_count` + `prop_brand_model`（可选） | 与电机谐波、洗桨、高频噪声关联 |
| 强烈建议 | `motor_kv` + `motor_model`、**ESC 协议/固件**（如 DShot600、BLHeli_32 rev） | desync、滤波、油门线性相关解释 |
| 强烈建议 | `takeoff_weight_g`（起飞重量，含电池） | 与油门中位、悬停油门比例对照 |
| 可选 | `recent_changes`：结构化列表 `{type: hardware|software|tune, description, approx_date}` | 时间上与日志段对齐时 **提高某类假设权重**（如「刚换桨」→ 优先 `prop_imbalance`） |
| 可选 | `recent_param_diff`：粘贴 `diff` / 参数表片段 / 上传 `.param` | 与日志内 PARM 互证，减少「日志未含配置」盲区 |
| 可选 | `gyro_imu_hardware`（如 ICM42688）、`frame_material`、**减震方式** | 振动与陀螺噪声先验 |
| 可选 | `rx_link`：ELRS 433/915/2.4、天线安装简述 | 与 `rc_link` 类假设交叉 |
| 可选 | `user_hypothesis`：用户一句话怀疑（「我觉得是 PID」） | 仅作 **低权重提示**，不得覆盖无证据的日志结论 |

**一致性校验（防瞎填、降幻觉）**

- 用户填 **6S** 而日志 `vbat` 峰值长期 \<18V → 前端/Worker 打 **`context_log_mismatch` 警告**，报告中列出，LLM 须优先采信日志。  
- `wheelbase_mm` 与 `aircraft_class` 明显矛盾（如 whoop 填 500mm）→ 软警告请用户复核。  
- `recent_param_diff` 与日志解析出的 PID 不一致时 → 报告「**以日志为准 / 以用户粘贴为准**」二选一策略（产品定：默认 **日志优先**，用户 diff 标为「声称」）。

### 1.3 第一步：坠机（炸鸡）与常见「人为/装机」问题 — 原因类目与日志证据（优先于纯 FFT）

产品第一步应回答：**这次异常/坠机在日志里更像哪一类失效**，再进入振动频谱、PID 等深度分析。下列类目需在特征层输出 **可计算指标**（而非让 LLM 空读原始曲线）。

**设计要点**

- **事件分段**：自动标出 `armed` → `anomaly_window` → `crash_or_disarm` 的时间段，报告聚焦末段 ±N 秒。  
- **期望 vs 实际**：若有 setpoint/ATT/DesRoll，优先算 **跟踪误差突增**、**单轴饱和**、**积分 windup** 等。  
- **多假设排序**：装机错误与 PID 震荡可能叠加；输出 `hypotheses[]` 时给出 **证据链** 与 **置信度**，避免单一武断结论。  

**常见原因类目（扩展清单，可做成可检索标签）**

| 标签 | 典型真实世界原因 | 日志里可抓的信号（示例，按栈与记录字段可用性） |
|------|------------------|-----------------------------------------------|
| `props_wrong` | 桨叶上下反装、正反桨混用、桨根未顶紧「半松」 | 同等油门下电机输出明显不对称；起飞即横滚/俯仰发散；有时伴某一轴陀螺高频草状噪声 |
| `motor_direction` | 电机物理转向与飞控「转向约定」不一致（未改线序或未在 BF 声明 reversed） | 解锁后轻微油门即偏航/自旋；四轴对边电机指令长期「拧麻花」；官方说明见 [Betaflight：反转电机与 Yaw 处理](https://betaflight.com/docs/wiki/guides/current/Reversed-motor-direction) |
| `frame_resource_order` | 机架定义的电机序号与 BF「混控矩阵」不一致 | 对角线电机同向拉高、横滚俯仰反向补偿；需对照 `resource`/混控与机架图 |
| `props_in_out_mismatch` | Props in/out 与实机桨向不一致 | 与 `motor_direction` 类似，偏航/洗桨异常，常在上油门瞬间暴露 |
| `rc_link` | 遥控器失联、失控保护触发、帧率过低、天线摆放差 | RC 通道冻结或跳变；`RSSI`/`LQ`（若记录）断崖；failsafe 标志位；摇杆最后有效帧与姿态突变关系 |
| `rx_pwm_glitch` | SBUS/ELRS 解码异常、接线松动 | 单帧 RC 尖峰、通道 CRC/异常包（若固件暴露） |
| `esc_desync` | 电调失步、油门突变、KV 过高、恶劣电气噪声 | 某一 motor 输出顶格而其它正常；该轴速率/电流异常；参考 [Oscar Liang：ESC desync](https://oscarliang.com/fix-esc-desync/) |
| `battery_sag` | 电池老化、插头虚接、线规过细 | 电压曲线陡降、低压报警位；末端大油门 combined 电流与电压耦合 |
| `vtx_antenna` | （多为图传非飞控）天线被桨打坏 | 若用户同时上传 OSD/说明可做人因问卷；飞控日志侧弱相关 |
| `gyro_saturation` | 陀螺饱和、严重振动后姿态估计崩 | gyro 全量程削顶、clip 计数；D 项爆炸；高 FFT 底噪（>150 Hz「草」常见于机械松旷，见 [FPV 黑匣子解读类文章](https://blog.uavmodel.com/fpv-blackbox-analysis-how-to-read-and-interpret-betaflight-flight-logs/)） |
| `mechanical_loose` | 机臂螺丝、电机座、飞控减震球松动 | 低频晃动 + 宽频噪声；着陆段与悬停段噪声底不一致 |
| `arm_switch_logic` | 解锁开关误触、模式切错、反乌龟误操作 | `arming` 事件序列、模式字段突变；用户问卷交叉验证 |
| `gps_glitch` | 卫星数跳变、位置跳点（自驾仪） | 位置创新过大、GPS glitch 相关标志；[ArduPilot：GPS failsafe & glitch](https://ardupilot.org/copter/docs/gps-failsafe-glitch-protection.html) |
| `ekf_nav_failure` | EKF 方差爆、罗盘/GPS 不一致 | NKF/EKF innovation 超阈；[EKF failsafe](https://ardupilot.org/copter/docs/ekf-inav-failsafe.html)；[日志诊断入门](https://ardupilot.org/plane/docs/common-diagnosing-problems-using-logs.html) |
| `compass_interference` | 电源线、电机磁路导致罗盘歪 | 偏航漂移与油门/电流相关；磁向量模长异常 |
| `wind_baro` | 大风、气压计受螺旋桨洗流 | 定高飘、throttle 补偿与 Z 轴加速度异常（视日志字段） |
| `pid_tune_instability` | P/D 过高、滤波过弱、D shot 噪声 | setpoint 振荡、电机锯齿_cmd、跟踪误差周期性 |
| `turtle_flip` | 反乌龟功率不足、桨打地卡死 | 末段电机指令模式化、姿态长时间倒扣 |
| `motor_failure` | 断线、断桨、轴承卡死 | 单电机持续 max、转速反馈（若有）异常 |
| `software_config` | 混控类型选错、角模式/自稳混用、反乌龟资源冲突 | 配置 diff（需用户导出 CLI/参数表）与日志交叉 |
| `pilot_input` | 纯误操作（打杆过大、错舵） | RC 与 Des 一致且幅度大；无 failsafe、无单电机异常 |
| `unknown` | 证据不足 | 明确提示上传 **更长日志/参数 dump/飞行录像时间码** |

**联网参考（便于实现与写帮助文档）**

- Betaflight 在线黑匣子查看：[Blackbox Explorer](https://blackbox.betaflight.com/)  
- ArduPilot 用日志排查通则：[Diagnosing problems using logs](https://ardupilot.org/plane/docs/common-diagnosing-problems-using-logs.html)  

### 1.4 核心处理流水线（逻辑闭环）

1. **上传**：校验 MIME/魔数/大小；病毒扫描（可选）；写入对象存储；写元数据行（用户、哈希、机型字段、固件版本）；**持久化 `UserContext`（§1.2）** 并运行与日志的 **一致性校验**（如 cell_count vs vbat），产出 `context_validation[]` 写入任务载荷。  
2. **解析**：后台 Worker 将原始文件转为 **统一内部时序 schema**（时间戳单调、采样率、陀螺/加速度/电机/油门、RC、电压、模式、failsafe 等列——按格式尽力映射）；**将 `UserContext` 并入 `features.json` 根级**（`user_context` + `context_validation`），供后续规则与 LLM 使用。  
3. **坠机/异常事件层（第一步，与 §1.3 对齐）**  
   - 检测 **姿态/速率突变**、**电机指令不对称**、**失控标志**、**电压断崖**、**GPS/EKF 异常** 等，生成 `incident_features` JSON。  
4. **第二步：稳定性 / 抖动 /「飘」— 特征层（见 §1.6）**  
   - 在 **全段或用户选定悬停/航线段** 计算 `stability_features`：频域峰、setpoint 跟踪误差、电机指令对称性、D 项与陀螺高频能量、滤波器相关代理量、油门耦合等。  
5. **指纹/规则层（可选但强烈建议）**：维护 **「抖动模式库」**（共振峰型、洗桨、yaw 抖动、滤波延迟振荡等）+ 坠机模式库，用于 **检索 + 打分**。  
6. **第三步：PID 推荐层（见 §1.7）**  
   - 从日志或用户绑定的 **CLI / 参数导出** 抽取 **当前** PID、滤波、rates；结合 `stability_features` 与 **`UserContext`（轴距/桨径/电压等级等）设定先验与 `delta_policy` 松紧** 生成 **带约束的候选 PID**（单轴步进上限、禁止一次改完全轴等安全规则）。  
7. **第四步：对话式调参助手（见 §1.8）**  
   - 独立会话接口：用户用自然语言描述目标（如「定高飘」「大角度打杆后回弹」）；检索 **官方文档分块**，输出 **参数修改列表 + 每条必须附 doc_citation**；若语料中无该参数则 **明确拒绝生成** 并提示查阅官方全文。  
8. **LLM 叙事与排版**：将上述结构化 JSON（含 **`user_context` + `context_validation`**）转为用户可读报告（仍受 Schema 与引用约束）。  
9. **交付**：网页报告 + PDF（付费档）；免费档可限制 **第二步缩略图 + 第三步仅给方向不给具体数值**。  

### 1.5 输出报告字段（建议强制 Schema）

- `summary`：一句话结论（优先描述 **坠机/异常主因假设**；若用户更关心抖动，可并列第二句概括 §1.6）  
- `user_context`：回显 §1.2 提交内容（脱敏后）+ `context_validation[]`（与日志对照的通过/警告项）  
- `incident_timeline[]`：`t0`、`t1`、事件类型（`crash` | `failsafe` | `oscillation` | `land`）简述  
- `hypotheses[]`：`type`（在 **§1.3** 表中的 `标签` 基础上扩展：`gyro_hw` | `pid_tune` | `mechanical_resonance` | `electrical/motor` | `rc_link` | `battery` | `nav_ekf_gps` | `pilot_input` | `unknown` 等）、`confidence`、`evidence[]`（指标名+数值+图引用）；**可附加 `user_context_boost`** 说明是否因 `recent_changes` 提高了该假设权重（须仍有日志证据）  
- **`stability_analysis`（第二步输出）**：见 §1.6；须含 `jitter_hypotheses[]`、`metrics`（数值字典）、`plot_refs[]`（频谱/误差曲线占位 id）  
- **`pid_recommendation`（第三步输出）**：见 §1.7；须含 `current{}`、`proposed{}`、`delta_policy`（如单轴最大 ±%）、`why[]`（每条对应 `stability_analysis` 中的键）、`safety_checklist[]`  
- `actions[]`：可执行项（地面检查顺序、调参旋钮优先级、是否建议更换部件）  
- `disclaimer`：非适航认证、实验性 AI；**PID 与参数修改可能导致失控，须用户自担风险并逐步试飞验证**  
- `privacy_note`：若含 GPS，提供脱敏选项说明  

### 1.6 第二步：飞机抖动、不稳定、发飘 — 用户最想理解的「为什么」

**目标**：用日志回答 **现象层** 问题（抖、飘、硬、跟手差），与第一步「事故/装机」互补；同一架机可能 **无坠机但长期抖**，本步是付费价值核心之一。

**建议输出的子类（可映射到 `jitter_hypotheses[].tag`）**

| 现象标签 | 用户感知 | 日志侧典型证据（算法化） |
|----------|----------|---------------------------|
| `mechanical_resonance` | 某油门段嗡嗡抖、机体麻 | FFT 主峰与电机基频/谐波共线；陷波已开仍有余峰 |
| `prop_imbalance_or_loose` | 高频麻、草状陀螺曲线 | 陀螺 >150 Hz 宽带能量；油门越大越甚 |
| `pid_d_term_hot` | 热机更抖、「电击感」 | D 项幅度与温度段相关（若有）；setpoint 阶跃后高频环 |
| `pid_p_too_high` | 细振、哨叫 | 跟踪误差小振幅等幅振荡；略降油门即减轻 |
| `pid_i_windup` | 漂移、松杆不回中 | 积分项饱和、长时间小误差累积 |
| `filter_phase_delay` | 跟手钝、大动作后晃 | 低通过强代理：setpoint 与 gyro 相位滞后大 |
| `setpoint_smoothing` | 杆已回中飞机还在扭 | RC 与 setpoint 平滑链导致滞后（视字段） |
| `yaw_jump` | 偏航抽、扭 | yaw 轴电机对角差分异常；yaw P/I 与滤波组合 |
| `propwash_dirty_air` | 垂起、倒飞、自己洗桨时飘 | 低油门/高油门交叉段 Z 轴或角速率方差突变 |
| `baro_throttle_coupling` | 定高上下洗 | 气压相关估计与 throttle 相关性强（自驾仪日志） |
| `rc_noise_or_resolution` | 杆微抖飞机跟着抖 | RC 通道量化台阶、微小振荡与 gyro 相关性 |
| `gain_too_low_sluggish` | 软、飘、像「船」 | 大误差长建立时间；饱和少但跟踪慢 |

**工程要求**

- 默认分析 **用户勾选时间段**（如悬停 10s）；无勾选则用 **全段去首尾 armed 突变**。  
- 所有 `jitter_hypotheses` 必须带 **`evidence_metrics`**（键值对），LLM 仅用其做中文解释，**不得编造未计算的指标名**。  

### 1.7 第三步：基于日志内已有 PID / 滤波 — 推荐新一版参数

**输入**

- **`UserContext`（§1.2）**：轴距、桨径、电压制式、动力链等，用于 **先验与 `delta_policy`**；与日志矛盾项以 `context_validation` 为准。  
- 日志内嵌或并行上传的 **当前参数集**（BF：`diff all` / CLI；ArduPilot：`.param` 或 PARM 消息；PX4：ULog `parameter_update` / QGC 导出）。  
- `stability_features` + **§1.3** `incident_features`（避免在明显装机错误时猛推 PID）。  

**输出形态**

- `current` / `proposed` 使用 **与固件一致的参数名**（区分 BF / AP / PX4 命名空间）。  
- 每个改动键附带：`reason`（绑定到指标）、`expected_effect`、`risk_level`（`low|med|high`）。  
- **安全策略（强约束）**：例如单参数相对变化 ≤20%（最终阈值产品定）、高危项（如 D_MAX、滤波清零）需二次确认 UI；**若 §1.2 未提供桨径/轴距/电压等级，仍禁止给出极端竞速式 PID**；填写完整时用于 **收紧合理搜索区间** 并生成更可信的 `why[]`。  

**官方调参阅读顺序（给用户附链接，减少乱试）**

- Betaflight：[PID Tuning Guide](https://betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide)、[PID Tuning Tab](https://betaflight.com/docs/wiki/app/pid-tuning-tab)、[4.3 Tuning Notes](https://betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes)、开发侧说明 [PID tuning (dev)](https://betaflight.com/docs/development/PID-tuning)（与 Wiki 交叉核对）  
- ArduPilot Copter：[Tuning](https://ardupilot.org/copter/docs/tuning.html)、[Common Tuning](https://ardupilot.org/copter/docs/common-tuning.html)、[AutoTune](https://ardupilot.org/copter/docs/autotune.html)、[完整参数表](https://ardupilot.org/copter/docs/parameters.html)  
- PX4：[Multicopter PID Tuning Guide (Manual/Advanced)](https://docs.px4.io/main/en/config_mc/pid_tuning_guide_multicopter)  

### 1.8 第四步：对话式交互 — 自然语言需求 → 参数修改建议 + 官网依据

**典型用户话术**：「我想定高不要上下晃」「大疆图传太重头重脚轻怎么调角速率」「穿越机俯仰跟手太钝」等。

**防幻觉机制（必须实现为硬规则，而非仅 prompt）**

1. **语料库**：仅索引 **官方站点**（**§1.7** 官方链接表 + 各固件 `Parameters`/`CLI` 说明页）；按 **固件主版本** 分库（如 BF 4.3 vs 4.5、AP 4.4.x、PX4 主分支文档），日志中解析到版本号后 **只检索对应子索引**。  
2. **检索增强生成（RAG）**：用户问题 → embedding 检索 Top-K chunk → LLM 只许引用 chunk 内出现的 **参数名与描述**；输出 JSON：`suggestions[]` 每项含 `param`、`old_guess`（若未知写 null）、`new_value`、`citation`（`url`、`title`、`quote_snippet`）。  
3. **无命中则拒绝**：若检索不到该参数文档，返回 **「官方文档未收录该键，请勿盲改」** 并给出官方总表链接；**严禁**模型「推测」未在语料出现的 CLI 命令。  
4. **与第三步衔接**：对话可读取本机上一次的 `pid_recommendation` 与 **`UserContext`**，建议用户「一键应用为草稿」再在 Configurator / QGC 中人工写入。  
5. **审计**：保存每次对话的 `citation` 列表，便于纠纷与模型迭代。  

**可选增强**

- 对 ArduPilot **parameters.html** 类大表做定期爬取 + checksum，避免外链改版断档。  
- 多语言：同一 chunk 存中英摘要，引用仍指向英文原页锚点。  

---

## 二、技术栈建议（与 AI 协作友好）

| 层级 | 选型 | 说明 |
|------|------|------|
| 全栈框架 | **Next.js（App Router）+ TypeScript** | 训练语料大、AI 生成质量稳定；注意 **上传体大小限制**（Next 代理/缓冲默认约 **10MB**，大日志需直传 Storage 或调 `proxyClientMaxBodySize` / 分块上传）。 |
| UI | **Tailwind + shadcn/ui** | 快速一致 UI |
| BaaS | **Supabase**（Auth + Postgres + Storage） | 大文件用 **Signed Upload URL**（服务端鉴权后 `createSignedUploadUrl`，客户端 `uploadToSignedUrl`），避免 API 路由吞整文件。 |
| 部署 | **Vercel**（前端/API）+ **Worker**（长任务） | 解析/FFT 建议 **独立 Worker**（容器或队列消费者），避免 serverless 超时。 |
| 队列 | **Supabase Edge Function / Inngest / Cloud Run** 等择一 | 异步状态机建议：`queued` → `parsing` → `incident` → `stability` → `pid_suggest` → `report_llm` → `done`；**第四步对话**走独立 `chat` 服务，不阻塞主报告。 |
| 科学计算 | **Python（NumPy/SciPy）** 或 Rust | 团队若偏飞控脚本，Python 迭代最快 |
| 对话与防幻觉 | **向量检索（pgvector / Supabase Vector）+ 官方文档分块索引** | 仅索引 **§1.7** 所列官方域；按固件版本分 collection；生成结果 **强制 citation JSON Schema** |
| 计费 | **Stripe**（订阅 + Webhook 开通额度） | 与 `credits` 表或 Stripe Customer Portal 联动 |
| 邮件 | **Resend** | 报告就绪通知 |

---

## 三、风险与诚实边界（必须在产品里写清）

- **“Transformer 分析时序”**：营销上可讲，工程上应落地为 **特征工程 + 结构化提示**；必要时用 **小型时序模型** 做辅助，但 MVP 不必上自训练大模型。  
- **根因唯一性**：共振 vs PID vs 陀螺缺陷可能耦合；系统应输出 **排序假设** 而非单选武断结论。  
- **用户自述不可无条件采信**：`UserContext` 可能与日志或物理规律冲突；**一切以可验证传感器与 `context_validation` 为优先**，自述仅作 **先验权重** 与 **报告中的「用户声称」栏** 展示。  
- **PID / 参数建议的法律责任**：第三步、第四步输出必须带 **风险提示与渐进试飞清单**；界面显著提示「模型非制造商认证」。  
- **第四步幻觉**：禁止无引用参数名；RAG **零命中** 时不得编造；定期校验官方文档爬取 **checksum**，断档时降级为「仅列链接不生成值」。  
- **语料版本 vs 实机固件**：界面展示 **索引对应固件主版本/爬取日期**；检测到与日志解析版本 **不一致** 时，默认仅输出 **文档链接 + 泛读建议**，不下发具体数值，或要求用户确认「自担版本风险」。  
- **法律/隐私**：日志可能含敏感位置；提供 **删除数据** 与 **导出范围** 控制。  

---

## 四、开发阶段与 TodoList（可直接勾进度）

### Phase 0 — 仓库与规范（0.5–1 天）

- [ ] 初始化 monorepo 或单仓（`web` + `worker` 两包即可）  
- [ ] 添加 `.cursorrules` / `AGENTS.md`：强制 TypeScript、**解析与 FFT 在 worker**、LLM 仅消费 JSON、禁止省略错误处理；**第四步须输出可校验的 `citations[]`**；**§1.2 `UserContext` 字段与 `context_validation` 规则须在服务端重复校验**  
- [ ] 定义环境变量模板：Supabase URL/keys、Stripe、OpenAI/Anthropic、日志桶名  

### Phase 1 — MVP 闭环（约 7 天级，按每天 2h 需拉长）

- [ ] **Supabase**：项目创建；`logs` 表（`id,user_id,status,format,storage_path,sha256,created_at`，**`user_context jsonb`**、`context_validation jsonb`）；Storage bucket `raw_logs`  
- [ ] **RLS**：用户只能读写自己的 `logs` 行与前缀路径对象  
- [ ] **上传链路**：Next Route Handler 校验会话 → **签发 Supabase 签名上传 URL** → 客户端直传；**同一请求或分步表单** 提交 §1.2 `UserContext` 与可选 `recent_param_diff` 附件  
- [ ] **Worker**：消费队列任务，下载对象 → 解析为统一 `TimeSeriesBundle`  
- [ ] **坠机/异常第一步**：实现 **事件分段** + `incident_features`（电机不对称、电压断崖、RC/RSSI、failsafe、姿态突变等规则与阈值）  
- [ ] **第二步**：实现 `stability_features` + `stability_analysis`（§1.6 表格中至少 **6 类** 抖动标签的规则/阈值 + 图表数据接口）  
- [ ] **第三步**：解析 **当前 PID/滤波**（从日志头或用户上传 `.param`/CLI）→ `pid_recommendation`（含 `delta_policy`、风险分级）；**若 §1.3 命中装机类高危标签**（如 `motor_direction`、`props_wrong`），则 **冻结或极大收缩自动 PID 改动**，优先输出地面排故与复飞前检查项  
- [ ] **LLM**：`features.json`（含 **`user_context`、`context_validation`**、incident、stability、pid）→ `diagnosis.json` 的 **Zod/JSON Schema**；失败重试与 token 上限  
- [ ] **前端**：**上传向导**（日志 + §1.2 问卷分步/同页）、任务状态轮询、报告页（**事故摘要 + 抖动解释 + PID 前后对比表 + 频谱图 + 用户自述与校验警告区**）  
- [ ] **计费雏形**：Stripe Checkout 购买 **N 次分析额度**；Webhook 入账 `credits`  

### Phase 2 — 多格式与专业度

- [ ] **Betaflight**：集成 `.bbl` → CSV 解码（调用 `blackbox_decode` 或等价方案），纳入 CI 样例文件  
- [ ] **ULog**：`sensor_combined` / IMU 相关 topic 抽取与采样率处理  
- [ ] **ArduPilot `.bin`**：解析 ATT/IMU/RC/PARM 等消息，映射到统一 schema  
- [ ] **特征库**：内部维护「指纹」条目 + 简单相似度（相关系数 / DTW 择一）  
- [ ] **第四步（RAG）**：官方文档爬取/导入流水线、版本分库、chunk + embedding、`chat_sessions` 表与引用审计字段  
- [ ] **对话 UI**：流式输出 + 每条建议展开「官网原文摘录」与外链  
- [ ] **PDF 报告** 与 **邮件通知**  

### Phase 3 — 商业化与运营（执行清单见 **§8.7**）

- [ ] 订阅档位（Pro：更高上传上限、历史对比、团队席位）  
- [ ] 管理后台：退款、滥用封禁、成本看板（每用户 token 花费）  
- [ ] 公开 **评测集**：标注样本的混淆矩阵，迭代提示词与阈值  
- [ ] **GTM 最小包**：落地页 + 定价页 + 隐私/服务条款 + 支付漏斗埋点（与 §8 对齐）  

### Phase 4 — 可选增强

- [ ] 多语言报告（中/英）  
- [ ] 用户上传 **对比两次飞行**（换桨前后）自动生成 diff  
- [ ] 开放 API（mTLS 或 API Key）给团队客户  
- [ ] **PX4 参数参考** 纳入 RAG：[Parameter Reference](https://docs.px4.io/main/en/advanced_config/parameter_reference.html) 与 ULog 固件版本对齐  

---

## 五、关键工程任务拆解（细项 Checklist）

### 5.1 数据与存储

- [ ] `logs` / `jobs` / `reports` / `credits` 表设计与迁移（Prisma 或 Drizzle）；**`logs.user_context`、`logs.context_validation` 与可选 `aircraft_profiles`（用户可复用机架模板）**  
- [ ] 对象生命周期策略（例如 30 天自动冷存储/删除）  
- [ ] 大文件分片/断点续传（上传体验）  

### 5.2 解析与特征（核心壁垒）

- [ ] 统一内部 schema：`sample_rate_hz`、`gyro_rps[3]`、`acc_mps2[3]`、`motor[]`、`rc[]`、`vbat`、`arming`、`mode_flags`、`rssi_or_lq`（按可用性 nullable）  
- [ ] **坠机类目规则引擎 v0**：覆盖 **§1.3** 表中至少 **8 个高频标签** 的确定性判别与单元测试（合成曲线）  
- [ ] **抖动类目规则/阈值 v0**：覆盖 §1.6 表中至少 **6 个标签**；与 FFT 结果交叉验证  
- [ ] **当前参数提取器**：BF（日志头/附加 CLI）、AP（PARM）、PX4（`parameter_update`）任一 MVP 打通  
- [ ] **PID 安全策略模块**：`delta_policy`、装机高危抑制规则、单元测试  
- [ ] 抗混叠：重采样、去直流、窗函数（Hanning）  
- [ ] 共振峰：峰宽、谐波族（1×、2× 电机转速）联合判定逻辑  
- [ ] 单元测试：合成正弦 + 噪声，验证 FFT 峰值检测误差范围  

### 5.3 AI 与提示工程

- [ ] System prompt：强调只基于输入 JSON，不得捏造未提供字段  
- [ ] 输出 JSON Schema 校验失败则自动二次修复（repair pass）  
- [ ] 模型路由：便宜模型做分类，强模型写建议（可选）  
- [ ] **第三步 PID 提示词**：必须引用 `pid_recommendation.why[]` 中的指标键，不得编造「日志未计算的 Phenomenon」  
- [ ] **第四步 RAG**：检索过滤（`firmware_major_minor`）；**无 citation 块则禁止输出 `new_value`**；Prompt 注入防护（用户粘贴伪文档）  
- [ ] **`UserContext` 叙事规则**：LLM 引用用户自述时须标注为「用户填写」；与 `context_validation` 冲突时 **明确采信日志**  

### 5.4 安全

- [ ] 上传速率限制（IP + 用户）  
- [ ] 服务端 **`service_role` 绝不暴露到浏览器**  
- [ ] Webhook 签名校验（Stripe）  

---

## 六、验收标准（Definition of Done）

1. 任意 **测试用户** 完成：注册 → 上传样例日志并 **填写 §1.2 必填项** → 2 分钟内看到 **(1) 末段事件摘要 + 假设**、**(2) 抖动/不稳定分析（≥2 条带 evidence_metrics）+ 图位**、**(3) 基于当前 PID 的 proposed 草案（含 delta_policy）**、**报告中展示 `user_context` 与 `context_validation`（若有警告）**、**≥3 条可执行建议**。  
2. **第四步（可 Phase 2 交付）**：用户输入一句自然语言目标 → 返回 **≥1 条带官方链接 citation 的参数建议**；故意问语料不存在的假参数名时系统 **拒绝胡编**。  
3. 付费流程可走通：**扣减额度或订阅生效后解锁完整报告**。  
4. 失败路径明确：解析失败/文件损坏时，用户看到 **可理解错误** 与重试引导。  

---

## 七、建议的下一步（在本仓库执行顺序）

1. 在本目录初始化 Next.js + Supabase 骨架（与上表一致）。  
2. 先落 **签名直传 Storage**，不要先把整文件 POST 进 Next（体积极易触达默认缓冲上限）。  
3. Worker 先只吃 **CSV**，跑通 **(1) incident → (2) stability → (3) pid_recommendation → LLM 报告**；再扩格式与 **(4) RAG 对话**。  

---

## 八、商业化与市场推广（GTM / Marketing）

本章补齐 PRD 中「如何赚钱、如何让人知道、如何持续获客」；与 **§1 产品能力**、**§4 Phase** 交叉执行，建议在 **MVP 可演示后** 与研发并行启动。

### 8.1 定位与核心信息（Messaging）

- **一句话价值**：把黑匣子日志变成 **可执行结论**（坠机/抖动原因 + PID 方向 + 带官网引用的调参建议），省掉「自己啃 Blackbox / 翻三天论坛」的时间。  
- **差异化**：**日志事实 + 规则特征优先**，LLM 只做解释与归纳；**官方文档 RAG** 降低参数幻觉；**UserContext** 提高跨机型的可信度。  
- **禁止过度承诺（对外口径）**：不使用「100% 找根因」「替代厂家保修」「适航认证」等表述；统一使用 **「辅助诊断」「实验性 AI」「须地面验证后再试飞」**（与 §3 风险一致）。

### 8.2 商业模式与定价（可迭代）

| 模式 | 说明 | 典型用途 |
|------|------|----------|
| **Freemium** | 免费：仅元数据 + 少量图表 / 1～2 条假设（模糊化） | 降低首次尝试门槛、SEO 与分享传播 |
| **按次积分（Credits）** | 购买 N 次「完整报告」或「对话调参包」 | 低频玩家、偶尔炸鸡复盘 |
| **订阅 Pro** | 月/年：更高单文件上限、历史对比、PDF、优先队列、团队 2～5 席位 | 飞手队、教练、高频调参用户 |
| **B2B / 发票** | 巡检公司、培训机构、赛事保障：年费 + SLA + API（见 Phase 4） | 客单价高、需合同与对公 |

**定价实验**：上线后通过 **Stripe Price / 优惠券** 做 A/B（如「首单 9 元体验包」vs「订阅首月半价」），以 **付费转化率 + 次月留存** 为决策依据。

### 8.3 获客渠道（按投入优先级）

1. **社群与论坛（冷启动最高 ROI）**：Betaflight / ArduPilot / PX4 相关 Discord、Reddit（r/Multicopter 等）、IntoFPV、RCGroups、国内模友群 / 贴吧 / B 站评论区；策略：**免费提供高质量复盘帖**（脱敏日志 + 报告截图）+ 固定结尾 CTA。  
2. **内容 SEO**：长尾词如「Betaflight 黑匣子 抖动 分析」「ULog 坠机 日志 怎么看」；落地页内嵌 **可索引的教程段落**（结构化数据 FAQ）。  
3. **短视频 / 直播**：YouTube Shorts、B 站、TikTok — **同一素材**：上传 → 10 秒出结论 → 对比「纯人肉看 Blackbox」耗时。  
4. **KOL / 教练合作**：提供免费 Pro 席位换 **口播 + 个人链接**；或与飞校、穿越机店铺 **分成码（Referral）**。  
5. **展会与线下**：小型赛事保障台、飞手聚会二维码拉新（当场上传样例送积分）。  
6. **付费投放（后置）**：在 **验证留存与 LTV** 后再开 Google/Meta/国内信息流；否则易烧预算。

### 8.4 转化与留存（产品 + 运营）

- **激活**：注册后 **引导上传第一段样例**（可提供官方脱敏样例下载），完成即送少量 credits。  
- **付费墙设计**：免费报告末尾 **明确列出「付费解锁」条目**（完整 PID 表、PDF、对话次数）。  
- **邮件 / 站内通知**：报告就绪、积分将过期、订阅续费提醒（Resend 等，§2 技术栈已列）。  
- **留存钩子**：「同一架飞机」**历史报告时间线**、换桨前后两次上传 **自动 diff**（Phase 4 能力可提前包装为 Pro 卖点）。

### 8.5 品牌、信任与合规（市场侧）

- **隐私**：对外说明日志可能含 GPS；提供 **删除账户与数据** 入口（与 GDPR/个人信息合规方向一致，具体以法务为准）。  
- **案例授权**：用户分享案例前 **勾选授权书**（匿名化机架序列号、坐标脱敏）。  
- **争议处理**：显著位置提供 **人工复核/退款政策**（与 Stripe 争议流程对齐）。

### 8.6 指标体系（北星与漏斗）

| 层级 | 指标示例 |
|------|----------|
| 获客 | 渠道 UTM 访问量、注册率、样例上传完成率（激活率） |
| 转化 | 免费 → 首次付费转化率、ARPU、客单价分布 |
| 留存 | D7/D30 留存、订阅次月续费率、Pro 功能使用率（对话 / PDF） |
| unit economics | 单次分析 **模型+存储+算力** 成本 vs 售价毛利率 |
| 质量 | 用户 thumbs down 报告比例、人工复核介入率（反向驱动模型与规则） |

### 8.7 商业化与市场 — TodoList（可与 Phase 3 并行勾选）

- [ ] **商业与法务基座**：服务条款、隐私政策、退款说明、免责声明（中/英初版）  
- [ ] **定价页 + Stripe**：月付/年付/积分包 SKU 设计；Checkout 与 Customer Portal  
- [ ] **落地页（Landing）**：价值主张 + 样例报告轮播 + 信任背书（脱敏案例）+ 清晰 CTA  
- [ ] **分析埋点**：注册、上传完成、报告生成、付费成功、渠道 UTM 全链路  
- [ ] **冷启动物料包**：3 篇论坛长文模板、1 套短视频分镜、10 张对比图（免费 vs 完整报告）  
- [ ] **推荐 / 联盟**：推荐码或 Stripe Referral、与 1～2 家店铺或教练试点分成  
- [ ] **B2B 一页纸**：目标客户、报价区间、SLA 草案（不阻塞 C 端上线）  

---

*文档版本：2026-05-14（修订：新增 §8 商业化与市场推广 GTM；Phase 3 与 §8.7 对齐）— 由系统架构视角拆解，可与实现并行迭代。*
