# Checklist

- [x] `AIParameterConfig.strip_think_tags?: boolean` 字段已添加，附 JSDoc 说明默认开启语义
- [x] `requestAIResponse.onComplete` 在 `displayContent = finalContent;` 前已按开关调用 `stripThinkingTags`
- [x] `polishInput.onComplete` 在 `resolve(finalContent)` 前已按开关调用 `stripThinkingTags`
- [x] `stripThinkingTags` 从 `./utils/messageProcessor` 正确导入到 `CharacterDialogueChat.hooks.ts`
- [x] `ParameterPanel` 新增 `stripThinkTags` / `onStripThinkTagsToggle` props
- [x] "Think 标签处理" Switch UI 位于 "Emoji 增强模式" 与 "自定义停止序列" 之间，样式与 emoji 区块一致
- [x] Tooltip 文案正确，包含 "deepseek3.2"、"默认开启"、"写入存储前剥离" 关键信息
- [x] `ConfigPanel` 正确透传 `stripThinkTags` / `onStripThinkTagsToggle` 给 `ParameterPanel`
- [x] `CharacterDialogueChat.tsx` 传入 `stripThinkTags={characterConfig?.customParameters?.strip_think_tags !== false}` 与 `onStripThinkTagsToggle={(enabled) => handleParameterChange({ strip_think_tags: enabled })}`
- [x] 流式 `onStream` 阶段不剥离，保留原始累计内容
- [x] `processMessage` 内的渲染时 `stripThinkingTags` 兜底未被删除（处理历史脏数据）——`messageProcessor.ts` line 177 / 210 仍调用
- [x] TypeScript 类型检查通过，未引入新错误（剩余错误均为 src/main/ 与 WritingConfigPanel/VectorConfigPanel 预存错误）
- [x] 切换开关状态后刷新页面，状态从 `localStorage['character-session-<cardId>']` 正确恢复——`handleParameterChange` 复用 `updateConfig` 持久化机制（与 emoji_enhanced 相同路径，代码审查确认）
- [ ] 开启状态下：AI 回复存储内容（messages.json）不再含 think 标签——需用户运行时验证
- [ ] 开启状态下：润色返回文本不再含 think 标签——需用户运行时验证
- [ ] 关闭状态下：AI 原始回复（含 think 标签）直接存入历史，但渲染仍干净（兜底剥离生效）——需用户运行时验证
- [x] 技术文档增量更新（`doc/04b-character-dialogue-chat-module.md` 3.5 节新增「Think 标签后处理」表格 + 4.4 节边界情况新增条目；`CHANGELOG.md` [Unreleased] / Added 新增条目）
