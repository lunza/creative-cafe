/**
 * 向量配置管理器
 * 专门管理向量配置参数，与向量数据完全解耦
 *
 * 三层抽象架构（Task 3 - SubTask 3.11）：
 *   模型切换导致 dimension 变化时，通过 EventEmitter 触发
 *   VECTOR_DIMENSION_CHANGE_EVENT 事件，所有 VecstoreBackend 实例监听
 *   并 invalidate（重建实例以匹配新维度）。
 *
 * 使用现有的 eventemitter3 依赖（package.json 已声明）。
 */

import { EventEmitter } from 'eventemitter3';
import { getStorageService } from './storageService';
import { VectorConfig, EmbeddingMode } from '../types/vectorConfig';
import { VECTOR_DIMENSION_CHANGE_EVENT, DimensionChangeEvent } from './vector/IVectorBackend';

// 合法配置字段白名单
const ALLOWED_VECTOR_CONFIG_FIELDS: (keyof VectorConfig)[] = [
  'embeddingMode',
  'remoteModel',
  'remoteApiUrl',
  'remoteApiKey',
  'localModel',
  'cacheEnabled',
  'cacheL1Size',
  'cacheL1TTL',
  'cacheL2TTL',
  'defaultTopK',
  'minSimilarityScore',
  'contextWindowTokens',
  'autoVectorizeWorldBook',
  'autoVectorizeKnowledge',
  'dimension',
];

// 禁止的数据字段（如果出现在配置中应被移除）
const FORBIDDEN_DATA_FIELDS = [
  'vectors', 'vectorData', 'embeddings', 'items', 'records',
  'vectorArray', 'vectors_data', 'data', 'entries'
];

// 配置大小阈值（10KB）
const MAX_CONFIG_SIZE_BYTES = 10000;

/**
 * 维度变更事件 emitter（SubTask 3.11）
 *
 * 使用方式：
 *   vectorConfigManager.onDimensionChange((event) => { ... })
 *   vectorConfigManager.emitDimensionChange(oldDim, newDim)
 */
export const vectorDimensionEmitter = new EventEmitter();

export class VectorConfigManager {
  private cachedConfig: Partial<VectorConfig> | null = null;
  private lastLoadTime: number = 0;
  private cacheTTL: number = 5000; // 5秒缓存

  /**
   * 监听 dimension 变更事件（SubTask 3.11）
   * @param listener 回调函数，接收 { oldDimension, newDimension, source?, sourceId? }
   * @returns 取消监听函数
   */
  onDimensionChange(listener: (event: DimensionChangeEvent) => void): () => void {
    vectorDimensionEmitter.on(VECTOR_DIMENSION_CHANGE_EVENT, listener);
    return () => {
      vectorDimensionEmitter.off(VECTOR_DIMENSION_CHANGE_EVENT, listener);
    };
  }

  /**
   * 触发 dimension 变更事件（SubTask 3.11）
   *
   * 由 saveVectorConfig 在检测到 dimension 变化时调用，
   * 由 VectorStoreService 在初始化时监听并转发给 Repository / Backend。
   */
  emitDimensionChange(oldDimension: number, newDimension: number, source?: string, sourceId?: string): void {
    const event: DimensionChangeEvent = { oldDimension, newDimension, source, sourceId };
    console.log(`[VectorConfigManager] Emitting ${VECTOR_DIMENSION_CHANGE_EVENT}: ${oldDimension} -> ${newDimension}`);
    vectorDimensionEmitter.emit(VECTOR_DIMENSION_CHANGE_EVENT, event);
  }

  /**
   * 加载向量配置（带缓存）
   */
  loadVectorConfig(forceRefresh = false): Partial<VectorConfig> {
    const now = Date.now();
    
    // 使用缓存
    if (!forceRefresh && this.cachedConfig && (now - this.lastLoadTime) < this.cacheTTL) {
      return this.cachedConfig;
    }

    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      if (settings && settings.vector) {
        const rawConfig = settings.vector;
        this.cachedConfig = this.sanitizeConfig(rawConfig);
        this.lastLoadTime = now;
        return this.cachedConfig;
      }

      this.cachedConfig = {};
      this.lastLoadTime = now;
      return {};
    } catch (error) {
      console.error('[VectorConfigManager] 加载配置失败:', error);
      return {};
    }
  }

  /**
   * 保存向量配置
   *
   * SubTask 3.11：检测到 dimension 变化时触发 VECTOR_DIMENSION_CHANGE_EVENT 事件，
   * 由 VectorStoreService 监听并转发给 Repository / Backend（重建实例以匹配新维度）。
   */
  saveVectorConfig(config: Partial<VectorConfig>): { success: boolean; error?: string } {
    try {
      // 验证并清理配置
      const cleanedConfig = this.sanitizeConfig(config);

      // 验证配置大小
      const configSize = JSON.stringify(cleanedConfig).length;
      if (configSize > MAX_CONFIG_SIZE_BYTES) {
        return {
          success: false,
          error: `向量配置过大 (${configSize} bytes)，可能包含不应存储的数据`
        };
      }

      // 读取当前设置，记录旧 dimension（SubTask 3.11）
      const storageService = getStorageService();
      const settings = storageService.getSettings() || {};
      const oldDimension = settings?.vector?.dimension;

      // 更新向量配置
      settings.vector = cleanedConfig;

      // 保存设置
      storageService.setSettings(settings);

      // 更新缓存
      this.cachedConfig = cleanedConfig;
      this.lastLoadTime = Date.now();

      // SubTask 3.11：dimension 变化时触发事件，通知所有 backend 重建
      const newDimension = cleanedConfig.dimension;
      if (typeof oldDimension === 'number' && typeof newDimension === 'number' && oldDimension !== newDimension) {
        this.emitDimensionChange(oldDimension, newDimension);
      }

      console.log(`[VectorConfigManager] 配置保存成功，大小: ${configSize} bytes`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.error('[VectorConfigManager] 保存配置失败:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 获取特定配置项
   */
  get<K extends keyof VectorConfig>(key: K, defaultValue?: VectorConfig[K]): VectorConfig[K] | undefined {
    const config = this.loadVectorConfig();
    return (config[key] !== undefined ? config[key] : defaultValue) as VectorConfig[K] | undefined;
  }

  /**
   * 设置特定配置项
   */
  set<K extends keyof VectorConfig>(key: K, value: VectorConfig[K]): { success: boolean; error?: string } {
    const config = this.loadVectorConfig();
    config[key] = value;
    return this.saveVectorConfig(config);
  }

  /**
   * 验证配置合法性
   */
  validateConfig(config: Partial<VectorConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查 embeddingMode
    if (config.embeddingMode && !['remote', 'local'].includes(config.embeddingMode)) {
      errors.push(`无效的 embeddingMode: ${config.embeddingMode}`);
    }

    // 检查远程 API 配置
    if (config.embeddingMode === 'remote') {
      if (!config.remoteApiUrl) {
        errors.push('远程模式下必须配置 remoteApiUrl');
      }
      if (!config.remoteApiKey) {
        errors.push('远程模式下必须配置 remoteApiKey');
      }
    }

    // 检查数值范围
    if (config.defaultTopK !== undefined && (config.defaultTopK < 1 || config.defaultTopK > 100)) {
      errors.push('defaultTopK 必须在 1-100 之间');
    }

    if (config.minSimilarityScore !== undefined && (config.minSimilarityScore < 0 || config.minSimilarityScore > 1)) {
      errors.push('minSimilarityScore 必须在 0-1 之间');
    }

    if (config.cacheL1Size !== undefined && config.cacheL1Size < 0) {
      errors.push('cacheL1Size 不能为负数');
    }

    // 检查是否包含禁止的数据字段
    for (const field of FORBIDDEN_DATA_FIELDS) {
      if (field in config) {
        errors.push(`配置中包含禁止的数据字段: ${field}`);
      }
    }

    // 检查配置大小
    const configSize = JSON.stringify(config).length;
    if (configSize > MAX_CONFIG_SIZE_BYTES) {
      errors.push(`配置过大 (${configSize} bytes)，可能包含向量数据`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 清理配置，移除非法字段和数据字段
   */
  private sanitizeConfig(config: any): Partial<VectorConfig> {
    if (!config || typeof config !== 'object') {
      return {};
    }

    const cleaned: Partial<VectorConfig> = {};

    // 仅保留白名单字段
    for (const field of ALLOWED_VECTOR_CONFIG_FIELDS) {
      if (field in config) {
        cleaned[field] = config[field];
      }
    }

    // 移除禁止的数据字段
    for (const field of FORBIDDEN_DATA_FIELDS) {
      if (field in cleaned) {
        console.warn(`[VectorConfigManager] 移除禁止字段: ${field}`);
        delete cleaned[field as keyof Partial<VectorConfig>];
      }
    }

    return cleaned;
  }

  /**
   * 获取配置统计信息
   */
  getConfigStats(): {
    size: number;
    fields: string[];
    hasForbiddenFields: boolean;
    embeddingMode: EmbeddingMode | undefined;
  } {
    const config = this.loadVectorConfig();
    const configStr = JSON.stringify(config);
    
    return {
      size: configStr.length,
      fields: Object.keys(config),
      hasForbiddenFields: FORBIDDEN_DATA_FIELDS.some(f => f in config),
      embeddingMode: config.embeddingMode,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedConfig = null;
    this.lastLoadTime = 0;
  }
}

export const vectorConfigManager = new VectorConfigManager();
