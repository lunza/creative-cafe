# Checklist

- [x] `handleManualOrganize` 使用与同步整理完全相同的 IPC 调用参数（`processChatProgressive` + `continueFromLast: true` + `minInterval: 3000` + `getActiveEngineConfig()` 引擎配置）
- [x] 手动整理与自动整理共用 `isOrganizingRef` 防并发守卫，不会同时执行
- [x] 按钮仅在 `enabled && !autoOrganize` 时显示（记忆表格启用且实时整理关闭）
- [x] 整理期间按钮显示 loading 并禁用，完成后恢复
- [x] 成功提示包含处理条数；无引擎/失败场景有明确错误提示
- [x] 按钮文案与 Tooltip 明确说明"手动触发表格整理"及"实时整理的手动替代方案"
- [x] 按钮位于记忆表格设置区域内显眼位置（实时整理开关行下方），样式符合现有 UI 风格（antd Button small + block）
- [x] props 传递链完整：hooks → CharacterDialogueChat.tsx → ConfigPanel.tsx → MemoryTablePanel.tsx
- [x] TypeScript 编译通过（`npx tsc --noEmit`，新增代码零错误；项目预存 784 个历史报错与本次改动无关）
- [x] 开发服务器已重启，变更已生效（vite 于 localhost:5174 重新构建完成）
- [x] `docs/user-manual.md` 已增量更新手动整理按钮说明
