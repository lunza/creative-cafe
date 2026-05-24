# Remove Hardcoded AI Default Parameters Spec

## Why
代码中大量存在通过 `||` 运算符或直接赋值设置的硬编码默认参数（如模型名称 `'gpt-4o'`、`'gpt-3.5-turbo'`，token 限制 `4096`、`40960`、`10240`、`8192`，温度 `0.7`、`0.3` 等）。这些硬编码默认值会干扰日志系统的正确记录，导致异常情况被错误识别为正常逻辑流程。根据项目规范，所有 AI 请求必须严格依赖 AI 引擎中统一配置的参数，不允许在代码中设置独立默认值。

## What Changes
- 删除所有 AI 调用中通过 `||` 运算符设置的写死兜底默认参数
- 删除所有 AI 请求体中硬编码的 `temperature`、`max_tokens`、`model`、`top_p`、`frequency_penalty`、`presence_penalty` 等参数值
- 修改 `AIService.utils.ts` 中的 `createDefaultConfig` 方法，移除硬编码默认值
- 修改所有服务层和处理器层中 fallback 到硬编码值的逻辑
- 确保所有 AI 调用参数完全由 AI 引擎配置统一管理

## Impact
- Affected specs: AI 调用参数管理、日志系统
- Affected code: 
  - `src/main/services/WritingStyleLearningService.ts`
  - `src/main/services/memory/chatLogService.ts`
  - `src/main/services/writing/PlotCheckerService.ts`
  - `src/main/services/writing/AIAssistedChapterService.ts`
  - `src/main/ipc/handlers/writingHandlers.ts`
  - `src/renderer/components/Common/AIService.utils.ts`
  - `src/renderer/components/Common/ChatEngine/ChatEngine.ts`
  - `src/renderer/components/Common/AIService.tsx`
  - `src/renderer/components/WorldBook/WorldBookManager.tsx`
  - `src/renderer/components/Character/CharacterManager.tsx`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`
  - `src/renderer/components/Creative/hooks/useCreativeAI.ts`
  - `src/renderer/components/Creative/WorldBookEditor.tsx`
  - `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts`
  - `src/renderer/components/Plugin/PluginManager.tsx`
  - `src/renderer/utils/characterAIUtils.ts`
  - `src/renderer/stores/settingStore.ts`
  - `src/renderer/services/promptOptimizerService.ts`
  - `src/renderer/components/PromptOptimizer/PreviewPrompt.tsx`
  - `src/renderer/components/Settings/Settings.tsx`
  - `src/renderer/components/MemoryChat/stMemoryTemplate.ts`
  - `src/shared/settings.ts`
  - `src/shared/constants/writing.constants.ts`
  - `src/main/services/storageService.ts`

## ADDED Requirements

### Requirement: AI Parameter Source Unification
所有 AI 请求参数（model、temperature、max_tokens、top_p、frequency_penalty、presence_penalty 等）必须从 AI 引擎配置中获取，不得使用任何硬编码默认值作为 fallback。

#### Scenario: Engine config unavailable
- **WHEN** AI 引擎配置中某个参数为空
- **THEN** 应该抛出明确的配置错误，而不是使用硬编码默认值

### Requirement: Remove || Fallback Pattern
删除所有形如 `engine.model_name || 'gpt-4o'`、`Number(engine.temperature) || 0.7`、`Number(engine.max_tokens) || 4096` 的 fallback 模式。

#### Scenario: Fallback removal
- **WHEN** 代码中存在 `|| '硬编码值'` 或 `|| 数字` 模式
- **THEN** 应改为从引擎配置直接读取，配置缺失时抛出错误

## MODIFIED Requirements

### Requirement: AIService.utils.createDefaultConfig
当前 `createDefaultConfig` 返回包含硬编码值的配置对象，应修改为返回空/最小配置或抛出需要用户配置的提示。

### Requirement: Service Layer AI Calls
所有服务层（WritingStyleLearningService、PlotCheckerService、AIAssistedChapterService、chatLogService 等）中的 AI 调用必须直接使用引擎配置参数，不得设置独立的默认值。

## REMOVED Requirements

### Requirement: Independent Default Values
**Reason**: 硬编码默认值干扰日志记录，掩盖配置缺失问题，违反参数统一管理原则
**Migration**: 所有默认值移除后，缺失配置的调用路径应抛出明确的错误信息，引导用户完成 AI 引擎配置
