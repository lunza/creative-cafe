# Tasks

## 阶段一：游戏模式整体框架（必做，所有后续任务的前置）

- [x] Task 1: 定义游戏模式共享类型与常量
  - [x] SubTask 1.1: 创建 `src/shared/types/game.types.ts` —— 定义 `GameType` 枚举（WEREWOLF / MYSTERY / DATING_SIM / MANAGEMENT / TEXT_RPG）、`GameMeta`、`GameSave`、`GameTableData`（对齐 `WritingTableData` 结构）、`GameConfig`、`GameResourceConfig`、`GameTypeTemplate` 接口、`GameNarrativeRequest`、`GameNarrativeChunk` 等类型
  - [x] SubTask 1.2: 在 `src/shared/types/index.ts` 追加 `export * from './game.types'`（注意冲突消解：`GameTableData` 不与 `WritingTableData` 同名）
  - [x] SubTask 1.3: 创建 `src/shared/constants/game.constants.ts` —— 定义 `GAME_STATUS_LABELS`、`GAME_TYPE_LABELS`、`DEFAULT_GAME_TABLE_SCHEMA`、`AUTO_SAVE_INTERVAL_MS` 等常量
  - [x] SubTask 1.4: 编写单元测试 `src/shared/types/__tests__/game.types.test.ts` 验证枚举值与类型可被正确导入

- [x] Task 2: 实现游戏元数据与存档仓储（主进程）
  - [x] SubTask 2.1: 创建 `src/main/services/game/GameRepository.ts` —— 管理 `data/games/games-index.json`（游戏元数据索引）与 `data/games/<gameId>/meta.json`（单个游戏元数据）；提供 `listGames / getGameMeta / createGameMeta / updateGameMeta / deleteGameMeta` 方法；复用 `safeWriteFile` 模式
  - [x] SubTask 2.2: 创建 `src/main/services/game/GameSaveRepository.ts` —— 管理存档目录 `data/game-saves/<saveId>/`，包含 `save.json`（元数据 + 剧情日志）、`tables/table-data.json`（表格快照）、`tables/table-versions.json`（表格版本快照）、`state-snapshot.json`（模板自定义状态）；提供 `createSave / loadSave / listSaves / deleteSave / updateSave` 方法；自动存档保留最近 5 个
  - [x] SubTask 2.3: 创建 `src/main/services/game/GameTableRepository.ts` —— 复用 `WritingTableRepository` 的 `applyTableEdits / compareTableData / deduplicateTableData / getVersionSnapshot / confirmVersion / rollbackVersion` 模式，但路径前缀指向游戏存档目录；提供 `getTableData / saveTableData / applyTableEdits / getVersionSnapshot / confirmVersion / rollbackVersion`
  - [x] SubTask 2.4: 编写单元测试 `src/main/services/game/__tests__/GameRepository.test.ts` 与 `GameSaveRepository.test.ts`（覆盖 CRUD、自动存档轮转、表格快照写入）

- [x] Task 3: 实现 AI 叙事服务与 Prompt 构建器（主进程）
  - [x] SubTask 3.1: 创建 `src/main/services/game/GamePromptBuilder.ts` —— 提供 `buildSystemPrompt(gameMeta, template, tableSchema)` 与 `buildNarrativePrompt(userAction, gameStateSnapshot, memoryTableData, tableStructure)` 方法；复用 `creative-chat.async-table-instructions` 模板系统的同款 `<tableEdit>` 协议（HTML 注释包裹、insertRow/updateRow/deleteRow 命令）
  - [x] SubTask 3.2: 创建 `src/main/services/game/GameNarrativeService.ts` —— 注入 `AIService` 与 `GameTableRepository`；提供 `generateNarrative(request, callbacks)` 方法，调用 `AIService.callStream`，通过 `callbacks.onChunk` 推送流式片段，结束后解析末尾 `<tableEdit>` 标签并调用 `GameTableRepository.applyTableEdits`，最后回调 `onComplete({ fullText, tableChanges })`
  - [x] SubTask 3.3: 创建 `src/main/services/game/GameTableEditParser.ts` —— 复用对话模式与写作模式的 `<tableEdit>` 解析逻辑（可抽取为共享工具 `src/main/services/ai/TableEditParser.ts`，但本任务先在 game 模块内部实现，避免影响既有模块）
  - [x] SubTask 3.4: 编写单元测试 `src/main/services/game/__tests__/GamePromptBuilder.test.ts` 与 `GameTableEditParser.test.ts`（覆盖空回复、无 tableEdit、多命令、格式错误的容错）

- [x] Task 4: 实现游戏类型模板注册中心（渲染进程）
  - [x] SubTask 4.1: 创建 `src/renderer/components/Game/templates/GameTemplateRegistry.ts` —— 提供 `register(type, template)` / `get(type)` / `list()` 方法；`GameTypeTemplate` 接口包含 `type`、`meta`（标题/副标题/介绍等）、`panels`（声明所需面板 key）、`tableSchema`、`Component`（懒加载的 React 组件）、`serializeState` / `deserializeState`、`onOtherAction`
  - [x] SubTask 4.2: 创建占位模板 `src/renderer/components/Game/templates/MysteryTemplate.ts` / `DatingSimTemplate.ts` / `WerewolfTemplate.ts` / `TextRpgTemplate.ts` —— 仅声明 meta 与"开发中"状态，不实现具体面板，供大厅展示
  - [x] SubTask 4.3: 编写单元测试 `src/renderer/components/Game/templates/__tests__/GameTemplateRegistry.test.ts`

- [x] Task 5: 实现 IPC handler 与 preload 桥接
  - [x] SubTask 5.1: 创建 `src/main/ipc/handlers/game/gameMetaHandlers.ts` —— 注册 `game:list / game:getMeta / game:createGame / game:updateGame / game:deleteGame`，使用 `wrapHandler` 高阶函数
  - [x] SubTask 5.2: 创建 `src/main/ipc/handlers/game/gameSaveHandlers.ts` —— 注册 `game:createSave / game:loadSave / game:listSaves / game:deleteSave / game:save`
  - [x] SubTask 5.3: 创建 `src/main/ipc/handlers/game/gameTableHandlers.ts` —— 注册 `game:getTableData / game:saveTableData / game:applyTableEdits / game:getVersionSnapshot / game:confirmVersion / game:rollbackVersion`
  - [x] SubTask 5.4: 创建 `src/main/ipc/handlers/game/gameNarrativeHandlers.ts` —— 注册 `game:generateNarrative`，处理流式回调通过 `event.sender.send('game:narrative:chunk', ...)` 推送；提供 `abortAllActiveGameRequests()` 用于取消
  - [x] SubTask 5.5: 创建 `src/main/ipc/handlers/game/gameConfigHandlers.ts` —— 注册 `game:getConfig / game:saveConfig`（每个游戏的本地配置，如 AI 引擎选择、温度、ANSI 主题）
  - [x] SubTask 5.6: 创建聚合入口 `src/main/ipc/handlers/gameHandlers.ts`，导出 `registerGameHandlers()` 与 `abortAllActiveGameRequests()`
  - [x] SubTask 5.7: 在 `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 中调用 `registerGameHandlers()`
  - [x] SubTask 5.8: 在 `src/main/preload.ts` 新增 `game` 命名空间，对齐 `writing` 命名空间的结构（含 `onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated` 事件监听器）
  - [x] SubTask 5.9: 编写 IPC 集成测试 `src/main/ipc/handlers/game/__tests__/gameHandlers.test.ts`（覆盖 list / createSave / generateNarrative 流式事件序列）

- [x] Task 6: 实现渲染进程 store
  - [x] SubTask 6.1: 创建 `src/renderer/stores/gameStore.ts` —— 管理游戏列表、当前游戏 ID、当前存档 ID、剧情日志数组、表格数据快照、生成状态；提供 `loadGames / selectGame / startNewGame / loadSave / saveGame / appendNarrativeChunk / applyTableEdits` 等 action
  - [x] SubTask 6.2: 创建 `src/renderer/stores/gameUIStore.ts` —— 管理 UI 状态：当前视图（lobby / detail / main / options / gallery / saves）、面板折叠状态、ANSI 主题选择、左侧叙事面板滚动位置
  - [x] SubTask 6.3: 编写单元测试 `src/renderer/stores/__tests__/gameStore.test.ts` 与 `gameUIStore.test.ts`

- [x] Task 7: 启用 CreationCenter 的 game 面板
  - [x] SubTask 7.1: 修改 `src/renderer/components/Chat/CreationCenter.tsx` —— 移除 `panelConfig.game.comingSoon` 字段，新增 `showGameDialog` state，在 `handlePanelClick` 中 `panel === 'game'` 时 `setShowGameDialog(true)`
  - [x] SubTask 7.2: 仿 `WritingModeDialog` 创建 `GameModeDialog` 内联组件，懒加载 `GameModeEntry`，全屏覆盖
  - [x] SubTask 7.3: 在 `src/renderer/components/Game/index.ts` 导出 `GameModeEntry`
  - [x] SubTask 7.4: 手动验证：点击 game 面板可打开全屏对话框，关闭后返回创作中心

- [x] Task 8: 实现 GameModeEntry 容器与视图切换
  - [x] SubTask 8.1: 创建 `src/renderer/components/Game/GameModeEntry.tsx` —— 顶层容器，根据 `gameUIStore.currentView` 渲染 `GameLobby` / `GameDetailPage` / `GameMainPage`，使用 `PageTransition` 动画
  - [x] SubTask 8.2: 创建 `src/renderer/components/Game/GameModeEntry.css` —— 全屏布局、过渡动画
  - [x] SubTask 8.3: 在 `GameModeEntry` 挂载时调用 `gameStore.loadGames()`，加载游戏列表
  - [x] SubTask 8.4: 创建 `GameLobby.tsx` / `GameDetailPage.tsx` / `GameMainPage.tsx` 占位组件（Task 9 / 10 / 11 将实现完整版），并通过 `React.lazy` 懒加载
  - [x] SubTask 8.5: 编写单元测试 `src/renderer/components/Game/__tests__/GameModeEntry.test.tsx`（覆盖 `resolveBaseView` 纯函数与容器渲染、视图切换、对话框视图回退渲染）
  - [x] SubTask 8.6: 修复 `vitest.config.ts` 的 include 模式以拾取 `.tsx` 测试文件（**重点问题**：原 `include: ['src/**/*.test.ts']` 静默跳过所有组件级 `.tsx` 测试），并更新 `tasks.md` / `checklist.md` / `CHANGELOG.md`

- [x] Task 9: 实现游戏大厅页
  - [x] SubTask 9.1: 创建 `src/renderer/components/Game/GameLobby.tsx` —— 顶部筛选区（类别 Select / 搜索 Input / 排序 Select）+ 卡片网格（antd Row/Col）
  - [x] SubTask 9.2: 创建 `src/renderer/components/Game/GameCard.tsx` —— 单张卡片：封面占位 / 标题 / 副标题 / 类别徽标 / 状态徽标（已完成 Tag 绿色 / 开发中 Tag 橙色）/ 简短介绍 / 最后更新时间；hover 显示"进入详情"提示
  - [x] SubTask 9.3: 创建 `src/renderer/components/Game/GameLobby.css`
  - [x] SubTask 9.4: 实现筛选/搜索/排序逻辑 —— 在 `gameStore` 派生 `filteredGames` selector，或在组件内 useMemo
  - [x] SubTask 9.5: 实现空状态 —— 使用 antd Empty 组件，文案"暂无匹配游戏"
  - [x] SubTask 9.6: 卡片点击 → `gameUIStore.setCurrentView('detail')` + `gameStore.selectGame(gameId)`

- [x] Task 10: 实现游戏详情页
  - [x] SubTask 10.1: 创建 `src/renderer/components/Game/GameDetailPage.tsx` —— 左侧元数据区（封面 / 标题 / 副标题 / 类别徽标 / 开发者 / 版本 / 状态），右侧详细介绍 + 玩法说明 + 操作按钮区
  - [x] SubTask 10.2: 实现操作按钮区 —— 开始游戏（主按钮）/ 读取存档 / 选项 / 画廊 / 其他（如模板未注册 onOtherAction 则隐藏）/ 关闭；按钮样式参考 `WritingModeEntry` 的 antd Button
  - [x] SubTask 10.3: 创建 `src/renderer/components/Game/GameSaveDialog.tsx` —— antd Modal + List，展示存档槽位，含存档名 / 最后保存时间 / 当前剧情节点 / 删除按钮；选中后确认加载
  - [x] SubTask 10.4: 创建 `src/renderer/components/Game/GameOptionsDialog.tsx` —— antd Modal + Form，配置 AI 引擎选择（从 `useSettingStore` 读取）、温度、最大 token、表格整理模式（sync/async）、ANSI 配色主题
  - [x] SubTask 10.5: 创建 `src/renderer/components/Game/GameGalleryDialog.tsx` —— antd Modal + 空状态占位（首期无 CG，留接口供模板填充）
  - [x] SubTask 10.6: 实现"开始游戏"流程 —— 调用 `gameStore.startNewGame(gameId)` 创建存档 → `gameUIStore.setCurrentView('main')`
  - [x] SubTask 10.7: 实现"读取存档"流程 —— 弹出 `GameSaveDialog`，选中后 `gameStore.loadSave(saveId)` → `gameUIStore.setCurrentView('main')`
  - [x] SubTask 10.8: 实现"关闭"返回逻辑 —— 优先返回上一级视图（详情页 → 大厅），无上一级则返回大厅
  - [x] SubTask 10.9: 创建 `src/renderer/components/Game/GameDetailPage.css`

- [x] Task 11: 实现游戏主页面通用框架
  - [x] SubTask 11.1: 创建 `src/renderer/components/Game/GameMainPage.tsx` —— 顶部状态栏（游戏标题 / 当前节点 / 存档按钮 / 设置按钮 / 退出按钮）+ 左侧叙事面板 + 右侧模板面板区
  - [x] SubTask 11.2: 创建 `src/renderer/components/Game/panels/NarrativePanel.tsx` —— 流式文本显示区（使用 `react-markdown` + `rehype-raw`，复用 `CharacterDialogueChat` 的 MessageRenderer 思路）+ 选项区（按钮列表，点击触发 `gameStore.generateNarrative`）+ 用户输入框（自由文本输入）
  - [x] SubTask 11.3: 创建 `src/renderer/components/Game/panels/GameStateBar.tsx` —— 顶部状态栏组件
  - [x] SubTask 11.4: 创建 `src/renderer/components/Game/GameMainPage.css`
  - [x] SubTask 11.5: 实现退出确认 —— 点击"退出"按钮弹出 antd Modal 确认，提示"未保存进度将丢失"（实际已自动存档，仅为 UX 提示）
  - [x] SubTask 11.6: 实现流式叙事订阅 —— 在 `NarrativePanel` 挂载时通过 `window.electronAPI.game.onNarrativeChunk` 订阅，卸载时取消

- [x] Task 12: 实现 ANSI 字符瓦片地图组件
  - [x] SubTask 12.1: 创建 `src/renderer/components/Game/AnsiTileMap.tsx` —— 接收 `tiles: string[][]`、`tileStyles: Record<string, { color, background, label }>`、`onTileClick`；用 CSS Grid 渲染，每个瓦片为 div，按字符映射样式
  - [x] SubTask 12.2: 创建 `src/renderer/components/Game/AnsiTileMap.css` —— 等宽字体、瓦片最小尺寸、hover 高亮、点击波纹
  - [x] SubTask 12.3: 实现 ANSI 转义序列解析 —— 支持 `\x1b[31m`（红色）等基础 SGR 序列，转换为内联 style；不支持复杂序列时退化为字符显示
  - [x] SubTask 12.4: 编写单元测试 `src/renderer/components/Game/__tests__/AnsiTileMap.test.tsx`（覆盖基础渲染、点击事件、ANSI 解析）

- [x] Task 13: 实现通用面板组件（资源 / 设施 / 统计等可复用面板）
  - [x] SubTask 13.1: 创建 `src/renderer/components/Game/panels/ResourcePanel.tsx` —— 从表格数据派生资源列表（金币 / 食物 / 木材 / 人口等），antd Statistic + Card 展示
  - [x] SubTask 13.2: 创建 `src/renderer/components/Game/panels/FacilityPanel.tsx` —— 已建设施列表 + 可建设施列表 + 建造按钮；点击建造触发 `gameStore.generateNarrative({ userAction: 'build:facility_id' })`
  - [x] SubTask 13.3: 创建 `src/renderer/components/Game/panels/StatisticsPanel.tsx` —— 当前回合 / 总收入 / 总支出 / 净利润（首期用 antd Statistic，图表留接口）
  - [x] SubTask 13.4: 创建 `src/renderer/components/Game/panels/CollapsiblePanel.tsx` —— 折叠容器，复用 antd Collapse，状态由 `gameUIStore` 持久化
  - [x] SubTask 13.5: 创建 `src/renderer/components/Game/panels/panels.css` —— 统一 Card 间距、Statistic 网格响应式、建造按钮 hover 效果
  - [x] SubTask 13.6: 创建 `src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx` —— 15 个测试用例覆盖空状态/数据渲染/字段映射/数量显示/变化字段颜色

## 阶段二：文字模拟经营游戏完整实现

- [x] Task 14: 实现文字模拟经营游戏模板
  - [x] SubTask 14.1: 创建 `src/renderer/components/Game/templates/management/ManagementGameTemplate.tsx` —— 实现 `GameTypeTemplate` 接口，声明 `panels: ['resource', 'facility', 'statistics']`、`tableSchema`（sheets: characters / resources / facilities / events / stats）、`Component`（懒加载 `ManagementGameMain`）
  - [x] SubTask 14.2: 创建 `src/renderer/components/Game/templates/management/ManagementGameMain.tsx` —— 主组件，渲染 `GameMainPage` 框架 + 注入模板面板
  - [x] SubTask 14.3: 创建 `src/renderer/components/Game/templates/management/managementSchema.ts` —— 定义表格 schema：characters sheet（id / name / role / status）、resources sheet（id / name / amount / change_per_turn）、facilities sheet（id / name / level / cost / production）、events sheet（id / turn / description / effect）、stats sheet（key / value）
  - [x] SubTask 14.4: 创建 `src/renderer/components/Game/templates/management/managementInitialState.ts` —— 初始状态：金币 500、食物 50、木材 30、人口 5、回合 1
  - [x] SubTask 14.5: 实现 `serializeState` / `deserializeState` —— 将模板自定义状态（如建筑升级路径、随机事件种子）序列化为 JSON
  - [x] SubTask 14.6: 注册模板到 `GameTemplateRegistry`（在 `GameModeEntry` 初始化时调用）

- [x] Task 15: 实现经营游戏的 AI 叙事生成
  - [x] SubTask 15.1: 创建 `src/main/services/game/templates/management/ManagementPromptBuilder.ts` —— 构建 system prompt：扮演经营游戏旁白 AI，遵守经营类游戏规则（资源经济、回合制、随机事件），输出剧情 + tableEdit
  - [x] SubTask 15.2: 创建 `src/main/services/game/templates/management/ManagementNarrativeService.ts` —— 包装 `GameNarrativeService`，注入经营模板的 prompt builder；处理特定 userAction（如 `build:farm` → 资源扣除 + 触发叙事）
  - [x] SubTask 15.3: 实现"结束回合"逻辑 —— 在 `GameNarrativeService` 之上封装 `endTurn(saveId)`：读取当前资源 → 结算产出 → 触发随机事件（概率配置）→ 回合数 +1 → 触发 AI 叙事生成
  - [x] SubTask 15.4: 编写集成测试 `src/main/services/game/templates/management/__tests__/ManagementNarrativeService.test.ts`（mock AIService，验证 prompt 包含资源快照、tableEdit 命令被正确应用）

- [x] Task 16: 实现经营游戏的端到端游戏循环
  - [x] SubTask 16.1: 在 `ManagementGameMain` 中接入 `ResourcePanel` / `FacilityPanel` / `StatisticsPanel`，数据源为 `gameStore.tableData`
  - [x] SubTask 16.2: 实现设施建造流程 —— `FacilityPanel` 点击建造 → 校验资源（前端校验 + 后端校验双重保险）→ 扣除资源（前端乐观更新）→ 触发 `gameStore.generateNarrative({ userAction: 'build:farm' })` → 后端在叙事生成前应用资源变更到 tableEdit
  - [x] SubTask 16.3: 实现"结束回合"按钮 —— 在 `GameStateBar` 显示当前回合，点击"结束回合"调用 `gameStore.endTurn()`，等待 AI 叙事生成
  - [x] SubTask 16.4: 实现场景：玩家选择"招募农夫"（消耗金币 + 增加人口）→ AI 叙事描述新角色加入 → tableEdit 在 characters sheet 新增行
  - [x] SubTask 16.5: 手动验证完整游戏循环：开场 → 建造 → 招募 → 结束回合 → 自动存档 → 退出 → 读档恢复

- [x] Task 17: 注册示例经营游戏元数据
  - [x] SubTask 17.1: 创建 `data/games/games-index.json` —— 包含一个示例游戏"田园小镇"（id: `pastoral_town`、type: MANAGEMENT、status: completed）
  - [x] SubTask 17.2: 创建 `data/games/pastoral_town/meta.json` —— 详细元数据：标题"田园小镇"、副标题"经营你的梦想农场"、开发者信息、版本 1.0.0、详细介绍、玩法说明
  - [x] SubTask 17.3: 在 `GameRepository` 启动时如发现 `games-index.json` 不存在，写入默认示例索引

## 阶段三：优化、文档与后续规划

- [x] Task 18: 编写技术文档 `doc/10-game-mode-module.md`
  - [x] SubTask 18.1: 编写模块功能描述、模块定位与业务价值章节
  - [x] SubTask 18.2: 编写组件树章节 —— `GameModeEntry` → `GameLobby` / `GameDetailPage` / `GameMainPage` → `panels/*` → `templates/*`
  - [x] SubTask 18.3: 编写 IPC 接口表 —— 列出所有 `game:*` 频道、参数、返回值、流式事件
  - [x] SubTask 18.4: 编写表格 schema 章节 —— 经营游戏的 5 个 sheet 结构、AI 如何生成 tableEdit、版本快照机制
  - [x] SubTask 18.5: 编写 AI prompt 构建流程章节 —— system prompt 拼装顺序、user prompt 拼装顺序、tableEdit 协议
  - [x] SubTask 18.6: 编写 ANSI 瓦片渲染原理章节 —— CSS Grid 实现、ANSI 转义序列解析、性能考量
  - [x] SubTask 18.7: 编写扩展指南 —— 如何新增游戏类型（实现 `GameTypeTemplate`、注册、配置 schema、实现 prompt builder）
  - [x] SubTask 18.8: 编写后续游戏类型实现规划 —— 狼人杀（多人推理、阶段制）/ 逆转裁判类推理（证据系统、法庭辩论）/ 恋爱模拟（好感度图谱、约会事件）/ 文字 RPG（战斗系统、技能树、装备），各类型的关键技术点与预估工作量

- [x] Task 19: 补充测试与回归验证
  - [x] SubTask 19.1: 补充 `src/renderer/components/Game/__tests__/GameLobby.test.tsx`（筛选/搜索/排序/空状态）—— Task 9 已实现 24 个测试覆盖
  - [x] SubTask 19.2: 补充 `src/renderer/components/Game/__tests__/GameDetailPage.test.tsx`（按钮显隐、点击跳转）—— Task 10 已实现 12 个测试覆盖
  - [x] SubTask 19.3: 补充 `src/renderer/components/Game/__tests__/GameMainPage.test.tsx`（视图切换、流式订阅取消）—— Task 11 已实现 11 个测试覆盖
  - [x] SubTask 19.4: 运行全量测试 `npm test`，确保既有 420 个测试不受影响 —— 44 个测试文件 / 968 个测试全部通过
  - [x] SubTask 19.5: 运行 `npm run typecheck` 与 `npm run lint` —— typecheck 在 game 模块文件上无错误；lint 因预存 eslint-plugin-react-hooks 插件缺失无法运行（非本模块问题）
  - [x] SubTask 19.6: 补充面板组件测试 —— 新增 FacilityPanel.test.tsx / StatisticsPanel.test.tsx / CollapsiblePanel.test.tsx（52 个新测试用例）

- [x] Task 20: 实现过程中的 bug 与重点问题标记
  - [x] SubTask 20.1: 在开发过程中如发现 bug 或需用户反复提示解决的问题，在 `doc/10-game-mode-module.md` 末尾新增"已知问题与经验教训"章节重点标记（参考 `doc/09-optimization-and-common-issues.md` 的格式）

# Task Dependencies

- Task 1（类型与常量）是所有后续任务的前置
- Task 2（仓储）、Task 3（叙事服务）、Task 4（模板注册中心）依赖 Task 1，可并行
- Task 5（IPC + preload）依赖 Task 2 + Task 3
- Task 6（store）依赖 Task 5（preload 接口定义）
- Task 7（启用 game 面板）独立于上述任务，仅修改 CreationCenter，可早期并行
- Task 8（GameModeEntry 容器）依赖 Task 6 + Task 7
- Task 9（大厅）、Task 10（详情页）、Task 11（主页面框架）、Task 12（ANSI 瓦片）、Task 13（通用面板）依赖 Task 8，可并行
- Task 14（经营模板）依赖 Task 4 + Task 11 + Task 13
- Task 15（经营叙事服务）依赖 Task 3 + Task 14
- Task 16（端到端循环）依赖 Task 14 + Task 15
- Task 17（示例游戏元数据）依赖 Task 2 + Task 14
- Task 18（文档）依赖 Task 1~17 全部完成
- Task 19（测试与回归）依赖 Task 18
- Task 20（bug 标记）贯穿全流程

# 并行执行建议

- 阶段一可分 3 个并行流：(Task 2 + Task 3 + Task 4 + Task 5 主进程侧) | (Task 6 + Task 7 渲染侧) | (Task 12 ANSI 瓦片独立组件)
- 阶段二 Task 14 与 Task 15 可并行（前者渲染，后者主进程）
- 阶段三 Task 18 文档与 Task 19 测试可并行
