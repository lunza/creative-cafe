import type { WritingResourceConfig } from '../../../../../shared/types/writing-v2.types';

/** 素材分组定义（P3：世界书 / 角色卡 / 人设 / 写作风格） */
export const V2_RESOURCE_GROUPS = [
  { key: 'worldBookIds', label: '世界书' },
  { key: 'characterCardIds', label: '角色卡' },
  { key: 'userPersonaIds', label: '人设' },
  { key: 'writingStyleIds', label: '写作风格' },
] as const;

export type V2ResourceGroupKey = (typeof V2_RESOURCE_GROUPS)[number]['key'];

/** 切换单个资源的绑定状态（纯函数，供单测） */
export function toggleResourceId(ids: string[] | undefined, id: string): string[] {
  const list = ids ? [...ids] : [];
  const idx = list.indexOf(id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push(id);
  }
  return list;
}

/**
 * 基于分组 + 新 id 集合计算新的 resources 配置（纯函数，供单测）。
 * 保留未分组字段（knowledgeItemIds / referenceMaterials）。
 */
export function buildResourcesPatch(
  current: WritingResourceConfig | undefined,
  group: V2ResourceGroupKey,
  nextIds: string[]
): WritingResourceConfig {
  const base: WritingResourceConfig = {
    worldBookIds: current?.worldBookIds ?? [],
    characterCardIds: current?.characterCardIds ?? [],
    userPersonaIds: current?.userPersonaIds ?? [],
    knowledgeItemIds: current?.knowledgeItemIds,
    referenceMaterials: current?.referenceMaterials,
    writingStyleIds: current?.writingStyleIds ?? [],
  };
  base[group] = nextIds;
  return base;
}
