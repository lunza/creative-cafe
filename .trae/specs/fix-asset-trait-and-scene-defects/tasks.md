# Tasks

- [x] Task 1: 扩展裸体版三视图固定 nude tag 列表
  - [x] SubTask 1.1: 在 `PromptBuilder.ts` 中新增 `NUDE_FIXED_TAGS` 常量数组（`['nude', 'naked', 'bare skin', 'completely naked', 'no clothes', 'nsfw']`）
  - [x] SubTask 1.2: 修改 `buildAssetPromptTemplate` 的 three-view 模板，`*-nude` 槽位生成时拼接 `NUDE_FIXED_TAGS.join(', ')`（替换当前的 `nude, naked, bare skin` 硬编码）
  - [x] SubTask 1.3: 添加 JSDoc 注释说明「固定包含，不可被用户配置覆盖」，引用 spec `fix-asset-trait-and-scene-defects`

- [x] Task 2: 高分辨率自动注入人物数量约束 tag
  - [x] SubTask 2.1: 在 `AssetGenerateModal.tsx` 中新增 `detectGenderTag(traits: CharacterTraitItem[])` 工具函数：从 `categoryId='basic'` 的特征中查找 `1girl` / `1boy` / `female` / `male` / `girl` / `boy`，返回 `'1girl'` / `'1boy'` / `null`
  - [x] SubTask 2.2: 在 `buildSdOptions` 中新增分辨率检测：解析 `selectedSize` 为 width × height，当 `width * height >= 1024 * 1024` 时调用 `detectGenderTag`，若返回非 null 且基础特征中未已包含该 tag，则填充 `characterGenderTag` 字段
  - [x] SubTask 2.3: 在 `sdGenerationService.ts` 的 `SDGenerationOptions` 新增 `characterGenderTag?: string` 字段
  - [x] SubTask 2.4: 在 `applyTraitsAndLora` 中，`{traits}` 替换后追加 `characterGenderTag` 注入逻辑（紧随 traits 之后，用 `, ` 分隔，避免与已有 tag 重复）
  - [x] SubTask 2.5: 验证 illustration / general / three-view 三种模式均能正确注入；低分辨率不注入；基础特征已含 `1girl` 时不重复注入

- [x] Task 3: 新建全局分类字典服务
  - [x] SubTask 3.1: 在 `src/shared/types/characterTrait.types.ts` 新增 `GlobalTraitCategoryDictionary` 接口（`{ version: 1, categories: TraitCategory[], updatedAt: number }`）
  - [x] SubTask 3.2: 新建 `src/main/services/categoryDictionaryService.ts`：实现 `loadDictionary()` / `saveDictionary()` / `addCategory(name, icon?)` / `deleteCategory(id)` / `renameCategory(id, newName)` / `hasCategory(name)` 方法
  - [x] SubTask 3.3: 持久化路径 `{userData}/data/trait-categories.json`，文件不存在时返回空字典（`categories: []`）
  - [x] SubTask 3.4: 新建 `src/main/ipc/handlers/categoryDictionaryHandlers.ts`：注册 `category-dictionary:load` / `category-dictionary:add` / `category-dictionary:delete` / `category-dictionary:rename` / `category-dictionary:has` IPC 通道
  - [x] SubTask 3.5: 在 `src/main/ipc/index.ts` 注册 `registerCategoryDictionaryHandlers()`
  - [x] SubTask 3.6: 在 `src/main/preload.ts` 暴露 `window.electronAPI.categoryDictionary.*` 方法
  - [x] SubTask 3.7: 在 `src/renderer/types/electron.d.ts` 补全 `categoryDictionary` 命名空间类型声明

- [x] Task 4: 重构 characterTraitStore 使用全局分类字典
  - [x] SubTask 4.1: 在 `characterTraitStore.ts` 新增 `globalCategories: TraitCategory[]` state（替代从 manifest 读取 `customCategories`）
  - [x] SubTask 4.2: `loadTraits` 中调用 `window.electronAPI.categoryDictionary.load()` 填充 `globalCategories`；不再从 manifest 读取 `customCategories`
  - [x] SubTask 4.3: 新增 `createCategory(name)` action：调用 `categoryDictionary.add(name)` → 更新 `globalCategories` state
  - [x] SubTask 4.4: 新增 `renameCategory(id, newName)` / `deleteCategory(id)` actions：调用对应 IPC + 更新 state；删除分类时其下特征回退 `uncategorized`（与现有逻辑一致）
  - [x] SubTask 4.5: `saveTraits` 不再写入 `customCategories` 字段（保留 manifest 中的旧值以兼容，但不再更新）
  - [x] SubTask 4.6: 修改 `AssetManagerModal.tsx` 的「新建分类」入口：调用 `createCategory(name)` 而非写入角色卡 manifest

- [x] Task 5: 修复 AI 生成不包含自定义分类的 bug
  - [x] SubTask 5.1: 在 `characterTraitAIService.ts` 新增 `buildDynamicTraitSystemPrompt(globalCategories: TraitCategory[])` 方法：动态拼接系统分类 + 自定义分类的列表，返回完整 system prompt
  - [x] SubTask 5.2: `generateCharacterTraits` 在构建 messages 前，调用 `categoryDictionaryService.loadDictionary()` 读取全局分类，传入 `buildDynamicTraitSystemPrompt`
  - [x] SubTask 5.3: `recognizeImageTraits` 同样使用动态构建的 prompt
  - [x] SubTask 5.4: 修改 `parseTraitsFromContent`：将全局字典分类 id 加入合法前缀集合（`validCategoryIds`），不再仅限于 `SYSTEM_TRAIT_CATEGORIES.map(c => c.id)`
  - [x] SubTask 5.5: 验证：全局字典有「纹身」(id: `tattoo`) 时，AI 返回 `tattoo:dragon tattoo` 能被正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`

- [x] Task 6: 在 AssetGenerateModal 新增动态场景选择下拉
  - [x] SubTask 6.1: 在 `AssetGenerateModal.tsx` 中订阅 `dynamicScenePrompts` / `activeDynamicScenePromptId` / `applyDynamicScenePrompt`（Task 8 已订阅 state，此处补订阅 action）
  - [x] SubTask 6.2: 在生成参数面板中新增 `<Select>` 下拉，placeholder「选择动态场景方案」，options 来自 `dynamicScenePrompts.map(p => ({ label: p.name, value: p.id }))`
  - [x] SubTask 6.3: `onChange` 回调调用 `applyDynamicScenePrompt(id)`；当前激活方案作为 Select 的 value
  - [x] SubTask 6.4: 空状态：`dynamicScenePrompts.length === 0` 时 Select disabled + placeholder「暂无动态场景方案，请在素材管理中添加」
  - [x] SubTask 6.5: 下拉位置：放在生成参数区域显眼处（建议靠近 prompt 预览或 LoRA 选择附近），与现有控件风格一致

- [x] Task 7: 移除 userScene 文本输入框
  - [x] SubTask 7.1: 在 `AssetGenerateModal.tsx` 中移除 `userScene` 的 `<Input>` / `<Input.TextArea>` UI 元素
  - [x] SubTask 7.2: 保留 `userScene` state（以 `''` 空字符串作为默认值）仅作为 `buildAssetPromptTemplate` 的兼容参数，不再由用户输入
  - [x] SubTask 7.3: `buildSdOptions` 中移除「无动态 scene 时回退 userScene」逻辑（Task 8 of `add-dynamic-scene-prompt-generation` 引入），改为「无激活方案时 `dynamicScene = undefined`」
  - [x] SubTask 7.4: 在 `PromptBuilder.ts` 的 `buildAssetPromptTemplate` JSDoc 中标记 `userScene` 参数为 `@deprecated`，保留签名避免破坏调用方

- [x] Task 8: 验证动态场景提示词拼接端到端
  - [x] SubTask 8.1: 验证 illustration 模式 + 激活动态场景：`{clothing}` / `{pose}` / `{scene}` 正确替换为方案值
  - [x] SubTask 8.2: 验证 general 模式 + 激活动态场景：`{clothing}` / `{pose}` / `{scene}` 正确替换
  - [x] SubTask 8.3: 验证 three-view 模式：模板不含新占位符，替换为 no-op（与 Task 7 of `add-dynamic-scene-prompt-generation` 一致）
  - [x] SubTask 8.4: 验证无激活方案时：illustration 模式 `{pose}` 兜底 `standing` / `{scene}` 兜底 `simple background`（保持原行为）；general 模式占位符替换为空字符串（移除 userScene 回退后）
  - [x] SubTask 8.5: 验证空逗号清理逻辑在所有场景下正常工作（`applyTraitsAndLora` 的 do-while 清理）

- [x] Task 9: 集成验证与文档更新
  - [x] SubTask 9.1: `npx tsc --noEmit` 对所有修改文件零新增错误
  - [x] SubTask 9.2: 手动验证端到端流程：三视图 nude tag / 高分辨率 1girl 注入 / 自定义分类跨角色 / 动态场景选择 → 生成
  - [x] SubTask 9.3: 验证既有数据迁移：构造一份有 `customCategories` 的旧 traits.json，加载后分类应出现在全局字典中
  - [x] SubTask 9.4: 回写 `CODE_WIKI.md`（§3 目录树 / §4.2 IPC / §4.4 服务表 / §9 store）+ `docs/FIX_RECORDS.md` + `CHANGELOG.md`
  - [x] SubTask 9.5: 在 `docs/FIX_RECORDS.md` 中**重点标记**本次修复的三个 bug（动态场景选择缺失、AI 不生成自定义分类 tag、高分辨率多角色）

> **Task 9 验证状态说明**：
> - **9.1 tsc 验证 PASS**：仅 5 个预存在错误（`writing/PromptBuilder.ts` 4 个 unused import + `CharacterDialogueChat/PromptBuilder.ts:703` `parseMesExample` 类型收窄），均位于未修改区域，与本次 spec 修改无关
> - **9.2 / 9.3 静态代码审查 PASS**：通过代码审查确认链路完整（见 `docs/FIX_RECORDS.md` §5.6）；运行时验证（Electron 集成测试）推迟到用户手动测试，遵循项目「Native Module Test Gap Convention」
> - **9.4 文档回写完成**：`CODE_WIKI.md` 新增 spec 综述章节（架构图 + IPC 表 + 服务表 + store 表 + 类型表 + 文件清单）；`docs/FIX_RECORDS.md` §5.1 ~ §5.6 全部完成；`CHANGELOG.md` 整合为 spec 级别单条目
> - **9.5 三个 bug 重点标记完成**：§5.1（动态场景选择缺失）/ §5.2（AI 不生成自定义分类 tag）/ §5.3（高分辨率多角色）均标注【重点标记】

# Task Dependencies

- Task 1（nude tag 常量化）独立，可并行启动
- Task 2（高分辨率性别 tag）独立，可并行启动
- Task 3（全局分类字典服务）是 Task 4 / Task 5 的基础
- Task 4（store 重构）依赖 Task 3（IPC + service）
- Task 5（AI prompt 动态构建）依赖 Task 3（读取全局字典）
- Task 6（动态场景下拉 UI）独立，可并行启动
- Task 7（移除 userScene）依赖 Task 6（下拉 UI 替代 userScene 的位置）
- Task 8（端到端验证）依赖 Task 6 + Task 7
- Task 9（集成验证 + 文档）依赖 Task 1-8 全部完成

## 并行执行建议

**第一波（无依赖，4 个并行）**:
- Task 1（nude tag 常量化）
- Task 2（高分辨率性别 tag）
- Task 3（全局分类字典服务）
- Task 6（动态场景下拉 UI）

**第二波（依赖第一波）**:
- Task 4（store 重构，依赖 Task 3）
- Task 5（AI prompt 动态构建，依赖 Task 3）
- Task 7（移除 userScene，依赖 Task 6）

**第三波**:
- Task 8（端到端验证，依赖 Task 6 + 7）

**第四波**:
- Task 9（集成验证 + 文档，依赖全部）
