# Checklist

- [x] WritingModeView 枚举中包含 CONTENT_GENERATION 值
- [x] WritingModeEntry 的 switch 语句能正确处理 CONTENT_GENERATION 视图并渲染 ContentWorkspace
- [x] ContentWorkspace 能正确接收 outline 和 projectId 作为 props
- [x] WritingConfigPanel 大纲生成成功后仅保存 outline 到 store，不立即创建 project
- [x] WritingModeEntry 在大纲生成完成后显示 OutlineEditor 而非直接切换视图
- [x] OutlineEditor 的"确认大纲"按钮能创建 project 并切换到 CONTENT_GENERATION 视图
- [x] 项目状态在大纲确认后正确更新为 IN_PROGRESS
- [x] OutlineEditor 中包含"调整参数"按钮，点击后返回配置页面
- [x] 大纲原始内容（outlineRaw）在 project 创建时正确保存
- [x] 完整的用户流程：配置页面 → 生成大纲 → 编辑大纲 → 确认大纲 → 内容生成页面
