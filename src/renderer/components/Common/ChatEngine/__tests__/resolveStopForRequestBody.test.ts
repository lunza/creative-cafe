/**
 * resolveStopForRequestBody 单元测试
 *
 * 验证目标（spec Task 3.5 场景 3）：
 *   supportsStopArray=false 时 ChatEngine 传字符串而非数组
 *
 * 同时覆盖：
 *   - supportsStopArray=true（默认）传数组
 *   - stopSequences 为空 / 缺省时不注入（返回 undefined）
 *
 * Spec: optimize-chat-ai-intelligence / Task 3
 */

import { describe, it, expect } from 'vitest';
import { resolveStopForRequestBody, EngineCapabilities } from '../ChatEngine.types';
import { buildStopSequences } from '../../../Character/CharacterDialogueChat/PromptBuilder';

describe('resolveStopForRequestBody', () => {
  it('supportsStopArray=true（默认）时返回数组', () => {
    const stops = ['\n张三:', '\n用户:', '\nUser:'];
    const result = resolveStopForRequestBody(stops, { supportsStopArray: true });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(stops);
  });

  it('capabilities 缺省时默认 supportsStopArray=true，返回数组', () => {
    const stops = ['\n张三:', '\n用户:'];
    const result = resolveStopForRequestBody(stops, undefined);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(stops);
  });

  it('supportsStopArray=false 时返回首元素字符串', () => {
    const stops = ['\n张三:', '\n用户:', '\nUser:'];
    const result = resolveStopForRequestBody(stops, { supportsStopArray: false });
    // 应为字符串而非数组
    expect(typeof result).toBe('string');
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe('\n张三:');
  });

  it('supportsStopArray=false 且只有一个停止串时返回该字符串', () => {
    const stops = ['\n用户:'];
    const result = resolveStopForRequestBody(stops, { supportsStopArray: false });
    expect(result).toBe('\n用户:');
  });

  it('stopSequences 为空数组时返回 undefined（不注入 stop 字段）', () => {
    const result = resolveStopForRequestBody([], { supportsStopArray: true });
    expect(result).toBeUndefined();
  });

  it('stopSequences 为 undefined 时返回 undefined', () => {
    const result = resolveStopForRequestBody(undefined, { supportsStopArray: true });
    expect(result).toBeUndefined();
  });

  it('stopSequences 为 undefined 且 capabilities 缺省时返回 undefined', () => {
    const result = resolveStopForRequestBody(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('capabilities 仅含 supportsRepPen 时 supportsStopArray 默认 true，返回数组', () => {
    // capabilities 中未显式设置 supportsStopArray，应默认 true
    const stops = ['\n用户:', '<END>'];
    const caps: EngineCapabilities = { supportsRepPen: true };
    const result = resolveStopForRequestBody(stops, caps);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(stops);
  });

  it('supportsStopArray=false 时即使有多个停止串也只返回第一个', () => {
    const stops = ['<END>', '\n助理:', '\n用户:', '\nUser:'];
    const result = resolveStopForRequestBody(stops, { supportsStopArray: false });
    expect(result).toBe('<END>');
    expect(typeof result).toBe('string');
  });

  it('与 buildStopSequences 集成：默认用户名变体数组在 supportsStopArray=true 时完整传递', () => {
    // 模拟 hooks.ts 中的实际调用链
    // Spec: fix-ai-response-length-degradation / Task 6 + 🐛 Bug修复 — 默认数组为 6 项双换行前缀变体
    // （单换行前缀变体已移除，避免 OpenAI-compatible 后端子串匹配误触发截断）
    const stops = buildStopSequences('张三');
    const result = resolveStopForRequestBody(stops, { supportsStopArray: true });
    expect(Array.isArray(result)).toBe(true);
    // 6 项双换行前缀变体
    expect(result).toContain('\n\n张三:');
    expect(result).toContain('\n\n张三：');
    expect(result).toContain('\n\n用户:');
    expect(result).toContain('\n\n用户：');
    expect(result).toContain('\n\nUser:');
    expect(result).toContain('\n\nUser：');
    // 单换行前缀变体已移除（Bug修复）
    expect(result).not.toContain('\n张三:');
    expect(result).not.toContain('\n用户:');
    expect(result).not.toContain('\nUser:');
  });

  it('与 buildStopSequences 集成：supportsStopArray=false 时返回首个用户名变体字符串', () => {
    // Spec: fix-ai-response-length-degradation / Task 6 — 首元素现为双换行前缀 \n\n张三:
    const stops = buildStopSequences('张三');
    const result = resolveStopForRequestBody(stops, { supportsStopArray: false });
    expect(typeof result).toBe('string');
    // 首元素应为 \n\n张三:（双换行前缀优先，减少 AI 在回复中引用用户话语时的误触发）
    expect(result).toBe('\n\n张三:');
  });
});
