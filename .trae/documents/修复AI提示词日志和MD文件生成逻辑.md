# 修复AI提示词日志和MD文件生成逻辑计划

## 问题描述

### 问题1: AI提示词日志记录不完整
- `ContentGenerator.generateStream` 在第100行调用 `logRequest` 记录AI请求，包含完整prompt
- 但用户反馈完整提示词未能完全打印到 `ai-handler.log` 文件
- 需要检查日志记录逻辑确保prompt完整记录

### 问题2: MD文件提前创建与命名异常
- `WritingStorageService.saveProject` 在保存项目时为所有章节创建MD文件（第127-128行）
- 即使章节内容为空也会创建0KB文件
- 文件命名使用 `chapter-${chapter.index}.md`，受浮点数精度影响产生 `chapter-1.2000000000000002.md`
- 用户期望：仅在用户点击"生成"并确认后才创建对应MD文件

## 根本原因分析

### 问题1根因
`logRequest` 调用 `logDetailed` → `JSON.stringify(data, null, 2)`，prompt字段应能完整序列化。但可能存在：
- prompt过大导致日志文件旋转
- 或者prompt在某些情况下未正确传入

### 问题2根因
`saveProject` 方法无条件为所有章节创建MD文件：
```typescript
for (const chapter of project.chapters) {
  const chapterFile = path.join(getChaptersDir(project.id), `chapter-${chapter.index}.md`);
  fs.writeFileSync(chapterFile, chapter.content, 'utf8');
}
```
即使 `chapter.content` 为空字符串也创建文件。

## 解决方案

### 方案1: 修复AI提示词日志记录

**修改文件**: `src/main/services/writing/ContentGenerator.ts`

在 `logRequest` 调用前增加prompt长度信息，确保日志可追溯：

```typescript
// 修改前 (第100行)
logRequest('writing:generateChapter:api', {
  chapterIndex: request.chapterInfo?.index,
  chapterTitle: request.chapterInfo?.title,
  prompt
});

// 修改后
logRequest('writing:generateChapter:api', {
  chapterIndex: request.chapterInfo?.index,
  chapterTitle: request.chapterInfo?.title,
  promptLength: prompt.length,
  prompt
});
```

### 方案2: 修复MD文件生成逻辑

#### 2.1 修改 `saveProject` - 仅保存有内容的章节

**修改文件**: `src/main/services/WritingStorageService.ts` 第124-129行

```typescript
// 修改前
if (project.chapters) {
  for (const chapter of project.chapters) {
    const chapterFile = path.join(getChaptersDir(project.id), `chapter-${chapter.index}.md`);
    fs.writeFileSync(chapterFile, chapter.content, 'utf8');
  }
}

// 修改后 - 仅保存有内容的章节
if (project.chapters) {
  const chaptersDir = getChaptersDir(project.id);
  if (!fs.existsSync(chaptersDir)) {
    fs.mkdirSync(chaptersDir, { recursive: true });
  }
  for (const chapter of project.chapters) {
    // 仅当章节有内容时才创建/更新MD文件
    if (chapter.content && chapter.content.trim().length > 0) {
      const safeIndex = this.formatChapterIndex(chapter.index);
      const chapterFile = path.join(chaptersDir, `chapter-${safeIndex}.md`);
      fs.writeFileSync(chapterFile, chapter.content, 'utf8');
    }
  }
}
```

#### 2.2 修改 `autoSaveChapter` - 确保内容写入完整性

**修改文件**: `src/main/services/WritingStorageService.ts` 第276-279行

```typescript
// 修改前
const chapterFile = path.join(getChaptersDir(projectId), `chapter-${chapterIndex}.md`);
fs.writeFileSync(chapterFile, content, 'utf8');

// 修改后
if (!content || content.trim().length === 0) {
  console.log('[WritingStorage] Skipping empty chapter file save for index:', chapterIndex);
  return;
}
const safeIndex = this.formatChapterIndex(chapterIndex);
const chapterFile = path.join(getChaptersDir(projectId), `chapter-${safeIndex}.md`);
fs.writeFileSync(chapterFile, content, 'utf8');
console.log('[WritingStorage] Chapter file saved:', chapterFile, 'size:', content.length);
```

#### 2.3 新增 `formatChapterIndex` 方法 - 修复浮点数命名问题

**修改文件**: `src/main/services/WritingStorageService.ts`

新增方法：
```typescript
private formatChapterIndex(index: number): string {
  // 修复浮点数精度问题：1.2000000000000002 → "1.2"
  // 最多保留10位小数，去除末尾的0
  return parseFloat(index.toFixed(10)).toString();
}
```

## 实施步骤

### 步骤1: 修改 WritingStorageService.ts
1. 新增 `formatChapterIndex` 私有方法
2. 修改 `saveProject` 方法 - 仅保存有内容的章节
3. 修改 `autoSaveChapter` 方法 - 跳过空内容并添加完整性日志

### 步骤2: 修改 ContentGenerator.ts
1. 在 `logRequest` 调用中添加 `promptLength` 字段便于排查

### 步骤3: 清理现有异常文件
- 提供说明：用户需手动删除已生成的0KB异常文件
- 或提供清理脚本（可选）

### 步骤4: 验证编译通过

## 风险评估

### 低风险
- 添加 `promptLength` 日志字段
- 添加 `formatChapterIndex` 方法

### 中风险
- `saveProject` 不再为所有章节创建文件，可能影响依赖此行为的代码
- 需要确认没有其他模块依赖"所有章节都有对应MD文件"的假设

### 缓解措施
- 仅当 `content.trim().length > 0` 时才跳过，空字符串仍会写入（但用户场景中空内容不需要文件）
- 添加日志便于排查

## 验收标准
- [ ] AI请求日志包含完整prompt和promptLength
- [ ] 空章节不会创建0KB MD文件
- [ ] 文件命名正确（如 `chapter-1.2.md` 而非 `chapter-1.2000000000000002.md`）
- [ ] 生成完成后章节内容正确写入MD文件
- [ ] TypeScript编译无错误
