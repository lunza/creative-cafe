# Tasks

- [ ] Task 1: 修复所有 updateProject 调用中的根级别 chapters 赋值
  - [ ] SubTask 1.1: 搜索所有 `updateProject` 调用，移除所有形如 `{ chapters: ..., outline: ... }` 中的 `chapters` 字段
  - [ ] SubTask 1.2: 修复 `useChapterGeneration.ts` 中的章节更新逻辑（保存、生成完成、清空）
  - [ ] SubTask 1.3: 修复 `useChapterStructure.ts` 中的拆分/合并更新逻辑
  - [ ] SubTask 1.4: 修复 `OutlineEditor.tsx` 中的大纲确认保存逻辑
  - [ ] SubTask 1.5: 修复 `usePlotCheck.ts` 中的剧情检查更新逻辑
  - [ ] SubTask 1.6: 修复 `writingHandlers.ts` 中的 IPC 处理逻辑（如存在）

- [ ] Task 2: 验证 WritingProject 接口定义
  - [ ] SubTask 2.1: 检查 `writing.types.ts` 确保 `WritingProject` 接口不包含根级别 `chapters` 字段

- [ ] Task 3: 编译验证
  - [ ] SubTask 3.1: 运行 TypeScript 编译，确保无新增错误

- [ ] Task 4: 功能测试验证
  - [ ] SubTask 4.1: 创建新项目，生成大纲，验证 project.json 仅存在 outline.chapters
  - [ ] SubTask 4.2: 测试章节生成功能，验证 project.json 结构正确
  - [ ] SubTask 4.3: 测试章节拆分/合并功能，验证 project.json 结构正确
  - [ ] SubTask 4.4: 确认根级别不存在 chapters 字段

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
- [Task 4] depends on [Task 3]
