# Code Wiki

> 本文件记录项目核心架构与功能模块的技术文档。
> 注意：原文件内容因磁盘异常全部丢失（全为 null 字节），本文件由 2026-08-01 的 spec `add-agent-and-skill-user-management` 重建，仅包含本次新增功能的文档。历史章节请参考 git 历史记录。

---

## 安卓 LAN 对话客户端与服务端 LAN API（Spec: add-android-chat-client，2026-08-19）

### 概述

在 Electron 主进程内嵌 LAN HTTP API 服务（供同一 WiFi 的安卓纯客户端访问），并新建 React Native 安卓客户端 `android-client/`。V1 范围：角色卡列表/搜索/刷新 + SSE 流式对话 + 情绪立绘切换 + 清空上下文。对话历史与桌面端共用同一存储（TestChatData），两端同源。客户端无任何功能配置（模型/提示词/参数全由服务端决定），仅保存服务器地址。

### 架构分层

```
Android 客户端（android-client/, RN 0.87 + paper/zustand/react-native-sse）
  ConnectScreen（地址输入 + /api/health 测试 + 自动重连）
  CharacterListScreen（卡片列表 + 搜索 + 下拉刷新）
  ChatScreen（历史加载 + SSE 流式气泡 + 立绘切换 + 清空/重试）
        │  http://<电脑IP>:8787（明文 HTTP，仅局域网）
        ▼
Electron 主进程 src/main/services/lanApiServer/
  server.ts   Node http 极简路由：/api/health|characters|chats…；:id 白名单校验（防路径穿越）；SSE 封装
  dialogue.ts headless 对话管线：复用渲染进程 PromptBuilder（纯 TS）组装提示词 →
              读服务端 AI 引擎配置流式调用（对齐 ChatEngine/aiHandlers 超时策略）→
              StreamSanitizer 增量剥离 <think>/表情标记 → parseExpressionFromContent 解析情绪 →
              chatStorageService 持久化（失败不写入 assistant）
        │  复用（只读）
        ▼
characterService / expressionService / chatStorageService / storageService
```

### 关键设计

- **生命周期**：`src/main/index.ts` `whenReady` 调 `startLanApiServer()`（绑定 `0.0.0.0`，默认 8787；设置 `lanApi.{enabled,port}` 可控），`before-quit` 调 `stopLanApiServer()`。
- **路径安全（R6）**：`resolveCharacterPath()` 将 `:id` 与角色卡目录 `readdir` 结果精确匹配，含 `/`、`\`、`..` 或不在目录内一律 404 `CHARACTER_NOT_FOUND`，不泄露文件系统信息；情绪键白名单 `/^[a-z][a-z0-9_]*$/`。
- **SSE 协议**：POST `/api/chats/:id/messages` → 事件 `chunk`（增量文本，已剥离标记）→ 至多一个 `emotion` → 一个 `done`（权威全文 + messageId）；失败推 `error` 且不写库；15s `: ping` 注释心跳。
- **客户端防重复发送**：react-native-sse 具备 EventSource 自动重连语义，`src/api/sse.ts` 在 done/error 后立即 `close()`，任何后续事件被 `finished` 闸门忽略。
- **明文 HTTP**：`android/app/build.gradle` `manifestPlaceholders = [usesCleartextTraffic: true]`（LAN http 必需，debug/release 均生效）。

### 涉及文件

| 文件 | 说明 |
|---|---|
| `src/main/services/lanApiServer/server.ts` | LAN HTTP 服务与路由（新增） |
| `src/main/services/lanApiServer/dialogue.ts` | headless 对话管线（新增） |
| `src/main/index.ts` | 启动/停止 LAN API（修改） |
| `android-client/src/api/client.ts` | 5s 超时、幂等 GET 重试 1 次、错误四分类（新增） |
| `android-client/src/api/sse.ts` | SSE 封装与防重连（新增） |
| `android-client/src/screens/*.tsx` | 连接/列表/对话三屏（新增） |
| `docs/android-client.md` | 构建、API 说明（含 SSE 协议示例）、调试指南 |

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

- `buildAssetPromptTemplate(mode, targetSlot)` 按模式构建正面提示词模板，均含 `{traits}` 占位符：
  - **【Spec: add-dynamic-scene-prompt-generation / Task 7】** 函数已从 `AssetGenerateModal.tsx` 迁移至 `PromptBuilder.ts`（导出），与其它 `build*` 工具函数集中管理。**【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 5】** illustration / general 模板移除 `{clothing}` / `{pose}` / `{scene}` 动态场景占位符，特征内容统一通过 `{traits}` 占位符注入；`userScene` 参数及 fallback 逻辑同步移除。
  - **【2026-08-06 视角镜头 + 模式默认值重构】** illustration / general / 表情（SDXL）模板含 `{camera}` 占位符，由 `CameraAngleSelector` 的 4 个独立下拉（镜头距离 / 垂直角度 / 水平视角 / 特殊构图，各选 1 个）拼接填充。详见 docs/FIX_RECORDS.md §5.9
    - **移除写死视角 tag**：立绘移除 `full_body`、表情移除 `portrait` + `looking_at_viewer`，改为弹窗打开时按模式初始化默认值（`getCameraDefaultForMode`）：立绘=`full_body`，表情=`portrait, looking_at_viewer`，一般图像=无默认。避免「写死 tag + 用户选同类 tag」冲突（如 full_body + close-up 自相矛盾）
    - three-view 模板不含 `{camera}`（视角由 targetSlot 程序化决定 front/side/back），下拉不渲染
  - illustration：`{camera}, {traits}, high quality, best quality, masterpiece`（**【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 5】** 移除 `{pose}` / `{clothing}` / `{scene}` 动态场景占位符，特征内容统一通过 `{traits}` 注入；**【2026-08-06 重构】** 移除写死 `full_body` → `{camera}` 默认值注入；**【2026-08-06 标签库审计】** 所有 tag 改为 Danbooru 标准下划线格式，详见 docs/FIX_RECORDS.md §5.11）
  - general：`{traits}, {camera}, high quality, best quality`（**【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 5】** 移除 `{clothing}` / `{pose}` / `{scene}` 占位符；`{camera}` 无默认值，用户自由选）
  - three-view：`{viewName}_view, full_body, solo, {traits}{nudeTags}, white_background, high quality`（**【2026-08-06 重点标记 - 三视图多角色 bug 修复】** 移除 `character sheet`（Danbooru 训练数据中天然指多视角合集图，导致一张三视图出现多角色/多视角 collage），改为 `solo` 强化单角色；配合负面提示词追加多角色约束。详见 docs/FIX_RECORDS.md §5.10；**【2026-08-06 标签库审计】** tag 改为下划线格式，详见 §5.11）
  - 表情（SDXL，`buildExpressionGenerationPrompt` 默认模板）：`{camera}, {traits}, simple_background, {emotion}, high quality, best quality, masterpiece, detailed face`（**【2026-08-06 重构】** 移除写死 `portrait` + `looking_at_viewer` → `{camera}` 默认值 `portrait, looking_at_viewer` 注入；`{camera}` 由下游 `applyTraitsAndLora` 替换，本函数仅替换 `{traits}` / `{emotion}`；**【2026-08-06 标签库审计】** tag 改为下划线格式）
- `{traits}` / `{camera}` / `{gender}` 占位符 + LoRA 标签由 `sdGenerationService.applyTraitsAndLora` 统一处理，`generateExpression`（img2img 路径）与 `generateTxt2Img`（txt2img 路径）均调用该方法：
  - 读取 `options.characterTraits` 过滤空字符串后拼接为逗号分隔串替换 `{traits}`（空则替换为空串并清理多余逗号）。⚠️ **【2026-08-07 去重修复】** 拼接前对 text 做大小写不敏感去重（`Set` + `toLowerCase()` key，保留首次出现），防止重复 tag（如两个 `dog_girl`）导致 SD 多次加权影响生成质量。重复时 `console.warn` 输出去重前后数量。详见 docs/FIX_RECORDS.md §7.23 §9
  - **【Spec: add-sdxl-prompt-weight-support / Task 2 — 权重格式化】** 当 `characterTraits[i].weight` 不为 1.0 / `undefined` 时，将 tag 格式化为 `(text:weight)` 语法（如 `(blue_eyes:1.5)`，冒号两侧无空格，兼容 Forge Neo lark 解析器 `modules/prompt_parser.py` 的 `:\s*([+-]?[.\d]+)\s*\)` 规则）；默认权重（1.0 / undefined）tag 保持原样不加括号。`Math.round(weight * 10) / 10` 保留 1 位小数精度避免浮点误差。**去重 key 仍为 `text.toLowerCase()`（不含括号）**，保证 `blue_eyes` 与 `(blue_eyes:1.5)` 不会被识别为不同 tag；保留首次出现项的 weight 设置。详见 docs/FIX_RECORDS.md §7.24
  - **【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 4】** 移除 `{clothing}` / `{pose}` / `{scene}` 占位符替换逻辑及 `options.dynamicClothing` / `dynamicPose` / `dynamicScene` 字段读取（动态场景方案已移除，特征内容统一通过 `{traits}` 注入）。
  - 读取 `options.dynamicCamera` 替换 `{camera}` 占位符（**2026-08-06 新增**，来自 `AssetGenerateModal` 视角镜头下拉选择（含模式默认值）；空则替换为空串并清理多余逗号；illustration / general / 表情（SDXL）模板含此占位符）
  - 读取 `options.selectedLoras`（角色专属 LoRA，按角色独立存储，杜绝跨角色污染）注入 LoRA 标签
- `buildSdOptions()` 透传 `characterTraits` 与 `selectedLoras: characterLoras`，确保两条路径都能准确应用角色特征与 LoRA
  - **【Spec: add-trait-category-grouping v2 升级】** `characterTraits` 由「全部 `string[]`」改为「`traits.filter(t => t.enabled).map(t => t.text)`」——store 持有 `CharacterTraitItem[]`（含 `id` / `text` / `categoryId` / `enabled`），下游仅拼接 `enabled=true` 项的 text，实现跨分类组合选择。覆盖 `AssetGenerateModal`（立绘/一般图像/三视图/single-expression/batch-expression）与 `ExpressionGenerateModal`（表情生成）两条组件路径。
  - **【Spec: add-sdxl-prompt-weight-support / Task 2 — BREAKING 类型升级】** `SDGenerationOptions.characterTraits` 类型由 `string[]` 升级为 `Array<{ text: string; weight?: number }>`，结构化形状携带 per-tag 权重（默认 `undefined` 等价 1.0，范围 0.1-10.0）。**破坏性变更**：所有调用方（`AssetGenerateModal.buildSdOptions` / `ExpressionGenerateModal`）必须从 `string[]` 适配为 `Array<{ text: string; weight?: number }>`，由 `traits.filter(t => t.enabled).map(t => ({ text: t.text, weight: t.weight }))` 产出（`weight` 字段可选，未携带即等价 1.0）。`applyTraitsAndLora` 不再接收 `string[]`，按上述权重格式化规则处理。
  - **【临时编辑支持】** `AssetGenerateModal` 的「携带角色特征」面板支持用户临时编辑/新增/删除（不持久化）：
    - 维护本地工作副本 `editedTraits: CharacterTraitItem[] | null`（弹窗打开时从 store `characterTraits` 深拷贝，关闭时置 null）
    - `effectiveTraits = editedTraits ?? characterTraits` 驱动 `enabledTraitTexts` 派生与 UI 展示
    - **【Spec: optimize-expression-preset-prompts / Task 7】** `enabledTraitTexts` 在表情模式（`single-expression` / `batch-expression`）下额外过滤 `categoryId === 'expression'` 的特征，避免与 `{emotion}` 占位符注入的 `EMOTION_PROMPT_MAP` 表情 tag 重复/冲突。过滤在 `useMemo` 派生层执行（与 `isNudeSlot` 过滤 `top`/`bottom`/`underwear` 衣物分类同模式），确保 `buildSdOptions` / `buildEmotionPrompt` / single-expression 提示词构建器所有下游消费者一致地不携带 expression 分类 tag。`illustration` / `general` / `three-view` 模式不受影响（`isExpressionMode` 为 false 时不过滤）。⚠️ **【2026-08-07 去重修复】** `enabledTraitTexts` 追加 `.filter()` 对 text 做大小写不敏感去重（保留首次出现），从源头防止重复 tag 进入 SD prompt（与 `applyTraitsAndLora` 后端兜底去重构成双层防御，详见 docs/FIX_RECORDS.md §7.23 §9）。
    - 初始化用 `traitStoreCardId === characterCardId` 判断就绪（支持 0 特色角色卡也能初始化为 `[]`）
    - 用户可临时修改 trait 的 `text`（如 `sitting → standing`）、切换 `enabled`、临时删除任意标签、在分类下新增临时标签（`genTraitId()` 生成 id，不写入磁盘）
    - UI 按 `SYSTEM_TRAIT_CATEGORIES + customCategories + UNCATEGORIZED_CATEGORY` 分组折叠展示（所有分类默认展开含空分类），每个 Tag 可点击切换 enabled、点编辑图标进入行内 Input 编辑、点 × 临时删除，分类底部「+ 新增临时标签」可追加临时特征
    - 颜色区分：原始 enabled = purple、已修改 = orange、临时新增 = cyan、disabled = default（灰显）
    - **【Spec: add-ai-tag-chinese-translation / Task 6 + Task 4】** 特征 Tag 用 antd `<Tooltip>` 包裹，`title={trait.translation || ''}`：AI 生成时携带的中文翻译在 hover 时展示，空字符串 title 不弹出（不影响 Tag 点击切换启用 / closable 删除 / 行内编辑）。行内编辑保存新 text 时同步 `translation: undefined`（`handleConfirmEditTrait` 内 `{ ...t, text: trimmed, translation: undefined }`），避免旧翻译与新 tag 不符；临时新增 trait 不带 `translation` 字段（默认 undefined，`handleConfirmAddTrait` 与 `TagAutocomplete.onTagSelect` 两处入口一致）。`Tooltip` 已从 antd 导入（文件顶部 import 块）。
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

原 Spec「AI 集成适配」一节规定 AI 特征生成（Task 13）仍返回扁平 `string[]`、新特征统一落入「未分类」，由用户手动归类（"AI 自动归类为未来增强项，本期不做"）。2026-08-05 实施该「未来增强项」：让 LLM 直接输出 `分类:tag` 形式，解析后携带 `categoryId` 透传到 store，使 AI 生成的特征直接进入对应系统分类（basic / head / body / top / bottom / accessories / underwear / background / pose / expression），无需用户手动归类。

**系统分类体系（11 个，`SYSTEM_TRAIT_CATEGORIES` 常量定义，order 0..10）：**
- `basic` 基本特征（order 0）— 物种/种族（lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf）、性别（female, male, 1girl, 1boy）、内容分级（sfw, nsfw）等角色基底属性，作为整个角色的基底特征置于最前
- `head` 头部特征（order 1）— 发色/发型/瞳色/动物耳朵/帽子等
- `body` 身体特征（order 2）— 体型/肤色/毛色/尾巴/翅膀等（不含物种与性别，已移至 basic）
- `top` 上装（order 3）— 上衣/衬衫/外套/连衣裙/校服等上身衣物（dress/school uniform 等连体衣物归入上装）
- `bottom` 下装（order 4）— 裤子/裙子/短裤等下身衣物
- `accessories` 配饰（order 5）— 眼镜/缎带/首饰/帽子/围巾等装饰物
- `underwear` 内衣（order 6）— 胸罩/内裤/内衣套装等贴身衣物
- `background` 背景环境（order 7）
- `pose` 人物姿势（order 8）
- `expression` 人物表情（order 9）
- `interaction` 互动元素（order 10）— 用户与角色之间的身体接触/肢体动作等交互场景标签，含两种 Danbooru 模式：A) POV 脱离身体风格（`disembodied_hand` + `hand_on_breast` / `disembodied_tongue` + `licking` 等）；B) 双角色互动风格（`hugging_another` / `holding_hands` / `hand_on_another's_*` / `grabbing_another's_*` 等）。与 `pose`（角色自身姿势）语义分离。仅在对话上下文描述互动动作时由 AI 输出，角色卡描述场景不触发。详见 docs/FIX_RECORDS.md §7.35 + CODE_WIKI.md §40
- `uncategorized` 未分类（order 999，迁移兜底，不在 `SYSTEM_TRAIT_CATEGORIES` 数组内）

> `basic` 为 2026-08-05 新增系统分类，置于最前作为角色基底特征容器。物种/性别等基底属性原先归入 `body`，现归入 `basic`；`body` 收缩为体型/肤色/毛色等纯身体特征。详见 docs/FIX_RECORDS.md §4.4。
>
> **【衣物分类拆分（2026-08-09）】** 原 `clothing` 衣物配饰分类已拆分为 `top`/`bottom`/`accessories`/`underwear` 四个细分类，提升 AI 归类精度与裸体三视图过滤准确性（裸体版仅过滤 `top`/`bottom`/`underwear`，保留 `accessories`）。旧数据中 `categoryId='clothing'` 的特征由 `characterTraitService.loadTraitData` 一次性迁移至 `uncategorized`（由用户手动重新归类）。详见 docs/FIX_RECORDS.md §7.29。
>
> **【互动元素分类新增（2026-08-09，Spec: enhance-conversation-interaction-prompt-recognition）】** 新增 `interaction` 系统分类（order 10），专门承载对话上下文中用户与角色动作互动的 Danbooru 标签。与 `pose` 语义分离：`pose` 是角色自身的姿态（如 `sitting` / `standing`），`interaction` 是与另一个实体的交互（如 `disembodied_hand` / `hugging_another`）。互动标签分两种模式：模式 A（POV/脱离身体风格，第一人称描述触发）输出 `disembodied_*` + 配合部位标签；模式 B（双角色互动风格，第三人称或两角色互动描述触发）输出 `*_another` 系列标签。关键原则：互动元素独立于角色完整形象，允许不生成用户完整角色，仅添加 `disembodied_*` 标签引导 SD 生成交互性质图片。详见 docs/FIX_RECORDS.md §7.35 + CODE_WIKI.md §40。
>
> **【服装状态指令增强（2026-08-09，Spec: add-costume-state-prompt-directives）】** `interaction` 分类现在也承载服装状态标签（衣物仍在身上但状态改变）。`buildDynamicTraitSystemPrompt` 新增 `buildCostumeStateGuidance()` 指令块，与 `interactionGuidance` 平行，引导 AI 根据对话上下文中的服装变化描述生成 3 类 Danbooru 标签：A) 服装开合状态（`open_clothes` / `open_jacket` / `unbuttoned_shirt` 等）；B) 服装位置变化（`panties_aside` / `shirt_lift` / `skirt_lift` 等）；C) 身体部位暴露（`one_breast_out` / `cleavage` / `navel` 等）。关键原则：服装状态标签描述的是「衣物仍在身上但状态改变」，区别于衣物完全移除（移除用 top/bottom/underwear 分类的删除处理）；开合/位移标签通常需配合暴露标签使用。同时 `generateTraitPrompts` 新增服装状态 RAG 检索（`COSTUME_STATE_RAG_KEYWORDS` 常量），`optimizeTraitsForContext` 的 system prompt 新增服装状态开合/复位的 remove 模式与开合→暴露/位移→暴露的 add 模式。详见下方「服装状态提示词指令增强」章节。

**类型契约变更：**
- 新增共享类型 `CategorizedTrait`（`src/shared/types/characterTrait.types.ts`）：`{ text: string; categoryId: string }`，是 `CharacterTraitItem` 的「无 id / 无 enabled」轻量子集，由 AI 服务产出、store 接收后补全 id 与 enabled。**【Spec: add-sdxl-prompt-weight-support / Task 1 后续扩展】** 现已追加 `translation?` / `originalText?` / `weight?` 三个可选字段，与 `CharacterTraitItem` 同名同语义（`weight` 默认 `undefined` 等价 1.0，详见 docs/FIX_RECORDS.md §7.24）
- `GenerateCharacterTraitsResult.traits` 由 `string[]` 升级为 `CategorizedTrait[]`（`characterTraitAIService.ts`），`generateCharacterTraits` 与 `recognizeImageTraits` 两条路径同步升级
- IPC 通道 `ai:generateCharacterTraits` / `ai:recognizeImageTraits` 返回值类型同步（`preload.ts` / `electron.d.ts`），IPC handler 无结构变化（透传 typed 对象）
- `characterTraitStore.setTraits` 签名由 `(traits: string[])` 升级为 `(traits: CategorizedTrait[])`，MERGE 策略升级（见下）

**LLM Prompt 升级（`characterTraitAIService.ts`）：**
- `CHARACTER_TRAIT_SYSTEM_PROMPT`：原输出 `white fur, dog girl, ...`，现输出 `basic:dog girl, basic:female, head:white hair, ...`，prompt 内嵌 11 个系统分类的语义说明与归类建议（如「物种/种族 → basic」「性别 → basic」「内容分级 → basic」「发色 → head」「瞳色 → head」「上衣/外套/连衣裙 → top」「裤子/裙子 → bottom」「眼镜/首饰/帽子 → accessories」「胸罩/内裤 → underwear」「动物耳朵 → head」「尾巴/翅膀 → body」「用户与角色动作互动 → interaction」）。**【Spec: enhance-conversation-interaction-prompt-recognition】** 现追加 `interaction` 分类的互动元素识别指令块，含模式 A（POV/脱离身体风格 `disembodied_*`）与模式 B（双角色互动风格 `*_another`）的详细标签清单与触发原则，详见 §40
- `IMAGE_TRAIT_SYSTEM_PROMPT`：同步升级为 `category:tag` 英文格式，便于多模态识别结果同样携带分类
- 多模态 `includeImage=true` 分支的内联 system 补充语也同步改为「categorized tags」
- 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复（2026-08-06，Spec: fix-asset-trait-and-scene-defects / Task 5）】上述两个常量现为**基线参考**（`export` 导出，文档化 prompt 结构），生产调用已改为动态构建：`generateCharacterTraits` / `recognizeImageTraits` 在构建 messages 前调用 `categoryDictionaryService.loadDictionary()` 读取全局字典自定义分类，再通过 `buildDynamicTraitSystemPrompt(globalCategories)` / `buildDynamicImageTraitSystemPrompt(globalCategories)` 将系统分类 + 自定义分类合并注入提示词。原硬编码 prompt 仅含系统分类，LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），导致不会为这些分类生成 `tattoo:dragon tattoo` 等带前缀的 tag。详见 docs/FIX_RECORDS.md §5.2

**解析逻辑升级（`parseTraitsFromContent`）：**
- 返回类型由 `string[]` 改为 `CategorizedTrait[]`
- 解析「category:tag」前缀：仅在 prefix 为已知分类 id 时剥离，否则视为无分类（兜底 `uncategorized`）
- 【重点标记 - 自定义分类 id 合法化（2026-08-06，Spec: fix-asset-trait-and-scene-defects / Task 5.4）】`validCategoryIds` 原仅含系统分类 id（`basic` / `head` / `body` / `top` / `bottom` / `accessories` / `underwear` / `background` / `pose` / `expression`），现同步从 `categoryDictionaryService.loadDictionary()` 加载全局字典自定义分类 id，使 `tattoo` / `weapon` 等自定义分类前缀成为合法前缀，确保 LLM 返回的 `tattoo:dragon tattoo` 能被正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`（而非兜底为 uncategorized）
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

**`clearTraits()` — 绕过 MERGE 的一键清空**（Spec: add-clear-traits-button）：因 `setTraits([])` 受 MERGE 策略约束会**保留已分类项**（仅移除未分类项），无法满足「清空全部特征」需求，故新增 `clearTraits` action 直接 `set({ traits: [], appearanceDescription: '' })` 绕过 MERGE。由 `AssetManagerModal` 顶部工具栏「清空」按钮（`handleClearAll`，`Modal.confirm` 二次确认）调用，同步清空 `ragDebug` 质检报告 + `editingDescription` 本地编辑态；不清空 `combinations` / `globalCategories`（组合方案 + 分类体系保留）；仅清空本地 state，用户需点「保存」才持久化。

> 详见 docs/FIX_RECORDS.md §4.3。

## 动态场景提示词生成（Spec: add-dynamic-scene-prompt-generation）— 综述

> 2026-08-05 全 spec 实施完成（Task 1-9）。本节为综述章节，详细实施细节见下方各 Task 专属章节。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 1-10）**
>
> 「动态场景方案」功能已全量移除，由「提示词生成」面板（`generateTraitPrompts` IPC + 分类特征体系）替代。本节及下方 Task 2 / 3 / 5 / 6 章节仅作历史参考，所涉代码均已不存在。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。
>
> **移除范围（13 个源文件）：**
> - `characterTrait.types.ts` — `DynamicScenePrompt` 接口 + `CharacterTraitManifestV2` 两字段
> - `characterTraitService.ts` — `loadTraitData` / `saveTraitData` 中动态场景字段读写
> - `characterTraitStore.ts` — `dynamicScenePrompts` / `activeDynamicScenePromptId` state + 4 个 action（save/apply/update/delete DynamicScenePrompt）
> - `characterTraitAIService.ts` — `generateDynamicScenePrompts` 方法及辅助函数（约 700 行）+ `DYNAMIC_SCENE_SYSTEM_PROMPT` 常量 + `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口
> - `characterTraitAIHandlers.ts` — `ai:generateDynamicScenePrompts` handler 注册
> - `ipc/index.ts` — 动态场景 IPC 注册注释
> - `preload.ts` — `generateDynamicScenePrompts` 方法
> - `electron.d.ts` — `generateDynamicScenePrompts` 类型定义
> - `sdGenerationService.ts` — `SDGenerationOptions` 三字段 + `applyTraitsAndLora` 中 `{clothing}` / `{pose}` / `{scene}` 占位符替换
> - `PromptBuilder.ts` — 立绘/一般图像模板简化（移除 `{clothing}` / `{pose}` / `{scene}` 占位符 + `userScene` 参数）
> - `AssetGenerateModal.tsx` — 动态场景方案下拉 UI + `buildSdOptions` 字段 + `userScene` state（详见 §7.26）
> - `AssetManagerModal.tsx` — 动态场景指令面板（约 279 行）；**新增** 提示词生成面板（约 460 行，详见下方「角色特征页签提示词生成面板」节）
> - `RagQualityReport.tsx` — `dimension` 字段类型/常量/渲染
>
> **保留不动的部分：** `generateTraitPrompts` / `generateCharacterTraits` / `recognizeImageTraits` / `applyTagAudit` 等方法保留，`generateTraitPrompts` 成为动态场景方案的正式替代品（输出 `CategorizedTrait[]` 而非三组维度 tag）。


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
│      ├─ illustration: `full_body, {pose}, {traits}, {clothing}, │
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
| `GenerateDynamicScenePromptsResult` | `{ success, clothing?, pose?, scene?, error?, ragDebug? }` | 返回：三组英文 tag（未提及维度为 `""`）；**ragDebug**（⚠️ Spec: add-dynamic-scene-tag-audit，详见 §7.18）= 标签库质检报告，结构与 `GenerateCharacterTraitsResult.ragDebug` 兼容，tagValidation 项额外携带 `dimension?: 'clothing'\|'pose'\|'scene'` 标识维度归属 |
| `generateDynamicScenePrompts(params)` | async | 主入口；空输入/AI 未配置/解析失败三类兜底；解析后按维度分别调 `applyTagAudit` 完整走 L0-L5 审计链（无效 tag 自动替换/拆分/AI 兜底） |
| `applyTagAudit(traits, ctx, aiCfg, rtCfg)` | private | **审计辅助方法**（⚠️ §7.18）：封装 validateTagsAgainstLibrary + L3 颜色拆分 + L2/L3 规范化 + L4 KNN 替换 + L5 AI 兜底；`traits` 原地修改；`generateCharacterTraits` 与 `generateDynamicScenePrompts` 共用此方法（DRY） |
| `parseDynamicSceneResponse(content)` | private | 按分隔符切分 + 标点归一化 |
| `DYNAMIC_SCENE_SYSTEM_PROMPT` | const | 指导 LLM 输出 `---CLOTHING---` / `---POSE---` / `---SCENE---` 分隔的三组 tag |

> **⚠️ Spec: add-ai-tag-chinese-translation**（详见 docs/FIX_RECORDS.md §7.21）：
> - AI prompt 输出格式调整为 `分类:tag|中文翻译`（角色特征，`CHARACTER_TRAIT_SYSTEM_PROMPT`）和 `tag|中文翻译`（动态场景，`DYNAMIC_SCENE_SYSTEM_PROMPT`），按第一个 `|` 切分（翻译中可含 `|`）。
> - `parseTraitsFromContent` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` 解析翻译，写入 `CategorizedTrait.translation` / `DynamicScenePrompt.*Translations`。
> - `applyTagAudit` 替换 `trait.text` 时同步清空 `translation=undefined`（L2/L3 规范化、L3 颜色拆分、L4 KNN、L5 AI 兜底全链路），避免翻译与新 tag 不符。

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
- **`normalizeTraitItem(r)`**（⚠️ Spec: add-ai-tag-chinese-translation Task 8 bug 修复，详见 docs/FIX_RECORDS.md §7.21）：构造返回对象时透传 `translation` 字段（`typeof r.translation === 'string' && r.translation ? r.translation : undefined`）。该方法在 `loadTraitData` + `saveTraitData` 双路径调用，遗漏字段会导致 translation 在加载/保存时被剥离。

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
5. 兜底流：无激活方案 → illustration 模式 `dynamicPose='standing'` / `dynamicScene='simple_background'`，general 模式回退 `userScene`，行为与 spec 前一致

---

## 动态场景提示词生成 IPC 通道扩展（Spec: add-dynamic-scene-prompt-generation / Task 3）

2026-08-05 实施：在 `ai:` IPC 命名空间下新增 `ai:generateDynamicScenePrompts` 通道，将渲染进程的自然语言场景指令（如「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」）转发至主进程 `characterTraitAIService.generateDynamicScenePrompts()`，由 LLM 解析为三组独立的英文 SD tag（`clothing` / `pose` / `scene`），供前端写入 `DynamicScenePrompt` 后在 SD 生成时替换 `{clothing}` / `{pose}` / `{scene}` 占位符。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 3）**
>
> 本节所涉 `ai:generateDynamicScenePrompts` IPC 通道、handler 注册、preload 方法、electron.d.ts 类型定义已全量移除。自然语言 → SD tag 的能力由 `ai:generateTraitPrompts` IPC 通道替代（输出 `CategorizedTrait[]` 而非三组维度 tag）。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。

**新增 IPC 通道：**

| 通道名 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `ai:generateDynamicScenePrompts` | `{ naturalLanguageInput: string; baseTraits?: string }` | `Promise<{ success: boolean; clothing?: string; pose?: string; scene?: string; error?: string; ragDebug?: ... }>` | 自然语言 → 三组英文 SD tag；**ragDebug**（⚠️ §7.18）= L0-L5 审计报告，含每条 tag 的 isValid/source/replacedBy/dimension 等字段，供前端 RagQualityReport 只读展示 |

> **⚠️ Spec: add-ai-tag-chinese-translation**（详见 docs/FIX_RECORDS.md §7.21）：返回类型新增 `clothingTranslations?` / `poseTranslations?` / `sceneTranslations?` 三个字段（逗号分隔，与 `clothing`/`pose`/`scene` 一一对应）。`electron.d.ts` 内联返回类型签名已同步扩展（Task 8 bug 修复——主进程类型扩展不会自动反映到渲染进程，需手动同步 `electron.d.ts`）。

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

## 提示词生成功能（Spec: add-prompt-generation-in-asset-modal）

> 2026-08-07 实施：在 `AssetGenerateModal` 的「携带角色特征」区域正上方新增「提示词生成」面板，让用户在 AI 素材生成弹窗中直接输入自由文本提示词（如 `red hair, blue dress, forest background`），由主进程 LLM 解析为分类特征 tag 列表（含 `categoryId` / `translation` / `originalText`），应用后追加到 `editedTraits` 末尾。视觉风格参考「角色特征」页签的「动态场景指令」面板（紫色渐变边框 + `ThunderboltOutlined` 图标）。审计流程复用 `generateCharacterTraits` 的 L0-L5 完整审计链。详见 docs/FIX_RECORDS.md §7.23

### 新增 IPC 通道：`ai:generateTraitPrompts`

| 通道名 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `ai:generateTraitPrompts` | `{ prompt: string; baseTraits?: string }` | `Promise<{ success: boolean; traits?: CategorizedTrait[]; error?: string; ragDebug?: ... }>` | 自由文本提示词 → 分类特征 tag 列表；`traits` 携带 `categoryId` / `translation` / `originalText`，可直接追加到 `editedTraits`；`ragDebug` = L0-L5 审计报告（结构与 `generateCharacterTraits.ragDebug` 完全兼容，前端复用 `RagQualityReport` 组件只读展示） |
| `ai:optimizeTraitsForContext` | `{ traits: Array<{ text, weight?, categoryId? }>, conversationContext: string }` | `Promise<{ success: boolean; tagsToRemove?: Array<{ text, reason? }>; tagsToAdd?: Array<{ text, reason?, weight?, categoryId? }>; error?: string }>` | 图片生成前 AI 优化：TWO PARTS 链式推理 — (1) 分析标签列表与对话上下文的矛盾返回建议删除的标签 (2) 评估删除后缺失的关键描述符返回建议补充的标签（如服装移除后的暴露特征）。JSON 格式 `{ "remove": [{ "text", "reason" }], "add": [{ "text", "reason", "weight"?, "categoryId"? }] }`。试验性功能，需 `AIParameterConfig.ai_optimize_traits` 开启；调用方需做存在性过滤 + 过度删除防护（>80% 拒绝）+ 失败降级。⚠️ **执行时机**：必须在 `generateTraitPrompts` 生成上下文标签并合并为 `mergedTraits` 之后调用，传入完整标签列表（角色特征 + 动态生成的互动标签），否则 AI 无法看到并删除矛盾的互动标签（如对话中角色「抽回手」时应移除 `disembodied_hand`，详见 §7.38）。`tagsToAdd` 为 Spec: add-ai-tag-supplement-after-removal 新增字段，调用方需做去重 + 冲突检查（不补充刚删除的标签）+ 过度补充防护（>50% 拒绝），详见 §7.39（服务层）+ §7.40（渲染层消费） |

**与现有 AI 通道的关系：**
- `ai:generateCharacterTraits`：基于角色卡 `description` / `personality` / `scenario` 提取「固有」特征，可附带角色卡图片（多模态）
- ~~`ai:generateDynamicScenePrompts`：将自然语言指令解析为三组维度 tag（clothing/pose/scene），不分类~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 3，详见 docs/FIX_RECORDS.md §7.27）
- `ai:generateTraitPrompts`（本通道）：将自由文本提示词解析为**分类**特征 tag（`CategorizedTrait[]`），不读取角色卡，不生成外观描述；**已替代** `ai:generateDynamicScenePrompts` 作为自然语言 → SD tag 的正式通道

**修改文件清单：**
- `src/main/services/characterTraitAIService.ts` — 新增 `generateTraitPrompts(params)` 方法 + `GenerateTraitPromptsParams` / `GenerateTraitPromptsResult` 接口 + `buildTraitPromptUserMessage` 私有辅助方法；复用 `buildDynamicTraitSystemPrompt` / `applyTagAudit` / `buildRagReferenceWithDebug` / `parseTraitsAndDescription` 基础设施
- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 在 `registerCharacterTraitAIHandlers()` 内注册 `ai:generateTraitPrompts` handler，复用现有 try/catch 兜底模式；日志前缀 `[CharacterTraitAIHandler]`（service 内部使用 `[TraitPromptAI]` 前缀）
- `src/main/preload.ts` — 在 `ai:` 命名空间内 `generateDynamicScenePrompts` 之后追加 `generateTraitPrompts` 方法，沿用内联类型签名
- `src/renderer/types/electron.d.ts` — 在 `ai:` 接口内 `generateDynamicScenePrompts` 之后追加 `generateTraitPrompts` 类型声明，内联入参与返回值类型
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 新增 `renderPromptGenPanel()` 渲染函数 + 3 个 handler（`handleGenerateTraitPrompts` / `handleApplyGeneratedTraits` / `handleDiscardGeneratedTraits`）+ 7 个 state（`promptGenInput` / `promptGenResult` / `promptGenLoading` / `promptGenRagDebug` / `promptGenRagVisible` / `appliedPromptTraitIds`）；在 `renderTraitsPanel` 之前插入 `{renderPromptGenPanel()}`（两个调用点：批量模式 + 单次模式）；`renderTraitsPanel` 内为应用的新增 trait 显示 ✨ 徽标

### 服务表增量 — `characterTraitAIService.generateTraitPrompts`

| 方法 / 类型 | 签名 | 说明 |
| --- | --- | --- |
| `GenerateTraitPromptsParams` | `{ prompt: string; baseTraits?: string }` | 入参：用户提示词 + 可选已有特征上下文（避免重复生成） |
| `GenerateTraitPromptsResult` | `{ success, traits?: CategorizedTrait[], error?, ragDebug? }` | 返回：分类特征数组（含 translation + originalText）；`ragDebug` 与 `GenerateCharacterTraitsResult.ragDebug` 结构兼容 |
| `generateTraitPrompts(params)` | async | 主入口；空输入/AI 未配置/解析失败三类兜底；复用 `buildDynamicTraitSystemPrompt` 构建系统提示词 + `applyTagAudit` 完整走 L0-L5 审计链 |
| `buildTraitPromptUserMessage(prompt, baseTraits?)` | private | 构建 user message：用户提示词 + 可选已有特征上下文 + 请求行 |

### 审计流程（与 `generateCharacterTraits` 完全一致，L0-L5 完整审计链）

- L0 自定义同义词映射（`userSynonymMapService`）
- L1 name 精确匹配 / L2 alias 精确匹配
- L3 颜色复合词拆分 / L3b 否定性修饰词剥离
- L4 语义 KNN 替换（`score >= 0.3` 自动替换）
- L5 AI 兜底（LLM 生成候选词 → 再走 L0-L4 → 命中替换 + 持久化到 `userSynonymMapService`）

### UI 交互流程

1. 用户在 `Input.TextArea` 输入提示词（如 `red hair, blue dress, forest background` 或自然语言）
2. 点击「生成提示词」按钮 → `handleGenerateTraitPrompts` 调用 `ai:generateTraitPrompts` IPC，`baseTraits` 取 `enabledTraitTexts.join(', ')`（避免重复生成）
3. 主进程内部走 L0-L5 审计链 + RAG 标签库参考注入，返回 `CategorizedTrait[]` + `ragDebug`
4. 结果按分类分组展示（`Tag` + 翻译 `Tooltip`），下方显示「应用到特征列表」/「放弃」按钮
5. 用户点击「应用」→ `handleApplyGeneratedTraits` 为每个 `CategorizedTrait` 分配 `id`（`genTraitId()`）+ `enabled=true`，追加到 `editedTraits` 末尾；记录新 `id` 到 `appliedPromptTraitIds` 集合
   - ⚠️ **去重处理**（2026-08-07 修复，详见 docs/FIX_RECORDS.md §7.23 §8）：应用前对生成结果做两层去重——(a) 与 `effectiveTraits` 已有特征去重（text 小写 + trim 作为 key，覆盖 enabled + disabled）；(b) 生成结果内部去重（AI 可能返回多条相同 tag）。跳过条数通过 `message` 告知用户（`已追加 N 条特征，跳过 M 条重复项`），避免静默丢弃。全部重复时保留 `promptGenResult` 不清空，让用户仍可查看 RAG 报告。
6. 下方 `renderTraitsPanel` 中应用的新增 trait 显示 ✨ 徽标（`isPromptGenerated = appliedPromptTraitIds.has(trait.id)`）
7. `RagQualityReport` 组件以只读模式展示 L0-L5 审计质检报告（不传 `onRevert` / `onManualReplace` 回调）

### 错误兜底（与 `generateDynamicScenePrompts` 一致）

- 空输入：`prompt` 为空或纯空白 → 「请输入提示词」（不调用 LLM，由 service 短路返回）
- AI 引擎未配置：baseUrl / apiKey / modelName 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」
- 引擎参数缺失：temperature / max_tokens 未配置 → 「AI 引擎未配置 temperature 或 max_tokens 参数」
- 调用失败：网络 / 超时 / HTTP 错误 → 「AI 调用失败：<具体原因>」
- 解析失败：LLM 返回空内容 / 无法解析为分类 tag → 「AI 返回内容无法解析为 tag 列表」
- IPC 序列化兜底：handler 外层 try/catch 保证渲染进程永不收到 reject

## 角色特征页签提示词生成面板（Spec: replace-dynamic-scene-with-prompt-gen / Task 9）

> 2026-08-07 实施：在 `AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 组件（角色特征页签）的组合方案工具栏下方、特征列表上方新增「提示词生成」面板，功能与 `AssetGenerateModal.renderPromptGenPanel` 完全一致，让用户在角色特征管理界面也能直接通过自然语言生成分类特征 tag。该面板作为「动态场景指令面板」的替代品：动态场景方案移除后，原由动态场景指令面板承担的「自然语言 → SD tag」能力统一由本面板承担，输出从「三组维度 tag（clothing/pose/scene）」改为「分类特征 tag 列表（`CategorizedTrait[]`）」，通过 `characterTraitStore.setTraits` 合并到现有特征列表。

### 面板位置与视觉

- 位置：`CharacterTraitTabContent` 内，组合方案工具栏（`renderCombinationToolbar`）下方、特征列表（`renderTraitsList`）上方
- 视觉风格：紫色渐变主题，与 `AssetGenerateModal.renderPromptGenPanel` 完全一致
  - 容器：`rgba(139, 92, 246, 0.05)` 背景 + `rgba(139, 92, 246, 0.2)` 边框 + `borderRadius: 8px`
  - 生成按钮：`linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)` 紫色渐变 + `ThunderboltOutlined` 图标
  - 结果 Tag：`color="purple"` + Tooltip 展示翻译/来源/权重

### 面板内部结构（自上而下）

1. **输入区**：`Input.TextArea`（placeholder 提示用户输入自然语言或逗号分隔 tag）+ 「生成提示词」按钮（`loading` 状态禁用，空输入禁用）
2. **结果展示区**（仅 `promptGenResult` 非空时渲染）：
   - 结果标题 + 条数
   - 按分类分组展示（`SYSTEM_TRAIT_CATEGORIES + customCategories + UNCATEGORIZED_CATEGORY` 顺序），每个 Tag 显示 text + 翻译 Tooltip + 权重徽标（如有非默认权重）
   - 「应用到特征列表」+「放弃」按钮
3. **RAG 质检报告**（仅 `promptGenRagDebug` 非空时渲染）：复用 `RagQualityReport` 组件只读展示 L0-L5 审计报告

### State 与 handlers

| State | 类型 | 说明 |
| --- | --- | --- |
| `promptGenInput` | `string` | 用户输入的提示词文本 |
| `promptGenResult` | `CategorizedTrait[] \| null` | AI 生成的分类特征列表（应用前暂存，不写入 store） |
| `promptGenLoading` | `boolean` | 生成中 loading 状态 |
| `promptGenRagDebug` | `RagDebugInfo \| null` | RAG 质检报告调试信息 |
| `promptGenRagVisible` | `boolean` | 质检报告展开/折叠状态 |
| `appliedPromptTraitIds` | `Set<string>` | 已应用的 AI 生成 trait id 集合，用于驱动「✨ 新增」徽标 |

| Handler | 行为 |
| --- | --- |
| `handleGenerateTraitPrompts` | 调用 `ai:generateTraitPrompts` IPC，`baseTraits` 取 `traits.filter(t => t.enabled).map(t => t.text).join(', ')`；成功后暂存 `promptGenResult` + `promptGenRagDebug`，自动展开质检报告 |
| `handleApplyGeneratedTraits` | 与 `AssetGenerateModal` 去重逻辑一致（key = `text.trim().toLowerCase()`，跳过已存在 + 批次内重复），调 `characterTraitStore.setTraits([...traits, ...newTraits])` 合并；通过 `useCharacterTraitStore.getState().traits` diff 出实际写入的新 id 填入 `appliedPromptTraitIds`；应用后清空 `promptGenResult` / `promptGenRagDebug` / `promptGenInput`；`message.success` / `message.info` 提示用户 |
| `handleDiscardGeneratedTraits` | 清空 `promptGenResult` + `promptGenRagDebug`，保留 `promptGenInput` 供用户修改后重试 |

### 关键设计点

- **复用 `AssetGenerateModal.renderPromptGenPanel` 实现**：面板 UI / state / handler 与 `AssetGenerateModal` 完全对称，差异仅在「应用结果」环节——`AssetGenerateModal` 操作本地工作副本 `editedTraits`（不持久化），`CharacterTraitTabContent` 直接调 `characterTraitStore.setTraits`（写入 store，用户后续点「保存」持久化）
- **`setTraits` MERGE 策略 + 新 id diff**：`setTraits` 非简单替换，而是「保留已分类项 / 替换未分类项 / 追加新项」的合并语义。为安全追加新特征，需传入完整列表 `[...traits, ...newTraits]`。`setTraits` path 4 为新项重新生成 id（`genTraitId()`），调用方无法预知，故通过 `useCharacterTraitStore.getState().traits` 在 `setTraits` 后 diff 出实际写入的新 id 填入 `appliedPromptTraitIds`
- **「✨ 新增」徽标**：`renderTraitChip` 中检查 `appliedPromptTraitIds.has(trait.id)`，命中则渲染 ✨ 徽标，让用户能识别哪些 trait 是本次 AI 生成新增的
- **审计流程复用**：与 `generateCharacterTraits` 共用 `applyTagAudit` 走 L0-L5 完整审计链（详见「RAG 标签库」节），前端 `RagQualityReport` 组件只读展示（不传 `onRevert` / `onManualReplace` 回调，因 trait 在 store 中可通过 `updateTrait` / `removeTrait` 精确操作）

### 修改文件清单（Task 9）

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 新增 6 个 state + 3 个 useCallback handler + `renderPromptGenPanel` 渲染函数（约 460 行）；`renderTraitChip` 新增 ✨ 徽标渲染分支；在组合方案工具栏下方、特征列表上方插入 `{renderPromptGenPanel()}`

### 验证

- TypeScript 编译零新增错误
- 与 `AssetGenerateModal.renderPromptGenPanel` 行为一致性静态验证：输入 → 生成 → 应用 / 放弃 → RAG 质检报告展示
- 详见 docs/FIX_RECORDS.md §7.27

## 动态场景提示词 store 扩展（Spec: add-dynamic-scene-prompt-generation / Task 5）

> 2026-08-05 实施：在 `src/renderer/stores/characterTraitStore.ts`（v2 Zustand store）新增 `dynamicScenePrompts` / `activeDynamicScenePromptId` 两个 state 字段与 4 个管理 action，使前端可在不修改基础特征 `traits` 的情况下保存/切换/编辑/删除一次性服装/动作/场景提示词方案。Task 1 扩展 `CharacterTraitManifestV2` 类型后引入的 TS2739（v2 manifest 构造缺失两新字段）在本次一并修复。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 1-3）**
>
> 本节所涉 `dynamicScenePrompts` / `activeDynamicScenePromptId` state 字段与 4 个 action（`saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `updateDynamicScenePrompt` / `deleteDynamicScenePrompt`）已全量从 `characterTraitStore.ts` 移除。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。

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
| `applyDynamicScenePrompt` | `(id: string \| null) => Promise<{success, error?}>` | 设 `activeDynamicScenePromptId` 为给定 id；**`id=null` 表示取消激活**（清空为 null，⚠️ 2026-08-07 修复，详见 docs/FIX_RECORDS.md §7.19，用于 AssetGenerateModal 下拉 allowClear）；id 不在列表中或已是激活方案则 no-op | 立即调用 `get().saveTraits()` |
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

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 7 + Task 9）**
>
> 本节所涉「动态场景指令面板」UI / state / handlers / `renderDynamicSceneTagList` / `useEffect` / store 订阅已全量从 `AssetManagerModal.tsx`（`CharacterTraitTabContent`）移除（约 279 行）。原位置由 Task 9 新增的「提示词生成面板」（`renderPromptGenPanel`）替代，详见上方「角色特征页签提示词生成面板」节。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。

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

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 6）**
>
> 本节所涉「动态场景下拉 UI」与 `userScene` state 已全量从 `AssetGenerateModal.tsx` 移除（动态场景方案整体废弃）。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.26 + §7.27。

**Task 6 — 新增动态场景下拉**（`AssetGenerateModal.tsx` `renderSingleMode`）：

- 补订阅 `applyDynamicScenePrompt` action
- 在生成参数面板中新增 `<Select>` 下拉：
  - `value` = `activeDynamicScenePromptId ?? undefined`
  - `onChange` 调用 `applyDynamicScenePrompt(id ?? null)`（⚠️ 2026-08-07 修复：`id ?? null` 透传 allowClear 的 undefined 为 null，否则 × 清除按钮不生效，详见 docs/FIX_RECORDS.md §7.19）
  - `allowClear`：点击 × 清除时调 `applyDynamicScenePrompt(null)` 取消激活（清空 `activeDynamicScenePromptId` 为 null）
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

---

## 标签自动推荐 Settings 配置面板（Spec: implement-local-tag-autocomplete / Task 6）

### 概述

在 Settings 主面板中新增「标签自动推荐」子面板，让用户配置本地 Danbooru/e621 标签库 CSV 路径、开关、默认排序规则。配置通过 `AppSetting.tagAutocomplete` 嵌套字段持久化（Task 4 已就绪），路径变更时立即触发 `tag:setCsvPath` IPC 重新加载标签库索引（不等保存）。

### 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 配置类型层（Task 4 已就绪）                                   │
│    src/renderer/types/setting.ts                                │
│      └─ TagAutocompleteConfig = { enabled, csvPath, sortBy }    │
│    src/shared/settings.ts                                       │
│      └─ defaultSetting.tagAutocomplete 默认值                   │
├─────────────────────────────────────────────────────────────────┤
│ 2. 主进程 IPC（Task 3 已就绪）                                   │
│    src/main/ipc/handlers/tagHandlers.ts                         │
│      ├─ tag:search / tag:getLoadStatus                          │
│      ├─ tag:reload(args?: { csvPath? })                         │
│      └─ tag:setCsvPath(args: { csvPath })                       │
│    src/main/preload.ts → electron.d.ts                          │
│      └─ window.electronAPI.tag.* / window.electronAPI.file.*    │
├─────────────────────────────────────────────────────────────────┤
│ 3. Settings 子面板（Task 6 本次实施）                            │
│    src/renderer/components/Settings/TagAutocompleteSettings.tsx │
│      ├─ forwardRef + useImperativeHandle 暴露 getFormValues()   │
│      ├─ Form 字段：enabled (Switch) / csvPath (Input+Button)    │
│      │              / sortBy (Select 3 选项)                    │
│      ├─ 文件选择：file.selectFile([{ name:'CSV', extensions:    │
│      │            ['csv'] }, { name:'所有文件', extensions:['*'] }]) │
│      ├─ 路径变更触发：tag.setCsvPath({ csvPath }) → 立即重载    │
│      ├─ 重新加载按钮：tag.reload({ csvPath }) 沿用当前路径刷新  │
│      └─ 顶部加载状态 Alert：tag.getLoadStatus() 展示            │
│                  loaded / totalCount / csvPath / error          │
├─────────────────────────────────────────────────────────────────┤
│ 4. 主入口集成                                                    │
│    src/renderer/components/Settings/Settings.tsx                │
│      ├─ tagAutocompleteConfigRef = useRef<TagAutocompleteRef>   │
│      ├─ JSX 追加 <TagAutocompleteSettings ref={...} />          │
│      │  （位于 <WebSearchSettings> 之后、<Divider /> 之前）     │
│      └─ handleSave 合并：updatedSetting.tagAutocomplete         │
│         = tagAutocompleteConfigRef.current?.getFormValues()     │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计点

- **forwardRef + useImperativeHandle 模式**：与 `WebSearchSettings` / `SDWebuiSettings` 完全一致。子面板持有自己的 `Form.useForm<TagAutocompleteConfig>()` 实例，通过 `ref.current.getFormValues()` 在父组件 `handleSave` 时取出表单值，合并到 `updatedSetting.tagAutocomplete` 字段保存。子面板不直接调用 `saveSetting`，避免与主表单的扁平字段命名空间冲突。
- **默认值合并**：`getFormValues()` 内部返回 `{ ...DEFAULT_TAG_AUTOCOMPLETE_CONFIG, ...values }`，避免旧 `settings.json` 缺失 `tagAutocomplete` 字段时表单值字段缺失（与 WebSearchSettings 同款兜底）。
- **路径变更即时生效（不等保存）**：用户选择新 CSV 文件后立即调用 `tag.setCsvPath({ csvPath })` 触发主进程 `tagAutocompleteService.reload(csvPath)`，重新加载索引。这样用户在保存设置前就能在 `AssetGenerateModal` 临时标签输入框中验证推荐效果。失败时展示错误 Alert 但不阻塞表单保存。
- **文件选择取消静默返回**：`window.electronAPI.file.selectFile(filters)` 返回 `string | null`，用户取消时返回 `null`，组件静默返回不报错（与 `file:selectFile` IPC handler 实现一致：`result.canceled ? null : result.filePaths[0]`）。
- **CSV 文件过滤器**：`[{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }]`，默认显示 CSV 文件，可切换到所有文件（兼容用户自定义扩展名）。
- **加载状态展示**：面板顶部 `Alert` 展示 `tag.getLoadStatus()` 返回的当前状态（loaded / totalCount / csvPath / error）。`loaded=true` 时显示绿色 success Alert + 标签总数；`error` 存在时显示红色 error Alert + 错误详情；未加载时显示 info 提示。
- **重新加载按钮**：与「选择文件」按钮区分。「选择文件」打开文件对话框切换路径；「重新加载」沿用当前路径调用 `tag.reload({ csvPath })`，用于 CSV 文件被外部更新后刷新索引。
- **排序规则 Select**：3 个选项 `relevance`（匹配度：前缀 > 包含 > 别名 + count 降序）/ `count`（使用频率降序）/ `alphabetical`（字母升序）。每个选项的 label 包含简短说明，便于用户理解排序语义。

### IPC API 引用

| 通道 | 入参 | 返回值 | 用途 |
|------|------|--------|------|
| `file:selectFile` | `FileFilter[]` | `Promise<string \| null>` | 打开原生文件选择对话框，取消返回 null |
| `tag:setCsvPath` | `{ csvPath: string }` | `Promise<{ success, totalCount, error? }>` | 设置新 CSV 路径并重新加载（路径变更即时生效） |
| `tag:reload` | `args?: { csvPath?: string }` | `Promise<{ success, totalCount, error? }>` | 重新加载标签库（不传 csvPath 沿用当前路径） |
| `tag:getLoadStatus` | 无 | `Promise<{ loaded, loading, totalCount, csvPath, error? }>` | 获取当前加载状态快照（设置面板顶部 Alert 展示） |

### 涉及文件清单

**新增文件（1 个）**：
- `src/renderer/components/Settings/TagAutocompleteSettings.tsx` — 标签自动推荐配置子面板（forwardRef + Form + 文件选择 + reload 触发 + 加载状态展示）

**修改文件（1 个）**：
- `src/renderer/components/Settings/Settings.tsx` — import 新组件 + 创建 `tagAutocompleteConfigRef` + JSX 追加 `<TagAutocompleteSettings ref={tagAutocompleteConfigRef} />`（位于 `<WebSearchSettings>` 之后）+ `handleSave` 合并 `tagAutocomplete` 字段

### 验证总结

- **tsc 验证（PASS）**：`TagAutocompleteSettings.tsx` 与 `Settings.tsx` 零新增 TypeScript 错误
- **预先存在错误（与本次修改无关）**：`src/renderer/components/Common/TagAutocomplete.tsx(354,33): error TS1010: '*/' expected.` 属于 Task 5 文件，不在 Task 6 范围
- **运行时验证（推迟到 Task 7 集成后）**：用户实际选择 CSV 文件 → 标签库加载 → AssetGenerateModal 临时标签输入框推荐效果

---

## 标签自动推荐集成 AssetGenerateModal（Spec: implement-local-tag-autocomplete / Task 7）

### 概述

将「输入临时标签」位置的普通 `<Input>` 替换为 `<TagAutocomplete>`，实现基于本地 Danbooru/e621 标签库的实时推荐。用户在 AssetGenerateModal「携带角色特征」面板点击「新增临时标签」后，输入框会随按键 debounce 150ms 后查询本地标签库，下拉展示匹配的 tag（含分类彩色 Tag + count 值），选中后自动追加到 `editedTraits` 并清空输入框（不退出新增模式，允许连续添加多个 tag）。

### 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. TagAutocomplete 组件扩展（Task 5 已就绪 + Task 7 透传 props） │
│    src/renderer/components/Common/TagAutocomplete.tsx           │
│      ├─ TagAutocompleteProps 新增 3 个透传 prop：               │
│      │   onPressEnter?: () => void                              │
│      │   onKeyDown?: (e: React.KeyboardEvent) => void          │
│      │   autoFocus?: boolean                                    │
│      ├─ 降级 Input（enabled=false）：透传 3 个 prop             │
│      └─ AutoComplete 内嵌 Input：透传 3 个 prop                 │
├─────────────────────────────────────────────────────────────────┤
│ 2. AssetGenerateModal 集成（Task 7 原始实施）                   │
│    src/renderer/components/Character/CharacterDialogueChat/     │
│      AssetGenerateModal.tsx                                     │
│      ├─ import { TagAutocomplete } from '../../Common'          │
│      ├─ L1938-1978: <Input> → <TagAutocomplete>                 │
│      ├─ onTagSelect 内联实现（不调用 handleConfirmAddTrait）    │
│      └─ 保留 onPressEnter / onKeyDown / ✓ / ✗ 按钮             │
├─────────────────────────────────────────────────────────────────┤
│ 3. AssetManagerModal 集成补全（2026-08-06 修复，详见 §6.3）     │
│    src/renderer/components/Character/CharacterDialogueChat/     │
│      AssetManagerModal.tsx                                      │
│      ├─ import { TagAutocomplete } from '../../Common'          │
│      ├─ L2982-3009: <Input> → <TagAutocomplete>                 │
│      ├─ onTagSelect 调用 store.addTrait(tag.name, categoryId)   │
│      └─ 保留 onPressEnter={handleAddTrait}                      │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计点

- **onTagSelect 选中后不退出新增模式（方案 A）**：原 `<Input>` 的 `handleConfirmAddTrait` 会 `setAddingCategoryId(null)` 退出新增模式。Task 7 在 `onTagSelect` 中**不调用** `handleConfirmAddTrait`，而是内联实现：构造 `newTrait`（`text: tag.name`）追加到 `editedTraits` + `setAddingText('')` 清空输入框。这样用户可连续选中多个推荐 tag 而无需反复点击「新增临时标签」。Escape 键与 ✓/✗ 按钮仍可主动退出新增模式。
- **onPressEnter 透传保留自定义 tag 输入**：用户输入的文本可能不在标签库中（如自定义场景 tag），按 Enter 仍走原 `handleConfirmAddTrait`（trim 后非空则追加 + 退出新增模式）。TagAutocomplete 内部嵌套 Input 但不暴露 `onPressEnter`，故扩展 props 透传。降级模式（`tagAutocomplete.enabled=false`）下也透传，避免关闭推荐时 Enter 失效。
- **onKeyDown 透传保留 Escape 退出**：原 Input 通过 `onKeyDown` 拦截 Escape 调用 `handleCancelAddTrait`。透传到内嵌 Input 与降级 Input，确保键位行为在启用 / 降级两种渲染路径下一致。
- **autoFocus 透传保留自动聚焦**：原 Input 设置 `autoFocus` 让用户点击「新增临时标签」后无需再次点击输入框即可键入。透传此 prop 保持原有交互体验。
- **showSortButton={false}**：AssetGenerateModal 临时标签输入框采用紧凑布局（width: 140），不展示排序按钮（排序规则仍由 Settings 面板配置，或首次使用时在其他场景切换）。
- **降级开关由组件内部处理**：`setting.tagAutocomplete.enabled=false` 时 TagAutocomplete 内部回退为普通 `<Input>`，但通过透传的 `onPressEnter` / `onKeyDown` / `autoFocus` 保证降级后 Enter / Escape / 自动聚焦全部正常工作，与原 Input 行为完全一致。
- **onChange 签名差异**：原 Input 的 `onChange` 接收 `React.ChangeEvent`（`setAddingText(e.target.value)`）；TagAutocomplete 的 `onChange` 直接接收 `string`（`onChange={setAddingText}`）。`setAddingText` 是 `Dispatch<SetStateAction<string>>`，可直接作为 `onChange` 传入。

### onTagSelect 回调实现

```typescript
onTagSelect={(tag) => {
  // addingCategoryId 在 isAdding=true 时必然非空
  // （isAdding = addingCategoryId === category.id）
  if (!addingCategoryId) return;
  const newTrait: CharacterTraitItem = {
    id: genTraitId(),
    text: tag.name,           // 使用推荐 tag 的 name（Danbooru 标准名）
    categoryId: addingCategoryId,
    enabled: true,
  };
  setEditedTraits((prev) => (prev ? [...prev, newTrait] : prev));
  setAddingText('');          // 清空输入框，不退出新增模式
}}
```

与 `handleConfirmAddTrait` 的差异：
- `handleConfirmAddTrait`：`text` 来自 `addingText.trim()`（用户手动输入），追加后 `setAddingCategoryId(null)` 退出新增模式
- `onTagSelect`：`text` 来自 `tag.name`（标签库标准名），追加后**不退出新增模式**（仅清空输入框）

### 涉及文件清单

**修改文件（2 个）**：
- `src/renderer/components/Common/TagAutocomplete.tsx` — `TagAutocompleteProps` 接口新增 `onPressEnter` / `onKeyDown` / `autoFocus` 三个可选 prop；组件参数解构接收；降级 Input 与 AutoComplete 内嵌 Input 均透传这三个 prop
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — import `TagAutocomplete`（barrel 入口 `../../Common`）；L1938-1978 的 `<Input>` 替换为 `<TagAutocomplete>`，新增 `onTagSelect` 回调（内联实现，不退出新增模式），保留 `onPressEnter` / `onKeyDown` / `autoFocus` / ✓ / ✗ 按钮

**未修改文件**：
- `handleConfirmAddTrait` / `handleCancelAddTrait` / `handleStartAddTrait` 保持原样
- `settingStore` 不修改（降级开关由 TagAutocomplete 内部读取 `setting.tagAutocomplete.enabled`）

---

## 特征翻译优化与临时编辑方案（Spec: optimize-trait-translation-and-temp-scheme）

### Task 1 — 类型扩展（2026-08-07，已完成）

为后续 L3 颜色拆分标签溯源 + AssetGenerateModal 临时编辑保存到组合方案做类型契约准备。仅扩展类型定义，不修改任何运行时逻辑代码。

**新增字段（`src/shared/types/characterTrait.types.ts`）：**

- `CategorizedTrait.originalText?: string` — 拆分前原始标签文本
  - 仅 L3 颜色拆分生成的标签设置此字段（如 `grey long hair` 拆分为 `grey_hair` + `long_hair`，两者 `originalText` 均为 `grey long hair`）
  - 手动编辑标签文本后清空（编辑后的标签不再是"拆分生成"）
  - 非拆分标签无此字段（undefined），前端不显示拆分图标
- `CharacterTraitItem.originalText?: string` — 语义同 `CategorizedTrait.originalText`
  - 随 v2 manifest 持久化（`CharacterTraitManifestV2.traits[].originalText`）
  - 旧数据无此字段时兜底 undefined，前端不显示拆分图标
- `TraitCombination.traitSnapshot?: CharacterTraitItem[]` — 完整特征快照
  - 从 AssetGenerateModal 保存时写入（含临时新增/编辑的标签、启用状态、translation、originalText）
  - 从 AssetManagerModal 保存时不写入（仅 traitIds，向后兼容）
  - 应用方案时优先使用 traitSnapshot（若存在），否则回退到 traitIds 逻辑
  - 与 traitIds 可共存（traitIds 仍记录启用 id，traitSnapshot 记录完整数据）

**未修改的契约：**
- `electron.d.ts` 通过 `import type` 引用 shared 类型，无内联 `TraitCombination` 类型签名，无需同步修改
- 现有字段与 JSDoc 注释保持不变，仅新增字段
- 所有新增字段均为可选（`?:`），旧数据 / 旧调用方无破坏性影响

> 详见 CHANGELOG.md 2026-08-07 条目；后续 Task（store / service / UI 适配）将消费这些新字段。

### Task 2+3 — 翻译继承 + normalizeTraitItem 兜底（2026-08-07，已完成）

接续 Task 1 类型契约，落地两处运行时改动。

#### Task 2 — applyTagAudit 三场景保留 translation（`src/main/services/characterTraitAIService.ts`）

`applyTagAudit`（约 L1143-1277）原本三处替换场景均 `trait.translation = undefined`，导致 AI 原始翻译在审计替换后丢失。改为继承源标签翻译：

**场景 1 — L3 颜色拆分（约 L1172-1195）**：源标签翻译分配到两个子标签 + 记录原始标签
```typescript
const sourceTranslation = trait.translation;
const sourceOriginalText = v.tag;
trait.text = v.splitTags.featureTag;
trait.translation = sourceTranslation;        // 继承而非 undefined
trait.originalText = sourceOriginalText;
traits.push({
  text: v.splitTags.colorPartTag,
  categoryId: trait.categoryId,
  translation: sourceTranslation,             // 继承翻译
  originalText: sourceOriginalText,           // 记录原始标签
});
```

**场景 2 — L2/L3 规范化替换（约 L1196-1207）**：删除 `trait.translation = undefined`，translation 保持不变（trait 上已有，无需赋值）。

**场景 3 — L4 KNN 语义替换（约 L1212-1219）**：删除 `trait.translation = undefined`，translation 保持不变。

**注释统一**：三处原「标签库标准 tag 无需翻译」注释改为「翻译从源标签继承，保留 AI 原始翻译供用户参考」，并引用 Spec `optimize-trait-translation-and-temp-scheme`。

**L5 AI 兜底也继承翻译**：`applyAiFallback`（约 L1041-1123）原清空 `trait.translation = undefined`，后已修复为继承源标签翻译（与 L2/L3/L4 一致），translation 保持不变。L5 为语义替换不设置 `originalText`（仅 L3 颜色拆分设置）。

#### Task 3 — normalizeTraitItem originalText 兜底（`src/main/services/characterTraitService.ts`）

`normalizeTraitItem`（约 L176-195）返回对象中在 `translation` 字段后新增 `originalText` 兜底，与 `translation` 兜底逻辑对齐：

```typescript
return {
  id: ...,
  text: r.text,
  categoryId: ...,
  enabled: ...,
  translation: typeof r.translation === 'string' && r.translation ? r.translation : undefined,
  originalText: typeof r.originalText === 'string' && r.originalText ? r.originalText : undefined,
};
```

JSDoc 补充 `originalText` 字段说明：L3 拆分时设置（记录原始复合标签）、手动编辑后清空、旧数据缺失兜底 undefined、非字符串/空字符串兜底 undefined。

#### 验证

`npx tsc --noEmit --skipLibCheck` 仅剩预先存在的 tsconfig 配置错误（`esModuleInterop` / `downlevelIteration`），无本次修改引入的新增类型错误。Task 1 已为 `originalText` 字段定义类型，本 Task 访问 / 赋值均通过类型检查。

#### 涉及文件清单

- `src/main/services/characterTraitAIService.ts` — applyTagAudit 三处场景翻译继承 + L3 拆分场景 originalText 记录（L1172-1219）
- `src/main/services/characterTraitService.ts` — normalizeTraitItem 返回值新增 originalText 兜底 + JSDoc 补充（L160-195）

### Task 4+5+6 — AssetGenerateModal UI 改造（2026-08-07，已完成）

接续 Task 1 类型契约 + Task 2/3 store 层改动，落地 `AssetGenerateModal` 渲染层 UI 改造：拆分标签视觉标识 + 临时方案保存 + 组合方案下拉。三处改动均集中在 `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`。

#### Task 4 — 拆分标签 UI 标识（`renderTraitsPanel`）

为 L3 颜色拆分生成的标签增加视觉标识，让用户一眼看出该 tag 来自复合标签拆分，并能 hover 查看溯源信息。

**改动点：**

1. **导入图标**：从 `@ant-design/icons` 新增 `SplitCellsOutlined`（与 `SaveOutlined` / `DeleteOutlined` 一并新增，供 Task 5+6 使用）。同时移除已不再使用的 `EyeOutlined`（原「AI 图片识别」按钮图标，按钮入口已移除）。

2. **Tooltip 多行展示**（约 L1968-1982）：当 `trait.originalText` 存在且非 `isAutoFiltered` 时，Tooltip title 改为多行 `<div>` 展示「原标签 / 拆分为 / 翻译」（translation 为空时省略翻译行）；其余情况保持原行为（`isAutoFiltered` 显示「表情模式下已自动清空」提示；无 `originalText` 时显示 `translation || ''`）。

3. **Tag 内拆分图标**（约 L2008-2014）：当 `trait.originalText` 存在且非 `isAutoFiltered` 时，在 Tag 文字前显示 `<SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />`。

4. **`handleConfirmEditTrait` 清空 originalText**（约 L1500）：编辑标签文本时同步清空 `originalText: undefined`（与清空 `translation` 一致），避免编辑后前端继续显示拆分图标 + 溯源 Tooltip 但 text 已与 originalText 不对应。修改后 spread 表达式为 `{ ...t, text: trimmed, translation: undefined, originalText: undefined }`。

#### Task 5+6 — 替换 AI 图片识别按钮 + 组合方案下拉（`renderTraitsPanel` 头部）

将原「AI 图片识别」按钮（`supportsVision ? Button : Tooltip「图片识别不可用」`）替换为「组合方案」下拉 + 存方案/删方案按钮组合。Task 5（保存按钮）与 Task 6（下拉）整合为一处 UI（仅保留下拉旁的「存方案」按钮，不再单独放「临时方案保存」按钮，避免重复入口）。

**Store 订阅扩展**（约 L363-371）：在 `useCharacterTraitStore` 解构中补充 `combinations` / `activeCombinationId` / `saveCombination` / `applyCombination` / `deleteCombination` 五个字段，供下拉显示与三个 handler 调用。

**新增 handlers**（约 L1602-1695）：

- `handleSaveTempScheme`：弹出 `Modal.confirm` 输入方案名 → 校验非空 + 不重名（用 `combinations` 列表预校验，给出明确 `message.error`）→ 调 `saveCombination(trimmed, editedTraits.map((t) => ({ ...t })))` 传入 editedTraits 深拷贝快照（含临时新增/编辑/启用状态/translation/originalText）。saveCombination 内部 fire-and-forget 调 saveTraits 持久化，调用方无需 await。
- `handleApplyCombination`：下拉 `onChange` 回调。`combinationId === '__manual__'` 时调 `applyCombination(null)` 取消激活，editedTraits 保持不变；traitSnapshot 方案（`combination.traitSnapshot` 非空）用快照完整替换 editedTraits（深拷贝），解决「保存方案后编辑特征 → 应用方案时特征丢失」问题；traitIds 方案（旧）仅切换 enabled 状态。两者均调 `applyCombination(combinationId)` 同步 store.activeCombinationId。
- `handleDeleteCombination`：删除当前激活方案，二确后调 `deleteCombination(activeCombinationId)`。deleteCombination 内部会 fire-and-forget 调 saveTraits 持久化，并重置 activeCombinationId = null（进入手动模式），下拉自动回到「手动模式」。

**UI 改动**（约 L1933-1981）：
- 移除原「AI 图片识别」按钮块（`{supportsVision ? <Button>... : <Tooltip>...</Tooltip>}`），保留 `handleImageRecognize` 函数定义 + `supportsVision` / `imageRecognizing` 状态变量（spec 要求不删除，便于未来恢复按钮入口；通过 `void` 引用避免 `noUnusedLocals` 报错 TS6133）。
- 在特征面板标题行下方新增一行：`组合方案` label + `<Select>` 下拉（value = `activeCombinationId ?? '__manual__'`，options 含「手动模式」+ combinations 列表，traitSnapshot 方案名后加 📋 emoji 标识）+ `存方案` 按钮（`<SaveOutlined />`）+ `删方案` 按钮（`<DeleteOutlined />`，`disabled={!activeCombinationId}`）。

#### 验证

`npx tsc --noEmit -p tsconfig.json` 仅剩预先存在的 tsconfig 配置错误（`esModuleInterop` / `--jsx` / `electronAPI` / `@shared/types` 路径别名），`AssetGenerateModal.tsx` 零错误（移除 `EyeOutlined` import + `void` 引用三个保留变量后，TS6133 unused 错误已消除）。

#### 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — import 新增 `SplitCellsOutlined` / `SaveOutlined` / `DeleteOutlined`，移除 `EyeOutlined`；store 订阅扩展 5 字段；新增 `handleSaveTempScheme` / `handleApplyCombination` / `handleDeleteCombination` 三个 handler；`handleConfirmEditTrait` 清空 originalText；`renderTraitsPanel` Tag Tooltip 多行展示 + SplitCellsOutlined 图标 + 组合方案下拉 UI 替换 AI 图片识别按钮；末尾 `void` 引用三个保留变量

### Task 7 — store traitSnapshot 支持（2026-08-07，已完成）

扩展 `characterTraitStore` 的组合方案 CRUD，支持 `traitSnapshot` 完整特征快照 + 立即持久化，解决「AssetGenerateModal 临时编辑特征保存方案后丢失」问题。

#### `saveCombination` — 签名扩展接收快照（`characterTraitStore.ts` L1138-1192）

```typescript
saveCombination: (name: string, snapshot?: CharacterTraitItem[]) => {
  // traitIds = 当前 enabled=true 的 trait id（始终保存，向后兼容旧 applyCombination）
  const traitIds = traits.filter((t) => t.enabled).map((t) => t.id);
  const newCombination: TraitCombination = {
    id: genTraitId(), name: trimmed, traitIds,
    // snapshot 深拷贝写入 traitSnapshot（undefined 时省略字段，与旧方案兼容）
    ...(snapshot ? { traitSnapshot: snapshot.map((t) => ({ ...t })) } : {}),
    createdAt: now, updatedAt: now,
  };
  set({ combinations: [...combinations, newCombination] });
  void get().saveTraits().catch(...);  // 立即持久化（fire-and-forget）
}
```

**调用方差异**：
- `AssetGenerateModal.handleSaveTempScheme`：调 `saveCombination(trimmed, editedTraits.map((t) => ({ ...t })))` 传入完整快照
- `AssetManagerModal.handleOpenSaveCombination`：调 `saveCombination(trimmed)` 不传 snapshot（仅 traitIds，与旧逻辑一致）

#### `applyCombination` — traitSnapshot 分支（`characterTraitStore.ts` L1194-1240）

```typescript
applyCombination: (combinationId: string | null) => {
  if (combinationId === null) { set({ activeCombinationId: null }); return; }  // 取消激活
  if (combination.traitSnapshot?.length) {
    // traitSnapshot 方案：完整替换 traits（深拷贝，保留 text/categoryId/enabled/id/translation/originalText）
    set({ traits: combination.traitSnapshot.map((t) => ({ ...t })), activeCombinationId });
  } else {
    // traitIds 方案（旧）：仅切换 enabled，trait 本身不变
    const enabledIdSet = new Set(combination.traitIds);
    set({ traits: traits.map((t) => ({ ...t, enabled: enabledIdSet.has(t.id) })), activeCombinationId });
  }
}
```

**null 支持**：新增 `combinationId === null` 分支取消激活（与 `applyDynamicScenePrompt` 接受 null 一致），便于 UI allowClear 场景。

#### `deleteCombination` — 立即持久化（`characterTraitStore.ts` L1242-1279）

删除方案后立即 `void get().saveTraits().catch(...)` 持久化（与 `saveCombination` 一致），若删除的是当前激活方案则重置 `activeCombinationId = null`（进入手动模式）。

#### `overwriteCombination` — 覆盖同名方案（`characterTraitStore.ts` L1208-1254）

按名称精确匹配已有方案，保留原 id / createdAt，更新 traitIds / traitSnapshot / updatedAt，立即 fire-and-forget 持久化。供 AssetGenerateModal / AssetManagerModal 在保存方案遇到重名时使用（弹二次确认框后调用），避免用户必须重命名。

#### `preCombinationTraits` — traitSnapshot 方案的 traits 备份/恢复（`characterTraitStore.ts`）

**问题背景**：`applyCombination(traitSnapshot 方案)` 会用快照完整替换 store 的 `traits` 数组。当快照只包含部分原始特征时（如用户在 AssetGenerateModal 中删除了某些特征后保存的方案），原始特征在替换后丢失。切换到手动模式（`applyCombination(null)`）时如果不恢复，用户看不到完整的原始特征列表。

**机制**：store 新增 `preCombinationTraits: CharacterTraitItem[] | null`（内存态，不持久化）：
- `applyCombination(traitSnapshot)` 替换前备份当前 `traits` 到 `preCombinationTraits`
- `applyCombination(null)` 从 `preCombinationTraits` 恢复 `traits`，然后清空备份
- traitIds 方案不修改备份（仅切换 enabled，不替换 traits 数组）
- `loadTraits` / `clear` / `toggleTraitEnabled` / `deleteCombination`（删除激活方案时）均清空备份

**AssetGenerateModal 同步**：`handleApplyCombination` / `handleDeleteCombination` 在调用 store 后，通过 `useCharacterTraitStore.getState().traits` 读取恢复后的 traits 并同步到本地 `editedTraits`。

#### 持久化策略变更

原 `saveCombination` / `deleteCombination` 仅修改本地 state，持久化由调用方在「保存」按钮点击时统一调 `saveTraits`。改为**立即持久化**（fire-and-forget `saveTraits`），与动态场景方案（`saveDynamicScenePrompt` / `deleteDynamicScenePrompt`）一致，避免调用方遗漏持久化导致数据丢失。

> 详见 docs/FIX_RECORDS.md §7.24

## AI 生成标签中文翻译（Spec: add-ai-tag-chinese-translation / Task 1-9 全量实施）

> **⚠️ 2026-08-07 部分回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 1+3）**
>
> 本节所涉 `DynamicScenePrompt.clothingTranslations` / `poseTranslations` / `sceneTranslations` 三字段、`saveDynamicScenePrompt` 签名扩展、Task 7「动态场景三组 Tag 列表改造」、`generateDynamicScenePrompts` 返回类型翻译字段已全量回退（动态场景方案整体移除）。下方相关章节仅作历史参考。`CategorizedTrait.translation` / `CharacterTraitItem.translation` 字段及 `generateTraitPrompts` / `generateCharacterTraits` 的翻译链路保留不动。完整移除清单见 docs/FIX_RECORDS.md §7.27。

### 概述

为 AI 生成的角色特征 / 动态场景标签携带中文翻译，前端 hover 展示。仅 AI 原创生成的 tag 携带翻译；标签库标准 tag（被审计替换后）无翻译。手动编辑 / AI 审计替换 / 颜色拆分 / 人工审核替换后清空 `translation`，避免翻译与新 tag 文本不符。

### 类型扩展（Task 1，已完成）

- `CategorizedTrait` 新增 `translation?: string`（AI 生成标签中文翻译，hover 展示）
- `CharacterTraitItem` 继承获得 `translation?: string`，随 v2 manifest 持久化
- ~~`DynamicScenePrompt` 新增 `clothingTranslations?` / `poseTranslations?` / `sceneTranslations?`（三组 tag 的中文翻译，逗号分隔与 `clothing`/`pose`/`scene` 一一对应）~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 1）

> 详见 docs/FIX_RECORDS.md §7.21

### Store 层改动（Task 4 + Task 7，`src/renderer/stores/characterTraitStore.ts`）

#### `updateTrait` — 编辑清空翻译

行内编辑保存新 text 时同步置 `translation: undefined`，避免翻译与新 tag 文本不符。此 action 同时覆盖三条调用路径，无需调用方重复清空：
1. `AssetManagerModal.handleSaveEdit`（行内编辑保存）
2. `AssetManagerModal.handleManualReplace`（末轮人工审核替换）
3. `AssetGenerateModal` 的行内编辑路径

#### `setTraits` — AI 生成翻译透传

原 `safeTraits` 映射 `return { text, categoryId }` 丢弃 `translation` 字段，导致 AI 产出的翻译无法持久化。修复后：
- `safeTraits` 映射时保留 `translation`（trim 后非空才保留）
- 新增 `newByTranslation` Map（text → translation），供 path 2（未分类项重新分类时刷新翻译）使用
- path 2（existing uncategorized updated）：若 AI 提供新 translation 则覆盖，否则保留既有 translation
- path 4（new traits added）：携带 AI 产出的 translation（仅当为非空字符串时写入字段）

MERGE 策略不变（保留已分类项不丢失 + 用 AI 分类更新未分类项），仅补充 translation 透传。

#### `saveDynamicScenePrompt` — 签名扩展接收翻译

新增三个可选参数 `clothingTranslations?: string` / `poseTranslations?: string` / `sceneTranslations?: string`，缺省 / 非字符串时兜底为空字符串。创建 `DynamicScenePrompt` 时写入对应字段。

调用方 `AssetManagerModal.handleSaveDynamicScene` 同步传入 `parsedClothingTranslations.trim()` 等。

### 前端展示层（`AssetManagerModal.tsx`）

#### Task 5: `renderTraitChip` Tooltip 包裹

用 antd `<Tooltip>` 包裹 `trait.text` 展示态 span（`trait.translation || ''` 作为 title）。`translation` 为空时 antd Tooltip 默认不弹出（空字符串 title），不影响点击进入编辑态的行为。

#### Task 7: 动态场景三组 Tag 列表改造

将 `clothing`/`pose`/`scene` 三组从 `<TextArea>` 改为 Tag 列表展示。底层保留 `parsedClothing`/`parsedPose`/`parsedScene` 字符串 state（持久化格式兼容），仅改展示层。

**新增 state**：
- `parsedClothingTranslations` / `parsedPoseTranslations` / `parsedSceneTranslations`（string，逗号分隔，与 parsed* 一一对应）
- `editingDynTagField` / `editingDynTagIndex` / `editingDynTagValue`（行内编辑态）
- `addingDynTagField` / `addingDynTagValue`（添加态）

**`renderDynamicSceneTagList(field)` 函数**：
- 从 parsed* 字符串 split + trim 得 tag 数组（过滤空串），从 parsed*Translations split + trim 得翻译数组
- zip（翻译数组缺位用空字符串补齐）
- 每个 tag 渲染为 `<Tooltip title={translation}><Tag closable onDoubleClick>...</Tag></Tooltip>`
- × 删除：同步删除 tag + 对应翻译（保持一一对应）
- 双击行内编辑：回车保存，清空该 tag 的翻译（与 trait 行内编辑语义一致）；Esc 取消
- 末尾「+ 添加」按钮：回车追加新 tag，翻译为空字符串

**同步逻辑**：
- AI 解析成功（`handleParseDynamicScene`）：从 `result.clothingTranslations` 等填充（类型断言访问，Task 3 完成后 electron.d.ts 同步扩展）
- 切换激活动态场景方案（useEffect）：从 `scheme.clothingTranslations` 等同步（旧方案兜底空字符串）
- 保存方案（`handleSaveDynamicScene`）：透传 parsed*Translations 给 `saveDynamicScenePrompt`

**一一对应维护**：删除/新增/编辑 tag 时，同步增删翻译项。新增项翻译为空字符串，编辑项翻译清空为空字符串，保持数组长度一致。

### 向后兼容

- 旧 `traits.json` 无 `translation` 字段 → 加载时兜底 `undefined`，hover 不显示 Tooltip
- 旧动态场景方案无 `*Translations` 字段 → state 兜底为空字符串，Tag hover 不显示
- 旧 LLM 输出无 `|中文翻译` → AI service 层 `parseTraitsFromContent` / `parseDynamicSceneResponse` 兜底 `translation=undefined` / 空字符串

### 涉及文件清单

**修改文件（4 个，Task 4/5/7）**：
- `src/renderer/stores/characterTraitStore.ts` — `updateTrait` 清空 translation + `setTraits` 透传 translation + `saveDynamicScenePrompt` 签名扩展
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `renderTraitChip` Tooltip 包裹 + 动态场景 Tag 列表改造 + 翻译同步逻辑
- `src/main/services/characterTraitAIService.ts` — prompt 修改 + 解析 + applyTagAudit 清空翻译（Task 2/3）
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 特征 Tag Tooltip + 行内编辑清空翻译（Task 6）

**Task 8 新增修改文件（2 个，bug 修复）**：
- `src/main/services/characterTraitService.ts` — `normalizeTraitItem` 透传 translation 字段（详见下方 Task 8 + FIX_RECORDS.md §7.21）
- `src/renderer/types/electron.d.ts` — `generateDynamicScenePrompts` 返回类型扩展三个翻译字段（详见下方 Task 8 + FIX_RECORDS.md §7.21）

### Task 8：持久化与向后兼容验证（⚠️ 重点 Bug 修复）

> 完整 bug 分析详见 docs/FIX_RECORDS.md §7.21。本节仅列要点。

Task 8 验证阶段发现两个数据流断裂 bug，均已修复：

1. **`normalizeTraitItem` 丢弃 translation 字段**：`characterTraitService.normalizeTraitItem`（`characterTraitService.ts:165`）构造返回对象时仅含 `id`/`text`/`categoryId`/`enabled`，遗漏 `translation`。该方法在 `loadTraitData` + `saveTraitData` 双路径调用，导致翻译在加载/保存时均被剥离。修复：返回对象新增 `translation` 透传（`typeof r.translation === 'string' && r.translation ? r.translation : undefined`）。

2. **`electron.d.ts` IPC 返回类型未同步扩展**：主进程 `GenerateDynamicScenePromptsResult` 已扩展 `clothingTranslations?` 等字段，但 `electron.d.ts` 中 `generateDynamicScenePrompts` 内联返回类型签名未同步，渲染进程访问报 TS 错误。修复：在 `electron.d.ts` 返回类型中新增三个翻译字段，移除 `AssetManagerModal` 中的 `result as typeof result & {...}` 类型断言。

**教训**：⚠️ 新增可选字段到持久化数据结构时，必须检查所有「对象重构」路径（normalize/sanitize/migrate）；⚠️ 主进程类型扩展后，必须同步检查 `electron.d.ts` 内联类型签名（主进程类型不可直接被渲染进程引用）。

### 验证

- `tsc --noEmit`：AssetManagerModal.tsx + characterTraitStore.ts 均无新类型错误（项目其余 925 行 pre-existing 错误与本任务无关）


### 验证总结

- **tsc 验证（PASS）**：`node node_modules/typescript/bin/tsc --noEmit` 全量编译，`TagAutocomplete.tsx` / `AssetGenerateModal.tsx` / `Common/index.ts` 三个修改文件**零新增错误**（900 条预存在错误均在 `src/main/services/*` 等无关文件中）
- **运行时验证（推迟到 Task 8）**：端到端输入响应延迟 < 300ms、31.7 万条数据子串匹配延迟 < 50ms 需在 Task 8 性能验证阶段确认
- **降级路径验证（静态 PASS）**：`setting.tagAutocomplete.enabled=false` 时 TagAutocomplete 渲染普通 Input，透传 `onPressEnter` / `onKeyDown` / `autoFocus`，行为与原 Input 完全一致

---

## 本地标签自动推荐后端架构（Spec: implement-local-tag-autocomplete / Task 1-4, 8）

### 概述

为 AssetGenerateModal 的「输入临时标签」输入框提供基于本地 Danbooru/e621 标签库（31.7 万条）的实时自动推荐功能。后端包含共享类型、主进程 Service、IPC 通道、AppSetting 配置块；前端组件（TagAutocomplete）与 Settings 面板详见前述 Task 5 / 6 / 7 章节。

### 架构分层

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  TagAutocomplete.tsx (Common)                       │
│   ├─ debounce 150ms → window.electronAPI.tag.search │
│   └─ 排序切换 → settingStore.tagAutocomplete.sortBy │
├─────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                      │
│  tag.search / tag.getLoadStatus / tag.reload /      │
│  tag.setCsvPath                                     │
├─────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                         │
│  tagHandlers.ts (4 个 ipcMain.handle)               │
│   ├─ tag:search        → service.search(req)        │
│   ├─ tag:getLoadStatus → service.getLoadStatus()    │
│   ├─ tag:reload        → service.reload(csvPath?)   │
│   └─ tag:setCsvPath    → service.reload(csvPath)    │
├─────────────────────────────────────────────────────┤
│ Service Layer                                        │
│  tagAutocompleteService (单例)                       │
│   ├─ ensureLoaded() — 延迟加载（首次 search 触发）  │
│   ├─ loadInternal() — fs.createReadStream + readline│
│   ├─ parseCsvLine() — 正则解析 CSV 行               │
│   ├─ search() — 子串匹配 + 排序 + 截断              │
│   ├─ sortResults() — relevance/count/alphabetical   │
│   ├─ getLoadStatus()                                │
│   └─ reload(csvPath?)                               │
└─────────────────────────────────────────────────────┘
```

### 共享类型（src/shared/types/tag.types.ts — Task 1）

| 类型 | 类别 | 用途 |
|---|---|---|
| `TagInfo` | interface | CSV 解析后的单个 tag 结构（`{ name: string; category: number; count: number; aliases: string[] }`） |
| `TagMatchType` | type alias | 匹配类型 `'prefix' \| 'includes' \| 'alias'` |
| `TagSearchResult` | interface | 搜索结果项（TagInfo + `matchType`） |
| `TagSortBy` | type alias | 排序规则 `'relevance' \| 'count' \| 'alphabetical'` |
| `TagSearchRequest` | interface | `tag:search` IPC 请求参数（`{ query, sortBy?, limit? }`） |
| `TagSearchResponse` | interface | `tag:search` IPC 响应（`{ success, results, total, error? }`） |
| `TagLoadStatus` | interface | `tag:getLoadStatus` IPC 响应（`{ loaded, loading, totalCount, csvPath, error? }`） |
| `TagReloadResult` | interface | `tag:reload` / `tag:setCsvPath` IPC 响应（`{ success, totalCount, error? }`） |

通过 `src/shared/types/index.ts` barrel 暴露：`export * from './tag.types'`（无同名冲突）

### 主进程 TagAutocompleteService（src/main/services/tagAutocompleteService.ts — Task 2）

- **单例导出**：`export const tagAutocompleteService = new TagAutocompleteService()`
- **内置标签库**：项目随分发内置 `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`（约 8MB，31.7 万条 tag）。`DEFAULT_CSV_PATH` 通过 `resolveBundledCsvPath()` 动态解析：优先 `app.getAppPath()/docs/<filename>`，降级为 `__dirname/../../../docs/<filename>`（与 `logPathService.getLogBaseDir` 路径解析策略一致）。用户未配置 `csvPath` 时自动使用内置标签库
- **CSV 解析**：正则 `^([^,]+),(\d+),(\d+)(?:,"([^"]*)")?$` 解析 `tag_name,category,count,"aliases"` 格式；剥离 UTF-8 BOM；解析失败的行（空行 / 表头 / 格式不符）返回 null 跳过
- **内存索引**：`Map<string, TagInfo>`（key=`name.toLowerCase()`，约 31.7 万条，预估 50-80MB）
- **别名反向索引**：`aliasMap`（`Map<alias.toLowerCase(), TagInfo>`，约 80-100 万条目）+ `getTagByAlias(alias)` 方法，支持同义词反查；冲突策略：同 alias 被多 tag 标注时保留 count 更高的（供 tagRagService L2 层调用，详见 docs/FIX_RECORDS.md §7.13）
- **延迟加载**：`ensureLoaded()` 首次 search 触发，加载期间 `await loadPromise`，多调用方共享同一加载过程（`loadPromise` 并发去重）
- **流式加载**：`fs.createReadStream` + `readline.createInterface`（`crlfDelay: Infinity`），不一次性读入内存
- **子串匹配**：遍历 Map，name 判定 `prefix`（startsWith）/ `includes`，否则查 aliases 判定 `alias`；大小写不敏感
- **排序规则**（`sortResults` 原地排序）：
  - `relevance`：matchType 优先级（prefix=0 > includes=1 > alias=2），同级内 count 降序
  - `count`：纯按 count 降序（高频 tag 优先）
  - `alphabetical`：`name.localeCompare` 升序（A-Z）
- **结果限制**：默认 `limit=50`，上限 50（`Math.min(requestedLimit, 50)`），负数视为 0 返回空
- **错误处理**：`loadInternal` 捕获所有异常记录到 `loadError`，`loaded` 保持 false；`search` 加载失败时返回 `{ success: false, error }` 不抛异常给调用方

### IPC 通道（src/main/ipc/handlers/tagHandlers.ts — Task 3）

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `tag:search` | `TagSearchRequest` | `Promise<TagSearchResponse>` | 查询标签库（子串匹配 + 排序 + 截断） |
| `tag:getLoadStatus` | 无 | `Promise<TagLoadStatus>` | 获取加载状态快照（loaded / loading / totalCount / csvPath / error） |
| `tag:reload` | `{ csvPath?: string }` | `Promise<TagReloadResult>` | 重新加载标签库（不传 csvPath 沿用当前路径） |
| `tag:setCsvPath` | `{ csvPath: string }` | `Promise<TagReloadResult>` | 设置新 CSV 路径并重新加载 |

注册顺序：在 `registerWebSearchHandlers()` 之后追加 `registerTagHandlers()`（`src/main/ipc/index.ts`）

Preload 暴露（`src/main/preload.ts`）：
```typescript
tag: {
  search: (req: TagSearchRequest) => ipcRenderer.invoke('tag:search', req),
  getLoadStatus: () => ipcRenderer.invoke('tag:getLoadStatus'),
  reload: (args?: { csvPath?: string }) => ipcRenderer.invoke('tag:reload', args),
  setCsvPath: (args: { csvPath: string }) => ipcRenderer.invoke('tag:setCsvPath', args),
}
```

渲染进程类型声明（`src/renderer/types/electron.d.ts`）：`tag: { search / getLoadStatus / reload / setCsvPath }` 签名对齐

### AppSetting 配置块（src/renderer/types/setting.ts + src/shared/settings.ts — Task 4）

```typescript
export interface TagAutocompleteConfig {
  enabled: boolean;       // 是否启用标签自动推荐（关闭时 TagAutocomplete 降级为 Input）
  csvPath: string;        // 标签库 CSV 文件路径（空字符串 = 使用内置 docs/ 标签库）
  sortBy: 'relevance' | 'count' | 'alphabetical';  // 默认排序规则
}

// AppSetting 接口扩展
tagAutocomplete?: TagAutocompleteConfig;

// defaultSetting.tagAutocomplete 默认值
tagAutocomplete: { enabled: true, csvPath: '', sortBy: 'relevance' as const }
```

持久化方式：作为 `AppSetting` 嵌套字段，随整体 `setting.save` / `setting.load` IPC 持久化到 electron-store，未修改 `settingStore.ts` / `settingService.ts`（复用现有 AppSetting 序列化管线）。

**csvPath 留空语义**：`csvPath=''` 时主进程 `TagAutocompleteService` 自动回退到内置标签库（`docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`）。Settings 面板的「重新加载」按钮在路径为空时也会重新加载内置标签库（不报错）。用户可选择自定义 CSV 文件覆盖内置库。

### 性能验证（静态分析 — Task 8）

- **主进程子串匹配延迟**：< 50ms（31.7 万条 Map 遍历 + `includes` 操作，复杂度 O(n)，n=317,600；V8 引擎单核性能）
- **端到端输入响应延迟**：~210ms（debounce 150ms + IPC 传输 ~5ms + 主进程查询 ~50ms + 渲染 ~5ms）< 300ms ✓
- **内存占用**：约 50-80MB（Map 索引 31.7 万条 TagInfo，含 name/category/count/aliases 字段）
- **加载耗时**：约 1-2 秒（`readline` 流式逐行解析 + Map.set，不阻塞主进程其他 IPC）

⚠️ 真实运行时性能依赖 Electron 集成测试，本次为静态分析结果（参照 Native Module Test Gap Convention）。静态分析依据：
1. `tagAutocompleteService.ts` — `search()` 方法遍历 `this.tagMap`（L256-277），每次迭代执行 `startsWith` / `includes` / `alias.toLowerCase().includes`，无常驻锁、无 I/O 阻塞
2. `TagAutocomplete.tsx` — `SEARCH_DEBOUNCE_MS = 150`（L130），`doSearch` 异步调用 `window.electronAPI.tag.search`（L227-231），不阻塞渲染线程

### 涉及文件清单

**新增文件（3 个）**：
- `src/shared/types/tag.types.ts` — 8 个共享类型定义（Task 1）
- `src/main/services/tagAutocompleteService.ts` — 主进程标签库加载 + 查询服务（Task 2）
- `src/main/ipc/handlers/tagHandlers.ts` — 4 个 IPC handler（Task 3）

**修改文件（6 个）**：
- `src/shared/types/index.ts` — barrel 暴露 `tag.types`（Task 1）
- `src/main/ipc/index.ts` — 注册 `registerTagHandlers`（Task 3）
- `src/main/preload.ts` — 暴露 `tag` API 到渲染进程（Task 3）
- `src/renderer/types/electron.d.ts` — `tag` API 类型声明（Task 3）
- `src/renderer/types/setting.ts` — 新增 `TagAutocompleteConfig` 接口 + `AppSetting.tagAutocomplete` 字段（Task 4）
- `src/shared/settings.ts` — `defaultSetting.tagAutocomplete` 默认值（Task 4）

## RAG 标签库 — AI 生成特征有效性保障（Spec: rag-tag-library-for-ai-trait-generation）

### 概述

防止 AI 生成特征按钮输出 Danbooru/e621 标签库（31.7 万条）以外的无效 tag。基于已有 `tagAutocompleteService.tagMap`，将标签向量化后用角色描述语义检索 top-K 相关标签，注入 system prompt 尾部作为参考段落，引导 LLM 主动使用有效标签。

方案选型对比（三选一，用户选定方案 3）：
1. **全量标签注入 Prompt** — 32 万 tag ≈ 200 万 token，超模型上下文，不可行
2. **后置过滤**（LLM 输出后筛除无效 tag）— 删除后可能所剩无几，输出被大幅删改，体验差
3. **RAG 向量检索** ✅ — 仅注入 top-K（默认 40）相关 tag，token 成本可控，LLM 主动输出有效 tag

详细实现记录、单测经验与重点标记见 `docs/FIX_RECORDS.md` §7.1 ~ §7.8。

### 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React)                                             │
│  TagRagSettings.tsx (Settings 子面板)                        │
│   ├─ 状态卡片（idle/vectorizing/ready/error/stale）          │
│   ├─ 进度条（订阅 tagRag:progress 事件）                     │
│   ├─ 向量化/取消/清空索引按钮                                │
│   └─ 检索测试区（tagRag:search）                             │
├──────────────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                               │
│  tagRag.getStatus / startVectorization /                     │
│  tagRag.cancelVectorization / search / clearIndex /          │
│  tagRag.onProgress（单向广播订阅）                           │
├──────────────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                                  │
│  tagRagHandlers.ts (5 个 ipcMain.handle + 1 个广播通道)      │
│   ├─ tagRag:getStatus           → service.getStatus()        │
│   ├─ tagRag:startVectorization  → service.vectorizeAll(opt)  │
│   ├─ tagRag:cancelVectorization → service.cancelVectorization│
│   ├─ tagRag:search              → service.searchRelevantTags │
│   ├─ tagRag:clearIndex          → service.clearIndex()       │
│   └─ tagRag:progress（主→渲染单向广播，tagRagProgressEmitter）│
├──────────────────────────────────────────────────────────────┤
│ Service Layer                                                │
│  tagRagService (单例，模块级 currentState)                    │
│   ├─ initialize() — 注册 CSV/维度变更事件监听                │
│   ├─ vectorizeAll(opt) — 分批+并发池向量化                   │
│   │   （远程500/批×并发3·本地32/批顺序执行）                 │
│   ├─ cancelVectorization() — 设置 cancelRequested 标志位     │
│   ├─ searchRelevantTags(req) — embedding + vec0 KNN 检索     │
│   ├─ buildRagReferenceSection(query) — 构建 Prompt 参考段落  │
│   ├─ buildRagReferencePrompt(tags) — 格式化 top-K tag 文本   │
│   ├─ validateTagsAgainstLibrary(tags) — 六层降级匹配链       │
│   │   L0 自定义映射 → L1 name → L2 alias → L3 颜色拆分      │
│   │   → L3b 修饰词剥离 → L4 语义 KNN（source 字段标识命中层）│
│   │   ⚠️ L5 AI 兜底由 characterTraitAIService.applyAiFallback  │
│   │   在 validate 之后对未匹配 tag 调 LLM 生成候选词再验证   │
│   │   （详见 docs/FIX_RECORDS.md §7.17，source='ai-fallback'）│
│   ├─ computeCsvHash() — sha256(path+size+mtimeMs).slice(0,16)│
│   ├─ computeFreshness() — csvHash+dim+model 三元组 stale 检测│
│   └─ clearIndex() — 删除向量文件 + meta 文件                 │
│  userSynonymMapService (单例，内存 Map + 同步 fs 持久化)     │
│   └─ L0 自定义映射表：{userData}/data/user-synonym-map.json  │
│      load/lookup/addMapping/removeMapping（详见 §7.16）      │
│  复用基础设施：EmbeddingService + VectorStoreService          │
│   (source='tag_library', {databaseDir}/vectors/tag_library/  │
│    <csvHash>/<dim>/vectors.db)                               │
└──────────────────────────────────────────────────────────────┘
```

### 数据库目录路径策略（getDatabaseDir）

所有 SQLite 向量 DB 文件与 RAG meta 文件统一收敛到 `getDatabaseDir()`（`src/main/utils/appPath.ts`）：

| 环境 | 判定条件 | 路径 | 说明 |
|---|---|---|---|
| 开发环境 | `!app.isPackaged` | 项目根目录/database | 用户可直观查看 vectors.db / tag_rag_meta.json，便于调试 |
| 生产环境 | `app.isPackaged` | userData/database | app.asar 只读，无法写入项目根目录 |

路径布局：
- 向量 DB：`{databaseDir}/vectors/{source}/{sourceId}/{dimension}/vectors.db`
- RAG meta：`{databaseDir}/tag_rag_meta.json`
- agent SQLite：`{databaseDir}/agent.db`（由 agent/infra/sqliteBackend 使用）

### 共享类型（src/shared/types/tagRag.types.ts）

| 类型 | 类别 | 用途 |
|---|---|---|
| `TagRagStatus` | type alias | 状态枚举 `'idle' \| 'vectorizing' \| 'ready' \| 'error' \| 'stale'` |
| `TagRagProgressPhase` | type alias | 进度阶段 `'starting' \| 'embedding' \| 'storing' \| 'finalizing' \| 'done' \| 'error' \| 'cancelled'` |
| `TagRagProgressEvent` | interface | 进度事件载荷（phase/current/total/percentage/eta/failedCount/message/error） |
| `TagRagMeta` | interface | 持久化元数据（csvHash/dimension/model/totalTags/vectorizedCount/...），写入 `{databaseDir}/tag_rag_meta.json`（开发环境=项目根目录/database，生产环境=userData/database） |
| `TagRagState` | interface | 状态快照（`tagRag:getStatus` 返回，含 status/current/total/meta） |
| `TagRagSearchRequest` | interface | 检索请求（query/topK?/minScore?/categoryFilter?） |
| `TagRagSearchResultItem` | interface | 单条检索结果（name/category/count/aliases/score） |
| `TagRagSearchResponse` | interface | 检索响应（success/results/error?） |
| `TagRagVectorizeResult` | interface | 向量化结果（success/vectorized/failed/durationMs?/error?） |
| `TagRagVectorizeOptions` | interface | 向量化启动选项（`{ force?: boolean }`） |
| `TagRagClearResult` / `TagRagCancelResult` | interface | 清空/取消操作响应 |

通过 `src/shared/types/index.ts` barrel 暴露：`export * from './tagRag.types'`。

### 主进程 TagRagService（src/main/services/tagRagService.ts）

- **单例导出**：`export const tagRagService = { initialize, dispose, getStatus, vectorizeAll, cancelVectorization, searchRelevantTags, buildRagReferencePrompt, buildRagReferenceSection, buildRagReferenceWithDebug, validateTagsAgainstLibrary, clearIndex }`
- **模块级状态**：`currentState` 维护 status/current/total/meta（与 `vectorConfigManager` 一致的单例模式）
- **向量化流程**（`vectorizeAll`）：
  1. 并发去重：进行中直接返回已有 Promise
  2. `tagAutocompleteService.getAllTags()` 取 31.7 万 TagInfo
  3. **标签去重**：按 `name.toLowerCase()` 去重，保留 count 最高的条目（避免同名标签主键冲突）
  4. 计算索引指纹（csvHash + dimension + model）
  5. 分批 + 并发池：远程 API 500 条/批 × 并发 3（可配置）、本地 ONNX 32 条/批（顺序执行），`EmbeddingService.generateBatchEmbeddings`
  6. `VectorStoreService.addBatch()` 写入 `source='tag_library'`
  7. 每批发射 `tagRag:progress` 事件（current/total/percentage/eta）
  8. 写入 meta 到 `{databaseDir}/tag_rag_meta.json`
- **检索流程**（`searchRelevantTags`）：
  1. 降级短路：`settings.tagRag.enabled=false` 或 `status!=='ready'` → 返回 `[]`
  2. `embeddingService.generateEmbedding(query)` 生成查询向量
  3. `vectorStoreService.search(queryVec, topK, undefined, {sourceType:'tag_library'})`
  4. 过滤 `score >= minScore`、可选 categoryFilter
  5. 按 score 降序返回 `TagRagSearchResultItem[]`
- **Prompt 构建**（`buildRagReferenceSection`）：检索 top-K 后调用 `buildRagReferencePrompt` 格式化为「标签库参考」段落文本，供 `characterTraitAIService` 追加到 system prompt 尾部
- **质检报告**（`buildRagReferenceWithDebug` + `validateTagsAgainstLibrary`）：
  - `buildRagReferenceWithDebug`：与 `buildRagReferenceSection` 相同检索逻辑，额外返回 `{ enabled, status, retrievedTags }` 调试上下文
  - `validateTagsAgainstLibrary(tags)`：**async 函数**（⚠️ 调用方必须 `await`，详见 docs/FIX_RECORDS.md §7.12）。验证 AI 生成的 tag 是否在标签库中，采用**六层降级匹配链**（⚠️ 详见 docs/FIX_RECORDS.md §7.16，扩展自 §7.13 的四层）：L0 自定义映射 → L1 name 精确 → L2 alias 反查 → L3 颜色拆分 → L3b 否定性修饰词剥离 → L4 语义 KNN。任一层命中即 isValid=true 并记录 canonicalName + `source` 字段标识命中轮次。返回 `{ tag, isValid, canonicalName?, category?, count?, skipReason?, suggestions, splitTags?, source?, aiFallbackAttempted?, aiFallbackCandidates? }[]`
    - **`source` 字段**（⚠️ 详见 docs/FIX_RECORDS.md §7.16 + §7.17）：`'user-map'`（L0 自定义映射，人工审核/AI 兜底持久化结果）/`'name'`（L1）/`'alias'`（L2）/`'color-split'`（L3）/`'negation-strip'`（L3b）/`'knn'`（L4）/`'ai-fallback'`（L5 AI 兜底，由 `characterTraitAIService.applyAiFallback` 写入，非 validate 内部返回）；前端 RagQualityReport 在 tooltip 中展示命中轮次，辅助用户判断匹配来源 + 统计匹配率
    - **L0 自定义映射**（详见 §7.16）：在 L1 之前调 `userSynonymMapService.lookup(tag)`，命中则 `isValid=true, canonicalName=映射目标, source='user-map'`，跳过 L1-L4（短路）；用户在末轮人工审核指定的替换词 **或 AI 兜底命中** 持久化于此，下次同词首轮即命中
    - **L1/L2 已有**（详见 §7.13）：getTagByName + getTagByAlias + 空格/下划线互转
    - **L3 已从「颜色剥离丢弃」升级为「颜色拆分保留」**（⚠️ 重点，详见 docs/FIX_RECORDS.md §7.15）：原 `stripColorModifier` 只剥离颜色前缀让核心词命中，颜色信息被丢弃；现 `splitColorTag` 将颜色复合 tag 拆成 `colorPartTag`（如 `grey_ears`，颜色归一化 gray→grey + 亮度词丢弃）+ `feature`（如 `drooping_ears`），分别查 name/alias —— 两者都命中时返回 `splitTags={colorPartTag, featureTag}`，由 `characterTraitAIService` 将一个 trait 拆成两个（原 trait 替换为 featureTag，新增 colorPartTag trait），让颜色语义以独立标签形式进入 SD 生成链路
    - **L3b 否定性修饰词剥离**（详见 §7.16）：`stripNegationModifier(tag)` 剥离保守的否定性修饰词前缀（8 词列表：`brimless`/`sleeveless`/`strapless`/`topless`/`bottomless`/`hairless`/`wireless`/`collarless`），用核心词查 name/alias；仅当 L0-L3 全部未命中时才触发（避免误伤 `short_hair`/`open_hoodie` 等本身是标签的复合词）；命中则 `source='negation-strip'`
    - 评级词（`RATING_TAGS`：nsfw/safe/explicit/questionable/rating:*）→ `skipReason='rating'`，不纠错（对 SD 有效但非标签库范畴）
    - 其余 invalid tag → 调 `searchRelevantTags({ query, topK:3, minScore:0.15 })` 获取 top-3 相似库内标签作为 `suggestions`（复用 31.7 万向量库；minScore 由 0.25 降至 0.15，对齐颜色复合 tag 场景）；有 suggestion 时 `source='knn'`
  - **L5 AI 兜底**（⚠️ 新增，详见 docs/FIX_RECORDS.md §7.17）：`characterTraitAIService.generateCharacterTraits` 在 `validateTagsAgainstLibrary` 之后，对 `isValid=false && skipReason!=='rating' && !replacedBy` 的 tag（数量 ≤ `AI_FALLBACK_MAX_TAGS=10`）调 LLM 生成候选词（专用 `AI_FALLBACK_SYSTEM_PROMPT`，输出 `<tag> | candidate1, candidate2`），候选词再走 `validateTagsAgainstLibrary` L0-L4，首个 isValid 候选词替换 trait.text + 调 `userSynonymMapService.addMapping` 持久化（下次 L0 命中）+ 写 `source='ai-fallback'`/`aiFallbackAttempted=true`/`aiFallbackCandidates`；LLM 调用失败/全部候选词未命中 → 标记 `aiFallbackAttempted=true` 不阻塞主流程，保留 ✏ 手动入口；前端 RagQualityReport 对命中显示橙色 🤖 + 撤销按钮（`onRevertAiFallback`），未命中显示橙色淡 🤖 + 候选词 tooltip
  - `characterTraitAIService.generateCharacterTraits` **标签纠错自动替换**：invalid 非评级词 tag 若 `top1.score >= REPLACE_MIN_SCORE(0.3)` → `trait.text = suggestion.name`，记录 `replacedBy`；返回 `ragDebug` 字段含 tagValidation（含 suggestions/replacedBy/source/aiFallback*），UI 据此展示质检报告（valid/replaced/rating/no_suggestion/has_suggestion/ai-fallback-hit/ai-fallback-miss）+ ↩ 撤销按钮
  - **`applyTagAudit` 辅助方法 + 动态场景审计**（⚠️ 新增，详见 docs/FIX_RECORDS.md §7.18）：原审计逻辑（validate + L3 拆分 + L2/L3 规范化 + L4 KNN 替换 + L5 AI 兜底）内联于 `generateCharacterTraits`，与 `CategorizedTrait[]` 强耦合（`traits.find(t => t.text === v.tag)` 反查修改），无法复用于动态场景的「逗号分隔字符串」tag。提取为私有方法 `applyTagAudit(traits, context, aiConfig, runtimeConfig) → tagValidation[]`：
    - `traits` 被原地修改（text 替换 + L3 拆分 push 新 trait），调用方提取 text 即可得到审计后 tag
    - `context` 泛化：`{ description（AI 兜底语义参考）/ personality? / scenario? / characterCardId? / includeImage? }`
    - `generateCharacterTraits` 重构为一行调用（DRY，机械提取无逻辑变更，17 单测 + 58 tagRag 单测全通过验证无回归）
    - `generateTraitPrompts` 同样调用 `applyTagAudit` 完整走 L0-L5 审计链（输出 `CategorizedTrait[]` 后审计）
    - ~~`generateDynamicScenePrompts` 按维度分别调 `applyTagAudit`（clothing/pose/scene 各一次）~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 3；动态场景方案整体回退，详见 docs/FIX_RECORDS.md §7.27）
    - 前端 `AssetManagerModal` 渲染**只读** RagQualityReport（不传撤销/手动替换回调，tag 在文本框可手动编辑）；~~`RagQualityReport` 新增 `dimension` 字段 → tag 前展示维度徽标（👕 服装 / 🏃 动作 / 🌐 场景）~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 8：动态场景方案移除后 `dimension` 字段已变为死代码，从 `RagQualityReport.tsx` 中删除类型定义 / `DIMENSION_LABELS` 常量 / 维度徽标渲染三处代码块）
- **stale 检测**（`computeFreshness`）：csvHash + dimension + model 三元组任一变更 → status 降级为 `'stale'`，需重新向量化
  - csvHash = `sha256(csvPath + ':' + fileSize + ':' + mtimeMs).slice(0,16)`（不读文件内容，8MB 哈希 ~50ms）
  - 事件监听：`tagCsvEmitter 'tag-csv-loaded'` + `vectorConfigManager.onDimensionChange`

### 降级保证（核心契约）

- `settings.tagRag.enabled=false` → `searchRelevantTags` / `buildRagReferencePrompt` 返回空
- 未向量化（status=idle/stale/error）→ `searchRelevantTags` 返回空数组
- EmbeddingService 未配置 / 向量化失败 → 不阻塞主流程，仅返回空结果
- 任何异常捕获后写日志，**不向调用方抛错**（AI 生成特征主流程不受 RAG 故障影响）

### 主进程 UserSynonymMapService（src/main/services/userSynonymMapService.ts）

> ⚠️ 详见 docs/FIX_RECORDS.md §7.16 — 多轮标签审计与替换机制；§7.17 — AI 兜底标签审核

**职责**：持久化标签替换映射（来源：用户「末轮人工审核入口」手动指定 **+ L5 AI 兜底命中自动写入**），跨会话保留；`tagRagService.validateTagsAgainstLibrary` 在 L1 之前查询本表（L0），人工审核 / AI 兜底命中结果下次同词首轮即命中（闭环）
**持久化路径**：`{userData}/data/user-synonym-map.json`（与 `categoryDictionaryService` 一致，由 `getUserDataPath()` 解析）
**数据结构**：`Record<originalTagLowercase, replacementTag>`（扁平键值对；key 统一小写实现大小写不敏感查询，value 保留原样作为 canonicalName 直传）
**关键方法**：
- `load()` — 文件不存在返回空 Map；JSON 损坏/非对象返回空 Map（不覆盖磁盘文件）；key 强制小写、value 必须 string，否则跳过该项；重复 load 幂等（覆盖旧 cache）
- `addMapping(original, replacement)` — 入参 trim，空值跳过；key 小写（大小写不敏感）；写入即 `save()` 落盘；同 key 已存在 → 覆盖（用户重新指定 = 更新映射）
- `removeMapping(original)` — key 不存在时幂等（不抛异常、不落盘）；删除即 `save()` 落盘
- `lookup(tag)` — 大小写不敏感查询；命中返回 replacement，未命中返回 null；未 load 时自动调 `load()`
- `getMap()` — 返回 `Record` 形式浅拷贝（IPC 序列化友好，修改返回值不影响内部 cache）
**内存缓存**：`Map<string, string>`（key 小写），构造时不自动 load（避免主进程启动顺序依赖），由 `tagRagService.initialize()` 显式调用 `load()` 后再查询
**I/O 模式**：同步 `fs.readFileSync`/`fs.writeFileSync`/`fs.existsSync`/`fs.mkdirSync`（映射表预期很小，数十到数百条，同步 I/O 不阻塞主进程）
**错误处理**：所有方法包裹 try/catch，永不抛异常；文件不存在 → 返回空 Map；JSON 解析失败 → 返回空 Map + console.warn（不覆盖磁盘）；写入失败 → console.error，方法静默返回

### IPC 通道（src/main/ipc/handlers/tagRagHandlers.ts）

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `tagRag:getStatus` | 无 | `Promise<TagRagState>` | 获取状态快照（status/current/total/meta） |
| `tagRag:startVectorization` | `TagRagVectorizeOptions?` | `Promise<TagRagVectorizeResult>` | 启动向量化（异步长任务，完成前不返回；进度走 `tagRag:progress` 事件） |
| `tagRag:cancelVectorization` | 无 | `Promise<TagRagCancelResult>` | 取消进行中的向量化（已写入数据保留，状态转 idle） |
| `tagRag:search` | `TagRagSearchRequest` | `Promise<TagRagSearchResponse>` | 语义检索相关标签（设置面板检索测试区用） |
| `tagRag:clearIndex` | 无 | `Promise<TagRagClearResult>` | 清空索引（删除向量文件 + meta 文件，vectorizing 中需先 cancel） |
| `tagRag:progress`（广播） | — | `TagRagProgressEvent` | 主进程 → 渲染进程单向推送向量化进度（非 invoke，`tagRagProgressEmitter` 发射） |
| `tagRag:getUserSynonymMap` | 无 | `Promise<Record<string, string>>` | 获取全部自定义同义词映射（L0 自定义映射表，详见 §7.16） |
| `tagRag:addUserSynonymMapping` | `{ original, replacement }` | `Promise<void>` | 新增/更新一条映射（人工审核替换时调用，写入即落盘） |
| `tagRag:removeUserSynonymMapping` | `{ original }` | `Promise<void>` | 删除一条映射（撤销人工替换时调用，删除即落盘） |

注册顺序：在 `registerTagHandlers()` 之后追加 `registerTagRagHandlers()`，并在 IPC 注册完成后调用 `tagRagService.initialize()` 注册事件监听（`src/main/ipc/index.ts`）。

Preload 暴露（`src/main/preload.ts`）：`tagRag: { getStatus, startVectorization, cancelVectorization, search, clearIndex, onProgress(callback) → unsubscribe, getUserSynonymMap, addUserSynonymMapping, removeUserSynonymMapping }`。渲染进程类型声明对齐 `src/renderer/types/electron.d.ts`。

### AppSetting 配置块（src/renderer/types/setting.ts + src/shared/settings.ts）

```typescript
export interface TagRagConfig {
  enabled: boolean;                              // 是否启用 RAG 注入（默认 false，向量化后手动开启）
  topK: number;                                  // 检索数量（默认 40）
  minScore: number;                              // 最低相似度阈值 cosine（默认 0.15）
  autoRevectorizeOnCsvChange: boolean;           // CSV 变更自动标记 stale（默认 true）
  autoRevectorizeOnDimensionChange: boolean;     // 维度变更自动标记 stale（默认 true）
  batchSize: number;                             // 远程 API 批大小（默认 500，OpenAI 支持最高 2048）
  localBatchSize: number;                        // 本地 ONNX 批大小（默认 32）
  concurrency: number;                           // 远程 API 并发请求数（默认 3，本地 ONNX 强制 1）
  retryMaxAttempts: number;                      // 单批失败重试次数（默认 3）
  retryDelayMs: number;                          // 重试间隔（默认 1000）
}

// AppSetting 接口扩展
tagRag?: TagRagConfig;

// defaultSetting.tagRag 默认值
tagRag: { enabled: false, topK: 40, minScore: 0.15, autoRevectorizeOnCsvChange: true,
          autoRevectorizeOnDimensionChange: true, batchSize: 500, localBatchSize: 32,
          concurrency: 3, retryMaxAttempts: 3, retryDelayMs: 1000 }
```

向量源类型扩展（`src/main/types/vectorConfig.ts`）：`VectorSourceType.TAG_LIBRARY = 'tag_library'`，storageDir=`tag_library`，perEntrySubdir=true（sourceId=csvHash，支持多 CSV 切换）。

### AI 生成特征注入点（src/main/services/characterTraitAIService.ts — Task 9）

三个生成方法在构建 system prompt 后、调用 LLM 前，统一通过私有方法 `buildRagReferenceSection(queryText)` 注入 RAG 参考段落：

| 方法 | 查询文本 | 注入位置 |
|---|---|---|
| `generateCharacterTraits` | 角色描述 `description` | `dynamicSystemPrompt` 尾部 |
| `recognizeImageTraits` | `characterName \|\| 'character'` | `dynamicImageSystemPrompt` 尾部 |
| `generateTraitPrompts` | 用户提示词 `prompt` | `buildDynamicTraitSystemPrompt` 尾部 |
| ~~`generateDynamicScenePrompts`~~ | ~~自然语言指令 `naturalLanguageInput`~~ | ~~`DYNAMIC_SCENE_SYSTEM_PROMPT` 尾部~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 3；`generateTraitPrompts` 已替代） |

`buildRagReferenceSection` 内部委托 `tagRagService.buildRagReferenceSection`，try/catch 包裹确保任何异常都不影响主流程（异常时返回空字符串，system prompt 保持原样）。

### 渲染进程 TagRagSettings 面板（src/renderer/components/Settings/TagRagSettings.tsx — Task 10）

- 通过 `forwardRef<TagRagSettingsRef>` 暴露 `getFormValues()` 供父 `Settings.tsx` 在保存时收集表单值（与 `TagAutocomplete` 设置面板一致的 ref 模式）
- 状态卡片：根据 `tagRag:getStatus` 轮询展示 idle/vectorizing/ready/error/stale 五态，含 meta 信息（vectorizedCount/dimension/model/lastVectorizedAt）
- 进度条：订阅 `tagRag.onProgress` 实时更新 percentage/current/total/eta，含失败条数展示
- 向量化按钮：调 `tagRag.startVectorization({force})`，进行中禁用并显示取消按钮
- 检索测试区：输入文本 → `tagRag.search` → 展示 top-K 结果（name/category/score）
- 清空索引按钮：调 `tagRag.clearIndex`，需二次确认

挂载点：`src/renderer/components/Settings/Settings.tsx` 中 `<TagRagSettings ref={tagRagConfigRef} />`，保存时 `tagRagConfigRef.current?.getFormValues()` 合并到 `setting.save`。

### 涉及文件清单

**新增文件（6 个）**：
- `src/shared/types/tagRag.types.ts` — 11 个共享类型定义
- `src/main/services/tagRagService.ts` — 核心服务（向量化 / 检索 / Prompt 构建 / stale 检测）
- `src/main/services/tagRagProgressEmitter.ts` — 进度事件发射器（`tagRag:progress` 广播）
- `src/main/ipc/handlers/tagRagHandlers.ts` — 5 个 IPC handler + 1 个广播通道
- `src/renderer/components/Settings/TagRagSettings.tsx` — 设置面板（状态/进度/检索测试）
- `src/main/services/__tests__/tagRagService.test.ts` — 24 个单元测试用例

**修改文件（8 个）**：
- `src/main/types/vectorConfig.ts` — 新增 `VectorSourceType.TAG_LIBRARY` 枚举 + Label/Description/StorageConfig
- `src/shared/settings.ts` — `defaultSetting.tagRag` 配置块
- `src/main/services/tagAutocompleteService.ts` — 新增 `getAllTags()` + `tagCsvEmitter` 事件广播（Task 6）
- `src/main/services/characterTraitAIService.ts` — 三个生成方法注入 RAG 参考段落（Task 9）
- `src/main/ipc/index.ts` — 注册 `registerTagRagHandlers()` + 调用 `tagRagService.initialize()`
- `src/main/preload.ts` — 暴露 `tagRag` 命名空间（5 个 IPC + onProgress 订阅）
- `src/renderer/types/electron.d.ts` — 补全 `tagRag` API 类型声明
- `src/renderer/components/Settings/Settings.tsx` — 追加 `<TagRagSettings>` 子面板
- `src/renderer/types/setting.ts` — 新增 `TagRagConfig` 类型

### ⚠️ 待 Electron 集成测试验证项

单元测试覆盖了状态管理、降级路径、Prompt 构建、过滤逻辑，但以下场景需 Electron 集成测试补位（与 `SqliteVecBackend.test.ts` 一致的 Native Module Test Gap Convention）：

1. 向量化端到端（标签库加载 → 分批向量化 → 落盘 → meta 写入）
2. vec0 MATCH KNN 真实 cosine 距离 + post-filter 语义（已知盲区，vec0 固有约束：KNN 先返回 top-K 再过滤元数据，过滤后可能 < K 条；已固化在 `SqliteVecBackend.ts:search()` 注释，详见 FIX_RECORDS §7.8）
3. 维度变更 / CSV 替换触发 stale 的事件链路
4. AI 生成端到端（`tagRag.enabled=true` + 索引 ready → system prompt 含参考段落 → traits 全在标签库中）

详见 `docs/FIX_RECORDS.md` §7.8。

---

## §15 性能优化（Spec: optimize-system-rendering-performance）

> 实施日期：2026-08-06 | 9 个 Task 全部完成 | 详细修复记录见 `docs/FIX_RECORDS.md` §8.1 ~ §8.10

### 概述

针对渲染性能（列表滚动卡顿、图片网格首屏掉帧、初始 bundle 过大）的系统性优化。采用「先测量后优化 + 最小实现优先」原则，覆盖五个维度：性能基线工具、路由级代码分割、列表虚拟滚动、图片懒加载缩略图管线、重渲染审计。

**量化成果**：初始 chunk 体积从 ~4,070 kB（单 chunk）降至 ~1,750 kB（entry+react+antd），**-57%**（超 ≥30% 目标）。运行时指标（滚动 ≤100ms / 图片 -50%）待用户 dev 模式采集回填 §8.1。

> 注：本项目的「架构真源」§3 目录树 / §4.2 IPC 注册顺序 / §4.3 命名空间表 / §4.4 服务表等章节因 2026-08-01 磁盘异常丢失（见文件头说明），重建后的 CODE_WIKI 采用按特性分章的扁平结构。故本次新增模块的架构归档（目录树增量、IPC 命名空间、服务表条目）统一收入本章 §15.4，而非回填已不存在的 §3/§4。

### §15.1 性能基线与测量工具

| 文件 | 职责 |
|------|------|
| `src/renderer/utils/perfBaseline.ts`（新增） | Performance API 基线测量工具，**仅 dev 模式生效**（`import.meta.env.DEV` + `performance` API 双守卫，生产环境 no-op 零开销）。导出：`measureScrollFPS`（滚动帧间隔/FPS/长任务数）、`measureFirstScreenComplete`（图片网格首屏完成时间）、`startLongTaskObserver`（longtask 观察者）、`formatBaselineReport`（格式化报告） |
| `vite.config.ts`（修改） | 新增 `rollup-plugin-visualizer` 插件，构建输出 `dist/stats.html` treemap 报告（仅 renderer build） |

- 基线指标表与采集步骤见 FIX_RECORDS §8.1 / §8.2；达标判定标准见 §8.4。
- ⚠️ **visualizer ESM bug（重点标记）**：`rollup-plugin-visualizer@7` 为 ESM-only 包，本项目未启 `"type": "module"`，静态 import 会导致 `npm run build` 失败。改用 `defineConfig(async () => { const { visualizer } = await import(...) })` 动态 import 绕过 CJS require。详见 §8.5。

### §15.2 路由级代码分割与 vendor 拆分

| 改动点 | 文件 | 说明 |
|--------|------|------|
| 路由懒加载 | `src/renderer/routeConfig.ts`（修改） | 全部 12 个路由组件改为 `React.lazy(() => import(...))`；命名导出用 `.then(m => ({ default: m.X }))` 适配 |
| Suspense 包裹 | `src/renderer/App.tsx`（修改） | `<Suspense fallback={routeFallback}>` 包裹路由内容（居中 `<Spin size="large" />`），Sidebar/Header 始终可见 |
| 厂商分块 | `vite.config.ts`（修改） | `manualChunks` 拆分 5 组 vendor：`vendor-react` / `vendor-antd` / `vendor-milkdown` / `vendor-ai` / `vendor-markdown`。顺序敏感：markdown/antd/milkdown/ai 必须先于 react 兜底判断，否则 react-markdown 等被 react 通配误吞 |

**构建产物（5669 modules transformed）：**

| Chunk | 体积 | gzip | 加载时机 |
|-------|------|------|----------|
| entry `index-BOkPa-8-.js` | 274.59 kB | 79.71 kB | 初始 |
| vendor-react | 142.37 kB | 45.63 kB | 初始 |
| vendor-antd | 1,333.23 kB | 420.04 kB | 初始（App shell 用 antd） |
| vendor-milkdown | 1,364.44 kB | 434.44 kB | **懒加载**（WorldBook/编辑器打开时） |
| vendor-markdown | 573.56 kB | 159.21 kB | **懒加载** |
| vendor-ai | 382.28 kB | 98.02 kB | **懒加载** |
| 路由懒 chunks | 31~188 kB | — | 各路由打开时 |

**初始加载 ≈ 1,750 kB**（entry + react + antd）vs 原单 chunk ~4,070 kB → **-57%**（目标 ≥30%）。

### §15.3 列表虚拟滚动

| 站点 | 方案 | 文件 | 阈值 |
|------|------|------|------|
| AssetManagerModal 素材网格 | `useVirtualizer`（@tanstack/react-virtual）行虚拟化 + 行内多列 grid | `AssetManagerModal.tsx`（`AssetVirtualGrid` 内联组件） | ≥50 项虚拟化，<50 回退 `.map()`+CSS grid |
| CharacterListView（角色卡列表） | antd v6 Table 内置 `virtual` prop + `scroll={{ y: 500 }}` | `CharacterListView.tsx` | — |
| KnowledgeItemList（知识库文档树） | antd v6 Table 内置 `virtual` prop + `scroll={{ x:860, y:500 }}` | `KnowledgeItemList.tsx` | — |
| PromptManagement | 跳过（固定 ~20 项） | `PromptManagement.tsx` 文件头 `[perf]` 注释 | <50 |
| AvatarManager | 跳过（手工 <50 项） | `AvatarManager.tsx` 文件头 `[perf]` 注释 | <50 |

- **Task 4 委托发现（重点标记）**：`CharacterManager` 不直接渲染角色卡列表，委托给子组件 `CharacterListView`。虚拟化改造须落在 `CharacterListView` 而非 `CharacterManager`。详见 §8.10。
- 虚拟化方案选型（useVirtualizer vs antd Table virtual）见 §8.7 / §8.8。
- 列表项 `React.memo` + handler `useCallback` 覆盖率 100%（AssetCard / CharacterListView / DocumentActions / LeafActions / ModuleListItem / AvatarCard / ProfileCard / FavoriteItem）。

### §15.4 图片懒加载与缩略图管线（含架构归档）

#### 数据流

```
渲染进程                              Preload 桥                主进程
LazyImage                            thumbnail 命名空间         thumbnailService (nativeImage)
  │ IntersectionObserver 进入视口      │                         │
  │ → imageCache 渲染 LRU 查询         │                         │
  │   命中 → 直接渲染 <img src=dataUrl>│                         │
  │   未命中 → thumbnail.get ──────────┤invoke('thumbnail:get')─→│ getThumbnail()
  │                                     │                         │  内存 LRU(200) → 磁盘 → nativeImage 生成
  │ ← { dataUrl, mime, fromCache } ────┤←────────────────────────│  写磁盘 + 内存 LRU
  │ → setCachedThumbnail 写渲染 LRU     │                         │
  │ → <img src=dataUrl> 淡入渲染        │                         │
  │                                     │                         │
  │ invalidateImageCache()「双清」      │                         │
  │   1. 清渲染 LRU                     │                         │
  │   2. thumbnail.invalidate ─────────┤invoke('thumbnail:invalidate')→ invalidateThumbnail()
```

#### 新增模块（架构归档）

**目录树增量：**
```
src/
├─ renderer/
│  ├─ utils/
│  │  ├─ perfBaseline.ts        # 性能基线测量工具（dev-only）
│  │  └─ imageCache.ts          # 渲染进程缩略图 dataUrl LRU 缓存（容量 300）
│  └─ components/Common/
│     └─ LazyImage.tsx          # IntersectionObserver 懒加载图片组件
└─ main/
   ├─ services/
   │  └─ thumbnailService.ts    # nativeImage 缩略图管线（内存+磁盘两级缓存）
   └─ ipc/handlers/
      └─ thumbnailHandlers.ts   # thumbnail:get / thumbnail:invalidate IPC handler
```

**IPC 命名空间表增量 — `thumbnail`：**

| IPC 通道 | 入参 | 返回 | 注册位置 | 说明 |
|---|---|---|---|---|
| `thumbnail:get` | `{ sourcePath: string; size?: 256\|384 }` | `{ dataUrl, mime, fromCache }` 或 `{ error }` | `ipc/index.ts:128` `registerThumbnailHandlers()` | 生成/读取缩略图 dataUrl（命中内存→磁盘→重新生成） |
| `thumbnail:invalidate` | 无 | `{ ok: true }` 或 `{ ok:false, error }` | 同上 | 粗粒度清空全部缩略图缓存（内存 LRU + 磁盘目录） |

**服务表增量 — `thumbnailService`：**

| 服务 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| `thumbnailService`（单例） | `src/main/services/thumbnailService.ts` | 基于 Electron `nativeImage` 的缩略图生成 + 两级缓存（内存 LRU 200 + 磁盘 `userData/thumbnails/<sha1>.<jpg\|png>`） | `electron.nativeImage`、`lru-cache@11`、`crypto`；零新原生依赖 |

**IPC 注册顺序增量：** `registerThumbnailHandlers()` 在 `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 中调用（与 `registerAssetHandlers` / `registerTagRagHandlers` 等同模式）。

#### 关键设计决策

1. **nativeImage 选型（零新原生依赖）**：优先 Electron 内置 `nativeImage`，避免引入 `sharp`（需 electron-rebuild，受 Native Module Test Gap Convention 约束）。详见 §8.10。
2. **输出格式**：`nativeImage.toDataURL()` 的 WebP 支持随版本/平台变化不可靠；改用 PNG 源→PNG（无损保留透明）、其余→JPEG(80)（体积小）。
3. **dataUrl vs Blob URL（最小实现优先）**：thumbnail IPC 返回 dataUrl 字符串可直接作 `<img src>`（CSP 兼容），无需 Blob URL，省去 `revokeObjectURL` 生命周期管理。详见 `imageCache.ts` 文件头 + §8.9。
4. **双清失效**：`invalidateImageCache()` 同步清渲染 LRU + 异步调 `thumbnail:invalidate` IPC 清主进程缓存，保证素材替换/删除后彻底失效。
5. **缓存键**：主进程 `sha1(sourcePath|mtimeMs|size)`（含 mtime，编辑后自动失效）；渲染进程 `${sourcePath}::${size}`（仅作 IPC 前置命中层，主进程负责 mtime 失效）。

### §15.5 重渲染优化

| 维度 | 范围 | 文件 |
|------|------|------|
| zustand selector 化 | 105 处无 selector 调用点中 93 处转为 `useXxxStore(s => s.field)` 精准订阅；12 处 >5 字段暂缓并加 `// TODO(perf)` 注释 | ~49 个 renderer 文件（App.tsx / Sidebar / Header / Dashboard / CharacterManager / AssetManagerModal 等） |
| React.memo + useCallback | 所有列表项组件 + handler 稳定化 | AssetManagerModal / CharacterManager / CharacterListView / KnowledgeItemList / PromptManagement / AvatarManager / CreationCenter |

- selector 审计全量清单（93 处修复 + 12 处暂缓）见 §8.6。
- 重渲染优化明细见 §8.7（AssetManagerModal）/ §8.8（其余列表页）。

### §15.6 关键约束与遗留

1. **Native Module Test Gap Convention（nativeImage）**：`thumbnailService` 依赖 Electron 运行时 `nativeImage`，vitest 无法加载，真实行为（resize/格式转换/缓存命中）依赖 Electron 集成测试补位。已在 `thumbnailService.ts:34-36` 与 `thumbnailHandlers.ts:14-15` 文件头标注。若质量不足可切 `sharp`，但需 electron-rebuild + 同样受该约定约束。
2. **运行时指标待用户验证**：基线从未采集（Task 1.3 延迟至用户）。滚动 ≤100ms / 图片首屏 -50% / 长任务数=0 三项需用户在 dev 模式用 `perfBaseline.ts` 工具采集后回填 §8.1 基线表，方可判定达标。
3. **重点标记项汇总**（详见 §8.10）：
   - visualizer ESM 静态 import 构建失败（§8.5）
   - nativeImage Native Module 约束（不可单测）
   - dataUrl vs Blob URL 设计调整（最小实现优先）
   - Task 4 CharacterListView 委托发现（CharacterManager 不直接渲染列表）
4. **暂缓项**：12 处 zustand 整体订阅（>5 字段）保留并加 `// TODO(perf)` 注释，待后续拆分。

---

## §16 设置页页签化重构（UI 重构：单页堆叠 → antd Tabs 分组）

### 概述
将 `src/renderer/components/Settings/Settings.tsx` 的设置页从「7 个子面板垂直堆叠在单页」改造为「antd `Tabs` 5 个页签分组」布局。纯 UI 层改动，**未修改任何子面板组件、store、IPC、类型**。底部分隔线 + 3 个操作按钮（保存设置 / 打开配置文件 / 重置设置）保持在 `<Tabs>` 之外，沿用原 `handleSave` / `handleOpenConfigFile` / `handleReset`。

### 5 个页签分组（顺序固定）
| key | label | 子面板 |
| --- | --- | --- |
| `general` | 通用 | `GeneralSettingsPanel`（接收共享 `form`） |
| `ai-engine` | AI 引擎 | `AIEngineSettingsPanel`（接收共享 `form`） |
| `image-gen` | 图像生成 | `SDWebuiSettings`（ref: `sdWebuiConfigRef`） |
| `vector-rag` | 向量与 RAG | `VectorConfigPanel`（ref: `vectorConfigRef`）+ `TagRagSettings`（ref: `tagRagConfigRef`） |
| `tags-search` | 标签与搜索 | `TagAutocompleteSettings`（ref: `tagAutocompleteConfigRef`）+ `WebSearchSettings`（ref: `webSearchConfigRef`） |

### ⚠️ 重点标记：`forceRender: true` 是硬性约束（违反会丢数据）
**这是本次重构唯一可能导致数据丢失的约束，必须长期保留。**

- 父组件 `handleSave` 通过 5 个 ref 的 `getFormValues()` 收集子面板表单值，并使用条件展开合并：`...(sdWebuiConfig ? { sdWebui: sdWebuiConfig } : {})`。
- 若某个 ref 对应的子面板未挂载，`ref.current` 为 `null`，`getFormValues()` 返回 `undefined`，该配置字段会被**静默丢弃**，导致 `settings.json` 中对应字段缺失 → **数据丢失**。
- 因此 **5 个页签 item 必须全部设置 `forceRender: true`**，确保所有子面板在首屏即挂载（即使页签未激活）。
- antd v6 已废弃 `destroyInactiveTabPane`，默认行为即「非激活页签保持挂载」，**不要**设置 `destroyOnHidden`（默认 false 即保持挂载，符合需求）。也不要改回 `destroyInactiveTabPane`。

### antd v6 API 适配
- `Tabs` 使用 `items` API（非旧版 `<Tabs.TabPane>` 子元素写法）。
- **`tabPosition` 已废弃**，改用 `tabPlacement="top"`。本实现使用 `tabPlacement="top"`。
- 不要引入 `destroyInactiveTabPane` / `tabPosition`。

### 状态与导入变更
- 新增 `activeTab` 状态：`const [activeTab, setActiveTab] = useState('general');`（位于既有 `useState` 附近）。
- antd 导入追加 `Tabs`：`import { Form, Button, Space, message, Divider, Tabs } from 'antd';`。
- `useState` / `useMemo` 复用既有 React 导入，无需新增。
- 所有 `useEffect`（设置表单值 / `dashboardBackgroundImage` / `debugMode`）、5 个 ref 声明、`activeEngine` useMemo、`handleSave` / `handleOpenConfigFile` / `handleReset` **均未改动**。

### CSS 增量（`Settings.css` 末尾追加，未删除任何既有规则）
```css
/* 页签内首个卡片去除顶部间距，避免页签栏下方出现多余空白 */
.settings .ant-tabs-tabpane > .ant-card:first-child { margin-top: 0 !important; }
/* 页签内容区顶部留白 */
.settings .ant-tabs-tabpane { padding-top: 4px; }
/* 页签标签文字颜色适配主题 */
.settings .ant-tabs-tab { color: var(--text-secondary); }
.settings .ant-tabs-tab-active .ant-tabs-tab-btn { color: var(--color-primary, #1677ff); font-weight: 500; }
```
说明：多个子面板的 `Card` 使用 `style={{ marginTop: 16 }}`，页签化后首个卡片顶部会出现多余空白，故用 `:first-child` 选择器置零；卡片间距仍由既有 `.settings .ant-card { margin-bottom: 16px; }` 维持。

### 涉及文件清单
- `src/renderer/components/Settings/Settings.tsx` — 导入 `Tabs` + 新增 `activeTab` 状态 + 将 7 个子面板堆叠替换为 5 页签 `Tabs`（每个 item `forceRender: true`）+ 底部按钮区保持在 `<Tabs>` 之外。
- `src/renderer/components/Settings/Settings.css` — 末尾追加 4 条页签相关样式，既有规则全部保留。

### 验证状态
- 静态检查（findstr）：`tabPosition` / `destroyInactiveTabPane` 均未出现；`tabPlacement="top"` 存在；`forceRender: true` 出现 5 次（与 5 个页签一一对应）；3 个底部按钮 handler 与 `<Divider />` / `<Space>` 结构完整保留。
- **未运行 dev server / build**（按任务要求仅做静态编辑与读校验）。运行时回归需在 dev 模式下逐页签切换并执行一次「保存设置」后检查 `settings.json` 中 `sdWebui` / `vector` / `webSearch` / `tagAutocomplete` / `tagRag` 字段是否完整保留（用于验证 `forceRender` 生效、未丢字段）。

---

## §17 表情预置提示词优化脚本（Spec: optimize-expression-preset-prompts，2026-08-07）

### 概述

一次性 TypeScript 脚本 `scripts/optimize-expression-prompts.ts`（约 1016 行），用于优化 `PromptBuilder.ts:1480-1512` 中硬编码的 `EMOTION_PROMPT_MAP`（31 种情绪的 SD 提示词）。

**问题背景**：原 `EMOTION_PROMPT_MAP` 存在两个缺陷：
1. 大量 tag 不在 Danbooru/e621 标签库中（如 `aroused`、`lustful`、`heavy breathing` 等）
2. 仅含面部表情描述，缺少 4 个维度（面部表情 / 动作 / 符号 / 背景）

**脚本能力**：对每个情绪调 LLM 生成 4 维度候选 tag → 走 L0-L3b 审计链质检 → 输出 JSON 报告 + 可粘贴的 TypeScript 代码。

### 执行方式

```bash
npx tsx scripts/optimize-expression-prompts.ts
```

依赖：
- 应用中已配置 AI 引擎（`baseUrl` / `apiKey` / `modelName`），读取自 `%APPDATA%/creative-cafe/data/settings.json`
- `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv` 标签库文件存在

### 输出文件

| 文件 | 用途 |
|---|---|
| `scripts/expression-prompt-optimization-report.json` | 详细审计报告（每情绪的 4 维度 tag、审计结果、failed tag 列表） |
| `scripts/expression-prompt-map.generated.ts` | 可粘贴替换 `EMOTION_PROMPT_MAP` 的 TypeScript 代码片段 |

### 路径处理方案（B + C 混合）

脚本在 Node.js（非 Electron）环境下直接运行，因此对 Electron 依赖采取以下策略：

| 服务 | 处理方式 | 原因 |
|---|---|---|
| `tagAutocompleteService` | **直接 import**（方案 C） | 该服务内部 `resolveBundledCsvPath()` 已有 `__dirname` 兜底，try/catch 失败时降级到 `path.join(__dirname, '..', '..', '..')` 推导项目根目录，可在 Node.js 中无 Electron 时正常加载 `docs/` 下的 CSV |
| `aiConfigProvider` / `storageService` | **直接读 settings.json**（方案 B） | 这两个服务 import `ipcMain` 等 Electron 模块，在 Node.js 中无法直接 import；脚本改为直接读取 `%APPDATA%/creative-cafe/data/settings.json` 解析 `aiEngines` / `activeEngineId` |
| `userSynonymMapService` | **跳过 L0**（方案 B） | 该服务在 Node.js 下因 `getUserDataPath()` 路径与生产环境不一致（缺少 `creative-cafe` 子目录后缀），可能读到错误位置，故脚本省略 L0；对一次性优化无影响 |
| `tagRagService` / `characterTraitAIService` | **不 import**（方案 B） | 依赖 `sqlite-vec` 向量数据库与 `storageService`，在 Node.js 中无法直接 import；脚本中实现简化版审计逻辑替代 |

### 审计链实现（简化降级 L0-L3b）

完整审计链包含 7 层（参见 `tagRagService.validateTagsAgainstLibrary` 与 `characterTraitAIService.applyTagAudit`）：

| 层级 | 名称 | 脚本实现 | 说明 |
|---|---|---|---|
| L0 | 用户自定义同义词映射 | ❌ 跳过 | `userSynonymMapService` 路径不一致问题 |
| L1 | name 精确匹配 | ✅ 复用 `tagAutocompleteService.getTagByName` | 含空格/下划线互转 |
| L2 | alias 精确匹配 | ✅ 复用 `tagAutocompleteService.getTagByAlias` | 含空格/下划线互转 |
| L3 | 颜色拆分 | ✅ 复用 `splitColorTag`（脚本内重实现） | 与 `tagRagService.splitColorTag` 等价 |
| L3b | 否定性修饰词剥离 | ✅ 复用 `stripNegationModifier`（脚本内重实现） | 与 `tagRagService.stripNegationModifier` 等价 |
| L4 | KNN 语义检索 | ❌ 跳过 | 依赖 `sqlite-vec` 向量数据库 |
| L5 | AI 兜底 | ❌ 跳过 | 依赖额外 LLM 调用，保留人工审核入口 |

未通过 L1-L3b 的 tag 标记为 `failed: true`，写入报告 `abnormalPrompts` 列表，由用户在应用内通过 `RagQualityReport` UI 处理。

### 关键函数

| 函数 | 职责 |
|---|---|
| `loadAIConfig()` | 从 `settings.json` 读取激活引擎配置（baseUrl/apiKey/modelName/temperature/maxTokens），缺失即抛错退出 |
| `generateCandidateTags(emotionKey, emotionLabel, aiConfig)` | 调 LLM `${baseUrl}/v1/chat/completions`（非流式），按 `---FACE---` / `---ACTION---` / `---SYMBOL---` / `---BACKGROUND---` 4 个分隔符解析为 `CandidateTags` |
| `auditTag(tag)` | 单个 tag 的 L1-L3b 审计，返回 `{ originalTag, isValid, canonicalName?, replacedBy?, source, failed }` |
| `auditCandidateTags(candidateTags)` | 合并 4 维度 tag → 逐个审计 → 去重 → 返回 `{ auditedTags, failedTags, tagAuditDetails }` |
| `writeReport(report)` | 写入 `expression-prompt-optimization-report.json` |
| `writeGeneratedMap(results)` | 生成 `expression-prompt-map.generated.ts`，格式与原 `EMOTION_PROMPT_MAP` 完全一致 |
| `main()` | 主流程编排：加载标签库 → 校验配置 → 遍历 31 情绪 → 汇总 → 输出报告 |

### 错误恢复

- 单个情绪生成失败：记录 `error` 字段并继续下一个情绪（不中断）
- 失败的情绪：`finalPositive` 为空字符串，便于人工补全
- 标签库加载失败：抛错退出（致命错误）
- AI 引擎配置缺失：抛错退出（致命错误）

### ⚠️ 已知限制（需用户注意）

1. **L4 KNN 与 L5 AI 兜底未实现**：脚本仅做 L1-L3b 审计。若需完整的 7 层审计，请在应用内通过 `RagQualityReport` UI 触发。
2. **L0 用户自定义同义词映射跳过**：脚本不读取 `user-synonym-map.json`（路径不一致问题）。若需复用历史人工审核结果，可在应用内通过 `applyTagAudit` 处理。
3. **AI 引擎配置读取依赖 settings.json 路径**：脚本硬编码 `%APPDATA%/creative-cafe/data/settings.json`（Windows）。macOS / Linux 路径见 `getSettingsPath()` 实现。
4. **生成代码需人工粘贴**：脚本输出 `expression-prompt-map.generated.ts`，需手动将其中 `EMOTION_PROMPT_MAP` 整体复制粘贴到 `PromptBuilder.ts:1480-1512` 位置。
5. **NSFW 保留**：系统提示词明确告知 LLM 保留成人向表达，但使用 Danbooru/e621 标签库中的合法 tag。生成的提示词仍可能包含 NSFW 内容。

### 涉及文件清单

- `scripts/optimize-expression-prompts.ts` — 新建脚本（约 1016 行）
- 复用：`src/main/services/tagAutocompleteService.ts`（直接 import）
- 输出：`scripts/expression-prompt-optimization-report.json` + `scripts/expression-prompt-map.generated.ts`

### 验证状态

- **类型检查通过**：`npx tsc --noEmit --skipLibCheck --target ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop scripts/optimize-expression-prompts.ts` 返回 exit code 0（脚本顶部 `// @ts-nocheck` 是为了兼容 Electron 类型推断失败的场景，本机环境下移除也可通过）。
- **加载验证通过**：`npx tsx -e "require('./scripts/optimize-expression-prompts.ts')"` 成功加载，无运行时错误。
- **审计链 smoke test 通过**：对 16 个测试 tag（含 valid / invalid / 颜色拆分 / 评级词）走 L1-L3b，结果符合预期：
  - `open_mouth` / `blue_eyes` / `blush` / `smile` / `looking_at_viewer` / `panting` / `half-closed_eyes` → L1 name 命中
  - `sweat_drops` → L2 alias 命中，canonicalName=`sweatdrop`
  - `light_gray_drooping_ears` → L3 颜色拆分，split 为 `grey_ears` + `drooping_ears`
  - `lustful` / `flushed_skin` → FAILED（不在标签库，标记为异常 tag）
  - `nsfw` → source='rating'（评级词，不视为 failed）
- **未执行完整 LLM 调用**：避免消耗 API 配额与时间，主流程 `main()` 由用户自行执行。

## §18 拆分标签视觉标识 + 组合方案下拉支持 traitSnapshot（Spec: optimize-trait-translation-and-temp-scheme / Task 4 + Task 8，2026-08-07）

> 增量章节：本节仅归档 AssetManagerModal 侧的 Task 4（拆分标签 UI 标识）+ Task 8（组合方案下拉支持 traitSnapshot）。完整 spec 含 9 个 Task，其余 Task 由并行 agent 处理或前序任务已完成。

### 概述

为 L3 颜色拆分生成的特征标签（`originalText` 存在）添加视觉标识，让用户能识别拆分产物并查看原始复合标签文本；同时为含 `traitSnapshot` 的组合方案在下拉中加 📋 标识，让用户能预知方案应用行为（完整替换 traits vs 仅切换 enabled）。

### 关键数据字段（Task 1 已扩展，本节消费）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `CharacterTraitItem.originalText` | `string?` | L3 颜色拆分时设置（如 `grey long hair` 拆分为 `grey_hair` + `long_hair`，两者 originalText 均为 `grey long hair`）；手动编辑后清空 |
| `TraitCombination.traitSnapshot` | `CharacterTraitItem[]?` | 完整特征快照（含临时标签/编辑文本/启用状态）；从 AssetGenerateModal 保存时写入，从 AssetManagerModal 保存时不写入（仅 traitIds） |
| `CharacterTraitItem.weight` / `CategorizedTrait.weight` | `number?` | SDXL 提示词权重（Spec: add-sdxl-prompt-weight-support）。默认 `undefined` 等价 1.0，范围 0.1-10.0（1 位小数）。`applyTraitsAndLora` 在 `weight !== 1.0 && !== undefined` 时格式化为 `(text:weight)` 语法（兼容 Forge Neo lark 解析器）。AI 生成时可选产出（LLM 输出 `分类:tag\|中文翻译\|权重` 三段格式）；L4/L5 审计替换时继承原 weight，L3 颜色拆分时两个新 trait 均重置为 `undefined`；手动编辑 trait.text 时 weight 保持不变（与 originalText 清空策略不同）。详见 docs/FIX_RECORDS.md §7.24 |

### AssetManagerModal 改动点

#### 1. 拆分标签视觉标识（`renderTraitChip`，Task 4.1 + 4.2）

特征 chip 渲染结构为自定义 `<span>` chip（**非 antd `<Tag>`**），文字部分包裹在 antd `<Tooltip>` + `<span>` 中：

```tsx
<Tooltip
  title={
    trait.originalText
      ? (
        <div style={{ lineHeight: 1.6 }}>
          <div>原标签：{trait.originalText}</div>
          <div>拆分为：{trait.text}</div>
          {trait.translation && <div>翻译：{trait.translation}</div>}
        </div>
      )
      : trait.translation || ''  // 旧行为：仅显示翻译，空字符串不弹出
  }
>
  <span
    onClick={() => handleStartEdit(trait.id)}
    style={{ cursor: 'text', lineHeight: '20px', display: 'inline-flex', alignItems: 'center' }}
  >
    {trait.originalText && (
      <SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />
    )}
    {trait.text}
  </span>
</Tooltip>
```

- `originalText` 存在 → Tooltip 显示三行（原标签 / 拆分为 / 翻译，翻译行可选），文字前显示 `SplitCellsOutlined` 拆分图标
- `originalText` 不存在 → Tooltip 维持旧行为（仅显示 translation，空字符串不弹出），文字前不显示图标
- span style 新增 `display: 'inline-flex'` + `alignItems: 'center'`，确保图标与文字垂直对齐

#### 2. 组合方案下拉 📋 标识（Task 8.2）

```tsx
<Select
  options={[
    { value: '__manual__', label: '手动模式' },
    ...combinations.map((c) => ({
      value: c.id,
      label: c.traitSnapshot ? `${c.name} 📋` : c.name,
    })),
  ]}
/>
```

含 `traitSnapshot` 的方案名后加 📋 emoji 后缀，提示用户该方案应用时会完整替换 traits（含临时标签/编辑文本）；无 traitSnapshot 的方案维持原名（仅切换 enabled）。

#### 3. `handleApplyCombination` 透传（Task 8.1）

```tsx
const handleApplyCombination = useCallback(
  (combinationId: string) => {
    if (combinationId === '__manual__') return;  // 手动模式守卫保留
    const result = applyCombination(combinationId);  // store 内部自动走 traitSnapshot vs traitIds 分支
    if (!result.success) {
      message.warning(result.error || '应用组合失败');
    }
  },
  [applyCombination],
);
```

**未修改**：store 的 `applyCombination(id|null)` 已在 Task 7 中实现 traitSnapshot vs traitIds 自动分支（含快照 → 完整替换 traits 深拷贝；无快照 → 仅切换 enabled），前端透传即可。

### 关键约束

- **AssetManagerModal 保存方案不写 traitSnapshot**：`handleOpenSaveCombination` 调用 `saveCombination(trimmed)`（不传 snapshot 参数），与 spec 设计一致 —— AssetManagerModal 保存的是「启用集合快照」（仅 traitIds），AssetGenerateModal 保存的是「完整工作区快照」（traitSnapshot，含临时标签）。
- **未触碰 store / IPC / 持久化逻辑**：本次改动为纯 UI 渲染层（Tooltip title + span 内插图标 + options label 派生），所有数据流由前序 Task 1（类型）+ Task 7（store）已铺好。

### 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 导入 `SplitCellsOutlined` / `renderTraitChip` Tooltip + 拆分图标 / 组合方案下拉 options 📋 标识

### 验证状态

- **TypeScript 类型检查通过**：`npx tsc --noEmit -p tsconfig.json` 全量检查 → `AssetManagerModal.tsx` 零错误（整个项目仅 1 处预存无关错误 `writing.constants.ts:9`）。
- **待补全**：AssetGenerateModal 侧的 Task 4.3（拆分图标同步）/ Task 5（临时方案保存按钮）/ Task 6（组合方案下拉）由并行 agent 处理，本节不覆盖。

## §19 ⚠️ Bug 修复：弹窗/模态框组件暗色主题颜色不匹配（2026-08-07）

### 问题描述

应用支持亮色/暗色主题切换（通过 `src/renderer/styles/ui-variables.css` 中 `:root` / `.dark` 定义的 CSS 变量，由 `document.body` 上的 `.dark` class 切换）。但多个 Modal/弹窗组件在内联 `style={{}}` 中使用了**硬编码的亮色模式十六进制颜色值**，导致暗色主题下出现：
- 亮白色背景框（刺眼）
- 文字不可见（亮色文字 on 亮色背景 / 暗色文字 on 暗色背景）
- 边框颜色不随主题变化

### 根因

组件开发时直接内联了 antd 默认亮色色板值（如 `#fff1f0`、`#f6ffed`、`#fafafa`、`#000`、`#8c8c8c` 等），未引用 `ui-variables.css` 中已定义的 CSS 变量。

### 修复方案

将内联 style 中的硬编码颜色值替换为对应的 CSS 变量，仅修改颜色相关属性（`background`、`backgroundColor`、`border`、`borderColor`、`color`、`borderBottom` 等），不改动布局、逻辑、className 或非颜色样式。

#### 颜色映射表

| 硬编码值 | CSS 变量 |
|---|---|
| `#ffffff` / `#fff`（容器背景） | `var(--bg-container)` |
| `#fafafa` / `#f5f5f5` / `#f0f2f5`（面板背景） | `var(--bg-elevated)` |
| `#fff1f0` / `#fff2f0`（错误浅背景） | `var(--color-error-light)` |
| `#f6ffed`（成功浅背景） | `var(--color-success-light)` |
| `#fffbe6`（警告浅背景） | `var(--color-warning-light)` |
| `#e6f7ff`（信息浅背景） | `var(--color-info-light)` |
| `#f0f0f0` / `#e8e8e8` / `#f5f5f5`（浅边框） | `var(--border-base)` |
| `#d9d9d9`（中浅边框） | `var(--border-secondary)` |
| `#b7eb8f`（成功边框） | `var(--color-success)` |
| `#ffe58f`（警告边框） | `var(--color-warning)` |
| `#000` / `#000000`（主要文字） | `var(--text-primary)` |
| `#262626` / `#1a1a2e`（标题文字） | `var(--text-heading)` |
| `#595959` / `#8c8c8c`（次要文字） | `var(--text-secondary)` |

### 涉及文件清单

**已确认并修复的 5 个文件：**

- `src/renderer/components/Creative/WritingMode/QuickFixSuggestionModal.tsx` — 原文本/修正后/修正理由三个对比块的 backgroundColor + border + color
- `src/renderer/components/WorldBook/WorldBookAuthoringModal.tsx` — 事件流容器、StatCard、AuditProgressCard、AutoFixesList 修复前/后背景、ArrowRight、多处次要文字色
- `src/renderer/components/Creative/WritingMode/WritingAgentModal.tsx` — EVENT_META chapter_skipped 色、事件流容器、StatCard、空状态文字、事件消息文字
- `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx` — 维度卡片 borderColor、修正后文本块 background + border（2 处）
- `src/renderer/components/Character/CharacterListView.tsx` — 提示卡片 background + borderColor、角色书条目标题 borderBottom

**通过 grep 额外发现并修复的 2 个弹窗文件：**

- `src/renderer/components/KnowledgeBase/UploadDocumentModal.tsx` — 分块加载中文字色
- `src/renderer/components/PromptManagement/PromptEditor.tsx` — AI 润色结果对比弹窗推荐框架卡片 background + borderColor

### 未修改的硬编码颜色（说明）

以下硬编码颜色**有意保留**，未做替换：

- `#1890ff`（主色蓝）：两个主题下值相同，非主题不匹配项，保留以减少改动。
- `#ffccc7`（QuickFixSuggestionModal 原文本块 border）：不在映射表中，为 error 浅边框，保留。
- `#1a1a2e` 作为**背景**（PlotCheckReportModal 原文展示/批量修正工具栏/结果卡片）：映射表中 `#1a1a2e` 仅标注为"标题文字"用途；此处用作代码块深色背景（配套浅色文字 `#c8d6e5`），若替换为 `var(--text-heading)` 会导致暗色主题下浅色背景 + 浅色文字不可见，故保留。
- `#c8d6e5`、`#333`、`#f0f9eb`、`#52c41a`（作为 borderLeft 装饰）、`#faad14`（作为 borderLeft 装饰）等：不在映射表中或为装饰性强调色，保留。
- `rgba(...)` 表达式、`linear-gradient` 渐变：按规则不动。

### 跳过的非弹窗文件

以下文件虽被 grep 命中但**非弹窗/模态框组件**，按 scope 要求跳过：

- `ShardDetailPanel.tsx`（Card 面板，常驻显示）
- `OutlineEditor.tsx`（编辑器组件）
- `WorldBookEditPage.tsx`（页面组件）
- `StoragePathDisplay.tsx`（路径展示组件）
- `ChatHeader.tsx`（聊天头部）

### 验证方式

修复后重新运行 grep 确认 7 个目标文件中映射表覆盖的硬编码颜色值已全部替换为 CSS 变量；仅剩 `var(--xxx, #hex)` 形式的 CSS 变量回退值（已是正确的主题适配写法）。未运行 tsc 或 dev server（按要求）。

---

## §20 ADetailer Furry/拟人生物面部识别模型扩展（2026-08-07）

### 背景
原 ADetailer 检测模型预设仅 9 项（`face_yolov8n.pt` 等），全部针对人类面部训练，对兽人/furry/kemono 等拟人生物面部识别率低。本次扩展新增 3 个检测模型 + 1 个条件字段，覆盖 furry/兽人/动物面部场景。详见 `docs/FIX_RECORDS.md` §7.25。

### 新增检测模型（`ADETAILER_MODEL_OPTIONS`，SDWebuiSettings.tsx）
| 模型文件 | 类型 | 用途 |
|----------|------|------|
| `yolov8x-worldv2.pt` | YOLO-World 开放词汇 | 零样本检测任意类别，配合 `adModelClasses` 文本提示检测 furry/兽人面部（ADetailer-Neo 预装） |
| `Anzhc HeadHair seg y8m.pt` | 头部+毛发分割 | 兽人头部覆盖更全（含耳朵/毛发），mAP50=0.867（需下载） |
| `Anzhc Face seg 640 v4 y11n.pt` | 高精度插画人脸 | 动漫风 kemono 面部精度更高，mAP50=0.835（需下载） |

### 新增配置字段：`adModelClasses`（SDWebuiConfig）
- **类型**：`string?`（可选，默认空字符串）
- **作用**：仅当 `adModel` 为 YOLO-World 系列（文件名含 "world"）时生效，透传给 ADetailer-Neo 的 `ad_model_classes` → `ultralytics_predict(classes=...)`，实现零样本开放词汇检测。
- **空字符串**：使用模型默认 COCO 80 类；填入文本提示如 `furry face, anthro head, animal head, kemono face` 可检测任意类别。
- **非 YOLO-World 模型**：此字段被忽略（sdGenerationService 条件透传，仅 `_world` 模型 + 非空时写入 adArgs）。

### UI 条件渲染（SDWebuiSettings.tsx）
- `Form.useWatch('adModel')` 监听当前检测模型。
- YOLO-World 模型（`includes('world')`）→ 显示「检测类别（ad_model_classes）」TextArea。
- Anzhc 模型（`startsWith('Anzhc')`）→ 显示下载提示 Alert（HuggingFace 链接 + `models/adetailer/` 路径）。

### 字段同步约束
`adModelClasses` 新增到 `SDWebuiConfig` 接口后，4 处 DEFAULT_CONFIG 必须同步（项目铁律：新增可选字段到持久化数据结构时必须检查所有对象重构路径）：
1. `src/shared/settings.ts` — `defaultSetting.sdWebui`
2. `src/renderer/components/Settings/SDWebuiSettings.tsx` — `DEFAULT_SD_WEBUI_CONFIG`
3. `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` — `DEFAULT_SD_CONFIG`
4. `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `DEFAULT_SD_CONFIG`

2 处 Modal 参数构建处透传 `adModelClasses: sdConfig.adModelClasses`（ExpressionGenerateModal + AssetGenerateModal）。

### 涉及文件清单
`src/renderer/types/setting.ts` / `src/main/services/sdGenerationService.ts` / `src/shared/settings.ts` / `src/renderer/components/Settings/SDWebuiSettings.tsx` / `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` / `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`

## §21 侧边栏菜单调整：隐藏创意管理 + 设置固定底部（2026-08-08）

### 概述

将「创意管理」菜单项从侧边栏隐藏（路由仍保留可用），并将「设置」菜单项移动到菜单列表最下方并用分割线固定。

### RouteConfig 接口扩展

`src/renderer/routeConfig.ts` 的 `RouteConfig` 接口新增两个可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `hidden` | `boolean?` | 隐藏菜单项（不显示在侧边栏，但路由仍可通过 `findRouteComponent` 访问） |
| `pinnedBottom` | `boolean?` | 固定在菜单列表最下方，与上方菜单项之间用 antd Menu divider 分隔 |

### 改动点

1. **隐藏创意管理**：`routeConfigs` 中 `key: 'creative'` 项添加 `hidden: true`；`getMenuRoutes()` 过滤条件增加 `&& !route.hidden`，使隐藏项不出现在菜单中但路由组件仍可通过 `findRouteComponent` 查找到
2. **设置固定底部**：将 `key: 'settings'` 项从原位置（第 9 位）移动到 `routeConfigs` 数组末尾，并添加 `pinnedBottom: true`
3. **Sidebar 分离渲染**：`Sidebar.tsx` 将 `visibleRoutes` 分为 `normalRoutes`（非 pinnedBottom）和 `pinnedRoutes`（pinnedBottom），在两者之间插入 `{ type: 'divider' }` 分割线

### 涉及文件清单

- `src/renderer/routeConfig.ts` — RouteConfig 接口新增 `hidden` / `pinnedBottom` 字段；creative 项标记 `hidden: true`；settings 项移至数组末尾并标记 `pinnedBottom: true`；`getMenuRoutes` 过滤 hidden 项
- `src/renderer/components/Layout/Sidebar.tsx` — 菜单项构建逻辑分离 normal/pinned，pinned 项前插入 divider

## §22 ⚠️【重点标记】Bug 修复：设置页 agentModeOverride 未持久化 + debugMode 状态未同步（2026-08-08）

### 问题描述

用户在设置页 AI 引擎面板将「智能体模式」从「自动」切换为「强制关闭」后点击保存，刷新页面后设置恢复为「自动」。同时发现 `debugMode` 也存在类似的持久化问题。

### 根因分析

#### Bug 1（严重）：agentModeOverride 未加载到表单 + 未在 handleSave 中保存

`Settings.tsx` 的表单初始化 `useEffect`（第 46-71 行）中 `form.setFieldsValue` **未设置 `agentModeOverride` 字段**，导致刷新后 Segmented 控件不显示已保存的值（显示为空/默认）。

`handleSave`（第 84-182 行）中更新活跃引擎时，仅显式写入 `api_url` / `api_key` / `model_name` 等字段，**未写入 `values.agentModeOverride`**。依赖 `...engine` 展开保留了旧值，用户在主表单中的新选择被完全丢弃。

> 注意：引擎编辑模态框（`useAIEngineSettings.ts` 的 `handleSaveEngine`）通过 `...values` 展开**正确保存了** `agentModeOverride`。但主表单的「保存设置」按钮走的是 `Settings.tsx` 的 `handleSave`，不走 `handleSaveEngine`。

#### Bug 2（中等）：debugMode 状态未从已保存配置同步

`Settings.tsx` 第 27 行 `const [debugMode, setDebugMode] = useState(false)` 初始值为 `false`。`useEffect` 中 `form.setFieldsValue({ debugMode: setting.debugMode })` 仅设置了表单字段，**未调用 `setDebugMode(setting.debugMode)`** 同步本地 state。

`handleSave` 中 `debugMode: debugMode` 使用的是本地 state（始终为 `false`），而非表单值。若用户不手动切换开关直接保存，`debugMode` 会被错误重置为 `false`。

### 修复方案

`src/renderer/components/Settings/Settings.tsx`（修改）：

1. **useEffect 初始化**：
   - 新增 `setDebugMode(setting.debugMode || false)` — 同步 debugMode state
   - `form.setFieldsValue` 新增 `agentModeOverride: engine?.agentModeOverride || 'auto'` — 加载已保存的智能体模式到表单

2. **handleSave 引擎更新**：
   - 新增 `agentModeOverride: values.agentModeOverride || 'auto'` — 将表单中的智能体模式写入引擎配置

### 验证

- `tsc --noEmit` 对 `Settings.tsx` 零新增错误
- 验证流程：设置页选择「强制关闭」→ 保存设置 → 切换菜单再返回 → Segmented 控件应显示「强制关闭」

> ⚠️ **重点标记（2026-08-08 二次修复）**：首次修复声称已将 `agentModeOverride` 和 `setDebugMode` 加入 `useEffect`，但实际代码中并未应用（"Verify Implementation, Not Intent" 失败）。用户反馈切换菜单再返回后仍被重置为"自动"。二次检查确认 `useEffect` 的 `form.setFieldsValue` 中缺少 `agentModeOverride` 字段，`setDebugMode` 调用也缺失。已重新修复并验证代码实际包含这两行。

## §23 ⚠️【重点标记】Bug 修复：远程引擎 400 Bad Request — 非标准参数注入 + 认证默认值不一致（2026-08-08）

### 问题描述

用户选择远程引擎（如 DeepSeek 官方 API）时，ai-handler 模块返回 `400 Bad Request` 错误，导致所有远程引擎功能不可用。该问题为近期新出现的异常。

### 根因分析

#### 根因 1（严重）：非标准参数无条件注入

多个 AI 调用路径在请求体中无条件注入了 vLLM/Qwen3 专有参数，DeepSeek 等标准 OpenAI 兼容 API 不识别这些字段直接返回 400：

| 文件 | 注入位置 | 注入的参数 |
|------|---------|-----------|
| `useWorldBookAIOperations.ts` | 11 处 | `extra_body` / `chat_template_kwargs` / `enable_thinking: false` |
| `AIService.ts` | 2 处（callChatAPI + streamChatAPI） | `enable_thinking`（顶层无条件注入） |
| `aiClient.ts`（记忆整理） | 1 处 | `extra_body: { enable_thinking: false }` |

`ChatEngine.ts`（主聊天路径）已通过 `upgrade-ai-handler-multimodal-compatibility` Spec 建立了双条件守卫（`enable_chain_of_thought === true && capabilities.supportsThinking === true`），但其他调用路径未跟进。

#### 根因 2（高风险）：`stop: null` 显式发送

`useWorldBookAIOperations.ts` 在 5 处请求体中显式发送 `stop: null`，部分 API 将 `null` 视为无效参数。

#### 根因 3（高风险）：`api_key_transmission` 默认值不一致

渲染进程默认 `'body'`（API key 放请求体），主进程默认 `'header'`（放 Authorization header）。DeepSeek 仅支持 header 认证，当用户未显式设置时渲染进程路径会将 key 放入请求体，导致认证失败。

### 修复方案

#### 1. 移除非标准参数注入（`useWorldBookAIOperations.ts`）

- 移除全部 11 处 `extra_body` / `chat_template_kwargs` / `enable_thinking` 无条件注入
- 移除全部 5 处 `stop: null`
- 移除全部 12 处硬编码 `n: 1`（标准 API 默认 n=1）

思维链控制由 `AIService.ts` / `ChatEngine.ts` 中已有的能力感知逻辑处理，世界书等内联请求构建路径不需要重复注入。

#### 2. 能力感知守卫注入（`AIService.ts`）

`callChatAPI` 和 `streamChatAPI` 中的 `requestBody.enable_thinking` 改为双条件守卫：

```typescript
const supportsThinking = (config as any).capabilities?.supportsThinking === true;
if (config.enableChainOfThought === true && supportsThinking) {
  requestBody.enable_thinking = true;
}
```

与 `ChatEngine.ts` 已有的能力感知模式完全对齐：仅当用户启用思维链 **且** 模型探测支持时才注入。

#### 3. 移除 `aiClient.ts` 的 `extra_body`

移除记忆整理服务中的 `extra_body: { enable_thinking: false }` 无条件注入。

#### 4. 统一 `api_key_transmission` 默认值为 `'header'`

将所有渲染进程路径的 `|| 'body'` 改为 `|| 'header'`，共 7 个文件 22 处：

- `useCreativeAI.ts`（1 处）
- `settingStore.ts`（1 处）
- `Settings.tsx`（2 处）
- `useAIEngineSettings.ts`（3 处）
- `useWorldBookAIOperations.ts`（15 处）
- `useCharacterAIOperations.ts`（1 处，额外发现）
- `WorldBookEditor.tsx`（1 处，额外发现）

### 涉及文件清单

- `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 移除非标准参数 + `stop: null` + `n: 1` + 统一认证默认值
- `src/main/services/AIService.ts` — `enable_thinking` 改为双条件守卫注入
- `src/main/services/memory/aiClient.ts` — 移除 `extra_body`
- `src/renderer/components/Creative/hooks/useCreativeAI.ts` — 统一认证默认值
- `src/renderer/stores/settingStore.ts` — 统一认证默认值
- `src/renderer/components/Settings/Settings.tsx` — 统一认证默认值
- `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` — 统一认证默认值
- `src/renderer/components/Character/hooks/useCharacterAIOperations.ts` — 统一认证默认值（额外发现）
- `src/renderer/components/Creative/WorldBookEditor.tsx` — 统一认证默认值（额外发现）

### 验证

- `tsc --noEmit` 对所有修改文件零新增错误
- Grep 验证：`useWorldBookAIOperations.ts` 中不再包含 `extra_body`、`chat_template_kwargs`、`enable_thinking`、`stop: null`、`n: 1,`、`|| 'body'`
- 全局验证：渲染进程目录下不再包含 `api_key_transmission || 'body'`

## §24 ⚠️【重点标记】Bug 修复：远程引擎 400 错误根因 — topP NaN + n 参数 + 默认认证模式（2026-08-08）

### 问题描述

§23 修复后，世界书「AI 生成条目」功能使用 DeepSeek 引擎时仍返回 400 Bad Request。经深入排查发现三个遗留根因。

### 根因分析

#### 根因 1（严重）：`topP` 计算的 NaN bug（7 处）

`useWorldBookAIOperations.ts` 中 7 处函数使用了错误的 `topP` 计算模式：

```javascript
// BUG：Number(undefined) = NaN，NaN ?? throw 不抛异常（?? 只捕获 null/undefined）
const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();
```

默认设置中 `top_p: undefined`（`src/shared/settings.ts` 第 71 行），导致：
1. `Number(undefined)` = `NaN`
2. `NaN ?? throw` 不抛异常（`??` 只捕获 `null`/`undefined`，不捕获 `NaN`）
3. `topP` = `NaN`
4. `JSON.stringify({top_p: NaN})` = `'{"top_p":null}'`
5. DeepSeek 收到 `top_p: null` → **400 Bad Request**

文件中另有 8 处函数已使用安全模式（`typeof` 检查 + 默认 0.95），这 7 处未跟进。

**修复**：统一为安全模式 `(typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95`

#### 根因 2（严重）：`n: n` 参数未移除

`generateNewEntries` 函数的请求体中包含 `n: n,`（`n = Number(activeEngine.n) || 1` = 1）。DeepSeek API 不支持 `n` 参数，返回 400。

> 注：§23 修复中移除了 `n: 1,` 字面量，但遗漏了 `n: n,` 变量引用形式。

**修复**：移除 `n: n,` 行。

#### 根因 3（严重）：默认设置 `api_key_transmission: 'body'`

`src/shared/settings.ts` 第 160 行和 `storageService.ts` 第 243 行的默认引擎模板中 `api_key_transmission: 'body'`。§23 修复了代码中的 `|| 'body'` 默认值，但默认配置模板仍硬编码为 `'body'`。用户新建引擎时会继承此值，导致 API key 通过请求体传输，DeepSeek 仅支持 header 认证。

**修复**：将 3 处默认配置模板的 `api_key_transmission` 改为 `'header'`：
- `src/shared/settings.ts` 第 160 行
- `src/main/services/storageService.ts` 第 243 行
- `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` 第 113 行（新引擎模板）

### 涉及文件清单

- `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 7 处 topP 安全模式 + 移除 `n: n,`
- `src/shared/settings.ts` — 默认 `api_key_transmission: 'header'`
- `src/main/services/storageService.ts` — 默认 `api_key_transmission: 'header'`
- `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` — 新引擎模板 `api_key_transmission: 'header'`

### 验证

- `tsc --noEmit` 零新增错误
- Grep 验证：`Number(activeEngine.top_p) ??` 返回 0 结果
- Grep 验证：`n: n,` 返回 0 结果
- Grep 验证：`api_key_transmission.*['\"]body['\"]` 仅剩类型定义（`'header' | 'body'` 联合类型）

## §26 ⚠️【重点标记】Bug 修复：max_tokens 超过 API 限制导致 400 Bad Request（2026-08-08）

### 问题描述

世界书「AI 生成条目」功能使用 DeepSeek 引擎时返回 400 Bad Request。此 bug 经历多轮修复仍未解决，根因是**`max_tokens` 语义混淆**：用户配置的 `max_tokens` 表示上下文窗口大小（如 1024000 = 1M），但代码将其直接作为 API 的 `max_tokens` 参数（最大输出 token 数）发送，超过 API 限制（DeepSeek 为 393216）导致 400。

### 根因分析

- OpenAI 兼容 API 的 `max_tokens` 参数含义是「最大输出 token 数」，不是「上下文窗口大小」
- 用户配置 `max_tokens: 1024000`（1M 上下文），代码直接发给 API → API 返回 `Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`
- 连通性测试碰巧用了小值（`?? 1`）所以通过，世界书等操作直接用用户配置值导致 400

### 修复方案

**不再向 API 发送 `max_tokens` 参数**，让 API 自行使用模型默认的最大输出长度。用户的 `max_tokens` 配置保留作为上下文窗口参考，不作为 API 输出限制。

| 文件 | 修改处 |
|------|--------|
| `useWorldBookAIOperations.ts` | 13 处移除 `max_tokens: maxTokens,` |
| `ChatEngine.ts` | `maxTokens` 设为 `undefined` |
| `AIService.ts` | `maxTokens` 设为 `undefined` |
| `aiClient.ts` | `max_tokens` 设为 `undefined`，返回类型改为可选 |
| `useCreativeAI.ts` | 移除 `max_tokens: maxTokens,` |

### 验证

- 用 DeepSeek API 实测：不发送 `max_tokens` → 200 成功
- 用 DeepSeek API 实测：`max_tokens: 1024000` → 400 失败
- `tsc --noEmit` 零新增错误

## §27 max_tokens 参数全面评估与治理（2026-08-08）

### 评估背景

`max_tokens` 参数语义混淆问题经多轮修复后，引入了技术债务（`void maxTokens;` 无用变量、遗漏路径、截断检测失效等）。本次进行系统性治理。

### 评估结论

采用**方案 C：保留但不发送，清理技术债务**：
- 引擎配置中的 `max_tokens` 字段保留作为上下文窗口参考，不作为 API `max_tokens` 参数发送
- 系统调用 OpenAI 兼容 API 时不发送 `max_tokens` 字段，由 API 自行使用模型默认最大输出长度
- 例外：硬编码小值（如图像识别探测 `max_tokens: 5`）不受此规则约束

### 治理内容

| 文件 | 修改 |
|------|------|
| `characterAIUtils.ts` | **修复遗漏路径** — 移除 `maxTokens: engine.max_tokens`，不再直接发送用户配置值 |
| `AIService.ts` | 移除 `max_tokens` 必填校验；`EngineConfig.maxTokens` 改为可选类型；`getEngineConfig` 返回 `maxTokens: undefined` |
| `useWorldBookAIOperations.ts` | 移除 16 处 `void maxTokens;` / `void maxTokensVal;`；修复截断检测不再引用 `maxTokens` 变量 |
| `useCreativeAI.ts` | 移除 `const maxTokens = ...; void maxTokens;` 无用变量声明 |
| `settingStore.ts` | 连通性测试 `max_tokens` 改为固定值 `1` |

### 验证
- `void maxTokens` 全局 Grep 零匹配
- `characterAIUtils.ts` 中不含 `maxTokens: engine.max_tokens`
- `tsc --noEmit` 零新增错误

## §25 Bug 修复：AgentModeService 审计日志 MemoryStore 未初始化警告（2026-08-08）

### 问题描述

保存设置时触发 `reevaluateAgentModeFromSettings` → `agentModeService.reevaluate()` → `applyEvaluation` → `logModeChange`，在 MemoryStore 尚未初始化时 `getMemoryStore()` 抛出错误，产生警告日志：`[AgentModeService] Failed to write mode-change audit log: Error: MemoryStore not initialized.`

### 根因

`logModeChange` 在调用 `getMemoryStore()` 前未检查 MemoryStore 是否已初始化。应用启动早期或 MemoryStore 未使用时，`getMemoryStore()` 会同步抛错。虽然已有 try-catch 包裹不会崩溃，但错误日志造成干扰。

### 修复

1. `src/main/services/agent/memory/memoryStore.ts` — 新增 `isMemoryStoreInitialized()` 检查函数
2. `src/main/services/agent/management/agentModeService.ts` — `logModeChange` 调用 `getMemoryStore()` 前先检查 `isMemoryStoreInitialized()`，未初始化时直接 return 跳过审计日志
3. `src/main/services/agent/memory/index.ts` — 导出 `isMemoryStoreInitialized`

## §28 ChatMessageBubble 内联样式迁移至 CSS 类（2026-08-08）

### 概述

将 `ChatMessageBubble.tsx` 中大量内联 `style` 属性迁移为 CSS 类，统一在 `ChatMessageBubble.css` 中管理样式。同时将按钮的 `onMouseEnter`/`onMouseLeave` JS 事件处理器替换为 CSS `:hover` 伪类，textarea 的 `onFocus`/`onBlur` 替换为 CSS `:focus` 伪类。

### 改动内容

#### CSS 文件（`ChatMessageBubble.css`）

在现有 `.chat-action-btn` 等类之后、`@media (max-width: 480px)` 媒体查询之前，新增以下 CSS 类：

| CSS 类 | 用途 |
|--------|------|
| `.chat-msg-wrapper` / `.is-user` / `.is-assistant` | 消息外层容器（flex 布局 + 方向） |
| `.chat-msg-inner` / `.is-user` / `.is-assistant` | 内层容器（gap + max-width + 方向） |
| `.chat-msg-avatar` / `.is-user` / `.is-assistant` / `img` / `-fallback` | 头像容器 + 图片 + 文字回退 |
| `.chat-msg-content-col` | 消息内容列容器 |
| `.chat-msg-name` / `.is-user` / `.is-assistant` | 发送者名称 |
| `.chat-msg-seq-badge` | AI 回复序号徽标 |
| `.chat-msg-bubble` / `.is-user` / `.is-assistant` | 消息气泡（背景/圆角/阴影/动画） |
| `.chat-msg-edit-placeholder` | 编辑时的占位层 |
| `.chat-msg-edit-container` / `.is-user` / `.is-assistant` | 编辑容器（绝对定位覆盖） |
| `.chat-msg-edit-textarea` / `:focus` | 编辑文本框 + 聚焦样式 |
| `.chat-msg-cursor` | 流式输出光标 |
| `.chat-msg-timestamp` / `.visible` | 时间戳（hover 时显示） |
| `.chat-msg-version-info` / `.visible` | 版本信息行 |
| `.chat-msg-generating` / `-text` | 生成中指示器 |
| `.chat-msg-actions` / `.visible` / `.is-user` | 操作按钮容器 |
| `.chat-action-btn:hover:not(:disabled)` / `.edit-active` / `.copied` / `.error` / `:disabled` | 按钮状态样式（替代 JS 内联处理） |

#### TSX 文件（`ChatMessageBubble.tsx`）

1. **17 处内联 `style` 属性移除**：wrapper、inner、avatar、content-col、name、seq-badge、bubble、edit-placeholder、edit-container、textarea、cursor、timestamp、version-info、generating、actions 容器（AI + 用户）、按钮内联样式
2. **JS 事件处理器移除**：所有按钮的 `onMouseEnter`/`onMouseLeave`（hover 由 CSS `:hover` 处理）；textarea 的 `onFocus`/`onBlur`（由 CSS `:focus` 处理）
3. **按钮状态类名**：复制按钮 `copied` 类、编辑按钮 `edit-active` 类、重新生成按钮 `error` 类
4. **保留的内联样式**：「历史版本」span 的一次性样式（`fontSize`/`color`/`fontStyle`）按计划保留；`LoadingOutlined` 的 `fontSize` 内联样式保留

### 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 新增 15 个 CSS 类 + 按钮状态伪类
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 17 处内联样式替换为 CSS 类名，移除 JS 事件处理器

### 验证

- `GetDiagnostics` 对 `.tsx` 和 `.css` 文件均零错误
- 现有 CSS 类（`.chat-action-btn`、`.chat-msg-stripe`、`.suggested-options-*` 等）未被修改
- `@media (max-width: 480px)` 媒体查询保持在文件最末尾

## §29 角色卡对话功能全面优化（2026-08-08）

### 概述

对角色卡对话功能（`CharacterDialogueChat`）进行全面视觉样式、AI 参数配置、对话内容增强三维度优化。按 P0→P1→P2 优先级分批实施。

### P0：视觉样式修复与对话内容增强

#### ⚠️【重点标记】Bug V1：MessageRenderer 主题选择器不匹配

**问题**：`MessageRenderer.styles.css` 使用 `[data-theme="dark"]` / `[data-theme="light"]` 选择器，但全局主题系统使用 `.dark` class 切换。导致暗色模式下引号高亮颜色不生效。

**修复**：将 `[data-theme="dark"]` 替换为 `.dark`，移除 `[data-theme="light"]`（`:root` 即为亮色默认）。

**文件**：`MessageRenderer.styles.css`

#### ⚠️【重点标记】Bug V2/V3：亮色模式下建议选项文字不可见

**问题**：`ChatMessageBubble.css` 中 `.suggested-option-action` 使用 `rgba(255,255,255,0.55)`（白色半透明），在白色背景下几乎不可见。`.suggested-option-dialogue` 同理。

**修复**：替换为 CSS 变量 `--chat-option-action-color` / `--chat-option-dialogue-color`，在 `ui-variables.css` 中为亮色/暗色主题分别定义合适的颜色值。

**文件**：`ChatMessageBubble.css`、`ui-variables.css`

#### Bug V4：MessageRenderer 内联颜色硬编码

**问题**：`MessageRenderer.tsx` 中 `a` 标签内联颜色 `#1890ff` 与 CSS 变量 `--mr-link: #4a9eff` 不一致；`blockquote` 边框颜色同时存在于内联和 CSS 中。

**修复**：移除内联颜色硬编码，统一使用 CSS 变量 `var(--mr-link, #4a9eff)`。

**文件**：`MessageRenderer.tsx`

#### 引号高亮优化

- 移除 `text-shadow`（长文本中造成视觉疲劳）
- 降低 `font-weight` 从 600 到 500
- 添加微妙背景 `rgba(255,179,71,0.04)` + `padding: 0 2px` + `border-radius: 3px`

**文件**：`MessageRenderer.styles.css`

#### 思考内容折叠展示

**功能**：新增 `convertThinkingTags()` 函数，将 `<think>`/`<thinking>`/`<thought>` 标签内容转换为可折叠的 `<details>` 块（带 `💭 AI 思考过程` 标题），替代原有的 `stripThinkingTags()` 永久移除行为。

**配置链路**：
- `AIParameterConfig.show_thinking?: boolean` — 角色级配置
- `RenderConfig.markdown.showThinking?: boolean` — 渲染配置
- `MessageProcessorOptions.showThinking?: boolean` — 处理器选项
- `ParameterPanel` 新增"显示思考过程" Switch 开关
- `hooks.ts` 中 `stripThinkingTags` 调用增加 `&& !customParameters?.show_thinking` 守卫

**文件**：`messageProcessor.ts`、`MessageRenderer.config.ts`、`MessageRenderer.tsx`、`CharacterDialogueChat.types.ts`、`ParameterPanel.tsx`、`CharacterDialogueChat.tsx`、`CharacterDialogueChat.hooks.ts`

#### 行为描述（em/斜体）视觉区分

**功能**：`em` 元素（`*text*` 或 `_text_` Markdown 语法）从纯斜体升级为带背景色、内边距、圆角的主题化样式类 `.message-renderer-action`。

**文件**：`MessageRenderer.tsx`、`MessageRenderer.styles.css`

#### 角色名称突出显示

**功能**：角色名称从 `12px` + `color: var(--text-secondary)` 升级为 `13px` + `fontWeight: 600` + 主题化颜色（角色紫色 `--chat-character-name-color`，用户蓝色 `--chat-username-color`）。

**文件**：`ChatMessageBubble.tsx`（后迁移为 CSS 类 `.chat-msg-name`）

#### 交替背景色

**功能**：奇数序号 AI 消息使用微妙交替背景 `--chat-msg-stripe-bg`，缓解长对话阅读疲劳。

**文件**：`ChatMessageBubble.tsx`、`ChatMessageBubble.css`、`ui-variables.css`

### P1：AI 参数配置系统优化

#### top_k / min_p 参数全链路接入

**功能**：将 `top_k`（Top-K 采样）和 `min_p`（Min-P 采样）从系统设置扩展到角色卡级别可配置。

**改动链路**：

| 层级 | 文件 | 改动 |
|------|------|------|
| 类型定义 | `CharacterDialogueChat.types.ts` | `AIParameterConfig` 新增 `top_k?` / `min_p?` / `show_thinking?` |
| 参数配置 | `parameterConfigs.ts` | 新增 `top_k`（min:0, max:100, step:1, default:40）和 `min_p`（min:0, max:1, step:0.01, default:0）配置项，放入 `PARAMETER_CONFIGS`（始终显示，不依赖 capability 门控） |
| 参数合并 | `CharacterDialogueChat.hooks.ts` | `getEffectiveParams()` 新增 top_k/min_p 三级合并（customParams > globalEngine > 默认） |
| 参数注入 | `CharacterDialogueChat.hooks.ts` | 三处 `engineConfigWithParams` 注入：`requestAIResponse`（~L702）、`generateUserReply`（~L1830）、`polishInput`（~L2048） |
| 引擎配置 | `ChatEngine.types.ts` | `AIEngineConfig` 新增 `top_k?` / `min_p?` 字段 |
| 请求体 | `ChatEngine.ts` | 直接注入 `requestBody.top_k` / `requestBody.min_p`（与 `top_p` 模式一致，不经过 capability 门控） |

#### ChatMessageBubble 内联样式迁移

详见 §28。

### P2：对话气泡差异化设计

#### 气泡视觉差异化

| 元素 | 用户气泡 | AI 气泡 |
|------|----------|---------|
| 背景 | 蓝紫渐变（保持） | 暗色：`linear-gradient(135deg, rgba(30,30,46,0.8), rgba(40,40,60,0.8))`；亮色：`rgba(255,255,255,0.95)` |
| 阴影 | `0 4px 12px rgba(99,102,241,0.3)`（保持） | 暗色：`0 4px 16px rgba(0,0,0,0.25)`；亮色：`0 2px 8px rgba(0,0,0,0.06)` |
| 边框 | 无 | 暗色：`1px solid rgba(255,255,255,0.06)`；亮色：`1px solid rgba(0,0,0,0.04)` |
| 悬停阴影 | `0 6px 16px rgba(99,102,241,0.4)` | 暗色：`0 4px 20px rgba(0,0,0,0.3)`；亮色：`0 4px 12px rgba(0,0,0,0.1)` |
| 悬停边框 | — | 暗色：`rgba(255,255,255,0.12)`；亮色：`rgba(0,0,0,0.08)` |

**新增 CSS 变量**（`ui-variables.css`，亮色 `:root` + 暗色 `.dark`）：
- `--chat-bubble-user-shadow-hover`
- `--chat-bubble-assistant-shadow-hover`
- `--chat-bubble-assistant-border-hover`

**文件**：`ui-variables.css`、`ChatMessageBubble.css`

### 涉及文件清单

| 文件 | 改动概述 |
|------|----------|
| `ui-variables.css` | 新增 6 组 CSS 变量（角色名/用户名颜色、交替背景、选项颜色、思考/行为/引号颜色、气泡 hover 阴影+边框） |
| `MessageRenderer.styles.css` | 修复主题选择器；引号高亮优化；新增 `.message-renderer-thought-block`、`.message-renderer-action` |
| `MessageRenderer.tsx` | em 映射改为 CSS 类；a/blockquote 颜色改用 CSS 变量 |
| `MessageRenderer.config.ts` | 新增 `showThinking` 配置 |
| `messageProcessor.ts` | 新增 `convertThinkingTags()`；`processMessage` 支持 `showThinking` 选项 |
| `ChatMessageBubble.css` | 新增 15+ CSS 类（内联迁移）；气泡 hover/border 差异化；选项颜色改用 CSS 变量 |
| `ChatMessageBubble.tsx` | 17 处内联样式迁移为 CSS 类；角色名突出显示；交替背景；showThinking 透传 |
| `CharacterDialogueChat.types.ts` | `AIParameterConfig` 新增 `top_k`/`min_p`/`show_thinking` |
| `parameterConfigs.ts` | `PARAMETER_CONFIGS` 新增 `top_k`/`min_p` |
| `CharacterDialogueChat.hooks.ts` | `getEffectiveParams` 新增 top_k/min_p 合并；3 处注入；showThinking 守卫 |
| `CharacterDialogueChat.tsx` | 透传 showThinking 到 ChatMessageBubble 和 ParameterPanel |
| `ParameterPanel.tsx` | 新增"显示思考过程"开关 |
| `ChatEngine.types.ts` | `AIEngineConfig` 新增 `top_k`/`min_p` |
| `ChatEngine.ts` | 请求体直接注入 `top_k`/`min_p` |

### 验证

- 全部 14 个修改文件 TypeScript 诊断零错误
- 现有 CSS 类未被修改（向后兼容）
- `@media` 响应式规则保持在 CSS 文件最末尾

## §30 ⚠️【重点标记】Think 标签处理开关合并为三态选择（2026-08-08）

### 问题

原设计有两个独立开关：
- `strip_think_tags`（Think 标签处理）：控制存储前是否剥离 think 标签
- `show_thinking`（显示思考过程）：控制渲染时是否折叠展示

实际行为矩阵暴露冗余：当 `show_thinking=true` 时，`strip_think_tags` 无论开不开都无效（存储前永远不剥离）。两个开关并列展示但实际是 `show_thinking` 优先级高于 `strip_think_tags`，用户无法直观理解。

### 修复方案

合并为一个三态选择 `think_tag_mode: 'strip' | 'strip_render' | 'fold'`：

| 模式 | 存储前处理 | 渲染时处理 | 效果 |
|------|-----------|-----------|------|
| `strip`（默认） | 剥离 | — | 彻底移除，不污染上下文 |
| `strip_render` | 保留 | 渲染时剥离 | 用户不可见，但存储/RAG 含标签 |
| `fold` | 保留 | 转折叠 details 块 | 用户可展开查看 AI 思考过程 |

### 向后兼容

`deriveThinkTagMode()` 函数从旧字段推导三态值：
- `think_tag_mode` 优先
- 否则 `show_thinking === true` → `'fold'`
- 否则 `strip_think_tags === false` → `'strip_render'`
- 默认 → `'strip'`

旧字段 `strip_think_tags` / `show_thinking` 标记 `@deprecated` 但保留，不破坏已存角色卡数据。

### 改动文件

| 文件 | 改动 |
|------|------|
| `CharacterDialogueChat.types.ts` | 新增 `ThinkTagMode` 类型 + `deriveThinkTagMode()` 函数；`think_tag_mode` 字段；旧字段标 `@deprecated` |
| `ParameterPanel.tsx` | 两个 Switch 替换为一个 Select（移除/仅渲染剥离/折叠展示） |
| `ConfigPanel.tsx` | props 透传从 `stripThinkTags`/`showThinking` 改为 `thinkTagMode`/`onThinkTagModeChange` |
| `CharacterDialogueChat.tsx` | 使用 `deriveThinkTagMode()` 推导模式，传给 ParameterPanel 和 ChatMessageBubble |
| `CharacterDialogueChat.hooks.ts` | 两处条件判断简化为 `deriveThinkTagMode(...) === 'strip'` |

### 验证

- 全部 5 个修改文件 TypeScript 诊断零错误

## §31 ⚠️【重点标记】Bug 修复：对话内容增强不生效——系统提示词与渲染管线不匹配（2026-08-08）

### 问题

用户测试发现角色对话气泡中仅对话内容颜色略有变化，动作描写样式、思考折叠块等增强功能完全不生效。

### 根因

系统提示词与渲染管线存在**三个关键不匹配**：

1. **动作描写（`*text*` 斜体）**：渲染端 `em` → `.message-renderer-action` 映射完整，但系统提示词写着"不要添加任何额外的标记或说明"，直接禁止 AI 使用 markdown 格式标记。AI 以纯文本输出动作，`em` 元素永远不产生。

2. **引号高亮效果太弱**：引号高亮功能实际在工作（提示词要求 AI 用 `" "` 包裹对话），但 CSS 背景透明度仅 `0.04`/`0.06`（几乎不可见），用户难以察觉。

3. **思考标签**：系统提示词从未指示 AI 使用 `<thinking>` 标签，且默认 `think_tag_mode='strip'` 会移除任何思考标签。

### 修复

#### 1. 系统提示词添加格式指令

**文件**：`PromptBuilder.ts`（硬编码回退）、`promptTemplateService.ts`（模板）

- 新增规则 8：`【格式要求】角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑*）`
- 白名单例外添加：`星号 *动作描写* 是格式标记，不属于"额外标记或说明"`
- 输出格式修改：从"不要添加任何额外的标记或说明"改为"对话内容用英文双引号包裹，动作和神态描写用星号包裹"

#### 2. 引号高亮 CSS 增强可见度

**文件**：`ui-variables.css`、`MessageRenderer.styles.css`

| 属性 | 修复前 | 修复后 |
|------|--------|--------|
| 亮色背景透明度 | `0.06` | `0.12` |
| 暗色背景透明度 | `0.04` | `0.10` |
| 边框 | 无 | 新增 `--mr-quote-highlight-border` 变量，`1px solid` |
| 内边距 | `0 2px` | `0 4px` |
| 圆角 | `3px` | `4px` |

### 验证

- 全部 4 个修改文件 TypeScript 诊断零错误
- `*text*` 是标准 markdown 斜体，ReactMarkdown 原生解析为 `em` 元素，无需额外插件

## §32 ⚠️【重点标记】Bug 修复：格式指令未生效 + 表情标签泄露（2026-08-08）

### 问题

用户反馈修改后仍然不生效，且对话末尾出现 `<<>>annoyance<<<_EXPRESSION>>>` 残缺标签文字。

### 根因

**问题 A — 格式指令未生效**：
`promptTemplateService.ts` 的 `mergeNewDefaultTemplates()` 只添加**缺失的**新模板，不更新已存在的模板。用户数据库中已有旧版 `creative-chat.dialogue` 模板（包含"不要添加任何额外的标记或说明"），代码修改的默认模板不会覆盖已存在的数据库记录。

**问题 B — 表情标签泄露**：
AI 返回了格式残缺的表情标记 `<<>>annoyance<<<_EXPRESSION>>>`（开始标记 `<<<EXPRESSION>>>` 被截断为 `<<>>`，结束标记 `<<<END_EXPRESSION>>>` 被截断为 `<<<_EXPRESSION>>>`）。原有正则无法匹配这种残缺格式，导致标签未被剥离，直接显示给用户。

### 修复

#### A. 格式指令后处理注入器

新增 `injectDialogueFormatInstructions()` 函数（`PromptBuilder.ts`），在 `buildDialoguePrompt` 返回前对系统提示词做后处理：
1. 正则移除"不要添加任何额外的标记或说明"语句
2. 追加格式要求（对话用双引号，动作用星号 `* *`）

此方案不依赖模板数据库更新，对所有来源的提示词生效。

#### B. 表情标签解析容错增强

`parseExpressionFromContent()` 新增 4 个容错正则模式：

| 模式名 | 匹配场景 |
|--------|---------|
| `text-marker-malformed` | 残缺开始+结束标记（如 `<<>>key<<<_EXPRESSION>>>`） |
| `text-marker-malformed-unclosed` | 残缺开始标记 + key 到末尾 |
| `text-marker-fallback-before` | key 在 EXPRESSION 字样之前 |
| `text-marker-fallback-after` | key 在 EXPRESSION 字样之后 |

此外，解析成功后追加清理步骤：`cleanedContent.replace(/[<>_]{2,}\s*$/, '')` 移除残留的孤立尖括号碎片。

### 改动文件

| 文件 | 改动 |
|------|------|
| `PromptBuilder.ts` | 新增 `injectDialogueFormatInstructions()` 后处理函数；`buildDialoguePrompt` 返回前调用；`parseExpressionFromContent` 新增 4 个容错正则 + 残留碎片清理 |

### 验证

- TypeScript 诊断零错误

## §33 ⚠️【重点标记】Bug 修复：rehypeRaw 解析系统标签导致 *text* 渲染失败（2026-08-08）

### 问题

用户提供日志数据和气泡实际显示数据对比，发现：
1. 日志中 `*动作描写*` 星号格式正确，但气泡中星号消失且无样式
2. 日志中 `<<<EXPRESSION>>>annoyance<<<END_EXPRESSION>>>` 标准标签，气泡中显示为 `<<>>annoyance<<<END_EXPR>>>` 残缺碎片

### 根因

**渲染管线 HTML 解析损坏**：

`MessageRenderer` 配置 `allowRawHTML: true` + `encodeAngleBrackets: false`，导致 `<<<EXPRESSION>>>` 等系统控制标签中的 `<` 字符被 `rehypeRaw` 当作 HTML 标签解析。

1. `rehypeRaw` 尝试将 `<<<EXPRESSION>>>` 解析为 HTML 元素 → 产生非法节点
2. `rehypeSanitize` 删除未知标签 → 留下碎片（`<<>>annoyance<<<END_EXPR>>>`）
3. 非法 HTML 解析可能破坏整个 hast 树 → `*text*` 的 `<em>` 元素也被影响

**关键链条**：系统标签未被剥离 → 进入 HTML 解析 → 破坏 hast 树 → `<em>` 元素丢失 → 动作描写样式不生效

### 修复

新增 `stripSystemTags()` 函数（`messageProcessor.ts`），在 `processMessage` 中**始终调用**（不受配置控制），在思考标签处理之后、引号规范化之前执行：

1. 剥离 `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 及所有残缺变体（4 层正则兜底）
2. 剥离 `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` 标签
3. 清理残留的孤立尖括号碎片
4. 清理多余空行

此函数作为**防御性兜底**，即使 hooks 层的 `parseExpressionFromContent` 已剥离标签，也处理旧消息或解析失败的情况。

### 改动文件

| 文件 | 改动 |
|------|------|
| `messageProcessor.ts` | 新增 `stripSystemTags()` 函数；`processMessage` 中始终调用 |

### 验证

- TypeScript 诊断零错误
- 系统标签不再进入 `rehypeRaw` 解析管线，`*text*` 的 `<em>` 元素不再被破坏

---

## 对话管线架构重设计 — Pipeline 核心框架（Spec: redesign-dialogue-pipeline-architecture / Task 1）

### 概述

采用 Pipeline + Middleware + Intent Router 模式，替换原有的单体函数式对话处理架构（`requestAIResponse` ~1140 行、`onComplete` ~517 行）。Task 1 实现管线核心框架，包含类型定义、Pipeline 执行引擎、扩展注册表和分级日志系统。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/pipeline.types.ts` | 管线架构全部类型定义（DialoguePipelineContext、UserIntent、AIIntentType、PromptProvider、PostProcessPlugin、LogicTask、IntentHandler、PipelineLogger 类型、PipelineMetrics、PipelineError、ParsePattern/ParseResult、RenderOptions、ImageGenRequest、DedupInfo、SuggestedOption、TableEditCommand 等） |
| `pipeline/Pipeline.ts` | Pipeline 核心类 — 有序 Stage 执行引擎，支持非致命错误继续/致命错误中断 |
| `pipeline/PipelineLogger.ts` | 分级日志系统 — debug/info/warn/error 四级日志 + trace 性能追踪 + metrics 聚合 |
| `pipeline/ExtensionRegistry.ts` | 扩展注册表（单例）— 管理 PromptProvider / PostProcessPlugin / LogicTask / RenderComponent / IntentHandler 的注册与获取 |

### 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                   ExtensionRegistry (单例)                │
│  PromptProviders / PostProcessPlugins / LogicTasks /     │
│  RenderComponents / IntentHandlers                       │
└────────────────────────┬─────────────────────────────────┘
                         │ 注册
┌────────────────────────▼─────────────────────────────────┐
│                    DialoguePipeline                       │
│  Stage[] → execute(context, logger)                      │
│  非致命错误继续 / 致命错误中断                             │
└────────────────────────┬─────────────────────────────────┘
                         │ 读写
┌────────────────────────▼─────────────────────────────────┐
│                DialoguePipelineContext                     │
│  (userInput / intent / systemPrompt / rawResponse / ...) │
│  logs: PipelineLogEntry[] / metrics / errors             │
└──────────────────────────────────────────────────────────┘
```

### 关键类型

- **DialoguePipelineContext**：贯穿整个对话处理流程的中央数据对象，包含输入、上下文组装、提示词、AI 响应、后处理结果和元数据六大分区
- **PipelineMode**：`'dialogue' | 'continuation' | 'retry' | 'polish' | 'userReply'` 五种管线模式
- **UserIntent / UserAction**：用户意图（含 NLU 置信度）与 UI 操作映射
- **AIIntentType**：`expression | suggested_options | table_edit | think_tag | image_generation | narrative` 六种 AI 意图
- **PromptProvider**：模块化提示词构建单元，按 section + priority 组装
- **PostProcessPlugin**：后处理插件，按 priority 顺序链式处理内容
- **LogicTask**：逻辑副作用任务，按 priority + condition 调度

### 错误处理策略

Pipeline.execute 中的 Stage 异常处理：
- Stage 抛出的 Error 若携带 `isFatal: false` → 非致命错误，记录到 `context.errors` 和 `logger.error()`，继续执行下一个 Stage
- Stage 抛出的 Error 若 `isFatal: true` 或未标记 → 致命错误，记录后重新抛出，中断管线

### 类型导入关系

- 从 `../CharacterDialogueChat.types` 导入并重导出：ChatMessage、CharacterInfo、AIParameterConfig、CharacterSessionConfig、EffectiveAIParams、ThinkTagMode
- 从 `../../../Common/ChatEngine/ChatEngine.types` 导入并重导出：AIEngineConfig、EngineCapabilities
- 从 `../../../KnowledgeBase/shared` 导入并重导出：VectorSearchResult
- 本地定义（不存在于现有代码中）：ChatHistoryItem、TableStructure、DialogueContext、ValidationResult、TableEditCommand（独立于主进程同名类型）

### 验证

- TypeScript 诊断零错误（四个文件均通过 `tsc --noEmit` 检查）
- 未使用 `any` 类型，React 组件类型使用 `React.ComponentType<Record<string, unknown>>`
- 所有代码含中文注释

---

## 对话管线架构重设计 — 模块化提示词构建系统（Spec: redesign-dialogue-pipeline-architecture / Task 5）

### 概述

采用 Provider 注册机制替换硬编码的提示词拼接流程。PromptComposer 按 section（header → context → instruction → suffix）分组，组内按 priority 升序排列，依次通过 `isActive` 过滤和异步 `build` 构建，最终拼接为完整的 system prompt。共实现 13 个预置 PromptProvider，迁移自 `PromptBuilder.ts` 中的全部 build 函数。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/PromptComposer.ts` | PromptComposer 核心类 — `registerProvider`（同名去重）+ 异步 `compose`（分组/排序/过滤/构建/拼接） |
| `pipeline/providers/index.ts` | 13 个 Provider 的统一导出 + `registerAllProviders(composer)` 批量注册函数 |
| `pipeline/providers/CharacterContextProvider.ts` | 角色卡信息段落（名称、个性、描述、场景、示例对话），迁移自 `buildCharacterContext` |
| `pipeline/providers/PersonaProvider.ts` | 用户人设段落，迁移自 `buildPersonaSection` |
| `pipeline/providers/KnowledgeContextProvider.ts` | 知识库检索结果格式化段落，迁移自 `buildFinalSystemPrompt` 区域 1 |
| `pipeline/providers/ChatHistoryProvider.ts` | 对话历史 RAG 片段格式化段落，迁移自 `buildFinalSystemPrompt` 区域 2 |
| `pipeline/providers/MemoryTableProvider.ts` | 记忆表格 markdown 数据段落，迁移自 `buildFinalSystemPrompt` 区域 3 |
| `pipeline/providers/DialogueInstructionProvider.ts` | 对话模式任务指令（模板 `creative-chat.dialogue`），迁移自 `buildDialoguePrompt` |
| `pipeline/providers/ContinuationInstructionProvider.ts` | 续写模式任务指令（模板 `creative-chat.continuation`），迁移自 `buildContinuationPrompt` |
| `pipeline/providers/LengthGuidanceProvider.ts` | 回复长度下限约束 + 强化模式检测，迁移自 `buildLengthGuidancePrompt` |
| `pipeline/providers/LanguageProvider.ts` | 语言约束注入，迁移自 `buildLanguagePrompt` |
| `pipeline/providers/AssistModeProvider.ts` | 辅助模式选项指令，迁移自 `buildAssistModePrompt` |
| `pipeline/providers/ExpressionProvider.ts` | 表情情绪标记指令，迁移自 `buildExpressionPrompt` |
| `pipeline/providers/AsyncTableOrganizeProvider.ts` | 异步表格整理指令，迁移自 `buildAsyncTableOrganizeInstructions` |
| `pipeline/providers/FormatInstructionProvider.ts` | 格式指令统一追加（对话双引号 + 动作星号），迁移自 `injectDialogueFormatInstructions` 追加部分 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `pipeline/pipeline.types.ts` | `PromptProvider.build` 返回类型从 `string` 改为 `Promise<string>`（异步模板调用需要）；新增 `selectedPersona?: UserPersona` 字段到 `DialoguePipelineContext`；导入并重导出 `UserPersona` 类型 |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    PromptComposer                            │
│  registerProvider(provider) → 同名去重注册                   │
│  async compose(context) → 分组/排序/过滤/构建/拼接           │
└──────────────────────────┬──────────────────────────────────┘
                           │ 按 section 分组
┌──────────┬───────────┬───────────────┬──────────────────────┐
│ header   │ context   │ instruction   │ suffix               │
│ (预留)    │ 100-220   │ 300           │ 400-450              │
└──────────┴───────────┴───────────────┴──────────────────────┘
                           │ 组内按 priority 升序
                           ▼
              isActive(context) → 同步过滤
                           ▼
              await build(context) → 异步构建
                           ▼
              非空段 trim() → '\n\n'.join()
```

### Provider 注册表

| Provider | section | priority | isActive 条件 | 迁移源函数 |
|----------|---------|----------|--------------|-----------|
| CharacterContextProvider | context | 100 | 始终活跃 | `buildCharacterContext` |
| PersonaProvider | context | 110 | 始终活跃 | `buildPersonaSection` |
| KnowledgeContextProvider | context | 200 | `knowledgeBase.length > 0` | `buildFinalSystemPrompt` 区域 1 |
| ChatHistoryProvider | context | 210 | `chatHistory.length > 0` | `buildFinalSystemPrompt` 区域 2 |
| MemoryTableProvider | context | 220 | `memoryTableData` 非空 | `buildFinalSystemPrompt` 区域 3 |
| DialogueInstructionProvider | instruction | 300 | `pipelineMode === 'dialogue'` | `buildDialoguePrompt` |
| ContinuationInstructionProvider | instruction | 300 | `pipelineMode === 'continuation'` | `buildContinuationPrompt` |
| LengthGuidanceProvider | suffix | 400 | 始终活跃 | `buildLengthGuidancePrompt` |
| LanguageProvider | suffix | 410 | 始终活跃 | `buildLanguagePrompt` |
| AssistModeProvider | suffix | 420 | `assist_mode === true` | `buildAssistModePrompt` |
| ExpressionProvider | suffix | 430 | `expression_display === true` | `buildExpressionPrompt` |
| AsyncTableOrganizeProvider | suffix | 440 | `memoryTableOrganizeMode === 'async'` | `buildAsyncTableOrganizeInstructions` |
| FormatInstructionProvider | suffix | 450 | 始终活跃 | `injectDialogueFormatInstructions` 追加部分 |

### 关键设计决策

1. **异步 build 方法**：`PromptProvider.build` 返回 `Promise<string>` 而非 `string`，因为 DialogueInstructionProvider / ContinuationInstructionProvider / AsyncTableOrganizeProvider 需要调用 `window.electronAPI.prompt.build` 异步模板系统。`isActive` 保持同步。

2. **Provider 职责分离**：原 `buildDialoguePrompt` / `buildContinuationPrompt` 内含角色上下文和人设段落，新架构中这些由 CharacterContextProvider / PersonaProvider 独立提供。指令 Provider 向模板传入空的 `character_context` / `persona_section` 参数以避免内容重复。

3. **injectDialogueFormatInstructions 拆分**：原函数包含"移除旧版禁止标记"和"追加格式指令"两部分。移除逻辑迁移到 DialogueInstructionProvider（需处理模板输出后执行清理），追加逻辑迁移到 FormatInstructionProvider（对所有管线模式统一生效）。

4. **shouldStrengthenLength 迁移**：原 hooks.ts 中的 `shouldStrengthenLength` 使用 `responseLengthHistoryRef`，LengthGuidanceProvider 改为从 `context.messagesToSend` 中提取最近 3 条 assistant 消息长度进行判定。

5. **TableStructure 类型适配**：管线 `TableStructure` 类型（`{ sheets: Array<{ sheetName, headers, rowCount }> }`）与 `buildAsyncTableOrganizeInstructions` 期望的格式（`{ sheets: string[], headers: Record<string, string[]>, descriptions: Record<string, string> }`）不同，通过 `adaptTableStructure` 辅助函数转换。

### ⚠️ 重点标记：Bug 修复

- **旧版模板禁止标记 Bug**：系统提示词模板可能来自数据库旧版（`mergeNewDefaultTemplates` 不更新已有模板），旧模板包含"不要添加任何额外的标记或说明"语句，导致 AI 不使用 `*动作*` 格式。DialogueInstructionProvider 中 `removeOldFormatProhibition` 函数负责移除该语句，FormatInstructionProvider 负责重新追加正确的格式指令。

### 错误处理策略

PromptComposer.compose 中的 Provider 构建异常处理：
- 单个 Provider 的 `build` 抛出异常 → 非致命错误，记录到 `context.errors` 和 `console.error()`，跳过该 Provider 继续执行
- 最终拼接结果仅包含成功构建的非空段落

### 验证

- TypeScript 诊断零错误（PromptComposer.ts + 13 个 Provider + index.ts + pipeline.types.ts 修改，共 16 个文件）
- 所有 Provider 实现了 `PromptProvider` 接口（name / priority / section / isActive / build）
- 所有代码含中文注释

---

## 对话管线架构重设计 — 统一参数注入器（Spec: redesign-dialogue-pipeline-architecture / Task 6）

### 概述

消除 `requestAIResponse` / `generateUserReply` / `polishInput` 三处重复的参数注入逻辑。ParameterInjector 提供三个核心方法：`getEffectiveParams`（三级参数合并）、`buildEngineConfig`（能力门控引擎配置构建）、`buildStopSequences`（模式驱动的停止序列生成）。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/ParameterInjector.ts` | ParameterInjector 类 — 三级参数合并 + 能力门控引擎配置 + 模式驱动停止序列 |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                  ParameterInjector                           │
├─────────────────────────────────────────────────────────────┤
│  getEffectiveParams(custom, engine)                         │
│    custom > engine > defaults  → EffectiveAIParams          │
├─────────────────────────────────────────────────────────────┤
│  buildEngineConfig(base, params, capabilities)              │
│    非门控参数直接注入 + buildSamplingExtras 能力门控注入     │
│    → AIEngineConfig                                         │
├─────────────────────────────────────────────────────────────┤
│  buildStopSequences(mode, charName, userName)               │
│    dialogue/continuation/retry → 用户名变体                  │
│    userReply → 角色名变体                                    │
│    polish → 空数组                                           │
│    → string[]                                                │
└─────────────────────────────────────────────────────────────┘
```

### 核心方法

#### getEffectiveParams(custom, engine)

三级合并：`customParameters > globalEngine > defaults`，迁移自 `CharacterDialogueChat.hooks.ts` 约 174-285 行。

合并参数清单：
- `temperature`（默认 0.7）/ `max_tokens`（默认 `DEFAULT_MAX_TOKENS = 8192`，来自 TokenManagement）
- `top_p` / `frequency_penalty` / `presence_penalty`（可选，按优先级取值）
- `repetition_penalty`（兼容 SillyTavern 风格的 `engine.rep_pen` 字段）
- DRY 采样组：`dry_multiplier` / `dry_base` / `dry_allowed_length` / `no_repeat_ngram_size`
- `top_k` / `min_p`

返回 `EffectiveAIParams` 对象，包含 `source: 'global' | 'custom'` 标识参数来源。

#### buildEngineConfig(base, params, capabilities)

迁移自 `CharacterDialogueChat.hooks.ts` 约 641-707 行的 `engineConfigWithParams` 构建逻辑。

- **非能力门控参数**（直接注入）：`max_tokens` / `temperature` / `top_p` / `frequency_penalty` / `presence_penalty` / `top_k` / `min_p`
- **能力门控参数**（通过 `buildSamplingExtras` 注入）：`repetition_penalty`（`supportsRepPen`）/ DRY 采样组（`supportsDrySampler`）/ `no_repeat_ngram_size`
- `buildSamplingExtras` 按 `capabilities` 决定是否包含能力门控参数，未启用时自动省略，启用时含默认值兜底

#### buildStopSequences(mode, charName, userName)

迁移自 `PromptBuilder.ts::buildStopSequences` 和 `buildStopSequencesForUserReply`。

| 管线模式 | 停止序列 | 目的 |
|---------|---------|------|
| dialogue / continuation / retry | 用户名变体（`buildStopSequencesImpl(userName)`） | 阻断 AI 代替用户发言 |
| userReply | 角色名变体（`buildStopSequencesForUserReply(charName)`） | 阻断 AI 越权代替角色发言 |
| polish | 空数组 `[]` | 润色模式无需停止序列 |

### 关键设计决策

1. **复用 buildSamplingExtras**：不重新实现能力门控逻辑，直接调用 `ChatEngine.types.ts` 中的 `buildSamplingExtras` 函数，替代 hooks.ts 中逐个 `if` 判断 + ChatEngine 层二次过滤的重复逻辑。

2. **默认值来源**：`max_tokens` 默认值从 `TokenManagement/constants.ts` 导入 `DEFAULT_MAX_TOKENS`，`temperature` 默认值硬编码为 0.7（与 hooks.ts 一致）。

3. **rep_pen 兼容**：SillyTavern 风格的引擎配置使用 `rep_pen` 字段而非 `repetition_penalty`，合并时通过 `(globalEngine as any).rep_pen` 读取（类型定义中 AIEngineConfig 不含 rep_pen 字段）。

4. **停止序列复用**：直接导入并调用 `PromptBuilder.ts` 中已有的 `buildStopSequences` 和 `buildStopSequencesForUserReply` 函数，不重复实现停止序列生成逻辑。

### 验证

- TypeScript 诊断零错误（ParameterInjector.ts 单文件通过 `tsc --noEmit` 检查）
- 三级合并覆盖全部参数（temperature / max_tokens / top_p / frequency_penalty / presence_penalty / repetition_penalty / DRY 组 / no_repeat_ngram_size / top_k / min_p）
- 能力门控参数通过 `buildSamplingExtras` 注入，非门控参数直接注入
- 停止序列按管线模式正确切换
- 所有代码含中文注释

## 对话管线架构重设计 — AI 交互模块（Spec: redesign-dialogue-pipeline-architecture / Task 7）

### 概述

封装引擎实例管理、流式通信和错误处理，作为 Pipeline 的 AIService Stage。AIService 通过 ChatEngineFactory 获取/复用引擎实例，管理 onStream / onComplete / onError 回调注册，设置 300 秒超时自动取消，并提供故障转移事件订阅。迁移自 `CharacterDialogueChat.hooks.ts` 中的引擎调用逻辑（engine 创建 ~1098 行、stream 回调 ~1102 行、complete 回调 ~1120 行、error 回调 ~1639 行、timeout 设置 ~616 行、failover 订阅 ~542 行）。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/AIService.ts` | AIService 类 — 引擎实例管理 + 流式通信 + 超时取消 + 故障转移订阅 |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                       AIService                              │
├─────────────────────────────────────────────────────────────┤
│  sendMessage(context, callbacks)                            │
│    ChatEngineFactory.getOrCreateDefaultEngine(finalConfig)  │
│    → 注册 onStream / onComplete / onError                   │
│    → setTimeout(300s) 超时取消                               │
│    → engine.sendMessage(messages, systemPrompt, config)     │
├─────────────────────────────────────────────────────────────┤
│  cancel()                                                    │
│    engine.cancelRequest() + clearStreamTimeout()             │
├─────────────────────────────────────────────────────────────┤
│  getCapabilities()                                           │
│    → EngineCapabilities（从 currentEngineConfig 读取）        │
├─────────────────────────────────────────────────────────────┤
│  setupFailoverSubscription(onFailover)                       │
│    → 订阅 window.electronAPI.ai.failover.onFailover          │
│    → 返回 cleanup 函数                                       │
└─────────────────────────────────────────────────────────────┘
```

### 核心方法

#### sendMessage(context, callbacks)

迁移自 hooks.ts 引擎调用流程。

- **引擎获取**：通过 `ChatEngineFactory.getInstance().getOrCreateDefaultEngine(finalConfig)` 获取/复用引擎实例
- **停止序列注入**：将 `context.stopSequences` 合并到 `finalConfig.stopSequences`（Spec 要求注入 engineConfig 和 stopSequences）
- **回调注册**：在 `sendMessage` 调用之前注册 `onStream` / `onComplete` / `onError`
- **流式累积**：使用局部变量 `accumulatedContent` 累积 chunk，每次 chunk 调用 `callbacks.onStream(chunk, accumulatedContent)`
- **完成处理**：清除超时，优先使用流式累积内容，兜底使用 `response.content`，传递 `response.finishReason`
- **错误处理**：清除超时，将 `AIError` 转换为 `Error` 传递；同时 try/catch 捕获 `engine.sendMessage` 本身抛出的异常
- **超时**：300 秒（`STREAM_TIMEOUT_MS = 300_000`），超时后调用 `engine.cancelRequest()` 并触发 `onError`

#### cancel()

清除超时定时器并调用 `engine.cancelRequest()` 中断当前请求。

#### getCapabilities()

返回 `currentEngineConfig.capabilities`，缺省时通过 `getDefaultEngineCapabilities()` 返回默认能力。

#### setupFailoverSubscription(onFailover)

订阅 `window.electronAPI.ai.failover.onFailover` 事件，当 provider 切换时调用回调。`fromProvider` 取自当前引擎配置名称，`toProvider` 取自事件数据。返回 cleanup 函数用于取消订阅。electronAPI 不可用时返回空函数。

### 关键设计决策

1. **回调注册顺序**：引擎使用回调注册模式，必须在 `sendMessage` 之前注册 `onStream` / `onComplete` / `onError`，否则流式事件丢失。

2. **停止序列合并**：虽然 ParameterInjector 已将停止序列注入 `engineConfig.stopSequences`，AIService 额外从 `context.stopSequences` 合并以确保 Spec 要求的双注入，优先使用 `context.stopSequences`。

3. **完成内容兜底**：`onComplete` 优先使用流式累积内容 `accumulatedContent`，兜底使用服务端返回的 `response.content`，处理无流式 chunk 但直接完成的场景。

4. **sendMessage 异常捕获**：除引擎 `onError` 回调外，额外 try/catch 包裹 `engine.sendMessage` 调用，捕获请求发起阶段的同步/异步异常，统一路由到 `callbacks.onError`。

5. **超时方法命名**：内部超时清理方法命名为 `clearStreamTimeout`（与 hooks.ts 一致），避免与全局 `clearTimeout` 冲突。

### 类型定义

| 类型 | 职责 |
|------|------|
| `AIServiceCallbacks` | 流式通信回调集合（onStream / onComplete / onError） |
| `FailoverInfo` | 故障转移信息（fromProvider / toProvider） |

### 依赖关系

| 依赖 | 来源 | 用途 |
|------|------|------|
| `ChatEngineFactory` | `Common/ChatEngine/ChatEngine.factory` | 获取/复用引擎实例 |
| `IChatEngine` | `Common/ChatEngine/ChatEngine.types` | 引擎接口类型 |
| `AIEngineConfig` / `EngineCapabilities` | `Common/ChatEngine/ChatEngine.types` | 引擎配置与能力类型 |
| `AIResponse` / `AIError` | `Common/ChatEngine/ChatEngine.types` | 完成回调与错误回调类型 |
| `getDefaultEngineCapabilities` | `Common/ChatEngine/ChatEngine.types` | 默认能力兜底 |
| `DialoguePipelineContext` | `./pipeline.types` | 管线上下文类型 |
| `window.electronAPI.ai.failover` | Electron preload bridge | 故障转移事件订阅 |

### 验证

- TypeScript 诊断零错误（AIService.ts 单文件通过检查）
- 四个方法完整实现（sendMessage / cancel / getCapabilities / setupFailoverSubscription）
- 流式累积、超时取消、错误转换、故障转移订阅均覆盖
- 所有代码含中文注释

## 对话管线架构重设计 — AI 意图识别模块（Spec: redesign-dialogue-pipeline-architecture / Task 9）

### 概述

AIIntentRecognizer 扫描 AI 响应内容，识别所有结构化标签意图（expression / suggested_options / table_edit / think_tag / image_generation），返回 `DetectedIntent[]`。使用 RobustParser 的静态模式集合进行多格式容错匹配，保证在 AI 生成文本不稳定时仍能正确识别意图。迁移自 `PromptBuilder.ts::parseExpressionFromContent`、`CharacterDialogueChat.hooks.ts` 中的 option/tableEdit 解析、`messageProcessor.ts::stripThinkingTags` 的标签模式。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/AIIntentRecognizer.ts` | AIIntentRecognizer 类 — `detect`（扫描所有标签意图）/ `stripIntents`（剥离标签返回纯净叙事）/ `getIntentRouter`（空路由表，由 ExtensionRegistry 注册） |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                  AIIntentRecognizer                          │
├─────────────────────────────────────────────────────────────┤
│  detect(content) → DetectedIntent[]                         │
│    1. expression      — RobustParser.EXPRESSION_PATTERNS    │
│    2. suggested_options — RobustParser.SUGGESTED_OPTIONS_.. │
│    3. table_edit      — RobustParser.TABLE_EDIT_PATTERNS    │
│    4. think_tag       — 正则匹配 ILD/thinking/thought/     │
│                         antml:thinking（完整+未关闭）        │
│    5. image_generation — <<<GENERATE_IMAGE>>>...（预留）     │
├─────────────────────────────────────────────────────────────┤
│  stripIntents(content, intents) → string                    │
│    移除 rawMatch → cleanup 残留碎片 → trim → 折叠空行        │
├─────────────────────────────────────────────────────────────┤
│  getIntentRouter() → Map<AIIntentType, IntentHandler>       │
│    空映射表（由 ExtensionRegistry 注册处理器）                │
└─────────────────────────────────────────────────────────────┘
```

### 核心方法

#### detect(content: string): DetectedIntent[]

扫描 AI 响应内容中所有结构化标签类型，返回检测到的意图数组。对每种标签类型依次检测：

| 意图类型 | 模式来源 | data 结构 | confidence |
|---------|---------|-----------|------------|
| expression | RobustParser.EXPRESSION_PATTERNS | `{ emotion: string }` | 标准格式 1.0 / 残缺兜底 0.8 |
| suggested_options | RobustParser.SUGGESTED_OPTIONS_PATTERNS | `{ options: string[] }`（按行拆分过滤空行） | 标准格式 1.0 / 方括号 0.8 |
| table_edit | RobustParser.TABLE_EDIT_PATTERNS | `{ rawContent: string }`（原始命令文本） | 标准格式 1.0 / 注释分隔 0.8 |
| think_tag | 正则匹配 | `{ content: string, tagType: string }` | 固定 1.0 |
| image_generation | 正则匹配 | `{ prompt: string }` | 固定 1.0 |

**置信度判定**：通过 `matchWithPatternName` 辅助方法追踪匹配到的模式名称，与标准格式名称集合比对确定 confidence。标准格式名称集合定义在模块级常量中（`EXPRESSION_STANDARD_NAMES` / `SUGGESTED_OPTIONS_STANDARD_NAMES` / `TABLE_EDIT_STANDARD_NAMES`）。

**think 标签检测**：支持 ILD(think)、thinking、thought、antml:thinking 四种变体。先查找完整标签对（`<tag>...</tag>`），再在剩余内容中查找未关闭标签（流式场景，行首匹配到文本末尾）。

#### stripIntents(content: string, intents: DetectedIntent[]): string

从内容中剥离所有已识别标签：逐一使用 `split + join` 移除 rawMatch（避免正则元字符问题），然后调用 `RobustParser.cleanup` 清理残留碎片（`/[<>_]{3,}/g` 匹配 3+ 连续尖括号/下划线），最后 trim 并折叠 3+ 连续换行为 2 个。

#### getIntentRouter(): Map<AIIntentType, IntentHandler>

返回空 Map，实际 IntentHandler 由 ExtensionRegistry 注册。

### 关键设计决策

1. **matchWithPatternName 辅助方法**：RobustParser.match 仅返回 ParseResult（data + rawMatch），不包含模式名称。为实现 confidence 判定（标准 vs 残缺），新增 `matchWithPatternName` 方法在匹配时追踪 pattern.name，复用 RobustParser 静态模式集合的正则和提取器。

2. **残留碎片清理策略**：使用 `/[<>_]{3,}/g` 清理 3+ 连续尖括号/下划线碎片。阈值设为 3（而非 2）以避免误伤合法的 markdown 粗体（`__text__`）或比较运算符（`<<`）。

3. **think 标签未关闭检测**：在最后一个完整标签之后的内容中查找未关闭标签，避免与完整标签重叠。未关闭标签正则要求行首匹配（`(?:^|\n)[ \t]*`），与 `stripThinkingTags` 的行首约束一致，防止匹配句子中间的字面量 `<think`。

4. **rawMatch 移除方式**：使用 `split + join` 而非 `String.replace`，避免 rawMatch 中可能包含的正则元字符（如 `<<<EXPRESSION>>>` 中的 `<`、`>`）被当作正则语法解释。

5. **image_generation 预留**：检测 `<<<GENERATE_IMAGE>>>prompt<<<END_IMAGE>>>` 格式，data 仅存储 prompt 字符串，后续由 LogicEngine 调用图片生成服务。

### 依赖关系

| 依赖 | 来源 | 用途 |
|------|------|------|
| `RobustParser` | `./RobustParser` | 多模式匹配实例 + 静态模式集合 + cleanup 方法 |
| `AIIntentType` / `DetectedIntent` / `IntentHandler` / `ParsePattern` / `ParseResult` | `./pipeline.types` | 类型定义 |

### 验证

- TypeScript 诊断零错误（AIIntentRecognizer.ts 单文件通过 `GetDiagnostics` + `tsc --noEmit` 检查）
- 五种意图类型全部实现（expression / suggested_options / table_edit / think_tag / image_generation）
- confidence 判定逻辑覆盖标准格式（1.0）与残缺兜底格式（0.8）
- think 标签支持 ILD / thinking / thought / antml:thinking 四种变体 + 完整/未关闭两种场景
- stripIntents 使用 split+join 安全移除 rawMatch + cleanup 残留碎片 + 折叠空行
- 所有代码含中文注释

## 对话管线架构重设计 — 管线集成编排器（Spec: redesign-dialogue-pipeline-architecture / Task 13）

### 概述

DialoguePipeline 是对话管线的集成层主编排器，将所有管线模块（DataPreprocessor、UserIntentRecognizer、ContextAssembler、PromptComposer、ParameterInjector、AIService、AIIntentRecognizer、PostProcessingPipeline、LogicEngine）串联为统一的执行流程：PrePipeline → AIService → PostPipeline → LogicEngine。去重重试循环在管线内部处理（最多 2 次重试），不依赖外部调用方。管线通过回调通知 UI 层更新，不直接管理 React state。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/DialoguePipeline.ts` | 管线集成层主编排器 — createContext（每执行创建全新 context）/ execute（PrePipeline → AIService+PostPipeline 去重循环 → LogicEngine）/ getAIService（供 hooks cancel）/ getExtensionRegistry |

### 架构设计

```
┌──────────────────────── DialoguePipeline.execute() ────────────────────────┐
│                                                                              │
│  1. createContext(input) → DialoguePipelineContext                           │
│     - resolveIntent(userAction) → UserIntent                                 │
│                                                                              │
│  2. runPrePipeline(context)                                                  │
│     - DataPreprocessor.normalize / detectLanguage                            │
│     - ContextAssembler.retrieveKnowledgeBase / retrieveChatHistory           │
│                 / fetchMemoryTable                                           │
│     - PromptComposer.compose（Provider 链）                                   │
│     - ParameterInjector.getEffectiveParams / buildEngineConfig               │
│                          / buildStopSequences                                │
│     - ContextAssembler.truncateContext                                       │
│                                                                              │
│  3. runAIServiceWithDedupRetry(context, callbacks)                           │
│     ┌─── 循环 (max 2 retries) ───────────────────────────┐                   │
│     │  AIService.sendMessage（流式 → onStream 回调）       │                   │
│     │  AIIntentRecognizer.detect + stripIntents            │                   │
│     │  PostProcessingPipeline.execute（Plugin 链）          │                   │
│     │  DedupPlugin 判定 → 重试 or 跳出                     │                   │
│     └─────────────────────────────────────────────────────┘                   │
│     - 重试时重置 PostProcessingPipeline 状态                                 │
│                                                                              │
│  4. runLogicEngine(context, callbacks)                                       │
│     - 创建全新 LogicEngine 实例                                              │
│     - 动态注册 Task（含运行时数据）:                                         │
│       UpdateEmotion / RenderOptions / ExecuteTableEdit                       │
│       TriggerSyncOrganize / TriggerVectorization                             │
│       SaveChat / UpdateTokenUsage                                            │
│     - LogicEngine.executeAll（条件检查 + Task 执行）                          │
│                                                                              │
│  → PipelineResult { context, success, error }                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 核心接口

#### PipelineInput

管线执行所需的全部数据，包含：userInput、userAction、characterInfo、sessionConfig、activeEngine、pipelineMode、selectedPersona、contextMessages、targetMessageId、initialContent、knowledgeBaseScopeIds、truncationConfig、callbacks、taskRuntimeData。

#### PipelineCallbacks

UI 更新回调集合：onStreamUpdate（流式 chunk）、onMessageUpdate（最终内容）、onError、onEmotionUpdate、onOptionsRender、onSaveChat、onSyncOrganize、onTokenUsageUpdate。

#### PipelineResult

`{ context: DialoguePipelineContext, success: boolean, error?: string }`

### 关键设计决策

1. **不使用 Pipeline.addStage**：因为 AIService + PostPipeline 需要参与去重重试循环，Stage 在 execute 中动态编排而非静态注册。

2. **每次执行创建全新 LogicEngine**：LogicTask 需要运行时数据（messageId、callbacks、messages），无法在构造函数中静态注册。每次 execute 创建新 LogicEngine 实例并动态注册所需 Task。

3. **去重重试循环重置 PostPipeline 状态**：重试时需要清除上一轮 PostProcessing 的残留状态（累积内容、detectedIntents 等），避免跨重试污染。

4. **ContextAssembler 合并 RAG chatHistory**：DedupPlugin 需要找到上一条 assistant 消息进行比较，RAG 检索的 chatHistory 与当前 contextMessages 合并后供 DedupPlugin 使用。

## 对话管线架构重设计 — Hooks 集成层（Spec: redesign-dialogue-pipeline-architecture / Task 14）

### 概述

`CharacterDialogueChat.hooks.new.ts` 是使用 DialoguePipeline 的新版本 hooks 文件，返回值接口与旧版本 `CharacterDialogueChat.hooks.ts` 完全一致，UI 层无需修改。dialogue / continuation / retry 三种模式通过 pipeline.execute() 执行；generateUserReply / polishInput 因自定义系统提示与停止序列，仍直接使用 ChatEngineFactory。

### 新增文件

| 文件 | 职责 |
|------|------|
| `CharacterDialogueChat.hooks.new.ts` | 新版 hooks — useCharacterDialogueChat 使用 DialoguePipeline，保持旧版返回值接口完全一致；useCharacterConfig / usePersonas / shouldStrengthenLength 保持不变 |

### 架构变化

```
旧版 hooks.ts                          新版 hooks.new.ts
─────────────                          ─────────────────
requestAIResponse (~1140 行)    →      pipeline.execute(input)
  - 手动编排 Step A-E                    - PrePipeline 自动编排
  - 内联去重检测                          - 管线内部去重循环
  - 内联 emotion/options 解析             - LogicEngine Task 执行
  - 内联 saveChat / vectorize             - LogicEngine Task 执行
  - 内联 token usage 更新                 - LogicEngine Task 执行

generateUserReply               →      直接使用 ChatEngineFactory（不变）
polishInput                     →      直接使用 ChatEngineFactory（不变）

cancelRequest                   →      pipeline.getAIService().cancel()
                                        + ChatEngineFactory（for userReply/polish）
clearChat                       →      pipeline.getAIService().cancel()
```

### 管线调用模式

hooks 层为三种管线模式构建 PipelineInput：

| 模式 | pipelineMode | userAction | 特殊字段 |
|------|-------------|------------|---------|
| 发送消息 | `'dialogue'` | `{ type: 'sendMessage', text }` | — |
| 续写 | `'continuation'` | `{ type: 'continueConversation' }` | `initialContent` |
| 重试 | `'retry'` | `{ type: 'retryMessage', targetMessageId }` | — |
| 版本重试 | `'retry'` | `{ type: 'retryMessage', targetMessageId }` | 从版本文件恢复 messages |

### 验证

- TypeScript 诊断零错误（DialoguePipeline.ts + CharacterDialogueChat.hooks.new.ts 均通过 `GetDiagnostics` 检查）
- 返回值接口与旧版完全一致（44 个属性逐一对照）
- dialogue / continuation / retry 三种模式通过 pipeline.execute() 执行
- generateUserReply / polishInput 保持直接使用 ChatEngineFactory
- cancelRequest 使用 pipeline.getAIService().cancel() + ChatEngineFactory 双通道取消
- 文件使用 `.new.ts` 扩展名，不覆盖现有 hooks 文件

---

## 对话管线架构重设计 — 前处理三模块（Spec: Task 2/3/4）

### Task 2: DataPreprocessor（数据前处理）

| 文件 | 职责 |
|------|------|
| `pipeline/DataPreprocessor.ts` | 输入标准化（空白清理/换行标准化）、验证（空值/长度）、模板替换（迁移自 messageProcessor）、语言检测 |

核心方法：`normalize(text)` → `validate(text)` → `replaceTemplates(text, character)` → `detectLanguage(text)`

### Task 3: UserIntentRecognizer（用户意图识别）

| 文件 | 职责 |
|------|------|
| `pipeline/UserIntentRecognizer.ts` | 显式意图映射（UI 操作 → UserIntent）+ NLU 隐式意图检测（关键词匹配 + 置信度评分） |

- `resolveExplicit(action)` — 映射 sendMessage/continueConversation/retryMessage 等 UI 操作
- `detectImplicit(text)` — 关键词匹配检测续写意图（"继续"/"接着说"）和重试意图（"重试"/"再来一次"），返回置信度 0.0-1.0
- ⚠️ **未实现**：疑问句检测（SubTask 3.2）和置信度 < 1.0 用户确认机制（SubTask 3.3），预留接口

### Task 4: ContextAssembler（上下文组装）

| 文件 | 职责 |
|------|------|
| `pipeline/ContextAssembler.ts` | 知识库检索 + 对话历史 RAG + 记忆表格获取 + 上下文截断 |

核心方法：
- `retrieveKnowledgeBase(keywords, scopeIds)` — 关键词检索，失败降级返回空数组
- `retrieveChatHistory(messages, threshold)` — >40 条消息触发 RAG 检索
- `fetchMemoryTable(characterCardId)` — 获取记忆表格 markdown 数据
- `truncateContext(messages, config)` — TokenCounter + ContextTruncator 截断，保留最近消息

---

## 对话管线架构重设计 — RobustParser（Spec: Task 8）

### 概述

多模式正则匹配引擎，提供优先级匹配、模糊兜底和残留碎片清理。作为 AIIntentRecognizer 和 PostProcessingPipeline 的基础解析组件。

| 文件 | 职责 |
|------|------|
| `pipeline/RobustParser.ts` | 多模式正则匹配 + 模糊关键词 proximity 匹配 + 残留碎片清理 |

### 静态模式集合

| 模式集 | 数量 | 覆盖格式 |
|--------|------|---------|
| `EXPRESSION_PATTERNS` | 8 | `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 标准格式 + 7 层容错变体 |
| `SUGGESTED_OPTIONS_PATTERNS` | 6 | `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` + 方括号/注释分隔变体 |
| `TABLE_EDIT_PATTERNS` | 3 | `<<<TABLE_EDIT>>>...<<<END_TABLE_EDIT>>>` + 注释分隔变体 |

### 核心方法

- `match(content, patterns)` — 按模式优先级匹配，返回 `{ data, rawMatch }` 或 null
- `fuzzyMatch(content, keywords)` — 关键词 proximity 模糊匹配，用于标准模式全部失败时的兜底
- `cleanup(content)` — 清理 3+ 连续尖括号/下划线碎片（`/[<>_]{3,}/g`）

---

## 对话管线架构重设计 — 后处理管线与插件（Spec: Task 10）

### 概述

PostProcessingPipeline 按 priority 顺序执行插件链，每个插件独立检测→处理。共实现 7 个插件，覆盖 Think 标签三态处理、表情解析、选项解析、表格编辑检测、图片生成预留、内容保护和去重检测。

### 新增文件

| 文件 | priority | 职责 |
|------|----------|------|
| `pipeline/PostProcessingPipeline.ts` | — | 插件链管理器 — `registerPlugin` + `execute`（priority 排序，detect→process 链） |
| `pipeline/plugins/ThinkTagPlugin.ts` | 100 | Think 标签三态处理（strip / strip_render / fold），读取 `context.thinkTagMode` |
| `pipeline/plugins/ExpressionPlugin.ts` | 200 | 解析情绪标签，写入 `context.emotion` |
| `pipeline/plugins/SuggestedOptionsPlugin.ts` | 300 | 解析辅助模式选项，写入 `context.suggestedOptions` |
| `pipeline/plugins/TableEditPlugin.ts` | 400 | 检测 tableEdit 标签，写入 `context.tableEditCommands` |
| `pipeline/plugins/ImageGenPlugin.ts` | 500 | 预留接口，解析 `<<<GENERATE_IMAGE>>>` 标签（不实现具体逻辑） |
| `pipeline/plugins/ContentProtectionPlugin.ts` | 600 | 通用长度保护，从 context 读取已执行插件列表计算预期剥离量 |
| `pipeline/plugins/DedupPlugin.ts` | 700 | n-gram jaccard + overlap rate 去重检测，写入 `context.dedupInfo` |
| `pipeline/plugins/index.ts` | — | 7 个插件的统一导出 + 注册函数 |

### 关键设计决策

1. **ThinkTagPlugin 三态模式**：`strip`（完全移除）、`strip_render`（移除标签但保留内容渲染）、`fold`（折叠为 `<details>` 元素），替代旧版两个冗余开关
2. **ContentProtectionPlugin 通用化**：不再硬编码 strip 标志位，从 context 读取已执行插件列表动态计算预期剥离量
3. **DedupPlugin 检测算法**：n-gram（n=3）jaccard 相似度 + overlap rate（连续重复字符比例），双重判定触发去重

---

## 对话管线架构重设计 — 逻辑引擎与任务（Spec: Task 11）

### 概述

LogicEngine 按 priority 顺序执行条件满足的 LogicTask，每个任务独立 try-catch，单个失败不阻塞其他任务。共实现 8 个任务，覆盖情绪更新、选项渲染、表格编辑执行、同步整理、向量化、去重重试、保存聊天和 Token 用量更新。

### 新增文件

| 文件 | priority | 职责 |
|------|----------|------|
| `pipeline/LogicEngine.ts` | — | 逻辑引擎 — `registerTask` + `execute`（priority 排序，条件检查 + 独立 try-catch） |
| `pipeline/tasks/UpdateEmotionTask.ts` | 100 | 更新消息 emotion 字段 + 触发表情图像加载回调 |
| `pipeline/tasks/RenderOptionsTask.ts` | 200 | 渲染辅助模式选项按钮回调 |
| `pipeline/tasks/ExecuteTableEditTask.ts` | 300 | 异步执行 tableEdit 命令（调用 electronAPI） |
| `pipeline/tasks/TriggerSyncOrganizeTask.ts` | 400 | 延迟 2 秒调用 processChatProgressive（同步整理） |
| `pipeline/tasks/TriggerVectorizationTask.ts` | 500 | 每 5 轮调用 vectorizeIncremental（增量向量化） |
| `pipeline/tasks/DedupRetryTask.ts` | 600 | 去重重试循环（最多 2 次，重新触发 AIService + PostPipeline） |
| `pipeline/tasks/SaveChatTask.ts` | 700 | 保存聊天记录到文件 |
| `pipeline/tasks/UpdateTokenUsageTask.ts` | 800 | 更新 Token 用量统计 |
| `pipeline/tasks/index.ts` | — | 8 个任务的统一导出 + 注册函数 |

### 关键设计决策

1. **独立 try-catch**：每个 LogicTask 在 execute 时包裹独立 try-catch，异常记录到 logger 后继续执行下一个任务
2. **DedupRetryTask 与 DialoguePipeline 协作**：DedupRetryTask 不直接执行重试，而是设置 `context.dedupInfo.shouldRetry = true`，由 DialoguePipeline 的去重循环处理
3. **运行时数据注入**：Task 需要 messageId、callbacks、messages 等运行时数据，通过 `taskRuntimeData` 在 LogicEngine 构造时注入

---

## 对话管线架构重设计 — 渲染系统（Spec: Task 12）

### 概述

RenderSystem 迁移自 messageProcessor.ts 的消息预处理管线和 MessageRenderer 的 markdown 配置，提供统一的预处理 + markdown 配置接口。

| 文件 | 职责 |
|------|------|
| `pipeline/RenderSystem.tsx` | 消息预处理管线（replaceTemplates → processThinkTags → stripSystemTags → normalizeQuotes → encodeAngleBrackets）+ remark/rehype 插件链配置 + 自定义组件映射 |

### 核心方法

- `preprocess(content, options)` — 迁移自 `processMessage`，五步预处理管线
- `getMarkdownConfig(options)` — 返回 remark/rehype 插件链配置（remarkGfm → rehypeRaw → rehypeSanitize → rehypeHighlight）
- `registerComponent(tagName, component)` — 注册自定义渲染组件（如 `em` → message-renderer-action）

### ⚠️ 重点标记：stripSystemTags 防御性调用

`stripSystemTags()` 在 `preprocess` 中**始终调用**（不受配置控制），在思考标签处理之后、引号规范化之前执行。此函数作为防御性兜底，确保系统标签（`<<<EXPRESSION>>>` 等）不进入 `rehypeRaw` HTML 解析管线，避免 hast 树损坏导致 `*text*` 的 `<em>` 元素丢失。

---

## 对话管线架构重设计 — 集成验证与编译状态（Spec: Task 15）

### TypeScript 编译验证结果

**pipeline/ 目录：零编译错误** ✅

`npx tsc --noEmit` 过滤 `pipeline` 关键词，输出为空，确认以下所有文件零错误：
- 核心框架：`pipeline.types.ts` / `Pipeline.ts` / `ExtensionRegistry.ts` / `PipelineLogger.ts`
- 前处理：`DataPreprocessor.ts` / `UserIntentRecognizer.ts` / `ContextAssembler.ts`
- 提示词：`PromptComposer.ts` / `providers/*.ts`（14 文件）
- 参数：`ParameterInjector.ts`
- AI 交互：`AIService.ts` / `RobustParser.ts` / `AIIntentRecognizer.ts`
- 后处理：`PostProcessingPipeline.ts` / `plugins/*.ts`（8 文件）
- 逻辑引擎：`LogicEngine.ts` / `tasks/*.ts`（9 文件）
- 渲染：`RenderSystem.tsx`
- 集成：`DialoguePipeline.ts`

**hooks.new.ts：仅剩预存类型问题** ⚠️

以下错误与旧版 `hooks.ts` 完全一致，非新管线引入：
- `ElectronAPI.chatVersion` — 类型定义缺失（旧版同样存在）
- `ElectronAPI.failover` — 类型定义缺失（旧版同样存在）
- `electronAPI.stopOrganizing` — 类型定义缺失（旧版同样存在）
- `UserPersona` 类型不匹配 — 旧版同样存在
- 若干 `implicitly has 'any' type` — 旧版同样存在

### 修复的编译错误

| 文件 | 问题 | 修复 |
|------|------|------|
| `DialoguePipeline.ts` | 13 个未使用导入/声明 | 移除所有未使用的类型导入和类字段 |
| `ParameterInjector.ts` | 导入路径错误 `'../../Common/...'` | 修正为 `'../../../Common/...'` |
| `DialogueInstructionProvider.ts` | 未使用导入 `buildCharacterContext, buildPersonaSection` | 移除导入行 |
| `hooks.new.ts` L244 | 未使用参数 `targetMessageId` | 改为 `_targetMessageId` |

### 待运行时验证项

以下检查点需要启动应用进行实际对话测试：
- 对话/续写/重试/润色/AI回复五种模式完整流程
- 表情系统（标签解析 → 图像切换）
- 辅助模式（选项解析 → 按钮渲染）
- Think 标签三态处理（strip/strip_render/fold）
- 动作描写 `*text*` 紫色斜体渲染
- 残缺标签容错（`<<>>annoyance<<<_EXPRESSION>>>` 等）

### 待清理项（Task 16 剩余）

- 删除旧 `requestAIResponse` / `generateUserReply` / `polishInput` 函数（需先完成 hooks 文件替换）
- 清理 `PromptBuilder.ts` 中已迁移到 Provider 的函数
- 清理 `messageProcessor.ts` 中已迁移到 RenderSystem 的函数
- 将 `CharacterDialogueChat.hooks.new.ts` 替换原 `hooks.ts`（需运行时验证后执行）

---

## ⚠️ 重点 Bug：表情 emotion 字段在 characterChatStore 持久化时丢失（2026-08-08）

### 问题描述

角色对话中表情系统和中文表情名称在第一次对话时正常显示，但关闭对话框重新进入后全部丢失（立绘变回默认头像、表情名称消失）。

### 根因

**`src/renderer/stores/characterChatStore.ts` 的 `saveTestChat` 方法在构建 `safeMessages` 时手动逐字段提取消息数据，遗漏了 `emotion` 字段。**

保存链路：
```
hooks.ts messagesToSave (含 emotion)
  → characterChatStore.saveTestChat()
    → safeMessages = messages.map(msg => { 手动逐字段提取 })  ← BUG：漏掉 emotion
      → IPC saveTestChat → JSON.stringify (写入文件，但无 emotion)
```

加载链路本身不过滤字段，但 JSON 文件中已无 emotion，读回时 `msg.emotion` 为 undefined。

### 修复

`characterChatStore.ts` 两处：
1. `ChatMessage` 接口添加 `emotion?: string`
2. `safeMessages` 构建添加 `emotion: msg.emotion ? String(msg.emotion) : undefined`

### 经验教训

**⚠️ 反复出现问题 — 新增字段时必须同步更新所有层的类型定义和字段提取逻辑**

涉及 ChatMessage 类型定义的文件清单（新增字段时必须全部同步）：
1. `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — 组件层
2. `src/main/services/ChatStorageService.ts` — 主进程存储层
3. `src/renderer/stores/characterChatStore.ts` — store 层（含接口定义 + safeMessages 字段提取）
4. `src/renderer/types/electron.d.ts` — IPC 声明层（当前用 `any[]`，无强制约束）

**根本建议**：store 层的 `safeMessages` 应考虑用展开运算符 `{...msg}` 替代手动逐字段提取，或建立字段同步检查机制，避免每次新增字段都遗漏。

---

## §34 ConfigPanel 新增「图片生成设置」配置区（Spec: add-conversation-image-generation，2026-08-09）

### 概述

在角色对话配置面板（ConfigPanel）中新增「图片生成设置」配置区，允许用户在对话中开启图片生成功能并选择输出尺寸。该配置区位于 ParameterPanel 与「记忆与上下文增强」之间，视觉风格与现有配置区保持一致。

### 改动内容

#### 1. SizeSelector.tsx — 导出 SIZE_PRESETS

`SIZE_PRESETS` 常量原本为模块私有（`const`），改为 `export const` 以供 ConfigPanel 复用。该常量包含 6 个预设尺寸（头像/表情 512×512、全身立绘 512×768、竖版高清 768×1024、方图高清 1024×1024、竖版超清 1024×1536、横版高清 1536×1024）。

#### 2. ConfigPanel.tsx — 新增 props + 配置区

**Props 接口新增字段**（均为可选）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `imageGenEnabled` | `boolean` | 是否开启图片生成 |
| `imageGenWidth` | `number` | 图片宽度 |
| `imageGenHeight` | `number` | 图片高度 |
| `onImageGenToggle` | `(enabled: boolean) => void` | 开关回调 |
| `onImageGenSizeChange` | `(width: number, height: number) => void` | 尺寸变更回调 |

**antd 导入扩展**：`{ Button }` → `{ Button, Switch, Select }`

**新增导入**：`import { SIZE_PRESETS } from './SizeSelector'`

**JSX 结构**：在 ParameterPanel 后的 divider 与「记忆与上下文增强」区之间插入新配置区，包含：
- Switch 开关（是否开启图片生成，默认关闭）
- Select 下拉（图片大小，复用 SIZE_PRESETS，关闭时 disabled）
- 说明文字「在对话中一键生成场景图片」

### 改动文件

| 文件 | 改动 |
|------|------|
| `SizeSelector.tsx` | `const SIZE_PRESETS` → `export const SIZE_PRESETS` |
| `ConfigPanel.tsx` | antd 导入扩展 + SIZE_PRESETS 导入 + Props 接口新增 5 个字段 + 解构 + 新增「图片生成设置」JSX 配置区 |

### 验证

- TypeScript 诊断零错误（ConfigPanel.tsx + SizeSelector.tsx）
- 未修改 CharacterDialogueChat.tsx（将由后续任务单独处理）

### 注意事项

- `CharacterDialogueChat.tsx` 尚未传入新的 imageGen 相关 props，当前全部为可选字段，不影响现有编译。后续需在该文件中接入实际状态与回调。


## §35 ChatMessageBubble 新增「生成图片」按钮与图片消息渲染（Spec: add-conversation-image-generation / Task 3+4，2026-08-09）

### 概述

在 `ChatMessageBubble.tsx` 中为 assistant 消息新增「生成图片」操作按钮（PictureOutlined 图标），并支持当 `message.isImageMessage` 为 true 且 `message.generatedImage` 有值时渲染图片内容替代文本内容。图片消息不显示编辑、继续对话、重新生成等文本操作按钮，仅保留复制和「生成图片」按钮。

### 改动内容

#### 1. ChatMessageBubble.tsx — 新增 props

Props 接口新增 3 个可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `imageGenEnabled` | `boolean` | 图片生成功能是否开启 |
| `isGeneratingImage` | `boolean` | 是否正在生成图片（默认 false） |
| `onGenerateImage` | `(messageId: string) => void` | 点击生成图片按钮回调 |

#### 2. ChatMessageBubble.tsx — 导入扩展

`@ant-design/icons` 导入列表末尾新增 `PictureOutlined`。

#### 3. ChatMessageBubble.tsx — 图片消息标记与按钮显隐控制

- 新增 `const isImageMsg = !!message.isImageMessage;` 变量
- `showFullActions` 末尾追加 `&& !isImageMsg` 条件：图片消息不显示编辑、继续对话按钮
- 「重新生成」按钮（ReloadOutlined）包裹 `{!isImageMsg && (...)}` 条件：图片消息不显示重新生成按钮

#### 4. ChatMessageBubble.tsx — 「生成图片」按钮

在「重新生成」按钮之后、「继续对话」按钮之前新增「生成图片」按钮（PictureOutlined），不受 `showFullActions` / `showRegenerateOnly` 限制，对所有 assistant 消息可见：

- Tooltip：`imageGenEnabled === false` 时提示「图片生成功能未开启」，否则提示「生成图片」
- 禁用条件：`imageGenEnabled === false || isGeneratingImage || isStreaming || isGenerating || message.status === 'error'`
- `isGeneratingImage` 为 true 时显示 `LoadingOutlined` 替代 `PictureOutlined`

#### 5. ChatMessageBubble.tsx — 图片消息渲染

在气泡内容的三元表达式中新增中间分支：当 `message.isImageMessage && message.generatedImage` 为真时，渲染 `<div className="chat-msg-image-container">` 包裹的 `<img>` 和标签，替代 `MessageRenderer` 文本内容。结构为 `isEditing ? (编辑框) : (图片消息 ? (图片容器) : (文本内容))`。

#### 6. ChatMessageBubble.css — 图片消息样式

在 `@media (max-width: 480px)` 之前新增 3 个 CSS 类：

| CSS 类 | 用途 |
|--------|------|
| `.chat-msg-image-container` | 图片容器（flex 列布局，居中对齐，gap 8px） |
| `.chat-msg-generated-image` | 生成图片（max-width 100%，max-height 400px，圆角 8px，object-fit contain） |
| `.chat-msg-image-label` | 图片标签（11px，斜体，灰色） |

### 改动文件

| 文件 | 改动 |
|------|------|
| `ChatMessageBubble.tsx` | 导入 PictureOutlined + Props 新增 3 字段 + 解构 + isImageMsg 变量 + showFullActions 追加 !isImageMsg + 重新生成按钮包裹 !isImageMsg + 新增生成图片按钮 + 图片消息渲染分支 |
| `ChatMessageBubble.css` | 新增 3 个 CSS 类（.chat-msg-image-container / .chat-msg-generated-image / .chat-msg-image-label） |

### 验证

- TypeScript 诊断零错误（ChatMessageBubble.tsx + ChatMessageBubble.css）
- 「生成图片」按钮位于「重新生成」之后、「继续对话」之前
- 图片消息不显示编辑/继续对话/重新生成按钮
- 所有新增 props 均为可选，不影响现有调用方编译

### 注意事项

- `CharacterDialogueChat.tsx` 尚未传入 `imageGenEnabled` / `isGeneratingImage` / `onGenerateImage` props，当前全部为可选字段。后续 Task 7 需在该文件中接入实际状态与回调。

## §36 文档读取 IPC 通道（docs:read）（2026-08-09）

### 概述

新增 `docs:read` IPC 通道，供渲染进程读取项目根目录 `docs/` 下的技术文档文件内容。用于在应用内展示本地文档，无需渲染进程直接访问文件系统。

### 架构分层

```
Renderer (React)
  window.electronAPI.docs.read(fileName)
       │ ipcRenderer.invoke('docs:read', fileName)
       ▼
Preload Bridge (contextBridge)
  docs: { read }
       │
       ▼
Main Process (IPC Handler)
  docsHandlers() → ipcMain.handle('docs:read')
       │ fs.readFile(docsDir/fileName, 'utf-8')
       ▼
Filesystem
  开发环境: getProjectRoot()/docs/
  生产环境: process.resourcesPath/docs/
```

### 后端 IPC 通道

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `docs:read` | `fileName: string` | `string \| { success: false, error: string }` | 读取 docs/ 目录下的文档文件；成功返回文件内容字符串，失败返回错误对象 |

### 安全设计

- **路径穿越防护**：校验 `fileName`，拒绝包含 `..` 或以 `/`、`\` 开头的输入，防止越权读取 docs 目录以外的文件
- **路径解析兜底**：`app.isPackaged` 读取异常时降级到 `getProjectRoot()/docs`

### 涉及文件清单

- `src/main/ipc/handlers/docsHandlers.ts` — 新增文件，注册 `docs:read` handler
- `src/main/ipc/index.ts` — 导入并调用 `docsHandlers()`
- `src/main/preload.ts` — 新增 `docs` 命名空间（`docs.read`）

### 验证

- `tsc --noEmit` 零新增错误（`docsHandlers.ts` 无错误；`index.ts:1` 与 `preload.ts:46` 为既有错误，与本次改动无关）



## §37 CharacterDialogueChat 接入对话图片生成全流程（Spec: add-conversation-image-generation / Task 7，2026-08-09）

### 概述

在 `CharacterDialogueChat.hooks.ts` 和 `CharacterDialogueChat.tsx` 中实现完整的对话内图片生成流程。用户点击消息气泡上的「生成图片」按钮后，系统构建对话上下文 prompt，合并角色特征 tag 与 AI 生成的上下文 tag，调用 SD WebUI txt2img 生成图片，并将结果作为图片消息插入到对话流中。

### 改动内容

#### 1. CharacterDialogueChat.hooks.ts — 新增 `addImageMessage` 方法

在 `editMessage` 函数之后新增 `addImageMessage` useCallback，用于在指定消息之后插入一条图片消息：

- 通过 `messagesRef.current` 获取最新消息列表，定位插入位置
- 构造 `ChatMessage` 对象（`role: 'assistant'`、`isImageMessage: true`、`generatedImage: imageDataUrl`）
- 更新 `messagesRef.current`、dispatch `UPDATE_MESSAGES`、调用 `saveChatToStore` 持久化
- 不触发 AI 响应

在 return 语句中暴露 `addImageMessage`。

#### 2. CharacterDialogueChat.tsx — 导入扩展

新增 3 个导入：
- `buildAssetPromptTemplate` from `./PromptBuilder`
- `useCharacterTraitStore` from `../../../stores/characterTraitStore`
- `useCharacterLoraStore` from `../../../stores/characterLoraStore`

`CharacterDialogueChat.types` 导入追加 `ChatMessage` 类型。

#### 3. CharacterDialogueChat.tsx — Store 订阅与状态

- 从 hook 解构 `addImageMessage`
- 订阅 `useCharacterTraitStore`（`traits` / `currentCharacterCardId` / `loadTraits`）
- 订阅 `useCharacterLoraStore`（`loras` / `loadLoras`）
- 新增 `isGeneratingImage` useState
- 新增 `imageGenEnabled` 计算（`characterConfig?.customParameters?.image_gen_enabled === true`）

#### 4. CharacterDialogueChat.tsx — `handleGenerateImage` 回调

完整的图片生成流程（11 步）：
1. 构建对话上下文 prompt（过滤 `status === 'sent'` 的消息）
2. 确保角色特征和 LoRA 已加载（按 `characterCardId` 匹配）
3. 从 store 获取已启用的角色特征 tag（`useCharacterTraitStore.getState().traits`）
4. 调用 `window.electronAPI.ai.generateTraitPrompts` 生成上下文 tag
5. 合并上下文 tag 与角色特征 tag（去重）
6. 加载 SD 配置（`window.electronAPI.setting.load`）
7. 检测 SD WebUI 状态（`window.electronAPI.sd.checkStatus`）
8. 构建提示词模板（`buildAssetPromptTemplate('general', null)`）
9. 从配置读取图片尺寸（默认 1024×1024）
10. 构建 SD options（复用 AssetGenerateModal 的 `buildSdOptions` 字段结构）
11. 调用 `window.electronAPI.sd.generateTxt2Img` 生成图片，成功后调用 `addImageMessage` 插入

#### 5. CharacterDialogueChat.tsx — 配置处理器

- `handleImageGenToggle`：切换 `image_gen_enabled` 自定义参数
- `handleImageGenSizeChange`：修改 `image_gen_width` / `image_gen_height` 自定义参数

#### 6. CharacterDialogueChat.tsx — Props 传递

- `renderMessageBubble` 中向 `ChatMessageBubble` 传递 `imageGenEnabled` / `isGeneratingImage` / `onGenerateImage`
- 向 `ConfigPanel` 传递 `imageGenEnabled` / `imageGenWidth` / `imageGenHeight` / `onImageGenToggle` / `onImageGenSizeChange`

#### 7. CharacterDialogueChat.tsx — aiSequenceNumber 修正

图片消息（`isImageMessage: true`）虽然 `role === 'assistant'`，但不应计入 AI 回复序号。修改 `renderMessageBubble` 中的过滤条件，排除图片消息：

```
m.role === 'assistant' && !m.isImageMessage
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `CharacterDialogueChat.hooks.ts` | 新增 `addImageMessage` useCallback + return 语句暴露 |
| `CharacterDialogueChat.tsx` | 导入扩展 + 解构 addImageMessage + Store 订阅 + isGeneratingImage state + imageGenEnabled 计算 + handleGenerateImage 回调 + handleImageGenToggle/handleImageGenSizeChange + ChatMessageBubble props + ConfigPanel props + aiSequenceNumber 修正 |

### 验证

- TypeScript 诊断零错误（`CharacterDialogueChat.tsx` + `CharacterDialogueChat.hooks.ts`）
- `addImageMessage` 不触发 AI 响应，仅插入图片消息并持久化
- 图片消息不计入 AI 回复序号
- SD 生成流程复用 AssetGenerateModal 的字段结构与 PromptBuilder 模板

### 数据流

```
用户点击「生成图片」
  → handleGenerateImage(messageId)
    → 构建对话上下文 prompt
    → 加载角色特征 + LoRA
    → AI 生成上下文 tag（generateTraitPrompts IPC）
    → 合并 tag（去重）
    → 加载 SD 配置 + 检测状态
    → buildAssetPromptTemplate('general')
    → sd.generateTxt2Img IPC
    → addImageMessage(messageId, dataUrl)
      → messagesRef.current 更新
      → dispatch UPDATE_MESSAGES
      → saveChatToStore 持久化
```

---

## §34 帮助文档查看器 HelpViewer（2026-08-09）

### 概述

新增 Markdown 用户手册查看器组件 `HelpViewer`，以全屏 Modal 形式展示 `docs/user-manual.md`，提供左侧目录导航、滚动联动高亮、Fuse.js 全文搜索（含匹配片段高亮）三大能力，并完整适配亮色/暗色主题与移动端响应式布局。

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/renderer/components/Help/HelpViewer.tsx` | 帮助查看器组件（Modal + TOC + 搜索 + Markdown 渲染） |
| `src/renderer/components/Help/HelpViewer.css` | 组件样式（全屏 Modal、侧栏、Markdown 排版、暗色覆盖、响应式） |

### 类型声明补全

`src/main/preload.ts` 早已暴露 `docs.read`（`docs:read` IPC 通道，主进程 `docsHandlers.ts` 实现），但渲染进程类型声明 `src/renderer/types/electron.d.ts` 的 `ElectronAPI` 接口缺失 `docs` 命名空间。本次补全：

```ts
docs: {
  read: (fileName: string) => Promise<string | { success: false; error: string }>;
};
```

返回值契约：成功返回文档内容字符串，失败返回 `{ success: false, error }`（与 `docsHandlers.ts` 实现一致）。

### 实现要点

- **数据加载与缓存**：`open` 变为 `true` 时调用 `window.electronAPI.docs.read('user-manual.md')`，结果存入 `useRef` 缓存（`contentCache`），后续打开直接复用，避免重复 IPC。加载中展示 antd `Spin`，失败展示 `Alert`。
- **目录构建**：`extractToc()` 正则匹配 `^#\s+(.+)$` 提取所有 H1 标题，`slugify()` 生成合法 HTML id（保留中文 `\u4e00-\u9fa5`、字母、数字、连字符）。
- **Markdown 渲染**：`ReactMarkdown` + `remarkGfm` + `remarkEmoji`。通过 `components={{ h1 }}` 自定义渲染注入 slugified `id` 与 `ref`（存入 `sectionRefs`），供目录跳转与滚动追踪使用。`extractText()` 递归从 ReactNode 提取纯文本用于生成 id。
- **搜索**：`Fuse.js` 按 H1 章节切分内容建立索引（`threshold: 0.3`、`ignoreLocation: true`、`minMatchCharLength: 2`）。结果展示章节名 + 匹配片段，`highlightSnippet()` 利用 `split(regex)` 捕获组奇偶下标判定匹配段并包裹 `<mark>`（避免带 `g` 标志正则 `.test()` 的 `lastIndex` 状态污染问题）。
- **滚动联动高亮**：`scroll` 事件（`passive: true`）监听内容容器，遍历 `sectionRefs` 通过 `getBoundingClientRect()` 计算当前可视章节并高亮目录项。点击目录项调用 `scrollToSection()` 平滑滚动。
- **主题**：CSS 统一使用项目 CSS 变量（`--bg-layout` / `--bg-container` / `--text-heading` / `--text-primary` / `--text-secondary` / `--border-base` / `--bg-hover` / `--color-brand-primary` / `--color-brand-secondary`），暗色通过 `.dark` 选择器覆盖代码块与高亮色。注意：项目实际变量名为 `--color-brand-primary`（非任务描述中的 `--color-brand`）。
- **响应式**：`@media (max-width: 1024px)` 侧栏 240px；`768px` 侧栏改为 absolute overlay（`transform` 滑入），显示圆形目录切换按钮；`480px` 进一步紧凑。移动端输入搜索词或点击目录项后自动收起侧栏。

### antd v6 适配

antd v6 中 `Modal` 的 `destroyOnClose` 已废弃（`@deprecated Please use destroyOnHidden instead`），组件使用 `destroyOnHidden={false}` 保留挂载状态以配合内容缓存。

### 验证

- `npx tsc --noEmit` 检查：`HelpViewer.tsx` 与 `electron.d.ts`（`docs` 新增）零错误，未引入新错误；项目其余 TS 错误均为历史遗留（MemoryChat / WorldBook / Vector 等模块），与本次改动无关。
- 严格模式（`strict` + `noUnusedLocals` + `noUnusedParameters`）下编译通过：react-markdown `Components` 类型推断 h1 渲染器参数，`node` 通过 `void node` 标记为有意不使用以避免未使用告警。


## §38 ConfigPanel「图片生成设置」新增角色特征分类列表（Spec: fix-conversation-image-generation-bugs / Bug 3，2026-08-09）

### 概述

在 ConfigPanel 的「图片生成设置」折叠面板内新增「角色特征分类」列表，允许用户在生成图片前按分类启用/禁用角色特征。解决角色基础特征（如「戴帽子」）与对话场景（如「摘下帽子」）冲突时，用户无法选择性关闭某类特征的问题。

### 问题背景

从对话上下文生成图片时，系统会将角色特征注入 SD 提示词。但角色的基础特征（如上装类「戴着帽子」、配饰类「戴着眼镜」）可能与当前对话场景（「摘下了帽子」）矛盾，导致生成的图片与剧情不符。用户需要在生成图片前选择性禁用某些特征分类（如上装/下装/内衣、背景等）。

### 改动内容

#### 1. ConfigPanel.tsx — 导入扩展

- antd 导入新增 `Checkbox`：`{ Button, Switch, Select, Tooltip }` → `{ Button, Switch, Select, Tooltip, Checkbox }`
- 新增 `useCharacterTraitStore`（来自 `../../../stores/characterTraitStore`）
- 新增 `SYSTEM_TRAIT_CATEGORIES` / `UNCATEGORIZED_CATEGORY`（来自 `@shared/types`）
- 新增类型导入 `CharacterTraitItem` / `TraitCategory`（来自 `@shared/types`）

#### 2. ConfigPanel.tsx — Store 订阅与分类逻辑

在 `imageGenCollapsed` state 后新增：

- **Store 订阅**：`characterTraits` / `traitStoreCardId` / `loadTraits` / `toggleTraitEnabled` / `saveTraits` / `globalCategories`（均通过 selector 精确订阅）
- **useEffect 加载特征**：当 `characterCardId` 与 store 中 `currentCharacterCardId` 不一致时调用 `loadTraits(characterCardId)`
- **traitCategories**（`React.useMemo<TraitCategory[]>`）：拼接 `SYSTEM_TRAIT_CATEGORIES` + `globalCategories` + `UNCATEGORIZED_CATEGORY` 构建完整分类列表
- **traitsByCategory**（`React.useMemo`）：按 `categoryId` 将 `characterTraits` 分组为 `Record<string, CharacterTraitItem[]>`
- **handleCategoryToggle**（`React.useCallback`）：将指定分类下所有特征切换到目标 `enabled` 状态（仅对状态不一致的特征调用 `toggleTraitEnabled`），随后调用 `saveTraits(characterCardId)` 持久化
- **isCategoryAllEnabled**（`React.useCallback`）：检查分类下所有特征是否全部启用（空分类返回 `false`）

#### 3. ConfigPanel.tsx — JSX UI

在 `image-gen-panel-inner` div 内、hint 文字之后新增「角色特征分类」区块：

- 无特征时显示空状态提示文案
- 有特征时按 `traitCategories` 顺序渲染，跳过空分类（`catTraits.length === 0` 时 `return null`）
- 每个分类卡片包含：Checkbox（全选/全不选）+ 分类名 + 启用计数（`enabled/total`）+ 特征标签列表
- 启用特征标签为紫色高亮，禁用特征标签为灰色删除线样式

#### 4. ConfigPanel.css — 新增样式

在 `.image-gen-config-hint` 与 `@media` 查询之间新增 10 个 CSS 类：

| 类名 | 用途 |
|------|------|
| `.image-gen-trait-section` | 特征区块容器（顶部边框分隔） |
| `.image-gen-trait-section-title` | 区块标题 |
| `.image-gen-trait-empty` | 空状态文案 |
| `.image-gen-trait-categories` | 分类列表容器（flex column） |
| `.image-gen-trait-category` | 单个分类卡片 |
| `.image-gen-trait-category-header` | 分类头部（Checkbox + 计数） |
| `.image-gen-trait-category-name` | 分类名称 |
| `.image-gen-trait-count` | 启用计数 |
| `.image-gen-trait-tags` | 标签列表（flex wrap，左侧缩进 24px 对齐 Checkbox） |
| `.image-gen-trait-tag.enabled` / `.disabled` | 启用/禁用标签样式 |

### 改动文件

| 文件 | 改动 |
|------|------|
| `ConfigPanel.tsx` | antd 导入 +Checkbox + Store/类型导入 + Store 订阅 + useMemo/useCallback 逻辑 + 特征分类 JSX |
| `ConfigPanel.css` | 新增 10 个 `image-gen-trait-*` CSS 类 |

### 验证

- `npx tsc --noEmit` 检查：ConfigPanel.tsx 无新增错误（唯一报错为预存的 `expressionDisplay` prop 不匹配 `ParameterPanelProps`，与本次改动无关）
- VS Code 诊断：ConfigPanel.tsx 0 错误

### 注意事项

- **`noUnusedLocals` 适配**：项目 `tsconfig.json` 开启 `noUnusedLocals: true`，`TraitCategory` 类型导入需显式使用。通过 `React.useMemo<TraitCategory[]>` 为 `traitCategories` 添加显式泛型标注，使 `TraitCategory` 被实际引用，避免 TS6133 未使用导入错误。
- `handleCategoryToggle` 调用 `saveTraits(characterCardId)` 为 fire-and-forget（返回 Promise 但未 await），与项目中其他特征保存调用模式一致。
- 分类列表顺序：系统分类（basic → head → body → top → bottom → accessories → underwear → background → pose → expression）→ 自定义分类（`globalCategories`）→ 未分类（`UNCATEGORIZED_CATEGORY`，order=999）。

## §39 对话图片生成可审计性架构（Spec: enhance-conversation-image-auditability，2026-08-09）

### 概述

为对话中生成的图片提供端到端可审计能力：提示词落盘日志、图片下方标签展示、角色特征临时编辑（会话隔离）。覆盖三项用户能力：(1) 通过日志文件追溯每次生成使用的完整 prompt；(2) 在图片下方实时查看本次生成使用的标签和 prompt；(3) 在 ConfigPanel 即时编辑角色特征，仅影响当前对话不污染角色卡 manifest。

### 类型层扩展

| 类型 | 字段 | 用途 |
|------|------|------|
| `ImageHistoryItem` | `usedTags?: Array<{ text: string; weight?: number }>` | 该历史项生成时使用的标签快照（去重合并后） |
| `ImageHistoryItem` | `usedPrompt?: string` | 最终发送给 SD WebUI 的完整 prompt（含 LoRA + traits 替换后） |
| `ImageHistoryItem` | `usedNegativePrompt?: string` | 反向提示词快照 |
| `ImageHistoryItem` | `usedLoras?: Array<{ name: string; weight: number }>` | LoRA 列表快照 |
| `ImageHistoryItem` | `removedTags?: Array<{ text: string; reason?: string }>` | AI 标签优化时被移除的标签快照（含移除原因；仅试验性功能 `ai_optimize_traits` 开启且实际删除标签时填充，详见 §7.36 / Spec: add-ai-trait-optimization-for-image-gen） |
| `ImageHistoryItem` | `aiOptimization?: { status: 'success' \| 'no-removal' \| 'failed'; removedCount: number; error?: string }` | AI 标签优化执行状态元数据（仅 `ai_optimize_traits` 开启时填充）。三态反馈：`success`=已删除标签 / `no-removal`=已分析但无需删除 / `failed`=调用失败。解决原设计仅 `removedTags.length>0` 时渲染分区导致「AI 运行但无产出」场景用户看不到反馈的问题（详见 §7.37） |
| `AIParameterConfig` | `ai_optimize_traits?: boolean` | 是否允许 AI 在图片生成前优化（删除）与对话上下文矛盾的角色特征标签（试验性功能，默认 `false`，undefined / false 均视为关闭；详见 §7.36 / Spec: add-ai-trait-optimization-for-image-gen） |
| `CharacterTestChat` | `sessionTraits?: CharacterTraitItem[]` | 当前对话的临时特征覆盖（会话级，不写角色卡 manifest） |
| `SDGenerationOptions` | `sourceContext?: { source: 'conversation' \| 'asset-manager'; messageId?: string; characterCardId?: string; round?: number }` | 调用来源标识，用于日志区分对话生成 vs 素材管理生成 |

`electron.d.ts` 同步：`generateTxt2Img` 返回值新增 `finalPrompt: string`；`saveTestChat` 签名新增第 5 参数 `sessionTraits?`。

### 服务层：sdGenerationService

**新增 `image-generation` logger**（复用 `createLogger` 模块）：
- 落盘路径：开发环境 `logs/image-generation/image-generation_<timestamp>.log`，生产环境 `app.getAppPath()/logs/image-generation/`
- 10MB 自动轮转，最多保留 5 个文件
- `generateTxt2Img` 在 `applyTraitsAndLora` 之后、HTTP 请求之前调用 `logger.info(message, details, context)`：
  - `message`：`生成图片请求 [${sourceContext?.source || 'unknown'}]`
  - `details`：最终 prompt 字符串（多行可复制）
  - `context`：JSON 对象（negativePrompt / traits / loras / steps / cfgScale / sampler / scheduler / width / height / model / sourceContext）
- catch 分支调用 `logger.error` 记录失败原因 + sourceContext + 原始 prompt

**`generateTxt2Img` 返回值新增 `finalPrompt: string`**：
- `applyTraitsAndLora` 处理后的完整字符串（含 LoRA + traits 替换）
- 主进程是 prompt 组装的唯一权威源，渲染进程通过 IPC 返回值读取
- IPC handler `sd:generateTxt2Img` 透传 `finalPrompt`，`electron.d.ts` 同步类型签名

### Store 层：characterChatStore 扩展

`CharacterTestChat` 接口新增 `sessionTraits?: CharacterTraitItem[]` 字段（会话级临时特征覆盖）。新增 5 个 actions：

| Action | 签名 | 行为 |
|--------|------|------|
| `setSessionTraits` | `(traits: CharacterTraitItem[]) => Promise<void>` | 深拷贝入参 → 更新 currentTestChat → saveTestChat 持久化 |
| `resetSessionTraits` | `() => Promise<void>` | 置 currentTestChat.sessionTraits = undefined → saveTestChat 持久化 |
| `updateSessionTrait` | `(traitId: string, updates: Partial<CharacterTraitItem>) => Promise<void>` | lazy 初始化（sessionTraits 不存在时从 characterTraitStore.traits 深拷贝）→ 找到 trait 合并 updates → 持久化 |
| `addSessionTrait` | `(categoryId: string, text: string) => Promise<void>` | lazy 初始化 → genTraitId 生成新 trait（enabled=true, weight=1.0）→ 追加 → 持久化 |
| `removeSessionTrait` | `(traitId: string) => Promise<void>` | sessionTraits 不存在时 no-op → 过滤移除 → 持久化 |

**sessionTraits 与 characterTraitStore.traits 的核心区别**：
- `characterTraitStore.traits` → 持久化到角色卡 manifest（`traits.json`），跨会话共享
- `sessionTraits` → 仅随对话持久化（`chats/{characterCardName}.json`），会话隔离
- `executeImageGeneration` 优先读 `sessionTraits`，未设置时回退到角色卡 traits

**lazy initialization 策略**：`updateSessionTrait` / `addSessionTrait` 在 sessionTraits 未初始化时从 `characterTraitStore.traits` 深拷贝初始化。优势：用户首次编辑无需先点「全量复制」按钮；sessionTraits 的存在性自然成为「是否进入临时编辑模式」的标志（驱动 UI 徽标显示）。

**⚠️ 前置条件：`currentTestChat` 必须非 null**（§7.41）：所有 sessionTraits action 均以 `if (!current) return` 守卫开头，`currentTestChat` 为 null 时静默 no-op。`currentTestChat` 的初始化由两条路径保证：
1. `saveTestChat` action 在 IPC 返回后设置 `currentTestChat`（修复后 `!state.currentTestChat ||` 分支确保从 null 初始化）
2. `loadChatHistory`（hooks）在所有分支显式调用 `setCurrentTestChat`：「有历史」分支设置已加载的 chat 对象，「空状态」分支设置占位对象（`messages: []`），「first_mes」分支依赖 `saveChatToStore` 返回后初始化

详见 `src/renderer/stores/characterChatStore.ts` L59-101（接口）+ L319-531（实现）。

### UI 层：ChatMessageBubble 标签展示面板

在图片区域 `chat-msg-image-actions` 下方新增「查看本次生成标签」可折叠面板（仅 `imageAttachment.status === 'idle'` 且当前历史项有 `usedTags` 时渲染）：

- **折叠头部**：`<button>` + `DownOutlined/RightOutlined` 图标 + 「查看本次生成标签」文案 + `<Tag>{tagsCount} tags</Tag>` 徽标 + AI 优化徽标（仅 `aiOptimization` 存在时渲染，三态：success 绿/no-removal 灰/failed 红，§7.37）
- **展开后**：Tag 列表（每个 Tag 含文本 + 权重徽标 `:weight`）+ AI 优化分区（三态：success 展示被删除标签列表 / no-removal 提示无需删除 / failed 提示失败原因，§7.37）+ 二级折叠「查看完整 Prompt」
- **二级展开**：`<pre>` 块显示 `usedPrompt` + `usedNegativePrompt` + LoRAs 列表
- **历史导航自动折叠**：`useEffect` 依赖 `imageAttachment?.currentIndex` 重置 `tagsPanelExpanded` / `promptPanelExpanded`，避免上一版本的展开状态误导用户
- **旧数据兼容**：当前历史项无 `usedTags`（旧 ImageHistoryItem）时显示「此历史版本无标签快照」灰色提示；无 `aiOptimization`（旧数据或未启用 AI 优化）时不渲染 AI 优化分区/徽标

新增 CSS 类（`ChatMessageBubble.css`）：`.chat-msg-image-tags-panel` / `.chat-msg-image-tags-panel-header` / `.chat-msg-image-tags` / `.chat-msg-image-prompt`（等宽字体 + 横向滚动 + 暗色背景）/ `.chat-msg-image-tag-weight` / `.chat-msg-image-tags-empty` / `.chat-msg-image-tags-count`。样式遵循暗色主题 CSS 变量，视觉风格参考 `RagQualityReport.tsx` 的 Tag 渲染。

### UI 层：ConfigPanel 特征分类区域升级（从只读升级为可编辑）

`ConfigPanel.tsx` 从 `useCharacterChatStore` 订阅 `currentTestChat.sessionTraits` 与 5 个新 actions。派生 `effectiveTraits = sessionTraits ?? characterTraits`，特征分类区域渲染基于 `effectiveTraits`。

| 交互 | 行为 | 调用 |
|------|------|------|
| Tag 点击 | 切换 enabled 状态 | `updateSessionTrait(trait.id, { enabled: !trait.enabled })` |
| Tag 悬浮删除按钮 | 移除 trait | `removeSessionTrait(trait.id)` |
| Tag 双击 | 进入 inline 编辑态（Input + 回车确认 / Esc 取消） | `updateSessionTrait(trait.id, { text: newValue, originalText: undefined })` |
| 权重徽标点击 | 进入权重编辑态（InputNumber） | `updateSessionTrait(trait.id, { weight: newWeight })` |
| 「+ 添加特征」按钮 | 弹出 prompt 输入特征文本 | `addSessionTrait(cat.id, text)` |
| 分类级 Checkbox | 批量切换分类下所有特征 | 首次调用 lazy-init sessionTraits，后续 `setSessionTraits` 全量替换 |
| 「临时编辑中」徽标 | 仅 sessionTraits 存在时显示（黄色 + EditOutlined + Tooltip） | — |
| 「重置为角色卡特征」按钮 | 仅 sessionTraits 存在时显示，含 Modal.confirm 二次确认 | `resetSessionTraits()` |

新增 CSS 类（`ConfigPanel.css`）：`.image-gen-trait-tag.editable` / `.image-gen-trait-tag-edit-btn` / `.image-gen-trait-tag-weight-badge` / `.image-gen-trait-tag-editing` / `.image-gen-add-trait-btn` / `.image-gen-session-badge` / `.image-gen-reset-btn`。样式遵循暗色主题 CSS 变量。

### 数据流：executeImageGeneration 特征源切换

`CharacterDialogueChat.tsx` 的 `executeImageGeneration` 中：
1. 从 `useCharacterChatStore.getState().currentTestChat?.sessionTraits` 读取临时特征
2. 派生 `currentTraits = sessionTraits ?? useCharacterTraitStore.getState().traits`
3. `enabledTraitTexts` 与 `buildSdOptionsFromConfig` 的 `effectiveTraits` 参数传入 `currentTraits`
4. 日志输出特征来源（`[executeImageGeneration] 特征来源: ${sessionTraits ? 'sessionTraits (临时编辑)' : 'characterTraitStore (角色卡)'}`）
5. 生成成功时，`newHistoryItem` 快照 `usedTags: mergedTraits` / `usedPrompt: sdResult.finalPrompt` / `usedNegativePrompt` / `usedLoras`

### 数据流：sourceContext 接线

`executeImageGeneration` 构建 `sdOptions` 后赋值 `sourceContext = { source: 'conversation', messageId, characterCardId, round: (parentMsg.imageAttachment?.history?.length || 0) + 1 }`。素材管理弹窗（AssetGenerateModal / AssetManagerModal）调用 `sd.generateTxt2Img` 处传入 `sourceContext: { source: 'asset-manager' }`。日志通过 `sourceContext.source` 区分调用来源。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` | `ImageHistoryItem` 新增 4 字段 |
| `src/shared/types/sd.types.ts`（或 sdGenerationService 内联） | `SDGenerationOptions` 新增 `sourceContext` |
| `src/renderer/types/electron.d.ts` | `generateTxt2Img` 返回值签名 + `saveTestChat` 签名 |
| `src/main/services/sdGenerationService.ts` | `image-generation` logger + `finalPrompt` 返回值 |
| `src/main/ipc/handlers/sdGenerationHandlers.ts` | 透传 `finalPrompt` |
| `src/main/services/ChatStorageService.ts` | `TestChatData` 新增 `sessionTraits` 字段 |
| `src/main/ipc/handlers/characterChatHandlers.ts` | `saveCharacterTestChat` 新增 `sessionTraits` 参数 |
| `src/main/preload.ts` | `saveTestChat` 新增 `sessionTraits` 参数 |
| `src/renderer/stores/characterChatStore.ts` | 5 个新 actions + lazy init + 双层浅拷贝 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` | `executeImageGeneration` 特征源切换 + 标签快照 |
| `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` | 可折叠标签面板 |
| `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` | 7 个新 CSS 类 |
| `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` | 订阅 sessionTraits + Tag 可交互编辑 |
| `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` | 7 个新 CSS 类 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` | saveChatToStore 透传 sessionTraits |

### 关联文档

- `docs/FIX_RECORDS.md` §7.32（sourceContext 接线 / Task 3）/ §7.33（sessionTraits store / Task 7）/ §7.34（Task 1+2+4+5+6+8+9+10+11 综合记录）
- 前置依赖：§7.30（旧图片消息迁移为 imageAttachment）/ §7.31（hooks 新增 updateImageAttachment / deleteImageAttachment / navigateImageHistory）

### 设计约定

- **主进程是 prompt 组装的唯一权威源**：`applyTraitsAndLora` 在主进程完成 LoRA + traits 替换，渲染进程通过 `finalPrompt` 返回值读取，不在渲染层重组装（避免双源真相）
- **标签快照存历史项级别**（per-history-item）：同一消息可能有多张图片（重生成历史），每张图片独立快照，确保切换历史图片时显示对应版本的标签
- **sessionTraits 是会话级覆盖**：仅随对话持久化，不写角色卡 manifest，与角色卡 traits 物理隔离
- **lazy initialization**：sessionTraits 未初始化时从 characterTraitStore.traits 深拷贝，避免对话开始就消耗内存
- **标签面板默认折叠 + 历史导航自动折叠**：避免占用垂直空间，避免上一版本展开状态误导用户

## §40 对话互动元素识别架构（Spec: enhance-conversation-interaction-prompt-recognition，2026-08-09）

### 背景与动机

用户反馈：对话中描述动作互动（如"用手触摸她的身体"、"拥抱她"、"亲吻她"）时，生成的图片缺乏交互性质 — SD 仅生成角色独自站立/坐着的画面，未体现用户与角色的肢体接触。根因是原特征分类体系仅有 `pose`（角色自身姿势），无专门承载「用户与角色交互」的标签分类，AI 也不知道应输出 `disembodied_hand` / `hugging_another` 等 Danbooru 互动标签。

### 核心变更：新增 `interaction` 系统分类

**`src/shared/types/characterTrait.types.ts`** — `SYSTEM_TRAIT_CATEGORIES` 数组新增第 11 个系统分类：

```
{ id: 'interaction', name: '互动元素', isSystem: true, order: 10 }
```

与 `pose`（order 8）语义分离：
- `pose` = 角色自身的姿态（如 `sitting` / `standing` / `lying`）
- `interaction` = 与另一个实体的交互（如 `disembodied_hand` / `hugging_another` / `holding_hands`）

### 互动标签两种 Danbooru 模式

`buildDynamicTraitSystemPrompt` 注入的 `interactionGuidance` 指令块定义两种模式，AI 根据对话语境选择：

**■ 模式 A — POV/脱离身体风格**（第一人称描述触发，如"我用手触摸…"）：
- 用户不完整出现在画面中，仅出现交互的身体部位
- 身体接触类：`disembodied_hand` + `hand_on_breast` / `hand_on_butt` / `hand_on_hip` / `hand_on_leg`
- 舔舐类：`disembodied_tongue` + `licking` / `face_lick` / `breast_lick` / `foot_lick`
- 其他：`disembodied_penis` / `disembodied_foot` / `disembodied_mouth`

**■ 模式 B — 双角色互动风格**（第三人称或两角色互动描述触发）：
- 用户作为 "another" 完整出现在画面中，与角色互动
- 拥抱/牵手：`hugging_another` / `hug` / `holding_hands`
- 手放在他人身上：`hand_on_another's_head` / `_shoulder` / `_face` / `_cheek` / `_chin` / `_back` / `_arm` / `_chest` / `_thigh` / `_waist`
- 抓握他人：`grabbing_another's_breast` / `_ass` / `_arm` / `_hair` / `_wrist`
- 持握他人：`holding_another's_wrist` / `_hair` / `_arm` / `hand_in_another's_hair`
- 其他互动：`sitting_on_another` / `carrying_another` / `facing_another` / `smiling_at_another` / `kissing`

### 关键设计原则

1. **互动元素独立于角色完整形象** — 即使用户设定了完整形象，也必须添加 `disembodied_*` 标签（脱离身体的部位+动作），而非试图生成用户的完整角色。允许不生成用户完整角色，仅添加 disembodied_* 标签引导 SD 生成交互性质图片。
2. **互动标签必须成对出现** — `disembodied_hand` 配合 `hand_on_*`，`disembodied_tongue` 配合 `*_lick` / `licking_*`。
3. **条件触发** — 仅当对话明确描述互动动作时才输出互动标签；角色独自站立/坐着的描述不输出互动标签。角色卡描述场景（无互动描述）自然不触发。
4. **分类前缀输出** — 互动标签使用 `interaction:` 前缀，如 `interaction:disembodied_hand|脱离身体的手` / `interaction:hugging_another|拥抱他人`。
5. **模式选择依语境** — 第一人称描述倾向模式 A（`disembodied_*`）；第三人称或描述两个角色互动倾向模式 B（`*_another`）。

### 互动标签权重提升机制

互动标签在 SD prompt 中拼接位置靠后（角色特征标签之后），当角色特征标签较多时容易被图像模型忽略，导致生成的图片缺乏交互性质。通过对 `categoryId === 'interaction'` 的 trait 应用**分类级权重提升**来加强：

- **配置项**：`customParameters.interaction_weight`（`AIParameterConfig` 新增字段）
  - 默认 `1.2`（用户建议的 1.1-1.2 范围取上限）
  - 范围 `1.0-2.0`，步进 `0.1`，`1.0` = 不提升（等价关闭）
  - UI 入口：ConfigPanel「图片生成设置」面板内「互动标签权重」滑块（图片生成开启时可用）
- **权重组合方式**：`最终 weight = (per-tag weight ?? 1.0) × interaction_weight`
  - 分类级提升与标签级权重**相乘**，用户可同时调整两者
  - 如 `disembodied_hand` 无 per-tag weight + interaction_weight=1.2 → 最终 1.2 → prompt 输出 `(disembodied_hand:1.2)`
  - 如 `hugging_another` per-tag weight=1.5 + interaction_weight=1.2 → 最终 1.8 → prompt 输出 `(hugging_another:1.8)`
- **应用位置**：`executeImageGeneration`（渲染进程）构建 `mergedTraits` 后、传给 `buildSdOptionsFromConfig` 前。`applyTraitsAndLora`（主进程）只看到最终的 `{ text, weight }`，不感知 categoryId，保持主进程 prompt 组装逻辑不变
- **标签快照一致性**：`usedTags`（ImageHistoryItem）使用提升后的 `finalTraits`，与 `usedPrompt`（主进程 applyTraitsAndLora 处理后的最终 prompt）保持一致，用户在标签面板看到的权重值与实际 prompt 中的权重值对应

### 涉及文件

- `src/shared/types/characterTrait.types.ts` — `SYSTEM_TRAIT_CATEGORIES` 新增 `interaction` 分类（order 10）
- `src/main/services/characterTraitAIService.ts` — 三处同步更新：
  - `buildDynamicTraitSystemPrompt`：`systemCategoryDescriptions` 新增 `interaction` 描述；`systemGuidance` 新增互动元素归类建议；新增 `interactionGuidance` 指令块（含模式 A/B 标签清单 + 5 条关键原则）注入到 prompt
  - `buildDynamicImageTraitSystemPrompt`：`systemCategoryDescriptions` 新增 `interaction` 英文描述（标注「图片识别场景一般不触发」）；`systemGuidance` 新增互动元素归类建议。补齐英文描述避免 `SYSTEM_TRAIT_CATEGORIES` 含 `interaction` 但描述缺失导致分类列表回退中文名「互动元素」破坏英文 prompt 一致性
  - `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 基线常量：同步追加 `interaction` 分类描述与 guidance（基线参考，生产用动态构建版本）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `AIParameterConfig` 新增 `interaction_weight?: number` 字段（默认 1.2，范围 1.0-2.0）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 中：
  - `enabledTraitTexts` / `contextTraits` / `mergedTraits` 映射时保留 `categoryId`（用于识别 interaction 分类）
  - 新增分类级权重提升：`finalTraits = mergedTraits.map(t => categoryId === 'interaction' ? weight × interaction_weight : weight)`
  - `buildSdOptionsFromConfig` 与 `usedTags` 快照均使用 `finalTraits`（含提升后权重）
  - 新增 `handleInteractionWeightChange` 回调（范围校验 1.0-2.0）
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 新增「互动标签权重」滑块 UI（Slider 1.0-2.0 步进 0.1，默认 1.2，图片生成开启时可用）；**【UI 重构】**按 AssetGenerateModal「携带角色特征」面板设计重构特征分类区域：Collapse 折叠面板 + antd Tag（closable 删除 + onClick 切换 enabled）+ Tooltip（翻译/拆分溯源/权重）+ EditOutlined（文本编辑）+ Popover 权重编辑器（Slider + InputNumber + 预设按钮）+ TagAutocomplete 内联添加（替换 window.prompt，Electron 不支持）。保留分类级 Checkbox（indeterminate 三态）。所有分类均显示（含空分类），用户可向空分类（如 interaction）添加标签
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 新增 `.image-gen-interaction-weight-row` / `-control` / `-value` 三个 CSS 类；替换旧 tag 样式为 Collapse/Tag/Popover/weight-badge 新样式（`.image-gen-trait-collapse` / `.image-gen-trait-tag-wrapper` / `.image-gen-trait-weight-badge.default/.boost/.reduce` / `.image-gen-weight-popover` 等 ~15 个 CSS 类）

### 数据流

```
对话上下文描述互动动作
  ↓
generateTraitPrompts / generateCharacterTraits（characterTraitAIService）
  ↓
buildDynamicTraitSystemPrompt 注入 interactionGuidance 指令块
  ↓
LLM 识别互动语境 → 输出 interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部
  ↓
parseTraitsFromContent 解析 → CategorizedTrait { categoryId: 'interaction', text: 'disembodied_hand', translation: '脱离身体的手' }
  ↓
characterTraitStore.setTraits（MERGE 策略）→ CharacterTraitItem { categoryId: 'interaction', enabled: true }
  ↓
ConfigPanel 自动渲染「互动元素」分类折叠区（SYSTEM_TRAIT_CATEGORIES 驱动）
  ↓
executeImageGeneration 构建 mergedTraits（保留 categoryId）
  ↓
分类级权重提升：interaction 分类的 trait weight × interaction_weight（默认 1.2）
  → finalTraits: [{ text: 'disembodied_hand', weight: 1.2 }, { text: 'hand_on_breast', weight: 1.2 }]
  ↓
applyTraitsAndLora 拼接 finalTraits 到 SD prompt → (disembodied_hand:1.2), (hand_on_breast:1.2)
  ↓
SD 生成包含交互性质的图片（disembodied_hand + hand_on_breast → 画面出现一只手放在角色胸部）
```

### 设计约定

- **`interaction` 与 `pose` 不可混用**：角色自身姿态归 `pose`，与另一实体的交互归 `interaction`。如 `sitting`（角色自己坐着）= pose，`sitting_on_another`（坐在他人身上）= interaction。
- **互动标签优先成对**：模式 A 必须同时输出 `disembodied_*` 部位标签 + 配合的动作部位标签（如 `disembodied_hand` + `hand_on_breast`），单独输出 `disembodied_hand` 而无配合标签会导致 SD 不知手放在哪里。
- **图片识别场景不触发**：`recognizeImageTraits` 分析的是静态角色卡 PNG（单一角色），无对话上下文，互动标签一般不输出。`buildDynamicImageTraitSystemPrompt` 的 `interaction` 英文描述已标注「typically NOT applicable to single character image analysis」。
- **标签库覆盖验证**：`disembodied_hand`（count 71413）/ `hugging_another`（count 10622）/ `hand_on_another's_head`（count 47364）等互动标签均已存在于 `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv` 标签库，RAG 检索与 L0-L5 审计链可正常命中。

### 关联文档

- `docs/FIX_RECORDS.md` §7.35 — 实施记录与重点问题日志
- `CODE_WIKI.md` §「AI 生成特征自动归类」— 系统分类体系表（已更新为 11 个，含 `interaction`）
- `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv` — 互动标签数据源（disembodied_* / *_another 系列）

## AI 标签优化服务方法 `optimizeTraitsForContext`（Spec: add-ai-trait-optimization-for-image-gen / Task 2 + Spec: add-ai-tag-supplement-after-removal / Task 2）

> 2026-08-09 实施：在 `characterTraitAIService.ts` 中新增 `optimizeTraitsForContext` 方法，用于图片生成前由 AI 分析对话上下文与已启用角色特征标签的矛盾关系，返回应删除的标签列表 + 删除后应补充的标签列表。本节为 Task 2（AI 服务方法 + 接口），后续 Task（ConfigPanel 开关 / 标签快照面板「AI 已移除」分区渲染 / executeImageGeneration 接线 / IPC 通道）尚未实现。
>
> **2026-08-09 增量更新（Spec: add-ai-tag-supplement-after-removal / Task 2）**：system prompt 重构为 TWO PARTS（PART 1 - REMOVAL 矛盾识别 + PART 2 - SUPPLEMENT 缺失补充），响应解析器升级为同时返回 `tagsToRemove` + `tagsToAdd`，详见 `docs/FIX_RECORDS.md` §7.39。

### 设计动机

- 角色特征标签（如 `pants` / `sitting` / `hat`）在图片生成时携带以保证角色一致性，但对话过程中角色状态可能变化（脱衣 / 站起 / 离开等），此时仍携带旧标签会导致 SD 生成与对话矛盾的图片
- 通过 AI 分析对话上下文与标签的矛盾关系，在图片生成前自动删除不再适用的标签
- **补充能力**：删除矛盾标签后可能产生描述缺失（如移除 `pants` 后下身暴露但缺少 `pussy` 标签），AI 在同一次调用中评估并补充缺失的关键描述符
- ⚠️ 标注为试验性功能：AI 可能误删/误补标签，建议谨慎使用（Task 1 已在 `AIParameterConfig.ai_optimize_traits` 开关默认关闭）

### 新增接口（位于 `GenerateTraitPromptsResult` 之后）

| 接口 | 字段 | 说明 |
| --- | --- | --- |
| `OptimizeTraitsParams` | `traits: Array<{ text, weight?, categoryId? }>` | 当前已启用的角色特征标签列表 |
|  | `conversationContext: string` | 当前对话上下文（用户与角色的完整对话文本） |
| `OptimizeTraitsResult` | `success: boolean` | 调用是否成功 |
|  | `tagsToRemove?: Array<{ text, reason? }>` | AI 建议删除的标签列表（含原因） |
|  | `tagsToAdd?: Array<{ text, reason?, weight?, categoryId? }>` | AI 删除后评估补充的标签列表（Spec: add-ai-tag-supplement-after-removal） |
|  | `error?: string` | 失败时的友好错误信息 |

### 服务表增量 — `characterTraitAIService.optimizeTraitsForContext`

| 方法 / 类型 | 签名 | 说明 |
| --- | --- | --- |
| `optimizeTraitsForContext(params)` | async → `OptimizeTraitsResult` | 主入口；复用与 `generateTraitPrompts` 完全一致的调用模式；返回 `tagsToRemove` + `tagsToAdd` |
| `parseOptimizeResponse(content)` | private → `{ tagsToRemove, tagsToAdd }` | 解析 LLM JSON 响应；支持 ```` ```json ```` 代码块与裸 JSON；接受 `{ remove: [...], add: [...] }` 标准结构与裸数组兼容格式；防御性剔除 `tagsToAdd` 中与 `tagsToRemove` 同名的项（兜底执行规则 7）；解析失败返回 `{ tagsToRemove: [], tagsToAdd: [] }` |

### 调用流程（与 `generateTraitPrompts` 完全一致）

1. 入参校验：空对话上下文 → 返回错误；空标签列表 → 返回空 `tagsToRemove` 短路
2. 读取 AI 引擎配置：`aiConfigProvider.getAIConfig({ defaultTransmission: 'header' })` → baseUrl / apiKey / apiKeyTransmission / systemPrompt / modelName
3. 配置兜底校验：baseUrl / apiKey / modelName 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」
4. 读取运行时参数：`this.getEngineRuntimeConfig()` → temperature / maxTokens（缺失返回友好错误）
5. 构建 system prompt（英文指令，TWO PARTS：PART 1 矛盾识别 + PART 2 缺失补充 + 7 条规则 + JSON 输出格式）
6. 构建 user message（当前标签列表 + 对话上下文 + 两部分任务说明）
7. 构建 messages + `enrichSystemPrompt` 注入引擎级 system prompt
8. 非流式 POST `/v1/chat/completions`（apiKeyTransmission='header' 时 Authorization 头，否则 body.api_key）
9. 解析 `data.choices[0].message.content` → `parseOptimizeResponse` 提取 `tagsToRemove` + `tagsToAdd`
10. 返回 `{ success: true, tagsToRemove, tagsToAdd }`

### System Prompt 设计要点

- **TWO PARTS 结构**（Spec: add-ai-tag-supplement-after-removal / Task 2）：
  - **PART 1 - REMOVAL**：识别与对话上下文矛盾的标签
  - **PART 2 - SUPPLEMENT**：删除后评估缺失的关键描述符并补充
- **PART 1 五类常见矛盾模式**：clothing removal（脱衣）/ pose change（姿势变化）/ location change（位置变化）/ state change（状态变化）/ interaction withdrawal（互动抽回，§7.38 新增）
- **PART 2 四类常见补充模式**：exposure after clothing removal（服装移除后暴露特征）/ pose transition（姿势转换）/ state transition（状态转换）/ 仅补充必要标签（使用标准 Danbooru/e621 标签名）
- **7 条规则**：
  1. 仅删除直接矛盾的标签
  2. 不删除仍适用或模糊的标签
  3. 对话未明确描述变化时不删除
  4. 无需删除时返回空数组
  5. 有疑不删（conservative）
  6. 特别关注互动标签（disembodied_* / hand_on_* / *_another / holding_*）是否因对话进展而过时
  7. `add` 列表仅建议不在现有标签列表中的标签，且不补充同时建议删除的标签
- **输出格式**：严格 JSON `{ "remove": [{ "text", "reason" }], "add": [{ "text", "reason", "weight"?, "categoryId"? }] }`，无操作时返回 `{ "remove": [], "add": [] }`，仅返回 JSON 不含其他文本

### 错误兜底（与 `generateTraitPrompts` 一致）

- 空对话上下文 → `{ success: false, error: '对话上下文为空' }`
- 空标签列表 → `{ success: true, tagsToRemove: [] }`（短路，不调用 LLM；`tagsToAdd` 为可选字段默认 undefined）
- AI 引擎未配置 → `{ success: false, error: 'AI 引擎未配置，请先在设置中配置 API' }`
- 引擎参数缺失 → `{ success: false, error: 'AI 引擎未配置 temperature 或 max_tokens 参数...' }`
- HTTP 错误 → `{ success: false, error: 'AI 调用失败：HTTP <status> <statusText>' }`
- 空内容 → `{ success: false, error: 'AI 返回内容为空' }`
- 超时 / abort → `{ success: false, error: 'AI 调用失败：请求超时，请稍后重试' }`
- 其他异常 → `{ success: false, error: 'AI 调用失败：<message>' }`（永不抛异常）

### 日志前缀

- service 内部使用 `[TraitOptimizeAI]` 前缀（与 `[TraitPromptAI]` / `[CharacterTraitAI]` 风格一致）
- 优化结果日志含 `suggestedRemoval` / `removedTags` / `suggestedSupplement` / `addedTags` 四个字段

### 涉及文件

- `src/main/services/characterTraitAIService.ts` — 新增 `optimizeTraitsForContext(params)` 方法 + `OptimizeTraitsParams` / `OptimizeTraitsResult` 接口 + `parseOptimizeResponse` 私有辅助方法；复用 `aiConfigProvider.getAIConfig` / `getEngineRuntimeConfig` / `enrichSystemPrompt` 基础设施

### 后续待办（Spec 后续 Task）

- Task 3+：IPC 通道注册（`ai:optimizeTraitsForContext`）、preload 暴露、electron.d.ts 类型声明
- ~~ConfigPanel `ai_optimize_traits` 开关 UI（Task 1 已铺设类型）~~ ✅ 已由 Task 4 完成（见下节）
- 标签快照面板「AI 已移除」分区渲染（Task 1 已铺设 `ImageHistoryItem.removedTags` 类型；§7.37 扩展为基于 `aiOptimization` 三态反馈：success/no-removal/failed，面板头部新增徽标，展开后分区三态渲染）
- `executeImageGeneration` 接线：生成前调用优化 → 删除标签 → 记录到 `removedTags` 快照 + `aiOptimization` 执行状态元数据
- ~~**Spec: add-ai-tag-supplement-after-removal 后续 Task**：渲染层 `executeImageGeneration` 消费 `tagsToAdd`（合并到 mergedTraits + 记录到快照）+ 标签快照面板「AI 已补充」分区渲染 + 过度补充防护~~ ✅ 已完成（Task 3 见 §7.40 / `docs/FIX_RECORDS.md`，Task 4 见下节「ChatMessageBubble「AI 已补充」分区」）

## ConfigPanel「允许 AI 优化特征标签」开关 UI（Spec: add-ai-trait-optimization-for-image-gen / Task 4）

> 2026-08-09 实施：在 ConfigPanel「图片生成设置」折叠面板中新增「允许 AI 优化特征标签」试验性功能开关 UI + 警示条。本节为 Task 4（UI 层），仅修改 ConfigPanel.tsx 与 ConfigPanel.css，不修改任何现有逻辑。后续 Task（IPC / 接线 / 快照面板分区 / executeImageGeneration）尚未实现，开关尚不端到端生效（onClick 回调由 `CharacterDialogueChat.tsx` 接线后才会写入 customParameters）。

### 设计动机

- Task 1 已在 `AIParameterConfig.ai_optimize_traits` 铺设类型字段，Task 2 已实现 `optimizeTraitsForContext` AI 服务方法，但用户无法在 UI 上配置该开关
- 本 Task 补齐 UI 层：在「图片生成设置」面板内新增开关 + 试验性警示条，让用户可见可配置
- 开关默认关闭，与 Task 1「undefined / false 均视为关闭」语义一致
- 标注为试验性功能：AI 可能误删重要标签，警示条独立于 Tooltip 确保用户即使不悬停也能看到风险

### 新增 Props — `ConfigPanelProps`

位于 `onInteractionWeightChange` 之后，`engineCapabilities` 之前：

| Prop | 类型 | 说明 |
| --- | --- | --- |
| `aiOptimizeTraits?` | `boolean` | 开关当前状态（对应 `AIParameterConfig.ai_optimize_traits`，undefined / false 均视为关闭） |
| `onAiOptimizeTraitsToggle?` | `(enabled: boolean) => void` | 开关切换回调，由 `CharacterDialogueChat.tsx` 接线后写入 customParameters |

同步在组件函数参数解构中新增 `aiOptimizeTraits` / `onAiOptimizeTraitsToggle`（位于 `onInteractionWeightChange` 之后），保证 props 透传到 JSX。

### 新增 UI — JSX（位于「互动标签权重」滑块之后、「在对话中一键生成场景图片」hint 之前）

```tsx
<div className="image-gen-config-row image-gen-ai-optimize-row">
  <span className="image-gen-config-label">
    允许 AI 优化特征标签
    <Tooltip title="开启后，图片生成前 AI 会根据对话上下文自动分析并删除矛盾的角色特征标签（如对话中角色脱下裤子时移除 pants 标签）。此为试验性功能，AI 可能会误删重要标签。">
      <QuestionCircleOutlined className="image-gen-tooltip-icon" />
    </Tooltip>
  </span>
  <Switch
    size="small"
    checked={aiOptimizeTraits ?? false}
    onChange={onAiOptimizeTraitsToggle}
    disabled={!imageGenEnabled}
  />
</div>
<div className="image-gen-experimental-warning">
  ⚠ 试验性功能：AI 可能会删除重要标签，建议谨慎使用
</div>
```

关键设计：
- `checked={aiOptimizeTraits ?? false}` — 默认关闭，与 Task 1 语义一致
- `disabled={!imageGenEnabled}` — 与「图片大小」选择器联动，图片生成未开启时开关禁用
- 复用已导入的 `Switch` / `Tooltip` / `QuestionCircleOutlined`，无新增 antd 依赖
- 警示条独立于 Tooltip，确保不悬停也能看到试验性风险

### 新增 CSS — `ConfigPanel.css`（位于 `.image-gen-interaction-weight-value` 之后）

```css
.image-gen-ai-optimize-row {
  align-items: center;
}

.image-gen-experimental-warning {
  margin-top: -8px;
  margin-bottom: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-warning, #f59e0b);
  background: var(--color-warning-light, rgba(245, 158, 11, 0.1));
  border-radius: 4px;
  border-left: 2px solid var(--color-warning, #f59e0b);
  line-height: 1.5;
}
```

样式遵循暗色主题 CSS 变量体系：`--color-warning` / `--color-warning-light` 与 `.image-gen-session-badge` 同色系（橙色警告主题）。`margin-top: -8px` 让警示条紧贴开关行。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — `ConfigPanelProps` 接口新增 2 个字段 + 组件参数解构新增 2 个变量 + JSX 新增开关行 + 警示条
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 新增 2 个 CSS 类（`.image-gen-ai-optimize-row` / `.image-gen-experimental-warning`）

### 后续待办（Spec 后续 Task）

- `CharacterDialogueChat.tsx` 接线：读取 `customParameters.ai_optimize_traits` 传入 ConfigPanel + `onAiOptimizeTraitsToggle` 回调写入 customParameters（onCustomParameterChange 局部更新）
- IPC 通道注册（`ai:optimizeTraitsForContext`）、preload 暴露、electron.d.ts 类型声明
- 标签快照面板「AI 已移除」分区渲染（Task 1 已铺设 `ImageHistoryItem.removedTags` 类型；§7.37 扩展为基于 `aiOptimization` 三态反馈：success/no-removal/failed，面板头部新增徽标，展开后分区三态渲染）
- `executeImageGeneration` 接线：生成前调用优化 → 删除标签 → 记录到 `removedTags` 快照 + `aiOptimization` 执行状态元数据

## ChatMessageBubble「AI 已补充」分区 + 头部徽标扩展（Spec: add-ai-tag-supplement-after-removal / Task 4）

> 2026-08-09 实施：在 `ChatMessageBubble.tsx` 标签快照面板的 AI 优化分区中新增与「AI 已移除」对称的「AI 已补充」分区（展示 `addedTags`），并扩展面板头部 AI 徽标的 success 文案以同时反映移除与补充数量。本节为 Task 4（UI 渲染层），Task 1 已在 `ImageHistoryItem.addedTags?: Array<{ text: string; reason?: string }>` 与 `aiOptimization.addedCount: number` 铺设类型契约。CSS 类样式由 Task 5 负责，本 Task 仅修改 TSX。

### 设计动机

- 原 success 分支条件为 `status === 'success' && removedTags.length > 0`，要求 removedTags 非空才渲染分区；但「AI 只补充不删除」场景下 removedTags 为空，分区被吞掉，用户看不到「AI 已补充」反馈
- 头部徽标原 success 文案固定为 `AI 已移除 N`，无法反映「同时移除 + 补充」或「仅补充」场景，反馈不完整
- 需要对称扩展：与「AI 已移除」分区并列新增「AI 已补充」分区，两者各自独立条件渲染（可能只有其一，也可能两者都有）

### SubTask 4.1-4.3 / 4.5：success 分支重构 + 新增「AI 已补充」分区

`success` 分支条件从「且 removedTags 非空」改为无条件进入，内部 removedTags / addedTags 各自独立条件渲染：

```tsx
{currentHistoryItem.aiOptimization.status === 'success' ? (
  <>
    {/* AI 已移除分区（保留原逻辑，改为独立条件渲染） */}
    {currentHistoryItem.removedTags && currentHistoryItem.removedTags.length > 0 && (
      <>
        <span className="chat-msg-image-removed-tags-label">
          AI 已移除（{currentHistoryItem.aiOptimization.removedCount} 个）：
        </span>
        <div className="chat-msg-image-removed-tags-list">
          {currentHistoryItem.removedTags.map((t, i) => (
            <Tooltip key={i} title={t.reason ? `AI 删除原因：${t.reason}` : 'AI 根据对话上下文判断此标签不再适用'}>
              <Tag className="chat-msg-image-removed-tag">{t.text}</Tag>
            </Tooltip>
          ))}
        </div>
      </>
    )}
    {/* AI 已补充分区（新增） */}
    {currentHistoryItem.addedTags && currentHistoryItem.addedTags.length > 0 && (
      <>
        <span className="chat-msg-image-added-tags-label">
          AI 已补充（{currentHistoryItem.aiOptimization.addedCount} 个）：
        </span>
        <div className="chat-msg-image-added-tags-list">
          {currentHistoryItem.addedTags.map((t, i) => (
            <Tooltip key={i} title={t.reason ? `AI 补充原因：${t.reason}` : 'AI 根据对话上下文判断需要补充此标签'}>
              <Tag className="chat-msg-image-added-tag">{t.text}</Tag>
            </Tooltip>
          ))}
        </div>
      </>
    )}
  </>
) : currentHistoryItem.aiOptimization.status === 'no-removal' ? (
  ...（保留现有 no-removal 逻辑）
) : (
  ...（保留现有 failed 逻辑）
)}
```

关键设计点：
- success 分支不再要求 `removedTags.length > 0`，确保「仅补充不删除」场景下 addedTags 分区能正常渲染
- removedTags / addedTags 各自独立 `{...length > 0 && (...)}` 条件渲染，互不依赖（可能只有其一，也可能两者都有，也可能两者都空——此时 success 分支渲染空 Fragment，容器仍存在但不占内容）
- addedTags 的 Tooltip 文案：有 `reason` 时显示「AI 补充原因：{reason}」，无 reason 时兜底显示「AI 根据对话上下文判断需要补充此标签」（与 removedTags 的 Tooltip 文案风格对称）
- 标签数量取自 `aiOptimization.addedCount`（Task 1 已铺设），而非 `addedTags.length`，保证与服务端权威计数一致（与 removedTags 取 `removedCount` 的设计一致）
- 新增 CSS 类名（绿色高亮，对称于 removedTags 的灰色删除线）：`chat-msg-image-added-tags-label` / `chat-msg-image-added-tags-list` / `chat-msg-image-added-tag`（样式由 Task 5 在 `ChatMessageBubble.css` 中实现）

### SubTask 4.4：头部徽标 success 文案扩展

面板头部 AI 徽标（`chat-msg-image-ai-badge`，折叠态也可见）的 success 文案由固定 `AI 已移除 N` 扩展为条件分支：

```tsx
{currentHistoryItem.aiOptimization.status === 'success'
  ? currentHistoryItem.aiOptimization.addedCount > 0
    ? `AI 已移除 ${currentHistoryItem.aiOptimization.removedCount} / 已补充 ${currentHistoryItem.aiOptimization.addedCount}`
    : `AI 已移除 ${currentHistoryItem.aiOptimization.removedCount}`
  : currentHistoryItem.aiOptimization.status === 'no-removal'
    ? 'AI 已分析'
    : 'AI 失败'}
```

文案规则：
- `addedCount > 0` 时显示 `AI 已移除 N / 已补充 M`（斜杠分隔，同时反映两类操作）
- `addedCount === 0` 时保留原 `AI 已移除 N`（向后兼容，不增加噪音）
- no-removal / failed 文案不变

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx`
  - 头部徽标 JSX（约 L627-637）：success 文案条件分支扩展
  - AI 优化分区 success 分支（约 L659-705）：重构为 removedTags / addedTags 独立条件渲染 + 新增 addedTags 渲染块
  - 不修改 CSS 文件（Task 5 负责 `.chat-msg-image-added-tags-label` / `.chat-msg-image-added-tags-list` / `.chat-msg-image-added-tag` 样式）
  - 不修改 ChatMessageBubble.tsx 的其他部分（no-removal / failed 分支、标签面板、Prompt 面板等保持不变）

### 兼容性说明

- 旧数据（无 `addedTags` 字段或 `aiOptimization.addedCount` 为 undefined）：`addedTags && addedTags.length > 0` 短路为 false，addedTags 分区不渲染；`addedCount > 0` 在 undefined 时为 falsy，头部徽标回退到 `AI 已移除 N` 文案。完全向后兼容。
- 仅补充不删除场景（removedTags 为空、addedTags 非空）：success 分支进入，removedTags 块被条件吞掉，addedTags 块正常渲染，头部徽标显示 `AI 已移除 0 / 已补充 M`。

### 后续待办（Spec 后续 Task）

- ~~Task 5：CSS 样式实现（`ChatMessageBubble.css` 新增 `.chat-msg-image-added-tags-label` / `.chat-msg-image-added-tags-list` / `.chat-msg-image-added-tag`，绿色高亮对称于 removedTags 的灰色删除线）~~ ✅ 已完成，详见下一节
- AI 服务层 / executeImageGeneration 接线：实际填充 `addedTags` 快照与 `aiOptimization.addedCount` 计数（Task 1 已铺设类型契约）

## ChatMessageBubble「AI 已补充」分区 CSS 样式（Spec: add-ai-tag-supplement-after-removal / Task 5）

> 2026-08-09 实施：在 `ChatMessageBubble.css` 中为 Task 4 新增的三个 CSS 类名（`chat-msg-image-added-tags-label` / `chat-msg-image-added-tags-list` / `chat-msg-image-added-tag`）添加绿色系样式，与现有 removedTags（灰色删除线）形成视觉对比。同时微调 AI 优化分区容器 `.chat-msg-image-ai-optimization` 的 flex 方向，确保 success 状态下「已移除」与「已补充」两组「标签 + 列表」纵向堆叠。

### 新增样式（ChatMessageBubble.css 约第 736-759 行）

```css
/* ============ AI 标签补充分区（Spec: add-ai-tag-supplement-after-removal / Task 5） ============
   与 removedTags（灰色删除线）形成视觉对比，使用绿色高亮表示新增标签。
   样式遵循 ui-variables.css 既有 CSS 变量，兼容亮/暗双主题。 */
.chat-msg-image-added-tags-label {
  font-size: 11px;
  color: var(--color-success, #52c41a);
  font-weight: 500;
  margin-right: 4px;
}

.chat-msg-image-added-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.chat-msg-image-added-tag {
  font-size: 11px !important;
  color: var(--color-success, #52c41a) !important;
  background: var(--color-success-light, rgba(82, 196, 26, 0.12)) !important;
  border-color: var(--color-success, rgba(82, 196, 26, 0.4)) !important;
  cursor: help;
}
```

### 容器布局微调（ChatMessageBubble.css 约第 797-807 行）

`.chat-msg-image-ai-optimization` 容器由 `flex-direction: row`（默认）改为 `flex-direction: column`，使 success 分支下 removedTags 与 addedTags 两组「label + list」纵向堆叠，避免两组标签横向挤在同一行造成排版混乱。`no-removal` / `failed` 单元素状态不受影响（单元素在 column 容器中仍正常左对齐）。

### 设计要点

- **颜色对比**：addedTags 使用 `--color-success`（绿色 `#52c41a`，亮/暗主题同值）作为文字与边框色，背景使用 `--color-success-light`（亮色 `#f6ffed` / 暗色 `#162312`），与 removedTags 的灰色 `--text-tertiary` + 删除线 + `opacity: 0.5` 形成明确视觉区分
- **CSS 变量兼容**：所有颜色均使用 `ui-variables.css` 已定义的变量（`--color-success` / `--color-success-light`），并附带 rgba fallback，确保亮/暗双主题正确渲染
- **`!important` 使用**：added-tag 的 `font-size` / `color` / `background` / `border-color` 加 `!important` 以覆盖 Ant Design `<Tag>` 默认样式，与现有 `.chat-msg-image-removed-tag` 的写法保持一致
- **`cursor: help`**：与 removed-tag 一致，提示用户可悬停查看 AI 补充原因（Tooltip 由 Task 4 在 TSX 中实现）
- **布局对称**：added-tags-list 的 `display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px` 与 removed-tags-list 完全一致，保证两组标签换行行为统一

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css`
  - 新增 added-tags 三类样式（约 L736-759）
  - 微调 `.chat-msg-image-ai-optimization` 容器 flex 方向（约 L797-807）
  - 不修改 ChatMessageBubble.tsx 或其他文件

## 服装状态提示词指令增强（Spec: add-costume-state-prompt-directives，2026-08-09）

### 概述

为 `characterTraitAIService.ts` 增加服装状态识别能力，引导 AI 根据对话上下文中的服装变化描述（如敞开衣物、拉到一边、掀起等），生成 3 类 Danbooru 风格标签：开合状态 / 位置变化 / 身体部位暴露。该功能与互动元素识别（`interactionGuidance`）平行，复用 `interaction` 分类前缀输出，不新建分类。

### 改动清单

| 改动项 | 位置 | 说明 |
|--------|------|------|
| `buildCostumeStateGuidance()` | `characterTraitAIService.ts` 类内，`buildDynamicTraitSystemPrompt` 之前 | 新增私有方法，返回服装状态识别指令块字符串。与 `interactionGuidance` 平行，引导 AI 输出 3 类标签：A) 服装开合状态（`open_clothes` / `open_jacket` / `unbuttoned_shirt` 等）；B) 服装位置变化（`panties_aside` / `shirt_lift` / `skirt_lift` 等）；C) 身体部位暴露（`one_breast_out` / `cleavage` / `navel` 等）。关键原则：服装状态标签描述「衣物仍在身上但状态改变」，区别于衣物完全移除 |
| `costumeStateGuidance` 拼接 | `buildDynamicTraitSystemPrompt` 内 | 在 `interactionGuidance` 变量定义后、`return` 语句前，调用 `this.buildCostumeStateGuidance()` 赋值给 `costumeStateGuidance`；在 return 模板字符串中 `${interactionGuidance}` 之后、`要求：` 之前插入 `${costumeStateGuidance}` |
| `COSTUME_STATE_RAG_KEYWORDS` 常量 | `CharacterTraitAIService` 类顶部 | `private static readonly` 字符串常量，由 22 个服装状态标签关键词 `.join(' ')` 组成，用于 RAG 检索 |
| 服装状态 RAG 检索 | `generateTraitPrompts` 内，现有 RAG 检索之后 | 用 `COSTUME_STATE_RAG_KEYWORDS` 调用 `buildRagReferenceWithDebug` 额外检索 RAG 标签库，将检索到的服装状态相关标签以 `## 服装状态标签参考` 标题注入 system prompt。RAG 未启用/检索失败时静默跳过。后续 `messages` 中的 system content 由 `systemPromptWithRag` 改为 `systemPromptWithAllRag` |
| `optimizeTraitsForContext` system prompt 扩展 | `optimizeTraitsForContext` 内 | PART 1 REMOVAL 新增 2 条服装状态矛盾模式（开合复位 / 位置复位）；PART 2 SUPPLEMENT 新增 3 条服装状态补充模式（开合→暴露 / 位移→暴露 / 位移→身体部位）；JSON 返回示例扩展为包含服装状态 remove/add 示例 |

### 设计要点

1. **分类复用**：服装状态标签使用 `interaction` 分类前缀（如 `interaction:open_clothes|衣物敞开`），不新建分类，与互动标签共用 `interaction` 分类
2. **条件触发**：仅当对话上下文明确描述服装状态变化时才输出对应标签；角色穿着完整的描述不触发
3. **配合使用**：开合/位移标签通常需要配合暴露标签使用（如 `open_shirt` → `cleavage` / `one_breast_out`；`panties_aside` → `pussy`；`shirt_lift` → `navel` / `midriff`）
4. **与衣物移除的区分**：服装状态标签描述「衣物仍在身上但状态改变」，衣物完全移除用 `top` / `bottom` / `underwear` 分类的删除来处理
5. **扩展接口**：`buildCostumeStateGuidance()` 为独立方法，后续可平行新增 `buildPoseStateGuidance()` 等方法，拼接到 `buildDynamicTraitSystemPrompt` 的同一位置
6. **RAG 检索调试信息**：`costumeRagStatus` 字段因 `GenerateTraitPromptsResult` 类型定义为严格内联对象（无 index signature）而跳过添加，避免引入类型错误

### 验证

- `npx tsc --noEmit` 检查 `characterTraitAIService.ts`（非测试文件）零新增类型错误
- 测试文件 `characterTraitAIService.test.ts` 的预存错误（TS2307 模块路径 / TS2339 属性不存在）与本改动无关





## §35 AI 使用场景清单（微调训练数据制备基础）（2026-08-10）

**关联文档**：[docs/AI_USAGE_INVENTORY.md](docs/AI_USAGE_INVENTORY.md)

**背景**：在使用 AI 模型进行图片提示词生成、文本解析提示词 tag 生成等图片相关场景时，发现模型输出的准确率未能满足项目需求。计划针对当前模型及特定使用场景进行定向微调，开发一个专门强化角色扮演、图片提示词生成、小说编写等场景的小体量优化模型。

**产出**：完成全项目源码系统性扫描，识别并提取 35 个 AI 使用场景，按「五要素」（功能位置 / System Prompt 原文 / 输入参数 / 期望输出 / 调用频率与重要度）结构化登记。

**场景分布**：
- P0 图片提示词生成领域：7 个场景（角色特征提取 / 图片识别 / 提示词生成 / 标签优化 / AI 兜底同义词 / 表情图 SD/NL 提示词）
- P1 角色扮演对话领域：8 个场景（对话主提示词 / 续写 / 用户回复 / 输入润色 / 表情约束 / 辅助模式 / 长度emoji语言 / 角色锚定）
- P1 小说写作领域：8 个场景（大纲生成 / 大纲续写 / 章节内容 / 描写润色 / 剧情检查 / 文风学习 / 表格整理）
- P1 世界书领域：5 个场景（维度分析 / 澄清问题 / 设定矛盾检测 / 条目生成 / SKILL.md 提示词）
- P2 记忆与表格整理领域：3 个场景（批量整理 / 增量整理 / 调用入口）
- P2 游戏叙事领域：2 个场景（游戏旁白 / 经营游戏定位）
- P1 智能体领域：3 个场景（对话提示词 / LLM 抽象层 / 写作智能体）
- P2 提示词工程辅助领域：2 个场景（框架润色 / 模板构建）

**重点标记场景**：14 个场景被标记为微调难点加权对象，包括图片相关 P0 全部场景、fix-polish 系列 bug 修复场景、JSON 输出易错场景、多模态视觉场景、变体称呼识别难点场景。

**建议总样本量**：约 8,000-12,000 条（含数据增强后），按 P0 ×3 / P1 ×2 / P2 ×1 权重采样。

**关联 Spec**：.trae/specs/catalog-ai-usage-scenarios-for-finetuning/`n

## §41 对话模式同步整理（Sync Mode）修复（2026-08-15）

### 概述

对记忆整理模块的同步整理（Sync Mode）进行了三项修复，覆盖 AI 调用层统一、断点续传边界条件、以及引擎参数配置读取。

### 改动一：`callAIAPI` 委托给 `callAIAPIWithFetch`

**文件**：`src/main/services/memory/aiClient.ts`

- `callAIAPI` 函数内部将请求构造委托给 `aiHttpClient.callAIAPIWithFetch`，消除了内联的 fetch 逻辑，统一了 AI HTTP 调用路径
- 使用 `aiHttpClient` 的统一超时、重试、鉴权、响应解析逻辑
- 保持导出签名不变（对外兼容），保留原有的 `addLog` 日志记录方式

### 改动二：断点续传边界条件修复

**文件**：`src/main/services/memory/organizeOrchestrator.ts`

`createProgressiveHandler` 中 `calculateStartIndex` 方法修复：

- 当 `existingProgress.totalMessages > targetMessages.length` 时（聊天记录被回滚/删除导致消息数减少），断点续传记录已不可信，重置为从头开始处理（`return { startIndex: 0, completed: false, resumed: false }`）
- 新增断点续传决策日志，覆盖所有分支（续传成功、消息数增加、消息数减少、无记录）

### 改动三：`getEngineAIParams` 统一配置读取

**文件**：`src/main/services/memory/aiClient.ts`

- 始终返回完整参数集，不再因参数缺失返回 `null`
- 缺失参数使用默认值：`temperature=0.7, max_tokens=4096, top_p=0.9, frequency_penalty=0, presence_penalty=0`
- 修复原代码中 `max_tokens: undefined` 的 bug（引擎有该字段时仍被硬编码为 undefined）
- 返回类型改为无 `null` 分支，所有调用端 `engineAIParams ?? undefined` 兼容运行

### 验证

- `tsc --noEmit` 项目级检查，两个修改文件均零新增错误（项目级错误均为其他文件的预存错误）
- VS Code 诊断 `GetDiagnostics` 对两个修改文件返回空数组
