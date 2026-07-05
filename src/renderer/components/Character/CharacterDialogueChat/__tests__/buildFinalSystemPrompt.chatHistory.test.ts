/**
 * buildFinalSystemPrompt 对话历史 RAG 注入测试
 *
 * 验证目标（spec Task 7.5 + 7.7）：
 *   1. 传入 chatHistoryItems 时，system prompt 包含"区域 2：本会话相关历史片段"段落
 *   2. 注入位置在"区域 1：相关背景知识"之后
 *   3. 旧"区域 2 记忆表格"重命名为"区域 3 记忆表格"
 *   4. 旧"区域 3 异步整理指令"重命名为"区域 4 异步整理指令"
 *   5. 不传 chatHistoryItems 时，不注入区域 2（向后兼容）
 *
 * Spec: optimize-chat-ai-intelligence / Task 7.5 + 7.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// buildFinalSystemPrompt 内部调用了 buildAsyncTableOrganizeInstructions，
// 后者依赖 window.electronAPI.prompt.build。这里 stub 掉避免真实 IPC 调用。
const promptBuildMock = vi.fn().mockResolvedValue({
  success: false,
  error: 'not configured',
});
vi.stubGlobal('window', {
  electronAPI: {
    prompt: {
      build: promptBuildMock,
    },
  },
});

// 静音 console.log
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

import { buildFinalSystemPrompt } from '../PromptBuilder';

describe('buildFinalSystemPrompt - chatHistoryItems injection (Task 7.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should inject "区域 2：本会话相关历史片段" when chatHistoryItems provided', async () => {
    const chatHistoryItems = [
      { content: '历史片段 1 内容', score: 0.85, timestamp: 1000 },
      { content: '历史片段 2 内容', score: 0.75, timestamp: 2000 },
    ];

    const result = await buildFinalSystemPrompt(
      '基础 system prompt',
      [], // vectorContextItems（区域 1）为空
      undefined, // memoryTableData
      undefined, // organizeMode
      undefined, // tableStructure
      chatHistoryItems
    );

    expect(result).toContain('【区域 2：本会话相关历史片段】');
    expect(result).toContain('历史片段 1 内容');
    expect(result).toContain('历史片段 2 内容');
    expect(result).toContain('【区域 2 结束 - 以上历史片段仅供参考】');
  });

  it('should format each history item with index and score percentage', async () => {
    const chatHistoryItems = [
      { content: '第一条历史', score: 0.85, timestamp: 1000 },
      { content: '第二条历史', score: 0.7234, timestamp: 2000 },
    ];

    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      undefined,
      undefined,
      undefined,
      chatHistoryItems
    );

    expect(result).toContain('[历史片段 1]');
    expect(result).toContain('[历史片段 2]');
    expect(result).toContain('(相关度: 85.0%)');
    expect(result).toContain('(相关度: 72.3%)');
  });

  it('should inject 区域 2 AFTER 区域 1 (vector context)', async () => {
    const vectorContextItems = [
      { source: 'knowledge', score: 0.9, content: '知识库内容' },
    ];
    const chatHistoryItems = [
      { content: '历史片段', score: 0.8, timestamp: 1000 },
    ];

    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      vectorContextItems,
      undefined,
      undefined,
      undefined,
      chatHistoryItems
    );

    const area1Index = result.indexOf('【区域 1：相关背景知识】');
    const area2Index = result.indexOf('【区域 2：本会话相关历史片段】');

    expect(area1Index).toBeGreaterThan(-1);
    expect(area2Index).toBeGreaterThan(-1);
    // 区域 2 必须在区域 1 之后
    expect(area2Index).toBeGreaterThan(area1Index);
  });

  it('should inject 区域 2 BEFORE 区域 3 (memory table)', async () => {
    const chatHistoryItems = [
      { content: '历史片段', score: 0.8, timestamp: 1000 },
    ];
    const memoryTableData = '# 记忆表格\n| 列1 | 列2 |\n| --- | --- |\n| 值1 | 值2 |';

    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      memoryTableData,
      undefined,
      undefined,
      chatHistoryItems
    );

    const area2Index = result.indexOf('【区域 2：本会话相关历史片段】');
    const area3Index = result.indexOf('【区域 3：记忆表格数据】');

    expect(area2Index).toBeGreaterThan(-1);
    expect(area3Index).toBeGreaterThan(-1);
    // 区域 2 必须在区域 3 之前
    expect(area3Index).toBeGreaterThan(area2Index);
  });

  it('should NOT inject 区域 2 when chatHistoryItems is undefined (backward compatible)', async () => {
    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      undefined,
      undefined,
      undefined,
      undefined // 不传 chatHistoryItems
    );

    expect(result).not.toContain('【区域 2：本会话相关历史片段】');
  });

  it('should NOT inject 区域 2 when chatHistoryItems is empty array', async () => {
    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      undefined,
      undefined,
      undefined,
      [] // 空数组
    );

    expect(result).not.toContain('【区域 2：本会话相关历史片段】');
  });

  it('should rename old 区域 2 (memory table) to 区域 3', async () => {
    const memoryTableData = '# 记忆表格\n| 列1 |\n| --- |\n| 值1 |';

    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      memoryTableData,
      undefined,
      undefined,
      undefined
    );

    expect(result).toContain('【区域 3：记忆表格数据】');
    expect(result).toContain('【区域 3 结束 - 以上记忆表格数据仅供参考】');
    // 不应再出现旧的"区域 2：记忆表格数据"
    expect(result).not.toContain('【区域 2：记忆表格数据】');
  });

  it('should rename old 区域 3 (async organize) to 区域 4', async () => {
    // organizeMode='async' 触发异步整理指令段落
    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      '# 表格数据',
      'async',
      { sheets: ['sheet1'], headers: { sheet1: ['col1'] }, descriptions: {} },
      undefined
    );

    expect(result).toContain('【区域 4：记忆表格异步整理指令】');
    expect(result).toContain('【区域 4 结束 - 以上为系统指令】');
    // 不应再出现旧的"区域 3：记忆表格异步整理指令"
    expect(result).not.toContain('【区域 3：记忆表格异步整理指令】');
  });

  it('should maintain all 4 areas in correct order when all are present', async () => {
    const vectorContextItems = [{ source: 'knowledge', score: 0.9, content: '知识库' }];
    const chatHistoryItems = [{ content: '历史片段', score: 0.8, timestamp: 1000 }];
    const memoryTableData = '# 记忆表格';

    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      vectorContextItems,
      memoryTableData,
      'async', // 触发区域 4
      { sheets: ['sheet1'], headers: { sheet1: ['col1'] }, descriptions: {} },
      chatHistoryItems
    );

    const area1Index = result.indexOf('【区域 1：相关背景知识】');
    const area2Index = result.indexOf('【区域 2：本会话相关历史片段】');
    const area3Index = result.indexOf('【区域 3：记忆表格数据】');
    const area4Index = result.indexOf('【区域 4：记忆表格异步整理指令】');

    // 全部存在
    expect(area1Index).toBeGreaterThan(-1);
    expect(area2Index).toBeGreaterThan(-1);
    expect(area3Index).toBeGreaterThan(-1);
    expect(area4Index).toBeGreaterThan(-1);

    // 顺序：1 < 2 < 3 < 4
    expect(area1Index).toBeLessThan(area2Index);
    expect(area2Index).toBeLessThan(area3Index);
    expect(area3Index).toBeLessThan(area4Index);
  });

  it('should preserve chatHistoryItems content as-is (no truncation)', async () => {
    const longContent = '这是一段很长的历史片段内容，包含中文字符、English characters、数字 12345、以及标点符号！？。，；：…—';
    const chatHistoryItems = [
      { content: longContent, score: 0.85, timestamp: 1000 },
    ];

    const result = await buildFinalSystemPrompt(
      '基础 prompt',
      [],
      undefined,
      undefined,
      undefined,
      chatHistoryItems
    );

    expect(result).toContain(longContent);
  });
});

afterEach(() => {
  consoleLogSpy.mockClear();
});
