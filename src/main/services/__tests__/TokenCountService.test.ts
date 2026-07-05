/**
 * TokenCountService 测试
 *
 * 验证目标（spec Task 1.5）：
 * 1. cl100k_base 编码器加载成功
 * 2. 对 5 段中文文本（100/500/1000/2000/5000 字）返回合理 token 数
 * 3. 加载失败时不抛错，回退字节估算
 *
 * ⚠️ 重要发现（实测，与 spec 假设不符）：
 *   spec 假设中文 cl100k_base 约 0.5-0.7 token/字、字节估算误差 ±15%。
 *   实测 cl100k_base 对中文约 1.3-1.4 token/字（中文 BPE 切分较碎），
 *   字节估算（UTF-8 字节 / 3.35 ≈ 0.9 token/字）反而低估约 35-50%。
 *   这正是接入 cl100k_base 的价值：原本低估的预算被精确化，避免上下文超限。
 *   （后续 Task 2 重写 ContextTruncator 时需基于真实 cl100k_base 数值重新校准预算。）
 *
 * 注：无法联网对比在线服务，仅验证本地行为合理性。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenCountService } from '../TokenCountService';

/**
 * 生成指定长度的中文测试文本（混合标点与字符，模拟真实对话）。
 */
function makeChineseText(charCount: number): string {
  const sample =
    '在一个安静的小镇上，有一家名叫"创想咖啡厅"的小店。' +
    '店主是一位温柔的女子，她喜欢听来往客人讲述自己的故事。' +
    '每天清晨，阳光透过窗户洒在木质吧台上，咖啡的香气弥漫在空气中。' +
    '客人们或独自品茶，或三五成群地交谈，每个人的脸上都洋溢着不同的表情。' +
    '有人欢笑，有人沉思，有人轻轻叹息，仿佛整个世界都浓缩在这间小小的咖啡馆里。';
  let text = '';
  while (text.length < charCount) {
    text += sample;
  }
  return text.slice(0, charCount);
}

describe('TokenCountService', () => {
  let service: TokenCountService;

  beforeEach(() => {
    service = new TokenCountService();
  });

  // ========== 1. 编码器加载 ==========
  describe('Encoder loading', () => {
    it('warmup() should load cl100k_base encoder successfully', async () => {
      await service.warmup();
      expect(service.isReady()).toBe(true);
      expect(service.isFallbackMode()).toBe(false);
    });

    it('after warmup, isReady() should remain true on subsequent calls', async () => {
      await service.warmup();
      const before = service.isReady();
      await service.warmup();
      const after = service.isReady();
      expect(before).toBe(true);
      expect(after).toBe(true);
    });
  });

  // ========== 2. 中文文本精确计数 ==========
  describe('Chinese text token counting', () => {
    const testCases = [
      { chars: 100, label: '100 chars' },
      { chars: 500, label: '500 chars' },
      { chars: 1000, label: '1000 chars' },
      { chars: 2000, label: '2000 chars' },
      { chars: 5000, label: '5000 chars' },
    ];

    for (const tc of testCases) {
      it(`should count ${tc.label} Chinese text within reasonable range (1.0-1.6 token/char)`, async () => {
        await service.warmup();
        const text = makeChineseText(tc.chars);
        const tokens = service.countTokens(text);

        // 基本断言
        expect(tokens).toBeGreaterThan(0);
        expect(typeof tokens).toBe('number');

        // ⚠️ 实测 cl100k_base 对中文约 1.3-1.4 token/字。
        // 给较宽的容差 1.0-1.6，避免标点比例差异导致 flaky。
        const ratio = tokens / tc.chars;
        expect(ratio).toBeGreaterThanOrEqual(1.0);
        expect(ratio).toBeLessThanOrEqual(1.6);

        console.log(`[test] ${tc.label}: ${tokens} tokens, ratio=${ratio.toFixed(3)} token/char`);
      });
    }

    it('countTokensBatch should match individual countTokens calls', async () => {
      await service.warmup();
      const texts = testCases.map((tc) => makeChineseText(tc.chars));
      const batchResults = service.countTokensBatch(texts);
      const individualResults = texts.map((t) => service.countTokens(t));
      expect(batchResults).toEqual(individualResults);
      expect(batchResults).toHaveLength(testCases.length);
    });

    it('should return 0 for empty string', async () => {
      await service.warmup();
      expect(service.countTokens('')).toBe(0);
    });

    it('should handle mixed Chinese-English text without error', async () => {
      await service.warmup();
      const mixed = 'Hello world! 你好世界！Mixed 混合文本 with English。';
      const tokens = service.countTokens(mixed);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  // ========== 3. 字节估算 fallback ==========
  describe('Fallback behavior', () => {
    it('countTokens should still return a value before warmup (fallback path)', () => {
      // 不调用 warmup，编码器尚未就绪，应返回字节估算（不抛错）
      const text = '这是一段中文测试文本，用于验证 fallback 路径。';
      const tokens = service.countTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });

    it('countTokensBatch should return results even without warmup', () => {
      const texts = ['文本一', '文本二', '文本三'];
      const results = service.countTokensBatch(texts);
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r).toBeGreaterThan(0);
      }
    });

    it('countTokens value before warmup should be a byte-estimate (close to length/3.35)', () => {
      const text = 'aaaa'; // 4 ASCII 字符 = 4 字节 -> 4/3.35 ≈ 1.19 -> ceil = 2
      const tokens = service.countTokens(text);
      // fallback 路径：ceil(4 / 3.35) = 2
      expect(tokens).toBe(2);
    });
  });

  // ========== 4. 真实场景对比：精确 vs 字节估算 ==========
  describe('Precision comparison', () => {
    it('precise count should be HIGHER than byte estimate for Chinese text (cl100k_base 切分更碎)', async () => {
      // ⚠️ 关键发现：cl100k_base 对中文的 token 数显著高于字节估算。
      // 这意味着接入精确计数后，相同文本的 token 预算消耗会上升，
      // 之前的字节估算实际低估了真实 token 占用，导致 ContextTruncator 可能让上下文超限。
      const preciseService = new TokenCountService();
      await preciseService.warmup();

      const text = makeChineseText(1000);

      // 字节估算（独立 service，未 warmup）
      const fallbackService = new TokenCountService();
      const fallbackTokens = fallbackService.countTokens(text);

      // 精确计数
      const preciseTokens = preciseService.countTokens(text);

      console.log(
        `[test] 1000-char Chinese: precise=${preciseTokens}, fallback=${fallbackTokens}, ` +
        `diff=${((preciseTokens - fallbackTokens) / fallbackTokens * 100).toFixed(1)}%`
      );

      // 两者应该都是正数
      expect(preciseTokens).toBeGreaterThan(0);
      expect(fallbackTokens).toBeGreaterThan(0);
      // 关键断言：精确值 > 字节估算（中文 cl100k_base 切分更碎）
      // 这验证了接入精确计数的必要性
      expect(preciseTokens).toBeGreaterThan(fallbackTokens);
    });
  });
});
