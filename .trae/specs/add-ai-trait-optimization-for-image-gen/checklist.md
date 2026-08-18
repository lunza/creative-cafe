# Checklist

## 类型与配置
- [x] `AIParameterConfig` 新增 `ai_optimize_traits?: boolean` 字段，含 JSDoc 注释说明默认关闭 + 试验性功能
- [x] `ImageHistoryItem` 新增 `removedTags?: Array<{ text: string; reason?: string }>` 字段
- [x] 开关默认状态为关闭（`undefined` / `false` 均视为关闭）

## AI 服务
- [x] `optimizeTraitsForContext` 方法复用现有 AI 配置读取模式（baseUrl / apiKey / modelName / temperature / maxTokens）
- [x] system prompt 指导 AI 分析「对话上下文场景变化与角色特征标签的矛盾」，返回 JSON 格式 `{ "remove": [{ "text": "...", "reason": "..." }] }`
- [x] AI 返回结果解析为结构化 `tagsToRemove` 数组
- [x] 非流式 POST `/v1/chat/completions`（stream: false），与 `generateTraitPrompts` 一致
- [x] AI 调用失败 / 超时 / 返回非法 JSON 时返回 `{ success: false, error }`，不抛异常

## IPC 通道
- [x] `ai:optimizeTraitsForContext` handler 注册在 `characterTraitAIHandlers.ts`
- [x] `preload.ts` 暴露 `ai.optimizeTraitsForContext` 方法
- [x] `electron.d.ts` 类型签名与主进程同步（入参 + 返回值）
- [x] handler 包裹 try-catch 错误处理

## ConfigPanel UI
- [x] 「允许 AI 优化特征标签」开关位于「互动标签权重」滑块下方
- [x] 开关旁显示试验性警示文案：「⚠ 试验性功能：AI 可能会删除重要标签，建议谨慎使用」
- [x] 警示文案使用黄色 Warning 风格
- [x] 开关 `disabled={!imageGenEnabled}`（图片生成关闭时禁用）
- [x] 开关状态持久化到 `customParameters.ai_optimize_traits`

## executeImageGeneration 集成
- [x] AI 优化步骤插入在收集 `enabledTraitTexts` 后、生成上下文标签前
- [x] 仅当 `ai_optimize_traits === true` 时执行
- [x] 调用 `window.electronAPI.ai.optimizeTraitsForContext({ traits: enabledTraitTexts, conversationContext })`
- [x] 存在性验证：仅过滤 `enabledTraitTexts` 中实际存在的标签（AI 返回的不存在标签被忽略）
- [x] 过度删除防护：AI 返回删除列表覆盖 >80% 标签时拒绝执行，保持原列表
- [x] 失败降级：AI 调用失败时保持原 `enabledTraitTexts` 不变，不中断图片生成流程
- [x] `ImageHistoryItem` 写入 `removedTags` 字段
- [x] 操作日志记录：启用状态 + AI 建议删除列表 + 实际过滤结果

## 标签快照展示
- [x] `ChatMessageBubble` 标签面板新增「AI 已移除」分区
- [x] 仅当 `removedTags` 非空数组时渲染
- [x] 被删除标签灰色 + 删除线样式
- [x] 若存在 `reason`，Tooltip 悬停显示删除原因

## 防御性设计（参照 project_memory 教训）
- [x] AI 返回结果不信任——必须做存在性过滤 + 过度删除防护
- [x] AI 调用失败不中断主流程——降级为不优化
- [x] `enabledTraitTexts` 过滤后仍保留 `categoryId` 字段（避免对象重构丢字段，参照 globalCategories 教训）
- [x] 过滤后的 `enabledTraitTexts` 正确传递给后续 `generateTraitPrompts`（baseTraits 参数）

## 文档
- [x] `npx tsc --noEmit` 无新增类型错误
- [x] `docs/FIX_RECORDS.md` §7.36 记录实现过程
- [x] `CODE_WIKI.md` 更新 ImageHistoryItem 字段表 + AIParameterConfig 字段表 + IPC 命名空间表
- [x] `CHANGELOG.md` 新增功能条目
