# Tasks

- [x] Task 1: 创建新的 UI 状态管理 Store
  - [x] SubTask 1.1: 创建 writingModeUIStore.ts 管理 UI 状态（侧边栏展开/折叠、右侧面板显示/隐藏、当前激活面板、窗口尺寸等）
  - [x] SubTask 1.2: 定义 UI 布局类型和枚举（LayoutMode、ActivePanel、RightPanelTab 等）
  - [x] SubTask 1.3: 添加响应式布局检测逻辑（宽屏/中屏/窄屏）

- [x] Task 2: 重构 WritingModeEntry 为主容器
  - [x] SubTask 2.1: 重写 WritingModeEntry.tsx 为三层布局容器
  - [x] SubTask 2.2: 实现左侧导航栏（项目列表 + 创作阶段导航）
  - [x] SubTask 2.3: 实现中间主内容区（动态内容渲染）
  - [x] SubTask 2.4: 实现右侧辅助面板（可折叠，支持多 Tab 切换）
  - [x] SubTask 2.5: 实现响应式布局适配逻辑

- [x] Task 3: 创建左侧导航栏组件
  - [x] SubTask 3.1: 创建 WritingModeSidebar（内联在 WritingModeEntry 中）
  - [x] SubTask 3.2: 实现项目列表区域（搜索、新建、列表展示）
  - [x] SubTask 3.3: 实现创作阶段导航（项目列表、大纲设计、内容创作、审阅导出）
  - [x] SubTask 3.4: 实现项目选中高亮和状态指示

- [x] Task 4: 创建右侧辅助面板组件
  - [x] SubTask 4.1: 创建 WritingModeRightPanel.tsx
  - [x] SubTask 4.2: 实现素材库 Tab（世界书、角色卡、人设）
  - [x] SubTask 4.3: 实现 AI 助手 Tab（对话式 AI 建议）
  - [x] SubTask 4.4: 实现章节预览 Tab
  - [x] SubTask 4.5: 实现面板折叠/展开动画

- [x] Task 5: 创建素材聚合面板组件
  - [x] SubTask 5.1: 创建 MaterialPanel（内联在 RightPanel 中）
  - [x] SubTask 5.2: 实现世界书列表与预览
  - [x] SubTask 5.3: 实现角色卡列表与关键属性速览
  - [x] SubTask 5.4: 实现素材搜索与标签筛选
  - [x] SubTask 5.5: 实现素材拖拽引用功能（占位实现）

- [x] Task 6: 重构 WritingConfigPanel 为模态框
  - [x] SubTask 6.1: 创建 WritingConfigModal.tsx 作为模态框
  - [x] SubTask 6.2: 优化表单布局（分组、折叠面板）
  - [x] SubTask 6.3: 添加配置模板保存与加载功能

- [x] Task 7: 创建创作进度仪表盘组件
  - [x] SubTask 7.1: 创建 WritingProgressDashboard.tsx
  - [x] SubTask 7.2: 实现总字数/目标字数进度条
  - [x] SubTask 7.3: 实现章节完成状态可视化
  - [x] SubTask 7.4: 实现素材引用统计
  - [x] SubTask 7.5: 实现预估完成时间计算

- [x] Task 8: 优化 AI 辅助功能嵌入
  - [x] SubTask 8.1: 在 MarkdownEditor 工具栏添加 AI 功能按钮（已在之前修复中完成）
  - [x] SubTask 8.2: 实现 AI 建议面板（底部弹出，非侵入式）
  - [x] SubTask 8.3: 实现 AI 对话助手（右侧面板 Tab）
  - [x] SubTask 8.4: 实现 AI 输出接受/拒绝交互

- [x] Task 9: 迁移和适配现有组件
  - [x] SubTask 9.1: 适配 OutlineEditor 到中间内容区
  - [x] SubTask 9.2: 适配 ContentWorkspace 到中间内容区
  - [x] SubTask 9.3: 适配 ManualOutlineEditor 到中间内容区
  - [x] SubTask 9.4: 确保所有现有功能正常工作

- [x] Task 10: 验证与测试
  - [x] SubTask 10.1: 运行 npm run build 确认无编译错误
  - [x] SubTask 10.2: 测试三层布局在不同窗口尺寸下的表现
  - [x] SubTask 10.3: 测试所有面板切换和折叠功能
  - [x] SubTask 10.4: 测试素材面板功能
  - [x] SubTask 10.5: 测试 AI 辅助功能嵌入

# Task Dependencies

- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 2]
- [Task 7] depends on [Task 2]
- [Task 8] depends on [Task 4]
- [Task 9] depends on [Task 2, Task 3, Task 4]
- [Task 10] depends on [Task 9]
