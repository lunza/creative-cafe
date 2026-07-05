/**
 * ChatVectorizationService 单元测试
 *
 * 验证目标（spec Task 7.7）：
 *   1. retrieveChatHistory 返回正确结构（mock 向量存储）
 *   2. vectorizeIncremental 跳过已向量化的 messageId
 *   3. retrieveChatHistory 失败时返回空数组（不抛异常）
 *   4. vectorizeIncremental 失败时不抛异常（仅记录日志）
 *
 * Spec: optimize-chat-ai-intelligence / Task 7.1 + 7.2 + 7.7
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock 依赖服务（必须在 import ChatVectorizationService 之前）
// 使用 vi.hoisted 确保 mock 在模块加载前已就绪
const mocks = vi.hoisted(() => {
  return {
    embeddingService: {
      generateEmbedding: vi.fn(),
    },
    vectorStoreService: {
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

vi.mock('../../services/EmbeddingService', () => ({
  embeddingService: mocks.embeddingService,
}));

vi.mock('../../services/VectorStoreService', () => ({
  vectorStoreService: mocks.vectorStoreService,
}));

vi.mock('../../services/VectorRegistryService', () => ({
  vectorRegistryService: mocks.vectorRegistryService,
}));

// 静音 console.error / console.warn 以保持测试输出整洁
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

import { ChatVectorizationService, ChatMessage } from '../ChatVectorizationService';

describe('ChatVectorizationService - retrieveChatHistory (Task 7.1 + 7.7)', () => {
  let service: ChatVectorizationService;

  beforeEach(() => {
    service = new ChatVectorizationService();
    vi.clearAllMocks();
  });

  it('should return formatted results when embedding and search succeed', async () => {
    // 模拟 embedding 成功
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });

    // 模拟向量搜索返回 3 条结果（其中 1 条低于 minScore 阈值）
    mocks.vectorStoreService.search.mockResolvedValue([
      {
        id: 'msg-1',
        score: 0.85,
        metadata: {
          text: '用户 [消息 0]: 你好，今天天气怎么样？',
          messageCreateDate: 1000,
        },
      },
      {
        id: 'msg-2',
        score: 0.75,
        metadata: {
          text: '助手 [消息 1]: 今天天气很好，阳光明媚。',
          messageCreateDate: 2000,
        },
      },
      {
        id: 'msg-3',
        score: 0.45, // 低于 minScore=0.6，应被过滤
        metadata: {
          text: '用户 [消息 2]: 那我们去散步吧。',
          messageCreateDate: 3000,
        },
      },
    ]);

    const result = await service.retrieveChatHistory('chat-123', '天气怎么样', 3, 0.6);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      content: '用户 [消息 0]: 你好，今天天气怎么样？',
      score: 0.85,
      timestamp: 1000,
    });
    expect(result[1]).toEqual({
      content: '助手 [消息 1]: 今天天气很好，阳光明媚。',
      score: 0.75,
      timestamp: 2000,
    });

    // 验证 embedding 调用参数
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalledWith('天气怎么样');
    // 验证 search 调用参数（候选数 = topK * 2 = 6）
    expect(mocks.vectorStoreService.search).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      6,
      { source: 'character_chat', characterId: 'chat-123' }
    );
  });

  it('should return results sorted by timestamp ascending (spec: 按时间顺序注入)', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });

    // 模拟搜索结果乱序（时间戳非升序）
    mocks.vectorStoreService.search.mockResolvedValue([
      {
        id: 'msg-late',
        score: 0.85,
        metadata: { text: '晚些的消息', messageCreateDate: 3000 },
      },
      {
        id: 'msg-early',
        score: 0.75,
        metadata: { text: '早期的消息', messageCreateDate: 1000 },
      },
      {
        id: 'msg-mid',
        score: 0.65,
        metadata: { text: '中间的消息', messageCreateDate: 2000 },
      },
    ]);

    const result = await service.retrieveChatHistory('chat-123', '查询', 3, 0.6);

    expect(result).toHaveLength(3);
    // 验证按时间升序排列
    expect(result[0].timestamp).toBe(1000);
    expect(result[1].timestamp).toBe(2000);
    expect(result[2].timestamp).toBe(3000);
    expect(result[0].content).toBe('早期的消息');
    expect(result[2].content).toBe('晚些的消息');
  });

  it('should return empty array when chatId is empty', async () => {
    const result = await service.retrieveChatHistory('', '查询', 3, 0.6);
    expect(result).toEqual([]);
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  it('should return empty array when queryText is empty or whitespace', async () => {
    expect(await service.retrieveChatHistory('chat-123', '', 3, 0.6)).toEqual([]);
    expect(await service.retrieveChatHistory('chat-123', '   ', 3, 0.6)).toEqual([]);
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  it('should return empty array when embedding generation fails (not throw)', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: false,
      error: 'API 不可用',
    });

    const result = await service.retrieveChatHistory('chat-123', '查询', 3, 0.6);
    expect(result).toEqual([]);
  });

  it('should return empty array when embedding throws (not throw, swallow error)', async () => {
    mocks.embeddingService.generateEmbedding.mockRejectedValue(new Error('Network error'));

    const result = await service.retrieveChatHistory('chat-123', '查询', 3, 0.6);
    // spec: 检索失败降级——返回空数组，不抛异常
    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('should return empty array when vectorStoreService.search throws', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });
    mocks.vectorStoreService.search.mockRejectedValue(new Error('Vector store unavailable'));

    const result = await service.retrieveChatHistory('chat-123', '查询', 3, 0.6);
    expect(result).toEqual([]);
  });

  it('should filter out items with empty content (metadata.text missing)', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });

    mocks.vectorStoreService.search.mockResolvedValue([
      {
        id: 'msg-1',
        score: 0.85,
        metadata: { text: '有效内容', messageCreateDate: 1000 },
      },
      {
        id: 'msg-2',
        score: 0.75,
        // metadata.text 缺失，应被过滤
        metadata: { messageCreateDate: 2000 },
      },
      {
        id: 'msg-3',
        score: 0.65,
        // text 为空字符串，应被过滤
        metadata: { text: '', messageCreateDate: 3000 },
      },
    ]);

    const result = await service.retrieveChatHistory('chat-123', '查询', 3, 0.6);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('有效内容');
  });

  it('should respect topK limit after minScore filtering', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });

    // 5 条都高于 minScore，但 topK=2 应只返回 2 条
    mocks.vectorStoreService.search.mockResolvedValue([
      { id: 'msg-1', score: 0.9, metadata: { text: '内容1', messageCreateDate: 1000 } },
      { id: 'msg-2', score: 0.85, metadata: { text: '内容2', messageCreateDate: 2000 } },
      { id: 'msg-3', score: 0.8, metadata: { text: '内容3', messageCreateDate: 3000 } },
      { id: 'msg-4', score: 0.75, metadata: { text: '内容4', messageCreateDate: 4000 } },
      { id: 'msg-5', score: 0.7, metadata: { text: '内容5', messageCreateDate: 5000 } },
    ]);

    const result = await service.retrieveChatHistory('chat-123', '查询', 2, 0.6);
    expect(result).toHaveLength(2);
  });

  it('should use default topK=3 and minScore=0.6 when not specified', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });

    mocks.vectorStoreService.search.mockResolvedValue([
      { id: 'msg-1', score: 0.55, metadata: { text: '低分', messageCreateDate: 1000 } },
      { id: 'msg-2', score: 0.65, metadata: { text: '及格', messageCreateDate: 2000 } },
    ]);

    // 不传 topK 和 minScore，应使用默认值
    const result = await service.retrieveChatHistory('chat-123', '查询');
    // 0.55 < 0.6（默认 minScore）应被过滤；0.65 >= 0.6 应保留
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.65);
  });
});

describe('ChatVectorizationService - vectorizeIncremental (Task 7.2 + 7.7)', () => {
  let service: ChatVectorizationService;

  beforeEach(() => {
    service = new ChatVectorizationService();
    vi.clearAllMocks();
    mocks.vectorStoreService.getById.mockResolvedValue(null); // 默认：消息未向量化
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: [0.1, 0.2, 0.3],
      dimension: 3,
    });
    mocks.vectorStoreService.add.mockResolvedValue(undefined);
    mocks.vectorStoreService.persist.mockResolvedValue(undefined);
    mocks.vectorRegistryService.getVectorFilesBySourceId.mockResolvedValue([]);
    mocks.vectorRegistryService.registerVectorFile.mockResolvedValue('registry-id');
    mocks.vectorRegistryService.updateVectorFile.mockResolvedValue(undefined);
  });

  it('should vectorize new messages (skip none when all are new)', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
      { role: 'assistant', content: '你好，很高兴见到你', id: 'msg-2', timestamp: 2000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    // 验证每条消息都调用了 getById 检查存在性
    expect(mocks.vectorStoreService.getById).toHaveBeenCalledTimes(2);
    expect(mocks.vectorStoreService.getById).toHaveBeenCalledWith('chat_chat-123_msg_msg-1');
    expect(mocks.vectorStoreService.getById).toHaveBeenCalledWith('chat_chat-123_msg_msg-2');

    // 验证每条消息都被向量化
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalledTimes(2);
    expect(mocks.vectorStoreService.add).toHaveBeenCalledTimes(2);
    expect(mocks.vectorStoreService.persist).toHaveBeenCalledTimes(1);
  });

  it('should skip already-vectorized messageId (idempotency)', async () => {
    // 模拟 msg-1 已存在（getById 返回非 null）
    mocks.vectorStoreService.getById.mockImplementation(async (id: string) => {
      if (id === 'chat_chat-123_msg_msg-1') {
        return { id, vector: [0.1, 0.2], metadata: {} };
      }
      return null;
    });

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
      { role: 'assistant', content: '你好，很高兴见到你', id: 'msg-2', timestamp: 2000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    // msg-1 已存在 → 跳过，不调用 generateEmbedding / add
    // msg-2 新消息 → 向量化
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(mocks.vectorStoreService.add).toHaveBeenCalledTimes(1);
    expect(mocks.vectorStoreService.add).toHaveBeenCalledWith(
      'chat_chat-123_msg_msg-2',
      [0.1, 0.2, 0.3],
      expect.objectContaining({
        messageId: 'msg-2',
        characterId: 'chat-123',
        isIncremental: true,
      })
    );
  });

  it('should skip empty content and system messages', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '', id: 'msg-1', timestamp: 1000 } as any, // 空内容
      { role: 'system', content: '系统消息', id: 'msg-2', timestamp: 2000 } as any, // system 角色
      { role: 'user', content: '   ', id: 'msg-3', timestamp: 3000 } as any, // 纯空白
      { role: 'assistant', content: '有效回复', id: 'msg-4', timestamp: 4000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    // 只有 msg-4 应被向量化
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(mocks.vectorStoreService.add).toHaveBeenCalledTimes(1);
    expect(mocks.vectorStoreService.add).toHaveBeenCalledWith(
      'chat_chat-123_msg_msg-4',
      expect.any(Array),
      expect.objectContaining({ messageId: 'msg-4' })
    );
  });

  it('should not throw when chatId is empty (just log and return)', async () => {
    await expect(service.vectorizeIncremental('', [])).resolves.toBeUndefined();
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  it('should not throw when messages is empty (just log and return)', async () => {
    await expect(service.vectorizeIncremental('chat-123', [])).resolves.toBeUndefined();
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  it('should not throw when embedding fails (swallow error, log only)', async () => {
    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: false,
      error: 'API 不可用',
    });

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
    ];

    // spec: "向量化失败不阻塞对话主流程（仅记录日志）"
    await expect(service.vectorizeIncremental('chat-123', messages)).resolves.toBeUndefined();
    expect(mocks.vectorStoreService.add).not.toHaveBeenCalled();
  });

  it('should not throw when vectorStoreService.add throws (swallow per-message error)', async () => {
    mocks.vectorStoreService.add.mockRejectedValue(new Error('Storage full'));

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
      { role: 'assistant', content: '回复', id: 'msg-2', timestamp: 2000 } as any,
    ];

    // 单条消息失败不应中断整个增量向量化，也不应抛异常
    await expect(service.vectorizeIncremental('chat-123', messages)).resolves.toBeUndefined();
    // 两条消息都尝试了 add
    expect(mocks.vectorStoreService.add).toHaveBeenCalledTimes(2);
  });

  it('should not throw on fatal error (swallow to not block main flow)', async () => {
    mocks.vectorStoreService.getById.mockRejectedValue(new Error('Fatal storage error'));

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
    ];

    // spec: 失败仅记录日志，不抛异常
    await expect(service.vectorizeIncremental('chat-123', messages)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('should update existing registry entry when present', async () => {
    // 模拟已存在 registry 条目
    mocks.vectorRegistryService.getVectorFilesBySourceId.mockResolvedValue([
      {
        id: 'existing-registry-id',
        sourceType: 'character_chat',
        sourceId: 'chat-123',
        vectorCount: 5,
      },
    ]);

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    // 验证调用 updateVectorFile 而非 registerVectorFile
    expect(mocks.vectorRegistryService.updateVectorFile).toHaveBeenCalledWith(
      'existing-registry-id',
      expect.objectContaining({
        vectorCount: 6, // 5 + 1
        updatedAt: expect.any(Number),
      })
    );
    expect(mocks.vectorRegistryService.registerVectorFile).not.toHaveBeenCalled();
  });

  it('should create new registry entry when none exists', async () => {
    mocks.vectorRegistryService.getVectorFilesBySourceId.mockResolvedValue([]);

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    expect(mocks.vectorRegistryService.registerVectorFile).toHaveBeenCalledWith(
      expect.objectContaining({
        vectorFileId: 'chat-123',
        sourceType: 'character_chat',
        vectorCount: 1,
      })
    );
    expect(mocks.vectorRegistryService.updateVectorFile).not.toHaveBeenCalled();
  });

  it('should use stable vectorId format chat_${chatId}_msg_${message.id}', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'unique-msg-id-123', timestamp: 1000 } as any,
    ];

    await service.vectorizeIncremental('chat-abc', messages);

    expect(mocks.vectorStoreService.getById).toHaveBeenCalledWith('chat_chat-abc_msg_unique-msg-id-123');
    expect(mocks.vectorStoreService.add).toHaveBeenCalledWith(
      'chat_chat-abc_msg_unique-msg-id-123',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('should fallback to index-based id when message.id is missing', async () => {
    // message.id 缺失，应使用 idx{index} 作为后备标识
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', timestamp: 1000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    expect(mocks.vectorStoreService.getById).toHaveBeenCalledWith('chat_chat-123_msg_idx0');
    expect(mocks.vectorStoreService.add).toHaveBeenCalledWith(
      'chat_chat-123_msg_idx0',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('should mark incremental vectors with isIncremental=true in metadata', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', id: 'msg-1', timestamp: 1000 } as any,
    ];

    await service.vectorizeIncremental('chat-123', messages);

    expect(mocks.vectorStoreService.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        isIncremental: true,
        sourceType: 'chat_message',
        characterId: 'chat-123',
      })
    );
  });
});

afterEach(() => {
  consoleErrorSpy.mockClear();
  consoleWarnSpy.mockClear();
  consoleLogSpy.mockClear();
});
