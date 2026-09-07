# Tasks

- [x] Task 1: 禁词指令线上接线（bug 修复，最高优先级）
  - 在 `CharacterDialogueChat.hooks.ts` 的对话请求组装处（system prompt 构建完成后、发送前）注入 `buildForbiddenWordsPrompt(config)` 输出
  - 配置获取：从 useSettingStore 读取 `setting.forbiddenWords`（参照 hooks.ts 现有配置读取模式）
  - 覆盖三种对话型请求：dialogue / continuation（续写）/ user-reply（用户回复生成）
  - 锚点守卫：system prompt 已含 "Forbidden Word List (Strict Constraints)" 时跳过
  - 日志：`[ForbiddenWords] 已注入 N 个类别` / `未启用或为空`
  - 注意：不通过 pipeline Provider 注入（休眠路径），直接在 hooks.ts 接线——与线上路径现状一致

- [x] Task 2: ForbiddenWordsConfig 模型扩展 + 设置面板
  - `src/shared/types/forbiddenWords.ts`：接口新增 `enforcement?: 'prompt-only' | 'retry' | 'retry-and-replace'`、`replacementText?: string`、`maxRetries?: number`；DEFAULT_FORBIDDEN_WORDS_CONFIG 同步默认值（'retry-and-replace' / '***' / 2）
  - `BlockedWordsSettings.tsx`：新增执行模式 Radio（含三种模式说明）、替换文本输入（retry-and-replace 时显示）、重试次数 InputNumber（1-5）
  - 存量配置兼容：读取时缺字段取默认值（无需迁移逻辑，接口字段全部可选）
  - 对话去 AI 味开关与采样预设开关（Task 4/5 的 UI）一并加到设置面板（内容约束标签页新增"对话自然度"分组）

- [x] Task 3: 合规检测器纯函数
  - 新建 `src/renderer/components/Character/CharacterDialogueChat/utils/complianceChecker.ts`（与 diversityMetrics.ts 同级）
  - `compileForbiddenPatterns(categories, caseSensitive)`：类别 words 去重/去空 → 正则数组（全词匹配含中文边界处理；复用 add-banned-words-filter 时代的 \b 边界经验，中文词用前瞻/后顾断言或直接子串匹配——以简单可靠为先：子串匹配 + 词边界混合，中文子串、英文 \b）
  - `checkCompliance(content, config)`：返回 `{ hits: Array<{ word, category, index }>, clean: boolean }`
  - 无效输入（空配置/空内容）短路；性能：预编译 + 缓存（配置不变时复用）
  - 单元测试：中文命中/英文大小写/子串误匹配防护（"冰"vs"冰冷的"）/空边界/多类别/性能（1000 词 < 50ms）

- [x] Task 4: 输出合规硬执行层（hooks.ts）
  - 响应完成处理处（DiversityMetrics 输出点旁）插入合规校验流程：
    1. `checkCompliance` 检测最终响应文本
    2. enforcement='retry'/'retry-and-replace' 且命中 → 构造违规反馈（追加 system 指令："上一条回复包含禁词：{words}，请重写整条回复并避开所有禁词"）重发请求，不超过 maxRetries
    3. 'retry-and-replace' 且重试超限 → 命中词替换为 replacementText 后入库
    4. 'prompt-only' → 仅记录不处理
  - 重试实现参照现有 nGramJaccard 去重重试的模式（L1552-1630 附近）；流式场景不向用户展示中间脏内容
  - `[Compliance]` 指标日志：`round=N hit=<词> mode=<模式> retries=<次数> result=<clean|clean-by-retry|replaced>`
  - 对话去 AI 味词表注入（humanizerPolish 对话变体，Task 5 产物）在此任务一并接线（同一插入点区域）

- [x] Task 5: humanizerPolish 对话场景变体
  - `HUMANIZER_DIALOGUE_RULES`：文体总则（RP 对话像真人说话：句式自然、口语节奏、不堆砌辞藻、长短句交错）+ HUMANIZER_RP_WARNLIST + HUMANIZER_FULL_GUIDE（完整接入，不简写——用户既定决策）
  - `withHumanizerDialogueRules(systemPrompt, enabled)`：锚点守卫（共用【文本风格约束】锚点，防与生成变体重复）；enabled=false 原样返回
  - 开关默认开；测试：注入/关闭/锚点防重/含 RP 词表与完整指南/无 JSON 声明（对话是纯文本）/规模下限断言
  - 注意与 reduce-dialogue-ai-flavor 的 applyMinimalDialogueRules 锚点互不冲突（不同锚点）

- [x] Task 6: 对话采样预设（按模型系列覆盖）
  - 预设表（对齐 docs/llamacpp-model-compat-analysis.md 5.1）：qwen 系（model_name 含 qwen，排除 gemma）temp 0.7 / top_p 0.8 / min_p 0.0；gemma 系 temp 1.0 / top_p 0.95 / min_p 0.01；其余系列不覆盖
  - hooks.ts 发送请求前按当前引擎 model_name 匹配覆盖采样参数（仅对话请求；用户已显式自定义的参数项不覆盖——以设置面板开关整体启停为准，开关默认关）
  - 日志：`[Sampling] qwen 预设覆盖: temp=0.7 top_p=0.8 min_p=0.0`
  - 仅修改请求 body 的采样字段，不触碰引擎配置持久化

- [x] Task 7: 验证与文档
  - 单测全跑（新增 complianceChecker / humanizerPolish 对话变体 / 配置模型测试）
  - tsc 零新增错误（对照存量基线）
  - dev server 自动重启验证（共享模块主进程引用）
  - 技术文档增量更新：⚠️ 重点标记"禁词 Provider 休眠路径接线断裂"这一根因与修复（防复发：新增 Provider 时必须同步接线线上路径）
  - A/B 验证方法说明：同一角色同一开场，开关切换前后各跑 10+ 轮，对比 [Diversity] 与 [Compliance] 日志指标 + 用户主观盲测

# Task Dependencies

- [Task 1] 无依赖（bug 修复，可最先执行）
- [Task 2] 无依赖，与 Task 1 并行
- [Task 3] 依赖 [Task 2]（enforcement 等类型字段）
- [Task 4] 依赖 [Task 1]（注入点存在）+ [Task 3]（检测函数）+ [Task 5]（对话词表变体）
- [Task 5] 无依赖，可与 Task 1/2/3 并行
- [Task 6] 无依赖，可与 Task 1/2/3/5 并行（独立插入点）
- [Task 7] 依赖全部任务完成

# 可并行执行的任务

- [Task 1] / [Task 2] / [Task 5] / [Task 6] 四者相互独立可并行
- [Task 3] 在 [Task 2] 完成后进入
- [Task 4] 汇总 [Task 1]/[Task 3]/[Task 5] 后执行（同文件 hooks.ts，串行避免冲突）
