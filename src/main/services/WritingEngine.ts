import {
  OutlineGenerationRequest,
  ContentGenerationRequest,
  GeneratedOutline,
  GeneratedContent,
  WritingError,
  WritingErrorCode
} from '../../shared/types/writing.types';
import { outlineGenerator, OutlineGenerationResult } from './writing/OutlineGenerator';
import { contentGenerator } from './writing/ContentGenerator';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export class WritingEngine {
  async generateOutline(request: OutlineGenerationRequest): Promise<OutlineGenerationResult> {
    const messages = outlineGenerator.buildPrompt(request);
    return outlineGenerator.generate(messages, request.modelConfig);
  }

  async generateChapterContent(
    request: ContentGenerationRequest,
    modelConfig: ModelConfig,
    onStream: (chunk: string) => void,
    abortSignal: AbortSignal
  ): Promise<GeneratedContent> {
    return contentGenerator.generateStream(request, modelConfig, onStream, abortSignal);
  }

  cancelGeneration(): void {
    // Abort controllers are managed by IPC handler
  }
}

export const writingEngine = new WritingEngine();
