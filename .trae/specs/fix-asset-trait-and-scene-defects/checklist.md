# Checklist — 素材/特征/动态场景缺陷修复

> 用于验证 `fix-asset-trait-and-scene-defects` spec 的实现是否满足全部要求。
> 每个检查点对应 spec.md 中的 Requirement / Scenario，结合 tasks.md 中的子任务。

## 三视图与高分辨率（Task 1 + Task 2）

### 裸体版三视图固定 nude tag
- [x] `NUDE_FIXED_TAGS` 常量在 `PromptBuilder.ts` 中定义，包含 `['nude', 'naked', 'bare skin', 'completely naked', 'no clothes', 'nsfw']`
- [x] `buildAssetPromptTemplate` 的 three-view 模板对 `*-nude` 槽位拼接 `NUDE_FIXED_TAGS.join(', ')`
- [x] 穿衣版三视图（`front` / `side` / `back`）不包含 nude tag，行为与当前一致
- [x] JSDoc 注释说明「固定包含，不可被用户配置覆盖」+ spec 引用

### 高分辨率人物数量约束
- [x] `detectGenderTag(traits)` 工具函数在 `AssetGenerateModal.tsx` 中实现，从 `categoryId='basic'` 查找性别 tag
- [x] `buildSdOptions` 中分辨率检测：`width * height >= 1024 * 1024` 时调用 `detectGenderTag`
- [x] `SDGenerationOptions` 新增 `characterGenderTag?: string` 字段
- [x] `applyTraitsAndLora` 在 `{traits}` 替换后注入 `characterGenderTag`（避免重复）
- [x] 低分辨率（< 1024×1024）不注入
- [x] 基础特征已含 `1girl` / `1boy` 时不重复注入
- [x] 无法判断性别时记录警告日志，不注入
- [x] illustration / general / three-view 三种模式均能正确注入

## 全局分类字典服务（Task 3）
- [x] `GlobalTraitCategoryDictionary` 接口在 `characterTrait.types.ts` 中定义
- [x] `categoryDictionaryService.ts` 实现 `loadDictionary` / `saveDictionary` / `addCategory` / `deleteCategory` / `renameCategory` / `hasCategory` 方法
- [x] 持久化路径 `{userData}/data/trait-categories.json`
- [x] 文件不存在时返回空字典（`categories: []`）
- [x] IPC 通道 `category-dictionary:load` / `:add` / `:delete` / `:rename` / `:has` 在 `categoryDictionaryHandlers.ts` 注册
- [x] `src/main/ipc/index.ts` 调用 `registerCategoryDictionaryHandlers()`
- [x] `preload.ts` 暴露 `window.electronAPI.categoryDictionary.*` 方法
- [x] `electron.d.ts` 补全 `categoryDictionary` 命名空间类型声明

## 分类系统重构（Task 4）

- [x] `characterTraitStore.ts` 新增 `globalCategories: TraitCategory[]` state
- [x] `loadTraits` 调用 `categoryDictionary.load()` 填充 `globalCategories`，不再从 manifest 读取 `customCategories`
- [x] 新增 `createCategory(name)` / `renameCategory(id, newName)` / `deleteCategory(id)` actions
- [x] 删除分类时其下特征回退 `uncategorized`（与现有逻辑一致）
- [x] `saveTraits` 不再写入 `customCategories` 字段（保留旧值以兼容）
- [x] `AssetManagerModal.tsx` 的「新建分类」入口调用 `createCategory(name)` 而非写入角色卡 manifest
- [x] 既有数据迁移：首次加载时将角色卡 `customCategories` 合并到全局字典（按 name 去重）

## AI 生成自定义分类 bug 修复（Task 5）

- [x] `buildDynamicTraitSystemPrompt(globalCategories)` 方法在 `characterTraitAIService.ts` 中实现
- [x] 系统提示词分类列表包含 7 个系统分类 + 全局字典自定义分类
- [x] `generateCharacterTraits` 调用 `categoryDictionaryService.loadDictionary()` 读取全局分类，传入动态 prompt 构建器
- [x] `recognizeImageTraits` 同样使用动态构建的 prompt
- [x] `parseTraitsFromContent` 的 `validCategoryIds` 包含全局字典分类 id（不再仅限系统分类）
- [x] 验证：全局字典有「纹身」(id: `tattoo`) 时，LLM 返回 `tattoo:dragon tattoo` 能被正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`
- [x] 兼容性：LLM 未输出分类前缀时仍兜底 `uncategorized`

## 动态场景选择 UI（Task 6）

- [x] `AssetGenerateModal.tsx` 订阅 `applyDynamicScenePrompt` action
- [x] 生成参数面板中新增 `<Select>` 下拉，options 来自 `dynamicScenePrompts`
- [x] 当前激活方案（`activeDynamicScenePromptId`）作为 Select 的 value
- [x] `onChange` 回调调用 `applyDynamicScenePrompt(id)`
- [x] 空状态（`dynamicScenePrompts.length === 0`）时 Select disabled + placeholder 提示
- [x] 下拉位置显眼，风格与现有控件一致

## userScene 输入替换（Task 7）

- [x] `AssetGenerateModal.tsx` 中移除 `userScene` 的 `<Input>` / `<Input.TextArea>` UI 元素
- [x] `userScene` state 保留（默认空字符串）仅作 `buildAssetPromptTemplate` 兼容参数
- [x] `buildSdOptions` 移除「无动态 scene 时回退 userScene」逻辑
- [x] `buildAssetPromptTemplate` 的 `userScene` 参数标记 `@deprecated`

## 动态场景提示词拼接验证（Task 8）

- [x] illustration + 激活动态场景：`{clothing}` / `{pose}` / `{scene}` 正确替换
- [x] general + 激活动态场景：`{clothing}` / `{pose}` / `{scene}` 正确替换
- [x] three-view：模板不含新占位符，替换为 no-op
- [x] 无激活方案时 illustration：`{pose}` 兜底 `standing` / `{scene}` 兜底 `simple background`
- [x] 无激活方案时 general：占位符替换为空字符串（移除 userScene 回退后）
- [x] 空逗号清理逻辑在所有场景下正常工作

## 质量标准（用户原始要求）

- [x] 裸体版三视图固定包含 nude 等核心关键词
- [x] 高分辨率（≥1024×1024）自动添加 `1girl` / `1boy` 人物数量约束
- [x] 新建分类持久化存储，重启后、跨角色卡保留
- [x] 新建分类实际创建字典条目（如「纹身」「武器装备」）
- [x] 新建分类后 AI 能生成对应提示词 tag
- [x] 动态场景指令在图片生成功能中可选择
- [x] 场景描述输入框替换为下拉选择组件
- [x] 动态场景提示词自动正确拼接到最终图片生成提示词

## 集成验证（Task 9）

- [x] `npx tsc --noEmit` 对所有修改文件零新增错误
- [x] 端到端流程：三视图 nude tag / 高分辨率 1girl 注入 / 自定义分类跨角色 / 动态场景选择 → 生成（静态代码审查 PASS，运行时验证推迟到 Electron 集成测试）
- [x] 既有数据迁移：旧 traits.json 的 `customCategories` 加载后出现在全局字典（静态代码审查 PASS，运行时验证推迟到 Electron 集成测试）
- [x] `CODE_WIKI.md` 回写（新增 spec 综述章节：架构图 + IPC 表 + 服务表 + store 表 + 类型表 + 文件清单）
- [x] `docs/FIX_RECORDS.md` 追加实现记录 + **重点标记**三个 bug 修复（§5.1 / §5.2 / §5.3）
- [x] `CHANGELOG.md` 追加版本条目（spec 级别单条目覆盖 Task 1-9）

## 验证结果汇总

| 验证项 | 状态 | 说明 |
|---|---|---|
| Task 9.1 tsc 验证 | PASS | 5 个预存在错误位于无关文件（`writing/PromptBuilder.ts` 4 个 + `CharacterDialogueChat/PromptBuilder.ts:703` 1 个），与 spec 修改无关 |
| Task 9.2 端到端流程 | 静态 PASS | 见 `docs/FIX_RECORDS.md` §5.6；运行时验证推迟到 Electron 集成测试，遵循项目「Native Module Test Gap Convention」 |
| Task 9.3 既有数据迁移 | 静态 PASS | `migrateFromManifest` 幂等性 + 失败兜底 + 全局字典写盘；运行时验证推迟到 Electron 集成测试 |
| Task 9.4 文档回写 | 完成 | `CODE_WIKI.md` 新增 spec 综述章节；`docs/FIX_RECORDS.md` §5.1 ~ §5.6；`CHANGELOG.md` spec 级别单条目 |
| Task 9.5 三个 bug 重点标记 | 完成 | §5.1（动态场景选择缺失）/ §5.2（AI 不生成自定义分类 tag）/ §5.3（高分辨率多角色）均标注【重点标记】 |
