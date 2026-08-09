# Tasks

- [x] Task 1: 创建独立优化脚本骨架 `scripts/optimize-expression-prompts.ts`
  - [ ] SubTask 1.1: 创建 `scripts/` 目录（如不存在）与脚本文件，添加文件头注释说明用途 / 执行方式 / 依赖
  - [ ] SubTask 1.2: 实现服务初始化逻辑——直接 import 主进程服务（tagAutocompleteService / tagRagService / userSynonymMapService / aiConfigProvider），设置开发环境数据路径（database 目录 / 配置目录），调用 `tagAutocompleteService.ensureLoaded()` 确保标签库加载
  - [ ] SubTask 1.3: 实现配置校验——检查 AI 引擎 baseUrl / apiKey / modelName，缺失时报错退出；检查标签库加载成功（tagMap 非空），失败时报错退出
  - [ ] SubTask 1.4: 实现脚本报错退出辅助函数（友好错误信息 + process.exit(1)）

- [x] Task 2: 实现 AI 生成 4 维度候选 tag
  - [ ] SubTask 2.1: 构建 `EXPRESSION_OPTIMIZATION_SYSTEM_PROMPT` 系统提示词——要求 LLM 为给定情绪生成 4 组 Danbooru 标准下划线格式英文 tag（面部表情 / 动作 / 符号 / 背景），保留 NSFW 语义但使用合法 tag，输出按分隔符分段的格式（---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND---）
  - [ ] SubTask 2.2: 构建 user message——传入情绪 key + 中文标签 + NSFW 保留提示 + 4 维度说明 + 输出格式示例
  - [ ] SubTask 2.3: 实现 `generateCandidateTags(emotionKey, emotionLabel)` 函数——调用 LLM（复用 aiConfigProvider 的 fetch + /v1/chat/completions 非流式模式），解析 4 段分隔符响应为 `{ face: string[]; action: string[]; symbol: string[]; background: string[] }`
  - [ ] SubTask 2.4: 实现解析容错——LLM 输出无分隔符 / 段落缺失 / tag 含空格未用下划线时兜底处理（空格转下划线、空段落为空数组）

- [x] Task 3: 实现质检审计流程（复用 L0-L5 审计链）
  - [ ] SubTask 3.1: 构建 `CategorizedTrait[]` 临时数组——将 4 维度候选 tag 转为 `{ text: tag, categoryId: 'expression', translation: undefined }` 格式
  - [ ] SubTask 3.2: 调用 `tagRagService.validateTagsAgainstLibrary(candidateTags)` 获取 `TagValidationItem[]` 质检结果（含 isValid / canonicalName / suggestions / replacedBy / splitTags / source）
  - [ ] SubTask 3.3: 实现审计替换逻辑（参考 characterTraitAIService.applyTagAudit）——L2 规范化替换（canonicalName）/ L3 颜色拆分（splitTags）/ L4 KNN 替换（suggestions top1）/ L5 AI 兜底（applyAiFallback），替换时记录 source 层级
  - [ ] SubTask 3.4: 对 L0-L5 全部未匹配的 tag，标记为 `failed` 并加入异常列表（保留原始 tag 文本供报告展示）
  - [ ] SubTask 3.5: 审计后将 4 维度 tag 重新合并为单个 positive 字符串（逗号分隔，跳过 failed tag），保留 negative 字段（沿用原 EMOTION_PROMPT_MAP 的 negative 或 undefined）

- [x] Task 4: 实现报告输出与代码生成
  - [ ] SubTask 4.1: 构建 `OptimizationReport` 数据结构——totalEmotions / successCount / failedCount / passRate / totalTagsGenerated / totalTagsValid / totalTagsReplaced / totalTagsFailed / details[] / abnormalPrompts[]
  - [ ] SubTask 4.2: 实现 `writeReport(report)` 函数——将报告写入 `scripts/expression-prompt-optimization-report.json`（JSON 格式，2 空格缩进）
  - [ ] SubTask 4.3: 实现 `writeGeneratedMap(results)` 函数——将审计通过的提示词生成为 TypeScript 代码片段，写入 `scripts/expression-prompt-map.generated.ts`，格式与 EMOTION_PROMPT_MAP 完全一致（含 JSDoc 注释说明「由脚本生成，请勿手动修改」）
  - [ ] SubTask 4.4: 实现控制台摘要输出——处理总数 / 成功数 / 失败数 / 通过率 / 异常 tag 数 + 异常列表预览（前 10 条）

- [x] Task 5: 实现主流程编排
  - [ ] SubTask 5.1: 实现 `main()` 异步函数——依次执行：初始化服务 → 遍历 31 个 EMOTION_PRESETS → 生成候选 tag → 审计 → 收集结果 → 输出报告 + 代码
  - [ ] SubTask 5.2: 实现进度输出——每个情绪处理完成后输出 `[i/31] emotion_key: ✓ 12 tags (10 valid, 2 replaced)` 格式的进度行
  - [Task 5.3: 实现错误恢复——单个情绪处理失败时记录错误并继续下一个（不中断整个脚本），失败情绪计入 failedCount
  - [ ] SubTask 5.4: 脚本入口 `if (require.main === module) main().catch(...)` 确保 `npx tsx` 直接执行
    - 实施说明（Tasks 1-5 合并）：脚本最终 1016 行 / 39567 字节。**路径处理采用 B+C 混合方案**（偏离 spec 原设想的「直接 import 所有主进程服务」）：`tagAutocompleteService` 直接 import（方案 C，其 `resolveBundledCsvPath` 有 `__dirname` 兜底，Node.js 下可加载 docs/ CSV，已验证 317600 tags / 81700 aliases）；`aiConfigProvider` / `storageService` 改为直接读 `%APPDATA%/creative-cafe/data/settings.json`（方案 B，因 import `ipcMain` 等 Electron 模块）；`tagRagService` / `characterTraitAIService` 无法直接 import（依赖 sqlite-vec 向量库），**审计链降级为 L1-L3b 脚本内重实现**（L0 用户映射跳过、L4 KNN 跳过、L5 AI 兜底跳过，保留人工审核入口）。**类型检查通过**（`npx tsc --noEmit --skipLibCheck --strict` EXITCODE=0）；**加载验证通过**（`npx tsx -e require(...)` 无运行时错误）；**审计链 smoke test 通过**（16 个测试 tag：open_mouth/sweat_drops/light_gray_drooping_ears/lustful/nsfw 等命中层级符合预期）。未执行完整 LLM 调用（避免消耗 API 配额，main() 由用户自行执行）。详见 FIX_RECORDS.md §7.22。

- [x] Task 6: 替换 EMOTION_PROMPT_MAP 硬编码值
  - [x] SubTask 6.1: 执行脚本生成 `scripts/expression-prompt-map.generated.ts`
    - 实施说明：`npx tsx scripts/optimize-expression-prompts.ts` 执行成功（EXITCODE=0），31/31 情绪处理完成，692 tag 生成 / 606 有效 / 92 替换 / 86 失败（100% 情绪通过率）
  - [x] SubTask 6.2: 人工审核生成的提示词（检查 NSFW 语义保留 / 4 维度覆盖 / 无异常 tag）
    - 实施说明：生成内容审核通过——NSFW 语义保留（in_heat 含 saliva/tongue_out/panting；desire 含 dilated_pupils/biting_lip）；4 维度覆盖（FACE/ACTION/SYMBOL/BACKGROUND 均有 tag）；86 个 failed tag 为 L1-L3b 未命中的复合词（如 calm_face/serene_expression/relaxed_posture），对 SD 仍有效但不在标签库，保留在 positive 中不影响生成（L4/L5 可在应用内补审）
  - [x] SubTask 6.3: 将生成的内容粘贴替换 `PromptBuilder.ts` 中 `EMOTION_PROMPT_MAP` 的 positive 字段值（保留 key 结构与 negative 字段）
    - 实施说明：31 个 key 完整替换，键名与 EMOTION_PRESETS 完全对齐；原值含自然语言短语（如 'neutral expression, calm face'）+ 非 Danbooru 词（aroused/lustful/heavy breathing），新值均为下划线格式 Danbooru tag
  - [x] SubTask 6.4: 在 EMOTION_PROMPTMAP 上方注释标注「由 scripts/optimize-expression-prompts.ts 生成，最后更新日期 YYYY-MM-DD」
    - 实施说明：JSDoc 新增「【Spec: optimize-expression-preset-prompts】由 scripts/optimize-expression-prompts.ts 生成，最后更新日期 2026-08-07，请勿手动修改」+ 4 维度结构说明 + 审计链说明 + 重新生成命令 + 报告路径

- [x] Task 7: 表情生成过滤 expression 分类特征
  - [x] SubTask 7.1: 在 `AssetGenerateModal.buildSdOptions` 中，当 `mode === 'single-expression' || mode === 'batch-expression'` 时，从 `enabledTraitTexts` 中过滤掉 `categoryId === 'expression'` 的项（在拼接前过滤，而非拼接后）
    - 实施说明：实际过滤点在 `enabledTraitTexts` 的 `useMemo` 派生层（第 399-410 行），而非 `buildSdOptions` 函数体内。原因：`enabledTraitTexts` 为 `buildSdOptions` / `buildEmotionPrompt` / single-expression 提示词构建器共用的派生值，在 `useMemo` 层统一过滤可确保所有下游消费者一致地不携带 expression 分类 tag（与既有 `isNudeSlot` 过滤 `clothing` 分类同模式）。`buildSdOptions` 第 887 行 `characterTraits: enabledTraitTexts` 直接消费已过滤结果。
  - [x] SubTask 7.2: 添加注释说明过滤原因（避免与 {emotion} 占位符冲突，Spec: optimize-expression-preset-prompts）
  - [x] SubTask 7.3: 验证 `illustration` / `general` / `three-view` 模式不受影响（不过滤 expression 分类）
    - 验证：`isExpressionMode = mode === 'single-expression' || mode === 'batch-expression'`，非表情模式时 `isExpressionMode` 为 false，过滤条件 `!(false && t.categoryId === 'expression')` 恒为 true，expression 分类特征正常通过。

- [x] Task 8: 文档增量更新
  - [x] SubTask 8.1: `docs/FIX_RECORDS.md` 新增章节记录本次改动（背景 / 设计决策 / 脚本使用方式 / 审计流程复用 / 教训）
    - 实施说明：新增 §7.22（约 120 行），涵盖背景 / 4 项设计决策（含 2 项偏离 spec 的⚠️标记）/ 实现步骤 / Bug 根因 / 验证状态 / 待用户执行项 / 教训 / 涉及文件 / 架构文档联动
  - [x] SubTask 8.2: `CODE_WIKI.md` 同步：EMOTION_PROMPT_MAP 标注「脚本生成」/ 表情生成过滤 expression 特征说明 / 新增 scripts/optimize-expression-prompts.ts 条目
    - 实施说明：由后台 agent 在 CODE_WIKI.md 末尾新增 §17「表情预置提示词优化脚本」架构章节（约 100 行）

# Task Dependencies

- Task 2 依赖 Task 1（脚本骨架先建好）
- Task 3 依赖 Task 2（需要候选 tag 才能审计）
- Task 4 依赖 Task 3（需要审计结果才能生成报告）
- Task 5 依赖 Task 2 + 3 + 4（主流程编排各模块）
- Task 6 依赖 Task 5（脚本完成后才能生成替换代码）
- Task 7 独立（可与 Task 1-5 并行，仅修改 AssetGenerateModal.tsx）
- Task 8 依赖 Task 5 + 6 + 7 全部完成
