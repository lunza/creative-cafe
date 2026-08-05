# Code Wiki

> 本文件记录项目核心架构与功能模块的技术文档。
> 注意：原文件内容因磁盘异常全部丢失（全为 null 字节），本文件由 2026-08-01 的 spec `add-agent-and-skill-user-management` 重建，仅包含本次新增功能的文档。历史章节请参考 git 历史记录。

---

## 智能体与技能用户管理（Spec: add-agent-and-skill-user-management）

### 概述

为智能体中心和技能广场补全用户自定义智能体及技能的手动创建、编辑和删除功能。系统预置智能体（`isSystem === true`）和内置技能（`source === 'builtin'`）仅提供查看功能，隐藏管理按钮；用户自定义项目显示完整的管理按钮集。

### 架构分层

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  AgentCenter.tsx                                    │
│   ├─ AgentList.tsx (创建按钮 + 操作列权限渲染)       │
│   ├─ AgentFormModal.tsx (创建/编辑模态表单)          │
│   ├─ AgentDetail.tsx (详情抽屉)                      │
│   └─ SkillMarketplace.tsx (创建/编辑/删除按钮)       │
│       └─ SkillFormModal.tsx (创建/编辑模态表单)      │
│                                                     │
│  hooks/useAgentConfigs.ts (createAgent/deleteAgent) │
├─────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                      │
│  agent.config.create / agent.config.delete          │
│  skill.create / skill.edit                          │
├─────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                         │
│  agent-config:create  → agentConfigService.create() │
│  agent-config:delete  → agentConfigService.delete() │
│  skill:create         → createSkill()               │
│  skill:edit           → editSkill()                 │
├─────────────────────────────────────────────────────┤
│ Service Layer                                        │
│  agentConfigService (SQLite + 内存缓存)              │
│  skillLoader.createSkill() / editSkill()            │
│    └─ assembleSkillMd() (frontmatter + body 组装)    │
└─────────────────────────────────────────────────────┘
```

### 智能体 CRUD

#### 后端 IPC 通道

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `agent-config:create` | `{ config: Omit<AgentConfig, 'id'\|'createdAt'\|'updatedAt'\|'isSystem'> }` | `{ ok, config?, error? }` | 创建用户自定义智能体，强制 `isSystem: false` |
| `agent-config:delete` | `{ id: string }` | `{ ok, error? }` | 删除智能体（系统预置保护由 `agentConfigService.delete()` 保证） |

创建成功后通过 `broadcastConfigChanged(id, 'created')` 广播变更事件，删除成功后广播 `broadcastConfigChanged(id, 'deleted')`。

#### 前端 Hook

`useAgentConfigs.ts` 新增两个方法：

- `createAgent(config)` — 调用 `agent.config.create()` IPC，成功后 `setConfigs(prev => [...prev, result.config])` 追加到列表
- `deleteAgent(id)` — 调用 `agent.config.delete()` IPC，成功后 `setConfigs(prev => prev.filter(c => c.id !== id))` 从列表移除

#### 前端组件

**AgentFormModal.tsx** — 智能体创建/编辑模态表单

- 支持 `create` 和 `edit` 两种模式
- 表单字段：`name`（必填，1-50 字符，重名校验）、`description`（必填，1-200 字符）、`type`（5 选项 Select）、`mode`（4 选项 Select）、`emoji`（可选，默认 🤖）
- 编辑模式下 ID 通过 `agent` prop 传入，不作为表单字段
- 提交时 loading 状态，消息提示由父组件 `AgentCenter.tsx` 处理

**AgentList.tsx** — 智能体列表

- 列表上方新增"创建智能体"按钮（`PlusOutlined` 图标，`type="primary"`）
- 操作列按权限渲染：系统预置（`isSystem === true`）仅显示"详情"按钮；用户自定义显示"详情"+"编辑"+"删除"
- 删除操作使用 `Modal.confirm`，显示智能体名称，`okType="danger"`

**AgentCenter.tsx** — 主页面

- 管理 `AgentFormModal` 状态（`formOpen`、`formMode`、`editingAgent`）
- 5 个处理函数：`handleCreate`、`handleEdit`、`handleDelete`、`handleFormCreate`、`handleFormUpdate`
- 操作成功/失败均通过 `message.success/error` 提示

### 技能 CRUD

#### 后端函数

`skillLoader.ts` 新增：

- `SkillFormData` 接口 — `{ name, description, emoji?, body }`
- `assembleSkillMd(params)` — 内部函数，组装 SKILL.md 内容（YAML frontmatter + markdown body）
- `createSkill(params)` — 校验技能名格式（`^[a-z0-9-]+$`）、检查目录唯一性、写入 `<userDataPath>/skills/<name>/SKILL.md`
- `editSkill(params)` — 校验非内置技能、覆盖写入已有 SKILL.md

#### IPC 通道

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `skill:create` | `{ name, description, emoji?, body }` | `{ success, skillName?, error? }` | 创建工作区技能 |
| `skill:edit` | `{ name, description, emoji?, body }` | `{ success, skillName?, error? }` | 编辑工作区技能（内置技能拒绝编辑） |

#### 前端组件

**SkillFormModal.tsx** — 技能创建/编辑模态表单

- 支持 `create` 和 `edit` 两种模式
- 表单字段：`name`（必填，仅小写字母/数字/连字符，创建时可编辑、编辑时 `disabled`）、`description`（必填，1-500 字符）、`emoji`（可选）、`body`（必填，1-10000 字符）
- 创建模式下技能名唯一性校验
- 消息提示由父组件 `SkillMarketplace.tsx` 处理

**SkillMarketplace.tsx** — 技能广场

- 工具栏新增"创建技能"按钮（`PlusOutlined` 图标，`type="primary"`）
- 操作列按权限渲染：内置技能（`source === 'builtin'`）仅显示"详情"按钮；非内置显示"详情"+"编辑"+"删除"
- 原"卸载"按钮文案改为"删除"，保持 `Modal.confirm` 确认逻辑
- 编辑操作先调用 `skill.getDetail()` 获取完整 SKILL.md 内容填充表单

### 权限控制机制

| 项目类型 | 判定字段 | 系统预置/内置 | 用户自定义 |
|---|---|---|---|
| 智能体 | `isSystem` | `true` → 仅"详情" | `false` → "详情"+"编辑"+"删除" |
| 技能 | `source` | `'builtin'` → 仅"详情" | 非 `'builtin'` → "详情"+"编辑"+"删除" |

详情只读保护（系统智能体）：

当 `agent.isSystem === true` 时，`AgentDetail.tsx` 向 `SkillConfigPanel` 传入 `readOnly={true}` prop，实现详情视图的只读保护：

- `SkillConfigPanel` 顶部显示 antd `Alert`（type="info"）提示"系统智能体配置为只读"
- 所有 `Switch`（技能启用/禁用开关）设置 `disabled={readOnly}`
- 上/下移动 `Button` 设置 `disabled={readOnly || 原始条件}`，readOnly 优先禁用
- `readOnly` 为可选 prop（默认 undefined），不影响非系统智能体的编辑功能

后端双重保护：
- `agent-config:create` 强制设置 `isSystem: false`，防止前端伪造系统预置智能体
- `agentConfigService.delete()` 内部拒绝删除系统预置智能体
- `editSkill()` 内部拒绝编辑内置技能

### 涉及文件清单

**新增文件：**
- `src/renderer/components/AgentCenter/AgentFormModal.tsx`
- `src/renderer/components/AgentCenter/SkillFormModal.tsx`

**修改文件：**
- `src/shared/types/agent-center.types.ts` — 新增 create/delete payload 类型
- `src/main/ipc/handlers/agentHandlers.ts` — 新增 4 个 IPC handler
- `src/main/services/agent/skills/skillLoader.ts` — 新增 `createSkill()` / `editSkill()` / `assembleSkillMd()` / `SkillFormData`
- `src/main/services/agent/management/agentConfigTypes.ts` — re-export 新增类型
- `src/main/preload.ts` — 新增 4 个桥接方法
- `src/renderer/types/electron.d.ts` — 新增 4 个方法类型声明
- `src/renderer/components/AgentCenter/hooks/useAgentConfigs.ts` — 新增 `createAgent` / `deleteAgent`
- `src/renderer/components/AgentCenter/AgentList.tsx` — 新增创建按钮 + 权限渲染
- `src/renderer/components/AgentCenter/AgentCenter.tsx` — 集成 AgentFormModal
- `src/renderer/components/AgentCenter/SkillMarketplace.tsx` — 新增创建/编辑/删除功能

---

## ⚠️ Bug 修复：世界书编写智能体 sessionId 时序问题（2026-08-01）

### 问题描述

`worldbookAgent:run` IPC 是阻塞调用，sessionId 仅在调用返回时才设置到 React state。但澄清问题（`planning_clarifying`）在运行期间通过 progress 事件到达，此时 `state.sessionId` 仍为 `null`，导致用户提交回答时报错"无活跃会话，无法提交回答"。

### 根因

- 主进程 `worldbookAuthoringService.emitProgress()` 构造的 `AuthoringProgressEvent` 未携带 `sessionId`
- `waitForClarifyAnswers()` 中的 `extendedEvent`（携带 clarifyingQuestions 的关键事件）也直接调用 `session.onProgress` 绕过了 `emitProgress`，同样未携带 `sessionId`
- 渲染进程 `handleProgressEvent` 回调未从 progress 事件中提取 `sessionId`，仅依赖 `run` 返回值

### 修复方案

通过 progress 事件携带 `sessionId`，让渲染进程在阻塞调用期间提前建立 sessionId 映射：

1. **`src/shared/types/worldbook-authoring.types.ts`** — `AuthoringProgressEvent` 接口新增可选字段 `sessionId?: string`（向后兼容）
2. **`src/main/services/agent/worldbook/worldbookAuthoringService.ts`** — `emitProgress()` 方法在构造 `fullEvent` 时自动附带 `sessionId: session.id`；`waitForClarifyAnswers()` 中的 `extendedEvent` 同样添加 `sessionId: session.id`
3. **`src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts`** — `handleProgressEvent` 回调的 setState 中添加 `sessionId: event.sessionId ?? prev.sessionId`

### 涉及文件

- `src/shared/types/worldbook-authoring.types.ts`
- `src/main/services/agent/worldbook/worldbookAuthoringService.ts`
- `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts`

---

## 世界书编写智能体思考步骤可视化（thoughtStep 事件处理）

### 概述

`AuthoringProgressEvent` 新增可选字段 `thoughtStep?: ThoughtStep`，用于在进度事件中携带 AI 的微观思考步骤（LLM 调用目的、输入输出摘要、耗时等）。渲染进程 `useWorldBookAuthoring` hook 订阅该字段并维护思考时间线，供 UI 展示从初始构思到最终输出的演变轨迹。

### `ThoughtStep` 类型（`src/shared/types/worldbook-authoring.types.ts`）

```typescript
export interface ThoughtStep {
  type: 'llm_call' | 'parse' | 'decision' | 'tool_call';
  purpose: string;
  inputSummary?: string;
  outputSummary?: string;
  durationMs: number;
  success: boolean;
  phase?: AuthoringProgressEvent['phase'];
  timestamp: number;
}
```

### Hook 改动（`src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts`）

1. **导入** — 从 `worldbook-authoring.types` 导入 `ThoughtStep` 类型
2. **State 接口** — `WorldBookAuthoringState` 新增 `thoughtSteps: ThoughtStep[]` 字段
3. **常量** — 新增 `MAX_THOUGHT_STEPS = 100`（思考步骤缓存上限，避免长编排无限增长）
4. **初始 state** — `thoughtSteps: []`
5. **`handleProgressEvent`** — 当 `event.thoughtStep` 存在时追加到 `thoughtSteps` 数组；超过 100 条时丢弃最旧的（`slice(length - 100)`）；不修改现有事件处理逻辑
6. **`reset()`** — 清空 `thoughtSteps: []`

### 涉及文件

- `src/shared/types/worldbook-authoring.types.ts` — `AuthoringProgressEvent.thoughtStep` 字段与 `ThoughtStep` 接口定义
- `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts` — 思考步骤状态管理与事件处理

---

## 世界书编写智能体进度事件填充 generatedEntries 与 auditDetail（2026-08-02）

### 概述

`AuthoringProgressEvent` 接口新增两个可选字段 `generatedEntries` 和 `auditDetail`，用于在进度事件中携带最近生成的条目列表和审计结果摘要，供前端进度面板展示实际生成内容与审计过程。本次在 `worldbookAuthoringService.ts` 的三个关键 `emitProgress` 调用点填充这两个字段。

### 修改点

1. **条目生成完成（`runAuthoringDimension`，单个条目创建成功后）** — 填充 `generatedEntries`，取当前批次 `drafts` 前 5 条，`content` 截断到 200 字符。
2. **微型审计完成（`runMiniAudit`）** — 填充 `auditDetail`（`type: 'mini'`），包含维度名、完整性问题数、一致性问题数，以及最多 5 条 error/critical 级别的一致性问题详情（`entryIds` 转为 `string[]`）。
3. **完整审计完成（`runAuditing`）** — 填充 `auditDetail`（`type: 'full'`），包含综合通过状态与分数、三维度（完整性/一致性/符合度）摘要字符串、已自动修复数、最多 5 条需用户决策项。

### 注意事项

- **维度完成后的 `emitProgress`（`runAuthoringDimension` 维度完成判定块）未填充 `generatedEntries`**：`drafts` 变量在 while 循环内声明，维度完成时已超出作用域，故跳过此修改点。
- `ConsistencyIssue.entryIds` 类型为 `Array<number | string>`，映射到 `auditDetail.issues[].entryIds` 时使用 `.map(String)` 转为 `string[]` 以匹配类型定义。
- `AuditUserDecision.severity` 类型为 `AuditSeverity`（联合类型），映射到 `auditDetail.userDecisions[].severity` 时使用 `String(d.severity)` 转为 `string`。

### 涉及文件

- `src/shared/types/worldbook-authoring.types.ts` — `AuthoringProgressEvent.generatedEntries` 与 `auditDetail` 字段定义
- `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — 三个 `emitProgress` 调用点填充新字段

---

## 智能体对话功能（Spec: add-agent-mode-management-and-center）

### 概述

为智能体管理中心新增"对话"功能，用户可直接从智能体列表中打开对话 Modal，与选定的智能体进行实时流式对话。

### 架构分层

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  AgentCenter.tsx                                    │
│   ├─ AgentList.tsx (操作列新增"对话"按钮)            │
│   └─ AgentDialogueModal.tsx (对话模态窗口)           │
│       └─ hooks/useAgentDialogue.ts (消息/流式管理)    │
├─────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                      │
│  agent.run / agent.cancel / agent.onToken / onDone  │
├─────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                         │
│  agent:run → 流式调用智能体执行引擎                   │
└─────────────────────────────────────────────────────┘
```

### 前端组件

**AgentList.tsx** — 智能体列表

- 操作列新增"对话"按钮（`MessageOutlined` 图标，`type="link" size="small"`），位于操作列第一个位置
- "对话"按钮对所有智能体显示（不区分 `isSystem`）
- Props 接口新增 `onChat: (agent: AgentConfig) => void` 回调
- 点击"对话"按钮时调用 `onChat(record)`

**AgentDialogueModal.tsx** — 智能体对话模态窗口（新增文件）

- Props：`open: boolean`、`agent: AgentConfig | null`、`onClose: () => void`
- 通过 `useAgentDialogue` hook 管理消息列表与流式状态
- 始终调用 hook，传入 `agent ?? FALLBACK_AGENT`（满足 React hooks 不可条件调用约束）
- Modal：width=720、footer=null、destroyOnClose=true
- 消息列表：固定高度 400px，用户消息右对齐（#e6f7ff）、助手消息左对齐（#f5f5f5），支持自动滚动
- 流式光标：assistant 消息 streaming=true 时末尾显示 CSS 闪烁光标动画（`@keyframes agentDialogueBlink`）
- 输入区域：TextArea（autoSize 1-4 行）+ 发送/停止按钮，Enter 发送 / Shift+Enter 换行
- 斜杠命令补全：输入 `/` 前缀时展示全部已注册命令（系统指令 + 内置命令），通过 `SlashCommandAutoComplete` 浮层补全
- 空状态：显示智能体 emoji + name + description + "输入消息开始对话"提示
- 关闭清理：`afterClose` 回调调用 `hook.reset()`（agent 为 null 时不调用）

**AgentCenter.tsx** — 主页面

- 新增 `useCallback` 导入
- 新增状态：`dialogueOpen`、`chattingAgent`
- 新增处理函数：`handleChat`（打开对话）、`handleCloseDialogue`（关闭对话）
- 向 `AgentList` 传入 `onChat={handleChat}` 回调
- 在 JSX 末尾渲染 `AgentDialogueModal`

### 涉及文件清单

**新增文件：**
- `src/renderer/components/AgentCenter/AgentDialogueModal.tsx`

**修改文件：**
- `src/renderer/components/AgentCenter/AgentList.tsx` — 新增"对话"按钮 + `onChat` 回调
- `src/renderer/components/AgentCenter/AgentCenter.tsx` — 集成 `AgentDialogueModal`

---

## 斜杠命令系统与快捷操作菜单（Common 公共组件）

### 概述

为聊天输入区域新增两套公共组件：斜杠命令系统（SlashCommand）和快捷操作菜单（QuickActions）。斜杠命令系统允许用户在输入框中输入 `/` 前缀触发命令补全与执行；快捷操作菜单提供分组式下拉菜单，聚合对话、内容、设置三类操作入口。

### 斜杠命令系统（SlashCommand）

#### 架构

```
┌──────────────────────────────────────────────────────┐
│ SlashCommandRegistry.ts                              │
│  ├─ SlashCommand 接口（name/description/handler等）  │
│  ├─ SlashCommandContext（输入框上下文）              │
│  ├─ ArgSuggestions（静态/动态参数建议）              │
│  └─ slashCommandRegistry 单例                        │
│      ├─ register / unregister                        │
│      ├─ get / getAll（去重）                          │
│      └─ search（模糊搜索）                            │
├──────────────────────────────────────────────────────┤
│ builtinCommands.ts                                   │
│  ├─ SlashCommandCallbacks（回调注入接口）            │
│  ├─ setSlashCommandCallbacks()（由 ChatInputBar 调用）│
│  └─ registerBuiltinCommands()（注册 8 个内置命令）    │
│      help / reset / retry / continue / polish /      │
│      ai-reply / model / clear                        │
├──────────────────────────────────────────────────────┤
│ systemCommands.ts                                    │
│  ├─ SystemCommandCallbacks（回调注入接口）           │
│  ├─ setSystemCommandCallbacks()（由 useAgentDialogue │
│  │  注入）                                           │
│  ├─ registerSystemCommands()（注册 5 个系统指令）    │
│  │  世界书 / 角色卡 / 编写 / 审核 / 帮助             │
│  ├─ getSystemCommandNames()（指令名列表）            │
│  ├─ isSystemCommand()（匹配判断）                    │
│  └─ parseSystemCommand()（解析指令名+参数）          │
├──────────────────────────────────────────────────────┤
│ SlashCommandAutoComplete.tsx                         │
│  ├─ 浮层定位在输入框上方                              │
│  ├─ 键盘导航（↑↓ Enter ESC）                         │
│  ├─ 鼠标悬停高亮 + 选中项滚动到可见区域               │
│  └─ query 文本高亮匹配                               │
└──────────────────────────────────────────────────────┘
```

#### 内置命令清单

| 命令 | 别名 | 说明 | 需确认 |
|------|------|------|--------|
| `/help` | - | 显示可用命令列表 | 否 |
| `/reset` | - | 重置当前对话（清空所有消息） | 是 |
| `/retry` | - | 重新生成上一条 AI 回复 | 否 |
| `/continue` | - | 继续生成上一条 AI 回复 | 否 |
| `/polish` | - | 润色当前输入框文本 | 否 |
| `/ai-reply` | `/ai`, `/reply` | 以当前用户人设生成对话回复 | 否 |
| `/model` | - | 切换 AI 模型（动态参数建议） | 否 |
| `/clear` | - | 清空当前对话 | 是 |

#### 系统指令清单（systemCommands.ts）

系统指令使用中文名称，与 `builtinCommands.ts` 中的英文内置指令互补，面向 Agent 对话场景（由 `AgentDialogueModal` / `useAgentDialogue` 注入回调）。指令的实际执行与结果展示由 `useAgentDialogue.ts` 的 `sendMessage` 逻辑统一管理，`systemCommands.ts` 仅负责指令注册与名称管理。

| 指令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/世界书` | - | - | 列出系统中所有世界书 |
| `/角色卡` | - | - | 列出系统中所有角色卡 |
| `/编写` | - | `<世界书名称>` | 启动指定世界书的编写流程 |
| `/审核` | - | `<世界书名称>` | 启动指定世界书的审核流程 |
| `/帮助` | `help` | - | 显示所有可用系统指令 |

辅助函数：

- `getSystemCommandNames()` — 返回所有系统指令名列表（不含 `/` 前缀）
- `isSystemCommand(content)` — 判断消息内容是否匹配系统指令
- `parseSystemCommand(content)` — 解析系统指令，返回 `{ name, args }`

#### 回调注入机制

`builtinCommands.ts` 中的 `setSlashCommandCallbacks()` 接收一个 `SlashCommandCallbacks` 对象，由 ChatInputBar 在挂载时注入实际实现。命令 handler 通过 `callbacksRef` 间接调用，实现命令定义与业务逻辑的解耦。

`systemCommands.ts` 采用相同的回调注入模式：`setSystemCommandCallbacks()` 接收一个 `SystemCommandCallbacks` 对象，由 `AgentDialogueModal` / `useAgentDialogue` 注入实际实现。每个回调返回 `Promise<string>`，结果以 assistant 消息形式展示在对话流中。注意：handler 内部仅触发回调，不处理返回值——指令执行与结果展示由 `useAgentDialogue.ts` 的 `sendMessage` 逻辑统一管理。

#### 深色主题样式

浮层使用 `rgba(30, 30, 46, 0.95)` 半透明深色背景 + `backdrop-filter: blur(10px)` 毛玻璃效果，选中项高亮 `rgba(99, 102, 241, 0.2)`，命令名紫色 `#8b5cf6`，描述灰色 `#94a3b8`，与 ChatInputBar 现有风格一致。

### 快捷操作菜单（QuickActions）

#### 组件结构

`QuickActionsMenu.tsx` 使用 antd `Dropdown` + `Button` + `Tooltip` 实现：

- **触发按钮**：44px 圆形渐变按钮（`linear-gradient(135deg, #f59e0b 0%, #f97316 100%)`），与 ChatInputBar 其他操作按钮（Send/AI回复/润色）尺寸和布局一致
- **菜单分组**：三组操作（`dialogueActions` / `contentActions` / `settingActions`），组间用 `{ type: 'divider' }` 分隔
- **菜单项**：每项显示 label + shortcut（右侧灰色文字），支持 icon、disabled 状态
- **Tooltip**：悬停提示"快捷操作"
- **禁用态**：按钮半透明（`opacity: 0.5`）

### 涉及文件清单

**新增文件：**
- `src/renderer/components/Common/SlashCommand/SlashCommandRegistry.ts` — 命令注册中心（类型定义 + 单例）
- `src/renderer/components/Common/SlashCommand/SlashCommandAutoComplete.tsx` — 自动补全浮层组件
- `src/renderer/components/Common/SlashCommand/builtinCommands.ts` — 8 个内置命令注册 + 回调注入
- `src/renderer/components/Common/SlashCommand/systemCommands.ts` — 5 个中文系统指令注册 + 回调注入 + 指令解析辅助函数
- `src/renderer/components/Common/SlashCommand/index.ts` — 统一导出
- `src/renderer/components/Common/QuickActions/QuickActionsMenu.tsx` — 快捷操作菜单组件
- `src/renderer/components/Common/QuickActions/index.ts` — 统一导出

## 智能体对话系统指令集成（useAgentDialogue + AgentDialogueModal）

### 概述

在 `useAgentDialogue.ts` 中集成 `systemCommands.ts` 模块，实现 5 个系统指令（`/世界书`、`/角色卡`、`/编写`、`/审核`、`/帮助`）的拦截与执行，以及无效 `/` 指令的友好提示。系统指令在 `sendMessage` 入口处优先检测，命中后短路返回不进入正常对话流程。

### 指令处理流程

```
sendMessage(content)
  │
  ├─ 空内容 / streaming 检查（原有逻辑）
  │
  ├─ isSystemCommand(content) ?  ← 系统指令检测
  │   ├─ 是 → parseSystemCommand → switch(name) 分发
  │   │        ├─ 世界书 → handleListWorldbooks()
  │   │        ├─ 角色卡 → handleListCharacters()
  │   │        ├─ 编写   → handleWriteWorldbook(args) → return（自行管理消息追加与流式输出）
  │   │        ├─ 审核   → handleAuditWorldbook(args)
  │   │        ├─ 帮助   → handleHelp()
  │   │        └─ 追加 user + assistant 消息，return
  │   │
  │   └─ 否 → trimmed.startsWith('/') && !startsWith('//') ?  ← 无效指令检测
  │        ├─ 是 → 追加 user + assistant（"未知指令"提示），return
  │        └─ 否 → 进入正常对话流程（原有逻辑）
```

### 指令处理函数

| 函数 | 指令 | 调用的 electronAPI | 说明 |
|------|------|---------------------|------|
| `handleListWorldbooks` | `/世界书` | `worldBook.list()` | 返回格式化 Markdown 列表（名称/大小/更新日期） |
| `handleListCharacters` | `/角色卡` | `character.list()` | 返回格式化 Markdown 列表（名称/描述摘要） |
| `handleWriteWorldbook` | `/编写 <名称>` | `worldBook.list()` + `skill.getPromptSnippet()` + `agent.run()` + `agent.onToken()` | 匹配世界书后通过 agent.run 流式对话模式编写，自行管理消息追加（返回 `Promise<void>`，sendMessage 中直接 return） |
| `handleAuditWorldbook` | `/审核 <名称>` | `worldBook.list()` + `worldBook.read()` + `agent.run()` | 读取世界书内容后，用 agent.run 执行三维审核（完整性/一致性/符合度） |
| `handleHelp` | `/帮助` | 无 | 返回指令列表 Markdown 表格 |

### 开场白增强

`buildGreeting` 函数对系统智能体（`agent.isSystem === true`）追加可用指令列表提示，引导用户使用系统指令。

### AgentDialogueModal 输入提示与命令补全

输入框 placeholder 从 `"输入消息...（Enter 发送，Shift+Enter 换行）"` 改为 `"输入消息或 /世界书 /角色卡 /编写 /审核…（Enter 发送）"`，提示用户可使用系统指令。

输入 `/` 前缀时，`SlashCommandAutoComplete` 浮层展示**全部已注册命令**（系统指令 + 内置命令），而非仅系统指令。组件通过 `slashCommandRegistry.getAll()` 获取全部命令列表（`allCommands`），并按 `autoCompleteQuery` 进行模糊过滤。`ensureSystemCommandsRegistered()` 同时调用 `registerBuiltinCommands()` 与 `registerSystemCommands()` 确保两类命令均已注册。

### 涉及文件清单

**修改文件：**
- `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 导入 systemCommands 模块、buildGreeting 增强、5 个指令处理函数、sendMessage 指令检测逻辑
- `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — placeholder 提示文案；`/` 补全展示全部已注册命令（系统指令 + 内置命令）；`ensureSystemCommandsRegistered` 同时注册内置命令

---

## 输入优化与系统智能体 Prompt 强化（Task 2 + Task 4）

### 概述

为 `useAgentDialogue` hook 新增 `optimizeInput` 方法，通过 `agent.run` IPC 通道对用户输入文本进行智能优化（提升清晰度、补充上下文、修正语法），同时强化系统智能体（`isSystem === true`）的 system prompt，注入角色定位、思考框架、工具使用、多步推理、回答规范等能力强化段落。

### 输入优化（optimizeInput）

**新增状态：**
- `isOptimizing: boolean` — 是否正在进行输入优化
- `optimizeAbortRef: useRef(false)` — 优化取消标志

**optimizeInput 方法流程：**
1. 空文本 / 正在优化时阻止重复执行
2. 从 `useSettingStore` 获取当前激活引擎的 `system_prompt`，前置到优化提示词
3. 调用 `window.electronAPI.agent.run`，`maxIterations: 1` 确保不进入工具调用循环，`timeoutMs: 30000`
4. 成功时返回优化后文本（trim）；失败 / 取消时返回原始文本（不阻塞用户操作）
5. `cancelOptimize` 方法设置 abort 标志并重置 `isOptimizing`

**返回值新增字段：**
- `optimizeInput: (originalText: string) => Promise<string>` — 优化输入文本
- `isOptimizing: boolean` — 优化进行中状态
- `cancelOptimize: () => void` — 取消优化

### 系统智能体 System Prompt 强化（buildSystemPrompt）

`buildSystemPrompt` 函数在 `agent.isSystem === true` 时追加「能力与行为准则」段落，包含五个子章节：
- **角色定位**：Creative Cafe 系统智能体的综合能力定义
- **思考框架**：理解意图 → 分解任务 → 逐步执行 → 汇总结果
- **工具使用**：主动调用工具获取信息，失败时提供替代方案
- **多步推理**：列出计划 → 逐步执行 → 及时修正 → 汇总结果
- **回答规范**：结构化输出、代码块包裹、不确定信息标注

### system-agent description 更新

`agentConfigService.ts` 中 `system-agent` 的 description 字段更新为更完整的描述，涵盖多轮对话、工具调用、多步推理、任务分解能力，以及斜杠指令和复杂需求处理场景。

### 涉及文件清单

**修改文件：**
- `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 新增 `optimizeInput` / `cancelOptimize` / `isOptimizing`；`buildSystemPrompt` 增加系统智能体能力强化段落；`UseAgentDialogueReturn` 类型扩展
- `src/main/services/agent/management/agentConfigService.ts` — `system-agent` description 字段更新

---

## 混合检索记忆搜索（Task 14: optimize-agent-interaction-from-openclaw）

### 概述

在 `ContextManager` 中新增 `retrieveWithHybrid` 方法，实现向量检索 + 关键词检索的混合检索策略，包含 MMR 去重和时间衰减，参考 openclaw 混合检索策略。

### 检索流程

1. **向量检索（权重 0.7）**：用 `embeddingService.generateEmbedding(query)` 生成查询向量，通过 `vectorStoreService.search` 检索 `topK * 2` 条结果（多取一倍用于 MMR 筛选），过滤 `score >= minScore`，每条 score 乘以 0.7
2. **关键词检索（权重 0.3）**：仅对 worldbook 来源，复用 `buildScanText` 构建扫描文本，调用 `worldBookService.matchKeywords`，每条 score 乘以 0.3，按 `metadata.entryUid` 去重
3. **合并候选集**：合并向量结果和关键词结果
4. **时间衰减**：`score *= exp(-daysSinceLastAccess / halfLife)`，半衰期默认 30 天（30 天前内容 score 衰减为 e^(-1) ≈ 0.37）
5. **MMR 去重选择**：`MMR = λ * relevance_score - (1-λ) * max_similarity_to_selected`，λ 默认 0.7；文档间相似度使用 Jaccard 相似度（中文按 2 字滑动窗口分词，英文按空格分词）
6. **返回结果**：按最终 score 降序排列，取 topK 条

### IPC 通道

- `context:retrieveWithHybrid` — 入参 `{ query: string; options: any }`，返回 `{ success, items }`

### 涉及文件

- `src/main/services/ContextManager.ts` — 新增 `tokenize` / `jaccardSimilarity` 辅助函数 + `retrieveWithHybrid` 方法 + `context:retrieveWithHybrid` IPC handler
- `src/main/preload.ts` — context 命名空间新增 `retrieveWithHybrid` API
- `src/renderer/types/electron.d.ts` — context 命名空间新增 `retrieveWithHybrid` 类型声明

## 对话消息列表组件复用优化（CharacterDialogueChat 迁移至 ChatMessageList）

### 概述

将 CharacterDialogueChat（角色对话）的消息列表渲染从自有的 `VirtualizedMessageList` + IIFE 模式迁移到复用 `ChatMessageList` 组件，使角色对话与智能体对话（AgentDialogueModal）共享同一消息列表组件，组件复用率 ≥ 80%。

### 改动内容

#### ChatMessageList 组件增强（`src/renderer/components/Common/ChatMessageList/ChatMessageList.tsx`）

新增三个可选 props，支持虚拟化模式：

- `enableVirtualization?: boolean`（默认 false）— 是否启用虚拟化
- `virtualizationThreshold?: number`（默认 100）— 虚拟化启用的消息数阈值，同时受 `shouldVirtualize` 最低阈值 50 约束
- `scrollElementRef?: React.RefObject<HTMLDivElement>` — 外部滚动容器引用，虚拟化模式下复用父级滚动容器

虚拟化模式（`enableVirtualization=true` 且传入 `scrollElementRef`）行为：
- 不创建嵌套滚动容器，直接使用父级滚动容器
- 不执行内部自动滚动（由父组件管理）
- 消息数超过阈值时使用 `VirtualizedMessageList` 渲染，否则直接 `.map()` 渲染
- 空消息列表返回 null（空状态由父组件处理）

非虚拟化模式（默认）行为保持不变：内部滚动容器 + 自动滚动 + 空状态展示。

新增导入：从 `../../Character/CharacterDialogueChat/VirtualizedMessageList` 导入 `VirtualizedMessageList` 和 `shouldVirtualize`。

#### CharacterDialogueChat 迁移（`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`）

- 移除 `VirtualizedMessageList` 和 `shouldVirtualize` 的直接导入
- 新增 `ChatMessageList` 导入（`../../Common/ChatMessageList/ChatMessageList`）
- 将原 IIFE 内的 `renderMessageBubble` 函数提取到组件体中（return 之前）
- 用 `<ChatMessageList>` 替换原消息列表 IIFE：
  - `mode="character"` / `enableVirtualization={true}` / `scrollElementRef={chatContainerRef}` / `renderMessage={renderMessageBubble}`
- `ChatTypingIndicator`、错误消息、`messagesEndRef`、滚动按钮保持原有位置不变（作为 ChatMessageList 的兄弟元素）

### 未修改的组件

- **ChatMessageBubble** — 保持不变，由 `renderMessageBubble` 调用
- **VirtualizedMessageList** — 保持不变，由 ChatMessageList 内部调用

### 涉及文件

- `src/renderer/components/Common/ChatMessageList/ChatMessageList.tsx` — 新增虚拟化支持
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — 迁移至 ChatMessageList

---

## ⚠️ 重点 Bug 修复：智能体对话三项功能运行时失效（2026-08-02）

### 问题描述

用户报告智能体对话的三项功能（命令自动提示、优化输入按钮、系统智能体能力强化）在实际测试中完全无效。前一轮修复已将代码写入磁盘，但运行时行为未改变。

### 根因分析

经 Self-Improving + Proactive Agent 自反思流程深入调查，发现**三个独立的根因**：

#### 根因 1：`agentConfigService._doInit()` 幂等注册跳过已有记录（最严重）

**位置**：`src/main/services/agent/management/agentConfigService.ts` `_doInit()`

**问题**：`if (this.cache.has(def.id)) continue;` 跳过已存在的 `system-agent` 记录。如果该记录在代码更新前已创建（旧版本 `is_system=0` 或旧 description），代码变更**永远不会同步到数据库**。

**修复**：将 skip 逻辑改为 upsert — 已存在的记录执行 `updateConfig()`，新记录执行 `insertConfig()`。

#### 根因 2：`optimizeInput` 与 `activeRuns` 守卫的竞态条件

**位置**：`src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` `cancelOptimize` / `optimizeInput`

**问题**：`cancelOptimize` 设置 `setIsOptimizing(false)` 后，`activeRuns` IPC 锁可能尚未释放。用户再次点击"优化"时被守卫拦截返回 "Agent is already running"。

**修复**：新增 `optimizeRunningRef`（useRef），在 `optimizeInput` 入口同步检查，在 `finally` 块中清理。

#### 根因 3：Electron 主进程未重启

前一轮代码修复已正确写入磁盘，但 Electron 主进程未重启，旧编译产物仍在运行。

### 经验教训

1. **幂等注册必须使用 upsert 模式**：`if (exists) update(); else insert();`，而非 `if (exists) continue;`
2. **React state 不能用于并发控制**：`useState` 的更新是异步批处理的，对于 IPC 重入防护必须使用 `useRef`
3. **Electron 主进程修改后必须重启 dev server**
4. **运行时验证 > 静态代码分析**

---

## Agent 对话页面美化重构（2026-08-02）

### 概述

将 AgentDialogueModal 的对话页面美化到与 CharacterDialogueChat 同等水平，包括背景装饰、消息气泡、头像、动画、输入区域等全面重构。

### 新增文件

- `src/renderer/components/AgentCenter/AgentDialogueModal.css` — Agent 对话页面专用 CSS（背景装饰、滚动条、Modal 覆盖样式、动画 keyframes）

### 修改文件

- `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 完全重写 JSX 和样式

### 美化元素清单

| 元素 | 修复前 | 修复后 |
|------|--------|--------|
| Modal 尺寸 | 720px 宽, 400px 高 | 900px 宽, 70vh 高 |
| Modal 遮罩 | 普通遮罩 | `backdropFilter: blur(8px)` 毛玻璃 |
| 背景 | 纯色 | 5 层径向渐变 + 3 个模糊光球 + 网格点阵 |
| 头部 | antd 默认标题栏 | 自定义头部（40px 圆形头像 + 名称 + 描述 + SYSTEM 标签） |
| 消息气泡 | 8px 统一圆角, 无阴影 | 不对称圆角 `18px 18px 4px 18px`, 毛玻璃, 彩色阴影 |
| 头像 | 无 | 36px 圆形头像, 用户/AI 差异化渐变边框 |
| 发送者名称 | 无 | "You" / 智能体名 + #序号标签 |
| 入场动画 | 无 | `agentFadeInUp 0.3s ease-out` |
| 流式光标 | 8x14px 矩形块 | 2px 竖线, `step-end` 闪烁 |
| 打字指示器 | 无 | 头像 + LoadingOutlined + "Thinking..." |
| 空状态 | emoji + 简单文本 | 80px 圆形渐变图标 + 发光阴影 + 标题 + 描述 |
| 输入框 | antd TextArea | 胶囊形 `border-radius: 24px` + 毛玻璃背景 + 聚焦发光 |
| 按钮 | antd 矩形按钮 | 44x44px 圆形渐变按钮 + 阴影 |
| 滚动按钮 | 无 | 脉冲动画圆形渐变按钮 |
| 滚动条 | 默认 | 6px 细滚动条 + 悬停变色 |
| 键盘提示 | 无 | "Enter 发送 · Shift+Enter 换行" |

---

## ⚠️ Bug 修复：系统指令参数解析无法分离文件名和自然语言（2026-08-02）

### 问题描述

用户输入 `/编写 神秘别墅.json，有任何疑问随时问我`，系统将整个 `神秘别墅.json，有任何疑问随时问我` 作为世界书名称查找，导致 "未找到名为「神秘别墅.json，有任何疑问随时问我」的世界书" 错误。

### 根因

`parseSystemCommand` 将指令名后的所有文本作为单个 `args` 字符串传递给 handler，handler 直接用整个 args 去匹配世界书名称，没有分离文件名和用户的自然语言补充说明。

### 修复

在 [useAgentDialogue.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts) 中新增 `extractWorldbookNameAndExtra()` 辅助函数，按以下策略提取文件名：

1. **文件扩展名匹配**：匹配 `.json` / `.json5` / `.tags.json` 扩展名，扩展名后的内容作为附加上下文
2. **中文标点分割**：按 `，。！？、；` 分割，第一段为名称
3. **空格分割**：按空格分割，第一段为名称
4. **兜底**：整个 args 作为名称

提取后的附加上下文（`extra`）会传入 `agent.run` 的 `writePrompt` 和 `agent.run` 的 `messages`，让 AI 能理解用户的补充说明。（注：`/编写` 指令已从 `worldBookAgent.run` 改为 `agent.run` 流式对话模式，详见 [/编写 指令重构](#编写-指令重构移除进度面板与逐项提问改为流式对话模式2026-08-02)。）

`handleWriteWorldbook` 和 `handleAuditWorldbook` 均已应用此修复。

---

## 意图识别前置处理机制（2026-08-02）

### 概述

在用户输入发送至执行智能体之前，增加一个由轻量级 LLM 构成的意图识别前置处理环节。该环节对用户输入进行深层语义分析，精准识别用户真实意图类型，判断当前智能体是否具备处理该意图的能力，并确定最匹配的响应策略。

### 新增文件

- [intentRecognizer.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/intentRecognizer.ts) — 意图识别核心模块

### 意图分类体系

| 意图类型 | 标识 | 说明 |
|----------|------|------|
| 信息查询 | `information_query` | 查询信息、了解事实、搜索资料 |
| 任务执行 | `task_execution` | 执行具体任务、创建/修改/删除内容 |
| 问题解决 | `problem_solving` | 解决技术问题、调试、排错 |
| 建议咨询 | `advice_consultation` | 寻求建议、征求意见、方案咨询 |
| 创作写作 | `creative_writing` | 创作故事、写诗、编写剧本、角色设定 |
| 日常闲聊 | `casual_chat` | 闲聊、问候、情感交流 |
| 系统操作 | `system_command` | 调用系统功能、管理配置 |
| 代码开发 | `code_development` | 编写/审查/重构代码 |
| 数据分析 | `data_analysis` | 分析数据、统计、可视化 |

### 处理流程

```
用户输入
  ↓
系统指令检测（/世界书 等）───是──→ 直接执行指令
  ↓ 否
无效指令检测（/未知命令）───是──→ 提示未知指令
  ↓ 否
【意图识别前置处理】
  ├─ 调用 agent.run（maxIterations=1, timeoutMs=8000）
  ├─ LLM 返回 JSON：{ intentType, summary, canHandle, strategy, confidence }
  ├─ 识别成功 → 展示「思考过程」消息 + 注入 systemPrompt
  └─ 识别失败 → 静默降级，不阻断对话
  ↓
执行智能体对话（agent.run，含意图增强 systemPrompt）
  ↓
流式返回
```

### 核心设计

1. **轻量级调用**：意图识别使用 `maxIterations=1, timeoutMs=8000`，快速返回
2. **容错降级**：识别失败时静默降级，不阻断正常对话流程
3. **并发防护**：使用 `recognizingIntentRef`（useRef）防止意图识别期间重复提交（共享 `activeRuns` 单实例锁）
4. **透明展示**：识别结果以「🔍 意图识别」消息卡片展示给用户，包含意图类型、核心需求、响应策略、能力匹配、置信度
5. **systemPrompt 注入**：识别结果注入执行智能体的 systemPrompt，帮助 AI 更准确理解用户需求
6. **UI 状态指示器**：头部显示「识别意图」加载状态和「意图标签」结果标签

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/renderer/components/AgentCenter/hooks/intentRecognizer.ts` | 新增：意图识别核心模块 |
| `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` | 集成意图识别到 sendMessage 流程 |
| `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` | 头部添加意图识别状态指示器 |

---

## 智能体对话参数配置面板（Spec: add-agent-dialogue-parameter-panel，2026-08-02）

### 概述

在智能体对话框右侧增加折叠式参数面板，提供人格自定义系统和辅助模式功能。参数按智能体 ID 持久化到 localStorage，切换智能体自动加载对应配置。

### 新增文件

| 文件 | 说明 |
|------|------|
| [useAgentParams.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/useAgentParams.ts) | 参数持久化 hook（`AgentParams` 接口 + localStorage 读写 + 切换 agentId 自动加载） |
| [AgentParamPanel.tsx](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentParamPanel.tsx) | 参数面板 UI 组件（人格 TextArea + 辅助模式 Switch + 强度 Radio + 重置按钮） |
| [AgentParamPanel.css](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentParamPanel.css) | 参数面板样式 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `AgentDialogueModal.tsx` | 双列布局（对话区 + 300px 参数面板），头部人格/辅助模式标签、齿轮按钮、辅助模式选项卡片渲染 |
| `useAgentDialogue.ts` | `buildSystemPrompt` 追加人格风格段 + 辅助模式段，`parseAssistModeOptions` 解析剥离选项块，`DialogueMessage` 新增 `suggestedOptions` 字段 |

### 核心设计

#### 参数持久化架构

```
localStorage key: agent-params-{agentId}
存储内容（JSON）:
{
  customPersonality: string,       // 自定义人格文本
  assistMode: boolean,             // 辅助模式开关
  assistModeIntensity: 'low'|'medium'|'high'  // 强度
}
```

- `useAgentParams(agentId)` hook 在 `agentId` 变化时通过 `useEffect` 自动重新加载
- `updateParams(partial)` 实时写入 localStorage（无需确认步骤）
- `resetParams()` 恢复默认值并立即持久化

#### systemPrompt 分段注入

```
[全局 system_prompt]

[智能体描述段] — 你是「{name}」。{description}...
[能力强化段]   — ## 能力与行为准则（仅系统智能体）
[人格风格段]   — ## 人格风格（仅 customPersonality 非空时）
[辅助模式段]   — ## 辅助模式（仅 assistMode 开启时）
```

人格段与角色定义段独立呈现：角色定义段定义"你是谁"（身份职责），人格风格段定义"你怎么说话"（语气风格）。

#### 辅助模式选项格式

使用 `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` 纯文本标记格式（非 XML/HTML）。AI 回复完成后，`parseAssistModeOptions` 从内容中解析并剥离选项块，支持 6 种正则模式容错匹配。

选项卡片三色差异化设计：
- 稳妥推进（绿色 `#10b981`）
- 平衡探索（紫色 `#6366f1`）
- 发散创新（橙红 `#f59e0b`）

选项文本解析正则：`/\(([^)]*)\)|"([^"]*)"/g`，分离动作描写（斜体灰色）和对话内容（白色）。

---

## ⚠️ Bug 修复：/编写 指令秒回"已完成"但世界书未实际编写（2026-08-02）

### 问题

`handleWriteWorldbook` 中 IPC 返回值字段不匹配：检查 `result?.success` 但 IPC handler 返回 `{ ok, result?, error? }`，`success` 在嵌套的 `result.result` 上。导致无论成功失败永远报"已完成"。同时缺少 `config` 参数，服务端必然失败。

详见 [FIX_RECORDS.md §3.1](file:///g:/AI/creative-cafe/docs/FIX_RECORDS.md)。

---

## 世界书编写实时进度面板（2026-08-02）

### 概述

将世界书编写过程从"每次进度事件追加新消息"改为"单条消息实时更新"，类似 Trae IDE 的 Agent 面板。展示编写阶段、思考过程时间线、维度进度、当前活动和活动日志。

### 核心设计

#### 单条消息实时更新机制

使用 `_progressPanelId` 字段（值为 `'__worldbook_progress__'`）标记进度面板消息。每次进度事件到达时，通过 `findIndex` 查找已有面板消息并原地更新内容，而非追加新消息。

```typescript
// DialogueMessage 接口新增字段
_progressPanelId?: string;

// 进度面板消息更新逻辑
const idx = prev.findIndex(m => m._progressPanelId === '__worldbook_progress__');
if (idx >= 0) {
  const updated = [...prev];
  updated[idx] = { ...updated[idx], content: panelContent };
  return updated;
}
```

#### 进度面板内容结构

`buildAuthoringProgressPanel(displayName, events, thoughtSteps)` 函数构建 Markdown 面板：

1. **标题行**：`## 📖 世界书「{name}」编写进度`
2. **整体进度**：阶段 ｜ 维度进度 ｜ 已生成条目数
3. **当前活动**：`> 🔄 {currentActivity}`
4. **澄清问题**（planning_clarifying 阶段）：展示 AI 提出的问题列表
5. **最近生成条目**（`generatedEntries` 存在时）：每条展示名称 + 内容摘要（截断 200 字符）
6. **审计结果**（`auditDetail` 存在时）：区分 `mini`（维度 / 完整性问题数 / 一致性问题数 / 关键问题列表）与 `full`（综合结果 / 分数 / 三维度摘要 / 自动修复数 / 需用户决策项）
7. **思考过程时间线**（最近 8 条）：🧠 LLM 调用 / 📝 解析 / 🎯 决策 / 🔧 工具调用，含目的、输入输出摘要（截断 300 字符）、耗时
8. **活动日志**（最近 5 条）：时间戳 + 阶段标签 + 维度 + 条目数 + 消息

#### 阶段标签映射

```typescript
const AUTHORING_PHASE_LABELS: Record<string, string> = {
  planning_analyzing: '分析提示',
  planning_clarifying: '澄清问题',
  planning_building: '构建计划',
  authoring_generating: '生成条目',
  authoring_mini_audit: '微型审计',
  authoring_fixing: '自我修正',
  auditing_full: '完整审计',
  auditing_fixing: '自动修复',
  // ...
};
```

#### 数据流

```
worldbookAgent:progress IPC 事件
  → progressEvents.push(data) + thoughtStepsAccum.push(data.thoughtStep)
  → buildAuthoringProgressPanel() 构建 Markdown
  → setMessages() 原地更新 _progressPanelId 消息
```

编排完成后，进度面板消息追加分隔线和最终总结（成功/失败）。

---

## 智能体逐项问答弹窗组件 AgentQuestionModal（Spec: optimize-agent-question-interaction，2026-08-02）

### 概述

新增 `AgentQuestionModal` 组件，用于智能体在世界书编写 PLANNING 阶段向用户逐项提出澄清问题。每个问题提供预设选项卡片和"其他"自定义输入，用户确认或跳过后继续下一个问题。ESC 键和点击外部均不关闭弹窗，必须显式操作。

### 新增文件

| 文件 | 说明 |
|------|------|
| [AgentQuestionModal.tsx](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentQuestionModal.tsx) | 逐项问答弹窗 React FC 组件 |
| [AgentQuestionModal.css](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentQuestionModal.css) | 弹窗样式（全局类名，因 antd Modal 渲染在 body 下） |

### Props 接口

```typescript
interface AgentQuestionModalProps {
  question: string;        // 问题内容
  why: string;             // 上下文说明（为什么需要这个信息）
  options: string[];       // 预设选项列表
  currentIndex: number;    // 当前问题序号（从 1 开始）
  totalCount: number;      // 总问题数
  onAnswer: (answer: string | undefined, skipped: boolean) => void;
}
```

### 内部状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `selectedOption` | `string \| null` | 当前选中的预设选项 |
| `isOtherSelected` | `boolean` | 是否选中"其他" |
| `customInput` | `string` | "其他"输入框内容 |

### 组件行为

1. **Modal 配置**：`open` 始终为 `true`，`closable={false}`、`maskClosable={false}`、`keyboard={false}`、`footer={null}`、`width=520`、`centered`
2. **标题**：`🤔 智能体需要确认`
3. **问题序号**：antd `Tag`（color="blue"）显示"问题 {currentIndex}/{totalCount}"
4. **问题内容**：18px 加粗
5. **上下文说明**：13px 灰色，💡 图标前缀
6. **预设选项**：可点击卡片（非 Radio），选中状态蓝色边框 `#3b82f6` + 浅蓝背景 `#eff6ff`
7. **"其他"选项**：✏️ 图标，点击后展开 `Input.TextArea`（autoSize 3-6 行，autoFocus）；选中"其他"时预设选项取消高亮，反之亦然
8. **确认按钮**：蓝色 primary，未选择任何选项且"其他"输入框为空时禁用；点击调用 `onAnswer(selectedOption || customInput.trim(), false)`
9. **跳过按钮**：默认样式，点击调用 `onAnswer(undefined, true)`
10. **底部布局**：`flex` + `justify-content: flex-end` + `gap: 12px`

### 样式要点

- CSS 使用全局类名（`.agent-question-modal .ant-modal-body`），因 antd Modal 默认渲染在 body 下
- 选项卡片：`padding: 12px 16px`、`border-radius: 8px`、`border: 1px solid #e5e7eb`、hover 浅灰背景
- "其他"输入区域展开动画：`aqmFadeIn 0.2s ease-out`

---

## worldbook-author SKILL.md 架构变更：三阶段工作流 → 流式对话模式（2026-08-02）

### 概述

`worldbook-author` 内置技能的 SKILL.md 从「三阶段启发式工作流（PLANNING→AUTHORING→AUDITING）」重写为「自由流式工作模式 + 数据入库格式规范」。智能体不再通过专用 IPC 通道 `worldbookAgent:run` 工作，而是通过 `agent.run` 流式对话模式工作，智能体自主决定工作流程。

### 变更内容

- **description 字段更新**：从三阶段工作流描述改为流式对话模式描述
- **新增「工作模式」章节**：智能体通过流式对话与用户交互，自主决定信息收集、条目生成、质量检查等工作流程，不设预设工作路线
- **新增「数据入库格式规范」章节**：
  - 条目结构表（`worldBookPath` / `name` / `content` / `keys` / `secondaryKeys` / `comment` / `dimensionId`）
  - autoGenerated 标记说明
  - worldBookPath 传递规范
  - 工具调用指引（`createEntry` / `generateKeywords` / `expandFromContext`）
- **移除的内容**：
  - 三阶段启发式工作流（规划阶段 / 自驱编写阶段 / 审计闭环阶段）
  - 专用 IPC 通道列表（`worldbookAgent:run` / `cancel` / `status` / `resume` / `answer` / `progress` / `clarify`）
  - 断点续跑与取消（状态机相关）
  - 注意事项中的单实例守卫、会话超时等状态机相关内容
  - 「与手动编写的区别」表格中的「质量保障」行（不再有自动审计）

### 保留的内容

- YAML frontmatter 的 `name` / `emoji` / `user-invocable` / `disable-model-invocation` / `command-name` 字段不变
- 「何时调用」与「不适用场景」
- 「Agent 模式要求」
- 「注意事项」中的草稿审批提醒
- 「与手动编写的区别」表格（移除「质量保障」行后保留其余行）

### 涉及文件

- `src/main/services/agent/skills/builtin-skills/worldbook-author/SKILL.md`

---

## /编写 指令重构：移除进度面板与逐项提问，改为流式对话路径（2026-08-02）

### 概述

将 `/编写` 指令从 `worldBookAgent.run` IPC 阻塞调用模式改为 `agent.run` 流式对话模式，移除所有进度面板、逐项提问弹窗、Loading 指示器。此重构与 `worldbook-author SKILL.md` 架构变更（三阶段工作流 → 流式对话模式）配套，使前端代码与技能架构保持一致。

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| [useAgentDialogue.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts) | 重写 `handleWriteWorldbook`；删除进度面板/澄清问题相关代码 |
| [AgentDialogueModal.tsx](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentDialogueModal.tsx) | 移除 `AgentQuestionModal` 引用、Loading 指示器、`clarifyState` 禁用条件 |

### useAgentDialogue.ts 修改详情

#### 删除的代码

1. **`buildAuthoringProgressPanel` 函数及常量** — `AUTHORING_PHASE_LABELS`、`THOUGHT_STEP_ICONS` 常量和 `buildAuthoringProgressPanel()` 函数（约 170 行），不再需要进度面板内容构建
2. **`worldbookWriting` 状态** — `const [worldbookWriting, setWorldbookWriting] = useState(false)`，不再需要编写中状态跟踪
3. **澄清问题状态** — `clarifyQuestions`、`currentClarifyIndex`、`pendingAnswers`、`awaitingSessionId` 四个 useState
4. **`handleClarifyAnswer` 函数** — 逐项提问回答处理逻辑（约 27 行）
5. **`clarifyState` 计算与导出** — return 之前的计算块和 return 语句中的 `clarifyState`、`handleClarifyAnswer`、`worldbookWriting`
6. **`UseAgentDialogueReturn` 接口字段** — `clarifyState`、`handleClarifyAnswer`、`worldbookWriting` 三个字段
7. **import 清理** — 移除 `AuthoringProgressEvent`、`ClarifyingQuestion`、`ThoughtStep` 类型导入（仅用于已删除的代码）

#### `handleWriteWorldbook` 重写

**旧实现**：通过 `worldBookAgent.run()` IPC 阻塞调用，订阅 `worldBookAgent.onProgress()` 事件实时更新进度面板消息，检测 `planning_clarifying` 阶段触发逐项提问弹窗，返回 `Promise<string>`（最终总结文本）。

**新实现**：通过 `agent.run()` 流式对话模式工作，流程如下：
1. 匹配世界书名称（复用 `extractWorldbookNameAndExtra`）
2. 构建 `writePrompt`（含世界书路径和用户附加说明）
3. 追加 user 消息
4. 获取技能提示词片段（`skill.getPromptSnippet()`），构建 `effectiveSystemPrompt`
5. 创建 assistant 占位消息（`streaming: true`）
6. 订阅 `agent.onToken` / `agent.onDone` 事件
7. 调用 `agent.run()`，`context.mode: 'worldbook'`，`maxIterations: 30`，`timeoutMs: 600000`
8. 完成后标记 `streaming: false`，解析辅助模式选项
9. 返回 `Promise<void>`（自行管理消息追加，不再返回文本）

#### `sendMessage` 中 `/编写` 分支修改

```typescript
// 旧：
case '编写':
  resultContent = await handleWriteWorldbook(args);
  break;

// 新：
case '编写':
  await handleWriteWorldbook(args);
  return;  // handleWriteWorldbook 自己管理消息追加和流式输出
```

`handleWriteWorldbook` 不再返回字符串，`/编写` 分支直接 return，不走 `appendAssistantMessage(resultContent)` 路径。`resultContent` 变量类型仍为 `string`（其他分支不受影响）。

### AgentDialogueModal.tsx 修改详情

1. **移除 `AgentQuestionModal` import** — 不再使用逐项问答弹窗组件
2. **移除解构字段** — `clarifyState`、`handleClarifyAnswer`、`worldbookWriting` 从 `useAgentDialogue` 返回值解构中移除
3. **移除 `AgentQuestionModal` 渲染块** — 整个 `{clarifyState.currentQuestion && (<AgentQuestionModal ... />)}` 块删除
4. **移除 `clarifyState.currentQuestion != null` 禁用条件** — textarea、优化按钮、发送按钮的 `disabled` 和 `cursor` 条件中移除该判断
5. **移除 Loading 指示器** — `msg._progressPanelId === '__worldbook_progress__'` 条件渲染块删除

### 向后兼容

- `DialogueMessage._progressPanelId` 字段保留在接口定义中（向后兼容），但不再有代码设置该字段
- `AgentQuestionModal` 组件文件本身未删除（可能在其他地方使用或未来复用）
- `worldBookAgent` IPC 通道相关代码未删除（主进程服务仍存在）

### 与既有文档的关系

- [世界书编写实时进度面板](#世界书编写实时进度面板2026-08-02) — 该功能已在本次重构中移除
- [智能体逐项问答弹窗组件 AgentQuestionModal](#智能体逐项问答弹窗组件-agentquestionmodalspecoptimize-agent-question-interaction2026-08-02) — 该弹窗已从 `AgentDialogueModal` 中移除
- [worldbook-author SKILL.md 架构变更](#worldbook-author-skillmd-架构变更三阶段工作流--流式对话模式2026-08-02) — 本次前端重构是该架构变更的配套修改

## 世界书新生成 / 草稿条目审核按钮（2026-08-03）

### 概述

在 AI 生成的新条目列表与 autoGenerated 草稿条目待审阅区中，为每个条目新增"审核"按钮。点击后提取条目 `content` 文本，复用既有的单字段审核流程（`WorldBookAuditModal`），设置 `currentAuditField='content'` / `currentAuditText` 并打开审核 Modal，无需新增审核逻辑。

### 修改点

1. **`WorldBookAIGenerateFlow.tsx`**：
   - Props 接口新增可选回调 `onAuditEntry?: (entry: any) => void`
   - 导入 `SafetyCertificateOutlined` 图标
   - 在 `generatedEntries`（新建世界书 Modal）与 `addedEntries`（添加条目 Modal）两个条目列表中，每个条目卡片内容区下方添加"审核"按钮，点击调用 `onAuditEntry?.(entry)`

2. **`WorldBookAutoGeneratedReview.tsx`**：
   - Props 接口新增可选回调 `onAuditEntry?: (entry: AutoGeneratedEntry) => void`
   - 导入 `SafetyCertificateOutlined` 图标
   - 在表格"操作"列中，"批准"按钮之前添加"审核"按钮，点击调用 `onAuditEntry?.(record)`
   - 操作列宽度由 160 调整为 220 以容纳三个按钮

3. **`WorldBookManager.tsx`**（编排层）：
   - 新增 `handleAuditGeneratedEntry` useCallback 函数：提取 `entry.content`，校验非空后设置审核状态（`setCurrentAuditField('content')` / `setCurrentAuditText` / `setAuditRequirements('')` / `setIsAuditModalOpen(true)`），并记录日志
   - 将 `onAuditEntry={handleAuditGeneratedEntry}` 分别传递给 `WorldBookAIGenerateFlow` 与 `WorldBookAutoGeneratedReview`

### 设计说明

- 审核按钮复用既有的 `WorldBookAuditModal` 审核流程，无需新增 Modal 或审核逻辑
- `onAuditEntry` 为可选 prop，不传递时按钮仍渲染但点击无操作（`?.` 可选链保护）
- 草稿条目（`AutoGeneratedEntry`）的结构与生成条目不同，但均包含 `content` 字段，`handleAuditGeneratedEntry` 统一通过 `entry?.content` 提取

### 涉及文件

- `src/renderer/components/WorldBook/WorldBookAIGenerateFlow.tsx` — 新增 prop + 审核按钮
- `src/renderer/components/WorldBook/WorldBookAutoGeneratedReview.tsx` — 新增 prop + 审核按钮 + 列宽调整
- `src/renderer/components/WorldBook/WorldBookManager.tsx` — 新增 `handleAuditGeneratedEntry` + prop 传递

## 角色卡素材生成与 SD 图像生成分流（Spec: add-asset-and-trait-management / Task 10）

### 概述

角色卡素材管理（`AssetManagerModal` / `AssetGenerateModal`）支持五类图像生成：批量表情（batch-expression）、单个表情（single-expression）、角色立绘（illustration）、一般图像（general）、三视图（three-view）。生成请求通过 `sd:` IPC 命名空间下发至 `sdGenerationService`，最终调用 SD WebUI 的 txt2img / img2img 接口。素材本身的 CRUD（清单读写、保存、删除）走 `asset:` 命名空间。

### 生成路径分流（核心设计）

`AssetGenerateModal.handleSingleGenerate` 按 mode 分流到两条 IPC，**明确区分"图像参考（img2img）"与"纯文生图（txt2img）"两种技术路径**：

| mode | IPC | 技术路径 | 是否使用角色卡基底图 | 适用场景 |
|------|-----|---------|---------------------|---------|
| single-expression | `sd:generateExpression` | img2img | 是（extractBaseImage 从角色卡 PNG 提取） | 在已有角色图基础上变换表情，需保持人物一致性 |
| illustration | `sd:generateTxt2Img` | txt2img | 否 | 角色立绘，完全由提示词 + 角色 LoRA 驱动 |
| general | `sd:generateTxt2Img` | txt2img | 否 | 一般场景图像，提示词 + 角色 LoRA |
| three-view | `sd:generateTxt2Img` | txt2img | 否 | 三视图（front/side/back），提示词 + 角色 LoRA |

> 【重点标记】illustration / general / three-view 统一走 `sd:generateTxt2Img`（纯文生图），**不使用角色卡基底图片作为图像参考**，完全由提示词 + 角色 LoRA 驱动。仅 single-expression 保留 img2img，因为表情生成本质是在已有角色图基础上变换表情。详见 docs/FIX_RECORDS.md §4.1。

### 提示词与 LoRA 注入

- `buildAssetPromptTemplate(mode, targetSlot, userScene)` 按模式构建正面提示词模板，均含 `{traits}` 占位符：
  - **【Spec: add-dynamic-scene-prompt-generation / Task 7】** 函数已从 `AssetGenerateModal.tsx` 迁移至 `PromptBuilder.ts`（导出），与其它 `build*` 工具函数集中管理；illustration / general 模板新增 `{clothing}` / `{pose}` / `{scene}` 动态场景占位符，three-view 模板不改
  - illustration：`full body, {pose}, {traits}, {clothing}, {scene}, high quality, best quality, masterpiece`（原 `standing` / `simple background` 字面量改为 `{pose}` / `{scene}` 占位符，无激活方案时由 Task 8 兜底为 `standing` / `simple background`）
  - general：`{traits}, {clothing}, {pose}, {scene}, high quality, best quality`（原 `${scene}` JS 模板字符串插值改为 `{scene}` 字面占位符；`userScene` 参数保留在签名中供 Task 8 `buildSdOptions` 读取作为 `{scene}` fallback，本函数内部不再使用）
  - three-view：`{viewName} view, full body, {traits}, character sheet, white background, high quality`（不改，已有穿衣/裸体分组逻辑，不使用动态场景占位符）
- `{traits}` / `{clothing}` / `{pose}` / `{scene}` 占位符 + LoRA 标签由 `sdGenerationService.applyTraitsAndLora` 统一处理，`generateExpression`（img2img 路径）与 `generateTxt2Img`（txt2img 路径）均调用该方法：
  - 读取 `options.characterTraits` 过滤空字符串后拼接为逗号分隔串替换 `{traits}`（空则替换为空串并清理多余逗号）
  - 读取 `options.dynamicClothing` / `dynamicPose` / `dynamicScene` 替换对应占位符（**Spec: add-dynamic-scene-prompt-generation / Task 8**，来自 store 激活动态场景方案；空则替换为空串并清理多余逗号）
  - 读取 `options.selectedLoras`（角色专属 LoRA，按角色独立存储，杜绝跨角色污染）注入 LoRA 标签
- `buildSdOptions()` 透传 `characterTraits` 与 `selectedLoras: characterLoras`，确保两条路径都能准确应用角色特征与 LoRA
  - **【Spec: add-trait-category-grouping v2 升级】** `characterTraits` 由「全部 `string[]`」改为「`traits.filter(t => t.enabled).map(t => t.text)`」——store 持有 `CharacterTraitItem[]`（含 `id` / `text` / `categoryId` / `enabled`），下游仅拼接 `enabled=true` 项的 text，实现跨分类组合选择。覆盖 `AssetGenerateModal`（立绘/一般图像/三视图/single-expression/batch-expression）与 `ExpressionGenerateModal`（表情生成）两条组件路径。`sdGenerationService.applyTraitsAndLora` 仍接收 `string[]`，零改动。
  - **【临时编辑支持】** `AssetGenerateModal` 的「携带角色特征」面板支持用户临时编辑/新增/删除（不持久化）：
    - 维护本地工作副本 `editedTraits: CharacterTraitItem[] | null`（弹窗打开时从 store `characterTraits` 深拷贝，关闭时置 null）
    - `effectiveTraits = editedTraits ?? characterTraits` 驱动 `enabledTraitTexts` 派生与 UI 展示
    - 初始化用 `traitStoreCardId === characterCardId` 判断就绪（支持 0 特色角色卡也能初始化为 `[]`）
    - 用户可临时修改 trait 的 `text`（如 `sitting → standing`）、切换 `enabled`、临时删除任意标签、在分类下新增临时标签（`genTraitId()` 生成 id，不写入磁盘）
    - UI 按 `SYSTEM_TRAIT_CATEGORIES + customCategories + UNCATEGORIZED_CATEGORY` 分组折叠展示（所有分类默认展开含空分类），每个 Tag 可点击切换 enabled、点编辑图标进入行内 Input 编辑、点 × 临时删除，分类底部「+ 新增临时标签」可追加临时特征
    - 颜色区分：原始 enabled = purple、已修改 = orange、临时新增 = cyan、disabled = default（灰显）
    - `hasEdits` 检测三类修改（`hasTempAdditions` / `hasTempDeletions` / `hasTextEdits`）控制「重置」按钮可用性
    - 所有临时修改仅影响本次生成，关闭弹窗或点「重置」即丢弃，不回写 store
- txt2img 路径尺寸由 `options.txt2imgWidth/txt2imgHeight` 控制（弹窗内 SizeSelector 选择，不写入全局设置）

### IPC 通道

**sd 命名空间**（`sdGenerationHandlers.ts` → `sdGenerationService`）：

| 通道 | 用途 | 是否需要基底图 |
|------|------|---------------|
| `sd:checkStatus` | 检查 SD WebUI API 状态 | — |
| `sd:getModels` | 获取已加载模型列表 | — |
| `sd:generateTxt2Img` | 文生图（prompt + LoRA，立绘/一般图像/三视图） | 否 |
| `sd:generateExpression` | 单个表情 img2img（提取角色卡基底图） | 是 |
| `sd:generateAllExpressions` | 批量表情 img2img（带 `sd:generationProgress` / `sd:generationComplete` 进度推送与取消） | 是 |
| `sd:cancelGeneration` | 取消进行中的批量生成（模块级 `isCancelled` 标志） | — |

**asset 命名空间**（`assetHandlers.ts` → `assetService`）：`asset:list` / `asset:save` / `asset:delete` / `asset:getImagePath`。返回的 imagePath 为磁盘绝对路径，渲染进程需通过 `file.readAsBase64` 转 data URL（CSP 兼容，与 expression:getImagePath 一致）。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 素材生成弹窗，mode 分流 + 提示词模板构建
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 素材管理弹窗（立绘/一般图像/三视图 Tab）
- `src/main/ipc/handlers/sdGenerationHandlers.ts` — sd 命名空间 IPC 注册
- `src/main/services/sdGenerationService.ts` — SD 生成服务（txt2img / img2img / extractBaseImage / applyTraitsAndLora）
- `src/main/ipc/handlers/assetHandlers.ts` — asset 命名空间 IPC（素材 CRUD）
- `src/main/services/assetService.ts` — 素材存储服务（manifest 管理，三视图 slot 校验）

### AssetManagerModal Tab 结构与预览交互

`AssetManagerModal` 内部 5 个 Tab，4 个图像类 Tab（表情 `ExpressionTabContent` / 立绘 `AssetGridTabContent('illustration')` / 一般图像 `AssetGridTabContent('general')` / 三视图 `ThreeViewTabContent`）共享统一的缩略图预览交互模式：

- 缩略图容器 `position: relative`，含 `thumbnail-hover-overlay` 覆盖层
- hover 时通过 `onMouseEnter`/`onMouseLeave` 切换 overlay `opacity`（0→1，0.25s 过渡）
- overlay 内 `EyeOutlined` 眼睛图标按钮，`Tooltip title="预览大图"`
- 点击 overlay → `setPreviewImage(dataUrl)` → 打开全尺寸预览 Modal（`width="auto"`，图片 `maxWidth:90vw / maxHeight:85vh`，`destroyOnClose`）
- 仅当存在可预览图片时渲染 overlay（表情 Tab：默认头像取 `avatarPath`、已上传取 `imageCache[emotionKey]`、未上传则无）

> 【一致性】2026-08-05 修复：表情 Tab 原本缺失此预览交互（其他三个 Tab 已有），已补齐为统一模式。预览 Modal 去内边距使用 `styles.body: { padding: 0 }`（旧代码误用无效的 `styles.content` 键，已一并清理）。详见 docs/FIX_RECORDS.md §4.2。

### AI 生成特征自动归类（Spec: add-trait-category-grouping 增强）

原 Spec「AI 集成适配」一节规定 AI 特征生成（Task 13）仍返回扁平 `string[]`、新特征统一落入「未分类」，由用户手动归类（"AI 自动归类为未来增强项，本期不做"）。2026-08-05 实施该「未来增强项」：让 LLM 直接输出 `分类:tag` 形式，解析后携带 `categoryId` 透传到 store，使 AI 生成的特征直接进入对应系统分类（basic / head / body / clothing / background / pose / expression），无需用户手动归类。

**系统分类体系（7 个，`SYSTEM_TRAIT_CATEGORIES` 常量定义，order 0..6）：**
- `basic` 基本特征（order 0）— 物种/种族（lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf）、性别（female, male, 1girl, 1boy）、内容分级（sfw, nsfw）等角色基底属性，作为整个角色的基底特征置于最前
- `head` 头部特征（order 1）— 发色/发型/瞳色/动物耳朵/帽子等
- `body` 身体特征（order 2）— 体型/肤色/毛色/尾巴/翅膀等（不含物种与性别，已移至 basic）
- `clothing` 衣物配饰（order 3）
- `background` 背景环境（order 4）
- `pose` 人物姿势（order 5）
- `expression` 人物表情（order 6）
- `uncategorized` 未分类（order 999，迁移兜底，不在 `SYSTEM_TRAIT_CATEGORIES` 数组内）

> `basic` 为 2026-08-05 新增系统分类，置于最前作为角色基底特征容器。物种/性别等基底属性原先归入 `body`，现归入 `basic`；`body` 收缩为体型/肤色/毛色等纯身体特征。详见 docs/FIX_RECORDS.md §4.4。

**类型契约变更：**
- 新增共享类型 `CategorizedTrait`（`src/shared/types/characterTrait.types.ts`）：`{ text: string; categoryId: string }`，是 `CharacterTraitItem` 的「无 id / 无 enabled」轻量子集，由 AI 服务产出、store 接收后补全 id 与 enabled
- `GenerateCharacterTraitsResult.traits` 由 `string[]` 升级为 `CategorizedTrait[]`（`characterTraitAIService.ts`），`generateCharacterTraits` 与 `recognizeImageTraits` 两条路径同步升级
- IPC 通道 `ai:generateCharacterTraits` / `ai:recognizeImageTraits` 返回值类型同步（`preload.ts` / `electron.d.ts`），IPC handler 无结构变化（透传 typed 对象）
- `characterTraitStore.setTraits` 签名由 `(traits: string[])` 升级为 `(traits: CategorizedTrait[])`，MERGE 策略升级（见下）

**LLM Prompt 升级（`characterTraitAIService.ts`）：**
- `CHARACTER_TRAIT_SYSTEM_PROMPT`：原输出 `white fur, dog girl, ...`，现输出 `basic:dog girl, basic:female, head:white hair, ...`，prompt 内嵌 7 个系统分类的语义说明与归类建议（如「物种/种族 → basic」「性别 → basic」「内容分级 → basic」「发色 → head」「瞳色 → head」「服饰/配饰 → clothing」「动物耳朵 → head」「尾巴/翅膀 → body」）
- `IMAGE_TRAIT_SYSTEM_PROMPT`：同步升级为 `category:tag` 英文格式，便于多模态识别结果同样携带分类
- 多模态 `includeImage=true` 分支的内联 system 补充语也同步改为「categorized tags」
- 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复（2026-08-06，Spec: fix-asset-trait-and-scene-defects / Task 5）】上述两个常量现为**基线参考**（`export` 导出，文档化 prompt 结构），生产调用已改为动态构建：`generateCharacterTraits` / `recognizeImageTraits` 在构建 messages 前调用 `categoryDictionaryService.loadDictionary()` 读取全局字典自定义分类，再通过 `buildDynamicTraitSystemPrompt(globalCategories)` / `buildDynamicImageTraitSystemPrompt(globalCategories)` 将系统分类 + 自定义分类合并注入提示词。原硬编码 prompt 仅含 7 个系统分类，LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），导致不会为这些分类生成 `tattoo:dragon tattoo` 等带前缀的 tag。详见 docs/FIX_RECORDS.md §5.2

**解析逻辑升级（`parseTraitsFromContent`）：**
- 返回类型由 `string[]` 改为 `CategorizedTrait[]`
- 解析「category:tag」前缀：仅在 prefix 为已知分类 id 时剥离，否则视为无分类（兜底 `uncategorized`）
- 【重点标记 - 自定义分类 id 合法化（2026-08-06，Spec: fix-asset-trait-and-scene-defects / Task 5.4）】`validCategoryIds` 原仅含 7 个系统分类 id（`basic` / `head` / `body` / `clothing` / `background` / `pose` / `expression`），现同步从 `categoryDictionaryService.loadDictionary()` 加载全局字典自定义分类 id，使 `tattoo` / `weapon` 等自定义分类前缀成为合法前缀，确保 LLM 返回的 `tattoo:dragon tattoo` 能被正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`（而非兜底为 uncategorized）
- 鲁棒性保证：LLM 未输出前缀 / 输出未知前缀 / SD tag 内权重冒号（如 `(white hair:1.3)`）均不被误剥离，整条作为 text、categoryId 兜底为 uncategorized（行为等价于原 Spec）
- 去重键保持为 `text`（大小写敏感）。【Bug 修复 - tag 数量不符】曾短暂改为 `${categoryId}::${text}` 组合键，但导致 LLM 将同一 tag 归入不同分类时（如 `basic:white fur` + `body:white fur`）产生重复项，下游 SD 提示词出现重复 tag。已回退为仅 `text` 去重，保留首次出现的 `categoryId`，与 SD tag 语义一致（详见 docs/FIX_RECORDS.md §4.5）

**Store MERGE 策略升级（`characterTraitStore.setTraits`）：**
1. 现有 `categoryId !== uncategorized` 的 → 原样保留（用户手动分类不丢失）
2. 现有 `categoryId === uncategorized` 且 text 在新集合中的 → **用 AI 的 categoryId 更新**（关键修复：原策略仅保留，新策略用 AI 分类重新归类）
3. 现有 `categoryId === uncategorized` 且 text 不在新集合中的 → 移除（AI 替换未分类特征）
4. 新集合中不存在于现有 traits 的 → 追加为 `{ id, text, categoryId: AI's, enabled: true }`

**调用方适配：**
- `AssetManagerModal.handleAIGenerateTraits`（特征管理 Tab 的「生成特征」按钮）：无代码改动，`setTraits(result.traits)` 类型自动匹配（`CategorizedTrait[]` → `CategorizedTrait[]`）
- `AssetGenerateModal.handleImageRecognize`（素材生成弹窗的图片识别按钮）：原传 `[...existingTexts, ...newTraits]`（`string[]`），现传 `[...existingTraits.map(t => ({text, categoryId})), ...newTraits]`（`CategorizedTrait[]`），保留「现有 trait 透传自身 categoryId（MERGE 对未分类项保持原状）+ 新增 trait 携带 AI categoryId」语义

> 详见 docs/FIX_RECORDS.md §4.3。

## 动态场景提示词生成（Spec: add-dynamic-scene-prompt-generation）— 综述

> 2026-08-05 全 spec 实施完成（Task 1-9）。本节为综述章节，详细实施细节见下方各 Task 专属章节。

### 概述

为角色特征管理系统新增「动态场景提示词生成」能力，允许用户通过自然语言指令（如「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」）让 AI 自动解析为三组独立的英文 SD tag（`clothing` / `pose` / `scene`），保存为命名方案后可在生成图片时一键切换，与基础特征组合后注入 SD 生成流程。该能力独立于角色「固有」基础特征（种族/发色/瞳色/体型等），不污染基础特征数据。

### 五层架构与数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 共享类型层（Task 1）                                          │
│    src/shared/types/characterTrait.types.ts                     │
│      ├─ DynamicScenePrompt 接口                                  │
│      └─ CharacterTraitManifestV2.dynamicScenePrompts /           │
│         activeDynamicScenePromptId 字段                          │
├─────────────────────────────────────────────────────────────────┤
│ 2. 主进程 AI 服务（Task 2）                                      │
│    src/main/services/characterTraitAIService.ts                 │
│      ├─ generateDynamicScenePrompts(params)                     │
│      ├─ DYNAMIC_SCENE_SYSTEM_PROMPT（---CLOTHING--- / ---POSE---│
│      │   / ---SCENE--- 分隔符）                                  │
│      └─ parseDynamicSceneResponse(content) 私有解析方法          │
├─────────────────────────────────────────────────────────────────┤
│ 3. IPC 通道（Task 3）                                            │
│    ai:generateDynamicScenePrompts                              │
│    characterTraitAIHandlers.ts → preload.ts → electron.d.ts    │
├─────────────────────────────────────────────────────────────────┤
│ 4. 主进程存储服务（Task 4）                                      │
│    src/main/services/characterTraitService.ts                  │
│      ├─ loadTraitData() 兜底补 dynamicScenePrompts=[] /         │
│      │   activeDynamicScenePromptId=null（v2 迁移兼容）         │
│      └─ saveTraitData() 完整写入两字段                          │
├─────────────────────────────────────────────────────────────────┤
│ 5. 前端状态层（Task 5）                                          │
│    src/renderer/stores/characterTraitStore.ts                  │
│      ├─ state: dynamicScenePrompts / activeDynamicScenePromptId │
│      └─ actions: saveDynamicScenePrompt（自动激活 + 立即持久化）│
│                 / applyDynamicScenePrompt                       │
│                 / updateDynamicScenePrompt                      │
│                 / deleteDynamicScenePrompt（删激活则置 null）  │
├─────────────────────────────────────────────────────────────────┤
│ 6. 前端 UI 层（Task 6）                                          │
│    AssetManagerModal.tsx → CharacterTraitTabContent            │
│      ├─ NL 输入 + AI 解析按钮（loading 状态）                   │
│      ├─ 三组可编辑 TextArea（服装/动作/场景，可覆盖 AI 结果）   │
│      ├─ 完整提示词预览（baseTraits + clothing + pose + scene） │
│      └─ 保存/切换/删除（方案名输入 + 下拉选择 + Modal.confirm） │
├─────────────────────────────────────────────────────────────────┤
│ 7. 提示词模板（Task 7）                                          │
│    PromptBuilder.ts → buildAssetPromptTemplate                 │
│      ├─ illustration: `full body, {pose}, {traits}, {clothing}, │
│      │   {scene}, high quality, best quality, masterpiece`     │
│      ├─ general: `{traits}, {clothing}, {pose}, {scene},        │
│      │   high quality, best quality`                            │
│      └─ three-view: 不使用动态场景占位符（已有穿衣/裸体分组）  │
├─────────────────────────────────────────────────────────────────┤
│ 8. SD 生成链路（Task 8）                                         │
│    sdGenerationService.applyTraitsAndLora                      │
│      ├─ 读 options.dynamicClothing / dynamicPose / dynamicScene │
│      ├─ 替换 {clothing} / {pose} / {scene} 占位符               │
│      └─ 空替换 + 多余逗号清理（与 {traits} 共用清理路径）       │
│    AssetGenerateModal.buildSdOptions                           │
│      ├─ 从 store 读取激活动态场景方案                            │
│      └─ 兜底：illustration 无激活 → pose=standing / scene=simple │
│         background；general 无激活 → scene 回退到 userScene      │
└─────────────────────────────────────────────────────────────────┘
```

### 各 Task 实施要点

| Task | 模块 | 关键改动 | 详见 |
| --- | --- | --- | --- |
| 1 | `src/shared/types/characterTrait.types.ts` | 新增 `DynamicScenePrompt` 接口（8 字段）+ `CharacterTraitManifestV2` 扩展 2 字段 | 本节「Task 1：共享类型定义」 |
| 2 | `src/main/services/characterTraitAIService.ts` | 新增 `generateDynamicScenePrompts()` + `DYNAMIC_SCENE_SYSTEM_PROMPT` + `parseDynamicSceneResponse()`；复用 `getEngineRuntimeConfig` / `enrichSystemPrompt`；空输入/AI 未配置/解析失败三类兜底 | 本节「Task 2：AI 服务扩展」 |
| 3 | IPC 通道（4 文件） | `ai:generateDynamicScenePrompts` 注册 + preload 暴露 + electron.d.ts 类型声明 | [下方 Task 3 章节](#动态场景提示词生成-ipc-通道扩展spec-add-dynamic-scene-prompt-generation--task-3) |
| 4 | `src/main/services/characterTraitService.ts` | `loadTraitData` 兜底 `[]` / `null`（v2 迁移兼容）+ `saveTraitData` 完整写入 | 本节「Task 4：持久化服务扩展」 |
| 5 | `src/renderer/stores/characterTraitStore.ts` | state + 4 actions（即时持久化语义）；`saveTraits` 签名 `characterCardId` 改可选；修复 TS2739 | [下方 Task 5 章节](#动态场景提示词-store-扩展spec-add-dynamic-scene-prompt-generation--task-5) |
| 6 | `AssetManagerModal.tsx` `CharacterTraitTabContent` | 紫色折叠面板（默认折叠）+ NL 输入 + 三组可编辑 TextArea + 完整预览 + 保存/切换/删除 | [下方 Task 6 章节](#动态场景指令-ui-区域spec-add-dynamic-scene-prompt-generation--task-6) |
| 7 | `PromptBuilder.ts` | `buildAssetPromptTemplate` 从 `AssetGenerateModal.tsx` 迁出并导出；illustration/general 模板加 `{clothing}` / `{pose}` / `{scene}` 占位符；three-view 模板不改 | 「角色卡素材生成与 SD 图像生成分流」节「提示词与 LoRA 注入」段落 |
| 8 | `sdGenerationService.ts` + `AssetGenerateModal.tsx` | `SDGenerationOptions` 新增 3 字段 + `applyTraitsAndLora` 替换占位符 + `buildSdOptions` 透传 + 兜底逻辑 | 「角色卡素材生成与 SD 图像生成分流」节「提示词与 LoRA 注入」段落 |
| 9 | 集成验证 | `npx tsc --noEmit` 724 baseline 错误，12 修改文件零新增错误；5 端到端流程静态验证全部通过；3 文档同步更新 | 本节「Task 9：集成验证」 |

### Task 1：共享类型定义

`src/shared/types/characterTrait.types.ts` 新增 `DynamicScenePrompt` 接口：

```typescript
export interface DynamicScenePrompt {
  id: string;          // genTraitId() 生成（复用基础特征 ID 生成器）
  name: string;        // 用户输入，可重名（与 TraitCombination 拒绝重名策略不同）
  clothing: string;    // 服装相关英文 SD tag（逗号分隔，可能为 ""）
  pose: string;        // 动作/姿势英文 SD tag（逗号分隔，可能为 ""）
  scene: string;       // 场景/环境英文 SD tag（逗号分隔，可能为 ""）
  sourceCommand: string; // 原始自然语言指令（中文，用于溯源与 UI 展示）
  createdAt: number;
  updatedAt: number;
}
```

`CharacterTraitManifestV2` 新增两字段（**「存储可选、内存必填」语义**：磁盘旧 v2 文件可能缺失，由 service 层 `loadTraitData()` 兜底补全 `[]` / `null`）：

```typescript
dynamicScenePrompts: DynamicScenePrompt[];       // 默认 []
activeDynamicScenePromptId: string | null;       // 默认 null
```

> 设计动机：与 `CharacterTraitItem[]` 基础特征分离，避免一次性场景指令污染角色固有视觉属性。`genTraitId()` 复用避免引入新 ID 命名空间。

### Task 2：AI 服务扩展

`src/main/services/characterTraitAIService.ts` 新增方法：

| API | 签名 | 说明 |
| --- | --- | --- |
| `GenerateDynamicScenePromptsParams` | `{ naturalLanguageInput: string; baseTraits?: string }` | 入参：NL 指令 + 可选基础特征上下文 |
| `GenerateDynamicScenePromptsResult` | `{ success, clothing?, pose?, scene?, error? }` | 返回：三组英文 tag（未提及维度为 `""`） |
| `generateDynamicScenePrompts(params)` | async | 主入口；空输入/AI 未配置/解析失败三类兜底 |
| `parseDynamicSceneResponse(content)` | private | 按分隔符切分 + 标点归一化 |
| `DYNAMIC_SCENE_SYSTEM_PROMPT` | const | 指导 LLM 输出 `---CLOTHING---` / `---POSE---` / `---SCENE---` 分隔的三组 tag |

错误兜底链（与 `generateCharacterTraits` / `recognizeImageTraits` 一致）：
- 空输入 → 「请输入动态场景指令」（不调用 LLM）
- AI 引擎未配置（baseUrl / apiKey / modelName / temperature / max_tokens 任一缺失） → 「AI 引擎未配置，请先在设置中配置 API」
- 调用失败（网络 / 超时 / HTTP 错误） → 「AI 调用失败：<具体原因>」
- 解析失败（LLM 返回空内容 / 无分隔符） → 「AI 返回内容无法解析为动态场景 tag」
- handler 外层 try/catch 提供 IPC 序列化兜底，渲染进程永不收到 reject

> 复用 `getEngineRuntimeConfig` / `enrichSystemPrompt` / 非流式调用模式，与项目「禁止 AI 参数默认值」规则一致。

### Task 4：持久化服务扩展

`src/main/services/characterTraitService.ts` 改动：

- **`loadTraitData()`**：`Array.isArray(parsed.dynamicScenePrompts)` 兜底 `[]`；`typeof parsed.activeDynamicScenePromptId === 'string'` 兜底 `null`。v1→v2 迁移时显式补 `[]` / `null`。早于本 spec 落盘的 v2 文件兼容。
- **`saveTraitData()`**：`safeDynamicScenePrompts` / `safeActiveDynamicScenePromptId` 同样兜底后完整写入 manifest，保证下次加载无需再次兜底。日志输出 `dynamicScenePrompts.length` 与 `activeDynamicScenePromptId` 便于诊断。
- **`emptyV2Manifest()`**：初始化空白 manifest 时 `dynamicScenePrompts: []` / `activeDynamicScenePromptId: null`。

### Task 9：集成验证

**TypeScript 验证：** `npx tsc --noEmit` 总错误数 724（与 baseline 一致）。12 个修改文件中 9 个零错误，3 个仅含预存在错误：
- `src/main/ipc/index.ts(1,1)` — `ipcMain` declared but never read（Task 3 仅改注释，未引入代码）
- `src/main/preload.ts(46,43)` — `off` 方法 `Function | undefined` 类型不匹配（预存在，Task 3 仅在 ai 命名空间追加方法）
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts(703,28)` — `parseMesExample` 函数（预存在，Task 7 未触碰该函数）

**端到端流程静态验证：** 5 条流程全部通过（详见 `tasks.md` Task 9 SubTask 9.2 报告）：
1. 类型流：`DynamicScenePrompt` (shared) → service (持久化) → store (state) → UI (展示)，各层类型对齐
2. IPC 流：UI → preload → handler → service → 返回 `{ success, clothing, pose, scene }`，参数/返回类型对齐
3. 持久化流：`saveDynamicScenePrompt` → 本地 state 更新 → `saveTraits()` → `saveTraitData` 写盘，`dynamicScenePrompts` / `activeDynamicScenePromptId` 完整往返
4. SD 生成流：激活动态方案 → `buildSdOptions` 读取 → `applyTraitsAndLora` 替换 `{clothing}` / `{pose}` / `{scene}` 占位符，占位符名一致
5. 兜底流：无激活方案 → illustration 模式 `dynamicPose='standing'` / `dynamicScene='simple background'`，general 模式回退 `userScene`，行为与 spec 前一致

---

## 动态场景提示词生成 IPC 通道扩展（Spec: add-dynamic-scene-prompt-generation / Task 3）

2026-08-05 实施：在 `ai:` IPC 命名空间下新增 `ai:generateDynamicScenePrompts` 通道，将渲染进程的自然语言场景指令（如「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」）转发至主进程 `characterTraitAIService.generateDynamicScenePrompts()`，由 LLM 解析为三组独立的英文 SD tag（`clothing` / `pose` / `scene`），供前端写入 `DynamicScenePrompt` 后在 SD 生成时替换 `{clothing}` / `{pose}` / `{scene}` 占位符。

**新增 IPC 通道：**

| 通道名 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `ai:generateDynamicScenePrompts` | `{ naturalLanguageInput: string; baseTraits?: string }` | `Promise<{ success: boolean; clothing?: string; pose?: string; scene?: string; error?: string }>` | 自然语言 → 三组英文 SD tag |

**修改文件清单（Task 3）：**
- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 在 `registerCharacterTraitAIHandlers()` 内注册新 handler，复用现有 try/catch + `error.message ?? 'Unknown error'` 兜底模式（实际为 `error instanceof Error ? error.message : 'Unknown error'`，与 `generateCharacterTraits` / `recognizeImageTraits` 一致）。日志前缀沿用 `[CharacterTraitAIHandler]`（service 内部使用 `[DynamicSceneAI]` 前缀以区分方法）。
- `src/main/ipc/index.ts` — 无代码改动，仅更新注释，说明 `registerCharacterTraitAIHandlers()` 已涵盖三个通道（`generateCharacterTraits` / `recognizeImageTraits` / `generateDynamicScenePrompts`）。
- `src/main/preload.ts` — 在 `ai:` 命名空间内 `recognizeImageTraits` 之后追加 `generateDynamicScenePrompts` 方法，沿用内联类型签名（与 `generateCharacterTraits` / `recognizeImageTraits` 一致，不引入主进程类型）。
- `src/renderer/types/electron.d.ts` — 在 `ai:` 接口内 `recognizeImageTraits` 之后追加 `generateDynamicScenePrompts` 类型声明，内联入参与返回值类型（与现有 ai 命名空间下其他方法保持一致）。

**类型声明策略：**

主进程 `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 定义于 `src/main/services/characterTraitAIService.ts`，但渲染进程不直接引用主进程类型（与 `electron.d.ts` 顶部注释「主进程类型不可直接被渲染进程引用」一致）。因此 `preload.ts` 与 `electron.d.ts` 均使用内联类型签名，与现有 `generateCharacterTraits` / `recognizeImageTraits` 保持一致。若未来需要类型共享，可考虑将 params/result 类型移至 `src/shared/types/characterTrait.types.ts`（Spec 已为 `DynamicScenePrompt` 数据模型建立此路径），但 Task 3 不强制做此重构。

**错误兜底（与 generateCharacterTraits 一致）：**
- 空输入：`naturalLanguageInput` 为空或纯空白 → 「请输入动态场景指令」（不调用 LLM，由 service 短路返回）
- AI 引擎未配置：baseUrl / apiKey / modelName / temperature / max_tokens 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」（service 兜底）
- 调用失败：网络 / 超时 / HTTP 错误 → 「AI 调用失败：<具体原因>」
- 解析失败：LLM 返回空内容 / 无分隔符 / 无法识别三组 tag → 「AI 返回内容无法解析为动态场景 tag」
- IPC 序列化兜底：handler 外层 try/catch 保证渲染进程永不收到 reject

## 动态场景提示词 store 扩展（Spec: add-dynamic-scene-prompt-generation / Task 5）

> 2026-08-05 实施：在 `src/renderer/stores/characterTraitStore.ts`（v2 Zustand store）新增 `dynamicScenePrompts` / `activeDynamicScenePromptId` 两个 state 字段与 4 个管理 action，使前端可在不修改基础特征 `traits` 的情况下保存/切换/编辑/删除一次性服装/动作/场景提示词方案。Task 1 扩展 `CharacterTraitManifestV2` 类型后引入的 TS2739（v2 manifest 构造缺失两新字段）在本次一并修复。

### 新增 state 字段

| 字段 | 类型 | 初始值 | 说明 |
| --- | --- | --- | --- |
| `dynamicScenePrompts` | `DynamicScenePrompt[]` | `[]` | 动态场景方案列表，与基础特征 `traits` 分离存储 |
| `activeDynamicScenePromptId` | `string \| null` | `null` | 当前激活动态场景方案 ID；null 表示无激活方案（生成回退到无动态场景状态） |

初始值与 service 层 `emptyV2Manifest` / v1→v2 迁移兜底保持一致（`[]` / `null`）。

### `loadTraits` / `saveTraits` 字段透传

- **`loadTraits`**：仍调用 `window.electronAPI.characterTrait.loadData` 一次性获取完整 v2 manifest，新增从 manifest 提取 `dynamicScenePrompts`（`Array.isArray` 兜底 `[]`）与 `activeDynamicScenePromptId`（`typeof === 'string'` 兜底 `null`）并 `set`；IPC 不可用兜底 `set` 同步补 `[]` / `null`。
- **`saveTraits`**：
  - **签名变更**：`saveTraits(characterCardId?: string, appearanceDescription?: string)` — 第一个参数改为可选，缺省取 `get().currentCharacterCardId`，供动态场景 action 链式调用 `get().saveTraits()` 无需传参。原有调用方 `AssetManagerModal.tsx` 的 `saveTraits(characterCardId, editingDescription)` 调用向后兼容。
  - **v2 manifest 构造修复（TS2739）**：原 `data: CharacterTraitManifestV2 = { ... }` 缺失 `dynamicScenePrompts` / `activeDynamicScenePromptId`（Task 1 扩展类型后报 TS2739），现补全这两字段，从当前 store state 读取。
  - **失败回滚扩展**：`prevDynamicScenePrompts` / `prevActiveDynamicScenePromptId` 加入回滚 `set`，保证本地 state 与磁盘一致。

### 4 个新增 action

| Action | 签名 | 行为 | 持久化 |
| --- | --- | --- | --- |
| `saveDynamicScenePrompt` | `(name, clothing, pose, scene, sourceCommand) => Promise<{success, error?}>` | 用 `genTraitId()` 创建 `DynamicScenePrompt`（`createdAt` / `updatedAt` = `Date.now()`），追加到 `dynamicScenePrompts`，**自动设 `activeDynamicScenePromptId` 为新 id**（Spec Scenario: 「保存为方案并自动激活」） | 立即调用 `get().saveTraits()` |
| `applyDynamicScenePrompt` | `(id) => Promise<{success, error?}>` | 设 `activeDynamicScenePromptId` 为给定 id；id 不在列表中或已是激活方案则 no-op | 立即调用 `get().saveTraits()` |
| `updateDynamicScenePrompt` | `(id, updates: Partial<Omit<DynamicScenePrompt, 'id'\|'createdAt'>>) => Promise<{success, error?}>` | 合并 `updates`（`id` / `createdAt` 不可改，显式覆写防蛇足），bump `updatedAt`；id 不存在则 no-op | 立即调用 `get().saveTraits()` |
| `deleteDynamicScenePrompt` | `(id) => Promise<{success, error?}>` | 从 `dynamicScenePrompts` 移除；**若删除的是激活方案，重置 `activeDynamicScenePromptId = null`**（Spec Scenario）；id 不存在则 no-op | 立即调用 `get().saveTraits()` |

**与组合方案（combinations）action 的差异**：
- 组合方案 action（`saveCombination` / `applyCombination` / `deleteCombination`）仅修改本地 state，持久化由调用方在「保存」按钮点击时统一调用 `saveTraits`。
- 动态场景方案 action 修改本地 state 后**立即**调用 `get().saveTraits()` 持久化，因 Spec 明确要求「并持久化到角色卡的 traits.json」（即时持久化语义）。
- 两者均复用同一 `saveTraits`（写入完整 v2 manifest），无需新增 IPC 通道。

**防御性设计**：所有 action 对无效 `id` 参数静默 no-op（不抛异常），与 `removeTrait` / `applyCombination` 的防御模式一致。

### 修改文件清单（Task 5）

- `src/renderer/stores/characterTraitStore.ts` — 新增 `DynamicScenePrompt` 类型导入；state 接口 + 初始 state 新增 2 字段；`loadTraits` / `saveTraits` / `clear` 扩展新字段；新增 4 个动态场景 action；`saveTraits` 签名 `characterCardId` 改可选（向后兼容）；修复 v2 manifest 构造 TS2739。
- `.trae/specs/add-dynamic-scene-prompt-generation/tasks.md` — Task 5 全部子任务标记 `[x]`。

### 验证

- `npx tsc --noEmit` — `characterTraitStore.ts` 零错误（原 1 个 TS2739 已修复），消费方 `AssetManagerModal.tsx` / `AssetGenerateModal.tsx` / `ExpressionGenerateModal.tsx` 均零错误，无新增错误引入。

## 动态场景指令 UI 区域（Spec: add-dynamic-scene-prompt-generation / Task 6）

> 2026-08-05 实施：在 `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 组件底部新增「动态场景指令」折叠面板，串联 Task 3（IPC）与 Task 5（store）的能力，让用户通过自然语言指令一键生成服装/动作/场景三组 SD tag，编辑预览后保存为命名方案，并在生成图片时自动携带。

### 面板位置与视觉

- 位于 `CharacterTraitTabContent` 主体内容区，**在特征分类 Collapse + 底部添加区之后、角色外观描述之前**（Spec: 「after the existing trait category panels but before any footer」）。
- 使用独立 `<Collapse defaultActiveKey={[]}>`（**默认折叠**，与特征分类面板默认展开形成对比），items 数组单 panel。
- 紫色边框 `rgba(139, 92, 246, 0.35)` + 标题色 `#a78bfa` 区分于特征分类面板（蓝色 `--primary-color`），`ThunderboltOutlined` 图标 + 副标题「AI 解析自然语言为服装 / 动作 / 场景提示词，独立于基础特征」。

### 面板内部结构（自上而下）

1. **NL 输入 + AI 解析按钮**（SubTask 6.2）
   - `Input.TextArea` autoSize `{ minRows: 2, maxRows: 4 }`，placeholder 给出哥特公路示例。
   - 「AI 解析」`Button` 紫色渐变（`#8b5cf6` → `#6366f1`），`ThunderboltOutlined` 图标，`loading={parsing}`。
   - 点击校验非空（`message.warning('请输入动态场景指令')`），调 `window.electronAPI.ai.generateDynamicScenePrompts({ naturalLanguageInput, baseTraits })`，`baseTraits` 取 `baseTraitsText`（enabled 特征 `text` 逗号拼接）；成功填 `parsedClothing/pose/scene`，失败 `message.error(result.error || 'AI 解析失败')`。

2. **三组可编辑 TextArea**（SubTask 6.3）
   - 「服装 (clothing)」标签色 `#60a5fa`（蓝），「动作 (pose)」`#52c41a`（绿），「场景 (scene)」`#f59e0b`（橙），与现有视觉约定一致。
   - 每组 `Input.TextArea` autoSize `{ minRows: 1, maxRows: 3 }`，`value` 绑定 `parsedClothing / parsedPose / parsedScene`，`onChange` 更新本地 state，允许用户覆盖 AI 原始结果（Spec Scenario: 手动编辑解析结果）。

3. **完整提示词预览**（SubTask 6.4）
   - `Input.TextArea readOnly` + `fontFamily: 'monospace'`，`value` = `fullPromptPreview`（`useMemo` 派生：`[baseTraitsText, parsedClothing.trim(), parsedPose.trim(), parsedScene.trim()].filter(Boolean).join(', ')`），随三组 TextArea 编辑实时更新。

4. **保存 / 切换 / 删除**（SubTask 6.5）
   - 方案名 `Input`（placeholder「方案名，如：哥特公路」，回车触发保存）+「保存为方案」`Button`（`SaveOutlined`，紫色渐变）。
   - 已保存方案 `Select`（`value={activeDynamicScenePromptId ?? undefined}`，placeholder「未激活」，`options` 来自 `dynamicScenePrompts`），切换调用 `applyDynamicScenePrompt(id)`。
   - 「删除」`Button`（`DeleteOutlined`，danger，`disabled={!activeDynamicScenePromptId}`），`Modal.confirm` 二次确认后调 `deleteDynamicScenePrompt(activeDynamicScenePromptId)`。

### 本地 state（`useState`）

| State | 类型 | 用途 |
| --- | --- | --- |
| `dynamicInput` | `string` | NL 输入 TextArea 值 |
| `parsedClothing` / `parsedPose` / `parsedScene` | `string` | 三组可编辑 tag（AI 解析结果或方案同步值） |
| `parsing` | `boolean` | AI 解析中标志（按钮 loading） |
| `schemeName` | `string` | 保存方案名输入 |

### Store 订阅（`useCharacterTraitStore`）

新增订阅：`dynamicScenePrompts` / `activeDynamicScenePromptId` / `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `deleteDynamicScenePrompt`。

> **未订阅 `updateDynamicScenePrompt`**：当前 UI 无「更新现有方案」入口（保存始终创建新方案），订阅会造成 `noUnusedLocals` 报错。`tsconfig.json` 开启 `noUnusedLocals: true`，故仅订阅实际使用的 5 项（2 state + 3 action）。

### 激活方案同步（useEffect）

```ts
useEffect(() => {
  if (!activeDynamicScenePromptId) return;
  const scheme = dynamicScenePrompts.find((p) => p.id === activeDynamicScenePromptId);
  if (scheme) {
    setParsedClothing(scheme.clothing || '');
    setParsedPose(scheme.pose || '');
    setParsedScene(scheme.scene || '');
  }
}, [activeDynamicScenePromptId, dynamicScenePrompts]);
```

- Spec Scenario「切换激活的动态场景方案」：用户从下拉切换方案 → `applyDynamicScenePrompt` 改 `activeDynamicScenePromptId` → useEffect 触发 → 三组 TextArea 加载方案内容。
- 保存新方案时 store 自动激活 → useEffect 同步 parsed 字段为新方案内容（保存 handler 中 `setDynamicInput('')` / `setSchemeName('')` 清空输入，parsed 字段交由 useEffect 同步）。
- 无激活方案（null）时不强制清空，保留用户当前编辑或 AI 解析结果。

### 派生数据（`useMemo`）

- `baseTraitsText`：`traits.filter(t => t.enabled).map(t => t.text).join(', ')` — 用于 IPC `baseTraits` 参数 + 完整预览。
- `fullPromptPreview`：`[baseTraitsText, parsedClothing.trim(), parsedPose.trim(), parsedScene.trim()].filter(Boolean).join(', ')` — 跳过空值后逗号拼接。

### 修改文件清单（Task 6）

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `CharacterTraitTabContent` 组件：
  - store 订阅追加 5 项（2 state + 3 action）
  - 新增 6 个 `useState`（dynamicInput / parsedClothing / parsedPose / parsedScene / parsing / schemeName）
  - 新增 2 个 `useMemo`（baseTraitsText / fullPromptPreview）
  - 新增 1 个 `useEffect`（激活方案同步）
  - 新增 4 个 `useCallback` handler（handleParseDynamicScene / handleSaveDynamicScene / handleApplyDynamicScene / handleDeleteDynamicScene）
  - 新增 1 个 `<Collapse>` 面板 JSX（底部添加区之后、外观描述之前）
- 无新增依赖：所有 `antd` / `@ant-design/icons` / store 引用均来自文件现有 import。

### 验证

- `npx tsc --noEmit` — `AssetManagerModal.tsx` 零错误（与改动前一致），全项目仅 1 个无关的 `WatchOptions` 错误（vite.config.ts，与本次改动无关）。
- `noUnusedLocals` 通过：所有新增 state / handler / 订阅均在 JSX 或其他 handler 中被消费。

---

## 素材/特征/动态场景缺陷修复（Spec: fix-asset-trait-and-scene-defects / Task 1-9）

### 概述

修复近期完成的三个 spec（`add-asset-and-trait-management` / `add-trait-category-grouping` / `add-dynamic-scene-prompt-generation`）引入的三类缺陷：

1. **三视图与高分辨率生成**：裸体版三视图 nude tag 列表不完整；分辨率 ≥ 1024×1024 时 SD 模型倾向生成多个角色，缺少 `1girl`/`1boy` 人物数量约束
2. **角色特征分类系统**：自定义分类按角色卡独立存储，**跨角色卡不共享**；AI 生成特征时系统提示词硬编码 7 个系统分类，**不包含用户自定义分类**，导致 AI 不会为新建分类生成对应 tag
3. **动态场景指令**：`AssetGenerateModal` 缺少动态场景方案选择 UI，用户必须返回 `AssetManagerModal` 激活方案

详细修复记录与重点标记的 bug 见 `docs/FIX_RECORDS.md` §5.1 ~ §5.6。

### 架构变更概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 新增模块（Task 3）                                              │
│  src/main/services/categoryDictionaryService.ts                  │
│   ├─ loadDictionary() / saveDictionary()                         │
│   ├─ addCategory(name) / deleteCategory(id) / renameCategory()  │
│   ├─ hasCategory(name)                                          │
│   └─ migrateFromManifest(customCategories) — 既有数据迁移        │
│  src/main/ipc/handlers/categoryDictionaryHandlers.ts             │
│   └─ 注册 5 个 IPC 通道                                          │
├─────────────────────────────────────────────────────────────────┤
│ 修改模块（Task 1 / 2 / 4 / 5 / 6 / 7）                          │
│  PromptBuilder.ts — NUDE_FIXED_TAGS 常量 + three-view 模板       │
│  AssetGenerateModal.tsx — detectGenderTag + 动态场景 Select     │
│  sdGenerationService.ts — characterGenderTag 字段 + 注入逻辑     │
│  characterTraitAIService.ts — 动态构建 system prompt             │
│  characterTraitStore.ts — globalCategories state + 异步 actions  │
│  characterTraitService.ts — loadTraitData 迁移逻辑               │
│  AssetManagerModal.tsx — 订阅 + CRUD handler 适配                 │
└─────────────────────────────────────────────────────────────────┘
```

### 新增 IPC 命名空间：`category-dictionary`

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `category-dictionary:load` | 无 | `{ ok, dictionary?, error? }` | 加载全局分类字典 |
| `category-dictionary:add` | `{ name, icon? }` | `{ ok, category?, error? }` | 新增分类（按 name 去重） |
| `category-dictionary:delete` | `{ id }` | `{ ok, error? }` | 删除分类 |
| `category-dictionary:rename` | `{ id, newName }` | `{ ok, category?, error? }` | 重命名分类 |
| `category-dictionary:has` | `{ name }` | `{ ok, has? }` | 检查分类名是否存在 |

在 `src/main/ipc/index.ts` 注册 `registerCategoryDictionaryHandlers()`；`preload.ts` 暴露 `window.electronAPI.categoryDictionary.*` 方法；`electron.d.ts` 补全类型声明。

### 新增服务表条目：`categoryDictionaryService`

**职责**：管理全局自定义分类字典，跨角色卡共享、重启后保留
**持久化路径**：`{userData}/data/trait-categories.json`
**数据结构**：`GlobalTraitCategoryDictionary = { version: 1, categories: TraitCategory[], updatedAt: number }`
**关键方法**：
- `loadDictionary()` — 文件不存在时返回空字典（`categories: []`）
- `addCategory(name, icon?)` — 按 name 大小写不敏感去重，返回新分类
- `deleteCategory(id)` / `renameCategory(id, newName)` — 按 id 操作
- `hasCategory(name)` — 大小写不敏感检查
- `migrateFromManifest(customCategories)` — 将角色卡旧 `customCategories` 字段合并到全局字典（幂等，按 name 去重，全部已存在时不写盘）

### 新增 store state：`characterTraitStore.globalCategories`

| 字段 | 类型 | 初始值 | 说明 |
|---|---|---|---|
| `globalCategories` | `TraitCategory[]` | `[]` | 全局自定义分类（替代从 manifest 读取 `customCategories`） |

**新增异步 actions**：
- `createCategory(name): Promise<{success, error?}>` — 调用 `categoryDictionary.add` IPC + 更新 `globalCategories` state
- `renameCategory(id, newName): Promise<{success, error?}>` — 调用 IPC + 更新 state
- `deleteCategory(id): Promise<{success, error?}>` — 调用 IPC + 更新 state + 受影响特征回退 `uncategorized` + 调用 `saveTraits` 持久化 traits 变更

**`loadTraits` 改造**：调用 `categoryDictionary.load()` 填充 `globalCategories`，不再从 manifest 读取 `customCategories`。
**`saveTraits` 改造**：不再写入 `customCategories` 字段（保留旧值以兼容）。
**`moveTrait` 改造**：校验目标分类改为读 `globalCategories`。
**`clear` 改造**：重置 `globalCategories: []`。

### 新增共享类型：`GlobalTraitCategoryDictionary`

```typescript
// src/shared/types/characterTrait.types.ts
export interface GlobalTraitCategoryDictionary {
  version: 1;
  categories: TraitCategory[];
  updatedAt: number;
}
```

### 三视图与高分辨率约束（Task 1 + Task 2）

**Task 1 — 裸体版三视图固定 nude tag**（`PromptBuilder.ts`）：

```typescript
export const NUDE_FIXED_TAGS: readonly string[] = [
  'nude', 'naked', 'bare skin', 'completely naked', 'no clothes', 'nsfw',
];
```

`buildAssetPromptTemplate` 的 three-view 模板对 `*-nude` 槽位（`front-nude` / `side-nude` / `back-nude`）拼接 `NUDE_FIXED_TAGS.join(', ')`，穿衣版不拼接。

**Task 2 — 高分辨率人物数量约束**：

| 文件 | 改动 |
|---|---|
| `AssetGenerateModal.tsx` | 新增 `detectGenderTag(traits)` 工具函数（从 `categoryId='basic'` 推断性别）；`buildSdOptions` 在 `width * height >= 1024 * 1024` 时填充 `characterGenderTag` |
| `sdGenerationService.ts` | `SDGenerationOptions` 新增 `characterGenderTag?: string` 字段；`applyTraitsAndLora` 在 `{traits}` 替换后注入 `characterGenderTag`（双重重复防护） |

**性别推断优先级**：`1girl` > `1boy` > `female` > `male` > `girl` > `boy`，无法判断时不注入（避免错误约束）+ 记录 `console.warn` 警告。

### 动态场景选择 UI（Task 6 + Task 7）

**Task 6 — 新增动态场景下拉**（`AssetGenerateModal.tsx` `renderSingleMode`）：

- 补订阅 `applyDynamicScenePrompt` action
- 在生成参数面板中新增 `<Select>` 下拉：
  - `value` = `activeDynamicScenePromptId ?? undefined`
  - `onChange` 调用 `applyDynamicScenePrompt(id)`
  - `options` 来自 `dynamicScenePrompts.map(p => ({ label: p.name, value: p.id }))`
  - 空状态：`disabled` + `notFoundContent` = 「暂无动态场景方案，请在素材管理中添加」

**Task 7 — 移除 userScene 文本输入框**：
- 移除 `renderSingleMode` 中 `mode === 'general'` 条件下的 `userScene` `<Input>` UI 元素
- 保留 `userScene` state（默认 `''`）+ `@deprecated` JSDoc 标记，仅作 `buildAssetPromptTemplate` 兼容参数
- `buildSdOptions` 移除「无动态 scene 时回退 userScene」分支，改为 general 模式无激活方案时 `dynamicScene = undefined`（`{scene}` 替换为空字符串）

### AI 提示词动态构建（Task 5）

**`characterTraitAIService.ts` 修复双端缺陷**：

1. **提示词端** — 新增动态构建方法：
   - `buildDynamicTraitSystemPrompt(globalCategories: TraitCategory[]): string`（中文 prompt）
   - `buildDynamicImageTraitSystemPrompt(globalCategories: TraitCategory[]): string`（英文 prompt）
   - 合并 `[...SYSTEM_TRAIT_CATEGORIES, ...globalCategories]`，自定义分类标注「（自定义分类）」
   - 原 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 改为 `export` 基线参考

2. **解析器端** — `parseTraitsFromContent` 扩展 `validCategoryIds`：
   ```typescript
   const globalCategories = categoryDictionaryService.loadDictionary().categories;
   const validCategoryIds = new Set([
     ...SYSTEM_TRAIT_CATEGORIES.map(c => c.id),
     ...globalCategories.map(c => c.id),
   ]);
   ```

3. **调用点** — `generateCharacterTraits` / `recognizeImageTraits` 构建 messages 前调用 `categoryDictionaryService.loadDictionary()` 读取全局分类，传入动态构建方法。

4. **下游同步（§5.7 修复）** — `characterTraitStore.setTraits` 的 `validCategoryIds` 同步合并 `get().globalCategories`，避免解析器正确产出 `{ categoryId: 'weapon' }` 后在 store 二次校验时被兜底为 `uncategorized`；`AssetGenerateModal.renderTraitsPanel` 的 `allCategories` 派生改用 `traitGlobalCategories`（替代旧字段 `traitCustomCategories`），使「携带角色特征」面板正确显示自定义分类折叠面板。详见 `docs/FIX_RECORDS.md` §5.7。

### 既有数据迁移（Task 4）

**`characterTraitService.loadTraitData` v2 分支**：当 manifest 含非空 `customCategories` 时调用 `migrateFromManifest(customCategories)` 合并到全局字典。

- 迁移幂等：按 name 大小写不敏感去重，多次调用结果一致
- 迁移失败不阻塞特征加载（catch 兜底，仅记录 warn 日志）
- 迁移后 manifest 的 `customCategories` 字段不再作为读取源，但保留以兼容旧文件读取

### 涉及文件清单

**新增文件（3 个）**：
- `src/main/services/categoryDictionaryService.ts` — 全局分类字典服务
- `src/main/ipc/handlers/categoryDictionaryHandlers.ts` — IPC handlers
- `src/shared/types/characterTrait.types.ts` 内新增 `GlobalTraitCategoryDictionary` 接口（非新文件）

**修改文件（10 个）**：
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `NUDE_FIXED_TAGS` 常量 + three-view 模板 + `userScene` `@deprecated`
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `detectGenderTag` + 高分辨率检测 + 动态场景 `<Select>` 下拉 + 移除 userScene Input UI
- `src/main/services/sdGenerationService.ts` — `characterGenderTag?: string` 字段 + `applyTraitsAndLora` 注入逻辑
- `src/main/services/characterTraitAIService.ts` — `buildDynamicTraitSystemPrompt` / `buildDynamicImageTraitSystemPrompt` + `parseTraitsFromContent` 扩展 `validCategoryIds`
- `src/main/services/characterTraitService.ts` — `loadTraitData` 新增迁移逻辑
- `src/renderer/stores/characterTraitStore.ts` — `globalCategories` state + 异步 actions + `moveTrait` / `clear` 更新
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 订阅 + CRUD handler 适配
- `src/main/ipc/index.ts` — 注册 `registerCategoryDictionaryHandlers()`
- `src/main/preload.ts` — 暴露 `categoryDictionary` 命名空间
- `src/renderer/types/electron.d.ts` — 补全 `categoryDictionary` 类型声明

### 验证总结

- **Task 8 端到端静态验证（PASS）**：illustration / general / three-view 三种模式下 `{clothing}` / `{pose}` / `{scene}` 占位符替换正确；无激活方案兜底正确；空逗号清理 do-while 循环正常工作
- **Task 9.1 tsc 验证（PASS）**：所有 spec 修改文件零新增错误；项目预存在错误（`ipcMain` unused / `off` 方法类型 / `writing/PromptBuilder.ts` unused imports / `CharacterDialogueChat/PromptBuilder.ts:703` `parseMesExample` 类型收窄）与本次修改无关
- **Task 9.2 端到端流程（静态 PASS，运行时验证推迟到 Electron 集成测试）**：三视图 nude tag / 高分辨率 1girl 注入 / 自定义分类跨角色 / 动态场景选择 → 生成
- **Task 9.3 既有数据迁移（静态 PASS，运行时验证推迟到 Electron 集成测试）**：`migrateFromManifest` 幂等性 + 失败兜底 + 全局字典写盘
