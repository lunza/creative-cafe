# Checklist

## 阶段一：系统智能体定义与数据迁移（M1）

- [x] `agentConfigService.ts` 的 `SYSTEM_AGENTS` 数组仅包含一个 `system-agent` 定义
- [x] `system-agent` 的 `skills` 数组包含所有原三个智能体的技能（state-table-edit, chat-history-search, worldbook-search, plot-check, outline-generate, chapter-write, description-polish, table-organize, worldbook-author, worldbook-generate, worldbook-keywords, worldbook-sort）
- [x] `system-agent` 的 `isSystem` 为 true，`identity` 包含 emoji 和 color
- [x] 系统启动后智能体列表中不出现旧的三个预置智能体（dialogue-agent/writing-agent/worldbook-agent）
- [x] 旧智能体记录已从 `agent_configs` 表中安全删除

## 阶段二：系统指令注册与处理架构（M2）

- [x] `systemCommands.ts` 文件存在且定义了 `registerSystemCommands` 函数
- [x] 4 个系统指令已注册：`/世界书`、`/角色卡`、`/编写`、`/审核`
- [x] `/帮助` 指令已注册，展示所有可用系统指令列表
- [x] `getSystemCommandNames()` 函数返回所有系统指令名列表
- [x] `SlashCommandRegistry` 正确支持中文指令名注册和查询
- [x] `useAgentDialogue.ts` 中 `sendMessage` 能检测 `/` 前缀并匹配系统指令
- [x] 匹配系统指令时调用对应回调，不触发 `agent.run`
- [x] 不匹配系统指令时走正常 `agent.run` 对话流程
- [x] 无效指令返回友好错误提示 assistant 消息

## 阶段三：系统指令功能实现（M3）

- [x] `/世界书` 指令调用 `worldBook.list()` 并以 Markdown 列表展示结果
- [x] `/角色卡` 指令调用 `character.list()` 并以 Markdown 列表展示结果
- [x] 世界书/角色卡列表为空时显示友好提示
- [x] `/编写 <名称>` 指令正确查找世界书并启动编写流程
- [x] 世界书编写进度通过 `worldBookAgent:progress` 事件订阅并展示在对话流中
- [x] `/编写` 指令未找到世界书时返回"未找到名为「{name}」的世界书"提示
- [x] `/审核 <名称>` 指令正确查找世界书并执行审核流程
- [x] 审核结果以三维评分 + 问题列表形式展示在对话流中
- [x] `/审核` 指令未找到世界书时返回友好提示

## 阶段四：UI 调整与只读保护（M4）

- [x] `AgentDetail.tsx` 中系统智能体（isSystem=true）的 SkillConfigPanel 传入 `readOnly` prop
- [x] `SkillConfigPanel.tsx` 支持 `readOnly` prop，为 true 时所有控件 disabled
- [x] `AgentList.tsx` 中系统智能体行不显示"编辑"和"删除"按钮
- [x] `AgentDialogueModal.tsx` 输入框 placeholder 提示可用指令
- [x] 对话窗口开场白列出所有可用系统指令
- [x] 输入 `/` 时显示系统指令补全浮层

## 阶段五：旧智能体迁移与验证（M5）

- [x] `_doInit()` 中检测并删除旧三个预置智能体记录的逻辑正常工作
- [x] 旧智能体删除不影响用户自定义智能体
- [x] 系统启动后智能体列表仅显示一个"系统智能体"
- [x] 普通多轮对话功能不受指令集成影响
- [x] 工具调用功能（AgentCore）在系统智能体下正常工作
- [x] 所有系统指令在对话窗口中正确执行并返回结果
- [x] 无效指令格式提供清晰错误提示
- [x] 系统智能体详情只读保护正常（不可编辑名称/描述/类型/技能/模式）
- [x] 技能提示词注入（`<available_skills>`）在系统智能体对话中正常工作

## 交叉验证

- [x] 新增系统指令不破坏现有斜杠命令（/help, /reset, /retry 等）功能
- [x] 系统智能体的技能白名单在 prompt 注入时正确过滤
- [x] AgentConfigService 的 CRUD 接口在系统智能体上行为正确（update 允许但前端限制编辑）
- [x] IPC 通道名与 preload 命名空间保持一致（复用现有 worldBook/character/worldBookAgent 通道）
