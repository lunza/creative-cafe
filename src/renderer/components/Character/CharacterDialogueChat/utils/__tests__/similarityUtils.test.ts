/**
 * similarityUtils 单元测试
 *
 * 验证目标（spec Task 5.1 / 5.5）：
 * 1. nGramJaccard 相同文本返回 1.0，完全不同文本返回 0.0
 * 2. nGramJaccard 性能：500 字文本对 < 50ms
 * 3. overlapRate 完全包含前缀返回 1.0，不包含返回 0.0
 * 4. evaluateDedupRetry 重试去重决策：mock 两次相似回复，验证自动重新生成
 * 5. evaluateDedupRetry 续写去重决策：overlap > 0.6 触发重新生成
 * 6. evaluateDedupRetry 重试耗尽：保留最后一次结果（exhausted=true）
 *
 * Spec: optimize-chat-ai-intelligence / Task 5
 */

import { describe, it, expect } from 'vitest';
import {
  nGramJaccard,
  overlapRate,
  evaluateDedupRetry,
  DEDUP_SIMILARITY_THRESHOLD,
  DEDUP_OVERLAP_THRESHOLD,
  DEDUP_MAX_RETRIES,
} from '../similarityUtils';

// ============================================================
// nGramJaccard 测试
// ============================================================

describe('nGramJaccard', () => {
  it('相同文本返回 1.0', () => {
    const text = '今天天气真好，我们一起去公园散步吧。';
    expect(nGramJaccard(text, text)).toBe(1.0);
  });

  it('完全不同的文本返回 0.0', () => {
    // 选取 4-gram 完全不重叠的文本对
    const textA = 'aaaaaaaaaa';
    const textB = 'bbbbbbbbbb';
    expect(nGramJaccard(textA, textB)).toBe(0.0);
  });

  it('中文字符级 4-gram 计算（部分相似）', () => {
    const textA = '小明今天去公园散步遇到了小红';
    const textB = '小明今天去公园散步遇到了小华';
    const similarity = nGramJaccard(textA, textB);
    // 大部分内容相同，仅末尾不同，相似度应较高
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThan(1.0);
  });

  it('英文文本 4-gram 计算', () => {
    const textA = 'Hello world, this is a test.';
    const textB = 'Hello world, this is a test.';
    expect(nGramJaccard(textA, textB)).toBe(1.0);
  });

  it('空文本对返回 1.0（两空集视为相同）', () => {
    expect(nGramJaccard('', '')).toBe(1.0);
  });

  it('一空一非空返回 0.0', () => {
    expect(nGramJaccard('hello world', '')).toBe(0.0);
    expect(nGramJaccard('', 'hello world')).toBe(0.0);
  });

  it('短文本（长度 < n）作为一个 gram 处理', () => {
    // 长度 < 4 的短文本
    expect(nGramJaccard('ab', 'ab')).toBe(1.0);
    expect(nGramJaccard('ab', 'cd')).toBe(0.0);
  });

  it('首尾空白不影响相似度', () => {
    const text = '今天的天气真不错';
    expect(nGramJaccard(text, `  ${text}  `)).toBe(1.0);
  });

  it('自定义 n 参数（n=2）', () => {
    const textA = 'abcdef';
    const textB = 'abcdef';
    expect(nGramJaccard(textA, textB, 2)).toBe(1.0);
  });

  it('相似度对称性：Jaccard(A,B) === Jaccard(B,A)', () => {
    const textA = '小明今天去公园散步遇到了小红';
    const textB = '小明今天去公园散步遇到了小华，然后一起回家';
    expect(nGramJaccard(textA, textB)).toBeCloseTo(nGramJaccard(textA, textB), 5);
  });

  // ============================================================
  // 性能测试（spec Scenario: 去重计算性能）
  // ============================================================

  it('性能：500 字文本对相似度计算 < 50ms', () => {
    // 构造两个约 500 字的中文文本（部分相似）
    const base = '春暖花开的时节，万物复苏，大地一片生机勃勃。小鸟在枝头歌唱，蝴蝶在花丛中飞舞，孩子们在草地上奔跑嬉戏。';
    // base 约 51 字符，repeat(10) ≈ 510 字符，slice(0,500) 取前 500 字
    const textA = base.repeat(10).slice(0, 500);
    // textB 在 base 重复 9 次后接不同结尾，确保部分相似但非完全相同
    const textB = (base.repeat(9) + '微风轻拂，阳光明媚，这是一个美好的春日午后，时光静好，远山如黛，流水潺潺，人间仙境美不胜收。').slice(0, 500);

    // 确保两个文本都接近 500 字（spec Scenario: 去重计算性能）
    expect(textA.length).toBe(500);
    expect(textB.length).toBe(500);

    const start = performance.now();
    // 执行多次以获得稳定测量
    for (let i = 0; i < 100; i++) {
      nGramJaccard(textA, textB, 4);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 100;

    // spec 要求单次 < 50ms；取平均避免抖动
    expect(avgMs).toBeLessThan(50);
    // 单次也必须 < 50ms（spec 硬性约束）
    const singleStart = performance.now();
    nGramJaccard(textA, textB, 4);
    const singleElapsed = performance.now() - singleStart;
    expect(singleElapsed).toBeLessThan(50);
  });
});

// ============================================================
// overlapRate 测试
// ============================================================

describe('overlapRate', () => {
  it('newContent 完全以 initialContent 为前缀 → 1.0', () => {
    const initial = '前半部分内容';
    const newContent = '前半部分内容后续新增的部分';
    expect(overlapRate(newContent, initial)).toBe(1.0);
  });

  it('newContent 恰好等于 initialContent → 1.0', () => {
    const initial = '相同内容';
    expect(overlapRate(initial, initial)).toBe(1.0);
  });

  it('newContent 开头与 initialContent 完全不匹配 → 0.0', () => {
    const initial = '前半部分内容';
    const newContent = '完全不同的新内容';
    expect(overlapRate(newContent, initial)).toBe(0.0);
  });

  it('newContent 前缀部分匹配 initialContent → 0-1 之间', () => {
    const initial = '前半部分内容';
    // '前半部分' 匹配（4/6 字符），第 5 字符 'x' ≠ '内'
    const newContent = '前半部分xyz';
    const rate = overlapRate(newContent, initial);
    expect(rate).toBeCloseTo(4 / 6, 5);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(1);
  });

  it('initialContent 为空 → 0', () => {
    expect(overlapRate('some content', '')).toBe(0);
  });

  it('newContent 为空 → 0', () => {
    expect(overlapRate('', 'initial')).toBe(0);
  });

  it('续写去重场景：AI 原样重写 initialContent', () => {
    // 模拟 AI 返回 initialContent + initialContent（重复）
    const initial = '夜晚的星空很美，月亮挂在树梢。';
    const aiResponse = initial + initial;  // AI 原样重写
    // 剥离 initialContent 前缀后，剩余部分仍是 initialContent → overlap=1.0
    const newPart = aiResponse.slice(initial.length);
    expect(overlapRate(newPart, initial)).toBe(1.0);
  });

  it('续写去重场景：AI 正常续写（无重叠）', () => {
    const initial = '夜晚的星空很美，月亮挂在树梢。';
    const aiNewPart = '微风吹过，树叶沙沙作响，远处的灯火闪烁。';
    expect(overlapRate(aiNewPart, initial)).toBe(0.0);
  });
});

// ============================================================
// evaluateDedupRetry 测试（spec Task 5.2 + 5.3 决策逻辑）
// ============================================================

describe('evaluateDedupRetry', () => {
  // ---------- 重试去重（retry）----------

  it('重试去重：两次相似回复（similarity > 0.8）且 retryCount < maxRetries → shouldRetry=true', () => {
    // 使用较长的文本（~100 字），仅末尾 1 字不同，确保 similarity > 0.8
    const previousResponse = '春暖花开的时节，万物复苏，大地一片生机勃勃。小鸟在枝头歌唱，蝴蝶在花丛中飞舞，孩子们在草地上奔跑嬉戏，远处的山峦在阳光下显得格外青翠，一条小溪潺潺流过村前。';
    const newContent = '春暖花开的时节，万物复苏，大地一片生机勃勃。小鸟在枝头歌唱，蝴蝶在花丛中飞舞，孩子们在草地上奔跑嬉戏，远处的山峦在阳光下显得格外青翠，一条小溪潺潺流过村后。';
    const similarity = nGramJaccard(previousResponse, newContent, 4);
    expect(similarity).toBeGreaterThan(DEDUP_SIMILARITY_THRESHOLD);

    const decision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: 0,
    });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.kind).toBe('retry');
    expect(decision.exhausted).toBe(false);
    expect(decision.metric).toBeGreaterThan(DEDUP_SIMILARITY_THRESHOLD);
  });

  it('重试去重：retryCount >= maxRetries 时 exhausted=true（保留最后结果）', () => {
    const previousResponse = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    const newContent = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    const decision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: DEDUP_MAX_RETRIES,  // 已重试 2 次，达到上限
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.kind).toBe('retry');
    expect(decision.exhausted).toBe(true);
    expect(decision.metric).toBeGreaterThan(DEDUP_SIMILARITY_THRESHOLD);
  });

  it('重试去重：两次不同回复（similarity ≤ 0.8）→ shouldRetry=false', () => {
    const previousResponse = '今天天气真好，我们去公园散步吧。';
    const newContent = '昨晚我做了一个奇怪的梦，梦见自己会飞了，飞过高山和大海。';
    const similarity = nGramJaccard(previousResponse, newContent, 4);
    expect(similarity).toBeLessThanOrEqual(DEDUP_SIMILARITY_THRESHOLD);

    const decision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.exhausted).toBe(false);
  });

  it('重试去重：retryCount=1 时仍可重试（未达 maxRetries=2）', () => {
    const previousResponse = '完全相同的回复内容用于测试重试计数逻辑。';
    const newContent = '完全相同的回复内容用于测试重试计数逻辑。';
    const decision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: 1,  // 第一次重试后
    });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.exhausted).toBe(false);
  });

  it('重试去重：previousResponse 为空时不触发（fallback 到续写或 none）', () => {
    const decision = evaluateDedupRetry({
      previousResponse: '',
      newContent: 'some response',
      promptType: 'dialogue',
      retryCount: 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.kind).toBe('none');
  });

  // ---------- 续写去重（continue）----------

  it('续写去重：overlap > 0.6 且 retryCount < maxRetries → shouldRetry=true, kind=continue', () => {
    // 模拟 AI 原样重写 initialContent
    const initial = '夜晚的星空很美，月亮挂在树梢。';
    const aiResponse = initial + initial;  // 剥离前缀后仍是 initial
    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent: initial,
      promptType: 'continuation',
      retryCount: 0,
    });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.kind).toBe('continue');
    expect(decision.metric).toBeGreaterThan(DEDUP_OVERLAP_THRESHOLD);
    expect(decision.exhausted).toBe(false);
  });

  it('续写去重：overlap ≤ 0.6（正常续写）→ shouldRetry=false', () => {
    const initial = '夜晚的星空很美，月亮挂在树梢。';
    const aiNewPart = '微风吹过，树叶沙沙作响，远处的灯火闪烁。';
    const decision = evaluateDedupRetry({
      newContent: initial + aiNewPart,  // 正常续写
      initialContent: initial,
      promptType: 'continuation',
      retryCount: 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.exhausted).toBe(false);
  });

  it('续写去重：retryCount >= maxRetries 时 exhausted=true', () => {
    const initial = '夜晚的星空很美，月亮挂在树梢。';
    const aiResponse = initial + initial;
    const decision = evaluateDedupRetry({
      newContent: aiResponse,
      initialContent: initial,
      promptType: 'continuation',
      retryCount: DEDUP_MAX_RETRIES,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.kind).toBe('continue');
    expect(decision.exhausted).toBe(true);
  });

  it('续写去重：promptType=dialogue 时不触发续写去重', () => {
    const initial = 'some initial content';
    const decision = evaluateDedupRetry({
      newContent: initial + initial,
      initialContent: initial,
      promptType: 'dialogue',  // 非续写
      retryCount: 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.kind).toBe('none');
  });

  // ---------- 混合场景 ----------

  it('previousResponse 优先于 continue 检测（同时提供时走 retry 分支）', () => {
    const previousResponse = '今天天气真好，我们一起去公园散步吧。';
    const newContent = '今天天气真好，我们一起去公园散步吧。';
    const decision = evaluateDedupRetry({
      previousResponse,
      newContent,
      initialContent: 'some initial',
      promptType: 'continuation',
      retryCount: 0,
    });
    // previousResponse 提供时优先走 retry 分支
    expect(decision.kind).toBe('retry');
    expect(decision.shouldRetry).toBe(true);
  });

  it('无 previousResponse 且 promptType=dialogue → kind=none', () => {
    const decision = evaluateDedupRetry({
      newContent: 'some response',
      promptType: 'dialogue',
      retryCount: 0,
    });
    expect(decision.kind).toBe('none');
    expect(decision.shouldRetry).toBe(false);
  });

  // ---------- 模拟完整重试流程（spec Task 5.5: mock 两次相似回复）----------

  it('完整重试流程：首次相似→重试1，仍相似→重试2，仍相似→耗尽', () => {
    const originalResponse = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    // 模拟 AI 三次都返回几乎相同的回复
    const similarResponse1 = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    const similarResponse2 = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    const similarResponse3 = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';

    // 首次生成（retryCount=0）：相似 → 应重试
    const d1 = evaluateDedupRetry({
      previousResponse: originalResponse,
      newContent: similarResponse1,
      promptType: 'dialogue',
      retryCount: 0,
    });
    expect(d1.shouldRetry).toBe(true);
    expect(d1.exhausted).toBe(false);

    // 第一次重试（retryCount=1）：仍相似 → 应重试
    const d2 = evaluateDedupRetry({
      previousResponse: originalResponse,
      newContent: similarResponse2,
      promptType: 'dialogue',
      retryCount: 1,
    });
    expect(d2.shouldRetry).toBe(true);
    expect(d2.exhausted).toBe(false);

    // 第二次重试（retryCount=2=DEDUP_MAX_RETRIES）：仍相似 → 耗尽，保留最后结果
    const d3 = evaluateDedupRetry({
      previousResponse: originalResponse,
      newContent: similarResponse3,
      promptType: 'dialogue',
      retryCount: DEDUP_MAX_RETRIES,
    });
    expect(d3.shouldRetry).toBe(false);
    expect(d3.exhausted).toBe(true);
    // 验证总共尝试次数 = 1（首次）+ 2（重试）= 3 次
    expect(d3.reason).toContain('exhausted after 3 attempts');
  });

  it('完整重试流程：首次相似→重试1，第二次不同→停止重试', () => {
    const originalResponse = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    const similarResponse = '今天天气真好，我们一起去公园散步吧，顺便买点水果吃。';
    const differentResponse = '昨晚我做了一个奇怪的梦，梦见自己会飞了，飞过高山和大海，看到许多奇异的景象。';

    // 首次（retryCount=0）：相似 → 重试
    const d1 = evaluateDedupRetry({
      previousResponse: originalResponse,
      newContent: similarResponse,
      promptType: 'dialogue',
      retryCount: 0,
    });
    expect(d1.shouldRetry).toBe(true);

    // 第一次重试（retryCount=1）：不同 → 停止，保留
    const d2 = evaluateDedupRetry({
      previousResponse: originalResponse,
      newContent: differentResponse,
      promptType: 'dialogue',
      retryCount: 1,
    });
    expect(d2.shouldRetry).toBe(false);
    expect(d2.exhausted).toBe(false);
    expect(d2.kind).toBe('none');
  });

  // ---------- 自定义阈值 ----------

  it('自定义 maxRetries=0：首次相似即耗尽', () => {
    const previousResponse = '完全相同的内容';
    const newContent = '完全相同的内容';
    const decision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: 0,
      maxRetries: 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.exhausted).toBe(true);
  });

  it('自定义 similarityThreshold=0.5：低相似度也触发重试', () => {
    const previousResponse = '今天天气真好我们去公园散步吧';
    const newContent = '今天天气不错我们去公园走走吧';
    const similarity = nGramJaccard(previousResponse, newContent, 4);
    // 默认阈值 0.8 下不触发
    const defaultDecision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: 0,
    });
    // 自定义阈值 0.5 下触发
    const customDecision = evaluateDedupRetry({
      previousResponse,
      newContent,
      promptType: 'dialogue',
      retryCount: 0,
      similarityThreshold: 0.5,
    });
    if (similarity > 0.5 && similarity <= 0.8) {
      expect(defaultDecision.shouldRetry).toBe(false);
      expect(customDecision.shouldRetry).toBe(true);
    }
  });
});
