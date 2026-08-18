/**
 * 禁词提示词注入 Provider — ForbiddenWordsPromptProvider
 *
 * Spec: add-forbidden-words-prompt / Task 3
 *
 * 在系统 prompt 的 suffix 区域注入「Forbidden Word List (Strict Constraints)」指令块，
 * 让 AI 在生成回复时主动避开指定词汇，而非事后过滤。
 *
 * 设计要点：
 * - section='suffix'、priority=460（在 FormatInstructionProvider 450 之后追加）
 * - 从 useSettingStore 读取 ForbiddenWordsConfig（全局设置）
 * - 仅当功能启用且至少存在一个类别时注入
 * - 输出为英文指令块（用户指定），禁词本身保持原样（支持中文禁词）
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import type { ForbiddenWordsConfig, ForbiddenWordCategory } from '@shared/types/forbiddenWords';
import { DEFAULT_FORBIDDEN_WORDS_CONFIG } from '@shared/types/forbiddenWords';

/**
 * 设置存储访问接口 — 用于解耦 Provider 与 Zustand store。
 * 生产环境使用默认实现，测试时可注入 mock。
 */
export interface SettingStoreAccessor {
  getForbiddenWordsConfig: () => ForbiddenWordsConfig | undefined;
}

/**
 * 默认设置存储访问器 — 通过 useSettingStore 获取全局设置。
 */
const defaultStoreAccessor: SettingStoreAccessor = {
  getForbiddenWordsConfig: () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useSettingStore } = require('../../../../../stores/settingStore');
      return useSettingStore.getState().setting?.forbiddenWords;
    } catch {
      return undefined;
    }
  },
};

/**
 * 生成单个类别的指令段落。
 *
 * 输出格式（开口禁词表 — Including but not limited to）：
 * ```
 * No {CategoryName}: {Description} Forbidden terms include but are not limited to: "w1", "w2", etc.
 * Note: {note}（可选）
 * ```
 *
 * 设计要点：禁词列表是示例而非穷举（Open-ended）。类别名称与描述构成
 * 语义约束的核心，列举的禁词仅为引导示例，AI 应避免该语义类别下的所有词汇。
 *
 * @param category 禁词类别
 * @returns 英文指令段落
 */
export function buildCategoryInstruction(category: ForbiddenWordCategory): string {
  // 过滤空词，去重
  const words = Array.from(new Set(category.words.map(w => w.trim()).filter(w => w.length > 0)));

  const avoidList = words.map(w => `"${w}"`).join(', ');
  const avoidSentence = words.length > 0
    ? ` Forbidden terms include but are not limited to: ${avoidList}, etc.`
    : '';

  const head = `No ${category.name}: ${category.description}${avoidSentence}`;

  if (category.note && category.note.trim()) {
    return `${head}\nNote: ${category.note.trim()}`;
  }
  return head;
}

/**
 * 生成完整的禁词指令块。
 *
 * 输出格式（英文）：
 * ```
 * Forbidden Word List (Strict Constraints):
 *
 * No Religious Terminology: ...
 *
 * No Extreme Emotion Labels: ...
 * Note: ...
 * ```
 *
 * @param config 禁词配置
 * @returns 完整指令块（多个类别以空行分隔）
 */
export function buildForbiddenWordsPrompt(config: ForbiddenWordsConfig): string {
  if (!config.enabled || config.categories.length === 0) {
    return '';
  }

  // 仅保留有内容的类别
  const sections: string[] = [];
  for (const category of config.categories) {
    if (!category.name.trim() || !category.description.trim()) {
      continue; // 名称或描述为空时跳过
    }
    sections.push(buildCategoryInstruction(category));
  }

  if (sections.length === 0) {
    return '';
  }

  return `Forbidden Word List (Strict Constraints):\n\n${sections.join('\n\n')}`;
}

export class ForbiddenWordsPromptProvider implements PromptProvider {
  readonly name = 'ForbiddenWordsPromptProvider';
  readonly priority = 460;
  readonly section = 'suffix' as const;

  /** 设置存储访问器 */
  private storeAccessor: SettingStoreAccessor;

  constructor(storeAccessor?: SettingStoreAccessor) {
    this.storeAccessor = storeAccessor ?? defaultStoreAccessor;
  }

  /**
   * 是否激活 — 禁词功能启用且至少存在一个非空类别时注入。
   *
   * @param _context 管线上下文
   * @returns 需要注入时返回 true
   */
  isActive(_context: DialoguePipelineContext): boolean {
    const config = this.storeAccessor.getForbiddenWordsConfig();
    if (!config) return false;
    return config.enabled === true && config.categories.length > 0;
  }

  /**
   * 构建禁词指令块文本。
   *
   * @param _context 管线上下文
   * @returns 英文指令块；功能禁用或类别为空时返回空字符串
   */
  async build(_context: DialoguePipelineContext): Promise<string> {
    const config = this.storeAccessor.getForbiddenWordsConfig() ?? DEFAULT_FORBIDDEN_WORDS_CONFIG;
    return buildForbiddenWordsPrompt(config);
  }
}