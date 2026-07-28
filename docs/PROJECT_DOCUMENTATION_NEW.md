# Creative-Cafe 项目技术文档

> 本文档基于代码实际状态生成（2026-05），所有路径、文件名、版本号、组件列表均与源代码一致。
> 相关文档: `doc/01~09` 系列模块详细技术文档

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [项目结构](#3-项目结构)
4. [应用路由 (Tab 系统)](#4-应用路由-tab-系统)
5. [IPC 通信](#5-ipc-通信)
6. [数据存储](#6-数据存储)
7. [核心功能模块](#7-核心功能模块)
8. [状态管理](#8-状态管理)
9. [开发指南](#9-开发指南)

---

## 1. 项目概述

**Creative-Cafe** 是一个基于 Electron + React + TypeScript 的桌面应用，定位为 **SillyTavern 的配置管理与创意工坊工具**。它提供桌面 GUI 界面管理角色卡、世界书、人设、知识库，并通过 AI 辅助翻译、润色、生成、向量化检索和语义搜索。

### 主要功能

| 模块 | 说明 |
|------|------|
| **仪表盘** | 系统首页，数据统计概览、版本更新检查、使用技巧轮播 |
| **角色卡管理** | 图片类角色卡（PNG/JPG/WebP）的导入/查看/编辑/删除，AI 翻译/润色/生成，世界书关联 |
| **角色对话聊天** | 基于角色卡的多轮 AI 对话测试沙箱，流式响应，知识库绑定，人设选择 |
| **世界书管理** | 世界书及条目的 CRUD、标签系统、AI 批量操作、向量化语义搜索、SillyTavern 标准化 |
| **用户人设管理** | 用户 Persona 的 CRUD、头像上传/预览 |
| **创意工坊** | Markdown 编辑器（Milkdown）+ AI 辅助写作、角色卡/世界书编辑器 |
| **知识库管理** | 知识条目 CRUD、文档上传解析（PDF/Word/Excel/TXT/MD）、分块向量化、树形浏览、语义搜索 |
| **记忆插件** | 聊天记录管理、Excel 模板、AI 自动整理 |
| **提示词优化** | AI 提示词模板管理与优化 |
| **插件管理** | SillyTavern 插件的浏览、安装、卸载、更新 |
| **设置中心** | AI 引擎多源配置、路径管理、外观设置、向量配置 |

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
| Milkdown | ^7.20.0 | Markdown 编辑器 (WYSIWYG) |
| @ai-sdk/openai | ^3.0.53 | Vercel AI SDK - OpenAI 适配 |
| @ai-sdk/react | ^3.0.170 | AI SDK React 集成 |
| ai | ^6.0.168 | Vercel AI SDK 核心 |
| react-markdown | ^10.1.0 | Markdown 渲染 |
| remark-gfm | ^4.0.1 | GFM 表格/删除线支持 |
| remark-emoji | ^5.0.2 | Emoji 表情支持 |
| rehype-raw | ^7.0.0 | 原始 HTML 解析 |
| rehype-sanitize | ^6.0.0 | HTML 安全净化 |
| @xenova/transformers | ^2.17.2 | 本地向量模型推理 |
| zod | ^4.3.6 | 数据校验 |

### 后端 / 桌面

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^33.2.0 | 桌面框架 |
| electron-store | ^11.0.2 | 本地 JSON 键值存储 |
| vecstore-wasm | ^1.0.0 | WASM 向量存储与相似度搜索 |
| lru-cache | ^11.3.5 | LRU 内存缓存 |
| fastify | (implied) | HTTP API 服务 (server.ts) |
| simple-git | ^3.33.0 | Git 操作 (插件安装) |
| ws | ^8.20.0 | WebSocket (声明但主进程未引用) |

### 文档处理

| 技术 | 版本 | 用途 |
|------|------|------|
| pdf-parse | ^1.1.1 | PDF 文本提取 |
| mammoth | ^1.12.0 | Word (.docx) 解析 |
| xlsx | ^0.18.5 | Excel 文件处理 |
| json5 | ^2.2.3 | JSON5 格式解析 (世界书兼容) |
| @lenml/char-card-reader | ^1.1.1 | 角色卡元数据读取 |
| png-chunk-text | ^1.0.0 | PNG chunk 文本提取 |
| png-chunks-extract | ^1.0.0 | PNG chunk 提取 |

---

## 3. 项目结构

```
Creative-Cafe/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.json
├── index.html
├── doc/                              # 📚 模块技术文档 (01~09)
├── docs/                             # 📄 项目级文档
├── knowledge_base/                   # 🧠 预抓取的 AI 知识库
│
├── src/
│   ├── main/                         # Electron 主进程
│   │   ├── index.ts                    # 应用入口
│   │   ├── preload.ts                 # 预加载脚本 (contextBridge)
│   │   ├── ipc/
│   │   │   ├── index.ts                # IPC 统一注册中心
│   │   │   └── handlers/              # IPC 处理器 (12 个文件)
│   │   │       ├── aiHandlers.ts
│   │   │       ├── appHandlers.ts
│   │   │       ├── avatarHandlers.ts
│   │   │       ├── characterChatHandlers.ts
│   │   │       ├── characterHandlers.ts
│   │   │       ├── creativeHandlers.ts
│   │   │       ├── documentHandlers.ts
│   │   │       ├── fileHandlers.ts
│   │   │       ├── memoryHandlers.ts
│   │   │       ├── pluginHandlers.ts
│   │   │       ├── settingHandlers.ts
│   │   │       └── worldBookHandlers.ts
│   │   ├── services/                  # 业务逻辑层
│   │   │   ├── storageManager.ts       # electron-store 多文件管理
│   │   │   ├── storageService.ts       # 存储服务 IPC 封装
│   │   │   ├── storage.types.ts        # 存储模块枚举定义
│   │   │   ├── characterService.ts     # 角色卡 CRUD + 世界书关联
│   │   │   ├── worldBookService.ts     # 世界书 CRUD + 标准化 + 向量化
│   │   │   ├── ChatStorageService.ts   # 角色对话存储 (JSON 文件)
│   │   │   ├── ChatVectorizationService.ts # 对话向量化服务
│   │   │   ├── settingService.ts       # 设置读写
│   │   │   ├── pluginService.ts        # 插件管理 (Git 安装)
│   │   │   ├── avatarService.ts        # 用户人设管理
│   │   │   ├── optimizerService.ts     # AI 优化服务
│   │   │   ├── EmbeddingService.ts     # 向量嵌入 (远程+本地)
│   │   │   ├── EmbeddingWorkerService.ts # 嵌入工作线程
│   │   │   ├── VectorStoreService.ts   # 向量存储统一入口
│   │   │   ├── VecstoreVectorStore.ts   # WASM 向量存储实现
│   │   │   ├── VectorRegistryService.ts # 向量注册表 (追踪来源)
│   │   │   ├── VectorCache.ts          # L1 内存 + L2 磁盘缓存
│   │   │   ├── KnowledgeBaseService.ts  # 知识库核心服务
│   │   │   ├── KnowledgeBaseDocumentService.ts # 文档处理服务
│   │   │   ├── DocumentProcessorService.ts     # 文档解析分块管线
│   │   │   ├── ContextManager.ts       # 上下文检索与压缩
│   │   │   ├── ModelDownloadService.ts  # AI 模型下载
│   │   │   ├── modelDownloader.ts       # 模型下载器工具
│   │   │   ├── pathService.ts          # 路径解析服务
│   │   │   ├── fileService.ts          # 文件系统操作
│   │   │   ├── server.ts              # Fastify HTTP 服务 (3000端口)
│   │   │   ├── routes/
│   │   │   │   ├── characterRoutes.ts
│   │   │   │   ├── settingRoutes.ts
│   │   │   │   └── worldBookRoutes.ts
│   │   │   └── memory/
│   │   │       ├── chatLogService.ts
│   │   │       └── tableTemplateService.ts
│   │   ├── shared/
│   │   │   └── schemas/
│   │   │       └── settingSchema.ts     # Zod 设置校验 (未集成)
│   │   ├── types/
│   │   │   └── vectorConfig.ts
│   │   └── utils/
│   │       ├── appPath.ts             # 安全路径工具
│   │       ├── transformersWASM.ts     # @xenova/transformers WASM 配置
│   │       └── vectorMath.ts          # 向量数学工具
│   │
│   ├── renderer/                    # React 渲染进程
│   │   ├── main.tsx                   # React 入口
│   │   ├── App.tsx                    # 根组件 & Tab 路由
│   │   ├── settings.ts               # 渲染进程设置常量
│   │   ├── components/
│   │   │   ├── Common/                # 通用共享组件
│   │   │   │   ├── AIService.tsx       # AI 请求服务 (类+Hook)
│   │   │   │   ├── DataPersistence.tsx  # 数据持久化组件
│   │   │   │   ├── RichTextRenderer.tsx # 富文本渲染
│   │   │   │   ├── ChatEngine/         # 聊天引擎 (策略+工厂)
│   │   │   │   └── MarkdownEditor/     # Milkdown 编辑器
│   │   │   ├── Dashboard/             # 仪表盘 + LogViewer
│   │   │   ├── Character/             # 角色卡管理 + 对话聊天
│   │   │   │   ├── CharacterManager.tsx
│   │   │   │   ├── WorldBookRelationPanel.tsx
│   │   │   │   └── CharacterDialogueChat/  # 对话聊天子模块 (~15文件)
│   │   │   │       ├── MessageRenderer/     # 消息渲染+插件体系
│   │   │   │       └── utils/              # 消息处理器+插件
│   │   │   ├── WorldBook/             # 世界书管理
│   │   │   │   ├── WorldBookManager.tsx
│   │   │   │   ├── WorldBookList.tsx
│   │   │   │   ├── WorldBookEntryList.tsx
│   │   │   │   ├── WorldBookCreateModal.tsx
│   │   │   │   ├── WorldBookAddEntryModal.tsx
│   │   │   │   ├── WorldBookVectorPanel.tsx
│   │   │   │   └── TagManager.tsx
│   │   │   ├── Creative/              # 创意工坊
│   │   │   ├── MemoryChat/            # 记忆插件
│   │   │   ├── Settings/              # 设置页面
│   │   │   ├── PromptOptimizer/       # 提示词优化
│   │   │   ├── Avatar/               # 用户人设管理
│   │   │   ├── Plugin/               # 插件管理
│   │   │   ├── Layout/               # 布局组件 (Sidebar/Header/Log)
│   │   │   ├── Test/                 # 测试页面
│   │   │   ├── LongTermMemory/       # 长期记忆 (JS插件)
│   │   │   ├── Vector/              # 向量配置/作用域选择
│   │   │   └── KnowledgeBase/       # 知识库管理
│   │   ├── stores/                   # Zustand 状态 (10个)
│   │   │   ├── uiStore.ts
│   │   │   ├── settingStore.ts
│   │   │   ├── dataStore.ts
│   │   │   ├── characterChatStore.ts
│   │   │   ├── worldBookStore.ts
│   │   │   ├── creativeStore.ts
│   │   │   ├── knowledgeBaseStore.ts
│   │   │   ├── logStore.ts
│   │   │   ├── promptOptimizerStore.ts
│   │   │   └── vectorStore.ts
│   │   ├── services/                 # 渲染进程服务 (4个)
│   │   │   ├── documentVectorService.ts
│   │   │   ├── promptOptimizerService.ts
│   │   │   ├── rendererEmbeddingService.ts
│   │   │   └── vectorTestService.ts
│   │   ├── styles/                   # 全局样式
│   │   │   ├── ui-variables.css      # CSS变量系统
│   │   │   ├── global.css            # 全局基础样式
│   │   │   ├── animations.css        # 动画关键帧和过渡效果
│   │   │   ├── App.css               # 应用特定样式
│   │   │   ├── compact.css           # 紧凑模式样式
│   │   │   └── list-common.css       # 列表类组件统一样式
│   │   ├── types/                    # 类型定义 (10个文件)
│   │   ├── utils/                    # 工具函数 (10个文件)
│   │   └── hooks/                    # 自定义 Hooks
│   │       └── useModal.ts
│   │
│   ├── shared/                      # 主/渲染进程共享
│   │   ├── settings.ts                # 全局默认设置
│   │   ├── types/
│   │   │   └── vector.ts             # 向量相关核心类型
│   │   └── schemas/
│   │       └── settingSchema.ts       # Zod Schema (未集成)
│   │
│   └── test/                        # 测试代码
│       ├── setup.ts
│       ├── integration/
│       └── vector/
│
├── data/                            # 运行时数据 (gitignored)
└── scripts/                         # 辅助脚本
```

---

## 4. 应用路由 (Tab 系统)

应用使用 `useUIStore().activeTab` 状态驱动页面切换，在 `App.tsx` 中通过 switch-case 分发。当前侧边栏导航包含以下模块入口：

| Tab 值 | 渲染组件 | 模块说明 |
|--------|---------|---------|
| `dashboard` | `<Dashboard />` | 仪表盘 — 系统首页 |
| `creative` | `<CreativeManager />` | 创意工坊 |
| `prompt-optimizer` | `<PromptOptimizer />` | 提示词优化器 |
| `worldbook` | `<WorldBookManager />` | 世界书管理 |
| `avatar` | `<AvatarManager />` | 用户人设管理 |
| `character` | `<CharacterManager />` | 角色卡管理 |
| `plugin` | `<PluginManager />` | 插件管理 |
| `memory` | `<MemoryChatManager />` | 记忆插件 |
| `knowledge` | `<KnowledgeBaseManager />` | 知识库管理 |
| `settings` | `<Settings />` | 设置中心 |
| `test` / `test-vector` | `<VectorTestPage />` | 向量测试 (开发) |
| `document-vector` | `<DocumentVectorPage />` | 文档向量测试 (开发) |
| `test-markdown` | `<TestPage />` | Markdown 测试 (开发) |

> `activeTab` 类型定义: `'dashboard' | 'creative' | 'prompt-optimizer' | 'worldbook' | 'avatar' | 'character' | 'plugin' | 'memory' | 'knowledge' | 'settings' | 'test' | 'test-vector' | 'test-markdown' | 'document-vector'`

### 4.1 页面切换动画

应用使用 `<PageTransition>` 组件实现统一的页面切换动画，该组件包裹在 `App.tsx` 的内容区域:

```tsx
<PageTransition activeKey={activeTab}>
  {renderContent()}
</PageTransition>
```

**工作原理**:
- 监听 `activeKey` 变化，先应用 `page-exit` 动画（200ms）
- 动画结束后替换内容并应用 `page-enter` 动画（400ms）
- 支持动画开关控制（通过 `setting.animationEnabled`）
- 使用 CSS 变量控制动画时长和缓动函数

**动画效果**:
- `pageEnter`: 从下方淡入并上移（opacity: 0→1, translateY: 12px→0）
- `pageExit`: 向上淡出并上移（opacity: 1→0, translateY: 0→-12px）

---

## 5. 动画与过渡系统

### 5.1 CSS 动画变量系统

所有动画使用 [ui-variables.css](file:///g:/AI/creative-cafe/src/renderer/styles/ui-variables.css) 中定义的 CSS 变量:

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--duration-fast` | 0.1s | 快速交互反馈 |
| `--duration-normal` | 0.2s | 常规过渡效果 |
| `--duration-slow` | 0.3s | 慢速动画 |
| `--duration-slower` | 0.4s | 页面切换/模态框 |
| `--duration-slowest` | 0.5s | 入场动画 |
| `--ease-default` | cubic-bezier(0.2, 0, 0.3, 1) | 默认缓动 |
| `--ease-in` | cubic-bezier(0.5, 0, 1, 1) | 进入缓动 |
| `--ease-out` | cubic-bezier(0, 0, 0.6, 1) | 退出缓动 |
| `--ease-in-out` | cubic-bezier(0.2, 0, 0.8, 1) | 双向缓动 |

### 5.2 动画工具类

[animations.css](file:///g:/AI/creative-cafe/src/renderer/styles/animations.css) 提供以下动画工具类:

#### 入场动画
| CSS 类 | 动画效果 | 时长 |
|--------|---------|------|
| `.animate-fade-in` | 淡入 | 0.4s |
| `.animate-fade-in-up` | 从下方淡入 | 0.5s |
| `.animate-fade-in-down` | 从上方淡入 | 0.5s |
| `.animate-slide-in-left` | 从左侧滑入 | 0.5s |
| `.animate-slide-in-right` | 从右侧滑入 | 0.5s |
| `.animate-scale-in` | 缩放进入 | 0.4s |
| `.animate-slide-up` | 从底部滑入 | 0.3s |

#### 循环动画
| CSS 类 | 动画效果 |
|--------|---------|
| `.animate-bounce` | 弹跳效果 (1s) |
| `.animate-pulse` | 脉冲效果 (2s) |

#### 延迟类
| CSS 类 | 延迟时间 |
|--------|---------|
| `.animate-delay-100` | 0.1s |
| `.animate-delay-200` | 0.2s |
| `.animate-delay-300` | 0.3s |
| `.animate-delay-400` | 0.4s |
| `.animate-delay-500` | 0.5s |

#### 过渡效果
| CSS 类 | 过渡属性 |
|--------|---------|
| `.transition-all` | 所有属性 |
| `.transition-transform` | 仅 transform |
| `.transition-opacity` | 仅 opacity |
| `.transition-color` | 仅 color |
| `.transition-background` | 仅 background-color |
| `.transition-border` | 仅 border-color |
| `.transition-shadow` | 仅 box-shadow |

#### 悬停效果
| CSS 类 | 效果 |
|--------|------|
| `.hover-scale` | 缩放至 1.02 |
| `.hover-lift` | 上移 2px + 阴影 |
| `.hover-glow` | 光晕效果 |

### 5.3 按钮动画

按钮使用统一的动画类 [btn-animated](file:///g:/AI/creative-cafe/src/renderer/styles/animations.css#L285-L312):

```css
.btn-animated {
  transition: var(--transition-base);
  position: relative;
  overflow: hidden;
}

.btn-animated:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-button);
}

.btn-animated:active {
  transform: translateY(0);
}
```

**特性**:
- 悬停时轻微上移并显示阴影
- 点击时产生涟漪效果（使用 `::after` 伪元素）
- 使用 CSS 变量确保一致性

**变体**:
- `.btn-primary-hover`: 主要按钮悬停效果
- `.btn-secondary-hover`: 次要按钮悬停效果

### 5.4 卡片动画

卡片使用统一的动画类 [card-animated](file:///g:/AI/creative-cafe/src/renderer/styles/animations.css#L336-L343):

```css
.card-animated {
  transition: var(--transition-base);
  border-radius: var(--radius-card);
}

.card-animated:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-3);
}
```

**特性**:
- 悬停时上移 4px 并增强阴影
- 使用 CSS 变量确保响应式设计

**变体**:
- `.card-hover-enhanced`: 增强悬停效果（边框颜色变化）
- `.card-glow`: 光晕悬停效果

### 5.5 模态框动画

模态框使用专用的关键帧动画:

```css
@keyframes modalFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

**动画效果**:
- 遮罩层: 淡入动画 (0.2s)
- 内容区: 缩放 + 滑入动画 (0.4s)
- 关闭按钮: 悬停缩放至 1.05，点击缩放至 0.95

### 5.6 动画工具函数

项目提供 [animation.ts](file:///g:/AI/creative-cafe/src/renderer/utils/animation.ts) 工具文件，包含预定义的动画类名常量:

```typescript
import { ANIMATIONS, ANIMATION_DELAYS, TRANSITIONS, HOVER_EFFECTS, BUTTON_ANIMATIONS, CARD_ANIMATIONS } from '../../utils/animation';

// 使用示例
<div className={`${ANIMATIONS.fadeIn} ${ANIMATION_DELAYS['200']}`}>
  内容
</div>
```

### 5.7 动画开关

用户可以通过设置页面控制动画启用/禁用:

- 设置路径: `Settings > 外观 > 动画开关`
- 存储位置: `localStorage` (`ui-storage` -> `animationEnabled`)
- 默认值: `true`（启用动画）

当动画禁用时:
- 页面切换立即完成，无过渡效果
- 所有组件保持静态样式
- 保留 CSS 中的 `@media (prefers-reduced-motion: reduce)` 支持

### 5.8 无障碍支持

动画系统遵循 `prefers-reduced-motion` 媒体查询:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

这确保了对动画敏感的用户仍能正常使用应用。

---

## 6. IPC 通信

### 6.1 架构

Electron 安全模型: `contextIsolation: true`, `nodeIntegration: false`。渲染进程通过 `preload.ts` 中 `contextBridge.exposeInMainWorld` 暴露的 `window.electronAPI` 调用主进程服务，主进程通过 `ipcMain.handle` 注册的 handler 响应。

### 6.2 Preload API (`window.electronAPI`)

完整的 `preload.ts` 暴露了以下 API 命名空间：

#### 设置 (setting)
- `setting.load()` → `{ success, setting }`
- `setting.save(setting)` → `{ success }`
- `setting.getPath()` → `string`

#### 文件操作 (file)
- `file.selectDirectory()` → `string | null`
- `file.selectFile(filters)` → `string | null`
- `file.exists(path)` → `boolean`
- `file.read(path)` → 文本内容
- `file.write(path, content)` → `{ success }`
- `file.writeBinary(path, content, isBase64?)` → `{ success }`
- `file.copyFile(sourcePath, targetPath)` → `{ success }`
- `file.openFolder(path)` → `{ success }`
- `file.openFile(path)` → `{ success }`
- `file.readJson(fileName)` → JSON 数据
- `file.readAsBase64(path)` → `{ success, data }`
- `file.validatePath(path)` → `{ valid, exists, error }`

#### 世界书 (worldBook)
- `worldBook.list()` → `WorldBookMeta[]`
- `worldBook.read(path)` → `WorldBookData | null`
- `worldBook.write(path, data)` → `{ success }`
- `worldBook.delete(path)` → `{ success, deletedVectors }`
- `worldBook.import(sourcePath, fileName)` → `{ success, targetPath }`
- `worldBook.optimize(path)` → `{ success, optimized }`
- `worldBook.getDirectory()` → `string`
- `worldBook.setDirectory(dir)` → `{ success, worldBookDir }`
- `worldBook.readTags(path)` → `{ tags, associations }`
- `worldBook.writeTags(path, data)` → `{ success }`
- `worldBook.deleteTags(path)` → `{ success }`
- `worldBook.vectorize(path)` → `{ success, entriesVectorized, entriesFailed }`

#### 角色卡 (character)
- `character.list()` → 角色卡列表
- `character.read(path)` → 角色卡完整数据
- `character.write(path, data)` → `{ success }`
- `character.delete(path)` → `{ success }`
- `character.optimize(path)` → `{ success }`
- `character.getDirectory()` → `string`
- `character.setDirectory(dir)` → `{ success, characterDir }`
- `character.import(sourcePath, fileName)` → `{ success, targetPath }`
- `character.getWorldBookRelations(path)` → 关联列表
- `character.setWorldBookRelations(path, relations)` → `{ success }`

#### 角色卡配置 (characterConfig)
- `characterConfig.save(characterCardId, config)` → `{ success }`
- `characterConfig.load(characterCardId)` → `{ success, config }`

#### 人设管理 (avatar)
- `avatar.list()` → 人设列表
- `avatar.read(path)` → 人设数据
- `avatar.write(path, data)` → `{ success }`
- `avatar.delete(path)` → `{ success }`
- `avatar.getDirectory()` → `string`
- `avatar.setDirectory(dir)` → `{ success, avatarDir }`

#### 对话聊天 (characterChat)
- `characterChat.getTestChat(creativeId, characterCardId)` → `TestChatData | null`
- `characterChat.saveTestChat(creativeId, characterCardId, name, messages)` → `TestChatData`
- `characterChat.deleteTestChat(creativeId, characterCardId)` → `boolean`
- `characterChat.getAllTestChats()` → `TestChatData[]`
- `characterChat.clearCache()` → `{ success }`

#### 对话向量化 (chatVector)
- `chatVector.vectorize(characterId, messages)` → `{ success }`
- `chatVector.delete(characterId)` → `{ success }`
- `chatVector.search(characterId, query, topK?)` → 搜索结果

#### AI 请求 (ai)
- `ai.request(config)` → `{ success, data }`
- `ai.probeCapabilities(args)` → `{ success, capabilities?, error? }` — 探测模型视觉/思维链/工具调用能力（§7.3.5）
- `ai.recognizeImageTraits(args)` → `{ success, traits?, error? }` — 多模态 LLM 识别角色卡图片提取视觉特征 tag（§7.3.5）

流式事件 (通过 `electronAPI.on/off` 订阅):
- `ai:stream` — 流式数据块
- `ai:stream:complete` — 流完成
- `ai:stream:error` — 流错误

#### 向量嵌入 (embedding)
- `embedding.generate(text)` → `{ success, vector }`
- `embedding.generateBatch(texts)` → `{ success, vectors }`
- `embedding.testConnection(config?)` → 测试结果
- `embedding.listModels(config?)` → 模型列表
- `embedding.setMode(mode)` → `{ success }` (remote/local)
- `embedding.getMode()` → `string`
- `embedding.localTest(params?)` → 测试结果
- `embedding.localGenerate(text)` → 向量
- `embedding.localInit(modelName?)` → 初始化状态
- `embedding.checkModelStatus(modelName)` → 模型状态

#### 向量存储 (vector)
- `vector.add(id, vector, metadata)` → `{ success }`
- `vector.addBatch(items)` → `{ success }`
- `vector.search(query, topK, filter?, scopeIds?)` → 搜索结果
- `vector.getById(id)` → `{ success, item }`
- `vector.update(id, vector, metadata?)` → `{ success }`
- `vector.delete(id)` → `{ success }`
- `vector.count()` → `number`
- `vector.rebuildIndex()` → `{ success }`
- `vector.testStorage(scopeIds?)` → 测试结果
- `vector.testEmbedding()` → 测试结果
- `vector.testAll()` → 测试结果
- `vector.getAvailableScopes()` → `{ success, scopes }`

#### 文档处理 (document)
- `document.process(filePath)` → 处理结果
- `document.list()` → 文档列表
- `document.delete(docId)` → `{ success }`
- `document.deleteBatch(docIds)` → `{ success }`
- `document.getInfo(docId)` → 文档信息
- `document.getChunks(docId)` → 分块列表
- `document.searchVectors(queryText, topK, docId?)` → 搜索结果
- `document.getVectorStats()` → 统计信息
- `document.generateEmbedding(text)` → 向量
- `document.selectFile()` → `string | null`

#### 知识库 (knowledge)
- `knowledge.list(filter?, page?, pageSize?)` → `{ success, items, total }`
- `knowledge.create(data)` → `{ success, id }`
- `knowledge.createBatch(items)` → `{ success }`
- `knowledge.update(id, updates)` → `{ success }`
- `knowledge.delete(id)` → `{ success }`
- `knowledge.deleteBatch(ids)` → `{ success }`
- `knowledge.search(query, options?)` → `{ success, results }`
- `knowledge.vectorize(id)` → `{ success }`
- `knowledge.vectorizeAll()` → `{ success, count }`
- `knowledge.uploadDocument(filePath, options?)` → `{ success, chunkCount, knowledgeItemsCreated }`
- `knowledge.selectDocumentFile()` → `string | null`

#### 上下文管理 (context)
- `context.retrieve(conversation, options)` → `{ success, items }`
- `context.compress(items, maxTokens)` → `{ success, compressed }`

#### 模型下载 (model)
- `model.download(modelName)` → 下载状态
- `model.isDownloaded(modelName)` → `boolean`
- `model.getCacheDir()` → `string`

#### 通用存储 (storage)
- `storage.get(key)` → `{ data }`
- `storage.set({ key, value })` → `{ success }`
- `storage.delete(key)` → `{ success }`
- `storage.clear()` → `{ success }`
- `storage.has(key)` → `{ exists }`
- `storage.getAll()` → `{ data }`
- `storage.import(data)` → `{ success }`

#### 应用信息 (app)
- `app.getVersion()` → `string`
- `app.getPlatform()` → `string`
- `app.openPath(path)` → 打开文件/目录
- `app.getUserDataPath()` → `string`
- `app.getRootPath()` → `string`
- `app.openConfigFile()` → `{ success }`

#### 更新 (update) ⚠️ Handler 未注册
- `update.check()` → **永久 pending** — handler 未实现
- `update.download(latestVersion)` → **永久 pending**
- `update.install(downloadPath)` → **永久 pending**

#### 记忆插件 (memory)
- `memory.getMemoryDirectory()` → `string`
- `memory.getAllTemplates()` → 模板列表
- `memory.getTemplate(templateId)` → 模板数据
- `memory.createTemplate(template)` → 创建结果
- `memory.updateTemplate(templateId, updates)` → 更新结果
- `memory.deleteTemplate(templateId)` → 删除结果
- (更多 api — 详见 preload.ts 完整列表)

#### 创意数据 (creative)
- `creative.load()` → 创意数据
- `creative.save(data)` → `{ success }`
- `creative.export()` → JSON
- `creative.import(jsonData)` → `{ success }`
- `creative.getDirectory()` → `string`

#### 插件管理 (plugin)
- `plugin.getAvailable(forceRefresh?)` → 可用插件列表
- `plugin.getInstalled()` → 已安装插件
- `plugin.toggle(pluginId, enabled)` → `{ success }`
- `plugin.uninstall(pluginId)` → `{ success }`
- `plugin.getDirectory()` → `string`
- `plugin.setDirectory(dir)` → `{ success }`
- `plugin.checkUpdates()` → `{ success, plugins }`
- `plugin.updateDescriptions(plugins)` → `{ success }`
- `plugin.install(url, branch?)` → `{ success }`
- `plugin.uninstallById(pluginId)` → `{ success }`

#### 游戏模式 (game)（Spec: add-game-mode-framework / Task 5）

游戏模式 IPC 接口，覆盖游戏元数据 CRUD、存档 CRUD、表格数据 CRUD + 版本快照、AI 叙事流式生成、游戏本地配置。所有 handler 通过 `wrapHandler` 高阶函数统一 try/catch 兜底，业务层仓储方法均为同步实现（基于 fs.readFileSync / safeWriteFile）。

##### 游戏元数据
- `game.list()` → `{ success, games: GameIndexEntry[] }` — 列出所有已注册游戏摘要
- `game.getMeta(gameId)` → `{ success, meta: GameMeta | null }` — 读取单个游戏完整元数据
- `game.createGame(meta)` → `{ success }` — 创建新游戏（写入 meta.json + 更新索引）
- `game.updateGame(gameId, updates)` → `{ success }` — 更新游戏元数据（部分字段，自动刷新 updatedAt 与索引摘要）
- `game.deleteGame(gameId)` → `{ success }` — 删除游戏（递归删除目录 + 移除索引条目；不级联删除存档）

##### 存档
- `game.createSave(params)` → `{ success, meta: GameSaveMeta }` — 创建新存档（生成 saveId、初始化 save.json + 空表格 + 可选 state-snapshot）；params: `{ gameId, gameType, name, isAuto, tableSchema, initialState? }`
- `game.loadSave(saveId)` → `{ success, data: GameSaveData | null }` — 加载存档（save.json + state-snapshot.json 合并）
- `game.listSaves(gameId)` → `{ success, saves: GameSaveMeta[] }` — 列出某游戏的所有存档（按 updatedAt 倒序）
- `game.deleteSave(saveId)` → `{ success }` — 删除存档（递归删除目录）
- `game.save(saveId, updates)` → `{ success }` — 更新存档；updates: `{ narrativeLog?, stateSnapshot?, currentTurn?, currentNodeId?, nodeTitle?, turnCount? }`

##### 表格数据 + 版本快照
- `game.getTableData(saveId)` → `{ success, data: GameTableData | null }` — 读取存档的表格数据
- `game.saveTableData(saveId, tableData)` → `{ success }` — 保存存档的表格数据（覆盖写入）
- `game.applyTableEdits(saveId, commands)` → `{ success, changes: { commandsExecuted, affectedSheets, errors } }` — 应用 tableEdit 命令（INSERT_ROW / UPDATE_ROW / DELETE_ROW）
- `game.getVersionSnapshot(saveId)` → `{ success, snapshot: VersionSnapshot | null }` — 读取版本快照（用于回滚前的预览）
- `game.confirmVersion(saveId)` → `{ success }` — 确认版本（应用 newData 并清除快照）
- `game.rollbackVersion(saveId)` → `{ success }` — 回滚版本（恢复 originalData 并清除快照）

##### AI 叙事流式生成
- `game.generateNarrative(request)` → `{ success: true }` — 启动流式生成（立即返回，实际生成在后台异步进行）；request: `GameNarrativeRequest`（含 gameId / saveId / gameType / userAction / 可选 templateSystemPrompt / tableSchema / modelConfig / organizeMode）
- `game.cancelGeneration(saveId)` → `{ success, cancelled: boolean }` — 取消指定 saveId 的生成请求

流式事件监听器（每个返回 unsubscribe 函数）：
- `game.onNarrativeChunk(callback)` → 监听 `game:narrative:chunk` 事件，callback 接收 `GameNarrativeChunk { saveId, chunk, index }`
- `game.onNarrativeComplete(callback)` → 监听 `game:narrative:complete` 事件，callback 接收 `GameNarrativeComplete { saveId, fullText, tableChanges, tableEdits, generationTime, model }`
- `game.onNarrativeError(callback)` → 监听 `game:narrative:error` 事件，callback 接收 `GameNarrativeError { saveId, error, code }`（code: aborted / timeout / network / config_missing / rate_limit / service / unknown）
- `game.onTableUpdated(callback)` → 监听 `game:table:updated` 事件，callback 接收 `GameTableUpdated { saveId, changes }`（仅在 tableEdit 命令应用成功后推送）

##### 游戏本地配置
- `game.getConfig(gameId)` → `{ success, config: GameLocalConfig }` — 读取游戏本地配置（不存在时返回 DEFAULT_GAME_LOCAL_CONFIG，不写盘）
- `game.saveConfig(gameId, config)` → `{ success }` — 保存游戏本地配置（含 activeEngineId / temperature / maxTokens / organizeMode / ansiTheme / autoSave）

##### 设计要点
- **依赖注入**：`GameNarrativeService` 通过 setter 注入仓库依赖（`setGameRepository / setGameSaveRepository / setGameTableRepository`），在 `registerGameHandlers()` 中一次性注入；service 设计为「依赖未注入时优雅降级」
- **取消机制**：`activeAbortControllers` Map（key=saveId）允许同 saveId 的旧请求被新请求 abort（避免并发生成同一存档）；`abortAllActiveGameRequests()` 批量取消（应用退出 / 切换存档场景）
- **流式事件推送**：handler 立即返回 `success: true`，实际生成在后台异步进行；通过 `event.sender.send` 将 service 的 callbacks 转换为 4 个 IPC 事件推送；在 `onComplete` 中若 `tableChanges.commandsExecuted > 0` 额外推送 `game:table:updated` 事件
- **safeSend 防御**：在推送 IPC 事件前检查 `event.sender.isDestroyed()`，避免窗口关闭场景下的崩溃
- **AIService 方法对齐**：实际方法名是 `streamChatAPI`（非 `callStream`），签名 `aiService.streamChatAPI(messages, options, onChunk)` 返回 `Promise<{ content, generationTime, model }>`

##### 文件位置
- 子 handler: `src/main/ipc/handlers/game/gameMetaHandlers.ts` / `gameSaveHandlers.ts` / `gameTableHandlers.ts` / `gameNarrativeHandlers.ts` / `gameConfigHandlers.ts`
- 聚合入口: `src/main/ipc/handlers/gameHandlers.ts`（导出 `registerGameHandlers()` 与 `abortAllActiveGameRequests()`）
- Preload 桥接: `src/main/preload.ts` 的 `game` 命名空间
- 注册入口: `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 中调用 `registerGameHandlers()`

---

## 7. 数据存储

### 7.1 多层次存储架构

项目使用了**三套并行的存储机制**，分别服务于不同层次的数据：

| 层次 | 机制 | 用途 | 位置 |
|------|------|------|------|
| **应用配置** | electron-store (StorageManager) | 全局设置、AI 引擎、创意数据、编辑器内容 | `{appData}/creative-cafe/data/{module}.json` |
| **业务数据文件** | 直接文件系统 (fs) | 世界书 JSON/JSON5、角色卡 PNG、人设 JSON、对话 JSON | 可配置路径 (支持 `__USER_DATA__` 宏) |
| **向量数据** | VecstoreVectorStore (WASM) | 知识库向量、世界书向量、对话向量 | `vecstore.json` + `vecstore_metadata.json` |

### 7.2 electron-store 模块枚举 (`storage.types.ts`)

```typescript
export enum StorageModule {
  CONFIG = 'config',        // creative-cafe-config.json — 设置、AI、向量配置
  CREATIVE = 'creative',    // creative-cafe-creative.json
  CHARACTER = 'character',  // creative-cafe-character.json
  WORLD_BOOK = 'worldbook', // creative-cafe-worldbook.json
  MEMORY = 'memory',        // creative-cafe-memory.json
  EDITOR = 'editor'         // creative-cafe-editor.json
}
```

### 7.3 业务文件存储路径

所有业务数据文件存储于可配置的目录路径，默认位置均为 `{userData}/data/` 下：

| 数据类型 | 默认路径 | 文件中缀 | 支持格式 |
|---------|---------|---------|---------|
| 世界书 | `__USER_DATA__/data/worldbooks` | `.json` / `.json5` | JSON / JSON5 |
| 角色卡 | `__USER_DATA__/data/characters` | `.png` / `.jpg` / `.webp` | 图片 (嵌入角色卡元数据) |
| 人设 | `__USER_DATA__/data/avatars` | `.json` | JSON |
| 创意 | `__USER_DATA__/data/creatives` | — | — |
| 记忆 | `__USER_DATA__/data/memories` | — | — |
| 插件 | `__USER_DATA__/data/plugins` | — | — |

> `__USER_DATA__` 是一个路径占位符宏，在运行时解析为用户数据目录的绝对路径 (Windows: `%APPDATA%`)。

### 7.4 向量存储架构

```
VecstoreVectorStore (WASM) ← 384维向量
    ↓ 管理多个独立的 Store 实例
VectorStoreService (统一入口)
    ↓ 按 sourceType + sourceId 路由
├── knowledge Store
├── worldbook Store  
├── document Store
└── chatVector Store
    ↓ 注册追踪
VectorRegistryService (注册表)
    └── vecstore_metadata.json
```

● **VecstoreVectorStore**: 基于 `vecstore-wasm` 的 WASM 向量存储，支持持久化到磁盘和余弦相似度搜索  
● **VectorCache**: L1 内存 LRU Cache + L2 磁盘持久化缓存  
● **VectorRegistryService**: 追踪向量文件与来源的映射关系  

### 7.5 向量配置 (在 `settings.vector` 中)

```typescript
{
  embeddingMode: 'remote' | 'local',           // 向量生成模式
  autoVectorizeWorldBook: boolean,             // 世界书自动向量化
  autoVectorizeKnowledge: boolean,             // 知识库自动向量化
  cacheEnabled: boolean,                       // 缓存开关
  cacheL1Size: number,                         // L1 缓存大小
  cacheL1TTL: number,                          // L1 TTL (秒)
  cacheL2TTL: number,                          // L2 TTL (秒)
  defaultTopK: number,                         // 默认检索数量
  minSimilarityScore: number,                  // 最低相似度阈值
  contextWindowTokens: number,                 // 上下文窗口大小
  // 远程嵌入配置 (通过 AI Engine 提供)
  // 本地嵌入配置 (通过 @xenova/transformers)
}
```

### 7.6 游戏模式持久化 (Game Mode Storage)

> 增量更新（2026-07）：新增游戏模式仓储层，管理与写作模式同构但解耦的文件存储。

#### 7.6.1 目录结构

游戏模式数据全部存储于 `{userData}/data/` 下两个独立目录：

```
{userData}/data/
├── games/                              # 游戏元数据
│   ├── games-index.json                # 游戏索引（摘要列表）
│   └── <gameId>/                       # 单个游戏目录
│       ├── meta.json                   # 游戏完整元数据
│       └── config.json                 # 游戏本地配置（AI 引擎、温度等）
└── game-saves/                         # 游戏存档
    └── <saveId>/                       # 单个存档目录（saveId 为 uuid v4）
        ├── save.json                    # 存档元数据 + 剧情日志 + 状态快照
        ├── state-snapshot.json          # 模板自定义状态快照（独立文件，避免每次更新都重写 save.json）
        └── tables/                      # 表格数据目录
            ├── table-data.json          # 表格数据（结构对齐 WritingTableData）
            ├── table-config.json        # 表格配置
            └── table-versions.json      # 版本快照（用于回滚）
```

#### 7.6.2 仓储类与职责

| 仓储类 | 文件 | 职责 | 单例 |
|--------|------|------|------|
| `GameRepository` | `src/main/services/game/GameRepository.ts` | 游戏索引 / 元数据 / 本地配置 CRUD | `gameRepository` |
| `GameSaveRepository` | `src/main/services/game/GameSaveRepository.ts` | 存档 CRUD / 自动存档轮转 / 另存为 | `gameSaveRepository` |
| `GameTableRepository` | `src/main/services/game/GameTableRepository.ts` | 表格数据 CRUD / applyTableEdits / 版本快照 | `gameTableRepository` |

#### 7.6.3 关键设计决策

1. **不直接依赖 writing 模块**：仅复用 `safeWriteFile` 工具函数（位于 `WritingProjectRepository.ts`）。`applyTableEdits` / `compareTableData` 的核心逻辑在 game 模块内重新实现，避免跨模块耦合。

2. **sheetIndex / rowIndex 均为 1-based**：与 tableEdit 协议对齐（来自 AI 回复末尾的 `<tableEdit>` 标签）。仓储内部转换为 0-based 后才操作数组。注意 `WritingTableRepository` 中的 `TableEditCommandExecutor` 使用 0-based（直接来自 parser），两者协议不同。

3. **唯一 ID 字段为 "1"**：与 `WritingTableData` 约定一致。`INSERT_ROW` 时若 `rowData['1']` 已存在则合并更新而非追加，避免重复插入。

4. **状态快照独立存储**：`state-snapshot.json` 单独存放模板自定义状态，`updateSave` 时只重写该文件而非整个 `save.json`，降低写入开销。

5. **自动存档轮转**：`pruneAutoSaves(gameId)` 保留最近 `MAX_AUTO_SAVES`（=5）个 `isAuto=true` 的存档，超出则删除最旧的。手动存档不受影响。

6. **首次启动写入空索引**：`ensureIndexExists()` 在索引文件不存在时写入 `{version: '1.0.0', games: []}`，已存在时不覆盖。

7. **getGameConfig 向前兼容**：读取时与 `DEFAULT_GAME_LOCAL_CONFIG` 合并，确保新增字段有默认值（旧版本配置文件不会因缺字段而报错）。

#### 7.6.4 tableEdit 命令协议

`applyTableEdits(saveId, commands)` 接受 `GameTableEditCommand[]`，命令结构：

```typescript
interface GameTableEditCommand {
  type: GameTableEditCommandType;  // INSERT_ROW / UPDATE_ROW / DELETE_ROW
  sheetIndex: number;              // 从 1 开始
  rowIndex?: number;              // 从 1 开始（INSERT_ROW 时无此字段）
  rowData?: Record<string, any>;  // INSERT_ROW / UPDATE_ROW 时存在
  raw: string;                    // 原始命令文本（用于审计与错误定位）
}
```

行为：
- `INSERT_ROW`：若 `rowData['1']` 已存在则合并更新，否则追加到 sheet 末尾
- `UPDATE_ROW`：按 `rowIndex-1` 找到行并合并字段；越界记 error
- `DELETE_ROW`：按 `rowIndex-1` 找到行并删除；越界记 error
- 任何单条命令失败不中断后续命令（errors 收集后整体返回）

#### 7.6.5 复用基础设施

| 工具 | 来源 | 用途 |
|------|------|------|
| `getUserDataPath()` | `src/main/utils/appPath.ts` | 获取 userData 目录 |
| `safeWriteFile` | `src/main/services/writing/WritingProjectRepository.ts` | 原子写入（先 .tmp 再 rename） |
| `createEmptyTableData(schema)` | `src/shared/constants/game.constants.ts` | 按 schema 初始化空表格 |
| 类型定义 | `src/shared/types/game.types.ts` | `GameMeta / GameSaveMeta / GameTableData / GameTableEditCommand` 等 |
| 路径与文件名常量 | `src/shared/constants/game.constants.ts` | `GAMES_DIR_NAME / SAVE_META_FILENAME` 等 |

#### 7.6.6 测试覆盖

测试文件位于 `src/main/services/game/__tests__/`：

- `GameRepository.test.ts`（22 个用例）：覆盖 `listGames` / `createGameMeta` / `getGameMeta` / `updateGameMeta` / `deleteGameMeta` / `ensureIndexExists` / `getGameConfig` / `saveGameConfig` 与路径 helper
- `GameSaveRepository.test.ts`（38 个用例）：覆盖 `createSave` / `loadSave` / `listSaves`（按 updatedAt 倒序）/ `updateSave` / `deleteSave` / `pruneAutoSaves`（保留最近 5 个）/ `copySave`，以及 `GameTableRepository` 的 `initTableData` / `saveTableData` / `getTableData` / `applyTableEdits`（insertRow/updateRow/deleteRow/越界/混合命令）/ 版本快照

测试使用 `os.tmpdir()` 创建临时 userData 目录，通过 `vi.mock('../../../utils/appPath', ...)` 替换路径，每个 `beforeEach` 创建全新临时目录确保隔离。

#### 7.6.7 已知问题与历史记录

> ⚠️ **重点标记 - 已修复的 Bug（2026-07）**
>
> **Bug**: `GameTableRepository.applyTableEdits` 中模板字符串 `${tableData.sheets.length 个 sheet` 缺少闭合 `}`，导致 TypeScript 编译失败（连带影响后续行的解析）。
>
> **根因**: 中文混排时手写模板字符串遗漏了一个 `}`，使 `${...}` 表达式未闭合。
>
> **修复**: 在 `length` 后补回 `}`，改为 `${tableData.sheets.length} 个 sheet`。
>
> **教训**: 含中文标点的模板字符串应额外检查 `${}` 闭合；建议在 tsc 通过后再提交。该 bug 在 tsc 类型检查阶段即被发现并修复，未影响测试运行。

---

## 8. 核心功能模块

### 8.1 仪表盘 (Dashboard)
- 系统首页，展示数据统计概览 (世界书/角色卡/人设/插件数量)
- 自定义背景图片 (Base64 存储，响应式适配)
- 使用技巧轮播 (文件系统 tips.json)
- 版本更新检查 (⚠️ handler 未实现)
- 快捷文件夹访问

### 7.2 角色卡管理 (Character Manager)
- 图片类角色卡 (PNG/JPG/WebP) 的导入/查看/编辑/删除
- SillyTavern V2/V3 规范兼容 (`@lenml/char-card-reader`)
- 缩略图异步加载 (Base64 + 全局 Map 缓存)
- AI 翻译/润色/生成 (9 类字段各自独立操作)
- 世界书关联管理 (多对多关系、优先级、标签过滤)
- 原始值还原 (formValues + originalValues)

### 7.3 角色对话聊天 (Character Dialogue Chat)
- 多轮 AI 对话测试沙箱，流式响应 + 打字指示器
- 消息渲染管道 (react-markdown + 7 个 remark/rehype 插件)
- 配置面板: 人设选择 / AI 参数滑块 / 知识库绑定
- 续写、重试、编辑、取消、清空、导出
- 上下文增强: 向量检索 → 注入系统提示词
- 对话持久化 (ChatStorageService JSON 文件 + L1 缓存 60s TTL)
- 全屏模式
- AI 辅助输入：AI 回复按钮（从零生成用户回复）、润色按钮（基于草稿润色优化，Spec: refine-user-input-text）

**MessageRenderer 插件体系**:
- Remark 阶段: remark-gfm, remark-emoji, remark-underscore-italic, remark-table-cell-raw-html
- Rehype 阶段: rehype-raw, rehype-inline-html-parse, rehype-sanitize (三级), rehype-quote-normalize, rehype-quote-highlight, rehype-code-highlight, rehype-style-processor

**PromptBuilder 提示词构建函数**（`src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`）:
- `buildDialoguePrompt` / `buildContinuationPrompt`：构建角色扮演对话 / 续写场景的系统提示
- `buildUserReplySystemPrompt(characterInfo, persona, person?)`：AI 回复按钮专用，让 AI 扮演用户人设从零生成下一句回复（Spec: add-ai-user-reply-button / Task 1.1）
- `buildPolishInputSystemPrompt(characterInfo, persona, originalText, person?)`：润色按钮专用，让 AI 作为文本润色器在保持原始意图基础上优化用户草稿（Spec: refine-user-input-text / Task 1）；与 `buildUserReplySystemPrompt` 的区别在于后者从零生成，本函数基于已有草稿润色；防御性返回：`persona` / `persona.name` / `originalText` 为空时返回空串
- `buildStopSequences` / `buildStopSequencesForUserReply`：用户名 / 角色名变体停止序列，防抢话
- `buildRoleAnchorMessage`：角色深度锚定（depth_prompt），防止长上下文角色漂移
- `buildLengthGuidancePrompt` / `buildContinueNudgePrompt`：回复长度引导 / 续写去重约束
- `EMOTION_PRESETS`：30 项预置情绪清单（详见下方「7.3.1 表情管理系统」）
- `buildExpressionPrompt(charName, availableEmotionKeys)`：表情显示模式系统提示词，约束 AI 在回复末尾输出 `<<<EXPRESSION>>>key<<<END_EXPRESSION>>>` 情绪标记（Spec: add-character-expression-system / Task 3）
- `parseExpressionFromContent(content)`：从 AI 回复中多格式容错解析情绪标记，返回 `{ emotion, cleanedContent }`（Spec: add-character-expression-system / Task 3）
- `EMOTION_PROMPT_MAP`：30 种预置情绪 → Stable Diffusion 提示词映射表（`Record<string, { positive: string; negative?: string }>`），键名严格对齐 `EMOTION_PRESETS`，用于 AI 表情生成（img2img）（Spec: add-ai-expression-generation / Task 3，详见下方「7.3.2 AI 表情生成」）
- `buildExpressionGenerationPrompt(charDescription, emotionKey, customLabel?)`：构建 AI 表情生成的 SD 提示词，组合角色卡描述 + 情绪提示词 + 质量词，返回 `{ prompt, negativePrompt }`；自定义情绪通过 `customLabel` 兜底（Spec: add-ai-expression-generation / Task 3）

### 7.3.1 表情管理系统（Spec: add-character-expression-system）

> 增量更新（2026-07-26）：新增角色卡表情管理系统，每个角色卡独立维护表情包，AI 回复时根据语境动态切换头像表情，**代替**原 Emoji 增强模式。

#### 概述

表情管理系统让用户为每个角色卡上传多种情绪表情图片（每个角色卡独立的表情包），AI 在回复时根据语境动态切换头像表情，显著增强角色扮演的沉浸感与表现力。系统覆盖完整的存储层（主进程服务 + IPC）、提示词注入与解析层（PromptBuilder）、UI 层（表情管理弹窗 + 图片裁剪弹窗 + 参数面板开关）、渲染层（ChatMessageBubble 按情绪切换头像）与预加载优化层（expressionStore + 浏览器图像缓存预热）。

#### 存储与目录结构

每个角色卡的表情包独立存储于 `{userData}/data/character-expressions/{sanitizedCharacterCardId}/` 目录下：

```
{userData}/data/character-expressions/
└── {sanitizedCharacterCardId}/        # SHA-256(characterCardId) 前 16 个十六进制字符
    ├── manifest.json                  # 表情包清单（含预置/自定义情绪映射）
    ├── joy.png                        # 各情绪对应的 PNG 图像
    ├── anger.png
    └── shyness.png                    # 自定义情绪图像
```

`sanitizeCardId(characterCardId)` 取 `sha256(characterCardId)` 前 16 个十六进制字符（`utf8` 编码）：
- **确定性**：同一 characterCardId（角色卡文件路径字符串，可能含路径分隔符/空格/中文）始终映射到同一目录
- **抗碰撞性**：基于 SHA-256，不同 characterCardId 几乎不会冲突
- **文件系统安全**：仅含 `[0-9a-f]`，对任何文件系统都安全

#### Manifest 结构

```json
{
  "characterCardId": "原始-characterCardId-字符串",
  "version": 1,
  "expressions": {
    "joy": { "type": "preset", "image": "joy.png" },
    "shyness": { "type": "custom", "image": "shyness.png" }
  },
  "customEmotions": [
    { "key": "shyness", "label": "害羞" }
  ]
}
```

- `expressions`：已上传表情的映射，`emotionKey → { type, image }`，`type` 为 `'preset'` 或 `'custom'`
- `customEmotions`：用户为该角色卡添加的自定义情绪类别（含中英文映射），与 `expressions` 中的 `type: 'custom'` 条目一一对应

#### IPC 通道（命名空间 `expression`）

| 通道 | 调用签名 | 返回值 | 说明 |
|------|---------|--------|------|
| `expression:list` | `list(characterCardId)` | `ExpressionManifest` | 读取角色卡表情包清单（不存在时返回默认空 manifest） |
| `expression:saveImage` | `saveImage({ characterCardId, emotionKey, imageBase64, isCustom, label? })` | `{ success, error?, imagePath? }` | 保存表情图像（base64，可含 `data:image/png;base64,` 前缀）并更新 manifest；返回图像绝对路径。【重点标记 - CSP 兼容】渲染进程不应直接将 `imagePath` 用于 `<img src>`（会被 CSP 拦截），需通过 `file.readAsBase64` 转 data URL，或直接复用入参 `imageBase64`（已是 data URL） |
| `expression:deleteImage` | `deleteImage({ characterCardId, emotionKey })` | `{ success, error? }` | 删除指定情绪的图像文件（不删除 customEmotions 条目） |
| `expression:addCustomEmotion` | `addCustomEmotion({ characterCardId, key, label })` | `{ success, error? }` | 添加自定义情绪类别（key 校验 `^[a-z][a-z0-9_]*$`，不与预置重复） |
| `expression:removeCustomEmotion` | `removeCustomEmotion({ characterCardId, key })` | `{ success, error? }` | 移除自定义情绪：删除 customEmotions 条目 + expressions 条目 + 图像文件 |
| `expression:getImagePath` | `getImagePath({ characterCardId, emotionKey })` | `{ success, imagePath: string\|null, error? }` | 获取指定情绪的图像绝对路径（不存在返回 null）。【重点标记 - CSP 兼容】返回值为磁盘绝对路径，渲染进程使用前必须通过 `file.readAsBase64` 转 data URL |

注册入口 `registerExpressionHandlers()` 在 `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 中调用，每个 handler try/catch 兜底返回 `{ success: false, error }`。Preload 暴露 `window.electronAPI.expression.*`。

#### 预置情绪清单（30 项）

基于 GoEmotions 分类（27 项）+ default（默认）+ cheerfulness（快乐）共 30 项。预置类别不可删除，用户可在此基础上追加自定义情绪。

| key | label | key | label | key | label |
|-----|-------|-----|-------|-----|-------|
| `default` | 默认 | `disappointment` | 失望 | `optimism` | 乐观 |
| `admiration` | 钦佩 | `disapproval` | 不赞同 | `pride` | 自豪 |
| `amusement` | 愉悦 | `disgust` | 厌恶 | `realization` | 顿悟 |
| `anger` | 愤怒 | `embarrassment` | 尴尬 | `relief` | 宽慰 |
| `annoyance` | 恼怒 | `excitement` | 兴奋 | `remorse` | 懊悔 |
| `approval` | 赞同 | `fear` | 恐惧 | `sadness` | 悲伤 |
| `caring` | 关切 | `gratitude` | 感激 | `surprise` | 惊讶 |
| `confusion` | 困惑 | `grief` | 悲痛 | `cheerfulness` | 快乐 |
| `curiosity` | 好奇 | `joy` | 喜悦 | | |
| `desire` | 渴望 | `love` | 喜爱 | | |
| | | `nervousness` | 紧张 | | |
| | | `neutral` | 中性 | | |

#### AI 情绪标记格式

开启表情显示后，系统提示词注入 `buildExpressionPrompt(charName, availableEmotionKeys)`，要求 AI 在回复正文末尾另起一行输出结构化情绪标记：

```
<<<EXPRESSION>>>emotion_key<<<END_EXPRESSION>>>
```

- `emotion_key` 必须来自 `availableEmotionKeys` 列表（预置 30 + 当前角色卡自定义）
- 情绪难以判断时使用 `neutral`
- 标记对用户不可见，由 `parseExpressionFromContent(content)` 自动解析并剥离

**多格式容错匹配**（参照 `parseSuggestedOptions` 模式）：
1. 主格式：`<<<EXPRESSION>>>key<<<END_EXPRESSION>>>`（大小写不敏感）
2. 容错：仅有开始标记 `<<<EXPRESSION>>>key` 到文本末尾（AI 遗漏结束标记或被截断）
3. 兼容变体：`<expression>key</expression>`（纯标签）
4. 兼容变体：仅有 `<expression>key` 到末尾

解析成功后将 `emotion` 写入 `ChatMessage.emotion`，并以 `cleanedContent` 覆盖 `finalContent`（剥离标记）；解析失败时 `emotion` 为 `null`，回退默认头像。

#### 显示优先级

`ChatMessageBubble` 渲染头像时按以下优先级解析表情图像：
1. **自定义情绪表情**：用户为自定义情绪上传的图像
2. **预置情绪表情**：用户为预置情绪上传的图像
3. **默认头像**：角色卡 PNG 图像（即当前对话的 `avatarPath`）

`expressionStore.resolveExpressionImage(emotionKey)` 实现：null/undefined/空串/`'default'` 直接返回 null（回退默认头像）；其他 key 从 `imageCache` 查找 **data URL**。流式消息（`isStreaming`）期间使用默认头像，待流式完成后再切换为表情图像，避免闪烁。

**【重点标记 - CSP 裂图 BUG 修复（2026-07-27）】** `imageCache` 中**只存 data URL**，不存磁盘绝对路径。早期实现直接将 `expressionService.getImagePath / saveImage` 返回的磁盘路径（如 `C:\Users\...\character-expressions\{hash}\joy.png`）存入 `imageCache` 并用于 `<img src>`，但 `src/main/index.ts` 中 CSP 限制 `img-src 'self' data: blob:`，本地文件路径被浏览器拦截导致「裂开图片」图标。修复方案：
- `loadExpressions`：拿到 `getImagePath` 返回的绝对路径后，再调 `window.electronAPI.file.readAsBase64(path)` 读为 `data:image/png;base64,...` 存入 `imageCache`（与 `useCharacterSwitch.ts` 加载头像方式一致）
- `saveExpression`：入参 `imageDataUrl` 本身已是 data URL（来自 `ImageCropperModal` 裁剪输出 / `ExpressionGenerateModal` 的 SD 生成输出），保存成功后直接复用存入 `imageCache`，无需再读盘

**核心教训**：Electron 渲染进程启用了 `webSecurity: true` + 严格 CSP 时，本地文件路径不能直接用于 `<img src>`，必须通过 `file.readAsBase64` 转为 data URL（或注册自定义 protocol）。后续涉及「在渲染进程展示主进程落盘的图片」场景应统一遵循 data URL 模式。

#### 参数面板开关（代替 Emoji 增强模式）

`ParameterPanel.tsx` 中「开启表情」开关绑定 `expressionDisplay` / `onExpressionDisplayToggle` props，Tooltip 说明：「开启后，AI 回复时根据语境动态切换角色表情头像。需先在「表情管理」中上传表情图片。默认关闭。」

- 配置字段：`AIParameterConfig.expression_display?: boolean`（默认关闭，`undefined` 视为关闭）
- 透传链路：`ConfigPanel.tsx` → `CharacterDialogueChat.tsx` 计算 `expressionDisplay = characterConfig?.customParameters?.expression_display === true`，回调调用 `updateConfig({ customParameters: { ..., expression_display: enabled } })` 并 `saveConfig`
- **BREAKING**：移除原「Emoji 增强模式」开关 UI；`emoji_enhanced` 字段保留向后兼容但不再生效（标记 `@deprecated`）；`buildEmojiEnhancedPrompt` 函数保留在 PromptBuilder 中但不再被调用

#### 表情管理弹窗入口

`ChatHeader.tsx` 头部按钮区新增「表情管理」按钮（antd `Button` + `SmileOutlined` 图标），点击后由 `CharacterDialogueChat.tsx` 渲染 `ExpressionManagerModal` 并控制 open 状态，传入 `characterCardId` / `characterName` / `avatarPath`。

**【重点标记 - Task 15 补充入口（用户反馈）】** 用户反馈在角色卡编辑界面找不到表情上传入口，原入口仅位于对话头部。修复后新增第二入口：`CharacterEditModal.tsx` 的 Tabs 中新增第 4 个「表情管理」Tab（与 `角色信息` / `对话与指令` / `世界书关联` 并列）。Tab 内容：若 `editingItem.path` 存在则显示说明 Alert + 「打开表情管理」按钮（调用同一 `ExpressionManagerModal`）；新建角色卡（无 path）时显示「请先保存角色卡」警告。两个入口共用同一 `ExpressionManagerModal` 组件与 `expressionStore`，数据完全互通。

#### 关键文件清单

| 文件 | 职责 |
|------|------|
| `src/main/services/expressionService.ts` | 表情包存储/读取/删除主进程服务（单例 `expressionService`），SHA-256 目录哈希、manifest 读写、图像保存/删除/读取、自定义情绪 key 校验 |
| `src/main/ipc/handlers/expressionHandlers.ts` | IPC 通道注册（`registerExpressionHandlers`），6 个通道 |
| `src/main/ipc/index.ts` | 在 `setupIpcHandlers()` 中调用 `registerExpressionHandlers()` |
| `src/main/preload.ts` | 暴露 `electronAPI.expression.*` API |
| `src/renderer/types/electron.d.ts` | `expression` 命名空间类型声明 |
| `src/renderer/stores/expressionStore.ts` | Zustand 表情状态 store（`useExpressionStore`），持有 `manifest` / `imageCache`（**仅存 data URL，CSP 兼容**）/ `loading` / `error`，封装所有 IPC 调用，提供 `loadExpressions` / `saveExpression` / `deleteExpression` / `addCustomEmotion` / `removeCustomEmotion` / `resolveExpressionImage` / `getAvailableEmotionKeys` / `clear` actions。【重点标记 - CSP 裂图 BUG 修复】imageCache 不存磁盘绝对路径，避免被 CSP `img-src 'self' data: blob:` 拦截 |
| `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | `EMOTION_PRESETS` 常量、`buildExpressionPrompt` / `parseExpressionFromContent` 函数（Spec: add-character-expression-system）；`EMOTION_PROMPT_MAP` 常量、`buildExpressionGenerationPrompt` 函数（Spec: add-ai-expression-generation / Task 3） |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx` | 表情管理弹窗：30 预置 + 自定义情绪网格、上传/删除/预览、添加/移除自定义情绪表单 |
| `src/renderer/components/Character/CharacterDialogueChat/ImageCropperModal.tsx` | 图片裁剪弹窗：基于 `react-easy-crop`，方形裁剪、缩放滑块 0.5~5x、滚轮缩放、PNG 输出、长边 > 512px 压缩 |
| `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx` | 「表情管理」入口按钮（对话头部） |
| `src/renderer/components/Character/CharacterEditModal.tsx` | 「表情管理」Tab 入口（角色卡编辑弹窗，Task 15 补充） |
| `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx` | 「开启表情」开关区块 |
| `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` | 透传 `expressionDisplay` / `onExpressionDisplayToggle` |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` | 渲染 `ExpressionManagerModal`、`expressionDisplay` 状态绑定、`useEffect` 预加载 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` | 注入 `buildExpressionPrompt`、解析 `parseExpressionFromContent`、写入 `ChatMessage.emotion`、`emotionStripped` 容差标志 |
| `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` | 新增 `expressionImage?: string` prop，按情绪渲染头像（自定义 > 预置 > 默认头像三级回退） |
| `src/shared/types/chat.types.ts` | `ChatMessage.emotion?: string` 字段 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` | 同步 `emotion` 字段、`expression_display` 字段、`emoji_enhanced` 标记 `@deprecated` |

#### 图片裁剪工具

`ImageCropperModal` 基于 `react-easy-crop`（v6.2.3）实现方形裁剪：
- **交互**：`<Cropper>` aspect=1（方形）、`showGrid` + `zoomWithScroll`（滚轮缩放内置）；antd `Slider` 0.5~5 步长 0.1 绑定 zoom；`onCropComplete` 缓存 `croppedAreaPixels`
- **输出**：`getCroppedImg(imageSrc, pixelCrop)` 异步函数，通过 canvas 提取裁剪区域，输出 PNG data URL；长边超过 512px 时按 `MAX_LONG_SIDE / longSide` 系数等比缩放压缩（一次 drawImage 到目标尺寸），符合 Spec「图像格式统一与压缩」要求
- **状态重置**：`useEffect` 监听 `open` + `imageSrc`，弹窗打开或图片切换时重置 crop/zoom/croppedAreaPixels/mediaSize
- **UI 风格**：antd Modal 暗色主题 width=640，自包含 inline styles，使用项目 CSS 变量

#### 表情图像预加载机制

`expressionStore.loadExpressions(characterCardId)` 加载 manifest 时，对每个已上传的表情图像路径创建 `new Image()` 对象预加载（fire-and-forget），写入浏览器图像缓存。后续情绪切换直接命中缓存避免闪烁。`CharacterDialogueChat.tsx` 的 `useEffect` 在 `expressionDisplay === true` 且 `characterInfo.characterCardId` 变化时调用 `loadExpressions`；`ExpressionManagerModal` 保存/删除表情后亦调用 `loadExpressions` 刷新缓存。

### 7.3.2 AI 表情生成（Spec: add-ai-expression-generation）

> 增量更新（2026-07-27）：新增 AI 表情生成功能，基于角色卡基底图片 + Stable Diffusion img2img + 情绪提示词自动生成对应表情图像，免去用户手动上传每一种情绪表情的负担。本节为 Task 3（情绪 → SD 提示词映射）的落地说明。
>
> 增量更新（2026-07-27 / Task 6）：新增 SD WebUI 设置面板（`SDWebuiSettings.tsx`），位于 Settings 页面 AI 引擎设置与向量配置之间。配置项包括端点 URL、模型选择、denoising strength、steps、CFG scale、ADetailer 开关、自定义负面提示词，持久化到 `AppSetting.sdWebui`。连接测试与模型列表通过 `window.electronAPI.sd.checkStatus` / `sd.getModels` 调用主进程 `sdGenerationService`。详见 CODE_WIKI.md §14.16。
>
> 增量更新（2026-07-27 / Task 5）：在 `ExpressionManagerModal` 中新增两个 AI 生成入口，调用 Task 4 的 `ExpressionGenerateModal` 组件。
> - **批量入口**：顶部工具栏新增「AI 生成全部表情」按钮（`ThunderboltOutlined` 图标），位于「添加自定义情绪」按钮右侧。若已有任何表情图，`handleBatchGenerate` 弹出 `Modal.confirm` 二次确认避免误覆盖。
> - **单张入口**：每个非 default 情绪卡片操作区新增「AI 生成」按钮（`RobotOutlined` 图标，位于「上传」与「删除」按钮之间），`onClick` 调用 `e.stopPropagation()` 后打开单张生成弹窗。
> - **新增 state**：`generateModalOpen` / `generateMode`（`'batch' | 'single'`）/ `generateTargetKey?` / `generateTargetLabel?`
> - **刷新机制**：`ExpressionGenerateModal` 的 `onGenerated` 回调调用 `loadExpressions(characterCardId)` 刷新 store，使新生成的图片立即显示在网格中。
> - **【重点标记】未导入 `ExpressionGenerateModalProps` 类型**：项目 `tsconfig.json` 启用 `noUnusedLocals: true`，本组件直接 inline 传递 props，故仅 import 默认导出，避免未使用类型导入触发 tsc 错误。
> - 详见 `CODE_WIKI.md` §14.12.3。

#### 概述

与 7.3.1 的「手动上传表情」机制互补：用户既可手动上传表情图片，也可一键调用 AI 生成。AI 表情生成的提示词构建逻辑独立于「让 AI 在回复文本中输出情绪标记」的 `buildExpressionPrompt`（后者只产出情绪键名，不涉及 SD 提示词）。

#### 情绪 → SD 提示词映射（`EMOTION_PROMPT_MAP`）

`PromptBuilder.ts` 末尾新增 `EMOTION_PROMPT_MAP: Record<string, { positive: string; negative?: string }>`，键名严格对齐 `EMOTION_PRESETS` 的 30 个 key（`default` / `admiration` / ... / `cheerfulness`）。

- `positive`：情绪正面提示词（英文，SD 语义），如 `joy` → `joyful expression, bright smile, radiant, happy tears, elated`
- `negative`（可选）：该情绪特有的负面提示词；多数情绪不提供，仅使用通用负面词

#### 提示词构建函数（`buildExpressionGenerationPrompt`）

```typescript
buildExpressionGenerationPrompt(charDescription, emotionKey, customLabel?): { prompt, negativePrompt }
```

组合规则：
1. **角色描述**：使用 `charDescription`（角色卡 `description` 字段）；为空时 fallback 到 `"character"` 占位，避免 SD 生成无主体图像
2. **情绪提示词解析**（优先级递减）：
   - 预置情绪（`emotionKey` 在 `EMOTION_PROMPT_MAP` 中）：取 `mapped.positive` / `mapped.negative`
   - 自定义情绪（不在 MAP 中但提供 `customLabel`）：`${customLabel} expression, emotional face`（保留中文语义以备翻译层处理）
   - 既不在 MAP 中也无 `customLabel`：回退到 `EMOTION_PROMPT_MAP.neutral.positive`
3. **正面提示词拼接**：`{charDescription}, {emotionPositive}, portrait, looking at viewer, simple background, high quality, best quality, masterpiece, detailed face`
4. **负面提示词拼接**：通用负面 `deformed, ugly, bad anatomy, multiple faces, text, watermark, low quality, blurry, mutated hands, extra digits, missing fingers, bad proportions` + 情绪特有负面（若有）

注：不硬编码 `"1girl"` 等角色类型 tag，由 `charDescription` 自行包含角色外观描述，兼容任意性别/物种的角色卡。

#### 【重点标记 - Spec 约束修改】

原 Spec `add-character-expression-system` 约束 1.b「表情图像仅通过用户上传实现，无任何『自动生成』入口」**已修改**为「允许通过本地 SD WebUI AI 生成，用户也可手动上传，两种方式并存」（见 `add-ai-expression-generation/spec.md` §MODIFIED Requirements）。

这是架构层面的约束变更：从「纯手动」演进为「AI 生成 + 手动上传并存」。关键设计原则：

- **存储完全共用**：AI 生成的图片与手动上传的图片写入同一目录（`data/character-expressions/{sha256(cardId).slice(0,16)}/`）、同一 manifest，无任何区分
- **渲染逻辑不变**：`ChatMessageBubble` / `expressionStore.resolveExpressionImage` 不感知图片来源，统一按 `emotionKey` 查找
- **AI 生成仅是「写入表情存储」的另一条数据源**：调用 `expressionStore.saveExpression` 保存，与手动上传走完全相同的 IPC 通道（`expression:saveImage`）
- **可互相替换/删除**：AI 生成的表情可被手动上传覆盖，手动上传的表情可被 AI 生成覆盖，删除逻辑完全一致

#### 完整管线架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         渲染进程 (Renderer)                          │
│                                                                     │
│  ExpressionManagerModal                                             │
│    ├─ 「AI 生成全部表情」按钮 (ThunderboltOutlined) ── batch 模式    │
│    └─ 每个情绪格子「AI 生成」按钮 (RobotOutlined) ── single 模式    │
│            ↓                                                        │
│  ExpressionGenerateModal                                            │
│    ├─ 加载 SD 设置 (setting.load → sdWebui)                         │
│    ├─ 加载角色卡描述 (character.read → data.description)            │
│    ├─ 检测 SD 状态 (sd.checkStatus)                                 │
│    ├─ 构建提示词 (buildExpressionGenerationPrompt)                  │
│    ├─ batch: sd.generateAllExpressions + 监听 progress 事件         │
│    │         每张成功 → expressionStore.saveExpression 立即保存     │
│    └─ single: sd.generateExpression → 预览 → 保存/重新生成          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ IPC (window.electronAPI.sd.*)
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                          主进程 (Main)                              │
│                                                                     │
│  sdGenerationHandlers (IPC 层)                                      │
│    ├─ sd:checkStatus / sd:getModels                                 │
│    ├─ sd:generateExpression (extractBaseImage + generateExpression) │
│    ├─ sd:generateAllExpressions (循环 + progress 事件推送)          │
│    └─ sd:cancelGeneration (设置 isCancelled 标志位)                 │
│            ↓                                                        │
│  sdGenerationService (服务层)                                       │
│    ├─ extractBaseImage: readFileSync(characterCardPath) → base64    │
│    ├─ generateExpression: POST /sdapi/v1/img2img                    │
│    │   ├─ init_images: [base64]                                     │
│    │   ├─ prompt / negative_prompt                                  │
│    │   ├─ denoising_strength: 0.55, steps: 28, cfg: 7              │
│    │   ├─ sampler: DPM++ 2M Karras, 512×512                         │
│    │   └─ alwayson_scripts.ADetailer (face_yolov8n.pt, denoising 0.4)│
│    ├─ cancelGeneration: POST /sdapi/v1/interrupt                    │
│    └─ checkStatus: GET /sdapi/v1/options                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP (fetch + AbortController)
                                ↓
                    ┌───────────────────────┐
                    │  SD WebUI Forge Neo   │
                    │  (localhost:7860)     │
                    │  需 --api 参数启动    │
                    └───────────────────────┘
```

#### 批量生成工作流（batch 模式）

1. **入口**：`ExpressionManagerModal` 顶部工具栏「AI 生成全部表情」按钮 → 若已有表情图则 `Modal.confirm` 二次确认 → 打开 `ExpressionGenerateModal` mode=batch
2. **初始化**：弹窗打开时加载 SD 设置 + 角色卡描述 + 检测 SD 状态（不可达时显示错误 + 启动指引）
3. **启动生成**：用户点击「开始生成」→ 为全部 30 个预置情绪构建提示词 → 调用 `sd:generateAllExpressions`
4. **进度推送**：主进程循环生成，每张完成通过 `sd:generationProgress` 推送 `{ current, total, emotionKey, status, imageBase64? }`
5. **实时保存**：渲染进程收到 progress 事件且 `status === 'success'` 时，**立即**调用 `expressionStore.saveExpression` 保存该张（不等全部完成），网格实时刷新
6. **取消**：用户点击「取消生成」→ `sd:cancelGeneration` 设置 `isCancelled = true` → 主进程下次循环检查时退出；当前进行中的 img2img 请求由 120s 超时兜底
7. **完成**：主进程推送 `sd:generationComplete` `{ total, success, failed, cancelled }` → 弹窗显示汇总 → `loadExpressions` 刷新 store → `onGenerated?.()` 通知父组件

#### 单个生成工作流（single 模式）

1. **入口**：情绪格子操作区「AI 生成」按钮（RobotOutlined）→ 打开 `ExpressionGenerateModal` mode=single，传入 `targetEmotionKey`
2. **构建提示词**：`buildExpressionGenerationPrompt(charDescription, targetEmotionKey, customLabel?)` + 合并用户自定义负面提示词
3. **生成**：用户点击「开始生成」→ `sd:generateExpression({ characterCardPath, emotionKey, prompt, negativePrompt, options })`
4. **预览**：成功后拼接 `data:image/png;base64,` 前缀，展示 256×256 预览（antd `Image` 支持点击放大）
5. **保存/重新生成**：用户选择「保存」（调用 `saveExpression` → 刷新 store → 关闭弹窗）或「重新生成」（重新调用 IPC）
6. **自定义情绪**：`isCustom = !EMOTION_PRESETS.some(e => e.key === targetEmotionKey)`，保存时传入 `isCustom` 与 `label`

#### 错误处理

| 场景 | 表现 | 用户提示 |
|------|------|---------|
| SD WebUI 未启动 | `checkStatus` 返回 `available: false` | Alert 显示「无法连接 SD WebUI，请确认 Forge Neo 已启动且开启了 API（--api 参数）」 |
| 请求超时（120s） | `generateExpression` 返回 `error` | 单个模式显示错误 + 「重新生成」按钮；批量模式该张记为 failed，继续下一张 |
| 模型未加载 | `checkStatus` 返回 `currentModel: undefined` | Alert 提示「SD WebUI 未加载模型」 |
| img2img 返回空 images | `generateExpression` 返回 `error` | 同请求超时处理 |
| 批量生成中部分失败 | progress 事件 `status: 'failed'` | 进度条继续，失败张数累计，完成后汇总显示「成功 N 张 / 失败 N 张」 |

#### SD WebUI 设置（Settings 页面）

`SDWebuiSettings.tsx` 位于 Settings 页面，配置项持久化到 `AppSetting.sdWebui`：

| 配置项 | 字段 | 默认值 | 说明 |
|--------|------|--------|------|
| 端点 URL | `endpoint` | `http://localhost:7860` | Forge Neo API 地址，需 `--api` 启动 |
| 模型 | `model` | （空=使用当前） | 从 `sd:getModels` 拉取的下拉列表 |
| Denoising Strength | `denoisingStrength` | 0.55 | 滑块 0.1-0.9，控制表情变化幅度 |
| Steps | `steps` | 28 | SDXL 推荐步数 |
| CFG Scale | `cfgScale` | 7 | 提示词遵循度 |
| Sampling Method | `sampler` | `DPM++ 2M Karras` | 【重点标记 - 采样器可配置（2026-07-27）】`AutoComplete` 下拉 + 自由输入，10 个 SDXL 推荐采样器预设。早期版本缺失此字段导致采样器固定无法更改 |
| ADetailer | `adetailerEnabled` | true | 面部修复开关 |
| 自定义负面提示词 | `customNegativePrompt` | （空） | 留空使用 `buildExpressionGenerationPrompt` 默认负面词 |
| **ADetailer 高级参数**（折叠面板） | — | — | 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展（2026-07-27）】字段名严格对齐 `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs`（pydantic `extra="forbid"`）。包含 16 个字段：`adModel`（检测模型，9 预设）/ `adConfidence`（0-1）/ `adDenoisingStrength`（0-1）/ `adMaskBlur`（0-20）/ `adDilateErode`（-20~20）/ `adInpaintOnlyMasked`（bool）/ `adInpaintOnlyMaskedPadding`（0-128）/ `adUseInpaintWidthHeight`+`adInpaintWidth`+`adInpaintHeight` / `adUseSteps`+`adSteps` / `adUseCfgScale`+`adCfgScale` / `adUseSampler`+`adSampler` |

连接测试按钮调用 `sd.checkStatus`，结果显示当前模型 checkpoint 或错误信息。

**【重点标记 - ADetailer-Neo 兼容性修复（2026-07-27）】** 早期实现错误使用了 `ad_inpaint_full_res`（Neo 已移除）和 `ad_dilation`（正确字段名为 `ad_dilate_erode`），导致 SD WebUI 控制台报 `pydantic_core._pydantic_core.ValidationError: Extra inputs are not permitted`。修复方案：直接读取用户本地 `extensions/ADetailer-Neo/lib_adetailer/args.py` 确认 `ADetailerArgs` 字段定义，移除非法字段、修正字段名、补全 `ad_inpaint_only_masked_padding` 等缺失字段，并扩展设置 UI 暴露全套高级参数。**核心教训**：集成 SD WebUI 扩展时必须直接读取本地扩展源码确认 pydantic 模型的 `extra` 策略与字段名，不能依赖网络搜索到的「原版」参数文档。

#### IPC 通道（命名空间 `sd`）

| 通道 | 调用签名 | 返回值 | 说明 |
|------|---------|--------|------|
| `sd:checkStatus` | `checkStatus(endpoint)` | `{ available, currentModel?, error? }` | GET `/sdapi/v1/options`，检测 SD WebUI 可用性 |
| `sd:getModels` | `getModels(endpoint)` | `{ success, models: SDModel[], error? }` | GET `/sdapi/v1/sd-models`，获取模型清单 |
| `sd:generateExpression` | `generateExpression({ characterCardPath, emotionKey, prompt, negativePrompt, options? })` | `{ success, imageBase64?, error? }` | 单个生成：extractBaseImage + img2img |
| `sd:generateAllExpressions` | `generateAllExpressions({ characterCardPath, emotions, options? })` | `{ success, total, successCount, failedCount, cancelledCount }` | 批量生成 + progress 事件推送 |
| `sd:cancelGeneration` | `cancelGeneration()` | `{ success: true }` | 设置 `isCancelled` 标志位，下次循环退出 |

**事件推送**（渲染进程通过 `onGenerationProgress` / `onGenerationComplete` 监听）：
- `sd:generationProgress`：`{ current, total, emotionKey, status: 'success'|'failed', error?, imageBase64? }`
- `sd:generationComplete`：`{ total, success, failed, cancelled }`

#### 关键文件清单

| 文件 | 职责 |
|------|------|
| `src/main/services/sdGenerationService.ts` | SD WebUI API 客户端服务（单例），fetch + AbortController 超时控制，img2img 请求体构建，ADetailer 面部修复配置 |
| `src/main/ipc/handlers/sdGenerationHandlers.ts` | IPC 通道注册（5 个），批量生成循环 + progress 事件推送 + isCancelled 取消机制 |
| `src/main/ipc/index.ts` | 在 `setupIpcHandlers()` 中调用 `registerSdGenerationHandlers()` |
| `src/main/preload.ts` | 暴露 `electronAPI.sd.*` 命名空间（8 个方法含事件监听） |
| `src/renderer/types/electron.d.ts` | `sd` 命名空间 TypeScript 类型声明 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | AI 表情生成弹窗（batch + single 双模式），进度条 + 实时保存 + 预览 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx` | AI 生成入口（顶部「AI 生成全部表情」按钮 + 格子内「AI 生成」按钮） |
| `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | `EMOTION_PROMPT_MAP`（30 项）+ `buildExpressionGenerationPrompt` 函数 |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | SD WebUI 设置面板（端点/模型/denoising/steps/cfg/ADetailer/负面提示词） |
| `src/renderer/components/Settings/Settings.tsx` | 集成 SDWebuiSettings，handleSave 时合并 sdWebui 配置 |
| `src/renderer/types/setting.ts` | `SDWebuiConfig` 接口定义 |
| `src/shared/settings.ts` | `defaultSetting.sdWebui` 默认配置（与 sdGenerationService 默认参数一致） |

### 7.3.3 角色素材管理与特征管理（Spec: add-asset-and-trait-management）

> 增量更新（2026-07-27 / Task 2 + Task 7）：在表情管理（7.3.1）基础上扩展为通用素材管理 + 角色视觉特征管理。本节为 IPC 层（Task 2 + Task 7）落地说明，服务层（Task 1 + Task 6）由其他 Sub-Agent 完成。
>
> 设计目标：
> - **特征管理（Task 1 + 2）**：为每个角色卡持久化视觉特征 tag 数组（如 `["white fur", "dog girl", "black shirt"]`），SD 生成素材时携带该特征以保证角色一致性（毛色/服饰/物种等关键特征不漂移）。
> - **素材管理（Task 6 + 7）**：将表情管理拓展为通用素材管理，新增三种素材类型 `illustration`（角色立绘）/ `general`（一般图像）/ `three-view`（三视图 front/side/back 三槽位）。表情类型继续由 `expressionService` 管理，不纳入本服务，保证向后兼容。

#### 存储路径设计

| 数据类型 | 存储路径 |
|---------|---------|
| 角色特征 | `{userData}/data/character-traits/{sha256(characterCardId).slice(0,16)}/traits.json` |
| 素材 PNG | `{userData}/data/character-assets/{sha256(characterCardId).slice(0,16)}/{assetType}/{assetId}.png` |
| 素材清单 | `{userData}/data/character-assets/{sha256(characterCardId).slice(0,16)}/{assetType}/manifest.json` |

- `sha256(characterCardId).slice(0,16)` 与 `expressionService.sanitizeCardId` 完全一致，同一角色卡在 `character-expressions / character-traits / character-assets` 三个目录下使用同一 hash 子目录名
- 每个 `assetType` 拥有独立子目录与独立 manifest，便于按类型批量读取/迁移

#### Manifest 结构

**特征 manifest（traits.json）**：

```json
{
  "characterCardId": "原始-characterCardId-字符串",
  "version": 1,
  "traits": ["white fur", "dog girl", "black shirt"]
}
```

**素材 manifest（manifest.json）**：

```json
{
  "characterCardId": "原始-characterCardId-字符串",
  "version": 1,
  "assets": {
    "front": {
      "id": "front",
      "type": "three-view",
      "slot": "front",
      "image": "front.png",
      "createdAt": "2026-07-27T12:00:00.000Z"
    },
    "main_illustration": {
      "id": "main_illustration",
      "type": "illustration",
      "image": "main_illustration.png",
      "createdAt": "2026-07-27T12:00:00.000Z"
    }
  }
}
```

- 三视图类型（`three-view`）的 `assetId` 仅允许 `front` / `side` / `back`，`slot` 字段与 `assetId` 一致；非 `three-view` 类型忽略 `slot` 字段

#### IPC 通道（命名空间 `characterTrait`，Task 2）

| 通道 | 调用签名 | 返回值 | 说明 |
|------|---------|--------|------|
| `character-trait:list` | `list(characterCardId)` | `string[]` | 读取角色卡视觉特征 tag 数组；文件不存在或解析失败时返回 `[]` |
| `character-trait:save` | `save({ characterCardId, traits })` | `{ success, error? }` | 覆盖保存特征 tag 数组（自动创建目录，原子写入 traits.json） |
| `character-trait:clear` | `clear(characterCardId)` | `{ success, error? }` | 删除 traits.json 文件（文件不存在视为幂等成功，仅删文件保留目录） |

#### IPC 通道（命名空间 `asset`，Task 7）

| 通道 | 调用签名 | 返回值 | 说明 |
|------|---------|--------|------|
| `asset:list` | `list({ characterCardId, assetType })` | `AssetManifest` | 读取角色卡 × assetType 的素材包清单；不存在时返回默认空 manifest |
| `asset:save` | `save({ characterCardId, assetType, assetId, imageBase64, slot? })` | `{ success, error?, imagePath? }` | 保存素材图像（base64，可含 `data:image/png;base64,` 前缀）并更新 manifest；返回图像绝对路径。【重点标记 - CSP 兼容】imagePath 为磁盘路径，渲染进程不应直接用于 `<img src>`，需通过 `file.readAsBase64` 转 data URL |
| `asset:delete` | `delete({ characterCardId, assetType, assetId })` | `{ success, error? }` | 删除素材图像并从 manifest.assets 移除条目（图像不存在视为幂等成功） |
| `asset:getImagePath` | `getImagePath({ characterCardId, assetType, assetId })` | `{ success, imagePath: string\|null, error? }` | 获取指定素材的图像绝对路径；不存在时 `imagePath=null`、`success=true`。【重点标记 - CSP 兼容】返回值为磁盘绝对路径，渲染进程使用前必须通过 `file.readAsBase64` 转 data URL（与 `expression:getImagePath` 处理方式一致） |

注册入口 `registerCharacterTraitHandlers()` / `registerAssetHandlers()` 在 `src/main/ipc/index.ts` 的 `setupIpcHandlers()` 中调用（紧跟 `registerExpressionHandlers()` 之后），每个 handler try/catch 兜底返回 `{ success: false, error }`。Preload 暴露 `window.electronAPI.characterTrait.*` 与 `window.electronAPI.asset.*`。

#### 类型契约约定

- **preload 透传类型**：`assetType` 在 preload 中透传为 `string`（避免主进程 `AssetType` 联合类型泄露到渲染进程），实际仅接受 `'illustration' | 'general' | 'three-view'`，`slot` 字段仅接受 `'front' | 'side' | 'back'`，service 内部对三视图类型校验 `assetId` 是否在 `front/side/back` 白名单内
- **electron.d.ts 内联声明**：`AssetManifest` / `AssetEntry` 类型在 `electron.d.ts` 中采用内联声明（与 expression 命名空间一致），避免主进程服务类型导入到渲染进程类型声明文件

#### 关键文件清单

| 文件 | 职责 |
|------|------|
| `src/main/services/characterTraitService.ts` | 特征存储主进程服务（单例 `characterTraitService`），Task 1 产出；SHA-256 目录哈希、traits.json 读写、特征清单覆盖保存/清除 |
| `src/main/services/assetService.ts` | 素材存储主进程服务（单例 `assetService`），Task 6 产出；按 `assetType` 分目录管理 PNG + manifest、三视图槽位约束、图像保存/删除/读取 |
| `src/main/ipc/handlers/characterTraitHandlers.ts` | IPC 通道注册（`registerCharacterTraitHandlers`），3 个通道（list / save / clear），Task 2 产出 |
| `src/main/ipc/handlers/assetHandlers.ts` | IPC 通道注册（`registerAssetHandlers`），4 个通道（list / save / delete / getImagePath），Task 7 产出；`getImagePath` 把 `string\|null` 包装为 `{ success, imagePath, error? }` 结构，与 `expression:getImagePath` 返回形态一致 |
| `src/main/ipc/index.ts` | 在 `setupIpcHandlers()` 中依次调用 `registerExpressionHandlers` / `registerCharacterTraitHandlers` / `registerAssetHandlers` / `registerSdGenerationHandlers` |
| `src/main/preload.ts` | 暴露 `electronAPI.characterTrait.{list, save, clear}` 与 `electronAPI.asset.{list, save, delete, getImagePath}` 命名空间 |
| `src/renderer/types/electron.d.ts` | `characterTrait` / `asset` 命名空间 TypeScript 类型声明（内联 `AssetManifest` 结构） |

#### 与表情系统的关系（向后兼容策略）

- **目录隔离**：表情 / 特征 / 素材三个数据集存储在 `data/character-expressions/` / `data/character-traits/` / `data/character-assets/` 三个独立根目录下，互不重叠
- **服务隔离**：`expressionService` 继续负责表情类型，`characterTraitService` 负责特征清单，`assetService` 负责三种新素材类型；三个服务互不依赖，单例各自独立
- **哈希一致**：三个服务的 `sanitizeCardId` 实现完全一致（SHA-256 前 16 位），同一角色卡在三个目录下使用同一 hash 子目录名，便于未来跨类型检索
- **零回归**：表情系统（7.3.1）的所有现有功能无需迁移，所有现有 IPC 通道与 store 不受影响

#### 整体架构图（Task 1-15 全量落地，2026-07-27 补充）

```
┌──────────────────────── 渲染进程（Renderer） ─────────────────────────┐
│                                                                      │
│  AssetManagerModal.tsx ── 5 Tab ──────────────────────────────────┐  │
│   ├─ 表情 Tab    ──> ExpressionTabContent                          │  │
│   ├─ 角色立绘   ──> AssetGridTabContent('illustration')              │  │
│   ├─ 一般图像   ──> AssetGridTabContent('general')                  │  │
│   ├─ 三视图     ──> ThreeViewTabContent('three-view')               │  │
│   └─ 角色特征   ──> CharacterTraitTabContent                         │  │
│                                                                     │  │
│   顶层统一入口：openGenerateModal(mode, options?)                   │  │
│       │                                                             │  │
│       v                                                             │  │
│   AssetGenerateModal.tsx ── 5 mode ───────────────────────────────┐  │  │
│   ├─ batch-expression / single-expression  ──> expressionStore    │  │  │
│   ├─ illustration / general / three-view    ──> assetStore         │  │  │
│   └─ 所有 mode 打开时读 characterTrait.list ──> options.characterTraits │
│                                                                     │  │
│   Stores:                                                           │  │
│   ├─ expressionStore       (§7.3.1)                                  │  │
│   ├─ assetStore           (Task 8) ── imageCache 仅存 data URL     │  │
│   └─ characterTraitStore  (Task 3 + Task 13 setTraits)              │  │
│                                                                     │  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ IPC (preload 透传)
                                   v
┌──────────────────────── 主进程（Main） ─────────────────────────────┐
│                                                                     │
│  IPC Handlers (src/main/ipc/handlers/):                            │
│   ├─ expressionHandlers       ──> expressionService                │
│   ├─ characterTraitHandlers   ──> characterTraitService            │
│   ├─ characterTraitAIHandlers ──> characterTraitAIService           │
│   ├─ assetHandlers            ──> assetService                    │
│   └─ sdGenerationHandlers     ──> sdGenerationService               │
│                                  │                                  │
│                                  v                                  │
│                          sdGenerationService:                       │
│                          options.characterTraits ──> 替换 prompt 中 │
│                              的 {traits} 占位符（含 ADetailer       │
│                              ad_prompt 同步注入）                   │
│                                  │                                  │
│                                  v                                  │
│                          本地 Forge Neo /sdapi/v1/img2img           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   v
┌─────────────────────────── 数据持久层 ──────────────────────────────┐
│  {userData}/data/                                                  │
│   ├─ character-expressions/{hash}/         (expressionService)      │
│   │   └─ {emotionKey}.png + manifest.json                          │
│   ├─ character-traits/{hash}/              (characterTraitService)  │
│   │   └─ traits.json                                                │
│   └─ character-assets/{hash}/              (assetService)           │
│       ├─ illustration/{assetId}.png + manifest.json                 │
│       ├─ general/{assetId}.png + manifest.json                      │
│       └─ three-view/{front|side|back}.png + manifest.json          │
└────────────────────────────────────────────────────────────────────┘
```

#### 素材类型表

| assetType | 中文名 | assetId 规则 | 存储路径 | 主进程服务 | 渲染进程 store |
|-----------|--------|-------------|---------|-----------|----------------|
| `expression`（不属于本 Spec） | 表情 | `emotionKey`（30 预置 + 自定义） | `data/character-expressions/{hash}/{emotionKey}.png` | `expressionService` | `expressionStore` |
| `illustration` | 角色立绘 | `ill_{timestamp}_{random}` | `data/character-assets/{hash}/illustration/{assetId}.png` | `assetService` | `assetStore` |
| `general` | 一般图像 | `gen_{timestamp}_{random}` | `data/character-assets/{hash}/general/{assetId}.png` | `assetService` | `assetStore` |
| `three-view` | 三视图 | **仅 `front` / `side` / `back`** | `data/character-assets/{hash}/three-view/{front|side|back}.png` | `assetService` | `assetStore` |

- 表情类型继续由 `expressionService` 管理，**不纳入 `assetService`**，保证向后兼容
- `three-view` 类型在 `assetService` 内部对 `assetId` 做白名单校验（`THREE_VIEW_ALLOWED_SLOTS = ['front', 'side', 'back']`），违例返回 `{ success: false, error }`
- 三个 `assetType` 共用同一 hash 子目录但各占独立子目录与独立 manifest，便于按类型批量读取/迁移

#### 特征携带流程（Task 4 + Task 5 + Task 10）

**【重点标记 - 特征携带机制是角色一致性的核心保障】** 该机制保证 SD 生成素材时自动携带角色视觉特征 tag，避免毛色/服饰/物种等关键特征漂移。

```
1. 用户在 AssetManagerModal「角色特征」Tab 编辑特征 tag 数组
   └─ characterTraitStore.saveTraits ──IPC──> characterTraitService.saveTraits
                                                └─> 写入 traits.json

2. 用户在 AssetGenerateModal 任一 mode 点击「开始生成」
   └─ 打开弹窗时调 characterTrait.list(characterCardId) 读取 traits
   └─ buildSdOptions 时透传 traits 到 options.characterTraits

3. 渲染进程 sd.generateExpression IPC
   └─> 主进程 sdGenerationHandlers
        └─> sdGenerationService.generateExpression(params, options)
             ├─ options.characterTraits 存在？
             │   ├─ 是：prompt 中的 {traits} 占位符替换为 "trait1, trait2, trait3"
             │   │      循环 replace(/,\s*,/g, ',') 直至收敛（清理空逗号）
             │   │      清理开头/结尾逗号与多余空格
             │   │      ADetailer ad_prompt 同步使用已注入特征的最终 prompt
             │   └─ 否：{traits} 替换为空字符串并清理多余逗号
             └─> POST /sdapi/v1/img2img 生成
```

- `{traits}` 占位符由上游 `PromptBuilder.buildExpressionGenerationPrompt(emotionKey, customLabel, characterTraits)` 写入到 `positivePromptTemplate`（默认 `'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece'`，{traits} 放在 portrait 之后确保角色特征优先）
- 替换使用函数形式 `replace(re, () => traits.join(', '))` 避免 `$` 特殊字符干扰
- 旧配置兼容：若用户 `positivePromptTemplate` 不含 `{traits}` 占位符，特征 tag 会在 prompt 开头追加（不破坏旧模板）

#### AI 特征生成流程（Task 12 + Task 13）

```
1. 用户在 AssetManagerModal「角色特征」Tab 点击「AI 生成特征」按钮
   └─ CharacterTraitTabContent.handleAIGenerateTraits (异步)
        ├─ 校验 characterCardId 非空
        ├─ 校验至少一个描述字段（characterDescription/personality/scenario）非空
        ├─ 若 traits.length > 0 弹 Modal.confirm 二次确认（已有特征将被覆盖）
        │   └─ 【重点标记 - antd v6 兼容性】okType:'warning' 替换为 okButtonProps:{danger:true}
        ├─ setAiGenerating(true)
        └─ window.electronAPI.ai.generateCharacterTraits IPC

2. 主进程 characterTraitAIHandlers
   └─> characterTraitAIService.generateCharacterTraits(params)
        ├─ 入参校验 + 读取 aiConfigProvider 配置
        ├─ 校验 baseUrl/apiKey/modelName（缺失返回「AI 引擎未配置」）
        ├─ 读取激活引擎 temperature/max_tokens
        │   └─ 【项目最高优先级规则】任一字段缺失返回 null → 友好错误
        │      （禁止使用 AI 参数默认值，与 WritingStyleLearningService 一致）
        ├─ 构建 system + user 消息（CHARACTER_TRAIT_SYSTEM_PROMPT）
        ├─ 非流式 POST /v1/chat/completions
        └─ 解析 data.choices[0].message.content
            └─ 按逗号/换行/分号切分 → trim → 过滤空串 →
               移除前缀编号 → 移除尾部标点 → Set 去重保留顺序

3. 渲染进程收到 { success, traits?, error? }
   ├─ success + traits.length > 0
   │   └─ characterTraitStore.setTraits(traits)  ← 仅本地批量替换
   │      └─ 防御性处理：非数组转空 + trim + 过滤空串 + Set 去重
   │   └─ message.success('AI 生成了 N 个特征，请确认后点击「保存」')
   ├─ success + traits.length === 0
   │   └─ message.info('AI 未能从角色描述中提取到视觉特征，请手动添加')
   └─ failure → message.error(result.error)
   └─ finally setAiGenerating(false)

4. 用户在编辑区逐条 review / 编辑 / 删除 / 追加
   └─ 点击「保存」按钮 → characterTraitStore.saveTraits(characterCardId, traits)
       └─ 乐观更新 + 失败回滚 → characterTraitService.saveTraits → traits.json
```

- **设计要点**：`setTraits` 仅修改本地 state，**不调 IPC 持久化**。AI 返回的特征可能含冗余/低质量 tag，用户必须 review/编辑后再点击「保存」触发 `saveTraits` 落盘。避免直接覆盖持久化数据丢失用户已有特征

#### 完整文件清单（Task 1-15 全量）

**新增文件**：

| 文件 | Task | 职责 |
|------|------|------|
| `src/main/services/characterTraitService.ts` | 1 | 角色特征持久化服务（loadTraits/saveTraits/clearTraits） |
| `src/main/services/assetService.ts` | 6 | 素材管理服务（listAssets/saveAsset/deleteAsset/getAssetPath） |
| `src/main/services/characterTraitAIService.ts` | 12 | AI 辅助特征生成服务，复用 aiConfigProvider |
| `src/main/ipc/handlers/characterTraitHandlers.ts` | 2 | IPC：`character-trait:list` / `save` / `clear` |
| `src/main/ipc/handlers/assetHandlers.ts` | 7 | IPC：`asset:list` / `save` / `delete` / `getImagePath` |
| `src/main/ipc/handlers/characterTraitAIHandlers.ts` | 12 | IPC：`ai:generateCharacterTraits` |
| `src/renderer/stores/characterTraitStore.ts` | 3 + 13 | Zustand store（loadTraits/saveTraits/addTrait/removeTrait/updateTrait/setTraits/clear） |
| `src/renderer/stores/assetStore.ts` | 8 | Zustand store 按 assetType 分组，imageCache 仅存 data URL |
| `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx` | 9 | 5 Tab 弹窗：表情/角色立绘/一般图像/三视图/角色特征 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 10 | 5 mode 生成弹窗：batch-expression/single-expression/illustration/general/three-view |

**修改文件**：

| 文件 | Task | 改动 |
|------|------|------|
| `src/main/services/sdGenerationService.ts` | 4 | `SDGenerationOptions.characterTraits?: string[]` + `{traits}` 占位符替换 + ADetailer `ad_prompt` 同步注入 |
| `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | 5 | `buildExpressionGenerationPrompt` 接收 `characterTraits` 参数 |
| `src/shared/settings.ts` | 5 | `defaultSetting.sdWebui.positivePromptTemplate` 默认含 `{traits}` |
| `src/renderer/types/setting.ts` | 5 | `SDWebuiConfig.positivePromptTemplate` 字段类型 |
| `src/renderer/components/Character/CharacterEditModal.tsx` | 11 | Tab 重命名「表情管理」→「素材管理」，`ExpressionManagerModal` → `AssetManagerModal`，新增 characterDescription/personality/scenario props |
| `src/renderer/components/Character/CharacterDialogueChat/ChatHeader.tsx` | 11 | Tooltip「表情管理」→「素材管理」 |
| `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` | 11 | `ExpressionManagerModal` → `AssetManagerModal`，新增 characterDescription/personality/scenario props |
| `src/main/preload.ts` | 14 | 暴露 `characterTrait.*` / `asset.*` / `ai.generateCharacterTraits` |
| `src/renderer/types/electron.d.ts` | 14 | 新增 `characterTrait` / `asset` / `ai.generateCharacterTraits` 类型声明 |
| `src/main/ipc/index.ts` | 14 | 注册 `registerCharacterTraitHandlers` / `registerAssetHandlers` / `registerCharacterTraitAIHandlers` |

#### 重点标记汇总

- **【重点标记 - BREAKING UI 变更】** `ExpressionManagerModal` → `AssetManagerModal`，用户可见的「表情管理」Tab/Tooltip 统一更名为「素材管理」。**表情数据层（`expressionService` / `expressionStore`）完全不变，仅 UI 容器层重构，零数据迁移**；内部命名（state/prop 名）保留 `expressionModalOpen` / `onOpenExpressionManager` 等原名以最小化改动面
- **【重点标记 - 特征携带机制是角色一致性的核心保障】** `SDGenerationOptions.characterTraits` → `{traits}` 占位符替换 → ADetailer `ad_prompt` 同步注入 → 所有素材生成（表情/立绘/一般图像/三视图）自动携带角色特征
- **【重点标记 - CSP 兼容】** `assetStore.imageCache` 仅存 data URL（参照 `expressionStore` 修复模式），不存磁盘绝对路径，避免渲染进程 `<img src="C:/...">` 被 CSP `img-src 'self' data: blob:` 拦截导致裂图
- **【重点标记 - antd v6 兼容性修复】** `Modal.confirm` 的 `okType: 'warning'` 在 antd v6 中被移除（v5 已 deprecated），改用 `okButtonProps: { danger: true }`
- **【重点标记 - 三视图槽位约束】** `three-view` 类型仅允许 `front` / `side` / `back` 三个 `assetId`
- **【重点标记 - setTraits 本地批量替换】** 为 Task 13 AI 特征生成新增的 local-only action，AI 返回后用户可编辑后再 `saveTraits` 持久化，避免直接覆盖持久化数据

### 7.3.4 自然语言驱动 SD 模型集成（Spec: integrate-nl-driven-sd-models）

> 增量更新（2026-07-28）：在原 SDXL img2img + ADetailer 表情生成管线（§7.3.2）基础上，新增对自然语言（NL）驱动 SD 模型的多模型分支支持，覆盖 qwen-image / qwen-image-edit / flux2 三种新模型类型。所有模型均使用 sd-webui-forge-neo 的标准 `/sdapi/v1/txt2img` 与 `/sdapi/v1/img2img` 端点，无需自定义路由。

#### 概述

原表情/素材生成管线仅支持 SDXL 模型（img2img + ADetailer 面部修复），对 NL 驱动模型（qwen-image / qwen-image-edit / flux2）无法适配。本次集成引入模型类型系统，使 `generateExpression()` 能根据模型类型自动选择正确的端点（txt2img / img2img）、参数预设（denoising / sampler / ADetailer 开关）与提示词风格（tag / 自然语言），一套代码支撑四种模型类型。

#### 模型类型系统

`sdGenerationService.ts` 新增以下类型与函数：

```typescript
export type SDModelType = 'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2';

export interface SDModelTypePreset {
  endpoint: 'img2img' | 'txt2img';
  denoising: number;
  steps: number;
  cfgScale: number;
  sampler: string;
  adetailerEnabled: boolean;
  width: number;
  height: number;
}

export const MODEL_TYPE_PRESETS: Record<SDModelType, SDModelTypePreset>;

export function detectModelType(modelName: string): SDModelType;
```

**自动检测规则**（`detectModelType`，根据模型文件名小写匹配）：

| 匹配条件 | 检测结果 | 说明 |
|---------|---------|------|
| 文件名含 `qwen` 且含 `edit` | `qwen-image-edit` | 编辑模型，img2img + 视觉编码 |
| 文件名含 `qwen` | `qwen-image` | 纯文生图模型 |
| 文件名含 `klein` 或 `flux.2` | `flux2` | Flux2 模型 |
| 其他 | `sdxl` | 默认兜底 |

`SDGenerationOptions` 接口新增 `modelType?: SDModelType` 字段，供调用方显式指定或由上游自动检测后传入。

#### txt2img 端点集成

新增 `generateTxt2Img(params: SDTxt2ImgParams): Promise<SDGenerationResult>` 方法：

- **端点**：POST `${endpoint}/sdapi/v1/txt2img`
- **请求体**：`prompt` / `negative_prompt` / `steps` / `cfg_scale` / `width` / `height` / `sampler_name` / `batch_size: 1` / `n_iter: 1`
- **不包含**：`init_images` / `denoising_strength` / `alwayson_scripts`（txt2img 无需基底图片与 ADetailer）
- **超时**：120 秒
- **返回**：`{ success, imageBase64?, error?, warning? }`

`SDTxt2ImgParams` 接口已导出，供 IPC 层与类型声明引用。`SDGenerationResult` 接口新增 `warning?: string` 字段，生成成功时可附带参数推荐提示。

#### 多模型分支生成

`generateExpression()` 方法内部按 `options.modelType`（默认 `'sdxl'`）分流：

```
generateExpression(params)
  │
  ├─ {traits} 占位符替换（所有模型类型都执行，保证角色特征携带）
  │
  ├─ modelType === 'qwen-image'  ──> generateTxt2Img()  [txt2img，无需基底图片]
  ├─ modelType === 'flux2' && 无基底图片 ──> generateTxt2Img()
  │
  └─ modelType === 'sdxl' / 'qwen-image-edit' / 'flux2(有基底)'
       └─> img2img 路径
            ├─ sdxl：ADetailer 开启（面部修复）
            ├─ qwen-image-edit：ADetailer 关闭（NL 编辑模型内置一致性能力）
            └─ flux2：ADetailer 关闭
```

**关键设计**：
- 特征携带机制（`{traits}` 占位符替换）在分流**之前**执行，保证所有模型类型都携带角色特征
- qwen-image-edit 走 img2img 但**跳过 ADetailer**——NL 编辑模型内置视觉编码一致性能力，面部修复反而干扰编辑效果
- flux2 有基底图片时走 img2img，无基底图片时回退到 txt2img

#### 【重点标记 - qwen-image-edit 工作流】

qwen-image-edit 是表情生成的**推荐模型**，凭借视觉编码（vision encoding）能力在 img2img 编辑时保持角色面部特征一致性（identity consistency）。

| 特性 | 说明 |
|------|------|
| 检测方式 | 文件名含 "qwen" + "edit" |
| 端点 | img2img（`/sdapi/v1/img2img`） |
| denoising | ≥ 0.9（推荐 0.95），过低导致编辑效果不明显 |
| ADetailer | **关闭**（NL 编辑模型内置一致性能力） |
| 视觉编码 | 自动启用，保持角色面部/发型/服饰一致性 |
| 提示词风格 | 编辑指令风格（见下方 NL 提示词构建） |
| 宽高 | 原图比例（保持基底图片宽高比） |

**与 sdxl 的对比**：sdxl img2img 依赖 ADetailer 面部修复 + 高 denoising 容易导致角色特征漂移；qwen-image 纯文生图无法保留具体角色外貌。qwen-image-edit 在两者间取得平衡——既保留角色外貌（img2img），又能精确编辑表情（视觉编码 + 编辑指令）。

#### NL 提示词构建

`PromptBuilder.ts` 新增 NL 提示词构建体系，与原 `EMOTION_PROMPT_MAP` / `buildExpressionGenerationPrompt`（SDXL tag 风格）对称：

**`EMOTION_NL_PROMPT_MAP: Record<string, string>`**：30 种预置情绪 → 自然语言描述映射，键名严格对齐 `EMOTION_PRESETS`。示例：
- `joy` → `'a joyful expression with a bright smile and sparkling eyes'`
- `anger` → `'an angry expression with furrowed brows and an intense glare'`
- `default` → `'a calm and neutral expression with a serene face'`

**`buildNLExpressionPrompt(emotionKey, options?): { prompt, negativePrompt }`**：

组合规则：
1. **情绪 NL 描述解析**：预置情绪从 `EMOTION_NL_PROMPT_MAP` 取值；自定义情绪以 `customLabel` 兜底（`${customLabel.toLowerCase()} expression`）
2. **特征描述**：`{traits}` 替换为 `with {trait1, trait2, ...}` 格式的自然语言特征描述
3. **模板替换**：默认模板 `"A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed."`，`{traits}` 与 `{emotion}` 依次替换
4. **【重点标记 - qwen-image-edit 编辑指令风格】** 当 `modelType === 'qwen-image-edit'` 时，提示词重构为编辑指令风格：`"Change the character's expression to {emotion}. Maintain the character's identity, facial features, hairstyle, and clothing."`——因为 qwen-image-edit 是 img2img 编辑模型，需要明确的编辑指令而非描述性提示词

#### 参数映射表

| 参数 | sdxl | qwen-image | qwen-image-edit | flux2 |
|------|------|------------|-----------------|-------|
| 端点 | img2img | txt2img | img2img | txt2img/img2img |
| denoising | 0.55 | N/A | ≥0.95 | 0.8 |
| steps | 28 | 28 | 28 | 28 |
| cfg_scale | 7 | 7 | 7 | 7 |
| sampler | DPM++ 2M Karras | Euler | Euler | Euler |
| ADetailer | 开启 | 关闭 | 关闭 | 关闭 |
| 宽高 | 512×512 | 1024×1024 | 原图比例 | 1024×1024 |

#### API 调用约定（来自 sd-webui-forge-neo）

所有模型使用标准 `/sdapi/v1/txt2img` 和 `/sdapi/v1/img2img` 端点，**无自定义路由**：

| 模型 | 端点 | 文本编码器 | 提示词风格 | 特殊行为 |
|------|------|-----------|-----------|---------|
| sdxl | img2img | CLIP | tag 风格 | ADetailer 面部修复 |
| qwen-image | txt2img | Qwen 2.5 VL 7B | 自然语言 | 纯文生图，无基底图片 |
| qwen-image-edit | img2img | Qwen 2.5 VL 7B | 编辑指令 | 视觉编码保持角色一致性，denoising ≥ 0.9 |
| flux2 | txt2img/img2img | Qwen3 | 自然语言 | 自动选择 "Flux2" scheduler |

#### IPC 通道（新增 `sd:generateTxt2Img`）

在原 5 个 `sd:*` 通道（§7.3.2）基础上新增 1 个通道：

| 通道 | 调用签名 | 返回值 | 说明 |
|------|---------|--------|------|
| `sd:generateTxt2Img` | `generateTxt2Img({ endpoint, prompt, negativePrompt?, options? })` | `{ success, imageBase64?, error?, warning? }` | 文生图，NL 驱动模型专用，不走 img2img 流程 |

- Preload 暴露 `window.electronAPI.sd.generateTxt2Img(args)`
- `src/renderer/types/electron.d.ts` 补全类型声明
- `ExpressionGenerateModal` 仍统一调用 `sd:generateExpression`（内部按 modelType 分流到 txt2img），`sd:generateTxt2Img` 供 `AssetGenerateModal` 等其他场景直接使用

#### 设置 UI 扩展

`SDWebuiSettings.tsx` 新增以下配置项（持久化到 `AppSetting.sdWebui`）：

| 配置项 | 字段 | 控件 | 条件渲染 | 说明 |
|--------|------|------|---------|------|
| 模型类型 | `modelType` | `Select`（4 选项） | 始终显示 | 切换时自动填充推荐参数 |
| 自动检测 | — | `Button` | 始终显示 | 根据当前模型名推断 modelType |
| NL 提示词模板 | `nlPromptTemplate` | `TextArea` | `modelType !== 'sdxl'` | 支持 `{traits}` / `{emotion}` 占位符 |
| txt2img 输出宽度 | `txt2imgWidth` | `InputNumber` | `qwen-image / flux2` | 默认 1024 |
| txt2img 输出高度 | `txt2imgHeight` | `InputNumber` | `qwen-image / flux2` | 默认 1024 |
| 去噪警告 | — | `Alert` | `qwen-image-edit && denoising < 0.9` | 提示推荐 denoising ≥ 0.9 |

**条件渲染逻辑**：
- `modelType === 'sdxl'`：显示 ADetailer 面部修复开关 + ADetailer 高级参数折叠面板
- `modelType !== 'sdxl'`：显示 NL 提示词模板 TextArea，隐藏 ADetailer 相关 UI
- `modelType` 为 `qwen-image` 或 `flux2`：显示 txt2img 输出宽高 InputNumber
- `modelType` 为 `qwen-image-edit` 且 `denoisingStrength < 0.9`：显示去噪强度警告 Alert

**Denoising Strength 滑块范围扩展**：从 0.1-0.9 扩展至 0.1-1.0，以支持 qwen-image (1.0) 与 qwen-image-edit (0.95) 的推荐去噪强度。

`SDWebuiConfig` 接口新增 4 个字段：`modelType: SDModelType` / `nlPromptTemplate: string` / `txt2imgWidth: number` / `txt2imgHeight: number`。

#### ExpressionGenerateModal 适配

- **提示词构建器切换**：`buildEmotionPrompt` 按 `sdConfig.modelType` 切换——sdxl 使用 `buildExpressionGenerationPrompt`（tag 风格），NL 模型使用 `buildNLExpressionPrompt`（自然语言风格）
- **`buildSdOptions` 透传**：新增 `modelType` / `txt2imgWidth` / `txt2imgHeight` 字段透传到 IPC options
- **模型类型 Alert**：qwen-image-edit 去噪偏低警告（denoising < 0.9）/ qwen-image 文生图模式提示（不需要基底图片）
- **warning 展示**：`SDGenerationResult.warning` 字段在生成成功时展示为 Alert
- **`DEFAULT_SD_CONFIG` 补全**：新增 `modelType: 'sdxl'` / `nlPromptTemplate` / `txt2imgWidth: 1024` / `txt2imgHeight: 1024` 默认值，避免旧配置无新字段时读取 undefined

#### 关键文件清单

| 文件 | 改动 |
|------|------|
| `src/main/services/sdGenerationService.ts` | `SDModelType` / `detectModelType` / `MODEL_TYPE_PRESETS` / `generateTxt2Img` 方法 / `generateExpression` 模型类型分流 / `SDTxt2ImgParams` 导出 / `SDGenerationResult.warning` 字段 / `SDGenerationOptions.modelType` 字段 |
| `src/main/ipc/handlers/sdGenerationHandlers.ts` | 新增 `sd:generateTxt2Img` 通道 |
| `src/main/preload.ts` | 暴露 `sd.generateTxt2Img(args)` |
| `src/renderer/types/electron.d.ts` | `sd.generateTxt2Img` 类型声明 |
| `src/renderer/types/setting.ts` | `SDWebuiConfig` 新增 `modelType` / `nlPromptTemplate` / `txt2imgWidth` / `txt2imgHeight` 字段 |
| `src/shared/settings.ts` | `defaultSetting.sdWebui` 新增 NL 模型默认值 |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | 模型类型 Select + 自动检测 + 条件渲染（ADetailer/NL 模板/txt2img 宽高/去噪警告）+ Denoising 滑块范围扩展 |
| `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | `EMOTION_NL_PROMPT_MAP`（30 项）+ `buildNLExpressionPrompt` 函数 + `NLExpressionPromptOptions` 接口 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | 提示词构建器切换 + `buildSdOptions` 透传 modelType + 模型类型 Alert + warning 展示 + `DEFAULT_SD_CONFIG` 补全 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | `DEFAULT_SD_CONFIG` 补全 NL 模型字段 |

### 7.3.5 AI 模型能力检测与图片识别（Spec: ai-capability-detection-and-image-recognition）

> 增量更新（2026-07-28）：为 AI 引擎新增视觉（Vision）/ 思维链（Thinking）/ 工具调用（Tool Calling）三项能力自动探测，并在素材生成弹窗中集成基于多模态 LLM 的角色卡图片识别，自动提取视觉特征 tag。

#### 概述

原 AI 引擎配置仅有文本连通性测试，无法获知模型是否支持视觉输入、思维链、工具调用等高级能力。本次新增能力探测系统——连通性测试通过后自动探测三项能力并持久化到引擎配置；UI 以图标徽章直观展示能力状态。同时，当模型支持视觉输入时，在角色特征 Tab 提供「AI 图片识别」功能，通过多模态 LLM 读取角色卡 PNG 自动提取视觉特征 tag，免去用户手动描述。

#### 模型能力检测系统

`AIService.ts` 新增 `ProbeConfig` 接口与四个探测方法：

```typescript
export interface ProbeConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyTransmission: string;
  modelName: string;
}
```

| 方法 | 探测方式 | 判定逻辑 |
|------|----------|----------|
| `probeVisionCapability(config)` | 向 `/v1/chat/completions` 发送含 1×1 透明 PNG 的多模态请求（OpenAI Vision 格式 `content: [{type:'text'...}, {type:'image_url'...}]`） | HTTP 200 → 支持；10s 超时或异常 → 不支持 |
| `probeThinkingCapability(modelName)` | 基于模型名关键词匹配（`thinking` / `reasoning` / `r1` / `o1` / `o3` / `qwq`） | 同步方法，无网络请求 |
| `probeToolCallingCapability(config)` | 发送含 `tools` 参数的最小请求（`tools: [{type:'function', function:{name:'test',...}}]`） | HTTP 200 → 支持；10s 超时或异常 → 不支持 |
| `probeAllCapabilities(config)` | `Promise.all` 并行执行上述三项 | 返回完整 `AIEngineCapabilities` |

`AIEngineCapabilities` 接口（`src/renderer/types/setting.ts`）：

```typescript
export interface AIEngineCapabilities {
  supportsStopArray?: boolean;
  supportsRepPen?: boolean;
  supportsDrySampler?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  supportsToolCalling?: boolean;
}
```

`AIEngineSetting.capabilities?: AIEngineCapabilities` 字段持久化探测结果到 `settings.json`，`src/shared/settings.ts` 中默认引擎的三个新字段默认值为 `false`。

#### 连通性测试扩展

`useAIEngineSettings.ts` 的 `handleTestConnection`（主表单）与 `handleTestEngineConnection`（引擎管理弹窗）在文本测试通过后，自动调用 `ai:probeCapabilities` IPC 探测能力，将结果写入 `engine.capabilities` 并随设置持久化。测试结果 UI 同步展示能力徽章。

#### 能力徽章 UI

`AIEngineSettingsPanel.tsx` 新增 `renderCapabilityBadges(capabilities)` 函数，使用 antd `Tag` + antd Icons 渲染四个能力徽章：

| 徽章 | 图标 | 颜色 | 显示条件 |
|------|------|------|----------|
| 文本 | `EditOutlined` | 蓝色 | 始终显示 |
| 视觉 | `EyeOutlined` | 绿色 | `supportsVision === true` |
| 思维链 | `BulbOutlined` | 紫色 | `supportsThinking === true` |
| 工具调用 | `ToolOutlined` | 橙色 | `supportsToolCalling === true` |

徽章展示于三处：引擎下拉选项（`Select.Option`）、引擎管理弹窗表格列、连通性测试结果区域。

#### ChatMessage 多模态扩展

`AIService.ts` 的 `ChatMessage` 接口 `content` 字段从 `string` 扩展为联合类型，兼容 OpenAI Vision 多模态格式：

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
}
```

`characterTraitAIService` 导入并复用该类型构建多模态请求。原文本消息（`content: string`）完全向后兼容。

#### 图片识别特征提取工作流

`characterTraitAIService.recognizeImageTraits(characterCardPath, characterName?)` 方法实现以下流程：

1. 读取 AI 引擎配置（baseUrl / apiKey / modelName / systemPrompt），缺失时返回「AI 引擎未配置」错误
2. `readFileSync` 读取角色卡 PNG → base64 编码为 `data:image/png;base64,...` data URI
3. 注入 `IMAGE_TRAIT_SYSTEM_PROMPT`（与 `generateCharacterTraits` 的 system prompt 合并策略一致）
4. 构建多模态 messages：`[{role:'system', content: systemContent}, {role:'user', content:[{type:'text', text:...}, {type:'image_url', image_url:{url: dataUri}}]}]`
5. 非流式 POST `/v1/chat/completions`（`stream: false`）
6. 解析响应 `data.choices[0].message.content`，按逗号分割为英文 tag 数组
7. 返回 `{ success: true, traits: string[] }` 或 `{ success: false, error: string }`

> 前置条件：当前 AI 引擎 `supportsVision === true`（由前端判断，主进程不重复检测）。

#### AssetGenerateModal 集成

`AssetGenerateModal.tsx` 角色特征 Tab 集成图片识别：

- 从 `settingStore` 读取当前激活引擎的 `capabilities.supportsVision`
- `supportsVision === true` 时显示「AI 图片识别」按钮（`EyeOutlined` 图标），点击调用 `ai.recognizeImageTraits`
- loading 状态禁用按钮（`loading={imageRecognizing}`）
- 成功后将返回 tag 追加到现有 `characterTraits`（大小写不敏感去重）
- `supportsVision !== true` 时显示「图片识别不可用」Tooltip

#### IPC 通道

| 通道 | Handler 文件 | 调用方法 |
|------|-------------|----------|
| `ai:probeCapabilities` | `aiHandlers.ts` | `aiService.probeAllCapabilities(config)` |
| `ai:recognizeImageTraits` | `characterTraitAIHandlers.ts` | `characterTraitAIService.recognizeImageTraits(args)` |

Preload 暴露：`window.electronAPI.ai.probeCapabilities(args)` / `window.electronAPI.ai.recognizeImageTraits(args)`。

#### 关键文件清单

| 文件 | 改动 |
|------|------|
| `src/main/services/AIService.ts` | `ChatMessage` 多模态扩展 + `ProbeConfig` 接口 + `probeVisionCapability` / `probeThinkingCapability` / `probeToolCallingCapability` / `probeAllCapabilities` 四个方法 |
| `src/main/services/characterTraitAIService.ts` | `recognizeImageTraits` 方法 + `IMAGE_TRAIT_SYSTEM_PROMPT` 常量 |
| `src/main/ipc/handlers/aiHandlers.ts` | 新增 `ai:probeCapabilities` 通道 |
| `src/main/ipc/handlers/characterTraitAIHandlers.ts` | 新增 `ai:recognizeImageTraits` 通道 |
| `src/main/preload.ts` | 暴露 `ai.probeCapabilities` / `ai.recognizeImageTraits` |
| `src/renderer/types/electron.d.ts` | `ai.probeCapabilities` / `ai.recognizeImageTraits` 类型声明 + `AIEngineCapabilities` 导入 |
| `src/renderer/types/setting.ts` | `AIEngineCapabilities` 接口扩展三字段 + `AIEngineSetting.capabilities` 字段 |
| `src/shared/settings.ts` | 默认引擎 `capabilities` 三字段默认值 `false` |
| `src/renderer/components/Settings/AIEngineSettingsPanel.tsx` | `renderCapabilityBadges` 函数 + 引擎下拉/管理弹窗/测试结果三处展示 |
| `src/renderer/components/Settings/hooks/useAIEngineSettings.ts` | 连通性测试通过后调用 `ai:probeCapabilities` 探测能力并持久化 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 图片识别按钮 + `supportsVision` 判断 + 去重追加 |
| `src/renderer/components/Common/ChatEngine/ChatEngine.types.ts` | `EngineCapabilities` 接口扩展 `supportsVision` / `supportsThinking` / `supportsToolCalling` |

### 7.3.6 AIService 多模态兼容性修复与全局能力徽章（2026-07-28）

本节记录 `ChatMessage` 多模态扩展（§7.3.5 / Task 6）落地后，针对全项目 AI 调用链路的兼容性加固与可视化增强。

#### enrichSystemPrompt 多模态兼容性修复

`AIService.enrichSystemPrompt(messages, engineSystemPrompt)` 在拼接引擎级 system prompt 时，原逻辑无条件使用 `'+'` 拼接 `msg.content`。当 `ChatMessage.content` 为多模态数组（`Array<{type:'text'|'image_url', ...}>`）时，拼接会产生 `"[object Object]"` 字符串，导致 system prompt 静默损坏。

**修复方案**：在拼接前增加类型守卫 `typeof msg.content === 'string'`：
- 字符串 content：走原拼接逻辑（`engineSystemPrompt.trim() + '\n\n' + msg.content`），保持向后兼容
- 数组 content：原样保留不变，引擎 system prompt 的注入由调用方在构建 messages 时自行处理

该守卫为防御性编程——目前所有调用方（GameNarrativeService 等）的 system message 始终为字符串，但防止未来多模态 system message 传入时静默出错。

#### 全局模型能力徽章（Header Logo 区）

`src/renderer/components/Layout/Header.tsx` 在应用 Logo 区域新增当前激活 AI 引擎的能力标识组合，让用户在任意页面都能一眼看到当前引擎的能力组合，无需进入设置页。

- **数据来源**：`useSettingStore()` → `setting.activeEngineId` → `setting.aiEngines.find(...)` → `activeEngine.capabilities`
- **四种图标**：
  - `EditOutlined`（铅笔，灰色）— 文本生成能力，作为基础能力常驻显示
  - `EyeOutlined`（眼睛，绿色 `#52c41a`）— 视觉/图片识别，`supportsVision=true` 时显示
  - `BulbOutlined`（灯泡，紫色 `#722ed1`）— 思维链/推理，`supportsThinking=true` 时显示
  - `ToolOutlined`（工具，橙色 `#fa8c16`）— 工具调用，`supportsToolCalling=true` 时显示
- **未检测行为**：`capabilities` 为 `undefined`（用户尚未测试连通性）时仅显示编辑图标，鼠标悬停 Tooltip 提示「请先测试连通性以检测模型能力」
- **与设置页的关系**：与 `AIEngineSettingsPanel` 的 `renderCapabilityBadges`（§7.3.5 / Task 5）形成「全局概览 + 详细管理」的双层能力可视化

#### ChatEngine 请求构建能力感知

`src/renderer/components/Common/ChatEngine/ChatEngine.ts` 在构建请求体时新增对 `supportsThinking` / `supportsToolCalling` 的能力守卫，避免向不支持的模型注入参数导致 4xx 错误：

- **思维链守卫**：`enable_chain_of_thought` 开关仅在 `config.capabilities?.supportsThinking === true` 时生效。若开关为 true 但模型不支持思维链，则不注入思维链参数，降级为纯文本聊天
- **工具调用守卫**：`use_function_calling` 开关仅在 `config.capabilities?.supportsToolCalling === true` 时生效。若开关为 true 但模型不支持工具调用，则禁用工具调用，降级为纯文本聊天

`ChatEngine.types.ts` 的 `EngineCapabilities` 接口已扩展 `supportsThinking` / `supportsToolCalling` 字段，`getDefaultEngineCapabilities` 同步返回三字段默认值 `false`，`buildSamplingExtras` 接收 `capabilities` 参数（优先于 `config.capabilities`）。

#### AI 调用点多模态兼容性审计

对全项目 15+ 处 AI 请求调用点进行系统性审计，确认所有服务的消息构建均使用字符串 content，不受 `AIService.ts` 的 `ChatMessage` 联合类型扩展影响：

- **审计结论**：仅 `characterTraitAIService`（§7.3.5 / Task 12）使用多模态数组 content（text + image_url），其余服务均使用内联 `{ role, content: string }` 对象，不导入 `ChatMessage` 联合类型，类型安全
- **已审计调用点**：`GameNarrativeService` / `DescriptionPolisher` / `OutlineGenerator` / `WritingStyleLearningService` / `characterTraitAIService`（多模态）/ `useCreativeAI`（Creative hook）/ `WorldBookEditor` / `CharacterManager`（翻译/生成/润色）/ `MarkdownAITools` / `CharacterDialogueChat.hooks` 等
- **审计注释**：两个渲染进程 Creative 模块文件已补充中文兼容性审计注释：
  - `src/renderer/components/Creative/hooks/useCreativeAI.ts`（`generate` / `optimize` 的 messages 构建处）
  - `src/renderer/components/Creative/WorldBookEditor.tsx`（`handleGenerate` 的 messages 构建处）

#### 关键文件清单

| 文件 | 改动 |
|------|------|
| `src/main/services/AIService.ts` | `enrichSystemPrompt` 增加类型守卫 `typeof msg.content === 'string'` |
| `src/renderer/components/Layout/Header.tsx` | Logo 区能力徽章（4 图标）+ `useSettingStore` 引入 |
| `src/renderer/components/Common/ChatEngine/ChatEngine.ts` | `supportsThinking` / `supportsToolCalling` 能力守卫 |
| `src/renderer/components/Common/ChatEngine/ChatEngine.types.ts` | `EngineCapabilities` 扩展三字段 + `getDefaultEngineCapabilities` 默认值 |
| `src/renderer/components/Creative/hooks/useCreativeAI.ts` | 多模态兼容性审计注释 |
| `src/renderer/components/Creative/WorldBookEditor.tsx` | 多模态兼容性审计注释 |

### 7.3.7 LoRA 模型选择（Spec: add-lora-model-selection，2026-07-28）

> 增量更新（2026-07-28）：在 SD 表情/素材生成流程（§7.3.2 / §7.3.3）中新增 LoRA 模型选择能力。用户可在生成前从 SD WebUI 拉取可用 LoRA 列表，多选并调整权重（0-1，步进 0.05，默认 0.7），生成时自动注入 `<lora:name:weight>` 标签到 prompt 前部。LoRA 选择持久化到 `AppSetting.sdWebui.selectedLoras`，跨会话保留。

#### 数据流

```
用户点击 LoRA 入口 Tag
  └─> LoraSelectModal 打开
       └─> window.electronAPI.lora.list(endpoint)
            └─> IPC lora:list
                 └─> loraService.fetchLoraList(endpoint)
                      ├─> GET {endpoint}/sdapi/v1/loras        ← Forge Neo API
                      ├─> 构建预览图 URL（/sd_extra_networks/thumb?filename=...）
                      ├─> 读取本地 JSON 元数据文件（description / activation text / ...）
                      └─> 从 path 提取分类（子目录名）
      ←─ 返回 LoraModel[]（含 name / previewUrl / description / category 等 10 字段）

用户多选 LoRA + 调整权重 → 点击确认
  └─> onConfirm(localSelected) → 写入 sdConfig.selectedLoras
       └─> buildSdOptions() 透传 selectedLoras 到 options
            └─> sdGenerationService.generateExpression()
                 ├─> 替换 {traits} 占位符（§7.3.3 特征携带机制）
                 ├─> 将 selectedLoras 转为 <lora:name:weight> 标签注入 prompt 前部
                 └─> 模型类型分流（sdxl img2img / qwen-image txt2img / ...）
```

#### LoRA 服务层（loraService.ts）

`src/main/services/loraService.ts` 为单例服务（`export const loraService = new LoraService()`），通过 Forge Neo 的 `/sdapi/v1/loras` 端点获取可用 LoRA 列表。

- **fetchLoraList(endpoint)**：返回 `{ success, loras?: LoraModel[], error? }`
  - GET `{endpoint}/sdapi/v1/loras`，10s 超时（`AbortSignal.timeout`）
  - 为每个 LoRA 构建预览图 URL：`{endpoint}/sd_extra_networks/thumb?filename={encodeURIComponent(path)}`
  - 读取本地 JSON 元数据文件（`{path_without_extension}.json`），解析 `description` / `activation text` / `preferred weight` / `sd version` / `notes` 五个字段（缺失返回空字符串/0）
  - 从 path 提取分类（子目录名，如 `models/Lora/画风/xxx.safetensors` → `画风`）
  - 按名称排序（`localeCompare('zh')`）

#### LoraModel 接口

| 字段 | 类型 | 来源 |
|------|------|------|
| `name` | string | API `name`（文件名不含扩展名） |
| `alias` | string | API `alias`（无则 fallback 到 name） |
| `path` | string | API `path`（LoRA 文件绝对路径） |
| `previewUrl` | string | 构建的 thumb 端点 URL |
| `description` | string | JSON 元数据 `description` |
| `activationText` | string | JSON 元数据 `activation text` |
| `preferredWeight` | number | JSON 元数据 `preferred weight`（0 表示无推荐） |
| `sdVersion` | string | JSON 元数据 `sd version` |
| `notes` | string | JSON 元数据 `notes` |
| `category` | string | 从 path 子目录名提取 |

#### IPC 通道

| 通道 | Handler | Preload | 说明 |
|------|---------|---------|------|
| `lora:list` | `loraHandlers.ts` → `loraService.fetchLoraList` | `window.electronAPI.lora.list(endpoint)` | 获取 LoRA 列表，返回 `{ success, loras?, error? }` |

`registerLoraHandlers()` 在 `setupIpcHandlers()` 中调用（`src/main/ipc/index.ts`）。

#### LoraSelectModal 组件

`src/renderer/components/Character/CharacterDialogueChat/LoraSelectModal.tsx` 为 LoRA 模型选择弹窗。

- **Props**：`{ open, endpoint, selectedLoras, onConfirm, onCancel }`
- **UI 组成**：
  - 顶部搜索框（前端不区分大小写过滤）+ 分类筛选 Select（从 category 去重，含「全部」选项）
  - 已选区域：Tag + 权重 Slider Popover（0-1，步进 0.05）+ 移除按钮
  - 主体网格布局（`grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))`），每个卡片含预览图（`loading="lazy"` 懒加载）+ 模型名
  - 悬停 Tooltip 显示 JSON 元数据（description / activationText / sdVersion / notes），无元数据显示「无额外说明」
  - 缺失预览图显示 `PictureOutlined` 占位图标
- **性能优化**：
  - 预览图懒加载（`<img loading="lazy">`）
  - `loraCacheRef` 缓存列表：endpoint 未变化时不重复请求，Modal 关闭再打开复用缓存
  - `useMemo` 计算分类选项与过滤后列表
- **权重默认值**：`DEFAULT_WEIGHT = 0.7`（新增选中时使用）

#### 生成流程集成

`sdGenerationService.SDGenerationOptions` 新增 `selectedLoras?: Array<{ name: string; weight: number }>` 字段。`generateExpression` 方法在 `{traits}` 占位符替换与清理之后、模型类型分流之前，将 `selectedLoras` 转为 `<lora:name:weight>` 标签并注入到 prompt 前部：

```
原始 prompt: portrait, white fur, dog girl, looking at viewer, ...
注入后:      <lora:character_style:0.8> <lora:detail_enhancer:0.6> portrait, white fur, dog girl, looking at viewer, ...
```

- Forge Neo 的 prompt parser 自动解析 `<lora:...>` 标签并加载对应 LoRA 文件
- 空数组/undefined 时不注入，行为不变
- 注入位置在模型类型分流之前，确保 txt2img 与 img2img 路径均生效

`ExpressionGenerateModal` 与 `AssetGenerateModal` 均新增：
- LoRA 入口 Tag（青色 `color="cyan"`，显示已选数量，点击打开 Modal）
- `buildSdOptions()` 透传 `selectedLoras: sdConfig.selectedLoras`
- `LoraSelectModal` 组件渲染，确认后写入 `sdConfig.selectedLoras`

#### 持久化

`SDWebuiConfig.selectedLoras` 持久化到 `AppSetting.sdWebui.selectedLoras`。`SDWebuiSettings.getFormValues()` 中 `selectedLoras` 不在表单中编辑（由 LoRA 选择 Modal 设置），`form.getFieldsValue(true)` 可能不返回此字段。因此在 `getFormValues` 返回值中显式从 `setting.sdWebui.selectedLoras` 合并，合并顺序：`DEFAULT_SD_WEBUI_CONFIG` → `selectedLoras`（来自 setting）→ `values`（来自表单），确保表单值优先级最高且已持久化的 LoRA 选择不丢失。

#### 关键文件清单

| 文件 | 改动 |
|------|------|
| `src/main/services/loraService.ts` | 新建：LoRA 模型列表获取服务（fetchLoraList + buildLoraModel + readJsonMetadata） |
| `src/main/ipc/handlers/loraHandlers.ts` | 新建：`lora:list` IPC 通道注册 |
| `src/main/ipc/index.ts` | 修改：注册 `registerLoraHandlers()` |
| `src/main/preload.ts` | 修改：暴露 `lora.list(endpoint)` |
| `src/renderer/types/electron.d.ts` | 修改：`lora` 命名空间类型声明 |
| `src/renderer/types/setting.ts` | 修改：`SDWebuiConfig` 新增 `selectedLoras?` 字段 |
| `src/shared/settings.ts` | 修改：默认值 `selectedLoras: []` |
| `src/renderer/components/Settings/SDWebuiSettings.tsx` | 修改：`DEFAULT_SD_WEBUI_CONFIG` 同步 + `getFormValues` 持久化 selectedLoras |
| `src/renderer/components/Character/CharacterDialogueChat/LoraSelectModal.tsx` | 新建：LoRA 选择弹窗组件 |
| `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` | 修改：LoRA 入口 + `buildSdOptions` 透传 + Modal 渲染 |
| `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` | 修改：同上 |
| `src/main/services/sdGenerationService.ts` | 修改：`SDGenerationOptions.selectedLoras` + `<lora:name:weight>` 标签注入逻辑 |

### 7.4 世界书管理 (World Book)
- 世界书及条目的 CRUD
- JSON5 兼容读写 (注释、尾随逗号支持)
- SillyTavern 格式双向兼容 (标准化 → 内部驼峰 | 导出 → SillyTavern 下划线)
- 标签系统 (TagManager — 独立 tags.json)
- AI 批量操作: 一键翻译/润色/生成关键词/智能排序/批量生成条目
- 向量化集成: 条目语义搜索、自动/手动向量化
- 排序: 标题/顺序/拖拽/AI 智能排序
- Markdown 文档导出

### 7.5 用户人设管理 (User Persona)
- 人设 Profile 的 CRUD (JSON 存储)
- 头像上传 (PNG/JPG/WebP/GIF, 复制到人设目录)
- 列表/详情双视图
- Base64 异步头像预览

### 7.6 创意工坊 (Creative)
- Milkdown Crepe WYSIWYG Markdown 编辑器
- AI 工具栏: 扩写/润色/翻译
- 角色卡/世界书编辑器
- 格式导出 (角色卡/世界书)
- AI 智能生成 (模板选择 + 需求输入)

### 7.7 知识库管理 (Knowledge Base)
- 知识条目的 CRUD (分类/标签/来源)
- 文档上传解析: PDF (pdf-parse), Word (mammoth), Excel (xlsx), TXT/MD (原生)
- 自动分块 + 向量化 (单条或批量)
- 树形知识库浏览 (文档→条目懒加载)
- 语义相似性搜索 (余弦距离 + Top K)
- 世界书自动索引入知识库
- 向量化测试面板

### 7.8 记忆插件 (Memory Chat)
- 聊天记录树形展示与搜索
- Excel 模板管理 (多页签)
- AI 智能整理: 从对话中提取结构化数据
- 模板版本历史与恢复

### 7.9 提示词优化 (Prompt Optimizer)
- Prompt 模板管理与优化
- AI 生成/优化/预览 Prompt
- Prompt 历史记录

### 7.10 插件管理 (Plugin)
- SillyTavern 插件的浏览、安装 (Git clone)、卸载
- 插件启用/禁用切换
- 更新检查和描述翻译

### 7.11 设置中心 (Settings)
- 外观: 主题 (亮/暗)、动画开关、紧凑模式、背景图片
- 路径: 6 类数据目录配置 (世界书/角色卡/人设/创意/记忆/插件)
- AI 引擎管理: 多引擎配置 (增删改查)、默认引擎、连通性测试 + 模型能力检测（视觉/思维链/工具调用，§7.3.5）、能力徽章展示
- 向量配置: 嵌入模式/缓存策略/上下文窗口
- 高级: 调试模式、日志级别

### 7.12 向量嵌入与搜索基础设施
- **EmbeddingService**: 统一接口，支持远程 (OpenAI 兼容 API) 和本地 (@xenova/transformers) 双模式
- **VectorStoreService**: 统一入口，管理多个 VecstoreVectorStore 实例
- **VecstoreVectorStore**: WASM 384 维向量存储，余弦相似度搜索，磁盘持久化
- **VectorRegistryService**: 追踪向量来源 (worldbook/knowledge/document/chatVector)，维护注册表一致性
- **VectorCache**: L1 内存 (LRU) + L2 磁盘缓存
- **ContextManager**: 对话上下文检索、相关性排序、压缩、注入
- **DocumentProcessorService**: 文档解析 → 分块 → 向量化 → 入库的完整管线
- **ChatVectorizationService**: 对话消息的向量化和语义搜索

---

## 8. 状态管理 (Zustand)

渲染进程使用 10 个独立的 Zustand Store 管理不同领域的状态:

| Store | 文件 | 职责 | Persist |
|-------|------|------|---------|
| `useUIStore` | `uiStore.ts` | activeTab, theme, sidebarCollapsed, compactMode, animationEnabled | ✅ zustand/persist → localStorage (`ui-storage`) |
| `useSettingStore` | `settingStore.ts` | 全局设置对象，AI 引擎配置，连通性测试，设置导入导出 | ❌ (通过主进程 setting:load/save) |
| `useDataStore` | `dataStore.ts` | 角色卡列表、人设列表、已安装/可用插件、加载状态 | ❌ |
| `useCharacterChatStore` | `characterChatStore.ts` | 角色对话测试数据 (testChats) | ❌ (通过主进程 characterChat:*) |
| `useWorldBookStore` | `worldBookStore.ts` | 世界书列表、当前世界书、标签、入口 CRUD | ❌ |
| `useCreativeStore` | `creativeStore.ts` | 创意工坊数据 | ❌ |
| `useKnowledgeBaseStore` | `knowledgeBaseStore.ts` | 知识条目列表、搜索、向量化、文档上传 | ❌ |
| `useLogStore` | `logStore.ts` | 日志列表 (最多 1000 条)、面板开关 | ✅ zustand/persist (仅 logs 数组) |
| `usePromptOptimizerStore` | `promptOptimizerStore.ts` | 提示词优化器状态 | ❌ |
| `useVectorStore` | `vectorStore.ts` | 向量状态、搜索范围、searchWithScopes | ❌ |

### 8.1 游戏模式 Store（Spec: add-game-mode-framework / Task 6）

游戏模式新增 2 个独立的 Zustand Store，与上述 10 个 store 解耦，仅在游戏模式运行时被激活。

| Store | 文件 | 职责 | Persist |
|-------|------|------|---------|
| `useGameStore` | `gameStore.ts` | 游戏列表、当前游戏元数据、当前存档、剧情日志、表格数据快照、AI 叙事生成状态、流式追踪；模块加载时订阅 4 个 IPC 事件 | ❌ (通过主进程 game:*) |
| `useGameUIStore` | `gameUIStore.ts` | 当前视图 (lobby/detail/main/options/gallery/saves)、面板折叠状态、ANSI 主题、叙事面板滚动位置、对话框显隐 | ❌ |

#### 8.1.1 `useGameStore` 设计

**状态字段**：
- `games: GameIndexEntry[]` —— 游戏列表（来自 `games-index.json`）
- `currentGameId / currentSaveId: string | null` —— 当前选中的游戏 / 存档 ID
- `currentGame: GameMeta | null` —— 当前游戏元数据缓存
- `currentSave: GameSaveData | null` —— 当前存档完整数据
- `narrativeLog: GameNarrativeMessage[]` —— 剧情日志（与 `currentSave.narrativeLog` 同步，便于组件直接订阅）
- `tableData: GameTableData | null` —— 表格数据快照
- `isGenerating / isLoadingGames / isLoadingSave: boolean` —— 加载与生成状态
- `error: string | null` —— 错误信息
- `currentStreamingMessageId: string | null` —— 内部追踪字段，标记当前流式目标消息 ID

**关键 Actions**：
- `loadGames()` → 调用 `window.electronAPI.game.list()` 加载游戏索引
- `selectGame(gameId)` → 调用 `getMeta(gameId)` 加载元数据，设置 `currentGameId` 与 `currentGame`
- `startNewGame(gameId)` → 调用 `createSave({ gameId, saveName: '新游戏_<ts>' })` 创建存档，然后 `loadSave(saveId)`
- `loadSave(saveId)` → 加载存档完整数据 + 表格数据快照，重置流式追踪状态
- `appendNarrativeChunk(chunk)` —— 流式 chunk 处理核心：
  1. 按 `saveId` 过滤（避免多存档并发串扰）
  2. 若已有 `currentStreamingMessageId` 且消息存在于 `narrativeLog`，追加 chunk 文本到该消息的 `content`
  3. 否则创建新的 assistant 消息并记录其 id 到 `currentStreamingMessageId`
- `generateNarrative(request)` —— fire-and-forget 模式：
  1. 用 store 中的当前 game/save 信息填充必填字段（gameId / saveId / gameType）
  2. 重置 `currentStreamingMessageId = null` 与 `isGenerating = true`
  3. 调用 IPC `generateNarrative(request)`，不 await；同步错误通过 `.catch()` 兜底复位 `isGenerating`
- `cancelGeneration()` → 调用 IPC `cancelGeneration(currentSaveId)` 并复位 `isGenerating`
- `applyTableEdits(commands)` → 调用 IPC `applyTableEdits` 后刷新本地 `tableData`
- `saveGame()` → 调用 IPC `save`，将当前 `narrativeLog` 写回存档

**事件订阅**：模块加载时通过 `setupGameEventListeners()` 订阅 4 个 IPC 事件，将事件路由到 store action：
- `onNarrativeChunk` → `appendNarrativeChunk(chunk)`
- `onNarrativeComplete` → `_handleNarrativeComplete(data)`：用 `fullText` 覆盖流式累积内容（authoritative）并触发 `saveGame()`
- `onNarrativeError` → `_handleNarrativeError(data)`：复位 `isGenerating` 并设置 `error`
- `onTableUpdated` → `_handleTableUpdated(data)`：拉取最新表格数据

订阅前检查 `typeof window !== 'undefined' && window.electronAPI?.game`，在测试环境（vitest `environment: 'node'`）下安全跳过。

#### 8.1.2 `useGameUIStore` 设计

**状态字段**：
- `currentView: GameView` —— 当前视图，类型为局部定义的 `'lobby' | 'detail' | 'main' | 'options' | 'gallery' | 'saves'`（与 `game.types.ts` 中的 `GameView` 枚举不同，额外包含 3 个对话框视图）
- `previousView: GameView | null` —— 上一级视图，单层历史栈
- `collapsedPanels: Record<string, boolean>` —— 面板折叠状态（key 为 panelKey）
- `ansiTheme: 'default' | 'dark' | 'light'` —— ANSI 配色主题
- `narrativeScrollPosition: number` —— 左侧叙事面板滚动位置
- `detailGameId: string | null` —— 详情页当前查看的 game ID
- `showSaveDialog / showOptionsDialog / showGalleryDialog: boolean` —— 3 个对话框显隐

**关键 Actions**：
- `setCurrentView(view)` → 设置 `currentView` 并将旧值推入 `previousView`
- `goBack()` → 返回 `previousView`（若为 null 则回退到 `'lobby'`），返回后清空 `previousView`（单层历史栈，不支持多级回溯）
- `togglePanel(panelKey)` / `setPanelCollapsed(panelKey, collapsed)` —— 面板折叠状态管理
- `setAnsiTheme(theme)` / `setNarrativeScrollPosition(pos)` / `setShow*Dialog(show)` —— 各项 UI 偏好
- `resetUI()` —— 重置到初始状态（不持久化，每次进入游戏模式从默认值开始）

#### 8.1.3 测试策略

- **`gameStore.test.ts`**（46 个测试用例）：使用 `vi.hoisted()` 在 `import { useGameStore }` 之前设置 `globalThis.window.electronAPI.game` 的 mock（包含 24 个方法的 mock 与 4 个 `on*` 监听器回调捕获）；测试覆盖 loadGames / selectGame / startNewGame / loadSave / saveGame / appendNarrativeChunk / generateNarrative / cancelGeneration / applyTableEdits / `_handle*` 事件处理 / 模块加载事件订阅 / getters 等关键场景
- **`gameUIStore.test.ts`**（27 个测试用例）：覆盖初始状态 / setCurrentView / goBack / togglePanel / setPanelCollapsed / setAnsiTheme / setDetailGameId / setNarrativeScrollPosition / setShow*Dialog / resetUI 等

**【重点标记 - mock window.electronAPI 的时机】**：由于 store 在模块加载时即订阅 IPC 事件，测试必须在 `import { useGameStore }` 之前设置 `globalThis.window.electronAPI.game`。ESM 不允许在 import 之间穿插赋值语句，因此采用 `vi.hoisted(() => { (globalThis as any).window = {...}; return { mockGameApi, capturedListeners }; })` 模式——`vi.hoisted` 的回调会在所有 import 之前执行。后续在 `src/renderer/stores/__tests__/` 下新增依赖 `window.electronAPI` 的 store 测试时需复用此模式。

---

## 9. 开发指南

### 9.1 快速开始

```bash
# 安装依赖
npm install

# 开发模式 (Vite + Electron 热重载)
npm run dev

# 仅前端 (浏览器调试)
npm run dev -- --renderer-only
```

### 9.2 启动脚本（推荐）

项目根目录提供了两个一键启动脚本，自动完成环境检查、依赖安装和应用启动：

#### Windows — `start.bat`

```batch
start.bat
```

**执行流程**：

| 步骤 | 操作 | 失败处理 |
|------|------|---------|
| 1 | 设置 UTF-8 编码 (`chcp 65001`) | — |
| 2 | 检查 Node.js 是否安装 | 输出错误信息 → 暂停并退出 |
| 3 | 检查 npm 是否可用 | 输出错误信息 → 暂停并退出 |
| 4 | 检查 `node_modules` 是否存在 | 不存在则自动执行 `npm install --no-audit --no-fund` |
| 5 | 检查 Vite 是否安装 | 未安装 → 暂停并退出 |
| 6 | 检查 Electron 是否安装 | 未安装 → 自动重装 `npm install electron --save-dev` |
| 7 | 检查向量依赖 (`@xenova/transformers`, `lru-cache`) | 未安装 → 输出警告但不阻断 (仅影响本地向量功能) |
| 8 | 执行 `npm run dev` 启动开发服务器 | 失败 → 暂停等待用户确认 |

**关键行为**：
- Electron 缺失时自动执行 `rmdir /s /q node_modules\electron` 清理后重装，并二次验证
- 非关键依赖（向量相关库）仅警告，不阻断启动

#### macOS / Linux — `start.sh`

```bash
./start.sh
```

**执行流程**：

| 步骤 | 操作 | 失败处理 |
|------|------|---------|
| 1 | 切换到脚本所在目录 | — |
| 2 | 检查 Node.js 是否安装 (`command -v node`) | 输出错误信息 → 暂停并退出 |
| 3 | 检查 npm 是否可用 (`command -v npm`) | 输出错误信息 → 暂停并退出 |
| 4 | 检查 `@xenova/transformers` 是否存在 | 不存在 → 输出 `[WARN]`，提示 `npm install` |
| 5 | 检查 `lru-cache` 是否存在 | 不存在 → 输出 `[WARN]` |
| 6 | 执行 `npm run dev -- --port 5174` | 失败 → 自动执行 `npm install --legacy-peer-deps --ignore-scripts` → 重试启动 |

**关键行为**：
- 指定端口 **5174** 启动 (与 `vite.config.ts` 配置一致)
- 启动失败时**自动安装依赖** (`--legacy-peer-deps --ignore-scripts` 绕过可能会失败的生命周期脚本)，然后重试
- 安装失败时最终退出并提示

#### 脚本对比

| 特性 | `start.bat` | `start.sh` |
|------|------------|------------|
| 平台 | Windows | macOS / Linux |
| Electron 检查 | ✅ 详细检查 + 自动重装 | ❌ 依赖 `npm run dev` 中 `vite-plugin-electron` |
| 依赖缺失处理 | 启动前自动 `npm install` | 启动失败后才 `npm install` |
| 向量库检查 | ✅ `@xenova/transformers` + `lru-cache` | ✅ 同上 |
| UTF-8 编码 | ✅ `chcp 65001` | N/A |
| 启动命令 | `npm run dev` | `npm run dev -- --port 5174` |

### 9.3 常用 npm scripts

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 (含 Electron 主进程热重载)，默认端口 **5174** |
| `npm run electron:dev` | 别名，同 `npm run dev` |
| `npm run electron:prod` | 直接运行已构建的 Electron 应用 (`electron .`) |
| `npm run build` | Vite 构建生产版本 |
| `npm run electron:build` | 构建前端 + 打包 Electron 安装包 |
| `npm run lint` | ESLint 代码规范检查 |
| `npm run typecheck` | TypeScript 类型检查 (`tsc --noEmit`) |
| `npm run test` | 运行 Vitest 测试 (watch 模式) |
| `npm run test:run` | 单次运行全部测试 |
| `npm run test:coverage` | 运行测试并生成覆盖率报告 |
| `npm run test:integration` | 运行 AI 服务集成测试 |

### 9.4 构建与打包

```bash
# 构建前端
npm run build

# 打包 Electron 应用
npm run electron:build

# Windows NSIS 安装包
npm run electron:build -- --win
```

### 9.5 代码质量

```bash
# ESLint 检查
npm run lint

# TypeScript 类型检查
npm run typecheck

# 运行测试
npm run test

# 集成测试 (需要 AI 配置)
npm run test:integration
```

### 9.6 关键架构决策

| 决策 | 说明 |
|------|------|
| **IPC 通信** | 渲染进程通过 `contextBridge` 暴露的白名单 API 调用主进程，遵循 Electron 安全最佳实践 |
| **CORS 规避** | 所有 AI 请求和文件操作通过主进程 IPC 代理，避免渲染进程的跨域限制 |
| **存储分层** | 配置类数据用 electron-store；业务数据文件用直接文件系统；向量数据用 WASM 专用存储 |
| **路径宏** | `__USER_DATA__` 占位符在运行时解析，允许用户自定义数据位置 |
| **流式响应** | AI 流式输出通过 IPC 事件 (`ai:stream` / `ai:stream:complete` / `ai:stream:error`) 推送 |
| **命名双轨制** | 内部使用 camelCase，导出为 SillyTavern 格式时映射为 snake_case |

### 9.7 已知局限

| 局限 | 说明 |
|------|------|
| `update:check/download/install` | Handler 未实现，更新按钮永不响应 |
| `characterConfig:load` | Handler 已实现但渲染进程从未调用 (只从 localStorage 读取) |
| `chatVector:*` | Handler 已实现但对话流程走 `context:retrieve`，未集成 |
| `settingSchema.ts` (Zod) | Schema 已定义但未在任何地方引用进行运行时校验 |
| `validateSetting()` | 直接返回 `{ valid: true }` (注释: "暂时跳过验证") |
| 角色卡"新建"按钮 | 按钮已渲染但 onClick handler 未实现 |
| `dataStore.optimizeCharacter` | 空 noop 函数体 |

> 详见 `doc/08-module-audit-report.md` 和 `doc/09-optimization-and-common-issues.md` 获取完整的审查和优化建议。

---

**维护者**: Creative-Cafe 开发团队  
**最后更新**: 2026-05-07  
**文档版本**: 2.0.0（基于代码实际状态全面重写）
