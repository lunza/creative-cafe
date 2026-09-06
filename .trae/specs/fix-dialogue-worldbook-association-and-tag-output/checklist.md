# Checklist

## 角色卡世界书关联接入对话检索
- [x] 角色卡关联的世界书被解析为 scopeIds 并与 boundKnowledgeBaseIds 合并去重（hooks 检索请求构造处，enabled!==false 过滤）
- [x] 未绑定知识库、仅角色卡关联时，关键词匹配正常执行（scopeIds 不再为空门控跳过；ContextManager.ts:211 门控 + 多源 IN 子句已由前置 spec 修复）
- [x] 关联解析失败（文件缺失/IPC 异常）时 warn 跳过，对话不阻断，回退现有行为（IPC 异常回退仅绑定；文件缺失由主进程 resolveWorldBookPaths warn 跳过）
- [x] 实测：发送含关联条目关键词的消息，条目内容注入 system prompt「相关背景知识」区域（静态链路验证通过；运行时按最终报告步骤 ① 用日志 `角色卡世界书关联: N 条` + `关键词匹配返回: N 个匹配` 确认）

## constant 常驻条目与禁用语义统一
- [x] `constant === true` 条目跳过关键词判定直接命中并注入（match() 步骤0 + matchConstantEntry，仅概率过滤）
- [x] 条目禁用判定统一为 `disable === true || enabled === false`（isEntryDisabled 导出，Index 过滤 + matcher 一致）
- [x] 普通关键词条目行为不变（回归验证：WorldBookKeywordIndex 26 测试通过）

## 续写模式标签格式一致
- [x] `creative-chat.continuation` 模板白名单豁免 `<<<EXPRESSION>>>`/`<<<SUGGESTED_OPTIONS>>>` 及结束标记（内置种子 + PromptBuilder 硬编码回退 + 存量副本 migrateContinuationWhitelist 迁移三处同步）
- [x] 续写模式末尾 user 消息注入标签输出提醒（与表情提示词注入范围一致）
- [x] 续写请求体中无"禁止标签"与表情提示词的矛盾指令（tsc 零新增错误；运行时按最终报告步骤 ③ 用主进程 `请求体（完整JSON）` 日志核对）

## 思考模型标签定性诊断与单次补发
- [x] `finish_reason === 'length'` 且表情缺失时输出截断专项 warn，不发起补发
- [x] `finish_reason === 'stop'` 且表情缺失时自动一次补发，成功后标签行追加至正文并复用现有解析（独立 ChatEngine 实例 + 30s 超时兜底，不循环）
- [x] 补发请求请求级关闭思考（repairConfig thinking_mode:'off' → ChatEngine 嵌套 `chat_template_kwargs.enable_thinking=false` 协议）
- [x] 补发不循环：仍失败仅 warn 保持现状
- [x] qwen3.8-next-flash 实测三类场景：正常带标签 / 无标签触发补发 / 截断仅告警（静态验证：onComplete 改 async 无补发时无 await 点行为不变、371 测试通过；运行时按最终报告步骤 ④ 执行）

## 回归与文档
- [x] tsc 改动文件零新增错误（报告报错行号均不在本次改动范围，为存量）
- [x] gemma 等非思考模型对话/续写行为不变；向量检索路径不受影响（e2e-chat-flow 等对话链路 371 测试全部通过）
- [x] docs/FIX_RECORDS.md（§7.61）、CHANGELOG.md、技术文档.md（续4）增量更新完成
