# Checklist

- [x] `splitColorTag` 函数正确实现：light gray drooping ears → { baseColor: grey, feature: drooping_ears, partWord: ears, colorPartTag: grey_ears }
- [x] `splitColorTag` 对非颜色 tag（slender）返回 null；对纯颜色词（black）返回 null
- [x] `splitColorTag` 颜色归一化：gray→grey、blond→blonde；亮度词（light/dark）丢弃
- [x] `validateTagsAgainstLibrary` 返回类型含 `splitTags?: { colorPartTag, featureTag }` 字段
- [x] L3 拆分两条都命中时设 splitTags；仅 feature 命中时退化为当前剥离行为（无 splitTags）
- [x] `characterTraitAIService` 替换循环：splitTags 存在时原 trait 替换为 featureTag + 新增 colorPartTag trait（复制 categoryId）
- [x] 新增 colorPartTag trait 为 CategorizedTrait（无 id），由 store setTraits 分配 id
- [x] `ragDebug.tagValidation` 透传 splitTags 到前端
- [x] RagQualityReport 有 splitTags 的项显示「已拆分：tag → colorPartTag + featureTag」+ 蓝色 🔄 + 撤销按钮
- [x] `onRevertTrait` 签名扩展为 `(originalTag, replacedBy, splitColorTag?)`
- [x] `handleRevertTrait` 撤销拆分时删除 colorPartTag trait（removeTrait）+ 还原 featureTag 为 originalTag
- [x] tsc 类型检查通过（5 个修改文件无新错误）
- [x] vitest 全部测试通过（含新增 splitColorTag + L3 拆分测试）
- [x] docs/FIX_RECORDS.md 追加 §7.15 记录 L3 颜色拆分重构
- [x] CODE_WIKI.md 对应章节补架构描述
- [x] 验证脚本 verify-color-split.mjs 已清理（功能固化到测试）
