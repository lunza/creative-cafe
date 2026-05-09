import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout, Typography, Divider, Space, Button, message, Tabs, Collapse, Modal, Input, Card, Upload, Tag } from 'antd';
import {
  RocketOutlined,
  DownloadOutlined,
  EditOutlined,
  ThunderboltOutlined,
  ExportOutlined,
  SaveOutlined,
  UserOutlined,
  FolderOutlined,
  RedoOutlined,
  FormatPainterOutlined,
  PictureOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import CreativeTreeView from './CreativeTreeView';
import MarkdownEditor from '../Common/MarkdownEditor';
import { useUIStore } from '../../stores/uiStore';
import { useLogStore } from '../../stores/logStore';
import { useCreativeAI } from './hooks/useCreativeAI';
import { getCharacterTemplates, getWorldbookTemplates } from '../../utils/promptTemplates';
import { StoragePathDisplay } from '../common/StoragePathDisplay';
import { UserRequirementsInput, TemplateSelector } from './AISmartGenerate';
import { formatCharacterCardV3, downloadCharacterCardPNG, type CharacterCardV3 } from './utils/exportFormatters';
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

  const [formattedCard, setFormattedCard] = useState<CharacterCardV3 | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [characterImage, setCharacterImage] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);

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

  const handleOpenFolder = async () => {
    try {
      if (!creativeDir) return;
      await window.electronAPI.file.openFolder(creativeDir);
    } catch (error) {
      message.error('打开文件夹失败');
    }
  };

  const handleCopyPath = async () => {
    try {
      if (!creativeDir) return;
      await navigator.clipboard.writeText(creativeDir);
      message.success('路径已复制到剪贴板');
    } catch (error) {
      message.error('复制路径失败');
    }
  };

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

  const handleFormatCharacterCard = async () => {
    if (!currentCreativeId) {
      message.warning('请先选择一个创意！');
      return;
    }
    if (!isEngineConfigured) {
      message.error('请在设置中配置AI引擎');
      return;
    }

    const characterContent = currentCreative?.characterCard?.content || editingContent;
    if (!characterContent.trim()) {
      message.warning('没有可格式化的角色卡内容！');
      return;
    }

    setIsFormatting(true);
    setFormattedCard(null);

    try {
      addLog('开始格式化角色卡', 'info', {
        category: 'creative',
        context: { contentLength: characterContent.length }
      });

      // 使用customPrompt跳过模板系统，直接构建JSON格式化提示词
      const formatPrompt = `请分析以下角色卡内容，提取关键信息并按照严格的JSON格式返回。

【必须返回的JSON格式】
{
  "name": "角色名称",
  "description": "角色简要描述，50-100字",
  "personality": "性格特点，包括行为习惯、喜好等，50-100字",
  "scenario": "场景设定，角色所处的环境背景",
  "first_mes": "角色的第一条消息/开场白",
  "mes_example": "对话示例，格式如下：\\n<START>{{user}}: 你好\\n{{char}}: 你好，我是[角色名]\\n<START>{{user}}: 你是谁？\\n{{char}}: 我是[角色名]，[角色描述]",
  "creator_notes": "创作者备注",
  "system_prompt": "系统提示，用于引导AI扮演该角色",
  "post_history_instructions": "对话后指令",
  "tags": ["英文标签1", "英文标签2", "英文标签3", "英文标签4", "英文标签5"]
}

【严格要求】
1. 必须只返回JSON对象，不要返回任何其他文字
2. 所有字段都必须存在，不要省略
3. tags必须是字符串数组，生成5-10个英文关键词
4. 使用双引号包裹所有键和字符串值
5. 不要使用markdown代码块标记

【角色卡内容】
${characterContent}`;

      const result = await generate({
        creativeContent: '',  // 不使用creativeContent
        type: 'character',
        templateId: 'character_card',
        customPrompt: formatPrompt,  // 使用customPrompt跳过模板系统
        userRequirements: '',  // 不使用userRequirements
        streaming: false,
      });

      addLog('AI格式化完成，开始解析', 'info', {
        category: 'creative',
        context: { success: result.success, hasContent: !!result.data?.content }
      });

      if (result.success && result.data?.content) {
        let jsonContent = result.data.content;
        
        addLog('AI返回原始内容', 'debug', {
          category: 'creative',
          context: { length: jsonContent.length, preview: jsonContent.substring(0, 300) }
        });
        
        // 移除markdown代码块标记
        const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonContent = codeBlockMatch[1].trim();
          addLog('移除markdown代码块', 'debug', {
            category: 'creative',
            context: { jsonLength: jsonContent.length }
          });
        } else {
          // 尝试提取JSON对象
          const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonContent = jsonMatch[0];
            addLog('提取JSON对象', 'debug', {
              category: 'creative',
              context: { jsonLength: jsonContent.length }
            });
          }
        }
        
        try {
          const parsed = JSON.parse(jsonContent);
          
          addLog('JSON解析成功，检查字段', 'info', {
            category: 'creative',
            context: { 
              name: parsed.name,
              hasDescription: !!parsed.description,
              hasPersonality: !!parsed.personality,
              hasScenario: !!parsed.scenario,
              hasFirstMes: !!parsed.first_mes,
              hasMesExample: !!parsed.mes_example,
              hasTags: Array.isArray(parsed.tags),
              tagsCount: parsed.tags?.length || 0
            }
          });
          
          const card = formatCharacterCardV3(
            parsed.name || currentCreative?.characterCard?.name || 'Unknown',
            characterContent,
            Array.isArray(parsed.tags) ? parsed.tags : []
          );
          
          // 赋值所有字段到data对象
          if (parsed.description) card.data.description = parsed.description;
          if (parsed.personality) card.data.personality = parsed.personality;
          if (parsed.scenario) card.data.scenario = parsed.scenario;
          if (parsed.first_mes) card.data.first_mes = parsed.first_mes;
          if (parsed.mes_example) card.data.mes_example = parsed.mes_example;
          if (parsed.creator_notes) card.data.creator_notes = parsed.creator_notes;
          if (parsed.system_prompt) card.data.system_prompt = parsed.system_prompt;
          if (parsed.post_history_instructions) card.data.post_history_instructions = parsed.post_history_instructions;
          if (parsed.name) card.data.name = parsed.name;

          addLog('格式化结果', 'info', {
            category: 'creative',
            context: {
              name: card.data.name,
              descriptionLength: card.data.description?.length || 0,
              personalityLength: card.data.personality?.length || 0,
              tagsCount: card.data.tags?.length || 0
            }
          });

          setFormattedCard(card);
          message.success('格式化成功！');
        } catch (parseError) {
          message.error('AI返回的格式解析失败，请重试');
          addLog('解析AI返回的JSON失败', 'error', { 
            error: parseError as Error,
            content: jsonContent.substring(0, 1000)
          });
        }
      } else {
        message.error(result.error || '格式化失败');
        addLog('格式化失败', 'error', {
          category: 'creative',
          error: new Error(result.error || 'Unknown error')
        });
      }
    } catch (error) {
      message.error('格式化失败');
      addLog('格式化角色卡失败', 'error', { error: error as Error });
    } finally {
      setIsFormatting(false);
    }
  };

  const handleExportAsPNG = () => {
    if (!formattedCard) {
      message.warning('请先格式化角色卡！');
      return;
    }

    const exportName = formattedCard.name || 'character_card';
    downloadCharacterCardPNG(formattedCard, exportName, characterImage || undefined);
    message.success('PNG导出成功！');
  };

  const handleExportAndSaveToDirectory = async () => {
    if (!formattedCard) {
      message.warning('请先格式化角色卡！');
      return;
    }

    if (!characterImage) {
      message.warning('请先上传角色卡图片！');
      return;
    }

    setIsExporting(true);
    try {
      const exportName = formattedCard.name || 'character_card';
      
      // 创建canvas并绘制图片
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        message.error('无法创建canvas');
        return;
      }
      
      const img = new Image();
      img.src = characterImage;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // 转换为blob
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      
      if (!blob) {
        message.error('无法生成PNG');
        return;
      }
      
      // 转换为base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const base64Data = await base64Promise;
      
      // 调用主进程处理PNG chunks并保存到角色卡目录
      const result = await (window as any).electronAPI.character.savePNGToDirectory({
        base64Image: base64Data,
        filename: exportName,
        characterData: formattedCard
      });
      
      if (result.success) {
        message.success(`已保存到角色卡目录：${result.path}`);
        addLog('角色卡已保存到目录', 'info', {
          category: 'creative',
          context: { path: result.path, name: exportName }
        });
      } else {
        message.error(`保存失败：${result.error}`);
        addLog('保存角色卡到目录失败', 'error', {
          category: 'creative',
          error: new Error(result.error)
        });
      }
    } catch (error) {
      message.error('保存失败');
      addLog('保存角色卡到目录失败', 'error', { error: error as Error });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    setUploadingImage(true);
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setCharacterImage(result);
        message.success('图片上传成功！');
      };
      reader.onerror = () => {
        message.error('图片读取失败！');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      message.error('图片上传失败！');
    } finally {
      setUploadingImage(false);
    }
    return false;
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

  const renderExportTab = () => {
    const characterContent = currentCreative?.characterCard?.content || editingContent;
    const characterName = currentCreative?.characterCard?.name || currentCreative?.title || '未命名角色';

    return (
      <div style={{ padding: 16 }}>
        <Card title={<Title level={5}><FormatPainterOutlined /> 角色卡格式化导出</Title>} style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Text strong>当前角色卡：</Text>
              <Text>{characterName}</Text>
            </div>
            
            <div>
              <Text strong>角色卡内容：</Text>
              <div style={{ 
                marginTop: 8, 
                padding: 12, 
                backgroundColor: theme === 'dark' ? '#1f1f1f' : '#fafafa', 
                borderRadius: 4, 
                maxHeight: 200, 
                overflow: 'auto' 
              }}>
                <Text type="secondary">
                  {characterContent ? characterContent.substring(0, 500) + (characterContent.length > 500 ? '...' : '') : '暂无内容'}
                </Text>
              </div>
            </div>

            <Button
              type="primary"
              icon={<FormatPainterOutlined />}
              onClick={handleFormatCharacterCard}
              loading={isFormatting}
              disabled={!isEngineConfigured || !characterContent.trim()}
              block
              size="large"
            >
              {isFormatting ? 'AI格式化中...' : '开始格式化 (AI拆分属性)'}
            </Button>

            <Text type="secondary" style={{ fontSize: 12 }}>
              点击后，AI会将角色卡内容按照SillyTavern V3标准格式拆分为不同属性字段
            </Text>
          </Space>
        </Card>

        {formattedCard && (
          <Card title={<Title level={5}><PictureOutlined /> 格式化结果</Title>} style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                <div>
                  <Text strong>角色名称：</Text>
                  <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                    <Text>{formattedCard.data.name || '未设置'}</Text>
                  </div>
                </div>
                <div>
                  <Text strong>角色描述：</Text>
                  <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                    <Text>{formattedCard.data.description || '未设置'}</Text>
                  </div>
                </div>
                <div>
                  <Text strong>性格特点：</Text>
                  <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                    <Text>{formattedCard.data.personality || '未设置'}</Text>
                  </div>
                </div>
                <div>
                  <Text strong>场景设定：</Text>
                  <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                    <Text>{formattedCard.data.scenario || '未设置'}</Text>
                  </div>
                </div>
                <div>
                  <Text strong>第一条消息：</Text>
                  <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                    <Text>{formattedCard.data.first_mes || '未设置'}</Text>
                  </div>
                </div>
                <div>
                  <Text strong>对话示例：</Text>
                  <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                    <Text>{formattedCard.data.mes_example || '未设置'}</Text>
                  </div>
                </div>
              </div>

              <div>
                <Text strong>标签：</Text>
                <Space wrap style={{ marginTop: 8, display: 'block' }}>
                  {formattedCard.data.tags && formattedCard.data.tags.length > 0 ? (
                    formattedCard.data.tags.map((tag, index) => (
                      <Tag key={index} color="blue">{tag}</Tag>
                    ))
                  ) : (
                    <Text type="secondary">暂无标签</Text>
                  )}
                </Space>
              </div>

              <div>
                <Text strong>创作者备注：</Text>
                <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                  <Text>{formattedCard.data.creator_notes || '未设置'}</Text>
                </div>
              </div>

              <div>
                <Text strong>系统提示：</Text>
                <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                  <Text>{formattedCard.data.system_prompt || '未设置'}</Text>
                </div>
              </div>

              <div>
                <Text strong>对话后指令：</Text>
                <div style={{ marginTop: 4, padding: 8, backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f5f5f5', borderRadius: 4 }}>
                  <Text>{formattedCard.data.post_history_instructions || '未设置'}</Text>
                </div>
              </div>

              <Divider>封面图片（可选）</Divider>
              
              <Upload
                accept="image/*"
                beforeUpload={handleImageUpload}
                showUploadList={false}
                disabled={uploadingImage}
              >
                <Button icon={<PictureOutlined />} loading={uploadingImage} block>
                  {uploadingImage ? '上传中...' : '上传角色卡图片'}
                </Button>
              </Upload>

              {characterImage && (
                <div style={{ 
                  textAlign: 'center', 
                  marginTop: 8,
                  padding: 12,
                  backgroundColor: theme === 'dark' ? '#2a2a2a' : '#fafafa',
                  borderRadius: 4
                }}>
                  <img 
                    src={characterImage} 
                    alt="角色卡封面" 
                    style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 4 }}
                  />
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">图片已选择</Text>
                  </div>
                </div>
              )}

              <Divider>导出</Divider>

              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleExportAsPNG}
                block
                size="large"
              >
                导出为PNG角色卡
              </Button>

              <Button
                icon={<SaveOutlined />}
                onClick={handleExportAndSaveToDirectory}
                loading={isExporting}
                disabled={!characterImage}
                block
                size="large"
              >
                导出并保存到角色卡目录
              </Button>

              <Text type="secondary" style={{ fontSize: 12 }}>
                导出的PNG文件将包含角色卡的V3格式数据，可用于SillyTavern导入
              </Text>

              <Text type="secondary" style={{ fontSize: 12 }}>
                保存到角色卡目录会将文件保存到当前配置的角色卡目录中
              </Text>
            </Space>
          </Card>
        )}
      </div>
    );
  };

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
              <StoragePathDisplay
                label="创意存储路径"
                path={creativeDir}
                onOpenFolder={handleOpenFolder}
                onCopyPath={handleCopyPath}
              />
            )}
          </div>
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
    </Layout>
  );
};

export default CreativeManager;