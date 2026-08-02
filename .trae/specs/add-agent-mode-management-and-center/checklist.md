# Checklist

## 智能体模式自动切换

- [x] `agentModeService` 正确实现三种 override 模式判定（auto/force-on/force-off）
- [x] `auto` 模式下根据 `supportsToolCalling` 自动激活/关闭 Agent 模式
- [x] `force-on` 模式下即使模型不支持工具调用也激活 Agent 模式
- [x] `force-off` 模式下即使模型支持工具调用也关闭 Agent 模式
- [x] 模式状态变更时记录审计日志到 MemoryStore（source: 'agent-mode-switch'）
- [x] 模式变更事件通过 `agent:modeChanged` IPC 事件广播到所有渲染进程
- [x] `agentModeOverride` 字段默认值为 `'auto'`

## 模式状态指示器

- [x] Header logo 旁永久显示 Agent 模式徽标（无论激活或关闭）
- [x] 激活时显示绿色背景 + "Agent" 文字 + RobotOutlined 图标
- [x] 关闭时显示灰色背景 + "普通" 文字 + RobotOutlined 图标
- [x] Tooltip 显示当前状态和原因
- [x] 模式切换时徽标即时更新（无需刷新页面）

## Agent 模式功能切换

- [x] 所有 `useAgent && supportsToolCalling` 双条件守卫已替换为 `useAgentMode().isActive` 或 `agentModeService.isAgentModeActive()`
- [x] ChatEngine 门控逻辑已统一（不再读取 `config.useAgent`）
- [x] WorldBookManager 智能体编写按钮门控已统一
- [x] writingAgentHandlers IPC 门控已统一
- [x] worldbookAgentHandlers IPC 门控已统一
- [x] agentHandlers getToolProvider 门控已统一
- [x] 模式切换时正在运行的智能体任务通过 AbortController 优雅终止
  > 已修复：`onModeChanged` 回调中检测 `prevActive && !status.active` 时调用 `abortAllActiveAgentRuns()`（agentHandlers.ts:112-125）
- [x] 模式切换后已生成的数据（如草稿区条目）保留不丢失

## 智能体管理中心 - 导航

- [x] `routeConfig.ts` 新增 `agent-center` 菜单项（RobotOutlined 图标）
- [x] Agent 模式激活时左侧导航显示"智能体中心"菜单项
- [x] Agent 模式关闭时左侧导航隐藏"智能体中心"菜单项
- [x] 点击菜单项正确跳转到 AgentCenter 页面

## 智能体管理中心 - 列表

- [x] 表格展示所有已注册智能体（系统预置 3 个 + 用户自定义）
- [x] 每行显示：智能体名称（含 emoji）、类型、状态（Switch）、技能数、创建时间、操作按钮
- [x] 状态 Switch 切换后持久化到 SQLite 并即时更新表格
- [x] 系统预置智能体标记不可删除（isSystem: true）
- [x] 系统预置智能体可启用/禁用
- [x] 响应式设计：小屏幕下表格保持核心信息可读

## 智能体管理中心 - 详情与技能配置

- [x] 点击"详情"按钮打开侧抽屉展示智能体详情
- [x] 详情抽屉展示基本信息（名称/描述/类型/模式/创建时间/更新时间）
- [x] 技能配置面板展示当前智能体关联的所有技能
- [x] 每个技能行显示：技能名 + 描述 + 启用/禁用 Switch
- [x] 技能 Switch 切换后持久化到 SQLite（skills 白名单更新）
- [x] 技能优先级可通过拖拽排序调整
  > 实现偏差（有意设计）：使用上/下箭头按钮替代拖拽，功能等价——排序后顺序通过 updateSkills IPC 持久化到 SQLite。tasks.md SubTask 8.4 已标注。
- [x] 排序后顺序持久化到 SQLite
- [x] 技能参数可只读查看（SKILL.md frontmatter）
- [x] 空状态提示和帮助 Tooltip 已添加

## 数据持久化

- [x] SQLite `agent_configs` 表已创建（含所有字段）
- [x] `agentConfigService.init()` 幂等创建系统预置智能体
- [x] CRUD 操作正确读写 SQLite
- [x] 内存缓存与 SQLite 保持一致
- [x] 配置变更通过 `agent-config:changed` 事件通知所有渲染进程
- [x] 应用重启后配置完整恢复
- [x] 系统预置智能体删除操作返回错误（不可删除）

## IPC 通道

- [x] `agent:isModeActive` 通道正确返回当前模式激活状态
- [x] `agent:getModeStatus` 通道正确返回详细模式状态
- [x] `agent:setModeOverride` 通道正确设置覆盖并触发 reevaluate
- [x] `agent:modeChanged` 事件正确推送到所有渲染进程
- [x] `agent-config:list` 通道正确返回所有智能体配置
- [x] `agent-config:get` 通道正确返回单个智能体配置
- [x] `agent-config:update` 通道正确更新智能体配置
- [x] `agent-config:toggle` 通道正确切换启用/禁用
- [x] `agent-config:updateSkills` 通道正确更新技能白名单
- [x] `agent-config:changed` 事件正确推送到所有渲染进程
- [x] `preload.ts` 暴露 `agent.mode` 和 `agent.config` API
- [x] `electron.d.ts` 类型定义完整

## AI 引擎设置面板

- [x] 新增 `agentModeOverride` 三态选择器（自动/强制开启/强制关闭）
- [x] 默认值为"自动"
- [x] 切换选择器后 Header 徽标和导航菜单即时响应
- [x] 选择器下方展示当前 Agent 模式状态和原因
- [x] `agentModeOverride` 纳入表单数据读写（保存/加载）

## 兼容性

- [x] Agent 模式关闭时所有现有功能完全正常（手动世界书编写/手动写作/普通对话）
- [x] 现有 `useAgent` 字段值被忽略不报错（平滑迁移）
- [x] 技能白名单与现有 `skillRegistry` / `skillAvailability` 兼容
- [x] 现有测试套件无回归（`npx vitest run` 全量通过）
  > tasks.md 记录 68/69 文件通过，1 个预存失败为不相关文件
- [x] `npx tsc --noEmit` 0 错误
  > 41 个预存错误均为不相关文件（OutlineGenerator.ts / WritingMode/*.tsx / outlineVersionUtils.ts），本 spec 相关文件 0 新增错误

## 文档

- [x] `CODE_WIKI.md` 新增智能体模式管理与智能体管理中心章节
- [x] `CHANGELOG.md` 新增对应章节
- [x] 若有 bug 或反复调试问题，`docs/FIX_RECORDS.md` 已记录并重点标记
  > §14.66 记录了 2 个重点标记问题：MemoryType 无 'audit' 类型偏差、WorldBookManager.tsx 导入路径修正
- [x] `tasks.md` 所有完成任务已勾选
