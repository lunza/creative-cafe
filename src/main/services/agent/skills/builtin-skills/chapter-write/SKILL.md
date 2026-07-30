---
name: chapter-write
description: "根据大纲与前文上下文生成完整的章节正文。当用户请求写一章、续写章节、或按大纲生成内容时使用。支持指定叙事视角（第一/第三人称）、写作风格、字数目标，并自动注入角色卡设定与世界书条目保持一致性。"
emoji: ✍️
user-invocable: true
disable-model-invocation: false
command-name: /chapter-write
command-tool: writeChapter
---

# Chapter Write

用于生成小说章节正文。本技能调用 `writeChapter` 工具，根据大纲与前文生成完整章节。

## 使用场景

- 按大纲生成新章节
- 续写当前章节（基于已有片段）
- 根据修改后的大纲重写章节
- 多视角切换（第一人称 ↔ 第三人称）

## 调用方式

### 模型自主调用

当用户请求"写下一章"、"续写"、"按大纲生成"等时，模型应调用 `writeChapter` 工具：

```
writeChapter({
  chapterOutline: {             // 章节大纲
    title: "初入江湖",
    summary: "...",
    coreEvents: [...],
    conflicts: [...],
    suggestedWordCount: 3000
  },
  previousContext: "...",       // 前文摘要（最近 2-3 章）
  characterCards: [...],        // 本章出场角色卡
  worldBookEntries: [...],      // 相关世界书条目
  writingStyle: {               // 写作风格
    narrativePerspective: "third_person_limited",
    tone: "严肃",
    pacing: "medium"
  },
  targetWordCount: 3000         // 目标字数（可选，默认取大纲建议）
})
```

### 用户命令调用

在命令面板输入 `/chapter-write` 触发章节写作向导。

## 返回结构

`writeChapter` 工具返回 JSON 结构，包含：

- `content`：章节正文（markdown 格式）
- `wordCount`：实际字数
- `appliedWorldBookEntries`：引用的世界书条目列表
- `characterAppearances`：出场角色列表
- `continuityCheck`：与前文的连续性检查结果
- `suggestedNextActions`：建议的后续操作（如 `plot-check`、`update-state-table`）

## 叙事视角

支持的叙事视角：

- `first_person`：第一人称（我）
- `third_person_limited`：第三人称有限（聚焦单一角色视角）
- `third_person_omniscient`：第三人称全知
- `second_person`：第二人称（你，较少用）

## 一致性保障

写作时自动注入以下上下文保持一致：

1. **角色卡设定**：角色性格、外貌、背景、关系
2. **世界书条目**：根据章节内容关键词匹配相关条目
3. **前文摘要**：最近 2-3 章的关键事件与状态
4. **状态表**：角色当前状态（位置、物品、关系值等）

## 注意事项

- 生成后建议立即调用 `plot-check` 检查一致性
- 若生成内容偏离大纲，可调整 `previousContext` 或 `writingStyle` 重新生成
- 长章节（>5000 字）建议分段生成，避免单次输出被截断
- 写作风格可由用户预设，也可在调用时临时指定
