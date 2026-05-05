import { ipcMain } from 'electron';
import { getStorageService } from './storageService';
import { VectorConfig, EmbeddingResult, BatchEmbeddingResult, ConnectionTestResult, ModeInfo, ModeSetResult } from '../types/vectorConfig';
import { normalizeVector } from '../utils/vectorMath';

export class EmbeddingService {
  private vectorConfig: VectorConfig | null = null;

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
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      await this.ensureConfigLoaded();

      const mode = this.vectorConfig?.embeddingMode || 'remote';

      if (mode === 'local') {
        return { success: false, error: '本地模型加载应在渲染进程中进行' };
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

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 请求失败 (${response.status}): ${errorText}` };
      }

      const data = await response.json();

      if (data.data && data.data[0] && data.data[0].embedding) {
        const vector = data.data[0].embedding;
        
        // 注意：旧数据（vecstore.json 中已有向量）未归一化（magnitude ≈ 15）
        // 为保持兼容性，查询向量也不做归一化
        // WASM 的余弦相似度计算会自动处理向量幅度差异
        console.log(`[EmbeddingService] Vector magnitude (not normalized): ${Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0)).toFixed(6)}`);
        
        return {
          success: true,
          vector,
          dimension: vector.length,
          model: data.model || this.vectorConfig.remoteModel,
          mode: 'remote'
        };
      }

      return { success: false, error: 'API 响应格式不正确' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    try {
      await this.ensureConfigLoaded();

      if (!this.vectorConfig?.remoteApiUrl) {
        return { success: false, error: '未配置远程 Embedding API 地址' };
      }

      const validTexts = texts.filter(t => t && t.trim().length > 0);
      if (validTexts.length === 0) {
        return { success: false, error: '所有文本为空' };
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
        // 注意：旧数据（vecstore.json 中已有向量）未归一化（magnitude ≈ 15）
        // 为保持兼容性，查询向量也不做归一化
        const vectors = data.data.map((item: any) => {
          const vector = item.embedding;
          if (vector && Array.isArray(vector)) {
            // 诊断：记录向量幅度
            const magnitude = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
            console.log(`[EmbeddingService] Batch vector magnitude: ${magnitude.toFixed(6)} (not normalized)`);
            return vector;
          }
          return null;
        }).filter((v: number[] | null) => v !== null);
        
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
      if (config) {
        console.log('[EmbeddingService] IPC: Setting config from IPC');
        this.vectorConfig = config as VectorConfig;
      }
      return this.testConnection();
    });

    ipcMain.handle('embedding:setMode', async (_event, { mode }: { mode: string }) => {
      return this.setMode(mode);
    });

    ipcMain.handle('embedding:getMode', async () => {
      return this.getModeInfo();
    });
  }
}

export const embeddingServiceInstance = new EmbeddingService();

// Alias for backward compatibility
export const embeddingService = embeddingServiceInstance;

export const getEmbeddingService = (): EmbeddingService => {
  if (!global._embeddingService) {
    global._embeddingService = embeddingServiceInstance;
  }
  return global._embeddingService;
};
