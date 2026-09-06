# Llama.cpp 模型兼容性技术分析报告

> 分析日期：2026-08-28 ｜ 调试会话：`debug-llamacpp-model-compat.md`（[OPEN]）
> 规格文档：`.trae/specs/analyze-llamacpp-model-compatibility/`

---

## 1. 问题现象详细描述

**环境**：llama-server（llama.cpp 本地构建，`G:\AI\Llama.cpp`）@ `127.0.0.1:8080`，Electron 应用通过 OpenAI 兼容 `/v1/chat/completions` 直连，模型别名 `local-llm` 自动路由到当前加载模型。

**现象**（同一套应用配置下）：

| 症状 | 表现 | 出现模型 |
| --- | --- | --- |
| ① 答非所问 | 回复内容与请求任务错位、角色混乱 | qwen 系列、muse glimmer |
| ② 提示词原样返回 | 输出复述 prompt 或系统提示片段 | qwen 系列、muse glimmer |
| ③ 不遵循格式指令 | `<<<EXPRESSION>>>`、`<tableEdit>` 等标签无输出 | qwen 系列、muse glimmer |
| ④ 情绪化、反应极端 | 突然的拒绝/过激内容/语气失控 | qwen 系列（尤其 uncensored 微调版） |
| ⑤ 其他异常 | 重复循环、语言混杂、空回复 | 各问题模型散见 |

**对照基准**：gemma4 系列（31B bf16/q8 及其微调版 Artemis/Sprinkle/Gembrain）在同一应用配置下表现正常。

**关键背景**：应用侧"本地引擎"配置只有一套（engine `engine_1778078255962`），切换模型仅靠 llama-server 端换模型文件 + 别名路由，**应用侧采样参数不随模型系列变化**。

---

## 2. 配置对比分析表

### 2.1 系统当前配置全貌（运行时证据）

请求体证据：`logs/ai-handler/ai-handler_20260828_123554.log`（req-90c9cf73d05c，完整 JSON 不截断）：

| 参数 | 应用实际发送 | 来源 |
| --- | --- | --- |
| temperature | **1** | 引擎配置（`settings.json` engine_1778078255962） |
| top_p | **1** | 引擎配置 |
| top_k | 未发送 → llama-server 默认 **40** | [common.h:230](G:/AI/Llama.cpp/llama.cpp/common/common.h) |
| min_p | **0.1** | 引擎配置 |
| frequency_penalty / presence_penalty | 0.1 / 0.1 | 会话自定义参数 |
| repetition_penalty | 1（引擎 rep_pen=1 透传） | ParameterInjector |
| dry_multiplier 等 | **0.4** / 1.75 / 2（DRY 采样激活） | buildSamplingExtras 兜底 |
| stop | 6 个用户名变体停止串 | ParameterInjector |
| max_tokens | 不发送（ChatEngine 置 undefined） | [ChatEngine.ts#L110-L123](g:/AI/creative-cafe/src/renderer/components/Common/ChatEngine/ChatEngine.ts) |
| enable_thinking | 不发送（supportsThinking=false 双条件不满足） | [ChatEngine.ts#L176-L181](g:/AI/creative-cafe/src/renderer/components/Common/ChatEngine/ChatEngine.ts) |
| messages | `[system(6289字), assistant, user]` 正常结构 | ChatEngine |

llama-server 端（证据：[server-defaults.cmd](G:/AI/Llama.cpp/config/server-defaults.cmd)、[config_io.py build_launch_args](G:/AI/Llama.cpp/launcher/config_io.py)）：

| 参数 | 当前值 | 说明 |
| --- | --- | --- |
| -c（上下文） | 128000（.bat）/ 262144（launcher 预设） | 充足 |
| --jinja | **未显式指定** → 使用代码默认值 | `common_params.use_jinja = true`（chat.h:255，server 默认启用 jinja） |
| --reasoning | **未指定** → `-1 = auto`（common.h:650） | 模板支持 thinking 时**自动开启思考模式** |
| --temp 等 | 未指定 → 请求体参数优先 | — |
| 采样兜底 | temp 0.8 / top_k 40 / top_p 0.95 / min_p 0.05 / repeat 1.0 | common.h 采样结构默认 |

对话模板生效方式：jinja 开启时使用 **GGUF 元数据中的官方模板**（minja 引擎解析）；GGUF 无模板时回退内置 CHATML（[chat.cpp:776-781](G:/AI/Llama.cpp/llama.cpp/common/chat.cpp)）；非 jinja 的启发式转换表中有专用 `gemma` 条目而 **qwen 仅能按 `<|im_start|>` 降级为普通 CHATML**（[llama-chat.cpp:99-104](G:/AI/Llama.cpp/llama.cpp/src/llama-chat.cpp)）。

### 2.2 官方推荐 vs 当前配置对比

| 参数 | Qwen3（官方） | Muse-Glimmer-30B（Meta 官方） | Gemma4（官方） | 应用当前值 | 风险 |
| --- | --- | --- | --- | --- | --- |
| temperature | thinking: **0.6**；non-thinking: **0.7** | **1.0** | **1.0** | 1 | qwen 高风险 |
| top_p | thinking: **0.95**；non-thinking: **0.8** | **0.95** | **0.95** | 1（禁用） | qwen/muse 高风险 |
| top_k | **20** | **64** | **64** | 40（server 默认） | 中风险 |
| min_p | **0.0** | — | 0.0~0.01 | 0.1 | 高风险（llama.cpp 默认 0.1 恰是 Qwen 官方点名不推荐的值） |
| presence_penalty | **0~2**（防重复，建议 1.0-1.5） | — | 1.0（=禁用） | 0.1 | 中风险 |
| thinking 开关 | enable_thinking（模板 kwarg）/ `--reasoning off` | 系统提示写 `Reasoning strength: high` | `<|think|>` 控制 | **不控制**（server auto → qwen thinking 强制开启） | 高风险 |
| DRY 采样 | 官方未推荐 | 未推荐 | 未推荐 | multiplier 0.4 激活 | 中风险 |

来源：
- Qwen 官方文档（Quickstart / llama.cpp 指南）：`qwen.readthedocs.io/zh-cn/latest/getting_started/quickstart.html`、`opencsg.com/models/Qwen/Qwen3-8B-GGUF`、`docs.unsloth.ai/basics/qwen3-2507`
- Qwen3.6 官方参数表：`hyper.ai/cn/notebooks/50704`（thinking 通用 1.0/0.95/20/1.5；精确编码 0.6；non-thinking 0.7/0.8/20/1.5）
- Muse-Glimmer：`jetson-ai-lab.com/models/muse-glimmer-30b`、`github.com/MiaAI-Lab/Muse-Glimmer-30B-DGX-Spark-RTX-5090-6000-PRO`（temp 1.0 / top_p 0.95 / top_k 64；推理强度经系统提示控制）
- Gemma4：`ollama.com/library/gemma4`（params: temperature 1, top_k 64, top_p 0.95）、`docs.unsloth.ai`（Gemma3：temp 1.0 / top_k 64 / top_p 0.95 / min_p 0.01）
- llama-server 参数：`tools/server/README.md`（--jinja 默认 enabled、--reasoning-format auto、--chat-template）

---

## 3. 可能的问题点定位（按可能性排序，含证据）

### P1（高）：采样参数不匹配 —— 直接对应症状③④①
- **证据**：运行时日志（temperature:1, top_p:1, min_p:0.1）；Qwen 官方明确警告 temp=1/top_p=1 时思维/指令遵循崩溃，min_p=0.1 是 llama.cpp 默认值但 Qwen 推荐 0.0；gemstone 系列官方恰好推荐 temp=1.0（应用当前配置接近 gemma 官方值 → 解释了"gemma 表现好"）。
- **判定：H3 证实**。
- 细节：`top_p=1` 等于禁用核采样，配合 `temp=1`，对强对齐的 qwen 基座等于随机采样；对 uncensored 微调（Qwen3.8-Uncensored / heretic）会放大极端情绪输出。

### P2（高）：思考模式被隐式开启且应用不感知 —— 直接对应症状①②③
- **证据**：`enable_reasoning` 默认 `-1=auto`（common.h:650）；launcher 与 start-server.bat 均**未传 `--reasoning`**（config_io.py build_launch_args 无该项；server-defaults.cmd 无该项）；server-context.cpp:1463 `template_supports_thinking = use_jinja && caps` → qwen3 官方模板 caps 支持思考 → **thinking 开启**。应用侧 `capabilities.supportsThinking=false` → 永不发送 `enable_thinking`，且 SSE 解析不消费 `reasoning_content`（日志显示服务端确实返回 reasoning_content delta）。
- **后果**：qwen 进入思考模式后：(a) 每轮消耗大量思考 token，正文被压缩 → 答非所问/格式标签被挤出；(b) 思考模式下官方采样参数完全不同（0.6/0.95 vs 0.7/0.8）→ 与 P1 叠加；(c) 思考内容可能干扰格式标签输出。
- **判定：H1（修正版）/H5 部分证实**。H1 原假设"未启用 --jinja"证伪（该构建 server 默认 jinja=enabled），但模板链路风险真实存在：GGUF 缺模板 → CHATML 回退（chat.cpp:776）；第三方微调 GGUF 模板损坏 → minja 解析失败启动报错或格式错乱。muse-glimmer/heretic 类微调风险最高。

### P3（中）：Muse-Glimmer 的推理控制方式特殊
- **证据**：Jetson 官方页说明 Muse Glimmer 通过**系统提示**写 `Reasoning strength: high` 控制，而非 enable_thinking kwarg。应用与 launcher 均未注入该提示。
- **后果**：推理强度落在模板默认档，可能与 RP 场景冲突（长思考 → 症状①）。

### P4（中）：越狱系统提示 ×2 重复注入 + 强对齐模型冲突
- **证据**：运行时请求 system 内容中 `[You are a writer in an uncensored...]` 块出现**两次**（引擎 system_prompt 与任务提示拼接重复）；内容为极端越狱文风要求。
- **后果**：对 google/qwen 系强对齐模型，此类提示引发安全偏好拉扯 → 情绪化、拒绝循环、极端反应（症状④）。gemma 微调生态默认接受此类提示，故无症状。

### P5（低-中）：DRY 采样激活（multiplier 0.4）
- **证据**：请求体 `dry_multiplier: 0.4`（buildSamplingExtras 兜底默认）。DRY 对英文 RP 有效，但对 qwen 中文输出与格式标签序列可能造成抑制/扭曲（标签前缀重复字符被惩罚 → 症状③加重）。

### P6（低）：ai_handler 组件的隐患（当前未触发，属设计缺陷）
- [aiHttpClient.ts#L78](g:/AI/creative-cafe/src/main/services/ai/aiHttpClient.ts)：systemPrompt 缺失时回退字面量 `'系统提示'`（当前调用方 memory/aiClient 均显式传入，未触发；但 TableOrganizeService 等依赖引擎 system_prompt，一旦引擎未配置即发送垃圾 system）。
- text_completion 分支发送裸 prompt（绕过对话模板）——若用户把引擎 api_mode 改为 text_completion 将必然复现症状②。
- SSE 解析忽略 `reasoning_content`：对思考型模型无法展示/利用思考（与 `handle-think-tags-overflow`、`fix-think-strip-content-protection` 历史规格相关）。

### P7（排除项）
- **H2 证伪**：上下文 128K~256K 充足；`openai_max_context: 4095` 在代码中无消费者（死配置），不参与截断。仅当 start-server.bat 在 config 缺失时回退 8192 才构成风险。

---

## 4. 验证方法（控制变量测试方案）

llama-server 当前未运行，以下测试命令就绪，用户按需启动服务后即可执行（结果应回填 `debug-llamacpp-model-compat.md`）。

**T1（验证 P1，参数敏感性）**：加载 qwen 系 GGUF 后，同一提示词三组参数各跑 3 次：
```bash
# A 组：当前应用参数（预期复现症状：格式标签缺失/情绪化）
curl http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"local-llm\",\"temperature\":1,\"top_p\":1,\"min_p\":0.1,\"messages\":[{\"role\":\"system\",\"content\":\"你必须以 <mood>开心</mood> 结尾\"},{\"role\":\"user\",\"content\":\"你今天怎么样？\"}]}"

# B 组：Qwen 官方 non-thinking（预期：<mood> 标签稳定输出）
curl http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"local-llm\",\"temperature\":0.7,\"top_p\":0.8,\"top_k\":20,\"min_p\":0,\"presence_penalty\":1.5,\"messages\":[{\"role\":\"system\",\"content\":\"你必须以 <mood>开心</mood> 结尾\"},{\"role\":\"user\",\"content\":\"你今天怎么样？\"}]}"
```
判据：B 组 `<mood>` 输出率 ≥ A 组 +30 个百分点 → P1 证实。

**T2（验证 P2，thinking 开关）**：
```bash
# thinking 显式关闭启动（换端口避免冲突）：
llama-server -m <qwen.gguf> -c 32768 --port 8081 --reasoning off --jinja
# 对比 8080（auto）与 8081 的相同请求
curl http://127.0.0.1:8080/props | jq '.chat_template_caps'   # 查看模板能力
curl http://127.0.0.1:8080/props | jq '.default_generation_settings' 
```
判据：8080 响应含 reasoning_content 或正文前出现 `</think>` 残留、且耗时显著更长 → thinking 被隐式开启证实。

**T3（验证 H1 模板链路，Muse-Glimmer）**：
```bash
curl http://127.0.0.1:8080/props | jq -r '.chat_template'   # 为空或明显非官方格式 → CHATML 回退/模板缺失证实
curl http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"local-llm\",\"messages\":[{\"role\":\"system\",\"content\":\"Reasoning strength: low. 你必须以 <mood>开心</mood> 结尾\"},{\"role\":\"user\",\"content\":\"你好\"}],\"temperature\":1.0,\"top_p\":0.95,\"top_k\":64}"
```
判据：加 `Reasoning strength` 系统提示 + Meta 官方参数后行为恢复正常 → P3 证实。

**T4（验证 P4，系统提示 A/B）**：同一模型同一参数，仅切换 system（越狱文 ×2 vs 简短中立 system），对比极端情绪输出频率。

**T5（验证 P5，DRY 关闭）**：请求体去掉 dry_* 字段，对比格式标签输出率与语言混杂度。

**T6（应用日志分析，已完成）**：`logs/ai-handler/ai-handler_20260828_123554.log` 已证实实际请求体参数集合（见 2.1）与 reasoning_content delta 的存在。

---

## 5. 针对性优化建议

### 5.1 llama-server 启动参数（按模型系列加 preset，launcher 已具备机制）

| 模型系列 | extra_args 追加建议 |
| --- | --- |
| Qwen3.8（Instruct/uncensored） | `--reasoning off --temp 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --repeat-penalty 1.0 --presence-penalty 1.5`（✅ launcher 现有 qwen3.8 预设已正确） |
| Qwen3.6 / Ornith（thinking 型） | 保留思考：`--reasoning on --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0 --presence-penalty 1.5`；不想思考则 `--reasoning off` + 0.7/0.8/20 |
| Muse-Glimmer-30B | `--temp 1.0 --top-p 0.95 --top-k 64`；推理强度经系统提示 `Reasoning strength: high` 控制（由应用注入，见 5.3） |
| Gemma4 / 其微调 | 现状即可；建议显式 `--temp 1.0 --top-p 0.95 --top-k 64 --min-p 0.01`（Ollama 官方 params） |
| **通用** | 确认加载第三方微调 GGUF 后执行 `curl /props | jq .chat_template` 验证模板存在；为空则 `--chat-template chatml` 显式声明或更换转换正确的 GGUF |

注意：launcher 的 `qwen3.6/ornith/muse-glimmer/gemma4` 预设 `extra_args` 为空 → 上述参数应补入各预设（修改 `G:\AI\Llama.cpp\launcher\config_io.py` 内建预设）。

### 5.2 应用引擎参数方案（按模型系列建立引擎预设）

当前"一套引擎参数打天下"是根因之一。建议在设置中按模型系列建立引擎预设（或支持按 `model_name` 前缀自动切换）：

| 参数 | Qwen 系列 | Muse-Glimmer | Gemma 系列 |
| --- | --- | --- | --- |
| temperature | 0.7（thinking 关）/ 0.6（thinking 开） | 1.0 | 1.0 |
| top_p | 0.8 / 0.95 | 0.95 | 0.95 |
| top_k | 20 | 64 | 64 |
| min_p | 0 | 0（官方未提供，按全局规则；2026-08-28 更新，原 0.05 为 llama.cpp 采样结构默认值误植） | 0.01 |
| presence_penalty | 1.0~1.5 | 0 | 0 |
| DRY | multiplier 0（关闭） | 0 | 0.4 可保留 |
| supportsThinking | true（按启动参数联动） | true | false |

另：清理死配置 `openai_max_context`，或真正接入截断逻辑。

### 5.3 ai_handler / 对话管线改进方向

1. **`<think>`/reasoning 消费**：SSEStreamParser 增加 `delta.reasoning_content` 通道（进"思考可视化"UI，已有 add-worldbook-thinking-visualization 基础）；对非 jinja 回退的 ChatML 模型，正文 `<think>` 剥离逻辑需覆盖流式增量边界（`fix-think-strip-content-protection` 延续）。
2. **aiHttpClient 修复**：删除 `'系统提示'` 字面量回退（改为空串或报错）；text_completion 模式给出"将绕过对话模板"警告。
3. **system 去重**：检测并合并重复注入的引擎 system_prompt 块（当前越狱块 ×2）。
4. **能力探测联动**：`ai:probeCapabilities` 增加 `/props` 读取 `chat_template_caps` 与 thinking 支持，自动填充 supportsThinking / 推荐 sampling（避免手配错误）。
5. **模型系列参数预设库**：内置 5.2 的预设表，新建本地引擎时按 `model_name`/GGUF 元数据自动推荐。

### 5.4 对"情绪化"专项说明
- uncensored/heretic 微调模型（Qwen3.8-Uncensored、Qwen3.6-heretic、Muse-Glimmer-heretic）本身去除了对齐，行为极化是其设计属性；在 temp=1 + top_p=1 下被放大。5.1/5.2 参数收敛后大部分"情绪化"症状会消失；剩余部分属模型本性，建议 RP 用途优先选择带内容契约的微调版而非激进 uncensored 版。

---

## 6. 结论

| 假设 | 判定 | 核心证据 |
| --- | --- | --- |
| H1 模板层（--jinja 缺失） | **修正后部分证实**：server 默认 jinja 已启用；真实风险是 GGUF 模板缺失→CHATML 回退、以及第三方微调模板损坏 | chat.h:255、chat.cpp:776、llama-chat.cpp:99-104 |
| H2 上下文过小 | **证伪** | server-defaults.cmd ctx=128000；openai_max_context 无消费者 |
| H3 采样参数不匹配 | **证实（首要根因）** | 运行时请求体 temp=1/top_p=1/min_p=0.1 vs Qwen 官方 0.7/0.8/20/0.0 |
| H4 请求构建缺陷 | **部分证实（次要，当前未触发主链路）** | aiHttpClient.ts:78 回退、text_completion 裸 prompt 分支存在 |
| H5 think 输出污染 | **部分证实** | `--reasoning` 未配置→auto 开启思考；应用不消费 reasoning_content；日志存在 reasoning delta |

**优先级排序的修复路径**：① 应用引擎参数按模型系列调整（5.2，立即可做，零代码）→ ② launcher 补齐各预设采样参数与 `--reasoning`（5.1，改 G:\AI\Llama.cpp）→ ③ ai_handler/管线改进（5.3，应用代码，另行 spec）。

预期效果：完成 ①② 后，qwen 系列与 Muse-Glimmer 在格式遵循、情绪稳定性上应达到与 gemma4 相当水平；残留差异主要来自模型本身对齐程度。
