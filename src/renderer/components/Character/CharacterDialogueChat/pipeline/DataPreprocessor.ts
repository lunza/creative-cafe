/**
 * 数据前处理模块 — DataPreprocessor
 *
 * Spec: redesign-dialogue-pipeline-architecture / DataPreprocessor
 *
 * 负责用户输入的标准化、验证和模板替换。
 * - normalize：去除多余空白、统一换行
 * - validate：空值检查、长度限制
 * - replaceTemplates：迁移自 messageProcessor.ts，处理 {{char}}/{{user}} 替换
 * - detectLanguage：简单语言检测（CJK/日文/英文）
 */

import type { ValidationResult } from './pipeline.types';

/** 默认最大输入长度（字符数） */
const DEFAULT_MAX_LENGTH = 10000;

/** 默认角色占位符 */
const DEFAULT_CHAR_PLACEHOLDER = '{{char}}';

/** 默认用户占位符 */
const DEFAULT_USER_PLACEHOLDER = '{{user}}';

export class DataPreprocessor {
  /**
   * 标准化文本：去除首尾空白、合并连续空行（3+ 换行 → 2 换行）、移除每行尾部空白。
   *
   * @param text 原始输入文本
   * @returns 标准化后的文本
   */
  normalize(text: string): string {
    if (!text) return '';

    // 1. 去除首尾空白
    let result = text.trim();

    // 2. 移除每行尾部空白
    result = result
      .split('\n')
      .map(line => line.replace(/\s+$/g, ''))
      .join('\n');

    // 3. 合并连续空行：3+ 换行 → 2 换行
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * 验证输入文本：空值检查、长度限制。
   *
   * @param text 待验证文本
   * @param maxLength 最大长度（默认 10000 字符）
   * @returns 验证结果
   */
  validate(text: string, maxLength: number = DEFAULT_MAX_LENGTH): ValidationResult {
    // 空值或纯空白检查
    if (!text || text.trim().length === 0) {
      return { valid: false, reason: '输入不能为空' };
    }

    // 长度检查
    if (text.length > maxLength) {
      return { valid: false, reason: `输入长度超过最大限制（${maxLength} 字符）` };
    }

    return { valid: true };
  }

  /**
   * 模板替换：将 {{char}}/{{user}} 及其大小写变体替换为实际角色名/用户名。
   * 迁移自 messageProcessor.ts 的 replaceTemplates 函数。
   *
   * 处理的占位符变体（每种含原始、全小写、首字母大写、全大写四种形式）：
   * - {{char}} → charName
   * - {{user}} → userName
   *
   * @param text 原始文本
   * @param charName 角色名
   * @param userName 用户名
   * @returns 替换后的文本
   */
  replaceTemplates(text: string, charName: string, userName: string): string {
    if (!text) return '';

    const charPlaceholder = DEFAULT_CHAR_PLACEHOLDER;
    const userPlaceholder = DEFAULT_USER_PLACEHOLDER;

    const baseChar = charPlaceholder.replace(/[{}]/g, '').toLowerCase();
    const baseUser = userPlaceholder.replace(/[{}]/g, '').toLowerCase();

    // 构造所有大小写变体
    const variants = [
      charPlaceholder,
      `{{${baseChar}}}`,
      `{{${baseChar.charAt(0).toUpperCase()}${baseChar.slice(1)}}}`,
      `{{${baseChar.toUpperCase()}}}`,
      userPlaceholder,
      `{{${baseUser}}}`,
      `{{${baseUser.charAt(0).toUpperCase()}${baseUser.slice(1)}}}`,
      `{{${baseUser.toUpperCase()}}}`,
    ];

    const replacements = [
      charName,
      charName,
      charName.charAt(0).toUpperCase() + charName.slice(1).toLowerCase(),
      charName.toUpperCase(),
      userName,
      userName,
      userName.charAt(0).toUpperCase() + userName.slice(1).toLowerCase(),
      userName.toUpperCase(),
    ];

    let result = text;
    for (let i = 0; i < variants.length; i++) {
      result = result.replace(new RegExp(escapeRegex(variants[i]), 'gi'), replacements[i]);
    }
    return result;
  }

  /**
   * 简单语言检测：基于字符集启发式判断。
   * - 检测到平假名/片假名 → 'ja'（优先检测，因日文也含 CJK 汉字）
   * - 检测到 CJK 统一表意文字 → 'zh'
   * - 其他 → 'en'
   *
   * @param text 待检测文本
   * @returns 语言代码（'zh' | 'ja' | 'en'）
   */
  detectLanguage(text: string): string {
    if (!text) return 'en';

    // 优先检测日文（平假名 \u3040-\u309F / 片假名 \u30A0-\u30FF）
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
      return 'ja';
    }

    // CJK 统一表意文字 \u4E00-\u9FFF
    if (/[\u4E00-\u9FFF]/.test(text)) {
      return 'zh';
    }

    return 'en';
  }
}

/**
 * 转义正则表达式特殊字符。
 * 迁移自 messageProcessor.ts 的 escapeRegex 函数。
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
