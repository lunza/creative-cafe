/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——类型定义与共享常量（DEFAULT_USER_NAME + CharacterInfoForPrompt / PromptCoreResult / ContextVectorItem）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L3-L3 L5-L38。
 */
export const DEFAULT_USER_NAME = 'User';

// ==================== 类型定义 ====================

export interface CharacterInfoForPrompt {
  characterCardName?: string;
  personality?: string;
  characterCardContent?: string;
  scenario?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
}

export interface PromptCoreResult {
  characterContext: string;
  personaSection: string;
  charName: string;
}

export interface ContextVectorItem {
  source: string;
  score: number;
  content: string;
  metadata?: {
    source?: string;
    text?: string;
    entryUid?: string;
    matchedKeys?: string[];
    matchType?: string;
    matchScore?: number;
    entryName?: string;
    entryComment?: string;
    [key: string]: any;
  };
}
