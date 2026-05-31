# Checklist

## 类型定义更新
- [x] ChapterOutline接口扩展完成，包含content、status等字段
- [x] WritingProject接口中的chapters字段已移除
- [x] 所有类型定义编译通过无错误

## 主进程代码更新
- [x] WritingStorageService.loadProject() 从outline.chapters加载章节
- [x] WritingStorageService.saveProject() 从outline.chapters保存章节
- [x] writing:saveOutline handler 仅操作outline.chapters
- [x] writing:outline:update handler 仅操作outline.chapters
- [x] writing:chapter:update handler 更新outline.chapters
- [x] 所有IPC处理器不再引用project.chapters

## 渲染进程代码更新
- [x] writingProjectStore.loadProject() 从outline.chapters加载
- [x] writingProjectStore.updateOutline() 仅更新outline.chapters
- [x] writingProjectStore.updateChapter() 更新outline.chapters
- [x] 同步逻辑代码已移除

## 大纲生成服务更新
- [x] OutlineGenerator.generateOutline() 仅生成outline.chapters
- [x] 同步到project.chapters的逻辑已移除
- [x] continueOutline方法仅更新outline.chapters

## UI组件和hooks更新
- [x] OutlineEditor.tsx 使用outline.chapters
- [x] useChapterGeneration.ts 使用outline.chapters
- [x] useChapterStructure.ts 使用outline.chapters
- [x] ContentWorkspace.tsx 使用outline.chapters
- [x] 其他组件不再引用project.chapters

## 其他服务更新
- [x] AIAssistedChapterService 使用outline.chapters
- [x] ContentGenerator 使用outline.chapters
- [x] 版本管理代码已更新

## 测试验证
- [x] 相关单元测试已更新并通过
- [x] 集成测试已更新并通过
- [x] 多次生成大纲测试通过，索引唯一
- [x] 章节编辑功能正常
- [x] 章节拆分/合并功能正常
- [x] 数据持久化和加载正常
- [x] 无回归问题

## 代码质量
- [x] 消除数据冗余，仅使用outline.chapters
- [x] 模块间解耦程度提升
- [x] 代码复杂度降低
- [x] 技术文档已更新