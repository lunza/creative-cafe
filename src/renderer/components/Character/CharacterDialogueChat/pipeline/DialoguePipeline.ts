/**
 * DialoguePipeline — 对话管线集成层
 *
 * Spec: redesign-dialogue-pipeline-architecture / Task 13
 *
 * 主编排器，将所有管线模块串联为统一的执行流程：
 *   PrePipeline → AIService → PostPipeline → LogicEngine
 *
 * 设计原则：
 * - 不直接管理 React state，通过回调通知 UI 层更新
 * - 管线执行为异步长流程（AI 流式），流式更新通过回调实时分发
 * - 去重重试循环在管线内部处理（最多 2 次重试）
 * - 每次执行创建全新的 context 对象，避免跨执行状态污染
 */

import type {
  DialoguePipelineContext,
  UserAction,
  UserIntent,
  PipelineMode,
  ChatMessage,
  CharacterInfo,
  CharacterSessionConfig,
  AIEngineConfig,
  EffectiveAIParams,
  EngineCapabilities,
  UserPersona,
  VectorSearchResult,
  ChatHistoryItem,
  SuggestedOption,
} from './pipeline.types';

import type { TruncationConfig } from '../TokenManagement/types';

import { PipelineLogger } from './PipelineLogger';
import { ExtensionRegistry } from './ExtensionRegistry';
import { DataPreprocessor } from './DataPreprocessor';
import { UserIntentRecognizer } from './UserIntentRecognizer';
import { ContextAssembler } from './ContextAssembler';
import { PromptComposer } from './PromptComposer';
import { ParameterInjector } from './ParameterInjector';
import { AIService } from './AIService';
import { AIIntentRecognizer } from './AIIntentRecognizer';
import { PostProcessingPipeline } from './PostProcessingPipeline';
import { LogicEngine } from './LogicEngine';

import { registerAllProviders } from './providers';
import { registerAllPlugins } from './plugins';
import type {
  UpdateEmotionTaskOptions,
  RenderOptionsTaskOptions,
  ExecuteTableEditTaskOptions,
  TriggerSyncOrganizeTaskOptions,
  TriggerVectorizationTaskOptions,
  SaveChatTaskOptions,
  UpdateTokenUsageTaskOptions,
} from './tasks';
import {
  UpdateEmotionTask,
  RenderOptionsTask,
  ExecuteTableEditTask,
  TriggerSyncOrganizeTask,
  TriggerVectorizationTask,
  SaveChatTask,
  UpdateTokenUsageTask,
} from './tasks';

// ===== 管线输入 / 输出类型 =====

/**
 * 管线执行所需的回调集合 — 由集成层（hooks）注入，用于通知 UI 更新。
 */
export interface PipelineCallbacks {
  /** 流式 chunk 到达时回调（累积内容） */
  onStreamUpdate?: (targetMessageId: string, accumulatedContent: string) => void;
  /** 管线完成时回调（后处理后的最终内容） */
  onMessageUpdate?: (targetMessageId: string, content: string, options?: {
    emotion?: string | null;
    suggestedOptions?: SuggestedOption[] | null;
  }) => void;
  /** 管线出错时回调 */
  onError?: (targetMessageId: string, error: string) => void;
  /** 情绪更新回调（由 LogicEngine UpdateEmotionTask 触发） */
  onEmotionUpdate?: (messageId: string, emotion: string) => void;
  /** 推荐选项渲染回调（由 LogicEngine RenderOptionsTask 触发） */
  onOptionsRender?: (messageId: string, options: SuggestedOption[]) => void;
  /** 保存聊天记录回调（由 LogicEngine SaveChatTask 触发） */
  onSaveChat?: (messages: ChatMessage[]) => void;
  /** 同步整理触发回调（由 LogicEngine TriggerSyncOrganizeTask 触发） */
  onSyncOrganize?: () => void;
  /** Token 用量更新回调（由 LogicEngine UpdateTokenUsageTask 触发） */
  onTokenUsageUpdate?: (used: number, total: number) => void;
}

/**
 * 管线输入 — 每次执行所需的全部数据。
 */
export interface PipelineInput {
  /** 用户输入文本（dialogue 模式必填，其他模式可为空） */
  userInput: string;
  /** 用户 UI 操作（显式意图来源） */
  userAction: UserAction;
  /** 角色信息 */
  characterInfo: CharacterInfo;
  /** 角色会话配置 */
  sessionConfig: CharacterSessionConfig;
  /** 当前激活的 AI 引擎配置 */
  activeEngine: AIEngineConfig;
  /** 管线模式 */
  pipelineMode: PipelineMode;
  /** 选中的用户人设 */
  selectedPersona?: UserPersona | null;
  /** 待发送的上下文消息列表（已包含用户最新消息，不含 AI placeholder） */
  contextMessages: ChatMessage[];
  /** 目标 AI 消息 ID（流式更新和最终结果写入的目标） */
  targetMessageId: string;
  /** 续写模式下的初始内容 */
  initialContent?: string;
  /** 知识库范围 ID 列表 */
  knowledgeBaseScopeIds?: string[];
  /** 截断配置 */
  truncationConfig?: TruncationConfig;
  /** 逻辑任务所需的运行时回调 */
  callbacks: PipelineCallbacks;
  /** 逻辑任务所需的运行时数据 */
  taskRuntimeData?: {
    /** 待保存的消息列表（含 AI 最终回复） */
    messagesToSave?: ChatMessage[];
    /** 当前消息总数（用于向量化触发判定） */
    messageCount?: number;
    /** 聊天会话 ID */
    chatId?: string;
    /** 角色卡 ID */
    characterCardId?: string;
    /** 是否启用同步整理模式 */
    isSyncMode?: boolean;
    /** 去重重试的最大次数 */
    maxDedupRetries?: number;
  };
}

/**
 * 管线执行结果。
 */
export interface PipelineResult {
  /** 管线上下文（包含全部中间和最终数据） */
  context: DialoguePipelineContext;
  /** 是否成功完成（无致命错误） */
  success: boolean;
  /** 错误信息（失败时填写） */
  error?: string;
}

// ===== 最大去重重试次数 =====

const MAX_DEDUP_RETRIES = 2;

// ===== DialoguePipeline =====

/**
 * DialoguePipeline — 对话管线主编排器。
 *
 * 串联所有管线模块，按 PrePipeline → AIService → PostPipeline → LogicEngine
 * 顺序执行。去重重试循环在管线内部处理。
 */
export class DialoguePipeline {
  // 管线模块实例
  private readonly dataPreprocessor: DataPreprocessor;
  private readonly userIntentRecognizer: UserIntentRecognizer;
  private readonly contextAssembler: ContextAssembler;
  private readonly promptComposer: PromptComposer;
  private readonly parameterInjector: ParameterInjector;
  private readonly aiService: AIService;
  private readonly aiIntentRecognizer: AIIntentRecognizer;
  private readonly postProcessingPipeline: PostProcessingPipeline;
  private readonly extensionRegistry: ExtensionRegistry;

  /**
   * 构造函数 — 初始化所有管线模块并注册预置扩展。
   */
  constructor() {
    // 创建模块实例
    this.dataPreprocessor = new DataPreprocessor();
    this.userIntentRecognizer = new UserIntentRecognizer();
    this.contextAssembler = new ContextAssembler();
    this.promptComposer = new PromptComposer();
    this.parameterInjector = new ParameterInjector();
    this.aiService = new AIService();
    this.aiIntentRecognizer = new AIIntentRecognizer();
    this.postProcessingPipeline = new PostProcessingPipeline();
    this.extensionRegistry = ExtensionRegistry.getInstance();

    // 注册预置扩展
    registerAllProviders(this.promptComposer);
    registerAllPlugins(this.postProcessingPipeline);
  }

  /**
   * 获取 AIService 实例（供 hooks 调用 cancel）。
   */
  getAIService(): AIService {
    return this.aiService;
  }

  /**
   * 获取 ExtensionRegistry 实例（供外部注册自定义扩展）。
   */
  getExtensionRegistry(): ExtensionRegistry {
    return this.extensionRegistry;
  }

  /**
   * 创建全新的管线上下文对象。
   * 每次管线执行创建独立 context，避免跨执行状态污染。
   *
   * @param input 管线输入
   * @returns 初始化后的管线上下文
   */
  createContext(input: PipelineInput): DialoguePipelineContext {
    return {
      // 输入
      userInput: input.userInput,
      userIntent: this.resolveIntent(input.userAction),
      characterInfo: input.characterInfo,
      sessionConfig: input.sessionConfig,
      activeEngine: input.activeEngine,
      pipelineMode: input.pipelineMode,
      selectedPersona: input.selectedPersona ?? undefined,

      // 上下文组装（初始为空）
      retrievedContext: {
        knowledgeBase: [],
        chatHistory: [],
        memoryTableData: '',
        memoryTableStructure: null,
      },

      // 提示词（初始为空）
      systemPrompt: '',
      messagesToSend: [],
      engineConfig: input.activeEngine,
      stopSequences: [],

      // AI 响应（初始为空）
      rawResponse: '',
      streamingContent: input.initialContent ?? '',
      aiIntents: [],

      // 后处理结果（初始为空）
      processedContent: '',
      emotion: null,
      suggestedOptions: null,
      tableEditCommands: null,
      imageGenRequests: null,
      thinkContent: null,
      dedupInfo: null,

      // 元数据
      logs: [],
      metrics: {
        totalDuration: 0,
        stageDurations: {},
        stageCounts: {},
      },
      errors: [],
    };
  }

  /**
   * 解析用户意图（显式意图优先）。
   */
  private resolveIntent(action: UserAction): UserIntent {
    return this.userIntentRecognizer.resolveExplicit(action);
  }

  /**
   * 主执行方法 — 编排管线的完整执行流程。
   *
   * 流程：
   * 1. PrePipeline：数据预处理 → 意图识别 → 上下文组装 → 提示词构建 → 参数注入 → 上下文截断
   * 2. AIService：发送消息，流式回调通知 UI
   * 3. PostPipeline：AI 意图识别 → 后处理插件链
   * 4. 去重重试循环：如果 DedupPlugin 检测到重复，重试 AIService + PostPipeline（最多 2 次）
   * 5. LogicEngine：执行副作用调度任务
   *
   * @param input 管线输入
   * @returns 管线执行结果
   */
  async execute(input: PipelineInput): Promise<PipelineResult> {
    const context = this.createContext(input);
    const logger = new PipelineLogger(context.logs);

    try {
      // ===== PrePipeline Stage =====
      await this.runPrePipeline(context, input, logger);

      // ===== AIService + PostPipeline + 去重重试循环 =====
      await this.runAIServiceWithDedupRetry(context, input, logger);

      // ===== LogicEngine Stage =====
      await this.runLogicEngine(context, input, logger);

      // 汇总性能指标
      context.metrics = logger.getMetrics();

      return { context, success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('DialoguePipeline', `管线执行失败: ${errorMsg}`, {
        stack: err instanceof Error ? err.stack : undefined,
      });
      context.metrics = logger.getMetrics();

      return { context, success: false, error: errorMsg };
    }
  }

  // ===== PrePipeline Stage =====

  /**
   * 执行 PrePipeline 阶段：
   * a. DataPreprocessor.normalize
   * b. UserIntentRecognizer.resolveExplicit（在 createContext 中已完成）
   * c. ContextAssembler.retrieveKnowledgeBase + retrieveChatHistory + fetchMemoryTable
   * d. PromptComposer.compose
   * e. ParameterInjector.getEffectiveParams + buildEngineConfig
   * f. ParameterInjector.buildStopSequences
   * g. ContextAssembler.truncateContext
   */
  private async runPrePipeline(
    context: DialoguePipelineContext,
    input: PipelineInput,
    logger: PipelineLogger,
  ): Promise<void> {
    // a. 数据预处理
    context.userInput = await logger.trace('DataPreprocessor', async () => {
      return this.dataPreprocessor.normalize(input.userInput);
    });

    // b. 意图识别已在 createContext 中通过 resolveExplicit 完成

    // c. 上下文组装
    await logger.trace('ContextAssembler', async () => {
      const scopeIds = input.knowledgeBaseScopeIds ?? [];

      // 知识库检索
      const kbResults: VectorSearchResult[] = await this.contextAssembler.retrieveKnowledgeBase(
        context.userInput,
        scopeIds,
      );
      context.retrievedContext.knowledgeBase = kbResults;

      // 对话历史 RAG 检索（将 contextMessages 转为 ChatHistoryItem 格式）
      const chatId = input.taskRuntimeData?.chatId ?? '';
      const chatHistoryItems: ChatHistoryItem[] = await this.contextAssembler.retrieveChatHistory(
        chatId,
        context.userInput,
        input.contextMessages.length,
      );
      context.retrievedContext.chatHistory = chatHistoryItems;

      // 同时把 contextMessages 也放入 chatHistory 供 DedupPlugin 等使用
      // DedupPlugin 需要上一条 assistant 消息来做去重比较
      const contextMessagesAsHistory: ChatHistoryItem[] = input.contextMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      }));
      // 合并：RAG 检索的历史 + 当前上下文消息
      context.retrievedContext.chatHistory = [...chatHistoryItems, ...contextMessagesAsHistory];

      // 记忆表格数据获取
      const memoryEnabled = input.sessionConfig.memoryTableEnabled ?? false;
      const memoryResult = await this.contextAssembler.fetchMemoryTable(memoryEnabled, chatId);
      context.retrievedContext.memoryTableData = memoryResult.data;
      context.retrievedContext.memoryTableStructure = memoryResult.structure;
    });

    // d. 提示词构建
    context.systemPrompt = await logger.trace('PromptComposer', async () => {
      return this.promptComposer.compose(context);
    });

    // e. 参数注入
    await logger.trace('ParameterInjector', async () => {
      const customParams = input.sessionConfig.customParameters ?? {};
      const effectiveParams: EffectiveAIParams = this.parameterInjector.getEffectiveParams(
        customParams,
        input.activeEngine,
      );

      const capabilities: EngineCapabilities = this.aiService.getCapabilities();
      context.engineConfig = this.parameterInjector.buildEngineConfig(
        input.activeEngine,
        effectiveParams,
        capabilities,
      );
    });

    // f. 停止序列
    const charName = input.characterInfo.characterCardName || 'Character';
    const userName = input.selectedPersona?.name || 'User';
    context.stopSequences = this.parameterInjector.buildStopSequences(
      context.pipelineMode,
      charName,
      userName,
    );

    // g. 上下文截断
    context.messagesToSend = await logger.trace('ContextTruncator', async () => {
      if (input.truncationConfig) {
        return this.contextAssembler.truncateContext(
          input.contextMessages,
          input.truncationConfig,
        );
      }
      return input.contextMessages;
    });

    logger.info('PrePipeline', 'PrePipeline 阶段完成', {
      systemPromptLength: context.systemPrompt.length,
      messagesToSendCount: context.messagesToSend.length,
      stopSequencesCount: context.stopSequences.length,
    });
  }

  // ===== AIService + PostPipeline + 去重重试循环 =====

  /**
   * 执行 AIService + PostPipeline，并在检测到去重需要重试时循环重试。
   *
   * 重试逻辑：
   * - 第一次执行 PostPipeline 后检查 context.dedupInfo
   * - 如果 needRetry=true 且未耗尽，重试 AIService + PostPipeline
   * - 最多重试 MAX_DEDUP_RETRIES 次
   * - 超过上限后标记 exhausted=true 并接受当前结果
   */
  private async runAIServiceWithDedupRetry(
    context: DialoguePipelineContext,
    input: PipelineInput,
    logger: PipelineLogger,
  ): Promise<void> {
    const maxRetries = input.taskRuntimeData?.maxDedupRetries ?? MAX_DEDUP_RETRIES;
    let attempt = 0;

    while (true) {
      // ===== AIService Stage =====
      await logger.trace('AIService', async () => {
        await this.runAIService(context, input, logger);
      });

      // ===== PostPipeline Stage =====
      await logger.trace('PostPipeline', async () => {
        await this.runPostPipeline(context, logger);
      });

      // ===== 去重重试判定 =====
      // polish 和 userReply 模式不需要去重检测
      if (
        context.pipelineMode === 'polish' ||
        context.pipelineMode === 'userReply'
      ) {
        break;
      }

      const dedupInfo = context.dedupInfo;
      if (!dedupInfo || !dedupInfo.needRetry) {
        // 无需重试
        break;
      }

      attempt++;
      if (attempt > maxRetries) {
        // 超过重试上限，标记耗尽并接受当前结果
        context.dedupInfo = {
          ...dedupInfo,
          needRetry: false,
          exhausted: true,
          reason: `${dedupInfo.reason}（已重试 ${maxRetries} 次，接受当前结果）`,
        };
        logger.warn('DialoguePipeline', `去重重试已耗尽（${maxRetries} 次），接受当前结果`, {
          metric: dedupInfo.metric,
          kind: dedupInfo.kind,
        });
        break;
      }

      // 需要重试 — 重置后处理状态
      logger.info('DialoguePipeline', `检测到重复内容，开始第 ${attempt} 次重试`, {
        metric: dedupInfo.metric,
        kind: dedupInfo.kind,
        reason: dedupInfo.reason,
      });

      // 重置 AI 响应和后处理状态
      context.rawResponse = '';
      context.streamingContent = input.initialContent ?? '';
      context.aiIntents = [];
      context.processedContent = '';
      context.emotion = null;
      context.suggestedOptions = null;
      context.tableEditCommands = null;
      context.imageGenRequests = null;
      context.thinkContent = null;
      context.dedupInfo = null;

      // 继续循环重试
    }
  }

  /**
   * 执行 AIService 阶段：发送消息，管理流式回调。
   */
  private async runAIService(
    context: DialoguePipelineContext,
    input: PipelineInput,
    logger: PipelineLogger,
  ): Promise<void> {
    const targetMessageId = input.targetMessageId;
    const initialContent = input.initialContent ?? '';

    return new Promise<void>((resolve, reject) => {
      let hasResolved = false;

      this.aiService.sendMessage(context, {
        onStream: (_chunk: string, accumulated: string) => {
          // 更新 context 流式内容
          // 续写模式下累积内容包含初始内容前缀
          context.streamingContent = initialContent + accumulated;

          // 通知 UI 层更新
          if (input.callbacks.onStreamUpdate) {
            input.callbacks.onStreamUpdate(targetMessageId, context.streamingContent);
          }
        },
        onComplete: (fullContent: string, _finishReason: string) => {
          if (hasResolved) return;
          hasResolved = true;

          // 设置原始响应
          // 续写模式下 fullContent 是 AI 新生成的部分，需要拼接初始内容
          if (initialContent) {
            context.rawResponse = initialContent + fullContent;
          } else {
            context.rawResponse = fullContent;
          }
          context.streamingContent = context.rawResponse;

          logger.info('AIService', `AI 响应完成: ${context.rawResponse.length} 字符`);
          resolve();
        },
        onError: (error: Error) => {
          if (hasResolved) return;
          hasResolved = true;

          logger.error('AIService', `AI 请求失败: ${error.message}`);

          // 通知 UI 层
          if (input.callbacks.onError) {
            input.callbacks.onError(targetMessageId, error.message);
          }

          reject(error);
        },
      }).catch((err: unknown) => {
        if (hasResolved) return;
        hasResolved = true;
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('AIService', `AIService.sendMessage 异常: ${error.message}`);
        if (input.callbacks.onError) {
          input.callbacks.onError(targetMessageId, error.message);
        }
        reject(error);
      });
    });
  }

  /**
   * 执行 PostPipeline 阶段：
   * a. AIIntentRecognizer.detect → context.aiIntents
   * b. PostProcessingPipeline.execute → context.processedContent
   */
  private async runPostPipeline(
    context: DialoguePipelineContext,
    logger: PipelineLogger,
  ): Promise<void> {
    // a. AI 意图识别
    context.aiIntents = this.aiIntentRecognizer.detect(context.rawResponse);

    logger.info('AIIntentRecognizer', `检测到 ${context.aiIntents.length} 个 AI 意图`, {
      types: context.aiIntents.map(i => i.type),
    });

    // b. 后处理插件链执行
    context.processedContent = this.postProcessingPipeline.execute(
      context.rawResponse,
      context,
    );

    logger.info('PostPipeline', `后处理完成: ${context.processedContent.length} 字符`, {
      emotion: context.emotion,
      hasOptions: context.suggestedOptions !== null,
      hasTableEdit: context.tableEditCommands !== null,
      thinkContentLength: context.thinkContent?.length ?? 0,
      dedupInfo: context.dedupInfo
        ? { needRetry: context.dedupInfo.needRetry, metric: context.dedupInfo.metric }
        : null,
    });
  }

  // ===== LogicEngine Stage =====

  /**
   * 执行 LogicEngine 阶段：注册运行时任务并执行。
   *
   * 逻辑任务需要每次执行时注入运行时数据（如 messageId、messages、callbacks），
   * 因此不能在构造函数中静态注册，需在每次 execute 时动态注册。
   */
  private async runLogicEngine(
    context: DialoguePipelineContext,
    input: PipelineInput,
    logger: PipelineLogger,
  ): Promise<void> {
    // 创建本次执行专用的 LogicEngine（避免任务跨执行累积）
    const logicEngine = new LogicEngine();
    const targetMessageId = input.targetMessageId;
    const runtime = input.taskRuntimeData ?? {};
    const callbacks = input.callbacks;

    // 注册预置逻辑任务（仅注册条件可能满足的任务）

    // 1. UpdateEmotionTask (priority 100)
    if (callbacks.onEmotionUpdate) {
      const emotionOptions: UpdateEmotionTaskOptions = {
        onEmotionUpdate: callbacks.onEmotionUpdate,
        messageId: targetMessageId,
      };
      logicEngine.registerTask(new UpdateEmotionTask(emotionOptions));
    }

    // 2. RenderOptionsTask (priority 200)
    if (callbacks.onOptionsRender) {
      const optionsTaskOptions: RenderOptionsTaskOptions = {
        onOptionsRender: callbacks.onOptionsRender,
        messageId: targetMessageId,
      };
      logicEngine.registerTask(new RenderOptionsTask(optionsTaskOptions));
    }

    // 3. ExecuteTableEditTask (priority 300)
    const chatId = runtime.chatId ?? '';
    const characterCardId = runtime.characterCardId ?? input.characterInfo.characterCardId;
    if (chatId) {
      const tableEditOptions: ExecuteTableEditTaskOptions = {
        chatId,
        characterCardId,
      };
      logicEngine.registerTask(new ExecuteTableEditTask(tableEditOptions));
    }

    // 4. TriggerSyncOrganizeTask (priority 400)
    if (callbacks.onSyncOrganize) {
      const syncOptions: TriggerSyncOrganizeTaskOptions = {
        onSyncOrganize: callbacks.onSyncOrganize,
        isSyncMode: runtime.isSyncMode ?? false,
      };
      logicEngine.registerTask(new TriggerSyncOrganizeTask(syncOptions));
    }

    // 5. TriggerVectorizationTask (priority 500)
    if (chatId && runtime.messageCount !== undefined) {
      const vectorOptions: TriggerVectorizationTaskOptions = {
        chatId,
        messageCount: runtime.messageCount,
      };
      logicEngine.registerTask(new TriggerVectorizationTask(vectorOptions));
    }

    // 6. DedupRetryTask (priority 600)
    // 去重重试在 runAIServiceWithDedupRetry 中已处理，
    // 此处不注册 DedupRetryTask，避免重复重试

    // 7. SaveChatTask (priority 700)
    if (callbacks.onSaveChat && runtime.messagesToSave) {
      const saveOptions: SaveChatTaskOptions = {
        onSave: callbacks.onSaveChat,
        messages: runtime.messagesToSave,
      };
      logicEngine.registerTask(new SaveChatTask(saveOptions));
    }

    // 8. UpdateTokenUsageTask (priority 800)
    if (callbacks.onTokenUsageUpdate) {
      const tokenOptions: UpdateTokenUsageTaskOptions = {
        onTokenUpdate: callbacks.onTokenUsageUpdate,
      };
      logicEngine.registerTask(new UpdateTokenUsageTask(tokenOptions));
    }

    // 执行所有条件满足的任务
    await logger.trace('LogicEngine', async () => {
      await logicEngine.execute(context);
    });

    // 通知 UI 层最终消息更新
    if (callbacks.onMessageUpdate) {
      callbacks.onMessageUpdate(targetMessageId, context.processedContent, {
        emotion: context.emotion,
        suggestedOptions: context.suggestedOptions,
      });
    }
  }
}
