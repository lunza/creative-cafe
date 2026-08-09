# Checklist

## 类型定义与持久化层
- [x] `DynamicScenePrompt` 接口已从 `characterTrait.types.ts` 移除
- [x] `CharacterTraitManifestV2.dynamicScenePrompts` / `activeDynamicScenePromptId` 字段已移除
- [x] `characterTraitService.ts` 的 `loadTraitData` / `saveTraitData` 不再读写动态场景字段
- [x] `characterTraitService.ts` 不再 import `DynamicScenePrompt`
- [x] 旧数据文件（含 `dynamicScenePrompts`）加载时不崩溃（JSON.parse 忽略未知字段）

## Store 层
- [x] `characterTraitStore.ts` 不再包含 `dynamicScenePrompts` / `activeDynamicScenePromptId` state
- [x] `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `updateDynamicScenePrompt` / `deleteDynamicScenePrompt` action 已移除
- [x] `saveTraits` 构造 v2 manifest 时不再包含动态场景字段
- [x] `loadTraitData` 兜底逻辑不再包含动态场景字段
- [x] `reset` 方法不再重置动态场景字段
- [x] store 不再 import `DynamicScenePrompt`

## AI Service 与 IPC
- [x] `characterTraitAIService.ts` 不再包含 `generateDynamicScenePrompts` 方法
- [x] `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口已移除
- [x] `DYNAMIC_SCENE_SYSTEM_PROMPT` 常量已移除
- [x] `buildDynamicSceneUserMessage` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` 辅助方法已移除
- [x] `characterTraitAIHandlers.ts` 不再注册 `ai:generateDynamicScenePrompts` handler
- [x] `ipc/index.ts` 不再包含动态场景 IPC 注册注释
- [x] `preload.ts` 不再暴露 `generateDynamicScenePrompts` 方法
- [x] `electron.d.ts` 不再包含 `generateDynamicScenePrompts` 类型定义

## SD 生成管线
- [x] `SDGenerationOptions` 不再包含 `dynamicClothing` / `dynamicPose` / `dynamicScene` 字段
- [x] `applyTraitsAndLora` 不再替换 `{clothing}` / `{pose}` / `{scene}` 占位符
- [x] `applyTraitsAndLora` 仅替换 `{traits}` / `{camera}` / `{gender}` 占位符

## PromptBuilder 模板
- [x] 立绘模板为 `'{camera}, {traits}, high quality, best quality, masterpiece'`（无 `{clothing}`/`{pose}`/`{scene}`）
- [x] 一般图像模板为 `'{traits}, {camera}, high quality, best quality'`（无 `{clothing}`/`{pose}`/`{scene}`）
- [x] 三视图模板不变
- [x] `userScene` 参数及 fallback 逻辑已移除
- [x] 函数 JSDoc 已更新（移除动态场景占位符说明）

## AssetGenerateModal 清理
- [x] `buildSdOptions` 不再读取/传递 `dynamicClothing` / `dynamicPose` / `dynamicScene`
- [x] 动态场景方案下拉 UI（Select + 保存/删除按钮）已移除
- [x] 立绘模式 `{pose}` 兜底 `"standing"` 与 `{scene}` 兜底 `"simple background"` 逻辑已移除
- [x] `userScene` state 与输入框已移除（如有）
- [x] 不再从 store 订阅 `activeDynamicScenePrompt` / `dynamicScenePrompts`

## AssetManagerModal 动态场景面板移除
- [x] 动态场景指令面板 JSX 已移除
- [x] 动态场景相关 state 全量移除
- [x] 动态场景 handlers 全量移除
- [x] `renderDynamicSceneTagList` 函数已移除
- [x] `useEffect`（activeDynamicScenePromptId 同步）已移除
- [x] store 订阅中动态场景 action 已移除
- [x] `handleClearAll` 中动态场景质检报告清空逻辑已移除

## RagQualityReport 清理
- [x] `dimension` 字段类型定义已移除
- [x] 维度徽标渲染逻辑已移除
- [x] 相关注释已移除

## CharacterTraitTabContent 提示词生成面板
- [x] 面板位于组合方案工具栏下方、特征列表上方
- [x] 面板包含输入框 + 生成按钮 + 结果展示 + 应用/放弃按钮 + RAG 质检报告
- [x] 视觉风格与 AssetGenerateModal 一致（紫色渐变主题）
- [x] `handleGenerateTraitPrompts` 调用 `ai:generateTraitPrompts` IPC
- [x] `handleApplyGeneratedTraits` 调用 `characterTraitStore.setTraits` 合并结果
- [x] 去重逻辑与 AssetGenerateModal 一致（key = `text.trim().toLowerCase()`）
- [x] 重复项跳过时 `message.info` 提示用户
- [x] 应用后清空生成结果（不允许重复应用）
- [x] 新增特征标记为「✨ 新增」

## TypeScript 编译验证
- [x] `npx tsc --noEmit` 未引入新的 TS 错误（与动态场景相关的引用错误全量清除）
- [x] 不存在任何文件中对已移除类型/方法/字段的悬空引用

## 文档更新
- [x] `docs/FIX_RECORDS.md` 新增章节记录动态场景移除 + 提示词生成面板迁移
- [x] `CODE_WIKI.md` 架构章节已更新（移除动态场景描述 + 新增提示词生成面板描述）
- [x] `project_memory.md` 已更新教训记录
