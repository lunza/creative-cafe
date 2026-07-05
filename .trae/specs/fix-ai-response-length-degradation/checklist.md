# Checklist

## 诊断层

- [x] 每轮 AI 回复完成后，console 输出 `[ResponseLength] round=N, chars=M, tokens=T, duration=Ds, max_tokens=X, freq_pen=F, pres_pen=P, dry=D` 格式日志
- [x] 同样信息通过 `addLog` 写入日志面板，用户可在日志面板查看
- [x] `responseLengthHistoryRef` 维护最近 20 轮回复字符数，供连续短回复检测使用
- [x] 生成耗时从请求开始到 `engine.onComplete` 触发的真实时间差，单位秒

## 参数默认值

- [x] `parameterConfigs.ts` 中 `frequency_penalty.defaultValue` 为 `0.1`
- [x] `parameterConfigs.ts` 中 `presence_penalty.defaultValue` 为 `0.1`
- [x] 两个参数的 `tooltip` 说明更新，提及"避免与 DRY 叠加导致回复缩短"
- [x] `getEffectiveParams` 中无残留的 `0.3` 硬编码兜底值
- [x] 已有 `optimize-chat-ai-intelligence` spec 中的相关 Task 6 默认值描述与本 spec 一致（如不一致则在 spec 文档中注明本 spec 覆盖旧值）

## 提示词长度引导

- [x] `AIParameterConfig` 接口新增 `min_response_chars?: number` 字段
- [x] `buildLengthGuidancePrompt(minResponseChars, strengthen)` 函数存在且返回包含字数要求的约束字符串
- [x] 默认模式输出包含"不少于 X 字"和"包含详细的动作描写、语言对话和内心活动"
- [x] 强化模式（`strengthen=true`）输出追加"【重要提醒】你最近的回复过短"段落
- [x] `buildCharacterContext` 新增可选 `options` 参数，当 `minResponseChars > 0` 时在末尾追加长度引导
- [x] `min_response_chars` 默认值为 300（在 `customParameters.min_response_chars ?? 300` 取值）
- [x] `requestAIResponse` 调用链中正确传入 `minResponseChars` 和 `strengthenLength`

## 连续短回复强化

- [x] `shouldStrengthenLength(history, threshold)` 函数存在且逻辑正确：`history.length >= 3` 且最后 3 轮均 `< threshold` 时返回 `true`
- [x] `engine.onComplete` 中 push 当前回复字符数到 `responseLengthHistoryRef.current`，超过 20 轮时 shift 出队
- [x] `requestAIResponse` 构建提示词前调用 `shouldStrengthenLength` 决定 `strengthenLength` 标志
- [x] 当下一轮回复字符数 `>= minResponseChars` 时，强化约束自动失效（基于历史动态判定）

## 防重复强度预设

- [x] `ANTI_REPEAT_PRESETS` 常量定义三档：宽松（0/0/0）、标准（0.1/0.1/0.4）、严格（0.3/0.3/0.8）
- [x] `ParameterPanel.tsx` 中新增"防重复强度预设"区块，3 个 Button 单选切换
- [x] 点击预设时通过 `onParameterChange` 一次性写入三个参数值
- [x] 预设选中状态根据 `customParameters` 实际值反推高亮
- [x] 当 `supportsDrySampler !== true` 时，预设仅写入 `frequency_penalty / presence_penalty`，`dry_multiplier` 跳过

## Stop Sequences 优化

- [x] `buildStopSequences` 返回数组前 6 项为 `\n\n` 双换行前缀
- [x] 后 6 项为 `\n` 单换行前缀作为兜底
- [x] 包含所有中英文用户名变体（`${userName}:` `${userName}：` `用户:` `用户：` `User:` `User：`）
- [x] `resolveStopForRequestBody` 对 12 个元素的数组无截断行为
- [x] 函数注释说明"双换行优先以减少误触发，单换行兜底"

## 配置 UI

- [x] `MIN_RESPONSE_CHARS_CONFIG` 常量定义（min=100, max=2000, step=50, default=300）
- [x] `ParameterPanel.tsx` 新增"回复长度引导"区块，位于"防重复强度预设"下方
- [x] Slider 100-2000，步进 50，显示当前值
- [x] `onChange` 通过 `onParameterChange({ min_response_chars: value })` 持久化
- [x] 滑块值等于默认值 300 时从 `customParameters` 删除该字段（避免"已使用自定义参数"徽章误显示）

## 测试

- [x] `buildLengthGuidancePrompt` 默认/强化两种模式输出正确（含字数和"重要提醒"段落）
- [x] `buildCharacterContext` 传入 `minResponseChars=300` 时输出包含"不少于 300 字"，未传入时不包含
- [x] `buildStopSequences` 返回数组前 6 项双换行、后 6 项单换行，且包含所有变体
- [x] `frequency_penalty` 和 `presence_penalty` 默认值为 `0.1`
- [x] `ANTI_REPEAT_PRESETS` 三档预设值符合 spec
- [x] `shouldStrengthenLength` 函数：3 轮均低于阈值返回 true，2 轮低于阈值返回 false，1 轮达到阈值返回 false
- [x] `npm test` 全部通过，无新增编译错误

### Task 8 测试文件清单（2026-07-04 完成）

- **新建** `src/renderer/components/Character/CharacterDialogueChat/__tests__/PromptBuilder.lengthGuidance.test.ts`（19 tests）
  - 覆盖 `buildLengthGuidancePrompt` 默认/强化/边界（minResponseChars<=0、charName 缺省/空）
  - 覆盖 `buildCharacterContext` 第三参数 `options`（minResponseChars 注入、strengthenLength 强化、向后兼容、minResponseChars=0 关闭、长度引导段位置）
- **新建** `src/renderer/components/Character/CharacterDialogueChat/__tests__/responseLengthDiagnostics.test.ts`（18 tests）
  - 覆盖 `shouldStrengthenLength` 触发/不触发场景、阈值边界、回复长度边界（含 0 值容错）、非数组输入容错
- **修改** `src/renderer/components/Character/CharacterDialogueChat/__tests__/buildStopSequences.test.ts`（17 tests，原 13 tests）
  - 旧 6 项断言全部更新为 12 项（6 双换行 + 6 单换行）
  - 新增"前 6 项以 \\n\\n 开头"、"后 6 项以 \\n 开头（非 \\n\\n）"、"12 项精确内容"测试
  - 新增"用户名=User/用户 时去重为 8 项"测试
- **修改** `src/renderer/components/Character/CharacterDialogueChat/__tests__/parameterConfigs.test.ts`（36 tests，原 23 tests）
  - 旧 `frequency_penalty` / `presence_penalty` 默认值断言 0.3 → 0.1
  - 新增 `ANTI_REPEAT_PRESETS` 三档预设测试（loose/standard/strict）
  - 新增 `MIN_RESPONSE_CHARS_CONFIG` 配置测试（min/max/step/defaultValue/tooltip）
- **修改** `src/renderer/components/Common/ChatEngine/__tests__/resolveStopForRequestBody.test.ts`
  - 旧集成测试断言首元素为 `\n张三:`，更新为 `\n\n张三:`（双换行前缀优先）
  - **重点标记**：spec Task 6 改变了 `buildStopSequences` 默认顺序（双换行优先），导致此处的集成测试失败；这是 spec 变更的预期影响，已同步更新断言

## 文档同步

- [x] 更新 `docs/SILLYTAVERN_TECHNICAL_ANALYSIS.md` 中关于 `frequency_penalty / presence_penalty` 默认值的描述（如涉及）
- [x] 更新 `doc/04b-character-dialogue-chat-module.md` 中关于默认参数值和长度引导机制的描述
- [x] 在 `docs/` 下记录本次"AI 回复长度递减"问题的根因分析和解决方案（若用户要求）— 根因分析与解决方案已记录在 `spec.md` 的 Why/What Changes 段落，技术文档同步更新
