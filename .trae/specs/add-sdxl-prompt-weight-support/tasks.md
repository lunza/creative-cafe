# Tasks

- [x] Task 1: 数据模型扩展 — `CharacterTraitItem` / `CategorizedTrait` 新增 `weight` 字段
  - [x] SubTask 1.1: 在 `src/shared/types/characterTrait.types.ts` 的 `CharacterTraitItem` 接口新增 `weight?: number` 字段 + JSDoc（默认 1.0，范围 0.1-10.0，持久化于 manifest）
  - [x] SubTask 1.2: 在同文件 `CategorizedTrait` 接口新增 `weight?: number` 字段 + JSDoc（AI 生成时产出，与 `CharacterTraitItem.weight` 语义一致）
  - [x] SubTask 1.3: 在 `src/main/services/characterTraitService.ts` 的 `normalizeTraitItem` 函数新增 weight 透传 + 范围校验（0.1-10.0，越界兜底 undefined，保留 1 位小数）

- [x] Task 2: SD 生成管线升级 — `SDGenerationOptions` 类型 + `applyTraitsAndLora` 权重格式化
  - [x] SubTask 2.1: 在 `src/main/services/sdGenerationService.ts` 将 `SDGenerationOptions.characterTraits` 类型从 `string[]` 升级为 `Array<{ text: string; weight?: number }>`
  - [x] SubTask 2.2: 在 `applyTraitsAndLora` 方法中，拼接 traits 时对 `weight !== undefined && weight !== 1.0` 的项格式化为 `(text:weight)` 语法；默认权重项保持 `text` 原样
  - [x] SubTask 2.3: 更新 `applyTraitsAndLora` 的去重逻辑（§7.23 §9 修复），去重 key 仍为 `text.trim().toLowerCase()`（不带权重语法），权重不影响去重
  - [x] SubTask 2.4: 更新 `applyTraitsAndLora` 日志输出，记录带权重的 tag 数量便于调试

- [x] Task 3: 前端派生层升级 — `enabledTraitTexts` 类型升级 + `buildSdOptions` 适配
  - [x] SubTask 3.1: 在 `AssetGenerateModal.tsx` 将 `enabledTraitTexts` 从 `string[]` 升级为 `Array<{ text: string; weight?: number }>`，`.map` 时透传 `weight`
  - [x] SubTask 3.2: 在 `buildSdOptions` 中将 `characterTraits: enabledTraitTexts` 适配新类型（透传 weight）
  - [x] SubTask 3.3: 在 `handleGenerateTraitPrompts` 中将 `baseTraits` 拼接改为 `enabledTraitTexts.map(t => t.text).join(', ')`（仅取 text，不带权重语法，避免 LLM 混淆）
  - [x] SubTask 3.4: 在 `ExpressionGenerateModal.tsx` 中适配 `characterTraits` 新类型（透传 weight）
  - [x] SubTask 3.5: 搜索所有使用 `enabledTraitTexts` / `characterTraits` 的位置，确保类型兼容（`.length` 属性仍可用，`.join` 需改为 `.map(t => t.text).join`）

- [x] Task 4: AI 生成适配 — LLM prompt 扩展 + 响应解析支持权重
  - [x] SubTask 4.1: 在 `characterTraitAIService.ts` 的 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` / `buildDynamicTraitSystemPrompt` 中扩展输出格式说明为 `分类:tag|中文翻译|权重`（权重可选，1.0 时可省略）
  - [x] SubTask 4.2: 在 `parseTraitsFromContent` / `parseTraitsAndDescription` 中扩展解析逻辑，支持第三段 `|权重`（正则匹配浮点数，范围 0.1-10.0，越界兜底 undefined）
  - [x] SubTask 4.3: 在 `generateTraitPrompts` 的 `buildTraitPromptUserMessage` 中同步更新格式说明
  - [x] SubTask 4.4: 在 `generateDynamicScenePrompts` 的 LLM prompt 中同步扩展权重输出格式（clothing/pose/scene 每条 tag 可带权重）

- [x] Task 5: 审计环节 weight 处理 — `applyTagAudit` weight 继承策略
  - [x] SubTask 5.1: 在 `applyTagAudit` 中，L4 KNN 替换 tag 时继承原 weight（`trait.weight` 保持不变，仅 `trait.text` 替换为 suggestion.name）
  - [x] SubTask 5.2: 在 L3 颜色拆分时，拆分后的两个 trait weight 均重置为 `undefined`（语义已变化，原权重不适用）
  - [x] SubTask 5.3: 在 L5 AI 兜底替换时，继承原 weight（与 L4 一致）
  - [x] SubTask 5.4: 在手动编辑 trait.text 时，weight 保持不变（编辑文本不影响权重设置，与 originalText 清空策略不同）
  - [x] SubTask 5.5: 验证 `validateTagsAgainstLibrary` 不受 weight 影响（审计基于 tag text，不涉及权重）

- [x] Task 6: Store 层适配 — `characterTraitStore` weight 透传
  - [x] SubTask 6.1: 在 `setTraits` 中透传 `CategorizedTrait.weight` 到 `CharacterTraitItem.weight`（与 translation/originalText 同模式）
  - [x] SubTask 6.2: 在 `saveCombination` / `applyCombination` 中透传 `traitSnapshot` 的 weight 字段（快照机制天然支持，确认无字段丢弃）
  - [x] SubTask 6.3: 在 `updateTrait` action 中确认 weight 不被意外清空（仅 text/translation/originalText 有清空逻辑）

- [x] Task 7: UI 权重编辑 — `AssetGenerateModal` Tag 权重指示器与编辑器
  - [x] SubTask 7.1: 在 `renderTraitsPanel` 的 Tag 渲染区域，为 `weight !== undefined && weight !== 1.0` 的 trait 添加权重徽标（如 `×1.5`，>1.0 暖色橙色 / <1.0 冷色蓝色）
  - [x] SubTask 7.2: 添加权重编辑 Popover（点击权重徽标或 Tag 上的权重按钮触发），含 InputNumber（0.1-10.0，步长 0.1）+ Slider + 「重置为 1.0」按钮
  - [x] SubTask 7.3: 添加 `handleUpdateTraitWeight(traitId, weight)` handler，更新 `editedTraits` 中对应 trait 的 weight（与 `handleConfirmEditTrait` 同模式，仅修改工作副本不回写 store）
  - [x] SubTask 7.4: 在 Tooltip 中追加权重信息（当 weight !== 1.0 时显示「权重：1.5」行，与翻译/拆分信息并列）

- [x] Task 8: UI 权重编辑 — `AssetManagerModal` Tag 权重指示器与编辑器
  - [x] SubTask 8.1: 在 `AssetManagerModal` 的 Tag 渲染区域同步添加权重徽标（与 `AssetGenerateModal` 视觉一致）
  - [x] SubTask 8.2: 添加权重编辑 Popover（复用相同组件结构）
  - [x] SubTask 8.3: 添加 `handleUpdateTraitWeight` handler（更新 store 并持久化，与 `AssetManagerModal` 现有 edit handler 同模式）

- [x] Task 9: 提示词生成面板权重展示 — `renderPromptGenPanel` 结果区适配
  - [x] SubTask 9.1: 在 `renderPromptGenPanel` 的生成结果 Tag 渲染中，为 `weight !== undefined && weight !== 1.0` 的 CategorizedTrait 显示权重徽标
  - [x] SubTask 9.2: 在 `handleApplyGeneratedTraits` 中透传 `CategorizedTrait.weight` 到 `CharacterTraitItem.weight`（转换时携带 weight 字段）

- [x] Task 10: IPC 类型同步 + preload 适配
  - [x] SubTask 10.1: 在 `src/renderer/types/electron.d.ts` 中同步 `generateCharacterTraits` / `generateTraitPrompts` / `recognizeImageTraits` 返回类型中 `traits` 项的 `weight` 字段
  - [x] SubTask 10.2: 在 `src/main/preload.ts` 中确认 IPC 透传无需改动（weight 随 CategorizedTrait[] 结构化对象透传，非独立参数）

- [x] Task 11: 文档增量更新
  - [x] SubTask 11.1: 在 `CODE_WIKI.md` 中更新 `CharacterTraitItem` / `CategorizedTrait` 类型表（新增 weight 字段）
  - [x] SubTask 11.2: 在 `CODE_WIKI.md` 中更新 `applyTraitsAndLora` 描述（补充权重格式化逻辑）
  - [x] SubTask 11.3: 在 `CODE_WIKI.md` 中更新 `SDGenerationOptions.characterTraits` 类型描述（string[] → 结构化数组）
  - [x] SubTask 11.4: 在 `docs/FIX_RECORDS.md` 中新增 §7.24 记录权重功能实现（含 webui-forge-neo 权重语法研究结论 + LLM prompt 格式扩展 + 审计 weight 继承策略）
  - [x] SubTask 11.5: 对所有新增 UI 文案进行专业中文润色（权重徽标 / Popover 标题 / 输入提示 / 错误信息）

# Task Dependencies

- Task 2 depends on Task 1（SDGenerationOptions 类型升级依赖 CharacterTraitItem 新增 weight 字段）
- Task 3 depends on Task 2（前端 enabledTraitTexts 升级依赖 SDGenerationOptions 类型升级）
- Task 4 depends on Task 1（AI 生成 weight 依赖 CategorizedTrait 新增 weight 字段）
- Task 5 depends on Task 1 + Task 4（审计 weight 处理依赖数据模型 + AI 生成格式）
- Task 6 depends on Task 1（Store 透传依赖数据模型）
- Task 7 depends on Task 3 + Task 6（UI 权重编辑依赖前端派生层 + Store 适配）
- Task 8 depends on Task 6（AssetManagerModal 权重编辑依赖 Store 适配）
- Task 9 depends on Task 4 + Task 7（提示词生成面板依赖 AI 生成适配 + UI 组件模式）
- Task 10 depends on Task 1 + Task 4（IPC 类型同步依赖数据模型 + AI 生成格式）
- Task 11 depends on Task 1-10（文档更新依赖所有代码改动完成）
- Task 1 可独立先行；Task 4 可与 Task 2/3 并行（不同文件）；Task 7/8 可并行（不同组件）
