import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import init, { WasmVecStore } from 'vecstore-wasm';
import { VectorItem, SearchResult, VectorStoreMode } from '../types/vectorConfig';
import { getStorageService } from './storageService';

const STORE_FILE = 'vecstore.json';
const METADATA_FILE = 'vecstore_metadata.json';
const WASM_INIT_TIMEOUT = 30000;

interface VecstoreInitOptions {
  source?: string;     // 来源类型: knowledge, worldbook, document
  sourceId?: string;   // 来源ID（如世界书名称或文档ID）
}

export class VecstoreVectorStore {
  private source: string = 'default';
  private sourceId: string = '';
  private store: WasmVecStore | null = null;
  private dimension: number = 384;
  private storeMode: VectorStoreMode = 'vecstore';
  private initialized = false;
  private wasmReady = false;
  private metadataCache: Map<string, Record<string, any>> = new Map();
  private metadataFilePath: string = '';
  private storeFilePath: string = '';

  private async timeout(ms: number): Promise<void> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error('操作超时')), ms)
    );
  }

  async initialize(options?: VecstoreInitOptions): Promise<void> {
    try {
      if (this.initialized) return;

      this.source = options?.source || 'default';
      this.sourceId = options?.sourceId || 'default';
      console.log(`[VecstoreVectorStore] Initializing WASM module for source: ${this.source}, sourceId: ${this.sourceId}...`);
      
      await this.ensureStoreDir();
      
      await Promise.race([
        init(),
        this.timeout(WASM_INIT_TIMEOUT)
      ]);
      this.wasmReady = true;

      const storePath = this.getStoreFilePath();
      console.log(`[VecstoreVectorStore] Store file path: ${storePath}`);
      
      let existingDataStr: string = '';
      let existingDimension: number | null = null;
      let hasExistingData = false;
      
      if (fs.existsSync(storePath)) {
        const stats = fs.statSync(storePath);
        console.log(`[VecstoreVectorStore] Loading existing data from disk: ${storePath} (${stats.size} bytes)`);
        existingDataStr = await fsPromises.readFile(storePath, 'utf-8');
        console.log(`[VecstoreVectorStore] Raw data length: ${existingDataStr.length} bytes`);
        
        if (existingDataStr.length > 0) {
          hasExistingData = true;
          
          try {
            const parsed = JSON.parse(existingDataStr);
            
            // vecstore-wasm 的 export_json 导出的是一个对象，不是数组
            // 但我们可以通过分析对象结构来获取维度信息
            let vectors: any[] = [];
            
            if (Array.isArray(parsed)) {
              vectors = parsed;
              console.log(`[VecstoreVectorStore] Format: simple array`);
            } else if (typeof parsed === 'object' && parsed !== null) {
              // vecstore.json 格式：{"dimension": N, "records": [...]}
              if (parsed.records && Array.isArray(parsed.records)) {
                vectors = parsed.records;
                console.log(`[VecstoreVectorStore] Format: vecstore.json with .records array`);
                // 直接从文件读取维度
                if (parsed.dimension && typeof parsed.dimension === 'number') {
                  existingDimension = parsed.dimension;
                  console.log(`[VecstoreVectorStore] ⭐ Dimension found in file header: ${existingDimension}`);
                }
              } else if (parsed.vectors && Array.isArray(parsed.vectors)) {
                vectors = parsed.vectors;
                console.log(`[VecstoreVectorStore] Format: WASM native with .vectors array`);
              } else if (parsed.data && Array.isArray(parsed.data)) {
                vectors = parsed.data;
                console.log(`[VecstoreVectorStore] Format: with .data array`);
              } else {
                // 无法直接提取，让 WASM import_json 处理
                console.log(`[VecstoreVectorStore] Format: unknown object, will let WASM import_json handle it`);
              }
            }
            
            // 尝试从向量中获取维度（如果文件头没有维度信息）
            if (vectors.length > 0 && existingDimension === null) {
              const firstVector = vectors[0];
              if (firstVector?.vector && Array.isArray(firstVector.vector)) {
                existingDimension = firstVector.vector.length;
                console.log(`[VecstoreVectorStore] ⭐ Existing vectors have dimension: ${existingDimension}`);
              }
              
              const samples = vectors.slice(0, 3).map((v: any) => ({
                id: v.id || 'unknown',
                vectorLength: v.vector?.length || 'N/A'
              }));
              console.log(`[VecstoreVectorStore] Sample vectors:`, JSON.stringify(samples));
            }
          } catch (parseError) {
            console.error('[VecstoreVectorStore] Failed to analyze existing data:', parseError);
          }
        }
      } else {
        console.log(`[VecstoreVectorStore] No existing store file found at: ${storePath}`);
      }

      // 关键修复：优先使用现有数据的维度
      if (existingDimension !== null) {
        console.log(`[VecstoreVectorStore] ⭐ Using existing data dimension: ${existingDimension}`);
        this.dimension = existingDimension;
      } else {
        // 从配置加载维度
        await this.loadDimensionFromConfig();
        console.log(`[VecstoreVectorStore] Using dimension from config: ${this.dimension}`);
      }

      // 创建存储并导入数据
      this.store = new WasmVecStore(this.dimension);
      
      if (hasExistingData) {
        console.log(`[VecstoreVectorStore] Importing ${existingDataStr.length} bytes into WASM store...`);
        try {
          // vecstore-wasm 的 export_json 导出格式是对象，不是简单的向量数组
          // import_json 可能无法正确解析这种格式
          // 需要手动解析并逐个 upsert
          const parsed = JSON.parse(existingDataStr);
          
          // 尝试从对象中提取向量数组
          let vectors: any[] = [];
          if (Array.isArray(parsed)) {
            vectors = parsed;
          } else if (typeof parsed === 'object') {
            // vecstore.json 格式：{"dimension": N, "records": [...]}
            vectors = parsed.records || parsed.vectors || parsed.data || parsed.entries || [];
            if (!Array.isArray(vectors)) {
              // 如果对象本身包含向量数据（每个 key 是一个 ID）
              vectors = Object.values(parsed).filter(v => v && typeof v === 'object' && v.id && v.vector);
            }
          }
          
          if (vectors.length > 0) {
            console.log(`[VecstoreVectorStore] Found ${vectors.length} vectors in data, importing via upsert...`);
            
            let importedCount = 0;
            for (const v of vectors) {
              if (v && v.id && v.vector && Array.isArray(v.vector)) {
                try {
                  // 处理 metadata.fields 嵌套结构：vecstore.json 中 metadata 可能是 {"fields": {...}}
                  let metadata = v.metadata || {};
                  if (metadata && typeof metadata === 'object' && 'fields' in metadata && typeof metadata.fields === 'object') {
                    metadata = metadata.fields;
                  }
                  this.store.upsert(v.id, new Float32Array(v.vector), metadata);
                  importedCount++;
                } catch (err) {
                  console.warn(`[VecstoreVectorStore] Failed to import vector "${v.id}":`, err);
                }
              }
            }
            
            console.log(`[VecstoreVectorStore] Manually imported ${importedCount}/${vectors.length} vectors via upsert`);
          } else {
            console.log(`[VecstoreVectorStore] No vectors found in parsed data, trying WASM import_json...`);
            this.store.import_json(existingDataStr);
          }
          
          const loadedCount = this.store.len();
          console.log(`[VecstoreVectorStore] Store now has ${loadedCount} vectors after import`);
          
          if (loadedCount > 0) {
            console.log(`[VecstoreVectorStore] ⭐ Successfully loaded ${loadedCount} vectors from disk!`);
            
            // 验证：打印前3个向量ID
            const allVectors = this.store.export_json();
            const exportedParsed = JSON.parse(allVectors);
            if (Array.isArray(exportedParsed) && exportedParsed.length > 0) {
              const sampleIds = exportedParsed.slice(0, 3).map((v: any) => v.id);
              console.log(`[VecstoreVectorStore] Sample loaded vector IDs:`, sampleIds);
            }
          } else {
            console.error(`[VecstoreVectorStore] ⚠️ Still 0 vectors after import! Data format issue.`);
            console.log(`[VecstoreVectorStore] Data first 500 chars:`, existingDataStr.substring(0, 500));
            console.log(`[VecstoreVectorStore] Parsed type:`, typeof parsed, Array.isArray(parsed) ? 'array' : Object.keys(parsed).slice(0, 10));
          }
        } catch (importError) {
          console.error('[VecstoreVectorStore] Failed to import data:', importError);
          console.log('[VecstoreVectorStore] Starting with empty store');
        }
      } else {
        console.log('[VecstoreVectorStore] Created new empty store');
      }

      this.initialized = true;
      console.log(`[VecstoreVectorStore] Initialization complete. Store contains ${this.store?.len() || 0} vectors`);
      
      // 设置文件路径
      this.storeFilePath = storePath;
      this.metadataFilePath = this.getMetadataFilePath();
      
      // 从持久化文件加载元数据（解决 WASM query 不返回 metadata 的问题）
      await this.loadMetadataFromFile();
      
      // 数据完整性验证
      const storeLen = this.store?.len() || 0;
      const metadataLen = this.metadataCache.size;
      console.log(`[VecstoreVectorStore] Metadata cache loaded ${metadataLen} entries from file`);
      
      if (storeLen > 0 && metadataLen === 0) {
        console.error(`[VecstoreVectorStore] ⚠️ DATA INTEGRITY WARNING: Store has ${storeLen} vectors but metadata cache is empty!`);
        console.error(`[VecstoreVectorStore] Metadata file path: ${this.metadataFilePath}`);
        console.error(`[VecstoreVectorStore] Metadata file exists: ${fs.existsSync(this.metadataFilePath)}`);
      } else if (storeLen > 0 && metadataLen !== storeLen) {
        console.warn(`[VecstoreVectorStore] ⚠️ DATA MISMATCH: Store has ${storeLen} vectors but metadata cache has ${metadataLen} entries`);
      } else if (storeLen === 0 && metadataLen > 0) {
        console.warn(`[VecstoreVectorStore] ⚠️ ORPHAN METADATA: Store is empty but metadata has ${metadataLen} entries`);
      } else {
        console.log(`[VecstoreVectorStore] ✅ Data integrity check passed: ${storeLen} vectors, ${metadataLen} metadata entries`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === '操作超时') {
        console.error('[VecstoreVectorStore] WASM initialization timeout after', WASM_INIT_TIMEOUT, 'ms');
        throw new Error(`WASM 初始化超时 (${WASM_INIT_TIMEOUT}ms)，请检查 vecstore.json 文件是否过大`);
      }
      console.error('[VecstoreVectorStore] 初始化失败:', error);
      throw error;
    }
  }

  private async loadDimensionFromConfig(): Promise<void> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const vectorConfig = settings?.vector;
      
      if (vectorConfig?.dimension) {
        this.dimension = vectorConfig.dimension;
        console.log(`[VecstoreVectorStore] Loaded dimension from config: ${this.dimension}`);
        return;
      }
      
      if (vectorConfig?.remoteModel && vectorConfig?.remoteApiUrl) {
        try {
          console.log(`[VecstoreVectorStore] Auto-detecting dimension from embedding API...`);
          const { embeddingService } = await import('./EmbeddingService');
          const testResult = await embeddingService.generateEmbedding('dimension detection test');
          if (testResult.success && testResult.dimension && testResult.dimension > 0) {
            this.dimension = testResult.dimension;
            console.log(`[VecstoreVectorStore] Auto-detected dimension from API: ${this.dimension} (model: ${testResult.model})`);
            return;
          }
        } catch (detectError) {
          console.warn('[VecstoreVectorStore] Auto-detection failed, falling back to model inference:', detectError);
        }
      }
      
      if (vectorConfig?.remoteModel) {
        this.dimension = this.inferDimensionFromModel(vectorConfig.remoteModel);
        console.log(`[VecstoreVectorStore] Inferred dimension from model ${vectorConfig.remoteModel}: ${this.dimension}`);
      } else {
        console.log(`[VecstoreVectorStore] Using default dimension: ${this.dimension}`);
      }
    } catch (error) {
      console.warn('[VecstoreVectorStore] Failed to load dimension from config, using default 384:', error);
    }
  }

  private inferDimensionFromModel(modelName: string): number {
    const modelDimensions: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'text-embedding-v1': 1536,
      'text-embedding-v2': 1536,
      'text-embedding-v3': 1536,
      'text-embedding-qwen': 4096,
      'qwen3-embedding-8b': 4096,
      'qwen3-embedding': 4096,
      'bge-large-zh-v1.5': 1024,
      'bge-base-zh-v1.5': 768,
      'bge-small-zh-v1.5': 512,
      'm3e-large': 1024,
      'm3e-base': 768,
      'm3e-small': 512,
      'bge-m3': 1024,
    };

    const lowerName = modelName.toLowerCase();
    for (const [model, dim] of Object.entries(modelDimensions)) {
      if (lowerName.includes(model.toLowerCase())) {
        console.log(`[VecstoreVectorStore] Dimension detected from model '${modelName}': ${dim}`);
        return dim;
      }
    }

    // 如果无法识别模型，记录警告并返回 4096（常见的大型模型维度）
    console.warn(`[VecstoreVectorStore] Unknown model '${modelName}', defaulting to 4096. Please add to modelDimensions mapping.`);
    return 4096;
  }

  async getDimension(): Promise<number> {
    this.ensureInitialized();
    return this.dimension;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('VecstoreVectorStore 尚未初始化');
    }
  }

  getStoreFilePath(): string {
    return path.join(app.getPath('userData'), 'vectors', this.source, this.getSafeSourceId(), STORE_FILE);
  }

  getMetadataFilePath(): string {
    return path.join(app.getPath('userData'), 'vectors', this.source, this.getSafeSourceId(), METADATA_FILE);
  }

  private getSafeSourceId(): string {
    // Windows文件系统不允许冒号，需要净化sourceId
    // 例如: "kb_doc:doc_1777872618318_0q468s:0" → "doc_1777872618318_0q468s"
    let safeId = this.sourceId;
    
    // 移除冒号分隔的前缀和后缀，保留中间的核心ID部分
    // 匹配模式: prefix:coreId 或 prefix:coreId:suffix
    const parts = safeId.split(':');
    if (parts.length >= 2) {
      // 优先取以 doc_ 开头的部分（最常见的核心ID格式）
      const docPart = parts.find(p => p.startsWith('doc_'));
      if (docPart) {
        safeId = docPart;
      } else {
        // 如果没有 doc_ 前缀，取第一个非前缀的部分
        // 前缀通常是短标识符如 "kb_doc", "wb", "worldbook" 等
        const corePart = parts.find(p => p.length > 5 && !/^[a-z]+$/i.test(p));
        if (corePart) {
          safeId = corePart;
        } else {
          // 回退：取最后一个部分
          safeId = parts[parts.length - 1];
        }
      }
    }
    
    // 移除任何剩余的Windows不允许的字符: \ / : * ? " < > |
    safeId = safeId.replace(/[\\/:*?"<>|]/g, '_');
    
    return safeId || this.sourceId;
  }

  private async ensureStoreDir(): Promise<void> {
    const baseDir = path.join(app.getPath('userData'), 'vectors', this.source, this.getSafeSourceId());
    await fsPromises.mkdir(baseDir, { recursive: true });
  }

  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    if (vector.length !== this.dimension) {
      console.error(`[VecstoreVectorStore] Dimension mismatch: expected ${this.dimension}, got ${vector.length} for ID: ${id}`);
      throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}. Please check your embedding model configuration or set the correct dimension in vector settings.`);
    }

    console.log(`[VecstoreVectorStore] Adding vector "${id}" with dimension ${vector.length}, text length: ${metadata.text?.length || 0}`);
    console.log(`[VecstoreVectorStore] Metadata keys to store:`, Object.keys(metadata));

    const item: VectorItem = {
      id,
      vector,
      metadata: {
        text: metadata.text || '',
        source: metadata.source || 'unknown',
        sourceId: metadata.sourceId || id,
        ...metadata,
        createdAt: metadata.createdAt || Date.now(),
        updatedAt: Date.now()
      }
    };

    try {
      console.log(`[VecstoreVectorStore] Calling upsert with metadata:`, JSON.stringify(item.metadata).substring(0, 200));
      this.store.upsert(id, new Float32Array(vector), item.metadata);
      
      // 同步更新元数据缓存
      console.log(`[VecstoreVectorStore] Caching metadata for "${id}":`, JSON.stringify(item.metadata).substring(0, 300));
      this.metadataCache.set(id, item.metadata);
      
      console.log(`[VecstoreVectorStore] Vector "${id}" upserted successfully. Store now has ${this.store.len()} vectors`);

      if (metadata.text) {
        this.store.index_text(id, metadata.text);
      }

      await this.persist();
      console.log(`[VecstoreVectorStore] Persisted ${this.store.len()} vectors to disk`);
    } catch (error) {
      console.error(`[VecstoreVectorStore] Failed to add vector "${id}":`, error);
      throw error;
    }
  }

  async addBatch(items: { id: string; vector: number[]; metadata: Record<string, any> }[]): Promise<void> {
    this.ensureInitialized();
    for (const item of items) {
      await this.add(item.id, item.vector, item.metadata);
    }
  }

  async addBatchNoPersist(items: { id: string; vector: number[]; metadata: Record<string, any> }[]): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    console.log(`[VecstoreVectorStore] addBatchNoPersist: processing ${items.length} items`);

    for (const item of items) {
      const vectorItem: VectorItem = {
        id: item.id,
        vector: item.vector,
        metadata: {
          text: item.metadata.text || '',
          source: item.metadata.source || 'unknown',
          sourceId: item.metadata.sourceId || item.id,
          ...item.metadata,
          createdAt: item.metadata.createdAt || Date.now(),
          updatedAt: Date.now()
        }
      };

      this.store.upsert(item.id, new Float32Array(item.vector), vectorItem.metadata);

      // 同步更新元数据缓存
      console.log(`[VecstoreVectorStore] addBatchNoPersist: caching "${item.id}", text length: ${vectorItem.metadata.text?.length || 0}`);
      this.metadataCache.set(item.id, vectorItem.metadata);

      if (item.metadata.text) {
        this.store.index_text(item.id, item.metadata.text);
      }
    }

    console.log(`[VecstoreVectorStore] addBatchNoPersist: metadata cache now has ${this.metadataCache.size} entries`);
    // DO NOT persist here - let the caller decide when to persist
  }

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!this.store) return [];

    console.log(`[VecstoreVectorStore] search(): query vector length=${query.length}, topK=${topK}, filter=`, filter);

    // 关键修复：维度不匹配时直接返回空数组，避免无效搜索返回错误结果
    if (query.length !== this.dimension) {
      console.error(`[VecstoreVectorStore] search(): Dimension mismatch - query vector has ${query.length} dimensions but store expects ${this.dimension}. Returning empty results.`);
      return [];
    }

    // WASM的query方法filter功能可能不稳定，先在内存中过滤
    const totalVectors = this.store.len();
    console.log(`[VecstoreVectorStore] search(): total vectors in store = ${totalVectors}`);
    
    if (totalVectors === 0) {
      console.warn('[VecstoreVectorStore] search(): store is empty, returning empty results');
      return [];
    }

    // 查询所有向量
    const rawResults = this.store.query(new Float32Array(query), Math.min(totalVectors, topK * 10), null);
    console.log(`[VecstoreVectorStore] search(): raw query returned ${rawResults.length} results`);

    // 诊断：打印原始 WASM 结果的分数和文本，确定 WASM 返回的是距离还是相似度
    console.log(`[VecstoreVectorStore] search(): RAW WASM results (first 5):`, 
      rawResults.slice(0, 5).map((r: any) => ({
        rawScore: r.score,
        textPreview: (this.metadataCache.get(r.id)?.text || '').substring(0, 40)
      })));

    // 关键修复：WASM 的 query() 方法返回的是**余弦距离**(cosine distance)
    // 距离越低 = 越相似 (0 = 完全相同, 2 = 完全相反)
    // 必须按升序排序（最低距离/最相似在前），然后转换为相似度分数
    const sortedResults = [...rawResults].sort((a: any, b: any) => a.score - b.score);
    
    console.log(`[VecstoreVectorStore] search(): sorted ${sortedResults.length} results by distance (ascending, lower = more similar)`);
    console.log(`[VecstoreVectorStore] search(): distance range: ${sortedResults[0]?.score?.toFixed(6) || 0} (closest) -> ${sortedResults[sortedResults.length-1]?.score?.toFixed(6) || 0} (farthest)`);
    
    // 将距离转换为相似度分数: similarity = 1 - distance
    // 然后按相似度降序排列（最高相似度在前）
    const allResults = sortedResults.map((r: any) => ({
      ...r,
      similarity: 1 - r.score,  // 距离转相似度
    })).sort((a: any, b: any) => b.similarity - a.similarity);
    
    console.log(`[VecstoreVectorStore] search(): similarity range: ${allResults[0]?.similarity?.toFixed(6) || 0} (most similar) -> ${allResults[allResults.length-1]?.similarity?.toFixed(6) || 0} (least similar)`);

    // 优化 2：分数范围诊断
    if (allResults.length > 0) {
      const scores = allResults.map((r: any) => r.score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const avgScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
      
      console.log(`[VecstoreVectorStore] Score diagnosis: min=${minScore.toFixed(6)}, max=${maxScore.toFixed(6)}, avg=${avgScore.toFixed(6)}`);
      
      // 优化 4：分数分布分析
      const distribution = this.analyzeScoreDistribution(scores);
      console.log(`[VecstoreVectorStore] Score distribution:`, distribution);
      
      // 打印 top 3 和 bottom 3 结果的分数和元数据，用于诊断分数排序方向
      const topSamples = allResults.slice(0, 3);
      const bottomSamples = allResults.slice(-3);
      console.log(`[VecstoreVectorStore] search(): TOP 3 results (should be most relevant):`, 
        topSamples.map((r: any) => ({ 
          id: r.id.substring(0, 50), 
          score: r.score,
          textPreview: (this.metadataCache.get(r.id)?.text || '').substring(0, 50)
        })));
      console.log(`[VecstoreVectorStore] search(): BOTTOM 3 results (should be least relevant):`, 
        bottomSamples.map((r: any) => ({ 
          id: r.id.substring(0, 50), 
          score: r.score,
          textPreview: (this.metadataCache.get(r.id)?.text || '').substring(0, 50)
        })));
    }

    // 在内存中应用过滤
    let filteredResults = allResults;
    if (filter) {
      console.log('[VecstoreVectorStore] search(): applying in-memory filter:', filter);
      filteredResults = allResults.filter(r => {
        const cachedMetadata = this.metadataCache.get(r.id);
        if (!cachedMetadata) return false;
        
        // 检查所有过滤条件
        return Object.entries(filter).every(([key, value]) => {
          return String(cachedMetadata[key]) === String(value);
        });
      });
      console.log(`[VecstoreVectorStore] search(): after filter, ${filteredResults.length} results remain`);
    }

    // 取topK
    // 按相似度降序排序（最高相似度在前）
    filteredResults.sort((a: any, b: any) => b.similarity - a.similarity);
    const topResults = filteredResults.slice(0, topK);
    console.log(`[VecstoreVectorStore] search(): returning top ${topResults.length} results (sorted by similarity desc)`);

    return topResults.map((r: any) => {
      // 从元数据缓存获取 metadata（WASM query 不返回 metadata）
      const cachedMetadata = this.metadataCache.get(r.id);
      const metadata = cachedMetadata || (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);
      
      console.log(`[VecstoreVectorStore] search(): result "${r.id.substring(0, 40)}" similarity = ${r.similarity.toFixed(6)}, text = "${(metadata?.text || '').substring(0, 50)}"`);
      
      return {
        id: r.id,
        score: r.similarity,  // 返回相似度而非距离
        metadata: metadata || {}
      };
    });
  }

  // 优化 4：分数分布分析工具
  private analyzeScoreDistribution(scores: number[]): Record<string, any> {
    if (scores.length === 0) return {};
    
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    const std = Math.sqrt(variance);
    
    // 计算直方图（10个桶）
    const buckets = Array(10).fill(0);
    scores.forEach(s => {
      const bucket = Math.min(9, Math.floor(((s - min) / (max - min || 1)) * 10));
      buckets[bucket]++;
    });
    
    return {
      count: scores.length,
      min: min.toFixed(6),
      max: max.toFixed(6),
      avg: avg.toFixed(6),
      std: std.toFixed(6),
      median: this.calculateMedian(scores).toFixed(6),
      histogram: buckets,
      range: (max - min).toFixed(6)
    };
  }

  private calculateMedian(scores: number[]): number {
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // 优化 5：混合搜索（向量 + 关键词）
  async hybridSearch(queryVector: number[], keywords: string, topK: number, alpha: number = 0.7): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!this.store) return [];

    console.log(`[VecstoreVectorStore] hybridSearch(): keywords="${keywords}", alpha=${alpha}, topK=${topK}`);

    // 检查 WASM 是否支持 hybrid_query 方法
    if (typeof (this.store as any).hybrid_query === 'function') {
      console.log('[VecstoreVectorStore] hybridSearch(): using WASM hybrid_query');
      const results = (this.store as any).hybrid_query(
        new Float32Array(queryVector),
        keywords,
        topK,
        alpha
      );
      
      return results.map((r: any) => {
        const cachedMetadata = this.metadataCache.get(r.id);
        const metadata = cachedMetadata || (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);
        
        return {
          id: r.id,
          score: r.score,
          metadata: metadata || {}
        };
      });
    } else {
      console.log('[VecstoreVectorStore] hybridSearch(): WASM hybrid_query not available, falling back to vector search');
      // 降级方案：仅使用向量搜索
      return this.search(queryVector, topK);
    }
  }

  // 优化 6：查询重写 - 扩展查询词以提高召回率
  async searchWithQueryExpansion(query: number[], topK: number, expansionTerms?: string[]): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!this.store) return [];

    // 第一步：使用原始查询搜索
    const originalResults = await this.search(query, topK);
    console.log(`[VecstoreVectorStore] searchWithQueryExpansion(): original query returned ${originalResults.length} results`);

    // 如果没有扩展词或结果足够好，直接返回
    if (!expansionTerms || expansionTerms.length === 0 || originalResults.length >= topK) {
      return originalResults;
    }

    // 第二步：对每个扩展词进行搜索（如果可用）
    // 这里简化实现，实际应调用 embedding API 生成扩展词的向量
    console.log(`[VecstoreVectorStore] searchWithQueryExpansion(): expansion terms: ${expansionTerms.join(', ')}`);

    // 合并去重结果
    const resultIds = new Set(originalResults.map(r => r.id));
    const mergedResults = [...originalResults];

    // 可以在此添加扩展词的搜索结果
    // 为简化，这里只返回原始结果
    console.log(`[VecstoreVectorStore] searchWithQueryExpansion(): merged ${mergedResults.length} results`);

    return mergedResults;
  }

  // 优化 8：性能监控指标
  async getPerformanceMetrics(): Promise<Record<string, any>> {
    this.ensureInitialized();
    
    const metrics: Record<string, any> = {
      totalVectors: this.store?.len() || 0,
      dimension: this.dimension,
      metadataCacheSize: this.metadataCache.size,
      storeInitialized: this.initialized,
      wasmReady: this.wasmReady
    };

    // 计算存储统计信息
    if (this.store) {
      try {
        const exportedData = this.store.export_json();
        metrics.storageSize = exportedData.length;
        metrics.storageSizeKB = (exportedData.length / 1024).toFixed(2);
      } catch (e) {
        metrics.storageSizeError = e instanceof Error ? e.message : String(e);
      }
    }

    console.log('[VecstoreVectorStore] Performance metrics:', metrics);
    return metrics;
  }

  // 优化 8：查询性能分析
  async analyzeQueryPerformance(query: number[], topK: number): Promise<Record<string, any>> {
    const startTime = performance.now();
    const results = await this.search(query, topK);
    const endTime = performance.now();

    const analysis: Record<string, any> = {
      queryTime: (endTime - startTime).toFixed(2),
      totalVectors: this.store?.len() || 0,
      resultsReturned: results.length,
      topK: topK,
      scoreRange: results.length > 0 ? {
        min: Math.min(...results.map(r => r.score)).toFixed(6),
        max: Math.max(...results.map(r => r.score)).toFixed(6),
        avg: (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(6)
      } : null
    };

    console.log('[VecstoreVectorStore] Query performance analysis:', analysis);
    return analysis;
  }

  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    const existingMetadata = this.getMetadata(id);
    const updatedMetadata = metadata ? { ...existingMetadata, ...metadata, updatedAt: Date.now() } : existingMetadata;

    this.store.upsert(id, new Float32Array(vector), updatedMetadata);

    if (metadata?.text) {
      this.store.index_text(id, metadata.text);
    }

    await this.persist();
  }

  private getMetadata(id: string): Record<string, any> {
    if (!this.store) return {};

    const results = this.store.query(new Float32Array(this.dimension).fill(0), 1, null);
    for (const r of results) {
      if (r.id === id) {
        return typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {};
      }
    }
    return {};
  }

  async delete(id: string): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    this.store.remove(id);
    
    // 同步删除元数据缓存
    this.metadataCache.delete(id);
    
    await this.persist();
  }

  async count(): Promise<number> {
    this.ensureInitialized();
    return this.store ? this.store.len() : 0;
  }

  getMode(): VectorStoreMode {
    return this.storeMode;
  }

  async rebuildIndex(): Promise<void> {
    await this.persist();
  }

  async persist(): Promise<void> {
    try {
      if (!this.store) {
        console.warn('[VecstoreVectorStore] persist() called but store is null');
        return;
      }

      const storeLen = this.store.len();
      console.log(`[VecstoreVectorStore] persist(): store has ${storeLen} vectors, metadata cache has ${this.metadataCache.size} entries`);
      
      if (storeLen === 0) {
        console.warn('[VecstoreVectorStore] persist() called on empty store, skipping');
        return;
      }

      console.log(`[VecstoreVectorStore] Calling export_json()...`);
      const data = this.store.export_json();
      console.log(`[VecstoreVectorStore] export_json() returned ${data.length} bytes`);
      
      // 验证导出数据格式
      try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) {
          console.warn(`[VecstoreVectorStore] export_json() returned non-array format: ${typeof parsed}, converting to array format...`);
          // 如果返回的是对象，尝试转换为数组格式
          if (typeof parsed === 'object' && parsed !== null) {
            const vectors = parsed.vectors || parsed.data || parsed.entries || [];
            if (Array.isArray(vectors) && vectors.length > 0) {
              console.log(`[VecstoreVectorStore] Successfully extracted ${vectors.length} vectors from object format`);
            }
          }
        } else {
          console.log(`[VecstoreVectorStore] export_json() returned valid array format with ${parsed.length} items`);
        }
      } catch (parseError) {
        console.error('[VecstoreVectorStore] export_json() returned invalid JSON:', parseError);
      }
      
      if (data.length < 100) {
        console.warn(`[VecstoreVectorStore] export_json() returned suspiciously small data:`, data.substring(0, Math.min(200, data.length)));
      }
      
      const storePath = this.getStoreFilePath();
      console.log(`[VecstoreVectorStore] Writing ${data.length} bytes to ${storePath}...`);
      await fsPromises.writeFile(storePath, data, 'utf-8');
      
      const stats = await fsPromises.stat(storePath);
      console.log(`[VecstoreVectorStore] Vector file written successfully: ${stats.size} bytes`);

      // 保存元数据到独立文件（确保重启后不丢失）
      await this.saveMetadataToFile();
      
      console.log(`[VecstoreVectorStore] Persisted ${storeLen} vectors and ${this.metadataCache.size} metadata entries to disk`);
    } catch (error) {
      console.error('[VecstoreVectorStore] 持久化失败:', error);
      throw error;
    }
  }

  private async saveMetadataToFile(): Promise<void> {
    this.metadataFilePath = this.getMetadataFilePath();

    try {
      const metadataObj: Record<string, any> = {};
      for (const [id, metadata] of this.metadataCache.entries()) {
        metadataObj[id] = metadata;
      }

      const jsonStr = JSON.stringify(metadataObj);
      console.log(`[VecstoreVectorStore] Saving metadata to ${this.metadataFilePath} (${jsonStr.length} bytes)...`);
      await fsPromises.writeFile(this.metadataFilePath, jsonStr, 'utf-8');
      
      const stats = await fsPromises.stat(this.metadataFilePath);
      console.log(`[VecstoreVectorStore] Metadata file written successfully: ${stats.size} bytes, ${this.metadataCache.size} entries`);
    } catch (error) {
      console.error('[VecstoreVectorStore] 元数据持久化失败:', error);
    }
  }

  private async loadMetadataFromFile(): Promise<void> {
    if (!this.metadataFilePath) {
      this.metadataFilePath = path.join(app.getPath('userData'), 'vectors', this.source, this.getSafeSourceId(), METADATA_FILE);
    }

    try {
      if (!fs.existsSync(this.metadataFilePath)) {
        console.log(`[VecstoreVectorStore] No metadata file found at ${this.metadataFilePath}, starting with empty cache`);
        return;
      }

      const data = await fsPromises.readFile(this.metadataFilePath, 'utf-8');
      console.log(`[VecstoreVectorStore] Loading metadata from file (${data.length} bytes)...`);
      
      const metadataObj = JSON.parse(data);
      this.metadataCache.clear();
      
      let count = 0;
      for (const [id, metadata] of Object.entries(metadataObj)) {
        const metadataObj2 = metadata as Record<string, any>;
        console.log(`[VecstoreVectorStore] Loading metadata for "${id}": text length = ${metadataObj2.text?.length || 0}, keys = ${Object.keys(metadataObj2).join(', ')}`);
        this.metadataCache.set(id, metadataObj2);
        count++;
      }
      
      console.log(`[VecstoreVectorStore] Loaded ${count} metadata entries from file`);
    } catch (error) {
      console.error('[VecstoreVectorStore] 元数据加载失败:', error);
    }
  }

  async load(): Promise<void> {
    await this.initialize();
  }

  async clear(): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    while (this.store.len() > 0) {
      const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
      for (const r of results) {
        this.store.remove(r.id);
      }
    }
    
    // 清空元数据缓存
    this.metadataCache.clear();
    
    await this.persist();
  }

  async getById(id: string): Promise<VectorItem | null> {
    this.ensureInitialized();
    if (!this.store) return null;

    // 先检查 WASM store 中是否存在该向量
    const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
    let found = false;
    for (const r of results) {
      if (r.id === id) {
        found = true;
        break;
      }
    }
    
    if (!found) {
      console.warn(`[VecstoreVectorStore] Vector "${id}" not found in store`);
      return null;
    }

    // 从元数据缓存获取 metadata（WASM query 不返回 metadata）
    const cachedMetadata = this.metadataCache.get(id);
    if (!cachedMetadata) {
      console.warn(`[VecstoreVectorStore] Metadata not found in cache for "${id}"`);
      return {
        id: id,
        vector: [],
        metadata: {}
      };
    }

    console.log(`[VecstoreVectorStore] getById("${id}") returning metadata with keys: ${Object.keys(cachedMetadata).join(', ')}, text length: ${cachedMetadata.text?.length || 0}`);

    return {
      id: id,
      vector: [],
      metadata: cachedMetadata
    };
  }

  async countByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.store) return 0;
    
    const totalVectors = this.store.len();
    console.log(`[VecstoreVectorStore] countByPrefix("${prefix}"): total vectors in store = ${totalVectors}`);
    
    if (totalVectors === 0) {
      console.warn(`[VecstoreVectorStore] Store is empty! No vectors found.`);
      return 0;
    }
    
    console.log(`[VecstoreVectorStore] Executing query with topK=${totalVectors}...`);
    const results = this.store.query(new Float32Array(this.dimension).fill(0), totalVectors, null);
    console.log(`[VecstoreVectorStore] Query returned ${results.length} results`);
    
    if (results.length > 0 && results.length <= 3) {
      console.log(`[VecstoreVectorStore] Query result samples:`, JSON.stringify(results.map(r => ({ id: r.id, metadata: typeof r.metadata === 'string' ? r.metadata.substring(0, 50) : r.metadata }))));
    }
    
    let count = 0;
    const sampleIds = [];
    for (const r of results) {
      if (r.id.startsWith(prefix)) count++;
      if (sampleIds.length < 5) sampleIds.push(r.id);
    }
    
    console.log(`[VecstoreVectorStore] Found ${count} vectors matching prefix "${prefix}"`);
    if (sampleIds.length > 0) {
      console.log(`[VecstoreVectorStore] Sample IDs in store: ${JSON.stringify(sampleIds)}`);
    }
    
    return count;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.store) return 0;
    const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
    const idsToDelete: string[] = [];
    for (const r of results) {
      if (r.id.startsWith(prefix)) idsToDelete.push(r.id);
    }
    for (const id of idsToDelete) {
      this.store.remove(id);
      // 同步删除元数据缓存
      this.metadataCache.delete(id);
    }
    if (idsToDelete.length > 0) await this.persist();
    return idsToDelete.length;
  }

  async destroy(): Promise<void> {
    // 关键修复：在释放 WASM 存储之前，先持久化数据到磁盘
    if (this.store && this.initialized && this.store.len() > 0) {
      console.log(`[VecstoreVectorStore] destroy(): persisting ${this.store.len()} vectors before shutdown...`);
      try {
        await this.persist();
        console.log('[VecstoreVectorStore] destroy(): data persisted successfully');
      } catch (error) {
        console.error('[VecstoreVectorStore] destroy(): failed to persist data:', error);
      }
    }
    
    if (this.store) {
      this.store.free();
      this.store = null;
    }
    this.initialized = false;
    this.wasmReady = false;
    console.log('[VecstoreVectorStore] destroy(): WASM store destroyed');
  }

  /**
   * 销毁 WASM store 并物理删除 vecstore 文件（用于完全删除文档/世界书场景）
   */
  async destroyAndDeleteFiles(): Promise<void> {
    console.log(`[VecstoreVectorStore] destroyAndDeleteFiles(): destroying and deleting files for ${this.source}:${this.sourceId}`);
    
    // 先释放 WASM 资源
    if (this.store) {
      this.store.free();
      this.store = null;
    }
    this.initialized = false;
    this.wasmReady = false;
    
    // 物理删除 vecstore.json 和 vecstore_metadata.json
    const fsPromises = (await import('fs/promises')).default;
    let deletedCount = 0;
    
    if (this.storeFilePath) {
      try {
        await fsPromises.unlink(this.storeFilePath);
        console.log(`[VecstoreVectorStore] Deleted vecstore file: ${this.storeFilePath}`);
        deletedCount++;
      } catch (err) {
        console.warn(`[VecstoreVectorStore] Failed to delete vecstore file: ${this.storeFilePath}`, err);
      }
    }
    
    if (this.metadataFilePath) {
      try {
        await fsPromises.unlink(this.metadataFilePath);
        console.log(`[VecstoreVectorStore] Deleted metadata file: ${this.metadataFilePath}`);
        deletedCount++;
      } catch (err) {
        console.warn(`[VecstoreVectorStore] Failed to delete metadata file: ${this.metadataFilePath}`, err);
      }
    }
    
    console.log(`[VecstoreVectorStore] destroyAndDeleteFiles(): deleted ${deletedCount} files`);
  }

  async reset(): Promise<void> {
    await this.destroy();
    
    const storePath = this.getStoreFilePath();
    if (fs.existsSync(storePath)) {
      console.log(`[VecstoreVectorStore] Deleting incompatible store file: ${storePath}`);
      await fsPromises.unlink(storePath);
    }
    
    // 删除元数据文件
    if (this.metadataFilePath && fs.existsSync(this.metadataFilePath)) {
      console.log(`[VecstoreVectorStore] Deleting metadata file: ${this.metadataFilePath}`);
      await fsPromises.unlink(this.metadataFilePath);
    }
    
    // 清空元数据缓存
    this.metadataCache.clear();
    
    this.dimension = 384;
    console.log('[VecstoreVectorStore] Store reset, ready for re-initialization with correct dimension');
  }
}

export const vecstoreVectorStore = new VecstoreVectorStore();
