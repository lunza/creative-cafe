# Tasks

## Task 1: 创建 DescriptionPolisher 服务类
- [x] 1.1 创建 `src/main/services/writing/DescriptionPolisher.ts` 文件
- [x] 1.2 实现 `buildPolishPrompt` 方法，构建润色提示词
  - 接收创意描述文本和资源上下文参数
  - 返回系统提示词和用户提示词
  - 提示词需明确要求保持原创意核心，提升流畅度、文采和专业度
- [x] 1.3 实现 `polishStream` 方法，处理流式润色请求
  - 复用 ContentGenerator 的流式请求处理逻辑
  - 接收 onStream 回调函数
  - 支持 abortSignal 中止操作
  - 返回润色后的完整文本

## Task 2: 在 PromptBuilder 中添加润色提示词构建方法
- [x] 2.1 在 `src/main/services/writing/PromptBuilder.ts` 中添加 `buildPolishDescriptionPrompt` 方法
- [x] 2.2 实现系统提示词构建
  - 定义 AI 作为文案润色专家的角色
  - 明确润色目标：保持核心、提升流畅度、增强文采、提高专业度
  - 指定输出格式要求
- [x] 2.3 实现用户提示词构建
  - 整合创意描述文本
  - 整合资源上下文（世界书、角色卡、用户人设）
  - 构建完整的润色指令

## Task 3: 添加 IPC 处理器
- [x] 3.1 在 `src/main/ipc/handlers/writingHandlers.ts` 中添加 `writing:polishDescription` 处理器
- [x] 3.2 实现处理器逻辑
  - 接收请求参数（描述文本、资源ID列表、模型配置）
  - 加载已选择的资源内容
  - 调用 DescriptionPolisher 服务
  - 通过 `writing:polish:chunk` 事件发送流式内容
  - 通过 `writing:polish:complete` 事件发送完成信号
  - 通过 `writing:polish:error` 事件发送错误信息
- [x] 3.3 实现资源加载逻辑
  - 根据资源ID加载世界书、角色卡、用户人设的详细内容
  - 构建资源上下文文本

## Task 4: 在 preload.ts 中暴露润色 API
- [x] 4.1 在 `src/main/preload.ts` 中添加润色相关的 IPC 通道
- [x] 4.2 暴露 `polishDescription` 方法供前端调用
- [x] 4.3 暴露流式事件监听器
  - `onPolishChunk` 监听润色内容块
  - `onPolishComplete` 监听完成事件
  - `onPolishError` 监听错误事件
  - 对应的取消监听方法

## Task 5: 在 WritingConfigModal 中添加 UI 组件
- [x] 5.1 在创意描述输入框旁添加"AI 润色"按钮
  - 按钮位置：输入框右侧或下方
  - 按钮样式：使用 Ant Design 的 Button 组件，带 AI 图标
  - 按钮状态：根据输入长度控制启用/禁用
  - 工具提示：禁用时显示提示信息
- [x] 5.2 添加润色状态管理
  - `isPolishing`: 是否正在润色
  - `polishContent`: 润色过程中的流式内容
  - `polishResult`: 润色完成的结果
  - `polishError`: 润色错误信息
- [x] 5.3 实现润色触发逻辑
  - 收集当前创意描述文本
  - 收集已选择的资源ID
  - 调用润色 API
  - 处理流式响应
- [x] 5.4 实现流式输出展示区域
  - 使用 TextArea 组件展示润色过程
  - 自动滚动到最新内容
  - 显示"润色中..."状态
  - 提供"中止"按钮
- [x] 5.5 实现润色结果确认界面
  - 显示润色完成的文本
  - 提供"采用"按钮：将结果填入创意描述输入框
  - 提供"重新润色"按钮：基于当前内容重新润色
  - 提供"取消"按钮：放弃润色结果
  - 支持直接编辑润色结果

## Task 6: 实现资源整合逻辑
- [x] 6.1 在 WritingConfigModal 中收集已选择的资源信息
  - 世界书内容摘要
  - 角色卡关键信息
  - 用户人设特征
- [x] 6.2 将资源信息作为上下文传递给润色 API
- [x] 6.3 在 UI 上显示已整合的资源数量提示

## Task 7: 错误处理和用户体验优化
- [x] 7.1 实现错误提示
  - API 调用失败时显示友好错误信息
  - 网络错误时提示重试
  - AI 服务未配置时引导用户配置
- [x] 7.2 实现加载状态
  - 按钮加载状态指示
  - 禁用其他操作避免冲突
- [x] 7.3 实现空结果处理
  - AI 返回空结果时提示用户
  - 提供重试选项

## Task 8: 测试和验证
- [x] 8.1 测试基本润色功能
  - 输入创意描述文本
  - 点击润色按钮
  - 验证流式输出正常
  - 验证结果正确填充
- [x] 8.2 测试资源整合
  - 选择多个资源后润色
  - 验证资源上下文正确传递
- [x] 8.3 测试边界情况
  - 空输入时按钮禁用
  - 网络错误时的处理
  - 中止润色功能
  - 重新润色功能

## Task Dependencies
- Task 2 依赖于 Task 1（PromptBuilder 方法被 DescriptionPolisher 调用）
- Task 3 依赖于 Task 1（IPC 处理器调用 DescriptionPolisher）
- Task 4 依赖于 Task 3（preload 暴露 IPC 通道）
- Task 5 依赖于 Task 4（UI 调用 preload API）
- Task 6 集成到 Task 5 中（UI 收集资源并传递）
- Task 7 集成到 Task 5 中（UI 错误处理）
- Task 8 依赖于所有前置任务
