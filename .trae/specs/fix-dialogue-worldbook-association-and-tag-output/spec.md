# 对话世界书关联失效与 qwen 标签输出缺失修复 Spec

## Why

用户反馈两个对话功能异常：

1. **对话模式下无法正确关联世界书内容**。排查证实：对话检索入口 `retrieveWithKeywords` 被 `scopeIds`（来自对话配置的"知识库绑定" `boundKnowledgeBaseIds`）门控（`ContextManager.ts:211`），为空时关键词匹配整段跳过；而**角色卡的世界书关联（`data.worldBooks`）在对话检索链路中没有任何消费方**——用户在角色管理里关联的世界书，对话模式根本不会触发。次要缺陷：常驻（constant/蓝灯）条目不支持（无关键词即永不注入）、`enabled:false` 禁用语义不识别（只认 `disable:true`）。

2. **qwen3.8-next-flash 不按要求输出表情/辅助模式标签**。排查证实三个因素：① 续写模式提示词硬冲突——`creative-chat.continuation` 模板【严格禁止】"禁止添加任何标签"，但表情提示词对续写同样注入（hooks.ts:1107-1112 无 promptType 判断），且白名单未豁免 `<<<EXPRESSION>>>`/`<<<SUGGESTED_OPTIONS>>>`；② 思考模式常开（qwen3.8 preset 特性）下，格式指令可能被思维链"吸收"，正文不带标签，现有保障（末尾 user 消息标签提醒）仅覆盖 dialogue 模式（hooks.ts:1957 仅 dialogue）；③ 缺少对"标签未生成（截断/被思考吸收）"与"生成了但解析丢失"的自动化定性手段，截断时（finish_reason=length）标签位于正文末尾最先丢失。

## What Changes

- **角色卡世界书关联接入对话检索**：`requestAIResponse` 构造 `retrieveWithKeywords` 请求时，读取当前角色卡的世界书关联（复用已修复的 `characterService.getWorldBookRelations` 链路），解析为世界书 scopeId 并与现有 `boundKnowledgeBaseIds` 合并去重后传入；解析失败的关联记录 warn 不阻断。
- **常驻条目支持**：`WorldBookKeywordMatcher.matchEntry` 对 `constant` 条目跳过关键词匹配直接命中（无条件注入），与 SillyTavern 蓝灯语义对齐。
- **禁用语义统一**：条目禁用判定改为 `disable === true || enabled === false`（`WorldBookKeywordIndex` 过滤与 matcher 同步），消除双字段并存导致的语义漂移。
- **续写模式格式冲突修复**：`creative-chat.continuation` 模板【输出格式】白名单豁免 `<<<EXPRESSION>>>`/`<<<SUGGESTED_OPTIONS>>>` 标签；末尾 user 消息"标签输出提醒"扩展到 continuation 模式（与表情提示词注入范围一致）。
- **思考模型标签保障（定性诊断 + 单次补发）**：
  - 表情解析失败且 `finish_reason === 'length'` 时输出明确 warn（标签被截断丢失，非模型能力问题）；
  - dialogue/continuation 模式下表情（及辅助模式开启时的选项）解析失败且 finish_reason 为 stop 时，发起**一次**标签补发请求（短修复提示词，仅要求按格式补输出标签行，不循环重试），成功后将标签行追加至正文并走正常解析。

**BREAKING**: 无。

## Impact

- Affected specs: `fix-worldbook-relation-and-vector-retrieval`（前置，已完成；本 spec 消费其修复后的 `getWorldBookRelations` 读取链路）、`analyze-llamacpp-model-compatibility`（qwen 思考模式协议背景）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（scopeIds 合并、标签提醒扩展、补发重试）
  - `src/main/services/context/ContextManager.ts`（如需透传角色卡关联参数）
  - `src/main/services/worldBook/WorldBookKeywordMatcher.ts`（constant 条目、enabled/disable 统一）
  - `src/main/services/worldBook/WorldBookKeywordIndex.ts`（禁用过滤统一）
  - `src/main/services/promptTemplateService.ts`（continuation 模板白名单）
- 不在本次范围：LAN API 服务器路径（`lanApiServer/dialogue.ts`）的同源修复与安卓客户端链路（如需另行立项）；条目级 scanDepth/caseSensitive/递归扫描等 SillyTavern 高级语义（既有缺失，不属本次缺陷）。

## ADDED Requirements

### Requirement: 角色卡世界书关联在对话模式生效

对话模式的上下文检索 SHALL 将当前角色卡已关联的世界书纳入关键词匹配范围，无需用户额外在对话配置中手动绑定知识库。

#### Scenario: 角色卡已关联世界书且未绑定知识库

- **WHEN** 角色卡存在 N 条世界书关联、对话配置 `boundKnowledgeBaseIds` 为空
- **THEN** 检索请求的 scopeIds 为角色卡关联解析出的世界书集合，消息含关联关键词时对应条目被触发并注入 system prompt「相关背景知识」区域

#### Scenario: 关联与绑定并存

- **WHEN** 角色卡关联与对话配置知识库绑定同时存在
- **THEN** 两类来源合并去重后传入检索，任一来源的条目均可触发

#### Scenario: 关联无法解析

- **WHEN** 角色卡关联的世界书文件不存在或已被删除
- **THEN** 记录 warn 日志并跳过该条关联，其余关联正常生效，不阻断对话

### Requirement: 常驻（constant）条目无条件注入

`constant === true` 的世界书条目 SHALL 跳过关键词匹配直接命中，在对话模式始终注入。

#### Scenario: 蓝灯条目

- **WHEN** 世界书存在 constant 条目且该世界书在 scope 范围内
- **THEN** 无论扫描文本是否含其关键词，该条目均进入检索结果（仍受概率/去重/maxResults 约束）

### Requirement: 禁用语义统一

世界书条目禁用判定 SHALL 为 `disable === true || enabled === false`，索引过滤与匹配阶段一致。

#### Scenario: enabled:false 条目

- **WHEN** 条目仅以 `enabled:false` 表达禁用（部分导入来源）
- **THEN** 该条目不参与关键词匹配，不注入

### Requirement: 续写模式标签格式一致

续写模式 SHALL 与对话模式保持表情/选项标签协议一致：模板不禁止这两类标签，标签提醒照常注入。

#### Scenario: 续写请求

- **WHEN** 发起续写（continuation）且表情系统开启
- **THEN** 系统提示词不含"禁止添加任何标签"与表情提示词的矛盾指令，末尾 user 消息携带标签输出提醒

### Requirement: 思考模型标签缺失的定性诊断与单次补发

系统 SHALL 在表情（及开启辅助模式时的选项）标签解析失败时区分截断与未生成，并在非截断时自动执行一次标签补发。

#### Scenario: 截断导致标签丢失

- **WHEN** `finish_reason === 'length'` 且正文解析不到表情标签
- **THEN** 输出明确 warn（标签被输出预算截断），不发起补发（补发同样会被截断）

#### Scenario: 模型未生成标签

- **WHEN** `finish_reason === 'stop'` 且正文解析不到表情标签（辅助模式开启时同时缺选项标签）
- **THEN** 自动发起一次补发请求：携带原回复摘要与格式要求，仅要求输出标签行；补发成功后将标签行追加至正文并复用现有解析逻辑；补发仍失败则保持现状（warn 日志），不循环重试

## REMOVED Requirements

（无）
