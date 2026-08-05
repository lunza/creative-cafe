# Tasks

- [x] Task 1: 定义 DynamicScenePrompt 共享类型
  - [x] SubTask 1.1: 在 `src/shared/types/characterTrait.types.ts` 新增 `DynamicScenePrompt` 接口（`id` / `name` / `clothing` / `pose` / `scene` / `sourceCommand` / `createdAt` / `updatedAt`）
  - [x] SubTask 1.2: 扩展 `CharacterTraitManifestV2`，新增 `dynamicScenePrompts: DynamicScenePrompt[]` 与 `activeDynamicScenePromptId: string | null` 字段
  - [x] SubTask 1.3: 在 `src/shared/types/index.ts` 统一导出新类型（无需改动，barrel 使用 `export *`）

- [x] Task 2: 扩展主进程 AI 服务 — 新增 generateDynamicScenePrompts 方法
  - [x] SubTask 2.1: 在 `characterTraitAIService.ts` 新增 `GenerateDynamicScenePromptsParams`（`naturalLanguageInput: string` / `baseTraits?: string`）与 `GenerateDynamicScenePromptsResult`（`success` / `clothing?` / `pose?` / `scene?` / `error?`）接口
  - [x] SubTask 2.2: 编写 `DYNAMIC_SCENE_SYSTEM_PROMPT` 常量：指导 LLM 将自然语言解析为三组英文 SD tag，以 `---CLOTHING---` / `---POSE---` / `---SCENE---` 分隔符输出
  - [x] SubTask 2.3: 实现 `generateDynamicScenePrompts(params)` 方法：复用 `getEngineRuntimeConfig` / `enrichSystemPrompt` / 非流式调用模式，调用 LLM 后通过 `parseDynamicSceneResponse(content)` 解析
  - [x] SubTask 2.4: 实现 `parseDynamicSceneResponse(content)` 私有方法：按分隔符切分提取三组 tag，trim / 过滤空 / 清理多余标点

- [x] Task 3: 扩展 IPC 通道 + preload 暴露
  - [x] SubTask 3.1: 在 `characterTraitAIHandlers.ts` 注册 `ai:generateDynamicScenePrompts` handler，调用 `characterTraitAIService.generateDynamicScenePrompts(args)`
  - [x] SubTask 3.2: 在 `src/main/ipc/index.ts` 确认注册顺序（与现有 `ai:generateCharacterTraits` / `ai:recognizeImageTraits` 同组）
  - [x] SubTask 3.3: 在 `src/main/preload.ts` 暴露 `window.electronAPI.ai.generateDynamicScenePrompts`（沿用现有 `ai:` 命名空间，未单独建 `characterTraitAI` 命名空间）
  - [x] SubTask 3.4: 在 `src/renderer/types/electron.d.ts` 补全类型声明（内联类型，与现有 `generateCharacterTraits` / `recognizeImageTraits` 一致）

- [x] Task 4: 扩展主进程存储服务 — 持久化 dynamicScenePrompts
  - [x] SubTask 4.1: 在 `characterTraitService.ts` 的 `loadTraitData()` 返回值中补 `dynamicScenePrompts`（默认 `[]`）与 `activeDynamicScenePromptId`（默认 `null`）兜底
  - [x] SubTask 4.2: 在 `saveTraitData()` 写入时覆盖 `dynamicScenePrompts` 与 `activeDynamicScenePromptId`

- [x] Task 5: 扩展前端 store — 新增动态场景 state + actions
  - [x] SubTask 5.1: 在 `characterTraitStore.ts` 新增 `dynamicScenePrompts: DynamicScenePrompt[]` 与 `activeDynamicScenePromptId: string | null` state
  - [x] SubTask 5.2: `loadTraits` 填充新字段；`saveTraits` 写入新字段
  - [x] SubTask 5.3: 新增 `saveDynamicScenePrompt(name, clothing, pose, scene, sourceCommand)` action：创建方案并自动激活
  - [x] SubTask 5.4: 新增 `applyDynamicScenePrompt(id)` action：设置 `activeDynamicScenePromptId`
  - [x] SubTask 5.5: 新增 `updateDynamicScenePrompt(id, updates)` action：编辑现有方案的 clothing/pose/scene/name
  - [x] SubTask 5.6: 新增 `deleteDynamicScenePrompt(id)` action：删除方案，若删除的是激活方案则 `activeDynamicScenePromptId` 置 null

- [x] Task 6: 新增 UI — 角色特征 Tab 中的「动态场景指令」区域
  - [x] SubTask 6.1: 在 `AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 底部新增「动态场景指令」折叠面板
  - [x] SubTask 6.2: 面板内容：TextArea 输入框（自然语言指令）+「AI 解析」按钮（调用 IPC，loading 状态）
  - [x] SubTask 6.3: 解析结果预览：三个可编辑 TextArea（服装/动作/场景），用户可手动修改
  - [x] SubTask 6.4: 完整提示词预览区：拼接基础特征 + clothing + pose + scene 的完整 prompt 字符串（只读 TextArea 或代码块）
  - [x] SubTask 6.5: 保存/切换/删除：方案名输入 +「保存为方案」按钮 + 已保存方案下拉列表（应用/删除）

- [x] Task 7: 扩展提示词模板 — 新增占位符
  - [x] SubTask 7.1: 在 `PromptBuilder.ts` 的 `buildAssetPromptTemplate` 中，illustration 模板改为 `full body, {pose}, {traits}, {clothing}, {scene}, high quality, best quality, masterpiece`
  - [x] SubTask 7.2: general 模板改为 `{traits}, {clothing}, {pose}, {scene}, high quality, best quality`（`{scene}` 无动态场景时回退到 userScene）
  - [x] SubTask 7.3: three-view 模板不改（已有穿衣/裸体分组逻辑，不使用动态场景占位符）

- [x] Task 8: 扩展 SD 生成链路 — 占位符替换 + 选项透传
  - [x] SubTask 8.1: 在 `sdGenerationService.ts` 的 `SDGenerationOptions` 新增 `dynamicClothing?` / `dynamicPose?` / `dynamicScene?` 字段
  - [x] SubTask 8.2: 在 `applyTraitsAndLora` 中，`{traits}` 替换后新增 `{clothing}` / `{pose}` / `{scene}` 替换逻辑，空值替换为空字符串并清理多余逗号
  - [x] SubTask 8.3: 在 `AssetGenerateModal.tsx` 的 `buildSdOptions` 中，从 store 读取激活动态场景方案，填充 `dynamicClothing` / `dynamicPose` / `dynamicScene`
  - [x] SubTask 8.4: 验证立绘 / 一般图像两条路径均能正确替换占位符；三视图路径不携带动态场景占位符

- [x] Task 9: 集成验证与文档更新
  - [x] SubTask 9.1: `npx tsc --noEmit` 对所有修改文件零新增错误
  - [x] SubTask 9.2: 手动验证端到端流程：输入 NL → AI 解析 → 预览 → 保存 → 生成立绘 → 检查提示词包含动态服装/动作/场景
  - [x] SubTask 9.3: 验证无激活方案时生成立绘/一般图像行为与当前一致（占位符替换为空/默认值）
  - [x] SubTask 9.4: 回写 `CODE_WIKI.md`（§3 目录树 / §4.2 IPC / §4.4 服务表 / §9 store）+ `docs/FIX_RECORDS.md` + `CHANGELOG.md`

# Task Dependencies
- Task 2 依赖 Task 1（类型定义）
- Task 3 依赖 Task 2（AI service 方法）
- Task 4 依赖 Task 1（类型定义）
- Task 5 依赖 Task 1 + Task 4（类型 + 持久化）
- Task 6 依赖 Task 3 + Task 5（IPC + store actions）
- Task 7 依赖 Task 1（占位符模板可独立于 store 定义）
- Task 8 依赖 Task 5 + Task 7（store 激活方案 + 模板占位符）
- Task 9 依赖 Task 1-8 全部完成（端到端验证）
- Task 1 / Task 7 可并行启动（类型定义与提示词模板无相互依赖）
- Task 2 / Task 4 可并行启动（AI 服务与存储服务无相互依赖）
