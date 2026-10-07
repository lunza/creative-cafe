# Checklist

## 备份与版本控制
- [ ] 删除前 git 快照提交完成，tag `pre-remove-writing-v1` 存在且可检出
- [ ] 最终删除变更已分条提交（代码 / 文档），提交信息含回滚方式说明

## V1 代码文件清理
- [ ] `src/renderer/components/Creative/WritingMode/` 目录已整体删除
- [ ] 3 个 V1 store（writingProjectStore / writingModeStore / writingModeUIStore）与 `stores/index.ts` barrel 已删除
- [ ] `writingModeConstants.ts` / `outlineVersionUtils.ts` / `ImpactAnalyzer.ts` / `AIEditService.ts` 已删除
- [ ] 主进程 V1 独占模块已删除：`writingAgentHandlers.ts`、`services/agent/writing/` 目录、`ChapterChunkService.ts`、`DescriptionPolisher.ts`、`shared/types/writing-agent.types.ts`

## 依赖与通道处理
- [ ] preload V1 `writing` 命名空间已删除，`writingV2` 命名空间零改动
- [ ] `electron.d.ts` 与 preload 成对同步（V1 命名空间与 writing-agent 类型声明已删）
- [ ] `writingHandlers.ts` / `main/index.ts` 中 agent handler 注册与 `abortActiveWritingAgent` 调用已移除
- [ ] 各 handler 文件 V1 独占通道已删除（chunk 7 通道 / exportProject / saveProjectRaw / AI 生成历史 3 通道 / saveOutline 及 outline:* / continueOutline / polishDescription）
- [ ] 已用 preload `writingV2` 命名空间实际 invoke 清单逐条比对，V2 依赖通道无一误删
- [ ] `package.json` 依赖核对完成，结论已记录（预期无独占依赖）

## 引用清理
- [ ] `CreationCenter.tsx` 仅剩「写作模式 2.0」入口，V1 卡片/lazy 导入/状态/Dialog 全部移除
- [ ] `npm run typecheck` 零新增错误
- [ ] 残留扫描通过：`src/`（WritingModeV2 目录与注释除外）无 `writingModeStore` / `writingProjectStore` / `writingModeUIStore` / `writing-agent` / `generateChapterChunk` / `polishDescription` / `saveAIGenerationHistory` 残留

## 测试与回归
- [ ] `npm test` 不劣于基线（1466+ passed / 2 预存 failed）
- [ ] dev server 已重启，应用可正常启动
- [ ] 创意中心运行时仅剩 V2 写作卡片，V2 界面正常渲染
- [ ] V2 冒烟通过：项目列表加载 → V1 旧项目可打开且数据完整 → 新建项目 → 大纲 → 分片生成 → 导出成功
- [ ] 构建体积对比已记录（移除前后 `npm run build` 产物大小）

## 文档更新
- [ ] `.trae/documents/技术文档.md` V1 内容已删除/改写，V2 章节完整
- [ ] `CODE_WIKI.md` V1 章节已删除
- [ ] `docs/user-manual.md` 写作模式说明已更新为 2.0
- [ ] `CHANGELOG.md` 已新增移除条目
- [ ] `小说写作模式自定义设置功能开发计划.md` 已标注历史归档
