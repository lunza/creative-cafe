# 修复首个章节拆分索引与状态键不一致 Bug

## 问题描述

拆分第一个章节后出现三个连锁问题：
1. **索引生成异常**：拆分后生成 `index: 1` 和 `index: 1.1`，而非 `1.1` 和 `1.2`
2. **清空/重新生成按钮不可点击**：章节有内容但按钮 disabled
3. **保存提示内容为空**：编辑器有内容但保存时提示"当前章节内容为空"

## 根因分析

### 根因 1：拆分索引从 0 开始 (ContentWorkspace.tsx:552)

```typescript
const chapterIndex = baseIndex + i * 0.1;
// i=0: 1 + 0*0.1 = 1  (错误，应为 1.1)
// i=1: 1 + 1*0.1 = 1.1 (错误，应为 1.2)
```

### 根因 2：按钮 disabled 条件使用 `selectedChapterIndex` 而非 `ch.index`

- Line 733: `disabled={!chapterContents[selectedChapterIndex] && !streamingContent}` — 重新生成按钮
- Line 759: 清空按钮的 Popconfirm 也有同样问题

当 `selectedChapterIndex=0` 但 `ch.index=1`（或 `1.1`）时：
- `chapterContents[0] = undefined` → disabled=true（错误！章节实际有内容）

### 根因 3：handleSaveChapter 使用 `ch.index === selectedChapterIndex` 查找章节

```typescript
const currentChapter = outline.chapters.find(ch => ch.index === selectedChapterIndex);
// selectedChapterIndex=0 时，找不到 index=0 的章节（实际是 index=1）
// currentChapter = undefined → 提示内容为空
```

## 修复方案

### 修复 1：拆分索引从 0.1 开始 (line 552)

```typescript
// 修改前
const chapterIndex = baseIndex + i * 0.1;

// 修改后
const chapterIndex = baseIndex + (i + 1) * 0.1;
// i=0: 1 + 1*0.1 = 1.1 ✓
// i=1: 1 + 2*0.1 = 1.2 ✓
```

### 修复 2：handleSaveChapter 查找逻辑 (line 485)

```typescript
// 修改前
const currentChapter = outline.chapters.find(ch => ch.index === selectedChapterIndex);

// 修改后
const currentChapter = outline.chapters[selectedChapterIndex];
if (!currentChapter) {
  message.warning('未找到当前章节');
  return;
}
```

同时修改 fallback 读取：
```typescript
// 修改前
const content = editorContentRef.current || streamingContent || chapterContents[selectedChapterIndex] || '';

// 修改后
const content = editorContentRef.current || streamingContent || chapterContents[currentChapter.index] || '';
```

### 修复 3：重新生成按钮 disabled 条件 (line 733)

```typescript
// 修改前
disabled={!chapterContents[selectedChapterIndex] && !streamingContent}

// 修改后
disabled={!chapterContents[outline.chapters[selectedChapterIndex]?.index] && !streamingContent}
```

### 修复 4：清空按钮 disabled 条件 (line 759)

Popconfirm 外层需要添加 disabled 条件：
```typescript
disabled={!chapterContents[outline.chapters[selectedChapterIndex]?.index] && !streamingContent}
```

## 影响范围

- 仅修改 `ContentWorkspace.tsx`
- 共 4 处修改
