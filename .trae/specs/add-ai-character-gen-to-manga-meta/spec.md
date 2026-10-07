# 漫画信息弹窗「主要角色」AI 生成角色信息 Spec

## Why

漫画解析功能的「编辑漫画信息」弹窗（`V2MangaMetaModal.tsx`）中，「主要角色」字段目前只能手动输入。用户希望上传一张角色图片后，由 AI 基于图片中人物的视觉特征 + 当前漫画的整体分析结果，自动生成角色描述（姓名/外貌/性格等）并填充到该字段，减少手动整理成本。本能力同样在「新建漫画解析」弹窗入口可用（此时无整体分析上下文，AI 仅凭图片 + 用户输入生成）。

## What Changes

- `V2MangaMetaModal.tsx`「主要角色」字段区域新增：
  - **图片上传区**：点击选择本地图片（JPG/JPEG/PNG/WEBP/BMP），展示缩略图预览 + 移除按钮；校验扩展名与文件大小（≤8MB，与 `MAX_FILE_SIZE` 一致）
  - **「AI 生成角色信息」按钮**：上传图片后启用；加载中切换为 danger「停止生成」态；旁边挂 `CustomPromptPopover`（永久约定三件套之一）
  - **结果回填**：AI 生成文本自动填充到「主要角色」TextArea，用户可继续编辑；弹窗保持打开
  - 「主要角色」TextArea `maxLength` 500 → 2000（AI 输出多角色描述常超 500 字）
- 新增 IPC 通道 `manga:generateCharacterInfo`（主进程多模态 AI 调用）
- `MangaParsingService` 新增 `generateCharacterInfo` 方法（复用 `analyzePage` 的视觉调用模式）+ `manga:cancel` 支持新 key `generateCharacterInfo`
- `V2MangaStage.tsx` 向弹窗传新 props：`supportsVision` 与全页分析摘要 `comicSummaries`（编辑模式）
- 类型契约：`writing-v2.types.ts` 新增 `V2MangaCharacterGenResult`，`V2MangaAPI` 新增方法与 cancel key 联合类型扩展

**不改变**：现有文本输入、修改、保存流程；弹窗双入口（新建/编辑）复用结构；其他字段行为。

## Impact

- Affected specs: `integrate-comic-parsing-mode`（漫画解析子域扩展）、`add-ai-custom-prompt-and-interrupt`（永久约定三件套接入）
- Affected code:
  - 修改：`src/renderer/components/Creative/WritingModeV2/manga/V2MangaMetaModal.tsx`（上传区 + AI 按钮 + 回填）
  - 修改：`src/renderer/components/Creative/WritingModeV2/manga/V2MangaStage.tsx`（新 props 传递 + 全页摘要构建）
  - 修改：`src/main/services/manga/MangaParsingService.ts`（`generateCharacterInfo`）
  - 修改：`src/main/ipc/handlers/mangaHandlers.ts`（新 handler + cancel key 扩展）
  - 修改：`src/shared/types/writing-v2.types.ts`（结果类型 + API 契约）
  - 文档：`CODE_WIKI.md` 增量更新、根目录技术文档增量更新

## ADDED Requirements

### Requirement: 角色图片上传区
「编辑漫画信息」弹窗的「主要角色」字段 SHALL 提供图片上传区，支持选择本地图片文件（JPG/JPEG/PNG/WEBP/BMP），展示预览缩略图，并允许移除重选。

#### Scenario: 选择合法图片
- **WHEN** 用户点击上传区并通过系统文件选择框选中一张 ≤8MB 的 JPG/PNG/WEBP/BMP 图片
- **THEN** 上传区显示该图片的缩略图预览（data URI，走 `file.readAsBase64`，兼容 CSP）
- **AND** 显示「重新选择/移除」操作
- **AND** 「AI 生成角色信息」按钮变为可用

#### Scenario: 选择不合法文件
- **WHEN** 用户选择的文件扩展名不在支持列表内
- **THEN** 提示「不支持的图片格式，请选择 JPG/PNG/WEBP/BMP 图片」，不产生预览
- **WHEN** 用户选择的图片超过 8MB
- **THEN** 提示「图片过大（X.XMB），请压缩到 8MB 以下」，不产生预览

#### Scenario: 图片读取失败
- **WHEN** 预览读取（readAsBase64）或主进程读取文件失败（文件被移动/删除）
- **THEN** 显示明确错误提示（message.error），不进入 AI 调用

### Requirement: AI 生成角色信息按钮与触发管线
系统 SHALL 提供「AI 生成角色信息」按钮：仅当已上传图片、当前 AI 引擎 `supportsVision=true` 且不在加载中时可用；点击后将 **上传图片 + 当前漫画整体分析结果 + 用户自定义提示词** 拼接为输入管线调用 AI 分析服务。

#### Scenario: 按钮启用与禁用
- **WHEN** 未上传图片 或 当前引擎不支持视觉（`supportsVision=false`）或 正在生成中
- **THEN** 按钮 disabled；`supportsVision=false` 时按钮 title 提示「当前 AI 模型不支持图片识别」
- **WHEN** 已上传图片且引擎支持视觉
- **THEN** 按钮可用

#### Scenario: 生成管线（编辑模式，有整体分析结果）
- **WHEN** 用户点击「AI 生成角色信息」
- **THEN** 主进程读取图片为 base64 data URI
- **AND** system prompt 包含：角色视觉特征识别指令（外貌/发型/服饰/体型/年龄感）+ 跨页上下文表格（`buildContextTable(summaries)`，来自当前漫画已分析页面）+ 漫画背景信息（title/theme/background/colorMode/comicType）+ 已有「主要角色」文本（要求整合保留有效信息）+ 用户自定义提示词（`withCustomPrompt`，最高优先级注入末尾）
- **AND** 调用 OpenAI Vision 协议非流式接口（复用 `analyzePage` 同款配置读取与鉴权模式）

#### Scenario: 生成管线（新建模式，无整体分析结果）
- **WHEN** 弹窗由「新建漫画解析」入口打开且无任何已分析页面
- **THEN** system prompt 不注入上下文表格（summaries 为空），仅基于图片 + 漫画背景信息（表单当前已填字段）+ 自定义提示词生成

#### Scenario: 输出契约
- **WHEN** AI 返回成功
- **THEN** 解析结构化 JSON：`{ "characters": [{ "name", "role", "appearance", "personality" }] }`（容错解析复用 `parseJsonFromContent`）
- **AND** 主进程将数组格式化为可读文本（每角色一行：`姓名（定位）：外貌；性格`）
- **AND** 返回 `{ success: true, charactersText }`

#### Scenario: 回填与继续编辑
- **WHEN** 渲染层收到 `success=true`
- **THEN** 将 `charactersText` 写入「主要角色」字段（`form.setFieldValue`），显示「已生成角色信息，可继续编辑」
- **AND** 弹窗保持打开，字段仍为普通可编辑 TextArea，用户可修改后随「保存」一并提交

### Requirement: 生成过程状态与错误处理（含永久约定）
生成过程 SHALL 提供清晰加载状态，支持用户停止（AbortController + `manga:cancel`），并处理全部错误路径；接入用户自定义提示词（永久约定三件套：① 自定义提示词 ② 停止/中断 ③ cancelled 标记区分）。

#### Scenario: 加载与停止
- **WHEN** 生成进行中
- **THEN** 按钮切换为 danger「停止生成」态，上传区与确认按钮不阻塞（弹窗仍可取消）
- **WHEN** 用户点击「停止生成」
- **THEN** 调用 `manga:cancel('generateCharacterInfo')` 中止 fetch
- **AND** 主进程返回 `{ success: false, cancelled: true, error: '用户已停止' }`
- **AND** 前端提示「已停止」（message.info，非 error），已上传图片与字段内容保持不变

#### Scenario: AI 调用超时
- **WHEN** AI 请求超过 120 秒未返回
- **THEN** 主进程主动中止请求
- **AND** 返回错误「AI 分析超时，请重试或减少图片大小」

#### Scenario: AI 失败路径
- **WHEN** 引擎未配置 / HTTP 非 200 / 返回内容为空 / JSON 解析失败 / 空结果
- **THEN** 分别返回对应友好错误（与 `analyzePage` 错误语义一致；`finish_reason=length` 时附带 max_tokens 截断提示）
- **AND** 前端 message.error 展示真实错误文本，「主要角色」字段与已上传图片保持不变

## MODIFIED Requirements

### Requirement: 「主要角色」字段容量
「主要角色」TextArea `maxLength` SHALL 由 500 放宽至 2000（AI 生成的多角色描述可能超 500 字；DB 为 JSON 字符串存储无 schema 限制，注入 prompt 处已有软截断）。

#### Scenario: 保存长文本
- **WHEN** AI 生成文本回填后用户点击保存
- **THEN** 全文（≤2000 字）随 `MangaMetaInfo.characters` 正常持久化

### Requirement: manga:cancel 中止通道
`manga:cancel` 的 key 联合类型 SHALL 扩展为 `'analyzePage' | 'generateOutline' | 'auditOutline' | 'generateProjectDraft' | 'generateCharacterInfo'`；key 缺省时同时取消 `generateCharacterInfo`（复用 `cancelControllers: Map`）。

## REMOVED Requirements

无。
