# 标签同义词匹配增强 Spec

## Why

当前 `validateTagsAgainstLibrary` 只按 tag `name` 匹配（`getTagByName`），**完全未利用 CSV 自带的 `aliases` 字段**。经核实，CSV aliases 已包含大量同义词/变体映射，且覆盖用户反馈的全部匹配不上的 tag：

- `slender` → `slim` 的 alias（`slim` 别名：`lanky,lithe,slender,slender_body,thin`）
- `light_gray_hair` → `grey_hair` 的 alias（`grey_hair` 别名含 `light_gray_hair,light_grey_hair`）
- `black_eyelashes` → `eyelashes` 的 alias（`eyelashes` 别名含 `black_eyelashes`）

因为没查 alias，这些 tag 全部显示「无匹配结果」（`skipReason='no_suggestion'`），标签纠错自动替换功能失效。本 spec 通过构建 alias 反向索引 + 颜色剥离分层匹配，实现「一劳永逸」的同义词替换——**无需手动维护任何同义词表，CSV 自带的 alias 即最权威映射源**。

## What Changes

- **tagAutocompleteService**：加载 CSV 时额外构建 `aliasMap`（`alias.toLowerCase()` → `TagInfo` 反向索引），新增 `getTagByAlias(alias)` 方法。冲突策略：同 alias 被多个 tag 标注时保留 `count` 更高的。
- **tagRagService.validateTagsAgainstLibrary**：重构为分层匹配链：
  - **L1 name 精确匹配**（已有）：name + 空格/下划线互转
  - **L2 alias 精确匹配**（新增）：alias + 空格/下划线互转 ← **核心，解决 slender/light_gray_hair/black_eyelashes**
  - **L3 颜色/修饰词剥离 + 核心词匹配**（新增）：剥离 `light gray` 等颜色前缀后，用核心词查 name 和 alias ← **解决 light gray drooping ears 等未被 alias 覆盖的复合 tag**
  - **L4 语义 KNN 兜底**（已有，阈值降低）：`SUGGESTION_MIN_SCORE` 从 0.25 → 0.15
- 新增 `COLOR_MODIFIER_PREFIXES` 常量（~25 个 Danbooru 常见颜色/修饰词），用于 L3 剥离。

## Impact

- **Affected code**：
  - `src/main/services/tagAutocompleteService.ts` — aliasMap 构建 + `getTagByAlias` 方法
  - `src/main/services/tagRagService.ts` — `COLOR_MODIFIER_PREFIXES` 常量 + `stripColorModifier` 函数 + `validateTagsAgainstLibrary` 分层匹配重构
- **内存**：aliasMap 约 80-100 万条目，增加 ~50-80MB（与 tagMap 同级，可接受）
- **加载时间**：CSV 加载从 ~1-2s 增至 ~2-3s（额外遍历 alias 构建索引，一次性成本）
- **行为变更**：invalid tag 的 suggestion 命中率预期从 ~0% → 80%+；原本显示「无匹配」的 tag 大部分能找到替换
- **无 BREAKING**：aliasMap 是新增能力，L1 name 匹配保持不变，已有行为不退化

## ADDED Requirements

### Requirement: Alias 反向索引

系统 SHALL 在标签库加载时构建 `aliasMap`（`Map<alias.toLowerCase(), TagInfo>`），使标签验证能按 alias 查找，不仅按 name。

- 加载流程：`loadInternal` 解析每个 tag 的 `aliases` 数组后，对每个 alias 执行 `aliasMap.set(alias.toLowerCase(), tag)`
- 冲突策略：同一 alias 被多个 tag 标注时，保留 `count` 更高的 tag（count 高 = 训练样本多 = 更主流）
- 新增 `getTagByAlias(alias: string): TagInfo | null`：大小写不敏感查找 aliasMap

#### Scenario: 同义词 tag 通过 alias 匹配
- **WHEN** AI 生成 `slender`（不在任何 tag 的 name 中，但在 `slim` 的 alias 中）
- **THEN** `validateTagsAgainstLibrary` 通过 L2 aliasMap 命中 `slim`，标记 `isValid=true`，`canonicalName='slim'`

#### Scenario: 颜色变体 tag 通过 alias 匹配
- **WHEN** AI 生成 `light gray hair`，格式转换为 `light_gray_hair`（不在 name 但在 `grey_hair` 的 alias 中）
- **THEN** L2 aliasMap 命中 `grey_hair`，`isValid=true`，`canonicalName='grey_hair'`

### Requirement: 颜色/修饰词剥离核心词匹配

系统 SHALL 在 L1 name + L2 alias 精确匹配均失败后，尝试剥离颜色/修饰词前缀，用核心词重新查 name 和 alias。

- `COLOR_MODIFIER_PREFIXES`：亮度修饰词（light/dark/pale/bright/deep/neon/pastel/vivid/dull）+ 基础颜色（gray/grey/black/white/brown/blonde/blond/red/blue/green/pink/purple/yellow/orange/silver/gold/cyan/magenta）
- 剥离策略：从 tag 开头剥离「可选亮度修饰 + 基础颜色」组合（如 `light gray`、`dark brown`、`black`），剩余部分作为核心词
- 剥离后核心词需非空且与原 tag 不同，才进行 name/alias 匹配

#### Scenario: 颜色复合 tag 剥离后核心词命中 name
- **WHEN** AI 生成 `light gray drooping ears`，`light_gray_drooping_ears` 不在 name/alias 中
- **THEN** L3 剥离 `light gray` → 核心词 `drooping_ears` → name 精确匹配命中

#### Scenario: 颜色复合 tag 剥离后核心词命中 alias
- **WHEN** AI 生成 `light gray open hoodie`，`light_gray_open_hoodie` 不在 name/alias 中，剥离后核心词 `open_hoodie` 在 name 中
- **THEN** L3 核心词 name 匹配命中 `open_hoodie`

## MODIFIED Requirements

### Requirement: validateTagsAgainstLibrary 分层匹配

原实现（§7.12）：L1 name 精确 + 空格/下划线互转 → 评级词跳过 → 其余 invalid 走语义 KNN suggestion（minScore=0.25）。

修改为四层降级匹配链，任一命中即标记 `isValid=true` 并记录 `canonicalName`，全部失败才走 L4 语义 KNN suggestion：

1. **L1 name 精确**：`getTagByName(tag)` + 空格→下划线 + 下划线→空格（已有，不变）
2. **L2 alias 精确**：`getTagByAlias(tag)` + 同样格式转换（新增）
3. **L3 颜色剥离**：`stripColorModifier(tag)` 得核心词 → `getTagByName(核心词)` + `getTagByAlias(核心词)` + 格式转换（新增）
4. **L4 语义 KNN 兜底**：`searchRelevantTags({ query: tag, topK: 3, minScore: 0.15 })`（阈值从 0.25 降至 0.15）

评级词（nsfw/safe/explicit 等）仍标记 `skipReason='rating'` 跳过，不进入匹配链。

## 待 Electron 集成测试验证

- aliasMap 构建后内存增量是否可接受（预期 ~50-80MB）
- CSV 加载时间增量是否可接受（预期 +1s）
- 用户反馈的 7 个 tag 全部能匹配：`light gray hair`→grey_hair、`light gray drooping ears`→drooping_ears、`light gray beanie`→beanie、`black eyelashes`→eyelashes、`slender`→slim、`light gray short tail`→short_tail、`light gray open hoodie`→open_hoodie
- 颜色剥离不误伤有效 tag（如 `black tie` 若本身就是有效 tag，L1 已命中不会进 L3）
