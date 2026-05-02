# TravenManager 项目文档

> 本文档基于代码实际状态生成（2024-07），所有路径、文件名、版本号、组件列表均与源代码一致。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [项目结构](#3-项目结构)
4. [IPC 通信](#4-ipc-通信)
5. [数据存储](#5-数据存储)
6. [核心功能模块](#6-核心功能模块)
7. [状态管理](#7-状态管理)
8. [开发指南](#8-开发指南)

---

## 1. 项目概述

**TravenManager** 是一个基于 Electron + React + TypeScript 的桌面应用，作为 SillyTavern 的配置管理工具，提供 GUI 界面管理配置、角色卡、世界书，并通过 AI 辅助优化数据。

### 主要功能

| 模块 | 说明 |
|------|------|
| **仪表盘** | SillyTavern 进程管理、系统状态概览 |
| **角色卡管理** | 创建/编辑/导入/导出（PNG/JSON），AI 翻译/润色 |
| **世界书管理** | 条目编辑、批量操作、AI 生成、标签管理 |
| **创意工坊** | Markdown 编辑器（Milkdown）+ AI 辅助写作 |
| **记忆插件** | 聊天记录管理、Excel 模板、AI 自动整理 |
| **提示词优化** | AI 提示词模板管理与优化 |
| **头像管理** | SillyTavern 头像浏览与管理 |
| **插件管理** | SillyTavern 插件浏览与配置 |
| **设置中心** | AI 引擎配置、主题切换、紧凑模式、向量模型配置 |
| **知识库管理** | 知识的增删改查、版本控制、向量化搜索、多维度分类 |

---

## 2. 技术栈

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^18.2.0 | UI 框架 |
| TypeScript | 5.x | 类型安全 |
| Ant Design (antd) | ^6.3.5 | UI 组件库 |
| Zustand | ^5.0.12 | 状态管理 |
| Vite | ^5.0.8 | 构建工具 |
| Milkdown | ^7.20.0 | Markdown 编辑器 |
| @ai-sdk/openai | ^3.0.53 | Vercel AI SDK |
| @ai-sdk/react | ^3.0.170 | AI SDK React 集成 |
| ai | ^6.0.168 | Vercel AI SDK 核心 |
| lru-cache | ^11.0.0 | 向量缓存（LRU 淘汰） |
| @xenova/transformers | ^2.17.0 | 本地向量模型推理 |

### 后端 / 桌面

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^33.2.0 | 桌面框架 |
| electron-store | ^11.0.2 | 本地 JSON 存储 |
| ws | ^8.20.0 | WebSocket 服务 |

### 其他依赖

| 技术 | 版本 | 用途 |
|------|------|------|
| zod | ^4.3.6 | 数据验证 |
| xlsx | ^0.18.5 | Excel 文件处理 |
| @lenml/char-card-reader | ^1.1.1 | 角色卡读取 |
| sanitize-filename | ^1.6.4 | 文件名安全处理 |
| simple-git | ^3.33.0 | Git 操作 |

---

## 3. 项目结构

```
TravenManager/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.json
├── index.html
│
├── src/
│   ├── main/                         # Electron 主进程
│   │   ├── index.ts                    # 应用入口
│   │   ├── preload.ts                 # 预加载脚本 (contextBridge)
│   │   ├── ipc/
│   │   │   ├── index.ts                # IPC 统一注册
│   │   │   └── handlers/              # IPC 处理器 (11 个文件)
│   │   │       ├── aiHandlers.ts
│   │   │       ├── appHandlers.ts
│   │   │       ├── avatarHandlers.ts
│   │   │       ├── characterChatHandlers.ts
│   │   │       ├── characterHandlers.ts
│   │   │       ├── creativeHandlers.ts
│   │   │       ├── fileHandlers.ts
│   │   │       ├── memoryHandlers.ts
│   │   │       ├── pluginHandlers.ts
│   │   │       ├── settingHandlers.ts
│   │   │       └── worldBookHandlers.ts
│   │   ├── services/                  # 业务逻辑层
│   │   │   ├── StorageManager.ts       # 多文件存储管理
│   │   │   ├── storageService.ts       # 存储服务封装
│   │   │   ├── storage.types.ts       # 存储类型定义
│   │   │   ├── characterService.ts     # 角色卡 CRUD
│   │   │   ├── worldBookService.ts     # 世界书 CRUD
│   │   │   ├── memory/                # 记忆插件服务
│   │   │   │   ├── chatLogService.ts
│   │   │   │   └── tableTemplateService.ts
│   │   │   ├── settingService.ts        # 设置读写
│   │   │   ├── pluginService.ts        # 插件管理
│   │   │   ├── avatarService.ts        # 头像管理
│   │   │   ├── optimizerService.ts      # AI 优化服务
│   │   │   ├── EmbeddingService.ts      # 向量生成服务（新增）
│   │   │   ├── VectorStoreService.ts    # 向量存储服务（新增）
│   │   │   ├── JSONVectorStore.ts       # JSON 向量存储实现（新增）
│   │   │   ├── VectorCache.ts           # 多级缓存（新增）
│   │   │   ├── KnowledgeBaseService.ts  # 知识库服务（新增）
│   │   │   ├── ContextManager.ts        # 上下文管理器（新增）
│   │   │   └── server.ts              # Fastify 服务 (未启用)
│   │   ├── shared/                    # 主进程内共享代码
│   │   │   └── schemas/
│   │   └── utils/
│   │       ├── appPath.ts             # 安全路径工具
│   │       └── vectorMath.ts          # 向量数学工具（新增）
│   │
│   ├── renderer/                    # React 渲染进程
│   │   ├── main.tsx                   # React 入口
│   │   ├── App.tsx                    # 根组件 & 路由
│   │   ├── components/
│   │   │   ├── Common/                # 共享组件
│   │   │   │   ├── AIService.tsx       # AI 请求服务
│   │   │   │   ├── DataPersistence.tsx
│   │   │   │   ├── MarkdownEditor/     # Milkdown 编辑器
│   │   │   │   └── RichTextRenderer.tsx
│   │   │   ├── Dashboard/             # 仪表盘
│   │   │   ├── Character/             # 角色卡管理
│   │   │   │   ├── WorldBookRelationPanel.tsx  # 角色关联世界书（新增）
│   │   │   ├── WorldBook/             # 世界书管理
│   │   │   │   ├── WorldBookVectorPanel.tsx    # 世界书向量化（新增）
│   │   │   ├── Creative/              # 创意工坊
│   │   │   ├── MemoryChat/            # 记忆插件
│   │   │   ├── Settings/              # 设置页面
│   │   │   ├── PromptOptimizer/      # 提示词优化
│   │   │   ├── Avatar/               # 头像管理
│   │   │   ├── Plugin/               # 插件管理
│   │   │   ├── Layout/               # 布局组件
│   │   │   ├── Test/                 # 测试组件
│   │   │   ├── LongTermMemory/      # 长期记忆
│   │   │   ├── Vector/              # 向量组件（新增）
│   │   │   │   └── VectorConfigPanel.tsx
│   │   │   └── KnowledgeBase/       # 知识库组件（新增）
│   │   │       └── KnowledgeBaseManager.tsx
│   │   ├── stores/                   # Zustand 状态
│   │   │   ├── uiStore.ts             # UI 状态
│   │   │   ├── settingStore.ts        # 设置状态
│   │   │   ├── characterStore.ts      # 角色卡状态
│   │   │   ├── worldBookStore.ts      # 世界书状态
│   │   │   ├── creativeStore.ts       # 创意状态
│   │   │   ├── memoryStore.ts         # 记忆状态
│   │   │   ├── logStore.ts            # 日志状态
│   │   │   ├── promptOptimizerStore.ts # 提示词状态
│   │   │   ├── vectorStore.ts         # 向量状态（新增）
│   │   │   └── knowledgeBaseStore.ts  # 知识库状态（新增）
│   │   ├── services/                 # 渲染进程服务
│   │   │   └── promptOptimizerService.ts
│   │   ├── styles/                   # 全局样式
│   │   ├── types/                    # 类型定义
│   │   └── utils/                   # 工具函数
│   │
│   └── shared/                      # 主/渲染进程共享
│       ├── settings.ts                # 全局设置
│       └── schemas/                 # 共享 Schema
│
├── data/                            # 运行时数据 (gitignored)
├── docs/                            # 项目文档
└── knowledge_base/                  # AI 知识库
```

---

## 4. IPC 通信

### 4.1 Preload API (`window.electronAPI`)

通过 `src/main/preload.ts` 暴露，使用 `contextBridge.exposeInMainWorld`。

#### 设置 (setting)
- `setting.load()` → 加载设置
- `setting.save(setting)` → 保存设置
- `setting.getPath()` → 获取设置路径

#### 文件操作 (file)
- `file.selectDirectory()` → 选择目录
- `file.selectFile(filters)` → 选择文件
- `file.exists(path)` → 检查文件存在
- `file.read(path)` → 读取文本文件
- `file.write(path, data)` → 写入文本文件

#### 世界书 (worldBook)
- `worldBook.list()` → 获取世界书列表
- `worldBook.read(path)` → 读取世界书
- `worldBook.write(path, data)` → 写入世界书
- `worldBook.delete(path)` → 删除世界书

#### 角色卡 (character)
- `character.list()` → 角色卡列表
- `character.read(path)` → 读取角色卡
- `character.write(path, data)` → 写入角色卡
- `character.delete(path)` → 删除角色卡
- `character.import(filePath)` → 导入角色卡
- `character.export(character, format)` → 导出角色卡

#### AI 请求 (ai)
- `ai.request(config)` → 发送 AI 请求（主进程中转，避免 CORS）
- `ai.test(config)` → 测试 AI 连通性

#### 记忆插件 (memory)
- `memory.getTemplates()` → 获取模板列表
- `memory.createTemplate(template)` → 创建模板
- `memory.getRecords(templateId)` → 获取记录
- `memory.processChat(chatId, templateId)` → AI 处理对话

#### 向量模型 (embedding) [新增]
- `embedding.generate(text)` → 生成单个文本的向量
- `embedding.generateBatch(texts)` → 批量生成向量
- `embedding.testConnection()` → 测试向量 API 连通性
- `embedding.setMode(mode)` → 切换向量模式（remote/local）
- `embedding.getMode()` → 获取当前向量模式

#### 向量存储 (vector) [新增]
- `vector.add(id, vector, metadata)` → 添加向量
- `vector.addBatch(items)` → 批量添加向量
- `vector.search(query, topK, filter)` → 相似度搜索
- `vector.update(id, vector, metadata)` → 更新向量
- `vector.delete(id)` → 删除向量
- `vector.count()` → 获取向量总数
- `vector.rebuildIndex()` → 重建向量索引
- `vector.setMode(mode)` → 切换存储模式（json/faiss）

#### 知识库 (knowledge) [新增]
- `knowledge.list(filter, page, pageSize)` → 获取知识列表
- `knowledge.create(item)` → 创建知识条目
- `knowledge.update(id, updates)` → 更新知识条目
- `knowledge.delete(id)` → 删除知识条目
- `knowledge.search(query, options)` → 搜索知识（向量/文本）
- `knowledge.vectorize(id)` → 向量化单个条目
- `knowledge.vectorizeAll()` → 向量化所有条目
- `knowledge.getVersion(id)` → 获取版本历史
- `knowledge.restoreVersion(id, version)` → 恢复历史版本

#### 上下文 (context) [新增]
- `context.retrieve(conversation, options)` → 检索相关上下文
- `context.compress(items, maxTokens)` → 压缩上下文

#### SillyTavern 进程 (sillyTavern)
- `sillyTavern.start()` → 启动 ST
- `sillyTavern.stop()` → 停止 ST
- `sillyTavern.getStatus()` → 获取状态

### 4.2 事件推送 (Main → Renderer)

| 事件 | 负载 | 说明 |
|------|------|------|
| `sillyTavern:log` | string | ST 日志输出 |
| `sillyTavern:status` | ProcessStatus | ST 状态变化 |
| `ai:stream-chunk` | StreamChunk | AI 流式响应块 |

---

## 5. 数据存储

### 5.1 存储架构

使用 **electron-store** 实现多文件存储，每个模块独立文件：

| 存储模块 | 枚举值 | 文件名 | 内容 |
|---------|--------|--------|------|
| CONFIG | `config` | `travenmanager-config.json` | 系统设置、AI 配置、向量配置 |
| CREATIVE | `creative` | `travenmanager-creative.json` | 创意工坊数据 |
| CHARACTER | `character` | `travenmanager-character.json` | 角色卡数据 |
| WORLD_BOOK | `worldbook` | `travenmanager-worldbook.json` | 世界书数据 |
| MEMORY | `memory` | `travenmanager-memory.json` | 记忆插件数据 |
| EDITOR | `editor` | `travenmanager-editor.json` | 编辑器内容 |
| VECTOR | (在 CONFIG 内) | (同 CONFIG) | 向量数据、向量缓存、知识库数据 |

> 文件位置：`app.getPath('userData')` 或 `app.getPath('appData')`

### 5.2 存储类型定义 (`storage.types.ts`)

```typescript
export enum StorageModule {
  CONFIG = 'config',
  CREATIVE = 'creative',
  CHARACTER = 'character',
  WORLD_BOOK = 'worldbook',
  MEMORY = 'memory',
  EDITOR = 'editor'
}
```

---

## 6. 核心功能模块

### 6.1 SillyTavern 进程管理
- 启动/停止 ST Node.js 进程
- 实时捕获 stdout/stderr 日志
- 通过 WebSocket 推送日志到渲染进程

### 6.2 角色卡管理
- PNG 嵌入元数据读取（`@lenml/char-card-reader`）
- 支持 PNG、JSON、WebP 格式导入
- AI 翻译/润色（通过主进程 IPC 转发）

### 6.3 世界书管理
- 条目增删改查
- 批量导入/导出（JSON、WJSON）
- AI 一键生成/翻译/润色

### 6.4 创意工坊
- Milkdown Crepe 编辑器（WYSIWYG）
- AI 工具栏：扩写/润色/翻译
- 支持受控/非受控模式

### 6.5 记忆插件
- 聊天记录树形展示
- Excel 模板管理（多页签）
- AI 智能整理（提取结构化数据）

### 6.6 向量模型系统 [新增]

**架构设计**：
- **EmbeddingService**：统一向量生成接口，支持远程/本地模式切换
- **RemoteEmbedder**：通过 OpenAI 兼容 API (`/v1/embeddings`) 生成向量
- **LocalEmbedder**：通过 Transformers.js 加载 `Xenova/all-MiniLM-L6-v2` 模型（384维）
- **VectorCache**：多级缓存系统（L1 LRU 内存缓存 + L2 electron-store 磁盘缓存）

**缓存策略**：
| 层级 | 存储介质 | 容量 | TTL | 用途 |
|------|---------|------|-----|------|
| L1 | 内存（LRUCache） | 1000 条目 | 5 分钟 | 热点向量生成结果、搜索结果 |
| L2 | 磁盘（electron-store） | 无限制 | 1 小时 | 冷数据持久化缓存 |

**向量存储**：
- **JSONVectorStore**：JSON 格式存储向量数据，使用余弦相似度进行检索（当前主方案）
- **FAISSStore**：FAISS.js 高性能 ANN 搜索（待扩展）
- 通过设置切换存储模式

**配置文件**（在 `settings.vector` 中）：
```typescript
{
  embeddingMode: 'remote' | 'local',        // 向量生成模式
  remoteModel: 'text-embedding-3-small',     // 远程模型名称
  remoteApiUrl: string,                      // 远程 API 地址
  remoteApiKey: string,                      // 远程 API 密钥
  vectorStoreMode: 'json' | 'faiss',         // 向量存储模式
  cacheEnabled: boolean,                     // 是否启用缓存
  cacheL1Size: number,                       // L1 缓存大小
  cacheL1TTL: number,                        // L1 缓存 TTL（秒）
  cacheL2TTL: number,                        // L2 缓存 TTL（秒）
  defaultTopK: number,                       // 默认检索数量
  minSimilarityScore: number,                // 最低相似度阈值
  contextWindowTokens: number,               // 上下文窗口大小
  autoVectorizeWorldBook: boolean,           // 世界书自动向量化
  autoVectorizeKnowledge: boolean            // 知识库自动向量化
}
```

### 6.7 知识库管理 [新增]

**KnowledgeBaseService** 提供完整的知识库管理功能：

**核心功能**：
- **CRUD**：知识的增删改查
- **版本控制**：自动保存历史版本，支持恢复到任意版本
- **多维度分类**：分类标签、来源标签、关联标签
- **向量化搜索**：语义检索，按相关性排序
- **批量向量化**：一键向量化所有未向量化的条目

**知识条目结构**：
```typescript
{
  id: string,               // 唯一标识
  title: string,            // 标题
  content: string,          // 内容
  source: string,           // 来源：manual | memory_extract | import
  category: string[],       // 多维度分类标签
  tags: string[],           // 标签
  relatedCharacterIds: string[],  // 关联角色
  relatedWorldBookPaths: string[], // 关联世界书
  vector?: number[],        // 向量（384维或1536维）
  version: number,          // 版本号
  history: KnowledgeVersion[], // 版本历史
  metadata: KnowledgeMetadata
}
```

### 6.8 世界书向量化 [新增]

**WorldBookService** 扩展了向量化功能：

- **自动向量化**：保存世界书条目时自动生成向量（如果开启）
- **增量更新**：条目创建/更新/删除时同步向量索引
- **语义搜索**：通过向量检索查找相关条目
- **手动触发**：支持手动触发单个/全部条目向量化

**新增方法**：
- `vectorizeEntry(worldBookPath, entryUid, entryContent, entryKey)`：向量化单个条目
- `vectorizeAllEntries(worldBookPath, entries)`：向量化所有条目
- `searchWorldBookEntriesByVector(worldBookPath, query, topK)`：语义搜索条目

### 6.9 角色卡关联世界书 [新增]

**CharacterService** 扩展了世界书关联功能：

- **多对多关系**：一个角色卡可关联多个世界书，一个世界书可被多个角色卡关联
- **优先级控制**：每个关联可设置优先级（1-10），影响检索权重
- **标签过滤**：支持按标签过滤世界书条目
- **自动检索**：对话时自动检索关联世界书的相关条目

**关联关系结构**：
```typescript
{
  worldBookPath: string,   // 世界书路径
  enabled: boolean,        // 是否启用
  priority: number,        // 优先级（1-10）
  filterTags?: string[]    // 标签过滤
}
```

**新增方法**：
- `getWorldBookRelations(characterFilePath)`：获取关联列表
- `setWorldBookRelations(characterFilePath, relations)`：设置关联列表
- `addWorldBookRelation(characterFilePath, worldBookPath, enabled, priority, filterTags)`：添加关联
- `removeWorldBookRelation(characterFilePath, worldBookPath)`：移除关联
- `searchContextForCharacter(characterFilePath, query, topK)`：检索相关上下文

### 6.10 上下文管理器 [新增]

**ContextManager** 负责对话上下文的检索和管理：

- **语义检索**：根据对话内容检索相关知识/记忆
- **相关性排序**：按向量相似度排序检索结果
- **上下文压缩**：控制上下文窗口大小，避免超出 token 限制
- **提示词注入**：将检索到的上下文注入到 AI 提示词中

**核心方法**：
- `retrieveContext(conversation, options)`：检索相关上下文
- `buildPromptWithSystem(systemPrompt, context)`：构建含上下文的提示词
- `compressContext(items, maxTokens)`：压缩上下文
- `generateSummary(text)`：生成文本摘要

---

## 7. 状态管理 (Zustand)

| Store | 文件 | 职责 |
|-------|------|------|
| `useUIStore` | `stores/uiStore.ts` | activeTab, theme, sidebarCollapsed, compactMode |
| `useSettingStore` | `stores/settingStore.ts` | 系统设置、AI 引擎配置 |
| `useCharacterStore` | `stores/characterStore.ts` | 角色卡列表与选中状态 |
| `useWorldBookStore` | `stores/worldBookStore.ts` | 世界书列表与编辑状态 |
| `useCreativeStore` | `stores/creativeStore.ts` | 创意工坊数据 |
| `useMemoryStore` | `stores/memoryStore.ts` | 记忆插件数据 |
| `useLogStore` | `stores/logStore.ts` | 日志列表与过滤 |
| `useVectorStore` | `stores/vectorStore.ts` | 向量状态、生成、搜索、存储（新增） |
| `useKnowledgeBaseStore` | `stores/knowledgeBaseStore.ts` | 知识库 CRUD、搜索、向量化（新增） |

---

## 8. 开发指南

### 8.1 快速开始

```bash
# 安装依赖
npm install

# 开发模式 (Vite + Electron 热重载)
npm run dev

# 仅前端 (浏览器调试)
npm run dev -- --renderer-only
```

### 8.2 构建与打包

```bash
# 构建前端
npm run build

# 打包 Electron 应用
npm run electron:build

# Windows NSIS 安装包
npm run electron:build -- --win
```

### 8.3 代码规范

- TypeScript strict 模式：`tsconfig.json` 中 `"strict": false`（实际配置）
- 组件命名：PascalCase（`CharacterCard.tsx`）
- 类型前缀：`I` 接口、`T` 类型、`E` 枚举
- 禁止 `any`：使用 `unknown` + 类型守卫

### 8.4 测试

```bash
# 运行所有测试
npm test

# 单元测试
npm run test:unit

# 集成测试 (需要真实 AI 配置)
npm run test:integration

# 覆盖率报告
npm run test:coverage
```

---

## 附录：已知差异（旧文档 vs 代码）

| # | 旧文档声称 | 实际代码 | 状态 |
|---|--------|---------|------|
| 1 | Electron 28.0.0 | ^33.2.0 | ✅ 已修正 |
| 2 | 存在 dataMigrationService.ts | 不存在，使用 StorageManager | ✅ 已修正 |
| 3 | 存在"一键启动系统" | 不存在 | ✅ 已移除 |
| 4 | 组件列表 9 个 | 实际 13 个 | ✅ 已补充 |
| 5 | Stores 列表 3 个 | 实际 7 个 | ✅ 已补充 |
| 6 | server.ts 已启用 | 未在主进程中启动 | ✅ 已标注 |
| 7 | 文档 ~2600 行 | 新文档 ~400 行 | ✅ 已精简 |

---

**维护者**：TravenManager 开发团队  
**最后更新**：2024-07-10  
**文档版本**：1.0.0（基于代码实际状态）
