# 写作模式功能完整性修复计划

> 创建时间: 2026-05-18
> 目标: 确保用户能够全程掌控写作过程，实现从配置到导出的完整工作流

## 一、核心问题总结

基于全面的功能差距分析，发现写作模式存在以下关键缺失：

### 🔴 高优先级（阻断用户核心工作流）

1. **作品标题不可编辑** — 用户无法自定义项目标题
2. **大纲修改后数据不互通** — AI 大纲编辑和手动大纲数据未同步到 Store
3. **模型参数无调整入口** — 用户无法针对不同项目调整 temperature、maxTokens
4. **生成过程无法干预** — 生成中无法调整参数或从断点续写
5. **双重存储机制冲突** — MarkdownEditor 的 localStorage 与项目存储不互通
6. **OutlineEditor 缺少手动大纲入口** — outline 为 null 时无操作指引
7. **WritingConfigPanel 缺少手动创建大纲选项** — 无法跳过 AI 生成

### 🟡 中优先级（严重影响用户体验）

8. **版本对比功能缺失** — 无法查看版本差异
9. **章节目标字数对比** — 无实际字数与目标字数的对比显示
10. **版本保存无备注入口** — `note` 字段存在但 UI 无输入口
11. **版本删除功能缺失** — 无法删除不需要的版本
12. **导出范围无法选择** — 只能导出整个项目
13. **创作设置无法中途修改** — 进入大纲/内容阶段后无法修改配置
14. **生成取消/重试机制缺失** — 大纲生成过程中无法取消
15. **大纲全局验证缺失** — 无总字数/章节数量校验

### 🟢 低优先级（锦上添花）

16. **全局快捷键支持** — Ctrl+S 保存、Ctrl+Enter 生成等
17. **Token 用量统计** — API 调用次数、Token 消耗
18. **项目复制/模板化** — 基于现有项目快速创建
19. **项目详情查看** — 完整配置摘要、大纲概要展示
20. **大纲导出功能** — 手动大纲单独导出

## 二、修复方案

### Phase 1: 核心数据流修复（必须首先完成）

| 任务 | 涉及文件 | 说明 |
|------|---------|------|
| 1.1 同步 OutlineEditor 数据到 Store | OutlineEditor.tsx, writingModeStore.ts | 修复 AI 大纲编辑和手动大纲不同步问题 |
| 1.2 修复 outline 为 null 时的空状态 | OutlineEditor.tsx | 添加"手动创建大纲"入口 |
| 1.3 添加 outlineMode 到 Store | writingModeStore.ts | 记录用户选择的编辑模式 |
| 1.4 统一存储机制 | ContentWorkspace.tsx, MarkdownEditor.tsx | 确保编辑器内容与项目存储一致 |

### Phase 2: 用户控制增强

| 任务 | 涉及文件 | 说明 |
|------|---------|------|
| 2.1 作品标题可编辑 | WritingProjectList.tsx, WritingModeEntry.tsx | 添加重命名功能 |
| 2.2 模型参数调整入口 | WritingConfigPanel.tsx | 添加 temperature、maxTokens 调整滑块 |
| 2.3 手动创建大纲入口 | WritingConfigPanel.tsx | 添加"手动创建大纲"按钮 |
| 2.4 创作配置中途修改 | WritingModeEntry.tsx | 添加"返回修改配置"按钮 |
| 2.5 大纲生成取消/重试 | WritingConfigPanel.tsx | 生成过程中添加取消按钮，失败后添加重试按钮 |

### Phase 3: 内容编辑增强

| 任务 | 涉及文件 | 说明 |
|------|---------|------|
| 3.1 版本对比功能 | ContentWorkspace.tsx | 添加 diff 视图对比两个版本 |
| 3.2 章节字数对比 | ContentWorkspace.tsx | 显示实际字数 vs 目标字数 |
| 3.3 版本保存备注入口 | ContentWorkspace.tsx | 保存版本时弹出备注输入框 |
| 3.4 版本删除功能 | ContentWorkspace.tsx, WritingStorageService.ts | 添加删除版本功能 |
| 3.5 导出范围选择 | ContentWorkspace.tsx | 导出时可选择特定章节 |
| 3.6 大纲全局验证 | ManualOutlineEditor.tsx, OutlineEditor.tsx | 验证总字数、章节数量 |

### Phase 4: 用户体验优化

| 任务 | 涉及文件 | 说明 |
|------|---------|------|
| 4.1 全局快捷键 | ContentWorkspace.tsx, OutlineEditor.tsx | Ctrl+S, Ctrl+Enter, Ctrl+Z/Y |
| 4.2 项目复制功能 | WritingProjectList.tsx | 基于现有项目创建新项目 |
| 4.3 项目详情查看 | WritingProjectList.tsx | 点击项目卡片查看详情 |
| 4.4 大纲导出 | ManualOutlineEditor.tsx | 导出为 JSON/Markdown |
| 4.5 章节搜索/筛选 | ContentWorkspace.tsx | 快速定位章节 |

## 三、实施顺序

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
    ↓         ↓         ↓         ↓
  数据流    用户控制   内容编辑   体验优化
```

### 依赖关系
- Phase 2 依赖 Phase 1（需要数据流正确后才能添加控制功能）
- Phase 3 依赖 Phase 1（版本管理需要正确的数据存储）
- Phase 4 可以在 Phase 1 完成后并行开展

## 四、预期效果

修复完成后，用户将能够：
1. ✅ **全程掌控创作流程** — 从配置、大纲、生成到导出，每个环节都有控制入口
2. ✅ **实时调整参数** — 生成过程中可随时调整风格、重点等
3. ✅ **有效干预内容** — 编辑、版本管理、断点续写、重新生成
4. ✅ **自定义输出** — 选择导出范围、格式、自定义标题
5. ✅ **数据一致性** — 所有操作都正确持久化，无数据丢失风险
