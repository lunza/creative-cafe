# Tasks

## Task 1: 角色卡世界书关联接入对话检索（修复问题 1 主因）
- [x] 1.1 调研角色卡关联数据形状：读取 `characterService.getWorldBookRelations` 返回结构与现有 IPC（`CharacterManager.tsx:229` 消费方），确认关联条目如何映射到世界书文件路径/名称（`worldBookService.resolveWorldBookPaths` 可接受的 scopeId 形式）
- [x] 1.2 在 `CharacterDialogueChat.hooks.ts` 检索请求构造处（约 869-879 行）：通过 IPC 读取当前角色卡的世界书关联，解析为 scopeId，与 `boundKnowledgeBaseIds` 合并去重后传入 `retrieveWithKeywords`；解析失败的关联 `console.warn` 并跳过
- [x] 1.3 处理异步时序与失败兜底：读取关联失败（IPC 异常/无关联）时回退现有行为（仅 boundKnowledgeBaseIds），不阻断对话
- [x] 1.4 验证：静态验证通过——`characterCardId` 即角色卡文件路径（assetStore.ts:70）；`worldBookPath` 可被 resolveWorldBookPaths 直接按文件路径解析；scopeIds 非空时 ContextManager.ts:211 门控放行且多源 IN 子句已修复（前置 spec §7.58）。运行时实测步骤见最终报告

## Task 2: 关键词匹配器语义修复（constant 常驻 + 禁用统一）
- [x] 2.1 修改 `WorldBookKeywordMatcher.matchEntry`：`constant === true` 的条目跳过主/次关键词判定直接返回命中（仍受 probability 等既有过滤约束）——实现为 match() 步骤0 并入常驻条目（getConstantEntries + matchConstantEntry，仅概率过滤），候选循环按 uid 去重
- [x] 2.2 统一禁用判定：新增导出 `isEntryDisabled`（`disable === true || enabled === false`），Index 的 rebuild/upsertEntry 统一使用
- [x] 2.3 验证：既有 WorldBookKeywordIndex 测试 26 个全部通过（普通条目回归无变化）；constant 注入与 enabled:false 排除经代码路径核对（运行时实测步骤见最终报告）

## Task 3: 续写模式标签格式冲突修复（修复问题 2 冲突项）
- [x] 3.1 修改 `promptTemplateService.ts` 的 `creative-chat.continuation` 模板：【严格禁止】与【输出格式】条款将 `<<<EXPRESSION>>>`/`<<<SUGGESTED_OPTIONS>>>`/`<<<END_EXPRESSION>>>`/`<<<END_OPTIONS>>>` 加入豁免白名单（与 tableEdit/HTML 注释同列）——三处同步：内置种子、PromptBuilder 硬编码回退、**持久化副本迁移**（新增 migrateContinuationWhitelist：mergeNewDefaultTemplates 只补新增 moduleId，已有安装的旧模板需按锚点非破坏性迁移）
- [x] 3.2 修改 `CharacterDialogueChat.hooks.ts` 末尾 user 消息标签提醒注入：从仅 dialogue 扩展到 continuation 模式（与表情提示词注入范围一致）
- [x] 3.3 验证：tsc 改动文件零新增错误；迁移逻辑含三重防御（已含 EXPRESSION 跳过 / 无锚点跳过 / 异常不阻断启动），运行时核对步骤见最终报告

## Task 4: 思考模型标签定性诊断与单次补发（修复问题 2 保障项）
- [x] 4.1 在 `CharacterDialogueChat.hooks.ts` onComplete 中（think 剥离后、选项解析前）：定性判据为正文不含 EXPRESSION/OPTIONS 关键字；`finish_reason === 'length'` 时输出截断专项 warn（标签最先被截断），不补发
- [x] 4.2 实现单次标签补发：`finish_reason === 'stop'` 且标签缺失时，用独立 `new ChatEngine()` 实例发起一次修复请求（短提示词：原回复末尾 400 字 + 格式要求 + getAvailableEmotionKeys 情绪键列表，30s 超时兜底）；成功后将标签行追加至正文，由现有选项/表情解析器正常解析；失败或仍无标签 warn 保持现状，不循环
- [x] 4.3 补发请求请求级关闭思考：`repairConfig = { ...engineConfigWithParams, thinking_mode: 'off' }`，复用 ChatEngine 现有嵌套 `chat_template_kwargs.enable_thinking` 注入机制
- [x] 4.4 验证（静态）：onComplete 回调改 async——无补发触发时无 await 点，行为与改前完全一致；371 个相关测试全部通过。qwen3.8-next-flash 三场景实测步骤见最终报告

## Task 5: 全链路回归与文档更新
- [x] 5.1 tsc 编译检查：改动文件零新增错误（报告的 hooks.ts/PromptBuilder/PromptTemplateService 报错行号均不在本次改动范围，为存量）
- [x] 5.2 回归：WorldBookKeywordIndex 26 测试 + 对话链路 371 测试全部通过（普通条目匹配、e2e 对话流、think 剥离、图片消息迁移均不受影响）
- [x] 5.3 文档增量更新：`docs/FIX_RECORDS.md`、`CHANGELOG.md`、`.trae/documents/技术文档.md` 已记录两项修复（含根因定位与判据日志说明）

# Task Dependencies
- Task 1、2、3 相互独立，可并行
- Task 4 依赖 Task 3（补发提醒与续写提醒同源注入点）
- Task 5 依赖 Task 1-4 全部完成
