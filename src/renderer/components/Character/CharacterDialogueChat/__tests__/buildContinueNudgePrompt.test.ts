/**
 * buildContinueNudgePrompt 单元测试
 *
 * 验证目标（spec Task 5.4 / 5.5）：
 * 1. 返回 continue_nudge_prompt 字符串
 * 2. 内容与 spec 一致：[Continue your last message without repeating its original content.]
 * 3. 多次调用返回相同结果（纯函数无副作用）
 *
 * Task 8（SubTask 8.1/8.2）将完善提示词内容并在 buildContinuationPrompt 末尾追加；
 * 本测试覆盖 Task 5 占位实现。
 *
 * Spec: optimize-chat-ai-intelligence / Task 5.4 + Scenario: 续写去重
 */

import { describe, it, expect } from 'vitest';
import { buildContinueNudgePrompt } from '../PromptBuilder';

describe('buildContinueNudgePrompt', () => {
  it('返回非空字符串', () => {
    const prompt = buildContinueNudgePrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('内容与 spec 一致：[Continue your last message without repeating its original content.]', () => {
    const prompt = buildContinueNudgePrompt();
    // spec 原文（Scenario: 续写去重）
    expect(prompt).toBe('[Continue your last message without repeating its original content.]');
  });

  it('多次调用返回相同结果（纯函数）', () => {
    const a = buildContinueNudgePrompt();
    const b = buildContinueNudgePrompt();
    const c = buildContinueNudgePrompt();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('提示词包含 "Continue" 与 "without repeating" 关键语义', () => {
    const prompt = buildContinueNudgePrompt();
    expect(prompt.toLowerCase()).toContain('continue');
    expect(prompt.toLowerCase()).toContain('without repeating');
  });
});
