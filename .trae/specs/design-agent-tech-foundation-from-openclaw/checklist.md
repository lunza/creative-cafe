# Checklist

## openclaw 源码调研真实性
- [x] 引用 openclaw 真实文件（src/agents/* / src/skills/types.ts / src/tools/types.ts / src/cron/* / src/acp/* / src/llm/* / docs/concepts/soul.md / skills/spike/SKILL.md）
- [x] 提取七大设计理念：三分离人格模型 / 声明式 Tool 可用性 / SKILL.md 契约 / dreaming / cron pacing / ACP / 写溯源
- [x] 每个理念标注 openclaw 源文件引用
- [x] 每个理念说明在本项目的映射与适配（SOUL.md→角色卡、MEMORY.md→世界书、pacing→防失控 等）

## 五大模块完整性
- [x] 模块一 AgentCore：职责 + 架构（移植 src/agents/）+ 接口规范 + 错误处理 + 三模式集成
- [x] 模块二 Multimodal I/O：职责 + 架构（移植 src/llm/+media/）+ 接口规范 + 数据格式 + 降级矩阵
- [x] 模块三 AdaptiveLearning：职责 + 架构（dreaming+goal+steer+cron）+ 接口规范 + 防失控机制
- [x] 模块四 SkillPlatform：职责 + 架构（移植 src/skills/）+ SKILL.md 契约 + 内置技能清单 + 接口规范
- [x] 模块五 MemoryStore：职责 + 架构（memory-core+SQLite+向量+写溯源）+ 记忆分类统一 + 接口规范 + 错误处理

## 模块化与低耦合
- [x] 五大模块各自独立目录与类型定义
- [x] 模块间仅通过 contracts.ts 接口契约通信（IToolProvider/IMemoryProvider/ILLMProvider/ISkillRegistry/ILearningScheduler）
- [x] 禁止跨模块直接 import 实现类（设计原则明确）
- [x] 现有资产通过适配器接入而非推倒重来（对接清单 9 项）

## 接口规范完备性
- [x] 每个模块给出 TypeScript 接口定义（输入/输出类型）
- [x] 定义统一数据格式（时间戳/ID/消息/工具 schema/持久化/向量）
- [x] 定义统一错误码与错误处理机制（重试/降级/兜底）
- [x] 定义 IPC 通道规范表（通道名/方向/Payload/用途）

## 集成文档完备性
- [x] 部署流程（依赖/DB 初始化/技能注册/能力检测/降级/三模式接入 6 步）
- [x] 环境配置（必须/可选/SQLite 路径/技能目录）
- [x] 依赖说明表（含 native rebuild 注意事项）
- [x] 现有资产对接清单（9 项适配器接入 + 所属模块）

## 三大专题覆盖
- [x] 性能优化（tool 并行/缓存/向量懒加载/记忆压缩/SQLite WAL/技能快照/流式优先）
- [x] 安全性设计（沙盒/写操作分级/自主节流/敏感数据/prompt 注入防护/审计日志/隐私）
- [x] 跨平台兼容性（Electron 主进程/native rebuild/文件路径/OS 差异/WSL/移动端预留）

## 声明式与防失控设计
- [x] 采用 ToolAvailabilityExpression 声明式可用性（非 if/else）
- [x] 技能三层可见性（includeInRuntimeRegistry/includeInAvailableSkillsPrompt/userInvocable）
- [x] 技能双调用策略（userInvocable/disableModelInvocation）
- [x] 自主行为 pacing + stagger + dedupe 三重节流
- [x] 写操作默认草稿区 + 高危强制确认

## 融合路径与实施顺序
- [x] 给出 5 阶段融合路径（地基→写作→对话→世界书→学习）
- [x] 每阶段保留 supportsToolCalling=false 降级路径
- [x] 写作优先（用户核心诉求）
- [x] 跨模块协同点（如模块三 dreaming 写入模块五 MemoryStore）

## 后续可执行性
- [x] 可作为子 Spec（add-tool-calling-agent-engine/add-agent-skill-and-memory-foundation/add-worldbook-writing-agent）的总纲
- [x] 每个模块的接口定义足够具体，可作为独立实施 Spec 的技术方案起点
- [x] 现有资产对接清单明确每项的适配方式与所属模块
