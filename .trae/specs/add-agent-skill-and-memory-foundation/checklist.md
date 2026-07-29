# Checklist

## 技能库类型与注册
- [x] `skillTypes.ts` 定义 SkillManifest/SkillImplementation/SkillStep/SkillResult/SkillCategory/SkillType/SkillVersionEntry/SkillSummary
- [x] SkillManifest 含 id(kebab-case)/name/description/category/version(semver)/type/implementation/inputSchema
- [x] `skillRegistry.ts` 支持 register/unregister/get/list/discover，同 id 防重复
- [x] discoverSkills 按 name/description/tags 匹配返回摘要

## 技能执行
- [x] `skillExecutor.ts` 按 type 分发：prompt / tool-sequence / composite
- [x] prompt 类型渲染 {{var}} 插值
- [x] tool-sequence 类型按 steps 执行，结果可引用，非可选步骤失败中止
- [x] composite 类型按 handlerRef 查 compositeHandlers
- [x] 返回 SkillResult 含 trace（每步结果+耗时）
- [x] 提供 registerCompositeHandler 接口

## 技能库服务与存储
- [x] `skillService.ts` registerSkill/unregisterSkill/getSkill/listSkills 实现
- [x] loadFromDirectory/saveToDirectory（builtin/custom/agent 三目录）
- [x] invokeSkill 委托 skillExecutor
- [x] 版本管理 getSkillHistory/rollbackSkill
- [x] exportSkill/importSkill
- [x] 内置技能样例至少 2 个（JSON manifest 字段完整）

## 记忆类型与存储
- [x] `memoryTypes.ts` 定义 MemoryType(episodic/semantic/procedural)/AgentMemory/AgentMemoryMetadata/LearningEvent/MemorySearchResult
- [x] `vectorConfig.ts` VectorSourceType 新增 'agent-memory'（向后兼容）
- [x] `memoryService.ts` recordEpisodicMemory/recordSemanticMemory/recordProceduralMemory
- [x] searchMemories 向量检索（复用 EmbeddingService + VectorStoreService）
- [x] queryMemories 按类型/标签非向量查询（读索引文件）
- [x] getRelevantMemories 上下文 RAG 召回
- [x] 记录时同步向量化 + VectorRegistryService 注册（sourceType='agent-memory'）
- [x] deleteMemory + initialize

## 记忆整合与学习
- [x] `memoryConsolidator.ts` consolidate 按 taskType 分组 episodic
- [x] 提取共性模式 → semantic 记忆（成功共性/失败模式/用户偏好）
- [x] 提取工作流 → procedural 记忆（关联 skillId）
- [x] 旧 episodic relevance 衰减 + semantic 去重合并（supportCount 累加）
- [x] `agentLearningService.ts` recordTurnExperience（onTurnComplete 触发）
- [x] extractPatterns / optimizeDecision（检索相关记忆+建议技能+confidence）
- [x] applyFeedback（修正记忆 + 调整 confidence）

## 集成
- [x] `agentTypes.ts` AgentToolGroup 新增 'foundation'
- [x] `agentTypes.ts` AgentLoopCallbacks 新增 onTurnComplete?(result, context)
- [x] `agentLoop.ts` 返回前触发 onTurnComplete（可选，不传则跳过）
- [x] `tools/agentFoundationTools.ts` 含 invokeSkill/searchMemories/recordMemory/discoverSkills
- [x] tools/index.ts 注册 foundation 组（幂等）
- [x] foundation 工具 parameters 严格 JSONSchema，handler try-catch

## IPC 与 preload
- [x] skillHandlers: list/get/create/update/delete/invoke/discover/history/rollback/import/export
- [x] memoryHandlers: search/query/record/delete
- [x] learningHandlers: consolidate/optimize/feedback
- [x] preload 暴露 skill.* / memory.* / learning.* API
- [x] electron.d.ts 类型声明完整
- [x] ipc/index.ts 注册 skillHandlers + memoryHandlers

## 增量零影响
- [x] enableAgentMode=false 时 foundation 工具不注入 agentLoop
- [x] onTurnComplete 可选回调，不传则零影响
- [x] 现有 memory/ 模块与新 agent/memory/ 物理隔离不互相 import
- [x] VectorSourceType 新增值不影响现有 sourceType 处理
- [x] 现有 agentLoop 行为无回归

## 验证
- [x] npx tsc --noEmit 无新增错误
- [x] 技能库 CRUD + invoke + 版本管理逻辑正确
- [x] 三类记忆记录 + 向量检索 + 整合逻辑正确
- [x] foundation 工具注册到 foundation 组
- [x] IPC + preload + 类型声明完整

## 文档
- [x] CHANGELOG.md 新增条目
- [x] CODE_WIKI.md 新增「技能库与记忆系统」条目
- [x] PROJECT_DOCUMENTATION_NEW.md 新增小节
