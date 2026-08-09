/**
 * TagRagService 单元测试
 *
 * Spec: rag-tag-library-for-ai-trait-generation / Task 11
 *
 * 验证目标：
 *   1. getStatus：初始状态为 idle；meta 恢复后为 ready
 *   2. searchRelevantTags：enabled=false / status!=='ready' / query 为空 → 返回空数组（降级）
 *   3. searchRelevantTags：正常路径下调用 embedding + vectorStore.search，按 minScore 过滤
 *   4. buildRagReferencePrompt：空数组返回空字符串；非空数组生成「标签库参考」段落
 *   5. buildRagReferenceSection：enabled=false / 异常 → 返回空字符串
 *   6. clearIndex：清空索引后状态转 idle，meta 文件被删除
 *   7. cancelVectorization：无进行中任务时返回 success=false
 *
 * 测试策略：
 *   - 全部依赖服务 mock（embeddingService / vectorStoreService / vectorConfigManager /
 *     tagAutocompleteService / tagCsvEmitter / tagRagProgressEmitter / storageService）
 *   - 与 ChatVectorizationService.test.ts 模式一致，使用 vi.hoisted 确保 mock 在 import 前就绪
 *   - 不依赖真实 sqlite-vec / better-sqlite3 原生模块
 *
 * ⚠️ 真实行为依赖 Electron 集成测试（与 SqliteVecBackend.test.ts 一致约定）：
 *   - vec0 MATCH KNN 查询语义未验证（FakeVectorDb 已 mock search 返回值）
 *   - 维度变更触发 stale 的事件链路未验证（需 Electron app 生命周期）
 *   - 向量数据落盘到 userData/vectors/tag_library/<csvHash>/<dim>/vectors.db 未验证
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ============ Mock fs（ESM 模块不能用 vi.spyOn，必须用 vi.mock）============
// 仅 mock 需要的 API，其他保留真实实现（crypto 通过 require 动态加载，Node 内置）
const fsMocks = vi.hoisted(() => {
  return {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(() => ({
      size: 8 * 1024 * 1024,
      mtimeMs: Date.now(),
    })),
    renameSync: vi.fn(),
  };
});

vi.mock('fs', () => ({
  ...fsMocks,
  // 保留未 mock 的 API（如 createReadStream 等）的兜底
  default: {
    ...fsMocks,
  },
}));

// ============ Mock electron ============
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-tagrag-userdata'),
  },
}));

// ============ Hoisted mocks（确保在 import TagRagService 前就绪）============
const mocks = vi.hoisted(() => {
  return {
    embeddingService: {
      generateEmbedding: vi.fn(),
      generateBatchEmbeddings: vi.fn(),
    },
    vectorStoreService: {
      search: vi.fn(),
      addBatch: vi.fn(),
      getVecstoreStoreForSource: vi.fn(() => ({
        destroyAndDeleteFiles: vi.fn().mockResolvedValue(undefined),
      })),
      removeStoreFromCache: vi.fn(),
    },
    vectorConfigManager: {
      get: vi.fn((key: string, defaultValue?: any) => {
        // 默认返回 remote 模式 + 1536 维 + text-embedding-3-small
        if (key === 'embeddingMode') return 'remote';
        if (key === 'dimension') return 1536;
        if (key === 'remoteModel') return 'text-embedding-3-small';
        if (key === 'localModel') return 'local-onnx';
        return defaultValue;
      }),
      onDimensionChange: vi.fn(() => () => {}), // 返回 unregister 函数
    },
    tagAutocompleteService: {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getAllTags: vi.fn(() => []),
      // L1 name 查询：默认未命中（具体测试用 mockImplementation 注入 nameMap）
      getTagByName: vi.fn<(s: string) => any>(() => null),
      // L2 alias 查询：默认未命中（具体测试用 mockImplementation 注入 aliasMap）
      getTagByAlias: vi.fn<(s: string) => any>(() => null),
      // csvPath 留空：使 computeCsvHash 返回 ''，触发 computeFreshness 中的
      // `if (currentCsvHash && ...)` 短路，跳过 csvHash 比对，避免测试中误判 stale
      getLoadStatus: vi.fn(() => ({
        loaded: true,
        loading: false,
        totalCount: 0,
        csvPath: '',
        error: undefined,
      })),
    },
    tagCsvEmitter: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    tagRagProgressEmitter: {
      emit: vi.fn(),
      emitComplete: vi.fn(),
      emitError: vi.fn(),
      emitCancelled: vi.fn(),
    },
    storageService: {
      getSettings: vi.fn(() => ({
        tagRag: {
          enabled: true,
          topK: 40,
          minScore: 0.15,
          autoRevectorizeOnCsvChange: true,
          autoRevectorizeOnDimensionChange: true,
          batchSize: 100,
          localBatchSize: 32,
          concurrency: 3,
          retryMaxAttempts: 3,
          retryDelayMs: 1000,
        },
      })),
    },
    // L0 自定义同义词映射服务（Spec: add-multi-round-tag-audit / Task 1）
    // 默认 lookup 返回 null（L0 未命中 → 走 L1-L4）
    // 具体测试用 vi.mocked(userSynonymMapService.lookup).mockReturnValue(...) 注入
    userSynonymMapService: {
      lookup: vi.fn(() => null),
      load: vi.fn(() => new Map<string, string>()),
      getMap: vi.fn(() => ({})),
      addMapping: vi.fn(),
      removeMapping: vi.fn(),
    },
  };
});

vi.mock('../EmbeddingService', () => ({
  embeddingService: mocks.embeddingService,
}));

vi.mock('../VectorStoreService', () => ({
  vectorStoreService: mocks.vectorStoreService,
}));

vi.mock('../VectorConfigManager', () => ({
  vectorConfigManager: mocks.vectorConfigManager,
}));

vi.mock('../tagAutocompleteService', () => ({
  tagAutocompleteService: mocks.tagAutocompleteService,
  tagCsvEmitter: mocks.tagCsvEmitter,
}));

vi.mock('../tagRagProgressEmitter', () => ({
  tagRagProgressEmitter: mocks.tagRagProgressEmitter,
}));

vi.mock('../storageService', () => ({
  getStorageService: () => mocks.storageService,
}));

// Mock userSynonymMapService（Spec: add-multi-round-tag-audit / Task 5 / SubTask 5.1）
// tagRagService.ts 通过 `import { userSynonymMapService } from './userSynonymMapService'` 引入，
// 需 mock 整个模块以控制 L0 lookup 行为。
// 默认 lookup 返回 null（L0 未命中），具体测试用 vi.mocked(...).mockReturnValue(...) 注入。
vi.mock('../userSynonymMapService', () => ({
  userSynonymMapService: mocks.userSynonymMapService,
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// 静音 console（console 是全局对象，可用 spyOn）
vi.spyOn(console, 'log').mockImplementation(() => undefined);
vi.spyOn(console, 'warn').mockImplementation(() => undefined);
vi.spyOn(console, 'error').mockImplementation(() => undefined);
vi.spyOn(console, 'info').mockImplementation(() => undefined);

// crypto 模块（computeCsvHash 使用 require('crypto')，Node 内置，无需 mock）

import { tagRagService, stripColorModifier, splitColorTag, stripNegationModifier } from '../tagRagService';
import { userSynonymMapService } from '../userSynonymMapService';
import type { TagRagSearchResultItem } from '../../../shared/types/tagRag.types';

describe('TagRagService - 单元测试（Spec: rag-tag-library-for-ai-trait-generation / Task 11）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：fs 文件不存在（meta 未初始化）
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('{}');
    // 默认 mock：embedding 模式为 remote，1536 维
    mocks.vectorConfigManager.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'embeddingMode') return 'remote';
      if (key === 'dimension') return 1536;
      if (key === 'remoteModel') return 'text-embedding-3-small';
      if (key === 'localModel') return 'local-onnx';
      return defaultValue;
    });
    // 默认 mock：tagRag.enabled = true
    mocks.storageService.getSettings.mockReturnValue({
      tagRag: {
        enabled: true,
        topK: 40,
        minScore: 0.15,
        autoRevectorizeOnCsvChange: true,
        autoRevectorizeOnDimensionChange: true,
        batchSize: 100,
        localBatchSize: 32,
        concurrency: 3,
        retryMaxAttempts: 3,
        retryDelayMs: 1000,
      },
    });
    // 默认 mock：L0 自定义映射未命中（vi.clearAllMocks 不重置 mockReturnValue，需显式重置）
    vi.mocked(userSynonymMapService.lookup).mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== getStatus ====================

  describe('getStatus', () => {
    it('初始状态（无 meta 文件）应为 idle', () => {
      const status = tagRagService.getStatus();
      expect(status.status).toBe('idle');
      expect(status.current).toBe(0);
      expect(status.total).toBe(0);
      expect(status.failedCount).toBe(0);
      expect(status.meta).toBeNull();
    });

    it('meta 文件存在且 ready 时应恢复为 ready', () => {
      // 模拟 meta 文件已存在
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          csvHash: 'abc123def456',
          dimension: 1536,
          model: 'text-embedding-3-small',
          totalTags: 317600,
          vectorizedCount: 317600,
          failedCount: 0,
          lastVectorizedAt: Date.now(),
          durationMs: 3600000,
          status: 'ready',
        })
      );
      // 重新 initialize 触发 meta 恢复
      tagRagService.initialize();
      const status = tagRagService.getStatus();
      expect(status.status).toBe('ready');
      expect(status.meta).not.toBeNull();
      expect(status.meta?.csvHash).toBe('abc123def456');
      expect(status.meta?.vectorizedCount).toBe(317600);
    });

    it('meta 文件中 dimension 与当前不匹配时应降级为 stale', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          csvHash: 'abc123def456',
          dimension: 768, // 与当前 mock 的 1536 不匹配
          model: 'text-embedding-3-small',
          totalTags: 317600,
          vectorizedCount: 317600,
          failedCount: 0,
          lastVectorizedAt: Date.now(),
          durationMs: 3600000,
          status: 'ready',
        })
      );
      tagRagService.initialize();
      const status = tagRagService.getStatus();
      expect(status.status).toBe('stale');
    });
  });

  // ==================== searchRelevantTags ====================

  describe('searchRelevantTags', () => {
    beforeEach(() => {
      // 让 initialize 后状态为 ready
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          csvHash: 'abc123def456',
          dimension: 1536,
          model: 'text-embedding-3-small',
          totalTags: 317600,
          vectorizedCount: 317600,
          failedCount: 0,
          lastVectorizedAt: Date.now(),
          durationMs: 3600000,
          status: 'ready',
        })
      );
      tagRagService.initialize();
    });

    it('enabled=false 时应返回空数组（降级）', async () => {
      mocks.storageService.getSettings.mockReturnValue({
        tagRag: { enabled: false, topK: 40, minScore: 0.15, autoRevectorizeOnCsvChange: true, autoRevectorizeOnDimensionChange: true, batchSize: 100, localBatchSize: 32, concurrency: 3, retryMaxAttempts: 3, retryDelayMs: 1000 },
      });
      const results = await tagRagService.searchRelevantTags({ query: '白色毛发的犬耳少女' });
      expect(results).toEqual([]);
      expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('query 为空时应返回空数组', async () => {
      const results = await tagRagService.searchRelevantTags({ query: '' });
      expect(results).toEqual([]);
      expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('query 为空白时应返回空数组', async () => {
      const results = await tagRagService.searchRelevantTags({ query: '   ' });
      expect(results).toEqual([]);
      expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('status 非 ready（stale）时应返回空数组', async () => {
      // 修改 dimension 使状态变为 stale
      mocks.vectorConfigManager.get.mockImplementation((key: string) => {
        if (key === 'dimension') return 768; // 与 meta.dimension=1536 不匹配
        if (key === 'embeddingMode') return 'remote';
        if (key === 'remoteModel') return 'text-embedding-3-small';
        return undefined;
      });
      const results = await tagRagService.searchRelevantTags({ query: 'test' });
      expect(results).toEqual([]);
    });

    it('embedding 失败时应返回空数组', async () => {
      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: false,
        error: 'API 调用失败',
      });
      const results = await tagRagService.searchRelevantTags({ query: 'test' });
      expect(results).toEqual([]);
    });

    it('维度不匹配时应返回空数组', async () => {
      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: true,
        vector: [0.1, 0.2, 0.3], // 3 维，与 meta.dimension=1536 不匹配
        dimension: 3,
      });
      const results = await tagRagService.searchRelevantTags({ query: 'test' });
      expect(results).toEqual([]);
    });

    it('正常路径下应返回过滤后的结果（按 minScore 过滤）', async () => {
      // 1536 维向量
      const queryVec = new Array(1536).fill(0.1);
      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: true,
        vector: queryVec,
        dimension: 1536,
      });
      mocks.vectorStoreService.search.mockResolvedValue([
        {
          id: 'tag:white_fur',
          score: 0.85,
          metadata: {
            tagName: 'white_fur',
            category: 0,
            count: 892341,
            aliases: ['white hair'],
          },
        },
        {
          id: 'tag:dog_girl',
          score: 0.75,
          metadata: {
            tagName: 'dog_girl',
            category: 4,
            count: 456789,
            aliases: [],
          },
        },
        {
          id: 'tag:low_score_tag',
          score: 0.10, // 低于 minScore=0.15
          metadata: {
            tagName: 'low_score_tag',
            category: 0,
            count: 100,
            aliases: [],
          },
        },
      ]);

      const results = await tagRagService.searchRelevantTags({ query: '白色毛发的犬耳少女' });

      expect(results).toHaveLength(2); // 过滤掉 score=0.10 的
      expect(results[0].name).toBe('white_fur');
      expect(results[0].score).toBe(0.85);
      expect(results[1].name).toBe('dog_girl');
      expect(mocks.vectorStoreService.search).toHaveBeenCalledWith(
        queryVec,
        40, // 默认 topK
        undefined,
        { sourceType: 'tag_library' }
      );
    });

    it('categoryFilter 应过滤指定分类', async () => {
      const queryVec = new Array(1536).fill(0.1);
      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: true,
        vector: queryVec,
        dimension: 1536,
      });
      mocks.vectorStoreService.search.mockResolvedValue([
        {
          id: 'tag:white_fur',
          score: 0.85,
          metadata: { tagName: 'white_fur', category: 0, count: 100, aliases: [] },
        },
        {
          id: 'tag:dog_girl',
          score: 0.75,
          metadata: { tagName: 'dog_girl', category: 4, count: 200, aliases: [] }, // character 分类
        },
      ]);

      const results = await tagRagService.searchRelevantTags({
        query: 'test',
        categoryFilter: [0], // 仅 general 分类
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('white_fur');
    });

    it('topK 应受用户参数控制', async () => {
      const queryVec = new Array(1536).fill(0.1);
      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: true,
        vector: queryVec,
        dimension: 1536,
      });
      mocks.vectorStoreService.search.mockResolvedValue([]);

      await tagRagService.searchRelevantTags({ query: 'test', topK: 20 });
      expect(mocks.vectorStoreService.search).toHaveBeenCalledWith(
        queryVec,
        20,
        undefined,
        { sourceType: 'tag_library' }
      );
    });

    it('vectorStore.search 异常时应返回空数组（不抛错）', async () => {
      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: true,
        vector: new Array(1536).fill(0.1),
        dimension: 1536,
      });
      mocks.vectorStoreService.search.mockRejectedValue(new Error('DB error'));
      const results = await tagRagService.searchRelevantTags({ query: 'test' });
      expect(results).toEqual([]);
    });
  });

  // ==================== buildRagReferencePrompt ====================

  describe('buildRagReferencePrompt', () => {
    it('空数组应返回空字符串', () => {
      const result = tagRagService.buildRagReferencePrompt([]);
      expect(result).toBe('');
    });

    it('null 应返回空字符串', () => {
      const result = tagRagService.buildRagReferencePrompt(null as unknown as TagRagSearchResultItem[]);
      expect(result).toBe('');
    });

    it('非空数组应生成「标签库参考」段落', () => {
      const tags: TagRagSearchResultItem[] = [
        { name: 'white_fur', category: 0, count: 892341, aliases: [], score: 0.85 },
        { name: 'dog_girl', category: 4, count: 456789, aliases: [], score: 0.75 },
      ];
      const result = tagRagService.buildRagReferencePrompt(tags);
      expect(result).toContain('【标签库参考】');
      expect(result).toContain('white_fur');
      expect(result).toContain('(892341)'); // count
      expect(result).toContain('dog_girl');
      expect(result).toContain('共 2 条');
      expect(result).toContain('下划线连接');
    });

    it('count=0 时不显示括号', () => {
      const tags: TagRagSearchResultItem[] = [
        { name: 'rare_tag', category: 0, count: 0, aliases: [], score: 0.5 },
      ];
      const result = tagRagService.buildRagReferencePrompt(tags);
      expect(result).toContain('rare_tag');
      expect(result).not.toContain('(0)');
    });
  });

  // ==================== buildRagReferenceSection ====================

  describe('buildRagReferenceSection', () => {
    it('enabled=false 时应返回空字符串', async () => {
      mocks.storageService.getSettings.mockReturnValue({
        tagRag: { enabled: false, topK: 40, minScore: 0.15, autoRevectorizeOnCsvChange: true, autoRevectorizeOnDimensionChange: true, batchSize: 100, localBatchSize: 32, concurrency: 3, retryMaxAttempts: 3, retryDelayMs: 1000 },
      });
      const result = await tagRagService.buildRagReferenceSection('测试描述');
      expect(result).toBe('');
    });

    it('queryText 为空时应返回空字符串', async () => {
      const result = await tagRagService.buildRagReferenceSection('');
      expect(result).toBe('');
    });

    it('正常路径应返回非空段落', async () => {
      // 让 initialize 后状态为 ready
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          csvHash: 'abc123def456',
          dimension: 1536,
          model: 'text-embedding-3-small',
          totalTags: 317600,
          vectorizedCount: 317600,
          failedCount: 0,
          lastVectorizedAt: Date.now(),
          durationMs: 3600000,
          status: 'ready',
        })
      );
      tagRagService.initialize();

      mocks.embeddingService.generateEmbedding.mockResolvedValue({
        success: true,
        vector: new Array(1536).fill(0.1),
        dimension: 1536,
      });
      mocks.vectorStoreService.search.mockResolvedValue([
        {
          id: 'tag:white_fur',
          score: 0.85,
          metadata: { tagName: 'white_fur', category: 0, count: 892341, aliases: [] },
        },
      ]);

      const result = await tagRagService.buildRagReferenceSection('白色毛发的角色');
      expect(result).toContain('【标签库参考】');
      expect(result).toContain('white_fur');
    });
  });

  // ==================== cancelVectorization ====================

  describe('cancelVectorization', () => {
    it('无进行中的向量化任务时应返回 success=false', () => {
      // 初始状态为 idle（未向量化）
      const result = tagRagService.cancelVectorization();
      expect(result.success).toBe(false);
    });
  });

  // ==================== clearIndex ====================

  describe('clearIndex', () => {
    it('未向量化时（无 meta）应返回 success=true 且状态为 idle', async () => {
      const result = await tagRagService.clearIndex();
      expect(result.success).toBe(true);
      const status = tagRagService.getStatus();
      expect(status.status).toBe('idle');
      expect(status.meta).toBeNull();
    });

    it('meta 存在时应调用 destroyAndDeleteFiles 并删除 meta 文件', async () => {
      // 先恢复 ready 状态
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          csvHash: 'abc123def456',
          dimension: 1536,
          model: 'text-embedding-3-small',
          totalTags: 317600,
          vectorizedCount: 317600,
          failedCount: 0,
          lastVectorizedAt: Date.now(),
          durationMs: 3600000,
          status: 'ready',
        })
      );
      tagRagService.initialize();

      // clearIndex 时 mock fs.existsSync 返回 true（meta 文件存在）
      fsMocks.existsSync.mockReturnValue(true);

      const result = await tagRagService.clearIndex();
      expect(result.success).toBe(true);
      expect(mocks.vectorStoreService.getVecstoreStoreForSource).toHaveBeenCalled();
      expect(fsMocks.unlinkSync).toHaveBeenCalled();
      const status = tagRagService.getStatus();
      expect(status.status).toBe('idle');
      expect(status.meta).toBeNull();
    });
  });

  // ==================== initialize（事件监听）====================

  describe('initialize', () => {
    it('应注册 tagCsvEmitter 与 vectorConfigManager 的事件监听', () => {
      tagRagService.initialize();
      expect(mocks.tagCsvEmitter.on).toHaveBeenCalledWith('tag-csv-loaded', expect.any(Function));
      expect(mocks.vectorConfigManager.onDimensionChange).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});

// ============================================================================
// Spec: enhance-tag-synonym-matching / Task 3
// 以下测试块覆盖 stripColorModifier（SubTask 3.2）与 validateTagsAgainstLibrary
// 四层降级匹配（SubTask 3.3），验证用户反馈的 7 个 tag 全部命中。
// ============================================================================

// ==================== stripColorModifier（纯函数，SubTask 3.2）====================

describe('stripColorModifier - 颜色前缀剥离（Spec: enhance-tag-synonym-matching / Task 3）', () => {
  it('light gray drooping ears → drooping ears（剥离 light gray）', () => {
    expect(stripColorModifier('light gray drooping ears')).toBe('drooping ears');
  });

  it('black eyelashes → eyelashes（剥离 black）', () => {
    expect(stripColorModifier('black eyelashes')).toBe('eyelashes');
  });

  it('slender → 空串（无可剥离颜色前缀，返回空串）', () => {
    expect(stripColorModifier('slender')).toBe('');
  });

  it('blue eyes → eyes（剥离 blue）', () => {
    expect(stripColorModifier('blue eyes')).toBe('eyes');
  });

  it('light_gray_drooping_ears → drooping_ears（下划线分隔符兼容）', () => {
    expect(stripColorModifier('light_gray_drooping_ears')).toBe('drooping_ears');
  });

  it('black → 空串（纯颜色词，核心词为空）', () => {
    expect(stripColorModifier('black')).toBe('');
  });

  it('空入参 → 空串', () => {
    expect(stripColorModifier('')).toBe('');
  });
});

// ==================== validateTagsAgainstLibrary 同义词/颜色剥离匹配（SubTask 3.3）====================

describe('validateTagsAgainstLibrary - 同义词/颜色剥离匹配（Spec: enhance-tag-synonym-matching）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：fs 文件不存在（meta 未初始化），确保 validateTagsAgainstLibrary 不依赖 fs 状态
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('{}');
    // 默认 mock：L0 自定义映射未命中（确保走 L1-L4 降级链）
    vi.mocked(userSynonymMapService.lookup).mockReturnValue(null);
  });

  /**
   * 配置 mock：getTagByName 命中 L3 颜色剥离后的核心词（下划线形式），
   * getTagByAlias 命中 L2 同义词（下划线形式）。
   *
   * L1 nameMap：仅 L3 颜色剥离后核心词能命中（原始带颜色前缀的 tag 不在 nameMap 中）
   * L2 aliasMap：slender→slim、light_gray_hair→grey_hair、black_eyelashes→eyelashes
   */
  function configureMockForSevenTags(): void {
    // L1 name 命中 L3 颜色剥离后的核心词（下划线形式）
    const nameMap = new Map([
      ['drooping_ears', { name: 'drooping_ears', category: 7, count: 34, aliases: [] }],
      ['beanie', { name: 'beanie', category: 0, count: 46285, aliases: ['beanie_hat'] }],
      ['short_tail', { name: 'short_tail', category: 0, count: 81568, aliases: ['stub_tail'] }],
      ['open_hoodie', { name: 'open_hoodie', category: 0, count: 10875, aliases: [] }],
    ]);
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) =>
      nameMap.get(n.toLowerCase()) ?? null
    );

    // L2 alias 命中同义词（下划线形式）
    const aliasMap = new Map([
      ['light_gray_hair', { name: 'grey_hair', category: 0, count: 984236, aliases: ['light_gray_hair'] }],
      ['black_eyelashes', { name: 'eyelashes', category: 0, count: 590607, aliases: ['black_eyelashes'] }],
      ['slender', { name: 'slim', category: 7, count: 41092, aliases: ['slender'] }],
    ]);
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation((a: string) =>
      aliasMap.get(a.toLowerCase()) ?? null
    );
  }

  it('用户反馈的 7 个 tag 全部命中（L2 alias + L3 颜色剥离）', async () => {
    configureMockForSevenTags();

    const results = await tagRagService.validateTagsAgainstLibrary([
      'light gray hair',           // L2 alias → grey_hair
      'light gray drooping ears',  // L3 颜色剥离 → drooping_ears
      'light gray beanie',         // L3 → beanie
      'black eyelashes',           // L2 alias → eyelashes
      'slender',                   // L2 alias → slim
      'light gray short tail',     // L3 → short_tail
      'light gray open hoodie',    // L3 → open_hoodie
    ]);

    expect(results).toHaveLength(7);
    // 全部 isValid=true（7 个 tag 均在 L1-L3 命中，无需 L4 语义 KNN）
    expect(results.every((r) => r.isValid)).toBe(true);
    // 逐个验证 canonicalName
    expect(results[0].canonicalName).toBe('grey_hair');
    expect(results[1].canonicalName).toBe('drooping_ears');
    expect(results[2].canonicalName).toBe('beanie');
    expect(results[3].canonicalName).toBe('eyelashes');
    expect(results[4].canonicalName).toBe('slim');
    expect(results[5].canonicalName).toBe('short_tail');
    expect(results[6].canonicalName).toBe('open_hoodie');
    // valid tag 的 suggestions 应为空数组
    expect(results.every((r) => r.suggestions.length === 0)).toBe(true);
    // 7 个 tag 全部命中，needSuggestionIndices 为空，L4 语义 KNN 不应执行
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  it('L1 name 命中的 tag 不退化：blue_eyes 仍 isValid=true 且 canonicalName=blue_eyes', async () => {
    // 仅配置 L1 name 命中 blue_eyes（不配置 aliasMap）
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) => {
      const map = new Map([
        ['blue_eyes', { name: 'blue_eyes', category: 0, count: 382345, aliases: ['blue eye'] }],
      ]);
      return map.get(n.toLowerCase()) ?? null;
    });
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    const results = await tagRagService.validateTagsAgainstLibrary(['blue_eyes']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('blue_eyes');
    expect(results[0].category).toBe(0);
    expect(results[0].count).toBe(382345);
    // L1 命中后不应再调用 getTagByAlias（L2 不触发）
    expect(mocks.tagAutocompleteService.getTagByAlias).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Spec: refine-color-tag-splitting / Task 5
// 以下测试块覆盖 splitColorTag（SubTask 5.1）与 validateTagsAgainstLibrary
// 颜色拆分场景（SubTask 5.2），验证 L3 从「颜色剥离丢弃」升级为「颜色拆分保留」。
//
// ⚠️ 真实行为依赖 Electron 集成测试（与上方块一致约定）：
//   - L3 拆分两条都命中 → splitTags 携带 colorPartTag+featureTag（单元测试用 mock tagMap 验证逻辑）
//   - vec0 MATCH KNN 语义未验证（FakeVectorDb 已 mock search 返回值）
// ============================================================================

// ==================== splitColorTag（纯函数，SubTask 5.1）====================

describe('splitColorTag - 颜色复合 tag 拆分（Spec: refine-color-tag-splitting / Task 5）', () => {
  it('light gray drooping ears → grey_ears + drooping_ears（亮度词 light 丢弃 + gray→grey 归一化）', () => {
    expect(splitColorTag('light gray drooping ears')).toEqual({
      baseColor: 'grey',
      feature: 'drooping_ears',
      partWord: 'ears',
      colorPartTag: 'grey_ears',
    });
  });

  it('light gray short tail → grey_tail + short_tail', () => {
    expect(splitColorTag('light gray short tail')).toEqual({
      baseColor: 'grey',
      feature: 'short_tail',
      partWord: 'tail',
      colorPartTag: 'grey_tail',
    });
  });

  it('black → null（纯颜色词，无核心特征可拆分）', () => {
    expect(splitColorTag('black')).toBeNull();
  });

  it('slender → null（开头非颜色前缀）', () => {
    expect(splitColorTag('slender')).toBeNull();
  });

  it('blue eyes → blue_eyes + eyes（无亮度词，颜色即首词）', () => {
    expect(splitColorTag('blue eyes')).toEqual({
      baseColor: 'blue',
      feature: 'eyes',
      partWord: 'eyes',
      colorPartTag: 'blue_eyes',
    });
  });

  it('dark gray hair → grey_hair + hair（亮度词 dark 丢弃 + gray→grey 归一化）', () => {
    expect(splitColorTag('dark gray hair')).toEqual({
      baseColor: 'grey',
      feature: 'hair',
      partWord: 'hair',
      colorPartTag: 'grey_hair',
    });
  });
});

// ==================== validateTagsAgainstLibrary 颜色拆分场景（SubTask 5.2）====================

describe('validateTagsAgainstLibrary - 颜色拆分场景（Spec: refine-color-tag-splitting / Task 5）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：fs 文件不存在（meta 未初始化），确保 validateTagsAgainstLibrary 不依赖 fs 状态
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('{}');
    // 默认 mock：L0 自定义映射未命中（确保走 L1-L4 降级链）
    vi.mocked(userSynonymMapService.lookup).mockReturnValue(null);
  });

  /**
   * 场景一：colorPartTag 与 feature 都在标签库（name 或 alias）命中
   * → isValid=true, canonicalName=feature, splitTags={colorPartTag, featureTag}
   */
  it('L3 拆分两条都命中 → isValid=true, canonicalName=feature, splitTags 携带 colorPartTag+featureTag', async () => {
    // mock nameMap 同时含 grey_ears 与 drooping_ears（colorPartTag + feature 都命中 L1 name）
    const nameMap = new Map([
      ['grey_ears', { name: 'grey_ears', category: 0, count: 11299, aliases: [] }],
      ['drooping_ears', { name: 'drooping_ears', category: 7, count: 34, aliases: [] }],
    ]);
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) =>
      nameMap.get(n.toLowerCase()) ?? null
    );
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    const results = await tagRagService.validateTagsAgainstLibrary([
      'light gray drooping ears',
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('drooping_ears');
    expect(results[0].splitTags).toEqual({
      colorPartTag: 'grey_ears',
      featureTag: 'drooping_ears',
    });
    // 已在 L3 命中，L4 语义 KNN 不应执行
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  /**
   * 场景二：仅 feature 命中（不含 colorPartTag）
   * → isValid=true, canonicalName=feature, splitTags=undefined（退化为原「剥离丢弃颜色」行为）
   */
  it('L3 仅 feature 命中（不含 colorPartTag）→ isValid=true, canonicalName=feature, splitTags=undefined（退化为剥离行为）', async () => {
    // mock 仅含 drooping_ears（不含 grey_ears）→ 仅 feature 命中，无 splitTags
    const nameMap = new Map([
      ['drooping_ears', { name: 'drooping_ears', category: 7, count: 34, aliases: [] }],
    ]);
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) =>
      nameMap.get(n.toLowerCase()) ?? null
    );
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    const results = await tagRagService.validateTagsAgainstLibrary([
      'light gray drooping ears',
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('drooping_ears');
    // 仅 feature 命中 → 退化为原剥离丢弃颜色行为，不携带 splitTags
    expect(results[0].splitTags).toBeUndefined();
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  /**
   * 场景三：colorPartTag 与 feature 都不命中 → 走 L4 语义 KNN
   * → isValid=false, splitTags=undefined, 有 suggestions
   */
  it('L3 colorPartTag 与 feature 都不命中 → 走 L4 语义 KNN（isValid=false，有 suggestions）', async () => {
    // mock 不含 grey_ears 也不含 drooping_ears → L3 拆分后两条都未命中 → 走 L4
    mocks.tagAutocompleteService.getTagByName.mockImplementation(() => null);
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    // 让 searchRelevantTags 可执行：status 需为 'ready'（恢复 meta 文件）
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        csvHash: 'abc123def456',
        dimension: 1536,
        model: 'text-embedding-3-small',
        totalTags: 317600,
        vectorizedCount: 317600,
        failedCount: 0,
        lastVectorizedAt: Date.now(),
        durationMs: 3600000,
        status: 'ready',
      })
    );
    tagRagService.initialize();

    // 重申 embedding 配置（clearAllMocks 后确保实现就绪）
    mocks.vectorConfigManager.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'embeddingMode') return 'remote';
      if (key === 'dimension') return 1536;
      if (key === 'remoteModel') return 'text-embedding-3-small';
      if (key === 'localModel') return 'local-onnx';
      return defaultValue;
    });

    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: new Array(1536).fill(0.1),
      dimension: 1536,
    });
    mocks.vectorStoreService.search.mockResolvedValue([
      {
        id: 'tag:grey_ears',
        score: 0.82,
        metadata: { tagName: 'grey_ears', category: 0, count: 11299, aliases: [] },
      },
      {
        id: 'tag:drooping_ears',
        score: 0.71,
        metadata: { tagName: 'drooping_ears', category: 7, count: 34, aliases: [] },
      },
    ]);

    const results = await tagRagService.validateTagsAgainstLibrary([
      'light gray drooping ears',
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(false);
    expect(results[0].splitTags).toBeUndefined();
    // 走 L4 → 触发 embedding + KNN，返回 suggestions
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalled();
    expect(results[0].suggestions.length).toBeGreaterThan(0);
    expect(results[0].suggestions[0].name).toBe('grey_ears');
  });
});

// ============================================================================
// Spec: add-multi-round-tag-audit / Task 5 / SubTask 5.1
// 以下测试块覆盖 L0 自定义映射查询（SubTask 1.4）与 L3b 否定性修饰词剥离
// （SubTask 2.2-2.3），验证「brimless cap」与「B-cup」两个目标词的处理。
//
// 匹配链（六层降级）：
//   L0 自定义映射 → L1 name → L2 alias → L3 颜色拆分 → L3b 否定性修饰词剥离
//   → L4 语义 KNN（任一命中即 valid，source 字段标识命中轮次）
// ============================================================================

// ==================== stripNegationModifier（纯函数，SubTask 2.2）====================

describe('stripNegationModifier - 否定性修饰词剥离（Spec: add-multi-round-tag-audit / Task 2）', () => {
  it('brimless cap → cap（剥离 brimless）', () => {
    expect(stripNegationModifier('brimless cap')).toBe('cap');
  });

  it('sleeveless dress → dress（剥离 sleeveless）', () => {
    expect(stripNegationModifier('sleeveless dress')).toBe('dress');
  });

  it('brimless_cap → cap（下划线分隔符兼容）', () => {
    expect(stripNegationModifier('brimless_cap')).toBe('cap');
  });

  it('sleeveless_dress → dress（下划线分隔符兼容）', () => {
    expect(stripNegationModifier('sleeveless_dress')).toBe('dress');
  });

  it('short hair → 空串（short 非否定性修饰词，不剥离）', () => {
    // short 不在 NEGATION_MODIFIERS 列表（仅 -less 后缀的否定性词），
    // 不剥离 → 返回空串（避免误伤 short_hair 等本身是标签的复合词）
    expect(stripNegationModifier('short hair')).toBe('');
  });

  it('brimless → 空串（纯修饰词，无核心词）', () => {
    // brimless 是修饰词但无后续分隔符+核心词 → regex 不匹配 → stripped===tag → 返回空串
    expect(stripNegationModifier('brimless')).toBe('');
  });

  it('空入参 → 空串', () => {
    expect(stripNegationModifier('')).toBe('');
  });

  it('open hoodie → 空串（open 非否定性修饰词，不剥离）', () => {
    // open 不在 NEGATION_MODIFIERS 列表，避免误伤 open_hoodie 等本身是标签的复合词
    expect(stripNegationModifier('open hoodie')).toBe('');
  });
});

// ==================== validateTagsAgainstLibrary L0 自定义映射查询（SubTask 1.4）====================

describe('validateTagsAgainstLibrary - L0 自定义映射查询（Spec: add-multi-round-tag-audit）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('{}');
    // 默认 mock：L0 自定义映射未命中
    vi.mocked(userSynonymMapService.lookup).mockReturnValue(null);
  });

  /**
   * 场景一：L0 命中
   * mock userSynonymMapService.lookup 返回 'medium_breasts'（输入 'B-cup'）
   * → validateTagsAgainstLibrary 输入 ['B-cup'] → isValid=true,
   *   canonicalName='medium_breasts', source='user-map'，跳过 L1-L4
   */
  it('L0 命中：B-cup 在 userSynonymMap 中映射到 medium_breasts → isValid=true, source=user-map', async () => {
    vi.mocked(userSynonymMapService.lookup).mockReturnValue('medium_breasts');

    const results = await tagRagService.validateTagsAgainstLibrary(['B-cup']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('medium_breasts');
    expect(results[0].source).toBe('user-map');
    // L0 命中后不应再查 L2 alias（短路）
    // 注：getTagByName 在 validateTagsAgainstLibrary 开头有诊断日志调用（1girl/female/long_hair/blue_eyes），
    // 所以不能断言「未调用」，而是断言「未以 B-cup 为入参调用」
    expect(mocks.tagAutocompleteService.getTagByName).not.toHaveBeenCalledWith('B-cup');
    expect(mocks.tagAutocompleteService.getTagByName).not.toHaveBeenCalledWith('b-cup');
    expect(mocks.tagAutocompleteService.getTagByName).not.toHaveBeenCalledWith('B-Cup');
    expect(mocks.tagAutocompleteService.getTagByAlias).not.toHaveBeenCalledWith('B-cup');
    expect(mocks.tagAutocompleteService.getTagByAlias).not.toHaveBeenCalledWith('b-cup');
    // L0 命中不应触发 embedding（L4 KNN 不执行）
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  /**
   * 场景二：L0 未命中 → 走 L1-L4 降级链
   * mock userSynonymMapService.lookup 返回 null → L0 miss
   * → L1 name 命中 long_hair → isValid=true, source='name'
   */
  it('L0 未命中 → 降级到 L1-L4 正常匹配（L1 name 命中 long_hair，source=name）', async () => {
    vi.mocked(userSynonymMapService.lookup).mockReturnValue(null);

    // L1 name 命中 long_hair
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) => {
      const map = new Map([
        ['long_hair', { name: 'long_hair', category: 0, count: 382345, aliases: [] }],
      ]);
      return map.get(n.toLowerCase()) ?? null;
    });
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    const results = await tagRagService.validateTagsAgainstLibrary(['long_hair']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('long_hair');
    expect(results[0].source).toBe('name');
    // L0 lookup 已被调用（验证降级链触发顺序）
    expect(vi.mocked(userSynonymMapService.lookup)).toHaveBeenCalledWith('long_hair');
  });

  /**
   * 场景三：L0 lookup 异常 → 降级到 L1-L4（兜底容错）
   * mock lookup 抛异常 → validateTagsAgainstLibrary 应捕获并降级
   */
  it('L0 lookup 异常 → 降级到 L1（容错兜底）', async () => {
    vi.mocked(userSynonymMapService.lookup).mockImplementation(() => {
      throw new Error('mocked lookup failure');
    });

    // L1 name 命中 blue_eyes
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) => {
      const map = new Map([
        ['blue_eyes', { name: 'blue_eyes', category: 0, count: 382345, aliases: [] }],
      ]);
      return map.get(n.toLowerCase()) ?? null;
    });
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    const results = await tagRagService.validateTagsAgainstLibrary(['blue_eyes']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('blue_eyes');
    expect(results[0].source).toBe('name');
  });
});

// ==================== validateTagsAgainstLibrary L3b 否定性修饰词剥离（SubTask 2.3）====================

describe('validateTagsAgainstLibrary - L3b 否定性修饰词剥离（Spec: add-multi-round-tag-audit）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('{}');
    // 默认 mock：L0 自定义映射未命中（确保走 L1-L3b 降级链）
    vi.mocked(userSynonymMapService.lookup).mockReturnValue(null);
  });

  /**
   * 目标词一：brimless cap → L3b 剥离得 cap → alias 命中 hat
   *
   * 匹配链路：
   *   L0 lookup('brimless cap') → null
   *   L1 name('brimless cap' / 'brimless_cap') → null
   *   L2 alias('brimless cap' / 'brimless_cap') → null
   *   L3 splitColorTag('brimless cap') → null（brimless 非颜色词）
   *   L3b stripNegationModifier('brimless cap') → 'cap'
   *     → getTagByName('cap') → null
   *     → getTagByAlias('cap') → hat（cap 是 hat 的别名）
   *   → isValid=true, canonicalName='hat', source='negation-strip'
   */
  it('L3b 命中：brimless cap → cap → cap 是 hat 的 alias → isValid=true, canonicalName=hat, source=negation-strip', async () => {
    // L1 name：不含 cap（确保 L1 未命中，触发 L3b）
    mocks.tagAutocompleteService.getTagByName.mockImplementation(() => null);
    // L2 alias：cap → hat
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation((a: string) => {
      if (a.toLowerCase() === 'cap') {
        return { name: 'hat', category: 0, count: 46285, aliases: ['cap'] };
      }
      return null;
    });

    const results = await tagRagService.validateTagsAgainstLibrary(['brimless cap']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('hat');
    expect(results[0].source).toBe('negation-strip');
    // L3b 命中后不应走 L4 KNN
    expect(mocks.embeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  /**
   * 目标词一变体：brimless_cap（下划线形式）→ L3b 剥离得 cap → alias 命中 hat
   */
  it('L3b 命中（下划线形式）：brimless_cap → cap → hat', async () => {
    mocks.tagAutocompleteService.getTagByName.mockImplementation(() => null);
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation((a: string) => {
      if (a.toLowerCase() === 'cap') {
        return { name: 'hat', category: 0, count: 46285, aliases: ['cap'] };
      }
      return null;
    });

    const results = await tagRagService.validateTagsAgainstLibrary(['brimless_cap']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('hat');
    expect(results[0].source).toBe('negation-strip');
  });

  /**
   * 目标词二场景：sleeveless dress → L3b 剥离得 dress → name 命中
   */
  it('L3b 命中：sleeveless dress → dress → name 命中 dress', async () => {
    mocks.tagAutocompleteService.getTagByName.mockImplementation((n: string) => {
      if (n.toLowerCase() === 'dress') {
        return { name: 'dress', category: 0, count: 123456, aliases: [] };
      }
      return null;
    });
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    const results = await tagRagService.validateTagsAgainstLibrary(['sleeveless dress']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(true);
    expect(results[0].canonicalName).toBe('dress');
    expect(results[0].source).toBe('negation-strip');
  });

  /**
   * 边界场景：short hair 不触发 L3b（short 非否定性修饰词）
   * → L3b stripNegationModifier 返回空串 → 不命中 → 走 L4 KNN
   */
  it('L3b 不触发：short hair（short 非否定性修饰词）→ 走 L4 KNN', async () => {
    // L1/L2 未命中
    mocks.tagAutocompleteService.getTagByName.mockImplementation(() => null);
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    // 让 searchRelevantTags 可执行：status 需为 'ready'
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        csvHash: 'abc123def456',
        dimension: 1536,
        model: 'text-embedding-3-small',
        totalTags: 317600,
        vectorizedCount: 317600,
        failedCount: 0,
        lastVectorizedAt: Date.now(),
        durationMs: 3600000,
        status: 'ready',
      })
    );
    tagRagService.initialize();

    // 重申 embedding 配置
    mocks.vectorConfigManager.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'embeddingMode') return 'remote';
      if (key === 'dimension') return 1536;
      if (key === 'remoteModel') return 'text-embedding-3-small';
      if (key === 'localModel') return 'local-onnx';
      return defaultValue;
    });

    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: new Array(1536).fill(0.1),
      dimension: 1536,
    });
    mocks.vectorStoreService.search.mockResolvedValue([
      {
        id: 'tag:short_hair',
        score: 0.85,
        metadata: { tagName: 'short_hair', category: 0, count: 81568, aliases: [] },
      },
    ]);

    const results = await tagRagService.validateTagsAgainstLibrary(['short hair']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(false);
    // L3b 不触发 → 走 L4 KNN → source='knn'
    expect(results[0].source).toBe('knn');
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalled();
  });

  /**
   * 边界场景：L3b 剥离后核心词仍未命中 → 走 L4 KNN
   * 例：strapless_unknown_tag（核心词 unknown_tag 不在标签库）
   */
  it('L3b 剥离后核心词未命中 → 走 L4 KNN', async () => {
    // L1/L2/L3b 全未命中
    mocks.tagAutocompleteService.getTagByName.mockImplementation(() => null);
    mocks.tagAutocompleteService.getTagByAlias.mockImplementation(() => null);

    // 让 searchRelevantTags 可执行
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({
        csvHash: 'abc123def456',
        dimension: 1536,
        model: 'text-embedding-3-small',
        totalTags: 317600,
        vectorizedCount: 317600,
        failedCount: 0,
        lastVectorizedAt: Date.now(),
        durationMs: 3600000,
        status: 'ready',
      })
    );
    tagRagService.initialize();

    mocks.vectorConfigManager.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'embeddingMode') return 'remote';
      if (key === 'dimension') return 1536;
      if (key === 'remoteModel') return 'text-embedding-3-small';
      if (key === 'localModel') return 'local-onnx';
      return defaultValue;
    });

    mocks.embeddingService.generateEmbedding.mockResolvedValue({
      success: true,
      vector: new Array(1536).fill(0.1),
      dimension: 1536,
    });
    mocks.vectorStoreService.search.mockResolvedValue([]);

    const results = await tagRagService.validateTagsAgainstLibrary(['strapless unknown tag']);

    expect(results).toHaveLength(1);
    expect(results[0].isValid).toBe(false);
    expect(results[0].source).toBeUndefined();
    // L3b 触发了（stripNegationModifier 剥离 strapless），但核心词未命中 → 走 L4
    expect(mocks.embeddingService.generateEmbedding).toHaveBeenCalled();
  });
});

