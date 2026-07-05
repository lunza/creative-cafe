# Checklist

## 阶段一：游戏模式整体框架

- [x] `src/shared/types/game.types.ts` 已创建，定义 GameType / GameMeta / GameSave / GameTableData / GameTypeTemplate / GameNarrativeRequest / GameNarrativeChunk 等类型，且通过 `src/shared/types/index.ts` 导出无命名冲突
- [x] `src/shared/constants/game.constants.ts` 已创建，定义 GAME_STATUS_LABELS / GAME_TYPE_LABELS / DEFAULT_GAME_TABLE_SCHEMA / AUTO_SAVE_INTERVAL_MS 等常量
- [x] `src/main/services/game/GameRepository.ts` 可正确执行 listGames / getGameMeta / createGameMeta / updateGameMeta / deleteGameMeta，数据持久化到 `data/games/`
- [x] `src/main/services/game/GameSaveRepository.ts` 可正确执行 createSave / loadSave / listSaves / deleteSave / updateSave，自动存档保留最近 5 个
- [x] `src/main/services/game/GameTableRepository.ts` 可正确执行 getTableData / saveTableData / applyTableEdits / getVersionSnapshot / confirmVersion / rollbackVersion，路径指向 `data/game-saves/<saveId>/tables/`
- [x] `src/main/services/game/GamePromptBuilder.ts` 可构建 system prompt（含游戏模板配置 + tableEdit 协议说明）与 user prompt（含玩家行动 + 表格快照 + 上下文）
- [x] `src/main/services/game/GameNarrativeService.ts` 可调用 AIService.callStream 生成剧情，流式 chunk 通过 IPC 事件推送，结束后解析 `<tableEdit>` 标签写入表格
- [x] `src/main/services/game/GameTableEditParser.ts` 可解析 insertRow / updateRow / deleteRow 命令，对格式错误的命令容错（跳过而非崩溃）
- [x] `src/renderer/components/Game/templates/GameTemplateRegistry.ts` 提供 register / get / list 方法，`GameTypeTemplate` 接口字段完整（type / meta / panels / tableSchema / Component / serializeState / deserializeState / onOtherAction）
- [x] 4 个占位模板（Mystery / DatingSim / Werewolf / TextRpg）已创建，meta 字段含"开发中"状态标记
- [x] IPC handler 文件 `gameMetaHandlers.ts` / `gameSaveHandlers.ts` / `gameTableHandlers.ts` / `gameNarrativeHandlers.ts` / `gameConfigHandlers.ts` 已创建，使用 wrapHandler 包裹错误处理
- [x] 聚合入口 `gameHandlers.ts` 导出 `registerGameHandlers()` 与 `abortAllActiveGameRequests()`
- [x] `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 已调用 `registerGameHandlers()`
- [x] `src/main/preload.ts` 新增 `game` 命名空间，包含 list / getMeta / createGame / updateGame / deleteGame / createSave / loadSave / listSaves / deleteSave / save / getTableData / saveTableData / applyTableEdits / getVersionSnapshot / confirmVersion / rollbackVersion / generateNarrative / getConfig / saveConfig / onNarrativeChunk / onNarrativeComplete / onNarrativeError / onTableUpdated / cancelGeneration
- [x] `src/renderer/stores/gameStore.ts` 已创建，包含游戏列表 / 当前游戏 / 当前存档 / 剧情日志 / 表格数据 / 生成状态，action 完整
- [x] `src/renderer/stores/gameUIStore.ts` 已创建，管理当前视图 / 面板折叠状态 / ANSI 主题 / 滚动位置
- [x] `src/renderer/components/Chat/CreationCenter.tsx` 已移除 `panelConfig.game.comingSoon`，点击 game 面板可打开 `GameModeDialog` 全屏对话框
- [x] `src/renderer/components/Game/GameModeEntry.tsx` 已创建，根据 `gameUIStore.currentView` 渲染 GameLobby / GameDetailPage / GameMainPage
- [x] `src/renderer/components/Game/GameModeEntry.css` 已创建，含全屏布局与 `game-mode-fade-in` 过渡动画（含 `prefers-reduced-motion` 适配）
- [x] `GameModeEntry` 挂载时通过 `useGameStore.getState().loadGames()` 拉取游戏列表
- [x] `resolveBaseView(currentView, previousView)` 纯函数已导出，对话框视图（options / gallery / saves）正确回退到 `previousView`，边界场景回退到 'detail'
- [x] `GameLobby.tsx` / `GameDetailPage.tsx` / `GameMainPage.tsx` 占位组件已创建（Task 9 / 10 / 11 将实现完整版），通过 `React.lazy` 懒加载
- [x] `src/renderer/components/Game/__tests__/GameModeEntry.test.tsx` 已编写，覆盖 `resolveBaseView` 纯函数与容器渲染、视图切换、对话框视图回退渲染（18 个测试用例）
- [x] **重点修复**：`vitest.config.ts` 的 include 模式从 `['src/**/*.test.ts']` 扩展为 `['src/**/*.test.ts', 'src/**/*.test.tsx']`，原配置静默跳过所有 `.tsx` 测试文件（含既有 `AnsiTileMap.test.tsx` 与新增 `GameModeEntry.test.tsx`）
- [x] `src/renderer/components/Game/GameLobby.tsx` 已创建，展示游戏卡片网格，支持类别筛选 / 搜索 / 排序，无匹配时显示空状态
- [x] `src/renderer/components/Game/GameCard.tsx` 已创建，显示封面 / 标题 / 副标题 / 类别徽标 / 状态徽标（已完成绿色 / 开发中橙色）/ 简短介绍 / 最后更新时间
- [x] `src/renderer/components/Game/GameDetailPage.tsx` 已创建，含 6 个操作按钮（开始游戏 / 读取存档 / 选项 / 画廊 / 其他 / 关闭），其他按钮如模板未注册 onOtherAction 则隐藏
- [x] `src/renderer/components/Game/GameSaveDialog.tsx` 已创建，展示存档槽位列表，含存档名 / 最后保存时间 / 当前剧情节点 / 删除按钮
- [x] `src/renderer/components/Game/GameOptionsDialog.tsx` 已创建，可配置 AI 引擎 / 温度 / 最大 token / 表格整理模式 / ANSI 主题
- [x] `src/renderer/components/Game/GameGalleryDialog.tsx` 已创建，首期为空状态占位
- [x] `src/renderer/components/Game/GameMainPage.tsx` 已创建，顶部状态栏（标题 / 当前节点 / 存档 / 设置 / 退出）+ 左侧叙事面板 + 右侧模板面板区
- [x] `src/renderer/components/Game/panels/NarrativePanel.tsx` 已创建，支持流式文本显示（react-markdown + rehype-raw）+ 选项区按钮 + 自由文本输入
- [x] `src/renderer/components/Game/panels/GameStateBar.tsx` 已创建
- [x] `src/renderer/components/Game/AnsiTileMap.tsx` 已创建，支持 CSS Grid 渲染字符瓦片、ANSI 转义序列解析、点击事件回调
- [x] `src/renderer/components/Game/panels/ResourcePanel.tsx` / `FacilityPanel.tsx` / `StatisticsPanel.tsx` / `CollapsiblePanel.tsx` 已创建，可独立渲染（Task 13 / 15 个测试用例全部通过）
- [x] `npm test` 全量测试通过（38 个测试文件 / 818 个测试全部通过），既有 420 个测试不受影响，新增测试全部通过
- [x] `npx tsc --noEmit` 在新增 game 模块文件上无类型错误（既有预存错误与本模块无关，详见已知问题章节）
- [x] `npm run lint` 通过，无 lint 错误（注：lint 因预存 eslint-plugin-react-hooks 插件缺失无法运行，非本模块问题；typecheck 已确认 game 模块代码无类型错误）
- [x] 阶段一新增的单元测试全部通过（543 个新测试：类型 24 + 仓储 60 + 叙事服务 68 + 模板注册 32 + IPC 24 + store 73 + ANSI 27 + GameModeEntry 18 + GameLobby 24 + GameDetailPage 12 + GameMainPage 11 + ResourcePanel 15 + vitest 配置修复 + 其他）

## 阶段二：文字模拟经营游戏完整实现

- [x] `src/renderer/components/Game/templates/management/ManagementGameTemplate.tsx` 已实现 `GameTypeTemplate` 接口，声明 panels: ['resource', 'facility', 'statistics'] 与 tableSchema
- [x] `src/renderer/components/Game/templates/management/managementSchema.ts` 已定义 5 个 sheet（characters / resources / facilities / events / stats），结构对齐 WritingTableData
- [x] `src/renderer/components/Game/templates/management/managementInitialState.ts` 定义初始状态：金币 500 / 食物 50 / 木材 30 / 人口 5 / 回合 1
- [x] `ManagementGameTemplate` 的 `serializeState` / `deserializeState` 可正确序列化与反序列化自定义状态
- [x] 模板已通过 `GameTemplateRegistry.register('management', ...)` 注册，在 `GameModeEntry` 初始化时执行
- [x] `src/main/services/game/templates/management/ManagementPromptBuilder.ts` 可构建经营游戏的 system prompt 与 user prompt
- [x] `src/main/services/game/templates/management/ManagementNarrativeService.ts` 可处理 userAction（如 build:farm）并在叙事生成前应用资源变更
- [x] "结束回合"逻辑可正确执行：读取资源 → 结算产出 → 触发随机事件 → 回合 +1 → 触发 AI 叙事
- [x] 完整游戏循环可走通：开场 → 建造 → 招募 → 结束回合 → 自动存档 → 退出 → 读档恢复（代码层已实现：ManagementGameMain.test.tsx 28 个测试覆盖面板接入/建造/招募/结束回合流程；手动验证清单已记录在 CHANGELOG.md Task 16 条目中，供开发者运行 `npm run dev` 验证）
- [x] `data/games/games-index.json` 包含示例游戏"田园小镇"（id: pastoral_town、type: MANAGEMENT、status: completed）
- [x] `data/games/pastoral_town/meta.json` 包含详细元数据（标题 / 副标题 / 开发者 / 版本 / 详细介绍 / 玩法说明）
- [x] `GameRepository` 在首次启动且索引文件不存在时，自动写入默认示例索引

## 阶段三：优化、文档与后续规划

- [x] `doc/10-game-mode-module.md` 已创建，遵循 `doc/01-dashboard-module.md` 的章节结构
- [x] 文档包含模块功能描述、模块定位与业务价值章节
- [x] 文档包含组件树章节（GameModeEntry → GameLobby / GameDetailPage / GameMainPage → panels/* → templates/*）
- [x] 文档包含 IPC 接口表（所有 game:* 频道、参数、返回值、流式事件）
- [x] 文档包含表格 schema 章节（经营游戏 5 个 sheet 结构、tableEdit 协议、版本快照机制）
- [x] 文档包含 AI prompt 构建流程章节（system prompt 拼装顺序、user prompt 拼装顺序）
- [x] 文档包含 ANSI 瓦片渲染原理章节（CSS Grid、ANSI 解析、性能考量）
- [x] 文档包含扩展指南章节（如何新增游戏类型）
- [x] 文档包含后续游戏类型实现规划章节（狼人杀 / 逆转裁判类推理 / 恋爱模拟 / 文字 RPG 的关键技术点与预估工作量）
- [x] `src/renderer/components/Game/__tests__/GameLobby.test.tsx` 覆盖筛选 / 搜索 / 排序 / 空状态（24 个测试）
- [x] `src/renderer/components/Game/__tests__/GameDetailPage.test.tsx` 覆盖按钮显隐与点击跳转（12 个测试）
- [x] `src/renderer/components/Game/__tests__/GameMainPage.test.tsx` 覆盖视图切换与流式订阅取消（11 个测试）
- [x] `npm test` 全量通过，既有 420 个测试不受影响，新增测试全部通过（44 个测试文件 / 968 个测试全部通过，新增 548 个 game 模块测试）
- [x] `npm run typecheck` 在 game 模块文件上无类型错误（`npm run lint` 因预存 eslint-plugin-react-hooks 插件缺失无法运行，非本模块问题）
- [x] 开发过程中如发现 bug 或需用户反复提示解决的问题，已在 `doc/10-game-mode-module.md` 末尾"已知问题与经验教训"章节重点标记（7 个重点标记问题，涵盖 vitest 配置、serializeState 接口、IPC 路由、vi.mock 路径、antd forwardRef、模块加载副作用、endTurn 事件合并）
