# Checklist

## 阶段一：交互入口多元化（M1）

- [x] `SlashCommandRegistry.ts` 存在且定义了命令接口（name/description/argSuggestions/handler）
- [x] 首批 8 个斜杠命令已注册（`/help`、`/reset`、`/retry`、`/continue`、`/polish`、`/ai-reply`、`/model`、`/clear`）
- [x] 输入框输入 `/` 后 100ms 内弹出命令补全浮层
- [x] 命令参数补全正常工作（`/model ` 后弹出模型列表）
- [x] 键盘导航正常（↑↓选择、Enter执行、ESC关闭）
- [x] `CommandPalette.tsx` 组件存在且可通过 `Ctrl+K`/`Cmd+K` 唤起
- [x] 命令面板按四类分组（navigation/actions/skills/settings）
- [x] 命令面板搜索 250ms 防抖，结果 < 50ms 渲染
- [x] `QuickActionsMenu.tsx` 组件存在且包含⚡按钮入口
- [x] 快捷操作菜单覆盖 ≥ 8 项常用操作，按分组组织（对话操作/内容操作/设置操作）
- [x] 技能快捷按钮组展示 `userInvocable=true` 的技能（emoji+name）
- [x] 点击技能按钮弹出参数输入浮层，提交后调用 `skill:invoke` IPC
- [x] 技能调用结果以工具调用卡片形式展示在消息流中

## 阶段二：工具调用可视化与会话管理（M2）

- [x] `ToolCallCard.tsx` 组件存在，展示工具名 + 参数摘要 + 状态徽章 + 耗时 + 展开/收起输出
- [x] 工具调用三态样式正确：pending（灰色脉冲）、success（绿色勾）、error（红色叉+重试按钮）
- [x] `agent:toolCall` IPC 事件订阅正常，工具调用状态更新延迟 < 200ms
- [x] `ChatMessageBubble.tsx` 中集成了 `ToolCallCard`，多个工具调用按顺序排列
- [x] `sessionManager.ts` 存在且定义了会话数据结构和 CRUD 操作
- [x] 会话管理 IPC 通道注册正常（`session:create`/`session:list`/`session:switch`/`session:delete`/`session:rename`）
- [x] `ChatHeader.tsx` 中存在会话切换下拉菜单
- [x] 新建会话功能正常（Header 按钮或 `/new` 命令）
- [x] 会话切换延迟 < 500ms（含消息历史加载）
- [x] 会话标题自动取首条用户消息前 20 字符
- [x] `ChatAction` 联合类型已定义（SEND_MESSAGE/STREAM_CHUNK/STREAM_COMPLETE/STREAM_ERROR/TOOL_CALL_UPDATE/SESSION_SWITCH 等）
- [x] `chatReducer` 函数已实现，集中处理状态转换
- [x] `useCharacterDialogueChat` 中引入 `useReducer`，部分 useState + useRef 镜像状态已迁移

## 阶段三：上下文压缩与故障转移（M3）

- [x] `contextCompactor.ts` 存在且定义了 `compactContext` 接口
- [x] 对话历史 token > `maxContextTokens * 0.7` 时自动触发压缩
- [x] 压缩策略保留最近 N 轮原文 + 较早消息按 10 轮一组摘要
- [x] 压缩结果作为 system 消息注入上下文（标记 `[对话摘要]`）
- [x] 压缩失败降级为直接裁剪，不阻塞对话
- [x] `failoverPolicy.ts` 存在且定义了错误分类（瞬态/非瞬态/可探测）
- [x] 瞬态错误触发指数退避重试（最多 3 次，间隔 1s/2s/4s）
- [x] 非瞬态错误触发备用 provider 切换
- [x] `AIConfigProvider` 新增了 `fallbackProviders` 配置项
- [x] 故障转移时 UI 展示 toast "已切换到备用模型 {model}"
- [x] 故障转移在 3 秒内完成
- [x] `TokenUsageBar.tsx` 组件存在，展示已用/总量 token
- [x] 剩余 token < 8000 时进度条变黄色 + tooltip 警告
- [x] 剩余 token < 4000 时进度条变红色 + "压缩对话历史"按钮
- [x] 点击"压缩对话历史"按钮手动触发上下文压缩

## 阶段四：智能响应水平提升（M4）

- [x] `skillPromptFormatter.ts` 存在且实现了 `formatSkillsForPrompt` 函数
- [x] 技能 prompt 以 XML 格式输出（`<available_skills><skill>...</skill></available_skills>`）
- [x] 仅注入 `includeInAvailableSkillsPrompt=true` 且当前模式适用的技能
- [x] `PromptBuilder.ts::buildFinalSystemPrompt` 中新增区域5：可用技能
- [x] `skillSnapshot.ts` 存在且定义了 `SkillSnapshot` 类型
- [x] 会话内复用技能快照（技能列表不变时不重新解析）
- [x] 技能变更时清除相关快照
- [x] `ContextManager.retrieveWithHybrid` 方法存在
- [x] 混合检索合并向量（权重0.7）+ 关键词（权重0.3）结果
- [x] MMR 去重算法实现（λ=0.7），结果冗余率 < 10%
- [x] 时间衰减因子 `exp(-daysSinceLastAccess / 30)` 已应用
- [x] `IntentRecognizer.ts` 存在且定义了 5 种意图类型
- [x] 意图识别基于关键词规则，延迟 < 10ms
- [x] 意图驱动的技能激活正常工作（WRITE 意图激活写作技能）
- [x] 意图识别结果注入 system prompt 区域6：`[用户意图: {intent}]`
- [x] 未识别意图时默认为 DIALOGUE

## 阶段五：UI 统一化与主题系统（M5）

- [x] `themeTokens.ts` 存在且定义了语义化色彩 token（text/dim/accent/border/userBg/toolPendingBg/toolSuccessBg/toolErrorBg 等）
- [x] `ThemeProvider.tsx` 组件存在，支持 light/dark/auto 三种模式
- [x] dark 和 light 两套调色板已定义
- [x] auto 模式跟随系统 `prefers-color-scheme`
- [x] 主题切换无闪烁（CSS 变量过渡 < 200ms）
- [x] `ChatMessageList.tsx` 已抽取为独立可复用组件
- [x] `ChatStreamRenderer.tsx` 已抽取为独立可复用组件
- [x] `AgentDialogueModal.tsx` 复用 `ChatMessageList`、`ChatInputBar`、`ChatStreamRenderer`
- [x] 角色对话与智能体对话的组件复用率 ≥ 80%
- [x] 消息气泡样式统一（圆角/配色/间距通过 mode prop 控制少量差异）
- [x] `ToolCallCard.tsx` 使用语义化 token 替代硬编码颜色
- [x] 工具调用卡片折叠/展开动画 < 300ms
- [x] 语义化色彩 token 覆盖 ≥ 95% 的硬编码颜色

## 交叉验证

- [x] 所有新增功能均不破坏现有 UI 操作流程（发送/重试/续写/润色/AI回复/记忆整理等原有功能正常）
- [x] IPC 通道名与 preload 命名空间保持一致（新增通道遵循现有命名规范）
- [x] 新增组件目录结构遵循现有项目规范（`src/renderer/components/Common/` 下公共组件）
- [x] 斜杠命令与命令面板的操作结果一致（同一操作通过两种入口执行效果相同）
- [x] 会话切换时工具调用状态正确清理（不残留上一个会话的工具调用卡片）
- [x] 故障转移后对话上下文保持完整（不丢失消息历史）
- [x] 上下文压缩后 AI 仍能引用早期设定（角色名/地名/物品名保留 ≥ 90%）
- [x] 技能提示词注入不影响现有 prompt 结构（区域1-4 不受影响，区域5/6 为追加）
