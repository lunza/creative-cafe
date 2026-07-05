# 创作中心游戏模式 (Game Mode) Spec

## Why

创作中心 (CreationCenter.tsx) 当前的 `game` 面板被标记为 `comingSoon: true`，点击无响应。需要为用户提供一个完整的 AI 驱动文字冒险游戏模式，使创作中心三件套（聊天 / 写作 / 游戏）闭环，并复用项目已有的 AI 引擎、表格持久化 (`tableEdit`)、流式响应等基础设施，避免重复造轮子。

## What Changes

- **新增**：游戏模式入口 —— 在 `CreationCenter` 的 `game` 面板去除 `comingSoon` 标记，点击后懒加载 `GameModeEntry`，复用 `WritingModeDialog` 同款全屏对话框模式。
- **新增**：游戏大厅页 (`GameLobby`) —— 展示所有已注册游戏卡片，支持按游戏类别筛选、关键字搜索、按状态/更新时间排序，每张卡片显示状态徽标（已完成 / 开发中）与简短介绍。
- **新增**：游戏详情页 (`GameDetailPage`) —— 标准化布局，固定功能按钮区：开始游戏 / 读取存档 / 选项 / 画廊 / 关闭 / 其他（预留扩展位）；正文区显示游戏详细介绍、玩法说明、开发者信息。
- **新增**：游戏主页面 (`GameMainPage`) —— 进入游戏后的运行时容器，按游戏类型动态加载专属布局模板；模板可注册自定义面板（地图/背包/线索、好感度/关系图谱、资源/设施/统计、角色属性/技能树/任务日志/装备等）。
- **新增**：地图渲染采用 **ANSI 字符瓦片** (character tiles) 技术 —— 提供 `AnsiTileMap` 组件，将字符矩阵渲染为带样式的瓦片网格，支持点击单元格触发事件。
- **新增**：AI 驱动动态叙事系统 —— 复用 `AIService` 的流式调用能力，构建 `GameNarrativeService` 与 `GamePromptBuilder`，按游戏类型生成剧情节点、分支选项、状态变更。
- **新增**：游戏表格持久化 (`<tableEdit>`) —— 复用对话模式与写作模式的 `tableEdit` 标签协议，AI 回复末尾附带表格操作命令，由 `GameTableRepository` 持久化到 `data/game-saves/<saveId>/tables/table-data.json`，结构对齐 `WritingTableData`。
- **新增**：游戏存档/读档系统 —— 每个游戏支持多存档槽位，存档包含元数据、剧情日志、表格快照、自定义状态快照，存档列表 UI 复用 antd Modal + List。
- **新增**：可扩展游戏类型模板 —— 定义 `GameTypeTemplate` 接口与注册中心 `GameTemplateRegistry`，新增游戏类型只需实现接口并注册。
- **新增**：首期交付的完整游戏类型 —— **文字模拟经营** (Management Sim)，作为框架可用性的验证样本；其余类型（狼人杀 / 逆转裁判类推理 / 恋爱模拟 / 文字 RPG）仅留接口占位与开发规划。
- **新增**：技术文档 `doc/10-game-mode-module.md` —— 模块功能描述、组件树、IPC 接口表、表格 schema、扩展指南、后续游戏类型实现规划。
- **修改**：`src/main/preload.ts` 新增 `game` 命名空间，暴露 `list / getMeta / startNew / save / load / listSaves / deleteSave / getTableData / saveTableData / organizeTable / generateNarrative`（含流式事件监听器）。
- **修改**：`src/main/ipc/index.ts` 注册 `registerGameHandlers()`。
- **修改**：`CreationCenter.tsx` —— `panelConfig.game` 去除 `comingSoon`，新增 `GameModeDialog` 全屏容器（仿 `WritingModeDialog`）。

## Impact

- **Affected specs**: 无既有 spec 与游戏模式相关；新增独立 spec，不破坏现有功能。
- **Affected code**:
  - 新增目录：`src/main/services/game/`、`src/main/ipc/handlers/game/`、`src/renderer/components/Game/`、`src/renderer/stores/gameStore.ts`、`src/renderer/stores/gameUIStore.ts`、`src/shared/types/game.types.ts`、`src/shared/constants/game.constants.ts`、`doc/10-game-mode-module.md`。
  - 修改文件：`src/main/preload.ts`（追加 `game` 命名空间）、`src/main/ipc/index.ts`（注册 handler）、`src/renderer/components/Chat/CreationCenter.tsx`（启用 game 面板）、`src/renderer/components/Chat/CreationCenter.css`（移除 disabled 样式副作用，如需要）。
  - 测试目录：`src/main/services/game/__tests__/`、`src/renderer/components/Game/__tests__/`。
- **复用基础设施**：`AIService`、`SSEStreamParser`、`storageService`、`useSettingStore`（AI 引擎配置）、`useLogStore`、`safeWriteFile` 模式、`tableEdit` 协议、`WritingTableData` 结构。
- **依赖项**：不引入新 npm 包；ANSI 瓦片用纯 CSS Grid + React 自实现，不依赖第三方终端库。

## ADDED Requirements

### Requirement: 游戏模式入口
系统 SHALL 在创作中心 `game` 面板去除 `comingSoon` 标记，点击面板后以全屏对话框形式加载游戏模式入口 `GameModeEntry`，对话框关闭时返回创作中心三件套选择界面。

#### Scenario: 用户首次进入游戏模式
- **WHEN** 用户点击创作中心"游戏模式"面板
- **THEN** 全屏对话框打开，默认展示游戏大厅页
- **AND** 对话框右上角显示关闭按钮，点击后返回创作中心

#### Scenario: 关闭游戏模式
- **WHEN** 用户点击对话框右上角关闭按钮
- **THEN** 全屏对话框关闭，回到创作中心面板选择界面
- **AND** 当前游戏会话状态保留在 store 中，下次进入可恢复

### Requirement: 游戏大厅页
系统 SHALL 提供游戏大厅页 `GameLobby`，展示所有已注册游戏的卡片网格，每张卡片包含：游戏 ID、标题、副标题、封面（可缺省）、状态徽标、简短介绍、最后更新时间。

#### Scenario: 浏览游戏列表
- **WHEN** 用户进入游戏大厅
- **THEN** 显示所有已注册游戏卡片，按"最后更新时间"倒序排列
- **AND** 顶部显示筛选区：游戏类别下拉（全部 / 推理 / 恋爱 / 经营 / RPG / 其他）、搜索框、排序下拉（最近更新 / 创建时间 / 名称）

#### Scenario: 筛选与搜索
- **WHEN** 用户选择"经营"类别并输入"农场"
- **THEN** 卡片列表仅显示类别为"经营"且标题或介绍包含"农场"的卡片
- **AND** 无匹配结果时显示空状态插画与"暂无匹配游戏"提示

#### Scenario: 点击游戏卡片
- **WHEN** 用户点击某张游戏卡片
- **THEN** 跳转到该游戏的详情页
- **AND** 浏览器历史栈（store 内部状态）记录上一页为大厅，支持返回

### Requirement: 游戏详情页
系统 SHALL 提供标准化的游戏详情页 `GameDetailPage`，固定包含 6 个功能按钮区：开始游戏、读取存档、选项、画廊、关闭、其他（预留扩展位，由游戏模板自定义）。

#### Scenario: 进入详情页
- **WHEN** 用户从大厅点击游戏卡片进入详情页
- **THEN** 详情页显示：左侧游戏封面与元数据（标题 / 副标题 / 类别徽标 / 开发者 / 版本 / 状态），右侧详细介绍、玩法说明、操作按钮区
- **AND** 操作按钮区按以下顺序排列：开始游戏（主按钮） / 读取存档 / 选项 / 画廊 / 其他 / 关闭

#### Scenario: 点击开始游戏
- **WHEN** 用户点击"开始游戏"按钮
- **THEN** 创建新存档（自动生成存档 ID 与初始状态），加载游戏模板，进入 `GameMainPage`
- **AND** 如当前已有未保存的进行中存档，弹出确认对话框提示"是否放弃当前进度"

#### Scenario: 点击读取存档
- **WHEN** 用户点击"读取存档"按钮
- **THEN** 弹出存档选择对话框，显示该游戏的所有存档槽位（含截图、最后保存时间、当前剧情节点）
- **AND** 用户选中存档并确认后，加载存档进入 `GameMainPage`

#### Scenario: 点击选项 / 画廊 / 其他 / 关闭
- **WHEN** 用户点击"选项"按钮
- **THEN** 弹出游戏选项对话框（AI 引擎选择、温度、最大 token、表格整理模式、ANSI 配色主题等）
- **WHEN** 用户点击"画廊"按钮
- **THEN** 弹出画廊对话框，展示已解锁的 CG / 插图（首期为空状态占位，留接口供游戏模板填充）
- **WHEN** 用户点击"其他"按钮
- **THEN** 触发当前游戏模板注册的 `onOtherAction` 回调（无注册则按钮隐藏）
- **WHEN** 用户点击"关闭"按钮
- **THEN** 返回上一级（详情页 → 大厅；详情页直接进入则返回大厅）

### Requirement: 游戏主页面与游戏类型模板
系统 SHALL 在 `GameMainPage` 中根据游戏类型从 `GameTemplateRegistry` 加载对应模板组件，模板组件可注册自定义面板（地图 / 背包 / 线索 / 好感度 / 资源 / 设施 / 角色属性 / 技能树 / 任务日志 / 装备等）。

#### Scenario: 进入游戏主页面
- **WHEN** 用户从详情页"开始游戏"或"读取存档"进入游戏
- **THEN** `GameMainPage` 根据游戏类型加载对应模板
- **AND** 主页面统一布局：顶部状态栏（游戏标题 / 当前节点 / 存档按钮 / 设置按钮 / 退出按钮），左侧叙事面板（流式文本输出 + 选项区），右侧模板自定义面板区（可折叠多个面板）

#### Scenario: 模板注册自定义面板
- **WHEN** 游戏模板通过 `GameTemplateRegistry.register(type, config)` 注册时声明 `panels: ['resource', 'facility', 'statistics']`
- **THEN** `GameMainPage` 右侧面板区按声明顺序渲染对应面板组件
- **AND** 每个面板支持折叠 / 展开，状态由 `gameUIStore` 持久化

#### Scenario: 文字模拟经营模板布局
- **WHEN** 用户进入文字模拟经营游戏
- **THEN** 右侧面板区显示：资源管理面板（金币 / 食物 / 木材 / 人口等）、设施建设界面（已建设施列表 + 可建设施列表 + 建造按钮）、经营数据统计（当前回合 / 总收入 / 总支出 / 净利润折线图占位）
- **AND** 左侧叙事面板显示当前回合事件描述与玩家可选行动

### Requirement: ANSI 字符瓦片地图
系统 SHALL 提供 `AnsiTileMap` 组件，将字符矩阵渲染为带样式的瓦片网格，用于需要地图的游戏场景（推理类地图导航、RPG 类场景地图、经营类设施布局）。

#### Scenario: 渲染字符瓦片
- **WHEN** 游戏模板传入 `tiles: string[][]`（每个元素为单字符或 ANSI 转义序列）与 `tileStyles: Record<string, { color, background, label }>`
- **THEN** `AnsiTileMap` 渲染为 CSS Grid 网格，每个瓦片按字符映射样式
- **AND** 鼠标悬停瓦片显示对应坐标与说明，点击瓦片触发 `onTileClick(row, col, tile)`

#### Scenario: 地图状态更新
- **WHEN** 游戏叙事推进导致地图变化（如玩家移动、设施建成）
- **THEN** 模板调用 `setTiles(newMatrix)` 更新地图，组件按字符差异最小化重渲染

### Requirement: AI 驱动动态叙事系统
系统 SHALL 提供 `GameNarrativeService`（主进程）与 `GamePromptBuilder`（主进程），按游戏类型构建 system prompt 与 user prompt，调用 `AIService.callStream` 生成剧情，并将剧情末尾的 `<tableEdit>` 命令解析后写入游戏表格。

#### Scenario: 生成下一剧情节点
- **WHEN** 用户在叙事面板选择某个选项（如"建造农场"）
- **THEN** 渲染进程通过 `game.generateNarrative({ gameId, saveId, userAction, gameStateSnapshot })` 调用 IPC
- **AND** 主进程 `GameNarrativeService` 通过 `GamePromptBuilder` 构建 prompt：包含游戏模板的 system prompt、当前剧情上下文、当前表格数据快照、玩家行动
- **AND** 调用 `AIService.callStream`，通过 IPC 事件 `game:narrative:chunk` 将流式片段推送到渲染进程
- **AND** 流式结束后主进程解析回复末尾的 `<tableEdit>` 标签，调用 `GameTableRepository.applyTableEdits` 更新表格
- **AND** 通过 `game:narrative:complete` 事件通知渲染进程，携带完整文本与表格变更摘要
- **OR** 失败时通过 `game:narrative:error` 事件通知

#### Scenario: 表格持久化
- **WHEN** AI 回复包含 `<tableEdit>insertRow(2, {"2":"worker_001","3":"农夫","4":"采集"})</tableEdit>`
- **THEN** 主进程解析命令，对存档目录下的 `table-data.json` 执行对应操作（insertRow / updateRow / deleteRow）
- **AND** 操作前后生成表格版本快照，存入 `table-versions.json`，支持回滚
- **AND** 通过 `game:table:updated` 事件通知渲染进程刷新面板

### Requirement: 游戏存档/读档系统
系统 SHALL 提供多存档槽位支持，每个存档包含：存档 ID、所属游戏 ID、存档名称、创建时间、最后更新时间、当前剧情节点 ID、剧情日志（消息数组）、表格数据快照、自定义状态快照（由模板定义的 `serializeState` / `deserializeState` 处理）。

#### Scenario: 自动存档
- **WHEN** 每次剧情生成完成且表格更新成功
- **THEN** 系统自动调用 `game.save({ saveId, auto: true })`，将当前剧情日志与表格快照写入 `data/game-saves/<saveId>/`
- **AND** 自动存档文件名带 `_auto` 后缀，最多保留最近 5 个自动存档

#### Scenario: 手动存档
- **WHEN** 用户点击顶部状态栏的"存档"按钮
- **THEN** 弹出存档对话框，输入存档名称后确认
- **AND** 系统创建新存档槽位，写入完整快照

#### Scenario: 读取存档
- **WHEN** 用户从存档选择对话框选择某个存档
- **THEN** 系统加载存档，恢复剧情日志、表格数据、自定义状态，进入 `GameMainPage`
- **AND** 如当前已有未保存进度，提示用户确认

### Requirement: 可扩展游戏类型模板
系统 SHALL 定义 `GameTypeTemplate` 接口与 `GameTemplateRegistry` 注册中心，新增游戏类型只需：实现接口、注册到 registry、提供表格 schema 配置。

#### Scenario: 注册新游戏类型
- **WHEN** 开发者实现 `WerewolfTemplate implements GameTypeTemplate` 并调用 `GameTemplateRegistry.register('werewolf', template)`
- **THEN** 游戏大厅自动显示该类型的卡片（如已配置游戏元数据）
- **AND** 详情页与主页面能正确加载该模板的组件、面板、表格 schema

#### Scenario: 表格 schema 配置
- **WHEN** 游戏模板声明 `tableSchema: { sheets: [{ name: 'characters', headers: [...], description: '...' }] }`
- **THEN** 系统在新建游戏存档时初始化空表格，结构对齐 `WritingTableData`
- **AND` AI prompt builder 将 schema 注入 system prompt，指导 AI 生成符合 schema 的 tableEdit 命令

### Requirement: 文字模拟经营游戏完整实现
系统 SHALL 在框架完成后，交付文字模拟经营 (Management Sim) 游戏的完整可玩实现，作为框架可用性的验证样本与首期交付物。

#### Scenario: 完整游戏循环
- **WHEN** 用户从大厅选择"田园小镇"（经营类示例游戏）进入详情页并开始游戏
- **THEN** 进入 `GameMainPage`，加载 `ManagementGameTemplate`
- **AND** 初始状态：金币 500、食物 50、木材 30、人口 5、回合 1
- **AND** 叙事面板显示开场剧情（AI 流式生成），玩家可在选项区选择行动（建造 / 招募 / 采集 / 结束回合）

#### Scenario: 建造设施
- **WHEN** 玩家在设施建设面板选择"农场"并点击建造
- **THEN** 系统校验资源（木材 ≥ 10、金币 ≥ 100）
- **AND** 扣除资源，设施列表新增"农场 Lv.1"，每回合产出 +5 食物
- **AND** 触发 AI 叙事生成，描述农场建成后的场景

#### Scenario: 结束回合
- **WHEN** 玩家点击"结束回合"按钮
- **THEN** 系统结算本回合产出（资源增减、人口变化、随机事件触发概率）
- **AND** 回合数 +1，触发 AI 叙事生成下一回合事件
- **AND** 自动存档

### Requirement: 游戏模式技术文档
系统 SHALL 在 `doc/10-game-mode-module.md` 提供完整技术文档，遵循 `doc/01-dashboard-module.md` 等既有文档的章节结构。

#### Scenario: 文档内容
- **WHEN** 开发者阅读 `doc/10-game-mode-module.md`
- **THEN** 文档包含：模块功能描述、模块定位与业务价值、组件树、IPC 接口表、表格 schema、AI prompt 构建流程、ANSI 瓦片渲染原理、扩展指南（如何新增游戏类型）、后续游戏类型实现规划（狼人杀 / 逆转裁判类推理 / 恋爱模拟 / 文字 RPG）

## MODIFIED Requirements

### Requirement: 创作中心三件套选择
`CreationCenter` 中的 `game` 面板 SHALL 移除 `comingSoon: true` 标记，点击后以全屏对话框形式加载 `GameModeEntry`，与 `chat` / `creative` 面板的交互模式保持一致。

修改前：`panelConfig.game.comingSoon = true`，点击无响应。
修改后：`panelConfig.game.comingSoon = false`（移除该字段），点击后 `setShowGameDialog(true)`，渲染 `GameModeDialog` 全屏容器，内部懒加载 `GameModeEntry`。

## REMOVED Requirements

无移除项。`comingSoon` 标记的移除属于状态变更而非功能移除。

## 已知问题与经验教训（开发过程中增量记录）

本章节记录在游戏模式开发过程中发现的 bug、与 spec 假设不符的实现细节、以及需要后续任务特别注意的事项。每完成一个 Task 后增量追加。

### Task 3 完成（2026-07-05）：AI 叙事服务与 Prompt 构建器

#### Bug 1：GameTableEditParser 单引号键名解析失败（已修复）

**现象**：当 AI 输出 `insertRow(1, {'2':'nick_001','3':'尼克'})`（单引号包裹键名）时，原版 `normalizeJsonObject` 只处理了单引号**值**（`:'value'` → `:"value"`），未处理单引号**键名**（`{'key':` → `{"key":`），导致 JSON.parse 失败，命令被记入 errors。

**根因**：参考的 `src/main/services/memory/tableEditParser.ts` 的 `normalizeJsonObject` 函数本身就有此缺陷，本任务在移植时未发现。

**修复**：在 `normalizeJsonObject` 中新增单引号键名转换步骤，且必须**在单引号值转换之前**执行（避免误吞键名末尾的冒号）。处理顺序：
1. 未加引号的键名 → 加双引号
2. 单引号键名 → 双引号（新增）
3. 单引号字符串值 → 双引号
4. 清理尾逗号

**测试覆盖**：`GameTableEditParser.test.ts > "normalizes single-quoted strings to double-quoted"` 用例验证此修复。

#### 重要发现 1：AIService 实际方法名为 streamChatAPI（非 callStream）

**现象**：Spec 与 Task 描述中提到 "调用 `AIService.callStream`"，但实际 `src/main/services/AIService.ts` 导出的方法是 `streamChatAPI`。

**影响**：仅命名差异，签名与功能与 spec 描述一致：`streamChatAPI(messages, options, onChunk): Promise<StreamResponse>`，返回 `{ content, generationTime, model }`，支持 `abortSignal`。

**处理**：`GameNarrativeService.generateNarrative` 直接调用 `aiService.streamChatAPI`，未引入别名。

#### 重要发现 2：Game 仓库均已存在且为同步签名

**现象**：Spec 中 SubTask 2.x 已实现 `GameRepository` / `GameSaveRepository` / `GameTableRepository`，方法签名均为**同步**（基于 `fs.readFileSync / writeFileSync`），与 Task 3 描述中隐含的 "Promise 返回" 假设不符。

**关键差异**：
- `GameRepository.getGameMeta(gameId): GameMeta | null`（同步，非 `Promise<GameMeta | null>`）
- `GameRepository.getGameConfig(gameId): GameLocalConfig`（同步，**非 nullable**，缺失时返回 `DEFAULT_GAME_LOCAL_CONFIG`）
- `GameSaveRepository.loadSave(saveId): GameSaveData | null`（同步；方法名为 `loadSave` 而非 `getSaveData`）
- `GameSaveRepository.updateSave(saveId, updates): boolean`（同步；不提供 `appendNarrativeMessage`，需通过 loadSave + updateSave({ narrativeLog }) 组合实现消息追加）
- `GameTableRepository.applyTableEdits(saveId, commands): { success: boolean; changes: {...} }`（同步；返回值含 `success` 包装层，需解构 `.changes`）

**处理**：`GameNarrativeService` 中 `GameRepositoryLike` / `GameSaveRepositoryLike` / `GameTableRepositoryLike` 三个接口契约严格对齐实际同步签名。`gatherContext` / `applyTableEditsIfNeeded` / `persistNarrativeMessage` 三个方法改为同步调用（移除 `await`）。

#### 重要发现 3：模板信息流跨进程传递

**现象**：`GameTypeTemplate` 接口在渲染进程定义（含 React 组件 `Component` 字段），主进程无法直接 import（会引入 React 到主进程）。

**处理**：spec 中已预见此问题，解决方案为：渲染进程在调用 `generateNarrative` 时，将模板的 `templateSystemPrompt` 与 `tableSchema` 作为 `GameNarrativeRequest` 的可选字段传入主进程。已在 `src/shared/types/game.types.ts` 的 `GameNarrativeRequest` 接口中新增这两个可选字段。

**后续注意**：Task 5（IPC handler）实现 `gameNarrativeHandlers.ts` 时，渲染进程调用方需从 `GameTemplateRegistry.get(gameType).template` 取出 `tableSchema` 与 `templateSystemPrompt` 后传入 IPC 参数。

### Task 5 完成（2026-07-05）：IPC handler 与 preload 桥接

#### 重点 1：vi.mock 提升与 vi.hoisted 模式

**现象**：集成测试需在 `vi.mock` 工厂内引用共享状态（如临时目录路径 `tmpRoot`、IPC handler 注册表 `ipcHandlers`、mock stream 配置 `mockStreamChunksRef` 等），但 `vi.mock` 工厂在文件 import 之前执行（提升至文件顶部），普通 `const` 变量在工厂内不可访问，会抛 `ReferenceError: Cannot access 'X' before initialization`。

**根因**：vitest 的 `vi.mock` 调用是提升（hoisted）的，会在所有 import 之前执行；而普通的 `const`/`let` 声明遵循 TDZ（暂时性死区）规则，提升后无法访问。

**解决方案**：使用 `vi.hoisted(() => ({ value: ... }))` 创建可变对象引用，工厂内通过 `obj.value` 读取。例如：

```typescript
const { tmpRootRef, ipcHandlers, mockStreamChunksRef } = vi.hoisted(() => ({
  tmpRootRef: { value: '' },
  ipcHandlers: new Map<string, IpcHandler>(),
  mockStreamChunksRef: { value: [] as string[] },
}));

vi.mock('../../../utils/appPath', () => ({
  getUserDataPath: () => tmpRootRef.value,
}));
```

**后续注意**：在 `__tests__/` 下新增集成测试时，所有 `vi.mock` 工厂内引用的状态必须通过 `vi.hoisted` 创建。

#### 重点 2：副作用模块的级联 mock

**现象**：`AIService` 间接 import 的 `storageService.ts`（行 726 `export default getStorageService()`）与 `storageManager.ts`（行 663 `export default getStorageManager()`）均为副作用模块，import 时即触发 `StorageManager` 初始化（依赖 `electron app.getPath('userData')`，未 mock 时会抛 `electron-store` 初始化错误：`The "path" argument must be of type string. Received undefined`）。

**根因**：即使 mock 了 `AIService`，真实 `storageService.ts` 与 `storageManager.ts` 仍可能被其他模块（如 `chatLogService` 等）间接 import 触发加载。

**解决方案**：在集成测试中显式 mock `services/storageService` 与 `services/storageManager` 两个模块：

```typescript
vi.mock('../../../../services/storageService', () => ({
  getStorageService: vi.fn(() => ({})),
  default: {},
}));
vi.mock('../../../../services/storageManager', () => ({
  getStorageManager: vi.fn(() => ({})),
  StorageManager: vi.fn(),
  default: {},
}));
```

**后续注意**：任何依赖 AIService 的集成测试都需同时 mock 这两个副作用模块。

#### 重点 3：vi.mock 路径深度

**现象**：测试文件位于 `src/main/ipc/handlers/game/__tests__/`，比被测的 `src/main/services/` 多两层目录，相对路径需 `../../../../services/AIService`（4 个 `../`）而非 3 个。

**根因**：初次编写时误用 3 个 `../`，导致 vi.mock 路径无法解析到真实模块，mock 未生效，真实 `storageManager.ts` 被加载触发 `electron-store` 初始化错误。

**解决方案**：在编写 `__tests__/` 子目录下的测试时，使用 PowerShell `Test-Path` 或类似工具验证相对路径深度。

#### 重点 4：tableEdit 协议格式（函数式而非 XML）

**现象**：`GameTableEditParser` 期望的是函数式语法 `insertRow(sheetIndex, {"colIndex":"value"})`（HTML 注释包裹 `<!-- <tableEdit>...</tableEdit> -->`），而非 XML 格式 `<tableEdit><command type="insertRow">...`。

**根因**：与对话模式 / 写作模式的 tableEdit 协议保持一致（参考 `src/main/services/memory/tableEditParser.ts` 的正则规则）。

**影响**：测试用例初次使用 XML 格式导致 `commands` 解析为空，`game:table:updated` 事件未推送。

**解决方案**：测试用例修正为函数式语法 `<!-- <tableEdit>\ninsertRow(1, {"1":"res-1","3":"金币","4":"100"})\n</tableEdit> -->` 后通过。

**后续注意**：渲染进程在显示 AI 回复或调试 tableEdit 时，需使用与解析器一致的函数式格式。

### Task 6 完成（2026-07-05）：渲染进程 store

#### 重点 1：测试中 mock window.electronAPI 的时机（vi.hoisted 模式）

**现象**：`gameStore.ts` 在模块加载顶层调用 `setupGameEventListeners()`，订阅 `window.electronAPI.game` 的 4 个 IPC 事件。测试时若按常规模式 `import { useGameStore } from '../gameStore'` 然后在 `beforeEach` 中通过 `vi.stubGlobal('window', ...)` 设置 mock，则订阅器在 import 时执行——此时 `window` 尚未定义，订阅被跳过，测试无法验证事件回调路由。

**根因**：ESM 规范将所有 `import` 提升至模块顶部执行，且不允许在 import 之间穿插赋值语句。`beforeEach` 在 import 完成后才执行，为时已晚。

**解决方案**：使用 vitest 的 `vi.hoisted()` API——其回调会在所有 import 之前执行，可在此设置 `globalThis.window.electronAPI.game`。返回值（mock API 与捕获的回调列表）通过解构在测试用例中访问：

```typescript
const { mockGameApi, capturedListeners } = vi.hoisted(() => {
  const listeners = { chunk: [], complete: [], error: [], tableUpdated: [] };
  const api = { list: vi.fn(), /* ... */, onNarrativeChunk: vi.fn((cb) => { listeners.chunk.push(cb); return () => {}; }) /* ... */ };
  (globalThis as any).window = { electronAPI: { game: api } };
  return { mockGameApi: api, capturedListeners: listeners };
});

// 此时 window 已就绪，订阅器执行时会拿到 mock
import { useGameStore } from '../gameStore';
```

**后续注意**：在 `src/renderer/stores/__tests__/` 下新增任何依赖 `window.electronAPI` 的 store 测试时，必须复用 `vi.hoisted` 模式。`mockGameApi` 的 `on*` 监听器需将回调推入 `capturedListeners`，测试用例可直接调用 `capturedListeners.chunk[0](...)` 模拟主进程推送事件。

#### 重点 2：相对路径深度易错（`stores/__tests__/` 子目录）

**现象**：测试文件位于 `src/renderer/stores/__tests__/gameStore.test.ts`，被测文件位于 `src/renderer/stores/gameStore.ts`，相对 `src/shared/types/game.types.ts` 的路径应为 `../../../shared/types/game.types`（3 个 `../`）。初次编写误用 4 个 `../`（参照了 `src/renderer/components/Game/templates/__tests__/` 下需要 5 个 `../` 的旧例），导致 `tsc` 报 `TS2307: Cannot find module`。

**根因**：不同深度的 `__tests__/` 子目录对 `shared/` 的相对路径深度不同，容易混淆。

**解决方案**：参照同目录已有的 store 文件 `src/renderer/stores/writingProjectStore.ts`（用 `../../shared/types/writing.types` 即 2 个 `../`），加上 `__tests__/` 多一层即 3 个 `../`。

**后续注意**：编写测试时使用 `Test-Path` 或类似工具验证相对路径深度，避免参照不同深度的旧例。

#### 重点 3：`import type` 与 enum 值用法

**现象**：测试中 `import type { GameType, GameStatus, GameTableEditCommandType }` 后用 `GameType.MANAGEMENT` 等值访问，触发 `tsc` 报 `TS1361: 'GameType' cannot be used as a value because it was imported using 'import type'`。

**根因**：`import type` 仅导入类型，不导入运行时值。枚举（enum）既是类型也是值，作为值使用时必须用常规 `import`。

**解决方案**：拆分为两个 import 语句——值用 `import`，类型用 `import type`：

```typescript
import {
  GameType, GameStatus, GameTableEditCommandType,
  type GameMeta, type GameIndexEntry, /* ... */
} from '../../../shared/types/game.types';
```

**后续注意**：TypeScript 5.3 的 `isolatedModules: true` 模式下，`import type` 会被编译器完全擦除，运行时不可访问。enum 作为运行时值必须用常规 `import`。

#### 重点 4：electron.d.ts 需提前补全 game 命名空间类型

**现象**：Task 5（preload 实现）与 Task 6（store 实现）并行开发。Task 6 的 `gameStore.ts` 大量访问 `window.electronAPI.game.*`，但 `src/renderer/types/electron.d.ts` 中 `ElectronAPI` 接口尚未声明 `game` 命名空间（属 Task 5 工作范围），导致 `tsc` 报 `TS2339: Property 'game' does not exist on type 'ElectronAPI'`。

**根因**：spec 任务划分将 `electron.d.ts` 的类型声明放在 Task 5，但 Task 6 的代码需要这些类型才能 typecheck。并行开发时存在类型依赖反向。

**解决方案**：Task 6 在 `electron.d.ts` 中提前补全 `game` 命名空间的类型声明（与 preload API 契约完全一致）。声明文件（.d.ts）可重复声明同一类型而不冲突，Task 5 后续在 preload.ts 实现运行时桥接时无需重复声明，无回归风险。

**后续注意**：后续并行任务若存在类似的"类型声明归属任务 A，但任务 B 代码需要类型"的依赖反向，可由先完成任务的一方在 .d.ts 中提前补全，避免阻塞另一方。


