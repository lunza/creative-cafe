# 对话模式"去 AI 味"与"防长程重复"优化 Spec

> 本规范针对角色对话聊天模块用户反馈的两类表达质量问题制定系统性方案：
> 1. **"AI 味儿"**：回复呈现刻板的"任务执行"风格，缺乏自然流畅的人类交流特质
> 2. **长对话重复**：AI 模仿自身历史输出的句式结构，越聊越模板化
>
> 约束：不改变 IPC channel 名与 store 接口；所有改动落在**线上执行路径**（`PromptBuilder.ts` + `hooks.ts` + 模板系统），休眠管线（`pipeline/` providers）仅同步共享函数，不单独接线。

---

## Why

### 问题 1："AI 味儿"的技术根因

1. **规则列表式提示词**：`creative-chat.dialogue` 模板注入 19+ 条规则（8 条约束 + 7 条禁止 + 4 条白名单例外 + 输出格式段），模型进入"任务执行"心态而非"角色代入"心态。规则 1/2/5/12 四条语义重复（代入角色），规则 9-13 五条负面禁令属罕见场景防御且存在"越禁越像 AI"的反噬。
2. **格式三板斧硬约束**：双引号对话 + 星号动作的格式规则在模板内重复 2 次（规则 7/8 + 输出格式段），叠加长度引导要求"动作描写、语言对话、内心活动"三要素全包含，直接催生 `*动作* "对话" *心理*` 固定模板。
3. **字数下限引发填充式写作**：`min_response_chars=300` 的"不少于 X 字"指令导致模型机械堆砌形容词凑字数。

### 问题 2：长对话重复的技术根因

1. **上下文内自我模仿（核心）**：LLM 天然复制上下文中已有输出模式；最近 60 条原始消息 + RAG 历史片段原文双重注入，等于给模型提供自己的句式范本。
2. **token 级防重复 ≠ 句式级防重复**：frequency_penalty 只惩罚重复 token，无法阻止"每次都以 *微微一笑* 开头"这类结构重复。
3. **无表达多样性度量**：系统没有"这条回复的开头句式是否与前 N 条雷同"的检测与反馈机制；现有 n-gram Jaccard 去重仅覆盖重试/续写场景，正常对话流无干预。

### 已确认的关键事实（影响实施方案）

- **线上只跑 legacy hooks 路径**：`CharacterDialogueChat.tsx` 导入 `hooks.ts`（非 `hooks.new.ts`），`pipeline/` 下 14 个 Provider 全部处于休眠状态，改 Provider 对线上零影响。
- **存量数据库模板不更新**：`mergeNewDefaultTemplates` 不更新已有模板（已知坑，`removeOldFormatProhibition` hack 即历史证据），模板精简必须附带运行时剥离兜底。
- **长度引导的强化模式是救火机制**：`shouldStrengthenLength`（连续 3 轮短回复触发）为修复"回复持续缩短"真实 bug 而建，字符数检测逻辑必须保留，否则原 bug 复现。

---

## What Changes

### Phase 1 — 诊断基建
- 新增 `utils/diversityMetrics.ts` 纯函数工具：开头句式重复率 / distinct-3 / 结构模板率 / 跨轮 Jaccard / 高频动作短语集中度
- `hooks.ts` onComplete 记录本轮回复的多样性指标日志（运行时基线采集，无 UI 改动）

### Phase 2 — 提示词激进重构（线上路径）
- **旧规则运行时剥离**：`PromptBuilder.ts` 新增 `stripLegacyDialogueRuleBlocks`，移除模板输出中的【对话约束规则】【严格禁止】【白名单例外】【输出格式】四个旧块（对存量 DB 模板与新模板统一生效），随后追加 3 条核心规则的新指令集（锚点守卫防重复注入）
- **新默认模板**：`promptTemplateService.ts` 的 `creative-chat.dialogue` instructions 重写为精简版（3-4 条核心规则 + 自然度正面引导 + 单次格式规则）
- **长度引导改信息密度**：`buildLengthGuidancePrompt` 日常模式从"不少于 X 字 + 三要素"改为"通常 X 字左右 + 每次推进至少一个新情节点或情绪变化"；**强化模式保留硬性字数下限**（救火机制不动）
- **mes_example 风格锚定**：`buildCharacterContext` 的示例对话段落标注"说话风格范本，模仿语气与节奏，不照抄内容"
- **格式规则注入去重**：`injectDialogueFormatInstructions` 守卫短语从完整旧句放宽为"用星号包裹"，确保新旧模板均只注入一次

### Phase 3 — 防重复提示词层（仅提示词层，无额外生成成本）
- 新增 `utils/styleFingerprint.ts`：
  - `extractStyleFingerprint`：从最近 5 条 assistant 回复提取开头类型（动作/对话/叙述）、动作短语集合
  - `buildStyleAvoidancePrompt`：检测到重复信号（≥3/5 同类型开场、动作短语出现 ≥3 次）时生成自然语言规避指令
  - `buildCreativeRotationPrompt`：12 种表达策略轮换池，按 seed（末条用户消息哈希 + 重试次数）选定注入，重试时指令自动变化
- `hooks.ts`：dialogue 模式下在表情提示词之后注入规避指令（有信号时）与轮换指令；continuation 模式不注入（续写需风格一致性）

### 明确不做（本轮排除）
- 结构相似度检测自动重生成 / best-of-N 双候选（用户已确认仅提示词层）
- min_p / XTC 采样层调整（待 Phase 1 基线数据验证必要性）
- 休眠管线 providers 的单独改造（仅随共享函数被动变化）
- `creative-chat.continuation` 模板（续写模式本轮不动）

---

## Impact

- **Affected specs**：
  - `optimize-chat-ai-intelligence`（互补关系：该 spec 解决抢话/截断/token 精度等工程缺陷，本规范解决表达质量；`buildLengthGuidancePrompt` 由 `fix-ai-response-length-degradation` 建立，本规范仅改日常表述，强化机制原样保留）
  - `redesign-dialogue-pipeline-architecture`（休眠管线共享 `buildLengthGuidancePrompt`，被动同步）
- **Affected code**：
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（剥离函数、新指令集、长度引导、mes_example 锚定、守卫放宽）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（指纹规避 + 轮换指令注入、多样性指标日志）
  - `src/main/services/promptTemplateService.ts`（新默认模板）
  - 新增 `utils/diversityMetrics.ts`、`utils/styleFingerprint.ts` 及测试
  - `__tests__/PromptBuilder.lengthGuidance.test.ts`（重写适配新表述）
- **Affected docs**：`.trae/documents/技术文档.md`（增量更新 + ⚠️ 重点标记存量模板迁移风险）
- **风险评估**：
  - 格式合规率可能下降（规则精简的代价）→ 渲染层全容错（normalizeQuotes 兼容中文引号、星号缺失仅样式降级）；Phase 1 指标监控合规率，跌破 85% 回调
  - 角色 OOC 风险 → 「你就是 {char}」核心句与 depth_prompt 锚定保留
  - tableEdit 白名单删除 → async 模式的 tableEditInstruction 变量自带完整指令说明，且"禁止额外标记"类禁令已同步移除，冲突源消失

---

## ADDED Requirements

### Requirement: 多样性诊断指标

系统 SHALL 提供纯函数多样性指标工具，供运行时日志采集与基线对比。

#### Scenario: 指标计算
- **WHEN** 对最近 N 条 assistant 回复调用 `computeDiversityReport`
- **THEN** 返回开头句式重复率（开头 4-gram 与任一前条重合比例）、distinct-3（字符 3-gram 多样性）、结构模板率（动作开场+含对话+含动作的固定顺序比例）、跨轮 Jaccard 均值、高频动作短语集中度（top-5 短语占比）

#### Scenario: 运行时基线采集
- **WHEN** dialogue 模式回复完成（onComplete）
- **THEN** 计算含本轮在内的最近 10 条 assistant 回复的多样性报告并写入会话日志（addLog，info 级）
- **AND** 指标计算耗时 < 50ms，失败不阻塞主流程

### Requirement: 旧规则运行时剥离

系统 SHALL 在构建对话模式系统提示词时，移除模板输出中的旧版规则块并注入精简指令集。

#### Scenario: 存量旧模板剥离
- **WHEN** 模板输出包含【对话约束规则】【严格禁止】【白名单例外】【输出格式】任一旧块
- **THEN** 这四个块被整体移除（块标题到下一个【标题】或文本末尾）
- **AND** 移除后在提示词末尾追加新指令集（【对话方式】块）

#### Scenario: 新模板不重复注入
- **WHEN** 模板输出已包含锚点"【对话方式】"（新默认模板）
- **THEN** 跳过剥离与追加，模板内容原样通过

#### Scenario: 用户自定义模板保护
- **WHEN** 模板输出不包含任何已知旧块标题（用户深度自定义）
- **THEN** 不做任何剥离，仅在缺少"【对话方式】"锚点时追加新指令集

### Requirement: 风格指纹规避指令

系统 SHALL 在 dialogue 模式请求前从最近 assistant 回复提取风格指纹，检测到重复信号时注入规避指令。

#### Scenario: 开场类型重复
- **WHEN** 最近 5 条 assistant 回复中 ≥3 条以同一开场类型开始（动作 `*` / 对话 `"` / 叙述）
- **THEN** 注入自然语言规避指令（如"你最近几次回复都以动作描写开场，这次不妨从对话、环境细节或心理活动切入"）

#### Scenario: 动作短语重复
- **WHEN** 某个动作短语（星号包裹内容，长度 ≥2）在最近 5 条回复中出现 ≥3 次
- **THEN** 规避指令中点名该短语并要求换用更具体的神态描写

#### Scenario: 无信号不注入
- **WHEN** 指纹未检测到任何重复信号（或 assistant 历史不足 3 条）
- **THEN** 不注入规避指令（返回空串）

#### Scenario: 续写模式不注入
- **WHEN** promptType 为 continuation
- **THEN** 跳过规避指令与轮换指令注入（续写需与原文风格一致）

### Requirement: 创意表达轮换指令

系统 SHALL 在 dialogue 模式请求中注入轮换的表达策略建议。

#### Scenario: 策略选取
- **WHEN** 构建 dialogue 请求的系统提示词
- **THEN** 以"末条用户消息哈希 + 重试次数 × 97"为 seed，从 12 种表达策略池中选定一种，以"仅供参考，以符合角色与情境为先"的措辞注入

#### Scenario: 重试指令变化
- **WHEN** 同一消息触发去重重试（retryCount 递增）
- **THEN** seed 变化导致选定策略变化，避免坏指令重复

### Requirement: mes_example 风格锚定

系统 SHALL 将角色卡示例对话标注为风格范本。

#### Scenario: 示例对话注入
- **WHEN** 角色卡配置了 mes_example 且解析出至少一组示例
- **THEN** 注入段落标注"{charName} 的说话风格范本——模仿其语气、用词与节奏，但不要照抄内容"

---

## MODIFIED Requirements

### Requirement: 回复长度引导约束

**原实现**：日常模式注入"每次回复应不少于 X 字，包含详细的动作描写、语言对话和内心活动，避免简短敷衍的回复"；强化模式追加硬性字数提醒。

**新实现**：日常模式注入"每次回复通常在 X 字左右——重点是有实质推进：新的情节点、情绪变化或信息，而非堆砌描写"；**强化模式保持原硬性字数下限不变**（连续 3 轮短回复的救火机制，字符数检测逻辑 `shouldStrengthenLength` 与 `responseLengthHistoryRef` 原样保留）。

### Requirement: 对话模式默认指令模板

**原实现**：19+ 条规则（8 约束 + 7 禁止 + 4 白名单 + 输出格式段），格式规则在模板内出现 2 次。

**新实现**：3 条核心规则（身份代入 + 自然度正面引导 + 单次格式规则），保留 `{{table_edit_instruction}}` 变量位；负面禁令与白名单块整体移除，变量替换指令由【对话任务说明】既有说明句覆盖（显示层 `replaceTemplates` 兜底）。

### Requirement: 格式指令注入守卫

**原实现**：`injectDialogueFormatInstructions` 以完整旧句"角色的动作、神态、心理活动等非对话描写必须用星号包裹"为守卫。

**新实现**：守卫放宽为子串"用星号包裹"，覆盖新旧两版格式规则表述，保证任意模板版本下格式规则至多注入一次。

---

## REMOVED Requirements

### Requirement: 旧版对话约束规则块

**Reason**：15 条规则中 4 条语义重复、5 条为罕见场景负面禁令（存在反噬）、格式规则与输出格式段重复；规则列表式提示词是"AI 味"的直接技术根因。

**Migration**：核心约束收敛为新指令集 3 条规则；tableEdit 白名单功能由 `{{table_edit_instruction}}` 变量的自带说明承接；变量替换由显示层 `replaceTemplates` 兜底。
