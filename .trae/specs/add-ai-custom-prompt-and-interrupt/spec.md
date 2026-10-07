# AI 功能自定义提示词 + 停止按钮 + 大纲审核问题列表 Spec

## Why

用户的四类 AI 交互功能（审核/润色/生成）存在三个体验缺口：(1) 用户无法用自定义提示词补充审核/生成标准（世界书审核已有"审核要求"输入，但漫画大纲审核、章节 AI 味检查、大纲生成等全部没有）；(2) 大纲审核弹窗只显示一段 suggestions 文本，不像章节 AI 味检查那样有结构化的问题列表，用户无法逐条确认问题再决定是否修改；(3) 多个 AI 按钮（大纲生成/大纲审核/项目草稿生成/AI 味检查/页面分析等）运行期间无法手动中止，本地模型单次调用动辄 3-5 分钟，用户只能干等。

## What Changes

- **新增统一自定义提示词注入机制**：shared 层新增 `withCustomPrompt()` 助手（system prompt 末尾追加"用户自定义要求（最高优先级）"块），所有审核/生成类功能 API 增加可选 `customPrompt` 参数
- **自定义提示词 UI**：新增可复用组件 `CustomPromptPopover`（图标 Popover + TextArea + localStorage 持久化），接入以下功能入口：
  - 大纲审核（V2MangaOutlinePanel「AI 大纲审核」按钮旁）
  - 大纲生成（V2MangaOutlinePanel「生成故事大纲」按钮旁）
  - 项目草稿生成（V2MangaOutlinePanel 导入建项目弹窗内）
  - 章节「检查 AI 味」（V2ChapterWorkbench 按钮旁）
  - 一键生成本章（V2ChapterWorkbench「AI 生成本章」按钮旁，透传到分片大纲+分片内容两条生成链）
  - 页面分析（V2MangaStage「分析全部页面」按钮旁）
- **BREAKING（向后兼容的契约扩展）**：`V2MangaAudit` 类型新增 `issues: string[]` 字段（问题列表，与章节审核 `V2ChapterDeAiCheckResult.issues` 对齐）；`auditOutline` 的 JSON 契约同步增加 `issues` 字段（旧字段全部保留）
- **大纲审核弹窗结构化问题展示**：V2MangaOutlinePanel 审核结果 Modal 增加问题列表区块（逐条编号 + 标记，样式对齐 V2ChapterWorkbench 的 AI 味审核弹窗），用户逐条确认问题后可选「采用修订文本」或保持原文
- **新增 AI 请求中止能力**（主进程 AbortController 注册表 + IPC 取消通道）：
  - `MangaParsingService` 增加 AbortController 注册表，覆盖 `analyzePage`（单页/批量）/`generateStoryOutline`/`auditOutline`/`generateProjectDraft`；fetch 调用传入 signal；新 IPC 通道 `manga:cancel`（参数为功能 key，缺省取消全部漫画类请求）
  - `ContentGenerator.checkChapterDeAi` 的 AbortController 外置（模块级可取消引用），新 IPC 通道 `writing:cancelDeAiCheck`
  - 取消结果统一携带 `cancelled: true` 标记，前端区分"用户停止"与"失败"
- **停止按钮 UI**：运行中的 AI 按钮切换为 danger「停止」态（点击调用对应取消通道），覆盖：生成故事大纲、AI 大纲审核、项目草稿生成（弹窗内）、检查 AI 味（进度弹窗 footer）、分析全部页面（已有停止按钮，行为对齐）；一键生成本章（已有中断按钮）与世界书批量操作（已有全局中断按钮，`ai:cancel`/`writing:cancelGeneration`）不在本次改造范围，仅确认不受影响
- **全局记忆**：`.learnings/LEARNINGS.md` 记录永久约定——"所有审核/润色/生成类 AI 功能必须支持：① 用户自定义提示词输入 ② 停止/中断按钮 ③ 审核类功能必须输出结构化问题列表（issues[]）并由用户确认是否采用"

## Impact

- Affected specs: `fix-ai-request-interrupt`（已完成的 ai:cancel 机制，本次不改动、仅共存）、`polish-deai-humanizer`（审核规则注入位置在其后追加自定义提示词）
- Affected code:
  - `src/shared/prompts/customPrompt.ts`（新建：withCustomPrompt 助手）
  - `src/shared/types/writing-v2.types.ts`（V2MangaAudit.issues、各 API 签名加 customPrompt、V2MangaAuditResult.cancelled 等）
  - `src/main/services/manga/MangaParsingService.ts`（customPrompt 注入 ×4 方法、AbortController 注册表 + cancel、auditOutline JSON 契约加 issues、fetch 传 signal）
  - `src/main/services/writing/ContentGenerator.ts`（checkChapterDeAi：customPrompt + controller 外置；generateShardOutline/generateShardContent：customPrompt 透传）
  - `src/main/services/writing/PromptBuilder.ts`（分片大纲/分片内容 prompt 注入 customPrompt）
  - `src/main/ipc/handlers/manga/mangaHandlers.ts`（customPrompt 透传 + 新通道 `manga:cancel`）
  - `src/main/ipc/handlers/writing/writingChapterHandlers.ts`（customPrompt 透传 + 新通道 `writing:cancelDeAiCheck`）
  - `src/main/preload.ts`（新 API 暴露：manga.cancel、writing.cancelDeAiCheck、各方法加参）
  - `src/renderer/components/Creative/WritingModeV2/shared/CustomPromptPopover.tsx`（新建可复用组件）
  - `src/renderer/components/Creative/WritingModeV2/manga/V2MangaOutlinePanel.tsx`（×3 入口接自定义提示词、审核弹窗问题列表、停止态）
  - `src/renderer/components/Creative/WritingModeV2/manga/V2MangaStage.tsx`（页面分析自定义提示词 + 停止行为对齐）
  - `src/renderer/components/Creative/WritingModeV2/writing/V2ChapterWorkbench.tsx`（AI 味检查/生成本章自定义提示词、进度弹窗停止按钮）
  - `src/renderer/components/Creative/WritingModeV2/writing/useV2ShardGeneration.ts`（customPrompt 透传）
  - `.learnings/LEARNINGS.md`（永久约定）
  - `CODE_WIKI.md`（增量更新）

## ADDED Requirements

### Requirement: 统一自定义提示词注入

系统 SHALL 提供 `withCustomPrompt(systemPrompt: string, customPrompt?: string): string` 助手（`src/shared/prompts/customPrompt.ts`）：customPrompt 为空/空白时原样返回；非空时在 system prompt 末尾追加独立区块"## 用户自定义要求（最高优先级，与上述默认要求冲突时以本节约束为准）"+ 用户原文。注入位置 SHALL 在引擎全局提示词、功能 system 正文、humanizer 规则块之后（即最末尾），保证用户要求可覆盖默认规则。

#### Scenario: 审核带自定义提示词

- **WHEN** 用户在大纲审核入口输入"重点检查章节划分是否合理"并触发审核
- **THEN** 最终发给模型的 system prompt 末尾包含"用户自定义要求"区块与该文本
- **AND** 模型按该要求输出审核结果

#### Scenario: 未输入自定义提示词

- **WHEN** 用户未输入任何自定义提示词直接触发审核/生成
- **THEN** system prompt 与改造前逐字节一致（不追加空区块）
- **AND** 既有行为完全不变

### Requirement: 自定义提示词输入 UI

系统 SHALL 提供可复用组件 `CustomPromptPopover`（图标触发 Popover，内含多行 TextArea 与"保存/清空"操作），输入内容按功能 key 持久化到 localStorage（下次打开自动回填）。SHALL 接入以下 6 个入口并透传到对应 API：大纲审核、大纲生成、项目草稿生成、章节检查 AI 味、一键生成本章（透传到分片大纲与分片内容两条链）、页面分析（单页与批量）。

#### Scenario: 持久化回填

- **WHEN** 用户上次在「AI 大纲审核」自定义提示词输入了内容，重新打开应用后再次进入大纲面板
- **THEN** 该入口的自定义提示词 Popover 中回填上次的内容
- **AND** 其他入口的自定义提示词互不串扰（按功能 key 隔离）

#### Scenario: 一键生成本章透传

- **WHEN** 用户输入自定义提示词后点击「AI 生成本章」
- **THEN** 分片大纲生成与每个分片的内容生成请求的 system prompt 中都包含该自定义提示词

### Requirement: 大纲审核结构化问题列表

系统 SHALL 在 `V2MangaAudit` 类型中新增 `issues: string[]` 字段，`auditOutline` 的 AI JSON 契约 SHALL 要求模型逐条列出发现的问题（`issues` 数组，每项一句具体问题描述；无问题时为空数组），原有 5 字段（passed/suggestions/revisedText/optimizationSuggestions/optimizedText）保持不变。V2MangaOutlinePanel 的审核结果弹窗 SHALL 展示：通过/不通过标签 + 问题列表（编号逐条展示，样式对齐 V2ChapterWorkbench AI 味审核弹窗的问题清单）+ 审核说明 + 修订文本预览 + 「采用修订文本」（用户确认后替换大纲并保存）/「保持原文」操作。

#### Scenario: 不通过时逐条确认

- **WHEN** 大纲审核返回 passed=false 且 issues 有 3 项
- **THEN** 弹窗以编号列表展示 3 条问题，用户可对照问题查看修订文本差异
- **AND** 用户点击「采用修订文本」后大纲被替换并自动保存；点击「保持原文」则仅关闭弹窗

#### Scenario: 通过且无问题

- **WHEN** 大纲审核返回 passed=true 且 issues 为空
- **THEN** 弹窗显示通过标签与"未发现问题"提示，不展示空列表

### Requirement: AI 请求可中止

系统 SHALL 使以下主进程 AI 调用支持手动中止：`MangaParsingService` 的 analyzePage（单页/批量）、generateStoryOutline、auditOutline、generateProjectDraft（通过类内 AbortController 注册表 + fetch signal，新 IPC 通道 `manga:cancel(key?)`，缺省取消全部漫画类请求）；`ContentGenerator.checkChapterDeAi`（AbortController 外置为可取消引用，新 IPC 通道 `writing:cancelDeAiCheck`）。中止后 Promise SHALL 以 `{ success: false, cancelled: true, error: '用户已停止' }` 形状返回，前端据此展示"已停止"而非报错。

#### Scenario: 停止大纲生成

- **WHEN** 大纲生成进行中（按钮处于"停止"态），用户点击停止
- **THEN** 主进程对应 fetch 请求被 AbortController 中止，HTTP 连接断开
- **AND** 前端按钮恢复原状，message 提示"已停止大纲生成"，不弹错误提示

#### Scenario: 停止 AI 味检查

- **WHEN** 章节 AI 味检查的进度弹窗打开期间，用户点击弹窗 footer 的「停止审核」
- **THEN** 流式请求被中止，进度弹窗切换为结果态并提示"已停止"
- **AND** 之前已流式收到的内容保留展示

#### Scenario: 并发取消互不影响

- **WHEN** 大纲审核进行中的同时触发一次大纲生成，用户仅停止大纲生成
- **THEN** 仅大纲生成的请求被中止，大纲审核继续执行

### Requirement: 停止按钮 UI

系统 SHALL 在以下运行中 AI 功能提供停止操作：「生成故事大纲」「AI 大纲审核」（按钮切换为 danger 停止态）、「项目草稿生成」（导入弹窗内停止按钮）、「检查 AI 味」（进度弹窗 footer 停止按钮）。「分析全部页面」已有停止按钮，SHALL 确认其走 `manga:cancel` 通道且停止态视觉统一。已具备中断能力的功能（一键生成本章的 writing:cancelGeneration、世界书批量操作的 ai:cancel）SHALL 保持现状不回归。

#### Scenario: 停止态视觉

- **WHEN** 大纲审核运行中
- **THEN** 「AI 大纲审核」按钮显示 danger 类型 + "停止审核" 文案 + loading，其他操作按钮禁用
- **AND** 点击后请求中止，按钮恢复默认文案

### Requirement: 全局记忆约定

系统 SHALL 在 `.learnings/LEARNINGS.md` 追加一条永久约定：所有新增的审核/润色/生成类 AI 功能必须支持用户自定义提示词输入（CustomPromptPopover）、停止/中断按钮、审核类功能输出结构化 issues 列表并由用户确认采用。

#### Scenario: 后续新功能遵循约定

- **WHEN** 后续会话中新增任意 AI 审核/生成功能
- **THEN** AI 依据 LEARNINGS.md 中的约定主动接入 CustomPromptPopover、停止按钮与 issues 列表，无需用户重复说明

## MODIFIED Requirements

### Requirement: auditOutline 审核提示词管线

原有实现：system prompt = 引擎全局提示词 + 审核角色 + 5 字段 JSON 契约 + 漫画背景信息 + 漫画解析全文（源素材参照）+ withHumanizerRules（审核型规则）。现修改为：在 withHumanizerRules 之后追加 withCustomPrompt（用户自定义要求，最高优先级）；JSON 契约增加 `issues: string[]` 字段说明（逐条列出具体问题，无问题为空数组）；方法签名增加 `customPrompt?: string` 第 4 参；fetch 传入注册表 signal 支持中止。

### Requirement: generateStoryOutline / generateProjectDraft / analyzePage 提示词与中止

原有实现：三个方法均无自定义提示词、无中止能力（analyzePage 批量有前端循环检查但主进程单页请求不可断）。现修改为：三者 system prompt 末尾追加 withCustomPrompt；方法签名增加 `customPrompt?` 参数；fetch 均传入注册表 signal，可被 `manga:cancel` 中止。

### Requirement: checkChapterDeAi 审核管线

原有实现：system prompt = 引擎全局提示词 + 编辑角色 + HUMANIZER_POLISH_RULES + 审核维度 + JSON 契约；AbortController 为内部临时实例不可外取消。现修改为：追加 withCustomPrompt（customPrompt? 参数）；AbortController 外置为模块级可取消引用并注册，新增 `writing:cancelDeAiCheck` 通道；中止时流式解析器停止、返回 cancelled 标记。

### Requirement: V2 一键生成本章管线

原有实现：planShards/generateShard 无自定义提示词。现修改为：useV2ShardGeneration 增加 customPrompt 参数并透传到 `writing:generateShardOutline` 与 `writing:generateShardContent` IPC；主进程 PromptBuilder 的分片大纲/分片内容 prompt 注入 withCustomPrompt。

## REMOVED Requirements

无。
