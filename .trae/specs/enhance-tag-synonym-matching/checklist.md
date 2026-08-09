# Checklist

## alias 反向索引（Task 1）
- [x] `tagAutocompleteService` 新增 `aliasMap` 字段，类型 `Map<string, TagInfo>`
- [x] `loadInternal` 在 `tagMap.set` 之后遍历 `parsed.aliases` 构建 `aliasMap`，key 为 `alias.toLowerCase()`
- [x] alias 冲突策略实现正确：同 alias 被多个 tag 标注时保留 `count` 更高的 tag（不直接覆盖）
- [x] `loadInternal` 开头同步 `aliasMap.clear()`（reload 场景无残留）
- [x] 新增 `getTagByAlias(alias)` 方法，大小写不敏感，未加载/空串返回 null
- [x] 加载完成日志输出 aliasMap 大小

## 颜色剥离 + 分层匹配（Task 2）
- [x] 新增 `COLOR_MODIFIER_PREFIXES` 常量，含亮度修饰词 + 基础颜色两组
- [x] 新增 `stripColorModifier(tag)` 函数：兼容空格/下划线，剥离后核心词为空或与原 tag 相同时返回空串
- [x] `SUGGESTION_MIN_SCORE` 从 0.25 改为 0.15
- [x] `validateTagsAgainstLibrary` 实现四层降级链：L1 name → L2 alias → L3 颜色剥离 → L4 语义 KNN
- [x] L2 alias 匹配复用 L1 的空格↔下划线互转逻辑
- [x] L3 颜色剥离后核心词同时查 name 和 alias（两种格式转换）
- [x] 任一层命中即标记 `isValid=true` 并记录 `canonicalName`、`category`、`count`
- [x] 评级词（nsfw/safe/explicit 等）仍标记 `skipReason='rating'`，位置在 L1-L3 全部未命中后
- [x] L4 语义 KNN suggestion 第二遍遍历逻辑保持不变，仅阈值降低生效

## 用户反馈 tag 命中验证（核心验收）
- [x] `light gray hair` → 命中 `grey_hair`（L2 alias）
- [x] `light gray drooping ears` → 命中 `drooping_ears`（L3 颜色剥离后 name）
- [x] `light gray beanie` → 命中 `beanie`（L3 颜色剥离后 name）
- [x] `black eyelashes` → 命中 `eyelashes`（L2 alias）
- [x] `slender` → 命中 `slim`（L2 alias）
- [x] `light gray short tail` → 命中 `short_tail`（L3 颜色剥离后 name）
- [x] `light gray open hoodie` → 命中 `open_hoodie`（L3 颜色剥离后 name）

## 不误伤现有行为
- [x] 原本 L1 name 命中的 tag（如 `blue eyes`、`long_hair`）仍走 L1，不进入 L2/L3
- [x] 颜色剥离不误伤本身就是有效 name 的 tag（如 `black tie` 若 L1 已命中则不进 L3）
- [x] `getTagByName` 行为不变（L1 name 匹配保持原状，无 BREAKING）

## 单元测试（Task 3）
- [x] aliasMap 构建测试：同义词命中、大小写不敏感、冲突保留 count 高、reload 清空重建
- [x] `stripColorModifier` 测试：颜色前缀剥离、不可剥离返回空、下划线格式兼容
- [x] `validateTagsAgainstLibrary` 测试：7 个反馈 tag 全部命中（mock tagMap + aliasMap，不依赖真实 CSV/原生模块）
- [x] 测试文件顶部标注「真实行为依赖 Electron 集成测试」（原生模块测试盲区约定）

## 文档（Task 4）
- [x] `docs/FIX_RECORDS.md` 追加小节：根因 + 修复方案 + 7 个 tag 验证结果
- [x] `CODE_WIKI.md` 服务表 / §7.12 补一行架构描述 + 指向 FIX_RECORDS.md 链接
