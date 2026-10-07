# Tasks

> 本次变更的交付物是**重构计划文档本身**（用户明确：仅编写文档，不进行任何实际代码变更）。
> 文档中的 Phase 0-4 代码实施计划已写入 spec.md，待用户批准计划后另起 spec 执行。

- [x] Task 1: 写作模式 V1 现状全面分析
  - [x] SubTask 1.1: 入口盘点（CreationCenter 有效入口 + CreativeSubNav 死入口确认）
  - [x] SubTask 1.2: 代码规模盘点（渲染层 65 文件/主进程服务/IPC 通道数/类型文件）
  - [x] SubTask 1.3: 底层架构逐层评估（类型/数据/服务/IPC/状态/UI 六层）
  - [x] SubTask 1.4: 功能优缺点总结与缺陷确认（ProjectStatus 错配、TS2739、DEBUG 残留、EXPORT 空壳）
- [x] Task 2: 与用户确认关键决策
  - [x] SubTask 2.1: 实现策略（平行 V2）
  - [x] SubTask 2.2: 上线节奏（分阶段 P0/P1/P2）
  - [x] SubTask 2.3: 功能取舍（chunk/死入口/内嵌智能体/EXPORT 空壳）
  - [x] SubTask 2.4: 新入口命名（写作模式 2.0）
- [x] Task 3: 编写重构计划文档 spec.md
  - [x] SubTask 3.1: 现状分析报告（入口/规模/架构/优缺点/缺陷/功能处置清单）
  - [x] SubTask 3.2: V2 目标架构（分层图/目录结构/状态规则/流水线/IPC 契约/入口设计）
  - [x] SubTask 3.3: 实施步骤（Phase 0-4）与时间规划
  - [x] SubTask 3.4: 风险对策与验证计划
- [x] Task 4: 按 checklist.md 逐项验证文档完整性

# Task Dependencies
- Task 2 依赖 Task 1（基于分析结论提问）
- Task 3 依赖 Task 1 + Task 2
- Task 4 依赖 Task 3

# 执行记录（用户批准计划后实际实施，主对话内完成，未用子代理）

## Phase 0 骨架（已完成）
- [x] `src/shared/types/writing-v2.types.ts` 类型契约（WritingV2API + 结果信封 + 流式事件载荷）
- [x] `preload.ts` 新增 `writingV2` 命名空间（复用 writing:* 通道 + 2 个 V2 专用通道）
- [x] `electron.d.ts` 声明 `writingV2`；`services/writingV2Service.ts` 封装层
- [x] `CreationCenter.tsx` 新增"写作模式 2.0"入口（青色主题 + 2.0 徽章 + 独立 FullscreenDialog）
- [x] `WritingModeV2/` 目录骨架 + 4 阶段占位 Entry + 3 个 store + `v2Labels.ts`
- [x] V1 死 Tab 清理（CreativeSubNav）；typecheck V2 文件零错误

## Phase 1 / P0 核心创作流（已完成，2026-09-29）
- [x] P1-1 侦察：确认 V1 `writing:exportProjectWithChapters` 主进程空壳、`writing:saveOutline` 会新建项目
- [x] P1-2 主进程 `writingV2Handlers.ts`：`writingV2:parseOutline` + `writingV2:exportWithChapters`
- [x] P1-3 store 三件套（project 投影防抖落盘 / generation 分片状态机 / ui 阶段路由）
- [x] P1-4 项目列表 + 3 步新建向导
- [x] P1-5 大纲工作台（AI 流式 + 手动双模式 + 确认进入创作）
- [x] P1-6 章节工作台（分片流水线 + 防抖编辑 + AI 拆并 `V2SplitMergeActions` + `chapterStructureVersion` 重载）
- [x] P1-7 导出对话框（TXT/Markdown + 章节多选）
- [x] P1-8 `WritingV2Entry` 4 阶段完整路由（阶段禁用规则 + 返回导航 + 全局弹窗挂载）
- [x] P1-9 验证：typecheck V2 零错误；测试 1414 passed / 2 failed（基线不变）；dev server 自动重启

## 执行期踩坑（已重点标记于 CODE_WIKI.md「写作模式 2.0」章节 ⚠️ 部分）
- `writingV2Handlers.ts` 相对路径深度错误（5 处 TS2307）
- `writing-v2.types.ts` 枚举须值导入+值导出（TS2300 重复标识符）
- 规避 V1 `PROJECT_STATUS_LABELS` 无效枚举引用缺陷（V2 自建标签表）

## Phase 2 / P1 质量与结构化（已完成，2026-09-29）
- [x] 类型契约：P2 剧情检查 + 表格领域类型（V2PlotCheckResult / V2TableAPI / V2TableOrganizeProgressEvent 等）
- [x] preload `writingV2` 扩展：5 个剧情检查方法 + 嵌套 `table` 命名空间（15 方法 + onOrganizeProgress）
- [x] `plotcheck/`：V2PlotCheckPanel（报告/单条修正/批量修正）+ V2PlotIssueList + V2PlotCheckModals（逻辑记录弹窗）
- [x] `table/`：V2TablePanel（模板绑定/AI 整理+进度/sheet 预览/快照确认回滚）
- [x] 右栏多 Tab 面板（流水线/剧情检查/表格）+ 拖拽调整宽度；修复 V2ChapterWorkbench hooks 顺序缺陷
- [x] 验证：typecheck V2 零错误；测试 1414/2 基线不变；dev server 已重启

## Phase 3 / P2 扩展能力（已完成，2026-09-29）
- [x] 类型契约：V2ResourceAPI / V2StyleAPI / V2TemplateAPI + 10 个结果类型 + WritingStyleStatus 值导出
- [x] preload `writingV2.resources/style/templates` 三命名空间（主进程零改动）
- [x] `assets/`：素材绑定（四组多选 + 落盘）/ 风格学习（上传/轮询/报告/删除/取消）/ 模板管理（预置只读 + 自定义 CRUD）+ V2AssetsStage 容器
- [x] 左栏第 5 阶段「素材与风格」（assets 阶段无需项目即可用风格/模板）
- [x] 单测 `v2ResourceUtils.test.ts` 9/9；全量 1434 passed / 2 failed（预存）；typecheck V2 零错误
- [x] **Bug 修复（重点标记）**：新建项目"创建失败"——antd Form 随 Steps 卸载后 getFieldsValue 取空 → 主进程 substring TypeError；三层修复（步骤切换捕获值 / 主进程 IPC 边界防护 / store lastCreateError 错误透出），用户验证创建成功
- [x] TRAE-debugger 会话 v2-p3-features 收尾：插桩/Debug Server/debug 文件已清理；CSP 拦截本地 Debug Server fetch 的教训已记入 CODE_WIKI

## Phase 4 / 版本快照 + JSON 导出（已完成，2026-09-29）
- [x] `writing/V2VersionHistoryModal.tsx`：手动快照（备注）+ 历史列表（自动存档可见）+ 恢复（Popconfirm）；恢复前取消防抖避免覆盖
- [x] 导出构建器提取 `src/shared/utils/v2ExportContent.ts`（纯函数，主进程+单测共用）+ JSON 契约 + `.json` 扩展名 + 对话框 JSON 选项
- [x] 单测 `v2ExportContent.test.ts` 12/12（测试首跑抓到 wordCount 未 trim 缺陷→修复）；全量 1446/2（预存）；typecheck V2 零错误；dev server 已重启

## Phase 5 / 审阅增强 + 模板分离（已完成，2026-09-29）
- [x] **写作/对话表格模板分离（用户反馈重点标记）**：shared 内置 3 套写作模板 + 主进程注册器（内置优先/记忆库兜底兼容存量）+ getAllTemplates 与 TableOrganizeService 三处解析切换 + V2 面板预选 ⭐默认
- [x] 剧情检查：检查历史（chapter.plotCheckHistory，最近 20 条）+ 评分趋势条 + 全书批量检查（串行/可取消/结果汇总/查看跳转）
- [x] 单测 `writingTableTemplates.test.ts` 6/6；全量 1452/2（预存）；typecheck V2 零错；dev server 已重启

## Phase 6 / 表格面板全面升级（已完成，2026-09-29）
- [x] 数据编辑：V2TableView 行内编辑/增删行/保存/清空本表/导出 CSV（BOM）
- [x] 细粒度整理：整表+跳过已整理 / 整理当前表 / 章节状态弹窗 / 单行 AI 重整理（补 V2 preload reorganizeRow）
- [x] 模板 CRUD：V2TemplateManager（内置只读+自定义增删改）+ 主进程 saveTableTemplate/deleteTableTemplate（自定义存 table-templates.json，内置 id 保护）
- [x] 纯函数 v2TableUtils（CSV/合并/校验/摘要）+ 单测 11/11；全量 1463/2（预存）；typecheck V2 零错；dev server 已重启

## Phase 7 / 报告导出 + 整理中断（已完成，2026-09-29）
- [x] 全书检查报告导出：buildBookCheckMarkdown 纯函数（总览表+章节明细+失败标注）+ 面板「导出报告」→ .md 下载 + 单测 3 用例
- [x] 表格整理真实中断：cancelFlags（章节级+分片级检查点）+ writing:table:cancelOrganize 通道 + UI「取消整理」；已处理部分保留且仍产生待确认快照
- [x] 全量 1466/2（预存）；typecheck V2 零错；dev server 已重启

## 待办（范围外/后续）

无（Phase 0-7 计划内能力全部交付）
