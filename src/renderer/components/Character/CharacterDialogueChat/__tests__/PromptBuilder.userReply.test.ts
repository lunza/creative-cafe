/**
 * buildUserReplySystemPrompt 单元测试
 *
 * 验证目标（spec Task 1.1 / Task 5.1）：
 * 1. 输出包含用户人设 name / description
 * 2. 输出包含对方角色 characterCardName / personality / characterCardContent
 * 3. 输出包含明确约束（"仅输出"、"不要输出"等）
 * 4. 输出包含长度约束（50-200 字）
 * 5. persona 缺失或 name 为空时返回空串
 * 6. description 为空时使用 fallback 文本
 * 7. characterCardContent 超过 300 字符时截断
 * 8. personality / characterCardContent 缺失时不输出对应行
 *
 * Spec: add-ai-user-reply-button / Task 1.1
 *
 * 注意：spec 原文使用"只输出"，实际实现使用"仅输出"——本测试以实际实现为准。
 */

import { describe, it, expect } from 'vitest';
import { buildUserReplySystemPrompt, CharacterInfoForPrompt } from '../PromptBuilder';
import { UserPersona } from '../CharacterDialogueChat.types';

// 构造完整 UserPersona 的辅助函数（UserPersona 接口所有字段均为必填）
function makePersona(overrides: Partial<UserPersona> = {}): UserPersona {
  return {
    id: 'persona-1',
    name: '张三',
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

describe('buildUserReplySystemPrompt（Spec: add-ai-user-reply-button / Task 1.1）', () => {
  describe('正常输入', () => {
    it('输出包含用户人设 name', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '张三' })
      );
      expect(prompt).toContain('张三');
    });

    it('输出包含用户人设 description', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ description: '一名勇敢的战士' })
      );
      expect(prompt).toContain('一名勇敢的战士');
    });

    it('输出包含对方角色 characterCardName', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardName: '艾莉' }),
        makePersona()
      );
      expect(prompt).toContain('艾莉');
    });

    it('输出包含对方角色 personality', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ personality: '温柔' }),
        makePersona()
      );
      expect(prompt).toContain('温柔');
    });

    it('输出包含 characterCardContent（角色描述）', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardContent: '艾莉是一位精灵法师' }),
        makePersona()
      );
      expect(prompt).toContain('艾莉是一位精灵法师');
    });
  });

  describe('约束关键词（spec 原文为"只输出"，实际实现为"仅输出"）', () => {
    it('输出包含"仅输出"约束（实际实现使用"仅输出"而非 spec 的"只输出"）', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      // 实际实现：`仅输出 ${userName} 的下一句回复内容`
      expect(prompt).toContain('仅输出');
    });

    it('输出包含"不要输出"约束（防止 AI 越权生成角色回复）', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardName: '艾莉' }),
        makePersona()
      );
      expect(prompt).toContain('不要输出');
      expect(prompt).toContain('艾莉');
    });

    it('输出包含"不要"通用约束前缀', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('不要');
    });

    it('输出包含"不要解释"、"不要引号"、"不要前缀"具体约束', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('不要解释');
      expect(prompt).toContain('不要引号');
      expect(prompt).toContain('不要前缀');
    });
  });

  describe('长度约束', () => {
    it('输出包含 50-200 字长度约束', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('50-200');
    });

    it('输出包含"用户回复通常较短"语义提示', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('用户回复通常较短');
    });
  });

  describe('persona.description 缺失时的 fallback', () => {
    it('description 为空字符串时输出 fallback 文本"（未提供用户描述）"', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ description: '' })
      );
      // 实际实现使用全角括号"（未提供用户描述）"
      expect(prompt).toContain('（未提供用户描述）');
    });

    it('description 为纯空白字符时也使用 fallback 文本', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ description: '   \n\t  ' })
      );
      expect(prompt).toContain('（未提供用户描述）');
    });
  });

  describe('characterInfo 字段缺失时的行为', () => {
    it('personality 与 characterCardContent 均缺失时仍包含角色名', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({
          characterCardName: '艾莉',
          personality: undefined,
          characterCardContent: undefined,
        }),
        makePersona()
      );
      expect(prompt).toContain('艾莉');
    });

    it('personality 缺失时不输出"角色个性"行', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({
          personality: undefined,
          characterCardContent: undefined,
        }),
        makePersona()
      );
      expect(prompt).not.toContain('角色个性');
    });

    it('characterCardContent 缺失时不输出"角色描述"行', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({
          personality: undefined,
          characterCardContent: undefined,
        }),
        makePersona()
      );
      expect(prompt).not.toContain('角色描述');
    });

    it('characterCardName 缺失时回退到默认 "Character"', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardName: undefined }),
        makePersona()
      );
      expect(prompt).toContain('Character');
    });

    it('characterCardName 为纯空白时回退到默认 "Character"', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardName: '   ' }),
        makePersona()
      );
      expect(prompt).toContain('Character');
    });
  });

  describe('characterCardContent 截断行为（>300 字符）', () => {
    it('characterCardContent 超过 300 字符时被截断', () => {
      const longContent = 'A'.repeat(400);
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardContent: longContent }),
        makePersona()
      );
      // 截断标记
      expect(prompt).toContain('...');
      // 截断后的内容（前 300 个 A）应存在
      expect(prompt).toContain('A'.repeat(300));
      // 第 301 个 A 不应存在（被截断）
      expect(prompt).not.toContain('A'.repeat(301));
    });

    it('characterCardContent 恰为 300 字符时不截断（无 ... 标记）', () => {
      const exactContent = 'B'.repeat(300);
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardContent: exactContent }),
        makePersona()
      );
      // 长度恰为 300 时不追加 "..."
      expect(prompt).toContain('B'.repeat(300));
      // 不应包含 "..."（因未触发截断）
      expect(prompt).not.toContain('...');
    });

    it('characterCardContent 短于 300 字符时不截断', () => {
      const shortContent = 'C'.repeat(100);
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardContent: shortContent }),
        makePersona()
      );
      expect(prompt).toContain(shortContent);
      expect(prompt).not.toContain('...');
    });
  });

  describe('persona 缺失或 name 为空时的防御性返回', () => {
    it('persona 为 null 时返回空串', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        null as unknown as UserPersona
      );
      expect(prompt).toBe('');
    });

    it('persona 为 undefined 时返回空串', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        undefined as unknown as UserPersona
      );
      expect(prompt).toBe('');
    });

    it('persona.name 为空字符串时返回空串', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '' })
      );
      expect(prompt).toBe('');
    });

    it('persona.name 为纯空白字符时返回空串', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '   \n\t  ' })
      );
      expect(prompt).toBe('');
    });
  });

  describe('输出格式与结构', () => {
    it('输出包含"你是对话模拟器"角色定义', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona({ name: '张三' })
      );
      expect(prompt).toContain('你是对话模拟器');
      expect(prompt).toContain('张三');
    });

    it('输出包含"## 用户人设"段落标题', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('## 用户人设');
    });

    it('输出包含"## 对方角色上下文"段落标题', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('## 对方角色上下文');
    });

    it('输出包含"## 任务要求"段落标题', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('## 任务要求');
    });

    it('输出包含"直接输出回复内容本身"收尾', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo(),
        makePersona()
      );
      expect(prompt).toContain('直接输出回复内容本身');
    });

    it('输出包含"角色名"标签', () => {
      const prompt = buildUserReplySystemPrompt(
        makeCharacterInfo({ characterCardName: '艾莉' }),
        makePersona()
      );
      expect(prompt).toContain('角色名');
      expect(prompt).toContain('艾莉');
    });
  });

  describe('纯函数行为', () => {
    it('多次调用返回相同结果', () => {
      const a = buildUserReplySystemPrompt(makeCharacterInfo(), makePersona());
      const b = buildUserReplySystemPrompt(makeCharacterInfo(), makePersona());
      expect(a).toBe(b);
    });
  });
});

describe('buildUserReplySystemPrompt 人称参数（Spec: add-person-attribute-to-ai-reply）', () => {
  // 复用现有测试的 mock 数据构造方式，确保 characterInfo 和 persona 一致
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

  describe('第一人称（first）', () => {
    it('person="first" 时输出包含第一人称视角约束', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'first');
      expect(prompt).toContain('以第一人称（"我"）视角生成回复');
      expect(prompt).toContain('使用"我"作为自称');
    });

    it('不传 person 参数时默认为第一人称（向后兼容）', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona);
      expect(prompt).toContain('以第一人称（"我"）视角生成回复');
      expect(prompt).toContain('使用"我"作为自称');
    });
  });

  describe('第二人称（second）', () => {
    it('person="second" 时输出包含第二人称视角约束', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'second');
      expect(prompt).toContain('以第二人称（"你"）视角生成回复');
      expect(prompt).toContain('使用"你"来指代');
      expect(prompt).toContain('互动小说风格');
    });

    it('person="second" 时输出不包含第一人称约束', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'second');
      expect(prompt).not.toContain('以第一人称');
    });
  });

  describe('第三人称（third）', () => {
    it('person="third" 时输出包含第三人称视角约束', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'third');
      expect(prompt).toContain('以第三人称叙事视角生成回复');
      expect(prompt).toContain('小说叙事风格');
    });

    it('person="third" 时输出包含用户名作为主语', () => {
      const userName = persona.name; // 确保使用 persona.name
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'third');
      expect(prompt).toContain(`使用"${userName}"作为主语`);
    });

    it('person="third" 时输出不包含第一人称约束', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'third');
      expect(prompt).not.toContain('以第一人称');
    });
  });

  describe('人称约束在任务要求段落中', () => {
    it('人称约束作为第 7 条任务要求出现', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'first');
      expect(prompt).toContain('7. 以第一人称');
    });

    it('second 人称约束作为第 7 条任务要求出现', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'second');
      expect(prompt).toContain('7. 以第二人称');
    });

    it('third 人称约束作为第 7 条任务要求出现', () => {
      const prompt = buildUserReplySystemPrompt(characterInfo, persona, 'third');
      expect(prompt).toContain('7. 以第三人称');
    });
  });
});
