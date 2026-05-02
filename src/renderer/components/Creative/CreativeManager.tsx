import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout, Typography, Divider, Space, Button, message, Tabs, Collapse, Modal, Input } from 'antd';
import {
  RocketOutlined,
  DownloadOutlined,
  UploadOutlined,
  EditOutlined,
  ThunderboltOutlined,
  ExportOutlined,
  SaveOutlined,
  UserOutlined,
  FolderOutlined,
  RedoOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditFilled
} from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import CreativeTreeView from './CreativeTreeView';
import CharacterChat from './CharacterChat';
import MarkdownEditor from '../Common/MarkdownEditor';
import { useUIStore } from '../../stores/uiStore';
import { useLogStore } from '../../stores/logStore';
import { useCreativeAI } from './hooks/useCreativeAI';
import { getCharacterTemplates, getWorldbookTemplates } from '../../utils/promptTemplates';
import { UserRequirementsInput, TemplateSelector } from './AISmartGenerate';
import './CreativeManager.css';

const { Title, Text } = Typography;
const { Sider, Content } = Layout;

const CreativeManager: React.FC = () => {
  const {
    currentCreativeId,
    currentEditorTarget,
    loadCreatives,
    exportData,
    importData,
    updateCreative
  } = useCreativeStore();

  const currentCreative = useCreativeStore(state =>
    state.creatives.find(c => c.id === state.currentCreativeId)
  );

  const theme = useUIStore(state => state.theme);
  const addLog = useLogStore(state => state.addLog);
  const { generate, isEngineConfigured } = useCreativeAI();

  const [leftSiderCollapsed, setLeftSiderCollapsed] = useState(false);
  const [rightSiderCollapsed, setRightSiderCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('edit');
  const [editingContent, setEditingContent] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateType, setGenerateType] = useState<'character' | 'worldbook'>('character');
  const [userRequirements, setUserRequirements] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('character_card');
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [saveAsType, setSaveAsType] = useState<'character' | 'worldbook'>('character');
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [creativeDir, setCreativeDir] = useState<string>('');

  const renderCountRef = useRef(0);
  const prevKeyRef = useRef<string | null>(null);

  const renderCauseRef = useRef<string>('initial');
  const lastActiveTabRef = useRef<string>('');
  if (activeTab !== lastActiveTabRef.current) {
    console.log('[CreativeManager] activeTab changed', { from: lastActiveTabRef.current, to: activeTab });
    lastActiveTabRef.current = activeTab;
  }

  renderCountRef.current += 1;

  console.log(`[CreativeManager] Render #${renderCountRef.current}`, {
    activeTab,
    currentCreativeId,
    currentEditorTarget,
    generatedContentLength: generatedContent.length,
    editingContentLength: editingContent.length,
    renderCause: renderCauseRef.current,
    callStack: new Error().stack?.split('\n').slice(2, 4).join('\n')
  });

  useEffect(() => {
    console.log('[CreativeManager] useEffect: loadCreatives triggered');
    loadCreatives();
    loadCreativeDir();
  }, [loadCreatives]);

  // 加载创意存储目录
  const loadCreativeDir = useCallback(async () => {
    try {
      const dir = await window.electronAPI.creative.getDirectory();
      setCreativeDir(dir);
    } catch (error) {
      console.error('Failed to load creative directory:', error);
    }
  }, []);

  useEffect(() => {
    console.log('[CreativeManager] useEffect: content sync triggered', {
      currentCreativeId,
      currentEditorTarget,
      prevKey: prevKeyRef.current,
      currentCreativeExists: !!currentCreative,
      currentCreativeTitle: currentCreative?.title,
      currentCreativeContentLength: currentCreative?.content?.length || 0,
      currentCreativeCharacterCard: currentCreative?.characterCard?.name || 'none',
      currentCreativeWorldBook: currentCreative?.worldBook?.name || 'none'
    });

    if (!currentCreativeId) {
      console.log('[CreativeManager] No currentCreativeId, clearing state');
      setEditingContent('');
      setEditingTitle('');
      setEditingDescription('');
      prevKeyRef.current = null;
      return;
    }

    const key = `${currentCreativeId}-${currentEditorTarget || 'none'}`;
    if (key === prevKeyRef.current) {
      console.log('[CreativeManager] Key unchanged, skipping sync');
      return;
    }

    console.log('[CreativeManager] New key detected, syncing content');

    let newContent = '';
    if (currentEditorTarget === 'character') {
      newContent = currentCreative?.characterCard?.content || '';
      console.log('[CreativeManager] Using characterCard content', { length: newContent.length });
    } else if (currentEditorTarget === 'worldbook') {
      newContent = currentCreative?.worldBook?.content || '';
      console.log('[CreativeManager] Using worldBook content', { length: newContent.length });
    } else {
      newContent = currentCreative?.content || '';
      console.log('[CreativeManager] Using creative.content', { length: newContent.length, isEmpty: newContent.trim() === '' });
    }

    console.log('[CreativeManager] Setting editing content', { 
      newContentLength: newContent.length,
      isEmpty: newContent === '',
      willSetContent: true
    });
    setEditingContent(newContent);
    setEditingTitle(currentCreative?.title || '');
    setEditingDescription(currentCreative?.description || '');

    prevKeyRef.current = key;
    console.log('[CreativeManager] Content sync complete, prevKey updated to:', key);
  }, [currentCreativeId, currentEditorTarget, currentCreative]);

  const handleExportData = async () => {
    try {
      const data = await exportData();
      if (data) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `creative-manager-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        message.success('数据导出成功');
      }
    } catch (error) {
      message.error('数据导出失败');
      addLog('导出创意数据失败', 'error', { error: error as Error });
    }
  };

  const handleImportData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        try {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const result = event.target?.result as string;
            if (result) {
              await importData(result);
              await loadCreatives();
              message.success('数据导入成功');
            }
          };
          reader.readAsText(target.files[0]);
        } catch (error) {
          message.error('数据导入失败');
          addLog('导入创意数据失败', 'error', { error: error as Error });
        }
      }
    };
    input.click();
  };

  const handleSaveCreative = async () => {
    if (!currentCreativeId) {
      message.error('请先选择或创建一个创意！');
      return;
    }
    updateCreative(currentCreativeId, {
      content: editingContent,
      title: editingTitle,
      description: editingDescription
    });
    message.success('创意内容已保存！');
  };

  const handleGenerate = async () => {
    console.log('[CreativeManager] handleGenerate called');
    if (!currentCreativeId || !editingContent.trim()) {
      message.warning('请先编辑创意内容！');
      return;
    }
    if (!isEngineConfigured) {
      message.error('请在设置中配置AI引擎');
      return;
    }
    if (!userRequirements.trim()) {
      message.warning('请输入您的需求描述！');
      return;
    }

    setIsGenerating(true);
    setGeneratedContent('');

    const result = await generate({
      creativeContent: editingContent,
      type: generateType,
      templateId: selectedTemplateId,
      userRequirements: userRequirements.trim(),
      streaming: true,
      onStream: (chunk) => {
        console.log('[CreativeManager] onStream received', { chunkLength: chunk.length });
        setGeneratedContent(prev => {
          const newContent = prev + chunk;
          console.log('[CreativeManager] setGeneratedContent updated', { newLength: newContent.length });
          return newContent;
        });
      }
    });

    console.log('[CreativeManager] Generation result', { success: result.success, error: result.error });
    setIsGenerating(false);
    if (result.success) {
      message.success('生成成功！');
    } else {
      message.error(result.error || '生成失败');
    }
  };

  const handleSaveGenerated = () => {
    if (!generatedContent.trim()) {
      message.warning('没有可保存的生成内容！');
      return;
    }
    setSaveAsType(generateType);
    setSaveName(generateType === 'character' ? '新角色卡' : '新世界书');
    setSaveDescription('由AI生成');
    setSaveModalVisible(true);
  };

  const confirmSaveGenerated = () => {
    if (!currentCreativeId || !saveName.trim()) {
      message.warning('名称不能为空！');
      return;
    }

    const store = useCreativeStore.getState();
    const isEditingCharacter = currentEditorTarget === 'character';
    const isEditingWorldBook = currentEditorTarget === 'worldbook';

    if (isEditingCharacter && saveAsType === 'character') {
      store.updateCharacterCard(currentCreativeId, { content: generatedContent, name: saveName });
      message.success('角色卡内容已更新！');
    } else if (isEditingWorldBook && saveAsType === 'worldbook') {
      store.updateWorldBook(currentCreativeId, { content: generatedContent, name: saveName });
      message.success('世界书内容已更新！');
    } else if (saveAsType === 'character') {
      store.setCharacterCard(currentCreativeId, saveName, generatedContent);
      message.success('新角色卡已创建！');
    } else {
      store.setWorldBook(currentCreativeId, saveName, generatedContent);
      message.success('新世界书已创建！');
    }

    setSaveModalVisible(false);
    loadCreatives();
  };

  const handleRegenerate = () => {
    setGeneratedContent('');
    handleGenerate();
  };

  const handleGenerateTypeChange = (type: 'character' | 'worldbook') => {
    setGenerateType(type);
    setSelectedTemplateId(type === 'character' ? 'character_card' : 'worldbook');
  };

  const handleGeneratedContentChange = useCallback((content: string) => {
    setGeneratedContent(content);
  }, []);

  const handleGeneratedContentLoad = useCallback((content: string) => {
    if (content && content.trim().length > 0) {
      setGeneratedContent(content);
      addLog('Creative: 从持久化存储加载生成结果', 'debug', {
        category: 'system',
        context: { creativeId: currentCreative?.id, contentLength: content.length }
      });
    }
  }, [currentCreative?.id, addLog]);

  const handleGeneratedContentSave = useCallback((content: string) => {
    addLog('Creative: 生成结果自动保存', 'debug', {
      category: 'system',
      context: { creativeId: currentCreative?.id, contentLength: content.length }
    });
  }, [currentCreative?.id, addLog]);

  const handleEditingContentChange = useCallback((content: string) => {
    setEditingContent(content);
  }, []);

  const characterTemplates = getCharacterTemplates();
  const worldbookTemplates = getWorldbookTemplates();

  const renderEditTab = () => (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>创意标题</Text>
        <Input
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          placeholder="请输入创意标题"
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>创意描述</Text>
        <Input.TextArea
          value={editingDescription}
          onChange={(e) => setEditingDescription(e.target.value)}
          placeholder="请输入创意描述"
          rows={3}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          创意内容
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            （在此处输入您的完整创意，角色卡和世界书将基于此内容生成）
          </Text>
        </Text>
        <MarkdownEditor
          value={editingContent}
          onChange={handleEditingContentChange}
          minHeight={400}
          theme={theme}
          enableAITools={true}
          enableSave={true}
          storageKey={`creative_content_${currentCreative?.id || 'default'}`}
          placeholder="在此输入您的创意详情..."
        />
      </div>
      <Button type="primary" icon={<RocketOutlined />} onClick={handleSaveCreative} style={{ marginTop: 16 }}>
        保存创意
      </Button>
    </div>
  );

  const renderGenerateTab = () => {
    const currentTemplates = generateType === 'character' ? characterTemplates : worldbookTemplates;

    if (!currentCreative) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Text type="secondary">请先在左侧选择一个创意</Text>
        </div>
      );
    }

    return (
      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 20 }}>
          <Text strong>生成类型：</Text>
          <Space style={{ marginTop: 8, marginLeft: 12 }}>
            <Button
              type={generateType === 'character' ? 'primary' : 'default'}
              icon={<UserOutlined />}
              onClick={() => handleGenerateTypeChange('character')}
            >
              角色卡
            </Button>
            <Button
              type={generateType === 'worldbook' ? 'primary' : 'default'}
              icon={<FolderOutlined />}
              onClick={() => handleGenerateTypeChange('worldbook')}
            >
              世界书
            </Button>
          </Space>
        </div>

        <div style={{ marginBottom: 20 }}>
          <TemplateSelector
            templates={currentTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            theme={theme}
          />
        </div>

        {currentEditorTarget && (
          <Collapse
            defaultActiveKey={['1']}
            style={{ marginBottom: 20 }}
            items={[{
              key: '1',
              label: <Text strong>{currentEditorTarget === 'character' ? '角色卡' : '世界书'}内容预览</Text>,
              children: (() => {
                const cardContent = currentEditorTarget === 'character'
                  ? currentCreative?.characterCard?.content || ''
                  : '';
                return (
                  <div style={{
                    padding: 12,
                    backgroundColor: theme === 'dark' ? '#1f1f1f' : '#fafafa',
                    borderRadius: 4,
                    maxHeight: 150,
                    overflow: 'auto',
                  }}>
                    <Text type="secondary">{cardContent || editingContent || '暂无内容'}</Text>
                  </div>
                );
              })()
            }]}
          />
        )}

        <div style={{ marginBottom: 20 }}>
          <UserRequirementsInput
            value={userRequirements}
            onChange={setUserRequirements}
            generateType={generateType}
          />
        </div>

        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleGenerate}
          loading={isGenerating}
          disabled={!isEngineConfigured || !userRequirements.trim()}
          block
          size="large"
          style={{ marginBottom: 24 }}
        >
          {isGenerating ? '生成中...' : '开始生成'}
        </Button>

        <Divider>生成结果</Divider>
        <MarkdownEditor
          key={currentEditorTarget || 'none'}
          value={generatedContent}
          onChange={handleGeneratedContentChange}
          minHeight={300}
          theme={theme}
          enableAITools={true}
          enableSave={false}
          onLoad={handleGeneratedContentLoad}
          onSave={handleGeneratedContentSave}
          placeholder="生成结果将显示在这里..."
        />
        {generatedContent && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button
              icon={<RedoOutlined />}
              onClick={handleRegenerate}
              loading={isGenerating}
            >
              重新生成
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveGenerated}
            >
              保存为{generateType === 'character' ? '角色卡' : '世界书'}
            </Button>
          </div>
        )}

        <Modal
          title={`保存为${saveAsType === 'character' ? '角色卡' : '世界书'}`}
          open={saveModalVisible}
          onOk={confirmSaveGenerated}
          onCancel={() => setSaveModalVisible(false)}
          okText="保存"
          cancelText="取消"
        >
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>名称</Text>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="请输入名称"
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>描述</Text>
              <Input.TextArea
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="请输入描述（可选）"
                rows={3}
              />
            </div>
          </div>
        </Modal>
      </div>
    );
  };

  const renderExportTab = () => (
    <div style={{ padding: 16 }}>
      <Title level={5}>导出选项</Title>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button icon={<DownloadOutlined />} onClick={handleExportData} block size="large">
          导出所有数据 (JSON)
        </Button>
        <Button icon={<UploadOutlined />} onClick={handleImportData} block size="large">
          导入数据 (JSON)
        </Button>
        <Divider />
        <Text type="secondary">
          角色卡V3导出和世界书JSON导出功能将在后续版本中提供。
        </Text>
      </Space>
    </div>
  );

  const tabItems = [
    { key: 'edit', label: <><EditOutlined /> 创意编辑</>, children: renderEditTab() },
    { key: 'generate', label: <><ThunderboltOutlined /> 智能生成</>, children: renderGenerateTab() },
    { key: 'export', label: <><ExportOutlined /> 导出</>, children: renderExportTab() },
  ];

  return (
    <Layout className="creative-manager-layout" style={{ height: '100%' }}>
      <Sider
        width={leftSiderCollapsed ? 48 : 300}
        collapsed={leftSiderCollapsed}
        collapsible
        onCollapse={setLeftSiderCollapsed}
        theme={theme === 'dark' ? 'dark' : 'light'}
        className="creative-manager-sider-left"
      >
        <CreativeTreeView />
      </Sider>

      <Layout className="creative-manager-content">
        <div className="creative-manager-header">
          <div>
            <Title level={3} style={{ margin: 0 }}>
              <RocketOutlined style={{ marginRight: 8 }} /> 创意管理
            </Title>
            <Text type="secondary">
              基于已连接的大模型，智能生成和优化角色卡与世界书内容
            </Text>
            {creativeDir && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  存储路径: <Text copyable style={{ fontSize: 12 }}>{creativeDir}</Text>
                </Text>
              </div>
            )}
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExportData}>导出</Button>
            <Button icon={<UploadOutlined />} onClick={handleImportData}>导入</Button>
          </Space>
        </div>

        <Content className="creative-manager-body">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            destroyInactiveTabPane
            style={{ height: '100%' }}
            tabBarStyle={{ marginBottom: 0 }}
          />
        </Content>
      </Layout>

      {currentEditorTarget === 'character' && (
        <Sider
          width={rightSiderCollapsed ? 0 : 500}
          collapsed={rightSiderCollapsed}
          collapsible
          onCollapse={setRightSiderCollapsed}
          theme={theme === 'dark' ? 'dark' : 'light'}
          className="creative-manager-sider-right"
          style={{ overflow: 'hidden' }}
        >
          {currentCreativeId && (
            <CharacterChat
              creativeId={currentCreativeId}
              characterCardName={currentCreative?.characterCard?.name || '角色卡'}
              characterCardContent={currentCreative?.characterCard?.content || ''}
              chatType="test"
            />
          )}
        </Sider>
      )}
    </Layout>
  );
};

export default CreativeManager;