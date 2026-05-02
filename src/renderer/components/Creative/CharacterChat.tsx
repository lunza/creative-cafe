import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Space, Typography, message, Card } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';
import RichTextRenderer from '../Common/RichTextRenderer';
import { useSettingStore } from '../../stores/settingStore';
import { useCharacterChatStore } from '../../stores/characterChatStore';
import { useCreativeStore } from '../../stores/creativeStore';
import { useLogStore } from '../../stores/logStore';
import { buildEngineApiUrl } from '../../utils/apiUtils';

const { Title, Text } = Typography;

interface CharacterChatProps {
  creativeId: string;
  characterCardName: string;
  characterCardContent: string;
  chatType: 'test' | 'generate';
}

/**
 * 角色卡聊天组件 - 使用成熟的简化实现
 */
const CharacterChat: React.FC<CharacterChatProps> = ({
  creativeId,
  characterCardName,
  characterCardContent,
  chatType,
}) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { setting, fetchSetting } = useSettingStore();
  const currentTestChat = useCharacterChatStore(state => state.currentTestChat);
  const currentGenerationChat = useCharacterChatStore(state => state.currentGenerationChat);
  const saveTestChat = useCharacterChatStore(state => state.saveTestChat);
  const saveGenerationChat = useCharacterChatStore(state => state.saveGenerationChat);
  const { addLog } = useLogStore();

  // 初始化加载配置
  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  // 从store同步历史消息
  useEffect(() => {
    if (isStreaming || isLoading) return;
    
    const storeMessages = chatType === 'test'
      ? currentTestChat?.messages || []
      : currentGenerationChat?.messages || [];
    
    // 只在消息为空且store有消息时加载，避免无限循环
    if (storeMessages.length > 0 && messages.length === 0) {
      const formatted = storeMessages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
      }));
      // 深度比较避免不必要的更新
      setMessages(prev => {
        if (prev.length === formatted.length && 
            prev.every((m, i) => m.id === formatted[i].id && m.content === formatted[i].content)) {
          return prev;
        }
        return formatted;
      });
      addLog('[CharacterChat] 从store加载历史消息', 'info');
    }
  }, [currentTestChat?.id, currentGenerationChat?.id, chatType]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 获取活动AI引擎
  const getActiveEngine = () => {
    if (!setting || !setting.aiEngines || setting.aiEngines.length === 0) {
      return null;
    }
    
    if (setting.activeEngineId) {
      const engine = setting.aiEngines.find(e => e.id === setting.activeEngineId);
      if (engine) return engine;
    }
    
    return setting.aiEngines[0];
  };

  // 发送消息
  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming || isLoading) return;
    
    const activeEngine = getActiveEngine();
    if (!activeEngine) {
      message.warning('请先在设置中配置AI引擎');
      return;
    }

    addLog('[CharacterChat] 开始发送消息', 'info');
    
    // 添加用户消息
    const userMessageId = Date.now().toString();
    const userMessage = {
      id: userMessageId,
      role: 'user' as const,
      content: input,
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);

    // 添加临时AI消息
    const aiMessageId = (Date.now() + 1).toString();
    let tempContent = '';
    setMessages([...newMessages, { id: aiMessageId, role: 'assistant', content: '' }]);

    let removeStreamListener: (() => void) | null = null;
    let removeStreamCompleteListener: (() => void) | null = null;

    try {
      const systemPrompt = `你现在扮演以下角色，请完全根据角色设定来回复：
角色：${characterCardName}
角色设定：${characterCardContent || ''}
请严格按照这个角色的设定、性格、说话方式来回复，保持角色的一致性。
记住：你就是这个角色，不是在扮演，你就是他/她/它本人！`;

      const chatHistory = newMessages.map(msg => ({
        role: msg.role,
        content: String(msg.content),
      }));

      const apiUrl = buildEngineApiUrl(activeEngine);
      const apiKey = activeEngine.api_key;
      const modelName = activeEngine.model_name || 'gpt-3.5-turbo';
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const apiMode = activeEngine.api_mode || 'chat_completion';

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      let requestBody: any;
      if (apiMode === 'chat_completion') {
        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: String(systemPrompt) },
            ...chatHistory,
          ],
          max_tokens: Number(activeEngine.max_tokens) || 4096,
          temperature: Number(activeEngine.temperature) || 0.8,
        };
      } else {
        let prompt = String(systemPrompt) + '\n\n';
        chatHistory.forEach(msg => {
          prompt += `${msg.role === 'user' ? '用户' : '助手'}：${String(msg.content)}\n`;
        });
        requestBody = {
          model: modelName,
          prompt,
          max_tokens: Number(activeEngine.max_tokens) || 4096,
          temperature: Number(activeEngine.temperature) || 0.8,
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

      // 流式响应处理
      const handleStream = (data: any) => {
        if (data.chunk) {
          const lines = data.chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const content = line.substring(6);
              if (content === '[DONE]') continue;
              try {
                const json = JSON.parse(content);
                if (json.choices && json.choices[0]) {
                  const delta = json.choices[0].delta;
                  if (delta && delta.content) {
                    tempContent += delta.content;
                    setMessages(prev => prev.map(msg =>
                      msg.id === aiMessageId ? { ...msg, content: tempContent } : msg
                    ));
                  }
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      };

      const handleStreamComplete = (data: any) => {
        addLog('[CharacterChat] 流式响应完成', 'debug');
        
        let finalContent = tempContent;
        
        if (!finalContent && data.data) {
          if (apiMode === 'chat_completion' && data.data.choices && data.data.choices[0]) {
            finalContent = data.data.choices[0].message?.content || '';
          } else if (apiMode === 'text_completion' && data.data.choices && data.data.choices[0]) {
            finalContent = data.data.choices[0].text || '';
          }
        }

        if (finalContent) {
          const finalMessages = [...newMessages, { id: aiMessageId, role: 'assistant', content: finalContent }];
          setMessages(finalMessages);
          
          // 异步保存
          setTimeout(async () => {
            try {
              if (chatType === 'test') {
                await saveTestChat(creativeId, characterCardName, characterCardName, finalMessages);
              } else {
                await saveGenerationChat(creativeId, 'character', characterCardName, finalMessages);
              }
              addLog('[CharacterChat] 保存成功', 'info');
            } catch (error) {
              addLog(`[CharacterChat] 保存失败: ${error}`, 'error');
            }
          }, 100);
        }

        setIsStreaming(false);
        setIsLoading(false);
        cleanup();
      };

      const cleanup = () => {
        if (removeStreamListener) {
          try { removeStreamListener(); } catch {}
          removeStreamListener = null;
        }
        if (removeStreamCompleteListener) {
          try { removeStreamCompleteListener(); } catch {}
          removeStreamCompleteListener = null;
        }
      };

      // 添加事件监听
      removeStreamListener = (window as any).electronAPI.on('ai:stream', handleStream);
      removeStreamCompleteListener = (window as any).electronAPI.on('ai:stream:complete', handleStreamComplete);

      const result = await (window as any).electronAPI.ai.request({
        url: apiUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        timeout: 600000,
        streaming: true,
      });

      if (!result.success) {
        throw new Error(result.error || '生成失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成失败';
      addLog(`[CharacterChat] 错误: ${errorMessage}`, 'error');
      message.error(`生成失败: ${errorMessage}`);
      
      // 移除临时AI消息
      setMessages(newMessages);
      setIsStreaming(false);
      setIsLoading(false);
    }
  };

  // 清空对话
  const handleClearChat = async () => {
    setMessages([]);
    addLog('[CharacterChat] 清空对话', 'info');
    
    // 保存空对话
    try {
      if (chatType === 'test') {
        await saveTestChat(creativeId, characterCardName, characterCardName, []);
      } else {
        await saveGenerationChat(creativeId, 'character', characterCardName, []);
      }
    } catch {}
  };

  return (
    <Card 
      title={
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {chatType === 'test' ? '角色卡测试' : '角色卡对话'}
          </Title>
          {characterCardName && (
            <Text type="secondary">与 {characterCardName} 对话</Text>
          )}
        </Space>
      }
      extra={
        messages.length > 0 && (
          <Button size="small" onClick={handleClearChat}>清空对话</Button>
        )
      }
      bodyStyle={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '600px' }}
    >
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <RobotOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
            <p style={{ color: '#999' }}>开始与{characterCardName || '角色卡'}对话吧！</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', marginBottom: '16px', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ display: 'flex', gap: '8px', maxWidth: '80%' }}>
                {msg.role === 'assistant' && (
                  <div style={{ 
                    width: '32px', height: '32px', borderRadius: '50%', 
                    backgroundColor: '#f0f0f0', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0 
                  }}>
                    <RobotOutlined />
                  </div>
                )}
                <div style={{
                  backgroundColor: msg.role === 'user' ? '#1890ff' : '#f0f0f0',
                  color: msg.role === 'user' ? '#fff' : '#333',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  wordBreak: 'break-word'
                }}>
                  <RichTextRenderer content={String(msg.content)} />
                </div>
                {msg.role === 'user' && (
                  <div style={{ 
                    width: '32px', height: '32px', borderRadius: '50%', 
                    backgroundColor: '#1890ff', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0 
                  }}>
                    <UserOutlined style={{ color: '#fff' }} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`与 ${characterCardName || '角色卡'} 对话...`}
          disabled={isLoading || isStreaming}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          size="large"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendMessage}
          disabled={!input.trim() || isLoading || isStreaming}
          size="large"
          loading={isLoading || isStreaming}
        >
          {isStreaming ? '生成中...' : '发送'}
        </Button>
      </Space.Compact>
    </Card>
  );
};

export default CharacterChat;
