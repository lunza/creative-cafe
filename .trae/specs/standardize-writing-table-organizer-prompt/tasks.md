# Tasks

- [x] Task 1: 重构提示词构建方法，实现标准化提示词结构
  - [x] SubTask 1.1: 新增 `buildTableContextForPrompt` 方法，构建包含历史表格数据和唯一ID快速查找索引的上下文
  - [x] SubTask 1.2: 新增 `buildWritingTableOrganizePrompt` 方法，按固定顺序拼接10个必要组成部分
  - [x] SubTask 1.3: 参照 chatLogService.buildAIPromptForProgressive 实现完整提示词模板
  - [x] SubTask 1.4: 确保提示词包含：角色设定、当前消息、历史表格数据、表格模板结构、表格提取规则、唯一ID生成指南、核心任务说明、增量更新策略、输出要求、示例输出

- [x] Task 2: 实现章节内容智能拆分逻辑
  - [x] SubTask 2.1: 新增 `splitChapterContent` 方法，按段落+字数拆分长章节
  - [x] SubTask 2.2: 设置拆分阈值（章节内容>8000字符触发拆分）
  - [x] SubTask 2.3: 确保每段内容保持合理字数（3000-5000字符）
  - [x] SubTask 2.4: 按段落边界智能拆分，避免截断段落

- [x] Task 3: 修改 processChapterWithAI 支持分批处理
  - [x] SubTask 3.1: 修改方法检测章节内容长度
  - [x] SubTask 3.2: 长章节拆分为多段后分批次调用AI
  - [x] SubTask 3.3: 每批次使用完整提示词结构（包含最新表格数据上下文）
  - [x] SubTask 3.4: 每批次处理结果依次执行tableEdit命令
  - [x] SubTask 3.5: 确保表格数据在批次间保持连续性

- [x] Task 4: 强化tableEdit命令格式校验
  - [x] SubTask 4.1: 确保使用 tableEditParser 解析AI响应
  - [x] SubTask 4.2: 对未包含 `<tableEdit>` 标签的响应记录明确错误
  - [x] SubTask 4.3: 对命令格式错误（insertRow/updateRow/deleteRow参数错误）进行校验
  - [x] SubTask 4.4: 错误信息包含具体的格式问题描述

- [x] Task 5: 构建验证与测试
  - [x] SubTask 5.1: 运行 build 确保无编译错误
  - [x] SubTask 5.2: 验证提示词拼接完整性（10个部分无截断）
  - [x] SubTask 5.3: 验证长章节拆分逻辑正确
  - [x] SubTask 5.4: 验证tableEdit命令解析与执行正确

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1 and Task 2
- Task 4 depends on Task 3
- Task 5 depends on Task 1, Task 2, Task 3, and Task 4
