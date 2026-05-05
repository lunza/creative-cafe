import React, { useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Card, Form, Input, Select, Switch, InputNumber, Button, Space, message, Divider, Tag, Collapse, Tooltip, Alert } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, SettingOutlined, CloudServerOutlined, DesktopOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useVectorStore } from '../../stores/vectorStore';
import { useSettingStore } from '../../stores/settingStore';
import { rendererEmbeddingService } from '../../services/rendererEmbeddingService';
import type { EmbeddingMode, VectorConfigGroup, VectorDefaults } from '../../types/vectorConfig';
import { VectorScopeSelector } from './VectorScopeSelector';

const { Option } = Select;
const { Panel } = Collapse;

export interface VectorConfigPanelRef {
  getFormValues: () => any;
}

// 默认配置常量
const DEFAULT_CONFIGS: Record<EmbeddingMode, VectorDefaults> = {
  remote: {
    remoteModel: 'text-embedding-3-small',
    remoteApiUrl: 'https://api.openai.com/v1/embeddings',
    remoteApiKey: '',
    vectorStoreMode: 'json',
    cacheEnabled: true,
    cacheL1Size: 1000,
    cacheL1TTL: 300,
    cacheL2TTL: 3600,
    defaultTopK: 5,
    minSimilarityScore: 0.7,
    contextWindowTokens: 4096,
    autoVectorizeWorldBook: true,
    autoVectorizeKnowledge: true,
  },
  local: {
    localModel: 'Xenova/all-MiniLM-L6-v2',
    vectorStoreMode: 'vecstore',
    cacheEnabled: true,
    cacheL1Size: 2000,
    cacheL1TTL: 600,
    cacheL2TTL: 7200,
    defaultTopK: 8,
    minSimilarityScore: 0.6,
    contextWindowTokens: 8192,
    autoVectorizeWorldBook: true,
    autoVectorizeKnowledge: true,
  },
};

// 属性分组配置
const CONFIG_GROUPS: VectorConfigGroup = {
  common: {
    title: '通用配置',
    fields: ['vectorStoreMode', 'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL'],
  },
  remote: {
    title: '远程 API 配置',
    icon: <CloudServerOutlined />,
    fields: ['remoteModel', 'remoteApiUrl', 'remoteApiKey', 'remoteApiKeyTransmission'],
  },
  local: {
    title: '本地模型配置',
    icon: <DesktopOutlined />,
    fields: ['localModel'],
  },
  retrieval: {
    title: '检索配置',
    fields: ['defaultTopK', 'minSimilarityScore', 'contextWindowTokens'],
  },
  automation: {
    title: '自动化配置',
    fields: ['autoVectorizeWorldBook', 'autoVectorizeKnowledge'],
  },
};

// 模式到属性映射
const MODE_FIELD_MAP: Record<EmbeddingMode, string[]> = {
  remote: ['remoteModel', 'remoteApiUrl', 'remoteApiKey', 'remoteApiKeyTransmission'],
  local: ['localModel'],
};

const VectorConfigPanel = forwardRef<VectorConfigPanelRef>((_props, ref) => {
  const { mode, isConnected, dimension, loading, testConnection, testStorage, selectedScopes } = useVectorStore();
  const { setting } = useSettingStore();
  const [form] = Form.useForm();
  const [activeEmbeddingMode, setActiveEmbeddingMode] = useState<EmbeddingMode>('remote');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResultDetail, setTestResultDetail] = useState<any>(null);
  const [storageTestResult, setStorageTestResult] = useState<any>(null);
  const [testConnectionLoading, setTestConnectionLoading] = useState(false);
  const [testStorageLoading, setTestStorageLoading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [modelDownloadStatus, setModelDownloadStatus] = useState<{ [key: string]: boolean }>({});
  const [modelDownloading, setModelDownloading] = useState<{ [key: string]: boolean }>({});

  useImperativeHandle(ref, () => ({
    getFormValues: () => form.getFieldsValue(),
  }));

  const getInitialValues = useCallback((embeddingMode: EmbeddingMode): any => {
    const defaults = DEFAULT_CONFIGS[embeddingMode];
    const saved = setting?.vector || {};

    return {
      embeddingMode,
      ...defaults,
      ...saved,
    };
  }, [setting]);

  const initializeForm = useCallback((embeddingMode: EmbeddingMode) => {
    const initialValues = getInitialValues(embeddingMode);
    form.setFieldsValue(initialValues);
    setActiveEmbeddingMode(embeddingMode);
  }, [form, getInitialValues]);

  useEffect(() => {
    if (setting?.vector) {
      const currentMode = (setting.vector.embeddingMode as EmbeddingMode) || 'remote';
      initializeForm(currentMode);
    } else {
      initializeForm('remote');
    }
  }, [setting, form, initializeForm]);

  const handleModeChange = useCallback(async (newMode: EmbeddingMode) => {
    const currentValues = form.getFieldsValue();
    const newDefaults = DEFAULT_CONFIGS[newMode];

    const preservedValues: Record<string, any> = {
      embeddingMode: newMode,
    };

    const commonFields = [...CONFIG_GROUPS.common.fields, ...CONFIG_GROUPS.retrieval.fields, ...CONFIG_GROUPS.automation.fields];
    commonFields.forEach(field => {
      if (currentValues[field] !== undefined) {
        preservedValues[field] = currentValues[field];
      } else if (newDefaults[field] !== undefined) {
        preservedValues[field] = newDefaults[field];
      }
    });

    const modeSpecificFields = MODE_FIELD_MAP[newMode];
    modeSpecificFields.forEach(field => {
      if (currentValues[field] !== undefined) {
        preservedValues[field] = currentValues[field];
      } else if (newDefaults[field] !== undefined) {
        preservedValues[field] = newDefaults[field];
      }
    });

    form.setFieldsValue(preservedValues);
    setActiveEmbeddingMode(newMode);
  }, [form]);

  const handleDownloadModel = async (modelName: string) => {
    setModelDownloading(prev => ({ ...prev, [modelName]: true }));

    try {
      const result = await rendererEmbeddingService.downloadModel(modelName, (progress, status) => {
        console.log(`[Download] ${modelName}: ${progress}% - ${status}`);
      });

      if (result.success) {
        message.success(`${modelName.split('/').pop()} 下载完成`);
        setModelDownloadStatus(prev => ({ ...prev, [modelName]: true }));
      } else {
        message.error(`${modelName.split('/').pop()} 下载失败: ${result.error}`);
        setModelDownloadStatus(prev => ({ ...prev, [modelName]: false }));
      }
    } catch (error) {
      message.error(`${modelName.split('/').pop()} 下载失败`);
      setModelDownloadStatus(prev => ({ ...prev, [modelName]: false }));
    } finally {
      setModelDownloading(prev => ({ ...prev, [modelName]: false }));
    }
  };

  const checkModelDownloadStatus = async (modelName: string) => {
    const status = await rendererEmbeddingService.checkModelDownloaded(modelName);
    setModelDownloadStatus(prev => ({ ...prev, [modelName]: status.downloaded }));
  };

  const handleTestConnection = async () => {
    setTestResultDetail(null);
    setTestConnectionLoading(true);
    setDownloadFailed(false);
    const formValues = form.getFieldsValue();
    const currentMode = formValues.embeddingMode || mode;

    let result;
    if (currentMode === 'local') {
      result = await rendererEmbeddingService.testLocalConnection(formValues.localModel);
      if (!result.success && result.error && (
        result.error.includes('timeout') ||
        result.error.includes('404') ||
        result.error.includes('failed to download') ||
        result.error.includes('Only')
      )) {
        setDownloadFailed(true);
      }
    } else {
      result = await testConnection({
        embeddingMode: currentMode,
        remoteModel: formValues.remoteModel,
        remoteApiUrl: formValues.remoteApiUrl,
        remoteApiKey: formValues.remoteApiKey,
        remoteApiKeyTransmission: formValues.remoteApiKeyTransmission,
      });
    }

    setTestConnectionLoading(false);

    if (result.success) {
      const modelLabel = result.model ? ` (${result.model.split('/').pop()})` : '';
      message.success(`连接测试成功${modelLabel}：${result.details || '成功'}`);
      setTestResultDetail(result);
    } else {
      const modelLabel = result.model ? ` (${result.model.split('/').pop()})` : '';
      message.error(`连接测试失败${modelLabel}: ${result.error || '未知错误'}`);
      setTestResultDetail(result);
    }
  };

  const handleTestStorage = async () => {
    setStorageTestResult(null);
    setTestStorageLoading(true);
    const selectedScopeIds = selectedScopes.length > 0 ? selectedScopes : undefined;
    const result = await testStorage(selectedScopeIds);
    setTestStorageLoading(false);

    if (result.success) {
      message.success(`存储测试成功：${result.details || '成功'}`);
      setStorageTestResult(result);
    } else {
      message.error('存储测试失败');
      setStorageTestResult(result);
    }
  };

  const handleStorageModeChange = useCallback(async (newMode: 'vecstore' | 'json') => {
    try {
      await window.electronAPI.vector.setStoreMode(newMode);
      message.success(`存储模式已切换为: ${newMode === 'vecstore' ? 'VecStore' : 'JSON'}`);
    } catch (error) {
      message.error('存储模式切换失败');
    }
  }, []);

  const renderField = useCallback((fieldName: string) => {
    switch (fieldName) {
      case 'remoteApiUrl':
        return (
          <Form.Item
            name="remoteApiUrl"
            label="远程 API 地址"
            tooltip="例如: http://localhost:8080/v1/embeddings"
          >
            <Input placeholder="http://localhost:8080/v1/embeddings" />
          </Form.Item>
        );
      case 'remoteModel':
        return (
          <Form.Item
            name="remoteModel"
            label="远程模型名称"
            tooltip="模型 ID，如: text-embedding-ada-002"
          >
            <Input placeholder="text-embedding-ada-002" />
          </Form.Item>
        );
      case 'remoteApiKey':
        return (
          <Form.Item
            name="remoteApiKey"
            label="远程 API 密钥"
            tooltip="API 密钥或 Token"
          >
            <Input.Password placeholder="sk-..." visibilityToggle />
          </Form.Item>
        );
      case 'remoteApiKeyTransmission':
        return (
          <Form.Item
            name="remoteApiKeyTransmission"
            label="API 密钥传输方式"
            tooltip="选择密钥传输方式：Header 模式使用 Authorization 请求头，Body 模式将密钥放在请求体中"
          >
            <Select placeholder="选择传输方式">
              <Option value="header">Header (Authorization)</Option>
              <Option value="body">Body (请求体)</Option>
            </Select>
          </Form.Item>
        );
      case 'localModel':
        return null;
      case 'vectorStoreMode':
        return (
          <Form.Item name="vectorStoreMode" label="向量存储模式">
            <Select onChange={handleStorageModeChange}>
              <Option value="json">JSON 存储（轻量级，适合小规模数据）</Option>
              <Option value="vecstore">VecStore 存储（高性能，适合大规模数据）</Option>
            </Select>
          </Form.Item>
        );
      case 'cacheEnabled':
        return (
          <Form.Item name="cacheEnabled" label="启用缓存" valuePropName="checked">
            <Switch />
          </Form.Item>
        );
      case 'cacheL1Size':
        return (
          <Form.Item name="cacheL1Size" label="L1 缓存大小（条目数）" tooltip="内存缓存的最大条目数">
            <InputNumber min={100} max={10000} step={100} style={{ width: '100%' }} />
          </Form.Item>
        );
      case 'cacheL1TTL':
        return (
          <Form.Item name="cacheL1TTL" label="L1 缓存 TTL（秒）" tooltip="内存缓存过期时间">
            <InputNumber min={60} max={3600} step={60} style={{ width: '100%' }} />
          </Form.Item>
        );
      case 'cacheL2TTL':
        return (
          <Form.Item name="cacheL2TTL" label="L2 缓存 TTL（秒）" tooltip="磁盘缓存过期时间">
            <InputNumber min={300} max={86400} step={300} style={{ width: '100%' }} />
          </Form.Item>
        );
      case 'defaultTopK':
        return (
          <Form.Item name="defaultTopK" label="默认检索数量（Top K）" tooltip="语义搜索返回的结果数量">
            <InputNumber min={1} max={50} style={{ width: '100%' }} />
          </Form.Item>
        );
      case 'minSimilarityScore':
        return (
          <Form.Item name="minSimilarityScore" label="最低相似度阈值" tooltip="低于此值的结果将被过滤">
            <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
          </Form.Item>
        );
      case 'contextWindowTokens':
        return (
          <Form.Item name="contextWindowTokens" label="上下文窗口大小" tooltip="注入到提示词的上下文 token 数量">
            <InputNumber min={512} max={32768} step={512} style={{ width: '100%' }} />
          </Form.Item>
        );
      case 'autoVectorizeWorldBook':
        return (
          <Form.Item name="autoVectorizeWorldBook" label="世界书自动向量化" valuePropName="checked" tooltip="创建/编辑世界书时自动向量化">
            <Switch />
          </Form.Item>
        );
      case 'autoVectorizeKnowledge':
        return (
          <Form.Item name="autoVectorizeKnowledge" label="知识库自动向量化" valuePropName="checked" tooltip="创建/编辑知识库时自动向量化">
            <Switch />
          </Form.Item>
        );
      default:
        return null;
    }
  }, []);

  const renderModeSection = useCallback(() => {
    const modeFields = MODE_FIELD_MAP[activeEmbeddingMode];

    return (
      <div key={`mode-${activeEmbeddingMode}`} style={{ transition: 'all 0.3s ease' }}>
        <Form.Item name="embeddingMode" label="Embedding 模式">
          <Select onChange={handleModeChange}>
            <Option value="remote">
              <Space>
                <CloudServerOutlined />
                <span>远程 API 模式</span>
              </Space>
            </Option>
            <Option value="local">
              <Space>
                <DesktopOutlined />
                <span>本地模型模式</span>
              </Space>
            </Option>
          </Select>
        </Form.Item>

        {modeFields.map(field => (
          field === 'localModel' ? (
            <div key={field}>
              <LocalModelSelector
                form={form}
                isDownloaded={modelDownloadStatus}
                isDownloading={modelDownloading}
                onCheckStatus={checkModelDownloadStatus}
                onDownload={handleDownloadModel}
              />
            </div>
          ) : (
            <div key={field} style={{ marginBottom: 8 }}>
              {renderField(field)}
            </div>
          )
        ))}
      </div>
    );
  }, [activeEmbeddingMode, handleModeChange, renderField, modelDownloadStatus, modelDownloading]);

  const renderCommonSection = useMemo(() => (
    <div style={{ transition: 'all 0.3s ease' }}>
      <Divider plain>存储与缓存</Divider>
      {CONFIG_GROUPS.common.fields.map(field => (
        <div key={field} style={{ marginBottom: 8 }}>
          {renderField(field)}
        </div>
      ))}
    </div>
  ), [renderField]);

  const renderRetrievalSection = useMemo(() => (
    <div style={{ transition: 'all 0.3s ease' }}>
      <Divider plain>检索参数</Divider>
      {CONFIG_GROUPS.retrieval.fields.map(field => (
        <div key={field} style={{ marginBottom: 8 }}>
          {renderField(field)}
        </div>
      ))}
    </div>
  ), [renderField]);

  const renderAutomationSection = useMemo(() => (
    <div style={{ transition: 'all 0.3s ease' }}>
      <Divider plain>自动化设置</Divider>
      {CONFIG_GROUPS.automation.fields.map(field => (
        <div key={field} style={{ marginBottom: 8 }}>
          {renderField(field)}
        </div>
      ))}
    </div>
  ), [renderField]);

  return (
    <Card
      title={
        <Space>
          <SettingOutlined />
          <span>向量模型配置</span>
        </Space>
      }
      size="small"
    >
      <Form form={form} layout="vertical" disabled={loading}>
        {renderModeSection()}

        {renderCommonSection}

        <Collapse
          ghost
          activeKey={showAdvanced ? ['advanced'] : []}
          onChange={keys => setShowAdvanced((keys as string[]).length > 0)}
          style={{ marginTop: 16 }}
        >
          <Panel header="高级配置" key="advanced">
            {renderRetrievalSection}
            {renderAutomationSection}
          </Panel>
        </Collapse>

        <Divider />

        <VectorScopeSelector />

        <Divider />

        <Form.Item>
          <Space wrap>
            <Button icon={<SyncOutlined />} onClick={handleTestConnection} loading={testConnectionLoading}>
              测试嵌入连接
            </Button>
            <Button icon={<DatabaseOutlined />} onClick={handleTestStorage} loading={testStorageLoading}>
              测试存储连接
            </Button>
            {isConnected ? (
              <Tag icon={<CheckCircleOutlined />} color="success">
                已连接 ({dimension} 维)
              </Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="error">
                未连接
              </Tag>
            )}
          </Space>
        </Form.Item>
      </Form>

      {testResultDetail && (
        <div style={{ marginTop: 16 }}>
          <Divider />
          <Alert
            message={testResultDetail.success ? '嵌入连接测试成功' : '嵌入连接测试失败'}
            description={
              <div>
                <p><strong>模式:</strong> {testResultDetail.mode === 'remote' ? '远程 API' : '本地模型'}</p>
                {testResultDetail.model && <p><strong>模型:</strong> {testResultDetail.model}</p>}
                <p><strong>向量维度:</strong> {testResultDetail.dimension || 'N/A'}</p>
                <p><strong>详细信息:</strong> {testResultDetail.details || '无'}</p>
                {testResultDetail.error && <p style={{ color: 'red' }}><strong>错误:</strong> {testResultDetail.error}</p>}
                {downloadFailed && (
                  <Alert
                    style={{ marginTop: 8 }}
                    message="模型下载失败"
                    description={
                      <div>
                        <p>本地模型需要从 HuggingFace 下载，请确保网络畅通或开启 VPN。</p>
                        <p style={{ margin: '4px 0' }}>
                          <strong>建议：</strong>
                          <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                            <li>开启 VPN 或代理后重试</li>
                            <li>设置环境变量 <code>HTTPS_PROXY=http://127.0.0.1:7890</code></li>
                            <li>或切换为远程 API 模式</li>
                          </ul>
                        </p>
                      </div>
                    }
                    type="warning"
                    showIcon
                  />
                )}
              </div>
            }
            type={testResultDetail.success ? 'success' : 'error'}
            showIcon
            closable
            onClose={() => { setTestResultDetail(null); setDownloadFailed(false); }}
          />
        </div>
      )}

      {storageTestResult && (
        <div style={{ marginTop: 16 }}>
          <Alert
            message={storageTestResult.success ? '存储连接测试成功' : '存储连接测试失败'}
            description={
              <div>
                <p><strong>存储模式:</strong> {storageTestResult.mode === 'vecstore' ? 'VecStore (vecstore-wasm)' : 'JSON'}</p>
                <p><strong>向量数量:</strong> {storageTestResult.vectorCount || 0}</p>
                {storageTestResult.storagePath && <p><strong>存储路径:</strong> {storageTestResult.storagePath}</p>}
                <p><strong>详细信息:</strong> {storageTestResult.details || '无'}</p>
                {storageTestResult.error && <p style={{ color: 'red' }}><strong>错误:</strong> {storageTestResult.error}</p>}
              </div>
            }
            type={storageTestResult.success ? 'success' : 'error'}
            showIcon
            closable
            onClose={() => setStorageTestResult(null)}
          />
        </div>
      )}
    </Card>
  );
});

VectorConfigPanel.displayName = 'VectorConfigPanel';

export { VectorConfigPanel };

const LocalModelSelector: React.FC<{
  form: any;
  isDownloaded: { [key: string]: boolean };
  isDownloading: { [key: string]: boolean };
  onCheckStatus: (modelName: string) => void;
  onDownload: (modelName: string) => void;
}> = ({ form, isDownloaded, isDownloading, onCheckStatus, onDownload }) => {
  const [selectedModel, setSelectedModel] = useState<string>('');

  useEffect(() => {
    const modelName = form.getFieldValue('localModel');
    if (modelName) {
      setSelectedModel(modelName);
      if (isDownloaded[modelName] === undefined) {
        onCheckStatus(modelName);
      }
    }
  }, [form, isDownloaded, onCheckStatus]);

  const currentDownloaded = selectedModel && isDownloaded[selectedModel] === true;
  const currentDownloading = selectedModel && isDownloading[selectedModel] === true;

  return (
    <div>
      <Form.Item
        name="localModel"
        label="本地模型名称"
        tooltip="HuggingFace 提供的轻量级嵌入模型,首次使用需下载"
        style={{ marginBottom: 8 }}
      >
        <Select
          placeholder="选择模型"
          listHeight={200}
          onChange={(value) => {
            setSelectedModel(value);
            if (value && isDownloaded[value] === undefined) {
              onCheckStatus(value);
            }
          }}
        >
          <Option value="Xenova/all-MiniLM-L6-v2">
            <div>
              <div>all-MiniLM-L6-v2 (384 维, ~80MB)</div>
              <div style={{ fontSize: 11, color: '#999' }}>英文语义搜索 · 速度快 · 体积最小</div>
              <div style={{ fontSize: 11, color: '#bbb' }}>https://huggingface.co/Xenova/all-MiniLM-L6-v2</div>
            </div>
          </Option>
          <Option value="Xenova/paraphrase-multilingual-MiniLM-L12-v2">
            <div>
              <div>paraphrase-multilingual (384 维, ~130MB)</div>
              <div style={{ fontSize: 11, color: '#999' }}>多语言支持 · 释义匹配 · 跨语言搜索</div>
              <div style={{ fontSize: 11, color: '#bbb' }}>https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2</div>
            </div>
          </Option>
          <Option value="Xenova/gte-small">
            <div>
              <div>gte-small (384 维, ~130MB)</div>
              <div style={{ fontSize: 11, color: '#999' }}>中英文双语 · 检索精度高 · 阿里通义</div>
              <div style={{ fontSize: 11, color: '#bbb' }}>https://huggingface.co/Xenova/gte-small</div>
            </div>
          </Option>
        </Select>
      </Form.Item>

      {selectedModel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Tag color={currentDownloaded ? 'green' : currentDownloading ? 'blue' : 'orange'}>
            {currentDownloaded ? '已下载' : currentDownloading ? '下载中...' : '未下载'}
          </Tag>
          {!currentDownloaded && (
            <Button
              size="small"
              type="primary"
              loading={currentDownloading}
              icon={<CloudServerOutlined />}
              onClick={() => onDownload(selectedModel)}
            >
              {currentDownloading ? '下载中' : '下载'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
