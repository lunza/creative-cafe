# 修复遗漏的AI引擎temperature参数默认值问题（第二轮）

## Why
在第一轮修复后，通过全系统grep搜索发现还有 **21处** 遗漏的temperature/max_tokens验证逻辑仍然使用抛出错误而非默认值的方式。这些遗漏分布在WorldBookManager的额外位置、章节生成、Markdown编辑器、创意世界书编辑器、ChatEngine和插件管理等模块中。

## What Changes
- 修复WorldBookManager.tsx中遗漏的5处验证（第2897-2898、3075-3076、3220-3221、3608-3609、4135行）
- 修复useChapterGeneration.ts中2处验证（第266、269行）
- 修复MarkdownAITools.tsx中2处验证（第114、123行）
- 修复WorldBookEditor.tsx中4处验证（第243-244、250-251行）
- 修复ChatEngine.ts中2处验证（第143、176行）
- 修复PluginManager.tsx中2处验证（第447-448行）

## Impact
- Affected specs: 世界书AI功能、章节生成、Markdown编辑、插件管理、聊天引擎
- Affected code: 
  - `src/renderer/components/WorldBook/WorldBookManager.tsx` (5处)
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts` (2处)
  - `src/renderer/components/Common/MarkdownEditor/MarkdownAITools.tsx` (2处)
  - `src/renderer/components/Creative/WorldBookEditor.tsx` (4处)
  - `src/renderer/components/Common/ChatEngine/ChatEngine.ts` (2处)
  - `src/renderer/components/Plugin/PluginManager.tsx` (2处)

## MODIFIED Requirements

### 修改：统一AI参数默认值处理（第二轮）

所有读取AI引擎temperature和max_tokens参数的代码，应在参数未配置或无效时使用默认值，而不是抛出错误。

#### 场景：temperature参数有效
- **WHEN** AI引擎配置中包含有效的temperature值（0-2之间的数字）
- **THEN** 使用该值

#### 场景：temperature参数未配置或无效
- **WHEN** AI引擎配置中temperature为undefined、null或不是有效数字
- **THEN** 使用默认值0.7

#### 场景：max_tokens参数有效
- **WHEN** AI引擎配置中包含有效的max_tokens值（正整数）
- **THEN** 使用该值

#### 场景：max_tokens参数未配置或无效
- **WHEN** AI引擎配置中max_tokens为undefined、null或不是有效数字
- **THEN** 使用默认值10240
