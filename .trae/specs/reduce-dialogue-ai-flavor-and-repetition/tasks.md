# Tasks

## Phase 1 — 诊断基建

- [x] 1.1 新建 `utils/diversityMetrics.ts`：5 项指标纯函数（开头句式重复率 / distinct-3 / 结构模板率 / 跨轮 Jaccard / 高频动作短语集中度）+ `computeDiversityReport` 聚合
- [x] 1.2 新建 `utils/__tests__/diversityMetrics.test.ts`：指标边界（空输入/单条/全相同/全不同）
- [x] 1.3 `hooks.ts` onComplete 注入多样性指标日志（最近 10 条 assistant 回复，addLog info 级，失败不阻塞）

## Phase 2 — 提示词激进重构

- [x] 2.1 `PromptBuilder.ts` 新增 `stripLegacyDialogueRuleBlocks`：剥离【对话约束规则】【严格禁止】【白名单例外】【输出格式】四块（标题到下一【标题】或末尾）
- [x] 2.2 `PromptBuilder.ts` 新增精简指令集常量（【对话方式】3 条核心规则）+ 锚点守卫追加逻辑；`buildDialoguePrompt` 接入"剥离 → 追加"流程
- [x] 2.3 `injectDialogueFormatInstructions` 守卫短语放宽为"用星号包裹"
- [x] 2.4 `buildLengthGuidancePrompt` 日常模式改信息密度表述；强化模式保留硬性字数下限
- [x] 2.5 `buildCharacterContext` mes_example 段落标注风格范本
- [x] 2.6 `promptTemplateService.ts` 重写 `creative-chat.dialogue` instructions 默认内容为精简版（附带：`lanApiServer/dialogue.ts` LAN 服务端模板同步精简 + `buildDialoguePrompt` 回退模板同步精简）
- [x] 2.7 新增 `__tests__/PromptBuilder.legacyStrip.test.ts`：旧模板剥离 / 新模板跳过 / 自定义模板保护
- [x] 2.8 重写 `__tests__/PromptBuilder.lengthGuidance.test.ts` 适配新表述（强化模式断言不变）

## Phase 3 — 防重复提示词层

- [x] 3.1 新建 `utils/styleFingerprint.ts`：`extractStyleFingerprint`（开场类型 + 动作短语集合）+ `hashString`
- [x] 3.2 `buildStyleAvoidancePrompt`：≥3/5 同类型开场 / 动作短语 ≥3 次触发，自然语言规避指令
- [x] 3.3 `buildCreativeRotationPrompt`：12 策略轮换池 + seed 选取
- [x] 3.4 新建 `utils/__tests__/styleFingerprint.test.ts`
- [x] 3.5 `hooks.ts` dialogue 模式注入规避 + 轮换指令（表情提示词之后；seed 含 dedupConfig.retryCount；continuation 跳过）

## 验证与文档

- [x] 4.1 运行 vitest 全量相关测试（CharacterDialogueChat 套件 27 文件 491 测试全过；tsc 本次修改文件零新增错误）
- [x] 4.2 增量更新 `.trae/documents/技术文档.md`（含 ⚠️ 重点标记：存量模板运行时剥离的必要性与回归盯防点）
- [x] 4.3 开发服务器自动重启验证（Electron + LAN API 正常启动）
