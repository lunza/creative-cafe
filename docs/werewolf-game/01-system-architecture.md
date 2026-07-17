# 01 - 狼人杀推理游戏系统架构设计

> 本文档是狼人杀推理游戏（融合狼人杀+弹丸论破+逆转裁判）策划阶段的总览文档，定义六大子系统职责边界、依赖关系、与既有游戏框架的对接方式，并维护全文档共用的术语表。

## 1. 背景与定位

### 1.1 项目定位
本游戏是 [Creative Cafe](file:///d:/AI/creative-cafe/README.md) 创作中心游戏模式下的第二款完整游戏，基于已交付的 [`add-game-mode-framework`](file:///d:/AI/creative-cafe/.trae/specs/add-game-mode-framework/spec.md) 基础设施开发。游戏融合三大经典机制：

| 来源 | 借鉴机制 | 在本游戏中的体现 |
| :--- | :--- | :--- |
| 狼人杀 | 阵营博弈、夜晚行动、神民技能、投票放逐 | 好人/伪装者阵营、药剂师/保安/笨蛋/黑客四大神民、夜间黑盒、审判投票 |
| 弹丸论破 | 学级裁判、处刑、黑白熊裁判 | 审判处刑环节、玩家作为裁判主导、处刑方式选择 |
| 逆转裁判 | 证据收集、证言质询、威慑、异议 | 现场调查按钮式搜索、证言质询与出示证物、庭前推理打分 |

### 1.2 玩家身份
玩家扮演 **典狱长**（预言家+警长双重身份），拥有：
- 电子面罩：隐藏面容与声音，内置私密频道向法官 AI 下达隐秘指令，自带无敌力场保护玩家不受伤害
- 万能房卡：可打开所有区域的最高权限房卡，无法被盗
- 预言家能力：每晚通过性接触方式识别一名角色的真实身份（鉴定结果绝对正确）
- 警长能力：审判环节拥有 2 票投票权

### 1.3 阶段定位
本策划阶段（Phase 0）仅产出设计与技术文档，不修改任何源代码。所有 14 份文档作为后续实现 spec 的输入与约束。

## 2. 系统全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Creative Cafe 应用                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │         既有游戏模式框架（add-game-mode-framework）             │  │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────────────┐       │  │
│  │  │ GameTpl    │ │ GameNarr   │ │ GameSaveRepository   │       │  │
│  │  │ Registry   │ │ Service    │ │ GameTableRepository  │       │  │
│  │  └─────┬──────┘ └─────┬──────┘ └──────────┬───────────┘       │  │
│  │        │              │                   │                   │  │
│  │  ┌─────┴──────┐ ┌─────┴──────┐ ┌──────────┴────────────┐      │  │
│  │  │ AIService  │ │ AnsiTileMap│ │ gameStore/UIStore     │      │  │
│  │  │ .streamChat│ │ (瓦片地图) │ │ (Zustand)             │      │  │
│  │  └─────┬──────┘ └────────────┘ └───────────────────────┘      │  │
│  └────────┼──────────────────────────────────────────────────────┘  │
│           │                                                          │
│  ┌────────┴───────────────────────────────────────────────────────┐ │
│  │            狼人杀推理游戏（werewolf）                            │ │
│  │                                                                  │ │
│  │   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                │ │
│  │   │ 01 法官│  │ 02 角色│  │ 03 地图│  │ 04 流程│                │ │
│  │   │  系统  │←→│  系统  │←→│  系统  │←→│  状态机│                │ │
│  │   └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘                │ │
│  │       └───────────┴───────────┴───────────┘                     │ │
│  │                   │                                              │ │
│  │   ┌───────────────┴──────────────┐  ┌────────────┐              │ │
│  │   │ 05 AI 驱动（上下文隔离）      │  │ 06 规则系统│              │ │
│  │   └───────────────────────────────┘  └────────────┘              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                       玩家（典狱长）                            │  │
│  │   预言家能力 + 警长 2 票 + 万能房卡 + 电子面罩无敌力场          │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 六大子系统职责矩阵

| 子系统 | 主要输入 | 主要输出 | 核心职责 | 严格禁止 |
| :--- | :--- | :--- | :--- | :--- |
| **01 法官系统** | 规则配置、真相剧本、玩家行动 | 系统播报、阶段切换指令、打分结果 | 命令执行、角色模拟、信息记录、判定、打分；维护暗码全局一致性 | 暗示阵营、引导玩家、代替玩家决定、代替玩家说话 |
| **02 角色系统** | 角色档案、阵营分配结果 | 角色状态、AI 行为决策、对话内容 | 角色库管理、阵营与技能分配、角色档案 CRUD、自定义角色创建 | 与外观/性格绑定阵营分配、用户指定暗码 |
| **03 地图系统** | 地图配置、角色位置、点位搜索请求 | 当前可访问区域、可搜索点位、监控画面 | 箱庭地图管理、房卡权限校验、可搜索点位生成、监控覆盖查询 | 单人牢房安装摄像头、绕过房卡权限 |
| **04 流程系统** | 阶段切换事件、规则配置 | 阶段状态、UI 操作类型、阶段过渡动画 | 八大阶段状态机、阶段进入/退出条件、阶段间数据传递 | 跳过强制阶段、违反状态机依赖 |
| **05 AI 驱动** | 角色上下文、当前阶段任务、已知信息 | AI 角色对话、行为决策、暗码附加 | 多 AI 上下文隔离、行为决策树、对话生成、并发控制 | 跨角色泄露信息、违反数据隔离矩阵 |
| **06 规则系统** | 用户规则选择、扩展规则开关 | 校验后的规则配置、胜负判定结果 | 基础/扩展规则集管理、规则组合合法性校验、胜负条件评估 | 运行时修改已生效规则、违反规则组合约束 |

## 4. 子系统间数据流向

### 4.1 单日完整数据流
```
[规则系统] ──初始化规则配置──→ [法官系统]
                                   │
                                   ▼
[夜间 00:00] [法官] 生成真相剧本 JSON（持久化，玩家不可见）
                                   │
                                   ▼
[晨间 06:00] [法官] 读取真相剧本 → 死亡判定 → 播报
                                   │
                                   ▼
[现场调查] [流程] 切换 UI 为按钮式 → [法官] 基于真相生成可搜索点位清单
              ↓                          ↓
         [玩家] 点击按钮搜索      [地图] 校验点位访问权限
              ↓                          ↓
         [法官] 返回证物描述      [角色] 更新已知信息
                                   │
                                   ▼
[证言收集] [流程] 切换 UI 为对话式 → [法官] 按角色已知信息生成证言
              ↓                          ↓
         [玩家] 质询/出示证物/威慑   [AI 驱动] 调用对应角色 AI 生成回复
              ↓                          ↓
         [法官] 整理证言表           [角色] 更新已知信息
                                   │
                                   ▼
[庭前推理] [流程] 切换 UI 为推理工作台 → [玩家] 提交推理
              ↓                          ↓
         [法官] 基于真相打分（优良中差）→ 通知审判
                                   │
                                   ▼
[审判处刑] [流程] 切换 UI 为投票面板 → [AI 驱动] 各 AI 角色生成辩护
              ↓                          ↓
         [玩家+AI] 投票（玩家 2 票）  [法官] 归票统计
              ↓                          ↓
         [法官] 处刑执行 + 遗言生成   [角色] 更新死亡状态
                                   │
                                   ▼
[日间活动] [流程] 切换 UI 为自由探索 → [AI 驱动] 各 AI 角色自由行动
              ↓                          ↓
         [玩家] 监控调取/移动/互动   [法官] 日间行为简报
                                   │
                                   ▼
[下一夜 00:00] 循环 → 直到胜利/失败条件触发
```

### 4.2 数据隔离层级
| 层级 | 可见对象 | 持久化位置 | 说明 |
| :--- | :--- | :--- | :--- |
| 真相剧本层 | 仅法官 AI | `truth-script.json` | 每夜击杀/技能/证据销毁的完整真相，玩家与其他 AI 均不可见 |
| 证据链层 | 玩家 + 法官 | `evidence.json` | 现场调查收集的证据；AI 角色仅在玩家出示后可见 |
| 证言层 | 玩家 + 法官 + 已询问角色 | `testimony.json` | 各角色的证言记录；未询问角色不可见 |
| 暗码层 | 仅法官 AI | `faction-codes.json` | 角色 ID → 阵营代码的映射，初始化后不变 |
| AI 上下文层 | 各角色独立 | `ai-contexts/<characterId>.json` | 每角色的已知信息、近期对话、决策历史 |

## 5. 与既有框架的复用清单

| 既有模块 | 文件路径 | 复用方式 | 说明 |
| :--- | :--- | :--- | :--- |
| `GameTypeTemplate` 接口 | [src/shared/types/game.types.ts](file:///d:/AI/creative-cafe/src/shared/types/game.types.ts) | 实现 | 狼人杀模板需实现该接口，替换 [WerewolfTemplate.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/WerewolfTemplate.ts) 占位 |
| `GameTemplateRegistry` | [src/renderer/components/Game/templates/GameTemplateRegistry.ts](file:///d:/AI/creative-cafe/src/renderer/components/Game/templates/GameTemplateRegistry.ts) | 注册 | 在初始化时注册狼人杀模板 |
| `GameNarrativeService` | [src/main/services/game/GameNarrativeService.ts](file:///d:/AI/creative-cafe/src/main/services/game/GameNarrativeService.ts) | 扩展 | 注入法官 system prompt，复用流式回调与 tableEdit 解析 |
| `GamePromptBuilder` | [src/main/services/game/GamePromptBuilder.ts](file:///d:/AI/creative-cafe/src/main/services/game/GamePromptBuilder.ts) | 扩展 | 新增狼人杀模板的 system prompt 拼装逻辑 |
| `GameTableRepository` | [src/main/services/game/GameTableRepository.ts](file:///d:/AI/creative-cafe/src/main/services/game/GameTableRepository.ts) | 复用 | 复用 `applyTableEdits` 协议，新增狼人杀 sheet schema |
| `GameSaveRepository` | [src/main/services/game/GameSaveRepository.ts](file:///d:/AI/creative-cafe/src/main/services/game/GameSaveRepository.ts) | 扩展 | 在 `GameSaveData.stateSnapshot` 中新增 `werewolf` 字段 |
| `AnsiTileMap` | [src/renderer/components/Game/AnsiTileMap.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Game/AnsiTileMap.tsx) | 复用 | 渲染 4 层楼瓦片地图，新增狼人杀瓦片样式映射 |
| `AIService.streamChatAPI` | [src/main/services/AIService.ts](file:///d:/AI/creative-cafe/src/main/services/AIService.ts) | 复用 | 多 AI 角色调用入口，需新增并发控制包装 |
| `gameStore` | [src/renderer/stores/gameStore.ts](file:///d:/AI/creative-cafe/src/renderer/stores/gameStore.ts) | 扩展 | 新增狼人杀专属状态字段与 action |
| `gameUIStore` | [src/renderer/stores/gameUIStore.ts](file:///d:/AI/creative-cafe/src/renderer/stores/gameUIStore.ts) | 扩展 | 新增狼人杀阶段视图状态 |
| `GameMainPage` 框架 | [src/renderer/components/Game/GameMainPage.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Game/GameMainPage.tsx) | 复用 | 顶部状态栏 + 左侧叙事面板 + 右侧模板面板区布局 |
| `NarrativePanel` | [src/renderer/components/Game/panels/NarrativePanel.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/NarrativePanel.tsx) | 复用 | 流式叙事显示与玩家输入 |
| `GameStateBar` | [src/renderer/components/Game/panels/GameStateBar.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Game/panels/GameStateBar.tsx) | 复用 | 顶部状态栏，扩展显示天数/阶段 |
| `tableEdit` 协议 | [src/main/services/game/GameTableEditParser.ts](file:///d:/AI/creative-cafe/src/main/services/game/GameTableEditParser.ts) | 复用 | AI 回复末尾的表格操作命令解析 |
| `safeWriteFile` 模式 | 既有工具 | 复用 | JSON 文件原子写入 |
| `react-markdown` + `rehype-raw` | 既有依赖 | 复用 | 叙事文本的 Markdown 渲染（含 HTML 注释暗码） |
| antd 组件库 | 既有依赖 | 复用 | Card/List/Button/Modal/Table/Form/Collapse 等 |
| `PageTransition` | [src/renderer/components/Layout/PageTransition.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Layout/PageTransition.tsx) | 复用 | 阶段切换动画 |

## 6. 技术选型建议

### 6.1 阶段状态机方案
| 方案 | 优点 | 缺点 | 建议 |
| :--- | :--- | :--- | :--- |
| **xstate** | 状态机可视化、状态迁移严格、易测试 | 引入新依赖、学习成本 | 中等规模游戏推荐 |
| **自实现状态机** | 无依赖、灵活、与既有代码风格一致 | 易遗漏边界条件、缺乏可视化 | 小规模状态机推荐 |
| **Redux Toolkit reducer** | 与既有 Zustand 风格接近 | 状态机语义弱 | 不推荐 |

**建议**：采用自实现状态机方案，定义 `WerewolfPhase` 枚举与 `phaseTransitions` 转移表，避免引入 xstate 依赖。状态机逻辑集中在前端 store，主进程仅负责数据持久化。

### 6.2 多 AI 上下文隔离方案
| 方案 | 优点 | 缺点 | 建议 |
| :--- | :--- | :--- | :--- |
| **单次调用 + 完整重建** | 实现简单、无持久化负担 | token 消耗大、长对话易丢失上下文 | 不推荐 |
| **持久化 context 文件** | 上下文连续、可断点续传 | 文件管理复杂、需考虑 token 上限 | 推荐 |
| **向量检索 RAG** | 长期记忆好、token 节省 | 引入向量依赖、检索质量不确定 | 后期优化 |

**建议**：采用持久化 context 文件方案，每角色独立 `ai-contexts/<characterId>.json`，存储：已知信息列表、近期对话（最近 20 轮）、当前阶段任务。每次调用 AI 时按规则注入对应角色的 context 片段。

### 6.3 多 AI 并发方案
| 方案 | 优点 | 缺点 | 建议 |
| :--- | :--- | :--- | :--- |
| **串行调用** | 简单、无并发问题 | 慢、玩家等待时间长 | 不推荐 |
| **并行调用（无限制）** | 快 | API 限流、token 消耗集中 | 不推荐 |
| **有界并发（推荐 3）** | 平衡速度与限流 | 实现稍复杂 | 推荐 |

**建议**：实现有界并发队列，同时最多 3 个 AI 角色调用 `AIService.streamChatAPI`，超过则排队。每个调用独立 abortSignal，支持取消。

## 7. 非功能性需求

### 7.1 性能
- **AI 调用并发上限**：同时 3 个角色 AI 调用，超过排队
- **流式响应延迟**：首 token < 2 秒，完整回复 < 30 秒
- **存档写入**：每次自动存档 < 500ms
- **地图渲染**：ANSI 瓦片图首屏 < 200ms
- **多 AI 同时生成**：审判辩护环节 16 角色，分批 3 个一组，总时长 < 5 分钟

### 7.2 可维护性
- **文档与代码同步**：本策划文档与实现代码一一对应，文档变更需同步代码注释
- **类型单一真源**：所有共享类型定义在 [src/shared/types/werewolf.types.ts](file:///d:/AI/creative-cafe/src/shared/types/werewolf.types.ts)
- **常量单一真源**：所有共享常量定义在 [src/shared/constants/werewolf.constants.ts](file:///d:/AI/creative-cafe/src/shared/constants/werewolf.constants.ts)
- **测试覆盖**：核心服务单元测试覆盖率 ≥ 80%，状态机流程集成测试覆盖所有阶段转移

### 7.3 可扩展性
- **新规则包**：通过 `data/games/<gameId>/rules/<ruleSetId>.json` 接入，无需修改代码
- **新角色包**：通过 `data/games/<gameId>/characters/<characterId>.json` 接入，无需修改代码
- **新地图包**：通过 `data/games/<gameId>/maps/<mapId>.json` 接入，无需修改代码
- **新案件剧本**：通过 `data/games/<gameId>/scripts/<scriptId>.json` 接入，无需修改代码
- **新阶段类型**：通过扩展 `WerewolfPhase` 枚举与 `phaseTransitions` 转移表，需修改状态机代码

### 7.4 安全性
- **暗码不可见**：HTML 注释在渲染时被 `react-markdown` 自动隐藏，但需校验 AI 输出不泄露暗码明文
- **存档隔离**：不同存档的数据严格隔离，禁止跨存档读取
- **AI 上下文隔离**：禁止在 AI 调用时注入其他角色的 context
- **Prompt 注入防护**：玩家输入需经过转义后注入 AI prompt，防止注入攻击

## 8. 与既有文档的衔接

### 8.1 与 doc/10-game-mode-module.md 的衔接
本策划文档作为 [doc/10-game-mode-module.md](file:///d:/AI/creative-cafe/doc/10-game-mode-module.md) 的狼人杀章节延伸，遵循既有文档的章节结构：
- 模块功能描述 → 对应 01-system-architecture.md
- 组件树 → 对应 11-core-module-division.md
- IPC 接口表 → 对应 10-file-directory-structure.md
- 表格 schema → 对应 09-database-design.md
- AI prompt 构建流程 → 对应 12-judge-prompt-constraints.md
- 扩展指南 → 对应 13-design-summary.md

### 8.2 文档间依赖关系
```
01-architecture（基础）
   ├─→ 02-judge（法官）
   │     └─→ 12-prompt-constraints（提示词）
   ├─→ 03-character（角色）
   ├─→ 04-map（地图）
   ├─→ 07-rule（规则）
   ├─→ 06-ai-driving（AI 驱动）← 依赖 02-judge
   ├─→ 05-game-flow（流程）← 依赖 02/03/04/07
   ├─→ 08-ui-ux（UI）← 依赖 02~07
   ├─→ 09-database（数据库）← 依赖 02~07
   ├─→ 10-file-directory（目录）← 依赖 02~07
   └─→ 11-module-division（模块）← 依赖 02~07
         └─→ 13-summary（总结）← 依赖全部
               └─→ README（导航）← 依赖全部
```

## 9. 术语表

本术语表为全文档共用，所有 14 份文档需严格遵循以下术语定义。

### 9.1 角色与阵营
| 术语 | 定义 |
| :--- | :--- |
| **典狱长** | 玩家扮演的角色，拥有预言家+警长双重身份，拥有万能房卡与电子面罩 |
| **普通好人** | 好人阵营中无特殊技能的角色，对应狼人杀的村民 |
| **神民** | 好人阵营中拥有特殊技能的角色，包括药剂师/保安/笨蛋/黑客四种 |
| **伪装者** | 狼人阵营的角色，能变形模拟好人，对应狼人杀的狼人 |
| **药剂师** | 神民之一，对应狼人杀的女巫，拥有强心剂与毒药 |
| **保安** | 神民之一，对应狼人杀的猎人，被杀或被处刑时可反杀 |
| **笨蛋** | 神民之一，对应狼人杀的白痴，得票过半不出局，触发临时休庭 |
| **黑客** | 神民之一，对应狼人杀的守卫，每晚可生成全息影像保护一名角色 |
| **法官 AI** | 系统预置的唯一 AI 法官，负责命令执行、角色模拟、信息记录、判定、打分 |

### 9.2 游戏阶段
| 术语 | 定义 |
| :--- | :--- |
| **夜间** | 每日 00:00-06:00，系统黑盒，仅生成真相剧本，玩家不可见 |
| **晨间结算** | 每日 06:00，进行死亡判定与封锁机制 |
| **现场调查** | 命案发生后，玩家通过按钮点击搜索现场可搜索点位 |
| **证言收集** | 玩家质询 AI 角色，可出示证物与威慑，类似逆转裁判 |
| **庭前推理** | 玩家基于证物表与证言表提交推理，法官打分优良中差 |
| **审判处刑** | 所有角色辩护后投票，玩家拥有 2 票，得票最高者处刑 |
| **身份鉴定** | 玩家在医疗室通过性接触识别角色真实身份，结果绝对正确 |
| **日间活动** | 审判处刑后至下一夜的自由探索阶段，监控全覆盖 |
| **平安夜** | 夜间未发生命案的情况，跳过现场调查直接进入审判 |

### 9.3 数据与机制
| 术语 | 定义 |
| :--- | :--- |
| **真相剧本** | 法官 AI 每夜生成的完整犯罪过程记录，包含时间/地点/凶手/被害人/手法/凶器/证据销毁/栽赃嫁祸/技能发动/目击者，玩家不可见 |
| **证据链** | 现场调查收集的证据集合，存储于 evidence.json，玩家与法官可见 |
| **证言** | AI 角色在证言收集环节的陈述，存储于 testimony.json |
| **暗码** | 紧贴角色姓名末尾插入的 HTML 注释，标识阵营与技能，如 `<!-- 好 -->` / `<!-- 伪 -->` / `<!-- 药 -->`，玩家不可见但法官全局维护 |
| **房卡** | 角色在监狱内的唯一凭证，能开启房门、进入公共区域、领取物资、使用电脑 |
| **金水** | 被预言家查验为好人的角色，为最高身份 |
| **银水** | 被伪装者击杀过但由于药剂师或黑客营救未死的角色 |
| **查杀** | 预言家直接指认某人为伪装者 |
| **对跳/悍跳** | 伪装者主动冒充神民身份 |
| **倒钩狼/深水狼** | 伪装者采取低调策略或指认队友策略 |
| **退水** | 冒充神民者遭到质疑后放弃身份 |

### 9.4 状态与判定
| 术语 | 定义 |
| :--- | :--- |
| **存活** | 角色当前状态为存活，可参与所有阶段 |
| **死亡** | 角色被伪装者夜间击杀，进入死亡状态 |
| **处刑** | 角色被审判投票出局，进入处刑状态 |
| **失踪** | 角色被药剂师救走移送医疗室，当晚记忆丢失 |
| **力场** | 医疗室特殊床位的保护力场，每天一次充能，鉴定需消耗充能 |
| **封锁** | 命案发生后系统拉响警报，所有角色被强制禁闭于所在区域 |

### 9.5 系统组件
| 术语 | 定义 |
| :--- | :--- |
| **法官调度器** | 核心模块之一，负责协调法官 AI 的命令执行与阶段切换 |
| **阶段状态机** | 核心模块之一，管理八大阶段的状态转移 |
| **角色上下文管理器** | 核心模块之一，维护各 AI 角色的独立上下文 |
| **证据链引擎** | 核心模块之一，管理证据的生成、收集、销毁、展示 |
| **证言管理器** | 核心模块之一，管理证言的生成、整理、矛盾点标注 |
| **投票裁判** | 核心模块之一，管理投票、归票、平票处理、处刑执行 |
| **AI 行为模拟器** | 核心模块之一，基于角色阵营与已知信息生成行为决策 |
| **UI 模块映射** | 核心模块之一，将阶段状态映射到对应的 UI 组件 |

## 10. 后续文档导航

| 编号 | 文档 | 主要内容 |
| :--- | :--- | :--- |
| 02 | [法官 AI 系统设计](./02-judge-system-design.md) | 法官角色定位、暗码协议、真相剧本格式、二次监管 |
| 03 | [角色系统设计](./03-character-system-design.md) | 角色档案、阵营分配、神民技能、自定义角色创建 |
| 04 | [地图系统设计](./04-map-system-design.md) | 4 层楼地图、房卡系统、可搜索点位、监控覆盖 |
| 05 | [游戏流程设计](./05-game-flow-design.md) | 八大阶段状态机、UI 操作类型、阶段间数据传递 |
| 06 | [AI 驱动机制](./06-ai-driving-mechanism.md) | 上下文隔离、行为决策树、伪装者/神民策略 |
| 07 | [规则系统设计](./07-rule-system-design.md) | 基础/扩展规则集、规则配置、胜负条件 |
| 08 | [UI/UX 设计](./08-ui-ux-design.md) | 线框图、配色规范、antd 组件映射 |
| 09 | [数据库设计](./09-database-design.md) | 存档结构、JSON Schema、表格映射 |
| 10 | [文件目录结构](./10-file-directory-structure.md) | 源码目录、数据目录、测试目录规划 |
| 11 | [核心模块划分](./11-core-module-division.md) | 8 大模块接口、依赖图、测试策略 |
| 12 | [法官提示词约束](./12-judge-prompt-constraints.md) | 系统 prompt 模板、暗码生成规则、AI 互检 |
| 13 | [策划阶段总结](./13-design-summary.md) | 交付物清单、风险、下一阶段 spec 拆分 |
| 14 | [README 导航](./README.md) | 阅读顺序、依赖关系图 |
