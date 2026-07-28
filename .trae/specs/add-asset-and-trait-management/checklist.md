# Checklist - 角色素材管理与特征管理系统

> 验证方式说明：本清单通过静态代码审查 + TypeScript 类型检查验证。
> 标注 【需用户运行时验证】 的条目需用户在实际运行环境中确认（如 SD WebUI 生成、AI 引擎调用等）。

## 阶段一：角色特征管理服务

- [x] `characterTraitService.ts` 实现 `loadTraits` / `saveTraits` / `clearTraits` 三个方法，文件不存在时 `loadTraits` 返回空数组不抛异常
- [x] `characterTraitService` 使用 SHA-256 哈希 `characterCardId` 作为目录名（与 expressionService 的 `sanitizeCardId` 逻辑一致），存储路径 `data/character-traits/{hash}/traits.json`
- [x] `characterTraitHandlers.ts` 注册 `character-trait:list` / `character-trait:save` / `character-trait:clear` 三个 IPC 通道
- [x] `preload.ts` 暴露 `window.electronAPI.characterTrait.{list, save, clear}`，`electron.d.ts` 补充类型声明
- [x] `characterTraitStore.ts` 提供 `loadTraits` / `saveTraits` / `addTrait` / `removeTrait` / `updateTrait` / `setTraits` / `clear` actions，所有 actions 包裹 try/catch 永不抛异常
- [x] `characterTraitStore` 保存采用「乐观更新 + 失败回滚」策略

## 阶段二：特征携带机制

- [x] `SDGenerationOptions` 接口新增 `characterTraits?: string[]` 字段
- [x] `sdGenerationService.generateExpression` 读取 `options.characterTraits`，拼接为逗号分隔字符串注入 `{traits}` 占位符
- [x] 特征为空时 `{traits}` 替换为空字符串，不产生多余逗号或前导空格
- [x] ADetailer 的 `ad_prompt` 同步注入特征 tag（保证面部修复也携带角色特征）
- [x] `PromptBuilder.buildExpressionGenerationPrompt` 函数签名新增 `characterTraits?: string[]` 参数
- [x] `SDWebuiConfig.positivePromptTemplate` 默认值包含 `{traits}` 占位符
- [x] `settings.ts` 默认配置同步更新含 `{traits}` 的模板
- [x] 兼容旧配置：若用户模板不含 `{traits}` 占位符，traits 拼接在 prompt 开头（不破坏旧模板）

## 阶段三：素材类型扩展服务

- [x] `assetService.ts` 定义 `AssetType = 'illustration' | 'general' | 'three-view'`，表情类型不纳入
- [x] `assetService` 存储路径 `data/character-assets/{hash}/{assetType}/{assetId}.png`，每种类型独立 manifest.json
- [x] `assetService` 实现 `listAssets` / `saveAsset` / `deleteAsset` / `getAssetPath` 四个方法
- [x] 三视图槽位约束：`three-view` 类型仅允许 `front` / `side` / `back` 三个 assetId，saveAsset 时校验
- [x] `assetHandlers.ts` 注册 `asset:list` / `asset:save` / `asset:delete` / `asset:getImagePath` IPC 通道
- [x] `preload.ts` 暴露 `window.electronAPI.asset.*`，`electron.d.ts` 补充类型声明
- [x] `assetStore.ts` 按 assetType 分组持有 manifests 与 imageCache
- [x] `assetStore.imageCache` 仅存 data URL（CSP 兼容，参照 expressionStore 修复模式），不存磁盘绝对路径
- [x] `assetStore` 提供 `loadAssets` / `saveAsset` / `deleteAsset` / `resolveAssetImage` actions

## 阶段四：素材管理 UI 重构

- [x] `AssetManagerModal.tsx` 顶层使用 antd `Tabs`，5 个 Tab：表情 / 角色立绘 / 一般图像 / 三视图 / 角色特征
- [x] 「表情」Tab 复用现有 ExpressionManagerModal 的表情网格逻辑，复用 expressionStore，原有表情数据完整可见可编辑
- [x] 「角色立绘」「一般图像」Tab：素材网格 + 上传 + AI 生成 + 删除，复用 ImageCropperModal 裁剪流程
- [x] 「三视图」Tab：三个固定槽位（正面/侧面/背面）独立展示与操作，互不覆盖
- [x] 「角色特征」Tab：特征 Tag 编辑器（antd `Tag` + `Input` + 添加/删除按钮）+ 「AI 生成特征」按钮 + 「保存」按钮
- [x] `AssetGenerateModal.tsx` 支持 `mode: 'batch-expression' | 'single-expression' | 'illustration' | 'general' | 'three-view'`
- [x] 立绘/一般图像/三视图的提示词模板正确（含 `{traits}` 占位符 + 对应构图/视角词）
- [x] 生成成功后调用正确的 store 保存（表情→expressionStore，其他→assetStore），自动携带 characterTraits
- [x] `CharacterEditModal.tsx` 中「表情管理」Tab 重命名为「素材管理」，渲染 `AssetManagerModal`
- [x] `ChatHeader.tsx` 中「表情管理」按钮重命名为「素材管理」
- [x] `CharacterDialogueChat.tsx` 弹窗状态变量与渲染同步更新

## 阶段五：AI 辅助特征生成

- [x] `characterTraitAIService.ts` 复用现有 AI 引擎调用基础设施，接收角色卡字段返回 `string[]`
- [x] 专用系统提示词要求 LLM 提取视觉特征 tag（物种/毛色/发色/服饰/配饰/瞳色），输出逗号分隔英文 tag，禁止自然语言句子
- [x] 注册 IPC `ai:generateCharacterTraits`，preload.ts 暴露，electron.d.ts 补充类型
- [x] AI 引擎未配置/调用失败/返回格式异常时返回友好错误信息（非堆栈）
- [x] 「角色特征」Tab 的「AI 生成特征」按钮点击后调用 IPC，loading 状态展示
- [x] AI 返回后以可编辑列表展示，用户可逐条修改/删除/追加后保存（通过 `setTraits` 本地批量替换 + 用户编辑后 `saveTraits` 持久化）
- [x] 已有特征时弹出 `Modal.confirm` 二次确认覆盖（`okButtonProps: { danger: true }` 兼容 antd v6）

## 阶段六：集成验证与文档

- [x] 表情类型向后兼容：打开素材管理 → 表情 Tab，原有 `data/character-expressions/{hash}/` 数据完整可见可编辑，零迁移（存储路径未变）
- [ ] 特征携带验证：为角色添加特征后生成表情/立绘/三视图，SD 控制台实际 prompt 包含特征 tag 【需用户运行时验证：启动 SD WebUI 后实际生成并检查控制台日志】
- [x] 无特征时生成正常进行，不报错不注入多余逗号（代码逻辑：traits 为空时 `{traits}` 替换为空字符串）
- [ ] AI 特征生成返回合理特征列表且可编辑保存 【需用户运行时验证：配置 AI 引擎后实际调用】
- [ ] 三视图三个槽位独立存储互不覆盖 【需用户运行时验证：实际生成三视图后检查文件目录】
- [x] CSP 兼容：新素材类型图片在网格中正常显示（data URL），无裂开图标（代码层确认 `assetStore.imageCache` 仅存 data URL，与 expressionStore 修复模式一致）
- [x] TypeScript 类型检查通过（修改/新建文件无新增错误，已通过 `npx tsc --noEmit` 验证）
- [x] `CHANGELOG.md` 新增素材管理与特征管理系统条目
- [x] `docs/PROJECT_DOCUMENTATION_NEW.md` 新增 §7.3.3 小节
- [x] `CODE_WIKI.md` 新增 §14.18-§14.26 条目，§14.14 补充 characterTraits 字段说明
- [x] 所有文档标注【重点标记】：表情管理 Tab 重构为素材管理（BREAKING UI 变更，表情数据零迁移）；特征携带机制是角色一致性的核心保障

## 运行时验证待办（用户执行）

以下 3 项需用户在实际运行环境中验证，验证通过后可将上述对应条目打勾：

1. **特征携带实际生成验证**：启动 SD WebUI（G:\AI\sd-webui-forge-neo\webui-user.bat），为某角色添加特征（如 `white fur, dog girl`），分别生成表情/立绘/三视图，检查 SD 控制台输出的实际 prompt 是否包含特征 tag
2. **AI 特征生成实际调用**：在设置中配置 AI 引擎，打开角色卡素材管理 → 角色特征 Tab，点击「AI 生成特征」，确认返回合理的英文 tag 列表且可编辑保存
3. **三视图槽位独立存储**：分别生成三视图的正面/侧面/背面，检查 `data/character-assets/{hash}/three-view/` 目录下 `front.png` / `side.png` / `back.png` 三个文件独立存在互不覆盖
