# Llama.cpp 模型兼容性技术分析 Spec

## Why
系统通过本地 Llama.cpp（`G:\AI\Llama.cpp`，llama-server，OpenAI 兼容接口）作为推理引擎时，gemma 系列模型表现良好，但 qwen 系列、muse glimmer 等其他系列模型出现答非所问、提示词原样返回、不遵循格式指令（如 `<xxx>` 标签无输出）、情绪化极端反应等显著异常。需要系统性技术分析定位根因，并给出验证方案与优化建议，最终使各系列模型达到与 gemma 系列相当的交互表现。

## What Changes
- 新增一份完整的技术分析报告（`docs/llamacpp-model-compat-analysis.md`），包含：问题现象描述、官方推荐配置 vs 系统当前配置对比表、问题点定位、控制变量验证方案、针对性优化建议
- 分析阶段遵循 TRAE-debugger 流程：创建 `debug-llamacpp-model-compat.md` 调试记录，列出 3-5 个可证伪假设，通过运行时证据（curl 直连 llama-server 的控制变量测试、应用请求日志）证实/证伪假设；分析阶段不修改任何业务逻辑代码
- 报告完成后对 `.trae/documents/技术文档.md` 进行增量更新
- 优化实施（参数调整、模板适配、ai_handler 改进）视报告结论由用户确认后另行立项，不在本 spec 范围内强制执行

## Impact
- Affected specs: 无既有 spec 被修改；与 `fix-think-strip-content-protection`、`handle-think-tags-overflow`、`fix-user-reply-persona-echo`（llama.cpp prefill 问题）历史结论相关联
- Affected code（只读分析对象）:
  - `src/main/ipc/handlers/aiHandlers.ts` — 统一 ai_handler（IPC 转发层）
  - `src/main/services/ai/aiHttpClient.ts` — 统一 AI HTTP 调用（含 `'系统提示'` 回退、text_completion 裸 prompt 分支）
  - `src/renderer/components/Common/AIService.tsx` — 对话请求构建（messages / temperature / max_tokens）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 提示词构建（历史嵌入 system、prefill 规避）
  - `src/shared/settings.ts` — 引擎默认参数（temp:2、top_k:0、min_p:0.1、rep_pen:1、openai_max_context:4095 等）
  - llama-server 启动参数（`G:\AI\Llama.cpp` 目录下脚本/用户手动启动方式，需向用户确认或检查目录）

## ADDED Requirements

### Requirement: 官方配置收集
系统 SHALL 通过官方渠道（Qwen 官方 GitHub/模型卡、Google gemma 模型卡、llama.cpp 官方 README/文档、muse glimmer 发布页）收集并整理：
- 各系列模型（qwen3 / qwen2.5、gemma 系列、muse glimmer）的推荐采样参数（temperature、top_p、top_k、min_p、repeat_penalty、presence_penalty 等）
- 推荐上下文窗口大小与 llama-server 启动参数（`-c`/`--ctx-size`、`--jinja`、`-n` 等）
- 官方推荐的 jinja 对话模板（含 `<think>` 推理标签处理规则）

#### Scenario: 收集完成
- **WHEN** 调研完成
- **THEN** 报告中存在按模型系列分组的官方推荐配置表，每条注明来源链接

### Requirement: 系统当前配置提取
系统 SHALL 提取当前实际的推理配置全貌：
- 代码层默认值与实际透传逻辑（哪些参数会出现在请求体、哪些被丢弃）
- 用户实际引擎配置（从运行时 settings 读取或由用户提供）
- llama-server 实际启动命令行参数（`--jinja` 是否启用、`-c` 上下文大小等）
- 对话模板的实际生效方式（llama-server 内置模板转换 vs `--jinja` vs `--chat-template` 显式指定）

#### Scenario: 提取完成
- **WHEN** 提取完成
- **THEN** 报告中存在"系统当前配置"清单，明确标注每个参数的来源（代码默认/用户配置/llama-server 端）

### Requirement: 差异对比与根因假设
系统 SHALL 产出官方推荐 vs 当前实现的对比分析表，并据此提出 3-5 个可证伪根因假设，覆盖但不限于：
- H1: llama-server 未启用 `--jinja`，模板转换对 qwen3 的 system role / `<think>` 支持不完整
- H2: 上下文窗口过小（默认 `-c 4096`）导致长系统提示被截断 → 答非所问、格式指令丢失
- H3: 采样参数不匹配（如 temp:2 遗留默认值、缺少 top_k/min_p 组合）→ 情绪化、极端反应
- H4: aiHttpClient 的 `'系统提示'` 字面量回退 / text_completion 裸 prompt 分支绕过对话模板 → 提示词原样返回
- H5: Qwen3 `<think>` 输出未被正确剥离/消费，污染正文 → 不遵循格式指令、异常情绪

#### Scenario: 假设成立判定
- **WHEN** 每个假设均经过运行时证据检验（curl 控制变量测试或日志分析）
- **THEN** 报告中明确标注该假设"证实/证伪/部分证实"及对应证据（日志行、测试输出）

### Requirement: 控制变量验证方案
系统 SHALL 设计并执行最小复现测试：直接用 curl 调用 llama-server 的 `/v1/chat/completions`，在固定提示词下对比：
- 开/关 `--jinja`、不同 `-c` 大小、官方推荐参数组 vs 当前系统参数组、不同模型文件
- 预期结果：每项测试写出明确的判据（如"返回内容包含 `<think>` 未闭合"或"正确输出 `<xxx>` 标签"）

#### Scenario: 测试可执行
- **WHEN** llama-server 可用
- **THEN** 每条测试命令可直接复制执行，测试结果记录进 debug-llamacpp-model-compat.md

### Requirement: 技术分析报告
系统 SHALL 输出 `docs/llamacpp-model-compat-analysis.md`，结构包括：
1. 问题现象详细描述（5 类症状 + 复现条件）
2. 官方推荐配置 vs 系统当前配置对比表
3. 可能的问题点定位（按可能性排序，引用证据）
4. 验证方法与执行结果
5. 针对性优化建议：参数调整方案（按模型系列的引擎预设值）、对话模板修改建议、ai_handler 组件改进方向（如按模型系列适配 system 回退、payload 参数透传、`<think>` 剥离）

#### Scenario: 报告可用
- **WHEN** 用户阅读报告
- **THEN** 能直接按照优化建议操作（具体参数值、启动命令、代码改动点），使 qwen 系列达到与 gemma 系列相当的交互表现

### Requirement: 文档增量更新
报告完成后 SHALL 对 `.trae/documents/技术文档.md` 增量更新本次分析结论；如出现经用户反复提示才解决的问题则重点标记。

## REMOVED Requirements
（无）
