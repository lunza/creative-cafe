# max_tokens 参数全面评估与治理 Spec

## Why

系统中 `max_tokens` 参数存在**语义混淆**：引擎配置中的 `max_tokens` 字段被用户理解为"上下文窗口大小"（如 1024000 = 1M），但代码将其直接作为 OpenAI API 的 `max_tokens` 参数（含义为"最大输出 token 数"）发送，导致 DeepSeek 等 API 返回 400 Bad Request。此前修复将所有路径的 `max_tokens` 设为 `undefined`（不发送），但这引入了技术债务（`void maxTokens;` 无用变量、遗漏路径、截断检测失效等），需要系统性治理。

## 评估结果

### 1. max_tokens 参数在模型调用中的具体作用和使用频率

| 使用场景 | 当前状态 | 是否发送给 API | 风险 |
|----------|---------|---------------|------|
| 世界书 AI 操作（翻译/润色/审核/生成条目等 13 处） | `void maxTokens;` — 计算但未发送 | 否 | 无直接风险，但技术债务 |
| ChatEngine 对话 | `maxTokens = undefined` | 否 | 无 |
| AIService.callChatAPI | `maxTokens = undefined` | 否 | 无 |
| aiClient.ts（记忆整理） | `max_tokens = undefined` | 否 | 无 |
| useCreativeAI.ts（创意写作） | `void maxTokens;` — 计算但未发送 | 否 | 无直接风险，但技术债务 |
| **characterAIUtils.ts** | **仍直接发送 `engine.max_tokens`** | **是** | **高风险 — 遗漏路径，仍会 400** |
| AIService.getEngineConfig | 仍要求 `max_tokens` 必须配置，否则抛错 | N/A | 中风险 — 限制用户配置灵活性 |
| AIService 图像识别探测 | `max_tokens: 5`（硬编码） | 是 | 无 — 合法的小值 |
| AIService 模型能力检测 | `max_tokens: 1`（硬编码） | 是 | 无 — 合法的小值 |
| 连通性测试 | `activeEngine.max_tokens ?? 1` | 是 | 低风险 — 用 `?? 1` 兜底 |
| 游戏配置 | 独立 `maxTokens` 字段 | 否（独立体系） | 无 |
| 上下文压缩 | `maxTokens` 参数 | 否（内部逻辑） | 无 |

### 2. 移除该参数对系统稳定性、性能及用户体验的影响

- **稳定性**：不发送 `max_tokens` 让 API 自行决定最大输出长度，对标准 OpenAI 兼容 API 无影响（API 会使用模型默认值）
- **性能**：无法主动限制输出长度，极端情况下模型可能生成超长响应消耗 token
- **用户体验**：截断检测逻辑（`finish_reason=length` 警告）失效 — 引用了 `maxTokens` 变量但该值未发送给 API，警告信息误导用户
- **遗漏路径**：`characterAIUtils.ts` 仍直接发送 `engine.max_tokens`（如 1024000），会再次触发 400

### 3. 保留该参数的维护成本与技术债务

当前修复引入的技术债务：
- **16 处 `void maxTokens;`** — 变量计算后未使用，纯粹为绕过 TypeScript 未使用变量检查
- **13 处函数签名仍接受 `maxTokens` 参数** — 调用方仍传递该值，但函数内部不使用
- **截断检测引用失效变量** — `useWorldBookAIOperations.ts:2098` 引用 `maxTokens` 值但该值未发送给 API
- **配置必填校验不合理** — `AIService.ts:182` 要求 `max_tokens` 必须配置，但配置后又不发送给 API
- **语义混淆未消除** — UI 仍标注为"最大令牌数"，用户不知道这个值不会被发送给 API

### 4. 替代方案与参数调整策略

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 完全弃用 | 移除引擎配置中的 `max_tokens` 字段 | 彻底消除混淆 | 破坏现有配置，用户需重新配置 |
| B. 语义拆分 | 保留 `max_tokens` 作为上下文窗口参考，新增 `max_output_tokens` 控制输出限制 | 语义清晰，用户可按需控制输出 | 需新增配置字段和 UI |
| **C. 保留但不发送（当前方案治理）** | 保留 `max_tokens` 配置作为上下文窗口参考，清理技术债务，不发送给 API（除非用户显式配置输出限制） | 最小改动，不破坏现有配置 | 语义仍有一定混淆 |

## 决策：采用方案 C — 保留但不发送，清理技术债务

### 决策依据
1. 方案 A 破坏现有用户配置，风险过高
2. 方案 B 需新增字段和 UI 改动，超出当前修复范围
3. 方案 C 最小化改动，消除技术债务，修复遗漏路径，不破坏现有配置

### 实施路径
1. 修复遗漏路径：`characterAIUtils.ts` 不再发送 `engine.max_tokens`
2. 放宽配置校验：`AIService.getEngineConfig` 不再要求 `max_tokens` 必须配置
3. 清理 `void maxTokens;`：移除无用变量声明
4. 清理函数签名：移除不再使用的 `maxTokens` 参数
5. 修复截断检测：不再引用未发送的 `maxTokens`，改为基于 `finish_reason=length` 的通用提示
6. 连通性测试：使用固定小值 `1` 而非用户配置值

## What Changes
- 修复 `characterAIUtils.ts` — 不再将 `engine.max_tokens` 作为 API `max_tokens` 发送
- 修复 `AIService.ts:182` — 不再要求 `max_tokens` 必须配置
- 清理 `useWorldBookAIOperations.ts` — 移除 16 处 `void maxTokens;` 和相关无用变量声明
- 清理 `useCreativeAI.ts` — 移除 `void maxTokens;` 和无用变量声明
- 修复截断检测逻辑 — 移除对 `maxTokens` 的引用
- 修复连通性测试 — 使用固定值 `1` 代替 `activeEngine.max_tokens ?? 1`
- 清理函数签名 — 移除不再使用的 `maxTokens` 参数（仅限内部函数，保持公开 API 兼容）

## Impact
- Affected specs: `fix-remote-engine-400-error`（前置修复，已完成）
- Affected code:
  - `src/renderer/utils/characterAIUtils.ts` — 修复遗漏路径
  - `src/main/services/AIService.ts` — 放宽配置校验
  - `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 清理技术债务
  - `src/renderer/components/Creative/hooks/useCreativeAI.ts` — 清理技术债务
  - `src/renderer/stores/settingStore.ts` — 修复连通性测试

## MODIFIED Requirements

### Requirement: AI 引擎 max_tokens 参数处理
引擎配置中的 `max_tokens` 字段表示用户期望的上下文窗口大小，**不作为 API `max_tokens` 参数发送**。系统在调用 OpenAI 兼容 API 时不发送 `max_tokens` 字段，由 API 自行使用模型默认的最大输出长度。

例外：硬编码的小值（如 `max_tokens: 5` 用于图像识别探测）不受此规则约束。

#### Scenario: 用户配置大上下文窗口
- **WHEN** 用户在引擎配置中设置 `max_tokens: 1024000`（1M 上下文）
- **THEN** 系统不将该值作为 API `max_tokens` 参数发送
- **AND** AI 调用正常返回 200

#### Scenario: 截断检测
- **WHEN** API 返回 `finish_reason: "length"`
- **THEN** 系统提示"AI 生成内容可能被截断"
- **AND** 不再引用未发送的 `max_tokens` 值

#### Scenario: 连通性测试
- **WHEN** 用户点击"测试连接"按钮
- **THEN** 请求体使用 `max_tokens: 1`（固定小值）
- **AND** 不使用用户配置的 `max_tokens` 值
