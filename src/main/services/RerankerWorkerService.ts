import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getProjectRoot } from '../utils/appPath';
import { validateModelFiles, ModelFileValidationResult } from './modelFileValidator';

/**
 * 重排序模型 GGUF 仓库名 → 预期 GGUF 文件名映射。
 *
 * Qwen3-Reranker 的 GGUF 由社区转换（Voodisss 仓库），文件名与仓库名的推导规则
 * 不同于 Embedding 模型，需显式映射。
 * 优先下载 Q4_K_M 量化版本（最佳性价比：质量无损失，体积仅 Q8_0 的 ~58%）。
 */
const RERANKER_GGUF_FILES: Record<string, string> = {
  'Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp': 'Qwen3-Reranker-0.6B-Q4_K_M.gguf',
  'Voodisss/Qwen3-Reranker-4B-GGUF-llama_cpp': 'Qwen3-Reranker-4B-Q4_K_M.gguf',
  'Voodisss/Qwen3-Reranker-8B-GGUF-llama_cpp': 'Qwen3-Reranker-8B-Q4_K_M.gguf',
};

/** 默认重排序模型 */
const DEFAULT_RERANKER_MODEL = 'Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp';

/** 重排序结果项 */
export interface RerankResultItem {
  /** 原始索引 */
  index: number;
  /** 相关性分数 (0-1，越高越相关) */
  score: number;
  /** 文档内容 */
  document: string;
}

export class RerankerWorkerService {
  private modelCacheDir: string = '';
  private rerankerLoaded = false;
  private rankingContext: any = null;
  private vectorConfig: any = null;
  private currentModelName: string = '';

  /** 获取重排序模型的 GGUF 文件名 */
  static getGgufFileName(modelName: string): string {
    return RERANKER_GGUF_FILES[modelName] || (() => {
      const baseName = modelName.split('/').pop() || modelName;
      const nameWithoutSuffix = baseName.replace(/-GGUF.*$/i, '');
      return `${nameWithoutSuffix}-Q4_K_M.gguf`;
    })();
  }

  async initialize(): Promise<void> {
    try {
      const { getStorageService } = await import('./storageService');
      const storage = getStorageService();
      const result = storage.get<any>('settings');
      if (result && result.vector) {
        this.vectorConfig = result.vector;
      }
    } catch (e) {
      console.warn('[RerankerWorker] Failed to load config:', e);
    }
  }

  private cudaPathConfigured = false;
  private setupCudaRuntimePath(): void {
    if (this.cudaPathConfigured || process.platform !== 'win32') return;

    const projectRoot = getProjectRoot();
    const cudaBinDir = path.join(
      projectRoot, 'node_modules', '@node-llama-cpp', 'win-x64-cuda', 'bins', 'win-x64-cuda'
    );

    const currentPath = process.env.PATH || '';
    const pathsToAdd: string[] = [];

    if (fs.existsSync(path.join(cudaBinDir, 'ggml-cuda.dll')) &&
        !currentPath.toLowerCase().includes(cudaBinDir.toLowerCase())) {
      pathsToAdd.push(cudaBinDir);
    }

    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    if (homeDir) {
      const pipCudaDir = path.join(
        homeDir, 'AppData', 'Local', 'Programs', 'Python',
        'Python312', 'Lib', 'site-packages', 'nvidia', 'cu13', 'bin', 'x86_64'
      );
      if (fs.existsSync(path.join(pipCudaDir, 'cublas64_13.dll')) &&
          !currentPath.toLowerCase().includes(pipCudaDir.toLowerCase())) {
        pathsToAdd.push(pipCudaDir);
      }
    }

    if (pathsToAdd.length > 0) {
      process.env.PATH = pathsToAdd.join(';') + ';' + currentPath;
      console.log(`[RerankerWorker] Added CUDA runtime directories to PATH: ${pathsToAdd.join('; ')}`);
    }

    this.cudaPathConfigured = true;
  }

  private getCacheDir(): string {
    if (!this.modelCacheDir) {
      this.modelCacheDir = path.join(getProjectRoot(), 'models');
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

  private validateModelFiles(modelPath: string): ModelFileValidationResult {
    return validateModelFiles(modelPath);
  }

  private async disposeRerankerContext(): Promise<void> {
    if (this.rankingContext) {
      try {
        await this.rankingContext.dispose();
      } catch (e) {
        console.warn('[RerankerWorker] Failed to dispose ranking context:', e);
      }
      this.rankingContext = null;
    }
  }

  async initializeRerankerModel(modelName?: string): Promise<{ success: boolean; error?: string }> {
    const rerankerModelName = modelName || this.vectorConfig?.rerankerModel || DEFAULT_RERANKER_MODEL;

    try {
      await this.ensureConfigLoaded();

      const modelPath = this.getModelLocalPath(rerankerModelName);

      // 已加载同一模型且文件完整，直接返回
      if (this.rerankerLoaded && this.rankingContext && this.currentModelName === rerankerModelName) {
        if (this.validateModelFiles(modelPath).valid) {
          return { success: true };
        }
        console.log(`[RerankerWorker] Model ${rerankerModelName} files changed on disk, reloading`);
        await this.disposeRerankerContext();
        this.rerankerLoaded = false;
        this.currentModelName = '';
      }

      // 切换模型时释放旧资源
      if (this.rerankerLoaded && this.currentModelName !== rerankerModelName) {
        console.log(`[RerankerWorker] Switching model from ${this.currentModelName} to ${rerankerModelName}`);
        await this.disposeRerankerContext();
        this.rerankerLoaded = false;
        this.currentModelName = '';
      }

      // 校验文件
      const fileCheck = this.validateModelFiles(modelPath);
      if (!fileCheck.valid) {
        return {
          success: false,
          error: `重排序模型文件缺失或损坏: ${fileCheck.missing.join(', ')}。\n请先下载模型: ${rerankerModelName}`
        };
      }

      const ggufFilePath = path.join(modelPath, fileCheck.ggufFile!);
      console.log(`[RerankerWorker] Loading reranker model: ${rerankerModelName} from ${ggufFilePath}`);

      // 使用 node-llama-cpp 加载模型（与 EmbeddingWorkerService 共享 CUDA 路径配置）
      this.setupCudaRuntimePath();
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath: ggufFilePath });

      // 检查模型是否支持排序（reranker 模型需含 cls.weight 张量）
      if (model.fileInsights && !model.fileInsights.supportsRanking) {
        await model.dispose();
        return {
          success: false,
          error: `模型不支持排序: ${rerankerModelName}\n请确保使用的是 reranker 专用模型（如 Qwen3-Reranker），而非 embedding 模型。`
        };
      }

      // 创建排序上下文（pooling=rank）
      this.rankingContext = await model.createRankingContext({
        contextSize: 'auto',
      });

      this.rerankerLoaded = true;
      this.currentModelName = rerankerModelName;
      console.log(`[RerankerWorker] Reranker model loaded successfully: ${rerankerModelName}`);
      return { success: true };
    } catch (error) {
      console.error('[RerankerWorker] Failed to load reranker model:', error);
      await this.disposeRerankerContext();
      this.rerankerLoaded = false;
      this.currentModelName = '';
      return {
        success: false,
        error: this.formatModelLoadError(error, rerankerModelName)
      };
    }
  }

  private formatModelLoadError(error: unknown, modelName: string): string {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const modelPath = this.getModelLocalPath(modelName);

    if (rawMsg.includes('not supported') || rawMsg.includes('ranking')) {
      return `模型不支持排序（模型: ${modelName}）。\n请确保使用的是 reranker 专用模型。\n原始错误: ${rawMsg}`;
    }
    if (rawMsg.includes('Failed to load model') || rawMsg.includes('GGUF')) {
      return `GGUF 模型文件加载失败（模型: ${modelName}）。\n可能原因：GGUF 文件损坏或格式不兼容。\n建议：删除模型目录后重新下载：${modelPath}\n原始错误: ${rawMsg}`;
    }
    if (rawMsg.includes('No such file') || rawMsg.includes('ENOENT')) {
      return `模型文件不存在（模型: ${modelName}）。\n模型路径: ${modelPath}\n建议：重新下载模型。`;
    }
    return `${rawMsg}\n（模型: ${modelName}，路径: ${modelPath}）`;
  }

  /**
   * 对文档列表进行重排序。
   * @param query 查询文本
   * @param documents 待排序的文档列表
   * @returns 按相关性从高到低排序的结果
   */
  async rerank(
    query: string,
    documents: string[]
  ): Promise<{ success: boolean; results?: RerankResultItem[]; error?: string }> {
    try {
      if (!this.rerankerLoaded || !this.rankingContext) {
        const initResult = await this.initializeRerankerModel();
        if (!initResult.success) {
          return { success: false, error: initResult.error };
        }
      }

      if (documents.length === 0) {
        return { success: true, results: [] };
      }

      console.log(`[RerankerWorker] Reranking ${documents.length} documents for query: "${query.slice(0, 80)}..."`);

      // 使用 rankAndSort 一次性对所有文档打分并排序
      const ranked = await this.rankingContext.rankAndSort(query, documents);

      const results: RerankResultItem[] = ranked.map((item: any) => ({
        index: documents.indexOf(item.document),
        score: item.score,
        document: item.document,
      }));

      console.log(`[RerankerWorker] Reranking complete. Top score: ${results[0]?.score?.toFixed(4) || 'N/A'}`);
      return { success: true, results };
    } catch (error) {
      console.error('[RerankerWorker] Reranking failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '重排序失败'
      };
    }
  }

  async testRerankerConnection(modelName?: string): Promise<{
    success: boolean;
    details?: string;
    error?: string;
    model?: string;
  }> {
    const testQuery = '什么是人工智能?';
    const testDocs = [
      '人工智能是计算机科学的一个分支，致力于研究和开发能够模拟人类智能的系统。',
      '今天的天气很好，适合出门散步。',
    ];
    const startTime = Date.now();

    try {
      const rerankerModelName = modelName || this.vectorConfig?.rerankerModel || DEFAULT_RERANKER_MODEL;
      const modelPath = this.getModelLocalPath(rerankerModelName);

      const fileCheck = this.validateModelFiles(modelPath);
      if (!fileCheck.valid) {
        await this.disposeRerankerContext();
        this.rerankerLoaded = false;
        this.currentModelName = '';
        return {
          success: false,
          error: `重排序模型文件缺失或损坏: ${fileCheck.missing.join(', ')}`,
          model: rerankerModelName,
        };
      }

      if (!this.rerankerLoaded || !this.rankingContext || this.currentModelName !== rerankerModelName) {
        const initResult = await this.initializeRerankerModel(rerankerModelName);
        if (!initResult.success) {
          return { success: false, error: `重排序模型加载失败: ${initResult.error}`, model: rerankerModelName };
        }
      }

      const result = await this.rerank(testQuery, testDocs);
      const duration = Date.now() - startTime;

      if (result.success && result.results && result.results.length > 0) {
        const topScore = result.results[0].score;
        return {
          success: true,
          details: `耗时 ${duration}ms, 最高分 ${topScore.toFixed(4)}, 排序 ${result.results[0].index === 0 ? '正确' : '错误'}`,
          model: rerankerModelName,
        };
      } else {
        return { success: false, error: result.error || '重排序测试失败', model: rerankerModelName };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      return { success: false, error: `重排序测试失败 (耗时 ${duration}ms): ${errorMsg}` };
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
    ipcMain.handle('reranker:init', async (_event, { modelName }: { modelName?: string }) => {
      return this.initializeRerankerModel(modelName);
    });

    ipcMain.handle('reranker:rerank', async (_event, { query, documents }: { query: string; documents: string[] }) => {
      return this.rerank(query, documents);
    });

    ipcMain.handle('reranker:test', async (_event, { modelName }: { modelName?: string }) => {
      return this.testRerankerConnection(modelName);
    });

    ipcMain.handle('reranker:checkModelStatus', async (_event, { modelName }: { modelName: string }) => {
      return this.isModelDownloaded(modelName);
    });
  }
}

export const rerankerWorkerService = new RerankerWorkerService();
