/**
 * v2ResourceUtils 单元测试（P3 素材绑定纯函数）
 *
 * 覆盖：
 * - toggleResourceId：绑定/解绑切换、空集、幂等
 * - buildResourcesPatch：分组更新、未分组字段保留、current 为 undefined 的兜底
 */
import { describe, it, expect } from 'vitest';
import type { WritingResourceConfig } from '../../../../../../shared/types/writing-v2.types';
import type { ReferenceMaterial } from '../../../../../../shared/types/writing.types';
import { toggleResourceId, buildResourcesPatch, V2_RESOURCE_GROUPS } from '../v2ResourceUtils';

describe('v2ResourceUtils.toggleResourceId', () => {
  it('未绑定时追加 id', () => {
    expect(toggleResourceId(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('已绑定时移除 id', () => {
    expect(toggleResourceId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('undefined 视为空集，绑定时返回 [id]', () => {
    expect(toggleResourceId(undefined, 'x')).toEqual(['x']);
  });

  it('不修改原数组（纯函数）', () => {
    const src = ['a'];
    toggleResourceId(src, 'b');
    expect(src).toEqual(['a']);
  });
});

describe('v2ResourceUtils.buildResourcesPatch', () => {
  const base: WritingResourceConfig = {
    worldBookIds: ['wb1'],
    characterCardIds: ['c1'],
    userPersonaIds: ['p1'],
    knowledgeItemIds: ['k1'],
    writingStyleIds: ['s1'],
  };

  it('更新目标分组，其余分组保持不变', () => {
    const next = buildResourcesPatch(base, 'worldBookIds', ['wb1', 'wb2']);
    expect(next.worldBookIds).toEqual(['wb1', 'wb2']);
    expect(next.characterCardIds).toEqual(['c1']);
    expect(next.userPersonaIds).toEqual(['p1']);
    expect(next.writingStyleIds).toEqual(['s1']);
  });

  it('current 为 undefined 时兜底空数组', () => {
    const next = buildResourcesPatch(undefined, 'characterCardIds', ['c9']);
    expect(next.worldBookIds).toEqual([]);
    expect(next.characterCardIds).toEqual(['c9']);
    expect(next.userPersonaIds).toEqual([]);
    expect(next.writingStyleIds).toEqual([]);
  });

  it('保留未分组字段 knowledgeItemIds / referenceMaterials', () => {
    const ref: ReferenceMaterial = { id: 'r1', type: 'text', content: 'x', name: 'ref' };
    const withRef: WritingResourceConfig = { ...base, referenceMaterials: [ref] };
    const next = buildResourcesPatch(withRef, 'userPersonaIds', []);
    expect(next.knowledgeItemIds).toEqual(['k1']);
    expect(next.referenceMaterials).toBe(withRef.referenceMaterials);
  });

  it('空 id 集合表示清空该分组绑定', () => {
    const next = buildResourcesPatch(base, 'writingStyleIds', []);
    expect(next.writingStyleIds).toEqual([]);
  });
});

describe('v2ResourceUtils.V2_RESOURCE_GROUPS', () => {
  it('恰好覆盖 WritingResourceConfig 的四个可绑定分组', () => {
    expect(V2_RESOURCE_GROUPS.map((g) => g.key)).toEqual([
      'worldBookIds',
      'characterCardIds',
      'userPersonaIds',
      'writingStyleIds',
    ]);
  });
});
