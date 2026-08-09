# LLM AI 兜底标签审核 — 实施计划

## Context

经多轮审计机制（L0 自定义映射 → L1 name → L2 alias → L3 颜色拆分 → L3b 否定性修饰词剥离 → L4 语义 KNN）后，仍有部分 tag 全部未命中（如 `B-cup` 领域术语、`cybernetic_arms` 复合词）。当前仅靠末轮人工审核 inline 替换，用户体验差——每次 AI 生成都需手动介入。

用户需求：在末轮人工审核前再加一道 LLM AI 兜底防线，用与「AI 生成特征」按钮相同的条件（角色卡图片 + 描述 + personality + scenario + includeImage）调用 LLM，让其返回多个候选同义词或拆分词，再次走 L0-L4 匹配链。命中即自动替换 + 持久化；仍未命中则保留手动入口。

**用户已确认的关键决策**：
1. **自动批量触发**：在 `generateCharacterTraits` 内部自动收集所有 L0-L4 全失败的 tag，一次 LLM 调用批量获取候选词
2. **自动持久化**：AI 兜底命中后立即调 `userSynonymMapService.addMapping` 持久化（下次同词 L0 首轮命中）
3. **撤销清除映射**：撤销 = 还原 trait + 删除 userSynonymMap 映射（与人工审核撤销语义一致）

## 设计要点

### 触发位置
在 `characterTraitAIService.ts:generateCharacterTraits` 现有「自动替换循环」（行 587-625）之后、`return`（行 633）之前插入兜底环节。

### 触发条件
`tagValidation` 中 `isValid=false && skipReason!=='rating' && !replacedBy` 的项 ≥ 1 个且 ≤ `AI_FALLBACK_MAX_TAGS=10`。

### 处理流程
1. 收集未匹配 tag → 批量调 LLM（复用主调用 aiConfig/runtimeConfig/includeImage）→ 输出 `<original_tag> | candidate1, candidate2` 格式
2. 候选词扁平化去重 → **一次性**调 `tagRagService.validateTagsAgainstLibrary`（避免 N 次串行 embedding）
3. 按 LLM 输出顺序找首个 `isValid=true` 的候选词
4. 命中：替换 `trait.text` 为 `canonicalName` + 调 `userSynonymMapService.addMapping` 持久化 + 在 tagValidation 项写入 `replacedBy`/`source='ai-fallback'`/`aiFallbackAttempted=true`/`aiFallbackCandidates`
5. 未命中：`aiFallbackAttempted=true`，保留 ✏ 手动替换入口
6. LLM 失败/解析失败：所有目标 `aiFallbackAttempted=true`，主流程不阻塞

### 依赖方向
保持单向 `characterTraitAIService → tagRagService`，不新增循环依赖。`tagRagService.validateTagsAgainstLibrary` 行为不变，`source='ai-fallback'` 由调用方写入 tagValidation 项（非 validateTagsAgainstLibrary 返回）。

### 不需要新增 IPC
兜底在 `generateCharacterTraits` service 内部完成，结果通过 `ragDebug` 字段透传。撤销复用现有 `tagRag:removeUserSynonymMapping` IPC。`characterTraitAIHandlers.ts` / `preload.ts` 无改动。

## 实施步骤

### 后端

**1. `src/main/services/characterTraitAIService.ts`**
- 顶部新增 `AI_FALLBACK_MAX_TAGS=10` 常量与 `AI_FALLBACK_SYSTEM_PROMPT`（要求 LLM 输出 `<tag> | candidate1, candidate2` 格式，2-4 个候选词，覆盖同义词/下划线规范化/复合词拆分/别名转正名/颜色拆分 6 类策略）
- 顶部新增 `import { userSynonymMapService } from './userSynonymMapService'`
- 扩展 `GenerateCharacterTraitsResult.ragDebug.tagValidation` 数组项类型：
  - `source` union 新增 `'ai-fallback'`
  - 新增 `aiFallbackAttempted?: boolean`
  - 新增 `aiFallbackCandidates?: string[]`
- 新增 4 个私有方法：
  - `buildAiFallbackUserMessage(unmatchedTags, description, personality?, scenario?)` — 构建用户消息（角色上下文 + 未匹配 tag 列表）
  - `parseAiFallbackResponse(content, unmatchedTags)` — 解析 LLM 输出为 `Map<originalTag, candidates[]>`（按 `|` 切分，候选词去重+上限 4 个，大小写不敏感匹配 unmatchedTags）
  - `generateTagSynonymsBatch(unmatchedTags, params, aiConfig, runtimeConfig)` — 复用主调用配置 + 多模态消息构建 + enrichSystemPrompt，调 LLM 返回候选词映射；失败返回空 Map
  - `applyAiFallback(aiFallbackTargets, candidatesMap, traits)` — 候选词扁平化去重 → 一次性调 `validateTagsAgainstLibrary` → 按顺序找首个 valid → 替换 trait + 持久化 + 标记
- 在 `generateCharacterTraits` 行 631 之后插入兜底环节（try/catch 全包，失败降级标记 `aiFallbackAttempted=true`）

**2. `src/main/services/__tests__/characterTraitAIService.test.ts`（新建）**
- mock：`aiConfigProvider`/`storageService`/`tagRagService`/`userSynonymMapService`/`categoryDictionaryService` + `global.fetch`
- 15+ 用例覆盖：命中/未命中/LLM 失败/解析失败/rating 跳过/已替换跳过/超上限跳过/includeImage=true/多行解析/候选词去重/候选词上限/规范化命中/trait 不存在/持久化失败不阻塞

### 前端

**3. `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx`**
- `RagDebugData.tagValidation` 项类型扩展（同后端）
- 新增 `COLORS.aiFallback = '#f97316'`（橙色，介于 warning 黄与 manual 紫之间）
- `SOURCE_LABELS` 新增 `'ai-fallback': 'L5 AI 兜底'`
- 新增 `onRevertAiFallback?: (originalTag: string, replacedBy: string) => void` prop
- 新增派生变量 `isAiFallbackHit`（`replacedBy && source==='ai-fallback'`）/`isAiFallbackMiss`（`!isValid && !replacedBy && aiFallbackAttempted && aiFallbackCandidates?.length>0`）
- 优先级链更新（在 `isManuallyReplaced` 与 `isReplaced` 之间插入 `isAiFallbackHit`）：
  - 紫 🟣（手动替换）> 橙 🤖（AI 兜底命中）> 蓝 🔄（L1-L4 自动替换）> 绿 ✅（库内）> 灰 ⊘（评级词）> 橙 🤖（AI 兜底未命中）> 红 ❌ > 黄 ⚠
- 命中项展示 ↩ 撤销按钮（调 `onRevertAiFallback`）
- `canManualReplace` 条件新增 `!item.replacedBy`（已替换的项不展示 ✏）
- 头部统计文案追加「橙色=AI 兜底命中候选词，点 ↩ 撤销」
- 新增 `RobotOutlined` icon 导入

**4. `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`**
- `ragDebug` state 类型扩展（同后端字段）
- 新增 `handleRevertAiFallback(originalTag, replacedBy)` 函数（参照 `handleRevertManualReplace` 模式）：
  1. 找 `text === replacedBy` 的 trait 调 `updateTrait(trait.id, originalTag)` 还原
  2. 调 IPC `tagRag.removeUserSynonymMapping({ original: originalTag })` 删除映射
  3. 更新 ragDebug：清除对应项 `replacedBy/source/aiFallbackCandidates`，保留 `aiFallbackAttempted=true`
- `<RagQualityReport>` 新增 `onRevertAiFallback={handleRevertAiFallback}` prop 透传

### 文档

**5. `.trae/specs/add-ai-fallback-tag-audit/spec.md`（新建）**
- 参照 `add-multi-round-tag-audit/spec.md` 结构，含 Why / What Changes / Impact / ADDED Requirements（4 个：触发条件 / 候选词生成与验证 / 持久化 / 撤销）/ MODIFIED Requirements（匹配链扩展为 L0-L5）

**6. `docs/FIX_RECORDS.md` 追加 §7.17**
- ⚠️ 重点标记，记录根因（L0-L4 确定性匹配无法处理 LLM 才能理解的语义等价）/ 修复方案（4 个子任务）/ 三轮审计设计扩展表 / L5 处理链路示例 / 性能考量 / 教训（5 条）

**7. `CODE_WIKI.md` 新增「LLM AI 兜底标签审核」章节**
- 概述 / 触发条件 / 处理流程 / ragDebug 字段扩展 / 前端展示状态机 / 撤销语义 / 涉及文件清单

## 关键文件清单

| 文件 | 改动类型 |
|---|---|
| `src/main/services/characterTraitAIService.ts` | 修改：新增 4 个私有方法 + 兜底环节 + 类型扩展 |
| `src/main/services/__tests__/characterTraitAIService.test.ts` | 新建：15+ 单测 |
| `src/renderer/components/Character/CharacterDialogueChat/RagQualityReport.tsx` | 修改：橙色 🤖 徽标 + `onRevertAiFallback` prop |
| `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | 修改：`handleRevertAiFallback` + state 类型扩展 |
| `.trae/specs/add-ai-fallback-tag-audit/spec.md` | 新建：spec 文档 |
| `docs/FIX_RECORDS.md` | 修改：追加 §7.17 |
| `CODE_WIKI.md` | 修改：新增章节 |

**不修改的文件**：
- `src/main/services/tagRagService.ts`（validateTagsAgainstLibrary 行为不变）
- `src/main/services/userSynonymMapService.ts`（复用现有 addMapping/removeMapping）
- `src/main/ipc/handlers/characterTraitAIHandlers.ts`（透传 service 返回值）
- `src/main/preload.ts`（复用现有 IPC）

## 复用的现有函数/工具

- `aiConfigProvider.getAIConfig({ defaultTransmission: 'header' })` — 读取 baseUrl/apiKey/modelName 等
- `getEngineRuntimeConfig()` — 读取 temperature/maxTokens（遵守「禁止 AI 参数默认值」规则）
- `enrichSystemPrompt(messages, engineSystemPrompt)` — 注入引擎级 system prompt
- `tagRagService.validateTagsAgainstLibrary(tags)` — 候选词再验证（重跑 L0-L4）
- `userSynonymMapService.addMapping(original, replacement)` — 持久化映射
- `userSynonymMapService.removeMapping(original)` — 撤销时删除映射
- 现有 IPC `tagRag:removeUserSynonymMapping` — 前端撤销复用

## 验证

### 单元测试
```
npx vitest run src/main/services/__tests__/characterTraitAIService.test.ts
```
预期 15+ 用例全部通过，覆盖命中/未命中/LLM 失败/解析失败/上限保护等场景。

### 类型检查
```
npx tsc --noEmit
```
预期无新错误（特别是 `source` union 扩展与 ragDebug 类型扩展）。

### 全量测试
```
npx vitest run
```
预期现有 tagRagService.test.ts / userSynonymMapService.test.ts 等不受影响。

### 手动测试（Electron 集成）
1. 配置 AI 引擎 + 标签库 RAG 已向量化
2. 选择含 `B-cup` / `cybernetic_arms` 等未匹配 tag 的角色卡
3. 点击「AI 生成特征」按钮
4. 验证：
   - 控制台日志含 `[CharacterTraitAI] AI 兜底: 处理 N 个未匹配 tag`
   - ragDebug 中对应 tag 的 `source='ai-fallback'`、`aiFallbackAttempted=true`、`aiFallbackCandidates` 非空
   - trait.text 已被替换为候选词（如 `medium_breasts`）
   - `user-synonym-map.json` 含 `{"b-cup":"medium_breasts"}` 条目
5. 在 RagQualityReport 中验证橙色 🤖 徽标 + ↩ 撤销按钮可见
6. 点击 ↩ 撤销：trait.text 还原为 `B-cup`，`user-synonym-map.json` 中 `b-cup` 条目删除，✏ 手动入口重新可用
7. 再次点击「AI 生成特征」：`B-cup` 应在 L0 首轮命中（验证持久化闭环）—— 但注意撤销后已删除映射，所以会再次走 AI 兜底

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 返回格式不稳定 | `parseAiFallbackResponse` 严格过滤：无 `\|` 行跳过、候选词 trim、上限 4 个 |
| LLM 调用增加耗时（额外 2-5s） | 仅 L0-L4 全失败时触发，用户已在 AI 生成流程中预期等待 |
| LLM 输出生造词 | 候选词必须经 `validateTagsAgainstLibrary` 验证，确保 trait.text 是库内有效标签 |
| LLM 错误替换 | 用户可撤销（↩ 按钮），撤销即删除映射 |
| 持久化映射污染 | 撤销同步删除映射；用户可在设置面板手动清理 |
| 极端场景未匹配 tag 过多 | `AI_FALLBACK_MAX_TAGS=10` 上限保护，超出则跳过保留 ✏ 入口 |
| 候选词命中 L3 颜色拆分（splitTags） | V1 不处理此边缘场景（trait.text 替换为 feature，颜色部分丢失但不比现状差），留作 V2 优化 |

## 实施顺序

1. 后端：characterTraitAIService.ts 新增常量/方法/兜底环节 + 类型扩展
2. 测试：新建 characterTraitAIService.test.ts，编写 15+ 单测
3. 前端：RagQualityReport.tsx 接口扩展 + 橙色 🤖 渲染
4. 前端：AssetManagerModal.tsx 实现 handleRevertAiFallback + state 类型扩展
5. 文档：新建 spec.md + 追加 FIX_RECORDS.md §7.17 + 更新 CODE_WIKI.md
6. 验证：tsc + vitest 全量通过
