/**
 * 性能回归端到端测试
 *
 * Spec: optimize-chat-ai-intelligence / Task 11.5
 *
 * 验证目标（spec: "性能回归：单轮对话 P95 延迟增长 < 500ms"）：
 *   1. tiktoken IPC 调用延迟（token:count）P95 < 100ms
 *      - 使用真实 TokenCountService（gpt-tokenizer cl100k_base，纯 JS）
 *      - warmup 后测量 countTokens 多次调用延迟分布
 *      - 注：真实 IPC marshalling 开销通常 1-5ms，本测试在 node 环境直接调
 *        主进程 service，实际 IPC 总延迟 = 编码延迟 + marshalling，仍远低于 100ms
 *   2. nGramJaccard 500 字文本对计算 P95 < 50ms
 *      - 直接调用 similarityUtils.nGramJaccard，测量 50 次延迟分布
 *   3. retrieveChatHistory 延迟（mock 向量存储）P95 < 200ms
 *      - mock embeddingService.generateEmbedding + vectorStoreService.search
 *      - 测量完整 retrieveChatHistory 流程（embedding 调用 + 搜索 + 过滤 + 排序）
 *   4. 综合估算：单轮对话新增延迟（tiktoken + RAG + 去重）< 500ms
 *      - 汇总三项典型耗时，验证总和 < 500ms 阈值
 *
 * 测试策略：
 * - 使用 performance.now() 高精度计时
 * - 每项测量 50 次迭代，计算 P95（第 95 百分位）
 * - 测试环境：node（vitest environment: 'node'），无真实 electron IPC
 * - 真实环境延迟可能高于本测试，但 spec 阈值已留足余量
 *
 * Spec: optimize-chat-ai-intelligence / Task 11.5
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TokenCountService } from '../../../../../main/services/TokenCountService';
import { nGramJaccard } from '../utils/similarityUtils';

// ============================================================
// Mock 依赖：ChatVectorizationService 的向量存储与 embedding
// ============================================================
// 必须在 import ChatVectorizationService 之前用 vi.hoisted 注册 mock
const mocks = vi.hoisted(() => {
  return {
    embeddingService: {
      // mock embedding：返回固定 384 维向量，模拟"embedding 已就绪"
      // 不模拟真实 embedding API 延迟（那是外部服务，不在本测试范围）
      generateEmbedding: vi.fn(),
    },
    vectorStoreService: {
      // mock search：返回 6 条预置结果（topK*2 候选），模拟内存向量检索
      search: vi.fn(),
      add: vi.fn(),
      getById: vi.fn(),
      persist: vi.fn(),
    },
    vectorRegistryService: {
      getVectorFilesBySourceId: vi.fn(),
      updateVectorFile: vi.fn(),
      registerVectorFile: vi.fn(),
    },
  };
});

vi.mock('../../../../../main/services/EmbeddingService', () => ({
  embeddingService: mocks.embeddingService,
}));

vi.mock('../../../../../main/services/VectorStoreService', () => ({
  vectorStoreService: mocks.vectorStoreService,
}));

vi.mock('../../../../../main/services/VectorRegistryService', () => ({
  vectorRegistryService: mocks.vectorRegistryService,
}));

// ⚠️ Bug修复（测试隔离缺陷）：原测试未 mock vectorConfigManager，导致 retrieveChatHistory
// 读取真实磁盘 settings.json 的 vector.embeddingMode。当用户在本机应用中禁用向量化
// （embeddingMode='disabled'）时，服务短路返回 []，性能测试断言失败。
// 现固定 mock 为 'remote' 模式，使测试与机器配置解耦（hermetic）。
vi.mock('../../../../../main/services/VectorConfigManager', () => ({
  vectorConfigManager: {
    loadVectorConfig: vi.fn(() => ({ embeddingMode: 'remote' as const })),
  },
}));

// 静音 console.* 保持测试输出整洁（ChatVectorizationService 内部有大量 console.log）
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

/**
 * 性能数据输出（绕过 console.log spy，直接写 stdout）。
 * 用于在测试运行时输出 perf 报告供文档记录。
 */
function perfLog(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

import { ChatVectorizationService } from '../../../../../main/services/ChatVectorizationService';

// ============================================================
// 性能测试工具函数
// ============================================================

/**
 * 计算数组的 P95（第 95 百分位）。
 *
 * 使用最近邻插值法：排序后取 floor(N * 0.95) 与 ceil(N * 0.95) 之间线性插值。
 * 简化实现：直接取 sorted[floor(N * 0.95)]（保守上界，N=50 时取第 47 索引，即第 48 大的值）。
 *
 * @param samples 样本数组（毫秒）
 * @returns P95 值（毫秒）
 */
function calculateP95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  // 防止 idx 越界（length=1 时 floor(0.95)=0）
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * 计算数组平均值。
 */
function calculateAvg(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, v) => sum + v, 0) / samples.length;
}

/**
 * 生成指定长度的中文测试文本。
 */
function makeChineseText(charCount: number): string {
  const sample =
    '在一个安静的小镇上，有一家名叫"创想咖啡厅"的小店。' +
    '店主是一位温柔的女子，她喜欢听来往客人讲述自己的故事。' +
    '每天清晨，阳光透过窗户洒在木质吧台上，咖啡的香气弥漫在空气中。' +
    '客人们或独自品茶，或三五成群地交谈，每个人的脸上都洋溢着不同的表情。';
  let text = '';
  while (text.length < charCount) {
    text += sample;
  }
  return text.slice(0, charCount);
}

/**
 * 迭代次数（spec: "测量多次以获得稳定 P95"）。
 * 50 次：足够计算 P95（取第 47 大值），单次执行快（避免测试套件超时）。
 */
const ITERATIONS = 50;

// ============================================================
// 性能测试主体
// ============================================================

describe('性能回归测试 (Task 11.5)', () => {
  let tokenService: TokenCountService;
  let vectorizationService: ChatVectorizationService;

  beforeEach(async () => {
    tokenService = new TokenCountService();
    vectorizationService = new ChatVectorizationService();
    vi.clearAllMocks();

    // 默认 mock embedding 成功
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: new Array(384).fill(0).map((_, i) => Math.sin(i)), // 384 维模拟向量
      dimension: 384,
    });

    // 默认 mock search：返回 6 条候选（topK=3 时 candidateCount=6）
    mocks.vectorStoreService.search.mockResolvedValue([
      { id: 'msg-1', score: 0.88, metadata: { text: makeChineseText(80), messageCreateDate: 1000 } },
      { id: 'msg-2', score: 0.82, metadata: { text: makeChineseText(80), messageCreateDate: 2000 } },
      { id: 'msg-3', score: 0.75, metadata: { text: makeChineseText(80), messageCreateDate: 3000 } },
      { id: 'msg-4', score: 0.68, metadata: { text: makeChineseText(80), messageCreateDate: 4000 } },
      { id: 'msg-5', score: 0.55, metadata: { text: makeChineseText(80), messageCreateDate: 5000 } }, // 低于 minScore
      { id: 'msg-6', score: 0.45, metadata: { text: makeChineseText(80), messageCreateDate: 6000 } }, // 低于 minScore
    ]);
  });

  afterEach(() => {
    consoleErrorSpy.mockClear();
    consoleWarnSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  // ============================================================
  // 1. tiktoken IPC 调用延迟 P95 < 100ms
  // ============================================================
  describe('1. tiktoken (cl100k_base) 编码延迟', () => {
    it('warmup 后 countTokens 多次调用 P95 < 100ms', async () => {
      // 预热：加载 cl100k_base 编码器
      await tokenService.warmup();
      expect(tokenService.isReady()).toBe(true);

      // 测试用例：模拟单轮对话中需计数的典型文本
      const testTexts = [
        makeChineseText(100),   // 单条短消息
        makeChineseText(500),   // 单条中等消息
        makeChineseText(1000),  // system prompt 片段
        makeChineseText(2000),  // 较长 system prompt
        'Hello world! Mixed 混合文本 with English and 中文标点。', // 混合
      ];

      // 预热编码器内部缓存（首次编码会触发额外开销）
      for (const text of testTexts) {
        tokenService.countTokens(text);
      }

      // 正式测量：每个文本 ITERATIONS 次
      const allSamples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        for (const text of testTexts) {
          const start = performance.now();
          tokenService.countTokens(text);
          const elapsed = performance.now() - start;
          allSamples.push(elapsed);
        }
      }

      const p95 = calculateP95(allSamples);
      const avg = calculateAvg(allSamples);
      const max = Math.max(...allSamples);

      perfLog(
        `[perf] tiktoken countTokens: N=${allSamples.length}, avg=${avg.toFixed(3)}ms, ` +
        `P95=${p95.toFixed(3)}ms, max=${max.toFixed(3)}ms`
      );

      // spec: P95 < 100ms
      expect(p95).toBeLessThan(100);
      // 平均值应远低于 P95（验证无异常尖刺）
      expect(avg).toBeLessThan(p95);
    });

    it('countTokensBatch 批量计数 P95 < 100ms（单批 20 条消息，模拟单轮预热）', async () => {
      await tokenService.warmup();

      // 模拟单轮对话需预热的消息列表：1 system prompt + 20 条历史消息
      const batch = Array.from({ length: 20 }, (_, i) => makeChineseText(100 + i * 20));

      // 预热
      tokenService.countTokensBatch(batch);

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        tokenService.countTokensBatch(batch);
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      const avg = calculateAvg(samples);

      perfLog(
        `[perf] tiktoken countTokensBatch(20 msgs): N=${samples.length}, ` +
        `avg=${avg.toFixed(3)}ms, P95=${p95.toFixed(3)}ms`
      );

      // spec: P95 < 100ms（批量计数应优于单条累加）
      expect(p95).toBeLessThan(100);
    });

    it('fallback 模式（编码器未就绪）countTokens P95 < 100ms', () => {
      // 不调用 warmup，走字节估算路径
      const fallbackService = new TokenCountService();
      expect(fallbackService.isReady()).toBe(false);

      const text = makeChineseText(2000);

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        fallbackService.countTokens(text);
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      perfLog(`[perf] tiktoken fallback (byte estimate): P95=${p95.toFixed(3)}ms`);

      // 字节估算应极快（TextEncoder + 除法）
      expect(p95).toBeLessThan(100);
    });
  });

  // ============================================================
  // 2. nGramJaccard 500 字文本对计算 P95 < 50ms
  // ============================================================
  describe('2. nGramJaccard 500 字文本对计算延迟', () => {
    it('500 字文本对 nGramJaccard P95 < 50ms', () => {
      // 构造两个约 500 字的中文文本（部分相似）
      const base = '春暖花开的时节，万物复苏，大地一片生机勃勃。小鸟在枝头歌唱，蝴蝶在花丛中飞舞，孩子们在草地上奔跑嬉戏。';
      const textA = base.repeat(10).slice(0, 500);
      // textB：base 重复 10 次后修改末尾，确保与 textA 部分相似
      const textB = (base.repeat(9) + '微风轻拂，阳光明媚，美好的春日午后，时光静好，远山如黛，流水潺潺，人间仙境美不胜收。').slice(0, 500);

      // 验证文本长度接近 500（spec Scenario: 去重计算性能要求 500 字文本对）
      expect(textA.length).toBe(500);
      expect(textB.length).toBeGreaterThan(450);
      expect(textB.length).toBeLessThanOrEqual(500);

      // 预热（首次调用会触发 Set 构造开销）
      nGramJaccard(textA, textB, 4);

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        nGramJaccard(textA, textB, 4);
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      const avg = calculateAvg(samples);
      const max = Math.max(...samples);

      perfLog(
        `[perf] nGramJaccard(500 chars): N=${samples.length}, ` +
        `avg=${avg.toFixed(3)}ms, P95=${p95.toFixed(3)}ms, max=${max.toFixed(3)}ms`
      );

      // spec: P95 < 50ms
      expect(p95).toBeLessThan(50);
    });

    it('多对短文本（模拟重试去重场景）累计 P95 < 50ms', () => {
      // 模拟重试场景：单次对话中比较 3 次（首次 + 2 次重试）
      const originalReply = makeChineseText(300);
      const retryReplies = [
        originalReply + '。',                              // 高相似度（>0.8）
        makeChineseText(300) + '完全不同的内容',           // 低相似度
        originalReply.slice(0, 150) + makeChineseText(150), // 部分相似
      ];

      // 预热
      for (const r of retryReplies) {
        nGramJaccard(originalReply, r, 4);
      }

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        for (const r of retryReplies) {
          nGramJaccard(originalReply, r, 4);
        }
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      perfLog(`[perf] nGramJaccard(3x 300 chars): P95=${p95.toFixed(3)}ms`);

      expect(p95).toBeLessThan(50);
    });
  });

  // ============================================================
  // 3. retrieveChatHistory 延迟（mock 向量存储）P95 < 200ms
  // ============================================================
  describe('3. retrieveChatHistory 延迟（mock 向量存储）', () => {
    it('完整 retrieveChatHistory 流程 P95 < 200ms', async () => {
      const chatId = 'perf-test-chat';
      const queryText = makeChineseText(100); // 模拟最近一条用户消息

      // 预热（首次调用会触发 mock 路径初始化）
      await vectorizationService.retrieveChatHistory(chatId, queryText, 3, 0.6);

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        await vectorizationService.retrieveChatHistory(chatId, queryText, 3, 0.6);
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      const avg = calculateAvg(samples);
      const max = Math.max(...samples);

      perfLog(
        `[perf] retrieveChatHistory: N=${samples.length}, ` +
        `avg=${avg.toFixed(3)}ms, P95=${p95.toFixed(3)}ms, max=${max.toFixed(3)}ms`
      );

      // spec: P95 < 200ms
      expect(p95).toBeLessThan(200);
      // 验证 mock 被正确调用（确保测试有效性）
      expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalled();
      expect(mocks.vectorStoreService.search).toHaveBeenCalled();
    });

    it('retrieveChatHistory 返回正确结果（验证测量的是真实流程，非空跑）', async () => {
      const result = await vectorizationService.retrieveChatHistory('chat-1', '查询文本', 3, 0.6);

      // mock 返回 6 条，其中 2 条低于 minScore=0.6 应被过滤，剩 4 条，topK=3 截断为 3 条
      expect(result).toHaveLength(3);
      // 每条都应有 content/score/timestamp
      for (const item of result) {
        expect(item.content).toBeTruthy();
        expect(typeof item.score).toBe('number');
        expect(typeof item.timestamp).toBe('number');
      }
      // 验证按时间升序排列
      expect(result[0].timestamp).toBeLessThanOrEqual(result[1].timestamp);
      expect(result[1].timestamp).toBeLessThanOrEqual(result[2].timestamp);
      // 验证 minScore 过滤生效
      for (const item of result) {
        expect(item.score).toBeGreaterThanOrEqual(0.6);
      }
    });

    it('retrieveChatHistory 在 embedding 延迟较高时仍 P95 < 200ms（mock 5ms embedding 延迟）', async () => {
      // 模拟 embedding 服务有 5ms 处理延迟（真实 embedding API 通常 50-500ms，
      // 但 embedding 调用是异步并行的，且 spec 阈值 200ms 主要衡量检索流程本身）
      mocks.embeddingService.generateEmbedding.mockImplementation(async () => {
        const start = performance.now();
        // 模拟 5ms 处理延迟（busy-wait 模拟，避免 timer mock 干扰 performance.now）
        while (performance.now() - start < 5) {
          // busy wait
        }
        return {
          success: true,
          vector: new Array(384).fill(0),
          dimension: 384,
        };
      });

      // 预热
      await vectorizationService.retrieveChatHistory('chat-1', '查询', 3, 0.6);

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        await vectorizationService.retrieveChatHistory('chat-1', '查询', 3, 0.6);
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      perfLog(`[perf] retrieveChatHistory (5ms embedding delay): P95=${p95.toFixed(3)}ms`);

      // 即使有 5ms embedding 延迟，整体仍应 < 200ms
      expect(p95).toBeLessThan(200);
    });
  });

  // ============================================================
  // 4. 综合估算：单轮对话新增延迟 < 500ms
  // ============================================================
  describe('4. 单轮对话新增延迟综合估算', () => {
    it('tiktoken 预热 + RAG 检索 + 去重检测 累计 P95 < 500ms', async () => {
      await tokenService.warmup();

      // 模拟单轮对话的新增开销：
      // A) tiktoken 预热：1 个 system prompt + 20 条消息的批量计数（precountMessages 等价）
      const systemPrompt = makeChineseText(1000);
      const messages = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: makeChineseText(100 + i * 20),
        timestamp: Date.now() + i,
      }));

      // B) RAG 检索：retrieveChatHistory 一次调用
      const queryText = makeChineseText(100);

      // C) 去重检测：nGramJaccard 调用一次（重试时 3 次，取最坏情况）
      const originalReply = makeChineseText(300);
      const newReply = makeChineseText(300) + '补充内容';

      // 预热所有路径
      tokenService.countTokens(systemPrompt);
      tokenService.countTokensBatch(messages.map(m => m.content));
      await vectorizationService.retrieveChatHistory('chat-1', queryText, 3, 0.6);
      nGramJaccard(originalReply, newReply, 4);

      // 正式测量：完整单轮新增开销
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();

        // A) tiktoken 预热
        tokenService.countTokens(systemPrompt);
        tokenService.countTokensBatch(messages.map(m => m.content));

        // B) RAG 检索
        await vectorizationService.retrieveChatHistory('chat-1', queryText, 3, 0.6);

        // C) 去重检测（模拟最坏：3 次比较）
        nGramJaccard(originalReply, newReply, 4);
        nGramJaccard(originalReply, newReply + '。', 4);
        nGramJaccard(originalReply, newReply + '！', 4);

        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const p95 = calculateP95(samples);
      const avg = calculateAvg(samples);
      const max = Math.max(...samples);

      perfLog(
        `[perf] 单轮新增延迟综合（tiktoken+RAG+dedup）: N=${samples.length}, ` +
        `avg=${avg.toFixed(3)}ms, P95=${p95.toFixed(3)}ms, max=${max.toFixed(3)}ms`
      );

      // spec: 单轮对话新增延迟 < 500ms
      expect(p95).toBeLessThan(500);
    });

    it('各项开销占比合理（验证无单项成为瓶颈）', async () => {
      await tokenService.warmup();

      const systemPrompt = makeChineseText(1000);
      const messages = Array.from({ length: 20 }, (_, i) => makeChineseText(100 + i * 20));
      const queryText = makeChineseText(100);
      const originalReply = makeChineseText(300);
      const newReply = makeChineseText(300);

      // 预热
      tokenService.countTokens(systemPrompt);
      tokenService.countTokensBatch(messages);
      await vectorizationService.retrieveChatHistory('chat-1', queryText, 3, 0.6);
      nGramJaccard(originalReply, newReply, 4);

      // 分别测量各项开销（每项 30 次取 P95）
      const tiktokenSamples: number[] = [];
      const ragSamples: number[] = [];
      const dedupSamples: number[] = [];

      for (let i = 0; i < 30; i++) {
        let start = performance.now();
        tokenService.countTokens(systemPrompt);
        tokenService.countTokensBatch(messages);
        tiktokenSamples.push(performance.now() - start);

        start = performance.now();
        await vectorizationService.retrieveChatHistory('chat-1', queryText, 3, 0.6);
        ragSamples.push(performance.now() - start);

        start = performance.now();
        nGramJaccard(originalReply, newReply, 4);
        dedupSamples.push(performance.now() - start);
      }

      const tiktokenP95 = calculateP95(tiktokenSamples);
      const ragP95 = calculateP95(ragSamples);
      const dedupP95 = calculateP95(dedupSamples);
      const total = tiktokenP95 + ragP95 + dedupP95;

      perfLog(
        `[perf] 各项 P95: tiktoken=${tiktokenP95.toFixed(3)}ms, ` +
        `RAG=${ragP95.toFixed(3)}ms, dedup=${dedupP95.toFixed(3)}ms, ` +
        `total=${total.toFixed(3)}ms`
      );

      // 各项都应远低于各自的 spec 阈值
      expect(tiktokenP95).toBeLessThan(100);
      expect(dedupP95).toBeLessThan(50);
      expect(ragP95).toBeLessThan(200);
      // 总和应 < 500ms
      expect(total).toBeLessThan(500);
    });
  });

  // ============================================================
  // 5. 性能数据汇总（非断言，仅输出报告）
  // ============================================================
  describe('5. 性能数据汇总报告', () => {
    it('输出性能基准数据供文档记录', async () => {
      await tokenService.warmup();

      const text100 = makeChineseText(100);
      const text500 = makeChineseText(500);
      const text2000 = makeChineseText(2000);
      const textPair500A = '春暖花开的时节，万物复苏。'.repeat(20).slice(0, 500);
      const textPair500B = '春暖花开的时节，秋意盎然。'.repeat(20).slice(0, 500);

      // 预热
      tokenService.countTokens(text100);
      tokenService.countTokens(text500);
      tokenService.countTokens(text2000);
      nGramJaccard(textPair500A, textPair500B, 4);
      await vectorizationService.retrieveChatHistory('chat-1', text100, 3, 0.6);

      // 测量各场景 P95
      const measure = (fn: () => void | Promise<void>, n: number): { p95: number; avg: number } => {
        const samples: number[] = [];
        // 同步与异步统一处理：用 IIFE 包裹
        return (function syncMeasure(): { p95: number; avg: number } {
          for (let i = 0; i < n; i++) {
            const start = performance.now();
            fn();
            samples.push(performance.now() - start);
          }
          return { p95: calculateP95(samples), avg: calculateAvg(samples) };
        })();
      };

      const measureAsync = async (
        fn: () => Promise<void>,
        n: number
      ): Promise<{ p95: number; avg: number }> => {
        const samples: number[] = [];
        for (let i = 0; i < n; i++) {
          const start = performance.now();
          await fn();
          samples.push(performance.now() - start);
        }
        return { p95: calculateP95(samples), avg: calculateAvg(samples) };
      };

      const tiktoken100 = measure(() => tokenService.countTokens(text100), 30);
      const tiktoken500 = measure(() => tokenService.countTokens(text500), 30);
      const tiktoken2000 = measure(() => tokenService.countTokens(text2000), 30);
      const jaccard500 = measure(() => nGramJaccard(textPair500A, textPair500B, 4), 30);
      const rag = await measureAsync(
        () => vectorizationService.retrieveChatHistory('chat-1', text100, 3, 0.6),
        30
      );

      perfLog('\n========== 性能基准数据汇总 (Task 11.5) ==========');
      perfLog(`tiktoken countTokens(100字)  P95: ${tiktoken100.p95.toFixed(3)}ms  avg: ${tiktoken100.avg.toFixed(3)}ms`);
      perfLog(`tiktoken countTokens(500字)  P95: ${tiktoken500.p95.toFixed(3)}ms  avg: ${tiktoken500.avg.toFixed(3)}ms`);
      perfLog(`tiktoken countTokens(2000字) P95: ${tiktoken2000.p95.toFixed(3)}ms  avg: ${tiktoken2000.avg.toFixed(3)}ms`);
      perfLog(`nGramJaccard(500字对)        P95: ${jaccard500.p95.toFixed(3)}ms  avg: ${jaccard500.avg.toFixed(3)}ms`);
      perfLog(`retrieveChatHistory          P95: ${rag.p95.toFixed(3)}ms  avg: ${rag.avg.toFixed(3)}ms`);
      perfLog(`综合估算（最坏）             P95: ${(tiktoken2000.p95 + rag.p95 + jaccard500.p95).toFixed(3)}ms`);
      perfLog('===================================================\n');

      // 验证所有指标满足 spec 阈值
      expect(tiktoken100.p95).toBeLessThan(100);
      expect(tiktoken500.p95).toBeLessThan(100);
      expect(tiktoken2000.p95).toBeLessThan(100);
      expect(jaccard500.p95).toBeLessThan(50);
      expect(rag.p95).toBeLessThan(200);
      expect(tiktoken2000.p95 + rag.p95 + jaccard500.p95).toBeLessThan(500);
    });
  });
});
