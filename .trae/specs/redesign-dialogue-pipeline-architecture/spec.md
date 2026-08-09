# 对话管线架构重设计 Spec

## Why

当前角色对话模式的管线架构在初始开发阶段未充分考虑功能扩展需求，采用单体函数式实现（`requestAIResponse` 约 1140 行、`onComplete` 回调约 517 行），导致意图识别、参数传输、文本渲染、标签处理等功能的叠加方式为"开关 + 提示词注入 + 后处理正则解析"的硬编码三段式，每新增一个功能都需在多个位置插入代码。本次重设计采用 Pipeline + Middleware + Intent Router 模式，实现低耦合、高内聚、可插拔的管线架构。

## What Changes

### 架构层面

- **BREAKING**：完全替换 `CharacterDialogueChat.hooks.ts` 中的单体 `requestAIResponse` / `generateUserReply` / `polishInput` 三个函数，改为统一的 Pipeline 架构
- **BREAKING**：完全替换 `PromptBuilder.ts` 中的硬编码提示词拼接流程，改为模块化 Prompt Provider 注册机制
- **BREAKING**：完全替换 `onComplete` 回调中的硬编码后处理序列，改为插件式 PostProcessingPipeline
- 新增意图识别模块（含 NLU 语义理解），统一管理用户意图与 AI 意图的路由
- 新增统一的参数注入器，消除三处重复的 `engineConfigWithParams` 构建逻辑
- 新增分级日志系统，替换散布在 hooks 中的 `addLog` 调用
- 新增逻辑执行引擎，将副作用调度从后处理管线中分离
- 新增扩展注册表，支持通过注册方式接入新功能模块
- 重构渲染系统，将消息处理器与 ReactMarkdown 插件链解耦
- 预留图片生成等未来功能的接入接口

### 迁移策略

采用**干净替换**策略：新架构独立实现，完成后一次性替换旧代码。迁移期间旧代码保留但不维护，新架构通过相同的公共 API（`useCharacterDialogueChat` hook 返回值）保持与 UI 层兼容。

## Impact

- Affected specs: `handle-think-tags-overflow`, `add-assist-mode-options`, `add-character-expression-system`, `fix-ai-response-length-degradation`, `fix-think-strip-content-protection`, `fix-polish-context-isolation`, `fix-polish-input-undo-and-target`, `fix-polish-task-framing`, `add-ai-user-reply-button`
- Affected code:
  - `CharacterDialogueChat.hooks.ts`（~2808 行，完全重写）
  - `PromptBuilder.ts`（~1914 行，拆分为模块化 Provider）
  - `MessageRenderer/MessageRenderer.tsx`（渲染管线解耦）
  - `MessageRenderer/messageProcessor.ts`（集成到新渲染系统）
  - `CharacterDialogueChat.types.ts`（新增管线类型定义）
  - `ChatEngine.types.ts`（参数注入器复用其类型）
  - `CharacterDialogueChat.tsx`（公共 API 适配层）
  - `ConfigPanel.tsx` / `ParameterPanel.tsx`（参数面板适配）

---

## ADDED Requirements

### Requirement: Pipeline 核心框架

系统 SHALL 提供一个基于 Middleware 模式的 Pipeline 核心框架，作为所有对话处理的统一执行引擎。

#### Pipeline Context 数据模型

```typescript
/**
 * 管线上下文 — 贯穿整个对话处理流程的中央数据对象。
 * 每个 Stage/Middleware 读取并修改此对象，最终产出渲染所需的所有数据。
 */
interface DialoguePipelineContext {
  // ===== 输入 =====
  userInput: string;
  userIntent: UserIntent;
  characterInfo: CharacterInfo;
  sessionConfig: CharacterSessionConfig;
  activeEngine: AIEngineConfig;
  pipelineMode: 'dialogue' | 'continuation' | 'retry' | 'polish' | 'userReply';

  // ===== 上下文组装 =====
  retrievedContext: {
    knowledgeBase: VectorSearchResult[];
    chatHistory: ChatHistoryItem[];
    memoryTableData: string;
    memoryTableStructure: TableStructure | null;
  };

  // ===== 提示词 =====
  systemPrompt: string;
  messagesToSend: ChatMessage[];
  engineConfig: AIEngineConfig;
  stopSequences: string[];

  // ===== AI 响应 =====
  rawResponse: string;
  streamingContent: string;
  aiIntents: DetectedIntent[];

  // ===== 后处理结果 =====
  processedContent: string;
  emotion: string | null;
  suggestedOptions: SuggestedOption[] | null;
  tableEditCommands: TableEditCommand[] | null;
  imageGenRequests: ImageGenRequest[] | null;
  thinkContent: string | null;
  dedupInfo: DedupInfo | null;

  // ===== 元数据 =====
  logs: PipelineLogEntry[];
  metrics: PipelineMetrics;
  errors: PipelineError[];
}
```

#### Scenario: Pipeline 正常执行

- **WHEN** 用户发送消息触发对话管线
- **THEN** Pipeline 按 PrePipeline → AIService → PostPipeline → LogicEngine 顺序执行各 Stage
- **AND** 每个 Stage 接收 Context 对象，执行处理后传递给下一个 Stage
- **AND** 任何 Stage 抛出异常时由 Pipeline 框架捕获并记录到 `context.errors`
- **AND** 非致命错误不中断管线执行，致命错误中断并触发错误回调

#### Scenario: Pipeline 可配置

- **WHEN** 需要添加/移除/重排序处理步骤
- **THEN** 通过 ExtensionRegistry 注册/注销 Middleware 实现，无需修改 Pipeline 核心代码

---

### Requirement: 数据前处理模块（DataPreprocessor）

系统 SHALL 提供数据前处理模块，负责用户输入的标准化、验证和模板替换。

#### 接口规范

```typescript
interface DataPreprocessor {
  normalize(text: string): string;           // 去除多余空白、统一换行
  validate(text: string): ValidationResult;  // 空值检查、长度限制
  replaceTemplates(text: string, charName: string, userName: string): string;
  detectLanguage(text: string): string;       // 简单语言检测
}
```

#### Scenario: 输入标准化

- **WHEN** 用户输入包含多余空白、不规则换行
- **THEN** DataPreprocessor.normalize 输出标准化文本（去除首尾空白、合并连续空行）
- **AND** 保留有意义的换行结构（段落间双换行）

#### Scenario: 输入验证

- **WHEN** 用户输入为空或超过最大长度
- **THEN** DataPreprocessor.validate 返回 `{ valid: false, reason: '...' }`
- **AND** Pipeline 框架根据验证结果决定是否继续执行

---

### Requirement: 意图识别模块（IntentRecognizer）

系统 SHALL 提供意图识别模块，包含用户意图识别（含 NLU 语义理解）和 AI 意图识别（结构化标签解析），将意图路由到对应的处理器。

#### 用户意图识别

```typescript
type UserIntent =
  | { type: 'dialogue'; confidence: number }
  | { type: 'continuation'; confidence: number }
  | { type: 'retry'; confidence: number; targetMessageId: string }
  | { type: 'polish'; confidence: number; targetText: string }
  | { type: 'userReply'; confidence: number };

interface UserIntentRecognizer {
  /**
   * 显式意图：由 UI 操作（按钮/快捷键）直接指定
   */
  resolveExplicit(action: UserAction): UserIntent;

  /**
   * NLU 隐式意图：从用户输入文本中推断意图
   * - "继续" / "接着说" → continuation
   * - "重试" / "再来一次" → retry
   * - 疑问句检测 → 调整 prompt 策略（如追加"请详细回答"）
   * - 情感倾向检测 → 调整回复风格引导
   */
  detectImplicit(text: string, context: DialogueContext): UserIntent | null;
}
```

#### AI 意图识别

```typescript
type AIIntentType =
  | 'expression'        // 表情情绪标签
  | 'suggested_options' // 辅助模式选项
  | 'table_edit'        // 记忆表格编辑命令
  | 'think_tag'         // 思考标签
  | 'image_generation'  // 图片生成请求（预留）
  | 'narrative';        // 纯叙事内容（无标签）

interface DetectedIntent {
  type: AIIntentType;
  data: unknown;           // 解析后的结构化数据
  rawMatch: string;        // 原始匹配文本
  confidence: number;
}

interface AIIntentRecognizer {
  /**
   * 扫描 AI 响应内容，识别所有结构化标签意图
   * 使用 RobustParser 进行多格式容错匹配
   */
  detect(content: string): DetectedIntent[];
  /**
   * 从内容中剥离所有已识别的标签，返回纯净叙事内容
   */
  stripIntents(content: string, intents: DetectedIntent[]): string;
}
```

#### Scenario: 用户显式意图

- **WHEN** 用户点击发送按钮
- **THEN** UserIntentRecognizer.resolveExplicit 返回 `{ type: 'dialogue', confidence: 1.0 }`
- **AND** Pipeline 使用对话模式配置执行

#### Scenario: 用户 NLU 隐式意图

- **WHEN** 用户在输入框输入"继续接着写"
- **THEN** UserIntentRecognizer.detectImplicit 返回 `{ type: 'continuation', confidence: 0.85 }`
- **AND** 系统提示用户确认是否切换为续写模式（NLU 意图置信度 < 1.0 时需确认）

#### Scenario: AI 意图识别与路由

- **WHEN** AI 响应包含 `<<<EXPRESSION>>>annoyance<<<END_EXPRESSION>>>`
- **THEN** AIIntentRecognizer.detect 返回 `[{ type: 'expression', data: { emotion: 'annoyance' }, ... }]`
- **AND** PostProcessingPipeline 中 ExpressionPlugin 处理该意图
- **AND** LogicEngine 执行副作用：更新消息 emotion 字段、触发表情图像加载

#### Scenario: AI 意图识别容错

- **WHEN** AI 返回残缺标签 `<<>>annoyance<<<_EXPRESSION>>>`
- **THEN** RobustParser 通过多格式正则兜底匹配成功识别意图
- **AND** 从内容中剥离残缺标签碎片，不进入渲染管线

---

### Requirement: 上下文组装模块（ContextAssembler）

系统 SHALL 提供上下文组装模块，统一管理知识库检索、对话历史 RAG、记忆表格数据获取和上下文截断。

#### 接口规范

```typescript
interface ContextAssembler {
  retrieveKnowledgeBase(query: string, scopeIds: string[]): Promise<VectorSearchResult[]>;
  retrieveChatHistory(chatId: string, query: string, messageCount: number): Promise<ChatHistoryItem[]>;
  fetchMemoryTable(enabled: boolean): Promise<{ data: string; structure: TableStructure | null }>;
  truncateContext(messages: ChatMessage[], config: TruncationConfig): Promise<ChatMessage[]>;
}
```

#### Scenario: 知识库检索

- **WHEN** 管线执行到上下文组装阶段
- **THEN** ContextAssembler.retrieveKnowledgeBase 执行向量 + 关键词混合检索
- **AND** 检索失败时不中断管线，返回空数组并记录 warn 日志

#### Scenario: 长对话历史 RAG

- **WHEN** 对话消息数 > 40 条
- **THEN** ContextAssembler.retrieveChatHistory 触发本会话历史向量检索
- **AND** 检索结果作为历史片段注入 system prompt

---

### Requirement: 模块化提示词构建系统（PromptComposer）

系统 SHALL 提供基于 Provider 注册机制的提示词构建系统，替换当前硬编码的提示词拼接流程。

#### 接口规范

```typescript
interface PromptProvider {
  name: string;
  priority: number;                    // 注入顺序
  section: 'header' | 'context' | 'instruction' | 'suffix';
  isActive(context: DialoguePipelineContext): boolean;
  build(context: DialoguePipelineContext): string;
}

interface PromptComposer {
  registerProvider(provider: PromptProvider): void;
  compose(context: DialoguePipelineContext): string;  // 按 priority + section 组装
}
```

#### 预置 Provider 清单

| Provider | Section | Priority | 条件 | 对应当前函数 |
|----------|---------|----------|------|-------------|
| CharacterContextProvider | context | 100 | 始终 | `buildCharacterContext` |
| PersonaProvider | context | 110 | 始终 | `buildPersonaSection` |
| KnowledgeContextProvider | context | 200 | 有检索结果 | 内联在 `buildFinalSystemPrompt` |
| ChatHistoryProvider | context | 210 | 有历史片段 | 内联在 `buildFinalSystemPrompt` |
| MemoryTableProvider | context | 220 | 启用记忆表格 | 内联在 `buildFinalSystemPrompt` |
| DialogueInstructionProvider | instruction | 300 | 对话模式 | `buildDialoguePrompt` |
| ContinuationInstructionProvider | instruction | 300 | 续写模式 | `buildContinuationPrompt` |
| LengthGuidanceProvider | suffix | 400 | 始终 | `buildLengthGuidancePrompt` |
| LanguageProvider | suffix | 410 | 始终 | `buildLanguagePrompt` |
| AssistModeProvider | suffix | 420 | 辅助模式开启 | `buildAssistModePrompt` |
| ExpressionProvider | suffix | 430 | 表情显示开启 | `buildExpressionPrompt` |
| AsyncTableOrganizeProvider | suffix | 440 | 异步整理模式 | `buildAsyncTableOrganizeInstructions` |
| FormatInstructionProvider | suffix | 450 | 始终 | `injectDialogueFormatInstructions` |

#### Scenario: 提示词组装

- **WHEN** PromptComposer.compose 被调用
- **THEN** 按 section 分组，每组内按 priority 排序，依次调用 isActive 和 build
- **AND** 仅活跃 Provider 的输出被拼接进最终 system prompt
- **AND** 模板系统（`promptTemplateService`）的结果作为 DialogueInstructionProvider 的基础内容

#### Scenario: 新增提示词段

- **WHEN** 需要新增一个提示词段（如"天气系统影响角色情绪"）
- **THEN** 实现一个 PromptProvider 并注册到 PromptComposer
- **AND** 无需修改 PromptComposer 核心代码或现有 Provider

---

### Requirement: 统一参数注入器（ParameterInjector）

系统 SHALL 提供统一的参数注入器，消除 `requestAIResponse`、`generateUserReply`、`polishInput` 三处重复的参数注入逻辑。

#### 接口规范

```typescript
interface ParameterInjector {
  /**
   * 三级合并：customParameters > globalEngine > defaults
   */
  getEffectiveParams(custom: AIParameterConfig, engine: AIEngineConfig): EffectiveAIParams;

  /**
   * 根据 capabilities 构建完整的引擎配置
   * 统一处理 top_p/top_k/min_p/frequency_penalty/presence_penalty/
   * repetition_penalty/DRY 组/no_repeat_ngram_size 的注入
   */
  buildEngineConfig(
    base: AIEngineConfig,
    params: EffectiveAIParams,
    capabilities: EngineCapabilities
  ): AIEngineConfig;

  /**
   * 根据管线模式构建停止序列
   */
  buildStopSequences(mode: PipelineMode, charName: string, userName: string): string[];
}
```

#### Scenario: 参数注入

- **WHEN** 任何管线模式（dialogue/continuation/retry/polish/userReply）需要构建引擎配置
- **THEN** ParameterInjector.buildEngineConfig 统一处理所有采样参数的注入
- **AND** capability-gated 参数仅在该能力启用时注入
- **AND** 三个管线模式使用相同的注入逻辑，消除重复代码

---

### Requirement: AI 交互模块（AIService）

系统 SHALL 提供可配置的 AI 服务接口层，封装引擎实例管理、流式通信和错误处理。

#### 接口规范

```typescript
interface AIService {
  /**
   * 发送消息并管理流式响应
   */
  sendMessage(
    context: DialoguePipelineContext,
    callbacks: {
      onStream: (chunk: string, accumulated: string) => void;
      onComplete: (fullContent: string, finishReason: string) => void;
      onError: (error: Error) => void;
    }
  ): Promise<void>;

  /**
   * 取消当前请求
   */
  cancel(): void;

  /**
   * 获取引擎能力
   */
  getCapabilities(): EngineCapabilities;
}
```

#### Scenario: 流式响应

- **WHEN** AIService.sendMessage 被调用
- **THEN** 创建/复用引擎实例，注入 engineConfig 和 stopSequences
- **AND** 流式 chunk 通过 onStream 回调实时传递
- **AND** 300 秒超时自动取消并触发 onError

#### Scenario: 故障转移

- **WHEN** 引擎 provider 切换（failover）
- **THEN** AIService 通过事件订阅通知 Pipeline 框架
- **AND** Pipeline 框架记录日志并通知 UI 层

---

### Requirement: 消息后处理管线（PostProcessingPipeline）

系统 SHALL 提供基于插件的消息后处理管线，替换当前 `onComplete` 中的硬编码后处理序列。

#### 接口规范

```typescript
interface PostProcessPlugin {
  name: string;
  priority: number;
  /**
   * 检测内容中是否存在该插件需要处理的标签/模式
   */
  detect(content: string, context: DialoguePipelineContext): boolean;
  /**
   * 处理内容：解析标签、剥离标签、写入 context 字段、返回清理后的内容
   */
  process(content: string, context: DialoguePipelineContext): string;
}

interface PostProcessingPipeline {
  registerPlugin(plugin: PostProcessPlugin): void;
  execute(content: string, context: DialoguePipelineContext): string;
}
```

#### 预置插件清单

| 插件 | Priority | 对应当前逻辑 |
|------|----------|-------------|
| ThinkTagPlugin | 100 | `stripThinkingTags` / `convertThinkingTags` |
| ExpressionPlugin | 200 | `parseExpressionFromContent` |
| SuggestedOptionsPlugin | 300 | 辅助模式选项解析（6 格式正则） |
| TableEditPlugin | 400 | tableEdit 标签检测与剥离 |
| ImageGenPlugin | 500 | （预留）图片生成标签解析 |
| ContentProtectionPlugin | 600 | 通用内容长度保护检查 |
| DedupPlugin | 700 | n-gram jaccard / overlap rate 检测 |

#### Scenario: 后处理插件执行

- **WHEN** AI 响应完成，PostProcessingPipeline.execute 被调用
- **THEN** 按 priority 顺序执行每个活跃插件
- **AND** 每个插件接收上一个插件处理后的内容
- **AND** 插件将解析结果写入 context 对应字段（emotion/options/tableEditCommands 等）

#### Scenario: 内容保护通用化

- **WHEN** ContentProtectionPlugin 检测处理后内容长度
- **THEN** 从 context 中读取所有已执行的插件列表，自动计算预期剥离量
- **AND** 不再硬编码 `thinkTagsStripped || optionsStripped || emotionStripped` 等标志位
- **AND** 当实际缩短量 > 预期剥离量时触发内容保护警告

#### Scenario: 新增后处理步骤

- **WHEN** 需要新增一个后处理步骤（如"敏感词过滤"）
- **THEN** 实现 PostProcessPlugin 并注册到 PostProcessingPipeline
- **AND** 无需修改 Pipeline 核心代码或现有插件

---

### Requirement: 逻辑执行引擎（LogicEngine）

系统 SHALL 提供模块化的逻辑执行框架，负责执行后处理产生的副作用调度。

#### 接口规范

```typescript
interface LogicTask {
  name: string;
  priority: number;
  condition: (context: DialoguePipelineContext) => boolean;
  execute: (context: DialoguePipelineContext) => Promise<void>;
  onError?: (error: Error, context: DialoguePipelineContext) => void;
}

interface LogicEngine {
  registerTask(task: LogicTask): void;
  execute(context: DialoguePipelineContext): Promise<void>;
}
```

#### 预置任务清单

| 任务 | 条件 | 对应当前逻辑 |
|------|------|-------------|
| UpdateEmotionTask | `context.emotion !== null` | 更新消息 emotion、触发表情图像加载 |
| RenderOptionsTask | `context.suggestedOptions !== null` | 渲染辅助模式选项按钮 |
| ExecuteTableEditTask | `context.tableEditCommands !== null` | 异步执行 tableEdit 命令 |
| TriggerSyncOrganizeTask | 同步整理模式开启 | 延迟 2 秒调用 `processChatProgressive` |
| TriggerVectorizationTask | 每 5 轮对话 | `vectorizeIncremental` |
| DedupRetryTask | `context.dedupInfo.needRetry` | 重试 AI 请求（最多 2 次） |
| SaveChatTask | 始终 | 保存聊天记录到存储 |
| UpdateTokenUsageTask | token 管理开启 | 更新 token 用量状态 |

#### Scenario: 副作用调度

- **WHEN** PostProcessingPipeline 完成后，LogicEngine.execute 被调用
- **THEN** 按 priority 顺序执行所有条件满足的 LogicTask
- **AND** 每个任务独立 try-catch，单个任务失败不阻塞其他任务
- **AND** 失败任务的错误通过 onError 回调处理并记录日志

#### Scenario: 去重重试循环

- **WHEN** DedupRetryTask 检测到重复内容（n-gram jaccard > 0.8）
- **THEN** LogicEngine 重新触发 AIService 请求（携带 DedupConfig）
- **AND** 最多重试 2 次，每次重试后重新执行 PostProcessingPipeline
- **AND** 超过重试上限后接受当前结果并记录 warn 日志

---

### Requirement: 逻辑兼容性层（RobustParser）

系统 SHALL 提供强大的 AI 输出解析器，保证在 AI 生成文本不稳定时仍能正确识别意图和执行后处理。

#### 接口规范

```typescript
interface RobustParser {
  /**
   * 多模式匹配：按优先级尝试多种正则模式，返回首个匹配结果
   */
  match(content: string, patterns: ParsePattern[]): ParseResult | null;

  /**
   * 模糊匹配：当精确模式全部失败时，使用关键词 proximity 匹配
   */
  fuzzyMatch(content: string, keywords: string[], proximity: number): ParseResult | null;

  /**
   * 清理残留碎片：移除匹配后遗留的孤立标记字符
   */
  cleanup(content: string, residuePattern: RegExp): string;
}

interface ParsePattern {
  name: string;
  regex: RegExp;
  extractor: (match: RegExpMatchArray) => { data: unknown; rawMatch: string };
}
```

#### Scenario: 多格式容错匹配

- **WHEN** AI 返回标准格式 `<<<EXPRESSION>>>annoyance<<<END_EXPRESSION>>>`
- **THEN** RobustParser.match 使用主格式正则匹配成功
- **AND** 返回 `{ data: { emotion: 'annoyance' }, rawMatch: '<<<EXPRESSION>>>annoyance<<<END_EXPRESSION>>>' }`

#### Scenario: 残缺标签兜底

- **WHEN** AI 返回残缺格式 `<<>>annoyance<<<_EXPRESSION>>>`
- **THEN** 主格式正则匹配失败，依次尝试容错正则
- **AND** 终极兜底正则匹配成功，返回正确解析结果
- **AND** cleanup 清理残留的 `<<>>` 碎片

#### Scenario: 完全无法识别

- **WHEN** 所有正则模式和模糊匹配均失败
- **THEN** 返回 null，由调用方决定降级策略
- **AND** 记录 warn 日志包含未识别内容的末尾 200 字符

---

### Requirement: 渲染系统（RenderSystem）

系统 SHALL 提供与管线逻辑分离的渲染系统，支持自定义渲染规则和多端适配。

#### 接口规范

```typescript
interface RenderSystem {
  /**
   * 预处理：在 ReactMarkdown 解析前清理和规范化内容
   */
  preprocess(content: string, options: RenderOptions): string;

  /**
   * 获取 ReactMarkdown 配置（插件链 + 组件映射）
   */
  getMarkdownConfig(options: RenderOptions): {
    remarkPlugins: any[];
    rehypePlugins: any[];
    components: Record<string, React.ComponentType<any>>;
  };

  /**
   * 注册自定义渲染组件
   */
  registerComponent(tag: string, component: React.ComponentType<any>): void;
}
```

#### 渲染预处理管线

```
content → replaceTemplates → processThinkTags → stripSystemTags → normalizeQuotes → [encodeAngleBrackets]
```

#### Scenario: 系统标签不进入渲染

- **WHEN** AI 响应内容包含系统控制标签（expression/options/tableEdit）
- **THEN** stripSystemTags 在渲染预处理阶段始终剥离这些标签
- **AND** 标签不进入 rehypeRaw HTML 解析管线，不破坏 hast 树

#### Scenario: 动作描写渲染

- **WHEN** AI 响应包含 `*动作描写*` markdown 斜体
- **THEN** ReactMarkdown 解析为 `<em>` 元素
- **AND** 自定义组件映射为 `<em className="message-renderer-action">` 应用紫色斜体样式

#### Scenario: 引号高亮渲染

- **WHEN** AI 响应包含 `"对话内容"` 英文双引号
- **THEN** rehypeQuoteNormalize 将引号包裹为 `<span class="message-renderer-quote-highlight">`
- **AND** CSS 应用橙色高亮背景 + 边框样式

---

### Requirement: 分级日志系统（PipelineLogger）

系统 SHALL 提供分级日志记录机制，覆盖管线全生命周期的调试信息、性能指标和错误追踪。

#### 接口规范

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface PipelineLogEntry {
  level: LogLevel;
  stage: string;           // Pipeline Stage 名称
  timestamp: number;
  message: string;
  data?: unknown;          // 附加数据
  duration?: number;       // 执行耗时（毫秒）
}

interface PipelineLogger {
  debug(stage: string, message: string, data?: unknown): void;
  info(stage: string, message: string, data?: unknown): void;
  warn(stage: string, message: string, data?: unknown): void;
  error(stage: string, message: string, data?: unknown): void;
  
  /**
   * 性能追踪：自动记录 stage 执行耗时
   */
  trace<T>(stage: string, fn: () => T | Promise<T>): Promise<T>;
  
  /**
   * 获取当前管线的全部日志条目
   */
  getEntries(): PipelineLogEntry[];
  
  /**
   * 获取性能指标摘要
   */
  getMetrics(): PipelineMetrics;
}
```

#### Scenario: 管线全链路日志

- **WHEN** Pipeline 执行过程中任何 Stage 产生日志
- **THEN** PipelineLogger 记录到 `context.logs` 数组
- **AND** 每条日志包含 stage 名称、时间戳、级别和消息
- **AND** UI 层可订阅日志流实时显示在调试面板中

#### Scenario: 性能追踪

- **WHEN** PipelineLogger.trace 包装一个 Stage 执行
- **THEN** 自动记录执行开始和结束时间，计算耗时
- **AND** 耗时数据写入 `context.metrics` 供管线完成后汇总

---

### Requirement: 扩展注册表（ExtensionRegistry）

系统 SHALL 提供统一的扩展注册表，支持通过注册方式接入新的 PromptProvider、PostProcessPlugin、LogicTask 和 RenderComponent。

#### 接口规范

```typescript
interface ExtensionRegistry {
  // 提示词 Provider
  registerPromptProvider(provider: PromptProvider): void;
  getPromptProviders(): PromptProvider[];

  // 后处理插件
  registerPostProcessPlugin(plugin: PostProcessPlugin): void;
  getPostProcessPlugins(): PostProcessPlugin[];

  // 逻辑任务
  registerLogicTask(task: LogicTask): void;
  getLogicTasks(): LogicTask[];

  // 渲染组件
  registerRenderComponent(tag: string, component: React.ComponentType<any>): void;
  getRenderComponents(): Map<string, React.ComponentType<any>>;

  // AI 意图处理器
  registerIntentHandler(type: AIIntentType, handler: IntentHandler): void;
  getIntentHandler(type: AIIntentType): IntentHandler | null;
}
```

#### Scenario: 功能扩展

- **WHEN** 开发者需要新增一个功能模块（如"AI 实时生成图片"）
- **THEN** 通过 ExtensionRegistry 注册：
  - PromptProvider：注入图片生成格式指令
  - PostProcessPlugin：解析图片生成标签
  - LogicTask：触发图片生成 API 调用
  - RenderComponent：渲染生成的图片
- **AND** 无需修改管线核心代码

---

### Requirement: 图片生成接入接口（预留）

系统 SHALL 预留图片生成的完整接口规范，但不实现具体触发机制和生成逻辑。

#### 接口规范

```typescript
interface ImageGenRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  context: 'inline' | 'scene' | 'character';
}

interface ImageGenPlugin extends PostProcessPlugin {
  // 解析 AI 输出中的图片生成标签
  // 预留标签格式：<<<GENERATE_IMAGE>>>prompt<<<END_IMAGE>>>
}

interface ImageGenTask extends LogicTask {
  // 调用图片生成 API，将结果 URL 写入 context
}
```

#### Scenario: 接口就绪

- **WHEN** 未来需要实现 AI 对话中实时生成图片功能
- **THEN** 实现 ImageGenPlugin 和 ImageGenTask 并注册到 ExtensionRegistry
- **AND** 预留的接口规范确保接入无需修改管线核心

---

## MODIFIED Requirements

### Requirement: 公共 API 兼容

`useCharacterDialogueChat` hook 的返回值接口 SHALL 保持与当前一致，确保 UI 层（`CharacterDialogueChat.tsx`）无需修改。

#### 返回值保持不变

```typescript
interface UseCharacterDialogueChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  tokenUsage: { used: number; total: number } | null;
  sendMessage: (content: string) => void;
  continueConversation: () => void;
  retryMessage: (messageId: string) => void;
  clearChat: () => void;
  cancelRequest: () => void;
  editMessage: (messageId: string, content: string) => void;
  rollbackToMessage: (messageId: string) => void;
  generateUserReply: () => Promise<string | null>;
  polishInput: (text: string) => Promise<string | null>;
  compressContext: () => Promise<void>;
  // ... 其他现有返回值
}
```

#### Scenario: UI 层无感知

- **WHEN** 新架构替换完成
- **THEN** `CharacterDialogueChat.tsx` 中的 `useCharacterDialogueChat` 调用无需任何修改
- **AND** 所有 UI 交互行为（发送/续写/重试/润色/AI回复/压缩/回滚）保持一致

---

## REMOVED Requirements

### Requirement: 单体 requestAIResponse 函数

**Reason**: 约 1140 行的单体函数，包含 5 个阶段的全部逻辑，难以维护、测试和扩展。由 Pipeline + Middleware 架构替代。

**Migration**: `requestAIResponse` 的功能由以下模块分担：
- DataPreprocessor（输入处理）
- UserIntentRecognizer（意图识别）
- ContextAssembler（上下文组装）
- PromptComposer（提示词构建）
- ParameterInjector（参数注入）
- AIService（引擎调用）
- AIIntentRecognizer + PostProcessingPipeline（后处理）
- LogicEngine（副作用调度）

### Requirement: 硬编码后处理序列

**Reason**: `onComplete` 回调中的 13+ 个后处理步骤以硬编码顺序执行，新增步骤需修改回调函数。由 PostProcessingPipeline 插件机制替代。

**Migration**: 每个后处理步骤实现为独立的 PostProcessPlugin，通过 priority 控制执行顺序。

### Requirement: 重复的参数注入逻辑

**Reason**: `requestAIResponse`、`generateUserReply`、`polishInput` 三处几乎相同的 `engineConfigWithParams` 构建逻辑。由 ParameterInjector 统一替代。

**Migration**: 三个函数共用 ParameterInjector.buildEngineConfig。

### Requirement: 分散的 addLog 调用

**Reason**: `addLog` 调用散布在 hooks 各处，缺乏结构化上下文和级别区分。由 PipelineLogger 替代。

**Migration**: 所有日志通过 PipelineLogger 的 debug/info/warn/error 方法记录，自动附加 stage 上下文。

---

## 架构概览图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ExtensionRegistry                            │
│  (PromptProviders / PostProcessPlugins / LogicTasks / RenderComps) │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ 注册
┌───────────────────────────▼─────────────────────────────────────────┐
│                     DialoguePipeline                                │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │  PrePipeline │  │  AIService   │  │ PostPipeline│  │LogicEngine│ │
│  │              │  │              │  │             │  │           │ │
│  │ DataPreproc  │  │ EngineFactory│  │ IntentRecog │  │ Tasks     │ │
│  │ UserIntent   │  │ StreamMgr    │  │ PostProcess │  │ Scheduler │ │
│  │ ContextAssem │  │ ErrorHandle  │  │ Plugins     │  │ RetryLoop │ │
│  │ PromptCompose│  │ Timeout      │  │ ContentProt │  │           │ │
│  │ ParamInject  │  │              │  │             │  │           │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  └─────┬─────┘ │
│         │                 │                 │               │       │
│         ▼                 ▼                 ▼               ▼       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    DialoguePipelineContext                    │   │
│  │  (userInput / intent / systemPrompt / rawResponse / ...)    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ PipelineLogger  │  │  RobustParser    │  │  RenderSystem    │   │
│  │ (cross-cutting) │  │ (cross-cutting)  │  │ (cross-cutting)  │   │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ useCharacter │
                    │ DialogueChat │
                    │ (公共 API)   │
                    └──────────────┘
```

## 关键流程时序图

### 对话模式完整时序

```
User          UI Layer        Pipeline         AIService       AI Engine
 │              │                │                │               │
 │── 输入消息 ──▶│                │                │               │
 │              │── sendMessage ▶│                │               │
 │              │                │                │               │
 │              │   ┌────────────┤                │               │
 │              │   │ PrePipeline:                │               │
 │              │   │ 1. DataPreprocessor.normalize             │   │
 │              │   │ 2. UserIntentRecognizer → dialogue         │   │
 │              │   │ 3. ContextAssembler.retrieve*              │   │
 │              │   │ 4. PromptComposer.compose                  │   │
 │              │   │ 5. ParameterInjector.buildEngineConfig     │   │
 │              │   └────────────┤                │               │
 │              │                │── sendMessage ▶│               │
 │              │                │                │── POST ──────▶│
 │              │                │                │               │
 │              │◀── onStream ───│◀── onStream ───│◀── chunk ─────│
 │              │   (实时更新)   │                │               │
 │              │                │                │               │
 │              │                │                │◀── complete ──│
 │              │   ┌────────────┤                │               │
 │              │   │ PostPipeline:               │               │
 │              │   │ 1. AIIntentRecognizer.detect               │   │
 │              │   │ 2. ThinkTagPlugin.process                  │   │
 │              │   │ 3. ExpressionPlugin.process               │   │
 │              │   │ 4. SuggestedOptionsPlugin.process          │   │
 │              │   │ 5. TableEditPlugin.process                │   │
 │              │   │ 6. ContentProtectionPlugin.process         │   │
 │              │   │ 7. DedupPlugin.process                    │   │
 │              │   └────────────┤                │               │
 │              │   ┌────────────┤                │               │
 │              │   │ LogicEngine:                │               │
 │              │   │ - UpdateEmotionTask                        │   │
 │              │   │ - RenderOptionsTask                        │   │
 │              │   │ - ExecuteTableEditTask (async)             │   │
 │              │   │ - SaveChatTask                             │   │
 │              │   │ - TriggerVectorizationTask                 │   │
 │              │   └────────────┤                │               │
 │              │◀── 渲染完成 ───┤                │               │
 │◀── 显示回复 ─│                │                │               │
```
