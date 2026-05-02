// 聊天引擎工厂 - 采用工厂模式和单例模式

import { ChatEngine } from './ChatEngine';
import { IChatEngine, AIEngineConfig, EngineFactoryConfig } from './ChatEngine.types';

export class ChatEngineFactory {
  private static instance: ChatEngineFactory | null = null;
  private engines: Map<string, IChatEngine> = new Map();

  private constructor() {}

  static getInstance(): ChatEngineFactory {
    if (!ChatEngineFactory.instance) {
      ChatEngineFactory.instance = new ChatEngineFactory();
    }
    return ChatEngineFactory.instance;
  }

  createEngine(config: EngineFactoryConfig): IChatEngine {
    const engineKey = `${config.engineType}_${config.config.id || 'default'}`;

    if (this.engines.has(engineKey)) {
      return this.engines.get(engineKey)!;
    }

    const engine = this.createEngineByType(config);
    this.engines.set(engineKey, engine);
    return engine;
  }

  private createEngineByType(config: EngineFactoryConfig): IChatEngine {
    switch (config.engineType) {
      case 'default':
      case 'vercel':
      case 'custom':
      default:
        return new ChatEngine();
    }
  }

  getOrCreateDefaultEngine(config: AIEngineConfig): IChatEngine {
    return this.createEngine({
      engineType: 'default',
      config,
    });
  }

  clearEngineCache(): void {
    this.engines.clear();
  }
}
