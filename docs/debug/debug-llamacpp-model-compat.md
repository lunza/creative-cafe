# Debug Session: llamacpp-model-compat

**Status**: [OPEN]
**Started**: 2026-08-28
**Spec**: `.trae/specs/analyze-llamacpp-model-compatibility/`
**Phase**: 分析（Evidence Gate 生效：未取得运行时证据前不修改任何业务逻辑代码）

## 1. 症状

本地 Llama.cpp（llama-server, `G:\AI\Llama.cpp`）作为推理引擎：

| 模型系列 | 表现 |
| --- | --- |
| gemma4 系列 | 正常（对照基准） |
| qwen 系列 / muse glimmer 等 | ① 答非所问 ② 提示词原样返回 ③ 不遵循格式指令（如要求 `<xxx>` 标签包裹无输出）④ 情绪化、反应极端 ⑤ 其他交互异常 |

## 2. 环境

- OS: Windows
- 引擎: llama-server（llama.cpp，OpenAI 兼容接口）
- 应用: Electron，渲染层 AIService.tsx → IPC `ai:request`（aiHandlers.ts）→ fetch 直连
- 日志: aiHandlers 对每次请求记录完整 JSON 请求体（logger, `ai-handler` channel）

## 3. 复现条件

- 引擎类型切到本地 llama.cpp 端点 + 加载 qwen/muse glimmer GGUF
- 同一提示词在 gemma 系列正常、qwen 系列异常

## 4. 假设（可证伪）

- **H1（模板层）**: llama-server 未启用 `--jinja`，llama.cpp 内置模板转换对 qwen3 的 system role / `<think>` 支持不完整，导致指令理解错乱。
  - 观察点: llama-server 启动命令；`/props` 端点返回的 chat_template；curl 对比开/关 `--jinja` 的输出。
- **H2（上下文层）**: 上下文窗口过小（默认 `-c 4096` 或系统 `openai_max_context: 4095`），长系统提示被截断，格式指令落在被截断区域 → 答非所问、不遵循格式。
  - 观察点: 启动命令 `-c`；请求 prompt token 数与 `-c` 关系；缩短提示词后症状是否消失。
- **H3（采样参数层）**: 采样参数不匹配（如遗留默认 `temp: 2`、缺 top_k/min_p 组合、rep_pen 设置不当）→ 情绪化、极端反应、重复。
  - 观察点: 请求体实际 temperature 值；官方推荐值 vs 实际值对比；curl 固定参数对比。
- **H4（请求构建层）**: aiHttpClient 的 `'系统提示'` 字面量回退或 text_completion 裸 prompt 分支绕过对话模板 → 提示词原样返回。
  - 观察点: 调用点是否提供 systemPrompt；apiMode 实际值；请求体日志中 messages 结构。
- **H5（输出后处理层）**: Qwen3 `<think>` 输出未被正确剥离/消费，思考内容污染正文 → 不遵循格式指令、异常情绪。
  - 观察点: 原始响应是否含 `<think>`；应用剥离逻辑是否覆盖流式/非流式路径。

## 5. 证据记录

- **运行时请求体**（logs/ai-handler/ai-handler_20260828_123554.log req-90c9cf73d05c）：temperature=1、top_p=1、min_p=0.1、frequency/presence=0.1、repetition_penalty=1、dry_multiplier=0.4、stop 数组；system 6289 字符且越狱块 ×2 重复；messages 结构正常 [system, assistant, user]。
- **运行时响应**：同日志存在 `delta.reasoning_content` 流（glm5.3-flash），应用侧 SSE 解析无 reasoning_content 消费逻辑。
- **代码证据**：chat.h:255 `use_jinja=true`（server 默认）；arg.cpp:1395/1397 仅 completion/mtmd 关 jinja；common.h:650 `enable_reasoning=-1 (auto)`；chat.cpp:776-781 无模板→CHATML 回退；llama-chat.cpp:99-104 qwen 启发式仅降级 CHATML、有专用 gemma 条目；server-context.cpp:1463 thinking 自动开启条件。
- **launcher 证据**：config_io.py build_launch_args 从不传 --jinja/--reasoning；仅 qwen3.8 两个预设带官方采样 extra_args；muse-glimmer/gemma4/ornith/qwen3.6 预设 extra_args 为空。
- **控制变量测试**：llama-server 分析期间未运行，T1-T5 测试命令已写入报告第 4 节待用户执行；H 判定基于日志 + 源码 + 官方文档三重证据。

## 6. 结论

- **首要根因**：H3 采样参数不匹配（temp=1/top_p=1/min_p=0.1 对 qwen 是官方明确警告的组合，对 gemma 恰好接近官方推荐 → 解释差异）。
- **次要根因**：H1' 模板链路（GGUF 模板缺失→CHATML 回退）+ H5 thinking 隐式开启且应用不消费 reasoning_content。
- **排除**：H2 上下文截断证伪；H4 设计缺陷存在但主链路未触发。
- 详细报告：`docs/llamacpp-model-compat-analysis.md`。修复方向待用户确认后另行立项实施。
