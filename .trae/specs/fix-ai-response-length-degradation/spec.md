# 修复对话模式 AI 回复长度递减现象 Spec

## Why

用户反馈：对话模式持续交互中，AI 回复长度呈现明显递减趋势——初始轮次约 500 字，几轮后降至 100 余字。这严重影响角色扮演的沉浸感和对话质量。

经初步代码排查，发现以下嫌疑因素：
1. **提示词缺少长度引导**：系统提示和对话历史中没有维持回复长度的约束，AI 通过上下文学习复制逐渐缩短的回复模式（LLM 固有特性）
2. **多重防重复参数叠加过度惩罚**：`frequency_penalty=0.3` + `presence_penalty=0.3` + `repetition_penalty=1.1` + DRY 采样（`dry_multiplier=0.8`）四重防重复机制叠加，可能导致 AI 为避免重复而过度缩短回复
3. **stop sequences 可能误触发**：`buildStopSequences` 注入 `\n用户:`、`\nUser:` 等变体，如果 AI 在回复中引用用户话语（如角色转述"用户说..."），可能被后端 stop 截断
4. **缺少诊断工具**：当前无法量化每轮回复的 token 数/字数/生成时间，难以精确定位递减拐点

## What Changes

### 诊断层
- 在 `requestAIResponse` 的 onComplete 回调中记录每轮 AI 回复的 **token 数、字数、生成耗时、max_tokens 参数**，输出到 console + 日志面板
- 新增"回复长度趋势"可视化（可选，在 TokenManagementPanel 高级区展示最近 20 轮回复长度折线图）

### 参数调整层
- 将 `frequency_penalty` 默认值从 `0.3` 降为 `0.1`（轻微惩罚，避免过度缩短）
- 将 `presence_penalty` 默认值从 `0.3` 降为 `0.1`
- 当 `supportsDrySampler=true` 且 `dry_multiplier > 0` 时，在 UI 显示提示："DRY 采样 + frequency_penalty 叠加可能导致回复缩短，建议二选一"
- 提供"防重复强度"三档预设：宽松（freq=0/pres=0/dry=0）、标准（freq=0.1/pres=0.1/dry=0.4）、严格（freq=0.3/pres=0.3/dry=0.8）

### 提示词引导层
- 在 `buildDialoguePrompt`（或 `buildCharacterContext`）末尾追加回复长度引导约束：`【回复要求】{{char}} 的每次回复应不少于 {{min_response_chars}} 字，包含详细的动作描写、语言对话和内心活动。避免简短敷衍的回复。`
- `min_response_chars` 默认 300，可在 ParameterPanel 中配置
- 当检测到连续 3 轮回复均低于 `min_response_chars` 时，自动在系统提示中强化长度约束（追加更强烈的引导语）

### Stop Sequences 优化
- 审查 `buildStopSequences` 返回的停止序列，确保不会误触发（如 `\n用户:` 只在行首且后跟内容时才匹配，而非出现在回复中间）
- 如果后端支持，优先使用更精确的停止序列格式（如 `\n\n用户:` 双换行前缀，减少误匹配）

## Impact

- **Affected specs**: `optimize-chat-ai-intelligence`（Task 6 超参数默认值需同步调整）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（诊断日志 + min_response_chars 检测）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（长度引导约束注入）
  - `src/renderer/components/Character/CharacterDialogueChat/parameterConfigs.ts`（默认值调整）
  - `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx`（min_response_chars 配置 UI + 防重复强度预设）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts::buildStopSequences`（停止序列优化）

## ADDED Requirements

### Requirement: 回复长度诊断日志
系统 SHALL 在每轮 AI 回复完成后记录诊断信息，包括回复 token 数、字数、生成耗时、max_tokens 参数、frequency_penalty、presence_penalty、dry_multiplier 当前值。

#### Scenario: 正常回复完成
- **WHEN** AI 回复流式完成（onComplete 触发）
- **THEN** console 输出 `[ResponseLength] round=N, chars=M, tokens=T, duration=Ds, max_tokens=X, freq_pen=F, pres_pen=P, dry=D`
- **AND** 日志面板显示同样信息

### Requirement: 回复长度引导约束
系统 SHALL 在对话提示词中注入回复长度引导约束，引导 AI 生成不少于 `min_response_chars` 字的回复。

#### Scenario: 默认长度引导
- **WHEN** 用户发送消息触发 AI 回复
- **THEN** 系统提示末尾包含长度引导约束："每次回复应不少于 300 字"
- **AND** `min_response_chars` 可在 ParameterPanel 中配置（范围 100-2000，默认 300）

#### Scenario: 连续短回复强化约束
- **WHEN** 连续 3 轮 AI 回复均低于 `min_response_chars`
- **THEN** 系统提示中追加强化约束："注意：你最近的回复过短。请确保每次回复至少 {{min_response_chars}} 字，包含详细描写。"
- **AND** 强化约束在下次回复达到长度要求后自动移除

### Requirement: 防重复强度预设
系统 SHALL 提供三档防重复强度预设，避免用户不理解参数关系导致过度惩罚。

#### Scenario: 切换预设
- **WHEN** 用户在 ParameterPanel 选择"宽松"预设
- **THEN** frequency_penalty=0, presence_penalty=0, dry_multiplier=0
- **WHEN** 用户选择"标准"预设
- **THEN** frequency_penalty=0.1, presence_penalty=0.1, dry_multiplier=0.4
- **WHEN** 用户选择"严格"预设
- **THEN** frequency_penalty=0.3, presence_penalty=0.3, dry_multiplier=0.8

## MODIFIED Requirements

### Requirement: AI 超参数默认值
`frequency_penalty` 默认值从 `0.3` 修改为 `0.1`；`presence_penalty` 默认值从 `0.3` 修改为 `0.1`。原因：`0.3` 与 DRY 采样（`dry_multiplier=0.8`）叠加导致过度惩罚，AI 为避免重复而缩短回复。`0.1` 提供轻微惩罚而不影响回复长度。

### Requirement: Stop Sequences 防抢话
`buildStopSequences` 返回的停止序列优化为 `\n\n用户:`（双换行前缀）格式，减少 AI 在回复中间引用用户话语时的误触发。保留单换行变体作为兜底。
