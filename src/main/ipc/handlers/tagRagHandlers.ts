/**
 * RAG 标签库 IPC 处理器（Spec: rag-tag-library-for-ai-trait-generation / Task 7）
 *
 * 通道列表：
 *   - tagRag:getStatus           获取当前状态快照（idle/vectorizing/ready/error/stale）
 *   - tagRag:startVectorization  启动向量化（异步长任务，进度通过 tagRag:progress 事件推送）
 *   - tagRag:cancelVectorization 取消进行中的向量化
 *   - tagRag:search              语义检索相关标签（用于 AI 生成特征时的 RAG 参考）
 *   - tagRag:clearIndex          清空索引（删除向量数据 + meta 文件）
 *
 * 注册模式参照 registerTagHandlers()：
 *   - 使用 createLogger 创建模块日志器
 *   - try/catch 包裹业务逻辑，错误返回包含 error 字段
 *   - 直接调用 tagRagService 单例方法
 *
 * 进度事件（非 invoke 通道，主进程主动广播）：
 *   - tagRag:progress  主进程 → 渲染进程单向推送，由 tagRagProgressEmitter 发射
 *                      渲染进程通过 electronAPI.tagRag.onProgress(callback) 订阅
 */
import { ipcMain } from 'electron';
import { tagRagService } from '../../services/tagRagService';
import { userSynonymMapService } from '../../services/userSynonymMapService';
import type {
  TagRagState,
  TagRagSearchRequest,
  TagRagSearchResponse,
  TagRagSearchResultItem,
  TagRagVectorizeResult,
  TagRagVectorizeOptions,
  TagRagClearResult,
  TagRagCancelResult,
} from '../../../shared/types/tagRag.types';
import { createLogger } from '../../services/logger';

const logger = createLogger('tag-rag-handler');

export function registerTagRagHandlers(): void {
  logger.info('TagRag handlers 初始化');

  // ==================== tagRag:getStatus ====================

  /**
   * 获取当前状态快照通道。
   *
   * 入参：无
   * 逻辑：直接调用 tagRagService.getStatus()
   *
   * 用途：
   *  - 设置面板展示当前状态（idle/vectorizing/ready/error/stale）
   *  - 渲染进程轮询本通道判断向量化是否完成 / 索引是否过期
   */
  ipcMain.handle('tagRag:getStatus', async (): Promise<TagRagState> => {
    try {
      return tagRagService.getStatus();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('tagRag:getStatus 失败', errorMessage);
      return {
        status: 'error',
        current: 0,
        total: 0,
        failedCount: 0,
        lastError: errorMessage,
        meta: null,
      };
    }
  });

  // ==================== tagRag:startVectorization ====================

  /**
   * 启动向量化通道。
   *
   * 入参：TagRagVectorizeOptions = { force?: boolean }（可选，force=true 强制重新向量化）
   * 逻辑：调用 tagRagService.vectorizeAll(options)
   *
   * 注意：
   *  - 向量化是异步长任务（远程 ~1 小时，本地 ONNX ~2.5 小时）
   *  - 本 invoke 在向量化完成前不会返回，渲染进程应展示进度条 + 异步等待
   *  - 实际进度通过 tagRag:progress 事件实时推送，无需轮询 getStatus
   *  - 并发去重：vectorizeAll 期间再次调用直接返回已有 Promise
   *
   * 返回：TagRagVectorizeResult = { success, vectorized, failed, durationMs?, error? }
   */
  ipcMain.handle(
    'tagRag:startVectorization',
    async (_event, options?: TagRagVectorizeOptions): Promise<TagRagVectorizeResult> => {
      try {
        logger.info(
          'tagRag:startVectorization 启动',
          undefined,
          { force: options?.force ?? false }
        );
        return await tagRagService.vectorizeAll(options);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('tagRag:startVectorization 失败', errorMessage);
        return { success: false, vectorized: 0, failed: 0, error: errorMessage };
      }
    }
  );

  // ==================== tagRag:cancelVectorization ====================

  /**
   * 取消向量化通道。
   *
   * 入参：无
   * 逻辑：调用 tagRagService.cancelVectorization()
   *  - 设置取消标志位，主循环每批开始时检查
   *  - 取消后状态转 idle，已写入的向量保留
   *
   * 返回：TagRagCancelResult = { success, message? }
   */
  ipcMain.handle('tagRag:cancelVectorization', async (): Promise<TagRagCancelResult> => {
    try {
      return tagRagService.cancelVectorization();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('tagRag:cancelVectorization 失败', errorMessage);
      return { success: false, message: errorMessage };
    }
  });

  // ==================== tagRag:search ====================

  /**
   * 语义检索相关标签通道。
   *
   * 入参：TagRagSearchRequest = { query, topK?, minScore?, categoryFilter? }
   * 逻辑：
   *  1. 入参校验：query 必须为非空字符串
   *  2. 调用 tagRagService.searchRelevantTags(request)
   *     - 内部会校验 settings.tagRag.enabled / status==='ready' / 维度匹配
   *     - 任何降级场景均返回空数组（不抛异常）
   *
   * 返回：TagRagSearchResponse = { success, results, error? }
   *
   * 用途：
   *  - 设置面板「检索测试区」输入文本测试检索效果
   *  - characterTraitAIService 通过 buildRagReferenceSection 内部调用（不走 IPC，直接调 service）
   */
  ipcMain.handle(
    'tagRag:search',
    async (_event, request: TagRagSearchRequest): Promise<TagRagSearchResponse> => {
      try {
        if (!request || typeof request.query !== 'string' || !request.query.trim()) {
          return { success: false, results: [], error: '查询不能为空' };
        }
        const results: TagRagSearchResultItem[] = await tagRagService.searchRelevantTags(request);
        return { success: true, results };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'tagRag:search 失败',
          errorMessage,
          { query: request?.query }
        );
        return { success: false, results: [], error: errorMessage };
      }
    }
  );

  // ==================== tagRag:clearIndex ====================

  /**
   * 清空索引通道。
   *
   * 入参：无
   * 逻辑：调用 tagRagService.clearIndex()
   *  - 删除向量数据文件（destroyAndDeleteFiles）
   *  - 删除 meta 文件（tag_rag_meta.json）
   *  - 状态转 idle
   *
   * 拒绝场景：vectorizing 中需先 cancel
   *
   * 返回：TagRagClearResult = { success, error? }
   */
  ipcMain.handle('tagRag:clearIndex', async (): Promise<TagRagClearResult> => {
    try {
      logger.info('tagRag:clearIndex 开始清空索引');
      return await tagRagService.clearIndex();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('tagRag:clearIndex 失败', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // ==================== tagRag:getUserSynonymMap ====================
  // Spec: add-multi-round-tag-audit / Task 1.2
  // 读取用户自定义同义词映射表（用于前端展示 + 多轮审计 L0 命中查询）

  /**
   * 读取用户自定义同义词映射表。
   *
   * 入参：无
   * 返回：`{ success: true, map: Record<string,string> }`
   *       map 的 key 已小写、value 为替换词；文件不存在/损坏时返回空对象
   */
  ipcMain.handle(
    'tagRag:getUserSynonymMap',
    async (): Promise<{ success: boolean; map: Record<string, string>; error?: string }> => {
      try {
        const map = userSynonymMapService.getMap();
        return { success: true, map };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('tagRag:getUserSynonymMap 失败', errorMessage);
        return { success: false, map: {}, error: errorMessage };
      }
    }
  );

  // ==================== tagRag:addUserSynonymMapping ====================
  // Spec: add-multi-round-tag-audit / Task 1.2
  // 末轮人工审核替换时持久化映射，下次 L0 首轮命中

  /**
   * 新增/更新一条用户自定义同义词映射。
   *
   * 入参：`{ original: string, replacement: string }`
   *  - original 为空 / replacement 为空 → 视为成功但 no-op（service 内部已校验）
   * 返回：`{ success: true }`
   */
  ipcMain.handle(
    'tagRag:addUserSynonymMapping',
    async (
      _event,
      args: { original: string; replacement: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const { original, replacement } = args ?? { original: '', replacement: '' };
        userSynonymMapService.addMapping(original, replacement);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('tagRag:addUserSynonymMapping 失败', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  // ==================== tagRag:removeUserSynonymMapping ====================
  // Spec: add-multi-round-tag-audit / Task 1.2
  // 撤销手动替换时删除映射（用户撤销 = 映射不正确）

  /**
   * 删除一条用户自定义同义词映射（按 original，大小写不敏感，幂等）。
   *
   * 入参：`{ original: string }`
   * 返回：`{ success: true }`（key 不存在视为成功）
   */
  ipcMain.handle(
    'tagRag:removeUserSynonymMapping',
    async (
      _event,
      args: { original: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const { original } = args ?? { original: '' };
        userSynonymMapService.removeMapping(original);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('tagRag:removeUserSynonymMapping 失败', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  logger.info('TagRag handlers 注册完成');
}
