# 游戏模式模块 (Game Mode Module) 技术文档

> 模块路径: `src/renderer/components/Game/`、`src/main/services/game/`、`src/main/ipc/handlers/game/`
> 源码文件: 见各章节"涉及文件"
> 支撑文件: `src/shared/types/game.types.ts`、`src/shared/constants/game.constants.ts`、`src/renderer/stores/gameStore.ts`、`src/renderer/stores/gameUIStore.ts`

---

## 1. 模块功能描述

游戏模式是 Creative Cafe 应用的**AI 驱动纯文字冒险游戏平台**，为用户提供基于大语言模型的交互式文字游戏体验。系统通过流式 AI 叙事、状态表格自动维护、ANSI 瓦片渲染等机制，让用户在大厅选择游戏 → 进入详情页 → 创建存档 → 与 AI 进行多回合剧情交互的完整游戏循环。

### 核心能力

| 能力 | 描述 |
|------|------|
| **多游戏类型支持** | 通过 `GameType` 枚举声明 5 种游戏类型（WEREWOLF / MYSTERY / DATING_SIM / MANAGEMENT / TEXT_RPG），每种类型对应一个 `GameTypeTemplate` 实现 |
| **AI 流式叙事生成** | 调用 `AIService.streamChatAPI` 流式生成剧情文本，通过 IPC 事件 `game:narrative:chunk` 实时推送给渲染进程 |
| **tableEdit 协议自动维护状态** | AI 在叙事文本末尾通过 `<tableEdit>` 标签输出 insertRow / updateRow / deleteRow 命令，主进程解析后自动应用到表格数据，无需用户手动维护 |
| **多存档管理** | 单个游戏可拥有多个手动存档 + 自动存档（保留最近 5 个），存档包含剧情日志、表格快照、自定义状态快照三部分 |
| **版本快照机制** | `GameTableRepository` 提供 `saveVersionSnapshot` / `confirmVersion` / `rollbackVersion`，支持表格数据回滚预览与撤销 |
| **ANSI 字符瓦片渲染** | `AnsiTileMap` 组件通过 CSS Grid 渲染字符矩阵，支持 ANSI SGR 转义序列解析（前景/背景色、加粗），用于 ASCII 风格的场景地图 |
| **可扩展模板体系** | 新增游戏类型只需实现 `GameTypeTemplate` 接口并注册到 `GameTemplateRegistry`，无需修改框架代码 |
| **本地配置与 ANSI 主题** | 每个游戏独立的 `GameLocalConfig`（AI 引擎选择、温度、最大 token、表格整理模式、ANSI 主题、自动存档开关） |

### 操作类型

- **大厅浏览操作**: 列表筛选（按类型）、搜索（按标题/副标题/标签）、排序（最近更新/创建时间/名称）
- **游戏元数据操作**: 创建新游戏、更新游戏元数据、删除游戏
- **存档操作**: 创建存档、读取存档、列出存档、删除存档、更新存档
- **游戏运行时操作**: 通过 `userAction` 字符串触发 AI 叙事生成（如 `build:farm` / `recruit:farmer` / `end_turn` / 自由文本）
- **表格数据操作**: 读取、保存、应用 tableEdit 命令、版本快照确认/回滚
- **配置操作**: 读取/保存本地配置、取消生成请求

### 用户交互场景

1. 用户从创作中心点击"游戏"面板进入游戏大厅
2. 在大厅浏览游戏卡片，按类型筛选或搜索关键字
3. 点击卡片进入详情页，查看游戏详细介绍与玩法说明
4. 点击"开始游戏"创建新存档，或点击"读取存档"加载历史存档
5. 进入主页面，左侧叙事面板流式显示 AI 生成的剧情，右侧模板面板区显示游戏专属状态（资源/设施/统计等）
6. 玩家通过点击按钮或输入自由文本触发 `userAction`，AI 流式响应并自动更新表格
7. 每回合结束自动存档，退出后可通过"读取存档"恢复

### 功能边界

- 游戏模式**不直接**修改创作中心其他模块（对话模式/写作模式）的状态，通过独立的 `gameStore` / `gameUIStore` 管理状态
- 游戏元数据存储路径与角色卡/世界书等其他模块独立（`data/games/` 与 `data/game-saves/`）
- AI 引擎复用 `settingStore.aiEngines`，不单独维护模型配置
- ANSI 瓦片渲染组件 (`AnsiTileMap`) 是通用组件，可被任意模板复用，不耦合特定游戏类型

---

## 2. 模块定位与业务价值

### 战略角色

游戏模式在整体系统架构中扮演**互动叙事游戏平台（Interactive Narrative Game Platform）**角色，与对话模式、写作模式并列作为创作中心的第三个核心模式：

```
┌─────────────────────────────────────────────────────────────┐
│                    CreationCenter                            │
│  ┌──────────────┬──────────────┬──────────────┐            │
│  │   Chat 对话   │   Writing    │   Game 游戏   │ ← 三大模式  │
│  │   (角色扮演)   │   (长篇创作)  │   (互动叙事)  │            │
│  └──────────────┴──────────────┴──────────────┘            │
│  ┌────────────────────────────────────────────┐            │
│  │   统一支撑：AIService / tableEdit 协议 /     │            │
│  │   vector 检索 / Settings / 日志              │            │
│  └────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                            ↓ 共享底座
┌─────────────────────────────────────────────────────────────┐
│              Main Process Services                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐  │
│  │ character │ │ worldBook│ │ writing table │ │ game     │  │
│  │  dialogue │ │          │ │  repository   │ │ services │  │
│  └──────────┘ └──────────┘ └──────────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **AI 输出难以结构化持久化**：通过 tableEdit 协议让 AI 在叙事末尾自动输出表格命令，配合 `GameTableRepository.applyTableEdits` 自动应用，玩家无需手动记录游戏状态
2. **多游戏类型难以统一框架**：通过 `GameTypeTemplate` 接口抽象不同游戏类型的差异（panels / tableSchema / Component / 状态序列化），框架层与具体游戏类型解耦
3. **存档状态分散难以恢复**：将存档拆分为 `save.json`（剧情日志+元数据）、`tables/table-data.json`（结构化状态）、`state-snapshot.json`（模板自定义状态）三部分，加载时合并恢复
4. **流式生成中断后无法续传**：通过 `game:cancelGeneration` IPC + `AbortController` 支持单存档级别的生成取消，并提供 `abortAllActiveGameRequests()` 用于应用退出场景
5. **不同游戏类型的 prompt 差异显著**：通过 `templateSystemPrompt` 字段将模板专属规则注入到通用 `GamePromptBuilder` 输出末尾的【模板额外规则】段，避免修改通用 prompt builder

### 目标用户群体

- **单机文字冒险玩家**: 享受 AI 驱动的非线性剧情体验
- **经营/策略游戏爱好者**: 喜欢资源管理、设施建造、回合结算的玩法
- **AI 创作实验者**: 探索 LLM 在互动叙事场景的能力边界
- **未来游戏类型开发者**: 通过模板接口扩展新的游戏类型（狼人杀/恋爱模拟/文字 RPG 等）

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                      渲染进程 (Renderer)                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     GameModeEntry 容器                       │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐  │  │
│  │  │ GameLobby│  │ GameDetailPage│  │    GameMainPage        │  │  │
│  │  │  (大厅)   │  │  (详情页)     │  │ ┌──────────┬─────────┐│  │  │
│  │  └──────────┘  └──────────────┘  │ │Narrative │Template  ││  │  │
│  │                                  │ │ Panel    │Component ││  │  │
│  │                                  │ └──────────┴─────────┘│  │  │
│  │                                  └────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                  ↓ Zustand 订阅                     │
│  ┌────────────────────────┐  ┌────────────────────────────────┐   │
│  │  gameStore              │  │  gameUIStore                   │   │
│  │  - games[]              │  │  - currentView                 │   │
│  │  - currentGame          │  │  - panelCollapsed              │   │
│  │  - currentSaveId        │  │  - ansiTheme                   │   │
│  │  - narrativeLog[]       │  │  - scrollPosition              │   │
│  │  - tableData            │  │  - show*Dialog                 │   │
│  │  - isGenerating         │  └────────────────────────────────┘   │
│  └────────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓ IPC (preload.game.*)
┌─────────────────────────────────────────────────────────────────────┐
│                      主进程 (Main)                                   │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                  IPC Handlers (game/*Handlers.ts)               │ │
│  │  gameMetaHandlers  gameSaveHandlers  gameTableHandlers         │ │
│  │  gameNarrativeHandlers  gameConfigHandlers                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                  ↓ 调用                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                  Services (game/*.ts)                           │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐│ │
│  │  │GameRepository│ │GameSaveRepo  │ │GameTableRepository      ││ │
│  │  │  (meta.json) │ │  (save.json) │ │  (table-data.json +     ││ │
│  │  │              │ │              │ │   table-versions.json)   ││ │
│  │  └──────────────┘ └──────────────┘ └──────────────────────────┘│ │
│  │  ┌──────────────────────────┐  ┌──────────────────────────────┐│ │
│  │  │  GameNarrativeService    │  │  GamePromptBuilder            ││ │
│  │  │  - streamChatAPI         │← │  - buildSystemPrompt          ││ │
│  │  │  - applyTableEdits       │  │  - buildNarrativePrompt       ││ │
│  │  │  - persistNarrativeMsg   │  └──────────────────────────────┘│ │
│  │  └──────────────────────────┘  ┌──────────────────────────────┐│ │
│  │  ┌──────────────────────────┐  │  GameTableEditParser          ││ │
│  │  │  ManagementNarrativeSvc  │  │  - parse(<tableEdit>...)      ││ │
│  │  │  - 包装 GameNarrativeSvc │  │  - stripTableEditTags         ││ │
│  │  │  - userAction 路由        │  └──────────────────────────────┘│ │
│  │  │  - endTurn 流程          │                                  │ │
│  │  └──────────────────────────┘                                  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓ HTTP 流式
                          AIService.streamChatAPI
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Repository** | `GameRepository` / `GameSaveRepository` / `GameTableRepository` | 主进程封装文件系统访问，对外暴露同步 CRUD 方法 |
| **Template Method** | `GamePromptBuilder` / `GameNarrativeService` | 通用框架定义流程，模板通过 `templateSystemPrompt` 字段注入差异 |
| **Strategy** | `GameTypeTemplate` 接口 | 不同游戏类型实现不同策略，由 `GameTemplateRegistry` 路由 |
| **Observer (Zustand)** | `gameStore` / `gameUIStore` | 渲染进程通过 hooks 订阅状态变化 |
| **Lazy Init** | `React.lazy(() => import('./ManagementGameMain'))` | 模板主组件按需加载，避免主 bundle 包含未实现的游戏类型 |
| **Dependency Injection** | `GameNarrativeService.set*Repository()` / `ManagementNarrativeService` 构造函数 | 主进程服务通过 setter/构造函数注入仓库依赖，便于测试 mock |
| **Wrapper/Decorator** | `ManagementNarrativeService` 包装 `GameNarrativeService` | 不修改通用层的前提下添加经营游戏专属逻辑（userAction 路由 + endTurn 流程） |
| **AbortController** | `gameNarrativeHandlers` 中的 `activeAbortControllers` Map | 每个存档独立的 AbortController，支持单存档取消与全局取消 |

### 3.3 核心算法

#### tableEdit 命令解析与执行

```typescript
// AI 输出示例
/*
剧情文本...
<!--  <tableEdit>
insertRow(2, {"2":"gold","3":"金币","4":"500","5":"0"})
updateRow(2, 1, {"4":"450"})
deleteRow(2, 3)
</tableEdit> -->
*/

// 解析流程：GameTableEditParser.parse(text)
//   1. 用 TABLE_EDIT_COMMENT_REGEX 提取 HTML 注释包裹的 <tableEdit> 块
//   2. 用 TABLE_EDIT_BARE_REGEX 兜底提取无注释包裹的裸标签
//   3. 对每个块按行解析为 GameTableEditCommand（INSERT_ROW/UPDATE_ROW/DELETE_ROW）
//   4. 容错：JSON.parse 失败时规范化（加引号、单引号→双引号、清尾逗号）后重试

// 执行流程：GameTableRepository.applyTableEdits(saveId, commands)
//   1. 读取当前 tableData（包含 sheets[]/headers/data 三部分）
//   2. 遍历命令，按 sheetIndex-1 找到 sheet，按 rowIndex-1 找到行
//      - INSERT_ROW: 若 rowData['1'] 已存在则合并更新，否则 push
//      - UPDATE_ROW: 合并字段（rows[idx] = { ...rows[idx], ...rowData }）
//      - DELETE_ROW: splice(idx, 1)
//   3. 单条命令失败不中断（errors 收集）
//   4. 持久化到 table-data.json
//   5. 返回 { success, changes: { commandsExecuted, affectedSheets, errors } }
```

#### AI 叙事生成主流程

```typescript
// GameNarrativeService.generateNarrative(request, callbacks, abortSignal)
//   1. 创建 AbortController，加入 activeControllers
//   2. gatherContext(request):
//      - 从 GameRepository 读取 GameMeta + GameLocalConfig
//      - 从 GameSaveRepository 读取 narrativeLog + currentTurn
//      - 从 GameTableRepository 读取 tableData
//   3. gamePromptBuilder.buildSystemPrompt(meta, schema, config, templateSystemPrompt)
//      gamePromptBuilder.buildNarrativePrompt(userAction, narrativeLog, tableData, schema, currentTurn)
//   4. resolveModelConfig: request.modelConfig ?? config ?? AIService 默认
//   5. aiService.streamChatAPI(messages, options, onChunk):
//      - onChunk 回调 → callbacks.onChunk(chunk, index) → IPC event 'game:narrative:chunk'
//      - fullTextBuffer 累积 chunk
//   6. 解析 tableEdit: gameTableEditParser.parse(fullText)
//      剥离标签: gameTableEditParser.stripTableEditTags(fullText)
//   7. applyTableEditsIfNeeded (仅 async 模式 + 仓库可用 + commands 非空)
//   8. persistNarrativeMessage: loadSave → 追加 user + assistant 两条消息 → updateSave
//   9. callbacks.onComplete({ saveId, fullText, tableChanges, tableEdits, generationTime, model })
//      → IPC event 'game:narrative:complete'
//      → 若 commandsExecuted > 0 额外推送 'game:table:updated'
```

#### 经营游戏 endTurn 完整流程

```typescript
// ManagementNarrativeService.endTurn(saveId, callbacks, abortSignal)
//   1. 读取 tableData
//   2. rollRandomEvent():
//      - randomSource.next() < 0.3 → harvest (food +10)
//      - < 0.5 → disaster (food -20)
//      - < 0.6 → traveler (population +1)
//      - else → 无事件 (40%)
//   3. settleProduction(tableData, eventDeltas):
//      - 遍历 facilities sheet 的 production 字段（格式 "food:5,gold:10"）
//      - 合并 resources sheet 的 change_per_turn
//      - 合并事件效果 eventDeltas
//      - 生成单条 updateRow 命令（避免对同一行产生多条覆盖性更新）
//   4. buildEventInsertCommands: 在 events sheet insertRow 一条事件记录
//   5. incrementTurnCommand: 在 stats sheet 的 turn 行 updateRow（值 +1）
//   6. tableRepository.applyTableEdits(commands)
//   7. saveRepository.updateSave({ currentTurn, turnCount })
//   8. 构建特殊 user prompt（含当前回合/资源快照/最近事件）
//   9. narrativeService.generateNarrative(...)
```

### 3.4 组件树结构

```
GameModeEntry
├── GameLobby (currentView='lobby')
│   └── GameCard (列表项)
├── GameDetailPage (currentView='detail')
│   ├── GameSaveDialog (Modal，showSaveDialog=true)
│   ├── GameOptionsDialog (Modal，showOptionsDialog=true)
│   └── GameGalleryDialog (Modal，showGalleryDialog=true)
└── GameMainPage (currentView='main')
    ├── GameStateBar (顶部状态栏：标题/节点/回合/存档/设置/退出)
    ├── NarrativePanel (左侧 60%：流式文本 + 选项 + 用户输入框)
    │   ├── ReactMarkdown (渲染 narrativeLog)
    │   ├── latestOptions 按钮 (从最新 assistant 消息防御性读取 options)
    │   └── Input.Search (自由文本输入)
    └── [Template.Component] (右侧 40%：根据 currentGame.type 动态加载)
        ├── MysteryTemplate.Component (MYSTERY 类型，占位)
        ├── DatingSimTemplate.Component (DATING_SIM 类型，占位)
        ├── WerewolfTemplate.Component (WEREWOLF 类型，占位)
        ├── TextRpgTemplate.Component (TEXT_RPG 类型，占位)
        └── ManagementGameTemplate.Component (MANAGEMENT 类型，已实现)
            └── ManagementGameMain (内联组件)
                ├── 顶部工具条 (Tag 当前回合 + Button 结束回合)
                ├── CollapsiblePanel[资源] → ResourcePanel (sheetName='resources')
                ├── CollapsiblePanel[设施] → FacilityPanel (sheetName='facilities', onBuild)
                ├── CollapsiblePanel[招募] → RecruitPanel (内联，硬编码 3 个角色)
                └── CollapsiblePanel[统计] → StatisticsPanel (sheetName='stats')

对话框视图（叠加在基础视图之上）：
- showSaveDialog → GameSaveDialog (存档列表)
- showOptionsDialog → GameOptionsDialog (AI 引擎/温度/整理模式/ANSI 主题)
- showGalleryDialog → GameGalleryDialog (画廊占位)

通用组件：
- AnsiTileMap (CSS Grid 字符瓦片渲染，支持 ANSI SGR 解析，可被任意模板复用)
- CollapsiblePanel (折叠容器，复用 antd Collapse，状态由 gameUIStore 持久化)
```

### 3.5 状态管理设计

| 状态 | 来源 Store | 类型 | 说明 |
|------|-----------|------|------|
| `games` | `gameStore` | `GameIndexEntry[]` | 大厅列表数据（摘要字段） |
| `currentGame` | `gameStore` | `GameMeta \| null` | 详情页与主页面使用的完整元数据 |
| `currentSaveId` | `gameStore` | `string \| null` | 当前活跃存档 ID |
| `narrativeLog` | `gameStore` | `GameNarrativeMessage[]` | 剧情日志（user/assistant/system 消息数组） |
| `tableData` | `gameStore` | `GameTableData \| null` | 当前存档的表格数据快照 |
| `isGenerating` | `gameStore` | `boolean` | 是否正在生成叙事 |
| `error` | `gameStore` | `string \| null` | 错误信息 |
| `currentView` | `gameUIStore` | `GameView` | 当前视图（lobby/detail/main/options/gallery/saves） |
| `previousView` | `gameUIStore` | `GameView \| null` | 上一级视图（用于对话框关闭回退） |
| `panelCollapsed` | `gameUIStore` | `Record<string, boolean>` | 折叠面板状态 |
| `ansiTheme` | `gameUIStore` | `string` | ANSI 配色主题 |
| `scrollPosition` | `gameUIStore` | `Record<string, number>` | 滚动位置持久化 |
| `showSaveDialog` / `showOptionsDialog` / `showGalleryDialog` | `gameUIStore` | `boolean` | 对话框显隐标志 |

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **流式 chunk 推送与表格解析解耦** | AIService 的 `onChunk(chunk)` 仅做缓冲与转发，不解析；流式结束后才对完整文本执行 `gameTableEditParser.parse`，避免半截标签误判 |
| **多存档并发生成区分** | 每个 `game:generateNarrative` 请求按 `saveId` 创建独立 `AbortController`，存于 `activeAbortControllers: Map<string, AbortController>`；事件 payload 均携带 `saveId` 区分 |
| **模板信息跨进程传递** | 模板注册中心在渲染进程（含 React 组件无法跨进程序列化），通过 `GameNarrativeRequest.templateSystemPrompt` 与 `tableSchema` 字段由渲染进程取出后传入主进程，避免主进程依赖渲染进程的注册中心 |
| **tableEdit 索引一致性** | 协议规定所有索引 1-based（sheetIndex / rowIndex / colIndex），`GameTableRepository.applyTableEdits` 内部统一转换为 0-based 操作数组；唯一 ID 字段固定为 `'1'`（与 WritingTableData 习惯对齐） |
| **AI 输出格式容错** | `GameTableEditParser.parseDataObject` 三层容错：①清理嵌套 HTML 注释 → ②直接 `JSON.parse` → ③规范化（加引号、单引号→双引号、清尾逗号）后重试 |
| **endTurn 资源变更合并** | `settleProduction` 将 facilities 产出、resources change_per_turn、eventDeltas 合并到单条 updateRow 命令，避免对同一行产生多条 updateRow 互相覆盖（最后写入者胜的 bug） |
| **取消机制与生命周期** | `abortAllActiveGameRequests()` 用于应用退出；`game:cancelGeneration(saveId)` 用于用户主动取消；外部 `abortSignal` 通过 `addEventListener('abort', ...)` 桥接到内部 `AbortController` |
| **首次启动写入示例游戏** | `GameRepository` 模块加载时自动调用 `ensureIndexExists()`：①索引已存在直接 return（保留用户修改）②写入示例游戏 meta.json ③写入默认索引 |

### 4.2 性能优化策略

1. **模板懒加载**: `ManagementGameTemplate.Component = lazy(() => import('./ManagementGameMain'))`，仅在 GameMainPage 首次渲染该模板时加载 chunk
2. **派生数据缓存**: `ResourcePanel` / `FacilityPanel` / `StatisticsPanel` 使用 `useMemo` 缓存从 `tableData` 派生的列表，避免 tableData 引用未变时重复解析
3. **流式 chunk 累积**: `GameNarrativeService` 内部维护 `fullTextBuffer: string[]`，仅在流式结束后调用一次 `join('')`，避免字符串拼接的 O(n²) 性能问题
4. **AnsiTileMap tileRenderData useMemo**: 整个矩阵的样式计算结果缓存为 1 维数组，避免每次渲染重新解析所有瓦片的 ANSI 序列
5. **状态读取避免订阅全 store**: `GameModeEntry` 通过 `useGameStore.getState().loadGames()` 调用 action 而非 hook 订阅，避免冗余渲染
6. **自动存档轮转**: 自动存档保留最近 5 个（`MAX_AUTO_SAVES = 5`），超出数量的最旧自动存档被删除
7. **版本快照 TTL**: `VersionSnapshot` 有效期 24 小时（`VERSION_SNAPSHOT_TTL_MS`），过期自动清理
8. **tableEdit 失败不中断**: 单条命令失败收集到 `errors` 数组，不影响其他命令执行

### 4.3 安全考虑

- 所有 IPC handler 通过 `wrapHandler` 高阶函数包裹 try/catch，异常被捕获后返回 `{ success: false, error }`，不让异常冒泡到主进程顶层
- 主进程文件操作使用 `safeWriteFile` 原子写入，避免写入过程中崩溃导致数据损坏
- AI 引擎配置（API Key）通过 `settingStore` 集中管理，不在游戏存档中存储敏感信息
- `game:deleteGame` 仅清理游戏元数据，不级联删除 `data/game-saves/` 下的存档（存档生命周期独立管理）
- ANSI 解析仅支持 SGR 子集（前景/背景色、加粗），不支持其他 ANSI 序列，避免 XSS 风险
- 用户输入的自由文本通过 `escapeValue` 转义双引号/换行后注入 prompt，避免破坏 tableEdit 协议格式

### 4.4 边界情况处理

- **空表格 schema**: `GamePromptBuilder.buildSchemaSection` 在 schema 为空时输出"未配置 schema，请仅在叙事中体现，不要生成 tableEdit 命令"
- **仓库未注入降级**: `GameNarrativeService` 的三个仓库均为可选注入，未注入时：GameRepository → 占位 meta；GameSaveRepository → 空 narrativeLog；GameTableRepository → 跳过 tableEdit 应用但保留解析结果
- **空回复处理**: `GameTableEditParser.parse('')` 返回 `{ commands: [], errors: [] }`，不视为错误
- **模板未注册**: `GameMainPage` 在 `GameTemplateRegistry.get(type)` 返回 undefined 时显示 antd Empty "该游戏类型暂未实现"
- **窗口销毁场景**: `safeSend` 检查 `event.sender.isDestroyed()`，避免向已关闭的窗口推送 IPC 事件
- **历史索引兼容**: `GameRepository.ensureIndexExists` 在索引文件已存在时直接 return，不会覆盖用户已有的修改或自定义游戏列表

---

## 5. 模块间关系

### 5.1 依赖关系图

```
Game Module
    ├──→ useGameStore
    │       └──→ electronAPI.game.list()
    │       └──→ electronAPI.game.getMeta()
    │       └──→ electronAPI.game.createSave()
    │       └──→ electronAPI.game.generateNarrative()
    │       └──→ electronAPI.game.onNarrativeChunk()
    │       └──→ electronAPI.game.onTableUpdated()
    │       └──→ ...
    ├──→ useGameUIStore (currentView / panelCollapsed / show*Dialog)
    ├──→ useSettingStore (aiEngines 用于 GameOptionsDialog)
    ├──→ GameTemplateRegistry (查询模板)
    │       └──→ 5 个模板实例（4 个占位 + 1 个 MANAGEMENT 已实现）
    ├──→ electronAPI.game.* (20 个 invoke + 4 个流式监听)
    └──→ AIService (主进程内调用 streamChatAPI)
            └──→ settingStore.aiEngines 读取配置
```

### 5.2 被依赖关系

游戏模式是**顶层消费者**，不被其他业务模块直接依赖。仅通过 CreationCenter 入口被启用：
- `src/renderer/components/Chat/CreationCenter.tsx` 通过 `panelConfig.game` 配置点击行为，弹出 `GameModeDialog` 全屏对话框

### 5.3 数据流

```
用户点击"游戏"面板
    ↓ CreationCenter.tsx setShowGameDialog(true)
GameModeDialog 全屏
    ↓ <GameModeEntry />
GameModeEntry 挂载
    ↓ useGameStore.getState().loadGames()
electronAPI.game.list()
    ↓ IPC: 'game:list'
gameMetaHandlers
    ↓ gameRepository.listGames()
data/games/games-index.json
    ↓ 返回 GameIndexEntry[]
gameStore.games = games
    ↓ useGameUIStore.currentView === 'lobby'
GameLobby 渲染卡片网格
```

### 5.4 集成点

- **与 CreationCenter 模块**: 通过 `panelConfig.game` 配置入口，点击触发 `GameModeDialog` 全屏
- **与 Settings 模块**: 读取 `settingStore.aiEngines` 用于 `GameOptionsDialog` 的 AI 引擎选择；`GameLocalConfig.activeEngineId` 引用引擎 ID
- **与 AIService 模块**: 主进程 `GameNarrativeService` 调用 `aiService.streamChatAPI` 流式生成；`aiService.getConfig()` / `getEngineConfig()` 读取默认模型配置
- **与 Writing 模块**: 复用 `WritingTableData` 类型（命名为 `GameTableData` 避免命名冲突）；复用 `safeWriteFile` 工具函数；tableEdit 协议与写作模式/对话模式保持一致
- **与 File 模块**: `file.openFolder` 用于打开游戏数据目录（未来扩展）

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储方式 | 存储位置 |
|--------|---------|---------|
| 游戏索引 | JSON 文件 | `data/games/games-index.json`（含 version + games 数组） |
| 游戏元数据 | JSON 文件 | `data/games/<gameId>/meta.json`（完整 GameMeta） |
| 游戏本地配置 | JSON 文件 | `data/games/<gameId>/config.json`（GameLocalConfig） |
| 存档元数据 + 剧情日志 | JSON 文件 | `data/game-saves/<saveId>/save.json`（GameSaveData） |
| 存档表格数据 | JSON 文件 | `data/game-saves/<saveId>/tables/table-data.json`（GameTableData） |
| 存档表格配置 | JSON 文件 | `data/game-saves/<saveId>/tables/table-config.json`（GameTableConfig） |
| 表格版本快照 | JSON 文件 | `data/game-saves/<saveId>/tables/table-versions.json`（VersionSnapshot） |
| 模板自定义状态 | JSON 文件 | `data/game-saves/<saveId>/state-snapshot.json`（serializeState 输出） |

> 注：上述路径均相对于 `userData` 目录（Electron 标准用户数据目录）。

### 6.2 缓存策略

- **gameStore 状态不持久化**: 通过 Zustand 管理的运行时状态在应用重启后清空，每次启动重新从主进程拉取
- **GameRepository 模块加载时初始化**: `ensureIndexExists()` 在 import 时自动调用，确保首次启动有示例游戏
- **版本快照 TTL**: 24 小时后自动清理（`getVersionSnapshot` 检查 `expiresAt` 字段）
- **自动存档轮转**: `MAX_AUTO_SAVES = 5`，新建自动存档时若已存在 5 个则删除最旧的
- **流式 chunk 缓冲**: `GameNarrativeService` 内部 `fullTextBuffer` 仅在单次生成周期内有效，结束后清空

### 6.3 数据生命周期

```
应用启动
    ↓ CreationCenter 渲染
GameModeDialog 未打开
    ↓ 用户点击"游戏"面板
GameModeDialog 打开
    ↓ GameModeEntry 挂载
loadGames() → 游戏列表加载到 store
    ↓ 用户在大厅选择游戏
selectGame(gameId) → 读取 meta.json → currentGame 更新
    ↓ 用户在详情页点击"开始游戏"
startNewGame(gameId)
    ↓ createSave (主进程) → 生成 saveId + 初始化 save.json + 空表格 + state-snapshot
    ↓ loadSave (主进程) → 读取存档数据 → 切换到 main 视图
GameMainPage 渲染
    ↓ 玩家触发 userAction
generateNarrative({ userAction })
    ↓ IPC: game:generateNarrative
GameNarrativeService.generateNarrative
    ↓ aiService.streamChatAPI
流式 chunk 推送 → 渲染进程 narrativeLog 累积
    ↓ 流式结束
解析 tableEdit → 应用到 table-data.json
持久化 narrativeLog 到 save.json
推送 game:narrative:complete → gameStore.tableData 刷新
    ↓ UI 自动响应 tableData 变化（如 ManagementGameMain 的 currentTurn 派生）
    ↓ 用户点击"退出"
abortAllActiveGameRequests() + setCurrentView('detail')
    ↓ 用户关闭对话框
GameModeDialog 卸载，但 store 状态保留（下次打开仍可见）
    ↓ 应用退出
所有未持久化的运行时状态丢失（如下次启动需重新 loadGames）
```

---

## 7. IPC 接口表

> 所有 IPC 通道通过 `src/main/preload.ts` 的 `game` 命名空间暴露给渲染进程，调用方式为 `window.electronAPI.game.<method>(...)`。
> 所有 invoke 方法返回 `Promise<{ success: boolean, ...payload } | { success: false, error: string }>`。

### 7.1 游戏元数据 CRUD

#### 7.1.1 `game:list` —— 列出所有游戏摘要

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:list` |
| **调用方式** | `window.electronAPI.game.list()` |
| **请求参数** | 无 |
| **返回结构** | `{ success: boolean, games: GameIndexEntry[] }` —— `GameIndexEntry` 含 `id / type / title / subtitle / status / coverPath / tags / createdAt / updatedAt` |
| **错误处理** | 异常时 `success: false`，wrapHandler 兜底；索引文件不存在时返回空数组 |

#### 7.1.2 `game:getMeta` —— 读取单个游戏完整元数据

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:getMeta` |
| **调用方式** | `window.electronAPI.game.getMeta(gameId)` |
| **请求参数** | `gameId: string` |
| **返回结构** | `{ success: boolean, meta: GameMeta \| null }` —— 不存在时 `meta: null` |

#### 7.1.3 `game:createGame` —— 创建新游戏

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:createGame` |
| **调用方式** | `window.electronAPI.game.createGame(meta)` |
| **请求参数** | `meta: GameMeta` —— 调用方需自行生成 `id` 与时间戳 |
| **返回结构** | `{ success: boolean }` |

#### 7.1.4 `game:updateGame` —— 更新游戏元数据

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:updateGame` |
| **调用方式** | `window.electronAPI.game.updateGame(gameId, updates)` |
| **请求参数** | `gameId: string`，`updates: Partial<GameMeta>` —— 不允许通过 update 修改 `id` |
| **返回结构** | `{ success: boolean }` |

#### 7.1.5 `game:deleteGame` —— 删除游戏

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:deleteGame` |
| **调用方式** | `window.electronAPI.game.deleteGame(gameId)` |
| **请求参数** | `gameId: string` |
| **返回结构** | `{ success: boolean }` —— 仅清理游戏侧数据（meta.json / config.json），不级联删除存档 |

### 7.2 存档 CRUD

#### 7.2.1 `game:createSave` —— 创建新存档

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:createSave` |
| **调用方式** | `window.electronAPI.game.createSave(params)` |
| **请求参数** | `params: { gameId, gameType, name, isAuto, tableSchema, initialState? }` |
| **返回结构** | `{ success: boolean, meta: GameSaveMeta }` —— `meta` 含新建存档 `id`（uuid） |

#### 7.2.2 `game:loadSave` —— 加载存档

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:loadSave` |
| **调用方式** | `window.electronAPI.game.loadSave(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean, data: GameSaveData \| null }` —— `data` 含 `meta / narrativeLog / stateSnapshot` |

#### 7.2.3 `game:listSaves` —— 列出某游戏的所有存档

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:listSaves` |
| **调用方式** | `window.electronAPI.game.listSaves(gameId)` |
| **请求参数** | `gameId: string` |
| **返回结构** | `{ success: boolean, saves: GameSaveMeta[] }` —— 按 `updatedAt` 倒序 |

#### 7.2.4 `game:deleteSave` —— 删除存档

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:deleteSave` |
| **调用方式** | `window.electronAPI.game.deleteSave(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean }` —— 递归删除目录（含 save.json / tables / state-snapshot） |

#### 7.2.5 `game:save` —— 更新存档字段

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:save` |
| **调用方式** | `window.electronAPI.game.save(saveId, updates)` |
| **请求参数** | `saveId: string`，`updates: { narrativeLog?, stateSnapshot?, currentTurn?, currentNodeId?, nodeTitle?, turnCount? }` |
| **返回结构** | `{ success: boolean }` —— 仅更新指定字段，不会自动追加 narrativeLog |

### 7.3 表格数据 CRUD + 版本快照

#### 7.3.1 `game:getTableData` —— 读取表格数据

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:getTableData` |
| **调用方式** | `window.electronAPI.game.getTableData(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean, data: GameTableData \| null }` |

#### 7.3.2 `game:saveTableData` —— 保存表格数据

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:saveTableData` |
| **调用方式** | `window.electronAPI.game.saveTableData(saveId, tableData)` |
| **请求参数** | `saveId: string`，`tableData: GameTableData` |
| **返回结构** | `{ success: boolean }` —— 覆盖写入 `table-data.json` |

#### 7.3.3 `game:applyTableEdits` —— 应用 tableEdit 命令

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:applyTableEdits` |
| **调用方式** | `window.electronAPI.game.applyTableEdits(saveId, commands)` |
| **请求参数** | `saveId: string`，`commands: GameTableEditCommand[]` —— 每条命令含 `type / sheetIndex(1-based) / rowIndex?(1-based) / rowData? / raw` |
| **返回结构** | `{ success: boolean, changes: { commandsExecuted, affectedSheets: string[], errors: string[] } }` |

#### 7.3.4 `game:getVersionSnapshot` —— 读取版本快照

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:getVersionSnapshot` |
| **调用方式** | `window.electronAPI.game.getVersionSnapshot(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean, snapshot: VersionSnapshot \| null }` —— 不存在或已过期返回 `null` |

#### 7.3.5 `game:confirmVersion` —— 确认版本（应用 newData）

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:confirmVersion` |
| **调用方式** | `window.electronAPI.game.confirmVersion(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean }` —— 无快照或失败返回 `false` |

#### 7.3.6 `game:rollbackVersion` —— 回滚版本（恢复 originalData）

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:rollbackVersion` |
| **调用方式** | `window.electronAPI.game.rollbackVersion(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean }` —— 无快照或失败返回 `false` |

### 7.4 AI 叙事生成

#### 7.4.1 `game:generateNarrative` —— 流式生成剧情

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:generateNarrative` |
| **调用方式** | `window.electronAPI.game.generateNarrative(request)` |
| **请求参数** | `request: GameNarrativeRequest` —— 含 `gameId / saveId / gameType / userAction / modelConfig? / organizeMode? / templateSystemPrompt? / tableSchema?` |
| **返回结构** | `{ success: boolean }` —— 立即返回（仅表示请求已开始）；实际结果通过流式事件推送 |
| **取消机制** | 同 saveId 的旧请求会被自动 abort；调用方也可通过 `game:cancelGeneration` 主动取消 |

#### 7.4.2 `game:cancelGeneration` —— 取消生成

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:cancelGeneration` |
| **调用方式** | `window.electronAPI.game.cancelGeneration(saveId)` |
| **请求参数** | `saveId: string` |
| **返回结构** | `{ success: boolean, cancelled: boolean }` —— `cancelled` 表示是否找到并取消了对应请求 |

### 7.5 游戏本地配置

#### 7.5.1 `game:getConfig` —— 读取游戏本地配置

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:getConfig` |
| **调用方式** | `window.electronAPI.game.getConfig(gameId)` |
| **请求参数** | `gameId: string` |
| **返回结构** | `{ success: boolean, config: GameLocalConfig }` —— 不存在时返回 `DEFAULT_GAME_LOCAL_CONFIG` |

#### 7.5.2 `game:saveConfig` —— 保存游戏本地配置

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `game:saveConfig` |
| **调用方式** | `window.electronAPI.game.saveConfig(gameId, config)` |
| **请求参数** | `gameId: string`，`config: GameLocalConfig` |
| **返回结构** | `{ success: boolean }` |

### 7.6 流式事件监听器

> 4 个流式事件监听器，每个返回 unsubscribe 函数（与 writing 模式一致）。

#### 7.6.1 `game:narrative:chunk` —— 流式文本片段

| 项目 | 内容 |
|------|------|
| **事件通道** | `game:narrative:chunk` |
| **监听方式** | `const unsub = window.electronAPI.game.onNarrativeChunk(callback)` |
| **回调参数** | `data: GameNarrativeChunk = { saveId: string, chunk: string, index: number }` |
| **取消监听** | 调用返回的 `unsub()` 函数 |

#### 7.6.2 `game:narrative:complete` —— 生成完成

| 项目 | 内容 |
|------|------|
| **事件通道** | `game:narrative:complete` |
| **监听方式** | `const unsub = window.electronAPI.game.onNarrativeComplete(callback)` |
| **回调参数** | `data: GameNarrativeComplete = { saveId, fullText, tableChanges: { commandsExecuted, affectedSheets, errors }, tableEdits: string[], generationTime, model }` |
| **触发时机** | 流式生成结束，已剥离 tableEdit 标签，已应用 tableEdit 命令（async 模式下） |

#### 7.6.3 `game:narrative:error` —— 生成错误

| 项目 | 内容 |
|------|------|
| **事件通道** | `game:narrative:error` |
| **监听方式** | `const unsub = window.electronAPI.game.onNarrativeError(callback)` |
| **回调参数** | `data: GameNarrativeError = { saveId: string, error: string, code: string }` —— `code` 取值：`aborted / timeout / network / config_missing / rate_limit / service / unknown` |

#### 7.6.4 `game:table:updated` —— 表格被 tableEdit 更新后推送

| 项目 | 内容 |
|------|------|
| **事件通道** | `game:table:updated` |
| **监听方式** | `const unsub = window.electronAPI.game.onTableUpdated(callback)` |
| **回调参数** | `data: GameTableUpdated = { saveId: string, changes: GameNarrativeComplete['tableChanges'] }` |
| **触发时机** | 仅在 `game:narrative:complete` 中 `tableChanges.commandsExecuted > 0` 时额外推送 |

---

## 8. 表格 Schema 与 tableEdit 协议

### 8.1 经营游戏 5 sheet 结构

经营游戏（MANAGEMENT 类型）通过 `managementSchema.ts` 的 `MANAGEMENT_TABLE_SCHEMA` 常量声明 5 个 sheet：

| 索引 | sheet 名 | 字段结构（1-based） | 用途 |
|------|---------|--------------------|------|
| 1 | `characters` | `1:流水号, 2:name, 3:role, 4:status` | 游戏中的角色列表（玩家 / NPC / 招募单位） |
| 2 | `resources` | `1:流水号, 2:name, 3:amount, 4:change_per_turn` | 玩家拥有的资源（金币 / 食物 / 木材 / 人口） |
| 3 | `facilities` | `1:流水号, 2:name, 3:level, 4:cost, 5:production` | 已建造的设施（含可建设施，由 level 判定已建/可建） |
| 4 | `events` | `1:流水号, 2:turn, 3:description, 4:effect` | 已发生的事件历史（每回合结算时 AI 写入） |
| 5 | `stats` | `1:流水号, 2:key, 3:value` | 游戏统计数据（如 turn / total_income / total_expense） |

> 注意：表头第一列固定为 `'1'`（行号占位，与 WritingTableData 习惯对齐），sheet 顺序敏感，与 tableEdit 命令中的 `sheetIndex` 一一对应。
> 字段名使用 snake_case，与 ResourcePanel / FacilityPanel / StatisticsPanel 的默认字段映射保持一致。

### 8.2 GameTableSchema 接口

```typescript
export interface GameTableSchema {
  sheets: string[];                              // sheet 名称列表（顺序敏感）
  headers: Record<string, string[]>;            // 每个 sheet 的列头列表（key 为 sheet 名）
  sheetDescriptions: Record<string, string>;   // 每个 sheet 的用途描述
}
```

由游戏模板通过 `GameTypeTemplate.tableSchema` 字段提供，在两个场景下使用：
1. **新建存档时初始化空表格**: `GameTableRepository.initTableData(saveId, schema)` → `createEmptyTableData(schema)` 生成空数据
2. **AI prompt 中作为 schema 提示**: `GamePromptBuilder.buildSchemaSection(schema)` 输出【表格模板结构】段，指导 AI 生成合法 tableEdit 命令

### 8.3 tableEdit 协议

#### 8.3.1 标签格式

AI 在叙事文本末尾输出 `<tableEdit>` 标签，**必须用 HTML 注释包裹**：

```
<!--  <tableEdit>
insertRow(2, {"2":"gold","3":"金币","4":"500"})
updateRow(2, 1, {"4":"450"})
deleteRow(2, 3)
</tableEdit> -->
```

也兼容无 HTML 注释包裹的版本（容错路径）：`<tableEdit>...</tableEdit>`

#### 8.3.2 命令格式

| 命令 | 格式 | 说明 |
|------|------|------|
| **insertRow** | `insertRow(sheetIndex, {"colIndex":"value", ...})` | 在指定 sheet 末尾追加新行；若 `rowData['1']`（唯一 ID）已存在则合并更新 |
| **updateRow** | `updateRow(sheetIndex, rowIndex, {"colIndex":"value", ...})` | 修改指定 sheet 的指定行，仅更新 `rowData` 中提供的字段 |
| **deleteRow** | `deleteRow(sheetIndex, rowIndex)` | 删除指定 sheet 的指定行 |

#### 8.3.3 索引规则（全部 1-based）

- **sheetIndex**: 从 1 开始，对应 `schema.sheets` 数组的顺序
- **rowIndex**: 从 1 开始，对应当前 sheet 中的行号（仅 `updateRow` / `deleteRow` 需要）
- **colIndex**: 从 1 开始，对应当前 sheet headers 的字段索引（key 为字符串形式的数字）
- 表格索引、行索引必须是数字字面量（不加引号）；所有值必须是字符串类型（用双引号包裹）

#### 8.3.4 增量更新策略（强制规则）

为避免 AI 重复插入相同实体，prompt 中明确要求：
1. **重复性检查**: 生成 `insertRow` 前必须先在「当前表格数据快照」中查找相同或高度相似的实体，已存在则改用 `updateRow`
2. **只更新变化部分**: `updateRow` 时只更新发生变化的字段，不重复填写未变化的字段
3. **避免重复插入**: 绝不为已存在的实体生成新的 `insertRow` 命令
4. **唯一 ID 一致性**: 同一实体在整局游戏中应保持相同的唯一 ID（字段 2）
5. **谨慎删除**: 仅在实体确实不再相关时使用 `deleteRow`

### 8.4 版本快照机制

`GameTableRepository` 提供三步式版本快照流程，用于支持表格数据回滚预览与撤销：

```
1. saveVersionSnapshot(saveId, originalData, newData)
   → 生成 VersionSnapshot { id, saveId, originalData, newData, changeRecord, createdAt, expiresAt(+24h) }
   → 写入 table-versions.json
   → changeRecord 包含 addedRows / modifiedCells / deletedRows 三部分

2a. confirmVersion(saveId) —— 用户确认接受新数据
    → 将 snapshot.newData 写回 table-data.json
    → 清除快照文件

2b. rollbackVersion(saveId) —— 用户撤销，恢复旧数据
    → 将 snapshot.originalData 写回 table-data.json
    → 清除快照文件
```

**过期清理**: `getVersionSnapshot(saveId)` 检查 `expiresAt` 字段，过期自动调用 `clearVersionSnapshot(saveId)` 删除文件并返回 `null`。

---

## 9. AI Prompt 构建流程

### 9.1 System Prompt 拼装顺序

`GamePromptBuilder.buildSystemPrompt(gameMeta, tableSchema, config, templateSystemPrompt)` 按以下顺序拼接段落：

| 序号 | 段落标题 | 内容 | 条件 |
|------|---------|------|------|
| 1 | 【角色定位】 | "你是游戏《{title}》的旁白 AI。{subtitle} 你的职责是根据玩家行动推进剧情发展，描述场景、NPC 反应、事件结果，并维护游戏状态表格。" | 始终包含 |
| 2 | 【游戏规则】 | `gameMeta.gameplay` 字段提供的玩法说明 | `gameplay` 非空时包含 |
| 3 | 【输出格式要求】 | 5 条规则：①先输出剧情叙事文本 ②末尾追加 `<tableEdit>` 标签 ③标签必须用 HTML 注释包裹 ④无需修改也输出空标签 ⑤不要在叙事中泄露协议存在 | 始终包含 |
| 4 | 【tableEdit 命令协议 - 必须严格遵守】 | 标签格式、参数说明（sheetIndex/rowIndex/colIndex 均 1-based）、示例（insertRow/updateRow/deleteRow）、增量更新策略、约束规则 | 仅 `config.organizeMode === 'async'` 时包含 |
| 5 | 【表格模板结构】 | 按 `schema.sheets` 顺序列出每个 sheet 的索引、用途、字段结构 | 仅 `organizeMode === 'async'` 且 schema 非空时包含 |
| 6 | 【模板额外规则】 | `templateSystemPrompt` 内容（由模板提供，如经营游戏的资源经济规则） | `templateSystemPrompt` 非空时包含 |

### 9.2 User Prompt 拼装顺序

`GamePromptBuilder.buildNarrativePrompt(userAction, narrativeLog, tableData, tableSchema, currentTurn)` 按以下顺序拼接段落：

| 序号 | 段落标题 | 内容 | 条件 |
|------|---------|------|------|
| 1 | 【当前回合】 | "第 {currentTurn} 回合" | `currentTurn` 非 null 时包含 |
| 2 | 【剧情上下文】 | 最近 `RECENT_NARRATIVE_MESSAGE_COUNT = 10` 条 narrativeLog 消息，按时间顺序；早于 10 条的提示省略数；每条格式：`[回合N] {speaker}: {content}` | 始终包含（空时显示"暂无历史剧情，这是游戏的开始"） |
| 3 | 【当前表格数据快照】 | 按 sheet 顺序列出当前数据：sheet 名 / 索引 / 当前行数 / 字段列表 / 每行数据（最多 `MAX_ROWS_PER_SHEET_IN_PROMPT = 20` 行，超出提示） | 始终包含（空时显示"当前无表格数据，所有实体都需要 insertRow 创建"） |
| 4 | 【玩家行动】 | `userAction` 原文 | 始终包含 |

### 9.3 经营游戏专属 prompt 片段

`ManagementPromptBuilder.buildSystemPrompt(meta, tableSchema)` 输出 6 个段落，作为 `templateSystemPrompt` 注入到上述 system prompt 的【模板额外规则】段：

1. **经营游戏角色定位** —— 经营游戏旁白 AI 的职责（资源管理/设施建造/角色招募/随机事件响应/末尾生成 tableEdit）
2. **资源经济规则** —— 4 种资源（金币/食物/木材/人口）的产出与消耗路径、资源变更原则（建造/招募/结束回合/资源不足处理）
3. **回合制规则** —— 每回合一个行动（build:/recruit:/end_turn/自由文本），回合数记录在 stats sheet
4. **随机事件规则** —— 概率配置（30% 丰收/20% 灾害/10% 旅人/40% 无事件），事件描述要求
5. **经营场景 tableEdit 命令示例** —— 扣除金币、食物 +10、新增农场设施、新增农夫角色、记录随机事件、更新回合数等具体示例
6. **经营 sheet 结构** —— 5 个 sheet 的字段索引与用途

### 9.4 Prompt 跨进程传递

由于模板注册中心在渲染进程（含 React 组件无法跨进程序列化），prompt 构建采用**渲染进程取出模板信息 → 主进程拼接**的策略：

```typescript
// 渲染进程 gameStore.generateNarrative({ userAction })
//   ↓ 从 GameTemplateRegistry.get(currentGame.type) 取出模板
//   ↓ 将 template.tableSchema 与（如需）template.serializeState 派生的 templateSystemPrompt
//     打包到 GameNarrativeRequest
//   ↓ IPC: game:generateNarrative(request)

// 主进程 GameNarrativeService.generateNarrative
//   ↓ gatherContext(request): 从仓库读取 gameMeta / config / saveData / tableData
//   ↓ gamePromptBuilder.buildSystemPrompt(meta, schema, config, request.templateSystemPrompt)
//   ↓ gamePromptBuilder.buildNarrativePrompt(userAction, narrativeLog, tableData, schema, currentTurn)
//   ↓ aiService.streamChatAPI(messages, options, onChunk)
```

> 当前实现中，`templateSystemPrompt` 由 `ManagementNarrativeService.enrichRequestWithManagementPrompt` 在主进程内部生成（调用 `ManagementPromptBuilder.buildSystemPrompt`），渲染进程无需手动传入。但接口层面保留 `templateSystemPrompt` 与 `tableSchema` 字段供未来扩展。

---

## 10. ANSI 瓦片渲染原理

### 10.1 CSS Grid 实现

`AnsiTileMap` 组件位于 `src/renderer/components/Game/AnsiTileMap.tsx`，通过 CSS Grid 渲染字符瓦片矩阵：

```typescript
// 网格模板：showCoordinates=true 时第一列为行号列（固定 28px），其余列等分
const gridTemplate = showCoordinates
  ? `${COORD_COLUMN_WIDTH}px repeat(${cols}, 1fr)`
  : `repeat(${cols}, 1fr)`;

// 渲染结构
<div className="ansi-tile-map" role="grid" aria-rowcount={rows} aria-colcount={cols}>
  <div className="ansi-tile-map__grid" style={{ gridTemplateColumns: gridTemplate }}>
    {/* 左上角空格 + 列号 */}
    {showCoordinates && <div className="ansi-tile-map__corner" />}
    {showCoordinates && Array.from({ length: cols }, (_, c) => (
      <div className="ansi-tile-map__coord" role="columnheader">{c}</div>
    ))}
    {/* 每行：行号 + 瓦片 */}
    {tiles.map((rowTiles, row) => (
      <React.Fragment key={`row-${row}`}>
        {showCoordinates && <div className="ansi-tile-map__coord" role="rowheader">{row}</div>}
        {rowTiles.map((tile, col) => (
          <div
            className="ansi-tile-map__tile"
            style={{ color: data.color, backgroundColor: data.background, fontWeight: data.bold ? 'bold' : undefined }}
            data-row={row} data-col={col} data-char={data.displayText}
            role="gridcell" tabIndex={0}
            onClick={() => onTileClick?.(row, col, stripAnsi(tile))}
            onMouseEnter={() => setHoveredTile({ row, col })}
          >
            {data.displayText}
          </div>
        ))}
      </React.Fragment>
    ))}
  </div>
</div>
```

### 10.2 ANSI 转义序列解析

`parseAnsi(text)` 函数支持 SGR（Select Graphic Rendition）子集：

| SGR 码 | 含义 | CSS 映射 |
|--------|------|---------|
| `0` 或空（`\x1b[m`） | 重置所有属性 | 清除 color / background / bold |
| `1` | 加粗 | `fontWeight: 'bold'` |
| `30`-`37` | 前景色（黑/红/绿/黄/蓝/品红/青/白） | `color` 属性 |
| `40`-`47` | 背景色（同上 8 色） | `backgroundColor` 属性 |

#### 解析流程

```typescript
const ANSI_FG_COLORS: Record<number, string> = {
  30: '#000000', 31: '#cc0000', 32: '#4e9a06', 33: '#c4a000',
  34: '#3465a4', 35: '#75507b', 36: '#06989a', 37: '#d3d7cf'
};

// 正则匹配 SGR 序列：\x1b[<digits;digits;...>m
const ansiRegex = /\x1b\[([\d;]*)m/g;

// 状态机：维护 currentColor / currentBg / currentBold
// 每遇到转义序列：
//   1. 将"转义之前的文本"作为当前段 push 到 segments（携带当前样式状态）
//   2. 解析 SGR 参数，更新状态
// 末尾剩余文本作为最后一段 push

// 不支持的 SGR 码静默忽略（退化为字符显示）
```

#### 标准颜色映射（VGA 调色板）

| 索引 | 颜色 | 前景色十六进制 | 背景色十六进制 |
|------|------|--------------|--------------|
| 0 | 黑 | `#000000` | `#000000` |
| 1 | 红 | `#cc0000` | `#cc0000` |
| 2 | 绿 | `#4e9a06` | `#4e9a06` |
| 3 | 黄 | `#c4a000` | `#c4a000` |
| 4 | 蓝 | `#3465a4` | `#3465a4` |
| 5 | 品红 | `#75507b` | `#75507b` |
| 6 | 青 | `#06989a` | `#06989a` |
| 7 | 白 | `#d3d7cf` | `#d3d7cf` |

### 10.3 tileStyles 优先级

`tileStyles` prop 中的字符级样式配置优先于 ANSI 解析结果：

```typescript
const styleConfig = tileStyles?.[stripped]; // stripped 是 stripAnsi 后的纯字符
if (styleConfig) {
  // 优先使用 tileStyles 配置
  result.push({
    displayText: styleConfig.label ?? stripped,  // label 可覆盖显示文本
    color: styleConfig.color,
    background: styleConfig.background,
    bold: false
  });
} else {
  // 否则使用 ANSI 解析（取第一个非空段作为样式来源）
  const segments = parseAnsi(raw);
  // ...
}
```

### 10.4 性能考量

1. **tileRenderData useMemo**: 整个矩阵的样式计算结果缓存为 1 维数组（按 `row * cols + col` 索引），依赖 `[tiles, tileStyles, rows, cols]`，避免每次渲染重新解析所有瓦片的 ANSI 序列
2. **stripAnsi 工具函数**: 使用 `/g` 标志的正则 `replace` 一次性剥离所有转义序列，避免多次正则匹配开销
3. **CSS Grid 而非 table**: Grid 布局对大矩阵（如 50×50）的渲染性能优于 `<table>`，且更易实现响应式
4. **role="grid" + aria 属性**: 暴露给屏幕阅读器，提升可访问性；每个 `gridcell` 设置 `tabIndex={0}` 支持键盘导航
5. **边界场景处理**: 空矩阵（`rows === 0 || cols === 0`）直接返回 `<div data-empty="true" />`，避免渲染空 Grid
6. **事件回调剥离 ANSI**: `onClick` / `onHover` 回调接收的 `tile` 参数是 `stripAnsi(raw)` 后的纯字符，便于上层逻辑判断
7. **hoveredTile state**: 仅追踪当前 hover 的瓦片坐标，避免维护整个矩阵的 hover 状态

### 10.5 用法示例

```tsx
<AnsiTileMap
  tiles={[
    ['\x1b[31mR\x1b[0m', '#', '.'],  // R 红色
    ['.', '\x1b[1m@\x1b[0m', '#'],  // @ 加粗
  ]}
  tileStyles={{
    '@': { color: '#1890ff', label: '玩家' },  // 覆盖 ANSI，显示"玩家"
    '#': { background: '#888' }                  // 墙壁灰色背景
  }}
  onTileClick={(row, col, tile) => console.log(row, col, tile)}
  showCoordinates
  fontSize={16}
/>
```

---

## 11. 扩展指南：新增游戏类型

新增一个游戏类型需完成以下 5 步。以新增"文字 RPG"游戏类型为例：

### 11.1 实现 GameTypeTemplate 接口

在 `src/renderer/components/Game/templates/<your_type>/` 下创建模板定义文件 `<YourType>GameTemplate.ts`：

```typescript
import { lazy } from 'react';
import { GameType, GameStatus, type GameTypeTemplate } from '../../../../../shared/types/game.types';
import { TEXT_RPG_TABLE_SCHEMA } from './textRpgSchema';

const Component = lazy(() => import('./TextRpgGameMain'));

export const TextRpgGameTemplate: GameTypeTemplate = {
  type: GameType.TEXT_RPG,           // 1. type: 与 GameType 枚举对应
  meta: {                            // 2. meta: 大厅占位显示（无 GameMeta 时使用）
    title: '示例文字 RPG',
    subtitle: '...',
    description: '...',
    gameplay: '...',
    developer: '...',
    version: '0.1.0',
    status: GameStatus.IN_DEVELOPMENT,
    tags: ['RPG', '战斗', '冒险']
  },
  panels: ['resource', 'skill_tree', 'equipment', 'statistics'],  // 3. panels: 声明所需面板 key
  tableSchema: TEXT_RPG_TABLE_SCHEMA,                              // 4. tableSchema: 表格结构声明
  Component,                                                       // 5. Component: 懒加载 React 组件

  // 6. 序列化/反序列化（可选，用于自定义状态持久化）
  serializeState: (state) => ({ ...state }),
  deserializeState: (snapshot) => ({ ...snapshot }),

  // 7. 初始状态（新建存档时使用）
  getInitialState: () => ({ /* ... */ }),

  // 8. "其他"按钮回调（可选，详情页"其他"按钮如未注册则隐藏）
  onOtherAction: () => { /* ... */ }
};
```

### 11.2 注册到 GameTemplateRegistry

在 `src/renderer/components/Game/templates/index.ts` 中追加注册：

```typescript
import TextRpgGameTemplate from './text_rpg/TextRpgGameTemplate';

// 在文件末尾已有的 register 调用后追加：
GameTemplateRegistry.register(GameType.TEXT_RPG, TextRpgGameTemplate);

// 同步追加导出（可选）：
export { TextRpgGameTemplate } from './text_rpg/TextRpgGameTemplate';
```

### 11.3 创建对应的主进程 Prompt Builder 与 NarrativeService（如需自定义 userAction 处理）

仅在通用 `GameNarrativeService.generateNarrative` 不足以满足需求时（如需要 userAction 前缀路由、特殊状态变更流程等），才创建包装层：

```
src/main/services/game/templates/<your_type>/
├── <YourType>PromptBuilder.ts          —— 构建模板专属 system prompt 片段
└── <YourType>NarrativeService.ts       —— 包装 GameNarrativeService，添加 userAction 路由
```

参考 `ManagementPromptBuilder` / `ManagementNarrativeService` 的实现模式：
- 通过依赖注入持有 `GameNarrativeService` / `GameTableRepository` / `GameSaveRepository` 实例
- `generateNarrative(request, callbacks, abortSignal)` 主入口按 userAction 前缀分发
- 失败不阻塞叙事生成（让 AI 在叙事中提示玩家资源不足或场景异常）

如不需自定义 userAction 处理，可跳过此步，直接使用通用 `GameNarrativeService`。

### 11.4 创建示例游戏元数据

在 `data/games/<game_id>/meta.json` 创建示例游戏，并同步更新 `data/games/games-index.json`：

```json
// data/games/text_rpg_demo/meta.json
{
  "id": "text_rpg_demo",
  "type": "text_rpg",
  "status": "completed",
  "title": "示例文字 RPG",
  "subtitle": "...",
  "description": "...",
  "gameplay": "...",
  "developer": "Creative Cafe Team",
  "version": "1.0.0",
  "tags": ["RPG", "战斗"],
  "templateKey": "text_rpg",
  "createdAt": 1735689600000,
  "updatedAt": 1735689600000
}
```

同时在 `src/main/services/game/GameRepository.ts` 的 `ensureIndexExists` 中添加默认初始化逻辑（参考 `DEFAULT_PASTORAL_TOWN_META` 模式）。

### 11.5 模板组件 Props 契约

模板主组件接收 `GameTemplateProps`：

```typescript
export interface GameTemplateProps {
  saveId: string;                                 // 当前存档 ID
  gameId: string;                                 // 所属游戏 ID
  tableData: GameTableData | null;                // 当前表格数据快照（由 GameMainPage 从 store 传入）
  onAction: (userAction: string) => void;         // 玩家行动回调（触发叙事生成）
}
```

**重要约束**：
- 模板组件**不应**直接调用 `gameStore.generateNarrative`，应通过 `props.onAction(userAction)` 上抛行动，由 `GameMainPage` 统一包装调用（便于在框架层注入 `templateSystemPrompt` / `tableSchema`）
- 模板组件**不应**重复订阅 IPC 流式事件（由 `gameStore` 模块加载时已订阅），仅消费 store 状态
- 模板组件**不应**重复渲染 `GameStateBar`（已由 `GameMainPage` 顶部状态栏统一渲染）
- 生成中（`useGameStore(s => s.isGenerating)` 为 true 时）应禁用所有触发行动的按钮

---

## 12. 后续游戏类型实现规划

### 12.1 狼人杀（多人推理、阶段制）

| 项目 | 内容 |
|------|------|
| **GameType** | `GameType.WEREWOLF` |
| **预估工作量** | 中大型（约 2-3 周） |
| **关键技术点** | 1. **多人角色管理**：扩展 `characters` sheet 增加阵营（狼人/村民/神职）、技能、存活状态字段；新建 `players` sheet（玩家与 AI 角色对应表）<br>2. **阶段切换机制**：夜晚（狼人击杀 / 女巫救人或毒杀 / 预言家查验）→ 白天（讨论 / 投票）→ 结算，需在 `stats` sheet 维护 `phase` 字段；userAction 路由需扩展 `phase:night_werewolf_kill` / `phase:day_vote` 等前缀<br>3. **AI 扮演多个角色**：每个 AI 角色独立调用 `GameNarrativeService.generateNarrative`，需在 prompt 中明确角色身份与可见信息；考虑维护 `private_states` sheet（每个角色的私密状态）<br>4. **投票系统**：扩展 `events` sheet 增加投票类型事件；UI 需新增投票面板<br>5. **死亡与淘汰**：`characters` sheet 的 status 字段维护 alive/dead，死亡角色不参与后续回合<br>6. **胜利条件判定**：狼人全死 → 村民胜；狼人数 ≥ 村民数 → 狼人胜，需在 endTurn 流程中检查 |
| **新增 sheet 建议** | `players`（玩家列表）、`votes`（投票记录）、`private_states`（角色私密状态） |
| **新增面板** | `VotePanel`（投票面板）、`RoleListPanel`（角色列表，区分存活/死亡） |

### 12.2 逆转裁判类推理（证据系统、法庭辩论）

| 项目 | 内容 |
|------|------|
| **GameType** | `GameType.MYSTERY` |
| **预估工作量** | 大型（约 3-4 周） |
| **关键技术点** | 1. **证据收集与比对**：新建 `evidence` sheet（id / name / description / source / discovered_at / contradicts_with），证据之间存在矛盾关系（contradicts_with 字段引用其他证据 ID）<br>2. **法庭辩论流程**：扩展 `phase` 字段（investigation / court / cross_examination / verdict），不同阶段 userAction 路由不同；"出示证据"需 `present_evidence:<evidence_id>` 前缀<br>3. **矛盾判定**：AI 在 prompt 中明确"证词与证据 X 矛盾时应触发 objection 事件"；维护 `testimony` sheet 记录证人证词与对应证据 ID<br>4. **章节结构**：案件拆分为多个章节，每章有独立的证据集与目标；通过 `stats` sheet 的 `chapter` 字段管理进度<br>5. **失败回退**：玩家"指控"错误时需要回退到调查阶段，可能需要扩展版本快照机制支持"章节级回滚"<br>6. **剧情分支**：根据出示证据顺序与对象，AI 需生成不同分支的剧情 |
| **新增 sheet 建议** | `evidence`（证据列表）、`testimony`（证词记录）、`suspects`（嫌疑人列表） |
| **新增面板** | `EvidencePanel`（证据列表，支持点击查看详情）、`TestimonyPanel`（证词对照）、`ObjectionButton`（异议按钮） |

### 12.3 恋爱模拟（好感度图谱、约会事件）

| 项目 | 内容 |
|------|------|
| **GameType** | `GameType.DATING_SIM` |
| **预估工作量** | 中型（约 2 周） |
| **关键技术点** | 1. **好感度系统**：扩展 `characters` sheet 增加 `affection`（0-100）、`relationship_status`（stranger/friend/close_friend/dating/engaged/married）字段；好感度变化通过 tableEdit 的 updateRow 命令应用<br>2. **关系图谱**：可选维护 `relationships` sheet（角色对之间的关系，如朋友/敌人/恋人），影响多人场景的剧情走向<br>3. **约会事件分支**：好感度达到阈值时触发特殊事件，AI 需在 prompt 中识别当前好感度并选择合适的话题；userAction 前缀如 `date:<character_id>` / `gift:<item_id>`<br>4. **礼物系统**：新建 `items` sheet（id / name / type / affection_bonus / rarity），玩家可购买礼物赠送角色<br>5. **场景选择**：维护 `locations` sheet（地点列表），不同地点影响约会话题池<br>6. **时间管理**：每个行动消耗时间，每天/周/月有固定行动次数；`stats` sheet 维护 `day` / `week` 字段 |
| **新增 sheet 建议** | `items`（礼物与道具）、`locations`（地点列表）、`relationships`（角色关系图谱） |
| **新增面板** | `AffectionPanel`（好感度进度条，可视化关系阶段）、`InventoryPanel`（礼物背包）、`LocationSelector`（地点选择器） |

### 12.4 文字 RPG（战斗系统、技能树、装备）

| 项目 | 内容 |
|------|------|
| **GameType** | `GameType.TEXT_RPG` |
| **预估工作量** | 大型（约 3-4 周） |
| **关键技术点** | 1. **回合制战斗系统**：新建 `combat` sheet（敌我双方单位 / HP / MP / 状态效果 / 行动顺序）；战斗中每回合玩家选择技能 → AI 描述行动结果 → 应用伤害到 combat sheet；userAction 前缀如 `combat:attack:<skill_id>` / `combat:defend` / `combat:flee`<br>2. **技能树**：新建 `skills` sheet（id / name / branch / tier / prerequisite / mp_cost / effect），玩家通过升级解锁技能；维护 `stats` sheet 的 `skill_points` 字段<br>3. **装备系统**：新建 `equipment` sheet（id / name / slot / stats_bonus / rarity / equipped），装备通过 updateRow 修改 `equipped` 字段激活；新建 `inventory` sheet（背包物品列表）<br>4. **经验值与升级**：`stats` sheet 维护 `level` / `exp` / `exp_to_next` 字段；战斗胜利后通过 tableEdit 增加经验值，达到阈值时 level +1 并奖励 skill_points<br>5. **属性系统**：扩展 `characters` sheet 增加 `hp / mp / attack / defense / magic / speed / luck` 字段；装备与技能的属性加成需在 prompt 中明确公式<br>6. **敌人 AI**：每个敌人有独立的行动策略，AI 需根据敌人类型选择攻击/技能/防御；维护 `enemy_ai` sheet 描述敌人行为模板<br>7. **存档平衡**：战斗中存档需保存当前战斗状态（combat sheet 完整快照），读档后可继续战斗 |
| **新增 sheet 建议** | `combat`（战斗单位）、`skills`（技能树）、`equipment`（装备槽）、`inventory`（背包）、`enemies`（敌人模板） |
| **新增面板** | `CombatPanel`（战斗界面，HP/MP 条 + 行动选择）、`SkillTreePanel`（技能树可视化）、`EquipmentPanel`（装备槽）、`InventoryPanel`（背包网格） |

### 12.5 通用建议

| 通用建议 | 说明 |
|---------|------|
| **优先实现 MVP** | 每个游戏类型先实现最小可玩闭环（1 个核心 sheet + 1 个核心面板 + 基础 userAction 路由），再迭代扩展 |
| **复用通用面板** | 优先复用已实现的 `ResourcePanel` / `FacilityPanel` / `StatisticsPanel` / `CollapsiblePanel` / `AnsiTileMap`，避免重复造轮子 |
| **prompt 模块化** | 模板专属规则通过 `templateSystemPrompt` 注入，不要修改通用 `GamePromptBuilder` |
| **测试覆盖** | 每个新模板需配套单元测试（参考 `ManagementGameMain.test.tsx` 的 28 个测试用例模式） |
| **示例游戏元数据** | 在 `data/games/<game_id>/` 提供示例 meta.json，并同步更新 `GameRepository.ensureIndexExists` 的默认索引 |
| **文档同步** | 完成新游戏类型后，在本文件第 11 章扩展指南下追加该类型的实现说明 |

---

## 附录：相关文件清单

### 主进程

| 路径 | 说明 |
|------|------|
| `src/main/services/game/GameRepository.ts` | 游戏元数据 CRUD（meta.json + games-index.json） |
| `src/main/services/game/GameSaveRepository.ts` | 存档 CRUD（save.json + state-snapshot.json），自动存档保留 5 个 |
| `src/main/services/game/GameTableRepository.ts` | 表格数据 CRUD + applyTableEdits + 版本快照 |
| `src/main/services/game/GamePromptBuilder.ts` | 通用 system/user prompt 构建器 |
| `src/main/services/game/GameNarrativeService.ts` | 通用 AI 叙事服务（依赖注入 + 流式生成） |
| `src/main/services/game/GameTableEditParser.ts` | tableEdit 标签解析器（含容错） |
| `src/main/services/game/templates/management/ManagementPromptBuilder.ts` | 经营游戏专属 prompt 构建器 |
| `src/main/services/game/templates/management/ManagementNarrativeService.ts` | 经营游戏叙事服务（包装 GameNarrativeService + endTurn 流程） |
| `src/main/ipc/handlers/game/gameMetaHandlers.ts` | game:list / getMeta / createGame / updateGame / deleteGame |
| `src/main/ipc/handlers/game/gameSaveHandlers.ts` | game:createSave / loadSave / listSaves / deleteSave / save |
| `src/main/ipc/handlers/game/gameTableHandlers.ts` | game:getTableData / saveTableData / applyTableEdits / getVersionSnapshot / confirmVersion / rollbackVersion |
| `src/main/ipc/handlers/game/gameNarrativeHandlers.ts` | game:generateNarrative / cancelGeneration + 流式事件推送 |
| `src/main/ipc/handlers/game/gameConfigHandlers.ts` | game:getConfig / saveConfig |

### 渲染进程

| 路径 | 说明 |
|------|------|
| `src/renderer/components/Game/GameModeEntry.tsx` | 顶层容器，按 currentView 渲染子页面 |
| `src/renderer/components/Game/GameLobby.tsx` | 大厅页（筛选/搜索/排序） |
| `src/renderer/components/Game/GameCard.tsx` | 游戏卡片 |
| `src/renderer/components/Game/GameDetailPage.tsx` | 详情页（6 个操作按钮） |
| `src/renderer/components/Game/GameSaveDialog.tsx` | 存档对话框 |
| `src/renderer/components/Game/GameOptionsDialog.tsx` | 选项对话框（AI 引擎/温度/整理模式/ANSI 主题） |
| `src/renderer/components/Game/GameGalleryDialog.tsx` | 画廊对话框（占位） |
| `src/renderer/components/Game/GameMainPage.tsx` | 主页面框架（顶部状态栏 + 左侧叙事 + 右侧模板） |
| `src/renderer/components/Game/AnsiTileMap.tsx` | ANSI 字符瓦片渲染组件 |
| `src/renderer/components/Game/panels/NarrativePanel.tsx` | 流式叙事面板（react-markdown + 选项 + 输入框） |
| `src/renderer/components/Game/panels/GameStateBar.tsx` | 顶部状态栏 |
| `src/renderer/components/Game/panels/ResourcePanel.tsx` | 资源面板（通用） |
| `src/renderer/components/Game/panels/FacilityPanel.tsx` | 设施面板（通用） |
| `src/renderer/components/Game/panels/StatisticsPanel.tsx` | 统计面板（通用） |
| `src/renderer/components/Game/panels/CollapsiblePanel.tsx` | 折叠容器（通用） |
| `src/renderer/components/Game/templates/GameTemplateRegistry.ts` | 模板注册中心 |
| `src/renderer/components/Game/templates/index.ts` | 模板聚合入口（自动注册所有模板） |
| `src/renderer/components/Game/templates/MysteryTemplate.ts` 等 4 个 | 占位模板 |
| `src/renderer/components/Game/templates/management/ManagementGameTemplate.ts` | 经营游戏模板定义 |
| `src/renderer/components/Game/templates/management/ManagementGameMain.tsx` | 经营游戏主组件（含 RecruitPanel） |
| `src/renderer/components/Game/templates/management/managementSchema.ts` | 经营游戏 5 sheet schema |
| `src/renderer/components/Game/templates/management/managementInitialState.ts` | 经营游戏初始状态 |
| `src/renderer/stores/gameStore.ts` | 游戏状态 store |
| `src/renderer/stores/gameUIStore.ts` | 游戏 UI 状态 store |

### 共享类型与常量

| 路径 | 说明 |
|------|------|
| `src/shared/types/game.types.ts` | GameType / GameMeta / GameSave / GameTableData / GameTypeTemplate / GameNarrativeRequest 等类型 |
| `src/shared/constants/game.constants.ts` | GAME_TYPE_LABELS / GAME_STATUS_LABELS / DEFAULT_GAME_TABLE_SCHEMA / AUTO_SAVE_INTERVAL_MS 等常量 |

### 数据文件

| 路径 | 说明 |
|------|------|
| `data/games/games-index.json` | 游戏索引（含示例游戏"田园小镇"摘要） |
| `data/games/pastoral_town/meta.json` | 示例经营游戏完整元数据 |

### Preload 桥接

| 路径 | 说明 |
|------|------|
| `src/main/preload.ts` | `game` 命名空间（20 个 invoke 方法 + 4 个流式事件监听器） |

---

## 已知问题与经验教训

### 重点标记 1：vitest.config.ts 的 include 模式静默跳过 .tsx 测试文件

**问题描述**：阶段一开发期间，`vitest.config.ts` 的 `include` 字段原为 `['src/**/*.test.ts']`，仅匹配 `.ts` 后缀的测试文件。所有组件级的 `.tsx` 测试（如 `AnsiTileMap.test.tsx` / `GameModeEntry.test.tsx`）被静默跳过，不执行也不报错，导致测试覆盖率为 0 但开发者无感知。

**修复方案**：将 `include` 扩展为 `['src/**/*.test.ts', 'src/**/*.test.tsx']`，并在 spec 文档中明确要求 vitest 配置覆盖 `.tsx` 后缀。

**经验教训**：vitest 在 `include` 模式不匹配任何文件时不报错，需开发者主动验证测试是否被执行（如检查 `Test Files` 数量）。后续新增测试文件时建议先单独 `npx vitest run <path>` 验证是否被拾取。

### 重点标记 2：ManagementGameTemplate 的 serializeState / deserializeState 接口签名与 spec 描述不一致

**问题描述**：spec 描述 `serializeState / deserializeState` 为 `(state) => JSON 字符串`，但 `src/shared/types/game.types.ts` 中实际签名为：
- `serializeState?: (state: Record<string, any>) => Record<string, any>;`
- `deserializeState?: (snapshot: Record<string, any>) => Record<string, any>;`

即返回结构化对象，由存档层（`GameSaveRepository`）统一负责 JSON 序列化。

**解决方案**：按实际类型签名实现，`ManagementState` 直接以对象形式传递；`GameSaveRepository` 在写入 `state-snapshot.json` 时调用 `JSON.stringify`。

**经验教训**：spec 描述与实际类型定义可能存在偏差，应以类型定义为单一真源。开发前需先读取类型文件确认签名。

### 重点标记 3：gameNarrativeHandlers 未接入 ManagementNarrativeService 包装层

**问题描述**：阶段二完成后，`gameNarrativeHandlers.ts` 仍直接调用通用 `GameNarrativeService.generateNarrative`，未切换到 `ManagementNarrativeService` 包装层。意味着 `end_turn` userAction 在主进程实际走通用叙事生成路径，不会触发 endTurn 的资源结算 / 随机事件 / 回合 +1 / 自动存档等专属逻辑。

**影响范围**：渲染层"结束回合"流程通过 `gameStore.generateNarrative({ userAction: 'end_turn' })` 触发，但主进程不执行 `ManagementNarrativeService.endTurn` 完整流程。资源扣减、回合数推进等逻辑仅依赖 AI 在 tableEdit 中输出对应命令（不确定性较高）。

**临时方案**：依赖 AI 在 prompt 指引下自主输出 endTurn 相关的 tableEdit 命令（如更新 stats sheet 的 turn 行、应用 facilities 产出等）。

**后续修复方向**：
1. 在 `gameNarrativeHandlers.ts` 中根据 `request.gameType` 路由到对应的 `ManagementNarrativeService` 包装层
2. 或新增独立 IPC 频道 `game:management:endTurn`，由渲染层显式调用

### 重点标记 4：vi.mock 路径计算错误导致 mock 静默未生效

**问题描述**：在编写 `ManagementGameMain.test.tsx` 时，mock `ResourcePanel / FacilityPanel / StatisticsPanel` 路径使用了 `'../../../../panels/<Name>'`（4 个 `..` 段），实际从 `src/renderer/components/Game/templates/management/__tests__/` 到 `src/renderer/components/Game/panels/` 只需要 3 个 `..` 段（`__tests__` → `management` → `templates` → `Game` → `panels`）。错误路径解析为 `src/renderer/components/panels/<Name>`（不存在），vitest 不报错但 mock 静默未生效，导致测试用例"FacilityPanel 接收 onBuild 回调"失败（`capturedFacilityOnBuild.current` 为 null）。

**修复方案**：手动验证 mock 路径解析，将 4 个 `..` 修正为 3 个 `..`（`'../../../panels/<Name>'`）后测试通过。

**经验教训**：vitest 的 mock 路径解析失败时不抛错，仅静默跳过 mock，导致被 mock 的组件按真实路径加载（可能因依赖问题报错或行为不符预期）。建议在编写 mock 时先通过 `console.log(require.resolve('<path>'))` 或单独运行测试验证路径。

### 重点标记 5：antd v6 Button 的 forwardRef 不能直接调用

**问题描述**：在测试中 mock antd Button 时，直接调用 `actual.Button(props)` 会抛 `TypeError: actual.Button is not a function`，因为 antd v6 的 Button 是 `forwardRef` 包装的组件，不能作为普通函数调用。

**修复方案**：使用 `React.createElement(actual.Button, props)` 而非 `actual.Button(props)` 创建 mock 元素。

**经验教训**：mock antd 组件时统一使用 `React.createElement`，避免直接调用组件函数。参考 `GameMainPage.test.tsx` 的 mock 模式。

### 重点标记 6：GameRepository 模块加载时自动调用 ensureIndexExists 与测试 mock 时序冲突

**问题描述**：`GameRepository.ts` 末尾添加 `gameRepository.ensureIndexExists()` 后，该调用在 `import { gameRepository } from '../GameRepository'` 时即触发（模块加载阶段）。此时测试文件的 `let tmpRoot = ''` 还未执行（ES module 顶层代码在 import 之后才求值），若 `vi.mock` 工厂直接读取 `tmpRoot`，会得到空字符串，导致 `getGamesIndexPath()` 返回相对路径 `'data/games/games-index.json'`，最终命中项目根目录下的种子文件并跳过写入（看似无害），但若项目根目录无种子文件则会写入到 cwd 下相对路径，污染开发环境。

**修复方案**：使用 `vi.hoisted(() => { const fs = require('fs'); ...; return { current: fs.mkdtempSync(...) } })` 在所有 import 之前创建一个初始临时目录并赋值给共享 ref。`vi.mock` 工厂返回 `getUserDataPath: () => tmpRootRef.current`，在模块加载阶段 `tmpRootRef.current` 已指向初始临时目录，`ensureIndexExists` 写入到该临时目录。`beforeEach` 中切换 `tmpRootRef.current` 到新的临时目录保持测试隔离，`afterAll` 清理初始临时目录。

**经验教训**：该模式适用于"主进程模块加载时自动初始化副作用 + 测试 mock"的所有场景。后续如新增其他在模块加载时执行副作用的代码，需采用相同的 `vi.hoisted + ref` 模式。

### 重点标记 7：endTurn 中事件效果与产出结算的合并问题

**问题描述**：旧实现 `buildEventCommands` 同时生成 insertRow 到 events sheet 与 updateRow 到 resources sheet，会导致对同一资源行产生多条 updateRow 命令互相覆盖（最后写入者胜），最终资源变化不符合预期。

**修复方案**：将事件对资源的效果（eventDeltas）合并到 `settleProduction` 方法中，与 facilities 产出、resources change_per_turn 合并计算后生成单条 updateRow 命令。`buildEventInsertCommands` 仅负责在 events sheet 插入一行事件记录（id / turn / description / effect），不重复应用资源变更。

**经验教训**：当多个来源对同一行数据产生变更时，必须合并为单条 updateRow 命令，避免覆盖。tableEdit 协议中的 updateRow 是"合并字段"语义，但若对同一字段多次 updateRow，最后写入者覆盖前面所有变更。
