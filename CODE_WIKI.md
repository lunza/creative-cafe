# Creative Café 代码 Wiki

> **版本**：v1.0.1 ｜ **最后更新**：2026-07-28
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