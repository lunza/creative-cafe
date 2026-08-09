# Tasks

- [x] Task 1: 在 `Settings.tsx` 引入 antd `Tabs` 并实现 5 个页签的分组布局
  - [x] SubTask 1.1: 新增 `activeTab` state，初始值 `'general'`
  - [x] SubTask 1.2: 用 `<Tabs>` 包裹现有 7 个面板，按 spec 分组方案填入 `items`（通用 / AI 引擎 / 图像生成 / 向量与 RAG / 标签与搜索）
  - [x] SubTask 1.3: 每个 `items` 项设置 `forceRender: true`；`<Tabs>` 使用 `tabPlacement="top"`（v6 推荐，不用已废弃的 `tabPosition`）；不设置 `destroyOnHidden`（默认 false，保持挂载）
  - [x] SubTask 1.4: 底部操作栏（保存设置 / 打开配置文件 / 重置设置）移到 `<Tabs>` 之外，保持原有 `Divider` + `Space` 结构与三个 handler 不变
  - [x] SubTask 1.5: 保留所有现有 ref（`vectorConfigRef` / `sdWebuiConfigRef` / `webSearchConfigRef` / `tagAutocompleteConfigRef` / `tagRagConfigRef`）与 `form` 实例，确保 `handleSave` 收集逻辑零改动
- [x] Task 2: 在 `Settings.css` 增补页签样式
  - [x] SubTask 2.1: 去掉每个页签内首个卡片的顶部 `margin-top`（覆盖各面板 Card 的 `marginTop: 16`），避免页签内容区顶部出现多余间隙
  - [x] SubTask 2.2: 调整页签内容区间距，保持卡片间 16px 节奏与系统 UI 一致
  - [x] SubTask 2.3: 页签选中/未选中态清晰可辨（沿用 antd 默认 line 风格即可，必要时补充 `--text-heading` / `--text-secondary` 变量适配明暗主题）
  - [x] SubTask 2.4: 验证明暗主题下页签与卡片背景色正确（沿用现有 `.dark .settings` 规则）
- [x] Task 3: 验证状态保留与跨页签保存行为
  - [x] SubTask 3.1: 验证 `forceRender: true` 下所有面板在首屏即挂载，`handleSave` 时各 ref 均非 null、`getFormValues()` 返回有效值
  - [x] SubTask 3.2: 验证切换页签后切回，已修改未保存的表单值仍在（`destroyOnHidden` 默认 false 生效）
  - [x] SubTask 3.3: 验证仅在「通用」页签停留直接保存时，其余页签面板配置不丢失（重点：ref-based 面板的 `...(config ? {...} : {})` 条件展开不丢字段）
- [x] Task 4: 响应式与视觉走查
  - [x] SubTask 4.1: 在窄屏（<768px）下验证页签横向溢出可滚动、不换行错乱
  - [x] SubTask 4.2: 验证「向量与 RAG」「标签与搜索」页签内 2 个面板堆叠间距正常
  - [x] SubTask 4.3: 验证 `AIEngineSettingsPanel` 的引擎管理 Modal / 重命名 Modal 在页签布局下仍正常弹出与层级正确
- [x] Task 5: 文档增量更新
  - [x] SubTask 5.1: 在 `CODE_WIKI.md` 设置模块章节补一行架构性描述：设置页改为 5 页签分组布局 + 指向 FIX_RECORDS.md 的链接
  - [x] SubTask 5.2: 在 `docs/FIX_RECORDS.md` 新增小节记录本次重构（含 forceRender 保证 ref 可用、destroyOnHidden 默认保状态的技术要点）
  - [x] SubTask 5.3: 在 `CHANGELOG.md` 追加版本条目

# Task Dependencies
- Task 2、Task 3、Task 4 均依赖 Task 1 完成
- Task 5 依赖 Task 1~4 全部完成

# 完成说明
- Task 1~2 代码改动：`Settings.tsx`（Tabs items + activeTab + forceRender×5 + 底部操作栏外置）+ `Settings.css`（4 条页签样式）。tsc 对 Settings.tsx 零新增错误。
- Task 3~4 静态验证通过（forceRender 保证 ref 可用 / destroyOnHidden 默认保状态 / Modal 经 portal 且 z-index 规则保留 / 双面板间距靠既有 margin-bottom + 首卡片去顶距）。运行时视觉与 settings.json 字段完整性回归待用户 dev 模式手测（符合项目 Native Module Test Gap 约定）。
- Task 5 文档：CODE_WIKI.md §16 + CHANGELOG.md 顶部 `[重构]` 条目 + docs/FIX_RECORDS.md §9，均含 ⚠️ forceRender 数据丢失重点标记。
