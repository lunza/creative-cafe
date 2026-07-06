# Creative Café 代码 Wiki

> **版本**：v1.0.1 ｜ **最后更新**：2026-07-06
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
│   │   │   ├── ai/                    # AI 配置提供者 + SSE 流解析器
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
- `Header.tsx`：顶部栏
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
  - `PromptBuilder.ts`：角色对话提示词构建（角色定义、背景、世界书上下文、记忆、对话示例、记忆指令）
  - `TokenManagement/`：上下文截断（`ContextTruncator`）、token 计数（`TokenCounter`）
  - `MessageRenderer/`：消息渲染（支持 Markdown、代码高亮、引号高亮）
  - `utils/messageProcessor.ts`：消息处理管道（含 `stripThinkingTags` 思考标签过滤）
  - `utils/chatHistoryRagUtils.ts`：对话历史 RAG 工具
  - `ConfigPanel.tsx` / `ParameterPanel.tsx` / `PersonaPanel.tsx`：配置面板（ConfigPanel 含「记忆与上下文增强」分组标题，聚合知识库检索与记忆表格两个子面板）
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

---

## 附录：关键文件索引

| 类别 | 文件 |
|------|------|
| 主进程入口 | [index.ts](src/main/index.ts) |
| Preload 桥接 | [preload.ts](src/main/preload.ts) |
| IPC 注册中心 | [ipc/index.ts](src/main/ipc/index.ts) |
| AI 处理器 | [aiHandlers.ts](src/main/ipc/handlers/aiHandlers.ts) |
| AI 服务抽象层 | [AIService.ts](src/main/services/AIService.ts) |
| 向量存储 Facade | [VectorStoreService.ts](src/main/services/VectorStoreService.ts) |
| 写作项目仓库 | [WritingProjectRepository.ts](src/main/services/writing/WritingProjectRepository.ts) |
| 记忆聊天日志 | [chatLogService.ts](src/main/services/memory/chatLogService.ts) |
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