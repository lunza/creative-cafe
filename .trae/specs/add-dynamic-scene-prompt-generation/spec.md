# 动态场景提示词生成 Spec

## Why

当前素材管理系统的「角色特征」模块仅管理角色**固有**视觉特征（种族/发色/瞳色/体型等），用户无法在生成图片时动态指定一次性的服装、姿势和场景。用户希望通过自然语言命令（如"让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上"）让 AI 自动解析并生成独立的服装/动作/场景提示词，与基础特征灵活组合后注入 SD 生成流程。

## What Changes

- 新增 `DynamicScenePrompt` 数据模型，包含 `clothing` / `pose` / `scene` 三个独立提示词字段 + 原始自然语言 `sourceCommand`
- 扩展 `CharacterTraitManifestV2`，新增 `dynamicScenePrompts: DynamicScenePrompt[]` 与 `activeDynamicScenePromptId: string | null`
- 在 `characterTraitAIService.ts` 新增 `generateDynamicScenePrompts()` 方法：接收自然语言输入，调用 LLM 解析为三组英文 SD tag（服装/动作/场景）
- 新增 IPC 通道 `ai:generateDynamicScenePrompts`，在 `preload.ts` / `electron.d.ts` 暴露
- 扩展 `characterTraitStore.ts`：新增 `dynamicScenePrompts` state + `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `deleteDynamicScenePrompt` / `updateDynamicScenePrompt` actions
- 扩展 `characterTraitService.ts`：`loadTraitData` / `saveTraitData` 读写 `dynamicScenePrompts` 与 `activeDynamicScenePromptId`
- 在 `AssetManagerModal.tsx` 的角色特征 Tab 中新增「动态场景指令」区域：NL 输入框 + AI 解析按钮 + 解析结果预览 + 保存/切换/删除
- 扩展 `buildAssetPromptTemplate`：为 illustration / general 模式引入 `{clothing}` / `{pose}` / `{scene}` 占位符
- 扩展 `sdGenerationService.applyTraitsAndLora`：替换 `{clothing}` / `{pose}` / `{scene}` 占位符
- 扩展 `SDGenerationOptions`：新增 `dynamicClothing` / `dynamicPose` / `dynamicScene` 字段
- 扩展 `AssetGenerateModal.buildSdOptions`：将激活的动态场景提示词透传到 SD 选项

## Impact

- Affected specs: `add-trait-category-grouping`（特征分类体系，共享 store / service）、`add-asset-and-trait-management`（素材管理 UI 架构）、`add-ai-expression-generation`（SD 生成 prompt 构建链路）
- Affected code:
  - `src/shared/types/characterTrait.types.ts` — 新增 `DynamicScenePrompt` 类型 + 扩展 `CharacterTraitManifestV2`
  - `src/main/services/characterTraitAIService.ts` — 新增 `generateDynamicScenePrompts()` + 系统提示词 + 解析器
  - `src/main/services/characterTraitService.ts` — 扩展 load/save 覆盖新字段
  - `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 注册新 IPC 通道
  - `src/main/preload.ts` + `src/renderer/types/electron.d.ts` — 暴露 IPC 方法
  - `src/renderer/stores/characterTraitStore.ts` — 新增 state + actions
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 新增 UI 区域
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 透传动态提示词
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `buildAssetPromptTemplate` 扩展占位符
  - `src/main/services/sdGenerationService.ts` — `applyTraitsAndLora` 扩展占位符替换 + `SDGenerationOptions` 扩展字段

## ADDED Requirements

### Requirement: 动态场景提示词数据模型

系统 SHALL 提供 `DynamicScenePrompt` 数据模型，包含独立的三组提示词字段（`clothing` / `pose` / `scene`）和原始自然语言输入 `sourceCommand`，以及命名/时间戳元数据。该模型独立于 `CharacterTraitItem[]` 基础特征，允许用户在不修改基础特征的情况下动态切换服装/动作/场景。

#### Scenario: 用户保存一个动态场景方案
- **WHEN** 用户输入自然语言"让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上"，点击 AI 解析后获得三组英文 tag，点击"保存为方案"并命名为"哥特公路"
- **THEN** 系统创建一个 `DynamicScenePrompt`，其 `clothing` / `pose` / `scene` 分别为解析结果，`sourceCommand` 为原始输入，`name` 为"哥特公路"，并持久化到角色卡的 traits.json

#### Scenario: 数据模型与基础特征分离
- **WHEN** 用户保存了一个动态场景方案后，查看角色基础特征列表
- **THEN** 基础特征 `CharacterTraitItem[]` 不受影响，动态场景方案存储在 `dynamicScenePrompts` 字段中

### Requirement: 自然语言解析为三组 SD 提示词

系统 SHALL 提供自然语言到 SD 提示词的解析能力，通过 LLM 将用户的中文自然语言指令解析为三组英文 SD tag（`clothing` / `pose` / `scene`），每组为逗号分隔的英文 tag 字符串。

#### Scenario: 解析复合场景指令
- **WHEN** 用户输入"让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上"
- **THEN** 系统返回 `clothing` 为 "gothic dress, black lace, choker, dark makeup" 等 tag，`pose` 为 "riding motorcycle, holding handlebars, leaning forward" 等 tag，`scene` 为 "highway, motion blur, sunset, road" 等 tag

#### Scenario: 解析单一维度指令
- **WHEN** 用户输入"让角色坐在椅子上"
- **THEN** 系统返回 `pose` 为 "sitting on chair" 等 tag，`clothing` 和 `scene` 为空字符串（未提及的维度返回空）

#### Scenario: 无效输入兜底
- **WHEN** 用户输入空字符串或仅含空白字符
- **THEN** 系统返回友好错误"请输入动态场景指令"，不调用 LLM

### Requirement: 动态场景方案管理

系统 SHALL 提供动态场景方案的保存/加载/切换/删除功能，与现有 `TraitCombination`（特征组合方案）保持一致的交互模式。

#### Scenario: 切换激活的动态场景方案
- **WHEN** 用户从已保存的方案列表中选择"哥特公路"并点击应用
- **THEN** `activeDynamicScenePromptId` 设为该方案 ID，后续生成图片时自动携带该方案的 clothing/pose/scene

#### Scenario: 删除方案
- **WHEN** 用户删除当前激活的方案
- **THEN** 方案从列表移除，`activeDynamicScenePromptId` 重置为 null，后续生成回退到无动态场景状态

#### Scenario: 手动编辑解析结果
- **WHEN** 用户在 AI 解析后手动修改 `pose` 从 "riding motorcycle" 改为 "standing, hands on hips"
- **THEN** 修改反映在预览中，保存时写入修改后的值（非 AI 原始值）

### Requirement: 提示词预览

系统 SHALL 在 UI 中展示完整提示词预览，让用户在生成前看到基础特征 + 动态场景的完整组合效果。

#### Scenario: 预览完整提示词
- **WHEN** 用户激活一个动态场景方案后
- **THEN** UI 显示预览文本，包含基础特征拼接 + clothing + pose + scene，格式如 "white fur, dog girl, blue eyes, gothic dress, riding motorcycle, highway, high quality"

### Requirement: 生成流程集成

系统 SHALL 在立绘（illustration）和一般图像（general）生成流程中注入激活的动态场景提示词，通过新的占位符 `{clothing}` / `{pose}` / `{scene}` 实现。

#### Scenario: 立绘生成携带动态场景
- **WHEN** 用户激活了"哥特公路"方案后生成立绘
- **THEN** 立绘提示词模板替换为 `full body, {pose}, {traits}, {clothing}, {scene}, high quality, best quality, masterpiece`，其中 `{pose}` → "riding motorcycle..."，`{clothing}` → "gothic dress..."，`{scene}` → "highway..."

#### Scenario: 无激活方案时的默认行为
- **WHEN** 用户未激活任何动态场景方案（`activeDynamicScenePromptId` 为 null）时生成图片
- **THEN** `{clothing}` / `{pose}` / `{scene}` 替换为空字符串（立绘模式 `{pose}` 兜底为 "standing"，`{scene}` 兜底为 "simple background"），行为与当前一致

#### Scenario: 三视图不携带动态场景
- **WHEN** 用户生成三视图时
- **THEN** 三视图模板不使用动态场景占位符（三视图已有穿衣/裸体分组逻辑，动态场景仅适用于立绘和一般图像）

## MODIFIED Requirements

### Requirement: CharacterTraitManifestV2 存储

在 `CharacterTraitManifestV2` 中新增 `dynamicScenePrompts: DynamicScenePrompt[]`（默认 `[]`）与 `activeDynamicScenePromptId: string | null`（默认 `null`）。加载时若字段缺失则兜底补全（v2 迁移兼容）。保存时完整写入这两个字段。

### Requirement: buildAssetPromptTemplate 提示词模板

illustration 模板从 `full body, standing, {traits}, simple background, high quality, best quality, masterpiece` 改为 `full body, {pose}, {traits}, {clothing}, {scene}, high quality, best quality, masterpiece`。general 模板从 `{traits}, ${scene}, high quality, best quality` 改为 `{traits}, {clothing}, {pose}, {scene}, high quality, best quality`（`{scene}` 优先使用动态场景，无动态场景时回退到用户输入 `userScene`）。

### Requirement: applyTraitsAndLora 占位符替换

在现有 `{traits}` 替换逻辑后，新增 `{clothing}` / `{pose}` / `{scene}` 替换：从 `SDGenerationOptions.dynamicClothing` / `dynamicPose` / `dynamicScene` 读取值，替换对应占位符，并清理空替换产生的多余逗号。

### Requirement: SDGenerationOptions

新增 `dynamicClothing?: string` / `dynamicPose?: string` / `dynamicScene?: string` 三个可选字段，由 `AssetGenerateModal.buildSdOptions` 从 store 的激活动态场景方案中读取并填充。

## REMOVED Requirements

无移除项。所有现有功能保持不变，新增功能为纯增量扩展。
