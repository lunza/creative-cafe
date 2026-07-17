# Tasks

## 阶段 0：策划准备（必做，所有文档任务的前置）

- [x] Task 1: 阅读规则剧本与既有框架代码，建立策划基线
  - [x] SubTask 1.1: 通读 [docs/逆转裁判+狼人杀规则.txt](file:///d:/AI/creative-cafe/docs/逆转裁判+狼人杀规则.txt) 全文，提取核心机制清单（阵营/技能/地图/流程/暗码/胜负条件），形成内部策划基线笔记（无需落盘文件）
  - [x] SubTask 1.2: 阅读既有 `add-game-mode-framework` 的 [spec.md](file:///d:/AI/creative-cafe/.trae/specs/add-game-mode-framework/spec.md) 与 [tasks.md](file:///d:/AI/creative-cafe/.trae/specs/add-game-mode-framework/tasks.md)，确认本阶段可复用的基础设施清单（GameTypeTemplate / GameNarrativeService / GameTableRepository / AnsiTileMap / gameStore 等）
  - [x] SubTask 1.3: 阅读 [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts)、[managementSchema.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/management/managementSchema.ts)、[ManagementPromptBuilder.ts](file:///d:/AI/creative-cafe/src/main/services/game/templates/management/ManagementPromptBuilder.ts) 等既有样本代码，确认模板实现模式
  - [x] SubTask 1.4: 阅读 [src/shared/types/game.types.ts](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts)、[src/shared/constants/game.constants.ts](file:///d:/AI/creative-cafe/src/shared/constants/game.constants.ts)，确认既有类型与常量定义

## 阶段 1：基础架构与系统总览（其他文档依赖此阶段）

- [x] Task 2: 产出 `docs/werewolf-game/01-system-architecture.md` 游戏系统架构设计文档
  - [x] SubTask 2.1: 绘制系统全景图（六大子系统 + 玩家用户 + 存档系统 + 既有框架）的 ASCII 架构图
  - [x] SubTask 2.2: 编写子系统职责矩阵（法官/角色/地图/流程/AI 驱动/规则各自的输入、输出、职责、禁止行为）
  - [x] SubTask 2.3: 编写子系统间数据流向图（夜间→晨间→调查→证言→推理→审判→日间的数据传递路径）
  - [x] SubTask 2.4: 编写与 `add-game-mode-framework` 的复用清单（列出复用的具体接口/类/组件及文件路径）
  - [x] SubTask 2.5: 编写技术选型建议（阶段状态机方案：xstate vs 自实现；上下文隔离方案：单次调用 vs 持久化 context；多 AI 并发方案）
  - [x] SubTask 2.6: 编写非功能性需求（性能：多 AI 调用并发上限；可维护性：文档与代码同步策略；可扩展性：如何接入新规则包/新角色包）
  - [x] SubTask 2.7: 编写术语表（统一全文档使用的术语定义，如"真相剧本"/"证据链"/"证言"/"暗码"/"阵营"/"神民"/"伪装者"等）
  - [x] SubTask 2.8: 编写与既有 `doc/10-game-mode-module.md` 的衔接说明

## 阶段 2：六大子系统核心设计（可部分并行）

- [x] Task 3: 产出 `docs/werewolf-game/02-judge-system-design.md` 法官 AI 系统设计文档
  - [x] SubTask 3.1: 编写法官角色定位（唯一 AI 法官、单例约束、与玩家关系：典狱长=预言家+警长）
  - [x] SubTask 3.2: 编写法官职责清单（命令执行、角色模拟、信息记录、判定、打分）与禁止行为清单（不可引导玩家/不可暗示阵营/不可代替玩家决定/不可代替玩家说话）
  - [x] SubTask 3.3: 编写暗码标记协议设计（`<!-- 好 -->` / `<!-- 伪 -->` / `<!-- 药/保/笨/黑 -->` 的注入位置、全局一致性、AI 互检流程）
  - [x] SubTask 3.4: 编写真相剧本格式规范（每夜真相剧本 JSON 结构：时间/地点/凶手/被害人/手法/凶器来源/证据销毁/栽赃嫁祸/技能发动/目击者）
  - [x] SubTask 3.5: 编写法官二次监管机制设计（如何检测法官是否泄露信息：暗码完整性扫描、对话内容关键词扫描、玩家反馈通道）
  - [x] SubTask 3.6: 编写法官打分维度设计（好人存活数、经过天数、审判正确度、推理打分等的权重与计算公式）
  - [x] SubTask 3.7: 编写法官与既有 `GameNarrativeService` 的集成方案（法官作为 system prompt 注入，还是作为独立服务）

- [x] Task 4: 产出 `docs/werewolf-game/03-character-system-design.md` 角色系统设计文档
  - [x] SubTask 4.1: 编写角色档案数据结构（TypeScript interface 定义，含姓名/种族/来源/外观/身材数据/性格/生平/对话风格/文字颜色/初始物品/暗码字段）
  - [x] SubTask 4.2: 编写 16 人样例角色列表（来自规则文档的角色表，扩展为完整档案字段示例）
  - [x] SubTask 4.3: 编写阵营分配算法设计（7 普通好人 + 4 神民 + 5 伪装者的随机分配，约束：不可与外观/性格/武力值绑定，使用洗牌算法 + 种子）
  - [x] SubTask 4.4: 编写 4 种神民技能机制详述（药剂师：强心剂+毒药使用规则；保安：反杀+巡夜；笨蛋：吸引投票+临时休庭；黑客：全息影像保护）
  - [x] SubTask 4.5: 编写伪装者变形与共谋机制（变形规则、夜间睁眼共谋、不携带识别物品、作案后掩盖证据行为逻辑）
  - [x] SubTask 4.6: 编写自定义角色创建表单字段清单（用户必填/选填字段、字段校验规则、暗码由系统分配而非用户指定）
  - [x] SubTask 4.7: 编写角色编辑/导入/导出流程（导入格式：JSON；导出格式：JSON + 可读 Markdown；批量导入支持）
  - [x] SubTask 4.8: 编写与既有 `CharacterManager` / `CharacterEditModal` 组件的复用关系分析（哪些字段可复用、哪些需新增）

- [x] Task 5: 产出 `docs/werewolf-game/04-map-system-design.md` 地图系统设计文档
  - [x] SubTask 5.1: 编写默认监狱地图的 4 层结构详表（F1~F4 各层牢房编号、公共区域、交通系统、消防楼梯）
  - [x] SubTask 5.2: 编写单人牢房规格详述（结构、防弹窗、通风口与防盗网、卫生间、卧室、通讯设备、隐私与安全、房卡系统）
  - [x] SubTask 5.3: 编写房卡系统设计（绑定/丢失/记录/权限矩阵：哪张卡能开哪些门、领取哪些物资、使用哪些电脑）
  - [x] SubTask 5.4: 编写可搜索点位数据模型（点位 ID、所属房间、点位类型、可发现证据引用、是否需要工具、搜索耗时）
  - [x] SubTask 5.5: 编写自定义地图编辑器 UI 流程（楼层管理 → 房间管理 → 点位管理 → 连通关系管理 → 预览 → 保存）
  - [x] SubTask 5.6: 编写监控覆盖矩阵（F1~F4 各公共区域是否有摄像头、单人牢房无摄像头的规则、监控调取 UI 流程）
  - [x] SubTask 5.7: 编写与 `AnsiTileMap` 的瓦片映射规则（楼层→瓦片行、房间→瓦片块、角色位置→瓦片标记、可搜索点位→瓦片高亮）
  - [x] SubTask 5.8: 编写地图状态变更触发机制（命案封锁、解锁、角色移动、点位搜索后状态）

- [x] Task 6: 产出 `docs/werewolf-game/05-game-flow-design.md` 游戏流程设计文档
  - [x] SubTask 6.1: 编写完整阶段状态机图（ASCII 状态机图：首夜保护→夜间→晨间→调查→证言→推理→审判→处刑→日间→夜间循环，含胜利/失败终止态）
  - [x] SubTask 6.2: 编写各阶段的进入/退出条件（含跳过条件，如平安夜跳过调查直接进入审判）
  - [x] SubTask 6.3: 编写各阶段的 UI 操作类型映射（按钮选择式：现场调查；对话式：证言收集/日间活动；表格式：证言整理/证据展示；推理工作台式：庭前推理）
  - [x] SubTask 6.4: 编写夜间黑盒机制设计（不记录明文对话，仅生成真相剧本 JSON 持久化，玩家不可见）
  - [x] SubTask 6.5: 编写晨间死亡判定与封锁机制（命案播报格式、警报禁闭规则、解锁条件）
  - [x] SubTask 6.6: 编写现场调查环节设计（按钮清单生成规则、与真相剧本的关联、关键证据可被带离现场、未收集证据提示"尚有 X 个关键证据未收集"）
  - [x] SubTask 6.7: 编写证言收集环节设计（质询流程、出示证物流程、威慑流程、撒谎机制、证言表格整理格式，参考逆转裁判）
  - [x] SubTask 6.8: 编写庭前推理打分机制（玩家提交推理 → 法官基于真相打分 → 仅回复优良中差，禁止其他信息）
  - [x] SubTask 6.9: 编写审判环节设计（辩护顺序指定、禁止插话、玩家 2 票、归票与处刑、平票处理、处刑方式由玩家决定、遗言机制）
  - [x] SubTask 6.10: 编写身份鉴定环节设计（医疗室特殊床位、力场每日一次充能、鉴定结果仅【好人】或【伪装者】、力场消失后规则失效）
  - [x] SubTask 6.11: 编写日间活动环节设计（自由探索、监控覆盖、伪装者午夜前不主动杀戮但可准备、系统日间行为简报）

- [x] Task 7: 产出 `docs/werewolf-game/06-ai-driving-mechanism.md` AI 驱动机制设计文档
  - [x] SubTask 7.1: 编写 AI 上下文隔离架构（每角色独立 context 文件、按需注入信息、玩家不可见、与其他 AI 角色隔离、与法官真相剧本隔离）
  - [x] SubTask 7.2: 编写角色 AI 行为决策树（基于阵营 × 技能 × 已知信息 × 当前阶段的决策矩阵）
  - [x] SubTask 7.3: 编写伪装者 AI 行为策略详述（对跳/悍跳/金水/银水/查杀/悍跳反水/深水狼/倒钩狼/退水，每种策略的触发条件与执行流程）
  - [x] SubTask 7.4: 编写神民 AI 行为策略详述（药剂师救人/毒杀决策、保安反杀目标选择、笨蛋吸引火力话术、黑客保护目标识别）
  - [x] SubTask 7.5: 编写对话生成 Prompt 模板结构（system prompt + 角色档案 + 已知信息 + 当前阶段任务 + 输出格式约束）
  - [x] SubTask 7.6: 编写暗码全局一致性保证方案（生成前先在后台查询 faction-codes.json 确认真实阵营，再附加暗码；正则扫描校验；缺失暗码自动回填）
  - [x] SubTask 7.7: 编写三层数据隔离矩阵（真相剧本层：仅法官可见；证据链层：玩家 + 法官可见，AI 角色仅在玩家出示后可见；证言层：玩家 + 法官 + 已询问角色可见，其他角色不可见）
  - [x] SubTask 7.8: 编写 AI 互检机制设计（法官生成回复前先在后台确认角色真实阵营，再附加暗码；多 AI 对话时校验对方暗码完整性）
  - [x] SubTask 7.9: 编写与 `AIService.streamChatAPI` 的集成方案（多 AI 调用如何排队/并发、流式回调路由、错误重试）
  - [x] SubTask 7.10: 编写性能与并发控制（同时生成的 AI 角色数量上限、队列调度策略、超时处理、自动存档时机）

- [x] Task 8: 产出 `docs/werewolf-game/07-rule-system-design.md` 规则系统设计文档
  - [x] SubTask 8.1: 编写基础规则集（屠边局、7+4+5 阵营配比、夜间黑盒、晨间死亡判定、审判投票 2 票、首夜保护、身份鉴定力场、每房最多 2 人、单夜单杀等）
  - [x] SubTask 8.2: 编写扩展规则集清单（屠城局/双预言家/自爆狼/白狼王/混血儿/警上警下/聊爆判定等变体的规则说明）
  - [x] SubTask 8.3: 编写规则配置数据结构（TypeScript interface + JSON Schema 定义，含基础规则开关、扩展规则开关、阵营配比覆盖、技能分配策略）
  - [x] SubTask 8.4: 编写规则组合合法性校验（如"屠城局"与"7+4+5 配比"互斥、"双预言家"需调整阵营配比等冲突检测规则）
  - [x] SubTask 8.5: 编写胜利/失败条件矩阵（好人胜利：杀光所有伪装者；好人失败：伪装者杀光所有普通好人 或 杀光所有神民；屠边局与屠城局的胜负差异）
  - [x] SubTask 8.6: 编写规则配置 UI 流程（游戏开始前的规则选择页、预设规则包"标准屠边局"/"高速屠城局"/"双神民局"等快捷选择）
  - [x] SubTask 8.7: 编写与既有 `GameLocalConfig` 的集成方案（在 `GameLocalConfig` 中新增 `ruleSet` 字段，对齐既有配置存储模式）

## 阶段 3：UI/UX 与数据层设计（依赖阶段 2）

- [x] Task 9: 产出 `docs/werewolf-game/08-ui-ux-design.md` UI/UX 设计规范与线框图文档
  - [x] SubTask 9.1: 编写设计原则（信息密度/暗码不可见/阶段切换动效/响应式布局/无障碍）
  - [x] SubTask 9.2: 编写配色与字体规范（角色专属色取自规则文档样例、阵营色、证据色、证言色、状态色、Markdown 渲染样式）
  - [x] SubTask 9.3: 编写角色展示界面 ASCII 线框图（角色卡片网格、角色详情卡、状态徽标、暗码不可见说明）
  - [x] SubTask 9.4: 编写现场调查界面 ASCII 线框图（犯罪现场信息表 + 可搜索按钮清单 + 已收集证据面板 + 离开提示弹窗）
  - [x] SubTask 9.5: 编写证言讨论界面 ASCII 线框图（角色列表 + 当前质询角色 + 证言气泡 + 证物栏 + 威慑按钮 + 证言整理表）
  - [x] SubTask 9.6: 编写推理工作台界面 ASCII 线框图（证据池 + 证言池 + 推理画布 + 提交推理按钮 + 打分结果展示）
  - [x] SubTask 9.7: 编写投票与决策界面 ASCII 线框图（角色头像网格 + 投票按钮 + 玩家 2 票提示 + 实时票数展示 + 平票辩护流程 + 处刑方式选择）
  - [x] SubTask 9.8: 编写角色创建界面 ASCII 线框图（必填字段表单 + 选填字段折叠面板 + 暗码系统分配提示 + 预览 + 保存）
  - [x] SubTask 9.9: 编写地图导航界面 ASCII 线框图（楼层切换 + 当前楼层瓦片图 + 房间点击进入 + 角色位置标记 + 可搜索点位高亮）
  - [x] SubTask 9.10: 编写状态栏与日志面板 ASCII 线框图（顶部状态栏：游戏标题/天数/阶段/存档按钮/设置按钮/退出按钮；日志面板：可滚动的历史事件时间线）
  - [x] SubTask 9.11: 编写组件库选型映射（每个 UI 元素对应 antd 组件：Card/List/Button/Modal/Table/Form/Collapse/Tabs/Tag/Statistic 等）
  - [x] SubTask 9.12: 编写交互动效说明（流式叙事打字机效果、按钮 hover、证据拖拽到推理画布、异议弹窗震动、阶段切换淡入淡出）
  - [x] SubTask 9.13: 编写与既有 `GameMainPage` 框架的布局对接说明（顶部状态栏复用 `GameStateBar`、左侧叙事面板复用 `NarrativePanel`、右侧面板区按阶段动态切换）
  - [x] SubTask 9.14: 编写无障碍设计考量（键盘导航、屏幕阅读器友好、颜色对比度、字号可调）

- [x] Task 10: 产出 `docs/werewolf-game/09-database-design.md` 数据库结构设计文档
  - [x] SubTask 10.1: 编写存档目录结构（`data/game-saves/<saveId>/werewolf/` 下的文件清单与目录树）
  - [x] SubTask 10.2: 编写 `save.json` 元数据 Schema（存档 ID、游戏 ID、规则配置、当前阶段、当前天数、创建时间、最后更新时间、玩家身份）
  - [x] SubTask 10.3: 编写 `characters.json` 角色档案 Schema（角色 ID、档案字段、当前状态：存活/死亡/处刑/失踪、当前位置、当前好感度、当前已知信息列表）
  - [x] SubTask 10.4: 编写 `truth-script.json` 真相剧本 Schema（按夜存储，每夜含：夜间行动序列、击杀事件、技能发动、目击者、证据生成、证据销毁）
  - [x] SubTask 10.5: 编写 `evidence.json` 证据链 Schema（证据 ID、来源夜数、来源地点、发现方式、描述、关联角色、是否已被玩家收集、是否已被销毁）
  - [x] SubTask 10.6: 编写 `testimony.json` 证言表 Schema（证言 ID、角色 ID、对应夜数、陈述内容、出示的证据 ID、情绪标记、是否撒谎、矛盾点标注）
  - [x] SubTask 10.7: 编写 `votes.json` 投票记录 Schema（按审判场次存储，每场含：投票人、被投票人、票型、玩家 2 票标记、平票辩护记录、处刑结果）
  - [x] SubTask 10.8: 编写 `faction-codes.json` 暗码映射 Schema（角色 ID → 阵营代码 + 技能代码，全局持久化，初始化后不变）
  - [x] SubTask 10.9: 编写 `ai-contexts/<characterId>.json` AI 上下文快照 Schema（角色已知信息、近期对话、当前阶段任务、决策历史）
  - [x] SubTask 10.10: 编写与 `GameSaveRepository` 的集成方案（扩展 `GameSaveData` 接口，新增 `werewolf?: WerewolfSaveData` 字段）
  - [x] SubTask 10.11: 编写与 `GameTableRepository` 的表格 schema 映射（将哪些数据表对应到 `table-data.json` 的 sheets，便于复用 `applyTableEdits` 协议）
  - [x] SubTask 10.12: 编写数据版本与迁移策略（save.json 含 `schemaVersion` 字段，提供 v1→v2 迁移函数注册机制）
  - [x] SubTask 10.13: 编写自动存档轮转策略（每阶段切换时自动存档，保留最近 10 个自动存档，对齐既有 `GameSaveRepository` 的轮转模式）

## 阶段 4：工程化与提示词设计（依赖阶段 2/3）

- [x] Task 11: 产出 `docs/werewolf-game/10-file-directory-structure.md` 文件目录结构规划文档
  - [x] SubTask 11.1: 编写主进程服务目录规划（`src/main/services/game/templates/werewolf/` 下：JudgeService / CharacterContextService / EvidenceChainService / TestimonyService / VotingService / AiBehaviorService / TruthScriptService 等文件清单与职责）
  - [x] SubTask 11.2: 编写 IPC handler 目录规划（`src/main/ipc/handlers/game/werewolf/` 下：werewolfJudgeHandlers / werewolfInvestigationHandlers / werewolfTestimonyHandlers / werewolfVotingHandlers 等）
  - [x] SubTask 11.3: 编写渲染进程模板目录规划（`src/renderer/components/Game/templates/werewolf/` 下：WerewolfGameMain / WerewolfGameTemplate / werewolfSchema / werewolfInitialState / panels/* 等）
  - [x] SubTask 11.4: 编写共享类型与常量目录规划（`src/shared/types/werewolf.types.ts` / `src/shared/constants/werewolf.constants.ts`）
  - [x] SubTask 11.5: 编写默认游戏元数据目录规划（`data/games/werewolf_default/` 下：meta.json / characters/16 个角色 JSON / maps/prison.json / rules/standard.json）
  - [x] SubTask 11.6: 编写测试目录规划（`__tests__/` 子目录：每个服务对应一个测试文件，集成测试放在 `__tests__/integration/`）
  - [x] SubTask 11.7: 编写每个文件的职责说明（用表格列出文件路径 → 一句话职责 → 主要导出 → 依赖的既有模块）

- [x] Task 12: 产出 `docs/werewolf-game/11-core-module-division.md` 核心功能模块划分文档
  - [x] SubTask 12.1: 编写 8 大核心模块清单与一句话定位（法官调度器 / 阶段状态机 / 角色上下文管理器 / 证据链引擎 / 证言管理器 / 投票裁判 / AI 行为模拟器 / UI 模块映射）
  - [x] SubTask 12.2: 为每个模块编写输入输出接口定义（TypeScript interface 草案）
  - [x] SubTask 12.3: 编写模块间依赖图（ASCII 依赖图：哪些模块依赖哪些模块，避免循环依赖）
  - [x] SubTask 12.4: 编写模块与既有框架的复用关系（每个模块明确复用了 `add-game-mode-framework` 的哪些类/接口/组件）
  - [x] SubTask 12.5: 编写模块的测试策略（单元测试：每个服务的纯函数；集成测试：跨服务的状态机流程；e2e 测试：完整游戏循环）
  - [x] SubTask 12.6: 编写模块的开发优先级与并行度分析（法官调度器与阶段状态机为基础，可并行开发；角色上下文与 AI 行为模拟器依赖法官；UI 模块依赖所有服务模块）

- [x] Task 13: 产出 `docs/werewolf-game/12-judge-prompt-constraints.md` 法官提示词约束文档
  - [x] SubTask 13.1: 编写法官系统提示词模板（含最高核心指令：绝对保密禁令、事实证据导向、确保玩家体验三大约束的具体表述）
  - [x] SubTask 13.2: 编写暗码生成与维护规则（生成前先查询 `faction-codes.json` 确认真实阵营；输出时在姓名后紧贴插入 HTML 注释；正则校验规则）
  - [x] SubTask 13.3: 编写真相剧本生成 Prompt（含难度递增要求：每夜难度比前夜提升；犯罪手法完整性要求：必须保留至少 3 条可推理证据链；证据销毁边界：禁止完全毁灭关键证据）
  - [x] SubTask 13.4: 编写晨间播报 Prompt（命案播报格式、平安夜播报格式、封锁机制触发条件）
  - [x] SubTask 13.5: 编写现场调查按钮清单生成 Prompt（基于真相剧本生成可搜索点位清单，包含无关点位作为干扰项）
  - [x] SubTask 13.6: 编写证言整理 Prompt（基于角色已知信息生成证言，撒谎角色需符合其阵营利益，证言格式对齐证言表 Schema）
  - [x] SubTask 13.7: 编写庭前推理打分 Prompt（仅返回"优/良/中/差"四档，禁止其他信息；打分维度：证据使用正确率、推理逻辑链完整性、最终结论正确性）
  - [x] SubTask 13.8: 编写审判流程 Prompt（辩护顺序控制、禁止插话、投票统计、处刑执行、遗言生成）
  - [x] SubTask 13.9: 编写 AI 互检规则（法官生成回复前的自检清单：暗码完整性、信息泄露扫描、阵营暗示扫描）
  - [x] SubTask 13.10: 编写提示词版本管理与 A/B 测试方案（每个 Prompt 模板带版本号，支持运行时切换；A/B 测试：玩家可选不同版本的法官人格）
  - [x] SubTask 13.11: 编写与既有 `GamePromptBuilder` 的集成方式（扩展 `GamePromptBuilder` 支持狼人杀模板的 system prompt 拼装）

## 阶段 5：总结与导航（依赖阶段 1~4 全部完成）

- [x] Task 14: 产出 `docs/werewolf-game/13-design-summary.md` 策划阶段总结文档
  - [x] SubTask 14.1: 编写 14 份交付文档清单与摘要表（文档编号、标题、一句话摘要、字数估算）
  - [x] SubTask 14.2: 编写与 `add-game-mode-framework` 的 13 个对接点详表（对接点编号、对接的既有文件路径、对接方式：复用/扩展/新建、备注）
  - [x] SubTask 14.3: 编写识别的风险清单（AI 上下文隔离的实现难度、暗码一致性校验、多 AI 并发性能、真相剧本与证据链的同步、Prompt 注入攻击、玩家存档损坏恢复）
  - [x] SubTask 14.4: 编写开放问题清单（需用户决策的选项：是否引入 xstate 状态机库、是否支持多人在线模式、是否支持自定义案件剧本、首期是否实现全部扩展规则）
  - [x] SubTask 14.5: 编写下一阶段实现 spec 的拆分建议（建议拆为 5 个实现 spec：`implement-werewolf-judge-system` / `implement-werewolf-character-system` / `implement-werewolf-map-system` / `implement-werewolf-game-flow` / `implement-werewolf-ui`，每个 spec 的范围、依赖关系图、预估任务数）

- [x] Task 15: 产出 `docs/werewolf-game/README.md` 文档导航
  - [x] SubTask 15.1: 编写 14 份文档的标题与一句话简介表
  - [x] SubTask 15.2: 编写推荐阅读顺序（架构→法官→角色→地图→流程→AI→规则→UI→DB→目录→模块→提示词→总结）
  - [x] SubTask 15.3: 编写文档间依赖关系图（ASCII 依赖图：哪些文档依赖哪些文档）
  - [x] SubTask 15.4: 编写文档版本与维护说明（版本号规则、变更记录位置、负责人字段）
  - [x] SubTask 15.5: 编写与既有 `doc/10-game-mode-module.md` 的衔接关系（本策划文档作为 `doc/10` 的狼人杀章节延伸）
  - [x] SubTask 15.6: 编写快速索引表（按主题分类的文档索引，用户额外要求）
  - [x] SubTask 15.7: 标注 13-design-summary.md 状态为"待创建"、doc/10-game-mode-module.md 在仓库中尚未创建

## 阶段 6：策划阶段验收（依赖阶段 1~5 全部完成）

- [x] Task 16: 策划阶段自检与一致性校验
  - [x] SubTask 16.1: 校验 14 份文档的术语一致性（术语表 vs 各文档实际使用的术语）
  - [x] SubTask 16.2: 校验 14 份文档的数据结构一致性（如 `WerewolfCharacter` interface 在 03/09/11 文档中的定义是否一致）
  - [x] SubTask 16.3: 校验 14 份文档与既有框架对接点的路径准确性（所有引用的 `src/...` 路径是否真实存在）
  - [x] SubTask 16.4: 校验 14 份文档间的交叉引用链接有效性（相对路径链接是否指向正确的目标文档）
  - [x] SubTask 16.5: 校验策划阶段交付物边界（确认未修改任何 `src/` 下源代码，仅在 `docs/werewolf-game/` 与 `.trae/specs/design-werewolf-mystery-game/` 下创建文件）
  - [x] SubTask 16.6: 提交策划阶段成果给用户审核（通过 NotifyUser 通知用户审核 14 份文档）

# Task Dependencies

- Task 1（策划准备）是所有后续任务的前置
- Task 2（系统架构）依赖 Task 1，是 Task 3~8 的前置（提供术语表与全景图）
- Task 3（法官系统）、Task 4（角色系统）、Task 5（地图系统）、Task 6（游戏流程）、Task 7（AI 驱动）、Task 8（规则系统）依赖 Task 2，六大子系统文档可部分并行：
  - Task 3（法官）与 Task 7（AI 驱动）有强耦合（法官是 AI 驱动的核心），建议顺序执行或密切协同
  - Task 4（角色）、Task 5（地图）、Task 8（规则）相互独立，可完全并行
  - Task 6（流程）依赖 Task 3/4/5/8 的概念，建议最后执行
- Task 9（UI/UX）依赖 Task 3~8 全部完成（需要所有子系统的概念才能画线框图）
- Task 10（数据库）依赖 Task 3~8 全部完成（需要所有子系统的数据结构才能设计 Schema）
- Task 11（文件目录）依赖 Task 3~8 全部完成（需要所有服务模块才能规划目录）
- Task 12（模块划分）依赖 Task 3~8 全部完成（需要所有子系统才能划分模块）
- Task 13（提示词约束）依赖 Task 3（法官系统）完成
- Task 14（总结）依赖 Task 2~13 全部完成
- Task 15（README）依赖 Task 2~14 全部完成
- Task 16（自检）依赖 Task 2~15 全部完成

# 并行执行建议

- 阶段 1（Task 1~2）：串行，建立策划基线与架构总览
- 阶段 2（Task 3~8）：6 个子系统文档可部分并行，建议分 3 组：
  - 组 A：Task 3（法官）→ Task 7（AI 驱动）顺序执行
  - 组 B：Task 4（角色）、Task 5（地图）、Task 8（规则）完全并行
  - 组 C：Task 6（流程）最后执行，依赖组 A 与组 B 的概念
- 阶段 3（Task 9~10）：UI/UX 与数据库设计可并行
- 阶段 4（Task 11~13）：文件目录、模块划分、提示词约束可并行
- 阶段 5（Task 14~15）：总结与 README 顺序执行
- 阶段 6（Task 16）：自检串行

# 交付物清单

| 编号 | 文档路径 | 主要任务 |
| :--- | :--- | :--- |
| 01 | `docs/werewolf-game/01-system-architecture.md` | Task 2 |
| 02 | `docs/werewolf-game/02-judge-system-design.md` | Task 3 |
| 03 | `docs/werewolf-game/03-character-system-design.md` | Task 4 |
| 04 | `docs/werewolf-game/04-map-system-design.md` | Task 5 |
| 05 | `docs/werewolf-game/05-game-flow-design.md` | Task 6 |
| 06 | `docs/werewolf-game/06-ai-driving-mechanism.md` | Task 7 |
| 07 | `docs/werewolf-game/07-rule-system-design.md` | Task 8 |
| 08 | `docs/werewolf-game/08-ui-ux-design.md` | Task 9 |
| 09 | `docs/werewolf-game/09-database-design.md` | Task 10 |
| 10 | `docs/werewolf-game/10-file-directory-structure.md` | Task 11 |
| 11 | `docs/werewolf-game/11-core-module-division.md` | Task 12 |
| 12 | `docs/werewolf-game/12-judge-prompt-constraints.md` | Task 13 |
| 13 | `docs/werewolf-game/13-design-summary.md` | Task 14 |
| 14 | `docs/werewolf-game/README.md` | Task 15 |
