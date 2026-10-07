# Checklist

## 备份与版本控制
- [x] 删除前 git 快照提交完成，tag `pre-remove-writing-v1` 存在且可检出（commit 552f3e1）
- [x] 最终删除变更已分条提交（代码 / 文档），提交信息含回滚方式说明（e3fb56b / f7190e9）

## V1 代码文件清理
- [x] `src/renderer/components/Creative/WritingMode/` 目录已整体删除
- [x] 3 个 V1 store（writingProjectStore / writingModeStore / writingModeUIStore）与 `stores/index.ts` barrel 已删除
- [x] `writingModeConstants.ts` / `outlineVersionUtils.ts` / `ImpactAnalyzer.ts` / `AIEditService.ts` 已删除
- [x] 主进程 V1 独占模块已删除：`writingAgentHandlers.ts`、`services/agent/writing/` 目录、`DescriptionPolisher.ts`、`shared/types/writing-agent.types.ts`；`ChapterChunkService.ts` 按修订方案修剪（保留 V2 使用的 3 个方法，删除 V1 独占 2 个方法）

## 依赖与通道处理
- [x] preload V1 `writing` 命名空间已删除，`writingV2` 命名空间零改动
- [x] `electron.d.ts` 与 preload 成对同步（V1 命名空间与 writing-agent 类型声明已删）
- [x] `writingHandlers.ts` / `main/index.ts` 中 agent handler 注册与 `abortActiveWritingAgent` 调用已移除
- [x] 各 handler 文件 V1 独占通道已删除（chunk 系列 / exportProject / saveProjectRaw / AI 生成历史 3 通道 / saveOutline 及 outline:* / continueOutline / polishDescription）
- [x] 已用 preload `writingV2` 命名空间实际 invoke 清单逐条比对，V2 依赖通道无一误删（含多行注册形式的 `writing:cancelGeneration` 人工确认）
- [x] `package.json` 依赖核对完成，结论已记录（70 个已删文件 import 面核对，无独占依赖）

## 引用清理
- [x] `CreationCenter.tsx` 仅剩「写作模式 2.0」入口，V1 卡片/lazy 导入/状态/Dialog 全部移除
- [x] typecheck 零新增错误（签名对比法：基线 771 / 当前 599 / 0 新增 / 172 修复；注意 `npm run typecheck` 因 node_modules/.bin 缺失不可用，用 `node node_modules\typescript\bin\tsc --noEmit`）
- [x] 残留扫描通过：`src/`（WritingModeV2 目录与注释除外）无 `writingModeStore` / `writingProjectStore` / `writingModeUIStore` / `writing-agent` / `generateChapterChunk` / `polishDescription` / `saveAIGenerationHistory` 实质残留

## 测试与回归
- [x] `npm test` 不劣于基线（1517 passed / 4 failed，4 个失败在基线 tag 复跑确认全部预存）
- [x] dev server 已重启，应用可正常启动（Electron 全部 handler 注册完成，无 `writing:` 通道报错）
- [x] 创意中心运行时仅剩 V2 写作卡片，V2 界面正常渲染（用户目视确认）
- [x] V2 冒烟通过：项目列表加载 + V1 旧项目可打开且数据完整 + 界面渲染（用户确认）；生成/导出全链路由 1517 passed 测试与 typecheck 覆盖，未重跑
- [x] 构建体积对比已记录：基线 13988 KB → 当前 13606.2 KB（减少约 382 KB）

## 文档更新
- [x] `.trae/documents/技术文档.md` V1 内容已改写（V1 章节标注 + 文末新增移除记录章节），V2 内容完整
- [x] `CODE_WIKI.md` V1 相关内容已改写（概述更新为当前状态 + 历史清单标注）
- [x] `docs/user-manual.md` 写作模式说明已更新为 2.0（按 V2 实际功能面重写）
- [x] `CHANGELOG.md` 已新增移除条目
- [x] `小说写作模式自定义设置功能开发计划.md` 已标注历史归档
