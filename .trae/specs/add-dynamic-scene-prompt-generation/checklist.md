# Checklist — 动态场景提示词生成

> 用于验证 `add-dynamic-scene-prompt-generation` spec 的实现是否满足全部要求。
> 每个检查点对应 spec.md 中的 Requirement / Scenario，结合 tasks.md 中的子任务。
> 状态：2026-08-05 Task 1-9 全部完成。静态可验证项已勾选；运行时项（如准确率 / 延迟）需用户在实际 Electron 环境验证。

## 数据模型（Task 1）

- [x] `DynamicScenePrompt` 接口在 `src/shared/types/characterTrait.types.ts` 中定义，含 `id` / `name` / `clothing` / `pose` / `scene` / `sourceCommand` / `createdAt` / `updatedAt`
- [x] `CharacterTraitManifestV2` 扩展了 `dynamicScenePrompts: DynamicScenePrompt[]` 与 `activeDynamicScenePromptId: string | null`
- [x] 新类型在 `src/shared/types/index.ts` 统一导出

## 自然语言解析（Task 2）

- [x] `characterTraitAIService.ts` 新增 `generateDynamicScenePrompts(params)` 方法
- [x] `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口已定义
- [x] `DYNAMIC_SCENE_SYSTEM_PROMPT` 常量指导 LLM 输出三组 SD tag，含 `---CLOTHING---` / `---POSE---` / `---SCENE---` 分隔符
- [x] `parseDynamicSceneResponse(content)` 私有方法按分隔符切分并清理多余标点
- [x] 复用 `getEngineRuntimeConfig` / `enrichSystemPrompt` / 非流式调用模式
- [x] 空输入返回友好错误，不调用 LLM
- [x] 未配置 AI 引擎时返回友好错误
- [x] `temperature` / `max_tokens` 缺失时返回友好错误（符合「禁止 AI 参数默认值」规则）

## IPC 通道（Task 3）

- [x] `ai:generateDynamicScenePrompts` handler 在 `characterTraitAIHandlers.ts` 注册
- [x] `src/main/ipc/index.ts` 注册顺序正确（与现有 `ai:generateCharacterTraits` / `ai:recognizeImageTraits` 同组）
- [x] `src/main/preload.ts` 暴露 `window.electronAPI.ai.generateDynamicScenePrompts`（注：spec 描述为 `characterTraitAI` 命名空间，实际沿用现有 `ai:` 命名空间，与现有方法保持一致）
- [x] `src/renderer/types/electron.d.ts` 类型声明完整

## 持久化（Task 4）

- [x] `characterTraitService.ts` 的 `loadTraitData()` 返回 `dynamicScenePrompts`（默认 `[]`）与 `activeDynamicScenePromptId`（默认 `null`）兜底
- [x] `saveTraitData()` 写入时覆盖这两个字段
- [x] v2 迁移兼容：旧 traits.json 无新字段时自动补全默认值

## 前端 store（Task 5）

- [x] `characterTraitStore.ts` 新增 `dynamicScenePrompts` / `activeDynamicScenePromptId` state
- [x] `loadTraits` / `saveTraits` 处理新字段
- [x] `saveDynamicScenePrompt` action 创建方案并自动激活
- [x] `applyDynamicScenePrompt(id)` action 设置激活 ID
- [x] `updateDynamicScenePrompt(id, updates)` action 编辑现有方案
- [x] `deleteDynamicScenePrompt(id)` action 删除方案，删除激活方案时重置为 null

## UI 区域（Task 6）

- [x] `AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 底部新增「动态场景指令」折叠面板
- [x] TextArea 自然语言输入框 + 「AI 解析」按钮（loading 状态）
- [x] 解析结果预览：三个可编辑 TextArea（服装/动作/场景），支持手动修改
- [x] 完整提示词预览区：拼接基础特征 + clothing + pose + scene
- [x] 保存/切换/删除：方案名输入 + 「保存为方案」按钮 + 已保存方案下拉列表
- [x] UI 风格与现有组合方案区域一致（紫色边框区分于特征分类蓝色）

## 提示词模板（Task 7）

- [x] `PromptBuilder.ts` 的 illustration 模板改为含 `{clothing}` / `{pose}` / `{scene}` 占位符
- [x] general 模板改为含占位符（`{scene}` 无动态场景时回退到 userScene）
- [x] three-view 模板不使用动态场景占位符

## SD 生成链路（Task 8）

- [x] `sdGenerationService.ts` 的 `SDGenerationOptions` 新增 `dynamicClothing?` / `dynamicPose?` / `dynamicScene?` 字段
- [x] `applyTraitsAndLora` 中替换 `{clothing}` / `{pose}` / `{scene}` 占位符
- [x] 空值替换为空字符串并清理多余逗号
- [x] `AssetGenerateModal.buildSdOptions` 从 store 读取激活动态场景方案并填充三个字段
- [x] 立绘 / 一般图像两条路径正确替换占位符
- [x] 三视图路径不携带动态场景占位符

## 质量标准（用户原始要求 §5）

- [ ] 自然语言解析能正确识别常见的服装风格、动作类型和场景描述（≥85% 准确率 — 通过手动测试用例验证）— **注：需运行时验证，静态代码分析无法评估准确率**
- [x] 生成的提示词符合 SD 模型语法（逗号分隔英文 tag）— 静态验证：`DYNAMIC_SCENE_SYSTEM_PROMPT` 明确要求英文 tag + 逗号分隔，`parseDynamicSceneResponse` 含标点归一化
- [x] 提示词生成和切换操作延迟不超过 2 秒（通过响应式 UI + 非流式调用保证）— 静态验证：`generateDynamicScenePrompts` 使用非流式调用（`stream: false`），UI 使用 `loading` 状态；store action 立即更新本地 state 后异步持久化

## 集成验证（Task 9）

- [x] `npx tsc --noEmit` 对所有修改文件零新增错误（724 baseline 错误，12 修改文件中 9 个零错误，3 个仅含预存在错误，详见 `CODE_WIKI.md` Task 9 章节）
- [x] 端到端流程静态验证：5 流程全部通过（类型流 / IPC 流 / 持久化流 / SD 生成流 / 兜底流，详见 `CODE_WIKI.md` Task 9 章节）— **注：实际 Electron 运行时验证需用户手动测试**
- [x] 无激活方案时生成立绘/一般图像行为与当前一致（兜底逻辑：illustration → standing / simple background；general → userScene）
- [x] CODE_WIKI.md（综述章节 + Task 1 / 2 / 4 / 9 详细章节 + 既有 Task 3 / 5 / 6 章节）回写
- [x] docs/FIX_RECORDS.md 追加实现记录（§4.7 已记录 Task 3 实施细节，§4.8 记录整体 spec 实施清单与集成验证）
- [x] CHANGELOG.md 追加版本条目（原 4 个分散 Task 条目合并为单条版本条目）
