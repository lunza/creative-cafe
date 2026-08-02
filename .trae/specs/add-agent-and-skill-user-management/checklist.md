# Checklist

## 智能体 CRUD 后端

- [x] `agent-config:create` IPC 通道已注册，调用 `agentConfigService.create()` 并强制 `isSystem: false`
- [x] `agent-config:delete` IPC 通道已注册，调用 `agentConfigService.delete()`（系统预置保护由后端保证）
- [x] `broadcastConfigChanged` 支持 `'created'` 和 `'deleted'` action
- [x] `preload.ts` 的 `agent.config` 新增 `create` 和 `delete` 方法
- [x] `electron.d.ts` 的 `agent.config` 类型声明新增 `create` 和 `delete` 方法签名
- [x] `src/shared/types/agent-center.types.ts` 新增 create/delete payload 类型

## 技能 CRUD 后端

- [x] `skillLoader.ts` 新增 `createSkill()` 函数——写入 `<userDataPath>/skills/<name>/SKILL.md`
- [x] `skillLoader.ts` 新增 `editSkill()` 函数——更新已有 SKILL.md（内置技能拒绝编辑）
- [x] `createSkill()` 校验技能名格式（仅小写字母/数字/连字符）和目录唯一性
- [x] SKILL.md 组装格式正确（frontmatter + body）
- [x] `skill:create` IPC 通道已注册
- [x] `skill:edit` IPC 通道已注册
- [x] `preload.ts` 的 `skill` 新增 `create` 和 `edit` 方法
- [x] `electron.d.ts` 的 `skill` 类型声明新增 `create` 和 `edit` 方法签名

## 智能体前端

- [x] `useAgentConfigs` hook 新增 `createAgent` 和 `deleteAgent` 方法
- [x] `AgentFormModal.tsx` 组件已创建，支持 create/edit 两种模式
- [x] 表单包含 name/description/type/mode/emoji 字段，均有验证规则
- [x] 编辑模式下 ID 不作为表单字段（通过 agent prop 传入）
- [x] 名称重名校验（与 existingNames 比对）
- [x] `AgentList.tsx` 列表上方新增"创建智能体"按钮
- [x] `AgentList.tsx` 操作列按权限渲染（系统预置仅"详情"，自定义有"详情"+"编辑"+"删除"）
- [x] 删除操作弹出 `Modal.confirm` 确认对话框
- [x] `AgentCenter.tsx` 管理 AgentFormModal 状态并传递回调

## 技能前端

- [x] `SkillFormModal.tsx` 组件已创建，支持 create/edit 两种模式
- [x] 表单包含 name/description/emoji/body 字段，均有验证规则
- [x] 编辑模式下技能名只读
- [x] 创建时技能名唯一性校验
- [x] 技能名格式校验（仅小写字母/数字/连字符）
- [x] `SkillMarketplace.tsx` 工具栏新增"创建技能"按钮
- [x] `SkillMarketplace.tsx` 操作列按权限渲染（内置仅"详情"，非内置有"详情"+"编辑"+"删除"）
- [x] 原"卸载"按钮文案改为"删除"
- [x] 编辑操作先调用 `skill.getDetail()` 获取完整数据填充表单

## 权限控制

- [x] 系统预置智能体（`isSystem === true`）不显示"编辑"和"删除"按钮
- [x] 用户自定义智能体（`isSystem === false`）显示完整按钮集
- [x] 内置技能（`source === 'builtin'`）不显示"编辑"和"删除"按钮
- [x] 非内置技能（`source !== 'builtin'`）显示完整按钮集

## 交互设计

- [x] 创建/编辑操作使用模态窗口（antd Modal + Form）
- [x] 删除操作前显示确认对话框（Modal.confirm）
- [x] 操作成功后显示 `message.success` 提示
- [x] 操作失败后显示 `message.error` 提示
- [x] 按钮样式与现有界面一致（操作列 `type="link" size="small"`，创建按钮 `type="primary"`）

## 数据验证

- [x] 智能体名称必填且不重复
- [x] 智能体描述必填
- [x] 智能体类型和模式必选
- [x] 技能名必填且格式正确（仅小写字母/数字/连字符）
- [x] 技能名创建时不重复
- [x] 技能描述和正文必填
- [x] 编辑时智能体 ID 和技能名均不可修改

## 界面一致性

- [x] 按钮样式、位置与现有界面保持一致
- [x] 模态窗口宽度统一（520px）
- [x] 不同屏幕尺寸下操作按钮可用

## 测试与验证

- [x] `npx tsc --noEmit` 0 新增错误
- [x] `npx vitest run` 现有测试无回归
- [x] 系统预置智能体的保护机制生效（无编辑/删除按钮）
- [x] 内置技能的保护机制生效（无编辑/删除按钮）
- [x] 用户自定义智能体的完整生命周期管理（创建→编辑→删除）
- [x] 工作区技能的完整生命周期管理（创建→编辑→删除）
- [x] 边界条件处理（空表单提交、超长输入、重复名称等）

## 文档

- [x] `CODE_WIKI.md` 新增智能体与技能用户管理章节
- [x] `CHANGELOG.md` 新增对应条目
- [x] 若有 bug 或反复调试问题，`docs/FIX_RECORDS.md` 已记录并重点标记
- [x] `tasks.md` 所有完成任务已勾选
