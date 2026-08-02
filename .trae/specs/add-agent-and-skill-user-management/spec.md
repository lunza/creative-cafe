# 智能体与技能用户管理功能 Spec

> 本 Spec 为**功能型 Spec**，基于已完成的智能体管理中心（`add-agent-mode-management-and-center`）与技能广场（`fix-skill-system-and-add-marketplace`），为用户自定义智能体及技能补充手动创建、编辑和删除功能，并实现系统预置项目的保护机制。

## Why

当前智能体管理中心仅支持查看详情、启用/禁用和技能白名单配置，**缺少创建、编辑和删除自定义智能体的能力**——用户无法通过 UI 新建自己的智能体。技能广场仅支持从目录/URL 导入和卸载，**缺少直接创建和编辑技能的能力**——用户必须在外部编辑 SKILL.md 文件再导入。同时，系统预置的智能体和内置技能缺少明确的权限隔离，需要在 UI 层隐藏管理按钮以防误操作。

## What Changes

### A. 智能体 CRUD 补全

- **新增 `agent-config:create` IPC 通道**：调用已有的 `agentConfigService.create()` 方法创建用户自定义智能体
- **新增 `agent-config:delete` IPC 通道**：调用已有的 `agentConfigService.delete()` 方法删除用户自定义智能体（系统预置不可删除，后端已有保护）
- **扩展 `broadcastConfigChanged`**：支持 `'created'` 和 `'deleted'` action（`AgentConfigChangedEvent` 类型已定义这两种 action）
- **扩展 preload `agent.config` API**：新增 `create` 和 `delete` 方法
- **扩展 `useAgentConfigs` hook**：新增 `createAgent` 和 `deleteAgent` 方法
- **新增 `AgentFormModal` 组件**：模态表单，支持创建和编辑智能体
- **更新 `AgentList` 组件**：新增"创建智能体"按钮（列表上方）、行内"编辑"/"删除"按钮（仅非系统预置）
- **更新 `AgentCenter` 组件**：传递 create/edit/delete 回调，管理模态窗口状态

### B. 技能 CRUD 补全

- **新增 `createSkill` 和 `editSkill` 函数**（`skillLoader.ts`）：在工作区技能目录写入/更新 SKILL.md 文件
- **新增 `skill:create` 和 `skill:edit` IPC 通道**：调用上述函数
- **扩展 preload `skill` API**：新增 `create` 和 `edit` 方法
- **新增 `SkillFormModal` 组件**：模态表单，支持创建和编辑技能（字段：name、description、emoji、body）
- **更新 `SkillMarketplace` 组件**：新增"创建技能"按钮、行内"编辑"按钮（仅非内置技能）
- **复用已有 `skill:uninstall`**：作为删除操作，UI 文案改为"删除"（仅非内置技能显示）

### C. 权限控制

- **系统预置智能体**（`isSystem === true`）：隐藏"编辑"和"删除"按钮，仅显示"详情"按钮
- **用户自定义智能体**（`isSystem === false`）：显示完整按钮集（详情、编辑、删除）
- **内置技能**（`source === 'builtin'`）：隐藏"编辑"和"删除"按钮，仅显示"详情"按钮
- **非内置技能**（`source !== 'builtin'`）：显示完整按钮集（详情、编辑、删除）

### D. 交互设计

- **创建/编辑模态窗口**：使用 antd `Modal` + `Form` 组件，包含必要字段输入和实时验证
- **删除确认对话框**：使用 antd `Modal.confirm`，显示智能体/技能名称，防止误操作
- **操作反馈**：成功/失败后通过 antd `message` 显示提示

### E. 数据验证

- **智能体表单验证**：名称必填且不重复、描述必填、类型必选、模式必选
- **技能表单验证**：技能名必填（仅小写字母、数字、连字符）、描述必填、正文必填
- **技能名唯一性**：创建时检查工作区是否已存在同名技能
- **ID 不可编辑**：编辑时智能体 ID 和技能名均不可修改（只读展示）

## Impact

- **Affected specs**:
  - `add-agent-mode-management-and-center` — 扩展其智能体管理中心 UI 和 IPC 通道
  - `fix-skill-system-and-add-marketplace` — 扩展其技能广场 UI 和技能加载器
- **Affected code**:
  - 修改：`src/main/ipc/handlers/agentHandlers.ts`（新增 2 个 agent-config IPC + 2 个 skill IPC）
  - 修改：`src/main/preload.ts`（新增 4 个 API 方法桥接）
  - 修改：`src/renderer/types/electron.d.ts`（新增 4 个类型声明）
  - 修改：`src/shared/types/agent-center.types.ts`（新增 create/delete payload 类型）
  - 修改：`src/main/services/agent/skills/skillLoader.ts`（新增 createSkill/editSkill 函数）
  - 修改：`src/renderer/components/AgentCenter/hooks/useAgentConfigs.ts`（新增 create/delete）
  - 修改：`src/renderer/components/AgentCenter/AgentList.tsx`（新增按钮和权限控制）
  - 修改：`src/renderer/components/AgentCenter/AgentCenter.tsx`（传递回调和模态窗口管理）
  - 修改：`src/renderer/components/AgentCenter/SkillMarketplace.tsx`（新增按钮和权限控制）
  - 新增：`src/renderer/components/AgentCenter/AgentFormModal.tsx`（智能体创建/编辑表单）
  - 新增：`src/renderer/components/AgentCenter/SkillFormModal.tsx`（技能创建/编辑表单）

---

## 一、智能体 CRUD 后端补全

### 1.1 IPC 通道规范

| 通道 | 方向 | Payload | 用途 |
|------|------|---------|------|
| `agent-config:create` | req→main | `{ config: Omit<AgentConfig, 'id' \| 'createdAt' \| 'updatedAt' \| 'isSystem'> }` | 创建用户自定义智能体 |
| `agent-config:delete` | req→main | `{ id: string }` | 删除用户自定义智能体 |

### 1.2 创建通道逻辑

- 调用 `agentConfigService.create()`，传入用户填写的配置（`isSystem` 强制为 `false`）
- 成功后调用 `broadcastConfigChanged(newConfig.id, 'created')` 通知所有渲染进程
- 返回 `{ ok: true, config: newConfig }`

### 1.3 删除通道逻辑

- 调用 `agentConfigService.delete()`（后端已有系统预置保护：`isSystem === true` 抛错）
- 成功后调用 `broadcastConfigChanged(id, 'deleted')` 通知所有渲染进程
- 返回 `{ ok: true }` 或 `{ ok: false, error: message }`

### 1.4 Preload 扩展

在 `preload.ts` 的 `agent.config` 命名空间新增：
```typescript
create: (config: any) => ipcRenderer.invoke('agent-config:create', { config }),
delete: (id: string) => ipcRenderer.invoke('agent-config:delete', { id }),
```

---

## 二、技能 CRUD 后端补全

### 2.1 SKILL.md 写入函数

在 `skillLoader.ts` 新增：

```typescript
/** 创建工作区技能（写入 SKILL.md） */
async function createSkill(params: {
  name: string;         // 技能名（作为目录名，仅小写字母/数字/连字符）
  description: string;  // 技能描述
  emoji?: string;       // emoji 图标
  body: string;         // SKILL.md 正文（markdown）
}): Promise<SkillEntry | null>

/** 编辑工作区技能（更新 SKILL.md） */
async function editSkill(params: {
  name: string;         // 技能名（不可修改，定位目录）
  description: string;
  emoji?: string;
  body: string;
}): Promise<SkillEntry | null>
```

**实现逻辑**：
- `createSkill`：在 `<userDataPath>/skills/<name>/` 目录下创建 SKILL.md，内容由 frontmatter + body 组装
- `editSkill`：读取已有 SKILL.md，解析后保留 frontmatter 中的高级字段，更新 description/emoji/body，写回文件
- 内置技能不可编辑（检查 `source === 'builtin'`，拒绝操作）
- 创建时检查目录是否已存在（唯一性校验）

### 2.2 SKILL.md 组装格式

```markdown
---
name: <技能名>
description: "<描述>"
emoji: <emoji>
user-invocable: true
disable-model-invocation: false
---
<正文内容>
```

### 2.3 IPC 通道规范

| 通道 | 方向 | Payload | 用途 |
|------|------|---------|------|
| `skill:create` | req→main | `{ name, description, emoji?, body }` | 创建工作区技能 |
| `skill:edit` | req→main | `{ name, description, emoji?, body }` | 编辑工作区技能 |

### 2.4 Preload 扩展

在 `preload.ts` 的 `skill` 命名空间新增：
```typescript
create: (params: { name: string; description: string; emoji?: string; body: string }) =>
  ipcRenderer.invoke('skill:create', params),
edit: (params: { name: string; description: string; emoji?: string; body: string }) =>
  ipcRenderer.invoke('skill:edit', params),
```

---

## 三、智能体表单组件

### 3.1 AgentFormModal

**组件职责**：
- 以 antd `Modal` + `Form` 呈现创建/编辑表单
- 创建模式：所有字段可编辑（ID 自动生成）
- 编辑模式：ID 只读展示，其余字段可编辑
- 提交时调用 `createAgent` 或 `updateConfig` 回调

**表单字段**：

| 字段 | 类型 | 必填 | 验证规则 | 说明 |
|------|------|------|----------|------|
| name | Input | 是 | 1-50 字符，不与现有智能体重名 | 显示名称 |
| description | TextArea | 是 | 1-200 字符 | 人类可读描述 |
| type | Select | 是 | dialogue/writing/worldbook/game/custom | 智能体类型 |
| mode | Select | 是 | dialogue/writing/game/worldbook | 运行模式 |
| emoji | Input | 否 | 单个 emoji 字符 | 图标（默认 🤖） |

**Props**：
```typescript
interface AgentFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  agent?: AgentConfig | null;      // 编辑时传入
  existingNames: string[];          // 用于重名校验
  onCreate?: (config: CreateAgentPayload) => Promise<void>;
  onUpdate?: (id: string, patch: Partial<AgentConfig>) => Promise<void>;
  onClose: () => void;
}
```

---

## 四、技能表单组件

### 4.1 SkillFormModal

**组件职责**：
- 以 antd `Modal` + `Form` 呈现创建/编辑表单
- 创建模式：所有字段可编辑
- 编辑模式：技能名只读展示，其余字段可编辑
- 提交时调用 `onCreate` 或 `onEdit` 回调

**表单字段**：

| 字段 | 类型 | 必填 | 验证规则 | 说明 |
|------|------|------|----------|------|
| name | Input | 是 | 仅小写字母/数字/连字符，不与现有技能重名（创建时） | 技能唯一标识 |
| description | TextArea | 是 | 1-500 字符 | 技能描述（模型可见） |
| emoji | Input | 否 | 单个 emoji 字符 | 图标 |
| body | TextArea | 是 | 1-10000 字符 | SKILL.md 正文（markdown） |

**Props**：
```typescript
interface SkillFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  skill?: { name: string; description: string; emoji?: string; body: string } | null;
  existingNames: string[];          // 用于重名校验
  onCreate: (params: SkillFormData) => Promise<void>;
  onEdit: (params: SkillFormData) => Promise<void>;
  onClose: () => void;
}
```

---

## 五、UI 更新与权限控制

### 5.1 AgentList 更新

- **列表上方**新增"创建智能体"按钮（`Button type="primary" icon={<PlusOutlined />}`）
- **操作列**按权限渲染：
  - 系统预置（`isSystem === true`）：仅"详情"按钮
  - 用户自定义（`isSystem === false`）："详情" + "编辑" + "删除"按钮
- **删除确认**：`Modal.confirm`，标题"确认删除智能体"，内容包含智能体名称

### 5.2 SkillMarketplace 更新

- **工具栏**新增"创建技能"按钮（`Button type="primary" icon={<PlusOutlined />}`）
- **操作列**按权限渲染：
  - 内置技能（`source === 'builtin'`）：仅"详情"按钮
  - 非内置技能（`source !== 'builtin'`）："详情" + "编辑" + "删除"按钮
- **删除确认**：复用已有 `Modal.confirm` 逻辑，文案改为"删除"

### 5.3 界面一致性

- 按钮样式与现有"详情"按钮保持一致（`type="link" size="small"`）
- "创建"按钮使用 `type="primary"` 突出显示
- 模态窗口宽度统一为 520px（antd Modal 默认宽度）
- 响应式：小屏幕下操作列按钮换行显示

---

## ADDED Requirements

### Requirement: 智能体创建
系统 SHALL 提供创建用户自定义智能体的功能，用户通过模态表单填写智能体配置，提交后持久化到 SQLite。

#### Scenario: 创建自定义智能体
- **WHEN** 用户点击"创建智能体"按钮
- **THEN** 弹出模态表单，包含名称、描述、类型、模式、emoji 字段
- **AND** 用户填写表单并提交
- **THEN** 系统创建智能体配置（`isSystem: false`），持久化到 SQLite
- **AND** 列表自动刷新，新智能体出现在列表中
- **AND** 显示成功提示"智能体创建成功"

#### Scenario: 创建时重名校验
- **WHEN** 用户输入的名称与现有智能体名称重复
- **THEN** 表单显示验证错误"名称已存在，请使用其他名称"
- **AND** 阻止提交

### Requirement: 智能体编辑
系统 SHALL 提供编辑用户自定义智能体的功能，系统预置智能体不可编辑。

#### Scenario: 编辑自定义智能体
- **WHEN** 用户点击自定义智能体的"编辑"按钮
- **THEN** 弹出模态表单，预填当前智能体配置
- **AND** ID 字段只读展示
- **AND** 用户修改字段并提交
- **THEN** 系统更新智能体配置，持久化到 SQLite
- **AND** 列表自动刷新，显示更新后的信息
- **AND** 显示成功提示"智能体更新成功"

#### Scenario: 系统预置智能体不可编辑
- **WHEN** 智能体 `isSystem === true`
- **THEN** 操作列不显示"编辑"按钮
- **AND** 仅显示"详情"按钮

### Requirement: 智能体删除
系统 SHALL 提供删除用户自定义智能体的功能，系统预置智能体不可删除，删除前需确认。

#### Scenario: 删除自定义智能体
- **WHEN** 用户点击自定义智能体的"删除"按钮
- **THEN** 弹出确认对话框，显示"确认删除智能体「<名称>」？此操作不可恢复。"
- **AND** 用户点击确认
- **THEN** 系统删除智能体配置，从 SQLite 移除
- **AND** 列表自动刷新，该智能体从列表中消失
- **AND** 显示成功提示"智能体已删除"

#### Scenario: 系统预置智能体不可删除
- **WHEN** 智能体 `isSystem === true`
- **THEN** 操作列不显示"删除"按钮

#### Scenario: 删除取消
- **WHEN** 用户在确认对话框中点击"取消"
- **THEN** 对话框关闭，不执行删除操作

### Requirement: 技能创建
系统 SHALL 提供创建工作区技能的功能，用户通过模态表单填写技能信息，提交后在工作区目录创建 SKILL.md 文件。

#### Scenario: 创建自定义技能
- **WHEN** 用户点击"创建技能"按钮
- **THEN** 弹出模态表单，包含技能名、描述、emoji、正文字段
- **AND** 用户填写表单并提交
- **THEN** 系统在 `<userDataPath>/skills/<name>/SKILL.md` 创建技能文件
- **AND** 技能列表自动刷新，新技能出现在列表中
- **AND** 显示成功提示"技能创建成功"

#### Scenario: 技能名格式验证
- **WHEN** 用户输入的技能名包含非小写字母/数字/连字符字符
- **THEN** 表单显示验证错误"技能名仅支持小写字母、数字和连字符"
- **AND** 阻止提交

#### Scenario: 技能名唯一性校验
- **WHEN** 用户输入的技能名与已安装技能重名
- **THEN** 表单显示验证错误"技能名已存在"
- **AND** 阻止提交

### Requirement: 技能编辑
系统 SHALL 提供编辑非内置技能的功能，内置技能不可编辑。

#### Scenario: 编辑工作区技能
- **WHEN** 用户点击非内置技能的"编辑"按钮
- **THEN** 弹出模态表单，预填当前技能信息（从 SKILL.md 解析）
- **AND** 技能名字段只读展示
- **AND** 用户修改描述/emoji/正文并提交
- **THEN** 系统更新 SKILL.md 文件
- **AND** 技能列表自动刷新
- **AND** 显示成功提示"技能更新成功"

#### Scenario: 内置技能不可编辑
- **WHEN** 技能 `source === 'builtin'`
- **THEN** 操作列不显示"编辑"按钮
- **AND** 仅显示"详情"按钮

### Requirement: 技能删除
系统 SHALL 提供删除非内置技能的功能，内置技能不可删除，删除前需确认。

#### Scenario: 删除工作区技能
- **WHEN** 用户点击非内置技能的"删除"按钮
- **THEN** 弹出确认对话框，显示"确认删除技能「<名称>」？此操作不可恢复。"
- **AND** 用户点击确认
- **THEN** 系统删除技能目录，从列表中移除
- **AND** 显示成功提示"技能已删除"

#### Scenario: 内置技能不可删除
- **WHEN** 技能 `source === 'builtin'`
- **THEN** 操作列不显示"删除"按钮

## MODIFIED Requirements

### Requirement: AgentList 操作列
**原实现**：操作列仅包含"详情"按钮，所有智能体操作相同。

**修改后**：操作列按权限渲染——系统预置智能体仅显示"详情"按钮；用户自定义智能体显示"详情"+"编辑"+"删除"按钮。列表上方新增"创建智能体"按钮。

### Requirement: SkillMarketplace 操作列
**原实现**：操作列包含"详情"按钮和"卸载"按钮（仅非内置技能），工具栏有"从目录导入"和"从 URL 导入"按钮。

**修改后**：操作列按权限渲染——内置技能仅显示"详情"按钮；非内置技能显示"详情"+"编辑"+"删除"按钮（原"卸载"改名为"删除"）。工具栏新增"创建技能"按钮。

### Requirement: broadcastConfigChanged
**原实现**：仅支持 `'updated' | 'toggled' | 'skills-updated'` 三种 action。

**修改后**：新增 `'created'` 和 `'deleted'` 两种 action，在创建和删除操作成功后广播。

### Requirement: useAgentConfigs hook
**原实现**：暴露 `toggleStatus`、`updateConfig`、`updateSkills` 方法。

**修改后**：新增 `createAgent` 和 `deleteAgent` 方法，分别调用 `agent-config:create` 和 `agent-config:delete` IPC 通道。
