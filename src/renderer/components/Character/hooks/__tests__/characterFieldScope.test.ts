/**
 * Spec: fix-character-card-field-scope-flash-models — 输出越界防御单测
 * 覆盖四类用例：多字段提取 / 无法提取回退 / 标签清理 / 正常透传
 */
import { describe, it, expect } from 'vitest';
import { extractTargetFieldContent } from '../characterFieldScope';

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
