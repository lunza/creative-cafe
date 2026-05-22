# 简化章节索引机制方案

## 当前问题

### index 字段存在三种不一致的语义

| 模块 | index 含义 | 值范围 |
|------|-----------|--------|
| OutlineGenerator | 章节编号（1-based） | 1, 2, 3... |
| ManualOutlineEditor | 数组位置（0-based，编辑后重编号） | 0, 1, 2... |
| ContentWorkspace | 章节编号（1-based）+ 浮点数拆分索引 | 1, 1.1, 1.2... |

### 由此引发的连锁问题

1. **ContentWorkspace 中的双键机制**：`selectedChapterIndex`（数组位置）和 `ch.index`（逻辑编号）混用，导致 `chapterContents[ch.index]` 与 `chapterContents[selectedChapterIndex]` 读写不一致。

2. **保存/清空功能失效**：`handleSaveChapter` 使用 `ch.index === selectedChapterIndex` 查找章节，当 `selectedChapterIndex=0` 但 `ch.index=1` 时找不到章节。

3. **按钮 disabled 逻辑复杂**：因为键不一致，每个按钮的 disabled 条件都需要特殊处理。

4. **StorageService 中的查找**：`project.chapters.find(c => c.index === chapterIndex)` 在 `chapterIndex` 传入 `selectedChapterIndex` 时会失败。

## 目标设计

**统一原则**：`index` = 数组位置（0-based），全局唯一，兼具标识和排序功能。

### 具体变更

#### 1. OutlineGenerator 修改

**文件**: `src/main/services/writing/OutlineGenerator.ts`

```typescript
// 修改前
chapters: data.chapters.map((ch: any, idx: number) => ({
  index: ch.index || idx + 1,  // 1-based
  ...
}))

// 修改后
chapters: data.chapters.map((ch: any, idx: number) => ({
  index: idx,  // 0-based，即数组位置
  ...
}))
```

#### 2. ContentWorkspace 简化

**文件**: `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`

**核心变更**：所有 `ch.index` 替换为 `selectedChapterIndex` 或直接使用数组位置。

| 位置 | 修改前 | 修改后 |
|------|--------|--------|
| chapterContents 键 | `chapterContents[ch.index]` | `chapterContents[selectedChapterIndex]` |
| chapterStatuses 键 | `chapterStatuses[ch.index]` | `chapterStatuses[selectedChapterIndex]` |
| handleSaveChapter 查找 | `find(ch => ch.index === selectedChapterIndex)` | `outline.chapters[selectedChapterIndex]` |
| handleGenerateChapter previousChapters | `ch.index < chapterIndex` | `idx < chapterIndex` |
| handleConfirmSplit 索引 | `baseIndex + (i + 1) * 0.1` | `selectedChapterIndex + i + 1`（直接用数组位置） |
| 清空按钮 disabled | `!chapterContents[currentChapter?.index]` | `false`（移除 disabled，空内容也允许清空） |
| 重新生成 disabled | `!chapterContents[currentChapter?.index]` | `false`（移除 disabled） |
| 编辑器 value | `chapterContents[currentChapter.index]` | `chapterContents[selectedChapterIndex]` |
| currentWordCount | `chapterContents[currentChapter?.index]` | `chapterContents[selectedChapterIndex]` |
| 菜单 key | `String(arrayIdx)`（已修复） | 保持不变 |
| 编辑器 key | `currentChapter.index` | `selectedChapterIndex` |

**简化后的状态管理**：
```typescript
// chapterContents 和 chapterStatuses 的键统一为 selectedChapterIndex（0, 1, 2...）
const [chapterContents, setChapterContents] = useState<Record<number, string>>({});
const [chapterStatuses, setChapterStatuses] = useState<Record<number, ChapterStatus>>({});
// 所有读写：chapterContents[selectedChapterIndex]
```

#### 3. ManualOutlineEditor 修改

**文件**: `src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx`

- `buildTreeData` 已使用 `arrayIndex` 生成 key，保持不变
- 删除/移动/合并/分割操作中的 `ch.index = idx` 重编号逻辑保持不变（已经是 0-based）
- `renderTreeNode` 中的 `node.chapterIndex` 保持不变
- 显示标题 `第 ${chapter.index + 1} 章` 改为 `第 ${idx + 1} 章`（idx 为 map 回调参数）

#### 4. WritingStorageService 修改

**文件**: `src/main/services/WritingStorageService.ts`

- `autoSaveChapter`、`saveVersion`、`restoreVersion` 中 `find(c => c.index === chapterIndex)` 保持不变（因为现在 index = 数组位置，chapterIndex 传的就是 selectedChapterIndex）
- 文件名 `chapter-${chapter.index}.md` 保持不变

#### 5. ContentGenerator 修改

**文件**: `src/main/services/writing/ContentGenerator.ts`

- 日志中的 `chapterIndex: request.chapterInfo?.index` 保持不变（现在是 0-based）
- 提示词构建中 `ch.index + 1` 显示为"第 N 章"，保持不变（因为 index=0 时 ch.index+1=1）

#### 6. writingHandlers.ts 修改

**文件**: `src/main/ipc/handlers/writingHandlers.ts`

- `writing:generateChapter` 中 `chapterIndex` 参数已使用 `selectedChapterIndex`，保持不变
- `writing:autoSaveChapter`、`writing:saveVersion`、`writing:restoreVersion` 中的 `chapterIndex` 传的是 `selectedChapterIndex`，保持不变

## 修改文件清单

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `OutlineGenerator.ts` | index 从 `idx + 1` 改为 `idx` | 高 |
| `ContentWorkspace.tsx` | 统一使用 `selectedChapterIndex` 作为键，移除 disabled 校验 | 高 |
| `ManualOutlineEditor.tsx` | 显示文本改为 `idx + 1`，重编号逻辑不变 | 中 |

## 预期效果

1. **代码简化**：ContentWorkspace 中约 30 处 `ch.index` / `currentChapter.index` 引用可简化为 `selectedChapterIndex`
2. **Bug 根除**：不再有 `ch.index` 与数组位置不一致的问题
3. **用户体验**：清空/重新生成按钮始终可点击，无需额外校验
4. **向后兼容**：已有项目数据中的 `index` 值可能需要迁移（从 1-based 转为 0-based），或在加载时做兼容处理

## 数据迁移策略

**方案 A（推荐）**：加载时自动转换
- 在 `loadProject` 时检测 `index` 是否从 1 开始连续递增
- 如果是，将所有 `index` 减 1，保存回存储

**方案 B**：用户侧提示
- 检测到旧格式数据时提示用户"需要更新项目索引格式"
- 用户确认后自动转换
