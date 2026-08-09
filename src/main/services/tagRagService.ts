/**
 * TagRagService — RAG 标签库核心服务
 *
 * Spec: rag-tag-library-for-ai-trait-generation / Task 5
 *
 * 职责：
 *  1. 一次性向量化：将 tagAutocompleteService.tagMap（~31.7 万 Danbooru/e621 标签）
 *     分批通过 EmbeddingService 向量化，写入 VectorStoreService（source='tag_library'）
 *  2. 语义检索：对用户描述生成 query 向量，从向量库召回 top-K 相似标签
 *  3. Prompt 构建：将召回结果格式化为「标签库参考」段落，供 characterTraitAIService 注入
 *  4. 索引指纹管理：csvHash + dimension + model 三元组比对，变更时标记 stale
 *  5. 事件监听：CSV 加载完成 / 维度变更 / 模型变更 → 自动标记 stale
 *
 * 降级保证（核心契约）：
 *  - settings.tagRag.enabled=false → searchRelevantTags / buildRagReferencePrompt 返回空
 *  - 未向量化（status=idle/stale/error）→ searchRelevantTags 返回空数组
 *  - EmbeddingService 未配置 / 向量化失败 → 不阻塞主流程，仅返回空结果
 *  - 任何异常捕获后写日志，不向调用方抛错
 *
 * 数据布局（路径收敛到 getDatabaseDir()，开发环境=项目根目录/database，生产环境=userData/database）：
 *  - 向量数据：{databaseDir}/vectors/tag_library/<csvHash>/<dimension>/vectors.db
 *    （source='tag_library'，sourceId=csvHash，多 CSV 切换互不干扰）
 *  - 元数据：{databaseDir}/tag_rag_meta.json（独立文件，避免污染 settings.json）
 *
 * 性能目标：
 *  - 单次 searchRelevantTags：< 100ms（一次 embedding + 一次 sqlite-vec KNN）
 *  - 向量化（并发优化后）：
 *    - 远程 500 条/批 × 并发 3 ≈ 20 分钟（317600 条标签，OpenAI text-embedding-3-small）
 *    - 本地 ONNX 32 条/批（顺序执行）≈ 2.5 小时
 *
 * 依赖（均为主进程单例，构造时注入或运行时 require 避免循环依赖）：
 *  - tagAutocompleteService（标签库数据源 + getAllTags）
 *  - embeddingService（向量化）
 *  - vectorStoreService（向量存储 + 检索）
 *  - vectorConfigManager（dimension 变更事件）
 *  - tagCsvEmitter（CSV 加载完成事件）
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';
import { tagAutocompleteService, tagCsvEmitter } from './tagAutocompleteService';
import { embeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { vectorConfigManager } from './VectorConfigManager';
import { tagRagProgressEmitter } from './tagRagProgressEmitter';
import { getStorageService } from './storageService';
import { getDatabaseDir } from '../utils/appPath';
// 用户自定义同义词映射表（Spec: add-multi-round-tag-audit / Task 1.4）
// validateTagsAgainstLibrary 在 L1 之前查询本表（L0），人工审核结果下次同词首轮即命中
import { userSynonymMapService } from './userSynonymMapService';
import { VectorSourceType, type VectorItem, type VectorMetadata } from '../types/vectorConfig';
import type {
  TagRagState,
  TagRagMeta,
  TagRagSearchRequest,
  TagRagSearchResultItem,
  TagRagVectorizeResult,
  TagRagClearResult,
  TagRagCancelResult,
  TagRagProgressPhase,
} from '../../shared/types/tagRag.types';

const logger = createLogger('tag-rag-service');

/** 元数据持久化文件名（写入 userData 目录） */
const META_FILENAME = 'tag_rag_meta.json';

/** 取消标志位（vectorizeAll 主循环每批开始时检查） */
let cancelRequested = false;

/** 当前状态快照（内存态，initialize 时从 meta 文件恢复） */
let currentState: TagRagState = {
  status: 'idle',
  current: 0,
  total: 0,
  failedCount: 0,
  meta: null,
};

/** 进行中的向量化 Promise（并发去重：vectorizeAll 期间再次调用直接返回该 Promise） */
let vectorizePromise: Promise<TagRagVectorizeResult> | null = null;

/** 事件监听注销函数集合（initialize 时注册，clearIndex 时注销） */
let unregisterListeners: Array<() => void> = [];

/**
 * 读取用户配置的 tagRag 设置块。
 *
 * 配置来源：storageService.getSettings().tagRag
 * 默认值：与 src/shared/settings.ts defaultSetting.tagRag 对齐
 */
function readTagRagConfig(): {
  enabled: boolean;
  topK: number;
  minScore: number;
  autoRevectorizeOnCsvChange: boolean;
  autoRevectorizeOnDimensionChange: boolean;
  batchSize: number;
  localBatchSize: number;
  /** 远程 API 并发请求数（默认 3，提高可显著加快向量化速度，受 API 速率限制） */
  concurrency: number;
  retryMaxAttempts: number;
  retryDelayMs: number;
} {
  try {
    const settings = getStorageService().getSettings();
    const cfg = settings?.tagRag || {};
    return {
      enabled: cfg.enabled ?? false,
      topK: cfg.topK ?? 40,
      minScore: cfg.minScore ?? 0.15,
      autoRevectorizeOnCsvChange: cfg.autoRevectorizeOnCsvChange ?? true,
      autoRevectorizeOnDimensionChange: cfg.autoRevectorizeOnDimensionChange ?? true,
      batchSize: cfg.batchSize ?? 500,
      localBatchSize: cfg.localBatchSize ?? 32,
      concurrency: cfg.concurrency ?? 3,
      retryMaxAttempts: cfg.retryMaxAttempts ?? 3,
      retryDelayMs: cfg.retryDelayMs ?? 1000,
    };
  } catch (err) {
    logger.warn('读取 tagRag 配置失败，使用默认值:', err instanceof Error ? err.message : String(err));
    return {
      enabled: false,
      topK: 40,
      minScore: 0.15,
      autoRevectorizeOnCsvChange: true,
      autoRevectorizeOnDimensionChange: true,
      batchSize: 500,
      localBatchSize: 32,
      concurrency: 3,
      retryMaxAttempts: 3,
      retryDelayMs: 1000,
    };
  }
}

/**
 * 读取当前 embedding 维度（从 vectorConfigManager）。
 * 用于向量化前校验 / meta 指纹记录。
 */
function getCurrentDimension(): number {
  const dim = vectorConfigManager.get('dimension');
  if (typeof dim === 'number' && dim > 0) return dim;
  // 兜底默认值（text-embedding-3-small）
  return 1536;
}

/**
 * 读取当前 embedding 模型名（远程模式取 remoteModel，本地模式取 localModel）。
 */
function getCurrentModel(): string {
  const mode = vectorConfigManager.get('embeddingMode', 'remote');
  if (mode === 'local') {
    return vectorConfigManager.get('localModel', 'local-onnx') || 'local-onnx';
  }
  return vectorConfigManager.get('remoteModel', 'text-embedding-3-small') || 'text-embedding-3-small';
}

/** 读取当前 embedding 模式（remote / local / disabled） */
function getCurrentEmbeddingMode(): string {
  return vectorConfigManager.get('embeddingMode', 'remote') || 'remote';
}

/**
 * 元数据文件路径：{databaseDir}/tag_rag_meta.json
 *
 * 路径与向量 DB 文件统一收敛到 getDatabaseDir()：
 *  - 开发环境：项目根目录/database/tag_rag_meta.json
 *  - 生产环境：userData/database/tag_rag_meta.json
 */
function getMetaFilePath(): string {
  return path.join(getDatabaseDir(), META_FILENAME);
}

/**
 * 从磁盘加载 meta（应用启动时恢复状态）。
 *
 * 状态恢复规则：
 *  - meta.status='ready' → 恢复为 'ready'（信任索引文件存在）
 *  - meta.status='error' → 恢复为 'error'
 *  - 无 meta 文件 → 保持 'idle'
 *
 * 注意：恢复后不立即校验 csvHash/dimension 是否变更（懒校验），
 *      检索时若发现维度不匹配会返回空（sqlite-vec 自动检测）。
 *      主动校验在 vectorizeAll(force=false) 调用时进行。
 */
function loadMetaFromDisk(): TagRagMeta | null {
  try {
    const metaPath = getMetaFilePath();
    if (!fs.existsSync(metaPath)) return null;
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as TagRagMeta;
    // 基础字段校验（防部分缺失的 meta 文件导致后续逻辑崩溃）
    if (!meta.csvHash || typeof meta.dimension !== 'number' || typeof meta.vectorizedCount !== 'number') {
      logger.warn('meta 文件字段缺失，忽略', JSON.stringify(meta));
      return null;
    }
    return meta;
  } catch (err) {
    logger.warn('加载 meta 文件失败:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * 持久化 meta 到磁盘（atomic write：先写 .tmp 再 rename，避免半写文件）。
 *
 * 写入前确保 database 目录存在（首次运行时 getDatabaseDir() 返回的目录可能尚未创建）。
 */
function saveMetaToDisk(meta: TagRagMeta): void {
  try {
    const metaPath = getMetaFilePath();
    const metaDir = path.dirname(metaPath);
    if (!fs.existsSync(metaDir)) {
      fs.mkdirSync(metaDir, { recursive: true });
    }
    const tmpPath = metaPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2), 'utf-8');
    fs.renameSync(tmpPath, metaPath);
  } catch (err) {
    logger.error('持久化 meta 文件失败:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 清除 meta 文件（clearIndex 时调用）。
 */
function clearMetaFile(): void {
  try {
    const metaPath = getMetaFilePath();
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  } catch (err) {
    logger.warn('清除 meta 文件失败:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 计算 CSV 文件指纹（与 tagAutocompleteService.notifyCsvLoaded 一致）。
 *
 * 指纹算法：sha256(csvPath + ':' + fileSize + ':' + mtimeMs).slice(0,16)
 * 仅用于 meta 比对，不读取文件内容（8MB 哈希耗时 ~50ms）。
 *
 * @returns csvHash，加载失败时返回空字符串
 */
function computeCsvHash(): string {
  try {
    const status = tagAutocompleteService.getLoadStatus();
    if (!status.csvPath) return '';
    const crypto = require('crypto');
    const stat = fs.statSync(status.csvPath);
    return crypto
      .createHash('sha256')
      .update(`${status.csvPath}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 16);
  } catch (err) {
    logger.warn('计算 csvHash 失败:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

/**
 * 发射进度事件（封装 emitter，统一计算 eta / percentage）。
 */
function emitProgress(
  phase: TagRagProgressPhase,
  current: number,
  total: number,
  failedCount: number,
  message?: string,
  error?: string
): void {
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  let eta: number | undefined;
  if ((phase === 'embedding' || phase === 'storing') && current > 0 && currentState.startedAt) {
    const elapsedMs = Date.now() - currentState.startedAt;
    const perItemMs = elapsedMs / current;
    eta = Math.ceil(((total - current) * perItemMs) / 1000);
  }
  tagRagProgressEmitter.emit({
    phase,
    current,
    total,
    percentage,
    eta,
    failedCount,
    message,
    error,
  });
}

/**
 * sleep 工具函数（用于重试退避）。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算状态：检查索引是否过期（CSV/维度/模型变更）。
 *
 * 触发 stale 的条件（任一满足）：
 *  1. meta.csvHash !== 当前 csvHash（CSV 文件被替换/重载）
 *  2. meta.dimension !== 当前 dimension（embedding 维度变化）
 *  3. meta.model !== 当前 model（embedding 模型变化）
 *
 * @returns 'ready' 表示索引有效，'stale' 表示需重新向量化
 */
function computeFreshness(): 'ready' | 'stale' {
  if (!currentState.meta) return 'stale';
  const meta = currentState.meta;
  const currentCsvHash = computeCsvHash();
  const currentDim = getCurrentDimension();
  const currentModel = getCurrentModel();

  if (currentCsvHash && meta.csvHash !== currentCsvHash) {
    logger.info(`索引 stale: csvHash 变更 (${meta.csvHash} → ${currentCsvHash})`);
    return 'stale';
  }
  if (meta.dimension !== currentDim) {
    logger.info(`索引 stale: dimension 变更 (${meta.dimension} → ${currentDim})`);
    return 'stale';
  }
  if (meta.model !== currentModel) {
    logger.info(`索引 stale: model 变更 (${meta.model} → ${currentModel})`);
    return 'stale';
  }
  return 'ready';
}

// ============ 公开 API ============

/**
 * 获取当前状态快照（IPC: tagRag:getStatus）。
 *
 * 调用时会懒校验索引新鲜度：
 *  - 若 meta 存在且 computeFreshness 返回 'stale'，则状态降级为 'stale'
 *  - 若 meta 不存在，状态保持 'idle'
 */
function getStatus(): TagRagState {
  // vectorizing 期间不重新计算（避免阻塞主循环）
  if (currentState.status === 'vectorizing') {
    return { ...currentState };
  }
  if (currentState.meta) {
    const freshness = computeFreshness();
    if (freshness === 'stale' && currentState.status === 'ready') {
      currentState = { ...currentState, status: 'stale' };
    }
  }
  return { ...currentState };
}

/**
 * 启动向量化（IPC: tagRag:startVectorization）。
 *
 * 并发去重：vectorizeAll 期间再次调用直接返回已有 Promise。
 *
 * 流程：
 *  1. 状态校验：若已在 vectorizing → 返回当前 Promise
 *  2. 前置检查：embedding mode !== disabled
 *  3. 加载标签库：tagAutocompleteService.ensureLoaded() → getAllTags()
 *  4. 指纹比对：若 meta 匹配且 force=false → 直接返回「已就绪」
 *  5. 清理旧索引：若存在旧 sourceId（不同 csvHash），调用 destroyAndDeleteFiles
 *  6. 分批向量化（核心循环）：
 *     - batchSize = 100（远程）/ 32（本地 ONNX）
 *     - 每批 generateBatchEmbeddings → 构造 VectorItem[] → addBatch
 *     - 失败重试 retryMaxAttempts 次（指数退避）
 *     - 每批发射 progress 事件
 *     - 每批开始检查 cancelRequested 标志位
 *  7. 最终化：写入 meta，状态转 ready / error
 *
 * @param options.force 强制重新向量化（即使索引就绪且指纹匹配）
 */
async function vectorizeAll(options?: { force?: boolean }): Promise<TagRagVectorizeResult> {
  // 并发去重
  if (vectorizePromise) {
    logger.info('vectorizeAll 已在进行中，复用现有 Promise');
    return vectorizePromise;
  }

  vectorizePromise = (async () => {
    const startTime = Date.now();
    cancelRequested = false;

    // 状态前置校验
    if (currentState.status === 'vectorizing') {
      return { success: false, vectorized: 0, failed: 0, error: '已在向量化中' };
    }

    // 前置检查：embedding mode
    const embeddingMode = getCurrentEmbeddingMode();
    if (embeddingMode === 'disabled') {
      return {
        success: false,
        vectorized: 0,
        failed: 0,
        error: 'Embedding 模式为 disabled，请在设置中配置远程 API 或本地模型',
      };
    }

    // 加载标签库（首次触发会等待 ~1-2s）
    emitProgress('starting', 0, 0, 0, '正在加载标签库...');
    try {
      await tagAutocompleteService.ensureLoaded();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('标签库加载失败:', errorMsg);
      currentState = { ...currentState, status: 'error', lastError: errorMsg };
      emitProgress('error', 0, 0, 0, undefined, `标签库加载失败: ${errorMsg}`);
      return { success: false, vectorized: 0, failed: 0, error: errorMsg };
    }

    const rawTags = tagAutocompleteService.getAllTags();
    if (rawTags.length === 0) {
      const errorMsg = '标签库为空，无法向量化';
      currentState = { ...currentState, status: 'error', lastError: errorMsg };
      emitProgress('error', 0, 0, 0, undefined, errorMsg);
      return { success: false, vectorized: 0, failed: 0, error: errorMsg };
    }

    // ⚠️ 去重：Danbooru/e621 标签库存在同名（忽略大小写）标签（不同 category 或 CSV 合并重复），
    // 同名标签会生成相同 ID `tag:${name.toLowerCase()}`，导致 vec0 UNIQUE constraint 失败。
    // 去重策略：按 lowercase name 保留 count 最高的条目（count 高 = 模型训练时见过更多次 = 更有参考价值）
    const dedupMap = new Map<string, typeof rawTags[0]>();
    let dedupSkipped = 0;
    for (const tag of rawTags) {
      const key = tag.name.toLowerCase();
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, tag);
      } else {
        dedupSkipped++;
        // 保留 count 更高的（或 category 更优先的）
        if ((tag.count || 0) > (existing.count || 0)) {
          dedupMap.set(key, tag);
        }
      }
    }
    const allTags = Array.from(dedupMap.values());
    if (dedupSkipped > 0) {
      logger.info(`标签去重: ${rawTags.length} → ${allTags.length}（移除 ${dedupSkipped} 条同名重复）`);
    }

    // 计算当前指纹
    const currentCsvHash = computeCsvHash();
    const currentDim = getCurrentDimension();
    const currentModel = getCurrentModel();

    // 指纹比对（force=false 时若匹配则跳过）
    if (!options?.force && currentState.meta) {
      const meta = currentState.meta;
      if (
        meta.csvHash === currentCsvHash &&
        meta.dimension === currentDim &&
        meta.model === currentModel &&
        meta.status === 'ready'
      ) {
        logger.info('索引指纹匹配且 force=false，跳过向量化');
        currentState = {
          ...currentState,
          status: 'ready',
          current: meta.vectorizedCount,
          total: meta.totalTags,
        };
        emitProgress('done', meta.vectorizedCount, meta.vectorizedCount, meta.failedCount, '索引已就绪（无需重新向量化）');
        return {
          success: true,
          vectorized: meta.vectorizedCount,
          failed: meta.failedCount,
          durationMs: 0,
        };
      }
    }

    // 清理旧索引（不同 csvHash 的旧数据）
    if (currentState.meta && currentState.meta.csvHash !== currentCsvHash) {
      try {
        logger.info(`清理旧索引: sourceId=${currentState.meta.csvHash}`);
        const oldBackend = vectorStoreService.getVecstoreStoreForSource(
          VectorSourceType.TAG_LIBRARY,
          currentState.meta.csvHash
        );
        await oldBackend.destroyAndDeleteFiles();
        vectorStoreService.removeStoreFromCache(VectorSourceType.TAG_LIBRARY, currentState.meta.csvHash);
      } catch (err) {
        logger.warn('清理旧索引失败（继续向量化）:', err instanceof Error ? err.message : String(err));
      }
    }

    // 进入 vectorizing 状态
    currentState = {
      status: 'vectorizing',
      current: 0,
      total: allTags.length,
      failedCount: 0,
      startedAt: startTime,
      meta: currentState.meta, // 保留旧 meta 直到完成
    };

    emitProgress('starting', 0, allTags.length, 0, `开始向量化 ${allTags.length} 条标签（dim=${currentDim}, model=${currentModel}, mode=${embeddingMode}）`);

    // 分批大小：本地 ONNX 用 localBatchSize，远程用 batchSize
    const config = readTagRagConfig();
    const batchSize = embeddingMode === 'local' ? config.localBatchSize : config.batchSize;
    // 并发数：远程模式使用配置的 concurrency（默认 3），本地 ONNX 强制 1（单线程推理，并发无益）
    const concurrency = embeddingMode === 'local' ? 1 : Math.max(1, config.concurrency);

    let vectorizedCount = 0;
    let failedCount = 0;

    // 预切分所有批次
    const totalBatches = Math.ceil(allTags.length / batchSize);
    const batches: { tags: typeof allTags; batchIndex: number }[] = [];
    for (let i = 0, bi = 1; i < allTags.length; i += batchSize, bi++) {
      batches.push({ tags: allTags.slice(i, i + batchSize), batchIndex: bi });
    }

    logger.info(
      `向量化参数: batchSize=${batchSize}, concurrency=${concurrency}, totalBatches=${totalBatches}, totalTags=${allTags.length}`
    );

    /**
     * 处理单个批次：embedding（含重试）→ 构造 VectorItem[] → 写入 DB。
     * 成功时返回写入条数，失败时返回 0（failedCount 在内部已累加）。
     *
     * 注意：vectorizedCount / failedCount 为闭包共享变量，并发场景下通过原子加减更新
     *       （JS 单线程事件循环保证数字加减不会被中断，无需锁）。
     */
    const processBatch = async (
      batchTags: typeof allTags,
      batchIndex: number
    ): Promise<void> => {
      // embedding 文本 = tag.name（Danbooru tag name 已语义化）
      const texts = batchTags.map((t) => t.name);

      // 失败重试
      let batchVectors: number[][] | null = null;
      let lastErr: string | undefined;
      for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
        if (cancelRequested) break; // 取消时停止重试
        try {
          const result = await embeddingService.generateBatchEmbeddings(texts);
          if (result.success && result.vectors && result.vectors.length > 0) {
            batchVectors = result.vectors;
            break;
          }
          lastErr = result.error || '未知 embedding 错误';
          logger.warn(`批次 ${batchIndex}/${totalBatches} 第 ${attempt} 次向量化失败: ${lastErr}`);
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          logger.warn(`批次 ${batchIndex}/${totalBatches} 第 ${attempt} 次异常: ${lastErr}`);
        }
        if (attempt < config.retryMaxAttempts) {
          await sleep(config.retryDelayMs * attempt); // 线性退避
        }
      }

      if (!batchVectors || batchVectors.length === 0) {
        // 整批失败
        failedCount += batchTags.length;
        logger.error(`批次 ${batchIndex}/${totalBatches} 全部失败（${batchTags.length} 条），跳过: ${lastErr}`);
        return;
      }

      // 构造 VectorItem[] 写入向量库
      const items: VectorItem[] = [];
      let vecIdx = 0;
      let batchFailed = 0;
      for (let j = 0; j < batchTags.length; j++) {
        const tag = batchTags[j];
        const text = texts[j];
        if (text && text.trim().length > 0 && vecIdx < batchVectors.length) {
          const vec = batchVectors[vecIdx++];
          if (vec && vec.length === currentDim) {
            const metadata: VectorMetadata = {
              text: tag.name,
              source: VectorSourceType.TAG_LIBRARY,
              sourceId: currentCsvHash,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            metadata.tagName = tag.name;
            metadata.category = tag.category;
            metadata.count = tag.count;
            metadata.aliases = tag.aliases;
            items.push({
              id: `tag:${tag.name.toLowerCase()}`,
              vector: vec,
              metadata,
            });
          } else if (vec && vec.length !== currentDim) {
            batchFailed++;
            logger.warn(
              '维度不匹配',
              `tag="${tag.name}" 期望 ${currentDim} 维，实际 ${vec.length} 维`
            );
          }
        } else if (!text || text.trim().length === 0) {
          batchFailed++;
        }
      }

      if (items.length > 0) {
        try {
          await vectorStoreService.addBatch(items);
          vectorizedCount += items.length;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`批次 ${batchIndex}/${totalBatches} 写入 DB 失败: ${errMsg}`);
          failedCount += items.length;
        }
      }
      failedCount += batchFailed;

      // 更新内存态 current + 发射进度（并发场景下可能乱序，但 current 始终单调递增）
      currentState = { ...currentState, current: vectorizedCount, failedCount };
      emitProgress(
        'embedding',
        vectorizedCount,
        allTags.length,
        failedCount,
        `已处理 ${vectorizedCount}/${allTags.length}（批次 ${batchIndex}/${totalBatches}）`
      );
    };

    // 并发池：最多 concurrency 个批次同时处理
    // 本地模式 concurrency=1 → 退化为顺序执行
    let batchPtr = 0;
    const worker = async (): Promise<void> => {
      while (batchPtr < batches.length) {
        // 取消检查
        if (cancelRequested) return;
        const current = batches[batchPtr++];
        await processBatch(current.tags, current.batchIndex);
      }
    };

    // 启动 concurrency 个 worker
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // 取消后收尾
    if (cancelRequested) {
      logger.info(`向量化被取消（已处理 ${vectorizedCount}/${allTags.length}）`);
      currentState = {
        ...currentState,
        status: 'idle',
        current: vectorizedCount,
        failedCount,
      };
      tagRagProgressEmitter.emitCancelled(vectorizedCount, allTags.length);
      return {
        success: false,
        vectorized: vectorizedCount,
        failed: failedCount,
        error: '用户取消',
      };
    }

    // 最终化
    const durationMs = Date.now() - startTime;
    const finalStatus: 'ready' | 'error' = vectorizedCount > 0 ? 'ready' : 'error';
    const newMeta: TagRagMeta = {
      csvHash: currentCsvHash,
      dimension: currentDim,
      model: currentModel,
      totalTags: allTags.length,
      vectorizedCount,
      failedCount,
      lastVectorizedAt: Date.now(),
      durationMs,
      status: finalStatus,
    };

    saveMetaToDisk(newMeta);
    currentState = {
      status: finalStatus,
      current: vectorizedCount,
      total: allTags.length,
      failedCount,
      startedAt: startTime,
      finishedAt: Date.now(),
      meta: newMeta,
    };

    if (finalStatus === 'ready') {
      tagRagProgressEmitter.emitComplete({
        vectorized: vectorizedCount,
        failed: failedCount,
        durationMs,
      });
    } else {
      tagRagProgressEmitter.emitError(`向量化完成但 0 条成功（失败 ${failedCount} 条）`);
    }

    logger.info(
      `向量化完成: 成功 ${vectorizedCount}/${allTags.length}，失败 ${failedCount}，耗时 ${Math.round(durationMs / 1000)}s`
    );

    return {
      success: finalStatus === 'ready',
      vectorized: vectorizedCount,
      failed: failedCount,
      durationMs,
    };
  })();

  try {
    return await vectorizePromise;
  } finally {
    vectorizePromise = null;
  }
}

/**
 * 取消向量化（IPC: tagRag:cancelVectorization）。
 *
 * 设置 cancelRequested 标志位，主循环每批开始时检查。
 * 取消后状态转 idle，已写入的向量保留（下次可继续）。
 */
function cancelVectorization(): TagRagCancelResult {
  if (currentState.status !== 'vectorizing') {
    return { success: false, message: '当前无进行中的向量化任务' };
  }
  cancelRequested = true;
  logger.info('收到取消向量化请求');
  return { success: true, message: '取消请求已提交，将在当前批次结束后生效' };
}

/**
 * 语义检索相关标签（IPC: tagRag:search）。
 *
 * 降级返回空数组的条件：
 *  1. settings.tagRag.enabled=false
 *  2. status !== 'ready'（idle/stale/error/vectorizing）
 *  3. query 为空
 *  4. embedding 生成失败
 *  5. 向量库检索异常
 *
 * @param request 检索请求（query / topK / minScore / categoryFilter）
 */
async function searchRelevantTags(request: TagRagSearchRequest): Promise<TagRagSearchResultItem[]> {
  try {
    const config = readTagRagConfig();
    if (!config.enabled) {
      return [];
    }

    // 状态校验（懒计算新鲜度）
    const status = getStatus();
    if (status.status !== 'ready') {
      logger.info(`检索跳过：当前状态为 ${status.status}（需先向量化）`);
      return [];
    }

    const query = (request.query ?? '').trim();
    if (!query) return [];

    // 生成 query 向量
    const embResult = await embeddingService.generateEmbedding(query);
    if (!embResult.success || !embResult.vector || embResult.vector.length === 0) {
      logger.warn('检索失败：query embedding 生成失败:', embResult.error);
      return [];
    }

    // 维度校验（与索引维度一致才有效）
    if (currentState.meta && embResult.vector.length !== currentState.meta.dimension) {
      logger.warn(
        `检索失败：query 维度 ${embResult.vector.length} 与索引维度 ${currentState.meta.dimension} 不匹配`
      );
      return [];
    }

    // 向量库检索（按 sourceType 路由到 tag_library 的 backend）
    const topK = Math.max(1, Math.min(200, request.topK ?? config.topK));
    const filter: Record<string, any> | undefined =
      request.categoryFilter && request.categoryFilter.length > 0
        ? undefined // sqlite-vec filter 不直接支持 category IN，留空；后续在内存中过滤
        : undefined;

    const searchResults = await vectorStoreService.search(embResult.vector, topK, filter, {
      sourceType: VectorSourceType.TAG_LIBRARY,
    });

    // 转换为 TagRagSearchResultItem + 应用 minScore 过滤 + 应用 categoryFilter
    const minScore = request.minScore ?? config.minScore;
    const categorySet =
      request.categoryFilter && request.categoryFilter.length > 0
        ? new Set(request.categoryFilter)
        : null;

    const items: TagRagSearchResultItem[] = [];
    for (const r of searchResults) {
      if (r.score < minScore) continue;
      const meta = r.metadata || {};
      const category = typeof meta.category === 'number' ? meta.category : -1;
      if (categorySet && !categorySet.has(category)) continue;
      items.push({
        name: meta.tagName || meta.text || r.id,
        category,
        count: typeof meta.count === 'number' ? meta.count : 0,
        aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
        score: r.score,
      });
    }

    // 已按 score 降序（sqlite-vec ORDER BY distance）；过滤后顺序保持
    return items;
  } catch (err) {
    logger.error('searchRelevantTags 异常:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * 构建 RAG 参考段落（注入到 characterTraitAIService 的 system prompt 尾部）。
 *
 * 格式参见 .trae/documents/rag-tag-library-for-ai-trait-generation.md「Prompt 注入格式」。
 *
 * @param tags 检索到的相关标签（已按 score 降序）
 * @returns 格式化的参考段落；tags 为空时返回空字符串
 */
function buildRagReferencePrompt(tags: TagRagSearchResultItem[]): string {
  if (!tags || tags.length === 0) return '';

  const tagLines = tags
    .map((t) => {
      const countStr = t.count > 0 ? ` (${t.count})` : '';
      return `- ${t.name}${countStr}`;
    })
    .join('\n');

  return `
【标签库参考】
以下是与你正在提取的角色特征语义相关的 Danbooru/e621 标签（按相似度降序，括号内为出现次数）。
请优先使用以下标签或其语义等价的下划线版本，不要凭空创造标签库以外的新标签。

相关标签（共 ${tags.length} 条）：
${tagLines}

注意事项：
1. 优先选用 count 较高的标签（模型训练时见过更多次）
2. 标签标准格式为下划线连接（如 long_hair），输出时请使用下划线格式
3. 若角色特征与所有参考标签相似度都低，按你的判断输出最接近的标签
`.trim();
}

/**
 * 清空索引（IPC: tagRag:clearIndex）。
 *
 * 删除：
 *  1. 向量库中 source='tag_library' 的所有数据文件（destroyAndDeleteFiles）
 *  2. meta 文件（tag_rag_meta.json）
 *
 * 状态转 idle。若 vectorizing 中则拒绝（先 cancel）。
 */
async function clearIndex(): Promise<TagRagClearResult> {
  try {
    if (currentState.status === 'vectorizing') {
      return { success: false, error: '向量化进行中，请先取消' };
    }

    // 删除向量数据文件
    if (currentState.meta) {
      try {
        const backend = vectorStoreService.getVecstoreStoreForSource(
          VectorSourceType.TAG_LIBRARY,
          currentState.meta.csvHash
        );
        await backend.destroyAndDeleteFiles();
        vectorStoreService.removeStoreFromCache(VectorSourceType.TAG_LIBRARY, currentState.meta.csvHash);
      } catch (err) {
        logger.warn('删除向量数据文件失败:', err instanceof Error ? err.message : String(err));
      }
    }

    // 删除 meta 文件
    clearMetaFile();

    // 重置状态
    currentState = {
      status: 'idle',
      current: 0,
      total: 0,
      failedCount: 0,
      meta: null,
    };

    logger.info('索引已清空');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('clearIndex 异常:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * 初始化（应用启动时调用一次）。
 *
 *  1. 从磁盘恢复 meta → 状态恢复为 ready/error
 *  2. 注册事件监听：
 *     - tagCsvEmitter 'tag-csv-loaded' → 若 csvHash 变更则标记 stale
 *     - vectorConfigManager.onDimensionChange → 若 autoRevectorizeOnDimensionChange 则标记 stale
 *  3. 注意：不自动触发向量化（需用户在 UI 手动点击）
 */
function initialize(): void {
  // 恢复 meta
  const meta = loadMetaFromDisk();
  if (meta) {
    currentState = {
      status: meta.status === 'error' ? 'error' : 'ready',
      current: meta.vectorizedCount,
      total: meta.totalTags,
      failedCount: meta.failedCount,
      meta,
    };
    logger.info(
      `从 meta 恢复状态: status=${currentState.status}, vectorized=${meta.vectorizedCount}/${meta.totalTags}, dim=${meta.dimension}, model=${meta.model}`
    );
  }

  // 加载用户自定义同义词映射表（Spec: add-multi-round-tag-audit / Task 1.5）
  // 必须在 validateTagsAgainstLibrary 调用前完成 load，否则 L0 查询永远 miss
  // load() 容错：文件不存在/损坏均返回空 Map，不抛异常
  try {
    const mapSize = userSynonymMapService.load().size;
    logger.info(`[RAG质检] 用户自定义同义词映射表已加载，entries=${mapSize}`);
  } catch (err) {
    logger.warn(
      '[RAG质检] userSynonymMapService.load 失败，L0 自定义映射查询将返回空:',
      err instanceof Error ? err.message : String(err)
    );
  }

  // 监听 CSV 加载完成事件
  const csvListener = (payload: { csvPath: string; csvHash: string; totalCount: number }) => {
    try {
      const config = readTagRagConfig();
      if (!config.autoRevectorizeOnCsvChange) return;
      if (!currentState.meta) return; // 未向量化，无需标记 stale
      if (currentState.meta.csvHash !== payload.csvHash) {
        logger.info(`检测到 CSV 变更: ${currentState.meta.csvHash} → ${payload.csvHash}，索引标记为 stale`);
        if (currentState.status === 'ready') {
          currentState = { ...currentState, status: 'stale' };
        }
      }
    } catch (err) {
      logger.warn('CSV 加载事件处理异常:', err instanceof Error ? err.message : String(err));
    }
  };
  tagCsvEmitter.on('tag-csv-loaded', csvListener);
  unregisterListeners.push(() => tagCsvEmitter.off('tag-csv-loaded', csvListener));

  // 监听 dimension 变更事件
  const dimUnregister = vectorConfigManager.onDimensionChange((event) => {
    try {
      const config = readTagRagConfig();
      if (!config.autoRevectorizeOnDimensionChange) return;
      if (!currentState.meta) return;
      logger.info(
        `检测到维度变更: ${event.oldDimension} → ${event.newDimension}，索引标记为 stale`
      );
      if (currentState.status === 'ready') {
        currentState = { ...currentState, status: 'stale' };
      }
    } catch (err) {
      logger.warn('维度变更事件处理异常:', err instanceof Error ? err.message : String(err));
    }
  });
  unregisterListeners.push(dimUnregister);

  logger.info('TagRagService 初始化完成');
}

/**
 * 销毁（应用退出时可选调用，注销事件监听）。
 */
function dispose(): void {
  for (const unregister of unregisterListeners) {
    try {
      unregister();
    } catch {
      // ignore
    }
  }
  unregisterListeners = [];
}

/**
 * 便捷方法：检索 + 构建 prompt 一步到位。
 *
 * 供 characterTraitAIService 调用：传入查询文本，直接返回可注入的段落字符串。
 * 任何失败均返回空字符串（不阻塞 AI 生成主流程）。
 *
 * @param queryText 查询文本（角色描述 / 自然语言指令等）
 * @param topK 检索数量（默认从配置读取）
 */
async function buildRagReferenceSection(
  queryText: string,
  topK?: number
): Promise<string> {
  const result = await buildRagReferenceWithDebug(queryText, topK);
  return result.prompt;
}

/**
 * RAG 检索 + 构建 prompt + 返回调试信息（供质检报告 UI 使用）。
 *
 * 与 `buildRagReferenceSection` 的区别：返回完整的调试上下文（enabled / status / retrievedTags），
 * 供 characterTraitAIService 在生成响应中携带 `ragDebug` 字段，渲染进程据此展示质检报告面板。
 *
 * @param queryText 查询文本
 * @param topK 检索数量
 * @returns { prompt, enabled, status, retrievedTags }
 */
async function buildRagReferenceWithDebug(
  queryText: string,
  topK?: number
): Promise<{
  prompt: string;
  enabled: boolean;
  status: string;
  retrievedTags: TagRagSearchResultItem[];
}> {
  try {
    const config = readTagRagConfig();
    if (!config.enabled) {
      logger.info('[RAG质检] RAG 未启用，跳过检索');
      return { prompt: '', enabled: false, status: 'disabled', retrievedTags: [] };
    }

    const status = getStatus();
    if (status.status !== 'ready') {
      logger.info(`[RAG质检] RAG 索引状态为 ${status.status}，跳过检索（需先向量化）`);
      return { prompt: '', enabled: true, status: status.status, retrievedTags: [] };
    }

    const tags = await searchRelevantTags({
      query: queryText,
      topK: topK ?? config.topK,
      minScore: config.minScore,
    });

    const prompt = buildRagReferencePrompt(tags);
    logger.info(
      `[RAG质检] 检索完成: 查询="${queryText.substring(0, 80)}..." → 命中 ${tags.length} 条标签, ` +
      `top3: ${tags.slice(0, 3).map((t) => `${t.name}(${t.score.toFixed(3)})`).join(', ')}`
    );

    return { prompt, enabled: true, status: 'ready', retrievedTags: tags };
  } catch (err) {
    logger.warn(
      '[RAG质检] buildRagReferenceWithDebug 异常:',
      err instanceof Error ? err.message : String(err)
    );
    return { prompt: '', enabled: true, status: 'error', retrievedTags: [] };
  }
}

/**
 * 评级词集合（非视觉 tag，Danbooru/e621 标签库不收录）。
 *
 * 这些词对 SD 模型仍有效（nsfw 控制内容尺度），但不属于「视觉特征标签」范畴，
 * 标签库不收录是正常的，无需纠错替换。质检时标记 skipReason='rating' 跳过。
 */
const RATING_TAGS = new Set([
  'nsfw', 'safe', 'questionable', 'explicit', 'sensitive',
  'rating:safe', 'rating:questionable', 'rating:explicit', 'rating:general', 'rating:sensitive',
]);

/** invalid tag 语义检索建议的最低相似度（低于此值不返回建议） */
const SUGGESTION_MIN_SCORE = 0.15;

/**
 * 颜色/修饰词前缀列表，用于 L3 颜色剥离匹配。
 *
 * 分两组：
 *  - 亮度修饰词：light/dark/pale/bright/deep/neon/pastel/vivid/dull
 *  - 基础颜色：gray/grey/black/white/brown/blonde/blond/red/blue/green/pink/purple/yellow/orange/silver/gold/cyan/magenta
 *
 * 剥离策略：从 tag 开头剥离「可选亮度修饰 + 分隔符 + 基础颜色 + 分隔符」组合，
 * 剩余部分作为核心词重新查 name 和 alias。
 * 例：`light gray drooping ears` → 核心词 `drooping ears` → 命中 drooping_ears
 */
const COLOR_BRIGHTNESS_MODIFIERS = ['light', 'dark', 'pale', 'bright', 'deep', 'neon', 'pastel', 'vivid', 'dull'];
const COLOR_BASE_NAMES = ['gray', 'grey', 'black', 'white', 'brown', 'blonde', 'blond', 'red', 'blue', 'green', 'pink', 'purple', 'yellow', 'orange', 'silver', 'gold', 'cyan', 'magenta'];

/**
 * 颜色归一化映射：标签库使用 grey / blonde 拼写，需将 gray / blond 归一化。
 *
 * 用于 `splitColorTag` 构造颜色+部位标签前对基础颜色词的拼写统一。
 */
const COLOR_NORMALIZE: Record<string, string> = {
  gray: 'grey',
  blond: 'blonde',
};

/**
 * 从 tag 开头剥离颜色/修饰词前缀，返回核心词。
 *
 * 兼容空格与下划线分隔符（AI 输出 `light gray drooping ears` 或 `light_gray_drooping_ears` 均可）。
 * 剥离顺序：可选亮度修饰词 + 分隔符 + 基础颜色 + 分隔符。
 *
 * 注：本函数为「颜色剥离」逻辑，已被 `splitColorTag` 概念覆盖（splitColorTag 同时返回
 *     颜色+部位标签与核心特征标签）。保留本函数以兼容现有测试。
 *
 * @param tag 原始 tag（可能含颜色前缀）
 * @returns 核心词；若无可剥离的颜色前缀（核心词为空或与原 tag 相同）返回空串
 */
export function stripColorModifier(tag: string): string {
  if (!tag) return '';
  const brightnessPattern = COLOR_BRIGHTNESS_MODIFIERS.join('|');
  const colorPattern = COLOR_BASE_NAMES.join('|');
  // 匹配：开头 (可选 亮度词 + 分隔符) + 基础颜色 + 分隔符；分隔符为空格或下划线（一个或多个）
  const regex = new RegExp(`^(?:(?:${brightnessPattern})[\\s_]+)?(?:${colorPattern})[\\s_]+`, 'i');
  const stripped = tag.replace(regex, '');
  // 核心词为空（tag 本身就是纯颜色词如 "black"）或与原 tag 相同（无可剥离前缀）→ 返回空串
  if (!stripped || stripped === tag) return '';
  return stripped.trim();
}

/**
 * 颜色复合 tag 拆分结果。
 *
 * - `baseColor`：归一化后的基础颜色词（如 `grey`，已应用 gray→grey、blond→blonde）
 * - `feature`：核心特征标签（下划线连接，如 `drooping_ears`）
 * - `partWord`：核心特征最后一个词（部位词，如 `ears`），用于构造颜色+部位标签
 * - `colorPartTag`：颜色+部位标签（如 `grey_ears`），与标签库 `grey_ears` 直接对齐
 */
export interface SplitColorTagResult {
  baseColor: string;
  feature: string;
  partWord: string;
  colorPartTag: string;
}

/**
 * 将颜色复合 tag 拆分为「颜色+部位标签」+「核心特征标签」的构造信息。
 *
 * 算法（验证脚本 verify-color-split.mjs 已固化到单元测试，见 tagRagService.test.ts 的 splitColorTag 用例，7/7 命中）：
 *  1. 统一为空格分隔，识别开头「可选亮度修饰词（COLOR_BRIGHTNESS_MODIFIERS）+ 基础颜色（COLOR_BASE_NAMES）」
 *  2. 颜色归一化（gray→grey、blond→blonde）；亮度词丢弃（标签库用 `grey_ears` 而非 `light_grey_ears`）
 *  3. 剩余部分 = 核心特征（`drooping ears` → `drooping_ears`）；部位词 = 核心特征最后一个词（`ears`）
 *  4. 构造颜色+部位标签：`baseColor + '_' + partWord`（`grey_ears`）
 *
 * @param tag 原始 tag，如 "light gray drooping ears"
 * @returns 拆分结果，或 `null`（无可识别颜色前缀 / 纯颜色词无特征）
 */
export function splitColorTag(tag: string): SplitColorTagResult | null {
  if (!tag) return null;
  const normalized = tag.replace(/_/g, ' ').trim();
  if (!normalized) return null;
  const words = normalized.split(/\s+/);

  let i = 0;
  // 可选亮度修饰词
  if (words.length > 0 && COLOR_BRIGHTNESS_MODIFIERS.includes(words[0].toLowerCase())) {
    i = 1;
  }
  if (i >= words.length) return null;

  // 基础颜色
  const colorWord = words[i].toLowerCase();
  if (!COLOR_BASE_NAMES.includes(colorWord)) return null;
  i++;

  // 剩余 = 核心特征
  const featureWords = words.slice(i);
  if (featureWords.length === 0) return null; // 纯颜色词（如 "black"），无可拆分特征

  const baseColor = COLOR_NORMALIZE[colorWord] || colorWord;
  const feature = featureWords.join('_'); // drooping_ears
  const partWord = featureWords[featureWords.length - 1]; // ears
  const colorPartTag = `${baseColor}_${partWord}`; // grey_ears

  return { baseColor, feature, partWord, colorPartTag };
}

/**
 * 否定性修饰词前缀列表，用于 L3b 否定性修饰词剥离（Spec: add-multi-round-tag-audit / Task 2.1）。
 *
 * 保守选择：仅收录以 `-less` 结尾、明确表示「无/不」语义的常见服饰/身体修饰词。
 * 这些词与颜色不同，是「否定性前缀」，剥离后核心词本身大概率是有效标签：
 *  - brimless cap → cap → hat（alias 命中）
 *  - sleeveless dress → dress
 *  - strapless bra → bra
 *
 * 不收录 short/open/long 等修饰词：这些词与核心词组合常常本身是独立标签
 * （short_hair / open_hoodie / long_sleeves），剥离会破坏语义。
 */
const NEGATION_MODIFIERS = [
  'brimless',
  'sleeveless',
  'strapless',
  'topless',
  'bottomless',
  'hairless',
  'wireless',
  'collarless',
];

/**
 * 从 tag 开头剥离否定性修饰词前缀，返回核心词（Spec: add-multi-round-tag-audit / Task 2.2）。
 *
 * 算法（逻辑参考 stripColorModifier，空格/下划线兼容）：
 *  1. 用正则 `^(?:修饰词)[\s_]+` 匹配开头（大小写不敏感）
 *  2. 剥离后剩余部分作为核心词
 *  3. 核心词为空（tag 本身就是修饰词，如 "brimless"）或与原 tag 相同（无可剥离前缀）→ 返回空串
 *
 * 与 stripColorModifier 的差异：
 *  - 仅剥离单个修饰词（无需亮度词+颜色词组合）
 *  - 仅在 L0-L3 全部未命中时才触发（避免误伤 short_hair/open_hoodie 等本身是标签的复合词）
 *
 * @param tag 原始 tag（如 "brimless cap" 或 "sleeveless_dress"）
 * @returns 核心词（如 "cap" / "dress"）；不可剥离返回空串
 */
export function stripNegationModifier(tag: string): string {
  if (!tag) return '';
  const pattern = NEGATION_MODIFIERS.join('|');
  // 匹配：开头 (否定性修饰词) + 分隔符（空格或下划线，一个或多个）；分隔符为空格或下划线
  const regex = new RegExp(`^(?:${pattern})[\\s_]+`, 'i');
  const stripped = tag.replace(regex, '');
  // 核心词为空（tag 本身就是修饰词如 "brimless"）或与原 tag 相同（无可剥离前缀）→ 返回空串
  if (!stripped || stripped === tag) return '';
  return stripped.trim();
}

/**
 * 标签质检：验证 AI 生成的 tag 是否在 Danbooru/e621 标签库中，
 * 并对不在库内的 tag 通过向量库语义 KNN 检索提供替换建议（suggestions）。
 *
 * 质检策略：
 *  1. 精确匹配：tag.toLowerCase() 在 tagMap 中存在（+ 空格/下划线互转兜底）
 *  2. 评级词（nsfw/safe/explicit 等）：skipReason='rating'，不纠错（对 SD 有效，非标签库范畴）
 *  3. 其余 invalid tag：调 searchRelevantTags 做语义 KNN 检索，返回 top-3 相似库内标签
 *     - 由 characterTraitAIService 根据 top1.score 决定是否自动替换（REPLACE_MIN_SCORE）
 *
 * 性能：每个 invalid 非评级词 tag 触发一次 embedding + KNN（~200ms），串行执行。
 *       典型 8 个 invalid tag ≈ 1.6s，在 AI 生成特征后做，可接受。
 *
 * @param tags AI 生成的 tag 名称数组（如 ['long_hair', 'blue eyes', 'nsfw']）
 * @returns 每条 tag 的验证结果（invalid 项含 suggestions / skipReason）
 */
async function validateTagsAgainstLibrary(tags: string[]): Promise<Array<{
  tag: string;
  isValid: boolean;
  canonicalName?: string;
  category?: number;
  count?: number;
  /** invalid tag 跳过原因：'rating'=评级词不纠错；'no_suggestion'=无相似标签 */
  skipReason?: 'rating' | 'no_suggestion';
  /** invalid tag 的语义相似替换建议（top-3，按 score 降序）；valid/rating tag 为空数组 */
  suggestions: Array<{ name: string; category: number; count: number; score: number }>;
  /**
   * 自动替换后对应的库内标签名（由调用方 characterTraitAIService 写入，非本函数设置）。
   * - valid + tag!==canonicalName → replacedBy = canonicalName（规范化）
   * - invalid + suggestion.score 达阈值 → replacedBy = suggestion.name（语义替换）
   * 前端据此展示替换关系 + 撤销按钮。
   */
  replacedBy?: string;
  /**
   * L3 颜色拆分信息（仅当 colorPartTag 与 feature 都命中标签库时设置）。
   * - `colorPartTag`：颜色+部位标签（如 `grey_ears`）
   * - `featureTag`：核心特征标签（如 `drooping_ears`）
   * 调用方 characterTraitAIService 据此将一个 trait 拆成两个；
   * 前端 RagQualityReport 据此显示「🔄 已拆分」徽标 + 拆分撤销按钮。
   */
  splitTags?: { colorPartTag: string; featureTag: string };
  /**
   * 命中轮次标识（Spec: add-multi-round-tag-audit / Task 2.4）。
   * - 'user-map'       L0 自定义映射命中（人工审核持久化结果）
   * - 'name'           L1 name 精确匹配（含空格/下划线互转）
   * - 'alias'          L2 alias 精确匹配（同义词/变体）
   * - 'color-split'    L3 颜色拆分命中（colorPartTag + feature 任一/双命中）
   * - 'negation-strip' L3b 否定性修饰词剥离命中（brimless cap → cap → hat）
   * - 'knn'            L4 语义 KNN suggestion 命中（仅当 suggestions 非空时设置）
   * 未命中（isValid=false 且无 suggestion）时为 undefined。
   * 前端 RagQualityReport 在 tooltip 中展示命中轮次，辅助用户判断匹配来源。
   *
   * 注：'ai-fallback' 值由 characterTraitAIService.applyAiFallback 写入，
   *     非 validateTagsAgainstLibrary 返回；故本类型不含 'ai-fallback'，
   *     调用方 GenerateCharacterTraitsResult.ragDebug.tagValidation 类型中扩展了该 union。
   */
  source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn';
  /**
   * AI 兜底尝试标记（Spec: add-ai-fallback-tag-audit）。
   * ⚠️ 本字段由 characterTraitAIService.applyAiFallback 写入，validateTagsAgainstLibrary 不设置。
   * - true：已对当前 tag 调过 LLM 生成候选词（无论命中与否）
   * - undefined：未触发 AI 兜底
   * 前端据此区分「未尝试」与「尝试失败」两种 invalid 状态。
   */
  aiFallbackAttempted?: boolean;
  /**
   * AI 兜底返回的候选词数组（Spec: add-ai-fallback-tag-audit）。
   * ⚠️ 本字段由 characterTraitAIService.applyAiFallback 写入，validateTagsAgainstLibrary 不设置。
   * 命中时含命中的候选词，未命中时含全部候选词供前端展示。
   */
  aiFallbackCandidates?: string[];
}>> {
  const results: Array<{
    tag: string;
    isValid: boolean;
    canonicalName?: string;
    category?: number;
    count?: number;
    skipReason?: 'rating' | 'no_suggestion';
    suggestions: Array<{ name: string; category: number; count: number; score: number }>;
    splitTags?: { colorPartTag: string; featureTag: string };
    source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn';
    aiFallbackAttempted?: boolean;
    aiFallbackCandidates?: string[];
  }> = [];

  // ⚠️ Bug 修复（2026-08-06）：app 重启后 tagMap 为空导致 0% 命中率
  // tagMap 是内存态，仅 vectorizeAll() 调用 ensureLoaded() 加载。
  // 重启后向量 DB 已持久化（RAG 检索正常），但 tagMap 为空 → validateTagsAgainstLibrary 全部返回 false。
  // 修复：验证前确保 tagAutocompleteService 已加载（ensureLoaded 幂等，已加载时立即返回）
  try {
    await tagAutocompleteService.ensureLoaded();
  } catch (err) {
    logger.warn('[RAG质检] tagAutocompleteService.ensureLoaded 失败，标签验证可能全部返回 false:', err instanceof Error ? err.message : String(err));
  }

  // 诊断日志：确认标签库加载状态
  const allTags = tagAutocompleteService.getAllTags();
  const testTags = ['1girl', 'female', 'long_hair', 'blue_eyes'];
  const testResults = testTags.map((t) => ({ tag: t, found: !!tagAutocompleteService.getTagByName(t) }));
  logger.info(
    `[RAG质检诊断] tagAutocompleteService.getAllTags().length=${allTags.length}, ` +
    `测试查找: ${testResults.map((t) => `${t.tag}=${t.found ? '✅' : '❌'}`).join(', ')}`
  );
  if (allTags.length === 0) {
    logger.warn('[RAG质检诊断] ⚠️ 标签库为空！tagAutocompleteService 未加载或 CSV 解析失败，所有标签验证将返回 false');
  } else if (allTags.length > 0) {
    const sampleNames = allTags.slice(0, 5).map((t) => t.name);
    logger.info(`[RAG质检诊断] 标签库样本（前5条）: ${sampleNames.join(', ')}`);
  }

  // 第一遍：分层精确匹配 + 评级词标记（不触发 embedding，快速完成）
  // 六层降级链（Spec: add-multi-round-tag-audit）：
  //   L0 自定义映射 → L1 name → L2 alias → L3 颜色拆分 → L3b 否定性修饰词剥离
  //   任一命中即 valid；全部未命中才走评级词判断 + needSuggestion 占位（第二遍 L4 语义 KNN）
  // source 字段标识命中轮次（'user-map'/'name'/'alias'/'color-split'/'negation-strip'/'knn'）
  const needSuggestionIndices: number[] = [];
  for (const rawTag of tags) {
    const tag = (rawTag || '').trim();
    if (!tag) continue;

    // 命中轮次标识（L0-L3b 任一命中时设置；L4 在第二遍 KNN suggestion 命中时设置）
    let matchSource: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn' | undefined;

    // L0 自定义映射查询（Spec: add-multi-round-tag-audit / Task 1.4）
    // 在 L1 之前查询用户维护的同义词映射表（user-synonym-map.json），
    // 人工审核的替换自动记录于此，下次同词首轮即命中。
    // 命中则 isValid=true, canonicalName=映射目标, source='user-map'，跳过 L1-L4。
    // 例：B-cup → medium_breasts（用户上次手动审核指定 → 持久化 → 本次 L0 命中）
    let userMapReplacement: string | null = null;
    try {
      userMapReplacement = userSynonymMapService.lookup(tag);
    } catch (err) {
      // lookup 不应抛异常，但兜底：失败时降级到 L1-L4
      logger.warn(
        `[RAG质检] userSynonymMapService.lookup("${tag}") 异常:`,
        err instanceof Error ? err.message : String(err)
      );
    }
    if (userMapReplacement) {
      // L0 命中：直接以映射目标为 canonicalName，不再查标签库（信任用户指定）
      // category/count 留空（映射目标可能是别名/复合词，不在 tagMap 中时无法获取元数据）
      // 调用方 characterTraitAIService 会用 canonicalName 替换 trait.text
      results.push({
        tag,
        isValid: true,
        canonicalName: userMapReplacement,
        suggestions: [],
        source: 'user-map',
      });
      continue;
    }

    // L1 name 精确匹配（大小写不敏感）+ 空格/下划线互转
    let found = tagAutocompleteService.getTagByName(tag);
    if (found) {
      matchSource = 'name';
    }
    if (!found && tag.includes(' ')) {
      found = tagAutocompleteService.getTagByName(tag.replace(/\s+/g, '_'));
      if (found) matchSource = 'name';
    }
    if (!found && tag.includes('_')) {
      found = tagAutocompleteService.getTagByName(tag.replace(/_/g, ' '));
      if (found) matchSource = 'name';
    }

    // L2 alias 精确匹配（同义词/变体，如 slender→slim、light_gray_hair→grey_hair）
    if (!found) {
      found = tagAutocompleteService.getTagByAlias(tag);
      if (found) matchSource = 'alias';
      if (!found && tag.includes(' ')) {
        found = tagAutocompleteService.getTagByAlias(tag.replace(/\s+/g, '_'));
        if (found) matchSource = 'alias';
      }
      if (!found && tag.includes('_')) {
        found = tagAutocompleteService.getTagByAlias(tag.replace(/_/g, ' '));
        if (found) matchSource = 'alias';
      }
    }

    // L3 颜色拆分匹配（light gray drooping ears → colorPartTag=grey_ears + feature=drooping_ears）
    // 拆分后分别查 colorPartTag 与 feature 是否命中 name/alias（含空格/下划线互转，与 L1/L2 一致）
    // - 两者都命中 → isValid=true, canonicalName=feature, splitTags={colorPartTag, feature}
    // - 仅 feature 命中 → isValid=true, canonicalName=feature（退化为原「剥离丢弃颜色」行为，无 splitTags）
    // - 仅 colorPartTag 命中 → isValid=true, canonicalName=colorPartTag（无 splitTags）
    // - 都不命中 → 走 L3b/L4
    let splitTags: { colorPartTag: string; featureTag: string } | undefined;
    if (!found) {
      const split = splitColorTag(tag);
      if (split) {
        // 查 colorPartTag 是否命中 name/alias（与 L1/L2 一致的查法，含空格/下划线互转）
        let colorFound = tagAutocompleteService.getTagByName(split.colorPartTag);
        if (!colorFound && split.colorPartTag.includes(' ')) {
          colorFound = tagAutocompleteService.getTagByName(split.colorPartTag.replace(/\s+/g, '_'));
        }
        if (!colorFound && split.colorPartTag.includes('_')) {
          colorFound = tagAutocompleteService.getTagByName(split.colorPartTag.replace(/_/g, ' '));
        }
        if (!colorFound) {
          colorFound = tagAutocompleteService.getTagByAlias(split.colorPartTag);
          if (!colorFound && split.colorPartTag.includes(' ')) {
            colorFound = tagAutocompleteService.getTagByAlias(split.colorPartTag.replace(/\s+/g, '_'));
          }
          if (!colorFound && split.colorPartTag.includes('_')) {
            colorFound = tagAutocompleteService.getTagByAlias(split.colorPartTag.replace(/_/g, ' '));
          }
        }

        // 查 feature 是否命中 name/alias（feature 已是下划线形式，仍兼容空格互转）
        let featureFound = tagAutocompleteService.getTagByName(split.feature);
        if (!featureFound && split.feature.includes(' ')) {
          featureFound = tagAutocompleteService.getTagByName(split.feature.replace(/\s+/g, '_'));
        }
        if (!featureFound && split.feature.includes('_')) {
          featureFound = tagAutocompleteService.getTagByName(split.feature.replace(/_/g, ' '));
        }
        if (!featureFound) {
          featureFound = tagAutocompleteService.getTagByAlias(split.feature);
          if (!featureFound && split.feature.includes(' ')) {
            featureFound = tagAutocompleteService.getTagByAlias(split.feature.replace(/\s+/g, '_'));
          }
          if (!featureFound && split.feature.includes('_')) {
            featureFound = tagAutocompleteService.getTagByAlias(split.feature.replace(/_/g, ' '));
          }
        }

        if (colorFound && featureFound) {
          // 两者都命中 → 颜色拆分：canonicalName 取 feature，并记录 splitTags 供调用方拆成两个 trait
          found = featureFound;
          splitTags = { colorPartTag: split.colorPartTag, featureTag: split.feature };
          matchSource = 'color-split';
        } else if (featureFound) {
          // 仅 feature 命中 → 退化为原「剥离丢弃颜色」行为
          found = featureFound;
          matchSource = 'color-split';
        } else if (colorFound) {
          // 仅 colorPartTag 命中 → 取颜色+部位标签为 canonicalName
          found = colorFound;
          matchSource = 'color-split';
        }
        // 都不命中 → found 仍为 undefined，走 L3b/L4
      }
    }

    // L3b 否定性修饰词剥离（Spec: add-multi-round-tag-audit / Task 2.3）
    // 仅当 L0-L3 全部未命中时触发（避免误伤 short_hair/open_hoodie 等本身是标签的复合词）
    // 算法：stripNegationModifier 剥离开头的否定性修饰词 → 得核心词 → 查 name/alias
    // 例：brimless cap → cap → cap 是 hat 的 alias → isValid=true, canonicalName=hat, source='negation-strip'
    if (!found) {
      const coreTag = stripNegationModifier(tag);
      if (coreTag) {
        // 查核心词是否命中 name/alias（含空格/下划线互转，与 L1/L2 一致）
        let coreFound = tagAutocompleteService.getTagByName(coreTag);
        if (!coreFound && coreTag.includes(' ')) {
          coreFound = tagAutocompleteService.getTagByName(coreTag.replace(/\s+/g, '_'));
        }
        if (!coreFound && coreTag.includes('_')) {
          coreFound = tagAutocompleteService.getTagByName(coreTag.replace(/_/g, ' '));
        }
        if (!coreFound) {
          coreFound = tagAutocompleteService.getTagByAlias(coreTag);
          if (!coreFound && coreTag.includes(' ')) {
            coreFound = tagAutocompleteService.getTagByAlias(coreTag.replace(/\s+/g, '_'));
          }
          if (!coreFound && coreTag.includes('_')) {
            coreFound = tagAutocompleteService.getTagByAlias(coreTag.replace(/_/g, ' '));
          }
        }
        if (coreFound) {
          found = coreFound;
          matchSource = 'negation-strip';
        }
      }
    }

    if (found) {
      results.push({
        tag,
        isValid: true,
        canonicalName: found.name,
        category: found.category,
        count: found.count,
        suggestions: [],
        splitTags,
        source: matchSource,
      });
    } else if (RATING_TAGS.has(tag.toLowerCase())) {
      // 评级词：对 SD 有效但非标签库范畴，跳过纠错
      results.push({ tag, isValid: false, skipReason: 'rating', suggestions: [] });
    } else {
      // 待查 suggestion（先占位，第二遍 L4 语义 KNN 填充）
      needSuggestionIndices.push(results.length);
      results.push({ tag, isValid: false, suggestions: [] });
    }
  }

  // 第二遍：对 invalid 非评级词 tag 串行查语义 suggestion
  // 串行而非并发：避免 embedding 服务（llama.cpp）瞬时并发压力
  for (const idx of needSuggestionIndices) {
    const item = results[idx];
    try {
      const suggestions = await searchRelevantTags({
        query: item.tag,
        topK: 3,
        minScore: SUGGESTION_MIN_SCORE,
      });
      item.suggestions = suggestions.map((s) => ({
        name: s.name,
        category: s.category,
        count: s.count,
        score: s.score,
      }));
      if (item.suggestions.length === 0) {
        item.skipReason = 'no_suggestion';
      } else {
        // L4 KNN suggestion 命中（Spec: add-multi-round-tag-audit / Task 2.4）
        // 注意：L4 suggestion 仅表示「找到相似标签」，调用方 characterTraitAIService
        // 仍会按 score 阈值决定是否自动替换；source='knn' 标识此 item 走过 KNN 通道
        item.source = 'knn';
      }
    } catch (err) {
      logger.warn(`[RAG质检] tag "${item.tag}" suggestion 查询失败:`, err instanceof Error ? err.message : String(err));
      item.suggestions = [];
      item.skipReason = 'no_suggestion';
    }
  }

  const validCount = results.filter((r) => r.isValid).length;
  const replaceableCount = results.filter(
    (r) => !r.isValid && !r.skipReason && r.suggestions.length > 0
  ).length;
  logger.info(
    `[RAG质检] 标签验证: ${validCount}/${results.length} 条在标签库中` +
    (results.length - validCount > 0
      ? `, 不在库内: ${results.filter((r) => !r.isValid).map((r) => r.tag).join(', ')}`
      : '') +
    (replaceableCount > 0 ? `; 可纠错建议: ${replaceableCount} 条` : '')
  );

  return results;
}

/**
 * TagRagService 单例导出。
 *
 * 采用函数集合形式而非 class 实例：
 *  - 内部状态均为模块级变量（currentState / cancelRequested 等），函数访问闭包即可
 *  - 与 tagAutocompleteService / vectorConfigManager 的导出风格一致
 *  - 便于在 characterTraitAIService 中动态 require 后直接解构使用
 */
export const tagRagService = {
  initialize,
  dispose,
  getStatus,
  vectorizeAll,
  cancelVectorization,
  searchRelevantTags,
  buildRagReferencePrompt,
  buildRagReferenceSection,
  buildRagReferenceWithDebug,
  validateTagsAgainstLibrary,
  clearIndex,
};

// 类型重导出（便于 IPC handler 单文件 import）
export type {
  TagRagState,
  TagRagStatus,
  TagRagMeta,
  TagRagSearchRequest,
  TagRagSearchResultItem,
  TagRagVectorizeResult,
  TagRagClearResult,
  TagRagCancelResult,
} from '../../shared/types/tagRag.types';
