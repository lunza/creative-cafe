# 全面修复全系统AI引擎temperature参数默认值问题

## Why
在对系统AI功能进行全面检查后发现，多个核心模块（世界书、创意管理、写作模式等）在处理AI引擎配置时存在相同的bug模式：当temperature或max_tokens为undefined时直接抛出错误，而非使用合理的默认值。这导致用户未显式配置这些参数时，所有依赖AI的功能都会失败。

## What Changes
- 修复WorldBook模块中8处temperature/max_tokens验证逻辑，使用默认值替代抛出错误
- 修复CreativeAI hooks中temperature/max_tokens验证逻辑
- 修复WritingTablePreviewModal中temperature验证逻辑
- 修复writingHandlers中temperature/max_tokens验证逻辑（3处）
- 修复ContentGenerator中temperature验证逻辑
- 确保所有AI调用模块使用统一的默认值：temperature=0.7, max_tokens=10240

## Impact
- Affected specs: 世界书AI功能、创意管理AI功能、写作模式AI功能、剧情检查AI功能
- Affected code: 
  - `src/renderer/components/WorldBook/WorldBookManager.tsx` (8处)
  - `src/renderer/components/Creative/hooks/useCreativeAI.ts` (2处)
  - `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx` (2处)
  - `src/main/ipc/handlers/writingHandlers.ts` (6处)
  - `src/main/services/writing/ContentGenerator.ts` (1处)

## MODIFIED Requirements

### 修改：统一AI参数默认值处理

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
