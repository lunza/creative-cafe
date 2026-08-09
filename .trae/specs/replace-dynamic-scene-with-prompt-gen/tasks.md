# Tasks

- [x] Task 1: 移除动态场景类型定义与持久化层
  - [x] SubTask 1.1: 在 `src/shared/types/characterTrait.types.ts` 中移除 `DynamicScenePrompt` 接口、`CharacterTraitManifestV2.dynamicScenePrompts` / `activeDynamicScenePromptId` 字段及相关 JSDoc
  - [x] SubTask 1.2: 在 `src/main/services/characterTraitService.ts` 中移除 `loadTraitData` / `saveTraitData` / `createEmptyTraitData` / v1→v2 迁移路径中对 `dynamicScenePrompts` / `activeDynamicScenePromptId` 的读写与兜底逻辑；移除 `DynamicScenePrompt` import
  - [x] SubTask 1.3: 在 `src/renderer/stores/characterTraitStore.ts` 中移除 `dynamicScenePrompts` / `activeDynamicScenePromptId` state、`DynamicScenePrompt` import、初始值 / loadTraitData 兜底 / saveTraits 构造与回滚中的动态场景字段、`reset` 中的重置逻辑

- [x] Task 2: 移除动态场景 store action
  - [x] SubTask 2.1: 在 `src/renderer/stores/characterTraitStore.ts` 中移除 `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `updateDynamicScenePrompt` / `deleteDynamicScenePrompt` 四个 action 的接口声明（State 接口 + actions 对象）
  - [x] SubTask 2.2: 移除四个 action 的实现（约 L1447-L1630）

- [x] Task 3: 移除动态场景 AI service 与 IPC
  - [x] SubTask 3.1: 在 `src/main/services/characterTraitAIService.ts` 中移除 `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口、`DYNAMIC_SCENE_SYSTEM_PROMPT` 常量、`generateDynamicScenePrompts` 方法、`buildDynamicSceneUserMessage` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` 辅助方法
  - [x] SubTask 3.2: 在 `src/main/ipc/handlers/characterTraitAIHandlers.ts` 中移除 `ai:generateDynamicScenePrompts` handler 注册及 `GenerateDynamicScenePromptsParams` import
  - [x] SubTask 3.3: 在 `src/main/ipc/index.ts` 中移除动态场景 IPC 通道注册注释
  - [x] SubTask 3.4: 在 `src/main/preload.ts` 中移除 `generateDynamicScenePrompts` 方法
  - [x] SubTask 3.5: 在 `src/renderer/types/electron.d.ts` 中移除 `generateDynamicScenePrompts` 类型定义及动态场景返回类型（含 `dimension` 字段的 ragDebug 类型）

- [x] Task 4: 移除 SD 生成管线动态场景字段
  - [x] SubTask 4.1: 在 `src/main/services/sdGenerationService.ts` 中移除 `SDGenerationOptions.dynamicClothing` / `dynamicPose` / `dynamicScene` 字段及 JSDoc
  - [x] SubTask 4.2: 在 `applyTraitsAndLora` 方法中移除 `{clothing}` / `{pose}` / `{scene}` 占位符替换逻辑（`clothingStr` / `poseStr` / `sceneStr` 变量及 `replace` 调用），仅保留 `{traits}` / `{camera}` / `{gender}` 替换

- [x] Task 5: 移除 PromptBuilder 动态场景占位符
  - [x] SubTask 5.1: 在 `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` 中将立绘模板从 `'{camera}, {pose}, {traits}, {clothing}, {scene}, high quality, best quality, masterpiece'` 改为 `'{camera}, {traits}, high quality, best quality, masterpiece'`
  - [x] SubTask 5.2: 将一般图像模板从 `'{traits}, {clothing}, {pose}, {scene}, {camera}, high quality, best quality'` 改为 `'{traits}, {camera}, high quality, best quality'`
  - [x] SubTask 5.3: 移除 `userScene` 参数及 fallback 逻辑（已无 `{scene}` 占位符需要 fallback）
  - [x] SubTask 5.4: 更新函数 JSDoc，移除 `{clothing}` / `{pose}` / `{scene}` 占位符说明

- [x] Task 6: 移除 AssetGenerateModal 动态场景 UI 与逻辑
  - [x] SubTask 6.1: 在 `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` 中移除 `buildSdOptions` 对 `dynamicClothing` / `dynamicPose` / `dynamicScene` 的读取与传递（从 store `activeDynamicScenePrompt` 读取的逻辑全量移除）
  - [x] SubTask 6.2: 移除动态场景方案下拉 UI（Select + 保存/删除按钮）及相关 state / handlers
  - [x] SubTask 6.3: 移除立绘模式 `{pose}` 兜底为 `"standing"` 与 `{scene}` 兜底为 `"simple background"` 的逻辑（模板已无这些占位符）
  - [x] SubTask 6.4: 移除 `userScene` state 与输入框（如有）

- [x] Task 7: 移除 AssetManagerModal 动态场景面板
  - [x] SubTask 7.1: 在 `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（`CharacterTraitTabContent`）中移除动态场景指令面板 JSX（约 L4346-L4541）
  - [x] SubTask 7.2: 移除动态场景相关 state（`parsedClothing` / `parsedPose` / `parsedScene` / `parsedClothingTranslations` / `parsedPoseTranslations` / `parsedSceneTranslations` / `dynamicSceneRagDebug` / `dynamicSceneRagVisible` / `dynamicSceneSchemeName` 等）
  - [x] SubTask 7.3: 移除动态场景 handlers（`handleParseDynamicScene` / `handleSaveDynamicScene` / `handleApplyDynamicScene` / `handleDeleteDynamicScene`）
  - [x] SubTask 7.4: 移除 `renderDynamicSceneTagList` 函数
  - [x] SubTask 7.5: 移除 `useEffect`（activeDynamicScenePromptId 变化时同步解析字段，约 L2648-L2673）
  - [x] SubTask 7.6: 移除 store 订阅中的 `dynamicScenePrompts` / `activeDynamicScenePromptId` / `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `deleteDynamicScenePrompt`（约 L2462-L2470）
  - [x] SubTask 7.7: 移除 `handleClearAll` 中清空动态场景质检报告的逻辑（`setDynamicSceneRagDebug(null)` / `setDynamicSceneRagVisible(false)`）

- [x] Task 8: 清理 RagQualityReport dimension 字段
  - [x] SubTask 8.1: 在 `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` 中移除 `dimension` 字段的类型定义、渲染逻辑（维度徽标）及相关注释（动态场景审计专用，已无来源填充）

- [x] Task 9: 在 CharacterTraitTabContent 添加提示词生成面板
  - [x] SubTask 9.1: 在 `AssetManagerModal.tsx`（`CharacterTraitTabContent`）中添加提示词生成面板 state（`promptGenInput` / `promptGenResult` / `promptGenLoading` / `promptGenRagDebug` / `promptGenRagVisible` / `appliedPromptTraitIds`）
  - [x] SubTask 9.2: 添加 `handleGenerateTraitPrompts` handler（调用 `ai:generateTraitPrompts` IPC，传入 `promptGenInput` 与 `baseTraits`）
  - [x] SubTask 9.3: 添加 `handleApplyGeneratedTraits` handler（调用 `characterTraitStore.setTraits` 合并生成结果，去重逻辑与 AssetGenerateModal 一致，跳过重复项并 `message.info` 提示）
  - [x] SubTask 9.4: 添加 `handleDiscardGeneratedTraits` handler（清空生成结果与质检报告）
  - [x] SubTask 9.5: 添加 `renderPromptGenPanel` 函数（复制 AssetGenerateModal 的实现，适配 CharacterTraitTabContent 的 store 直接访问模式——应用结果调 `setTraits` 而非操作 `editedTraits` 工作副本）
  - [x] SubTask 9.6: 在组合方案工具栏下方、特征列表上方渲染 `{renderPromptGenPanel()}`

- [x] Task 10: 文档增量更新
  - [x] SubTask 10.1: 在 `docs/FIX_RECORDS.md` 新增章节记录动态场景方案移除 + 提示词生成面板迁移（含重点标记：用户反馈驱动的功能替代）
  - [x] SubTask 10.2: 在 `CODE_WIKI.md` 更新架构章节：移除动态场景相关描述（§3 目录树注释 / §4.4 服务表 / §9 store 表 / §10 类型表 / applyTraitsAndLora 占位符说明 / PromptBuilder 模板说明），新增 CharacterTraitTabContent 提示词生成面板描述
  - [x] SubTask 10.3: 更新 `project_memory.md`，记录教训：功能替代迁移时需同步清理 prompt 模板占位符 + SD 生成管线字段 + IPC 通道 + preload + electron.d.ts 全链路

# Task Dependencies

- Task 2 depends on Task 1（store state 移除后才能移除 action）
- Task 3 depends on Task 1（service 移除类型依赖）
- Task 4 depends on Task 1（SDGenerationOptions 字段移除）
- Task 5 depends on Task 4（模板占位符移除依赖 SD 管线字段移除）
- Task 6 depends on Task 4 + Task 5（AssetGenerateModal 移除依赖 SD 字段 + 模板变更）
- Task 7 depends on Task 2 + Task 3（AssetManagerModal 移除面板依赖 store action + IPC 移除）
- Task 8 可与 Task 7 并行（RagQualityReport dimension 字段独立清理）
- Task 9 depends on Task 7（移除动态场景面板后才能在同位置添加提示词生成面板）
- Task 10 depends on Task 1-9 全部完成
