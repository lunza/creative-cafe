/**
 * Spec: fix-character-card-field-scope-flash-models — 输出越界防御单测
 * 覆盖四类用例：多字段提取 / 无法提取回退 / 标签清理 / 正常透传
 * Spec: unify-character-card-full-field-context — 短字段标签防御 + buildCharacterContext 全字段上下文
 */
import { describe, it, expect } from 'vitest';
import { extractTargetFieldContent, buildCharacterContext } from '../characterFieldScope';

describe('extractTargetFieldContent（Spec: fix-character-card-field-scope-flash-models）', () => {
  it('防御1：多字段结构输出 → 提取目标字段段落', () => {
    const raw = `描述：一位银发的精灵弓手，居住在北境森林。
个性：冷静、理智、略带傲娇
场景：北境森林深处的猎屋`;
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe('一位银发的精灵弓手，居住在北境森林。');
  });

  it('防御1：目标字段段落不在开头时仍可提取', () => {
    const raw = `个性：冷静
描述：银发精灵弓手。
场景：森林`;
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe('银发精灵弓手。');
  });

  it('防御1：字段标签变体（【】包裹 / markdown 标题 / 加粗）均可识别', () => {
    const raw1 = `【描述】银发精灵弓手。\n【个性】冷静`;
    expect(extractTargetFieldContent(raw1, 'description').content).toBe('银发精灵弓手。');

    const raw2 = `# 描述\n银发精灵弓手。\n# 个性\n冷静`;
    expect(extractTargetFieldContent(raw2, 'description').content).toBe('银发精灵弓手。');

    const raw3 = `**描述**：银发精灵弓手。\n**个性**：冷静`;
    expect(extractTargetFieldContent(raw3, 'description').content).toBe('银发精灵弓手。');
  });

  it('防御2：无目标字段段落且 ≥2 个其他字段标签 → 判定越界', () => {
    const raw = `个性：冷静
场景：北境森林
初始消息：你是谁？`;
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(true);
  });

  it('防御2：目标字段段落为空且存在其他字段 → 判定越界', () => {
    const raw = `描述：
个性：冷静
场景：森林`;
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(true);
  });

  it('防御3：标签残留清理', () => {
    const raw = `<translate_target>\n银发精灵弓手。\n</translate_target>`;
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe('银发精灵弓手。');

    const raw2 = `<polish_target>银发精灵弓手。</polish_target>\n<context_reference>其他内容</context_reference>`;
    const result2 = extractTargetFieldContent(raw2, 'description');
    expect(result2.overflow).toBe(false);
    expect(result2.content).toBe('银发精灵弓手。\n其他内容');
  });

  it('正常透传：单字段输出（无任何字段标签）不受影响', () => {
    const raw = '一位银发的精灵弓手，居住在北境森林，性格冷静。';
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe(raw);
  });

  it('正常透传：仅 1 个其他字段标签行（可能为正文合法内容）不判定越界', () => {
    // 例：描述正文本身合法包含"个性："行首（如自述清单）
    const raw = `该角色的核心设定：\n个性：冷静`;
    const result = extractTargetFieldContent(raw, 'description');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe(raw);
  });

  it('正常透传：未知字段 key 直接透传（仅清理标签）', () => {
    const raw = '任意内容';
    const result = extractTargetFieldContent(raw, 'unknown_field');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe(raw);
  });

  it('越界判定时调用 addLog 记录', () => {
    const logs: string[] = [];
    const addLog = (msg: string) => logs.push(msg);
    extractTargetFieldContent('个性：冷静\n场景：森林', 'description', addLog);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('越界');
  });
});

describe('extractTargetFieldContent 短字段标签（Spec: unify-character-card-full-field-context）', () => {
  it('防御2：输出含"角色名称/标签"等多个短字段段落且无目标字段段落 → 判定越界', () => {
    const raw = `角色名称：Lynne
标签：奇幻、傲娇
描述：银发精灵弓手。`;
    // 目标为"个性"：输出含 3 个其他字段段落（角色名称/标签/描述）且无目标段落 → 越界
    const result = extractTargetFieldContent(raw, 'personality');
    expect(result.overflow).toBe(true);
  });

  it('防御1：目标为 name，输出"角色名称：Lynne" → 提取标签后内容', () => {
    const raw = '角色名称：Lynne';
    const result = extractTargetFieldContent(raw, 'name');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe('Lynne');
  });

  it('防御1：目标为 tags，输出"【标签】奇幻、傲娇"（括号形式） → 提取标签后内容', () => {
    const raw = '【标签】奇幻、傲娇';
    const result = extractTargetFieldContent(raw, 'tags');
    expect(result.overflow).toBe(false);
    expect(result.content).toBe('奇幻、傲娇');
  });
});

describe('buildCharacterContext（Spec: unify-character-card-full-field-context）', () => {
  const fullFormValues: Record<string, any> = {
    name: 'Lynne',
    nickname: '小银',
    source: '原创',
    creator: 'Master',
    character_version: '1.0',
    tags: ['奇幻', '傲娇'],
    post_history_instructions: '保持简洁',
    system_prompt: '你是 Lynne。',
    first_mes: '你好，旅行者。',
    mes_example: '示例对话',
    description: '银发精灵弓手。',
    personality: '冷静',
    scenario: '北境森林',
    alternate_greetings: ['早上好！', '晚上好！'],
    creator_notes: '原创角色'
  };

  it('全 15 字段已填 → 排除目标字段后输出其余 14 个字段行（含 6 个短字段）', () => {
    const result = buildCharacterContext(fullFormValues, 'description');
    // alternate_greetings 数组值内嵌换行，故按 "- " 前缀计字段行数
    const fieldLines = result.split('\n').filter(l => l.startsWith('- '));
    expect(fieldLines).toHaveLength(14);
    expect(result).not.toContain('- 描述：');
    expect(result).toContain('- 角色名称：Lynne');
    expect(result).toContain('- 昵称：小银');
    expect(result).toContain('- 来源：原创');
    expect(result).toContain('- 创建者：Master');
    expect(result).toContain('- 版本信息：1.0');
    expect(result).toContain('- 标签：奇幻、傲娇');
    expect(result).toContain('- 系统提示：你是 Lynne。');
    expect(result).toContain('- 历史记录后指令：保持简洁');
    expect(result).toContain('- 创建者笔记：原创角色');
  });

  it('目标为短字段（name）→ 角色名称行被排除，其余字段保留', () => {
    const result = buildCharacterContext(fullFormValues, 'name');
    expect(result).not.toContain('- 角色名称：');
    expect(result).toContain('- 描述：银发精灵弓手。');
    expect(result).toContain('- 标签：奇幻、傲娇');
  });

  it('tags 数组用顿号连接为单行；alternate_greetings 数组仍用换行连接', () => {
    const result = buildCharacterContext(fullFormValues, 'description');
    expect(result).toContain('- 标签：奇幻、傲娇');
    expect(result).toMatch(/- 替代问候：早上好！\n晚上好！/);
  });

  it('空值字段跳过；全部为空 → 返回空字符串', () => {
    expect(buildCharacterContext({ name: 'Lynne', description: '' }, 'description')).toBe('- 角色名称：Lynne');
    expect(buildCharacterContext({}, 'description')).toBe('');
    expect(buildCharacterContext({ description: '只有目标字段' }, 'description')).toBe('');
  });
});
