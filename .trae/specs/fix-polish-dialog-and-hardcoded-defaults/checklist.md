# Checklist

## 润色指令对话框验证
- [x] 点击"AI 润色"按钮后弹出指令输入对话框
- [x] 对话框标题为"AI 润色指令"
- [x] 对话框包含 TextArea 输入区域
- [x] 提供预设指令标签（提升文采、精简表达、增强专业性、调整语气）
- [x] 点击预设指令标签自动填入输入区域
- [x] 用户可以在预设基础上继续编辑
- [x] 提供"开始润色"和"取消"按钮
- [x] 点击"取消"关闭对话框
- [x] 未输入指令时点击"开始润色"使用默认润色目标

## 指令传递验证
- [x] 用户指令正确传递给后端
- [x] 指令整合到润色提示词中
- [x] AI 根据指令调整润色方向

## 硬编码默认值移除验证
- [x] writingHandlers.ts 中 polishDescription 处理器移除 `gpt-3.5-turbo` 硬编码
- [x] writingHandlers.ts 中 polishDescription 处理器移除 `0.7` temperature 硬编码
- [x] writingHandlers.ts 中 polishDescription 处理器移除 `2000` maxTokens 硬编码
- [x] DEFAULT_WRITING_CONFIG 中 model 改为 undefined
- [x] WritingConfigModal 中移除所有 DEFAULT_WRITING_CONFIG.model fallback
- [x] WritingConfigModal 中移除所有 DEFAULT_WRITING_CONFIG.temperature fallback
- [x] WritingConfigModal 中移除所有 DEFAULT_WRITING_CONFIG.maxTokens fallback
- [x] WritingConfigPanel 中移除所有 DEFAULT_WRITING_CONFIG.model fallback
- [x] WritingConfigPanel 中移除所有 DEFAULT_WRITING_CONFIG.temperature fallback
- [x] WritingConfigPanel 中移除所有 DEFAULT_WRITING_CONFIG.maxTokens fallback

## 配置缺失处理验证
- [x] writingHandlers.ts polishDescription 配置缺失时返回错误而非使用默认值
- [x] WritingConfigModal 配置缺失时提示用户先配置 AI 服务
- [x] WritingConfigPanel 配置缺失时提示用户先配置 AI 服务
- [x] 错误提示信息友好且明确

## 正常流程验证
- [x] 配置正常时润色功能正常工作
- [x] 用户指令正确传递给 AI
- [x] 润色结果符合预期
- [x] 流式输出正常显示
- [x] 结果确认界面正常

## 代码质量验证
- [x] 所有配置依赖参数从配置文件读取
- [x] 无硬编码的 fallback 值（在润色功能范围内）
- [x] 错误处理完整
- [x] 类型定义正确
