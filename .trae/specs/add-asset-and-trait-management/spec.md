# 角色素材管理与特征管理系统 Spec

## Why

在已集成 sd-webui-forge-neo 图片生成服务后，现有「表情管理」模块仅支持表情图生成与管理，无法满足角色立绘、一般图像、三视图等多元素材的生成需求。同时，不同素材类型生成时缺乏统一的「角色视觉特征」携带机制，导致同一角色在不同素材中形象不一致（毛色、服饰、物种等关键特征容易漂移）。需要将「表情管理」重构拓展为「素材管理」模块，并新增独立的角色特征管理系统，确保所有素材生成都能继承角色一般特征，提升角色形象一致性。

## What Changes

- **重构 UI 入口**：将 `ExpressionManagerModal` 重构为 `AssetManagerModal`，内部以 Tabs 组织多个素材类型 + 角色特征管理；`CharacterEditModal` 中原「表情管理」Tab 改名为「素材管理」，`ChatHeader` 中原「表情管理」按钮入口同步迁移
- **新增素材类型**：在表情图（保留现有 30 预置情绪 + 自定义）基础上，新增「角色立绘」「一般图像」「三视图」三种素材类型，每种类型支持手动上传 + AI 生成 + 删除 + 预览
- **新增角色特征管理服务**：主进程新增 `characterTraitService.ts`，独立持久化角色视觉特征清单（如 `white fur, dog girl, black shirt`）到 `data/character-traits/{hash}/traits.json`
- **新增特征携带机制**：`SDGenerationOptions` 新增 `characterTraits` 字段；`sdGenerationService` 在构建 img2img 提示词时自动将特征 tag 拼接注入；`positivePromptTemplate` 新增 `{traits}` 占位符
- **新增 AI 辅助特征生成**：新增 IPC `ai:generateCharacterTraits`，调用现有 AI 引擎基于角色卡 `description` / `personality` / `scenario` 字段自动提取视觉特征 tag 列表；UI 提供特征编辑器（添加 / 删除 / 修改 / 排序）+ 「AI 生成特征」按钮
- **BREAKING（UI 层面）**：`ExpressionManagerModal` 文件名与组件名变更为 `AssetManagerModal`，原引用方需同步更新（`CharacterEditModal` / `CharacterDialogueChat` / `ChatHeader`）；表情数据存储路径 `data/character-expressions/{hash}/` **保持不变**，确保现有表情数据零迁移、零丢失

## Impact

- **Affected specs**：
  - `add-character-expression-system`：表情管理系统被重构为素材管理的一个子类型（表情 Tab），表情数据存储与服务层（`expressionService` / `expressionStore`）保持不变，仅 UI 入口层重构
  - `add-ai-expression-generation`：AI 表情生成服务（`sdGenerationService` / `ExpressionGenerateModal`）被扩展为支持多素材类型生成；新增 `characterTraits` 字段注入提示词
- **Affected code**：
  - `src/main/services/characterTraitService.ts`（新建）：角色特征持久化服务
  - `src/main/services/sdGenerationService.ts`（修改）：`SDGenerationOptions` 新增 `characterTraits` 字段，提示词构建注入特征
  - `src/main/services/expressionService.ts`（不变）：表情数据层保持不变
  - `src/main/ipc/handlers/characterTraitHandlers.ts`（新建）：特征 CRUD + AI 生成 IPC
  - `src/renderer/stores/characterTraitStore.ts`（新建）：特征 Zustand store
  - `src/renderer/stores/assetStore.ts`（新建）：立绘/一般图像/三视图素材 Zustand store
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（新建，重构自 `ExpressionManagerModal`）：多 Tab 素材管理弹窗
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（新建，扩展自 `ExpressionGenerateModal`）：多素材类型 AI 生成弹窗
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`（保留为表情 Tab 内部内容，或合并入 AssetManagerModal）
  - `src/renderer/components/Character/CharacterEditModal.tsx`（修改）：Tab 重命名 + 引用更新
  - `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx`（修改）：入口按钮重命名
  - `src/shared/settings.ts` / `src/renderer/types/setting.ts`（修改）：`SDWebuiConfig.positivePromptTemplate` 支持 `{traits}` 占位符（默认模板更新）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（修改）：`buildExpressionGenerationPrompt` 接收 traits 参数注入提示词

## ADDED Requirements

### Requirement: 素材类型扩展

系统 SHALL 支持四种素材类型的管理与生成：表情图（expression，保留现有）、角色立绘（illustration）、一般图像（general）、三视图（three-view）。每种素材类型 SHALL 独立存储于 `data/character-assets/{hash}/{assetType}/` 目录下（表情类型继续使用现有 `data/character-expressions/{hash}/` 路径，不迁移），每种类型 SHALL 拥有独立的 `manifest.json` 记录已上传/生成的素材清单。

#### Scenario: 表情类型向后兼容
- **WHEN** 用户打开重构后的素材管理弹窗并切换到「表情」Tab
- **THEN** 显示现有 `data/character-expressions/{hash}/` 中的全部表情数据（30 预置 + 自定义），无需任何数据迁移

#### Scenario: 新增立绘素材
- **WHEN** 用户在「角色立绘」Tab 点击「上传」并选择图片
- **THEN** 图片经裁剪后保存到 `data/character-assets/{hash}/illustration/` 目录，manifest 记录该素材，UI 网格立即显示新立绘

#### Scenario: 三视图分槽位管理
- **WHEN** 用户在「三视图」Tab 查看素材
- **THEN** 显示三个固定槽位（正面 / 侧面 / 背面），每个槽位可独立上传或 AI 生成，互不覆盖

### Requirement: 角色特征管理服务

系统 SHALL 提供独立的主进程服务 `characterTraitService`，为每个角色卡持久化视觉特征清单到 `data/character-traits/{hash}/traits.json`，文件结构为 `{ characterCardId, version: 1, traits: string[] }`。特征 SHALL 以纯 tag 字符串数组形式存储（如 `["white fur", "dog girl", "black shirt"]`），顺序代表用户优先级。

#### Scenario: 首次加载无特征文件
- **WHEN** 用户打开某角色卡的特征管理 Tab，且 `traits.json` 不存在
- **THEN** 返回空特征列表 `[]`，UI 显示「尚未添加特征」空状态 + 「AI 生成特征」引导按钮

#### Scenario: 特征持久化
- **WHEN** 用户添加特征 tag "red eyes" 并保存
- **THEN** `traits.json` 写入 `["white fur", "dog girl", "black shirt", "red eyes"]`，下次打开仍可见

### Requirement: 特征自动携带机制

系统 SHALL 在生成任何角色相关素材（表情 / 立绘 / 一般图像 / 三视图）时，自动读取该角色的特征清单并注入到 SD 提示词中。`SDGenerationOptions` SHALL 新增 `characterTraits?: string[]` 字段；`sdGenerationService` SHALL 将特征数组拼接为逗号分隔的 tag 字符串，通过 `positivePromptTemplate` 的 `{traits}` 占位符注入。

#### Scenario: 表情生成携带特征
- **WHEN** 用户为角色 A 生成表情，角色 A 的特征为 `["white fur", "dog girl"]`
- **THEN** SD 请求的 prompt 包含 `white fur, dog girl`（拼接在 `{traits}` 占位符位置），保证生成的表情符合角色物种与外观

#### Scenario: 无特征时正常生成
- **WHEN** 角色 B 无任何特征，用户生成素材
- **THEN** `{traits}` 占位符替换为空字符串，生成正常进行（不报错、不注入多余逗号）

#### Scenario: 三视图生成携带特征
- **WHEN** 用户为角色 A 生成三视图正面
- **THEN** 三个视图的生成提示词均携带 `white fur, dog girl`，确保三视图形象一致

### Requirement: AI 辅助特征生成

系统 SHALL 提供 AI 辅助特征生成功能，基于角色卡的 `description` / `personality` / `scenario` 字段自动提取视觉特征 tag 列表。新增 IPC `ai:generateCharacterTraits`，调用现有 AI 引擎（复用 `writingHandlers` 或 `characterChatHandlers` 的 LLM 调用基础设施），使用专用提示词要求 LLM 输出逗号分隔的英文 tag 列表。

#### Scenario: AI 生成特征成功
- **WHEN** 用户点击「AI 生成特征」按钮，角色卡描述为 "A white-furred dog girl who wears a black shirt..."
- **THEN** AI 返回特征列表如 `["white fur", "dog girl", "black shirt", "animal ears"]`，UI 以可编辑列表展示，用户可逐条确认/修改/删除后保存

#### Scenario: AI 生成失败兜底
- **WHEN** AI 引擎未配置或调用失败
- **THEN** 返回友好错误信息（非堆栈），UI 显示错误提示，用户仍可手动添加特征

### Requirement: 特征编辑界面

系统 SHALL 在素材管理弹窗的「角色特征」Tab 提供直观的特征编辑器：
- 特征以 Tag/Chip 形式展示（参考 antd `Tag` 组件）
- 每个特征 Tag 提供「删除」按钮
- 底部提供输入框 + 「添加」按钮添加新特征
- 顶部提供「AI 生成特征」按钮（覆盖确认）+ 「保存」按钮
- 特征顺序可通过拖拽或上下移动按钮调整（可选，首版可仅支持追加顺序）

#### Scenario: 添加特征
- **WHEN** 用户在输入框输入 "blue eyes" 并点击「添加」
- **THEN** 特征列表追加 "blue eyes"，输入框清空，特征 Tag 立即显示（乐观更新，保存后持久化）

#### Scenario: 删除特征
- **WHEN** 用户点击特征 Tag "black shirt" 的删除按钮
- **THEN** 该特征从列表移除，UI 立即更新，保存后 `traits.json` 同步移除

### Requirement: 素材生成弹窗多类型扩展

系统 SHALL 提供统一的素材 AI 生成弹窗 `AssetGenerateModal`（扩展自 `ExpressionGenerateModal`），支持四种素材类型的生成：
- **表情**：批量 30 预置情绪 + 单个生成（保留现有）
- **立绘**：单个生成，提示词模板侧重全身/半身构图
- **一般图像**：单个生成，用户可自由输入场景描述
- **三视图**：分槽位生成（正面/侧面/背面），提示词模板侧重对应视角

所有生成流程 SHALL 自动携带角色特征（通过 `SDGenerationOptions.characterTraits`）。

#### Scenario: 生成立绘携带特征
- **WHEN** 用户在「角色立绘」Tab 点击「AI 生成立绘」
- **THEN** 打开 `AssetGenerateModal` mode=illustration，预览提示词包含角色特征 tag + 立绘构图词（如 `full body, standing, simple background`），生成结果保存到 `illustration/` 目录

## MODIFIED Requirements

### Requirement: 表情管理入口（原 add-character-expression-system / Task 7 + Task 15）

原 `ExpressionManagerModal` 作为独立弹窗提供表情管理。**修改为**：`AssetManagerModal` 的「表情」Tab 内部内容，表情数据层（`expressionService` / `expressionStore`）完全不变，仅 UI 容器层重构。`CharacterEditModal` 中「表情管理」Tab 重命名为「素材管理」并渲染 `AssetManagerModal`；`ChatHeader` 中「表情管理」按钮重命名为「素材管理」并指向同一弹窗。

### Requirement: SD 生成提示词构建（原 add-ai-expression-generation / Task 3）

原 `buildExpressionGenerationPrompt(charDescription, emotionKey, customLabel?)` 仅组合角色卡描述 + 情绪提示词。**修改为**：新增 `characterTraits: string[]` 参数，将特征 tag 拼接为逗号分隔字符串注入 `{traits}` 占位符；`positivePromptTemplate` 默认值更新为包含 `{traits}` 占位符（如 `portrait, {traits}, looking at viewer, simple background, ...`）；角色卡 `description` 长文本不再自动注入（保留 Task 6 的可编辑提示词策略），由 `{traits}` 承担角色一致性职责。

## REMOVED Requirements

（无移除需求。表情系统的全部功能保留，仅 UI 容器重构。）
