# 智能体模式管理与智能体管理中心 Spec

> 本 Spec 为**功能型 Spec**，基于已完成的智能体技术底座（`design-agent-tech-foundation-from-openclaw` + `implement-agent-foundation-and-fix-defects`）与世界书编写智能体（`implement-worldbook-authoring-agent`），实现智能体模式的自动切换机制与统一的智能体管理中心 UI。参考 openclaw `src/config/types.agents.ts` 的 AgentConfig 配置范式与 `src/agents/agent-scope-config.ts` 的花名册管理理念，设计本项目首个可视化智能体管理界面。

## Why

当前系统的 Agent 模式依赖手动 `useAgent` 标志（`AIEngineSetting.useAgent`，默认 `false`），且**该标志在设置 UI 中无对应开关**——用户无法感知、更无法切换 Agent 模式。同时，系统已落地三个智能体（对话 / 写作 / 世界书），但它们分散在各功能模块中，用户无法在一个统一界面查看、配置和管理。用户需要一个**自动检测模型能力并自动切换 Agent 模式**的机制，以及一个**集中管理所有智能体**的中心界面。

## What Changes

### A. 智能体模式自动切换机制
- **新增 `agentModeService`**：根据当前活跃引擎的 `supportsToolCalling` 能力自动判定 Agent 模式开关状态，替代手动 `useAgent` 标志的主导地位
- **模式状态指示器**：在 `Header.tsx` 的 logo 旁新增 Agent 模式状态徽标（永久可见），激活时显示绿色 "Agent" 徽标，关闭时显示灰色 "普通" 徽标
- **模式切换日志**：状态变更时记录到 MemoryStore 审计表（source: 'agent-mode-switch'）
- **手动覆盖开关**：在 AI 引擎设置面板新增 `agentModeOverride` 三态开关（`auto` / `force-on` / `force-off`），默认 `auto`（跟随模型能力自动判定）

### B. Agent 模式功能切换
- **统一门控逻辑**：将现有散落的 `useAgent && supportsToolCalling` 双条件守卫升级为统一的 `agentModeService.isAgentModeActive()` 单一入口
- **自动切换预设功能**：Agent 模式激活时，世界书编写智能体、写作智能体等预设功能自动以智能体模式运行；关闭时自动降级为手动模式
- **模式切换事件广播**：通过 IPC 事件 `agent:modeChanged` 通知所有渲染进程消费方实时响应

### C. 智能体管理中心
- **新增左侧导航菜单项**：`routeConfig.ts` 新增 `agent-center` 菜单项（`RobotOutlined` 图标），仅在 Agent 模式激活时显示
- **智能体列表视图**：表格展示所有已注册智能体（名称、类型、状态、模式、创建时间、操作按钮）
- **智能体管理操作**：启用/禁用切换、编辑配置、查看详情
- **技能配置面板**：展示智能体关联的技能列表，支持技能的启用/禁用、优先级调整、参数查看
- **参考 openclaw 范式**：AgentConfig 配置模型（id/name/description/type/skills/status）、技能白名单机制（`skills?: string[]`）

### D. 智能体配置数据模型与持久化
- **新增 `AgentConfig` 类型**：定义智能体配置的标准格式（参照 openclaw `AgentConfig` 简化适配）
- **新增 `agentConfigService`**：智能体配置的 CRUD 服务，持久化到 SQLite（复用现有 `agent/memory/sqliteBackend.ts`）
- **系统预置智能体注册**：对话智能体、写作智能体、世界书智能体作为系统预置智能体自动注册

**BREAKING**：`AIEngineSetting.useAgent` 字段语义变更——从"手动开关"变为"自动判定结果快照"（只读），实际控制权移交给 `agentModeOverride` 三态开关。现有 `useAgent && supportsToolCalling` 门控模式将统一替换为 `agentModeService.isAgentModeActive()`。

## Impact

- **Affected specs**:
  - `design-agent-tech-foundation-from-openclaw` — 复用其 AgentCore / SkillPlatform / MemoryStore 架构
  - `implement-agent-foundation-and-fix-defects` — 修改 Task 16（ChatEngine useAgent 开关）的门控逻辑
  - `implement-worldbook-authoring-agent` — 修改其 Agent gating 从 `useAgent && supportsToolCalling` 到 `isAgentModeActive()`
  - `add-model-capability-detection-and-image-recognition` — 依赖其 `supportsToolCalling` 检测能力
- **Affected code**:
  - 新增：`src/main/services/agent/management/`（智能体配置管理服务）
  - 新增：`src/renderer/components/AgentCenter/`（管理中心 UI）
  - 修改：`src/renderer/components/Layout/Header.tsx`（模式状态指示器）
  - 修改：`src/renderer/routeConfig.ts`（新增菜单项）
  - 修改：`src/renderer/components/Settings/model-config/LLMEngineTab.tsx`（`agentModeOverride` 开关）
  - 修改：`src/renderer/types/setting.ts`（新增 `agentModeOverride` 字段）
  - 修改：`src/main/services/agent/contracts.ts`（新增 AgentConfig 类型）
  - 修改：`src/renderer/components/Common/ChatEngine/ChatEngine.ts`（门控逻辑统一）
  - 修改：`src/renderer/components/WorldBook/WorldBookManager.tsx`（门控逻辑统一）
  - 修改：`src/main/ipc/handlers/agentHandlers.ts`（新增 agent-config:* IPC 通道 + agent:modeChanged 事件）
  - 修改：`src/main/preload.ts` + `src/renderer/types/electron.d.ts`（暴露新 API）

---

## 一、智能体模式自动切换机制

### 1.1 设计理念

参考 openclaw 的声明式能力检测范式（`src/llm/types.ts` 的 `ModelCapabilities` + `capabilityDetector`），Agent 模式的激活不再依赖用户手动开关，而是由系统根据当前 LLM 模型的实际能力自动判定。用户保留 `agentModeOverride` 三态开关作为覆盖手段。

### 1.2 agentModeService 架构

新增 `src/main/services/agent/management/agentModeService.ts`：

```typescript
type AgentModeOverride = 'auto' | 'force-on' | 'force-off';

interface AgentModeStatus {
  active: boolean;                    // 当前 Agent 模式是否激活
  reason: 'tool-calling-supported' | 'force-on' | 'force-off' | 'tool-calling-unsupported';
  supportsToolCalling: boolean;       // 当前模型能力
  override: AgentModeOverride;        // 用户覆盖设置
  lastChangedAt: number;              // 上次变更时间戳
}

class AgentModeService {
  // 获取当前模式状态
  getStatus(): AgentModeStatus;
  // 核心判定：Agent 模式是否激活
  isAgentModeActive(): boolean;
  // 设置用户覆盖
  setOverride(override: AgentModeOverride): void;
  // 引擎切换/能力变更时重新计算
  reevaluate(activeEngine: AIEngineSetting): void;
  // 订阅模式变更事件
  onModeChanged(callback: (status: AgentModeStatus) => void): () => void;
}
```

**判定逻辑**：
```
override === 'force-on' → active = true
override === 'force-off' → active = false
override === 'auto' → active = supportsToolCalling
```

### 1.3 模式状态指示器

在 `Header.tsx` 的 `logo-container` 内（现有能力徽标组之前）新增 Agent 模式徽标：

| 状态 | 显示 | 样式 |
|------|------|------|
| 激活（auto/force-on） | `<RobotOutlined /> Agent` | 绿色背景 + 白色文字 + Tooltip "智能体模式已激活" |
| 关闭（force-off/不支持） | `<RobotOutlined /> 普通` | 灰色背景 + Tooltip "智能体模式未激活（原因）" |

**永久可见**：无论 Agent 模式是否激活，徽标始终显示（仅颜色和文字不同），确保用户在任何状态下都能感知当前模式。

### 1.4 模式切换日志

每次模式状态变更时，写入 MemoryStore 审计表：
```typescript
{
  type: 'audit',
  content: JSON.stringify({ action: 'agent-mode-changed', from: boolean, to: boolean, reason, timestamp }),
  provenance: { source: 'agent-mode-switch', timestamp: Date.now() },
  metadata: { agentId: 'system' }
}
```

---

## 二、Agent 模式功能切换

### 2.1 统一门控逻辑

将现有散落的 `useAgent && supportsToolCalling` 双条件守卫替换为 `agentModeService.isAgentModeActive()` 单一入口。

**修改点清单**：

| 文件 | 原逻辑 | 新逻辑 |
|------|--------|--------|
| `ChatEngine.ts:76-80` | `config.useAgent === true && config.capabilities?.supportsToolCalling === true` | `agentModeService.isAgentModeActive()`（通过 IPC 同步查询） |
| `WorldBookManager.tsx:76-79` | `activeEngine?.useAgent === true && supportsToolCalling === true` | 通过 IPC `agent:isModeActive` 查询 |
| `WorldBookManager.tsx` 智能体编写按钮 | 同上 | 同上 |
| `writingAgentHandlers.ts` | 每个 handler 校验 `useAgent && supportsToolCalling` | 校验 `isAgentModeActive()` |
| `worldbookAgentHandlers.ts` | 同上 | 同上 |
| `agentHandlers.ts` | `getToolProvider()` 中隐式假设 | 显式校验 `isAgentModeActive()` |

### 2.2 模式切换事件广播

主进程 `agentModeService` 在模式变更时通过 `webContents.send('agent:modeChanged', status)` 广播到所有渲染进程。

渲染进程新增 `useAgentMode` hook 统一消费：
```typescript
function useAgentMode(): {
  isActive: boolean;
  status: AgentModeStatus | null;
  loading: boolean;
} {
  // IPC 查询初始状态 + 监听 agent:modeChanged 事件
}
```

所有需要 Agent 模式门控的组件统一使用此 hook，替代散落的 `useAgent && supportsToolCalling` 模式。

### 2.3 数据一致性保障

- 模式切换时，正在运行的智能体任务不中断（通过 AbortController 优雅终止当前 turn）
- 模式切换后，新发起的任务遵循新模式
- 前端 UI 通过 `agent:modeChanged` 事件实时响应（菜单项显隐、按钮启用/禁用）

---

## 三、智能体管理中心

### 3.1 设计理念

参考 openclaw 的 AgentConfig 配置范式（`src/config/types.agents.ts`）与花名册管理理念（`src/agents/agent-scope-config.ts`），设计本项目首个可视化智能体管理界面。openclaw 通过 CLI `agents list` 管理智能体，本项目通过 GUI 实现等效功能。

### 3.2 AgentConfig 类型定义

新增 `src/main/services/agent/management/agentConfigTypes.ts`（参照 openclaw `AgentConfig` 简化适配）：

```typescript
type AgentType = 'dialogue' | 'writing' | 'worldbook' | 'game' | 'custom';
type AgentStatus = 'enabled' | 'disabled';

interface AgentConfig {
  id: string;                         // 唯一标识（如 'dialogue-agent', 'writing-agent'）
  name: string;                       // 显示名称
  description: string;                // 人类可读描述
  type: AgentType;                    // 智能体类型
  status: AgentStatus;                // 启用/禁用
  isSystem: boolean;                  // 系统预置（不可删除）
  skills: string[];                   // 技能白名单（参照 openclaw AgentConfig.skills）
  mode: 'dialogue' | 'writing' | 'game' | 'worldbook';  // 运行模式
  identity?: {
    emoji?: string;                   // 图标
    color?: string;                   // 主题色
  };
  config?: Record<string, unknown>;   // 类型特定配置（如写作智能体的编排选项）
  createdAt: number;
  updatedAt: number;
}
```

### 3.3 系统预置智能体

| ID | 名称 | 类型 | 模式 | 技能 | 对应服务 |
|----|------|------|------|------|---------|
| `dialogue-agent` | 对话智能体 | dialogue | dialogue | state-table-edit, chat-history-search, worldbook-search | ChatEngine AgentCore 路径 |
| `writing-agent` | 写作智能体 | writing | writing | plot-check, outline-generate, chapter-write, description-polish, table-organize | WritingAgentService |
| `worldbook-agent` | 世界书智能体 | worldbook | worldbook | worldbook-author, worldbook-generate, worldbook-keywords, worldbook-sort | WorldBookAuthoringService |

系统预置智能体标记 `isSystem: true`，不可删除，但可启用/禁用和配置技能。

### 3.4 智能体管理中心 UI

新增 `src/renderer/components/AgentCenter/` 目录：

```
AgentCenter/
├── AgentCenter.tsx              # 主页面（智能体列表 + 详情侧抽屉）
├── AgentList.tsx                # 智能体列表表格
├── AgentDetail.tsx              # 智能体详情面板（基本信息 + 配置）
├── SkillConfigPanel.tsx         # 技能配置面板（技能列表 + 启用/禁用 + 优先级）
├── hooks/
│   ├── useAgentConfigs.ts       # 智能体配置 CRUD hook
│   └── useAgentMode.ts          # Agent 模式状态 hook（全局共享）
└── AgentCenter.css              # 样式
```

**列表表格列**：
| 列 | 内容 | 说明 |
|----|------|------|
| 智能体 | emoji + 名称 | 主标识 |
| 类型 | AgentType 中文标签 | 对话/写作/世界书/游戏/自定义 |
| 状态 | Switch 组件 | 启用/禁用切换 |
| 技能数 | 数字 | 关联技能数量 |
| 创建时间 | 格式化日期 | |
| 操作 | 按钮 | 详情、编辑配置 |

**详情侧抽屉**：
- 基本信息卡片（名称、描述、类型、模式、创建/更新时间）
- 技能配置面板（SkillConfigPanel）
- 类型特定配置（如写作智能体的编排选项）

**技能配置面板**（SkillConfigPanel）：
- 展示当前智能体关联的所有技能（从 `skillRegistry.list()` 获取）
- 每个技能行：技能名 + 描述 + 启用/禁用 Switch + 优先级拖拽排序
- 技能参数查看（只读展示 SKILL.md 的 frontmatter 参数）
- 参照 openclaw 的技能白名单机制：`skills: string[]` 控制可见技能，空数组 = 无技能

### 3.5 左侧导航菜单集成

`routeConfig.ts` 新增：
```typescript
{
  key: 'agent-center',
  label: '智能体中心',
  icon: RobotOutlined,
  component: AgentCenter,
}
```

**条件显示**：`Sidebar.tsx` 在渲染菜单项时，对 `agent-center` 项增加 `useAgentMode()` 门控——`isActive` 为 `true` 时显示，`false` 时隐藏。其他菜单项不受影响。

---

## 四、数据持久化与状态管理

### 4.1 存储方案

复用现有 `src/main/services/agent/memory/sqliteBackend.ts`，新增 `agent_configs` 表：

```sql
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  is_system INTEGER NOT NULL DEFAULT 0,
  skills TEXT NOT NULL DEFAULT '[]',      -- JSON array
  mode TEXT NOT NULL,
  identity TEXT,                           -- JSON object
  config TEXT,                             -- JSON object
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 4.2 agentConfigService

新增 `src/main/services/agent/management/agentConfigService.ts`：

```typescript
class AgentConfigService {
  // 初始化：创建表 + 注册系统预置智能体
  init(): Promise<void>;
  // CRUD
  list(): Promise<AgentConfig[]>;
  getById(id: string): Promise<AgentConfig | null>;
  create(config: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentConfig>;
  update(id: string, patch: Partial<AgentConfig>): Promise<AgentConfig>;
  delete(id: string): Promise<void>;  // 系统预置不可删除
  // 技能管理
  updateSkills(id: string, skills: string[]): Promise<AgentConfig>;
  // 启用/禁用
  toggleStatus(id: string): Promise<AgentConfig>;
}
```

### 4.3 状态同步

- 主进程 `agentConfigService` 维护内存缓存（首次 `list()` 后缓存）
- 渲染进程通过 IPC 读写，IPC handler 直接操作 service
- 配置变更时通过 `webContents.send('agent:configChanged', { agentId, action })` 通知所有渲染进程
- 多端一致性：Electron 单实例运行，无多端同步需求；配置变更实时生效

---

## 五、IPC 通道规范

| 通道 | 方向 | Payload | 用途 |
|------|------|---------|------|
| `agent:isModeActive` | req→main | — | 查询当前 Agent 模式是否激活 |
| `agent:getModeStatus` | req→main | — | 查询详细模式状态 |
| `agent:setModeOverride` | req→main | `{ override: AgentModeOverride }` | 设置用户覆盖 |
| `agent:modeChanged` | main→req | `AgentModeStatus` | 模式变更事件推送 |
| `agent-config:list` | req→main | — | 列出所有智能体配置 |
| `agent-config:get` | req→main | `{ id }` | 获取单个智能体配置 |
| `agent-config:update` | req→main | `{ id, patch }` | 更新智能体配置 |
| `agent-config:toggle` | req→main | `{ id }` | 切换启用/禁用 |
| `agent-config:updateSkills` | req→main | `{ id, skills }` | 更新技能白名单 |
| `agent-config:changed` | main→req | `{ agentId, action }` | 配置变更事件推送 |

---

## 六、兼容性要求

- **非 Agent 模式完全兼容**：Agent 模式关闭时，所有现有功能（手动世界书编写、手动写作、普通对话）完全不受影响
- **系统预置智能体不可删除**：防止用户误操作导致功能不可用
- **现有 `useAgent` 字段平滑迁移**：升级后 `useAgent` 字段值被忽略（由 `agentModeOverride` + `supportsToolCalling` 自动计算），不报错
- **技能配置与现有 skillRegistry 兼容**：技能白名单通过 `skillFilter` 传入 `skillAvailability` 评估（复用 Task 14 已有的声明式可用性机制）

---

## ADDED Requirements

### Requirement: 智能体模式自动切换
系统 SHALL 根据当前活跃 AI 引擎的 `supportsToolCalling` 能力自动判定 Agent 模式状态，并在 logo 旁永久显示模式指示器。

#### Scenario: 模型支持工具调用时自动激活
- **WHEN** 用户切换到支持工具调用的模型（`supportsToolCalling === true`），且 `agentModeOverride === 'auto'`
- **THEN** Agent 模式自动激活（`active === true`）
- **AND** Header logo 旁显示绿色 "Agent" 徽标
- **AND** 左侧导航出现"智能体中心"菜单项
- **AND** 记录模式变更日志到 MemoryStore 审计表

#### Scenario: 模型不支持工具调用时自动关闭
- **WHEN** 用户切换到不支持工具调用的模型（`supportsToolCalling === false`），且 `agentModeOverride === 'auto'`
- **THEN** Agent 模式自动关闭（`active === false`）
- **AND** Header logo 旁显示灰色 "普通" 徽标
- **AND** 左侧导航隐藏"智能体中心"菜单项
- **AND** 记录模式变更日志

#### Scenario: 用户手动覆盖
- **WHEN** 用户在 AI 引擎设置中设置 `agentModeOverride` 为 `force-on` 或 `force-off`
- **THEN** Agent 模式状态由覆盖值决定，忽略模型能力
- **AND** `force-on` 时即使模型不支持工具调用也激活 Agent 模式（但实际运行时降级为文本协议）
- **AND** `force-off` 时即使模型支持工具调用也关闭 Agent 模式

#### Scenario: 模式状态永久可见
- **WHEN** 系统处于任何状态（Agent 模式激活或关闭）
- **THEN** Header logo 旁始终显示模式徽标（颜色和文字随状态变化）
- **AND** 鼠标悬停时 Tooltip 显示当前状态和原因

### Requirement: Agent 模式功能切换
系统 SHALL 提供统一的 Agent 模式门控入口，确保模式切换时预设功能自动切换运行模式，并保证数据一致性。

#### Scenario: 统一门控入口
- **WHEN** 任何功能模块需要判断 Agent 模式状态时
- **THEN** 统一调用 `agentModeService.isAgentModeActive()` 或前端 `useAgentMode()` hook
- **AND** 不再使用散落的 `useAgent && supportsToolCalling` 双条件守卫

#### Scenario: 预设功能自动切换
- **WHEN** Agent 模式从关闭切换到激活
- **THEN** 世界书编写智能体入口按钮自动显示
- **AND** 写作智能体入口按钮自动显示
- **AND** 对话模式自动切换为 AgentCore 路径

#### Scenario: 模式切换时数据一致性
- **WHEN** Agent 模式切换时
- **THEN** 正在运行的智能体任务通过 AbortController 优雅终止当前 turn
- **AND** 已生成的数据（如草稿区条目）保留不丢失
- **AND** 新发起的任务遵循新模式

### Requirement: 智能体管理中心
系统 SHALL 提供智能体管理中心 UI，仅在 Agent 模式激活时显示于左侧导航菜单，支持智能体列表展示与管理操作。

#### Scenario: 智能体中心菜单项条件显示
- **WHEN** Agent 模式激活
- **THEN** 左侧导航菜单显示"智能体中心"项（RobotOutlined 图标）
- **WHEN** Agent 模式关闭
- **THEN** 左侧导航菜单隐藏"智能体中心"项

#### Scenario: 智能体列表展示
- **WHEN** 用户进入智能体管理中心
- **THEN** 表格展示所有已注册智能体（系统预置 + 用户自定义）
- **AND** 每行显示：智能体名称（含 emoji 图标）、类型、状态（Switch）、技能数、创建时间、操作按钮

#### Scenario: 智能体启用/禁用
- **WHEN** 用户在列表中切换某智能体的状态 Switch
- **THEN** 该智能体的 `status` 字段更新并持久化到 SQLite
- **AND** 禁用的智能体在对应功能模块中不显示入口按钮
- **AND** 系统预置智能体不可删除但可禁用

#### Scenario: 技能配置
- **WHEN** 用户点击某智能体的"详情"按钮
- **THEN** 侧抽屉展示智能体详情，包含技能配置面板
- **AND** 技能面板展示当前智能体关联的所有技能（名称、描述、启用状态）
- **AND** 用户可通过 Switch 启用/禁用单个技能
- **AND** 用户可通过拖拽调整技能优先级顺序
- **AND** 技能配置变更后持久化到 SQLite 并实时生效

### Requirement: 智能体配置数据持久化
系统 SHALL 将所有智能体配置数据持久化到 SQLite，确保重启后配置不丢失。

#### Scenario: 配置持久化
- **WHEN** 用户创建、编辑或删除智能体配置
- **THEN** 变更立即写入 SQLite `agent_configs` 表
- **AND** 内存缓存同步更新
- **AND** 通过 `agent-config:changed` 事件通知所有渲染进程

#### Scenario: 系统重启后恢复
- **WHEN** 应用重启
- **THEN** 从 SQLite 加载所有智能体配置
- **AND** 系统预置智能体若不存在则自动创建（幂等）
- **AND** 用户自定义配置完整恢复

## MODIFIED Requirements

### Requirement: ChatEngine Agent 模式门控
**原实现**：`ChatEngine.ts:76-80` 使用 `config.useAgent === true && config.capabilities?.supportsToolCalling === true` 双条件守卫判定是否走 AgentCore 路径。

**修改后**：通过 `useAgentMode()` hook 获取 `isActive` 状态，传入 ChatEngineConfig，ChatEngine 根据 `isActive` 判定是否走 AgentCore 路径。`useAgent` 字段不再作为门控依据，改为 `agentModeOverride` + `supportsToolCalling` 自动计算的 `isActive` 快照。

### Requirement: WorldBookManager 智能体编写入口
**原实现**：`WorldBookManager.tsx:76-79` 使用 `activeEngine?.useAgent === true && supportsToolCalling === true` 判定"智能体编写"按钮显隐。

**修改后**：使用 `useAgentMode()` hook 获取 `isActive` 状态，替代原双条件守卫。

### Requirement: AI 引擎设置面板
**原实现**：`LLMEngineTab.tsx` / `AIEngineSettingsPanel.tsx` 仅展示能力徽章，无 `useAgent` 开关。

**修改后**：新增 `agentModeOverride` 三态选择器（auto / force-on / force-off），默认 `auto`。展示当前 Agent 模式状态（激活/关闭 + 原因）。

## REMOVED Requirements

### Requirement: useAgent 手动开关
**Reason**：`AIEngineSetting.useAgent` 手动开关被 `agentModeOverride` 三态开关 + 自动检测替代。`useAgent` 字段保留为只读快照（向后兼容），不再作为控制依据。
**Migration**：升级后 `useAgent` 值被忽略，系统自动根据 `agentModeOverride`（默认 `auto`）+ `supportsToolCalling` 计算 Agent 模式状态。
