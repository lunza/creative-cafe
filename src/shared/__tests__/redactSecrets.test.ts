import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../utils/redactSecrets';

// Spec: settings-feature-optimization-report / H-1
// api_key 日志脱敏：JSON 字段值、Authorization 头、api_key= 查询参数三类泄露面

describe('redactSecrets', () => {
  it('空输入原样返回', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('脱敏 JSON 中的 api_key 字段值', () => {
    const input = JSON.stringify({ api_key: 'sk-abc123', model_name: 'gpt-4' });
    const out = redactSecrets(input);
    expect(out).not.toContain('sk-abc123');
    expect(out).toContain('"api_key":"***"');
    // 非敏感字段不受影响
    expect(out).toContain('gpt-4');
  });

  it('脱敏 camelCase apiKey 与 novelai/ai_horde/remoteApiKey 变体', () => {
    const input = JSON.stringify({
      apiKey: 'sk-camel',
      novelai_api_key: 'nv-1',
      ai_horde_api_key: 'ah-2',
      remoteApiKey: 'rk-3',
    });
    const out = redactSecrets(input);
    expect(out).not.toContain('sk-camel');
    expect(out).not.toContain('nv-1');
    expect(out).not.toContain('ah-2');
    expect(out).not.toContain('rk-3');
  });

  it('脱敏 Authorization 头（Bearer 与非 Bearer 两种形式）', () => {
    const bearer = redactSecrets(JSON.stringify({ Authorization: 'Bearer sk-real-key' }));
    expect(bearer).not.toContain('sk-real-key');
    expect(bearer).toContain('Bearer ***');

    const raw = redactSecrets('Authorization: sk-plain-token');
    expect(raw).not.toContain('sk-plain-token');
    expect(raw).toContain('***');
  });

  it('脱敏 api_key= 查询参数', () => {
    const url = 'http://127.0.0.1:5000/v1/chat/completions?api_key=sk-query-456&x=1';
    const out = redactSecrets(url);
    expect(out).not.toContain('sk-query-456');
    expect(out).toContain('api_key=***');
  });

  it('无敏感信息的文本原样返回', () => {
    const input = '温度 0.7，max_tokens 10240，模型 llama3';
    expect(redactSecrets(input)).toBe(input);
  });
});
