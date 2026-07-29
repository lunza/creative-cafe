# Agent 技能库与长期学习记忆系统 Spec

## Why

方向 0「工具调用智能体引擎」已落地（[agent/](file:///g:/AI/creative-cafe/src/main/services/ai/agent/)），AI 能调用单个工具。但工具是**单函数调用**，缺乏**结构化的可复用能力单元**（技能）与**跨会话的经验积累**（记忆）。当前 Agent 每次"从零开始"——不会记住上次什么有效、不会沉淀可复用的工作流、没有标准化的能力描述让其他 Agent 复用。

本 Spec 为 Agent 模式新增两项核心基座能力：
1. **结构化 Skill 技能库**——技能的标准化定义、分类存储、版本管理、动态调用（对标 OpenClaw 的 skill 管理体系）
2. **Agent 长期自我学习与记忆系统**——经验积累、知识沉淀、决策优化、历史上下文记忆（对标具备长期学习特性的 Agent 架构）

两者共同为智能化、自主进化的 Agent 应用奠定技术基础。设计强调**可扩展接口规范与数据存储方案**，复用现有向量基础设施（VectorStoreService/VectorRegistryService）与 Agent 引擎（toolRegistry/agentLoop），不重复造轮子。

## What Changes

### 能力一：Skill 技能库系统
- **新增** `src/main/services/ai/agent/skill/` 目录：
  - `skillTypes.ts` — 技能类型（SkillManifest / SkillImplementation / SkillStep / SkillResult / SkillCategory / SkillType）
  - `skillRegistry.ts` — 技能注册中心（register/unregister/get/list/invoke + 版本管理 + 分类存储）
  - `skillService.ts` — 技能库服务（文件持久化 + 从目录加载 + 版本历史 + 回滚 + 动态调用编排）
  - `skillExecutor.ts` — 技能执行器（按 type 分发：prompt / tool-sequence / composite）
  - `builtinSkills/` — 内置技能定义（JSON manifest 文件，如「角色设定核查」「章节大纲生成」「世界书条目去重」）
- **新增** `VectorSourceType` 枚举值 `'agent-memory'`（能力二复用，技能库本身不向量化）

### 能力二：长期学习与记忆系统
- **新增** `src/main/services/ai/agent/memory/` 目录：
  - `memoryTypes.ts` — 记忆类型（AgentMemory / MemoryType=episodic|semantic|procedural / MemoryRecord / LearningEvent）
  - `memoryService.ts` — 记忆服务（记录 / 向量检索 / 按类型查询 / 相关记忆召回 RAG）
  - `agentLearningService.ts` — 自我学习服务（Agent 轮次经验记录 / 模式提取 / 知识沉淀 / 决策优化 / 反馈闭环）
  - `memoryConsolidator.ts` — 记忆整合器（episodic → semantic 沉淀 / 衰减/去重/合并）
- **修改** `src/main/types/vectorConfig.ts` — `VectorSourceType` 新增 `'agent-memory'`
- **复用** VectorStoreService / EmbeddingService / VectorRegistryService — 记忆向量化与检索

### 跨能力集成
- **新增** `src/main/services/ai/agent/tools/agentFoundationTools.ts` — 将技能调用与记忆检索暴露为 AgentTool：
  - `invokeSkill(skillId, input)` — 让 Agent 自主调用技能
  - `searchMemories(query, type?)` — 让 Agent 检索长期记忆辅助决策
  - `recordMemory(content, type, metadata?)` — 让 Agent 主动记录经验
- **修改** `src/main/services/ai/agent/tools/index.ts` — 注册上述工具到新组 `'foundation'`
- **修改** `src/main/services/ai/agent/agentTypes.ts` — `AgentToolGroup` 新增 `'foundation'`
- **修改** `src/main/services/ai/agent/agentLoop.ts` — `AgentLoopCallbacks` 新增 `onTurnComplete?(result, context)` 钩子，供学习服务记录经验（可选回调，不传则不记录，零影响）
- **新增** IPC + preload：技能库 CRUD/调用 + 记忆查询/学习的通道与前端 API

### 增量零影响
- 技能库与记忆系统默认不启用——仅在 Agent 模式开关（`enableAgentMode`）开启且模型支持工具调用时才介入
- `onTurnComplete` 为可选回调，现有调用方不传则零影响
- 现有 `memory/` 模块（聊天/表格记忆）与新 `agent/memory/` 完全独立，不互相干扰

## Impact

- Affected specs:
  - `add-tool-calling-agent-engine`（建立在方向 0 之上，扩展 AgentToolGroup 与回调）
  - `analyze-multimodal-model-feature-upgrades`（方向 0 的延伸，为方向 A/B/C 提供技能与记忆支撑）
- Affected code:
  - 修改：`src/main/services/ai/agent/agentTypes.ts`（AgentToolGroup 加 'foundation'，AgentLoopCallbacks 加 onTurnComplete）
  - 修改：`src/main/services/ai/agent/agentLoop.ts`（循环结束触发 onTurnComplete）
  - 修改：`src/main/services/ai/agent/tools/index.ts`（注册 foundation 组工具）
  - 修改：`src/main/types/vectorConfig.ts`（VectorSourceType 加 'agent-memory'）
  - 修改：`src/main/preload.ts` + `src/renderer/types/electron.d.ts`（暴露技能/记忆 API）
  - 修改：`src/main/ipc/handlers/agentHandlers.ts`（新增技能/记忆 IPC 通道）或新增 `skillHandlers.ts` / `memoryHandlers.ts`
  - 新增：`src/main/services/ai/agent/skill/` 全目录
  - 新增：`src/main/services/ai/agent/memory/` 全目录

---

## 技术方案

### 核心概念分层

```
┌─────────────────────────────────────────────────┐
│  Agent Loop（方向 0 已建）                        │
│   ↓ 调用                                          │
│  AgentTool（单函数）                              │
│   ├─ searchWorldbook / searchChatHistory（已有）  │
│   ├─ invokeSkill(skillId, input)  ← 技能调用工具  │
│   ├─ searchMemories(query)        ← 记忆检索工具  │
│   └─ recordMemory(content, type)  ← 经验记录工具  │
│         │                                         │
│         ↓ invokeSkill                             │
│  Skill（结构化能力单元）                           │
│   ├─ type: prompt       → 渲染提示词模板           │
│   ├─ type: tool-sequence→ 编排多工具调用           │
│   └─ type: composite    → 调用代码 handler         │
│         │                                         │
│  Memory（长期记忆）                                │
│   ├─ episodic  → 具体 Agent 轮次经验              │
│   ├─ semantic  → 沉淀的模式/规则/知识             │
│   └─ procedural→ 学到的工作流（关联 skillId）      │
│         ↑ onTurnComplete 回调记录                  │
└─────────────────────────────────────────────────┘
```

**工具 vs 技能**：工具是原子函数（`searchWorldbook(query)`）；技能是结构化能力单元（「角色设定核查」技能 = 加载角色卡 → 检索世界书 → 比对一致性 → 生成报告，组合多工具+提示词）。技能让能力可被描述、发现、复用、版本化。

### 能力一：Skill 数据模型（skillTypes.ts）

```typescript
/** 技能分类（与工具组对齐 + general） */
export type SkillCategory = 'dialogue' | 'writing' | 'worldbook' | 'general';

/** 技能实现类型 */
export type SkillType = 'prompt' | 'tool-sequence' | 'composite';

/** 技能来源 */
export type SkillSource = 'system' | 'user' | 'agent';

/** 技能清单（标准化定义） */
export interface SkillManifest {
  id: string;                    // 唯一标识，kebab-case
  name: string;                  // 显示名
  description: string;           // 做什么 + 何时用（供 Agent 决策调用）
  category: SkillCategory;
  version: string;               // semver，如 "1.0.0"
  author: SkillSource;
  tags: string[];
  enabled: boolean;

  /** 输入 schema（JSONSchema） */
  inputSchema: Record<string, any>;
  /** 输出 schema（可选） */
  outputSchema?: Record<string, any>;

  /** 实现类型与具体实现 */
  type: SkillType;
  implementation: SkillImplementation;

  /** 依赖的工具名（AgentTool name） */
  requiredTools?: string[];
  /** 依赖的其他技能 id */
  requiredSkills?: string[];

  /** 少样本示例（供 Agent 理解调用方式） */
  examples?: SkillExample[];

  /** 元数据 */
  createdAt: string;
  updatedAt: string;
  /** Agent 自动生成标记 */
  autoGenerated?: boolean;
}

export interface SkillImplementation {
  /** prompt 类型：系统提示词模板（支持 {{var}} 插值） */
  prompt?: {
    systemPrompt: string;
    userPromptTemplate?: string;
  };
  /** tool-sequence 类型：有序步骤 */
  steps?: SkillStep[];
  /** composite 类型：代码 handler 引用名（在 skillExecutor 注册） */
  handlerRef?: string;
}

export interface SkillStep {
  toolName: string;              // AgentTool name
  argsTemplate: string;          // 模板，可引用上一步结果 {{step.resultKey}}
  resultKey: string;             // 存储结果供后续步骤引用
  optional?: boolean;            // 失败是否继续
}

export interface SkillExample {
  input: Record<string, any>;
  output: Record<string, any>;
  description?: string;
}

/** 技能调用结果 */
export interface SkillResult {
  success: boolean;
  data?: any;
  error?: string;
  /** 执行轨迹（每步结果） */
  trace?: Array<{ step: string; result: any; durationMs: number }>;
}

/** 技能版本历史条目 */
export interface SkillVersionEntry {
  version: string;
  manifest: SkillManifest;
  createdAt: string;
  changeLog?: string;
}
```

### 能力一：SkillService 接口

```typescript
class SkillService {
  /** 注册技能（内存 + 持久化） */
  registerSkill(manifest: SkillManifest): Promise<void>;
  /** 注销技能 */
  unregisterSkill(id: string): Promise<void>;
  /** 获取技能定义 */
  getSkill(id: string): SkillManifest | undefined;
  /** 列出技能（按分类/启用状态过滤） */
  listSkills(category?: SkillCategory, enabledOnly?: boolean): SkillManifest[];
  /** 发现技能（供 Agent 决策，返回 id+name+description 摘要） */
  discoverSkills(query: string, category?: SkillCategory): SkillSummary[];
  /** 调用技能 */
  invokeSkill(id: string, input: Record<string, any>, context?: AgentToolContext): Promise<SkillResult>;
  /** 从目录加载（启动时） */
  loadFromDirectory(): Promise<void>;
  /** 保存到目录 */
  saveToDirectory(): Promise<void>;
  /** 版本管理 */
  getSkillHistory(id: string): SkillVersionEntry[];
  rollbackSkill(id: string, version: string): Promise<void>;
  /** 导入/导出（分享技能） */
  exportSkill(id: string): Promise<string>;  // JSON 字符串
  importSkill(json: string): Promise<void>;
}
```

### 能力一：SkillExecutor 分发逻辑

```
invokeSkill(id, input, context):
  manifest = getSkill(id)
  switch manifest.type:
    case 'prompt':
      渲染 systemPrompt（插值 input）→ 返回 {success, data: {systemPrompt, userPrompt}}
    case 'tool-sequence':
      results = {}
      for step in manifest.implementation.steps:
        args = 渲染 step.argsTemplate（插值 input + results）
        tool = toolRegistry.getTool(step.toolName)
        result = await tool.handler(args, context)
        results[step.resultKey] = result
        if !result.success && !step.optional: return {success:false, error, trace}
      return {success:true, data: results, trace}
    case 'composite':
      handler = compositeHandlers.get(manifest.implementation.handlerRef)
      return await handler(input, context)
```

### 能力一：存储方案
- **内置技能**：`userData/skills/builtin/*.json`（随应用分发，只读）
- **用户技能**：`userData/skills/custom/*.json`（用户创建/编辑）
- **Agent 生成技能**：`userData/skills/agent/*.json`（autoGenerated:true）
- **版本历史**：`userData/skills/versions/<skillId>/`（每个版本一个 JSON）
- 每个技能一个 JSON 文件（文件名 = skillId），便于导入导出与版本管理

### 能力二：Memory 数据模型（memoryTypes.ts）

```typescript
/** 记忆类型（认知科学三分类） */
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

/**
 * episodic（情景记忆）：具体 Agent 轮次经验
 *   - "在角色卡X的对话中，调用 searchWorldbook 成功找到设定Y"
 * semantic（语义记忆）：沉淀的知识/模式/规则
 *   - "用户偏好简洁回复，长篇设定查询前先确认"
 * procedural（程序记忆）：学到的工作流（关联技能）
 *   - "写战斗场景时，先查角色能力表→再查世界书战斗规则→再生成"
 */
export interface AgentMemory {
  id: string;
  type: MemoryType;
  content: string;               // 记忆文本
  metadata: AgentMemoryMetadata;
  /** 向量（由 EmbeddingService 生成） */
  vector?: number[];
  createdAt: string;
  updatedAt: string;
  /** 衰减后的相关性（0-1，近期记忆更高） */
  relevance?: number;
}

export interface AgentMemoryMetadata {
  source: 'agent-memory';
  sourceType: MemoryType;
  // episodic 专属
  sessionId?: string;
  timestamp?: number;
  taskType?: string;             // 'dialogue' | 'writing' | 'worldbook' | ...
  outcome?: 'success' | 'failure' | 'partial';
  toolCalls?: string[];          // 涉及的工具名
  durationMs?: number;
  // semantic 专属
  pattern?: string;
  confidence?: number;           // 0-1
  derivedFrom?: string[];        // 源自哪些 episodic 记忆 id
  supportCount?: number;         // 支撑该结论的 episodic 数
  // procedural 专属
  skillId?: string;
  // 通用
  tags?: string[];
  characterId?: string;
  projectId?: string;
}

/** Agent 轮次学习事件（供 agentLearningService 记录） */
export interface LearningEvent {
  sessionId?: string;
  taskType: string;
  taskDescription?: string;
  toolCalls: Array<{ name: string; success: boolean; durationMs: number }>;
  outcome: 'success' | 'failure' | 'partial';
  finalContentLength?: number;
  context?: AgentToolContext;
  timestamp: number;
}

/** 记忆检索结果 */
export interface MemorySearchResult {
  memory: AgentMemory;
  score: number;                 // 相似度分数
}
```

### 能力二：MemoryService 接口

```typescript
class MemoryService {
  /** 记录情景记忆（Agent 轮次后自动调用） */
  recordEpisodicMemory(event: LearningEvent): Promise<AgentMemory>;
  /** 记录语义记忆（沉淀的知识） */
  recordSemanticMemory(content: string, pattern: string, derivedFrom?: string[]): Promise<AgentMemory>;
  /** 记录程序记忆（学到的工作流） */
  recordProceduralMemory(skillId: string, content: string): Promise<AgentMemory>;
  /** 向量检索记忆（RAG） */
  searchMemories(query: string, type?: MemoryType, topK?: number): Promise<MemorySearchResult[]>;
  /** 按类型/标签查询 */
  queryMemories(filter: { type?: MemoryType; tags?: string[]; taskType?: string }): Promise<AgentMemory[]>;
  /** 获取与当前上下文相关的记忆（供 Agent 决策） */
  getRelevantMemories(context: AgentToolContext, taskDescription: string, topK?: number): Promise<MemorySearchResult[]>;
  /** 删除记忆 */
  deleteMemory(id: string): Promise<void>;
  /** 初始化（建索引/加载） */
  initialize(): Promise<void>;
}
```

### 能力二：AgentLearningService 接口

```typescript
class AgentLearningService {
  /** Agent 轮次完成后记录经验（由 onTurnComplete 回调触发） */
  recordTurnExperience(result: AgentLoopResult, event: LearningEvent): Promise<void>;
  /** 从 episodic 记忆中提取模式 → 沉淀为 semantic 记忆 */
  extractPatterns(taskType?: string): Promise<AgentMemory[]>;
  /** 决策优化：为当前任务检索相关经验/知识/工作流 */
  optimizeDecision(taskType: string, taskDescription: string, context?: AgentToolContext): Promise<{
    relevantMemories: MemorySearchResult[];
    suggestedSkills?: string[];   // 建议调用的技能
    confidence: number;
  }>;
  /** 用户反馈闭环（修正记忆） */
  applyFeedback(memoryId: string, feedback: { correct: boolean; correction?: string }): Promise<void>;
  /** 触发记忆整合（定期或手动） */
  consolidate(): Promise<{ consolidated: number; created: number }>;
}
```

### 能力二：MemoryConsolidator 整合逻辑

```
consolidate():
  1. 取所有 episodic 记忆，按 taskType 分组
  2. 对每组，用 AI（或规则）提取共性模式：
     - 相同 taskType 下，成功轮次的共性工具序列 → procedural 记忆
     - 反复出现的失败模式 → semantic 记忆（"避免X"）
     - 用户反馈集中的偏好 → semantic 记忆
  3. 新 semantic/procedural 记忆 derivedFrom 指向源 episodic
  4. 旧 episodic 记忆 relevance 衰减（时间衰减 + 已沉淀的降低）
  5. 去重：相似 semantic 记忆合并，supportCount 累加
```

### 能力二：存储方案（复用向量基础设施）
- **向量化**：复用 `EmbeddingService` 生成记忆 content 的向量
- **向量存储**：复用 `VectorStoreService`，注册 sourceType=`'agent-memory'`
- **注册表**：复用 `VectorRegistryService`，每条记忆一个 `VectorRegistryEntry`，`sourceId`=memoryId，`additionalMetadata` 存 memoryType/tags/taskType
- **索引文件**：`userData/agent-memory/index.json`（记忆元数据索引，便于非向量查询）
- **整合产物**：semantic/procedural 记忆同样向量化入库

### 跨能力集成：Foundation 工具

将技能与记忆暴露为 AgentTool，让 Agent 在 agentLoop 中自主调用：

```typescript
// invokeSkill 工具
{
  name: 'invokeSkill',
  description: '调用已注册的技能。当面对复杂任务时，先 discoverSkills 查找可用技能，再调用。',
  parameters: { type:'object', properties:{ skillId:{type:'string'}, input:{type:'object'} }, required:['skillId','input'] },
  handler: async (args, context) => skillService.invokeSkill(args.skillId, args.input, context)
}

// searchMemories 工具
{
  name: 'searchMemories',
  description: '检索 Agent 长期记忆。当需要回忆过去类似任务的经验、学到的规则时调用。',
  parameters: { type:'object', properties:{ query:{type:'string'}, type:{type:'string', enum:['episodic','semantic','procedural']} }, required:['query'] },
  handler: async (args) => memoryService.searchMemories(args.query, args.type)
}

// recordMemory 工具
{
  name: 'recordMemory',
  description: '记录一条经验到长期记忆。当发现值得记住的模式、规则、教训时调用。',
  parameters: { type:'object', properties:{ content:{type:'string'}, type:{type:'string', enum:['episodic','semantic','procedural']}, metadata:{type:'object'} }, required:['content','type'] },
  handler: async (args) => { ... recordMemory ... }
}

// discoverSkills 工具
{
  name: 'discoverSkills',
  description: '发现可用技能。当不确定有哪些技能可复用时调用，返回技能摘要列表。',
  parameters: { type:'object', properties:{ query:{type:'string'}, category:{type:'string'} }, required:['query'] },
  handler: async (args) => skillService.discoverSkills(args.query, args.category)
}
```

注册到新工具组 `'foundation'`，agentLoop 可按需启用。

### AgentLoop 回调扩展

```typescript
export interface AgentLoopCallbacks {
  onToolCall?: (event: ToolCallEvent) => void;
  onFinalChunk?: (chunk: string) => void;
  onIteration?: (iteration: number) => void;
  /** 新增：Agent 轮次完成后触发（供学习服务记录经验，可选） */
  onTurnComplete?: (result: AgentLoopResult, context?: AgentToolContext) => void;
}
```

agentLoop 在返回前调用 `callbacks.onTurnComplete?.(result, context)`。AgentLearningService 通过此回调自动记录经验。不传则不记录（零影响）。

### IPC 通道

**技能库**（新增 `skillHandlers.ts` 或并入 agentHandlers）：
- `skill:list` — 列出技能
- `skill:get` — 获取技能定义
- `skill:create` / `skill:update` / `skill:delete` — CRUD
- `skill:invoke` — 调用技能
- `skill:discover` — 发现技能
- `skill:history` / `skill:rollback` — 版本管理
- `skill:import` / `skill:export` — 导入导出

**记忆与学习**（新增 `memoryHandlers.ts` 或并入）：
- `memory:search` — 检索记忆
- `memory:query` — 按类型查询
- `memory:record` — 记录记忆
- `memory:delete` — 删除记忆
- `learning:consolidate` — 触发整合
- `learning:optimize` — 决策优化建议
- `learning:feedback` — 用户反馈

### 增量零影响保证
- 所有新功能默认不启用；仅 `enableAgentMode=true` 且 `supportsToolCalling=true` 时，foundation 工具组才注入 agentLoop
- `onTurnComplete` 可选回调，现有调用方不传则零影响
- 现有 `memory/` 模块与新 `agent/memory/` 物理隔离（不同目录），不互相 import
- 新增 `VectorSourceType='agent-memory'` 是枚举新增值，不影响现有 sourceType 处理

---

## ADDED Requirements

### Requirement: 技能标准化定义
系统 SHALL 提供技能清单格式（SkillManifest），标准化定义技能的 id/name/description/category/version/type/implementation/dependencies/examples。

#### Scenario: 技能定义完整
- **WHEN** 注册一个技能
- **THEN** manifest 含 id（kebab-case）、name、description、category、version（semver）、type、implementation、inputSchema
- **AND** 同 id 技能不可重复注册

### Requirement: 技能分类存储与版本管理
系统 SHALL 按分类（dialogue/writing/worldbook/general）与来源（system/user/agent）存储技能，并维护版本历史支持回滚。

#### Scenario: 按分类过滤
- **WHEN** 查询 `listSkills('writing')`
- **THEN** 仅返回 writing 分类技能
- **AND** 可选仅返回 enabled 技能

#### Scenario: 版本回滚
- **WHEN** 调用 `rollbackSkill(id, '1.0.0')`
- **THEN** 技能恢复到 1.0.0 版本
- **AND** 版本历史保留

### Requirement: 技能动态调用
系统 SHALL 支持按 type 分发执行技能：prompt 类型渲染模板、tool-sequence 类型编排多工具、composite 类型调用代码 handler。

#### Scenario: tool-sequence 技能执行
- **WHEN** 调用一个 tool-sequence 技能
- **THEN** 按 steps 顺序执行各工具
- **AND** 每步结果可被后续步骤引用
- **AND** 非可选步骤失败时中止并返回错误
- **AND** 返回执行 trace

### Requirement: 技能发现
系统 SHALL 提供 discoverSkills，返回技能摘要（id/name/description）供 Agent 决策调用。

#### Scenario: Agent 发现技能
- **WHEN** Agent 调用 `discoverSkills('角色设定核查')`
- **THEN** 返回匹配的技能摘要列表
- **AND** 摘要含 id/name/description 供 Agent 选择

### Requirement: 长期记忆三类
系统 SHALL 支持三类记忆：episodic（情景经验）、semantic（沉淀知识）、procedural（工作流），复用向量基础设施存储与检索。

#### Scenario: 记录情景记忆
- **WHEN** Agent 轮次完成且 onTurnComplete 注册
- **THEN** 自动记录 episodic 记忆（含 taskType/outcome/toolCalls）
- **AND** 记忆 content 向量化入 VectorStoreService（sourceType='agent-memory'）

#### Scenario: 检索相关记忆
- **WHEN** Agent 调用 `searchMemories('战斗场景写作')`
- **THEN** 向量检索返回最相关记忆（跨会话）
- **AND** 可按 type 过滤

### Requirement: 自我学习闭环
系统 SHALL 实现 Agent 学习服务：记录经验 → 提取模式 → 沉淀知识 → 优化决策 → 反馈修正。

#### Scenario: 经验记录
- **WHEN** Agent 轮次完成
- **THEN** onTurnComplete 回调触发 recordTurnExperience
- **AND** 记录为 episodic 记忆

#### Scenario: 知识沉淀
- **WHEN** 调用 `consolidate()`
- **THEN** 从 episodic 记忆提取共性模式
- **AND** 沉淀为 semantic/procedural 记忆
- **AND** 旧 episodic 记忆 relevance 衰减

#### Scenario: 决策优化
- **WHEN** Agent 面对新任务
- **THEN** optimizeDecision 检索相关 semantic/procedural 记忆
- **AND** 返回相关记忆与建议技能
- **AND** 含 confidence 分数

#### Scenario: 反馈闭环
- **WHEN** 用户对记忆 applyFeedback(correct:false, correction:'...')
- **THEN** 修正或删除该记忆
- **AND** 降低相关 semantic 记忆 confidence

### Requirement: Foundation 工具组
系统 SHALL 将技能调用与记忆检索暴露为 AgentTool（invokeSkill/searchMemories/recordMemory/discoverSkills），注册到 'foundation' 组，供 agentLoop 按需启用。

#### Scenario: Agent 自主调用技能
- **WHEN** agentLoop 启用 'foundation' 组
- **THEN** Agent 可调用 invokeSkill 工具
- **AND** 工具调用 skillService.invokeSkill 执行

### Requirement: 增量零影响
系统 SHALL 默认不启用技能库与记忆系统；仅在 enableAgentMode=true 且 supportsToolCalling=true 时介入；onTurnComplete 为可选回调。

#### Scenario: Agent 模式关闭
- **WHEN** enableAgentMode=false（默认）
- **THEN** foundation 工具不注入 agentLoop
- **AND** 不记录任何 Agent 记忆
- **AND** 现有功能行为与升级前完全一致

## MODIFIED Requirements

### Requirement: AgentToolGroup（agentTypes 扩展）
`AgentToolGroup` 新增 `'foundation'` 值。现有 dialogue/writing/worldbook 组行为不变。

### Requirement: AgentLoopCallbacks（agentLoop 扩展）
`AgentLoopCallbacks` 新增可选 `onTurnComplete?(result, context)`。agentLoop 在返回前触发该回调。现有不传该回调的调用方行为不变。

### Requirement: VectorSourceType（vectorConfig 扩展）
`VectorSourceType` 枚举新增 `'agent-memory'` 值。现有 sourceType 处理逻辑不受影响。

## REMOVED Requirements

无。
