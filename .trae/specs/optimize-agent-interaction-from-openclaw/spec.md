# 基于 OpenClaw 的智能体交互方式优化 Spec

> 本规范针对 creative-cafe 项目在智能体对话能力方面与 OpenClaw 存在的显著差距，聚焦于 **UI 样式、交互方式、交互体验、智能响应水平** 四个方向，基于对 `g:\AI\creative-cafe\sillytavern-source\openclaw-main` 源码的深度技术分析，制定结构化优化方案。
>
> 本规范与 `design-agent-tech-foundation-from-openclaw`（后端架构底座）互补：后者定义五大模块的架构与接口规范，本规范聚焦**用户可感知的交互层**——用户如何触达智能体能力、如何获得流畅的交互体验、如何获得更智能的响应。

---

## Why

当前项目智能体交互在四个方向上与 OpenClaw 存在显著差距：

1. **UI 样式不一致**：角色对话界面（CharacterDialogueChat）功能丰富但视觉复杂，智能体中心对话弹窗（AgentDialogueModal）过于简陋，两者风格割裂；无统一主题系统，无自定义主题支持。
2. **交互入口匮乏**：用户只能通过底部输入框发送文本消息，无斜杠命令、无命令面板、无快捷功能菜单、无技能快捷调用入口；OpenClaw 提供了 CLI 命令体系、TUI 斜杠命令（含参数补全）、Web UI 命令面板（四类分组）、技能命令发现等多维交互入口。
3. **交互体验不够流畅**：缺乏会话管理机制（无会话切换/历史会话恢复）、无上下文压缩（长对话直接截断丢失信息）、无故障转移策略（provider 不可达直接报错）、无上下文窗口守卫（无硬限制/警告阈值）。
4. **智能响应水平不足**：技能系统尚未完成提示词注入（无 `formatSkillsForPrompt` XML 格式化）、无技能快照与过滤机制、无模型选择多层解析、无混合检索记忆搜索（MMR + 时间衰减）、技能发现机制缺失。

---

## What Changes

### 方向一：UI 样式统一化

- **统一智能体对话组件**：将 `AgentDialogueModal` 升级为复用 `CharacterDialogueChat` 的消息气泡、输入栏、流式渲染等核心组件，消除两套界面风格割裂
- **引入语义化色彩 token**：参照 OpenClaw `theme.ts` 的语义化色彩体系（text/dim/accent/border/userBg/toolPendingBg/toolSuccessBg/toolErrorBg 等），统一项目 CSS 变量命名
- **新增工具调用可视化样式**：参照 OpenClaw TUI `ChatLog` 的工具状态追踪，在消息气泡中展示工具调用的 pending/success/error 三态视觉反馈
- **新增命令面板 UI**：参照 OpenClaw Web UI `command-palette.ts`，新增 `Ctrl+K` 命令面板组件

### 方向二：交互入口多元化

- **新增斜杠命令系统**：参照 OpenClaw TUI `commands.ts`，在聊天输入框支持 `/help`、`/agent`、`/model`、`/think`、`/reset` 等斜杠命令，含参数自动补全
- **新增命令面板**：参照 OpenClaw Web UI 命令面板四类分组（search/navigation/skills/chats），`Ctrl+K` 快捷键唤起
- **新增技能快捷调用入口**：参照 OpenClaw 技能命令发现机制，将 `userInvocable` 技能暴露为输入栏快捷按钮或斜杠命令
- **新增功能菜单体系**：在聊天输入栏新增"快捷操作"菜单（⚡按钮），聚合常用操作（重试、续写、润色、AI回复、记忆整理、向量化等）

### 方向三：交互体验流畅化

- **新增会话管理机制**：参照 OpenClaw `session.ts` 的会话标识体系，支持会话切换、历史会话恢复、会话元数据持久化
- **新增上下文压缩**：参照 OpenClaw `compaction.ts` 的自适应分块压缩，长对话超限时自动压缩历史（保留标识符、活动任务状态、近期上下文）
- **新增上下文窗口守卫**：参照 OpenClaw `context-window-guard.ts`，设置硬限制（4000 tokens）与警告阈值（8000 tokens），UI 展示剩余 token 量
- **新增故障转移策略**：参照 OpenClaw `failover-policy.ts`，按错误类型分类处理（瞬态重试/非瞬态切换/可探测冷却）
- **新增工具调用过程展示**：参照 OpenClaw ACP 的 `tool_call` 事件流，在消息流中实时展示工具调用进度（pending→running→success/error）

### 方向四：智能响应水平提升

- **技能提示词注入**：参照 OpenClaw `formatSkillsForPrompt`，将可用技能以 XML 格式注入 system prompt，模型通过 `read` 工具加载 SKILL.md
- **技能快照与过滤**：参照 OpenClaw `SkillSnapshot`，实现会话级技能快照缓存 + 智能体级过滤器
- **混合检索记忆搜索**：参照 OpenClaw `memory-search.ts`，实现向量 + FTS 混合检索 + MMR 去重 + 时间衰减
- **用户意图识别增强**：基于斜杠命令 + 自然语言关键词匹配，识别用户意图（对话/写作/查询/操作），动态调整技能可用性与 prompt 策略

---

## Impact

- **Affected specs**：
  - `design-agent-tech-foundation-from-openclaw`（本规范消费其模块一 AgentCore / 模块四 SkillPlatform 的接口，在其基础上增加交互层）
  - `optimize-chat-ai-intelligence`（本规范的上下文压缩、故障转移与之互补，不冲突）
  - `add-ai-user-reply-button`（快捷操作菜单聚合其入口）
  - `add-assist-mode-options`（快捷操作菜单聚合其入口）
- **Affected code**：
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 统一为复用 CharacterDialogueChat 组件
  - `src/renderer/components/Character/CharacterDialogueChat/ChatInputBar.tsx` — 新增斜杠命令解析、快捷操作菜单、技能快捷入口
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — 新增命令面板、会话管理 UI
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 新增会话管理、上下文压缩、故障转移逻辑
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 新增工具调用可视化
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 新增技能提示词注入
  - `src/renderer/components/Common/ChatEngine/ChatEngine.ts` — 新增故障转移策略
  - `src/renderer/components/Common/` — 新增 `CommandPalette/`、`SlashCommand/`、`QuickActions/` 组件目录
  - `src/main/services/agent/skills/` — 新增 `skillPromptFormatter.ts`、`skillSnapshot.ts`
  - `src/main/services/agent/` — 新增 `sessionManager.ts`、`contextCompactor.ts`、`failoverPolicy.ts`
  - `src/main/services/ContextManager.ts` — 新增混合检索 + MMR + 时间衰减

---

## 偏差对照表

### 方向一：UI 样式

| 维度 | OpenClaw 实现方法 | 本项目当前实现 | 差距分析 | 改进步骤与技术路径 |
|------|------------------|--------------|---------|-------------------|
| **主题系统** | 四主题（claw/knot/dash/custom）× 三模式（system/light/dark），`resolveTheme()` 解析为 8 种最终主题；自定义主题支持从 tweakcn.com 导入，含严格 CSS 安全校验 | 无主题系统，硬编码深色渐变；CSS 变量散落在各组件中（`--chat-bubble-user-bg` 等），无统一管理 | 缺乏主题管理框架，无法切换主题，无自定义主题支持 | 1. 抽取统一 `themeTokens.ts` 定义语义化色彩 token（参照 OpenClaw `text/dim/accent/border/userBg/toolBg` 命名）<br>2. 新增 `ThemeProvider` 组件 + `themeMode` 状态（light/dark/auto）<br>3. 将所有硬编码颜色替换为 CSS 变量引用<br>4. 预留自定义主题导入接口 |
| **语义化色彩** | `darkPalette`/`lightPalette` 双调色板，按语义角色组织：`text`、`dim`、`accent`、`border`、`userBg`、`userText`、`toolPendingBg`、`toolSuccessBg`、`toolErrorBg`、`toolTitle`、`toolOutput`、`quote`、`code`、`link`、`error`、`success` | 部分语义化 CSS 变量（`--chat-bubble-user-bg`、`--chat-input-border`），但命名不统一、覆盖不完整，无工具状态色彩 | 色彩体系碎片化，尤其缺少工具调用状态（pending/success/error）的视觉语言 | 1. 补全语义化 token 到 `themeTokens.ts`（重点补 `toolPendingBg/toolSuccessBg/toolErrorBg/toolTitle/toolOutput`）<br>2. 在 `ChatMessageBubble` 新增工具调用状态卡片样式（pending 灰色脉冲、success 绿色勾、error 红色叉）<br>3. 在 `ChatInputBar` 新增命令面板/斜杠命令高亮样式 |
| **布局模式** | 模块化 CSS 导入（base→layout→layout.mobile→components→approval-boot→settings）；含 `dock_panel_layout`、`resizable_divider`、`mobile_nav_layout` | Modal 承载（1600px/85vh），三栏布局（角色选择器+聊天+配置面板），全屏模式切换；无移动端适配 | 布局固定在 Modal 内，无可停靠面板/可调整分隔条/移动端适配 | 1. 保持 Modal 布局不变（降低改动风险），但将三栏分隔改为可拖拽分隔条（`resizable-divider`）<br>2. 配置面板改为可折叠侧边抽屉（节省空间）<br>3. 预留移动端响应式断点 |
| **消息气泡** | TUI `ChatLog` 五类追踪映射（tools/assistantRuns/userComponents/pendingUsers/pendingSystemNotices），`pruneOverflow()` 智能修剪（保留当前对话+关联工具） | 消息气泡功能丰富（版本管理/表情/辅助选项/异步整理标记），但无工具调用追踪展示，虚拟化列表仅按数量阈值切换 | 消息流中缺少工具调用的可视化追踪 | 1. 在 `ChatMessageBubble` 中新增工具调用卡片区域（参照 OpenClaw `toolPendingBg/toolSuccessBg/toolErrorBg` 三态）<br>2. 工具卡片展示：工具名 + 参数摘要 + 执行状态 + 耗时 + 展开/收起输出<br>3. 工具卡片支持折叠，默认收起输出仅展示状态 |
| **两套界面统一** | N/A（OpenClaw 为单一产品） | `CharacterDialogueChat`（功能丰富、视觉复杂） vs `AgentDialogueModal`（简陋、风格不一致：圆角 8px vs 18px、`#e6f7ff` vs 渐变、400px vs 85vh） | 智能体中心对话体验明显劣于角色对话，用户感知割裂 | 1. 将 `AgentDialogueModal` 改为复用 `CharacterDialogueChat` 核心组件（消息列表+输入栏+流式渲染）<br>2. 抽取 `ChatMessageList`、`ChatInputBar`、`ChatStreamRenderer` 为独立可复用组件<br>3. `AgentDialogueModal` 传入 `mode='agent'` 控制差异行为（无角色卡/无记忆表格/无表情系统） |

### 方向二：交互方式

| 维度 | OpenClaw 实现方法 | 本项目当前实现 | 差距分析 | 改进步骤与技术路径 |
|------|------------------|--------------|---------|-------------------|
| **斜杠命令** | TUI `commands.ts` 维护完整斜杠命令表：`/help`、`/agent <id>`、`/session <key>`、`/model <provider/model>`、`/think <level>`、`/fast`、`/verbose`、`/reasoning`、`/usage`、`/elevated`、`/activation`、`/abort`、`/new`、`/reset`；含参数自动补全 + 别名机制 | 无斜杠命令系统；输入框仅支持纯文本输入 + Enter 发送 | 用户无法通过快捷命令调整参数/切换会话/管理智能体，所有操作需点击 UI 按钮 | 1. 新增 `SlashCommandRegistry.ts` 注册斜杠命令（命令名/描述/参数 schema/处理函数）<br>2. 在 `ChatInputBar` 监听 `/` 前缀触发命令补全浮层（antd `AutoComplete` 或自定义浮层）<br>3. 首批命令：`/help`、`/reset`、`/retry`、`/continue`、`/polish`、`/ai-reply`、`/model`、`/clear`<br>4. 后续扩展：`/agent`、`/session`、`/skill` |
| **命令面板** | Web UI `command-palette.ts` 按四类组织：search（搜索）、navigation（导航：新会话/会话列表/定时任务/技能/插件/设置/智能体）、skills（技能调用）、chats（聊天历史）；250ms 防抖搜索、分页 4×50 | 无命令面板；所有操作分散在各组件按钮中 | 缺乏统一快捷入口，用户需在多个面板间切换寻找功能 | 1. 新增 `CommandPalette.tsx` 组件（`Ctrl+K` / `Cmd+K` 唤起）<br>2. 按四类组织命令：navigation（清空/导出/全屏/角色快切/配置面板）、actions（重试/续写/润色/AI回复/记忆整理）、skills（`userInvocable` 技能列表）、settings（参数调整快捷入口）<br>3. 250ms 防抖模糊搜索命令名+描述<br>4. 回车执行、ESC 关闭 |
| **技能快捷调用** | `listSkillCommandsForWorkspace()` + `listSkillCommandsForAgents()` 发现技能命令；按 agentId 遍历 + 执行权限检查 + 远程平台适配 + 去重 | 技能系统已有 `skill:list` / `skill:invoke` IPC 通道，但无前端快捷调用入口；技能仅在 AgentCenter 技能广场中浏览 | 技能无法在对话过程中快捷调用，用户感知不到技能的存在 | 1. 在 `ChatInputBar` 新增技能快捷按钮组（展示 `userInvocable=true` 的技能 emoji+name）<br>2. 点击技能按钮 → 弹出参数输入浮层 → 调用 `skill:invoke` IPC<br>3. 在命令面板 skills 分类中注册所有 `userInvocable` 技能<br>4. 技能调用结果以工具调用卡片形式展示在消息流中 |
| **功能菜单体系** | CLI 分层懒加载命令注册（`command-registry.ts` + `register-lazy-command.ts`）；TUI 斜杠命令分组；Web UI 命令面板分类 | 功能入口分散：输入栏 4 按钮（人称/AI回复/润色/发送）、消息悬停 5 按钮（复制/编辑/重试/续写/卷回）、Header 5 按钮（清空/导出/快切/全屏/收藏）、右侧 ConfigPanel 多面板 | 功能发现性差，新用户不知道有哪些功能可用 | 1. 在 `ChatInputBar` 新增"快捷操作"菜单（⚡按钮），聚合：重试、续写、润色、AI回复、记忆整理、向量化、角色快切、全屏<br>2. 菜单按频率排序（常用置顶）+ 分隔线分组（对话操作/内容操作/设置操作）<br>3. 快捷键提示标注（如 `Ctrl+R` 重试、`Ctrl+K` 命令面板）<br>4. 保留原有按钮不变（快捷操作菜单为补充入口） |
| **参数补全** | TUI 命令参数静态/动态补全：`/think <level>` 动态生成、`/fast` 静态列表、`/verbose` 静态列表 | 无参数补全 | 用户需记忆命令参数，使用门槛高 | 1. `SlashCommandRegistry` 每个命令定义 `argSuggestions?: string[] | ((ctx) => string[])`<br>2. 输入 `/model ` 后自动弹出模型列表补全<br>3. 输入 `/reset ` 后弹出确认补全（确认/取消） |

### 方向三：交互体验

| 维度 | OpenClaw 实现方法 | 本项目当前实现 | 差距分析 | 改进步骤与技术路径 |
|------|------------------|--------------|---------|-------------------|
| **会话管理** | `session.ts` 合成会话键 `agent:<agentId>:explicit:<sessionId>`；`SessionResolution` 含 sessionId/sessionKey/storePath/isNewSession/previousSessionId/persistedThinking/persistedVerbose；`clearRotatedSessionMetadata()` 清理 20+ 状态字段；SQLite 持久化 | 无会话管理；每次打开角色对话恢复最近一次对话历史（`characterChat:getTestChat`），无法保存/切换多个会话 | 用户无法为同一角色卡创建多个独立会话（如不同剧情线），切换角色时丢失当前对话上下文 | 1. 新增 `sessionManager.ts`（main 进程），支持 create/list/switch/delete 会话<br>2. 会话数据结构：`{sessionId, agentId, title, createdAt, lastActiveAt, messageCount, metadata}`<br>3. 在 ChatHeader 新增会话切换下拉菜单（列出当前角色所有会话）<br>4. 新建会话按钮（`/new` 命令或 Header 按钮）<br>5. 会话标题自动取首条用户消息前 20 字符 |
| **上下文压缩** | `compaction.ts` 自适应分块压缩：`computeAdaptiveChunkRatio()` 计算分块比例；`strict/off/custom` 标识符保留策略；合并指令保留活动任务/批处理进度/最后请求/决策理由/TODO/承诺；近期优先；`retryAsync()` 重试；`isOversizedForSummary()` 分阶段拆分 | 无上下文压缩；`ContextTruncator` 按预算裁剪（必填项 reserve + 倒序填充），超限直接丢弃早期消息 | 长对话（50+ 轮）早期上下文完全丢失，AI 忘记早期设定和事件 | 1. 新增 `contextCompactor.ts`（main 进程），在 `ContextTruncator` 裁剪前触发<br>2. 当对话历史 token > `maxContextTokens * 0.7` 时触发压缩<br>3. 压缩策略：保留最近 N 轮原文 + 较早消息按 10 轮一组摘要<br>4. 摘要 prompt：`请总结以下对话的关键信息（角色设定/重要事件/承诺/未解决话题），保留所有专有名词`<br>5. 压缩结果作为 system 消息注入上下文（标记 `[对话摘要]`）<br>6. 压缩失败不阻塞对话（降级为直接裁剪） |
| **上下文窗口守卫** | `context-window-guard.ts` 硬限制 `CONTEXT_WINDOW_HARD_MIN_TOKENS = 4_000`；警告阈值 `CONTEXT_WINDOW_WARN_BELOW_TOKENS = 8_000`；比例阈值 10%/20%；来源优先级 modelsConfig > model > agentContextTokens > default | `TokenManagementPanel` 可配置上下文窗口大小；`ContextTruncator` 按预算裁剪；但无硬限制/警告阈值/UI 剩余量展示 | 用户不知道上下文何时快满，无法预判 AI 是否会"忘记"早期内容 | 1. 在 `ChatInputBar` 上方新增 token 使用量进度条（绿→黄→红三色）<br>2. 当剩余 token < 8000 时黄色警告 + tooltip "上下文即将耗尽"<br>3. 当剩余 token < 4000 时红色警告 + 建议"压缩对话历史"按钮<br>4. 进度条数据从 `ContextTruncator` 裁剪后的 token 计算获取 |
| **故障转移** | `failover-policy.ts` 按错误类型分类：可探测类（rate_limit/overloaded/billing/timeout）允许冷却探测；瞬态类消耗探测槽位；非瞬态类（model_not_found/format/auth）保留探测预算 | `AIService.streamChatAPI` 有重试（maxRetries=2，指数退避），但仅判定 `isTransientError` 粗粒度分类；无故障转移（切换 provider/model）；`ChatEngine` 异常直接 catch 回退 | Provider 不可达时直接报错，无自动切换到备用 provider 的能力 | 1. 新增 `failoverPolicy.ts`（main 进程），按错误类型分类处理策略<br>2. 瞬态错误（rate_limit/timeout/overloaded）→ 指数退避重试（最多 3 次）<br>3. 非瞬态错误（auth/model_not_found）→ 切换备用 provider（若配置了多个）<br>4. 在 `AIConfigProvider` 新增 `fallbackProviders` 配置项<br>5. 故障转移时在 UI 展示 toast "已切换到备用模型 {model}"<br>6. 所有重试/切换记入审计日志 |
| **工具调用过程展示** | ACP `tool_call`/`tool_call_update` 事件流；TUI `ChatLog` 五类追踪映射实时更新工具状态 | `agent:toolCall` IPC 事件已定义但前端未展示；AgentDialogueModal 和 CharacterDialogueChat 均无工具调用可视化 | 用户无法看到 AI 调用了哪些工具、工具执行结果如何，交互黑盒 | 1. 在 `ChatMessageBubble` 新增工具调用卡片组件 `ToolCallCard`<br>2. 订阅 `agent:toolCall` 事件，实时更新卡片状态（pending→running→success/error）<br>3. 卡片展示：工具图标 + 工具名 + 参数摘要 + 状态徽章 + 耗时 + 展开输出<br>4. 多个工具调用按顺序排列在 assistant 消息内<br>5. 失败工具展示错误信息 + 重试按钮 |
| **状态管理一致性** | 进程级单例（ACP 会话管理器）+ SQLite 存储层 + 运行时状态对象 + 代际标记（lifecycleGeneration）+ 退避重试 | `ChatEngine` 回调注册制 + `isCancelled` 布尔 + 事件监听清理；`useCharacterDialogueChat` 大量 useRef 镜像状态（messagesRef/streamContentRef/targetMessageIdRef 等 10+ ref）解决闭包陈旧 | useRef 镜像状态过多，维护困难且易出 bug；ChatEngine 与 hooks 状态同步靠手动 ref | 1. 引入 `useReducer` 替代部分 useState + useRef 镜像（将 messages/streaming/error/tokenUsage 合入单一 reducer）<br>2. 定义 `ChatAction` 联合类型（SEND_MESSAGE/STREAM_CHUNK/STREAM_COMPLETE/STREAM_ERROR/TOOL_CALL_UPDATE/SESSION_SWITCH 等）<br>3. reducer 中集中处理状态转换，消除手动 ref 同步<br>4. 保留少量 ref 仅用于回调闭包场景（如 streamContentRef） |

### 方向四：智能响应水平

| 维度 | OpenClaw 实现方法 | 本项目当前实现 | 差距分析 | 改进步骤与技术路径 |
|------|------------------|--------------|---------|-------------------|
| **技能提示词注入** | `formatSkillsForPrompt()` 将技能列表格式化为 XML 注入提示：`<available_skills><skill><name>...</name><description>...</description><location>...</location><version>...</version></skill></available_skills>`；模型通过 `read` 工具加载 SKILL.md；版本号变化时重新读取 | 内置技能已有 SKILL.md 定义（`src/main/services/agent/skills/builtin-skills/`），但 `PromptBuilder` 未将技能注入 system prompt；`skill:list` IPC 已存在但前端未消费 | AI 不知道有哪些技能可用，无法主动调用技能 | 1. 新增 `skillPromptFormatter.ts`（main 进程），实现 `formatSkillsForPrompt(skills: SkillEntry[]): string`<br>2. 在 `requestAIResponse` Step C 中，将格式化后的技能列表追加到 system prompt（区域5：可用技能）<br>3. 仅注入 `includeInAvailableSkillsPrompt=true` 的技能<br>4. 技能 prompt 格式：`<available_skills><skill><name>{name}</name><description>{description}</description></skill></available_skills>`<br>5. 在 `agent:run` 路径中，技能 prompt 通过 `AgentRunIntent.tools` + system prompt 双通道注入 |
| **技能快照与过滤** | `SkillSnapshot` 含 prompt/skills/skillFilter/skillOverrides/nodeSkillsEligibility/resolvedSkills/promptFormatVersion；会话级缓存避免每轮重新解析 SKILL.md | 无技能快照；每次 `skill:list` IPC 调用重新扫描技能目录 | 性能浪费 + 无法支持会话级技能覆盖 | 1. 新增 `skillSnapshot.ts`（main 进程），实现 `createSkillSnapshot(agentId, sessionId): SkillSnapshot`<br>2. 快照缓存技能列表 + 格式化 prompt + 解析结果<br>3. 会话内复用快照（技能列表不变时不重新解析）<br>4. `promptFormatVersion` 机制：版本号变化时强制重新解析<br>5. 技能变更（安装/卸载/启用/禁用）时清除相关快照 |
| **混合检索记忆搜索** | `memory-search.ts` 双数据源（memory + sessions）；SQLite + FTS（unicode61/trigram 分词器）+ 向量扩展；`hybrid` 模式：向量权重 + 文本权重 + MMR 去重 + 时间衰减；可配置 token 数和重叠量 | `ContextManager.retrieveContextWithKeywords` 双路检索（向量 + 关键词），但仅 worldbook 来源做关键词匹配；无 MMR 去重、无时间衰减；对话历史 RAG 单独走 `chatHistory:retrieve` | 检索结果可能有重复/冗余条目；缺乏时间衰减导致远古记忆与近期记忆同等权重 | 1. 在 `ContextManager` 新增 `retrieveWithHybrid` 方法<br>2. 向量检索 + FTS 关键词检索合并（已有基础）<br>3. 新增 MMR 去重：`MMR = λ * sim(query, doc) - (1-λ) * max(sim(doc, selected_docs))`，λ=0.7<br>4. 新增时间衰减：`score *= exp(-daysSinceLastAccess / 30)`，30 天半衰期<br>5. 统一检索 memory + sessions + worldbook + chatHistory 四源<br>6. 检索结果按 score 降序取 topK |
| **模型选择多层解析** | `model-selection.ts` 多层解析：持久化覆盖 > 配置解析 > 目录查找 > 别名索引 > 允许列表（带回退）> 思考级别默认 | `AIConfigProvider` 单例从 `storageService` 读取活跃引擎配置（单一 provider/model）；无备用模型/别名/允许列表 | 单一 provider 配置，无模型选择策略 | 1. 在 `AIConfigProvider` 新增 `fallbackModels: {provider, model}[]` 配置<br>2. 在 `failoverPolicy.ts` 中，非瞬态错误时从 fallbackModels 中选择下一个可用模型<br>3. 模型选择优先级：用户当前选择 > fallbackModels 列表 > 全局默认<br>4. UI 新增"备用模型"配置项（ParameterPanel 高级区） |
| **用户意图识别** | 技能 `description` 字段语义匹配 + `SkillCommandSpec` 命令分发 + `ToolAvailabilityExpression` 动态可用性 + agent activation 模式（mention/always） | 无显式意图识别；用户消息直接拼入 prompt 发送；辅助模式仅提供 3 个推荐选项但不识别用户意图 | AI 被动响应，无法根据用户意图主动选择技能/调整策略 | 1. 新增轻量意图识别层（非 LLM 调用，基于关键词规则）<br>2. 定义意图类型：`DIALOGUE`（对话）/`WRITE`（写作请求）/`QUERY`（查询知识库）/`ACTION`（执行操作如整理/向量化）/`HELP`（求助）<br>3. 关键词规则示例：`写一段/续写/改写` → WRITE；`查一下/搜索/找` → QUERY；`整理/排序/更新` → ACTION<br>4. 根据意图动态调整技能可用性（如 WRITE 意图激活 `chapter-write`/`description-polish`）<br>5. 意图识别结果作为 metadata 注入 prompt（`[用户意图: WRITE]`），帮助 AI 理解用户期望 |
| **技能提示格式版本** | `promptFormatVersion`（当前 v3），版本号变化时强制模型重新读取 SKILL.md | 无版本概念 | 技能内容更新后模型可能使用过时信息 | 1. 在 `SkillEntry` 新增 `promptVersion` 字段（已有定义，需实际使用）<br>2. `formatSkillsForPrompt` 输出中包含 `<version>{version}</version>`<br>3. 版本号变化时，system prompt 中标注 `[技能版本已更新，请重新加载]` |

---

## 阶段性实施计划与里程碑

### 阶段一：交互入口多元化（M1）

**目标**：用户可通过斜杠命令、命令面板、快捷操作菜单三种方式触达智能体功能。

**交付物**：
- `SlashCommandRegistry.ts` + 首批 8 个命令
- `CommandPalette.tsx` 组件（Ctrl+K 唤起）
- `QuickActions` 菜单组件（⚡按钮）
- `ChatInputBar` 集成斜杠命令补全浮层

**量化评估标准**：
- 斜杠命令响应延迟 < 100ms（从输入 `/` 到补全浮层出现）
- 命令面板搜索 250ms 防抖，结果 < 50ms 渲染
- 快捷操作菜单覆盖 ≥ 8 项常用操作
- 用户可通过斜杠命令完成 ≥ 6 项操作（无需点击 UI 按钮）

### 阶段二：工具调用可视化与会话管理（M2）

**目标**：用户可看到 AI 的工具调用过程，可为同一角色创建/切换多个会话。

**交付物**：
- `ToolCallCard` 组件（pending/success/error 三态）
- `sessionManager.ts`（main 进程）+ 会话切换 UI
- `ChatMessageBubble` 集成工具调用卡片
- 会话管理 IPC 通道（create/list/switch/delete）

**量化评估标准**：
- 工具调用状态更新延迟 < 200ms（从 IPC 事件到 UI 渲染）
- 会话切换延迟 < 500ms（含消息历史加载）
- 同一角色支持 ≥ 10 个独立会话
- 工具调用卡片折叠/展开动画 < 300ms

### 阶段三：上下文压缩与故障转移（M3）

**目标**：长对话不丢失关键信息，provider 不可达时自动切换。

**交付物**：
- `contextCompactor.ts`（main 进程）
- `failoverPolicy.ts`（main 进程）+ `fallbackProviders` 配置
- Token 使用量进度条 UI
- 上下文窗口守卫（硬限制/警告阈值）

**量化评估标准**：
- 上下文压缩在 token > 70% 阈值时自动触发
- 压缩后保留 ≥ 90% 的专有名词（角色名/地名/物品名）
- 故障转移在 3 秒内完成（从错误检测到切换备用 provider）
- Token 进度条实时更新延迟 < 500ms

### 阶段四：智能响应水平提升（M4）

**目标**：AI 能主动识别可用技能并调用，检索结果更精准。

**交付物**：
- `skillPromptFormatter.ts` + `skillSnapshot.ts`
- `PromptBuilder` 集成技能提示词注入
- `ContextManager.retrieveWithHybrid`（MMR + 时间衰减）
- 轻量意图识别层

**量化评估标准**：
- 技能提示词注入后，AI 主动调用技能率 ≥ 30%（在支持 tool calling 的模型上）
- 混合检索 MMR 去重后，结果冗余率 < 10%
- 时间衰减使 30 天前的记忆权重降低 ≥ 50%
- 意图识别准确率 ≥ 80%（基于关键词规则，非 LLM 调用）

### 阶段五：UI 统一化与主题系统（M5）

**目标**：角色对话与智能体对话体验统一，支持主题切换。

**交付物**：
- `themeTokens.ts` 统一语义化色彩 token
- `ThemeProvider` 组件 + light/dark/auto 模式
- `AgentDialogueModal` 复用 `CharacterDialogueChat` 核心组件
- 工具调用状态色彩体系

**量化评估标准**：
- 角色对话与智能体对话的消息气泡/输入栏/流式渲染组件复用率 ≥ 80%
- 主题切换无闪烁（CSS 变量过渡 < 200ms）
- 语义化色彩 token 覆盖 ≥ 95% 的硬编码颜色
- 两套界面的圆角/配色/间距视觉一致性 ≥ 90%

---

## ADDED Requirements

### Requirement: 斜杠命令系统

系统 SHALL 在聊天输入框中支持斜杠命令（`/` 前缀），提供参数自动补全和命令执行能力。

#### Scenario: 触发命令补全
- **WHEN** 用户在输入框输入 `/` 字符
- **THEN** 弹出命令补全浮层，列出所有可用命令（名称 + 描述）
- **AND** 浮层在 100ms 内出现

#### Scenario: 参数补全
- **WHEN** 用户输入 `/model ` 后（命令后空格）
- **THEN** 弹出参数补全列表（如可用模型列表）
- **AND** 参数补全支持静态列表和动态生成两种模式

#### Scenario: 命令执行
- **WHEN** 用户选择命令并按 Enter
- **THEN** 执行对应命令处理函数
- **AND** 命令执行结果以 toast 或消息流反馈
- **AND** 输入框清空或填充命令结果

#### Scenario: 首批命令覆盖
- **WHEN** 系统初始化
- **THEN** 注册至少 8 个斜杠命令：`/help`、`/reset`、`/retry`、`/continue`、`/polish`、`/ai-reply`、`/model`、`/clear`

### Requirement: 命令面板

系统 SHALL 提供命令面板组件（`Ctrl+K` / `Cmd+K` 唤起），按四类组织所有可执行操作。

#### Scenario: 唤起命令面板
- **WHEN** 用户按下 `Ctrl+K`（Windows/Linux）或 `Cmd+K`（macOS）
- **THEN** 弹出命令面板浮层，聚焦搜索输入框
- **AND** 列出所有可用命令（按 navigation/actions/skills/settings 分类）

#### Scenario: 模糊搜索
- **WHEN** 用户在搜索框输入关键词
- **THEN** 250ms 防抖后执行模糊搜索
- **AND** 匹配命令名称和描述
- **AND** 结果按相关性排序

#### Scenario: 执行命令
- **WHEN** 用户选择命令并按 Enter
- **THEN** 执行对应操作
- **AND** 命令面板关闭
- **AND** 操作结果以适当方式反馈（toast/消息流/UI 变更）

### Requirement: 快捷操作菜单

系统 SHALL 在聊天输入栏提供"快捷操作"菜单（⚡按钮），聚合常用操作。

#### Scenario: 打开菜单
- **WHEN** 用户点击⚡按钮
- **THEN** 弹出菜单，按分组展示操作（对话操作/内容操作/设置操作）
- **AND** 每项操作显示名称 + 快捷键提示（如有）

#### Scenario: 执行操作
- **WHEN** 用户点击菜单项
- **THEN** 执行对应操作（如重试、续写、润色、记忆整理等）
- **AND** 菜单关闭

### Requirement: 工具调用可视化

系统 SHALL 在消息流中实时展示 AI 的工具调用过程，包括 pending/success/error 三态。

#### Scenario: 工具调用开始
- **WHEN** 收到 `agent:toolCall` 事件且状态为 pending/running
- **THEN** 在当前 assistant 消息内渲染工具调用卡片
- **AND** 卡片显示工具名 + 参数摘要 + 灰色脉冲状态指示
- **AND** 状态更新延迟 < 200ms

#### Scenario: 工具调用成功
- **WHEN** 工具调用返回成功结果
- **THEN** 卡片状态更新为绿色勾 + 耗时
- **AND** 默认收起输出，点击可展开查看

#### Scenario: 工具调用失败
- **WHEN** 工具调用返回错误
- **THEN** 卡片状态更新为红色叉 + 错误信息
- **AND** 提供重试按钮（如适用）

### Requirement: 会话管理

系统 SHALL 支持为同一角色/智能体创建、切换、删除多个独立会话。

#### Scenario: 新建会话
- **WHEN** 用户点击"新建会话"或输入 `/new`
- **THEN** 创建新会话，清空当前消息列表
- **AND** 会话标题自动取首条用户消息前 20 字符
- **AND** 会话元数据持久化到主进程

#### Scenario: 切换会话
- **WHEN** 用户从会话切换下拉菜单选择另一个会话
- **THEN** 加载该会话的消息历史
- **AND** 切换延迟 < 500ms
- **AND** 当前会话状态自动保存

#### Scenario: 会话列表
- **WHEN** 用户打开会话切换菜单
- **THEN** 列出当前角色的所有会话（标题 + 最后活跃时间 + 消息数）
- **AND** 按最后活跃时间降序排列

### Requirement: 上下文压缩

系统 SHALL 在对话历史接近上下文窗口限制时自动压缩历史消息，保留关键信息。

#### Scenario: 触发压缩
- **WHEN** 对话历史 token 数 > `maxContextTokens * 0.7`
- **THEN** 自动触发上下文压缩
- **AND** 保留最近 N 轮原文
- **AND** 较早消息按 10 轮一组生成摘要
- **AND** 摘要保留所有专有名词、重要事件、承诺、未解决话题

#### Scenario: 压缩结果注入
- **WHEN** 压缩完成
- **THEN** 摘要作为 system 消息注入上下文（标记 `[对话摘要]`）
- **AND** 原始消息被替换为摘要

#### Scenario: 压缩失败降级
- **WHEN** 压缩 API 调用失败
- **THEN** 降级为直接裁剪（现有 ContextTruncator 行为）
- **AND** 记录失败日志
- **AND** 对话主流程不受影响

### Requirement: 故障转移策略

系统 SHALL 在 AI provider 不可达时按错误类型分类处理，支持重试和备用 provider 切换。

#### Scenario: 瞬态错误重试
- **WHEN** AI 请求返回瞬态错误（rate_limit/timeout/overloaded）
- **THEN** 指数退避重试（最多 3 次）
- **AND** 重试间隔 1s/2s/4s

#### Scenario: 非瞬态错误切换
- **WHEN** AI 请求返回非瞬态错误（auth/model_not_found）且配置了备用 provider
- **THEN** 切换到备用 provider 重新发送请求
- **AND** UI 展示 toast "已切换到备用模型 {model}"
- **AND** 切换在 3 秒内完成

#### Scenario: 全部失败
- **WHEN** 重试和切换均失败
- **THEN** 返回最后一次错误信息
- **AND** UI 展示错误横幅 + 重试按钮

### Requirement: 上下文窗口守卫

系统 SHALL 在 UI 中展示上下文 token 使用量，并在接近限制时发出警告。

#### Scenario: 正常状态
- **WHEN** 剩余 token > 8000
- **THEN** token 进度条显示绿色
- **AND** 展示已用/总量（如 `12000/32000`）

#### Scenario: 警告状态
- **WHEN** 剩余 token ≤ 8000 且 > 4000
- **THEN** token 进度条变为黄色
- **AND** tooltip 提示"上下文即将耗尽"

#### Scenario: 危险状态
- **WHEN** 剩余 token ≤ 4000
- **THEN** token 进度条变为红色
- **AND** 展示"建议压缩对话历史"按钮
- **AND** 点击按钮触发上下文压缩

### Requirement: 技能提示词注入

系统 SHALL 将可用技能以 XML 格式注入 system prompt，使 AI 感知可调用的技能。

#### Scenario: 技能注入
- **WHEN** 构建 system prompt 时存在 `includeInAvailableSkillsPrompt=true` 的技能
- **THEN** 在 system prompt 中追加 `<available_skills>` XML 块
- **AND** 每个技能包含 `<name>` 和 `<description>` 标签
- **AND** 仅注入当前模式（dialogue/writing/game）适用的技能

#### Scenario: 技能快照缓存
- **WHEN** 同一会话内技能列表未变更
- **THEN** 复用技能快照缓存的格式化 prompt
- **AND** 不重新解析 SKILL.md

#### Scenario: 技能变更刷新
- **WHEN** 技能被安装/卸载/启用/禁用
- **THEN** 清除相关会话的技能快照
- **AND** 下次请求时重新解析并注入

### Requirement: 混合检索记忆搜索

系统 SHALL 实现向量 + FTS 混合检索 + MMR 去重 + 时间衰减的统一记忆搜索。

#### Scenario: 混合检索
- **WHEN** AI 请求前检索上下文
- **THEN** 同时执行向量检索和关键词检索
- **AND** 合并结果时向量权重 0.7 + 关键词权重 0.3

#### Scenario: MMR 去重
- **WHEN** 检索结果中存在高度相似的条目
- **THEN** 使用 MMR 算法去重（λ=0.7）
- **AND** 结果冗余率 < 10%

#### Scenario: 时间衰减
- **WHEN** 检索结果包含不同时间段的条目
- **THEN** 应用时间衰减因子 `exp(-daysSinceLastAccess / 30)`
- **AND** 30 天前的记忆权重降低 ≥ 50%

### Requirement: 用户意图识别

系统 SHALL 基于关键词规则识别用户意图，动态调整技能可用性和 prompt 策略。

#### Scenario: 意图分类
- **WHEN** 用户发送消息
- **THEN** 基于关键词规则识别意图类型（DIALOGUE/WRITE/QUERY/ACTION/HELP）
- **AND** 识别延迟 < 10ms（纯关键词匹配，无 LLM 调用）

#### Scenario: 意图驱动的技能激活
- **WHEN** 识别到 WRITE 意图
- **THEN** 激活 `chapter-write`/`description-polish`/`outline-generate` 技能
- **AND** 在 system prompt 中标注 `[用户意图: WRITE]`

#### Scenario: 意图识别准确率
- **WHEN** 评估意图识别质量
- **THEN** 关键词规则准确率 ≥ 80%
- **AND** 未识别意图时默认为 DIALOGUE

### Requirement: UI 样式统一化

系统 SHALL 统一角色对话与智能体对话的 UI 组件，引入语义化色彩 token 和主题系统。

#### Scenario: 组件复用
- **WHEN** 渲染智能体对话界面
- **THEN** 复用 CharacterDialogueChat 的消息列表、输入栏、流式渲染组件
- **AND** 组件复用率 ≥ 80%

#### Scenario: 主题切换
- **WHEN** 用户切换主题模式（light/dark/auto）
- **THEN** 所有 UI 组件颜色通过 CSS 变量过渡
- **AND** 过渡动画 < 200ms
- **AND** 无闪烁

#### Scenario: 语义化色彩覆盖
- **WHEN** 审查 CSS 硬编码颜色
- **THEN** ≥ 95% 的颜色值已替换为语义化 token 引用

## MODIFIED Requirements

### Requirement: 聊天输入栏功能

**原实现**：`ChatInputBar` 提供文本输入 + 人称选择 + AI回复 + 润色 + 发送 5 个按钮。

**新实现**：在原有基础上新增：斜杠命令解析（`/` 前缀触发补全浮层）、快捷操作菜单（⚡按钮聚合常用操作）、技能快捷调用入口（`userInvocable` 技能按钮组）、token 使用量进度条（输入栏上方）。

### Requirement: ChatEngine 状态管理

**原实现**：`ChatEngine` 回调注册制 + `isCancelled` 布尔 + `useCharacterDialogueChat` 10+ useRef 镜像状态。

**新实现**：引入 `useReducer` 统一管理聊天状态（messages/streaming/error/tokenUsage/toolCalls/session），定义 `ChatAction` 联合类型集中处理状态转换，减少手动 ref 同步。保留少量 ref 仅用于回调闭包场景。

### Requirement: system prompt 构建流程

**原实现**：`buildFinalSystemPrompt` 构建四区域结构化 prompt（区域1 背景知识/区域2 历史片段/区域3 记忆表格/区域4 异步整理指令）。

**新实现**：新增区域5 可用技能（`<available_skills>` XML 块）+ 区域6 用户意图标注（`[用户意图: {intent}]`），并在区域3之后注入对话摘要（上下文压缩结果，如有）。

## REMOVED Requirements

无。所有新增功能均为增量添加，不移除现有功能。
