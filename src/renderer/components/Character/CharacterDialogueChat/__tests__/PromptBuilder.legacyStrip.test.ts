/**
 * stripLegacyDialogueRuleBlocks / applyMinimalDialogueRules 单元测试
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2 / Task 2.7
 * 覆盖：存量旧模板剥离 / 新模板跳过（锚点守卫）/ 用户自定义模板保护 /
 * 规则插入位置 / 空输入边界。
 */

import { describe, it, expect } from 'vitest';
import {
  stripLegacyDialogueRuleBlocks,
  applyMinimalDialogueRules,
} from '../PromptBuilder';

/** 复刻存量数据库旧版模板结构（19+ 条规则形态） */
const LEGACY_TEMPLATE_OUTPUT = `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 Ceroba 这个角色，与 User 进行角色扮演对话。
在提示词中，Ceroba 代表 Ceroba，User 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。

【对话约束规则】
1. 你就是 Ceroba 这个角色本人，不是AI助手，不是翻译工具，不是任何系统
2. 以角色的口吻、性格特点和语言习惯与用户交流
3. 积极回应用户的问题和行为，推动对话自然发展
4. 根据对话上下文和情境调整语气和态度
5. 使用符合角色身份的语言风格
6. 在回复中使用 Ceroba 代替 {{char}}，使用 User 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹
8. 【格式要求】角色的动作、神态、心理活动等非对话描写必须用星号包裹

【严格禁止】
- 禁止输出任何元信息、系统说明或格式说明
- 禁止输出技术术语、模型名称（如"Transformers"、"Oracle"等）
- 禁止输出与角色扮演无关的任何内容
- 禁止打破角色设定或承认自己是AI
- 禁止输出任何随机字符或无意义字符串

【白名单例外 - 必须遵守】
以下标签为系统功能所需的特殊格式，【不属于禁止范围】：
- HTML 注释标签 <!-- ... --> 是系统通信格式
- <tableEdit> 标签是系统记忆表格功能的必需格式
- 星号 *动作描写* 是格式标记

【输出格式】
直接输出角色的对话和行动描写。对话内容用英文双引号（" "）包裹，动作和神态描写用星号（* *）包裹。

【角色信息】
角色名：Ceroba
性格：温和`;

/** 新默认模板结构（已含【对话方式】锚点） */
const NEW_TEMPLATE_OUTPUT = `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 Ceroba 这个角色，与 User 进行角色扮演对话。

【对话方式】
1. 你就是 Ceroba，以你的身份思考、说话、行动——不是助手，不是系统
2. 像真人一样交流：句子有长有短，会犹豫、会开玩笑、会跑题
3. 对话内容用英文双引号（" "）包裹；动作、神态、心理描写用星号（* *）包裹

【角色信息】
角色名：Ceroba`;

describe('stripLegacyDialogueRuleBlocks', () => {
  it('剥离旧模板的全部四个规则块', () => {
    const result = stripLegacyDialogueRuleBlocks(LEGACY_TEMPLATE_OUTPUT);
    expect(result).not.toContain('【对话约束规则】');
    expect(result).not.toContain('【严格禁止】');
    expect(result).not.toContain('【白名单例外');
    expect(result).not.toContain('【输出格式】');
    // 规则内容同步移除
    expect(result).not.toContain('不是AI助手');
    expect(result).not.toContain('禁止输出任何元信息');
    expect(result).not.toContain('Transformers');
  });

  it('保留任务类型、任务说明与角色信息段', () => {
    const result = stripLegacyDialogueRuleBlocks(LEGACY_TEMPLATE_OUTPUT);
    expect(result).toContain('【主要任务类型：角色扮演对话】');
    expect(result).toContain('【对话任务说明】');
    expect(result).toContain('你需要完全代入角色');
    expect(result).toContain('【角色信息】');
    expect(result).toContain('角色名：Ceroba');
  });

  it('剥离后清理多余空行（无 3 连以上换行）', () => {
    const result = stripLegacyDialogueRuleBlocks(LEGACY_TEMPLATE_OUTPUT);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('空串与 null 输入原样返回', () => {
    expect(stripLegacyDialogueRuleBlocks('')).toBe('');
  });

  it('无任何旧块标题的文本原样通过（仅做空白清理）', () => {
    const custom = '用户自定义指令内容，无标准块结构。';
    expect(stripLegacyDialogueRuleBlocks(custom)).toBe(custom);
  });
});

describe('applyMinimalDialogueRules', () => {
  it('存量旧模板：剥离旧块后注入精简指令集（3 条核心规则）', () => {
    const result = applyMinimalDialogueRules(LEGACY_TEMPLATE_OUTPUT, 'Ceroba');
    // 新指令集注入
    expect(result).toContain('【对话方式】');
    expect(result).toContain('你就是 Ceroba');
    expect(result).toContain('像真人一样交流');
    expect(result).toContain('用星号（* *）包裹');
    // 旧块已剥离
    expect(result).not.toContain('【对话约束规则】');
    expect(result).not.toContain('【严格禁止】');
    // charName 替换生效
    expect(result).not.toContain('{CHAR_NAME}');
  });

  it('精简指令集插入在【角色信息】之前（指令→规则→角色信息分组）', () => {
    const result = applyMinimalDialogueRules(LEGACY_TEMPLATE_OUTPUT, 'Ceroba');
    const rulesIdx = result.indexOf('【对话方式】');
    const charInfoIdx = result.indexOf('【角色信息】');
    expect(rulesIdx).toBeGreaterThan(0);
    expect(charInfoIdx).toBeGreaterThan(rulesIdx);
  });

  it('新模板（含锚点）原样通过，不重复注入', () => {
    const result = applyMinimalDialogueRules(NEW_TEMPLATE_OUTPUT, 'Ceroba');
    expect(result).toBe(NEW_TEMPLATE_OUTPUT);
    // 只出现一次【对话方式】
    expect(result.split('【对话方式】').length - 1).toBe(1);
  });

  it('用户深度自定义模板：不剥离自定义内容，仅追加精简指令集', () => {
    const custom = `我的专属扮演规则：
- 每次回复必须以诗句结尾
- 称呼用户为"旅人"`;
    const result = applyMinimalDialogueRules(custom, 'Ceroba');
    // 自定义内容保留
    expect(result).toContain('每次回复必须以诗句结尾');
    expect(result).toContain('旅人');
    // 精简指令集追加
    expect(result).toContain('【对话方式】');
    expect(result).toContain('你就是 Ceroba');
  });

  it('空输入返回原值', () => {
    expect(applyMinimalDialogueRules('', 'Ceroba')).toBe('');
  });

  it('charName 缺省回退 Character', () => {
    const result = applyMinimalDialogueRules('自定义模板', '');
    expect(result).toContain('你就是 Character');
  });
});
