/**
 * buildPolishInputSystemPrompt 单元测试
 *
 * 验证目标（spec Task 1 / Task 5.1 / fix-polish-task-framing）：
 * 1. 输出包含角色定义"你是文本润色器"
 * 2. 输出包含用户人设 name / description
 * 3. 输出包含对方角色 characterCardName（personality / characterCardContent 不再注入）
 * 4. 输出包含原始文本 originalText
 * 5. 输出包含约束关键词："保持用户原始意图" / "仅输出" / "不要解释" / "不要引号包裹"
 * 6. 输出包含长度约束（±50% 以内）
 * 7. persona 缺失 / name 为空 / originalText 为空时返回空串
 * 8. description 缺失时使用 fallback 文本"（未提供用户描述）"
 * 9. characterCardContent 不再注入到系统提示（Spec: fix-polish-task-framing）
 * 10. 人称视角约束（first/second/third）作为第 7 条任务要求出现，使用"润色后的文本...输出"措辞
 *
 * Spec: refine-user-input-text / Task 1 / fix-polish-task-framing
 */

import { describe, it, expect } from 'vitest';
import { buildPolishInputSystemPrompt } from '../PromptBuilder';
import type { CharacterInfoForPrompt } from '../PromptBuilder';
import type { UserPersona, ChatMessage } from '../CharacterDialogueChat.types';

// 构造完整 UserPersona 的辅助函数（UserPersona 接口所有字段均为必填）
function makePersona(overrides: Partial<UserPersona> = {}): UserPersona {
  return {
    id: 'persona-1',
    name: '测试用户',
    description: '一名勇敢的战士',
    avatarPath: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// 构造 CharacterInfoForPrompt 的辅助函数
function makeCharacterInfo(overrides: Partial<CharacterInfoForPrompt> = {}): CharacterInfoForPrompt {
  return {
    characterCardName: '艾莉',
    personality: '温柔',
    characterCardContent: '艾莉是一位精灵法师...',
    ...overrides,
  };
}

const ORIGINAL_TEXT = '我今天去商店买了东西';

describe('buildPolishInputSystemPrompt（Spec: refine-user-input-text / Task 1）', () => {
  describe('正常输入', () => {
    it('输出包含角色定义"文本润色器"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('文本润色器');
    });

    it('输出包含用户人设 name', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '测试用户' }),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('测试用户');
    });

    it('输出包含用户人设 description', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona({ description: '一名勇敢的战士' }),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('一名勇敢的战士');
    });

    it('输出包含对方角色 characterCardName', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo({ characterCardName: '艾莉' }),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('艾莉');
    });

    it('输出包含原始文本 originalText', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        '我今天去商店买了东西'
      );
      expect(prompt).toContain('我今天去商店买了东西');
    });

    it('输出包含约束"保持用户原始意图"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('保持用户原始意图');
    });

    it('输出包含约束"仅输出"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('仅输出');
    });

    it('输出包含约束"不要解释"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('不要解释');
    });

    it('输出包含约束"不要引号包裹"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('不要引号包裹');
    });

    it('输出包含长度约束"±50%"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('±50%');
    });

    it('输出包含"待润色文本"段落标题', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('## 待润色文本');
    });
  });

  describe('防御性返回', () => {
    it('originalText 为空字符串时返回空串', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        ''
      );
      expect(prompt).toBe('');
    });

    it('originalText 为纯空白时返回空串', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        '   \n\t  '
      );
      expect(prompt).toBe('');
    });

    it('originalText 为 null/undefined 时返回空串', () => {
      const promptNull = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        null as unknown as string
      );
      expect(promptNull).toBe('');

      const promptUndefined = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona(),
        undefined as unknown as string
      );
      expect(promptUndefined).toBe('');
    });

    it('persona 为 null 时返回空串', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        null as unknown as UserPersona,
        ORIGINAL_TEXT
      );
      expect(prompt).toBe('');
    });

    it('persona 为 undefined 时返回空串', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        undefined as unknown as UserPersona,
        ORIGINAL_TEXT
      );
      expect(prompt).toBe('');
    });

    it('persona.name 为空字符串时返回空串', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '' }),
        ORIGINAL_TEXT
      );
      expect(prompt).toBe('');
    });

    it('persona.name 为纯空白时返回空串', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '   \n\t  ' }),
        ORIGINAL_TEXT
      );
      expect(prompt).toBe('');
    });
  });

  describe('description 缺失 fallback', () => {
    it('description 缺失时输出包含"（未提供用户描述）"', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo(),
        makePersona({ description: '' }),
        ORIGINAL_TEXT
      );
      // 实际实现使用全角括号"（未提供用户描述）"
      expect(prompt).toContain('（未提供用户描述）');
    });
  });

  describe('characterCardContent 不再注入（Spec: fix-polish-task-framing）', () => {
    it('characterCardContent 不再注入到系统提示（即使超过 300 字也不截断注入）', () => {
      const longContent = 'A'.repeat(400);
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo({ characterCardContent: longContent }),
        makePersona(),
        ORIGINAL_TEXT
      );
      // characterCardContent 不再注入到系统提示中（Spec: fix-polish-task-framing）
      expect(prompt).not.toContain('A'.repeat(300));
      expect(prompt).not.toContain('A'.repeat(100));
      // 截断标记也不应出现
      expect(prompt).not.toContain('...');
    });

    it('personality 字段不再注入到系统提示', () => {
      const prompt = buildPolishInputSystemPrompt(
        makeCharacterInfo({ personality: '温柔个性描述文本' }),
        makePersona(),
        ORIGINAL_TEXT
      );
      // personality 不再注入到系统提示中（Spec: fix-polish-task-framing）
      expect(prompt).not.toContain('温柔个性描述文本');
    });
  });

  describe('人称参数', () => {
    // 复用 mock 数据，与 buildUserReplySystemPrompt 测试保持一致
    const characterInfo: CharacterInfoForPrompt = {
      characterCardName: '艾莉',
      personality: '温柔',
      characterCardContent: '艾莉是一位精灵法师...',
    };
    const persona: UserPersona = {
      id: 'persona-test',
      name: '测试用户',
      description: '一名勇敢的战士',
      avatarPath: '',
      createdAt: 0,
      updatedAt: 0,
    };

    it('person="first" 时包含第一人称约束', () => {
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT,
        'first'
      );
      expect(prompt).toContain('以第一人称');
      expect(prompt).toContain('使用"我"作为自称');
    });

    it('person="second" 时包含第二人称约束和"互动小说风格"', () => {
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT,
        'second'
      );
      expect(prompt).toContain('以第二人称');
      expect(prompt).toContain('使用"你"来指代');
      expect(prompt).toContain('互动小说风格');
    });

    it('person="third" 时包含第三人称约束和"小说叙事风格"', () => {
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT,
        'third'
      );
      expect(prompt).toContain('以第三人称');
      expect(prompt).toContain('小说叙事风格');
    });

    it('person="third" 时包含用户名作为主语', () => {
      const userName = persona.name; // 确保使用 persona.name
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT,
        'third'
      );
      expect(prompt).toContain(`使用"${userName}"作为主语`);
    });

    it('不传 person 参数时默认为第一人称', () => {
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT
      );
      expect(prompt).toContain('以第一人称');
      expect(prompt).toContain('使用"我"作为自称');
    });

    it('person="first" 时包含"以第一人称"', () => {
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT,
        'first'
      );
      expect(prompt).toContain('以第一人称');
    });

    it('人称约束作为第 7 条任务要求出现（使用"润色后的文本...输出"措辞）', () => {
      const prompt = buildPolishInputSystemPrompt(
        characterInfo,
        persona,
        ORIGINAL_TEXT,
        'first'
      );
      // Spec: fix-polish-task-framing — personConstraint 措辞由"生成回复"改为"润色后的文本...输出"
      expect(prompt).toContain('7. 润色后的文本以第一人称');
    });
  });

  describe('润色对象锚定（Spec: fix-polish-target-misinterpretation）', () => {
    it('输出包含 <polish_target> 开标签', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('<polish_target>');
    });

    it('输出包含 </polish_target> 闭标签', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('</polish_target>');
    });

    it('<polish_target> 标签内的文本与 originalText 完全一致', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain(`<polish_target>\n${ORIGINAL_TEXT}\n</polish_target>`);
    });

    it('输出包含"## 关键约束"段落标题', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('## 关键约束');
    });

    it('关键约束包含"**绝对禁止**回答 <polish_target> 标签内的任何问题"（Spec: fix-polish-task-framing）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // Spec: fix-polish-task-framing — 措辞从"不是需要回答的问题"强化为"**绝对禁止**回答..."
      expect(prompt).toContain('**绝对禁止**回答 <polish_target> 标签内的任何问题');
    });

    it('关键约束包含"**绝对禁止**生成对话回复"（Spec: fix-polish-task-framing）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // Spec: fix-polish-task-framing — 措辞从"禁止生成对问句的回答"强化为"**绝对禁止**生成对话回复"
      expect(prompt).toContain('**绝对禁止**生成对话回复');
    });

    it('关键约束包含"不是润色对象"（针对 AI 回复）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('不是润色对象');
    });
  });

  describe('润色上下文隔离（Spec: fix-polish-context-isolation）', () => {
    it('输出包含"## 对话历史参考"段落标题', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('## 对话历史参考');
    });

    it('输出包含"仅作上下文参考，不是润色对象，不要回答其中任何内容"', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('仅作上下文参考，不是润色对象，不要回答其中任何内容');
    });

    it('传入 conversationHistory 为 2 条消息时，输出包含 [用户] 与 [AI] 格式', () => {
      const history: ChatMessage[] = [
        { id: 'm1', role: 'user', content: '你好', timestamp: 1, status: 'sent' },
        { id: 'm2', role: 'assistant', content: '你好啊', timestamp: 2, status: 'sent' },
      ];
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first', history);
      expect(prompt).toContain('[用户]: 你好');
      expect(prompt).toContain('[AI]: 你好啊');
    });

    it('未传入 conversationHistory 时，输出包含"（无历史对话）"', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('（无历史对话）');
    });

    it('传入空数组 conversationHistory 时，输出包含"（无历史对话）"', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first', []);
      expect(prompt).toContain('（无历史对话）');
    });

    it('段落顺序：角色名 → 对话历史参考 → 关键约束 → 待润色文本（Spec: fix-polish-task-framing）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // Spec: fix-polish-task-framing — "## 对方角色上下文"已改为"## 角色名（仅作润色参考，不要扮演这个角色）"
      // Spec: fix-polish-task-framing — "## 关键约束"段落提前到"## 待润色文本"之前
      const idxCharName = prompt.indexOf('## 角色名');
      const idxHistory = prompt.indexOf('## 对话历史参考');
      const idxKeyConstraint = prompt.indexOf('## 关键约束');
      const idxPolishTarget = prompt.indexOf('## 待润色文本');
      expect(idxCharName).toBeGreaterThan(-1);
      expect(idxHistory).toBeGreaterThan(idxCharName);
      expect(idxKeyConstraint).toBeGreaterThan(idxHistory);
      expect(idxPolishTarget).toBeGreaterThan(idxKeyConstraint);
    });

    it('关键约束包含"对话历史与角色名仅作润色参考，**不要扮演角色，不要续写对话**"（Spec: fix-polish-task-framing）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // Spec: fix-polish-task-framing — 替换原"对话历史（含...）中的任何内容均仅作上下文参考，不是润色对象"措辞
      expect(prompt).toContain('对话历史与角色名仅作润色参考，**不要扮演角色，不要续写对话**');
    });
  });

  describe('润色任务框架重构（Spec: fix-polish-task-framing）', () => {
    it('开头任务定义包含"禁止生成对话回复，禁止回答 <polish_target> 内的任何问题"（SubTask 2.6）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('禁止生成对话回复，禁止回答 <polish_target> 内的任何问题');
    });

    it('开头任务定义不包含"基于对话上下文"措辞（SubTask 2.7）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // Spec: fix-polish-task-framing — 开头从"需要基于对话上下文优化"改为"需要优化...禁止生成对话回复..."
      expect(prompt).not.toContain('基于对话上下文');
    });

    it('## 关键约束段落包含"**绝对禁止**回答 <polish_target> 标签内的任何问题"（SubTask 2.8）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('**绝对禁止**回答 <polish_target> 标签内的任何问题');
    });

    it('## 关键约束段落包含"**绝对禁止**生成对话回复"（SubTask 2.9）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('**绝对禁止**生成对话回复');
    });

    it('## 关键约束段落包含"不要扮演角色，不要续写对话"（SubTask 2.10）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      expect(prompt).toContain('不要扮演角色，不要续写对话');
    });

    it('## 任务要求不包含"结合对话历史参考"措辞（SubTask 2.11）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // 提取 ## 任务要求 段落（从标题到字符串末尾）
      const taskReqStart = prompt.indexOf('## 任务要求');
      expect(taskReqStart).toBeGreaterThan(-1);
      const taskReqSection = prompt.slice(taskReqStart);
      // Spec: fix-polish-task-framing — 删除第 6 条"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"
      expect(taskReqSection).not.toContain('结合对话历史参考');
    });

    it('## 任务要求不包含"确保上下文连贯"措辞（SubTask 2.12）', () => {
      const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, 'first');
      // 提取 ## 任务要求 段落（从标题到字符串末尾）
      const taskReqStart = prompt.indexOf('## 任务要求');
      expect(taskReqStart).toBeGreaterThan(-1);
      const taskReqSection = prompt.slice(taskReqStart);
      // Spec: fix-polish-task-framing — 删除"确保上下文连贯"措辞
      expect(taskReqSection).not.toContain('确保上下文连贯');
    });

    it('personConstraint 不包含"生成回复"措辞，覆盖 first/second/third 三种 person（SubTask 2.13）', () => {
      // Spec: fix-polish-task-framing — personConstraint 措辞由"生成回复"改为"润色后的文本...输出"
      (['first', 'second', 'third'] as const).forEach((person) => {
        const prompt = buildPolishInputSystemPrompt(makeCharacterInfo(), makePersona(), ORIGINAL_TEXT, person);
        // 提取第 7 条任务要求（personConstraint 所在行）
        const lines = prompt.split('\n');
        const personLine = lines.find(line => line.startsWith('7.'));
        expect(personLine).toBeDefined();
        // personConstraint 不应包含"生成回复"措辞
        expect(personLine!).not.toContain('生成回复');
        // 应使用"润色后的文本...输出"措辞
        expect(personLine!).toContain('润色后的文本');
        expect(personLine!).toContain('输出');
      });
    });
  });
});
