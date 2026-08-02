/**
 * 网络搜索 IPC 处理器（Spec: add-agent-web-search-tool / Task 8）
 *
 * 通道列表：
 *   - webSearch:test    测试连接（设置面板"测试连接"按钮调用）
 *   - webSearch:search  直接搜索（供前端调试用，读取已保存的 webSearch 配置）
 *
 * 注册模式参照 registerLoraHandlers() / registerCharacterLoraHandlers()：
 *   - 使用 createLogger 创建模块日志器
 *   - try/catch 包裹全部业务逻辑，错误返回 { ok: false, error }
 *   - 不修改主进程服务，仅作为 IPC 入口
 *
 * 返回值约定（与 preload.ts / electron.d.ts 类型一致）：
 *   - 成功：{ ok: true, data: ... }
 *   - 失败：{ ok: false, error: errorMessage }
 *
 * 设计约束：
 *   - webSearch:test 接收部分 WebSearchConfig（provider/apiKey/endpoint），
 *     构造完整 config（enabled:true + 用户字段 + 默认值）调用 webSearchService.search
 *   - webSearch:search 从 settingService 读取已保存配置，调用 webSearchService.search
 *   - 不直接抛错：所有错误捕获后通过返回值传递，便于前端展示用户友好提示
 */
import { ipcMain } from 'electron';
import { webSearchService } from '../../services/webSearchService';
import type { WebSearchConfig, SearchResult } from '../../services/webSearchProviders/types';
import { getStorageService } from '../../services/storageService';
import { createLogger } from '../../services/logger';

const logger = createLogger('web-search-handler');

/** 测试连接入参（部分 WebSearchConfig，由设置面板表单构造） */
interface WebSearchTestConfig {
  provider: string;
  apiKey: string;
  endpoint: string;
}

/** 测试连接成功返回数据 */
interface WebSearchTestData {
  resultCount: number;
  sampleResult?: SearchResult;
}

/**
 * 从 settingService 读取已保存的 webSearch 配置块。
 * 配置缺失或字段缺失时返回安全默认（enabled=false，避免误启用）。
 * 与 agentHandlers.createWebSearchToolServices.getConfig 保持一致的字段兜底逻辑。
 */
function readWebSearchConfig(): WebSearchConfig {
  try {
    const settings = getStorageService().getSettings();
    const ws = settings?.webSearch;
    return {
      enabled: ws?.enabled === true,
      provider: ws?.provider ?? 'duckduckgo',
      apiKey: typeof ws?.apiKey === 'string' ? ws.apiKey : '',
      endpoint: typeof ws?.endpoint === 'string' ? ws.endpoint : '',
      maxResults: typeof ws?.maxResults === 'number' ? ws.maxResults : 5,
      timeout: typeof ws?.timeout === 'number' ? ws.timeout : 10000,
      allowedDomains: Array.isArray(ws?.allowedDomains) ? ws.allowedDomains : [],
      enableInAuthoring: ws?.enableInAuthoring === true,
    };
  } catch (err) {
    logger.warn(
      'readWebSearchConfig failed, returning disabled default',
      err instanceof Error ? err.message : String(err)
    );
    return {
      enabled: false,
      provider: 'duckduckgo',
      apiKey: '',
      endpoint: '',
      maxResults: 5,
      timeout: 10000,
      allowedDomains: [],
      enableInAuthoring: false,
    };
  }
}

/**
 * 校验 provider 字符串是否为合法的 WebSearchProviderName。
 * 用于 webSearch:test 入参校验，避免 unknown provider 导致 service 抛错。
 */
function isValidProvider(provider: string): provider is WebSearchConfig['provider'] {
  return provider === 'duckduckgo' || provider === 'tavily' || provider === 'searxng' || provider === 'custom';
}

export function registerWebSearchHandlers(): void {
  logger.info('WebSearch handlers 初始化');

  // ==================== webSearch:test ====================

  /**
   * 测试连接通道（设置面板"测试连接"按钮调用）。
   *
   * 入参：{ provider, apiKey, endpoint }（部分 WebSearchConfig，用于测试）
   * 逻辑：
   *  1. 校验 provider 字段合法性
   *  2. 构造临时 WebSearchConfig（enabled:true + 用户提供的字段 + 默认值）
   *  3. 调用 webSearchService.search('test query', config, { maxResults: 1 })
   *  4. 返回结果数 + 样例结果（第一条）
   *
   * 注意：测试连接不依赖已保存的配置，直接使用入参构造临时 config，
   *       方便用户在保存前验证 provider/apiKey/endpoint 是否可用。
   *       service.search 内部已对 provider 网络错误降级为返回 []，不会抛错；
   *       但速率限制超限 / 未知 provider 会抛错，此处 try/catch 兜底。
   */
  ipcMain.handle('webSearch:test', async (_event, config: WebSearchTestConfig) => {
    try {
      // 入参校验
      if (!config || typeof config !== 'object') {
        return { ok: false, error: '配置参数缺失' };
      }
      if (!isValidProvider(config.provider)) {
        return { ok: false, error: `未知的 provider: ${String(config.provider)}` };
      }

      // 构造临时完整配置（enabled:true 强制启用，忽略全局开关）
      const testConfig: WebSearchConfig = {
        enabled: true,
        provider: config.provider,
        apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
        endpoint: typeof config.endpoint === 'string' ? config.endpoint : '',
        maxResults: 5,
        timeout: 10000,
        allowedDomains: [],
        enableInAuthoring: false,
      };

      logger.info('webSearch:test 开始测试连接', undefined, {
        provider: testConfig.provider,
        hasApiKey: !!testConfig.apiKey,
        hasEndpoint: !!testConfig.endpoint,
      });

      // 重置速率限制计数器（测试连接不应被前次搜索的间隔限制阻塞）
      webSearchService.resetRateLimit();

      // 调用 service.search，固定查询 'test query'，maxResults: 1
      const results: SearchResult[] = await webSearchService.search('test query', testConfig, {
        maxResults: 1,
      });

      const data: WebSearchTestData = {
        resultCount: results.length,
        sampleResult: results[0],
      };

      logger.info('webSearch:test 测试连接成功', undefined, {
        provider: testConfig.provider,
        resultCount: results.length,
      });

      return { ok: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        'webSearch:test 测试连接失败',
        errorMessage,
        { errorType: error instanceof Error ? error.name : 'UnknownError' }
      );
      return { ok: false, error: errorMessage };
    }
  });

  // ==================== webSearch:search ====================

  /**
   * 直接搜索通道（供前端调试用，读取已保存的 webSearch 配置）。
   *
   * 入参：{ query, maxResults? }
   * 逻辑：
   *  1. 从 settingService 读取已保存的 webSearch 配置
   *  2. 校验 enabled 全局开关（关闭时返回明确错误，提示用户先启用）
   *  3. 调用 webSearchService.search(query, config, { maxResults })
   *  4. 返回完整结果数组
   *
   * 注意：与 webSearch:test 不同，本通道使用已保存的配置（不含临时覆盖）。
   *       enabled=false 时直接返回错误，避免误触发搜索。
   */
  ipcMain.handle(
    'webSearch:search',
    async (_event, args: { query: string; maxResults?: number }) => {
      try {
        // 入参校验
        if (!args || typeof args.query !== 'string' || !args.query.trim()) {
          return { ok: false, error: '搜索关键词不能为空' };
        }

        const config = readWebSearchConfig();

        // 全局开关校验
        if (!config.enabled) {
          return { ok: false, error: '网络搜索未启用，请先在设置中开启' };
        }

        logger.info('webSearch:search 开始搜索', undefined, {
          query: args.query,
          provider: config.provider,
          maxResults: args.maxResults ?? config.maxResults,
        });

        const results: SearchResult[] = await webSearchService.search(args.query, config, {
          maxResults: args.maxResults,
        });

        logger.info('webSearch:search 搜索完成', undefined, {
          query: args.query,
          resultCount: results.length,
        });

        return { ok: true, data: results };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'webSearch:search 搜索失败',
          errorMessage,
          { errorType: error instanceof Error ? error.name : 'UnknownError' }
        );
        return { ok: false, error: errorMessage };
      }
    }
  );

  logger.info('WebSearch handlers 注册完成');
}
