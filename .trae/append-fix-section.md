
## §7.71 角色卡 AI 三操作全字段上下文统一（2026-09-28，Spec: unify-character-card-full-field-context，功能增强非 bug）

**需求：** 用户要求生成/翻译/润色点击时自动收集角色卡全部可编辑字段（名称、昵称、标签、系统提示、历史记录后指令、创建者笔记等）作为统一参考基准，实现三操作数据处理的一致性与同步性。

**现状差距（改造前）：**
- 翻译/润色：`buildCharacterContext` 遍历 `FIELD_DESCRIPTIONS`（仅 9 个长文本字段）→ `<context_reference>` 缺 name/nickname/source/creator/character_version/tags 6 个短字段
- 生成：`existing_fields_info` 同样仅 9 字段（缺 source），短字段靠 `character-card.generate` 模板变量（character_name + 4 行）另行拼接 → 三操作参考基准不统一

**改动（3 文件，最小侵入）：**
1. `characterFieldScope.ts`：`FIELD_DESCRIPTIONS` 扩展 6 个短字段条目（name=角色名称、nickname=昵称、source=来源、creator=创建者、character_version=版本信息、tags=标签，label 与 CharacterEditModal 编辑器一致）；`buildCharacterContext` 从 useCharacterAIOperations 移入本纯模块（原文件头已注明该 hook 依赖 antd/AIService 测试导入链路重，沿用既有抽取模式），tags 数组用顿号连接保持单行紧凑（其他数组字段仍换行连接）
2. `useCharacterAIOperations.ts`：删除本地 `buildCharacterContext`，改为导入；翻译（`<context_reference>`）、润色、生成 `existing_fields_info` 三处消费遍历同一 `FIELD_DESCRIPTIONS`，自动统一为"全部 15 个可编辑字段（排除目标字段与空值）"
3. `characterFieldScope.test.ts`：新增 7 用例（短字段标签防御 2 判越界 / 防御 1 提取 name、tags 标签后内容；buildCharacterContext 全字段排除目标、短字段目标排除、顿号/换行连接、空值跳过）

**自动受益（未改调用处）：** 翻译/润色上下文补齐 6 个短字段；生成补 source；`extractTargetFieldContent` 越界防御识别"角色名称：/【标签】"等短字段段落（Flash 模型全卡泛化输出防御增强）；翻译/润色短字段目标时 fieldLabel 显示中文名（原显示英文 key）

**兼容性决策：** 生成模板的 `character_name` 与 4 个短字段行变量保持传入不动（主进程 `character-card.generate` 为用户可编辑持久化模板，避免动其变量语义）；`existing_fields_info` 与模板行存在少量短字段重复，属模板兼容可接受冗余。短字段无生成按钮（现状保持）。

**验证：** 17 个单测全绿（既有 10 零回归 + 新增 7）；typecheck 本次文件零新增错误；dev server 已重启（VITE ready 466ms + preload 重建）。用户验证路径：编辑弹窗内对长字段翻译/润色时提示词 `<context_reference>` 应含角色名称/标签等短字段；生成时 `existing_fields_info` 应含"来源"（若已填）。
