# 修复清空功能和分解功能 Bug

## 问题描述

1. **清空功能失效**：点击清空按钮后，界面显示"章节内容已清空"提示，但编辑器中的文字内容并未被删除。
2. **分解后内容位置错误**：进行章节分解操作后，新添加的子章节显示了错误的原章节内容。

## 根因分析

### 核心问题：`selectedChapterIndex` 与 `ch.index` 混淆

代码中存在两种章节标识方式：
- `selectedChapterIndex`：章节在 `outline.chapters` 数组中的**位置索引**（0, 1, 2...）
- `ch.index`：章节对象上的**逻辑索引**属性（可能为整数如 1, 2 或浮点数如 0.1, 0.2，分解后会产生浮点数索引）

`chapterContents` 和 `chapterStatuses` 的键是 `ch.index`（逻辑索引），但部分操作错误地使用了 `selectedChapterIndex`（位置索引）作为键。

### Bug 1：清空功能

`handleClearChapter` 中的错误：
```typescript
// 错误：使用 selectedChapterIndex 作为键
setChapterContents(prev => ({ ...prev, [selectedChapterIndex]: '' }));
setChapterStatuses(prev => ({ ...prev, [selectedChapterIndex]: ChapterStatus.PENDING }));
```

当 `selectedChapterIndex = 0` 但 `ch.index = 1`（或分解后的 `0.1`）时，清空操作写入了错误的键 `0`，而编辑器读取的是键 `ch.index`（即 `1` 或 `0.1`），所以内容没有被清除。

Popconfirm 内联代码同样存在此问题。

### Bug 2：分解后内容位置错误

`handleConfirmSplit` 中的错误：
```typescript
// 错误：清空整个 chapterContents，丢失所有章节内容
setChapterContents({});
setChapterStatuses({});
setSelectedChapterIndex(0);
```

清空整个状态对象后，`useEffect` 依赖 `outline` 变化重新加载项目数据。但由于时序问题，加载的是旧项目数据，导致内容不匹配。

正确的做法是：
1. 清除被替换的旧章节索引的内容
2. 为新创建的子章节初始化空内容
3. 保留其他未受影响章节的内容
4. 选中第一个子章节（位置索引 0 或根据新数组结构调整）

## 修复方案

### 步骤 1：修复 `handleClearChapter`

统一使用 `ch.index`（逻辑索引）作为 `chapterContents` 和 `chapterStatuses` 的键：

```typescript
const handleClearChapter = useCallback(() => {
  const ch = outline.chapters[selectedChapterIndex];
  if (!ch) return;

  // 使用 ch.index 而非 selectedChapterIndex
  setChapterContents(prev => ({ ...prev, [ch.index]: '' }));
  setChapterStatuses(prev => ({ ...prev, [ch.index]: ChapterStatus.PENDING }));
  // ... 其余代码保持不变
}, [selectedChapterIndex, outline, getCurrentProject, updateProject, saveProject]);
```

### 步骤 2：修复 Popconfirm 内联清空代码

同样使用 `ch.index` 作为键。

### 步骤 3：修复 `handleConfirmSplit`

不再清空整个 `chapterContents`，而是：
1. 清除旧章节的内容
2. 初始化新子章节的空内容
3. 保留其他章节内容不变

```typescript
const handleConfirmSplit = useCallback(() => {
  // ... 构建 newChapters ...

  const project = getCurrentProject();
  if (project) {
    // ... 更新 project.chapters ...
  }

  // 正确的方式：只清除和初始化相关章节
  const newContents: Record<number, string> = {};
  const newStatuses: Record<number, ChapterStatus> = {};

  // 清除旧章节内容
  newContents[currentChapter.index] = '';
  newStatuses[currentChapter.index] = ChapterStatus.PENDING;

  // 初始化新子章节
  for (const ch of newChapters) {
    newContents[ch.index] = splitMode === 'content' ? /* 分割后的内容 */ : '';
    newStatuses[ch.index] = ChapterStatus.PENDING;
  }

  // 合并到现有状态
  setChapterContents(prev => ({ ...prev, ...newContents }));
  setChapterStatuses(prev => ({ ...prev, ...newStatuses }));

  // 选中第一个子章节
  setSelectedChapterIndex(selectedChapterIndex); // 保持在相同位置

  setShowSplitModal(false);
  setStreamingContent('');
  setCurrentChapterWords(0);
  message.success(`已将章节拆分为 ${splitCount} 个子章节`);
}, [...]);
```

### 步骤 4：统一 `chapterContents` 和 `chapterStatuses` 的键

确保所有读取和写入操作都使用 `ch.index`：

| 位置 | 当前代码 | 应修改为 |
|------|----------|----------|
| handleClearChapter | `[selectedChapterIndex]` | `[ch.index]` |
| Popconfirm onConfirm | `[selectedChapterIndex]` | `[ch.index]` |
| handleConfirmSplit | `setChapterContents({})` | 只清除/更新相关章节 |
| handleGenerateChapter | `[chapterIndex]` (正确) | 保持不变 |
| stream complete handler | `[data.chapterIndex]` (正确) | 保持不变 |
| 编辑器 value | `chapterContents[selectedChapterIndex]` | `chapterContents[currentChapter.index]` |

### 步骤 5：修复编辑器 value 读取

当前编辑器读取：
```typescript
value={chapterContents[selectedChapterIndex] || ''}
```

应改为：
```typescript
value={chapterContents[currentChapter.index] || ''}
```

这样确保始终使用正确的键读取内容。

## 影响范围

- 仅修改 `ContentWorkspace.tsx`
- 不影响其他组件或后端逻辑
