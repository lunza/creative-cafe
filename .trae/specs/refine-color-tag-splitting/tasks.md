# Tasks

- [x] Task 1: tagRagService 新增 splitColorTag 函数 + L3 颜色拆分重构
  - [x] SubTask 1.1: 新增 `COLOR_NORMALIZE` 常量映射（`gray`→`grey`、`blond`→`blonde`），放在现有颜色常量附近
  - [x] SubTask 1.2: 新增 `splitColorTag(tag: string)` 函数：复用现有 `BRIGHTNESS`/`COLOR` 常量识别颜色前缀，归一化颜色，提取 feature/partWord/colorPartTag，返回 `{ baseColor, feature, partWord, colorPartTag } | null`
  - [x] SubTask 1.3: `validateTagsAgainstLibrary` 返回类型新增 `splitTags?: { colorPartTag: string; featureTag: string }` 字段
  - [x] SubTask 1.4: 重构 L3 分支：调 `splitColorTag` → 分别查 colorPartTag 与 feature 的 name/alias（含空格/下划线互转）→ 按规则设 isValid/canonicalName/splitTags（两条都命中才设 splitTags；仅 feature 命中退化为当前行为）
  - [x] SubTask 1.5: 保留 `stripColorModifier` 不删除（被 splitColorTag 概念覆盖，现有测试仍验证剥离行为）

- [x] Task 2: characterTraitAIService 替换循环新增颜色拆分场景
  - [x] SubTask 2.1: `GenerateCharacterTraitsResult.ragDebug.tagValidation` 类型新增 `splitTags?: { colorPartTag: string; featureTag: string }` 字段（透传 validation 结果）
  - [x] SubTask 2.2: 替换循环在「场景2 valid 规范化」之前新增「场景1 颜色拆分」：`v.splitTags` 存在时，原 trait.text 替换为 featureTag，`traits.push({ text: colorPartTag, categoryId: trait.categoryId })`，设 `v.replacedBy = featureTag`
  - [x] SubTask 2.3: 日志补充拆分计数（`自动拆分 N 个颜色复合 tag`）

- [x] Task 3: 前端 RagQualityReport 展示拆分 + onRevertTrait 签名扩展
  - [x] SubTask 3.1: `RagQualityReportProps.onRevertTrait` 签名扩展为 `(originalTag: string, replacedBy: string, splitColorTag?: string) => void`
  - [x] SubTask 3.2: tagValidation item 类型新增 `splitTags?: { colorPartTag: string; featureTag: string }`
  - [x] SubTask 3.3: 有 splitTags 的项显示蓝色 🔄 + 文案「已拆分：tag → colorPartTag + featureTag」；tooltip 区分拆分/规范化/语义替换；撤销按钮传 `item.splitTags?.colorPartTag`

- [x] Task 4: AssetManagerModal handleRevertTrait 撤销颜色拆分
  - [x] SubTask 4.1: `handleRevertTrait` 签名扩展接收 `splitColorTag?: string`
  - [x] SubTask 4.2: splitColorTag 存在时，找到 `text === splitColorTag` 的 trait 调 `removeTrait` 删除（store 已有 removeTrait）
  - [x] SubTask 4.3: 还原 featureTag 为 originalTag（现有 updateTrait 逻辑保留）；ragDebug 清除对应项的 replacedBy 与 splitTags
  - [x] SubTask 4.4: 撤销提示文案区分（拆分撤销 vs 规范化撤销）

- [x] Task 5: 单元测试 + 文档更新
  - [x] SubTask 5.1: `tagRagService.test.ts` 新增 `splitColorTag` 测试（light gray drooping ears→grey_ears+drooping_ears、slender→null、black→null、blue eyes→blue_eyes+eyes）
  - [x] SubTask 5.2: `validateTagsAgainstLibrary` 测试新增颜色拆分场景（mock tagMap/aliasMap 含 grey_ears+drooping_ears → splitTags 两条都命中；仅 feature 命中 → 无 splitTags）
  - [x] SubTask 5.3: tsc 类型检查通过 + 全部 vitest 测试通过
  - [x] SubTask 5.4: `docs/FIX_RECORDS.md` 追加新小节（§7.15）记录 L3 颜色拆分重构（根因/方案/验证脚本结论/拆分结果表）；`CODE_WIKI.md` 对应章节补一行架构描述
  - [x] SubTask 5.5: 清理验证脚本 `verify-color-split.mjs`（功能已固化到测试，避免根目录残留临时文件）

# Task Dependencies

- Task 2 依赖 Task 1（splitTags 字段必须先在 validation 返回类型中存在）
- Task 3 依赖 Task 1（splitTags 类型）+ Task 2（ragDebug 透传）
- Task 4 依赖 Task 3（onRevertTrait 签名扩展）
- Task 5 依赖 Task 1-4
