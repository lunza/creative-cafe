/**
 * buildRoleAnchorMessage 单元测试
 *
 * 验证目标（spec Task 4.1 / 4.5）：
 * 1. 正确提取 personality 前 200 字符并格式化为 `[角色锚定] {{char}} 的核心设定：{{summary}}...`
 * 2. personality 为空时 fallback 到 description 前 200 字符
 * 3. personality 超过 200 字符时截断到 200 字符
 * 4. {{char}} / {{user}} 模板替换正确
 * 5. name / userName 缺省回退
 * 6. 返回 role 为 'system'
 *
 * Spec: optimize-chat-ai-intelligence / Task 4
 */

import { describe, it, expect } from 'vitest';
import { buildRoleAnchorMessage } from '../PromptBuilder';

describe('buildRoleAnchorMessage', () => {
  it('正确提取 personality 并格式化为角色锚定消息', () => {
    const msg = buildRoleAnchorMessage(
      { name: '朱迪', personality: '勇敢坚定的兔子警官', description: '描述' },
      '小明'
    );
    expect(msg.role).toBe('system');
    expect(msg.content).toBe(
      '[角色锚定] 朱迪 的核心设定：勇敢坚定的兔子警官。始终以 朱迪 视角回复，禁止替 小明 发言。'
    );
  });

  it('personality 为空时 fallback 到 description', () => {
    const msg = buildRoleAnchorMessage(
      { name: '尼克', personality: '', description: '狡猾的狐狸' },
      'User'
    );
    expect(msg.content).toContain('[角色锚定] 尼克 的核心设定：狡猾的狐狸');
  });

  it('personality 为 undefined 时 fallback 到 description', () => {
    const msg = buildRoleAnchorMessage(
      { name: '尼克', description: '狡猾的狐狸' },
      'User'
    );
    expect(msg.content).toContain('狡猾的狐狸');
  });

  it('personality 为纯空白字符时 fallback 到 description', () => {
    const msg = buildRoleAnchorMessage(
      { name: '尼克', personality: '   \n\t  ', description: '狡猾的狐狸' },
      'User'
    );
    expect(msg.content).toContain('狡猾的狐狸');
    // 空白 personality 不应出现在 summary 中
    expect(msg.content).not.toMatch(/核心设定：\s+/);
  });

  it('personality 超过 200 字符时截断到 200 字符', () => {
    const longPersonality = 'A'.repeat(300);
    const msg = buildRoleAnchorMessage(
      { name: '测试角色', personality: longPersonality },
      'User'
    );
    // summary 应为前 200 字符
    expect(msg.content).toContain('A'.repeat(200));
    // 不应包含第 201 个 A（注意：msg.content 中固定文案也包含 A 字符如 "Always"，所以用核心设定后内容判断）
    const summaryPart = msg.content.split('核心设定：')[1].split('。')[0];
    expect(summaryPart.length).toBe(200);
    expect(summaryPart).toBe('A'.repeat(200));
  });

  it('description 也超过 200 字符时截断到 200 字符', () => {
    const longDescription = 'B'.repeat(250);
    const msg = buildRoleAnchorMessage(
      { name: '测试角色', personality: '', description: longDescription },
      'User'
    );
    const summaryPart = msg.content.split('核心设定：')[1].split('。')[0];
    expect(summaryPart.length).toBe(200);
    expect(summaryPart).toBe('B'.repeat(200));
  });

  it('personality 与 description 都为空时 summary 为空字符串', () => {
    const msg = buildRoleAnchorMessage(
      { name: '空角色', personality: '', description: '' },
      'User'
    );
    // summary 为空：核心设定：。始终以...
    expect(msg.content).toBe(
      '[角色锚定] 空角色 的核心设定：。始终以 空角色 视角回复，禁止替 User 发言。'
    );
  });

  it('personality 与 description 都为 undefined 时 summary 为空字符串', () => {
    const msg = buildRoleAnchorMessage(
      { name: '空角色' },
      'User'
    );
    expect(msg.content).toBe(
      '[角色锚定] 空角色 的核心设定：。始终以 空角色 视角回复，禁止替 User 发言。'
    );
  });

  it('{{char}} 替换为 characterCard.name', () => {
    const msg = buildRoleAnchorMessage(
      { name: '艾米莉亚', personality: '银发半精灵' },
      'User'
    );
    // 应替换为实际名"艾米莉亚"，不应残留 {{char}}
    expect(msg.content).toContain('艾米莉亚');
    expect(msg.content).not.toContain('{{char}}');
  });

  it('{{user}} 替换为 userName（中文名）', () => {
    const msg = buildRoleAnchorMessage(
      { name: '雷姆', personality: '蓝发女仆' },
      '昴'
    );
    expect(msg.content).toContain('禁止替 昴 发言');
    expect(msg.content).not.toContain('{{user}}');
  });

  it('name 为空时回退到 Character', () => {
    const msg = buildRoleAnchorMessage(
      { personality: '神秘角色' },
      'User'
    );
    expect(msg.content).toContain('[角色锚定] Character 的核心设定：神秘角色');
  });

  it('name 为纯空白时回退到 Character', () => {
    const msg = buildRoleAnchorMessage(
      { name: '   ', personality: '神秘角色' },
      'User'
    );
    expect(msg.content).toContain('[角色锚定] Character 的核心设定：神秘角色');
  });

  it('userName 为空时回退到 User', () => {
    const msg = buildRoleAnchorMessage(
      { name: '测试', personality: '个性' },
      ''
    );
    expect(msg.content).toContain('禁止替 User 发言');
  });

  it('userName 为 undefined 时回退到 User', () => {
    const msg = buildRoleAnchorMessage(
      { name: '测试', personality: '个性' }
      // 不传 userName，使用默认值
    );
    expect(msg.content).toContain('禁止替 User 发言');
  });

  it('userName 为纯空白时回退到 User', () => {
    const msg = buildRoleAnchorMessage(
      { name: '测试', personality: '个性' },
      '   '
    );
    expect(msg.content).toContain('禁止替 User 发言');
  });

  it('返回对象 role 字段为 system', () => {
    const msg = buildRoleAnchorMessage(
      { name: '测试', personality: '个性' },
      'User'
    );
    expect(msg.role).toBe('system');
    expect(typeof msg.content).toBe('string');
    expect(msg.content.length).toBeGreaterThan(0);
  });

  it('完整格式与 spec 一致（含中括号、句末句号）', () => {
    const msg = buildRoleAnchorMessage(
      { name: '艾米', personality: '温柔' },
      '小明'
    );
    // spec 格式：[角色锚定] {{char}} 的核心设定：{{summary}}。始终以 {{char}} 视角回复，禁止替 {{user}} 发言。
    expect(msg.content).toMatch(/^\[角色锚定\] .+ 的核心设定：.+。始终以 .+ 视角回复，禁止替 .+ 发言。$/);
  });
});
