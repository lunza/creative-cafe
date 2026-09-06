# Tasks

- [x] Task 1: 初始化调试会话（TRAE-debugger bootstrap）
  - [x] 1.1 创建项目根目录 `debug-llamacpp-model-compat.md`，记录症状、环境、复现条件
  - [x] 1.2 在对话中公开列出 3-5 个可证伪根因假设（对应 spec H1-H5）
- [x] Task 2: 收集官方推荐配置（联网调研）
  - [x] 2.1 收集 llama.cpp 官方文档：llama-server 启动参数（-c/--jinja/--chat-template）、OpenAI 兼容端点支持的采样参数
  - [x] 2.2 收集 Qwen3 / Qwen2.5 官方推荐参数（temperature 0.6/0.7、top_p 0.95/0.8、top_k 20、presence_penalty 等）与 jinja 模板（含 `<think>` 处理）
  - [x] 2.3 收集 gemma 系列官方推荐参数与模板（作为对照组基准）
  - [x] 2.4 确认 muse glimmer 模型的官方来源与推荐配置（如无官方资料则记录实际可得的最优实践）
- [x] Task 3: 提取系统当前配置（只读，不改代码）
  - [x] 3.1 梳理请求构建链路：AIService.tsx → ai:request (aiHandlers.ts) → fetch；列出实际写入请求体的参数集合
  - [x] 3.2 梳理 aiHttpClient.buildRequestBody 的 system 回退与 text_completion 裸 prompt 分支
  - [x] 3.3 读取运行时 settings（用户提供或 userData 配置文件），记录实际引擎参数
  - [x] 3.4 确认 llama-server 实际启动命令（检查 G:\AI\Llama.cpp 目录脚本 / 询问用户），记录 --jinja、-c 等关键项
- [x] Task 4: 构建官方 vs 当前配置对比表
  - [x] 4.1 按模型系列逐参数对比，标注差异点与风险等级
- [x] Task 5: 设计并执行控制变量测试
  - [x] 5.1 设计最小复现 curl 测试集（固定提示词，变量：--jinja 开关、-c 大小、参数组、模型文件），每条写明判据
  - [x] 5.2 执行测试并记录原始输出到 debug-llamacpp-model-compat.md（llama-server 不可用时改为收集用户应用日志）（llama-server 未运行 → 已按预案改用应用日志取证）
  - [x] 5.3 结合应用日志（请求体完整 JSON 日志已具备）验证 H1-H5，标注证实/证伪
- [x] Task 6: 撰写技术分析报告
  - [x] 6.1 创建 `docs/llamacpp-model-compat-analysis.md`：现象描述 → 对比表 → 问题点定位（含证据引用）→ 验证方法与结果 → 优化建议（参数预设值表、模板建议、ai_handler 改进方向）
- [x] Task 7: 文档增量更新
  - [x] 7.1 更新 `.trae/documents/技术文档.md`，记录本次分析结论；如有"经反复提示才解决"的项则重点标记
- [x] Task 8: 收尾确认
  - [x] 8.1 向用户呈报报告要点与优化建议清单，等用户确认修复方向后（另行 spec 或直接实施）再清理调试产物（debug 文件保持 [OPEN]）

# Task Dependencies
- Task 2、Task 3 可并行，互不依赖
- Task 4 依赖 Task 2 + Task 3
- Task 5 依赖 Task 3（需了解当前参数）与 Task 2（官方判据）
- Task 6 依赖 Task 4 + Task 5
- Task 7 依赖 Task 6；Task 8 依赖 Task 6
