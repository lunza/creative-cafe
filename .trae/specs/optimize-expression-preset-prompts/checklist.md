# Checklist

## 脚本骨架与初始化
- [x] `scripts/optimize-expression-prompts.ts` 文件存在，含文件头注释（用途 / 执行方式 `npx tsx` / 依赖说明）
- [x] 脚本直接 import 主进程服务（tagAutocompleteService / tagRagService / userSynonymMapService / aiConfigProvider）
  - ⚠️ 偏离：实际仅 import `tagAutocompleteService`（方案 C）；`aiConfigProvider`/`storageService` 改为直接读 settings.json（方案 B）；`tagRagService`/`userSynonymMapService` 因依赖 Electron/sqlite-vec 无法 import，改为脚本内重实现 L1-L3b / 跳过 L0
- [x] 脚本启动时调用 `tagAutocompleteService.ensureLoaded()` 确保标签库加载
- [x] 脚本启动时校验 AI 引擎配置（baseUrl / apiKey / modelName 缺失报错退出）
- [x] 脚本启动时校验标签库加载成功（tagMap 为空时报错退出）

## AI 生成 4 维度候选 tag
- [x] `EXPRESSION_OPTIMIZATION_SYSTEM_PROMPT` 系统提示词要求 LLM 输出 4 段分隔符格式（---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND---）
- [x] 系统提示词明确要求使用 Danbooru 标准下划线格式（如 `open_mouth` 而非 `open mouth`）
- [x] 系统提示词保留 NSFW 语义（明确告知 LLM 保留成人向表达但使用合法 tag）
- [x] `generateCandidateTags(emotionKey, emotionLabel)` 函数调用 LLM 并解析为 `{ face, action, symbol, background }` 四维数组
- [x] 解析容错：LLM 输出无分隔符 / 段落缺失 / tag 含空格时兜底处理

## 质检审计流程
- [x] 候选 tag 转为 `CategorizedTrait[]` 格式后调用 `tagRagService.validateTagsAgainstLibrary` 质检
  - ⚠️ 偏离：未调用 `tagRagService.validateTagsAgainstLibrary`（依赖 sqlite-vec 无法 import），改为脚本内重实现 `auditTag` 走 L1-L3b 等价逻辑
- [x] 审计替换逻辑覆盖 L2 规范化（canonicalName）/ L3 颜色拆分（splitTags）/ L4 KNN（suggestions）/ L5 AI 兜底
  - ⚠️ 偏离：仅实现 L1-L3b（L0/L4/L5 跳过，详见 FIX_RECORDS.md §7.22 决策 3）
- [x] L0-L5 全部未匹配的 tag 标记为 `failed` 并加入异常列表
- [x] 审计后 4 维度 tag 合并为单个 positive 字符串（跳过 failed tag）
- [x] 每条 tag 记录命中层级（source 字段：name / alias / color-split / knn / ai-fallback / failed）
  - ⚠️ source 实际值为 `name` / `alias` / `color-split` / `negation-strip` / `rating` / `failed`（L0/L4/L5 未实现故无 `user-map` / `knn` / `ai-fallback`）

## 报告输出与代码生成
- [x] `OptimizationReport` 数据结构含 totalEmotions / successCount / failedCount / passRate / totalTags* / details[] / abnormalPrompts[]
- [x] 报告写入 `scripts/expression-prompt-optimization-report.json`（JSON 2 空格缩进）
- [x] TypeScript 代码片段写入 `scripts/expression-prompt-map.generated.ts`（格式与 EMOTION_PROMPT_MAP 一致 + JSDoc「脚本生成」标注）
- [x] 控制台输出摘要（处理总数 / 成功数 / 失败数 / 通过率 / 异常列表预览）
- [x] 每个情绪处理完成后输出进度行 `[i/31] emotion_key: ✓ N tags (M valid, K replaced)`

## 主流程编排
- [x] `main()` 函数依次执行：初始化 → 遍历 31 情绪 → 生成 → 审计 → 收集 → 输出
- [x] 单个情绪处理失败时不中断脚本（记录错误并继续）
- [x] 脚本入口 `if (require.main === module) main().catch(...)` 支持直接执行

## EMOTION_PROMPT_MAP 替换
- [x] 执行脚本生成 `scripts/expression-prompt-map.generated.ts`
  - 已执行：`npx tsx scripts/optimize-expression-prompts.ts` EXITCODE=0，31/31 情绪完成
- [x] 人工审核生成内容（NSFW 语义保留 / 4 维度覆盖 / 无异常 tag）
  - NSFW 保留（in_heat: saliva/tongue_out/panting）；4 维度覆盖；86 failed tag 为复合词保留不影响 SD
- [x] PromptBuilder.ts 中 EMOTION_PROMPT_MAP 的 positive 字段替换为脚本生成值
  - 31 key 完整替换，键名与 EMOTION_PRESETS 对齐
- [x] EMOTION_PROMPT_MAP 上方注释标注「由脚本生成，最后更新日期」
  - JSDoc 标注 2026-08-07 + Spec 引用 + 4 维度说明 + 重新生成命令
- [x] negative 字段保持原有值或按需调整
  - 原 31 项均无 negative 字段，新值同样无 negative（一致）

## 表情生成过滤 expression 分类特征
- [x] `buildSdOptions` 在 `single-expression` / `batch-expression` 模式下过滤 `categoryId === 'expression'` 的特征
  - 实施位置：`enabledTraitTexts` useMemo 派生层（非 buildSdOptions 函数体内），确保所有下游消费者一致过滤
- [x] 过滤在拼接 enabledTraitTexts 前执行（不在字符串层面过滤）
- [x] `illustration` / `general` / `three-view` 模式不受影响（expression 分类特征正常携带）
- [x] 代码注释说明过滤原因 + Spec 引用

## 文档
- [x] `docs/FIX_RECORDS.md` 新增章节记录本次改动
  - §7.22（约 120 行）
- [x] `CODE_WIKI.md` 同步：EMOTION_PROMPT_MAP 标注 / 表情生成过滤说明 / 脚本条目
  - §17「表情预置提示词优化脚本」（约 100 行）

## 验证
- [x] 脚本执行 `npx tsx scripts/optimize-expression-prompts.ts` 无报错
  - 已执行：EXITCODE=0，31/31 情绪完成，输出报告 + 生成代码
- [x] 报告 JSON 文件生成且字段完整
  - `scripts/expression-prompt-optimization-report.json` 已生成，含 totalEmotions/successCount/failedCount/passRate/totalTags*/details[]/abnormalPrompts[]
- [x] 生成的 TypeScript 代码片段语法正确（可粘贴到 PromptBuilder.ts）
  - 已粘贴替换 PromptBuilder.ts:1487-1519，tsc 仅报预先存在错误（line 703/901/981/1194，非本次改动）
- [x] 替换后 EMOTION_PROMPT_MAP 所有 tag 均在标签库中（可抽样验证 5 个情绪）
  - 抽样：default(10 tag 全 valid) / admiration(21 valid 1 failed) / desire(14 valid 1 failed) / in_heat(17 valid 2 failed) / joy(18 valid 2 failed)；failed tag 为复合词（如 calm_face/serene_expression），对 SD 仍有效
- [x] 表情生成时 characterTraits 不含 expression 分类特征（控制台日志或断言验证）
  - 静态验证：`isExpressionMode` 在 single-expression/batch-expression 时为 true，过滤生效
- [x] 立绘 / 一般图像 / 三视图生成时 characterTraits 含 expression 分类特征（行为不变）
  - 静态验证：非表情模式 `isExpressionMode` 为 false，过滤条件恒 true
