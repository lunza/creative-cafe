# Tasks

- [x] Task 1: 扩展类型定义
  - [x] SubTask 1.1: 在 `writing.types.ts` 中添加章节类型枚举 `ChapterType`（主线剧情、支线剧情、过渡章节、高潮章节、结尾章节）
  - [x] SubTask 1.2: 在 `writing.types.ts` 中添加重要程度枚举 `ImportanceLevel`（低、中、高、关键）
  - [x] SubTask 1.3: 扩展 `ChapterOutline` 类型，添加 `chapterType`、`importance`、`children`（子章节数组）字段
  - [x] SubTask 1.4: 添加 `OutlineAction` 类型（用于撤销/重做历史记录）
  - [x] SubTask 1.5: 添加 `OutlineHistoryState` 类型（用于版本历史）

- [x] Task 2: 创建手动大纲编辑器核心组件
  - [x] SubTask 2.1: 创建 `ManualOutlineEditor.tsx` 组件框架
  - [x] SubTask 2.2: 实现章节树形列表显示（支持展开/折叠子章节）
  - [x] SubTask 2.3: 实现章节属性编辑面板（名称、预估字数、剧情梗概、章节类型、重要程度）
  - [x] SubTask 2.4: 实现表单验证逻辑

- [x] Task 3: 实现章节管理操作
  - [x] SubTask 3.1: 实现添加章节功能（顶级章节和子章节）
  - [x] SubTask 3.2: 实现删除章节功能（带确认对话框）
  - [x] SubTask 3.3: 实现上下移动调整章节顺序
  - [x] SubTask 3.4: 实现合并章节功能
  - [x] SubTask 3.5: 实现拆分章节功能

- [x] Task 4: 实现撤销/重做功能
  - [x] SubTask 4.1: 在 `writingProjectStore` 中实现 undo/redo 状态管理（支持20步历史）
  - [x] SubTask 4.2: 实现键盘快捷键（Ctrl+Z 撤销，Ctrl+Y 重做）
  - [x] SubTask 4.3: 实现撤销/重做按钮及状态指示器

- [x] Task 5: 实现自动保存机制
  - [x] SubTask 5.1: 在 `writingProjectStore` 中实现自动保存节流（500ms）
  - [x] SubTask 5.2: 扩展 `WritingStorageService` 支持大纲增量更新
  - [x] SubTask 5.3: 添加保存状态指示器

- [x] Task 6: 集成现有组件
  - [x] SubTask 6.1: 在 `OutlineEditor.tsx` 中添加 AI生成/手动编辑 模式切换
  - [x] SubTask 6.2: 实现模式切换时的数据保留逻辑
  - [x] SubTask 6.3: 更新 `WritingModeEntry.tsx` 支持手动大纲模式

- [x] Task 7: 扩展 IPC 处理器
  - [x] SubTask 7.1: 在 `writingHandlers.ts` 中添加 `outline:update` 处理器
  - [x] SubTask 7.2: 在 `writingHandlers.ts` 中添加 `outline:save` 处理器
  - [x] SubTask 7.3: 在 `writingHandlers.ts` 中添加 `outline:load` 处理器

- [x] Task 8: 样式与用户体验优化
  - [x] SubTask 8.1: 实现章节类型和重要程度的颜色标识
  - [x] SubTask 8.2: 实现空状态提示
  - [x] SubTask 8.3: 添加加载/保存状态动画
  - [x] SubTask 8.4: 确保主题样式一致性（支持亮色/暗色主题）

- [x] Task 9: 验证与测试
  - [x] SubTask 9.1: 运行 `npm run build` 确认无编译错误
  - [x] SubTask 9.2: 手动测试所有功能点（添加、删除、移动、合并、拆分、撤销/重做）
  - [x] SubTask 9.3: 验证自动保存机制正常工作

# Task Dependencies

- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 3]
- [Task 6] depends on [Task 2]
- [Task 7] depends on [Task 5]
- [Task 8] depends on [Task 6]
- [Task 9] depends on [Task 8]
