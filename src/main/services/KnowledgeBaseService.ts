import { ipcMain } from 'electron';
import { getStorageService } from './storageService';
import { KnowledgeItem, SearchOptions, SearchResult, VectorSourceType, VectorSourceTypeStorageConfig } from '../types/vectorConfig';
import { embeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { vectorRegistryService } from './VectorRegistryService';
import { VectorCache } from './VectorCache';
import { vectorConfigManager } from './VectorConfigManager';

export class KnowledgeBaseService {
  private items: Map<string, KnowledgeItem> = new Map();
  private initialized = false;
  private cache: VectorCache;

  constructor() {
    this.cache = new VectorCache();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const storageService = getStorageService();
      const data = storageService.get<any[]>('knowledgeBase');
      if (data && Array.isArray(data)) {
        for (const item of data) {
          this.items.set(item.id, item);
        }
      } else {
        await this.seedKnowledgeBase();
      }
      this.initialized = true;
    } catch (error) {
      console.error('[KnowledgeBaseService] 初始化失败:', error);
    }
  }

  private async seedKnowledgeBase(): Promise<void> {
    console.log('[KnowledgeBaseService] Seeding knowledge base with document vectorization testing content...');
    
    const seedItems: KnowledgeItem[] = [
      {
        id: 'kb_doc_vector_overview',
        title: '文档向量化 - 核心功能概述',
        content: `文档向量化测试模块是 Creative-Cafe 项目的核心功能之一，提供从文档上传、文本提取、分块处理、向量生成、向量存储到结果查看和语义测试的完整流水线。

核心功能包括：文档上传（支持 PDF/DOCX/XLSX/TXT/MD 格式）、自动分块（智能文本分段，每段最大 500 字符）、批量向量化（使用远程/本地 Embedding API）、向量存储（JSON/WASM 模式）、向量查看（统计+详情）、相似性查询（语义搜索）、向量化测试（查看向量数据）。

边界情况处理：空文本跳过、超长段落智能分割、无空格长文本防无限循环、大文件分批处理、网络异常重试、API 超时保护、WASM 初始化超时保护。`,
        source: 'document-vectorization',
        category: ['核心功能'],
        tags: ['文档向量化', '功能概述', '核心特性'],
        relatedCharacterIds: [],
        relatedWorldBookPaths: [],
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'system' }
      },
      {
        id: 'kb_doc_vector_implementation',
        title: '文档向量化 - 技术实现详解',
        content: `技术选型：Electron 框架 + React/TypeScript 前端 + Ant Design UI + sqlite-vec 向量存储 + EmbeddingService 向量化服务。

算法原理：(1) 文本分块 - 按段落分割，MAX_CHUNK_SIZE=500 字符，CHUNK_OVERLAP=50 字符重叠，无空格文本防护确保每次循环缩短 remaining；(2) 余弦相似度 - cosine_similarity(A,B) = (A·B)/(||A||×||B||)，结果范围 [0,1]；(3) 批处理 - 每批 10 条向量化，最后一次性批量写入磁盘，避免 O(n) 次 I/O。

代码架构：DocumentVectorPage.tsx (UI) → documentVectorService.ts (前端服务) → IPC Channel → DocumentProcessorService.ts (主进程服务) → EmbeddingService/VectorStoreService。

关键修复：v1.6.2 修复了无限循环（remaining 长度检测）、批量写入优化（addBatchNoPersist）、WASM 超时（30 秒 Promise.race）、异步文件操作（fsPromises）。`,
        source: 'document-vectorization',
        category: ['技术实现'],
        tags: ['算法', '架构', '代码实现', '性能优化'],
        relatedCharacterIds: [],
        relatedWorldBookPaths: [],
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'system' }
      },
      {
        id: 'kb_doc_vector_testing',
        title: '文档向量化 - 测试规范与流程',
        content: `测试环境要求：Windows 10+/macOS 11+、4GB+ 内存、500MB 磁盘、稳定网络、Node.js v20+、可用的 Embedding API。

测试用例设计：功能测试（上传各格式文件、大小限制、格式校验、空文档、中文分块、超长段落）、向量查看测试（统计显示、分块详情、多文档切换）、向量测试（相似性查询、限定范围、空查询、向量化测试）、性能测试（小文件<5s、中文件<30s、查询<2s、内存<500MB）。

测试流程：环境准备 → 功能测试 → 向量查看测试 → 向量测试 → 边界测试 → 结果记录。

评估指标：功能通过率≥95%、处理成功率≥98%、查询准确率≥90%、平均处理时间<30s、P95 查询延迟<3s、内存峰值<500MB。`,
        source: 'document-vectorization',
        category: ['测试规范'],
        tags: ['测试用例', '测试流程', '评估指标'],
        relatedCharacterIds: [],
        relatedWorldBookPaths: [],
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'system' }
      },
      {
        id: 'kb_doc_vector_troubleshooting',
        title: '文档向量化 - 常见问题与最佳实践',
        content: `常见问题解决方案：
(1) 上传后卡死 - 已在 v1.6.2 修复（无限循环防护+批量写入+WASM 超时+异步操作）
(2) 中文处理慢 - 已修复 remaining 长度检测
(3) 未配置 API - 进入设置配置远程 API 地址并保存
(4) 搜索空结果 - 确认已存储向量、尝试通用查询词、增加 TopK
(5) WASM 加载慢 - 定期清理文档或切换 JSON 模式
(6) 大文件失败 - 分割文件、增加超时、检查内存
(7) 解析乱码 - 转换 UTF-8 编码

最佳实践：
(1) 使用 UTF-8 编码文档
(2) 文件大小 <10MB
(3) 优先 TXT/MD 格式
(4) 远程向量化模式
(5) 定期清理文档
(6) sqlite-vec 后端统一存储所有向量（基于 SQLite 向量扩展，cosine 距离）
(7) 指定文档范围而非全部搜索`,
        source: 'document-vectorization',
        category: ['常见问题', '最佳实践'],
        tags: ['故障排查', '解决方案', '最佳实践', '性能优化'],
        relatedCharacterIds: [],
        relatedWorldBookPaths: [],
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'system' }
      }
    ];

    for (const item of seedItems) {
      this.items.set(item.id, item);
    }
    
    await this.persist();
    console.log(`[KnowledgeBaseService] Seeded ${seedItems.length} knowledge base items`);
  }

  async list(filter?: Record<string, any>, page: number = 1, pageSize: number = 20): Promise<{ items: KnowledgeItem[]; total: number }> {
    await this.ensureInitialized();

    let allItems = Array.from(this.items.values());

    if (filter) {
      allItems = allItems.filter(item => {
        for (const [key, value] of Object.entries(filter)) {
          if (key === 'category' && Array.isArray(value)) {
            if (!value.some(v => item.category.includes(v))) return false;
          } else if (key === 'tags' && Array.isArray(value)) {
            if (!value.some(v => item.tags.includes(v))) return false;
          } else if (item[key as keyof KnowledgeItem] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    const total = allItems.length;
    const start = (page - 1) * pageSize;
    const paginatedItems = allItems.slice(start, start + pageSize);

    return { items: paginatedItems, total };
  }

  async create(item: KnowledgeItem): Promise<string> {
    await this.ensureInitialized();

    const id = item.id || `kb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    // 判断是手动创建的知识条目还是文档上传的知识条目
    const isNewManualKnowledge = !item.documentId && item.source !== 'document-vectorization' && item.source !== 'worldbook';
    const sourceType = isNewManualKnowledge ? VectorSourceType.MANUAL_KNOWLEDGE : VectorSourceType.KNOWLEDGE;
    const storageConfig = VectorSourceTypeStorageConfig[sourceType];

    const newItem: KnowledgeItem = {
      ...item,
      id,
      metadata: {
        ...item.metadata,
        createdAt: now,
        updatedAt: now,
        createdBy: item.metadata?.createdBy || 'user',
        sourceType,
      }
    };

    this.items.set(id, newItem);
    await this.persist();

    if (newItem.content) {
      await this.vectorizeItem(id, false, { sourceType });
    }

    return id;
  }

  async createBatch(items: KnowledgeItem[]): Promise<number> {
    await this.ensureInitialized();
    const now = Date.now();
    let count = 0;
    let vectorizedCount = 0;
    
    for (const item of items) {
      const id = item.id || `kb_${now}_${Math.random().toString(36).substr(2, 9)}_${count}`;
      const newItem: KnowledgeItem = {
        ...item,
        id,
        metadata: {
          ...item.metadata,
          createdAt: now,
          updatedAt: now,
          createdBy: item.metadata?.createdBy || 'user'
        }
      };
      this.items.set(id, newItem);
      count++;
      
      // 批处理模式：传入 skipPersist=true，避免每个条目都持久化
      try {
        await this.vectorizeItem(id, true);
        vectorizedCount++;
      } catch (error) {
        console.error(`[KnowledgeBaseService] createBatch: failed to vectorize ${id}:`, error);
      }
    }
    
    // 批处理完成后统一持久化一次
    if (vectorizedCount > 0) {
      await vectorStoreService.persist();
      console.log(`[KnowledgeBaseService] createBatch: batch persisted ${vectorizedCount} vectors`);
    }
    await this.persist();
    console.log(`[KnowledgeBaseService] Batch created ${count} items, vectorized ${vectorizedCount}`);
    return count;
  }

  async createBatchDeferred(items: KnowledgeItem[], batchSize: number = 50): Promise<number> {
    await this.ensureInitialized();
    const now = Date.now();
    let count = 0;
    let vectorizedCount = 0;
    
    for (const item of items) {
      const id = item.id || `kb_${now}_${Math.random().toString(36).substr(2, 9)}_${count}`;
      const newItem: KnowledgeItem = {
        ...item,
        id,
        metadata: {
          ...item.metadata,
          createdAt: now,
          updatedAt: now,
          createdBy: item.metadata?.createdBy || 'document_upload'
        }
      };
      this.items.set(id, newItem);
      count++;

      // 批处理模式：传入 skipPersist=true，避免每个条目都持久化
      try {
        await this.vectorizeItem(id, true);
        vectorizedCount++;
        if (count % 10 === 0) {
          console.log(`[KnowledgeBaseService] createBatchDeferred: vectorized ${vectorizedCount}/${count} items`);
        }
      } catch (error) {
        console.error(`[KnowledgeBaseService] createBatchDeferred: failed to vectorize ${id}:`, error);
      }

      // 每批次只持久化知识库JSON，不持久化向量存储
      if (count % batchSize === 0) {
        await this.persist();
      }
    }
    if (count % batchSize !== 0) {
      await this.persist();
    }
    
    // 批处理完成后统一持久化向量存储一次
    if (vectorizedCount > 0) {
      await vectorStoreService.persist();
      console.log(`[KnowledgeBaseService] createBatchDeferred: batch persisted ${vectorizedCount} vectors`);
    }
    console.log(`[KnowledgeBaseService] Deferred batch created ${count} items, vectorized ${vectorizedCount} in ${Math.ceil(count / batchSize)} batches`);
    return count;
  }

  async createBatchWithVectors(items: KnowledgeItem[]): Promise<number> {
    await this.ensureInitialized();
    const now = Date.now();
    let count = 0;
    let vectorizedCount = 0;
    
    for (const item of items) {
      const id = item.id || `kb_${now}_${Math.random().toString(36).substr(2, 9)}_${count}`;
      const newItem: KnowledgeItem = {
        ...item,
        id,
        metadata: {
          ...item.metadata,
          createdAt: now,
          updatedAt: now,
          createdBy: item.metadata?.createdBy || 'document_upload'
        }
      };
      this.items.set(id, newItem);
      count++;

      // If item already has a vector, store it directly without re-vectorizing
      if (newItem.vector && newItem.vector.length > 0) {
        try {
          // 使用 document ID 作为 sourceId（去除 kb_doc: 前缀）
          const sourceId = id.startsWith('kb_doc:') ? id.split(':')[1] : id;
          await vectorStoreService.add(id, newItem.vector, {
            text: newItem.content,
            source: 'knowledge',
            sourceId: sourceId,
            title: newItem.title,
            category: newItem.category,
            tags: newItem.tags,
            createdAt: newItem.metadata.createdAt,
            updatedAt: Date.now()
          });
          vectorizedCount++;
        } catch (error) {
          console.error(`[KnowledgeBaseService] createBatchWithVectors: failed to store vector for ${id}:`, error);
        }
      } else {
        // No pre-computed vector, vectorize it
        try {
          await this.vectorizeItem(id, true);
          vectorizedCount++;
        } catch (error) {
          console.error(`[KnowledgeBaseService] createBatchWithVectors: failed to vectorize ${id}:`, error);
        }
      }
    }
    
    // Persist once after all items are processed
    if (vectorizedCount > 0) {
      await vectorStoreService.persist();
      console.log(`[KnowledgeBaseService] createBatchWithVectors: batch persisted ${vectorizedCount} vectors`);
      
      // 注册到向量注册表
      try {
        const docId = items[0]?.id?.split(':')[1] || 'unknown';
        const fileName = items[0]?.metadata?.fileName || 'unknown';
        await vectorRegistryService.registerVectorFile({
          vectorFileId: docId,
          sourceType: VectorSourceType.KNOWLEDGE,
          sourceId: items[0]?.id || '',
          sourceName: fileName,
          vectorCount: vectorizedCount,
          createdAt: now,
          updatedAt: now,
          status: 'active',
          additionalMetadata: {
            knowledgeItemCount: count,
          }
        });
      } catch (error) {
        console.error('[KnowledgeBaseService] createBatchWithVectors: failed to register to registry:', error);
      }
    }
    await this.persist();
    console.log(`[KnowledgeBaseService] createBatchWithVectors: created ${count} items, vectorized ${vectorizedCount}`);
    return count;
  }

  async update(id: string, updates: Partial<KnowledgeItem>): Promise<boolean> {
    await this.ensureInitialized();

    const item = this.items.get(id);
    if (!item) {
      return false;
    }

    if (updates.title) item.title = updates.title;
    if (updates.content) item.content = updates.content;
    if (updates.source) item.source = updates.source;
    if (updates.category) item.category = updates.category;
    if (updates.tags) item.tags = updates.tags;
    if (updates.relatedCharacterIds) item.relatedCharacterIds = updates.relatedCharacterIds;
    if (updates.relatedWorldBookPaths) item.relatedWorldBookPaths = updates.relatedWorldBookPaths;

    item.metadata = {
      ...item.metadata,
      ...updates.metadata,
      updatedAt: Date.now()
    };

    this.items.set(id, item);
    await this.persist();

    if (updates.content) {
      await this.vectorizeItem(id);
    }

    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.items.has(id)) {
      return false;
    }

    this.items.delete(id);
    await vectorStoreService.delete(id);
    await this.persist();
    return true;
  }

  async deleteBatch(ids: string[]): Promise<number> {
    await this.ensureInitialized();

    const existingIds = ids.filter(id => this.items.has(id));
    if (existingIds.length === 0) return 0;
    
    for (const id of existingIds) {
      this.items.delete(id);
    }
    
    const vectorDeletePromises = existingIds.map(id => vectorStoreService.delete(id).catch(() => {}));
    await Promise.all(vectorDeletePromises);
    await this.persist();
    
    console.log(`[KnowledgeBaseService] Batch deleted ${existingIds.length} items`);
    return existingIds.length;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const topK = options?.topK || 10;
    // 优化 7：动态阈值调整 - 基于分数分布自动调整
    const minScore = options?.minScore || this.calculateDynamicThreshold();

    // 优化 3：查询文本标准化预处理
    const normalizedQuery = this.normalizeQueryText(query);
    console.log(`[KnowledgeBaseService] Query normalized: "${query.substring(0, 30)}" -> "${normalizedQuery.substring(0, 30)}"`);

    const embedResult = await embeddingService.generateEmbedding(normalizedQuery);
    if (!embedResult.success || !embedResult.vector) {
      return this.textSearch(query, topK);
    }

    const queryVector = embedResult.vector;

    // Don't filter by source - all items in the knowledge base should be searchable
    // The KnowledgeBaseService only contains knowledge base items regardless of their original source
    let filter: Record<string, any> = {};
    if (options?.categories && options.categories.length > 0) {
      filter.categories = options.categories;
    }
    if (options?.tags && options.tags.length > 0) {
      filter.tags = options.tags;
    }
    if (options?.characterId) {
      filter.characterId = options.characterId;
    }

    console.log(`[KnowledgeBaseService] search(): query="${normalizedQuery.substring(0, 50)}...", minScore=${minScore}, topK=${topK}`);

    const vectorResults = await vectorStoreService.search(queryVector, topK * 3, filter);

    console.log(`[KnowledgeBaseService] search(): got ${vectorResults.length} raw results from vector store`);
    if (vectorResults.length > 0) {
      // 打印所有结果的分数，帮助调试
      console.log(`[KnowledgeBaseService] search(): all result scores:`, 
        vectorResults.map(r => ({ id: r.id.substring(0, 30), score: r.score, text: (r.metadata?.text || '').substring(0, 40) })));
    }

    let filteredResults = vectorResults
      .filter(r => r.score >= minScore)
      .slice(0, topK);

    console.log(`[KnowledgeBaseService] search(): after minScore filter (${minScore}), returning ${filteredResults.length} results`);

    // 关键修复：如果向量搜索结果为空或太少，使用关键词搜索作为 fallback
    if (filteredResults.length === 0 && vectorResults.length > 0) {
      console.log(`[KnowledgeBaseService] search(): vector search returned 0 results above threshold, trying keyword fallback...`);
      const keywordResults = await this.textSearch(query, topK * 3);
      
      // 合并去重
      const mergedIds = new Set(filteredResults.map(r => r.id));
      for (const kr of keywordResults) {
        if (!mergedIds.has(kr.id) && mergedIds.size < topK) {
          filteredResults.push(kr);
          mergedIds.add(kr.id);
        }
      }
      console.log(`[KnowledgeBaseService] search(): keyword fallback added ${keywordResults.length} results, total: ${filteredResults.length}`);
    } else if (filteredResults.length === 0) {
      // 向量搜索完全没有结果，直接使用关键词搜索
      console.log(`[KnowledgeBaseService] search(): no vector results at all, falling back to keyword search`);
      filteredResults = await this.textSearch(query, topK);
    }

    return filteredResults;
  }

  // 优化 3：查询文本标准化预处理
  private normalizeQueryText(text: string): string {
    return text
      .trim()
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')  // 保留中英文、数字和空格，替换其他标点为空格
      .replace(/\s+/g, ' ')                     // 规范化多个空格为单个空格
      .replace(/^ +| +$/g, '');                 // 去除首尾空格
  }

  // 优化 7：动态阈值调整
  private calculateDynamicThreshold(): number {
    // 基于历史查询分数的动态阈值
    // 默认从 0.3 开始，可根据实际分数分布调整
    const baseThreshold = 0.3;
    
    // 可以从最近 N 次查询的平均分数计算动态阈值
    // 这里使用固定值，后续可根据需要实现动态计算
    return baseThreshold;
  }

  async vectorizeItem(id: string, skipPersist: boolean = false, options?: { sourceType?: VectorSourceType }): Promise<boolean> {
    await this.ensureInitialized();

    const vectorConfig = vectorConfigManager.loadVectorConfig();
    if (vectorConfig.embeddingMode === 'disabled') {
      console.log(`[KnowledgeBaseService] 向量化已禁用，跳过 vectorizeItem id=${id}`);
      return false;
    }

    const item = this.items.get(id);
    if (!item || !item.content) {
      return false;
    }

    const embedResult = await embeddingService.generateEmbedding(item.content);
    if (!embedResult.success || !embedResult.vector) {
      return false;
    }

    item.vector = embedResult.vector;
    item.metadata = {
      ...item.metadata,
      embeddingMode: 'remote',
      embeddingModel: embedResult.model || 'unknown',
      tokenCount: item.content.length
    };

    // 确定 sourceType：优先使用 options，其次使用 item.metadata 中已有的，最后根据来源推断
    const sourceType = options?.sourceType 
      || item.metadata?.sourceType 
      || (item.source === 'worldbook' ? VectorSourceType.WORLDBOOK : VectorSourceType.KNOWLEDGE);

    const storageConfig = VectorSourceTypeStorageConfig[sourceType];
    
    await vectorStoreService.add(id, embedResult.vector, {
      text: item.content,
      source: sourceType,
      sourceId: item.metadata?.documentId || id,
      title: item.title,
      category: item.category,
      tags: item.tags,
      createdAt: item.metadata.createdAt,
      updatedAt: Date.now(),
      storageConfig,
    });

    // 只有非批处理模式下才立即持久化（单个条目操作时）
    // 批处理模式下由调用方统一持久化，避免重复写入
    if (!skipPersist) {
      await vectorStoreService.persist();
      console.log(`[KnowledgeBaseService] vectorizeItem: persisted ${id} after vectorization (sourceType: ${sourceType})`);
      await this.persist();
    }
    return true;
  }

  async vectorizeAll(): Promise<{ success: boolean; processed: number; error?: string }> {
    await this.ensureInitialized();

    const vectorConfig = vectorConfigManager.loadVectorConfig();
    if (vectorConfig.embeddingMode === 'disabled') {
      console.log('[KnowledgeBaseService] 向量化已禁用，跳过 vectorizeAll');
      return { success: false, processed: 0, error: '向量化已禁用，请先在系统设置中启用向量化' };
    }

    let processed = 0;
    for (const item of this.items.values()) {
      if (item.content && !item.vector) {
        const success = await this.vectorizeItem(item.id);
        if (success) processed++;
      }
    }

    return { success: true, processed };
  }

  private async textSearch(query: string, topK: number): Promise<SearchResult[]> {
    const items = Array.from(this.items.values());
    const queryLower = query.toLowerCase();

    const results: SearchResult[] = items
      .filter(item =>
        item.title.toLowerCase().includes(queryLower) ||
        item.content.toLowerCase().includes(queryLower) ||
        item.tags.some(t => t.toLowerCase().includes(queryLower))
      )
      .map(item => ({
        id: item.id,
        score: 0.5,
        metadata: {
          text: item.content,
          source: 'knowledge',
          title: item.title,
          category: item.category,
          tags: item.tags
        }
      }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private async persist(): Promise<void> {
    try {
      const storageService = getStorageService();
      const data = Array.from(this.items.values());
      storageService.set('knowledgeBase', data);
    } catch (error) {
      console.error('[KnowledgeBaseService] 持久化失败:', error);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle('knowledge:list', async (_event, { filter, page, pageSize }: { filter?: Record<string, any>; page?: number; pageSize?: number }) => {
      try {
        await this.initialize();
        const result = await this.list(filter, page || 1, pageSize || 20);
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:create', async (_event, { item }: { item: KnowledgeItem }) => {
      try {
        await this.initialize();
        const id = await this.create(item);
        return { success: true, id };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:createBatch', async (_event, { items }: { items: KnowledgeItem[] }) => {
      try {
        await this.initialize();
        const count = await this.createBatch(items);
        return { success: true, count };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:update', async (_event, { id, updates }: { id: string; updates: Partial<KnowledgeItem> }) => {
      try {
        await this.initialize();
        const success = await this.update(id, updates);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:delete', async (_event, { id }: { id: string }) => {
      try {
        await this.initialize();
        const success = await this.delete(id);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:deleteBatch', async (_event, { ids }: { ids: string[] }) => {
      try {
        await this.initialize();
        const count = await this.deleteBatch(ids);
        return { success: true, count };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', count: 0 };
      }
    });

    ipcMain.handle('knowledge:search', async (_event, { query, options }: { query: string; options?: SearchOptions }) => {
      try {
        await this.initialize();
        const results = await this.search(query, options);
        return { success: true, results };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:vectorize', async (_event, { id }: { id: string }) => {
      try {
        await this.initialize();
        const vectorConfig = vectorConfigManager.loadVectorConfig();
        if (vectorConfig.embeddingMode === 'disabled') {
          return { success: false, error: '向量化已禁用，请先在系统设置中启用向量化' };
        }
        const success = await this.vectorizeItem(id);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:vectorizeAll', async () => {
      try {
        await this.initialize();
        const result = await this.vectorizeAll();
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
