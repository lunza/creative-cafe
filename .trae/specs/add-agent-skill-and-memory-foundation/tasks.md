# Tasks

## 阶段一：核心类型（地基）

- [x] Task 1: 新增 `skill/skillTypes.ts` 技能类型定义
  - [x] SubTask 1.1: 定义 SkillCategory / SkillType / SkillSource 枚举
  - [x] SubTask 1.2: 定义 SkillManifest / SkillImplementation / SkillStep / SkillExample / SkillResult / SkillVersionEntry / SkillSummary
  - [x] SubTask 1.3: 从 agentTypes 导入 AgentToolContext 复用

- [x] Task 2: 新增 `memory/memoryTypes.ts` 记忆类型定义
  - [x] SubTask 2.1: 定义 MemoryType（episodic/semantic/procedural）
  - [x] SubTask 2.2: 定义 AgentMemory / AgentMemoryMetadata / LearningEvent / MemorySearchResult
  - [x] SubTask 2.3: 从 agentTypes 导入 AgentToolContext / AgentLoopResult 复用

## 阶段二：技能库系统（可与阶段三并行）

- [x] Task 3: 新增 `skill/skillRegistry.ts` 技能注册中心
  - [x] SubTask 3.1: SkillRegistry 类——register/unregister/get/list/discover + 同 id 防重复
  - [x] SubTask 3.2: 导出单例 skillRegistry
  - [x] SubTask 3.3: discoverSkills 按查询匹配 name/description/tags 返回摘要

- [x] Task 4: 新增 `skill/skillExecutor.ts` 技能执行器
  - [x] SubTask 4.1: invokeSkill 按 type 分发：prompt / tool-sequence / composite
  - [x] SubTask 4.2: prompt 类型：渲染 systemPrompt（{{var}} 插值 input）
  - [x] SubTask 4.3: tool-sequence 类型：按 steps 顺序执行 toolRegistry 工具，结果可引用，非可选步骤失败中止
  - [x] SubTask 4.4: composite 类型：handlerRef 查 compositeHandlers map
  - [x] SubTask 4.5: 返回 SkillResult 含 trace（每步结果+耗时）
  - [x] SubTask 4.6: 注册 composite handler 的 registerCompositeHandler 接口

- [x] Task 5: 新增 `skill/skillService.ts` 技能库服务
  - [x] SubTask 5.1: registerSkill/unregisterSkill/getSkill/listSkills（内存 + 持久化）
  - [x] SubTask 5.2: loadFromDirectory/saveToDirectory（userData/skills/builtin|custom|agent/*.json）
  - [x] SubTask 5.3: invokeSkill（委托 skillExecutor）
  - [x] SubTask 5.4: 版本管理 getSkillHistory/rollbackSkill
  - [x] SubTask 5.5: exportSkill/importSkill（JSON 字符串）
  - [x] SubTask 5.6: 启动时 loadFromDirectory 初始化

- [x] Task 6: 新增 `skill/builtinSkills/` 内置技能样例
  - [x] SubTask 6.1: 至少 2 个 JSON manifest 样例（如 dialogue 组「角色设定核查」、worldbook 组「条目去重建议」）
  - [x] SubTask 6.2: 每个 manifest 字段完整（id/name/description/category/version/type/implementation/inputSchema）
  - [x] SubTask 6.3: 样例技能 requiredTools 引用已注册的真实工具

## 阶段三：记忆与学习系统（可与阶段二并行）

- [x] Task 7: 修改 `src/main/types/vectorConfig.ts`——VectorSourceType 新增 `'agent-memory'`
  - [x] SubTask 7.1: 枚举新增值
  - [x] SubTask 7.2: 确认现有 sourceType 处理逻辑不受影响（向后兼容）

- [x] Task 8: 新增 `memory/memoryService.ts` 记忆服务
  - [x] SubTask 8.1: recordEpisodicMemory / recordSemanticMemory / recordProceduralMemory
  - [x] SubTask 8.2: searchMemories（向量检索，复用 EmbeddingService + VectorStoreService）
  - [x] SubTask 8.3: queryMemories（按 type/tags/taskType 非向量查询，读索引文件）
  - [x] SubTask 8.4: getRelevantMemories（上下文相关记忆召回 RAG）
  - [x] SubTask 8.5: deleteMemory
  - [x] SubTask 8.6: initialize（建索引/加载 userData/agent-memory/index.json）
  - [x] SubTask 8.7: 记录时同步向量化 + VectorRegistryService 注册（sourceType='agent-memory'）

- [x] Task 9: 新增 `memory/memoryConsolidator.ts` 记忆整合器
  - [x] SubTask 9.1: consolidate()——按 taskType 分组 episodic 记忆
  - [x] SubTask 9.2: 提取共性模式 → semantic 记忆（成功共性 / 失败模式 / 用户偏好）
  - [x] SubTask 9.3: 提取工作流 → procedural 记忆（关联 skillId）
  - [x] SubTask 9.4: 旧 episodic relevance 衰减 + 已沉淀降低
  - [x] SubTask 9.5: semantic 去重合并（supportCount 累加）
  - [x] SubTask 9.6: 返回 {consolidated, created} 统计

- [x] Task 10: 新增 `memory/agentLearningService.ts` 自我学习服务
  - [x] SubTask 10.1: recordTurnExperience（onTurnComplete 回调触发，记录 episodic）
  - [x] SubTask 10.2: extractPatterns（委托 memoryConsolidator）
  - [x] SubTask 10.3: optimizeDecision（检索相关 semantic/procedural + 建议技能）
  - [x] SubTask 10.4: applyFeedback（用户反馈修正记忆 + 调整 confidence）
  - [x] SubTask 10.5: consolidate（触发 memoryConsolidator）

## 阶段四：集成（依赖阶段二+三）

- [x] Task 11: 修改 `agentTypes.ts` + `agentLoop.ts` + `tools/index.ts` + `vectorConfig.ts` 集成
  - [x] SubTask 11.1: AgentToolGroup 新增 'foundation'
  - [x] SubTask 11.2: AgentLoopCallbacks 新增 onTurnComplete?(result, context)
  - [x] SubTask 11.3: agentLoop 返回前触发 onTurnComplete（可选，不传则跳过）
  - [x] SubTask 11.4: 新增 `tools/agentFoundationTools.ts`——invokeSkill/searchMemories/recordMemory/discoverSkills 四工具
  - [x] SubTask 11.5: tools/index.ts registerBuiltinTools 注册 foundation 组（幂等）
  - [x] SubTask 11.6: 确保现有 agentLoop 行为无回归（onTurnComplete 可选）

## 阶段五：IPC 与 preload（依赖阶段四）

- [x] Task 12: 新增 `skillHandlers.ts` + `memoryHandlers.ts` IPC + preload 暴露
  - [x] SubTask 12.1: skill:list/get/create/update/delete/invoke/discover/history/rollback/import/export 通道
  - [x] SubTask 12.2: memory:search/query/record/delete 通道
  - [x] SubTask 12.3: learning:consolidate/optimize/feedback 通道
  - [x] SubTask 12.4: preload 暴露 skill.* / memory.* / learning.* API
  - [x] SubTask 12.5: electron.d.ts 类型声明
  - [x] SubTask 12.6: 在 ipc/index.ts 注册 skillHandlers + memoryHandlers

## 阶段六：验证与文档

- [x] Task 13: 验证
  - [x] SubTask 13.1: npx tsc --noEmit 无新增错误
  - [x] SubTask 13.2: 技能库 CRUD + invoke + 版本管理逻辑正确
  - [x] SubTask 13.3: 三类记忆记录 + 向量检索 + 整合逻辑正确
  - [x] SubTask 13.4: foundation 工具注册到 foundation 组
  - [x] SubTask 13.5: onTurnComplete 可选回调不破坏现有 agentLoop
  - [x] SubTask 13.6: VectorSourceType 新增值不影响现有处理
  - [x] SubTask 13.7: 增量零影响——enableAgentMode=false 时 foundation 工具不注入、不记录记忆
  - [x] SubTask 13.8: IPC + preload + 类型声明完整

- [x] Task 14: 更新技术文档
  - [x] SubTask 14.1: CHANGELOG.md 新增条目
  - [x] SubTask 14.2: CODE_WIKI.md 新增「技能库与记忆系统」条目
  - [x] SubTask 14.3: PROJECT_DOCUMENTATION_NEW.md 新增小节

# Task Dependencies
- Task 1（skillTypes）+ Task 2（memoryTypes）— 地基，可并行
- Task 3/4/5/6（技能库）依赖 Task 1，内部可并行（3→4→5 有序，6 可与 5 并行）
- Task 7（vectorConfig）独立，可与阶段二/三并行
- Task 8/9/10（记忆系统）依赖 Task 2 + Task 7，内部 8→9→10 有序
- 阶段二（Task 3-6）与阶段三（Task 8-10）可并行
- Task 11（集成）依赖阶段二+三
- Task 12（IPC）依赖 Task 11
- Task 13（验证）依赖全部
- Task 14（文档）依赖 Task 13
