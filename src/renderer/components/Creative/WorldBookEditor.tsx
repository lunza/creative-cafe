import React, { useState, useEffect } from 'react';
import { Tabs, Button, Space, Typography, Form, Select, Alert, message } from 'antd';
import { RocketOutlined, HistoryOutlined, SaveOutlined, LoadingOutlined } from '@ant-design/icons';
import TextEditor from '../Common/TextEditor';
import { useCreativeStore } from '../../stores/creativeStore';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';
import CreativeOptimize from './CreativeOptimize';
import { buildEngineApiUrl } from '../../utils/apiUtils';
import { getWorldbookTemplates, PromptTemplate } from '../../utils/promptTemplates';

const { Text, Title } = Typography;
const { Option } = Select;

const WorldBookEditor: React.FC = () => {
  const {
    creatives,
    currentCreativeId,
    updateWorldBook,
    addWorldBookVersion,
    addWorldBookChatMessage
  } = useCreativeStore();
  const { setting, fetchSetting } = useSettingStore();
  const { addLog } = useLogStore();
  const { theme } = useUIStore();

  const [activeTab, setActiveTab] = useState('edit');
  const [editingContent, setEditingContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [markdownContent, setMarkdownContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('worldbook');
  const [form] = Form.useForm();

  const templates = getWorldbookTemplates();

  const currentCreative = creatives.find(c => c.id === currentCreativeId);
  const worldBook = currentCreative?.worldBook || null;

  // 初始化内容
  useEffect(() => {
    if (worldBook) {
      setEditingContent(worldBook.content || '');
    }
  }, [worldBook]);

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  // 获取当前激活的AI引擎配置
  const getActiveEngineConfig = () => {
    if (!setting) return null;

    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      if (activeEngine) {
        return activeEngine;
      }
    }

    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }

    return null;
  };

  // 保存世界书内容
  const handleSave = () => {
    if (currentCreativeId) {
      updateWorldBook(currentCreativeId, { content: editingContent });
      addWorldBookVersion(currentCreativeId, editingContent, '手动保存');
      message.success('内容已保存');
    }
  };

  // 保存AI生成的内容到编辑中
  const handleSaveGeneratedContent = () => {
    const contentToSave = markdownContent || streamingContent;
    if (contentToSave && currentCreativeId) {
      setEditingContent(contentToSave);
      updateWorldBook(currentCreativeId, { content: contentToSave });
      addWorldBookVersion(currentCreativeId, contentToSave, 'AI生成');
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

    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) {
      message.error('请在设置中配置AI引擎');
      return;
    }

    if (!activeEngine.api_url) {
      message.error('API地址不能为空');
      return;
    }

    // 获取选中的模板
    const template = templates.find(t => t.id === selectedTemplate);
    if (!template) {
      message.error('请选择生成模板');
      return;
    }

    // 重置流式内容
    setStreamingContent('');
    setMarkdownContent('');

    // 节流更新：记录上次更新时间，避免过于频繁的状态更新
    let lastUpdateTime = 0;
    const THROTTLE_INTERVAL = 100; // 每 100ms 最多更新一次

    // 监听流式响应事件
    let removeStreamListener: (() => void) | null = null;
    let removeStreamCompleteListener: (() => void) | null = null;

    const handleStream = (data: any) => {
      if (data?.chunk) {
        const lines = data.chunk.split('\n');
        let extractedContent = '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const content = line.substring(6);
            if (content === '[DONE]') continue;
            try {
              const json = JSON.parse(content);
              if (json.choices?.[0]?.delta?.content) {
                extractedContent += json.choices[0].delta.content;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }

        if (extractedContent) {
          // 节流更新状态
          const now = Date.now();
          if (now - lastUpdateTime >= THROTTLE_INTERVAL) {
            lastUpdateTime = now;
            setStreamingContent(prev => prev + extractedContent);
            setMarkdownContent(prev => prev + extractedContent);
          }
        }
      }
    };

    const handleStreamComplete = (data: any) => {
      let generated = '';
      if (data?.data) {
        if (data.data.choices?.[0]?.message?.content) {
          generated = data.data.choices[0].message.content;
        }
      }

      // 如果流式数据为空，使用最终结果
      if (!generated) {
        generated = streamingContent;
      }

      // 同步更新所有内容状态，确保数据一致性
      setMarkdownContent(generated);
      setEditingContent(generated);

      updateWorldBook(currentCreativeId, { content: generated });
      addWorldBookVersion(currentCreativeId, generated, 'AI生成');

      addLog('[Creative] 世界书内容生成成功');
      message.success('生成成功！');
    };

    setLoading(true);

    try {
      // 构建提示词 - 优先使用 content，如果为空尝试使用 description
      let creativeContent = currentCreative?.content || '';
      if (!creativeContent.trim()) {
        creativeContent = currentCreative?.description || '';
        addLog('[Creative] 创意内容为空，使用描述作为替代', 'warn');
      }
      
      // 添加调试信息
      console.log('[DEBUG] currentCreative:', currentCreative);
      console.log('[DEBUG] creativeContent:', creativeContent);
      console.log('[DEBUG] currentCreative?.description:', currentCreative?.description);
      
      // 如果还是空，给用户提示
      if (!creativeContent.trim()) {
        message.warning('创意内容为空，请先在创意详情中编辑您的创意！');
        setLoading(false);
        return;
      }
      
      const prompt = template.buildPrompt(creativeContent);
      console.log('[DEBUG] Final prompt:', prompt);

      const apiUrl = buildEngineApiUrl(activeEngine);
      const apiKey = activeEngine.api_key;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const apiMode = activeEngine.api_mode || 'chat_completion';

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      let requestBody: any;
      if (apiMode === 'chat_completion') {
        let finalSystemPrompt = template.systemPrompt;
        if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
          finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + template.systemPrompt;
        }

        addLog(`[Creative] 拼接后的systemPrompt长度: ${finalSystemPrompt.length}`, 'info');
        console.log('[DEBUG] finalSystemPrompt:', finalSystemPrompt);

        // 【多模态兼容性审计】本组件使用内联对象构建 AI 请求消息，content 均为字符串，
        // 不受 AIService.ts 多模态 ChatMessage 联合类型影响。
        requestBody = {
          model: modelName,
          messages: [
            {
              role: 'system',
              content: finalSystemPrompt
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240,
          temperature: (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7
        };
      } else {
        requestBody = {
          model: modelName,
          prompt,
          max_tokens: (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240,
          temperature: (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7
        };
      }

      if (apiKey) {
        const trimmedApiKey = apiKey.trim();
        if (apiKeyTransmission === 'header') {
          requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      // 添加事件监听器
      removeStreamListener = window.electronAPI.on('ai:stream', handleStream);
      removeStreamCompleteListener = window.electronAPI.on('ai:stream:complete', handleStreamComplete);

      const result = await window.electronAPI.ai.request({
        url: apiUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        timeout: 600000,
        streaming: true
      });

      if (!result.success) {
        throw new Error(result.error || '生成失败');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成失败';
      addLog(`[Creative] 世界书内容生成失败: ${errorMessage}`, 'error');
      message.error(`生成失败: ${errorMessage}`);
      message.info('请检查AI引擎配置，确保API地址正确且服务器已运行。');
    } finally {
      setLoading(false);
      if (removeStreamListener) removeStreamListener();
      if (removeStreamCompleteListener) removeStreamCompleteListener();
    }
  };

  if (!worldBook) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Text type="secondary">请先选择一个世界书进行编辑</Text>
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
          <TextEditor
            value={editingContent}
            onChange={setEditingContent}
            minHeight={600}
            theme={theme}
            enableAITools={true}
            placeholder="在此编辑世界书内容..."
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
                <Text strong>当前世界书：</Text> {worldBook.name}
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
                    {loading ? '生成中...' : '开始生成世界书'}
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
                  <TextEditor
                    value={markdownContent || streamingContent || editingContent}
                    onChange={setMarkdownContent}
                    minHeight={400}
                    theme={theme}
                    enableAITools={false}
                    placeholder="AI生成结果将在此显示..."
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
              updateWorldBook(currentCreativeId, { content });
            }
          }}
          creativeId={currentCreativeId}
          targetType="worldbook"
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

export default WorldBookEditor;
