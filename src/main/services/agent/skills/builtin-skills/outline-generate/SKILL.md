---
name: outline-generate
description: "根据小说类型、主题与既有设定生成结构化章节大纲。当用户请求生成大纲、规划章节结构、或扩展故事框架时使用。支持按小说类型（玄幻/言情/科幻/悬疑等）应用对应的叙事节奏模板，生成含章节标题、核心事件、冲突点、字数建议的大纲列表。"
emoji: 📋
user-invocable: true
disable-model-invocation: false
command-name: /outline-generate
command-tool: outlineGenerate
---

# Outline Generate

用于生成小说章节大纲。本技能调用 `outlineGenerate` 工具，根据用户提供的主题、类型与既有设定生成结构化大纲。

## 使用场景

- 开始新小说项目时，生成初始章节大纲
- 既有大纲基础上，扩展后续章节
- 根据世界书设定，规划符合世界观的剧情走向
- 调整叙事节奏（起承转合）的章节分布

## 调用方式

### 模型自主调用

当用户请求"生成大纲"、"规划章节"、"帮我列个提纲"等时，模型应调用 `outlineGenerate` 工具：

```
outlineGenerate({
  novelType: "玄幻",           // 小说类型
  theme: "少年复仇",           // 核心主题
  targetChapters: 20,          // 目标章节数
  existingOutline: [...],      // 既有大纲（扩展时传入）
  worldBookContext: {...},     // 世界书设定（可选）
  characterCards: [...],       // 主要角色卡（可选）
  writingStyle: {...}          // 写作风格偏好（可选）
})
```

### 用户命令调用

在命令面板输入 `/outline-generate` 触发大纲生成向导。

## 返回结构

`outlineGenerate` 工具返回 JSON 结构，包含：

- `outlines`：章节大纲列表，每章含：
  - `chapterIndex`：章节序号
  - `title`：章节标题
  - `summary`：章节摘要（100-200 字）
  - `coreEvents`：核心事件列表
  - `conflicts`：冲突点列表
  - `characterFocus`：本章重点角色
  - `suggestedWordCount`：建议字数
  - `narrativeBeat`：叙事节拍（起/承/转/合）
- `overallStructure`：整体结构分析（三幕式/五幕式等）
- `pacingAnalysis`：节奏分析

## 小说类型模板

不同小说类型有对应的叙事节奏模板：

- **玄幻**：升级流，每 3-5 章一个小高潮，每 15-20 章一个大高潮
- **言情**：情感线推进，误会-相遇-相知-相恋-考验-圆满
- **科幻**：设定展开，世界观建立-冲突引入-危机升级-解决
- **悬疑**：悬念铺设，案件发生-调查-反转-真相-收尾
- **都市**：日常流，生活片段-矛盾积累-爆发-和解

## 注意事项

- 生成的大纲可由用户手动编辑调整，再用于后续章节写作
- 既有大纲扩展时，新章节应与前文衔接（参考 `previousContext`）
- 世界书设定会约束大纲走向（如魔法体系、地理环境、社会结构）
- 角色卡会影响章节重点角色分配与人物弧光设计
