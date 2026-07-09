import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import init, { WasmVecStore } from 'vecstore-wasm';
import { VectorItem, SearchResult, VectorStoreMode } from '../types/vectorConfig';
import { getStorageService } from './storageService';
import type { IVectorBackend } from './vector/IVectorBackend';

const STORE_FILE = 'vecstore.json';
const METADATA_FILE = 'vecstore_metadata.json';
const WASM_INIT_TIMEOUT = 30000;
// 写入 debounce 时间窗口（ms）：add() 默认不立即 persist，合并到 500ms 窗口落盘
const PERSIST_DEBOUNCE_MS = 500;

interface VecstoreInitOptions {
  source?: string;     // 来源类型: knowledge, worldbook, document
  sourceId?: string;   // 来源ID（如世界书名称或文档ID）
}

/**
 * VecstoreBackend - vecstore-wasm 的 IVectorBackend 实现
 *
 * 三层抽象架构（Task 3）：
 *   - 本类是 IVectorBackend 的具体实现（基于 vecstore-wasm / WASM）
 *   - 多源路由与反向索引由 VectorRepository 承接
 *   - Facade（VectorStoreService）协调缓存与策略
 *
 * 性能修复点：
 *   - SubTask 3.6: clear() 改为重建 WasmVecStore 实例 O(1)（原为 O(n²) 循环 query+remove）
 *   - SubTask 3.7: getById / getMetadata 通过 metadataCache Map O(1) 查找（原为全表扫 O(n)）
 *   - SubTask 3.8: add() 默认不 persist（原为每次 add 立即 persist 阻塞）
 *                  引入 500ms 写入 debounce 合并落盘；addBatch 末尾调用一次 persist
 *   - SubTask 3.10: addBatchNoPersist 补齐 assertDimension 校验（原跳过）
 */
export class VecstoreBackend implements IVectorBackend {
  public source: string = 'default';
  public sourceId: string = '';
  private store: WasmVecStore | null = null;
  private dimension: number = 1024;
  private storeMode: VectorStoreMode = 'vecstore';
  private _initialized = false;

  /**
   * 元数据索引 Map<id, metadata>
   * 用途：
   *   1. getById O(1) 查找（修复 SubTask 3.7）
   *   2. search 时由 id 取 metadata（WASM query 不返回 metadata）
   *   3. countByPrefix / deleteByPrefix 时遍历 keys 比 WASM query 全表扫快得多
   */
  private metadataCache: Map<string, Record<string, any>> = new Map();
  private metadataFilePath: string = '';
  private storeFilePath: string = '';

  /**
   * 写入 debounce 句柄。add() 默认不立即 persist，
   * 在 PERSIST_DEBOUNCE_MS 内合并多次写入，到期触发一次 persist。
   */
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private persistInFlight: Promise<void> | null = null;

  /**
   * 静态标记：migrateOldStoreFiles() 是全局扫描（非实例特定），
   * 多个 backend 实例只需运行一次。置位后后续实例直接跳过。
   */
  private static migrationCompleted = false;

  private async timeout(ms: number): Promise<void> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('操作超时')), ms)
    );
  }

  /**
   * 初始化 WASM store，加载已有数据。
   * 幂等：重复调用直接返回。
   */
  async initialize(options?: VecstoreInitOptions): Promise<void> {
    try {
      if (this._initialized) return;

      this.source = options?.source || 'default';
      this.sourceId = options?.sourceId || 'default';
      console.log(`[VecstoreBackend] Initializing WASM module for source: ${this.source}, sourceId: ${this.sourceId}...`);

      // Task 6: 在读取 dimension / 构造路径之前，先把旧格式（无 dimension 子目录）
      // 的 vecstore.json / vecstore_metadata.json 移动到正确的 dimension 子目录下。
      // 这是全局扫描，多实例只运行一次（migrationCompleted 静态标记保证幂等）。
      await this.migrateOldStoreFiles();

      await this.ensureStoreDir();

      await Promise.race([
        init(),
        this.timeout(WASM_INIT_TIMEOUT)
      ]);

      // STEP 1: Load dimension from config FIRST (before constructing path).
      // 这样 getStoreFilePath() 才能把 dimension 作为路径段拼入路径，
      // 避免 dimension 加载在路径构造之后导致读到错误目录。
      await this.loadDimensionFromConfig();

      // STEP 2: Construct store path with dimension
      let storePath = this.getStoreFilePath();
      console.log(`[VecstoreBackend] Store file path: ${storePath}`);

      let existingDataStr: string = '';
      let existingDimension: number | null = null;
      let hasExistingData = false;

      // 解析已有数据并尝试从 header / 首条向量推断 existingDimension。
      // 抽出为本地函数，供新路径与旧路径回退两个分支复用，避免重复代码。
      const parseExistingData = (dataStr: string): void => {
        if (dataStr.length === 0) return;
        hasExistingData = true;

        try {
          const parsed = JSON.parse(dataStr);

          let vectors: any[] = [];

          if (Array.isArray(parsed)) {
            vectors = parsed;
            console.log(`[VecstoreBackend] Format: simple array`);
          } else if (typeof parsed === 'object' && parsed !== null) {
            if (parsed.records && Array.isArray(parsed.records)) {
              vectors = parsed.records;
              console.log(`[VecstoreBackend] Format: vecstore.json with .records array`);
              if (parsed.dimension && typeof parsed.dimension === 'number') {
                existingDimension = parsed.dimension;
                console.log(`[VecstoreBackend] Dimension found in file header: ${existingDimension}`);
              }
            } else if (parsed.vectors && Array.isArray(parsed.vectors)) {
              vectors = parsed.vectors;
              console.log(`[VecstoreBackend] Format: WASM native with .vectors array`);
            } else if (parsed.data && Array.isArray(parsed.data)) {
              vectors = parsed.data;
              console.log(`[VecstoreBackend] Format: with .data array`);
            } else {
              console.log(`[VecstoreBackend] Format: unknown object, will let WASM import_json handle it`);
            }
          }

          if (vectors.length > 0 && existingDimension === null) {
            const firstVector = vectors[0];
            if (firstVector?.vector && Array.isArray(firstVector.vector)) {
              existingDimension = firstVector.vector.length;
              console.log(`[VecstoreBackend] Existing vectors have dimension: ${existingDimension}`);
            }

            const samples = vectors.slice(0, 3).map((v: any) => ({
              id: v.id || 'unknown',
              vectorLength: v.vector?.length || 'N/A'
            }));
            console.log(`[VecstoreBackend] Sample vectors:`, JSON.stringify(samples));
          }
        } catch (parseError) {
          console.error('[VecstoreBackend] Failed to analyze existing data:', parseError);
        }
      };

      // STEP 3: Check new dimension-based path first
      if (fs.existsSync(storePath)) {
        const stats = fs.statSync(storePath);
        console.log(`[VecstoreBackend] Loading existing data from disk: ${storePath} (${stats.size} bytes)`);
        existingDataStr = await fsPromises.readFile(storePath, 'utf-8');
        console.log(`[VecstoreBackend] Raw data length: ${existingDataStr.length} bytes`);
        parseExistingData(existingDataStr);
      } else {
        // STEP 4: Fallback to old path (without dimension) for migration compatibility.
        // 旧版本路径不含 dimension 段，新版本首次启动时在此读取老数据；
        // 完整的文件迁移（移动到新路径）由后续 Task 6 处理，此处仅做读取回退。
        const oldPath = this.getOldStoreFilePath();
        if (fs.existsSync(oldPath)) {
          console.log(`[VecstoreBackend] New path not found, trying old path: ${oldPath}`);
          existingDataStr = await fsPromises.readFile(oldPath, 'utf-8');
          console.log(`[VecstoreBackend] Raw data length: ${existingDataStr.length} bytes`);
          parseExistingData(existingDataStr);
        } else {
          console.log(`[VecstoreBackend] No existing store file found at: ${storePath} (also checked old path: ${oldPath})`);
        }
      }

      // 关键修复：优先使用现有数据的维度（避免 dimension 与已存向量不匹配）。
      // 若从旧路径读取的数据维度与 config 推断的不同，以数据维度为准并重建路径，
      // 保证后续 persist 写入与读取使用同一 dimension 隔离目录。
      if (existingDimension !== null) {
        console.log(`[VecstoreBackend] Using existing data dimension: ${existingDimension}`);
        if (this.dimension !== existingDimension) {
          this.dimension = existingDimension;
          // Re-construct storePath with correct dimension (now uses updated this.dimension)
          storePath = this.getStoreFilePath();
          console.log(`[VecstoreBackend] Re-constructed store path with updated dimension: ${storePath}`);
        }
      } else {
        console.log(`[VecstoreBackend] Using dimension from config: ${this.dimension}`);
      }

      this.store = new WasmVecStore(this.dimension);

      if (hasExistingData) {
        console.log(`[VecstoreBackend] Importing ${existingDataStr.length} bytes into WASM store...`);
        try {
          const parsed = JSON.parse(existingDataStr);

          let vectors: any[] = [];
          if (Array.isArray(parsed)) {
            vectors = parsed;
          } else if (typeof parsed === 'object') {
            vectors = parsed.records || parsed.vectors || parsed.data || parsed.entries || [];
            if (!Array.isArray(vectors)) {
              vectors = Object.values(parsed).filter((v: any) => v && typeof v === 'object' && v.id && v.vector);
            }
          }

          if (vectors.length > 0) {
            console.log(`[VecstoreBackend] Found ${vectors.length} vectors in data, importing via upsert...`);

            let importedCount = 0;
            for (const v of vectors) {
              if (v && v.id && v.vector && Array.isArray(v.vector)) {
                try {
                  let metadata = v.metadata || {};
                  if (metadata && typeof metadata === 'object' && 'fields' in metadata && typeof metadata.fields === 'object') {
                    metadata = metadata.fields;
                  }
                  this.store.upsert(v.id, new Float32Array(v.vector), metadata);
                  // 同步构建 metadataCache 索引（修复 SubTask 3.7）
                  this.metadataCache.set(v.id, metadata);
                  importedCount++;
                } catch (err) {
                  console.warn(`[VecstoreBackend] Failed to import vector "${v.id}":`, err);
                }
              }
            }

            console.log(`[VecstoreBackend] Manually imported ${importedCount}/${vectors.length} vectors via upsert, metadataCache has ${this.metadataCache.size} entries`);
          } else {
            console.log(`[VecstoreBackend] No vectors found in parsed data, trying WASM import_json...`);
            this.store.import_json(existingDataStr);
          }

          const loadedCount = this.store.len();
          console.log(`[VecstoreBackend] Store now has ${loadedCount} vectors after import`);

          if (loadedCount > 0) {
            console.log(`[VecstoreBackend] Successfully loaded ${loadedCount} vectors from disk!`);
          } else {
            console.error(`[VecstoreBackend] Still 0 vectors after import! Data format issue.`);
          }
        } catch (importError) {
          console.error('[VecstoreBackend] Failed to import data:', importError);
          console.log('[VecstoreBackend] Starting with empty store');
        }
      } else {
        console.log('[VecstoreBackend] Created new empty store');
      }

      this._initialized = true;
      console.log(`[VecstoreBackend] Initialization complete. Store contains ${this.store?.len() || 0} vectors`);

      this.storeFilePath = storePath;
      this.metadataFilePath = this.getMetadataFilePath();

      // 从持久化文件加载元数据（解决 WASM query 不返回 metadata 的问题）
      await this.loadMetadataFromFile();

      const storeLen = this.store?.len() || 0;
      const metadataLen = this.metadataCache.size;
      console.log(`[VecstoreBackend] Metadata cache loaded ${metadataLen} entries from file`);

      if (storeLen > 0 && metadataLen === 0) {
        console.error(`[VecstoreBackend] DATA INTEGRITY WARNING: Store has ${storeLen} vectors but metadata cache is empty!`);
      } else if (storeLen > 0 && metadataLen !== storeLen) {
        console.warn(`[VecstoreBackend] DATA MISMATCH: Store has ${storeLen} vectors but metadata cache has ${metadataLen} entries`);
      } else if (storeLen === 0 && metadataLen > 0) {
        console.warn(`[VecstoreBackend] ORPHAN METADATA: Store is empty but metadata has ${metadataLen} entries`);
      } else {
        console.log(`[VecstoreBackend] Data integrity check passed: ${storeLen} vectors, ${metadataLen} metadata entries`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === '操作超时') {
        console.error('[VecstoreBackend] WASM initialization timeout after', WASM_INIT_TIMEOUT, 'ms');
        throw new Error(`WASM 初始化超时 (${WASM_INIT_TIMEOUT}ms)，请检查 vecstore.json 文件是否过大`);
      }
      console.error('[VecstoreBackend] 初始化失败:', error);
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
        console.log(`[VecstoreBackend] Loaded dimension from config: ${this.dimension}`);
        return;
      }

      if (vectorConfig?.remoteModel && vectorConfig?.remoteApiUrl) {
        try {
          console.log(`[VecstoreBackend] Auto-detecting dimension from embedding API...`);
          const { embeddingService } = await import('./EmbeddingService');
          const testResult = await embeddingService.generateEmbedding('dimension detection test');
          if (testResult.success && testResult.dimension && testResult.dimension > 0) {
            this.dimension = testResult.dimension;
            console.log(`[VecstoreBackend] Auto-detected dimension from API: ${this.dimension} (model: ${testResult.model})`);
            return;
          }
        } catch (detectError) {
          console.warn('[VecstoreBackend] Auto-detection failed, falling back to model inference:', detectError);
        }
      }

      if (vectorConfig?.remoteModel) {
        this.dimension = this.inferDimensionFromModel(vectorConfig.remoteModel);
        console.log(`[VecstoreBackend] Inferred dimension from model ${vectorConfig.remoteModel}: ${this.dimension}`);
      } else {
        console.log(`[VecstoreBackend] Using default dimension: ${this.dimension}`);
      }
    } catch (error) {
      console.warn('[VecstoreBackend] Failed to load dimension from config, using default 1024:', error);
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
      'qwen3-embedding-4b': 2560,
      'qwen3-emb-4b': 2560,
      'qwen3-embedding-0.6b': 1024,
      'qwen3-emb-0.6b': 1024,
      'electroglyph/qwen3-embedding-0.6b': 1024,
      'onnx-community/qwen3-embedding-0.6b': 1024,
      'onnx-community/qwen3-embedding-4b': 2560,
      'onnx-community/qwen3-embedding-8b': 4096,
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
        console.log(`[VecstoreBackend] Dimension detected from model '${modelName}': ${dim}`);
        return dim;
      }
    }

    console.warn(`[VecstoreBackend] Unknown model '${modelName}', defaulting to 4096. Please add to modelDimensions mapping.`);
    return 4096;
  }

  getDimension(): number {
    this.ensureInitialized();
    return this.dimension;
  }

  /**
   * 维度变更时调用：在配置切换 embedding 模型导致维度变化时，
   * 由 VectorConfigManager 触发，加载对应维度的 store 实例。
   *
   * Task 4 修复：原实现只是创建空 store，会丢失新维度下已存在的数据。
   * 新实现：持久化旧数据 -> 释放旧 store -> 切换 dimension/路径 ->
   *        创建新 store -> 从新维度路径加载已有数据（若存在）。
   * 不删除旧维度数据文件，以便用户切回时仍可使用。
   */
  async handleDimensionChange(newDimension: number): Promise<void> {
    if (newDimension === this.dimension) {
      console.log(`[VecstoreBackend] handleDimensionChange: dimension unchanged (${newDimension}), skipping`);
      return;
    }

    console.log(`[VecstoreBackend] handleDimensionChange: ${this.dimension} -> ${newDimension}, loading corresponding store`);

    // 1. 持久化旧数据到旧维度路径（必须在切换 dimension 之前完成）
    try {
      await this.persistImmediate();
    } catch (err) {
      console.warn(`[VecstoreBackend] handleDimensionChange: failed to persist old data:`, err);
    }

    // 2. 释放旧 store
    if (this.store) {
      try {
        this.store.free();
      } catch (e) {
        console.warn(`[VecstoreBackend] handleDimensionChange: failed to free old store:`, e);
      }
      this.store = null;
    }

    // 3. 更新 dimension 与路径（getStoreFilePath / getMetadataFilePath 现在使用新 dimension）
    this.dimension = newDimension;
    this.metadataCache.clear();
    this.storeFilePath = this.getStoreFilePath();
    this.metadataFilePath = this.getMetadataFilePath();

    // 4. 创建新 store 并尝试从新维度路径加载已有数据
    this.store = new WasmVecStore(this.dimension);

    if (fs.existsSync(this.storeFilePath)) {
      console.log(`[VecstoreBackend] Loading existing data for dimension ${newDimension} from: ${this.storeFilePath}`);
      try {
        const existingDataStr = await fsPromises.readFile(this.storeFilePath, 'utf-8');
        if (existingDataStr.length > 0) {
          // 复用 initialize() 中的解析逻辑
          const parsed = JSON.parse(existingDataStr);
          let vectors: any[] = [];
          if (Array.isArray(parsed)) {
            vectors = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            vectors = parsed.records || parsed.vectors || parsed.data || parsed.entries || [];
          }

          let importedCount = 0;
          for (const v of vectors) {
            if (v && v.id && v.vector && Array.isArray(v.vector)) {
              try {
                let metadata = v.metadata || {};
                if (metadata && typeof metadata === 'object' && 'fields' in metadata && typeof metadata.fields === 'object') {
                  metadata = metadata.fields;
                }
                this.store.upsert(v.id, new Float32Array(v.vector), metadata);
                this.metadataCache.set(v.id, metadata);
                importedCount++;
              } catch (err) {
                console.warn(`[VecstoreBackend] Failed to import vector "${v.id}":`, err);
              }
            }
          }
          console.log(`[VecstoreBackend] Loaded ${importedCount} vectors for dimension ${newDimension}`);
        }
      } catch (loadErr) {
        console.warn(`[VecstoreBackend] Failed to load existing data for dimension ${newDimension}:`, loadErr);
      }
    } else {
      console.log(`[VecstoreBackend] No existing data for dimension ${newDimension}, starting fresh`);
    }

    // 5. 加载 metadata 文件（若存在）— 补齐 metadataCache 中缺失的条目
    if (fs.existsSync(this.metadataFilePath)) {
      try {
        const metaStr = await fsPromises.readFile(this.metadataFilePath, 'utf-8');
        if (metaStr.length > 0) {
          const metaParsed = JSON.parse(metaStr);
          if (metaParsed && typeof metaParsed === 'object') {
            for (const [id, meta] of Object.entries(metaParsed)) {
              if (!this.metadataCache.has(id)) {
                this.metadataCache.set(id, meta as Record<string, any>);
              }
            }
          }
        }
      } catch (metaErr) {
        console.warn(`[VecstoreBackend] Failed to load metadata for dimension ${newDimension}:`, metaErr);
      }
    }

    this._initialized = true;
    console.log(`[VecstoreBackend] Store ready with dimension ${newDimension}, ${this.store.len()} vectors`);
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('VecstoreBackend 尚未初始化');
    }
  }

  /** 公共访问器（修复 baseline 中 private 导致外部访问报 TS 错的问题） */
  get initialized(): boolean {
    return this._initialized;
  }

  getStoreFilePath(): string {
    const safeSourceId = this.getSafeSourceId();
    const dim = String(this.dimension || 1024);
    if (this.source === 'default' && (safeSourceId === 'default' || !safeSourceId)) {
      return path.join(app.getPath('userData'), 'vectors', this.source, dim, STORE_FILE);
    }
    return path.join(app.getPath('userData'), 'vectors', this.source, safeSourceId, dim, STORE_FILE);
  }

  getMetadataFilePath(): string {
    const safeSourceId = this.getSafeSourceId();
    const dim = String(this.dimension || 1024);
    if (this.source === 'default' && (safeSourceId === 'default' || !safeSourceId)) {
      return path.join(app.getPath('userData'), 'vectors', this.source, dim, METADATA_FILE);
    }
    return path.join(app.getPath('userData'), 'vectors', this.source, safeSourceId, dim, METADATA_FILE);
  }

  /**
   * 返回不含 dimension 段的旧版 store 路径（迁移兼容用）。
   * 当新的 dimension 隔离路径下找不到文件时，回退到此路径读取已有数据。
   * 完整的文件迁移（移动）由后续 Task 6 处理，此处仅做读取回退。
   */
  getOldStoreFilePath(): string {
    const safeSourceId = this.getSafeSourceId();
    if (this.source === 'default' && (safeSourceId === 'default' || !safeSourceId)) {
      return path.join(app.getPath('userData'), 'vectors', this.source, STORE_FILE);
    }
    return path.join(app.getPath('userData'), 'vectors', this.source, safeSourceId, STORE_FILE);
  }

  /**
   * Task 6: 全局扫描 vectors/ 目录，将旧格式（不含 dimension 子目录）的
   * vecstore.json / vecstore_metadata.json 移动到对应的 dimension 子目录下。
   *
   * 幂等性：
   *   - 静态 migrationCompleted 标记保证多实例只运行一次
   *   - 若目标路径已存在则跳过，不覆盖
   *
   * 错误处理：单文件失败不影响其他文件，仅 log 跳过。
   */
  async migrateOldStoreFiles(): Promise<void> {
    if (VecstoreBackend.migrationCompleted) return;
    VecstoreBackend.migrationCompleted = true;

    try {
      const vectorsRoot = path.join(app.getPath('userData'), 'vectors');
      if (!fs.existsSync(vectorsRoot)) return;

      console.log('[VecstoreBackend] Checking for old-format store files to migrate...');

      // 遍历 source 目录（knowledge / worldbook / document / default ...）
      const sources = fs.readdirSync(vectorsRoot);
      for (const source of sources) {
        const sourcePath = path.join(vectorsRoot, source);
        let sourceStat: fs.Stats;
        try {
          sourceStat = fs.statSync(sourcePath);
        } catch {
          continue;
        }
        if (!sourceStat.isDirectory()) continue;

        // 情况 A：source 目录直接含 vecstore.json（旧格式：无 sourceId 子目录）
        await this.migrateOldStoreInDir(sourcePath, source, '');

        // 遍历 source 下的子目录（sourceId 层级）
        const entries = fs.readdirSync(sourcePath);
        for (const entry of entries) {
          const entryPath = path.join(sourcePath, entry);
          let entryStat: fs.Stats;
          try {
            entryStat = fs.statSync(entryPath);
          } catch {
            continue;
          }
          if (!entryStat.isDirectory()) continue;

          // 若已是 dimension 目录（纯数字如 "1024"/"4096"），跳过
          if (/^\d+$/.test(entry)) continue;

          // 情况 B：sourceId 子目录直接含 vecstore.json（旧格式：无 dimension 子目录）
          await this.migrateOldStoreInDir(entryPath, source, entry);
        }
      }
      console.log('[VecstoreBackend] Migration check complete');
    } catch (error) {
      console.warn('[VecstoreBackend] Migration failed:', error);
    }
  }

  /**
   * 处理单个目录中的旧格式 vecstore.json：
   *   1. 读取文件，从 header (parsed.dimension) 或首条向量长度推断 dimension
   *   2. 构造新路径：{dirPath}/{dimension}/vecstore.json
   *   3. 若新路径已存在则跳过（幂等）；否则创建 dimension 目录并移动文件
   *   4. 同时移动对应的 metadata 文件（若存在）
   */
  private async migrateOldStoreInDir(dirPath: string, source: string, sourceId: string): Promise<void> {
    const storeFile = path.join(dirPath, STORE_FILE);
    if (!fs.existsSync(storeFile)) return;

    // 这是旧格式文件（无 dimension 子目录）。从中读取 dimension。
    try {
      const data = await fsPromises.readFile(storeFile, 'utf-8');
      const parsed = JSON.parse(data);

      let dimension: number | null = null;
      let vectors: any[] = [];

      if (Array.isArray(parsed)) {
        vectors = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        if (parsed.dimension && typeof parsed.dimension === 'number') {
          dimension = parsed.dimension;
        }
        vectors = parsed.records || parsed.vectors || parsed.data || [];
      }

      if (dimension === null && vectors.length > 0 && vectors[0]?.vector && Array.isArray(vectors[0].vector)) {
        dimension = vectors[0].vector.length;
      }

      if (dimension === null) {
        console.warn(`[VecstoreBackend] Migration: could not determine dimension for ${storeFile}, skipping`);
        return;
      }

      // 构造新路径
      const dimDir = path.join(dirPath, String(dimension));
      const newStoreFile = path.join(dimDir, STORE_FILE);

      if (fs.existsSync(newStoreFile)) {
        console.log(`[VecstoreBackend] Migration: new path already exists for ${storeFile}, skipping`);
        return;
      }

      // 创建 dimension 目录并移动文件
      fs.mkdirSync(dimDir, { recursive: true });
      fs.renameSync(storeFile, newStoreFile);
      console.log(`[VecstoreBackend] Migration: moved ${storeFile} -> ${newStoreFile} (dimension: ${dimension}, source: ${source}, sourceId: ${sourceId})`);

      // 同时移动 metadata 文件（若存在）
      const metaFile = path.join(dirPath, METADATA_FILE);
      if (fs.existsSync(metaFile)) {
        const newMetaFile = path.join(dimDir, METADATA_FILE);
        if (!fs.existsSync(newMetaFile)) {
          fs.renameSync(metaFile, newMetaFile);
          console.log(`[VecstoreBackend] Migration: moved metadata ${metaFile} -> ${newMetaFile}`);
        }
      }
    } catch (err) {
      console.warn(`[VecstoreBackend] Migration: failed to process ${storeFile}:`, err);
    }
  }

  private getSafeSourceId(): string {
    let safeId = this.sourceId;
    const parts = safeId.split(':');
    if (parts.length >= 2) {
      const docPart = parts.find(p => p.startsWith('doc_'));
      if (docPart) {
        safeId = docPart;
      } else {
        const corePart = parts.find(p => p.length > 5 && !/^[a-z]+$/i.test(p));
        if (corePart) {
          safeId = corePart;
        } else {
          safeId = parts[parts.length - 1];
        }
      }
    }
    safeId = safeId.replace(/[\\/:*?"<>|]/g, '_');
    return safeId || this.sourceId;
  }

  private async ensureStoreDir(): Promise<void> {
    const safeSourceId = this.getSafeSourceId();
    let baseDir: string;
    if (this.source === 'default' && (safeSourceId === 'default' || !safeSourceId)) {
      baseDir = path.join(app.getPath('userData'), 'vectors', this.source);
    } else {
      baseDir = path.join(app.getPath('userData'), 'vectors', this.source, safeSourceId);
    }
    await fsPromises.mkdir(baseDir, { recursive: true });
  }

  /**
   * 添加/更新单个向量。
   * 修复 SubTask 3.8：默认不立即 persist（删除原 L427 的 this.persist() 调用），
   * 改为通过 debouncePersist() 在 500ms 窗口内合并落盘。
   */
  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    // 修复 SubTask 3.10：add() 入口校验维度（原 add 已有校验，这里保留）
    this.assertDimension(vector);

    console.log(`[VecstoreBackend] Adding vector "${id}" with dimension ${vector.length}, text length: ${metadata.text?.length || 0}`);

    const item: VectorItem = {
      id,
      vector,
      metadata: {
        ...metadata,
        text: metadata.text || '',
        source: metadata.source || 'unknown',
        sourceId: metadata.sourceId || id,
        createdAt: metadata.createdAt || Date.now(),
        updatedAt: Date.now()
      }
    };

    try {
      this.store.upsert(id, new Float32Array(vector), item.metadata);

      // 同步更新 metadataCache 索引（修复 SubTask 3.7：O(1) getById）
      this.metadataCache.set(id, item.metadata);

      console.log(`[VecstoreBackend] Vector "${id}" upserted successfully. Store now has ${this.store.len()} vectors`);

      if (metadata.text) {
        this.store.index_text(id, metadata.text);
      }

      // 修复 SubTask 3.8：用 debounce 替代立即 persist
      this.scheduleDebouncedPersist();
    } catch (error) {
      console.error(`[VecstoreBackend] Failed to add vector "${id}":`, error);
      throw error;
    }
  }

  /**
   * 批量添加：末尾触发一次 persist。
   */
  async addBatch(items: VectorItem[]): Promise<void> {
    this.ensureInitialized();
    if (!this.store || items.length === 0) return;

    // 修复 SubTask 3.10：批量入口也校验维度
    for (const item of items) {
      this.assertDimension(item.vector);
    }

    console.log(`[VecstoreBackend] addBatch: processing ${items.length} items`);

    for (const item of items) {
      const vectorItem: VectorItem = {
        id: item.id,
        vector: item.vector,
        metadata: {
          ...item.metadata,
          text: item.metadata?.text || '',
          source: item.metadata?.source || 'unknown',
          sourceId: item.metadata?.sourceId || item.id,
          createdAt: item.metadata?.createdAt || Date.now(),
          updatedAt: Date.now()
        }
      };

      this.store.upsert(item.id, new Float32Array(item.vector), vectorItem.metadata);
      this.metadataCache.set(item.id, vectorItem.metadata);

      if (item.metadata?.text) {
        this.store.index_text(item.id, item.metadata.text);
      }
    }

    console.log(`[VecstoreBackend] addBatch: metadata cache now has ${this.metadataCache.size} entries`);

    // 批量插入末尾落盘一次
    await this.persistImmediate();
  }

  /**
   * 批量添加但不 persist。
   * 修复 SubTask 3.10：补齐 assertDimension 校验（原跳过）。
   */
  async addBatchNoPersist(items: VectorItem[]): Promise<void> {
    this.ensureInitialized();
    if (!this.store || items.length === 0) return;

    console.log(`[VecstoreBackend] addBatchNoPersist: processing ${items.length} items`);

    for (const item of items) {
      // 修复 SubTask 3.10：补齐维度校验
      this.assertDimension(item.vector);

      const vectorItem: VectorItem = {
        id: item.id,
        vector: item.vector,
        metadata: {
          ...item.metadata,
          text: item.metadata?.text || '',
          source: item.metadata?.source || 'unknown',
          sourceId: item.metadata?.sourceId || item.id,
          createdAt: item.metadata?.createdAt || Date.now(),
          updatedAt: Date.now()
        }
      };

      this.store.upsert(item.id, new Float32Array(item.vector), vectorItem.metadata);
      this.metadataCache.set(item.id, vectorItem.metadata);

      if (item.metadata?.text) {
        this.store.index_text(item.id, item.metadata.text);
      }
    }

    console.log(`[VecstoreBackend] addBatchNoPersist: metadata cache now has ${this.metadataCache.size} entries`);
    // 不 persist - 由调用方决定何时 persist
  }

  /**
   * 维度校验：不匹配时抛出错误。
   * 修复 SubTask 3.10：抽出为独立方法，供 add/addBatch/addBatchNoPersist 共用。
   */
  assertDimension(vector: number[]): void {
    if (vector.length === 0) {
      throw new Error(`Vector dimension mismatch: empty vector. Expected ${this.dimension}.`);
    }
    if (vector.length !== this.dimension) {
      console.error(`[VecstoreBackend] Dimension mismatch: expected ${this.dimension}, got ${vector.length}`);
      throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}. Please check your embedding model configuration or set the correct dimension in vector settings.`);
    }
  }

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!this.store) return [];

    // 维度不匹配时返回空（避免无效搜索）
    if (query.length !== this.dimension) {
      console.error(`[VecstoreBackend] search(): Dimension mismatch - query has ${query.length} dimensions but store expects ${this.dimension}. Returning empty results.`);
      return [];
    }

    const totalVectors = this.store.len();
    console.log(`[VecstoreBackend] search(): query length=${query.length}, topK=${topK}, total vectors=${totalVectors}, filter=`, filter);

    if (totalVectors === 0) {
      console.warn('[VecstoreBackend] search(): store is empty, returning empty results');
      return [];
    }

    // WASM query 返回余弦距离（升序），转换为相似度后降序
    const rawResults = this.store.query(new Float32Array(query), Math.min(totalVectors, topK * 10), null);
    console.log(`[VecstoreBackend] search(): raw query returned ${rawResults.length} results`);

    const sortedResults = [...rawResults].sort((a: any, b: any) => a.score - b.score);

    const allResults = sortedResults.map((r: any) => ({
      ...r,
      similarity: 1 - r.score,
    })).sort((a: any, b: any) => b.similarity - a.similarity);

    // 在内存中应用过滤（基于 metadataCache 索引，避免 WASM filter 不稳定）
    let filteredResults = allResults;
    if (filter) {
      filteredResults = allResults.filter(r => {
        const cachedMetadata = this.metadataCache.get(r.id);
        if (!cachedMetadata) return false;
        return Object.entries(filter).every(([key, value]) => {
          return String(cachedMetadata[key]) === String(value);
        });
      });
    }

    filteredResults.sort((a: any, b: any) => b.similarity - a.similarity);
    const topResults = filteredResults.slice(0, topK);

    return topResults.map((r: any) => {
      const cachedMetadata = this.metadataCache.get(r.id);
      const metadata = cachedMetadata || (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);

      return {
        id: r.id,
        score: r.similarity,
        metadata: metadata || {}
      };
    });
  }

  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    this.assertDimension(vector);

    // 修复 SubTask 3.7：通过 metadataCache O(1) 获取，避免全表扫
    const existingMetadata = this.metadataCache.get(id) || {};
    const updatedMetadata = metadata ? { ...existingMetadata, ...metadata, updatedAt: Date.now() } : existingMetadata;

    this.store.upsert(id, new Float32Array(vector), updatedMetadata);
    this.metadataCache.set(id, updatedMetadata);

    if (metadata?.text) {
      this.store.index_text(id, metadata.text);
    }

    // 修复 SubTask 3.8：debounce 替代立即 persist
    this.scheduleDebouncedPersist();
  }

  async remove(id: string): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    this.store.remove(id);
    this.metadataCache.delete(id);

    // 修复 SubTask 3.8：debounce 替代立即 persist
    this.scheduleDebouncedPersist();
  }

  async count(): Promise<number> {
    this.ensureInitialized();
    return this.store ? this.store.len() : 0;
  }

  /**
   * 同步获取 store 大小（IVectorBackend.size）
   */
  size(): number {
    return this.store ? this.store.len() : 0;
  }

  getMode(): VectorStoreMode {
    return this.storeMode;
  }

  async rebuildIndex(): Promise<void> {
    await this.persistImmediate();
  }

  /**
   * 立即落盘（绕过 debounce）。
   * 内部调用保证持久化时使用此方法；外部通过 persist() 调用公共入口。
   */
  private async persistImmediate(): Promise<void> {
    // 取消待执行的 debounce（避免重复落盘）
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
      this.persistDebounceTimer = null;
    }

    // 若已有 in-flight 落盘，串行等待完成后再次执行
    if (this.persistInFlight) {
      try {
        await this.persistInFlight;
      } catch {
        // 忽略前一次错误，本次继续
      }
    }

    this.persistInFlight = this.doPersist();
    try {
      await this.persistInFlight;
    } finally {
      this.persistInFlight = null;
    }
  }

  /**
   * 公共 persist 入口：立即触发落盘（取消 debounce）。
   * 外部调用方（如 DocumentProcessorService / ChatVectorizationService）需要确保数据落盘时调用。
   */
  async persist(): Promise<void> {
    await this.persistImmediate();
  }

  /**
   * 调度 debounce persist：在 PERSIST_DEBOUNCE_MS 内合并多次 add/update/remove 调用为一次落盘。
   */
  private scheduleDebouncedPersist(): void {
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
    }
    this.persistDebounceTimer = setTimeout(() => {
      this.persistDebounceTimer = null;
      this.persistImmediate().catch(err => {
        console.error(`[VecstoreBackend] Debounced persist failed:`, err);
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  private async doPersist(): Promise<void> {
    try {
      if (!this.store) {
        console.warn('[VecstoreBackend] persist() called but store is null');
        return;
      }

      const storeLen = this.store.len();
      console.log(`[VecstoreBackend] persist(): store has ${storeLen} vectors, metadata cache has ${this.metadataCache.size} entries`);

      if (storeLen === 0) {
        console.warn('[VecstoreBackend] persist() called on empty store, skipping');
        return;
      }

      const data = this.store.export_json();
      console.log(`[VecstoreBackend] export_json() returned ${data.length} bytes`);

      const storePath = this.getStoreFilePath();
      await fsPromises.writeFile(storePath, data, 'utf-8');

      const stats = await fsPromises.stat(storePath);
      console.log(`[VecstoreBackend] Vector file written: ${stats.size} bytes`);

      // 保存元数据到独立文件
      await this.saveMetadataToFile();

      console.log(`[VecstoreBackend] Persisted ${storeLen} vectors and ${this.metadataCache.size} metadata entries to disk`);
    } catch (error) {
      console.error('[VecstoreBackend] 持久化失败:', error);
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
      await fsPromises.writeFile(this.metadataFilePath, jsonStr, 'utf-8');

      console.log(`[VecstoreBackend] Metadata file written: ${this.metadataCache.size} entries, ${jsonStr.length} bytes`);
    } catch (error) {
      console.error('[VecstoreBackend] 元数据持久化失败:', error);
    }
  }

  private async loadMetadataFromFile(): Promise<void> {
    if (!this.metadataFilePath) {
      this.metadataFilePath = this.getMetadataFilePath();
    }

    try {
      if (!fs.existsSync(this.metadataFilePath)) {
        console.log(`[VecstoreBackend] No metadata file found at ${this.metadataFilePath}, starting with empty cache`);
        return;
      }

      const data = await fsPromises.readFile(this.metadataFilePath, 'utf-8');

      const metadataObj = JSON.parse(data);
      this.metadataCache.clear();

      let count = 0;
      for (const [id, metadata] of Object.entries(metadataObj)) {
        const metadataObj2 = metadata as Record<string, any>;
        this.metadataCache.set(id, metadataObj2);
        count++;
      }

      console.log(`[VecstoreBackend] Loaded ${count} metadata entries from file`);
    } catch (error) {
      console.error('[VecstoreBackend] 元数据加载失败:', error);
    }
  }

  async load(): Promise<void> {
    await this.initialize();
  }

  /**
   * 修复 SubTask 3.6：clear() 改为重建 WasmVecStore 实例 O(1)
   * 原实现：while(len>0){ query(全量); for(r of results) remove(r.id) } - O(n²)
   * 新实现：直接 new WasmVecStore(dimension) - O(1)
   */
  async clear(): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    console.log(`[VecstoreBackend] clear(): rebuilding store instance (was ${this.store.len()} vectors)`);

    // 释放旧实例
    try {
      this.store.free();
    } catch (e) {
      console.warn(`[VecstoreBackend] clear(): failed to free old store:`, e);
    }

    // 重建实例 - O(1)
    this.store = new WasmVecStore(this.dimension);

    // 清空 metadataCache 索引
    this.metadataCache.clear();

    // 持久化清空后的状态
    await this.persistImmediate();
    console.log(`[VecstoreBackend] clear(): store rebuilt, now has ${this.store.len()} vectors`);
  }

  /**
   * 修复 SubTask 3.7：getById 通过 metadataCache O(1) 查找
   * 原实现：用零向量 query 全表扫 O(n) 检查 id 是否存在
   * 新实现：直接查 metadataCache Map
   */
  async getById(id: string): Promise<VectorItem | null> {
    this.ensureInitialized();
    if (!this.store) return null;

    // O(1) 查找：通过 metadataCache 索引
    const cachedMetadata = this.metadataCache.get(id);
    if (!cachedMetadata) {
      console.warn(`[VecstoreBackend] getById("${id}"): not found in metadata cache`);
      return null;
    }

    return {
      id: id,
      vector: [],
      metadata: cachedMetadata as VectorItem['metadata']
    };
  }

  /**
   * 修复 SubTask 3.7：countByPrefix 基于 metadataCache keys 遍历
   * 原实现：用零向量 query 全表扫 O(n)
   * 新实现：直接遍历 metadataCache.keys()（仍 O(n) 但无 WASM 开销，速度快得多）
   */
  async countByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.store) return 0;

    let count = 0;
    for (const id of this.metadataCache.keys()) {
      if (id.startsWith(prefix)) count++;
    }

    console.log(`[VecstoreBackend] countByPrefix("${prefix}"): found ${count} (cache size: ${this.metadataCache.size})`);
    return count;
  }

  /**
   * 修复 SubTask 3.7：deleteByPrefix 基于 metadataCache keys 收集后批量删除
   * 原实现：用零向量 query 全表扫收集 id
   * 新实现：基于 metadataCache.keys() 收集（无 WASM 调用开销）
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.store) return 0;

    const idsToDelete: string[] = [];
    for (const id of this.metadataCache.keys()) {
      if (id.startsWith(prefix)) idsToDelete.push(id);
    }

    for (const id of idsToDelete) {
      this.store.remove(id);
      this.metadataCache.delete(id);
    }

    if (idsToDelete.length > 0) {
      await this.persistImmediate();
    }
    console.log(`[VecstoreBackend] deleteByPrefix("${prefix}"): deleted ${idsToDelete.length}`);
    return idsToDelete.length;
  }

  async destroy(): Promise<void> {
    // 销毁前先持久化（防止数据丢失）
    if (this.store && this._initialized && this.store.len() > 0) {
      console.log(`[VecstoreBackend] destroy(): persisting ${this.store.len()} vectors before shutdown...`);
      try {
        await this.persistImmediate();
      } catch (error) {
        console.error('[VecstoreBackend] destroy(): failed to persist data:', error);
      }
    }

    // 取消待执行的 debounce
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
      this.persistDebounceTimer = null;
    }

    if (this.store) {
      try {
        this.store.free();
      } catch (e) {
        console.warn(`[VecstoreBackend] destroy(): failed to free store:`, e);
      }
      this.store = null;
    }
    this._initialized = false;
    console.log('[VecstoreBackend] destroy(): WASM store destroyed');
  }

  /**
   * 销毁 WASM store 并物理删除 vecstore 文件（用于完全删除文档/世界书场景）
   */
  async destroyAndDeleteFiles(): Promise<void> {
    console.log(`[VecstoreBackend] destroyAndDeleteFiles(): destroying and deleting files for ${this.source}:${this.sourceId}`);

    if (this.store) {
      try {
        this.store.free();
      } catch (e) {
        console.warn(`[VecstoreBackend] destroyAndDeleteFiles(): failed to free store:`, e);
      }
      this.store = null;
    }
    this._initialized = false;

    // 取消待执行的 debounce
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
      this.persistDebounceTimer = null;
    }

    let deletedCount = 0;

    if (this.storeFilePath) {
      try {
        await fsPromises.unlink(this.storeFilePath);
        console.log(`[VecstoreBackend] Deleted vecstore file: ${this.storeFilePath}`);
        deletedCount++;
      } catch (err) {
        console.warn(`[VecstoreBackend] Failed to delete vecstore file: ${this.storeFilePath}`, err);
      }
    }

    if (this.metadataFilePath) {
      try {
        await fsPromises.unlink(this.metadataFilePath);
        console.log(`[VecstoreBackend] Deleted metadata file: ${this.metadataFilePath}`);
        deletedCount++;
      } catch (err) {
        console.warn(`[VecstoreBackend] Failed to delete metadata file: ${this.metadataFilePath}`, err);
      }
    }

    console.log(`[VecstoreBackend] destroyAndDeleteFiles(): deleted ${deletedCount} files`);
  }

  async reset(): Promise<void> {
    await this.destroy();

    const storePath = this.getStoreFilePath();
    if (fs.existsSync(storePath)) {
      console.log(`[VecstoreBackend] Deleting incompatible store file: ${storePath}`);
      await fsPromises.unlink(storePath);
    }

    if (this.metadataFilePath && fs.existsSync(this.metadataFilePath)) {
      console.log(`[VecstoreBackend] Deleting metadata file: ${this.metadataFilePath}`);
      await fsPromises.unlink(this.metadataFilePath);
    }

    this.metadataCache.clear();
    this.dimension = 1024;
    console.log('[VecstoreBackend] Store reset, ready for re-initialization with correct dimension');
  }
}

// 兼容性别名：原外部代码以 `VecstoreVectorStore` 名义引用本类
export const VecstoreVectorStore = VecstoreBackend;
