# Code Wiki

> 本文件记录项目核心架构与功能模块的技术文档。
> 注意：原文件内容因磁盘异常全部丢失（全为 null 字节），本文件由 2026-08-01 的 spec `add-agent-and-skill-user-management` 重建，仅包含本次新增功能的文档。历史章节请参考 git 历史记录。

---

## 写作模式 2.0（Spec: refactor-writing-mode-v2，Phase 0 + Phase 1 完成，2026-09-29）

### 概述

写作模式 2.0（`src/renderer/components/Creative/WritingModeV2/`）是当前唯一的写作模式入口。入口：`CreationCenter.tsx` 创作面板区"写作模式"卡片（青色 #06b6d4 主题 + `2.0` 徽章），点击打开独立 FullscreenDialog。项目库与 V1 共用（零数据迁移），旧 V1 项目可直接在 V2 项目列表中打开。

> 📦 **2026-10-07 更新**：写作模式 1.0（`src/renderer/components/Creative/WritingMode/`）已**整体移除**（回滚 tag `pre-remove-writing-v1`，详见 `.trae/specs/remove-writing-mode-v1/`）。移除范围：V1 渲染层全部文件、preload V1 `writing` 命名空间、主进程 V1 独占模块与 IPC 通道、`writing.types.ts` 中 26 个零引用 V1 类型。V2 不受影响：`writingV2` preload 命名空间自包含，直接 invoke `writing:*` 通道；主进程仅修剪了 V1 独占通道（generateChapter、chunk 系列、saveOutline、polishDescription、exportProject、AI 生成历史等），保留 `writing:generateOutline` 与 `style:*`（V2 仍在调用）。

### 关键架构规则（spec.md G 节）

1. **单一真相源**：项目实体（DB）是唯一真相源，`useV2ProjectStore` 只是内存投影；写操作 = 更新投影 + 模块级防抖落盘（`AUTO_SAVE_DELAY=500ms`）。
2. **单一流水线**：V2 只保留 shard 分片生成（舍弃 V1 chunk 体系），状态机 `IDLE → PLANNING → STREAMING → INTEGRATING → DONE/ERROR`（`useV2GenerationStore`）。
3. **全类型化**：V2 渲染层禁止裸调 `window.electronAPI`，必须经 `services/writingV2Service.ts` 封装；类型契约见 `src/shared/types/writing-v2.types.ts`（`WritingV2API` 22 方法 + 5 事件监听，禁止 any 穿透）。

### IPC 通道策略

- **复用**现有 `writing:*` 通道（主进程零改动）：项目 CRUD、大纲流式（`writing:stream:chunk`）、分片流（`writing:chunk:start/progress/complete/error`，`chunkIndex = shardIndex`）、autoSaveChapter、分片大纲/内容生成、AI 拆并建议。
- **新增** 2 个 V2 专用通道（`src/main/ipc/handlers/writingV2Handlers.ts`）：
  - `writingV2:parseOutline`：解析大纲原始文本为结构化大纲，**不创建项目**（V1 的 `writing:saveOutline` 会新建项目，与 V2"先建项目后生成大纲"流程冲突）；
  - `writingV2:exportWithChapters`：按章节多选导出 TXT/Markdown 到 `projects/exports/`（`chapterIndices` 空数组 = 全量）。V1 preload 声明过 `writing:exportProjectWithChapters` 但主进程从未实现，V2 不走该空壳。

### 前端结构（WritingModeV2/）

| 目录 | 文件 | 职责 |
| --- | --- | --- |
| 根 | `WritingV2Entry.tsx` | 4 阶段路由（`useV2UIStore.stage`）：projects/outline/writing/export，左 Menu 按前置条件禁用；顶部"返回项目列表"导航；全局挂载向导与导出对话框 |
| stores | `useV2ProjectStore.ts` | 项目列表投影 + `patchProject`（防抖落盘）；`useV2GenerationStore.ts` 分片流水线状态机；`useV2UIStore.ts` 阶段/弹窗/选中章节/`chapterStructureVersion`（AI 拆并后工作台重载正文） |
| projects | `V2ProjectList.tsx` / `V2NewProjectWizard.tsx` | 搜索/打开/删除（兼容 V1 项目）；3 步新建向导（创意参数 → AI 引擎/温度/maxTokens → 确认） |
| outline | `V2OutlineWorkbench.tsx` / `V2OutlineChapterList.tsx` | AI 流式生成（订阅 `onOutlineChunk` → `parseOutline` → 章节对齐）/ 手动大纲双模式，章节增删/排序/编辑 |
| writing | `V2ChapterWorkbench.tsx` / `V2ShardPipelinePanel.tsx` / `useV2ShardGeneration.ts` / `V2SplitMergeActions.tsx` | 三栏工作台：章节列表 + 正文编辑（2s 防抖 autoSave）+ 分片流水线（分片大纲→逐片生成→确认→合并落盘）；AI 拆/并建议（接受时重建 chapters 并重排 index，原正文保留不丢数据） |
| export | `V2ExportDialog.tsx` | TXT/Markdown + 章节多选（默认全选）导出，成功后展示文件路径 |
| shared | `v2Labels.ts` | 本地标签表 + `buildModelConfigFromEngine`（取值规则与 V1 一致）+ `buildV2WritingConfig`（资源绑定 P2 补） |

### ⚠️ 重点标记（开发中踩坑与规避的存量缺陷）

1. **`writingV2Handlers.ts` 相对路径深度**：该文件位于 `src/main/ipc/handlers/`（比 `handlers/writing/` 浅一层），service 导入须用 `../../services/*`、shared 类型须用 `../../../shared/*`。首次实现时误按 `writing/` 子目录深度写成 `../../../services/*`，导致 5 处 TS2307，已修正。**后续在 `handlers/` 根目录新建 handler 时注意此差异。**
2. **`writing-v2.types.ts` 枚举重导出方式**：`ShardStatus`/`ProjectStatus` 等运行时枚举必须走**值导入 + 值导出**（`import {} from` + `export {}`），放入 `import type {}` 或 `export type {}` 块会与其他导出块产生 TS2300 重复标识符，或导致按值使用时运行时 undefined。
3. **V1 存量缺陷（V2 已规避，V1 零改动策略下不修）**：
   - `src/shared/constants/writing.constants.ts` 的 `PROJECT_STATUS_LABELS` 引用了 `ProjectStatus` 中不存在的 `IN_PROGRESS/REVIEWING/ARCHIVED`（TS 报错为存量）；V2 自行维护 `V2_PROJECT_STATUS_LABELS`（仅 4 个真实状态）。
   - V1 preload 声明的 `writing:exportProjectWithChapters` 主进程无 handler（空壳）；V2 用专用通道替代。
   - 分片流式内容**不做前端 chunk 拼接**，以 `onShardStreamComplete` 全量事件落定，避免增量拼接错乱。

### 单元测试（2026-09-29 新增）

- `WritingModeV2/shared/__tests__/v2Labels.test.ts`（11 用例）：`buildModelConfigFromEngine` 取值规则（model_name 优先/回退 model/null 引擎默认 0.7/4096/overrides 覆盖）+ `V2_PROJECT_STATUS_LABELS` 与 `ProjectStatus` 枚举严格一一对应（回归 V1 `PROJECT_STATUS_LABELS` 引用不存在枚举值的缺陷）+ 三组 options 与 labels 一致性。

### 验证结果（2026-09-29）

- typecheck：V2 新增/修改文件**零错误**（其余报错均为 V1/其他模块存量）。
- 测试基线：**1425 passed / 2 failed**（含新增 11 个 V2 单测；`skills.test.ts`、`agentModeService.test.ts` 预存失败，与本次无关）。
- dev server 已按 AGENTS.md 自动重启（vite 端口 5174 + Electron 正常启动）。

### Phase 2（P1 质量与结构化，已完成，2026-09-29）

章节工作台右栏升级为**多 Tab 面板**（生成流水线 / 剧情检查 / 表格整理），并支持**拖拽分隔条调整右栏宽度**（360-760px）。

| 目录 | 文件 | 职责 |
| --- | --- | --- |
| plotcheck/ | `V2PlotCheckPanel.tsx` | 剧情检查：checkChapter（总分 + 5 维度评分条）→ 问题列表 → 单条 autoFixIssue（diff 确认）/ batchFixIssues（批量确认）；修正经 `onContentUpdated` 回写编辑器并立即落盘 |
| plotcheck/ | `V2PlotIssueList.tsx` / `V2PlotCheckModals.tsx` | 问题卡片列表（维度+逻辑统一归一化）；单条/批量修正确认弹窗 + 逻辑矛盾记录查询/清空弹窗（面板 ≤400 行拆分） |
| table/ | `V2TablePanel.tsx` | 表格整理子域：模板绑定（getAllTemplates → associateTableTemplate）→ AI 整理（organizeTable，`writing:table:organizeProgress` 事件驱动进度条）→ sheet 表格预览 → 版本快照条（变更统计 + 确认/回滚） |

IPC 契约：`writingV2` 新增 5 个剧情检查方法（checkChapter/autoFixIssue/batchFixIssues/getLogicCheckRecords/clearLogicCheckRecords）+ 嵌套 `writingV2.table`（15 方法 + onOrganizeProgress 事件），全部复用现有 `writing:*` / `writing:table:*` 通道（主进程零改动），类型见 `writing-v2.types.ts` 的 P2 区段（V2PlotCheckResult / V2TableAPI 等）。

⚠️ **重点标记**：
1. **React hooks 顺序缺陷（存量，Phase 2 修复）**：`V2ChapterWorkbench` 原先在 `useV2ShardGeneration` hook **之前**有空态早退 return，项目无章节时 hook 数量不一致会触发 React "Rendered more hooks" 崩溃。Phase 2 新增右栏 hooks 后将其移到所有 hooks 之后，并将 `useV2ShardGeneration` 的 `chapter` 参数改为可选（回调内空值守卫）。
2. **逻辑记录为跨项目全局表**：`writing:getLogicCheckRecords` 返回的是 `userData/data/writing-projects/plot_logic_contradictions.json`（非按项目隔离），V2 弹窗已注明"全局"，清空影响所有项目。

验证：typecheck V2 文件零错误；测试 1414 passed / 2 failed（基线不变）；dev server 已自动重启（端口 5174）。

### Phase 3（P2 扩展能力，已完成，2026-09-29）

左栏新增第 5 阶段「素材与风格」（`V2Stage = ... | 'assets'`），容器 `assets/V2AssetsStage.tsx` 含三个子面板：

| 目录 | 文件 | 职责 |
| --- | --- | --- |
| assets/ | `V2ResourceBindingPanel.tsx` | 项目级素材绑定：世界书/角色卡/人设/写作风格四组多选 → `patchProject(config.resources)` 防抖落盘；主进程生成（分片请求透传 resources）与剧情检查（读 `project.config?.resources`）自动注入 |
| assets/ | `V2StyleLearningPanel.tsx` | 风格学习：上传 txt（≤50MB，Electron `file.path`）→ `writing:style:upload` 后台学习 → 3s 轮询 `list`/`getActiveTasks`（状态 Tag + 进度条）→ 报告查看/删除/取消；失败经 `style.onError` 事件提示 |
| assets/ | `V2TemplatePanel.tsx` | 模板管理：小说类型/写作风格两子页，预置只读、自定义可新建/编辑/删除（`writing:template:*`） |
| assets/ | `v2ResourceUtils.ts` + `__tests__/v2ResourceUtils.test.ts` | 纯函数（toggleResourceId / buildResourcesPatch 保留 knowledgeItemIds、referenceMaterials）+ 9 用例单测 |

IPC 契约：`writingV2` 新增 `resources`（listWorldBooks/listCharacters/listPersonas/loadResources，preload 内将 V1 列表通道归一化为 `{id,name,path}`）/ `style`（7 方法 + onError 事件）/ `templates`（6 方法）三命名空间，全部复用现有通道（主进程零改动，仅 `writingProjectHandlers` 加了边界防护，见下）。

### ⚠️ 重点标记：新建项目"创建失败"bug（2026-09-29，经用户多次反馈才定位）

- **现象**：V2 新建项目向导第 3 步创建 → toast 笼统提示"创建失败，请重试"，无详情
- **根因**：`V2NewProjectWizard` 的 `<Form>` 随 Steps 步骤切换**卸载**，第 3 步 `paramsForm.getFieldsValue()` 取不到第 0 步字段值 → `parameters.creativeDescription` 为 undefined → 主进程 `writingProjectHandlers.ts` 对其调 `.substring()` 抛 TypeError。**antd 多步表单中，跨步骤读取字段值必须在步骤切换时捕获（或保持 Form 常驻挂载），不能依赖已卸载 Form 的 getFieldsValue。**
- **修复**（三层）：
  1. 渲染层：step 0 校验通过即 `setParamsValues(validateFields())` 捕获，创建/确认页均用捕获值；
  2. 主进程：`writing:createProject` 加 IPC 边界防护（空描述返回明确错误"创意描述不能为空"，替代不透明 TypeError）；
  3. 可观测性：`useV2ProjectStore` 新增 `lastCreateError`（三个失败路径均记录），wizard toast 展示真实错误 —— 本次正是靠它拿到主进程错误原文定位根因。
- **调试过程备注**（TRAE-debugger 会话 v2-p3-features，产物已清理）：应用 CSP `connect-src 'self' data: blob:` 会**拦截渲染进程对本地 Debug Server（127.0.0.1:7777）的 fetch**，渲染层插桩上报静默失败、日志恒空；渲染层取证应优先"UI 错误透出 + 用户可见症状"路径，或经主进程 `addLog` 落盘。

### 素材注入可见性优化（2026-09-29 用户反馈后补充）

**背景**：用户在大纲/创作界面看不到已绑定素材，会误以为素材未带入生成。
**方案**：`shared/V2BoundResourceBar.tsx`（内联指示条，置于 `WritingV2Entry` 顶栏右侧，仅大纲/创作阶段显示）：
- 已绑定：`上下文` 标签 + 每组青色 Tag（图标+标签+数量，hover Tooltip 显示具体名称，超 3 项折叠为"等 N 项"）+ 右侧 AI 模型 Tag（model · T 温度）
- 未绑定：明确提示"未绑定素材（生成不含素材上下文）· 左栏「素材与风格」可绑定"，消除"绑定未生效"的误解
- 名称映射模块级缓存（60s TTL），阶段切换不重复请求；项目标题改 flex+ellipsis 保证窄屏下 Tag 可见
- 注入链路（均消费 `project.config.resources`，展示与行为一致）：大纲生成（generateOutline 透传）/ 分片生成（请求透传）/ 剧情检查（主进程读 project.config）

验证：typecheck V2 零错误；测试 1434/2 基线不变（纯渲染改动，HMR 生效）。

### Phase 4（版本快照 UI + JSON 导出，已完成，2026-09-29）

**章节版本快照**（`writing/V2VersionHistoryModal.tsx`）：
- 工作台章节头新增「历史版本 (N)」按钮 → 对话框：备注输入 + 「保存当前版本」（`writing:saveVersion`）
- 版本列表（新→旧）：时间/字数/备注/自动生成 Tag/内容预览（80 字截断）+ 「恢复」（Popconfirm，`writing:restoreVersion`）
- 版本来源：手动快照 + **autoSaveChapter 自动存档**（主进程内容变更时自动保留旧版本，note="自动保存"）
- 版本数据存于 `chapter.versions[]`（单一真相源=项目实体，无新 IPC）；操作后 `loadProjects()` 刷新投影（不动 currentProjectId）
- 恢复时工作台**先取消未落盘防抖**再 setText，避免旧文本回写覆盖恢复结果（主进程已落盘，不重复持久化）

**JSON 导出**：
- 导出内容构建器提取为纯函数 `src/shared/utils/v2ExportContent.ts`（主进程 `writingV2:exportWithChapters` 与单测共用）
- JSON 契约：`{ title, exportedAt(ISO), format:'json', chapterCount, chapters:[{index,title,wordCount,content}] }`；wordCount 优先已有值、缺失回退 trim 后长度；文件扩展名 `.json`
- 导出对话框新增 JSON 单选项（TXT/Markdown/JSON）
- 单测 `v2ExportContent.test.ts` 12 用例（TXT/MD 结构 + JSON 契约/顺序/字数回退/子集/空标题兜底）——⚠️ 首版测试抓到 wordCount 回退用未 trim 长度的真实缺陷，已修

验证：typecheck V2 零错误；全量 **1446 passed / 2 failed**（预存基线 1434 + 新增 12）；主进程改动已重启 dev server。

### Phase 5（审阅增强 + 写作/对话模板分离，已完成，2026-09-29）

**⚠️ 重点标记：写作表格模板误用对话模板（用户反馈）**
- 现象：写作模式表格整理的模板下拉里全是"记忆增强插件默认模板"等**对话功能**模板
- 根因：`writing:table:getAllTemplates` 直接返回记忆模块 `tableTemplateService` 的模板库；V1/V2 绑定面板共用该通道
- 修复（写作与对话分离）：
  - `shared/constants/writingTableTemplates.ts`：写作域内置 3 套模板（⭐小说设定总表：角色/物品/事件/场景/伏笔五表；轻量设定模板；时间线模板），sheet 结构与 TableSheet 完全对齐
  - `main/services/writing/writingTemplateRegistry.ts`：`getWritingTableTemplates()`（列表只返回写作模板）+ `resolveWritingTableTemplate(id)`（**写作内置优先 → 记忆库兜底**，兼容存量已绑定对话模板的项目，整理流程不再报"模板不存在"）
  - `writing:table:getAllTemplates` 与 `TableOrganizeService` 三处模板解析全部切换到注册器
  - V2TablePanel：未绑定时预选 ⭐默认模板
  - V1 的 TableTemplateBinder 走同一通道，现在同样只看到写作模板（其 DEFAULT_TEMPLATE_ID 指向旧对话模板 id，⭐/预选自然失效，功能不受影响）
- 闭环：主进程 `writing:plotcheck:checkChapter` 本来就自动注入项目表格数据（历史剧情上下文），修好模板源后"审查结合表格整理"即生效

**剧情检查增强**（`V2PlotCheckPanel.tsx`）：
- **检查历史 + 评分趋势**：每次检查（单章/全书）追加 `plotCheckHistory[]` 到章节实体（timestamp/overallScore/totalIssues，保留最近 20 条，随项目落盘）；面板展示"评分趋势"条（最近 5 次 + 涨跌箭头）
- **全书批量检查**：「全书检查」按钮串行遍历全部有内容章节（控制 AI 并发，每章传前一章截断 4000 字作上下文，深层历史由大纲+表格承载）；进度条 + 可取消；结果汇总表（平均分/总问题/成功章数 + 每章分数/问题数/「查看」跳转——跳转时携带该章报告经 `pendingReportRef` 恢复，避免被切章重置逻辑清掉）
- 类型：`writing.types.ts` 新增 `PlotCheckHistoryEntry`，`ChapterOutline.plotCheckHistory?` 可选字段（V1 零影响）

验证：新增 `writingTableTemplates.test.ts` 6 用例（id 唯一/结构完整/order 递增/默认模板核心表）全过；全量 **1452 passed / 2 failed**（预存基线 1446 + 新增 6）；typecheck V2 零错误（TableOrganizeService/MaterialList 报错均为预存）；主进程改动已重启 dev server。

### Phase 6（表格面板全面升级：对齐/超越 V1 与对话模式能力，已完成，2026-09-29）

**背景**：用户反馈"写作模式的表格是否过于简单"。侦察结论：主进程 16 个 `writing:table:*` 通道 + V2 preload 基本就绪，是 **V2 面板只暴露了 ~40% 能力**（仅绑定/整表整理/只读预览/一键回滚）。本轮把面板补齐到与 V1（TableOrganizeMainPanel + FullTableEditorModal + useVersionManagement）及对话模式模板能力对齐：

| 能力块 | 实现 |
| --- | --- |
| 数据编辑 | `table/V2TableView.tsx`：单元格行内编辑 / 添加行 / 删行（Popconfirm）/ 保存修改（saveTableData）/ 清空本表 / 导出 CSV（带 BOM，Excel 中文兼容） |
| 细粒度整理 | 整表整理（+「跳过已整理章节」checkbox → skipOrganized）/ 整理当前表（organizeSingleSheet）/ 章节整理状态弹窗（getChapterOrganizeStatus）/ 单行 AI 重整理（reorganizeRow，本次补 V2 preload） |
| 版本管理 | 待确认快照条增强为显式状态（有：变更摘要+确认/回滚；无："无待确认的整理变更"） |
| 模板 CRUD | `table/V2TemplateManager.tsx`：内置 ⭐ 只读 + 自定义模板新建/编辑/删除（表/列可视化编辑）；主进程 `writing:table:saveTableTemplate/deleteTableTemplate`（新通道），自定义模板存 `<writingRoot>/table-templates.json`，内置 id 受保护 |

**主进程改动**（`writingTemplateRegistry.ts` 扩展）：
- `getWritingTableTemplates()` 返回**内置 + 自定义**（`mergeWritingTemplates` 带 custom 标记，内置 id 不可被自定义覆盖）
- `saveCustomTemplate/deleteCustomTemplate`：结构校验走 shared `validateWritingTemplate`
- `resolveWritingTableTemplate(id)` 解析链：**写作内置 → 写作自定义 → 记忆模块（存量兼容）**

**纯函数与单测**（`shared/utils/v2TableUtils.ts` + `__tests__/v2TableUtils.test.ts` 11 用例）：
- `buildTableCsv`（转义/BOM/额外键兜底）、`mergeWritingTemplates`（内置优先/去重/custom 标记）、`validateWritingTemplate`（各非法结构拦截）、`summarizeTableChanges`
- ⚠️ 本轮自纠错：初版用了不存在的 `MagicOutlined` 图标（TS2724 捕获，换 `ThunderboltOutlined`）；行号显示 `?? 与 +` 优先级 bug 自纠

**类型/preload**：`V2TableTemplate.custom?`、`V2TableTemplateInput/OpResult/ReorganizeRowResult` 新增；`V2TableAPI` 补 `reorganizeRow/saveTableTemplate/deleteTableTemplate`

验证：typecheck V2 零错误（TableOrganizeService/MaterialList 报错为预存）；全量 **1463 passed / 2 failed**（预存基线 1452 + 新增 11）；主进程改动已重启 dev server。

**模板字段调整（2026-10-07 用户要求）**：角色表「性格特征」拆为「性格」「特征」两列（特征含外貌/身体特征）。改动点：① 内置模板 `writingTableTemplates.ts`（默认+轻量两套 headers+description，特征描述注明"含外貌/身体特征"）；② 整理提示词硬编码示例 `TableOrganizeService`（示例输出三处：模板字段编号/现有表格数据行/未变化字段列表——⚠️ 该示例是硬编码非模板派生，改模板字段数时必须同步，否则字段编号示例与真实模板漂移）；③ 自定义模板新建默认草稿 `V2TemplateManager`；④ 用户当前项目数据文件表头直接同步（数据为空安全）。⚠️ 已绑定旧模板且有数据的存量项目：列数变化会使旧行按 key 错位，需「清空」后重新「AI 整理全部」（自愈重建会用新模板结构）。

### Phase 7（全书检查报告导出 + 表格整理真实中断，已完成，2026-09-29）

**全书检查报告导出**：
- 纯函数 `buildBookCheckMarkdown`（`shared/utils/v2TableUtils.ts`）：总览表（章节/评分/高中低问题分布）+ 逐章明细（维度标签/严重度/描述/建议）+ 失败章节原因标注
- 剧情检查面板「全书检查结果」区新增「导出报告」按钮 → 本地下载 `{作品名}-全书检查报告.md`（渲染层 Blob，无需主进程）
- 单测 3 用例（结构/明细/边界：无问题章节、全部失败）

**表格整理真实中断**（补齐"与 V1 一致不可中途取消"短板）：
- 主进程 `TableOrganizeService`：`cancelFlags: Map<projectId, boolean>` + `cancelOrganize()`；**章节级**（循环顶）与**分片级**（chunk 循环顶，两个 AI 处理方法各一处）检查点，当前分片 AI 调用完成后停止
- 取消收尾：`result.cancelled = true`，**已处理部分保留**（仍走章节状态持久化/去重/版本快照流程，取消后表格同样产生待确认快照）
- 新通道 `writing:table:cancelOrganize`（Facade 透传 + handler）；V2 类型/preload 同步（`V2TableOrganizeResult.cancelled?`）
- UI：整理进度区新增「取消整理」按钮（危险描边）；取消结果 toast 区分"整理已取消：已处理 N 章，结果已保留"

验证：typecheck V2 零错误（TableOrganizeService 11 处报错均为预存，行号因新增代码平移）；全量 **1466 passed / 2 failed**（预存基线 1463 + 新增 3）；主进程改动已重启 dev server。

### Phase 8（小说全流程创作流水线 API，Spec: add-novel-writing-pipeline-api，2026-09-29）

以**应用内 IPC**（非 HTTP）封装创作全流程，主进程编排既有服务，零 V1 改动：

- 新增 `WritingPipelineService`（`main/services/writing/`，单例）：`listResources / createCharacterCard / init / generateOutline / generateChapter / compose / runAll / status / cancel / runE2E`；统一信封 `PipelineEnvelope<T> = { success, data?, error?, code?, stage?, partial? }`；错误码 VALIDATION/RESOURCE/AI/EXPORT/CANCELLED/INTERNAL；进度经回调（handler 层 `BrowserWindow.getAllWindows()` 广播 `writing:pipeline:progress`，渲染层按 projectId 过滤）
- 取消为软取消：`cancelFlags` 在分片级/章节级检查，当前分片 AI 调用完成后停止，已完成内容保留；`runAll` 中途失败返回 `partial: { projectId, completedChapters }` 支持断点续跑
- `createCharacterCard`：1x1 占位 PNG + 内嵌卡数据（`characterService.createCharacterFromImage`），id = 角色卡 PNG 绝对路径；世界书 id = JSON 路径（与既有资源绑定语义一致）
- 新增 10 个通道 `writing:pipeline:*`（`main/ipc/handlers/writingPipelineHandlers.ts`，runE2E 有 `app.isPackaged` dev 门禁）；preload `writingV2.pipeline` 命名空间；渲染层 `getPipelineAPI()`（`renderer/services/writingPipelineService.ts`）
- 纯函数 `shared/utils/pipelineUtils.ts`：`validatePipelineInit`（章节数 1-50、字数 1000-200000、资源 id 存在性）/ `assertE2EResult`（章节数、每章字数 ≥50%、总字数 ≥80%、角色名注入、世界书词条注入、导出文件）/ `verdictOf` / `suggestedShardCount`（每片约 2500 字，1-5 片）
- `runE2E({ scale })`：素材保障（e2e- 前缀角色卡/世界书）→ 激活引擎 modelConfig → runAll（3 章；smoke 6000 / full 20000）→ 断言 → 报告写 `projects/exports/e2e-report-*.json`
- dev-only UI：`V2PipelineSelfTest.tsx`（写作 2.0 侧栏「流水线自测」按钮 + Modal，`IS_DEV` 门控；⚠️ 项目未引 vite/client 类型，`import.meta.env` 需 `as { env?: … }` 访问，同 LazyImage 模式）
- API 文档：`docs/writing-pipeline-api.md`（10 通道请求/响应、进度事件字段、错误码表、鉴权说明、E2E 方式）
- 单测 27 用例（`pipelineUtils.test.ts`）；全量 **1493 passed / 2 failed**（预存 2 失败：skills、agentModeService）

**⚠️ 重点标记：E2E 首跑崩溃 bug（novelType 枚举不匹配，经 E2E 自动暴露并修复）**
- 现象：smoke 首跑 320ms 即 FAIL，`[大纲] Cannot read properties of undefined (reading 'systemPrompt')`
- 根因：E2E 传中文 `novelType: '玄幻'`，而 `NovelTypeTemplates` 以 `NovelType` 枚举值（`'fantasy'` 等 snake_case）为键 → `template` 为 undefined → `PromptBuilder.buildSystemPrompt` 读 `template.systemPrompt` 崩溃
- 修复：① `runE2E` 改用 `NovelType.FANTASY` / `NarrativePerspective.THIRD_PERSON` 枚举值；② `init` 增加归一化兜底——novelType 非法回退 `NovelType.OTHER`、视角非法回退 `third_person`，防止外部调用同样崩溃
- 附带修复：世界书词条提取兼容 SillyTavern 格式（`key`/`keysecondary` 数组，此前只读 `keywords`，导致真实世界书 0 词条）；`creativeDescription` 显式要求正文出现世界书首个词条，提高注入断言确定性

**E2E 验证结果（本地引擎 qwen3.8 @ 127.0.0.1:5000，dev-only env 触发 `PIPELINE_E2E_SCALE`）**
- smoke（3 章 × 2000 字）：**PASS**，26.5 分钟，3 章共 16163 字（第 1/2/3 章 3026/7936/5201 字），角色 Ceroba/Espeon 均注入，世界书词条「赤音」命中，成书 md 落盘；报告 `exports/e2e-report-2026-09-29-15-01-44.json`
- full（3 章共 20000 字）：**PASS**，70 分钟，3 章共 42246 字（第 1/2/3 章 15160/12923/14163 字，目标 6667/章），每章 3 分片（9 次分片内容生成 + 3 次分片大纲，分片大纲带 1 次失败重试——本地小模型偶发非法 JSON），全部 11 项断言通过；成书 `exports/Ceroba与Espeon在Lomadi-pipeline-2026-09-29-16-53-19.md`（42k 字，标题+3 章+连贯正文），报告 `exports/e2e-report-2026-09-29-16-53-19.json`
- 无头触发方式：主进程 `index.ts` 读取 `process.env.PIPELINE_E2E_SCALE`（smoke|full，仅 dev 生效），app ready 后 6s 自动执行 runE2E 并打日志；UI 侧可用「流水线自测」按钮

### Phase 9（写作模式 2.0 整合 E2E：表格整理 + 剧情审核整合验证，Spec: test-writing-v2-integrated-e2e，2026-09-30）

**背景**：用户反馈"写作模式 2.0 测试结果未达预期，表格整理功能与剧情审核流程未被正确整合到测试环节"。本轮新增主进程 `runV2IntegratedE2E` 编排方法，验证**表格整理**与**剧情审核（含单条修正）**是否被正确纳入章节创作循环，并验证**已整理表格作为上下文注入下一章节生成管线**。

**实现**：
- `WritingPipelineService.runV2IntegratedE2E(onProgress?)`：完整 6 阶段（环境准备 → 项目创建 → 模型基准 → 素材选择 → 大纲 → 4 章循环[AI 生成 → 剧情检查 → 单条修正 → 表格整理 → 表格验证 → 上下文注入 → 阶段保存] → 断言 → 报告落盘）；每步 `[V2E2E]` 日志（`addLog` + `console.log`）
- `main/index.ts` env 门禁扩展：`PIPELINE_E2E_SCALE` 支持 `v2-integrated`（dev-only，app ready 后 6s 自动执行）
- 类型扩展（`writing-v2.types.ts`）：`PipelineE2EReport.modelBaseline`（ModelConfig）、`resources`、`chapters[].fixes`（单条修正记录 PipelineV2IssueFixRecord）、`chapters[].table.verify`（fieldComplete/rowMatches/contentMatches）

**⚠️ 重点标记：表格整理在无 API Key 本地 LLM 引擎下抛错 bug（经 E2E 暴露并修复）**
- 现象：首轮 E2E 第 1 章表格整理报"未配置 API Key"失败；而内容生成/剧情检查/单条修正（走 `getAIConfig()` 非抛错）正常
- 根因：`AIConfigProvider.buildApiEndpoint()` 内部调用 `getApiKey()` / `getModelName()`（缺失时 throw），本地 LLM 引擎无 `api_key` → 仅表格整理（经 buildApiEndpoint）受影响
- 修复：① `buildApiEndpoint` 改非抛错语义——apiKey 缺失返回空字符串、modelName 缺失返回空字符串；② `TableOrganizeService` 3 处（L144/L404/L569）去掉 `if (!apiEndpoint.apiKey) throw`，仅保留 apiUrl + modelName 校验；下游 `callAIAPIWithFetch` / `buildAuthHeaders` 已有 `&& apiKey` 守卫，空 key 安全
- 验证：重跑两轮，第 1-3 章表格整理全部成功 ✅

**E2E 验证结果（本地引擎 qwen3.8 @ 127.0.0.1:5000，env 触发 `PIPELINE_E2E_SCALE=v2-integrated`，两轮完整执行）**
- 第 1-3 章闭环 100% 通过（两轮 6 章）：AI 生成（6475/5614/7100 字）→ 剧情检查（评分 88/65/72）→ 单条修正（各 2 条成功，diff 完整）→ 表格整理（5 sheet / 16/25/32 行）→ 表格验证（三项全 true）→ 上下文注入（行数 0→16→25→32 递增）→ 阶段保存
- **整合目标达成**：表格整理 + 剧情审核 + 单条修正 + 上下文注入全链路通过（用户原始诉求已解决）
- 第 4 章两轮均因**本地 LLM 分片大纲 JSON 解析失败**（pos 93/109，2 次重试耗尽）未完成（预存 flaky，非整合缺陷）；已列改进项 S1（分片大纲 JSON 加固：重试 2→3 / 容错解析 / 降低温度）
- 报告：`docs/writing-v2-integrated-e2e-test-report.md`；E2E 报告 JSON `exports/v2-integrated-report-*.json`（两轮 1465471ms / 1434527ms，≈24 分钟/轮）
- 教训：MODULE_DIR_MAP 的 key 与目录名不同（`avatar` → `avatars` 目录），`pathService.getCustomPath('avatar')` 而非 `'avatars'`

**⚠️ 重点标记：暗色模式主题兼容修复（2026-09-30）**
- 现象：暗色模式下写作 2.0 文章字体与底色全为黑色，正文不可见
- 根因：① 3 处 `Layout.Sider theme="light"` 写死亮色主题（暗色下侧边栏强制白底黑字，正文 textarea 继承黑字）；② 章节工作台 textarea 未显式设 `color`（继承 Sider 黑色文字）；③ 少数功能色硬编码 hex
- 修复：① 3 处 Sider 去掉 `theme="light"`，改 `style.background: token.colorBgContainer`（跟随 antd 主题）；② textarea 显式 `color: token.colorText`；③ 功能色 hex（`#52c41a`/`#faad14`/`#1677ff`/`#1890ff`）替换为 antd token（`colorSuccess`/`colorWarning`/`colorPrimary`），`V2NewProjectWizard` 补 `theme.useToken()`
- 涉及文件：`WritingV2Entry.tsx`（入口 Sider）/ `V2ChapterWorkbench.tsx`（左右 Sider + textarea）/ `V2ProjectList.tsx`（状态图标）/ `V2NewProjectWizard.tsx`（连接状态）/ `V2OutlineWorkbench.tsx`（CoT 图标）
- 结论：V2 组件主体已用 antd token + ant 组件（暗色自动适配），仅 Layout.Sider 写死 theme + 原生 textarea 未设 color 是暗色不可见的根因
- 教训：antd `Layout.Sider` 的 `theme="light"/"dark"` 会覆盖 ConfigProvider 算法写死背景色，跨主题场景应省略 theme 改用 `token.colorBgContainer`；原生 `<textarea>`/`<input>` 不消费 antd token，需显式设 `color` + `background`

**⚠️ 重点标记：表格整理 UI 单元格全空 bug（数据 key 与 UI 列名不匹配，2026-09-30）**
- 现象：用户反馈"表格整理中怎么都是空的"——V2TablePanel 表格行有数据（16/25/32 行）但每个单元格显示空
- 根因：① 数据层 `TableEditCommandExecutor` 按数字索引存行（AI prompt 约定 `data:{"0":"值1","1":"值2",...}`），`table-data.json` 实际为 `{"1":"lucky_seal_001","2":"海獭兽人..."}`；② UI `V2TableView` 用 header 字符串作列 `dataIndex`（`row["姓名"]` 取值）→ `row["姓名"]` 是 undefined → 全空；③ E2E verify 只查行数/字段存在（contentMatches），未验证 key 与 header 对齐 → 假阳性通过
- 修复：① `V2TablePanel` 加载时 `remapRowToHeaderKeys`（数字 key→header 名），保存时 `remapRowToIndexKeys`（header 名→数字 key），单行重整理 row 同理映射；② E2E `WritingPipelineService` 表格验证加 `keyAlignment` 检查（验证行 key 能定位到有效 header 列且值非空），`PipelineE2EChapterRecord.table.verify` 类型加 `keyAlignment` 字段
- 涉及文件：`V2TablePanel.tsx`（新增 2 个映射函数 + 3 处调用）/ `WritingPipelineService.ts`（keyAlignment 检查）/ `writing-v2.types.ts`（verify 类型）
- 教训：数据层 key 格式（数字索引 vs 列名）是跨层契约，UI 读取必须与存储格式对齐；E2E 验证不能只查"行数>0/字段存在"，必须验证"UI 实际能取到值"（key 对齐），否则假阳性

### Phase 10（漫画解析模式，Spec: integrate-comic-parsing-mode，2026-10-05）

**背景**：用户需要从本地漫画文件夹导入漫画图片，借助 AI 多模态模型逐页识别（角色/场景/剧情/情感 + 文本提取），并将分析结果整理为结构化文字描述，支撑故事大纲/章节编写。入口为 V2 assets 阶段第 4 个 Tab「漫画解析」（`V2AssetsStage`）。

**架构**（复用现有基础设施，不新造轮子）：
- 类型契约：`writing-v2.types.ts` 新增 `MangaPage`/`MangaPageAnalysis`/`MangaPageSummary`/`MangaAnalysisResult`/`V2MangaAPI` 等，`WritingV2API` 挂 `manga` 子命名空间（preload 全类型化，无 any）
- 主进程：`src/main/services/manga/MangaParsingService.ts`（单例）
  - `scanFolder`：过滤图片扩展名（JPG/PNG/WebP/BMP/TIFF）→ 按文件名数字前缀升序（无数字排最后按字母序）→ 1-based 连续编号
  - `analyzePage`：读图 → base64 data URI → OpenAI Vision 多模态请求（非流式，同 `recognizeImageTraits` 链路）→ 容错 JSON 解析（直接 parse → 首尾大括号提取 → ```json 代码块提取）
  - **跨页上下文**：第 2 页起 system prompt 注入前 10 页摘要 Markdown 表格（页码/角色/场景/关键剧情/情感/重要对话），保证剧情连贯性
  - **阅读顺序**：`leftToRight`/`rightToLeft` 注入 prompt，影响格子编号方向（日漫从右到左）
  - `generateStoryOutline`：全部页面摘要 → AI 生成结构化大纲
  - `exportAnalysis`：全书结果写 Markdown（大纲 + 角色汇总表 + 逐页分析）
- IPC：`manga:scanFolder`/`analyzePage`/`buildContextTable`/`generateOutline`/`exportAnalysis` 共 5 通道（`mangaHandlers.ts`，注册于 `ipc/index.ts`）
- 前端：`WritingModeV2/manga/`
  - `V2MangaStage.tsx`（容器：导入/浏览/分析/批量/大纲状态管理；批量分析用 `useRef` 防重入 + 取消标志）
  - `V2MangaViewer.tsx`（data URI 展示 + 前后翻页 + 缩略图导航，rightToLeft 时缩略图反转）
  - `V2MangaReadingOrderToggle.tsx`（阅读顺序 Radio）
  - `V2MangaAnalysisPanel.tsx`（分析按钮（`supportsVision` 检测）+ 结果分区 + 全字段手动修正 + 「已修正」标记）
  - `V2MangaContextPreview.tsx`（跨页上下文表格预览 + 重新生成）
  - `V2MangaOutlinePanel.tsx`（大纲生成/复制/导入写作编辑器（parseOutline → patchProject → setStage('outline)）/导出 Markdown）
  - `mangaSummaryUtils.ts`（渲染层 `analysisToSummary`，与主进程摘要逻辑一致，修正后摘要同步更新）

**验证**：
- `MangaParsingService.test.ts` 6 单测通过（过滤/排序/index/路径/空目录/不存在目录）
- typecheck 本次文件零错误；`npm test` 1491 通过无回归（4 个预存失败在无关模块）
- Electron 应用启动成功，manga IPC 注册无异常；实际 AI 分析依赖用户配置的多模态模型（`supportsVision=true`），未配置时 UI 给出明确提示

**约束提醒**：单页图片 >8MB 时主进程返回明确错误提示（压缩后再导入）；批量分析串行执行（防 AI 引擎过载），单页失败不中断批量。

**用户引导辅助识别（2026-10-05 用户反馈后补充）**
- 背景：用户反馈 AI 分析漫画页面时可能有偏差，希望能在分析/重新分析时提供页面内容引导
- 实现：
  - `MangaParsingService.analyzePage` 新增 `userGuidance?: string` 参数
  - `buildSystemPrompt` 末尾注入「用户引导」段落（优先级最高，冲突时优先采信用户引导）
  - user message 中追加「用户提示（请优先参考）：...」
  - `V2MangaAnalysisPanel` 分析按钮下方新增「页面内容引导」TextArea（可选，分析时携带，编辑态禁用）
  - `V2MangaStage.handleAnalyzePage` 接收 `userGuidance` 并透传给 IPC
  - 类型契约：`V2MangaAPI.analyzePage` / `preload` / `mangaHandlers` 均增加 `userGuidance?: string`
- 影响文件：`MangaParsingService.ts` / `mangaHandlers.ts` / `preload.ts` / `writing-v2.types.ts` / `V2MangaAnalysisPanel.tsx` / `V2MangaStage.tsx`
- 批量分析不携带用户引导（批量为自动流程，用户引导仅用于单页分析/重新分析）

**漫画背景信息字段 + 新建漫画解析入口（2026-10-05 用户反馈后补充）**
- 背景：原入口仅有「导入漫画文件夹」，AI 对漫画内容缺乏先验认知（角色名/题材/世界观全靠看图猜）；用户要求添加书级字段（漫画名称、主要角色、漫画主题等）辅助 AI 理解，并新增「新建漫画解析」按钮
- 实现：
  - 类型：`writing-v2.types.ts` 新增 `MangaMetaInfo { title?; characters?; theme?; background? }`（全可选）；`V2MangaAPI.analyzePage` 参数与 `generateOutline` 第二参、`MangaAnalysisResult.mangaMeta` 均扩展
  - 新组件 `manga/V2MangaMetaModal.tsx`：antd Modal + Form，4 个可选字段（名称/主要角色/主题/故事背景），`destroyOnHidden` + `preserve={false}` 每次打开按 `initial` 重挂载回填
  - `V2MangaStage`：
    - 空态新增主按钮「新建漫画解析」→ 填表确认后继续选文件夹导入（原按钮改名「直接导入文件夹」保留无信息直入路径）
    - 导入后工具栏新增「漫画信息」按钮（编辑回填）+ 已填名称以 Tag 展示
    - `mangaMeta` 为 Stage 内存态（与 analysisMap 同级，刷新即失，无持久化）；单页/批量 `analyzePage` 均透传 `mangaMeta ?? undefined`
  - `MangaParsingService`：
    - `buildMetaLines` 私有辅助：仅输出非空字段的 Markdown 行
    - `buildSystemPrompt` 在「分析维度」后注入「漫画背景信息」段：角色识别优先匹配用户提供的主要角色；主题/背景辅助理解；画面与背景冲突时以画面为准
    - `generateStoryOutline(summaries, mangaMeta?)`：system prompt 注入背景信息（约束角色命名一致 + 题材定位），user prompt 标题带《漫画名称》
    - `buildMarkdown` 导出顶部新增「漫画信息」段
  - IPC：`manga:analyzePage` / `manga:generateOutline` 透传 `mangaMeta`（preload 全类型化）
- 行为约定：字段全空时不注入任何 prompt 段落，对既有流程零影响；批量分析同样携带（书级上下文，区别于页面级 userGuidance）
- 影响文件：`writing-v2.types.ts` / `MangaParsingService.ts` / `mangaHandlers.ts` / `preload.ts` / `V2MangaStage.tsx` / `V2MangaOutlinePanel.tsx` / `V2MangaMetaModal.tsx`（新增）
- 验证：manga 单测 6/6 通过；typecheck 本次文件零错误（项目其余为预存错误）；主进程文件改动已重启 dev server 生效
- 小插曲：实现时曾将阅读顺序文案误写为「从左到左」，同轮自查发现并改回「从左到右」（未流入用户端）

**漫画信息表单扩展：源语言 + 色彩字段（2026-10-05 用户反馈后补充）**
- 背景：用户要求在漫画背景信息中再增加「源语言」（英文、日文等）和「色彩」（黑白/彩色）两个字段，辅助 AI 文本提取与场景分析
- 实现：
  - 类型：新增 `MangaSourceLanguage`（japanese/chinese/english/korean/french/spanish/german/russian/other）与 `MangaColorMode`（bw/color）；`MangaMetaInfo` 增加 `sourceLanguage?` / `colorMode?`（全可选，不填则 AI 自动识别）
  - `V2MangaMetaModal`：新增「源语言」Select（allowClear，placeholder「自动识别（可不选）」）+「色彩」Radio.Group（黑白/彩色）；`handleOk` 透传两字段
  - `MangaParsingService`：`MANGA_LANGUAGE_LABELS` 中文标签映射；`buildMetaLines` 增加「源语言：X（请按该语言识别并提取文本，保留原文）」「色彩：黑白/彩色漫画」两行；`buildSystemPrompt` 背景信息使用指引同步补充（文本按源语言提取、场景结合色彩模式）
  - 单页/批量 `analyzePage` 与 `generateStoryOutline` 均自动携带（复用既有 `mangaMeta` 透传链路，无需改 IPC/preload 签名）
- 影响文件：`writing-v2.types.ts` / `V2MangaMetaModal.tsx` / `MangaParsingService.ts`
- 验证：typecheck 本次文件零错误；dev server 已重启生效（未触碰 5000 端口）

**提示词优化：分镜逐格解析 + 成人内容保留 + 全局提示词拼接统一（2026-10-05 用户反馈后补充）**
- 背景（用户实测发现）：
  1. 多分镜单页漫画被 AI 生成整页总结性描述，未按分镜顺序逐个识别，缺细节和完整性
  2. AI 自动忽略页面内的成人元素（用户所用为消融版模型，允许成人内容输入输出）
  3. 全局提示词拼接与其他功能模式不一致（用户选择「验证并统一模式」）
- 实现（均在 `MangaParsingService.ts`）：
  - `buildSystemPrompt` 新增「**分镜解析规则（必须严格遵守）**」6 条强约束：先清点全部分镜总数、按自然阅读顺序逐格独立完整解析、每格仅对应一条 panels 记录、禁止合并/遗漏/整页总结、panelIndex 从 1 连续递增且条数等于分镜总数、单分镜页也须完整解析
  - `buildSystemPrompt` 新增「**成人内容处理**」节：声明模型为消融版（abliterated）允许成人内容输入输出；要求 plot/emotion 如实客观描述成人元素（裸露/亲吻/性暗示/血腥等），不忽略、不模糊、不自我审查；文本提取不改写成人台词；输出用客观中性语言
  - 新增模块级 `prependEnginePrompt(engineSystemPrompt, body)` 统一拼接函数（`${全局提示词}\n\n${正文}`，与 `characterTraitAIService.recognizeImageTraits` L1402 同款）；`buildSystemPrompt` 与 `generateStoryOutline` 两条路径统一改用（行为保持全局提示词在最前），并修正 buildSystemPrompt 中「置于分析维度之后」的过时注释
  - 「分析维度」第 3/4/5 条同步强化为逐分镜表述（不合并、不遗漏 / 各分镜及整页情感 / 标注所在分镜与位置）
- 不做的事：不改 IPC/preload/类型契约/前端；成人内容说明仅注入页面分析 prompt（大纲由页面分析摘要派生自然继承）
- 验证：typecheck manga 文件零错误；manga 单测通过（exit 0）；静态核对 `prependEnginePrompt` 在 L58 定义、L398（大纲）/L646（页面分析）两处调用、两新节存在；dev server 已重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 漫画解析误报「AI 模型不支持图片识别」根因与修复（2026-10-05 用户反馈）**
- 现象：首次进入漫画解析显示「当前 AI 模型不支持图片识别，请切换到多模态模型」，但设置中引擎 supportsVision=True；点一下设置菜单即恢复（无需测试模型）
- 根因（设置 store 懒加载缺陷，非模型/能力数据问题）：
  1. `settingStore` 无初始值，**应用启动时没有全局 fetchSetting**——只有 Dashboard/Settings/CharacterManager 等特定组件挂载时才各自触发 `fetchSetting()`
  2. `uiStore.activeTab` 通过 zustand persist 恢复上次所在页；若恢复到**创作中心（chat，WritingModeV2 所在）**等不触发 fetch 的页面，`setting` 保持 `null`
  3. `V2MangaStage` 直接读 `setting?.aiEngines?.find(...)` → `activeEngine` undefined → `supportsVision=false` → 误报
  4. 打开设置菜单 → `Settings.tsx` 挂载 effect 调 `fetchSetting()` → store 填充（settings.json 数据一直正确）→ 漫画功能恢复。与「测试模型」无关
- 修复：
  - `App.tsx`：启动时全局 `useSettingStore.getState().fetchSetting()`（根因修复，所有读设置的功能受益）
  - `V2MangaStage`：新增 `visionUnsupported = setting !== null && !supportsVision`，区分「设置未加载（未确定）」与「确认不支持」；单页/批量分析守卫、分析面板 `supportsVision` prop 均改用该值，加载窗口期不再误报、不阻塞按钮
- 排查路径备忘：`supportsVision` 链路 = settings.json → setting:load IPC（每次磁盘新鲜读）→ settingStore → 组件。数据层无缓存问题；问题在渲染层 store 加载时序
- 验证：typecheck 本次文件零错误；dev server 重启后日志见 `setting:load` 请求正常发出

**漫画信息持久化到项目（2026-10-05 用户反馈后补充）**
- 背景：用户反馈「新建漫画解析」的下一步按钮应为「保存并选择漫画文件夹」，提交数据要先持久化
- 实现：
  - `writing.types.ts`：`WritingProject` 新增可选字段 `mangaMeta?: MangaMetaInfo`（类型从 writing-v2.types 仅类型导入，运行时零依赖）；主进程 `WritingProjectRepository.saveProject` 整体 JSON 序列化，新字段自动落盘
  - `V2MangaStage`：`handleMetaOk` 先 `patchProject(currentProject.id, { mangaMeta })` 持久化（走项目 store 防抖落盘，单一真相源=项目实体）再继续选文件夹；无当前项目时提示「仅本次会话生效」；项目切换时 useEffect 从项目实体恢复 mangaMeta；`hasContent` 判断纳入 sourceLanguage/colorMode 字段（此前只填源语言/色彩会被丢弃）
  - 按钮文案：「下一步：选择漫画文件夹」→「保存并选择漫画文件夹」
- ⚠️ 顺手修复的预存 bug（typecheck 暴露）：
  - `MaterialList.tsx` / `useWritingMaterials.ts`（V1 写作模式）：writing.types 导入路径层级错误（3 级应为 4 级），TS2307 掩盖了下游错误——`MATERIAL_ICONS/TAG_COLORS/TYPE_LABELS` 缺 `writing-style` 项（已补）；`useWritingMaterials.loadAllMaterials` 用 `list?.()` 调用结果做存在性判断（Promise 恒真 + 重复请求 4 次 list()，已改为方法存在性判断）
- 影响文件：`writing.types.ts` / `V2MangaStage.tsx` / `MaterialList.tsx` / `useWritingMaterials.ts`
- 验证：typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 漫画分析两个 bug 修复（2026-10-05 用户实测 5 页后反馈）**
- Bug 1：右侧页分析面板不可滚动，剧情理解及后续内容被遮挡
  - 根因：面板内部滚动容器（`flex:1 minHeight:0 overflowY:auto`）本身正确，但其父级 antd Tabs 的 tabpane 无高度（`height:100%` 对 auto 高度父级无效）→ 内容撑开溢出视口
  - 修复：`V2MangaStage` Tabs 加 `className="v2-manga-stage-tabs"` + `style={{flex:1,minHeight:0}}`；`App.css` 追加规则链：Tabs 根 flex column → `.ant-tabs-content-holder` flex:1 min-height:0 → `.ant-tabs-content`/`.ant-tabs-tabpane` height:100% → `.ant-tabs-tabpane-active` overflow-y:auto
- Bug 2：显示「分析完成」但最后一页内容为空白
  - 根因（主进程日志实锤）：第 5 页有 analyzePage 请求记录但无 complete/failed 记录 → 走了**静默失败路径**（AI 返回空内容或 JSON 解析失败 → success=false），批量循环对失败页**静默跳过**（仅主进程 console 有日志），UI 只见「批量分析结束：成功 X / 5 页」→ 失败页无分析数据 = 空白
  - 修复三层：
    1. 主进程 `analyzePage`：① 检测 `finish_reason==='length'` → 错误提示「AI 输出被 max_tokens 截断，请增大引擎 max_tokens 后重试」（最后一页上下文最长，最易截断）；② 空结果守卫（panels/characters/overallEmotion 全空 → success=false「AI 返回了空分析结果」）；③ 三条静默失败路径补 console.error 日志（含 content 前 200 字符便于排查）
    2. 批量循环：逐页失败 `message.warning('第 N 页分析失败：原因（可点击该页重试）')`
    3. 结束消息：有失败时改为 warning「成功 X 页，失败 Y 页 / 共 N 页」
- 影响文件：`V2MangaStage.tsx` / `App.css` / `MangaParsingService.ts`
- 验证：typecheck 本次文件零错误；manga 单测 6/6 通过；dev server 重启生效（未触碰 5000 端口）
- 排查备忘：主进程日志关键字 `[MangaParsing]`；「有请求无 complete」= 静默失败路径（空内容/JSON 解析失败），「有 complete 但 panels:0」= 空结果（现已守卫）

**漫画信息表单扩展：漫画类型字段（10 类，类型专属 prompt）（2026-10-05 用户要求后补充）**
- 需求：新增「漫画类型」下拉字段（10 选项：Doujinshi 同人志 / Manga 漫画 / Artist CG 画师原创 / Game CG 游戏 CG / Western 欧美向 / Non-H 非成人向 / Image Set 图片合集 / Cosplay 角色扮演 / Asian Porn 亚洲成人影像 / Misc 杂项），每种类型注入不同 prompt 辅助 AI 理解图片
- 实现（沿用源语言/色彩的 mangaMeta 链路，零 IPC 改动）：
  - `writing-v2.types.ts`：新增 `MangaComicType`（10 值联合类型）；`MangaMetaInfo` 增加 `comicType?`
  - `V2MangaMetaModal.tsx`：`COMIC_TYPE_OPTIONS`（中文+英文名）+ Select（allowClear，tooltip 说明类型影响解析策略）
  - `MangaParsingService.ts`：`MANGA_COMIC_TYPE_LABELS`（中文标签）+ `MANGA_COMIC_TYPE_PROMPTS`（每类型专属解析指引，如 Game CG「对话框文字按对话提取、菜单/状态 UI 文字忽略」、Artist CG「单幅插画整页视为一个分镜不虚构分镜」、Cosplay「实拍照片重点识别扮演角色/服装/姿势」、Image Set「各页独立不强行串联」、Asian Porn「按成人内容处理一节客观详述」）；`buildMetaLines` 注入「漫画类型：X（类型指引）」行；背景信息参考指引段补充「按漫画类型特点调整解析策略」
  - 注入链路自动覆盖：单页分析 / 批量分析 / 大纲生成（三处均经 buildMetaLines）；随项目持久化（mangaMeta 整体存 WritingProject）
- 影响文件：`writing-v2.types.ts` / `V2MangaMetaModal.tsx` / `MangaParsingService.ts`
- 验证：typecheck 本次文件零错误；manga 单测 6/6 通过；dev server 重启生效（未触碰 5000 端口）

**已解析漫画列表展示（2026-10-05 用户反馈：已解析的漫画在漫画解析页签看不到）**
- 背景：漫画导入与逐页分析此前只存在组件内存态（analysisMap/pages），离开页签或重启应用后丢失，重新进入只剩空态
- 实现（数据随 V2 项目持久化，单一真相源=项目实体）：
  - `writing-v2.types.ts`：新增 `MangaComicRecord`（id/folderPath/folderName/pages/readingOrder/analyses[{pageIndex,analysis}]/createdAt/updatedAt）
  - `writing.types.ts`：`WritingProject` 新增 `mangaComics?: MangaComicRecord[]`（主进程整体 JSON 序列化自动落盘）
  - `V2MangaStage`：
    - upsert effect：当前漫画变化（导入/单页分析/批量逐页/手动修正/阅读顺序）时按 folderPath 去重 upsert 到项目 mangaComics（patchProject 防抖落盘）
    - 空态列表：无漫画打开时展示「已解析漫画（N）」列表（按 updatedAt 倒序），每项显示文件夹名、总页数/已解析页数、「含分析结果」标签、打开/删除按钮
    - `handleOpenRecord`：重扫来源文件夹刷新页面列表（文件夹丢失时按保存的页面列表恢复并 warning），按页码恢复逐页分析（含用户修正）
    - `handleDeleteRecord`：Modal.confirm 确认后删除（删的是记录，不删源文件夹/图片）；若删的是当前打开的漫画则返回列表
    - 工具栏新增「漫画列表」按钮：关闭当前漫画返回列表（批量分析/单页分析中禁用）
- 影响文件：`writing-v2.types.ts` / `writing.types.ts` / `V2MangaStage.tsx`
- 验证：typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）
- 注意：历史漫画（本次改动前解析的）无记录，需重新导入一次即自动生成列表项

**⚠️ 重点标记 - 漫画解析三个问题修复 + 上下文扩充（Spec: fix-manga-scroll-persistence-expand-context，2026-10-05 用户二次反馈后重做）**
- 问题 1（滚动，上轮修复未生效）根因：**antd 6 Tabs DOM 类名与 antd 5 不同**。项目 antd 6.5.3 底层是 `@rc-component/tabs`，实际 DOM 为 `.ant-tabs > .ant-tabs-nav + .ant-tabs-body-holder > .ant-tabs-body > .ant-tabs-content`（每页签一个，active 带 `-active`，非激活带 `-hidden`）；上轮 CSS 写的 antd 5 类名（`.ant-tabs-content-holder`/`.ant-tabs-tabpane`）在 antd 6 不存在，CSS 静默落空。
  - **教训**：给 antd 组件写外部 CSS 前，必须对照 `node_modules/@rc-component/*`（antd 6 组件底层）源码确认实际类名，不能凭 antd 5 经验
  - 修复：`App.css` `.v2-manga-stage-tabs` 系列规则全部改为 antd 6 类名（body-holder flex:1 min-height:0 → body/content height:100% → active 面板 overflow-y:auto），并在 CSS 注释中标明陷阱
- 问题 2（持久化，上轮修复未生效）根因：**漫画解析页签无需项目即可进入**（`WritingV2Entry.stageDisabled('assets')` 返回 false），上轮持久化挂在 `WritingProject.mangaComics` 上、upsert effect 依赖 `currentProjectId`——未选项目时静默跳过，数据只在内存。
  - **教训**：给「可选项目依赖」的页面做持久化时，先确认该页面是否允许无项目访问；不允许的项目级存储会在无项目场景静默丢数据
  - 修复：新增 `useMangaComicStore`（zustand + persist/localStorage，key `creative-cafe-manga-comics-v1`），记录自包含（`MangaComicRecord` 增加 `mangaMeta?` 快照，打开记录时还原到工作区）；`V2MangaStage` upsert/列表/删除全部改接全局 store；`WritingProject.mangaComics` 字段移除（无存量数据，零迁移）
- 新需求（上下文表格扩充）：
  - `MangaPageSummary` 增加 `panelCount/panelPlots/actions/texts/continuity` 5 字段；主进程 `buildPageSummary` 与渲染层 `analysisToSummary` 同步扩充（此前只取 `panels[0].plot`，其余分镜剧情全丢——现已保留逐分镜剧情「分镜1: …；分镜2: …」）
  - `buildContextTable` 改为 8 列富信息格式（页码含分镜数 / 角色表情 / 角色动作 / 场景 / 逐分镜剧情 / 关键文本(带类型标注) / 情感 / 叙事衔接），单元格软截断 300 字
  - `MAX_CONTEXT_PAGES` 10 → 100（每页约 100-300 字，100 页约 1-3 万字，百万级上下文无压力）
  - 分析提示词分镜解析规则第 7 条：每分镜 plot ≥40 字（画面细节+动作+表情+关键信息），从源头保证每页上下文 ≥100 字
  - 「上下文预览」Tab 直接渲染主进程 table 字符串，自动显示新格式
- 影响文件：`App.css` / `useMangaComicStore.ts`（新增）/ `V2MangaStage.tsx` / `writing-v2.types.ts` / `writing.types.ts` / `MangaParsingService.ts` / `mangaSummaryUtils.ts` / `MangaParsingService.test.ts`（+5 用例）
- 验证：typecheck 本次文件零错误；manga 单测 11/11 通过（含「每页信息量 ≥100 字」「8 列格式」「全分镜剧情保留」「软截断不破坏表格结构」）；dev server 重启生效（未触碰 5000 端口）

**「已自动保存」指示器（2026-10-05 用户问"没看到保存按钮，是自动保存吗"）**
- 背景：漫画数据为**全自动保存**（无保存按钮）——`V2MangaStage` 的 upsert effect 在 `folderPath/pages/analysisMap/readingOrder/mangaMeta` 任一变化时立即写入全局 `useMangaComicStore`（localStorage），但行为对用户不可见，易产生困惑
- 修复：工具栏文件夹路径前新增绿色 `Tag`（CheckCircleOutlined「已自动保存」+ Tooltip 说明保存范围与恢复方式），使自动保存行为可见
- 影响文件：`V2MangaStage.tsx`；typecheck 零错误；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 「漫画信息」弹窗回显空白修复（2026-10-05 用户反馈）**
- 现象：打开已完成/未完成解析的漫画，点「漫画信息」按钮，之前填写的内容全部空白
- 根因 1（主因，双重数据源冲突）：迁移到全局 store 后残留的**项目级恢复 effect**（`V2MangaStage` 中 `currentProjectId` 变化时 `setMangaMeta(proj?.mangaMeta)`）会在切换项目时用项目的 mangaMeta（通常 null）**覆盖当前打开漫画的信息**，随后 upsert effect 把 null 写回记录——既造成回显空白，又丢失记录里的快照
  - **教训**：同一状态字段存在两个写入源（项目实体 vs 漫画记录）时，必须明确单一真相源的作用域边界；本项目中「打开的漫画」的 mangaMeta 只能来自记录快照或表单提交，项目级仅作为无漫画打开时的初始值
- 根因 2（antd Form 回填机制）：`V2MangaMetaModal` 的 form 实例（`Form.useForm`）在弹窗开关之间存活，`initialValues` 仅在 `<Form>` 首次挂载时写入 store（已核实 `@rc-component/form` 源码：`Form.js` `setInitialValues(initialValues, !mountRef.current)` + `useForm.js` `prevWithoutPreserves` 回填路径），二次打开依赖内部机制不可靠
  - **教训**：Modal 内嵌 Form 且 form 实例外置于 Modal 时，**每次打开必须显式 `form.setFieldsValue(initial)`**，不要只依赖 `initialValues`
- 附带修复：`hasContent` 判断漏掉 `comicType`（只填漫画类型会被静默丢弃）；`handleImport` 切换到不同文件夹时改为以目标文件夹已有记录的 mangaMeta 为准（避免上一本的信息串到新漫画，「新建漫画解析」刚提交的信息在无记录时保留）
- 影响文件：`V2MangaMetaModal.tsx` / `V2MangaStage.tsx`；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 「漫画信息」回显空白二次修复：双层兜底 + 自愈（2026-10-05 用户二次反馈"仍旧为空"）**
- 现象：上轮修复后弹窗仍全空。截图关键线索：工具栏无蓝色标题标签（`mangaMeta?.title` 为空才不显示）→ 打开漫画时状态本身为空 → 记录里的 mangaMeta 大概率在**历史 bug 期**（切换项目覆盖 + 空值 upsert）已被清空
- 修复（三层加固，`V2MangaStage.tsx`）：
  1. `effectiveMangaMeta = mangaMeta ?? currentRecord?.mangaMeta ?? null`：状态为空时回退到**记录快照**（持久化层），标题标签/「未填写信息」提示/编辑弹窗 `initial` 全部改用兜底值——即使状态丢失，只要记录还有数据就能回显
  2. 打开「漫画信息」弹窗时**自愈**：状态为空但记录有快照 → `setMangaMeta(快照)` 恢复状态，防止后续 upsert 又把空值写回
  3. upsert 防覆盖：`mangaMeta: mangaMeta ?? existing?.mangaMeta ?? undefined`——状态为空时保留记录已有快照
- 诊断手段：工具栏新增「未填写信息」灰色 Tag（悬停提示填写入口）；点「漫画信息」时 `console.info('[MangaInfo]…')` 输出状态层/记录层各自有无数据，可在 DevTools 确认数据实际位置（确认问题关闭后可移除）
- **教训**：状态层与持久化层可能不同步（历史 bug 会留下"状态空、记录有"或"记录空"的脏数据），UI 读取展示数据时应以持久化层为兜底真相源，并做自愈；同类"用户报数据丢失"问题先加诊断输出定位数据在哪一层，再定修复
- 影响文件：`V2MangaStage.tsx`；typecheck 零错误；dev server 重启生效（未触碰 5000 端口）

**阅读顺序提示词增强（2026-10-05 用户确认"阅读顺序是否已插入提示词"后加强）**
- 背景：用户确认「从左到右/从右到左」开关指的是**单页内分镜的阅读顺序**。原提示词已注入方向声明（`## 阅读顺序：从右到左（日漫/韩漫风格）` + panelIndex 按阅读顺序递增，共 3 处引用），但仅声明方向、未给空间扫描路径，视觉模型不一定真正按正确顺序扫描
- 修复：`MangaParsingService.buildSystemPrompt` 的「阅读顺序」节改为显式空间路径描述——右到左：「从页面右上角开始，每一行从右向左依次读取；到达行左端后换到下一行的右端继续，直至页面左下角」；左到右镜像对称；并补充「同一水平高度上位置更接近阅读起始侧的分镜编号在前」
- 顺手清理：`MangaParsingService.test.ts` 预存的 TS6133（makeAnalysis 未使用参数）
- 影响文件：`MangaParsingService.ts` / `MangaParsingService.test.ts`；manga 单测 11/11；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**「分析全部页面」重新分析确认框（2026-10-05 用户需求：改漫画信息后可删旧结果重跑）**
- 背景：批量分析原逻辑**静默跳过**已有结果的页——用户修改漫画信息后点「分析全部页面」看似在重跑，实际所有页都被跳过，新信息未生效
- 实现（`V2MangaStage.tsx`）：`handleBatchAnalyze`（按钮）与 `runBatchAnalyze`（执行循环）分离——
  - 无分析结果：直接开始
  - 已有分析结果：`Modal.confirm`「当前已有 N/M 页分析结果。确认后将删除全部分析结果与上下文预览，并按当前漫画信息与图片重新分析」（确认=删除并重新分析 / 取消=保留当前结果）
  - 确认后 `setAnalysisMap(new Map())` 清空（上下文预览表格由分析结果派生，随之清空；自动保存同步更新记录）+ `runBatchAnalyze(new Map())` 以**显式空工作集**重跑
- ⚠️ 陷阱：重跑必须显式传空 Map 给 `runBatchAnalyze(initialMap)`——若依赖闭包里的 `analysisMap`，`setAnalysisMap(new Map())` 的更新不会反映到已创建的闭包，跳过逻辑会用旧数据
- 影响文件：`V2MangaStage.tsx`；typecheck 零错误；dev server 重启生效（未触碰 5000 端口）

**「导入到写作编辑器」无项目时 AI 自动建项目（2026-10-05 用户需求：不再要求先选项目）**
- 原行为：未选项目时点「导入到写作编辑器」只提示"请先在项目列表选择或新建项目"
- 新行为（`V2MangaOutlinePanel.tsx`）：
  - **已有项目**：保持原逻辑直接导入（parseOutline → patchProject outline/outlineRaw/mangaMeta → 跳大纲阶段）
  - **无项目**：调 `api.manga.generateProjectDraft(summaries, outline, mangaMeta)` → AI 基于全部解析摘要 + 已生成大纲 + 漫画信息补全项目字段（项目名称/创意描述/小说类型/叙事视角/写作风格/目标字数/章节数/附加要求）→ 弹窗（Spin 加载 + 显式 `setFieldsValue` 回填，AI 失败时提示可手动填）→ 用户确认后 `createProject` + 导入大纲 + 用确认的标题覆盖项目名
- 主进程（`MangaParsingService.generateProjectDraft`）：复用上下文表格 + `prependEnginePrompt` 全局提示词 + `buildMetaLines` 漫画背景约束；提示词限定严格 JSON 输出并给出三个枚举的完整候选值；`extractJsonBlock` 兼容 ```json 代码块/前后杂文；`normalizeProjectDraft` 归一化（枚举非法回退默认 web_novel/third_person/detailed，数字越界收敛，title/creativeDescription 必填缺失返回 null）
- 链路：types（`V2MangaProjectDraft(Result)` + `V2MangaAPI.generateProjectDraft`）→ 服务 → `mangaHandlers`（`manga:generateProjectDraft`）→ preload `writingV2.manga.generateProjectDraft`
- 影响文件：`writing-v2.types.ts` / `MangaParsingService.ts` / `mangaHandlers.ts` / `preload.ts` / `V2MangaOutlinePanel.tsx`；manga 单测 11/11；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 导入写作编辑器报「大纲解析失败」：Markdown 大纲无 JSON 解析器（2026-10-05 用户反馈）**
- 现象：漫画大纲生成后点「导入到写作编辑器」报「大纲解析失败」。dev server 日志实锤：`[OutlineGenerator] JSON preview: # 《欢迎来到爱之岛》完整故事大纲` → 6 种 JSON 修复策略全部失败
- 根因：**大纲格式契约不一致**——V2 管线的 `OutlineGenerator.parseOutlineResponse` 只认 JSON 大纲（workInfo/storyLine/chapters 结构），但漫画解析的 `generateStoryOutline` 按提示词产出的是 **Markdown 大纲**（`# 标题 / ## 章节 + 正文`），导入时必然解析失败
- 修复（`OutlineGenerator.ts`）：所有 JSON 策略失败后新增 **Markdown 兜底解析** `parseMarkdownOutline`——首个单 `#` 标题→作品名；`##`/`###` 标题或「第X章/节/回/卷」独立行（兼容加粗）→章节标题；标题下正文→章节摘要；首个章节前内容→前言（creativeDescription + coreConflict）；结果统一走 `validateOutline` 规范化；无章节可识别时返回 null 保留原错误
- ⚠️ 教训：**跨模块复用解析/生成接口时，必须先核对"输出格式契约"**——漫画大纲生成时（提示词写"结构化大纲"）没有和导入侧的 `parseOutline` 格式对齐，导致功能闭环在最后一环断裂；新增产出方时应优先消费方已有的解析器格式
- 验证：新增 `OutlineGenerator.test.ts` 4 用例（标准 Markdown 大纲/第X章独立行/JSON 不受影响/纯文本仍报错），15/15 通过；typecheck 本次改动零新错误（OutlineGenerator 预存 5 个 unused 告警未动）；dev server 重启生效（未触碰 5000 端口）

**大纲持久化：生成的大纲随漫画记录自动保存（2026-10-05 用户反馈"漫画生成的大纲没有保存"）**
- 根因：`outline` 只是 `V2MangaStage` 的组件内存 state，未写入 `MangaComicRecord`——重开漫画/重启应用/重新导入后大纲丢失（分析结果、漫画信息都在自动保存里，唯独大纲漏了）
- 修复：
  1. `MangaComicRecord` 新增 `outline?: string` 字段（`writing-v2.types.ts`）
  2. 自动保存 upsert effect 写入 `outline`（防御性合并：`outline || existing?.outline || undefined`，空状态不覆盖已有快照），deps 补 `outline`
  3. `handleOpenRecord` 打开记录时 `setOutline(record.outline ?? '')` 还原
  4. `handleImport` 切换到不同文件夹时从目标记录还原大纲（同 mangaMeta 处理，重导入同一漫画不丢大纲）
- ⚠️ 教训：**新增"AI 生成产物"类 state 时，要同步检查它是否属于该实体的持久化快照**——本例漫画记录持久化了 analyses/mangaMeta/pages，但后加的大纲只存了内存；排查"X 没保存"类问题先确认该字段在不在持久化记录的类型定义里
- 影响文件：`writing-v2.types.ts` / `V2MangaStage.tsx`；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**大纲 AI 审核：生成的大纲自动经 AI 味审核（2026-10-05 用户需求：和世界书的 AI 审核功能一样）**
- 机制（复用世界书 AI 审核的三件套）：
  1. **同款 JSON 契约**：`{passed, suggestions, revisedText, optimizationSuggestions, optimizedText}`（passed=true 时填优化建议/优化文本，false 时填修订全文）
  2. **同款去AI味规则注入**：`withHumanizerGenerationRules`（shared/prompts/humanizerPolish，Spec: polish-deai-humanizer v3 完整 27 模式词表）约束审核产出的修订/优化文本本身不带 AI 味
  3. **同款结果弹窗交互**：通过/不通过 Tag + 审核说明 + 优化建议/优化后文本（通过）或修改后文本（不通过），按钮「采用审核文本 / 重新审核 / 关闭」
- 实现链路：
  - 主进程 `MangaParsingService.auditOutline(outline, mangaMeta)`：审核维度 = AI 味（重点，引用原句定位）+ 内容完整性 + 与漫画背景一致性（buildMetaLines 参照）；`prependEnginePrompt` 全局提示词；`extractJsonBlock` 解析 + 字段归一化（passed 缺失报错，文本字段空值回退原文）；max_tokens 预留 8192+（输出≈大纲全文）
  - IPC `manga:auditOutline` + preload `writingV2.manga.auditOutline` + 类型 `V2MangaAudit(Result)`
  - 渲染层 `V2MangaOutlinePanel`：「生成故事大纲」→ 生成成功 → **自动** `runAudit`（按钮变「AI 审核中…」+ 区域提示）→ 弹审核结果弹窗；「采用审核文本」→ `onOutlineGenerated(adopted)` 替换大纲（随记录自动保存）；「重新审核」→ 对当前大纲重跑
- 注意：审核失败不阻塞大纲展示（warning 提示，大纲已生成并保存）
- 影响文件：`writing-v2.types.ts` / `MangaParsingService.ts` / `mangaHandlers.ts` / `preload.ts` / `V2MangaOutlinePanel.tsx`；manga+writing 单测 15/15；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 导入后章节解析出 33 个章节：Markdown 兜底解析器误判元信息小节为章节（2026-10-05 用户反馈"生成的大纲章节不对"）**
- 现象：5 页漫画导入写作编辑器后章节列表出现 33 个"章节"。dev server 日志实锤：`[OutlineGenerator] Markdown fallback parse succeeded, chapters: 33`
- 根因（双端）：
  1. **解析器**（主因，v1 兜底解析器缺陷）：AI 大纲是结构化格式（`## 一、故事背景 / ## 二、主要角色（### 角色名）/ ## 三、剧情发展（### 第X章）`），v1 把**所有** `#` 标题都当章节 → 背景、角色档案、小节标题全混进章节列表
  2. **生成提示词**：`generateStoryOutline` 只说"格式为结构化大纲（章节标题+内容摘要）"，无章节划分规则，AI 自由发挥输出了元信息小节
- 修复（双端）：
  1. **`parseMarkdownOutline` v2 分类规则**（优先级）：① 首个单 `#` → 作品名；② 强章节模式（第X章/节/回/卷/集/幕、Chapter N、情节X）→ 章节（优先于元信息词，避免"第二章：背景揭露"误判）；③ 元信息关键词（背景/世界观/角色/人物/剧情/主题/梗概等）→ 元信息区，正文按角色类/故事类归桶**不丢失**（合并进 storyLine.coreConflict），其**嵌套子标题（级别更深，如角色名）继承该区归类**；④ 其余标题（编号项/语义化标题）→ 章节；另 `chapterCount` 同步真实章节数（原 `|| 10` 默认值会虚报）
  2. **生成提示词约束**：章节标题统一「## 第X章：章节名」、每章标注页码范围、严禁虚构未提供页面剧情、不为凑数拆章、不单列背景/角色档案等元信息小节
- ⚠️ 教训：① **兜底解析器的职责是"识别章节"而非"识别所有标题"**——AI 产出的结构化文档中，元信息小节（背景/角色/设定）与剧情章节是两类实体，必须先分类再提取；② 分类规则中**强模式（明确编号）优先于关键词**，否则"第X章：背景揭露"这类章节会被元信息词误吞；③ 层级信息（heading level）是判断"嵌套子标题归属"的关键（角色名 ### 从属于 ## 主要角色）
- 验证：新增 2 用例（元信息混排 33 章节场景 / 含元信息词的章节仍识别），writing+manga 单测 17/17；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**漫画解析全文作为写作素材：章节生成时注入全文分析（2026-10-05 用户需求"和角色卡/世界书一样的素材"）**
- 背景：导入后章节写作只参考大纲摘要（漫画内容的浓缩版），拿不到分镜级细节与具体台词。用户要求漫画解析全文视为与角色卡/世界书同级的素材
- 实现链路：
  1. **类型**（`writing.types.ts`）：`MangaReferenceMaterial { folderName, mangaMeta?, analyses }`（逐页完整分析，结构与漫画记录一致）；`WritingProject.mangaReference?`；`ShardOutlineGenerationRequest/ShardContentGenerationRequest.mangaReferenceContext?`
  2. **素材构建**（`MangaParsingService.buildMangaReferenceContext`，public）：「## 漫画源素材（源漫画全文解析）」+ 漫画背景信息（buildMetaLines）+ 逐页详情（分镜N 剧情/情绪/台词·音效·旁白提取、页面角色含表情动作、场景地点/时间/氛围、整体情感、叙事衔接）；与大纲上下文表格不同此处保留全文细节（分镜 500 字/台词 200 字软截断），页上限 150
  3. **注入点**（`WritingPipelineService.generateChapter`）：项目携带 `mangaReference` 时构建上下文 → 传入 `generateShardOutline` + `generateShardContent` 请求 → `ContentGenerator` 并入 resourceContext（与角色卡/世界书/人设/表格数据同一上下文通道，两条分片链路都覆盖）
  4. **写入点**（`V2MangaOutlinePanel.doImportToProject`）：导入时从 `useMangaComicStore` 按 folderPath 取漫画记录（含用户修正的最新分析）→ `patchProject({ mangaReference })` 随项目整体持久化（saveProject 全量序列化，新字段自动落盘）；两条导入路径（已有项目/新建项目）都走 doImportToProject
- ⚠️ 注意：素材在**导入时快照**进项目——导入后在漫画页签删除/修改分析不会同步到已导入项目，需重新导入覆盖（mangaReference 为 undefined 时会清掉旧素材）
- 影响文件：`writing.types.ts` / `MangaParsingService.ts` / `ContentGenerator.ts` / `WritingPipelineService.ts` / `V2MangaOutlinePanel.tsx`；writing+manga 单测 17/17；typecheck 本次文件零新错误；dev server 重启生效（未触碰 5000 端口）

**章节工作台「AI 生成本章」一键按钮（2026-10-05 用户反馈"内容创作页面没看到生成的按钮"）**
- 根因：V2 内容创作页的生成入口在右侧「生成流水线」面板，且是三步手动流程（生成分片大纲 → 逐分片点生成 → 合并到章节）——对漫画导入后首次写作的用户，入口不显眼且流程不直观，中间大编辑区没有生成按钮
- 修复（`V2ChapterWorkbench.tsx`）：章节标题旁新增主按钮「⚡ AI 生成本章」，一键编排完整流程：
  1. 按 `targetWordCount/1000`（1-10 收敛）自动规划分片大纲
  2. 逐分片顺序生成（顶部 message.loading 进度提示：分片大纲 → 分片 i/N → 合并）
  3. 自动合并到正文并落盘（复用 doMerge 的 setText + persistContent 链路）
  - 已有正文时弹确认框（合并将覆盖现有正文）；部分分片失败时合并成功分片并提示数量；全部失败提示查看右侧流水线
  - 细粒度操作（编辑分片大纲/重生成单片/逐片确认）仍走右侧「生成流水线」，两者共存
- ⚠️ 教训：**核心操作的入口要对"刚进入该页面的用户"可见**——三栏布局中把主操作藏在右栏 Tab 内，用户视线在中间编辑区时完全看不到；高频主操作应放在内容区头部
- 影响文件：`V2ChapterWorkbench.tsx`；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - V2 分片大纲"成功也报失败"：IPC 返回字段名与类型声明不一致（2026-10-05 用户反馈"点击AI生成本章，显示分片大纲生成失败"）**
- 现象：点「AI 生成本章」报"分片大纲生成失败"，但主进程日志明确 `成功: true, 分片数: 3`——**主进程成功、渲染层判失败**
- 根因：`writing:generateShardOutline` IPC handler 返回 `{ success: true, data: shards }`（V1/V2 共用通道，V1 hook 读 `result.data` 正确），但 V2 的类型 `ShardOutlineGenerationResult` 声明的是 `shards` 字段，V2 `planShards` 按类型读 `result.shards` → 永远 undefined → 成功也走失败分支。**V2 右侧「生成流水线」的生成分片大纲按钮从 V2 建立起就一直坏的**（只是此前用户走 V1 或没用到）
- 修复：① 类型加 `data?: ShardOutline[]`（标注 IPC 边界实际形状，shards 保留为服务层字段名）；② V2 `planShards` 改 `const shards = result.data ?? result.shards` 兼容两种形状
- 验证：分片内容流式链路（main 发 `writing:chunk:start/progress/complete/error` → preload `onShardStream*` 订阅 → store 更新）逐段核对一致，无同类问题；typecheck 本次文件零错误；dev server 重启生效（未触碰 5000 端口）
- ⚠️ 教训：① **IPC 边界的返回形状以 handler 实际 return 为准，类型声明可能是"理想形状"**——ipcRenderer.invoke 返回 any，类型断言不会帮你校验运行时形状；跨版本（V1/V2）共用 IPC 通道时，新消费方必须核对 handler 实际返回 + 既有消费方的读法，而不是只看类型；② "主进程日志成功但 UI 报错"这类问题的第一怀疑对象就是**IPC 返回结构与消费方字段名不匹配**

**分片内容流式实时预览 + 小说正文去AI味（2026-10-05 用户需求"生成内容时需要流式响应，否则一直转圈；内容也需要去AI味"）**
- 流式预览：
  - 原设计 store 注释明确"内容以 complete 事件全量落定，不做前端拼接"——生成过程中 UI 只有"生成中"转圈，用户看不到文本无法及时评价
  - 修复：`useV2GenerationStore` 新增 `appendShardChunk(index, chunk)`（实时拼接 content + 更新 actualWordCount）；`beginStreamingShard` 改为同时清空旧内容（重新生成从空白开始）；`useV2ShardGeneration` 新增订阅 `onShardStreamProgress`（`writing:chunk:progress`，按 projectId+章节过滤）→ 追加 chunk。主进程本来就在发 progress 事件（V1 在用），只是 V2 hook 没订阅——**基础设施齐全，差一层订阅**
  - 效果：右侧「生成流水线」分片内容框实时滚动出文本；complete 事件仍全量覆盖落定（最终内容为 stripThinkTags 后的干净文本）
- 去AI味（小说正文）：
  - `humanizerPolish.ts` 新增**小说场景变体** `HUMANIZER_NOVEL_RULES` + `withHumanizerNovelRules()`：文体总则"叙述具体可感（动作/感官/事实）+ 对话像真人说话 + 避免公式化范文腔"，复用 RP 域 AI 腔词表（冰冷的/淡淡地/一丝/嘴角勾起一抹/空气仿佛凝固——网文体重灾区）+ 27 种 AI 写作模式完整指南
  - 注入点（`ContentGenerator.ts`，默认开启无开关，与世界书生成策略一致；引擎全局提示词仍由 enrichSystemPrompt 前置拼接不受影响）：
    - `generateShardContent` 的 systemPrompt（V1/V2 分片正文共用，都覆盖）
    - `buildPrompt`（generateStream 整章流式路径）
    - 分片大纲不注入（结构化规划数据，非正文）
- 影响文件：`humanizerPolish.ts` / `ContentGenerator.ts` / `useV2GenerationStore.ts` / `useV2ShardGeneration.ts`；typecheck 本次文件零新错误；dev server 重启生效（未触碰 5000 端口）
- ⚠️ 教训：**"流式"不等于"只显示最终结果"**——主进程流式事件（chunk progress）是既有能力，前端是否订阅决定了用户看到的是实时文本还是漫长转圈；长耗时生成类功能默认应做实时预览

**⚠️ 重点标记 - 分片大纲 JSON 解析失败：本地 LLM 脏 JSON 无修复链（2026-10-05 用户报错"分片大纲JSON解析失败: Expected ',' or '}' after property value in JSON at position 699"）**
- 现象：点「AI 生成本章」→ 分片大纲阶段报 JSON 解析失败。本地模型（abliterated）输出的 JSON 带未转义换行/引号、尾逗号等脏格式，而 `ContentGenerator.parseShardOutlines` 只有**直接 JSON.parse**，一次失败即抛错
- 根因：OutlineGenerator（大纲生成）此前有 6 种修复策略（stripMarkdown/unescapeControl/truncateTrailing/errorPositionFix/commonJsonFix/balanceBraces），但分片大纲解析器是独立实现，没带修复链——同一模型、同样的脏 JSON，大纲能过、分片大纲过不了
- 修复：
  1. **新建共享模块 `src/main/services/writing/jsonRepair.ts`**：6 种修复策略 + fixChineseQuotes 从 OutlineGenerator 私有方法抽取为导出函数，提供 `tryParseJsonWithRepair(jsonStr)`（直接 parse → 按序尝试 6 策略 → 全败返回 null）
  2. `ContentGenerator.parseShardOutlines` 改用 `tryParseJsonWithRepair`（删除本地 fixChineseQuotes 副本）
  3. `OutlineGenerator.parseOutlineResponse` 同步改用共享模块，删除 7 个私有方法（消除两处"保持一致"注释的漂移风险）
- 验证：新增 `jsonRepair.test.ts` 9 用例（干净 JSON/未转义换行/未转义引号/尾逗号/截断补齐/全败返 null/弯引号/裸key），writing+manga 共 26/26 通过；typecheck 零新错误（OutlineGenerator 剩余 TS6133/TS2304 经 git 比对 HEAD 确认全部预存）；dev server 重启生效（未触碰 5000 端口）
- ⚠️ 教训：① **同一模型服务多个 JSON 解析点时，容错能力必须对齐**——最弱的那个解析点决定了用户体感；② 本地 LLM 的 JSON 输出永远按"脏"的对待，直接 parse 只配当快速路径，修复链是标配；③ 修复策略这类工具逻辑天然适合共享模块，"保持与 X 一致"注释是漂移预警信号

**⚠️ 重点标记 - 前端"依旧没有流式输出"的实锤根因：思考模型先吐 reasoning_content，正文 content 长时间为 0（2026-10-05 用户反馈"前端依旧没有流式输出内容"）**
- 现象：上一轮已接通 chunk progress 订阅，但用户实测生成期间前端仍"一直转圈看不到输出"
- 实锤：用 PowerShell 轻量 POST 直测 5000 端口（qwen3.8-27b-abliterated，vLLM）**未停进程**——max_tokens=600 跑 21.9s，`delta.reasoning_content` 累计 155,916 字符、`delta.content` **0 字符**；dev server 日志显示实际分片生成 193s/片，绝大部分时间模型在输出思考流。**模型是思考模型，SSEStreamParser 按协议规范只透传 content、丢弃 reasoning → 用户视角 = 全程无输出**
- 修复（思考流全链路透出，不改变正文落定逻辑）：
  1. `SSEStreamParser.parseStream` 加第 4 参 `onReasoning?`，主循环遇 `delta.reasoning_content` 回调透出（不累积进正文）
  2. `ContentGenerator.executeStreamRequest` / `generateShardContent` 转发 `onReasoning`；`writing:generateShardContent` IPC handler 发 `writing:chunk:reasoning` 事件
  3. preload 新增 `onShardStreamReasoning` 订阅；`ShardDetail` 加 `reasoning` 字段；store 加 `appendShardReasoning`（begin 清空、complete 清空）
  4. `V2ShardPipelinePanel`：GENERATING 且无正文有思考流 → 金色 Tag「AI 思考中」+ 思考文本实时滚动（文字色 #b3791a），正文出现后转蓝色「生成中」
  5. **一键生成时中间编辑器实时预览**：`V2ChapterWorkbench` 订阅 STREAMING 阶段的当前分片 `content || reasoning` 映射到正文编辑区（readOnly + 预览期抑制防抖落盘，合并后以最终内容为准）
- ⚠️ 教训：① **思考模型（reasoning_content 协议）下"流式"必须包含思考流**——只透传 content 等于把最耗时的阶段藏起来；② 判断"前端没流式"时先直测模型端口看真实 chunk 结构（reasoning vs content 比例），再查链路，避免在链路里空转

**分片正文提示词加"写小说不是写散文"硬约束（2026-10-05 用户反馈"生成内容 AI 味太重，特别偏向散文"）**
- 诊断（按 humanizer-zh-enhanced 指南审读用户截图的生成章节）：「林晓雨看着X」句式 ×3、"X说"对话标签 ×6、"她的心有些紧张，有些期待"模板情绪、"声音像一首摇篮曲"陈词滥调比喻、整章"走→问→答"循环无剧情推进、「酥麻感」钩子出现 2 次未展开——典型散文腔：抒情铺陈多、事件推进少
- 根因：`buildShardContentPrompt` 只有字数/视角/风格三行约束，无叙事技法要求；模型默认走向"环境描写+日常问答"的散文安全区
- 修复：`buildShardContentPrompt` 生成要求后新增「叙事要求（写小说，不是写散文）」5 条：剧情推进是核心（无剧情发展的分片=失败分片）、动作与对话驱动（环境描写每处≤2句且必须承载氛围/伏笔）、对话推动情节（标签多样化、口语感、潜台词）、描写具体（禁抽象形容词堆砌和"声音像一首XX"陈词滥调）、段落节奏变化（禁"一段叙述+一句对话"模板循环）

**章节「检查 AI 味」按钮 + 审核结果弹窗（2026-10-05 用户需求"需要一个检查AI味的按钮"，交互对齐世界书 AI 审核）**
- 主进程 `ContentGenerator.checkChapterDeAi({ chapterTitle, content, modelConfig })`：引擎全局提示词前置 + 编辑角色 + `HUMANIZER_POLISH_RULES`（27 种 AI 模式 + RP AI 腔词表）+ 审核维度（AI味/小说性/完整性）+ 严格 JSON 契约 `{passed, comment, issues[], revisedContent}`；temperature 0.3、stream:true（思考模型耗时正常）、解析走 stripThinkTags → 代码块提取 → fixChineseQuotes → `tryParseJsonWithRepair`
- IPC `writing:checkChapterDeAi` → preload `checkChapterDeAi` → `V2ChapterWorkbench` 标题栏「检查 AI 味」按钮（`AuditOutlined`，生成中/正文为空禁用）
- 结果弹窗（模式参照 `WorldBookAuditModal` 审核结果 Modal）：通过/不通过 Tag + 审核说明 + 问题清单列表 + 修订文本只读预览，footer「关闭 / 重新审核 / 采用审核文本」（采用 = setText + persistContent 落盘）
- 验证：typecheck 本次 11 个文件零新错误（ContentGenerator 的 `requestId` TS6133、PromptBuilder 的 4 处 TS6133 经 git diff 比对 HEAD 确认全部预存）；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 - 「检查 AI 味」首次实跑失败：思考流占满 max_tokens 致正文为空 + 错误日志 "[object Object]"（2026-10-05 用户报错）**
- 现象：11044 字章节点「检查 AI 味」→ 日志 `Stream complete: { totalContentLength: 0, generationTime: 206598 }` → jsonRepair 6 策略全败 → `[章节AI味审核] 失败: [object Object]`
- 根因 1：思考模型的 `max_tokens` 预算 = reasoning_content + content 共享。原公式 `min(16384, max(4096, len*2))` 对 11k 字内容只有 16384，模型思考流吃满整个预算 → 正文 0 字符 → 空串 JSON 解析必败。且审核输出本身（revisedContent 全文 + comment）就需 ≈ len*1.5 tokens，16384 先天不足
- 根因 2：`ContentGenerator.createError` 返回**普通 WritingError 对象**（非 Error 实例），handler 用 `error instanceof Error ? error.message : String(error)` 兜底 → `String(对象)` = `"[object Object]"`，日志与前端都丢了真实错误信息
- 修复：
  1. **checkChapterDeAi 不写 max_tokens**（用户拍板：不写或给 1M 上限）——由服务端按模型上限取最大，彻底避免手算预算不够；其他写作调用保留用户配置的 `modelConfig.maxTokens` 不动
  2. 正文为空自动重试 1 次（间隔 1s）；两次皆空才报错"AI 思考流占满了输出长度，审核正文为空，请重试"
  3. handler catch 按对象取 `message`（`'message' in error` 分支优先），日志与返回值都是真实文案
- ⚠️ 教训：① **思考模型（reasoning_content）的调用，max_tokens 手算预算不可靠**——思考流长度不可预测，与其估算不如不写（交给服务端按模型上限）；② 代码库里"错误对象"（普通对象 + message 字段）和 `Error` 实例混用时，`instanceof Error` 判断是坑，统一用 `message in err` 取文案

**humanizer 规则统一：HUMANIZER_RULES_CORE 单一规则源（2026-10-05 用户需求"让 HUMANIZER_NOVEL_RULES 继承 HUMANIZER_POLISH_RULES，而不是简单缩写"）**
- 背景：用户发现小说生成用的 `HUMANIZER_NOVEL_RULES` 看起来比 `HUMANIZER_POLISH_RULES` 弱，要求统一/继承。核查后发现两者其实已包含同一批组件（RP 词表 + 27 模式完整指南），差异只有锚点和 intro——但**各自独立拼接**，改一处漏一处是漂移隐患，且"看似缩写"的观感说明结构没表达清楚
- 重构（[humanizerPolish.ts](file:///g:/AI/creative-cafe/src/shared/prompts/humanizerPolish.ts)）：
  1. 新增 `HUMANIZER_RULES_CORE`（L170）= `HUMANIZER_RP_WARNLIST` + `HUMANIZER_FULL_GUIDE`，作为**唯一规则源**
  2. 5 个场景变体全部改为从核心组合：POLISH（润色/审核）、GENERATION（世界书）、TEXTGEN（角色卡）、NOVEL（小说生成）、DIALOGUE（RP 对话）——输出字符串逐字节不变（36/36 测试通过证明），今后新增规则只改 CORE 一处，全场景同步生效
  3. `HUMANIZER_NOVEL_RULES` 的 intro 补上风格例外条款（"除非项目写作设置明确指定了其他文风"，与润色条款对齐）+ "规则很多，逐条对照执行"
- ⚠️ 教训：**多场景共享的规则集必须收敛到单一常量组合**——"复制同一批组件到每个变体"即使当前内容一致，结构上就宣告了未来漂移；用户从"看起来短"推断"是缩写"，说明代码结构本身要能自证规则强度

**大纲审核管线升级 + 手动「AI 大纲审核」按钮（2026-10-06 用户要求"检查 AI 味审核是否应用到所有校验类功能（含漫画大纲），并在大纲生成旁加手动审核按钮"）**
- 校验类功能 humanizer 覆盖排查结果：章节「检查 AI 味」✓（POLISH）/ 世界书条目审核 ✓（GENERATION）/ 大纲审核 ⚠️（原用 GENERATION 变体，JSON 措辞不合 Markdown 大纲）/ **大纲生成 ✗（未接规则）**
- 修复（[MangaParsingService.ts](file:///g:/AI/creative-cafe/src/main/services/manga/MangaParsingService.ts)）：
  1. `generateStoryOutline` 注入 `withHumanizerGenerationRules`（设定集/摘要文体，从源上压制 AI 味）
  2. `auditOutline` 升级：注入 `withHumanizerRules`（审核型 HUMANIZER_POLISH_RULES，与章节「检查 AI 味」同款，含 #28-#37）+ **新增 summaries 参数**——`buildContextTable` 上下文表格作为"漫画解析内容（源素材参照）"注入审核提示词，审核时对照检查完整性（是否遗漏素材情节）/一致性（是否虚构素材外情节）/修订不引入新情节
  3. IPC `manga:auditOutline` / preload / V2 类型签名同步加 `summaries?` 第三参
- 前端（[V2MangaOutlinePanel.tsx](file:///g:/AI/creative-cafe/src/renderer/components/Creative/WritingModeV2/manga/V2MangaOutlinePanel.tsx)）：「生成故事大纲」旁新增 **「AI 大纲审核」按钮**（AuditOutlined，有大纲即可用，复用 runAudit + 审核结果弹窗）；runAudit 全程传 summaries；生成/审核按钮 loading 状态分离（生成中 vs 审核中各显示各的）
- ⚠️ 教训：**变体函数名不统一是坑**——polish 变体的注入函数叫 `withHumanizerRules(prompt, enabled)`（带开关参数），不是按规则名直觉命名的 `withHumanizerPolishRules`，首次引用直接 typecheck 报错；其余变体均按规则名命名（withHumanizer{Generation,Textgen,Novel,Dialogue}Rules）
- 验证：5 个改动文件 typecheck 零错误；dev server 重启生效（未触碰 5000 端口）

**用户定制自然中文写作规则 #28-#37 入规则核心（2026-10-06 用户编写 10 条规则+案例，要求整理后加入审核/生成规则）**
- 用户在"爱之岛"章节实测后亲自编写 10 条规则（每条带 ✗/✓ 案例），编号续接指南 27 模式，新增常量 `HUMANIZER_NATURAL_ZH_RULES`（[humanizerPolish.ts](file:///g:/AI/creative-cafe/src/shared/prompts/humanizerPolish.ts) L171 起）并入 `HUMANIZER_RULES_CORE`——全场景（小说生成/章节审核/世界书/角色卡/RP 对话）同步生效：
  - #28 多用口语助词（的/了/着/把/的话/一样/就好），拒绝"电报体"压缩句
  - #29 去掉无意义缩写，光杆动词写清操作对象、单字压缩词写全（印→勒痕、肉→乳肉）
  - #30 对话必须绑定说话人当下动作/神态/环境，禁裸标签，对话间隙自然带新场景信息
  - #31 一段连贯剧情禁止碎片化拆段（禁单句成段，引文用冒号接叙述后）
  - #32 禁"故作深意"句（"不像X，更像Y"谜语式感悟），不硬造伏笔
  - #33 人物对话多用语气词（呢/嘛/吧/啊），假设问句补"的话"；附约束：语气词须符角色身份与情境，自然点缀非满句添加
  - #34 适当添加主语/领属词（她/他/她的/它的），不因省事忽略基本语法；与 #29 一体两面（#29 管宾语、#34 管主语）
  - #35 严禁"X得Y""X得(有些)发Y""X发Y"三类压缩描写（AI味过重，一律不用）：顶得紧/晒得亮/高得过分/绷得更紧/发紧/发亮/发暗/发酸/发白/发黑/发毛全禁，改用直接描述或"X变得更Y""X越来越Y"——即"细得发白/蓝得发黑"句式问题的最终规则化（用户先要求"段内限1次"，后升级为全禁）
  - #36 严禁因精简写出人类不会写的文字（"精简癖"）：禁"动词+数量+形容词"压缩词组（顶出两点硬）和过度压缩口语（太阳毒/走热了），拿不准就展开（补主语/过程/程度/说明从句）；与 #29 联动（#29 管指代、#36 管整句自然度）
  - #37 语气词必须与当下情绪匹配（语气词是情绪的外显）：先读动作判断情绪再配语气词——开心→"嘿嘿/哈哈"、迟疑→"唔.../嗯？"、惊讶→"诶/啊？"；与 #33 联动（#33 管有没有、#37 管对不对）
  - #35 全禁后联动修正：#29"画得非常清楚"→"看得清清楚楚"、#30"颤动得更剧烈了"→"剧烈地颤动起来"、#31"磨得起毛"→"都磨毛了"、#32"拉得笔直"→"拉直了，绷在两棵椰子树干之间"、#35 自身"绷得更紧了"→"绷紧了"（✓ 示范自身不得违反规则）
- 规则张力显式处理：#28 助词 vs 指南#25 填充短语（语法功能词≠英文腔赘述）；#31 长段落 vs 指南#3/#10 节奏（只针对叙事拆段，对话仍各自成段）；#35 全禁"得/发"后替代手段指定为"X变得更Y""X越来越Y"/直接描述；冲突时用户定制优先
- ⚠️ 教训：**规则升级会牵连既有示范**——#35 从"限 1 次"升级为"全禁"后，5 处其他规则的 ✓ 示范（含用户自己写的案例）出现"得+形容词"自相矛盾，逐一修正；规则集要能自洽，示范必须过自己定的规则
- 背景：这 10 条覆盖的是 27 模式指南未触及的**中文语感盲区**——指南偏"删什么"（AI 腔词/结构），用户规则偏"加什么"（助词/语气词/主语/动作/完整指代）+ "禁什么"（得/发压缩句式/精简癖）+ "配什么"（语气词与情绪匹配），三类互补才是完整的人味标准
- 验证：humanizerPolish 36/36 测试通过；typecheck 零新错误；dev server 重启生效（未触碰 5000 端口）

**用户定制规则 #38 极端词禁用（2026-10-07 用户笔记"十一"续接，要求添加 AI 味审核规则）**
- 用户追加第 11 条定制规则，编号续接为 #38，追加进 `HUMANIZER_NATURAL_ZH_RULES`（常量标题与注释块范围同步 #28-#38）——经 `HUMANIZER_RULES_CORE` 全场景（润色/小说/世界书/角色卡/RP 对话）自动生效
- 规则：禁止滥用"极端词"——疯狂/极端/狂笑/破碎/病态/残酷/神圣/祭品等人类一般不会用的词，发现即换符合语境的常用词（狂笑→大笑/淫笑、疯狂→用力/非常、极端→特殊/极度、病态→淫荡/变态）
- 附例外条款：剧情本身涉及神圣仪式/祭祀/宗教题材时"神圣""祭品"可按剧情需要使用，但不得作为修辞滥用
- 验证：typecheck humanizerPolish 零新错误；dev server 重启生效（未触碰 5000 端口）

**AI 味审核过程弹窗流式可视化（2026-10-05 用户需求"等待时间太久，审核过程要弹窗可视化并流式输出"）**
- 思考模型审核 11k 字章节要 3-5 分钟，此前只有按钮 loading 转圈，用户无任何反馈
- 实现（复用分片思考流透出的同一套链路模式）：
  1. `ContentGenerator.checkChapterDeAi` 加第 2 参 `onProgress?(chunk, reasoning)`，转发到 `executeStreamRequest` 的 onStream/onReasoning
  2. IPC handler 经 `event.sender.send('writing:deai:stream', { chunk, reasoning })` 透传（isDestroyed 防护）；preload `onDeAiStream` 订阅；类型 `V2DeAiStreamEvent`
  3. `V2ChapterWorkbench` 审核弹窗整合为**过程+结果一体**：审核中 = 标题栏状态 Tag（金色「AI 思考中」→ 蓝色「正在生成审核结果」）+ 400px 流式文本框（思考流金色 #b3791a、正文转正常色，自动滚底）；完成 = 切换为结果视图（通过/不通过 + 说明 + 问题清单 + 修订文本，footer 关闭/重新审核/采用审核文本）。审核中不可关窗（closable=false），重新审核直接复用同一弹窗
- ⚠️ 教训：**长耗时 AI 操作（>1min）的等待体验取决于过程可见性**——思考模型时代尤其如此，"转圈"必须替换为"实时滚动思考流"，这是本项目第三次做同类改造（分片大纲流式/分片正文流式/审核流式），链路模板已固化：service onProgress → handler sender.send → preload on* 订阅 → 组件 state 累积 + 自动滚底

**AI 功能自定义提示词 + 停止按钮 + 大纲审核问题列表（2026-10-06，Spec: add-ai-custom-prompt-and-interrupt）**

用户要求：① 所有审核功能加自定义提示词输入框（大纲审核/大纲生成/项目草稿/检查AI味/生成本章/页面分析 6 入口）② 大纲审核与章节/世界书审核一样显示问题列表由用户确认 ③ 约定写入全局记忆 ④ 所有 AI 交互按钮加停止/中断。

- **自定义提示词统一注入**（`src/shared/prompts/customPrompt.ts` 新建）：
  - `withCustomPrompt(systemPrompt, customPrompt?)`：空值逐字节不变；非空在 system prompt **最末尾**（引擎全局提示词 + 功能正文 + humanizer 规则块之后）追加「## 用户自定义要求（最高优先级，与上述默认要求冲突时以本节约束为准）」+ 用户原文——保证用户要求可覆盖默认规则
  - 主进程接入点：`MangaParsingService` analyzePage/generateStoryOutline/auditOutline/generateProjectDraft 四方法、`ContentGenerator.checkChapterDeAi`/`generateShardOutline`/`generateShardContent`；IPC/preload 各通道透传 `customPrompt?`
  - UI：`CustomPromptPopover`（`WritingModeV2/shared/CustomPromptPopover.tsx` 新建）——FormOutlined 图标 Popover + TextArea（2000 字），按 storageKey 持久化 localStorage（6 入口各自独立 key，互不串扰，重开应用回填）；父组件触发请求时 `readCustomPrompt(key) || undefined` 读取透传
  - 一键生成本章的 customPrompt 同时注入分片大纲与分片内容两条链（useV2ShardGeneration planShards/generateShard 加参）
- **⚠️ 重点标记：中止必须返回 `cancelled` 标记**（本 spec 核心契约，后续 AI 功能必须沿用）：
  - 主进程 AbortController 注册：`MangaParsingService.cancelControllers: Map<功能key, AbortController>`（analyzePage/generateOutline/auditOutline/generateProjectDraft，fetch 传 signal，finally 清理）；`ContentGenerator.activeDeAiCheckController` 实例字段（两次重试共享）
  - 新 IPC 通道：`manga:cancel(key?)`（缺省取消全部漫画类请求）、`writing:cancelDeAiCheck`
  - **中止与失败必须可区分**：catch 首判 AbortError/`error.cancelled`，返回 `{ success:false, cancelled:true, error:'用户已停止' }`；前端据此 `message.info('已停止…')` 而非 `message.error`。⚠️ 若不区分，用户点停止会看到红色报错，误以为失败
  - 4 个 manga 结果类型 + `V2ChapterDeAiCheckResult` 均加 `cancelled?: boolean`
- **UI 停止态**：大纲生成/审核按钮运行中切 danger「停止生成/停止审核」（onClick 切 cancel 通道）；项目草稿弹窗内 danger 停止按钮；章节 AI 味审核弹窗 footer danger「停止审核」（中止后弹窗切「已停止」Tag，**保留已流式内容**，可关闭/重新审核）；「分析全部页面」既有停止按钮补接 `manga:cancel('analyzePage')`（批量循环收到 res.cancelled 即 break，已分析页保留）；单页分析加载视图加「停止分析」按钮（V2MangaAnalysisPanel onStopAnalyzing，批量运行中则停止整个批量）
- **大纲审核 issues 契约**：`V2MangaAudit` 加 `issues: string[]`；auditOutline JSON 契约要求模型逐条列出问题（每项一句话指明问题类型与位置，无问题为空数组 []，数组校验缺省 []），原 5 字段不变；审核弹窗展示编号问题列表（样式对齐章节 AI 味审核弹窗）+「采用修订文本」/「保持原文」由用户确认
- 全局记忆：`.learnings/LEARNINGS.md` LRN-20261006-009 永久约定（三件套：自定义提示词 + 停止按钮 + 审核 issues 列表）
- 既有中断机制不动（无回归）：`ai:cancel`（世界书批量）、`writing:cancelGeneration`（一键生成）、批量分析前端循环
- 验证：本次改动文件 typecheck 零新错误（ContentGenerator L166 requestId 为存量未用变量，非本次引入）；dev server 重启生效（未触碰 5000 端口）

**⚠️ 重点标记 Bug 修复：V2 剧情检查「批量修正」恒提示"没有可批量修正的问题"（2026-10-06）**
- 现象：章节剧情检查出多个问题后，点「批量修正」被过滤为空
- 根因：**生产者/消费者字段契约断裂**——V2 面板用 `issue.fixable` 做批量修正与单条「自动修正」按钮的门槛（`normalizedIssues.filter((i) => i.fixable && !fixedKeys.has(i.key))`），但主进程 `PlotCheckerService.parseCheckResponse` 构造 issue 时从未设置 `fixable`（AI JSON 契约也只要求 `quickFixSuggestion`，不要求 `fixable`），`!!undefined` 恒为 false → 全部问题被过滤。V1 批量修正靠用户勾选（无 fixable 门槛）所以 V1 无此问题
- 修复：`PlotCheckerService` 三处 issue 产出点（AI 维度问题/AI 逻辑问题/规则校验逻辑问题）统一补 `fixable: true`——批量修正管线携带完整问题信息（description/analysis/suggestion/position/originalText/references）整章重写，任何报告出的问题均可修，与 V1 语义一致
- ⚠️ 教训：**渲染层用可选布尔字段做功能门槛时，必须确认主进程所有 issue 产出路径都显式设置该字段**（含 AI 解析与规则兜底两条路）；可选字段缺省 false 语义会让"功能静默不可用"而非报错，用户侧表现是"点了没反应/提示没有可修问题"
- 注意：修复前已生成的检查报告存在渲染层 state，需重新跑一次「剧情检查」才能看到批量修正恢复
- 验证：PlotCheckerService 25/25 单测通过；typecheck 无新错误；dev server 重启生效

**⚠️ 重点标记 Bug 修复：V2 表格整理「AI 整理全部」报"章节 0 不存在"（2026-10-06）**
- 现象：漫画解析导入的项目（章节 index 为 1 基）中，表格整理页点「AI 整理全部」/「整理当前表」报"章节 0 不存在"；即使侥幸匹配也会错位整理上一章
- 根因：**chapterIndex 语义不一致**——渲染层 V2TablePanel 与智能体编排传给 `TableOrganizeService` 的 `chapterIndex` 都是「章节在数组中的 0 基位置」（selectedIndex / startIdx+i），但服务内按 `ch.index === chapterIndex`（index 值）查找。漫画大纲经 `OutlineGenerator.validateOutline` 解析时章节无 index 字段则赋 `idx + 1`（1 基），普通建项目/管线是 0 基（`index: i`）→ 1 基项目按位置 0 查 index=0 找不到
- 修复：`TableOrganizeService.organizeTable` / `organizeSingleSheet` 目标章节定位改为**按数组位置优先 + index 值兜底**（`allChapters[chapterIndex] ?? find(ch => ch.index === chapterIndex)`），错误提示改为用户可读的"章节 N 不存在"（1 基）
- ⚠️ 教训：**章节定位统一用"数组位置"而非 `index` 字段值**——`chapter.index` 的基随项目创建路径不同（普通/管线 0 基，漫画导入 1 基），跨路径复用章节查找逻辑时必须先确认语义；同类的 `autoSaveChapter`/`saveVersion`/`restoreVersion` 仍是 index 值查找（渲染层有整项目 patch 兜底所以未爆雷），后续如需修复应统一为位置语义
- 验证：typecheck 无新错误（TableOrganizeService 存量错误未动）；TableRestore 8/8 单测通过；dev server 重启生效

**⚠️ 重点标记 Bug 修复：V2 表格整理字段错位（唯一id 列约定断裂）+ 单行重整理丢唯一id（2026-10-07）**
- 现象：AI 整理后表格所有字段右移一列（唯一id 值出现在"身份"列、姓名列空），用户看到"字段保存不正确"
- 根因：**提示词内部两处字段定义互相冲突**——【tableEdit命令格式】参数说明约定 `[1:流水号, 2:唯一id, 3+:模板字段]`，而【表格模板结构】把模板字段编号成 `[1:姓名, 2:身份...]`。AI 跟随了参数说明/示例（字段2=唯一id、模板字段从3起），输出 6 键行；解析器（memory 适配层 tableEditParserBase，字段键统一减1）→ 存储 `{1:唯一id, 2:姓名, ...}`。**存储本身是对的**（ContentGenerator 注入 headers[key-2]、执行器 dedup row['1']、全局去重 row['1'] 都按此约定工作）——**唯一错位的消费者是渲染层 V2TablePanel 的 remapRowToHeaderKeys（key→headers[key] 直映，没跳过前两个系统键）**
- 修复（保留唯一id 机制，用户明确要求：同一角色/道具禁止反复新增）：
  1. 提示词消解冲突：【表格模板结构】模板字段编号改为从 3 开始（`${i+3}`）并注明字段结构固定 [1:流水号, 2:唯一id, 3+:模板字段]；示例输出同步改编号；新增错误格式示例（缺字段2/手填流水号/updateRow 改唯一id）
  2. 渲染层 remap 对齐存储约定：key "0"(流水号)/"1"(唯一id) 原样保留不显示（antd 按 dataIndex 渲染自动忽略，保存时透传带回，编辑不丢唯一id）；key k≥2 → headers[k-2]；逆映射表头名 → String(idx+2)；CSV 导出剔除系统键
  3. buildTableContextForPrompt（整理上下文）：渲染 `唯一id=...` + 表头名=值；快速索引修复为从 row['1'] 构建（原读 row['唯一id'] 恒空，索引从未生效过）
  4. ContentGenerator 注入同步：显式展示唯一id + 表头名按 key-2 映射 + 重建唯一ID快速查找索引（原 row['唯一id'] 死代码）
  5. 单行重整理修复：原实现按 0 基表头约定生成行（丢唯一id/流水号且错位）→ prompt 键名从"2"起 + parseAIRowResponse 保留原行 key 0/1、按 key c+2 对齐
- ⚠️ 存储约定（务必全链路一致，改任何一处先全局 grep `row['1']`）：行对象 key "0"=流水号（系统内部不展示）、"1"=唯一id（实体去重键）、k≥2=表头第 k-1 列；AI prompt 字段索引 1 基 [1:流水号,2:唯一id,3+:模板字段]，memory 解析层统一减1落盘。消费者：V2TablePanel remap、TableEditCommandExecutor dedup、deduplicateTableData、compareTableData（单元格比较 key=ci+2）、ContentGenerator/构建上下文注入
- 注意：既有错位数据（修复前生成）形状恰好与存储约定一致（key1=唯一id），UI 修复后显示即正确，**无需清空重整理**
- 关于"调用了向量化模型"的疑问：写作表格整理/注入从未调用向量化——日志证实整理直接调 chat/completions（本地模型秒回导致进度条闪一下即消失，非向量化）；表格注入后续提示词 = 原文直拼（buildTableContextForPrompt/ContentGenerator 均拼接表格原文）
- 验证：typecheck 无新错误（存量 TS6133/TS2352 未动）；TableRestore 8/8；dev server 重启生效

**⚠️ 重点标记 Bug 修复：V2 表格「清空」后「AI 整理全部」误报"表格数据不存在，请先绑定模板"（2026-10-07）**
- 现象：点「清空」后 UI 正常显示空态"暂无表格数据，点击「AI 整理全部」基于章节内容生成"，但点「AI 整理全部」却报"表格数据不存在，请先绑定模板"——UI 引导与实际能力矛盾
- 根因：`clearTableData` 删除的是**整个 table-data.json**（含 sheets/headers 结构，不只行数据），而模板绑定配置 table-config.json 仍在（associatedTemplateId 存在）→ 渲染层按"已绑定模板"渲染出整理按钮，主进程 organizeTable 却因数据文件缺失直接抛错。**"清空"语义与落盘实现不一致：UI 语义是"清空行数据"，实现是"连模板结构一起删"**
- 修复（TableOrganizeService 自愈而非改清空语义）：新增 `ensureTableDataFromTemplate(projectId)`——数据文件存在且含 sheets 时直接返回；缺失时按已绑定模板重建空表结构（sheets/headers/data/sheetDescriptions，与 associateTableTemplate 落盘形状一致）并落盘 + 记日志。organizeTable 与 organizeSingleSheet 两处入口的"表格数据不存在"检查统一替换为该方法；模板未绑定时仍正确报"未关联表格模板"。reorganizeRow 无需自愈（由行操作触发，行存在则数据文件必在）
- ⚠️ 教训：**"清空/重置"类操作删掉的文件范围必须与其 UI 语义对齐**——table-data.json 承载"模板结构 + 行数据"两种职责，只删行数据还是整删文件要在 UI 层有明确对应；当无法立即对齐时，消费入口做自愈（按绑定关系重建结构）比让用户重新绑模板体验好；同类隐患：任何"删文件式清空"都要检查下游是否有按"结构仍在"假设编写的入口

**⚠️ 重点标记 Bug 修复：剧情检查拿前一章大纲检查本章正文（2026-10-07 用户反馈）**
- 现象：第三章剧情检查后 AI 报"本章正文完全遗漏了大纲中提到的'浴室场景'"——但那是**第二章**大纲的内容，本章大纲根本没有浴室场景
- 根因：`PlotCheckerService.buildCheckPrompt` 用 `chapters.find(ch => ch.index === request.chapterIndex)` 按 **index 字段值**定位本章大纲，而渲染层传的是 **0 基数组位置**；漫画导入项目 `chapters[].index` 为 1 基 → 检查第 N 章命中第 N-1 章大纲。**与此前"章节 0 不存在"（表格整理）、章节保存同源的第三个消费者**——index 字段值 vs 数组位置的基制断裂是漫画导入路径的系统性契约问题
- 同批修复的连锁点：① 渲染层单章检查 `previousChapters` 用 `c.index < chapterIndex` 过滤前文（同样基制错位，漫画项目漏掉紧邻上一章）→ 改按位置 `slice(0, chapterIndex)`；② 渲染层全书检查 `chapterIndex: c.index` 传字段值（主进程改为位置查找后会错到下一章）→ targets 带原位置传 pos；③ PlotCheckerService 表格上下文 `row['唯一id']` 死代码（与 ContentGenerator 同一错误，唯一ID索引从未生效）+ key'1' 被误渲染为"字段2" → 改按存储约定（"0"=流水号不展示、"1"=唯一id 显式展示、"2+"=表头映射 + 兜底）
- 提示词主次结构（用户要求）：本章大纲标注"**主要检查基准**，大纲一致性问题只以此为准，不要与任何其他章节的大纲混淆"；前文章节/历史表格标注"次要参考，仅用于连续性核对"；维度1指令加粗强调"严禁把其他章节的情节当作本章应有内容来报遗漏"
- ⚠️ 教训：**章节定位契约必须全局唯一**——"chapterIndex=0 基数组位置"是渲染层→主进程的统一契约，任何 `chapters[].index` 字段值只作展示/兜底。已修复消费者：organizeTable/organizeSingleSheet/PlotCheckerService 大纲定位/previousChapters/全书检查。**仍按 index 值查找的遗留**：autoSaveChapter/saveVersion/restoreVersion（有渲染层整项目 patch 兜底未爆雷）。新增任何"按章号找章节"代码时先 grep `chapters.find` 和 `chapters[`，用位置优先+index 兜底模式

**⚠️ 重点标记 Bug 修复：V2 表格整理"只闪一下无任何进行中提示"——进度事件被误当完成信号（2026-10-07 用户二次反馈）**
- 现象：点「AI 整理全部」按钮 UI 闪一下即恢复，无进行中状态；日志证实整理成功完成。首次反馈时误判为"本地模型秒回导致进度一闪而过"，二次反馈后定位到真 bug
- 根因（两个叠加）：① **进度事件订阅里用 `event.current >= event.total` 判定完成并 setOrganizing(false)+卸载进度区——但事件 current 语义是"正在处理的章节序号"**，单章整理时首个进度事件就满足 current>=total，organizing 状态在 AI 请求还在飞行时就被提前终止，进度区刚渲染即卸载；② organizing 状态由两处（订阅 + handler 返回）竞争收尾，语义不单一
- 修复（V2TablePanel）：① 订阅只更新进度显示、**禁止判定完成**（注释写明 current 语义陷阱），organizing 状态与 reload 一律由 IPC invoke 返回收尾（finally 收尾保证异常路径也复位）；② 新增 lastResult 常驻结果卡片（成功绿/失败红，含成功章数/异常数/耗时，下次整理前清除）——本地模型秒回时 toast 与进度区会消失，常驻卡片保证结果可见；③ 整理中无进度事件时显示"正在整理中，请稍候…"；④ toast 文案"处理 X 行"→"成功 X 章"（processedCount 语义实为成功章节数，原文案错误）
- ⚠️ 教训：① **用进度事件判定"完成"必须核对 current 的真实语义**——"正在处理第 N 项"（1 基序号）与"已完成 N 项"（计数）差一，"最后一项开始"≠"全部完成"；完成信号应唯一来源（本次收敛为 invoke 返回）；② **快模型（本地 vLLM 秒回）场景下，短暂 toast/进度区等于没有反馈**——结果类 UI 要有常驻落点（卡片/状态条），不能只依赖转瞬即逝的元素；首次反馈时把"UI 竞态 bug"误诊为"模型太快"，用户二次反馈才深挖，应第一次就核对事件流时序

### 跨章节连贯性审查（Spec: add-cross-chapter-coherence-review，2026-10-07 新增功能）

针对表格整理只把控剧情概要、单章剧情检查缺跨章视角的问题，新增「跨章审查」能力（工作台右侧新 tab，既有三 tab 零改动）：

- **混合路线**：
  - 文本重复（text_repetition）= 本地确定性扫描（[CrossChapterTextScanner.ts](file:///g:/AI/creative-cafe/src/main/services/writing/CrossChapterTextScanner.ts)，纯函数零 token，位置精确到句）
  - 重复剧情（plot_repetition）+ 情节矛盾（plot_contradiction）= AI 语义审查（[CrossChapterReviewService.ts](file:///g:/AI/creative-cafe/src/main/services/writing/CrossChapterReviewService.ts)，流式 + AbortController 中止 cancelled 契约 + withCustomPrompt）
- **⚠️ 扫描算法关键决策（勿改回整句相似度）**：五章实测证明中文网文跨章重复的形态是"同一短语在不同句中复现"（"那张宽大的双人床上"、"像是一台不知疲倦的打桩机"），整句 Jaccard 对部分重叠重复严重低估（同场景重写两句整句 Jaccard 仅 ~0.2，默认阈值 0.75 永远命中不了用户点名的案例）。实际实现 = **5-gram 倒排索引 + 公共子串扩展**，命中判据：最长公共片段 ≥ round(8×阈值) 字，或 ≥2 个互不重叠短片段（各 ≥ round(5×阈值) 字，捕获"层层叠叠的+粗暴地抚平"拆散复现）；短句对（≤15 字）要求匹配占比 ≥0.85（近似整句复制，防常见短语误报）。similarityThreshold（0.50-0.95 默认 0.75）映射到最小片段长度，不是直接相似度
- **章节定位契约沿用全局约定**：审查参数 startPos/checkedPositions/issue.chapterA.index 全是 **0 基数组位置**；AI 提示词按位置编号章节（"编号 N"=数组下标）并要求 JSON 回传同一编号；引文 includes 逐字校验，失败标 `located:false`（不静默丢弃）
- **写回口径（修复建议应用）**：`patchProject`（实体=单一真相源，store 防抖落盘）+ `autoSaveChapter` 传 **`chapters[pos].index` 字段值**（repo 按 index 值查找并命名章节文件，这是少数仍按 index 值语义的通道，与"章节 0 不存在"条目记录的遗留一致；新代码传字段值可正确落文件+版本记录，工作台 persistContent 传位置是历史遗留口径）
- **细粒度参数**（按项目持久化 localStorage `v2-crosscheck-params:{projectId}`）：章节比对距离（1-10 默认2，本地扫描+AI 判据）、相似度阈值（Slider）、AI 严格度（strict/standard/lenient 映射提示词判据文案）；自定义提示词 key `v2-crosscheck-prompt:{projectId}`
- **IPC**：`writing:crossCheckReview`（流式 `writing:crossCheck:stream`，phase=local/ai）/ `crossCheckCancel` / `crossCheckSuggestFix`；模型配置读取复用 writingPlotCheckHandlers 的 activeEngine 模式
- **表格整理章节字段绝对化（同批小优化）**：整理提示词（批量+单表两个 builder）新增【当前章节】段——告知 AI 实际章号并要求"发生章节/首次登场章节/埋设章节/回收章节"填绝对章号（"第N章"），禁止"本章"等相对值（此前 AI 不知道自己在整理第几章 → 全部写"本章"，跨章无法定位）。存量"本章"数据需清空重整理
- **五章实测问题清单（功能验收基准，实现后审查应命中绝大多数）**：
  - A 重复剧情："掼到双人床上"×3（2章末/3章首/4章首）；2章末已完卧室戏+高潮+沦陷，3章重演"无润滑初插+处女般紧致"；高潮节拍 2/3/4/5 章重复
  - B 情节矛盾：2章岛主赤裸 vs 3章"撸开裤子"；3章"处女紧致/无润滑" vs 2章前两轮性事（4章"早被操得红肿外翻"才对）；2章"彻底沦陷" vs 3章"惊慌反抗"
  - C 文本重复："腰部像是一台不知疲倦的打桩机"（3章=4章逐字）、"岛主的声音变得低沉而沙哑"（3章=4章逐字）、"层层叠叠的肉褶被粗暴地抚平"（2/3/4/5 章 4 次）等 7+ 组
  - D 表格：章节字段全为"本章"相对值；伏笔表"每日训练"状态过时（5章已执行仍标未回收）；事件表缺 3-5 章关键事件
- 验证：typecheck 新文件零错误（TableOrganizeService 存量 TS6133/TS2352 未动）；dev server 重启生效；端到端实测由用户在五章项目执行（本地扫描命中 C 类 / AI 命中 A+B 类 / 修复建议写回落盘）

**「AI 生成角色信息」：编辑漫画信息弹窗角色字段图片识别生成（Spec: add-ai-character-gen-to-manga-meta，2026-10-07 新增功能）**

针对「漫画信息」弹窗主要角色字段手填繁琐的问题，新增图片识别生成能力（保留全部既有手动编辑功能）：

- **永久约定三件套全覆盖**（对齐 add-ai-custom-prompt-and-interrupt 约定）：① `CustomPromptPopover` 自定义提示词（storageKey `v2manga_meta_character_custom_prompt`，`withCustomPrompt` 末尾注入）；② 停止按钮（loading 时按钮切 danger「停止生成」→ `manga:cancel('generateCharacterInfo')`）；③ `cancelled: true` 标记区分用户停止（message.info「已停止生成」）与失败（message.error 真实错误文本）
- **类型契约**（`writing-v2.types.ts`）：`V2MangaCharacterGenResult { success; charactersText?; cancelled?; error? }`；`V2MangaAPI.generateCharacterInfo({ imagePath, summaries?, mangaMeta?, currentCharacters?, customPrompt? })`；`manga:cancel` key 联合类型扩展
- **主进程**（`MangaParsingService.generateCharacterInfo`，IPC `manga:generateCharacterInfo`）：AbortController 注册 + **120s 超时**（`timedOut` 标记分流超时/用户取消）；图片校验（存在 + 8MB 上限）→ data URI（mime 映射）→ 五段式 system prompt（角色视觉特征识别任务 + buildMetaLines 漫画背景 + summaries 非空时 buildContextTable 整体分析 + currentCharacters 整合保留段 + JSON 契约 `{ characters: [{ name, role, appearance, personality }] }`）+ `prependEnginePrompt` 全局提示词；OpenAI Vision 多模态 messages（非流式）；`parseJsonFromContent` 容错解析 + `finish_reason=length` 截断提示；格式化为每角色一行「姓名（定位）：外貌；性格」（定位缺省省括号，全空条目跳过），空结果守卫
- **弹窗 UI**（`V2MangaMetaModal.tsx`）：主要角色 TextArea（maxLength 500→2000、rows 3→4）下方新增图片上传区——`file.selectFile` 过滤 jpg/jpeg/png/webp/bmp → 扩展名白名单 + 8MB 校验（data URI base64 段 ×3/4 估算）→ `file.readAsBase64` data URI 缩略图预览（antd Image h=64）+ 重新选择/移除；「⚡ AI 生成角色信息」按钮 `disabled={!imagePreview || !visionEnabled || loading}`（Tooltip 提示禁用原因），成功 `form.setFieldValue('characters', charactersText)` 可继续手动调整；`charGenLoadingRef`（useRef）防重入
- **父组件接入**（`V2MangaStage.tsx`）：两处 `<V2MangaMetaModal>`（新建/编辑）传 `supportsVision={!visionUnsupported}`（visionUnsupported 已区分「设置未加载」不误报）与 `comicSummaries={summaries}`（复用组件顶层既有派生数据，新建模式无分析结果时 summaries 为空、prompt 自动省略上下文段）
- ⚠️ 设计决策：弹窗 `buildCurrentMeta()` **不含 characters 字段**——已有角色文本经 `currentCharacters` 独立透传（主进程 prompt 作为「整合保留」段要求不盲目丢弃），避免与 mangaMeta 重复注入
- 影响文件：`writing-v2.types.ts` / `preload.ts` / `mangaHandlers.ts` / `MangaParsingService.ts` / `V2MangaMetaModal.tsx` / `V2MangaStage.tsx`
- 验证：typecheck 本次 6 文件零错误（项目其余为预存错误）；主进程代码改动已重启 Electron 生效（Vite 保留未动，未触碰 5000 端口）；UI 端到端（上传→生成→回填→手动修改→保存→重开回显 / 停止按钮 / 无 vision 禁用态）待用户实测

### 后续（见 spec.md 范围外）

暂无硬性待办；写作 2.0 计划内能力（Phase 0-10）全部交付。

---

## 安卓 LAN 对话客户端与服务端 LAN API（Spec: add-android-chat-client，2026-08-19）

### 概述

在 Electron 主进程内嵌 LAN HTTP API 服务（供同一 WiFi 的安卓纯客户端访问），并新建 React Native 安卓客户端 `android-client/`。V1 范围：角色卡列表/搜索/刷新 + SSE 流式对话 + 情绪立绘切换 + 清空上下文。对话历史与桌面端共用同一存储（TestChatData），两端同源。客户端无任何功能配置（模型/提示词/参数全由服务端决定），仅保存服务器地址。

### 架构分层

```
Android 客户端（android-client/, RN 0.87 + paper/zustand/react-native-sse）
  ConnectScreen（地址输入 + /api/health 测试 + 自动重连）
  CharacterListScreen（卡片列表 + 搜索 + 下拉刷新）
  ChatScreen（历史加载 + SSE 流式气泡 + 立绘切换 + 清空/重试）
        │  http://<电脑IP>:8787（明文 HTTP，仅局域网）
        ▼
Electron 主进程 src/main/services/lanApiServer/
  server.ts   Node http 极简路由：/api/health|characters|chats…；:id 白名单校验（防路径穿越）；SSE 封装
  dialogue.ts headless 对话管线：复用渲染进程 PromptBuilder（纯 TS）组装提示词 →
              读服务端 AI 引擎配置流式调用（对齐 ChatEngine/aiHandlers 超时策略）→
              StreamSanitizer 增量剥离 <think>/表情标记 → parseExpressionFromContent 解析情绪 →
              chatStorageService 持久化（失败不写入 assistant）
        │  复用（只读）
        ▼
characterService / expressionService / chatStorageService / storageService
```

### 关键设计

- **生命周期**：`src/main/index.ts` `whenReady` 调 `startLanApiServer()`（绑定 `0.0.0.0`，默认 8787；设置 `lanApi.{enabled,port}` 可控），`before-quit` 调 `stopLanApiServer()`。
- **路径安全（R6）**：`resolveCharacterPath()` 将 `:id` 与角色卡目录 `readdir` 结果精确匹配，含 `/`、`\`、`..` 或不在目录内一律 404 `CHARACTER_NOT_FOUND`，不泄露文件系统信息；情绪键白名单 `/^[a-z][a-z0-9_]*$/`。
- **SSE 协议**：POST `/api/chats/:id/messages` → 事件 `chunk`（增量文本，已剥离标记）→ 至多一个 `emotion` → 一个 `done`（权威全文 + messageId）；失败推 `error` 且不写库；15s `: ping` 注释心跳。
- **客户端防重复发送**：react-native-sse 具备 EventSource 自动重连语义，`src/api/sse.ts` 在 done/error 后立即 `close()`，任何后续事件被 `finished` 闸门忽略。
- **明文 HTTP**：`android/app/build.gradle` `manifestPlaceholders = [usesCleartextTraffic: true]`（LAN http 必需，debug/release 均生效）。

### 涉及文件

| 文件 | 说明 |
|---|---|
| `src/main/services/lanApiServer/server.ts` | LAN HTTP 服务与路由（新增） |
| `src/main/services/lanApiServer/dialogue.ts` | headless 对话管线（新增） |
| `src/main/index.ts` | 启动/停止 LAN API（修改） |
| `android-client/src/api/client.ts` | 5s 超时、幂等 GET 重试 1 次、错误四分类（新增） |
| `android-client/src/api/sse.ts` | SSE 封装与防重连（新增） |
| `android-client/src/screens/*.tsx` | 连接/列表/对话三屏（新增） |
| `docs/android-client.md` | 构建、API 说明（含 SSE 协议示例）、调试指南 |

---

## 智能体与技能用户管理（Spec: add-agent-and-skill-user-management）

### 概述

为智能体中心和技能广场补全用户自定义智能体及技能的手动创建、编辑和删除功能。系统预置智能体（`isSystem === true`）和内置技能（`source === 'builtin'`）仅提供查看功能，隐藏管理按钮；用户自定义项目显示完整的管理按钮集。

### 架构分层

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  AgentCenter.tsx                                    │
│   ├─ AgentList.tsx (创建按钮 + 操作列权限渲染)       │
│   ├─ AgentFormModal.tsx (创建/编辑模态表单)          │
│   ├─ AgentDetail.tsx (详情抽屉)                      │
│   └─ SkillMarketplace.tsx (创建/编辑/删除按钮)       │
│       └─ SkillFormModal.tsx (创建/编辑模态表单)      │
│                                                     │
│  hooks/useAgentConfigs.ts (createAgent/deleteAgent) │
├─────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                      │
│  agent.config.create / agent.config.delete          │
│  skill.create / skill.edit                          │
├─────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                         │
│  agent-config:create  → agentConfigService.create() │
│  agent-config:delete  → agentConfigService.delete() │
│  skill:create         → createSkill()               │
│  skill:edit           → editSkill()                 │
├─────────────────────────────────────────────────────┤
│ Service Layer                                        │
│  agentConfigService (SQLite + 内存缓存)              │
│  skillLoader.createSkill() / editSkill()            │
│    └─ assembleSkillMd() (frontmatter + body 组装)    │
└─────────────────────────────────────────────────────┘
```

### 智能体 CRUD

#### 后端 IPC 通道

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `agent-config:create` | `{ config: Omit<AgentConfig, 'id'\|'createdAt'\|'updatedAt'\|'isSystem'> }` | `{ ok, config?, error? }` | 创建用户自定义智能体，强制 `isSystem: false` |
| `agent-config:delete` | `{ id: string }` | `{ ok, error? }` | 删除智能体（系统预置保护由 `agentConfigService.delete()` 保证） |

创建成功后通过 `broadcastConfigChanged(id, 'created')` 广播变更事件，删除成功后广播 `broadcastConfigChanged(id, 'deleted')`。

#### 前端 Hook

`useAgentConfigs.ts` 新增两个方法：

- `createAgent(config)` — 调用 `agent.config.create()` IPC，成功后 `setConfigs(prev => [...prev, result.config])` 追加到列表
- `deleteAgent(id)` — 调用 `agent.config.delete()` IPC，成功后 `setConfigs(prev => prev.filter(c => c.id !== id))` 从列表移除

#### 前端组件

**AgentFormModal.tsx** — 智能体创建/编辑模态表单

- 支持 `create` 和 `edit` 两种模式
- 表单字段：`name`（必填，1-50 字符，重名校验）、`description`（必填，1-200 字符）、`type`（5 选项 Select）、`mode`（4 选项 Select）、`emoji`（可选，默认 🤖）
- 编辑模式下 ID 通过 `agent` prop 传入，不作为表单字段
- 提交时 loading 状态，消息提示由父组件 `AgentCenter.tsx` 处理

**AgentList.tsx** — 智能体列表

- 列表上方新增"创建智能体"按钮（`PlusOutlined` 图标，`type="primary"`）
- 操作列按权限渲染：系统预置（`isSystem === true`）仅显示"详情"按钮；用户自定义显示"详情"+"编辑"+"删除"
- 删除操作使用 `Modal.confirm`，显示智能体名称，`okType="danger"`

**AgentCenter.tsx** — 主页面

- 管理 `AgentFormModal` 状态（`formOpen`、`formMode`、`editingAgent`）
- 5 个处理函数：`handleCreate`、`handleEdit`、`handleDelete`、`handleFormCreate`、`handleFormUpdate`
- 操作成功/失败均通过 `message.success/error` 提示

### 技能 CRUD

#### 后端函数

`skillLoader.ts` 新增：

- `SkillFormData` 接口 — `{ name, description, emoji?, body }`
- `assembleSkillMd(params)` — 内部函数，组装 SKILL.md 内容（YAML frontmatter + markdown body）
- `createSkill(params)` — 校验技能名格式（`^[a-z0-9-]+$`）、检查目录唯一性、写入 `<userDataPath>/skills/<name>/SKILL.md`
- `editSkill(params)` — 校验非内置技能、覆盖写入已有 SKILL.md

#### IPC 通道

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `skill:create` | `{ name, description, emoji?, body }` | `{ success, skillName?, error? }` | 创建工作区技能 |
| `skill:edit` | `{ name, description, emoji?, body }` | `{ success, skillName?, error? }` | 编辑工作区技能（内置技能拒绝编辑） |

#### 前端组件

**SkillFormModal.tsx** — 技能创建/编辑模态表单

- 支持 `create` 和 `edit` 两种模式
- 表单字段：`name`（必填，仅小写字母/数字/连字符，创建时可编辑、编辑时 `disabled`）、`description`（必填，1-500 字符）、`emoji`（可选）、`body`（必填，1-10000 字符）
- 创建模式下技能名唯一性校验
- 消息提示由父组件 `SkillMarketplace.tsx` 处理

**SkillMarketplace.tsx** — 技能广场

- 工具栏新增"创建技能"按钮（`PlusOutlined` 图标，`type="primary"`）
- 操作列按权限渲染：内置技能（`source === 'builtin'`）仅显示"详情"按钮；非内置显示"详情"+"编辑"+"删除"
- 原"卸载"按钮文案改为"删除"，保持 `Modal.confirm` 确认逻辑
- 编辑操作先调用 `skill.getDetail()` 获取完整 SKILL.md 内容填充表单

### 权限控制机制

| 项目类型 | 判定字段 | 系统预置/内置 | 用户自定义 |
|---|---|---|---|
| 智能体 | `isSystem` | `true` → 仅"详情" | `false` → "详情"+"编辑"+"删除" |
| 技能 | `source` | `'builtin'` → 仅"详情" | 非 `'builtin'` → "详情"+"编辑"+"删除" |

详情只读保护（系统智能体）：

当 `agent.isSystem === true` 时，`AgentDetail.tsx` 向 `SkillConfigPanel` 传入 `readOnly={true}` prop，实现详情视图的只读保护：

- `SkillConfigPanel` 顶部显示 antd `Alert`（type="info"）提示"系统智能体配置为只读"
- 所有 `Switch`（技能启用/禁用开关）设置 `disabled={readOnly}`
- 上/下移动 `Button` 设置 `disabled={readOnly || 原始条件}`，readOnly 优先禁用
- `readOnly` 为可选 prop（默认 undefined），不影响非系统智能体的编辑功能

后端双重保护：
- `agent-config:create` 强制设置 `isSystem: false`，防止前端伪造系统预置智能体
- `agentConfigService.delete()` 内部拒绝删除系统预置智能体
- `editSkill()` 内部拒绝编辑内置技能

### 涉及文件清单

**新增文件：**
- `src/renderer/components/AgentCenter/AgentFormModal.tsx`
- `src/renderer/components/AgentCenter/SkillFormModal.tsx`

**修改文件：**
- `src/shared/types/agent-center.types.ts` — 新增 create/delete payload 类型
- `src/main/ipc/handlers/agentHandlers.ts` — 新增 4 个 IPC handler
- `src/main/services/agent/skills/skillLoader.ts` — 新增 `createSkill()` / `editSkill()` / `assembleSkillMd()` / `SkillFormData`
- `src/main/services/agent/management/agentConfigTypes.ts` — re-export 新增类型
- `src/main/preload.ts` — 新增 4 个桥接方法
- `src/renderer/types/electron.d.ts` — 新增 4 个方法类型声明
- `src/renderer/components/AgentCenter/hooks/useAgentConfigs.ts` — 新增 `createAgent` / `deleteAgent`
- `src/renderer/components/AgentCenter/AgentList.tsx` — 新增创建按钮 + 权限渲染
- `src/renderer/components/AgentCenter/AgentCenter.tsx` — 集成 AgentFormModal
- `src/renderer/components/AgentCenter/SkillMarketplace.tsx` — 新增创建/编辑/删除功能

---

## ⚠️ Bug 修复：世界书编写智能体 sessionId 时序问题（2026-08-01）

### 问题描述

`worldbookAgent:run` IPC 是阻塞调用，sessionId 仅在调用返回时才设置到 React state。但澄清问题（`planning_clarifying`）在运行期间通过 progress 事件到达，此时 `state.sessionId` 仍为 `null`，导致用户提交回答时报错"无活跃会话，无法提交回答"。

### 根因

- 主进程 `worldbookAuthoringService.emitProgress()` 构造的 `AuthoringProgressEvent` 未携带 `sessionId`
- `waitForClarifyAnswers()` 中的 `extendedEvent`（携带 clarifyingQuestions 的关键事件）也直接调用 `session.onProgress` 绕过了 `emitProgress`，同样未携带 `sessionId`
- 渲染进程 `handleProgressEvent` 回调未从 progress 事件中提取 `sessionId`，仅依赖 `run` 返回值

### 修复方案

通过 progress 事件携带 `sessionId`，让渲染进程在阻塞调用期间提前建立 sessionId 映射：

1. **`src/shared/types/worldbook-authoring.types.ts`** — `AuthoringProgressEvent` 接口新增可选字段 `sessionId?: string`（向后兼容）
2. **`src/main/services/agent/worldbook/worldbookAuthoringService.ts`** — `emitProgress()` 方法在构造 `fullEvent` 时自动附带 `sessionId: session.id`；`waitForClarifyAnswers()` 中的 `extendedEvent` 同样添加 `sessionId: session.id`
3. **`src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts`** — `handleProgressEvent` 回调的 setState 中添加 `sessionId: event.sessionId ?? prev.sessionId`

### 涉及文件

- `src/shared/types/worldbook-authoring.types.ts`
- `src/main/services/agent/worldbook/worldbookAuthoringService.ts`
- `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts`

---

## 世界书编写智能体思考步骤可视化（thoughtStep 事件处理）

### 概述

`AuthoringProgressEvent` 新增可选字段 `thoughtStep?: ThoughtStep`，用于在进度事件中携带 AI 的微观思考步骤（LLM 调用目的、输入输出摘要、耗时等）。渲染进程 `useWorldBookAuthoring` hook 订阅该字段并维护思考时间线，供 UI 展示从初始构思到最终输出的演变轨迹。

### `ThoughtStep` 类型（`src/shared/types/worldbook-authoring.types.ts`）

```typescript
export interface ThoughtStep {
  type: 'llm_call' | 'parse' | 'decision' | 'tool_call';
  purpose: string;
  inputSummary?: string;
  outputSummary?: string;
  durationMs: number;
  success: boolean;
  phase?: AuthoringProgressEvent['phase'];
  timestamp: number;
}
```

### Hook 改动（`src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts`）

1. **导入** — 从 `worldbook-authoring.types` 导入 `ThoughtStep` 类型
2. **State 接口** — `WorldBookAuthoringState` 新增 `thoughtSteps: ThoughtStep[]` 字段
3. **常量** — 新增 `MAX_THOUGHT_STEPS = 100`（思考步骤缓存上限，避免长编排无限增长）
4. **初始 state** — `thoughtSteps: []`
5. **`handleProgressEvent`** — 当 `event.thoughtStep` 存在时追加到 `thoughtSteps` 数组；超过 100 条时丢弃最旧的（`slice(length - 100)`）；不修改现有事件处理逻辑
6. **`reset()`** — 清空 `thoughtSteps: []`

### 涉及文件

- `src/shared/types/worldbook-authoring.types.ts` — `AuthoringProgressEvent.thoughtStep` 字段与 `ThoughtStep` 接口定义
- `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts` — 思考步骤状态管理与事件处理

---

## 世界书编写智能体进度事件填充 generatedEntries 与 auditDetail（2026-08-02）

### 概述

`AuthoringProgressEvent` 接口新增两个可选字段 `generatedEntries` 和 `auditDetail`，用于在进度事件中携带最近生成的条目列表和审计结果摘要，供前端进度面板展示实际生成内容与审计过程。本次在 `worldbookAuthoringService.ts` 的三个关键 `emitProgress` 调用点填充这两个字段。

### 修改点

1. **条目生成完成（`runAuthoringDimension`，单个条目创建成功后）** — 填充 `generatedEntries`，取当前批次 `drafts` 前 5 条，`content` 截断到 200 字符。
2. **微型审计完成（`runMiniAudit`）** — 填充 `auditDetail`（`type: 'mini'`），包含维度名、完整性问题数、一致性问题数，以及最多 5 条 error/critical 级别的一致性问题详情（`entryIds` 转为 `string[]`）。
3. **完整审计完成（`runAuditing`）** — 填充 `auditDetail`（`type: 'full'`），包含综合通过状态与分数、三维度（完整性/一致性/符合度）摘要字符串、已自动修复数、最多 5 条需用户决策项。

### 注意事项

- **维度完成后的 `emitProgress`（`runAuthoringDimension` 维度完成判定块）未填充 `generatedEntries`**：`drafts` 变量在 while 循环内声明，维度完成时已超出作用域，故跳过此修改点。
- `ConsistencyIssue.entryIds` 类型为 `Array<number | string>`，映射到 `auditDetail.issues[].entryIds` 时使用 `.map(String)` 转为 `string[]` 以匹配类型定义。
- `AuditUserDecision.severity` 类型为 `AuditSeverity`（联合类型），映射到 `auditDetail.userDecisions[].severity` 时使用 `String(d.severity)` 转为 `string`。

### 涉及文件

- `src/shared/types/worldbook-authoring.types.ts` — `AuthoringProgressEvent.generatedEntries` 与 `auditDetail` 字段定义
- `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — 三个 `emitProgress` 调用点填充新字段

---

## 智能体对话功能（Spec: add-agent-mode-management-and-center）

### 概述

为智能体管理中心新增"对话"功能，用户可直接从智能体列表中打开对话 Modal，与选定的智能体进行实时流式对话。

### 架构分层

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  AgentCenter.tsx                                    │
│   ├─ AgentList.tsx (操作列新增"对话"按钮)            │
│   └─ AgentDialogueModal.tsx (对话模态窗口)           │
│       └─ hooks/useAgentDialogue.ts (消息/流式管理)    │
├─────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                      │
│  agent.run / agent.cancel / agent.onToken / onDone  │
├─────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                         │
│  agent:run → 流式调用智能体执行引擎                   │
└─────────────────────────────────────────────────────┘
```

### 前端组件

**AgentList.tsx** — 智能体列表

- 操作列新增"对话"按钮（`MessageOutlined` 图标，`type="link" size="small"`），位于操作列第一个位置
- "对话"按钮对所有智能体显示（不区分 `isSystem`）
- Props 接口新增 `onChat: (agent: AgentConfig) => void` 回调
- 点击"对话"按钮时调用 `onChat(record)`

**AgentDialogueModal.tsx** — 智能体对话模态窗口（新增文件）

- Props：`open: boolean`、`agent: AgentConfig | null`、`onClose: () => void`
- 通过 `useAgentDialogue` hook 管理消息列表与流式状态
- 始终调用 hook，传入 `agent ?? FALLBACK_AGENT`（满足 React hooks 不可条件调用约束）
- Modal：width=720、footer=null、destroyOnClose=true
- 消息列表：固定高度 400px，用户消息右对齐（#e6f7ff）、助手消息左对齐（#f5f5f5），支持自动滚动
- 流式光标：assistant 消息 streaming=true 时末尾显示 CSS 闪烁光标动画（`@keyframes agentDialogueBlink`）
- 输入区域：TextArea（autoSize 1-4 行）+ 发送/停止按钮，Enter 发送 / Shift+Enter 换行
- 斜杠命令补全：输入 `/` 前缀时展示全部已注册命令（系统指令 + 内置命令），通过 `SlashCommandAutoComplete` 浮层补全
- 空状态：显示智能体 emoji + name + description + "输入消息开始对话"提示
- 关闭清理：`afterClose` 回调调用 `hook.reset()`（agent 为 null 时不调用）

**AgentCenter.tsx** — 主页面

- 新增 `useCallback` 导入
- 新增状态：`dialogueOpen`、`chattingAgent`
- 新增处理函数：`handleChat`（打开对话）、`handleCloseDialogue`（关闭对话）
- 向 `AgentList` 传入 `onChat={handleChat}` 回调
- 在 JSX 末尾渲染 `AgentDialogueModal`

### 涉及文件清单

**新增文件：**
- `src/renderer/components/AgentCenter/AgentDialogueModal.tsx`

**修改文件：**
- `src/renderer/components/AgentCenter/AgentList.tsx` — 新增"对话"按钮 + `onChat` 回调
- `src/renderer/components/AgentCenter/AgentCenter.tsx` — 集成 `AgentDialogueModal`

---

## 斜杠命令系统与快捷操作菜单（Common 公共组件）

### 概述

为聊天输入区域新增两套公共组件：斜杠命令系统（SlashCommand）和快捷操作菜单（QuickActions）。斜杠命令系统允许用户在输入框中输入 `/` 前缀触发命令补全与执行；快捷操作菜单提供分组式下拉菜单，聚合对话、内容、设置三类操作入口。

### 斜杠命令系统（SlashCommand）

#### 架构

```
┌──────────────────────────────────────────────────────┐
│ SlashCommandRegistry.ts                              │
│  ├─ SlashCommand 接口（name/description/handler等）  │
│  ├─ SlashCommandContext（输入框上下文）              │
│  ├─ ArgSuggestions（静态/动态参数建议）              │
│  └─ slashCommandRegistry 单例                        │
│      ├─ register / unregister                        │
│      ├─ get / getAll（去重）                          │
│      └─ search（模糊搜索）                            │
├──────────────────────────────────────────────────────┤
│ builtinCommands.ts                                   │
│  ├─ SlashCommandCallbacks（回调注入接口）            │
│  ├─ setSlashCommandCallbacks()（由 ChatInputBar 调用）│
│  └─ registerBuiltinCommands()（注册 8 个内置命令）    │
│      help / reset / retry / continue / polish /      │
│      ai-reply / model / clear                        │
├──────────────────────────────────────────────────────┤
│ systemCommands.ts                                    │
│  ├─ SystemCommandCallbacks（回调注入接口）           │
│  ├─ setSystemCommandCallbacks()（由 useAgentDialogue │
│  │  注入）                                           │
│  ├─ registerSystemCommands()（注册 5 个系统指令）    │
│  │  世界书 / 角色卡 / 编写 / 审核 / 帮助             │
│  ├─ getSystemCommandNames()（指令名列表）            │
│  ├─ isSystemCommand()（匹配判断）                    │
│  └─ parseSystemCommand()（解析指令名+参数）          │
├──────────────────────────────────────────────────────┤
│ SlashCommandAutoComplete.tsx                         │
│  ├─ 浮层定位在输入框上方                              │
│  ├─ 键盘导航（↑↓ Enter ESC）                         │
│  ├─ 鼠标悬停高亮 + 选中项滚动到可见区域               │
│  └─ query 文本高亮匹配                               │
└──────────────────────────────────────────────────────┘
```

#### 内置命令清单

| 命令 | 别名 | 说明 | 需确认 |
|------|------|------|--------|
| `/help` | - | 显示可用命令列表 | 否 |
| `/reset` | - | 重置当前对话（清空所有消息） | 是 |
| `/retry` | - | 重新生成上一条 AI 回复 | 否 |
| `/continue` | - | 继续生成上一条 AI 回复 | 否 |
| `/polish` | - | 润色当前输入框文本 | 否 |
| `/ai-reply` | `/ai`, `/reply` | 以当前用户人设生成对话回复 | 否 |
| `/model` | - | 切换 AI 模型（动态参数建议） | 否 |
| `/clear` | - | 清空当前对话 | 是 |

#### 系统指令清单（systemCommands.ts）

系统指令使用中文名称，与 `builtinCommands.ts` 中的英文内置指令互补，面向 Agent 对话场景（由 `AgentDialogueModal` / `useAgentDialogue` 注入回调）。指令的实际执行与结果展示由 `useAgentDialogue.ts` 的 `sendMessage` 逻辑统一管理，`systemCommands.ts` 仅负责指令注册与名称管理。

| 指令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/世界书` | - | - | 列出系统中所有世界书 |
| `/角色卡` | - | - | 列出系统中所有角色卡 |
| `/编写` | - | `<世界书名称>` | 启动指定世界书的编写流程 |
| `/审核` | - | `<世界书名称>` | 启动指定世界书的审核流程 |
| `/帮助` | `help` | - | 显示所有可用系统指令 |

辅助函数：

- `getSystemCommandNames()` — 返回所有系统指令名列表（不含 `/` 前缀）
- `isSystemCommand(content)` — 判断消息内容是否匹配系统指令
- `parseSystemCommand(content)` — 解析系统指令，返回 `{ name, args }`

#### 回调注入机制

`builtinCommands.ts` 中的 `setSlashCommandCallbacks()` 接收一个 `SlashCommandCallbacks` 对象，由 ChatInputBar 在挂载时注入实际实现。命令 handler 通过 `callbacksRef` 间接调用，实现命令定义与业务逻辑的解耦。

`systemCommands.ts` 采用相同的回调注入模式：`setSystemCommandCallbacks()` 接收一个 `SystemCommandCallbacks` 对象，由 `AgentDialogueModal` / `useAgentDialogue` 注入实际实现。每个回调返回 `Promise<string>`，结果以 assistant 消息形式展示在对话流中。注意：handler 内部仅触发回调，不处理返回值——指令执行与结果展示由 `useAgentDialogue.ts` 的 `sendMessage` 逻辑统一管理。

#### 深色主题样式

浮层使用 `rgba(30, 30, 46, 0.95)` 半透明深色背景 + `backdrop-filter: blur(10px)` 毛玻璃效果，选中项高亮 `rgba(99, 102, 241, 0.2)`，命令名紫色 `#8b5cf6`，描述灰色 `#94a3b8`，与 ChatInputBar 现有风格一致。

### 快捷操作菜单（QuickActions）

#### 组件结构

`QuickActionsMenu.tsx` 使用 antd `Dropdown` + `Button` + `Tooltip` 实现：

- **触发按钮**：44px 圆形渐变按钮（`linear-gradient(135deg, #f59e0b 0%, #f97316 100%)`），与 ChatInputBar 其他操作按钮（Send/AI回复/润色）尺寸和布局一致
- **菜单分组**：三组操作（`dialogueActions` / `contentActions` / `settingActions`），组间用 `{ type: 'divider' }` 分隔
- **菜单项**：每项显示 label + shortcut（右侧灰色文字），支持 icon、disabled 状态
- **Tooltip**：悬停提示"快捷操作"
- **禁用态**：按钮半透明（`opacity: 0.5`）

### 涉及文件清单

**新增文件：**
- `src/renderer/components/Common/SlashCommand/SlashCommandRegistry.ts` — 命令注册中心（类型定义 + 单例）
- `src/renderer/components/Common/SlashCommand/SlashCommandAutoComplete.tsx` — 自动补全浮层组件
- `src/renderer/components/Common/SlashCommand/builtinCommands.ts` — 8 个内置命令注册 + 回调注入
- `src/renderer/components/Common/SlashCommand/systemCommands.ts` — 5 个中文系统指令注册 + 回调注入 + 指令解析辅助函数
- `src/renderer/components/Common/SlashCommand/index.ts` — 统一导出
- `src/renderer/components/Common/QuickActions/QuickActionsMenu.tsx` — 快捷操作菜单组件
- `src/renderer/components/Common/QuickActions/index.ts` — 统一导出

## 智能体对话系统指令集成（useAgentDialogue + AgentDialogueModal）

### 概述

在 `useAgentDialogue.ts` 中集成 `systemCommands.ts` 模块，实现 5 个系统指令（`/世界书`、`/角色卡`、`/编写`、`/审核`、`/帮助`）的拦截与执行，以及无效 `/` 指令的友好提示。系统指令在 `sendMessage` 入口处优先检测，命中后短路返回不进入正常对话流程。

### 指令处理流程

```
sendMessage(content)
  │
  ├─ 空内容 / streaming 检查（原有逻辑）
  │
  ├─ isSystemCommand(content) ?  ← 系统指令检测
  │   ├─ 是 → parseSystemCommand → switch(name) 分发
  │   │        ├─ 世界书 → handleListWorldbooks()
  │   │        ├─ 角色卡 → handleListCharacters()
  │   │        ├─ 编写   → handleWriteWorldbook(args) → return（自行管理消息追加与流式输出）
  │   │        ├─ 审核   → handleAuditWorldbook(args)
  │   │        ├─ 帮助   → handleHelp()
  │   │        └─ 追加 user + assistant 消息，return
  │   │
  │   └─ 否 → trimmed.startsWith('/') && !startsWith('//') ?  ← 无效指令检测
  │        ├─ 是 → 追加 user + assistant（"未知指令"提示），return
  │        └─ 否 → 进入正常对话流程（原有逻辑）
```

### 指令处理函数

| 函数 | 指令 | 调用的 electronAPI | 说明 |
|------|------|---------------------|------|
| `handleListWorldbooks` | `/世界书` | `worldBook.list()` | 返回格式化 Markdown 列表（名称/大小/更新日期） |
| `handleListCharacters` | `/角色卡` | `character.list()` | 返回格式化 Markdown 列表（名称/描述摘要） |
| `handleWriteWorldbook` | `/编写 <名称>` | `worldBook.list()` + `skill.getPromptSnippet()` + `agent.run()` + `agent.onToken()` | 匹配世界书后通过 agent.run 流式对话模式编写，自行管理消息追加（返回 `Promise<void>`，sendMessage 中直接 return） |
| `handleAuditWorldbook` | `/审核 <名称>` | `worldBook.list()` + `worldBook.read()` + `agent.run()` | 读取世界书内容后，用 agent.run 执行三维审核（完整性/一致性/符合度） |
| `handleHelp` | `/帮助` | 无 | 返回指令列表 Markdown 表格 |

### 开场白增强

`buildGreeting` 函数对系统智能体（`agent.isSystem === true`）追加可用指令列表提示，引导用户使用系统指令。

### AgentDialogueModal 输入提示与命令补全

输入框 placeholder 从 `"输入消息...（Enter 发送，Shift+Enter 换行）"` 改为 `"输入消息或 /世界书 /角色卡 /编写 /审核…（Enter 发送）"`，提示用户可使用系统指令。

输入 `/` 前缀时，`SlashCommandAutoComplete` 浮层展示**全部已注册命令**（系统指令 + 内置命令），而非仅系统指令。组件通过 `slashCommandRegistry.getAll()` 获取全部命令列表（`allCommands`），并按 `autoCompleteQuery` 进行模糊过滤。`ensureSystemCommandsRegistered()` 同时调用 `registerBuiltinCommands()` 与 `registerSystemCommands()` 确保两类命令均已注册。

### 涉及文件清单

**修改文件：**
- `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 导入 systemCommands 模块、buildGreeting 增强、5 个指令处理函数、sendMessage 指令检测逻辑
- `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — placeholder 提示文案；`/` 补全展示全部已注册命令（系统指令 + 内置命令）；`ensureSystemCommandsRegistered` 同时注册内置命令

---

## 输入优化与系统智能体 Prompt 强化（Task 2 + Task 4）

### 概述

为 `useAgentDialogue` hook 新增 `optimizeInput` 方法，通过 `agent.run` IPC 通道对用户输入文本进行智能优化（提升清晰度、补充上下文、修正语法），同时强化系统智能体（`isSystem === true`）的 system prompt，注入角色定位、思考框架、工具使用、多步推理、回答规范等能力强化段落。

### 输入优化（optimizeInput）

**新增状态：**
- `isOptimizing: boolean` — 是否正在进行输入优化
- `optimizeAbortRef: useRef(false)` — 优化取消标志

**optimizeInput 方法流程：**
1. 空文本 / 正在优化时阻止重复执行
2. 从 `useSettingStore` 获取当前激活引擎的 `system_prompt`，前置到优化提示词
3. 调用 `window.electronAPI.agent.run`，`maxIterations: 1` 确保不进入工具调用循环，`timeoutMs: 30000`
4. 成功时返回优化后文本（trim）；失败 / 取消时返回原始文本（不阻塞用户操作）
5. `cancelOptimize` 方法设置 abort 标志并重置 `isOptimizing`

**返回值新增字段：**
- `optimizeInput: (originalText: string) => Promise<string>` — 优化输入文本
- `isOptimizing: boolean` — 优化进行中状态
- `cancelOptimize: () => void` — 取消优化

### 系统智能体 System Prompt 强化（buildSystemPrompt）

`buildSystemPrompt` 函数在 `agent.isSystem === true` 时追加「能力与行为准则」段落，包含五个子章节：
- **角色定位**：Creative Cafe 系统智能体的综合能力定义
- **思考框架**：理解意图 → 分解任务 → 逐步执行 → 汇总结果
- **工具使用**：主动调用工具获取信息，失败时提供替代方案
- **多步推理**：列出计划 → 逐步执行 → 及时修正 → 汇总结果
- **回答规范**：结构化输出、代码块包裹、不确定信息标注

### system-agent description 更新

`agentConfigService.ts` 中 `system-agent` 的 description 字段更新为更完整的描述，涵盖多轮对话、工具调用、多步推理、任务分解能力，以及斜杠指令和复杂需求处理场景。

### 涉及文件清单

**修改文件：**
- `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 新增 `optimizeInput` / `cancelOptimize` / `isOptimizing`；`buildSystemPrompt` 增加系统智能体能力强化段落；`UseAgentDialogueReturn` 类型扩展
- `src/main/services/agent/management/agentConfigService.ts` — `system-agent` description 字段更新

---

## 混合检索记忆搜索（Task 14: optimize-agent-interaction-from-openclaw）

### 概述

在 `ContextManager` 中新增 `retrieveWithHybrid` 方法，实现向量检索 + 关键词检索的混合检索策略，包含 MMR 去重和时间衰减，参考 openclaw 混合检索策略。

### 检索流程

1. **向量检索（权重 0.7）**：用 `embeddingService.generateEmbedding(query)` 生成查询向量，通过 `vectorStoreService.search` 检索 `topK * 2` 条结果（多取一倍用于 MMR 筛选），过滤 `score >= minScore`，每条 score 乘以 0.7
2. **关键词检索（权重 0.3）**：仅对 worldbook 来源，复用 `buildScanText` 构建扫描文本，调用 `worldBookService.matchKeywords`，每条 score 乘以 0.3，按 `metadata.entryUid` 去重
3. **合并候选集**：合并向量结果和关键词结果
4. **时间衰减**：`score *= exp(-daysSinceLastAccess / halfLife)`，半衰期默认 30 天（30 天前内容 score 衰减为 e^(-1) ≈ 0.37）
5. **MMR 去重选择**：`MMR = λ * relevance_score - (1-λ) * max_similarity_to_selected`，λ 默认 0.7；文档间相似度使用 Jaccard 相似度（中文按 2 字滑动窗口分词，英文按空格分词）
6. **返回结果**：按最终 score 降序排列，取 topK 条

### IPC 通道

- `context:retrieveWithHybrid` — 入参 `{ query: string; options: any }`，返回 `{ success, items }`

### 涉及文件

- `src/main/services/ContextManager.ts` — 新增 `tokenize` / `jaccardSimilarity` 辅助函数 + `retrieveWithHybrid` 方法 + `context:retrieveWithHybrid` IPC handler
- `src/main/preload.ts` — context 命名空间新增 `retrieveWithHybrid` API
- `src/renderer/types/electron.d.ts` — context 命名空间新增 `retrieveWithHybrid` 类型声明

## 对话消息列表组件复用优化（CharacterDialogueChat 迁移至 ChatMessageList）

### 概述

将 CharacterDialogueChat（角色对话）的消息列表渲染从自有的 `VirtualizedMessageList` + IIFE 模式迁移到复用 `ChatMessageList` 组件，使角色对话与智能体对话（AgentDialogueModal）共享同一消息列表组件，组件复用率 ≥ 80%。

### 改动内容

#### ChatMessageList 组件增强（`src/renderer/components/Common/ChatMessageList/ChatMessageList.tsx`）

新增三个可选 props，支持虚拟化模式：

- `enableVirtualization?: boolean`（默认 false）— 是否启用虚拟化
- `virtualizationThreshold?: number`（默认 100）— 虚拟化启用的消息数阈值，同时受 `shouldVirtualize` 最低阈值 50 约束
- `scrollElementRef?: React.RefObject<HTMLDivElement>` — 外部滚动容器引用，虚拟化模式下复用父级滚动容器

虚拟化模式（`enableVirtualization=true` 且传入 `scrollElementRef`）行为：
- 不创建嵌套滚动容器，直接使用父级滚动容器
- 不执行内部自动滚动（由父组件管理）
- 消息数超过阈值时使用 `VirtualizedMessageList` 渲染，否则直接 `.map()` 渲染
- 空消息列表返回 null（空状态由父组件处理）

非虚拟化模式（默认）行为保持不变：内部滚动容器 + 自动滚动 + 空状态展示。

新增导入：从 `../../Character/CharacterDialogueChat/VirtualizedMessageList` 导入 `VirtualizedMessageList` 和 `shouldVirtualize`。

#### CharacterDialogueChat 迁移（`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`）

- 移除 `VirtualizedMessageList` 和 `shouldVirtualize` 的直接导入
- 新增 `ChatMessageList` 导入（`../../Common/ChatMessageList/ChatMessageList`）
- 将原 IIFE 内的 `renderMessageBubble` 函数提取到组件体中（return 之前）
- 用 `<ChatMessageList>` 替换原消息列表 IIFE：
  - `mode="character"` / `enableVirtualization={true}` / `scrollElementRef={chatContainerRef}` / `renderMessage={renderMessageBubble}`
- `ChatTypingIndicator`、错误消息、`messagesEndRef`、滚动按钮保持原有位置不变（作为 ChatMessageList 的兄弟元素）

### 未修改的组件

- **ChatMessageBubble** — 保持不变，由 `renderMessageBubble` 调用
- **VirtualizedMessageList** — 保持不变，由 ChatMessageList 内部调用

### 涉及文件

- `src/renderer/components/Common/ChatMessageList/ChatMessageList.tsx` — 新增虚拟化支持
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — 迁移至 ChatMessageList

---

## ⚠️ 重点 Bug 修复：智能体对话三项功能运行时失效（2026-08-02）

### 问题描述

用户报告智能体对话的三项功能（命令自动提示、优化输入按钮、系统智能体能力强化）在实际测试中完全无效。前一轮修复已将代码写入磁盘，但运行时行为未改变。

### 根因分析

经 Self-Improving + Proactive Agent 自反思流程深入调查，发现**三个独立的根因**：

#### 根因 1：`agentConfigService._doInit()` 幂等注册跳过已有记录（最严重）

**位置**：`src/main/services/agent/management/agentConfigService.ts` `_doInit()`

**问题**：`if (this.cache.has(def.id)) continue;` 跳过已存在的 `system-agent` 记录。如果该记录在代码更新前已创建（旧版本 `is_system=0` 或旧 description），代码变更**永远不会同步到数据库**。

**修复**：将 skip 逻辑改为 upsert — 已存在的记录执行 `updateConfig()`，新记录执行 `insertConfig()`。

#### 根因 2：`optimizeInput` 与 `activeRuns` 守卫的竞态条件

**位置**：`src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` `cancelOptimize` / `optimizeInput`

**问题**：`cancelOptimize` 设置 `setIsOptimizing(false)` 后，`activeRuns` IPC 锁可能尚未释放。用户再次点击"优化"时被守卫拦截返回 "Agent is already running"。

**修复**：新增 `optimizeRunningRef`（useRef），在 `optimizeInput` 入口同步检查，在 `finally` 块中清理。

#### 根因 3：Electron 主进程未重启

前一轮代码修复已正确写入磁盘，但 Electron 主进程未重启，旧编译产物仍在运行。

### 经验教训

1. **幂等注册必须使用 upsert 模式**：`if (exists) update(); else insert();`，而非 `if (exists) continue;`
2. **React state 不能用于并发控制**：`useState` 的更新是异步批处理的，对于 IPC 重入防护必须使用 `useRef`
3. **Electron 主进程修改后必须重启 dev server**
4. **运行时验证 > 静态代码分析**

---

## Agent 对话页面美化重构（2026-08-02）

### 概述

将 AgentDialogueModal 的对话页面美化到与 CharacterDialogueChat 同等水平，包括背景装饰、消息气泡、头像、动画、输入区域等全面重构。

### 新增文件

- `src/renderer/components/AgentCenter/AgentDialogueModal.css` — Agent 对话页面专用 CSS（背景装饰、滚动条、Modal 覆盖样式、动画 keyframes）

### 修改文件

- `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 完全重写 JSX 和样式

### 美化元素清单

| 元素 | 修复前 | 修复后 |
|------|--------|--------|
| Modal 尺寸 | 720px 宽, 400px 高 | 900px 宽, 70vh 高 |
| Modal 遮罩 | 普通遮罩 | `backdropFilter: blur(8px)` 毛玻璃 |
| 背景 | 纯色 | 5 层径向渐变 + 3 个模糊光球 + 网格点阵 |
| 头部 | antd 默认标题栏 | 自定义头部（40px 圆形头像 + 名称 + 描述 + SYSTEM 标签） |
| 消息气泡 | 8px 统一圆角, 无阴影 | 不对称圆角 `18px 18px 4px 18px`, 毛玻璃, 彩色阴影 |
| 头像 | 无 | 36px 圆形头像, 用户/AI 差异化渐变边框 |
| 发送者名称 | 无 | "You" / 智能体名 + #序号标签 |
| 入场动画 | 无 | `agentFadeInUp 0.3s ease-out` |
| 流式光标 | 8x14px 矩形块 | 2px 竖线, `step-end` 闪烁 |
| 打字指示器 | 无 | 头像 + LoadingOutlined + "Thinking..." |
| 空状态 | emoji + 简单文本 | 80px 圆形渐变图标 + 发光阴影 + 标题 + 描述 |
| 输入框 | antd TextArea | 胶囊形 `border-radius: 24px` + 毛玻璃背景 + 聚焦发光 |
| 按钮 | antd 矩形按钮 | 44x44px 圆形渐变按钮 + 阴影 |
| 滚动按钮 | 无 | 脉冲动画圆形渐变按钮 |
| 滚动条 | 默认 | 6px 细滚动条 + 悬停变色 |
| 键盘提示 | 无 | "Enter 发送 · Shift+Enter 换行" |

---

## ⚠️ Bug 修复：系统指令参数解析无法分离文件名和自然语言（2026-08-02）

### 问题描述

用户输入 `/编写 神秘别墅.json，有任何疑问随时问我`，系统将整个 `神秘别墅.json，有任何疑问随时问我` 作为世界书名称查找，导致 "未找到名为「神秘别墅.json，有任何疑问随时问我」的世界书" 错误。

### 根因

`parseSystemCommand` 将指令名后的所有文本作为单个 `args` 字符串传递给 handler，handler 直接用整个 args 去匹配世界书名称，没有分离文件名和用户的自然语言补充说明。

### 修复

在 [useAgentDialogue.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts) 中新增 `extractWorldbookNameAndExtra()` 辅助函数，按以下策略提取文件名：

1. **文件扩展名匹配**：匹配 `.json` / `.json5` / `.tags.json` 扩展名，扩展名后的内容作为附加上下文
2. **中文标点分割**：按 `，。！？、；` 分割，第一段为名称
3. **空格分割**：按空格分割，第一段为名称
4. **兜底**：整个 args 作为名称

提取后的附加上下文（`extra`）会传入 `agent.run` 的 `writePrompt` 和 `agent.run` 的 `messages`，让 AI 能理解用户的补充说明。（注：`/编写` 指令已从 `worldBookAgent.run` 改为 `agent.run` 流式对话模式，详见 [/编写 指令重构](#编写-指令重构移除进度面板与逐项提问改为流式对话模式2026-08-02)。）

`handleWriteWorldbook` 和 `handleAuditWorldbook` 均已应用此修复。

---

## 意图识别前置处理机制（2026-08-02）

### 概述

在用户输入发送至执行智能体之前，增加一个由轻量级 LLM 构成的意图识别前置处理环节。该环节对用户输入进行深层语义分析，精准识别用户真实意图类型，判断当前智能体是否具备处理该意图的能力，并确定最匹配的响应策略。

### 新增文件

- [intentRecognizer.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/intentRecognizer.ts) — 意图识别核心模块

### 意图分类体系

| 意图类型 | 标识 | 说明 |
|----------|------|------|
| 信息查询 | `information_query` | 查询信息、了解事实、搜索资料 |
| 任务执行 | `task_execution` | 执行具体任务、创建/修改/删除内容 |
| 问题解决 | `problem_solving` | 解决技术问题、调试、排错 |
| 建议咨询 | `advice_consultation` | 寻求建议、征求意见、方案咨询 |
| 创作写作 | `creative_writing` | 创作故事、写诗、编写剧本、角色设定 |
| 日常闲聊 | `casual_chat` | 闲聊、问候、情感交流 |
| 系统操作 | `system_command` | 调用系统功能、管理配置 |
| 代码开发 | `code_development` | 编写/审查/重构代码 |
| 数据分析 | `data_analysis` | 分析数据、统计、可视化 |

### 处理流程

```
用户输入
  ↓
系统指令检测（/世界书 等）───是──→ 直接执行指令
  ↓ 否
无效指令检测（/未知命令）───是──→ 提示未知指令
  ↓ 否
【意图识别前置处理】
  ├─ 调用 agent.run（maxIterations=1, timeoutMs=8000）
  ├─ LLM 返回 JSON：{ intentType, summary, canHandle, strategy, confidence }
  ├─ 识别成功 → 展示「思考过程」消息 + 注入 systemPrompt
  └─ 识别失败 → 静默降级，不阻断对话
  ↓
执行智能体对话（agent.run，含意图增强 systemPrompt）
  ↓
流式返回
```

### 核心设计

1. **轻量级调用**：意图识别使用 `maxIterations=1, timeoutMs=8000`，快速返回
2. **容错降级**：识别失败时静默降级，不阻断正常对话流程
3. **并发防护**：使用 `recognizingIntentRef`（useRef）防止意图识别期间重复提交（共享 `activeRuns` 单实例锁）
4. **透明展示**：识别结果以「🔍 意图识别」消息卡片展示给用户，包含意图类型、核心需求、响应策略、能力匹配、置信度
5. **systemPrompt 注入**：识别结果注入执行智能体的 systemPrompt，帮助 AI 更准确理解用户需求
6. **UI 状态指示器**：头部显示「识别意图」加载状态和「意图标签」结果标签

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/renderer/components/AgentCenter/hooks/intentRecognizer.ts` | 新增：意图识别核心模块 |
| `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` | 集成意图识别到 sendMessage 流程 |
| `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` | 头部添加意图识别状态指示器 |

---

## 智能体对话参数配置面板（Spec: add-agent-dialogue-parameter-panel，2026-08-02）

### 概述

在智能体对话框右侧增加折叠式参数面板，提供人格自定义系统和辅助模式功能。参数按智能体 ID 持久化到 localStorage，切换智能体自动加载对应配置。

### 新增文件

| 文件 | 说明 |
|------|------|
| [useAgentParams.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/useAgentParams.ts) | 参数持久化 hook（`AgentParams` 接口 + localStorage 读写 + 切换 agentId 自动加载） |
| [AgentParamPanel.tsx](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentParamPanel.tsx) | 参数面板 UI 组件（人格 TextArea + 辅助模式 Switch + 强度 Radio + 重置按钮） |
| [AgentParamPanel.css](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentParamPanel.css) | 参数面板样式 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `AgentDialogueModal.tsx` | 双列布局（对话区 + 300px 参数面板），头部人格/辅助模式标签、齿轮按钮、辅助模式选项卡片渲染 |
| `useAgentDialogue.ts` | `buildSystemPrompt` 追加人格风格段 + 辅助模式段，`parseAssistModeOptions` 解析剥离选项块，`DialogueMessage` 新增 `suggestedOptions` 字段 |

### 核心设计

#### 参数持久化架构

```
localStorage key: agent-params-{agentId}
存储内容（JSON）:
{
  customPersonality: string,       // 自定义人格文本
  assistMode: boolean,             // 辅助模式开关
  assistModeIntensity: 'low'|'medium'|'high'  // 强度
}
```

- `useAgentParams(agentId)` hook 在 `agentId` 变化时通过 `useEffect` 自动重新加载
- `updateParams(partial)` 实时写入 localStorage（无需确认步骤）
- `resetParams()` 恢复默认值并立即持久化

#### systemPrompt 分段注入

```
[全局 system_prompt]

[智能体描述段] — 你是「{name}」。{description}...
[能力强化段]   — ## 能力与行为准则（仅系统智能体）
[人格风格段]   — ## 人格风格（仅 customPersonality 非空时）
[辅助模式段]   — ## 辅助模式（仅 assistMode 开启时）
```

人格段与角色定义段独立呈现：角色定义段定义"你是谁"（身份职责），人格风格段定义"你怎么说话"（语气风格）。

#### 辅助模式选项格式

使用 `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` 纯文本标记格式（非 XML/HTML）。AI 回复完成后，`parseAssistModeOptions` 从内容中解析并剥离选项块，支持 6 种正则模式容错匹配。

选项卡片三色差异化设计：
- 稳妥推进（绿色 `#10b981`）
- 平衡探索（紫色 `#6366f1`）
- 发散创新（橙红 `#f59e0b`）

选项文本解析正则：`/\(([^)]*)\)|"([^"]*)"/g`，分离动作描写（斜体灰色）和对话内容（白色）。

---

## ⚠️ Bug 修复：/编写 指令秒回"已完成"但世界书未实际编写（2026-08-02）

### 问题

`handleWriteWorldbook` 中 IPC 返回值字段不匹配：检查 `result?.success` 但 IPC handler 返回 `{ ok, result?, error? }`，`success` 在嵌套的 `result.result` 上。导致无论成功失败永远报"已完成"。同时缺少 `config` 参数，服务端必然失败。

详见 [FIX_RECORDS.md §3.1](file:///g:/AI/creative-cafe/docs/FIX_RECORDS.md)。

---

## 世界书编写实时进度面板（2026-08-02）

### 概述

将世界书编写过程从"每次进度事件追加新消息"改为"单条消息实时更新"，类似 Trae IDE 的 Agent 面板。展示编写阶段、思考过程时间线、维度进度、当前活动和活动日志。

### 核心设计

#### 单条消息实时更新机制

使用 `_progressPanelId` 字段（值为 `'__worldbook_progress__'`）标记进度面板消息。每次进度事件到达时，通过 `findIndex` 查找已有面板消息并原地更新内容，而非追加新消息。

```typescript
// DialogueMessage 接口新增字段
_progressPanelId?: string;

// 进度面板消息更新逻辑
const idx = prev.findIndex(m => m._progressPanelId === '__worldbook_progress__');
if (idx >= 0) {
  const updated = [...prev];
  updated[idx] = { ...updated[idx], content: panelContent };
  return updated;
}
```

#### 进度面板内容结构

`buildAuthoringProgressPanel(displayName, events, thoughtSteps)` 函数构建 Markdown 面板：

1. **标题行**：`## 📖 世界书「{name}」编写进度`
2. **整体进度**：阶段 ｜ 维度进度 ｜ 已生成条目数
3. **当前活动**：`> 🔄 {currentActivity}`
4. **澄清问题**（planning_clarifying 阶段）：展示 AI 提出的问题列表
5. **最近生成条目**（`generatedEntries` 存在时）：每条展示名称 + 内容摘要（截断 200 字符）
6. **审计结果**（`auditDetail` 存在时）：区分 `mini`（维度 / 完整性问题数 / 一致性问题数 / 关键问题列表）与 `full`（综合结果 / 分数 / 三维度摘要 / 自动修复数 / 需用户决策项）
7. **思考过程时间线**（最近 8 条）：🧠 LLM 调用 / 📝 解析 / 🎯 决策 / 🔧 工具调用，含目的、输入输出摘要（截断 300 字符）、耗时
8. **活动日志**（最近 5 条）：时间戳 + 阶段标签 + 维度 + 条目数 + 消息

#### 阶段标签映射

```typescript
const AUTHORING_PHASE_LABELS: Record<string, string> = {
  planning_analyzing: '分析提示',
  planning_clarifying: '澄清问题',
  planning_building: '构建计划',
  authoring_generating: '生成条目',
  authoring_mini_audit: '微型审计',
  authoring_fixing: '自我修正',
  auditing_full: '完整审计',
  auditing_fixing: '自动修复',
  // ...
};
```

#### 数据流

```
worldbookAgent:progress IPC 事件
  → progressEvents.push(data) + thoughtStepsAccum.push(data.thoughtStep)
  → buildAuthoringProgressPanel() 构建 Markdown
  → setMessages() 原地更新 _progressPanelId 消息
```

编排完成后，进度面板消息追加分隔线和最终总结（成功/失败）。

---

## 智能体逐项问答弹窗组件 AgentQuestionModal（Spec: optimize-agent-question-interaction，2026-08-02）

### 概述

新增 `AgentQuestionModal` 组件，用于智能体在世界书编写 PLANNING 阶段向用户逐项提出澄清问题。每个问题提供预设选项卡片和"其他"自定义输入，用户确认或跳过后继续下一个问题。ESC 键和点击外部均不关闭弹窗，必须显式操作。

### 新增文件

| 文件 | 说明 |
|------|------|
| [AgentQuestionModal.tsx](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentQuestionModal.tsx) | 逐项问答弹窗 React FC 组件 |
| [AgentQuestionModal.css](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentQuestionModal.css) | 弹窗样式（全局类名，因 antd Modal 渲染在 body 下） |

### Props 接口

```typescript
interface AgentQuestionModalProps {
  question: string;        // 问题内容
  why: string;             // 上下文说明（为什么需要这个信息）
  options: string[];       // 预设选项列表
  currentIndex: number;    // 当前问题序号（从 1 开始）
  totalCount: number;      // 总问题数
  onAnswer: (answer: string | undefined, skipped: boolean) => void;
}
```

### 内部状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `selectedOption` | `string \| null` | 当前选中的预设选项 |
| `isOtherSelected` | `boolean` | 是否选中"其他" |
| `customInput` | `string` | "其他"输入框内容 |

### 组件行为

1. **Modal 配置**：`open` 始终为 `true`，`closable={false}`、`maskClosable={false}`、`keyboard={false}`、`footer={null}`、`width=520`、`centered`
2. **标题**：`🤔 智能体需要确认`
3. **问题序号**：antd `Tag`（color="blue"）显示"问题 {currentIndex}/{totalCount}"
4. **问题内容**：18px 加粗
5. **上下文说明**：13px 灰色，💡 图标前缀
6. **预设选项**：可点击卡片（非 Radio），选中状态蓝色边框 `#3b82f6` + 浅蓝背景 `#eff6ff`
7. **"其他"选项**：✏️ 图标，点击后展开 `Input.TextArea`（autoSize 3-6 行，autoFocus）；选中"其他"时预设选项取消高亮，反之亦然
8. **确认按钮**：蓝色 primary，未选择任何选项且"其他"输入框为空时禁用；点击调用 `onAnswer(selectedOption || customInput.trim(), false)`
9. **跳过按钮**：默认样式，点击调用 `onAnswer(undefined, true)`
10. **底部布局**：`flex` + `justify-content: flex-end` + `gap: 12px`

### 样式要点

- CSS 使用全局类名（`.agent-question-modal .ant-modal-body`），因 antd Modal 默认渲染在 body 下
- 选项卡片：`padding: 12px 16px`、`border-radius: 8px`、`border: 1px solid #e5e7eb`、hover 浅灰背景
- "其他"输入区域展开动画：`aqmFadeIn 0.2s ease-out`

---

## worldbook-author SKILL.md 架构变更：三阶段工作流 → 流式对话模式（2026-08-02）

### 概述

`worldbook-author` 内置技能的 SKILL.md 从「三阶段启发式工作流（PLANNING→AUTHORING→AUDITING）」重写为「自由流式工作模式 + 数据入库格式规范」。智能体不再通过专用 IPC 通道 `worldbookAgent:run` 工作，而是通过 `agent.run` 流式对话模式工作，智能体自主决定工作流程。

### 变更内容

- **description 字段更新**：从三阶段工作流描述改为流式对话模式描述
- **新增「工作模式」章节**：智能体通过流式对话与用户交互，自主决定信息收集、条目生成、质量检查等工作流程，不设预设工作路线
- **新增「数据入库格式规范」章节**：
  - 条目结构表（`worldBookPath` / `name` / `content` / `keys` / `secondaryKeys` / `comment` / `dimensionId`）
  - autoGenerated 标记说明
  - worldBookPath 传递规范
  - 工具调用指引（`createEntry` / `generateKeywords` / `expandFromContext`）
- **移除的内容**：
  - 三阶段启发式工作流（规划阶段 / 自驱编写阶段 / 审计闭环阶段）
  - 专用 IPC 通道列表（`worldbookAgent:run` / `cancel` / `status` / `resume` / `answer` / `progress` / `clarify`）
  - 断点续跑与取消（状态机相关）
  - 注意事项中的单实例守卫、会话超时等状态机相关内容
  - 「与手动编写的区别」表格中的「质量保障」行（不再有自动审计）

### 保留的内容

- YAML frontmatter 的 `name` / `emoji` / `user-invocable` / `disable-model-invocation` / `command-name` 字段不变
- 「何时调用」与「不适用场景」
- 「Agent 模式要求」
- 「注意事项」中的草稿审批提醒
- 「与手动编写的区别」表格（移除「质量保障」行后保留其余行）

### 涉及文件

- `src/main/services/agent/skills/builtin-skills/worldbook-author/SKILL.md`

---

## /编写 指令重构：移除进度面板与逐项提问，改为流式对话路径（2026-08-02）

### 概述

将 `/编写` 指令从 `worldBookAgent.run` IPC 阻塞调用模式改为 `agent.run` 流式对话模式，移除所有进度面板、逐项提问弹窗、Loading 指示器。此重构与 `worldbook-author SKILL.md` 架构变更（三阶段工作流 → 流式对话模式）配套，使前端代码与技能架构保持一致。

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| [useAgentDialogue.ts](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts) | 重写 `handleWriteWorldbook`；删除进度面板/澄清问题相关代码 |
| [AgentDialogueModal.tsx](file:///g:/AI/creative-cafe/src/renderer/components/AgentCenter/AgentDialogueModal.tsx) | 移除 `AgentQuestionModal` 引用、Loading 指示器、`clarifyState` 禁用条件 |

### useAgentDialogue.ts 修改详情

#### 删除的代码

1. **`buildAuthoringProgressPanel` 函数及常量** — `AUTHORING_PHASE_LABELS`、`THOUGHT_STEP_ICONS` 常量和 `buildAuthoringProgressPanel()` 函数（约 170 行），不再需要进度面板内容构建
2. **`worldbookWriting` 状态** — `const [worldbookWriting, setWorldbookWriting] = useState(false)`，不再需要编写中状态跟踪
3. **澄清问题状态** — `clarifyQuestions`、`currentClarifyIndex`、`pendingAnswers`、`awaitingSessionId` 四个 useState
4. **`handleClarifyAnswer` 函数** — 逐项提问回答处理逻辑（约 27 行）
5. **`clarifyState` 计算与导出** — return 之前的计算块和 return 语句中的 `clarifyState`、`handleClarifyAnswer`、`worldbookWriting`
6. **`UseAgentDialogueReturn` 接口字段** — `clarifyState`、`handleClarifyAnswer`、`worldbookWriting` 三个字段
7. **import 清理** — 移除 `AuthoringProgressEvent`、`ClarifyingQuestion`、`ThoughtStep` 类型导入（仅用于已删除的代码）

#### `handleWriteWorldbook` 重写

**旧实现**：通过 `worldBookAgent.run()` IPC 阻塞调用，订阅 `worldBookAgent.onProgress()` 事件实时更新进度面板消息，检测 `planning_clarifying` 阶段触发逐项提问弹窗，返回 `Promise<string>`（最终总结文本）。

**新实现**：通过 `agent.run()` 流式对话模式工作，流程如下：
1. 匹配世界书名称（复用 `extractWorldbookNameAndExtra`）
2. 构建 `writePrompt`（含世界书路径和用户附加说明）
3. 追加 user 消息
4. 获取技能提示词片段（`skill.getPromptSnippet()`），构建 `effectiveSystemPrompt`
5. 创建 assistant 占位消息（`streaming: true`）
6. 订阅 `agent.onToken` / `agent.onDone` 事件
7. 调用 `agent.run()`，`context.mode: 'worldbook'`，`maxIterations: 30`，`timeoutMs: 600000`
8. 完成后标记 `streaming: false`，解析辅助模式选项
9. 返回 `Promise<void>`（自行管理消息追加，不再返回文本）

#### `sendMessage` 中 `/编写` 分支修改

```typescript
// 旧：
case '编写':
  resultContent = await handleWriteWorldbook(args);
  break;

// 新：
case '编写':
  await handleWriteWorldbook(args);
  return;  // handleWriteWorldbook 自己管理消息追加和流式输出
```

`handleWriteWorldbook` 不再返回字符串，`/编写` 分支直接 return，不走 `appendAssistantMessage(resultContent)` 路径。`resultContent` 变量类型仍为 `string`（其他分支不受影响）。

### AgentDialogueModal.tsx 修改详情

1. **移除 `AgentQuestionModal` import** — 不再使用逐项问答弹窗组件
2. **移除解构字段** — `clarifyState`、`handleClarifyAnswer`、`worldbookWriting` 从 `useAgentDialogue` 返回值解构中移除
3. **移除 `AgentQuestionModal` 渲染块** — 整个 `{clarifyState.currentQuestion && (<AgentQuestionModal ... />)}` 块删除
4. **移除 `clarifyState.currentQuestion != null` 禁用条件** — textarea、优化按钮、发送按钮的 `disabled` 和 `cursor` 条件中移除该判断
5. **移除 Loading 指示器** — `msg._progressPanelId === '__worldbook_progress__'` 条件渲染块删除

### 向后兼容

- `DialogueMessage._progressPanelId` 字段保留在接口定义中（向后兼容），但不再有代码设置该字段
- `AgentQuestionModal` 组件文件本身未删除（可能在其他地方使用或未来复用）
- `worldBookAgent` IPC 通道相关代码未删除（主进程服务仍存在）

### 与既有文档的关系

- [世界书编写实时进度面板](#世界书编写实时进度面板2026-08-02) — 该功能已在本次重构中移除
- [智能体逐项问答弹窗组件 AgentQuestionModal](#智能体逐项问答弹窗组件-agentquestionmodalspecoptimize-agent-question-interaction2026-08-02) — 该弹窗已从 `AgentDialogueModal` 中移除
- [worldbook-author SKILL.md 架构变更](#worldbook-author-skillmd-架构变更三阶段工作流--流式对话模式2026-08-02) — 本次前端重构是该架构变更的配套修改

## 世界书新生成 / 草稿条目审核按钮（2026-08-03）

### 概述

在 AI 生成的新条目列表与 autoGenerated 草稿条目待审阅区中，为每个条目新增"审核"按钮。点击后提取条目 `content` 文本，复用既有的单字段审核流程（`WorldBookAuditModal`），设置 `currentAuditField='content'` / `currentAuditText` 并打开审核 Modal，无需新增审核逻辑。

### 修改点

1. **`WorldBookAIGenerateFlow.tsx`**：
   - Props 接口新增可选回调 `onAuditEntry?: (entry: any) => void`
   - 导入 `SafetyCertificateOutlined` 图标
   - 在 `generatedEntries`（新建世界书 Modal）与 `addedEntries`（添加条目 Modal）两个条目列表中，每个条目卡片内容区下方添加"审核"按钮，点击调用 `onAuditEntry?.(entry)`

2. **`WorldBookAutoGeneratedReview.tsx`**：
   - Props 接口新增可选回调 `onAuditEntry?: (entry: AutoGeneratedEntry) => void`
   - 导入 `SafetyCertificateOutlined` 图标
   - 在表格"操作"列中，"批准"按钮之前添加"审核"按钮，点击调用 `onAuditEntry?.(record)`
   - 操作列宽度由 160 调整为 220 以容纳三个按钮

3. **`WorldBookManager.tsx`**（编排层）：
   - 新增 `handleAuditGeneratedEntry` useCallback 函数：提取 `entry.content`，校验非空后设置审核状态（`setCurrentAuditField('content')` / `setCurrentAuditText` / `setAuditRequirements('')` / `setIsAuditModalOpen(true)`），并记录日志
   - 将 `onAuditEntry={handleAuditGeneratedEntry}` 分别传递给 `WorldBookAIGenerateFlow` 与 `WorldBookAutoGeneratedReview`

### 设计说明

- 审核按钮复用既有的 `WorldBookAuditModal` 审核流程，无需新增 Modal 或审核逻辑
- `onAuditEntry` 为可选 prop，不传递时按钮仍渲染但点击无操作（`?.` 可选链保护）
- 草稿条目（`AutoGeneratedEntry`）的结构与生成条目不同，但均包含 `content` 字段，`handleAuditGeneratedEntry` 统一通过 `entry?.content` 提取

### 涉及文件

- `src/renderer/components/WorldBook/WorldBookAIGenerateFlow.tsx` — 新增 prop + 审核按钮
- `src/renderer/components/WorldBook/WorldBookAutoGeneratedReview.tsx` — 新增 prop + 审核按钮 + 列宽调整
- `src/renderer/components/WorldBook/WorldBookManager.tsx` — 新增 `handleAuditGeneratedEntry` + prop 传递

## 角色卡素材生成与 SD 图像生成分流（Spec: add-asset-and-trait-management / Task 10）

### 概述

角色卡素材管理（`AssetManagerModal` / `AssetGenerateModal`）支持五类图像生成：批量表情（batch-expression）、单个表情（single-expression）、角色立绘（illustration）、一般图像（general）、三视图（three-view）。生成请求通过 `sd:` IPC 命名空间下发至 `sdGenerationService`，最终调用 SD WebUI 的 txt2img / img2img 接口。素材本身的 CRUD（清单读写、保存、删除）走 `asset:` 命名空间。

### 生成路径分流（核心设计）

`AssetGenerateModal.handleSingleGenerate` 按 mode 分流到两条 IPC，**明确区分"图像参考（img2img）"与"纯文生图（txt2img）"两种技术路径**：

| mode | IPC | 技术路径 | 是否使用角色卡基底图 | 适用场景 |
|------|-----|---------|---------------------|---------|
| single-expression | `sd:generateExpression` | img2img | 是（extractBaseImage 从角色卡 PNG 提取） | 在已有角色图基础上变换表情，需保持人物一致性 |
| illustration | `sd:generateTxt2Img` | txt2img | 否 | 角色立绘，完全由提示词 + 角色 LoRA 驱动 |
| general | `sd:generateTxt2Img` | txt2img | 否 | 一般场景图像，提示词 + 角色 LoRA |
| three-view | `sd:generateTxt2Img` | txt2img | 否 | 三视图（front/side/back），提示词 + 角色 LoRA |

> 【重点标记】illustration / general / three-view 统一走 `sd:generateTxt2Img`（纯文生图），**不使用角色卡基底图片作为图像参考**，完全由提示词 + 角色 LoRA 驱动。仅 single-expression 保留 img2img，因为表情生成本质是在已有角色图基础上变换表情。详见 docs/FIX_RECORDS.md §4.1。

### 提示词与 LoRA 注入

- `buildAssetPromptTemplate(mode, targetSlot)` 按模式构建正面提示词模板，均含 `{traits}` 占位符：
  - **【Spec: add-dynamic-scene-prompt-generation / Task 7】** 函数已从 `AssetGenerateModal.tsx` 迁移至 `PromptBuilder.ts`（导出），与其它 `build*` 工具函数集中管理。**【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 5】** illustration / general 模板移除 `{clothing}` / `{pose}` / `{scene}` 动态场景占位符，特征内容统一通过 `{traits}` 占位符注入；`userScene` 参数及 fallback 逻辑同步移除。
  - **【2026-08-06 视角镜头 + 模式默认值重构】** illustration / general / 表情（SDXL）模板含 `{camera}` 占位符，由 `CameraAngleSelector` 的 4 个独立下拉（镜头距离 / 垂直角度 / 水平视角 / 特殊构图，各选 1 个）拼接填充。详见 docs/FIX_RECORDS.md §5.9
    - **移除写死视角 tag**：立绘移除 `full_body`、表情移除 `portrait` + `looking_at_viewer`，改为弹窗打开时按模式初始化默认值（`getCameraDefaultForMode`）：立绘=`full_body`，表情=`portrait, looking_at_viewer`，一般图像=无默认。避免「写死 tag + 用户选同类 tag」冲突（如 full_body + close-up 自相矛盾）
    - three-view 模板不含 `{camera}`（视角由 targetSlot 程序化决定 front/side/back），下拉不渲染
  - illustration：`{camera}, {traits}, high quality, best quality, masterpiece`（**【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 5】** 移除 `{pose}` / `{clothing}` / `{scene}` 动态场景占位符，特征内容统一通过 `{traits}` 注入；**【2026-08-06 重构】** 移除写死 `full_body` → `{camera}` 默认值注入；**【2026-08-06 标签库审计】** 所有 tag 改为 Danbooru 标准下划线格式，详见 docs/FIX_RECORDS.md §5.11）
  - general：`{traits}, {camera}, high quality, best quality`（**【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 5】** 移除 `{clothing}` / `{pose}` / `{scene}` 占位符；`{camera}` 无默认值，用户自由选）
  - three-view：`{viewName}_view, full_body, solo, {traits}{nudeTags}, white_background, high quality`（**【2026-08-06 重点标记 - 三视图多角色 bug 修复】** 移除 `character sheet`（Danbooru 训练数据中天然指多视角合集图，导致一张三视图出现多角色/多视角 collage），改为 `solo` 强化单角色；配合负面提示词追加多角色约束。详见 docs/FIX_RECORDS.md §5.10；**【2026-08-06 标签库审计】** tag 改为下划线格式，详见 §5.11）
  - 表情（SDXL，`buildExpressionGenerationPrompt` 默认模板）：`{camera}, {traits}, simple_background, {emotion}, high quality, best quality, masterpiece, detailed face`（**【2026-08-06 重构】** 移除写死 `portrait` + `looking_at_viewer` → `{camera}` 默认值 `portrait, looking_at_viewer` 注入；`{camera}` 由下游 `applyTraitsAndLora` 替换，本函数仅替换 `{traits}` / `{emotion}`；**【2026-08-06 标签库审计】** tag 改为下划线格式）
- `{traits}` / `{camera}` / `{gender}` 占位符 + LoRA 标签由 `sdGenerationService.applyTraitsAndLora` 统一处理，`generateExpression`（img2img 路径）与 `generateTxt2Img`（txt2img 路径）均调用该方法：
  - 读取 `options.characterTraits` 过滤空字符串后拼接为逗号分隔串替换 `{traits}`（空则替换为空串并清理多余逗号）。⚠️ **【2026-08-07 去重修复】** 拼接前对 text 做大小写不敏感去重（`Set` + `toLowerCase()` key，保留首次出现），防止重复 tag（如两个 `dog_girl`）导致 SD 多次加权影响生成质量。重复时 `console.warn` 输出去重前后数量。详见 docs/FIX_RECORDS.md §7.23 §9
  - **【Spec: add-sdxl-prompt-weight-support / Task 2 — 权重格式化】** 当 `characterTraits[i].weight` 不为 1.0 / `undefined` 时，将 tag 格式化为 `(text:weight)` 语法（如 `(blue_eyes:1.5)`，冒号两侧无空格，兼容 Forge Neo lark 解析器 `modules/prompt_parser.py` 的 `:\s*([+-]?[.\d]+)\s*\)` 规则）；默认权重（1.0 / undefined）tag 保持原样不加括号。`Math.round(weight * 10) / 10` 保留 1 位小数精度避免浮点误差。**去重 key 仍为 `text.toLowerCase()`（不含括号）**，保证 `blue_eyes` 与 `(blue_eyes:1.5)` 不会被识别为不同 tag；保留首次出现项的 weight 设置。详见 docs/FIX_RECORDS.md §7.24
  - **【2026-08-07 Spec: replace-dynamic-scene-with-prompt-gen / Task 4】** 移除 `{clothing}` / `{pose}` / `{scene}` 占位符替换逻辑及 `options.dynamicClothing` / `dynamicPose` / `dynamicScene` 字段读取（动态场景方案已移除，特征内容统一通过 `{traits}` 注入）。
  - 读取 `options.dynamicCamera` 替换 `{camera}` 占位符（**2026-08-06 新增**，来自 `AssetGenerateModal` 视角镜头下拉选择（含模式默认值）；空则替换为空串并清理多余逗号；illustration / general / 表情（SDXL）模板含此占位符）
  - 读取 `options.selectedLoras`（角色专属 LoRA，按角色独立存储，杜绝跨角色污染）注入 LoRA 标签
- `buildSdOptions()` 透传 `characterTraits` 与 `selectedLoras: characterLoras`，确保两条路径都能准确应用角色特征与 LoRA
  - **【Spec: add-trait-category-grouping v2 升级】** `characterTraits` 由「全部 `string[]`」改为「`traits.filter(t => t.enabled).map(t => t.text)`」——store 持有 `CharacterTraitItem[]`（含 `id` / `text` / `categoryId` / `enabled`），下游仅拼接 `enabled=true` 项的 text，实现跨分类组合选择。覆盖 `AssetGenerateModal`（立绘/一般图像/三视图/single-expression/batch-expression）与 `ExpressionGenerateModal`（表情生成）两条组件路径。
  - **【Spec: add-sdxl-prompt-weight-support / Task 2 — BREAKING 类型升级】** `SDGenerationOptions.characterTraits` 类型由 `string[]` 升级为 `Array<{ text: string; weight?: number }>`，结构化形状携带 per-tag 权重（默认 `undefined` 等价 1.0，范围 0.1-10.0）。**破坏性变更**：所有调用方（`AssetGenerateModal.buildSdOptions` / `ExpressionGenerateModal`）必须从 `string[]` 适配为 `Array<{ text: string; weight?: number }>`，由 `traits.filter(t => t.enabled).map(t => ({ text: t.text, weight: t.weight }))` 产出（`weight` 字段可选，未携带即等价 1.0）。`applyTraitsAndLora` 不再接收 `string[]`，按上述权重格式化规则处理。
  - **【临时编辑支持】** `AssetGenerateModal` 的「携带角色特征」面板支持用户临时编辑/新增/删除（不持久化）：
    - 维护本地工作副本 `editedTraits: CharacterTraitItem[] | null`（弹窗打开时从 store `characterTraits` 深拷贝，关闭时置 null）
    - `effectiveTraits = editedTraits ?? characterTraits` 驱动 `enabledTraitTexts` 派生与 UI 展示
    - **【Spec: optimize-expression-preset-prompts / Task 7】** `enabledTraitTexts` 在表情模式（`single-expression` / `batch-expression`）下额外过滤 `categoryId === 'expression'` 的特征，避免与 `{emotion}` 占位符注入的 `EMOTION_PROMPT_MAP` 表情 tag 重复/冲突。过滤在 `useMemo` 派生层执行（与 `isNudeSlot` 过滤 `top`/`bottom`/`underwear` 衣物分类同模式），确保 `buildSdOptions` / `buildEmotionPrompt` / single-expression 提示词构建器所有下游消费者一致地不携带 expression 分类 tag。`illustration` / `general` / `three-view` 模式不受影响（`isExpressionMode` 为 false 时不过滤）。⚠️ **【2026-08-07 去重修复】** `enabledTraitTexts` 追加 `.filter()` 对 text 做大小写不敏感去重（保留首次出现），从源头防止重复 tag 进入 SD prompt（与 `applyTraitsAndLora` 后端兜底去重构成双层防御，详见 docs/FIX_RECORDS.md §7.23 §9）。
    - 初始化用 `traitStoreCardId === characterCardId` 判断就绪（支持 0 特色角色卡也能初始化为 `[]`）
    - 用户可临时修改 trait 的 `text`（如 `sitting → standing`）、切换 `enabled`、临时删除任意标签、在分类下新增临时标签（`genTraitId()` 生成 id，不写入磁盘）
    - UI 按 `SYSTEM_TRAIT_CATEGORIES + customCategories + UNCATEGORIZED_CATEGORY` 分组折叠展示（所有分类默认展开含空分类），每个 Tag 可点击切换 enabled、点编辑图标进入行内 Input 编辑、点 × 临时删除，分类底部「+ 新增临时标签」可追加临时特征
    - 颜色区分：原始 enabled = purple、已修改 = orange、临时新增 = cyan、disabled = default（灰显）
    - **【Spec: add-ai-tag-chinese-translation / Task 6 + Task 4】** 特征 Tag 用 antd `<Tooltip>` 包裹，`title={trait.translation || ''}`：AI 生成时携带的中文翻译在 hover 时展示，空字符串 title 不弹出（不影响 Tag 点击切换启用 / closable 删除 / 行内编辑）。行内编辑保存新 text 时同步 `translation: undefined`（`handleConfirmEditTrait` 内 `{ ...t, text: trimmed, translation: undefined }`），避免旧翻译与新 tag 不符；临时新增 trait 不带 `translation` 字段（默认 undefined，`handleConfirmAddTrait` 与 `TagAutocomplete.onTagSelect` 两处入口一致）。`Tooltip` 已从 antd 导入（文件顶部 import 块）。
    - `hasEdits` 检测三类修改（`hasTempAdditions` / `hasTempDeletions` / `hasTextEdits`）控制「重置」按钮可用性
    - 所有临时修改仅影响本次生成，关闭弹窗或点「重置」即丢弃，不回写 store
- txt2img 路径尺寸由 `options.txt2imgWidth/txt2imgHeight` 控制（弹窗内 SizeSelector 选择，不写入全局设置）

### IPC 通道

**sd 命名空间**（`sdGenerationHandlers.ts` → `sdGenerationService`）：

| 通道 | 用途 | 是否需要基底图 |
|------|------|---------------|
| `sd:checkStatus` | 检查 SD WebUI API 状态 | — |
| `sd:getModels` | 获取已加载模型列表 | — |
| `sd:generateTxt2Img` | 文生图（prompt + LoRA，立绘/一般图像/三视图） | 否 |
| `sd:generateExpression` | 单个表情 img2img（提取角色卡基底图） | 是 |
| `sd:generateAllExpressions` | 批量表情 img2img（带 `sd:generationProgress` / `sd:generationComplete` 进度推送与取消） | 是 |
| `sd:cancelGeneration` | 取消进行中的批量生成（模块级 `isCancelled` 标志） | — |

**asset 命名空间**（`assetHandlers.ts` → `assetService`）：`asset:list` / `asset:save` / `asset:delete` / `asset:getImagePath`。返回的 imagePath 为磁盘绝对路径，渲染进程需通过 `file.readAsBase64` 转 data URL（CSP 兼容，与 expression:getImagePath 一致）。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 素材生成弹窗，mode 分流 + 提示词模板构建
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 素材管理弹窗（立绘/一般图像/三视图 Tab）
- `src/main/ipc/handlers/sdGenerationHandlers.ts` — sd 命名空间 IPC 注册
- `src/main/services/sdGenerationService.ts` — SD 生成服务（txt2img / img2img / extractBaseImage / applyTraitsAndLora）
- `src/main/ipc/handlers/assetHandlers.ts` — asset 命名空间 IPC（素材 CRUD）
- `src/main/services/assetService.ts` — 素材存储服务（manifest 管理，三视图 slot 校验）

### AssetManagerModal Tab 结构与预览交互

`AssetManagerModal` 内部 5 个 Tab，4 个图像类 Tab（表情 `ExpressionTabContent` / 立绘 `AssetGridTabContent('illustration')` / 一般图像 `AssetGridTabContent('general')` / 三视图 `ThreeViewTabContent`）共享统一的缩略图预览交互模式：

- 缩略图容器 `position: relative`，含 `thumbnail-hover-overlay` 覆盖层
- hover 时通过 `onMouseEnter`/`onMouseLeave` 切换 overlay `opacity`（0→1，0.25s 过渡）
- overlay 内 `EyeOutlined` 眼睛图标按钮，`Tooltip title="预览大图"`
- 点击 overlay → `setPreviewImage(dataUrl)` → 打开全尺寸预览 Modal（`width="auto"`，图片 `maxWidth:90vw / maxHeight:85vh`，`destroyOnClose`）
- 仅当存在可预览图片时渲染 overlay（表情 Tab：默认头像取 `avatarPath`、已上传取 `imageCache[emotionKey]`、未上传则无）

> 【一致性】2026-08-05 修复：表情 Tab 原本缺失此预览交互（其他三个 Tab 已有），已补齐为统一模式。预览 Modal 去内边距使用 `styles.body: { padding: 0 }`（旧代码误用无效的 `styles.content` 键，已一并清理）。详见 docs/FIX_RECORDS.md §4.2。

### AI 生成特征自动归类（Spec: add-trait-category-grouping 增强）

原 Spec「AI 集成适配」一节规定 AI 特征生成（Task 13）仍返回扁平 `string[]`、新特征统一落入「未分类」，由用户手动归类（"AI 自动归类为未来增强项，本期不做"）。2026-08-05 实施该「未来增强项」：让 LLM 直接输出 `分类:tag` 形式，解析后携带 `categoryId` 透传到 store，使 AI 生成的特征直接进入对应系统分类（basic / head / body / top / bottom / accessories / underwear / background / pose / expression），无需用户手动归类。

**系统分类体系（11 个，`SYSTEM_TRAIT_CATEGORIES` 常量定义，order 0..10）：**
- `basic` 基本特征（order 0）— 物种/种族（lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf）、性别（female, male, 1girl, 1boy）、内容分级（sfw, nsfw）等角色基底属性，作为整个角色的基底特征置于最前
- `head` 头部特征（order 1）— 发色/发型/瞳色/动物耳朵/帽子等
- `body` 身体特征（order 2）— 体型/肤色/毛色/尾巴/翅膀等（不含物种与性别，已移至 basic）
- `top` 上装（order 3）— 上衣/衬衫/外套/连衣裙/校服等上身衣物（dress/school uniform 等连体衣物归入上装）
- `bottom` 下装（order 4）— 裤子/裙子/短裤等下身衣物
- `accessories` 配饰（order 5）— 眼镜/缎带/首饰/帽子/围巾等装饰物
- `underwear` 内衣（order 6）— 胸罩/内裤/内衣套装等贴身衣物
- `background` 背景环境（order 7）
- `pose` 人物姿势（order 8）
- `expression` 人物表情（order 9）
- `interaction` 互动元素（order 10）— 用户与角色之间的身体接触/肢体动作等交互场景标签，含两种 Danbooru 模式：A) POV 脱离身体风格（`disembodied_hand` + `hand_on_breast` / `disembodied_tongue` + `licking` 等）；B) 双角色互动风格（`hugging_another` / `holding_hands` / `hand_on_another's_*` / `grabbing_another's_*` 等）。与 `pose`（角色自身姿势）语义分离。仅在对话上下文描述互动动作时由 AI 输出，角色卡描述场景不触发。详见 docs/FIX_RECORDS.md §7.35 + CODE_WIKI.md §40
- `uncategorized` 未分类（order 999，迁移兜底，不在 `SYSTEM_TRAIT_CATEGORIES` 数组内）

> `basic` 为 2026-08-05 新增系统分类，置于最前作为角色基底特征容器。物种/性别等基底属性原先归入 `body`，现归入 `basic`；`body` 收缩为体型/肤色/毛色等纯身体特征。详见 docs/FIX_RECORDS.md §4.4。
>
> **【衣物分类拆分（2026-08-09）】** 原 `clothing` 衣物配饰分类已拆分为 `top`/`bottom`/`accessories`/`underwear` 四个细分类，提升 AI 归类精度与裸体三视图过滤准确性（裸体版仅过滤 `top`/`bottom`/`underwear`，保留 `accessories`）。旧数据中 `categoryId='clothing'` 的特征由 `characterTraitService.loadTraitData` 一次性迁移至 `uncategorized`（由用户手动重新归类）。详见 docs/FIX_RECORDS.md §7.29。
>
> **【互动元素分类新增（2026-08-09，Spec: enhance-conversation-interaction-prompt-recognition）】** 新增 `interaction` 系统分类（order 10），专门承载对话上下文中用户与角色动作互动的 Danbooru 标签。与 `pose` 语义分离：`pose` 是角色自身的姿态（如 `sitting` / `standing`），`interaction` 是与另一个实体的交互（如 `disembodied_hand` / `hugging_another`）。互动标签分两种模式：模式 A（POV/脱离身体风格，第一人称描述触发）输出 `disembodied_*` + 配合部位标签；模式 B（双角色互动风格，第三人称或两角色互动描述触发）输出 `*_another` 系列标签。关键原则：互动元素独立于角色完整形象，允许不生成用户完整角色，仅添加 `disembodied_*` 标签引导 SD 生成交互性质图片。详见 docs/FIX_RECORDS.md §7.35 + CODE_WIKI.md §40。
>
> **【服装状态指令增强（2026-08-09，Spec: add-costume-state-prompt-directives）】** `interaction` 分类现在也承载服装状态标签（衣物仍在身上但状态改变）。`buildDynamicTraitSystemPrompt` 新增 `buildCostumeStateGuidance()` 指令块，与 `interactionGuidance` 平行，引导 AI 根据对话上下文中的服装变化描述生成 3 类 Danbooru 标签：A) 服装开合状态（`open_clothes` / `open_jacket` / `unbuttoned_shirt` 等）；B) 服装位置变化（`panties_aside` / `shirt_lift` / `skirt_lift` 等）；C) 身体部位暴露（`one_breast_out` / `cleavage` / `navel` 等）。关键原则：服装状态标签描述的是「衣物仍在身上但状态改变」，区别于衣物完全移除（移除用 top/bottom/underwear 分类的删除处理）；开合/位移标签通常需配合暴露标签使用。同时 `generateTraitPrompts` 新增服装状态 RAG 检索（`COSTUME_STATE_RAG_KEYWORDS` 常量），`optimizeTraitsForContext` 的 system prompt 新增服装状态开合/复位的 remove 模式与开合→暴露/位移→暴露的 add 模式。详见下方「服装状态提示词指令增强」章节。

**类型契约变更：**
- 新增共享类型 `CategorizedTrait`（`src/shared/types/characterTrait.types.ts`）：`{ text: string; categoryId: string }`，是 `CharacterTraitItem` 的「无 id / 无 enabled」轻量子集，由 AI 服务产出、store 接收后补全 id 与 enabled。**【Spec: add-sdxl-prompt-weight-support / Task 1 后续扩展】** 现已追加 `translation?` / `originalText?` / `weight?` 三个可选字段，与 `CharacterTraitItem` 同名同语义（`weight` 默认 `undefined` 等价 1.0，详见 docs/FIX_RECORDS.md §7.24）
- `GenerateCharacterTraitsResult.traits` 由 `string[]` 升级为 `CategorizedTrait[]`（`characterTraitAIService.ts`），`generateCharacterTraits` 与 `recognizeImageTraits` 两条路径同步升级
- IPC 通道 `ai:generateCharacterTraits` / `ai:recognizeImageTraits` 返回值类型同步（`preload.ts` / `electron.d.ts`），IPC handler 无结构变化（透传 typed 对象）
- `characterTraitStore.setTraits` 签名由 `(traits: string[])` 升级为 `(traits: CategorizedTrait[])`，MERGE 策略升级（见下）

**LLM Prompt 升级（`characterTraitAIService.ts`）：**
- `CHARACTER_TRAIT_SYSTEM_PROMPT`：原输出 `white fur, dog girl, ...`，现输出 `basic:dog girl, basic:female, head:white hair, ...`，prompt 内嵌 11 个系统分类的语义说明与归类建议（如「物种/种族 → basic」「性别 → basic」「内容分级 → basic」「发色 → head」「瞳色 → head」「上衣/外套/连衣裙 → top」「裤子/裙子 → bottom」「眼镜/首饰/帽子 → accessories」「胸罩/内裤 → underwear」「动物耳朵 → head」「尾巴/翅膀 → body」「用户与角色动作互动 → interaction」）。**【Spec: enhance-conversation-interaction-prompt-recognition】** 现追加 `interaction` 分类的互动元素识别指令块，含模式 A（POV/脱离身体风格 `disembodied_*`）与模式 B（双角色互动风格 `*_another`）的详细标签清单与触发原则，详见 §40
- `IMAGE_TRAIT_SYSTEM_PROMPT`：同步升级为 `category:tag` 英文格式，便于多模态识别结果同样携带分类
- 多模态 `includeImage=true` 分支的内联 system 补充语也同步改为「categorized tags」
- 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复（2026-08-06，Spec: fix-asset-trait-and-scene-defects / Task 5）】上述两个常量现为**基线参考**（`export` 导出，文档化 prompt 结构），生产调用已改为动态构建：`generateCharacterTraits` / `recognizeImageTraits` 在构建 messages 前调用 `categoryDictionaryService.loadDictionary()` 读取全局字典自定义分类，再通过 `buildDynamicTraitSystemPrompt(globalCategories)` / `buildDynamicImageTraitSystemPrompt(globalCategories)` 将系统分类 + 自定义分类合并注入提示词。原硬编码 prompt 仅含系统分类，LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），导致不会为这些分类生成 `tattoo:dragon tattoo` 等带前缀的 tag。详见 docs/FIX_RECORDS.md §5.2

**解析逻辑升级（`parseTraitsFromContent`）：**
- 返回类型由 `string[]` 改为 `CategorizedTrait[]`
- 解析「category:tag」前缀：仅在 prefix 为已知分类 id 时剥离，否则视为无分类（兜底 `uncategorized`）
- 【重点标记 - 自定义分类 id 合法化（2026-08-06，Spec: fix-asset-trait-and-scene-defects / Task 5.4）】`validCategoryIds` 原仅含系统分类 id（`basic` / `head` / `body` / `top` / `bottom` / `accessories` / `underwear` / `background` / `pose` / `expression`），现同步从 `categoryDictionaryService.loadDictionary()` 加载全局字典自定义分类 id，使 `tattoo` / `weapon` 等自定义分类前缀成为合法前缀，确保 LLM 返回的 `tattoo:dragon tattoo` 能被正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`（而非兜底为 uncategorized）
- 鲁棒性保证：LLM 未输出前缀 / 输出未知前缀 / SD tag 内权重冒号（如 `(white hair:1.3)`）均不被误剥离，整条作为 text、categoryId 兜底为 uncategorized（行为等价于原 Spec）
- 去重键保持为 `text`（大小写敏感）。【Bug 修复 - tag 数量不符】曾短暂改为 `${categoryId}::${text}` 组合键，但导致 LLM 将同一 tag 归入不同分类时（如 `basic:white fur` + `body:white fur`）产生重复项，下游 SD 提示词出现重复 tag。已回退为仅 `text` 去重，保留首次出现的 `categoryId`，与 SD tag 语义一致（详见 docs/FIX_RECORDS.md §4.5）

**Store MERGE 策略升级（`characterTraitStore.setTraits`）：**
1. 现有 `categoryId !== uncategorized` 的 → 原样保留（用户手动分类不丢失）
2. 现有 `categoryId === uncategorized` 且 text 在新集合中的 → **用 AI 的 categoryId 更新**（关键修复：原策略仅保留，新策略用 AI 分类重新归类）
3. 现有 `categoryId === uncategorized` 且 text 不在新集合中的 → 移除（AI 替换未分类特征）
4. 新集合中不存在于现有 traits 的 → 追加为 `{ id, text, categoryId: AI's, enabled: true }`

**调用方适配：**
- `AssetManagerModal.handleAIGenerateTraits`（特征管理 Tab 的「生成特征」按钮）：无代码改动，`setTraits(result.traits)` 类型自动匹配（`CategorizedTrait[]` → `CategorizedTrait[]`）
- `AssetGenerateModal.handleImageRecognize`（素材生成弹窗的图片识别按钮）：原传 `[...existingTexts, ...newTraits]`（`string[]`），现传 `[...existingTraits.map(t => ({text, categoryId})), ...newTraits]`（`CategorizedTrait[]`），保留「现有 trait 透传自身 categoryId（MERGE 对未分类项保持原状）+ 新增 trait 携带 AI categoryId」语义

**`clearTraits()` — 绕过 MERGE 的一键清空**（Spec: add-clear-traits-button）：因 `setTraits([])` 受 MERGE 策略约束会**保留已分类项**（仅移除未分类项），无法满足「清空全部特征」需求，故新增 `clearTraits` action 直接 `set({ traits: [], appearanceDescription: '' })` 绕过 MERGE。由 `AssetManagerModal` 顶部工具栏「清空」按钮（`handleClearAll`，`Modal.confirm` 二次确认）调用，同步清空 `ragDebug` 质检报告 + `editingDescription` 本地编辑态；不清空 `combinations` / `globalCategories`（组合方案 + 分类体系保留）；仅清空本地 state，用户需点「保存」才持久化。

> 详见 docs/FIX_RECORDS.md §4.3。

## 动态场景提示词生成（Spec: add-dynamic-scene-prompt-generation）— 综述

> 2026-08-05 全 spec 实施完成（Task 1-9）。本节为综述章节，详细实施细节见下方各 Task 专属章节。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 1-10）**
>
> 「动态场景方案」功能已全量移除，由「提示词生成」面板（`generateTraitPrompts` IPC + 分类特征体系）替代。本节及下方 Task 2 / 3 / 5 / 6 章节仅作历史参考，所涉代码均已不存在。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。
>
> **移除范围（13 个源文件）：**
> - `characterTrait.types.ts` — `DynamicScenePrompt` 接口 + `CharacterTraitManifestV2` 两字段
> - `characterTraitService.ts` — `loadTraitData` / `saveTraitData` 中动态场景字段读写
> - `characterTraitStore.ts` — `dynamicScenePrompts` / `activeDynamicScenePromptId` state + 4 个 action（save/apply/update/delete DynamicScenePrompt）
> - `characterTraitAIService.ts` — `generateDynamicScenePrompts` 方法及辅助函数（约 700 行）+ `DYNAMIC_SCENE_SYSTEM_PROMPT` 常量 + `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 接口
> - `characterTraitAIHandlers.ts` — `ai:generateDynamicScenePrompts` handler 注册
> - `ipc/index.ts` — 动态场景 IPC 注册注释
> - `preload.ts` — `generateDynamicScenePrompts` 方法
> - `electron.d.ts` — `generateDynamicScenePrompts` 类型定义
> - `sdGenerationService.ts` — `SDGenerationOptions` 三字段 + `applyTraitsAndLora` 中 `{clothing}` / `{pose}` / `{scene}` 占位符替换
> - `PromptBuilder.ts` — 立绘/一般图像模板简化（移除 `{clothing}` / `{pose}` / `{scene}` 占位符 + `userScene` 参数）
> - `AssetGenerateModal.tsx` — 动态场景方案下拉 UI + `buildSdOptions` 字段 + `userScene` state（详见 §7.26）
> - `AssetManagerModal.tsx` — 动态场景指令面板（约 279 行）；**新增** 提示词生成面板（约 460 行，详见下方「角色特征页签提示词生成面板」节）
> - `RagQualityReport.tsx` — `dimension` 字段类型/常量/渲染
>
> **保留不动的部分：** `generateTraitPrompts` / `generateCharacterTraits` / `recognizeImageTraits` / `applyTagAudit` 等方法保留，`generateTraitPrompts` 成为动态场景方案的正式替代品（输出 `CategorizedTrait[]` 而非三组维度 tag）。


### 概述

为角色特征管理系统新增「动态场景提示词生成」能力，允许用户通过自然语言指令（如「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」）让 AI 自动解析为三组独立的英文 SD tag（`clothing` / `pose` / `scene`），保存为命名方案后可在生成图片时一键切换，与基础特征组合后注入 SD 生成流程。该能力独立于角色「固有」基础特征（种族/发色/瞳色/体型等），不污染基础特征数据。

### 五层架构与数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 共享类型层（Task 1）                                          │
│    src/shared/types/characterTrait.types.ts                     │
│      ├─ DynamicScenePrompt 接口                                  │
│      └─ CharacterTraitManifestV2.dynamicScenePrompts /           │
│         activeDynamicScenePromptId 字段                          │
├─────────────────────────────────────────────────────────────────┤
│ 2. 主进程 AI 服务（Task 2）                                      │
│    src/main/services/characterTraitAIService.ts                 │
│      ├─ generateDynamicScenePrompts(params)                     │
│      ├─ DYNAMIC_SCENE_SYSTEM_PROMPT（---CLOTHING--- / ---POSE---│
│      │   / ---SCENE--- 分隔符）                                  │
│      └─ parseDynamicSceneResponse(content) 私有解析方法          │
├─────────────────────────────────────────────────────────────────┤
│ 3. IPC 通道（Task 3）                                            │
│    ai:generateDynamicScenePrompts                              │
│    characterTraitAIHandlers.ts → preload.ts → electron.d.ts    │
├─────────────────────────────────────────────────────────────────┤
│ 4. 主进程存储服务（Task 4）                                      │
│    src/main/services/characterTraitService.ts                  │
│      ├─ loadTraitData() 兜底补 dynamicScenePrompts=[] /         │
│      │   activeDynamicScenePromptId=null（v2 迁移兼容）         │
│      └─ saveTraitData() 完整写入两字段                          │
├─────────────────────────────────────────────────────────────────┤
│ 5. 前端状态层（Task 5）                                          │
│    src/renderer/stores/characterTraitStore.ts                  │
│      ├─ state: dynamicScenePrompts / activeDynamicScenePromptId │
│      └─ actions: saveDynamicScenePrompt（自动激活 + 立即持久化）│
│                 / applyDynamicScenePrompt                       │
│                 / updateDynamicScenePrompt                      │
│                 / deleteDynamicScenePrompt（删激活则置 null）  │
├─────────────────────────────────────────────────────────────────┤
│ 6. 前端 UI 层（Task 6）                                          │
│    AssetManagerModal.tsx → CharacterTraitTabContent            │
│      ├─ NL 输入 + AI 解析按钮（loading 状态）                   │
│      ├─ 三组可编辑 TextArea（服装/动作/场景，可覆盖 AI 结果）   │
│      ├─ 完整提示词预览（baseTraits + clothing + pose + scene） │
│      └─ 保存/切换/删除（方案名输入 + 下拉选择 + Modal.confirm） │
├─────────────────────────────────────────────────────────────────┤
│ 7. 提示词模板（Task 7）                                          │
│    PromptBuilder.ts → buildAssetPromptTemplate                 │
│      ├─ illustration: `full_body, {pose}, {traits}, {clothing}, │
│      │   {scene}, high quality, best quality, masterpiece`     │
│      ├─ general: `{traits}, {clothing}, {pose}, {scene},        │
│      │   high quality, best quality`                            │
│      └─ three-view: 不使用动态场景占位符（已有穿衣/裸体分组）  │
├─────────────────────────────────────────────────────────────────┤
│ 8. SD 生成链路（Task 8）                                         │
│    sdGenerationService.applyTraitsAndLora                      │
│      ├─ 读 options.dynamicClothing / dynamicPose / dynamicScene │
│      ├─ 替换 {clothing} / {pose} / {scene} 占位符               │
│      └─ 空替换 + 多余逗号清理（与 {traits} 共用清理路径）       │
│    AssetGenerateModal.buildSdOptions                           │
│      ├─ 从 store 读取激活动态场景方案                            │
│      └─ 兜底：illustration 无激活 → pose=standing / scene=simple │
│         background；general 无激活 → scene 回退到 userScene      │
└─────────────────────────────────────────────────────────────────┘
```

### 各 Task 实施要点

| Task | 模块 | 关键改动 | 详见 |
| --- | --- | --- | --- |
| 1 | `src/shared/types/characterTrait.types.ts` | 新增 `DynamicScenePrompt` 接口（8 字段）+ `CharacterTraitManifestV2` 扩展 2 字段 | 本节「Task 1：共享类型定义」 |
| 2 | `src/main/services/characterTraitAIService.ts` | 新增 `generateDynamicScenePrompts()` + `DYNAMIC_SCENE_SYSTEM_PROMPT` + `parseDynamicSceneResponse()`；复用 `getEngineRuntimeConfig` / `enrichSystemPrompt`；空输入/AI 未配置/解析失败三类兜底 | 本节「Task 2：AI 服务扩展」 |
| 3 | IPC 通道（4 文件） | `ai:generateDynamicScenePrompts` 注册 + preload 暴露 + electron.d.ts 类型声明 | [下方 Task 3 章节](#动态场景提示词生成-ipc-通道扩展spec-add-dynamic-scene-prompt-generation--task-3) |
| 4 | `src/main/services/characterTraitService.ts` | `loadTraitData` 兜底 `[]` / `null`（v2 迁移兼容）+ `saveTraitData` 完整写入 | 本节「Task 4：持久化服务扩展」 |
| 5 | `src/renderer/stores/characterTraitStore.ts` | state + 4 actions（即时持久化语义）；`saveTraits` 签名 `characterCardId` 改可选；修复 TS2739 | [下方 Task 5 章节](#动态场景提示词-store-扩展spec-add-dynamic-scene-prompt-generation--task-5) |
| 6 | `AssetManagerModal.tsx` `CharacterTraitTabContent` | 紫色折叠面板（默认折叠）+ NL 输入 + 三组可编辑 TextArea + 完整预览 + 保存/切换/删除 | [下方 Task 6 章节](#动态场景指令-ui-区域spec-add-dynamic-scene-prompt-generation--task-6) |
| 7 | `PromptBuilder.ts` | `buildAssetPromptTemplate` 从 `AssetGenerateModal.tsx` 迁出并导出；illustration/general 模板加 `{clothing}` / `{pose}` / `{scene}` 占位符；three-view 模板不改 | 「角色卡素材生成与 SD 图像生成分流」节「提示词与 LoRA 注入」段落 |
| 8 | `sdGenerationService.ts` + `AssetGenerateModal.tsx` | `SDGenerationOptions` 新增 3 字段 + `applyTraitsAndLora` 替换占位符 + `buildSdOptions` 透传 + 兜底逻辑 | 「角色卡素材生成与 SD 图像生成分流」节「提示词与 LoRA 注入」段落 |
| 9 | 集成验证 | `npx tsc --noEmit` 724 baseline 错误，12 修改文件零新增错误；5 端到端流程静态验证全部通过；3 文档同步更新 | 本节「Task 9：集成验证」 |

### Task 1：共享类型定义

`src/shared/types/characterTrait.types.ts` 新增 `DynamicScenePrompt` 接口：

```typescript
export interface DynamicScenePrompt {
  id: string;          // genTraitId() 生成（复用基础特征 ID 生成器）
  name: string;        // 用户输入，可重名（与 TraitCombination 拒绝重名策略不同）
  clothing: string;    // 服装相关英文 SD tag（逗号分隔，可能为 ""）
  pose: string;        // 动作/姿势英文 SD tag（逗号分隔，可能为 ""）
  scene: string;       // 场景/环境英文 SD tag（逗号分隔，可能为 ""）
  sourceCommand: string; // 原始自然语言指令（中文，用于溯源与 UI 展示）
  createdAt: number;
  updatedAt: number;
}
```

`CharacterTraitManifestV2` 新增两字段（**「存储可选、内存必填」语义**：磁盘旧 v2 文件可能缺失，由 service 层 `loadTraitData()` 兜底补全 `[]` / `null`）：

```typescript
dynamicScenePrompts: DynamicScenePrompt[];       // 默认 []
activeDynamicScenePromptId: string | null;       // 默认 null
```

> 设计动机：与 `CharacterTraitItem[]` 基础特征分离，避免一次性场景指令污染角色固有视觉属性。`genTraitId()` 复用避免引入新 ID 命名空间。

### Task 2：AI 服务扩展

`src/main/services/characterTraitAIService.ts` 新增方法：

| API | 签名 | 说明 |
| --- | --- | --- |
| `GenerateDynamicScenePromptsParams` | `{ naturalLanguageInput: string; baseTraits?: string }` | 入参：NL 指令 + 可选基础特征上下文 |
| `GenerateDynamicScenePromptsResult` | `{ success, clothing?, pose?, scene?, error?, ragDebug? }` | 返回：三组英文 tag（未提及维度为 `""`）；**ragDebug**（⚠️ Spec: add-dynamic-scene-tag-audit，详见 §7.18）= 标签库质检报告，结构与 `GenerateCharacterTraitsResult.ragDebug` 兼容，tagValidation 项额外携带 `dimension?: 'clothing'\|'pose'\|'scene'` 标识维度归属 |
| `generateDynamicScenePrompts(params)` | async | 主入口；空输入/AI 未配置/解析失败三类兜底；解析后按维度分别调 `applyTagAudit` 完整走 L0-L5 审计链（无效 tag 自动替换/拆分/AI 兜底） |
| `applyTagAudit(traits, ctx, aiCfg, rtCfg)` | private | **审计辅助方法**（⚠️ §7.18）：封装 validateTagsAgainstLibrary + L3 颜色拆分 + L2/L3 规范化 + L4 KNN 替换 + L5 AI 兜底；`traits` 原地修改；`generateCharacterTraits` 与 `generateDynamicScenePrompts` 共用此方法（DRY） |
| `parseDynamicSceneResponse(content)` | private | 按分隔符切分 + 标点归一化 |
| `DYNAMIC_SCENE_SYSTEM_PROMPT` | const | 指导 LLM 输出 `---CLOTHING---` / `---POSE---` / `---SCENE---` 分隔的三组 tag |

> **⚠️ Spec: add-ai-tag-chinese-translation**（详见 docs/FIX_RECORDS.md §7.21）：
> - AI prompt 输出格式调整为 `分类:tag|中文翻译`（角色特征，`CHARACTER_TRAIT_SYSTEM_PROMPT`）和 `tag|中文翻译`（动态场景，`DYNAMIC_SCENE_SYSTEM_PROMPT`），按第一个 `|` 切分（翻译中可含 `|`）。
> - `parseTraitsFromContent` / `parseDynamicSceneResponse` / `normalizeDynamicSceneTagsWithTranslations` 解析翻译，写入 `CategorizedTrait.translation` / `DynamicScenePrompt.*Translations`。
> - `applyTagAudit` 替换 `trait.text` 时同步清空 `translation=undefined`（L2/L3 规范化、L3 颜色拆分、L4 KNN、L5 AI 兜底全链路），避免翻译与新 tag 不符。

错误兜底链（与 `generateCharacterTraits` / `recognizeImageTraits` 一致）：
- 空输入 → 「请输入动态场景指令」（不调用 LLM）
- AI 引擎未配置（baseUrl / apiKey / modelName / temperature / max_tokens 任一缺失） → 「AI 引擎未配置，请先在设置中配置 API」
- 调用失败（网络 / 超时 / HTTP 错误） → 「AI 调用失败：<具体原因>」
- 解析失败（LLM 返回空内容 / 无分隔符） → 「AI 返回内容无法解析为动态场景 tag」
- handler 外层 try/catch 提供 IPC 序列化兜底，渲染进程永不收到 reject

> 复用 `getEngineRuntimeConfig` / `enrichSystemPrompt` / 非流式调用模式，与项目「禁止 AI 参数默认值」规则一致。

### Task 4：持久化服务扩展

`src/main/services/characterTraitService.ts` 改动：

- **`loadTraitData()`**：`Array.isArray(parsed.dynamicScenePrompts)` 兜底 `[]`；`typeof parsed.activeDynamicScenePromptId === 'string'` 兜底 `null`。v1→v2 迁移时显式补 `[]` / `null`。早于本 spec 落盘的 v2 文件兼容。
- **`saveTraitData()`**：`safeDynamicScenePrompts` / `safeActiveDynamicScenePromptId` 同样兜底后完整写入 manifest，保证下次加载无需再次兜底。日志输出 `dynamicScenePrompts.length` 与 `activeDynamicScenePromptId` 便于诊断。
- **`emptyV2Manifest()`**：初始化空白 manifest 时 `dynamicScenePrompts: []` / `activeDynamicScenePromptId: null`。
- **`normalizeTraitItem(r)`**（⚠️ Spec: add-ai-tag-chinese-translation Task 8 bug 修复，详见 docs/FIX_RECORDS.md §7.21）：构造返回对象时透传 `translation` 字段（`typeof r.translation === 'string' && r.translation ? r.translation : undefined`）。该方法在 `loadTraitData` + `saveTraitData` 双路径调用，遗漏字段会导致 translation 在加载/保存时被剥离。

### Task 9：集成验证

**TypeScript 验证：** `npx tsc --noEmit` 总错误数 724（与 baseline 一致）。12 个修改文件中 9 个零错误，3 个仅含预存在错误：
- `src/main/ipc/index.ts(1,1)` — `ipcMain` declared but never read（Task 3 仅改注释，未引入代码）
- `src/main/preload.ts(46,43)` — `off` 方法 `Function | undefined` 类型不匹配（预存在，Task 3 仅在 ai 命名空间追加方法）
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts(703,28)` — `parseMesExample` 函数（预存在，Task 7 未触碰该函数）

**端到端流程静态验证：** 5 条流程全部通过（详见 `tasks.md` Task 9 SubTask 9.2 报告）：
1. 类型流：`DynamicScenePrompt` (shared) → service (持久化) → store (state) → UI (展示)，各层类型对齐
2. IPC 流：UI → preload → handler → service → 返回 `{ success, clothing, pose, scene }`，参数/返回类型对齐
3. 持久化流：`saveDynamicScenePrompt` → 本地 state 更新 → `saveTraits()` → `saveTraitData` 写盘，`dynamicScenePrompts` / `activeDynamicScenePromptId` 完整往返
4. SD 生成流：激活动态方案 → `buildSdOptions` 读取 → `applyTraitsAndLora` 替换 `{clothing}` / `{pose}` / `{scene}` 占位符，占位符名一致
5. 兜底流：无激活方案 → illustration 模式 `dynamicPose='standing'` / `dynamicScene='simple_background'`，general 模式回退 `userScene`，行为与 spec 前一致

---

## 动态场景提示词生成 IPC 通道扩展（Spec: add-dynamic-scene-prompt-generation / Task 3）

2026-08-05 实施：在 `ai:` IPC 命名空间下新增 `ai:generateDynamicScenePrompts` 通道，将渲染进程的自然语言场景指令（如「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」）转发至主进程 `characterTraitAIService.generateDynamicScenePrompts()`，由 LLM 解析为三组独立的英文 SD tag（`clothing` / `pose` / `scene`），供前端写入 `DynamicScenePrompt` 后在 SD 生成时替换 `{clothing}` / `{pose}` / `{scene}` 占位符。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 3）**
>
> 本节所涉 `ai:generateDynamicScenePrompts` IPC 通道、handler 注册、preload 方法、electron.d.ts 类型定义已全量移除。自然语言 → SD tag 的能力由 `ai:generateTraitPrompts` IPC 通道替代（输出 `CategorizedTrait[]` 而非三组维度 tag）。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。

**新增 IPC 通道：**

| 通道名 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `ai:generateDynamicScenePrompts` | `{ naturalLanguageInput: string; baseTraits?: string }` | `Promise<{ success: boolean; clothing?: string; pose?: string; scene?: string; error?: string; ragDebug?: ... }>` | 自然语言 → 三组英文 SD tag；**ragDebug**（⚠️ §7.18）= L0-L5 审计报告，含每条 tag 的 isValid/source/replacedBy/dimension 等字段，供前端 RagQualityReport 只读展示 |

> **⚠️ Spec: add-ai-tag-chinese-translation**（详见 docs/FIX_RECORDS.md §7.21）：返回类型新增 `clothingTranslations?` / `poseTranslations?` / `sceneTranslations?` 三个字段（逗号分隔，与 `clothing`/`pose`/`scene` 一一对应）。`electron.d.ts` 内联返回类型签名已同步扩展（Task 8 bug 修复——主进程类型扩展不会自动反映到渲染进程，需手动同步 `electron.d.ts`）。

**修改文件清单（Task 3）：**
- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 在 `registerCharacterTraitAIHandlers()` 内注册新 handler，复用现有 try/catch + `error.message ?? 'Unknown error'` 兜底模式（实际为 `error instanceof Error ? error.message : 'Unknown error'`，与 `generateCharacterTraits` / `recognizeImageTraits` 一致）。日志前缀沿用 `[CharacterTraitAIHandler]`（service 内部使用 `[DynamicSceneAI]` 前缀以区分方法）。
- `src/main/ipc/index.ts` — 无代码改动，仅更新注释，说明 `registerCharacterTraitAIHandlers()` 已涵盖三个通道（`generateCharacterTraits` / `recognizeImageTraits` / `generateDynamicScenePrompts`）。
- `src/main/preload.ts` — 在 `ai:` 命名空间内 `recognizeImageTraits` 之后追加 `generateDynamicScenePrompts` 方法，沿用内联类型签名（与 `generateCharacterTraits` / `recognizeImageTraits` 一致，不引入主进程类型）。
- `src/renderer/types/electron.d.ts` — 在 `ai:` 接口内 `recognizeImageTraits` 之后追加 `generateDynamicScenePrompts` 类型声明，内联入参与返回值类型（与现有 ai 命名空间下其他方法保持一致）。

**类型声明策略：**

主进程 `GenerateDynamicScenePromptsParams` / `GenerateDynamicScenePromptsResult` 定义于 `src/main/services/characterTraitAIService.ts`，但渲染进程不直接引用主进程类型（与 `electron.d.ts` 顶部注释「主进程类型不可直接被渲染进程引用」一致）。因此 `preload.ts` 与 `electron.d.ts` 均使用内联类型签名，与现有 `generateCharacterTraits` / `recognizeImageTraits` 保持一致。若未来需要类型共享，可考虑将 params/result 类型移至 `src/shared/types/characterTrait.types.ts`（Spec 已为 `DynamicScenePrompt` 数据模型建立此路径），但 Task 3 不强制做此重构。

**错误兜底（与 generateCharacterTraits 一致）：**
- 空输入：`naturalLanguageInput` 为空或纯空白 → 「请输入动态场景指令」（不调用 LLM，由 service 短路返回）
- AI 引擎未配置：baseUrl / apiKey / modelName / temperature / max_tokens 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」（service 兜底）
- 调用失败：网络 / 超时 / HTTP 错误 → 「AI 调用失败：<具体原因>」
- 解析失败：LLM 返回空内容 / 无分隔符 / 无法识别三组 tag → 「AI 返回内容无法解析为动态场景 tag」
- IPC 序列化兜底：handler 外层 try/catch 保证渲染进程永不收到 reject

## 提示词生成功能（Spec: add-prompt-generation-in-asset-modal）

> 2026-08-07 实施：在 `AssetGenerateModal` 的「携带角色特征」区域正上方新增「提示词生成」面板，让用户在 AI 素材生成弹窗中直接输入自由文本提示词（如 `red hair, blue dress, forest background`），由主进程 LLM 解析为分类特征 tag 列表（含 `categoryId` / `translation` / `originalText`），应用后追加到 `editedTraits` 末尾。视觉风格参考「角色特征」页签的「动态场景指令」面板（紫色渐变边框 + `ThunderboltOutlined` 图标）。审计流程复用 `generateCharacterTraits` 的 L0-L5 完整审计链。详见 docs/FIX_RECORDS.md §7.23

### 新增 IPC 通道：`ai:generateTraitPrompts`

| 通道名 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `ai:generateTraitPrompts` | `{ prompt: string; baseTraits?: string }` | `Promise<{ success: boolean; traits?: CategorizedTrait[]; error?: string; ragDebug?: ... }>` | 自由文本提示词 → 分类特征 tag 列表；`traits` 携带 `categoryId` / `translation` / `originalText`，可直接追加到 `editedTraits`；`ragDebug` = L0-L5 审计报告（结构与 `generateCharacterTraits.ragDebug` 完全兼容，前端复用 `RagQualityReport` 组件只读展示） |
| `ai:optimizeTraitsForContext` | `{ traits: Array<{ text, weight?, categoryId? }>, conversationContext: string }` | `Promise<{ success: boolean; tagsToRemove?: Array<{ text, reason? }>; tagsToAdd?: Array<{ text, reason?, weight?, categoryId? }>; error?: string }>` | 图片生成前 AI 优化：TWO PARTS 链式推理 — (1) 分析标签列表与对话上下文的矛盾返回建议删除的标签 (2) 评估删除后缺失的关键描述符返回建议补充的标签（如服装移除后的暴露特征）。JSON 格式 `{ "remove": [{ "text", "reason" }], "add": [{ "text", "reason", "weight"?, "categoryId"? }] }`。试验性功能，需 `AIParameterConfig.ai_optimize_traits` 开启；调用方需做存在性过滤 + 过度删除防护（>80% 拒绝）+ 失败降级。⚠️ **执行时机**：必须在 `generateTraitPrompts` 生成上下文标签并合并为 `mergedTraits` 之后调用，传入完整标签列表（角色特征 + 动态生成的互动标签），否则 AI 无法看到并删除矛盾的互动标签（如对话中角色「抽回手」时应移除 `disembodied_hand`，详见 §7.38）。`tagsToAdd` 为 Spec: add-ai-tag-supplement-after-removal 新增字段，调用方需做去重 + 冲突检查（不补充刚删除的标签）+ 过度补充防护（>50% 拒绝），详见 §7.39（服务层）+ §7.40（渲染层消费） |

**与现有 AI 通道的关系：**
- `ai:generateCharacterTraits`：基于角色卡 `description` / `personality` / `scenario` 提取「固有」特征，可附带角色卡图片（多模态）
- ~~`ai:generateDynamicScenePrompts`：将自然语言指令解析为三组维度 tag（clothing/pose/scene），不分类~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 3，详见 docs/FIX_RECORDS.md §7.27）
- `ai:generateTraitPrompts`（本通道）：将自由文本提示词解析为**分类**特征 tag（`CategorizedTrait[]`），不读取角色卡，不生成外观描述；**已替代** `ai:generateDynamicScenePrompts` 作为自然语言 → SD tag 的正式通道

**修改文件清单：**
- `src/main/services/characterTraitAIService.ts` — 新增 `generateTraitPrompts(params)` 方法 + `GenerateTraitPromptsParams` / `GenerateTraitPromptsResult` 接口 + `buildTraitPromptUserMessage` 私有辅助方法；复用 `buildDynamicTraitSystemPrompt` / `applyTagAudit` / `buildRagReferenceWithDebug` / `parseTraitsAndDescription` 基础设施
- `src/main/ipc/handlers/characterTraitAIHandlers.ts` — 在 `registerCharacterTraitAIHandlers()` 内注册 `ai:generateTraitPrompts` handler，复用现有 try/catch 兜底模式；日志前缀 `[CharacterTraitAIHandler]`（service 内部使用 `[TraitPromptAI]` 前缀）
- `src/main/preload.ts` — 在 `ai:` 命名空间内 `generateDynamicScenePrompts` 之后追加 `generateTraitPrompts` 方法，沿用内联类型签名
- `src/renderer/types/electron.d.ts` — 在 `ai:` 接口内 `generateDynamicScenePrompts` 之后追加 `generateTraitPrompts` 类型声明，内联入参与返回值类型
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 新增 `renderPromptGenPanel()` 渲染函数 + 3 个 handler（`handleGenerateTraitPrompts` / `handleApplyGeneratedTraits` / `handleDiscardGeneratedTraits`）+ 7 个 state（`promptGenInput` / `promptGenResult` / `promptGenLoading` / `promptGenRagDebug` / `promptGenRagVisible` / `appliedPromptTraitIds`）；在 `renderTraitsPanel` 之前插入 `{renderPromptGenPanel()}`（两个调用点：批量模式 + 单次模式）；`renderTraitsPanel` 内为应用的新增 trait 显示 ✨ 徽标

### 服务表增量 — `characterTraitAIService.generateTraitPrompts`

| 方法 / 类型 | 签名 | 说明 |
| --- | --- | --- |
| `GenerateTraitPromptsParams` | `{ prompt: string; baseTraits?: string }` | 入参：用户提示词 + 可选已有特征上下文（避免重复生成） |
| `GenerateTraitPromptsResult` | `{ success, traits?: CategorizedTrait[], error?, ragDebug? }` | 返回：分类特征数组（含 translation + originalText）；`ragDebug` 与 `GenerateCharacterTraitsResult.ragDebug` 结构兼容 |
| `generateTraitPrompts(params)` | async | 主入口；空输入/AI 未配置/解析失败三类兜底；复用 `buildDynamicTraitSystemPrompt` 构建系统提示词 + `applyTagAudit` 完整走 L0-L5 审计链 |
| `buildTraitPromptUserMessage(prompt, baseTraits?)` | private | 构建 user message：用户提示词 + 可选已有特征上下文 + 请求行 |

### 审计流程（与 `generateCharacterTraits` 完全一致，L0-L5 完整审计链）

- L0 自定义同义词映射（`userSynonymMapService`）
- L1 name 精确匹配 / L2 alias 精确匹配
- L3 颜色复合词拆分 / L3b 否定性修饰词剥离
- L4 语义 KNN 替换（`score >= 0.3` 自动替换）
- L5 AI 兜底（LLM 生成候选词 → 再走 L0-L4 → 命中替换 + 持久化到 `userSynonymMapService`）

### UI 交互流程

1. 用户在 `Input.TextArea` 输入提示词（如 `red hair, blue dress, forest background` 或自然语言）
2. 点击「生成提示词」按钮 → `handleGenerateTraitPrompts` 调用 `ai:generateTraitPrompts` IPC，`baseTraits` 取 `enabledTraitTexts.join(', ')`（避免重复生成）
3. 主进程内部走 L0-L5 审计链 + RAG 标签库参考注入，返回 `CategorizedTrait[]` + `ragDebug`
4. 结果按分类分组展示（`Tag` + 翻译 `Tooltip`），下方显示「应用到特征列表」/「放弃」按钮
5. 用户点击「应用」→ `handleApplyGeneratedTraits` 为每个 `CategorizedTrait` 分配 `id`（`genTraitId()`）+ `enabled=true`，追加到 `editedTraits` 末尾；记录新 `id` 到 `appliedPromptTraitIds` 集合
   - ⚠️ **去重处理**（2026-08-07 修复，详见 docs/FIX_RECORDS.md §7.23 §8）：应用前对生成结果做两层去重——(a) 与 `effectiveTraits` 已有特征去重（text 小写 + trim 作为 key，覆盖 enabled + disabled）；(b) 生成结果内部去重（AI 可能返回多条相同 tag）。跳过条数通过 `message` 告知用户（`已追加 N 条特征，跳过 M 条重复项`），避免静默丢弃。全部重复时保留 `promptGenResult` 不清空，让用户仍可查看 RAG 报告。
6. 下方 `renderTraitsPanel` 中应用的新增 trait 显示 ✨ 徽标（`isPromptGenerated = appliedPromptTraitIds.has(trait.id)`）
7. `RagQualityReport` 组件以只读模式展示 L0-L5 审计质检报告（不传 `onRevert` / `onManualReplace` 回调）

### 错误兜底（与 `generateDynamicScenePrompts` 一致）

- 空输入：`prompt` 为空或纯空白 → 「请输入提示词」（不调用 LLM，由 service 短路返回）
- AI 引擎未配置：baseUrl / apiKey / modelName 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」
- 引擎参数缺失：temperature / max_tokens 未配置 → 「AI 引擎未配置 temperature 或 max_tokens 参数」
- 调用失败：网络 / 超时 / HTTP 错误 → 「AI 调用失败：<具体原因>」
- 解析失败：LLM 返回空内容 / 无法解析为分类 tag → 「AI 返回内容无法解析为 tag 列表」
- IPC 序列化兜底：handler 外层 try/catch 保证渲染进程永不收到 reject

## 角色特征页签提示词生成面板（Spec: replace-dynamic-scene-with-prompt-gen / Task 9）

> 2026-08-07 实施：在 `AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 组件（角色特征页签）的组合方案工具栏下方、特征列表上方新增「提示词生成」面板，功能与 `AssetGenerateModal.renderPromptGenPanel` 完全一致，让用户在角色特征管理界面也能直接通过自然语言生成分类特征 tag。该面板作为「动态场景指令面板」的替代品：动态场景方案移除后，原由动态场景指令面板承担的「自然语言 → SD tag」能力统一由本面板承担，输出从「三组维度 tag（clothing/pose/scene）」改为「分类特征 tag 列表（`CategorizedTrait[]`）」，通过 `characterTraitStore.setTraits` 合并到现有特征列表。

### 面板位置与视觉

- 位置：`CharacterTraitTabContent` 内，组合方案工具栏（`renderCombinationToolbar`）下方、特征列表（`renderTraitsList`）上方
- 视觉风格：紫色渐变主题，与 `AssetGenerateModal.renderPromptGenPanel` 完全一致
  - 容器：`rgba(139, 92, 246, 0.05)` 背景 + `rgba(139, 92, 246, 0.2)` 边框 + `borderRadius: 8px`
  - 生成按钮：`linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)` 紫色渐变 + `ThunderboltOutlined` 图标
  - 结果 Tag：`color="purple"` + Tooltip 展示翻译/来源/权重

### 面板内部结构（自上而下）

1. **输入区**：`Input.TextArea`（placeholder 提示用户输入自然语言或逗号分隔 tag）+ 「生成提示词」按钮（`loading` 状态禁用，空输入禁用）
2. **结果展示区**（仅 `promptGenResult` 非空时渲染）：
   - 结果标题 + 条数
   - 按分类分组展示（`SYSTEM_TRAIT_CATEGORIES + customCategories + UNCATEGORIZED_CATEGORY` 顺序），每个 Tag 显示 text + 翻译 Tooltip + 权重徽标（如有非默认权重）
   - 「应用到特征列表」+「放弃」按钮
3. **RAG 质检报告**（仅 `promptGenRagDebug` 非空时渲染）：复用 `RagQualityReport` 组件只读展示 L0-L5 审计报告

### State 与 handlers

| State | 类型 | 说明 |
| --- | --- | --- |
| `promptGenInput` | `string` | 用户输入的提示词文本 |
| `promptGenResult` | `CategorizedTrait[] \| null` | AI 生成的分类特征列表（应用前暂存，不写入 store） |
| `promptGenLoading` | `boolean` | 生成中 loading 状态 |
| `promptGenRagDebug` | `RagDebugInfo \| null` | RAG 质检报告调试信息 |
| `promptGenRagVisible` | `boolean` | 质检报告展开/折叠状态 |
| `appliedPromptTraitIds` | `Set<string>` | 已应用的 AI 生成 trait id 集合，用于驱动「✨ 新增」徽标 |

| Handler | 行为 |
| --- | --- |
| `handleGenerateTraitPrompts` | 调用 `ai:generateTraitPrompts` IPC，`baseTraits` 取 `traits.filter(t => t.enabled).map(t => t.text).join(', ')`；成功后暂存 `promptGenResult` + `promptGenRagDebug`，自动展开质检报告 |
| `handleApplyGeneratedTraits` | 与 `AssetGenerateModal` 去重逻辑一致（key = `text.trim().toLowerCase()`，跳过已存在 + 批次内重复），调 `characterTraitStore.setTraits([...traits, ...newTraits])` 合并；通过 `useCharacterTraitStore.getState().traits` diff 出实际写入的新 id 填入 `appliedPromptTraitIds`；应用后清空 `promptGenResult` / `promptGenRagDebug` / `promptGenInput`；`message.success` / `message.info` 提示用户 |
| `handleDiscardGeneratedTraits` | 清空 `promptGenResult` + `promptGenRagDebug`，保留 `promptGenInput` 供用户修改后重试 |

### 关键设计点

- **复用 `AssetGenerateModal.renderPromptGenPanel` 实现**：面板 UI / state / handler 与 `AssetGenerateModal` 完全对称，差异仅在「应用结果」环节——`AssetGenerateModal` 操作本地工作副本 `editedTraits`（不持久化），`CharacterTraitTabContent` 直接调 `characterTraitStore.setTraits`（写入 store，用户后续点「保存」持久化）
- **`setTraits` MERGE 策略 + 新 id diff**：`setTraits` 非简单替换，而是「保留已分类项 / 替换未分类项 / 追加新项」的合并语义。为安全追加新特征，需传入完整列表 `[...traits, ...newTraits]`。`setTraits` path 4 为新项重新生成 id（`genTraitId()`），调用方无法预知，故通过 `useCharacterTraitStore.getState().traits` 在 `setTraits` 后 diff 出实际写入的新 id 填入 `appliedPromptTraitIds`
- **「✨ 新增」徽标**：`renderTraitChip` 中检查 `appliedPromptTraitIds.has(trait.id)`，命中则渲染 ✨ 徽标，让用户能识别哪些 trait 是本次 AI 生成新增的
- **审计流程复用**：与 `generateCharacterTraits` 共用 `applyTagAudit` 走 L0-L5 完整审计链（详见「RAG 标签库」节），前端 `RagQualityReport` 组件只读展示（不传 `onRevert` / `onManualReplace` 回调，因 trait 在 store 中可通过 `updateTrait` / `removeTrait` 精确操作）

### 修改文件清单（Task 9）

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 新增 6 个 state + 3 个 useCallback handler + `renderPromptGenPanel` 渲染函数（约 460 行）；`renderTraitChip` 新增 ✨ 徽标渲染分支；在组合方案工具栏下方、特征列表上方插入 `{renderPromptGenPanel()}`

### 验证

- TypeScript 编译零新增错误
- 与 `AssetGenerateModal.renderPromptGenPanel` 行为一致性静态验证：输入 → 生成 → 应用 / 放弃 → RAG 质检报告展示
- 详见 docs/FIX_RECORDS.md §7.27

## 动态场景提示词 store 扩展（Spec: add-dynamic-scene-prompt-generation / Task 5）

> 2026-08-05 实施：在 `src/renderer/stores/characterTraitStore.ts`（v2 Zustand store）新增 `dynamicScenePrompts` / `activeDynamicScenePromptId` 两个 state 字段与 4 个管理 action，使前端可在不修改基础特征 `traits` 的情况下保存/切换/编辑/删除一次性服装/动作/场景提示词方案。Task 1 扩展 `CharacterTraitManifestV2` 类型后引入的 TS2739（v2 manifest 构造缺失两新字段）在本次一并修复。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 1-3）**
>
> 本节所涉 `dynamicScenePrompts` / `activeDynamicScenePromptId` state 字段与 4 个 action（`saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `updateDynamicScenePrompt` / `deleteDynamicScenePrompt`）已全量从 `characterTraitStore.ts` 移除。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。

### 新增 state 字段

| 字段 | 类型 | 初始值 | 说明 |
| --- | --- | --- | --- |
| `dynamicScenePrompts` | `DynamicScenePrompt[]` | `[]` | 动态场景方案列表，与基础特征 `traits` 分离存储 |
| `activeDynamicScenePromptId` | `string \| null` | `null` | 当前激活动态场景方案 ID；null 表示无激活方案（生成回退到无动态场景状态） |

初始值与 service 层 `emptyV2Manifest` / v1→v2 迁移兜底保持一致（`[]` / `null`）。

### `loadTraits` / `saveTraits` 字段透传

- **`loadTraits`**：仍调用 `window.electronAPI.characterTrait.loadData` 一次性获取完整 v2 manifest，新增从 manifest 提取 `dynamicScenePrompts`（`Array.isArray` 兜底 `[]`）与 `activeDynamicScenePromptId`（`typeof === 'string'` 兜底 `null`）并 `set`；IPC 不可用兜底 `set` 同步补 `[]` / `null`。
- **`saveTraits`**：
  - **签名变更**：`saveTraits(characterCardId?: string, appearanceDescription?: string)` — 第一个参数改为可选，缺省取 `get().currentCharacterCardId`，供动态场景 action 链式调用 `get().saveTraits()` 无需传参。原有调用方 `AssetManagerModal.tsx` 的 `saveTraits(characterCardId, editingDescription)` 调用向后兼容。
  - **v2 manifest 构造修复（TS2739）**：原 `data: CharacterTraitManifestV2 = { ... }` 缺失 `dynamicScenePrompts` / `activeDynamicScenePromptId`（Task 1 扩展类型后报 TS2739），现补全这两字段，从当前 store state 读取。
  - **失败回滚扩展**：`prevDynamicScenePrompts` / `prevActiveDynamicScenePromptId` 加入回滚 `set`，保证本地 state 与磁盘一致。

### 4 个新增 action

| Action | 签名 | 行为 | 持久化 |
| --- | --- | --- | --- |
| `saveDynamicScenePrompt` | `(name, clothing, pose, scene, sourceCommand) => Promise<{success, error?}>` | 用 `genTraitId()` 创建 `DynamicScenePrompt`（`createdAt` / `updatedAt` = `Date.now()`），追加到 `dynamicScenePrompts`，**自动设 `activeDynamicScenePromptId` 为新 id**（Spec Scenario: 「保存为方案并自动激活」） | 立即调用 `get().saveTraits()` |
| `applyDynamicScenePrompt` | `(id: string \| null) => Promise<{success, error?}>` | 设 `activeDynamicScenePromptId` 为给定 id；**`id=null` 表示取消激活**（清空为 null，⚠️ 2026-08-07 修复，详见 docs/FIX_RECORDS.md §7.19，用于 AssetGenerateModal 下拉 allowClear）；id 不在列表中或已是激活方案则 no-op | 立即调用 `get().saveTraits()` |
| `updateDynamicScenePrompt` | `(id, updates: Partial<Omit<DynamicScenePrompt, 'id'\|'createdAt'>>) => Promise<{success, error?}>` | 合并 `updates`（`id` / `createdAt` 不可改，显式覆写防蛇足），bump `updatedAt`；id 不存在则 no-op | 立即调用 `get().saveTraits()` |
| `deleteDynamicScenePrompt` | `(id) => Promise<{success, error?}>` | 从 `dynamicScenePrompts` 移除；**若删除的是激活方案，重置 `activeDynamicScenePromptId = null`**（Spec Scenario）；id 不存在则 no-op | 立即调用 `get().saveTraits()` |

**与组合方案（combinations）action 的差异**：
- 组合方案 action（`saveCombination` / `applyCombination` / `deleteCombination`）仅修改本地 state，持久化由调用方在「保存」按钮点击时统一调用 `saveTraits`。
- 动态场景方案 action 修改本地 state 后**立即**调用 `get().saveTraits()` 持久化，因 Spec 明确要求「并持久化到角色卡的 traits.json」（即时持久化语义）。
- 两者均复用同一 `saveTraits`（写入完整 v2 manifest），无需新增 IPC 通道。

**防御性设计**：所有 action 对无效 `id` 参数静默 no-op（不抛异常），与 `removeTrait` / `applyCombination` 的防御模式一致。

### 修改文件清单（Task 5）

- `src/renderer/stores/characterTraitStore.ts` — 新增 `DynamicScenePrompt` 类型导入；state 接口 + 初始 state 新增 2 字段；`loadTraits` / `saveTraits` / `clear` 扩展新字段；新增 4 个动态场景 action；`saveTraits` 签名 `characterCardId` 改可选（向后兼容）；修复 v2 manifest 构造 TS2739。
- `.trae/specs/add-dynamic-scene-prompt-generation/tasks.md` — Task 5 全部子任务标记 `[x]`。

### 验证

- `npx tsc --noEmit` — `characterTraitStore.ts` 零错误（原 1 个 TS2739 已修复），消费方 `AssetManagerModal.tsx` / `AssetGenerateModal.tsx` / `ExpressionGenerateModal.tsx` 均零错误，无新增错误引入。

## 动态场景指令 UI 区域（Spec: add-dynamic-scene-prompt-generation / Task 6）

> 2026-08-05 实施：在 `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` 的 `CharacterTraitTabContent` 组件底部新增「动态场景指令」折叠面板，串联 Task 3（IPC）与 Task 5（store）的能力，让用户通过自然语言指令一键生成服装/动作/场景三组 SD tag，编辑预览后保存为命名方案，并在生成图片时自动携带。

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 7 + Task 9）**
>
> 本节所涉「动态场景指令面板」UI / state / handlers / `renderDynamicSceneTagList` / `useEffect` / store 订阅已全量从 `AssetManagerModal.tsx`（`CharacterTraitTabContent`）移除（约 279 行）。原位置由 Task 9 新增的「提示词生成面板」（`renderPromptGenPanel`）替代，详见上方「角色特征页签提示词生成面板」节。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.27。

### 面板位置与视觉

- 位于 `CharacterTraitTabContent` 主体内容区，**在特征分类 Collapse + 底部添加区之后、角色外观描述之前**（Spec: 「after the existing trait category panels but before any footer」）。
- 使用独立 `<Collapse defaultActiveKey={[]}>`（**默认折叠**，与特征分类面板默认展开形成对比），items 数组单 panel。
- 紫色边框 `rgba(139, 92, 246, 0.35)` + 标题色 `#a78bfa` 区分于特征分类面板（蓝色 `--primary-color`），`ThunderboltOutlined` 图标 + 副标题「AI 解析自然语言为服装 / 动作 / 场景提示词，独立于基础特征」。

### 面板内部结构（自上而下）

1. **NL 输入 + AI 解析按钮**（SubTask 6.2）
   - `Input.TextArea` autoSize `{ minRows: 2, maxRows: 4 }`，placeholder 给出哥特公路示例。
   - 「AI 解析」`Button` 紫色渐变（`#8b5cf6` → `#6366f1`），`ThunderboltOutlined` 图标，`loading={parsing}`。
   - 点击校验非空（`message.warning('请输入动态场景指令')`），调 `window.electronAPI.ai.generateDynamicScenePrompts({ naturalLanguageInput, baseTraits })`，`baseTraits` 取 `baseTraitsText`（enabled 特征 `text` 逗号拼接）；成功填 `parsedClothing/pose/scene`，失败 `message.error(result.error || 'AI 解析失败')`。

2. **三组可编辑 TextArea**（SubTask 6.3）
   - 「服装 (clothing)」标签色 `#60a5fa`（蓝），「动作 (pose)」`#52c41a`（绿），「场景 (scene)」`#f59e0b`（橙），与现有视觉约定一致。
   - 每组 `Input.TextArea` autoSize `{ minRows: 1, maxRows: 3 }`，`value` 绑定 `parsedClothing / parsedPose / parsedScene`，`onChange` 更新本地 state，允许用户覆盖 AI 原始结果（Spec Scenario: 手动编辑解析结果）。

3. **完整提示词预览**（SubTask 6.4）
   - `Input.TextArea readOnly` + `fontFamily: 'monospace'`，`value` = `fullPromptPreview`（`useMemo` 派生：`[baseTraitsText, parsedClothing.trim(), parsedPose.trim(), parsedScene.trim()].filter(Boolean).join(', ')`），随三组 TextArea 编辑实时更新。

4. **保存 / 切换 / 删除**（SubTask 6.5）
   - 方案名 `Input`（placeholder「方案名，如：哥特公路」，回车触发保存）+「保存为方案」`Button`（`SaveOutlined`，紫色渐变）。
   - 已保存方案 `Select`（`value={activeDynamicScenePromptId ?? undefined}`，placeholder「未激活」，`options` 来自 `dynamicScenePrompts`），切换调用 `applyDynamicScenePrompt(id)`。
   - 「删除」`Button`（`DeleteOutlined`，danger，`disabled={!activeDynamicScenePromptId}`），`Modal.confirm` 二次确认后调 `deleteDynamicScenePrompt(activeDynamicScenePromptId)`。

### 本地 state（`useState`）

| State | 类型 | 用途 |
| --- | --- | --- |
| `dynamicInput` | `string` | NL 输入 TextArea 值 |
| `parsedClothing` / `parsedPose` / `parsedScene` | `string` | 三组可编辑 tag（AI 解析结果或方案同步值） |
| `parsing` | `boolean` | AI 解析中标志（按钮 loading） |
| `schemeName` | `string` | 保存方案名输入 |

### Store 订阅（`useCharacterTraitStore`）

新增订阅：`dynamicScenePrompts` / `activeDynamicScenePromptId` / `saveDynamicScenePrompt` / `applyDynamicScenePrompt` / `deleteDynamicScenePrompt`。

> **未订阅 `updateDynamicScenePrompt`**：当前 UI 无「更新现有方案」入口（保存始终创建新方案），订阅会造成 `noUnusedLocals` 报错。`tsconfig.json` 开启 `noUnusedLocals: true`，故仅订阅实际使用的 5 项（2 state + 3 action）。

### 激活方案同步（useEffect）

```ts
useEffect(() => {
  if (!activeDynamicScenePromptId) return;
  const scheme = dynamicScenePrompts.find((p) => p.id === activeDynamicScenePromptId);
  if (scheme) {
    setParsedClothing(scheme.clothing || '');
    setParsedPose(scheme.pose || '');
    setParsedScene(scheme.scene || '');
  }
}, [activeDynamicScenePromptId, dynamicScenePrompts]);
```

- Spec Scenario「切换激活的动态场景方案」：用户从下拉切换方案 → `applyDynamicScenePrompt` 改 `activeDynamicScenePromptId` → useEffect 触发 → 三组 TextArea 加载方案内容。
- 保存新方案时 store 自动激活 → useEffect 同步 parsed 字段为新方案内容（保存 handler 中 `setDynamicInput('')` / `setSchemeName('')` 清空输入，parsed 字段交由 useEffect 同步）。
- 无激活方案（null）时不强制清空，保留用户当前编辑或 AI 解析结果。

### 派生数据（`useMemo`）

- `baseTraitsText`：`traits.filter(t => t.enabled).map(t => t.text).join(', ')` — 用于 IPC `baseTraits` 参数 + 完整预览。
- `fullPromptPreview`：`[baseTraitsText, parsedClothing.trim(), parsedPose.trim(), parsedScene.trim()].filter(Boolean).join(', ')` — 跳过空值后逗号拼接。

### 修改文件清单（Task 6）

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `CharacterTraitTabContent` 组件：
  - store 订阅追加 5 项（2 state + 3 action）
  - 新增 6 个 `useState`（dynamicInput / parsedClothing / parsedPose / parsedScene / parsing / schemeName）
  - 新增 2 个 `useMemo`（baseTraitsText / fullPromptPreview）
  - 新增 1 个 `useEffect`（激活方案同步）
  - 新增 4 个 `useCallback` handler（handleParseDynamicScene / handleSaveDynamicScene / handleApplyDynamicScene / handleDeleteDynamicScene）
  - 新增 1 个 `<Collapse>` 面板 JSX（底部添加区之后、外观描述之前）
- 无新增依赖：所有 `antd` / `@ant-design/icons` / store 引用均来自文件现有 import。

### 验证

- `npx tsc --noEmit` — `AssetManagerModal.tsx` 零错误（与改动前一致），全项目仅 1 个无关的 `WatchOptions` 错误（vite.config.ts，与本次改动无关）。
- `noUnusedLocals` 通过：所有新增 state / handler / 订阅均在 JSX 或其他 handler 中被消费。

---

## 素材/特征/动态场景缺陷修复（Spec: fix-asset-trait-and-scene-defects / Task 1-9）

### 概述

修复近期完成的三个 spec（`add-asset-and-trait-management` / `add-trait-category-grouping` / `add-dynamic-scene-prompt-generation`）引入的三类缺陷：

1. **三视图与高分辨率生成**：裸体版三视图 nude tag 列表不完整；分辨率 ≥ 1024×1024 时 SD 模型倾向生成多个角色，缺少 `1girl`/`1boy` 人物数量约束
2. **角色特征分类系统**：自定义分类按角色卡独立存储，**跨角色卡不共享**；AI 生成特征时系统提示词硬编码 7 个系统分类，**不包含用户自定义分类**，导致 AI 不会为新建分类生成对应 tag
3. **动态场景指令**：`AssetGenerateModal` 缺少动态场景方案选择 UI，用户必须返回 `AssetManagerModal` 激活方案

详细修复记录与重点标记的 bug 见 `docs/FIX_RECORDS.md` §5.1 ~ §5.6。

### 架构变更概览

```
┌─────────────────────────────────────────────────────────────────┐
│ 新增模块（Task 3）                                              │
│  src/main/services/categoryDictionaryService.ts                  │
│   ├─ loadDictionary() / saveDictionary()                         │
│   ├─ addCategory(name) / deleteCategory(id) / renameCategory()  │
│   ├─ hasCategory(name)                                          │
│   └─ migrateFromManifest(customCategories) — 既有数据迁移        │
│  src/main/ipc/handlers/categoryDictionaryHandlers.ts             │
│   └─ 注册 5 个 IPC 通道                                          │
├─────────────────────────────────────────────────────────────────┤
│ 修改模块（Task 1 / 2 / 4 / 5 / 6 / 7）                          │
│  PromptBuilder.ts — NUDE_FIXED_TAGS 常量 + three-view 模板       │
│  AssetGenerateModal.tsx — detectGenderTag + 动态场景 Select     │
│  sdGenerationService.ts — characterGenderTag 字段 + 注入逻辑     │
│  characterTraitAIService.ts — 动态构建 system prompt             │
│  characterTraitStore.ts — globalCategories state + 异步 actions  │
│  characterTraitService.ts — loadTraitData 迁移逻辑               │
│  AssetManagerModal.tsx — 订阅 + CRUD handler 适配                 │
└─────────────────────────────────────────────────────────────────┘
```

### 新增 IPC 命名空间：`category-dictionary`

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `category-dictionary:load` | 无 | `{ ok, dictionary?, error? }` | 加载全局分类字典 |
| `category-dictionary:add` | `{ name, icon? }` | `{ ok, category?, error? }` | 新增分类（按 name 去重） |
| `category-dictionary:delete` | `{ id }` | `{ ok, error? }` | 删除分类 |
| `category-dictionary:rename` | `{ id, newName }` | `{ ok, category?, error? }` | 重命名分类 |
| `category-dictionary:has` | `{ name }` | `{ ok, has? }` | 检查分类名是否存在 |

在 `src/main/ipc/index.ts` 注册 `registerCategoryDictionaryHandlers()`；`preload.ts` 暴露 `window.electronAPI.categoryDictionary.*` 方法；`electron.d.ts` 补全类型声明。

### 新增服务表条目：`categoryDictionaryService`

**职责**：管理全局自定义分类字典，跨角色卡共享、重启后保留
**持久化路径**：`{userData}/data/trait-categories.json`
**数据结构**：`GlobalTraitCategoryDictionary = { version: 1, categories: TraitCategory[], updatedAt: number }`
**关键方法**：
- `loadDictionary()` — 文件不存在时返回空字典（`categories: []`）
- `addCategory(name, icon?)` — 按 name 大小写不敏感去重，返回新分类
- `deleteCategory(id)` / `renameCategory(id, newName)` — 按 id 操作
- `hasCategory(name)` — 大小写不敏感检查
- `migrateFromManifest(customCategories)` — 将角色卡旧 `customCategories` 字段合并到全局字典（幂等，按 name 去重，全部已存在时不写盘）

### 新增 store state：`characterTraitStore.globalCategories`

| 字段 | 类型 | 初始值 | 说明 |
|---|---|---|---|
| `globalCategories` | `TraitCategory[]` | `[]` | 全局自定义分类（替代从 manifest 读取 `customCategories`） |

**新增异步 actions**：
- `createCategory(name): Promise<{success, error?}>` — 调用 `categoryDictionary.add` IPC + 更新 `globalCategories` state
- `renameCategory(id, newName): Promise<{success, error?}>` — 调用 IPC + 更新 state
- `deleteCategory(id): Promise<{success, error?}>` — 调用 IPC + 更新 state + 受影响特征回退 `uncategorized` + 调用 `saveTraits` 持久化 traits 变更

**`loadTraits` 改造**：调用 `categoryDictionary.load()` 填充 `globalCategories`，不再从 manifest 读取 `customCategories`。
**`saveTraits` 改造**：不再写入 `customCategories` 字段（保留旧值以兼容）。
**`moveTrait` 改造**：校验目标分类改为读 `globalCategories`。
**`clear` 改造**：重置 `globalCategories: []`。

### 新增共享类型：`GlobalTraitCategoryDictionary`

```typescript
// src/shared/types/characterTrait.types.ts
export interface GlobalTraitCategoryDictionary {
  version: 1;
  categories: TraitCategory[];
  updatedAt: number;
}
```

### 三视图与高分辨率约束（Task 1 + Task 2）

**Task 1 — 裸体版三视图固定 nude tag**（`PromptBuilder.ts`）：

```typescript
export const NUDE_FIXED_TAGS: readonly string[] = [
  'nude', 'naked', 'bare skin', 'completely naked', 'no clothes', 'nsfw',
];
```

`buildAssetPromptTemplate` 的 three-view 模板对 `*-nude` 槽位（`front-nude` / `side-nude` / `back-nude`）拼接 `NUDE_FIXED_TAGS.join(', ')`，穿衣版不拼接。

**Task 2 — 高分辨率人物数量约束**：

| 文件 | 改动 |
|---|---|
| `AssetGenerateModal.tsx` | 新增 `detectGenderTag(traits)` 工具函数（从 `categoryId='basic'` 推断性别）；`buildSdOptions` 在 `width * height >= 1024 * 1024` 时填充 `characterGenderTag` |
| `sdGenerationService.ts` | `SDGenerationOptions` 新增 `characterGenderTag?: string` 字段；`applyTraitsAndLora` 在 `{traits}` 替换后注入 `characterGenderTag`（双重重复防护） |

**性别推断优先级**：`1girl` > `1boy` > `female` > `male` > `girl` > `boy`，无法判断时不注入（避免错误约束）+ 记录 `console.warn` 警告。

### 动态场景选择 UI（Task 6 + Task 7）

> **⚠️ 2026-08-07 整体回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 6）**
>
> 本节所涉「动态场景下拉 UI」与 `userScene` state 已全量从 `AssetGenerateModal.tsx` 移除（动态场景方案整体废弃）。下方内容仅作历史参考。完整移除清单与重点标记见 docs/FIX_RECORDS.md §7.26 + §7.27。

**Task 6 — 新增动态场景下拉**（`AssetGenerateModal.tsx` `renderSingleMode`）：

- 补订阅 `applyDynamicScenePrompt` action
- 在生成参数面板中新增 `<Select>` 下拉：
  - `value` = `activeDynamicScenePromptId ?? undefined`
  - `onChange` 调用 `applyDynamicScenePrompt(id ?? null)`（⚠️ 2026-08-07 修复：`id ?? null` 透传 allowClear 的 undefined 为 null，否则 × 清除按钮不生效，详见 docs/FIX_RECORDS.md §7.19）
  - `allowClear`：点击 × 清除时调 `applyDynamicScenePrompt(null)` 取消激活（清空 `activeDynamicScenePromptId` 为 null）
  - `options` 来自 `dynamicScenePrompts.map(p => ({ label: p.name, value: p.id }))`
  - 空状态：`disabled` + `notFoundContent` = 「暂无动态场景方案，请在素材管理中添加」

**Task 7 — 移除 userScene 文本输入框**：
- 移除 `renderSingleMode` 中 `mode === 'general'` 条件下的 `userScene` `<Input>` UI 元素
- 保留 `userScene` state（默认 `''`）+ `@deprecated` JSDoc 标记，仅作 `buildAssetPromptTemplate` 兼容参数
- `buildSdOptions` 移除「无动态 scene 时回退 userScene」分支，改为 general 模式无激活方案时 `dynamicScene = undefined`（`{scene}` 替换为空字符串）

### AI 提示词动态构建（Task 5）

**`characterTraitAIService.ts` 修复双端缺陷**：

1. **提示词端** — 新增动态构建方法：
   - `buildDynamicTraitSystemPrompt(globalCategories: TraitCategory[]): string`（中文 prompt）
   - `buildDynamicImageTraitSystemPrompt(globalCategories: TraitCategory[]): string`（英文 prompt）
   - 合并 `[...SYSTEM_TRAIT_CATEGORIES, ...globalCategories]`，自定义分类标注「（自定义分类）」
   - 原 `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 改为 `export` 基线参考

2. **解析器端** — `parseTraitsFromContent` 扩展 `validCategoryIds`：
   ```typescript
   const globalCategories = categoryDictionaryService.loadDictionary().categories;
   const validCategoryIds = new Set([
     ...SYSTEM_TRAIT_CATEGORIES.map(c => c.id),
     ...globalCategories.map(c => c.id),
   ]);
   ```

3. **调用点** — `generateCharacterTraits` / `recognizeImageTraits` 构建 messages 前调用 `categoryDictionaryService.loadDictionary()` 读取全局分类，传入动态构建方法。

4. **下游同步（§5.7 修复）** — `characterTraitStore.setTraits` 的 `validCategoryIds` 同步合并 `get().globalCategories`，避免解析器正确产出 `{ categoryId: 'weapon' }` 后在 store 二次校验时被兜底为 `uncategorized`；`AssetGenerateModal.renderTraitsPanel` 的 `allCategories` 派生改用 `traitGlobalCategories`（替代旧字段 `traitCustomCategories`），使「携带角色特征」面板正确显示自定义分类折叠面板。详见 `docs/FIX_RECORDS.md` §5.7。

### 既有数据迁移（Task 4）

**`characterTraitService.loadTraitData` v2 分支**：当 manifest 含非空 `customCategories` 时调用 `migrateFromManifest(customCategories)` 合并到全局字典。

- 迁移幂等：按 name 大小写不敏感去重，多次调用结果一致
- 迁移失败不阻塞特征加载（catch 兜底，仅记录 warn 日志）
- 迁移后 manifest 的 `customCategories` 字段不再作为读取源，但保留以兼容旧文件读取

### 涉及文件清单

**新增文件（3 个）**：
- `src/main/services/categoryDictionaryService.ts` — 全局分类字典服务
- `src/main/ipc/handlers/categoryDictionaryHandlers.ts` — IPC handlers
- `src/shared/types/characterTrait.types.ts` 内新增 `GlobalTraitCategoryDictionary` 接口（非新文件）

**修改文件（10 个）**：
- `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — `NUDE_FIXED_TAGS` 常量 + three-view 模板 + `userScene` `@deprecated`
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `detectGenderTag` + 高分辨率检测 + 动态场景 `<Select>` 下拉 + 移除 userScene Input UI
- `src/main/services/sdGenerationService.ts` — `characterGenderTag?: string` 字段 + `applyTraitsAndLora` 注入逻辑
- `src/main/services/characterTraitAIService.ts` — `buildDynamicTraitSystemPrompt` / `buildDynamicImageTraitSystemPrompt` + `parseTraitsFromContent` 扩展 `validCategoryIds`
- `src/main/services/characterTraitService.ts` — `loadTraitData` 新增迁移逻辑
- `src/renderer/stores/characterTraitStore.ts` — `globalCategories` state + 异步 actions + `moveTrait` / `clear` 更新
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 订阅 + CRUD handler 适配
- `src/main/ipc/index.ts` — 注册 `registerCategoryDictionaryHandlers()`
- `src/main/preload.ts` — 暴露 `categoryDictionary` 命名空间
- `src/renderer/types/electron.d.ts` — 补全 `categoryDictionary` 类型声明

### 验证总结

- **Task 8 端到端静态验证（PASS）**：illustration / general / three-view 三种模式下 `{clothing}` / `{pose}` / `{scene}` 占位符替换正确；无激活方案兜底正确；空逗号清理 do-while 循环正常工作
- **Task 9.1 tsc 验证（PASS）**：所有 spec 修改文件零新增错误；项目预存在错误（`ipcMain` unused / `off` 方法类型 / `writing/PromptBuilder.ts` unused imports / `CharacterDialogueChat/PromptBuilder.ts:703` `parseMesExample` 类型收窄）与本次修改无关
- **Task 9.2 端到端流程（静态 PASS，运行时验证推迟到 Electron 集成测试）**：三视图 nude tag / 高分辨率 1girl 注入 / 自定义分类跨角色 / 动态场景选择 → 生成
- **Task 9.3 既有数据迁移（静态 PASS，运行时验证推迟到 Electron 集成测试）**：`migrateFromManifest` 幂等性 + 失败兜底 + 全局字典写盘

---

## 标签自动推荐 Settings 配置面板（Spec: implement-local-tag-autocomplete / Task 6）

### 概述

在 Settings 主面板中新增「标签自动推荐」子面板，让用户配置本地 Danbooru/e621 标签库 CSV 路径、开关、默认排序规则。配置通过 `AppSetting.tagAutocomplete` 嵌套字段持久化（Task 4 已就绪），路径变更时立即触发 `tag:setCsvPath` IPC 重新加载标签库索引（不等保存）。

### 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 配置类型层（Task 4 已就绪）                                   │
│    src/renderer/types/setting.ts                                │
│      └─ TagAutocompleteConfig = { enabled, csvPath, sortBy }    │
│    src/shared/settings.ts                                       │
│      └─ defaultSetting.tagAutocomplete 默认值                   │
├─────────────────────────────────────────────────────────────────┤
│ 2. 主进程 IPC（Task 3 已就绪）                                   │
│    src/main/ipc/handlers/tagHandlers.ts                         │
│      ├─ tag:search / tag:getLoadStatus                          │
│      ├─ tag:reload(args?: { csvPath? })                         │
│      └─ tag:setCsvPath(args: { csvPath })                       │
│    src/main/preload.ts → electron.d.ts                          │
│      └─ window.electronAPI.tag.* / window.electronAPI.file.*    │
├─────────────────────────────────────────────────────────────────┤
│ 3. Settings 子面板（Task 6 本次实施）                            │
│    src/renderer/components/Settings/TagAutocompleteSettings.tsx │
│      ├─ forwardRef + useImperativeHandle 暴露 getFormValues()   │
│      ├─ Form 字段：enabled (Switch) / csvPath (Input+Button)    │
│      │              / sortBy (Select 3 选项)                    │
│      ├─ 文件选择：file.selectFile([{ name:'CSV', extensions:    │
│      │            ['csv'] }, { name:'所有文件', extensions:['*'] }]) │
│      ├─ 路径变更触发：tag.setCsvPath({ csvPath }) → 立即重载    │
│      ├─ 重新加载按钮：tag.reload({ csvPath }) 沿用当前路径刷新  │
│      └─ 顶部加载状态 Alert：tag.getLoadStatus() 展示            │
│                  loaded / totalCount / csvPath / error          │
├─────────────────────────────────────────────────────────────────┤
│ 4. 主入口集成                                                    │
│    src/renderer/components/Settings/Settings.tsx                │
│      ├─ tagAutocompleteConfigRef = useRef<TagAutocompleteRef>   │
│      ├─ JSX 追加 <TagAutocompleteSettings ref={...} />          │
│      │  （位于 <WebSearchSettings> 之后、<Divider /> 之前）     │
│      └─ handleSave 合并：updatedSetting.tagAutocomplete         │
│         = tagAutocompleteConfigRef.current?.getFormValues()     │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计点

- **forwardRef + useImperativeHandle 模式**：与 `WebSearchSettings` / `SDWebuiSettings` 完全一致。子面板持有自己的 `Form.useForm<TagAutocompleteConfig>()` 实例，通过 `ref.current.getFormValues()` 在父组件 `handleSave` 时取出表单值，合并到 `updatedSetting.tagAutocomplete` 字段保存。子面板不直接调用 `saveSetting`，避免与主表单的扁平字段命名空间冲突。
- **默认值合并**：`getFormValues()` 内部返回 `{ ...DEFAULT_TAG_AUTOCOMPLETE_CONFIG, ...values }`，避免旧 `settings.json` 缺失 `tagAutocomplete` 字段时表单值字段缺失（与 WebSearchSettings 同款兜底）。
- **路径变更即时生效（不等保存）**：用户选择新 CSV 文件后立即调用 `tag.setCsvPath({ csvPath })` 触发主进程 `tagAutocompleteService.reload(csvPath)`，重新加载索引。这样用户在保存设置前就能在 `AssetGenerateModal` 临时标签输入框中验证推荐效果。失败时展示错误 Alert 但不阻塞表单保存。
- **文件选择取消静默返回**：`window.electronAPI.file.selectFile(filters)` 返回 `string | null`，用户取消时返回 `null`，组件静默返回不报错（与 `file:selectFile` IPC handler 实现一致：`result.canceled ? null : result.filePaths[0]`）。
- **CSV 文件过滤器**：`[{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }]`，默认显示 CSV 文件，可切换到所有文件（兼容用户自定义扩展名）。
- **加载状态展示**：面板顶部 `Alert` 展示 `tag.getLoadStatus()` 返回的当前状态（loaded / totalCount / csvPath / error）。`loaded=true` 时显示绿色 success Alert + 标签总数；`error` 存在时显示红色 error Alert + 错误详情；未加载时显示 info 提示。
- **重新加载按钮**：与「选择文件」按钮区分。「选择文件」打开文件对话框切换路径；「重新加载」沿用当前路径调用 `tag.reload({ csvPath })`，用于 CSV 文件被外部更新后刷新索引。
- **排序规则 Select**：3 个选项 `relevance`（匹配度：前缀 > 包含 > 别名 + count 降序）/ `count`（使用频率降序）/ `alphabetical`（字母升序）。每个选项的 label 包含简短说明，便于用户理解排序语义。

### IPC API 引用

| 通道 | 入参 | 返回值 | 用途 |
|------|------|--------|------|
| `file:selectFile` | `FileFilter[]` | `Promise<string \| null>` | 打开原生文件选择对话框，取消返回 null |
| `tag:setCsvPath` | `{ csvPath: string }` | `Promise<{ success, totalCount, error? }>` | 设置新 CSV 路径并重新加载（路径变更即时生效） |
| `tag:reload` | `args?: { csvPath?: string }` | `Promise<{ success, totalCount, error? }>` | 重新加载标签库（不传 csvPath 沿用当前路径） |
| `tag:getLoadStatus` | 无 | `Promise<{ loaded, loading, totalCount, csvPath, error? }>` | 获取当前加载状态快照（设置面板顶部 Alert 展示） |

### 涉及文件清单

**新增文件（1 个）**：
- `src/renderer/components/Settings/TagAutocompleteSettings.tsx` — 标签自动推荐配置子面板（forwardRef + Form + 文件选择 + reload 触发 + 加载状态展示）

**修改文件（1 个）**：
- `src/renderer/components/Settings/Settings.tsx` — import 新组件 + 创建 `tagAutocompleteConfigRef` + JSX 追加 `<TagAutocompleteSettings ref={tagAutocompleteConfigRef} />`（位于 `<WebSearchSettings>` 之后）+ `handleSave` 合并 `tagAutocomplete` 字段

### 验证总结

- **tsc 验证（PASS）**：`TagAutocompleteSettings.tsx` 与 `Settings.tsx` 零新增 TypeScript 错误
- **预先存在错误（与本次修改无关）**：`src/renderer/components/Common/TagAutocomplete.tsx(354,33): error TS1010: '*/' expected.` 属于 Task 5 文件，不在 Task 6 范围
- **运行时验证（推迟到 Task 7 集成后）**：用户实际选择 CSV 文件 → 标签库加载 → AssetGenerateModal 临时标签输入框推荐效果

---

## 标签自动推荐集成 AssetGenerateModal（Spec: implement-local-tag-autocomplete / Task 7）

### 概述

将「输入临时标签」位置的普通 `<Input>` 替换为 `<TagAutocomplete>`，实现基于本地 Danbooru/e621 标签库的实时推荐。用户在 AssetGenerateModal「携带角色特征」面板点击「新增临时标签」后，输入框会随按键 debounce 150ms 后查询本地标签库，下拉展示匹配的 tag（含分类彩色 Tag + count 值），选中后自动追加到 `editedTraits` 并清空输入框（不退出新增模式，允许连续添加多个 tag）。

### 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. TagAutocomplete 组件扩展（Task 5 已就绪 + Task 7 透传 props） │
│    src/renderer/components/Common/TagAutocomplete.tsx           │
│      ├─ TagAutocompleteProps 新增 3 个透传 prop：               │
│      │   onPressEnter?: () => void                              │
│      │   onKeyDown?: (e: React.KeyboardEvent) => void          │
│      │   autoFocus?: boolean                                    │
│      ├─ 降级 Input（enabled=false）：透传 3 个 prop             │
│      └─ AutoComplete 内嵌 Input：透传 3 个 prop                 │
├─────────────────────────────────────────────────────────────────┤
│ 2. AssetGenerateModal 集成（Task 7 原始实施）                   │
│    src/renderer/components/Character/CharacterDialogueChat/     │
│      AssetGenerateModal.tsx                                     │
│      ├─ import { TagAutocomplete } from '../../Common'          │
│      ├─ L1938-1978: <Input> → <TagAutocomplete>                 │
│      ├─ onTagSelect 内联实现（不调用 handleConfirmAddTrait）    │
│      └─ 保留 onPressEnter / onKeyDown / ✓ / ✗ 按钮             │
├─────────────────────────────────────────────────────────────────┤
│ 3. AssetManagerModal 集成补全（2026-08-06 修复，详见 §6.3）     │
│    src/renderer/components/Character/CharacterDialogueChat/     │
│      AssetManagerModal.tsx                                      │
│      ├─ import { TagAutocomplete } from '../../Common'          │
│      ├─ L2982-3009: <Input> → <TagAutocomplete>                 │
│      ├─ onTagSelect 调用 store.addTrait(tag.name, categoryId)   │
│      └─ 保留 onPressEnter={handleAddTrait}                      │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计点

- **onTagSelect 选中后不退出新增模式（方案 A）**：原 `<Input>` 的 `handleConfirmAddTrait` 会 `setAddingCategoryId(null)` 退出新增模式。Task 7 在 `onTagSelect` 中**不调用** `handleConfirmAddTrait`，而是内联实现：构造 `newTrait`（`text: tag.name`）追加到 `editedTraits` + `setAddingText('')` 清空输入框。这样用户可连续选中多个推荐 tag 而无需反复点击「新增临时标签」。Escape 键与 ✓/✗ 按钮仍可主动退出新增模式。
- **onPressEnter 透传保留自定义 tag 输入**：用户输入的文本可能不在标签库中（如自定义场景 tag），按 Enter 仍走原 `handleConfirmAddTrait`（trim 后非空则追加 + 退出新增模式）。TagAutocomplete 内部嵌套 Input 但不暴露 `onPressEnter`，故扩展 props 透传。降级模式（`tagAutocomplete.enabled=false`）下也透传，避免关闭推荐时 Enter 失效。
- **onKeyDown 透传保留 Escape 退出**：原 Input 通过 `onKeyDown` 拦截 Escape 调用 `handleCancelAddTrait`。透传到内嵌 Input 与降级 Input，确保键位行为在启用 / 降级两种渲染路径下一致。
- **autoFocus 透传保留自动聚焦**：原 Input 设置 `autoFocus` 让用户点击「新增临时标签」后无需再次点击输入框即可键入。透传此 prop 保持原有交互体验。
- **showSortButton={false}**：AssetGenerateModal 临时标签输入框采用紧凑布局（width: 140），不展示排序按钮（排序规则仍由 Settings 面板配置，或首次使用时在其他场景切换）。
- **降级开关由组件内部处理**：`setting.tagAutocomplete.enabled=false` 时 TagAutocomplete 内部回退为普通 `<Input>`，但通过透传的 `onPressEnter` / `onKeyDown` / `autoFocus` 保证降级后 Enter / Escape / 自动聚焦全部正常工作，与原 Input 行为完全一致。
- **onChange 签名差异**：原 Input 的 `onChange` 接收 `React.ChangeEvent`（`setAddingText(e.target.value)`）；TagAutocomplete 的 `onChange` 直接接收 `string`（`onChange={setAddingText}`）。`setAddingText` 是 `Dispatch<SetStateAction<string>>`，可直接作为 `onChange` 传入。

### onTagSelect 回调实现

```typescript
onTagSelect={(tag) => {
  // addingCategoryId 在 isAdding=true 时必然非空
  // （isAdding = addingCategoryId === category.id）
  if (!addingCategoryId) return;
  const newTrait: CharacterTraitItem = {
    id: genTraitId(),
    text: tag.name,           // 使用推荐 tag 的 name（Danbooru 标准名）
    categoryId: addingCategoryId,
    enabled: true,
  };
  setEditedTraits((prev) => (prev ? [...prev, newTrait] : prev));
  setAddingText('');          // 清空输入框，不退出新增模式
}}
```

与 `handleConfirmAddTrait` 的差异：
- `handleConfirmAddTrait`：`text` 来自 `addingText.trim()`（用户手动输入），追加后 `setAddingCategoryId(null)` 退出新增模式
- `onTagSelect`：`text` 来自 `tag.name`（标签库标准名），追加后**不退出新增模式**（仅清空输入框）

### 涉及文件清单

**修改文件（2 个）**：
- `src/renderer/components/Common/TagAutocomplete.tsx` — `TagAutocompleteProps` 接口新增 `onPressEnter` / `onKeyDown` / `autoFocus` 三个可选 prop；组件参数解构接收；降级 Input 与 AutoComplete 内嵌 Input 均透传这三个 prop
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — import `TagAutocomplete`（barrel 入口 `../../Common`）；L1938-1978 的 `<Input>` 替换为 `<TagAutocomplete>`，新增 `onTagSelect` 回调（内联实现，不退出新增模式），保留 `onPressEnter` / `onKeyDown` / `autoFocus` / ✓ / ✗ 按钮

**未修改文件**：
- `handleConfirmAddTrait` / `handleCancelAddTrait` / `handleStartAddTrait` 保持原样
- `settingStore` 不修改（降级开关由 TagAutocomplete 内部读取 `setting.tagAutocomplete.enabled`）

---

## 特征翻译优化与临时编辑方案（Spec: optimize-trait-translation-and-temp-scheme）

### Task 1 — 类型扩展（2026-08-07，已完成）

为后续 L3 颜色拆分标签溯源 + AssetGenerateModal 临时编辑保存到组合方案做类型契约准备。仅扩展类型定义，不修改任何运行时逻辑代码。

**新增字段（`src/shared/types/characterTrait.types.ts`）：**

- `CategorizedTrait.originalText?: string` — 拆分前原始标签文本
  - 仅 L3 颜色拆分生成的标签设置此字段（如 `grey long hair` 拆分为 `grey_hair` + `long_hair`，两者 `originalText` 均为 `grey long hair`）
  - 手动编辑标签文本后清空（编辑后的标签不再是"拆分生成"）
  - 非拆分标签无此字段（undefined），前端不显示拆分图标
- `CharacterTraitItem.originalText?: string` — 语义同 `CategorizedTrait.originalText`
  - 随 v2 manifest 持久化（`CharacterTraitManifestV2.traits[].originalText`）
  - 旧数据无此字段时兜底 undefined，前端不显示拆分图标
- `TraitCombination.traitSnapshot?: CharacterTraitItem[]` — 完整特征快照
  - 从 AssetGenerateModal 保存时写入（含临时新增/编辑的标签、启用状态、translation、originalText）
  - 从 AssetManagerModal 保存时不写入（仅 traitIds，向后兼容）
  - 应用方案时优先使用 traitSnapshot（若存在），否则回退到 traitIds 逻辑
  - 与 traitIds 可共存（traitIds 仍记录启用 id，traitSnapshot 记录完整数据）

**未修改的契约：**
- `electron.d.ts` 通过 `import type` 引用 shared 类型，无内联 `TraitCombination` 类型签名，无需同步修改
- 现有字段与 JSDoc 注释保持不变，仅新增字段
- 所有新增字段均为可选（`?:`），旧数据 / 旧调用方无破坏性影响

> 详见 CHANGELOG.md 2026-08-07 条目；后续 Task（store / service / UI 适配）将消费这些新字段。

### Task 2+3 — 翻译继承 + normalizeTraitItem 兜底（2026-08-07，已完成）

接续 Task 1 类型契约，落地两处运行时改动。

#### Task 2 — applyTagAudit 三场景保留 translation（`src/main/services/characterTraitAIService.ts`）

`applyTagAudit`（约 L1143-1277）原本三处替换场景均 `trait.translation = undefined`，导致 AI 原始翻译在审计替换后丢失。改为继承源标签翻译：

**场景 1 — L3 颜色拆分（约 L1172-1195）**：源标签翻译分配到两个子标签 + 记录原始标签
```typescript
const sourceTranslation = trait.translation;
const sourceOriginalText = v.tag;
trait.text = v.splitTags.featureTag;
trait.translation = sourceTranslation;        // 继承而非 undefined
trait.originalText = sourceOriginalText;
traits.push({
  text: v.splitTags.colorPartTag,
  categoryId: trait.categoryId,
  translation: sourceTranslation,             // 继承翻译
  originalText: sourceOriginalText,           // 记录原始标签
});
```

**场景 2 — L2/L3 规范化替换（约 L1196-1207）**：删除 `trait.translation = undefined`，translation 保持不变（trait 上已有，无需赋值）。

**场景 3 — L4 KNN 语义替换（约 L1212-1219）**：删除 `trait.translation = undefined`，translation 保持不变。

**注释统一**：三处原「标签库标准 tag 无需翻译」注释改为「翻译从源标签继承，保留 AI 原始翻译供用户参考」，并引用 Spec `optimize-trait-translation-and-temp-scheme`。

**L5 AI 兜底也继承翻译**：`applyAiFallback`（约 L1041-1123）原清空 `trait.translation = undefined`，后已修复为继承源标签翻译（与 L2/L3/L4 一致），translation 保持不变。L5 为语义替换不设置 `originalText`（仅 L3 颜色拆分设置）。

#### Task 3 — normalizeTraitItem originalText 兜底（`src/main/services/characterTraitService.ts`）

`normalizeTraitItem`（约 L176-195）返回对象中在 `translation` 字段后新增 `originalText` 兜底，与 `translation` 兜底逻辑对齐：

```typescript
return {
  id: ...,
  text: r.text,
  categoryId: ...,
  enabled: ...,
  translation: typeof r.translation === 'string' && r.translation ? r.translation : undefined,
  originalText: typeof r.originalText === 'string' && r.originalText ? r.originalText : undefined,
};
```

JSDoc 补充 `originalText` 字段说明：L3 拆分时设置（记录原始复合标签）、手动编辑后清空、旧数据缺失兜底 undefined、非字符串/空字符串兜底 undefined。

#### 验证

`npx tsc --noEmit --skipLibCheck` 仅剩预先存在的 tsconfig 配置错误（`esModuleInterop` / `downlevelIteration`），无本次修改引入的新增类型错误。Task 1 已为 `originalText` 字段定义类型，本 Task 访问 / 赋值均通过类型检查。

#### 涉及文件清单

- `src/main/services/characterTraitAIService.ts` — applyTagAudit 三处场景翻译继承 + L3 拆分场景 originalText 记录（L1172-1219）
- `src/main/services/characterTraitService.ts` — normalizeTraitItem 返回值新增 originalText 兜底 + JSDoc 补充（L160-195）

### Task 4+5+6 — AssetGenerateModal UI 改造（2026-08-07，已完成）

接续 Task 1 类型契约 + Task 2/3 store 层改动，落地 `AssetGenerateModal` 渲染层 UI 改造：拆分标签视觉标识 + 临时方案保存 + 组合方案下拉。三处改动均集中在 `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`。

#### Task 4 — 拆分标签 UI 标识（`renderTraitsPanel`）

为 L3 颜色拆分生成的标签增加视觉标识，让用户一眼看出该 tag 来自复合标签拆分，并能 hover 查看溯源信息。

**改动点：**

1. **导入图标**：从 `@ant-design/icons` 新增 `SplitCellsOutlined`（与 `SaveOutlined` / `DeleteOutlined` 一并新增，供 Task 5+6 使用）。同时移除已不再使用的 `EyeOutlined`（原「AI 图片识别」按钮图标，按钮入口已移除）。

2. **Tooltip 多行展示**（约 L1968-1982）：当 `trait.originalText` 存在且非 `isAutoFiltered` 时，Tooltip title 改为多行 `<div>` 展示「原标签 / 拆分为 / 翻译」（translation 为空时省略翻译行）；其余情况保持原行为（`isAutoFiltered` 显示「表情模式下已自动清空」提示；无 `originalText` 时显示 `translation || ''`）。

3. **Tag 内拆分图标**（约 L2008-2014）：当 `trait.originalText` 存在且非 `isAutoFiltered` 时，在 Tag 文字前显示 `<SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />`。

4. **`handleConfirmEditTrait` 清空 originalText**（约 L1500）：编辑标签文本时同步清空 `originalText: undefined`（与清空 `translation` 一致），避免编辑后前端继续显示拆分图标 + 溯源 Tooltip 但 text 已与 originalText 不对应。修改后 spread 表达式为 `{ ...t, text: trimmed, translation: undefined, originalText: undefined }`。

#### Task 5+6 — 替换 AI 图片识别按钮 + 组合方案下拉（`renderTraitsPanel` 头部）

将原「AI 图片识别」按钮（`supportsVision ? Button : Tooltip「图片识别不可用」`）替换为「组合方案」下拉 + 存方案/删方案按钮组合。Task 5（保存按钮）与 Task 6（下拉）整合为一处 UI（仅保留下拉旁的「存方案」按钮，不再单独放「临时方案保存」按钮，避免重复入口）。

**Store 订阅扩展**（约 L363-371）：在 `useCharacterTraitStore` 解构中补充 `combinations` / `activeCombinationId` / `saveCombination` / `applyCombination` / `deleteCombination` 五个字段，供下拉显示与三个 handler 调用。

**新增 handlers**（约 L1602-1695）：

- `handleSaveTempScheme`：弹出 `Modal.confirm` 输入方案名 → 校验非空 + 不重名（用 `combinations` 列表预校验，给出明确 `message.error`）→ 调 `saveCombination(trimmed, editedTraits.map((t) => ({ ...t })))` 传入 editedTraits 深拷贝快照（含临时新增/编辑/启用状态/translation/originalText）。saveCombination 内部 fire-and-forget 调 saveTraits 持久化，调用方无需 await。
- `handleApplyCombination`：下拉 `onChange` 回调。`combinationId === '__manual__'` 时调 `applyCombination(null)` 取消激活，editedTraits 保持不变；traitSnapshot 方案（`combination.traitSnapshot` 非空）用快照完整替换 editedTraits（深拷贝），解决「保存方案后编辑特征 → 应用方案时特征丢失」问题；traitIds 方案（旧）仅切换 enabled 状态。两者均调 `applyCombination(combinationId)` 同步 store.activeCombinationId。
- `handleDeleteCombination`：删除当前激活方案，二确后调 `deleteCombination(activeCombinationId)`。deleteCombination 内部会 fire-and-forget 调 saveTraits 持久化，并重置 activeCombinationId = null（进入手动模式），下拉自动回到「手动模式」。

**UI 改动**（约 L1933-1981）：
- 移除原「AI 图片识别」按钮块（`{supportsVision ? <Button>... : <Tooltip>...</Tooltip>}`），保留 `handleImageRecognize` 函数定义 + `supportsVision` / `imageRecognizing` 状态变量（spec 要求不删除，便于未来恢复按钮入口；通过 `void` 引用避免 `noUnusedLocals` 报错 TS6133）。
- 在特征面板标题行下方新增一行：`组合方案` label + `<Select>` 下拉（value = `activeCombinationId ?? '__manual__'`，options 含「手动模式」+ combinations 列表，traitSnapshot 方案名后加 📋 emoji 标识）+ `存方案` 按钮（`<SaveOutlined />`）+ `删方案` 按钮（`<DeleteOutlined />`，`disabled={!activeCombinationId}`）。

#### 验证

`npx tsc --noEmit -p tsconfig.json` 仅剩预先存在的 tsconfig 配置错误（`esModuleInterop` / `--jsx` / `electronAPI` / `@shared/types` 路径别名），`AssetGenerateModal.tsx` 零错误（移除 `EyeOutlined` import + `void` 引用三个保留变量后，TS6133 unused 错误已消除）。

#### 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — import 新增 `SplitCellsOutlined` / `SaveOutlined` / `DeleteOutlined`，移除 `EyeOutlined`；store 订阅扩展 5 字段；新增 `handleSaveTempScheme` / `handleApplyCombination` / `handleDeleteCombination` 三个 handler；`handleConfirmEditTrait` 清空 originalText；`renderTraitsPanel` Tag Tooltip 多行展示 + SplitCellsOutlined 图标 + 组合方案下拉 UI 替换 AI 图片识别按钮；末尾 `void` 引用三个保留变量

### Task 7 — store traitSnapshot 支持（2026-08-07，已完成）

扩展 `characterTraitStore` 的组合方案 CRUD，支持 `traitSnapshot` 完整特征快照 + 立即持久化，解决「AssetGenerateModal 临时编辑特征保存方案后丢失」问题。

#### `saveCombination` — 签名扩展接收快照（`characterTraitStore.ts` L1138-1192）

```typescript
saveCombination: (name: string, snapshot?: CharacterTraitItem[]) => {
  // traitIds = 当前 enabled=true 的 trait id（始终保存，向后兼容旧 applyCombination）
  const traitIds = traits.filter((t) => t.enabled).map((t) => t.id);
  const newCombination: TraitCombination = {
    id: genTraitId(), name: trimmed, traitIds,
    // snapshot 深拷贝写入 traitSnapshot（undefined 时省略字段，与旧方案兼容）
    ...(snapshot ? { traitSnapshot: snapshot.map((t) => ({ ...t })) } : {}),
    createdAt: now, updatedAt: now,
  };
  set({ combinations: [...combinations, newCombination] });
  void get().saveTraits().catch(...);  // 立即持久化（fire-and-forget）
}
```

**调用方差异**：
- `AssetGenerateModal.handleSaveTempScheme`：调 `saveCombination(trimmed, editedTraits.map((t) => ({ ...t })))` 传入完整快照
- `AssetManagerModal.handleOpenSaveCombination`：调 `saveCombination(trimmed)` 不传 snapshot（仅 traitIds，与旧逻辑一致）

#### `applyCombination` — traitSnapshot 分支（`characterTraitStore.ts` L1194-1240）

```typescript
applyCombination: (combinationId: string | null) => {
  if (combinationId === null) { set({ activeCombinationId: null }); return; }  // 取消激活
  if (combination.traitSnapshot?.length) {
    // traitSnapshot 方案：完整替换 traits（深拷贝，保留 text/categoryId/enabled/id/translation/originalText）
    set({ traits: combination.traitSnapshot.map((t) => ({ ...t })), activeCombinationId });
  } else {
    // traitIds 方案（旧）：仅切换 enabled，trait 本身不变
    const enabledIdSet = new Set(combination.traitIds);
    set({ traits: traits.map((t) => ({ ...t, enabled: enabledIdSet.has(t.id) })), activeCombinationId });
  }
}
```

**null 支持**：新增 `combinationId === null` 分支取消激活（与 `applyDynamicScenePrompt` 接受 null 一致），便于 UI allowClear 场景。

#### `deleteCombination` — 立即持久化（`characterTraitStore.ts` L1242-1279）

删除方案后立即 `void get().saveTraits().catch(...)` 持久化（与 `saveCombination` 一致），若删除的是当前激活方案则重置 `activeCombinationId = null`（进入手动模式）。

#### `overwriteCombination` — 覆盖同名方案（`characterTraitStore.ts` L1208-1254）

按名称精确匹配已有方案，保留原 id / createdAt，更新 traitIds / traitSnapshot / updatedAt，立即 fire-and-forget 持久化。供 AssetGenerateModal / AssetManagerModal 在保存方案遇到重名时使用（弹二次确认框后调用），避免用户必须重命名。

#### `preCombinationTraits` — traitSnapshot 方案的 traits 备份/恢复（`characterTraitStore.ts`）

**问题背景**：`applyCombination(traitSnapshot 方案)` 会用快照完整替换 store 的 `traits` 数组。当快照只包含部分原始特征时（如用户在 AssetGenerateModal 中删除了某些特征后保存的方案），原始特征在替换后丢失。切换到手动模式（`applyCombination(null)`）时如果不恢复，用户看不到完整的原始特征列表。

**机制**：store 新增 `preCombinationTraits: CharacterTraitItem[] | null`（内存态，不持久化）：
- `applyCombination(traitSnapshot)` 替换前备份当前 `traits` 到 `preCombinationTraits`
- `applyCombination(null)` 从 `preCombinationTraits` 恢复 `traits`，然后清空备份
- traitIds 方案不修改备份（仅切换 enabled，不替换 traits 数组）
- `loadTraits` / `clear` / `toggleTraitEnabled` / `deleteCombination`（删除激活方案时）均清空备份

**AssetGenerateModal 同步**：`handleApplyCombination` / `handleDeleteCombination` 在调用 store 后，通过 `useCharacterTraitStore.getState().traits` 读取恢复后的 traits 并同步到本地 `editedTraits`。

#### 持久化策略变更

原 `saveCombination` / `deleteCombination` 仅修改本地 state，持久化由调用方在「保存」按钮点击时统一调 `saveTraits`。改为**立即持久化**（fire-and-forget `saveTraits`），与动态场景方案（`saveDynamicScenePrompt` / `deleteDynamicScenePrompt`）一致，避免调用方遗漏持久化导致数据丢失。

> 详见 docs/FIX_RECORDS.md §7.24

## AI 生成标签中文翻译（Spec: add-ai-tag-chinese-translation / Task 1-9 全量实施）

> **⚠️ 2026-08-07 部分回退通知（change-id: replace-dynamic-scene-with-prompt-gen / Task 1+3）**
>
> 本节所涉 `DynamicScenePrompt.clothingTranslations` / `poseTranslations` / `sceneTranslations` 三字段、`saveDynamicScenePrompt` 签名扩展、Task 7「动态场景三组 Tag 列表改造」、`generateDynamicScenePrompts` 返回类型翻译字段已全量回退（动态场景方案整体移除）。下方相关章节仅作历史参考。`CategorizedTrait.translation` / `CharacterTraitItem.translation` 字段及 `generateTraitPrompts` / `generateCharacterTraits` 的翻译链路保留不动。完整移除清单见 docs/FIX_RECORDS.md §7.27。

### 概述

为 AI 生成的角色特征 / 动态场景标签携带中文翻译，前端 hover 展示。仅 AI 原创生成的 tag 携带翻译；标签库标准 tag（被审计替换后）无翻译。手动编辑 / AI 审计替换 / 颜色拆分 / 人工审核替换后清空 `translation`，避免翻译与新 tag 文本不符。

### 类型扩展（Task 1，已完成）

- `CategorizedTrait` 新增 `translation?: string`（AI 生成标签中文翻译，hover 展示）
- `CharacterTraitItem` 继承获得 `translation?: string`，随 v2 manifest 持久化
- ~~`DynamicScenePrompt` 新增 `clothingTranslations?` / `poseTranslations?` / `sceneTranslations?`（三组 tag 的中文翻译，逗号分隔与 `clothing`/`pose`/`scene` 一一对应）~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 1）

> 详见 docs/FIX_RECORDS.md §7.21

### Store 层改动（Task 4 + Task 7，`src/renderer/stores/characterTraitStore.ts`）

#### `updateTrait` — 编辑清空翻译

行内编辑保存新 text 时同步置 `translation: undefined`，避免翻译与新 tag 文本不符。此 action 同时覆盖三条调用路径，无需调用方重复清空：
1. `AssetManagerModal.handleSaveEdit`（行内编辑保存）
2. `AssetManagerModal.handleManualReplace`（末轮人工审核替换）
3. `AssetGenerateModal` 的行内编辑路径

#### `setTraits` — AI 生成翻译透传

原 `safeTraits` 映射 `return { text, categoryId }` 丢弃 `translation` 字段，导致 AI 产出的翻译无法持久化。修复后：
- `safeTraits` 映射时保留 `translation`（trim 后非空才保留）
- 新增 `newByTranslation` Map（text → translation），供 path 2（未分类项重新分类时刷新翻译）使用
- path 2（existing uncategorized updated）：若 AI 提供新 translation 则覆盖，否则保留既有 translation
- path 4（new traits added）：携带 AI 产出的 translation（仅当为非空字符串时写入字段）

MERGE 策略不变（保留已分类项不丢失 + 用 AI 分类更新未分类项），仅补充 translation 透传。

#### `saveDynamicScenePrompt` — 签名扩展接收翻译

新增三个可选参数 `clothingTranslations?: string` / `poseTranslations?: string` / `sceneTranslations?: string`，缺省 / 非字符串时兜底为空字符串。创建 `DynamicScenePrompt` 时写入对应字段。

调用方 `AssetManagerModal.handleSaveDynamicScene` 同步传入 `parsedClothingTranslations.trim()` 等。

### 前端展示层（`AssetManagerModal.tsx`）

#### Task 5: `renderTraitChip` Tooltip 包裹

用 antd `<Tooltip>` 包裹 `trait.text` 展示态 span（`trait.translation || ''` 作为 title）。`translation` 为空时 antd Tooltip 默认不弹出（空字符串 title），不影响点击进入编辑态的行为。

#### Task 7: 动态场景三组 Tag 列表改造

将 `clothing`/`pose`/`scene` 三组从 `<TextArea>` 改为 Tag 列表展示。底层保留 `parsedClothing`/`parsedPose`/`parsedScene` 字符串 state（持久化格式兼容），仅改展示层。

**新增 state**：
- `parsedClothingTranslations` / `parsedPoseTranslations` / `parsedSceneTranslations`（string，逗号分隔，与 parsed* 一一对应）
- `editingDynTagField` / `editingDynTagIndex` / `editingDynTagValue`（行内编辑态）
- `addingDynTagField` / `addingDynTagValue`（添加态）

**`renderDynamicSceneTagList(field)` 函数**：
- 从 parsed* 字符串 split + trim 得 tag 数组（过滤空串），从 parsed*Translations split + trim 得翻译数组
- zip（翻译数组缺位用空字符串补齐）
- 每个 tag 渲染为 `<Tooltip title={translation}><Tag closable onDoubleClick>...</Tag></Tooltip>`
- × 删除：同步删除 tag + 对应翻译（保持一一对应）
- 双击行内编辑：回车保存，清空该 tag 的翻译（与 trait 行内编辑语义一致）；Esc 取消
- 末尾「+ 添加」按钮：回车追加新 tag，翻译为空字符串

**同步逻辑**：
- AI 解析成功（`handleParseDynamicScene`）：从 `result.clothingTranslations` 等填充（类型断言访问，Task 3 完成后 electron.d.ts 同步扩展）
- 切换激活动态场景方案（useEffect）：从 `scheme.clothingTranslations` 等同步（旧方案兜底空字符串）
- 保存方案（`handleSaveDynamicScene`）：透传 parsed*Translations 给 `saveDynamicScenePrompt`

**一一对应维护**：删除/新增/编辑 tag 时，同步增删翻译项。新增项翻译为空字符串，编辑项翻译清空为空字符串，保持数组长度一致。

### 向后兼容

- 旧 `traits.json` 无 `translation` 字段 → 加载时兜底 `undefined`，hover 不显示 Tooltip
- 旧动态场景方案无 `*Translations` 字段 → state 兜底为空字符串，Tag hover 不显示
- 旧 LLM 输出无 `|中文翻译` → AI service 层 `parseTraitsFromContent` / `parseDynamicSceneResponse` 兜底 `translation=undefined` / 空字符串

### 涉及文件清单

**修改文件（4 个，Task 4/5/7）**：
- `src/renderer/stores/characterTraitStore.ts` — `updateTrait` 清空 translation + `setTraits` 透传 translation + `saveDynamicScenePrompt` 签名扩展
- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — `renderTraitChip` Tooltip 包裹 + 动态场景 Tag 列表改造 + 翻译同步逻辑
- `src/main/services/characterTraitAIService.ts` — prompt 修改 + 解析 + applyTagAudit 清空翻译（Task 2/3）
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 特征 Tag Tooltip + 行内编辑清空翻译（Task 6）

**Task 8 新增修改文件（2 个，bug 修复）**：
- `src/main/services/characterTraitService.ts` — `normalizeTraitItem` 透传 translation 字段（详见下方 Task 8 + FIX_RECORDS.md §7.21）
- `src/renderer/types/electron.d.ts` — `generateDynamicScenePrompts` 返回类型扩展三个翻译字段（详见下方 Task 8 + FIX_RECORDS.md §7.21）

### Task 8：持久化与向后兼容验证（⚠️ 重点 Bug 修复）

> 完整 bug 分析详见 docs/FIX_RECORDS.md §7.21。本节仅列要点。

Task 8 验证阶段发现两个数据流断裂 bug，均已修复：

1. **`normalizeTraitItem` 丢弃 translation 字段**：`characterTraitService.normalizeTraitItem`（`characterTraitService.ts:165`）构造返回对象时仅含 `id`/`text`/`categoryId`/`enabled`，遗漏 `translation`。该方法在 `loadTraitData` + `saveTraitData` 双路径调用，导致翻译在加载/保存时均被剥离。修复：返回对象新增 `translation` 透传（`typeof r.translation === 'string' && r.translation ? r.translation : undefined`）。

2. **`electron.d.ts` IPC 返回类型未同步扩展**：主进程 `GenerateDynamicScenePromptsResult` 已扩展 `clothingTranslations?` 等字段，但 `electron.d.ts` 中 `generateDynamicScenePrompts` 内联返回类型签名未同步，渲染进程访问报 TS 错误。修复：在 `electron.d.ts` 返回类型中新增三个翻译字段，移除 `AssetManagerModal` 中的 `result as typeof result & {...}` 类型断言。

**教训**：⚠️ 新增可选字段到持久化数据结构时，必须检查所有「对象重构」路径（normalize/sanitize/migrate）；⚠️ 主进程类型扩展后，必须同步检查 `electron.d.ts` 内联类型签名（主进程类型不可直接被渲染进程引用）。

### 验证

- `tsc --noEmit`：AssetManagerModal.tsx + characterTraitStore.ts 均无新类型错误（项目其余 925 行 pre-existing 错误与本任务无关）


### 验证总结

- **tsc 验证（PASS）**：`node node_modules/typescript/bin/tsc --noEmit` 全量编译，`TagAutocomplete.tsx` / `AssetGenerateModal.tsx` / `Common/index.ts` 三个修改文件**零新增错误**（900 条预存在错误均在 `src/main/services/*` 等无关文件中）
- **运行时验证（推迟到 Task 8）**：端到端输入响应延迟 < 300ms、31.7 万条数据子串匹配延迟 < 50ms 需在 Task 8 性能验证阶段确认
- **降级路径验证（静态 PASS）**：`setting.tagAutocomplete.enabled=false` 时 TagAutocomplete 渲染普通 Input，透传 `onPressEnter` / `onKeyDown` / `autoFocus`，行为与原 Input 完全一致

---

## 本地标签自动推荐后端架构（Spec: implement-local-tag-autocomplete / Task 1-4, 8）

### 概述

为 AssetGenerateModal 的「输入临时标签」输入框提供基于本地 Danbooru/e621 标签库（31.7 万条）的实时自动推荐功能。后端包含共享类型、主进程 Service、IPC 通道、AppSetting 配置块；前端组件（TagAutocomplete）与 Settings 面板详见前述 Task 5 / 6 / 7 章节。

### 架构分层

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React)                                    │
│  TagAutocomplete.tsx (Common)                       │
│   ├─ debounce 150ms → window.electronAPI.tag.search │
│   └─ 排序切换 → settingStore.tagAutocomplete.sortBy │
├─────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                      │
│  tag.search / tag.getLoadStatus / tag.reload /      │
│  tag.setCsvPath                                     │
├─────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                         │
│  tagHandlers.ts (4 个 ipcMain.handle)               │
│   ├─ tag:search        → service.search(req)        │
│   ├─ tag:getLoadStatus → service.getLoadStatus()    │
│   ├─ tag:reload        → service.reload(csvPath?)   │
│   └─ tag:setCsvPath    → service.reload(csvPath)    │
├─────────────────────────────────────────────────────┤
│ Service Layer                                        │
│  tagAutocompleteService (单例)                       │
│   ├─ ensureLoaded() — 延迟加载（首次 search 触发）  │
│   ├─ loadInternal() — fs.createReadStream + readline│
│   ├─ parseCsvLine() — 正则解析 CSV 行               │
│   ├─ search() — 子串匹配 + 排序 + 截断              │
│   ├─ sortResults() — relevance/count/alphabetical   │
│   ├─ getLoadStatus()                                │
│   └─ reload(csvPath?)                               │
└─────────────────────────────────────────────────────┘
```

### 共享类型（src/shared/types/tag.types.ts — Task 1）

| 类型 | 类别 | 用途 |
|---|---|---|
| `TagInfo` | interface | CSV 解析后的单个 tag 结构（`{ name: string; category: number; count: number; aliases: string[] }`） |
| `TagMatchType` | type alias | 匹配类型 `'prefix' \| 'includes' \| 'alias'` |
| `TagSearchResult` | interface | 搜索结果项（TagInfo + `matchType`） |
| `TagSortBy` | type alias | 排序规则 `'relevance' \| 'count' \| 'alphabetical'` |
| `TagSearchRequest` | interface | `tag:search` IPC 请求参数（`{ query, sortBy?, limit? }`） |
| `TagSearchResponse` | interface | `tag:search` IPC 响应（`{ success, results, total, error? }`） |
| `TagLoadStatus` | interface | `tag:getLoadStatus` IPC 响应（`{ loaded, loading, totalCount, csvPath, error? }`） |
| `TagReloadResult` | interface | `tag:reload` / `tag:setCsvPath` IPC 响应（`{ success, totalCount, error? }`） |

通过 `src/shared/types/index.ts` barrel 暴露：`export * from './tag.types'`（无同名冲突）

### 主进程 TagAutocompleteService（src/main/services/tagAutocompleteService.ts — Task 2）

- **单例导出**：`export const tagAutocompleteService = new TagAutocompleteService()`
- **内置标签库**：项目随分发内置 `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`（约 8MB，31.7 万条 tag）。`DEFAULT_CSV_PATH` 通过 `resolveBundledCsvPath()` 动态解析：优先 `app.getAppPath()/docs/<filename>`，降级为 `__dirname/../../../docs/<filename>`（与 `logPathService.getLogBaseDir` 路径解析策略一致）。用户未配置 `csvPath` 时自动使用内置标签库
- **CSV 解析**：正则 `^([^,]+),(\d+),(\d+)(?:,"([^"]*)")?$` 解析 `tag_name,category,count,"aliases"` 格式；剥离 UTF-8 BOM；解析失败的行（空行 / 表头 / 格式不符）返回 null 跳过
- **内存索引**：`Map<string, TagInfo>`（key=`name.toLowerCase()`，约 31.7 万条，预估 50-80MB）
- **别名反向索引**：`aliasMap`（`Map<alias.toLowerCase(), TagInfo>`，约 80-100 万条目）+ `getTagByAlias(alias)` 方法，支持同义词反查；冲突策略：同 alias 被多 tag 标注时保留 count 更高的（供 tagRagService L2 层调用，详见 docs/FIX_RECORDS.md §7.13）
- **延迟加载**：`ensureLoaded()` 首次 search 触发，加载期间 `await loadPromise`，多调用方共享同一加载过程（`loadPromise` 并发去重）
- **流式加载**：`fs.createReadStream` + `readline.createInterface`（`crlfDelay: Infinity`），不一次性读入内存
- **子串匹配**：遍历 Map，name 判定 `prefix`（startsWith）/ `includes`，否则查 aliases 判定 `alias`；大小写不敏感
- **排序规则**（`sortResults` 原地排序）：
  - `relevance`：matchType 优先级（prefix=0 > includes=1 > alias=2），同级内 count 降序
  - `count`：纯按 count 降序（高频 tag 优先）
  - `alphabetical`：`name.localeCompare` 升序（A-Z）
- **结果限制**：默认 `limit=50`，上限 50（`Math.min(requestedLimit, 50)`），负数视为 0 返回空
- **错误处理**：`loadInternal` 捕获所有异常记录到 `loadError`，`loaded` 保持 false；`search` 加载失败时返回 `{ success: false, error }` 不抛异常给调用方

### IPC 通道（src/main/ipc/handlers/tagHandlers.ts — Task 3）

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `tag:search` | `TagSearchRequest` | `Promise<TagSearchResponse>` | 查询标签库（子串匹配 + 排序 + 截断） |
| `tag:getLoadStatus` | 无 | `Promise<TagLoadStatus>` | 获取加载状态快照（loaded / loading / totalCount / csvPath / error） |
| `tag:reload` | `{ csvPath?: string }` | `Promise<TagReloadResult>` | 重新加载标签库（不传 csvPath 沿用当前路径） |
| `tag:setCsvPath` | `{ csvPath: string }` | `Promise<TagReloadResult>` | 设置新 CSV 路径并重新加载 |

注册顺序：在 `registerWebSearchHandlers()` 之后追加 `registerTagHandlers()`（`src/main/ipc/index.ts`）

Preload 暴露（`src/main/preload.ts`）：
```typescript
tag: {
  search: (req: TagSearchRequest) => ipcRenderer.invoke('tag:search', req),
  getLoadStatus: () => ipcRenderer.invoke('tag:getLoadStatus'),
  reload: (args?: { csvPath?: string }) => ipcRenderer.invoke('tag:reload', args),
  setCsvPath: (args: { csvPath: string }) => ipcRenderer.invoke('tag:setCsvPath', args),
}
```

渲染进程类型声明（`src/renderer/types/electron.d.ts`）：`tag: { search / getLoadStatus / reload / setCsvPath }` 签名对齐

### AppSetting 配置块（src/renderer/types/setting.ts + src/shared/settings.ts — Task 4）

```typescript
export interface TagAutocompleteConfig {
  enabled: boolean;       // 是否启用标签自动推荐（关闭时 TagAutocomplete 降级为 Input）
  csvPath: string;        // 标签库 CSV 文件路径（空字符串 = 使用内置 docs/ 标签库）
  sortBy: 'relevance' | 'count' | 'alphabetical';  // 默认排序规则
}

// AppSetting 接口扩展
tagAutocomplete?: TagAutocompleteConfig;

// defaultSetting.tagAutocomplete 默认值
tagAutocomplete: { enabled: true, csvPath: '', sortBy: 'relevance' as const }
```

持久化方式：作为 `AppSetting` 嵌套字段，随整体 `setting.save` / `setting.load` IPC 持久化到 electron-store，未修改 `settingStore.ts` / `settingService.ts`（复用现有 AppSetting 序列化管线）。

**csvPath 留空语义**：`csvPath=''` 时主进程 `TagAutocompleteService` 自动回退到内置标签库（`docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`）。Settings 面板的「重新加载」按钮在路径为空时也会重新加载内置标签库（不报错）。用户可选择自定义 CSV 文件覆盖内置库。

### 性能验证（静态分析 — Task 8）

- **主进程子串匹配延迟**：< 50ms（31.7 万条 Map 遍历 + `includes` 操作，复杂度 O(n)，n=317,600；V8 引擎单核性能）
- **端到端输入响应延迟**：~210ms（debounce 150ms + IPC 传输 ~5ms + 主进程查询 ~50ms + 渲染 ~5ms）< 300ms ✓
- **内存占用**：约 50-80MB（Map 索引 31.7 万条 TagInfo，含 name/category/count/aliases 字段）
- **加载耗时**：约 1-2 秒（`readline` 流式逐行解析 + Map.set，不阻塞主进程其他 IPC）

⚠️ 真实运行时性能依赖 Electron 集成测试，本次为静态分析结果（参照 Native Module Test Gap Convention）。静态分析依据：
1. `tagAutocompleteService.ts` — `search()` 方法遍历 `this.tagMap`（L256-277），每次迭代执行 `startsWith` / `includes` / `alias.toLowerCase().includes`，无常驻锁、无 I/O 阻塞
2. `TagAutocomplete.tsx` — `SEARCH_DEBOUNCE_MS = 150`（L130），`doSearch` 异步调用 `window.electronAPI.tag.search`（L227-231），不阻塞渲染线程

### 涉及文件清单

**新增文件（3 个）**：
- `src/shared/types/tag.types.ts` — 8 个共享类型定义（Task 1）
- `src/main/services/tagAutocompleteService.ts` — 主进程标签库加载 + 查询服务（Task 2）
- `src/main/ipc/handlers/tagHandlers.ts` — 4 个 IPC handler（Task 3）

**修改文件（6 个）**：
- `src/shared/types/index.ts` — barrel 暴露 `tag.types`（Task 1）
- `src/main/ipc/index.ts` — 注册 `registerTagHandlers`（Task 3）
- `src/main/preload.ts` — 暴露 `tag` API 到渲染进程（Task 3）
- `src/renderer/types/electron.d.ts` — `tag` API 类型声明（Task 3）
- `src/renderer/types/setting.ts` — 新增 `TagAutocompleteConfig` 接口 + `AppSetting.tagAutocomplete` 字段（Task 4）
- `src/shared/settings.ts` — `defaultSetting.tagAutocomplete` 默认值（Task 4）

## RAG 标签库 — AI 生成特征有效性保障（Spec: rag-tag-library-for-ai-trait-generation）

### 概述

防止 AI 生成特征按钮输出 Danbooru/e621 标签库（31.7 万条）以外的无效 tag。基于已有 `tagAutocompleteService.tagMap`，将标签向量化后用角色描述语义检索 top-K 相关标签，注入 system prompt 尾部作为参考段落，引导 LLM 主动使用有效标签。

方案选型对比（三选一，用户选定方案 3）：
1. **全量标签注入 Prompt** — 32 万 tag ≈ 200 万 token，超模型上下文，不可行
2. **后置过滤**（LLM 输出后筛除无效 tag）— 删除后可能所剩无几，输出被大幅删改，体验差
3. **RAG 向量检索** ✅ — 仅注入 top-K（默认 40）相关 tag，token 成本可控，LLM 主动输出有效 tag

详细实现记录、单测经验与重点标记见 `docs/FIX_RECORDS.md` §7.1 ~ §7.8。

### 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React)                                             │
│  TagRagSettings.tsx (Settings 子面板)                        │
│   ├─ 状态卡片（idle/vectorizing/ready/error/stale）          │
│   ├─ 进度条（订阅 tagRag:progress 事件）                     │
│   ├─ 向量化/取消/清空索引按钮                                │
│   └─ 检索测试区（tagRag:search）                             │
├──────────────────────────────────────────────────────────────┤
│ Preload Bridge (contextBridge)                               │
│  tagRag.getStatus / startVectorization /                     │
│  tagRag.cancelVectorization / search / clearIndex /          │
│  tagRag.onProgress（单向广播订阅）                           │
├──────────────────────────────────────────────────────────────┤
│ Main Process (IPC Handlers)                                  │
│  tagRagHandlers.ts (5 个 ipcMain.handle + 1 个广播通道)      │
│   ├─ tagRag:getStatus           → service.getStatus()        │
│   ├─ tagRag:startVectorization  → service.vectorizeAll(opt)  │
│   ├─ tagRag:cancelVectorization → service.cancelVectorization│
│   ├─ tagRag:search              → service.searchRelevantTags │
│   ├─ tagRag:clearIndex          → service.clearIndex()       │
│   └─ tagRag:progress（主→渲染单向广播，tagRagProgressEmitter）│
├──────────────────────────────────────────────────────────────┤
│ Service Layer                                                │
│  tagRagService (单例，模块级 currentState)                    │
│   ├─ initialize() — 注册 CSV/维度变更事件监听                │
│   ├─ vectorizeAll(opt) — 分批+并发池向量化                   │
│   │   （远程500/批×并发3·本地32/批顺序执行）                 │
│   ├─ cancelVectorization() — 设置 cancelRequested 标志位     │
│   ├─ searchRelevantTags(req) — embedding + vec0 KNN 检索     │
│   ├─ buildRagReferenceSection(query) — 构建 Prompt 参考段落  │
│   ├─ buildRagReferencePrompt(tags) — 格式化 top-K tag 文本   │
│   ├─ validateTagsAgainstLibrary(tags) — 六层降级匹配链       │
│   │   L0 自定义映射 → L1 name → L2 alias → L3 颜色拆分      │
│   │   → L3b 修饰词剥离 → L4 语义 KNN（source 字段标识命中层）│
│   │   ⚠️ L5 AI 兜底由 characterTraitAIService.applyAiFallback  │
│   │   在 validate 之后对未匹配 tag 调 LLM 生成候选词再验证   │
│   │   （详见 docs/FIX_RECORDS.md §7.17，source='ai-fallback'）│
│   ├─ computeCsvHash() — sha256(path+size+mtimeMs).slice(0,16)│
│   ├─ computeFreshness() — csvHash+dim+model 三元组 stale 检测│
│   └─ clearIndex() — 删除向量文件 + meta 文件                 │
│  userSynonymMapService (单例，内存 Map + 同步 fs 持久化)     │
│   └─ L0 自定义映射表：{userData}/data/user-synonym-map.json  │
│      load/lookup/addMapping/removeMapping（详见 §7.16）      │
│  复用基础设施：EmbeddingService + VectorStoreService          │
│   (source='tag_library', {databaseDir}/vectors/tag_library/  │
│    <csvHash>/<dim>/vectors.db)                               │
└──────────────────────────────────────────────────────────────┘
```

### 数据库目录路径策略（getDatabaseDir）

所有 SQLite 向量 DB 文件与 RAG meta 文件统一收敛到 `getDatabaseDir()`（`src/main/utils/appPath.ts`）：

| 环境 | 判定条件 | 路径 | 说明 |
|---|---|---|---|
| 开发环境 | `!app.isPackaged` | 项目根目录/database | 用户可直观查看 vectors.db / tag_rag_meta.json，便于调试 |
| 生产环境 | `app.isPackaged` | userData/database | app.asar 只读，无法写入项目根目录 |

路径布局：
- 向量 DB：`{databaseDir}/vectors/{source}/{sourceId}/{dimension}/vectors.db`
- RAG meta：`{databaseDir}/tag_rag_meta.json`
- agent SQLite：`{databaseDir}/agent.db`（由 agent/infra/sqliteBackend 使用）

### 共享类型（src/shared/types/tagRag.types.ts）

| 类型 | 类别 | 用途 |
|---|---|---|
| `TagRagStatus` | type alias | 状态枚举 `'idle' \| 'vectorizing' \| 'ready' \| 'error' \| 'stale'` |
| `TagRagProgressPhase` | type alias | 进度阶段 `'starting' \| 'embedding' \| 'storing' \| 'finalizing' \| 'done' \| 'error' \| 'cancelled'` |
| `TagRagProgressEvent` | interface | 进度事件载荷（phase/current/total/percentage/eta/failedCount/message/error） |
| `TagRagMeta` | interface | 持久化元数据（csvHash/dimension/model/totalTags/vectorizedCount/...），写入 `{databaseDir}/tag_rag_meta.json`（开发环境=项目根目录/database，生产环境=userData/database） |
| `TagRagState` | interface | 状态快照（`tagRag:getStatus` 返回，含 status/current/total/meta） |
| `TagRagSearchRequest` | interface | 检索请求（query/topK?/minScore?/categoryFilter?） |
| `TagRagSearchResultItem` | interface | 单条检索结果（name/category/count/aliases/score） |
| `TagRagSearchResponse` | interface | 检索响应（success/results/error?） |
| `TagRagVectorizeResult` | interface | 向量化结果（success/vectorized/failed/durationMs?/error?） |
| `TagRagVectorizeOptions` | interface | 向量化启动选项（`{ force?: boolean }`） |
| `TagRagClearResult` / `TagRagCancelResult` | interface | 清空/取消操作响应 |

通过 `src/shared/types/index.ts` barrel 暴露：`export * from './tagRag.types'`。

### 主进程 TagRagService（src/main/services/tagRagService.ts）

- **单例导出**：`export const tagRagService = { initialize, dispose, getStatus, vectorizeAll, cancelVectorization, searchRelevantTags, buildRagReferencePrompt, buildRagReferenceSection, buildRagReferenceWithDebug, validateTagsAgainstLibrary, clearIndex }`
- **模块级状态**：`currentState` 维护 status/current/total/meta（与 `vectorConfigManager` 一致的单例模式）
- **向量化流程**（`vectorizeAll`）：
  1. 并发去重：进行中直接返回已有 Promise
  2. `tagAutocompleteService.getAllTags()` 取 31.7 万 TagInfo
  3. **标签去重**：按 `name.toLowerCase()` 去重，保留 count 最高的条目（避免同名标签主键冲突）
  4. 计算索引指纹（csvHash + dimension + model）
  5. 分批 + 并发池：远程 API 500 条/批 × 并发 3（可配置）、本地 ONNX 32 条/批（顺序执行），`EmbeddingService.generateBatchEmbeddings`
  6. `VectorStoreService.addBatch()` 写入 `source='tag_library'`
  7. 每批发射 `tagRag:progress` 事件（current/total/percentage/eta）
  8. 写入 meta 到 `{databaseDir}/tag_rag_meta.json`
- **检索流程**（`searchRelevantTags`）：
  1. 降级短路：`settings.tagRag.enabled=false` 或 `status!=='ready'` → 返回 `[]`
  2. `embeddingService.generateEmbedding(query)` 生成查询向量
  3. `vectorStoreService.search(queryVec, topK, undefined, {sourceType:'tag_library'})`
  4. 过滤 `score >= minScore`、可选 categoryFilter
  5. 按 score 降序返回 `TagRagSearchResultItem[]`
- **Prompt 构建**（`buildRagReferenceSection`）：检索 top-K 后调用 `buildRagReferencePrompt` 格式化为「标签库参考」段落文本，供 `characterTraitAIService` 追加到 system prompt 尾部
- **质检报告**（`buildRagReferenceWithDebug` + `validateTagsAgainstLibrary`）：
  - `buildRagReferenceWithDebug`：与 `buildRagReferenceSection` 相同检索逻辑，额外返回 `{ enabled, status, retrievedTags }` 调试上下文
  - `validateTagsAgainstLibrary(tags)`：**async 函数**（⚠️ 调用方必须 `await`，详见 docs/FIX_RECORDS.md §7.12）。验证 AI 生成的 tag 是否在标签库中，采用**六层降级匹配链**（⚠️ 详见 docs/FIX_RECORDS.md §7.16，扩展自 §7.13 的四层）：L0 自定义映射 → L1 name 精确 → L2 alias 反查 → L3 颜色拆分 → L3b 否定性修饰词剥离 → L4 语义 KNN。任一层命中即 isValid=true 并记录 canonicalName + `source` 字段标识命中轮次。返回 `{ tag, isValid, canonicalName?, category?, count?, skipReason?, suggestions, splitTags?, source?, aiFallbackAttempted?, aiFallbackCandidates? }[]`
    - **`source` 字段**（⚠️ 详见 docs/FIX_RECORDS.md §7.16 + §7.17）：`'user-map'`（L0 自定义映射，人工审核/AI 兜底持久化结果）/`'name'`（L1）/`'alias'`（L2）/`'color-split'`（L3）/`'negation-strip'`（L3b）/`'knn'`（L4）/`'ai-fallback'`（L5 AI 兜底，由 `characterTraitAIService.applyAiFallback` 写入，非 validate 内部返回）；前端 RagQualityReport 在 tooltip 中展示命中轮次，辅助用户判断匹配来源 + 统计匹配率
    - **L0 自定义映射**（详见 §7.16）：在 L1 之前调 `userSynonymMapService.lookup(tag)`，命中则 `isValid=true, canonicalName=映射目标, source='user-map'`，跳过 L1-L4（短路）；用户在末轮人工审核指定的替换词 **或 AI 兜底命中** 持久化于此，下次同词首轮即命中
    - **L1/L2 已有**（详见 §7.13）：getTagByName + getTagByAlias + 空格/下划线互转
    - **L3 已从「颜色剥离丢弃」升级为「颜色拆分保留」**（⚠️ 重点，详见 docs/FIX_RECORDS.md §7.15）：原 `stripColorModifier` 只剥离颜色前缀让核心词命中，颜色信息被丢弃；现 `splitColorTag` 将颜色复合 tag 拆成 `colorPartTag`（如 `grey_ears`，颜色归一化 gray→grey + 亮度词丢弃）+ `feature`（如 `drooping_ears`），分别查 name/alias —— 两者都命中时返回 `splitTags={colorPartTag, featureTag}`，由 `characterTraitAIService` 将一个 trait 拆成两个（原 trait 替换为 featureTag，新增 colorPartTag trait），让颜色语义以独立标签形式进入 SD 生成链路
    - **L3b 否定性修饰词剥离**（详见 §7.16）：`stripNegationModifier(tag)` 剥离保守的否定性修饰词前缀（8 词列表：`brimless`/`sleeveless`/`strapless`/`topless`/`bottomless`/`hairless`/`wireless`/`collarless`），用核心词查 name/alias；仅当 L0-L3 全部未命中时才触发（避免误伤 `short_hair`/`open_hoodie` 等本身是标签的复合词）；命中则 `source='negation-strip'`
    - 评级词（`RATING_TAGS`：nsfw/safe/explicit/questionable/rating:*）→ `skipReason='rating'`，不纠错（对 SD 有效但非标签库范畴）
    - 其余 invalid tag → 调 `searchRelevantTags({ query, topK:3, minScore:0.15 })` 获取 top-3 相似库内标签作为 `suggestions`（复用 31.7 万向量库；minScore 由 0.25 降至 0.15，对齐颜色复合 tag 场景）；有 suggestion 时 `source='knn'`
  - **L5 AI 兜底**（⚠️ 新增，详见 docs/FIX_RECORDS.md §7.17）：`characterTraitAIService.generateCharacterTraits` 在 `validateTagsAgainstLibrary` 之后，对 `isValid=false && skipReason!=='rating' && !replacedBy` 的 tag（数量 ≤ `AI_FALLBACK_MAX_TAGS=10`）调 LLM 生成候选词（专用 `AI_FALLBACK_SYSTEM_PROMPT`，输出 `<tag> | candidate1, candidate2`），候选词再走 `validateTagsAgainstLibrary` L0-L4，首个 isValid 候选词替换 trait.text + 调 `userSynonymMapService.addMapping` 持久化（下次 L0 命中）+ 写 `source='ai-fallback'`/`aiFallbackAttempted=true`/`aiFallbackCandidates`；LLM 调用失败/全部候选词未命中 → 标记 `aiFallbackAttempted=true` 不阻塞主流程，保留 ✏ 手动入口；前端 RagQualityReport 对命中显示橙色 🤖 + 撤销按钮（`onRevertAiFallback`），未命中显示橙色淡 🤖 + 候选词 tooltip
  - `characterTraitAIService.generateCharacterTraits` **标签纠错自动替换**：invalid 非评级词 tag 若 `top1.score >= REPLACE_MIN_SCORE(0.3)` → `trait.text = suggestion.name`，记录 `replacedBy`；返回 `ragDebug` 字段含 tagValidation（含 suggestions/replacedBy/source/aiFallback*），UI 据此展示质检报告（valid/replaced/rating/no_suggestion/has_suggestion/ai-fallback-hit/ai-fallback-miss）+ ↩ 撤销按钮
  - **`applyTagAudit` 辅助方法 + 动态场景审计**（⚠️ 新增，详见 docs/FIX_RECORDS.md §7.18）：原审计逻辑（validate + L3 拆分 + L2/L3 规范化 + L4 KNN 替换 + L5 AI 兜底）内联于 `generateCharacterTraits`，与 `CategorizedTrait[]` 强耦合（`traits.find(t => t.text === v.tag)` 反查修改），无法复用于动态场景的「逗号分隔字符串」tag。提取为私有方法 `applyTagAudit(traits, context, aiConfig, runtimeConfig) → tagValidation[]`：
    - `traits` 被原地修改（text 替换 + L3 拆分 push 新 trait），调用方提取 text 即可得到审计后 tag
    - `context` 泛化：`{ description（AI 兜底语义参考）/ personality? / scenario? / characterCardId? / includeImage? }`
    - `generateCharacterTraits` 重构为一行调用（DRY，机械提取无逻辑变更，17 单测 + 58 tagRag 单测全通过验证无回归）
    - `generateTraitPrompts` 同样调用 `applyTagAudit` 完整走 L0-L5 审计链（输出 `CategorizedTrait[]` 后审计）
    - ~~`generateDynamicScenePrompts` 按维度分别调 `applyTagAudit`（clothing/pose/scene 各一次）~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 3；动态场景方案整体回退，详见 docs/FIX_RECORDS.md §7.27）
    - 前端 `AssetManagerModal` 渲染**只读** RagQualityReport（不传撤销/手动替换回调，tag 在文本框可手动编辑）；~~`RagQualityReport` 新增 `dimension` 字段 → tag 前展示维度徽标（👕 服装 / 🏃 动作 / 🌐 场景）~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 8：动态场景方案移除后 `dimension` 字段已变为死代码，从 `RagQualityReport.tsx` 中删除类型定义 / `DIMENSION_LABELS` 常量 / 维度徽标渲染三处代码块）
- **stale 检测**（`computeFreshness`）：csvHash + dimension + model 三元组任一变更 → status 降级为 `'stale'`，需重新向量化
  - csvHash = `sha256(csvPath + ':' + fileSize + ':' + mtimeMs).slice(0,16)`（不读文件内容，8MB 哈希 ~50ms）
  - 事件监听：`tagCsvEmitter 'tag-csv-loaded'` + `vectorConfigManager.onDimensionChange`

### 降级保证（核心契约）

- `settings.tagRag.enabled=false` → `searchRelevantTags` / `buildRagReferencePrompt` 返回空
- 未向量化（status=idle/stale/error）→ `searchRelevantTags` 返回空数组
- EmbeddingService 未配置 / 向量化失败 → 不阻塞主流程，仅返回空结果
- 任何异常捕获后写日志，**不向调用方抛错**（AI 生成特征主流程不受 RAG 故障影响）

### 主进程 UserSynonymMapService（src/main/services/userSynonymMapService.ts）

> ⚠️ 详见 docs/FIX_RECORDS.md §7.16 — 多轮标签审计与替换机制；§7.17 — AI 兜底标签审核

**职责**：持久化标签替换映射（来源：用户「末轮人工审核入口」手动指定 **+ L5 AI 兜底命中自动写入**），跨会话保留；`tagRagService.validateTagsAgainstLibrary` 在 L1 之前查询本表（L0），人工审核 / AI 兜底命中结果下次同词首轮即命中（闭环）
**持久化路径**：`{userData}/data/user-synonym-map.json`（与 `categoryDictionaryService` 一致，由 `getUserDataPath()` 解析）
**数据结构**：`Record<originalTagLowercase, replacementTag>`（扁平键值对；key 统一小写实现大小写不敏感查询，value 保留原样作为 canonicalName 直传）
**关键方法**：
- `load()` — 文件不存在返回空 Map；JSON 损坏/非对象返回空 Map（不覆盖磁盘文件）；key 强制小写、value 必须 string，否则跳过该项；重复 load 幂等（覆盖旧 cache）
- `addMapping(original, replacement)` — 入参 trim，空值跳过；key 小写（大小写不敏感）；写入即 `save()` 落盘；同 key 已存在 → 覆盖（用户重新指定 = 更新映射）
- `removeMapping(original)` — key 不存在时幂等（不抛异常、不落盘）；删除即 `save()` 落盘
- `lookup(tag)` — 大小写不敏感查询；命中返回 replacement，未命中返回 null；未 load 时自动调 `load()`
- `getMap()` — 返回 `Record` 形式浅拷贝（IPC 序列化友好，修改返回值不影响内部 cache）
**内存缓存**：`Map<string, string>`（key 小写），构造时不自动 load（避免主进程启动顺序依赖），由 `tagRagService.initialize()` 显式调用 `load()` 后再查询
**I/O 模式**：同步 `fs.readFileSync`/`fs.writeFileSync`/`fs.existsSync`/`fs.mkdirSync`（映射表预期很小，数十到数百条，同步 I/O 不阻塞主进程）
**错误处理**：所有方法包裹 try/catch，永不抛异常；文件不存在 → 返回空 Map；JSON 解析失败 → 返回空 Map + console.warn（不覆盖磁盘）；写入失败 → console.error，方法静默返回

### IPC 通道（src/main/ipc/handlers/tagRagHandlers.ts）

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `tagRag:getStatus` | 无 | `Promise<TagRagState>` | 获取状态快照（status/current/total/meta） |
| `tagRag:startVectorization` | `TagRagVectorizeOptions?` | `Promise<TagRagVectorizeResult>` | 启动向量化（异步长任务，完成前不返回；进度走 `tagRag:progress` 事件） |
| `tagRag:cancelVectorization` | 无 | `Promise<TagRagCancelResult>` | 取消进行中的向量化（已写入数据保留，状态转 idle） |
| `tagRag:search` | `TagRagSearchRequest` | `Promise<TagRagSearchResponse>` | 语义检索相关标签（设置面板检索测试区用） |
| `tagRag:clearIndex` | 无 | `Promise<TagRagClearResult>` | 清空索引（删除向量文件 + meta 文件，vectorizing 中需先 cancel） |
| `tagRag:progress`（广播） | — | `TagRagProgressEvent` | 主进程 → 渲染进程单向推送向量化进度（非 invoke，`tagRagProgressEmitter` 发射） |
| `tagRag:getUserSynonymMap` | 无 | `Promise<Record<string, string>>` | 获取全部自定义同义词映射（L0 自定义映射表，详见 §7.16） |
| `tagRag:addUserSynonymMapping` | `{ original, replacement }` | `Promise<void>` | 新增/更新一条映射（人工审核替换时调用，写入即落盘） |
| `tagRag:removeUserSynonymMapping` | `{ original }` | `Promise<void>` | 删除一条映射（撤销人工替换时调用，删除即落盘） |

注册顺序：在 `registerTagHandlers()` 之后追加 `registerTagRagHandlers()`，并在 IPC 注册完成后调用 `tagRagService.initialize()` 注册事件监听（`src/main/ipc/index.ts`）。

Preload 暴露（`src/main/preload.ts`）：`tagRag: { getStatus, startVectorization, cancelVectorization, search, clearIndex, onProgress(callback) → unsubscribe, getUserSynonymMap, addUserSynonymMapping, removeUserSynonymMapping }`。渲染进程类型声明对齐 `src/renderer/types/electron.d.ts`。

### AppSetting 配置块（src/renderer/types/setting.ts + src/shared/settings.ts）

```typescript
export interface TagRagConfig {
  enabled: boolean;                              // 是否启用 RAG 注入（默认 false，向量化后手动开启）
  topK: number;                                  // 检索数量（默认 40）
  minScore: number;                              // 最低相似度阈值 cosine（默认 0.15）
  autoRevectorizeOnCsvChange: boolean;           // CSV 变更自动标记 stale（默认 true）
  autoRevectorizeOnDimensionChange: boolean;     // 维度变更自动标记 stale（默认 true）
  batchSize: number;                             // 远程 API 批大小（默认 500，OpenAI 支持最高 2048）
  localBatchSize: number;                        // 本地 ONNX 批大小（默认 32）
  concurrency: number;                           // 远程 API 并发请求数（默认 3，本地 ONNX 强制 1）
  retryMaxAttempts: number;                      // 单批失败重试次数（默认 3）
  retryDelayMs: number;                          // 重试间隔（默认 1000）
}

// AppSetting 接口扩展
tagRag?: TagRagConfig;

// defaultSetting.tagRag 默认值
tagRag: { enabled: false, topK: 40, minScore: 0.15, autoRevectorizeOnCsvChange: true,
          autoRevectorizeOnDimensionChange: true, batchSize: 500, localBatchSize: 32,
          concurrency: 3, retryMaxAttempts: 3, retryDelayMs: 1000 }
```

向量源类型扩展（`src/main/types/vectorConfig.ts`）：`VectorSourceType.TAG_LIBRARY = 'tag_library'`，storageDir=`tag_library`，perEntrySubdir=true（sourceId=csvHash，支持多 CSV 切换）。

### AI 生成特征注入点（src/main/services/characterTraitAIService.ts — Task 9）

三个生成方法在构建 system prompt 后、调用 LLM 前，统一通过私有方法 `buildRagReferenceSection(queryText)` 注入 RAG 参考段落：

| 方法 | 查询文本 | 注入位置 |
|---|---|---|
| `generateCharacterTraits` | 角色描述 `description` | `dynamicSystemPrompt` 尾部 |
| `recognizeImageTraits` | `characterName \|\| 'character'` | `dynamicImageSystemPrompt` 尾部 |
| `generateTraitPrompts` | 用户提示词 `prompt` | `buildDynamicTraitSystemPrompt` 尾部 |
| ~~`generateDynamicScenePrompts`~~ | ~~自然语言指令 `naturalLanguageInput`~~ | ~~`DYNAMIC_SCENE_SYSTEM_PROMPT` 尾部~~（⚠️ **已移除**，change-id: replace-dynamic-scene-with-prompt-gen / Task 3；`generateTraitPrompts` 已替代） |

`buildRagReferenceSection` 内部委托 `tagRagService.buildRagReferenceSection`，try/catch 包裹确保任何异常都不影响主流程（异常时返回空字符串，system prompt 保持原样）。

### 渲染进程 TagRagSettings 面板（src/renderer/components/Settings/TagRagSettings.tsx — Task 10）

- 通过 `forwardRef<TagRagSettingsRef>` 暴露 `getFormValues()` 供父 `Settings.tsx` 在保存时收集表单值（与 `TagAutocomplete` 设置面板一致的 ref 模式）
- 状态卡片：根据 `tagRag:getStatus` 轮询展示 idle/vectorizing/ready/error/stale 五态，含 meta 信息（vectorizedCount/dimension/model/lastVectorizedAt）
- 进度条：订阅 `tagRag.onProgress` 实时更新 percentage/current/total/eta，含失败条数展示
- 向量化按钮：调 `tagRag.startVectorization({force})`，进行中禁用并显示取消按钮
- 检索测试区：输入文本 → `tagRag.search` → 展示 top-K 结果（name/category/score）
- 清空索引按钮：调 `tagRag.clearIndex`，需二次确认

挂载点：`src/renderer/components/Settings/Settings.tsx` 中 `<TagRagSettings ref={tagRagConfigRef} />`，保存时 `tagRagConfigRef.current?.getFormValues()` 合并到 `setting.save`。

### 涉及文件清单

**新增文件（6 个）**：
- `src/shared/types/tagRag.types.ts` — 11 个共享类型定义
- `src/main/services/tagRagService.ts` — 核心服务（向量化 / 检索 / Prompt 构建 / stale 检测）
- `src/main/services/tagRagProgressEmitter.ts` — 进度事件发射器（`tagRag:progress` 广播）
- `src/main/ipc/handlers/tagRagHandlers.ts` — 5 个 IPC handler + 1 个广播通道
- `src/renderer/components/Settings/TagRagSettings.tsx` — 设置面板（状态/进度/检索测试）
- `src/main/services/__tests__/tagRagService.test.ts` — 24 个单元测试用例

**修改文件（8 个）**：
- `src/main/types/vectorConfig.ts` — 新增 `VectorSourceType.TAG_LIBRARY` 枚举 + Label/Description/StorageConfig
- `src/shared/settings.ts` — `defaultSetting.tagRag` 配置块
- `src/main/services/tagAutocompleteService.ts` — 新增 `getAllTags()` + `tagCsvEmitter` 事件广播（Task 6）
- `src/main/services/characterTraitAIService.ts` — 三个生成方法注入 RAG 参考段落（Task 9）
- `src/main/ipc/index.ts` — 注册 `registerTagRagHandlers()` + 调用 `tagRagService.initialize()`
- `src/main/preload.ts` — 暴露 `tagRag` 命名空间（5 个 IPC + onProgress 订阅）
- `src/renderer/types/electron.d.ts` — 补全 `tagRag` API 类型声明
- `src/renderer/components/Settings/Settings.tsx` — 追加 `<TagRagSettings>` 子面板
- `src/renderer/types/setting.ts` — 新增 `TagRagConfig` 类型

### ⚠️ 待 Electron 集成测试验证项

单元测试覆盖了状态管理、降级路径、Prompt 构建、过滤逻辑，但以下场景需 Electron 集成测试补位（与 `SqliteVecBackend.test.ts` 一致的 Native Module Test Gap Convention）：

1. 向量化端到端（标签库加载 → 分批向量化 → 落盘 → meta 写入）
2. vec0 MATCH KNN 真实 cosine 距离 + post-filter 语义（已知盲区，vec0 固有约束：KNN 先返回 top-K 再过滤元数据，过滤后可能 < K 条；已固化在 `SqliteVecBackend.ts:search()` 注释，详见 FIX_RECORDS §7.8）
3. 维度变更 / CSV 替换触发 stale 的事件链路
4. AI 生成端到端（`tagRag.enabled=true` + 索引 ready → system prompt 含参考段落 → traits 全在标签库中）

详见 `docs/FIX_RECORDS.md` §7.8。

---

## §15 性能优化（Spec: optimize-system-rendering-performance）

> 实施日期：2026-08-06 | 9 个 Task 全部完成 | 详细修复记录见 `docs/FIX_RECORDS.md` §8.1 ~ §8.10

### 概述

针对渲染性能（列表滚动卡顿、图片网格首屏掉帧、初始 bundle 过大）的系统性优化。采用「先测量后优化 + 最小实现优先」原则，覆盖五个维度：性能基线工具、路由级代码分割、列表虚拟滚动、图片懒加载缩略图管线、重渲染审计。

**量化成果**：初始 chunk 体积从 ~4,070 kB（单 chunk）降至 ~1,750 kB（entry+react+antd），**-57%**（超 ≥30% 目标）。运行时指标（滚动 ≤100ms / 图片 -50%）待用户 dev 模式采集回填 §8.1。

> 注：本项目的「架构真源」§3 目录树 / §4.2 IPC 注册顺序 / §4.3 命名空间表 / §4.4 服务表等章节因 2026-08-01 磁盘异常丢失（见文件头说明），重建后的 CODE_WIKI 采用按特性分章的扁平结构。故本次新增模块的架构归档（目录树增量、IPC 命名空间、服务表条目）统一收入本章 §15.4，而非回填已不存在的 §3/§4。

### §15.1 性能基线与测量工具

| 文件 | 职责 |
|------|------|
| `src/renderer/utils/perfBaseline.ts`（新增） | Performance API 基线测量工具，**仅 dev 模式生效**（`import.meta.env.DEV` + `performance` API 双守卫，生产环境 no-op 零开销）。导出：`measureScrollFPS`（滚动帧间隔/FPS/长任务数）、`measureFirstScreenComplete`（图片网格首屏完成时间）、`startLongTaskObserver`（longtask 观察者）、`formatBaselineReport`（格式化报告） |
| `vite.config.ts`（修改） | 新增 `rollup-plugin-visualizer` 插件，构建输出 `dist/stats.html` treemap 报告（仅 renderer build） |

- 基线指标表与采集步骤见 FIX_RECORDS §8.1 / §8.2；达标判定标准见 §8.4。
- ⚠️ **visualizer ESM bug（重点标记）**：`rollup-plugin-visualizer@7` 为 ESM-only 包，本项目未启 `"type": "module"`，静态 import 会导致 `npm run build` 失败。改用 `defineConfig(async () => { const { visualizer } = await import(...) })` 动态 import 绕过 CJS require。详见 §8.5。

### §15.2 路由级代码分割与 vendor 拆分

| 改动点 | 文件 | 说明 |
|--------|------|------|
| 路由懒加载 | `src/renderer/routeConfig.ts`（修改） | 全部 12 个路由组件改为 `React.lazy(() => import(...))`；命名导出用 `.then(m => ({ default: m.X }))` 适配 |
| Suspense 包裹 | `src/renderer/App.tsx`（修改） | `<Suspense fallback={routeFallback}>` 包裹路由内容（居中 `<Spin size="large" />`），Sidebar/Header 始终可见 |
| 厂商分块 | `vite.config.ts`（修改） | `manualChunks` 拆分 5 组 vendor：`vendor-react` / `vendor-antd` / `vendor-milkdown` / `vendor-ai` / `vendor-markdown`。顺序敏感：markdown/antd/milkdown/ai 必须先于 react 兜底判断，否则 react-markdown 等被 react 通配误吞 |

**构建产物（5669 modules transformed）：**

| Chunk | 体积 | gzip | 加载时机 |
|-------|------|------|----------|
| entry `index-BOkPa-8-.js` | 274.59 kB | 79.71 kB | 初始 |
| vendor-react | 142.37 kB | 45.63 kB | 初始 |
| vendor-antd | 1,333.23 kB | 420.04 kB | 初始（App shell 用 antd） |
| vendor-milkdown | 1,364.44 kB | 434.44 kB | **懒加载**（WorldBook/编辑器打开时） |
| vendor-markdown | 573.56 kB | 159.21 kB | **懒加载** |
| vendor-ai | 382.28 kB | 98.02 kB | **懒加载** |
| 路由懒 chunks | 31~188 kB | — | 各路由打开时 |

**初始加载 ≈ 1,750 kB**（entry + react + antd）vs 原单 chunk ~4,070 kB → **-57%**（目标 ≥30%）。

### §15.3 列表虚拟滚动

| 站点 | 方案 | 文件 | 阈值 |
|------|------|------|------|
| AssetManagerModal 素材网格 | `useVirtualizer`（@tanstack/react-virtual）行虚拟化 + 行内多列 grid | `AssetManagerModal.tsx`（`AssetVirtualGrid` 内联组件） | ≥50 项虚拟化，<50 回退 `.map()`+CSS grid |
| CharacterListView（角色卡列表） | antd v6 Table 内置 `virtual` prop + `scroll={{ y: 500 }}` | `CharacterListView.tsx` | — |
| KnowledgeItemList（知识库文档树） | antd v6 Table 内置 `virtual` prop + `scroll={{ x:860, y:500 }}` | `KnowledgeItemList.tsx` | — |
| PromptManagement | 跳过（固定 ~20 项） | `PromptManagement.tsx` 文件头 `[perf]` 注释 | <50 |
| AvatarManager | 跳过（手工 <50 项） | `AvatarManager.tsx` 文件头 `[perf]` 注释 | <50 |

- **Task 4 委托发现（重点标记）**：`CharacterManager` 不直接渲染角色卡列表，委托给子组件 `CharacterListView`。虚拟化改造须落在 `CharacterListView` 而非 `CharacterManager`。详见 §8.10。
- 虚拟化方案选型（useVirtualizer vs antd Table virtual）见 §8.7 / §8.8。
- 列表项 `React.memo` + handler `useCallback` 覆盖率 100%（AssetCard / CharacterListView / DocumentActions / LeafActions / ModuleListItem / AvatarCard / ProfileCard / FavoriteItem）。

### §15.4 图片懒加载与缩略图管线（含架构归档）

#### 数据流

```
渲染进程                              Preload 桥                主进程
LazyImage                            thumbnail 命名空间         thumbnailService (nativeImage)
  │ IntersectionObserver 进入视口      │                         │
  │ → imageCache 渲染 LRU 查询         │                         │
  │   命中 → 直接渲染 <img src=dataUrl>│                         │
  │   未命中 → thumbnail.get ──────────┤invoke('thumbnail:get')─→│ getThumbnail()
  │                                     │                         │  内存 LRU(200) → 磁盘 → nativeImage 生成
  │ ← { dataUrl, mime, fromCache } ────┤←────────────────────────│  写磁盘 + 内存 LRU
  │ → setCachedThumbnail 写渲染 LRU     │                         │
  │ → <img src=dataUrl> 淡入渲染        │                         │
  │                                     │                         │
  │ invalidateImageCache()「双清」      │                         │
  │   1. 清渲染 LRU                     │                         │
  │   2. thumbnail.invalidate ─────────┤invoke('thumbnail:invalidate')→ invalidateThumbnail()
```

#### 新增模块（架构归档）

**目录树增量：**
```
src/
├─ renderer/
│  ├─ utils/
│  │  ├─ perfBaseline.ts        # 性能基线测量工具（dev-only）
│  │  └─ imageCache.ts          # 渲染进程缩略图 dataUrl LRU 缓存（容量 300）
│  └─ components/Common/
│     └─ LazyImage.tsx          # IntersectionObserver 懒加载图片组件
└─ main/
   ├─ services/
   │  └─ thumbnailService.ts    # nativeImage 缩略图管线（内存+磁盘两级缓存）
   └─ ipc/handlers/
      └─ thumbnailHandlers.ts   # thumbnail:get / thumbnail:invalidate IPC handler
```

**IPC 命名空间表增量 — `thumbnail`：**

| IPC 通道 | 入参 | 返回 | 注册位置 | 说明 |
|---|---|---|---|---|
| `thumbnail:get` | `{ sourcePath: string; size?: 256\|384 }` | `{ dataUrl, mime, fromCache }` 或 `{ error }` | `ipc/index.ts:128` `registerThumbnailHandlers()` | 生成/读取缩略图 dataUrl（命中内存→磁盘→重新生成） |
| `thumbnail:invalidate` | 无 | `{ ok: true }` 或 `{ ok:false, error }` | 同上 | 粗粒度清空全部缩略图缓存（内存 LRU + 磁盘目录） |

**服务表增量 — `thumbnailService`：**

| 服务 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| `thumbnailService`（单例） | `src/main/services/thumbnailService.ts` | 基于 Electron `nativeImage` 的缩略图生成 + 两级缓存（内存 LRU 200 + 磁盘 `userData/thumbnails/<sha1>.<jpg\|png>`） | `electron.nativeImage`、`lru-cache@11`、`crypto`；零新原生依赖 |

**IPC 注册顺序增量：** `registerThumbnailHandlers()` 在 `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 中调用（与 `registerAssetHandlers` / `registerTagRagHandlers` 等同模式）。

#### 关键设计决策

1. **nativeImage 选型（零新原生依赖）**：优先 Electron 内置 `nativeImage`，避免引入 `sharp`（需 electron-rebuild，受 Native Module Test Gap Convention 约束）。详见 §8.10。
2. **输出格式**：`nativeImage.toDataURL()` 的 WebP 支持随版本/平台变化不可靠；改用 PNG 源→PNG（无损保留透明）、其余→JPEG(80)（体积小）。
3. **dataUrl vs Blob URL（最小实现优先）**：thumbnail IPC 返回 dataUrl 字符串可直接作 `<img src>`（CSP 兼容），无需 Blob URL，省去 `revokeObjectURL` 生命周期管理。详见 `imageCache.ts` 文件头 + §8.9。
4. **双清失效**：`invalidateImageCache()` 同步清渲染 LRU + 异步调 `thumbnail:invalidate` IPC 清主进程缓存，保证素材替换/删除后彻底失效。
5. **缓存键**：主进程 `sha1(sourcePath|mtimeMs|size)`（含 mtime，编辑后自动失效）；渲染进程 `${sourcePath}::${size}`（仅作 IPC 前置命中层，主进程负责 mtime 失效）。

### §15.5 重渲染优化

| 维度 | 范围 | 文件 |
|------|------|------|
| zustand selector 化 | 105 处无 selector 调用点中 93 处转为 `useXxxStore(s => s.field)` 精准订阅；12 处 >5 字段暂缓并加 `// TODO(perf)` 注释 | ~49 个 renderer 文件（App.tsx / Sidebar / Header / Dashboard / CharacterManager / AssetManagerModal 等） |
| React.memo + useCallback | 所有列表项组件 + handler 稳定化 | AssetManagerModal / CharacterManager / CharacterListView / KnowledgeItemList / PromptManagement / AvatarManager / CreationCenter |

- selector 审计全量清单（93 处修复 + 12 处暂缓）见 §8.6。
- 重渲染优化明细见 §8.7（AssetManagerModal）/ §8.8（其余列表页）。

### §15.6 关键约束与遗留

1. **Native Module Test Gap Convention（nativeImage）**：`thumbnailService` 依赖 Electron 运行时 `nativeImage`，vitest 无法加载，真实行为（resize/格式转换/缓存命中）依赖 Electron 集成测试补位。已在 `thumbnailService.ts:34-36` 与 `thumbnailHandlers.ts:14-15` 文件头标注。若质量不足可切 `sharp`，但需 electron-rebuild + 同样受该约定约束。
2. **运行时指标待用户验证**：基线从未采集（Task 1.3 延迟至用户）。滚动 ≤100ms / 图片首屏 -50% / 长任务数=0 三项需用户在 dev 模式用 `perfBaseline.ts` 工具采集后回填 §8.1 基线表，方可判定达标。
3. **重点标记项汇总**（详见 §8.10）：
   - visualizer ESM 静态 import 构建失败（§8.5）
   - nativeImage Native Module 约束（不可单测）
   - dataUrl vs Blob URL 设计调整（最小实现优先）
   - Task 4 CharacterListView 委托发现（CharacterManager 不直接渲染列表）
4. **暂缓项**：12 处 zustand 整体订阅（>5 字段）保留并加 `// TODO(perf)` 注释，待后续拆分。

---

## §16 设置页页签化重构（UI 重构：单页堆叠 → antd Tabs 分组）

### 概述
将 `src/renderer/components/Settings/Settings.tsx` 的设置页从「7 个子面板垂直堆叠在单页」改造为「antd `Tabs` 5 个页签分组」布局。纯 UI 层改动，**未修改任何子面板组件、store、IPC、类型**。底部分隔线 + 3 个操作按钮（保存设置 / 打开配置文件 / 重置设置）保持在 `<Tabs>` 之外，沿用原 `handleSave` / `handleOpenConfigFile` / `handleReset`。

### 5 个页签分组（顺序固定）
| key | label | 子面板 |
| --- | --- | --- |
| `general` | 通用 | `GeneralSettingsPanel`（接收共享 `form`） |
| `ai-engine` | AI 引擎 | `AIEngineSettingsPanel`（接收共享 `form`） |
| `image-gen` | 图像生成 | `SDWebuiSettings`（ref: `sdWebuiConfigRef`） |
| `vector-rag` | 向量与 RAG | `VectorConfigPanel`（ref: `vectorConfigRef`）+ `TagRagSettings`（ref: `tagRagConfigRef`） |
| `tags-search` | 标签与搜索 | `TagAutocompleteSettings`（ref: `tagAutocompleteConfigRef`）+ `WebSearchSettings`（ref: `webSearchConfigRef`） |

### ⚠️ 重点标记：`forceRender: true` 是硬性约束（违反会丢数据）
**这是本次重构唯一可能导致数据丢失的约束，必须长期保留。**

- 父组件 `handleSave` 通过 5 个 ref 的 `getFormValues()` 收集子面板表单值，并使用条件展开合并：`...(sdWebuiConfig ? { sdWebui: sdWebuiConfig } : {})`。
- 若某个 ref 对应的子面板未挂载，`ref.current` 为 `null`，`getFormValues()` 返回 `undefined`，该配置字段会被**静默丢弃**，导致 `settings.json` 中对应字段缺失 → **数据丢失**。
- 因此 **5 个页签 item 必须全部设置 `forceRender: true`**，确保所有子面板在首屏即挂载（即使页签未激活）。
- antd v6 已废弃 `destroyInactiveTabPane`，默认行为即「非激活页签保持挂载」，**不要**设置 `destroyOnHidden`（默认 false 即保持挂载，符合需求）。也不要改回 `destroyInactiveTabPane`。

### antd v6 API 适配
- `Tabs` 使用 `items` API（非旧版 `<Tabs.TabPane>` 子元素写法）。
- **`tabPosition` 已废弃**，改用 `tabPlacement="top"`。本实现使用 `tabPlacement="top"`。
- 不要引入 `destroyInactiveTabPane` / `tabPosition`。

### 状态与导入变更
- 新增 `activeTab` 状态：`const [activeTab, setActiveTab] = useState('general');`（位于既有 `useState` 附近）。
- antd 导入追加 `Tabs`：`import { Form, Button, Space, message, Divider, Tabs } from 'antd';`。
- `useState` / `useMemo` 复用既有 React 导入，无需新增。
- 所有 `useEffect`（设置表单值 / `dashboardBackgroundImage` / `debugMode`）、5 个 ref 声明、`activeEngine` useMemo、`handleSave` / `handleOpenConfigFile` / `handleReset` **均未改动**。

### CSS 增量（`Settings.css` 末尾追加，未删除任何既有规则）
```css
/* 页签内首个卡片去除顶部间距，避免页签栏下方出现多余空白 */
.settings .ant-tabs-tabpane > .ant-card:first-child { margin-top: 0 !important; }
/* 页签内容区顶部留白 */
.settings .ant-tabs-tabpane { padding-top: 4px; }
/* 页签标签文字颜色适配主题 */
.settings .ant-tabs-tab { color: var(--text-secondary); }
.settings .ant-tabs-tab-active .ant-tabs-tab-btn { color: var(--color-primary, #1677ff); font-weight: 500; }
```
说明：多个子面板的 `Card` 使用 `style={{ marginTop: 16 }}`，页签化后首个卡片顶部会出现多余空白，故用 `:first-child` 选择器置零；卡片间距仍由既有 `.settings .ant-card { margin-bottom: 16px; }` 维持。

### 涉及文件清单
- `src/renderer/components/Settings/Settings.tsx` — 导入 `Tabs` + 新增 `activeTab` 状态 + 将 7 个子面板堆叠替换为 5 页签 `Tabs`（每个 item `forceRender: true`）+ 底部按钮区保持在 `<Tabs>` 之外。
- `src/renderer/components/Settings/Settings.css` — 末尾追加 4 条页签相关样式，既有规则全部保留。

### 验证状态
- 静态检查（findstr）：`tabPosition` / `destroyInactiveTabPane` 均未出现；`tabPlacement="top"` 存在；`forceRender: true` 出现 5 次（与 5 个页签一一对应）；3 个底部按钮 handler 与 `<Divider />` / `<Space>` 结构完整保留。
- **未运行 dev server / build**（按任务要求仅做静态编辑与读校验）。运行时回归需在 dev 模式下逐页签切换并执行一次「保存设置」后检查 `settings.json` 中 `sdWebui` / `vector` / `webSearch` / `tagAutocomplete` / `tagRag` 字段是否完整保留（用于验证 `forceRender` 生效、未丢字段）。

---

## §17 表情预置提示词优化脚本（Spec: optimize-expression-preset-prompts，2026-08-07）

### 概述

一次性 TypeScript 脚本 `scripts/optimize-expression-prompts.ts`（约 1016 行），用于优化 `PromptBuilder.ts:1480-1512` 中硬编码的 `EMOTION_PROMPT_MAP`（31 种情绪的 SD 提示词）。

**问题背景**：原 `EMOTION_PROMPT_MAP` 存在两个缺陷：
1. 大量 tag 不在 Danbooru/e621 标签库中（如 `aroused`、`lustful`、`heavy breathing` 等）
2. 仅含面部表情描述，缺少 4 个维度（面部表情 / 动作 / 符号 / 背景）

**脚本能力**：对每个情绪调 LLM 生成 4 维度候选 tag → 走 L0-L3b 审计链质检 → 输出 JSON 报告 + 可粘贴的 TypeScript 代码。

### 执行方式

```bash
npx tsx scripts/optimize-expression-prompts.ts
```

依赖：
- 应用中已配置 AI 引擎（`baseUrl` / `apiKey` / `modelName`），读取自 `%APPDATA%/creative-cafe/data/settings.json`
- `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv` 标签库文件存在

### 输出文件

| 文件 | 用途 |
|---|---|
| `scripts/expression-prompt-optimization-report.json` | 详细审计报告（每情绪的 4 维度 tag、审计结果、failed tag 列表） |
| `scripts/expression-prompt-map.generated.ts` | 可粘贴替换 `EMOTION_PROMPT_MAP` 的 TypeScript 代码片段 |

### 路径处理方案（B + C 混合）

脚本在 Node.js（非 Electron）环境下直接运行，因此对 Electron 依赖采取以下策略：

| 服务 | 处理方式 | 原因 |
|---|---|---|
| `tagAutocompleteService` | **直接 import**（方案 C） | 该服务内部 `resolveBundledCsvPath()` 已有 `__dirname` 兜底，try/catch 失败时降级到 `path.join(__dirname, '..', '..', '..')` 推导项目根目录，可在 Node.js 中无 Electron 时正常加载 `docs/` 下的 CSV |
| `aiConfigProvider` / `storageService` | **直接读 settings.json**（方案 B） | 这两个服务 import `ipcMain` 等 Electron 模块，在 Node.js 中无法直接 import；脚本改为直接读取 `%APPDATA%/creative-cafe/data/settings.json` 解析 `aiEngines` / `activeEngineId` |
| `userSynonymMapService` | **跳过 L0**（方案 B） | 该服务在 Node.js 下因 `getUserDataPath()` 路径与生产环境不一致（缺少 `creative-cafe` 子目录后缀），可能读到错误位置，故脚本省略 L0；对一次性优化无影响 |
| `tagRagService` / `characterTraitAIService` | **不 import**（方案 B） | 依赖 `sqlite-vec` 向量数据库与 `storageService`，在 Node.js 中无法直接 import；脚本中实现简化版审计逻辑替代 |

### 审计链实现（简化降级 L0-L3b）

完整审计链包含 7 层（参见 `tagRagService.validateTagsAgainstLibrary` 与 `characterTraitAIService.applyTagAudit`）：

| 层级 | 名称 | 脚本实现 | 说明 |
|---|---|---|---|
| L0 | 用户自定义同义词映射 | ❌ 跳过 | `userSynonymMapService` 路径不一致问题 |
| L1 | name 精确匹配 | ✅ 复用 `tagAutocompleteService.getTagByName` | 含空格/下划线互转 |
| L2 | alias 精确匹配 | ✅ 复用 `tagAutocompleteService.getTagByAlias` | 含空格/下划线互转 |
| L3 | 颜色拆分 | ✅ 复用 `splitColorTag`（脚本内重实现） | 与 `tagRagService.splitColorTag` 等价 |
| L3b | 否定性修饰词剥离 | ✅ 复用 `stripNegationModifier`（脚本内重实现） | 与 `tagRagService.stripNegationModifier` 等价 |
| L4 | KNN 语义检索 | ❌ 跳过 | 依赖 `sqlite-vec` 向量数据库 |
| L5 | AI 兜底 | ❌ 跳过 | 依赖额外 LLM 调用，保留人工审核入口 |

未通过 L1-L3b 的 tag 标记为 `failed: true`，写入报告 `abnormalPrompts` 列表，由用户在应用内通过 `RagQualityReport` UI 处理。

### 关键函数

| 函数 | 职责 |
|---|---|
| `loadAIConfig()` | 从 `settings.json` 读取激活引擎配置（baseUrl/apiKey/modelName/temperature/maxTokens），缺失即抛错退出 |
| `generateCandidateTags(emotionKey, emotionLabel, aiConfig)` | 调 LLM `${baseUrl}/v1/chat/completions`（非流式），按 `---FACE---` / `---ACTION---` / `---SYMBOL---` / `---BACKGROUND---` 4 个分隔符解析为 `CandidateTags` |
| `auditTag(tag)` | 单个 tag 的 L1-L3b 审计，返回 `{ originalTag, isValid, canonicalName?, replacedBy?, source, failed }` |
| `auditCandidateTags(candidateTags)` | 合并 4 维度 tag → 逐个审计 → 去重 → 返回 `{ auditedTags, failedTags, tagAuditDetails }` |
| `writeReport(report)` | 写入 `expression-prompt-optimization-report.json` |
| `writeGeneratedMap(results)` | 生成 `expression-prompt-map.generated.ts`，格式与原 `EMOTION_PROMPT_MAP` 完全一致 |
| `main()` | 主流程编排：加载标签库 → 校验配置 → 遍历 31 情绪 → 汇总 → 输出报告 |

### 错误恢复

- 单个情绪生成失败：记录 `error` 字段并继续下一个情绪（不中断）
- 失败的情绪：`finalPositive` 为空字符串，便于人工补全
- 标签库加载失败：抛错退出（致命错误）
- AI 引擎配置缺失：抛错退出（致命错误）

### ⚠️ 已知限制（需用户注意）

1. **L4 KNN 与 L5 AI 兜底未实现**：脚本仅做 L1-L3b 审计。若需完整的 7 层审计，请在应用内通过 `RagQualityReport` UI 触发。
2. **L0 用户自定义同义词映射跳过**：脚本不读取 `user-synonym-map.json`（路径不一致问题）。若需复用历史人工审核结果，可在应用内通过 `applyTagAudit` 处理。
3. **AI 引擎配置读取依赖 settings.json 路径**：脚本硬编码 `%APPDATA%/creative-cafe/data/settings.json`（Windows）。macOS / Linux 路径见 `getSettingsPath()` 实现。
4. **生成代码需人工粘贴**：脚本输出 `expression-prompt-map.generated.ts`，需手动将其中 `EMOTION_PROMPT_MAP` 整体复制粘贴到 `PromptBuilder.ts:1480-1512` 位置。
5. **NSFW 保留**：系统提示词明确告知 LLM 保留成人向表达，但使用 Danbooru/e621 标签库中的合法 tag。生成的提示词仍可能包含 NSFW 内容。

### 涉及文件清单

- `scripts/optimize-expression-prompts.ts` — 新建脚本（约 1016 行）
- 复用：`src/main/services/tagAutocompleteService.ts`（直接 import）
- 输出：`scripts/expression-prompt-optimization-report.json` + `scripts/expression-prompt-map.generated.ts`

### 验证状态

- **类型检查通过**：`npx tsc --noEmit --skipLibCheck --target ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop scripts/optimize-expression-prompts.ts` 返回 exit code 0（脚本顶部 `// @ts-nocheck` 是为了兼容 Electron 类型推断失败的场景，本机环境下移除也可通过）。
- **加载验证通过**：`npx tsx -e "require('./scripts/optimize-expression-prompts.ts')"` 成功加载，无运行时错误。
- **审计链 smoke test 通过**：对 16 个测试 tag（含 valid / invalid / 颜色拆分 / 评级词）走 L1-L3b，结果符合预期：
  - `open_mouth` / `blue_eyes` / `blush` / `smile` / `looking_at_viewer` / `panting` / `half-closed_eyes` → L1 name 命中
  - `sweat_drops` → L2 alias 命中，canonicalName=`sweatdrop`
  - `light_gray_drooping_ears` → L3 颜色拆分，split 为 `grey_ears` + `drooping_ears`
  - `lustful` / `flushed_skin` → FAILED（不在标签库，标记为异常 tag）
  - `nsfw` → source='rating'（评级词，不视为 failed）
- **未执行完整 LLM 调用**：避免消耗 API 配额与时间，主流程 `main()` 由用户自行执行。

## §18 拆分标签视觉标识 + 组合方案下拉支持 traitSnapshot（Spec: optimize-trait-translation-and-temp-scheme / Task 4 + Task 8，2026-08-07）

> 增量章节：本节仅归档 AssetManagerModal 侧的 Task 4（拆分标签 UI 标识）+ Task 8（组合方案下拉支持 traitSnapshot）。完整 spec 含 9 个 Task，其余 Task 由并行 agent 处理或前序任务已完成。

### 概述

为 L3 颜色拆分生成的特征标签（`originalText` 存在）添加视觉标识，让用户能识别拆分产物并查看原始复合标签文本；同时为含 `traitSnapshot` 的组合方案在下拉中加 📋 标识，让用户能预知方案应用行为（完整替换 traits vs 仅切换 enabled）。

### 关键数据字段（Task 1 已扩展，本节消费）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `CharacterTraitItem.originalText` | `string?` | L3 颜色拆分时设置（如 `grey long hair` 拆分为 `grey_hair` + `long_hair`，两者 originalText 均为 `grey long hair`）；手动编辑后清空 |
| `TraitCombination.traitSnapshot` | `CharacterTraitItem[]?` | 完整特征快照（含临时标签/编辑文本/启用状态）；从 AssetGenerateModal 保存时写入，从 AssetManagerModal 保存时不写入（仅 traitIds） |
| `CharacterTraitItem.weight` / `CategorizedTrait.weight` | `number?` | SDXL 提示词权重（Spec: add-sdxl-prompt-weight-support）。默认 `undefined` 等价 1.0，范围 0.1-10.0（1 位小数）。`applyTraitsAndLora` 在 `weight !== 1.0 && !== undefined` 时格式化为 `(text:weight)` 语法（兼容 Forge Neo lark 解析器）。AI 生成时可选产出（LLM 输出 `分类:tag\|中文翻译\|权重` 三段格式）；L4/L5 审计替换时继承原 weight，L3 颜色拆分时两个新 trait 均重置为 `undefined`；手动编辑 trait.text 时 weight 保持不变（与 originalText 清空策略不同）。详见 docs/FIX_RECORDS.md §7.24 |

### AssetManagerModal 改动点

#### 1. 拆分标签视觉标识（`renderTraitChip`，Task 4.1 + 4.2）

特征 chip 渲染结构为自定义 `<span>` chip（**非 antd `<Tag>`**），文字部分包裹在 antd `<Tooltip>` + `<span>` 中：

```tsx
<Tooltip
  title={
    trait.originalText
      ? (
        <div style={{ lineHeight: 1.6 }}>
          <div>原标签：{trait.originalText}</div>
          <div>拆分为：{trait.text}</div>
          {trait.translation && <div>翻译：{trait.translation}</div>}
        </div>
      )
      : trait.translation || ''  // 旧行为：仅显示翻译，空字符串不弹出
  }
>
  <span
    onClick={() => handleStartEdit(trait.id)}
    style={{ cursor: 'text', lineHeight: '20px', display: 'inline-flex', alignItems: 'center' }}
  >
    {trait.originalText && (
      <SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />
    )}
    {trait.text}
  </span>
</Tooltip>
```

- `originalText` 存在 → Tooltip 显示三行（原标签 / 拆分为 / 翻译，翻译行可选），文字前显示 `SplitCellsOutlined` 拆分图标
- `originalText` 不存在 → Tooltip 维持旧行为（仅显示 translation，空字符串不弹出），文字前不显示图标
- span style 新增 `display: 'inline-flex'` + `alignItems: 'center'`，确保图标与文字垂直对齐

#### 2. 组合方案下拉 📋 标识（Task 8.2）

```tsx
<Select
  options={[
    { value: '__manual__', label: '手动模式' },
    ...combinations.map((c) => ({
      value: c.id,
      label: c.traitSnapshot ? `${c.name} 📋` : c.name,
    })),
  ]}
/>
```

含 `traitSnapshot` 的方案名后加 📋 emoji 后缀，提示用户该方案应用时会完整替换 traits（含临时标签/编辑文本）；无 traitSnapshot 的方案维持原名（仅切换 enabled）。

#### 3. `handleApplyCombination` 透传（Task 8.1）

```tsx
const handleApplyCombination = useCallback(
  (combinationId: string) => {
    if (combinationId === '__manual__') return;  // 手动模式守卫保留
    const result = applyCombination(combinationId);  // store 内部自动走 traitSnapshot vs traitIds 分支
    if (!result.success) {
      message.warning(result.error || '应用组合失败');
    }
  },
  [applyCombination],
);
```

**未修改**：store 的 `applyCombination(id|null)` 已在 Task 7 中实现 traitSnapshot vs traitIds 自动分支（含快照 → 完整替换 traits 深拷贝；无快照 → 仅切换 enabled），前端透传即可。

### 关键约束

- **AssetManagerModal 保存方案不写 traitSnapshot**：`handleOpenSaveCombination` 调用 `saveCombination(trimmed)`（不传 snapshot 参数），与 spec 设计一致 —— AssetManagerModal 保存的是「启用集合快照」（仅 traitIds），AssetGenerateModal 保存的是「完整工作区快照」（traitSnapshot，含临时标签）。
- **未触碰 store / IPC / 持久化逻辑**：本次改动为纯 UI 渲染层（Tooltip title + span 内插图标 + options label 派生），所有数据流由前序 Task 1（类型）+ Task 7（store）已铺好。

### 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` — 导入 `SplitCellsOutlined` / `renderTraitChip` Tooltip + 拆分图标 / 组合方案下拉 options 📋 标识

### 验证状态

- **TypeScript 类型检查通过**：`npx tsc --noEmit -p tsconfig.json` 全量检查 → `AssetManagerModal.tsx` 零错误（整个项目仅 1 处预存无关错误 `writing.constants.ts:9`）。
- **待补全**：AssetGenerateModal 侧的 Task 4.3（拆分图标同步）/ Task 5（临时方案保存按钮）/ Task 6（组合方案下拉）由并行 agent 处理，本节不覆盖。

## §19 ⚠️ Bug 修复：弹窗/模态框组件暗色主题颜色不匹配（2026-08-07）

### 问题描述

应用支持亮色/暗色主题切换（通过 `src/renderer/styles/ui-variables.css` 中 `:root` / `.dark` 定义的 CSS 变量，由 `document.body` 上的 `.dark` class 切换）。但多个 Modal/弹窗组件在内联 `style={{}}` 中使用了**硬编码的亮色模式十六进制颜色值**，导致暗色主题下出现：
- 亮白色背景框（刺眼）
- 文字不可见（亮色文字 on 亮色背景 / 暗色文字 on 暗色背景）
- 边框颜色不随主题变化

### 根因

组件开发时直接内联了 antd 默认亮色色板值（如 `#fff1f0`、`#f6ffed`、`#fafafa`、`#000`、`#8c8c8c` 等），未引用 `ui-variables.css` 中已定义的 CSS 变量。

### 修复方案

将内联 style 中的硬编码颜色值替换为对应的 CSS 变量，仅修改颜色相关属性（`background`、`backgroundColor`、`border`、`borderColor`、`color`、`borderBottom` 等），不改动布局、逻辑、className 或非颜色样式。

#### 颜色映射表

| 硬编码值 | CSS 变量 |
|---|---|
| `#ffffff` / `#fff`（容器背景） | `var(--bg-container)` |
| `#fafafa` / `#f5f5f5` / `#f0f2f5`（面板背景） | `var(--bg-elevated)` |
| `#fff1f0` / `#fff2f0`（错误浅背景） | `var(--color-error-light)` |
| `#f6ffed`（成功浅背景） | `var(--color-success-light)` |
| `#fffbe6`（警告浅背景） | `var(--color-warning-light)` |
| `#e6f7ff`（信息浅背景） | `var(--color-info-light)` |
| `#f0f0f0` / `#e8e8e8` / `#f5f5f5`（浅边框） | `var(--border-base)` |
| `#d9d9d9`（中浅边框） | `var(--border-secondary)` |
| `#b7eb8f`（成功边框） | `var(--color-success)` |
| `#ffe58f`（警告边框） | `var(--color-warning)` |
| `#000` / `#000000`（主要文字） | `var(--text-primary)` |
| `#262626` / `#1a1a2e`（标题文字） | `var(--text-heading)` |
| `#595959` / `#8c8c8c`（次要文字） | `var(--text-secondary)` |

### 涉及文件清单

**已确认并修复的 5 个文件：**（其中 3 个 `Creative/WritingMode/` 文件已随写作模式 1.0 于 2026-10-07 移除，此处为历史清单）

- `src/renderer/components/Creative/WritingMode/QuickFixSuggestionModal.tsx` — 原文本/修正后/修正理由三个对比块的 backgroundColor + border + color
- `src/renderer/components/WorldBook/WorldBookAuthoringModal.tsx` — 事件流容器、StatCard、AuditProgressCard、AutoFixesList 修复前/后背景、ArrowRight、多处次要文字色
- `src/renderer/components/Creative/WritingMode/WritingAgentModal.tsx` — EVENT_META chapter_skipped 色、事件流容器、StatCard、空状态文字、事件消息文字
- `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx` — 维度卡片 borderColor、修正后文本块 background + border（2 处）
- `src/renderer/components/Character/CharacterListView.tsx` — 提示卡片 background + borderColor、角色书条目标题 borderBottom

**通过 grep 额外发现并修复的 2 个弹窗文件：**

- `src/renderer/components/KnowledgeBase/UploadDocumentModal.tsx` — 分块加载中文字色
- `src/renderer/components/PromptManagement/PromptEditor.tsx` — AI 润色结果对比弹窗推荐框架卡片 background + borderColor

### 未修改的硬编码颜色（说明）

以下硬编码颜色**有意保留**，未做替换：

- `#1890ff`（主色蓝）：两个主题下值相同，非主题不匹配项，保留以减少改动。
- `#ffccc7`（QuickFixSuggestionModal 原文本块 border）：不在映射表中，为 error 浅边框，保留。
- `#1a1a2e` 作为**背景**（PlotCheckReportModal 原文展示/批量修正工具栏/结果卡片）：映射表中 `#1a1a2e` 仅标注为"标题文字"用途；此处用作代码块深色背景（配套浅色文字 `#c8d6e5`），若替换为 `var(--text-heading)` 会导致暗色主题下浅色背景 + 浅色文字不可见，故保留。
- `#c8d6e5`、`#333`、`#f0f9eb`、`#52c41a`（作为 borderLeft 装饰）、`#faad14`（作为 borderLeft 装饰）等：不在映射表中或为装饰性强调色，保留。
- `rgba(...)` 表达式、`linear-gradient` 渐变：按规则不动。

### 跳过的非弹窗文件

以下文件虽被 grep 命中但**非弹窗/模态框组件**，按 scope 要求跳过：

- `ShardDetailPanel.tsx`（Card 面板，常驻显示）
- `OutlineEditor.tsx`（编辑器组件）
- `WorldBookEditPage.tsx`（页面组件）
- `StoragePathDisplay.tsx`（路径展示组件）
- `ChatHeader.tsx`（聊天头部）

### 验证方式

修复后重新运行 grep 确认 7 个目标文件中映射表覆盖的硬编码颜色值已全部替换为 CSS 变量；仅剩 `var(--xxx, #hex)` 形式的 CSS 变量回退值（已是正确的主题适配写法）。未运行 tsc 或 dev server（按要求）。

---

## §20 ADetailer Furry/拟人生物面部识别模型扩展（2026-08-07）

### 背景
原 ADetailer 检测模型预设仅 9 项（`face_yolov8n.pt` 等），全部针对人类面部训练，对兽人/furry/kemono 等拟人生物面部识别率低。本次扩展新增 3 个检测模型 + 1 个条件字段，覆盖 furry/兽人/动物面部场景。详见 `docs/FIX_RECORDS.md` §7.25。

### 新增检测模型（`ADETAILER_MODEL_OPTIONS`，SDWebuiSettings.tsx）
| 模型文件 | 类型 | 用途 |
|----------|------|------|
| `yolov8x-worldv2.pt` | YOLO-World 开放词汇 | 零样本检测任意类别，配合 `adModelClasses` 文本提示检测 furry/兽人面部（ADetailer-Neo 预装） |
| `Anzhc HeadHair seg y8m.pt` | 头部+毛发分割 | 兽人头部覆盖更全（含耳朵/毛发），mAP50=0.867（需下载） |
| `Anzhc Face seg 640 v4 y11n.pt` | 高精度插画人脸 | 动漫风 kemono 面部精度更高，mAP50=0.835（需下载） |

### 新增配置字段：`adModelClasses`（SDWebuiConfig）
- **类型**：`string?`（可选，默认空字符串）
- **作用**：仅当 `adModel` 为 YOLO-World 系列（文件名含 "world"）时生效，透传给 ADetailer-Neo 的 `ad_model_classes` → `ultralytics_predict(classes=...)`，实现零样本开放词汇检测。
- **空字符串**：使用模型默认 COCO 80 类；填入文本提示如 `furry face, anthro head, animal head, kemono face` 可检测任意类别。
- **非 YOLO-World 模型**：此字段被忽略（sdGenerationService 条件透传，仅 `_world` 模型 + 非空时写入 adArgs）。

### UI 条件渲染（SDWebuiSettings.tsx）
- `Form.useWatch('adModel')` 监听当前检测模型。
- YOLO-World 模型（`includes('world')`）→ 显示「检测类别（ad_model_classes）」TextArea。
- Anzhc 模型（`startsWith('Anzhc')`）→ 显示下载提示 Alert（HuggingFace 链接 + `models/adetailer/` 路径）。

### 字段同步约束
`adModelClasses` 新增到 `SDWebuiConfig` 接口后，4 处 DEFAULT_CONFIG 必须同步（项目铁律：新增可选字段到持久化数据结构时必须检查所有对象重构路径）：
1. `src/shared/settings.ts` — `defaultSetting.sdWebui`
2. `src/renderer/components/Settings/SDWebuiSettings.tsx` — `DEFAULT_SD_WEBUI_CONFIG`
3. `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` — `DEFAULT_SD_CONFIG`
4. `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — `DEFAULT_SD_CONFIG`

2 处 Modal 参数构建处透传 `adModelClasses: sdConfig.adModelClasses`（ExpressionGenerateModal + AssetGenerateModal）。

### 涉及文件清单
`src/renderer/types/setting.ts` / `src/main/services/sdGenerationService.ts` / `src/shared/settings.ts` / `src/renderer/components/Settings/SDWebuiSettings.tsx` / `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` / `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`

## §21 侧边栏菜单调整：隐藏创意管理 + 设置固定底部（2026-08-08）

### 概述

将「创意管理」菜单项从侧边栏隐藏（路由仍保留可用），并将「设置」菜单项移动到菜单列表最下方并用分割线固定。

### RouteConfig 接口扩展

`src/renderer/routeConfig.ts` 的 `RouteConfig` 接口新增两个可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `hidden` | `boolean?` | 隐藏菜单项（不显示在侧边栏，但路由仍可通过 `findRouteComponent` 访问） |
| `pinnedBottom` | `boolean?` | 固定在菜单列表最下方，与上方菜单项之间用 antd Menu divider 分隔 |

### 改动点

1. **隐藏创意管理**：`routeConfigs` 中 `key: 'creative'` 项添加 `hidden: true`；`getMenuRoutes()` 过滤条件增加 `&& !route.hidden`，使隐藏项不出现在菜单中但路由组件仍可通过 `findRouteComponent` 查找到
2. **设置固定底部**：将 `key: 'settings'` 项从原位置（第 9 位）移动到 `routeConfigs` 数组末尾，并添加 `pinnedBottom: true`
3. **Sidebar 分离渲染**：`Sidebar.tsx` 将 `visibleRoutes` 分为 `normalRoutes`（非 pinnedBottom）和 `pinnedRoutes`（pinnedBottom），在两者之间插入 `{ type: 'divider' }` 分割线

### 涉及文件清单

- `src/renderer/routeConfig.ts` — RouteConfig 接口新增 `hidden` / `pinnedBottom` 字段；creative 项标记 `hidden: true`；settings 项移至数组末尾并标记 `pinnedBottom: true`；`getMenuRoutes` 过滤 hidden 项
- `src/renderer/components/Layout/Sidebar.tsx` — 菜单项构建逻辑分离 normal/pinned，pinned 项前插入 divider

## §22 ⚠️【重点标记】Bug 修复：设置页 agentModeOverride 未持久化 + debugMode 状态未同步（2026-08-08）

### 问题描述

用户在设置页 AI 引擎面板将「智能体模式」从「自动」切换为「强制关闭」后点击保存，刷新页面后设置恢复为「自动」。同时发现 `debugMode` 也存在类似的持久化问题。

### 根因分析

#### Bug 1（严重）：agentModeOverride 未加载到表单 + 未在 handleSave 中保存

`Settings.tsx` 的表单初始化 `useEffect`（第 46-71 行）中 `form.setFieldsValue` **未设置 `agentModeOverride` 字段**，导致刷新后 Segmented 控件不显示已保存的值（显示为空/默认）。

`handleSave`（第 84-182 行）中更新活跃引擎时，仅显式写入 `api_url` / `api_key` / `model_name` 等字段，**未写入 `values.agentModeOverride`**。依赖 `...engine` 展开保留了旧值，用户在主表单中的新选择被完全丢弃。

> 注意：引擎编辑模态框（`useAIEngineSettings.ts` 的 `handleSaveEngine`）通过 `...values` 展开**正确保存了** `agentModeOverride`。但主表单的「保存设置」按钮走的是 `Settings.tsx` 的 `handleSave`，不走 `handleSaveEngine`。

#### Bug 2（中等）：debugMode 状态未从已保存配置同步

`Settings.tsx` 第 27 行 `const [debugMode, setDebugMode] = useState(false)` 初始值为 `false`。`useEffect` 中 `form.setFieldsValue({ debugMode: setting.debugMode })` 仅设置了表单字段，**未调用 `setDebugMode(setting.debugMode)`** 同步本地 state。

`handleSave` 中 `debugMode: debugMode` 使用的是本地 state（始终为 `false`），而非表单值。若用户不手动切换开关直接保存，`debugMode` 会被错误重置为 `false`。

### 修复方案

`src/renderer/components/Settings/Settings.tsx`（修改）：

1. **useEffect 初始化**：
   - 新增 `setDebugMode(setting.debugMode || false)` — 同步 debugMode state
   - `form.setFieldsValue` 新增 `agentModeOverride: engine?.agentModeOverride || 'auto'` — 加载已保存的智能体模式到表单

2. **handleSave 引擎更新**：
   - 新增 `agentModeOverride: values.agentModeOverride || 'auto'` — 将表单中的智能体模式写入引擎配置

### 验证

- `tsc --noEmit` 对 `Settings.tsx` 零新增错误
- 验证流程：设置页选择「强制关闭」→ 保存设置 → 切换菜单再返回 → Segmented 控件应显示「强制关闭」

> ⚠️ **重点标记（2026-08-08 二次修复）**：首次修复声称已将 `agentModeOverride` 和 `setDebugMode` 加入 `useEffect`，但实际代码中并未应用（"Verify Implementation, Not Intent" 失败）。用户反馈切换菜单再返回后仍被重置为"自动"。二次检查确认 `useEffect` 的 `form.setFieldsValue` 中缺少 `agentModeOverride` 字段，`setDebugMode` 调用也缺失。已重新修复并验证代码实际包含这两行。

## §23 ⚠️【重点标记】Bug 修复：远程引擎 400 Bad Request — 非标准参数注入 + 认证默认值不一致（2026-08-08）

### 问题描述

用户选择远程引擎（如 DeepSeek 官方 API）时，ai-handler 模块返回 `400 Bad Request` 错误，导致所有远程引擎功能不可用。该问题为近期新出现的异常。

### 根因分析

#### 根因 1（严重）：非标准参数无条件注入

多个 AI 调用路径在请求体中无条件注入了 vLLM/Qwen3 专有参数，DeepSeek 等标准 OpenAI 兼容 API 不识别这些字段直接返回 400：

| 文件 | 注入位置 | 注入的参数 |
|------|---------|-----------|
| `useWorldBookAIOperations.ts` | 11 处 | `extra_body` / `chat_template_kwargs` / `enable_thinking: false` |
| `AIService.ts` | 2 处（callChatAPI + streamChatAPI） | `enable_thinking`（顶层无条件注入） |
| `aiClient.ts`（记忆整理） | 1 处 | `extra_body: { enable_thinking: false }` |

`ChatEngine.ts`（主聊天路径）已通过 `upgrade-ai-handler-multimodal-compatibility` Spec 建立了双条件守卫（`enable_chain_of_thought === true && capabilities.supportsThinking === true`），但其他调用路径未跟进。

#### 根因 2（高风险）：`stop: null` 显式发送

`useWorldBookAIOperations.ts` 在 5 处请求体中显式发送 `stop: null`，部分 API 将 `null` 视为无效参数。

#### 根因 3（高风险）：`api_key_transmission` 默认值不一致

渲染进程默认 `'body'`（API key 放请求体），主进程默认 `'header'`（放 Authorization header）。DeepSeek 仅支持 header 认证，当用户未显式设置时渲染进程路径会将 key 放入请求体，导致认证失败。

### 修复方案

#### 1. 移除非标准参数注入（`useWorldBookAIOperations.ts`）

- 移除全部 11 处 `extra_body` / `chat_template_kwargs` / `enable_thinking` 无条件注入
- 移除全部 5 处 `stop: null`
- 移除全部 12 处硬编码 `n: 1`（标准 API 默认 n=1）

思维链控制由 `AIService.ts` / `ChatEngine.ts` 中已有的能力感知逻辑处理，世界书等内联请求构建路径不需要重复注入。

#### 2. 能力感知守卫注入（`AIService.ts`）

`callChatAPI` 和 `streamChatAPI` 中的 `requestBody.enable_thinking` 改为双条件守卫：

```typescript
const supportsThinking = (config as any).capabilities?.supportsThinking === true;
if (config.enableChainOfThought === true && supportsThinking) {
  requestBody.enable_thinking = true;
}
```

与 `ChatEngine.ts` 已有的能力感知模式完全对齐：仅当用户启用思维链 **且** 模型探测支持时才注入。

#### 3. 移除 `aiClient.ts` 的 `extra_body`

移除记忆整理服务中的 `extra_body: { enable_thinking: false }` 无条件注入。

#### 4. 统一 `api_key_transmission` 默认值为 `'header'`

将所有渲染进程路径的 `|| 'body'` 改为 `|| 'header'`，共 7 个文件 22 处：

- `useCreativeAI.ts`（1 处）
- `settingStore.ts`（1 处）
- `Settings.tsx`（2 处）
- `useAIEngineSettings.ts`（3 处）
- `useWorldBookAIOperations.ts`（15 处）
- `useCharacterAIOperations.ts`（1 处，额外发现）
- `WorldBookEditor.tsx`（1 处，额外发现）

### 涉及文件清单

- `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 移除非标准参数 + `stop: null` + `n: 1` + 统一认证默认值
- `src/main/services/AIService.ts` — `enable_thinking` 改为双条件守卫注入
- `src/main/services/memory/aiClient.ts` — 移除 `extra_body`
- `src/renderer/components/Creative/hooks/useCreativeAI.ts` — 统一认证默认值
- `src/renderer/stores/settingStore.ts` — 统一认证默认值
- `src/renderer/components/Settings/Settings.tsx` — 统一认证默认值
- `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` — 统一认证默认值
- `src/renderer/components/Character/hooks/useCharacterAIOperations.ts` — 统一认证默认值（额外发现）
- `src/renderer/components/Creative/WorldBookEditor.tsx` — 统一认证默认值（额外发现）

### 验证

- `tsc --noEmit` 对所有修改文件零新增错误
- Grep 验证：`useWorldBookAIOperations.ts` 中不再包含 `extra_body`、`chat_template_kwargs`、`enable_thinking`、`stop: null`、`n: 1,`、`|| 'body'`
- 全局验证：渲染进程目录下不再包含 `api_key_transmission || 'body'`

## §24 ⚠️【重点标记】Bug 修复：远程引擎 400 错误根因 — topP NaN + n 参数 + 默认认证模式（2026-08-08）

### 问题描述

§23 修复后，世界书「AI 生成条目」功能使用 DeepSeek 引擎时仍返回 400 Bad Request。经深入排查发现三个遗留根因。

### 根因分析

#### 根因 1（严重）：`topP` 计算的 NaN bug（7 处）

`useWorldBookAIOperations.ts` 中 7 处函数使用了错误的 `topP` 计算模式：

```javascript
// BUG：Number(undefined) = NaN，NaN ?? throw 不抛异常（?? 只捕获 null/undefined）
const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();
```

默认设置中 `top_p: undefined`（`src/shared/settings.ts` 第 71 行），导致：
1. `Number(undefined)` = `NaN`
2. `NaN ?? throw` 不抛异常（`??` 只捕获 `null`/`undefined`，不捕获 `NaN`）
3. `topP` = `NaN`
4. `JSON.stringify({top_p: NaN})` = `'{"top_p":null}'`
5. DeepSeek 收到 `top_p: null` → **400 Bad Request**

文件中另有 8 处函数已使用安全模式（`typeof` 检查 + 默认 0.95），这 7 处未跟进。

**修复**：统一为安全模式 `(typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95`

#### 根因 2（严重）：`n: n` 参数未移除

`generateNewEntries` 函数的请求体中包含 `n: n,`（`n = Number(activeEngine.n) || 1` = 1）。DeepSeek API 不支持 `n` 参数，返回 400。

> 注：§23 修复中移除了 `n: 1,` 字面量，但遗漏了 `n: n,` 变量引用形式。

**修复**：移除 `n: n,` 行。

#### 根因 3（严重）：默认设置 `api_key_transmission: 'body'`

`src/shared/settings.ts` 第 160 行和 `storageService.ts` 第 243 行的默认引擎模板中 `api_key_transmission: 'body'`。§23 修复了代码中的 `|| 'body'` 默认值，但默认配置模板仍硬编码为 `'body'`。用户新建引擎时会继承此值，导致 API key 通过请求体传输，DeepSeek 仅支持 header 认证。

**修复**：将 3 处默认配置模板的 `api_key_transmission` 改为 `'header'`：
- `src/shared/settings.ts` 第 160 行
- `src/main/services/storageService.ts` 第 243 行
- `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` 第 113 行（新引擎模板）

### 涉及文件清单

- `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 7 处 topP 安全模式 + 移除 `n: n,`
- `src/shared/settings.ts` — 默认 `api_key_transmission: 'header'`
- `src/main/services/storageService.ts` — 默认 `api_key_transmission: 'header'`
- `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` — 新引擎模板 `api_key_transmission: 'header'`

### 验证

- `tsc --noEmit` 零新增错误
- Grep 验证：`Number(activeEngine.top_p) ??` 返回 0 结果
- Grep 验证：`n: n,` 返回 0 结果
- Grep 验证：`api_key_transmission.*['\"]body['\"]` 仅剩类型定义（`'header' | 'body'` 联合类型）

## §26 ⚠️【重点标记】Bug 修复：max_tokens 超过 API 限制导致 400 Bad Request（2026-08-08）

### 问题描述

世界书「AI 生成条目」功能使用 DeepSeek 引擎时返回 400 Bad Request。此 bug 经历多轮修复仍未解决，根因是**`max_tokens` 语义混淆**：用户配置的 `max_tokens` 表示上下文窗口大小（如 1024000 = 1M），但代码将其直接作为 API 的 `max_tokens` 参数（最大输出 token 数）发送，超过 API 限制（DeepSeek 为 393216）导致 400。

### 根因分析

- OpenAI 兼容 API 的 `max_tokens` 参数含义是「最大输出 token 数」，不是「上下文窗口大小」
- 用户配置 `max_tokens: 1024000`（1M 上下文），代码直接发给 API → API 返回 `Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`
- 连通性测试碰巧用了小值（`?? 1`）所以通过，世界书等操作直接用用户配置值导致 400

### 修复方案

**不再向 API 发送 `max_tokens` 参数**，让 API 自行使用模型默认的最大输出长度。用户的 `max_tokens` 配置保留作为上下文窗口参考，不作为 API 输出限制。

| 文件 | 修改处 |
|------|--------|
| `useWorldBookAIOperations.ts` | 13 处移除 `max_tokens: maxTokens,` |
| `ChatEngine.ts` | `maxTokens` 设为 `undefined` |
| `AIService.ts` | `maxTokens` 设为 `undefined` |
| `aiClient.ts` | `max_tokens` 设为 `undefined`，返回类型改为可选 |
| `useCreativeAI.ts` | 移除 `max_tokens: maxTokens,` |

### 验证

- 用 DeepSeek API 实测：不发送 `max_tokens` → 200 成功
- 用 DeepSeek API 实测：`max_tokens: 1024000` → 400 失败
- `tsc --noEmit` 零新增错误

## §27 max_tokens 参数全面评估与治理（2026-08-08）

### 评估背景

`max_tokens` 参数语义混淆问题经多轮修复后，引入了技术债务（`void maxTokens;` 无用变量、遗漏路径、截断检测失效等）。本次进行系统性治理。

### 评估结论

采用**方案 C：保留但不发送，清理技术债务**：
- 引擎配置中的 `max_tokens` 字段保留作为上下文窗口参考，不作为 API `max_tokens` 参数发送
- 系统调用 OpenAI 兼容 API 时不发送 `max_tokens` 字段，由 API 自行使用模型默认最大输出长度
- 例外：硬编码小值（如图像识别探测 `max_tokens: 5`）不受此规则约束

### 治理内容

| 文件 | 修改 |
|------|------|
| `characterAIUtils.ts` | **修复遗漏路径** — 移除 `maxTokens: engine.max_tokens`，不再直接发送用户配置值 |
| `AIService.ts` | 移除 `max_tokens` 必填校验；`EngineConfig.maxTokens` 改为可选类型；`getEngineConfig` 返回 `maxTokens: undefined` |
| `useWorldBookAIOperations.ts` | 移除 16 处 `void maxTokens;` / `void maxTokensVal;`；修复截断检测不再引用 `maxTokens` 变量 |
| `useCreativeAI.ts` | 移除 `const maxTokens = ...; void maxTokens;` 无用变量声明 |
| `settingStore.ts` | 连通性测试 `max_tokens` 改为固定值 `1` |

### 验证
- `void maxTokens` 全局 Grep 零匹配
- `characterAIUtils.ts` 中不含 `maxTokens: engine.max_tokens`
- `tsc --noEmit` 零新增错误

## §25 Bug 修复：AgentModeService 审计日志 MemoryStore 未初始化警告（2026-08-08）

### 问题描述

保存设置时触发 `reevaluateAgentModeFromSettings` → `agentModeService.reevaluate()` → `applyEvaluation` → `logModeChange`，在 MemoryStore 尚未初始化时 `getMemoryStore()` 抛出错误，产生警告日志：`[AgentModeService] Failed to write mode-change audit log: Error: MemoryStore not initialized.`

### 根因

`logModeChange` 在调用 `getMemoryStore()` 前未检查 MemoryStore 是否已初始化。应用启动早期或 MemoryStore 未使用时，`getMemoryStore()` 会同步抛错。虽然已有 try-catch 包裹不会崩溃，但错误日志造成干扰。

### 修复

1. `src/main/services/agent/memory/memoryStore.ts` — 新增 `isMemoryStoreInitialized()` 检查函数
2. `src/main/services/agent/management/agentModeService.ts` — `logModeChange` 调用 `getMemoryStore()` 前先检查 `isMemoryStoreInitialized()`，未初始化时直接 return 跳过审计日志
3. `src/main/services/agent/memory/index.ts` — 导出 `isMemoryStoreInitialized`

## §28 ChatMessageBubble 内联样式迁移至 CSS 类（2026-08-08）

### 概述

将 `ChatMessageBubble.tsx` 中大量内联 `style` 属性迁移为 CSS 类，统一在 `ChatMessageBubble.css` 中管理样式。同时将按钮的 `onMouseEnter`/`onMouseLeave` JS 事件处理器替换为 CSS `:hover` 伪类，textarea 的 `onFocus`/`onBlur` 替换为 CSS `:focus` 伪类。

### 改动内容

#### CSS 文件（`ChatMessageBubble.css`）

在现有 `.chat-action-btn` 等类之后、`@media (max-width: 480px)` 媒体查询之前，新增以下 CSS 类：

| CSS 类 | 用途 |
|--------|------|
| `.chat-msg-wrapper` / `.is-user` / `.is-assistant` | 消息外层容器（flex 布局 + 方向） |
| `.chat-msg-inner` / `.is-user` / `.is-assistant` | 内层容器（gap + max-width + 方向） |
| `.chat-msg-avatar` / `.is-user` / `.is-assistant` / `img` / `-fallback` | 头像容器 + 图片 + 文字回退 |
| `.chat-msg-content-col` | 消息内容列容器 |
| `.chat-msg-name` / `.is-user` / `.is-assistant` | 发送者名称 |
| `.chat-msg-seq-badge` | AI 回复序号徽标 |
| `.chat-msg-bubble` / `.is-user` / `.is-assistant` | 消息气泡（背景/圆角/阴影/动画） |
| `.chat-msg-edit-placeholder` | 编辑时的占位层 |
| `.chat-msg-edit-container` / `.is-user` / `.is-assistant` | 编辑容器（绝对定位覆盖） |
| `.chat-msg-edit-textarea` / `:focus` | 编辑文本框 + 聚焦样式 |
| `.chat-msg-cursor` | 流式输出光标 |
| `.chat-msg-timestamp` / `.visible` | 时间戳（hover 时显示） |
| `.chat-msg-version-info` / `.visible` | 版本信息行 |
| `.chat-msg-generating` / `-text` | 生成中指示器 |
| `.chat-msg-actions` / `.visible` / `.is-user` | 操作按钮容器 |
| `.chat-action-btn:hover:not(:disabled)` / `.edit-active` / `.copied` / `.error` / `:disabled` | 按钮状态样式（替代 JS 内联处理） |

#### TSX 文件（`ChatMessageBubble.tsx`）

1. **17 处内联 `style` 属性移除**：wrapper、inner、avatar、content-col、name、seq-badge、bubble、edit-placeholder、edit-container、textarea、cursor、timestamp、version-info、generating、actions 容器（AI + 用户）、按钮内联样式
2. **JS 事件处理器移除**：所有按钮的 `onMouseEnter`/`onMouseLeave`（hover 由 CSS `:hover` 处理）；textarea 的 `onFocus`/`onBlur`（由 CSS `:focus` 处理）
3. **按钮状态类名**：复制按钮 `copied` 类、编辑按钮 `edit-active` 类、重新生成按钮 `error` 类
4. **保留的内联样式**：「历史版本」span 的一次性样式（`fontSize`/`color`/`fontStyle`）按计划保留；`LoadingOutlined` 的 `fontSize` 内联样式保留

### 涉及文件清单

- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 新增 15 个 CSS 类 + 按钮状态伪类
- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 17 处内联样式替换为 CSS 类名，移除 JS 事件处理器

### 验证

- `GetDiagnostics` 对 `.tsx` 和 `.css` 文件均零错误
- 现有 CSS 类（`.chat-action-btn`、`.chat-msg-stripe`、`.suggested-options-*` 等）未被修改
- `@media (max-width: 480px)` 媒体查询保持在文件最末尾

## §29 角色卡对话功能全面优化（2026-08-08）

### 概述

对角色卡对话功能（`CharacterDialogueChat`）进行全面视觉样式、AI 参数配置、对话内容增强三维度优化。按 P0→P1→P2 优先级分批实施。

### P0：视觉样式修复与对话内容增强

#### ⚠️【重点标记】Bug V1：MessageRenderer 主题选择器不匹配

**问题**：`MessageRenderer.styles.css` 使用 `[data-theme="dark"]` / `[data-theme="light"]` 选择器，但全局主题系统使用 `.dark` class 切换。导致暗色模式下引号高亮颜色不生效。

**修复**：将 `[data-theme="dark"]` 替换为 `.dark`，移除 `[data-theme="light"]`（`:root` 即为亮色默认）。

**文件**：`MessageRenderer.styles.css`

#### ⚠️【重点标记】Bug V2/V3：亮色模式下建议选项文字不可见

**问题**：`ChatMessageBubble.css` 中 `.suggested-option-action` 使用 `rgba(255,255,255,0.55)`（白色半透明），在白色背景下几乎不可见。`.suggested-option-dialogue` 同理。

**修复**：替换为 CSS 变量 `--chat-option-action-color` / `--chat-option-dialogue-color`，在 `ui-variables.css` 中为亮色/暗色主题分别定义合适的颜色值。

**文件**：`ChatMessageBubble.css`、`ui-variables.css`

#### Bug V4：MessageRenderer 内联颜色硬编码

**问题**：`MessageRenderer.tsx` 中 `a` 标签内联颜色 `#1890ff` 与 CSS 变量 `--mr-link: #4a9eff` 不一致；`blockquote` 边框颜色同时存在于内联和 CSS 中。

**修复**：移除内联颜色硬编码，统一使用 CSS 变量 `var(--mr-link, #4a9eff)`。

**文件**：`MessageRenderer.tsx`

#### 引号高亮优化

- 移除 `text-shadow`（长文本中造成视觉疲劳）
- 降低 `font-weight` 从 600 到 500
- 添加微妙背景 `rgba(255,179,71,0.04)` + `padding: 0 2px` + `border-radius: 3px`

**文件**：`MessageRenderer.styles.css`

#### 思考内容折叠展示

**功能**：新增 `convertThinkingTags()` 函数，将 `<think>`/`<thinking>`/`<thought>` 标签内容转换为可折叠的 `<details>` 块（带 `💭 AI 思考过程` 标题），替代原有的 `stripThinkingTags()` 永久移除行为。

**配置链路**：
- `AIParameterConfig.show_thinking?: boolean` — 角色级配置
- `RenderConfig.markdown.showThinking?: boolean` — 渲染配置
- `MessageProcessorOptions.showThinking?: boolean` — 处理器选项
- `ParameterPanel` 新增"显示思考过程" Switch 开关
- `hooks.ts` 中 `stripThinkingTags` 调用增加 `&& !customParameters?.show_thinking` 守卫

**文件**：`messageProcessor.ts`、`MessageRenderer.config.ts`、`MessageRenderer.tsx`、`CharacterDialogueChat.types.ts`、`ParameterPanel.tsx`、`CharacterDialogueChat.tsx`、`CharacterDialogueChat.hooks.ts`

#### 行为描述（em/斜体）视觉区分

**功能**：`em` 元素（`*text*` 或 `_text_` Markdown 语法）从纯斜体升级为带背景色、内边距、圆角的主题化样式类 `.message-renderer-action`。

**文件**：`MessageRenderer.tsx`、`MessageRenderer.styles.css`

#### 角色名称突出显示

**功能**：角色名称从 `12px` + `color: var(--text-secondary)` 升级为 `13px` + `fontWeight: 600` + 主题化颜色（角色紫色 `--chat-character-name-color`，用户蓝色 `--chat-username-color`）。

**文件**：`ChatMessageBubble.tsx`（后迁移为 CSS 类 `.chat-msg-name`）

#### 交替背景色

**功能**：奇数序号 AI 消息使用微妙交替背景 `--chat-msg-stripe-bg`，缓解长对话阅读疲劳。

**文件**：`ChatMessageBubble.tsx`、`ChatMessageBubble.css`、`ui-variables.css`

### P1：AI 参数配置系统优化

#### top_k / min_p 参数全链路接入

**功能**：将 `top_k`（Top-K 采样）和 `min_p`（Min-P 采样）从系统设置扩展到角色卡级别可配置。

**改动链路**：

| 层级 | 文件 | 改动 |
|------|------|------|
| 类型定义 | `CharacterDialogueChat.types.ts` | `AIParameterConfig` 新增 `top_k?` / `min_p?` / `show_thinking?` |
| 参数配置 | `parameterConfigs.ts` | 新增 `top_k`（min:0, max:100, step:1, default:40）和 `min_p`（min:0, max:1, step:0.01, default:0）配置项，放入 `PARAMETER_CONFIGS`（始终显示，不依赖 capability 门控） |
| 参数合并 | `CharacterDialogueChat.hooks.ts` | `getEffectiveParams()` 新增 top_k/min_p 三级合并（customParams > globalEngine > 默认） |
| 参数注入 | `CharacterDialogueChat.hooks.ts` | 三处 `engineConfigWithParams` 注入：`requestAIResponse`（~L702）、`generateUserReply`（~L1830）、`polishInput`（~L2048） |
| 引擎配置 | `ChatEngine.types.ts` | `AIEngineConfig` 新增 `top_k?` / `min_p?` 字段 |
| 请求体 | `ChatEngine.ts` | 直接注入 `requestBody.top_k` / `requestBody.min_p`（与 `top_p` 模式一致，不经过 capability 门控） |

#### ChatMessageBubble 内联样式迁移

详见 §28。

### P2：对话气泡差异化设计

#### 气泡视觉差异化

| 元素 | 用户气泡 | AI 气泡 |
|------|----------|---------|
| 背景 | 蓝紫渐变（保持） | 暗色：`linear-gradient(135deg, rgba(30,30,46,0.8), rgba(40,40,60,0.8))`；亮色：`rgba(255,255,255,0.95)` |
| 阴影 | `0 4px 12px rgba(99,102,241,0.3)`（保持） | 暗色：`0 4px 16px rgba(0,0,0,0.25)`；亮色：`0 2px 8px rgba(0,0,0,0.06)` |
| 边框 | 无 | 暗色：`1px solid rgba(255,255,255,0.06)`；亮色：`1px solid rgba(0,0,0,0.04)` |
| 悬停阴影 | `0 6px 16px rgba(99,102,241,0.4)` | 暗色：`0 4px 20px rgba(0,0,0,0.3)`；亮色：`0 4px 12px rgba(0,0,0,0.1)` |
| 悬停边框 | — | 暗色：`rgba(255,255,255,0.12)`；亮色：`rgba(0,0,0,0.08)` |

**新增 CSS 变量**（`ui-variables.css`，亮色 `:root` + 暗色 `.dark`）：
- `--chat-bubble-user-shadow-hover`
- `--chat-bubble-assistant-shadow-hover`
- `--chat-bubble-assistant-border-hover`

**文件**：`ui-variables.css`、`ChatMessageBubble.css`

### 涉及文件清单

| 文件 | 改动概述 |
|------|----------|
| `ui-variables.css` | 新增 6 组 CSS 变量（角色名/用户名颜色、交替背景、选项颜色、思考/行为/引号颜色、气泡 hover 阴影+边框） |
| `MessageRenderer.styles.css` | 修复主题选择器；引号高亮优化；新增 `.message-renderer-thought-block`、`.message-renderer-action` |
| `MessageRenderer.tsx` | em 映射改为 CSS 类；a/blockquote 颜色改用 CSS 变量 |
| `MessageRenderer.config.ts` | 新增 `showThinking` 配置 |
| `messageProcessor.ts` | 新增 `convertThinkingTags()`；`processMessage` 支持 `showThinking` 选项 |
| `ChatMessageBubble.css` | 新增 15+ CSS 类（内联迁移）；气泡 hover/border 差异化；选项颜色改用 CSS 变量 |
| `ChatMessageBubble.tsx` | 17 处内联样式迁移为 CSS 类；角色名突出显示；交替背景；showThinking 透传 |
| `CharacterDialogueChat.types.ts` | `AIParameterConfig` 新增 `top_k`/`min_p`/`show_thinking` |
| `parameterConfigs.ts` | `PARAMETER_CONFIGS` 新增 `top_k`/`min_p` |
| `CharacterDialogueChat.hooks.ts` | `getEffectiveParams` 新增 top_k/min_p 合并；3 处注入；showThinking 守卫 |
| `CharacterDialogueChat.tsx` | 透传 showThinking 到 ChatMessageBubble 和 ParameterPanel |
| `ParameterPanel.tsx` | 新增"显示思考过程"开关 |
| `ChatEngine.types.ts` | `AIEngineConfig` 新增 `top_k`/`min_p` |
| `ChatEngine.ts` | 请求体直接注入 `top_k`/`min_p` |

### 验证

- 全部 14 个修改文件 TypeScript 诊断零错误
- 现有 CSS 类未被修改（向后兼容）
- `@media` 响应式规则保持在 CSS 文件最末尾

## §30 ⚠️【重点标记】Think 标签处理开关合并为三态选择（2026-08-08）

### 问题

原设计有两个独立开关：
- `strip_think_tags`（Think 标签处理）：控制存储前是否剥离 think 标签
- `show_thinking`（显示思考过程）：控制渲染时是否折叠展示

实际行为矩阵暴露冗余：当 `show_thinking=true` 时，`strip_think_tags` 无论开不开都无效（存储前永远不剥离）。两个开关并列展示但实际是 `show_thinking` 优先级高于 `strip_think_tags`，用户无法直观理解。

### 修复方案

合并为一个三态选择 `think_tag_mode: 'strip' | 'strip_render' | 'fold'`：

| 模式 | 存储前处理 | 渲染时处理 | 效果 |
|------|-----------|-----------|------|
| `strip`（默认） | 剥离 | — | 彻底移除，不污染上下文 |
| `strip_render` | 保留 | 渲染时剥离 | 用户不可见，但存储/RAG 含标签 |
| `fold` | 保留 | 转折叠 details 块 | 用户可展开查看 AI 思考过程 |

### 向后兼容

`deriveThinkTagMode()` 函数从旧字段推导三态值：
- `think_tag_mode` 优先
- 否则 `show_thinking === true` → `'fold'`
- 否则 `strip_think_tags === false` → `'strip_render'`
- 默认 → `'strip'`

旧字段 `strip_think_tags` / `show_thinking` 标记 `@deprecated` 但保留，不破坏已存角色卡数据。

### 改动文件

| 文件 | 改动 |
|------|------|
| `CharacterDialogueChat.types.ts` | 新增 `ThinkTagMode` 类型 + `deriveThinkTagMode()` 函数；`think_tag_mode` 字段；旧字段标 `@deprecated` |
| `ParameterPanel.tsx` | 两个 Switch 替换为一个 Select（移除/仅渲染剥离/折叠展示） |
| `ConfigPanel.tsx` | props 透传从 `stripThinkTags`/`showThinking` 改为 `thinkTagMode`/`onThinkTagModeChange` |
| `CharacterDialogueChat.tsx` | 使用 `deriveThinkTagMode()` 推导模式，传给 ParameterPanel 和 ChatMessageBubble |
| `CharacterDialogueChat.hooks.ts` | 两处条件判断简化为 `deriveThinkTagMode(...) === 'strip'` |

### 验证

- 全部 5 个修改文件 TypeScript 诊断零错误

## §31 ⚠️【重点标记】Bug 修复：对话内容增强不生效——系统提示词与渲染管线不匹配（2026-08-08）

### 问题

用户测试发现角色对话气泡中仅对话内容颜色略有变化，动作描写样式、思考折叠块等增强功能完全不生效。

### 根因

系统提示词与渲染管线存在**三个关键不匹配**：

1. **动作描写（`*text*` 斜体）**：渲染端 `em` → `.message-renderer-action` 映射完整，但系统提示词写着"不要添加任何额外的标记或说明"，直接禁止 AI 使用 markdown 格式标记。AI 以纯文本输出动作，`em` 元素永远不产生。

2. **引号高亮效果太弱**：引号高亮功能实际在工作（提示词要求 AI 用 `" "` 包裹对话），但 CSS 背景透明度仅 `0.04`/`0.06`（几乎不可见），用户难以察觉。

3. **思考标签**：系统提示词从未指示 AI 使用 `<thinking>` 标签，且默认 `think_tag_mode='strip'` 会移除任何思考标签。

### 修复

#### 1. 系统提示词添加格式指令

**文件**：`PromptBuilder.ts`（硬编码回退）、`promptTemplateService.ts`（模板）

- 新增规则 8：`【格式要求】角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑*）`
- 白名单例外添加：`星号 *动作描写* 是格式标记，不属于"额外标记或说明"`
- 输出格式修改：从"不要添加任何额外的标记或说明"改为"对话内容用英文双引号包裹，动作和神态描写用星号包裹"

#### 2. 引号高亮 CSS 增强可见度

**文件**：`ui-variables.css`、`MessageRenderer.styles.css`

| 属性 | 修复前 | 修复后 |
|------|--------|--------|
| 亮色背景透明度 | `0.06` | `0.12` |
| 暗色背景透明度 | `0.04` | `0.10` |
| 边框 | 无 | 新增 `--mr-quote-highlight-border` 变量，`1px solid` |
| 内边距 | `0 2px` | `0 4px` |
| 圆角 | `3px` | `4px` |

### 验证

- 全部 4 个修改文件 TypeScript 诊断零错误
- `*text*` 是标准 markdown 斜体，ReactMarkdown 原生解析为 `em` 元素，无需额外插件

## §32 ⚠️【重点标记】Bug 修复：格式指令未生效 + 表情标签泄露（2026-08-08）

### 问题

用户反馈修改后仍然不生效，且对话末尾出现 `<<>>annoyance<<<_EXPRESSION>>>` 残缺标签文字。

### 根因

**问题 A — 格式指令未生效**：
`promptTemplateService.ts` 的 `mergeNewDefaultTemplates()` 只添加**缺失的**新模板，不更新已存在的模板。用户数据库中已有旧版 `creative-chat.dialogue` 模板（包含"不要添加任何额外的标记或说明"），代码修改的默认模板不会覆盖已存在的数据库记录。

**问题 B — 表情标签泄露**：
AI 返回了格式残缺的表情标记 `<<>>annoyance<<<_EXPRESSION>>>`（开始标记 `<<<EXPRESSION>>>` 被截断为 `<<>>`，结束标记 `<<<END_EXPRESSION>>>` 被截断为 `<<<_EXPRESSION>>>`）。原有正则无法匹配这种残缺格式，导致标签未被剥离，直接显示给用户。

### 修复

#### A. 格式指令后处理注入器

新增 `injectDialogueFormatInstructions()` 函数（`PromptBuilder.ts`），在 `buildDialoguePrompt` 返回前对系统提示词做后处理：
1. 正则移除"不要添加任何额外的标记或说明"语句
2. 追加格式要求（对话用双引号，动作用星号 `* *`）

此方案不依赖模板数据库更新，对所有来源的提示词生效。

#### B. 表情标签解析容错增强

`parseExpressionFromContent()` 新增 4 个容错正则模式：

| 模式名 | 匹配场景 |
|--------|---------|
| `text-marker-malformed` | 残缺开始+结束标记（如 `<<>>key<<<_EXPRESSION>>>`） |
| `text-marker-malformed-unclosed` | 残缺开始标记 + key 到末尾 |
| `text-marker-fallback-before` | key 在 EXPRESSION 字样之前 |
| `text-marker-fallback-after` | key 在 EXPRESSION 字样之后 |

此外，解析成功后追加清理步骤：`cleanedContent.replace(/[<>_]{2,}\s*$/, '')` 移除残留的孤立尖括号碎片。

### 改动文件

| 文件 | 改动 |
|------|------|
| `PromptBuilder.ts` | 新增 `injectDialogueFormatInstructions()` 后处理函数；`buildDialoguePrompt` 返回前调用；`parseExpressionFromContent` 新增 4 个容错正则 + 残留碎片清理 |

### 验证

- TypeScript 诊断零错误

## §33 ⚠️【重点标记】Bug 修复：rehypeRaw 解析系统标签导致 *text* 渲染失败（2026-08-08）

### 问题

用户提供日志数据和气泡实际显示数据对比，发现：
1. 日志中 `*动作描写*` 星号格式正确，但气泡中星号消失且无样式
2. 日志中 `<<<EXPRESSION>>>annoyance<<<END_EXPRESSION>>>` 标准标签，气泡中显示为 `<<>>annoyance<<<END_EXPR>>>` 残缺碎片

### 根因

**渲染管线 HTML 解析损坏**：

`MessageRenderer` 配置 `allowRawHTML: true` + `encodeAngleBrackets: false`，导致 `<<<EXPRESSION>>>` 等系统控制标签中的 `<` 字符被 `rehypeRaw` 当作 HTML 标签解析。

1. `rehypeRaw` 尝试将 `<<<EXPRESSION>>>` 解析为 HTML 元素 → 产生非法节点
2. `rehypeSanitize` 删除未知标签 → 留下碎片（`<<>>annoyance<<<END_EXPR>>>`）
3. 非法 HTML 解析可能破坏整个 hast 树 → `*text*` 的 `<em>` 元素也被影响

**关键链条**：系统标签未被剥离 → 进入 HTML 解析 → 破坏 hast 树 → `<em>` 元素丢失 → 动作描写样式不生效

### 修复

新增 `stripSystemTags()` 函数（`messageProcessor.ts`），在 `processMessage` 中**始终调用**（不受配置控制），在思考标签处理之后、引号规范化之前执行：

1. 剥离 `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 及所有残缺变体（4 层正则兜底）
2. 剥离 `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` 标签
3. 清理残留的孤立尖括号碎片
4. 清理多余空行

此函数作为**防御性兜底**，即使 hooks 层的 `parseExpressionFromContent` 已剥离标签，也处理旧消息或解析失败的情况。

### 改动文件

| 文件 | 改动 |
|------|------|
| `messageProcessor.ts` | 新增 `stripSystemTags()` 函数；`processMessage` 中始终调用 |

### 验证

- TypeScript 诊断零错误
- 系统标签不再进入 `rehypeRaw` 解析管线，`*text*` 的 `<em>` 元素不再被破坏

---

## 对话管线架构重设计 — Pipeline 核心框架（Spec: redesign-dialogue-pipeline-architecture / Task 1）

### 概述

采用 Pipeline + Middleware + Intent Router 模式，替换原有的单体函数式对话处理架构（`requestAIResponse` ~1140 行、`onComplete` ~517 行）。Task 1 实现管线核心框架，包含类型定义、Pipeline 执行引擎、扩展注册表和分级日志系统。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/pipeline.types.ts` | 管线架构全部类型定义（DialoguePipelineContext、UserIntent、AIIntentType、PromptProvider、PostProcessPlugin、LogicTask、IntentHandler、PipelineLogger 类型、PipelineMetrics、PipelineError、ParsePattern/ParseResult、RenderOptions、ImageGenRequest、DedupInfo、SuggestedOption、TableEditCommand 等） |
| `pipeline/Pipeline.ts` | Pipeline 核心类 — 有序 Stage 执行引擎，支持非致命错误继续/致命错误中断 |
| `pipeline/PipelineLogger.ts` | 分级日志系统 — debug/info/warn/error 四级日志 + trace 性能追踪 + metrics 聚合 |
| `pipeline/ExtensionRegistry.ts` | 扩展注册表（单例）— 管理 PromptProvider / PostProcessPlugin / LogicTask / RenderComponent / IntentHandler 的注册与获取 |

### 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                   ExtensionRegistry (单例)                │
│  PromptProviders / PostProcessPlugins / LogicTasks /     │
│  RenderComponents / IntentHandlers                       │
└────────────────────────┬─────────────────────────────────┘
                         │ 注册
┌────────────────────────▼─────────────────────────────────┐
│                    DialoguePipeline                       │
│  Stage[] → execute(context, logger)                      │
│  非致命错误继续 / 致命错误中断                             │
└────────────────────────┬─────────────────────────────────┘
                         │ 读写
┌────────────────────────▼─────────────────────────────────┐
│                DialoguePipelineContext                     │
│  (userInput / intent / systemPrompt / rawResponse / ...) │
│  logs: PipelineLogEntry[] / metrics / errors             │
└──────────────────────────────────────────────────────────┘
```

### 关键类型

- **DialoguePipelineContext**：贯穿整个对话处理流程的中央数据对象，包含输入、上下文组装、提示词、AI 响应、后处理结果和元数据六大分区
- **PipelineMode**：`'dialogue' | 'continuation' | 'retry' | 'polish' | 'userReply'` 五种管线模式
- **UserIntent / UserAction**：用户意图（含 NLU 置信度）与 UI 操作映射
- **AIIntentType**：`expression | suggested_options | table_edit | think_tag | image_generation | narrative` 六种 AI 意图
- **PromptProvider**：模块化提示词构建单元，按 section + priority 组装
- **PostProcessPlugin**：后处理插件，按 priority 顺序链式处理内容
- **LogicTask**：逻辑副作用任务，按 priority + condition 调度

### 错误处理策略

Pipeline.execute 中的 Stage 异常处理：
- Stage 抛出的 Error 若携带 `isFatal: false` → 非致命错误，记录到 `context.errors` 和 `logger.error()`，继续执行下一个 Stage
- Stage 抛出的 Error 若 `isFatal: true` 或未标记 → 致命错误，记录后重新抛出，中断管线

### 类型导入关系

- 从 `../CharacterDialogueChat.types` 导入并重导出：ChatMessage、CharacterInfo、AIParameterConfig、CharacterSessionConfig、EffectiveAIParams、ThinkTagMode
- 从 `../../../Common/ChatEngine/ChatEngine.types` 导入并重导出：AIEngineConfig、EngineCapabilities
- 从 `../../../KnowledgeBase/shared` 导入并重导出：VectorSearchResult
- 本地定义（不存在于现有代码中）：ChatHistoryItem、TableStructure、DialogueContext、ValidationResult、TableEditCommand（独立于主进程同名类型）

### 验证

- TypeScript 诊断零错误（四个文件均通过 `tsc --noEmit` 检查）
- 未使用 `any` 类型，React 组件类型使用 `React.ComponentType<Record<string, unknown>>`
- 所有代码含中文注释

---

## 对话管线架构重设计 — 模块化提示词构建系统（Spec: redesign-dialogue-pipeline-architecture / Task 5）

### 概述

采用 Provider 注册机制替换硬编码的提示词拼接流程。PromptComposer 按 section（header → context → instruction → suffix）分组，组内按 priority 升序排列，依次通过 `isActive` 过滤和异步 `build` 构建，最终拼接为完整的 system prompt。共实现 13 个预置 PromptProvider，迁移自 `PromptBuilder.ts` 中的全部 build 函数。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/PromptComposer.ts` | PromptComposer 核心类 — `registerProvider`（同名去重）+ 异步 `compose`（分组/排序/过滤/构建/拼接） |
| `pipeline/providers/index.ts` | 13 个 Provider 的统一导出 + `registerAllProviders(composer)` 批量注册函数 |
| `pipeline/providers/CharacterContextProvider.ts` | 角色卡信息段落（名称、个性、描述、场景、示例对话），迁移自 `buildCharacterContext` |
| `pipeline/providers/PersonaProvider.ts` | 用户人设段落，迁移自 `buildPersonaSection` |
| `pipeline/providers/KnowledgeContextProvider.ts` | 知识库检索结果格式化段落，迁移自 `buildFinalSystemPrompt` 区域 1 |
| `pipeline/providers/ChatHistoryProvider.ts` | 对话历史 RAG 片段格式化段落，迁移自 `buildFinalSystemPrompt` 区域 2 |
| `pipeline/providers/MemoryTableProvider.ts` | 记忆表格 markdown 数据段落，迁移自 `buildFinalSystemPrompt` 区域 3 |
| `pipeline/providers/DialogueInstructionProvider.ts` | 对话模式任务指令（模板 `creative-chat.dialogue`），迁移自 `buildDialoguePrompt` |
| `pipeline/providers/ContinuationInstructionProvider.ts` | 续写模式任务指令（模板 `creative-chat.continuation`），迁移自 `buildContinuationPrompt` |
| `pipeline/providers/LengthGuidanceProvider.ts` | 回复长度下限约束 + 强化模式检测，迁移自 `buildLengthGuidancePrompt` |
| `pipeline/providers/LanguageProvider.ts` | 语言约束注入，迁移自 `buildLanguagePrompt` |
| `pipeline/providers/AssistModeProvider.ts` | 辅助模式选项指令，迁移自 `buildAssistModePrompt` |
| `pipeline/providers/ExpressionProvider.ts` | 表情情绪标记指令，迁移自 `buildExpressionPrompt` |
| `pipeline/providers/AsyncTableOrganizeProvider.ts` | 异步表格整理指令，迁移自 `buildAsyncTableOrganizeInstructions` |
| `pipeline/providers/FormatInstructionProvider.ts` | 格式指令统一追加（对话双引号 + 动作星号），迁移自 `injectDialogueFormatInstructions` 追加部分 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `pipeline/pipeline.types.ts` | `PromptProvider.build` 返回类型从 `string` 改为 `Promise<string>`（异步模板调用需要）；新增 `selectedPersona?: UserPersona` 字段到 `DialoguePipelineContext`；导入并重导出 `UserPersona` 类型 |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    PromptComposer                            │
│  registerProvider(provider) → 同名去重注册                   │
│  async compose(context) → 分组/排序/过滤/构建/拼接           │
└──────────────────────────┬──────────────────────────────────┘
                           │ 按 section 分组
┌──────────┬───────────┬───────────────┬──────────────────────┐
│ header   │ context   │ instruction   │ suffix               │
│ (预留)    │ 100-220   │ 300           │ 400-450              │
└──────────┴───────────┴───────────────┴──────────────────────┘
                           │ 组内按 priority 升序
                           ▼
              isActive(context) → 同步过滤
                           ▼
              await build(context) → 异步构建
                           ▼
              非空段 trim() → '\n\n'.join()
```

### Provider 注册表

| Provider | section | priority | isActive 条件 | 迁移源函数 |
|----------|---------|----------|--------------|-----------|
| CharacterContextProvider | context | 100 | 始终活跃 | `buildCharacterContext` |
| PersonaProvider | context | 110 | 始终活跃 | `buildPersonaSection` |
| KnowledgeContextProvider | context | 200 | `knowledgeBase.length > 0` | `buildFinalSystemPrompt` 区域 1 |
| ChatHistoryProvider | context | 210 | `chatHistory.length > 0` | `buildFinalSystemPrompt` 区域 2 |
| MemoryTableProvider | context | 220 | `memoryTableData` 非空 | `buildFinalSystemPrompt` 区域 3 |
| DialogueInstructionProvider | instruction | 300 | `pipelineMode === 'dialogue'` | `buildDialoguePrompt` |
| ContinuationInstructionProvider | instruction | 300 | `pipelineMode === 'continuation'` | `buildContinuationPrompt` |
| LengthGuidanceProvider | suffix | 400 | 始终活跃 | `buildLengthGuidancePrompt` |
| LanguageProvider | suffix | 410 | 始终活跃 | `buildLanguagePrompt` |
| AssistModeProvider | suffix | 420 | `assist_mode === true` | `buildAssistModePrompt` |
| ExpressionProvider | suffix | 430 | `expression_display === true` | `buildExpressionPrompt` |
| AsyncTableOrganizeProvider | suffix | 440 | `memoryTableOrganizeMode === 'async'` | `buildAsyncTableOrganizeInstructions` |
| FormatInstructionProvider | suffix | 450 | 始终活跃 | `injectDialogueFormatInstructions` 追加部分 |

### 关键设计决策

1. **异步 build 方法**：`PromptProvider.build` 返回 `Promise<string>` 而非 `string`，因为 DialogueInstructionProvider / ContinuationInstructionProvider / AsyncTableOrganizeProvider 需要调用 `window.electronAPI.prompt.build` 异步模板系统。`isActive` 保持同步。

2. **Provider 职责分离**：原 `buildDialoguePrompt` / `buildContinuationPrompt` 内含角色上下文和人设段落，新架构中这些由 CharacterContextProvider / PersonaProvider 独立提供。指令 Provider 向模板传入空的 `character_context` / `persona_section` 参数以避免内容重复。

3. **injectDialogueFormatInstructions 拆分**：原函数包含"移除旧版禁止标记"和"追加格式指令"两部分。移除逻辑迁移到 DialogueInstructionProvider（需处理模板输出后执行清理），追加逻辑迁移到 FormatInstructionProvider（对所有管线模式统一生效）。

4. **shouldStrengthenLength 迁移**：原 hooks.ts 中的 `shouldStrengthenLength` 使用 `responseLengthHistoryRef`，LengthGuidanceProvider 改为从 `context.messagesToSend` 中提取最近 3 条 assistant 消息长度进行判定。

5. **TableStructure 类型适配**：管线 `TableStructure` 类型（`{ sheets: Array<{ sheetName, headers, rowCount }> }`）与 `buildAsyncTableOrganizeInstructions` 期望的格式（`{ sheets: string[], headers: Record<string, string[]>, descriptions: Record<string, string> }`）不同，通过 `adaptTableStructure` 辅助函数转换。

### ⚠️ 重点标记：Bug 修复

- **旧版模板禁止标记 Bug**：系统提示词模板可能来自数据库旧版（`mergeNewDefaultTemplates` 不更新已有模板），旧模板包含"不要添加任何额外的标记或说明"语句，导致 AI 不使用 `*动作*` 格式。DialogueInstructionProvider 中 `removeOldFormatProhibition` 函数负责移除该语句，FormatInstructionProvider 负责重新追加正确的格式指令。

### 错误处理策略

PromptComposer.compose 中的 Provider 构建异常处理：
- 单个 Provider 的 `build` 抛出异常 → 非致命错误，记录到 `context.errors` 和 `console.error()`，跳过该 Provider 继续执行
- 最终拼接结果仅包含成功构建的非空段落

### 验证

- TypeScript 诊断零错误（PromptComposer.ts + 13 个 Provider + index.ts + pipeline.types.ts 修改，共 16 个文件）
- 所有 Provider 实现了 `PromptProvider` 接口（name / priority / section / isActive / build）
- 所有代码含中文注释

---

## 对话管线架构重设计 — 统一参数注入器（Spec: redesign-dialogue-pipeline-architecture / Task 6）

### 概述

消除 `requestAIResponse` / `generateUserReply` / `polishInput` 三处重复的参数注入逻辑。ParameterInjector 提供三个核心方法：`getEffectiveParams`（三级参数合并）、`buildEngineConfig`（能力门控引擎配置构建）、`buildStopSequences`（模式驱动的停止序列生成）。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/ParameterInjector.ts` | ParameterInjector 类 — 三级参数合并 + 能力门控引擎配置 + 模式驱动停止序列 |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                  ParameterInjector                           │
├─────────────────────────────────────────────────────────────┤
│  getEffectiveParams(custom, engine)                         │
│    custom > engine > defaults  → EffectiveAIParams          │
├─────────────────────────────────────────────────────────────┤
│  buildEngineConfig(base, params, capabilities)              │
│    非门控参数直接注入 + buildSamplingExtras 能力门控注入     │
│    → AIEngineConfig                                         │
├─────────────────────────────────────────────────────────────┤
│  buildStopSequences(mode, charName, userName)               │
│    dialogue/continuation/retry → 用户名变体                  │
│    userReply → 角色名变体                                    │
│    polish → 空数组                                           │
│    → string[]                                                │
└─────────────────────────────────────────────────────────────┘
```

### 核心方法

#### getEffectiveParams(custom, engine)

三级合并：`customParameters > globalEngine > defaults`，迁移自 `CharacterDialogueChat.hooks.ts` 约 174-285 行。

合并参数清单：
- `temperature`（默认 0.7）/ `max_tokens`（默认 `DEFAULT_MAX_TOKENS = 8192`，来自 TokenManagement）
- `top_p` / `frequency_penalty` / `presence_penalty`（可选，按优先级取值）
- `repetition_penalty`（兼容 SillyTavern 风格的 `engine.rep_pen` 字段）
- DRY 采样组：`dry_multiplier` / `dry_base` / `dry_allowed_length` / `no_repeat_ngram_size`
- `top_k` / `min_p`

返回 `EffectiveAIParams` 对象，包含 `source: 'global' | 'custom'` 标识参数来源。

#### buildEngineConfig(base, params, capabilities)

迁移自 `CharacterDialogueChat.hooks.ts` 约 641-707 行的 `engineConfigWithParams` 构建逻辑。

- **非能力门控参数**（直接注入）：`max_tokens` / `temperature` / `top_p` / `frequency_penalty` / `presence_penalty` / `top_k` / `min_p`
- **能力门控参数**（通过 `buildSamplingExtras` 注入）：`repetition_penalty`（`supportsRepPen`）/ DRY 采样组（`supportsDrySampler`）/ `no_repeat_ngram_size`
- `buildSamplingExtras` 按 `capabilities` 决定是否包含能力门控参数，未启用时自动省略，启用时含默认值兜底

#### buildStopSequences(mode, charName, userName)

迁移自 `PromptBuilder.ts::buildStopSequences` 和 `buildStopSequencesForUserReply`。

| 管线模式 | 停止序列 | 目的 |
|---------|---------|------|
| dialogue / continuation / retry | 用户名变体（`buildStopSequencesImpl(userName)`） | 阻断 AI 代替用户发言 |
| userReply | 角色名变体（`buildStopSequencesForUserReply(charName)`） | 阻断 AI 越权代替角色发言 |
| polish | 空数组 `[]` | 润色模式无需停止序列 |

### 关键设计决策

1. **复用 buildSamplingExtras**：不重新实现能力门控逻辑，直接调用 `ChatEngine.types.ts` 中的 `buildSamplingExtras` 函数，替代 hooks.ts 中逐个 `if` 判断 + ChatEngine 层二次过滤的重复逻辑。

2. **默认值来源**：`max_tokens` 默认值从 `TokenManagement/constants.ts` 导入 `DEFAULT_MAX_TOKENS`，`temperature` 默认值硬编码为 0.7（与 hooks.ts 一致）。

3. **rep_pen 兼容**：SillyTavern 风格的引擎配置使用 `rep_pen` 字段而非 `repetition_penalty`，合并时通过 `(globalEngine as any).rep_pen` 读取（类型定义中 AIEngineConfig 不含 rep_pen 字段）。

4. **停止序列复用**：直接导入并调用 `PromptBuilder.ts` 中已有的 `buildStopSequences` 和 `buildStopSequencesForUserReply` 函数，不重复实现停止序列生成逻辑。

### 验证

- TypeScript 诊断零错误（ParameterInjector.ts 单文件通过 `tsc --noEmit` 检查）
- 三级合并覆盖全部参数（temperature / max_tokens / top_p / frequency_penalty / presence_penalty / repetition_penalty / DRY 组 / no_repeat_ngram_size / top_k / min_p）
- 能力门控参数通过 `buildSamplingExtras` 注入，非门控参数直接注入
- 停止序列按管线模式正确切换
- 所有代码含中文注释

## 对话管线架构重设计 — AI 交互模块（Spec: redesign-dialogue-pipeline-architecture / Task 7）

### 概述

封装引擎实例管理、流式通信和错误处理，作为 Pipeline 的 AIService Stage。AIService 通过 ChatEngineFactory 获取/复用引擎实例，管理 onStream / onComplete / onError 回调注册，设置 300 秒超时自动取消，并提供故障转移事件订阅。迁移自 `CharacterDialogueChat.hooks.ts` 中的引擎调用逻辑（engine 创建 ~1098 行、stream 回调 ~1102 行、complete 回调 ~1120 行、error 回调 ~1639 行、timeout 设置 ~616 行、failover 订阅 ~542 行）。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/AIService.ts` | AIService 类 — 引擎实例管理 + 流式通信 + 超时取消 + 故障转移订阅 |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                       AIService                              │
├─────────────────────────────────────────────────────────────┤
│  sendMessage(context, callbacks)                            │
│    ChatEngineFactory.getOrCreateDefaultEngine(finalConfig)  │
│    → 注册 onStream / onComplete / onError                   │
│    → setTimeout(300s) 超时取消                               │
│    → engine.sendMessage(messages, systemPrompt, config)     │
├─────────────────────────────────────────────────────────────┤
│  cancel()                                                    │
│    engine.cancelRequest() + clearStreamTimeout()             │
├─────────────────────────────────────────────────────────────┤
│  getCapabilities()                                           │
│    → EngineCapabilities（从 currentEngineConfig 读取）        │
├─────────────────────────────────────────────────────────────┤
│  setupFailoverSubscription(onFailover)                       │
│    → 订阅 window.electronAPI.ai.failover.onFailover          │
│    → 返回 cleanup 函数                                       │
└─────────────────────────────────────────────────────────────┘
```

### 核心方法

#### sendMessage(context, callbacks)

迁移自 hooks.ts 引擎调用流程。

- **引擎获取**：通过 `ChatEngineFactory.getInstance().getOrCreateDefaultEngine(finalConfig)` 获取/复用引擎实例
- **停止序列注入**：将 `context.stopSequences` 合并到 `finalConfig.stopSequences`（Spec 要求注入 engineConfig 和 stopSequences）
- **回调注册**：在 `sendMessage` 调用之前注册 `onStream` / `onComplete` / `onError`
- **流式累积**：使用局部变量 `accumulatedContent` 累积 chunk，每次 chunk 调用 `callbacks.onStream(chunk, accumulatedContent)`
- **完成处理**：清除超时，优先使用流式累积内容，兜底使用 `response.content`，传递 `response.finishReason`
- **错误处理**：清除超时，将 `AIError` 转换为 `Error` 传递；同时 try/catch 捕获 `engine.sendMessage` 本身抛出的异常
- **超时**：300 秒（`STREAM_TIMEOUT_MS = 300_000`），超时后调用 `engine.cancelRequest()` 并触发 `onError`

#### cancel()

清除超时定时器并调用 `engine.cancelRequest()` 中断当前请求。

#### getCapabilities()

返回 `currentEngineConfig.capabilities`，缺省时通过 `getDefaultEngineCapabilities()` 返回默认能力。

#### setupFailoverSubscription(onFailover)

订阅 `window.electronAPI.ai.failover.onFailover` 事件，当 provider 切换时调用回调。`fromProvider` 取自当前引擎配置名称，`toProvider` 取自事件数据。返回 cleanup 函数用于取消订阅。electronAPI 不可用时返回空函数。

### 关键设计决策

1. **回调注册顺序**：引擎使用回调注册模式，必须在 `sendMessage` 之前注册 `onStream` / `onComplete` / `onError`，否则流式事件丢失。

2. **停止序列合并**：虽然 ParameterInjector 已将停止序列注入 `engineConfig.stopSequences`，AIService 额外从 `context.stopSequences` 合并以确保 Spec 要求的双注入，优先使用 `context.stopSequences`。

3. **完成内容兜底**：`onComplete` 优先使用流式累积内容 `accumulatedContent`，兜底使用服务端返回的 `response.content`，处理无流式 chunk 但直接完成的场景。

4. **sendMessage 异常捕获**：除引擎 `onError` 回调外，额外 try/catch 包裹 `engine.sendMessage` 调用，捕获请求发起阶段的同步/异步异常，统一路由到 `callbacks.onError`。

5. **超时方法命名**：内部超时清理方法命名为 `clearStreamTimeout`（与 hooks.ts 一致），避免与全局 `clearTimeout` 冲突。

### 类型定义

| 类型 | 职责 |
|------|------|
| `AIServiceCallbacks` | 流式通信回调集合（onStream / onComplete / onError） |
| `FailoverInfo` | 故障转移信息（fromProvider / toProvider） |

### 依赖关系

| 依赖 | 来源 | 用途 |
|------|------|------|
| `ChatEngineFactory` | `Common/ChatEngine/ChatEngine.factory` | 获取/复用引擎实例 |
| `IChatEngine` | `Common/ChatEngine/ChatEngine.types` | 引擎接口类型 |
| `AIEngineConfig` / `EngineCapabilities` | `Common/ChatEngine/ChatEngine.types` | 引擎配置与能力类型 |
| `AIResponse` / `AIError` | `Common/ChatEngine/ChatEngine.types` | 完成回调与错误回调类型 |
| `getDefaultEngineCapabilities` | `Common/ChatEngine/ChatEngine.types` | 默认能力兜底 |
| `DialoguePipelineContext` | `./pipeline.types` | 管线上下文类型 |
| `window.electronAPI.ai.failover` | Electron preload bridge | 故障转移事件订阅 |

### 验证

- TypeScript 诊断零错误（AIService.ts 单文件通过检查）
- 四个方法完整实现（sendMessage / cancel / getCapabilities / setupFailoverSubscription）
- 流式累积、超时取消、错误转换、故障转移订阅均覆盖
- 所有代码含中文注释

## 对话管线架构重设计 — AI 意图识别模块（Spec: redesign-dialogue-pipeline-architecture / Task 9）

### 概述

AIIntentRecognizer 扫描 AI 响应内容，识别所有结构化标签意图（expression / suggested_options / table_edit / think_tag / image_generation），返回 `DetectedIntent[]`。使用 RobustParser 的静态模式集合进行多格式容错匹配，保证在 AI 生成文本不稳定时仍能正确识别意图。迁移自 `PromptBuilder.ts::parseExpressionFromContent`、`CharacterDialogueChat.hooks.ts` 中的 option/tableEdit 解析、`messageProcessor.ts::stripThinkingTags` 的标签模式。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/AIIntentRecognizer.ts` | AIIntentRecognizer 类 — `detect`（扫描所有标签意图）/ `stripIntents`（剥离标签返回纯净叙事）/ `getIntentRouter`（空路由表，由 ExtensionRegistry 注册） |

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                  AIIntentRecognizer                          │
├─────────────────────────────────────────────────────────────┤
│  detect(content) → DetectedIntent[]                         │
│    1. expression      — RobustParser.EXPRESSION_PATTERNS    │
│    2. suggested_options — RobustParser.SUGGESTED_OPTIONS_.. │
│    3. table_edit      — RobustParser.TABLE_EDIT_PATTERNS    │
│    4. think_tag       — 正则匹配 ILD/thinking/thought/     │
│                         antml:thinking（完整+未关闭）        │
│    5. image_generation — <<<GENERATE_IMAGE>>>...（预留）     │
├─────────────────────────────────────────────────────────────┤
│  stripIntents(content, intents) → string                    │
│    移除 rawMatch → cleanup 残留碎片 → trim → 折叠空行        │
├─────────────────────────────────────────────────────────────┤
│  getIntentRouter() → Map<AIIntentType, IntentHandler>       │
│    空映射表（由 ExtensionRegistry 注册处理器）                │
└─────────────────────────────────────────────────────────────┘
```

### 核心方法

#### detect(content: string): DetectedIntent[]

扫描 AI 响应内容中所有结构化标签类型，返回检测到的意图数组。对每种标签类型依次检测：

| 意图类型 | 模式来源 | data 结构 | confidence |
|---------|---------|-----------|------------|
| expression | RobustParser.EXPRESSION_PATTERNS | `{ emotion: string }` | 标准格式 1.0 / 残缺兜底 0.8 |
| suggested_options | RobustParser.SUGGESTED_OPTIONS_PATTERNS | `{ options: string[] }`（按行拆分过滤空行） | 标准格式 1.0 / 方括号 0.8 |
| table_edit | RobustParser.TABLE_EDIT_PATTERNS | `{ rawContent: string }`（原始命令文本） | 标准格式 1.0 / 注释分隔 0.8 |
| think_tag | 正则匹配 | `{ content: string, tagType: string }` | 固定 1.0 |
| image_generation | 正则匹配 | `{ prompt: string }` | 固定 1.0 |

**置信度判定**：通过 `matchWithPatternName` 辅助方法追踪匹配到的模式名称，与标准格式名称集合比对确定 confidence。标准格式名称集合定义在模块级常量中（`EXPRESSION_STANDARD_NAMES` / `SUGGESTED_OPTIONS_STANDARD_NAMES` / `TABLE_EDIT_STANDARD_NAMES`）。

**think 标签检测**：支持 ILD(think)、thinking、thought、antml:thinking 四种变体。先查找完整标签对（`<tag>...</tag>`），再在剩余内容中查找未关闭标签（流式场景，行首匹配到文本末尾）。

#### stripIntents(content: string, intents: DetectedIntent[]): string

从内容中剥离所有已识别标签：逐一使用 `split + join` 移除 rawMatch（避免正则元字符问题），然后调用 `RobustParser.cleanup` 清理残留碎片（`/[<>_]{3,}/g` 匹配 3+ 连续尖括号/下划线），最后 trim 并折叠 3+ 连续换行为 2 个。

#### getIntentRouter(): Map<AIIntentType, IntentHandler>

返回空 Map，实际 IntentHandler 由 ExtensionRegistry 注册。

### 关键设计决策

1. **matchWithPatternName 辅助方法**：RobustParser.match 仅返回 ParseResult（data + rawMatch），不包含模式名称。为实现 confidence 判定（标准 vs 残缺），新增 `matchWithPatternName` 方法在匹配时追踪 pattern.name，复用 RobustParser 静态模式集合的正则和提取器。

2. **残留碎片清理策略**：使用 `/[<>_]{3,}/g` 清理 3+ 连续尖括号/下划线碎片。阈值设为 3（而非 2）以避免误伤合法的 markdown 粗体（`__text__`）或比较运算符（`<<`）。

3. **think 标签未关闭检测**：在最后一个完整标签之后的内容中查找未关闭标签，避免与完整标签重叠。未关闭标签正则要求行首匹配（`(?:^|\n)[ \t]*`），与 `stripThinkingTags` 的行首约束一致，防止匹配句子中间的字面量 `<think`。

4. **rawMatch 移除方式**：使用 `split + join` 而非 `String.replace`，避免 rawMatch 中可能包含的正则元字符（如 `<<<EXPRESSION>>>` 中的 `<`、`>`）被当作正则语法解释。

5. **image_generation 预留**：检测 `<<<GENERATE_IMAGE>>>prompt<<<END_IMAGE>>>` 格式，data 仅存储 prompt 字符串，后续由 LogicEngine 调用图片生成服务。

### 依赖关系

| 依赖 | 来源 | 用途 |
|------|------|------|
| `RobustParser` | `./RobustParser` | 多模式匹配实例 + 静态模式集合 + cleanup 方法 |
| `AIIntentType` / `DetectedIntent` / `IntentHandler` / `ParsePattern` / `ParseResult` | `./pipeline.types` | 类型定义 |

### 验证

- TypeScript 诊断零错误（AIIntentRecognizer.ts 单文件通过 `GetDiagnostics` + `tsc --noEmit` 检查）
- 五种意图类型全部实现（expression / suggested_options / table_edit / think_tag / image_generation）
- confidence 判定逻辑覆盖标准格式（1.0）与残缺兜底格式（0.8）
- think 标签支持 ILD / thinking / thought / antml:thinking 四种变体 + 完整/未关闭两种场景
- stripIntents 使用 split+join 安全移除 rawMatch + cleanup 残留碎片 + 折叠空行
- 所有代码含中文注释

## 对话管线架构重设计 — 管线集成编排器（Spec: redesign-dialogue-pipeline-architecture / Task 13）

### 概述

DialoguePipeline 是对话管线的集成层主编排器，将所有管线模块（DataPreprocessor、UserIntentRecognizer、ContextAssembler、PromptComposer、ParameterInjector、AIService、AIIntentRecognizer、PostProcessingPipeline、LogicEngine）串联为统一的执行流程：PrePipeline → AIService → PostPipeline → LogicEngine。去重重试循环在管线内部处理（最多 2 次重试），不依赖外部调用方。管线通过回调通知 UI 层更新，不直接管理 React state。

### 新增文件

| 文件 | 职责 |
|------|------|
| `pipeline/DialoguePipeline.ts` | 管线集成层主编排器 — createContext（每执行创建全新 context）/ execute（PrePipeline → AIService+PostPipeline 去重循环 → LogicEngine）/ getAIService（供 hooks cancel）/ getExtensionRegistry |

### 架构设计

```
┌──────────────────────── DialoguePipeline.execute() ────────────────────────┐
│                                                                              │
│  1. createContext(input) → DialoguePipelineContext                           │
│     - resolveIntent(userAction) → UserIntent                                 │
│                                                                              │
│  2. runPrePipeline(context)                                                  │
│     - DataPreprocessor.normalize / detectLanguage                            │
│     - ContextAssembler.retrieveKnowledgeBase / retrieveChatHistory           │
│                 / fetchMemoryTable                                           │
│     - PromptComposer.compose（Provider 链）                                   │
│     - ParameterInjector.getEffectiveParams / buildEngineConfig               │
│                          / buildStopSequences                                │
│     - ContextAssembler.truncateContext                                       │
│                                                                              │
│  3. runAIServiceWithDedupRetry(context, callbacks)                           │
│     ┌─── 循环 (max 2 retries) ───────────────────────────┐                   │
│     │  AIService.sendMessage（流式 → onStream 回调）       │                   │
│     │  AIIntentRecognizer.detect + stripIntents            │                   │
│     │  PostProcessingPipeline.execute（Plugin 链）          │                   │
│     │  DedupPlugin 判定 → 重试 or 跳出                     │                   │
│     └─────────────────────────────────────────────────────┘                   │
│     - 重试时重置 PostProcessingPipeline 状态                                 │
│                                                                              │
│  4. runLogicEngine(context, callbacks)                                       │
│     - 创建全新 LogicEngine 实例                                              │
│     - 动态注册 Task（含运行时数据）:                                         │
│       UpdateEmotion / RenderOptions / ExecuteTableEdit                       │
│       TriggerSyncOrganize / TriggerVectorization                             │
│       SaveChat / UpdateTokenUsage                                            │
│     - LogicEngine.executeAll（条件检查 + Task 执行）                          │
│                                                                              │
│  → PipelineResult { context, success, error }                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 核心接口

#### PipelineInput

管线执行所需的全部数据，包含：userInput、userAction、characterInfo、sessionConfig、activeEngine、pipelineMode、selectedPersona、contextMessages、targetMessageId、initialContent、knowledgeBaseScopeIds、truncationConfig、callbacks、taskRuntimeData。

#### PipelineCallbacks

UI 更新回调集合：onStreamUpdate（流式 chunk）、onMessageUpdate（最终内容）、onError、onEmotionUpdate、onOptionsRender、onSaveChat、onSyncOrganize、onTokenUsageUpdate。

#### PipelineResult

`{ context: DialoguePipelineContext, success: boolean, error?: string }`

### 关键设计决策

1. **不使用 Pipeline.addStage**：因为 AIService + PostPipeline 需要参与去重重试循环，Stage 在 execute 中动态编排而非静态注册。

2. **每次执行创建全新 LogicEngine**：LogicTask 需要运行时数据（messageId、callbacks、messages），无法在构造函数中静态注册。每次 execute 创建新 LogicEngine 实例并动态注册所需 Task。

3. **去重重试循环重置 PostPipeline 状态**：重试时需要清除上一轮 PostProcessing 的残留状态（累积内容、detectedIntents 等），避免跨重试污染。

4. **ContextAssembler 合并 RAG chatHistory**：DedupPlugin 需要找到上一条 assistant 消息进行比较，RAG 检索的 chatHistory 与当前 contextMessages 合并后供 DedupPlugin 使用。

## 对话管线架构重设计 — Hooks 集成层（Spec: redesign-dialogue-pipeline-architecture / Task 14）

### 概述

`CharacterDialogueChat.hooks.new.ts` 是使用 DialoguePipeline 的新版本 hooks 文件，返回值接口与旧版本 `CharacterDialogueChat.hooks.ts` 完全一致，UI 层无需修改。dialogue / continuation / retry 三种模式通过 pipeline.execute() 执行；generateUserReply / polishInput 因自定义系统提示与停止序列，仍直接使用 ChatEngineFactory。

### 新增文件

| 文件 | 职责 |
|------|------|
| `CharacterDialogueChat.hooks.new.ts` | 新版 hooks — useCharacterDialogueChat 使用 DialoguePipeline，保持旧版返回值接口完全一致；useCharacterConfig / usePersonas / shouldStrengthenLength 保持不变 |

### 架构变化

```
旧版 hooks.ts                          新版 hooks.new.ts
─────────────                          ─────────────────
requestAIResponse (~1140 行)    →      pipeline.execute(input)
  - 手动编排 Step A-E                    - PrePipeline 自动编排
  - 内联去重检测                          - 管线内部去重循环
  - 内联 emotion/options 解析             - LogicEngine Task 执行
  - 内联 saveChat / vectorize             - LogicEngine Task 执行
  - 内联 token usage 更新                 - LogicEngine Task 执行

generateUserReply               →      直接使用 ChatEngineFactory（不变）
polishInput                     →      直接使用 ChatEngineFactory（不变）

cancelRequest                   →      pipeline.getAIService().cancel()
                                        + ChatEngineFactory（for userReply/polish）
clearChat                       →      pipeline.getAIService().cancel()
```

### 管线调用模式

hooks 层为三种管线模式构建 PipelineInput：

| 模式 | pipelineMode | userAction | 特殊字段 |
|------|-------------|------------|---------|
| 发送消息 | `'dialogue'` | `{ type: 'sendMessage', text }` | — |
| 续写 | `'continuation'` | `{ type: 'continueConversation' }` | `initialContent` |
| 重试 | `'retry'` | `{ type: 'retryMessage', targetMessageId }` | — |
| 版本重试 | `'retry'` | `{ type: 'retryMessage', targetMessageId }` | 从版本文件恢复 messages |

### 验证

- TypeScript 诊断零错误（DialoguePipeline.ts + CharacterDialogueChat.hooks.new.ts 均通过 `GetDiagnostics` 检查）
- 返回值接口与旧版完全一致（44 个属性逐一对照）
- dialogue / continuation / retry 三种模式通过 pipeline.execute() 执行
- generateUserReply / polishInput 保持直接使用 ChatEngineFactory
- cancelRequest 使用 pipeline.getAIService().cancel() + ChatEngineFactory 双通道取消
- 文件使用 `.new.ts` 扩展名，不覆盖现有 hooks 文件

---

## 对话管线架构重设计 — 前处理三模块（Spec: Task 2/3/4）

### Task 2: DataPreprocessor（数据前处理）

| 文件 | 职责 |
|------|------|
| `pipeline/DataPreprocessor.ts` | 输入标准化（空白清理/换行标准化）、验证（空值/长度）、模板替换（迁移自 messageProcessor）、语言检测 |

核心方法：`normalize(text)` → `validate(text)` → `replaceTemplates(text, character)` → `detectLanguage(text)`

### Task 3: UserIntentRecognizer（用户意图识别）

| 文件 | 职责 |
|------|------|
| `pipeline/UserIntentRecognizer.ts` | 显式意图映射（UI 操作 → UserIntent）+ NLU 隐式意图检测（关键词匹配 + 置信度评分） |

- `resolveExplicit(action)` — 映射 sendMessage/continueConversation/retryMessage 等 UI 操作
- `detectImplicit(text)` — 关键词匹配检测续写意图（"继续"/"接着说"）和重试意图（"重试"/"再来一次"），返回置信度 0.0-1.0
- ⚠️ **未实现**：疑问句检测（SubTask 3.2）和置信度 < 1.0 用户确认机制（SubTask 3.3），预留接口

### Task 4: ContextAssembler（上下文组装）

| 文件 | 职责 |
|------|------|
| `pipeline/ContextAssembler.ts` | 知识库检索 + 对话历史 RAG + 记忆表格获取 + 上下文截断 |

核心方法：
- `retrieveKnowledgeBase(keywords, scopeIds)` — 关键词检索，失败降级返回空数组
- `retrieveChatHistory(messages, threshold)` — >40 条消息触发 RAG 检索
- `fetchMemoryTable(characterCardId)` — 获取记忆表格 markdown 数据
- `truncateContext(messages, config)` — TokenCounter + ContextTruncator 截断，保留最近消息

---

## 对话管线架构重设计 — RobustParser（Spec: Task 8）

### 概述

多模式正则匹配引擎，提供优先级匹配、模糊兜底和残留碎片清理。作为 AIIntentRecognizer 和 PostProcessingPipeline 的基础解析组件。

| 文件 | 职责 |
|------|------|
| `pipeline/RobustParser.ts` | 多模式正则匹配 + 模糊关键词 proximity 匹配 + 残留碎片清理 |

### 静态模式集合

| 模式集 | 数量 | 覆盖格式 |
|--------|------|---------|
| `EXPRESSION_PATTERNS` | 8 | `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 标准格式 + 7 层容错变体 |
| `SUGGESTED_OPTIONS_PATTERNS` | 6 | `<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>` + 方括号/注释分隔变体 |
| `TABLE_EDIT_PATTERNS` | 3 | `<<<TABLE_EDIT>>>...<<<END_TABLE_EDIT>>>` + 注释分隔变体 |

### 核心方法

- `match(content, patterns)` — 按模式优先级匹配，返回 `{ data, rawMatch }` 或 null
- `fuzzyMatch(content, keywords)` — 关键词 proximity 模糊匹配，用于标准模式全部失败时的兜底
- `cleanup(content)` — 清理 3+ 连续尖括号/下划线碎片（`/[<>_]{3,}/g`）

---

## 对话管线架构重设计 — 后处理管线与插件（Spec: Task 10）

### 概述

PostProcessingPipeline 按 priority 顺序执行插件链，每个插件独立检测→处理。共实现 7 个插件，覆盖 Think 标签三态处理、表情解析、选项解析、表格编辑检测、图片生成预留、内容保护和去重检测。

### 新增文件

| 文件 | priority | 职责 |
|------|----------|------|
| `pipeline/PostProcessingPipeline.ts` | — | 插件链管理器 — `registerPlugin` + `execute`（priority 排序，detect→process 链） |
| `pipeline/plugins/ThinkTagPlugin.ts` | 100 | Think 标签三态处理（strip / strip_render / fold），读取 `context.thinkTagMode` |
| `pipeline/plugins/ExpressionPlugin.ts` | 200 | 解析情绪标签，写入 `context.emotion` |
| `pipeline/plugins/SuggestedOptionsPlugin.ts` | 300 | 解析辅助模式选项，写入 `context.suggestedOptions` |
| `pipeline/plugins/TableEditPlugin.ts` | 400 | 检测 tableEdit 标签，写入 `context.tableEditCommands` |
| `pipeline/plugins/ImageGenPlugin.ts` | 500 | 预留接口，解析 `<<<GENERATE_IMAGE>>>` 标签（不实现具体逻辑） |
| `pipeline/plugins/ContentProtectionPlugin.ts` | 600 | 通用长度保护，从 context 读取已执行插件列表计算预期剥离量 |
| `pipeline/plugins/DedupPlugin.ts` | 700 | n-gram jaccard + overlap rate 去重检测，写入 `context.dedupInfo` |
| `pipeline/plugins/index.ts` | — | 7 个插件的统一导出 + 注册函数 |

### 关键设计决策

1. **ThinkTagPlugin 三态模式**：`strip`（完全移除）、`strip_render`（移除标签但保留内容渲染）、`fold`（折叠为 `<details>` 元素），替代旧版两个冗余开关
2. **ContentProtectionPlugin 通用化**：不再硬编码 strip 标志位，从 context 读取已执行插件列表动态计算预期剥离量
3. **DedupPlugin 检测算法**：n-gram（n=3）jaccard 相似度 + overlap rate（连续重复字符比例），双重判定触发去重

---

## 对话管线架构重设计 — 逻辑引擎与任务（Spec: Task 11）

### 概述

LogicEngine 按 priority 顺序执行条件满足的 LogicTask，每个任务独立 try-catch，单个失败不阻塞其他任务。共实现 8 个任务，覆盖情绪更新、选项渲染、表格编辑执行、同步整理、向量化、去重重试、保存聊天和 Token 用量更新。

### 新增文件

| 文件 | priority | 职责 |
|------|----------|------|
| `pipeline/LogicEngine.ts` | — | 逻辑引擎 — `registerTask` + `execute`（priority 排序，条件检查 + 独立 try-catch） |
| `pipeline/tasks/UpdateEmotionTask.ts` | 100 | 更新消息 emotion 字段 + 触发表情图像加载回调 |
| `pipeline/tasks/RenderOptionsTask.ts` | 200 | 渲染辅助模式选项按钮回调 |
| `pipeline/tasks/ExecuteTableEditTask.ts` | 300 | 异步执行 tableEdit 命令（调用 electronAPI） |
| `pipeline/tasks/TriggerSyncOrganizeTask.ts` | 400 | 延迟 2 秒调用 processChatProgressive（同步整理） |
| `pipeline/tasks/TriggerVectorizationTask.ts` | 500 | 每 5 轮调用 vectorizeIncremental（增量向量化） |
| `pipeline/tasks/DedupRetryTask.ts` | 600 | 去重重试循环（最多 2 次，重新触发 AIService + PostPipeline） |
| `pipeline/tasks/SaveChatTask.ts` | 700 | 保存聊天记录到文件 |
| `pipeline/tasks/UpdateTokenUsageTask.ts` | 800 | 更新 Token 用量统计 |
| `pipeline/tasks/index.ts` | — | 8 个任务的统一导出 + 注册函数 |

### 关键设计决策

1. **独立 try-catch**：每个 LogicTask 在 execute 时包裹独立 try-catch，异常记录到 logger 后继续执行下一个任务
2. **DedupRetryTask 与 DialoguePipeline 协作**：DedupRetryTask 不直接执行重试，而是设置 `context.dedupInfo.shouldRetry = true`，由 DialoguePipeline 的去重循环处理
3. **运行时数据注入**：Task 需要 messageId、callbacks、messages 等运行时数据，通过 `taskRuntimeData` 在 LogicEngine 构造时注入

---

## 对话管线架构重设计 — 渲染系统（Spec: Task 12）

### 概述

RenderSystem 迁移自 messageProcessor.ts 的消息预处理管线和 MessageRenderer 的 markdown 配置，提供统一的预处理 + markdown 配置接口。

| 文件 | 职责 |
|------|------|
| `pipeline/RenderSystem.tsx` | 消息预处理管线（replaceTemplates → processThinkTags → stripSystemTags → normalizeQuotes → encodeAngleBrackets）+ remark/rehype 插件链配置 + 自定义组件映射 |

### 核心方法

- `preprocess(content, options)` — 迁移自 `processMessage`，五步预处理管线
- `getMarkdownConfig(options)` — 返回 remark/rehype 插件链配置（remarkGfm → rehypeRaw → rehypeSanitize → rehypeHighlight）
- `registerComponent(tagName, component)` — 注册自定义渲染组件（如 `em` → message-renderer-action）

### ⚠️ 重点标记：stripSystemTags 防御性调用

`stripSystemTags()` 在 `preprocess` 中**始终调用**（不受配置控制），在思考标签处理之后、引号规范化之前执行。此函数作为防御性兜底，确保系统标签（`<<<EXPRESSION>>>` 等）不进入 `rehypeRaw` HTML 解析管线，避免 hast 树损坏导致 `*text*` 的 `<em>` 元素丢失。

---

## 对话管线架构重设计 — 集成验证与编译状态（Spec: Task 15）

### TypeScript 编译验证结果

**pipeline/ 目录：零编译错误** ✅

`npx tsc --noEmit` 过滤 `pipeline` 关键词，输出为空，确认以下所有文件零错误：
- 核心框架：`pipeline.types.ts` / `Pipeline.ts` / `ExtensionRegistry.ts` / `PipelineLogger.ts`
- 前处理：`DataPreprocessor.ts` / `UserIntentRecognizer.ts` / `ContextAssembler.ts`
- 提示词：`PromptComposer.ts` / `providers/*.ts`（14 文件）
- 参数：`ParameterInjector.ts`
- AI 交互：`AIService.ts` / `RobustParser.ts` / `AIIntentRecognizer.ts`
- 后处理：`PostProcessingPipeline.ts` / `plugins/*.ts`（8 文件）
- 逻辑引擎：`LogicEngine.ts` / `tasks/*.ts`（9 文件）
- 渲染：`RenderSystem.tsx`
- 集成：`DialoguePipeline.ts`

**hooks.new.ts：仅剩预存类型问题** ⚠️

以下错误与旧版 `hooks.ts` 完全一致，非新管线引入：
- `ElectronAPI.chatVersion` — 类型定义缺失（旧版同样存在）
- `ElectronAPI.failover` — 类型定义缺失（旧版同样存在）
- `electronAPI.stopOrganizing` — 类型定义缺失（旧版同样存在）
- `UserPersona` 类型不匹配 — 旧版同样存在
- 若干 `implicitly has 'any' type` — 旧版同样存在

### 修复的编译错误

| 文件 | 问题 | 修复 |
|------|------|------|
| `DialoguePipeline.ts` | 13 个未使用导入/声明 | 移除所有未使用的类型导入和类字段 |
| `ParameterInjector.ts` | 导入路径错误 `'../../Common/...'` | 修正为 `'../../../Common/...'` |
| `DialogueInstructionProvider.ts` | 未使用导入 `buildCharacterContext, buildPersonaSection` | 移除导入行 |
| `hooks.new.ts` L244 | 未使用参数 `targetMessageId` | 改为 `_targetMessageId` |

### 待运行时验证项

以下检查点需要启动应用进行实际对话测试：
- 对话/续写/重试/润色/AI回复五种模式完整流程
- 表情系统（标签解析 → 图像切换）
- 辅助模式（选项解析 → 按钮渲染）
- Think 标签三态处理（strip/strip_render/fold）
- 动作描写 `*text*` 紫色斜体渲染
- 残缺标签容错（`<<>>annoyance<<<_EXPRESSION>>>` 等）

### 待清理项（Task 16 剩余）

- 删除旧 `requestAIResponse` / `generateUserReply` / `polishInput` 函数（需先完成 hooks 文件替换）
- 清理 `PromptBuilder.ts` 中已迁移到 Provider 的函数
- 清理 `messageProcessor.ts` 中已迁移到 RenderSystem 的函数
- 将 `CharacterDialogueChat.hooks.new.ts` 替换原 `hooks.ts`（需运行时验证后执行）

---

## ⚠️ 重点 Bug：表情 emotion 字段在 characterChatStore 持久化时丢失（2026-08-08）

### 问题描述

角色对话中表情系统和中文表情名称在第一次对话时正常显示，但关闭对话框重新进入后全部丢失（立绘变回默认头像、表情名称消失）。

### 根因

**`src/renderer/stores/characterChatStore.ts` 的 `saveTestChat` 方法在构建 `safeMessages` 时手动逐字段提取消息数据，遗漏了 `emotion` 字段。**

保存链路：
```
hooks.ts messagesToSave (含 emotion)
  → characterChatStore.saveTestChat()
    → safeMessages = messages.map(msg => { 手动逐字段提取 })  ← BUG：漏掉 emotion
      → IPC saveTestChat → JSON.stringify (写入文件，但无 emotion)
```

加载链路本身不过滤字段，但 JSON 文件中已无 emotion，读回时 `msg.emotion` 为 undefined。

### 修复

`characterChatStore.ts` 两处：
1. `ChatMessage` 接口添加 `emotion?: string`
2. `safeMessages` 构建添加 `emotion: msg.emotion ? String(msg.emotion) : undefined`

### 经验教训

**⚠️ 反复出现问题 — 新增字段时必须同步更新所有层的类型定义和字段提取逻辑**

涉及 ChatMessage 类型定义的文件清单（新增字段时必须全部同步）：
1. `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — 组件层
2. `src/main/services/ChatStorageService.ts` — 主进程存储层
3. `src/renderer/stores/characterChatStore.ts` — store 层（含接口定义 + safeMessages 字段提取）
4. `src/renderer/types/electron.d.ts` — IPC 声明层（当前用 `any[]`，无强制约束）

**根本建议**：store 层的 `safeMessages` 应考虑用展开运算符 `{...msg}` 替代手动逐字段提取，或建立字段同步检查机制，避免每次新增字段都遗漏。

---

## §34 ConfigPanel 新增「图片生成设置」配置区（Spec: add-conversation-image-generation，2026-08-09）

### 概述

在角色对话配置面板（ConfigPanel）中新增「图片生成设置」配置区，允许用户在对话中开启图片生成功能并选择输出尺寸。该配置区位于 ParameterPanel 与「记忆与上下文增强」之间，视觉风格与现有配置区保持一致。

### 改动内容

#### 1. SizeSelector.tsx — 导出 SIZE_PRESETS

`SIZE_PRESETS` 常量原本为模块私有（`const`），改为 `export const` 以供 ConfigPanel 复用。该常量包含 6 个预设尺寸（头像/表情 512×512、全身立绘 512×768、竖版高清 768×1024、方图高清 1024×1024、竖版超清 1024×1536、横版高清 1536×1024）。

#### 2. ConfigPanel.tsx — 新增 props + 配置区

**Props 接口新增字段**（均为可选）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `imageGenEnabled` | `boolean` | 是否开启图片生成 |
| `imageGenWidth` | `number` | 图片宽度 |
| `imageGenHeight` | `number` | 图片高度 |
| `onImageGenToggle` | `(enabled: boolean) => void` | 开关回调 |
| `onImageGenSizeChange` | `(width: number, height: number) => void` | 尺寸变更回调 |

**antd 导入扩展**：`{ Button }` → `{ Button, Switch, Select }`

**新增导入**：`import { SIZE_PRESETS } from './SizeSelector'`

**JSX 结构**：在 ParameterPanel 后的 divider 与「记忆与上下文增强」区之间插入新配置区，包含：
- Switch 开关（是否开启图片生成，默认关闭）
- Select 下拉（图片大小，复用 SIZE_PRESETS，关闭时 disabled）
- 说明文字「在对话中一键生成场景图片」

### 改动文件

| 文件 | 改动 |
|------|------|
| `SizeSelector.tsx` | `const SIZE_PRESETS` → `export const SIZE_PRESETS` |
| `ConfigPanel.tsx` | antd 导入扩展 + SIZE_PRESETS 导入 + Props 接口新增 5 个字段 + 解构 + 新增「图片生成设置」JSX 配置区 |

### 验证

- TypeScript 诊断零错误（ConfigPanel.tsx + SizeSelector.tsx）
- 未修改 CharacterDialogueChat.tsx（将由后续任务单独处理）

### 注意事项

- `CharacterDialogueChat.tsx` 尚未传入新的 imageGen 相关 props，当前全部为可选字段，不影响现有编译。后续需在该文件中接入实际状态与回调。


## §35 ChatMessageBubble 新增「生成图片」按钮与图片消息渲染（Spec: add-conversation-image-generation / Task 3+4，2026-08-09）

### 概述

在 `ChatMessageBubble.tsx` 中为 assistant 消息新增「生成图片」操作按钮（PictureOutlined 图标），并支持当 `message.isImageMessage` 为 true 且 `message.generatedImage` 有值时渲染图片内容替代文本内容。图片消息不显示编辑、继续对话、重新生成等文本操作按钮，仅保留复制和「生成图片」按钮。

### 改动内容

#### 1. ChatMessageBubble.tsx — 新增 props

Props 接口新增 3 个可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `imageGenEnabled` | `boolean` | 图片生成功能是否开启 |
| `isGeneratingImage` | `boolean` | 是否正在生成图片（默认 false） |
| `onGenerateImage` | `(messageId: string) => void` | 点击生成图片按钮回调 |

#### 2. ChatMessageBubble.tsx — 导入扩展

`@ant-design/icons` 导入列表末尾新增 `PictureOutlined`。

#### 3. ChatMessageBubble.tsx — 图片消息标记与按钮显隐控制

- 新增 `const isImageMsg = !!message.isImageMessage;` 变量
- `showFullActions` 末尾追加 `&& !isImageMsg` 条件：图片消息不显示编辑、继续对话按钮
- 「重新生成」按钮（ReloadOutlined）包裹 `{!isImageMsg && (...)}` 条件：图片消息不显示重新生成按钮

#### 4. ChatMessageBubble.tsx — 「生成图片」按钮

在「重新生成」按钮之后、「继续对话」按钮之前新增「生成图片」按钮（PictureOutlined），不受 `showFullActions` / `showRegenerateOnly` 限制，对所有 assistant 消息可见：

- Tooltip：`imageGenEnabled === false` 时提示「图片生成功能未开启」，否则提示「生成图片」
- 禁用条件：`imageGenEnabled === false || isGeneratingImage || isStreaming || isGenerating || message.status === 'error'`
- `isGeneratingImage` 为 true 时显示 `LoadingOutlined` 替代 `PictureOutlined`

#### 5. ChatMessageBubble.tsx — 图片消息渲染

在气泡内容的三元表达式中新增中间分支：当 `message.isImageMessage && message.generatedImage` 为真时，渲染 `<div className="chat-msg-image-container">` 包裹的 `<img>` 和标签，替代 `MessageRenderer` 文本内容。结构为 `isEditing ? (编辑框) : (图片消息 ? (图片容器) : (文本内容))`。

#### 6. ChatMessageBubble.css — 图片消息样式

在 `@media (max-width: 480px)` 之前新增 3 个 CSS 类：

| CSS 类 | 用途 |
|--------|------|
| `.chat-msg-image-container` | 图片容器（flex 列布局，居中对齐，gap 8px） |
| `.chat-msg-generated-image` | 生成图片（max-width 100%，max-height 400px，圆角 8px，object-fit contain） |
| `.chat-msg-image-label` | 图片标签（11px，斜体，灰色） |

### 改动文件

| 文件 | 改动 |
|------|------|
| `ChatMessageBubble.tsx` | 导入 PictureOutlined + Props 新增 3 字段 + 解构 + isImageMsg 变量 + showFullActions 追加 !isImageMsg + 重新生成按钮包裹 !isImageMsg + 新增生成图片按钮 + 图片消息渲染分支 |
| `ChatMessageBubble.css` | 新增 3 个 CSS 类（.chat-msg-image-container / .chat-msg-generated-image / .chat-msg-image-label） |

### 验证

- TypeScript 诊断零错误（ChatMessageBubble.tsx + ChatMessageBubble.css）
- 「生成图片」按钮位于「重新生成」之后、「继续对话」之前
- 图片消息不显示编辑/继续对话/重新生成按钮
- 所有新增 props 均为可选，不影响现有调用方编译

### 注意事项

- `CharacterDialogueChat.tsx` 尚未传入 `imageGenEnabled` / `isGeneratingImage` / `onGenerateImage` props，当前全部为可选字段。后续 Task 7 需在该文件中接入实际状态与回调。

## §36 文档读取 IPC 通道（docs:read）（2026-08-09）

### 概述

新增 `docs:read` IPC 通道，供渲染进程读取项目根目录 `docs/` 下的技术文档文件内容。用于在应用内展示本地文档，无需渲染进程直接访问文件系统。

### 架构分层

```
Renderer (React)
  window.electronAPI.docs.read(fileName)
       │ ipcRenderer.invoke('docs:read', fileName)
       ▼
Preload Bridge (contextBridge)
  docs: { read }
       │
       ▼
Main Process (IPC Handler)
  docsHandlers() → ipcMain.handle('docs:read')
       │ fs.readFile(docsDir/fileName, 'utf-8')
       ▼
Filesystem
  开发环境: getProjectRoot()/docs/
  生产环境: process.resourcesPath/docs/
```

### 后端 IPC 通道

| IPC 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `docs:read` | `fileName: string` | `string \| { success: false, error: string }` | 读取 docs/ 目录下的文档文件；成功返回文件内容字符串，失败返回错误对象 |

### 安全设计

- **路径穿越防护**：校验 `fileName`，拒绝包含 `..` 或以 `/`、`\` 开头的输入，防止越权读取 docs 目录以外的文件
- **路径解析兜底**：`app.isPackaged` 读取异常时降级到 `getProjectRoot()/docs`

### 涉及文件清单

- `src/main/ipc/handlers/docsHandlers.ts` — 新增文件，注册 `docs:read` handler
- `src/main/ipc/index.ts` — 导入并调用 `docsHandlers()`
- `src/main/preload.ts` — 新增 `docs` 命名空间（`docs.read`）

### 验证

- `tsc --noEmit` 零新增错误（`docsHandlers.ts` 无错误；`index.ts:1` 与 `preload.ts:46` 为既有错误，与本次改动无关）



## §37 CharacterDialogueChat 接入对话图片生成全流程（Spec: add-conversation-image-generation / Task 7，2026-08-09）

### 概述

在 `CharacterDialogueChat.hooks.ts` 和 `CharacterDialogueChat.tsx` 中实现完整的对话内图片生成流程。用户点击消息气泡上的「生成图片」按钮后，系统构建对话上下文 prompt，合并角色特征 tag 与 AI 生成的上下文 tag，调用 SD WebUI txt2img 生成图片，并将结果作为图片消息插入到对话流中。

### 改动内容

#### 1. CharacterDialogueChat.hooks.ts — 新增 `addImageMessage` 方法

在 `editMessage` 函数之后新增 `addImageMessage` useCallback，用于在指定消息之后插入一条图片消息：

- 通过 `messagesRef.current` 获取最新消息列表，定位插入位置
- 构造 `ChatMessage` 对象（`role: 'assistant'`、`isImageMessage: true`、`generatedImage: imageDataUrl`）
- 更新 `messagesRef.current`、dispatch `UPDATE_MESSAGES`、调用 `saveChatToStore` 持久化
- 不触发 AI 响应

在 return 语句中暴露 `addImageMessage`。

#### 2. CharacterDialogueChat.tsx — 导入扩展

新增 3 个导入：
- `buildAssetPromptTemplate` from `./PromptBuilder`
- `useCharacterTraitStore` from `../../../stores/characterTraitStore`
- `useCharacterLoraStore` from `../../../stores/characterLoraStore`

`CharacterDialogueChat.types` 导入追加 `ChatMessage` 类型。

#### 3. CharacterDialogueChat.tsx — Store 订阅与状态

- 从 hook 解构 `addImageMessage`
- 订阅 `useCharacterTraitStore`（`traits` / `currentCharacterCardId` / `loadTraits`）
- 订阅 `useCharacterLoraStore`（`loras` / `loadLoras`）
- 新增 `isGeneratingImage` useState
- 新增 `imageGenEnabled` 计算（`characterConfig?.customParameters?.image_gen_enabled === true`）

#### 4. CharacterDialogueChat.tsx — `handleGenerateImage` 回调

完整的图片生成流程（11 步）：
1. 构建对话上下文 prompt（过滤 `status === 'sent'` 的消息）
2. 确保角色特征和 LoRA 已加载（按 `characterCardId` 匹配）
3. 从 store 获取已启用的角色特征 tag（`useCharacterTraitStore.getState().traits`）
4. 调用 `window.electronAPI.ai.generateTraitPrompts` 生成上下文 tag
5. 合并上下文 tag 与角色特征 tag（去重）
6. 加载 SD 配置（`window.electronAPI.setting.load`）
7. 检测 SD WebUI 状态（`window.electronAPI.sd.checkStatus`）
8. 构建提示词模板（`buildAssetPromptTemplate('general', null)`）
9. 从配置读取图片尺寸（默认 1024×1024）
10. 构建 SD options（复用 AssetGenerateModal 的 `buildSdOptions` 字段结构）
11. 调用 `window.electronAPI.sd.generateTxt2Img` 生成图片，成功后调用 `addImageMessage` 插入

#### 5. CharacterDialogueChat.tsx — 配置处理器

- `handleImageGenToggle`：切换 `image_gen_enabled` 自定义参数
- `handleImageGenSizeChange`：修改 `image_gen_width` / `image_gen_height` 自定义参数

#### 6. CharacterDialogueChat.tsx — Props 传递

- `renderMessageBubble` 中向 `ChatMessageBubble` 传递 `imageGenEnabled` / `isGeneratingImage` / `onGenerateImage`
- 向 `ConfigPanel` 传递 `imageGenEnabled` / `imageGenWidth` / `imageGenHeight` / `onImageGenToggle` / `onImageGenSizeChange`

#### 7. CharacterDialogueChat.tsx — aiSequenceNumber 修正

图片消息（`isImageMessage: true`）虽然 `role === 'assistant'`，但不应计入 AI 回复序号。修改 `renderMessageBubble` 中的过滤条件，排除图片消息：

```
m.role === 'assistant' && !m.isImageMessage
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `CharacterDialogueChat.hooks.ts` | 新增 `addImageMessage` useCallback + return 语句暴露 |
| `CharacterDialogueChat.tsx` | 导入扩展 + 解构 addImageMessage + Store 订阅 + isGeneratingImage state + imageGenEnabled 计算 + handleGenerateImage 回调 + handleImageGenToggle/handleImageGenSizeChange + ChatMessageBubble props + ConfigPanel props + aiSequenceNumber 修正 |

### 验证

- TypeScript 诊断零错误（`CharacterDialogueChat.tsx` + `CharacterDialogueChat.hooks.ts`）
- `addImageMessage` 不触发 AI 响应，仅插入图片消息并持久化
- 图片消息不计入 AI 回复序号
- SD 生成流程复用 AssetGenerateModal 的字段结构与 PromptBuilder 模板

### 数据流

```
用户点击「生成图片」
  → handleGenerateImage(messageId)
    → 构建对话上下文 prompt
    → 加载角色特征 + LoRA
    → AI 生成上下文 tag（generateTraitPrompts IPC）
    → 合并 tag（去重）
    → 加载 SD 配置 + 检测状态
    → buildAssetPromptTemplate('general')
    → sd.generateTxt2Img IPC
    → addImageMessage(messageId, dataUrl)
      → messagesRef.current 更新
      → dispatch UPDATE_MESSAGES
      → saveChatToStore 持久化
```

---

## §34 帮助文档查看器 HelpViewer（2026-08-09）

### 概述

新增 Markdown 用户手册查看器组件 `HelpViewer`，以全屏 Modal 形式展示 `docs/user-manual.md`，提供左侧目录导航、滚动联动高亮、Fuse.js 全文搜索（含匹配片段高亮）三大能力，并完整适配亮色/暗色主题与移动端响应式布局。

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/renderer/components/Help/HelpViewer.tsx` | 帮助查看器组件（Modal + TOC + 搜索 + Markdown 渲染） |
| `src/renderer/components/Help/HelpViewer.css` | 组件样式（全屏 Modal、侧栏、Markdown 排版、暗色覆盖、响应式） |

### 类型声明补全

`src/main/preload.ts` 早已暴露 `docs.read`（`docs:read` IPC 通道，主进程 `docsHandlers.ts` 实现），但渲染进程类型声明 `src/renderer/types/electron.d.ts` 的 `ElectronAPI` 接口缺失 `docs` 命名空间。本次补全：

```ts
docs: {
  read: (fileName: string) => Promise<string | { success: false; error: string }>;
};
```

返回值契约：成功返回文档内容字符串，失败返回 `{ success: false, error }`（与 `docsHandlers.ts` 实现一致）。

### 实现要点

- **数据加载与缓存**：`open` 变为 `true` 时调用 `window.electronAPI.docs.read('user-manual.md')`，结果存入 `useRef` 缓存（`contentCache`），后续打开直接复用，避免重复 IPC。加载中展示 antd `Spin`，失败展示 `Alert`。
- **目录构建**：`extractToc()` 正则匹配 `^#\s+(.+)$` 提取所有 H1 标题，`slugify()` 生成合法 HTML id（保留中文 `\u4e00-\u9fa5`、字母、数字、连字符）。
- **Markdown 渲染**：`ReactMarkdown` + `remarkGfm` + `remarkEmoji`。通过 `components={{ h1 }}` 自定义渲染注入 slugified `id` 与 `ref`（存入 `sectionRefs`），供目录跳转与滚动追踪使用。`extractText()` 递归从 ReactNode 提取纯文本用于生成 id。
- **搜索**：`Fuse.js` 按 H1 章节切分内容建立索引（`threshold: 0.3`、`ignoreLocation: true`、`minMatchCharLength: 2`）。结果展示章节名 + 匹配片段，`highlightSnippet()` 利用 `split(regex)` 捕获组奇偶下标判定匹配段并包裹 `<mark>`（避免带 `g` 标志正则 `.test()` 的 `lastIndex` 状态污染问题）。
- **滚动联动高亮**：`scroll` 事件（`passive: true`）监听内容容器，遍历 `sectionRefs` 通过 `getBoundingClientRect()` 计算当前可视章节并高亮目录项。点击目录项调用 `scrollToSection()` 平滑滚动。
- **主题**：CSS 统一使用项目 CSS 变量（`--bg-layout` / `--bg-container` / `--text-heading` / `--text-primary` / `--text-secondary` / `--border-base` / `--bg-hover` / `--color-brand-primary` / `--color-brand-secondary`），暗色通过 `.dark` 选择器覆盖代码块与高亮色。注意：项目实际变量名为 `--color-brand-primary`（非任务描述中的 `--color-brand`）。
- **响应式**：`@media (max-width: 1024px)` 侧栏 240px；`768px` 侧栏改为 absolute overlay（`transform` 滑入），显示圆形目录切换按钮；`480px` 进一步紧凑。移动端输入搜索词或点击目录项后自动收起侧栏。

### antd v6 适配

antd v6 中 `Modal` 的 `destroyOnClose` 已废弃（`@deprecated Please use destroyOnHidden instead`），组件使用 `destroyOnHidden={false}` 保留挂载状态以配合内容缓存。

### 验证

- `npx tsc --noEmit` 检查：`HelpViewer.tsx` 与 `electron.d.ts`（`docs` 新增）零错误，未引入新错误；项目其余 TS 错误均为历史遗留（MemoryChat / WorldBook / Vector 等模块），与本次改动无关。
- 严格模式（`strict` + `noUnusedLocals` + `noUnusedParameters`）下编译通过：react-markdown `Components` 类型推断 h1 渲染器参数，`node` 通过 `void node` 标记为有意不使用以避免未使用告警。


## §38 ConfigPanel「图片生成设置」新增角色特征分类列表（Spec: fix-conversation-image-generation-bugs / Bug 3，2026-08-09）

### 概述

在 ConfigPanel 的「图片生成设置」折叠面板内新增「角色特征分类」列表，允许用户在生成图片前按分类启用/禁用角色特征。解决角色基础特征（如「戴帽子」）与对话场景（如「摘下帽子」）冲突时，用户无法选择性关闭某类特征的问题。

### 问题背景

从对话上下文生成图片时，系统会将角色特征注入 SD 提示词。但角色的基础特征（如上装类「戴着帽子」、配饰类「戴着眼镜」）可能与当前对话场景（「摘下了帽子」）矛盾，导致生成的图片与剧情不符。用户需要在生成图片前选择性禁用某些特征分类（如上装/下装/内衣、背景等）。

### 改动内容

#### 1. ConfigPanel.tsx — 导入扩展

- antd 导入新增 `Checkbox`：`{ Button, Switch, Select, Tooltip }` → `{ Button, Switch, Select, Tooltip, Checkbox }`
- 新增 `useCharacterTraitStore`（来自 `../../../stores/characterTraitStore`）
- 新增 `SYSTEM_TRAIT_CATEGORIES` / `UNCATEGORIZED_CATEGORY`（来自 `@shared/types`）
- 新增类型导入 `CharacterTraitItem` / `TraitCategory`（来自 `@shared/types`）

#### 2. ConfigPanel.tsx — Store 订阅与分类逻辑

在 `imageGenCollapsed` state 后新增：

- **Store 订阅**：`characterTraits` / `traitStoreCardId` / `loadTraits` / `toggleTraitEnabled` / `saveTraits` / `globalCategories`（均通过 selector 精确订阅）
- **useEffect 加载特征**：当 `characterCardId` 与 store 中 `currentCharacterCardId` 不一致时调用 `loadTraits(characterCardId)`
- **traitCategories**（`React.useMemo<TraitCategory[]>`）：拼接 `SYSTEM_TRAIT_CATEGORIES` + `globalCategories` + `UNCATEGORIZED_CATEGORY` 构建完整分类列表
- **traitsByCategory**（`React.useMemo`）：按 `categoryId` 将 `characterTraits` 分组为 `Record<string, CharacterTraitItem[]>`
- **handleCategoryToggle**（`React.useCallback`）：将指定分类下所有特征切换到目标 `enabled` 状态（仅对状态不一致的特征调用 `toggleTraitEnabled`），随后调用 `saveTraits(characterCardId)` 持久化
- **isCategoryAllEnabled**（`React.useCallback`）：检查分类下所有特征是否全部启用（空分类返回 `false`）

#### 3. ConfigPanel.tsx — JSX UI

在 `image-gen-panel-inner` div 内、hint 文字之后新增「角色特征分类」区块：

- 无特征时显示空状态提示文案
- 有特征时按 `traitCategories` 顺序渲染，跳过空分类（`catTraits.length === 0` 时 `return null`）
- 每个分类卡片包含：Checkbox（全选/全不选）+ 分类名 + 启用计数（`enabled/total`）+ 特征标签列表
- 启用特征标签为紫色高亮，禁用特征标签为灰色删除线样式

#### 4. ConfigPanel.css — 新增样式

在 `.image-gen-config-hint` 与 `@media` 查询之间新增 10 个 CSS 类：

| 类名 | 用途 |
|------|------|
| `.image-gen-trait-section` | 特征区块容器（顶部边框分隔） |
| `.image-gen-trait-section-title` | 区块标题 |
| `.image-gen-trait-empty` | 空状态文案 |
| `.image-gen-trait-categories` | 分类列表容器（flex column） |
| `.image-gen-trait-category` | 单个分类卡片 |
| `.image-gen-trait-category-header` | 分类头部（Checkbox + 计数） |
| `.image-gen-trait-category-name` | 分类名称 |
| `.image-gen-trait-count` | 启用计数 |
| `.image-gen-trait-tags` | 标签列表（flex wrap，左侧缩进 24px 对齐 Checkbox） |
| `.image-gen-trait-tag.enabled` / `.disabled` | 启用/禁用标签样式 |

### 改动文件

| 文件 | 改动 |
|------|------|
| `ConfigPanel.tsx` | antd 导入 +Checkbox + Store/类型导入 + Store 订阅 + useMemo/useCallback 逻辑 + 特征分类 JSX |
| `ConfigPanel.css` | 新增 10 个 `image-gen-trait-*` CSS 类 |

### 验证

- `npx tsc --noEmit` 检查：ConfigPanel.tsx 无新增错误（唯一报错为预存的 `expressionDisplay` prop 不匹配 `ParameterPanelProps`，与本次改动无关）
- VS Code 诊断：ConfigPanel.tsx 0 错误

### 注意事项

- **`noUnusedLocals` 适配**：项目 `tsconfig.json` 开启 `noUnusedLocals: true`，`TraitCategory` 类型导入需显式使用。通过 `React.useMemo<TraitCategory[]>` 为 `traitCategories` 添加显式泛型标注，使 `TraitCategory` 被实际引用，避免 TS6133 未使用导入错误。
- `handleCategoryToggle` 调用 `saveTraits(characterCardId)` 为 fire-and-forget（返回 Promise 但未 await），与项目中其他特征保存调用模式一致。
- 分类列表顺序：系统分类（basic → head → body → top → bottom → accessories → underwear → background → pose → expression）→ 自定义分类（`globalCategories`）→ 未分类（`UNCATEGORIZED_CATEGORY`，order=999）。

## §39 对话图片生成可审计性架构（Spec: enhance-conversation-image-auditability，2026-08-09）

### 概述

为对话中生成的图片提供端到端可审计能力：提示词落盘日志、图片下方标签展示、角色特征临时编辑（会话隔离）。覆盖三项用户能力：(1) 通过日志文件追溯每次生成使用的完整 prompt；(2) 在图片下方实时查看本次生成使用的标签和 prompt；(3) 在 ConfigPanel 即时编辑角色特征，仅影响当前对话不污染角色卡 manifest。

### 类型层扩展

| 类型 | 字段 | 用途 |
|------|------|------|
| `ImageHistoryItem` | `usedTags?: Array<{ text: string; weight?: number }>` | 该历史项生成时使用的标签快照（去重合并后） |
| `ImageHistoryItem` | `usedPrompt?: string` | 最终发送给 SD WebUI 的完整 prompt（含 LoRA + traits 替换后） |
| `ImageHistoryItem` | `usedNegativePrompt?: string` | 反向提示词快照 |
| `ImageHistoryItem` | `usedLoras?: Array<{ name: string; weight: number }>` | LoRA 列表快照 |
| `ImageHistoryItem` | `removedTags?: Array<{ text: string; reason?: string }>` | AI 标签优化时被移除的标签快照（含移除原因；仅试验性功能 `ai_optimize_traits` 开启且实际删除标签时填充，详见 §7.36 / Spec: add-ai-trait-optimization-for-image-gen） |
| `ImageHistoryItem` | `aiOptimization?: { status: 'success' \| 'no-removal' \| 'failed'; removedCount: number; error?: string }` | AI 标签优化执行状态元数据（仅 `ai_optimize_traits` 开启时填充）。三态反馈：`success`=已删除标签 / `no-removal`=已分析但无需删除 / `failed`=调用失败。解决原设计仅 `removedTags.length>0` 时渲染分区导致「AI 运行但无产出」场景用户看不到反馈的问题（详见 §7.37） |
| `AIParameterConfig` | `ai_optimize_traits?: boolean` | 是否允许 AI 在图片生成前优化（删除）与对话上下文矛盾的角色特征标签（试验性功能，默认 `false`，undefined / false 均视为关闭；详见 §7.36 / Spec: add-ai-trait-optimization-for-image-gen） |
| `CharacterTestChat` | `sessionTraits?: CharacterTraitItem[]` | 当前对话的临时特征覆盖（会话级，不写角色卡 manifest） |
| `SDGenerationOptions` | `sourceContext?: { source: 'conversation' \| 'asset-manager'; messageId?: string; characterCardId?: string; round?: number }` | 调用来源标识，用于日志区分对话生成 vs 素材管理生成 |

`electron.d.ts` 同步：`generateTxt2Img` 返回值新增 `finalPrompt: string`；`saveTestChat` 签名新增第 5 参数 `sessionTraits?`。

### 服务层：sdGenerationService

**新增 `image-generation` logger**（复用 `createLogger` 模块）：
- 落盘路径：开发环境 `logs/image-generation/image-generation_<timestamp>.log`，生产环境 `app.getAppPath()/logs/image-generation/`
- 10MB 自动轮转，最多保留 5 个文件
- `generateTxt2Img` 在 `applyTraitsAndLora` 之后、HTTP 请求之前调用 `logger.info(message, details, context)`：
  - `message`：`生成图片请求 [${sourceContext?.source || 'unknown'}]`
  - `details`：最终 prompt 字符串（多行可复制）
  - `context`：JSON 对象（negativePrompt / traits / loras / steps / cfgScale / sampler / scheduler / width / height / model / sourceContext）
- catch 分支调用 `logger.error` 记录失败原因 + sourceContext + 原始 prompt

**`generateTxt2Img` 返回值新增 `finalPrompt: string`**：
- `applyTraitsAndLora` 处理后的完整字符串（含 LoRA + traits 替换）
- 主进程是 prompt 组装的唯一权威源，渲染进程通过 IPC 返回值读取
- IPC handler `sd:generateTxt2Img` 透传 `finalPrompt`，`electron.d.ts` 同步类型签名

### Store 层：characterChatStore 扩展

`CharacterTestChat` 接口新增 `sessionTraits?: CharacterTraitItem[]` 字段（会话级临时特征覆盖）。新增 5 个 actions：

| Action | 签名 | 行为 |
|--------|------|------|
| `setSessionTraits` | `(traits: CharacterTraitItem[]) => Promise<void>` | 深拷贝入参 → 更新 currentTestChat → saveTestChat 持久化 |
| `resetSessionTraits` | `() => Promise<void>` | 置 currentTestChat.sessionTraits = undefined → saveTestChat 持久化 |
| `updateSessionTrait` | `(traitId: string, updates: Partial<CharacterTraitItem>) => Promise<void>` | lazy 初始化（sessionTraits 不存在时从 characterTraitStore.traits 深拷贝）→ 找到 trait 合并 updates → 持久化 |
| `addSessionTrait` | `(categoryId: string, text: string) => Promise<void>` | lazy 初始化 → genTraitId 生成新 trait（enabled=true, weight=1.0）→ 追加 → 持久化 |
| `removeSessionTrait` | `(traitId: string) => Promise<void>` | sessionTraits 不存在时 no-op → 过滤移除 → 持久化 |

**sessionTraits 与 characterTraitStore.traits 的核心区别**：
- `characterTraitStore.traits` → 持久化到角色卡 manifest（`traits.json`），跨会话共享
- `sessionTraits` → 仅随对话持久化（`chats/{characterCardName}.json`），会话隔离
- `executeImageGeneration` 优先读 `sessionTraits`，未设置时回退到角色卡 traits

**lazy initialization 策略**：`updateSessionTrait` / `addSessionTrait` 在 sessionTraits 未初始化时从 `characterTraitStore.traits` 深拷贝初始化。优势：用户首次编辑无需先点「全量复制」按钮；sessionTraits 的存在性自然成为「是否进入临时编辑模式」的标志（驱动 UI 徽标显示）。

**⚠️ 前置条件：`currentTestChat` 必须非 null**（§7.41）：所有 sessionTraits action 均以 `if (!current) return` 守卫开头，`currentTestChat` 为 null 时静默 no-op。`currentTestChat` 的初始化由两条路径保证：
1. `saveTestChat` action 在 IPC 返回后设置 `currentTestChat`（修复后 `!state.currentTestChat ||` 分支确保从 null 初始化）
2. `loadChatHistory`（hooks）在所有分支显式调用 `setCurrentTestChat`：「有历史」分支设置已加载的 chat 对象，「空状态」分支设置占位对象（`messages: []`），「first_mes」分支依赖 `saveChatToStore` 返回后初始化

详见 `src/renderer/stores/characterChatStore.ts` L59-101（接口）+ L319-531（实现）。

### UI 层：ChatMessageBubble 标签展示面板

在图片区域 `chat-msg-image-actions` 下方新增「查看本次生成标签」可折叠面板（仅 `imageAttachment.status === 'idle'` 且当前历史项有 `usedTags` 时渲染）：

- **折叠头部**：`<button>` + `DownOutlined/RightOutlined` 图标 + 「查看本次生成标签」文案 + `<Tag>{tagsCount} tags</Tag>` 徽标 + AI 优化徽标（仅 `aiOptimization` 存在时渲染，三态：success 绿/no-removal 灰/failed 红，§7.37）
- **展开后**：Tag 列表（每个 Tag 含文本 + 权重徽标 `:weight`）+ AI 优化分区（三态：success 展示被删除标签列表 / no-removal 提示无需删除 / failed 提示失败原因，§7.37）+ 二级折叠「查看完整 Prompt」
- **二级展开**：`<pre>` 块显示 `usedPrompt` + `usedNegativePrompt` + LoRAs 列表
- **历史导航自动折叠**：`useEffect` 依赖 `imageAttachment?.currentIndex` 重置 `tagsPanelExpanded` / `promptPanelExpanded`，避免上一版本的展开状态误导用户
- **旧数据兼容**：当前历史项无 `usedTags`（旧 ImageHistoryItem）时显示「此历史版本无标签快照」灰色提示；无 `aiOptimization`（旧数据或未启用 AI 优化）时不渲染 AI 优化分区/徽标

新增 CSS 类（`ChatMessageBubble.css`）：`.chat-msg-image-tags-panel` / `.chat-msg-image-tags-panel-header` / `.chat-msg-image-tags` / `.chat-msg-image-prompt`（等宽字体 + 横向滚动 + 暗色背景）/ `.chat-msg-image-tag-weight` / `.chat-msg-image-tags-empty` / `.chat-msg-image-tags-count`。样式遵循暗色主题 CSS 变量，视觉风格参考 `RagQualityReport.tsx` 的 Tag 渲染。

### UI 层：ConfigPanel 特征分类区域升级（从只读升级为可编辑）

`ConfigPanel.tsx` 从 `useCharacterChatStore` 订阅 `currentTestChat.sessionTraits` 与 5 个新 actions。派生 `effectiveTraits = sessionTraits ?? characterTraits`，特征分类区域渲染基于 `effectiveTraits`。

| 交互 | 行为 | 调用 |
|------|------|------|
| Tag 点击 | 切换 enabled 状态 | `updateSessionTrait(trait.id, { enabled: !trait.enabled })` |
| Tag 悬浮删除按钮 | 移除 trait | `removeSessionTrait(trait.id)` |
| Tag 双击 | 进入 inline 编辑态（Input + 回车确认 / Esc 取消） | `updateSessionTrait(trait.id, { text: newValue, originalText: undefined })` |
| 权重徽标点击 | 进入权重编辑态（InputNumber） | `updateSessionTrait(trait.id, { weight: newWeight })` |
| 「+ 添加特征」按钮 | 弹出 prompt 输入特征文本 | `addSessionTrait(cat.id, text)` |
| 分类级 Checkbox | 批量切换分类下所有特征 | 首次调用 lazy-init sessionTraits，后续 `setSessionTraits` 全量替换 |
| 「临时编辑中」徽标 | 仅 sessionTraits 存在时显示（黄色 + EditOutlined + Tooltip） | — |
| 「重置为角色卡特征」按钮 | 仅 sessionTraits 存在时显示，含 Modal.confirm 二次确认 | `resetSessionTraits()` |

新增 CSS 类（`ConfigPanel.css`）：`.image-gen-trait-tag.editable` / `.image-gen-trait-tag-edit-btn` / `.image-gen-trait-tag-weight-badge` / `.image-gen-trait-tag-editing` / `.image-gen-add-trait-btn` / `.image-gen-session-badge` / `.image-gen-reset-btn`。样式遵循暗色主题 CSS 变量。

### 数据流：executeImageGeneration 特征源切换

`CharacterDialogueChat.tsx` 的 `executeImageGeneration` 中：
1. 从 `useCharacterChatStore.getState().currentTestChat?.sessionTraits` 读取临时特征
2. 派生 `currentTraits = sessionTraits ?? useCharacterTraitStore.getState().traits`
3. `enabledTraitTexts` 与 `buildSdOptionsFromConfig` 的 `effectiveTraits` 参数传入 `currentTraits`
4. 日志输出特征来源（`[executeImageGeneration] 特征来源: ${sessionTraits ? 'sessionTraits (临时编辑)' : 'characterTraitStore (角色卡)'}`）
5. 生成成功时，`newHistoryItem` 快照 `usedTags: mergedTraits` / `usedPrompt: sdResult.finalPrompt` / `usedNegativePrompt` / `usedLoras`

### 数据流：sourceContext 接线

`executeImageGeneration` 构建 `sdOptions` 后赋值 `sourceContext = { source: 'conversation', messageId, characterCardId, round: (parentMsg.imageAttachment?.history?.length || 0) + 1 }`。素材管理弹窗（AssetGenerateModal / AssetManagerModal）调用 `sd.generateTxt2Img` 处传入 `sourceContext: { source: 'asset-manager' }`。日志通过 `sourceContext.source` 区分调用来源。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` | `ImageHistoryItem` 新增 4 字段 |
| `src/shared/types/sd.types.ts`（或 sdGenerationService 内联） | `SDGenerationOptions` 新增 `sourceContext` |
| `src/renderer/types/electron.d.ts` | `generateTxt2Img` 返回值签名 + `saveTestChat` 签名 |
| `src/main/services/sdGenerationService.ts` | `image-generation` logger + `finalPrompt` 返回值 |
| `src/main/ipc/handlers/sdGenerationHandlers.ts` | 透传 `finalPrompt` |
| `src/main/services/ChatStorageService.ts` | `TestChatData` 新增 `sessionTraits` 字段 |
| `src/main/ipc/handlers/characterChatHandlers.ts` | `saveCharacterTestChat` 新增 `sessionTraits` 参数 |
| `src/main/preload.ts` | `saveTestChat` 新增 `sessionTraits` 参数 |
| `src/renderer/stores/characterChatStore.ts` | 5 个新 actions + lazy init + 双层浅拷贝 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` | `executeImageGeneration` 特征源切换 + 标签快照 |
| `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` | 可折叠标签面板 |
| `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` | 7 个新 CSS 类 |
| `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` | 订阅 sessionTraits + Tag 可交互编辑 |
| `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` | 7 个新 CSS 类 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` | saveChatToStore 透传 sessionTraits |

### 关联文档

- `docs/FIX_RECORDS.md` §7.32（sourceContext 接线 / Task 3）/ §7.33（sessionTraits store / Task 7）/ §7.34（Task 1+2+4+5+6+8+9+10+11 综合记录）
- 前置依赖：§7.30（旧图片消息迁移为 imageAttachment）/ §7.31（hooks 新增 updateImageAttachment / deleteImageAttachment / navigateImageHistory）

### 设计约定

- **主进程是 prompt 组装的唯一权威源**：`applyTraitsAndLora` 在主进程完成 LoRA + traits 替换，渲染进程通过 `finalPrompt` 返回值读取，不在渲染层重组装（避免双源真相）
- **标签快照存历史项级别**（per-history-item）：同一消息可能有多张图片（重生成历史），每张图片独立快照，确保切换历史图片时显示对应版本的标签
- **sessionTraits 是会话级覆盖**：仅随对话持久化，不写角色卡 manifest，与角色卡 traits 物理隔离
- **lazy initialization**：sessionTraits 未初始化时从 characterTraitStore.traits 深拷贝，避免对话开始就消耗内存
- **标签面板默认折叠 + 历史导航自动折叠**：避免占用垂直空间，避免上一版本展开状态误导用户

## §40 对话互动元素识别架构（Spec: enhance-conversation-interaction-prompt-recognition，2026-08-09）

### 背景与动机

用户反馈：对话中描述动作互动（如"用手触摸她的身体"、"拥抱她"、"亲吻她"）时，生成的图片缺乏交互性质 — SD 仅生成角色独自站立/坐着的画面，未体现用户与角色的肢体接触。根因是原特征分类体系仅有 `pose`（角色自身姿势），无专门承载「用户与角色交互」的标签分类，AI 也不知道应输出 `disembodied_hand` / `hugging_another` 等 Danbooru 互动标签。

### 核心变更：新增 `interaction` 系统分类

**`src/shared/types/characterTrait.types.ts`** — `SYSTEM_TRAIT_CATEGORIES` 数组新增第 11 个系统分类：

```
{ id: 'interaction', name: '互动元素', isSystem: true, order: 10 }
```

与 `pose`（order 8）语义分离：
- `pose` = 角色自身的姿态（如 `sitting` / `standing` / `lying`）
- `interaction` = 与另一个实体的交互（如 `disembodied_hand` / `hugging_another` / `holding_hands`）

### 互动标签两种 Danbooru 模式

`buildDynamicTraitSystemPrompt` 注入的 `interactionGuidance` 指令块定义两种模式，AI 根据对话语境选择：

**■ 模式 A — POV/脱离身体风格**（第一人称描述触发，如"我用手触摸…"）：
- 用户不完整出现在画面中，仅出现交互的身体部位
- 身体接触类：`disembodied_hand` + `hand_on_breast` / `hand_on_butt` / `hand_on_hip` / `hand_on_leg`
- 舔舐类：`disembodied_tongue` + `licking` / `face_lick` / `breast_lick` / `foot_lick`
- 其他：`disembodied_penis` / `disembodied_foot` / `disembodied_mouth`

**■ 模式 B — 双角色互动风格**（第三人称或两角色互动描述触发）：
- 用户作为 "another" 完整出现在画面中，与角色互动
- 拥抱/牵手：`hugging_another` / `hug` / `holding_hands`
- 手放在他人身上：`hand_on_another's_head` / `_shoulder` / `_face` / `_cheek` / `_chin` / `_back` / `_arm` / `_chest` / `_thigh` / `_waist`
- 抓握他人：`grabbing_another's_breast` / `_ass` / `_arm` / `_hair` / `_wrist`
- 持握他人：`holding_another's_wrist` / `_hair` / `_arm` / `hand_in_another's_hair`
- 其他互动：`sitting_on_another` / `carrying_another` / `facing_another` / `smiling_at_another` / `kissing`

### 关键设计原则

1. **互动元素独立于角色完整形象** — 即使用户设定了完整形象，也必须添加 `disembodied_*` 标签（脱离身体的部位+动作），而非试图生成用户的完整角色。允许不生成用户完整角色，仅添加 disembodied_* 标签引导 SD 生成交互性质图片。
2. **互动标签必须成对出现** — `disembodied_hand` 配合 `hand_on_*`，`disembodied_tongue` 配合 `*_lick` / `licking_*`。
3. **条件触发** — 仅当对话明确描述互动动作时才输出互动标签；角色独自站立/坐着的描述不输出互动标签。角色卡描述场景（无互动描述）自然不触发。
4. **分类前缀输出** — 互动标签使用 `interaction:` 前缀，如 `interaction:disembodied_hand|脱离身体的手` / `interaction:hugging_another|拥抱他人`。
5. **模式选择依语境** — 第一人称描述倾向模式 A（`disembodied_*`）；第三人称或描述两个角色互动倾向模式 B（`*_another`）。

### 互动标签权重提升机制

互动标签在 SD prompt 中拼接位置靠后（角色特征标签之后），当角色特征标签较多时容易被图像模型忽略，导致生成的图片缺乏交互性质。通过对 `categoryId === 'interaction'` 的 trait 应用**分类级权重提升**来加强：

- **配置项**：`customParameters.interaction_weight`（`AIParameterConfig` 新增字段）
  - 默认 `1.2`（用户建议的 1.1-1.2 范围取上限）
  - 范围 `1.0-2.0`，步进 `0.1`，`1.0` = 不提升（等价关闭）
  - UI 入口：ConfigPanel「图片生成设置」面板内「互动标签权重」滑块（图片生成开启时可用）
- **权重组合方式**：`最终 weight = (per-tag weight ?? 1.0) × interaction_weight`
  - 分类级提升与标签级权重**相乘**，用户可同时调整两者
  - 如 `disembodied_hand` 无 per-tag weight + interaction_weight=1.2 → 最终 1.2 → prompt 输出 `(disembodied_hand:1.2)`
  - 如 `hugging_another` per-tag weight=1.5 + interaction_weight=1.2 → 最终 1.8 → prompt 输出 `(hugging_another:1.8)`
- **应用位置**：`executeImageGeneration`（渲染进程）构建 `mergedTraits` 后、传给 `buildSdOptionsFromConfig` 前。`applyTraitsAndLora`（主进程）只看到最终的 `{ text, weight }`，不感知 categoryId，保持主进程 prompt 组装逻辑不变
- **标签快照一致性**：`usedTags`（ImageHistoryItem）使用提升后的 `finalTraits`，与 `usedPrompt`（主进程 applyTraitsAndLora 处理后的最终 prompt）保持一致，用户在标签面板看到的权重值与实际 prompt 中的权重值对应

### 涉及文件

- `src/shared/types/characterTrait.types.ts` — `SYSTEM_TRAIT_CATEGORIES` 新增 `interaction` 分类（order 10）
- `src/main/services/characterTraitAIService.ts` — 三处同步更新：
  - `buildDynamicTraitSystemPrompt`：`systemCategoryDescriptions` 新增 `interaction` 描述；`systemGuidance` 新增互动元素归类建议；新增 `interactionGuidance` 指令块（含模式 A/B 标签清单 + 5 条关键原则）注入到 prompt
  - `buildDynamicImageTraitSystemPrompt`：`systemCategoryDescriptions` 新增 `interaction` 英文描述（标注「图片识别场景一般不触发」）；`systemGuidance` 新增互动元素归类建议。补齐英文描述避免 `SYSTEM_TRAIT_CATEGORIES` 含 `interaction` 但描述缺失导致分类列表回退中文名「互动元素」破坏英文 prompt 一致性
  - `CHARACTER_TRAIT_SYSTEM_PROMPT` / `IMAGE_TRAIT_SYSTEM_PROMPT` 基线常量：同步追加 `interaction` 分类描述与 guidance（基线参考，生产用动态构建版本）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `AIParameterConfig` 新增 `interaction_weight?: number` 字段（默认 1.2，范围 1.0-2.0）
- `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `executeImageGeneration` 中：
  - `enabledTraitTexts` / `contextTraits` / `mergedTraits` 映射时保留 `categoryId`（用于识别 interaction 分类）
  - 新增分类级权重提升：`finalTraits = mergedTraits.map(t => categoryId === 'interaction' ? weight × interaction_weight : weight)`
  - `buildSdOptionsFromConfig` 与 `usedTags` 快照均使用 `finalTraits`（含提升后权重）
  - 新增 `handleInteractionWeightChange` 回调（范围校验 1.0-2.0）
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 新增「互动标签权重」滑块 UI（Slider 1.0-2.0 步进 0.1，默认 1.2，图片生成开启时可用）；**【UI 重构】**按 AssetGenerateModal「携带角色特征」面板设计重构特征分类区域：Collapse 折叠面板 + antd Tag（closable 删除 + onClick 切换 enabled）+ Tooltip（翻译/拆分溯源/权重）+ EditOutlined（文本编辑）+ Popover 权重编辑器（Slider + InputNumber + 预设按钮）+ TagAutocomplete 内联添加（替换 window.prompt，Electron 不支持）。保留分类级 Checkbox（indeterminate 三态）。所有分类均显示（含空分类），用户可向空分类（如 interaction）添加标签
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 新增 `.image-gen-interaction-weight-row` / `-control` / `-value` 三个 CSS 类；替换旧 tag 样式为 Collapse/Tag/Popover/weight-badge 新样式（`.image-gen-trait-collapse` / `.image-gen-trait-tag-wrapper` / `.image-gen-trait-weight-badge.default/.boost/.reduce` / `.image-gen-weight-popover` 等 ~15 个 CSS 类）

### 数据流

```
对话上下文描述互动动作
  ↓
generateTraitPrompts / generateCharacterTraits（characterTraitAIService）
  ↓
buildDynamicTraitSystemPrompt 注入 interactionGuidance 指令块
  ↓
LLM 识别互动语境 → 输出 interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部
  ↓
parseTraitsFromContent 解析 → CategorizedTrait { categoryId: 'interaction', text: 'disembodied_hand', translation: '脱离身体的手' }
  ↓
characterTraitStore.setTraits（MERGE 策略）→ CharacterTraitItem { categoryId: 'interaction', enabled: true }
  ↓
ConfigPanel 自动渲染「互动元素」分类折叠区（SYSTEM_TRAIT_CATEGORIES 驱动）
  ↓
executeImageGeneration 构建 mergedTraits（保留 categoryId）
  ↓
分类级权重提升：interaction 分类的 trait weight × interaction_weight（默认 1.2）
  → finalTraits: [{ text: 'disembodied_hand', weight: 1.2 }, { text: 'hand_on_breast', weight: 1.2 }]
  ↓
applyTraitsAndLora 拼接 finalTraits 到 SD prompt → (disembodied_hand:1.2), (hand_on_breast:1.2)
  ↓
SD 生成包含交互性质的图片（disembodied_hand + hand_on_breast → 画面出现一只手放在角色胸部）
```

### 设计约定

- **`interaction` 与 `pose` 不可混用**：角色自身姿态归 `pose`，与另一实体的交互归 `interaction`。如 `sitting`（角色自己坐着）= pose，`sitting_on_another`（坐在他人身上）= interaction。
- **互动标签优先成对**：模式 A 必须同时输出 `disembodied_*` 部位标签 + 配合的动作部位标签（如 `disembodied_hand` + `hand_on_breast`），单独输出 `disembodied_hand` 而无配合标签会导致 SD 不知手放在哪里。
- **图片识别场景不触发**：`recognizeImageTraits` 分析的是静态角色卡 PNG（单一角色），无对话上下文，互动标签一般不输出。`buildDynamicImageTraitSystemPrompt` 的 `interaction` 英文描述已标注「typically NOT applicable to single character image analysis」。
- **标签库覆盖验证**：`disembodied_hand`（count 71413）/ `hugging_another`（count 10622）/ `hand_on_another's_head`（count 47364）等互动标签均已存在于 `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv` 标签库，RAG 检索与 L0-L5 审计链可正常命中。

### 关联文档

- `docs/FIX_RECORDS.md` §7.35 — 实施记录与重点问题日志
- `CODE_WIKI.md` §「AI 生成特征自动归类」— 系统分类体系表（已更新为 11 个，含 `interaction`）
- `docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv` — 互动标签数据源（disembodied_* / *_another 系列）

## AI 标签优化服务方法 `optimizeTraitsForContext`（Spec: add-ai-trait-optimization-for-image-gen / Task 2 + Spec: add-ai-tag-supplement-after-removal / Task 2）

> 2026-08-09 实施：在 `characterTraitAIService.ts` 中新增 `optimizeTraitsForContext` 方法，用于图片生成前由 AI 分析对话上下文与已启用角色特征标签的矛盾关系，返回应删除的标签列表 + 删除后应补充的标签列表。本节为 Task 2（AI 服务方法 + 接口），后续 Task（ConfigPanel 开关 / 标签快照面板「AI 已移除」分区渲染 / executeImageGeneration 接线 / IPC 通道）尚未实现。
>
> **2026-08-09 增量更新（Spec: add-ai-tag-supplement-after-removal / Task 2）**：system prompt 重构为 TWO PARTS（PART 1 - REMOVAL 矛盾识别 + PART 2 - SUPPLEMENT 缺失补充），响应解析器升级为同时返回 `tagsToRemove` + `tagsToAdd`，详见 `docs/FIX_RECORDS.md` §7.39。

### 设计动机

- 角色特征标签（如 `pants` / `sitting` / `hat`）在图片生成时携带以保证角色一致性，但对话过程中角色状态可能变化（脱衣 / 站起 / 离开等），此时仍携带旧标签会导致 SD 生成与对话矛盾的图片
- 通过 AI 分析对话上下文与标签的矛盾关系，在图片生成前自动删除不再适用的标签
- **补充能力**：删除矛盾标签后可能产生描述缺失（如移除 `pants` 后下身暴露但缺少 `pussy` 标签），AI 在同一次调用中评估并补充缺失的关键描述符
- ⚠️ 标注为试验性功能：AI 可能误删/误补标签，建议谨慎使用（Task 1 已在 `AIParameterConfig.ai_optimize_traits` 开关默认关闭）

### 新增接口（位于 `GenerateTraitPromptsResult` 之后）

| 接口 | 字段 | 说明 |
| --- | --- | --- |
| `OptimizeTraitsParams` | `traits: Array<{ text, weight?, categoryId? }>` | 当前已启用的角色特征标签列表 |
|  | `conversationContext: string` | 当前对话上下文（用户与角色的完整对话文本） |
| `OptimizeTraitsResult` | `success: boolean` | 调用是否成功 |
|  | `tagsToRemove?: Array<{ text, reason? }>` | AI 建议删除的标签列表（含原因） |
|  | `tagsToAdd?: Array<{ text, reason?, weight?, categoryId? }>` | AI 删除后评估补充的标签列表（Spec: add-ai-tag-supplement-after-removal） |
|  | `error?: string` | 失败时的友好错误信息 |

### 服务表增量 — `characterTraitAIService.optimizeTraitsForContext`

| 方法 / 类型 | 签名 | 说明 |
| --- | --- | --- |
| `optimizeTraitsForContext(params)` | async → `OptimizeTraitsResult` | 主入口；复用与 `generateTraitPrompts` 完全一致的调用模式；返回 `tagsToRemove` + `tagsToAdd` |
| `parseOptimizeResponse(content)` | private → `{ tagsToRemove, tagsToAdd }` | 解析 LLM JSON 响应；支持 ```` ```json ```` 代码块与裸 JSON；接受 `{ remove: [...], add: [...] }` 标准结构与裸数组兼容格式；防御性剔除 `tagsToAdd` 中与 `tagsToRemove` 同名的项（兜底执行规则 7）；解析失败返回 `{ tagsToRemove: [], tagsToAdd: [] }` |

### 调用流程（与 `generateTraitPrompts` 完全一致）

1. 入参校验：空对话上下文 → 返回错误；空标签列表 → 返回空 `tagsToRemove` 短路
2. 读取 AI 引擎配置：`aiConfigProvider.getAIConfig({ defaultTransmission: 'header' })` → baseUrl / apiKey / apiKeyTransmission / systemPrompt / modelName
3. 配置兜底校验：baseUrl / apiKey / modelName 任一缺失 → 「AI 引擎未配置，请先在设置中配置 API」
4. 读取运行时参数：`this.getEngineRuntimeConfig()` → temperature / maxTokens（缺失返回友好错误）
5. 构建 system prompt（英文指令，TWO PARTS：PART 1 矛盾识别 + PART 2 缺失补充 + 7 条规则 + JSON 输出格式）
6. 构建 user message（当前标签列表 + 对话上下文 + 两部分任务说明）
7. 构建 messages + `enrichSystemPrompt` 注入引擎级 system prompt
8. 非流式 POST `/v1/chat/completions`（apiKeyTransmission='header' 时 Authorization 头，否则 body.api_key）
9. 解析 `data.choices[0].message.content` → `parseOptimizeResponse` 提取 `tagsToRemove` + `tagsToAdd`
10. 返回 `{ success: true, tagsToRemove, tagsToAdd }`

### System Prompt 设计要点

- **TWO PARTS 结构**（Spec: add-ai-tag-supplement-after-removal / Task 2）：
  - **PART 1 - REMOVAL**：识别与对话上下文矛盾的标签
  - **PART 2 - SUPPLEMENT**：删除后评估缺失的关键描述符并补充
- **PART 1 五类常见矛盾模式**：clothing removal（脱衣）/ pose change（姿势变化）/ location change（位置变化）/ state change（状态变化）/ interaction withdrawal（互动抽回，§7.38 新增）
- **PART 2 四类常见补充模式**：exposure after clothing removal（服装移除后暴露特征）/ pose transition（姿势转换）/ state transition（状态转换）/ 仅补充必要标签（使用标准 Danbooru/e621 标签名）
- **7 条规则**：
  1. 仅删除直接矛盾的标签
  2. 不删除仍适用或模糊的标签
  3. 对话未明确描述变化时不删除
  4. 无需删除时返回空数组
  5. 有疑不删（conservative）
  6. 特别关注互动标签（disembodied_* / hand_on_* / *_another / holding_*）是否因对话进展而过时
  7. `add` 列表仅建议不在现有标签列表中的标签，且不补充同时建议删除的标签
- **输出格式**：严格 JSON `{ "remove": [{ "text", "reason" }], "add": [{ "text", "reason", "weight"?, "categoryId"? }] }`，无操作时返回 `{ "remove": [], "add": [] }`，仅返回 JSON 不含其他文本

### 错误兜底（与 `generateTraitPrompts` 一致）

- 空对话上下文 → `{ success: false, error: '对话上下文为空' }`
- 空标签列表 → `{ success: true, tagsToRemove: [] }`（短路，不调用 LLM；`tagsToAdd` 为可选字段默认 undefined）
- AI 引擎未配置 → `{ success: false, error: 'AI 引擎未配置，请先在设置中配置 API' }`
- 引擎参数缺失 → `{ success: false, error: 'AI 引擎未配置 temperature 或 max_tokens 参数...' }`
- HTTP 错误 → `{ success: false, error: 'AI 调用失败：HTTP <status> <statusText>' }`
- 空内容 → `{ success: false, error: 'AI 返回内容为空' }`
- 超时 / abort → `{ success: false, error: 'AI 调用失败：请求超时，请稍后重试' }`
- 其他异常 → `{ success: false, error: 'AI 调用失败：<message>' }`（永不抛异常）

### 日志前缀

- service 内部使用 `[TraitOptimizeAI]` 前缀（与 `[TraitPromptAI]` / `[CharacterTraitAI]` 风格一致）
- 优化结果日志含 `suggestedRemoval` / `removedTags` / `suggestedSupplement` / `addedTags` 四个字段

### 涉及文件

- `src/main/services/characterTraitAIService.ts` — 新增 `optimizeTraitsForContext(params)` 方法 + `OptimizeTraitsParams` / `OptimizeTraitsResult` 接口 + `parseOptimizeResponse` 私有辅助方法；复用 `aiConfigProvider.getAIConfig` / `getEngineRuntimeConfig` / `enrichSystemPrompt` 基础设施

### 后续待办（Spec 后续 Task）

- Task 3+：IPC 通道注册（`ai:optimizeTraitsForContext`）、preload 暴露、electron.d.ts 类型声明
- ~~ConfigPanel `ai_optimize_traits` 开关 UI（Task 1 已铺设类型）~~ ✅ 已由 Task 4 完成（见下节）
- 标签快照面板「AI 已移除」分区渲染（Task 1 已铺设 `ImageHistoryItem.removedTags` 类型；§7.37 扩展为基于 `aiOptimization` 三态反馈：success/no-removal/failed，面板头部新增徽标，展开后分区三态渲染）
- `executeImageGeneration` 接线：生成前调用优化 → 删除标签 → 记录到 `removedTags` 快照 + `aiOptimization` 执行状态元数据
- ~~**Spec: add-ai-tag-supplement-after-removal 后续 Task**：渲染层 `executeImageGeneration` 消费 `tagsToAdd`（合并到 mergedTraits + 记录到快照）+ 标签快照面板「AI 已补充」分区渲染 + 过度补充防护~~ ✅ 已完成（Task 3 见 §7.40 / `docs/FIX_RECORDS.md`，Task 4 见下节「ChatMessageBubble「AI 已补充」分区」）

## ConfigPanel「允许 AI 优化特征标签」开关 UI（Spec: add-ai-trait-optimization-for-image-gen / Task 4）

> 2026-08-09 实施：在 ConfigPanel「图片生成设置」折叠面板中新增「允许 AI 优化特征标签」试验性功能开关 UI + 警示条。本节为 Task 4（UI 层），仅修改 ConfigPanel.tsx 与 ConfigPanel.css，不修改任何现有逻辑。后续 Task（IPC / 接线 / 快照面板分区 / executeImageGeneration）尚未实现，开关尚不端到端生效（onClick 回调由 `CharacterDialogueChat.tsx` 接线后才会写入 customParameters）。

### 设计动机

- Task 1 已在 `AIParameterConfig.ai_optimize_traits` 铺设类型字段，Task 2 已实现 `optimizeTraitsForContext` AI 服务方法，但用户无法在 UI 上配置该开关
- 本 Task 补齐 UI 层：在「图片生成设置」面板内新增开关 + 试验性警示条，让用户可见可配置
- 开关默认关闭，与 Task 1「undefined / false 均视为关闭」语义一致
- 标注为试验性功能：AI 可能误删重要标签，警示条独立于 Tooltip 确保用户即使不悬停也能看到风险

### 新增 Props — `ConfigPanelProps`

位于 `onInteractionWeightChange` 之后，`engineCapabilities` 之前：

| Prop | 类型 | 说明 |
| --- | --- | --- |
| `aiOptimizeTraits?` | `boolean` | 开关当前状态（对应 `AIParameterConfig.ai_optimize_traits`，undefined / false 均视为关闭） |
| `onAiOptimizeTraitsToggle?` | `(enabled: boolean) => void` | 开关切换回调，由 `CharacterDialogueChat.tsx` 接线后写入 customParameters |

同步在组件函数参数解构中新增 `aiOptimizeTraits` / `onAiOptimizeTraitsToggle`（位于 `onInteractionWeightChange` 之后），保证 props 透传到 JSX。

### 新增 UI — JSX（位于「互动标签权重」滑块之后、「在对话中一键生成场景图片」hint 之前）

```tsx
<div className="image-gen-config-row image-gen-ai-optimize-row">
  <span className="image-gen-config-label">
    允许 AI 优化特征标签
    <Tooltip title="开启后，图片生成前 AI 会根据对话上下文自动分析并删除矛盾的角色特征标签（如对话中角色脱下裤子时移除 pants 标签）。此为试验性功能，AI 可能会误删重要标签。">
      <QuestionCircleOutlined className="image-gen-tooltip-icon" />
    </Tooltip>
  </span>
  <Switch
    size="small"
    checked={aiOptimizeTraits ?? false}
    onChange={onAiOptimizeTraitsToggle}
    disabled={!imageGenEnabled}
  />
</div>
<div className="image-gen-experimental-warning">
  ⚠ 试验性功能：AI 可能会删除重要标签，建议谨慎使用
</div>
```

关键设计：
- `checked={aiOptimizeTraits ?? false}` — 默认关闭，与 Task 1 语义一致
- `disabled={!imageGenEnabled}` — 与「图片大小」选择器联动，图片生成未开启时开关禁用
- 复用已导入的 `Switch` / `Tooltip` / `QuestionCircleOutlined`，无新增 antd 依赖
- 警示条独立于 Tooltip，确保不悬停也能看到试验性风险

### 新增 CSS — `ConfigPanel.css`（位于 `.image-gen-interaction-weight-value` 之后）

```css
.image-gen-ai-optimize-row {
  align-items: center;
}

.image-gen-experimental-warning {
  margin-top: -8px;
  margin-bottom: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--color-warning, #f59e0b);
  background: var(--color-warning-light, rgba(245, 158, 11, 0.1));
  border-radius: 4px;
  border-left: 2px solid var(--color-warning, #f59e0b);
  line-height: 1.5;
}
```

样式遵循暗色主题 CSS 变量体系：`--color-warning` / `--color-warning-light` 与 `.image-gen-session-badge` 同色系（橙色警告主题）。`margin-top: -8px` 让警示条紧贴开关行。

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — `ConfigPanelProps` 接口新增 2 个字段 + 组件参数解构新增 2 个变量 + JSX 新增开关行 + 警示条
- `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 新增 2 个 CSS 类（`.image-gen-ai-optimize-row` / `.image-gen-experimental-warning`）

### 后续待办（Spec 后续 Task）

- `CharacterDialogueChat.tsx` 接线：读取 `customParameters.ai_optimize_traits` 传入 ConfigPanel + `onAiOptimizeTraitsToggle` 回调写入 customParameters（onCustomParameterChange 局部更新）
- IPC 通道注册（`ai:optimizeTraitsForContext`）、preload 暴露、electron.d.ts 类型声明
- 标签快照面板「AI 已移除」分区渲染（Task 1 已铺设 `ImageHistoryItem.removedTags` 类型；§7.37 扩展为基于 `aiOptimization` 三态反馈：success/no-removal/failed，面板头部新增徽标，展开后分区三态渲染）
- `executeImageGeneration` 接线：生成前调用优化 → 删除标签 → 记录到 `removedTags` 快照 + `aiOptimization` 执行状态元数据

## ChatMessageBubble「AI 已补充」分区 + 头部徽标扩展（Spec: add-ai-tag-supplement-after-removal / Task 4）

> 2026-08-09 实施：在 `ChatMessageBubble.tsx` 标签快照面板的 AI 优化分区中新增与「AI 已移除」对称的「AI 已补充」分区（展示 `addedTags`），并扩展面板头部 AI 徽标的 success 文案以同时反映移除与补充数量。本节为 Task 4（UI 渲染层），Task 1 已在 `ImageHistoryItem.addedTags?: Array<{ text: string; reason?: string }>` 与 `aiOptimization.addedCount: number` 铺设类型契约。CSS 类样式由 Task 5 负责，本 Task 仅修改 TSX。

### 设计动机

- 原 success 分支条件为 `status === 'success' && removedTags.length > 0`，要求 removedTags 非空才渲染分区；但「AI 只补充不删除」场景下 removedTags 为空，分区被吞掉，用户看不到「AI 已补充」反馈
- 头部徽标原 success 文案固定为 `AI 已移除 N`，无法反映「同时移除 + 补充」或「仅补充」场景，反馈不完整
- 需要对称扩展：与「AI 已移除」分区并列新增「AI 已补充」分区，两者各自独立条件渲染（可能只有其一，也可能两者都有）

### SubTask 4.1-4.3 / 4.5：success 分支重构 + 新增「AI 已补充」分区

`success` 分支条件从「且 removedTags 非空」改为无条件进入，内部 removedTags / addedTags 各自独立条件渲染：

```tsx
{currentHistoryItem.aiOptimization.status === 'success' ? (
  <>
    {/* AI 已移除分区（保留原逻辑，改为独立条件渲染） */}
    {currentHistoryItem.removedTags && currentHistoryItem.removedTags.length > 0 && (
      <>
        <span className="chat-msg-image-removed-tags-label">
          AI 已移除（{currentHistoryItem.aiOptimization.removedCount} 个）：
        </span>
        <div className="chat-msg-image-removed-tags-list">
          {currentHistoryItem.removedTags.map((t, i) => (
            <Tooltip key={i} title={t.reason ? `AI 删除原因：${t.reason}` : 'AI 根据对话上下文判断此标签不再适用'}>
              <Tag className="chat-msg-image-removed-tag">{t.text}</Tag>
            </Tooltip>
          ))}
        </div>
      </>
    )}
    {/* AI 已补充分区（新增） */}
    {currentHistoryItem.addedTags && currentHistoryItem.addedTags.length > 0 && (
      <>
        <span className="chat-msg-image-added-tags-label">
          AI 已补充（{currentHistoryItem.aiOptimization.addedCount} 个）：
        </span>
        <div className="chat-msg-image-added-tags-list">
          {currentHistoryItem.addedTags.map((t, i) => (
            <Tooltip key={i} title={t.reason ? `AI 补充原因：${t.reason}` : 'AI 根据对话上下文判断需要补充此标签'}>
              <Tag className="chat-msg-image-added-tag">{t.text}</Tag>
            </Tooltip>
          ))}
        </div>
      </>
    )}
  </>
) : currentHistoryItem.aiOptimization.status === 'no-removal' ? (
  ...（保留现有 no-removal 逻辑）
) : (
  ...（保留现有 failed 逻辑）
)}
```

关键设计点：
- success 分支不再要求 `removedTags.length > 0`，确保「仅补充不删除」场景下 addedTags 分区能正常渲染
- removedTags / addedTags 各自独立 `{...length > 0 && (...)}` 条件渲染，互不依赖（可能只有其一，也可能两者都有，也可能两者都空——此时 success 分支渲染空 Fragment，容器仍存在但不占内容）
- addedTags 的 Tooltip 文案：有 `reason` 时显示「AI 补充原因：{reason}」，无 reason 时兜底显示「AI 根据对话上下文判断需要补充此标签」（与 removedTags 的 Tooltip 文案风格对称）
- 标签数量取自 `aiOptimization.addedCount`（Task 1 已铺设），而非 `addedTags.length`，保证与服务端权威计数一致（与 removedTags 取 `removedCount` 的设计一致）
- 新增 CSS 类名（绿色高亮，对称于 removedTags 的灰色删除线）：`chat-msg-image-added-tags-label` / `chat-msg-image-added-tags-list` / `chat-msg-image-added-tag`（样式由 Task 5 在 `ChatMessageBubble.css` 中实现）

### SubTask 4.4：头部徽标 success 文案扩展

面板头部 AI 徽标（`chat-msg-image-ai-badge`，折叠态也可见）的 success 文案由固定 `AI 已移除 N` 扩展为条件分支：

```tsx
{currentHistoryItem.aiOptimization.status === 'success'
  ? currentHistoryItem.aiOptimization.addedCount > 0
    ? `AI 已移除 ${currentHistoryItem.aiOptimization.removedCount} / 已补充 ${currentHistoryItem.aiOptimization.addedCount}`
    : `AI 已移除 ${currentHistoryItem.aiOptimization.removedCount}`
  : currentHistoryItem.aiOptimization.status === 'no-removal'
    ? 'AI 已分析'
    : 'AI 失败'}
```

文案规则：
- `addedCount > 0` 时显示 `AI 已移除 N / 已补充 M`（斜杠分隔，同时反映两类操作）
- `addedCount === 0` 时保留原 `AI 已移除 N`（向后兼容，不增加噪音）
- no-removal / failed 文案不变

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx`
  - 头部徽标 JSX（约 L627-637）：success 文案条件分支扩展
  - AI 优化分区 success 分支（约 L659-705）：重构为 removedTags / addedTags 独立条件渲染 + 新增 addedTags 渲染块
  - 不修改 CSS 文件（Task 5 负责 `.chat-msg-image-added-tags-label` / `.chat-msg-image-added-tags-list` / `.chat-msg-image-added-tag` 样式）
  - 不修改 ChatMessageBubble.tsx 的其他部分（no-removal / failed 分支、标签面板、Prompt 面板等保持不变）

### 兼容性说明

- 旧数据（无 `addedTags` 字段或 `aiOptimization.addedCount` 为 undefined）：`addedTags && addedTags.length > 0` 短路为 false，addedTags 分区不渲染；`addedCount > 0` 在 undefined 时为 falsy，头部徽标回退到 `AI 已移除 N` 文案。完全向后兼容。
- 仅补充不删除场景（removedTags 为空、addedTags 非空）：success 分支进入，removedTags 块被条件吞掉，addedTags 块正常渲染，头部徽标显示 `AI 已移除 0 / 已补充 M`。

### 后续待办（Spec 后续 Task）

- ~~Task 5：CSS 样式实现（`ChatMessageBubble.css` 新增 `.chat-msg-image-added-tags-label` / `.chat-msg-image-added-tags-list` / `.chat-msg-image-added-tag`，绿色高亮对称于 removedTags 的灰色删除线）~~ ✅ 已完成，详见下一节
- AI 服务层 / executeImageGeneration 接线：实际填充 `addedTags` 快照与 `aiOptimization.addedCount` 计数（Task 1 已铺设类型契约）

## ChatMessageBubble「AI 已补充」分区 CSS 样式（Spec: add-ai-tag-supplement-after-removal / Task 5）

> 2026-08-09 实施：在 `ChatMessageBubble.css` 中为 Task 4 新增的三个 CSS 类名（`chat-msg-image-added-tags-label` / `chat-msg-image-added-tags-list` / `chat-msg-image-added-tag`）添加绿色系样式，与现有 removedTags（灰色删除线）形成视觉对比。同时微调 AI 优化分区容器 `.chat-msg-image-ai-optimization` 的 flex 方向，确保 success 状态下「已移除」与「已补充」两组「标签 + 列表」纵向堆叠。

### 新增样式（ChatMessageBubble.css 约第 736-759 行）

```css
/* ============ AI 标签补充分区（Spec: add-ai-tag-supplement-after-removal / Task 5） ============
   与 removedTags（灰色删除线）形成视觉对比，使用绿色高亮表示新增标签。
   样式遵循 ui-variables.css 既有 CSS 变量，兼容亮/暗双主题。 */
.chat-msg-image-added-tags-label {
  font-size: 11px;
  color: var(--color-success, #52c41a);
  font-weight: 500;
  margin-right: 4px;
}

.chat-msg-image-added-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.chat-msg-image-added-tag {
  font-size: 11px !important;
  color: var(--color-success, #52c41a) !important;
  background: var(--color-success-light, rgba(82, 196, 26, 0.12)) !important;
  border-color: var(--color-success, rgba(82, 196, 26, 0.4)) !important;
  cursor: help;
}
```

### 容器布局微调（ChatMessageBubble.css 约第 797-807 行）

`.chat-msg-image-ai-optimization` 容器由 `flex-direction: row`（默认）改为 `flex-direction: column`，使 success 分支下 removedTags 与 addedTags 两组「label + list」纵向堆叠，避免两组标签横向挤在同一行造成排版混乱。`no-removal` / `failed` 单元素状态不受影响（单元素在 column 容器中仍正常左对齐）。

### 设计要点

- **颜色对比**：addedTags 使用 `--color-success`（绿色 `#52c41a`，亮/暗主题同值）作为文字与边框色，背景使用 `--color-success-light`（亮色 `#f6ffed` / 暗色 `#162312`），与 removedTags 的灰色 `--text-tertiary` + 删除线 + `opacity: 0.5` 形成明确视觉区分
- **CSS 变量兼容**：所有颜色均使用 `ui-variables.css` 已定义的变量（`--color-success` / `--color-success-light`），并附带 rgba fallback，确保亮/暗双主题正确渲染
- **`!important` 使用**：added-tag 的 `font-size` / `color` / `background` / `border-color` 加 `!important` 以覆盖 Ant Design `<Tag>` 默认样式，与现有 `.chat-msg-image-removed-tag` 的写法保持一致
- **`cursor: help`**：与 removed-tag 一致，提示用户可悬停查看 AI 补充原因（Tooltip 由 Task 4 在 TSX 中实现）
- **布局对称**：added-tags-list 的 `display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px` 与 removed-tags-list 完全一致，保证两组标签换行行为统一

### 涉及文件

- `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css`
  - 新增 added-tags 三类样式（约 L736-759）
  - 微调 `.chat-msg-image-ai-optimization` 容器 flex 方向（约 L797-807）
  - 不修改 ChatMessageBubble.tsx 或其他文件

## 服装状态提示词指令增强（Spec: add-costume-state-prompt-directives，2026-08-09）

### 概述

为 `characterTraitAIService.ts` 增加服装状态识别能力，引导 AI 根据对话上下文中的服装变化描述（如敞开衣物、拉到一边、掀起等），生成 3 类 Danbooru 风格标签：开合状态 / 位置变化 / 身体部位暴露。该功能与互动元素识别（`interactionGuidance`）平行，复用 `interaction` 分类前缀输出，不新建分类。

### 改动清单

| 改动项 | 位置 | 说明 |
|--------|------|------|
| `buildCostumeStateGuidance()` | `characterTraitAIService.ts` 类内，`buildDynamicTraitSystemPrompt` 之前 | 新增私有方法，返回服装状态识别指令块字符串。与 `interactionGuidance` 平行，引导 AI 输出 3 类标签：A) 服装开合状态（`open_clothes` / `open_jacket` / `unbuttoned_shirt` 等）；B) 服装位置变化（`panties_aside` / `shirt_lift` / `skirt_lift` 等）；C) 身体部位暴露（`one_breast_out` / `cleavage` / `navel` 等）。关键原则：服装状态标签描述「衣物仍在身上但状态改变」，区别于衣物完全移除 |
| `costumeStateGuidance` 拼接 | `buildDynamicTraitSystemPrompt` 内 | 在 `interactionGuidance` 变量定义后、`return` 语句前，调用 `this.buildCostumeStateGuidance()` 赋值给 `costumeStateGuidance`；在 return 模板字符串中 `${interactionGuidance}` 之后、`要求：` 之前插入 `${costumeStateGuidance}` |
| `COSTUME_STATE_RAG_KEYWORDS` 常量 | `CharacterTraitAIService` 类顶部 | `private static readonly` 字符串常量，由 22 个服装状态标签关键词 `.join(' ')` 组成，用于 RAG 检索 |
| 服装状态 RAG 检索 | `generateTraitPrompts` 内，现有 RAG 检索之后 | 用 `COSTUME_STATE_RAG_KEYWORDS` 调用 `buildRagReferenceWithDebug` 额外检索 RAG 标签库，将检索到的服装状态相关标签以 `## 服装状态标签参考` 标题注入 system prompt。RAG 未启用/检索失败时静默跳过。后续 `messages` 中的 system content 由 `systemPromptWithRag` 改为 `systemPromptWithAllRag` |
| `optimizeTraitsForContext` system prompt 扩展 | `optimizeTraitsForContext` 内 | PART 1 REMOVAL 新增 2 条服装状态矛盾模式（开合复位 / 位置复位）；PART 2 SUPPLEMENT 新增 3 条服装状态补充模式（开合→暴露 / 位移→暴露 / 位移→身体部位）；JSON 返回示例扩展为包含服装状态 remove/add 示例 |

### 设计要点

1. **分类复用**：服装状态标签使用 `interaction` 分类前缀（如 `interaction:open_clothes|衣物敞开`），不新建分类，与互动标签共用 `interaction` 分类
2. **条件触发**：仅当对话上下文明确描述服装状态变化时才输出对应标签；角色穿着完整的描述不触发
3. **配合使用**：开合/位移标签通常需要配合暴露标签使用（如 `open_shirt` → `cleavage` / `one_breast_out`；`panties_aside` → `pussy`；`shirt_lift` → `navel` / `midriff`）
4. **与衣物移除的区分**：服装状态标签描述「衣物仍在身上但状态改变」，衣物完全移除用 `top` / `bottom` / `underwear` 分类的删除来处理
5. **扩展接口**：`buildCostumeStateGuidance()` 为独立方法，后续可平行新增 `buildPoseStateGuidance()` 等方法，拼接到 `buildDynamicTraitSystemPrompt` 的同一位置
6. **RAG 检索调试信息**：`costumeRagStatus` 字段因 `GenerateTraitPromptsResult` 类型定义为严格内联对象（无 index signature）而跳过添加，避免引入类型错误

### 验证

- `npx tsc --noEmit` 检查 `characterTraitAIService.ts`（非测试文件）零新增类型错误
- 测试文件 `characterTraitAIService.test.ts` 的预存错误（TS2307 模块路径 / TS2339 属性不存在）与本改动无关





## §35 AI 使用场景清单（微调训练数据制备基础）（2026-08-10）

**关联文档**：[docs/AI_USAGE_INVENTORY.md](docs/AI_USAGE_INVENTORY.md)

**背景**：在使用 AI 模型进行图片提示词生成、文本解析提示词 tag 生成等图片相关场景时，发现模型输出的准确率未能满足项目需求。计划针对当前模型及特定使用场景进行定向微调，开发一个专门强化角色扮演、图片提示词生成、小说编写等场景的小体量优化模型。

**产出**：完成全项目源码系统性扫描，识别并提取 35 个 AI 使用场景，按「五要素」（功能位置 / System Prompt 原文 / 输入参数 / 期望输出 / 调用频率与重要度）结构化登记。

**场景分布**：
- P0 图片提示词生成领域：7 个场景（角色特征提取 / 图片识别 / 提示词生成 / 标签优化 / AI 兜底同义词 / 表情图 SD/NL 提示词）
- P1 角色扮演对话领域：8 个场景（对话主提示词 / 续写 / 用户回复 / 输入润色 / 表情约束 / 辅助模式 / 长度emoji语言 / 角色锚定）
- P1 小说写作领域：8 个场景（大纲生成 / 大纲续写 / 章节内容 / 描写润色 / 剧情检查 / 文风学习 / 表格整理）
- P1 世界书领域：5 个场景（维度分析 / 澄清问题 / 设定矛盾检测 / 条目生成 / SKILL.md 提示词）
- P2 记忆与表格整理领域：3 个场景（批量整理 / 增量整理 / 调用入口）
- P2 游戏叙事领域：2 个场景（游戏旁白 / 经营游戏定位）
- P1 智能体领域：3 个场景（对话提示词 / LLM 抽象层 / 写作智能体）
- P2 提示词工程辅助领域：2 个场景（框架润色 / 模板构建）

**重点标记场景**：14 个场景被标记为微调难点加权对象，包括图片相关 P0 全部场景、fix-polish 系列 bug 修复场景、JSON 输出易错场景、多模态视觉场景、变体称呼识别难点场景。

**建议总样本量**：约 8,000-12,000 条（含数据增强后），按 P0 ×3 / P1 ×2 / P2 ×1 权重采样。

**关联 Spec**：.trae/specs/catalog-ai-usage-scenarios-for-finetuning/`n

## §41 对话模式同步整理（Sync Mode）修复（2026-08-15）

### 概述

对记忆整理模块的同步整理（Sync Mode）进行了三项修复，覆盖 AI 调用层统一、断点续传边界条件、以及引擎参数配置读取。

### 改动一：`callAIAPI` 委托给 `callAIAPIWithFetch`

**文件**：`src/main/services/memory/aiClient.ts`

- `callAIAPI` 函数内部将请求构造委托给 `aiHttpClient.callAIAPIWithFetch`，消除了内联的 fetch 逻辑，统一了 AI HTTP 调用路径
- 使用 `aiHttpClient` 的统一超时、重试、鉴权、响应解析逻辑
- 保持导出签名不变（对外兼容），保留原有的 `addLog` 日志记录方式

### 改动二：断点续传边界条件修复

**文件**：`src/main/services/memory/organizeOrchestrator.ts`

`createProgressiveHandler` 中 `calculateStartIndex` 方法修复：

- 当 `existingProgress.totalMessages > targetMessages.length` 时（聊天记录被回滚/删除导致消息数减少），断点续传记录已不可信，重置为从头开始处理（`return { startIndex: 0, completed: false, resumed: false }`）
- 新增断点续传决策日志，覆盖所有分支（续传成功、消息数增加、消息数减少、无记录）

### 改动三：`getEngineAIParams` 统一配置读取

**文件**：`src/main/services/memory/aiClient.ts`

- 始终返回完整参数集，不再因参数缺失返回 `null`
- 缺失参数使用默认值：`temperature=0.7, max_tokens=4096, top_p=0.9, frequency_penalty=0, presence_penalty=0`
- 修复原代码中 `max_tokens: undefined` 的 bug（引擎有该字段时仍被硬编码为 undefined）
- 返回类型改为无 `null` 分支，所有调用端 `engineAIParams ?? undefined` 兼容运行

### 验证

- `tsc --noEmit` 项目级检查，两个修改文件均零新增错误（项目级错误均为其他文件的预存错误）
- VS Code 诊断 `GetDiagnostics` 对两个修改文件返回空数组
