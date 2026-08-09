# 移除动态场景方案并以提示词生成面板替代 Spec

## Why

用户反馈证实，AI 素材生成页面中的「提示词生成」面板（动态指令生成 + L0-L5 审计 + 自动拼接）已能完全替代「动态场景方案」功能。动态场景方案引入了独立的类型定义、store action、IPC 通道、service 方法、UI 面板及 prompt 模板占位符（`{clothing}`/`{pose}`/`{scene}`），增加了系统复杂度却不再提供额外价值。统一通过 `{traits}` 占位符 + 分类特征体系（clothing/pose/background 等 categoryId）即可实现等效甚至更灵活的提示词组织能力。

同时，用户要求在角色特征页签（`CharacterTraitTabContent`）的「组合方案」工具栏旁添加与 AI 素材生成页面功能完全一致的提示词生成面板，让用户在特征管理界面也能直接通过自然语言生成分类特征 tag。

## What Changes

### 移除（动态场景方案全量清除）

- **BREAKING** 移除 `DynamicScenePrompt` 接口及 `CharacterTraitManifestV2.dynamicScenePrompts` / `activeDynamicScenePromptId` 字段
- **BREAKING** 移除 `SDGenerationOptions.dynamicClothing` / `dynamicPose` / `dynamicScene` 字段
- 移除 prompt 模板中的 `{clothing}` / `{pose}` / `{scene}` 占位符，特征内容统一通过 `{traits}` 占位符注入
- 移除 `characterTraitStore` 中 `dynamicScenePrompts` / `activeDynamicScenePromptId` state 及 `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `updateDynamicScenePrompt` / `deleteDynamicScenePrompt` 四个 action
- 移除 `characterTraitAIService` 中 `generateDynamicScenePrompts` 方法及辅助函数 `buildDynamicSceneUserMessage` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` / `DYNAMIC_SCENE_SYSTEM_PROMPT` 常量 / `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口
- 移除 IPC 通道 `ai:generateDynamicScenePrompts` 及其 handler 注册
- 移除 `preload.ts` 中 `generateDynamicScenePrompts` 方法
- 移除 `electron.d.ts` 中 `generateDynamicScenePrompts` 类型定义及动态场景相关返回类型
- 移除 `characterTraitService` 中 `loadTraitData` / `saveTraitData` 对 `dynamicScenePrompts` / `activeDynamicScenePromptId` 的读写逻辑
- 移除 `AssetManagerModal.tsx`（`CharacterTraitTabContent`）中的动态场景指令面板（UI + state + handlers）
- 移除 `AssetGenerateModal.tsx` 中对 `dynamicClothing` / `dynamicPose` / `dynamicScene` 的读取与传递（`buildSdOptions`）及动态场景方案下拉 UI
- 移除 `sdGenerationService.applyTraitsAndLora` 中对 `{clothing}` / `{pose}` / `{scene}` 占位符的替换逻辑
- 移除 `PromptBuilder` 中 `{clothing}` / `{pose}` / `{scene}` 占位符及 `userScene` fallback 参数

### 新增（角色特征页签提示词生成面板）

- 在 `CharacterTraitTabContent` 的组合方案工具栏下方、特征列表上方，添加提示词生成面板
- 面板功能与 `AssetGenerateModal.renderPromptGenPanel` 完全一致：输入框 + 生成按钮 + 分类结果展示 + 应用/放弃按钮 + RAG 质检报告
- 复用 `ai:generateTraitPrompts` IPC 通道（已存在，无需新增）
- 应用结果时调用 `characterTraitStore.setTraits` 合并到现有特征列表（去重逻辑与 AssetGenerateModal 一致）

## Impact

- Affected specs:
  - `add-dynamic-scene-prompt-generation`（**REVERSED** — 全量回退）
  - `add-prompt-generation-in-asset-modal`（**EXTENDED** — 面板从 AssetGenerateModal 扩展到 CharacterTraitTabContent）
  - `add-asset-and-trait-management`（store / service 层结构变更）
  - `add-sdxl-prompt-weight-support`（applyTraitsAndLora 占位符替换逻辑变更）
  - `fix-asset-trait-and-scene-defects`（`{scene}` fallback 逻辑移除）
- Affected code（13 个源文件）:
  - `src/shared/types/characterTrait.types.ts` — 移除 `DynamicScenePrompt` 接口 + manifest 字段
  - `src/main/services/characterTraitService.ts` — 移除动态场景字段读写
  - `src/main/services/characterTraitAIService.ts` — 移除 `generateDynamicScenePrompts` 及辅助函数
  - `src/main/services/sdGenerationService.ts` — 移除 `dynamicClothing`/`dynamicPose`/`dynamicScene` 字段 + 占位符替换
  - `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 移除 IPC handler
  - `src/main/ipc/index.ts` — 移除 IPC 注册注释
  - `src/main/preload.ts` — 移除 preload 方法
  - `src/renderer/types/electron.d.ts` — 移除类型定义
  - `src/renderer/stores/characterTraitStore.ts` — 移除 state + 4 个 action
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 移除动态场景面板 + 添加提示词生成面板
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 移除动态场景读取/传递/UI
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 移除占位符 + 简化模板
  - `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` — 移除 `dimension` 字段（动态场景专用，变为死代码）

## ADDED Requirements

### Requirement: 角色特征页签提示词生成面板

系统 SHALL 在角色特征页签（`CharacterTraitTabContent`）的组合方案工具栏下方提供提示词生成面板，功能与 AI 素材生成页面（`AssetGenerateModal.renderPromptGenPanel`）完全一致。

#### Scenario: 用户在角色特征页签生成提示词

- **WHEN** 用户在角色特征页签的提示词生成面板输入自然语言描述并点击「生成提示词」按钮
- **THEN** 系统调用 `ai:generateTraitPrompts` IPC 通道，传入用户输入与当前已有特征（作为 `baseTraits` 避免重复生成）
- **AND** 生成结果按分类（head/body/clothing/background/pose/expression）分组展示
- **AND** 每条 tag 显示中文翻译（Tooltip）与权重徽标（如有非默认权重）
- **AND** 展示 RAG 质检报告（命中率 + 标签验证详情）

#### Scenario: 用户应用生成的提示词到特征列表

- **WHEN** 用户点击「应用到特征列表」按钮
- **THEN** 系统将生成的 `CategorizedTrait[]` 通过 `characterTraitStore.setTraits` 合并到现有特征列表
- **AND** 与已有特征去重（key = `text.trim().toLowerCase()`），跳过重复项
- **AND** 跳过条数 > 0 时通过 `message.info` 提示用户
- **AND** 应用后清空生成结果（不允许重复应用）
- **AND** 新增的特征标记为「✨ 新增」（`appliedPromptTraitIds` Set 追踪）

#### Scenario: 用户放弃生成的提示词

- **WHEN** 用户点击「放弃」按钮
- **THEN** 系统清空生成结果与 RAG 质检报告，不修改现有特征列表

#### Scenario: 面板视觉风格与 AssetGenerateModal 一致

- **WHEN** 提示词生成面板渲染时
- **THEN** 面板使用紫色渐变主题（`rgba(139, 92, 246, 0.05)` 背景 + `rgba(139, 92, 246, 0.2)` 边框）
- **AND** 生成按钮使用紫色渐变（`linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)`）
- **AND** 结果区 Tag 使用 `color="purple"` + Tooltip 展示翻译/来源/权重
- **AND** 面板位于组合方案工具栏下方、特征列表上方

## MODIFIED Requirements

### Requirement: SD 提示词模板

prompt 模板移除 `{clothing}` / `{pose}` / `{scene}` 占位符，特征内容（含服装/动作/场景分类）统一通过 `{traits}` 占位符注入。

- 立绘模板（illustration）：`'{camera}, {traits}, high quality, best quality, masterpiece'`
- 一般图像模板（general）：`'{traits}, {camera}, high quality, best quality'`
- 三视图模板（three-view）：不变（原本不含动态场景占位符）
- 表情模板（expression）：不变（不含动态场景占位符）

### Requirement: applyTraitsAndLora 占位符替换

`sdGenerationService.applyTraitsAndLora` 移除对 `{clothing}` / `{pose}` / `{scene}` 占位符的替换逻辑，仅保留 `{traits}` / `{camera}` / `{gender}` 占位符替换。

### Requirement: CharacterTraitManifestV2 持久化

`CharacterTraitManifestV2` 移除 `dynamicScenePrompts` / `activeDynamicScenePromptId` 字段。`loadTraitData` 加载旧数据文件时忽略这两个字段（JSON.parse 自动忽略未知字段，无需显式处理）。`saveTraitData` 不再写入这两个字段。

## REMOVED Requirements

### Requirement: 动态场景方案管理

**Reason**: 已被提示词生成面板（`ai:generateTraitPrompts`）+ 分类特征体系完全替代。动态场景方案的 clothing/pose/scene 三维度分割增加了系统复杂度，而分类特征体系（`CharacterTraitItem.categoryId` = `clothing`/`pose`/`background`）已能等效组织提示词内容，且通过 `{traits}` 占位符统一注入。

**Migration**: 
- 已保存的 `dynamicScenePrompts` 数据将随下次 `saveTraitData` 自然丢弃（manifest 不再包含这两个字段）
- 用户如需保留原动态场景方案中的 tag，可手动将其作为特征添加到对应分类（clothing/pose/background）
- prompt 模板的 `{clothing}`/`{pose}`/`{scene}` 占位符移除后，原通过动态场景注入的内容改由 `{traits}` 统一携带
