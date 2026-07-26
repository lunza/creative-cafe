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
| `expression:saveImage` | `saveImage({ characterCardId, emotionKey, imageBase64, isCustom, label? })` | `{ success, error?, imagePath? }` | 保存表情图像（base64，可含 `data:image/png;base64,` 前缀）并更新 manifest；返回图像绝对路径 |
| `expression:deleteImage` | `deleteImage({ characterCardId, emotionKey })` | `{ success, error? }` | 删除指定情绪的图像文件（不删除 customEmotions 条目） |
| `expression:addCustomEmotion` | `addCustomEmotion({ characterCardId, key, label })` | `{ success, error? }` | 添加自定义情绪类别（key 校验 `^[a-z][a-z0-9_]*$`，不与预置重复） |
| `expression:removeCustomEmotion` | `removeCustomEmotion({ characterCardId, key })` | `{ success, error? }` | 移除自定义情绪：删除 customEmotions 条目 + expressions 条目 + 图像文件 |
| `expression:getImagePath` | `getImagePath({ characterCardId, emotionKey })` | `{ success, imagePath: string\|null, error? }` | 获取指定情绪的图像绝对路径（不存在返回 null） |

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

`expressionStore.resolveExpressionImage(emotionKey)` 实现：null/undefined/空串/`'default'` 直接返回 null（回退默认头像）；其他 key 从 `imageCache` 查找绝对路径。流式消息（`isStreaming`）期间使用默认头像，待流式完成后再切换为表情图像，避免闪烁。

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
| `src/renderer/stores/expressionStore.ts` | Zustand 表情状态 store（`useExpressionStore`），持有 `manifest` / `imageCache` / `loading` / `error`，封装所有 IPC 调用，提供 `loadExpressions` / `saveExpression` / `deleteExpression` / `addCustomEmotion` / `removeCustomEmotion` / `resolveExpressionImage` / `getAvailableEmotionKeys` / `clear` actions |
| `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` | `EMOTION_PRESETS` 常量、`buildExpressionPrompt` / `parseExpressionFromContent` 函数 |
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
- AI 引擎管理: 多引擎配置 (增删改查)、默认引擎、连通性测试
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
