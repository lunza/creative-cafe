# Tasks

- [x] Task 1: 类型扩展 — `CharacterDialogueChat.types.ts`
  - [x] SubTask 1.1: `AIParameterConfig` 新增 `ai_optimize_traits?: boolean` 字段（含 JSDoc 注释，说明默认关闭、试验性功能）
  - [x] SubTask 1.2: `ImageHistoryItem` 新增 `removedTags?: Array<{ text: string; reason?: string }>` 字段（含 JSDoc 注释）

- [x] Task 2: AI 服务方法 — `characterTraitAIService.ts`
  - [x] SubTask 2.1: 新增 `OptimizeTraitsParams` 接口 `{ traits: Array<{ text: string }>; conversationContext: string }`
  - [x] SubTask 2.2: 新增 `OptimizeTraitsResult` 接口 `{ success: boolean; tagsToRemove?: Array<{ text: string; reason?: string }>; error?: string }`
  - [x] SubTask 2.3: 新增 `optimizeTraitsForContext` 方法 — 复用 `generateTraitPrompts` 的 AI 配置读取 + fetch 模式，构建专用 system prompt（分析角色特征与对话上下文的矛盾，返回 JSON 格式删除列表），解析 JSON 响应
  - [x] SubTask 2.4: system prompt 设计 — 指导 AI 分析「对话上下文中描述的场景变化（脱衣/姿势改变/位置变化等）与角色特征标签的矛盾关系」，返回 `{ "remove": [{ "text": "pants", "reason": "对话中角色脱下了裤子" }] }` 格式

- [x] Task 3: IPC 通道 — `characterTraitAIHandlers.ts` + `preload.ts` + `electron.d.ts`
  - [x] SubTask 3.1: `characterTraitAIHandlers.ts` 注册 `ai:optimizeTraitsForContext` handler（包裹 service 方法 + 错误处理）
  - [x] SubTask 3.2: `preload.ts` 暴露 `ai.optimizeTraitsForContext` 方法
  - [x] SubTask 3.3: `electron.d.ts` 新增类型声明（入参 + 返回值类型签名，与主进程同步）

- [x] Task 4: ConfigPanel UI — `ConfigPanel.tsx` + `ConfigPanel.css`
  - [x] SubTask 4.1: `ConfigPanel` props 新增 `aiOptimizeTraits?: boolean` + `onAiOptimizeTraitsToggle?: (enabled: boolean) => void`
  - [x] SubTask 4.2: 在「互动标签权重」滑块下方、「在对话中一键生成场景图片」提示上方，新增「允许 AI 优化特征标签」开关行
  - [x] SubTask 4.3: 开关旁添加试验性警示文案（黄色 Warning 风格）：「⚠ 试验性功能：AI 可能会删除重要标签，建议谨慎使用」
  - [x] SubTask 4.4: 开关 `disabled={!imageGenEnabled}`（图片生成关闭时禁用）
  - [x] SubTask 4.5: `ConfigPanel.css` 新增 `.image-gen-experimental-warning` 样式（黄色文字 + 警告图标）

- [x] Task 5: CharacterDialogueChat 集成 — `CharacterDialogueChat.tsx`
  - [x] SubTask 5.1: 从 `characterConfig?.customParameters` 读取 `ai_optimize_traits`，透传给 `ConfigPanel`
  - [x] SubTask 5.2: 新增 `handleAiOptimizeTraitsToggle` 回调（更新 `customParameters.ai_optimize_traits` + 持久化）
  - [x] SubTask 5.3: `executeImageGeneration` 在收集 `enabledTraitTexts` 后（L463 之后）、生成上下文标签前（L467 之前）插入 AI 优化步骤：
    - 读取 `ai_optimize_traits` 开关状态
    - 若开启：调用 `window.electronAPI.ai.optimizeTraitsForContext({ traits: enabledTraitTexts, conversationContext })`
    - 验证返回结果（存在性过滤 + 过度删除防护 80% 阈值）
    - 过滤 `enabledTraitTexts`，构建 `removedTags` 数组
    - 记录操作日志
    - 失败时降级为不优化（保持原列表），记录错误日志
  - [x] SubTask 5.4: `ImageHistoryItem` 构建时（L624-633）写入 `removedTags` 字段

- [x] Task 6: 标签快照展示 — `ChatMessageBubble.tsx`
  - [x] SubTask 6.1: 在标签展示面板（`usedTags` 折叠区）下方新增「AI 已移除」分区
  - [x] SubTask 6.2: 仅当 `history[currentIndex].removedTags` 非空数组时渲染
  - [x] SubTask 6.3: 被删除标签以灰色 + 删除线样式展示（`text-decoration: line-through; opacity: 0.5`）
  - [x] SubTask 6.4: 若 `removedTags[i].reason` 存在，添加 Tooltip 悬停显示原因

- [x] Task 7: TypeScript 编译验证 + 文档增量更新
  - [x] SubTask 7.1: `npx tsc --noEmit` 确认无新增类型错误
  - [x] SubTask 7.2: `docs/FIX_RECORDS.md` 新增 §7.36 记录实现过程与重点问题
  - [x] SubTask 7.3: `CODE_WIKI.md` 对应章节更新（ImageHistoryItem 字段表 + AIParameterConfig 字段表 + IPC 命名空间表）
  - [x] SubTask 7.4: `CHANGELOG.md` 新增功能条目

# Task Dependencies

- Task 2 → Task 3（IPC handler 依赖 service 方法）
- Task 1 + Task 3 → Task 5（集成依赖类型定义 + IPC 通道）
- Task 4 → Task 5（ConfigPanel props 依赖）
- Task 1 + Task 5 → Task 6（标签快照展示依赖 ImageHistoryItem 字段 + executeImageGeneration 写入）
- Task 5 → Task 7（文档更新依赖实现完成）
- Task 1 可与 Task 2 并行（无依赖）
- Task 4 可与 Task 2/Task 3 并行（仅依赖 Task 1 的类型定义，但 ConfigPanel props 可先定义）
