# Tasks

- [x] Task 1: 修复 skill:list IPC handler 缓存问题
  - [ ] SubTask 1.1: 移除 `registerSkillHandlers()` 中的 `skillsLoaded` 永久缓存标志
  - [ ] SubTask 1.2: 每次调用 `skill:list` 时清空 SkillRegistry 并重新加载（内置 + 工作区技能）
  - [ ] SubTask 1.3: 接入 `loadWorkspaceSkills(getUserDataPath())` 加载工作区技能
  - [ ] SubTask 1.4: 验证 `npx tsc --noEmit` + `npx vite build` 通过

- [x] Task 2: 为 6 个缺失技能创建 SKILL.md 文件
  - [ ] SubTask 2.1: 创建 `builtin-skills/state-table-edit/SKILL.md`（状态表编辑技能，dialogue-agent 用）
  - [ ] SubTask 2.2: 创建 `builtin-skills/chat-history-search/SKILL.md`（聊天历史搜索技能，dialogue-agent 用）
  - [ ] SubTask 2.3: 创建 `builtin-skills/worldbook-search/SKILL.md`（世界书搜索技能，dialogue-agent 用）
  - [ ] SubTask 2.4: 创建 `builtin-skills/worldbook-generate/SKILL.md`（世界书条目生成技能，worldbook-agent 用）
  - [ ] SubTask 2.5: 创建 `builtin-skills/worldbook-keywords/SKILL.md`（世界书关键词提取技能，worldbook-agent 用）
  - [ ] SubTask 2.6: 创建 `builtin-skills/worldbook-sort/SKILL.md`（世界书条目整理技能，worldbook-agent 用）

- [x] Task 3: 实现技能导入/卸载的后端 IPC 通道
  - [ ] SubTask 3.1: 在 `skillLoader.ts` 中添加 `importSkillFromDir` 和 `importSkillFromUrl` 工具函数
  - [ ] SubTask 3.2: 注册 `skill:importFromDir` IPC 通道（复制目录到工作区 skills/ 并注册）
  - [ ] SubTask 3.3: 注册 `skill:importFromUrl` IPC 通道（下载 zip → 校验 → 解压 → 注册）
  - [ ] SubTask 3.4: 注册 `skill:uninstall` IPC 通道（删除工作区技能目录 + 注销注册）
  - [ ] SubTask 3.5: 注册 `skill:getDetail` IPC 通道（返回 SKILL.md 完整内容）
  - [ ] SubTask 3.6: 在 `preload.ts` 中添加 4 个新方法的桥接
  - [ ] SubTask 3.7: 在 `electron.d.ts` 中添加类型声明
  - [ ] SubTask 3.8: 验证 tsc + vite build 通过

- [x] Task 4: 开发技能广场前端组件
  - [ ] SubTask 4.1: 创建 `src/renderer/components/AgentCenter/SkillMarketplace.tsx` 组件骨架
  - [ ] SubTask 4.2: 实现已安装技能列表展示（表格：名称/描述/来源/状态/操作）
  - [ ] SubTask 4.3: 实现"从目录导入"功能（调用 dialog.chooseDir + skill.importFromDir）
  - [ ] SubTask 4.4: 实现"从 URL 导入"功能（输入 URL 弹窗 + skill.importFromUrl）
  - [ ] SubTask 4.5: 实现卸载功能（仅非内置技能可卸载，带确认弹窗）
  - [ ] SubTask 4.6: 实现技能详情查看（展开/弹窗显示 SKILL.md 内容）
  - [ ] SubTask 4.7: 在 `AgentCenter.tsx` 中添加"技能广场"Tab 页

- [x] Task 5: 技能广场 UI 打磨与集成测试
  - [ ] SubTask 5.1: 技能广场响应式布局适配
  - [ ] SubTask 5.2: 操作引导和帮助信息（Empty 状态提示、Tooltip 说明）
  - [ ] SubTask 5.3: 来源筛选器（全部/内置/工作区/导入）
  - [ ] SubTask 5.4: 端到端验证：刷新 → 导入 → 配置 → 卸载全流程

# Task Dependencies

- [Task 2] depends on [Task 1]（先修复加载机制再验证新技能可见）
- [Task 3] depends on [Task 1]（导入后需要重新加载机制生效）
- [Task 4] depends on [Task 3]（前端组件依赖后端 IPC 通道）
- [Task 5] depends on [Task 4] and [Task 3]
- [Task 1] and [Task 2] 可并行
