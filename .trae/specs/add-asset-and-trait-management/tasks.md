# Tasks

## 阶段一：角色特征管理服务（主进程 + IPC + Store）

- [x] Task 1: 创建角色特征管理主进程服务 `characterTraitService.ts`
  - [ ] SubTask 1.1: 定义 `CharacterTraitManifest` 接口（`{ characterCardId, version: 1, traits: string[] }`）与 `sanitizeCardId` 复用 expressionService 的 SHA-256 哈希逻辑
  - [ ] SubTask 1.2: 实现 `loadTraits(characterCardId): Promise<string[]>`（文件不存在返回空数组，不抛异常）
  - [ ] SubTask 1.3: 实现 `saveTraits(characterCardId, traits: string[]): Promise<{ success, error? }>`（原子写入 `data/character-traits/{hash}/traits.json`，自动创建目录）
  - [ ] SubTask 1.4: 实现 `clearTraits(characterCardId): Promise<{ success, error? }>`（删除 traits.json 文件，文件不存在视为成功）

- [x] Task 2: 创建特征管理 IPC 处理器 `characterTraitHandlers.ts`
  - [ ] SubTask 2.1: 注册 IPC 通道 `character-trait:list` / `character-trait:save` / `character-trait:clear`，参数与返回值对齐 characterTraitService 方法签名
  - [ ] SubTask 2.2: 在 `src/main/ipc/index.ts`（或 setupIpcHandlers）注册 characterTraitHandlers
  - [ ] SubTask 2.3: 在 `src/main/preload.ts` 暴露 `window.electronAPI.characterTrait.{list, save, clear}`，在 `src/renderer/types/electron.d.ts` 补充类型声明

- [x] Task 3: 创建特征 Zustand store `characterTraitStore.ts`
  - [ ] SubTask 3.1: 定义 `CharacterTraitState`：`traits: string[]` / `loading: boolean` / `error: string | null` / `currentCharacterCardId`
  - [ ] SubTask 3.2: 实现 `loadTraits(characterCardId)` / `saveTraits(characterCardId, traits)` / `addTrait(trait)` / `removeTrait(index)` / `updateTrait(index, newValue)` / `clear()` actions，所有 actions 包裹 try/catch 永不抛异常
  - [ ] SubTask 3.3: 保存采用「乐观更新 + 失败回滚」策略：先更新本地 state 再调 IPC，失败时回滚并返回 `{ success, error }`

## 阶段二：特征携带机制（修改 SD 生成服务与提示词构建）

- [x] Task 4: 修改 `SDGenerationOptions` 接口与 `sdGenerationService` 注入特征
  - [ ] SubTask 4.1: `SDGenerationOptions` 新增 `characterTraits?: string[]` 字段
  - [ ] SubTask 4.2: `generateExpression` 中读取 `options.characterTraits`，拼接为逗号分隔字符串（如 `white fur, dog girl`）
  - [ ] SubTask 4.3: 提示词模板支持 `{traits}` 占位符替换；若 traits 为空则替换为空字符串（清理多余逗号与空格）
  - [ ] SubTask 4.4: ADetailer 的 `ad_prompt` 同步注入特征（保证面部修复也携带角色特征）

- [x] Task 5: 修改 `PromptBuilder.buildExpressionGenerationPrompt` 接收 traits 参数
  - [x] SubTask 5.1: 函数签名新增 `characterTraits?: string[]` 参数
  - [x] SubTask 5.2: 将 traits 拼接为 tag 字符串，替换 `positivePromptTemplate` 中的 `{traits}` 占位符
  - [x] SubTask 5.3: `SDWebuiConfig.positivePromptTemplate` 默认值更新为包含 `{traits}` 占位符（如 `portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face`）；`settings.ts` 默认配置同步更新
  - [x] SubTask 5.4: 兼容旧配置——若用户模板不含 `{traits}` 占位符，则在 prompt 开头追加 traits（不破坏旧模板）

## 阶段三：素材类型扩展服务（立绘/一般图像/三视图）

- [x] Task 6: 创建素材管理主进程服务 `assetService.ts`
  - [ ] SubTask 6.1: 定义素材类型枚举 `AssetType = 'illustration' | 'general' | 'three-view'`（表情类型 expression 不纳入，继续走 expressionService）
  - [ ] SubTask 6.2: 定义 `AssetManifest` 接口（`{ characterCardId, version: 1, assets: Record<string, AssetEntry> }`，AssetEntry 含 `id` / `type` / `slot?`（三视图槽位 front/side/back）/ `image` / `createdAt`）
  - [ ] SubTask 6.3: 实现 `listAssets(characterCardId, assetType)` / `saveAsset(characterCardId, assetType, assetId, imageBase64, slot?)` / `deleteAsset(characterCardId, assetType, assetId)` / `getAssetPath(characterCardId, assetType, assetId)`，存储路径 `data/character-assets/{hash}/{assetType}/{assetId}.png`
  - [ ] SubTask 6.4: 三视图槽位约束：`three-view` 类型仅允许 `front` / `side` / `back` 三个 assetId，saveAsset 时校验

- [x] Task 7: 创建素材管理 IPC 处理器 `assetHandlers.ts`
  - [ ] SubTask 7.1: 注册 IPC 通道 `asset:list` / `asset:save` / `asset:delete` / `asset:getImagePath`，参数含 `assetType`
  - [ ] SubTask 7.2: 在 setupIpcHandlers 注册；preload.ts 暴露 `window.electronAPI.asset.*`；electron.d.ts 补充类型声明

- [x] Task 8: 创建素材 Zustand store `assetStore.ts`
  - [ ] SubTask 8.1: 按 assetType 分组持有 `manifests: Record<AssetType, AssetManifest | null>` 与 `imageCache: Record<AssetType, Record<string, string>>`（imageCache 仅存 data URL，CSP 兼容，参照 expressionStore 修复模式）
  - [ ] SubTask 8.2: 实现 `loadAssets(characterCardId, assetType)` / `saveAsset(...)` / `deleteAsset(...)` actions
  - SubTask 8.3: 实现 `resolveAssetImage(assetType, assetId)` 解析器，供未来对话/卡片渲染调用

## 阶段四：素材管理 UI 重构

- [x] Task 9: 创建 `AssetManagerModal.tsx`（重构自 ExpressionManagerModal）
  - [x] SubTask 9.1: 顶层使用 antd `Tabs`，5 个 Tab：表情 / 角色立绘 / 一般图像 / 三视图 / 角色特征
  - [x] SubTask 9.2: 「表情」Tab 复用现有 ExpressionManagerModal 的表情网格逻辑（提取为内部子组件 `ExpressionTabContent`，复用 expressionStore）
  - [x] SubTask 9.3: 「角色立绘」「一般图像」Tab：素材网格 + 上传按钮 + AI 生成按钮 + 删除按钮（复用 ImageCropperModal 裁剪流程，复用 assetStore）
  - [x] SubTask 9.4: 「三视图」Tab：三个固定槽位（正面/侧面/背面）独立展示与操作
  - [x] SubTask 9.5: 「角色特征」Tab：特征 Tag 编辑器（antd `Tag` + `Input` + 添加/删除按钮）+ 「AI 生成特征」按钮 + 「保存」按钮（复用 characterTraitStore）

- [x] Task 10: 创建 `AssetGenerateModal.tsx`（扩展自 ExpressionGenerateModal）
  - [x] SubTask 10.1: 支持 `mode: 'batch-expression' | 'single-expression' | 'illustration' | 'general' | 'three-view'`，根据 mode 加载不同的提示词模板
  - [x] SubTask 10.2: 立绘模板：`full body, standing, {traits}, simple background, high quality`；一般图像：`{traits}, {userScene}, high quality`（userScene 由用户输入）；三视图模板：正面 `front view, {traits}, character sheet` / 侧面 `side view, {traits}, character sheet` / 背面 `back view, {traits}, character sheet`
  - [x] SubTask 10.3: 生成成功后调用 `assetStore.saveAsset`（非表情类型）或 `expressionStore.saveExpression`（表情类型）保存，自动携带 `characterTraits`（从 characterTraitStore 读取）

- [x] Task 11: 更新入口引用
  - [x] SubTask 11.1: `CharacterEditModal.tsx` 中「表情管理」Tab 重命名为「素材管理」，渲染 `AssetManagerModal`
  - [x] SubTask 11.2: `ChatHeader.tsx` 中「表情管理」按钮重命名为「素材管理」，图标保留 `SmileOutlined` 或换为 `AppstoreOutlined`
  - [x] SubTask 11.3: `CharacterDialogueChat.tsx` 中弹窗状态变量与渲染同步更新（保留 `expressionModalOpen` 命名或重命名为 `assetModalOpen`）

## 阶段五：AI 辅助特征生成

- [x] Task 12: 实现 AI 辅助特征生成 IPC 与服务
  - [ ] SubTask 12.1: 在 `src/main/services/` 新增 `characterTraitAIService.ts`，复用现有 AI 引擎调用基础设施（参考 writingHandlers 的 LLM 调用模式），接收 `characterCardId` / `description` / `personality` / `scenario`，返回 `string[]`
  - [ ] SubTask 12.2: 设计专用系统提示词：要求 LLM 从角色描述中提取视觉特征（物种、毛色/发色、服饰、配饰、瞳色等），输出逗号分隔的英文 tag 列表，禁止输出自然语言句子
  - [ ] SubTask 12.3: 注册 IPC `ai:generateCharacterTraits`，preload.ts 暴露 `window.electronAPI.ai.generateCharacterTraits`，electron.d.ts 补充类型
  - [ ] SubTask 12.4: 错误兜底：AI 引擎未配置 / 调用失败 / 返回格式异常时返回友好错误信息（非堆栈），UI 显示 message.error

- [x] Task 13: 在「角色特征」Tab 接入 AI 生成
  - [x] SubTask 13.1: 「AI 生成特征」按钮点击后调用 `window.electronAPI.ai.generateCharacterTraits`，loading 状态展示
  - [x] SubTask 13.2: AI 返回后以可编辑列表展示（每个特征一个 Tag + 删除按钮 + 编辑按钮），用户可逐条修改/删除/追加后点击「保存」持久化
  - [x] SubTask 13.3: 若已有特征，弹出 `Modal.confirm` 二次确认（"AI 生成将覆盖现有特征，是否继续？"）

## 阶段六：集成、验证与文档

- [x] Task 14: 端到端验证（静态验证完成；3 项运行时验证待用户执行，详见 checklist.md 末尾）
  - [x] SubTask 14.1: 表情类型向后兼容：打开素材管理 → 表情 Tab，原有表情数据完整可见可编辑（存储路径未变，零迁移）
  - [ ] SubTask 14.2: 特征携带：为角色 A 添加特征 `white fur, dog girl`，生成表情/立绘/三视图，确认 SD 控制台实际 prompt 包含特征 tag 【需用户运行时验证】
  - [ ] SubTask 14.3: AI 特征生成：点击「AI 生成特征」，确认返回的特征列表合理且可编辑保存 【需用户运行时验证】
  - [ ] SubTask 14.4: 三视图槽位：分别生成正面/侧面/背面，确认三个槽位独立存储互不覆盖 【需用户运行时验证】
  - [x] SubTask 14.5: CSP 兼容：新素材类型图片在网格中正常显示（data URL 模式），无裂开图标（代码层确认 imageCache 仅存 data URL）

- [x] Task 15: 更新技术文档
  - [x] SubTask 15.1: 更新 `CHANGELOG.md` 新增「素材管理与角色特征管理系统」条目
  - [x] SubTask 15.2: 更新 `docs/PROJECT_DOCUMENTATION_NEW.md` 新增 §7.3.3 素材管理与特征管理小节（架构图 + 素材类型表 + 特征携带流程 + AI 生成流程 + 文件清单）
  - [x] SubTask 15.3: 更新 `CODE_WIKI.md` 新增 §14.18-§14.26 条目（characterTraitService / characterTraitAIService / assetService / characterTraitStore / assetStore / AssetManagerModal / AssetGenerateModal）
  - [x] SubTask 15.4: 更新 `CODE_WIKI.md` §14.14 sdGenerationService 条目，说明 `characterTraits` 字段与 `{traits}` 占位符
  - [x] SubTask 15.5: 在所有文档中标注【重点标记】：表情管理 Tab 重构为素材管理（BREAKING UI 变更，表情数据零迁移）；特征携带机制是角色一致性的核心保障

# Task Dependencies

- Task 2 依赖 Task 1（IPC 依赖服务实现）
- Task 3 依赖 Task 2（store 依赖 IPC 暴露）
- Task 4 依赖 Task 3（sdGenerationService 注入特征依赖 store 可读取，但服务层 Task 4 仅依赖接口定义，可与 Task 3 并行）
- Task 5 依赖 Task 4（PromptBuilder 修改与 sdGenerationService 协同）
- Task 7 依赖 Task 6（IPC 依赖服务）
- Task 8 依赖 Task 7（store 依赖 IPC）
- Task 9 依赖 Task 3 + Task 8 + 现有 expressionStore（UI 需要三个 store 就绪）
- Task 10 依赖 Task 4 + Task 5 + Task 8（生成弹窗依赖特征注入与素材存储）
- Task 11 依赖 Task 9（入口引用依赖 AssetManagerModal 就绪）
- Task 12 依赖 Task 3（AI 生成结果写入 characterTraitStore）
- Task 13 依赖 Task 12 + Task 9（UI 接入依赖 AI 服务与特征 Tab）
- Task 14 依赖 Task 11 + Task 13（端到端验证依赖全部功能就绪）
- Task 15 依赖 Task 14（文档更新依赖验证完成）

# 可并行任务

- Task 1（特征服务）与 Task 6（素材服务）可并行
- Task 4（sdGenerationService 修改）与 Task 1/Task 6 可并行（仅修改接口与提示词构建）
- Task 12（AI 特征服务）与 Task 9/Task 10（UI）可并行
