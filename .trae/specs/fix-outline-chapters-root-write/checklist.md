# Checklist

- [ ] `useChapterGeneration.ts` 中不再传递根级别 `chapters` 字段
- [ ] `useChapterStructure.ts` 中不再传递根级别 `chapters` 字段
- [ ] `OutlineEditor.tsx` 中不再传递根级别 `chapters` 字段
- [ ] `usePlotCheck.ts` 中不再传递根级别 `chapters` 字段
- [ ] 全局搜索 `updateProject` 确认无根级别 `chapters` 赋值
- [ ] `WritingProject` 接口定义验证无冗余 `chapters` 字段
- [ ] TypeScript 编译无新增错误
- [ ] 新建项目生成大纲后，`project.json` 仅存在 `outline.chapters`
- [ ] 执行章节拆分/合并后，`project.json` 结构正确
- [ ] 所有功能操作均正常读写 `outline.chapters` 数据
