/**
 * AI 服务统一入口
 *
 * 本目录是 AI 调用相关抽象的真源：
 * - `SSEStreamParser`：SSE 流式响应解析器（被所有流式 AI 调用复用）
 * - `AIConfigProvider`：从 settings 读取 AI 引擎配置（Task 13 抽取，
 *   被 ContentGenerator / OutlineGenerator / DescriptionPolisher /
 *   WritingStyleLearningService / AIAssistedChapterService /
 *   WritingStorageService / TableOrganizeService 共用）
 * - `AIService`：见 `../AIService.ts`，仍从此处 re-export 以便集中引用
 *
 * 使用方式：
 * ```ts
 * import { aiService, aiConfigProvider, SSEStreamParser } from './services/ai';
 * ```
 *
 * 注意：
 * - `AIConfigProvider` 的真源是 `./AIConfigProvider.ts`（Task 9 抽取，
 *   Task 13 扩展 `getAIConfig()`）。`../AIService.ts` 内部仍保留一个同名
 *   旧类供 AIService 自身使用，但此处仅 re-export 新版本以避免歧义。
 * - 旧代码若直接 `import { AIConfigProvider } from '../AIService'` 仍可工作，
 *   但新增代码应统一从 `./ai` 或 `./ai/AIConfigProvider` 导入。
 */

export {
  SSEStreamParser,
  getSSEStreamParser,
  type StreamChunkCallback,
  type StreamParseResult
} from './SSEStreamParser';

// AIConfigProvider 真源在 ./AIConfigProvider.ts，从此处统一 re-export
export {
  AIConfigProvider,
  aiConfigProvider,
  type AIConfig,
  type GetAIConfigOptions
} from './AIConfigProvider';

// 从 AIService.ts re-export，统一从 ai/ 入口暴露
export {
  AIService,
  aiService,
  type ChatMessage,
  type EngineConfig,
  type CallOptions,
  type ChatResponse,
  type StreamResponse
} from '../AIService';
