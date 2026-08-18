/**
 * PromptProvider 模块导出与批量注册
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 导出全部 14 个预置 PromptProvider 实现，并提供 registerAllProviders
 * 便捷函数一次性注册所有预置 Provider。
 */

export { CharacterContextProvider } from './CharacterContextProvider';
export { PersonaProvider } from './PersonaProvider';
export { KnowledgeContextProvider } from './KnowledgeContextProvider';
export { ChatHistoryProvider } from './ChatHistoryProvider';
export { MemoryTableProvider } from './MemoryTableProvider';
export { DialogueInstructionProvider } from './DialogueInstructionProvider';
export { ContinuationInstructionProvider } from './ContinuationInstructionProvider';
export { LengthGuidanceProvider } from './LengthGuidanceProvider';
export { LanguageProvider } from './LanguageProvider';
export { AssistModeProvider } from './AssistModeProvider';
export { ExpressionProvider } from './ExpressionProvider';
export { AsyncTableOrganizeProvider } from './AsyncTableOrganizeProvider';
export { FormatInstructionProvider } from './FormatInstructionProvider';
export { ForbiddenWordsPromptProvider } from './ForbiddenWordsPromptProvider';

import type { PromptComposer } from '../PromptComposer';
import { CharacterContextProvider } from './CharacterContextProvider';
import { PersonaProvider } from './PersonaProvider';
import { KnowledgeContextProvider } from './KnowledgeContextProvider';
import { ChatHistoryProvider } from './ChatHistoryProvider';
import { MemoryTableProvider } from './MemoryTableProvider';
import { DialogueInstructionProvider } from './DialogueInstructionProvider';
import { ContinuationInstructionProvider } from './ContinuationInstructionProvider';
import { LengthGuidanceProvider } from './LengthGuidanceProvider';
import { LanguageProvider } from './LanguageProvider';
import { AssistModeProvider } from './AssistModeProvider';
import { ExpressionProvider } from './ExpressionProvider';
import { AsyncTableOrganizeProvider } from './AsyncTableOrganizeProvider';
import { FormatInstructionProvider } from './FormatInstructionProvider';
import { ForbiddenWordsPromptProvider } from './ForbiddenWordsPromptProvider';

/**
 * 一次性注册全部 14 个预置 PromptProvider 到 PromptComposer。
 *
 * 注册顺序不影响最终输出顺序（由 section + priority 决定），
 * 但同 priority 的 Provider 按注册顺序稳定排列。
 *
 * @param composer 目标 PromptComposer 实例
 */
export function registerAllProviders(composer: PromptComposer): void {
  // context section (priority 100-220)
  composer.registerProvider(new CharacterContextProvider());
  composer.registerProvider(new PersonaProvider());
  composer.registerProvider(new KnowledgeContextProvider());
  composer.registerProvider(new ChatHistoryProvider());
  composer.registerProvider(new MemoryTableProvider());

  // instruction section (priority 300)
  composer.registerProvider(new DialogueInstructionProvider());
  composer.registerProvider(new ContinuationInstructionProvider());

  // suffix section (priority 400-460)
  composer.registerProvider(new LengthGuidanceProvider());
  composer.registerProvider(new LanguageProvider());
  composer.registerProvider(new AssistModeProvider());
  composer.registerProvider(new ExpressionProvider());
  composer.registerProvider(new AsyncTableOrganizeProvider());
  composer.registerProvider(new FormatInstructionProvider());
  composer.registerProvider(new ForbiddenWordsPromptProvider());
}
