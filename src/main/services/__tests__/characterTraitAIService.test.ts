/**
 * CharacterTraitAIService 单元测试 — AI 兜底标签审核（Spec: add-ai-fallback-tag-audit）
 *
 * 验证目标：
 *   1. buildAiFallbackUserMessage：构建 user 消息（角色上下文 + 未匹配 tag 列表）
 *      - description 必填；personality/scenario 可选；未匹配 tag 每行一个
 *   2. parseAiFallbackResponse：解析 LLM 输出为 Map<originalTag, candidates[]>
 *      - 按 `<original_tag> | candidate1, candidate2` 格式逐行解析
 *      - 候选词去重 + 上限 4 个；只解析 unmatchedTags 中存在的 tag（防 LLM 臆造）
 *      - 中文/英文逗号兼容；空行/无 `|` 行跳过
 *   3. applyAiFallback：候选词再验证 + 替换 trait + 持久化映射 + 标记 source
 *      - 候选词一次性调 validateTagsAgainstLibrary 走 L0-L4
 *      - 首个 isValid 候选词替换 trait.text + addMapping 持久化 + source='ai-fallback'
 *      - 全部未命中 → aiFallbackAttempted=true，trait 不变
 *      - 空 candidatesMap → 全部标记 attempted，返回 0
 *
 * 测试策略：
 *   - 私有方法通过 `(service as any).methodName` 访问（TS 私有仅编译期检查，运行时可见）
 *   - mock tagRagService.validateTagsAgainstLibrary + userSynonymMapService.addMapping
 *   - 不调真实 LLM（generateTagSynonymsBatch 的 fetch 路径不在本测试范围）
 *
 * ⚠️ 真实 LLM 调用 / 多模态图片读取 / 端到端 generateCharacterTraits 集成未验证：
 *   - generateTagSynonymsBatch 的 fetch 网络行为未验证（需 mock fetch + Electron 集成）
 *   - includeImage=true 时 PNG base64 读取未验证
 *   - generateCharacterTraits 主流程的 AI 兜底插入位置未端到端验证（需 mock 全部依赖）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============ Mock 依赖服务（确保 import characterTraitAIService 前 mock 就绪） ============
// tagRagService / userSynonymMapService 是 characterTraitAIService 的模块级依赖，
// 必须 vi.mock 整个模块，否则会触发 tagRagService 的真实初始化（依赖 sqlite-vec 原生模块）

const tagRagServiceMocks = vi.hoisted(() => ({
  validateTagsAgainstLibrary: vi.fn(),
}));

vi.mock('../tagRagService', () => ({
  tagRagService: {
    validateTagsAgainstLibrary: tagRagServiceMocks.validateTagsAgainstLibrary,
  },
}));

const userSynonymMapServiceMocks = vi.hoisted(() => ({
  addMapping: vi.fn(),
}));

vi.mock('../userSynonymMapService', () => ({
  userSynonymMapService: {
    addMapping: userSynonymMapServiceMocks.addMapping,
  },
}));

// AIConfigProvider / storageService / categoryDictionaryService 仅在 generateCharacterTraits
// 主流程中调用，本测试不测主流程，mock 为最小桩避免 import 副作用
vi.mock('../ai/AIConfigProvider', () => ({
  aiConfigProvider: {
    getAIConfig: vi.fn(),
  },
}));

vi.mock('../storageService', () => ({
  getStorageService: vi.fn(() => ({})),
}));

vi.mock('../categoryDictionaryService', () => ({
  categoryDictionaryService: {
    loadDictionary: vi.fn(() => ({ categories: [] })),
  },
}));

import { characterTraitAIService } from '../characterTraitAIService';
import type { CategorizedTrait } from '../../../../shared/types/characterTrait.types';

/**
 * 构造一个最小可用的 tagValidation 项（用于 applyAiFallback 测试）。
 * 仅包含 applyAiFallback 会读写的字段。
 */
function makeValidationItem(tag: string) {
  return {
    tag,
    isValid: false,
    suggestions: [],
    // applyAiFallback 会写入：aiFallbackAttempted / aiFallbackCandidates / replacedBy / source
  };
}

describe('CharacterTraitAIService — AI 兜底标签审核', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============ buildAiFallbackUserMessage ============
  describe('buildAiFallbackUserMessage', () => {
    const service: any = characterTraitAIService;

    it('description 必填：仅 description 时输出角色描述 + 未匹配 tag 列表', () => {
      const msg = service.buildAiFallbackUserMessage(
        ['B-cup', 'brimless cap'],
        'A dog girl with white fur.'
      );
      expect(msg).toContain('角色描述：');
      expect(msg).toContain('A dog girl with white fur.');
      expect(msg).toContain('未匹配标签列表（每个标签占一行）：');
      expect(msg).toContain('B-cup');
      expect(msg).toContain('brimless cap');
      // 未传 personality/scenario 时不应包含这两个段落标题
      expect(msg).not.toContain('角色性格：');
      expect(msg).not.toContain('角色场景：');
    });

    it('personality + scenario 可选：传入时追加对应段落', () => {
      const msg = service.buildAiFallbackUserMessage(
        ['B-cup'],
        'desc',
        'cheerful and brave',
        'in a forest'
      );
      expect(msg).toContain('角色性格：');
      expect(msg).toContain('cheerful and brave');
      expect(msg).toContain('角色场景：');
      expect(msg).toContain('in a forest');
    });

    it('未匹配 tag 列表为空时仍输出空列表段落（不报错）', () => {
      const msg = service.buildAiFallbackUserMessage([], 'desc');
      // 空数组 join('\n') 得到空字符串，但段落标题仍存在
      expect(msg).toContain('未匹配标签列表（每个标签占一行）：');
      expect(msg).toContain('请按系统提示词的格式输出');
    });

    it('description 前后空白被 trim', () => {
      const msg = service.buildAiFallbackUserMessage(['tag'], '   spaced desc   ');
      // parts.join('\n\n') 分隔段落：角色描述：\n\n<trimmed desc>
      // trim 后 description 不含前后空格（中间空格保留）
      expect(msg).toContain('角色描述：\n\nspaced desc');
      // 不应出现「段落标题 + 分隔 + 前导空格」的未 trim 痕迹
      expect(msg).not.toMatch(/角色描述：\n\n\s+spaced/);
    });
  });

  // ============ parseAiFallbackResponse ============
  describe('parseAiFallbackResponse', () => {
    const service: any = characterTraitAIService;

    it('正常多行解析：每行 `<tag> | c1, c2` 转为 Map<tag, [c1, c2]>', () => {
      const content = 'B-cup | medium_breasts, small_breasts\nbrimless cap | hat, cap';
      const result = service.parseAiFallbackResponse(content, ['B-cup', 'brimless cap']);
      expect(result.size).toBe(2);
      expect(result.get('B-cup')).toEqual(['medium_breasts', 'small_breasts']);
      expect(result.get('brimless cap')).toEqual(['hat', 'cap']);
    });

    it('空内容 / 非 string 返回空 Map', () => {
      expect(service.parseAiFallbackResponse('', ['tag']).size).toBe(0);
      expect(service.parseAiFallbackResponse(null as any, ['tag']).size).toBe(0);
      expect(service.parseAiFallbackResponse(undefined as any, ['tag']).size).toBe(0);
    });

    it('行无 `|` 分隔符或 `|` 在行首跳过', () => {
      const content = 'no pipe line\n| leading pipe\nB-cup | medium_breasts';
      const result = service.parseAiFallbackResponse(content, ['B-cup']);
      expect(result.size).toBe(1);
      expect(result.get('B-cup')).toEqual(['medium_breasts']);
    });

    it('候选词去重（大小写不敏感）', () => {
      const content = 'B-cup | medium_breasts, Medium_Breasts, small_breasts';
      const result = service.parseAiFallbackResponse(content, ['B-cup']);
      expect(result.get('B-cup')).toEqual(['medium_breasts', 'small_breasts']);
    });

    it('候选词上限 4 个（超出截断）', () => {
      const content = 'tag | a, b, c, d, e, f';
      const result = service.parseAiFallbackResponse(content, ['tag']);
      expect(result.get('tag')).toHaveLength(4);
      expect(result.get('tag')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('原始 tag 不在 unmatchedTags 中跳过（防 LLM 臆造）', () => {
      const content = 'B-cup | medium_breasts\nfake_tag | something';
      const result = service.parseAiFallbackResponse(content, ['B-cup']);
      expect(result.size).toBe(1);
      expect(result.has('fake_tag')).toBe(false);
    });

    it('中文逗号与英文逗号均可作候选词分隔符', () => {
      const content = 'B-cup | medium_breasts，small_breasts，breasts';
      const result = service.parseAiFallbackResponse(content, ['B-cup']);
      expect(result.get('B-cup')).toEqual(['medium_breasts', 'small_breasts', 'breasts']);
    });

    it('原始 tag 大小写不敏感匹配 unmatchedTags（保留 unmatchedTags 原始大小写作 key）', () => {
      // LLM 输出 `b-cup`（小写），unmatchedTags 含 `B-cup`（原值）→ 命中，key 为原值 `B-cup`
      const content = 'b-cup | medium_breasts';
      const result = service.parseAiFallbackResponse(content, ['B-cup']);
      expect(result.size).toBe(1);
      expect(result.get('B-cup')).toEqual(['medium_breasts']);
    });
  });

  // ============ applyAiFallback ============
  describe('applyAiFallback', () => {
    const service: any = characterTraitAIService;

    it('首个 isValid 候选词命中 → 替换 trait.text + 持久化映射 + source=ai-fallback', async () => {
      const target = makeValidationItem('B-cup');
      const traits: CategorizedTrait[] = [
        { text: 'B-cup', categoryId: 'body' },
      ];
      const candidatesMap = new Map([['B-cup', ['medium_breasts', 'small_breasts']]]);
      // validateTagsAgainstLibrary：medium_breasts valid, small_breasts invalid
      tagRagServiceMocks.validateTagsAgainstLibrary.mockResolvedValue([
        { tag: 'medium_breasts', isValid: true, canonicalName: 'medium_breasts' },
        { tag: 'small_breasts', isValid: false, suggestions: [] },
      ]);

      const hitCount = await service.applyAiFallback([target], candidatesMap, traits);

      expect(hitCount).toBe(1);
      // trait.text 被替换为 canonicalName
      expect(traits[0].text).toBe('medium_breasts');
      // tagValidation 项写入 expected 字段
      expect(target.replacedBy).toBe('medium_breasts');
      expect(target.source).toBe('ai-fallback');
      expect(target.aiFallbackAttempted).toBe(true);
      expect(target.aiFallbackCandidates).toEqual(['medium_breasts', 'small_breasts']);
      // 持久化映射被调用
      expect(userSynonymMapServiceMocks.addMapping).toHaveBeenCalledWith('B-cup', 'medium_breasts');
    });

    it('全部候选词未命中 → aiFallbackAttempted=true，trait.text 不变，不持久化', async () => {
      const target = makeValidationItem('xyz');
      const traits: CategorizedTrait[] = [{ text: 'xyz', categoryId: 'uncategorized' }];
      const candidatesMap = new Map([['xyz', ['abc', 'def']]]);
      tagRagServiceMocks.validateTagsAgainstLibrary.mockResolvedValue([
        { tag: 'abc', isValid: false, suggestions: [] },
        { tag: 'def', isValid: false, suggestions: [] },
      ]);

      const hitCount = await service.applyAiFallback([target], candidatesMap, traits);

      expect(hitCount).toBe(0);
      expect(traits[0].text).toBe('xyz'); // 未变
      expect(target.replacedBy).toBeUndefined();
      expect(target.source).toBeUndefined();
      expect(target.aiFallbackAttempted).toBe(true);
      expect(target.aiFallbackCandidates).toEqual(['abc', 'def']);
      expect(userSynonymMapServiceMocks.addMapping).not.toHaveBeenCalled();
    });

    it('空 candidatesMap（LLM 未返回候选词）→ 全部标记 attempted，返回 0，不调 validate', async () => {
      const target1 = makeValidationItem('tag1');
      const target2 = makeValidationItem('tag2');
      const traits: CategorizedTrait[] = [
        { text: 'tag1', categoryId: 'uncategorized' },
        { text: 'tag2', categoryId: 'uncategorized' },
      ];
      const candidatesMap = new Map<string, string[]>(); // 空

      const hitCount = await service.applyAiFallback([target1, target2], candidatesMap, traits);

      expect(hitCount).toBe(0);
      expect(target1.aiFallbackAttempted).toBe(true);
      expect(target2.aiFallbackAttempted).toBe(true);
      expect(target1.aiFallbackCandidates).toBeUndefined();
      // 空 candidates 不应触发 validateTagsAgainstLibrary
      expect(tagRagServiceMocks.validateTagsAgainstLibrary).not.toHaveBeenCalled();
      expect(userSynonymMapServiceMocks.addMapping).not.toHaveBeenCalled();
    });

    it('多 tag 混合：tag1 命中 + tag2 未命中 → hitCount=1，候选词跨 tag 去重一次性验证', async () => {
      const target1 = makeValidationItem('B-cup');
      const target2 = makeValidationItem('xyz');
      const traits: CategorizedTrait[] = [
        { text: 'B-cup', categoryId: 'body' },
        { text: 'xyz', categoryId: 'uncategorized' },
      ];
      // tag1 候选词 medium_breasts（valid）→ 命中；tag2 候选词全部 invalid → 未命中
      const candidatesMap = new Map([
        ['B-cup', ['medium_breasts', 'small_breasts']],
        ['xyz', ['unknown_tag', 'other_unknown']],
      ]);
      // validateTagsAgainstLibrary 收到去重后的 4 个候选词
      tagRagServiceMocks.validateTagsAgainstLibrary.mockResolvedValue([
        { tag: 'medium_breasts', isValid: true, canonicalName: 'medium_breasts' },
        { tag: 'small_breasts', isValid: false, suggestions: [] },
        { tag: 'unknown_tag', isValid: false, suggestions: [] },
        { tag: 'other_unknown', isValid: false, suggestions: [] },
      ]);

      const hitCount = await service.applyAiFallback(
        [target1, target2],
        candidatesMap,
        traits
      );

      expect(hitCount).toBe(1);
      // tag1 命中 → trait 替换 + 持久化
      expect(traits[0].text).toBe('medium_breasts');
      expect(target1.replacedBy).toBe('medium_breasts');
      expect(target1.source).toBe('ai-fallback');
      // tag2 未命中 → trait 不变 + attempted 标记
      expect(traits[1].text).toBe('xyz');
      expect(target2.replacedBy).toBeUndefined();
      expect(target2.source).toBeUndefined();
      expect(target2.aiFallbackAttempted).toBe(true);
      expect(target2.aiFallbackCandidates).toEqual(['unknown_tag', 'other_unknown']);
      // 验证只调了一次 validateTagsAgainstLibrary（候选词跨 tag 去重一次性验证）
      expect(tagRagServiceMocks.validateTagsAgainstLibrary).toHaveBeenCalledTimes(1);
      // 仅 tag1 持久化（tag2 未命中不持久化）
      expect(userSynonymMapServiceMocks.addMapping).toHaveBeenCalledTimes(1);
      expect(userSynonymMapServiceMocks.addMapping).toHaveBeenCalledWith(
        'B-cup',
        'medium_breasts'
      );
    });

    it('候选词命中但 trait 已不存在（被用户删除）→ 跳过替换，不计入 hitCount', async () => {
      const target = makeValidationItem('B-cup');
      // traits 中无 text==='B-cup' 的项（模拟用户已手动删除）
      const traits: CategorizedTrait[] = [{ text: 'other', categoryId: 'body' }];
      const candidatesMap = new Map([['B-cup', ['medium_breasts']]]);
      tagRagServiceMocks.validateTagsAgainstLibrary.mockResolvedValue([
        { tag: 'medium_breasts', isValid: true, canonicalName: 'medium_breasts' },
      ]);

      const hitCount = await service.applyAiFallback([target], candidatesMap, traits);

      expect(hitCount).toBe(0);
      // target 仍标记 attempted + candidates，但 replacedBy/source 未设（因 trait 未找到跳过）
      expect(target.aiFallbackAttempted).toBe(true);
      expect(target.aiFallbackCandidates).toEqual(['medium_breasts']);
      expect(target.replacedBy).toBeUndefined();
      expect(target.source).toBeUndefined();
      // 持久化未调用（替换未发生）
      expect(userSynonymMapServiceMocks.addMapping).not.toHaveBeenCalled();
    });
  });
});
