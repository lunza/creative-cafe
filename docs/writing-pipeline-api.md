# 小说全流程创作流水线 API（writing:pipeline:*）

> Spec: `add-novel-writing-pipeline-api`（2026-09-29）
> 实现层：主进程 `src/main/services/writing/WritingPipelineService.ts`（编排既有服务，零 V1 改动）+ `src/main/ipc/handlers/writingPipelineHandlers.ts`
> 类型契约：`src/shared/types/writing-v2.types.ts`（`PipelineAPI` 等）；纯函数 `src/shared/utils/pipelineUtils.ts`

## 1. 概述

本 API 以**应用内 IPC 通道**形式封装小说创作全流程，调用链：

```
渲染层 getPipelineAPI()  →  preload window.electronAPI.writingV2.pipeline
  →  ipcMain 'writing:pipeline:*'  →  WritingPipelineService（主进程编排）
    → OutlineGenerator / ContentGenerator / 角色卡 / 世界书 / 存储 / 导出（既有服务）
```

工作流：`init`（建项目 + 资源绑定）→ `generateOutline`（大纲，注入角色卡/世界书/风格）→ `generateChapter`（分片大纲 → 逐分片生成 → 合并落盘）→ `compose`（成书导出）。`runAll` 一键串联以上全部步骤。

## 2. 鉴权说明

- **传输层**：Electron 本地 IPC，无网络鉴权；仅应用自身窗口可通过 preload 白名单调用（preload 未暴露 `ipcRenderer` 原始句柄）。
- **AI 凭证**：各生成端点使用调用方传入的 `modelConfig`（或 E2E 时自动取应用设置中的激活引擎）；密钥由既有 `AIConfigProvider` 链路从应用设置读取，**API 本身不接收、不存储密钥**。
- **dev 门禁**：`writing:pipeline:runE2E` 在 `app.isPackaged`（生产包）下直接返回 `VALIDATION` 错误，仅开发环境可用。

## 3. 统一响应信封

所有通道返回 `PipelineEnvelope<T>`：

```jsonc
{
  "success": true,            // 是否成功
  "data": { },                // 成功载荷（失败时缺省）
  "error": "可读中文错误（含失败阶段前缀，如 [大纲] …）",  // 失败时
  "code": "AI",               // 失败错误码（见下表）
  "stage": "CHAPTER",         // 失败发生的阶段（可选）
  "partial": { "projectId": "p1", "completedChapters": 2 }  // runAll 中途失败保留的部分结果（可选）
}
```

### 错误码表

| code | 含义 | 典型场景 |
| --- | --- | --- |
| `VALIDATION` | 参数校验失败 | 章节数 1-50 越界、目标字数 1000-200000 越界、角色卡/世界书为空或 id 不存在、创意描述为空、模型配置缺失 |
| `RESOURCE` | 资源读取失败 | 项目不存在、大纲未生成就请求章节、角色卡/世界书文件缺失 |
| `AI` | 模型调用失败 | 引擎未配置/未激活、大纲解析失败、分片生成异常 |
| `EXPORT` | 成书导出失败 | 写文件失败、无章节正文 |
| `CANCELLED` | 用户取消 | `cancel` 后当前分片完成、后续流程停止（已完成内容保留） |
| `INTERNAL` | 未分类内部错误 | 兜底 |

## 4. 端点（IPC 通道）清单

渲染层统一经 `getPipelineAPI()`（`src/renderer/services/writingPipelineService.ts`）调用；preload 命名空间为 `window.electronAPI.writingV2.pipeline`。

### 4.1 `writing:pipeline:listResources` — 列出可绑定资源

- **请求**：无参数
- **响应 `data`**：

```json
{
  "characters": [{ "id": "C:/Users/…/角色卡.png", "name": "苏念" }],
  "worldBooks": [{ "id": "C:/Users/…/云澜大陆.json", "name": "云澜大陆.json" }]
}
```

> id 语义与既有资源绑定一致：角色卡为 PNG 绝对路径（卡数据内嵌 tEXt），世界书为 JSON 路径。

### 4.2 `writing:pipeline:createCharacterCard` — 创建最小角色卡

- **请求**：

```json
{ "name": "苏念", "profile": "性格与背景描述", "personality": "冷静缜密", "scenario": "可选：登场场景" }
```

- **响应 `data`**：`{ "id": "C:/Users/…/苏念.png", "name": "苏念" }`
- **说明**：使用 1x1 占位 PNG + 内嵌卡数据（`creator: "writing-pipeline"`），写入角色自定义目录。

### 4.3 `writing:pipeline:init` — 初始化项目 + 资源绑定

- **请求**（`PipelineInitParams`）：

```json
{
  "creativeDescription": "在灵潮复苏的云澜大陆，苏念与沈夜……（非空）",
  "novelType": "玄幻",
  "narrativePerspective": "第三人称",
  "writingStyle": "可选：风格名",
  "targetWordCount": 6000,
  "chapterCount": 3,
  "characterCardIds": ["<角色卡路径1>", "<角色卡路径2>"],
  "worldBookIds": ["<世界书路径>"],
  "modelConfig": { "model": "deepseek-chat", "temperature": 0.8, "maxTokens": 4096 }
}
```

- **校验**（`validatePipelineInit`）：chapterCount 1-50 整数；targetWordCount 1000-200000；角色卡 ≥1 不重复且存在于候选；世界书 ≥1 且存在；描述非空；modelConfig.model 非空。任一不满足 → `success:false, code:"VALIDATION"`，`error` 汇总全部错误。
- **⚠️ 枚举约束**：`novelType` 应传 `NovelType` 枚举值（`fantasy` / `web_novel` / `romance` …），`narrativePerspective` 应传 `NarrativePerspective` 枚举值（`first_person` / `third_person` / `omniscient`）。传入非法值时 `init` 自动归一化兜底（novelType → `other`、视角 → `third_person`），**不要传中文标签**（如「玄幻」）——模板表以枚举值为键，历史版本传中文会导致大纲生成崩溃。
- **响应 `data`**：`{ "projectId": "wp_xxx" }`
- **副作用**：创建 `WritingProject`（章节均分目标字数）并落盘。

### 4.4 `writing:pipeline:generateOutline` — 生成大纲

- **请求**：`projectId: string`
- **响应 `data`**：

```json
{ "chapterCount": 3, "chapters": [{ "index": 0, "title": "第一章 …", "summary": "…" }] }
```

- **说明**：加载绑定资源 → 构造含资源上下文/风格提示的 prompt → `outlineGenerator.generate` → `parseOutlineResponse` 解析 → 与 `chapterCount` 对齐（截断/补全）→ 落盘，项目状态转 `WRITING`。失败 `code:"AI"`。

### 4.5 `writing:pipeline:generateChapter` — 生成单章

- **请求**：`projectId: string, chapterIndex: number, shardCount?: number`
- **响应 `data`**：`{ "chapterIndex": 0, "wordCount": 2034, "shardCount": 1 }`
- **说明**：分片数缺省用 `suggestedShardCount(章目标字数)`（每片约 2500 字，1-5 片）。流程：分片大纲 → 逐分片生成（片间检查取消标志，携带前片内容衔接）→ 合并 → `autoSaveChapter` 落盘。任一分片失败 → `code:"AI"`。

### 4.6 `writing:pipeline:compose` — 成书导出

- **请求**：`projectId: string, format: 'TXT'|'MARKDOWN'|'EPUB', chapterIndices?: number[]`
- **响应 `data`**：`{ "filePath": "…/exports/书名-pipeline-2026-09-29.md", "wordCount": 6034, "chapterCount": 3 }`
- **说明**：缺省导出全部有正文章节；写 `projects/exports/` 目录。失败 `code:"EXPORT"`。

### 4.7 `writing:pipeline:runAll` — 一键全流程

- **请求**：同 `init`（`PipelineInitParams`）
- **成功响应 `data`**：`{ "projectId": "…", "filePath": "…/exports/….md", "wordCount": 6034, "chapterCount": 3 }`
- **中途失败**：`success:false` + `code/stage/error` + `partial: { projectId, completedChapters }`；已完成章节正文已落盘，可用 `generateChapter` 从断点续跑。
- **取消**：返回 `code:"CANCELLED"`，并尽力完成成书导出保留内容。

### 4.8 `writing:pipeline:status` — 流水线状态

- **请求**：`projectId: string`
- **响应 `data`**：`{ "stage": "CHAPTER", "currentChapter": 2, "totalChapters": 3, "running": true }`

### 4.9 `writing:pipeline:cancel` — 取消流水线

- **请求**：`projectId: string`
- **响应**：成功 `data: undefined`；对未运行项目返回 `error`。取消为"软取消"：当前分片 AI 调用完成后停止，已完成内容保留。

### 4.10 `writing:pipeline:runE2E` — E2E 自测执行器（dev-only）

- **请求**：`{ "scale": "smoke" | "full" }`（smoke：3 章 × 2000 字；full：3 章共 20000 字）
- **响应 `data.report`**（`PipelineE2EReport`）：

```json
{
  "scale": "smoke",
  "startedAt": 1759160000000,
  "finishedAt": 1759160420000,
  "durationMs": 420000,
  "characterNames": ["苏念", "沈夜"],
  "worldBookName": "e2e-测试世界书-…",
  "projectId": "wp_xxx",
  "exportPath": "…/exports/…-pipeline-….md",
  "wordCount": 6034,
  "chapterCount": 3,
  "assertions": [{ "name": "chapterCount", "passed": true, "detail": "实际 3 章 / 期望 3 章" }],
  "verdict": "PASS",
  "error": "仅失败时存在"
}
```

- **执行流程**：素材保障（角色卡 <2 创建 `e2e-测试角色N`；世界书 <1 写入 `e2e-测试世界书-*.json`，含「灵潮」「云澜大陆」词条）→ 解析激活引擎 modelConfig（无激活引擎 → `AI` 错误）→ `runAll` → 读回项目执行 `assertE2EResult` 断言 → 报告写 `projects/exports/e2e-report-<ts>.json`（报告路径附在 `report.reportPath`）。
- **断言项**：章节数 ===3；每章字数 ≥ 章目标 ×50%；总字数 ≥ 目标 ×80%；每个角色名出现在大纲或全文；世界书 ≥1 词条命中；导出文件存在非空。

## 5. 进度事件 `writing:pipeline:progress`

长任务（outline/chapter/compose/runAll/runE2E）经 handler 层 `BrowserWindow.getAllWindows()` 广播；渲染层订阅 `pipeline.onProgress(cb)`（返回 unsubscribe），**按 `projectId` 自行过滤**。

```json
{
  "projectId": "wp_xxx",
  "stage": "CHAPTER",
  "current": 2,
  "total": 3,
  "message": "第 2 章 · 分片 1/2 生成中",
  "percent": 55
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `projectId` | string | 归属项目（过滤依据） |
| `stage` | `PipelineStage` | IDLE/INIT/OUTLINE/CHAPTER/COMPOSE/DONE/ERROR |
| `current` / `total` | number | 阶段内进度（章节或分片序号） |
| `message` | string | 人类可读描述 |
| `percent` | number | 0-100 总体百分比 |

## 6. 渲染层使用示例

```ts
import { getPipelineAPI } from '@/renderer/services/writingPipelineService';

const pipeline = getPipelineAPI(); // 应用未就绪时为 null
if (!pipeline) throw new Error('pipeline not ready');

const off = pipeline.onProgress((e) => console.log(e.stage, e.percent));
try {
  const res = await pipeline.runAll({
    creativeDescription: '…',
    novelType: '玄幻',
    narrativePerspective: '第三人称',
    targetWordCount: 6000,
    chapterCount: 3,
    characterCardIds: [/* 来自 listResources */],
    worldBookIds: [/* 来自 listResources */],
    modelConfig: { model: 'deepseek-chat', temperature: 0.8, maxTokens: 4096 },
  });
  if (!res.success) console.error(res.code, res.error, res.partial);
} finally {
  off();
}
```

## 7. E2E 执行方式

1. `npm run dev` 启动（必须为开发环境，`app.isPackaged` 下 runE2E 拒绝）。
2. 进入「写作模式 2.0」，侧栏底部 dev-only「流水线自测」按钮（`V2PipelineSelfTest.tsx`）→ 选择冒烟/全量 → 开始执行。
3. 结束后核对 `projects/exports/e2e-report-*.json` 的 `verdict`（PASS/FAIL）与断言明细。
4. 验收基线：smoke（6000 字）PASS → full（20000 字）PASS。

## 8. 相关文件

| 文件 | 职责 |
| --- | --- |
| `src/main/services/writing/WritingPipelineService.ts` | 流水线编排（单例 `writingPipelineService`） |
| `src/main/ipc/handlers/writingPipelineHandlers.ts` | 10 个通道注册 + 进度广播 + runE2E dev 门禁 |
| `src/shared/types/writing-v2.types.ts` | `PipelineAPI` 及全部 Pipeline 类型 |
| `src/shared/utils/pipelineUtils.ts` | 校验 + E2E 断言纯函数（可单测） |
| `src/shared/utils/__tests__/pipelineUtils.test.ts` | 27 用例单测 |
| `src/renderer/services/writingPipelineService.ts` | 渲染层 service（`getPipelineAPI`） |
| `src/renderer/components/Creative/WritingModeV2/V2PipelineSelfTest.tsx` | dev-only E2E 控制台 UI |
