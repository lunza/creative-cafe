# Tasks
- [x] Task 1: 重构 `buildCheckPrompt` 方法
  - [x] SubTask 1.1: 将逻辑矛盾检测引导语移至内容之前，形成统一的"剧情+逻辑检测体系"引导语
  - [x] SubTask 1.2: 引导语包含完整的角色定义、检测维度、逻辑矛盾类型说明
  - [x] SubTask 1.3: 统一输出格式为 `issues` 数组，每个问题包含 `category` 字段
  - [x] SubTask 1.4: 要求每个问题提供 `quickFixSuggestion` 字段
- [x] Task 2: 更新 `parseCheckResponse` 方法
  - [x] SubTask 2.1: 适配新的统一输出格式，从 `issues` 数组中解析所有问题
  - [x] SubTask 2.2: 根据 `category` 字段将问题分配到对应的 dimension 或 logic_check_result
  - [x] SubTask 2.3: 保留原有的评分计算和问题分类逻辑
- [x] Task 3: 验证编译和功能正常
  - [x] SubTask 3.1: TypeScript 编译检查通过
  - [x] SubTask 3.2: 确保前端 UI 组件无需修改（后端兼容原有类型）

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
