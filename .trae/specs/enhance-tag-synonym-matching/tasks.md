# Tasks

- [x] Task 1: tagAutocompleteService 构建 alias 反向索引
  - [x] SubTask 1.1: 在 `TagAutocompleteService` 类中新增 `private aliasMap: Map<string, TagInfo> = new Map()` 字段
  - [x] SubTask 1.2: 在 `loadInternal` 中 `this.tagMap.set(...)` 之后，遍历 `parsed.aliases` 对每个 alias 执行 `aliasMap.set(alias.toLowerCase(), parsed)`；冲突策略：若 aliasMap 已存在同 key 且现有 tag 的 `count` 更高则不覆盖（保留 count 高的）
  - [x] SubTask 1.3: 在 `loadInternal` 开头 `this.tagMap.clear()` 旁边同步 `this.aliasMap.clear()`（reload 场景避免残留）
  - [x] SubTask 1.4: 新增 `getTagByAlias(alias: string): TagInfo | null` 方法，大小写不敏感查找 aliasMap（逻辑与 `getTagByName` 对齐：未加载或空串返回 null，否则 `aliasMap.get(alias.toLowerCase()) ?? null`）
  - [x] SubTask 1.5: 加载完成日志补充 aliasMap 大小（`tags=${count}, aliases=${this.aliasMap.size}`），便于排查索引构建情况

- [x] Task 2: tagRagService 新增颜色剥离 + 分层匹配重构
  - [x] SubTask 2.1: 在 `tagRagService.ts` 顶部（`RATING_TAGS` 附近）新增 `COLOR_MODIFIER_PREFIXES` 常量数组：亮度修饰词（light/dark/pale/bright/deep/neon/pastel/vivid/dull）+ 基础颜色（gray/grey/black/white/brown/blonde/blond/red/blue/green/pink/purple/yellow/orange/silver/gold/cyan/magenta）
  - [x] SubTask 2.2: 新增 `stripColorModifier(tag: string): string` 函数：从 tag 开头剥离「可选亮度修饰 + 基础颜色」组合（正则 `^(?:亮度词\s+)?(?:基础颜色)\s+`，空格/下划线均兼容），返回剩余核心词；剥离后为核心词为空或与原 tag 相同时返回空串（表示不可剥离）
  - [x] SubTask 2.3: 将 `SUGGESTION_MIN_SCORE` 从 `0.25` 改为 `0.15`（L4 语义 KNN 兜底阈值降低，让近义词也能进入 suggestion）
  - [x] SubTask 2.4: 重构 `validateTagsAgainstLibrary` 第一遍精确匹配循环为四层降级链：L1 name（保留原有 name + 空格/下划线互转）→ L2 alias（新增，`getTagByAlias` + 同样的空格/下划线互转）→ L3 颜色剥离（`stripColorModifier(tag)` 得核心词后查 name 和 alias + 格式转换）→ 任一命中即 `isValid=true` 并记录 `canonicalName`，全部失败才走原有的评级词判断 + needSuggestion 占位
  - [x] SubTask 2.5: 评级词判断（`RATING_TAGS.has`）位置不变，仍仅在 L1-L3 全部未命中后才触发；L4 语义 KNN suggestion 遍历逻辑（第二遍）保持不变，仅阈值随 SubTask 2.3 调整生效

- [x] Task 3: 单元测试覆盖新匹配逻辑
  - [x] SubTask 3.1: 在 `src/main/services/__tests__/` 下新增或扩展 `tagAutocompleteService` 测试，验证 `aliasMap` 构建与 `getTagByAlias`：同义词命中（slender→slim）、大小写不敏感、冲突时保留 count 高的 tag、reload 后 aliasMap 清空重建
  - [x] SubTask 3.2: 在 `tagRagService.test.ts` 或新增测试文件中验证 `stripColorModifier`：`light gray drooping ears`→`drooping ears`、`black eyelashes`→`eyelashes`、`slender`→``（不可剥离返回空）、`blue eyes`→`eyes`（颜色在开头时剥离）
  - [x] SubTask 3.3: 验证 `validateTagsAgainstLibrary` 用户反馈的 7 个 tag 全部命中（用 mock tagAutocompleteService 注入 minimal tagMap + aliasMap，避免依赖真实 CSV 与原生向量模块；测试文件顶部标注「真实行为依赖 Electron 集成测试」）

- [x] Task 4: 文档增量更新
  - [x] SubTask 4.1: 在 `docs/FIX_RECORDS.md` 追加新小节，记录「标签同义词匹配增强」根因（未利用 CSV aliases 字段）+ 修复方案（aliasMap + 颜色剥离分层匹配）+ 用户反馈的 7 个 tag 验证结果
  - [x] SubTask 4.2: 在 `CODE_WIKI.md` 对应章节（§4.4 服务表 tagAutocompleteService 行 / §7.12 validateTagsAgainstLibrary 描述）补一行架构性描述 + 指向 FIX_RECORDS.md 的链接，避免架构章节失真

# Task Dependencies

- Task 2 依赖 Task 1（`getTagByAlias` 必须先存在，validateTagsAgainstLibrary 才能调用）
- Task 3 依赖 Task 1 + Task 2（测试新方法与新匹配链）
- Task 4 依赖 Task 1 + Task 2 + Task 3（文档记录实现结果与验证结论）
- Task 1 与 Task 2 的 SubTask 2.1/2.2（颜色剥离常量与函数，不依赖 aliasMap）可并行
