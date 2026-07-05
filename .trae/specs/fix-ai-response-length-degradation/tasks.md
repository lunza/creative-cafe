# Tasks

## 诊断与可观测性

- [x] Task 1: 实现回复长度诊断日志
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.hooks.ts` 的 `requestAIResponse` 函数体内记录请求起始时间戳（`requestStartTimeRef.current = Date.now()`），在 `engine.onComplete` 回调中计算生成耗时
  - [x] SubTask 1.2: 在 `engine.onComplete` 中统计 `finalContent` 的字符数（`finalContent.length`）和 token 数（调用 `TokenCounter.count(finalContent)`），并从 `getEffectiveParams()` 读取当前 `max_tokens / frequency_penalty / presence_penalty / dry_multiplier` 参数值
  - [x] SubTask 1.3: 在 `engine.onComplete` 末尾输出 console 日志：`[ResponseLength] round=N, chars=M, tokens=T, duration=Ds, max_tokens=X, freq_pen=F, pres_pen=P, dry=D`，同时通过 `addLog` 写入日志面板
  - [x] SubTask 1.4: 维护 `responseLengthHistoryRef.current: number[]`（最近 20 轮字符数），供 Task 4 检测连续短回复使用

## 参数默认值调整

- [x] Task 2: 降低防重复参数默认值
  - [x] SubTask 2.1: 在 `parameterConfigs.ts` 中将 `frequency_penalty` 的 `defaultValue` 从 `0.3` 改为 `0.1`，并更新 `tooltip` 说明（提及"避免与 DRY 叠加导致回复缩短"）
  - [x] SubTask 2.2: 在 `parameterConfigs.ts` 中将 `presence_penalty` 的 `defaultValue` 从 `0.3` 改为 `0.1`，并同步更新 `tooltip`
  - [x] SubTask 2.3: 检查 `CharacterDialogueChat.hooks.ts::getEffectiveParams` 中是否还有硬编码的 `0.3` 兜底值，若有则同步改为 `0.1`（当前代码中 frequency_penalty/presence_penalty 仅在 customParams/globalEngine 显式设置时取值，无硬编码兜底，需确认）

## 提示词长度引导

- [x] Task 3: 注入回复长度引导约束
  - [x] SubTask 3.1: 在 `CharacterDialogueChat.types.ts` 的 `AIParameterConfig` 接口中新增可选字段 `min_response_chars?: number`
  - [x] SubTask 3.2: 在 `PromptBuilder.ts` 中新增 `buildLengthGuidancePrompt(minResponseChars: number, strengthen: boolean = false): string` 函数——默认约束形如 `【回复要求】{{char}} 的每次回复应不少于 X 字，包含详细的动作描写、语言对话和内心活动，避免简短敷衍的回复。`；当 `strengthen=true` 时追加强化段：`【重要提醒】你最近的回复过短。请务必每次回复至少 X 字，展开细节描写。`
  - [x] SubTask 3.3: 修改 `buildCharacterContext` 函数签名，新增可选参数 `options?: { minResponseChars?: number; strengthenLength?: boolean }`，在函数末尾（"角色卡为绝对权威约束"之后）追加 `buildLengthGuidancePrompt` 输出（仅当 `minResponseChars > 0` 时追加）
  - [x] SubTask 3.4: 在 `usePromptBuilder` 或 `requestAIResponse` 调用链中传入 `minResponseChars`——读取 `customParameters.min_response_chars ?? 300` 和 `responseLengthHistoryRef`（Task 4 使用）决定的 `strengthenLength` 标志

- [x] Task 4: 连续短回复强化约束检测
  - [x] SubTask 4.1: 在 `CharacterDialogueChat.hooks.ts` 中新增辅助函数 `shouldStrengthenLength(history: number[], threshold: number): boolean`——当 `history.length >= 3` 且最后 3 轮均 `< threshold` 时返回 `true`
  - [x] SubTask 4.2: 在 `requestAIResponse` 构建提示词前调用 `shouldStrengthenLength(responseLengthHistoryRef.current, minResponseChars)` 得到 `strengthenLength` 标志，传入 `buildCharacterContext`
  - [x] SubTask 4.3: 在 `engine.onComplete` 中更新 `responseLengthHistoryRef.current`（push 当前 `finalContent.length`，超过 20 轮时 shift 出队）
  - [x] SubTask 4.4: 当下一轮回复字符数 `>= minResponseChars` 时，强化约束自动失效（因 `shouldStrengthenLength` 基于历史动态判定，无需显式清除）

## 防重复强度预设

- [x] Task 5: 实现防重复强度三档预设
  - [x] SubTask 5.1: 在 `parameterConfigs.ts` 中新增 `ANTI_REPEAT_PRESETS` 常量：`[{ key: 'loose', label: '宽松', values: { frequency_penalty: 0, presence_penalty: 0, dry_multiplier: 0 } }, { key: 'standard', label: '标准', values: { frequency_penalty: 0.1, presence_penalty: 0.1, dry_multiplier: 0.4 } }, { key: 'strict', label: '严格', values: { frequency_penalty: 0.3, presence_penalty: 0.3, dry_multiplier: 0.8 } }]`
  - [x] SubTask 5.2: 在 `ParameterPanel.tsx` 的"自定义停止序列"区块上方新增"防重复强度预设"区块：3 个 Button 单选切换，点击时通过 `onParameterChange` 一次性写入三个参数值
  - [x] SubTask 5.3: 预设选中状态根据 `customParameters` 中三个参数的实际值反推（若与某预设完全匹配则高亮该预设，否则不高亮）
  - [x] SubTask 5.4: 当 `engineCapabilities?.supportsDrySampler !== true` 时，预设仍可切换但仅写入 `frequency_penalty / presence_penalty`（`dry_multiplier` 因后端不支持而跳过）

## Stop Sequences 优化

- [x] Task 6: 优化停止序列格式以减少误触发
  - [x] SubTask 6.1: 在 `PromptBuilder.ts::buildStopSequences` 中将默认停止序列数组改为先双换行前缀、后单换行前缀的顺序：`['\n\n${userName}:', '\n\n${userName}：', '\n\n用户:', '\n\n用户：', '\n\nUser:', '\n\nUser：', '\n${userName}:', '\n${userName}：', '\n用户:', '\n用户：', '\nUser:', '\nUser：']`（双换行优先匹配，单换行兜底）
  - [x] SubTask 6.2: 更新 `buildStopSequences` 函数注释，说明"双换行前缀优先以减少 AI 在回复中引用用户话语时的误触发；单换行变体作为兜底防止后端按子串匹配时漏判"
  - [x] SubTask 6.3: 验证 `resolveStopForRequestBody`（在 `ChatEngine.types.ts` 中）对数组长度无限制——双换行+单换行共 12 个元素不会触发任何截断逻辑

## 配置 UI

- [x] Task 7: 在 ParameterPanel 中暴露 min_response_chars 配置
  - [x] SubTask 7.1: 在 `parameterConfigs.ts` 中新增 `MIN_RESPONSE_CHARS_CONFIG` 常量（独立于 `PARAMETER_CONFIGS`，因为它不是采样参数）：`{ min: 100, max: 2000, step: 50, defaultValue: 300, tooltip: '...' }`
  - [x] SubTask 7.2: 在 `ParameterPanel.tsx` 中新增"回复长度引导"区块（位于"防重复强度预设"下方），包含一个 Slider（100-2000，步进 50）和当前值显示
  - [x] SubTask 7.3: Slider 的 `onChange` 通过 `onParameterChange({ min_response_chars: value })` 持久化到 `customParameters`
  - [x] SubTask 7.4: 当滑块值等于默认值 300 时，从 `customParameters` 中删除该字段（与现有 `handleSliderAfterChange` 逻辑一致，避免"已使用自定义参数"徽章误显示）

## 测试与验证

- [x] Task 8: 单元测试与回归验证
  - [x] SubTask 8.1: 在 `PromptBuilder.test.ts`（或新建 `PromptBuilder.lengthGuidance.test.ts`）中验证 `buildLengthGuidancePrompt` 在默认/强化两种模式下的输出包含正确字数和"重要提醒"段落
  - [x] SubTask 8.2: 在 `PromptBuilder.test.ts` 中验证 `buildCharacterContext` 传入 `minResponseChars=300` 时输出包含"不少于 300 字"约束，未传入时不包含
  - [x] SubTask 8.3: 在 `PromptBuilder.test.ts` 中验证 `buildStopSequences` 返回数组前 6 项为双换行前缀、后 6 项为单换行前缀，且包含所有中英文用户名变体
  - [x] SubTask 8.4: 在 `parameterConfigs.test.ts`（若不存在则新建）中验证 `frequency_penalty` 和 `presence_penalty` 默认值为 `0.1`，且 `ANTI_REPEAT_PRESETS` 三档预设值符合 spec
  - [x] SubTask 8.5: 在 `CharacterDialogueChat.hooks.test.ts`（或新建 `responseLengthDiagnostics.test.ts`）中验证 `shouldStrengthenLength` 函数：3 轮均低于阈值返回 true，2 轮低于阈值返回 false，1 轮达到阈值返回 false
  - [x] SubTask 8.6: 运行 `npm test`（或 `npm run test:unit`）确认全部测试通过，无新增编译错误

# Task Dependencies

- Task 4 依赖 Task 1（使用 `responseLengthHistoryRef`）和 Task 3（使用 `buildLengthGuidancePrompt`）
- Task 7 依赖 Task 3（`min_response_chars` 字段已在 `AIParameterConfig` 中定义）
- Task 8 依赖 Task 1-7 全部完成
- Task 1、Task 2、Task 3、Task 5、Task 6 相互独立，可并行实施
