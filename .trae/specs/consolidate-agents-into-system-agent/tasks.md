# Tasks

## 阶段一：系统智能体定义与数据迁移（M1）

- [x] Task 1: 合并预置智能体定义为单一系统智能体
  - [x] SubTask 1.1: 修改 `agentConfigService.ts` 的 `SYSTEM_AGENTS` 数组，替换三个旧定义为单一 `system-agent`（id: 'system-agent', name: '系统智能体', type: 'custom', mode: 'dialogue', skills: 合并所有原技能, identity: { emoji: '🤖', color: '#1890ff' }）
  - [x] SubTask 1.2: 在 `_doInit()` 中新增旧智能体迁移逻辑：检测 `dialogue-agent`/`writing-agent`/`worldbook-agent` 是否存在，若存在则从 `agent_configs` 表中删除（系统预置智能体无用户数据，安全删除）
  - [x] SubTask 1.3: 更新 `AgentType` 类型注释，说明 `system-agent` 使用 `custom` 类型 + `dialogue` 模式作为通用配置
  - [x] SubTask 1.4: 验证系统启动后智能体列表仅显示一个预置智能体

## 阶段二：系统指令注册与处理架构（M2）

- [x] Task 2: 扩展斜杠命令系统支持系统指令
  - [x] SubTask 2.1: 在 `SlashCommandRegistry.ts` 中确认中文命令名支持（Map 键为 string，天然支持中文，无需修改核心逻辑）
  - [x] SubTask 2.2: 新建 `src/renderer/components/Common/SlashCommand/systemCommands.ts`，定义系统指令注册函数 `registerSystemCommands(callbacks)`，回调接口包含 `onListWorldbooks`/`onListCharacters`/`onWriteWorldbook(name)`/`onAuditWorldbook(name)`
  - [x] SubTask 2.3: 注册 4 个系统指令：`/世界书`（无参数，列表世界书）、`/角色卡`（无参数，列表角色卡）、`/编写`（参数 `<世界书名称>`，启动编写流程）、`/审核`（参数 `<名称>`，启动审核流程）
  - [x] SubTask 2.4: 注册 `/帮助` 指令（别名 `/help`），展示所有可用系统指令列表
  - [x] SubTask 2.5: 在 `systemCommands.ts` 中导出 `getSystemCommandNames()` 函数，返回所有系统指令名列表，供对话窗口识别指令前缀

- [x] Task 3: 在 AgentDialogueModal 中集成指令处理
  - [x] SubTask 3.1: 修改 `useAgentDialogue.ts`，在 `sendMessage` 中检测消息内容是否以 `/` 开头且匹配系统指令名
  - [x] SubTask 3.2: 若匹配系统指令：解析指令名和参数，调用对应回调（onListWorldbooks 等），将结果以 assistant 消息形式追加到对话流
  - [x] SubTask 3.3: 若不匹配系统指令：走正常 agent.run 对话流程
  - [x] SubTask 3.4: 指令执行结果格式化：世界书列表以表格/列表形式展示，角色卡列表同理，编写/审核流程以进度消息展示
  - [x] SubTask 3.5: 无效指令处理：返回友好错误提示 assistant 消息，不影响后续对话

## 阶段三：系统指令功能实现（M3）

- [x] Task 4: 实现 /世界书 和 /角色卡 指令
  - [x] SubTask 4.1: 在 `useAgentDialogue.ts` 中实现 `handleListWorldbooks` 回调：调用 `window.electronAPI.worldBook.list()` 获取世界书列表，格式化为 Markdown 列表（名称 + 条目数 + 更新时间）
  - [x] SubTask 4.2: 在 `useAgentDialogue.ts` 中实现 `handleListCharacters` 回调：调用 `window.electronAPI.character.list()` 获取角色卡列表，格式化为 Markdown 列表（名称 + 描述）
  - [x] SubTask 4.3: 列表为空时显示友好提示"当前没有可用的世界书/角色卡"

- [x] Task 5: 实现 /编写 指令
  - [x] SubTask 5.1: 在 `useAgentDialogue.ts` 中实现 `handleWriteWorldbook(name)` 回调：先调用 `worldBook.list()` 查找名称匹配的世界书
  - [x] SubTask 5.2: 找到时调用 `window.electronAPI.worldBookAgent.run({ userPrompt: '编写世界书', worldBookPath: <匹配路径> })` 启动编写流程
  - [x] SubTask 5.3: 订阅 `worldBookAgent:progress` 事件，将进度信息以 assistant 消息形式追加到对话流
  - [x] SubTask 5.4: 编写完成或失败时显示结束消息
  - [x] SubTask 5.5: 未找到世界书时返回"未找到名为「{name}」的世界书"提示

- [x] Task 6: 实现 /审核 指令
  - [x] SubTask 6.1: 在 `useAgentDialogue.ts` 中实现 `handleAuditWorldbook(name)` 回调：先调用 `worldBook.list()` 查找名称匹配的世界书
  - [x] SubTask 6.2: 找到时读取世界书内容（`worldBook.read(path)`），调用审核逻辑（复用现有审核 IPC 或直接调用 worldbookAuditService 对应 IPC）
  - [x] SubTask 6.3: 将审核结果格式化为 assistant 消息展示（完整性/一致性/符合度三维评分 + 问题列表）
  - [x] SubTask 6.4: 未找到世界书时返回友好提示

## 阶段四：UI 调整与只读保护（M4）

- [x] Task 7: 系统智能体详情只读保护
  - [x] SubTask 7.1: 修改 `AgentDetail.tsx`，当 `agent.isSystem === true` 时隐藏技能配置面板的编辑功能（SkillConfigPanel 传入 `readOnly` prop）
  - [x] SubTask 7.2: 修改 `AgentList.tsx`，系统智能体行不显示"编辑"和"删除"按钮（仅显示"对话"和"详情"）
  - [x] SubTask 7.3: 修改 `SkillConfigPanel.tsx`，新增 `readOnly?: boolean` prop，为 true 时 Checkbox/Switch 全部 disabled

- [x] Task 8: AgentDialogueModal 指令输入提示
  - [x] SubTask 8.1: 在 `AgentDialogueModal.tsx` 输入框 placeholder 中提示可用指令（"输入消息或 /世界书 /角色卡 /编写 /审核 …"）
  - [x] SubTask 8.2: 在对话窗口开场白中列出可用系统指令
  - [x] SubTask 8.3: 输入 `/` 时显示系统指令补全浮层（复用现有 SlashCommandAutoComplete 组件，传入系统指令列表）

## 阶段五：旧智能体迁移与验证（M5）

- [x] Task 9: 旧预置智能体数据迁移
  - [x] SubTask 9.1: 在 `agentConfigService._doInit()` 中，注册 system-agent 之前，检测并删除旧的三个预置智能体记录（dialogue-agent/writing-agent/worldbook-agent）
  - [x] SubTask 9.2: 迁移安全性验证：旧智能体均为 isSystem=true 且无用户自定义数据，直接删除安全
  - [x] SubTask 9.3: 更新 `AgentConfigService` 的删除保护逻辑：`delete()` 方法中对旧系统智能体 ID 放行删除（当前 isSystem 不可删除，需在迁移逻辑中绕过此限制或使用直接 SQL 删除）

- [x] Task 10: 端到端验证
  - [x] SubTask 10.1: 验证系统启动后智能体列表仅显示一个"系统智能体"
  - [x] SubTask 10.2: 验证 /世界书 指令正确展示世界书列表
  - [x] SubTask 10.3: 验证 /角色卡 指令正确展示角色卡列表
  - [x] SubTask 10.4: 验证 /编写 指令正确启动世界书编写流程
  - [x] SubTask 10.5: 验证 /审核 指令正确执行审核流程
  - [x] SubTask 10.6: 验证无效指令返回友好提示
  - [x] SubTask 10.7: 验证系统智能体详情只读保护正常
  - [x] SubTask 10.8: 验证普通多轮对话功能不受影响

# Task Dependencies

- Task 2（系统指令注册）depends on Task 1（系统智能体定义完成，确保指令在系统智能体上下文中使用）
- Task 3（AgentDialogueModal 集成）depends on Task 2（系统指令注册完成）
- Task 4（/世界书 /角色卡 实现）depends on Task 3（对话窗口指令处理集成完成）
- Task 5（/编写 实现）depends on Task 3
- Task 6（/审核 实现）depends on Task 3
- Task 7（详情只读保护）无依赖，可与 Task 2-6 并行
- Task 8（指令输入提示）depends on Task 2（系统指令注册完成）
- Task 9（旧智能体迁移）depends on Task 1（新系统智能体定义完成）
- Task 10（端到端验证）depends on all previous tasks

## 并行化建议

- Task 4 + Task 5 + Task 6 可并行实现（三个指令功能独立）
- Task 7 + Task 8 可并行实现（UI 调整独立于指令功能）
- Task 9 可与 Task 2 并行（数据迁移与指令注册无依赖）
