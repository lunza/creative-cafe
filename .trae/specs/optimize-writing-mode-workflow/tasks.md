# 写作模式功能改进任务列表

## Phase 1: 类型定义和数据结构扩展
- [x] Task 1: 扩展ChapterStatus枚举以支持更细粒度状态追踪
  - [x] 在writing.types.ts中新增GENERATED、CHECKED、FIXED、ORGANIZED状态值
  - [x] 在WritingConfig类型中添加chainOfThought可选字段
  - [x] 在ChapterOutline类型中确认chainOfThought字段支持
- [x] Task 2: 创建思维链数据类型定义
  - [x] 定义ChainOfThought接口（包含原始数据、格式化数据、时间戳）
  - [x] 在OutlineGenerationResult中添加chainOfThought字段

## Phase 2: 冗余功能移除
- [x] Task 3: 移除WritingConfigPanel中的模型参数配置面板
  - [x] 删除"模型参数"Collapse.Panel（包含temperature和maxTokens滑块）
  - [x] 移除handleGenerateOutline函数中从表单读取模型参数的逻辑
  - [x] 修改模型配置使用全局AI引擎设置的默认值
  - [x] 清理相关的state变量（aiConfig相关逻辑保持但不再暴露给用户）
- [x] Task 4: 移除WritingConfigPanel中的手动创建大纲功能
  - [x] 删除"手动创建大纲"按钮及其onClick处理函数
  - [x] 移除manualMode相关的配置传递逻辑
- [x] Task 5: 移除ContentWorkspace中的低使用率按钮
  - [x] 移除"分解"按钮及handleOpenSplitModal相关逻辑
  - [x] 移除"合并"按钮及handleOpenMergeModal相关逻辑
  - [x] 移除"AI历史"按钮及showHistoryModal相关逻辑
  - [x] 移除"版本"按钮及相关Dropdown菜单
  - [x] 移除"关闭面板"按钮（保留辅助面板toggle功能）
  - [x] 移除"调整参数"按钮及handleBackToConfig逻辑
  - [x] 清理相关的Modal组件引用（ChapterSplitModal, ChapterMergeModal, AIGenerationHistoryModal, VersionCompareModal等）

## Phase 3: 核心功能实现
- [x] Task 6: 实现思维链数据识别和提取
  - [x] 在OutlineGenerator.parseOutlineResponse之前添加思维链数据提取逻辑
  - [x] 实现<RichMediaReference>标签格式识别和解析
  - [x] 实现thinking_process参数格式识别和解析
  - [x] 将思维链数据与大纲内容分离，确保大纲JSON解析不受影响
- [x] Task 7: 实现思维链数据持久化存储
  - [x] 在WritingStorageService中保存project.json时包含chainOfThought字段
  - [x] 在加载项目时恢复chainOfThought数据
- [x] Task 8: 实现思维链UI展示
  - [x] 在OutlineEditor或大纲查看界面添加可折叠面板(Collapse)展示思维链数据
  - [x] 实现思维链数据的格式化显示（保持原始换行和缩进）
  - [x] 添加展开/折叠交互

## Phase 4: 章节状态管理增强
- [x] Task 9: 实现章节状态扩展逻辑
  - [x] 修改useChapterGeneration hook以支持新的章节状态
  - [x] 实现状态转换逻辑：pending → generating → generated → checked → fixed → organized → completed
  - [x] 在章节生成完成时设置状态为GENERATED
  - [x] 在剧情检查完成时设置状态为CHECKED
  - [x] 在修复完成时设置状态为FIXED
  - [x] 在表格整理完成时设置状态为ORGANIZED
- [ ] Task 10: 实现生成下一章节前置校验
  - [x] 移除"生成下一章节"按钮及前置校验功能（用户反馈该功能违背章节编辑流程）
  - [x] 移除handleGenerateNextChapter处理函数

## Phase 5: UI/UX优化
- [x] Task 11: Markdown组件暗色主题适配
  - [x] 在MarkdownEditor组件中集成Ant Design theme.useToken()
  - [x] 实现暗色模式下背景色适配（#1e1e1e或主题变量）
  - [x] 实现文本颜色适配（#e0e0e0或主题变量）
  - [x] 适配代码块、引用块等特殊元素暗色样式
  - [x] 执行主题样式冲突检查（表单、提示框、下拉菜单）
- [x] Task 12: 右侧面板拖拽调整宽度
  - [x] 在WritingModeRightPanel左侧边缘添加5px拖拽手柄
  - [x] 实现鼠标拖拽事件处理（onMouseDown, onMouseMove, onMouseUp）
  - [x] 限制面板宽度范围200px-600px
  - [x] 实现实时宽度反馈和内容自适应
  - [x] 在writingModeUIStore中保存面板宽度偏好
- [x] Task 13: 字数统计显示优化
  - [x] 从MarkdownEditor底部移除字数统计
  - [x] 在ContentWorkspace的Card extra区域添加字数统计
  - [x] 实现"字数：当前字数/目标字数"显示格式
  - [x] 实现输入时实时更新逻辑
  - [x] 实现字数颜色变化（<90%红色，90%橙色，>=100%绿色）
- [x] Task 14: 操作按钮重新布局
  - [x] 将剩余按钮采用flexbox布局重新排列
  - [x] 设置按钮间距为8-12px
  - [x] 区分主要操作按钮（primary）和次要按钮（default）
  - [x] 实现响应式布局适配（小屏幕时按钮换行或收起）
  - [x] 视觉层级优化

## Phase 6: 代码清理和测试
- [x] Task 15: 清理冗余代码和依赖
  - [x] 检查并移除未使用的import语句
  - [x] 移除已删除功能相关的事件监听器
  - [x] 清理相关的状态管理代码
  - [x] 更新相关的类型定义引用
- [x] Task 16: 功能测试和验证
  - [x] 验证大纲生成流程正常工作
  - [x] 验证思维链数据正确识别、展示和存储
  - [x] 验证章节状态流转正确
  - [x] 验证前置校验对话框正常工作
  - [x] 验证暗色主题下Markdown编辑器显示正常
  - [x] 验证右侧面板拖拽功能正常
  - [x] 验证字数统计功能正常
  - [x] 验证按钮布局在不同屏幕尺寸下正常

# Task Dependencies
- [Task 1] 是所有其他任务的基础依赖
- [Task 6] 依赖 [Task 1, Task 2]
- [Task 7] 依赖 [Task 6]
- [Task 8] 依赖 [Task 6, Task 7]
- [Task 9] 依赖 [Task 1]
- [Task 10] 依赖 [Task 9]
- [Task 3, Task 4, Task 5] 可以并行执行
- [Task 11, Task 12, Task 13, Task 14] 可以并行执行
- [Task 15] 依赖 [Task 3, Task 4, Task 5, Task 11, Task 12, Task 13, Task 14]
- [Task 16] 依赖所有其他任务完成
