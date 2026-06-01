# Checklist

## 类型定义验证
- [x] GeneratedOutline.chapters 是唯一的章节数据定义
- [x] WritingProject 接口不包含冗余的 chapters 字段
- [x] 类型定义编译通过无错误
- [x] 所有与兼容性相关的注释或字段已移除

## WritingStorageService 清理
- [x] loadProject() 不包含数据迁移逻辑
- [x] saveProject() 仅操作 outline.chapters
- [x] computeProjectMetadata() 仅使用 outline.chapters
- [x] 无数据同步代码

## writingHandlers 清理
- [x] 所有 IPC handler 仅操作 outline.chapters
- [x] 无数据同步代码
- [x] 无兼容性处理逻辑

## writingProjectStore 清理
- [x] updateOutline() 仅更新 outline.chapters
- [x] 无数据同步代码
- [x] 无兼容性处理逻辑

## 大纲生成服务清理
- [x] OutlineGenerator.ts 仅生成 outline.chapters
- [x] 无数据同步代码
- [x] 无兼容性处理逻辑

## UI 组件和 hooks 验证
- [x] 所有 WritingMode 组件使用 outline.chapters
- [x] 所有 hooks 使用 outline.chapters
- [x] 无兼容性访问代码

## 编译和测试
- [x] TypeScript 编译无新增错误（现有错误为重构前已存在）
- [x] 大纲生成功能正常
- [x] 章节编辑功能正常
- [x] 数据加载和保存正常

## 代码质量
- [x] 无冗余数据访问路径
- [x] 无兼容性代码
- [x] 代码注释清晰准确
