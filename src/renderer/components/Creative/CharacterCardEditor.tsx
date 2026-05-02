import React, { useState, useEffect } from 'react';
import { Tabs, Button, Space, Typography, Form, Select, Alert, message } from 'antd';
import { RocketOutlined, HistoryOutlined, SaveOutlined, LoadingOutlined } from '@ant-design/icons';
import MarkdownEditor from '../Common/MarkdownEditor';
import { useCreativeStore } from '../../stores/creativeStore';
import { useCreativeAI } from './hooks/useCreativeAI';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';
import CreativeOptimize from './CreativeOptimize';
import { getCharacterTemplates, PromptTemplate } from '../../utils/promptTemplates';

const { Text, Title } = Typography;
const { Option } = Select;

const CharacterCardEditor: React.FC = () => {
  const {
    creatives,
    currentCreativeId,
    updateCharacterCard,
    addCharacterCardVersion,
    addCharacterCardChatMessage
  } = useCreativeStore();
  const { generate } = useCreativeAI();
  const { addLog } = useLogStore();
  const { theme } = useUIStore();

  const [activeTab, setActiveTab] = useState('edit');
  const [editingContent, setEditingContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [markdownContent, setMarkdownContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('character_card');
  const [form] = Form.useForm();

  const templates = getCharacterTemplates();

  const currentCreative = creatives.find(c => c.id === currentCreativeId);
  const characterCard = currentCreative?.characterCard || null;

  // 初始化内容
  useEffect(() => {
    if (characterCard) {
      setEditingContent(characterCard.content || '');
    }
  }, [characterCard]);

  const handleSave = () => {
    if (currentCreativeId) {
      updateCharacterCard(currentCreativeId, { content: editingContent });
      addCharacterCardVersion(currentCreativeId, editingContent, '手动保存');
      message.success('内容已保存');
    }
  };

  // 保存AI生成的内容到编辑中
  const handleSaveGeneratedContent = () => {
    const contentToSave = markdownContent || streamingContent;
    if (contentToSave && currentCreativeId) {
      setEditingContent(contentToSave);
      updateCharacterCard(currentCreativeId, { content: contentToSave });
      addCharacterCardVersion(currentCreativeId, contentToSave, 'AI生成');
      message.success('生成内容已保存');
      addLog('[Creative] 生成内容已保存');
    }
  };

  // 智能生成内容
  const handleGenerate = async () => {
    if (!currentCreativeId) {
      message.error('请先选择一个创意');
      return;
    }

    const template = templates.find(t => t.id === selectedTemplate);
    if (!template) {
      message.error('请选择生成模板');
      return;
    }

    setStreamingContent('');
    setMarkdownContent('');
    setLoading(true);

    try {
      let creativeContent = currentCreative?.content || '';
      if (!creativeContent.trim()) {
        creativeContent = currentCreative?.description || '';
        addLog('创意内容为空，使用描述作为替代', 'warn', {
          category: 'creative',
          context: { creativeId: currentCreativeId }
        });
      }
      
      if (!creativeContent.trim()) {
        message.warning('创意内容为空，请先在创意详情中编辑您的创意！');
        setLoading(false);
        return;
      }

      const result = await generate({
        creativeContent,
        type: 'character',
        templateId: selectedTemplate,
        streaming: true,
        onStream: (chunk) => {
          setStreamingContent(prev => prev + chunk);
          setMarkdownContent(prev => prev + chunk);
        },
        onStreamComplete: (data) => {
          const finalContent = data.content || streamingContent;
          setMarkdownContent(finalContent);
          setEditingContent(finalContent);
          updateCharacterCard(currentCreativeId!, { content: finalContent });
          addCharacterCardVersion(currentCreativeId!, finalContent, 'AI生成');
          addLog('角色卡内容生成成功', 'info', {
            category: 'creative',
            context: {
              creativeId: currentCreativeId,
              templateId: selectedTemplate
            },
            details: '角色卡内容生成成功，已保存到版本历史。'
          });
          message.success('生成成功！');
        }
      });

      if (!result.success) {
        const errorDetails = result.details ? `\n服务器错误详情: ${result.details}` : '';
        throw new Error(`${result.error || '生成失败'}${errorDetails}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成失败';
      addLog('角色卡内容生成失败', 'error', {
        category: 'creative',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'CharacterCardEditor.tsx:handleGenerate',
          errorMessage: errorMessage,
          creativeId: currentCreativeId,
          templateId: selectedTemplate
        },
        details: {
          request: {
            template: template.name,
            characterName: characterCard?.name
          },
          errorDetails: error instanceof Error ? {
            message: error.message,
            stack: error.stack
          } : {
            message: errorMessage
          }
        }
      });
      message.error(`生成失败: ${errorMessage}`);
      message.info('请检查AI引擎配置，确保API地址正确且服务器已运行。');
    } finally {
      setLoading(false);
    }
  };

  if (!characterCard) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Text type="secondary">请先选择一个角色卡进行编辑</Text>
      </div>
    );
  }

  const items = [
    {
      key: 'edit',
      label: '编辑',
      children: (
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
            >
              保存内容
            </Button>
          </div>
          <MarkdownEditor
            value={editingContent}
            onChange={setEditingContent}
            minHeight={600}
            theme={theme}
            enableAITools={true}
          />
        </div>
      ),
    },
    {
      key: 'generate',
      label: <><RocketOutlined /> 智能生成</>,
      children: (
        <div style={{ padding: 16 }}>
          {!currentCreative ? (
            <Alert
              message="提示"
              description="请先选择一个创意"
              type="info"
              showIcon
            />
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <Text strong>当前角色卡：</Text> {characterCard.name}
              </div>

              <div style={{ marginBottom: 16 }}>
                <Title level={5}>选择生成模板</Title>
                <Select
                  value={selectedTemplate}
                  onChange={setSelectedTemplate}
                  style={{ width: '100%' }}
                  size="large"
                  placeholder="请选择生成模板"
                >
                  {templates.map(template => (
                    <Option key={template.id} value={template.id}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 'bold' }}>{template.name}</span>
                        <span style={{ fontSize: '12px', color: '#999' }}>{template.description}</span>
                      </div>
                    </Option>
                  ))}
                </Select>
              </div>

              {selectedTemplate && (
                <Alert
                  message={`当前模板：${templates.find(t => t.id === selectedTemplate)?.name}`}
                  description={templates.find(t => t.id === selectedTemplate)?.description}
                  type="info"
                  style={{ marginBottom: 16 }}
                />
              )}

              <Form form={form} layout="vertical">
                <Form.Item>
                  <Button
                    type="primary"
                    onClick={handleGenerate}
                    icon={loading ? <LoadingOutlined spin /> : <RocketOutlined />}
                    size="large"
                    style={{ width: '100%' }}
                    loading={loading}
                  >
                    {loading ? '生成中...' : '开始生成角色卡'}
                  </Button>
                </Form.Item>
              </Form>

              <div style={{ marginTop: 24 }}>
                <Title level={5}>生成结果</Title>
                <div style={{ marginBottom: 16 }}>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={handleSaveGeneratedContent}
                    disabled={!markdownContent && !streamingContent}
                  >
                    保存生成内容
                  </Button>
                </div>
                <div style={{ marginTop: 16 }}>
                  <MarkdownEditor
                    value={markdownContent || streamingContent || editingContent}
                    onChange={setMarkdownContent}
                    minHeight={400}
                    theme={theme}
                    enableAITools={false}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'optimize',
      label: <><HistoryOutlined /> 多轮优化</>,
      children: currentCreativeId ? (
        <CreativeOptimize
          creativeContent={editingContent}
          onContentChange={(content) => {
            setEditingContent(content);
            if (currentCreativeId) {
              updateCharacterCard(currentCreativeId, { content });
            }
          }}
          creativeId={currentCreativeId}
          targetType="character"
        />
      ) : (
        <Alert
          message="请先选择一个创意"
          type="info"
          showIcon
          style={{ margin: 16 }}
        />
      ),
    },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        style={{ flex: 1 }}
      />
    </div>
  );
};

export default CharacterCardEditor;
