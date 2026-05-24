# Tasks

- [x] Task 1: 重构分片主表格 UI
  - [x] SubTask 1.1: 将 Collapse 组件替换为 Ant Design Table，构建分片主表格列定义
  - [x] SubTask 1.2: 实现表格列：分片名称、状态、评分、高危问题数、中等问题数、建议问题数、总问题数
  - [x] SubTask 1.3: 配置表格 expandable 属性，支持点击展开查看分片详情
  - [x] SubTask 1.4: 使用 Ant Design Table 默认样式（table-common.css 不存在于项目中）

- [x] Task 2: 实现问题详情子表格
  - [x] SubTask 2.1: 在展开区域构建问题详情表格，使用 Ant Design Table
  - [x] SubTask 2.2: 实现问题详情列：严重程度（Tag 组件）、问题类型、描述、分析、建议
  - [x] SubTask 2.3: 保留原有的严重程度颜色标识（高=red，中=orange，低=blue）

- [x] Task 3: 重构汇总报告区域
  - [x] SubTask 3.1: 将汇总报告改为统计卡片 + 汇总表格组合
  - [x] SubTask 3.2: 统计卡片显示：综合评分、高危问题数、总问题数
  - [x] SubTask 3.3: 汇总表格显示各分片得分和问题数

- [x] Task 4: 实现表格交互功能
  - [x] SubTask 4.1: 实现排序功能：按评分、问题数量等列排序
  - [x] SubTask 4.2: 实现筛选功能：按状态、严重程度筛选
  - [x] SubTask 4.3: 实现分页功能：默认每页 10 条，支持调整每页行数
  - [x] SubTask 4.4: 实现快速跳转页码功能

- [x] Task 5: 实现实时同步更新机制
  - [x] SubTask 5.1: 保持现有轮询机制，将进度数据同步到表格 dataSource
  - [x] SubTask 5.2: 确保表格数据随检查进度实时更新，不出现闪烁
  - [x] SubTask 5.3: 确保展开区域的问题列表随检查结果实时更新

- [x] Task 6: 保持核心业务逻辑不变
  - [x] SubTask 6.1: 验证分片模式选择、控制按钮、进度条等功能正常工作
  - [x] SubTask 6.2: 验证暂停、继续、停止、重新检查等控制功能正常
  - [x] SubTask 6.3: 确保 IPC 通信和数据流不受影响

- [x] Task 7: 构建验证
  - [x] SubTask 7.1: 运行 build 确保无编译错误
  - [ ] SubTask 7.2: 手动验证表格展示和交互功能

# Task Dependencies

- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 1 and Task 2
- Task 5 depends on Task 1
- Task 6 depends on Task 1, Task 2, Task 3, Task 4, Task 5
- Task 7 depends on Task 6