import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 旧模型名 → 新模型名迁移映射
const MODEL_NAME_MIGRATIONS: Record<string, string> = {
  'electroglyph/Qwen3-Embedding-0.6B-ONNX-uint8': 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
};

function normalizeModelName(name: string): string {
  return MODEL_NAME_MIGRATIONS[name] || name;
}

export class EmbeddingWorkerService {
  private modelCacheDir: string = '';
  private localModelLoaded = false;
  private localPipeline: any = null;
  private vectorConfig: any = null;
  private currentModelName: string = '';

  async initialize(): Promise<void> {
    try {
      const { getStorageService } = await import('./storageService');
      const storage = getStorageService();
      const result = storage.get<any>('settings');
      if (result && result.vector) {
        this.vectorConfig = result.vector;
        if (this.vectorConfig.localModel) {
          this.vectorConfig.localModel = normalizeModelName(this.vectorConfig.localModel);
        }
      }
    } catch (e) {
      console.warn('[EmbeddingWorker] Failed to load config:', e);
    }

    this.migrateOldModelPaths();
  }

  private migrateOldModelPaths(): void {
    const cacheDir = this.getCacheDir();
    if (!fs.existsSync(cacheDir)) return;

    const entries = fs.readdirSync(cacheDir);
    for (const entry of entries) {
      if (entry.includes('_') && entry.startsWith('Xenova_')) {
        const oldPath = path.join(cacheDir, entry);
        const parts = entry.split('_');
        const newDir = path.join(cacheDir, parts[0]);
        const newSubdir = parts.slice(1).join('-');
        const newPath = path.join(newDir, newSubdir);
        
        if (!fs.existsSync(newPath) && fs.statSync(oldPath).isDirectory()) {
          try {
            fs.mkdirSync(newDir, { recursive: true });
            fs.renameSync(oldPath, newPath);
            console.log(`[EmbeddingWorker] Migrated: ${entry} -> ${parts[0]}/${newSubdir}`);
          } catch (e) {
            console.warn(`[EmbeddingWorker] Failed to migrate ${entry}:`, e);
          }
        }
      }
    }
  }

  private getCacheDir(): string {
    if (!this.modelCacheDir) {
      this.modelCacheDir = path.join(app.getPath('userData'), 'models');
    }
    return this.modelCacheDir;
  }

  getModelLocalPath(modelName: string): string {
    return path.join(this.getCacheDir(), modelName);
  }

  async ensureConfigLoaded(): Promise<void> {
    if (!this.vectorConfig) {
      await this.initialize();
    }
  }

  private validateModelFiles(modelPath: string): { valid: boolean; missing: string[] } {
    const required = ['tokenizer.json', 'tokenizer_config.json', 'config.json', 'special_tokens_map.json'];
    const missing: string[] = [];
    
    for (const file of required) {
      const fp = path.join(modelPath, file);
      if (!fs.existsSync(fp)) {
        missing.push(file);
        continue;
      }
      try {
        JSON.parse(fs.readFileSync(fp, 'utf-8'));
      } catch {
        missing.push(file + ' (corrupted)');
      }
    }
    
    const hasOnnx = fs.existsSync(path.join(modelPath, 'onnx', 'model_quantized.onnx'));
    if (!hasOnnx) {
      missing.push('onnx/model_quantized.onnx');
    }
    
    return { valid: missing.length === 0, missing };
  }

  async initializeLocalModel(modelName?: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureConfigLoaded();
      const localModelName = modelName || this.vectorConfig?.localModel || 'onnx-community/Qwen3-Embedding-0.6B-ONNX';

      const modelPath = this.getModelLocalPath(localModelName);

      if (this.localModelLoaded && this.localPipeline && this.currentModelName === localModelName) {
        if (this.validateModelFiles(modelPath).valid) {
          return { success: true };
        }
        console.log(`[EmbeddingWorker] Model ${localModelName} files changed on disk, reloading`);
        this.localPipeline = null;
        this.localModelLoaded = false;
        this.currentModelName = '';
      }

      if (this.localModelLoaded && this.currentModelName !== localModelName) {
        console.log(`[EmbeddingWorker] Switching model from ${this.currentModelName} to ${localModelName}`);
        this.localPipeline = null;
        this.localModelLoaded = false;
        this.currentModelName = '';
      }

      const fileCheck = this.validateModelFiles(modelPath);
      
      if (!fileCheck.valid) {
        console.log(`[EmbeddingWorker] Model ${localModelName} missing/corrupted files: ${fileCheck.missing.join(', ')}`);
        
        if (fs.existsSync(modelPath)) {
          fs.rmSync(modelPath, { recursive: true, force: true });
          console.log(`[EmbeddingWorker] Cleaned up invalid model directory`);
        }

        const { modelDownloadService } = await import('./ModelDownloadService');
        const downloadResult = await modelDownloadService.downloadModel(localModelName);
        
        if (!downloadResult.success) {
          return { 
            success: false, 
            error: `模型下载失败: ${downloadResult.error}。请确保网络畅通或配置 HTTPS_PROXY 代理。` 
          };
        }
        console.log(`[EmbeddingWorker] Model downloaded successfully to: ${downloadResult.localPath}`);
      }

      console.log(`[EmbeddingWorker] Loading model: ${localModelName} from ${modelPath}`);

      process.env.ORT_DISABLE_EXTERNAL_INITIALIZERS = '1';
      process.env.TRANSFORMERS_CACHE = modelPath;
      process.env.HF_HUB_DISABLE_TELEMETRY = '1';

      const { pipeline, env } = await import('@xenova/transformers');

      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = this.getCacheDir();
      env.useBrowserCache = false;

      this.localPipeline = await pipeline('feature-extraction', localModelName, {
        quantized: true,
        dtype: 'fp32',
        progress_callback: (progress: any) => {
          console.log(`[EmbeddingWorker] Model loading progress: ${progress.progress}%`);
        }
      });

      this.localModelLoaded = true;
      this.currentModelName = localModelName;
      console.log(`[EmbeddingWorker] Model loaded successfully: ${localModelName}`);
      return { success: true };
    } catch (error) {
      console.error('[EmbeddingWorker] Failed to load local model:', error);
      this.localModelLoaded = false;
      this.localPipeline = null;
      this.currentModelName = '';
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error loading local model'
      };
    }
  }

  async generateLocalEmbedding(text: string): Promise<{ success: boolean; vector?: number[]; dimension?: number; model?: string; error?: string }> {
    try {
      if (!this.localModelLoaded || !this.localPipeline) {
        return { success: false, error: '模型尚未加载，请先运行测试或确保模型文件存在' };
      }

      if (!text || text.trim().length === 0) {
        return { success: false, error: '文本为空' };
      }

      const output = await this.localPipeline(text.trim(), {
        pooling: 'mean',
        normalize: true
      });

      const vector = Array.from(output.data) as number[];
      return {
        success: true,
        vector,
        dimension: vector.length,
        model: this.vectorConfig?.localModel || 'onnx-community/Qwen3-Embedding-0.6B-ONNX'
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  async testLocalConnection(modelName?: string): Promise<{ success: boolean; mode: string; dimension: number; details?: string; error?: string }> {
    const testName = '测试本地模型连接';
    const startTime = Date.now();

    try {
      const localModelName = modelName || this.vectorConfig?.localModel || 'onnx-community/Qwen3-Embedding-0.6B-ONNX';
      const modelPath = this.getModelLocalPath(localModelName);

      const fileCheck = this.validateModelFiles(modelPath);
      
      if (!fileCheck.valid) {
        this.localPipeline = null;
        this.localModelLoaded = false;
        this.currentModelName = '';
        
        return { 
          success: false, 
          mode: 'local', 
          dimension: 0, 
          error: `本地模型文件缺失或损坏: ${fileCheck.missing.join(', ')}`,
          model: localModelName
        };
      }

      if (!this.localModelLoaded || !this.localPipeline || this.currentModelName !== localModelName) {
        const initResult = await this.initializeLocalModel(localModelName);
        if (!initResult.success) {
          return { success: false, mode: 'local', dimension: 0, error: `本地模型加载失败: ${initResult.error}`, model: localModelName };
        }
      }

      const result = await this.generateLocalEmbedding(testName);
      const duration = Date.now() - startTime;

      if (result.success) {
        return {
          success: true,
          mode: 'local',
          dimension: result.dimension || 0,
          details: `耗时 ${duration}ms, ${result.dimension} 维向量`,
          model: localModelName
        };
      } else {
        return { success: false, mode: 'local', dimension: 0, error: result.error || '生成测试嵌入失败', model: localModelName };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      return { success: false, mode: 'local', dimension: 0, error: `本地模型测试失败 (耗时 ${duration}ms): ${errorMsg}`, model: modelName };
    }
  }

  isModelDownloaded(modelName: string): { downloaded: boolean; path: string } {
    const modelPath = this.getModelLocalPath(modelName);
    if (!fs.existsSync(modelPath)) {
      return { downloaded: false, path: modelPath };
    }
    const check = this.validateModelFiles(modelPath);
    return { downloaded: check.valid, path: modelPath };
  }

  registerIpcHandlers(): void {
    ipcMain.handle('embedding:localTest', async (_event, { modelName }: { modelName?: string } = {}) => {
      return this.testLocalConnection(modelName);
    });

    ipcMain.handle('embedding:localGenerate', async (_event, { text }: { text: string }) => {
      return this.generateLocalEmbedding(text);
    });

    ipcMain.handle('embedding:localInit', async (_event, { modelName }: { modelName?: string }) => {
      return this.initializeLocalModel(modelName);
    });

    ipcMain.handle('embedding:checkModelStatus', async (_event, { modelName }: { modelName: string }) => {
      return this.isModelDownloaded(modelName);
    });
  }
}

export const embeddingWorkerService = new EmbeddingWorkerService();
