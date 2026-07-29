# Creative Café 代码 Wiki

> **版本**：v1.0.7 ｜ **最后更新**：2026-07-30
> **定位**：本文档是对 `creative-cafe` 仓库的系统性代码解读，涵盖整体架构、模块职责、关键类与函数、依赖关系及运行方式。

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
14. [已知重点问题与修复记录](#14-已知重点问题与修复记录)

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
| 知识库 | PDF/DOCX/TXT 导入、VecStore WASM 向量存储、语义检索 |
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
| 向量数据库 | VecStore WASM + @xenova/transformers |
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
│   │   │   ├── ai/                    # AI 配置提供者 + SSE 流解析器 + 智能体引擎类型
│   │   │   │   └── agent/             # 智能体引擎核心（工具调用智能体地基）
│   │   │   │       ├── agentTypes.ts   # 核心类型（AgentTool / ToolCallResult / AgentLoopParams 等）
│   │   │   │       ├── toolRegistry.ts # 工具注册中心（register / getTools / 单例 toolRegistry）
│   │   │   │       ├── toolProtocolAdapter.ts # 工具协议适配层（buildToolsParam / parseToolCalls）
│   │   │   │       ├── tools/          # 验证用真实工具集（dialogueTools / worldbookTools / writingTools / agentFoundationTools + index 聚合）
│   │   │   │       ├── skill/          # 技能库系统（高于工具一层的可复用能力单元）
│   │   │   │       │   └── skillTypes.ts # 技能核心类型（SkillManifest / SkillImplementation / SkillResult 等）
│   │   │   │       └── memory/         # Agent 长期记忆与学习系统（episodic/semantic/procedural 三分类）
│   │   │   │           ├── memoryTypes.ts          # 记忆核心类型（AgentMemory / LearningEvent / MemorySearchResult 等）
│   │   │   │           ├── memoryService.ts        # 记忆服务单例（记录/检索/查询/删除 + 向量化）
│   │   │   │           ├── memoryConsolidator.ts   # 记忆整合器（从 episodic 提炼 semantic/procedural）
│   │   │   │           └── agentLearningService.ts # 自我学习编排（recordTurnExperience/optimizeDecision/applyFeedback）
│   │   │   ├── game/                  # 游戏叙事/仓库/表格编辑/模板
│   │   │   ├── memory/                # 记忆整理编排/聊天日志/表格操作
│   │   │   ├── vector/                # 向量后端/仓库/策略
│   │   │   ├── writing/               # 写作生成/检查/大纲/风格/模板/仓库
│   │   │   ├── AIService.ts           # 统一 AI 调用抽象层
│   │   │   ├── VectorStoreService.ts  # 向量存储 Facade
│   │   │   ├── EmbeddingService.ts    # 远程 Embedding
│   │   │   ├── EmbeddingWorkerService.ts  # 本地 Embedding（@xenova/transformers）
│   │   │   ├── KnowledgeBaseService.ts    # 知识库
│   │   │   ├── ContextManager.ts      # 上下文检索（RAG）
│   │   │   ├── worldBookService.ts    # 世界书服务
│   │   │   ├── characterService.ts    # 角色卡服务
│   │   │   ├── storageService.ts      # 通用 KV 存储（electron-store）
│   │   │   └── ...
│   │   ├── types/                     # 主进程专用类型（vectorConfig）
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
│   │   │   ├── Avatar/                # 用户人设
│   │   │   ├── Settings/              # 系统设置
│   │   │   ├── Plugin/                # 插件管理（DEV）
│   │   │   └── Test/                  # 测试页（DEV）
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
2. 业务处理器（register 模式）：`registerMemoryHandlers`、`registerCreativeHandlers`、`registerCharacterChatHandlers`、`registerWritingHandlers`、`registerGameHandlers`、`registerPromptHandlers`、`registerTokenHandlers`
3. 服务自注册：`embeddingService`、`vectorStoreService`、`knowledgeBaseService`、`knowledgeBaseDocumentService`、`contextManager`、`modelDownloadService`、`embeddingWorkerService` 各自调用 `initialize()` + `registerIpcHandlers()`

### 4.3 IPC 处理器命名空间

`preload.ts` 通过 `contextBridge` 暴露 `window.electronAPI`，主要命名空间：

| 命名空间 | 职责 |
|----------|------|
| `setting` | 系统设置加载/保存/路径（注意单数 `setting`） |
| `character` / `characterConfig` / `characterChat` / `chatVersion` | 角色卡 CRUD、配置、测试对话、版本管理 |
| `worldBook` / `worldbook` | 世界书文件操作 / 关键词匹配 |
| `avatar` | 用户人设 |
| `creative` | 创意数据 |
| `memory` | 记忆模板/会话/表格/聊天记录/外部调用 |
| `writing` | 写作项目/大纲/章节/分片/表格/风格/模板/剧情检查 |
| `game` | 游戏元数据/存档/表格/叙事生成（流式） |
| `ai` | AI 请求转发（流式/非流式）、取消、模型列表 |
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
| `sdGenerationService` | `sdGenerationService.ts` | Stable Diffusion WebUI API 客户端：状态检查 / 模型列表 / 角色卡基底图提取 / img2img 表情生成 / 任务取消（Spec: add-ai-expression-generation，详见 [§14.14](#1414-sd-表情生成服务-sdgenerationservice-spec-add-ai-expression-generation--task-1-2026-07-27-新增)） |
| `loraService` | `loraService.ts` | LoRA 模型列表获取服务：调用 `/sdapi/v1/loras` 拉取列表 + 构建预览图 URL + 读取 JSON 元数据 + 提取分类（Spec: add-lora-model-selection，详见 [§14.28](#1428-lora-模型列表服务-loraservice-spec-add-lora-model-selection--task-12026-07-28-新增)） |

#### 向量与检索服务（详见 [§8](#8-向量与检索体系)）

`VectorStoreService`、`EmbeddingService`、`EmbeddingWorkerService`、`VectorRegistryService`、`VectorConfigManager`、`VectorCache`、`ContextManager`、`KnowledgeBaseService`、`KnowledgeBaseDocumentService`、`ChatVectorizationService`、`TextSplitterService`、`DocumentProcessorService`、`WorldBookKeywordMatcher`、`VersionLinkerService`、`TableSnapshotService`。

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
| `tableEditParser` | tableEdit 命令解析 |
| `chatSessionRepository` | 聊天会话 |
| `associationRepository` | 会话-模板关联 |
| `characterChatRecordService` | 角色聊天记录 |
| `aiClient` / `aiPromptBuilder` | 记忆专用 AI 客户端与提示词 |

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
| `avatar` | 用户人设 | `AvatarManager` | |
| `character` | 角色卡 | `CharacterManager` | |
| `memory` | 记忆管理 | `MemoryChatManager` | |
| `knowledge` | 知识库 | `KnowledgeBaseManager` | |
| `settings` | 设置 | `Settings` | |
| `prompt-management` | 提示词管理 | `PromptManagement` | |
| `plugin` | 插件管理 | `PluginManager` | devOnly |
| `test` | 测试 | `TestPage` | devOnly，含子菜单 |

### 5.3 布局组件 `components/Layout/`

- `Sidebar.tsx`：左侧导航，基于 `getMenuRoutes(debugMode)` 渲染，支持 DEV 徽标
- `Header.tsx`：顶部栏。**【全局模型能力徽章，2026-07-28】** Logo 区新增当前激活引擎能力标识组合（数据来源 `useSettingStore` → `activeEngine.capabilities`）：`EditOutlined`（文本生成，常驻）/ `EyeOutlined`（视觉，`supportsVision=true`，绿色）/ `BulbOutlined`（思维链，`supportsThinking=true`，紫色）/ `ToolOutlined`（工具调用，`supportsToolCalling=true`，橙色）。`capabilities` 为 `undefined` 时仅显示编辑图标 + Tooltip 提示测试连通性。与 `AIEngineSettingsPanel.renderCapabilityBadges`（§14.27）形成「全局概览 + 详细管理」双层可视化
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

**【工具调用智能体引擎地基，2026-07-29 新增】** 为支持后续智能体功能（工具注册表 / 工具协议适配器 / agentLoop），AIService 进行了向后兼容的扩展（详见 §14.38）：

- **`ChatMessage` 接口扩展**：`role` 新增 `'tool'` 枚举值；新增三个可选字段 `tool_calls`（assistant 发起的工具调用数组）、`tool_call_id`（role:'tool' 时关联对应 tool_call）、`name`（role:'tool' 时工具名）。所有新增字段均为可选，现有构造 `ChatMessage` 的代码无需改动。
- **`buildRequest` 扩展**：options 新增可选 `tools?` 与 `tool_choice?` 字段。仅在显式传入时才写入 `requestBody.tools` / `requestBody.tool_choice`，不传时请求体与扩展前完全一致（不出现 tools 字段），保持向后兼容。
- **新增 `callChatWithTools` 方法**：非流式工具调用入口。接受 `tools` 与可选 `tool_choice` 参数，返回 `{ content, tool_calls?, finish_reason, model }`。参考 `callChatAPI` 的 getConfig/buildRequest/fetch 模式，并采用与 `streamChatAPI` 一致的指数退避重试（`maxRetries` 默认 2）。`content` 为 null 时规范化为 `''`；响应体含 `error` 字段时抛错。同时支持 `timeoutMs`（单次超时）与 `abortSignal`（外部取消）通过本地 controller 联动。
- **新增 `src/main/services/ai/agent/agentTypes.ts`**：智能体引擎核心类型定义，供 toolRegistry / toolProtocolAdapter / agentLoop 共用。包含 `AgentTool`（工具定义）、`ToolCallRequest`（模型发起的工具调用）、`ToolCallResult`（执行结果）、`AgentLoopParams` / `AgentLoopOptions` / `AgentLoopResult` / `AgentLoopCallbacks`（agentLoop 入参与回调）等。仅定义类型，不含实现逻辑。

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

### 7.8 Agent 技能库系统（`services/ai/agent/skill/`）

**【2026-07-30 新增】** 在工具调用智能体引擎（§7.2 工具调用智能体引擎地基）之上，新增结构化可复用能力单元——**技能（Skill）**。技能高于工具（AgentTool）一层：工具是单函数调用，技能可组合多工具 + 提示词模板 + 执行逻辑，且支持描述、发现、版本化、回滚。对标 OpenClaw skill 管理体系。

#### 三层架构

```
skillService（公共服务层，文件持久化 + 版本管理 + 初始化加载）
   ├─ skillRegistry（内存注册中心，register/unregister/get/list/discover）
   └─ skillExecutor（执行调度，按 type 分发：prompt / tool-sequence / composite）
                │
                ↓ tool-sequence 类型调用
          toolRegistry（方向 0 已建，按名解析 AgentTool）
```

#### 核心文件

| 文件 | 职责 |
|------|------|
| `skillTypes.ts` | 类型定义（SkillManifest / SkillImplementation / SkillStep / SkillResult / SkillCategory / SkillType / SkillVersionEntry / SkillSummary）|
| `skillRegistry.ts` | 内存注册中心单例 `skillRegistry`。同 id 防重复（抛错）；`list(category?, enabledOnly?)` 过滤；`discover(query, category?)` 模糊匹配 name/description/tags 返回 SkillSummary |
| `skillExecutor.ts` | 执行调度单例 `skillExecutor`。`invoke(manifest, input, context)` 按类型分发；`registerCompositeHandler(handlerRef, handler)` 注册代码 handler |
| `skillService.ts` | 公共服务单例 `skillService`。CRUD + invoke + loadFromDirectory/saveToDirectory + getSkillHistory/rollbackSkill + exportSkill/importSkill + initialize |
| `builtinSkills/*.json` | 内置技能样例（character-setting-check / worldbook-dedup-suggest / writing-outline-recall）|

#### 技能类型与执行路径

- **`prompt` 类型**：渲染 `implementation.prompt.systemPrompt`（`{{var}}` / `{{input.xxx}}` 插值），返回 `{systemPrompt, userPrompt?}` 供调用方拼装消息
- **`tool-sequence` 类型**：按 `implementation.steps` 顺序执行——渲染 `argsTemplate`（支持 `{{input.xxx}}` / `{{resultKey}}` / `{{resultKey.data.field}}` 引用前序步骤结果）→ JSON.parse → `toolRegistry.getTool` → `tool.handler`。非可选步骤失败中止；每步记录耗时构建 `trace`
- **`composite` 类型**：按 `implementation.handlerRef` 查 `compositeHandlers` Map 调用代码 handler（清单数据与代码逻辑解耦）

#### 存储布局（`userData/skills/`）

- `builtin/*.json` — 系统内置技能（author='system'）
- `custom/*.json` — 用户自定义技能（author='user'）
- `agent/*.json` — Agent 自动生成技能（author='agent'）
- `versions/<skillId>/<version>.json` — 各技能版本历史条目（支持 rollbackSkill）

#### 设计约定

- **同 id 防重复**：skillRegistry.register 同 id 抛错（与 toolRegistry 一致）；skillService.registerSkill 支持「更新」语义（先 unregister 再 register）
- **防御式加载**：loadFromDirectory 坏 JSON → 记日志 + 跳过，不抛错；同 id 重复加载跳过
- **initialize 幂等**：通过 `initialized` 标志保证多次调用仅首次执行 loadFromDirectory
- **模板插值防御式**：缺失键 → 空字符串，不抛错；对象值 JSON.stringify
- **导出单例**：`skillRegistry` / `skillExecutor` / `skillService` 全局共享

---

### 7.9 Agent 长期记忆与学习系统（`services/ai/agent/memory/`）

**【2026-07-30 新增】** 在工具调用智能体引擎（§7.2）与技能库（§7.8）之上，新增 Agent 的「长期记忆 + 自我学习」闭环，使 Agent 能够：① 记录每轮执行经验（情景记忆）；② 从经验中提炼重复模式（语义/程序记忆）；③ 在决策前召回相关历史经验（RAG 注入）；④ 根据用户反馈调整记忆置信度。对标具备长期学习特性的 Agent 架构，采用认知科学三分类：episodic（情景）/ semantic（语义）/ procedural（程序）。

#### 三层架构

```
agentLearningService（自我学习编排者）
   ├─ recordTurnExperience  ← agentLoop.onTurnComplete 回调
   ├─ extractPatterns        ← 委托 consolidator + 查询 semantic 记忆
   ├─ optimizeDecision       ← RAG 检索 + 建议技能 + 置信度计算（供 Agent 决策点注入）
   └─ applyFeedback          ← 用户反馈调整 confidence / 创建纠正 / 删除
        │
        ↓ 调用
   memoryService（记忆服务：CRUD + 向量化）
        │
        ↓ 整合触发
   memoryConsolidator（记忆整合器：episodic → semantic/procedural）
        │
        ↓ 复用基础设施（不重复造轮子）
   embeddingService / vectorStoreService / vectorRegistryService
```

#### 核心文件

| 文件 | 职责 |
|------|------|
| `memoryTypes.ts` | 类型定义（MemoryType / AgentMemory / AgentMemoryMetadata / LearningEvent / MemorySearchResult / MemoryQueryFilter / ConsolidationStats / DecisionOptimization / MemoryFeedback）|
| `memoryService.ts` | 记忆服务单例 `memoryService`。三类记忆的记录（recordEpisodic/Semantic/Procedural）+ 向量检索（searchMemories）+ 非向量查询（queryMemories）+ 上下文 RAG 召回（getRelevantMemories）+ 删除（deleteMemory）+ 索引持久化（userData/agent-memory/index.json）|
| `memoryConsolidator.ts` | 记忆整合器单例 `memoryConsolidator`。`consolidate()` 按 taskType 分组 episodic，提取「成功共性 → procedural」「失败模式 → semantic」规则，旧 episodic relevance × 0.7 衰减，semantic/procedural 去重合并（supportCount 累加）|
| `agentLearningService.ts` | 自我学习编排单例 `agentLearningService`。`recordTurnExperience`（agentLoop 回调）/ `extractPatterns` / `optimizeDecision`（RAG + 建议技能 + 置信度）/ `applyFeedback` / `consolidate` |

#### 记忆类型与生命周期

- **episodic（情景记忆）**：单轮 Agent 执行经验，由 `recordTurnExperience` 自动记录，relevance=1.0 起步，每被整合一次 ×0.7 衰减
- **semantic（语义记忆）**：从 episodic 提炼的规则（pattern='avoid' 失败模式 / pattern='user-correction' 用户纠正），confidence 默认 0.5-0.6，由 applyFeedback 调整
- **procedural（程序记忆）**：学到的工作流（关联 skillId），confidence 默认 0.6，每次合并 +0.05（cap 0.95）

#### 向量路由约定（与 SourceTypeSearchStrategy 对齐）

所有 Agent 记忆向量统一存入 `source='agent-memory'` / `sourceId='agent-memory'` 的 backend，注册为单一 VectorRegistryEntry（vectorFileId='agent-memory-singleton'）。这样 `searchMemories` 传 `{sourceType:'agent-memory'}` 即可命中所有记忆向量，无需多源聚合。

#### 存储布局

- `userData/agent-memory/index.json` — 记忆元数据索引（不含 vector 数组，保持轻量）
- `userData/vectors/agent-memory/agent-memory/vecstore.json` — 向量数据（由 VectorStoreService 管理）
- `userData/vector_registry.json` — 注册表条目（共享一份 entry 代表整个 agent-memory backend）

#### 设计约定

- **物理隔离**：本模块完全独立于 `services/memory/`（聊天/表格记忆），不互相 import；仅通过 EmbeddingService / VectorStoreService / VectorRegistryService 共用底层基础设施
- **增量零影响**：向量化失败 / 向量存储不可用时，记忆元数据仍写入 index.json，记忆功能（非语义检索部分）继续可用
- **索引轻量化**：index.json 只存元数据，向量数据由 VectorStoreService 独立管理，避免重复存储
- **防御式后台 hook**：`recordTurnExperience` / `consolidate` / `applyFeedback` 全程 try-catch，作为后台 hook 调用时绝不抛错
- **规则驱动整合**：consolidator 不依赖外部 AI 调用（避免网络抖动），采用确定性规则——同 taskType + 同 leadingTool 的 success ≥2 条 → procedural；同 taskType + 同 failing tool 的 failure ≥2 条 → semantic('avoid')
- **导出单例**：`memoryService` / `memoryConsolidator` / `agentLearningService` 全局共享

#### 集成接入点（Task 11，2026-07-30）

技能库与记忆系统通过两个接入点集成进 agentLoop，使 Agent 具备自主调用技能与读写长期记忆的闭环能力：

- **`AgentToolGroup` 新增 `'foundation'`**：在 `agentTypes.ts` 的工具组联合类型追加 `'foundation'` 值，对应一组基础能力工具。
- **`AgentLoopCallbacks` 新增 `onTurnComplete?`**：可选回调 `(result, context?) => void`。`agentLoop.ts` 在全部返回路径（2 处降级 / aborted / completed / max_iterations / error）触发该回调，供 `agentLearningService.recordTurnExperience` 记录 episodic 记忆。**可选回调，不传则零影响**——现有调用方（`agentHandlers.ts`）未传，行为与扩展前完全一致。
- **`tools/agentFoundationTools.ts`（新建）**：导出 `agentFoundationTools: AgentTool[]`，含 4 个工具，参数严格 JSONSchema、handler 全程 try-catch：
  - `invokeSkill` → `skillService.invokeSkill(id, input, context)`
  - `searchMemories` → `memoryService.searchMemories(query, type?, topK?)`
  - `recordMemory` → 按 type 分发 `recordEpisodic/Semantic/ProceduralMemory`（episodic 由 metadata 构建 `LearningEvent`）
  - `discoverSkills` → `skillService.discoverSkills(query, category?)`
- **`tools/index.ts` 注册**：`registerBuiltinTools()` 追加 `toolRegistry.registerGroup('foundation', agentFoundationTools)`，复用现有幂等 `registered` 标志（一次性注册）。

#### 决策置信度计算

`optimizeDecision` 返回的 confidence 公式：
- base 0.5
- + 每条相关记忆 0.1（cap 0.9）
- − 命中失败模式（pattern='avoid'）0.1
- floor 0, ceiling 0.9

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
IVectorBackend (VecstoreBackend)   ← 单源存储后端契约
```

- **`IVectorBackend`**（`vector/IVectorBackend.ts`）：单源存储后端契约接口
- **`VectorRepository`**（`vector/VectorRepository.ts`）：多源路由 + 反向索引（`delete` 通过反向索引路由，O(1) 替代全源扫描）
- **`VectorStoreService`**（`VectorStoreService.ts`）：Facade，使用 LRU Map（max=100 源）缓存，组合 Strategy

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
| `expressionStore` | 角色卡表情状态（Spec: add-character-expression-system / Task 6）。持有 `manifest` / `imageCache`（**仅存 data URL，CSP 兼容**）/ `loading` / `error`；封装 `window.electronAPI.expression.*` IPC 调用；提供 `loadExpressions` / `saveExpression` / `deleteExpression` / `addCustomEmotion` / `removeCustomEmotion` / `resolveExpressionImage` / `getAvailableEmotionKeys` / `clear` actions。加载时通过 `new Image()` 预热浏览器图像缓存避免情绪切换闪烁。不持久化到 localStorage（manifest 由主进程 `expressionService` 写盘）。【重点标记 - CSP 裂图 BUG 修复】imageCache 不存磁盘绝对路径，避免被 CSP `img-src 'self' data: blob:` 拦截。 |

**日志规范**：所有 store 通过 `useLogStore.getState().addLog(message, type, options)` 记录，`options` 支持 `details`、`error`、`context`、`category`。

---

## 10. 共享类型系统

`src/shared/types/` 是主进程与渲染进程的 **类型单一真源**，通过 `index.ts` barrel 统一导出。

| 文件 | 内容 |
|------|------|
| `writing.types.ts` | 写作模式全套类型（`NovelType`、`WritingStyle`、`WritingProject`、`ChapterOutline`、`CustomNovelTypeTemplate`、`CustomWritingStyleTemplate`、`AutoFixResult` 等） |
| `writing-table.types.ts` | 写作表格数据（`WritingTableData`，单一真源） |
| `game.types.ts` | 游戏模式类型（`GameType`、`GameMeta`、`GameSaveData`、`GameTableData`、`GameTypeTemplate`、`GameNarrativeRequest` 等） |
| `chat.types.ts` | 聊天消息类型 |
| `vector.types.ts` | 向量检索类型（`VectorItem`、`SearchResult`、`ContextItem`、`RetrieveOptions`） |
| `vector.ts` | 向量兼容 re-export |
| `vectorConfigSchema.ts` | 向量配置 Schema 常量 |
| `promptTemplate.types.ts` | 提示词模板类型 |
| `vectorConfig.ts`（主进程 `types/`） | `VectorConfig`、`VectorStoreMode` |

**冲突消解**：`ContextItem` / `RetrieveOptions` 在 `vector.types`（向量检索）与 `writing.types`（写作上下文）中同名，barrel 优先暴露向量语义版本，写作版本需直接 `import` 自 `writing.types`。

`src/shared/settings.ts` 定义全局默认设置 `AppSetting.defaultSetting`，包含完整的 AI 引擎默认配置（采样器、停用词、路径、向量配置等）。

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
| `vecstore-wasm` | 向量数据库 |
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

## 14. 已知重点问题与修复记录

> 以下为技术文档中标记的重点问题，开发时需特别注意。

### 14.1 ⭐ 角色卡对话异步整理表格自动创建（三轮迭代修复）

- **症状**：异步整理模式下 tableEdit 命令执行失败，"表格文件不存在"
- **根因**：`executeTableEditCommands` 缺少文件存在性检查；`autoInitializeChatSession` 仅检查关联记录不验证实际文件；副本模板被删除但关联记录残留
- **修复**：新增 `resolveAvailableTemplate` 统一模板回退逻辑（关联副本 → 原始模板 → 任意可用），增加文件创建二次验证
- **文件**：`src/main/services/memory/chatLogService.ts`

### 14.2 ⭐ AI 响应 HTML 注释嵌套解析

- **症状**：AI 在 tableEdit JSON 值中嵌入 `<!-- -->` 导致解析器失效
- **根因**：非贪婪正则截断外层注释
- **修复**：重写 `parseCommands` 按行匹配命令，`parseDataObject` 解析前清理嵌套注释
- **文件**：`src/main/services/memory/tableEditParser.ts`

### 14.3 ⭐⭐ 写作大纲数据结构重构

- **变更**：移除 `WritingProject.chapters`，统一使用 `project.outline.chapters` 作为唯一章节数据源
- **影响**：类型定义、主进程服务、渲染进程组件/hooks、服务层全部适配
- **标记**：重大架构变更，消除双重存储同步风险

### 14.4 ⭐⭐ 世界书编辑器组件替换（Milkdown → TextEditor）

- **原因**：Milkdown 自带主题与系统 CSS 变量体系不统一，WYSIWYG 模式不匹配纯文本/Markdown 需求
- **方案**：新建 `Common/TextEditor/`（基于 textarea + Ant Design token），替换 3 处 MarkdownEditor 引用
- **标记**：重大架构改进

### 14.5 思考标签过滤

- **需求**：过滤模型输出的 `think` / `thinking` / `thought` 思考标签包裹的推理过程内容，避免用户看到内部思考
- **实现**：`messageProcessor.ts` 新增 `stripThinkingTags`，处理自闭合 / 完整标签对 / 未闭合标签（流式场景）三种变体，清理多余空行，集成到 `processMessage` 与 `preprocessForMarkdown`
- **测试**：20 个单元测试 + 4 个渲染层测试，67 个测试全部通过
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts`

### 14.6 写作模式自定义模板管理（2026-07-06 新增）

- **能力**：自定义小说类型与写作风格模板，支持从零创建、基于预置模板复制、编辑、删除
- **数据模型**：`CustomNovelTypeTemplate`、`CustomWritingStyleTemplate`（`shared/types/writing.types.ts`），`WritingParameters` 新增 `customNovelTypeId` / `customWritingStyleId`
- **兼容策略**：保留预置枚举（12 种小说类型 / 7 种写作风格），自定义模板 ID 用 `custom_` 前缀，`PromptBuilder` 优先自定义回退预置
- **存储**：`data/writing-templates/{novel-types,writing-styles}/{id}.json`，安全写入（先写 `.tmp` 再 rename）
- **IPC**：`writing:template:novelType:*` / `writing:template:writingStyle:*`（list/get/save/delete），预置模板只读
- **UI**：`WritingTemplateManager` 弹窗，两个 Tab，预置模板仅可复制，自定义可编辑删除

### 14.7 自动修正反馈增强

- **能力**：`PlotCheckerService.autoFixIssue` 返回 `AutoFixResult`（含 `diffs` 差异列表），`AutoFixResultModal` 展示修正前后对比，支持接受/拒绝/取消
- **文件**：`PlotCheckerService.ts`、`AutoFixResultModal.tsx`、`ContentWorkspace.tsx`

### 14.8 写作模式素材选择功能

- **能力**：写作辅助面板支持从系统全部素材中选择（世界书/角色卡/用户人设/知识库四类），300ms 防抖搜索，已选高亮
- **文件**：`useWritingMaterials.ts`、`MaterialList.tsx`、`WritingModeRightPanel.tsx`

### 14.9 辅助模式推荐选项渲染与交互（Spec: add-assist-mode-options）

- **能力**：AI 消息渲染推荐选项（`suggestedOptions`），用户点击后选项文本填入输入框（复用 `generatedReplyText` 机制）
- **渲染条件**：仅 AI 消息（`!isUser`）、非流式（`!isStreaming`）、`message.suggestedOptions` 非空时渲染
- **交互**：`ChatMessageBubble` 新增 `onSelectOption` prop；`CharacterDialogueChat` 新增 `handleSelectOption` 回调，调用 `setGeneratedReplyText` 填入输入框
- **文件**：`ChatMessageBubble.tsx`、`CharacterDialogueChat.tsx`

### 14.10 角色卡表情管理系统后端（Spec: add-character-expression-system / Task 1，2026-07-26 新增，增量进行中）

- **能力**：为每个角色卡独立维护表情包（manifest.json + 多个情绪 PNG），供后续 AI 回复按情绪动态切换头像。本节记录 Task 1 已落地的后端层；UI / 解析 / 预加载等将在后续 Task 完成
- **存储路径**：`{userData}/data/character-expressions/{sanitizeCardId(characterCardId)}/`
  - `sanitizeCardId` 取 `sha256(characterCardId)` 前 16 个十六进制字符：保证同一 characterCardId（角色卡文件路径字符串，可能含路径分隔符/空格/中文）始终映射到同一目录，且文件系统安全
- **manifest 结构**：`{ characterCardId, version: 1, expressions: Record<emotionKey, { type: 'preset'|'custom', image: '{emotionKey}.png' }>, customEmotions: Array<{ key, label }> }`
- **服务**：`ExpressionService`（单例 `expressionService`）提供 `listExpressions / saveImage / deleteImage / addCustomEmotion / removeCustomEmotion / getImagePath`；镜像 `avatarService` 风格（`fs/promises` + `fsSync` + `[ExpressionService]` 日志前缀）；自定义情绪 key 校验 `^[a-z][a-z0-9_]*$`
- **IPC 通道**：`expression:list` / `expression:saveImage` / `expression:deleteImage` / `expression:addCustomEmotion` / `expression:removeCustomEmotion` / `expression:getImagePath`，注册入口 `registerExpressionHandlers()`（在 `ipc/index.ts` 的 `setupIpcHandlers()` 中调用），每个 handler try/catch 返回 `{ success: false, error }`
- **Preload 暴露**：`electronAPI.expression.{list, saveImage, deleteImage, addCustomEmotion, removeCustomEmotion, getImagePath}`，类型声明见 `src/renderer/types/electron.d.ts`
- **图像返回**：`saveImage` / `getImagePath` 返回绝对路径，便于渲染进程 `<img src={absolutePath}>` 直接加载本地文件
- **文件**：`src/main/services/expressionService.ts`（新建）、`src/main/ipc/handlers/expressionHandlers.ts`（新建）、`src/main/ipc/index.ts`（注册）、`src/main/preload.ts`（暴露）、`src/renderer/types/electron.d.ts`（类型）

### 14.11 表情图片裁剪弹窗 ImageCropperModal（Spec: add-character-expression-system / Task 5，2026-07-26 新增，增量进行中）

- **能力**：基于 `react-easy-crop`（v6.2.3，自带 TypeScript 类型）实现的方形裁剪弹窗，供 `ExpressionManagerModal`（Task 7，未实现）调用。用户从全身图/大图中精确截取面部表情区域，输出 PNG data URL，长边超过 512px 时按比例压缩，符合 Spec「图像格式统一与压缩」要求
- **Props**：`{ open: boolean; imageSrc: string | null; onConfirm: (croppedDataUrl: string) => void; onCancel: () => void }`；`imageSrc` 为 null 时弹窗体显示「图片加载中...」占位
- **裁剪交互**：
  - `<Cropper>` 组件，`aspect=1`（方形）、`showGrid` + `zoomWithScroll` 开启（滚轮缩放为内置行为，无需额外 wheel 监听）
  - `crop` 状态 `{ x, y }` 控制平移，`zoom` 状态（0.5~5，默认 1）控制缩放
  - antd `Slider` 滑块绑定 `zoom`，与 Cropper 双向同步（`onZoomChange`）
  - `onCropComplete(croppedArea, croppedAreaPixels)` 仅缓存 `croppedAreaPixels`（像素坐标）供确认时使用
- **裁剪输出 `getCroppedImg(imageSrc, pixelCrop)`**：异步函数，复用 `CharacterEditModal.convertToPng` 的 `new Image()` + `onload` Promise 模式；按 `pixelCrop` 子区域 `drawImage` 到目标 canvas；长边 > 512px 时按 `MAX_LONG_SIDE / longSide` 系数等比缩放，一次 drawImage 到目标尺寸（避免二次重绘）；返回 `canvas.toDataURL('image/png')`
- **圆形预览**：64×64 圆形预览，用 CSS `background-image` + `background-size` + `background-position` 同步渲染（基于 `croppedAreaPixels` + `onMediaLoaded` 返回的 `naturalWidth/Height` 计算），无 canvas 异步开销
- **状态重置**：`useEffect` 监听 `open` 与 `imageSrc`，弹窗打开或图片切换时重置 `crop={0,0}` / `zoom=1` / `croppedAreaPixels=null` / `mediaSize=null`，避免上次裁剪位置残留
- **异常容错**：`handleConfirm` try/catch 包裹；失败时 `message.error('裁剪失败')` 且不关闭弹窗（用户可重试或取消）；`finally` 关闭 loading
- **UI 风格**：antd Modal 暗色主题，width=640，自包含 inline styles（参照 `ChatMessageBubble.tsx` 模式，未引入额外 CSS 文件）；使用项目 CSS 变量（`--primary-color` / `--config-panel-label-color` / `--config-panel-sub-text-color` / `--chat-bubble-assistant-bg`）；Cropper 容器固定 400px 高 + `#0f0f1a` 暗色背景便于透明 PNG 可见；确认按钮使用 `linear-gradient(135deg, #6366f1, #8b5cf6)` 与 ChatHeader 风格一致
- **TypeScript 注意**：`react-easy-crop` v6 的 `CropperProps` 类型将 `style` / `classes` 标记为必填（虽然 `defaultProps` 提供空对象，但 TS 5.x 不再对 class defaultProps 应用 `LibraryManagedAttributes`），因此 JSX 中显式传 `style={{ containerStyle: {...} }}` 和 `classes={{}}`
- **类型导入**：`import Cropper from 'react-easy-crop';`（默认导出）+ `import type { Area } from 'react-easy-crop';`（命名类型导出）；`Area = { width, height, x, y }`
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx`（新建，~270 行）
- **tsc 验证**：`npx tsc --noEmit` 通过，ImageCropperModal.tsx 无新增 TypeScript 错误（仓库唯一 tsc 错误为 `vite.config.ts:65` 的 `WatchOptions.include` 类型问题，与本组件无关，属预存问题）

### 14.12 表情管理弹窗 ExpressionManagerModal + Zustand store（Spec: add-character-expression-system / Task 6 + Task 7，2026-07-26 新增）

#### 14.12.1 expressionStore（`src/renderer/stores/expressionStore.ts`）

- **能力**：渲染进程侧的表情状态管理 Zustand store（`useExpressionStore`），作为 IPC 适配层与运行期缓存，封装所有 `window.electronAPI.expression.*` 调用，对组件暴露同步/异步 actions
- **状态字段**：
  - `currentCharacterCardId: string | null` —— 当前加载的角色卡 ID（切换角色卡时被覆盖，用于校验缓存归属）
  - `manifest: ExpressionManifest | null` —— 当前 manifest（含预置/自定义情绪映射）
  - `imageCache: Record<string, string>` —— emotionKey → **data URL**（仅含已上传表情）。【重点标记 - CSP 兼容】只存 data URL 不存磁盘绝对路径，否则 `<img src>` 会被 CSP `img-src 'self' data: blob:` 拦截导致裂图
  - `loading: boolean` / `error: string | null`
- **Actions**：
  - `loadExpressions(characterCardId)` —— 拉取 manifest + 逐个 `getImagePath` 拿磁盘绝对路径 → `file.readAsBase64` 转 data URL 存入 imageCache + `new Image()` 预热浏览器图像缓存（fire-and-forget）
  - `saveExpression(characterCardId, emotionKey, imageDataUrl, isCustom, label?)` —— 调用 `saveImage` IPC，成功后**直接复用入参 `imageDataUrl`**（本身就是 data URL）存入 imageCache 并预热新图；仅当入参不是 data URL 时才回退读盘
  - `deleteExpression(characterCardId, emotionKey)` —— 调用 `deleteImage` IPC，同步从 manifest.expressions 与 imageCache 移除
  - `addCustomEmotion(characterCardId, key, label)` —— 调用 `addCustomEmotion` IPC，同步追加到本地 manifest.customEmotions（幂等）
  - `removeCustomEmotion(characterCardId, key)` —— 调用 `removeCustomEmotion` IPC，同步移除 customEmotions + expressions + imageCache
  - `resolveExpressionImage(emotionKey)` —— null/undefined/空串/`'default'` 直接返回 null（回退默认头像）；其他 key 从 imageCache 查找 data URL
  - `getAvailableEmotionKeys()` —— 合并 `EMOTION_PRESETS` 全部 key + manifest 的 customEmotions key（去重保序，预置优先）
  - `clear()` —— 重置所有状态
- **设计要点**：
  - **不持久化到 localStorage**：表情数据由主进程 expressionService 持久化到磁盘，store 仅作为运行期缓存，每次进入对话重新拉取
  - **永不抛异常**：所有 actions 包裹 try/catch，统一通过返回值 `{ success, error? }` 传递错误
  - **引用更新**：`manifest` / `imageCache` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
- **【重点标记】关于 `getImagePath` 的返回签名**：任务文档描述为 `Promise<string | null>`，但 `src/renderer/types/electron.d.ts` 第 453 行与 `src/main/ipc/handlers/expressionHandlers.ts` 第 143 行的实际实现均为 `Promise<{ success: boolean; imagePath: string | null; error?: string }>`。本 store 以实际实现为准（取 `.imagePath`），不以任务文档为准
- **【重点标记 - CSP 裂图 BUG 修复（2026-07-27）】** 早期实现将 `getImagePath` / `saveImage` 返回的磁盘绝对路径直接存入 `imageCache` 并用于 `<img src>`，但 `src/main/index.ts` 的 CSP 限制 `img-src 'self' data: blob:`，本地文件路径被浏览器拦截导致「裂开图片」图标。修复方案：imageCache 中**只存 data URL**——`loadExpressions` 在拿到绝对路径后再调 `window.electronAPI.file.readAsBase64(path)` 转 data URL（与 `useCharacterSwitch.ts` 加载头像方式一致）；`saveExpression` 直接复用入参 `imageDataUrl`（裁剪/SD 生成的输出本就是 data URL）。**核心教训**：Electron 渲染进程启用了 `webSecurity: true` + 严格 CSP 时，本地文件路径不能直接用于 `<img src>`，必须转为 data URL（或注册自定义 protocol）；后续涉及「在渲染进程展示主进程落盘的图片」场景应统一遵循 data URL 模式
- **文件**：`src/renderer/stores/expressionStore.ts`（新建，~500 行），类型导出 `ExpressionEntry` / `CustomEmotion` / `ExpressionManifest` / `ExpressionState`

#### 14.12.2 ExpressionManagerModal（`src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`）

- **能力**：表情管理弹窗组件（Task 7），渲染 30 个预置情绪 + 用户自定义情绪的网格，每个格子展示当前表情缩略图（或「未上传」占位 + 默认头像小图）+ 上传/删除/预览按钮；提供「添加自定义情绪」表单
- **Props**：`{ open: boolean; characterCardId: string; characterName: string; avatarPath?: string; onClose: () => void }`
- **数据来源**：`useExpressionStore`（Zustand）。保存/删除后 store 同步更新本地 manifest 与 imageCache，UI 通过引用变化自动重渲染，无需显式 reload
- **打开时加载**：`useEffect` 监听 `open + characterCardId`，弹窗打开时调用 `loadExpressions(characterCardId)` 加载该角色卡表情包
- **上传流程**：点击上传 → 隐藏 `<input type="file" accept="image/*">` → FileReader 读取为 data URL → 打开 `ImageCropperModal` → 裁剪确认 → 调用 `expressionStore.saveExpression(characterCardId, emotionKey, croppedDataUrl, isCustom, label?)` → 网格自动刷新（store 引用变化）
  - **file input 复用技巧**：`fileInputRef.current.value` 必须在每次点击前重置，否则用户连续选择同一文件不触发 `change` 事件
  - **上传目标上下文**：组件维护 `cropperTargetKey` / `cropperIsCustom` / `cropperLabel` 状态，记录当前正在上传的情绪键信息，传递给裁剪弹窗的 `onConfirm` 回调
- **删除流程**：`Modal.confirm` 二次确认 → `expressionStore.deleteExpression(characterCardId, emotionKey)`；预置情绪仅删除图像（回退默认），自定义情绪需通过单独的「移除类别」入口调用 `removeCustomEmotion`（删除图像 + manifest 条目）
- **添加自定义情绪表单**：弹出二级 `Modal`，输入英文键（前端校验 `^[a-z][a-z0-9_]*$` + 不与预置重复）+ 中文标签 → 调用 `expressionStore.addCustomEmotion(characterCardId, key, label)`
- **错误展示策略【重点标记】**：`store.error` 仅以 inline 横幅展示，避免 toast 重复弹出；具体操作的失败（save/delete/add/remove）由对应 handler 通过 `message.error` 反馈
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量，参照 `CharacterEditModal` / `ChatMessageBubble` / `ImageCropperModal` 一致
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx`（新建，~764 行）

#### 14.12.3 AI 生成表情入口（Spec: add-ai-expression-generation / Task 5，2026-07-27 新增）

- **背景**：原 `ExpressionManagerModal` 仅支持手动上传表情图（file input → ImageCropperModal → saveExpression）。Task 5 在不破坏现有流程的前提下，新增 AI 生成（基于 SD WebUI img2img）的两个入口，调用 Task 4 创建的 `ExpressionGenerateModal` 组件
- **新增 imports**：`ThunderboltOutlined` / `RobotOutlined`（@ant-design/icons）、`ExpressionGenerateModal`（`./ExpressionGenerateModal`，默认导出）
- **新增 state**：`generateModalOpen`（弹窗可见性）/ `generateMode`（`'batch' | 'single'`）/ `generateTargetKey?` / `generateTargetLabel?`（单张模式的情绪键与标签）
- **批量入口（顶部工具栏）**：在「添加自定义情绪」按钮右侧新增 `<Button type="primary" icon={<ThunderboltOutlined />}>AI 生成全部表情</Button>`，`disabled={!hasCharacter}`，`onClick={handleBatchGenerate}`
  - **覆盖确认【重点标记】**：`handleBatchGenerate` 检测 `manifest?.expressions` 是否非空，若已有任何表情图则弹出 `Modal.confirm` 二次确认（"覆盖现有表情？部分情绪已有表情图片，AI 生成将覆盖这些表情"），避免误覆盖用户已上传的图片
- **单张入口（情绪格子操作区）**：在每个非 default 情绪卡片的操作区（位于「上传」按钮与「删除」按钮之间）新增 `<Tooltip title="AI 生成"><Button type="text" size="small" icon={<RobotOutlined />} /></Tooltip>`
  - **stopPropagation**：按钮 `onClick` 调用 `e.stopPropagation()` 防止触发卡片父级 hover/leave 事件
  - **仅非 default**：default 卡片（角色卡头像）不展示 AI 生成按钮，因 default 不需要单独生成
- **handler**：`handleBatchGenerate(manifest)` 与 `handleSingleGenerate(emotionKey, label)`，均为 `useCallback` 包装；`handleSingleGenerate` 加入 `renderEmotionCard` 的 deps 数组
- **弹窗渲染**：在 `ImageCropperModal` 之后渲染 `<ExpressionGenerateModal>`，传入 `open` / `characterCardId` / `characterName` / `avatarPath` / `mode` / `targetEmotionKey` / `targetEmotionLabel` / `onClose` / `onGenerated`
  - **`onGenerated` 回调**：调用 `loadExpressions(characterCardId)` 刷新 expressionStore 的 manifest 与 imageCache，使新生成的图片立即展示在网格中
- **Props 接口约定**：`ExpressionGenerateModalProps { open, characterCardId, characterName, avatarPath?, mode: 'batch' | 'single', targetEmotionKey?, targetEmotionLabel?, onClose, onGenerated? }`（由 Task 4 实现，本任务仅消费）
- **未导入 `ExpressionGenerateModalProps` 类型**：项目 `tsconfig.json` 启用 `noUnusedLocals: true`，本组件未显式标注 props 类型（直接 inline 传递），故仅 import 默认导出，避免未使用类型导入触发 tsc 错误
- **兼容性**：不修改原有上传/删除/添加自定义情绪/移除类别任何流程；新增按钮独立挂载，互不影响

### 14.13 表情提示词构建与情绪标记解析（Spec: add-character-expression-system / Task 3 + Task 9 + Task 11，2026-07-26 新增）

#### 14.13.1 EMOTION_PRESETS 常量（PromptBuilder.ts）

- **能力**：30 项预置情绪清单，基于 GoEmotions 分类（27 项）+ default（默认）+ cheerfulness（快乐）；每项含唯一英文键（AI 输出用）与中文标签（UI 展示用）
- **不可删除**：预置类别不可删除，用户可在此基础上追加自定义情绪
- **导出形式**：`ReadonlyArray<{ key: string; label: string }>`
- **清单**：default/默认、admiration/钦佩、amusement/愉悦、anger/愤怒、annoyance/恼怒、approval/赞同、caring/关切、confusion/困惑、curiosity/好奇、desire/渴望、disappointment/失望、disapproval/不赞同、disgust/厌恶、embarrassment/尴尬、excitement/兴奋、fear/恐惧、gratitude/感激、grief/悲痛、joy/喜悦、love/喜爱、nervousness/紧张、neutral/中性、optimism/乐观、pride/自豪、realization/顿悟、relief/宽慰、remorse/懊悔、sadness/悲伤、surprise/惊讶、cheerfulness/快乐

#### 14.13.2 buildExpressionPrompt（PromptBuilder.ts）

- **能力**：构建表情显示模式系统提示词约束，要求 AI 在回复正文末尾以结构化格式输出当前情绪键名
- **签名**：`buildExpressionPrompt(charName: string = 'Character', availableEmotionKeys: string[] = []): string`
- **格式要求**：在正文之后另起一行，严格按 `<<<EXPRESSION>>>emotion_key<<<END_EXPRESSION>>>` 格式输出
- **约束**：`emotion_key` 必须来自 `availableEmotionKeys` 列表；情绪难以判断时使用 `neutral`
- **防御性兜底**：未传入 keys 时使用预置全部 key（保证 AI 输出的 key 可被解析）
- **与 suggestedOptions 互不冲突**：两者标记格式不同（`<<<EXPRESSION>>>` vs `<<<SUGGESTED_OPTIONS>>>`），可同时启用

#### 14.13.3 parseExpressionFromContent（PromptBuilder.ts）

- **能力**：从 AI 回复内容中多格式容错解析情绪标记，返回 `{ emotion: string | null, cleanedContent: string }`
- **多格式容错匹配**（参照 `parseSuggestedOptions` 模式）：
  1. 主格式：`<<<EXPRESSION>>>key<<<END_EXPRESSION>>>`（大小写不敏感）
  2. 容错：仅有开始标记 `<<<EXPRESSION>>>key` 到文本末尾
  3. 兼容变体：`<expression>key</expression>`（纯标签）
  4. 兼容变体：仅有 `<expression>key` 到末尾
- **行为**：解析成功返回小写 emotion 键名 + 剥离标记后的 cleanedContent；解析失败返回 `{ emotion: null, cleanedContent: content }`

#### 14.13.4 hooks.ts 注入与解析（`CharacterDialogueChat.hooks.ts`）

- **注入位置**：`requestAIResponse` 系统提示词拼接段（约 L920-933）；当 `characterConfig?.customParameters?.expression_display === true` 时，调用 `buildExpressionPrompt(charName, availableEmotionKeys)` 追加到 `effectiveSystemPrompt`
- **availableEmotionKeys 来源**：合并 `EMOTION_PRESETS` 全部 key + 当前角色卡 manifest 的 customEmotions key（通过 `expressionStore.getAvailableEmotionKeys()` 读取）；若 manifest 未加载则仅用预置 keys
- **解析位置**：AI 回复后处理段（约 L1155-1216 suggestedOptions 解析附近），当 `expression_display === true` 时调用 `parseExpressionFromContent(finalContent)`，得到 `emotion` 与 `cleanedContent`；将 `cleanedContent` 覆盖 `finalContent`（剥离标记），并将 `emotion` 写入最终 ChatMessage
- **emotionStripped 容差标志【重点标记】**：参照 `thinkTagsStripped` / `optionsStripped` 模式，设置 `emotionStripped` 标志纳入既有「内容保护检查」的容差跳过逻辑，避免剥离标记后触发内容保护误判导致 UI 卡死（`displayContent.length < existingContent.length` 时跳过保护检查）
- **日志记录**：`addLog` 标记解析结果（含未匹配回退警告）

#### 14.13.5 ChatMessageBubble 渲染（`ChatMessageBubble.tsx`，Spec Task 10）

- **新增 props**：`expressionImage?: string`（由父组件通过 `expressionStore.resolveExpressionImage(message.emotion)` 解析后的表情图像路径，未提供时回退 `avatarPath`）
- **渲染优先级**：`expressionImage` > `avatarPath` > 首字母占位
- **流式期间回退**：流式消息（`isStreaming`）期间使用默认头像，待流式完成后再切换为表情图像，避免闪烁
- **父组件透传**：`CharacterDialogueChat.tsx` 消息列表渲染处通过 `expressionStore.resolveExpressionImage(message.emotion)` 解析每条 assistant 消息的表情路径，传入 `ChatMessageBubble`

#### 14.13.6 ParameterPanel 开关迁移（`ParameterPanel.tsx` + `ConfigPanel.tsx` + `CharacterDialogueChat.tsx`，Spec Task 11）

- **移除**：「Emoji 增强模式」开关区块（约 L376-391）+ `emojiEnhanced` / `onEmojiEnhancedToggle` props
- **新增**：「开启表情」开关区块，绑定 `expressionDisplay` / `onExpressionDisplayToggle` props；Tooltip 说明：「开启后，AI 回复时根据语境动态切换角色表情头像。需先在「表情管理」中上传表情图片。默认关闭。」
- **透传链路**：`ConfigPanel.tsx` 透传 `expressionDisplay` / `onExpressionDisplayToggle`，移除 `emojiEnhanced` / `onEmojiEnhancedToggle` 透传
- **状态绑定**：`CharacterDialogueChat.tsx` 计算 `expressionDisplay = characterConfig?.customParameters?.expression_display === true`，`onExpressionDisplayToggle` 回调调用 `updateConfig({ customParameters: { ..., expression_display: enabled } })` 并 `saveConfig`
- **BREAKING**：`buildEmojiEnhancedPrompt` 函数保留在 PromptBuilder 中但不再被调用；`emoji_enhanced` 配置字段保留以避免旧配置读取报错（标记 `@deprecated`），但不再产生任何效果
- **hooks.ts 同步**：移除 `buildEmojiEnhancedPrompt` 的 import 与调用（保留 PromptBuilder 中的函数定义以便回退）

#### 14.13.7 类型扩展（`src/shared/types/chat.types.ts` + `CharacterDialogueChat.types.ts`）

- `ChatMessage` 接口新增 `emotion?: string` 字段（含 JSDoc 注释引用本 Spec），用于持久化 AI 回复携带的情绪键名，使表情状态跨会话保留
- `AIParameterConfig` 接口新增 `expression_display?: boolean` 字段（默认关闭，`undefined` 视为关闭）；为 `emoji_enhanced` 添加 `@deprecated` JSDoc 注释
- 4 处独立 `ChatMessage` 定义同步添加 `emotion` 字段：`src/shared/types/chat.types.ts` / `src/renderer/stores/characterChatStore.ts` / `src/main/services/ChatStorageService.ts` / `CharacterDialogueChat.types.ts`（参照 `suggestedOptions` 持久化修复的 3 层遗漏教训）

#### 14.13.8 CharacterEditModal 表情管理 Tab（Spec: add-character-expression-system / Task 15，2026-07-26 新增）

**【重点标记 - 用户反馈补充入口】** 用户反馈「没有看到上传角色表情包的位置」——原入口仅位于对话头部 ChatHeader 的 😊 按钮，用户在角色卡编辑界面找不到上传入口。Task 15 在 `CharacterEditModal.tsx` 新增第二入口。

- **新增 imports**：`Alert`（antd）、`SmileOutlined`（@ant-design/icons）、`ExpressionManagerModal`（`./CharacterDialogueChat/ExpressionManagerModal`）
- **新增 state**：`expressionModalOpen`（boolean），控制嵌套 `ExpressionManagerModal` 的 open 状态
- **新增 Tab**：在 Tabs items 数组末尾（`worldbook` 之后）新增 `{ key: 'expressions', label: <SmileOutlined /> 表情管理 }`
- **Tab 内容逻辑**：
  - `editingItem?.path` 存在（已有角色卡）：显示 `Alert type="info"` 说明 + `Button type="primary"` 「打开表情管理」→ `setExpressionModalOpen(true)`
  - `editingItem?.path` 不存在（新建角色卡）：显示 `Alert type="warning"` 「请先保存角色卡」
- **嵌套 Modal 渲染**：与 AI润色 / AI生成 Modal 同级渲染 `ExpressionManagerModal`，传入 `characterCardId={editingItem?.path}` / `characterName={formValues.name}` / `avatarPath={uploadedImage}`
- **数据互通**：两个入口（ChatHeader + CharacterEditModal Tab）共用同一 `ExpressionManagerModal` 组件与 `expressionStore`，表情数据完全互通
- **文件**：`src/renderer/components/Character/CharacterEditModal.tsx`（修改，新增 ~50 行）

### 14.14 SD 表情生成服务 SDGenerationService（Spec: add-ai-expression-generation / Task 1，2026-07-27 新增）

**【重点标记 - Spec 约束修改】** 本节起的 §14.14-§14.17 实现 AI 表情生成功能，对应 Spec `add-ai-expression-generation`。该 Spec **修改了原 Spec `add-character-expression-system` 的约束 1.b**：从「表情图像仅通过用户上传实现，无任何『自动生成』入口」变更为「允许通过本地 SD WebUI AI 生成，用户也可手动上传，两种方式并存」。这是架构层面的约束变更，但所有存储/渲染/manifest 逻辑保持不变——AI 生成仅是「写入表情存储」的另一条数据源，与手动上传走完全相同的 `expression:saveImage` IPC 通道，写入同一目录与 manifest，可互相替换/删除。

- **能力**：主进程 Stable Diffusion WebUI API 客户端服务，通过本地 Forge Neo（默认 `http://localhost:7860`，需以 `--api` 启动）的 `/sdapi/v1/img2img` 端点调用图生图，以角色卡 PNG 中提取的基底图片为输入，配合情绪提示词与 ADetailer 面部一致性修复，自动生成角色卡表情包。本节为 Task 1 已落地的服务层；IPC 处理器（§14.15）/ UI（§14.17）/ 设置项（§14.16）在后续 Task 完成
- **单例导出**：`export const sdGenerationService = new SDGenerationService();`，与 `expressionService` / `avatarService` 风格一致
- **HTTP 实现**：使用 Node.js 内置 `fetch`（Node 18+ 原生，本项目运行于 Node 24），不引入 axios 等额外依赖。封装 `fetchWithTimeout(url, init, timeoutMs)` 基于 `AbortController` 实现单次请求超时
- **错误识别**：`fetchWithTimeout` 区分三类错误：
  - `AbortError` → 友好提示「请求超时（Xs）」
  - `TypeError`（fetch 网络错误，如连接被拒绝/DNS 失败）→ 友好提示「无法连接到 SD WebUI，请确认 Forge Neo 已启动且开启了 --api 参数」
  - 其他错误原样抛出
- **公共方法**（全部返回结构化对象，永不抛异常给调用方）：
  - `checkStatus(endpoint): Promise<SDStatusResult>` —— GET `/sdapi/v1/options`，返回 `{ available, currentModel }`（`currentModel` 来自 `options.sd_model_checkpoint`）。短超时 10s
  - `getModels(endpoint): Promise<{ success, models: SDModel[], error? }>` —— GET `/sdapi/v1/sd-models`，返回模型清单。短超时 10s
  - `extractBaseImage(characterCardPath): Promise<{ success, imageBase64?, error? }>` —— `fsSync.readFileSync` + `Buffer.toString('base64')`，角色卡 PNG 文件本身就是基底图片（tEXt chunk 仅含 JSON 元数据，无需解析），返回不含 `data:image/png;base64,` 前缀的 base64
  - `generateExpression(params): Promise<SDGenerationResult>` —— POST `/sdapi/v1/img2img`，超时 120s（SDXL 28 步 + ADetailer 较慢）。`params = { endpoint, baseImageBase64, prompt, negativePrompt, options? }`
  - `cancelGeneration(endpoint): Promise<void>` —— POST `/sdapi/v1/interrupt`，发送中断信号。仅记录日志，不抛异常（取消失败不影响调用方主流程）
- **img2img 请求体**（与 Spec 关键参数表一致，2026-07-27 更新 ADetailer args 字段名以兼容 ADetailer-Neo）：
  ```
  { init_images: [baseImageBase64], prompt, negative_prompt,
    denoising_strength: 0.55, steps: 28, cfg_scale: 7,
    width: 512, height: 512, sampler_name: "DPM++ 2M Karras",
    batch_size: 1, n_iter: 1,
    alwayson_scripts: { ADetailer: { args: [
      true,  // args[0]: enable
      { ad_model: "face_yolov8n.pt", ad_prompt: <同主提示词>,
        ad_negative_prompt: <同主负面>, ad_confidence: 0.3,
        ad_denoising_strength: 0.4, ad_mask_blur: 4, ad_dilate_erode: 4,
        ad_inpaint_only_masked: true, ad_inpaint_only_masked_padding: 32,
        // 可选独立采样参数（仅当 ad_use_* 开关为 true 时才写入）
        // ad_use_inpaint_width_height: true, ad_inpaint_width: 512, ad_inpaint_height: 512,
        // ad_use_steps: true, ad_steps: 20,
        // ad_use_cfg_scale: true, ad_cfg_scale: 4.0,
        // ad_use_sampler: true, ad_sampler: "DPM++ SDE Karras"
      }
    ] } } }
  ```
  - `alwayson_scripts.ADetailer` 仅在 `options.adetailerEnabled !== false` 时包含（默认启用）
  - 若 `options.model` 提供，先 POST `/sdapi/v1/options` 切换模型；切换失败则直接返回错误，不进行生成
  - 默认值常量：`DEFAULT_ENDPOINT` / `DEFAULT_DENOISING_STRENGTH=0.55` / `DEFAULT_STEPS=28` / `DEFAULT_CFG_SCALE=7` / `DEFAULT_WIDTH=512` / `DEFAULT_HEIGHT=512` / `DEFAULT_SAMPLER="DPM++ 2M Karras"` / `GENERATION_TIMEOUT_MS=120_000` / `SHORT_TIMEOUT_MS=10_000` / `ADETAILER_MODEL="face_yolov8n.pt"` / `ADETAILER_CONFIDENCE=0.3` / `ADETAILER_DENOISING_STRENGTH=0.4` / `ADETAILER_MASK_BLUR=4` / `ADETAILER_DILATE_ERODE=4` / `ADETAILER_INPAINT_ONLY_MASKED=true` / `ADETAILER_INPAINT_ONLY_MASKED_PADDING=32`
- **【重点标记 - ADetailer-Neo 兼容性修复（2026-07-27）】** ADetailer args dict 字段名严格对齐 `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs` 定义（pydantic `ConfigDict(extra="forbid")`，禁止未定义字段）：
  - 移除 `ad_inpaint_full_res`（Neo 已移除，改用 `ad_use_inpaint_width_height` + `ad_inpaint_width/height`）
  - `ad_dilation` → `ad_dilate_erode`（原拼写错误）
  - 新增 `ad_inpaint_only_masked_padding` / `ad_confidence` / `ad_dilate_erode` / `ad_mask_blur`
  - 可选独立采样参数（仅当对应的 `ad_use_*` 开关为 true 时才写入 args dict）：`ad_use_inpaint_width_height` + `ad_inpaint_width/height` / `ad_use_steps` + `ad_steps` / `ad_use_cfg_scale` + `ad_cfg_scale` / `ad_use_sampler` + `ad_sampler`
  - `SDGenerationOptions` 接口新增 16 个 ADetailer 高级参数字段（`adModel` / `adConfidence` / `adDenoisingStrength` / `adMaskBlur` / `adDilateErode` / `adInpaintOnlyMasked` / `adInpaintOnlyMaskedPadding` / `adUseInpaintWidthHeight` / `adInpaintWidth` / `adInpaintHeight` / `adUseSteps` / `adSteps` / `adUseCfgScale` / `adCfgScale` / `adUseSampler` / `adSampler`）
- **响应解析**：取 `data.images[0]`（base64 字符串，不含 data: 前缀）；非数组 / 空数组 / 非字符串 均视为失败并返回具体错误信息
- **类型导出**：`SDModelType`（`'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2'`）/ `SDModelTypePreset`（模型类型推荐参数）/ `MODEL_TYPE_PRESETS`（4 种模型类型的预设参数 Record）/ `detectModelType(modelName): SDModelType`（根据模型文件名自动检测模型类型）/ `SDGenerationOptions`（含 `modelType?` + 16 个 ADetailer 高级参数字段 + `selectedLoras?` LoRA 模型列表）/ `SDGenerationResult` / `SDStatusResult` / `SDModel` / `SDGenerateParams`
- **【重点标记 - SD 模型类型与自动检测（Spec: NL-SD-Model-Integration / Task 1，2026-07-28 新增）】** 新增 `SDModelType` 类型与 `detectModelType` 函数，支持根据模型文件名自动识别模型类型（qwen-image / qwen-image-edit / flux2 / sdxl 默认兜底）。`MODEL_TYPE_PRESETS` 为每种模型类型提供推荐参数预设（endpoint / denoising / steps / cfgScale / sampler / adetailerEnabled / width / height）。`SDGenerationOptions` 新增 `modelType?: SDModelType` 字段（位于 `model` 字段之后），供调用方显式指定模型类型或由上游自动检测后传入。
- **日志前缀**：`[SDGenerationService]`，与 `[ExpressionService]` / `[AvatarService]` 一致使用 `console.log/error`
- **文件**：`src/main/services/sdGenerationService.ts`（新建，~370 行 → 2026-07-27 扩展至 ~440 行 → 2026-07-27 Task 4 新增 `{traits}` 占位符替换逻辑 → 2026-07-28 Task 1 新增 SD 模型类型定义与自动检测 → 2026-07-28 Task 7 新增 LoRA 标签注入逻辑）
- **tsc 验证**：`npx tsc --noEmit` 通过，`sdGenerationService.ts` 无新增 TypeScript 错误（仓库其他 tsc 错误均属预存问题，与本服务无关）
- **【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 4）】** `SDGenerationOptions` 新增 `characterTraits?: string[]` 字段，`generateExpression` 中读取该字段并替换 prompt 中的 `{traits}` 占位符（使用函数形式 replace 避免 `$` 特殊字符干扰），空数组/undefined 替换为空字符串并清理多余逗号与空格（循环 `replace(/,\s*,/g, ',')` 直至收敛 + 清理开头/结尾逗号）。ADetailer 的 `ad_prompt` 同步使用已注入特征的最终 prompt，保证面部修复也携带角色特征。`{traits}` 占位符由上游 `PromptBuilder.buildExpressionGenerationPrompt`（Task 5）写入到 `positivePromptTemplate` 中。
- **【LoRA 模型标签注入（Spec: lora-model-selection / Task 7，2026-07-28 新增）】** `SDGenerationOptions` 新增 `selectedLoras?: Array<{ name: string; weight: number }>` 字段。`generateExpression` 在 `{traits}` 占位符替换与清理之后、模型类型分流之前，将 `selectedLoras` 转为 `<lora:name:weight>` 标签并注入到 prompt 前部（如 `<lora:character_style:0.8> portrait, ...`）。Forge Neo 的 prompt parser 自动解析 `<lora:...>` 标签并加载对应 LoRA 文件。空数组/undefined 时不注入。注入位置在模型类型分流之前，确保 txt2img 与 img2img 路径均生效。

### 14.15 SD 表情生成 IPC 处理器（Spec: add-ai-expression-generation / Task 2，2026-07-27 新增）

- **能力**：主进程 IPC 处理器层，将 `sdGenerationService` 的 5 个能力通过 `ipcMain.handle` 暴露给渲染进程，并提供批量生成的进度推送与取消机制。与 `expressionHandlers.ts` 注册模式一致，导出 `registerSdGenerationHandlers()` 函数在 `setupIpcHandlers()` 中调用
- **通道列表**：
  - `sd:checkStatus` —— args: `{ endpoint: string }` → `sdGenerationService.checkStatus(endpoint)`，返回 `{ available, currentModel?, error? }`
  - `sd:getModels` —— args: `{ endpoint: string }` → `sdGenerationService.getModels(endpoint)`，返回 `{ success, models, error? }`
  - `sd:generateExpression` —— args: `{ characterCardPath, emotionKey, prompt, negativePrompt, options? }` → 先 `extractBaseImage` 再 `generateExpression`，返回 `{ success, imageBase64?, error? }`
  - `sd:generateAllExpressions` —— args: `{ characterCardPath, emotions: Array<{ key, prompt, negativePrompt }>, options? }` → 循环生成，通过 `event.sender.send` 推送进度，返回 `{ success, total, successCount, failedCount, cancelledCount }`
  - `sd:cancelGeneration` —— 设置模块级 `isCancelled = true`，返回 `{ success: true }`
- **事件推送**（通过 `event.sender.send` 主动推送给渲染进程，使用 `safeSend` 包装避免窗口销毁后抛错，模式参照 `gameNarrativeHandlers.ts`）：
  - `sd:generationProgress` —— `{ current, total, emotionKey, status: 'success'|'failed', error?, imageBase64? }`
  - `sd:generationComplete` —— `{ total, success, failed, cancelled }`
- **批量生成流程**：
  1. 重置 `isCancelled = false`（每个新批次开始时）
  2. 调用 `extractBaseImage(characterCardPath)` 一次（所有情绪共用基底图片）
  3. 循环 `emotions` 数组，每次迭代前检查 `isCancelled`：若为 true 则 break，剩余未处理的记入 `cancelled`
  4. 每个情绪调用 `generateExpression`，成功/失败后通过 `sd:generationProgress` 推送进度
  5. 全部完成后通过 `sd:generationComplete` 推送汇总
- **取消机制**：模块级 `isCancelled` 标志位（非 AbortController），`cancelGeneration` 设置为 true，`generateAllExpressions` 在下次循环检查时退出。注意：当前正在进行的 img2img HTTP 请求无法被外部 abort（由 120s 超时兜底），取消仅阻止后续未处理的情绪继续生成
- **Preload 暴露**：`window.electronAPI.sd.*` 命名空间，包含 `checkStatus` / `getModels` / `generateExpression` / `generateAllExpressions` / `cancelGeneration` / `onGenerationProgress` / `onGenerationComplete` / `removeProgressListeners`
- **类型声明**：`src/renderer/types/electron.d.ts` 中 `sd` 命名空间，`options` 字段使用 `any`（实际类型为 `SDGenerationOptions`，因主进程类型不可直接被渲染进程引用）
- **⚠️ 重要说明（Task 6 合并）**：Task 6 初期曾创建 `sdHandlers.ts`（仅暴露 `sd:checkStatus` / `sd:getModels`，使用裸字符串 `endpoint` 作为参数）。发现与 Task 2 的 `sdGenerationHandlers.ts` 通道冲突后，已**删除 `sdHandlers.ts`**，统一由 `sdGenerationHandlers.ts` 提供全部 5 个通道。`index.ts` 中 `registerSDHandlers()` 调用被替换为 `registerSdGenerationHandlers()`。`checkStatus` / `getModels` 的 IPC handler 参数为 `{ endpoint }` 对象，但 preload 内部包装使渲染进程仍可使用裸字符串调用（`window.electronAPI.sd.checkStatus(endpoint)` → `ipcRenderer.invoke('sd:checkStatus', { endpoint })`）
- **文件**：
  - `src/main/ipc/handlers/sdGenerationHandlers.ts`（新建，~280 行）
  - `src/main/ipc/index.ts`（修改：替换 `registerSDHandlers` → `registerSdGenerationHandlers`）
  - `src/main/preload.ts`（修改：`sd` 命名空间扩展为完整 8 方法版本）
  - `src/renderer/types/electron.d.ts`（修改：`sd` 类型声明扩展为完整版本）
- **tsc 验证**：`npx tsc --noEmit` 通过，4 个文件无新增 TypeScript 错误

### 14.16 SD WebUI 设置面板（Spec: add-ai-expression-generation / Task 6，2026-07-27 新增；2026-07-27 扩展采样器与 ADetailer 高级参数；2026-07-28 Task 2 新增模型类型选择与 NL 模型支持；2026-07-28 Task 1+8 新增 LoRA 模型选择字段与持久化）

- **能力**：在 Settings 页面新增「Stable Diffusion 设置」区块，允许用户配置 SD WebUI 连接参数与 img2img 生成参数，持久化到 `AppSetting.sdWebui`。与 `VectorConfigPanel` 同样使用 `forwardRef + useImperativeHandle` 模式，父组件 `Settings.tsx` 通过 `ref.current.getFormValues()` 在 `handleSave` 时合并到 `updatedSetting.sdWebui`
- **配置项**（与 `SDWebuiConfig` 接口字段一一对应）：
  - **端点 URL**（`endpoint`）：`Input`，默认 `http://localhost:7860`（Forge Neo 默认端口，需 `--api` 启动）
  - **连接测试**按钮：调用 `window.electronAPI.sd.checkStatus(endpoint)`，结果通过 `Alert` 显示当前模型 checkpoint / 错误信息
  - **模型**（`model`）：`Select` 下拉，选项来自 `window.electronAPI.sd.getModels(endpoint)`，含「使用当前」选项（空字符串值）。配「获取模型列表」按钮触发拉取
  - **模型类型**（`modelType`）：`Select` 下拉（Spec: integrate-nl-driven-sd-models / Task 2 新增），4 个选项：SDXL (img2img + ADetailer) / Qwen-Image (txt2img) / Qwen-Image-Edit (img2img, 推荐用于表情生成) / Flux2 (txt2img/img2img)。配「自动检测」按钮，根据当前模型名调用 `detectModelTypeFromName` 推断类型。切换模型类型时自动填充推荐参数（denoisingStrength/steps/cfgScale/sampler/adetailerEnabled/txt2imgWidth/txt2imgHeight）
  - **txt2img 输出宽高**（`txt2imgWidth` / `txt2imgHeight`）：`InputNumber` 64-2048，仅当 modelType 为 `qwen-image` 或 `flux2`（txt2img 模式）时显示，默认 1024
  - **Denoising Strength**（`denoisingStrength`）：`Slider` 0.1-1.0，步进 0.05，默认 0.55。【重点标记 - 范围扩展】Task 2 将 max 从 0.9 扩展至 1.0，以支持 qwen-image (1.0) 与 qwen-image-edit (0.95) 的推荐去噪强度
  - **qwen-image-edit 去噪警告**：当 modelType 为 `qwen-image-edit` 且 denoisingStrength < 0.9 时，显示 `Alert type="warning"` 提示推荐 denoising ≥ 0.9
  - **Steps**（`steps`）：`InputNumber` 1-100，默认 28（SDXL 推荐）
  - **CFG Scale**（`cfgScale`）：`InputNumber` 1-20，步进 0.5，默认 7
  - **Sampling Method 采样器**（`sampler`）：`AutoComplete` 控件，10 个 SDXL 推荐采样器预设（DPM++ 2M Karras 等）+ 自由输入自定义采样器名。【重点标记 - 采样器可配置】早期版本缺失此字段导致采样器固定无法更改
  - **ADetailer 面部修复**（`adetailerEnabled`）：`Switch`，默认开启。**仅当 modelType 为 `sdxl` 时显示**（Spec: integrate-nl-driven-sd-models / Task 2 条件渲染）
  - **NL 提示词模板**（`nlPromptTemplate`）：`Input.TextArea`，支持 `{traits}` 与 `{emotion}` 占位符。**仅当 modelType 不为 `sdxl` 时显示**（NL 驱动模型使用自然语言提示词而非 tag 格式）。默认：`'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.'`
  - **正面提示词模板**（`positivePromptTemplate`）：`Input.TextArea`，支持 `{traits}` 与 `{emotion}` 两个占位符。【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】`{traits}` 由 `PromptBuilder.buildExpressionGenerationPrompt` 替换为角色视觉特征 tag 字符串（来自 `characterTraitStore`，如 `white fur, dog girl`），特征为空时替换为空字符串并清理多余逗号；`{emotion}` 替换为情绪专用提示词。默认模板：`'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face'`（{traits} 放在 portrait 之后确保角色特征优先）。旧配置兼容：若用户模板不含 `{traits}` 占位符，特征 tag 会在 prompt 开头追加（不破坏旧模板）
  - **自定义负面提示词**（`customNegativePrompt`）：`Input.TextArea`，可选；留空使用 `PromptBuilder.buildExpressionGenerationPrompt` 默认负面提示词
  - **【重点标记 - ADetailer 高级参数折叠面板（2026-07-27 新增；2026-07-28 Task 2 条件渲染：仅 modelType 为 `sdxl` 时显示）】** `Collapse` 折叠面板，暴露全套 ADetailer-Neo 支持的参数（字段名严格对齐 `ADetailerArgs`）：
    - **检测模型**（`adModel`）：`AutoComplete`，9 个预设（face_yolov8n.pt 默认 / face_yolov8s.pt 精度更高 / hand_yolov8n.pt 手部 / person_yolov8n-seg.pt 全身 / mediapipe_face_* 真实人脸）+ 自由输入
    - **检测置信度**（`adConfidence`）：`Slider` 0-1，步进 0.05，默认 0.3
    - **面部修复去噪强度**（`adDenoisingStrength`）：`Slider` 0-1，步进 0.05，默认 0.4
    - **Mask 模糊**（`adMaskBlur`）：`InputNumber` 0-20，默认 4
    - **Mask 膨胀/腐蚀**（`adDilateErode`）：`InputNumber` -20~20，默认 4（正值膨胀/负值腐蚀）
    - **仅修复 Mask 区域**（`adInpaintOnlyMasked`）：`Switch`，默认 true
    - **Mask Padding**（`adInpaintOnlyMaskedPadding`）：`InputNumber` 0-128，默认 32
    - **独立修复尺寸开关 + 宽高**（`adUseInpaintWidthHeight` / `adInpaintWidth` / `adInpaintHeight`）：`Switch` + 两个 `InputNumber`（64-2048，默认 512）
    - **独立步数开关 + 步数**（`adUseSteps` / `adSteps`）：`Switch` + `InputNumber`（1-150，默认 20）
    - **独立 CFG 开关 + CFG**（`adUseCfgScale` / `adCfgScale`）：`Switch` + `InputNumber`（1-24，默认 4.0）
    - **独立采样器开关 + 采样器**（`adUseSampler` / `adSampler`）：`Switch` + `AutoComplete`（默认 "Use same sampler"）
- **预设常量**：`SAMPLER_OPTIONS`（10 个采样器）、`ADETAILER_MODEL_OPTIONS`（9 个检测模型）、`MODEL_TYPE_PRESETS`（4 种模型类型推荐参数，与 `sdGenerationService` 内联一致）、`detectModelTypeFromName`（模型名→类型推断，与 `sdGenerationService.detectModelType` 逻辑一致）
- **条件渲染**（Spec: integrate-nl-driven-sd-models / Task 2）：使用 `Form.useWatch('modelType', form)` 监听模型类型（默认 `'sdxl'`），`Form.useWatch('denoisingStrength', form)` 监听取噪强度：
  - **modelType === 'sdxl'**：显示 ADetailer 面部修复开关 + ADetailer 高级参数折叠面板
  - **modelType !== 'sdxl'**：显示 NL 提示词模板 TextArea，隐藏 ADetailer 相关 UI
  - **modelType 为 `qwen-image` 或 `flux2`**：显示 txt2img 输出宽高 InputNumber
  - **modelType 为 `qwen-image-edit` 且 denoisingStrength < 0.9**：显示去噪强度警告 Alert
- **数据流**：
  - **加载**：`useSettingStore().setting.sdWebui` → `useEffect` → `form.setFieldsValue(...)`（合并 `DEFAULT_SD_WEBUI_CONFIG` 兜底旧配置无 `sdWebui` 字段或新字段缺失的场景）
  - **保存**：`Settings.tsx:handleSave` → `sdWebuiConfigRef.current.getFormValues()` → 合并到 `updatedSetting.sdWebui` → `saveSetting(updatedSetting)` → `window.electronAPI.setting.save()`。【重点标记 - selectedLoras 持久化（Spec: lora-model-selection / Task 8，2026-07-28 新增）】`getFormValues()` 中 `selectedLoras` 不在表单中编辑（由 LoRA 选择 Modal 设置），`form.getFieldsValue(true)` 可能不返回此字段。因此在 `getFormValues` 返回值中显式从 `setting.sdWebui.selectedLoras` 合并，确保已持久化的 LoRA 选择在保存时不丢失。合并顺序：`DEFAULT_SD_WEBUI_CONFIG` → `selectedLoras`（来自 setting）→ `values`（来自表单），确保表单值优先级最高。
- **类型定义**：`SDWebuiConfig` 接口定义于 `src/renderer/types/setting.ts`（含 `sampler` + 16 个 ADetailer 高级参数字段 + NL 模型相关字段 `modelType` / `nlPromptTemplate` / `txt2imgWidth` / `txt2imgHeight` + `selectedLoras?` LoRA 模型列表），`AppSetting.sdWebui?: SDWebuiConfig`（可选字段，旧配置无此字段时使用默认值）
- **默认值**：`src/shared/settings.ts` 中 `defaultSetting.sdWebui` 与 `sdGenerationService` 默认参数一致（`denoisingStrength=0.55` / `steps=28` / `cfgScale=7` / `sampler="DPM++ 2M Karras"` / `adetailerEnabled=true` + 全套 ADetailer 默认值 + NL 模型默认值 `modelType='sdxl'` / `nlPromptTemplate='A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.'` / `txt2imgWidth=1024` / `txt2imgHeight=1024` / `selectedLoras=[]`）
- **与 `sdGenerationService` 的关系**：设置项中的 `denoisingStrength` / `steps` / `cfgScale` / `sampler` / `adetailerEnabled` + 16 个 ADetailer 高级参数对应 `SDGenerationOptions` 同名字段；`endpoint` / `model` 用于连接与模型切换；`customNegativePrompt` 在生成时与 `PromptBuilder` 默认负面提示词合并
- **UI 风格**：与 `PathSettingsPanel` / `AIEngineSettingsPanel` 一致使用 `Card` + `Form layout="vertical"`，顶部含 `rgba(99, 102, 241, 0.08)` 背景的说明条；ADetailer 高级参数区使用 `Collapse ghost` 折叠面板（默认折叠），内部 `Alert type="info"` 说明字段名兼容性
- **文件**：
  - `src/renderer/components/Settings/SDWebuiSettings.tsx`（新建，~300 行 → 2026-07-27 扩展至 ~700 行 → 2026-07-28 Task 2 扩展至 ~870 行，新增模型类型选择 / NL 提示词模板 / txt2img 尺寸 / 条件渲染）
  - `src/renderer/components/Settings/Settings.tsx`（修改：import + ref 声明 + JSX 渲染 + `handleSave` 合并 `sdWebuiConfig`）
  - `src/renderer/types/setting.ts`（修改：新增 `SDWebuiConfig` 接口含 `sampler` + 16 个 ADetailer 字段 + `AppSetting.sdWebui?` 字段）
  - `src/shared/settings.ts`（修改：`defaultSetting.sdWebui` 默认配置块含全部新字段）
- **tsc 验证**：`npx tsc --noEmit` 通过，`SDWebuiSettings.tsx` / `Settings.tsx` / `setting.ts` / `settings.ts` 均无新增 TypeScript 错误（仓库其他 tsc 错误均属预存问题，与本 Task 无关；Task 2 / Task 1+8 同样无新增错误）

### 14.17 AI 表情生成弹窗 ExpressionGenerateModal（Spec: add-ai-expression-generation / Task 4，2026-07-27 新增）

- **能力**：渲染进程侧的 AI 表情生成弹窗组件，通过 Stable Diffusion WebUI img2img 自动生成角色卡表情图片。支持两种模式：
  - **batch 模式**：一次性生成全部 30 个预置情绪（`EMOTION_PRESETS`）的表情图片，带实时进度条与统计（成功 / 失败 / 跳过），每张生成成功后立即调用 `expressionStore.saveExpression` 保存到磁盘
  - **single 模式**：生成单个情绪表情，提供提示词预览 + 生成中 loading + 结果预览 + 保存 / 重新生成 / 关闭按钮
- **Props 接口**（Task 5 将 import 此 interface）：
  ```typescript
  export interface ExpressionGenerateModalProps {
    open: boolean;
    characterCardId: string;          // = 角色卡 PNG 文件路径
    characterName: string;
    avatarPath?: string;              // 顶部预览用
    mode: 'batch' | 'single';
    targetEmotionKey?: string;        // single 模式必需
    targetEmotionLabel?: string;      // 自定义情绪的中文标签
    onClose: () => void;
    onGenerated?: () => void;         // 完成后回调（父组件刷新 store / UI）
  }
  ```
- **打开时初始化**（`useEffect` 监听 `open + characterCardId`）：
  1. 加载 SD 设置：`window.electronAPI.setting.load()` → `setting.sdWebui`（含 `endpoint` / `denoisingStrength` / `steps` / `cfgScale` / `adetailerEnabled` / `customNegativePrompt` / `model`），缺失字段以 `DEFAULT_SD_CONFIG` 兜底
  2. 加载角色卡描述：`window.electronAPI.character.read(characterCardId)` → `data.description`（用于 `buildExpressionGenerationPrompt` 的 `charDescription` 参数）
  3. 检测 SD 状态：`window.electronAPI.sd.checkStatus(endpoint)` → 更新 `sdStatus`（`available` / `unavailable` / `checking`），不可用时展示 `Alert` 含启动 Forge Neo `--api` 参数的指引
- **【重点标记 - characterCardId 即文件路径】** `characterCardId` prop 实际是角色卡 PNG 文件绝对路径字符串，既是表情 manifest 的 key（经 `expressionService.sanitizeCardId` 哈希后作为目录名），也是 SD 生成时提取基底图片的源文件路径。本组件直接将其作为 `characterCardPath` 传给 `sd:generateExpression` / `sd:generateAllExpressions` IPC，无需额外转换
- **【重点标记 - SD 返回的 base64 不含 data URI 前缀】** `sdGenerationService.generateExpression` 返回的 `imageBase64` 是裸 base64 字符串（不含 `data:image/png;base64,` 前缀）。本组件在收到 base64 后立即拼接 `PNG_DATA_URI_PREFIX` 存入 state（用于 `<img src>` / antd `<Image src>` 展示）；保存时直接传入带前缀的 data URL，`expressionService.saveImage` 内部会剥离前缀（已实现 `imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '')`）
- **批量生成流程**：
  1. 清理旧监听器：`window.electronAPI.sd.removeProgressListeners()`（避免重复监听）
  2. 重置统计：`statsRef.current = { success: 0, failed: 0, skipped: 0 }`，`setBatchStage('generating')`
  3. 为全部 30 个预置情绪构建提示词：`EMOTION_PRESETS.map(({ key, label }) => buildEmotionPrompt(key, label))`，每个情绪调用 `PromptBuilder.buildExpressionGenerationPrompt(charDescription, key, label)` 并合并 `customNegativePrompt`
  4. 注册进度监听：
     - `onGenerationProgress(data)` → 更新 `batchProgress` + 累计统计；若 `status === 'success'` 且 `imageBase64` 非空，**立即**调用 `saveExpression(characterCardId, emotionKey, dataUrl, false)` 保存（不等全部完成）
     - `onGenerationComplete(data)` → 更新 `batchSummary` + `setBatchStage('complete' | 'cancelled')` + `loadExpressions(characterCardId)` 刷新 store + `onGenerated?.()` + `removeProgressListeners()` 清理
  5. 启动生成：`await window.electronAPI.sd.generateAllExpressions({ characterCardPath, emotions, options })`；Promise resolve 时进度事件通常已全部推送完毕，仅 await 以捕获启动异常
- **单个生成流程**：
  1. 找到情绪标签：先查 `EMOTION_PRESETS` 取 `label`，否则用 `targetEmotionLabel` 兜底
  2. 构建提示词：`buildExpressionGenerationPrompt(charDescription, targetEmotionKey, customLabel)` + 合并 `customNegativePrompt`
  3. 调用 IPC：`await window.electronAPI.sd.generateExpression({ characterCardPath, emotionKey, prompt, negativePrompt, options })`
  4. 成功 → 拼接 data URI 前缀存入 `generatedImage`，`setSingleStage('success')`，展示 256×256 预览（antd `Image` 支持点击放大）
  5. 失败 → `setSingleError(result.error)`，`setSingleStage('failed')`，提供「重新生成」按钮
  6. 保存：判断 `isCustom = !EMOTION_PRESETS.some(e => e.key === targetEmotionKey)`，调用 `saveExpression(characterCardId, targetEmotionKey, generatedImage, isCustom, label)` → 成功后 `loadExpressions` 刷新 + `onGenerated?.()` + `onClose()`
- **取消机制**：批量生成中点击「取消生成」→ `window.electronAPI.sd.cancelGeneration()` → 模块级 `isCancelled` 标志位（非 AbortController），下次循环检查时退出。注意：当前正在进行的 img2img HTTP 请求无法被外部 abort（由 120s 超时兜底），取消仅阻止后续未处理的情绪继续生成
- **IPC 监听器清理**：组件卸载 `useEffect` cleanup 调用 `window.electronAPI.sd.removeProgressListeners()`，避免组件销毁后仍收到事件导致 setState on unmounted component 警告；批量生成完成 / 异常时也会调用清理
- **提示词构建复用**：`PromptBuilder.buildExpressionGenerationPrompt(charDescription, emotionKey, customLabel?)` 已由 Task 3 实现，本组件仅负责调用与合并 `customNegativePrompt`，不重复实现提示词逻辑
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量（`var(--text-primary)` / `var(--primary-color)` / `var(--chat-bubble-assistant-bg)` 等），参照 `ExpressionManagerModal.tsx`；主操作按钮使用渐变背景 `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)` 与 `ExpressionManagerModal` 的「添加自定义情绪」按钮一致
- **antd 组件使用**：`Modal` / `Progress`（active 状态 + 渐变 `strokeColor`）/ `Button` / `Alert`（错误提示 + 信息说明）/ `Spin` / `Image`（结果预览，支持点击放大）/ `Input.TextArea`（提示词预览，readonly）/ `Tag`（SD 状态指示器 + 参数概览）/ `Space` / `Tooltip`
- **图标**：`ThunderboltOutlined`（生成按钮）/ `RobotOutlined`（重新生成）/ `CheckCircleOutlined`（完成 / 成功）/ `CloseCircleOutlined`（失败 / 取消）/ `LoadingOutlined`（检测中 / 生成中）/ `SettingOutlined`（默认状态）
- **文件**：
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`（新建，约 870 行）
- **tsc 验证**：`npx tsc --noEmit` 通过，`ExpressionGenerateModal.tsx` 无新增 TypeScript 错误（仓库 777 个 tsc 错误均属预存问题，与本 Task 无关）
- **后续依赖**：Task 5 将在 `ExpressionManagerModal.tsx` 中添加「AI 生成全部表情」按钮（顶部工具栏，`ThunderboltOutlined`）与每个情绪格子的「AI 生成」按钮（`RobotOutlined`），点击后 import 本组件并传入对应 props

### 14.18 素材与特征管理弹窗 AssetManagerModal（Spec: add-asset-and-trait-management / Task 9，2026-07-27 新增）

- **能力**：渲染进程侧的多 Tab 素材管理弹窗组件，**重构自 `ExpressionManagerModal.tsx`**——原弹窗仅管理表情，重构后内部 5 个 Tab 统一管理角色的全部视觉素材与特征：
  1. **表情**（`ExpressionTabContent`）：复用 `ExpressionManagerModal` 的表情网格逻辑（30 预置情绪 + 自定义情绪网格 + 上传/删除/裁剪流程 + 添加自定义情绪表单）
  2. **角色立绘**（`AssetGridTabContent`，`assetType='illustration'`）：素材网格 + 上传 + 删除，`assetId` 前缀 `ill_`
  3. **一般图像**（`AssetGridTabContent`，`assetType='general'`）：素材网格 + 上传 + 删除，`assetId` 前缀 `gen_`
  4. **三视图**（`ThreeViewTabContent`，`assetType='three-view'`）：三个固定槽位（正面/侧面/背面）独立展示与操作，`assetId` 直接使用 slot 名 `front`/`side`/`back`
  5. **角色特征**（`CharacterTraitTabContent`）：特征 Tag 编辑器（antd `Tag` + `Input` + 添加/删除/编辑 + 保存按钮）
- **Props 接口**（与 `ExpressionManagerModal` 一致 + 扩展 3 个可选字段）：
  ```typescript
  interface AssetManagerModalProps {
    open: boolean;
    characterCardId: string;
    characterName: string;
    characterDescription?: string;  // 新增，供 Task 13 AI 特征生成使用
    characterPersonality?: string;  // 新增
    characterScenario?: string;     // 新增
    avatarPath?: string;
    onClose: () => void;
  }
  ```
- **顶层结构**：`<Modal>`（width=960）+ `<Tabs>`（5 个 Tab，使用 antd v6 `items` API，默认激活 `expression`）。打开时（`open=true && characterCardId` 非空）`useEffect` 并行触发统一加载：
  - `expressionStore.loadExpressions(characterCardId)`
  - `assetStore.loadAssets(characterCardId, 'illustration' | 'general' | 'three-view')`（三次调用）
  - `characterTraitStore.loadTraits(characterCardId)`
  - 各子组件内部也兜底调用各自的 load（防止单独使用时未加载）
- **表情 Tab（ExpressionTabContent）**：从 `ExpressionManagerModal.tsx` 复制核心逻辑后适配为 Tab 内主体（去除外层 Modal），完整复用：
  - 30 预置情绪 + 自定义情绪网格（`EMOTION_PRESETS` + `manifest.customEmotions`）
  - 上传流程：隐藏 file input → `FileReader` → `ImageCropperModal` → `saveExpression(characterCardId, emotionKey, croppedDataUrl, isCustom, label?)`
  - 删除流程：`Modal.confirm` → `deleteExpression`；自定义情绪类别移除走 `removeCustomEmotion`
  - 添加自定义情绪表单：key 校验 `^[a-z][a-z0-9_]*$` + label 非空 + 与预置/已有 keys 不冲突 → `addCustomEmotion`
  - AI 生成入口（`handleBatchGenerate` / `handleSingleGenerate`）：**placeholder**，`message.info('AI 生成功能将在后续接入')`，TODO 标注「Task 11 接入 AssetGenerateModal」
- **素材网格 Tab（AssetGridTabContent）**：参数化 `assetType`，立绘 Tab 传 `'illustration'`、一般图像 Tab 传 `'general'`：
  - 素材网格：从 `assetStore.manifests[assetType]` 读取 `assets`，每个素材的缩略图从 `imageCache[assetType][assetId]` 读取 data URL（3:4 aspect ratio 缩略图）
  - 上传流程：file input → `FileReader` → `ImageCropperModal` → `saveAsset({characterCardId, assetType, assetId, imageBase64})`
    - `assetId` 生成：`{idPrefix}_{Date.now()}_{random}`（如 `ill_1722078400000_abc123`），保证唯一性
  - 删除流程：`Modal.confirm` → `deleteAsset({characterCardId, assetType, assetId})`
  - AI 生成按钮：**placeholder**（同表情 Tab，TODO「Task 11 接入」）
  - 空状态：`<Empty>` + 「上传第一张{tabLabel}」按钮
- **三视图 Tab（ThreeViewTabContent）**：三个固定槽位（`THREE_VIEW_SLOTS = [{slot:'front',label:'正面'}, {slot:'side',label:'侧面'}, {slot:'back',label:'背面'}]`）：
  - 每个槽位独立展示：有图显示缩略图 + 删除按钮；无图显示占位 + 上传按钮 + AI 生成按钮（placeholder）
  - 上传流程：`ImageCropperModal` → `saveAsset({characterCardId, assetType:'three-view', assetId:slot, imageBase64, slot})`（`assetId` 直接使用 slot 名，保持槽位固定）
  - 删除流程：`deleteAsset({characterCardId, assetType:'three-view', assetId:slot})`
  - 三个槽位互不影响，独立上传/删除
  - 渲染：3 列 grid，每个槽位卡片含标签 + 3:4 缩略图 + 操作按钮行
- **角色特征 Tab（CharacterTraitTabContent）**：特征 Tag 编辑器，绑定 `characterTraitStore`：
  - 顶部工具栏：「AI 生成特征」按钮（placeholder，TODO「Task 13 接入」）+ 「保存」按钮（`saveTraits(characterCardId, traits)` 持久化，乐观更新 + 失败回滚）
  - 特征列表：antd `Tag`（closable）展示每个特征，点击 X 删除（`removeTrait(index)`）
  - 添加特征：底部 `Input` + 「添加」按钮（`addTrait(trait)`，trim 后非空且不重复才追加）
  - 编辑特征：点击 Tag 文字进入编辑态（渲染 `<input>` 替代 Tag）+ 回车保存（`updateTrait(index, newValue)`）+ Esc 取消 + 失焦自动保存
  - 空状态：`<Empty>` + 「AI 生成特征」引导按钮
  - 打开 Tab 时 `useEffect` 调 `loadTraits(characterCardId)`
  - **预留参数**：`characterDescription` / `characterPersonality` / `characterScenario` 解构后通过 `void` 标记为已使用（避免 TS6133），Task 13 接入 AI 生成时将用于构建提示词
- **复用 ImageCropperModal**：4 个素材/表情相关 Tab 各自独立维护 `cropperOpen` / `cropperImageSrc` 状态与 `<ImageCropperModal>` 实例（立绘/一般图像/三视图）或共享同一实例（表情），均通过 `onConfirm` 回调接收 `croppedDataUrl` 后调用对应 store 的 save 方法
- **【重点标记 - AI 生成入口全部为 placeholder】** Task 9 阶段所有 AI 生成入口（表情批量/单张、立绘、一般图像、三视图、特征）均使用 `message.info('AI 生成功能将在后续接入')` 占位，**不 import `AssetGenerateModal`**（Task 10 尚未完成，避免编译依赖），统一以 TODO 注释标注「Task 11 接入 AssetGenerateModal」/「Task 13 接入」
- **【重点标记 - 重构关系】** 本文件由 `ExpressionManagerModal.tsx` 重构而来，但 **不删除原文件**（Task 11 决定是否删除或保留为内部子组件），也 **不修改任何入口文件**（`CharacterEditModal` / `ChatHeader` / `CharacterDialogueChat`，Task 11 处理）。表情 Tab 直接复用原 ExpressionManagerModal 的核心逻辑（30 预置情绪 + 自定义情绪网格 + 上传/删除/裁剪流程 + 添加自定义情绪表单），代码量较大但行为一致
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量（`var(--text-primary)` / `var(--primary-color)` / `var(--chat-bubble-assistant-bg)` 等），与 `ExpressionManagerModal.tsx` 一致；主操作按钮使用渐变背景 `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)`
- **antd 组件使用**：`Modal` / `Tabs`（items API）/ `Button` / `Input` / `Tag`（closable + onClick 编辑）/ `Tooltip` / `Empty` / `Spin` / `message` / `Modal.confirm`
- **图标**：`UploadOutlined`（上传）/ `DeleteOutlined`（删除）/ `PlusOutlined`（添加自定义情绪/特征）/ `CloseOutlined`（移除自定义情绪类别）/ `ThunderboltOutlined`（AI 批量生成）/ `RobotOutlined`（AI 单张生成）/ `SaveOutlined`（保存特征）
- **store 订阅模式**：各子组件分别订阅 `useExpressionStore` / `useAssetStore` / `useCharacterTraitStore`，`error` 字段单独通过 selector 订阅（`useXxxStore((s) => s.error)`）以渲染 inline 错误横幅；具体操作的失败由 handler 通过 `message.error` 反馈，与 `ExpressionManagerModal` 一致
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（新建，约 1837 行 / 62 KB）
- **tsc 验证**：`npx tsc --noEmit` 通过，`AssetManagerModal.tsx` 无新增 TypeScript 错误（仓库其他 1006 行 tsc 错误均属预存问题，与本 Task 无关）。开发中曾出现 `ThreeViewTabContent` 中 `manifest` 变量声明未使用的 TS6133 错误（三视图通过固定 slot 直接查 `imageCache`，无需读 manifest），已通过从解构中移除 `manifests` 修复
- **后续依赖**：
  - Task 10：实现 `AssetGenerateModal` 组件（AI 生成素材弹窗）
  - Task 11：将本弹窗接入入口文件（`CharacterEditModal` 新增「素材与特征」Tab / `ChatHeader` 替换原「表情管理」入口），届时决定是否删除原 `ExpressionManagerModal.tsx`
  - Task 13：接入 AI 特征生成（使用 `characterDescription` / `characterPersonality` / `characterScenario` 构建提示词）

### 14.19 素材管理入口接入（Spec: add-asset-and-trait-management / Task 11，2026-07-27 新增）

**【重点标记 - BREAKING UI 变更】** 本 Task 将 `AssetManagerModal`（Task 9）正式接入两个用户入口，替换原 `ExpressionManagerModal`。表情数据层（`expressionService` / `expressionStore`）保持不变，仅 UI 容器层重构。用户面向的「表情管理」标签统一更名为「素材管理」，但内部 API 命名（state 变量 / prop 名）保留原名以最小化改动面。

- **改动文件**（共 3 个）：
  1. `src/renderer/components/Character/CharacterEditModal.tsx`（角色卡编辑弹窗 - 第 4 个 Tab 入口）
  2. `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx`（对话头部按钮 Tooltip）
  3. `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（对话测试弹窗内嵌渲染）

- **CharacterEditModal.tsx 改动**（4 处）：
  - **L7 import 替换**：`import ExpressionManagerModal from './CharacterDialogueChat/ExpressionManagerModal'` → `import AssetManagerModal from './CharacterDialogueChat/AssetManagerModal'`
  - **L719 Tab label 文本**：`<SmileOutlined /> 表情管理` → `<SmileOutlined /> 素材管理`（保留 `key: 'expressions'` 与 `SmileOutlined` 图标不变，仅改用户可见文本）
  - **L730 Alert message**：`"为该角色卡管理表情图片"` → `"为该角色卡管理素材与特征"`
  - **L828-841 嵌套 Modal 渲染**：`<ExpressionManagerModal>` → `<AssetManagerModal>`，新增 3 个 props：
    - `characterDescription={formValues.description || ''}`
    - `characterPersonality={formValues.personality || ''}`
    - `characterScenario={formValues.scenario || ''}`
  - **保留 state 名**：`expressionModalOpen` / `setExpressionModalOpen` 不变（内部命名，不影响用户行为）

- **ChatHeader.tsx 改动**（1 处）：
  - **L211 Tooltip title**：`"表情管理"` → `"素材管理"`
  - **保留不变**：`SmileOutlined` 图标、`onOpenExpressionManager` prop 名（内部 API 命名，不属于用户可见标签）

- **CharacterDialogueChat.tsx 改动**（2 处）：
  - **L10 import 替换**：`import ExpressionManagerModal from './ExpressionManagerModal'` → `import AssetManagerModal from './AssetManagerModal'`
  - **L631-644 Modal 渲染**：`<ExpressionManagerModal>` → `<AssetManagerModal>`，新增 3 个 props：
    - `characterDescription={characterInfo.characterCardContent || ''}`（`characterCardContent` 即角色卡 description 字段）
    - `characterPersonality={characterInfo.personality}`（可选，直接传 `string | undefined`）
    - `characterScenario={characterInfo.scenario}`（可选）
  - **保留 state 名**：`expressionManagerOpen` / `setExpressionManagerOpen` 不变

- **类型兼容性**：`AssetManagerModalProps` 的 3 个新增字段均为可选（`characterDescription?: string` / `characterPersonality?: string` / `characterScenario?: string`），因此 `characterInfo.personality` / `characterInfo.scenario` 为 `string | undefined` 时无需兜底即可直接传入；`CharacterInfo` 类型已包含 `personality?` / `scenario?` / `characterCardContent?` 字段，无需类型层改动。`formValues` 在 `CharacterEditModal` 中已使用 `description` / `personality` / `scenario` 字段（见原有 FieldEditor 渲染），无需扩展。

- **【重点标记 - 命名保留策略】** Task 11 有意保留 `expressionModalOpen` / `expressionManagerOpen` / `onOpenExpressionManager` / `setExpressionModalOpen` / `setExpressionManagerOpen` 等内部命名不变，原因：
  1. 这些是组件内部 state 与 prop 名，用户不可见，不影响功能
  2. 最小化改动面，降低 git diff 噪音，便于代码审查聚焦于真正影响行为的变更
  3. 若后续 Task（如 Task 14+）需要彻底重命名，可统一进行；当前 Task 仅聚焦于「让 AssetManagerModal 接管入口」

- **未删除 `ExpressionManagerModal.tsx`**：原文件（859 行）保留，原因：
  1. Task 9 的 `AssetManagerModal` 表情 Tab 直接复用原 `ExpressionManagerModal` 的核心逻辑（复制粘贴 + 适配），两个文件无引用关系
  2. Task 11 后 `ExpressionManagerModal` 已无入口引用（仅 `index.ts` 仍 re-export，但无外部消费），可视为「僵尸组件」
  3. 后续 Task 决定是否删除或保留作为内部子组件（如未来需要单独的「仅表情」入口）

- **tsc 验证**：`npx tsc --noEmit --pretty false 2>&1 | findstr /i "CharacterEditModal ChatHeader CharacterDialogueChat"` 输出仅含 4 个预存错误（`CharacterDialogueChat.tsx` L2/L3/L84 未使用导入 + `CharacterEditModal.tsx` L240 `getCharacterDir` 不存在），与本 Task 改动无关。本 Task 改动的行（L7/L719/L730/L828-841 / L10/L631-644 / L211）均无新增 TypeScript 错误。

- **后续依赖**：
  - Task 12：实现 `AssetGenerateModal` 的 AI 生成逻辑（SD WebUI 调用，写入素材存储）
  - Task 13：接入 AI 特征生成（使用本 Task 传入的 `characterDescription` / `characterPersonality` / `characterScenario` 构建提示词，调用 LLM 生成特征 Tag 数组）

### 14.20 AssetGenerateModal 接入 + AI 特征生成（Spec: add-asset-and-trait-management / Task 11 接线 + Task 13，2026-07-27 新增）

**【重点标记 - placeholder 全量替换】** 本 Task 将 §14.18 `AssetManagerModal` 中遗留的 6 处 `message.info('AI 生成功能将在后续接入')` placeholder 全部替换为真实调用：5 处接入 `AssetGenerateModal`（Task 10 已实现），1 处接入 `ai:generateCharacterTraits` IPC（Task 12 已实现）。同时为 `characterTraitStore` 新增 `setTraits` action 作为 AI 生成结果的本地写入入口。

- **改动文件**（共 2 个）：
  1. `src/renderer/stores/characterTraitStore.ts`（新增 `setTraits` action）
  2. `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（6 处 placeholder handler 接线 + 顶层 `AssetGenerateModal` 状态提升 + 子组件 Props 扩展）

- **Task A：`characterTraitStore.setTraits` action（本地批量替换）**：
  - **签名**：`setTraits: (traits: string[]) => { success: boolean; error?: string }`
  - **行为**：与 `addTrait` / `removeTrait` / `updateTrait` 一致，**仅修改本地 state，不调 IPC**。AI 生成特征后调用此 action 填入编辑区，用户可逐条修改后点击「保存」按钮触发 `saveTraits` 持久化
  - **防御性处理**：非数组入参转为空数组；每个元素 trim + 过滤空串 + `Set` 去重（保持首次出现顺序）
  - **永不失败**：try/catch 包裹，正常路径返回 `{ success: true }`，异常路径返回 `{ success: false, error }`（与 store 其他 action 一致）
  - **用途**：Task 13 AI 生成特征返回 `string[]` 后调用 `setTraits(result.traits)` 写入本地 state，避免直接 `saveTraits` 持久化（用户需先 review/编辑）
  - **文件头注释更新**：职责描述与 Actions 说明同步加入 `setTraits`

- **Task B：AssetGenerateModal 接入（5 处 placeholder 替换）**：
  - **顶层状态提升**：在 `AssetManagerModal` 顶层组件新增 5 个 state（`generateModalOpen` / `generateMode` / `generateTargetEmotionKey` / `generateTargetEmotionLabel` / `generateTargetSlot`）+ 统一入口 `openGenerateModal(mode, options?)`，避免在 5 个子组件中各自维护弹窗状态
  - **`<AssetGenerateModal>` 渲染**：在顶层 `<Modal>` 内 `<Tabs>` 之后渲染，`characterCardId` 同时作为 `characterCardId` 与 `characterCardPath` 传入（语义不同但实际同值，见 §14.18 AssetGenerateModal 说明）
  - **子组件 Props 扩展**（3 处）：
    - `ExpressionTabContentProps` 新增 `onBatchGenerate?: () => void` + `onSingleGenerate?: (emotionKey, label) => void`
    - `AssetGridTabContentProps` 新增 `onAIGenerate?: () => void`
    - `ThreeViewTabContent` 由内联 Props 改为命名接口 `ThreeViewTabContentProps`，新增 `onAIGenerate?: (slot: ThreeViewSlot) => void`
  - **placeholder 替换**（5 处 handler）：
    - `ExpressionTabContent.handleBatchGenerate` → 校验 `characterCardId` 后调 `onBatchGenerate?.()` → 父组件 `openGenerateModal('batch-expression')`
    - `ExpressionTabContent.handleSingleGenerate(emotionKey, label)` → 调 `onSingleGenerate?.()` → 父组件 `openGenerateModal('single-expression', { targetEmotionKey, targetEmotionLabel })`
    - `AssetGridTabContent.handleAIGenerate` → 调 `onAIGenerate?.()` → 父组件 `openGenerateModal('illustration' | 'general')`（由 tabItems 配置决定 mode）
    - `ThreeViewTabContent.handleAIGenerate(slot)` → 调 `onAIGenerate?.(slot)` → 父组件 `openGenerateModal('three-view', { targetSlot: slot })`
    - `CharacterTraitTabContent.handleAIGenerateTraits` 见 Task C（不通过 AssetGenerateModal，直接调 IPC）
  - **统一校验**：所有 handler 在调 `onXxx?.()` 前均校验 `characterCardId` 非空（`message.warning('请先选择角色卡')`），保持与原 placeholder 的防御性一致
  - **tabItems 配置**：在顶层 `tabItems` 数组中为 4 个 Tab（表情/立绘/一般图像/三视图）传入对应 callback，角色特征 Tab 无 callback（自有 IPC 调用）

- **Task C：AI 特征生成接入（Task 13）**：
  - **新增 state**：`aiGenerating: boolean`（控制「AI 生成特征」按钮 loading 状态）
  - **store 订阅扩展**：`CharacterTraitTabContent` 的 `useCharacterTraitStore` 解构新增 `setTraits`
  - **`handleAIGenerateTraits` 重写**（异步）：
    1. 校验 `characterCardId` 非空 + 至少一个描述字段（`characterDescription` / `characterPersonality` / `characterScenario`）非空
    2. 若 `traits.length > 0` 弹 `Modal.confirm` 二次确认（标题「AI 生成将覆盖现有特征」，内容显示当前特征数）
    3. `setAiGenerating(true)` → 调 `window.electronAPI.ai.generateCharacterTraits({ characterCardId, description, personality, scenario })`
    4. 成功且 `result.traits` 为数组时调 `setTraits(result.traits)` 写入本地 state：
       - `result.traits.length === 0` → `message.info('AI 未能从角色描述中提取到视觉特征，请手动添加')`
       - 否则 `message.success('AI 生成了 N 个特征，请确认后点击「保存」')`
    5. 失败时 `message.error(result?.error || 'AI 生成特征失败')`；异常时 `console.error` + `message.error`
    6. `finally` 块 `setAiGenerating(false)`
  - **按钮 loading 状态**：顶部工具栏与空状态两处「AI 生成特征」按钮均加 `loading={aiGenerating}` prop
  - **依赖数组**：`[characterCardId, characterDescription, characterPersonality, characterScenario, traits.length, setTraits]`（注意 `traits.length` 而非 `traits`，避免每次 trait 变动都重建 callback）

- **【重点标记 - antd v6 兼容性修复】** 开发中遇到 TypeScript 错误 `Type '"warning"' is not assignable to type 'LegacyButtonType | undefined'`：
  - **根因**：项目使用 `antd@^6.3.5`，antd v6 移除了 `ButtonType` 的 `'warning'` 值（v5 已 deprecated）。当前 `LegacyButtonType = ButtonType | 'danger'` = `'default' | 'primary' | 'dashed' | 'link' | 'text' | 'danger'`
  - **修复**：`Modal.confirm` 的 `okType: 'warning'` 替换为 `okButtonProps: { danger: true }`（红色按钮表达破坏性覆盖操作），与本文件中删除确认弹窗（`handleDeleteAsset` / `handleDeleteSlot`）的既有模式一致
  - **教训**：antd v6 不再支持 `okType: 'warning'`，后续涉及「警告型确认弹窗」统一使用 `okButtonProps: { danger: true }` 或 `okType: 'default'`

- **tsc 验证**：`npx tsc --noEmit --pretty false 2>&1 | findstr /i "AssetManagerModal characterTraitStore"` 输出为空（无匹配行），证明两文件无新增 TypeScript 错误。全量 tsc 仅有 1 行预存的 `WatchOptions` 配置错误，与本 Task 无关

- **未删除既有 placeholder 注释**：原 §14.18 中「AI 生成入口 placeholder」「Task 11 接入」等 TODO 注释已在本 Task 替换为实际实现，§14.18 的描述保留作为历史记录（描述的是 Task 9 阶段状态）

### 14.21 角色特征持久化服务 characterTraitService（Spec: add-asset-and-trait-management / Task 1，2026-07-27 新增）

- **能力**：主进程服务，为每个角色卡持久化「视觉特征清单」（如 `["white fur", "dog girl", "black shirt"]`）。在 SD 生成素材时由 `sdGenerationService` 读取该特征并替换 prompt 中的 `{traits}` 占位符（详见 §14.14 特征携带机制），保证角色一致性（毛色/服饰/物种等关键特征不漂移）
- **单例导出**：`export const characterTraitService = new CharacterTraitService();`，与 `expressionService` / `avatarService` / `assetService` 风格一致
- **存储路径设计**：
  - 根目录：`{userData}/data/character-traits/`
  - 单卡目录：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/`
  - 特征文件：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/traits.json`
  - `traits.json` 结构：`{ characterCardId: string, version: 1, traits: string[] }`，`traits` 顺序代表用户优先级（前置特征优先级更高）
- **`sanitizeCardId` 哈希策略**：SHA-256 完整哈希后截取前 16 个十六进制字符，与 `expressionService.sanitizeCardId` / `assetService.sanitizeCardId` 完全一致，保证同一 `characterCardId` 在 `character-expressions` / `character-traits` / `character-assets` 三个目录下映射到同一 hash 子目录名（虽然目录相互独立）
- **公共方法**（全部返回结构化对象，永不抛异常给调用方）：
  - `loadTraits(characterCardId): Promise<string[]>` —— 读取特征 tag 数组；文件不存在返回 `[]`；JSON 解析失败兜底返回 `[]` 并记录 error 日志；非数组 `traits` 字段兜底为 `[]`
  - `saveTraits(characterCardId, traits): Promise<{ success, error? }>` —— 覆盖保存特征 tag 数组（自动 mkdir + writeFile）。入参校验：仅保留 string 元素，过滤 null/undefined/非字符串
  - `clearTraits(characterCardId): Promise<{ success, error? }>` —— 删除 `traits.json` 文件。**ENOENT 视为幂等成功**（与 `expressionService` 删除图像的目录处理策略一致）；仅删文件保留单卡子目录，便于后续写入
- **错误处理约定**：
  - 所有方法包裹 try/catch，永不抛异常
  - 错误通过返回值 `{ success: false, error?: string }` 传递
  - `loadTraits` 文件不存在返回空数组（不抛异常、不返回 error）
  - `clearTraits` 文件不存在视为成功
- **类型导出**：`CharacterTraitManifest`（含 `characterCardId` / `version: 1` / `traits: string[]`）
- **日志前缀**：`[CharacterTraitService]`，与 `[ExpressionService]` / `[AssetService]` 风格一致使用 `console.log/error/warn`
- **依赖关系**：`fs/promises` / `fs` / `path` / `crypto` / `getUserDataPath`（`src/main/utils/appPath.ts`）；不依赖 `expressionService`，与 `assetService` 互不依赖
- **文件**：`src/main/services/characterTraitService.ts`（新建，~232 行）

### 14.22 素材管理服务 assetService（Spec: add-asset-and-trait-management / Task 6，2026-07-27 新增）

- **能力**：主进程服务，将原表情管理拓展为通用素材管理。新增三种素材类型 `illustration`（角色立绘）/ `general`（一般图像）/ `three-view`（三视图 front/side/back 三个固定槽位）。**表情类型 `expression` 不纳入本服务**，继续由 `expressionService` 管理，保证向后兼容
- **单例导出**：`export const assetService = new AssetService();`，与 `expressionService` / `characterTraitService` 风格一致
- **存储路径设计**：
  - 根目录：`{userData}/data/character-assets/`
  - 单卡 × assetType 目录：`{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/`
  - PNG 文件：`{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/{assetId}.png`
  - 清单文件：`{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/manifest.json`
  - 每个 `assetType` 拥有独立子目录与独立 manifest，便于按类型批量读取/迁移
- **`AssetManifest` 结构**：`{ characterCardId, version: 1, assets: Record<assetId, AssetEntry> }`，`AssetEntry` 含 `id` / `type` / `slot?` / `image` / `createdAt`
- **【重点标记 - 三视图槽位约束】** `three-view` 类型的 `assetId` 仅允许 `front` / `side` / `back`（`THREE_VIEW_ALLOWED_SLOTS` 常量），`slot` 字段与 `assetId` 一致；`illustration` / `general` 类型的 `assetId` 由调用方生成（如 `ill_{timestamp}_{random}`），忽略 `slot` 字段。service 内部对三视图类型校验 `assetId` 是否在白名单内，违例返回 `{ success: false, error }`
- **公共方法**（全部返回结构化对象，永不抛异常给调用方）：
  - `listAssets(characterCardId, assetType): Promise<AssetManifest>` —— 读取 manifest；不存在时返回默认空 manifest（`{ characterCardId, version: 1, assets: {} }`）
  - `saveAsset({ characterCardId, assetType, assetId, imageBase64, slot? }): Promise<{ success, error?, imagePath? }>` —— 保存 PNG 图像并更新 manifest。`imageBase64` 可含 `data:image/png;base64,` 前缀（内部 strip 后写盘）。返回图像绝对路径 `imagePath`
  - `deleteAsset({ characterCardId, assetType, assetId }): Promise<{ success, error? }>` —— 删除 PNG 文件并从 manifest.assets 移除条目；图像不存在视为幂等成功
  - `getAssetPath({ characterCardId, assetType, assetId }): Promise<{ success, imagePath: string|null, error? }>` —— 获取指定素材的图像绝对路径；不存在时 `imagePath=null`、`success=true`
- **【重点标记 - CSP 兼容 - imagePath 仅供主进程使用】** `saveAsset` / `getAssetPath` 返回的 `imagePath` 是磁盘绝对路径（如 `C:\Users\...\character-assets\{hash}\illustration\{assetId}.png`）。渲染进程 `<img src="C:/...">` 会被 CSP `img-src 'self' data: blob:` 拦截导致裂图。渲染层（`assetStore`）拿到 `imagePath` 后必须调 `window.electronAPI.file.readAsBase64` 转 `data:image/png;base64,...` 后才能用于 `<img src>`（与 `expressionStore.loadExpressions` 修复模式一致，详见 §14.24）
- **错误处理约定**：与 `characterTraitService` 一致——所有方法包裹 try/catch，永不抛异常；文件不存在等可恢复场景按幂等成功处理
- **类型导出**：`AssetType` / `ThreeViewSlot` / `AssetEntry` / `AssetManifest`
- **日志前缀**：`[AssetService]`
- **依赖关系**：`fs/promises` / `fs` / `path` / `crypto` / `getUserDataPath`；不依赖 `expressionService` / `characterTraitService`，与两者互不依赖
- **文件**：`src/main/services/assetService.ts`（新建）

### 14.23 角色特征 Zustand store characterTraitStore（Spec: add-asset-and-trait-management / Task 3，2026-07-27 新增；Task 13 扩展 setTraits）

- **能力**：渲染进程 Zustand store，持有当前角色卡的特征 tag 数组 `traits`，封装所有 `window.electronAPI.characterTrait.*` IPC 调用。提供「编辑态」与「持久化态」分离：本地编辑 actions 仅修改 state，调用方在合适时机调 `saveTraits` 一次性持久化
- **不持久化到 localStorage**：特征数据由主进程 `characterTraitService` 持久化到磁盘，此 store 仅作为运行期缓存与 IPC 适配层，每次进入角色卡编辑界面重新拉取
- **状态字段**：
  - `currentCharacterCardId: string | null` —— 当前加载的角色卡 ID（用于校验缓存归属）
  - `traits: string[]` —— 特征 tag 数组，顺序代表用户优先级（前置特征优先级更高）
  - `loading: boolean` / `error: string | null`
- **Actions**：
  - `loadTraits(characterCardId): Promise<void>` —— 异步，调 `characterTrait.list` 拉取并设置；IPC 返回非数组兜底为 `[]`
  - `saveTraits(characterCardId, traits): Promise<{ success, error? }>` —— **乐观更新 + 失败回滚**：先保存 `prevTraits` 引用 → `set({ traits })` 更新本地 state → 调 IPC → 失败时 `set({ traits: prevTraits })` 回滚
  - `addTrait(trait): { success, error? }` —— 同步，仅修改本地 state；trim 后非空且不重复（大小写敏感）则追加到末尾
  - `removeTrait(index): { success, error? }` —— 同步，仅修改本地 state；越界返回 `{ success: false, error: 'index 越界' }`
  - `updateTrait(index, newValue): { success, error? }` —— 同步，仅修改本地 state；越界 / 空串 / 与其他 trait 重复（排除当前 index）均返回 `{ success: false }`
  - **【重点标记 - setTraits action（Task 13 新增）】** `setTraits(traits): { success, error? }` —— 同步，**本地批量替换**（仅修改 state，不调 IPC）。用于 AI 生成特征（Task 13）后填入编辑区，用户可逐条修改后点击「保存」按钮触发 `saveTraits` 持久化。入参防御性处理：非数组转空数组 + 每个元素 trim + 过滤空串 + `Set` 去重（保持首次出现顺序）。**永不失败**：try/catch 包裹，正常路径返回 `{ success: true }`。**设计原因**：AI 返回的特征可能含冗余/低质量 tag，不应直接覆盖持久化数据；用户 review/编辑后再 `saveTraits` 落盘
  - `clear(): void` —— 重置所有状态（离开角色卡编辑界面时调用）
- **设计要点**：
  - 所有 actions 包裹 try/catch，永不向调用方抛出异常，统一通过返回值 `{ success, error? }` 传递错误
  - `traits` 在 set 时均通过浅拷贝构造新引用（`[...traits]` / `Array.from(new Set(...))`），确保 React 通过引用相等感知变更
- **依赖关系**：`zustand`；`window.electronAPI.characterTrait` IPC（preload 透传，详见 §14.14 SD IPC + characterTrait 命名空间类型声明于 `src/renderer/types/electron.d.ts`）；不依赖 `expressionStore` / `assetStore`
- **参考**：`src/renderer/stores/expressionStore.ts`（无 persist 的 IPC 适配 store 模式） / `src/main/services/characterTraitService.ts`（主进程持久化实现，§14.21） / `src/main/ipc/handlers/characterTraitHandlers.ts`（IPC handler）
- **文件**：`src/renderer/stores/characterTraitStore.ts`（新建，~303 行）

### 14.24 素材 Zustand store assetStore（Spec: add-asset-and-trait-management / Task 8，2026-07-27 新增）

- **能力**：渲染进程 Zustand store，按 `assetType` 分组持有 `manifests` 与 `imageCache`（`illustration` / `general` / `three-view`），封装所有 `window.electronAPI.asset.*` IPC 调用
- **不持久化到 localStorage**：素材 manifest 由主进程 `assetService` 持久化到磁盘，此 store 仅作为运行期缓存与 IPC 适配层
- **状态字段**：
  - `currentCharacterCardId: string | null`
  - `manifests: Record<AssetType, AssetManifest | null>` —— 三种 assetType 各自的 manifest（`null` 表示尚未加载）
  - `imageCache: Record<AssetType, Record<assetId, string>>` —— 三种 assetType 各自的 data URL 缓存
  - `loading: boolean` / `error: string | null`
- **Actions**：
  - `loadAssets(characterCardId, assetType): Promise<void>` —— 调 `asset.list` 拿 manifest → 遍历 assets 调 `asset.getImagePath` 拿磁盘绝对路径 → **调 `file.readAsBase64` 转 data URL 存入 `imageCache[assetType]`**。仅更新对应 assetType 的 manifest/imageCache，不触碰其他类型
  - `saveAsset({ characterCardId, assetType, assetId, imageBase64, slot? }): Promise<{ success, error? }>` —— 调 `asset.save` 持久化；**成功后直接复用入参 `imageBase64`（已是 data URL）存入 `imageCache`**，避免读盘；同步更新本地 `manifests[assetType].assets[assetId]`
  - `deleteAsset({ characterCardId, assetType, assetId }): Promise<{ success, error? }>` —— 调 `asset.delete` 删除磁盘文件并从主进程 manifest 移除；同步从本地 `manifests` 与 `imageCache` 移除
  - `resolveAssetImage(assetType, assetId): string | null` —— 解析 `assetType × assetId` → 素材图像 data URL；优先从 `imageCache` 查找，未找到返回 `null`（调用方应回退到默认占位图）。**供未来对话/卡片渲染调用**
  - `clear(): void` —— 重置所有状态
- **【重点标记 - CSP 兼容设计（与 expressionStore.ts 同源修复模式）】** 主进程 `assetService.getImagePath / save` 返回的 `imagePath` 是磁盘绝对路径。但 `src/main/index.ts` 中 CSP 限制 `img-src 'self' data: blob:`，渲染进程 `<img src="C:/...">` 会被浏览器拦截导致「裂开图片」图标。**修复方案**：`imageCache` 中**只存 data URL**，不存绝对路径：
  - `loadAssets`：拿到 `getImagePath` 返回的绝对路径后，再调 `window.electronAPI.file.readAsBase64(path)` 读为 `data:image/png;base64,...` 存入 `imageCache`（与 `useCharacterSwitch.ts` 加载头像、`expressionStore.loadExpressions` 加载表情一致）
  - `saveAsset`：入参 `imageBase64` 本身已是 data URL（裁剪 / SD 生成输出），保存成功后直接复用存入 `imageCache`，无需读盘——既避免 CSP 拦截又省一次 IO
- **工具函数**：`createEmptyManifests()` / `createEmptyImageCache()` 构造初始值；`preloadImage(imagePath)` 通过 `new Image()` fire-and-forget 预加载图像到浏览器缓存
- **类型导出**：本地结构化声明 `AssetType` / `ThreeViewSlot` / `AssetEntry` / `AssetManifest`（与主进程 `assetService.ts` 同名类型结构一致，避免主进程代码导入渲染进程；与 `electron.d.ts` 第 476-505 行 asset 命名空间内联声明保持一致）
- **依赖关系**：`zustand`；`window.electronAPI.asset` + `window.electronAPI.file.readAsBase64` IPC；不依赖 `expressionStore` / `characterTraitStore`
- **参考**：`src/renderer/stores/expressionStore.ts`（CSP 裂图 BUG 修复模式来源，详见 CHANGELOG 2026-07-27 修复条目）/ `src/renderer/components/Character/CharacterDialogueChat/useCharacterSwitch.ts`（头像 data URL 加载模式）
- **文件**：`src/renderer/stores/assetStore.ts`（新建）

### 14.25 AI 辅助特征生成服务 characterTraitAIService（Spec: add-asset-and-trait-management / Task 12，2026-07-27 新增）

- **能力**：主进程服务，基于角色卡的 `description` / `personality` / `scenario` 字段，调用现有 AI 引擎（OpenAI 兼容 `/v1/chat/completions` 端点）自动提取视觉特征 tag 列表（如 `["white fur", "dog girl", "blue eyes", "black shirt"]`）。输出的 tag 列表可直接写入 `characterTraitService` 持久化，供 SD 生成时携带以保证角色一致性
- **单例导出**：`export const characterTraitAIService = new CharacterTraitAIService();`，与 `characterTraitService` / `assetService` 单例模式一致
- **复用基础设施**：
  - `aiConfigProvider`（`src/main/services/ai/AIConfigProvider.ts`）：读取激活引擎的 `baseUrl` / `apiKey` / `apiKeyTransmission` / `systemPrompt` / `modelName`
  - 与 `DescriptionPolisher` / `OutlineGenerator` 一致的 fetch + `/v1/chat/completions` 调用模式
  - **非流式调用**（特征提取任务输出短，无需流式）
- **与 characterTraitService 的关系**：本服务只负责「生成」特征 tag，**不负责持久化**。持久化由 `characterTraitService.saveTraits` 负责，前端拿到 traits 后自行调用。解耦使本服务可独立测试与复用
- **公共方法**：
  - `generateCharacterTraits(params: GenerateCharacterTraitsParams): Promise<GenerateCharacterTraitsResult>`
    - 入参：`{ characterCardId, description, personality?, scenario? }`（`characterCardId` 用于日志关联，不参与 LLM prompt）
    - 返回：`{ success: true, traits: string[] }` 或 `{ success: false, error: 友好信息 }`。`traits` 可能为空数组（表示 LLM 未提取到任何特征）
- **流程**：
  1. 入参校验：`characterCardId` 非空 + `description` 非空（`personality` / `scenario` 可选）
  2. 读取 AI 引擎配置（`aiConfigProvider.getAIConfig({ defaultTransmission: 'header' })`）
  3. 配置兜底校验：`baseUrl` / `apiKey` / `modelName` 任一缺失返回「AI 引擎未配置，请先在设置中配置 API」
  4. 读取引擎运行时参数 `temperature` / `max_tokens`
  5. 构建 system + user 消息，注入引擎级 systemPrompt（与 `OutlineGenerator.enrichSystemPrompt` 一致）
  6. 非流式 POST `/v1/chat/completions`
  7. 解析 `data.choices[0].message.content`，提取逗号分隔 tag
  8. trim 每项 + 过滤空字符串 + 移除前缀编号（如 `1. ` / `- ` / `* `）+ 移除尾部句号/冒号 + 去重（保留原顺序）
- **专用系统提示词 `CHARACTER_TRAIT_SYSTEM_PROMPT`**：
  - 明确角色（角色视觉特征提取助手）与目标（输出 SD 提示词格式 tag）
  - 列出提取范围（物种/毛色发色/瞳色/服饰/配饰/其他显著特征）保证覆盖面
  - 4 条硬性要求：英文 tag / 逗号分隔 / 简洁（1-3 个单词）/ 不臆测
  - 提供输出示例（`white fur, dog girl, blue eyes, black shirt, animal ears`），降低 LLM 输出自然语言句子的概率
- **【重点标记 - 项目最高优先级规则：禁止使用 AI 参数默认值】** `getEngineRuntimeConfig()` 读取激活引擎的 `temperature` / `max_tokens`，**任一字段缺失（或类型非 number）即返回 `null`**，由调用方返回友好错误「AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎」。与 `WritingStyleLearningService.getTemperature / getMaxTokens` 抛错语义一致，仅改为返回 `null` 以适配本 service「不抛异常」的兜底约定（实施日期 2026-05-24，详见 `.trae/documents/技术文档.md`）
- **错误处理约定（SubTask 12.4）**：
  - 任何步骤失败返回 `{ success: false, error: 友好信息 }`，不抛异常
  - AI 引擎未配置 → 「AI 引擎未配置，请先在设置中配置 API」
  - 调用失败（网络/超时/HTTP 错误） → 「AI 调用失败：<具体原因>」；网络错误友好化为「无法连接到 AI 服务，请检查网络或 API 地址」；超时友好化为「请求超时，请稍后重试」
  - 返回格式异常（空内容/无法解析） → 「AI 返回内容无法解析为 tag 列表」
  - 日志前缀 `[CharacterTraitAI]`，与 `[CharacterTraitService]` 区分
- **类型导出**：`GenerateCharacterTraitsParams` / `GenerateCharacterTraitsResult`
- **依赖关系**：`aiConfigProvider` / `getStorageService`（读取 `settings.aiEngines` 与 `activeEngineId` 获取 temperature / max_tokens）；不依赖 `characterTraitService` / `assetService`
- **文件**：`src/main/services/characterTraitAIService.ts`（新建，~378 行）

### 14.26 AI 素材生成弹窗 AssetGenerateModal（Spec: add-asset-and-trait-management / Task 10，2026-07-27 新增）

- **能力**：渲染进程侧的 AI 素材生成弹窗组件，**扩展自 `ExpressionGenerateModal`**（§14.17），支持四种素材类型生成：
  - `batch-expression`：批量生成 30 个预置情绪表情（沿用原 `ExpressionGenerateModal` 逻辑）
  - `single-expression`：生成单个情绪表情（沿用原逻辑）
  - `illustration`：生成角色立绘（full body, standing）
  - `general`：生成一般场景图像（`userScene` 由用户输入）
  - `three-view`：生成三视图（front / side / back，由 `targetSlot` 指定）
- **Props 接口**：
  ```typescript
  export interface AssetGenerateModalProps {
    open: boolean;
    characterCardId: string;          // = 角色卡 PNG 文件路径，作为 store key 与 characterTrait.list 参数
    characterCardPath: string;        // 用于 SD 提取基底图（与 characterCardId 通常是同一字符串）
    characterName: string;
    mode: 'batch-expression' | 'single-expression' | 'illustration' | 'general' | 'three-view';
    targetEmotionKey?: string;        // single-expression 模式必需
    targetEmotionLabel?: string;      // 自定义情绪的中文标签
    targetSlot?: 'front' | 'side' | 'back';  // three-view 模式必需
    onClose: () => void;
    onGenerated?: () => void;
  }
  ```
- **【重点标记 - characterCardId vs characterCardPath 语义分离】** 在 `ExpressionGenerateModal` 中 `characterCardId` 即角色卡 PNG 文件路径（同时用作 store key 和 SD 提取基底图的源文件路径）。本组件按 Task 10 要求将两者作为独立 prop 声明以语义化区分：
  - `characterCardId`：用于 `expressionStore` / `assetStore` / `characterTrait.list` 的 key
  - `characterCardPath`：用于 `sd.generateExpression` 的 `characterCardPath` 参数
  - 实际调用方（Task 11）传入时两者通常是同一字符串
- **打开时初始化**（`useEffect` 监听 `open + characterCardId`）：
  1. 加载 SD 设置：`window.electronAPI.setting.load()` → `setting.sdWebui`（含 `endpoint` / `denoisingStrength` / `steps` / `cfgScale` / `sampler` / `adetailerEnabled` / `customNegativePrompt` / `model` + 16 个 ADetailer 高级参数），缺失字段以 `DEFAULT_SD_CONFIG` 兜底
  2. **读取角色特征**：`window.electronAPI.characterTrait.list(characterCardId)` → 存入 state `characterTraits`
  3. 检测 SD 状态：`window.electronAPI.sd.checkStatus(endpoint)` → 更新 `sdStatus`
- **【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 4 + Task 10）】** 组件打开时通过 `characterTrait.list` 读取角色特征存入 state，`buildSdOptions` 时透传到 `options.characterTraits`，由 `sdGenerationService` 内部替换提示词模板中的 `{traits}` 占位符（与 `ExpressionGenerateModal` 一致，详见 §14.14）。**所有 5 种生成模式均自动携带角色特征**，保证生成素材的角色一致性
- **【重点标记 - 复用 sd.generateExpression IPC（不新增 IPC）】** Task 10 实现约束：不新增 IPC。原 `sd:generateExpression` 的 `emotionKey` 仅用于日志，实际生成由 `prompt` 字段控制（`sdGenerationService.generateExpression` 接收预构建 prompt）。因此非表情模式（`illustration` / `general` / `three-view`）复用此 IPC，`emotionKey` 传 `'neutral'` 占位值，prompt 由本组件按 mode 构建模板
- **提示词模板（按 mode 构建）**：
  - `batch-expression` / `single-expression`：调 `PromptBuilder.buildExpressionGenerationPrompt(emotionKey, customLabel, characterTraits)`，模板含 `{traits}` 与 `{emotion}` 两个占位符
  - `illustration`：`full body, standing, {traits}, looking at viewer, simple background, high quality, best quality, masterpiece`
  - `general`：用户输入 `userScene` + `{traits}` + 质量词
  - `three-view`：按 `targetSlot` 构建（如 `front view, full body, {traits}, ...` / `side view, profile, ...` / `back view, from behind, ...`）
- **生成成功后保存到对应 store**：
  - `batch-expression` / `single-expression` → `expressionStore.saveExpression`（写入 `data/character-expressions/{hash}/`，与手动上传走相同路径，详见 §14.17）
  - `illustration` / `general` / `three-view` → `assetStore.saveAsset`（写入 `data/character-assets/{hash}/{assetType}/`，详见 §14.24）
- **批量生成流程**（与 `ExpressionGenerateModal` 一致）：
  1. 清理旧监听器：`window.electronAPI.sd.removeProgressListeners()`
  2. 重置统计：`statsRef.current = { success: 0, failed: 0, skipped: 0 }`，`setBatchStage('generating')`
  3. 为全部 30 个预置情绪构建提示词（含 `characterTraits`）
  4. 注册进度监听 `onGenerationProgress` / `onGenerationComplete`
  5. 启动生成：`await window.electronAPI.sd.generateAllExpressions({ characterCardPath, emotions, options })`
- **取消机制**：批量生成中点击「取消生成」→ `window.electronAPI.sd.cancelGeneration()` → 模块级 `isCancelled` 标志位，下次循环检查时退出
- **【重点标记 - SD 返回的 base64 不含 data URI 前缀】** `sdGenerationService.generateExpression` 返回的 `imageBase64` 是裸 base64 字符串。本组件在收到 base64 后立即拼接 `PNG_DATA_URI_PREFIX` 存入 state（用于 `<img src>` / antd `<Image src>` 展示）；保存时直接传入带前缀的 data URL，`expressionStore.saveExpression` / `assetStore.saveAsset` 内部会剥离前缀（与 `ExpressionGenerateModal` 一致）
- **UI 风格**：暗色主题 + inline styles + 项目 CSS 变量，参照 `ExpressionGenerateModal`；主操作按钮使用渐变背景 `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)`
- **antd 组件使用**：`Modal` / `Progress` / `Button` / `Alert` / `Spin` / `Image` / `Input.TextArea` / `Tag` / `Space` / `Tooltip`
- **图标**：`ThunderboltOutlined`（生成）/ `RobotOutlined`（重新生成）/ `CheckCircleOutlined`（成功）/ `CloseCircleOutlined`（失败/取消）/ `LoadingOutlined`（生成中）/ `SettingOutlined`（默认状态）/ `EyeOutlined`（AI 图片识别按钮，Spec: add-model-capability-detection-and-image-recognition / Task 7）
- **依赖关系**：`useExpressionStore` / `useAssetStore` / `useSettingStore`（Task 7 新增，读取 `supportsVision`）/ `window.electronAPI.sd.*` / `window.electronAPI.characterTrait.list` / `window.electronAPI.setting.load` / `window.electronAPI.ai.recognizeImageTraits`（Task 7 新增）；import `EMOTION_PRESETS` / `buildExpressionGenerationPrompt` from `./PromptBuilder`（§14.13）
- **【重点标记 - AI 图片识别按钮（Spec: add-model-capability-detection-and-image-recognition / Task 7，2026-07-28 新增）】** 在 `renderTraitsPanel` 的 header 行（特征计数标签所在 flex 容器）右侧新增「AI 图片识别」按钮（`marginLeft: 'auto'` 右对齐），仅当当前 AI 引擎 `supportsVision=true` 时条件渲染。点击后调用 `window.electronAPI.ai.recognizeImageTraits({ characterCardPath: characterCardId, characterName })`（Task 6 IPC），成功时大小写不敏感去重追加到 `characterTraits` state（`new Set(existing.map(t => t.toLowerCase()))` 过滤），`message.success` 提示新增数量与总数量。`supportsVision` 派生：`useSettingStore()` → `setting.aiEngines.find(e => e.id === setting.activeEngineId)` → `activeEngine?.capabilities?.supportsVision === true`。按钮 `loading` 由 `imageRecognizing` state 控制；关闭弹窗时重置该 state 避免残留。**不保存到磁盘**——仅更新组件内 state 影响后续 SD 生成提示词，特征持久化由角色卡编辑界面负责。
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（新建）
- **tsc 验证**：`npx tsc --noEmit` 通过，`AssetGenerateModal.tsx` 无新增 TypeScript 错误

### 14.27 AI 引擎能力标识 UI（Spec: add-model-capability-detection-and-image-recognition / Task 5，2026-07-28 新增）

- **能力**：在 AI 引擎管理界面（`AIEngineSettingsPanel.tsx`）基于引擎 `capabilities` 字段渲染能力徽章，让用户一眼可见每个引擎支持的模型能力（文本生成 / 视觉识别 / 思维链推理 / 工具调用）。徽章渲染于三处：引擎选择下拉、引擎管理 Modal 列表、连通性测试结果。
- **`renderCapabilityBadges` 渲染函数**（模块级，Task 5.1）：接收 `capabilities?: AIEngineCapabilities`，缺省返回 `null`；使用 antd `Tag` + `Tooltip` + `Space` 渲染四个图标徽章：
  - `EditOutlined`（蓝色）— 始终显示，表示文本生成能力
  - `EyeOutlined`（绿色）— `supportsVision=true` 时显示，表示视觉/图片识别
  - `BulbOutlined`（紫色）— `supportsThinking=true` 时显示，表示思维链/推理
  - `ToolOutlined`（橙色）— `supportsToolCalling=true` 时显示，表示工具调用
- **引擎选择下拉显示徽章**（Task 5.2）：主卡片 `Select` 通过 `options` 携带 `capabilities` 字段，`optionRender` 在下拉项名称后渲染徽章，`labelRender` 在已选中标签后渲染徽章（按 `props.value` 从 `engines` 查找引擎 capabilities）。
- **引擎管理 Modal 列表显示徽章**（Task 5.3）：引擎管理 Modal 的 `Table`「引擎名称」列增加 `render`，在引擎名下方渲染 `renderCapabilityBadges(record.capabilities)`。
- **连通性测试结果显示徽章**（Task 5.4 / Spec Task 4.1 + 4.3）：`useAIEngineSettings.ts` 的 `TestResult` 接口新增 `capabilities?: AIEngineCapabilities` 字段（Spec Task 4.1，作为 Task 5.4 显示区的前置类型准备）；主表单 `testResult` 与引擎编辑表单 `engineTestResult` 的 `Alert` 描述区在 `capabilities` 存在时渲染「模型能力」徽章行。当前 `capabilities` 数据由 Spec Task 4.2（探测后填入）提供，未接入前不显示。
- **【重点标记 - antd v6 `optionRender` 类型陷阱】** 首次实现 `optionRender` 时通过 `option.capabilities` 读取自定义字段触发 `tsc` 报错：`Property 'capabilities' does not exist on type 'FlattenOptionData<...>'`。根因：antd v6（`@rc-component/select`）的 `optionRender` 回调参数类型为 `FlattenOptionData<OptionType>`，其结构为 `{ label?, data: OptionType, key, value?, groupOption?, group? }`——自定义字段封装在 `option.data` 上，而非 option 顶层（`label` / `value` 是 FlattenOptionData 顶层字段故可直接访问）。修复方式：改用 `option.data?.capabilities` 读取。后续在 antd v6 Select `optionRender` 中访问自定义 option 字段时，统一通过 `option.data` 访问。
- **文件**：
  - `src/renderer/components/Settings/AIEngineSettingsPanel.tsx`（修改：新增 `Tag` / `Tooltip` antd 导入 + `EyeOutlined` / `BulbOutlined` / `ToolOutlined` 图标导入 + `AIEngineCapabilities` 类型导入；新增 `renderCapabilityBadges` 模块级函数；`Select` 新增 `optionRender` / `labelRender`；引擎管理 Table 名称列新增 `render`；两处测试结果 `Alert` 新增能力徽章行）
  - `src/renderer/components/Settings/hooks/useAIEngineSettings.ts`（修改：导入 `AIEngineCapabilities`；`TestResult` 接口新增 `capabilities?` 字段）
- **tsc 验证**：`npx tsc --noEmit` 通过，`AIEngineSettingsPanel.tsx` / `useAIEngineSettings.ts` 均无新增 TypeScript 错误（仓库其他 tsc 错误均属预存问题，与本 Task 无关）

### 14.28 LoRA 模型列表服务 LoraService（Spec: add-lora-model-selection / Task 1，2026-07-28 新增）

- **能力**：主进程 LoRA 模型列表获取服务，通过 Forge Neo 的 `/sdapi/v1/loras` 端点拉取可用 LoRA 模型列表，并为每个 LoRA 构建预览图 URL、读取本地 JSON 元数据文件、从 path 提取分类。供渲染进程 `LoraSelectModal` 展示可选 LoRA 列表
- **单例导出**：`export const loraService = new LoraService();`，与 `sdGenerationService` / `expressionService` 风格一致
- **HTTP 实现**：使用 Node.js 内置 `fetch` + `AbortSignal.timeout(10000)`（10s 超时），不引入额外依赖
- **公共方法**：
  - `fetchLoraList(endpoint): Promise<{ success, loras?: LoraModel[], error? }>` —— GET `{endpoint}/sdapi/v1/loras`，返回加工后的 `LoraModel[]`（按名称 `localeCompare('zh')` 排序）
- **数据处理流程**（`buildLoraModel` 私有方法）：
  1. 构建预览图 URL：`{endpoint}/sd_extra_networks/thumb?filename={encodeURIComponent(path)}`
  2. 从 path 提取分类：`path.replace(/\\/g, '/').split('/')` 取倒数第二段（子目录名），不足两段时为 `'未分类'`
  3. 读取 JSON 元数据：`readJsonMetadata(loraPath)` 读取 `{path_without_extension}.json`，解析 `description` / `activation text` / `preferred weight` / `sd version` / `notes` 五个字段（缺失或解析失败返回空字符串/0）
- **LoraModel 接口**（10 字段）：`name` / `alias` / `path` / `previewUrl` / `description` / `activationText` / `preferredWeight` / `sdVersion` / `notes` / `category`
- **错误处理**：API 非 2xx 返回友好错误信息；`fetch failed` / `network` 关键词识别为连接错误；非数组响应检测
- **日志前缀**：`[LoraService]`
- **文件**：`src/main/services/loraService.ts`（新建，~195 行）
- **tsc 验证**：`npx tsc --noEmit` 无 `loraService.ts` 相关 TypeScript 错误

### 14.29 LoRA 模型选择弹窗 LoraSelectModal（Spec: add-lora-model-selection / Task 4，2026-07-28 新增）

- **能力**：渲染进程侧的 LoRA 模型选择弹窗组件，打开时调用 `window.electronAPI.lora.list(endpoint)` 拉取可用 LoRA 列表，用户可多选并调整权重，确认后通过 `onConfirm` 回调返回选中列表。被 `ExpressionGenerateModal`（§14.17）与 `AssetGenerateModal`（§14.26）复用
- **Props 接口**：
  ```typescript
  interface LoraSelectModalProps {
    open: boolean;
    endpoint: string;
    selectedLoras: Array<{ name: string; weight: number }>;
    onConfirm: (loras: Array<{ name: string; weight: number }>) => void;
    onCancel: () => void;
  }
  ```
- **UI 组成**：
  - **顶部搜索 + 分类筛选**：`Input` 搜索框（前端不区分大小写过滤 `lora.name.toLowerCase().includes(kw)`）+ `Select` 分类下拉（从 `loraList` 的 `category` 字段去重，含「全部」选项）
  - **已选区域**：每个选中 LoRA 渲染为 `Tag` + `Popover`（内含权重 `Slider` 0-1，步进 0.05）+ `Button` 移除按钮（`CloseOutlined`）。Tag 文案格式 `name (0.70)`
  - **主体网格布局**：`display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))`，每个卡片含预览图（`<img loading="lazy">` 懒加载，120px 高）+ 模型名（11px 字号，`text-overflow: ellipsis`）。选中卡片边框为 `var(--primary-color, #6366f1)`，未选中为 `transparent`
  - **Tooltip**：悬停卡片显示 JSON 元数据（description / activationText / sdVersion / notes），无元数据显示「无额外说明」
  - **占位图**：预览图加载失败（`onError`）或无 `previewUrl` 时显示 `PictureOutlined` 图标占位
  - **底部按钮**：取消 + 确认（`确认（N）`，N 为已选数量）
- **常量**：`DEFAULT_WEIGHT = 0.7`（新增选中时使用）/ `ALL_CATEGORY = '全部'`
- **性能优化**：
  - 预览图懒加载（`<img loading="lazy">`）
  - `loraCacheRef` 缓存列表：endpoint 未变化时不重复请求，Modal 关闭再打开复用 `useRef` 缓存
  - `useMemo` 计算分类选项（`categoryOptions`）与过滤后列表（`filteredLoras`）
- **状态管理**：`localSelected` 为 `selectedLoras` 的本地副本（打开时同步，运行中独立修改，确认时通过 `onConfirm` 回传）。`failedImages` 为 `Set<string>` 记录加载失败的预览图 name
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/LoraSelectModal.tsx`（新建，~450 行）
- **tsc 验证**：`npx tsc --noEmit` 无 `LoraSelectModal.tsx` 相关 TypeScript 错误

### 14.30 AssetManagerModal 内联渲染模式（2026-07-29 新增）

**【重点标记 - 体验优化】** 本节解决 `CharacterEditModal`「素材管理」Tab 内容单薄、需二次点击按钮才能进入管理面板的体验问题。为 `AssetManagerModal`（§14.18）新增 `inline` 属性，支持以非 Modal 形态直接嵌入 Tab 页签。

- **背景**：§14.19 将 `AssetManagerModal` 接入 `CharacterEditModal` 第 4 个 Tab 时，Tab 内仅渲染 `Alert` 说明 + 「打开表情管理」`Button`，点击后才弹出 `AssetManagerModal`。这导致素材管理 Tab 与其他三个 Tab（角色信息/对话与指令/世界书关联，均直接展示完整编辑界面）的功能复杂度严重不对称，用户体验较差。

- **方案选型**：采用**条件渲染**而非 Modal CSS hack（`getContainer={false}` + `position: static`）。原因：
  1. Ant Design Modal 的 fixed 定位 / z-index / overflow 体系专为弹层设计，强行覆盖为 static 易在嵌套 Modal（`CharacterEditModal` 内嵌 `AssetManagerModal`）场景产生样式冲突
  2. 条件渲染语义清晰——`inline=true` 时返回普通 `<div>`，内容自然随父 Modal body 的 `overflowY: auto` 滚动，无定位副作用
  3. 共享内容（`Tabs` + `AssetGenerateModal`）提取为变量，两种模式复用，无代码重复

- **AssetManagerModal.tsx 改动**：
  - **Props 新增** `inline?: boolean`（默认 `false`），接口注释说明三种渲染差异
  - **组件解构** 增补 `inline = false`
  - **return 重构**：提取 `tabsElement`（`<Tabs items={tabItems} style={{ minHeight: 400 }} />`）与 `generateModalElement`（`<AssetGenerateModal ... />`）为局部变量；`inline === true` 时提前返回 `<div style={{ width: '100%' }}>{tabsElement}{generateModalElement}</div>`（无标题，与「角色信息」等 Tab 风格一致）；否则渲染原 `<Modal title=... footer=...>` 包裹同样的两个变量
  - **数据加载**：`useEffect` 仍依赖 `open && characterCardId` 触发 `loadExpressions` / `loadAssets` / `loadTraits`。内联模式下父组件传 `open={父Modal的open}`，确保仅在父 Modal 可见时加载数据

- **CharacterEditModal.tsx 改动**：
  - **移除** `expressionModalOpen` / `setExpressionModalOpen` state 声明（2 行）及模态框打开时重置 imageChanged 的 useEffect 中相关逻辑不受影响
  - **Tab children 重写**（`key: 'expressions'`）：`editingItem?.path` 存在时渲染 `<AssetManagerModal open={open} inline={true} characterCardId={editingItem.path} ... onClose={() => {}} />`；不存在时保留 `Alert` 警告「请先保存角色卡」
  - **移除** 文件底部独立的 `<AssetManagerModal open={expressionModalOpen} ... />` 渲染块（原 L828-841）
  - **导入不变**：`AssetManagerModal` / `Alert` / `SmileOutlined` 等仍被使用，无需清理

- **向后兼容**：
  - `inline` 可选默认 `false`，`CharacterDialogueChat.tsx`（§14.19 ChatHeader 入口）未传该 prop，行为完全不变
  - 内联模式下内部子弹窗（`ImageCropperModal` / `AssetGenerateModal` / `LoraSelectModal` / `Modal.confirm`）仍各自 portal 到 document.body，弹层定位与 z-index 不受内联父容器影响

- **涉及文件**：`src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（`inline` prop + 条件渲染 + 内容提取）/ `src/renderer/components/Character/CharacterEditModal.tsx`（Tab 内联渲染 + state 清理 + 底部弹窗移除）
- **tsc 验证**：`npx tsc --noEmit` 无本次改动的新增 TypeScript 错误（`CharacterEditModal.tsx` L237 `getCharacterDir` 为预存错误）

### 14.31 立绘生成重构 + 立绘替换角色卡图片 + 缩略图全尺寸预览（2026-07-29 新增）

**【重点标记 - 三项联动改动】** 本节记录用户需求驱动的三项相关改动：（1）立绘生成强制走 txt2img 路径（明确禁用 img2img）；（2）立绘可一键替换角色卡原始图片（含确认机制防误操作）；（3）所有素材缩略图新增 hover 眼睛图标 + 全尺寸预览 Modal。三项改动共同提升了立绘生成→预览→应用的完整工作流体验。

#### 14.31.1 立绘生成强制 txt2img 路径（Task 1）

- **背景**：原 `AssetGenerateModal`（§14.26）的 illustration 模式调用 `sd.generateExpression`，该方法内部按 `modelType` 分流——sdxl 走 img2img（需提取角色卡 PNG 作为基底图），qwen-image / flux2 走 txt2img。用户需求明确要求立绘生成**必须使用角色特征参数通过 txt2img 技术生成，禁止 img2img 路径**，以确保立绘完全由特征 tag + LoRA 驱动，不受基底图风格干扰
- **sdGenerationService.ts 重构**：
  - **提取 `applyTraitsAndLora(prompt, options): string` 私有方法**：原 `{traits}` 占位符替换 + LoRA 标签注入逻辑内联在 `generateExpression` 中，现提取为独立方法供两条路径复用。处理流程：① 读取 `options.characterTraits` 过滤空字符串拼接为逗号分隔串；② 函数形式 `replace(/\{traits\}/g, ...)` 替换占位符（避免 `$` 特殊字符干扰）；③ 循环 `replace(/,\s*,/g, ',')` 清理连续逗号 + 清理首尾逗号 + 清理多余空格；④ `selectedLoras` 转为 `<lora:name:weight>` 标签注入 prompt 前部
  - **`generateTxt2Img` 自包含特征处理**：在方法内部首行调用 `applyTraitsAndLora(prompt, options)`，使前端直接调用 `sd.generateTxt2Img` 时也能准确应用角色特征 tag 和 LoRA（无需依赖 `generateExpression` 预处理）
  - **`generateExpression` 调用顺序调整**：将 `applyTraitsAndLora` 调用移至 txt2img 分支之后（仅服务 img2img 路径）。**【重点标记 - 避免双重注入】** 当 `generateExpression` 分流到 `generateTxt2Img`（qwen-image / flux2 无基底图）时，prompt 尚未经过 `applyTraitsAndLora` 处理，由 `generateTxt2Img` 内部统一处理，避免 LoRA 标签被注入两次
- **AssetGenerateModal.tsx 改动**：`handleSingleGenerate` 中新增 `mode === 'illustration'` 分支，直接调用 `window.electronAPI.sd.generateTxt2Img({ endpoint, prompt, negativePrompt, options: buildSdOptions() })`，不传 `characterCardPath`（txt2img 无需基底图）；其他模式（single-expression / general / three-view）仍走 `sd.generateExpression` 由其内部按 modelType 分流。依赖数组新增 `sdConfig.endpoint`
- **数据流**：`AssetGenerateModal` 打开时 `characterTrait.list(characterCardId)` 读取特征 → `buildSdOptions()` 透传到 `options.characterTraits` → `sd.generateTxt2Img` → `applyTraitsAndLora` 替换 `{traits}` + 注入 LoRA → POST `/sdapi/v1/txt2img` → 返回 base64 → `assetStore.saveAsset({ assetType: 'illustration', ... })`
- **涉及文件**：`src/main/services/sdGenerationService.ts`（`applyTraitsAndLora` 提取 + `generateTxt2Img` 自包含 + `generateExpression` 调用顺序调整）/ `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（illustration 分流到 txt2img）
- **【重点标记 - Forge Neo Hires.fix NoneType 迭代错误修复（2026-07-29）】** 立绘生成（txt2img）启用 Hires.fix 时 Forge Neo 端报错 `TypeError: argument of type 'NoneType' is not iterable`（`processing.py:1405`）。**根因**：Forge Neo `processing.py:1221` 将 `hr_additional_modules: list = field(default=None)` 默认值设为 `None`（而非空列表），而 `processing.py:1405` 的 `sample` 方法中 `"Use same choices" not in self.hr_additional_modules` 仅检查 `hasattr` 未检查 `None`——当 `enable_hr=true` 但 API 请求体未传入 `hr_additional_modules` 时，`"..." not in None` 抛出 TypeError。**修复**：在 `generateTxt2Img` 与 `generateExpression`（img2img 路径）的 Hires.fix 参数注入中，显式设置 `body.hr_additional_modules = ['Use same choices']`。这使得 Forge Neo `processing.py:1405` 的 `"Use same choices" not in ["Use same choices"]` 返回 `False`（跳过该 if 块），既绕过 None bug，又确保 Hires.fix 阶段复用主生成的 LoRA 模块（保持角色一致性）。通过阅读 Forge Neo 源码 `modules/api/models.py` 确认 `hr_additional_modules` 可通过 API 请求体传入——`PydanticModelGenerator` 反射 `StableDiffusionProcessingTxt2Img` 的所有 dataclass 字段生成 API 模型，`hr_additional_modules` 作为该类的字段自动暴露给 API。
- **【重点标记 - Forge Neo Hires.fix 参数名错误导致 denoising_strength 为 None（2026-07-29）】** 修复 `hr_additional_modules` bug 后 Hires.fix 仍报错 `TypeError: '>' not supported between instances of 'NoneType' and 'int'`（`sd_samplers_common.py:46` 的 `p.denoising_strength > 0`）。**根因（两个参数名错误，通过阅读 Forge Neo 源码定位）**：
  1. **`hr_denoising_strength` 不存在**：在整个 Forge Neo `modules/` 目录中搜索 `hr_denoising_strength` 零结果。txt2img 的 Hires.fix 第二阶段（`sample_hr_pass` → `sample_img2img` → `setup_img2img_steps`）直接读取 `p.denoising_strength`，而非独立的 `hr_denoising_strength`。子类 `StableDiffusionProcessingTxt2Img` 第 1212 行定义 `denoising_strength: float = 0.75`，但 `PydanticModelGenerator.merge_class_params`（`api/models.py:58-63`）按 MRO 顺序遍历（子类先、基类后），基类 `StableDiffusionProcessing` 第 174 行的 `denoising_strength: float = None` 覆盖了子类默认值 0.75。当 API 请求体未传 `denoising_strength` 时，`p.denoising_strength=None`，`setup_img2img_steps` 中 `p.denoising_strength > 0` 抛 TypeError
  2. **`hr_steps` 不是有效字段名**：Forge Neo `processing.py:1217` 的正确字段名为 `hr_second_pass_steps`，传 `hr_steps` 会被 Pydantic 忽略（`hr_second_pass_steps` 保持默认值 0 = 使用主生成 steps）
  - **修复**：`generateTxt2Img` 中将 `body.hr_denoising_strength` 改为 `body.denoising_strength`（txt2img 的 denoising_strength 专供 Hires.fix 使用），将 `body.hr_steps` 改为 `body.hr_second_pass_steps`；`generateExpression`（img2img）中移除无效的 `hr_denoising_strength`（img2img 已在请求体中设置 `denoising_strength`，Hires.fix 复用该值），将 `hr_steps` 改为 `hr_second_pass_steps`

#### 14.31.2 立绘替换角色卡图片（Task 2）

- **能力**：在素材管理的「角色立绘」Tab（`AssetGridTabContent` with `assetType='illustration'`）中，每张立绘缩略图新增 `SwapOutlined`「设为角色卡图片」按钮（仅 illustration 类型显示，general / three-view 不显示），点击后将该立绘替换为角色卡 PNG 的基底图片
- **确认机制**：**【重点标记 - 防误操作】** 点击后弹出 `Modal.confirm` 警告框，内容明确告知「将使用此立绘替换角色卡的原始图片（PNG 载体）。角色卡的角色数据（描述、个性等）会保留不变，仅替换基底图片。此操作不可撤销，确定继续？」，`okText: '确认替换'`，`okButtonProps: { danger: true }`，需用户主动确认后才执行
- **替换流程**（`handleReplaceCardImage`）：
  1. `window.electronAPI.character.read(characterCardId)` 读取角色卡当前 JSON 元数据（保留 description / personality / scenario 等所有字段，仅替换图片载体）
  2. 剥离 data URI 前缀（`dataUrl.substring(commaIndex + 1)`）提取纯 base64
  3. `window.electronAPI.character.createFromImage(characterCardId, base64String, content)` 重建 PNG 文件——新图片作为 PNG 载体，原 JSON 元数据写入 tEXt chunks
  4. `invalidateCharacterImageCache(characterCardId)` 失效缩略图/头像缓存（§14.30 引入的 `characterThumbnailCache` 模块），使角色列表、对话头像、编辑弹窗等各处显示新图片
  5. `onCardImageReplaced?.(dataUrl)` 回调通知父组件更新预览
- **CharacterEditModal 联动**：
  - **`AssetManagerModalProps` + `AssetGridTabContentProps` 新增** `onCardImageReplaced?: (newImageDataUrl: string) => void` prop
  - **`handleCardImageReplaced` 回调**（`CharacterEditModal`）：`setUploadedImage(newImageDataUrl)` 更新顶部图片预览为新立绘 + `setImageChanged(false)` 重置图片更换标记。**【重点标记 - 避免重复重建 PNG】** 因为 PNG 已在 `handleReplaceCardImage` 中通过 `createFromImage` 在磁盘上重建，保存角色卡时仅需 `character.write` 写 JSON 元数据，无需再次 `createFromImage`（否则会用同一图片重复重建）。`imageChanged=false` 确保走 `character.write` 分支
- **向后兼容**：`onCardImageReplaced` 为可选 prop，`CharacterDialogueChat.tsx`（ChatHeader 入口，弹窗模式）未传该 prop，替换功能仍可执行（磁盘 PNG 已重建 + 缓存已失效），仅不更新父组件预览
- **涉及文件**：`AssetManagerModal.tsx`（`AssetGridTabContent` 替换按钮 + `handleReplaceCardImage` + `replacingCardImage` loading state + `onCardImageReplaced` prop 透传）/ `CharacterEditModal.tsx`（`handleCardImageReplaced` 回调 + prop 传递）/ `characterThumbnailCache.tsx`（导入 `invalidateCharacterImageCache`）

#### 14.31.3 缩略图全尺寸预览（Task 3）

- **能力**：为素材管理中所有图片缩略图（`AssetGridTabContent` 的立绘/一般图像 + `ThreeViewTabContent` 的三视图）添加 hover 触发的预览功能。鼠标悬停在缩略图上时，半透明遮罩层平滑淡入，中央显示眼睛图标按钮；点击图标后以 Modal 展示完整尺寸图片，保留原始分辨率与细节
- **hover 覆盖层实现**：
  - 缩略图容器 `onMouseEnter` / `onMouseLeave` 事件中通过 `e.currentTarget.querySelector('.thumbnail-hover-overlay')` 获取覆盖层 DOM 节点，直接操控 `style.opacity`（`'1'` / `'0'`）
  - 覆盖层 `div.thumbnail-hover-overlay` 样式：`position: absolute; inset: 0; background: rgba(0,0,0,0.5); opacity: 0; transition: 'opacity 0.25s ease'; cursor: pointer`，实现 0.25 秒平滑淡入
  - 中央 `Button`（`type="text"`）+ `EyeOutlined` 图标（`fontSize: 22, color: '#fff'`），外包 `Tooltip title="预览大图"`
  - **【重点标记 - DOM 直操 vs React state】** 采用 `querySelector` + `style.opacity` 直接操控 DOM（与现有卡片 `border-color` hover 模式一致），避免额外 React state 渲染开销——每个缩略图网格有 N 张图，用 state 管理会导致整个网格重渲染
- **全尺寸预览 Modal**：
  - `previewImage: string | null` state 控制开关，`handlePreview(dataUrl)` / `setPreviewImage(dataUrl)` 设置，`onCancel={() => setPreviewImage(null)` 关闭
  - `Modal` props：`footer={null}`（无操作按钮）、`title={null}`（无标题栏）、`centered`（垂直居中）、`width="auto"` + `style={{ maxWidth: '95vw', padding: 0 }}` + `styles={{ content: { padding: 0 }, body: { padding: 0 } }}`（Modal content + body 均无 padding，紧贴图片）、`destroyOnClose`（关闭时销毁 DOM 释放大图内存）、`closable`（右上角关闭按钮）
  - 图片样式：`maxWidth: '90vw'` + `maxHeight: '85vh'` + `display: 'block'`（消除底部基线间隙）+ `borderRadius: 8`（匹配 Modal 圆角）
  - **【样式优化（2026-07-30）】** 移除原 `objectFit: 'contain'`（在 `maxWidth/maxHeight` 约束下浏览器已自动保持原始比例，`objectFit` 多余且可能导致图片比预期小）；新增 `centered` + `title={null}` + `styles.content.padding: 0`，确保 Modal 完全包裹图片无多余空白，解决弹窗大小与图片比例不匹配的视觉问题
- **ThreeViewTabContent 一致性**：三视图三个槽位（front/side/back）的缩略图同样添加 hover 覆盖层 + 眼睛图标，点击后复用同一 `previewImage` state + 预览 Modal（`setPreviewImage(dataUrl)`），实现风格统一
- **未覆盖范围**：`ExpressionTabContent`（表情 Tab）未添加 hover 预览——表情图为 512×512 方形裁剪，尺寸较小无需全尺寸预览；如后续需要可复用同一模式
- **涉及文件**：`AssetManagerModal.tsx`（`AssetGridTabContent` + `ThreeViewTabContent` 均添加 hover 覆盖层 + 预览 Modal + `previewImage` state）

### 14.32 img2img 步数参数优化 + 表情图模糊修复（2026-07-29 新增）

**【重点标记 - 两项联动优化】** 本节记录用户需求驱动的 img2img 两项优化：（1）步数严格遵循用户配置（消除 Forge Neo `img2img_fix_steps` 导致的步数放大）；（2）表情图模糊修复（分辨率 + ADetailer 参数全面优化）。

#### 14.32.1 步数严格遵循用户配置

- **背景**：用户反映 img2img 生成时 Forge Neo 控制台显示步数（如 56）与设置界面配置值（如 28）不符。排查发现代码中**无硬编码 56**——根源是 Forge Neo 的 `img2img_fix_steps` 选项（`shared_options.py:298`，默认 `False`）
- **Forge Neo 步数放大机制**（`sd_samplers_common.py:42-51` `setup_img2img_steps`）：
  - 当 `img2img_fix_steps = True` 时走 if 分支：`steps = int(requested_steps / min(denoising_strength, 0.999))`，如 `int(28 / 0.5) = 56`，进度条显示 56 步
  - 当 `img2img_fix_steps = False`（默认）时走 else 分支：`steps = p.steps`（用户配置值），`t_enc = int(denoising * steps)`，进度条显示用户配置步数
- **问题**：虽然 `img2img_fix_steps` 默认 `False`，但用户可能在 Forge Neo Settings 中手动启用，导致 API 调用时步数被放大
- **修复**：在 `generateExpression`（img2img 路径）的请求体中添加 `override_settings: { img2img_fix_steps: false }`，强制禁用步数放大行为。`override_settings` 是 SD WebUI API 的标准字段，可覆盖 `shared.opts` 中的任何选项，不受 Forge Neo UI 设置影响
- **涉及文件**：`sdGenerationService.ts`（`generateExpression` img2img 请求体添加 `override_settings`）

#### 14.32.2 表情图模糊修复

- **背景**：img2img 生成表情图片高概率模糊。通过分析 Forge Neo 源码与现有参数，定位四个根因
- **根因分析与修复**：

  | # | 根因 | 原值 | 新值 | 修复位置 |
  |---|------|------|------|---------|
  | 1 | img2img 目标分辨率太低（长边仅 512） | `DEFAULT_WIDTH = 512` 作为 `longSideTarget` | 新增 `IMG2IMG_LONG_SIDE_TARGET = 768`，传入 `calculateAspectRatioDimensions` | `sdGenerationService.ts` 常量 + `generateExpression` 调用 |
  | 2 | ADetailer 面部修复分辨率太低（512×512） | `adInpaintWidth/Height = 512`，`adUseInpaintWidthHeight = false`（可选） | `adInpaintWidth/Height = 768`，`adUseInpaintWidthHeight = true`（**强制启用**） | `sdGenerationService.ts` ADetailer args 构建 |
  | 3 | ADetailer 降噪强度过高（0.4 导致面部细节丢失） | `ADETAILER_DENOISING_STRENGTH = 0.4` | `0.3`（保留更多原图面部细节） | `sdGenerationService.ts` 常量 |
  | 4 | ADetailer 蒙版模糊/膨胀太小（过渡不自然） | `ADETAILER_MASK_BLUR = 4`, `ADETAILER_DILATE_ERODE = 4` | `8` / `8`（增大蒙版边缘模糊与膨胀范围） | `sdGenerationService.ts` 常量 |

- **ADetailer 强制启用独立修复尺寸**：原先 `ad_use_inpaint_width_height` 为可选（用户未启用时 ADetailer 使用主图分辨率修复面部），现强制设为 `true` 并使用 `Math.max(options.adInpaintWidth ?? 768, 512)` 兜底。这确保 ADetailer 面部 inpaint 始终在 ≥512 分辨率下进行，即使主图分辨率较低也能获得清晰的面部修复
- **分辨率选择依据**：SDXL 模型原生推荐 1024²，但 img2img 受基底图限制（角色卡 PNG 通常 400×600~512×768），768 是清晰度与生成速度的平衡点。ADetailer 面部修复使用 768×768 方形（面部区域近似正方形）
- **同步更新的默认配置文件**（5 处 `DEFAULT_SD_CONFIG` / `DEFAULT_SD_WEBUI_CONFIG`）：
  - `src/shared/settings.ts`（全局默认配置）
  - `src/renderer/components/Settings/SDWebuiSettings.tsx`（设置面板默认值）
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（素材生成弹窗默认值）
  - `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`（表情生成弹窗默认值）
  - `src/main/services/sdGenerationService.ts`（后端服务默认常量）
- **向后兼容**：已保存旧配置的用户不受影响——后端 `sdGenerationService` 的 `?? ADETAILER_*` 兜底逻辑会使用新常量值。用户在设置界面修改的值仍被尊重（`adInpaintWidth/Height` 兜底 `Math.max(..., 512)` 确保不低于 512）

### 14.33 img2img 高清模式切换：direct / two-step（2026-07-29 新增）

#### 14.33.1 背景与问题分析

**问题**：Forge Neo 的 img2img API 不支持 Hires.fix 高清修复。

通过阅读 Forge Neo 源码确认：
- `StableDiffusionProcessingTxt2Img` 类（`processing.py:1210`）包含 `enable_hr` / `hr_scale` / `hr_upscaler` / `hr_second_pass_steps` / `sample_hr_pass` 等 Hires.fix 字段与方法
- `StableDiffusionProcessingImg2Img` 类（`processing.py:1655`）**完全没有**这些字段，也没有 `sample_hr_pass` 方法
- `img2imgapi` 函数（`api.py:500`）通过 `StableDiffusionProcessingImg2Img(**args)` 构造处理对象，传入的 `enable_hr` 等参数因类中无对应字段而被静默忽略

**此前的问题**：代码在 img2img 路径中注入了 Hires.fix 参数（`enable_hr` / `hr_upscaler` / `hr_second_pass_steps` / `hr_additional_modules`），但这些参数被 Forge Neo 忽略，从未生效。

#### 14.33.2 解决方案：两种替代方案

新增 `img2imgHiresMode` 配置字段，通过两种替代方案实现高清修复：

| 方案 | 流程 | 分辨率 | 降噪强度 | 步数 | 特点 |
|------|------|--------|---------|------|------|
| **direct** | 一步生成 | 1024 | 0.55（用户配置） | 28（用户配置） | 速度快 |
| **two-step**（默认） | 两步放大 | 先 768 → 再 1024 | 0.55 → 0.35 | 28 → 20 | 细节保留好 |

两种方案均启用 ADetailer 面部修复（1024×1024，降噪 0.3）。

**参数针对 NVIDIA RTX PRO 6000 Blackwell（96GB 显存）优化**：
- img2img 目标分辨率从 768 提升至 1024（direct 模式）
- ADetailer 面部修复分辨率从 768 提升至 1024×1024

#### 14.33.3 代码重构

**`sdGenerationService.ts` 核心重构**：
- 提取 `calculateImg2ImgDimensions` 私有方法：按宽高比计算目标尺寸（长边对齐到指定值）
- 提取 `executeImg2ImgPass` 私有方法：执行单次 img2img 请求（构建请求体 + ADetailer + 发送 + 解析响应）
- `generateExpression` 根据 `img2imgHiresMode` 调用 `executeImg2ImgPass` 一次（direct）或两次（two-step）
- 移除 img2img 路径中被忽略的 Hires.fix 参数注入

**新增常量**：
```typescript
const IMG2IMG_DIRECT_TARGET = 1024;           // direct 模式目标分辨率
const IMG2IMG_TWO_STEP_FIRST_TARGET = 768;    // two-step 第一步分辨率
const IMG2IMG_TWO_STEP_SECOND_TARGET = 1024;  // two-step 第二步分辨率
const TWO_STEP_SECOND_DENOISING = 0.35;       // two-step 第二步降噪
const TWO_STEP_SECOND_STEPS = 20;             // two-step 第二步步数
```

**ADetailer 分辨率提升**：`ADETAILER_INPAINT_WIDTH/HEIGHT` 从 768 提升至 1024

#### 14.33.4 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/renderer/types/setting.ts` | `SDWebuiConfig` 新增 `img2imgHiresMode: 'direct' \| 'two-step'` 字段 |
| `src/main/services/sdGenerationService.ts` | 重构 `generateExpression` + 新增 `calculateImg2ImgDimensions` / `executeImg2ImgPass` 私有方法 + 常量更新 |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | 新增「img2img 高清模式」折叠面板（Radio 切换）+ `Radio` 导入 + 默认值 |
| `src/shared/settings.ts` | `DEFAULT_SD_WEBUI_CONFIG` 新增 `img2imgHiresMode` 默认值 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` + `buildSdOptions` 透传 `img2imgHiresMode` |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` + `buildSdOptions` 透传 `img2imgHiresMode` |

### 14.34 生成弹窗质量参数扩展（2026-07-29 新增）

**【重点标记 - 质量参数字段补全】** 本节记录对 `AssetGenerateModal.tsx` 与 `ExpressionGenerateModal.tsx` 两个生成弹窗中 `DEFAULT_SD_CONFIG` 默认值与 `buildSdOptions` 透传字段的扩展，补全采样器调度器、CLIP skip、ADetailer 独立采样器/调度器、Hires.fix 高级参数等质量字段，使前端弹窗在 `setting.sdWebui` 不存在时仍能向后端传递完整的质量参数。

#### 14.34.1 DEFAULT_SD_CONFIG 默认值更新

**采样器相关**：
- `sampler`: `'DPM++ 2M Karras'` → `'DPM++ 3M SDE'`（升级为 SDE 变体采样器，细节表现更佳）
- 新增 `scheduler: 'Karras'`（采样器调度器，与 sampler 配合）
- 新增 `clipSkip: 2`（CLIP 停止层，SDXL 模型常用 2 以跳过最后一层提升质量）

**ADetailer 默认值优化**（面部修复质量提升）：

| 字段 | 原值 | 新值 | 说明 |
|------|------|------|------|
| `adInpaintOnlyMaskedPadding` | 32 | 64 | 增大蒙版外填充，修复区域过渡更自然 |
| `adInpaintWidth` | 768 | 1024 | 面部修复分辨率提升至 1024 |
| `adInpaintHeight` | 768 | 1024 | 面部修复分辨率提升至 1024 |
| `adUseSteps` | false | true | 启用 ADetailer 独立步数 |
| `adSteps` | 20 | 30 | ADetailer 独立步数提升至 30 |
| `adUseCfgScale` | false | true | 启用 ADetailer 独立 CFG |
| `adCfgScale` | 4.0 | 5.0 | ADetailer 独立 CFG 提升至 5.0 |
| `adUseSampler` | false | true | 启用 ADetailer 独立采样器 |
| `adSampler` | `'Use same sampler'` | `'DPM++ 2M SDE'` | ADetailer 使用 SDE 采样器 |
| `adScheduler`（新增） | — | `'Use same scheduler'` | ADetailer 调度器（默认跟随主调度器） |

**Hires.fix 高级参数**（在 `hrNegativePrompt` 后新增 5 个字段）：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `hrCfg` | 5.0 | Hires.fix 独立 CFG |
| `hrSamplerName` | `'DPM++ 2M SDE'` | Hires.fix 独立采样器 |
| `hrScheduler` | `'Karras'` | Hires.fix 独立调度器 |
| `img2imgExtraNoise` | 0.05 | img2img 额外噪声注入 |
| `initialNoiseMultiplier` | 1.0 | 初始噪声乘数 |

**注**：`hrUpscaler` 保持 `'Latent'` 不变（两个弹窗当前值均为 `'Latent'`，依据需求保持）。

#### 14.34.2 buildSdOptions 透传字段扩展

在 `buildSdOptions` 返回对象中新增以下透传字段，确保前端配置能完整传递到后端 `sdGenerationService`：

- `sampler` 后新增：`scheduler` / `clipSkip`
- `adSampler` 后新增：`adScheduler`
- `hrNegativePrompt` 后新增：`hrCfg` / `hrSamplerName` / `hrScheduler` / `img2imgExtraNoise` / `initialNoiseMultiplier`

#### 14.34.3 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 更新采样器/ADetailer/Hires.fix 默认值 + `buildSdOptions` 透传新增质量字段 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 更新采样器/ADetailer/Hires.fix 默认值 + `buildSdOptions` 透传新增质量字段 |

**向后兼容**：`DEFAULT_SD_CONFIG` 作为 `{ ...DEFAULT_SD_CONFIG, ...settingResult.setting.sdWebui }` 的兜底基座，旧配置缺失新字段时自动使用默认值，不会出现 `undefined`。

### 14.35 ADetailer 面部修复专用参数（2026-07-29 源码核验新增）

**【重点标记 - 源码核验驱动】** 本节记录通过直接核验 `G:\AI\sd-webui-forge-neo` 源码发现的两项未被利用的 ADetailer 高价值参数，以及 img2img 不支持 Hires.fix 的源码级确认。

#### 14.35.1 源码核验过程

核验以下源码文件：
- `extensions/ADetailer-Neo/lib_adetailer/args.py:43-85` —— `ADetailerArgs` pydantic 模型完整字段定义
- `modules/processing.py:143-190` —— 基类 `StableDiffusionProcessing` 字段
- `modules/processing.py:1210-1227` —— `StableDiffusionProcessingTxt2Img` 的 Hires.fix 字段
- `modules/processing.py:1655-1677` —— `StableDiffusionProcessingImg2Img` 字段

#### 14.35.2 核验结论：img2img 确认不支持 Hires.fix

| 类 | 文件行号 | 是否含 `enable_hr` / `hr_*` |
|----|---------|---------------------------|
| `StableDiffusionProcessing`（基类） | processing.py:143-190 | ❌ 无 |
| `StableDiffusionProcessingTxt2Img` | processing.py:1210-1227 | ✅ 有（`enable_hr` / `hr_scale` / `hr_upscaler` / `hr_second_pass_steps` / `hr_additional_modules` / `hr_sampler_name` / `hr_scheduler` / `hr_prompt` / `hr_negative_prompt` / `hr_cfg` / `hr_distilled_cfg`） |
| `StableDiffusionProcessingImg2Img` | processing.py:1655-1677 | ❌ 无（仅有 `init_images` / `denoising_strength` / `mask` / `mask_blur` / `inpainting_fill` / `inpaint_full_res` / `initial_noise_multiplier` 等 img2img 专属字段） |

**结论**：img2img API 无法通过 `enable_hr=true` 触发 Hires.fix，§14.33 的 two-step 替代方案是唯一可行路径。

#### 14.35.3 新增 ADetailer 参数

从 `ADetailerArgs`（args.py:43-85）中发现两项未被利用的高价值参数：

| 参数名 | 源码行号 | 类型/范围 | 默认值 | 作用 |
|--------|---------|----------|--------|------|
| `ad_negative_prompt` | args.py:50 | `str` | `""` | ADetailer 独立负面提示词，可针对性优化面部修复 |
| `ad_use_noise_multiplier` | args.py:78 | `bool` | `False` | 是否启用独立噪声倍率 |
| `ad_noise_multiplier` | args.py:79 | `float`（0.5-1.5） | `1.0` | 面部修复噪声注入量，增大可增加细节 |

**改进前**：`ad_negative_prompt` 直接复用主 `negativePrompt`（`executeImg2ImgPass` 中 `ad_negative_prompt: negativePrompt`），无法为面部修复配置专用负面提示词。

**改进后**：
1. `ad_negative_prompt` 优先使用 `options.adNegativePrompt`（若非空），否则回退到主 `negativePrompt`。用户可配置如 "deformed, distorted, disfigured, bad face, wrong anatomy" 专用于面部修复
2. 新增 `ad_use_noise_multiplier = true` + `ad_noise_multiplier = 1.0`，控制面部修复细节丰富度

#### 14.35.4 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/main/services/sdGenerationService.ts` | `SDGenerationOptions` 接口新增 `adNegativePrompt?` / `adUseNoiseMultiplier?` / `adNoiseMultiplier?` 三个字段；`executeImg2ImgPass` 的 ADetailer 构建逻辑修改 `ad_negative_prompt` 取值策略 + 新增噪声倍率注入 |
| `src/renderer/types/setting.ts` | `SDWebuiConfig` 新增 `adNegativePrompt: string` / `adUseNoiseMultiplier: boolean` / `adNoiseMultiplier: number` 类型字段 |
| `src/shared/settings.ts` | `defaultSetting.sdWebui` 新增默认值 `adNegativePrompt: ''` / `adUseNoiseMultiplier: true` / `adNoiseMultiplier: 1.0` |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | `DEFAULT_SD_WEBUI_CONFIG` 新增默认值 + ADetailer 折叠面板内新增 UI 控件（TextArea 负面提示词 + Switch 启用开关 + InputNumber 噪声倍率） |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 新增默认值 + `buildSdOptions` 透传 3 个新字段 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 新增默认值 + `buildSdOptions` 透传 3 个新字段 |

**向后兼容**：旧配置缺失这 3 个新字段时，`sdGenerationService` 的 `??` 兜底逻辑使用默认值（空负面提示词回退主负面、噪声倍率 1.0），行为与改进前一致。

---

### 14.36 按角色独立存储 LoRA 模型（2026-07-29 Bug 修复，用户反复提示后修复）

**【重点标记 - 跨角色 LoRA 污染 Bug】** 本节记录修复 A 角色 LoRA 污染 B 角色生成的完整方案。用户反馈：在 A 角色通过 LoRA 生成图片后，切换到 B 角色生成时 A 角色的 LoRA 被自动带入，违反「每个角色使用单独 LoRA」的设计预期。

#### 14.36.1 Bug 根因分析

原实现将 LoRA 选择存储在全局 `AppSetting.sdWebui.selectedLoras`（`src/shared/settings.ts`）中：

1. 用户在 A 角色的素材管理 Tab 中点击 LoRA 标签 → 打开 `LoraSelectModal` → 选择 LoRA → `onConfirm` 回调执行 `setSdConfig((prev) => ({ ...prev, selectedLoras: loras }))`，仅写入组件本地 state
2. 但生成弹窗（`AssetGenerateModal` / `ExpressionGenerateModal`）初始化时通过 `window.electronAPI.setting.load()` 读取全局配置 `setting.sdWebui`，其中 `selectedLoras` 字段在部分代码路径中可能被持久化到全局设置
3. 切换到 B 角色打开生成弹窗时，`buildSdOptions` 中 `selectedLoras: sdConfig.selectedLoras` 读取到的仍是 A 角色残留的 LoRA 配置，导致污染

**核心问题**：LoRA 配置是「角色维度」的数据（每个角色应有独立的 LoRA 列表），但原实现存储在「全局维度」（`AppSetting.sdWebui`），数据维度不匹配导致跨角色污染。

#### 14.36.2 修复方案：按角色卡独立存储

参考 `characterTraitService`（§14.21）的按角色存储模式，实现 LoRA 配置的角色级隔离：

```
{userData}/data/character-loras/{sha256(characterCardId).slice(0,16)}/loras.json
```

每个角色卡通过 SHA-256 哈希（取前 16 位）生成独立目录，目录内 `loras.json` 存储该角色的 LoRA 清单。

#### 14.36.3 新增文件

| 文件 | 职责 |
|------|------|
| `src/main/services/characterLoraService.ts` | 主进程服务，按角色卡 ID 哈希生成存储路径，提供 `loadLoras` / `saveLoras` 方法。`CharacterLoraManifest` 接口含 `characterCardId` / `version` / `loras` 三字段 |
| `src/main/ipc/handlers/characterLoraHandlers.ts` | IPC 处理器，注册 `character-lora:list` / `character-lora:save` 两个通道 |
| `src/renderer/stores/characterLoraStore.ts` | Zustand store，封装 IPC 调用。`saveLoras` 采用乐观更新 + 失败回滚策略；不使用 persist（数据由主进程持久化到磁盘） |

#### 14.36.4 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/main/preload.ts` | `electronAPI` 新增 `characterLora.{list, save}` 方法，透传 IPC |
| `src/renderer/types/electron.d.ts` | `ElectronAPI` 接口新增 `characterLora` 字段类型定义 |
| `src/main/ipc/index.ts` | 新增 `import { registerCharacterLoraHandlers }` + 调用注册 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | 引入 `useCharacterLoraStore`；LoRA 标签展示 / 删除 / `LoraSelectModal` 的 `selectedLoras` 与 `onConfirm` 均改为角色专属存储 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 引入 `useCharacterLoraStore`；初始化时 `loadCharacterLoras(characterCardId)`；`buildSdOptions` 中 `selectedLoras` 改用 `characterLoras`；`LoraSelectModal` 的 `onConfirm` 改为 `saveCharacterLoras`；LoRA 计数 Tag 改用 `characterLoras.length` |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | 同 `AssetGenerateModal`，全面替换 `sdConfig.selectedLoras` → `characterLoras` |

#### 14.36.5 数据流

```
打开生成弹窗（open=true, characterCardId=xxx）
  → useEffect 初始化：loadCharacterLoras(characterCardId)
  → IPC: character-lora:list → characterLoraService.loadLoras → 读取 loras.json
  → store.loras 更新

用户点击 LoRA 标签 → LoraSelectModal 打开
  → selectedLoras={characterLoras}（角色专属）
  → 用户选择/调整权重 → onConfirm(loras)
  → saveCharacterLoras(characterCardId, loras)
  → IPC: character-lora:save → characterLoraService.saveLoras → 写入 loras.json
  → store.loras 更新（乐观更新）

用户点击「生成」
  → buildSdOptions() → selectedLoras: characterLoras（角色专属，无污染）
  → sd.generateExpression / generateTxt2Img → applyTraitsAndLora 注入 LoRA 标签
```

#### 14.36.6 向后兼容

- 全局 `AppSetting.sdWebui.selectedLoras` 字段保留（`SDWebuiConfig` 类型未删除该字段），但生成弹窗不再读取该字段，仅作为类型兼容保留
- 角色卡首次打开时 `loras.json` 不存在，`loadLoras` 返回空数组 `[]`，行为等同于未选择 LoRA
- `LoraSelectModal` 的 `selectedLoras` prop 类型为 `Array<{ name: string; weight: number }>`，与 `characterLoraStore.LoraItem` 类型一致，无需适配

---

### 14.37 图片生成自定义尺寸选择 SizeSelector（2026-07-29 新增）

- **能力**：渲染进程侧可复用尺寸选择组件，为所有 SD 图片生成弹窗（`AssetGenerateModal` §14.26 / `ExpressionGenerateModal` §14.17）提供预设尺寸下拉 + 自定义宽高输入，每次生成独立应用（不写入全局设置）。
- **文件**：`src/renderer/components/Character/CharacterDialogueChat/SizeSelector.tsx`

#### 14.37.1 预设尺寸

| 预设 | 尺寸 | 适用场景 |
|------|------|---------|
| 头像/表情 | 512×512 | 适合头像和表情图片 |
| 全身立绘 | 512×768 | 适合全身立绘场景 |
| 竖版高清 | 768×1024 | 适合高清立绘/半身像 |
| 方图高清 | 1024×1024 | 适合高质量方图（默认） |
| 竖版超清 | 1024×1536 | 适合超清全身立绘 |
| 横版高清 | 1536×1024 | 适合横构图/宽幅场景 |
| 自定义 | 用户输入 | 手动输入宽高（64-2048） |

预设尺寸设计依据：512 系列适合 SD 1.5 模型及小图快速生成；768/1024/1536 系列覆盖 SDXL 推荐分辨率区间（总像素量 ≈ 1024²），包含竖/方/横三种构图。

#### 14.37.2 交互逻辑

- **预设选择**：Select 下拉选择预设 → 直接 `onChange(width, height)`，即时生效
- **自定义模式**：Select 选择"自定义" → 展示两个 InputNumber（宽/高，min=64 max=2048 step=64），实时校验超范围显示红色边框 + 错误文案
- **当前尺寸 Tag**：始终显示当前宽×高，超范围时变红
- **无确认按钮**：所有变更通过 `onChange` 直接触发

#### 14.37.3 集成方式

**AssetGenerateModal / ExpressionGenerateModal** 均采用相同模式：

1. **新增 state**：`const [selectedSize, setSelectedSize] = useState({ width: 1024, height: 1024 })`
2. **初始化**：init useEffect 中 `setSdConfig(config)` 后，`setSelectedSize({ width: config.txt2imgWidth ?? 1024, height: config.txt2imgHeight ?? 1024 })`（从全局设置默认值读取）
3. **重置**：关闭 useEffect 中 `setSelectedSize({ width: 1024, height: 1024 })`
4. **UI 渲染**：在 `renderHeader()` 之后、`renderSdUnavailableAlert()` 之前渲染 `<SizeSelector>`，所有生成模式（batch / single）均可见
5. **buildSdOptions**：
   - `txt2imgWidth: selectedSize.width`（txt2img 路径，替代 `sdConfig.txt2imgWidth`）
   - `txt2imgHeight: selectedSize.height`（txt2img 路径，替代 `sdConfig.txt2imgHeight`）
   - `width: selectedSize.width`（img2img 路径覆盖，新增）
   - `height: selectedSize.height`（img2img 路径覆盖，新增）
6. **参数概览 Tag**：新增 `<Tag color="geekblue">尺寸：{selectedSize.width}×{selectedSize.height}</Tag>`

#### 14.37.4 后端：img2img 两步模式缩放

修改 `sdGenerationService.calculateImg2ImgDimensions`（§14.32），当用户指定了 `options.width/height` 时，按 `longSideTarget / 1024` 比例缩放：

- **direct 模式**（longSideTarget=1024）：scale=1.0，直接使用用户尺寸
- **two-step pass 1**（longSideTarget=768）：scale=0.75，缩小到 75% 生成（如用户指定 1024×1024 → pass 1 在 768×768 生成）
- **two-step pass 2**（longSideTarget=1024）：scale=1.0，使用完整尺寸放大修复

这样保留了 two-step 模式"低分辨率生成→高分辨率放大修复"的质量优势，同时尊重用户指定的最终输出尺寸。最小尺寸兜底 64 像素。

#### 14.37.5 与全局设置的关系

- 全局设置 `sdWebui.txt2imgWidth/txt2imgHeight`（`SDWebuiSettings.tsx` 中的 InputNumber）**保留不变**，作为 SizeSelector 的初始默认值来源
- SizeSelector 的选择**不回写**全局设置，每次打开弹窗从全局默认值重新初始化
- 这满足"每次生成独立应用，而非全局统一设置"的设计要求

#### 14.37.6 角色特征缓存 Bug 修复（2026-07-29）

【重点标记 - 用户反复提示后修复】修复用户在素材管理「角色特征」Tab 中补充 tag 后，打开图片生成弹窗时 tag 未更新的问题。同时修复 ExpressionGenerateModal 中 `characterTraits` 始终为 `undefined`（遗留 TODO）导致表情生成不携带角色特征的问题。

**根因（两个层面）：**

1. **AssetGenerateModal**：原实现通过 `window.electronAPI.characterTrait.list()` 直接 IPC 读取磁盘数据。用户在特征 Tab 中 `addTrait` / `removeTrait` / `updateTrait` 后仅更新 `characterTraitStore` 本地 state（未持久化到磁盘），生成弹窗读取到的仍是磁盘旧数据，导致新补充的 tag 不可见

2. **ExpressionGenerateModal**：`characterTraits` 变量始终传 `undefined`（遗留 TODO），表情生成的提示词构建中 `{traits}` 占位符替换为空字符串，导致表情生成完全不携带角色特征

**修复方案：**

两个弹窗均改为订阅 `useCharacterTraitStore`，与 `AssetManagerModal` 特征 Tab 共享同一 store state，实时同步未保存的修改：

- **AssetGenerateModal**：
  - 移除直接 IPC 读取（`window.electronAPI.characterTrait.list`），改用 `useCharacterTraitStore()` 订阅 `traits`
  - init useEffect 中仅当 store 的 `currentCharacterCardId` 与当前角色不一致时才 `loadTraits`，避免覆盖 `AssetManagerModal` 中已加载（可能含未保存修改）的 traits
  - `handleImageRecognize` 的识别结果改为通过 `setStoreTraits` 写入 store（与特征 Tab 共享）

- **ExpressionGenerateModal**：
  - 订阅 store 获取 `characterTraits`，`buildSdOptions` 和提示词构建（`buildEmotionPrompt` / 单个模式 useEffect）中传入实际特征数组，替代原 `undefined`

- **依赖数组同步**：`buildSdOptions` / `buildEmotionPrompt` / 提示词预览 useEffect 的依赖数组均新增 `characterTraits`，确保特征变化时重新构建提示词

**缓存问题排查结论：**

全量检查图片生成相关组件（AssetManagerModal / ExpressionManagerModal / CharacterEditModal），确认无其他类似缓存问题——所有特征/LoRA 读取均已改用 Zustand store 订阅模式，不再直接通过 IPC 读取磁盘数据。

**数据流对比：**

```
修复前（AssetGenerateModal）：
  弹窗 open → characterTrait.list(IPC) → 读取磁盘旧数据 → tag 未更新

修复后（AssetGenerateModal）：
  弹窗 open → useCharacterTraitStore 订阅 → 共享 AssetManagerModal 的 store state
  → 实时同步未保存的修改 → tag 即时更新
```

**附带修复：** 移除 `ExpressionGenerateModal.tsx` 中预先存在的未使用变量 `singlePromptPreview`（TS6133 错误），该状态仅被 setter 调用但从未被读取。

**涉及文件：**
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（store 订阅 + init 逻辑 + handleImageRecognize）
- `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`（store 订阅 + buildSdOptions + buildEmotionPrompt + 提示词预览 useEffect + 移除 singlePromptPreview）

### 14.38 工具调用智能体引擎地基：AIService 扩展 + agentTypes.ts（2026-07-29 新增）

为后续智能体功能（工具注册表 / 工具协议适配器 / agentLoop）奠定类型与调用基础。本任务为"方向 0"的第一步，仅做地基扩展，不含 agentLoop 实现逻辑。

#### 14.38.1 修改文件：`src/main/services/AIService.ts`

1. **`ChatMessage` 接口扩展**（向后兼容）：
   - `role` 新增 `'tool'` 枚举值
   - 新增可选字段 `tool_calls?: Array<{ id, type: 'function', function: { name, arguments } }>`
   - 新增可选字段 `tool_call_id?: string`（role:'tool' 时必填）
   - 新增可选字段 `name?: string`（role:'tool' 时工具名）
   - 所有新增字段均为可选，现有构造 ChatMessage 的代码无需改动

2. **`buildRequest` 方法扩展**（向后兼容）：
   - options 新增可选 `tools?: any[]` 与 `tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }`
   - 仅在显式传入时才写入 `requestBody.tools` / `requestBody.tool_choice`
   - 不传时请求体与扩展前完全一致（不出现 tools 字段）

3. **新增 `callChatWithTools` 方法**：
   - 非流式工具调用入口，签名：
     ```typescript
     async callChatWithTools(
       messages: ChatMessage[],
       tools: any[],
       options: CallOptions & { model; temperature; maxTokens; tool_choice? }
     ): Promise<{ content: string; tool_calls?: any[]; finish_reason: string; model: string }>
     ```
   - 参考 `callChatAPI` 的 getConfig/buildRequest/fetch 模式
   - 采用与 `streamChatAPI` 一致的指数退避重试（`maxRetries` 默认 2）
   - `content` 为 null 时规范化为 `''`（模型只返回 tool_calls 无文本时）
   - 响应体含 `error` 字段时抛错（处理 OpenAI 兼容代理在 200 下返回错误的情况）
   - 同时支持 `timeoutMs`（单次超时）与 `abortSignal`（外部取消），通过本地 controller 联动到 fetch signal

4. **无回归保证**：
   - `streamChatAPI` / `callChatAPI` / `enrichSystemPrompt` 实现未改动
   - `enrichSystemPrompt` 的多模态守卫不受影响（role:'tool' 的 content 是字符串，不会进 `index===0 && role==='system'` 分支）

#### 14.38.2 新增文件：`src/main/services/ai/agent/agentTypes.ts`

智能体引擎核心类型定义，供 toolRegistry / toolProtocolAdapter / agentLoop 共用。仅定义类型，不含实现逻辑。主要类型：

| 类型 | 职责 |
|------|------|
| `AgentToolGroup` | 工具组枚举：`'dialogue' \| 'writing' \| 'worldbook'` |
| `AgentToolContext` | 工具执行上下文（characterId / projectId / chatId 等） |
| `ToolCallResult` | 工具执行结果（success / data / error） |
| `AgentTool` | 工具定义（name / description / parameters(JSONSchema) / handler） |
| `ToolCallRequest` | 模型发起的工具调用（统一内部格式，含 raw 原始数据） |
| `ToolCallEvent` | 工具调用事件（推送给前端，含 iteration / durationMs） |
| `AgentLoopResult` | agentLoop 最终结果（finalContent / toolCallHistory / stoppedReason） |
| `AgentLoopCallbacks` | 回调（onToolCall / onFinalChunk / onIteration） |
| `AgentLoopOptions` | 运行选项（maxIterations 默认 8 / supportsToolCalling / streamFinal 等） |
| `AgentLoopParams` | agentLoop 入参（messages / toolGroups / context / options / callbacks） |

#### 14.38.3 验证

- `npx tsc --noEmit` 通过：新增/修改的文件未引入任何新的类型错误
- 注：`AIService.ts` 中 `streamChatAPI` 存在一个预存 TS6133 警告（`errorText` 声明但未使用，行 584），属于原始代码遗留问题，本次任务约束不允许修改 `streamChatAPI` 实现，故未修复

#### 14.38.4 涉及文件

| 文件 | 操作 |
|------|------|
| `src/main/services/AIService.ts` | 修改（扩展 ChatMessage / buildRequest，新增 callChatWithTools） |
| `src/main/services/ai/agent/agentTypes.ts` | 新增（智能体引擎核心类型定义） |

### 14.39 工具协议适配层 toolProtocolAdapter.ts（2026-07-29 新增）

方向 0 第二步：实现协议适配层，统一不同厂商工具调用协议差异。承接 §14.38 的类型地基，为后续 agentLoop 提供协议无关的工具调用编解码能力。本任务为纯新增文件，不修改 agentTypes.ts / AIService.ts / toolRegistry.ts。

#### 14.39.1 新增文件：`src/main/services/ai/agent/toolProtocolAdapter.ts`

无状态纯函数集合，导出单例对象 `toolProtocolAdapter`，含三个方法：

| 方法 | 职责 |
|------|------|
| `buildToolsParam(tools: AgentTool[])` | 将 AgentTool[] 转为 OpenAI 兼容的 tools 请求体（`{type:'function', function:{name, description, parameters}}`）。空数组返回空数组，由调用方决定是否写入请求体 |
| `parseToolCalls(response: any)` | 从 fetch 返回的完整 JSON 中解析 ToolCallRequest[]，兼容两种格式（见下） |
| `buildToolResultMessage(toolCallId, toolName, result)` | 将 ToolCallResult 转为 `role:'tool'` 的 ChatMessage（content 为 `JSON.stringify(result)`，含 tool_call_id / name），用于回填 messages |

#### 14.39.2 parseToolCalls 协议兼容

- **格式 A（OpenAI 新版）**：`response.choices[0].message.tool_calls` 数组，每项取 `id` / `function.name` / `function.arguments`；缺 id 时构造 `fallback_${Date.now()}_${index}`；缺 name 的异常元素跳过（不阻断其余元素）。
- **格式 B（旧版 function_call，单工具）**：`response.choices[0].message.function_call` 对象，构造 fallback id，name / arguments 同上。
- 优先尝试 A，再尝试 B，两者皆无返回 `[]`。每个返回项含 `raw` 字段保留原始 tool_call/function_call 对象供调试。

#### 14.39.3 arguments 解析容错【重点】

`function.arguments` 在协议中是 JSON 字符串，但实际可能遇到：非法 JSON（截断 / 转义错误）、空字符串 / undefined / null、解析后为非对象类型（数组 / 原始值）。`safeParseArguments` 函数**任何情况下都不抛错**：

- 空/非字符串 → `{}`
- 合法普通对象 → 解析后的对象
- 数组/原始值或 JSON.parse 失败 → `{ _raw: 原始字符串 }`，交由工具 handler 自行处理

此设计避免模型返回畸形 arguments 导致整个 agentLoop 崩溃，将容错决策权下放至具体工具 handler。

#### 14.39.4 导出风格

采用对象导出（`export const toolProtocolAdapter = { buildToolsParam, parseToolCalls, buildToolResultMessage }`）。三个方法均为无状态纯函数，对象导出较 class 单例更自然。toolRegistry 尚未实现，其导出风格待其落地时再统一（不影响本模块）。

#### 14.39.5 验证

- `npx tsc --noEmit`：新增文件未引入任何 TS 错误（输出中无 `toolProtocolAdapter` / `agentTypes` 相关错误）
- 项目存在大量预存 TS 错误（src/main/index.ts、各 handlers 等），均为历史遗留，本次任务约束不允许修改其他文件，故未处理
- 严格模式注意事项：`noUnusedLocals` / `noUnusedParameters` 下，`safeParseArguments` 参数声明为 `unknown` 类型以接纳 `tc?.function?.arguments`（`any` 透传）与 `fc.arguments` 两种来源，内部统一类型守卫

#### 14.39.6 涉及文件

| 文件 | 操作 |
|------|------|
| `src/main/services/ai/agent/toolProtocolAdapter.ts` | 新增（工具协议适配层，3 方法 + safeParseArguments 内部工具函数） |
| `CODE_WIKI.md` | 修改（新增 §14.39，附录关键文件索引追加条目） |

### 14.40 工具调用智能体引擎验证用真实工具集（2026-07-30 新增）

方向 0 第三步：实现验证用真实工具集，证明工具调用智能体引擎端到端可用。承接 §14.38（类型地基）与 §14.39（协议适配层），本任务在 `src/main/services/ai/agent/tools/` 目录下新增 4 个文件，复用 `worldBookService` / `chatVectorizationService` 既有方法，**不新建任何数据通路**。

#### 14.40.1 新增文件清单

| 文件 | 组 | 工具 | 真实服务方法（签名） |
|------|------|------|------|
| `tools/dialogueTools.ts` | dialogue | `searchWorldbook` | `worldBookService.matchKeywords(text, worldBookPaths?, options?)` |
| `tools/dialogueTools.ts` | dialogue | `searchChatHistory` | `chatVectorizationService.retrieveChatHistory(chatId, queryText, topK=3, minScore=0.6)` |
| `tools/worldbookTools.ts` | worldbook | `searchEntries` | `worldBookService.searchWorldBookEntriesByVector(query, topK=5)` |
| `tools/writingTools.ts` | writing | `readOutline` | 占位（无服务调用，返回 `{success:false, error}`） |
| `tools/index.ts` | — | — | `registerBuiltinTools()` 聚合入口（幂等，`toolRegistry.registerGroup` 批量注册） |

#### 14.40.2 工具实现要点

- **searchWorldbook**（关键词匹配）：不传 `worldBookPaths`，由 `matchKeywords` 内部遍历全部世界书；`maxResults=5` 限制返回上限。无匹配时返回 `{success:true, data:{entries:[], message:'未找到匹配条目'}}`。条目内容摘要取前 200 字防撑爆上下文。
- **searchChatHistory**（向量检索历史对话）：`chatId` 从 `AgentToolContext.chatId` 获取（任务约束 6）。缺失 chatId 时返回 `{success:false, error:'向量检索不可用或未配置'}`；检索返回空数组时返回 `{success:true, data:{fragments:[], message:'无匹配历史'}}`。`retrieveChatHistory` 内部已做 `minScore=0.6` 阈值过滤与异常吞掉。
- **searchEntries**（世界书条目语义检索）：复用 `worldBookService.searchWorldBookEntriesByVector`（按 `source=worldbook/sourceType=entry` 过滤向量库），与 dialogue 组的 `searchWorldbook`（关键词匹配）互补。`metadata.entryContent` 优先、回退 `metadata.text`。
- **readOutline**（占位）：parameters 为空对象 schema `{type:'object', properties:{}}`，无参数。返回 `{success:false, error:'写作模式尚未接入，readOutline 将在方向 B（写作智能体）中完善'}`。

#### 14.40.3 注册模式【重点】

**改为显式 `registerAllTools()` 函数调用模式**，**不再使用 side-effect（导入即注册）**：

- 每个工具文件导出 `registerXxxTools()` 函数（`registerDialogueTools` / `registerWorldbookTools` / `registerWritingTools`），内部调用 `toolRegistry.register(group, tool)`。
- `tools/index.ts` 导出 `registerAllTools()`，按顺序调用三个注册函数。
- 调用方（如 agentLoop 初始化处）需显式调用 `registerAllTools()` 才能完成注册。
- 设计动机：side-effect 注册会带来初始化时序不确定性（import 顺序决定注册顺序），显式函数调用让注册时机完全可控；同时 `toolRegistry.register` 同名检测会抛错，重复调用 `registerAllTools()` 会立即暴露问题（测试场景需先 `toolRegistry.clear()`）。

#### 14.40.4 容错与约束

- **所有 handler 内部 try-catch**：失败返回 `{success:false, error}`，绝不抛出到 agentLoop（任务约束 2）。
- **parameters 严格 JSONSchema**：`type` / `properties` / `required` 完整。`searchChatHistory` / `searchEntries` 仅暴露 `query` 参数（topK 固化为常量 `DEFAULT_TOP_K=5`，避免模型误传非法值）。
- **复用现有服务单例**：直接 `import { worldBookService }` / `import { chatVectorizationService }`，不新建数据通路（任务约束 4）。
- **代码风格**：无分号、单引号、2 空格缩进、中文注释（与 toolRegistry.ts 一致）。

#### 14.40.5 验证

- `npx tsc --noEmit`：`src/main/services/ai/agent/` 目录下零错误（输出中无 `agent` 相关错误）。
- 项目其他预存 TS 错误（`AIService.ts` 行 584 `errorText` 未使用、`MarkdownAITools.tsx` 等）均为历史遗留，与本次任务无关。
- **修复记录**：dialogueTools.ts 初版 `searchWorldbookTool` 的 handler 声明了 `context?: AgentToolContext` 但未使用，触发 `TS6133`。修复方式：在函数体内加 `void context` 显式标记"保留参数以备后续扩展"（保留签名与 AgentTool 类型对齐，便于未来注入 characterId 做角色过滤）。

#### 14.40.6 后续完善占位点

| 工具 | 占位内容 | 完善方向 |
|------|------|------|
| `readOutline` | 整体占位，无服务调用 | 方向 B（写作智能体）：读取写作项目大纲（`WritingProjectRepository` / `outlineService` 等） |
| `searchWorldbook` characterId 过滤 | 当前不参与 worldBookService 过滤 | 后续可按角色卡激活/排除特定世界书 |
| `searchChatHistory` 向量化禁用区分 | 当前 `retrieveChatHistory` 返回空数组无法区分"无匹配"与"向量化禁用" | 若需区分，需扩展 ChatVectorizationService 返回值或 handler 内部预检 `vectorConfig.embeddingMode` |

#### 14.40.7 涉及文件

| 文件 | 操作 |
|------|------|
| `src/main/services/ai/agent/tools/dialogueTools.ts` | 新增（dialogue 组 2 工具：searchWorldbook / searchChatHistory） |
| `src/main/services/ai/agent/tools/worldbookTools.ts` | 新增（worldbook 组 1 工具：searchEntries） |
| `src/main/services/ai/agent/tools/writingTools.ts` | 新增（writing 组 1 占位工具：readOutline） |
| `src/main/services/ai/agent/tools/index.ts` | 新增（registerBuiltinTools 聚合入口，幂等批量注册） |
| `CODE_WIKI.md` | 修改（新增 §14.40，目录结构 §3 补充 tools 子目录，附录关键文件索引追加 4 条） |

### 14.41 工具调用智能体引擎收口：agentLoop + IPC 层 + Agent 模式开关（方向 0 落地，2026-07-30 新增）

方向 0 第四步（收口）：在 §14.38（类型地基）/ §14.39（协议适配）/ §14.40（验证工具）之上补齐**核心循环 `agentLoop.ts`**、**工具注册中心 `toolRegistry.ts`**、**IPC 层 `agentHandlers.ts`** 与 **`enableAgentMode` 全局开关**，完成端到端链路。本任务后「方向 0」全貌可用，且对现有功能零影响（开关默认关 + 模型不支持时自动降级）。本节同时作为方向 0 的**架构总览**，串联 §14.38-14.40 各组件。

#### 14.41.1 方向 0 整体架构

```
渲染进程 (Renderer)
  window.electronAPI.ai.runAgentTurn(params)  ──►  ai:runAgentTurn (ipcMain.handle)
  window.electronAPI.ai.onAgentToolCall(cb)   ◄──  ai:agentToolCall (event.sender.send)
        │
        ▼
主进程 agentHandlers.ts
  1. registerBuiltinTools()              ◄── tools/index.ts（幂等，仅注册一次）
  2. computeEffectiveSupportsToolCalling()
       = enableAgentMode && engine.capabilities.supportsToolCalling
  3. runAgentLoop({ messages, toolGroups, context, options:{...,supportsToolCalling}, callbacks })
        │
        ▼
agentLoop.ts  runAgentLoop()
  ├─ 降级检查 1：supportsToolCalling=false/undefined  ─► runPlainTextFallback → streamChatAPI（零行为变更）
  ├─ 降级检查 2：toolRegistry.getTools(toolGroups) 为空 ─► runPlainTextFallback
  ├─ toolProtocolAdapter.buildToolsParam(tools)        （§14.39）
  └─ 迭代循环（maxIterations 默认 8）：
       1. aiService.callChatWithTools(messages, toolsParam, opts)   （§14.38）
       2. toolProtocolAdapter.parseToolCalls(wrappedResponse)       （§14.39）
       3. 无 tool_calls → streamChatAPI 流式生成最终回复（streamFinal≠false）→ 返回 completed
       4. 有 tool_calls → 追加 assistant 消息 → Promise.all 并行执行（去重缓存 + try-catch）
          → toolProtocolAdapter.buildToolResultMessage 回填 → 触发 onToolCall 回调 → 下一轮
```

#### 14.41.2 新增文件：`src/main/services/ai/agent/toolRegistry.ts`

工具注册中心，导出单例 `toolRegistry`（`ToolRegistry` 类实例）。内部维护三张 Map：

| Map | 键 | 值 | 用途 |
|-----|----|----|------|
| `tools` | 工具名 `string` | `AgentTool` | 工具名 → 工具定义（含 handler） |
| `toolGroups` | 工具名 `string` | `AgentToolGroup` | 工具名 → 所属组 |
| `groupTools` | `AgentToolGroup` | `string[]` | 组名 → 工具名列表（保持注册顺序） |

| 方法 | 说明 |
|------|------|
| `register(group, tool)` | 注册单个工具；**同名工具重复注册抛错**（`工具「{name}」已注册，不可重复注册`），让冲突在注册期暴露 |
| `registerGroup(group, tools)` | 批量注册（内部循环 `register`），供 `tools/index.ts` 聚合调用 |
| `getTool(name)` | 按名取工具定义，不存在返回 `undefined` |
| `hasTool(name)` | 判断工具是否已注册 |
| `getTools(groups)` | 按组取工具列表；多组查询时按组顺序合并并**去重**（同一工具名只出现一次），保持注册顺序 |
| `listAll()` | 列出全部已注册工具（调试用），返回 `{ tool, group }[]` |
| `clear()` | 清空所有注册（主要供测试用） |

设计要点：防重复注册采用「抛错」而非「静默覆盖」——工具名是 `agentLoop` 解析工具调用的唯一键，重复注册会导致执行器不确定，必须在注册期暴露问题。日志使用 `createLogger('agent-registry')`，每次 `register` 输出 `已注册工具: {name} (组: {group})` info 日志。

#### 14.41.3 新增文件：`src/main/services/ai/agent/agentLoop.ts`

引擎心脏，导出 `runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult>`。核心机制：

| 机制 | 实现 |
|------|------|
| **降级检查 1** | `options.supportsToolCalling` 为 falsy 时直接 `runPlainTextFallback`（`streamChatAPI` 不带 tools），返回 `{toolCallHistory:[], iterations:0, stoppedReason:'completed'}`，与扩展前纯文本生成完全等价 |
| **降级检查 2** | `toolRegistry.getTools(toolGroups)` 返回空数组时同样降级，避免带空 tools 数组请求模型 |
| **迭代上限** | `maxIterations` 默认 8（`DEFAULT_MAX_ITERATIONS`）；达到上限返回 `stoppedReason:'max_iterations'`，`finalContent` 取最后一次响应内容（避免空内容丢失信息） |
| **去重缓存** | `dedupCache = Map<string, ToolCallEvent>`，key = `${tc.name}:${JSON.stringify(tc.arguments)}`；同工具+同参数命中缓存直接复用，仅更新 iteration 标记，避免模型重复调用相同工具 |
| **并行执行** | `Promise.all(toolCalls.map(...))` 并行执行所有 tool_calls；每个 handler 独立 try-catch，失败回填 `{success:false, error}` 给模型，循环继续；handler 抛错**不崩循环** |
| **未注册工具** | `toolRegistry.getTool(name)` 返回 `undefined` 时，回填 `{success:false, error:'工具「{name}」未注册'}`，不崩循环 |
| **取消支持** | 每轮迭代开始前检查 `options.abortSignal?.aborted`，命中返回 `stoppedReason:'aborted'`；`abortSignal` 透传至 `callChatWithTools` / `streamChatAPI` |
| **流式最终回复** | 无 tool_calls 时，`streamFinal !== false`（含 undefined 默认 true）→ 用 `streamChatAPI` 重新流式生成最终回复并通过 `onFinalChunk` 推送，让前端获得真实流式体验；`streamFinal === false` → 直接用 `callChatWithTools` 已返回的 content，省一次调用但仍通过 `onFinalChunk` 推送一次完整内容 |
| **消息不可变** | 用 `workingMessages = [...messages]` 副本循环追加，避免修改入参（防止调用方复用 messages 时被污染） |
| **整体 try-catch** | 整个循环过程包裹 try-catch，任何未预期错误（callChatWithTools / parseToolCalls 等抛错）统一返回 `stoppedReason:'error'` + `error` 字段，不向调用方抛出 |

`runPlainTextFallback` 不捕获 `streamChatAPI` 异常——保持与现有调用方一致的错误传播行为（`streamChatAPI` 内部已有重试逻辑，重试耗尽后抛错由调用方处理）。

#### 14.41.4 新增文件：`src/main/ipc/handlers/agentHandlers.ts`

方向 0 最后一层，暴露智能体引擎给前端。导出 `registerAgentHandlers()`，由 `ipc/index.ts` 的 `setupIpcHandlers()` 调用。注册模式参照 `registerCharacterTraitAIHandlers()` / `registerLoraHandlers()`。

| 通道 | 类型 | 说明 |
|------|------|------|
| `ai:runAgentTurn` | `ipcMain.handle` | 运行一轮智能体循环，返回 `AgentLoopResult`。参数：`{ messages, toolGroups, context?, options:{model, temperature, maxTokens, maxIterations?, tool_choice?, streamFinal?} }` |
| `ai:agentToolCall` | 事件推送 | `onToolCall` 回调内通过 `event.sender.send('ai:agentToolCall', event)` 推送 `ToolCallEvent` 给前端；`event.sender.isDestroyed()` 检查避免渲染进程已销毁时抛错 |

**关键设计——`effectiveSupportsToolCalling`（增量零影响的总开关）**：

```
effectiveSupportsToolCalling = enableAgentMode === true
                            && engine.capabilities.supportsToolCalling === true
```

- `enableAgentMode` 从 `getStorageService().getSettings().enableAgentMode` 读取（默认 `false`，确保现有功能零影响）
- `supportsToolCalling` 从 `AIConfigProvider.getInstance().getActiveEngine().capabilities.supportsToolCalling` 获取
- 任一条件不满足则 `effectiveSupportsToolCalling=false`，传入 `runAgentLoop` 后由降级检查 1 接管，走纯文本路径
- handler 外层 try-catch 兜底，异常时返回 `stoppedReason:'error'` 的 `AgentLoopResult`，保证渲染进程永不收到 reject

注意：`supportsToolCalling` 由 handler 计算（不由调用方传入），前端无法绕过开关强制启用工具调用。

#### 14.41.5 【重点标记 - worldbookTools 导出 Bug 修复】

> 本 Bug 在实现过程中被发现并修复，按用户规则重点标记。

- **现象**：`tools/index.ts` 导入 `worldbookTools` 并调用 `toolRegistry.registerGroup('worldbook', worldbookTools)` 时失败。`registerGroup` 期望第二个参数是 `AgentTool[]` 数组并对每项调用 `register`，但初版 `worldbookTools.ts` 按函数模式导出（`export function registerWorldbookTools()`），导致 `worldbookTools` 是函数而非数组，`registerGroup` 内部 `for (const tool of tools)` 对函数迭代行为异常 / 类型不匹配，注册链路断裂。
- **根因**：§14.40.3 最初设计为「每个工具文件导出 `registerXxxTools()` 函数，由 `tools/index.ts` 顺序调用」的函数注册模式；后续为实现简洁性与 `registerGroup` 批量注册能力，将 `tools/index.ts` 改为「按数组导入 + `registerGroup` 批量注册」模式，但 `worldbookTools.ts` 未同步改为数组导出，产生模式不一致。
- **修复**：将 `worldbookTools.ts` 改为导出 `AgentTool[]` 数组：
  ```typescript
  export const worldbookTools: AgentTool[] = [searchEntriesTool]
  ```
  `dialogueTools.ts` / `writingTools.ts` 同步保持数组导出（`export const dialogueTools: AgentTool[] = [...]` / `export const writingTools: AgentTool[] = [...]`）。
- **最终注册机制（已修正 §14.40.3 描述）**：`tools/index.ts` 导出 `registerBuiltinTools()`，内部通过 module-level `registered` 标志保证幂等（仅注册一次），按顺序调用 `toolRegistry.registerGroup('dialogue', dialogueTools)` / `registerGroup('worldbook', worldbookTools)` / `registerGroup('writing', writingTools)`。`toolRegistry.register` 同名检测会抛错，`registered` 标志从源头避免重复调用路径（测试场景需先 `toolRegistry.clear()`）。
- **教训**：注册机制变更需同步所有工具文件的导出风格；函数模式与数组模式不可混用。`registerGroup` + 数组导出的组合更简洁，最终被采纳为方向 0 的统一注册模式。

> ⚠️ **对 §14.40.3 的修正**：§14.40.3 描述的「`registerXxxTools()` 函数调用模式」为初版设计，已被本节描述的「数组导出 + `registerGroup` 批量注册」模式取代。§14.40.3 保留作历史记录，以最终实现（`tools/index.ts` + 各工具文件数组导出）为准。

#### 14.41.6 Agent 模式全局开关 `enableAgentMode`

| 文件 | 改动 |
|------|------|
| `src/shared/settings.ts` | 默认值 `enableAgentMode: false`（行 176，确保现有功能零影响） |
| `src/renderer/types/setting.ts` | `AppSettings` 接口新增 `enableAgentMode: boolean` 字段（行 383） |
| `src/renderer/components/Settings/AIEngineSettingsPanel.tsx` | 新增「Agent 模式」`Form.Item`（`name="enableAgentMode"` / `valuePropName="checked"` / `initialValue={false}`），控件为 `<Switch />`，extra 提示「启用 Agent 模式（需模型支持工具调用，否则自动降级为文本模式）」（行 204-212） |
| `src/renderer/components/Settings/Settings.tsx` | 加载时 `enableAgentMode: setting.enableAgentMode ?? false`（行 143），保存时 `enableAgentMode: values.enableAgentMode ?? false`（行 238），双端 `?? false` 兜底防止 undefined |

开关关闭时，`agentHandlers.ts` 的 `computeEffectiveSupportsToolCalling()` 返回 `false`，`runAgentLoop` 走降级路径，行为与升级前完全一致。

#### 14.41.7 Preload / 类型 / 注册接线

| 文件 | 改动 |
|------|------|
| `src/main/preload.ts` | `electronAPI.ai` 新增 `runAgentTurn(params)` → `ipcRenderer.invoke('ai:runAgentTurn', params)`；新增 `onAgentToolCall(callback)` → `ipcRenderer.on('ai:agentToolCall', handler)`，返回 unsubscribe 函数（`ipcRenderer.removeListener`）（行 228-247） |
| `src/renderer/types/electron.d.ts` | `ElectronAPI.ai` 接口新增 `runAgentTurn` / `onAgentToolCall` 类型声明，含 `AgentLoopParams` / `ToolCallEvent` / `AgentLoopResult` 等类型（行 266-289） |
| `src/main/ipc/index.ts` | 导入 `registerAgentHandlers`（行 25），在 `setupIpcHandlers()` 中调用 `registerAgentHandlers()`（行 85），位于 `aiHandlers` 注册之后 |

#### 14.41.8 可观测性

- **三类回调**（`AgentLoopCallbacks`）：`onToolCall(event)` 工具调用事件 / `onFinalChunk(chunk)` 最终回复流式 chunk / `onIteration(n)` 每轮迭代开始
- **三个 logger 命名空间**：`agent-loop`（循环主体）/ `agent-handler`（IPC 层）/ `agent-registry`（注册中心），均通过 `createLogger` 创建，与项目其他服务一致
- **前端订阅**：渲染进程通过 `window.electronAPI.ai.onAgentToolCall(cb)` 订阅工具调用事件，可在 UI 展示工具调用过程（迭代序号 / 工具名 / 参数 / 结果 / 耗时 `durationMs`）

#### 14.41.9 后续方向 A/B/C 衔接点

方向 0 作为共享底座，后续三个方向在其上扩展：

| 方向 | 衔接点 | 当前状态 |
|------|--------|---------|
| **方向 A（对话智能体）** | 在角色对话流程中调用 `ai.runAgentTurn`，启用 `dialogue` + `worldbook` 工具组；`searchWorldbook` / `searchChatHistory` 已就绪 | 工具就绪，对话流程接入待方向 A |
| **方向 B（写作智能体）** | 在写作模式中调用 `ai.runAgentTurn`，启用 `writing` 工具组；`readOutline` 当前为占位（返回 `{success:false, error}`），需接入 `WritingProjectRepository` / `outlineService` | 占位待完善 |
| **方向 C（世界书智能体）** | 在世界书管理中调用 `ai.runAgentTurn`，启用 `worldbook` 工具组；`searchEntries` 已就绪 | 工具就绪，管理流程接入待方向 C |

#### 14.41.10 验证

- `npx tsc --noEmit`：`src/main/services/ai/agent/` 与 `src/main/ipc/handlers/agentHandlers.ts` 零新增类型错误
- 项目其他预存 TS 错误（`AIService.ts` 行 584 `errorText` 未使用、`src/main/index.ts` 等）均为历史遗留，与本次任务无关
- 增量零影响验证：`enableAgentMode` 默认 `false` + 降级路径，开关关闭时与升级前行为完全一致

#### 14.41.11 涉及文件

| 文件 | 操作 |
|------|------|
| `src/main/services/ai/agent/toolRegistry.ts` | 新增（工具注册中心单例，防重复注册 + 顺序保持 + 多组去重查询） |
| `src/main/services/ai/agent/agentLoop.ts` | 新增（核心循环 `runAgentLoop` + 降级路径 `runPlainTextFallback`） |
| `src/main/ipc/handlers/agentHandlers.ts` | 新增（`ai:runAgentTurn` + `ai:agentToolCall`，`effectiveSupportsToolCalling` 计算） |
| `src/main/preload.ts` | 修改（暴露 `ai.runAgentTurn` / `ai.onAgentToolCall`） |
| `src/renderer/types/electron.d.ts` | 修改（类型声明） |
| `src/main/ipc/index.ts` | 修改（导入并调用 `registerAgentHandlers()`） |
| `src/shared/settings.ts` | 修改（`enableAgentMode` 默认 `false`） |
| `src/renderer/types/setting.ts` | 修改（`enableAgentMode: boolean` 类型） |
| `src/renderer/components/Settings/AIEngineSettingsPanel.tsx` | 修改（「Agent 模式」Switch UI） |
| `src/renderer/components/Settings/Settings.tsx` | 修改（加载/保存 `?? false` 兜底） |
| `src/main/services/ai/agent/tools/worldbookTools.ts` | 修改（修复导出：函数 → 数组，见 §14.41.5） |
| `CODE_WIKI.md` | 修改（新增 §14.41，附录关键文件索引追加 4 条） |

---

### 14.42 技能库系统类型地基：skillTypes.ts（2026-07-30 新增）

为后续「Agent 技能库」（对标 OpenClaw skill 管理体系）奠定类型基础。技能是结构化的可复用能力单元，**高于工具（AgentTool）一层**：工具是单函数调用，技能可组合多工具 + 提示词模板 + 执行逻辑。本任务为纯新增类型文件，不含实现逻辑，从 `agentTypes.ts` 复用 `AgentToolContext`（type-only import）。

#### 14.42.1 新增文件：`src/main/services/ai/agent/skill/skillTypes.ts`

仅定义类型，不含实现逻辑。主要类型：

| 类型 | 说明 |
|------|------|
| `SkillCategory` | 技能分类：`'dialogue' \| 'writing' \| 'worldbook' \| 'general'`（与工具组对齐 + general 兜底） |
| `SkillType` | 技能实现类型：`'prompt'`（提示词模板）/ `'tool-sequence'`（有序工具步骤）/ `'composite'`（代码 handler） |
| `SkillSource` | 技能来源：`'system' \| 'user' \| 'agent'`（agent 标记 Agent 自动生成） |
| `SkillManifest` | 技能清单（标准化定义）：id（kebab-case）/ name / description / category / version（semver）/ author / tags / enabled / inputSchema(JSONSchema) / outputSchema? / type + implementation / requiredTools? / requiredSkills? / examples? / createdAt / updatedAt / autoGenerated? |
| `SkillImplementation` | 技能实现：`prompt?`（systemPrompt + userPromptTemplate，支持 `{{var}}` 插值）/ `steps?`（tool-sequence 类型有序步骤）/ `handlerRef?`（composite 类型在 skillExecutor 注册的 handler 引用名） |
| `SkillStep` | 技能步骤：toolName（AgentTool name）/ argsTemplate（可引用 `{{step.resultKey}}` 或 `{{input.xxx}}`）/ resultKey（供后续步骤引用）/ optional?（失败是否继续，默认 false） |
| `SkillExample` | 少样本示例：input / output / description?（供 Agent 理解调用方式） |
| `SkillResult` | 技能调用结果：success / data? / error? / trace?（每步结果的执行轨迹，含 step / result / durationMs） |
| `SkillVersionEntry` | 技能版本历史条目：version / manifest / createdAt / changeLog? |
| `SkillSummary` | 技能摘要（供 Agent 发现与决策）：id / name / description / category / version / type |
| `SkillInvocation` | 技能调用入参：id / input / context?（复用 `AgentToolContext`） |

#### 14.42.2 设计要点

- **层级关系**：技能 > 工具。`SkillStep.toolName` 引用 `AgentTool.name`，`SkillManifest.requiredTools` 声明工具依赖，与 §14.38-14.41 的工具体系无缝衔接。
- **三种实现类型**：
  - `prompt`：纯提示词模板，`{{var}}` 插值由后续 skillExecutor 实现
  - `tool-sequence`：有序步骤，步骤间通过 `resultKey` 传递结果
  - `composite`：复杂逻辑通过 `handlerRef` 引用注册的代码 handler
- **Agent 自治**：`SkillSource` 含 `'agent'` 值 + `autoGenerated` 标记，支持 Agent 自动生成技能并入库
- **可发现性**：`SkillSummary` 精简字段供 Agent 在决策阶段快速扫描；`SkillManifest.examples` 提供少样本帮助 Agent 理解调用方式
- **版本管理**：`SkillVersionEntry` + semver `version` 字段，为后续技能版本回滚/A-B 测试留接口

#### 14.42.3 验证

- `npx tsc --noEmit`：`skillTypes.ts` 零类型错误（用 `Select-String -Pattern "skillTypes"` 过滤无匹配）
- 项目其他预存 TS 错误（`AIService.ts` / `src/main/index.ts` 等）均为历史遗留，与本次任务无关
- 仅定义类型，无运行时逻辑，对现有功能零影响

#### 14.42.4 涉及文件

| 文件 | 操作 |
|------|------|
| `src/main/services/ai/agent/skill/skillTypes.ts` | 新增（技能库系统核心类型定义，从 `agentTypes.ts` 导入 `AgentToolContext`） |
| `CODE_WIKI.md` | 修改（新增 §14.42，附录关键文件索引追加 1 条，目录树追加 `skill/` 子目录） |

---

### 14.43 Agent 技能库/记忆/学习 IPC + preload + 类型声明（Spec: add-agent-skill-and-memory-foundation / Task 12，2026-07-30 新增）

在 Tasks 3-10 已建好的 `skillService` / `memoryService` / `agentLearningService` 之上，补齐「主进程 → 渲染进程」的 IPC 暴露层。让前端能完整管理技能库（CRUD / 调用 / 发现 / 版本管理 / 导入导出）、记录与检索 Agent 长期记忆（语义检索 / 字段过滤 / 三类记忆分发记录 / RAG 召回）、触发自我学习闭环（整合 / 决策优化 / 反馈 / 模式提取）。

#### 14.43.1 命名空间隔离设计（核心约束）

项目中**已存在** `src/main/ipc/handlers/memoryHandlers.ts`（旧聊天/表格记忆系统）+ preload `memory:` 命名空间 + `memory:` IPC 通道前缀。为避免任何通道与命名冲突，本次新增三类通道使用**完全独立**的前缀与命名空间：

| 系统 | 通道前缀 | preload 命名空间 | 注册函数 |
|------|----------|------------------|----------|
| 旧聊天/表格记忆（已存在） | `memory:` | `memory` | `registerMemoryHandlers()` |
| Agent 技能库（新） | `agent-skill:` | `agentSkill` | `registerAgentSkillHandlers()` |
| Agent 长期记忆（新） | `agent-memory:` | `agentMemory` | `registerAgentMemoryHandlers()` |
| Agent 自我学习（新） | `agent-learning:` | `agentLearning` | `registerAgentLearningHandlers()` |

`memoryService.searchMemories` 内部已路由到 `source='agent-memory'` 的 backend，与旧 `chatVector` / `chatHistory` 等向量源物理隔离，不会混淆。

#### 14.43.2 新增文件 1：`src/main/ipc/handlers/agentSkillHandlers.ts`

导出 `registerAgentSkillHandlers(): void`，注册 11 个 `agent-skill:*` 通道（全部 `ipcMain.handle`）：

| 通道 | 参数 | 委托方法 | 返回 |
|------|------|----------|------|
| `agent-skill:list` | `{category?, enabledOnly?}` | `skillService.listSkills(category, enabledOnly)` | `{success, data: SkillManifest[]}` |
| `agent-skill:get` | `{id}` | `skillService.getSkill(id)` | `{success, data?: SkillManifest}` |
| `agent-skill:create` | `{manifest}` | `skillService.registerSkill(manifest)` | `{success}` |
| `agent-skill:update` | `{manifest}` | `skillService.registerSkill(manifest)`（更新语义） | `{success}` |
| `agent-skill:delete` | `{id}` | `skillService.unregisterSkill(id)` | `{success}` |
| `agent-skill:invoke` | `{id, input, context?}` | `skillService.invokeSkill(id, input, context)` | `SkillResult`（含 success/data/error/trace） |
| `agent-skill:discover` | `{query, category?}` | `skillService.discoverSkills(query, category)` | `{success, data: SkillSummary[]}` |
| `agent-skill:history` | `{id}` | `skillService.getSkillHistory(id)` | `{success, data: SkillVersionEntry[]}` |
| `agent-skill:rollback` | `{id, version}` | `skillService.rollbackSkill(id, version)` | `{success}` |
| `agent-skill:import` | `{json}` | `skillService.importSkill(json)` | `{success}` |
| `agent-skill:export` | `{id}` | `skillService.exportSkill(id)` | `{success, data: string}` |

`create` 与 `update` 均委托 `skillService.registerSkill`（其内部处理更新语义：id 已存在则先 unregister 再 register，绕开 skillRegistry 的同 id 防重复校验）。register 入口调用幂等的 `skillService.initialize()`（`.catch()` 兜底，避免初始化失败阻塞 IPC 注册）。

#### 14.43.3 新增文件 2：`src/main/ipc/handlers/agentMemoryHandlers.ts`

导出 `registerAgentMemoryHandlers(): void`，注册 5 个 `agent-memory:*` 通道：

| 通道 | 参数 | 委托方法 | 说明 |
|------|------|----------|------|
| `agent-memory:search` | `{query, type?, topK?}` | `memoryService.searchMemories(query, type, topK)` | 向量语义检索，可在结果上按 type 过滤 |
| `agent-memory:query` | `{filter}` | `memoryService.queryMemories(filter)` | 非向量字段过滤（type/tags/taskType/characterId/projectId） |
| `agent-memory:record` | `{content, type, metadata?}` | 按 type 分发（见下） | 三类记忆分发记录 |
| `agent-memory:delete` | `{id}` | `memoryService.deleteMemory(id)` | 删除记忆 + 同步清理向量 |
| `agent-memory:getRelevant` | `{context, taskDescription, topK?}` | `memoryService.getRelevantMemories(context, taskDescription, topK)` | RAG 召回入口 |

**`record` 通道分发逻辑**（按 `type` 字段）：
- `episodic`：从 `metadata` 构造 `LearningEvent`（必填字段 taskType/toolCalls/outcome/timestamp 缺失时使用合理默认值 `unknown`/`[]`/`success`/`Date.now()`），调用 `recordEpisodicMemory(event)`
- `semantic`：调用 `recordSemanticMemory(content, metadata?.pattern || 'general', metadata?.derivedFrom)`
- `procedural`：调用 `recordProceduralMemory(metadata?.skillId || 'unknown', content)`

register 入口调用幂等的 `memoryService.initialize()`（`.catch()` 兜底）。

#### 14.43.4 新增文件 3：`src/main/ipc/handlers/agentLearningHandlers.ts`

导出 `registerAgentLearningHandlers(): void`，注册 4 个 `agent-learning:*` 通道：

| 通道 | 参数 | 委托方法 | 返回 |
|------|------|----------|------|
| `agent-learning:consolidate` | `{}` | `agentLearningService.consolidate()` | `{success, data: ConsolidationStats}` |
| `agent-learning:optimize` | `{taskType, taskDescription, context?}` | `agentLearningService.optimizeDecision(taskType, taskDescription, context)` | `{success, data: DecisionOptimization}` |
| `agent-learning:feedback` | `{memoryId, feedback}` | `agentLearningService.applyFeedback(memoryId, feedback)` | `{success}` |
| `agent-learning:extractPatterns` | `{taskType?}` | `agentLearningService.extractPatterns(taskType)` | `{success, data: AgentMemory[]}` |

`agentLearningService` 内部已通过 `memoryService` 间接初始化（依赖注入），不在此处显式调用 initialize。

#### 14.43.5 错误兜底与代码风格

参照 `agentHandlers.ts` 风格：
- 每个 handler try-catch 包裹，异常时返回 `{ success: false, error }` 结构化错误，渲染进程永不收到 reject
- 文件头 Chinese JSDoc 注释列出全部通道 + 设计要点 + 命名空间隔离说明
- 使用 `createLogger` from `../../services/logger`（与 agentHandlers.ts 一致）
- handler 参数使用具体类型（`SkillManifest` / `MemoryType` / `MemoryQueryFilter` / `MemoryFeedback` / `AgentToolContext`），仅在 preload/electron.d.ts 层降级为 `any`（与现有文件实用风格一致）

#### 14.43.6 preload.ts 与 electron.d.ts 改动

- `preload.ts`：在 `ai: {...}` 命名空间后新增 `agentSkill` / `agentMemory` / `agentLearning` 三个命名空间，每个方法调用 `ipcRenderer.invoke('channel', ...args)`，参数包装为 `{ ... }` 对象（与 `ai:` 命名空间风格一致）
- `electron.d.ts`：在 `ElectronAPI` 接口的 `ai: {...}` 声明块后新增三个类型声明块，复杂类型使用 `any`（与现有 `sd:` / `expression:` 等命名空间实用风格一致）

#### 14.43.7 ipc/index.ts 注册

在 `registerAgentHandlers()` 调用后追加三次注册调用，附中文注释说明命名空间隔离设计：

```typescript
// Agent 技能库与长期记忆系统 IPC（Spec: add-agent-skill-and-memory-foundation / Task 12）
// 暴露 agent-skill:* / agent-memory:* / agent-learning:* 通道（与现有 memory:* 旧记忆系统物理隔离）
registerAgentSkillHandlers();
registerAgentMemoryHandlers();
registerAgentLearningHandlers();
```

#### 14.43.8 验证

- `npx tsc --noEmit --pretty false` 过滤 `agentSkillHandlers|agentMemoryHandlers|agentLearningHandlers|preload.ts|electron.d.ts|ipc/index` 后，新增文件 0 个错误
- 仅 `ipc/index.ts(1,1)`（TS6133 ipcMain 未使用）与 `preload.ts(45,43)`（TS2345 subscription 类型）两个预存错误，经 `git stash` 验证为本次改动前已存在，非本次引入
- 命名空间隔离验证：`memory:` 前缀的旧通道与 `agent-memory:` 等新通道无重叠；preload `memory` 与 `agentMemory` 命名空间无重叠

#### 14.43.9 涉及文件

| 文件 | 操作 |
|------|------|
| `src/main/ipc/handlers/agentSkillHandlers.ts` | 新增（11 个 agent-skill:* 通道） |
| `src/main/ipc/handlers/agentMemoryHandlers.ts` | 新增（5 个 agent-memory:* 通道） |
| `src/main/ipc/handlers/agentLearningHandlers.ts` | 新增（4 个 agent-learning:* 通道） |
| `src/main/ipc/index.ts` | 修改（新增 3 个 import + 3 次注册调用） |
| `src/main/preload.ts` | 修改（新增 agentSkill / agentMemory / agentLearning 三个命名空间） |
| `src/renderer/types/electron.d.ts` | 修改（新增三个类型声明块） |
| `CODE_WIKI.md` | 修改（新增 §14.43，附录关键文件索引追加 3 条） |

---

## 附录：关键文件索引

| 类别 | 文件 |
|------|------|
| 主进程入口 | [index.ts](src/main/index.ts) |
| Preload 桥接 | [preload.ts](src/main/preload.ts) |
| IPC 注册中心 | [ipc/index.ts](src/main/ipc/index.ts) |
| AI 处理器 | [aiHandlers.ts](src/main/ipc/handlers/aiHandlers.ts) |
| AI 服务抽象层 | [AIService.ts](src/main/services/AIService.ts) |
| 智能体引擎核心类型 | [agentTypes.ts](src/main/services/ai/agent/agentTypes.ts)（2026-07-29 新增，§14.38） |
| 工具协议适配层 | [toolProtocolAdapter.ts](src/main/services/ai/agent/toolProtocolAdapter.ts)（2026-07-29 新增，§14.39） |
| 工具注册中心 | [toolRegistry.ts](src/main/services/ai/agent/toolRegistry.ts)（2026-07-29 新增，§14.41） |
| 智能体调用循环 | [agentLoop.ts](src/main/services/ai/agent/agentLoop.ts)（2026-07-30 新增，§14.41） |
| 验证用工具集目录 | [tools/](src/main/services/ai/agent/tools/)（2026-07-30 新增，§14.40：dialogueTools / worldbookTools / writingTools / index） |
| 智能体 IPC 处理器 | [agentHandlers.ts](src/main/ipc/handlers/agentHandlers.ts)（2026-07-30 新增，§14.41：ai:runAgentTurn + ai:agentToolCall） |
| Agent 技能库 IPC 处理器 | [agentSkillHandlers.ts](src/main/ipc/handlers/agentSkillHandlers.ts)（2026-07-30 新增，§14.43：11 个 agent-skill:* 通道） |
| Agent 长期记忆 IPC 处理器 | [agentMemoryHandlers.ts](src/main/ipc/handlers/agentMemoryHandlers.ts)（2026-07-30 新增，§14.43：5 个 agent-memory:* 通道） |
| Agent 自我学习 IPC 处理器 | [agentLearningHandlers.ts](src/main/ipc/handlers/agentLearningHandlers.ts)（2026-07-30 新增，§14.43：4 个 agent-learning:* 通道） |
| 技能库系统核心类型 | [skillTypes.ts](src/main/services/ai/agent/skill/skillTypes.ts)（2026-07-30 新增，§14.42：SkillManifest / SkillImplementation / SkillResult 等） |
| 向量存储 Facade | [VectorStoreService.ts](src/main/services/VectorStoreService.ts) |
| 写作项目仓库 | [WritingProjectRepository.ts](src/main/services/writing/WritingProjectRepository.ts) |
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

> **维护说明**：本 Wiki 随项目演进增量更新。新增模块或重大架构变更时，请同步更新对应章节；出现 Bug 或经反复调试修复的问题，在 [§14](#14-已知重点问题与修复记录) 中以 ⭐ 标记重点记录。详细开发规范与历史修复记录请参阅 `.trae/documents/技术文档.md`。