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
