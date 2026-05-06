import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Space, Typography, message, Card, Modal } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined, SettingOutlined } from '@ant-design/icons';
import RichTextRenderer from '../Common/RichTextRenderer';
import { useSettingStore } from '../../stores/settingStore';
import { useCharacterChatStore } from '../../stores/characterChatStore';
import { useCreativeStore } from '../../stores/creativeStore';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';
import { buildEngineApiUrl } from '../../utils/apiUtils';

const { Title, Text } = Typography;

interface CharacterChatProps {
  creativeId: string;
  characterCardName: string;
  characterCardContent: string;
  chatType: 'test' | 'generate';
}

const MAX_AUTH_RETRIES = 1;

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
  const { setActiveTab } = useUIStore();
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
  const handleSendMessage = async (authRetryCount: number = 0) => {
    if (!input.trim() && authRetryCount === 0) return;
    if (isStreaming || isLoading) return;

    addLog(`[CharacterChat] 开始发送消息 (鉴权重试: ${authRetryCount}/${MAX_AUTH_RETRIES})`, 'info');
    
    // 每次发送前刷新setting，确保使用最新的引擎配置
    await fetchSetting();
    const freshSetting = useSettingStore.getState().setting;
    
    // 使用最新setting获取引擎
    if (!freshSetting || !freshSetting.aiEngines || freshSetting.aiEngines.length === 0) {
      message.warning('请先在设置中配置AI引擎');
      setIsLoading(false);
      setIsStreaming(false);
      return;
    }
    
    let currentEngine: any = null;
    if (freshSetting.activeEngineId) {
      currentEngine = freshSetting.aiEngines.find((e: any) => e.id === freshSetting.activeEngineId);
    }
    if (!currentEngine) {
      currentEngine = freshSetting.aiEngines[0];
    }
    
    if (!currentEngine || !currentEngine.api_url) {
      message.warning('AI引擎配置不完整，请检查API地址');
      setIsLoading(false);
      setIsStreaming(false);
      return;
    }
    
    // 添加用户消息（仅首次发送时）
    let currentMessages = messages;
    let userMessageId: string;
    let aiMessageId: string;
    
    if (authRetryCount === 0) {
      userMessageId = Date.now().toString();
      const userMessage = {
        id: userMessageId,
        role: 'user' as const,
        content: input,
      };
      
      currentMessages = [...messages, userMessage];
      setMessages(currentMessages);
      setInput('');
    } else {
      userMessageId = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : '';
      currentMessages = messages.length > 0 ? messages : currentMessages;
    }
    
    aiMessageId = (Date.now() + authRetryCount).toString();
    
    setIsLoading(true);
    setIsStreaming(true);

    // 添加临时AI消息
    let tempContent = '';
    setMessages([...currentMessages, { id: aiMessageId, role: 'assistant', content: '' }]);

    let removeStreamListener: (() => void) | null = null;
    let removeStreamCompleteListener: (() => void) | null = null;

    try {
      const systemPrompt = `你现在扮演以下角色，请完全根据角色设定来回复：
角色：${characterCardName}
角色设定：${characterCardContent || ''}
请严格按照这个角色的设定、性格、说话方式来回复，保持角色的一致性。
记住：你就是这个角色，不是在扮演，你就是他/她/它本人！`;

      const chatHistory = currentMessages.map(msg => ({
        role: msg.role,
        content: String(msg.content),
      }));

      const apiUrl = buildEngineApiUrl(currentEngine);
      const apiKey = currentEngine.api_key;
      const modelName = currentEngine.model_name || 'gpt-3.5-turbo';
      const apiKeyTransmission = currentEngine.api_key_transmission || 'body';
      const apiMode = currentEngine.api_mode || 'chat_completion';

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
          max_tokens: Number(currentEngine.max_tokens) || 4096,
          temperature: Number(currentEngine.temperature) || 0.8,
        };
      } else {
        let prompt = String(systemPrompt) + '\n\n';
        chatHistory.forEach(msg => {
          prompt += `${msg.role === 'user' ? '用户' : '助手'}：${String(msg.content)}\n`;
        });
        requestBody = {
          model: modelName,
          prompt,
          max_tokens: Number(currentEngine.max_tokens) || 4096,
          temperature: Number(currentEngine.temperature) || 0.8,
        };
      }

      if (apiKey) {
        const trimmedApiKey = apiKey.trim();
        addLog(`[CharacterChat] 鉴权处理: 传输方式=${apiKeyTransmission}, 密钥前10位=${trimmedApiKey.substring(0, 10)}..., 密钥后10位=${trimmedApiKey.length > 20 ? '...' + trimmedApiKey.substring(trimmedApiKey.length - 10) : '(太短)'}`, 'debug');
        if (trimmedApiKey) {
          if (apiKeyTransmission === 'header') {
            if (trimmedApiKey.startsWith('Bearer ')) {
              requestHeaders['Authorization'] = trimmedApiKey;
              addLog(`[CharacterChat] 已添加鉴权头(原有Bearer前缀): ${requestHeaders['Authorization'].substring(0, 20)}...`, 'debug');
            } else {
              requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
              addLog(`[CharacterChat] 已添加鉴权头(自动添加Bearer): ${requestHeaders['Authorization'].substring(0, 20)}...`, 'debug');
            }
          } else {
            requestBody.api_key = apiKey;
            addLog('[CharacterChat] API密钥已添加到请求体', 'debug');
          }
        }
      } else {
        addLog('[CharacterChat] 警告: 当前引擎未配置API密钥', 'warn');
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
                // 检查是否有错误信息
                if (json.error) {
                  addLog(`[CharacterChat] 流式响应错误: ${json.error.message || JSON.stringify(json.error)}`, 'error');
                  if (json.error.code === 401 || (json.error.message && json.error.message.toLowerCase().includes('unauthorized'))) {
                    throw new Error('鉴权失败(401 Unauthorized)');
                  }
                }
                if (json.choices && json.choices[0]) {
                  const delta = json.choices[0].delta;
                  if (delta && delta.content) {
                    tempContent += delta.content;
                    setMessages(prev => prev.map(msg =>
                      msg.id === aiMessageId ? { ...msg, content: tempContent } : msg
                    ));
                  }
                }
              } catch (parseError) {
                if (parseError instanceof Error && parseError.message.includes('鉴权失败')) {
                  throw parseError;
                }
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
          const finalMessages = [...currentMessages, { id: aiMessageId, role: 'assistant', content: finalContent }];
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
      
      // 检查是否为鉴权错误
      const isAuthError = errorMessage.includes('401') || 
                          errorMessage.includes('Unauthorized') || 
                          errorMessage.includes('authentication');
      
      if (isAuthError) {
        // 如果还有重试次数，自动重试
        if (authRetryCount < MAX_AUTH_RETRIES) {
          addLog(`[CharacterChat] 鉴权失败，尝试第 ${authRetryCount + 1} 次重试...`, 'warn');
          message.info('鉴权失败，正在刷新配置并重试...');
          cleanup();
          setIsStreaming(false);
          setIsLoading(false);
          // 延迟后重试
          setTimeout(() => {
            handleSendMessage(authRetryCount + 1);
          }, 500);
          return;
        }
        
        // 重试次数用尽，显示详细错误信息并提供跳转到设置的选项
        cleanup();
        setIsStreaming(false);
        setIsLoading(false);
        
        Modal.error({
          title: 'AI引擎鉴权失败',
          content: (
            <div>
              <p>无法连接到AI引擎，请检查以下配置：</p>
              <ul>
                <li>API密钥是否正确</li>
                <li>API地址是否正确</li>
                <li>API密钥传输方式是否匹配</li>
              </ul>
              <p style={{ color: '#999', fontSize: '12px' }}>
                错误详情: {errorMessage}
              </p>
            </div>
          ),
          okText: '打开AI设置',
          cancelText: '关闭',
          onOk: () => {
            setActiveTab('settings');
          },
          icon: <SettingOutlined />,
        });
        
        addLog('[CharacterChat] 鉴权失败，已达到最大重试次数', 'error');
      } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        message.error('权限不足，请确认API密钥是否有访问权限');
        addLog('[CharacterChat] 权限不足', 'error');
      } else {
        message.error(`生成失败: ${errorMessage}`);
      }
      
      // 移除临时AI消息
      setMessages(currentMessages);
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
