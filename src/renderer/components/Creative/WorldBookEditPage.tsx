import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Breadcrumb, Button, Typography, message, Modal, Space, Select, Input, Spin } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, RobotOutlined, FileTextOutlined, DownloadOutlined, UploadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';
import type { CreativeTabType } from '../../stores/uiStore';
import TextEditor from '../Common/TextEditor';
import type { TextEditorHandle } from '../Common/TextEditor';
import { useCreativeAI } from './hooks/useCreativeAI';
import type { WorldBookExport } from '../../types/worldBook';

const { Title, Text } = Typography;
const { TextArea } = Input;

const WorldBookEditPage: React.FC = () => {
  const currentCreativeId = useCreativeStore(s => s.currentCreativeId);
  const creatives = useCreativeStore(s => s.creatives);
  const updateWorldBook = useCreativeStore(s => s.updateWorldBook);
  const loadCreatives = useCreativeStore(s => s.loadCreatives);
  const theme = useUIStore(s => s.theme);
  const setCreativeTab = useUIStore(s => s.setCreativeTab);
  const setCreativeView = useUIStore(s => s.setCreativeView);
  const { generate } = useCreativeAI();
  const editorRef = useRef<TextEditorHandle>(null);

  const [editingContent, setEditingContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [userRequirements, setUserRequirements] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState('');
  const [hasGeneratedContent, setHasGeneratedContent] = useState(false);
  
  // 导出相关状态
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [formattedJson, setFormattedJson] = useState<string | null>(null);
  const [exportName, setExportName] = useState('');
  const [previewMode, setPreviewMode] = useState<'json' | 'formatted'>('json');
  const [minWordCount, setMinWordCount] = useState(1000);
  const [maxWordCount, setMaxWordCount] = useState(3000);

  const creative = currentCreativeId ? creatives.find(c => c.id === currentCreativeId) : null;
  const worldBook = creative?.worldBook;

  useEffect(() => {
    loadCreatives();
  }, []);

  useEffect(() => {
    if (worldBook?.content) {
      setEditingContent(worldBook.content);
    } else {
      setEditingContent('');
    }
  }, [worldBook?.content]);

  const handleSave = useCallback(async () => {
    if (!currentCreativeId || !worldBook) return;

    const content = editorRef.current?.getMarkdown?.() || editingContent;
    setIsSaving(true);
    try {
      updateWorldBook(currentCreativeId, { content });
      message.success('世界书内容已保存');
    } catch (error) {
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [currentCreativeId, worldBook, editingContent, updateWorldBook]);

  const handleBack = () => {
    setCreativeTab('worldbook');
    setCreativeView('list');
  };

  const handleAiGenerate = useCallback(async () => {
    if (!creative) return;

    setIsGenerating(true);
    setGeneratedPreview('');
    setHasGeneratedContent(false);

    try {
      await generate({
        creativeContent: creative.content || '',
        type: 'worldbook',
        templateId: selectedTemplate || 'default-worldbook',
        userRequirements,
        streaming: true,
        onStream: (chunk) => {
          setGeneratedPreview(prev => prev + chunk);
        },
        onStreamComplete: (data) => {
          setIsGenerating(false);
          setHasGeneratedContent(true);
        }
      });
    } catch (error) {
      message.error('AI生成失败');
      setIsGenerating(false);
    }
  }, [creative, generate, selectedTemplate, userRequirements]);

  const handleSaveGeneratedContent = useCallback(() => {
    if (!currentCreativeId || !worldBook || !generatedPreview) return;

    updateWorldBook(currentCreativeId, { content: generatedPreview });
    setEditingContent(generatedPreview);
    setAiModalVisible(false);
    setGeneratedPreview('');
    setHasGeneratedContent(false);
    setUserRequirements('');
    message.success('AI生成的内容已保存');
  }, [currentCreativeId, worldBook, generatedPreview, updateWorldBook]);

  // AI格式化转换功能
  const handleFormatExport = useCallback(async () => {
    const content = editorRef.current?.getMarkdown?.() || editingContent;
    if (!content.trim()) {
      message.warning('编辑器内容为空，无法进行格式转换');
      return;
    }

    setIsFormatting(true);
    setFormattedJson(null);

    try {
      const formatPrompt = `你是一个专业的世界书数据格式转换助手。请将用户提供的Markdown格式世界书内容转换为符合SillyTavern世界书规范的JSON格式。

【转换规则】
1. 解析Markdown中的角色、地点、组织、规则等条目
2. 每个条目提取关键字(key)、描述(content)、注释(comment)
3. 关键字应包含角色名称、别名、来源作品等
4. 内容应包含完整的角色设定、背景故事等
5. 保持与参考格式完全一致的JSON结构

【输出格式要求】
{
  "name": "世界书名称",
  "description": "世界书描述/介绍",
  "entries": {
    "1": {
      "uid": 1,
      "key": ["关键字1", "关键字2", "..."],
      "keysecondary": [],
      "keys": ["关键字1", "关键字2", "..."],
      "secondary_keys": [],
      "comment": "条目注释/简短描述",
      "content": "完整的条目内容，使用Markdown格式",
      "constant": false,
      "selective": true,
      "order": 100,
      "position": 0,
      "disable": false,
      "displayIndex": 0,
      "addMemo": true,
      "group": "",
      "groupOverride": false,
      "groupWeight": 100,
      "sticky": 0,
      "cooldown": 0,
      "delay": 0,
      "probability": 100,
      "depth": 4,
      "useProbability": true,
      "role": null,
      "vectorized": false,
      "excludeRecursion": false,
      "preventRecursion": false,
      "delayUntilRecursion": 0,
      "scanDepth": 0,
      "caseSensitive": false,
      "matchWholeWords": false,
      "useGroupScoring": false,
      "automationId": "",
      "tags": [],
      "selectiveLogic": 0,
      "ignoreBudget": false,
      "matchPersonaDescription": false,
      "matchCharacterDescription": false,
      "matchCharacterPersonality": false,
      "matchCharacterDepthPrompt": false,
      "matchScenario": false,
      "matchCreatorNotes": false,
      "outletName": "",
      "triggers": [],
      "characterFilter": {
        "isExclude": false,
        "names": [],
        "tags": []
      },
      "id": 1,
      "priority": 100,
      "insertion_order": 100,
      "enabled": true,
      "name": "条目名称",
      "extensions": {
        "depth": 4,
        "weight": 10,
        "addMemo": true,
        "displayIndex": 0,
        "useProbability": true,
        "characterFilter": null,
        "excludeRecursion": false
      }
    }
  }
}

【严格输出要求】
- 你的回复必须且只能包含一个JSON对象
- 不要使用markdown代码块包裹
- 不要添加任何解释文字
- 确保JSON格式正确，所有引号和括号配对
- entries中的key应从1开始递增
- 整体输出长度应在${minWordCount}字到${maxWordCount}字之间，确保内容丰富详尽

【待转换的世界书内容】

${editingContent}`;

      const result = await generate({
        creativeContent: '',
        type: 'worldbook',
        templateId: 'worldbook',
        streaming: false,
        customPrompt: formatPrompt,
      });

      if (!result.success || !result.data?.content) {
        throw new Error(result.error || '转换失败');
      }

      let cleaned = result.data.content.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

      try {
        const parsed = JSON.parse(cleaned);
        setFormattedJson(JSON.stringify(parsed, null, 2));
        message.success('格式转换成功');
      } catch (parseError) {
        throw new Error('JSON解析失败，请重试');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '格式转换失败';
      message.error(errorMessage);
    } finally {
      setIsFormatting(false);
    }
  }, [editingContent, generate]);

  // 导出JSON到本地文件
  const handleExportJson = useCallback(() => {
    if (!formattedJson) {
      message.warning('没有可导出的内容');
      return;
    }

    try {
      const blob = new Blob([formattedJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${exportName || 'worldbook'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success('导出成功！');
    } catch (error) {
      message.error('导出失败');
    }
  }, [formattedJson, exportName]);

  // 提交到知识库
  const handleSubmitToKnowledgeBase = useCallback(async () => {
    if (!formattedJson) {
      message.warning('没有可提交的内容');
      return;
    }

    try {
      const data = JSON.parse(formattedJson);
      const saveName = exportName || data.name || 'worldbook';
      
      const checkResult = await window.electronAPI.worldBook.checkFileExists(saveName);
      if (!checkResult.success) {
        message.error('检查文件失败');
        return;
      }

      if (checkResult.exists) {
        Modal.confirm({
          title: '文件已存在',
          content: `文件 "${saveName}.json" 已存在于知识库中，确定要覆盖吗？`,
          okText: '覆盖',
          cancelText: '取消',
          onOk: async () => {
            await saveWorldBookToKB(data, saveName);
          }
        });
      } else {
        await saveWorldBookToKB(data, saveName);
      }
    } catch (error) {
      message.error('数据解析失败');
    }
  }, [formattedJson, exportName]);

  const saveWorldBookToKB = async (data: any, fileName: string) => {
    try {
      const result = await window.electronAPI.worldBook.saveToKnowledgeBase(data, fileName);
      if (result.success) {
        message.success(`${result.message}！\n路径：${result.filePath}`);
        setExportModalVisible(false);
      } else {
        message.error(`保存失败：${result.error}`);
      }
    } catch (error) {
      message.error('保存失败');
    }
  };

  // 提交到世界书管理系统
  const handleSubmitToWorldBook = useCallback(() => {
    if (!formattedJson) {
      message.warning('没有可提交的内容');
      return;
    }

    try {
      const data: WorldBookExport = JSON.parse(formattedJson);
      if (!data.name || !data.entries) {
        message.error('数据格式不正确');
        return;
      }

      if (!currentCreativeId || !worldBook) {
        message.error('无法找到当前世界书');
        return;
      }

      updateWorldBook(currentCreativeId, { 
        name: data.name || worldBook.name,
        content: JSON.stringify(data, null, 2)
      });
      
      setEditingContent(JSON.stringify(data, null, 2));
      message.success('已提交到世界书管理系统');
      setExportModalVisible(false);
    } catch (error) {
      message.error('提交失败');
    }
  }, [formattedJson, currentCreativeId, worldBook, updateWorldBook]);

  // 打开导出弹窗
  const handleOpenExportModal = useCallback(() => {
    setExportModalVisible(true);
    setExportName(worldBook?.name || 'worldbook');
    setFormattedJson(null);
  }, [worldBook?.name]);

  const templateOptions = [
    { label: '默认模板', value: 'default-worldbook' },
    { label: '详细世界设定', value: 'detailed-worldbook' },
    { label: '快速生成', value: 'quick-worldbook' },
  ];

  if (!creative) {
    return (
      <div style={{ padding: 24 }}>
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            { title: '创意管理' },
            { title: '世界书' },
            { title: '编辑' },
          ]}
        />
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <Title level={4}>未选择创意</Title>
          <Text type="secondary">请先选择一个创意或返回列表页</Text>
        </div>
      </div>
    );
  }

  if (!worldBook) {
    return (
      <div style={{ padding: 24 }}>
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            { title: '创意管理' },
            { title: '世界书' },
            { title: '编辑' },
          ]}
        />
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <Title level={4}>此创意暂无世界书</Title>
          <Text type="secondary">请先在世界书列表中创建世界书</Text>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: '创意管理' },
          { title: '世界书' },
          { title: '编辑' },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: '0 0 8px 0' }}>
            {worldBook.name}
          </Title>
          <Text type="secondary">
            所属创意：{creative.title}
          </Text>
        </div>

        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
          >
            返回列表
          </Button>
          <Button
            icon={<RobotOutlined />}
            onClick={() => {
              setAiModalVisible(true);
              setGeneratedPreview('');
              setHasGeneratedContent(false);
            }}
          >
            AI生成
          </Button>
          <Button
            type="primary"
            icon={<FileTextOutlined />}
            onClick={handleOpenExportModal}
          >
            导出JSON
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
          >
            保存
          </Button>
        </Space>
      </div>

      <TextEditor
        ref={editorRef}
        value={editingContent}
        onChange={setEditingContent}
        theme={theme}
        enableSave={false}
        minHeight={600}
        placeholder="在此编辑世界书内容..."
      />

      <Modal
        title="AI生成世界书内容"
        open={aiModalVisible}
        onCancel={() => {
          setAiModalVisible(false);
          setGeneratedPreview('');
          setHasGeneratedContent(false);
          setUserRequirements('');
        }}
        footer={
          <Space>
            <Button
              onClick={() => {
                setAiModalVisible(false);
                setGeneratedPreview('');
                setHasGeneratedContent(false);
                setUserRequirements('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleAiGenerate}
              loading={isGenerating}
              disabled={isGenerating}
            >
              生成
            </Button>
            {hasGeneratedContent && (
              <Button
                type="primary"
                onClick={handleSaveGeneratedContent}
              >
                保存生成的内容
              </Button>
            )}
          </Space>
        }
        width={720}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <Text strong>选择模板</Text>
          </div>
          <Select
            style={{ width: '100%' }}
            value={selectedTemplate}
            onChange={setSelectedTemplate}
            options={templateOptions}
            placeholder="选择生成模板"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <Text strong>您的要求</Text>
          </div>
          <TextArea
            value={userRequirements}
            onChange={(e) => setUserRequirements(e.target.value)}
            placeholder="输入您的具体要求，例如：希望世界包含魔法系统、多个大陆等..."
            rows={4}
          />
        </div>

        {isGenerating && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin tip="AI正在生成内容..." />
          </div>
        )}

        {generatedPreview && (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>生成预览</Text>
            </div>
            <div
              style={{
                padding: 16,
                background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
                border: '1px solid ' + (theme === 'dark' ? '#333' : '#d9d9d9'),
                borderRadius: 4,
                maxHeight: 400,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {generatedPreview}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="导出世界书"
        open={exportModalVisible}
        onCancel={() => {
          setExportModalVisible(false);
          setFormattedJson(null);
          setExportName('');
        }}
        footer={
          <Space>
            <Button
              onClick={() => {
                setExportModalVisible(false);
                setFormattedJson(null);
                setExportName('');
              }}
            >
              取消
            </Button>
            <Button
                icon={<ReloadOutlined />}
                onClick={handleFormatExport}
                loading={isFormatting}
                disabled={isFormatting}
              >
                AI格式化
              </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={handleSubmitToKnowledgeBase}
              disabled={!formattedJson}
            >
              保存到知识库
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportJson}
              disabled={!formattedJson}
            >
              下载JSON文件
            </Button>
          </Space>
        }
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <Text strong>导出文件名</Text>
          </div>
          <Input
            value={exportName}
            onChange={(e) => setExportName(e.target.value)}
            placeholder="输入文件名"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <Text strong>输出字数限制</Text>
          </div>
          <Space>
            <Input
              type="number"
              value={minWordCount}
              onChange={(e) => setMinWordCount(Number(e.target.value))}
              placeholder="最小字数"
              style={{ width: 120 }}
              min={100}
              max={10000}
            />
            <Text>至</Text>
            <Input
              type="number"
              value={maxWordCount}
              onChange={(e) => setMaxWordCount(Number(e.target.value))}
              placeholder="最大字数"
              style={{ width: 120 }}
              min={100}
              max={20000}
            />
            <Text>字</Text>
          </Space>
        </div>

        {isFormatting && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin tip="AI正在转换格式..." />
          </div>
        )}

        {formattedJson && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>转换预览</Text>
              <Space style={{ marginLeft: 16 }}>
                <Button
                  type={previewMode === 'json' ? 'primary' : 'default'}
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => setPreviewMode('json')}
                >
                  JSON
                </Button>
                <Button
                  type={previewMode === 'formatted' ? 'primary' : 'default'}
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => setPreviewMode('formatted')}
                >
                  格式化视图
                </Button>
              </Space>
            </div>
            <div
              style={{
                padding: 16,
                background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
                border: '1px solid ' + (theme === 'dark' ? '#333' : '#d9d9d9'),
                borderRadius: 4,
                maxHeight: 500,
                overflow: 'auto',
                whiteSpace: previewMode === 'json' ? 'pre-wrap' : 'pre-wrap',
                fontSize: 12,
                lineHeight: 1.6,
                fontFamily: previewMode === 'json' ? 'monospace' : 'inherit',
              }}
            >
              {previewMode === 'json' ? formattedJson : (
                <pre>{formattedJson}</pre>
              )}
            </div>
          </div>
        )}

        {!isFormatting && !formattedJson && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8c8c8c' }}>
            <FileTextOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <div>点击"AI格式化"按钮开始转换</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>将Markdown内容转换为世界书JSON格式</div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WorldBookEditPage;
