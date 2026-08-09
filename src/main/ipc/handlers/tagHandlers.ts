/**
 * 标签自动推荐 IPC 处理器（Spec: implement-local-tag-autocomplete / Task 3）
 *
 * 通道列表：
 *   - tag:search        查询标签库（子串匹配 + 排序）
 *   - tag:getLoadStatus 获取加载状态
 *   - tag:reload        重新加载标签库（可选传入新 csvPath）
 *   - tag:setCsvPath    设置 CSV 路径并重新加载（语义等同于 tag:reload 传 csvPath）
 *
 * 注册模式参照 registerLoraHandlers() / registerCharacterLoraHandlers()：
 *   - 使用 createLogger 创建模块日志器
 *   - try/catch 包裹业务逻辑，错误返回包含 error 字段
 *   - 直接调用 tagAutocompleteService 单例方法
 *
 * 返回值约定（与 preload.ts / electron.d.ts 类型一致）：
 *   - 直接返回 service 的结果对象（TagSearchResponse / TagLoadStatus / TagReloadResult）
 *   - 不再包装为 { ok, data }：因为这些类型已自带 success / error 字段，
 *     与 loraHandlers.ts / characterLoraHandlers.ts 的风格一致
 *   - 异常分支手工构造失败返回值（保持类型守卫，不抛错给 IPC 调用方）
 */
import { ipcMain } from 'electron';
import { tagAutocompleteService } from '../../services/tagAutocompleteService';
import type {
  TagSearchRequest,
  TagSearchResponse,
  TagLoadStatus,
  TagReloadResult,
} from '../../../shared/types/tag.types';
import { createLogger } from '../../services/logger';

const logger = createLogger('tag-handler');

export function registerTagHandlers(): void {
  logger.info('Tag handlers 初始化');

  // ==================== tag:search ====================

  /**
   * 查询标签库通道。
   *
   * 入参：TagSearchRequest = { query, sortBy?, limit? }
   * 逻辑：
   *  1. 入参校验：query 必须为非空字符串
   *  2. 调用 tagAutocompleteService.search(request)
   *     - 内部首次调用会触发 ensureLoaded()，加载完成后自动执行本次查询
   *     - 加载期间返回的 invoke 处于 pending 态，渲染进程可据此提示 loading
   *  3. 直接返回 service 的 TagSearchResponse（含 success / results / total / error? / loading?）
   *
   * 注意：search 内部已处理"加载失败 → 返回 error"、"空 query → 返回空结果"等场景，
   *       本 handler 仅做入参校验与异常兜底，不重复实现业务逻辑。
   */
  ipcMain.handle(
    'tag:search',
    async (_event, request: TagSearchRequest): Promise<TagSearchResponse> => {
      try {
        if (
          !request ||
          typeof request.query !== 'string' ||
          !request.query.trim()
        ) {
          return {
            success: false,
            results: [],
            total: 0,
            error: '查询不能为空',
          };
        }
        return await tagAutocompleteService.search(request);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'tag:search 查询失败',
          errorMessage,
          { query: request?.query, errorType: error instanceof Error ? error.name : 'UnknownError' }
        );
        return { success: false, results: [], total: 0, error: errorMessage };
      }
    }
  );

  // ==================== tag:getLoadStatus ====================

  /**
   * 获取加载状态通道。
   *
   * 入参：无
   * 逻辑：直接调用 tagAutocompleteService.getLoadStatus() 返回快照
   *
   * 用途：
   *  - 设置面板展示当前 csvPath / 加载进度 / 标签总数
   *  - 渲染进程在 tag:search 返回 loading=true 时轮询本通道
   */
  ipcMain.handle('tag:getLoadStatus', async (): Promise<TagLoadStatus> => {
    try {
      return tagAutocompleteService.getLoadStatus();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('tag:getLoadStatus 失败', errorMessage);
      return {
        loaded: false,
        loading: false,
        totalCount: 0,
        csvPath: '',
        error: errorMessage,
      };
    }
  });

  // ==================== tag:reload ====================

  /**
   * 重新加载标签库通道。
   *
   * 入参：{ csvPath?: string }（可选，不传则沿用当前 csvPath 重新加载）
   * 逻辑：调用 tagAutocompleteService.reload(csvPath)
   *  - 传入 csvPath 时更新配置路径并重新加载（用于切换 CSV 文件后刷新）
   *  - 不传时沿用当前路径重新加载（用于文件更新后刷新）
   *
   * 返回：TagReloadResult = { success, totalCount, error? }
   */
  ipcMain.handle(
    'tag:reload',
    async (_event, args?: { csvPath?: string }): Promise<TagReloadResult> => {
      try {
        const csvPath = args?.csvPath;
        logger.info(
          'tag:reload 开始重新加载',
          undefined,
          csvPath ? { csvPath } : { useDefault: true }
        );
        return await tagAutocompleteService.reload(csvPath);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('tag:reload 失败', errorMessage);
        return { success: false, totalCount: 0, error: errorMessage };
      }
    }
  );

  // ==================== tag:setCsvPath ====================

  /**
   * 设置 CSV 路径并重新加载通道。
   *
   * 入参：{ csvPath: string }（必填，新 CSV 路径）
   * 逻辑：内部直接调用 tagAutocompleteService.reload(csvPath)
   *
   * 与 tag:reload(csvPath) 语义等价；提供独立通道便于语义区分：
   *  - tag:reload        侧重"重新加载"语义（可能是刷新当前路径）
   *  - tag:setCsvPath     侧重"切换路径"语义（必传新 csvPath）
   *
   * 返回：TagReloadResult = { success, totalCount, error? }
   */
  ipcMain.handle(
    'tag:setCsvPath',
    async (_event, args: { csvPath: string }): Promise<TagReloadResult> => {
      try {
        if (!args || typeof args.csvPath !== 'string' || !args.csvPath.trim()) {
          return { success: false, totalCount: 0, error: 'csvPath 不能为空' };
        }
        logger.info(
          'tag:setCsvPath 设置新路径并重新加载',
          undefined,
          { csvPath: args.csvPath }
        );
        return await tagAutocompleteService.reload(args.csvPath);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('tag:setCsvPath 失败', errorMessage);
        return { success: false, totalCount: 0, error: errorMessage };
      }
    }
  );

  logger.info('Tag handlers 注册完成');
}
