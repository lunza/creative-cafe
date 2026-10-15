/**
 * Phase 1（H1-H5 架构地基）debug 检查 —— AI 调用链路真实调用
 *
 * Phase 1 交付的 H1（IPC 服务封装层 characterChatService）最终封装的是 aiService 这条 AI 调用链。
 * 本文件验证该地基链路在纯 node 环境（脱离 Electron）下可直接加载并真实调用：
 * - P1-C1 引擎配置加载（storageService → AIConfigProvider → getConfig/getEngineConfig）
 * - P1-C2 请求构建（buildRequest：header/body 鉴权、采样参数、tools 注入守卫）
 * - P1-C3 真实 callChatAPI 往返（打到已配置引擎，非 mock）
 */
import { it, expect, beforeAll, afterAll } from 'vitest';
import { aiService } from '../../services/AIService';
import {
  selectDebugEngine,
  restoreDebugEngine,
  appendDebugReport,
  runCheck,
  logResult,
  DebugCheckResult,
} from '../debugHarness';

const results: DebugCheckResult[] = [];

beforeAll(() => {
  // 报告头由 vitest.debug.setup.ts 的 globalSetup 统一初始化（主进程一次性执行）
  const engine = selectDebugEngine();
  console.log(`[Phase 1 debug] 使用 AI 引擎: ${engine.name}（${engine.baseUrl} / ${engine.model}）`);
});

afterAll(() => {
  restoreDebugEngine();
  appendDebugReport('phase1', 'Phase 1（H1-H5）AI 调用地基链路', results);
});

it('P1-C1 引擎配置加载（storageService → AIConfigProvider）', async () => {
  const result = await runCheck('Phase 1', 'P1-C1', '引擎配置加载', async () => {
    const config = await aiService.getConfig();
    const engineConfig = await aiService.getEngineConfig();
    if (!config.baseUrl) throw new Error('baseUrl 为空');
    if (!config.model) throw new Error('model 为空');
    if (typeof engineConfig.temperature !== 'number') throw new Error('temperature 非数字');
    return `baseUrl=${config.baseUrl}, model=${config.model}, temperature=${engineConfig.temperature}, 鉴权方式=${config.apiKeyTransmission}`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P1-C2 buildRequest 请求构建（纯函数，header/body 鉴权 + tools 守卫）', async () => {
  const result = await runCheck('Phase 1', 'P1-C2', 'buildRequest 请求构建', async () => {
    const messages = [{ role: 'user' as const, content: '测试' }];

    // header 鉴权
    const headerReq = aiService.buildRequest({
      messages,
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1024,
      stream: false,
      config: { baseUrl: 'http://x', apiKey: 'sk-abc', apiKeyTransmission: 'header', model: 'test-model', systemPrompt: '', temperature: 0.7, topP: 0.9 },
    });
    if (headerReq.headers['Authorization'] !== 'Bearer sk-abc') throw new Error(`header 鉴权错误: ${headerReq.headers['Authorization']}`);
    if (headerReq.requestBody.api_key !== undefined) throw new Error('header 模式下不应有 body api_key');
    if (headerReq.requestBody.top_p !== 0.9) throw new Error('topP 未注入');

    // body 鉴权
    const bodyReq = aiService.buildRequest({
      messages,
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1024,
      stream: false,
      config: { baseUrl: 'http://x', apiKey: 'sk-abc', apiKeyTransmission: 'body', model: 'test-model', systemPrompt: '' },
    });
    if (bodyReq.requestBody.api_key !== 'sk-abc') throw new Error('body 鉴权未注入 api_key');
    if (bodyReq.headers['Authorization']) throw new Error('body 模式下不应有 Authorization 头');

    // tools 注入守卫：supportsToolCalling=false 时不注入
    const noToolReq = aiService.buildRequest({
      messages,
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1024,
      stream: false,
      config: { baseUrl: 'http://x', apiKey: '', apiKeyTransmission: 'header', model: 'test-model', systemPrompt: '' },
      tools: [{ type: 'function', function: { name: 't' } }],
      supportsToolCalling: false,
    });
    if (noToolReq.requestBody.tools !== undefined) throw new Error('supportsToolCalling=false 时不应注入 tools');

    return 'header 鉴权 ✓ / body 鉴权 ✓ / topP 注入 ✓ / tools 守卫 ✓';
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P1-C3 真实 callChatAPI 往返（已配置引擎，非 mock）', async () => {
  const result = await runCheck('Phase 1', 'P1-C3', '真实 callChatAPI 往返', async () => {
    const config = await aiService.getConfig();
    const content = await aiService.callChatAPI(
      [
        { role: 'system', content: '你是一个测试助手，只回答简短内容。' },
        { role: 'user', content: '请只回复两个字：收到' },
      ],
      { model: config.model, temperature: 0.1, maxTokens: 256, timeoutMs: 120000 }
    );
    if (!content || content.trim().length === 0) throw new Error('AI 返回空内容');
    return `引擎响应 ${content.length} 字符: "${content.trim().slice(0, 80)}"`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});
