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

**MessageRenderer 插件体系**:
- Remark 阶段: remark-gfm, remark-emoji, remark-underscore-italic, remark-table-cell-raw-html
- Rehype 阶段: rehype-raw, rehype-inline-html-parse, rehype-sanitize (三级), rehype-quote-normalize, rehype-quote-highlight, rehype-code-highlight, rehype-style-processor

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
