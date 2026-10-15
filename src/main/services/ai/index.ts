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
 *   Task 13 扩展 `getAIConfig()`）。【M-14/S-11】原 `../AIService.ts`
 *   内部同名的旧类已删除并合并到本类——全局唯一实例 `aiConfigProvider`，
 *   AIService 的聊天/探测配置方法（getConfig/getEngineConfig/getModelName
 *   with fallback）现委托该实例，AIService.ts 不再定义任何 provider 类。
 * - 新增代码应统一从 `./ai` 或 `./ai/AIConfigProvider` 导入。
 */

export {
  SSEStreamParser,
  getSSEStreamParser,
  type StreamChunkCallback,
  type StreamParseResult
} from './SSEStreamParser';

// AIConfigProvider 真源在 ./AIConfigProvider.ts，从此处统一 re-export
// 【M-14/S-11】AIServiceConfig/EngineConfig 为合并后 AIService 链路使用的类型
export {
  AIConfigProvider,
  aiConfigProvider,
  type AIConfig,
  type AIServiceConfig,
  type EngineConfig,
  type GetAIConfigOptions
} from './AIConfigProvider';

// 从 AIService.ts re-export，统一从 ai/ 入口暴露
// 【M-14/S-11】EngineConfig 真源已移至 ./AIConfigProvider.ts（上方已 re-export）
export {
  AIService,
  aiService,
  type ChatMessage,
  type CallOptions,
  type ChatResponse,
  type StreamResponse
} from '../AIService';
