# Checklist

- [x] think 标签剥离处声明 `thinkTagsStripped` 标志位，初始为 `false`
- [x] `stripThinkingTags` 实际改变 `finalContent.length` 时设置 `thinkTagsStripped = true`
- [x] 内容保护检查条件增加 `&& !thinkTagsStripped`
- [x] 修改后的完整条件：`if (!isAsyncMode && !thinkTagsStripped && existingContent.length > 0 && displayContent.length < existingContent.length)`
- [x] TypeScript 类型检查通过，未引入新错误（剩余错误均为预存，不在修改行内）
- [x] 技术文档 `doc/04b-character-dialogue-chat-module.md` 增量更新，标注【重点标记】
- [x] `CHANGELOG.md` 新增【重点标记】条目
