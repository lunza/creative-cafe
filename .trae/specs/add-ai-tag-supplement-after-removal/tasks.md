# Tasks

- [x] Task 1: 类型扩展 — `characterTraitAIService.ts` + `CharacterDialogueChat.types.ts` + `electron.d.ts`
  - [x] SubTask 1.1: `characterTraitAIService.ts` 的 `OptimizeTraitsResult` 接口新增 `tagsToAdd?: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }>` 字段
  - [x] SubTask 1.2: `CharacterDialogueChat.types.ts` 的 `ImageHistoryItem` 新增 `addedTags?: Array<{ text: string; reason?: string }>` 字段（含 JSDoc 注释，说明仅当 AI 实际补充了标签时存在）
  - [x] SubTask 1.3: `CharacterDialogueChat.types.ts` 的 `ImageHistoryItem.aiOptimization` 新增 `addedCount: number` 字段（记录补充标签数，与 `removedCount` 对称）
  - [x] SubTask 1.4: `electron.d.ts` 的 `optimizeTraitsForContext` 返回值类型同步新增 `tagsToAdd` 字段

- [x] Task 2: AI 服务 system prompt 重构 + 响应解析 — `characterTraitAIService.ts`
  - [x] SubTask 2.1: 重构 `optimizeTraitsForContext` 的 system prompt，从「仅返回 remove 列表」改为「同时返回 remove + add 列表」。新增 PART 2 SUPPLEMENT 指令：删除标签后评估当前视觉状态，补充缺失的关键特征标签（暴露特征/姿势/状态等）
  - [x] SubTask 2.2: 更新 JSON 返回格式示例为 `{ "remove": [...], "add": [...] }`
  - [x] SubTask 2.3: 更新 user message，提示 AI 同时分析删除和补充
  - [x] SubTask 2.4: 重构 `parseOptimizeResponse` 解析器，同时解析 `remove` 和 `add` 两个字段，返回 `{ tagsToRemove, tagsToAdd }`
  - [x] SubTask 2.5: 更新 `optimizeTraitsForContext` 方法返回值，包含 `tagsToAdd`

- [x] Task 3: `executeImageGeneration` 补充标签处理逻辑 — `CharacterDialogueChat.tsx`
  - [x] SubTask 3.1: 在 AI 优化返回 `tagsToAdd` 后，执行去重检查：跳过已存在于 `mergedTraits` 中的标签（大小写不敏感）
  - [x] SubTask 3.2: 执行冲突检查：跳过在 `tagsToRemove`（刚被删除）中的标签（大小写不敏感），记录警告日志
  - [x] SubTask 3.3: 执行过度补充防护：若 `tagsToAdd` 有效数量 > `mergedTraits.length × 50%`，拒绝补充（仅执行删除），记录警告日志
  - [x] SubTask 3.4: 将有效补充标签加入 `mergedTraits`（`splice` 追加，保留 `weight` / `categoryId` 字段）
  - [x] SubTask 3.5: 构建 `addedTags` 数组（仅含实际添加的标签 + reason），用于 `ImageHistoryItem` 快照
  - [x] SubTask 3.6: 更新 `aiOptimization` 元数据写入，新增 `addedCount: addedTags.length`
  - [x] SubTask 3.7: 更新 `ImageHistoryItem` 构建时写入 `addedTags` 字段（`addedTags.length > 0 ? addedTags : undefined`）
  - [x] SubTask 3.8: 更新 console.log 诊断日志，输出补充标签信息

- [x] Task 4: ChatMessageBubble 标签快照面板「AI 已补充」分区 — `ChatMessageBubble.tsx`
  - [x] SubTask 4.1: 在「AI 已移除」分区下方新增「AI 已补充」分区，条件渲染 `currentHistoryItem.addedTags && addedTags.length > 0`
  - [x] SubTask 4.2: 补充标签以绿色高亮样式展示（与 removedTags 的灰色删除线形成对比）
  - [x] SubTask 4.3: 每个 addedTag 添加 Tooltip 显示添加原因（`AI 补充原因：${reason}`）
  - [x] SubTask 4.4: 头部徽标扩展：当 `aiOptimization.addedCount > 0` 时，徽标文案从「AI 已移除 N」扩展为「AI 已移除 N / 已补充 M」
  - [x] SubTask 4.5: `success` 状态分区同时支持展示 removedTags 和 addedTags（两者可同时存在）

- [x] Task 5: CSS 样式 — `ChatMessageBubble.css`
  - [x] SubTask 5.1: 新增 `.chat-msg-image-added-tags` 容器样式（绿色系背景 + 边框，与 removedTags 灰色系区分）
  - [x] SubTask 5.2: 新增 `.chat-msg-image-added-tags-label` 标签文案样式（含补充计数）
  - [x] SubTask 5.3: 新增 `.chat-msg-image-added-tags-list` 列表容器样式
  - [x] SubTask 5.4: 新增 `.chat-msg-image-added-tag` 单个补充标签样式（绿色高亮 + ✨ 图标可选）
  - [x] SubTask 5.5: 新增 `.chat-msg-image-ai-badge-success` 扩展样式，支持补充计数的展示（如需要）
  - [x] SubTask 5.6: 样式遵循 `ui-variables.css` CSS 变量，兼容亮/暗双主题

- [x] Task 6: TypeScript 编译验证 + 文档增量更新
  - [x] SubTask 6.1: `npx tsc --noEmit` 确认无新增类型错误
  - [x] SubTask 6.2: `docs/FIX_RECORDS.md` 新增 §7.39 + §7.40 记录实现过程与设计决策
  - [x] SubTask 6.3: `CODE_WIKI.md` 更新 `ImageHistoryItem` 字段表（新增 `addedTags` + `aiOptimization.addedCount`）+ IPC 表 `optimizeTraitsForContext` 返回值描述更新
  - [x] SubTask 6.4: `CHANGELOG.md` 新增功能条目

# Task Dependencies

- Task 1 → Task 2（service 接口扩展依赖类型定义）
- Task 1 + Task 2 → Task 3（executeImageGeneration 集成依赖类型定义 + service 返回 tagsToAdd）
- Task 1 → Task 4（UI 渲染依赖 ImageHistoryItem.addedTags 字段）
- Task 4 → Task 5（CSS 样式依赖 UI 结构确定）
- Task 3 + Task 4 → Task 6（文档更新依赖实现完成）
- Task 1 可与 Task 5 的 CSS 草拟并行（样式类名在 Task 4 中确定）
