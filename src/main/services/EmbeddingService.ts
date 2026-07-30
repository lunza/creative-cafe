import { ipcMain } from 'electron';
import { getStorageService } from './storageService';
import { VectorConfig, EmbeddingResult, BatchEmbeddingResult, ConnectionTestResult, ModeInfo, ModeSetResult } from '../types/vectorConfig';
import { embeddingWorkerService } from './EmbeddingWorkerService';
import { getEmbeddingCache, SqliteEmbeddingCachePersistence } from './EmbeddingCache';
import { initAgentBackendIfNeeded } from './agent/memory/sqliteBackend';

export class EmbeddingService {
  private vectorConfig: VectorConfig | null = null;
  /** Embedding 缓存（P1 性能修复：content-hash → vector LRU + SQLite 持久化） */
  private embeddingCache = getEmbeddingCache({ maxSize: 2000 });

  async initialize(): Promise<void> {
    try {
      const storageService = getStorageService();
      const result = storageService.getSettings();
      console.log('[EmbeddingService] Loaded settings:', JSON.stringify(result?.vector || {}, null, 2).slice(0, 300));
      if (result && result.vector) {
        this.vectorConfig = result.vector;
      }
    } catch (error) {
      console.error('[EmbeddingService] 初始化失败:', error);
    }

    // 【SubTask 10.2】接入 SQLite 持久化缓存（跨重启复用 embedding）
    // 初始化 agent 后端（幂等）；成功则注入持久化实现，失败则保持仅内存模式（降级）
    this.initPersistence().catch((err) => {
      // fire-and-forget：持久化不可用不影响 EmbeddingService 主流程
      console.warn('[EmbeddingService] Embedding cache persistence init failed (degrading to in-memory):', err instanceof Error ? err.message : err);
    });
  }

  /**
   * 初始化 Embedding 缓存的 SQLite 持久化层。
   *
   * 依赖 agent SQLite 后端（共享 WAL 连接 + embedding_cache 表）。
   * 后端不可用（如 better-sqlite3 未安装）时静默降级为仅内存缓存。
   */
  private async initPersistence(): Promise<void> {
    try {
      const backend = await initAgentBackendIfNeeded();
      if (backend) {
        this.embeddingCache.attachPersistence(new SqliteEmbeddingCachePersistence(backend));
        console.log('[EmbeddingService] Embedding cache persistence enabled (SQLite)');
      } else {
        console.warn('[EmbeddingService] Agent backend unavailable, embedding cache runs in memory-only mode');
      }
    } catch (err) {
      console.warn('[EmbeddingService] Persistence attach skipped:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * 缓存成功的 embedding 结果（内存 + SQLite 双写）。
   *
   * 仅在 result.success 且含 vector 时写入；失败结果不缓存。
   * SQLite 写失败由 EmbeddingCache 内部捕获并降级，不抛错。
   */
  private cacheEmbeddingResult(text: string, modelName: string, result: EmbeddingResult): void {
    if (!result.success || !result.vector) {
      return;
    }
    this.embeddingCache.set(text, modelName, {
      vector: result.vector,
      dimension: result.dimension ?? result.vector.length,
      model: result.model || modelName,
      mode: result.mode as 'local' | 'remote',
    });
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      await this.ensureConfigLoaded();

      const mode = this.vectorConfig?.embeddingMode || 'remote';

      // 【P1 性能修复】content-hash → vector LRU 缓存
      // 查询缓存：命中则直接返回，避免重复调用远程 API / 本地模型
      // 【重点标记·bug修复】原代码误用 localModelName（VectorConfig 无此字段，恒为 undefined），
      // 导致本地模式缓存键始终为 'local-default'，切换本地模型后命中错误向量。
      // 修正为 localModel（与 EmbeddingWorkerService 一致），保证按模型隔离缓存。
      const modelName = mode === 'local'
        ? (this.vectorConfig?.localModel || 'local-default')
        : (this.vectorConfig?.remoteModel || 'text-embedding-3-small');
      const cached = this.embeddingCache.get(text, modelName);
      if (cached) {
        return {
          success: true,
          vector: cached.vector,
          dimension: cached.dimension,
          model: cached.model,
          mode: cached.mode,
        };
      }

      if (mode === 'disabled') {
        console.log('[EmbeddingService] 向量化已禁用，跳过 generateEmbedding');
        return { success: false, error: '向量化已禁用' };
      }

      if (mode === 'local') {
        // Facade: 委托给 EmbeddingWorkerService（主进程内加载本地 ONNX 模型并生成 embedding）
        const localResult = await this.generateLocalEmbeddingFacade(text);
        const validated = this.validateDimension(localResult);
        // 【P1 性能修复】缓存成功的 embedding 结果
        this.cacheEmbeddingResult(text, modelName, validated);
        return validated;
      }

      if (!this.vectorConfig?.remoteApiUrl) {
        return {
          success: false,
          error: '未配置远程 Embedding API 地址'
        };
      }

      if (!text || text.trim().length === 0) {
        return { success: false, error: '文本为空' };
      }

      const apiUrl = this.buildEmbeddingUrl(this.vectorConfig.remoteApiUrl);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      
      const keyTransmission = this.vectorConfig.remoteApiKeyTransmission || 'header';

      if (this.vectorConfig.remoteApiKey) {
        if (keyTransmission === 'header') {
          headers['Authorization'] = `Bearer ${this.vectorConfig.remoteApiKey.trim()}`;
        } else {
          // body mode: key will be added to request body below
        }
      }

      const requestBody: Record<string, any> = {
        model: this.vectorConfig.remoteModel || 'text-embedding-3-small',
        input: text.trim()
      };
      
      if (keyTransmission === 'body' && this.vectorConfig.remoteApiKey) {
        requestBody.api_key = this.vectorConfig.remoteApiKey.trim();
      }

      const fetchStart = Date.now();
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });
      console.log(`[EmbeddingService] Remote embedding fetch done in ${Date.now() - fetchStart}ms, status=${response.status}, textLen=${text.length}`);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 请求失败 (${response.status}): ${errorText}` };
      }

      const data = await response.json();

      if (data.data && data.data[0] && data.data[0].embedding) {
        const rawVector = data.data[0].embedding;
        // 修复：统一 L2 归一化，与本地模式（normalize: true）保持一致
        // 归一化后余弦相似度计算更稳定，避免幅度差异影响排序精度
        const vector = this.normalizeVector(rawVector);
        const magnitude = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
        console.log(`[EmbeddingService] Remote vector normalized, magnitude: ${magnitude.toFixed(6)}, dim: ${vector.length}`);

        const validated = this.validateDimension({
          success: true,
          vector,
          dimension: vector.length,
          model: data.model || this.vectorConfig.remoteModel,
          mode: 'remote'
        });
        // 【P1 性能修复】缓存成功的 embedding 结果
        this.cacheEmbeddingResult(text, modelName, validated);
        return validated;
      }

      return { success: false, error: 'API 响应格式不正确' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * Facade: 将 local 模式的 embedding 生成委托给 EmbeddingWorkerService。
   * EmbeddingWorkerService 在主进程内加载本地 ONNX 模型（@xenova/transformers），
   * 不再依赖渲染进程。返回值结构与 remote 模式保持一致（EmbeddingResult）。
   */
  private async generateLocalEmbeddingFacade(text: string): Promise<EmbeddingResult> {
    try {
      if (!text || text.trim().length === 0) {
        return { success: false, error: '文本为空' };
      }

      // 确保本地模型已加载（幂等：若已加载同名模型则直接返回 success）
      const initResult = await embeddingWorkerService.initializeLocalModel();
      if (!initResult.success) {
        return {
          success: false,
          error: `本地模型加载失败: ${initResult.error || '未知错误'}`
        };
      }

      // 委托生成 embedding
      const localResult = await embeddingWorkerService.generateLocalEmbedding(text);
      return {
        success: localResult.success,
        vector: localResult.vector,
        dimension: localResult.dimension,
        model: localResult.model,
        mode: 'local',
        error: localResult.error
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '本地模型生成失败'
      };
    }
  }

  /**
   * L2 归一化：将向量缩放为单位长度（magnitude = 1）
   * 统一 remote/local 两种模式的向量幅度，保证余弦相似度计算一致性
   */
  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
    if (magnitude === 0) {
      // 零向量无法归一化，原样返回以避免 NaN
      return vector;
    }
    return vector.map(v => v / magnitude);
  }

  /**
   * 维度校验：若配置中存在 expected dimension（vectorConfig.dimension > 0），
   * 与返回的 embedding 数组长度对比，不匹配则降级为失败。
   * 仅使用已加载的 this.vectorConfig.dimension 字段，不引入新依赖。
   * 若 dimension 未配置（undefined/0），跳过校验以保持向后兼容。
   */
  private validateDimension(result: EmbeddingResult): EmbeddingResult {
    if (!result.success || !result.vector) {
      return result;
    }
    const expectedDim = this.vectorConfig?.dimension;
    if (expectedDim && expectedDim > 0 && result.vector.length !== expectedDim) {
      console.warn(
        `[EmbeddingService] 维度不匹配: 配置期望 ${expectedDim} 维, 实际返回 ${result.vector.length} 维 (model=${result.model || '?'})`
      );
      return {
        success: false,
        error: `维度不匹配: 配置期望 ${expectedDim} 维, 实际返回 ${result.vector.length} 维`
      };
    }
    return result;
  }

  async generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    try {
      await this.ensureConfigLoaded();

      const mode = this.vectorConfig?.embeddingMode || 'remote';

      if (mode === 'disabled') {
        console.log('[EmbeddingService] 向量化已禁用，跳过 generateBatchEmbeddings');
        return { success: false, error: '向量化已禁用' };
      }

      const validTexts = texts.filter(t => t && t.trim().length > 0);
      if (validTexts.length === 0) {
        return { success: false, error: '所有文本为空' };
      }

      // 本地模式：循环复用已加载的 pipeline 逐条生成（pipeline 内部有推理优化，复用模型实例）
      if (mode === 'local') {
        const initResult = await embeddingWorkerService.initializeLocalModel();
        if (!initResult.success) {
          return { success: false, error: `本地模型加载失败: ${initResult.error || '未知错误'}` };
        }
        const vectors: number[][] = [];
        for (const text of validTexts) {
          const localResult = await embeddingWorkerService.generateLocalEmbedding(text);
          if (localResult.success && localResult.vector) {
            vectors.push(localResult.vector);
          } else {
            console.warn(`[EmbeddingService] Batch local embedding failed for text: "${text.substring(0, 50)}..."`);
            vectors.push([]);
          }
        }
        const nonEmpty = vectors.filter(v => v.length > 0);
        if (nonEmpty.length === 0) {
          return { success: false, error: '所有文本本地向量化失败' };
        }
        console.log(`[EmbeddingService] Batch local embeddings: ${nonEmpty.length}/${validTexts.length} succeeded`);
        return { success: true, vectors: nonEmpty };
      }

      // 远程模式：一次性发送所有文本给 API
      if (!this.vectorConfig?.remoteApiUrl) {
        return { success: false, error: '未配置远程 Embedding API 地址' };
      }

      const apiUrl = this.buildEmbeddingUrl(this.vectorConfig.remoteApiUrl);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      
      const keyTransmission = this.vectorConfig.remoteApiKeyTransmission || 'header';

      if (this.vectorConfig.remoteApiKey) {
        if (keyTransmission === 'header') {
          headers['Authorization'] = `Bearer ${this.vectorConfig.remoteApiKey.trim()}`;
        }
      }

      const requestBody: Record<string, any> = {
        model: this.vectorConfig.remoteModel || 'text-embedding-3-small',
        input: validTexts.map(t => t.trim())
      };
      
      if (keyTransmission === 'body' && this.vectorConfig.remoteApiKey) {
        requestBody.api_key = this.vectorConfig.remoteApiKey.trim();
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 请求失败 (${response.status}): ${errorText}` };
      }

      const data = await response.json();

      if (data.data && Array.isArray(data.data)) {
        // 修复：统一 L2 归一化，与本地模式保持一致
        const vectors = data.data.map((item: any) => {
          const rawVector = item.embedding;
          if (rawVector && Array.isArray(rawVector)) {
            const vector = this.normalizeVector(rawVector);
            return vector;
          }
          return null;
        }).filter((v: number[] | null) => v !== null);
        
        if (vectors.length > 0) {
          const magnitude = Math.sqrt(vectors[0].reduce((sum: number, v: number) => sum + v * v, 0));
          console.log(`[EmbeddingService] Batch vectors normalized: ${vectors.length} vectors, first magnitude: ${magnitude.toFixed(6)}`);
        }
        
        return { success: true, vectors };
      }

      return { success: false, error: 'API 响应格式不正确' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  async testConnection(config?: Partial<VectorConfig>): Promise<ConnectionTestResult> {
    try {
      console.log('='.repeat(60));
      console.log('[EmbeddingService] ===== 远程连接测试诊断日志 =====');
      console.log('[EmbeddingService] 1. 输入参数 config:', JSON.stringify(config || {}, null, 2));
      
      if (config) {
        console.log('[EmbeddingService] 2. 使用传入的 config 覆盖当前配置');
        this.vectorConfig = config as VectorConfig;
      } else {
        console.log('[EmbeddingService] 2. 从存储加载配置');
        await this.ensureConfigLoaded();
      }

      console.log('[EmbeddingService] 3. 当前完整配置对象:', JSON.stringify(this.vectorConfig || {}, null, 2));
      console.log('[EmbeddingService] 4. 配置字段检查:');
      console.log(`   - embeddingMode: "${this.vectorConfig?.embeddingMode}" (type: ${typeof this.vectorConfig?.embeddingMode})`);
      console.log(`   - remoteApiUrl: "${this.vectorConfig?.remoteApiUrl}" (type: ${typeof this.vectorConfig?.remoteApiUrl}, length: ${this.vectorConfig?.remoteApiUrl ? this.vectorConfig.remoteApiUrl.length : 'N/A'})`);
      console.log(`   - remoteModel: "${this.vectorConfig?.remoteModel}"`);
      console.log(`   - remoteApiKey: "${this.vectorConfig?.remoteApiKey ? this.vectorConfig.remoteApiKey.slice(0, 4) + '...' : 'undefined'}"`);
      console.log(`   - remoteApiKeyTransmission: "${this.vectorConfig?.remoteApiKeyTransmission}"`);
      
      const mode = this.vectorConfig?.embeddingMode || 'remote';
      console.log(`[EmbeddingService] 5. 解析后的模式: ${mode}`);

      if (mode === 'disabled') {
        console.log('[EmbeddingService] 向量化已禁用，跳过 testConnection');
        return { success: false, mode: 'disabled', dimension: 0, error: '向量化已禁用，请先在系统设置中启用向量化' };
      }

      if (mode === 'local') {
        console.log('[EmbeddingService] 6. 模式为 local, 返回');
        return {
          success: false,
          mode: 'local',
          dimension: 0,
          error: '本地模型测试应在渲染进程中进行'
        };
      } else {
        console.log('[EmbeddingService] 6. 进入远程连接测试');
        const result = await this.testRemoteConnection();
        console.log('[EmbeddingService] 7. 测试结果:', JSON.stringify(result, null, 2).slice(0, 200));
        console.log('[EmbeddingService] ===== 测试完成 =====');
        return result;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.error('[EmbeddingService] Connection test failed:', errorMsg);
      console.error('[EmbeddingService] Error stack:', error instanceof Error ? error.stack : 'No stack');
      console.log('[EmbeddingService] ===== 测试异常 =====');
      return { success: false, mode: this.vectorConfig?.embeddingMode || 'remote', dimension: 0, error: errorMsg };
    }
  }

  private async testRemoteConnection(): Promise<ConnectionTestResult> {
    const testName = '测试远程 API 连接';
    const startTime = Date.now();

    try {
      console.log('[EmbeddingService] testRemoteConnection: 检查 remoteApiUrl');
      console.log('[EmbeddingService] testRemoteConnection: this.vectorConfig =', JSON.stringify(this.vectorConfig || {}, null, 2).slice(0, 300));
      
      if (!this.vectorConfig?.remoteApiUrl) {
        console.error('[EmbeddingService] testRemoteConnection: remoteApiUrl 为空或未定义');
        console.error('[EmbeddingService] testRemoteConnection: vectorConfig keys:', Object.keys(this.vectorConfig || {}));
        return { 
          success: false, 
          mode: 'remote', 
          dimension: 0, 
          error: '未配置远程 Embedding API 地址' 
        };
      }

      console.log('[EmbeddingService] testRemoteConnection: remoteApiUrl 有效:', this.vectorConfig.remoteApiUrl);

      // API key is optional - some services don't require it
      if (this.vectorConfig?.remoteApiKey) {
        console.log('[EmbeddingService] testRemoteConnection: 使用 API 密钥');
      } else {
        console.log('[EmbeddingService] testRemoteConnection: 未提供 API 密钥 (可选)');
      }

      console.log(`[EmbeddingService] Testing remote API: ${this.vectorConfig.remoteApiUrl}`);
      const result = await this.generateEmbedding(testName);
      const duration = Date.now() - startTime;

      if (result.success) {
        console.log(`[EmbeddingService] Remote connection test passed (${duration}ms, ${result.dimension} dimensions)`);
        return {
          success: true,
          mode: 'remote',
          dimension: result.dimension || 0,
          error: undefined,
          details: `耗时 ${duration}ms, ${result.dimension} 维向量, 模型: ${result.model}`
        };
      } else {
        return {
          success: false,
          mode: 'remote',
          dimension: 0,
          error: result.error || '生成测试嵌入失败'
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.error(`[EmbeddingService] Remote connection test failed (${duration}ms):`, errorMsg);
      return {
        success: false,
        mode: 'remote',
        dimension: 0,
        error: `远程 API 测试失败 (耗时 ${duration}ms): ${errorMsg}`
      };
    }
  }

  async getModeInfo(): Promise<ModeInfo> {
    await this.ensureConfigLoaded();
    return {
      success: true,
      mode: this.vectorConfig?.embeddingMode || 'remote',
      dimension: 0
    };
  }

  async setMode(mode: string): Promise<ModeSetResult> {
    try {
      const storageService = getStorageService();
      const result = storageService.getSettings();
      const config = (result?.vector || {}) as Partial<VectorConfig>;
      config.embeddingMode = mode as 'remote' | 'local';
      const newSettings = { ...result, vector: config };
      storageService.setSettings(newSettings);
      this.vectorConfig = config as VectorConfig;
      return { success: true, mode: config.embeddingMode };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  async listModels(config?: Partial<VectorConfig>): Promise<{ success: boolean; models: string[]; error?: string }> {
    try {
      const apiUrl = config?.remoteApiUrl || this.vectorConfig?.remoteApiUrl;
      if (!apiUrl) {
        return { success: false, models: [], error: '未配置远程 Embedding API 地址' };
      }

      const baseUrl = apiUrl.replace(/\/embeddings$/, '').replace(/\/$/, '');
      const modelsUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const apiKey = config?.remoteApiKey || this.vectorConfig?.remoteApiKey;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey.trim()}`;
      }

      console.log(`[EmbeddingService] Fetching models from: ${modelsUrl}`);
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, models: [], error: `获取模型列表失败 (${response.status}): ${errorText}` };
      }

      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        const modelIds = data.data
          .map((item: any) => item.id || item.model || item.name)
          .filter(Boolean);
        console.log(`[EmbeddingService] Found ${modelIds.length} models`);
        return { success: true, models: modelIds };
      }

      return { success: false, models: [], error: 'API 响应格式不正确' };
    } catch (error) {
      return { success: false, models: [], error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  private async ensureConfigLoaded(): Promise<void> {
    // Always reload config from storage to get latest settings
    // This ensures that UI changes (like API URL updates) are reflected immediately
    await this.initialize();
  }

  private buildEmbeddingUrl(apiUrl: string): string {
    if (apiUrl.includes('/embeddings')) return apiUrl;
    const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
    return baseUrl + 'v1/embeddings';
  }

  registerIpcHandlers(): void {
    ipcMain.handle('embedding:generate', async (_event, { text }: { text: string }) => {
      return this.generateEmbedding(text);
    });

    ipcMain.handle('embedding:generateBatch', async (_event, { texts }: { texts: string[] }) => {
      return this.generateBatchEmbeddings(texts);
    });

    ipcMain.handle('embedding:testConnection', async (_event, config?: Partial<VectorConfig>) => {
      console.log('[EmbeddingService] IPC: testConnection called with config:', JSON.stringify(config || {}, null, 2).slice(0, 500));
      return this.testConnection(config);
    });

    ipcMain.handle('embedding:setMode', async (_event, { mode }: { mode: string }) => {
      return this.setMode(mode);
    });

    ipcMain.handle('embedding:getMode', async () => {
      return this.getModeInfo();
    });

    ipcMain.handle('embedding:listModels', async (_event, config?: Partial<VectorConfig>) => {
      return this.listModels(config);
    });
  }
}

export const embeddingServiceInstance = new EmbeddingService();

// Alias for backward compatibility
export const embeddingService = embeddingServiceInstance;

export const getEmbeddingService = (): EmbeddingService => {
  const g = globalThis as unknown as { _embeddingService?: EmbeddingService };
  if (!g._embeddingService) {
    g._embeddingService = embeddingServiceInstance;
  }
  return g._embeddingService;
};
