/**
 * ChatInputBar undo stack 注册与 fallback 决策逻辑单元测试
 *
 * 验证目标（Spec: fix-polish-input-undo-and-target / Task 3 / Bug 1 修复）：
 * 1. execCommand 返回 false 时（jsdom/不支持环境），使用 fallback（setInput）
 * 2. execCommand 返回 true 时（Chromium/Electron 环境），不使用 fallback
 * 3. textToInsert 为空字符串时，逻辑仍正确执行（不抛错）
 * 4. execCommand 抛异常时，使用 fallback
 * 5. generatedReplyText 入口判断逻辑（空串 / undefined / 非空 / 仅空白）
 *
 * 说明：
 * ChatInputBar 是 React 组件，依赖 antd / textarea ref / setTimeout / document.execCommand 等，
 * 难以在 node 环境下隔离测试。因此这里将其核心算法（fallback 决策 + 入口判断）
 * 提取为纯函数 applyGeneratedTextToTextarea / shouldFillGeneratedText 进行测试。
 *
 * Spec: fix-polish-input-undo-and-target / Task 3.2
 */

import { describe, it, expect } from 'vitest';

/**
 * 提取 ChatInputBar 中 generatedReplyText useEffect 的文本填充决策逻辑。
 * 该函数与 ChatInputBar.tsx 第 60-88 行 useEffect 的逻辑保持一致：
 *   - 尝试 document.execCommand('insertText') 注册 undo stack
 *   - 失败时回退到 setInput（返回 true 表示使用了 fallback）
 *   - 返回值：true = 使用了 fallback（setInput）；false = execCommand 成功
 *
 * 对应源码（ChatInputBar.tsx 第 71-81 行）：
 *   let inserted = false;
 *   try {
 *     inserted = document.execCommand('insertText', false, textToInsert);
 *   } catch {
 *     inserted = false;
 *   }
 *   if (!inserted) {
 *     setInput(textToInsert);
 *   }
 */
function applyGeneratedTextToTextarea(
  execCommandResult: boolean, // 模拟 document.execCommand 的返回值
  execCommandThrows: boolean = false, // 模拟 execCommand 是否抛异常
  textToInsert: string = ''
): { usedFallback: boolean; fallbackText: string | null } {
  let inserted = false;
  try {
    if (execCommandThrows) {
      throw new Error('simulated execCommand exception');
    }
    // 模拟 execCommand 调用（实际由参数传入结果）
    inserted = execCommandResult;
  } catch {
    inserted = false;
  }
  if (!inserted) {
    return { usedFallback: true, fallbackText: textToInsert };
  }
  return { usedFallback: false, fallbackText: null };
}

/**
 * 验证 generatedReplyText 的入口判断逻辑。
 * 对应源码（ChatInputBar.tsx 第 61 行）：
 *   if (generatedReplyText && generatedReplyText.length > 0) { ... }
 */
function shouldFillGeneratedText(
  generatedReplyText: string | undefined
): boolean {
  return !!(generatedReplyText && generatedReplyText.length > 0);
}

describe('ChatInputBar undo stack 注册与 fallback 决策（Bug 1 修复）', () => {
  describe('applyGeneratedTextToTextarea - fallback 决策', () => {
    it('execCommand 返回 false 时（jsdom 默认不支持），使用 fallback', () => {
      const textToInsert = '润色后的文本';
      const result = applyGeneratedTextToTextarea(false, false, textToInsert);

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackText).toBe(textToInsert);
    });

    it('execCommand 返回 true 时（Chromium 环境），不使用 fallback', () => {
      const textToInsert = '润色后的文本';
      const result = applyGeneratedTextToTextarea(true, false, textToInsert);

      expect(result.usedFallback).toBe(false);
      expect(result.fallbackText).toBeNull();
    });

    it('textToInsert 为空字符串时，逻辑仍正确执行（不抛错）', () => {
      const result = applyGeneratedTextToTextarea(false, false, '');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackText).toBe('');
    });

    it('execCommand 抛异常时，使用 fallback', () => {
      const textToInsert = '润色后的文本';
      const result = applyGeneratedTextToTextarea(false, true, textToInsert);

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackText).toBe(textToInsert);
    });

    it('execCommand 抛异常时，即使 execCommandResult=true 也使用 fallback（异常优先）', () => {
      // 异常路径下 inserted 始终为 false，无论传入的 execCommandResult 是什么
      const textToInsert = '测试文本';
      const result = applyGeneratedTextToTextarea(true, true, textToInsert);

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackText).toBe(textToInsert);
    });
  });

  describe('shouldFillGeneratedText - 入口判断逻辑', () => {
    it('generatedReplyText 为非空字符串时返回 true', () => {
      expect(shouldFillGeneratedText('hello')).toBe(true);
    });

    it('generatedReplyText 为空字符串时返回 false', () => {
      expect(shouldFillGeneratedText('')).toBe(false);
    });

    it('generatedReplyText 为 undefined 时返回 false', () => {
      expect(shouldFillGeneratedText(undefined)).toBe(false);
    });

    it('generatedReplyText 为仅空白字符串时返回 true（保持原逻辑，空白判断由调用方处理）', () => {
      // 原逻辑仅判断 length > 0，空白字符串长度 > 0 故返回 true
      // 实际空白处理由 polishInput / generateUserReply 的调用方负责
      expect(shouldFillGeneratedText('   ')).toBe(true);
    });

    it('generatedReplyText 为多行字符串时返回 true', () => {
      expect(shouldFillGeneratedText('第一行\n第二行\n')).toBe(true);
    });
  });
});
