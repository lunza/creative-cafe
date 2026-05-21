# 修复手动大纲编辑器章节选择偏移 Bug

## Bug 描述

在手动大纲编辑器中，用户点击章节节点后，右侧属性面板显示的章节信息出现偏移（如点击"加码十美元"却显示"一百美元的深渊"的内容）。

## 操作步骤

1. 打开写作项目，进入"大纲设计"模式
2. 切换到"手动编辑"标签
3. 点击左侧章节列表中的任意章节节点
4. 观察右侧"章节属性"面板的内容

## 根因分析

问题出在 `ManualOutlineEditor.tsx` 中的章节选择和属性加载机制：

1. **`findChapterKeys` 递归函数存在潜在问题**：该函数使用 `children[index]` 和 `children.findIndex()` 混合逻辑来定位章节位置。在单子章节和多子章节情况下使用不同的路径生成策略，可能导致键值不一致。

2. **`handleSelect` 中的表单值更新可能受异步影响**：`setSelectedKeys` 是异步状态更新，而 `form.setFieldsValue` 是同步调用，两者之间没有同步保证。

3. **Ant Design Tree 的 `onSelect` 事件与自定义 `onClick` 可能冲突**：树组件的 `onSelect` 和 span 上的 `onClick` 都会触发 `handleSelect`，在快速点击或拖拽后可能产生时序问题。

## 修复方案

### 步骤 1: 重写 `findChapterKeys` 函数

将 `findChapterKeys` 函数改为始终使用 `findIndex` 来定位章节位置，移除对 `index` 循环变量的依赖，确保路径生成的一致性。

```typescript
// 修改前（混合使用 index 和 findIndex）
if (children.length === 1) {
  return [...parentKeys, `${ch.parentId || 'root'}-${index}`];
} else {
  const key = children.findIndex(c => c.id === ch.id);
  return [...parentKeys, `${ch.parentId || 'root'}-${key}`];
}

// 修改后（统一使用 findIndex）
const key = children.findIndex(c => c.id === ch.id || c === ch);
if (key >= 0) {
  return [...parentKeys, `${ch.parentId || 'root'}-${key}`];
}
```

### 步骤 2: 移除 `onSelect` 回调，统一使用 `onClick`

Ant Design Tree 的 `onSelect` 与自定义 `onClick` 会产生双重触发。移除 `onSelect`，只保留 span 上的 `onClick` 处理选择逻辑。

```tsx
// 移除 onSelect 属性，改为：
<Tree
  treeData={treeData}
  selectedKeys={selectedKeys}
  // 移除 onSelect
  ...
/>
```

### 步骤 3: 确保表单更新与状态同步

在 `handleSelect` 中使用 `setTimeout` 或 `requestAnimationFrame` 确保 DOM 更新后再设置表单值：

```typescript
const handleSelect = (chapter: ChapterOutline) => {
  const keys = findChapterKeys(chapters, chapter);
  setSelectedKeys(keys);
  
  // 确保状态更新后再设置表单值
  setTimeout(() => {
    form.setFieldsValue({
      title: chapter.title || '',
      summary: chapter.summary || '',
      targetWordCount: chapter.targetWordCount || 10000,
      chapterType: chapter.chapterType || ChapterType.MAIN_PLOT,
      importance: chapter.importance || ImportanceLevel.MEDIUM,
      keyPlotPoints: (chapter.keyPlotPoints || []).join('\n')
    });
  }, 0);
};
```

### 步骤 4: 增强章节定位逻辑

在 `findChapterKeys` 中增加 `c === ch` 的引用比较作为 fallback，处理 `id` 可能缺失的情况。

## 影响范围

- 仅影响 `ManualOutlineEditor.tsx` 组件
- 不影响大纲生成、内容创作等其他功能
