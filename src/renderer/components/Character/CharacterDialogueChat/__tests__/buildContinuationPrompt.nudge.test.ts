/**
 * buildContinuationPrompt continue_nudge_prompt 注入测试
 *
 * 验证目标（spec Task 8.1 + 8.2 + 8.3 + Scenario: 续写去重）：
 *   1. buildContinuationPrompt 返回的内容包含 continue_nudge_prompt 文本（SubTask 8.1 / 8.3 测试 1）
 *      - 硬编码回退路径含 nudge 段落
 *      - 模板系统路径含 nudge 段落
 *      - nudge 文本与 spec 原文一致
 *      - nudge 段落位于 prompt 末尾
 *      - 不同 organizeMode 都含 nudge
 *   2. continueConversation 在 overlapRate > 0.6 时触发重新生成（SubTask 8.2 / 8.3 测试 2）
 *      - 通过 evaluateDedupRetry 纯函数验证续写去重决策
 *      - 验证 maxRetries=2 限制与耗尽场景
 *      - 验证触发时 injectContinueNudge 标志的语义（ DedupConfig 传递）
 *   3. 重新生成的 prompt 含 continue_nudge_prompt（SubTask 8.3 测试 3）
 *      - 多次调用 buildContinuationPrompt（模拟首次与重试）都含 nudge（纯函数特性）
 *      - 验证 nudge 在每次重试调用中都存在
 *
 * Spec: optimize-chat-ai-intelligence / Task 8.1 + 8.2 + 8.3 + Scenario: 续写去重
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildContinuationPrompt,
  buildContinueNudgePrompt,
} from '../PromptBuilder';
import type { CharacterInfoForPrompt } from '../PromptBuilder';
import type { UserPersona } from '../CharacterDialogueChat.types';
import {
  evaluateDedupRetry,
  overlapRate,
  DEDUP_OVERLAP_THRESHOLD,
  DEDUP_MAX_RETRIES,
} from '../utils/similarityUtils';

// ==================== Mock 配置 ====================

// buildContinuationPrompt 内部调用 window.electronAPI.prompt.build，
// 通过 mock 控制走模板路径还是硬编码回退路径。
const promptBuildMock = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    prompt: {
      build: promptBuildMock,
    },
  },
});

// 静音 console.error（回退路径会打印模板获取失败日志）
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
// 静音 console.log（buildFinalSystemPrompt 等会打印 debug 日志）
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

// ==================== 测试用角色卡 fixture ====================

const characterInfo: CharacterInfoForPrompt = {
  characterCardName: '艾莉娅',
  personality: '冷静、睿智、话不多',
  characterCardContent: '一位来自北方的女法师',
  scenario: '寒夜篝火旁',
  mes_example: '',
  system_prompt: '',
  creator_notes: '',
};

const persona: UserPersona = {
  id: 'p1',
  name: '旅人',
  description: '一位迷路的旅人',
  avatarPath: '',
  createdAt: 0,
  updatedAt: 0,
};

// spec 原文约定的 continue_nudge_prompt 文本
const NUDGE_PROMPT_TEXT = '[Continue your last message without repeating its original content.]';

describe('Task 8.1: buildContinuationPrompt 末尾追加 continue_nudge_prompt', () => {
  beforeEach(() => {
    promptBuildMock.mockReset();
  });

  it('硬编码回退路径：返回内容包含 continue_nudge_prompt 文本', async () => {
    // mock 模板获取失败 → 走硬编码回退路径
    promptBuildMock.mockResolvedValue({ success: false, error: 'template not found' });

    const prompt = await buildContinuationPrompt(characterInfo, persona);

    expect(prompt).toContain(NUDGE_PROMPT_TEXT);
  });

  it('模板系统路径：返回内容包含 continue_nudge_prompt 文本', async () => {
    // mock 模板获取成功 → 走模板路径
    promptBuildMock.mockResolvedValue({
      success: true,
      data: { systemPrompt: '【模板续写提示词】这是模板系统返回的续写 prompt。' },
    });

    const prompt = await buildContinuationPrompt(characterInfo, persona);

    expect(prompt).toContain(NUDGE_PROMPT_TEXT);
    // 模板原始内容也应保留
    expect(prompt).toContain('【模板续写提示词】');
  });

  it('nudge 段落格式正确：包含【续写去重约束】前缀', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona);

    expect(prompt).toContain('【续写去重约束】');
    expect(prompt).toContain(NUDGE_PROMPT_TEXT);
  });

  it('nudge 段落位于 prompt 末尾', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona);

    // nudge 文本应位于 prompt 末尾区域（最后 200 字符内）
    const tail = prompt.slice(-200);
    expect(tail).toContain(NUDGE_PROMPT_TEXT);
  });

  it('nudge 文本与 spec 原文一致：[Continue your last message without repeating its original content.]', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona);

    // spec Scenario: 续写去重 明确约定的文本
    expect(prompt).toContain('[Continue your last message without repeating its original content.]');
  });

  it('organizeMode=async 时也包含 nudge 段落', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona, 'async');

    expect(prompt).toContain(NUDGE_PROMPT_TEXT);
    // async 模式特有的 tableEdit 指令也应存在（验证 organizeMode 参数正常传递）
    expect(prompt).toContain('tableEdit');
  });

  it('organizeMode=sync 时也包含 nudge 段落', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona, 'sync');

    expect(prompt).toContain(NUDGE_PROMPT_TEXT);
  });

  it('organizeMode 缺省（undefined）时也包含 nudge 段落', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona);

    expect(prompt).toContain(NUDGE_PROMPT_TEXT);
  });

  it('nudge 段落由 buildContinueNudgePrompt() 提供文本（一致性）', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const prompt = await buildContinuationPrompt(characterInfo, persona);
    const nudgeFromHelper = buildContinueNudgePrompt();

    // buildContinuationPrompt 中的 nudge 文本必须与 buildContinueNudgePrompt() 返回值一致
    expect(prompt).toContain(nudgeFromHelper);
  });
});

describe('Task 8.2: continueConversation 重叠率触发重新生成', () => {
  // 注：continueConversation 的 onComplete 回调依赖 React Hook 与 ChatEngine，
  // 难以直接单元测试。这里通过 evaluateDedupRetry 纯函数（hooks.ts 共用）验证
  // 续写去重决策逻辑：overlapRate > 0.6 时触发重试，maxRetries=2 限制。

  it('overlapRate > 0.6 时触发重新生成（shouldRetry=true, kind=continue）', () => {
    // 场景：AI 原样重写 initialContent（剥离前缀后 newPart 仍以 initialContent 开头）
    const initialContent = '艾莉娅凝视着篝火';
    const aiResponse = initialContent + initialContent; // AI 把 initialContent 又写了一遍
    const newPart = aiResponse.slice(initialContent.length); // 剥离前缀后 = initialContent
    const overlap = overlapRate(newPart, initialContent);
    expect(overlap).toBe(1.0); // 完全重叠

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: 0,
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.kind).toBe('continue');
    expect(decision.metric).toBeGreaterThan(DEDUP_OVERLAP_THRESHOLD);
    expect(decision.exhausted).toBe(false);
  });

  it('overlapRate <= 0.6 时不触发重新生成', () => {
    // 场景：AI 正常续写，新内容与 initialContent 无重叠
    const initialContent = '艾莉娅凝视着篝火';
    const aiResponse = initialContent + '，火光在她眼中跳跃。'; // 正常续写

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: 0,
    });

    expect(decision.shouldRetry).toBe(false);
    expect(decision.kind).toBe('none');
  });

  it('retryCount=0 时首次触发重新生成', () => {
    const initialContent = '前文内容';
    const aiResponse = initialContent + initialContent;

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: 0,
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.exhausted).toBe(false);
  });

  it('retryCount=1 时仍可触发第 2 次重试', () => {
    const initialContent = '前文内容';
    const aiResponse = initialContent + initialContent;

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: 1,
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.exhausted).toBe(false);
  });

  it(`retryCount=${DEDUP_MAX_RETRIES} 时重试耗尽（exhausted=true, shouldRetry=false）`, () => {
    const initialContent = '前文内容';
    const aiResponse = initialContent + initialContent;

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: DEDUP_MAX_RETRIES, // 已重试 2 次，达到上限
    });

    // 耗尽：保留最后一次结果，不再重试
    expect(decision.shouldRetry).toBe(false);
    expect(decision.exhausted).toBe(true);
    expect(decision.kind).toBe('continue');
  });

  it('总生成次数上限 = 1（首次）+ 2（重试）= 3 次', () => {
    // 验证 spec Scenario: 重试去重 "自动重新生成（最多 2 次）"
    // retryCount: 0→1（第1次重试）, 1→2（第2次重试）, 2→exhausted
    const initialContent = '前文内容';
    const aiResponse = initialContent + initialContent;

    // 首次（retryCount=0）
    const d0 = evaluateDedupRetry({
      newContent: aiResponse, initialContent, promptType: 'continuation', retryCount: 0,
    });
    expect(d0.shouldRetry).toBe(true);

    // 第 1 次重试后（retryCount=1）
    const d1 = evaluateDedupRetry({
      newContent: aiResponse, initialContent, promptType: 'continuation', retryCount: 1,
    });
    expect(d1.shouldRetry).toBe(true);

    // 第 2 次重试后（retryCount=2，达到 maxRetries）
    const d2 = evaluateDedupRetry({
      newContent: aiResponse, initialContent, promptType: 'continuation', retryCount: 2,
    });
    expect(d2.shouldRetry).toBe(false);
    expect(d2.exhausted).toBe(true);
  });

  it('续写去重不依赖 previousResponse（与重试去重区分）', () => {
    // 续写场景：即使没有 previousResponse，只要有 initialContent + overlap > 0.6 就触发
    const initialContent = '前文内容';
    const aiResponse = initialContent + initialContent;

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: 0,
      // 故意不传 previousResponse
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.kind).toBe('continue');
  });

  it('触发续写去重时，hooks.ts 应设置 injectContinueNudge=true（语义验证）', () => {
    // 注：injectContinueNudge 是 hooks.ts::onComplete 中的 DedupConfig 字段，
    // 由 evaluateDedupRetry 决策驱动。这里验证决策正确性，DedupConfig 传递由集成保证。
    const initialContent = '前文内容';
    const aiResponse = initialContent + initialContent;

    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent,
      promptType: 'continuation',
      retryCount: 0,
    });

    // 决策应为"续写去重重试"，对应 hooks.ts 中 nextDedupConfig = { retryCount+1, injectContinueNudge: true }
    expect(decision.shouldRetry).toBe(true);
    expect(decision.kind).toBe('continue');
    // injectContinueNudge=true 的语义：重试时在消息数组末尾追加 nudge system 消息
    // （SubTask 8.3 测试 3 验证重试调用的 prompt 也含 nudge）
  });
});

describe('Task 8.3: 重新生成的 prompt 含 continue_nudge_prompt', () => {
  beforeEach(() => {
    promptBuildMock.mockReset();
  });

  it('首次调用 buildContinuationPrompt 含 nudge 段落', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const firstCall = await buildContinuationPrompt(characterInfo, persona);

    expect(firstCall).toContain(NUDGE_PROMPT_TEXT);
  });

  it('重试调用 buildContinuationPrompt 仍含 nudge 段落（纯函数特性）', async () => {
    // 模拟 continueConversation 触发重试：requestAIResponse 重新进入会再次调用 buildContinuationPrompt
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const firstCall = await buildContinuationPrompt(characterInfo, persona);
    const retryCall1 = await buildContinuationPrompt(characterInfo, persona);
    const retryCall2 = await buildContinuationPrompt(characterInfo, persona);

    // 每次调用都应包含 nudge 段落（spec SubTask 8.2: 重新构建 prompt 含 continue_nudge_prompt）
    expect(firstCall).toContain(NUDGE_PROMPT_TEXT);
    expect(retryCall1).toContain(NUDGE_PROMPT_TEXT);
    expect(retryCall2).toContain(NUDGE_PROMPT_TEXT);
  });

  it('模板路径与硬编码路径的 nudge 段落文本一致', async () => {
    // 模板路径
    promptBuildMock.mockResolvedValue({
      success: true,
      data: { systemPrompt: '模板 prompt 内容' },
    });
    const fromTemplate = await buildContinuationPrompt(characterInfo, persona);

    // 硬编码回退路径
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });
    const fromFallback = await buildContinuationPrompt(characterInfo, persona);

    // 两条路径的 nudge 段落文本应一致（都来自 buildContinueNudgePrompt()）
    expect(fromTemplate).toContain(NUDGE_PROMPT_TEXT);
    expect(fromFallback).toContain(NUDGE_PROMPT_TEXT);
    // 验证 nudge 段落（前缀 + 文本）在两条路径中都出现
    expect(fromTemplate).toContain(`【续写去重约束】\n${NUDGE_PROMPT_TEXT}`);
    expect(fromFallback).toContain(`【续写去重约束】\n${NUDGE_PROMPT_TEXT}`);
  });

  it('重试场景：模拟首次 + 2 次重试，3 次调用都含 nudge 段落', async () => {
    // 完整模拟 spec Scenario: 续写去重的重试流程
    // continueConversation → requestAIResponse (含 nudge)
    //   → overlap > 0.6 → 重试 1 (重新构建 prompt，含 nudge)
    //     → overlap > 0.6 → 重试 2 (重新构建 prompt，含 nudge)
    //       → overlap > 0.6 → 耗尽，保留最后结果
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const initialCall = await buildContinuationPrompt(characterInfo, persona);
    const retry1Call = await buildContinuationPrompt(characterInfo, persona);
    const retry2Call = await buildContinuationPrompt(characterInfo, persona);

    // 验证 SubTask 8.2 关键约束：重新生成的 prompt 含 continue_nudge_prompt
    expect(initialCall).toContain(NUDGE_PROMPT_TEXT);
    expect(retry1Call).toContain(NUDGE_PROMPT_TEXT);
    expect(retry2Call).toContain(NUDGE_PROMPT_TEXT);

    // 验证 nudge 段落格式在所有调用中一致
    const nudgeSection = `【续写去重约束】\n${NUDGE_PROMPT_TEXT}`;
    expect(initialCall).toContain(nudgeSection);
    expect(retry1Call).toContain(nudgeSection);
    expect(retry2Call).toContain(nudgeSection);
  });

  it('nudge 段落始终位于 prompt 末尾区域（重试调用一致性）', async () => {
    promptBuildMock.mockResolvedValue({ success: false, error: 'not configured' });

    const calls = await Promise.all([
      buildContinuationPrompt(characterInfo, persona),
      buildContinuationPrompt(characterInfo, persona),
      buildContinuationPrompt(characterInfo, persona),
    ]);

    calls.forEach((prompt) => {
      const tail = prompt.slice(-200);
      expect(tail).toContain(NUDGE_PROMPT_TEXT);
    });
  });
});

afterEach(() => {
  consoleErrorSpy.mockClear();
  consoleLogSpy.mockClear();
});
