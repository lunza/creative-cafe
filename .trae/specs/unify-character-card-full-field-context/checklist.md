# Checklist

- [x] FIELD_DESCRIPTIONS 包含全部 15 个可编辑字段（9 长文本 + name/nickname/source/creator/character_version/tags），6 个新字段 label 与 CharacterEditModal 编辑器 label 完全一致（标签字段 UI label 为"标签（用逗号分隔）"，其中"（用逗号分隔）"为输入格式提示，核心 label 取"标签"）
- [x] 翻译操作：`<context_reference>` 由 buildCharacterContext 生成，包含除目标字段外全部已填字段（含角色名称、标签等短字段）
- [x] 润色操作：`<context_reference>` 同上，与翻译同一数据基准
- [x] 生成操作：`existing_fields_info` 包含除目标字段外全部已填字段，含"来源"（source）
- [x] 生成模板变量（character_name 及 4 个短字段行）保持传入，主进程 promptTemplateService 的 character-card.generate 模板未改动
- [x] buildCharacterContext：目标字段被排除；空值字段跳过；tags 数组用顿号连接；alternate_greetings 等数组仍用换行连接（单测覆盖）
- [x] extractTargetFieldContent 能识别新短字段标签（角色名称/标签等）：多字段段落无目标段落 → overflow；目标短字段带标签前缀 → 提取标签后内容（单测覆盖）
- [x] 翻译/润色短字段时的 fieldLabel 显示中文名（不再显示英文 key）
- [x] characterFieldScope.test.ts 既有用例零回归 + 新增用例（防御2含短字段、防御1提取 name/tags、buildCharacterContext 全字段/排除/空值/顿号连接）全绿（17 passed）
- [x] npm run typecheck 相对修改前基线零新增错误
- [x] dev server 已重启，改动生效（VITE ready 466ms + preload 重建 65.30kB）
- [x] docs/FIX_RECORDS.md 已增量更新（§7.71，功能增强，无需重点标记）

实施说明：buildCharacterContext 按该目录既有的"纯模块抽取"模式从 useCharacterAIOperations.ts 移入 characterFieldScope.ts（原文件头注释明确该 hook 依赖 antd/AIService 导致测试导入链路重），hook 改为导入使用，行为不变。
