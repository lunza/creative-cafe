/**
 * Web Search 工具执行器单元测试 —— Task 12 SubTask 12.1
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 网络搜索工具
 *
 * 覆盖工具执行器（≥6 用例）：
 *  - webSearch 执行器：正常执行 / 参数校验 / 服务错误降级 / 空结果提示
 *  - fetchUrl 执行器：正常执行 / 参数校验（url 为空 + 非 http 格式） / 服务错误降级 / success=false 路径
 *  - 描述符定义：name / availability / inputSchema
 *  - registerWebSearchTools：注册两个工具
 *
 * Mock 策略：
 *  - 通过 IWebSearchToolServices 接口注入 mock 实现，不依赖真实 WebSearchService
 *  - 不发真实 HTTP 请求
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  webSearchDescriptor,
  fetchUrlDescriptor,
  createWebSearchExecutor,
  createFetchUrlExecutor,
  registerWebSearchTools,
  type IWebSearchToolServices,
} from '../webSearchTools';
import type { WebSearchConfig, SearchResult } from '../../../../webSearchProviders';

// ==================== Mock 服务工厂 ====================

interface MockState {
  searchResults: SearchResult[];
  searchShouldThrow?: Error;
  fetchResult: { success: boolean; content: string; contentType?: string };
  fetchShouldThrow?: Error;
  getConfigResult: WebSearchConfig;
  searchCalls: Array<{ query: string; maxResults?: number }>;
  fetchCalls: Array<{ url: string; maxLength?: number }>;
  getConfigCalls: number;
}

function createMockServices(state: MockState): IWebSearchToolServices {
  return {
    search: async (query, config, options) => {
      state.searchCalls.push({
        query,
        maxResults: options?.maxResults,
      });
      // 触发 config 读取以验证调用链（避免未使用警告）
      void config;
      if (state.searchShouldThrow) throw state.searchShouldThrow;
      return state.searchResults;
    },
    fetchUrl: async (url, maxLength) => {
      state.fetchCalls.push({ url, maxLength });
      if (state.fetchShouldThrow) throw state.fetchShouldThrow;
      return state.fetchResult;
    },
    getConfig: async () => {
      state.getConfigCalls++;
      return state.getConfigResult;
    },
  };
}

function defaultConfig(overrides: Partial<WebSearchConfig> = {}): WebSearchConfig {
  return {
    enabled: true,
    provider: 'duckduckgo',
    apiKey: '',
    endpoint: '',
    maxResults: 5,
    timeout: 10000,
    allowedDomains: [],
    enableInAuthoring: false,
    ...overrides,
  };
}

function mkResult(title: string, url: string, snippet = ''): SearchResult {
  return { title, url, snippet, source: 'duckduckgo' };
}

let state: MockState;

beforeEach(() => {
  state = {
    searchResults: [],
    fetchResult: { success: true, content: '' },
    getConfigResult: defaultConfig(),
    searchCalls: [],
    fetchCalls: [],
    getConfigCalls: 0,
  };
});

// ==================== 描述符验证 ====================

describe('工具描述符', () => {
  it('webSearchDescriptor 字段正确（name / availability / inputSchema）', () => {
    expect(webSearchDescriptor.name).toBe('webSearch');
    expect(webSearchDescriptor.owner.kind).toBe('core');
    expect(webSearchDescriptor.inputSchema.type).toBe('object');
    expect(webSearchDescriptor.inputSchema.required).toEqual(['query']);
    expect(webSearchDescriptor.inputSchema.properties).toHaveProperty('query');
    expect(webSearchDescriptor.inputSchema.properties).toHaveProperty('maxResults');
    // availability: allOf[capability:supportsToolCalling, config:webSearch.enabled]
    expect(webSearchDescriptor.availability).toEqual({
      allOf: [
        { kind: 'capability', name: 'supportsToolCalling' },
        { kind: 'config', path: ['webSearch', 'enabled'], check: 'available' },
      ],
    });
    expect(webSearchDescriptor.annotations?.group).toBe('web');
  });

  it('fetchUrlDescriptor 字段正确（name / availability / inputSchema）', () => {
    expect(fetchUrlDescriptor.name).toBe('fetchUrl');
    expect(fetchUrlDescriptor.owner.kind).toBe('core');
    expect(fetchUrlDescriptor.inputSchema.type).toBe('object');
    expect(fetchUrlDescriptor.inputSchema.required).toEqual(['url']);
    expect(fetchUrlDescriptor.inputSchema.properties).toHaveProperty('url');
    expect(fetchUrlDescriptor.inputSchema.properties).toHaveProperty('maxLength');
    expect(fetchUrlDescriptor.availability).toEqual({
      allOf: [
        { kind: 'capability', name: 'supportsToolCalling' },
        { kind: 'config', path: ['webSearch', 'enabled'], check: 'available' },
      ],
    });
    expect(fetchUrlDescriptor.annotations?.group).toBe('web');
  });
});

// ==================== webSearch 执行器 ====================

describe('createWebSearchExecutor', () => {
  it('正常执行：services.search 返回结果，验证 ToolExecutionResult.success=true + content 为 JSON', async () => {
    state.searchResults = [
      mkResult('Title 1', 'https://r1.com', 'Snippet 1'),
      mkResult('Title 2', 'https://r2.com', 'Snippet 2'),
    ];
    const executor = createWebSearchExecutor(createMockServices(state));

    const result = await executor({ query: 'test query', maxResults: 5 });

    expect(result.success).toBe(true);
    expect(result.continueLoop).toBe(true);
    // content 应为 JSON 字符串，解析后含两条结果
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('Title 1');
    expect(parsed[1].url).toBe('https://r2.com');
    // 验证 services.search 被调用且参数正确
    expect(state.searchCalls).toHaveLength(1);
    expect(state.searchCalls[0].query).toBe('test query');
    expect(state.searchCalls[0].maxResults).toBe(5);
    expect(state.getConfigCalls).toBe(1);
  });

  it('参数校验：query 为空时返回 success=false + 错误提示，不调用 services', async () => {
    const executor = createWebSearchExecutor(createMockServices(state));

    const r1 = await executor({ query: '' });
    const r2 = await executor({ query: '   ' });
    const r3 = await executor({});

    expect(r1.success).toBe(false);
    expect(r1.content).toContain('query');
    expect(r1.continueLoop).toBe(true);
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(false);
    // 不应调用 services
    expect(state.searchCalls).toHaveLength(0);
    expect(state.getConfigCalls).toBe(0);
  });

  it('服务错误：services.search reject → success=false + 含错误信息的 content', async () => {
    state.searchShouldThrow = new Error('Rate limit exceeded: max 20 searches per run');
    const executor = createWebSearchExecutor(createMockServices(state));

    const result = await executor({ query: 'test' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('webSearch failed');
    expect(result.content).toContain('Rate limit exceeded');
    expect(result.continueLoop).toBe(true);
  });

  it('空结果：services.search 返回 [] → success=true + "No web search results" 提示', async () => {
    state.searchResults = [];
    const executor = createWebSearchExecutor(createMockServices(state));

    const result = await executor({ query: 'rare-query' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('No web search results');
    expect(result.content).toContain('rare-query');
    expect(result.continueLoop).toBe(true);
  });

  it('maxResults 超过 20 时被截断为 20，小于 1 时视为 undefined（用 config 默认）', async () => {
    const executor = createWebSearchExecutor(createMockServices(state));

    // 超过 20 → 截断为 20
    await executor({ query: 'test', maxResults: 100 });
    expect(state.searchCalls[0].maxResults).toBe(20);

    // 小于 1 → undefined（用 config 默认）
    await executor({ query: 'test2', maxResults: 0 });
    expect(state.searchCalls[1].maxResults).toBeUndefined();

    // 非数字 → undefined
    await executor({ query: 'test3', maxResults: 'invalid' as unknown as number });
    expect(state.searchCalls[2].maxResults).toBeUndefined();
  });
});

// ==================== fetchUrl 执行器 ====================

describe('createFetchUrlExecutor', () => {
  it('正常执行：services.fetchUrl 返回 success=true，content 透传', async () => {
    state.fetchResult = {
      success: true,
      content: 'Extracted page text content',
      contentType: 'text/html',
    };
    const executor = createFetchUrlExecutor(createMockServices(state));

    const result = await executor({ url: 'https://example.com/page', maxLength: 2000 });

    expect(result.success).toBe(true);
    expect(result.content).toBe('Extracted page text content');
    expect(result.continueLoop).toBe(true);
    expect(state.fetchCalls).toHaveLength(1);
    expect(state.fetchCalls[0].url).toBe('https://example.com/page');
    expect(state.fetchCalls[0].maxLength).toBe(2000);
  });

  it('参数校验：url 为空时返回 success=false + 错误提示', async () => {
    const executor = createFetchUrlExecutor(createMockServices(state));

    const r1 = await executor({ url: '' });
    const r2 = await executor({ url: '   ' });
    const r3 = await executor({});

    expect(r1.success).toBe(false);
    expect(r1.content).toContain('url');
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(false);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it('URL 格式校验：非 http/https URL 返回 success=false', async () => {
    const executor = createFetchUrlExecutor(createMockServices(state));

    const r1 = await executor({ url: 'ftp://example.com/file' });
    const r2 = await executor({ url: 'javascript:alert(1)' });
    const r3 = await executor({ url: 'not-a-url' });

    expect(r1.success).toBe(false);
    expect(r1.content).toContain('http(s)');
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(false);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it('服务返回 success=false：透传为 ToolExecutionResult.success=false + 含 URL 与错误', async () => {
    state.fetchResult = {
      success: false,
      content: 'HTTP 404 Not Found',
      contentType: 'text/html',
    };
    const executor = createFetchUrlExecutor(createMockServices(state));

    const result = await executor({ url: 'https://example.com/missing' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('fetchUrl failed');
    expect(result.content).toContain('https://example.com/missing');
    expect(result.content).toContain('HTTP 404');
    expect(result.continueLoop).toBe(true);
  });

  it('服务错误：services.fetchUrl reject → success=false + 含错误信息', async () => {
    state.fetchShouldThrow = new Error('ECONNREFUSED');
    const executor = createFetchUrlExecutor(createMockServices(state));

    const result = await executor({ url: 'https://unreachable.example.com' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('fetchUrl failed');
    expect(result.content).toContain('ECONNREFUSED');
    expect(result.continueLoop).toBe(true);
  });

  it('maxLength 非正数时视为 undefined（用默认值）', async () => {
    const executor = createFetchUrlExecutor(createMockServices(state));

    await executor({ url: 'https://example.com', maxLength: 0 });
    expect(state.fetchCalls[0].maxLength).toBeUndefined();

    await executor({ url: 'https://example.com', maxLength: -1 });
    expect(state.fetchCalls[1].maxLength).toBeUndefined();

    await executor({ url: 'https://example.com', maxLength: 'invalid' as unknown as number });
    expect(state.fetchCalls[2].maxLength).toBeUndefined();
  });
});

// ==================== registerWebSearchTools ====================

describe('registerWebSearchTools', () => {
  it('注册两个工具到 registry（webSearch + fetchUrl）', () => {
    const registered: Array<{ name: string; descriptor: unknown; executor: unknown }> = [];
    const mockRegistry = {
      register: (descriptor: { name: string }, executor: unknown) => {
        registered.push({ name: descriptor.name, descriptor, executor });
      },
    };
    const services = createMockServices(state);

    registerWebSearchTools(
      mockRegistry as unknown as Parameters<typeof registerWebSearchTools>[0],
      services
    );

    expect(registered).toHaveLength(2);
    expect(registered[0].name).toBe('webSearch');
    expect(registered[1].name).toBe('fetchUrl');
    // 两个 executor 都应为函数
    expect(typeof registered[0].executor).toBe('function');
    expect(typeof registered[1].executor).toBe('function');
  });

  it('重复注册被忽略（不抛错，保留已注册的两个）', () => {
    // 模拟第二次 register 抛错（已被注册场景）
    let callCount = 0;
    const mockRegistry = {
      register: () => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Tool already registered');
        }
      },
    };
    const services = createMockServices(state);

    // 不应抛错
    expect(() =>
      registerWebSearchTools(
        mockRegistry as unknown as Parameters<typeof registerWebSearchTools>[0],
        services
      )
    ).not.toThrow();
    // 应尝试注册两次（第二次失败被吞）
    expect(callCount).toBe(2);
  });
});
