/**
 * 禁词表提示词注入类型定义
 *
 * Spec: add-forbidden-words-prompt / Task 2
 *
 * 在系统 prompt 中注入「Forbidden Word List (Strict Constraints)」指令块，
 * 让 AI 在生成回复时主动避开指定词汇，而非事后过滤。
 *
 * 配置作为 AppSetting 嵌套字段（forbiddenWords）随 settings.json 整体持久化。
 */

/**
 * 禁词类别 — 一组相关禁词的集合，附带类别描述和可选的替代表达建议。
 */
export interface ForbiddenWordCategory {
  /** 类别名称，如 "Religious Terminology" */
  name: string;
  /** 类别描述，如 "Do not use words related to religion, rituals, or divinity." */
  description: string;
  /** 禁词列表，如 ["sacrifice", "offering", "sacred", "holy"] */
  words: string[];
  /**
   * 可选备注 — 替代表达建议。
   * 如 "Instead of labeling these emotions, describe the physical manifestations and behavioral reactions to convey the intensity (Show, Don't Tell)."
   */
  note?: string;
}

/**
 * 禁词执行模式。
 * - 'prompt-only': 仅提示词约束（软约束，现状行为）
 * - 'retry': 命中后自动重试（带违规反馈），超限后保留原文
 * - 'retry-and-replace': 重试超限后硬替换命中词（默认，唯一保证 100% 合规的模式）
 */
export type ForbiddenWordsEnforcement = 'prompt-only' | 'retry' | 'retry-and-replace';

/**
 * 禁词提示词注入配置结构。
 */
export interface ForbiddenWordsConfig {
  /** 全局开关（默认 false，需用户手动开启） */
  enabled: boolean;
  /** 禁词类别列表 */
  categories: ForbiddenWordCategory[];
  /**
   * 输出合规执行模式（Spec: enforce-forbidden-words-and-dialogue-naturalness）。
   * 可选字段：存量配置缺省时视为 'retry-and-replace'（默认保证 100% 合规）。
   */
  enforcement?: ForbiddenWordsEnforcement;
  /** 硬替换兜底使用的替换文本（retry-and-replace 模式），默认 '***' */
  replacementText?: string;
  /** 合规重试上限，默认 2（范围 1-5） */
  maxRetries?: number;
}

/** enforcement 缺省默认值（存量配置无此字段时取此值） */
export const DEFAULT_ENFORCEMENT: ForbiddenWordsEnforcement = 'retry-and-replace';
/** replacementText 缺省默认值 */
export const DEFAULT_REPLACEMENT_TEXT = '***';
/** maxRetries 缺省默认值 */
export const DEFAULT_MAX_RETRIES = 2;

/**
 * 禁词提示词注入默认配置常量。
 * 默认关闭（enabled=false），避免对用户现有对话产生意外影响。
 * 默认预置两个示例类别（Religious Terminology + Extreme Emotion Labels），
 * 用户可按需修改或删除。
 */
export const DEFAULT_FORBIDDEN_WORDS_CONFIG: ForbiddenWordsConfig = {
  enabled: false,
  categories: [
    {
      name: 'Religious Terminology',
      description: 'Do not use words related to religion, rituals, or divinity.',
      words: ['sacrifice (献祭)', 'offering (祭品)', 'victim (祭品)', 'sacred (神圣)', 'holy (神圣)'],
    },
    {
      name: 'Extreme Emotion Labels',
      description: 'Do not use direct adjectives or nouns to label extreme psychological states.',
      words: ['crazy (疯狂)', 'insane (疯狂)', 'fear (恐惧)', 'terror (恐惧)', 'despair (绝望)', 'hopelessness (绝望)'],
      note: 'Instead of labeling these emotions, describe the physical manifestations and behavioral reactions to convey the intensity (Show, Don\'t Tell).',
    },
  ],
};