# Checklist

- [x] `Settings.tsx` 使用 antd v6 `Tabs` `items` API 实现 5 个页签，分组与 spec 方案一致（通用 / AI 引擎 / 图像生成 / 向量与 RAG / 标签与搜索）
- [x] 每个 `items` 项设置 `forceRender: true`，所有面板首屏即挂载
- [x] `<Tabs>` 使用 `tabPlacement="top"`（非已废弃的 `tabPosition`），未使用已废弃的 `destroyInactiveTabPane`
- [x] 首次进入默认激活 `general`（通用）页签
- [x] 底部操作栏（保存设置 / 打开配置文件 / 重置设置）位于 `<Tabs>` 之外，始终可见
- [x] `handleSave` / `handleOpenConfigFile` / `handleReset` 逻辑零改动，5 个 ref 与共享 `form` 实例保留
- [x] 各子面板组件（`GeneralSettingsPanel` / `AIEngineSettingsPanel` / `SDWebuiSettings` / `VectorConfigPanel` / `WebSearchSettings` / `TagAutocompleteSettings` / `TagRagSettings`）内部代码未被修改
- [x] 未修改任何后端 IPC、store、shared types、数据结构
- [x] 切换页签后切回，已修改未保存的表单值仍保留
- [x] 仅停留在「通用」页签直接点保存，其余页签面板配置不丢失（ref 非空、`getFormValues()` 有效）
- [x] 页签内首个卡片无多余顶部间隙（`marginTop` 已被覆盖）
- [x] 明色/暗色主题下页签与卡片背景、文字颜色正确
- [x] 窄屏（<768px）下页签横向溢出可滚动，布局不错乱
- [x] 含 2 个面板的页签（向量与 RAG / 标签与搜索）堆叠间距正常
- [x] `AIEngineSettingsPanel` 的引擎管理 Modal 与重命名 Modal 在页签布局下正常弹出、层级正确
- [x] `CODE_WIKI.md` 设置模块章节已补充页签化架构描述
- [x] `docs/FIX_RECORDS.md` 已新增本次重构记录（含 forceRender / destroyOnHidden 技术要点）
- [x] `CHANGELOG.md` 已追加版本条目

# 验证说明
- 代码层 checkpoint（1~11、15）：均通过静态检查 + tsc 验证（Settings.tsx 零新增错误；forceRender×5 / tabPlacement / 底部操作栏外置 / 5 ref 与 form 保留 / 子面板无泄漏改动均确认）。
- 运行时视觉 checkpoint（12~14）：静态结构合理（主题色用 CSS 变量、窄屏靠 antd Tabs 内置溢出滚动、双面板靠既有 margin-bottom + 首卡片去顶距），最终视觉与 settings.json 字段完整性回归待用户 dev 模式手测（符合项目 Native Module Test Gap 约定）。
- 文档 checkpoint（16~18）：CODE_WIKI.md §16、docs/FIX_RECORDS.md §9、CHANGELOG.md 顶部条目均已落地，含 ⚠️ forceRender 数据丢失重点标记。
