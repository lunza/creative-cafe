# Tasks

## 阶段一：核心框架搭建

- [x] Task 1: 创建 Pipeline 核心框架与类型定义
  - [x] SubTask 1.1: 定义 `DialoguePipelineContext` 数据模型（`pipeline.types.ts`）
  - [x] SubTask 1.2: 实现 `Pipeline` 类（顺序执行 Stage，异常捕获，Context 传递）
  - [x] SubTask 1.3: 实现 `ExtensionRegistry`（注册/查询 PromptProvider/PostProcessPlugin/LogicTask/RenderComponent/IntentHandler）
  - [x] SubTask 1.4: 实现 `PipelineLogger`（分级日志、trace 性能追踪、getEntries/getMetrics）

## 阶段二：前处理模块

- [x] Task 2: 实现数据前处理模块（DataPreprocessor）
  - [x] SubTask 2.1: 实现 `normalize`（空白清理、换行标准化）
  - [x] SubTask 2.2: 实现 `validate`（空值检查、长度限制）
  - [x] SubTask 2.3: 迁移 `replaceTemplates` 逻辑（从 messageProcessor.ts）
  - [x] SubTask 2.4: 实现 `detectLanguage`（简单语言检测）

- [x] Task 3: 实现用户意图识别模块（UserIntentRecognizer）
  - [x] SubTask 3.1: 实现 `resolveExplicit`（映射 UI 操作 → UserIntent）
  - [x] SubTask 3.2: 实现 `detectImplicit` NLU 引擎（关键词匹配 + 置信度评分）
    - [x] 续写意图检测（"继续"/"接着说"/"接着写"等）
    - [x] 重试意图检测（"重试"/"再来一次"/"重新生成"等）
    - [ ] 疑问句检测（影响 prompt 策略）
  - [ ] SubTask 3.3: 实现置信度 < 1.0 时的用户确认机制

- [x] Task 4: 实现上下文组装模块（ContextAssembler）
  - [x] SubTask 4.1: 迁移知识库检索逻辑（`retrieveWithKeywords` 调用）
  - [x] SubTask 4.2: 迁移对话历史 RAG 逻辑（长对话触发条件 + `chatHistory.retrieve`）
  - [x] SubTask 4.3: 迁移记忆表格数据获取逻辑
  - [x] SubTask 4.4: 迁移上下文截断逻辑（TokenCounter + ContextTruncator + RoleAnchor）
  - [x] SubTask 4.5: 实现检索失败降级策略（返回空值 + warn 日志，不中断管线）

## 阶段三：提示词与参数模块

- [x] Task 5: 实现模块化提示词构建系统（PromptComposer）
  - [x] SubTask 5.1: 实现 `PromptProvider` 接口和 `PromptComposer` 类（按 section + priority 组装）
  - [x] SubTask 5.2: 迁移 CharacterContextProvider（从 `buildCharacterContext`）
  - [x] SubTask 5.3: 迁移 PersonaProvider（从 `buildPersonaSection`）
  - [x] SubTask 5.4: 迁移 KnowledgeContextProvider / ChatHistoryProvider / MemoryTableProvider（从 `buildFinalSystemPrompt` 区域 1-3）
  - [x] SubTask 5.5: 迁移 DialogueInstructionProvider + ContinuationInstructionProvider（从 `buildDialoguePrompt` / `buildContinuationPrompt`，含模板系统集成 + `injectDialogueFormatInstructions`）
  - [x] SubTask 5.6: 迁移 LengthGuidanceProvider / LanguageProvider / AssistModeProvider / ExpressionProvider（从对应 build 函数）
  - [x] SubTask 5.7: 迁移 AsyncTableOrganizeProvider（从 `buildAsyncTableOrganizeInstructions`）
  - [x] SubTask 5.8: 迁移 FormatInstructionProvider（从 `injectDialogueFormatInstructions` 后处理注入器）

- [x] Task 6: 实现统一参数注入器（ParameterInjector）
  - [x] SubTask 6.1: 迁移 `getEffectiveParams` 三级合并逻辑
  - [x] SubTask 6.2: 实现 `buildEngineConfig`（统一注入所有采样参数，capability-gated）
  - [x] SubTask 6.3: 实现 `buildStopSequences`（按管线模式 + 角色名/用户名变体）
  - [ ] SubTask 6.4: 消除 `requestAIResponse` / `generateUserReply` / `polishInput` 三处重复逻辑

## 阶段四：AI 交互与后处理模块

- [x] Task 7: 实现 AI 交互模块（AIService）
  - [x] SubTask 7.1: 封装引擎实例管理（`ChatEngineFactory` 集成）
  - [x] SubTask 7.2: 实现流式回调管理（onStream/onComplete/onError）
  - [x] SubTask 7.3: 迁移 300 秒超时机制
  - [x] SubTask 7.4: 迁移故障转移事件订阅（`failover.onFailover`）

- [x] Task 8: 实现逻辑兼容性层（RobustParser）
  - [x] SubTask 8.1: 实现 `match`（多模式正则优先级匹配）
  - [x] SubTask 8.2: 实现 `fuzzyMatch`（关键词 proximity 模糊匹配）
  - [x] SubTask 8.3: 实现 `cleanup`（残留碎片清理）
  - [x] SubTask 8.4: 迁移表情标签解析模式（主格式 + 4 层容错正则）
  - [x] SubTask 8.5: 迁移辅助模式选项解析模式（6 格式正则）
  - [x] SubTask 8.6: 迁移 tableEdit 标签解析模式（3 格式正则）

- [x] Task 9: 实现 AI 意图识别模块（AIIntentRecognizer）
  - [x] SubTask 9.1: 实现 `detect`（扫描内容，使用 RobustParser 识别所有标签意图）
  - [x] SubTask 9.2: 实现 `stripIntents`（从内容中剥离所有已识别标签）
  - [x] SubTask 9.3: 定义 AIIntentType → IntentHandler 路由表

- [x] Task 10: 实现消息后处理管线（PostProcessingPipeline）
  - [x] SubTask 10.1: 实现 `PostProcessingPipeline` 类（按 priority 执行插件链）
  - [x] SubTask 10.2: 实现 ThinkTagPlugin（strip/convert/fold 三态，读取 think_tag_mode）
  - [x] SubTask 10.3: 实现 ExpressionPlugin（解析情绪标签，写入 context.emotion）
  - [x] SubTask 10.4: 实现 SuggestedOptionsPlugin（解析选项，写入 context.suggestedOptions）
  - [x] SubTask 10.5: 实现 TableEditPlugin（检测 tableEdit 标签，写入 context.tableEditCommands）
  - [x] SubTask 10.6: 实现 ImageGenPlugin（预留，解析 <<<GENERATE_IMAGE>>> 标签）
  - [x] SubTask 10.7: 实现 ContentProtectionPlugin（通用长度保护，从 context 读取已执行插件列表计算预期剥离量）
  - [x] SubTask 10.8: 实现 DedupPlugin（n-gram jaccard + overlap rate，写入 context.dedupInfo）

## 阶段五：逻辑引擎与渲染系统

- [x] Task 11: 实现逻辑执行引擎（LogicEngine）
  - [x] SubTask 11.1: 实现 `LogicEngine` 类（按 priority 执行条件满足的 LogicTask，独立 try-catch）
  - [x] SubTask 11.2: 实现 UpdateEmotionTask（更新消息 emotion + 触发表情图像加载）
  - [x] SubTask 11.3: 实现 RenderOptionsTask（渲染辅助模式选项按钮）
  - [x] SubTask 11.4: 实现 ExecuteTableEditTask（异步执行 tableEdit 命令）
  - [x] SubTask 11.5: 实现 TriggerSyncOrganizeTask（延迟 2 秒调用 processChatProgressive）
  - [x] SubTask 11.6: 实现 TriggerVectorizationTask（每 5 轮 vectorizeIncremental）
  - [x] SubTask 11.7: 实现 DedupRetryTask（重试循环，最多 2 次，重新触发 AIService + PostPipeline）
  - [x] SubTask 11.8: 实现 SaveChatTask + UpdateTokenUsageTask

- [x] Task 12: 重构渲染系统（RenderSystem）
  - [x] SubTask 12.1: 实现 `RenderSystem` 类（preprocess + getMarkdownConfig + registerComponent）
  - [x] SubTask 12.2: 迁移消息预处理管线（replaceTemplates → processThinkTags → stripSystemTags → normalizeQuotes → encodeAngleBrackets）
  - [x] SubTask 12.3: 迁移 remark/rehype 插件链配置
  - [x] SubTask 12.4: 迁移自定义组件映射（em → message-renderer-action 等）

## 阶段六：管线集成与公共 API 适配

- [x] Task 13: 实现 DialoguePipeline 集成层
  - [x] SubTask 13.1: 实现 PrePipeline（DataPreprocessor → UserIntentRecognizer → ContextAssembler → PromptComposer → ParameterInjector）
  - [x] SubTask 13.2: 集成 AIService 到 Pipeline
  - [x] SubTask 13.3: 实现 PostPipeline（AIIntentRecognizer → PostProcessingPipeline）
  - [x] SubTask 13.4: 集成 LogicEngine 到 Pipeline
  - [x] SubTask 13.5: 集成 PipelineLogger 贯穿全链路

- [x] Task 14: 适配公共 API（useCharacterDialogueChat）
  - [x] SubTask 14.1: 重写 `useCharacterDialogueChat` hook，内部调用 DialoguePipeline
  - [x] SubTask 14.2: 保持返回值接口完全兼容（sendMessage/continueConversation/retryMessage 等）
  - [x] SubTask 14.3: 迁移 `useCharacterConfig` hook（配置管理 + localStorage 持久化）
  - [x] SubTask 14.4: 迁移 `usePersonas` hook
  - [x] SubTask 14.5: 迁移版本管理功能（loadVersions/retryMessageFromVersion）
  - [x] SubTask 14.6: 迁移上下文压缩功能（compressContext）

## 阶段七：验证与清理

- [x] Task 15: 集成验证
  - [x] SubTask 15.1: TypeScript 编译验证 — `tsc --noEmit` 确认 pipeline/ 目录零错误
  - [x] SubTask 15.2: hooks.new.ts 编译验证 — 仅剩与旧 hooks.ts 相同的预存类型问题（chatVersion/failover/stopOrganizing），非新管线引入
  - [ ] SubTask 15.3: 运行时验证 — 对话模式完整流程（发送 → AI 回复 → 渲染）[需运行时测试]
  - [ ] SubTask 15.4: 运行时验证 — 续写/重试/润色/AI回复模式 [需运行时测试]
  - [ ] SubTask 15.5: 运行时验证 — 表情系统/辅助模式/记忆表格/知识库检索 [需运行时测试]
  - [ ] SubTask 15.6: 运行时验证 — Think 标签三态/动作描写渲染/残缺标签容错 [需运行时测试]

- [~] Task 16: 清理旧代码
  - [ ] SubTask 16.1: 删除旧的 `requestAIResponse` / `generateUserReply` / `polishInput` 函数 [需运行时验证后执行]
  - [ ] SubTask 16.2: 清理 `PromptBuilder.ts` 中已迁移到 Provider 的函数 [需运行时验证后执行]
  - [ ] SubTask 16.3: 清理 `messageProcessor.ts` 中已迁移到 RenderSystem 的函数 [需运行时验证后执行]
  - [x] SubTask 16.4: 更新技术文档（CODE_WIKI.md）

# Task Dependencies

- [Task 2-6] 依赖 [Task 1]（核心框架）
- [Task 7] 依赖 [Task 6]（AIService 需要 ParameterInjector 的输出）
- [Task 8] 独立（纯函数模块，可并行开发）
- [Task 9] 依赖 [Task 8]（AIIntentRecognizer 使用 RobustParser）
- [Task 10] 依赖 [Task 9]（PostProcessingPipeline 插件使用 AIIntentRecognizer）
- [Task 11] 依赖 [Task 10]（LogicEngine 处理 PostPipeline 的输出）
- [Task 12] 独立（渲染系统可并行开发）
- [Task 13] 依赖 [Task 2-12] 全部完成
- [Task 14] 依赖 [Task 13]
- [Task 15] 依赖 [Task 14]
- [Task 16] 依赖 [Task 15] 验证通过

# 并行化建议

以下任务组可并行开发：
- **组 A**：Task 2 + Task 3 + Task 4（前处理三模块，互不依赖）
- **组 B**：Task 8 + Task 12（RobustParser 和 RenderSystem 均为独立纯函数模块）
- **组 C**：Task 5 + Task 6（提示词和参数模块，互不依赖但有共享类型）

# 实现优先级

1. **P0（核心框架）**：Task 1 — 其他所有任务的基础
2. **P1（核心管线）**：Task 2-7, 9-11 — 完成最小可用管线
3. **P2（集成适配）**：Task 13-14 — 管线集成与 API 适配
4. **P3（验证清理）**：Task 15-16 — 全功能验证与旧代码清理
5. **预留**：Task 8.6（ImageGenPlugin）+ Task 12 中的多端适配 — 未来迭代
