# Tasks

## Task 1: 添加润色指令输入对话框
- [x] 1.1 在 WritingConfigModal 中添加润色指令对话框状态
  - `showPolishDialog`: 控制对话框显示
  - `polishInstruction`: 用户输入的润色指令
- [x] 1.2 创建润色指令对话框 UI 组件
  - 使用 Ant Design Modal 组件
  - 包含 TextArea 输入区域
  - 提供预设指令标签（提升文采、精简表达、增强专业性、调整语气）
  - 点击预设标签自动填入输入区域
  - 提供"开始润色"和"取消"按钮
- [x] 1.3 修改 AI 润色按钮点击行为
  - 点击后打开指令对话框而非直接开始润色
  - 在对话框中确认后调用润色 API
- [x] 1.4 将用户指令传递给后端
  - 修改 preload.ts 中 polishDescription 方法签名，增加 instruction 参数
  - 修改 writingHandlers.ts 中处理器接收 instruction 参数
  - 修改 DescriptionPolisher 接收并传递 instruction
  - 修改 PromptBuilder 将 instruction 整合到提示词中

## Task 2: 移除 writingHandlers.ts 中的硬编码默认值
- [x] 2.1 移除 `writingHandlers.ts` 第 696-700 行的硬编码默认值
  - 移除 `model: request.modelConfig?.model || 'gpt-3.5-turbo'`
  - 移除 `temperature: request.modelConfig?.temperature ?? 0.7`
  - 移除 `maxTokens: request.modelConfig?.maxTokens || 2000`
- [x] 2.2 改为从配置文件读取配置
  - 使用 `getStorageService().getSettings()` 获取 AI 引擎配置
  - 与 ContentGenerator 使用相同的配置读取逻辑
- [x] 2.3 配置缺失时返回错误而非使用默认值
  - 当无法读取到有效的模型配置时，返回 `{ success: false, error: 'AI 配置未找到...' }`

## Task 3: 移除 DEFAULT_WRITING_CONFIG 中的硬编码 model
- [x] 3.1 修改 `writing.constants.ts` 中 DEFAULT_WRITING_CONFIG
  - 将 `model: 'gpt-4o'` 改为 `model: undefined`
- [x] 3.2 检查所有使用 DEFAULT_WRITING_CONFIG.model 的地方
  - 确保当 model 为 undefined 时不会传递空值给 AI API

## Task 4: 移除 WritingConfigModal 中的硬编码默认值
- [x] 4.1 修改 `handleGenerateOutline` 函数中的 modelConfig 构建逻辑（第 270-274 行）
  - 移除 `values.model || aiConfig?.model || DEFAULT_WRITING_CONFIG.model` 的 fallback
  - 移除 `values.temperature ?? aiConfig?.temperature ?? DEFAULT_WRITING_CONFIG.temperature` 的 fallback
  - 移除 `values.maxTokens ?? aiConfig?.maxTokens ?? DEFAULT_WRITING_CONFIG.maxTokens` 的 fallback
- [x] 4.2 修改 `handleManualCreateOutline` 函数中的 modelConfig 构建逻辑（第 455-459 行）
  - 同样移除所有 DEFAULT_WRITING_CONFIG 的 fallback
- [x] 4.3 修改 `handlePolishDescription` 函数中的 modelConfig 构建逻辑（第 493-496 行）
  - 同样移除所有 DEFAULT_WRITING_CONFIG 的 fallback
- [x] 4.4 当配置未加载或配置值为空时，提示用户先配置 AI 服务
  - 检查 aiConfig 是否存在且包含必要的配置项
  - 如果配置缺失，显示错误提示并阻止执行

## Task 5: 移除 WritingConfigPanel 中的硬编码默认值
- [x] 5.1 修改 `handleGenerateOutline` 函数中的 modelConfig 构建逻辑（第 255-259 行）
  - 移除 `aiConfig?.model || DEFAULT_WRITING_CONFIG.model` 的 fallback
  - 移除 `aiConfig?.temperature ?? DEFAULT_WRITING_CONFIG.temperature` 的 fallback
  - 移除 `aiConfig?.maxTokens ?? DEFAULT_WRITING_CONFIG.maxTokens` 的 fallback
- [x] 5.2 当配置未加载或配置值为空时，提示用户先配置 AI 服务

## Task 6: 修改 PromptBuilder 支持用户指令
- [x] 6.1 修改 `buildPolishDescriptionPrompt` 方法签名
  - 增加 `instruction?: string` 参数
- [x] 6.2 在用户提示词中整合用户指令
  - 当 instruction 存在时，添加到提示词中作为润色方向指导

## Task 7: 验证和测试
- [x] 7.1 验证润色指令对话框功能
  - 点击润色按钮弹出对话框
  - 预设指令可点击填入
  - 自定义指令可输入
  - 取消按钮关闭对话框
- [x] 7.2 验证配置缺失时的错误处理
  - 模拟配置缺失场景
  - 确认显示友好错误提示
  - 确认不使用硬编码默认值
- [x] 7.3 验证正常流程
  - 配置正常时润色功能正常工作
  - 用户指令正确传递给 AI
  - 润色结果符合预期
- [x] 7.4 验证 WritingConfigModal 和 WritingConfigPanel 的硬编码修复
  - 确认所有 DEFAULT_WRITING_CONFIG.model 的 fallback 已移除
  - 确认配置缺失时正确提示用户

## Task Dependencies
- Task 2 依赖于 Task 1（需要先理解完整的参数传递链）
- Task 3 依赖于 Task 2（需要确认配置读取逻辑一致）
- Task 4 依赖于 Task 2 和 Task 3（需要统一的配置处理方式）
- Task 5 依赖于 Task 4（相同的修复模式）
- Task 6 依赖于 Task 1（需要 instruction 参数传递到后端）
- Task 7 依赖于所有前置任务
