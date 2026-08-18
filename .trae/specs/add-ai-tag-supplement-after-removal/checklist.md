# Checklist

## 类型与接口
- [x] `OptimizeTraitsResult` 新增 `tagsToAdd?: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }>` 字段
- [x] `ImageHistoryItem` 新增 `addedTags?: Array<{ text: string; reason?: string }>` 字段
- [x] `ImageHistoryItem.aiOptimization` 新增 `addedCount: number` 字段
- [x] `electron.d.ts` 的 `optimizeTraitsForContext` 返回值类型同步新增 `tagsToAdd`

## AI 服务
- [x] system prompt 新增 PART 2 SUPPLEMENT 指令，指导 AI 在删除后评估并补充缺失标签
- [x] JSON 返回格式示例更新为 `{ "remove": [...], "add": [...] }`
- [x] user message 提示 AI 同时分析删除和补充
- [x] 响应解析器同时解析 `remove` 和 `add` 两个字段
- [x] `optimizeTraitsForContext` 方法返回值包含 `tagsToAdd`

## executeImageGeneration 集成
- [x] 补充标签去重检查（跳过已存在于 mergedTraits 中的标签）
- [x] 补充标签冲突检查（跳过刚被删除的标签）
- [x] 过度补充防护（>50% 拒绝执行补充）
- [x] 有效补充标签加入 mergedTraits（splice 追加）
- [x] `addedTags` 数组构建（仅含实际添加的标签）
- [x] `aiOptimization.addedCount` 正确写入
- [x] `ImageHistoryItem.addedTags` 正确写入
- [x] console.log 诊断日志输出补充标签信息

## UI 展示
- [x] 「AI 已补充」分区在 addedTags 非空时渲染
- [x] 补充标签以绿色高亮样式展示
- [x] 每个 addedTag 有 Tooltip 显示添加原因
- [x] 头部徽标在有补充时显示「AI 已移除 N / 已补充 M」
- [x] success 状态分区同时支持 removedTags 和 addedTags

## CSS 样式
- [x] `.chat-msg-image-added-tags` 容器样式（绿色系）
- [x] `.chat-msg-image-added-tags-label` 文案样式
- [x] `.chat-msg-image-added-tags-list` 列表容器样式
- [x] `.chat-msg-image-added-tag` 单标签样式
- [x] 样式遵循 ui-variables.css CSS 变量，兼容亮/暗双主题

## 防御性设计
- [x] AI 调用失败/超时/非法 JSON 时降级为不优化（不删除不补充）
- [x] 补充标签为空时不渲染「AI 已补充」分区
- [x] 未启用 ai_optimize_traits 时不执行补充（与删除一致）
- [x] 旧数据兼容：无 addedTags 字段的历史项不渲染补充分区

## 编译与文档
- [x] `npx tsc --noEmit` 无新增类型错误
- [x] `docs/FIX_RECORDS.md` 新增 §7.39 + §7.40 记录
- [x] `CODE_WIKI.md` ImageHistoryItem 字段表 + IPC 表更新
- [x] `CHANGELOG.md` 新增功能条目
