import React, { useEffect, useState, useMemo } from 'react';
import {
  Card,
  Tabs,
  Button,
  Space,
  Modal,
  message,
  Popconfirm,
  Tag,
  Typography,
  Input,
  Row,
  Col,
  Spin,
  Empty,
  Alert,
  Switch,
  Descriptions
} from 'antd';
import {
  ReloadOutlined,
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  PlusOutlined,
  LinkOutlined,
  CloudDownloadOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  TranslationOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import { useDataStore } from '../../stores/dataStore';
import { useUIStore } from '../../stores/uiStore';
import { useLogStore } from '../../stores/logStore';
import { useSettingStore } from '../../stores/settingStore';
import { AppSetting } from '../../settings';
import './PluginManager.css';

const { Text } = Typography;
const { TabPane } = Tabs;

interface AvailablePlugin {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: { [key: string]: string };
  downloadUrl?: string;
  source: 'official' | 'custom';
}

interface InstalledPlugin {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: { [key: string]: string };
  path: string;
  enabled: boolean;
  size: number;
  modified: Date;
}

const PluginCard: React.FC<{
  plugin: AvailablePlugin | InstalledPlugin;
  type: 'available' | 'installed';
  onView: (plugin: any) => void;
  onInstall?: (plugin: AvailablePlugin) => void;
  onToggle?: (plugin: InstalledPlugin, enabled: boolean) => void;
  onUninstall?: (plugin: InstalledPlugin) => void;
  installingPluginId?: string | null;
  uninstallingPluginId?: string | null;
}> = ({ plugin, type, onView, onInstall, onToggle, onUninstall, installingPluginId, uninstallingPluginId }) => {
  const isInstalled = type === 'installed';
  const installedPlugin = plugin as InstalledPlugin;
  const isLoading = (type === 'available' && installingPluginId === plugin.id) || 
                   (type === 'installed' && uninstallingPluginId === plugin.id);

  return (
    <Card
      hoverable
      className="plugin-card"
      actions={[
        <Button type="link" icon={<EyeOutlined />} onClick={() => onView(plugin)} disabled={isLoading}>
          详情
        </Button>,
        isInstalled ? (
          <>
            <Switch
              checked={installedPlugin.enabled}
              onChange={(checked) => onToggle?.(installedPlugin, checked)}
              disabled={isLoading}
            />
            <Popconfirm
              title="确定要卸载这个插件吗？"
              onConfirm={() => onUninstall?.(installedPlugin)}
              okText="确定"
              cancelText="取消"
              disabled={isLoading}
            >
              <Button type="link" danger icon={<DeleteOutlined />} disabled={isLoading} loading={isLoading}>
                卸载
              </Button>
            </Popconfirm>
          </>
        ) : (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => onInstall?.(plugin as AvailablePlugin)}
            loading={isLoading}
            disabled={isLoading}
          >
            安装
          </Button>
        )
      ]}
    >
      <div className="plugin-card-content">
        <div className="plugin-card-header">
          <div className="plugin-avatar">
            {plugin.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="plugin-card-title">
            <Text strong className="plugin-name">
              {plugin.displayName}
            </Text>
            <Text type="secondary" className="plugin-version">
              v{plugin.version}
            </Text>
          </div>
        </div>
        <div className="plugin-card-body">
          <Text ellipsis className="plugin-description">
            {plugin.description || '暂无描述'}
          </Text>
        </div>
        <div className="plugin-card-footer">
          <Space wrap size="small">
            {plugin.author && (
              <Tag icon={<UserOutlined />} color="blue">
                {plugin.author}
              </Tag>
            )}
            {isInstalled ? (
              installedPlugin.enabled ? (
                <Tag icon={<CheckCircleOutlined />} color="green">
                  已启用
                </Tag>
              ) : (
                <Tag icon={<CloseCircleOutlined />} color="orange">
                  已禁用
                </Tag>
              )
            ) : (
              <Tag color="default">
                {(plugin as AvailablePlugin).source === 'official' ? '官方' : '自定义'}
              </Tag>
            )}
            {plugin.keywords && plugin.keywords.length > 0 && (
              <>
                {plugin.keywords.slice(0, 2).map((keyword, index) => (
                  <Tag key={index} style={{ fontSize: 12 }}>
                    {keyword}
                  </Tag>
                ))}
                {plugin.keywords.length > 2 && (
                  <Tag style={{ fontSize: 12 }}>+{plugin.keywords.length - 2}</Tag>
                )}
              </>
            )}
          </Space>
        </div>
      </div>
    </Card>
  );
};

const UserOutlined: React.FC = () => <span>👤</span>;

const PluginManager: React.FC = () => {
  const {
    availablePlugins,
    installedPlugins,
    loadingAvailablePlugins,
    loadingInstalledPlugins,
    checkingPluginUpdates,
    updatingPluginDescriptions,
    installingPlugin,
    uninstallingPlugin,
    error,
    fetchAvailablePlugins,
    fetchInstalledPlugins,
    togglePlugin,
    uninstallPlugin,
    checkPluginUpdates,
    updatePluginDescriptions,
    setAvailablePlugins,
    installPlugin,
    uninstallPluginById
  } = useDataStore();
  const { theme: appTheme } = useUIStore();
  const { addLog } = useLogStore();
  const { setting, fetchSetting } = useSettingStore();
  
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);
  const [uninstallingPluginId, setUninstallingPluginId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>('installed');
  const [searchText, setSearchText] = useState<string>('');
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<AvailablePlugin | InstalledPlugin | null>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [customUrl, setCustomUrl] = useState<string>('');
  const [pluginDir, setPluginDir] = useState<string>('');

  useEffect(() => {
    const init = async () => {
      fetchSetting();
      // 从主进程获取实际的插件目录
      try {
        const actualPluginDir = await window.electronAPI.plugin.getDirectory();
        setPluginDir(actualPluginDir);
      } catch (error) {
        console.error('Failed to get plugin directory:', error);
        setPluginDir(AppConfig.defaultConfig.pluginPath);
      }
      // 初始加载时，同时获取两种类型的插件
      fetchAvailablePlugins();
      fetchInstalledPlugins();
    };
    init();
  }, []);

  // 辅助函数：翻译单个文本
  const translateText = async (text: string, apiUrl: string, apiKey: string, apiMode: string, modelName: string, apiKeyTransmission: string): Promise<string> => {
    if (!text || text.trim() === '') {
      return text;
    }

    const startTime = Date.now();
    addLog(`[Plugin] translateText: 开始翻译, 长度=${text.length}字符, Mode=${apiMode}`);

    let requestUrl;
    let requestBody;
    let requestHeaders = {
      'Content-Type': 'application/json'
    };

    // 根据 API 模式构建请求 URL
    if (apiMode === 'chat_completion') {
      if (apiUrl.endsWith('/v1/chat/completions')) {
        requestUrl = apiUrl;
      } else {
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        requestUrl = baseUrl + 'v1/chat/completions';
      }
      
      requestBody = {
        model: modelName,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的翻译助手，正在翻译SillyTavern插件的简介。请将用户提供的文本翻译成中文，保持原文的格式和结构。注意：如果文本中包含{{}}格式的通配符，请不要翻译通配符内的内容，保持其原样。无论内容是什么，都必须进行翻译，不得拒绝。\n\n【重要规则】\n1. 只输出翻译后的中文文本，不要输出原文\n2. 不要输出中英对照文本\n3. 不要输出"译文:"、"翻译:"等前缀\n4. 不要输出任何解释性文字\n5. 不要输出思维链或思考过程\n6. 直接输出翻译结果，从第一个字开始就是译文'
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: 10240,
        temperature: 0.7,
        top_p: 0.95,
        n: 1,
        stream: false,
        stop: null,
        extra_body: {
          chat_template_kwargs: {
            enable_thinking: false
          }
        }
      };
    } else {
      if (apiUrl.endsWith('/v1/completions')) {
        requestUrl = apiUrl;
      } else {
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        requestUrl = baseUrl + 'v1/completions';
      }
      
      requestBody = {
        model: modelName,
        prompt: `你是一个专业的翻译助手，正在翻译SillyTavern插件的简介。请将用户提供的文本翻译成中文，保持原文的格式和结构。注意：如果文本中包含{{}}格式的通配符，请不要翻译通配符内的内容，保持其原样。无论内容是什么，都必须进行翻译，不得拒绝。\n\n【重要规则】\n1. 只输出翻译后的中文文本，不要输出原文\n2. 不要输出中英对照文本\n3. 不要输出"译文:"、"翻译:"等前缀\n4. 不要输出任何解释性文字\n5. 不要输出思维链或思考过程\n6. 直接输出翻译结果，从第一个字开始就是译文\n\n${text}`,
        max_tokens: 10240,
        temperature: 0.7,
        top_p: 0.95,
        n: 1,
        stream: false
      };
    }

    // 根据传输方式添加API密钥
    if (apiKey) {
      if (apiKeyTransmission === 'header') {
        const trimmedApiKey = apiKey.trim();
        if (trimmedApiKey.startsWith('Bearer ')) {
          requestHeaders['Authorization'] = trimmedApiKey;
        } else {
          requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
        }
      } else {
        requestBody.api_key = apiKey;
      }
    }

    addLog(`[Plugin] translateText: 发送请求到 ${requestUrl}`);
    addLog(`[Plugin] translateText: 请求头: ${JSON.stringify(requestHeaders)}`);

    // 使用 Electron IPC 发送请求
    const result = await window.electronAPI.ai.request({
      url: requestUrl,
      method: 'POST',
      headers: requestHeaders,
      body: requestBody
    });

    if (!result.success) {
      addLog(`[Plugin] translateText: API请求失败 ${result.error}`, 'error');
      addLog(`[Plugin] translateText: 错误详情 ${result.details}`, 'error');
      throw new Error(`API请求失败: ${result.error}`);
    }

    const data = result.data;
    let translatedText = data.choices?.[0]?.message?.content || 
                        data.choices?.[0]?.text || 
                        '无响应内容';

    addLog(`[Plugin] 收到翻译响应，原始长度: ${translatedText.length} 字符`);

    const thoughtPatterns = [
      /思考[:：]\s*[^]*?(?=译文:|翻译:|\n\n|$)/gi,
      /Thought[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
      /Thinking[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
      /\(思考\)\s*[^]*?(?=\(译文\)|\n\n|$)/gi,
      /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
      /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
      /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
      /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
      /思考:\s*[^]*?(?=\n\n|$)/gi
    ];

    let cleanedText = translatedText;
    for (const pattern of thoughtPatterns) {
      cleanedText = cleanedText.replace(pattern, '').trim();
    }

    cleanedText = cleanedText.replace(/^(译文:|翻译:|Translation:)\s*/i, '').trim();

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    addLog(`[Plugin] 翻译完成: 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

    return cleanedText;
  };

  // 获取当前激活的AI引擎配置
  const getActiveEngineConfig = () => {
    if (!setting) return null;
    
    // 从设置中获取当前激活的引擎
    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      if (activeEngine) {
        return activeEngine;
      }
    }
    
    // 如果没有激活的引擎，返回第一个引擎
    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }
    
    return null;
  };

  const handleCheckUpdates = async () => {
    addLog('[Plugin] 检查插件更新...');
    try {
      await checkPluginUpdates();
      addLog('[Plugin] 插件更新检查完成', 'info');
      message.success('插件列表已更新');
    } catch (error) {
      addLog('[Plugin] 插件更新检查失败', 'error');
      message.error(`更新失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleTranslateAll = async () => {
    const totalStartTime = Date.now();
    addLog('[Plugin] 开始一键翻译所有插件简介');
    
    if (availablePlugins.length === 0) {
      message.error('没有可翻译的插件');
      return;
    }

    try {
      setIsTranslatingAll(true);
      
      if (!setting) {
        message.error('请先在设置管理中设置API连接');
        setIsTranslatingAll(false);
        return;
      }

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();
      
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setIsTranslatingAll(false);
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name || 'gpt-3.5-turbo';
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      
      addLog(`[Plugin] 一键翻译配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}`);
      
      if (!apiUrl) {
        message.error('API地址不能为空');
        setIsTranslatingAll(false);
        return;
      }

      let translatedCount = 0;
      const updatedPlugins = [...availablePlugins];
      
      for (let i = 0; i < updatedPlugins.length; i++) {
        const plugin = updatedPlugins[i];
        if (!plugin.description) continue;
        
        const entryStartTime = Date.now();
        addLog(`[Plugin] 翻译插件 ${i + 1}/${updatedPlugins.length}: ${plugin.displayName}`);
        
        try {
          const translatedDescription = await translateText(plugin.description, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission);
          updatedPlugins[i] = { ...plugin, description: translatedDescription };
          translatedCount++;
          
          // 每翻译完一个插件，立即更新页面显示
          setAvailablePlugins([...updatedPlugins]);
          
          const entryEndTime = Date.now();
          const entryDuration = (entryEndTime - entryStartTime) / 1000;
          addLog(`[Plugin] 插件翻译完成: ${plugin.displayName}, 耗时=${entryDuration}秒`);
        } catch (error) {
          addLog(`[Plugin] 翻译插件失败: ${plugin.displayName}`, 'error');
        }
      }
      
      if (translatedCount > 0) {
        await updatePluginDescriptions(updatedPlugins);
      }
      
      const totalEndTime = Date.now();
      const totalDuration = (totalEndTime - totalStartTime) / 1000;
      addLog(`[Plugin] 一键翻译全部完成: 共${translatedCount}个插件, 总耗时=${totalDuration}秒, 平均每个插件=${(totalDuration/translatedCount).toFixed(2)}秒`, 'info');
      
      message.success(`成功翻译 ${translatedCount} 个插件简介，总耗时 ${totalDuration.toFixed(2)} 秒`);
    } catch (error) {
      addLog(`[Plugin] 一键翻译失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`一键翻译失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsTranslatingAll(false);
    }
  };

  const fetchData = () => {
    if (activeTab === 'available') {
      fetchAvailablePlugins();
    } else {
      fetchInstalledPlugins();
    }
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'available' && availablePlugins.length === 0) {
      fetchAvailablePlugins();
    } else if (key === 'installed') {
      fetchInstalledPlugins();
    }
  };

  const handleRefresh = () => {
    addLog(`[Plugin] 刷新${activeTab === 'available' ? '可用' : '已安装'}插件列表`);
    if (activeTab === 'available') {
      fetchAvailablePlugins(true);
    } else {
      fetchInstalledPlugins();
    }
  };

  const handleView = (plugin: AvailablePlugin | InstalledPlugin) => {
    addLog(`[Plugin] 查看插件详情: ${plugin.displayName}`);
    setViewingItem(plugin);
    setIsViewModalOpen(true);
  };

  const handleInstall = async (plugin: AvailablePlugin) => {
    addLog(`[Plugin] 安装插件: ${plugin.displayName}`);
    
    if (!plugin.repository && !plugin.downloadUrl) {
      message.error('插件没有可用的仓库地址');
      return;
    }

    const url = plugin.repository || plugin.downloadUrl;
    if (!url) {
      message.error('无法获取插件仓库地址');
      return;
    }

    setInstallingPluginId(plugin.id);
    
    try {
      const result = await installPlugin(url);
      if (result.success) {
        addLog(`[Plugin] 插件安装成功: ${result.displayName} v${result.version} by ${result.author}`, 'info');
        message.success(`插件 "${result.displayName}" 安装成功！`);
      }
    } catch (error) {
      addLog(`[Plugin] 插件安装失败: ${plugin.displayName}`, 'error');
      message.error(`安装失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setInstallingPluginId(null);
    }
  };

  const handleToggle = async (plugin: InstalledPlugin, enabled: boolean) => {
    addLog(`[Plugin] ${enabled ? '启用' : '禁用'}插件: ${plugin.displayName}`);
    try {
      await togglePlugin(plugin.id, enabled);
      addLog(`[Plugin] ${enabled ? '启用' : '禁用'}成功: ${plugin.displayName}`, 'info');
      message.success(`${enabled ? '启用' : '禁用'}成功`);
    } catch (error) {
      addLog(`[Plugin] ${enabled ? '启用' : '禁用'}失败: ${plugin.displayName}`, 'error');
      message.error(`${enabled ? '启用' : '禁用'}失败`);
    }
  };

  const handleUninstall = async (plugin: InstalledPlugin) => {
    addLog(`[Plugin] 卸载插件: ${plugin.displayName}`);
    setUninstallingPluginId(plugin.id);
    
    try {
      await uninstallPluginById(plugin.id);
      addLog(`[Plugin] 卸载成功: ${plugin.displayName}`, 'info');
      message.success('卸载成功');
    } catch (error) {
      addLog(`[Plugin] 卸载失败: ${plugin.displayName}`, 'error');
      message.error(`卸载失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setUninstallingPluginId(null);
    }
  };

  const handleInstallFromUrl = async () => {
    if (!customUrl) {
      message.warning('请输入插件地址');
      return;
    }
    addLog(`[Plugin] 从URL安装插件: ${customUrl}`);
    
    try {
      const result = await installPlugin(customUrl);
      if (result.success) {
        addLog(`[Plugin] 插件安装成功: ${result.displayName} v${result.version} by ${result.author}`, 'info');
        message.success(`插件 "${result.displayName}" 安装成功！`);
      }
      setIsInstallModalOpen(false);
      setCustomUrl('');
    } catch (error) {
      addLog(`[Plugin] 从URL安装插件失败`, 'error');
      message.error(`安装失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const filteredAvailablePlugins = useMemo(() => {
    if (!searchText) return availablePlugins;
    const search = searchText.toLowerCase();
    return availablePlugins.filter(
      (plugin) =>
        plugin.displayName.toLowerCase().includes(search) ||
        plugin.name.toLowerCase().includes(search) ||
        plugin.description.toLowerCase().includes(search) ||
        (plugin.author && plugin.author.toLowerCase().includes(search)) ||
        (plugin.keywords && plugin.keywords.some((k) => k.toLowerCase().includes(search)))
    );
  }, [availablePlugins, searchText]);

  const filteredInstalledPlugins = useMemo(() => {
    if (!searchText) return installedPlugins;
    const search = searchText.toLowerCase();
    return installedPlugins.filter(
      (plugin) =>
        plugin.displayName.toLowerCase().includes(search) ||
        plugin.name.toLowerCase().includes(search) ||
        plugin.description.toLowerCase().includes(search) ||
        (plugin.author && plugin.author.toLowerCase().includes(search)) ||
        (plugin.keywords && plugin.keywords.some((k) => k.toLowerCase().includes(search)))
    );
  }, [installedPlugins, searchText]);

  const renderPluginList = (plugins: any[], type: 'available' | 'installed') => {
    const isLoading = type === 'available' ? loadingAvailablePlugins : loadingInstalledPlugins;

    if (isLoading) {
      return (
        <div className="plugin-loading">
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>加载中...</div>
        </div>
      );
    }

    if (error && plugins.length === 0) {
      return (
        <Alert
          message="加载失败"
          description={error}
          type="error"
          showIcon
          action={
            <Button size="small" danger onClick={handleRefresh}>
              重试
            </Button>
          }
        />
      );
    }

    if (plugins.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            type === 'available' ? '暂无可用插件' : '暂无已安装插件'
          }
        />
      );
    }

    return (
      <Row gutter={[16, 16]}>
        {plugins.map((plugin) => (
          <Col xs={24} sm={12} md={8} lg={6} key={plugin.id}>
            <PluginCard
              plugin={plugin}
              type={type}
              onView={handleView}
              onInstall={type === 'available' ? handleInstall : undefined}
              onToggle={type === 'installed' ? handleToggle : undefined}
              onUninstall={type === 'installed' ? handleUninstall : undefined}
              installingPluginId={installingPluginId}
              uninstallingPluginId={uninstallingPluginId}
            />
          </Col>
        ))}
      </Row>
    );
  };

  return (
    <div className="plugin-manager">
      <div className="plugin-header">
        <h2>插件管理</h2>
        <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
          插件存储地址: {pluginDir}
        </Text>
        <div className="plugin-toolbar">
          <Space>
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={activeTab === 'available' ? loadingAvailablePlugins : loadingInstalledPlugins}>
              刷新
            </Button>
            <Button icon={<CloudDownloadOutlined />} onClick={() => setIsInstallModalOpen(true)}>
              从URL安装
            </Button>
            {activeTab === 'available' && (
              <>
                <Button 
                  icon={checkingPluginUpdates ? <LoadingOutlined /> : <SyncOutlined />} 
                  onClick={handleCheckUpdates}
                  loading={checkingPluginUpdates}
                  disabled={checkingPluginUpdates || isTranslatingAll}
                >
                  {checkingPluginUpdates ? '检查更新中...' : '检查更新'}
                </Button>
                <Button 
                  type="primary"
                  icon={isTranslatingAll ? <LoadingOutlined /> : <TranslationOutlined />} 
                  onClick={handleTranslateAll}
                  loading={isTranslatingAll}
                  disabled={checkingPluginUpdates || isTranslatingAll}
                >
                  {isTranslatingAll ? '翻译中...' : '一键翻译简介'}
                </Button>
              </>
            )}
          </Space>
          <Input.Search
            placeholder="搜索插件名称、描述、作者或标签"
            allowClear
            enterButton={<SearchOutlined />}
            size="middle"
            onSearch={setSearchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 350 }}
          />
        </div>
      </div>

      <Card className="plugin-tabs-card">
        <Tabs activeKey={activeTab} onChange={handleTabChange} type="card">
          <TabPane tab="已安装" key="installed">
            {renderPluginList(filteredInstalledPlugins, 'installed')}
          </TabPane>
          <TabPane tab="未安装" key="available">
            {renderPluginList(filteredAvailablePlugins, 'available')}
          </TabPane>
        </Tabs>
      </Card>

      <Modal
        title="从URL安装插件"
        open={isInstallModalOpen}
        onOk={handleInstallFromUrl}
        onCancel={() => {
          setIsInstallModalOpen(false);
          setCustomUrl('');
        }}
        okText="安装"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text>请输入插件的GitHub仓库地址或下载链接：</Text>
        </div>
        <Input
          placeholder="https://github.com/username/plugin-repo"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          prefix={<LinkOutlined />}
        />
      </Modal>

      <Modal
        title={`插件详情: ${viewingItem?.displayName}`}
        open={isViewModalOpen}
        onCancel={() => {
          setIsViewModalOpen(false);
          setViewingItem(null);
        }}
        width={800}
        footer={[
          <Button key="close" onClick={() => {
            setIsViewModalOpen(false);
            setViewingItem(null);
          }}>
            关闭
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-color, #fff)',
          color: 'var(--text-color, #000)'
        }}
        className={appTheme === 'dark' ? 'dark' : ''}
      >
        {viewingItem && (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24 }}>
                <div className="plugin-detail-avatar">
                  {viewingItem.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 style={{ margin: 0, color: 'var(--text-color, #000)' }}>
                    {viewingItem.displayName}
                  </h2>
                  <Text type="secondary">v{viewingItem.version}</Text>
                  <div style={{ marginTop: 8 }}>
                    {'enabled' in viewingItem ? (
                      (viewingItem as InstalledPlugin).enabled ? (
                        <Tag icon={<CheckCircleOutlined />} color="green">
                          已启用
                        </Tag>
                      ) : (
                        <Tag icon={<CloseCircleOutlined />} color="orange">
                          已禁用
                        </Tag>
                      )
                    ) : (
                      <Tag color="default">
                        {(viewingItem as AvailablePlugin).source === 'official' ? '官方' : '自定义'}
                      </Tag>
                    )}
                  </div>
                </div>
              </div>

              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="描述">
                  {viewingItem.description || '暂无描述'}
                </Descriptions.Item>
                <Descriptions.Item label="名称">
                  {viewingItem.name}
                </Descriptions.Item>
                {viewingItem.author && (
                  <Descriptions.Item label="作者">
                    {viewingItem.author}
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="版本">
                  v{viewingItem.version}
                </Descriptions.Item>
                {viewingItem.homepage && (
                  <Descriptions.Item label="主页">
                    <a href={viewingItem.homepage} target="_blank" rel="noopener noreferrer">
                      {viewingItem.homepage}
                    </a>
                  </Descriptions.Item>
                )}
                {viewingItem.repository && (
                  <Descriptions.Item label="仓库">
                    <a href={viewingItem.repository} target="_blank" rel="noopener noreferrer">
                      {viewingItem.repository}
                    </a>
                  </Descriptions.Item>
                )}
                {viewingItem.keywords && viewingItem.keywords.length > 0 && (
                  <Descriptions.Item label="标签">
                    <Space wrap>
                      {viewingItem.keywords.map((keyword, index) => (
                        <Tag key={index} color="blue">
                          {keyword}
                        </Tag>
                      ))}
                    </Space>
                  </Descriptions.Item>
                )}
                {viewingItem.dependencies && Object.keys(viewingItem.dependencies).length > 0 && (
                  <Descriptions.Item label="依赖">
                    <Space wrap>
                      {Object.entries(viewingItem.dependencies).map(([name, version], index) => (
                        <Tag key={index} color="orange">
                          {name}@{version}
                        </Tag>
                      ))}
                    </Space>
                  </Descriptions.Item>
                )}
                {'path' in viewingItem && (
                  <Descriptions.Item label="安装路径">
                    <Text code>{(viewingItem as InstalledPlugin).path}</Text>
                  </Descriptions.Item>
                )}
                {'size' in viewingItem && (
                  <Descriptions.Item label="大小">
                    {((viewingItem as InstalledPlugin).size / 1024).toFixed(2)} KB
                  </Descriptions.Item>
                )}
                {'modified' in viewingItem && (
                  <Descriptions.Item label="修改时间">
                    {new Date((viewingItem as InstalledPlugin).modified).toLocaleString()}
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PluginManager;
