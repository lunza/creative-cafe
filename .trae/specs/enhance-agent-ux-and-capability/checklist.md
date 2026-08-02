# Checklist

## 阶段一：命令自动提示扩展（M1）

- [x] AgentDialogueModal 输入 `/` 时下拉列表展示全部已注册命令（系统指令 + 内置命令）
- [x] 列表包含系统指令（世界书/角色卡/编写/审核/帮助）和内置命令（help/reset/retry/continue/polish/model/clear）
- [x] 输入 `/re` 时过滤显示名称含 "re" 的命令（reset/retry）
- [x] 键盘 ArrowUp/ArrowDown 导航正常，高亮当前选中项
- [x] Enter 键选择高亮命令并填入输入框
- [x] Escape 键关闭下拉列表
- [x] 鼠标 hover 切换高亮项

## 阶段二：优化输入按钮（M2）

- [x] `useAgentDialogue.ts` 中存在 `optimizeInput(originalText: string): Promise<string>` 方法
- [x] 优化专用 system prompt 指定角色为"文本优化助手"，要求提升清晰度/补全指令/修正语法/保持原意/直接输出结果
- [x] `optimizeInput` 通过 `agent.run` IPC 调用 AI 引擎
- [x] `isOptimizing` 状态和 `cancelOptimize` 方法已暴露
- [x] 输入为空时返回空字符串并提示，不触发 AI 调用
- [x] 优化失败时返回原文不中断
- [x] AgentDialogueModal 输入框旁存在"优化输入"按钮
- [x] 按钮图标为 ThunderboltOutlined 或类似图标，tooltip="优化输入内容"
- [x] 按钮三态：正常 / 优化中(loading+可取消) / 禁用(streaming或输入为空)
- [x] 优化完成后结果回填输入框，显示 message.success('已优化输入')
- [x] 优化过程中点击按钮可取消

## 阶段三：系统智能体能力强化（M3）

- [x] `buildSystemPrompt` 函数中当 `agent.isSystem === true` 时追加能力强化段落
- [x] 能力强化段落包含角色定位（系统智能体综合能力）
- [x] 能力强化段落包含思考框架（理解意图 → 分解任务 → 逐步执行 → 汇总结果）
- [x] 能力强化段落包含工具使用指导（主动调用工具获取数据）
- [x] 能力强化段落包含多步推理指引（列出步骤、逐步执行、中间结论）
- [x] 能力强化段落包含回答规范（结构化、逻辑清晰、代码块）
- [x] `agentConfigService.ts` 中 system-agent 的 description 已更新

## 阶段四：集成验证（M4）

- [x] 输入 `/` 时下拉列表展示全部命令（系统指令 + 内置命令）
- [x] 键盘上下键导航和回车选择正常
- [x] "优化输入"按钮对文本有实际优化效果（清晰度/完整性/语法）
- [x] 优化过程中可取消
- [x] 系统智能体对话体现多步推理和任务分解能力
- [x] 普通多轮对话功能不受影响
- [x] TypeScript 编译无错误（GetDiagnostics 全部通过）

## 交叉验证

- [x] 命令提示扩展不影响 CharacterDialogueChat 的 ChatInputBar 功能
- [x] 优化输入按钮不影响现有发送/停止按钮功能
- [x] system prompt 强化不影响非系统智能体的对话行为
- [x] builtinCommands 和 systemCommands 注册不冲突（help 命令名冲突已处理）
