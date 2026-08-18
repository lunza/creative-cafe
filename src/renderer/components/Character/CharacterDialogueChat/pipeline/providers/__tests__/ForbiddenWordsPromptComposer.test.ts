/**
 * 禁词表提示词拼接集成测试
 *
 * 模拟 PromptComposer 的完整拼接过程，验证 ForbiddenWordsPromptProvider
 * 注入的指令块在 system prompt 中的位置和格式是否正确。
 *
 * 测试场景：
 * 1. 启用禁词表 → 输出末尾包含 Forbidden Word List 指令块
 * 2. 禁用禁词表 → 输出末尾不包含指令块
 * 3. 空类别 → 输出末尾不包含指令块
 * 4. 与其他 Provider 共存 → 指令块位于 suffix 区域末尾
 * 5. 默认预置类别（两个） → 输出包含两个类别段落
 */

import { describe, it, expect } from 'vitest';
import type { ForbiddenWordsConfig } from '@shared/types/forbiddenWords';
import { DEFAULT_FORBIDDEN_WORDS_CONFIG } from '@shared/types/forbiddenWords';
import { PromptComposer } from '../../PromptComposer';
import { ForbiddenWordsPromptProvider } from '../ForbiddenWordsPromptProvider';
import type { SettingStoreAccessor } from '../ForbiddenWordsPromptProvider';
import type { PromptProvider, DialoguePipelineContext } from '../../pipeline.types';

// ===== 测试辅助函数 =====

function createContext(): DialoguePipelineContext {
  return {
    userInput: '',
    userIntent: { type: 'dialogue', confidence: 1 },
    characterInfo: {} as any,
    sessionConfig: {} as any,
    activeEngine: {} as any,
    pipelineMode: 'dialogue',
    retrievedContext: { knowledgeBase: [], chatHistory: [], memoryTableData: '', memoryTableStructure: null },
    systemPrompt: '',
    messagesToSend: [],
    engineConfig: {} as any,
    stopSequences: [],
    rawResponse: '',
    streamingContent: '',
    aiIntents: [],
    processedContent: '',
    emotion: null,
    suggestedOptions: null,
    tableEditCommands: null,
    imageGenRequests: null,
    thinkContent: null,
    dedupInfo: null,
    logs: [],
    metrics: { totalDuration: 0, stageDurations: {}, stageCounts: {} },
    errors: [],
  };
}

function createMockAccessor(config: ForbiddenWordsConfig | undefined): SettingStoreAccessor {
  return {
    getForbiddenWordsConfig: () => config,
  };
}

/** 模拟 header 区域 Provider — 用于验证禁词指令块位于末尾 */
class MockHeaderProvider implements PromptProvider {
  readonly name = 'MockHeaderProvider';
  readonly priority = 0;
  readonly section = 'header' as const;
  isActive() { return true; }
  async build() { return 'This is the header section of the system prompt.'; }
}

/** 模拟 context 区域 Provider */
class MockContextProvider implements PromptProvider {
  readonly name = 'MockContextProvider';
  readonly priority = 100;
  readonly section = 'context' as const;
  isActive() { return true; }
  async build() { return 'Character context information here.'; }
}

/** 模拟 instruction 区域 Provider */
class MockInstructionProvider implements PromptProvider {
  readonly name = 'MockInstructionProvider';
  readonly priority = 300;
  readonly section = 'instruction' as const;
  isActive() { return true; }
  async build() { return 'You are a roleplaying assistant. Follow the rules below.'; }
}

/** 模拟 suffix 区域的其他 Provider — 验证禁词指令块位于其之后 */
class MockFormatProvider implements PromptProvider {
  readonly name = 'MockFormatProvider';
  readonly priority = 450;
  readonly section = 'suffix' as const;
  isActive() { return true; }
  async build() { return 'Format your responses using *actions* and "dialogue".'; }
}

// ===== 测试用例 =====

describe('禁词表提示词拼接集成测试', () => {
  it('启用禁词表时，Forbidden Word List 出现在提示词末尾', async () => {
    const accessor = createMockAccessor({
      enabled: true,
      categories: [
        {
          name: 'Religious Terminology',
          description: 'Do not use words related to religion, rituals, or divinity.',
          words: ['sacrifice', 'offering', 'sacred', 'holy'],
        },
      ],
    });

    const composer = new PromptComposer();
    composer.registerProvider(new MockHeaderProvider());
    composer.registerProvider(new MockContextProvider());
    composer.registerProvider(new MockInstructionProvider());
    composer.registerProvider(new MockFormatProvider());
    composer.registerProvider(new ForbiddenWordsPromptProvider(accessor));

    const result = await composer.compose(createContext());

    // 验证总体结构：完整的提示词应该包含所有段落
    expect(result).toContain('This is the header section');
    expect(result).toContain('Character context information');
    expect(result).toContain('You are a roleplaying assistant');
    expect(result).toContain('Format your responses');

    // 验证禁词指令块出现在末尾（suffix 区域，在格式指令之后）
    expect(result).toContain('Forbidden Word List (Strict Constraints):');
    expect(result).toContain('No Religious Terminology:');
    expect(result).toContain('include but are not limited to:');
    expect(result).toContain('"sacrifice"');

    // 验证禁词块在格式指令之后（suffix 区域内部按 priority 排序：450 → 460）
    const formatIndex = result.indexOf('Format your responses');
    const forbiddenIndex = result.indexOf('Forbidden Word List');
    expect(forbiddenIndex).toBeGreaterThan(formatIndex);

    // 验证禁词块是提示词的最后输出（其后无其他 provider 内容）
    const tail = result.slice(forbiddenIndex);
    expect(tail).not.toContain('Format your responses');
    expect(tail).not.toContain('This is the header section');
  });

  it('禁用禁词表时，提示词中不包含 Forbidden Word List', async () => {
    const accessor = createMockAccessor({
      enabled: false,
      categories: [
        {
          name: 'Religious Terminology',
          description: 'Do not use words related to religion.',
          words: ['sacrifice'],
        },
      ],
    });

    const composer = new PromptComposer();
    composer.registerProvider(new MockHeaderProvider());
    composer.registerProvider(new MockFormatProvider());
    composer.registerProvider(new ForbiddenWordsPromptProvider(accessor));

    const result = await composer.compose(createContext());

    expect(result).toContain('This is the header section');
    expect(result).toContain('Format your responses');
    expect(result).not.toContain('Forbidden Word List');
    expect(result).not.toContain('No Religious Terminology');
  });

  it('类别为空时，提示词中不包含 Forbidden Word List', async () => {
    const accessor = createMockAccessor({
      enabled: true,
      categories: [],
    });

    const composer = new PromptComposer();
    composer.registerProvider(new MockHeaderProvider());
    composer.registerProvider(new ForbiddenWordsPromptProvider(accessor));

    const result = await composer.compose(createContext());

    expect(result).toContain('This is the header section');
    expect(result).not.toContain('Forbidden Word List');
  });

  it('默认预置的两个类别应正确拼接', async () => {
    const accessor = createMockAccessor({
      enabled: true,
      categories: DEFAULT_FORBIDDEN_WORDS_CONFIG.categories,
    });

    const composer = new PromptComposer();
    composer.registerProvider(new MockHeaderProvider());
    composer.registerProvider(new ForbiddenWordsPromptProvider(accessor));

    const result = await composer.compose(createContext());

    // 验证两个类别都出现
    expect(result).toContain('No Religious Terminology:');
    expect(result).toContain('No Extreme Emotion Labels:');

    // 验证类别包含中文注释（用户配置中的(献祭)等）
    expect(result).toContain('sacrifice (献祭)');
    expect(result).toContain('crazy (疯狂)');

    // 验证备注出现
    expect(result).toContain("Show, Don't Tell");

    // 验证禁词块在末尾（其后无其他 provider 内容）
    const forbiddenIdx = result.indexOf('Forbidden Word List');
    const tail = result.slice(forbiddenIdx);
    expect(tail).not.toContain('This is the header section');
    expect(tail).not.toContain('Format your responses');
  });

  it('多个 Provider 共存时，禁词块不影响其他 Provider 的输出', async () => {
    const accessor = createMockAccessor({
      enabled: true,
      categories: [
        {
          name: 'Test Category',
          description: 'Test description.',
          words: ['badword'],
        },
      ],
    });

    const composer = new PromptComposer();
    // 注册多个同 section 的 Provider 验证排序
    composer.registerProvider(new ForbiddenWordsPromptProvider(accessor));
    composer.registerProvider(new MockHeaderProvider());
    composer.registerProvider(new MockFormatProvider());
    composer.registerProvider(new MockInstructionProvider());
    composer.registerProvider(new MockContextProvider());

    const result = await composer.compose(createContext());

    // 验证各 section 内容完整
    expect(result).toContain('This is the header section');
    expect(result).toContain('Character context information');
    expect(result).toContain('You are a roleplaying assistant');
    expect(result).toContain('Format your responses');
    expect(result).toContain('Forbidden Word List');
    expect(result).toContain('No Test Category:');

    // 验证 section 顺序：header → context → instruction → suffix
    const headerIdx = result.indexOf('This is the header section');
    const contextIdx = result.indexOf('Character context information');
    const instructionIdx = result.indexOf('You are a roleplaying assistant');
    const suffixIdx = result.indexOf('Format your responses');
    const forbiddenIdx = result.indexOf('Forbidden Word List');

    expect(headerIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(instructionIdx);
    expect(instructionIdx).toBeLessThan(suffixIdx);
    expect(suffixIdx).toBeLessThan(forbiddenIdx);
  });
});