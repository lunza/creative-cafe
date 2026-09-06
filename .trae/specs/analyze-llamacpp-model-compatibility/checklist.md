# Checklist

- [x] `debug-llamacpp-model-compat.md` 已创建，含症状/环境/复现条件记录
- [x] 3-5 个可证伪根因假设已在对话中公开列出
- [x] 官方推荐配置已收集：qwen 系列、gemma 系列、muse glimmer 均有参数表与模板来源链接
- [x] llama.cpp llama-server 官方启动参数（-c/--jinja/--chat-template）已收集并注明来源
- [x] 系统当前配置已提取：请求体实际参数集合、aiHttpClient 回退分支、运行时引擎参数、llama-server 启动命令
- [x] 官方 vs 当前配置对比表已完成，差异点标注风险等级
- [x] 控制变量测试方案已设计：每条测试有明确判据与可复制的 curl 命令
- [x] 测试已执行（或改用日志分析），结果已记录到 debug 文件（llama-server 未运行 → 应用日志取证 + T1-T5 待执行命令就绪）
- [x] H1-H5 每个假设均标注"证实/证伪/部分证实"并附证据
- [x] 技术分析报告 `docs/llamacpp-model-compat-analysis.md` 已完成，含优化建议（参数预设值、模板建议、ai_handler 改进方向）
- [x] `.trae/documents/技术文档.md` 已增量更新
- [x] 分析全程未修改任何业务逻辑代码（证据 Gate 遵守）
