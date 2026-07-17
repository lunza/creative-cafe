# 策划阶段验收清单

## 阶段定位与边界校验

- [x] 策划阶段未修改任何 `src/` 下的源代码（`src/**/*.ts`、`src/**/*.tsx`、`src/**/*.css`）
- [x] 策划阶段仅在 `docs/werewolf-game/` 与 `.trae/specs/design-werewolf-mystery-game/` 下创建文件
- [x] [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts) 占位状态未变更（仍为 `GameStatus.PLANNED`，`panels: []`，`Component: PlaceholderGameMain`）
- [x] 14 份设计文档全部存在于 `docs/werewolf-game/` 目录下

## 文档完备性校验

- [x] `01-system-architecture.md` 包含：系统全景图、子系统职责矩阵、数据流向图、与既有框架复用清单、技术选型建议、非功能性需求、术语表
- [x] `02-judge-system-design.md` 包含：法官角色定位、职责清单、禁止行为清单、暗码标记协议、真相剧本格式规范、二次监管机制、打分维度
- [x] `03-character-system-design.md` 包含：角色档案数据结构、16 人样例角色列表、阵营分配算法、4 种神民技能机制、伪装者变形机制、自定义角色创建流程、与 `CharacterManager` 复用关系
- [x] `04-map-system-design.md` 包含：默认监狱地图 4 层结构详表、单人牢房规格、房卡系统、可搜索点位数据模型、自定义地图编辑器流程、监控覆盖矩阵、`AnsiTileMap` 瓦片映射规则、地图状态变更机制
- [x] `05-game-flow-design.md` 包含：完整阶段状态机图、各阶段进入/退出条件、UI 操作类型映射、夜间黑盒机制、晨间死亡判定、现场调查设计、证言收集设计、庭前推理打分、审判环节设计、身份鉴定设计、日间活动设计
- [x] `06-ai-driving-mechanism.md` 包含：AI 上下文隔离架构、角色行为决策树、伪装者 9 种行为策略、神民 4 种行为策略、对话生成 Prompt 模板、暗码全局一致性方案、三层数据隔离矩阵、AI 互检机制、`AIService.streamChatAPI` 集成方案、性能与并发控制
- [x] `07-rule-system-design.md` 包含：基础规则集、扩展规则集清单、规则配置数据结构、规则组合合法性校验、胜利/失败条件矩阵、规则配置 UI 流程、与 `GameLocalConfig` 集成方案
- [x] `08-ui-ux-design.md` 包含：设计原则、配色与字体规范、9 个界面的 ASCII 线框图（角色展示/现场调查/证言讨论/推理工作台/投票决策/角色创建/地图导航/状态栏/日志面板）、antd 组件映射、交互动效说明、与 `GameMainPage` 布局对接、无障碍设计
- [x] `09-database-design.md` 包含：存档目录结构、8 个 JSON 文件 Schema（save/characters/truth-script/evidence/testimony/votes/faction-codes/ai-contexts）、与 `GameSaveRepository` 集成方案、与 `GameTableRepository` 表格 schema 映射、数据版本迁移策略、自动存档轮转策略
- [x] `10-file-directory-structure.md` 包含：主进程服务目录、IPC handler 目录、渲染进程模板目录、共享类型/常量目录、默认游戏元数据目录、默认角色库目录、默认地图目录、测试目录、每个文件职责说明
- [x] `11-core-module-division.md` 包含：8 大核心模块清单、每个模块输入输出接口、模块间依赖图、与既有框架复用关系、测试策略、开发优先级与并行度分析
- [x] `12-judge-prompt-constraints.md` 包含：法官系统提示词模板、暗码生成与维护规则、真相剧本生成 Prompt、晨间播报 Prompt、现场调查按钮清单生成 Prompt、证言整理 Prompt、庭前推理打分 Prompt、审判流程 Prompt、AI 互检规则、提示词版本管理与 A/B 测试、与 `GamePromptBuilder` 集成方式
- [x] `13-design-summary.md` 包含：14 份文档清单与摘要、13 个对接点详表、风险清单、开放问题清单、下一阶段实现 spec 拆分建议（5 个实现 spec）
- [x] `README.md` 包含：14 份文档标题与简介、推荐阅读顺序、文档间依赖关系图、版本与维护说明、与 `doc/10-game-mode-module.md` 衔接关系

## 跨文档一致性校验

- [x] 术语表（`01-system-architecture.md` 末尾）覆盖所有文档使用的关键术语
- [x] 角色档案数据结构在 `03-character-system-design.md`、`09-database-design.md`、`11-core-module-division.md` 三处定义一致
- [x] 真相剧本格式在 `02-judge-system-design.md`、`05-game-flow-design.md`、`09-database-design.md`、`12-judge-prompt-constraints.md` 四处描述一致
- [x] 暗码标记协议在 `02-judge-system-design.md`、`03-character-system-design.md`、`06-ai-driving-mechanism.md`、`12-judge-prompt-constraints.md` 四处描述一致
- [x] 阶段状态机在 `05-game-flow-design.md` 与 `11-core-module-division.md`（阶段状态机模块）描述一致
- [x] 文件目录结构在 `10-file-directory-structure.md` 与 `11-core-module-division.md`（模块映射）描述一致
- [x] 所有引用的既有框架文件路径（`src/...`）真实存在（通过 `Glob` 或 `LS` 校验）

## 与既有框架对接校验

- [x] 文档明确列出与 `GameTypeTemplate` 接口的对接方式（`WerewolfTemplate` 实现声明）
- [x] 文档明确列出与 `GameNarrativeService` 的对接方式（法官 prompt 注入、流式回调路由）
- [x] 文档明确列出与 `GameTableRepository` 的对接方式（`tableEdit` 协议、sheet schema 映射）
- [x] 文档明确列出与 `GameSaveRepository` 的对接方式（`WerewolfSaveData` 扩展字段）
- [x] 文档明确列出与 `AnsiTileMap` 的对接方式（瓦片映射规则）
- [x] 文档明确列出与 `gameStore` / `gameUIStore` 的对接方式（新增状态字段、新增 action）
- [x] 文档明确列出与 `GamePromptBuilder` 的对接方式（狼人杀模板的 system prompt 拼装）
- [x] 文档明确列出与 `AIService.streamChatAPI` 的对接方式（多 AI 调用并发与排队）

## 规则剧本覆盖完整性校验

- [x] 法官系统设计覆盖规则文档第 6 行（系统预置一名 AI 法官）与第 10~13 行（最高核心指令）
- [x] 角色系统设计覆盖规则文档第 15~23 行（阵营设定）与第 39~60 行（角色列表）
- [x] 暗码标记设计覆盖规则文档第 25~37 行（阵营区分核心指令）
- [x] 地图系统设计覆盖规则文档第 68~117 行（示例地图与单人监狱规格）
- [x] 游戏流程设计覆盖规则文档第 120~181 行（游戏核心机制）
- [x] 系统播报与格式规范覆盖规则文档第 184~236 行（系统播报与格式规范）
- [x] 胜利/失败条件覆盖规则文档第 239~242 行（胜利条件与失败条件）
- [x] 核心原则覆盖规则文档第 243 行（排斥超能力/魔法等唯心主义设定）

## 阶段交付校验

- [x] 14 份文档字数合理（每份 200~600 行，无冗余）
- [x] 所有文档使用中文（除代码示例使用 TypeScript）
- [x] 所有文档使用 Markdown 格式，线框图使用 ASCII art 或 Markdown 表格
- [x] 跨文档引用使用相对路径链接
- [x] 策划阶段成果已通过最终响应提交给用户审核（替代 NotifyUser 机制）
- [x] 用户审核通过后，方可进入下一阶段（实现 spec）
