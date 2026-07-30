# Creative Café 代码 Wiki

> **版本**：v1.0.5 ｜ **最后更新**：2026-07-31
> **定位**：本文档是对 `creative-cafe` 仓库的系统性架构解读，涵盖整体架构、模块职责、关键类与函数、依赖关系及运行方式。
> **结构变更**：原 §14「已知重点问题与修复记录」（51 个子节、2447 行）已拆分至 [`docs/FIX_RECORDS.md`](./docs/FIX_RECORDS.md)；版本级发布日志见 `CHANGELOG.md`。

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [主进程架构](#4-主进程架构)
5. [渲染进程架构](#5-渲染进程架构)
6. [核心功能模块详解](#6-核心功能模块详解)
7. [AI 服务体系](#7-ai-服务体系)
8. [向量与检索体系](#8-向量与检索体系)
9. [状态管理](#9-状态管理)
10. [共享类型系统](#10-共享类型系统)
11. [依赖关系](#11-依赖关系)
12. [项目运行方式](#12-项目运行方式)
13. [关键设计规范与约定](#13-关键设计规范与约定)
14. [已知重点问题与修复记录（已拆分至 docs/FIX_RECORDS.md）](#14-已知重点问题与修复记录已拆分)

---

## 1. 项目概述

**Creative Café（创想咖啡厅）** 是一款 **AI 驱动的创意内容管理桌面工具**，基于 Electron + React + TypeScript 构建。它专注于角色卡、世界书的创建编辑，并扩展出小说写作、文字游戏、记忆管理、知识库检索等高级能力。

### 核心特性一览

| 模块 | 能力 |
|------|------|
| 角色卡管理 | 兼容 SillyTavern V2/V3 PNG 格式，可视化编辑、AI 辅助生成、测试对话、PNG 导出 |
| 世界书管理 | SillyTavern JSON 格式，条目 CRUD、AI 智能生成、关系图谱、向量化检索 |
| 写作模式 | 大纲生成、章节生成（分片/分块/续写）、剧情检查、表格整理、版本管理、风格学习 |
| 游戏模式 | 文字 RPG / 狼人杀 / 恋爱模拟 / 推理 / 经营五类模板，AI 叙事 + tableEdit 表格驱动 |
| 记忆插件 | Excel 模板管理、聊天记录树形浏览、AI 自动整理归档、表格关联 |
| 创意管理 | Milkdown/TextEditor 编辑、AI 扩写润色翻译、创意一键转角色卡/世界书 |
| 知识库 | PDF/DOCX/TXT 导入、sqlite-vec 向量存储、语义检索 |
| 用户人设 | 自定义 Persona、统一存储路径管理 |
| 提示词管理 | 模板编辑、组装预览、版本历史、回滚、AI 优化 |

### 技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Electron 33 |
| 前端框架 | React 18 + TypeScript |
| UI 组件 | Ant Design 6 |
| 状态管理 | Zustand 5 |
| Markdown 编辑 | Milkdown 7.x (Crepe) + 自研 TextEditor |
| 构建工具 | Vite 5 + vite-plugin-electron |
| 向量数据库 | sqlite-vec + better-sqlite3 + @xenova/transformers |
| AI 集成 | AI SDK V6 (`ai`)、`@ai-sdk/openai`、`@ai-sdk/react` |
| 角色卡读写 | `@lenml/char-card-reader`、`png-chunks-extract`、`png-chunk-text` |
| 文档解析 | `pdf-parse`、`mammoth`、`xlsx` |
| Token 计数 | `gpt-tokenizer`（cl100k_base） |
| 测试 | Vitest 4 |

---

## 2. 整体架构

Creative Café 采用标准的 **Electron 双进程架构**，并通过 `shared/` 目录实现主进程与渲染进程间的类型与常量共享。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron 应用外壳                           │
│                                                                 │
│  ┌──────────────────────┐        IPC         ┌────────────────┐ │
│  │     主进程 (Main)     │ ◄──────────────► │  渲染进程       │ │
│  │  Node.js 环境         │   contextBridge   │  (Renderer)     │ │
│  │                       │   electronAPI     │  React UI       │ │
│  │  • ipc/handlers       │                   │  • components/  │ │
│  │  • services           │                   │  • stores/      │ │
│  │  • 文件系统 / 向量库   │                   │  • hooks/       │ │
│  └──────────┬───────────┘                   └───────┬────────┘ │
│             │                                        │          │
│             │           ┌──────────────┐             │          │
│             └──────────►│  shared/     │◄────────────┘          │
│                         │  types/      │                        │
│                         │  constants/  │                        │
│                         │  settings.ts │                        │
│                         └──────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### 进程职责划分

- **主进程**：负责所有 Node.js 能力——文件读写、向量存储、AI HTTP 请求转发、文档解析、模型下载、原生对话框等。通过 `ipcMain.handle` 注册处理器，向渲染进程暴露能力。
- **渲染进程**：纯前端 React 应用，通过 `window.electronAPI` 调用主进程能力，不直接接触 Node.js API。所有业务 UI、状态管理、提示词构建在此完成。
- **Preload 脚本**：通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 在隔离上下文中桥接两进程，是唯一的通信通道。

### 通信数据流（以 AI 流式请求为例）

```
Renderer (React)
  └─> window.electronAPI.ai.request({url, headers, body, streaming})
       └─> IPC channel: 'ai:request'
            └─> aiHandlers.ts (主进程)
                 └─> fetch HTTP (OpenAI 兼容 API)
                      └─> ReadableStream (SSE)
                           └─> IPC: 'ai:stream' (chunk)
                                └─> Renderer onStream 回调
```

---

## 3. 目录结构

```
creative-cafe/
├── src/
│   ├── main/                          # Electron 主进程
│   │   ├── index.ts                   # 主进程入口（创建窗口、注册 IPC、退出持久化）
│   │   ├── preload.ts                 # 预加载脚本（暴露 electronAPI）
│   │   ├── ipc/
│   │   │   ├── index.ts               # IPC 注册统一入口 setupIpcHandlers()
│   │   │   ├── handlers/              # 各功能 IPC 处理器
│   │   │   │   ├── game/              # 游戏模式（分 meta/save/narrative/table/config）
│   │   │   │   ├── memory/            # 记忆插件（session/table/template/external）
│   │   │   │   ├── writing/           # 写作模式（project/outline/chapter/plotCheck/style/template/table）
│   │   │   │   ├── utils/             # IPC 工具（boundedQueue 背压、wrapHandler 包装）
│   │   │   │   └── *.ts               # 其他功能处理器
│   │   │   └── ...
│   │   ├── services/                  # 核心业务服务
│   │   │   ├── ai/                    # AI 配置提供者 + SSE 流解析器
│   │   │   ├── agent/                 # 智能体底座（自研 + openclaw 适配，详见 §4.5）
│   │   │   │   ├── core/              # AgentCore / agentLoop / sandbox / lifecycle / lanes
│   │   │   │   ├── infra/             # backoff / dedupe / retry / sqliteUtils 等基础设施
│   │   │   │   ├── learning/          # 长期记忆与自学习（dreaming / goal / steer / feedback / cron）
│   │   │   │   ├── llm/               # capabilityDetector / llmProvider / streamAdapter / multimodalMessage
│   │   │   │   ├── memory/            # memoryStore / sqliteBackend / adapters（chapter/character/chatHistory/worldBook）
│   │   │   │   ├── skills/            # SKILL.md 契约 + 三层可见性 + 双调用
│   │   │   │   ├── tools/             # ToolRegistry + builtin（dialogue/worldbook/updateStateTable）
│   │   │   │   ├── writing/           # writingAgentService（固定编排循环 + 断点续跑）
│   │   │   │   └── contracts.ts        # 自研类型契约（统一 ISkill / ITool / IAgent 等接口）
│   │   │   ├── game/                  # 游戏叙事/仓库/表格编辑/模板
│   │   │   ├── memory/                # 记忆整理编排/聊天日志/表格操作
│   │   │   ├── vector/                # 向量后端/仓库/策略
│   │   │   ├── writing/               # 写作生成/检查/大纲/风格/模板/仓库
│   │   │   ├── AIService.ts           # 统一 AI 调用抽象层
│   │   │   ├── EmbeddingService.ts    # 远程 Embedding
│   │   │   ├── EmbeddingWorkerService.ts  # 本地 Embedding（@xenova/transformers）
│   │   │   ├── EmbeddingCache.ts     # Embedding LRU + SQLite 持久化
│   │   │   ├── VectorStoreService.ts  # 向量存储 Facade
│   │   │   ├── VectorRegistryService.ts / VectorConfigManager.ts / VectorCache.ts  # 向量注册/配置/缓存
│   │   │   ├── SqliteVecBackend.ts # sqlite-vec 后端实现（替换原 VecstoreVectorStore）
│   │   │   ├── KnowledgeBaseService.ts / KnowledgeBaseDocumentService.ts  # 知识库
│   │   │   ├── ContextManager.ts      # 上下文检索（RAG）
│   │   │   ├── ChatVectorizationService.ts / ChatStorageService.ts / ChatVersionService.ts  # 对话向量化与版本
│   │   │   ├── TextSplitterService.ts / DocumentProcessorService.ts  # 文档切分/解析
│   │   │   ├── TableSnapshotService.ts / VersionLinkerService.ts  # 表格快照/版本链接
│   │   │   ├── worldBookService.ts / WorldBookKeywordMatcher.ts / WorldBookKeywordIndex.ts  # 世界书服务 + 倒排索引
│   │   │   ├── characterService.ts    # 角色卡服务
│   │   │   ├── avatarService.ts / expressionService.ts  # 用户人设 / 角色表情
│   │   │   ├── assetService.ts / characterTraitService.ts / characterTraitAIService.ts  # 素材与角色特征
│   │   │   ├── loraService.ts / characterLoraService.ts  # LoRA 列表 + 按角色独立存储
│   │   │   ├── sdGenerationService.ts # Stable Diffusion WebUI 客户端
│   │   │   ├── storageService.ts      # 通用 KV 存储（electron-store）
│   │   │   ├── storageManager.ts / storage.types.ts  # 存储管理
│   │   │   ├── settingService.ts / promptTemplateService.ts / optimizerService.ts  # 设置/提示词模板/优化
│   │   │   ├── ConfigCleanupService.ts / ModelDownloadService.ts / modelDownloader.ts  # 配置清理 / 模型下载
│   │   │   ├── TokenCountService.ts   # 精确 Token 计数
│   │   │   ├── logger.ts / logPathService.ts / pathService.ts / fileService.ts  # 日志/路径/文件
│   │   │   ├── WritingStorageService.ts / WritingResourceManager.ts / WritingStyleLearningService.ts  # 写作存储/素材/风格学习
│   │   │   └── ...
│   │   ├── types/                     # 主进程专用类型（vectorConfig.ts）
│   │   └── utils/appPath.ts           # 用户数据路径工具
│   │
│   ├── renderer/                      # 渲染进程
│   │   ├── main.tsx                   # React 挂载入口
│   │   ├── App.tsx                    # 根组件（布局 + 路由渲染）
│   │   ├── routeConfig.ts             # 统一路由配置（单一数据源）
│   │   ├── settings.ts                # 渲染进程设置入口
│   │   ├── components/                # React 组件
│   │   │   ├── Character/             # 角色卡管理 + 角色对话
│   │   │   ├── Creative/              # 创意管理 + 写作模式
│   │   │   ├── WorldBook/             # 世界书管理
│   │   │   ├── Game/                  # 游戏模式
│   │   │   ├── MemoryChat/            # 记忆插件
│   │   │   ├── KnowledgeBase/         # 知识库
│   │   │   ├── Chat/                  # 创作中心（统一聊天入口）
│   │   │   ├── PromptManagement/      # 提示词管理
│   │   │   ├── Layout/                # 布局（Sidebar/Header/PageTransition）
│   │   │   ├── Common/                # 公共组件（ChatEngine/MarkdownEditor/TextEditor/AIService）
│   │   │   ├── Dashboard/             # 仪表盘
│   │   │   ├── Avatar/                # 用户人设（路由 `avatar` → AvatarManager）
│   │   │   ├── UserPersona/           # 用户人设（新版组件，与 Avatar/ 并存）
│   │   │   ├── Vector/                # 向量配置 UI
│   │   │   ├── Settings/              # 系统设置
│   │   │   └── Test/                  # 测试页（DEV，含 document-vector / test-markdown 子页）
│   │   ├── stores/                    # Zustand 状态管理
│   │   ├── hooks/                     # 通用 Hooks
│   │   ├── services/                  # 渲染进程服务（AIEdit/documentVector/rendererEmbedding）
│   │   ├── utils/                     # 工具函数
│   │   ├── types/                     # 渲染进程类型（electron.d.ts 等）
│   │   ├── constants/                 # 常量
│   │   └── styles/                    # 全局样式
│   │
│   └── shared/                        # 主/渲染共享
│       ├── types/                     # 共享类型定义（单一真源）
│       ├── constants/                 # 共享常量
│       └── settings.ts                # 全局默认设置 AppSetting
│
├── scripts/generate-icon.js           # 图标生成脚本
├── index.html                         # Vite 入口 HTML
├── vite.config.ts                     # Vite + Electron 构建配置
├── electron-builder.json              # 打包配置
├── tsconfig.json                      # TypeScript 配置
├── vitest.config.ts                   # 测试配置
├── start.bat / start.sh               # 启动脚本
└── package.json
```

---

## 4. 主进程架构

### 4.1 入口 `src/main/index.ts`

主进程入口承担三项核心职责：

1. **窗口创建**：`createWindow()` 创建 1400×900 的 `BrowserWindow`，配置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`，并注入 CSP 安全策略。
2. **IPC 注册**：`app.whenReady()` 后调用 `setupIpcHandlers()` 注册所有处理器，并异步初始化 `VectorRegistryService`。
3. **退出持久化**：`before-quit` 事件中通过 `event.preventDefault()` 阻止退出，异步完成向量数据落盘后再 `app.quit()`，避免数据丢失。

```typescript
// 关键：退出时持久化向量数据
app.on('before-quit', (event) => {
  if (hasPersisted || isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  (async () => {
    try {
      await vectorStoreService.persist();
      await vectorRegistryService.persist();
    } finally {
      hasPersisted = true;
      app.quit();
    }
  })();
});
```

### 4.2 IPC 注册中心 `src/main/ipc/index.ts`

`setupIpcHandlers()` 是所有 IPC 处理器的统一注册入口，调用顺序：

1. 基础处理器：`settingHandlers`、`worldBookHandlers`、`characterHandlers`、`avatarHandlers`、`fileHandlers`、`appHandlers`、`pluginHandlers`、`documentHandlers`、`updateHandlers`
2. 业务处理器（register 模式，按 `setupIpcHandlers` 调用顺序）：
   - `registerMemoryHandlers`、`registerCreativeHandlers`、`registerCharacterChatHandlers`、`registerWritingHandlers`、`registerGameHandlers`、`registerPromptHandlers`、`registerTokenHandlers`（早期业务）
   - `registerExpressionHandlers`（表情管理，Spec: add-character-expression-system / Task 1）
   - `registerCharacterTraitHandlers`（角色特征，add-asset-and-trait-management / Task 2）
   - `registerAssetHandlers`（素材管理，Task 7）
   - `registerSdGenerationHandlers`（SD 表情生成，add-ai-expression-generation / Task 2）
   - `registerCharacterTraitAIHandlers`（AI 辅助特征生成，Task 12）
   - `registerLoraHandlers`（LoRA 列表，add-lora-model-selection / Task 3）
   - `registerCharacterLoraHandlers`（按角色独立存储 LoRA，2026-07-29 bug 修复）
   - `registerAgentHandlers`（智能体底座，implement-agent-foundation-and-fix-defects / Task 9，暴露 `agent:*` / `skill:*` / `memory:search` / `learning:dream` 等 9 个通道）
3. 服务自注册：`embeddingService`、`vectorStoreService`、`knowledgeBaseService`、`knowledgeBaseDocumentService`、`contextManager`、`modelDownloadService`、`embeddingWorkerService` 各自调用 `initialize()` + `registerIpcHandlers()`

> **单一入口约束**：`main/index.ts` 仅依赖 `setupIpcHandlers()`，所有 register 调用必须在此函数内登记（Task 25.2 迁移后确立）。新增业务 IPC 时，请在第 2 组对应位置追加 register 调用，避免散落到 `main/index.ts`。

### 4.3 IPC 处理器命名空间

`preload.ts` 通过 `contextBridge` 暴露 `window.electronAPI`，主要命名空间：

| 命名空间 | 职责 |
|----------|------|
| `setting` | 系统设置加载/保存/路径（注意单数 `setting`） |
| `character` / `characterConfig` / `characterChat` / `chatVersion` | 角色卡 CRUD、配置、测试对话、版本管理 |
| `characterTrait` / `characterTraitAI` | 角色特征 CRUD / AI 辅助特征生成（`ai:generateCharacterTraits`，add-asset-and-trait-management） |
| `characterLora` | 按角色卡独立持久化 LoRA 配置（`character-lora:list/save`，2026-07-29 bug 修复） |
| `expression` | 角色表情管理（list/save/delete/批量预热，add-character-expression-system） |
| `asset` | 素材管理（list/save/delete/getImagePath，按 `assetType` 区分表情/立绘/特征图） |
| `lora` | LoRA 模型列表（`/sdapi/v1/loras`，add-lora-model-selection） |
| `sdGeneration` | SD WebUI 表情生成（checkStatus/getModels/generateExpression/generateAllExpressions/cancelGeneration） |
| `worldBook` / `worldbook` | 世界书文件操作 / 关键词匹配 |
| `avatar` | 用户人设 |
| `creative` | 创意数据 |
| `memory` | 记忆模板/会话/表格/聊天记录/外部调用 |
| `writing` | 写作项目/大纲/章节/分片/表格/风格/模板/剧情检查 |
| `game` | 游戏元数据/存档/表格/叙事生成（流式） |
| `ai` | AI 请求转发（流式/非流式）、取消、模型列表 |
| `agent` | 智能体底座：`agent:run/cancel/token/toolCall/done` + `skill:list/invoke` + `memory:search` + `learning:dream`（implement-agent-foundation-and-fix-defects / Task 9） |
| `embedding` / `vector` / `chatVector` / `chatHistory` | Embedding 生成、向量存储、对话向量化、历史 RAG |
| `document` / `knowledge` | 文档处理、知识库 |
| `context` | 上下文检索（RAG retrieve/compress） |
| `prompt` | 提示词模板管理 |
| `token` | 精确 Token 计数（cl100k_base） |
| `storage` / `file` / `app` / `update` / `plugin` / `model` | 通用存储、文件、应用信息、更新、插件、模型下载 |

> **规范提醒**：获取系统设置必须用 `window.electronAPI.setting.load()`（单数），返回 `{ success, setting }`。详见 [§13](#13-关键设计规范与约定)。

### 4.4 核心服务层 `src/main/services/`

#### 通用服务

| 服务 | 文件 | 职责 |
|------|------|------|
| `AIService` | `AIService.ts` | 统一 AI 调用抽象层：配置获取、请求构建、SSE 流解析、错误重试。Re-export `SSEStreamParser` |
| `storageService` | `storageService.ts` | 基于 `electron-store` 的通用 KV 存储，单例 `getStorageService()` |
| `storageManager` | `storageManager.ts` | 存储管理器 |
| `pathService` / `logPathService` / `appPath` | `pathService.ts` 等 | 路径管理 |
| `logger` | `logger.ts` | 统一分级日志（error/warn/info/debug） |
| `fileService` | `fileService.ts` | 文件操作 |
| `settingService` | `settingService.ts` | 系统设置加载/保存（与 `settingHandlers` 配合） |
| `promptTemplateService` | `promptTemplateService.ts` | 提示词模板 CRUD |
| `optimizerService` | `optimizerService.ts` | AI 参数优化建议 |
| `ConfigCleanupService` | `ConfigCleanupService.ts` | 历史配置清理 |
| `TokenCountService` | `TokenCountService.ts` | 精确 Token 计数（cl100k_base，与 `tokenHandlers` 配合） |
| `ModelDownloadService` / `modelDownloader` | `ModelDownloadService.ts` / `modelDownloader.ts` | 本地 Embedding 模型下载 |
| `avatarService` | `avatarService.ts` | 用户人设 CRUD |
| `expressionService` | `expressionService.ts` | 角色表情管理（manifest 读写、批量预热，add-character-expression-system / Task 1，详见 [`docs/FIX_RECORDS.md`](./docs/FIX_RECORDS.md) §14.10 / §14.12） |
| `assetService` | `assetService.ts` | 素材 CRUD（按 `assetType` 区分表情/立绘/特征图，add-asset-and-trait-management / Task 6，详见 `docs/FIX_RECORDS.md` §14.22） |
| `characterTraitService` | `characterTraitService.ts` | 角色特征持久化（Task 1，详见 `docs/FIX_RECORDS.md` §14.21） |
| `characterTraitAIService` | `characterTraitAIService.ts` | AI 辅助特征生成（LLM 提取视觉 tag，Task 12，详见 `docs/FIX_RECORDS.md` §14.25） |
| `sdGenerationService` | `sdGenerationService.ts` | Stable Diffusion WebUI API 客户端：状态检查 / 模型列表 / 角色卡基底图提取 / img2img 表情生成 / 任务取消（Spec: add-ai-expression-generation，详见 `docs/FIX_RECORDS.md` §14.14） |
| `loraService` | `loraService.ts` | LoRA 模型列表获取服务：调用 `/sdapi/v1/loras` 拉取列表 + 构建预览图 URL + 读取 JSON 元数据 + 提取分类（Spec: add-lora-model-selection，详见 `docs/FIX_RECORDS.md` §14.28） |
| `characterLoraService` | `characterLoraService.ts` | 按角色卡独立持久化 LoRA 配置（2026-07-29 bug 修复，详见 `docs/FIX_RECORDS.md` §14.36） |
| `EmbeddingCache` | `EmbeddingCache.ts` | Embedding LRU（内存）+ SQLite 持久化双轨缓存（implement-agent-foundation-and-fix-defects / Task 10，详见 `docs/FIX_RECORDS.md` §14.42） |
| `WorldBookKeywordIndex` | `WorldBookKeywordIndex.ts` | 世界书关键词倒排索引（Aho-Corasick + 增量更新，Task 11，详见 `docs/FIX_RECORDS.md` §14.43） |
| `WorldBookKeywordMatcher` | `WorldBookKeywordMatcher.ts` | 世界书关键词匹配器（依赖 `WorldBookKeywordIndex`，按 scope 缓存） |
| `ChatStorageService` / `ChatVersionService` | `ChatStorageService.ts` / `ChatVersionService.ts` | 对话存储 / 版本管理 |
| `ChatVectorizationService` | `ChatVectorizationService.ts` | 对话历史向量化与检索 |
| `TableSnapshotService` / `VersionLinkerService` | `TableSnapshotService.ts` / `VersionLinkerService.ts` | 表格快照 / 版本链接 |
| `TextSplitterService` / `DocumentProcessorService` | `TextSplitterService.ts` / `DocumentProcessorService.ts` | 文档切分 / 解析 |

#### 向量与检索服务（详见 [§8](#8-向量与检索体系)）

`VectorStoreService`、`EmbeddingService`、`EmbeddingWorkerService`、`SqliteVecBackend`、`VectorRegistryService`、`VectorConfigManager`、`VectorCache`、`ContextManager`、`KnowledgeBaseService`、`KnowledgeBaseDocumentService`、`ChatVectorizationService`、`TextSplitterService`、`DocumentProcessorService`、`WorldBookKeywordMatcher`、`WorldBookKeywordIndex`、`VersionLinkerService`、`TableSnapshotService`、`EmbeddingCache`。

#### 写作服务（`services/writing/`）

| 服务 | 职责 |
|------|------|
| `WritingProjectRepository` | 项目持久化（索引/章节/分块目录管理，安全写入） |
| `WritingStorageService` | 写作数据存储 + 表格整理提示词构建 + 长章节分批 |
| `ContentGenerator` | 章节内容生成 |
| `ChapterChunkService` | 章节分块生成（支持断点续传） |
| `OutlineGenerator` | 大纲生成 |
| `DescriptionPolisher` | 描述润色（流式） |
| `PlotCheckerService` | 剧情逻辑检查 + 自动修正（带 diff） |
| `AIAssistedChapterService` | AI 辅助章节操作（拆分/合并建议） |
| `TableEditCommandExecutor` | tableEdit 命令执行 |
| `TableOrganizeService` | 表格整理编排 |
| `WritingStyleRepository` / `WritingStyleLearningService` | 写作风格学习 |
| `WritingTemplateRepository` | 自定义模板（小说类型/写作风格） |
| `WritingTableRepository` | 写作表格数据 |
| `PromptBuilder` | 写作提示词构建 |
| `NovelTypeTemplates` | 预置小说类型模板 |
| `LogicCheckRecorder` | 逻辑检查记录 |
| `WritingResourceManager` | 写作素材资源管理 |

#### 游戏服务（`services/game/`）

| 服务 | 职责 |
|------|------|
| `GameRepository` | 游戏元数据 CRUD |
| `GameSaveRepository` | 存档 CRUD |
| `GameTableRepository` | 游戏表格数据 |
| `GameNarrativeService` | AI 叙事生成（流式） |
| `GamePromptBuilder` | 游戏提示词构建 |
| `GameTableEditParser` | 游戏表格编辑命令解析 |
| `ManagementNarrativeService` / `ManagementPromptBuilder` | 经营类专属叙事与提示词 |

#### 记忆服务（`services/memory/`）

| 服务 | 职责 |
|------|------|
| `chatLogService` | 聊天记录管理 + AI 整理（同步/异步）+ tableEdit 执行 |
| `organizeOrchestrator` | 整理编排器 |
| `tableFileRepository` | 表格文件持久化 |
| `tableOperationExecutor` | 表格操作执行 |
| `tableTemplateService` | 表格模板管理 |
| `tableEditParser` | tableEdit 命令解析（memory 适配层，继承 `TableEditParserBase`） |
| `tableEditParserBase` | tableEdit 解析器公共基类（块提取 / JSON 容错 / 命令分派 / F3 越界校验） |
| `chatSessionRepository` | 聊天会话 |
| `associationRepository` | 会话-模板关联 |
| `characterChatRecordService` | 角色聊天记录 |
| `aiClient` / `aiPromptBuilder` | 记忆专用 AI 客户端与提示词 |

### 4.5 智能体底座服务 `src/main/services/agent/`

> **来源**：implement-agent-foundation-and-fix-defects（阶段 1-6，Task 4-18）。自研 + 适配 openclaw 的混合实现，作为对话 / 写作 / 世界书自驱的统一执行底座。详细变更记录见 [`docs/FIX_RECORDS.md`](./docs/FIX_RECORDS.md) §14.39-§14.49。

#### 模块结构

| 子目录 | 关键文件 | 职责 |
|--------|----------|------|
| `core/` | `agentCore.ts` / `agentLoop.ts` / `sandbox.ts` / `lifecycle.ts` / `lanes.ts` / `timeout.ts` / `usage.ts` / `context.ts` | AgentCore 主循环、工具沙箱执行、生命周期、并发 lane、超时与用量统计 |
| `infra/` | `backoff.ts` / `dedupe.ts` / `retry.ts` / `sqliteUtils.ts` / `errors.ts` | 退避 / 去重 / 重试 / SQLite 工具 / 错误类型（ES2020 兼容） |
| `llm/` | `capabilityDetector.ts` / `llmProvider.ts` / `streamAdapter.ts` / `multimodalMessage.ts` / `mediaCodec.ts` | 模型能力探测（视觉/思维链/工具调用）、流式适配、多模态消息编码 |
| `memory/` | `memoryStore.ts` / `sqliteBackend.ts` / `memoryPromptPrepare.ts` / `writeProvenance.ts` + `adapters/`（chapter/character/chatHistory/worldBook） | 长期记忆 SQLite 存储 + 四类业务适配器 + 写入溯源 |
| `skills/` | `skillContract.ts` / `skillAvailability.ts` / `skillLoader.ts` / `skillSnapshot.ts` / `skillInvoker.ts` / `skillRegistry.ts` / `types.ts` | SKILL.md 契约解析 + 三层可见性 + 双调用（同步/异步）+ 会话快照 LRU |
| `tools/` | `toolRegistry.ts` / `types.ts` + `builtin/`（`dialogueTools.ts` / `worldbookTools.ts` / `updateStateTable.ts`） | ToolRegistry + 三组内置工具（dialogue / worldbook / writing） |
| `writing/` | `writingAgentService.ts` / `writingAgentTypes.ts` | 写作智能体编排（固定编排循环 + 断点续跑 + 前端三态视图） |
| `learning/` | `dreamingService.ts` / `goalTracker.ts` / `steerEngine.ts` / `feedbackLoop.ts` / `cronScheduler.ts` / `pacing.ts` / `stagger.ts` / `types.ts` | 长期记忆与自学习（dreaming 短期→长期摘要 / goal 目标追踪 / steer 行为引导 / feedback 反思 / cron 轻量调度 + pacing/stagger 防失控双保险） |
| 顶层 | `contracts.ts` | 自研类型契约，统一 ISkill / ITool / IAgent 等接口 |

#### 核心设计要点

- **照抄 vs 适配 vs 自研**：`core/` 与 `infra/` 多为 openclaw 适配（保留原结构以利后续 sync）；`contracts.ts`、`learning/cronScheduler.ts`、`writing/writingAgentService.ts` 为自研。
- **ES2020 兼容性**：Electron 主进程目标为 ES2020，`infra/` 中所有 `??` / `?.` / `Promise.allSettled` 使用均经核验；`sqliteUtils.ts` 对 `better-sqlite3` 同步 API 做了 Promise 化封装。
- **IPC 通道**：`agentHandlers.ts` 注册 9 个通道（`agent:run/cancel/token/toolCall/done` + `skill:list/invoke` + `memory:search` + `learning:dream`），详见 §4.3 `agent` 命名空间。
- **降级策略**：模型不支持工具调用时，自动降级为纯文本生成（由 `llm/capabilityDetector.ts` 探测，`agentCore.ts` 决策）。
- **配套修复（重点标记）**：Embedding 缓存初始化、WorldBook 倒排索引增量更新、storageService 异步化、写作服务容错（F5 重试 / F7 quickFix 一致性）、测试套件全量审核——详见 `docs/FIX_RECORDS.md` §14.42 / §14.43 / §14.44 / §14.45 / §14.51。

---

## 5. 渲染进程架构

### 5.1 启动链路

`main.tsx` → 挂载 `<App />` → `App.tsx` 读取 `useUIStore` 的 `activeTab`，通过 `findRouteComponent(activeTab)` 从 `routeConfig.ts` 查找组件渲染。

```typescript
// App.tsx 核心渲染逻辑
const renderContent = () => {
  const Component = findRouteComponent(activeTab);
  return Component ? <Component /> : <Dashboard />;
};
```

### 5.2 路由配置 `routeConfig.ts`

**单一数据源（Single Source of Truth）** 设计：Sidebar 菜单与 App 渲染块均消费 `routeConfigs`，新增 Tab 只需在此添加一项。

| key | 标签 | 组件 | 备注 |
|-----|------|------|------|
| `dashboard` | 仪表盘 | `Dashboard` | |
| `chat` | 创作中心 | `CreationCenter` | 统一聊天入口 |
| `creative` | 创意管理 | `CreativeManager` | |
| `worldbook` | 世界书 | `WorldBookManager` | |
| `avatar` | 用户人设 | `AvatarManager` | 由 `components/Avatar/AvatarManager` 实现 |
| `character` | 角色卡 | `CharacterManager` | |
| `memory` | 记忆管理 | `MemoryChatManager` | |
| `knowledge` | 知识库 | `KnowledgeBaseManager` | |
| `settings` | 设置 | `Settings` | |
| `prompt-management` | 提示词管理 | `PromptManagement` | |
| `test` | 测试 | `TestPage` | devOnly，含子菜单：`test-vector`（无 component，走 default → Dashboard）/ `document-vector`（`DocumentVectorPage`）/ `test-markdown`（`TestPage`） |

> **历史变更**：早期版本曾规划 `plugin` 路由（`PluginManager`，devOnly），但当前 `routeConfig.ts` 已无此条目，插件管理入口未启用。`UserPersona/` 目录虽存在但尚未接入路由。

### 5.3 布局组件 `components/Layout/`

- `Sidebar.tsx`：左侧导航，基于 `getMenuRoutes(debugMode)` 渲染，支持 DEV 徽标
- `Header.tsx`：顶部栏。**【全局模型能力徽章，2026-07-28】** Logo 区新增当前激活引擎能力标识组合（数据来源 `useSettingStore` → `activeEngine.capabilities`）：`EditOutlined`（文本生成，常驻）/ `EyeOutlined`（视觉，`supportsVision=true`，绿色）/ `BulbOutlined`（思维链，`supportsThinking=true`，紫色）/ `ToolOutlined`（工具调用，`supportsToolCalling=true`，橙色）。`capabilities` 为 `undefined` 时仅显示编辑图标 + Tooltip 提示测试连通性。与 `AIEngineSettingsPanel.renderCapabilityBadges`（详见 [`docs/FIX_RECORDS.md`](./docs/FIX_RECORDS.md) §14.27）形成「全局概览 + 详细管理」双层可视化
- `PageTransition.tsx`：页面切换动画包装

### 5.4 公共组件 `components/Common/`

| 组件 | 职责 |
|------|------|
| `ChatEngine/` | 聊天引擎核心（策略模式 + 工厂模式），封装 AI 调用 |
| `MarkdownEditor/` | 基于 Milkdown 的专业 Markdown 编辑器 + AI 工具 |
| `TextEditor/` | 基于 textarea + Ant Design 的轻量编辑器，替代世界书中的 Milkdown |
| `AIService.tsx` | 渲染进程 AI 服务管理器类（配置管理、请求取消、流式） |
| `StoragePathDisplay.tsx` | 存储路径展示 |

---

## 6. 核心功能模块详解

### 6.1 角色卡模块 `components/Character/`

- `CharacterManager.tsx`：角色卡列表与编辑入口，集成 AI 翻译/生成/润色（均拼接全局 `system_prompt`）
- `CharacterEditModal.tsx`：Tabs 分页 + 双栏布局的角色编辑弹窗
- `CharacterDialogueChat/`：角色对话核心子系统
  - `CharacterDialogueChat.tsx`：对话主界面
  - `CharacterDialogueChat.hooks.ts`：对话业务逻辑（消息收发、`system_prompt` 拼接、token 计数）
  - `PromptBuilder.ts`：角色对话提示词构建（角色定义、背景、世界书上下文、记忆、对话示例、记忆指令）；含 `EMOTION_PRESETS` 预置情绪清单 + `buildExpressionPrompt` / `parseExpressionFromContent` 表情相关函数（Spec: add-character-expression-system / Task 3）
  - `ExpressionManagerModal.tsx`：表情管理弹窗（30 预置 + 自定义情绪网格、上传/删除/预览，Spec: add-character-expression-system / Task 7）
  - `ImageCropperModal.tsx`：基于 `react-easy-crop` 的方形图片裁剪弹窗（PNG 输出、长边 > 512px 压缩，Spec: add-character-expression-system / Task 5）
  - `TokenManagement/`：上下文截断（`ContextTruncator`）、token 计数（`TokenCounter`）
  - `MessageRenderer/`：消息渲染（支持 Markdown、代码高亮、引号高亮）
  - `utils/messageProcessor.ts`：消息处理管道（含 `stripThinkingTags` 思考标签过滤）
  - `utils/chatHistoryRagUtils.ts`：对话历史 RAG 工具
  - `ConfigPanel.tsx` / `ParameterPanel.tsx` / `PersonaPanel.tsx`：配置面板（ConfigPanel 含「记忆与上下文增强」分组标题，聚合知识库检索与记忆表格两个子面板；ParameterPanel 含「开启表情」开关代替原 Emoji 增强模式）
  - `VectorizationPanel.tsx`（标题「知识库检索」，Tooltip 指引向量化模型在系统设置配置）/ `KnowledgeBaseBindingPanel.tsx`（知识库绑定、列表项健康度 Tag「可检索/未向量化」、错误重试、检索反馈区读取 `sessionStorage[chat-rag-feedback-{characterCardId}]`）/ `MemoryTablePanel.tsx`：记忆与上下文增强相关面板

### 6.2 世界书模块 `components/WorldBook/`

- `WorldBookManager.tsx`：世界书列表管理
- `WorldBookEntryEditor.tsx`：条目编辑
- `WorldBookAIGenerateFlow.tsx` / `WorldBookGenerateModal.tsx`：AI 智能生成流
- `WorldBookPolishModal.tsx`：AI 润色
- `WorldBookSortModal.tsx`：排序（使用 TextEditor）
- `hooks/useWorldBookAIOperations.ts`：AI 操作 Hook
- `WorldBookVectorPanel.tsx`：向量化面板

### 6.3 写作模式 `components/Creative/WritingMode/`

写作模式是项目最复杂的子系统，采用 Hook 拆分管理状态：

| Hook | 职责 |
|------|------|
| `useChapterGeneration.ts` / `useChapterGeneration.shared.ts` | 章节生成（含流式、续传） |
| `useChapterStructure.ts` | 章节结构（拆分/合并） |
| `useChunkedGeneration.ts` | 分块生成 |
| `useShardGeneration.ts` | 分片生成 |
| `useGenerationResume.ts` | 生成续传 |
| `usePlotCheck.ts` | 剧情检查 |
| `useVersionManagement.ts` | 版本管理 |
| `useModalStates.ts` | 弹窗状态 |
| `useTableOrganize.ts` | 表格整理 |
| `useWritingMaterials.ts` | 素材库（世界书/角色卡/人设/知识库四类，300ms 防抖搜索） |

核心组件：`ContentWorkspace.tsx`（内容工作区）、`OutlineEditor.tsx`（大纲编辑）、`StreamingTextEditor.tsx`（流式编辑器）、`WritingConfigPanel.tsx`（配置）、`WritingTemplateManager.tsx`（自定义模板管理）、`TableVersionControl.tsx`（表格版本控制）。

> **架构要点**：章节数据已统一迁移至 `project.outline.chapters`（详见 [§14](#14-已知重点问题与修复记录)），消除双重存储。

### 6.4 游戏模式 `components/Game/`

- `GameModeEntry.tsx`：游戏模式入口（基于 `gameUIStore.currentView` 切换）
- `GameLobby.tsx`：游戏大厅
- `GameDetailPage.tsx`：游戏详情
- `GameMainPage.tsx`：游戏运行时主页面
- `templates/`：游戏类型模板
  - `GameTemplateRegistry.ts`：模板注册中心
  - `management/`：经营类（完整实现，含 `ManagementGameMain.tsx`、`managementSchema.ts`、`managementInitialState.ts`）
  - `WerewolfTemplate.ts` / `MysteryTemplate.ts` / `DatingSimTemplate.ts` / `TextRpgTemplate.ts`：其他四类模板
- `panels/`：运行时面板（`NarrativePanel`、`ResourcePanel`、`FacilityPanel`、`StatisticsPanel`、`GameStateBar`，均基于 `CollapsiblePanel`）

游戏类型枚举（`GameType`）：`werewolf` / `mystery` / `dating_sim` / `management` / `text_rpg`。

### 6.5 记忆插件 `components/MemoryChat/`

- `MemoryChatManager.tsx`：记忆管理主界面
- `ChatManager.tsx`：聊天记录管理（树形、分页、搜索、筛选）
- `TemplateManager.tsx`：Excel 模板管理
- `stMemoryTemplate.ts`：记忆模板预设

### 6.6 知识库 `components/KnowledgeBase/`

- `KnowledgeBaseManager.tsx`：知识库管理
- `KnowledgeItemList.tsx`：条目列表
- `UploadDocumentModal.tsx`：文档上传
- `VectorSearchPanel.tsx`：向量搜索面板

### 6.7 创意管理 `components/Creative/`

- `CreativeManager.tsx`：创意列表与编辑入口
- `CreativeEditPage.tsx`：创意编辑（Tabs：Markdown / V3 字段 / 图片导出）
- `CharacterCardEditPage.tsx` / `WorldBookEditPage.tsx`：从创意生成角色卡/世界书
- `FormatExport/`：格式导出（角色卡 PNG、世界书 JSON）

### 6.8 创作中心 `components/Chat/`

- `CreationCenter.tsx`：统一聊天入口
- `UnifiedChatDialog.tsx` / `SingleChatDialog.tsx`：统一/单聊对话框

### 6.9 提示词管理 `components/PromptManagement/`

- `PromptManagement.tsx`：主界面
- `PromptEditor.tsx`：模板编辑
- `PromptAssemblyView.tsx`：组装预览
- `PromptFlowChart.tsx`：流程图
- `PromptHistory.tsx`：版本历史
- `PromptPreview.tsx`：预览
- `PromptSaveDialog.tsx`：保存对话框

---

## 7. AI 服务体系

### 7.1 双层 AI 架构

项目存在两套并行的 AI 调用路径，服务于不同场景：

**路径 A — 主进程转发（`aiHandlers.ts`）**：用于角色对话、写作生成等需要底层控制的场景。渲染进程组装 `url/headers/body`，主进程纯转发，支持流式背压控制。

**路径 B — 渲染进程直调（`AIService.tsx` + `ChatEngine`）**：用于创意管理、角色卡 AI 工具等场景，基于 AI SDK V6 的 `streamText`。

### 7.2 主进程 `AIService`（`services/AIService.ts`）

统一 AI 调用抽象层，封装：
- `AIConfigProvider`：从 `storageService` 获取激活引擎配置
- `SSEStreamParser`（`services/ai/SSEStreamParser.ts`）：SSE 流解析工具
- 请求构建、流式响应解析、错误处理与重试
- `enrichSystemPrompt(messages, engineSystemPrompt)`：拼接引擎级 system prompt。**【多模态兼容性修复，2026-07-28】** 增加类型守卫 `typeof msg.content === 'string'`——字符串 content 走拼接逻辑（向后兼容），数组 content（多模态 `Array<{type:'text'|'image_url', ...}>`）原样保留，避免 `'+'` 拼接产生 `"[object Object]"` 导致 prompt 静默损坏。该守卫为防御性编程，目前所有调用方 system message 均为字符串。`ChatMessage.content` 已扩展为 `string | Array<...>` 联合类型（Spec: ai-capability-detection-and-image-recognition / Task 6），仅 `characterTraitAIService` 使用多模态数组 content。

核心接口：
```typescript
interface AIConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyTransmission: 'header' | 'body';
  model: string;
  systemPrompt?: string;
}
interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}
```

### 7.3 IPC 处理器 `aiHandlers.ts`

- `ai:request`：接收 `{url, method, headers, body, timeout, streaming}`，发起 HTTP 请求
- `ai:cancel`：通过 `senderId` 取消活跃请求（`AbortController`）
- `ai:listModels`：列出可用模型
- **流式背压控制**：使用 `BoundedQueue`（`ipc/handlers/utils/boundedQueue.ts`），高水位 80 暂停生产者，低水位 40 恢复，硬上限 100
- **超时**：流式连接超时 60s，非流式 30s

### 7.4 渲染进程 `AIService` 类（`components/Common/AIService.tsx`）

- 配置安全校验（`ensureSafeConfig` / `clampNumber` / `sanitizeNumber`，仅校验范围，不注入硬编码默认值）
- 请求管理（`abortControllers` Map，支持单请求/全部取消）
- 基于 `@ai-sdk/openai` + `ai` 的 `streamText`
- 配套工具：`AIErrorHandler`、`AIUtils`、`AIConfigValidator`（`AIService.utils.ts`）

### 7.5 `ChatEngine`（`components/Common/ChatEngine/`）

采用 **策略模式 + 工厂模式**：
- `IChatEngine`：聊天引擎接口（`onStream` / `onComplete` / `onError` / `sendMessage`）
- `ChatEngine`：默认实现，内联 URL/Body 构造，支持 `chat_completion` / `text_completion` 两种 `api_mode`
- `ChatEngineFactory`：单例工厂，按 `engineType` 创建并缓存引擎实例
- `ChatEngine.types.ts`：`resolveStopForRequestBody`（stop 序列解析）、`buildSamplingExtras`（采样参数构建）
- **【能力感知，2026-07-28】** 请求体构建新增 `supportsThinking` / `supportsToolCalling` 能力守卫：思维链参数（`enable_chain_of_thought`）仅在 `config.capabilities?.supportsThinking === true` 时注入；工具调用（`use_function_calling`）仅在 `config.capabilities?.supportsToolCalling === true` 时生效。不支持时降级为纯文本聊天，避免向不支持的模型注入参数导致 4xx 错误。`EngineCapabilities` 接口已扩展三字段，`getDefaultEngineCapabilities` 返回默认值 `false`

### 7.6 System Prompt 拼接规范

所有涉及 AI 请求的模块须遵循统一拼接模式：

```typescript
let finalSystemPrompt = taskSpecificPrompt;
if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
  finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + taskSpecificPrompt;
}
```

已实现拼接的模块：角色卡翻译/生成/润色（`CharacterManager.tsx`）、Markdown AI 工具（`MarkdownAITools.tsx`）、世界书 AI 生成（`WorldBookEditor.tsx`）、角色对话（`CharacterDialogueChat.hooks.ts`）。

### 7.7 提示词构建器

| 构建器 | 位置 | 职责 |
|--------|------|------|
| 角色对话 `PromptBuilder` | `CharacterDialogueChat/PromptBuilder.ts` | 角色定义、背景、世界书/记忆上下文、对话示例、记忆指令 |
| 写作 `PromptBuilder` | `services/writing/PromptBuilder.ts` | 小说类型/写作风格/大纲/章节提示词 |
| 写作表格整理 | `WritingStorageService.buildWritingTableOrganizePrompt` | 10 段标准化提示词（角色/消息/历史/模板/规则/ID/策略/更新/输出/示例） |
| 记忆整理 | `services/memory/aiPromptBuilder.ts` | 聊天记录整理提示词 |
| 游戏 `GamePromptBuilder` | `services/game/GamePromptBuilder.ts` | 游戏叙事提示词 |

---

## 8. 向量与检索体系

### 8.1 三层抽象架构

```
VectorStoreService (Facade)        ← 缓存 + 策略选择 + IPC 适配
       │
       ▼
VectorRepository                   ← 多源路由 + 反向索引
       │
       ▼
IVectorBackend (SqliteVecBackend)  ← 单源存储后端契约（sqlite-vec + better-sqlite3）
```

- **`IVectorBackend`**（`vector/IVectorBackend.ts`）：单源存储后端契约接口
- **`VectorRepository`**（`vector/VectorRepository.ts`）：多源路由 + 反向索引（`delete` 通过反向索引路由，O(1) 替代全源扫描）
- **`VectorStoreService`**（`VectorStoreService.ts`）：Facade，使用 LRU Map（max=100 源）缓存，组合 Strategy

**`SqliteVecBackend` 关键特性**（2026-07-31 替换原 `VecstoreVectorStore`，决策：完全替换不保留兼容）：
- vec0 虚拟表 + cosine 距离，`score = 1 - distance`（与原 vecstore 行为一致）
- metadata 存 DB 表内（`item_metadata`），无需 sidecar Map；SQLite 事务即时落盘，`persist()` 为 no-op + WAL checkpoint
- search filter 下推到 SQL WHERE（白名单列名防注入）；**⚠️ post-filter 语义**：vec0 先按距离返回 top-K 再过滤元数据，过滤后可能 < K 条（详见 `SqliteVecBackend.ts:search()` 注释）
- TEXT 主键方案 + rowid 降级方案（`VEC0_TEXT_PK_SUPPORTED` 检测，旧版 sqlite-vec 自动降级 + `id_map` JOIN）
- 维度变更切 DB 文件（`handleDimensionChange`），不删旧维度数据
- **测试盲区**：37 个单测基于 `FakeVectorDb` 内存模拟（因 better-sqlite3 原生模块 ABI 与 vitest 不匹配），真实 vec0 行为依赖 Electron 集成测试

### 8.2 策略模式

**批处理策略**（`vector/strategies/`）：
- `NormalBatchStrategy`：标准批处理
- `DeferredBatchStrategy`：延迟批处理
- `NoPersistBatchStrategy`：不持久化批处理
- `BatchProcessingStrategy`：策略接口

**搜索策略**：
- `ScopeIdsSearchStrategy`：按 scopeIds 过滤搜索
- `SourceTypeSearchStrategy`：按来源类型搜索
- `AggregateSearchStrategy`：聚合搜索
- `SearchStrategy`：策略接口

### 8.3 Embedding 双模式

| 模式 | 服务 | 说明 |
|------|------|------|
| `remote` | `EmbeddingService` | 远程 API Embedding（默认 `text-embedding-3-small`） |
| `local` | `EmbeddingWorkerService` | 本地 Embedding（`@xenova/transformers`，支持 ModelScope 默认模型） |

配置由 `VectorConfigManager` 管理，支持维度自动切换（`modelscope-default-and-dimension-autoswitch`）。

### 8.4 上下文检索（RAG）

`ContextManager`（`services/ContextManager.ts`）提供：
- `context:retrieve`：向量检索上下文
- `context:retrieveWithKeywords`：向量 + 世界书关键词联合检索
- `context:compress`：上下文压缩

### 8.5 对话历史 RAG

`chatHistory` 命名空间（Spec: `optimize-chat-ai-intelligence` / Task 7.4）：
- `chatHistory:retrieve`：检索本会话历史相似片段（默认 topK=3, minScore=0.6）
- `chatHistory:vectorizeIncremental`：增量向量化最近消息（fire-and-forget）

---

## 9. 状态管理

采用 **Zustand 5**，每个模块独立 store，集中于 `src/renderer/stores/`。

| Store | 职责 |
|-------|------|
| `uiStore` | UI 状态（`activeTab`、`theme`、`compactMode`、`animationEnabled`、`debugMode`） |
| `settingStore` | 系统设置（加载/保存/测试连接/导入导出/历史） |
| `dataStore` | 通用数据 |
| `logStore` | 统一日志（`addLog`，贯穿全应用） |
| `characterChatStore` | 角色对话状态 |
| `creativeStore` | 创意数据 |
| `worldBookStore` | 世界书 |
| `knowledgeBaseStore` | 知识库 |
| `vectorStore` | 向量配置 |
| `promptStore` | 提示词模板 |
| `favoritesStore` | 收藏 |
| `gameStore` | 游戏运行时状态 |
| `gameUIStore` | 游戏 UI 状态（`currentView`） |
| `writingModeStore` / `writingModeUIStore` / `writingProjectStore` | 写作模式状态/UI/项目 |
| `expressionStore` | 角色卡表情状态（Spec: add-character-expression-system / Task 6）。持有 `manifest` / `imageCache`（**仅存 data URL，CSP 兼容**）/ `loading` / `error`；封装 `window.electronAPI.expression.*` IPC 调用；提供 `loadExpressions` / `saveExpression` / `deleteExpression` / `addCustomEmotion` / `removeCustomEmotion` / `resolveExpressionImage` / `getAvailableEmotionKeys` / `clear` actions。加载时通过 `new Image()` 预热浏览器图像缓存避免情绪切换闪烁。不持久化到 localStorage（manifest 由主进程 `expressionService` 写盘）。【重点标记 - CSP 裂图 BUG 修复】imageCache 不存磁盘绝对路径，避免被 CSP `img-src 'self' data: blob:` 拦截。详见 `docs/FIX_RECORDS.md` §14.12。 |
| `characterTraitStore` | 角色特征 Zustand store（add-asset-and-trait-management / Task 3 + Task 13 扩展 `setTraits`）。详见 `docs/FIX_RECORDS.md` §14.23 |
| `assetStore` | 素材 Zustand store（Task 8，按 `assetType` 分桶管理表情/立绘/特征图）。详见 `docs/FIX_RECORDS.md` §14.24 |
| `characterLoraStore` | 按角色卡独立的 LoRA 配置 store（2026-07-29 bug 修复配套）。详见 `docs/FIX_RECORDS.md` §14.36 |

**日志规范**：所有 store 通过 `useLogStore.getState().addLog(message, type, options)` 记录，`options` 支持 `details`、`error`、`context`、`category`。

---

## 10. 共享类型系统

`src/shared/types/` 是主进程与渲染进程的 **类型单一真源**，通过 `index.ts` barrel 统一导出。

| 文件 | 内容 |
|------|------|
| `writing.types.ts` | 写作模式全套类型（`NovelType`、`WritingStyle`、`WritingProject`、`ChapterOutline`、`CustomNovelTypeTemplate`、`CustomWritingStyleTemplate`、`AutoFixResult` 等） |
| `writing-table.types.ts` | 写作表格数据（`WritingTableData`，单一真源） |
| `writing-agent.types.ts` | 写作智能体编排类型（`WritingAgentState` / 三态视图 / 断点续跑，implement-agent-foundation-and-fix-defects / Task 15，详见 `docs/FIX_RECORDS.md` §14.47） |
| `game.types.ts` | 游戏模式类型（`GameType`、`GameMeta`、`GameSaveData`、`GameTableData`、`GameTypeTemplate`、`GameNarrativeRequest` 等） |
| `chat.types.ts` | 聊天消息类型 |
| `vector.types.ts` | 向量检索类型（`VectorItem`、`SearchResult`、`ContextItem`、`RetrieveOptions`） |
| `vector.ts` | 向量兼容 re-export |
| `vectorConfigSchema.ts` | 向量配置 Schema 常量 |
| `promptTemplate.types.ts` | 提示词模板类型 |
| `vectorConfig.ts`（主进程 `types/`） | `VectorConfig`、`VectorStoreMode`（`'sqlite-vec'` 单值，主进程专用） |

**冲突消解**：`ContextItem` / `RetrieveOptions` 在 `vector.types`（向量检索）与 `writing.types`（写作上下文）中同名，barrel 优先暴露向量语义版本，写作版本需直接 `import` 自 `writing.types`。

`src/shared/settings.ts` 定义全局默认设置 `AppSetting.defaultSetting`，包含完整的 AI 引擎默认配置（采样器、停用词、路径、向量配置等）。

`src/shared/constants/` 沉淀跨进程常量：`game.constants.ts`（游戏类型枚举与默认值）、`writing.constants.ts`（写作模式常量）。

---

## 11. 依赖关系

### 11.1 核心依赖图

```
                          ┌─────────────┐
                          │ electron    │
                          └──────┬──────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌──────────────┐
        │ ipcMain  │      │ services │      │  preload.ts  │
        │ handlers │◄────►│ (Node)   │      │ contextBridge│
        └────┬─────┘      └────┬─────┘      └──────┬───────┘
             │                 │                    │
             │    IPC channels │                    │ electronAPI
             │                 │                    ▼
             └─────────────────┴────────────►┌─────────────┐
                                             │  Renderer   │
                                             │  (React)    │
                                             └──────┬──────┘
                                                    │
                              ┌─────────────────────┼─────────────────────┐
                              ▼                     ▼                     ▼
                        ┌──────────┐         ┌──────────┐          ┌──────────┐
                        │ stores   │         │components│          │  shared  │
                        │(Zustand) │         │ (React)  │          │  types   │
                        └──────────┘         └──────────┘          └──────────┘
```

### 11.2 关键第三方依赖

| 依赖 | 用途 |
|------|------|
| `electron` 33 | 桌面框架 |
| `react` / `react-dom` 18 | UI 框架 |
| `antd` 6 | UI 组件库 |
| `zustand` 5 | 状态管理 |
| `ai` 6 / `@ai-sdk/openai` / `@ai-sdk/react` | AI SDK |
| `@milkdown/*` 7.x | Markdown 编辑器（Crepe） |
| `sqlite-vec` | 向量数据库（SQLite 向量扩展，cosine 距离，vec0 虚拟表） |
| `better-sqlite3` | SQLite 原生绑定（向量库 + agent 记忆库共用） |
| `@xenova/transformers` | 本地 Embedding 模型 |
| `@lenml/char-card-reader` / `png-chunks-extract` / `png-chunk-text` | 角色卡 PNG 读写 |
| `gpt-tokenizer` | Token 计数（cl100k_base） |
| `pdf-parse` / `mammoth` / `xlsx` | 文档解析 |
| `electron-store` | 持久化 KV 存储 |
| `lru-cache` | LRU 缓存（向量源、token 等） |
| `fuse.js` | 模糊搜索 |
| `simple-git` | Git 操作（更新功能） |
| `zod` 4 | Schema 校验 |
| `vite` 5 / `vite-plugin-electron` | 构建 |
| `vitest` 4 | 测试 |

### 11.3 构建外部化

`vite.config.ts` 将以下模块从主进程 bundle 中外部化，避免打包问题：
`electron`、`@xenova/transformers`、`onnxruntime-node`、`onnxruntime-common`、所有 Node.js 内建模块。

### 11.4 路径别名

```typescript
'@'         → ./src
'@main'     → ./src/main
'@renderer' → ./src/renderer
'@shared'   → ./src/shared
```

---

## 12. 项目运行方式

### 12.1 环境要求

- **Node.js** ≥ 18.17.0
- **npm** ≥ 11.6.2

### 12.2 常用命令

```bash
# 安装依赖
npm install

# 启动开发环境（Vite dev server，端口 5174 + Electron）
npm run dev

# 类型检查
npm run typecheck

# Lint
npm run lint

# 运行测试
npm run test
npm run test:watch

# 构建生产版本（Vite build）
npm run build

# 打包 Electron 安装包（vite build + electron-builder）
npm run electron:build

# 生产模式运行（需先 build）
npm run electron:prod
```

### 12.3 一键启动脚本

- **Windows**：双击 `start.bat`
  - 自动检查 Node/npm 环境
  - 配置 npmmirror 国内镜像源
  - 安装依赖、校验 Vite/Electron/transformers
  - 初始化 `%APPDATA%\Creative Cafe\data` 与 `cache` 目录
  - 执行 `npm run dev`
- **macOS**：`./start.sh`
  - 检查环境与向量依赖
  - 启动 dev server（端口 5174），失败则尝试 `npm install --legacy-peer-deps --ignore-scripts` 后重试

### 12.4 开发模式工作原理

`npm run dev` 通过 `vite-plugin-electron` 同时启动：
1. Vite Dev Server（端口 5174，`strictPort: true`）
2. Electron 主进程（加载 `http://localhost:5174`）
3. 文件变更时 HMR 热更新

### 12.5 打包

`electron-builder.json` 配置：
- **appId**：`com.creativecafe.app`
- **productName**：`Creative Café`
- **Windows 目标**：NSIS 安装包（可改安装目录、创建快捷方式）+ Portable 便携版
- **输出目录**：`release/`

### 12.6 数据存储

用户数据存放于 `%APPDATA%/Creative Cafe/`（Windows）或对应平台 userData 目录：
- `data/characters`、`data/worldbooks`、`data/avatars`、`data/creatives`、`data/memories`、`data/plugins`
- `data/writing-projects/{projectId}/`（含 `chapters/`、`chunks/`）
- `data/writing-templates/novel-types/`、`data/writing-templates/writing-styles/`
- `cache/`（向量、模型缓存）

路径前缀 `__USER_DATA__` 在 `shared/settings.ts` 中使用，运行时由 `utils/appPath.ts` 解析为真实路径。

---

## 13. 关键设计规范与约定

### 13.1 【最高优先级】禁止 AI 参数默认值

调用 AI 引擎时，所有参数（Temperature、MaxTokens、Model 等）必须从系统设置动态获取，**绝对禁止**设置默认值。参数缺失时应抛出明确异常，而非静默使用默认值。

```typescript
// ✅ 正确
const temperature = Number(activeEngine.temperature);
if (!temperature && temperature !== 0) {
  throw new Error('AI 引擎未配置 temperature 参数，请在设置中配置');
}

// ❌ 错误
const temperature = activeEngine.temperature || 0.7;  // 禁止
```

### 13.2 【最高优先级】IPC API 路径规范

获取系统设置必须用 `window.electronAPI.setting.load()`（**单数** `setting`），返回 `{ success, setting }`。严禁使用 `window.electronAPI.settings.getSettings()` 等不存在路径。新增 IPC API 前必须先更新 `src/renderer/types/electron.d.ts`。

### 13.3 System Prompt 拼接

所有 AI 请求模块须拼接全局 `system_prompt`（见 [§7.6](#76-system-prompt-拼接规范)）。

### 13.4 tableEdit 命令协议

表格编辑统一使用 `tableEdit` 命令格式：
- `insertRow(sheetIndex, {"fieldIndex":"value", ...})`
- `updateRow(sheetIndex, rowIndex, {"fieldIndex":"value", ...})`
- `deleteRow(sheetIndex, rowIndex)`

命令由 `tableEditParser`（记忆）/ `GameTableEditParser`（游戏）/ `TableEditCommandExecutor`（写作）解析执行。

> **F3/F4 重构说明（2026-07-30）**：两个解析器的公共逻辑已抽取到
> `src/main/services/memory/tableEditParserBase.ts` 的 `TableEditParserBase` 抽象基类，
> `tableEditParser` 与 `GameTableEditParser` 改为薄适配层（继承 Base，保留各自对外 API 签名）。
>
> Base 统一提供：块提取（`extractBlocks`，按正则数组依次提取并去重）、JSON 数据对象容错解析
> （`parseDataObject` / `normalizeJsonObject` / `toStringValueMap`）、命令行分派
> （`tryParseLine`，顺序 updateRow → insertRow → deleteRow）、字段索引转换
> （`convertFieldIndicesToZeroBased`）、索引校验原语（`validatePositiveIndex` /
> `validateNonNegativeIndex`）。
>
> **F3 越界校验**（统一在 Base 中实现，校验失败一律"跳过 + 警告"，不崩溃不中断）：
> - `parseInsertRow` / `parseUpdateRow` / `parseDeleteRow`：sheetIndex/rowIndex 必须为正整数
>   （1-based 协议最小为 1），否则跳过整条命令并警告
> - 字段索引 1→0 转换后 < 0 时（如原键为 `"0"`）跳过该字段并警告（不丢弃整条命令）
> - 字段索引为非整数（命名键，如 `"name"`）保持原样不转换（容错）
> - 列范围校验（`< 列数`）需 `maxColumnIndex` 参数；parser 阶段通常不传，列范围校验留给 executor
>
> 两个适配层差异（保持各自对外行为不变）：
>
> | 维度 | memory 适配层 | game 适配层 |
> |------|---------------|-------------|
> | 对外方法 | `parse(text)` | `parse(text)` + `stripTableEditTags(text)` |
> | 返回结构 | `{success, commands, errors}` | `{commands, errors}` |
> | 命令字段 | `tableIndex` / `rowIndex` / `data` / `rawCommand` | `sheetIndex` / `rowIndex` / `rowData` / `raw` |
> | 索引语义 | parser 阶段 1→0 转换 | 保持 1-based（由 `GameTableRepository.applyTableEdits` 转换） |
> | 字段索引 | 1→0 转换 + 非负校验 | 保持原样不转换 |
> | 命令正则 | 非 anchored | anchored + `i` 标志 |
> | 未识别行 | debug 日志"跳过非命令行" | push error"无法解析的命令行" |

### 13.5 安全规范

- `contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`
- CSP 严格限制 `script-src`、`connect-src`（仅允许 self、localhost、GitHub API）
- 渲染进程不直接接触 Node.js，所有能力经 `electronAPI` 桥接
- API Key 脱敏记录（`Bearer [REDACTED]`）

### 13.6 代码风格

- TypeScript 严格模式 + ESLint + Prettier
- 组件 PascalCase，变量/函数 camelCase
- Zustand store 集中管理模块状态
- 所有异步操作须 try-catch + 用户反馈
- 统一日志（`useLogStore`）

---

## 14. 已知重点问题与修复记录（已拆分）

> **文档结构变更（2026-07-31）**：原 §14 累计 51 个子节、约 2447 行修复记录，已占整份 Wiki 逾 70% 篇幅，使架构性内容与历史修复日志混杂、可读性下降。已将该部分整体拆分至独立文件 [docs/FIX_RECORDS.md](./docs/FIX_RECORDS.md)。
>
> **拆分原则**：
> - **架构性描述**（模块职责、IPC 通道、类型契约等）随对应章节并入本文 §3-§13，并随代码演进维护；
> - **历史修复日志**（Bug 根因、Spec 实现记录、反复调试过程）统一沉淀至 docs/FIX_RECORDS.md；
> - CHANGELOG.md 继续承载版本级发布日志，三者各司其职。

### 历史修复记录索引

| Spec / 阶段 | 对应 docs/FIX_RECORDS.md 小节 | 主题 |
|---|---|---|
| add-character-expression-system | 14.10 – 14.13, 14.18 | 表情管理系统后端、弹窗、提示词与情绪解析 |
| add-ai-expression-generation | 14.14 – 14.17, 14.20, 14.26 | SD 表情生成服务、IPC、设置面板、生成弹窗 |
| add-asset-and-trait-management | 14.18 – 14.25 | 素材与特征管理（服务 / Store / 弹窗 / AI 生成） |
| add-model-capability-detection-and-image-recognition | 14.27 | AI 引擎能力标识 UI |
| add-lora-model-selection | 14.28 – 14.29, 14.36 | LoRA 模型选择与按角色独立存储 |
| 立绘与图片生成增强 | 14.30 – 14.34, 14.37 | 立绘重构、img2img 模式、质量参数、自定义尺寸 |
| ADetailer 面部修复 | 14.35 | img2img 不支持 Hires.fix 的源码核验 |
| tableEdit 解析器统一 | 14.38 | 越界校验与解析器统一 |
| implement-agent-foundation-and-fix-defects / 阶段 1 | 14.39 – 14.40 | 智能体底座 infra/ + contracts.ts |
| implement-agent-foundation-and-fix-defects / 阶段 0 | 14.41 | ChatEngine 消息校验 + 取消错误反馈 |
| implement-agent-foundation-and-fix-defects / 阶段 2 | 14.42 – 14.45 | Embedding 缓存、WorldBook 倒排索引、storageService 异步化、写作容错 |
| implement-agent-foundation-and-fix-defects / 阶段 3-6 | 14.46 – 14.48 | skills/ 技能系统、writing/ 编排、对话与世界书自驱 |
| implement-agent-foundation-and-fix-defects / Task 18 | 14.49 | learning/ 长期记忆与自学习系统 |
| implement-agent-foundation-and-fix-defects / 阶段 7 | 14.50 | P2 UI/设计修复（虚拟化、dataStore 分层、RightPanel 拆分） |
| implement-agent-foundation-and-fix-defects / 阶段 8 | 14.51 | 现有测试套件全量审核与缺陷修复 |
| 早期重点问题（角色卡 / 写作 / 世界书 / 思考标签等） | 14.1 – 14.9 | 见 docs/FIX_RECORDS.md 顶部 |

> 完整修复细节、根因分析、涉及文件清单请查阅 [docs/FIX_RECORDS.md](./docs/FIX_RECORDS.md)。

---


## 附录：关键文件索引

> **引用约定**：下表中 `（§14.X）` 形式的引用均指向 [`docs/FIX_RECORDS.md`](./docs/FIX_RECORDS.md) 对应小节（即原 CODE_WIKI.md §14 拆分内容）；`Spec: xxx / Task N` 标注原始需求来源。

| 类别 | 文件 |
|------|------|
| 主进程入口 | [index.ts](src/main/index.ts) |
| Preload 桥接 | [preload.ts](src/main/preload.ts) |
| IPC 注册中心 | [ipc/index.ts](src/main/ipc/index.ts) |
| AI 处理器 | [aiHandlers.ts](src/main/ipc/handlers/aiHandlers.ts) |
| AI 服务抽象层 | [AIService.ts](src/main/services/AIService.ts) |
| 向量存储 Facade | [VectorStoreService.ts](src/main/services/VectorStoreService.ts) |
| 写作项目仓库 | [WritingProjectRepository.ts](src/main/services/writing/WritingProjectRepository.ts) |
| 写作智能体编排服务 | [writingAgentService.ts](src/main/services/agent/writing/writingAgentService.ts)（§14.47） |
| 写作智能体 IPC 处理器 | [writingAgentHandlers.ts](src/main/ipc/handlers/writing/writingAgentHandlers.ts)（§14.47） |
| 写作智能体共享类型 | [writing-agent.types.ts](src/shared/types/writing-agent.types.ts)（§14.47） |
| 写作智能体前端 hook | [useWritingAgent.ts](src/renderer/components/Creative/WritingMode/hooks/useWritingAgent.ts)（§14.47） |
| 写作智能体编排弹窗 | [WritingAgentModal.tsx](src/renderer/components/Creative/WritingMode/WritingAgentModal.tsx)（§14.47） |
| 记忆聊天日志 | [chatLogService.ts](src/main/services/memory/chatLogService.ts) |
| 角色表情服务 | [expressionService.ts](src/main/services/expressionService.ts) |
| SD 表情生成服务 | [sdGenerationService.ts](src/main/services/sdGenerationService.ts)（Spec: add-ai-expression-generation / Task 1） |
| SD 表情生成 IPC 处理器 | [sdGenerationHandlers.ts](src/main/ipc/handlers/sdGenerationHandlers.ts)（Spec: add-ai-expression-generation / Task 2） |
| SD WebUI 设置面板 | [SDWebuiSettings.tsx](src/renderer/components/Settings/SDWebuiSettings.tsx)（Spec: add-ai-expression-generation / Task 6） |
| 表情 IPC 处理器 | [expressionHandlers.ts](src/main/ipc/handlers/expressionHandlers.ts) |
| 表情状态 Store | [expressionStore.ts](src/renderer/stores/expressionStore.ts) |
| 表情管理弹窗 | [ExpressionManagerModal.tsx](src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx) |
| AI 表情生成弹窗 | [ExpressionGenerateModal.tsx](src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx)（Spec: add-ai-expression-generation / Task 4） |
| 素材与特征管理弹窗 | [AssetManagerModal.tsx](src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx)（Spec: add-asset-and-trait-management / Task 9，5 Tab：表情/立绘/一般图像/三视图/特征） |
| AI 素材生成弹窗 | [AssetGenerateModal.tsx](src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx)（Spec: add-asset-and-trait-management / Task 10，5 mode：batch-expression / single-expression / illustration / general / three-view） |
| 角色特征持久化服务 | [characterTraitService.ts](src/main/services/characterTraitService.ts)（Spec: add-asset-and-trait-management / Task 1） |
| AI 特征生成服务 | [characterTraitAIService.ts](src/main/services/characterTraitAIService.ts)（Spec: add-asset-and-trait-management / Task 12） |
| 素材管理服务 | [assetService.ts](src/main/services/assetService.ts)（Spec: add-asset-and-trait-management / Task 6） |
| 角色特征 IPC 处理器 | [characterTraitHandlers.ts](src/main/ipc/handlers/characterTraitHandlers.ts)（Spec: add-asset-and-trait-management / Task 2） |
| AI 特征 IPC 处理器 | [characterTraitAIHandlers.ts](src/main/ipc/handlers/characterTraitAIHandlers.ts)（Spec: add-asset-and-trait-management / Task 12） |
| 素材 IPC 处理器 | [assetHandlers.ts](src/main/ipc/handlers/assetHandlers.ts)（Spec: add-asset-and-trait-management / Task 7） |
| 角色特征 store | [characterTraitStore.ts](src/renderer/stores/characterTraitStore.ts)（Spec: add-asset-and-trait-management / Task 3 + Task 13） |
| 素材 store | [assetStore.ts](src/renderer/stores/assetStore.ts)（Spec: add-asset-and-trait-management / Task 8） |
| LoRA 模型列表服务 | [loraService.ts](src/main/services/loraService.ts)（Spec: add-lora-model-selection / Task 1） |
| LoRA 模型 IPC 处理器 | [loraHandlers.ts](src/main/ipc/handlers/loraHandlers.ts)（Spec: add-lora-model-selection / Task 3） |
| LoRA 模型选择弹窗 | [LoraSelectModal.tsx](src/renderer/components/Character/CharacterDialogueChat/LoraSelectModal.tsx)（Spec: add-lora-model-selection / Task 4） |
| 图片尺寸选择组件 | [SizeSelector.tsx](src/renderer/components/Character/CharacterDialogueChat/SizeSelector.tsx)（2026-07-29 新增，§14.37） |
| 角色卡 LoRA 持久化服务 | [characterLoraService.ts](src/main/services/characterLoraService.ts)（2026-07-29 按角色独立存储 LoRA，§14.36） |
| 角色卡 LoRA IPC 处理器 | [characterLoraHandlers.ts](src/main/ipc/handlers/characterLoraHandlers.ts)（§14.36） |
| 角色卡 LoRA store | [characterLoraStore.ts](src/renderer/stores/characterLoraStore.ts)（§14.36） |
| 表情管理 Tab 入口 | [CharacterEditModal.tsx](src/renderer/components/Character/CharacterEditModal.tsx)（Task 15 新增「表情管理」Tab） |
| 表情裁剪弹窗 | [ImageCropperModal.tsx](src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx) |
| 表情提示词构建 | [PromptBuilder.ts](src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts)（`EMOTION_PRESETS` / `buildExpressionPrompt` / `parseExpressionFromContent`） |
| 渲染进程入口 | [main.tsx](src/renderer/main.tsx) |
| 根组件 | [App.tsx](src/renderer/App.tsx) |
| 路由配置 | [routeConfig.ts](src/renderer/routeConfig.ts) |
| ChatEngine | [ChatEngine.ts](src/renderer/components/Common/ChatEngine/ChatEngine.ts) |
| 角色对话逻辑 | [CharacterDialogueChat.hooks.ts](src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts) |
| 消息处理 | [messageProcessor.ts](src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts) |
| 共享类型入口 | [shared/types/index.ts](src/shared/types/index.ts) |
| 全局默认设置 | [shared/settings.ts](src/shared/settings.ts) |
| 构建配置 | [vite.config.ts](vite.config.ts) |
| 打包配置 | [electron-builder.json](electron-builder.json) |
| 启动脚本 | [start.bat](start.bat) / [start.sh](start.sh) |
| 技术文档 | [.trae/documents/技术文档.md](.trae/documents/技术文档.md) |

---

> **维护说明**：本 Wiki 随项目演进增量更新。新增模块或重大架构变更时，请同步更新对应章节；出现 Bug 或经反复调试修复的问题，记录至 [docs/FIX_RECORDS.md](./docs/FIX_RECORDS.md) 中以 ⭐ 标记重点。版本级发布日志见 CHANGELOG.md。
