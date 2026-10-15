/**
 * Phase 2（M1-M8 体验优化）debug 检查 —— 流式 AI 调用真实验证
 *
 * Phase 2 中与 AI 引擎直接相关的核心项是 M8（流式渲染节流）所依赖的流式调用链路。
 * M1/M3/M4/M5/M6/M7 为 UI 层功能（组件拆分/配置面板/响应式/导出/版本历史/懒加载），
 * 不经过 AI 引擎，不在本 debug 机制范围内（由现有组件测试与人工验收覆盖）。
 * - P2-C1 真实 streamChatAPI 流式调用：分片回调触发、最终内容非空、生成耗时统计
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
  // 引擎选择与 phase1 相同逻辑（各文件独立模块上下文，需各自 select）
  const engine = selectDebugEngine();
  console.log(`[Phase 2 debug] 使用 AI 引擎: ${engine.name}（${engine.baseUrl} / ${engine.model}）`);
});

afterAll(() => {
  restoreDebugEngine();
  appendDebugReport('phase2', 'Phase 2（M1-M8）流式调用链路（M8 基础）', results);
});

it('P2-C1 真实 streamChatAPI 流式调用（分片回调 + 完整内容 + 耗时统计）', async () => {
  const result = await runCheck('Phase 2 / M8', 'P2-C1', '真实 streamChatAPI 流式调用', async () => {
    const config = await aiService.getConfig();
    let chunkCount = 0;
    let firstChunkChars = 0;

    const response = await aiService.streamChatAPI(
      [{ role: 'user', content: '请用三句话介绍你自己，然后停止。' }],
      { model: config.model, temperature: 0.3, maxTokens: 512, timeoutMs: 180000 },
      chunk => {
        chunkCount += 1;
        if (chunkCount === 1) firstChunkChars = chunk.length;
      }
    );

    if (!response.content || response.content.trim().length === 0) throw new Error('流式最终内容为空');
    if (chunkCount === 0) throw new Error('流式分片回调从未触发（引擎未走 SSE 流？）');
    if (response.generationTime < 0) throw new Error('generationTime 为负');

    return `分片 ${chunkCount} 个（首片 ${firstChunkChars} 字符），最终内容 ${response.content.length} 字符，生成耗时 ${response.generationTime}ms，finishReason=${response.finishReason ?? '(none)'}`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});
