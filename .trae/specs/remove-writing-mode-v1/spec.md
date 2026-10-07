# 移除写作模式 1.0 Spec

## Why

写作模式 2.0（`WritingModeV2`）已完成全部 Phase（含整合 E2E 测试通过，见 `test-writing-v2-integrated-e2e`）并达到生产就绪状态，成为写作功能的唯一入口。写作模式 1.0（`WritingMode`，渲染层约 14,500 行 / 55+ 文件 + 3 个 V1 专属 store + V1 专属 IPC 通道约 25 个 + V1 专属主进程服务 4 个）已成为纯维护负担：chunk/shard 双流水线中的 chunk 侧、内嵌写作智能体、描述润色、断点续传 checkpoint、AI 生成历史等能力在 V2 中均已被替代或舍弃，继续保留会放大回归风险与认知成本。

本次变更对写作模式 1.0 及其独占依赖执行**完整移除**，共享服务层（主进程生成/检查/整理引擎、仓库层、类型/常量契约、`writingV2` IPC 契约）保持零行为变更，V1 项目数据文件不迁移、V2 仍可打开。

## 关键决策（基于代码侦察结论）

| 决策项 | 结论 | 依据 |
|--------|------|------|
| 移除边界 | 渲染层 V1 目录 + V1 专属 store/常量/工具 + V1 专属主进程服务/handler 通道 + V1 preload 命名空间 | V2 仅依赖 `window.electronAPI.writingV2`（preload 中直接 invoke 同名 `writing:*` 通道），不依赖 V1 `writing` preload 命名空间 |
| 主进程共享服务 | **全部保留**：OutlineGenerator / ContentGenerator / PromptBuilder / PlotCheckerService / TableOrganizeService / LogicCheckRecorder / AIAssistedChapterService / CrossChapterReviewService / WritingPipelineService / WritingStorageService / WritingResourceManager / WritingStyleLearningService / 4 个 Repository / NovelTypeTemplates / `writingTableTemplates` 常量 / `v2ExportContent` 工具 | 被 `writingV2` 命名空间复用的 `writing:*` 通道 handler 直接调用这些服务 |
| `writing.types.ts` | **保留文件**，仅修剪移除后零引用的 V1 专属类型（chunk 流水线类型等） | V2（`writing-v2.types.ts`、`v2ExportContent.ts`）与主进程服务均从此文件导入类型；`WritingProject` 落盘数据格式需保持兼容 |
| `writing.constants.ts` | **保留**（`AUTO_SAVE_DELAY` 被 creativeStore 与 V2 store 使用；超时/标签常量被主进程共享服务使用） | 已验证引用 |
| `package.json` 依赖 | 预计无 V1 独占依赖（V1 仅使用 antd / react-markdown 等全局共享库）；实施时逐项核对后确认 | 已核对依赖清单与 V1 文件导入面 |
| V1 项目数据 | **不迁移、不清理**，磁盘数据保留，V2 可继续打开 | 与 V2 架构规则「数据兼容」一致 |
| 备份方式 | 删除前 git 提交当前状态 + 打 tag `pre-remove-writing-v1`，历史代码通过版本控制追溯（不额外打包归档） | 用户步骤 5 要求 |

## What Changes

### 删除（渲染层，V1 独占）
- `src/renderer/components/Creative/WritingMode/` 整个目录（55 文件：WritingModeEntry / ContentWorkspace / 全部大纲与表格组件 / 10 个 hooks / 2 个 CSS）
- `src/renderer/stores/writingProjectStore.ts`、`writingModeStore.ts`、`writingModeUIStore.ts`（3 个 V1 store）
- `src/renderer/stores/index.ts`（barrel 仅导出 writingModeUIStore，已验证无消费方）
- `src/renderer/constants/writingModeConstants.ts`（仅被 V1 文件引用）
- `src/renderer/utils/outlineVersionUtils.ts`、`src/renderer/utils/ImpactAnalyzer.ts`（仅被 V1 组件引用）
- `src/renderer/services/AIEditService.ts`（仅被 V1 组件引用，含 `writing:continueOutline` 裸调）

### 删除（主进程 + 共享，V1 独占）
- `src/main/ipc/handlers/writing/writingAgentHandlers.ts`（`writing-agent:run/cancel/status/resume` + progress 事件，内嵌写作智能体）
- `src/main/services/agent/writing/` 整个目录（writingAgentService.ts 1028 行 / writingAgentTypes.ts / index.ts）
- `src/main/services/writing/ChapterChunkService.ts`（chunk 分块流水线，仅 `writing:generateChunkSummary` 使用）
- `src/main/services/writing/DescriptionPolisher.ts`（`writing:polishDescription` 描述润色，仅 V1 调用）
- `src/shared/types/writing-agent.types.ts`（类型真源，仅被上述 V1 代码与 electron.d.ts 引用）

### 修改
- `src/renderer/components/Chat/CreationCenter.tsx`：移除「写作模式」卡片、lazy 导入、`showWritingDialog` 状态与 FullscreenDialog；「写作模式 2.0」卡片保留（可顺带去掉 2.0 版本徽标与版本区分样式——实施时确认文案后决定）
- `src/main/preload.ts`：删除 V1 `writing` 命名空间（约 L629-790，含 chunk 事件监听与 polish 事件监听）；`writingV2` 命名空间零改动
- `src/renderer/types/electron.d.ts`：删除 V1 `writing` 命名空间声明、`writing-agent.types` 导入与 `writing.agent` 子命名空间声明；`writingV2` 声明零改动
- `src/main/ipc/handlers/writingHandlers.ts`：移除 `registerWritingAgentHandlers` / `abortActiveWritingAgent` 的导入、注册与再导出
- `src/main/index.ts`：移除 `abortActiveWritingAgent` 导入与 will-navigate / 退出两处调用
- `src/main/ipc/handlers/writing/writingChapterHandlers.ts`：删除 V1 独占通道 `writing:generateChapter`、`writing:generateChapterChunk`、`writing:cancelChunkGeneration`、`writing:generateChunkSummary`、`writing:saveChunkCheckpoint`、`writing:getChunkCheckpoint`、`writing:clearChunkCheckpoint` 及 `chapterChunkService` 导入；保留 shard / DeAi / 拆并 / `activeAbortControllers` 等 V2 复用部分
- `src/main/ipc/handlers/writing/writingProjectHandlers.ts`：删除 V1 独占通道 `writing:exportProject`、`writing:saveProjectRaw`、`writing:saveAIGenerationHistory`、`writing:loadAIGenerationHistory`、`writing:clearAIGenerationHistory`；保留 loadProjects / createProject / saveProject / deleteProject / loadResources / autoSaveChapter / saveVersion / restoreVersion
- `src/main/ipc/handlers/writing/writingOutlineHandlers.ts`：删除 V1 独占通道 `writing:saveOutline`、`writing:outline:update`、`writing:outline:save`、`writing:outline:load`、`writing:continueOutline`；保留 `writing:generateOutline`
- `src/main/ipc/handlers/writing/writingStyleHandlers.ts`：删除 `writing:polishDescription` 通道与 `descriptionPolisher` 导入；保留 `writing:style:*` 全部通道
- `src/main/services/WritingStorageService.ts`：删除仅 chunk 通道使用的 `saveChunkCheckpoint` / `loadChunkCheckpoint` / `clearChunkCheckpoints` 代理方法（及 AI 生成历史存储方法，若仅 V1 通道使用）
- `src/shared/types/writing.types.ts`：修剪删除后零引用的 V1 专属类型（chunk 请求/状态类型等）；`WritingProject` 等落盘数据形状类型不动

### 文档
- `.trae/documents/技术文档.md`（37 处引用）：删除/改写 V1 章节，保留 V2 章节
- `CODE_WIKI.md`（21 处引用）：同上
- `docs/user-manual.md`（5 处引用）：更新写作模式说明为 2.0
- `CHANGELOG.md`：新增「移除写作模式 1.0」条目（历史条目不改写）
- `.trae/documents/小说写作模式自定义设置功能开发计划.md`：标注为历史归档文档（V1 功能计划）

### 依赖
- `package.json`：逐项核对 V1 文件 import 集合与全库其余部分，确认无独占依赖后保持不动（若发现独占依赖则移除并记录）

## Impact
- Affected specs: `refactor-writing-mode-v2`（本次移除其 Phase 4「V1 标注为经典模式」后的 V1 本体）、`test-writing-v2-integrated-e2e`（验收基线，V2 行为不变）
- Affected code:
  - 删除：`src/renderer/components/Creative/WritingMode/**`、3 个 V1 store、`writingModeConstants.ts`、`outlineVersionUtils.ts`、`ImpactAnalyzer.ts`、`AIEditService.ts`、`writingAgentHandlers.ts`、`services/agent/writing/**`、`ChapterChunkService.ts`、`DescriptionPolisher.ts`、`writing-agent.types.ts`
  - 修改：`CreationCenter.tsx`、`preload.ts`、`electron.d.ts`、`writingHandlers.ts`、`main/index.ts`、4 个 writing handler 文件、`WritingStorageService.ts`、`writing.types.ts`（仅修剪）
  - 零改动（共享层）：`WritingModeV2/**`、`writingV2Handlers.ts`、`writingPipelineHandlers.ts`、`services/writing/` 其余服务、`shared/types/writing-v2.types.ts`、`shared/constants/writing.constants.ts`、`writingTableTemplates.ts`
- Not affected: 聊天模式、角色卡、世界书（含 worldbook 编写智能体——其对 writing-agent.types 的引用仅为注释）、AgentCenter、`writing:pipeline:*` 全流程流水线（V2 子能力）

## REMOVED Requirements

### Requirement: 写作模式 1.0 入口与 UI
**Reason**: 已被写作模式 2.0 完整替代并达到生产就绪
**Migration**: 创意中心仅保留「写作模式 2.0」卡片；V1 项目数据不迁移，V2 项目列表兼容打开 V1 项目

### Requirement: chunk 分块生成流水线（断点续传 checkpoint / 分片摘要）
**Reason**: V2 仅保留 shard 分片流水线（`refactor-writing-mode-v2` 已确认舍弃 chunk 体系）
**Migration**: 无；磁盘遗留 checkpoint 文件不影响 V2

### Requirement: 写作内嵌智能体（writing-agent:* 通道 + WritingAgentModal）
**Reason**: `refactor-writing-mode-v2` 已确认 V2 不迁移内嵌智能体，能力由统一 AgentCenter 承接
**Migration**: 无 UI 入口迁移

### Requirement: 描述润色（writing:polishDescription + DescriptionPolisher）
**Reason**: 仅 V1 调用（V2 preload 命名空间无 polish 通道）
**Migration**: 无

### Requirement: AI 生成历史（save/load/clearAIGenerationHistory）与 V1 全量导出（exportProject）
**Reason**: V1 专属；V2 导出走 `writingV2:exportWithChapters`（TXT/Markdown/JSON + 章节多选）
**Migration**: 无

### Requirement: V1 preload `writing` 命名空间
**Reason**: V2 经独立 `writingV2` 命名空间直接 invoke 同名通道，V1 命名空间在渲染层仅剩 V1 文件消费
**Migration**: 无（渲染层契约以 `writingV2` 为准）

## ADDED Requirements

### Requirement: 删除前备份存档
执行删除前 SHALL 先提交当前工作区状态并打 tag `pre-remove-writing-v1`，保证 V1 代码可通过 `git checkout pre-remove-writing-v1` 完整恢复。
#### Scenario: 回滚
- **WHEN** 删除后发现遗漏依赖需要回滚
- **THEN** 执行 `git reset --hard pre-remove-writing-v1` 即可完整恢复 V1

### Requirement: 移除后创意中心
创意中心 SHALL 仅展示「写作模式 2.0」写作入口；点击打开 V2 全屏对话框，功能与移除前完全一致。
#### Scenario: 打开写作入口
- **WHEN** 用户在创意中心点击写作模式卡片
- **THEN** 打开 V2 界面（项目列表/大纲/创作/素材与风格各阶段可用），无 V1 卡片残留

### Requirement: V2 全功能回归
移除 V1 后，V2 的项目 CRUD、AI/手动大纲、分片生成、章节编辑/拆并、剧情检查（含 DeAi）、跨章审查、表格整理、素材绑定、风格学习、模板管理、版本快照、导出（TXT/MD/JSON）、全流程流水线 SHALL 全部保持可用。

## MODIFIED Requirements

### Requirement: 主进程 writing IPC handler 集合
`writingHandlers.ts` 聚合的 handler 模块 SHALL 不再注册 `registerWritingAgentHandlers`；各 handler 文件内仅保留被 `writingV2` 命名空间或 `writingV2Handlers` 复用的通道。
#### Scenario: 启动
- **WHEN** 应用启动
- **THEN** 所有 `writingV2` 命名空间通道注册成功，V2 功能正常；已删除通道不再有 `ipcMain.handle` 注册

## 风险与对策
| 风险 | 等级 | 对策 |
|------|------|------|
| 误删 V2 复用的 `writing:*` 通道 handler | 高 | 以 preload `writingV2` 命名空间（L816-1220）实际 invoke 的通道清单为准逐一比对；删除后 typecheck + V2 全流程冒烟 |
| `writing.types.ts` 修剪误删共享类型 | 中 | 只删 typecheck 证实零引用的类型；`WritingProject` 落盘形状一律不动 |
| electron.d.ts 与 preload 不同步 | 中 | 两者同任务内成对修改，typecheck 把关 |
| 文档引用残留 | 低 | 移除后全库 grep「写作模式 1.0 / 经典模式 / WritingMode(/) / writingModeStore」做残留扫描（specs 目录除外，历史 spec 保留） |

## 验证计划
- `npm run typecheck`：零新增错误
- `npm test`：不劣于当前基线（1466+ passed / 2 预存 failed）
- 运行时（dev server 自动重启后）：创意中心仅剩 V2 卡片；V2 新建项目→大纲→分片生成→编辑→导出全链路冒烟；打开 V1 旧项目数据完整性抽查
- 残留扫描：`WritingMode['"]`、`writingModeStore`、`writing-agent`、`generateChapterChunk`、`polishDescription` 等关键标识符在 `src/`（非 specs）中零残留（`WritingModeV2` 目录自身除外）
- 性能观察：记录移除前后 Vite 构建/首屏体积对比（V1 为 lazy 模块，预期主包不变、总包体下降），写入验证记录
