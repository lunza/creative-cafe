# Tasks

> 依赖原则：先备份（T1）→ 渲染层删除（T2-T4）→ 主进程/共享层（T5-T7）→ 依赖核对（T8）→ 静态验证（T9）→ 运行时回归（T10）→ 文档（T11）→ 收尾提交（T12）。
> T2-T7 之间无强依赖可并行，但为控制回滚成本建议顺序执行；每完成一个任务立即跑一次 `npm run typecheck` 快速止损。

- [ ] Task 1: 删除前备份存档
  - [ ] SubTask 1.1: `git status` 确认工作区无与本任务无关的未提交改动（有则先与用户确认处理方式）
  - [ ] SubTask 1.2: 提交当前状态（message: `chore: snapshot before removing writing mode v1`）并打 tag `pre-remove-writing-v1`
  - [ ] SubTask 1.3: `git tag -l pre-remove-writing-v1` 验证 tag 存在
- [ ] Task 2: 删除 V1 渲染层独占文件
  - [ ] SubTask 2.1: 删除目录 `src/renderer/components/Creative/WritingMode/`（55 文件）
  - [ ] SubTask 2.2: 删除 `src/renderer/stores/writingProjectStore.ts`、`writingModeStore.ts`、`writingModeUIStore.ts`、`index.ts`
  - [ ] SubTask 2.3: 删除 `src/renderer/constants/writingModeConstants.ts`、`src/renderer/utils/outlineVersionUtils.ts`、`src/renderer/utils/ImpactAnalyzer.ts`、`src/renderer/services/AIEditService.ts`
  - [ ] SubTask 2.4: `npm run typecheck` 确认剩余报错均指向 Task 3 待改文件（CreationCenter / electron.d.ts）
- [ ] Task 3: 清理 CreationCenter V1 入口
  - [ ] SubTask 3.1: 移除 `WritingModeEntry` lazy 导入、V1 卡片渲染、`showWritingDialog` 状态与 V1 FullscreenDialog
  - [ ] SubTask 3.2: 「写作模式 2.0」卡片保留；确认卡片文案/徽标是否需微调（默认：保留原样，仅文案中"经典"等 V1 对比措辞清理）
- [ ] Task 4: 清理 V1 preload 命名空间与类型声明
  - [ ] SubTask 4.1: `src/main/preload.ts` 删除 V1 `writing` 命名空间（L629-790 区域，含 chunk/polish 事件订阅方法）；`writingV2` 命名空间零改动
  - [ ] SubTask 4.2: `src/renderer/types/electron.d.ts` 删除 V1 `writing` 命名空间声明、`writing-agent.types` 导入、`writing.agent` 子命名空间；`writingV2: WritingV2API` 保留
  - [ ] SubTask 4.3: `npm run typecheck`
- [ ] Task 5: 删除主进程 V1 独占模块
  - [ ] SubTask 5.1: 删除 `src/main/ipc/handlers/writing/writingAgentHandlers.ts`
  - [ ] SubTask 5.2: 删除目录 `src/main/services/agent/writing/`（writingAgentService / writingAgentTypes / index）
  - [ ] SubTask 5.3: 删除 `src/main/services/writing/ChapterChunkService.ts`、`src/main/services/writing/DescriptionPolisher.ts`、`src/shared/types/writing-agent.types.ts`
  - [ ] SubTask 5.4: `src/main/ipc/handlers/writingHandlers.ts` 移除 agent handler 的导入/注册/再导出（`abortActiveWritingAgent` 一并移除）
  - [ ] SubTask 5.5: `src/main/index.ts` 移除 `abortActiveWritingAgent` 导入与 L94 / L167 两处调用
  - [ ] SubTask 5.6: `npm run typecheck`
- [ ] Task 6: 删除 handler 内 V1 独占通道
  - [ ] SubTask 6.1: `writingChapterHandlers.ts`：删 `writing:generateChapter` / `generateChapterChunk` / `cancelChunkGeneration` / `generateChunkSummary` / `saveChunkCheckpoint` / `getChunkCheckpoint` / `clearChunkCheckpoint` + `chapterChunkService` 导入；保留 `activeAbortControllers` / cancelGeneration / shard / DeAi / 拆并
  - [ ] SubTask 6.2: `writingProjectHandlers.ts`：删 `writing:exportProject` / `saveProjectRaw` / `saveAIGenerationHistory` / `loadAIGenerationHistory` / `clearAIGenerationHistory`
  - [ ] SubTask 6.3: `writingOutlineHandlers.ts`：删 `writing:saveOutline` / `outline:update` / `outline:save` / `outline:load` / `continueOutline`
  - [ ] SubTask 6.4: `writingStyleHandlers.ts`：删 `writing:polishDescription` + `descriptionPolisher` 导入
  - [ ] SubTask 6.5: `WritingStorageService.ts`：删 chunk checkpoint 三个代理方法与仅 V1 通道使用的 AI 生成历史存储方法（先 grep 确认无其他消费方）
  - [ ] SubTask 6.6: 以 preload `writingV2` 命名空间实际 invoke 清单逐条比对，确认无 V2 依赖通道被误删
- [ ] Task 7: 修剪共享类型（writing.types.ts）
  - [ ] SubTask 7.1: 基于 typecheck 结果识别零引用的 V1 专属类型（chunk 流水线类型等），删除
  - [ ] SubTask 7.2: `WritingProject` / `WritingConfig` / `GeneratedOutline` 等落盘数据形状类型一律保留；`npm run typecheck` 零新增错误
- [ ] Task 8: 依赖核对（package.json）
  - [ ] SubTask 8.1: 汇总已删除 V1 文件的 import 集合，与 `src/` 其余文件比对，确认无 V1 独占依赖
  - [ ] SubTask 8.2: 若发现独占依赖则从 `package.json` 移除并 `npm ls <pkg>` 验证；预期结论为"无独占依赖，package.json 不动"
- [ ] Task 9: 静态验证
  - [ ] SubTask 9.1: `npm run typecheck` 零新增错误
  - [ ] SubTask 9.2: `npm test` 不劣于基线（1466+ passed / 2 预存 failed）
  - [ ] SubTask 9.3: 残留扫描：`src/` 内 grep `WritingMode['"]`（排除 WritingModeV2）、`writingModeStore|writingProjectStore|writingModeUIStore`、`writing-agent`、`generateChapterChunk`、`polishDescription`、`saveAIGenerationHistory`，零残留（注释中的历史提及可保留）
- [ ] Task 10: 运行时回归（dev server 自动重启）
  - [ ] SubTask 10.1: 按 AGENTS.md 规则重启 dev server（查 vite/node 进程 → Stop-Process → `npm run dev` 后台）
  - [ ] SubTask 10.2: 创意中心仅剩「写作模式 2.0」卡片；打开 V2 界面渲染正常
  - [ ] SubTask 10.3: V2 冒烟：项目列表加载 → 打开 V1 旧项目（数据完整）→ 新建项目 → 大纲（手动或 AI）→ 分片生成（可只跑 1 分片）→ 导出 TXT 成功
  - [ ] SubTask 10.4: 记录构建体积对比（移除前后 `npm run build` 产物大小），写入验证记录
- [ ] Task 11: 文档更新
  - [ ] SubTask 11.1: `.trae/documents/技术文档.md`：删除/改写 V1 章节（37 处引用），保留并校对 V2 章节
  - [ ] SubTask 11.2: `CODE_WIKI.md`：删除 V1 章节（21 处引用）
  - [ ] SubTask 11.3: `docs/user-manual.md`：写作模式说明更新为 2.0（5 处引用）
  - [ ] SubTask 11.4: `CHANGELOG.md`：新增移除条目
  - [ ] SubTask 11.5: `.trae/documents/小说写作模式自定义设置功能开发计划.md`：头部标注"历史归档（V1 功能计划，功能已由写作模式 2.0 取代）"
- [ ] Task 12: 收尾提交
  - [ ] SubTask 12.1: `git status` 全量核对删除/修改清单与本 spec 一致
  - [ ] SubTask 12.2: 分两条提交：`refactor: remove writing mode v1 (renderer + main + shared)`、`docs: update docs after removing writing mode v1`（message 说明回滚方式：tag pre-remove-writing-v1）

# Task Dependencies
- Task 1 最先执行（备份）
- Task 2 是 Task 3/4 的前置（先删文件，改引用不会反复）
- Task 4 依赖 Task 2（electron.d.ts 删除的 V1 命名空间需与 preload 成对）
- Task 5/6/7 依赖 Task 4（类型声明先行，避免中间态噪音）
- Task 8 依赖 Task 2/5（删除完成后才能核对 import 面）
- Task 9 依赖 Task 2-8 全部完成
- Task 10 依赖 Task 9
- Task 11 依赖 Task 10（运行时确认功能无误后再定稿文档）
- Task 12 依赖 Task 11
