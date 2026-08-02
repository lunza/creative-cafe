# Tasks

## 阶段一：命令自动提示扩展（M1）

- [x] Task 1: AgentDialogueModal 命令提示展示全部已注册命令
  - [x] SubTask 1.1: 修改 `AgentDialogueModal.tsx` 的 `systemCommands` useMemo，改为从 `slashCommandRegistry.getAll()` 获取全部命令（不再仅过滤 systemNames）
  - [x] SubTask 1.2: 确保内置命令（help/reset/retry/continue/polish/model/clear）和系统指令（世界书/角色卡/编写/审核/帮助）均被注册并出现在列表中
  - [x] SubTask 1.3: 验证输入 `/` 时下拉列表展示全部命令，输入 `/re` 时过滤为 reset/retry，键盘导航正常工作

## 阶段二：优化输入按钮（M2）

- [x] Task 2: 在 useAgentDialogue 中实现优化输入逻辑
  - [x] SubTask 2.1: 新增 `optimizeInput(originalText: string): Promise<string>` 方法，调用 AI 引擎对输入文本进行优化
  - [x] SubTask 2.2: 构建优化专用 system prompt：角色为"文本优化助手"，指令为提升表述清晰度、增强指令完整性、修正语法错误，保持原意不变，直接输出优化结果不附加解释
  - [x] SubTask 2.3: 复用 `agent.run` IPC 通道（systemPrompt=优化提示词, messages=[{role:'user', content:原文}]），非流式等待完整结果
  - [x] SubTask 2.4: 新增 `isOptimizing` 状态和 `cancelOptimize` 方法，暴露给组件
  - [x] SubTask 2.5: 输入为空时返回空字符串并提示，优化失败时返回原文不中断

- [x] Task 3: 在 AgentDialogueModal 中添加"优化输入"按钮
  - [x] SubTask 3.1: 在输入框左侧（或发送按钮左侧）新增"优化输入"按钮，图标使用 `ThunderboltOutlined` 或 `MagicWandOutlined`，tooltip="优化输入内容"
  - [x] SubTask 3.2: 按钮三态：正常（默认色）、优化中（loading + 点击取消）、禁用（streaming 或输入为空）
  - [x] SubTask 3.3: 点击按钮调用 `optimizeInput(inputValue)`，结果回填 `setInputValue(optimizedText)`
  - [x] SubTask 3.4: 优化完成后显示 `message.success('已优化输入')` 提示
  - [x] SubTask 3.5: 优化过程中点击按钮调用 `cancelOptimize()` 取消

## 阶段三：系统智能体能力强化（M3）

- [x] Task 4: 构建系统智能体增强版 system prompt
  - [x] SubTask 4.1: 在 `useAgentDialogue.ts` 中修改 `buildSystemPrompt` 函数，当 `agent.isSystem === true` 时追加能力强化段落
  - [x] SubTask 4.2: 能力强化段落包含以下内容：
    - 角色定位：你是 Creative Cafe 的系统智能体，具备代码开发、问题解答、任务规划、世界书编写与审核等综合能力
    - 思考框架：面对复杂问题时，先理解用户意图，再分解任务步骤，逐步执行并汇总结果
    - 工具使用：你拥有工具调用能力，遇到需要数据支撑的场景应主动调用工具获取信息
    - 多步推理：对于多步骤任务，明确列出计划步骤，逐步执行，每步给出中间结论
    - 回答规范：回答结构化、逻辑清晰，复杂分析使用分点列表，代码使用代码块
  - [x] SubTask 4.3: 更新 `agentConfigService.ts` 中 system-agent 的 description 字段，使其与增强能力一致
  - [x] SubTask 4.4: 验证系统智能体在对话中体现多步推理和任务分解能力

## 阶段四：集成验证（M4）

- [x] Task 5: 端到端验证
  - [x] SubTask 5.1: 验证输入 `/` 时下拉列表展示全部命令（系统指令 + 内置命令）
  - [x] SubTask 5.2: 验证键盘上下键导航和回车选择正常
  - [x] SubTask 5.3: 验证"优化输入"按钮对文本的优化效果
  - [x] SubTask 5.4: 验证优化过程中可取消
  - [x] SubTask 5.5: 验证系统智能体对话体现多步推理能力
  - [x] SubTask 5.6: 验证普通多轮对话功能不受影响
  - [x] SubTask 5.7: 验证 TypeScript 编译无错误

# Task Dependencies

- Task 2（优化输入逻辑）depends on nothing（独立实现）
- Task 3（优化输入按钮 UI）depends on Task 2（需要 optimizeInput 方法）
- Task 1（命令提示扩展）无依赖，可与 Task 2-4 并行
- Task 4（system prompt 强化）无依赖，可与 Task 1-3 并行
- Task 5（端到端验证）depends on all previous tasks

## 并行化建议

- Task 1 + Task 2 + Task 4 可并行实现（三者修改不同逻辑，无冲突）
- Task 3 需等待 Task 2 完成后实现
