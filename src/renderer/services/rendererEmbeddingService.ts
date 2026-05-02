import { VectorConfig, EmbeddingResult, ConnectionTestResult, ModeInfo } from '../types/vectorConfig';

class RendererEmbeddingService {
  private vectorConfig: Partial<VectorConfig> | null = null;

  async loadConfig(): Promise<void> {
    try {
      const result = await window.electronAPI.storage.get('settings');
      if (result.success && result.data && result.data.vector) {
        this.vectorConfig = result.data.vector;
      }
    } catch (error) {
      console.error('[RendererEmbeddingService] 加载配置失败:', error);
    }
  }

  async ensureConfigLoaded(): Promise<void> {
    if (!this.vectorConfig) {
      await this.loadConfig();
    }
  }

  async initializeLocalModel(modelName?: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureConfigLoaded();
      const localModelName = modelName || this.vectorConfig?.localModel || 'Xenova/all-MiniLM-L6-v2';

      const isDownloaded = await window.electronAPI.model.isDownloaded(localModelName);
      
      if (!isDownloaded) {
        console.log(`[RendererEmbeddingService] Model not found locally, downloading...`);
        const downloadResult = await window.electronAPI.model.download(localModelName);
        if (!downloadResult.success) {
          return { 
            success: false, 
            error: `模型下载失败: ${downloadResult.error}` 
          };
        }
      }

      const initResult = await window.electronAPI.embedding.localInit(localModelName);
      return initResult;
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error loading local model' 
      };
    }
  }

  async generateLocalEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      const result = await window.electronAPI.embedding.localGenerate(text);
      return {
        success: result.success,
        vector: result.vector,
        dimension: result.dimension,
        model: result.model,
        error: result.error
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  async testLocalConnection(modelName?: string): Promise<ConnectionTestResult> {
    try {
      const result = await window.electronAPI.embedding.localTest({ modelName });
      return {
        success: result.success,
        mode: result.mode,
        dimension: result.dimension,
        details: result.details,
        model: result.model,
        error: result.error
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      return {
        success: false,
        mode: 'local',
        dimension: 0,
        error: errorMsg
      };
    }
  }

  async getMode(): Promise<ModeInfo> {
    await this.ensureConfigLoaded();
    return {
      success: true,
      mode: this.vectorConfig?.embeddingMode || 'remote',
      dimension: 0
    };
  }

  async setMode(mode: 'remote' | 'local'): Promise<{ success: boolean; mode?: string; error?: string }> {
    try {
      await this.ensureConfigLoaded();
      
      const result = await window.electronAPI.storage.get('settings');
      const settings = result.success ? result.data : {};
      const config = (settings?.vector || {}) as Partial<VectorConfig>;
      config.embeddingMode = mode;
      const newSettings = { ...settings, vector: config };
      
      await window.electronAPI.storage.set({ key: 'settings', value: newSettings });
      this.vectorConfig = config;
      
      return { success: true, mode: config.embeddingMode };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  async checkModelDownloaded(modelName: string): Promise<{ downloaded: boolean; path: string }> {
    return window.electronAPI.embedding.checkModelStatus(modelName);
  }

  async downloadModel(
    modelName: string, 
    onProgress?: (progress: number, status: string) => void
  ): Promise<{ success: boolean; localPath: string; error?: string }> {
    let progressListener: ((event: any, data: any) => void) | null = null;
    
    if (onProgress) {
      progressListener = (_event: any, data: any) => {
        if (data.modelName === modelName) {
          onProgress(data.progress, data.status);
        }
      };
      window.electronAPI.on('model:downloadProgress', progressListener);
    }

    try {
      const result = await window.electronAPI.model.download(modelName);
      return result;
    } catch (error) {
      return { 
        success: false, 
        localPath: '', 
        error: error instanceof Error ? error.message : '下载失败' 
      };
    } finally {
      if (progressListener) {
        window.electronAPI.off('model:downloadProgress', progressListener);
      }
    }
  }
}

export const rendererEmbeddingService = new RendererEmbeddingService();
