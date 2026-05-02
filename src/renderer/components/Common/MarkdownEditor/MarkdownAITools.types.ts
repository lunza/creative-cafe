import { AIRequestOptions } from '../AIService.types';

export enum AIToolType {
  Polish = 'polish',
  Expand = 'expand',
  Translate = 'translate'
}

export interface TranslationLanguage {
  code: string;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: TranslationLanguage[] = [
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' }
];

export interface AIToolConfig {
  type: AIToolType;
  targetLanguage?: string;
  promptTemplate?: string;
  customRequirements?: string;
}

export interface AIToolResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface UseAIToolsOptions {
  onSuccess?: (result: string) => void;
  onError?: (error: string) => void;
}

export interface AIToolState {
  isProcessing: boolean;
  currentTool: AIToolType | null;
  error: string | null;
}

export interface SelectionInfo {
  text: string;
  from: number;
  to: number;
  isEmpty: boolean;
}

export interface ModalState {
  isOpen: boolean;
  toolType: AIToolType | null;
  selectedText: string;
}

// 默认润色逻辑提示词
export const DEFAULT_POLISH_PROMPT = '优化文本表达流畅度、修正语法错误、提升语言规范性';

// 默认扩写逻辑提示词
export const DEFAULT_EXPAND_PROMPT = '在保持原意的基础上，增加适当的细节描述、扩展相关内容、丰富文本层次';

export const DEFAULT_PROMPTS: Record<AIToolType, string> = {
  [AIToolType.Polish]: '请优化以下文本的表达流畅度、语法准确性和可读性，保持原意不变，仅返回优化后的文本：\n\n{text}',
  [AIToolType.Expand]: '请在保留核心意思的基础上，对以下文本进行内容扩展和细节补充，仅返回扩写后的文本：\n\n{text}',
  [AIToolType.Translate]: '请将以下文本准确翻译成{targetLanguage}，仅返回翻译后的文本：\n\n{text}'
};
