/**
 * 【Phase 3 / L2 - conversation-mode-optimization-report】特征标签去重工具（R3）。
 *
 * 原三处内联去重逻辑合并（大小写不敏感、保留首次出现项、维持原顺序）：
 * - useImageGeneration：enabledTraitTexts 去重 + 上下文 tag 合并去重
 * - AssetGenerateModal：SD 生成前去重（重点标记：重复 tag 会导致 SD 多次加权）
 *
 * 语义与原实现一致：去重 key 为 text.trim().toLowerCase()，权重不影响去重。
 */

/** 按 text 大小写不敏感去重（保留首次出现的项，维持原有顺序） */
export function dedupeTraitsByText<T extends { text: string }>(traits: T[]): T[] {
  const seen = new Set<string>();
  return traits.filter((t) => {
    const key = t.text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 将 additions 中 base 尚不存在的项（大小写不敏感）追加到 base 后，返回新数组 */
export function mergeTraitsUnique<T extends { text: string }>(base: T[], additions: T[]): T[] {
  const existing = new Set(base.map((t) => t.text.trim().toLowerCase()));
  const toAdd = additions.filter((t) => {
    const key = t.text.trim().toLowerCase();
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  return [...base, ...toAdd];
}
