/**
 * WebSearchSettings — 网络搜索配置面板（Spec: add-agent-web-search-tool / Task 9）
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 设置面板配置
 *
 * 职责：
 *  1. 全局开关（启用网络搜索）→ webSearch.enabled
 *  2. provider 选择（DuckDuckGo / Tavily / SearXNG / Custom）→ webSearch.provider
 *  3. 动态配置字段（按 provider 显示）：
 *     - DuckDuckGo：无额外字段（零配置）
 *     - Tavily：API key 输入框（Input.Password）
 *     - SearXNG：endpoint URL 输入框
 *     - Custom：endpoint URL 输入框（含 {query}/{maxResults} 占位符说明）
 *  4. 测试连接按钮：调用 window.electronAPI.webSearch.test，展示结果数 + 样例标题
 *  5. 高级配置（Collapse 折叠）：
 *     - maxResults（1-20，默认 5）
 *     - timeout（5000-30000，默认 10000）
 *     - allowedDomains（Select mode="tags"，域名白名单）
 *     - enableInAuthoring（Switch，世界书编写智能体集成）
 *
 * 配置读写方式（与 SDWebuiSettings / VectorConfigPanel 一致）：
 *  - 读取：useSettingStore 的 setting.webSearch（Zustand store）
 *  - 保存：通过 forwardRef + useImperativeHandle 暴露 getFormValues()，
 *          由 Settings.tsx 的 handleSave 合并到 updatedSetting.webSearch 中保存
 *
 * 设计约束：
 *  - 禁用 any（sampleResult 类型对齐主进程 SearchResult）
 *  - provider 切换时响应式显示/隐藏对应配置字段（Form.Item shouldUpdate）
 *  - 测试连接的 try/catch + message 提示（成功显示结果数，失败显示错误）
 */
import { forwardRef, useImperativeHandle, useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Switch,
  InputNumber,
  Collapse,
  Space,
  Alert,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  GlobalOutlined,
  SyncOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import type { WebSearchConfig } from '../../types/setting';

const { Text, Link } = Typography;

/**
 * WebSearchSettings 暴露给父组件的 ref 接口。
 * 与 SDWebuiSettingsRef / VectorConfigPanelRef 一致：
 * 通过 getFormValues() 取出表单当前值，由 Settings.tsx 的 handleSave 合并保存。
 */
export interface WebSearchSettingsRef {
  getFormValues: () => WebSearchConfig | undefined;
}

/**
 * 网络搜索默认配置（与 src/shared/settings.ts defaultSetting.webSearch 保持一致）。
 * 当 setting.webSearch 不存在时（旧配置迁移场景）用于初始化表单。
 */
const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  provider: 'duckduckgo',
  apiKey: '',
  endpoint: '',
  maxResults: 5,
  timeout: 10000,
  allowedDomains: [],
  enableInAuthoring: false,
};

/** provider 选项列表 */
const PROVIDER_OPTIONS: Array<{
  label: string;
  value: WebSearchConfig['provider'];
  description: string;
}> = [
  {
    label: 'DuckDuckGo（零配置，开箱即用）',
    value: 'duckduckgo',
    description: '通过 html.duckduckgo.com 抓取，无需 API key，适合一般用途',
  },
  {
    label: 'Tavily（AI 优化，需 API key）',
    value: 'tavily',
    description: '调用 api.tavily.com/search，结果质量高，需要 API key（https://tavily.com）',
  },
  {
    label: 'SearXNG（自托管，需端点 URL）',
    value: 'searxng',
    description: '调用自托管 SearXNG 实例的 /search?q=&format=json 接口',
  },
  {
    label: 'Custom（自定义端点）',
    value: 'custom',
    description: '按用户配置的 endpoint URL 模板发 GET 请求，响应需符合 { results: [{ title, snippet, url }] } 结构',
  },
];

/**
 * 网络搜索设置面板（Spec: add-agent-web-search-tool / Task 9）。
 *
 * 父组件通过 ref.current.getFormValues() 在保存时获取表单值，
 * 与 SDWebuiSettings / VectorConfigPanel 模式一致。
 */
const WebSearchSettings = forwardRef<WebSearchSettingsRef>((_props, ref) => {
  const [form] = Form.useForm<WebSearchConfig>();
  const { setting } = useSettingStore();

  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; resultCount: number; sampleTitle?: string }
    | { ok: false; error: string }
    | null
  >(null);

  // 暴露 getFormValues 给父组件
  useImperativeHandle(ref, () => ({
    getFormValues: () => {
      const values = form.getFieldsValue(true) as Partial<WebSearchConfig>;
      // 合并默认值，避免字段缺失（旧配置无 webSearch 时初始化场景）
      return {
        ...DEFAULT_WEB_SEARCH_CONFIG,
        ...values,
      } as WebSearchConfig;
    },
  }));

  // 当 setting 加载/变化时，初始化表单值
  useEffect(() => {
    const saved = setting?.webSearch;
    const initialValues: WebSearchConfig = {
      ...DEFAULT_WEB_SEARCH_CONFIG,
      ...(saved || {}),
    };
    form.setFieldsValue(initialValues);
  }, [setting, form]);

  /**
   * 测试连接：调用主进程 webSearch:test，更新 testResult 状态。
   * 使用当前表单中的 provider / apiKey / endpoint 字段构造请求，
   * 不依赖已保存的配置（方便用户在保存前验证）。
   */
  const handleTestConnection = useCallback(async () => {
    const provider = form.getFieldValue('provider');
    const apiKey = form.getFieldValue('apiKey') || '';
    const endpoint = form.getFieldValue('endpoint') || '';

    if (!provider) {
      message.warning('请先选择 provider');
      return;
    }

    // Tavily 必须有 apiKey
    if (provider === 'tavily' && !apiKey.trim()) {
      message.warning('Tavily provider 需要填写 API key');
      return;
    }
    // SearXNG / Custom 必须有 endpoint
    if ((provider === 'searxng' || provider === 'custom') && !endpoint.trim()) {
      message.warning(`${provider} provider 需要填写端点 URL`);
      return;
    }

    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await window.electronAPI.webSearch.test({
        provider,
        apiKey: apiKey.trim(),
        endpoint: endpoint.trim(),
      });

      if (result.ok && result.data) {
        const resultCount = result.data.resultCount;
        const sampleTitle = result.data.sampleResult?.title;
        setTestResult({ ok: true, resultCount, sampleTitle });
        message.success(`连接成功，返回 ${resultCount} 条结果`);
      } else {
        const errorMsg = result.error || '未知错误';
        setTestResult({ ok: false, error: errorMsg });
        message.error(`连接失败：${errorMsg}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setTestResult({ ok: false, error: errorMsg });
      message.error(`连接测试异常：${errorMsg}`);
    } finally {
      setTestLoading(false);
    }
  }, [form]);

  return (
    <Card
      title={
        <Space>
          <GlobalOutlined />
          <span>网络搜索设置</span>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      <Form form={form} layout="vertical">
        {/* ==================== 全局开关 ==================== */}
        <Form.Item
          name="enabled"
          label="启用网络搜索"
          valuePropName="checked"
          tooltip="开启后，Agent 模式下的 webSearch / fetchUrl 工具将可用；关闭时工具对模型不可见"
        >
          <Switch />
        </Form.Item>

        {/* ==================== Provider 选择 ==================== */}
        <Form.Item
          name="provider"
          label="搜索 Provider"
          tooltip="选择网络搜索后端。DuckDuckGo 零配置可用；Tavily 需 API key；SearXNG / Custom 需端点 URL"
        >
          <Select options={PROVIDER_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} />
        </Form.Item>

        {/* ==================== 动态配置字段（按 provider 显示） ==================== */}
        {/* 使用 Form.Item shouldUpdate 响应式显示/隐藏对应配置字段 */}
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.provider !== curr.provider}>
          {({ getFieldValue }) => {
            const provider = getFieldValue('provider') as WebSearchConfig['provider'];

            if (provider === 'duckduckgo') {
              return (
                <Alert
                  type="info"
                  showIcon
                  message="DuckDuckGo 零配置，开箱即用"
                  description="通过 html.duckduckgo.com/html/?q= 端点抓取结果，无需 API key 或端点配置。"
                  style={{ marginBottom: 24 }}
                />
              );
            }

            if (provider === 'tavily') {
              return (
                <Form.Item
                  name="apiKey"
                  label={
                    <Space>
                      <span>Tavily API Key</span>
                      <Tooltip title="在 https://tavily.com 注册后获取 API key。密钥存储在本地 settings.json，不上传服务器。">
                        <QuestionCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input.Password placeholder="tvly-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                </Form.Item>
              );
            }

            if (provider === 'searxng') {
              return (
                <Form.Item
                  name="endpoint"
                  label={
                    <Space>
                      <span>SearXNG 端点 URL</span>
                      <Tooltip title="自托管 SearXNG 实例的根 URL（不含 /search 路径），如 http://localhost:8080">
                        <QuestionCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input placeholder="http://localhost:8080" />
                </Form.Item>
              );
            }

            // provider === 'custom'
            return (
              <>
                <Form.Item
                  name="endpoint"
                  label={
                    <Space>
                      <span>自定义端点 URL 模板</span>
                      <Tooltip
                        title={
                          'URL 模板支持 {query} 与 {maxResults} 两个占位符，' +
                          '请求时会被替换为实际查询关键词与最大结果数。\n' +
                          '响应需符合 JSON 结构：{ results: [{ title, snippet, url }] }。'
                        }
                      >
                        <QuestionCircleOutlined />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input placeholder="https://my-api.com/search?q={query}&limit={maxResults}" />
                </Form.Item>
                <Alert
                  type="warning"
                  showIcon
                  message="自定义 provider 说明"
                  description={
                    <div>
                      <p style={{ margin: 0 }}>
                        URL 模板中 <Text code>{'{query}'}</Text> 与 <Text code>{'{maxResults}'}</Text> 占位符会被替换为实际值。
                      </p>
                      <p style={{ margin: '4px 0 0 0' }}>
                        响应必须是 JSON 且符合结构 <Text code>{'{ results: [{ title, snippet, url }] }'}</Text>，
                        否则解析失败返回空结果。详见
                        <Link
                          href="https://docs.tavily.com/documentation/api-reference/endpoint"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {' '}provider 文档
                        </Link>
                        。
                      </p>
                    </div>
                  }
                  style={{ marginBottom: 24 }}
                />
              </>
            );
          }}
        </Form.Item>

        {/* ==================== 测试连接按钮 ==================== */}
        <Form.Item>
          <Space>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={handleTestConnection}
              loading={testLoading}
            >
              测试连接
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              发送一条测试搜索查询（"test query"），验证 provider 配置是否可用
            </Text>
          </Space>
        </Form.Item>

        {/* 测试结果展示 */}
        {testResult && (
          <div style={{ marginBottom: 16 }}>
            <Alert
              message={testResult.ok ? '连接测试成功' : '连接测试失败'}
              description={
                testResult.ok ? (
                  <div>
                    <p style={{ margin: 0 }}>
                      <strong>返回结果数：</strong>
                      {testResult.resultCount}
                    </p>
                    {testResult.sampleTitle && (
                      <p style={{ margin: '4px 0 0 0' }}>
                        <strong>样例标题：</strong>
                        {testResult.sampleTitle}
                      </p>
                    )}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: 'red' }}>
                    <strong>错误：</strong>
                    {testResult.error}
                  </p>
                )
              }
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              closable
              onClose={() => setTestResult(null)}
            />
          </div>
        )}

        {/* ==================== 高级配置（折叠面板） ==================== */}
        <Collapse
          items={[
            {
              key: 'advanced',
              label: '高级配置',
              children: (
                <>
                  <Form.Item
                    name="maxResults"
                    label="默认结果数"
                    tooltip="每次搜索返回的最大结果条数（1-20，默认 5）"
                  >
                    <InputNumber min={1} max={20} step={1} style={{ width: '100%' }} />
                  </Form.Item>

                  <Form.Item
                    name="timeout"
                    label="请求超时（毫秒）"
                    tooltip="单次搜索请求的超时时间（5000-30000，默认 10000ms）"
                  >
                    <InputNumber
                      min={5000}
                      max={30000}
                      step={1000}
                      style={{ width: '100%' }}
                      addonAfter="ms"
                    />
                  </Form.Item>

                  <Form.Item
                    name="allowedDomains"
                    label={
                      <Space>
                        <span>域名白名单</span>
                        <Tooltip title="可选。仅返回这些域名的搜索结果（如 example.com）。留空表示不限域名。输入后按回车添加。">
                          <QuestionCircleOutlined />
                        </Tooltip>
                      </Space>
                    }
                  >
                    <Select
                      mode="tags"
                      placeholder="输入域名后按回车添加，如 example.com"
                      tokenSeparators={[',', ' ']}
                    />
                  </Form.Item>

                  <Form.Item
                    name="enableInAuthoring"
                    label="世界书编写智能体集成"
                    valuePropName="checked"
                    tooltip="开启后，世界书编写智能体在 PLANNING / AUTHORING 阶段可调用网络搜索补充上下文（需在编写 Modal 中显式启用）"
                  >
                    <Switch />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Card>
  );
});

WebSearchSettings.displayName = 'WebSearchSettings';

export default WebSearchSettings;
