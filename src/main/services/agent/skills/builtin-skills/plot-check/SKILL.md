---
name: plot-check
description: "检查写作章节的剧情一致性、逻辑矛盾与维度问题（大纲一致性/世界书合规/角色一致性/写作风格/剧情连续性）。当用户请求审核章节质量、查找剧情漏洞、或要求快速修复建议时使用。返回带 quickFixSuggestion 的问题列表，可一键应用修复。"
emoji: 🔍
user-invocable: true
disable-model-invocation: false
command-name: /plot-check
command-tool: plotCheck
---

# Plot Check

用于检查小说章节的剧情质量与一致性。本技能调用 `plotCheck` 工具，对章节内容进行多维度审核。

## 使用场景

- 写完一章后，检查是否与前文存在逻辑矛盾
- 检查角色行为是否符合角色卡设定
- 检查世界书条目是否被正确引用
- 检查大纲一致性与剧情连续性
- 获取可一键应用的快速修复建议（quickFixSuggestion）

## 检查维度

1. **outline_consistency**（大纲一致性）：章节内容是否偏离大纲设定
2. **worldbook_compliance**（世界书合规）：是否违反世界书建立的规则
3. **character_consistency**（角色一致性）：角色言行是否符合角色卡
4. **writing_style**（写作风格）：文风是否与整体保持一致
5. **plot_continuity**（剧情连续性）：前后章节是否衔接顺畅

## 调用方式

### 模型自主调用

当用户在写作模式下请求"检查这一章"、"审核剧情"、"找找问题"等时，模型应调用 `plotCheck` 工具：

```
plotCheck({ chapterId: "<章节ID>", chapterContent: "<章节正文>", previousContext: "<前文摘要，可选>" })
```

### 用户命令调用

在命令面板输入 `/plot-check` 触发当前章节的剧情检查。

## 返回结构

`plotCheck` 工具返回 JSON 结构，包含：

- `overallScore`：总体评分（0-100）
- `dimensionScores`：各维度评分
- `issues`：问题列表，每个问题含：
  - `dimension`：所属维度
  - `severity`：严重程度（low/medium/high/critical）
  - `title`：问题标题
  - `description`：问题描述
  - `suggestion`：修复建议（文字描述）
  - `quickFixable`：是否可一键修复
  - `quickFixSuggestion`：快速修复建议（含 originalText/fixedText/position）
- `logicIssues`：逻辑矛盾列表

## 修复应用

当 `quickFixable=true` 时，可通过 `applyQuickFix` 工具一键应用 `quickFixSuggestion`：

```
applyQuickFix({ chapterId: "<章节ID>", issueIndex: 0 })
```

修复前会校验 `originalText` 是否能在章节中匹配（精确/修剪/锚点/position 四策略），校验失败则降级为不可修复。

## 注意事项

- 检查需要章节正文与前文上下文，前文过短时部分维度可能无法评估
- `quickFixSuggestion` 的 `originalText` 必须与章节内容精确匹配（或经锚点匹配）才能应用
- 严重问题（critical）应优先修复，避免累积到后续章节
