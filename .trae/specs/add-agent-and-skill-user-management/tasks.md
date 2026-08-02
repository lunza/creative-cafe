# Tasks

## 阶段 1：智能体 CRUD 后端补全（基础，无前端依赖）

- [x] Task 1: 新增智能体创建与删除 IPC 通道
  - [x] SubTask 1.1: 在 `src/shared/types/agent-center.types.ts` 新增 `AgentConfigCreateRequest` 和 `AgentConfigCreateResult`、`AgentConfigDeleteRequest` 和 `AgentConfigDeleteResult` 类型
  - [x] SubTask 1.2: 在 `src/main/ipc/handlers/agentHandlers.ts` 注册 `agent-config:create` IPC 通道——调用 `agentConfigService.create()`，强制 `isSystem: false`，成功后 `broadcastConfigChanged(id, 'created')`
  - [x] SubTask 1.3: 在 `src/main/ipc/handlers/agentHandlers.ts` 注册 `agent-config:delete` IPC 通道——调用 `agentConfigService.delete()`，成功后 `broadcastConfigChanged(id, 'deleted')`
  - [x] SubTask 1.4: 扩展 `broadcastConfigChanged` 函数的 action 联合类型，增加 `'created' | 'deleted'`
  - [x] SubTask 1.5: 在 `src/main/preload.ts` 的 `agent.config` 命名空间新增 `create` 和 `delete` 方法桥接
  - [x] SubTask 1.6: 在 `src/renderer/types/electron.d.ts` 的 `agent.config` 类型声明新增 `create` 和 `delete` 方法签名
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 2：技能 CRUD 后端补全（与阶段 1 可并行）

- [x] Task 2: 实现技能创建与编辑的后端函数和 IPC 通道
  - [x] SubTask 2.1: 在 `src/main/services/agent/skills/skillLoader.ts` 新增 `createSkill(params)` 函数——校验技能名格式、检查目录唯一性、组装 SKILL.md 内容（frontmatter + body）、写入 `<userDataPath>/skills/<name>/SKILL.md`
  - [x] SubTask 2.2: 在 `skillLoader.ts` 新增 `editSkill(params)` 函数——校验非内置技能、读取已有 SKILL.md、更新 description/emoji/body、写回文件
  - [x] SubTask 2.3: 在 `agentHandlers.ts` 注册 `skill:create` IPC 通道——调用 `createSkill()`，返回成功/失败
  - [x] SubTask 2.4: 在 `agentHandlers.ts` 注册 `skill:edit` IPC 通道——调用 `editSkill()`，返回成功/失败
  - [x] SubTask 2.5: 在 `preload.ts` 的 `skill` 命名空间新增 `create` 和 `edit` 方法桥接
  - [x] SubTask 2.6: 在 `electron.d.ts` 的 `skill` 类型声明新增 `create` 和 `edit` 方法签名
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 3：智能体前端 Hook 扩展（依赖阶段 1）

- [x] Task 3: 扩展 useAgentConfigs hook，新增创建和删除方法
  - [x] SubTask 3.1: 在 `src/renderer/components/AgentCenter/hooks/useAgentConfigs.ts` 新增 `createAgent(config)` 方法——调用 `agent.config.create()` IPC，成功后更新本地 configs 状态
  - [x] SubTask 3.2: 新增 `deleteAgent(id)` 方法——调用 `agent.config.delete()` IPC，成功后从本地 configs 中移除
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 4：智能体表单与列表 UI（依赖阶段 3）

- [x] Task 4: 实现 AgentFormModal 组件
  - [x] SubTask 4.1: 新增 `src/renderer/components/AgentCenter/AgentFormModal.tsx` 组件——antd Modal + Form，支持 create/edit 两种模式
  - [x] SubTask 4.2: 表单字段：name（Input，必填，1-50 字符）、description（TextArea，必填，1-200 字符）、type（Select，5 个选项）、mode（Select，4 个选项）、emoji（Input，可选，默认 🤖）
  - [x] SubTask 4.3: 编辑模式下 ID 只读展示（不作为表单字段，通过 agent prop 传入）
  - [x] SubTask 4.4: 表单验证——名称不与 existingNames 重复、必填字段校验、提交时 loading 状态
  - [x] SubTask 4.5: 提交成功后调用 message.success 提示并关闭模态窗口；失败显示 message.error

- [x] Task 5: 更新 AgentList 和 AgentCenter 组件
  - [x] SubTask 5.1: 在 `AgentList.tsx` 列表上方新增"创建智能体"按钮（PlusOutlined 图标，type="primary"）
  - [x] SubTask 5.2: 更新操作列——系统预置（`isSystem === true`）仅显示"详情"按钮；用户自定义显示"详情"+"编辑"+"删除"按钮
  - [x] SubTask 5.3: 删除操作使用 `Modal.confirm`，显示智能体名称，okType="danger"
  - [x] SubTask 5.4: 在 `AgentCenter.tsx` 新增 AgentFormModal 状态管理（open、mode、editingAgent），传递 onCreate/onUpdate/onDelete 回调
  - [x] SubTask 5.5: AgentList Props 新增 onCreate/onEdit/onDelete 回调，AgentCenter 传递对应方法
  - [x] 验证：`npx tsc --noEmit` 0 新增错误；界面按钮和模态窗口交互正常

## 阶段 5：技能表单与广场 UI（依赖阶段 2）

- [x] Task 6: 实现 SkillFormModal 组件
  - [x] SubTask 6.1: 新增 `src/renderer/components/AgentCenter/SkillFormModal.tsx` 组件——antd Modal + Form，支持 create/edit 两种模式
  - [x] SubTask 6.2: 表单字段：name（Input，必填，仅小写字母/数字/连字符，创建时可编辑、编辑时只读）、description（TextArea，必填，1-500 字符）、emoji（Input，可选）、body（TextArea，必填，1-10000 字符）
  - [x] SubTask 6.3: 创建模式下技能名唯一性校验（不与 existingNames 重复）
  - [x] SubTask 6.4: 提交成功后调用 message.success 提示并关闭模态窗口；失败显示 message.error

- [x] Task 7: 更新 SkillMarketplace 组件
  - [x] SubTask 7.1: 在工具栏新增"创建技能"按钮（PlusOutlined 图标，type="primary"）
  - [x] SubTask 7.2: 更新操作列——内置技能（`source === 'builtin'`）仅显示"详情"按钮；非内置显示"详情"+"编辑"+"删除"按钮
  - [x] SubTask 7.3: 原"卸载"按钮文案改为"删除"，保持 Modal.confirm 确认逻辑
  - [x] SubTask 7.4: 编辑操作——调用 `skill.getDetail()` 获取完整 SKILL.md 内容，填充到 SkillFormModal
  - [x] SubTask 7.5: 新增 SkillFormModal 状态管理（open、mode、editingSkill），传递 onCreate/onEdit 回调
  - [x] 验证：`npx tsc --noEmit` 0 新增错误；界面按钮和模态窗口交互正常

## 阶段 6：权限控制与交互完善（依赖阶段 4-5）

- [x] Task 8: 验证权限控制和交互一致性
  - [x] SubTask 8.1: 确认系统预置智能体行不显示"编辑"和"删除"按钮
  - [x] SubTask 8.2: 确认内置技能行不显示"编辑"和"删除"按钮
  - [x] SubTask 8.3: 确认删除操作均弹出确认对话框
  - [x] SubTask 8.4: 确认操作成功/失败后均有 message 提示
  - [x] SubTask 8.5: 确认按钮样式与现有界面一致（type="link" size="small"）

## 阶段 7：测试与验证

- [x] Task 9: 类型验证与回归测试
  - [x] SubTask 9.1: `npx tsc --noEmit` 0 新增错误
  - [x] SubTask 9.2: `npx vitest run` 现有测试无回归
  - [x] SubTask 9.3: 手动验证——创建/编辑/删除自定义智能体全流程
  - [x] SubTask 9.4: 手动验证——创建/编辑/删除工作区技能全流程
  - [x] SubTask 9.5: 手动验证——系统预置智能体和内置技能的保护机制

## 阶段 8：文档增量更新

- [x] Task 10: 文档增量更新（遵循项目规则）
  - [x] SubTask 10.1: `CODE_WIKI.md` 增量更新——新增智能体与技能用户管理章节
  - [x] SubTask 10.2: `CHANGELOG.md` 新增对应条目
  - [x] SubTask 10.3: 若开发中出现 bug 或反复调试问题，在 `docs/FIX_RECORDS.md` 追加修复记录并重点标记
  - [x] SubTask 10.4: `tasks.md` 各任务完成后勾选 checkbox

# Task Dependencies

- 阶段 1（Task 1）和阶段 2（Task 2）无相互依赖，可并行
- 阶段 3（Task 3）依赖阶段 1（Task 1）
- 阶段 4（Task 4-5）依赖阶段 3（Task 3）；Task 4 先行，Task 5 依赖 Task 4
- 阶段 5（Task 6-7）依赖阶段 2（Task 2）；Task 6 先行，Task 7 依赖 Task 6
- 阶段 6（Task 8）依赖阶段 4-5（Task 5 和 Task 7）
- 阶段 7（Task 9）依赖阶段 4-6
- 阶段 8（Task 10）最后执行
