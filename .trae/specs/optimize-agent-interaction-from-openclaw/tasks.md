# Tasks

## 阶段一：交互入口多元化（M1）

- [x] Task 1: 创建斜杠命令注册中心与补全浮层
  - [x] SubTask 1.1: 新增 `src/renderer/components/Common/SlashCommand/SlashCommandRegistry.ts`，定义命令接口（name/description/argSuggestions/handler）和注册/查询机制
  - [x] SubTask 1.2: 注册首批 8 个斜杠命令（`/help`、`/reset`、`/retry`、`/continue`、`/polish`、`/ai-reply`、`/model`、`/clear`），每个命令绑定对应的已有操作函数
  - [x] SubTask 1.3: 新增 `SlashCommandAutoComplete.tsx` 补全浮层组件，监听输入框 `/` 前缀触发，展示命令列表，支持键盘导航（↑↓选择、Enter执行、ESC关闭）
  - [x] SubTask 1.4: 在 `ChatInputBar.tsx` 集成斜杠命令补全浮层，监听 textarea 输入事件，检测 `/` 前缀和参数补全（命令后空格触发参数补全）
  - [x] SubTask 1.5: 参数补全实现：`/model` 动态获取可用模型列表，`/reset` 弹出确认补全，静态参数命令使用预定义列表

- [x] Task 2: 创建命令面板组件（Ctrl+K）
  - [x] SubTask 2.1: 新增 `src/renderer/components/Common/CommandPalette/CommandPalette.tsx` 组件，Modal 浮层 + 搜索输入框 + 分类命令列表
  - [x] SubTask 2.2: 按四类组织命令：navigation（清空/导出/全屏/角色快切/配置面板切换）、actions（重试/续写/润色/AI回复/记忆整理/向量化）、skills（从 `skill:list` IPC 获取 `userInvocable` 技能）、settings（参数调整快捷入口）
  - [x] SubTask 2.3: 实现 250ms 防抖模糊搜索，匹配命令名称和描述，结果按相关性排序
  - [x] SubTask 2.4: 全局快捷键注册（`Ctrl+K`/`Cmd+K` 唤起，`ESC` 关闭），在 `CharacterDialogueChat.tsx` 层注册键盘事件监听
  - [x] SubTask 2.5: 命令执行回调，执行后关闭面板，结果以 toast/消息流/UI 变更反馈

- [x] Task 3: 创建快捷操作菜单组件
  - [x] SubTask 3.1: 新增 `src/renderer/components/Common/QuickActions/QuickActionsMenu.tsx` 组件（⚡按钮 + Dropdown 菜单）
  - [x] SubTask 3.2: 菜单按分组组织：对话操作（重试/续写/AI回复）、内容操作（润色/记忆整理/向量化）、设置操作（全屏/角色快切/配置面板）
  - [x] SubTask 3.3: 每项操作显示名称 + 快捷键提示（如 `Ctrl+R` 重试），快捷键在 `CharacterDialogueChat.tsx` 层注册
  - [x] SubTask 3.4: 在 `ChatInputBar.tsx` 输入栏左侧新增⚡按钮入口，点击弹出 `QuickActionsMenu`

- [x] Task 4: 技能快捷调用入口
  - [x] SubTask 4.1: 在 `ChatInputBar.tsx` 新增技能快捷按钮组区域，从 `skill:list` IPC 获取 `userInvocable=true` 的技能列表
  - [x] SubTask 4.2: 每个技能按钮展示 emoji + name，点击弹出参数输入浮层（根据技能 schema 生成表单）
  - [x] SubTask 4.3: 参数提交后调用 `skill:invoke` IPC，结果以工具调用卡片形式展示在消息流中
  - [x] SubTask 4.4: 在命令面板 skills 分类中注册所有 `userInvocable` 技能（与 Task 2 集成）

## 阶段二：工具调用可视化与会话管理（M2）

- [x] Task 5: 工具调用卡片组件
  - [x] SubTask 5.1: 新增 `src/renderer/components/Character/CharacterDialogueChat/ToolCallCard.tsx` 组件，展示工具名 + 参数摘要 + 状态徽章 + 耗时 + 展开/收起输出
  - [x] SubTask 5.2: 三态样式：pending（灰色脉冲动画）、success（绿色勾 + 耗时）、error（红色叉 + 错误信息 + 重试按钮）
  - [x] SubTask 5.3: 在 `ChatMessageBubble.tsx` 中集成 `ToolCallCard`，assistant 消息内按顺序排列多个工具调用卡片
  - [x] SubTask 5.4: 订阅 `agent:toolCall` IPC 事件，实时更新对应工具调用卡片状态（需在 hooks 中维护 `toolCalls` 状态映射）

- [x] Task 6: 会话管理后端
  - [x] SubTask 6.1: 新增 `src/main/services/agent/sessionManager.ts`，定义会话数据结构（sessionId/agentId/title/createdAt/lastActiveAt/messageCount/metadata）和 CRUD 操作
  - [x] SubTask 6.2: 会话数据持久化到主进程（JSON 文件或 SQLite，复用现有存储模式）
  - [x] SubTask 6.3: 注册 IPC 通道：`session:create`、`session:list`、`session:switch`、`session:delete`、`session:rename`
  - [x] SubTask 6.4: 会话切换时自动保存当前会话消息历史，加载目标会话消息历史

- [x] Task 7: 会话管理前端
  - [x] SubTask 7.1: 在 `ChatHeader.tsx` 新增会话切换下拉菜单（antd `Dropdown` + `Menu`），列出当前角色所有会话（标题 + 最后活跃时间 + 消息数）
  - [x] SubTask 7.2: 新建会话按钮（Header "+" 按钮 或 `/new` 斜杠命令），创建新会话并清空消息列表
  - [x] SubTask 7.3: 会话标题自动取首条用户消息前 20 字符，用户可右键重命名
  - [x] SubTask 7.4: 在 `CharacterDialogueChat.hooks.ts` 中新增 `currentSessionId` 状态和会话切换逻辑

- [x] Task 8: 状态管理重构
  - [x] SubTask 8.1: 定义 `ChatAction` 联合类型（SEND_MESSAGE/STREAM_CHUNK/STREAM_COMPLETE/STREAM_ERROR/TOOL_CALL_UPDATE/SESSION_SWITCH/CLEAR_MESSAGES 等）
  - [x] SubTask 8.2: 定义 `ChatState` 接口（messages/isLoading/isStreaming/error/toolCalls/currentSessionId/tokenUsage），实现 `chatReducer` 函数
  - [x] SubTask 8.3: 在 `useCharacterDialogueChat` 中引入 `useReducer(chatReducer, initialState)`，替换部分 useState + useRef 镜像状态
  - [x] SubTask 8.4: 保留少量 ref 仅用于回调闭包场景（streamContentRef/targetMessageIdRef），其余状态迁移到 reducer

## 阶段三：上下文压缩与故障转移（M3）

- [x] Task 9: 上下文压缩后端
  - [x] SubTask 9.1: 新增 `src/main/services/agent/contextCompactor.ts`，定义 `compactContext(messages, maxTokens): Promise<CompactionResult>` 接口
  - [x] SubTask 9.2: 压缩策略：当对话历史 token > `maxContextTokens * 0.7` 时触发，保留最近 N 轮原文 + 较早消息按 10 轮一组生成摘要
  - [x] SubTask 9.3: 摘要 prompt 构建器：`请总结以下对话的关键信息（角色设定/重要事件/承诺/未解决话题），保留所有专有名词`
  - [x] SubTask 9.4: 压缩结果作为 system 消息注入上下文（标记 `[对话摘要]`），替换原始消息
  - [x] SubTask 9.5: 压缩失败降级为直接裁剪（现有 ContextTruncator 行为），记录日志，不阻塞对话

- [x] Task 10: 故障转移策略后端
  - [x] SubTask 10.1: 新增 `src/main/services/agent/failoverPolicy.ts`，定义错误分类（瞬态/非瞬态/可探测）和处理策略
  - [x] SubTask 10.2: 瞬态错误（rate_limit/timeout/overloaded）→ 指数退避重试（最多 3 次，间隔 1s/2s/4s）
  - [x] SubTask 10.3: 非瞬态错误（auth/model_not_found）→ 从 `fallbackProviders` 列表中选择下一个 provider 切换
  - [x] SubTask 10.4: 在 `AIConfigProvider` 新增 `fallbackProviders: {provider, model, apiKey, baseUrl}[]` 配置项，持久化到 storageService
  - [x] SubTask 10.5: 故障转移事件通知（IPC 事件 `ai:failover`），前端展示 toast "已切换到备用模型 {model}"
  - [x] SubTask 10.6: 所有重试/切换记入审计日志

- [x] Task 11: 上下文窗口守卫与 Token 进度条
  - [x] SubTask 11.1: 定义上下文窗口守卫常量：`HARD_MIN_TOKENS = 4000`、`WARN_BELOW_TOKENS = 8000`
  - [x] SubTask 11.2: 在 `ContextTruncator` 裁剪后计算剩余 token，暴露给前端
  - [x] SubTask 11.3: 新增 `TokenUsageBar.tsx` 组件（绿→黄→红三色进度条），展示已用/总量 + tooltip
  - [x] SubTask 11.4: 在 `ChatInputBar.tsx` 上方放置 `TokenUsageBar`，剩余 < 8000 黄色警告，< 4000 红色警告 + "压缩对话历史"按钮
  - [x] SubTask 11.5: 点击"压缩对话历史"按钮手动触发上下文压缩

## 阶段四：智能响应水平提升（M4）

- [x] Task 12: 技能提示词注入
  - [x] SubTask 12.1: 新增 `src/main/services/agent/skills/skillPromptFormatter.ts`，实现 `formatSkillsForPrompt(skills: SkillEntry[], mode: string): string`
  - [x] SubTask 12.2: 输出 XML 格式：`<available_skills><skill><name>{name}</name><description>{description}</description></skill></available_skills>`
  - [x] SubTask 12.3: 仅注入 `includeInAvailableSkillsPrompt=true` 且当前模式适用的技能
  - [x] SubTask 12.4: 注册 IPC 通道 `skill:getPromptSnippet`（按 mode 获取格式化后的技能 prompt 片段）
  - [x] SubTask 12.5: 在 `PromptBuilder.ts::buildFinalSystemPrompt` 中新增区域5：可用技能，调用 IPC 获取并注入

- [x] Task 13: 技能快照与过滤
  - [x] SubTask 13.1: 新增 `src/main/services/agent/skills/skillSnapshot.ts`，定义 `SkillSnapshot` 类型（prompt/skills/skillFilter/promptFormatVersion/createdAt）
  - [x] SubTask 13.2: 实现 `createSkillSnapshot(agentId, sessionId, mode): SkillSnapshot`，缓存技能列表 + 格式化 prompt
  - [x] SubTask 13.3: 会话内复用快照（技能列表不变时不重新解析 SKILL.md）
  - [x] SubTask 13.4: `promptFormatVersion` 机制：版本号变化时强制重新解析
  - [x] SubTask 13.5: 技能变更（安装/卸载/启用/禁用）时清除相关快照（监听技能变更事件）

- [ ] Task 14: 混合检索记忆搜索
  - [ ] SubTask 14.1: 在 `ContextManager.ts` 新增 `retrieveWithHybrid(query, options)` 方法
  - [ ] SubTask 14.2: 向量检索 + 关键词检索合并（向量权重 0.7 + 关键词权重 0.3），统一检索 memory + worldbook + chatHistory 三源
  - [ ] SubTask 14.3: 实现 MMR 去重算法：`MMR = λ * sim(query, doc) - (1-λ) * max(sim(doc, selected_docs))`，λ=0.7
  - [ ] SubTask 14.4: 实现时间衰减：`score *= exp(-daysSinceLastAccess / 30)`，30 天半衰期
  - [ ] SubTask 14.5: 检索结果按 score 降序取 topK，替换现有 `retrieveContextWithKeywords` 调用

- [x] Task 15: 用户意图识别
  - [x] SubTask 15.1: 新增 `src/renderer/components/Character/CharacterDialogueChat/IntentRecognizer.ts`，定义意图类型（DIALOGUE/WRITE/QUERY/ACTION/HELP）和关键词规则
  - [x] SubTask 15.2: 关键词规则示例：`写一段/续写/改写` → WRITE；`查一下/搜索/找` → QUERY；`整理/排序/更新` → ACTION；`怎么/如何/帮助` → HELP
  - [x] SubTask 15.3: `recognizeIntent(message): IntentResult` 方法，纯关键词匹配，延迟 < 10ms
  - [x] SubTask 15.4: 根据意图动态调整技能可用性（如 WRITE 意图激活 `chapter-write`/`description-polish`）
  - [x] SubTask 15.5: 意图识别结果注入 system prompt 区域6：`[用户意图: {intent}]`
  - [x] SubTask 15.6: 未识别意图时默认为 DIALOGUE

## 阶段五：UI 统一化与主题系统（M5）

- [x] Task 16: 语义化色彩 token 与主题系统
  - [ ] SubTask 16.1: 新增 `src/renderer/styles/themeTokens.ts`，定义语义化色彩 token（text/dim/accent/border/userBg/toolPendingBg/toolSuccessBg/toolErrorBg/toolTitle/toolOutput/quote/code/link/error/success）
  - [ ] SubTask 16.2: 新增 `ThemeProvider.tsx` 组件 + `themeMode` 状态（light/dark/auto），通过 CSS 变量注入主题
  - [ ] SubTask 16.3: 定义 dark 和 light 两套调色板，auto 模式跟随系统 `prefers-color-scheme`
  - [ ] SubTask 16.4: 将 `CharacterDialogueChat` 和 `AgentDialogueModal` 中的硬编码颜色逐步替换为 CSS 变量引用

- [x] Task 17: 智能体对话界面统一
  - [x] SubTask 17.1: 从 `CharacterDialogueChat` 中抽取 `ChatMessageList.tsx`（消息列表 + 虚拟化）为独立可复用组件
  - [x] SubTask 17.2: 抽取 `ChatStreamRenderer.tsx`（流式渲染 + Markdown）为独立可复用组件
  - [x] SubTask 17.3: 重构 `AgentDialogueModal.tsx`，复用 `ChatMessageList`、`ChatInputBar`、`ChatStreamRenderer`，传入 `mode='agent'` 控制差异行为（无角色卡/无记忆表格/无表情系统/无辅助模式）
  - [x] SubTask 17.4: 统一消息气泡样式（圆角/配色/间距），通过 `mode` prop 控制少量差异

- [x] Task 18: 工具调用状态色彩体系
  - [x] SubTask 18.1: 在 `themeTokens.ts` 中定义工具调用状态色彩 token（toolPendingBg/toolPendingText/toolSuccessBg/toolSuccessText/toolErrorBg/toolErrorText/toolTitle/toolOutput）
  - [x] SubTask 18.2: 在 `ToolCallCard.tsx` 中使用语义化 token 替代硬编码颜色
  - [x] SubTask 18.3: 三态视觉：pending 灰色脉冲（`@keyframes pulse`）、success 绿色勾、error 红色叉
  - [x] SubTask 18.4: 工具调用卡片折叠/展开动画 < 300ms（`cubic-bezier` 过渡）

- [x] Task 19: CharacterDialogueChat 消息渲染组件复用迁移
  - [x] SubTask 19.1: 分析 `CharacterDialogueChat` 现有 `ChatMessageBubble`/`VirtualizedMessageList` 的渲染逻辑，识别可迁移到 `ChatMessageList` 的部分（基础布局、自动滚动、空状态）
  - [x] SubTask 19.2: 在 `ChatMessageList` 中扩展 `renderMessage` 自定义渲染能力，支持 CharacterDialogueChat 的复杂消息类型（版本对比、表情系统、工具调用卡片、RAG 引用）
  - [x] SubTask 19.3: 将 `CharacterDialogueChat` 的消息列表替换为 `<ChatMessageList mode="character">`，通过 `renderMessage` 传入角色特有的渲染逻辑
  - [x] SubTask 19.4: 验证角色对话功能不受影响（版本切换、表情显示、工具调用卡片、RAG 引用、流式渲染）

# Task Dependencies

- Task 4（技能快捷调用入口）depends on Task 1（斜杠命令注册中心，共用命令注册机制）
- Task 5（工具调用卡片）depends on Task 8（状态管理重构，需 toolCalls 状态）
- Task 7（会话管理前端）depends on Task 6（会话管理后端）
- Task 9（上下文压缩）depends on Task 11（上下文窗口守卫，需 token 计算逻辑）
- Task 12（技能提示词注入）depends on Task 13（技能快照，需缓存机制）
- Task 14（混合检索）无依赖，可并行
- Task 15（用户意图识别）depends on Task 12（技能提示词注入，需技能可用性动态调整）
- Task 17（界面统一）depends on Task 16（主题系统，需 CSS 变量基础）
- Task 18（工具调用色彩）depends on Task 5（工具调用卡片）和 Task 16（主题系统）

## 并行化建议

- 阶段一 M1 中 Task 1/2/3 可并行（独立组件），Task 4 依赖 Task 1
- 阶段二 M2 中 Task 5/6 可并行（前端/后端独立），Task 7 依赖 Task 6，Task 8 独立
- 阶段三 M3 中 Task 9/10/11 可并行（独立后端服务）
- 阶段四 M4 中 Task 12/13 串行（快照先于注入），Task 14/15 可并行
- 阶段五 M5 中 Task 16 先行，Task 17/18 依赖 Task 16
