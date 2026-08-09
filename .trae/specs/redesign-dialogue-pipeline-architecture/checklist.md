# Checklist

## 架构设计验证

- [x] spec.md 包含完整的模块定义、接口规范与数据模型
- [x] spec.md 包含架构概览图和关键流程时序图
- [x] spec.md 包含现有系统迁移至新架构的过渡方案（干净替换策略）
- [x] spec.md 包含未来功能扩展的指导原则与示例（ExtensionRegistry + 图片生成预留）
- [x] tasks.md 包含预估的开发优先级与并行化建议
- [x] 所有模块间的接口定义、数据流转、错误处理核心痛点已识别并解决

## 核心框架验证

- [x] DialoguePipelineContext 数据模型覆盖所有管线阶段的数据需求
- [x] Pipeline 类支持顺序执行 Stage、异常捕获、Context 传递
- [x] ExtensionRegistry 支持注册/查询所有扩展类型
- [x] PipelineLogger 支持分级日志、性能追踪、日志查询

## 前处理模块验证

- [x] DataPreprocessor 完成输入标准化、验证、模板替换
- [x] UserIntentRecognizer 支持显式意图映射和 NLU 隐式意图检测
- [ ] NLU 隐式意图置信度 < 1.0 时有用户确认机制 [未实现]
- [x] ContextAssembler 完成知识库/历史RAG/记忆表格/上下文截断
- [x] 检索失败时降级策略不中断管线

## 提示词与参数模块验证

- [x] PromptComposer 按 section + priority 组装提示词
- [x] 所有现有 build 函数已迁移为 PromptProvider
- [x] 模板系统集成（promptTemplateService）保留
- [x] injectDialogueFormatInstructions 后处理注入器迁移为 FormatInstructionProvider
- [ ] ParameterInjector 消除三处重复的 engineConfigWithParams 构建逻辑 [待 Task 16 旧代码清理]
- [x] 参数注入支持 capability-gated 参数

## AI 交互与后处理验证

- [x] AIService 封装引擎管理、流式通信、超时、故障转移
- [x] RobustParser 支持多模式正则匹配、模糊匹配、残留碎片清理
- [x] AIIntentRecognizer 使用 RobustParser 识别所有标签意图
- [x] PostProcessingPipeline 按 priority 执行插件链
- [x] ContentProtectionPlugin 通用化（不再硬编码 strip 标志位）
- [x] ThinkTagPlugin 支持三态模式（strip/strip_render/fold）
- [x] ImageGenPlugin 预留接口（不实现具体逻辑）

## 逻辑引擎与渲染验证

- [x] LogicEngine 按 priority 执行条件满足的 LogicTask
- [x] 每个任务独立 try-catch，单个失败不阻塞其他任务
- [x] DedupRetryTask 支持重试循环（最多 2 次）
- [x] RenderSystem 预处理管线正确剥离系统标签
- [ ] 动作描写 `*text*` 正确渲染为紫色斜体 [需运行时验证]
- [ ] 引号高亮 `"text"` 正确渲染为橙色背景 [需运行时验证]

## 管线集成与 API 验证

- [x] DialoguePipeline 集成 PrePipeline → AIService → PostPipeline → LogicEngine
- [x] PipelineLogger 贯穿全链路记录日志
- [x] useCharacterDialogueChat hook 返回值接口与旧版完全兼容（hooks.new.ts）
- [ ] 所有 UI 交互行为（发送/续写/重试/润色/AI回复/压缩/回滚）保持一致 [需运行时验证]
- [x] 版本管理功能保留
- [x] 上下文压缩功能保留

## TypeScript 编译验证

- [x] pipeline/ 目录所有文件 tsc --noEmit 零错误
- [x] hooks.new.ts 仅剩与旧 hooks.ts 相同的预存类型问题（非新管线引入）

## 残缺标签容错验证

- [x] 标准格式 `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 正确解析（RobustParser 8 模式）
- [x] 残缺格式 `<<>>key<<<_EXPRESSION>>>` 正确解析（fuzzyMatch 兜底）
- [x] 解析后残留碎片被清理（cleanup 方法）
- [x] 系统标签不进入 rehypeRaw HTML 解析管线（stripSystemTags 防御性调用）
