# 角色对话模式 AI 智能度优化 Spec

> 本规范针对 creative-cafe 项目角色对话聊天模块（`src/renderer/components/Character/CharacterDialogueChat/`）用户反馈的"AI 抢话、重复内容、无视上下文、用户代入感差"四类问题，基于对 SillyTavern 1.18.0 源码（`G:\AI\sillytavern-source\SillyTavern`，release 分支）的深入对比分析，制定系统性技术优化方案。
>
> 所有改动以"不破坏现有 UI 操作流程、保持 IPC channel 名与 store 接口不变"为约束，按对用户体验影响排序实施。

---

## Why

creative-cafe 角色对话聊天模块存在 5 项核心智能度缺陷，是用户反馈问题的直接技术根因：

1. **无 stop sequences + 无防抢话硬约束**（影响每一次对话）：`src/renderer/components/Common/ChatEngine/ChatEngine.ts` 请求体未设置 `stop` 字段，AI 经常自己生成下一条用户消息（"\n用户: ..."）或连续重复角色名/引号，破坏沉浸感。
2. **角色无锚定，长对话易 OOC**：`PromptBuilder.ts::buildCharacterContext` 只在 system prompt 头部出现一次，无 mid-prompt 重复插入机制；长上下文截断后早期角色设定被"稀释"，AI 性格逐渐漂移。
3. **Token 计数用字节估算（`text.length / 3.35`）**：`TokenManagement/TokenCounter.ts::estimateTokens` 中文场景误差 ±15% 以上，截断时机不准——过早丢弃有效上下文或意外超出模型窗口导致请求失败。
4. **对话历史向量化与 RAG 检索脱节**：`ChatVectorizationService` 存在并有 IPC，但 `requestAIResponse` 只调 `context.retrieveWithKeywords`（知识库+世界书+记忆表格），不检索本对话历史向量，长对话跨轮细节仅靠"最近 60 条原始消息"，跨轮细节易丢失。
5. **无 AI 回复去重/相似度检测**：重试 `retryMessage` 和续写 `continueConversation` 均无去重，模型极易返回与上一次几乎相同的回复；续写无 stop 序列时还会原样重写已有内容（"内容保护"只防变短，不防重复）。

附加隐患：`hooks.ts` fallback `max_tokens=8192` 与 `ChatEngine.ts` 内部 fallback `10240` 不一致；`ChatEngine.ts` 自实现 `buildApiUrl/buildRequestBody` 与 main 进程 `AIService` 形成两套并行实现。

SillyTavern 对应成熟机制：token budget 双向预留裁剪、depth_prompt 角色深度锚定、`names_as_stop_strings` 防抢话、`continue_nudge_prompt` + `continue_prefill` 续写去重三件套、World Info 多级关键字检索。本规范系统性引入并针对中文场景优化。

---

## What Changes

### 上下文管理
- 重写 `TokenCounter`：引入 `tiktoken/cl100k_base` 精确计数（中文误差从 ±15% 降至 ±3%），保留字节估算作为 fallback
- 重写 `ContextTruncator`：基于 token budget 的双向预留裁剪算法（必填项 reserve + 可选项倒序填充 + 超限 break），替代当前"末尾累加 + minMessagesToKeep 回退"
- 修复 `max_tokens` 双重默认值不一致（统一为 8192）

### 角色一致性
- 引入角色深度锚定（depth_prompt 机制）：在裁剪后消息列表 depth=4 位置周期性注入角色名+个性精简摘要
- 在 system prompt 增加"角色卡为绝对权威"约束

### 防抢话、防重复
- 在 `ChatEngine` 请求体新增 `stop` 字段：`\n{{user}}:`、`\n用户:`、`\nUser:` 等用户名变体
- 重试/续写引入 n-gram Jaccard 相似度检测：与上一条 assistant 回复相似度 > 0.8 时自动重新生成（最多 2 次）
- 续写采用 `continue_nudge_prompt` 提示词约束

### 响应超参数
- 调整默认值基线：`top_p=0.95`、`frequency_penalty=0.3`、`presence_penalty=0.3`、`repetition_penalty=1.1`（仅对支持后端）
- **新增 DRY 采样参数**（借鉴 SillyTavern `textgen-settings.js`）：`dry_multiplier=0.8`、`dry_base=1.75`、`dry_allowed_length=2`、`no_repeat_ngram_size=0`（默认关闭），作为防重复第二道防线
- 在 `ParameterPanel` 暴露 stop sequences 与 DRY 采样配置 UI（高级区，默认折叠）

### 对话历史 RAG
- 在 `requestAIResponse` 步骤 A 之后新增"对话历史向量检索"：调用 `ChatVectorizationService` 检索本会话历史中相似度 > 0.6 的过往消息（topK=3），注入 system prompt"区域 2：本会话相关历史片段"
- 自动增量向量化：每 5 轮对话自动调用 `ChatVectorizationService` 增量向量化本会话最近消息

### AI 引擎统一
- **BREAKING**：废弃 `ChatEngine.ts` 自实现 `buildApiUrl/buildRequestBody`，复用 main 进程 `AIService.streamChatAPI` + `SSEStreamParser`，`ChatEngine` 仅保留状态管理职责
- 该项与 `audit-and-refactor-core-modules` spec 中"统一 AI 引擎"重叠，本规范仅约定对话模块的接入方式，具体重构以 `audit-and-refactor-core-modules` 为准

---

## Impact

- **Affected specs**：
  - `audit-and-refactor-core-modules`（AI 引擎统一部分与之重叠，需协调：本规范消费其统一后的 `AIService.streamChatAPI`，不重复实现）
  - `fix-short-ai-response-in-chat`（空目录，本规范的 token 精确计数与 max_tokens 修复覆盖其目标）
- **Affected code**：
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（主流程：stop 变量注入、深度锚定调用、对话历史 RAG、去重检测）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（角色锚定段落、stop 变量计算、continue_nudge_prompt）
  - `src/renderer/components/Character/CharacterDialogueChat/TokenManagement/ContextTruncator.ts`（budget 算法重写）
  - `src/renderer/components/Character/CharacterDialogueChat/TokenManagement/TokenCounter.ts`（tiktoken 接入）
  - `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx`（新增 stop 配置 UI、默认值调整）
  - `src/renderer/components/Common/ChatEngine/ChatEngine.ts`（stop 序列、复用 AIService、max_tokens fallback 统一）
  - `src/main/services/ChatVectorizationService.ts`（新增 RAG 检索接口 `retrieveChatHistory`、增量向量化 `vectorizeIncremental`）
  - `src/main/services/ContextManager.ts`（新增 `chatHistory` 检索源）
- **Affected docs**：`doc/04b-character-dialogue-chat-module.md`（增量更新：5 项缺陷修复说明 + ⚠️ 重点标记）
- **风险评估**：所有改动保持外部 API（IPC channel 名、preload 命名空间、store 接口）不变；tiktoken 在 Electron 主进程加载，renderer 通过 IPC 调用，不增加渲染进程负担；对话历史 RAG 检索失败不阻塞主流程

---

## ADDED Requirements

### Requirement: Stop Sequences 防抢话机制

系统 SHALL 在每次 AI 请求的 `stop` 字段中注入用户名变体停止序列，防止 AI 代替用户发言。

#### Scenario: 阻断用户名前缀
- **WHEN** AI 流式输出中出现 `\n{{user}}:` 或 `\n用户:` 或 `\nUser:` 等用户名变体（含中英文冒号）
- **THEN** 流式在该位置立即终止，已生成内容保留为 assistant 回复

#### Scenario: 自定义停止序列
- **WHEN** 用户在 `ParameterPanel` 开启"自定义停止序列"并输入额外停止串
- **THEN** 这些停止串与默认用户名变体合并写入请求体 `stop` 数组
- **AND** 配置持久化到 `character-session-<cardId>` localStorage

#### Scenario: 后端兼容
- **WHEN** 当前 AI 后端不支持 `stop` 数组（仅支持字符串）
- **THEN** 取第一个停止串作为 `stop` 字符串，其余丢弃并记录日志

### Requirement: 角色深度锚定（depth_prompt）

系统 SHALL 在对话历史中按 depth 周期性注入角色精简摘要，防止长上下文截断后角色性格漂移。

#### Scenario: 长对话角色一致性
- **WHEN** 裁剪后对话历史 token 数 > `maxContextTokens * 0.5`
- **THEN** 在裁剪后消息列表的 depth=4 位置插入一条 system 消息：`[角色锚定] {{char}} 的核心设定：{{personality_summary}}。始终以 {{char}} 视角回复，禁止替 {{user}} 发言。`
- **AND** `personality_summary` 由 `buildCharacterContext` 提取 `personality` 字段前 200 字符生成
- **AND** 若 `personality` 为空则使用 `description` 前 200 字符

#### Scenario: 短对话不锚定
- **WHEN** 裁剪后对话历史 token 数 ≤ `maxContextTokens * 0.5`
- **THEN** 不插入深度锚定，避免短对话冗余

### Requirement: 重试/续写去重检测

系统 SHALL 对重试和续写生成的 AI 回复进行 n-gram Jaccard 相似度检测，与上一条 assistant 回复相似度 > 0.8 时自动重新生成。

#### Scenario: 重试去重
- **WHEN** 用户点击"重试"且新生成的回复与原回复 4-gram Jaccard 相似度 > 0.8
- **THEN** 系统自动重新生成（最多 2 次）
- **AND** 若仍相似则保留最后一次结果并在 UI 显示"已尝试 N 次，回复相似度较高"toast 提示

#### Scenario: 续写去重
- **WHEN** 续写触发且新内容与 `initialContent` 重叠率 > 60%
- **THEN** 触发 `continue_nudge_prompt` 提示词约束：`[Continue your last message without repeating its original content.]`
- **AND** 该提示词作为 system 消息插入到对话末尾

#### Scenario: 去重计算性能
- **WHEN** 计算两条回复（各约 500 字）的 4-gram Jaccard 相似度
- **THEN** 计算耗时 < 50ms，不阻塞 UI

### Requirement: 精确 Token 计数

系统 SHALL 使用 `tiktoken/cl100k_base` 编码器进行 token 计数，替代当前的字节估算。

#### Scenario: 中文 token 计数精度
- **WHEN** 计算包含中文字符的消息 token 数
- **THEN** 误差从 ±15% 降至 ±3% 以内（与 OpenAI tiktoken 在线服务对齐）

#### Scenario: tiktoken 加载失败 fallback
- **WHEN** `tiktoken` WASM 加载失败或主进程 IPC 超时
- **THEN** 回退到当前 `text.length / 3.35` 字节估算
- **AND** 在日志中记录 fallback 事件，UI 不显示错误

#### Scenario: 计数缓存
- **WHEN** 同一 `messageId` 的消息内容未变
- **THEN** 直接返回缓存的 token 数，不重复计算

### Requirement: 对话历史 RAG 检索

系统 SHALL 在每次 AI 请求前检索本会话历史的向量相似片段，注入 system prompt"区域 2：本会话相关历史片段"。

#### Scenario: 长对话跨轮记忆
- **WHEN** 对话历史超过 20 轮且当前用户消息触发向量检索（相似度 > 0.6）
- **THEN** 检索本会话历史 topK=3 相关片段，按时间顺序注入 system prompt
- **AND** 注入位置在"区域 1：相关背景知识"之后

#### Scenario: 短对话不检索
- **WHEN** 对话历史 ≤ 20 轮
- **THEN** 跳过对话历史 RAG 检索（原始消息已在上下文中）

#### Scenario: 增量向量化
- **WHEN** 对话每增加 5 轮（即第 5、10、15... 轮用户消息后）
- **THEN** 自动调用 `ChatVectorizationService.vectorizeIncremental` 增量向量化最近 5 轮消息
- **AND** 向量化失败不阻塞对话主流程（仅记录日志）

#### Scenario: 检索失败降级
- **WHEN** 对话历史 RAG 检索失败（向量服务不可用）
- **THEN** 跳过该步骤，对话主流程不受影响
- **AND** 在日志中记录失败原因

### Requirement: DRY 采样防重复第二道防线

系统 SHALL 在请求体中注入 SillyTavern 风格的 DRY 采样参数（对支持后端），作为防重复的采样层防线，与应用层的 n-gram Jaccard 去重形成双重防护。

#### Scenario: 支持后端启用 DRY 采样
- **WHEN** 当前 AI 后端 `engineCapabilities.supportsDrySampler` 为 true（如 text-generation-webui、koboldcpp、aphrodite）
- **THEN** 请求体包含 `dry_multiplier=0.8, dry_base=1.75, dry_allowed_length=2`
- **AND** `no_repeat_ngram_size=0`（默认关闭，避免影响中文流畅性，用户可手动开启）

#### Scenario: 不支持后端跳过
- **WHEN** 当前 AI 后端 `supportsDrySampler` 为 false（如 OpenAI、Anthropic）
- **THEN** 请求体不包含 DRY 采样字段，仅依赖应用层 n-gram Jaccard 去重

#### Scenario: 用户自定义 DRY 参数
- **WHEN** 用户在 `ParameterPanel` 高级区开启"DRY 采样"并调节滑块
- **THEN** 自定义值覆盖默认值，持久化到 `character-session-<cardId>` localStorage
- **AND** `no_repeat_ngram_size` 滑块（0-10，默认 0）单独可调

### Requirement: Budget 双向预留上下文裁剪

系统 SHALL 使用基于 token budget 的双向预留裁剪算法替代当前的"末尾累加 + minMessagesToKeep 回退"。

#### Scenario: 必填项优先注入
- **WHEN** 调用 `truncateMessages`
- **THEN** 先 reserve 必填项：system prompt、角色深度锚定、stop 序列预留 token（约 512）、response 预留（`reservedForResponse`）
- **AND** 剩余预算用于对话历史

#### Scenario: 倒序填充对话历史
- **WHEN** 剩余预算 > 0
- **THEN** 从最新消息向前累加，每条消息 `canAfford` 检查通过则入栈，超限即 break
- **AND** 不再使用 `minMessagesToKeep` 回退（保证必填项一定注入）

#### Scenario: 示例消息强保留
- **WHEN** 角色卡配置了 `mes_example`
- **THEN** 示例消息在 token 预算中独立 reserve，保证不被裁剪

---

## MODIFIED Requirements

### Requirement: 上下文裁剪算法

**原实现**：`truncateMessages` 从消息末尾向前累加，预算 = `maxContextTokens - systemPromptTokens - reservedForResponse`，超限即停；预算耗尽时回退到最近 `minMessagesToKeep*2` 条。

**新实现**：基于 token budget 的双向预留裁剪——必填项（system prompt、角色深度锚定、stop 序列预留、示例消息）先 reserve，可选项（对话历史）按"最新优先"倒序填充，超限即 break，无 `minMessagesToKeep` 回退（保证必填项一定注入）。

### Requirement: AI 超参数默认值

**原默认值**：`temperature=0.7, top_p=0.9, frequency_penalty=0.0, presence_penalty=0.0`

**新默认值**：`temperature=0.7`（保留）、`top_p=0.95`、`frequency_penalty=0.3`、`presence_penalty=0.3`、`repetition_penalty=1.1`（仅对支持后端，通过 `supportsRepPen` 能力探测）、`dry_multiplier=0.8`、`dry_base=1.75`、`dry_allowed_length=2`、`no_repeat_ngram_size=0`（仅对支持后端，通过 `supportsDrySampler` 能力探测）

**调整依据**：SillyTavern `default/content/presets/textgen/Default.json` 使用 `rep_pen=1.1`、`top_p=0.95`；`textgen-settings.js:176-178` 提供 DRY 采样（`dry_multiplier=0.0/dry_base=1.75/dry_allowed_length=2`）与 `no_repeat_ngram_size=0`（第 159 行）作为防重复采样层；当前 `frequency_penalty=0/presence_penalty=0` 是重复内容的核心成因之一。注：SillyTavern 默认 `dry_multiplier=0.0`（关闭），creative-cafe 调整为 `0.8` 启用防重复；DRY 采样与应用层 n-gram Jaccard 去重形成"采样层 + 应用层"双重防线。

### Requirement: ChatEngine AI 引擎调用

**原实现**：`ChatEngine.ts` 自实现 `buildApiUrl/buildRequestBody`，与 main 进程 `AIService` 平行；`max_tokens` fallback 在 hooks.ts=8192 / ChatEngine.ts=10240 不一致。

**新实现**：复用 main 进程 `AIService.streamChatAPI` + `SSEStreamParser`（具体重构由 `audit-and-refactor-core-modules` spec 主导，本规范仅消费其统一后的接口）；`ChatEngine.ts` 仅保留状态管理（流式累积、消息更新、错误处理）职责；`max_tokens` fallback 统一为 8192。

**Migration**：本项依赖 `audit-and-refactor-core-modules` 完成 AI 引擎统一，若该 spec 未完成则本规范的 stop sequences、超参数调整等仍可独立实施（直接在 `ChatEngine.ts` 现有 `buildRequestBody` 中修改）。

---

## REMOVED Requirements

### Requirement: minMessagesToKeep 回退机制

**Reason**：budget 双向预留裁剪保证必填项一定注入，不再需要"预算耗尽时回退到最近 N 条"的兜底；该回退反而可能因强制保留消息而挤占必填项预算。

**Migration**：`minMessagesToKeep` 配置项保留但语义改为"软下限"——仅在预算允许时尽量保留至少 N 条最近消息，不强制。
