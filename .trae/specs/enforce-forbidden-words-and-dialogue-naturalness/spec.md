# 内容约束硬执行与对话自然度强化 Spec

## Why

用户报告两个问题：① 对话内容存在明显"AI味"；② 系统未严格遵守预设的内容约束词表（Settings → 内容约束）。经全面分析，根因已定位：

1. **禁词接线断裂（功能失效级 bug）**：`ForbiddenWordsPromptProvider`（Spec: add-forbidden-words-prompt）只注册在 pipeline/providers——该管线是**休眠路径**（hooks.new 未被任何组件引用），线上实际执行的 legacy hooks + PromptBuilder 路径**零引用 forbiddenWords**。用户配置的内容约束从未进入对话请求，设置形同虚设。
2. **提示词软约束本质**：即使接线，LLM 对指令遵守率 <100%。用户要求"100% 遵守"，唯一途径是输出后校验 + 自动重试 + 硬替换兜底（Post-enforcement）。
3. **采样层指令遵循崩溃**：docs/llamacpp-model-compat-analysis.md P1（高）已证实——当前引擎 temp=1 + top_p=1 等于禁用核采样的随机采样，Qwen 官方点名此配置导致指令遵循崩溃；这同时解释了 AI 腔/重复与禁词失效。该文档 5.1/5.2 已给出按模型系列的修正参数建议，本 spec 落地应用侧。
4. **对话流缺词表级去 AI 味约束**：RP 词表（"冰冷的""嘴角勾起一抹"等，Spec: polish-deai-humanizer v3）已接入润色/生成/角色卡生成，但**未接入 RP 对话流本身**。
5. **训练数据不可控（技术边界声明）**：应用调用外部 LLM API，无法修改模型训练数据。可控层为：提示词工程、采样参数、上下文管理、输出后处理四层——本 spec 覆盖提示词（词表接线）、采样（预设修正）、后处理（合规硬执行）三层。

## What Changes

- **禁词线上接线（bug 修复）**：hooks.ts 请求组装处注入 `buildForbiddenWordsPrompt(config)` 纯函数输出，覆盖 dialogue / continuation / user-reply 全部对话型请求
- **输出合规硬执行层**：新增 complianceChecker 纯函数（编译禁词 + 检测命中）；hooks.ts 响应完成后校验 → 命中则带违规反馈自动重试（默认上限 2 次）→ 仍命中则硬替换兜底
- **配置模型扩展**：`ForbiddenWordsConfig` 新增 `enforcement`（'prompt-only' | 'retry' | 'retry-and-replace'，默认 'retry-and-replace'）、`replacementText`（默认 '***'）、`maxRetries`（默认 2）；存量配置缺字段时取默认值（无需迁移）
- **设置面板扩展**：内容约束标签页（BlockedWordsSettings）新增执行模式/替换文本/重试次数控件
- **对话 RP 词表注入**：humanizerPolish.ts 新增对话场景变体（像真人说话文体总则 + RP 词表 + 完整指南，完整接入不简写——遵循用户既定决策），hooks.ts 对话请求注入，设置面板加开关（默认开）
- **对话采样预设**：按模型系列（qwen/gemma/llama 系）覆盖采样参数，取值对齐 llamacpp 兼容文档 5.1 建议表；设置面板加开关（默认关，用户按需启用）
- **合规指标**：每轮响应输出 `[Compliance]` 日志（命中词/重试次数/兜底触发/最终干净率），与既有 `[Diversity]` 指标并列，构成 A/B 对比验证的量化基础

### 不做（明确排除，防止范围蔓延）

- 不建独立 A/B 测试框架——用"设置开关切换 + 指标日志前后对比"实现等效验证（同一角色、同一开场、开关切换各跑 N 轮），避免过度设计
- 不改 llama-server 启动参数与引擎预设全局结构（那是 llamacpp 文档 5.2 的独立议题）——本 spec 仅在**对话请求层**按模型系列覆盖采样参数
- 不动禁词语义类别判定（类别 description 的语义约束仍靠提示词；硬执行层只保证 words 列表的 100%——语义级 100% 需语义模型，超出本轮范围，硬替换兜底覆盖）

## Impact

- Affected specs: `add-forbidden-words-prompt`（其 Task 3 Provider 仍留休眠管线作配套；线上等价物本次补齐）、`polish-deai-humanizer`（新增对话变体）、`reduce-dialogue-ai-flavor-and-repetition`（自然度指标的合规维度扩展）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（禁词注入点 + 合规校验/重试/兜底插入点 + 采样覆盖点 + 对话词表注入点）
  - `src/shared/prompts/humanizerPolish.ts`（对话变体）
  - `src/shared/types/forbiddenWords.ts`（配置模型扩展）
  - `src/renderer/components/Settings/BlockedWordsSettings.tsx`（设置面板扩展）
  - `src/renderer/utils/complianceChecker.ts`（新增，纯函数）
  - `src/renderer/components/Character/CharacterDialogueChat/utils/`（可能放合规检测，与 diversityMetrics 同级）

## ADDED Requirements

### Requirement: 禁词指令线上注入（接线修复）
系统 SHALL 在全部对话型 AI 请求（dialogue / continuation / user-reply）的 system prompt 中注入用户配置的内容约束指令块（复用 `buildForbiddenWordsPrompt` 纯函数，含锚点防重复守卫）。

#### Scenario: 配置了内容约束的正常对话
- **WHEN** 用户在设置中启用内容约束并配置了至少一个有效类别，发起对话
- **THEN** 对话请求的 system prompt 包含 "Forbidden Word List (Strict Constraints)" 块；日志记录注入的类别数

#### Scenario: 未配置或未启用
- **WHEN** forbiddenWords 未启用或类别为空
- **THEN** system prompt 不含禁词块，零额外 token

### Requirement: 输出合规硬执行
系统 SHALL 在每轮 AI 响应完成后检测禁词命中，按执行模式处理：'retry' 命中时带违规反馈自动重试（不超过 maxRetries）；'retry-and-replace' 重试超限后硬替换命中词并保留回复；'prompt-only' 仅提示词约束（现状行为）。

#### Scenario: 命中禁词且重试成功
- **WHEN** 模型回复包含禁词，enforcement='retry-and-replace'，重试第 1 次后干净
- **THEN** 最终显示干净回复；`[Compliance]` 日志记录：命中词、重试 1 次、结果 clean-by-retry

#### Scenario: 重试超限触发硬替换
- **WHEN** 重试 maxRetries 次后仍命中
- **THEN** 命中词被替换为 replacementText（默认 '***'）后入库显示；日志记录 replaced；替换不得破坏句内其他文本

#### Scenario: 流式渲染与校验的关系
- **WHEN** 流式响应进行中
- **THEN** 合规校验在流完成后执行；若触发重试，按现有重试机制的流式处理模式执行（不向用户展示中间脏内容）

### Requirement: 合规指标
系统 SHALL 每轮响应输出合规指标日志：`[Compliance] round=N hit=<词> mode=<模式> retries=<次数> result=<clean|clean-by-retry|replaced>`，作为修正前后对比的量化依据。

#### Scenario: 指标输出
- **WHEN** 任一对话响应完成
- **THEN** 日志包含该轮 Compliance 记录（无命中时 result=clean）

### Requirement: 对话去 AI 味词表注入
系统 SHALL 为对话请求注入对话场景去 AI 味规则块（RP 词表 + 完整 27 模式指南 + "像真人说话"文体总则），默认开启，设置面板提供开关。

#### Scenario: 默认开启
- **WHEN** 用户未修改设置并发起对话
- **THEN** system prompt 包含对话去 AI 味规则块（与 reduce-dialogue-ai-flavor 的行为规则块共存、锚点互不冲突）

### Requirement: 对话采样预设
系统 SHALL 提供按模型系列的对话采样参数覆盖（对齐 llamacpp 兼容文档 5.1 建议表：qwen 系 temp 0.7 / top_p 0.8 / min_p 0.0；gemma 系 temp 1.0 / top_p 0.95 / min_p 0.01），默认关闭；开启时仅对匹配系列的引擎生效，未匹配系列保持用户配置不变。

#### Scenario: qwen 系模型开启预设
- **WHEN** 用户开启采样预设且当前引擎 model_name 匹配 qwen 系列
- **THEN** 对话请求采样参数按预设表覆盖；日志记录覆盖项

## MODIFIED Requirements

### Requirement: ForbiddenWordsConfig 数据模型
在现有 enabled/categories 基础上新增 enforcement（默认 'retry-and-replace'）、replacementText（默认 '***'）、maxRetries（默认 2）三个可选字段；存量配置无这些字段时行为取默认值（合规执行模式生效，非 prompt-only——因用户诉求即 100% 执行）。

## REMOVED Requirements

无（ForbiddenWordsPromptProvider 保留在休眠管线作为新架构配套，不删除）。
