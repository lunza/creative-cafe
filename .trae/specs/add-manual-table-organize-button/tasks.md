# Tasks

- [x] Task 1: 在 hooks 中实现手动整理回调与状态
  - [x] 1.1 在 `CharacterDialogueChat.hooks.ts` 新增 `manualOrganizing` state 与 `handleManualOrganize` 回调
  - [x] 1.2 回调内复用同步整理的调用方式（`getActiveEngineConfig()` + `processChatProgressive(chatId, '', config, { continueFromLast: true, minInterval: 3000 })`），使用 `isOrganizingRef` 防并发，成功/失败/无引擎时通过 antd message 反馈
  - [x] 1.3 在 hooks 返回值中导出 `manualOrganizing` 与 `handleManualOrganize`

- [x] Task 2: 打通 props 传递链
  - [x] 2.1 `CharacterDialogueChat.tsx` 从 hooks 解构并传入 `ConfigPanel`（`onMemoryTableManualOrganize`、`memoryTableManualOrganizing`）
  - [x] 2.2 `ConfigPanel.tsx` 扩展 props 接口并透传给 `MemoryTablePanel`

- [x] Task 3: 在 MemoryTablePanel 中实现按钮 UI
  - [x] 3.1 新增 props：`onManualOrganize: () => void`、`manualOrganizing: boolean`
  - [x] 3.2 在"是否实时整理表格"开关行之后、条件 `enabled && !autoOrganize` 时渲染按钮（符合现有 ConfigPanel 按钮风格，block 布局）
  - [x] 3.3 按钮 loading 态绑定 `manualOrganizing`，整理中禁用；附带说明文字与 Tooltip（手动触发表格整理 / 实时整理的手动替代方案）

- [x] Task 4: 验证与文档更新
  - [x] 4.1 运行 TypeScript 编译检查（`npx tsc --noEmit`）确保无类型错误（新增代码零错误，全部 784 个报错为预存历史遗留，与本次改动无关）
  - [x] 4.2 重启开发服务器使变更生效（vite 已于 localhost:5174 重新构建完成）
  - [x] 4.3 增量更新 `docs/user-manual.md` 记忆表格章节，补充手动整理按钮说明

# Task Dependencies
- Task 2 依赖 Task 1（需要 hooks 导出的回调与状态）
- Task 3 依赖 Task 2（需要 props 传递到位）
- Task 4 依赖 Task 1-3 全部完成
