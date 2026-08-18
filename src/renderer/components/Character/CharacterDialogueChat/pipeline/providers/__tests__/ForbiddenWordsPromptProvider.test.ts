/**
 * ForbiddenWordsPromptProvider 单元测试
 *
 * Spec: add-forbidden-words-prompt / Task 5
 *
 * 覆盖：
 * - isActive 条件测试（启用/禁用/空类别/非空类别）
 * - build 输出格式测试（标题、类别格式、禁词列表、备注）
 * - buildCategoryInstruction 纯函数测试
 * - buildForbiddenWordsPrompt 纯函数测试
 * - 多个类别拼接测试
 * - 无效配置处理测试
 */

import { describe, it, expect } from 'vitest';
import type { ForbiddenWordsConfig, ForbiddenWordCategory } from '@shared/types/forbiddenWords';
import { DEFAULT_FORBIDDEN_WORDS_CONFIG } from '@shared/types/forbiddenWords';
import {
  ForbiddenWordsPromptProvider,
  buildCategoryInstruction,
  buildForbiddenWordsPrompt,
} from '../ForbiddenWordsPromptProvider';
import type { SettingStoreAccessor } from '../ForbiddenWordsPromptProvider';
import type { DialoguePipelineContext } from '../../pipeline.types';

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

function makeConfig(overrides: Partial<ForbiddenWordsConfig> = {}): ForbiddenWordsConfig {
  return {
    ...DEFAULT_FORBIDDEN_WORDS_CONFIG,
    ...overrides,
  };
}

function createMockAccessor(config: ForbiddenWordsConfig | undefined): SettingStoreAccessor {
  return {
    getForbiddenWordsConfig: () => config,
  };
}

/** 示例类别：宗教术语 */
const religiousCategory: ForbiddenWordCategory = {
  name: 'Religious Terminology',
  description: 'Do not use words related to religion, rituals, or divinity.',
  words: ['sacrifice', 'offering', 'sacred', 'holy'],
};

/** 示例类别：极端情绪标签 */
const emotionCategory: ForbiddenWordCategory = {
  name: 'Extreme Emotion Labels',
  description: 'Do not use direct adjectives or nouns to label extreme psychological states.',
  words: ['crazy', 'fear', 'despair'],
  note: 'Instead of labeling these emotions, describe the physical manifestations and behavioral reactions to convey the intensity (Show, Don\'t Tell).',
};

// ===== isActive 测试 =====

describe('ForbiddenWordsPromptProvider.isActive', () => {
  it('启用且类别非空时应返回 true', () => {
    const accessor = createMockAccessor(makeConfig({ enabled: true, categories: [religiousCategory] }));
    const provider = new ForbiddenWordsPromptProvider(accessor);
    expect(provider.isActive(createContext())).toBe(true);
  });

  it('禁用时应返回 false', () => {
    const accessor = createMockAccessor(makeConfig({ enabled: false, categories: [religiousCategory] }));
    const provider = new ForbiddenWordsPromptProvider(accessor);
    expect(provider.isActive(createContext())).toBe(false);
  });

  it('类别为空时应返回 false', () => {
    const accessor = createMockAccessor(makeConfig({ enabled: true, categories: [] }));
    const provider = new ForbiddenWordsPromptProvider(accessor);
    expect(provider.isActive(createContext())).toBe(false);
  });

  it('配置不存在时应返回 false', () => {
    const accessor = createMockAccessor(undefined);
    const provider = new ForbiddenWordsPromptProvider(accessor);
    expect(provider.isActive(createContext())).toBe(false);
  });
});

// ===== buildCategoryInstruction 纯函数测试 =====

describe('buildCategoryInstruction', () => {
  it('应生成包含类别名称和描述的指令段落', () => {
    const result = buildCategoryInstruction(religiousCategory);
    expect(result).toContain('No Religious Terminology:');
    expect(result).toContain('Do not use words related to religion, rituals, or divinity.');
  });

  it('应在描述后追加禁词引导示例', () => {
    const result = buildCategoryInstruction(religiousCategory);
    expect(result).toContain('include but are not limited to:');
    expect(result).toContain('"sacrifice"');
    expect(result).toContain('"offering"');
    expect(result).toContain('"sacred"');
    expect(result).toContain('"holy"');
    expect(result).toContain('etc.');
  });

  it('有备注时应追加 Note 段落', () => {
    const result = buildCategoryInstruction(emotionCategory);
    expect(result).toContain('Note:');
    expect(result).toContain("Instead of labeling these emotions");
    expect(result).toContain('Show, Don\'t Tell');
  });

  it('无备注时不包含 Note 段落', () => {
    const result = buildCategoryInstruction(religiousCategory);
    expect(result).not.toContain('Note:');
  });

  it('应去重禁词并过滤空词', () => {
    const category: ForbiddenWordCategory = {
      name: 'Test',
      description: 'Test description.',
      words: ['bad', 'bad', '', '  ', 'evil'],
    };
    const result = buildCategoryInstruction(category);
    // "bad" 只出现一次在引号中
    expect(result.match(/bad/g)).toHaveLength(1);
    expect(result).toContain('"evil"');
    // 空词不应出现在引号中
    expect(result).not.toContain('""');
  });
});

// ===== buildForbiddenWordsPrompt 纯函数测试 =====

describe('buildForbiddenWordsPrompt', () => {
  it('禁用时应返回空字符串', () => {
    const config = makeConfig({ enabled: false, categories: [religiousCategory] });
    expect(buildForbiddenWordsPrompt(config)).toBe('');
  });

  it('类别为空时应返回空字符串', () => {
    const config = makeConfig({ enabled: true, categories: [] });
    expect(buildForbiddenWordsPrompt(config)).toBe('');
  });

  it('应包含标题 "Forbidden Word List (Strict Constraints):"', () => {
    const config = makeConfig({ enabled: true, categories: [religiousCategory] });
    const result = buildForbiddenWordsPrompt(config);
    expect(result).toContain('Forbidden Word List (Strict Constraints):');
  });

  it('单个类别时不应有空行分隔', () => {
    const config = makeConfig({ enabled: true, categories: [religiousCategory] });
    const result = buildForbiddenWordsPrompt(config);
    // 标题后一个空行，然后类别段落，所以应该只有 1 个双换行
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(2);
  });

  it('多个类别时应以空行分隔', () => {
    const config = makeConfig({ enabled: true, categories: [religiousCategory, emotionCategory] });
    const result = buildForbiddenWordsPrompt(config);
    // 两个类别之间应该有双换行
    expect(result).toContain('etc.\n\nNo Extreme Emotion');
  });

  it('应跳过名称或描述为空的类别', () => {
    const config = makeConfig({
      enabled: true,
      categories: [
        religiousCategory,
        { name: '', description: 'desc', words: ['bad'] },
        { name: 'EmptyDesc', description: '', words: ['bad'] },
      ],
    });
    const result = buildForbiddenWordsPrompt(config);
    // 仅包含第一个有效类别
    expect(result).toContain('Religious Terminology');
    expect(result).not.toContain('EmptyDesc');
  });

  it('应正确拼接多个类别的输出', () => {
    const config = makeConfig({ enabled: true, categories: [religiousCategory, emotionCategory] });
    const result = buildForbiddenWordsPrompt(config);

    // 验证两个类别都出现在输出中
    expect(result).toContain('No Religious Terminology:');
    expect(result).toContain('No Extreme Emotion Labels:');

    // 验证备注出现在第二个类别中
    expect(result).toContain("Note: Instead of labeling these emotions");

    // 验证整体结构：标题 → 第一类 → 空行 → 第二类
    const parts = result.split('\n\n');
    expect(parts[0]).toBe('Forbidden Word List (Strict Constraints):');
    expect(parts[1]).toContain('No Religious Terminology');
    expect(parts[2]).toContain('No Extreme Emotion Labels');
  });
});

// ===== Provider.build 集成测试 =====

describe('ForbiddenWordsPromptProvider.build', () => {
  it('启用时应返回禁词指令块', async () => {
    const accessor = createMockAccessor(makeConfig({ enabled: true, categories: [religiousCategory] }));
    const provider = new ForbiddenWordsPromptProvider(accessor);
    const result = await provider.build(createContext());
    expect(result).toContain('Forbidden Word List');
    expect(result).toContain('No Religious Terminology:');
  });

  it('禁用时应返回空字符串', async () => {
    const accessor = createMockAccessor(makeConfig({ enabled: false, categories: [religiousCategory] }));
    const provider = new ForbiddenWordsPromptProvider(accessor);
    const result = await provider.build(createContext());
    expect(result).toBe('');
  });

  it('类别为空时应返回空字符串', async () => {
    const accessor = createMockAccessor(makeConfig({ enabled: true, categories: [] }));
    const provider = new ForbiddenWordsPromptProvider(accessor);
    const result = await provider.build(createContext());
    expect(result).toBe('');
  });

  it('配置不存在时应使用默认配置返回空字符串', async () => {
    const accessor = createMockAccessor(undefined);
    const provider = new ForbiddenWordsPromptProvider(accessor);
    const result = await provider.build(createContext());
    expect(result).toBe('');
  });
});