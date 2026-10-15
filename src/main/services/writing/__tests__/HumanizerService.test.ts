/**
 * HumanizerService 单元测试（独立接口，仅适配 jialinyyzz/humanizer 模型）
 *
 * 核心验证：prompt 拼装必须逐字节符合官方规范——
 * 官方自测值：draft="X" 时 prompt 的 sha256 前 16 hex 必须为 cc51d66b4c593fbe。
 * 该值一旦不符说明指令串/分隔串被改动，模型输出将全部失效。
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { buildHumanizerPrompt, splitIntoChunks, HUMANIZER_INSTR, HUMANIZER_SEP } from '../HumanizerService';

describe('buildHumanizerPrompt 字节级规范', () => {
  it('官方自测值：draft="X" 时 sha256 前 16 hex = cc51d66b4c593fbe', () => {
    const hash = createHash('sha256').update(buildHumanizerPrompt('X'), 'utf8').digest('hex').slice(0, 16);
    expect(hash).toBe('cc51d66b4c593fbe');
  });

  it('prompt 结构 = INSTR + "\\n\\n" + draft.strip() + SEP（draft 首尾空白被去除）', () => {
    const prompt = buildHumanizerPrompt('  正文内容  ');
    expect(prompt).toBe(HUMANIZER_INSTR + '\n\n' + '正文内容' + HUMANIZER_SEP);
    expect(prompt.endsWith('### Rewritten:\n\n')).toBe(true);
  });
});

describe('splitIntoChunks 段落切分', () => {
  it('短文本单块返回', () => {
    expect(splitIntoChunks('第一段。\n\n第二段。')).toEqual(['第一段。\n\n第二段。']);
  });

  it('长文本按段落边界装箱（单块 ≤ 4000 字），不切断段落', () => {
    const para = '字'.repeat(3000);
    const text = [para, para, para].join('\n\n'); // 3 段 × 3000 字；两段合并 6002 > 4000 装不下
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length === 3000)).toBe(true);
    // 能合并的场景：1500 字段落两两合并（1500+2+1500=3002 ≤ 4000）
    const small = '字'.repeat(1500);
    const chunks2 = splitIntoChunks([small, small, small, small].join('\n\n'));
    expect(chunks2.length).toBe(2);
    expect(chunks2[0].length).toBe(3002);
  });

  it('单段落超长时硬切', () => {
    const text = '字'.repeat(9000);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(4000);
    expect(chunks[2].length).toBe(1000);
  });

  it('空段落被过滤，全空文本返回原文单块（不丢内容）', () => {
    expect(splitIntoChunks('  \n\n  ')).toEqual(['  \n\n  ']);
  });
});
