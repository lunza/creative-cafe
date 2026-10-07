# 小说全流程创作流水线 API（Writing Pipeline API）Spec

## Why

当前写作模式 2.0 的各能力（资源绑定、大纲生成、分片章节生成、导出）分散在多个独立通道中，需要 UI 逐步驱动，无法以编程方式一次性完成"选素材 → 大纲 → 分章创作 → 成书"的完整创作闭环。需要一个统一的流水线 API 封装全流程，并提供可重复执行的端到端（E2E）验证，证明系统能稳定产出结构完整、正确注入所选角色卡与世界书、且满足章节数/字数要求的故事。

**已确认的决策**（用户选择）：
- API 形式：**应用内 IPC 流水线 API**（Electron 桌面应用，无 Web 服务端；IPC 通道即"端点"，鉴权为本地无鉴权 + AI 密钥来自应用设置）
- E2E 策略：**先小规模冒烟（3 章 × 2000 字）验证闭环，通过后跑全量（3 章共 20000 字）**

## What Changes

- **新增** 主进程 `WritingPipelineService`：编排既有服务（项目/大纲/分片生成/导出），提供会话状态、输入校验、取消、统一错误封装
- **新增** IPC 通道 `writing:pipeline:*`（9 个方法 + 1 个进度事件），preload 挂到 `writingV2.pipeline` 命名空间
- **新增** 类型契约 `PipelineAPI`（`writing-v2.types.ts`），全类型化、无 any 穿透（V2 架构规则 G3）
- **新增** 渲染层 `writingPipelineService.ts`（经 `getWritingV2API()`，禁止裸调 electronAPI）
- **新增** 纯函数 `pipelineUtils`（参数校验 + E2E 结果断言），可单测
- **新增** dev-only E2E 控制台（`import.meta.env.DEV` 才可见）：一键执行 2 角色卡 + 1 世界书 + 3 章的完整场景，规模可选（smoke 6000 / full 20000），展示进度与结构化结果
- **新增** API 文档 `docs/writing-pipeline-api.md`（通道清单、请求/响应格式、鉴权说明、错误码）
- **复用不改**：`writing:createProject`、`generateOutline`、`generateShardOutline/Content`、`autoSaveChapter`、`writingV2:exportWithChapters`、资源候选列表、角色卡/世界书资产服务（V1 代码零改动）
- 无 **BREAKING** 变更：全部为新增命名空间，不触碰既有通道行为

## Impact

- Affected specs: `refactor-writing-mode-v2`（本 spec 是其能力上层的编排层，复用其类型与通道，不修改其行为）
- Affected code:
  - 新增 `src/main/services/writing/WritingPipelineService.ts`
  - 新增 `src/main/ipc/handlers/writingPipelineHandlers.ts`（并在 `ipc/index.ts` 注册）
  - 修改 `src/main/preload.ts`（`writingV2.pipeline` 命名空间）
  - 修改 `src/shared/types/writing-v2.types.ts`（`PipelineAPI` + 结果类型）
  - 新增 `src/shared/utils/pipelineUtils.ts`（纯函数：校验 + E2E 断言）
  - 新增 `src/renderer/services/writingPipelineService.ts`
  - 修改 `src/renderer/components/Creative/WritingModeV2/WritingV2Entry.tsx`（dev-only E2E 入口按钮 + 结果 Modal）
  - 新增 `docs/writing-pipeline-api.md`
- 数据：E2E 会在角色资产目录/世界书目录创建带 `e2e-` 前缀的测试素材（仅当现有素材不足 2 角色/1 世界书时），在写作项目目录创建测试项目与导出文件

## ADDED Requirements

### Requirement: 流水线资源选择（角色卡与世界书）

系统 SHALL 提供 `pipeline.listResources` 与 `pipeline.createCharacterCard`，返回可选角色卡/世界书列表（id/name），并在素材不足时支持创建最小角色卡（复用角色资产既有保存路径；实现时侦察 `characterHandlers` 确认纯文本创建路径，缺失则复用 `characterService` 的文件写入逻辑）。

#### Scenario: 列出并选择素材
- **WHEN** 调用方调用 `listResources`
- **THEN** 返回 `{ success, data: { characters: [{id,name}...], worldBooks: [{id,name}...] } }`，id 与既有资源绑定语义一致（文件相对路径）

#### Scenario: 创建最小角色卡
- **WHEN** 调用方调用 `createCharacterCard({ name, profile, personality })`
- **THEN** 角色卡资产创建成功并出现在 `listResources.characters` 中

### Requirement: 流水线初始化（项目 + 资源绑定 + 校验）

系统 SHALL 提供 `pipeline.init`，按 `creativeDescription/novelType/targetWordCount/chapterCount/characterCardIds/worldBookIds/modelConfig?` 创建项目并写入 `config.resources`，返回 `projectId`。SHALL 拒绝非法输入（chapterCount 1-50、targetWordCount 1000-200000、characterCardIds ≥1 且互不重复、worldBookIds ≥1、资源 id 必须存在于候选列表）。

#### Scenario: 合法初始化
- **WHEN** 以 2 个角色卡 + 1 个世界书 + 3 章 20000 字参数调用
- **THEN** 返回 `{ success: true, data: { projectId } }`，项目实体落盘且 `config.resources` 含所选 id

#### Scenario: 非法输入被拒绝
- **WHEN** chapterCount=0 或角色卡 id 不存在于候选列表
- **THEN** 返回 `{ success: false, error: <明确中文原因>, code: 'VALIDATION' }`，不创建任何项目

### Requirement: 分阶段创作（大纲 / 章节 / 成书）

系统 SHALL 提供 `pipeline.generateOutline(projectId)`（生成并落盘大纲，注入已绑定资源）、`pipeline.generateChapter(projectId, chapterIndex)`（对该章执行分片大纲 → 逐分片生成 → 合并落盘，复用 V2 既有分片链路）、`pipeline.compose(projectId, format, chapterIndices?)`（TXT/MARKDOWN/JSON 成书导出，复用 `writingV2:exportWithChapters`，返回 `filePath` 与字数统计）。每个阶段完成 SHALL 发出 `writing:pipeline:progress` 事件（stage/current/total/message/percent）。

#### Scenario: 单章生成
- **WHEN** 大纲就绪后调用 `generateChapter(projectId, 0)`
- **THEN** 该章正文落盘（`chapter.content` 非空、`status=completed`），进度事件从 stage=`chapter` current=1/total=分片数 递进到 100%

#### Scenario: 成书导出
- **WHEN** 3 章均完成后调用 `compose(projectId, 'MARKDOWN')`
- **THEN** 返回 `{ filePath }`，文件含作品标题、3 个章节头与全部正文，字数统计 = 各章 content 长度之和

### Requirement: 一键全流程与取消

系统 SHALL 提供 `pipeline.runAll(params)`：按 init → outline → 逐章 chapter → compose 顺序串行执行，任一步失败即停止并返回 `{ success: false, stage, error, partial: { projectId, completedChapters } }`；SHALL 提供 `pipeline.cancel(projectId)` 使当前分片 AI 调用完成后停止后续流程。

#### Scenario: 一键全流程成功
- **WHEN** 调用 `runAll({ ..., chapterCount: 3, targetWordCount: 20000 })` 且 AI 服务正常
- **THEN** 依次收到 outline → chapter(×3) → compose 阶段进度事件，最终返回 `{ success: true, data: { projectId, filePath, wordCount, chapterCount } }`

#### Scenario: 中途失败保留部分结果
- **WHEN** 第 2 章生成时 AI 返回错误
- **THEN** 返回 `{ success: false, stage: 'chapter', error }`，第 1 章内容保留在项目中，不产生导出文件

### Requirement: 统一响应与错误处理

所有 `writing:pipeline:*` 方法 SHALL 返回统一信封 `{ success: boolean; data?; error?: string; code?: string }`（code ∈ VALIDATION / RESOURCE / AI / EXPORT / INTERNAL）。错误信息 SHALL 为可读中文且包含失败阶段。SHALL 不向渲染层暴露堆栈。

### Requirement: E2E 端到端验证

系统 SHALL 提供 dev-only E2E 执行器（主进程 `runPipelineE2E({ scale: 'smoke' | 'full' })` + IPC `writing:pipeline:runE2E`，非 dev 环境拒绝执行）：
1. 列出角色卡，不足 2 张则创建 2 张 `e2e-` 前缀最小角色卡，选取 2 张不同的
2. 列出世界书，不足 1 本则创建 1 本 `e2e-` 前缀世界书，选取 1 本
3. 调用 `runAll`：3 章；smoke 模式 targetWordCount=6000（每章 2000），full 模式 20000（每章 ~6667）
4. 对结果执行纯函数断言（`assertE2EResult`）：章节数 === 3；每章字数 ≥ 章目标 × 50%；总字数 ≥ 目标 × 80%；所选 2 个角色卡名称均出现在大纲或全文中；所选世界书至少 1 个核心词条出现在大纲或全文中；导出文件存在且非空
5. 生成结构化 E2E 报告（JSON，写入 exports 目录，含各步耗时/断言明细/结论）并返回

#### Scenario: 冒烟 E2E 通过
- **WHEN** dev 环境执行 `runE2E({ scale: 'smoke' })`
- **THEN** 全部断言通过，返回 `{ success: true, report: { ... , verdict: 'PASS' } }`，exports 目录含 `.md` 成书与 `e2e-report-*.json`

#### Scenario: 断言失败可诊断
- **WHEN** 某章字数低于阈值或角色名未注入
- **THEN** 报告 `verdict: 'FAIL'` 并列出具体失败断言项（如 `chapter[1] wordCount 1200 < 3333`），不抛异常

### Requirement: API 文档

SHALL 提供 `docs/writing-pipeline-api.md`：通道（端点）清单、每通道的请求/响应 JSON 格式与示例、进度事件字段、错误码表、鉴权说明（本地 IPC 无网络鉴权；AI 调用密钥取自应用设置的 AI 引擎，modelConfig 可覆盖）、E2E 执行方式。

## MODIFIED Requirements

### Requirement: WritingV2Entry（dev 增强）

`WritingV2Entry` 在 `import.meta.env.DEV` 时于顶栏显示「流水线自测」按钮（青色 dev 徽章风格），点击打开 E2E 控制台 Modal（规模选择 smoke/full + 开始/取消 + 进度 + 结果摘要 + 报告路径）。非 dev 构建完全不渲染。生产行为零变化。

## REMOVED Requirements

无。
