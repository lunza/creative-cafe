# Tasks

- [x] Task 1: 扫描主进程 AI 服务层 — 分析 `src/main/services/` 下所有 AI 调用入口，包括 AIService、characterTraitAIService、writing 系列服务、memory 系列服务、agent 系列服务、embedding 系列服务等
  - [x] SubTask 1.1: 分析 AIService.ts 核心 AI 调用抽象层
  - [x] SubTask 1.2: 分析 characterTraitAIService.ts 角色特征生成
  - [x] SubTask 1.3: 分析 writing/ 目录下所有写作相关服务（ContentGenerator、OutlineGenerator、DescriptionPolisher、PlotCheckerService、AIAssistedChapterService 等）
  - [x] SubTask 1.4: 分析 memory/ 目录下所有记忆相关服务（aiClient、organizeOrchestrator、tableOperationExecutor 等）
  - [x] SubTask 1.5: 分析 agent/ 目录下所有智能体服务（agentLoop、llmProvider、writingAgentService 等）
  - [x] SubTask 1.6: 分析 embedding/vector 相关服务（EmbeddingService、VectorStoreService 等）
  - [x] SubTask 1.7: 分析其他 AI 相关服务（tagRagService、expressionService、sdGenerationService 等）
  - [x] SubTask 1.8: 分析 IPC handlers 中 AI 相关通道
- [x] Task 2: 扫描渲染进程 AI 交互层 — 分析 `src/renderer/` 下所有 AI 调用入口
  - [x] SubTask 2.1: 分析对话管线系统（pipeline/AIService.ts、pipeline/providers/ 下所有 provider）
  - [x] SubTask 2.2: 分析 PromptBuilder.ts 提示词构建
  - [x] SubTask 2.3: 分析 ChatEngine 聊天引擎封装
  - [x] SubTask 2.4: 分析渲染进程 AIService.tsx
  - [x] SubTask 2.5: 分析 AgentCenter、Avatar、Chat、Creative 等组件中的 AI 调用
- [x] Task 3: 扫描开发文档和聊天记录 — 提取场景上下文和调用频率估算依据
  - [x] SubTask 3.1: 分析 .trae/specs/ 下所有 spec 文档中的 AI 相关描述
  - [x] SubTask 3.2: 分析 .trae/documents/ 下技术文档
  - [x] SubTask 3.3: 分析 docs/ 下项目文档
  - [x] SubTask 3.4: 分析 CHANGELOG.md 和 FIX_RECORDS.md
  - [x] SubTask 3.5: 扫描应用数据目录中的聊天记录，提取 AI 调用频率模式
- [x] Task 4: 编译并格式化场景清单文档 — 将前述所有扫描结果整理为结构化的场景清单文档
  - [x] SubTask 4.1: 按场景类别分组编排
  - [x] SubTask 4.2: 为每个场景填写 5 个完整信息模块
  - [x] SubTask 4.3: 文档格式审核与专业化排版
  - [x] SubTask 4.4: 保存到 `docs/ai-scenarios/场景清单.md`

## Task Dependencies

- [Task 4] depends on [Task 1, Task 2, Task 3] — 扫描完成后才能编译文档
- [Task 1] 和 [Task 2] 和 [Task 3] 可并行执行