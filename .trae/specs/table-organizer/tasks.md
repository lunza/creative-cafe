# Tasks
- [x] Task 1: 创建tableEdit命令解析器模块
  - [x] SubTask 1.1: 实现tableEdit命令的HTML注释格式解析函数
  - [x] SubTask 1.2: 实现insertRow命令解析和执行
  - [x] SubTask 1.3: 实现updateRow命令解析和执行
  - [x] SubTask 1.4: 实现deleteRow命令解析和执行
  - [x] SubTask 1.5: 实现多命令批量解析和执行
  - [x] SubTask 1.6: 添加命令格式错误处理和容错机制

- [x] Task 2: 实现逐条聊天记录处理流程
  - [x] SubTask 2.1: 修改processChat方法支持逐条消息处理模式
  - [x] SubTask 2.2: 实现消息过滤(仅处理user和assistant消息)
  - [x] SubTask 2.3: 实现消息按时间顺序排序
  - [x] SubTask 2.4: 实现处理进度回调机制
  - [x] SubTask 2.5: 实现单条消息处理失败不影响整体的容错逻辑

- [x] Task 3: 实现表格数据上下文构建
  - [x] SubTask 3.1: 创建buildTableContext方法,将表格数据格式化为AI可读格式
  - [x] SubTask 3.2: 实现表格数据按模板结构输出
  - [x] SubTask 3.3: 优化上下文输出格式,控制token消耗

- [x] Task 4: 更新AI提示词模板
  - [x] SubTask 4.1: 修改buildAIPrompt方法,支持tableEdit命令格式
  - [x] SubTask 4.2: 添加tableEdit命令语法说明到提示词
  - [x] SubTask 4.3: 更新示例输出,展示insertRow/updateRow/deleteRow命令格式
  - [x] SubTask 4.4: 保留JSON格式作为备选响应方案

- [x] Task 5: 实现表格模板复制功能
  - [x] SubTask 5.1: 创建copyTemplate方法,从系统模板复制创建用户模板
  - [x] SubTask 5.2: 实现模板名称冲突检测和自动重命名
  - [x] SubTask 5.3: 确保复制的模板每个表格包含流水号和唯一id字段
  - [x] SubTask 5.4: 添加IPC接口支持模板复制操作

- [x] Task 6: 更新表格数据存储结构
  - [x] SubTask 6.1: 修改表格数据存储支持基于索引的操作
  - [x] SubTask 6.2: 实现getTableByIndex和updateTableByIndex方法
  - [x] SubTask 6.3: 更新createTableFile方法,确保数据结构支持索引操作

- [x] Task 7: 更新IPC处理器和UI交互
  - [x] SubTask 7.1: 添加processChatProgressive IPC接口支持逐条处理
  - [x] SubTask 7.2: 添加copyTemplate IPC接口支持模板复制
  - [x] SubTask 7.3: 更新ChatManager组件UI,支持进度显示和模板复制

- [x] Task 8: 错误处理和日志记录
  - [x] SubTask 8.1: 完善tableEdit命令解析错误处理
  - [x] SubTask 8.2: 添加处理过程中的详细日志记录
  - [x] SubTask 8.3: 实现错误恢复机制

# Task Dependencies
- Task 2 依赖 Task 1 (逐条处理需要命令解析器)
- Task 3 依赖 Task 1 (上下文构建需要理解表格结构)
- Task 4 依赖 Task 3 (提示词需要包含上下文格式说明)
- Task 5 是独立任务
- Task 6 依赖 Task 1 (存储结构需要支持索引操作)
- Task 7 依赖 Task 2, Task 5, Task 6 (UI需要后端接口支持)
- Task 8 依赖所有任务 (错误处理贯穿全流程)
