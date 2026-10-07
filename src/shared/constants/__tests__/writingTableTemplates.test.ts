/**
 * writingTableTemplates 结构守卫测试
 *
 * 这些模板是写作表格整理的数据源（AI 整理按 sheets/headers 提取信息），
 * 结构缺陷会直接导致整理产物缺失列。守卫：
 * - 默认模板存在且与 WRITING_DEFAULT_TABLE_TEMPLATE_ID 一致
 * - id 全局唯一（模板按 id 解析，重复 id 会解析到错误模板）
 * - sheet/headers/description/order 完整且无重复
 */
import { describe, it, expect } from 'vitest';
import {
  WRITING_TABLE_TEMPLATES,
  WRITING_DEFAULT_TABLE_TEMPLATE_ID,
} from '../writingTableTemplates';

describe('写作表格模板结构守卫', () => {
  it('至少包含一个模板，且默认模板存在于列表中', () => {
    expect(WRITING_TABLE_TEMPLATES.length).toBeGreaterThan(0);
    expect(
      WRITING_TABLE_TEMPLATES.some((t) => t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID)
    ).toBe(true);
  });

  it('模板 id 全局唯一', () => {
    const ids = WRITING_TABLE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个模板 name/description 非空，sheets 非空', () => {
    for (const t of WRITING_TABLE_TEMPLATES) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.description.trim().length).toBeGreaterThan(0);
      expect(t.sheets.length).toBeGreaterThan(0);
    }
  });

  it('每个 sheet 的 name/description 非空、headers 非空且无重复列', () => {
    for (const t of WRITING_TABLE_TEMPLATES) {
      for (const s of t.sheets) {
        expect(s.name.trim().length).toBeGreaterThan(0);
        expect(s.description.trim().length).toBeGreaterThan(0);
        expect(s.headers.length).toBeGreaterThan(0);
        expect(new Set(s.headers).size).toBe(s.headers.length);
        for (const h of s.headers) {
          expect(h.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('每个模板内 sheet 名唯一且 order 从 0 递增', () => {
    for (const t of WRITING_TABLE_TEMPLATES) {
      const names = t.sheets.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
      const orders = t.sheets.map((s) => s.order);
      expect(orders[0]).toBe(0);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBe(orders[i - 1] + 1);
      }
    }
  });

  it('默认模板（小说设定总表）包含角色/事件/伏笔核心表', () => {
    const def = WRITING_TABLE_TEMPLATES.find((t) => t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID);
    expect(def).toBeDefined();
    const names = (def?.sheets ?? []).map((s) => s.name);
    expect(names).toContain('角色表');
    expect(names).toContain('事件表');
    expect(names).toContain('伏笔表');
  });
});
