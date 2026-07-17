# 狼人杀推理游戏（融合狼人杀+弹丸论破+逆转裁判）策划阶段 Spec

## Why

`add-game-mode-framework` 已经交付了游戏模式的完整基础设施（模板注册中心、存档/读档、AI 叙事服务、ANSI 瓦片地图、表格持久化等）与首个文字模拟经营样本。其中 [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts) 仅为元数据占位，状态为 `PLANNED`，未实现任何面板与玩法。

用户需要基于既有游戏框架，策划一款融合狼人杀（阵营博弈+技能）+ 弹丸论破（学级裁判+处刑）+ 逆转裁判（证据/证言/威慑/异议）三大机制的 AI 驱动文字推理游戏。玩法剧本详见 [docs/逆转裁判+狼人杀规则.txt](file:///d:/AI/creative-cafe/docs/逆转裁判+狼人杀规则.txt)。

**当前阶段为游戏策划阶段**：本 Spec 仅产出设计与技术文档，不进行实际代码编写；所有交付物经用户审核通过后方可进入下一开发阶段（实现 spec）。

## What Changes

### 阶段定位
- **新增**：游戏策划阶段（Phase 0）—— 仅交付设计与技术文档，作为后续实现 spec 的输入与约束。
- **不修改**：不修改任何既有源代码（含 [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts) 占位状态）。
- **不创建**：不创建任何 `src/` 下的代码文件。

### 交付物（设计文档）
- **新增**：`docs/werewolf-game/01-system-architecture.md` —— 游戏系统架构设计文档（法官/角色/地图/流程/AI 驱动/规则六大子系统划分与依赖关系）
- **新增**：`docs/werewolf-game/02-judge-system-design.md` —— 法官 AI 系统设计文档（角色定位、提示词约束、二次监管机制、暗码标记协议、真相剧本生成规范）
- **新增**：`docs/werewolf-game/03-character-system-design.md` —— 角色系统设计文档（角色库机制、自定义角色创建/编辑/管理、阵营与技能分配、角色档案数据结构、暗码标记实现）
- **新增**：`docs/werewolf-game/04-map-system-design.md` —— 地图系统设计文档（箱庭式地图结构、自定义地图编辑、可搜索点位机制、房卡系统、监控覆盖规则）
- **新增**：`docs/werewolf-game/05-game-flow-design.md` —— 游戏流程设计文档（夜间行动/晨间结算/现场调查/证言收集/庭前推理/审判处刑/身份鉴定/日间活动 八大环节的状态机与交互设计）
- **新增**：`docs/werewolf-game/06-ai-driving-mechanism.md` —— AI 驱动机制设计文档（多 AI 角色上下文隔离方案、行为逻辑建模、对话生成、推理辅助、暗码全局一致性、真相剧本/证据链/证言三层数据隔离）
- **新增**：`docs/werewolf-game/07-rule-system-design.md` —— 规则系统设计文档（基础规则集、扩展规则集、规则组合配置、阵营配比、胜利/失败条件、首夜保护等可选规则）
- **新增**：`docs/werewolf-game/08-ui-ux-design.md` —— UI/UX 设计规范与线框图（角色展示界面、现场调查界面、证言讨论界面、推理界面、投票与决策界面、角色创建界面、地图导航界面、状态栏与日志面板）
- **新增**：`docs/werewolf-game/09-database-design.md` —— 数据库结构设计（游戏存档结构、角色档案表、真相剧本表、证据/证言/口供表、投票记录表、暗码映射表、AI 上下文快照表）
- **新增**：`docs/werewolf-game/10-file-directory-structure.md` —— 文件目录结构规划（`src/main/services/game/templates/werewolf/`、`src/renderer/components/Game/templates/werewolf/`、`data/games/werewolf/`、存档目录布局）
- **新增**：`docs/werewolf-game/11-core-module-division.md` —— 核心功能模块划分文档（法官调度器、阶段状态机、角色上下文管理器、证据链引擎、证言管理器、投票裁判、AI 行为模拟器、UI 模块映射）
- **新增**：`docs/werewolf-game/12-judge-prompt-constraints.md` —— 法官提示词约束文档（系统提示词模板、绝对保密禁令实现、事实证据导向校验、确保玩家体验校验、暗码生成与维护规则、真相剧本生成 Prompt、AI 互检规则）
- **新增**：`docs/werewolf-game/13-design-summary.md` —— 策划阶段总结文档（交付物清单、与既有框架的对接点、风险与开放问题、下一阶段实现 spec 的拆分建议）
- **新增**：`docs/werewolf-game/README.md` —— 策划阶段文档导航与阅读顺序

## Impact

- **Affected specs**：
  - 依赖 `add-game-mode-framework`（已完成）：复用 `GameTypeTemplate` 接口、`GameTemplateRegistry`、`GameNarrativeService`、`GameTableRepository`、`AnsiTileMap`、`GameSaveRepository`、`gameStore` / `gameUIStore` 等基础设施。
  - 为后续实现 spec（暂定 `implement-werewolf-game-phase-1` 等）提供设计与约束输入。
- **Affected code**：本阶段**不修改任何代码**。文档中将以引用形式指出后续需要修改/新增的代码位置，例如 [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts) 将在实现阶段替换占位实现。
- **Affected docs**：在 `docs/werewolf-game/` 下新增 14 份设计文档；不修改既有 `doc/` 或 `docs/` 目录下文件。
- **复用基础设施**：`AIService.streamChatAPI`、`GameTableEditParser`、`WritingTableData` 结构、`safeWriteFile` 模式、`tableEdit` 协议、antd 组件库、`react-markdown` + `rehype-raw`、`Zustand` store、`PageTransition` 动画。
- **依赖项**：本阶段不引入新 npm 包；实现阶段可能需要 `xstate`（状态机）或 `nanoid`（ID 生成），但需在实现 spec 中评估，本阶段仅做技术选型建议。

## ADDED Requirements

### Requirement: 策划阶段交付物边界
系统 SHALL 在策划阶段仅产出设计文档，不修改任何 `src/` 下的源代码，不创建任何代码文件，不更新 `WerewolfTemplate.ts` 的占位状态。所有文档放置于 `docs/werewolf-game/` 目录下。

#### Scenario: 策划阶段完成判定
- **WHEN** `docs/werewolf-game/` 下 14 份文档全部完成并经用户审核通过
- **THEN** 策划阶段结束，可进入实现 spec 阶段
- **AND** 实现阶段 spec 应基于本阶段文档进行任务拆分

#### Scenario: 文档与代码隔离
- **WHEN** 策划阶段执行过程中
- **THEN** 不得使用 Edit/Write 工具修改任何 `src/**/*.ts`、`src/**/*.tsx`、`src/**/*.css` 文件
- **AND** 仅允许在 `docs/werewolf-game/` 与 `.trae/specs/design-werewolf-mystery-game/` 下创建文件

### Requirement: 游戏系统架构设计文档
系统 SHALL 产出 `docs/werewolf-game/01-system-architecture.md`，描述六大子系统（法官/角色/地图/流程/AI 驱动/规则）的职责边界、模块依赖关系、与既有游戏框架的对接点、整体技术栈选型建议。

#### Scenario: 架构文档内容完备
- **WHEN** 阅读 `01-system-architecture.md`
- **THEN** 文档包含：系统全景图（六大子系统+用户+存档系统）、子系统职责矩阵、子系统间数据流向图、与 `add-game-mode-framework` 的复用清单、技术选型建议（含状态机方案、上下文隔离方案）、非功能性需求（性能/可维护性/可扩展性）、与既有 `doc/10-game-mode-module.md` 的衔接说明

### Requirement: 法官 AI 系统设计文档
系统 SHALL 产出 `docs/werewolf-game/02-judge-system-design.md`，详细描述法官 AI 的角色定位、行为边界、提示词约束体系、暗码标记协议、真相剧本生成规范、二次监管机制。

#### Scenario: 法官系统设计完备
- **WHEN** 阅读 `02-judge-system-design.md`
- **THEN** 文档包含：法官 AI 单例约束、法官职责清单（命令执行/角色模拟/信息记录/判定/打分）、法官禁止行为清单（不可引导玩家/不可暗示阵营/不可代替玩家决定）、暗码标记协议（`<!-- 好 -->` / `<!-- 伪 -->` / `<!-- 药/保/笨/黑 -->`）、真相剧本格式规范（时间/地点/手法/凶器/证据销毁/栽赃嫁祸/技能发动）、法官二次监管机制（如何校验法官是否泄露信息）、法官打分维度（好人存活数/经过天数/审判正确度）

### Requirement: 角色系统设计文档
系统 SHALL 产出 `docs/werewolf-game/03-character-system-design.md`，描述可扩展角色库机制、自定义角色创建/编辑/管理 UI 流程、阵营与技能分配算法、角色档案数据结构、暗码标记实现方案。

#### Scenario: 角色系统设计完备
- **WHEN** 阅读 `03-character-system-design.md`
- **THEN** 文档包含：角色档案数据结构（姓名/种族/来源/外观/身材/性格/生平/对话风格/文字颜色/初始物品/暗码）、16 人样例角色列表、阵营分配算法（7 普通好人+4 神民+5 伪装者，完全随机不可与外观/性格绑定）、4 种神民技能机制（药剂师/保安/笨蛋/黑客）、伪装者变形与共谋机制、自定义角色创建表单字段清单、角色编辑/导入/导出流程、与既有 `CharacterManager` 组件的复用关系

### Requirement: 地图系统设计文档
系统 SHALL 产出 `docs/werewolf-game/04-map-system-design.md`，描述箱庭式地图结构（4 层楼+16 单人牢房+12 公共区域）、自定义地图编辑器设计、可搜索点位机制、房卡与门禁系统、监控覆盖规则、与 `AnsiTileMap` 组件的对接。

#### Scenario: 地图系统设计完备
- **WHEN** 阅读 `04-map-system-design.md`
- **THEN** 文档包含：默认监狱地图的 4 层结构详表（F1~F4 的牢房编号/公共区域/交通系统）、单人牢房规格（结构/通讯/隐私安全）、房卡系统设计（绑定/丢失/记录/权限）、可搜索点位数据模型、自定义地图编辑器 UI 流程（楼层/房间/点位/连通关系）、监控覆盖矩阵（哪些区域有摄像头/哪些无）、与 `AnsiTileMap` 的瓦片映射规则、地图状态变更触发机制（封锁/解锁）

### Requirement: 游戏流程设计文档
系统 SHALL 产出 `docs/werewolf-game/05-game-flow-design.md`，描述八大环节的状态机与交互设计：夜间行动、晨间结算、现场调查、证言收集、庭前推理、审判处刑、身份鉴定、日间活动。

#### Scenario: 流程设计完备
- **WHEN** 阅读 `05-game-flow-design.md`
- **THEN** 文档包含：完整阶段状态机图（首夜保护→夜间→晨间→调查→证言→推理→审判→处刑→日间→夜间...）、各阶段的进入/退出条件、各阶段的 UI 操作类型（按钮选择式 vs 对话式 vs 表格式）、夜间黑盒机制（不记录明文，仅生成真相剧本）、晨间死亡判定与封锁机制、现场调查的可搜索按钮清单生成规则、证言收集的质询/出示证物/威慑机制（逆转裁判风格）、庭前推理的打分机制（优良中差）、审判的辩护/投票（玩家 2 票）/归票/处刑/平票处理、身份鉴定的医疗室力场机制、日间活动的自由探索与监控简报

### Requirement: AI 驱动机制设计文档
系统 SHALL 产出 `docs/werewolf-game/06-ai-driving-mechanism.md`，描述多 AI 角色上下文隔离方案、AI 行为逻辑建模、对话生成、推理辅助、暗码全局一致性、真相剧本/证据链/证言三层数据隔离。

#### Scenario: AI 驱动设计完备
- **WHEN** 阅读 `06-ai-driving-mechanism.md`
- **THEN** 文档包含：AI 上下文隔离架构（每角色独立 context，按需注入信息）、角色 AI 行为决策树（基于阵营+技能+已知信息）、伪装者 AI 行为策略（对跳/悍跳/金水/银水/查杀/反水/深水狼/倒钩狼/退水）、神民 AI 行为策略（药剂师救人/毒杀决策、保安反杀决策、笨蛋吸引火力、黑客保护高价值目标）、对话生成 Prompt 模板结构、暗码全局一致性保证方案（生成前先在后台确认真实阵营再附加暗码）、三层数据隔离（真相剧本/证据链/证言的可见范围矩阵）、AI 互检机制、与 `AIService.streamChatAPI` 的集成方案、性能与并发控制（多角色同时生成的队列/限流）

### Requirement: 规则系统设计文档
系统 SHALL 产出 `docs/werewolf-game/07-rule-system-design.md`，描述基础规则集、扩展规则集、规则组合配置、阵营配比、胜利/失败条件、首夜保护等可选规则。

#### Scenario: 规则系统设计完备
- **WHEN** 阅读 `07-rule-system-design.md`
- **THEN** 文档包含：基础规则集（屠边局、7+4+5 阵营配比、夜间黑盒、晨间死亡判定、审判投票 2 票、首夜保护、身份鉴定力场）、扩展规则集（可选的"屠城局"/"双预言家"/"自爆狼"/"白狼王"/"混血儿"等变体）、规则配置数据结构（JSON Schema）、规则组合合法性校验、胜利条件（杀光普通好人/杀光神民/票出所有伪装者）、失败条件、规则配置 UI 流程、与既有 `GameLocalConfig` 的集成方案

### Requirement: UI/UX 设计规范与线框图文档
系统 SHALL 产出 `docs/werewolf-game/08-ui-ux-design.md`，描述角色展示界面、现场调查界面、证言讨论界面、推理界面、投票与决策界面、角色创建界面、地图导航界面、状态栏与日志面板的设计规范与 ASCII/Markdown 线框图。

#### Scenario: UI/UX 设计完备
- **WHEN** 阅读 `08-ui-ux-design.md`
- **THEN** 文档包含：设计原则（信息密度/暗码不可见/阶段切换动效/响应式布局）、配色与字体规范（角色专属色、阵营色、证据色、证言色）、各界面的 ASCII 线框图（角色展示卡/现场调查按钮清单/证言表/证据面板/推理工作台/投票面板/角色创建表单/地图导航/状态栏）、组件库选型（antd 组件映射）、交互动效说明（流式叙事/按钮悬停/证据拖拽/异议弹窗）、与既有 `GameMainPage` 框架的布局对接（顶部状态栏/左侧叙事/右侧面板区）、无障碍设计考量

### Requirement: 数据库结构设计文档
系统 SHALL 产出 `docs/werewolf-game/09-database-design.md`，描述基于 JSON 文件的存档结构、角色档案表、真相剧本表、证据/证言/口供表、投票记录表、暗码映射表、AI 上下文快照表。

#### Scenario: 数据库设计完备
- **WHEN** 阅读 `09-database-design.md`
- **THEN** 文档包含：存档目录结构（`data/game-saves/<saveId>/werewolf/`）、各 JSON 文件的 Schema（save.json 元数据、characters.json 角色档案、truth-script.json 真相剧本按夜、evidence.json 证据链、testimony.json 证言表、votes.json 投票记录、faction-codes.json 暗码映射、ai-contexts/<characterId>.json AI 上下文快照）、与 `GameSaveRepository` 的集成方案、与 `GameTableRepository` 的表格 schema 映射、数据版本与迁移策略、自动存档轮转策略

### Requirement: 文件目录结构规划文档
系统 SHALL 产出 `docs/werewolf-game/10-file-directory-structure.md`，规划实现阶段的源码与数据目录布局。

#### Scenario: 目录结构规划完备
- **WHEN** 阅读 `10-file-directory-structure.md`
- **THEN** 文档包含：主进程服务目录（`src/main/services/game/templates/werewolf/` 下各服务文件清单）、IPC handler 目录（`src/main/ipc/handlers/game/werewolf/`）、渲染进程模板目录（`src/renderer/components/Game/templates/werewolf/`）、共享类型目录（`src/shared/types/werewolf.types.ts`）、共享常量目录（`src/shared/constants/werewolf.constants.ts`）、默认游戏元数据目录（`data/games/werewolf_default/`）、默认角色库目录（`data/games/werewolf_default/characters/`）、默认地图目录（`data/games/werewolf_default/maps/`）、测试目录（`__tests__/` 子目录规划）、每个文件的职责说明

### Requirement: 核心功能模块划分文档
系统 SHALL 产出 `docs/werewolf-game/11-core-module-division.md`，将整个游戏拆分为可独立开发与测试的核心模块。

#### Scenario: 模块划分完备
- **WHEN** 阅读 `11-core-module-division.md`
- **THEN** 文档包含：8 大核心模块（法官调度器 / 阶段状态机 / 角色上下文管理器 / 证据链引擎 / 证言管理器 / 投票裁判 / AI 行为模拟器 / UI 模块映射）、每个模块的输入输出接口、模块间依赖图、模块与既有框架的复用关系、模块的测试策略（单元/集成/e2e）、模块的开发优先级与并行度分析

### Requirement: 法官提示词约束文档
系统 SHALL 产出 `docs/werewolf-game/12-judge-prompt-constraints.md`，提供法官 AI 的完整提示词模板与约束规则。

#### Scenario: 提示词约束文档完备
- **WHEN** 阅读 `12-judge-prompt-constraints.md`
- **THEN** 文档包含：法官系统提示词模板（含最高核心指令：绝对保密禁令/事实证据导向/确保玩家体验）、暗码生成与维护规则、真相剧本生成 Prompt（含难度递增要求、犯罪手法完整性要求、证据销毁边界）、晨间播报 Prompt、现场调查按钮清单生成 Prompt、证言整理 Prompt、庭前推理打分 Prompt、审判流程 Prompt、AI 互检规则、提示词版本管理与 A/B 测试方案、与既有 `GamePromptBuilder` 的集成方式

### Requirement: 策划阶段总结文档
系统 SHALL 产出 `docs/werewolf-game/13-design-summary.md`，汇总策划阶段成果，列出与既有框架的对接点、风险与开放问题、下一阶段实现 spec 的拆分建议。

#### Scenario: 总结文档完备
- **WHEN** 阅读 `13-design-summary.md`
- **THEN** 文档包含：14 份交付文档清单与摘要、与 `add-game-mode-framework` 的 13 个对接点（含具体文件路径）、识别的风险（AI 上下文隔离的实现难度/暗码一致性校验/多 AI 并发生能/真相剧本与证据链的同步）、开放问题清单（需用户决策的选项）、下一阶段实现 spec 的拆分建议（建议拆为 `implement-werewolf-judge-system` / `implement-werewolf-character-system` / `implement-werewolf-map-system` / `implement-werewolf-game-flow` / `implement-werewolf-ui` 5 个实现 spec，含依赖关系图）

### Requirement: 文档导航 README
系统 SHALL 产出 `docs/werewolf-game/README.md`，作为策划阶段文档的导航入口，说明文档阅读顺序与文档间依赖关系。

#### Scenario: 导航 README 完备
- **WHEN** 阅读 `README.md`
- **THEN** 文档包含：14 份文档的标题与一句话简介、推荐阅读顺序（架构→法官→角色→地图→流程→AI→规则→UI→DB→目录→模块→提示词→总结）、文档间依赖关系图、文档版本与维护说明、与既有 `doc/10-game-mode-module.md` 的衔接关系

## MODIFIED Requirements

### Requirement: WerewolfTemplate 占位状态
本阶段**不修改** [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts) 的占位状态。文档 `13-design-summary.md` 中将明确指出：实现阶段需将该文件从占位替换为完整模板实现，作为第一个实现 spec 的入口任务。

修改前（策划阶段）：`WerewolfTemplate` 状态为 `GameStatus.PLANNED`，`panels: []`，`Component: PlaceholderGameMain`。
修改后（实现阶段，本阶段不执行）：`WerewolfTemplate` 状态改为 `GameStatus.IN_DEVELOPMENT`，`panels` 填充实际面板 key，`Component` 替换为 `lazy(() => import('./werewolf/WerewolfGameMain'))`。

## REMOVED Requirements

无移除项。本阶段为纯增量文档交付，不删除任何既有功能或文档。

## 非功能性约束

- **文档语言**：所有 14 份文档使用中文（与用户输入语言一致），代码示例使用 TypeScript（与既有项目一致）。
- **文档格式**：统一使用 Markdown，线框图使用 ASCII art 或 Markdown 表格，不引入图片文件（除非用户后续要求）。
- **文档长度**：每份文档控制在合理范围内（建议 200~600 行），避免冗余；跨文档引用使用相对路径链接。
- **文档一致性**：14 份文档间的术语、命名、数据结构必须一致；术语表统一在 `01-system-architecture.md` 末尾维护。
- **与既有框架对齐**：所有设计方案必须显式说明与 `add-game-mode-framework` 既有接口的对接方式，不得绕开既有基础设施重新造轮子。
