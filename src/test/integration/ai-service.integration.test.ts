import { describe, it, expect } from 'vitest';
import { AIService, AIServiceConfig, AIRequestOptions, AIStreamOptions } from '../../renderer/components/Common/AIService';

describe('AIService Integration Tests (Local AI Server)', () => {
  // 使用本地服务器 http://127.0.0.1:5000
  const localConfig: AIServiceConfig = {
    defaultBaseUrl: 'http://127.0.0.1:5000',
    defaultApiKey: 'no-key-needed',
    defaultModel: 'gpt-3.5-turbo',
    defaultTemperature: 0.7,
    defaultMaxTokens: 1000,
  };

  console.log(`Testing with local AI server: ${localConfig.defaultBaseUrl}`);

  it('should send a simple chat request and get a valid response', async () => {
    const service = new AIService(localConfig);
    console.log('Service config:', service.getConfig());
    
    const options: AIRequestOptions = {
      model: localConfig.defaultModel,
      messages: [{ role: 'user', content: 'Say "Hello World" in one sentence.' }],
    };
    console.log('Request options:', options);

    const result = await service.sendChatRequest(options);
    console.log('Result:', result);

    expect(result.status).toBe('success');
    expect(result.response).toBeDefined();
    expect(result.response?.content).toBeDefined();
    expect(typeof result.response?.content).toBe('string');
    expect(result.response?.content.length).toBeGreaterThan(0);
    console.log('Chat response:', result.response?.content);
  }, 30000);

  it('should send a streaming chat request and receive incremental content', async () => {
    const service = new AIService(localConfig);
    const options: AIRequestOptions = {
      model: localConfig.defaultModel,
      messages: [{ role: 'user', content: 'Say "Hello World" one word at a time.' }],
    };

    let receivedContent = '';
    let chunkCount = 0;
    let isComplete = false;
    let errorOccurred = null;

    const streamOptions: AIStreamOptions = {
      onStream: (content, done) => {
        if (content) {
          receivedContent += content;
          chunkCount++;
          console.log(`Chunk ${chunkCount}: "${content}"`);
        }
        if (done) isComplete = true;
      },
      onError: (error) => {
        errorOccurred = error;
        console.error('Stream error:', error);
      },
      onComplete: (response) => {
        console.log('Stream complete:', response);
      },
    };

    await service.sendStreamChatRequest(options, streamOptions);

    expect(errorOccurred).toBeNull();
    expect(receivedContent.length).toBeGreaterThan(0);
    expect(chunkCount).toBeGreaterThan(0);
    expect(isComplete).toBe(true);
    console.log('Final received content:', receivedContent);
  }, 60000);
});
