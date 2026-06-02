# 整合剧情检测与逻辑检测提示词体系 Spec

## Why
当前剧情检测提示词中，逻辑矛盾检测说明放在内容之后，导致 AI 注意力分散。同时剧情问题和逻辑问题在返回结果中被分开处理（dimensions 和 logic_check_result），增加了前端复杂度。需要整合为统一的检测引导语和输出格式，提升检测准确性和效率。

## What Changes
- 重构 `buildCheckPrompt` 方法，将逻辑矛盾检测引导语移至内容之前，形成统一的"剧情+逻辑检测体系"引导语
- 统一输出格式：不再区分 dimension 和 logic 两个独立结构，所有问题统一放在 `issues` 数组中
- 每个问题必须包含 `type` 字段标识问题类别（dimension 或 logic）
- 强制要求每个问题提供 `quickFixSuggestion` 字段（如不适用可设为 null）
- 简化 `parseCheckResponse` 方法，适配新的统一输出格式
- 更新 `PlotCheckReport` 类型定义以支持统一问题结构

## Impact
- Affected specs: 剧情检查功能、AI 检测提示词体系
- Affected code:
  - `src/main/services/writing/PlotCheckerService.ts`（核心修改）
  - `src/shared/types/writing.types.ts`（类型定义调整）
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`（UI 适配）
  - `src/renderer/components/Creative/WritingMode/WritingModeRightPanel.tsx`（面板适配）
  - `src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts`（逻辑适配）

## MODIFIED Requirements
### Requirement: 统一检测引导语
系统 SHALL 在待检测文章内容前方，提供一套规范的"剧情+逻辑检测体系"引导语，包含：
- 角色定义："你是一个专业的小说编辑和质量检查助手。请对以下章节内容进行多维度检查......"
- 逻辑矛盾检测说明："## 逻辑矛盾检测\n请同时检测以下类型的逻辑矛盾：......"
- 完整的检测维度和逻辑矛盾类型列表

### Requirement: 统一输出格式
系统 SHALL 严格按照指定 JSON 格式返回检查结果（不得包含 markdown 代码块标记），所有问题统一在一个 `issues` 数组中，每个问题包含 `category` 字段标识是剧情维度问题还是逻辑问题。

### Requirement: 强制 quickFixSuggestion
系统 SHALL 对于每个识别出的问题，提供 `quickFixSuggestion` 字段，包含 originalText（必须是章节内容中一字不差的原文）、fixedText、reason。如问题不涉及具体文本修改，quickFixSuggestion 可设为 null。
