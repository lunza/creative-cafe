# Creative-Cafe 技术文档

**版本**: 1.0

> 本文档基于代码实际状态生成，全面反映项目真实架构。所有路径、文件名、数据类型均与源代码一致。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [项目结构](#3-项目结构)
4. [IPC 通信 & preload API](#4-ipc-通信--preload-api)
5. [存储系统](#5-存储系统)
6. [核心功能模块](#6-核心功能模块)
7. [开发指南](#7-开发指南)

---

## 1. 项目概述

### 1.1 项目定位

**Creative-Cafe** 是一个基于 Electron 的桌面应用，为 SillyTavern 提供 GUI 配置管理和 AI 辅助数据优化功能。

### 1.2 核心功能

| 功能模块 | 说明 |
|---------|------|
| **SillyTavern 进程管理** | 启动/停止/监控 ST 进程，支持端口管理、日志捕获 |
| **世界书管理** | 创建/编辑/删除世界书，AI 翻译/润色/生成，条目排序和标签 |
| **角色卡管理** | 创建/导入/导出角色卡（PNG/JSON），AI 增强，角色测试对话 |
| **创意工坊** | Markdown 编辑器 + AI 辅助写作，支持多 Tab 布局 |
| **记忆插件** | 聊天记录整理、Excel 模板管理、对话表格化 |
| **AI 配置中心** | 多引擎管理、模型参数微调、连通性测试 |
| **日志系统** | 分级日志、实时推送、持久化存储 |
| **配置导出/导入** | JSON 格式配置备份与恢复 |
| **UI 个性化** | 暗黑/亮色主题、紧凑模式 |

### 1.2 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| **桌面框架** | Electron | ^33.2.0 (打包用) |
| **前端框架** | React + TypeScript | 1位.2 |
| **UI 库** | Ant Design (antd) | ^6.3.5 |
| **状态管理** | Zustand | ^5.0.12 |
| **构建工具** | Vite | ^5.0.8 |
| **Electron 插件** | vite-plugin-electron | ^0.28.0 |
| **Markdown 编辑器** | Milkdown (Crepe) | ^7.20.0 |
| **AI SDK** | Vercel AI SDK | ai@^6.0.168, @ai-sdk/react@^3.0.170 |
| **数据验证** | Zod | ^4.3.6 |
| **表格处理** | xlsx | ^0.18.5 |
| **Git 操作** | simple-git | ^3.33.0 |
| **字符卡读取** | @lenml/char-card-reader | ^1.1.1 |
| **持久化存储** | electron-store | ^11.0.2 |
| **WebSocket** | ws | ^8.20.0 |
| **文件工具** | mkdirp, rimraf, sanitize-filename | - |
| **测试** | Vitest, Testing Library | ^4.1.5 |
| **代码规范** | ESLint, Prettier | - |

### 1.3 项目运行要求

- **Node.js**: >= 18
- **npm**: >= 9
- **Electron**: 自动安装（devDependency）
- **操作系统**: Windows / macOS / LinuxSetter

---

## 2. 项目结构

```
Creative-Cafe/
├── package.json                  # 项目元信息和依赖
├── tsconfig.json                 # TS 配置（strict）
├── vite.config.ts                # Vite 构建配置
├── index.html                    # HTML 入口
├── electron-builder.json         # Electron Builder 打包配置
│
├── src/
│   ├── main/                     # Electron 主进程代码
│   │   ├── index.ts              # 应用入口：窗口创建、IPC 注册
│   │   ├── preload.ts            # 预加载脚本 (contextBridge)
│   │   ├── ipc/                  # IPC 通信层
│   │   │   ├── index.ts          # IPC 处理器统一注册
│   │   │   └── handlers/         # 按模块拆分的处理器
│   │   │       ├── storageHandlers.ts    # 存储 CRUD
│   │   │       ├── settingHandlers.ts    # 设置读写
│   │   │       ├── worldBookHandlers.ts  # 世界书操作
│   │   │       ├── characterHandlers.ts  # 角色卡操作
│   │   │       ├── creativeHandlers.ts   # 创意管理
│   │   │       ├── memoryHandlers.ts     # 记忆管理
│   │   │       ├── channelHandlers.ts    # 角色对话
│   │   │       ├── pluginHandlers.ts     # 插件管理
│   │   │       ├── avatarHandlers.ts     # 头像管理
│   │   │       ├── aiHandlers.ts         # AI 请求转发
│   │   │       └── fileHandlers.ts       # 文件系统操作
│   │   ├── services/             # 业务逻辑层
│   │   │   ├── StorageManager.ts         # 多文件存储管理 (electron-store)
│   │   │   ├── StorageService.ts         # 存储服务封装
│   │   │   ├── SillyTavernService.ts     # ST 进程管理
│   │   │   ├── CharacterService.ts       # 角色卡 CRUD
│   │   │   ├── WorldBookService.ts       # 世界书 CRUD
│   │   │   ├── MemoryService.ts          # 记忆管理 CRUDfac
│   │   │   ├── PluginService.ts          # 插件安装/管理
│   │   │   ├── AvatarService.ts          # 头像管理
│   │   │   ├── UpdateService.ts          # ST 更新检查/下载
│   │   │   ├── storage.types.ts          # 存储类型定义
│   │   │   └── server.ts                 # Fastify HTTP 服务器（未启用）
│   │   └── utils/
│   │       ├── app.ts                    # Electron app 安全获取
│   │       ├── logger.ts                 # 主进程日志
│   │       └── paths.ts                # 路径工具
│   │
│   ├── renderer/                 # React 渲染进程代码
│   │   ├── main.tsx              # React 入口
│   │   ├── App.tsx               # 根组件：路由和布局
│   │   ├── components/           # React 组件
│   │   │   ├── Common/           # 共享组件
│   │   │   │   ├── MarkdownEditor/       # Milkdown 编辑器
│   │   │   │   │   ├── MarkdownEditor.tsx        # 主编辑器组件
│   │   │   │   │   ├── MarkdownEditor.types.ts   # 类型定义
│   │   │   │   │   ├── MarkdownEditor.utils.ts   # 工具函数
│   │   │   │   │   ├── MarkdownEditor.defaults.ts # 默认配置
│   │   │   │   │   └── MarkdownAITools.tsx        # AI 工具栏
│   │   │   │   ├── AIService.tsx           # AI 服务（Vercel AI SDK）
│   │   │   │   ├── DataPersistence.tsx     # 数据持久化 HOC
│   │   │   │   ├── RichTextRenderer.tsx    # 富文本渲染
│   │   │   │   └── ErrorBoundary.tsx       # 错误边界
│   │   │   ├── Dashboard/         # 仪表盘
│   │   │   │   ├── ChatEngine/             # 聊天引擎
│   │   │   │   │   ├── ChatEngine.ts        # 核心引擎类
│   │   │   │   │   ├── ChatEngine.types.ts  # 引擎类型
│   │   │   │   │   ├── ChatEngine.factory.ts # 工厂类
│   │   │   │   │   └── index.ts             # 统一导出
│   │   │   ├── Character/         # 角色卡管理
│   │   │   │   ├── CharacterManager.tsx      # 角色管理器
│   │   │   │   └── CharacterTestChat/        # 角色测试对话
│   │   │   │       ├── CharacterTestChat.tsx      # 主组件
│   │   │   │       ├── CharacterTestChat.types.ts # 类型定义
│   │   │   │       ├── CharacterTestChat.hooks.ts # 业务逻辑
│   │   │   │       ├── CharacterTestChat.utils.ts # 工具函数
│   │   │   │       ├── ChatMessageBubble.tsx      # 消息气泡
│   │   │   │       ├── ChatInputBar.tsx           # 输入栏
│   │   │   │       ├── ChatTypingIndicator.tsx    # 打字指示器
│   │   │   │       ├── ChatHeader.tsx             # 聊天头部
│   │   │   │       └── index.ts                   # 统一导出
│   │   │   ├── WorldBook/         # 世界书管理
│   │   │   │   ├── WorldBookList.tsx       # 世界书列表
│   │   │   │   ├── WorldBookEditor.tsx     # 世界书编辑器
│   │   │   │   └── WorldBookEntry.tsx      # 入口编辑器
│   │   │   ├── Creative/          # 创意工作室
│   │   │   │   ├── CreativeManager.tsx    # 创意管理器
│   │   │   │   ├── CreativeEditor.tsx     # 创意编辑器
│   │   │   │   ├── CreativeGenerate.tsx   # AI 生成
│   │   │   │   └── CreativeExport.tsx     # 导出
│   │   │   ├── Memory/            # 记忆插件
│   │   │   │   ├── MemoryManager.tsx      # 记忆管理主页
│   │   │   │   ├── ChatViewer.tsx         # 对话查看器
│   │   │   │   ├── TemplateManager.tsx    # 模板管理
│   │   │   │   └── TableViewer.tsx        # 表格查看
│   │   │   ├── Settings/          # 设置页面
│   │   │   │   ├── SettingsPanel.tsx       # 设置面板
│   │   │   │   ├── AIEngineSettings.tsx    # AI 引擎配置
│   │   │   │   ├── ModelSettings.tsx       # 模型参数
│   │   │   │   └── LogSettings.tsx         # 日志设置
│   │   │   ├── PromptOptimizer/  # 提示词优化
│   │   │   ├── Avatar/           # 头像管理
│   │   │   ├── Plugin/           # 插件市场
│   │   │   ├── Layout/           # 布局组件
│   │   │   │   ├── Sidebar.tsx           # 侧边栏
│   │   │   │   ├── Header.tsx            # 顶栏
│   │   │   │   ├── LogPanel.tsx          # 日志面板
│   │   │   │   └── FloatingLogButton.tsx  # 浮动日志按钮
│   │   │   └── Test/             # 测试组件（开发用）
│   │   ├── stores/               # Zustand 状态管理
│   │   │   ├── settingStore.ts          # 设置状态
│   │   │   ├── uiStore.ts               # UI 状态
│   │   │   ├── characterStore.ts         # 角色状态
│   │   │   ├── worldBookStore.ts         # 世界书状态
│   │   │   ├── creativeStore.ts          # 创意状态
│   │   │   ├── memoryStore.ts            # 记忆状态
│   │   │   ├── logStore.ts               # 日志状态
│   │   │   ├── chatStore.ts              # 会话状态
│   │   │   └── promptOptimizerStore.ts   # 提示词状态
│   │   ├── hooks/                # 自定义 Hooks
│   │   ├── services/             # 渲染进程服务
│   │   │   └── promptOptimizerService.ts
│   │   ├── styles/               # CSS 样式
│   │   │   ├── global.css
│   │   │   ├── animations.css
│   │   │   ├── compact.css
│   │   │   ├── milkdown-fixes.css
│   │   │   └── milkdown-theme.ts
│   │   ├── types/                # 类型定义
│   │   │   ├── electron.d.ts            # Electron API 类型
│   │   │   ├── setting.ts               # 设置类型
│   │   │   ├── memory.ts                # 记忆类型
│   │   │   └── index.ts
│   │   └── utils/                # 工具函数
│   │       ├── ipc.ts                    # IPC 调用封装
│   │       ├── storage.ts               # 存储帮助函数
│   │       └── formatters.ts            # 格式化工具it
│   │
│   └── shared/                   # 主进程与渲染进程共享
│       ├── types/                # 共享类型定义
│       ├── constants/            # 共享常量
│       └── ipc-channels.ts       # IPC 通道常量
│
├── resources/                   # Electron 打包资源
│   └── icon.png
│
├── data/                        # 运行时数据 (gitignore)
│   ├── settings.json            # 应用设置
│   ├── characters/              # 角色卡文件
│   ├── worlds/                  # 世界书文件
│   ├── templates/               # 模板文件
│   ├── backups/                 # 自动备份
│   └── logs/                    # 日志文件
│
├── knowledge_base/              # AI 知识库文档
│   ├── ant-design-x/
│   └── vercel-ai-sdk/
│
└── docs/                        # 项目文档
    ├── ARCHITECTURE.md
    ├── CHANGELOG.md
    └── README.md
```

---

## 2. 技术架构

### 2.1 整体架构

Creative-Cafe 采用 **Electron 双进程架构**，即：
- **主进程 (Main Process)**: Node.js 运行时，负责文件系统操作、子进程管理、IPC 通信枢纽
- **渲染进程 (Renderer Process)**: React 单页应用，负责 UI 渲染和用户交互

```
┌────────────────┐         IPC          ┌────────────────┐
│  Renderer       │◄──────────────────► │  Main Process   │
│  (React + TS)   │   contextBridge      │  (Node.js)      │
│                 │                      │                 │
│  Zustand Store  │                      │  handlers/      │
│  Ant Design     │                      │  services/      │
│  Milkdown       │                      │  electron-store│
│  Vercel AI SDK  │                      │  child_process  │
└────────────────┘                      └────────────────┘
```

### 2.2 IPC 通信模型

渲染进程通过 `window.electronAPI` (由 preload.ts 暴露) 调用主进程功能：

```typescript
// 渲染进程调用示例
const settings = await window.electronAPI.setting.load()
const result = await window.electronAPI.ai.request({ /* config */ })

// 主进程向渲染进程推送事件
mainWindow.webContents.send('sillytavern:log', logData)
```

**支持的 IPC 通道**: 详见 [§4. IPC 通信](#4-ipc-通信--preload-api)

### 2.3 数据流

```
用户操作 → React 组件 → Zustand action → IPC 调用 → 主进程处理器
                                                           ↓
  UI 更新 ← React 重渲染 ← state 更新 ← IPC 响应 ← 文件系统 / 网络
```

---

## 3. 核心功能模块

### 3.1 SillyTavern 进程管理

- **启动**: 通过 `child_process.spawn` 启动 `server.js`
- **停止**: 发送 SIGTERM 后超时强制 SIGKILL
- **日志捕获**: stdout/stderr 管道 + WebSocket 推送
- **端口检测**: 检查 8000 端口是否冲突，自动寻址

### 3.2 数据存储 (electron-store)

采用 **多文件存储** 策略，每个模块使用一个独立的 `electron-store` 实例：

| 文件 | 模块 | 存储内容 |
|------|------|---------|
| `settings.json` | 应用设置 | 语言、主题、AI 引擎配置、日志级别 |
| `characters.json` | 角色卡 | 角色列表、元数据、分类 |
| `worldbooks.json` | 世界书 | 世界书条目、标签、分类Schema |
| `creatives.json` | 创意 | 创意文本、属性、时间戳 |
| `templates.json` | 模板 | Markdown 模板、Excel 模板 |
| `sessions.json` | 会话 | 对话历史、消息记录 |

### 3.3 AI 引擎配置

支持以下 API 模式：

- **Chat Completion**: OpenAI 兼容 API（支持自定义端点）
- **Text Completion**: 旧的补全 API
- **NovelAI**: 专用绘画/文本 API
- **AI Horde**: 分布式 GPU 众包 API

```typescript
// 引擎配置示例
{
  id: "default",
  name: "Kunlun-7B",
  apiUrl: "http://localhost:1234/v1",
  apiKey: "sk-xxx",
  model: "kunglun",
  mode: "chat",
  parameters: {
    temperature: 0.7,
    maxTokens: 2048,
    topP: .Scale9
  }
}
```

### 3.4 角色卡系统

- **输入格式**: PNG 嵌入角色卡（支持 V1/V2/V3 规范）
- **解析器**: `@lenml/char-card-reader`
- **字段**: 名称、描述、性格、场景、首次消息、示例对话、头像等
- **操作**: 创建、编辑、删除、导入、导出、AI 优化
- **测试对话**: 支持角色测试对话，提供对话模式和续写模式两种独立的提示词模板

#### 导入机制
角色卡导入采用**文件复制**方式，通过 `character:import` IPC 通道：
1. 前端使用 `file:selectFile` 获取用户选择的文件真实路径
2. 调用 `character.import(sourcePath, fileName)` 传递源路径和文件名
3. 主进程使用 `fs.copyFile` 将文件复制到角色卡目录
4. 自动覆盖已存在的同名文件，无需额外确认
5. 导入完成后调用 `fetchCharacters()` 刷新列表

#### 技术实现
```typescript
// characterService.ts - importCharacter 方法
async importCharacter(sourcePath: string, fileName: string) {
  await fs.mkdir(this.characterDir, { recursive: true });
  const targetPath = path.join(this.characterDir, fileName);
  await fs.copyFile(sourcePath, targetPath); // 自动覆盖已存在文件
  return { success: true, targetPath };
}
```

**BUG 修复记录** (2026-04-29):
- **问题**: 角色卡导入功能不可用，前端使用浏览器 file input 无法获取真实文件路径，导致 `fs.copyFile` 失败
- **根因**: 浏览器 File API 出于安全考虑不暴露真实路径，主进程无法直接访问文件
- **修复方案**: 
  1. 前端改用 `window.electronAPI.file.selectFile()` 获取真实文件路径
  2. 新增 `character.import` IPC 通道，传递源路径和文件名
  3. 主进程通过 `fs.copyFile` 直接复制文件，无需 base64 转换
  4. 移除原有的 `file.writeBinary` 方案（需要 base64 编码/解码，效率低）
- **影响文件**: `preload.ts`, `electron.d.ts`, `CharacterManager.tsx`, `characterService.ts`, `characterHandlers.ts`

### 3.4.1 聊天记录存储架构

**版本**: 0.9.2  
**变更日期**: 2026-04-29

#### 存储结构演进

**旧架构** (已废弃):
- **位置**: `%APPDATA%\creative-cafe\data\character-chats.json`
- **格式**: 单一 JSON 文件包含所有聊天记录
- **问题**: 
  - 单文件过大时性能下降
  - 文件锁定风险（并发读写）
  - 难以备份和迁移特定角色的聊天记录
  - 无数据迁移机制

**新架构** (当前):
- **位置**: `%APPDATA%\creative-cafe\data\character-chats\`
- **结构**:
```
character-chats/
├── test\                          # 测试对话
│   ├── {creativeId}_{characterCardId}.json
│   └── ...
├── generation\                    # 生成对话
│   ├── {creativeId}_{targetType}_{name}.json
│   └── ...
└── migration_backup\              # 迁移备份
    └── character-chats.json.bak
```

#### 文件命名规则

**测试对话文件**: `{creativeId}_{characterCardId}.json`

**生成对话文件**: `{creativeId}_{targetType}_{name}.json`

**文件名安全处理**:
- 替换非法字符: `< > : " / \ | ? *` 和下划线
- 限制文件名长度: 最大 100 字符
- 确保唯一性和可读性

#### 单个聊天文件结构
```json
{
  "id": "test-chat-1234567890",
  "creativeId": "creative123",
  "characterCardId": "char456",
  "characterCardName": "角色名称",
  "messages": [...],
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000
}
```

#### 核心服务: ChatStorageService

**文件位置**: `src/main/services/ChatStorageService.ts`

**核心功能**:
1. **异步文件操作**: 使用 `fs/promises` 替代同步操作
2. **内存缓存**: 基于 `Map` 的缓存，1分钟过期策略
3. **懒加载**: 按需加载单个聊天文件
4. **自动迁移**: 启动时自动从旧格式迁移

**缓存策略**:
```typescript
// 缓存键格式: {type}_{creativeId}_{identifier}
// 缓存 TTL: 60 秒
// 写操作自动失效缓存
```

**主要方法**:
| 方法 | 说明 |
|------|------|
| `getTestChat(creativeId, characterCardId)` | 获取测试对话 |
| `saveTestChat(data)` | 保存测试对话 |
| `deleteTestChat(creativeId, characterCardId)` | 删除测试对话 |
| `getAllTestChats()` | 获取所有测试对话 |
| `getGenerationChat(creativeId, targetType, name)` | 获取生成对话 |
| `saveGenerationChat(data)` | 保存生成对话 |
| `deleteGenerationChat(creativeId, targetType, name)` | 删除生成对话 |
| `getAllGenerationChats()` | 获取所有生成对话 |
| `migrateFromLegacyFile()` | 从旧格式迁移数据 |
| `clearCache()` | 清除缓存 |

#### 数据迁移机制

**自动迁移流程**:
1. 应用启动时，在 IPC 处理器注册后执行迁移
2. 检查旧文件 `character-chats.json` 是否存在
3. 读取旧数据，逐条迁移到新的文件结构
4. 创建备份文件到 `migration_backup/character-chats.json.bak`
5. 记录迁移结果（成功数量、错误列表）

**迁移结果格式**:
```typescript
interface MigrationResult {
  success: boolean;
  migrated: number;
  errors: string[];
}
```

#### 新增 IPC 接口

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `characterChat:migrateFromLegacy` | 手动触发迁移 | MigrationResult |
| `characterChat:clearCache` | 清除内存缓存 | { success: boolean } |

**渲染进程调用方式**:
```typescript
// 手动迁移（通常不需要，应用启动时自动执行）
await window.electronAPI.characterChat.migrateFromLegacy();

// 清除缓存（用于调试或数据刷新）
await window.electronAPI.characterChat.clearCache();
```

#### 性能优化

1. **异步 I/O**: 所有文件操作使用 `async/await`
2. **缓存策略**: 减少重复读取文件的次数
3. **按需加载**: 仅在需要时加载单个聊天文件
4. **懒初始化**: 目录仅在首次操作时创建

#### 错误处理

- **文件不存在**: 返回 `null` 或空数据
- **文件读取失败**: 记录错误日志，返回默认值
- **文件写入失败**: 抛出错误，允许上层处理
- **数据格式错误**: 记录警告日志，尝试修复或跳过

---

### 3.5 世界书系统

#### 重构概述 (版本 0.9.7)
**变更日期**: 2026-04-30

世界书模块从混杂在 dataStore 中的旧架构重构为独立模块，包含完整的 Store、Service、IPC 和类型定义。

#### 架构设计

```
┌─────────────────────────────────────────┐
│         React 组件层                     │
│  WorldBookManager.tsx                   │
│  TagManager.tsx                         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Zustand Store                    │
│  worldBookStore.ts                      │
│  - worldBooks (列表)                     │
│  - currentWorldBook (当前查看)           │
│  - tags, associations (标签)             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         IPC 通信层                       │
│  preload.ts (worldBook.xxx)             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         主进程 Handler                   │
│  worldBookHandlers.ts                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Service 层                       │
│  worldBookService.ts                    │
│  - listWorldBooks()                     │
│  - readWorldBook(path)                  │
│  - writeWorldBook(path, data)           │
│  - deleteWorldBook(path)                │
│  - importWorldBook(sourcePath, name)    │
│  - optimizeWorldBook(path)              │
│  - readTags/writeTags/deleteTags()      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         文件系统                         │
│  <userData>/worlds/*.json               │
│  <userData>/worlds/*.tags.json          │
└─────────────────────────────────────────┘
```

#### 类型定义

**文件位置**: `src/renderer/types/worldBook.ts`

```typescript
interface WorldBookMeta {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

interface WorldBookEntry {
  uid: number | string;
  key: string;
  keysecondary?: string;
  content: string;
  comment: string;
  constant: boolean;
  selective: boolean;
  position?: number;
  probability?: number;
}

interface WorldBookData {
  entries: Record<string | number, WorldBookEntry>;
  name?: string;
  description?: string;
}

interface WorldBookTag {
  id: string;
  name: string;
  color?: string;
}

interface WorldBookTagAssociation {
  entryUid: string | number;
  tagId: string;
}
```

#### Store 状态管理

**文件位置**: `src/renderer/stores/worldBookStore.ts`

| 状态 | 类型 | 说明 |
|------|------|------|
| worldBooks | WorldBookMeta[] | 世界书列表 |
| currentWorldBook | WorldBookData \| null | 当前查看的世界书数据 |
| currentWorldBookPath | string \| null | 当前世界书路径 |
| tags | WorldBookTag[] | 标签列表 |
| associations | WorldBookTagAssociation[] | 标签关联 |

| Action | 返回值 | 说明 |
|--------|--------|------|
| fetchWorldBooks | Promise<void> | 获取世界书列表 |
| readWorldBook(path) | Promise<WorldBookData \| null> | 读取世界书并设为当前 |
| writeWorldBook(path, data) | Promise<boolean> | 保存世界书 |
| deleteWorldBook(path) | Promise<boolean> | 删除世界书 |
| importWorldBook(sourcePath, name) | Promise<boolean> | 导入世界书 |
| optimizeWorldBook(path) | Promise<boolean> | AI优化世界书 |
| readTags(path) | Promise<WorldBookTagData \| null> | 读取标签 |
| writeTags(path, data) | Promise<boolean> | 保存标签 |
| addEntry(path, entry) | Promise<boolean> | 添加条目 |
| updateEntry(path, uid, updates) | Promise<boolean> | 更新条目 |
| deleteEntry(path, uid) | Promise<boolean> | 删除条目 |

#### 数据存储路径

**默认路径**: `<userData>/worlds/`

- `worlds/*.json` - 世界书文件
- `worlds/*.tags.json` - 标签关联文件

#### 重构前问题

| 问题 | 状态 |
|------|------|
| 世界书数据混杂在 dataStore.ts 中 | 已修复 |
| worldBookService.ts 硬编码 sillytavern-source 路径 | 已修复 |
| WorldBookManager.tsx 单文件 183KB 难以维护 | 已拆分引用 |
| 缺少类型定义 (any[]) | 已添加完整类型 |
| IPC/Store 混合调用 | 已统一通过 Store |
| 缺少 import 方法 | 已补充 |

#### 文件结构

```
src/
├── main/
│   ├── services/
│   │   └── worldBookService.ts       # 世界书业务逻辑
│   ├── ipc/handlers/
│   │   └── worldBookHandlers.ts      # IPC 处理器
│   └── preload.ts                    # 预加载 API
├── renderer/
│   ├── types/
│   │   └── worldBook.ts              # 类型定义
│   ├── stores/
│   │   └── worldBookStore.ts         # Zustand Store
│   └── components/WorldBook/
│       ├── WorldBookManager.tsx      # 主组件
│       └── TagManager.tsx            # 标签管理

### 3.6 记忆系统 (Memory)

实现长期记忆管理：

1. **数据提取**: AI 提取对话中的关键信息
2. **结构化存储**: 分为角色信息、关系、事件、地点等表格
3. **上下文注入**: 按相关性检索记忆，注入到提示词

数据流程：
```
SilTavern 对话 → MemoryPlugin 提取 → JSON tables → Prompt 注入
```

### 3.7 日志系统

- **分级日志**: debug / info / warn / error
- **来源**: 主进程、渲染进程、SilTavern 进程
- **输出**: 日志面板 + 本地文件 + WebSocket 推流iable
- **过滤**: 按级别、来源、关键词过滤

### 3.8 角色测试对话

测试对话功能提供**两种独立的提示词模板**，针对不同的任务类型进行精确优化：

#### 对话模式提示词 (Dialogue Prompt)
- **任务标识**: `【任务类型：角色扮演对话】`
- **核心定位**: 与用户进行自然的对话交互
- **关键规则**:
  - 身份认同：你就是这个角色本人，不是AI助手
  - 对话风格：以角色的口吻、性格特点和语言习惯交流
  - 互动性：积极回应用户，推动对话自然发展
  - 情境感知：根据上下文和情境调整语气和态度
- **禁止事项**: 禁止输出格式标记、技术术语、随机字符等
- **输出格式**: 直接输出角色的对话和行动描写

#### 续写模式提示词 (Continuation Prompt)
- **任务标识**: `【任务类型：内容续写】`
- **核心定位**: 继续角色的叙述内容，保持风格和上下文连贯
- **关键规则**:
  - 内容延续：自然地从已有内容继续，不重复已写部分
  - 风格一致：保持相同的叙述风格、语气和节奏
  - 上下文连贯：确保与前文情节逻辑衔接
  - 叙述方式：像小说作者一样续写
- **禁止事项**: 禁止添加标签前缀、元说明文字、解释评论内容
- **输出格式**: 只输出纯粹的续写内容，无任何开场白或结束语
- **技术实现**: 通过 `initialContent` 参数保留原文，AI新增内容自动追加

#### 提示词选择机制
```typescript
// requestAIResponse 接收 promptType 参数
const systemPrompt = promptType === 'continuation' 
  ? buildContinuationPrompt() 
  : buildDialoguePrompt();

// sendMessage 使用对话模式
await requestAIResponse(messages, messageId, '', 'dialogue');

// continueConversation 使用续写模式
await requestAIResponse(messages, messageId, existingContent, 'continuation');

// retryMessage 使用对话模式（重新生成）
await requestAIResponse(messages, messageId, '', 'dialogue');
```

#### 提示词模板结构
两种提示词均包含以下标准化结构：
1. **任务标识**: 明确标识任务类型
2. **角色设定**: 角色名称和角色设定内容
3. **任务说明**: 描述当前任务的性质和目标
4. **约束规则**: 详细的任务规则和注意事项
5. **严格禁止**: 明确禁止的输出内容和行为
6. **输出格式**: 清晰的输出格式要求

### 3.9 用户人设系统

**版本**: 0.9.4  
**变更日期**: 2026-04-29

#### 重构概述

用户人设功能从单一人设表单重构为列表-详情结构，支持多个人设的创建、编辑、删除和管理。

**重构前** (0.9.3 - 已废弃):
- 单一人设表单界面
- 仅支持一个用户人设（保存为 user-profile.json）
- 三个核心功能：人设名称、设定描述、头像上传

**重构后** (0.9.4 - 当前):
- 列表-详情双层结构，类似角色卡系统
- 支持多个人设的创建与管理
- 每个人设独立存储为 `{profile-id}.json` 文件
- 卡片式列表展示，点击卡片进入详情编辑

#### 界面结构

**列表视图**:
- 响应式网格布局（xs:1列, sm:2列, md:3列, lg:4列）
- 卡片展示：头像预览、人设名称、描述摘要、更新时间
- 空状态提示（无数据时显示 Empty 组件）
- 顶部工具栏：刷新按钮、新建按钮
- 卡片操作：编辑按钮、删除按钮（带确认对话框）

**详情视图**:
- 返回按钮（返回列表）
- 表单字段：人设名称（必填）、设定描述（可选）、头像上传
- 保存按钮
- 与列表视图通过 viewMode 状态切换

#### 数据结构

**存储位置**: `data/user-avatars/`

**每个人设文件**: `{profile-id}.json`

```json
{
  "id": "profile-1234567890",
  "name": "用户名称",
  "description": "用户设定描述",
  "avatarPath": "头像文件路径",
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000
}
```

#### 技术实现

**前端组件**: `src/renderer/components/Avatar/AvatarManager.tsx`

**后端服务**: `src/main/services/avatarService.ts`

**核心常量**:
```typescript
const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_AVATAR_SIZE_MB = 5;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
```

**状态管理**:
```typescript
const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
const [profiles, setProfiles] = useState<UserAvatarProfile[]>([]);
const [editingProfile, setEditingProfile] = useState<UserAvatarProfile | null>(null);
const [profileForm, setProfileForm] = useState({ name: '', description: '', avatarPath: '' });
```

**数据流**:
1. 组件加载时调用 `avatar.list()` 获取所有人设文件列表
2. 遍历文件，调用 `avatar.read()` 读取每个人设的 JSON 内容
3. 按 updatedAt 降序排序后展示在列表中
4. 点击卡片调用 `handleEditProfile` 切换到详情视图
5. 编辑完成后调用 `avatar.write()` 写入独立 JSON 文件
6. 删除时调用 `avatar.delete()` 删除对应文件

**头像展示方案**:
- Electron 渲染进程由于安全限制无法直接通过 `file://` 协议加载本地图片
- 解决方案：文件复制成功后，调用主进程 `file.readAsBase64()` 获取 base64 Data URL
- JSON 文件中仅存储文件路径，展示时动态转换为 Data URL
- 列表卡片使用 `AvatarCard` 组件，内部异步加载 base64 数据

**新增加载文件方法**:
| 方法 | 说明 | 返回值 |
|------|------|--------|
| `file:copyFile` | 主进程直接复制文件 | Promise<{ success: boolean; error?: string }> |
| `file.readAsBase64` | 读取本地文件为 base64 Data URL | Promise<{ success: boolean; data?: string; error?: string }> |

**AvatarService 方法**:
| 方法 | 说明 | 返回值 |
|------|------|--------|
| `listAvatars()` | 列出所有 .json 人设文件 | Promise<Avatar[]> |
| `readAvatar(filePath)` | 读取人设 JSON 内容 | Promise<any> |
| `writeAvatar(filePath, data)` | 写入人设 JSON | Promise<{ success: boolean }> |
| `deleteAvatar(filePath)` | 删除人设文件 | Promise<{ success: boolean }> |
| `getAvatarDir()` | 获取人设目录路径 | string |
| `setAvatarDir(dir)` | 设置人设目录 | void |

**错误处理**:
- 文件不存在时优雅降级
- 读取失败时记录警告日志，跳过该文件
- 上传失败时显示错误消息
- 所有操作记录到日志系统

### 3.10 角色测试对话 - 人设选择与参数配置

**版本**: 0.9.5
**变更日期**: 2026-04-29

#### 功能概述

在角色测试对话框右侧新增用户人设选择与AI参数配置面板，支持人设切换和参数自定义，实现更精细的对话控制。

#### 布局结构

```
CharacterTestChat (主容器，1200px宽)
├── ChatArea (左侧聊天区域，flex:1)
│   ├── ChatHeader
│   ├── ChatMessageBubble
│   ├── ChatInputBar
│   └── ChatTypingIndicator
└── ConfigPanel (右侧配置面板，320px固定宽)
    ├── PersonaPanel (人设选择面板)
    │   ├── 人设卡片列表（头像+姓名）
    │   └── 空状态/加载状态
    └── ParameterPanel (参数配置面板)
        ├── Temperature 滑块
        ├── Top P 滑块
        ├── Frequency Penalty 滑块
        ├── Presence Penalty 滑块
        └── 重置为默认值按钮
```

#### 人设选择功能

**组件**: `PersonaPanel.tsx`
**Hook**: `usePersonas()` in `CharacterTestChat.hooks.ts`

**功能**:
- 从 Avatar 系统加载用户人设列表（.json文件）
- 横向卡片列表展示，显示头像和姓名
- 选中状态高亮（紫色边框+阴影）
- 空状态提示"暂无人设，请先创建"
- 切换人设后自动重建提示词（包含用户人设信息段落）

**人设提示词模板** (`buildPersonaSection`):
```
## 用户人设
你正在与用户 **{persona.name}** 进行对话。
### 用户信息
{persona.description}
请根据上述用户人设信息调整你的对话风格和回应方式。
```

#### 参数配置功能

**组件**: `ParameterPanel.tsx`
**Hook**: `useCharacterConfig()` in `CharacterTestChat.hooks.ts`

**可调参数**:

| 参数 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| Temperature | 0.1-2.0 | 0.7 | 控制输出的随机性 |
| Top P | 0.1-1.0 | 0.9 | 核采样参数，控制输出多样性 |
| Frequency Penalty | -2.0-2.0 | 0.0 | 降低重复token的权重 |
| Presence Penalty | -2.0-2.0 | 0.0 | 鼓励模型谈论新话题 |

**注意**: `top_k` 参数因 AI 后端兼容性问题已移除。

#### 参数优先级机制

```
用户自定义参数 (custom) > 全局默认参数 (global)
```

- 用户未修改参数时：使用全局默认值（不发送额外参数到API）
- 用户修改参数后：发送自定义参数值到API
- 参数重置：清除自定义参数，恢复为全局默认值
- 参数持久化：使用 localStorage，键名 `character-session-{characterCardId}`

#### 数据结构

**CharacterSessionConfig** (存储于 localStorage):
```json
{
  "characterCardId": "角色卡ID",
  "selectedPersonaId": "选中的人设ID",
  "customParameters": {
    "temperature": 0.8,
    "top_p": 0.95,
    "frequency_penalty": 0.2,
    "presence_penalty": 0.1
  },
  "lastUpdated": 1714435200000
}
```

#### 实时生效机制

1. 人设切换：点击卡片 → 更新 config → 重建 prompt → 下次消息使用新人设
2. 参数调节：拖动滑块 → 更新 config → 下次消息使用新参数
3. 参数重置：点击重置 → 清除 customParameters → 恢复全局默认值

#### 错误修复记录

**HTTP 500 错误修复**:
- **问题**: 初始实现向 AI 后端发送了不支持的 `top_k` 参数，导致部分 API 后端返回 500 错误
- **根因**: 许多 OpenAI 兼容 API 不支持 `top_k` 参数
- **解决方案**: 
  - 从类型定义中移除 `top_k` 字段
  - 从 ParameterPanel 组件移除 top_k 滑块
  - 从 ChatEngine 的请求构建逻辑移除 top_k 传递
  - 只发送实际用户修改的参数到 API（undefined 参数不发送）
- **涉及文件**:
  - `CharacterTestChat.types.ts` - 移除 AIParameterConfig.top_k
  - `CharacterTestChat.hooks.ts` - 移除 getEffectiveParams 中的 top_k
  - `ParameterPanel.tsx` - 移除 top_k 配置项
  - `ChatEngine.ts` - 移除 buildRequestBody 中的 top_k 传递
  - `ChatEngine.types.ts` - 移除 AIEngineConfig.top_k

### 3.11 角色测试对话 - Markdown 与 HTML 渲染系统

**版本**: 0.9.6
**变更日期**: 2026-04-30

#### 功能概述

角色测试对话的 Markdown 与 HTML 渲染及识别系统，实现与 SillyTavern 类似的多样化消息展示效果。系统基于 `react-markdown` + `remark-gfm` + `rehype-sanitize` 技术栈，提供安全的 Markdown/HTML 混合渲染能力。

#### 架构设计

```
┌─────────────────────────────────────────┐
│         对话消息输入层                    │
│  (ChatMessage.content: string)          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         预处理管道                       │
│  - 模板变量替换 ({{char}}, {{user}})    │
│  - 引号标准化                            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Markdown 解析层                  │
│  - react-markdown 核心解析               │
│  - remark-gfm (表格、删除线等)           │
│  - remark-emoji (Emoji 支持)            │
│  - 自定义 remark 插件                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         HTML 处理层                      │
│  - rehype-raw (原始 HTML 支持)          │
│  - rehype-sanitize (安全过滤)           │
│  - 自定义 rehype 插件                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         渲染输出层                       │
│  - React 组件渲染                        │
│  - CSS 样式应用                          │
└─────────────────────────────────────────┘
```

#### 技术栈

| 库 | 用途 |
|----|------|
| `react-markdown` | 核心 Markdown 解析和 React 渲染 |
| `remark-gfm` | GitHub Flavored Markdown 扩展（表格、删除线、任务列表） |
| `remark-emoji` | Emoji 表情解析 |
| `rehype-raw` | 原始 HTML 支持 |
| `rehype-sanitize` | HTML 安全过滤（基于白名单） |
| `unified` | 插件系统基础 |
| `unist-util-visit` | AST 遍历工具 |
| `unist-builder` | AST 节点构建工具 |

#### 核心组件

**MessageRenderer** (`src/renderer/components/Character/CharacterTestChat/MessageRenderer/MessageRenderer.tsx`)

主渲染组件，接收 Markdown/HTML 混合内容并渲染为安全的 React 元素。

```typescript
<MessageRenderer
  content="**Hello** from {{char}}!"
  charName="Alice"
  userName="User"
  config={{
    markdown: { enableGFM: true, enableEmoji: true },
    html: { allowRawHTML: true, sanitizeLevel: 'moderate' },
    style: { theme: 'dark', codeHighlight: true },
  }}
/>
```

**Props**:
| 属性 | 类型 | 说明 |
|------|------|------|
| `content` | string | Markdown/HTML 混合内容 |
| `charName` | string | 角色名称（用于模板替换） |
| `userName` | string | 用户名称（用于模板替换） |
| `config` | Partial<RenderConfig> | 渲染配置 |
| `className` | string | 自定义 CSS 类名 |
| `style` | CSSProperties | 自定义样式 |
| `onLinkClick` | (href, event) => void | 链接点击回调 |
| `onImageClick` | (src, event) => void | 图片点击回调 |

#### 预处理管道

**messageProcessor.ts** (`src/renderer/components/Character/CharacterTestChat/utils/messageProcessor.ts`)

| 函数 | 说明 |
|------|------|
| `processMessage(text, options)` | 完整预处理：模板替换 + 引号标准化 |
| `replaceTemplates(text, options)` | 模板变量替换（`{{char}}`、`{{user}}` 等） |
| `normalizeQuotes(text)` | 引号标准化（各类引号转为 `<q>` 标签） |
| `encodeAngleBrackets(text)` | 角度括号转义 |
| `protectCodeBlocks(text)` | 保护代码块（提取为占位符） |
| `restoreCodeBlocks(text, blocks)` | 恢复代码块（占位符还原） |
| `preprocessForMarkdown(text, options)` | Markdown 预处理（含代码块保护） |

**模板变量支持**:
- `{{char}}` / `{{Char}}` / `{{CHAR}}` → 角色名
- `{{user}}` / `{{User}}` / `{{USER}}` → 用户名

#### 自定义 remark/rehype 插件

**remark-underscore-italic.ts**: 下划线斜体扩展（`_text_` → `<em>`）

**rehype-quote-normalize.ts**: 引号标准化（各类引号格式转为 `<q>` 标签）

**rehype-quote-highlight.ts**: 双引号内容高亮（自动识别 `""` 包裹的文本并添加高亮样式，保留原始引号）

**rehype-code-highlight.ts**: 代码高亮处理（为代码块添加 CSS 类）

**rehype-style-processor.ts**: 样式标签处理（scoped CSS + 危险样式过滤）

**rehype-inline-html-parse.ts**: 行内 HTML 解析（解决 Markdown 表格单元格内 HTML 标签无法正确渲染的问题）

#### 双引号高亮功能

**版本**: 0.9.6.1  
**变更日期**: 2026-04-30

自动识别并高亮显示双引号包裹的文本内容，提升对话内容的视觉层次感。

**实现原理**:
```typescript
// rehype-quote-highlight.ts
const QUOTE_PATTERN = /"([^"]*?)"/g;

// 遍历 text 节点，匹配双引号内容
// 将匹配到的内容包装为 <span class="message-renderer-quote-highlight">"<mark>内容</mark>"</span>
```

**样式配置**:
```css
.message-renderer-quote-highlight {
  background: rgba(255, 200, 50, 0.25);
  padding: 0 3px;
  border-radius: 3px;
  border-left: 2px solid rgba(255, 180, 30, 0.6);
  border-right: 2px solid rgba(255, 180, 30, 0.6);
}

/* 暗色主题适配 */
[data-theme="dark"] .message-renderer-quote-highlight {
  background: rgba(255, 180, 30, 0.15);
  border-left-color: rgba(255, 160, 20, 0.5);
  border-right-color: rgba(255, 160, 20, 0.5);
}
```

**特性**:
- 自动识别文本中的双引号内容
- 保留原始引号符号
- 使用 `<mark>` 标签包裹内容，确保语义正确
- 支持嵌套引号处理（通过非贪婪匹配）
- 暗色/亮色主题自适应

#### 消息编辑功能

**版本**: 0.9.6.1  
**变更日期**: 2026-04-30

为每条消息气泡添加编辑功能，支持直接修改 Markdown 源代码并实时更新渲染。

**功能特性**:
1. **编辑图标**: 鼠标悬停消息气泡时，右上角显示编辑图标（铅笔图标）
2. **编辑模式**: 点击编辑图标后，消息内容切换为可编辑的 textarea
3. **保存机制**: 支持 Ctrl+Enter 快捷保存，或点击保存按钮
4. **取消编辑**: 支持 Esc 快捷键取消，或点击取消按钮
5. **状态管理**: 编辑内容通过 `editMessage` hook 更新到聊天状态并持久化

**界面交互**:
```
普通模式:
┌──────────────────────────────────┐
│ 消息内容（渲染后）          [✏️] │  ← 悬停显示编辑图标
└──────────────────────────────────┘

编辑模式:
┌──────────────────────────────────┐
│ ┌────────────────────────────   │
│ │ **Markdown 源码**           │   │  ← 可编辑 textarea
│ │ 在此输入内容...            │   │
│ └────────────────────────────┘   │
│                  [取消] [保存]    │
│          Ctrl+Enter 保存 · Esc 取消│
└──────────────────────────────────┘
```

**技术实现**:
```typescript
// ChatMessageBubble.tsx
const [isEditing, setIsEditing] = useState(false);
const [editContent, setEditContent] = useState('');

// 进入编辑模式
const handleEditStart = () => {
  setEditContent(String(message.content));
  setIsEditing(true);
};

// 保存编辑
const handleEditSave = () => {
  if (onEdit && editContent.trim() && editContent !== message.content) {
    onEdit(message.id, editContent.trim());
  }
  setIsEditing(false);
};

// CharacterTestChat.hooks.ts
const editMessage = useCallback((messageId: string, newContent: string) => {
  setState(prev => {
    const updatedMessages = prev.messages.map(msg =>
      msg.id === messageId ? { ...msg, content: newContent, timestamp: Date.now() } : msg
    );
    saveChatToStore(updatedMessages);
    return { ...prev, messages: updatedMessages };
  });
}, [saveChatToStore]);
```

**悬停动画效果**:
```css
.edit-icon-btn {
  opacity: 0;
  transform: translateY(-4px) scale(0.85);
  pointer-events: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-message-bubble-wrapper:hover .edit-icon-btn {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
```

#### 行内 HTML 样式渲染修复

**BUG 修复记录** (2026-04-30):
- **问题**: `<span style="color:#FF6B6B">文本</span>` 等内联样式在渲染后未生效
- **根因**: `remark-gfm` 将表格单元格内容视为纯文本节点，HTML 标签被当作普通字符串处理
- **修复方案**:
  1. 创建 `rehype-inline-html-parse` 插件，在 rehype 阶段解析文本节点中的 HTML
  2. 使用 `hast-util-from-html` 将 HTML 字符串转换为 HAST 元素树
  3. 调整 sanitizeConfig 确保 `style` 属性在白名单中（`'*': ['class', 'style', 'id']`）
  4. 插件执行顺序：`rehype-raw` → `rehype-inline-html-parse` → `rehype-sanitize` → 其他插件
- **影响文件**:
  - `rehype-inline-html-parse.ts` - 新建行内 HTML 解析插件
  - `MessageRenderer.tsx` - 集成新插件到处理管道
  - `sanitizeConfig.ts` - 确保 style 属性被保留

```typescript
// rehype-inline-html-parse.ts 核心逻辑
const INLINE_HTML_PATTERN = /<(span|div|a|b|strong|i|em|u|s|strike|del|ins|mark|sub|sup|img|code|pre|q|cite|font)\b[^>]*>[\s\S]*?<\/\1>|<(br|img|hr)\b[^>]*\/?>/gi;

export const rehypeInlineHtmlParse: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      // 1. 检测文本节点中的 HTML 标签
      // 2. 使用 fromHtml 解析 HTML 字符串
      // 3. 将解析后的 HAST 节点替换原文本节点
    });
  };
};
```

#### 安全过滤配置

**sanitizeConfig.ts** (`src/renderer/components/Character/CharacterTestChat/utils/sanitizeConfig.ts`)

提供三级安全过滤：

| 级别 | 描述 | 允许标签 |
|------|------|---------|
| `strict` | 严格模式 | 基础文本格式化、列表、链接、代码 |
| `moderate` | 中等模式（默认） | strict + details/summary/abbr/figure |
| `loose` | 宽松模式 | moderate + audio/video/source/track |

**白名单配置**:
```typescript
// 允许的属性
const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  table: ['border', 'cellpadding', 'cellspacing'],
  '*': ['class', 'style', 'id'],
};

// 允许的协议
const ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];
```

**安全机制**:
1. **输入净化**: rehype-sanitize 白名单过滤
2. **协议白名单**: 仅允许安全的 URL 协议
3. **属性过滤**: 限制危险属性（`on*` 事件等）
4. **脚本过滤**: 禁止 `<script>` 标签和 `javascript:` 协议
5. **样式限制**: 过滤 CSS 注入（expression、behavior 等）

#### 渲染配置

**RenderConfig 接口**:
```typescript
interface RenderConfig {
  markdown: {
    enableGFM: boolean;           // 启用 GFM 扩展
    enableUnderscoreItalic: boolean;  // 启用下划线斜体
    enableQuoteNormalize: boolean;    // 启用引号标准化
    enableEmoji: boolean;         // 启用 Emoji 解析
  };
  html: {
    allowRawHTML: boolean;        // 允许原始 HTML
    sanitizeLevel: 'strict' | 'moderate' | 'loose';
    customTags?: string[];        // 自定义允许标签
    customAttributes?: Record<string, string[]>;
  };
  style: {
    theme: 'default' | 'dark' | 'light' | string;
    codeHighlight: boolean;       // 启用代码高亮
    customCSS?: string;           // 自定义 CSS
  };
  template: {
    charPlaceholder: string;      // 角色占位符 (默认: {{char}})
    userPlaceholder: string;      // 用户占位符 (默认: {{user}})
  };
}
```

#### 样式系统

**MessageRenderer.styles.css**: 完整的 CSS 样式，支持 CSS 变量自定义

**CSS 变量**:
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `--mr-link` | #4a9eff | 链接颜色 |
| `--mr-code-bg` | rgba(0,0,0,0.3) | 代码块背景 |
| `--mr-blockquote-border` | #4a9eff | 引用块边框 |
| `--mr-table-border` | rgba(255,255,255,0.1) | 表格边框 |

#### 支持的 Markdown 语法

| 语法 | 示例 | 说明 |
|------|------|------|
| 标题 | `# H1` ~ `###### H6` | 六级标题 |
| 粗体 | `**text**` | 粗体文本 |
| 斜体 | `*text*` | 斜体文本 |
| 下划线斜体 | `_text_` | 自定义扩展 |
| 删除线 | `~~text~~` | GFM 扩展 |
| 行内代码 | `` `code` `` | 行内代码 |
| 围栏代码块 | ` ```lang\n...\n``` ` | 代码块 + 语法高亮 |
| 链接 | `[text](url)` | 安全链接 |
| 图片 | `![alt](url)` | 图片（懒加载） |
| 引用块 | `> quote` | 嵌套引用 |
| 无序列表 | `- item` | 无序列表 |
| 有序列表 | `1. item` | 有序列表 |
| 任务列表 | `- [x] done` | GFM 任务列表 |
| 表格 | `\| a \| b \|` | GFM 表格 |
| 分割线 | `---` | 水平分割线 |
| Emoji | `:smile:` | Emoji 解析 |

#### 集成方式

**ChatMessageBubble.tsx** 已集成 MessageRenderer：

```typescript
import { MessageRenderer } from './MessageRenderer';

<MessageRenderer
  content={String(message.content)}
  charName={characterName}
  userName="You"
  config={{
    style: { theme: 'dark', codeHighlight: true },
  }}
/>
```

#### 文件结构

```
CharacterTestChat/
├── MessageRenderer/
│   ├── index.ts                    # 统一导出
│   ├── MessageRenderer.tsx         # 主渲染组件
│   ├── MessageRenderer.types.ts    # 类型定义
│   ├── MessageRenderer.config.ts   # 配置定义
│   ├── MessageRenderer.styles.css  # 样式文件
│   └── __tests__/
│       └── MessageRenderer.test.tsx # 组件测试
├── utils/
│   ├── messageProcessor.ts         # 预处理管道
│   ├── sanitizeConfig.ts           # 安全过滤配置
│   ├── plugins/
│   │   ├── remark-underscore-italic.ts
│   │   ├── rehype-quote-normalize.ts
│   │   ├── rehype-code-highlight.ts
│   │   └── rehype-style-processor.ts
│   └── __tests__/
│       ├── messageProcessor.test.ts
│       └── sanitizeConfig.test.ts
── CharacterTestChat.utils.ts      # 工具函数导出
└── CharacterTestChat.types.ts      # 类型定义
```

#### 测试覆盖

| 测试文件 | 测试用例数 | 覆盖范围 |
|---------|-----------|---------|
| `messageProcessor.test.ts` | 15 | 模板替换、引号处理、代码块保护 |
| `sanitizeConfig.test.ts` | 9 | 安全级别、自定义配置 |
| `MessageRenderer.test.tsx` | 25 | 渲染效果、安全防护、样式应用 |

---

## 4. IPC 通信 & Preload API

### 4.1 渲染进程可用的 API

以下是通过 `contextBridge.exposeInMainWorld('electronAPI', {...})` 暴露的所有 API：

#### 设置 (setting)

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `load()` | - | `Promise<Setting>` | 加载完整设置 |
| `save(setting)` | Setting | `Promise<void>` | 保存设置 |
| `getPath()` | - | `Promise<string>` | 获取设置文件路径 |

#### 文件 (file)

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `selectDirectory()` | - | `Promise<string>` | 选择目录 |
| `selectFile(filters)` | FileFilter[] | `Promise<string>` | 选择文件 |
| `exists(path)` | string | `Promise<boolean>` | 检查存在 |
| `read(path)` | string | `Promise<string>` | 读文本文件 |
| `write(path, data)` | string, string | `Promise<{ success: boolean; error?: string }>` | 写文本文件 |
| `writeBinary(path, data)` | string, Buffer | `Promise<void>` | 写二进制文件 |
| `openExternal(url)` | string | `Promise<void>` | 外部浏览器打开 |

#### 世界书 (worldbook)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `list()` | - | WorldBook[] | 获取所有世界书 |
| `read(path)` | string | WorldBook | 读世界书 |
| `write(path, data)` | string, WorldBook | void | 写世界书 |
| `delete(path)` | string | void | 删除世界书 |
| `getDirectory()` | - | string | 获取世界书目录 |

#### 角色卡 (character)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `list()` | - | Character[] | 角色列表 |
| `read(path)` | string | Character | 读角色卡 |
| `write(path, data)` | string, Character | void | 写角色卡 |
| `delete(path)` | string | void | 删除角色卡 |
| `import(sourcePath, fileName)` | string, string | { success: boolean; targetPath?: string; error?: string } | 导入角色卡（通过文件路径复制） |
| `getDirectory()` | - | string | 角色卡目录 |
| `setDirectory(dir)` | string | { success: boolean } | 设置角色卡目录 |

#### 创意 (creative)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `load()` | - | CreativeData | 读取所有创意 |
| `save(data)` | CreativeData | void | 保存创意数据 |
| `export()` | - | string | 导出为 JSON |
| `import(data)` | string | void | 从 JSON 导入 |
| `migrate()` | - | void | 迁移旧格式数据 |

#### 记忆 (memory)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getTemplates()` | - | MemoryTemplate[] | 获取所有模板 |
| `createTemplate(template)` | MemoryTemplate | void | 创建模板 |
| `updateTemplate(template)` | MemoryTemplate | void | 更新模板 |
| `deleteTemplate(id)` | string | void | 删除模板 |
| `getRecords(templateId)` | string | MemoryRecord[] | 获取记录 |
| `createRecord(record)` | MemoryRecord | void | 创建记录 |
| `updateRecord(record)` | MemoryRecord | void | 更新记录 |
| `deleteRecord(id)` | string | void | 删除记录 |
| `processChat(chatId, templateId)` | string, string | MemoryRecord[] | AI 处理对话 |
| `getTableData(chatId)` | string | TableData | 获取表格数据 |
| `saveTableData(chatId, sheetName, data)` | string, string, any[] | void | 保存表格数据 |

#### AI (ai)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `request(config)` | AIRequestConfig | AIResponse | 发送 AI 请求 |
| `streamRequest(config)` | AIRequestConfig | Observable | 流式 AI 请求 |
| `testConnection(config)` | AIConfig | ConnectionResult | 测试连接 |

#### SillyTavern (sillytavern)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `start()` | - | void | 启动 ST |
| `stop()` | - | void | 停止 ST |
| `restart()` | - | void | 重启 ST |
| `getStatus()` | - | ProcessStatus | 获取 ST 状态 |
| `getLogs()` | - | string[] | 获取 ST 日志 |

#### 更新 (update)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `check()` | - | UpdateInfo | 检查 ST 更新 |
| `download(version)` | string | void | 下载更新 |
| `install(version)` | string | void | 安装更新artic |

#### 通用 (app)

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getVersion()` | - | string | 应用版本 |
| `getPlatform()` | - | string | 操作系统 |
| `openPath(path)` | string | void | 打开目录 |
| `getRootPath()` | - | string | 应用根目录ept |

### 4.2 主进程事件推送 (Main → Renderer)

渲染进程通过 `window.electronAPI.onXxx(callback)` 注册事件监听：

| 事件 | 负载 | 说明 |
|------|------|------|
| `sillytavern:log` | string | ST 控制台输出Bor |
| `sillytavern:status` | ProcessStatus | ST 状态变化 |
| `ai:stream-chunk` | StreamChunk | AI 流式响应块 |
| `update:progress` | ProgressInfo | 更新下载进度OT |

---

## 5. 项目配置

### 5.1 TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@main/*": ["src/main/*"],
      "@renderer/*": ["src/renderer/*"],
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

### 5.2 Vite 配置

关键配置：
- **主进程入口**: `src/main/index.ts`
- **预加载脚本**: `src/main/preload.ts`
- **渲染进程入口**: `index.html` → `src/renderer/main.tsx`
- **Electron 插件**: vite-plugin-electron 处理主进程/预加载的构建

### 5.3 Electron Builder

```json
{
  "appId": "com.creative-cafe.app",
  "productName": "Creative-Cafe",
  "directories": { "output": "release" },
  "win": {
    "target": "nsis",
    "icon": "resources/icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "resources/icon.icns"
  },
  "linux": {
    "target": "AppImage",
    "icon": "resources/icon.png"
  }
}
```

---

## 6. 状态管理 (Zustand)

### 6.1 UI Store

```typescript
interface UIState {
  activeTab: TabType                      // 当前面板
  theme: 'light' | 'dark'                // UI 主题
  sidebarCollapsed: boolean               // 侧栏折叠
  compactMode: boolean                     // 紧凑模式
  animationsEnabled: boolean               // 是否启用动画
}
```

### 6.2 设置 Store

```typescript
interface SettingState {
  language: string                         // 界面语言
  stPath: string                           // ST 安装路径右
  logLevel: LogLevel                       // 日志级别
  autoStartST: boolean                     // 自动启动 ST
  aiEngines: AIEngineConfig[]              // AI 引擎配置
  activeEngineId: string                   // 当前引擎
}
```

---

## 附录 A: 文件路径约定

| 用途amination | 路径 |
|------|------|
| ST 默认安装 | `<dataDir>/SilTavern/` |
| 用户数据 | `<dataDir>/user/` |
| 角色卡 | `<dataDir>/user/characters/` |
| 世界书 | `<dataDir>/user/worlds/` |
| 设置 | `<dataDir>/user/settings.json` |
| 模板 | `<dataDir>/user/templates/` |
| 日志 | `<dataDir>/logs/` |
| 备份 | `<dataDir>/backups/` |
   | 临时文件 | `<tempDir>/creative-cafe/` |

> `dataDir` 默认为应用安装目录下的 `data/` 子目录，可在设置中修改。

## 附录ibid

### B1. 已知问题

- **server.ts (Fastify)**: 已实现但未启用；当前仅用 IPC 通信，未来可能用于 HTTP API
- **Milkdown 大文档**: 超大创意 (>50K 字符) 可能导致编辑器卡顿
- **Windows 路径**: 部分文件操作需手动处理 `\` vs `/` 转换

### B2. 版本演进

| 版本 | 关键变更 |
|------|---------|
| 0.1.0 | 基础 Electron + Vite 脚手架 |
| 0.2.0 | 角色卡导入/编辑 |
| 0.3.0 | 世界书管理 |
| 0.4.0 | AI 引擎配置 |
| 0.5.0 | 记忆系统 |
| 0.6.0 | Markdown 编辑器 |
| 0.7.0 | 插件系统 |
| 0.8.0 | 模板市场 |
| 0.9.0* | UI 重构（暗黑/紧凑）、流式 AI 响应 |
| 0.9.1 | **[BUGFIX]** 角色卡导入功能修复：改用 file:selectFile + character.import IPC 通道，解决浏览器 File API 无法获取真实路径问题 |
| 0.9.2 | **[REFACTOR]** 聊天记录存储架构重构：从单文件迁移为按角色卡拆分的独立文件结构，添加 ChatStorageService、异步 I/O、内存缓存和自动迁移机制 |
| 0.9.3 | **[REFACTOR]** 用户人设功能重构：简化为三大核心功能（人设名称、设定描述、头像上传），移除冗余的翻译/润色/表格管理逻辑，添加表单验证、文件大小限制、图片预览功能 |
| 0.9.4 | **[REFACTOR]** 用户人设多文件管理重构：从单一人设表单升级为列表-详情结构，支持多个人设创建/编辑/删除，每个人设独立存储为 JSON 文件，采用响应式卡片网格布局 |
| 0.9.5 | **[REFACTOR]** 角色测试对话功能增强：添加对话模式/续写模式双提示词模板、用户人设选择与AI参数配置面板 |
| 0.9.6 | **[FEATURE]** 角色测试对话 Markdown/HTML 渲染系统：基于 react-markdown + remark-gfm + rehype-sanitize 技术栈，支持双引号高亮、消息编辑、全屏模式 |
| 0.9.7 | **[REFACTOR]** 世界书模块架构重构：创建独立 worldBookStore.ts、完整 TypeScript 类型定义、移除硬编码路径、补充 import 方法、统一数据流 |
| 0.9.8 | **[REFACTOR]** 系统解耦与ST启动功能移除：移除 SillyTavern 启动服务/IPC/WebSocket，重写 main/index.ts 和 preload.ts，清理 Settings 中 ST 根目录配置，修复 Dashboard worldBooks 引用，Creative-Cafe 现在作为独立工具运行不再依赖 ST 进程 |
| 0.9.9 | **[REFACTOR]** 路径配置优化：创建 pathService 统一路径管理，所有模块路径统一存储在 userData/data/ 下，支持自定义路径配置和实时验证，Dashboard 动态读取设置路径 |
| 1.0.0 | **[BUGFIX]** 路径验证失败修复：添加 validatePath 到 preload.ts，修复 __USER_DATA__ 占位符未暴露给渲染进程的问题，改进 characterHandlers 和 worldBookHandlers 中的占位符解析逻辑，修复 handleOpenFolder 中缺少的 await |
| 1.0.1 | **[FEATURE]** 存储路径显示统一化：为创意管理和记忆管理模块添加存储路径显示功能，与角色卡、世界书、用户人设、插件管理保持一致的UX设计，支持路径复制功能 |
| 1.0.2 | **[FEATURE]** 调试模式开关：在高级设置中添加调试模式切换按钮，控制开发中菜单（提示词优化、插件管理、测试）的显示/隐藏，带DEV徽章标识，状态持久化存储 |
| 1.0.3 | **[BUGFIX]** 世界书详情无限加载修复：修复 Modal bodyStyle 废弃警告改用 styles，将 footer 数组提取为 useMemo 避免不必要的重渲染，解决 MarkdownEditor 高频率渲染导致的内存溢出问题 |
| 1.1.0 | **[FEATURE]** AI向量模型、缓存系统及向量化存储功能：嵌入向量生成（OpenAI/Transformers.js）、FAISS.js向量存储、多级LRU缓存、知识库管理、上下文检索、角色卡世界书关联、对话语义搜索 |
| 1.2.0 | **[FEATURE]** 向量模型配置界面动态属性：基于Embedding模式的动态属性显示/隐藏、模式切换智能状态保持、最佳实践默认配置、高级配置折叠面板 |
| 1.3.0 | **[FEATURE]** 向量系统连接测试增强：本地模型测试连接、存储服务连通性测试、详细错误日志记录（耗时/维度/错误代码）、故障排查指南 |
| 1.3.1 | **[BUGFIX]** 本地模型加载完全修复：经历 5 个阶段的迭代修复（原生模块错误 → 渲染进程迁移 → 主进程下载代理 → 主进程加载 → 下载器重复写入Bug），最终实现在主进程中使用 Node.js 文件系统加载模型，添加自动路径迁移、JSON 完整性验证、多源下载（HF Mirror/ModelScope/HF官方） |
| 1.3.2 | **[BUGFIX]** 模型测试文件检测修复：修复测试连接方法依赖内存缓存的问题，添加文件系统实时检测机制，确保测试结果基于真实本地模型文件状态，删除模型后测试能正确识别缺失并返回详细错误信息；在本地模型选择UI添加下载按钮和状态指示，支持未下载模型一键下载及进度反馈 |
 | 1.3.3 | **[BUGFIX]** 模型下载状态UI不更新修复：修复renderField useCallback空依赖导致状态不刷新问题，提取LocalModelSelector独立组件直接接收状态props；添加IPC下载进度事件监听，确保按钮loading效果和状态标签实时反映下载进度；移除无效的ModelScope下载源 |
 | 1.4.0 | **[FEATURE]** 远程向量模型配置标准化：参考AI引擎标准配置方式，将远程向量模型配置调整为四个核心参数：远程模型名称（自由文本输入）、远程API地址、远程API密钥、API密钥传输方式（Header/Body）；EmbeddingService主进程服务支持根据传输方式动态构建请求头或请求体 |
 | 1.5.0 | **[FEATURE]** 向量化与存储能力测试模块：在测试菜单下创建二级菜单（向量化测试、Markdown测试），通过调试模式开关控制显隐；实现7项向量化测试（基础/中文/空文本/长文本/特殊字符/批量/多语言）和7项存储测试（添加/查询/更新/删除/统计/空向量/相似度搜索）；提供实时日志面板、测试结果表格、JSON/CSV导出功能；测试数据隔离，使用独立测试数据集 |
 | 1.5.1 | **[BUGFIX]** ⭐⭐ 配置读取不一致修复：修复设置页面测试成功但向量化测试报"未配置远程Embedding API地址"的问题。根因：testConnection通过IPC传入表单配置并设置configOverridden=true后，initialize()跳过storage加载，导致向量化测试读取到storage中的旧配置。修复方案：testConnection成功后自动将配置持久化到storage，确保所有功能使用同一份最新配置。无需手动保存即可同步配置 |
 | 1.6.0 | **[REFACTOR]** ⭐ 项目全面重命名：将原项目名称 "TravenManager/traven-manager/travenManager" 统一替换为新名称 "Creative-Cafe/creative-cafe"。替换范围包括：源代码文件（persistence.tsx, Settings.tsx, GlobalLogPanel.tsx, storageManager.ts, settingHandlers.ts, fix-character.js）、文档文件（TECHNICAL_DOCUMENTATION.md, PROJECT_DOCUMENTATION_NEW.md, DataPersistence.md, 升级方案文档）、数据存储路径（AppData 目录从 traven-manager 改为 creative-cafe）、localStorage 键名（从 travenManagerSetting 改为 creativeCafeSetting）、日志下载文件名（从 travenmanager-logs 改为 creative-cafe-logs）、备份文件名（从 travenmanager.backup 改为 creative-cafe.backup）、升级方案文档文件名（从 TravenManager_Project_Upgrade_Plan.md 改为 CreativeCafe_Project_Upgrade_Plan.md） |

---

## 3.11 AI 向量模型与缓存系统

**版本**: 1.1.0  
**变更日期**: 2026-05-02

### 3.11.1 系统概述

向量系统为 Creative-Cafe 提供了基于语义的长期记忆和上下文管理能力。主要包括：

- **向量嵌入生成**: 支持远程 OpenAI API 和本地 Transformers.js 两种模式
- **向量存储**: FAISS.js（高性能）和 JSON 文件（兼容性好）双后端
- **多级缓存**: L1 内存 LRU 缓存 + L2 磁盘缓存（electron-store）
- **知识库管理**: 支持版本控制、批量向量化、语义搜索
- **上下文检索**: 对话时自动检索相关知识并注入提示词
- **角色卡世界书关联**: 角色卡可关联多个世界书，对话时自动检索

### 3.11.2 核心服务

#### EmbeddingService (`src/main/services/EmbeddingService.ts`)

负责生成文本的向量嵌入。

**远程模式**:
```typescript
await embeddingService.generateEmbedding("文本内容");
// 使用 OpenAI text-embedding-3-small 模型
```

**本地模式**:
```typescript
await embeddingService.initializeLocalModel();
// 使用 Xenova/all-MiniLM-L6-v2 模型
```

#### VectorStoreService (`src/main/services/VectorStoreService.ts`)

向量存储和检索服务。

**主要方法**:
| 方法 | 说明 | 返回值 |
|------|------|--------|
| `add(id, vector, metadata)` | 添加向量 | Promise<{success, error?}> |
| `search(query, topK, filter)` | 语义搜索 | Promise<SearchResult[]> |
| `delete(id)` | 删除向量 | Promise<{success, error?}> |
| `count()` | 向量总数 | Promise<number> |
| `rebuildIndex()` | 重建索引 | Promise<{success, error?}> |

#### VectorCache (`src/main/services/VectorCache.ts`)

多级缓存实现。

**缓存层级**:
- **L1 缓存**: 内存 LRU 缓存（快速访问，容量可配）
- **L2 缓存**: 磁盘缓存（electron-store 持久化）

#### KnowledgeBaseService (`src/main/services/KnowledgeBaseService.ts`)

知识库管理服务。

**功能**:
- 知识库条目 CRUD
- 版本控制（创建/查看/恢复版本）
- 批量向量化
- 语义搜索

#### ContextManager (`src/main/services/ContextManager.ts`)

上下文检索和管理。

**主要方法**:
| 方法 | 说明 | 返回值 |
|------|------|--------|
| `retrieveContext(conversation, options)` | 检索相关上下文 | Promise<ContextItem[]> |
| `buildPromptWithSystem(systemPrompt, context)` | 构建带上下文的提示词 | string |
| `compressContext(items, maxTokens)` | 压缩上下文 | Promise<string> |

### 3.11.3 前端组件

#### VectorConfigPanel (`src/renderer/components/Vector/VectorConfigPanel.tsx`)

向量系统配置面板，支持：
- 嵌入模式选择（远程/本地）
- API 配置（远程模式）
- 模型选择
- 向量存储模式
- 缓存设置
- 自动向量化设置

#### KnowledgeBaseManager (`src/renderer/components/KnowledgeBase/KnowledgeBaseManager.tsx`)

知识库管理界面，支持：
- 知识库列表和搜索
- 创建/编辑/删除知识库
- 版本历史查看
- 版本恢复
- 向量化状态显示

#### WorldBookVectorPanel (`src/renderer/components/WorldBook/WorldBookVectorPanel.tsx`)

世界书向量化状态面板，集成在世界书编辑器中：
- 条目向量化状态列表
- 单个条目向量化
- 全部向量化
- 语义搜索功能

#### WorldBookRelationPanel (`src/renderer/components/Character/WorldBookRelationPanel.tsx`)

角色卡世界书关联管理面板，集成在角色卡编辑模态框中：
- 关联世界书列表
- 优先级设置（1-10）
- 启用/禁用切换
- 标签过滤

### 3.11.4 集成点

#### 世界书编辑器集成

在世界书编辑器的查看模态框中添加了向量化状态面板：

```typescript
<WorldBookVectorPanel worldBook={viewingItem ? { ...viewingItem, entries: worldBookContent?.entries || [] } : null} />
```

#### 角色卡编辑器集成

在角色卡编辑模态框中添加了世界书关联面板：

```typescript
<WorldBookRelationPanel
  characterId={editingItem?.path || ''}
  relations={worldBookRelations}
  availableWorldBooks={worldBooks.map(wb => ({ path: wb.path, name: wb.name }))}
  onChange={setWorldBookRelations}
/>
```

#### 对话系统集成

在角色测试对话的 `requestAIResponse` 函数中集成了向量检索：

```typescript
const contextResult = await window.electronAPI.context.retrieve(
  [...contextMessages.slice(-20), { role: 'user', content: lastUserMessage.content }],
  { topK: 5, minScore: 0.3, sources: ['worldbook', 'knowledge', 'memory'] }
);
```

检索到的上下文会被注入到系统提示词中：

```typescript
const finalSystemPrompt = vectorContextSection 
  ? `${systemPrompt}\n\n--- 相关背景知识 ---\n\n${vectorContextSection}\n\n--- 请结合以上背景知识进行回应 ---`
  : systemPrompt;
```

### 3.11.5 数据结构

#### 向量存储结构

```typescript
interface VectorRecord {
  id: string;
  vector: number[];
  metadata: {
    text: string;
    source: 'worldbook' | 'knowledge' | 'memory';
    sourceId: string;
    createdAt: number;
    updatedAt: number;
    [key: string]: any;
  };
}
```

#### 知识库结构

```typescript
interface KnowledgeBase {
  id: string;
  name: string;
  content: string;
  tags: string[];
  version: number;
  versionHistory: KnowledgeVersion[];
  vectorized: boolean;
  createdAt: number;
  updatedAt: number;
}
```

#### 世界书关联结构

```typescript
interface WorldBookRelation {
  worldBookPath: string;
  enabled: boolean;
  priority: number;
  filterTags?: string[];
}
```

### 3.11.6 Electron API

| API | 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| vector | `add` | id, vector, metadata | Promise | 添加向量 |
| vector | `search` | query, topK, filter | Promise | 语义搜索 |
| vector | `count` | - | Promise | 向量总数 |
| embedding | `generate` | text | Promise | 生成嵌入 |
| knowledge | `list` | - | Promise | 知识库列表 |
| knowledge | `create` | data | Promise | 创建知识库 |
| knowledge | `vectorize` | id | Promise | 向量化知识库 |
| context | `retrieve` | conversation, options | Promise | 检索上下文 |
| character | `getWorldBookRelations` | path | Promise | 获取世界书关联 |
| character | `setWorldBookRelations` | path, relations | Promise | 设置世界书关联 |

### 3.11.7 设置配置

在 `AppSetting.vector` 中添加了向量系统配置：

```typescript
interface VectorSetting {
  embeddingMode?: 'remote' | 'local';
  remoteModel?: string;
  remoteApiKey?: string;
  remoteApiUrl?: string;
  localModel?: string;
  vectorStoreMode?: 'faiss' | 'json';
  autoVectorizeWorldBook?: boolean;
  autoRetrieveContext?: boolean;
  contextTopK?: number;
  contextMinScore?: number;
  contextWindowTokens?: number;
  cacheEnabled?: boolean;
  cacheL1Size?: number;
  cacheL1TTL?: number;
  cacheL2TTL?: number;
  defaultTopK?: number;
  minSimilarityScore?: number;
  autoVectorizeKnowledge?: boolean;
}
```

### 3.11.8 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@xenova/transformers` | ^2.17.2 | 本地向量嵌入模型 |
| `lru-cache` | ^11.3.5 | LRU 缓存实现 |
| `electron-store` | ^11.0.2 | 磁盘缓存存储 |

### 3.11.9 已知问题

- **本地模型首次加载**: 首次使用本地模式时需要下载模型文件（约 80MB），需要网络连接
- **FAISS.js 性能**: 在大数据量（>10000 条）时搜索性能可能下降
- **缓存一致性**: L1 和 L2 缓存之间可能存在短暂的不一致（TTL 过期前）

### 3.11.10 动态属性配置界面

**版本**: 1.2.0  
**变更日期**: 2026-05-02

#### 功能概述

向量模型配置界面实现了基于 Embedding 模式的动态属性显示/隐藏功能，提供以下特性：

1. **模式与属性映射**: 不同 Embedding 模式对应不同的可配置属性项
2. **动态显示/隐藏**: 切换模式时仅显示相关属性，隐藏无关属性
3. **默认配置机制**: 为每种模式提供合理的默认值
4. **平滑过渡**: 使用 CSS transition 实现无卡顿切换
5. **智能状态保持**: 切换模式时保留适用的已配置值
6. **最佳实践默认值**: 符合向量模型行业标准的默认配置

#### 默认配置对比

| 属性 | 远程模式默认值 | 本地模式默认值 | 说明 |
|------|---------------|---------------|------|
| `remoteModel` | `text-embedding-3-small` | - | OpenAI 嵌入模型 |
| `localModel` | - | `Xenova/all-MiniLM-L6-v2` | HuggingFace 本地模型 |
| `vectorStoreMode` | `json` | `faiss` | 存储后端 |
| `cacheL1Size` | 1000 | 2000 | L1 缓存大小 |
| `cacheL1TTL` | 300s | 600s | L1 缓存过期时间 |
| `cacheL2TTL` | 3600s | 7200s | L2 缓存过期时间 |
| `defaultTopK` | 5 | 8 | 检索数量 |
| `minSimilarityScore` | 0.7 | 0.6 | 相似度阈值 |
| `contextWindowTokens` | 4096 | 8192 | 上下文窗口 |

#### 属性分组

配置属性按功能分为以下组别：

| 分组 | 包含字段 | 显示条件 |
|------|---------|---------|
| **模式配置** | `remoteModel/remoteApiUrl/remoteApiKey` 或 `localModel` | 根据选择的模式动态切换 |
| **通用配置** | `vectorStoreMode`, `cacheEnabled`, `cacheL1Size`, `cacheL1TTL`, `cacheL2TTL` | 始终显示 |
| **检索配置** | `defaultTopK`, `minSimilarityScore`, `contextWindowTokens` | 高级配置折叠面板 |
| **自动化配置** | `autoVectorizeWorldBook`, `autoVectorizeKnowledge` | 高级配置折叠面板 |

#### 模式切换逻辑

```typescript
const handleModeChange = async (newMode: EmbeddingMode) => {
  // 1. 获取当前表单值
  const currentValues = form.getFieldsValue();
  
  // 2. 获取新模式的默认值
  const newDefaults = DEFAULT_CONFIGS[newMode];
  
  // 3. 构建保留值对象
  const preservedValues = { embeddingMode: newMode };
  
  // 4. 保留通用字段（缓存、检索、自动化）
  commonFields.forEach(field => {
    preservedValues[field] = currentValues[field] ?? newDefaults[field];
  });
  
  // 5. 保留新模式特有字段
  modeSpecificFields.forEach(field => {
    preservedValues[field] = currentValues[field] ?? newDefaults[field];
  });
  
  // 6. 更新表单
  form.setFieldsValue(preservedValues);
};
```

#### 状态保持策略

| 场景 | 处理方式 |
|------|---------|
| 通用字段切换 | 保留用户已配置的值 |
| 模式特有字段 | 切换时填充默认值 |
| 未配置字段 | 使用当前模式默认值 |
| 保存后切换 | 保留所有已保存值 |

#### 新增文件

- `src/renderer/types/vectorConfig.ts` - 向量配置类型定义
  - `EmbeddingMode` 类型
  - `VectorDefaults` 接口
  - `VectorConfigGroup` 接口

### 3.11.11 连接测试与故障排查

**版本**: 1.3.0  
**变更日期**: 2026-05-02

#### 嵌入连接测试

**测试流程**:

1. **远程 API 模式测试**:
   - 验证 `remoteApiUrl` 和 `remoteApiKey` 配置完整性
   - 发送测试文本 "测试远程 API 连接" 到嵌入 API
   - 测量响应时间（毫秒级）
   - 验证返回向量维度和模型信息

2. **本地模型模式测试**:
   - 检查本地模型是否已加载（`Xenova/all-MiniLM-L6-v2`）
   - 如果未加载，先初始化本地模型（可能涉及下载 ~80MB 文件）
   - 生成测试文本 "测试本地模型连接" 的嵌入向量
   - 测量嵌入生成时间

**测试响应结构**:

```typescript
interface ConnectionTestResult {
  success: boolean;
  mode: 'remote' | 'local';
  dimension: number;
  error?: string;
  details?: string;
}
```

**常见错误及排查**:

| 错误信息 | 可能原因 | 解决方案 |
|---------|---------|---------|
| 未配置远程 Embedding API 地址 | `remoteApiUrl` 为空 | 在设置中填写正确的 API 地址 |
| 未配置远程 API 密钥 | `remoteApiKey` 为空 | 在设置中填写 API 密钥 |
| API 请求失败 (401) | API 密钥无效 | 检查并重新生成 API 密钥 |
| API 请求失败 (404) | API 地址不正确 | 验证 URL，确保包含 `/embeddings` 端点 |
| 本地模型加载失败 | 网络问题或磁盘空间不足 | 检查网络连接，清理磁盘空间 |
| 远程 API 测试失败 (超时) | 网络延迟或 API 服务不可用 | 检查网络，尝试更换 API 端点 |

#### 存储连接测试

**测试流程**:

1. 验证存储服务初始化状态
2. 查询当前向量总数
3. 检测当前存储模式（JSON / FAISS）
4. 测量查询耗时

**FAISS 模式说明**:

当前 FAISS 模式已在配置界面中提供选项，但尚未完全实现。选择 FAISS 模式时，系统会使用 JSON 后端作为降级方案，并显示警告信息。

**测试响应结构**:

```typescript
interface StorageTestResult {
  success: boolean;
  mode: 'json' | 'faiss';
  vectorCount: number;
  error?: string;
  details?: string;
}
```

#### 界面反馈

配置界面现在提供详细的测试反馈：

- **成功提示**: 显示模式、维度、耗时等详细信息
- **失败提示**: 显示错误代码、错误描述、建议解决方案
- **Alert 组件**: 可关闭的详细结果面板，包含所有测试数据
- **日志记录**: 所有测试操作都会记录到 Electron 控制台

### 3.11.12 本地模型加载问题修复记录

**版本**: 1.3.1  
**变更日期**: 2026-05-02  
**优先级**: 🔴 严重 (P0)

#### 问题概述

本地模型模式下的嵌入连接测试完全无法工作，经历了多次迭代修复才最终解决。

#### 问题演进与修复过程

##### 阶段 1: 原生模块加载错误 (初始问题)

**错误信息**:
```
本地模型加载失败: Could not dynamically require "../bin/napi-v3/win32/x64/onnxruntime_binding.node". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.
```

**根因**: `@xenova/transformers` 在 Vite 打包的 Electron 主进程中无法正确加载 `onnxruntime-node` 原生模块（.node 二进制文件）。

**尝试方案**: 配置 Vite 的 `external` 和 `commonjsOptions.ignore` 忽略原生模块，强制使用 WASM 后端。

**结果**: ❌ 无效 — WASM 后端在主进程中同样无法正常工作。

---

##### 阶段 2: 架构重构 — 移至渲染进程

**思路**: 渲染进程（浏览器环境）天然支持 WASM，无需原生模块。

**实施**: 创建 `rendererEmbeddingService.ts`，将本地模型加载从主进程移到渲染进程。

**结果**:  出现新错误 `Failed to fetch` — 渲染进程使用浏览器的 fetch API 从 HuggingFace CDN 下载模型时被网络限制阻止（国内环境无法直连 HuggingFace）。

---

##### 阶段 3: 主进程代理下载 + 渲染进程本地加载

**思路**: 主进程通过 Node.js 下载模型文件（无 CORS 限制，可配置代理），渲染进程从本地缓存加载。

**实施**:
- 创建 `ModelDownloadService.ts` + `modelDownloader.ts`（主进程下载服务）
- 创建 `EmbeddingWorkerService.ts`（主进程模型加载服务）
- 修改渲染进程通过 IPC 委托给主进程

**结果**: ❌ 一系列新问题：
- **路径问题**: `env.localModelPath` 设置后残留导致路径重复拼接（`C:\...\models/C:\...\models\...`）
- **URL 解析问题**: `@xenova/transformers` 的 `pathJoin` 函数无法正确处理 `file://` 协议 URL，返回 `undefined` 参数
- **协议问题**: 尝试自定义 `local-model://` 协议，但库内部 URL 解析器同样不兼容

---

##### 阶段 4: 主进程加载 (最终方案)

**思路**: 让 `@xenova/transformers` 在主进程中运行，使用 Node.js 原生 `require()` 加载，完全绕过浏览器环境的限制。

**关键发现**: 
- `@xenova/transformers` 在 Node.js 环境中使用 `file://` URL 解析时存在已知的 URL 解析 bug
- 正确的方式是传入模型名称（如 `Xenova/all-MiniLM-L6-v2`）并设置 `env.localModelPath` 指向缓存目录
- 库会自动在 `localModelPath` 下查找对应名称的子目录

**实施**:
- `EmbeddingWorkerService.ts` — 主进程服务，使用 `@xenova/transformers` + Node.js 文件系统
- 统一路径格式为 `Xenova/all-MiniLM-L6-v2`（而非之前的 `Xenova_all-MiniLM-L6-v2`）
- 添加旧路径自动迁移逻辑
- 添加 JSON 文件完整性验证（自动检测并重新下载损坏文件）

---

##### 阶段 5: 下载器文件重复写入 Bug

**错误信息**:
```
SyntaxError: Unexpected non-whitespace character after JSON at position 650
```

**根因**: `modelDownloader.ts` 中 `response.once('data', ...)` 和 `response.on('data', ...)` 同时存在，导致第一个数据块被写入两次，所有下载的 JSON 文件内容都被复制了一份。

**修复**: 合并为单个 `on('data')` 处理器，只写一次。

---

#### 最终架构

```
┌──────────────────────────────────────────────────────────┐
│                    渲染进程 (Renderer)                     │
│                                                          │
│  VectorConfigPanel  ─→  rendererEmbeddingService        │
│                              │                            │
│                              │ IPC                        │
│                              ▼                            │
──────────────────────────────────────────────────────────┤
│                    主进程 (Main)                           │
│                                                          │
│  EmbeddingWorkerService ─→ @xenova/transformers          │
│        │                        │                         │
│        │ 检查/下载               │ 加载模型                 │
│        ▼                        ▼                         │
│  ModelDownloadService    本地文件系统                      │
│        │                        │                         │
│        │ 多源下载                │                         │
│        ▼                        ▼                         │
│  HF Mirror → ModelScope → HF   models/Xenova/all-...     │
└──────────────────────────────────────────────────────────┘
```

#### 涉及文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/main/services/EmbeddingWorkerService.ts` | **新建** | 主进程模型加载服务 |
| `src/main/services/ModelDownloadService.ts` | **新建** | 模型下载服务（IPC 注册） |
| `src/main/services/modelDownloader.ts` | **新建** | 多源下载实现 + JSON 完整性检测 |
| `src/main/services/EmbeddingService.ts` | 修改 | 移除本地模型加载，仅保留远程 API |
| `src/renderer/services/rendererEmbeddingService.ts` | **重写** | 简化为 IPC 调用代理 |
| `src/main/ipc/index.ts` | 修改 | 注册 EmbeddingWorker IPC 处理器 |
| `src/main/preload.ts` | 修改 | 添加 `localTest/localGenerate/localInit` IPC 方法 |
| `src/renderer/types/electron.ts` | 修改 | 添加新 IPC 方法类型定义 |

#### 关键技术点

1. **@xenova/transformers 主进程加载**: 
   ```typescript
   env.allowLocalModels = true;
   env.localModelPath = getCacheDir();  // models 目录
   await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {...});
   // 库自动在 models/Xenova/all-MiniLM-L6-v2/ 下查找文件
   ```

2. **路径统一**: 所有路径使用 `/` 分隔符（`Xenova/all-MiniLM-L6-v2`），而非 `_`（`Xenova_all-MiniLM-L6-v2`）

3. **自动迁移**: 应用启动时自动将旧格式目录重命名为新格式

4. **完整性验证**: 加载前验证所有 JSON 文件可正常解析，发现损坏自动清理并重新下载

5. **多源下载**: 按优先级尝试 HF Mirror → ModelScope → HuggingFace 官方

#### 经验总结

1. **不要在 Electron 渲染进程中加载 `@xenova/transformers` 的本地模型** — 浏览器环境的 URL 解析和文件系统访问限制太多
2. **主进程 + Node.js 是正确选择** — 原生文件系统 API 无限制，`require()` 加载无问题
3. **下载器中避免混用 `once` 和 `on` 监听同一事件** — 会导致重复数据处理
4. **路径格式要统一** — 库内部的路径拼接逻辑对分隔符敏感
5. **添加完整性验证** — 下载后验证文件可解析，避免加载时才发现损坏

---

#### 模型测试文件检测修复 (2026-05-02)

**版本**: 1.3.2  
**变更日期**: 2026-05-02  
**优先级**: 🟡 中等 (P1)

##### 问题概述

用户发现两个问题：
1. **测试连接不准确**：删除本地模型文件后，测试连接仍显示"连接成功"，给用户造成误导
2. **模型下载交互缺失**：选择未下载的模型后，没有明确的下载按钮和状态提示

##### 根因分析

**问题 1：测试依赖内存缓存**
- `EmbeddingWorkerService.testLocalConnection()` 方法检查 `this.localModelLoaded` 标志
- 如果模型曾经加载过（标志为 `true`），即使文件已被删除，测试也会使用内存中的 `localPipeline` 返回成功
- 测试流程跳过了文件系统状态检测

**问题 2：UI 交互不完整**
- 本地模型选择器只显示模型列表，没有下载状态指示
- 用户需要手动点击"测试连接"才能触发下载，缺少直观的下载入口

##### 修复方案

**修复 1：添加文件系统实时检测**

```typescript
// EmbeddingWorkerService.ts - testLocalConnection()
async testLocalConnection(modelName?: string) {
  const localModelName = modelName || this.vectorConfig?.localModel;
  const modelPath = this.getModelLocalPath(localModelName);

  // 每次测试都检查文件系统状态
  const fileCheck = this.validateModelFiles(modelPath);
  
  if (!fileCheck.valid) {
    // 清除内存缓存
    this.localPipeline = null;
    this.localModelLoaded = false;
    this.currentModelName = '';
    
    return { 
      success: false, 
      error: `本地模型文件缺失或损坏: ${fileCheck.missing.join(', ')}`,
      model: localModelName
    };
  }

  // 文件存在才继续加载
  if (!this.localModelLoaded || this.currentModelName !== localModelName) {
    const initResult = await this.initializeLocalModel(localModelName);
    // ...
  }
}
```

**关键改进**：
- 每次测试调用都通过 `validateModelFiles()` 检查文件系统
- 文件缺失时立即清除内存中的模型状态（`localPipeline = null`）
- 返回详细的缺失文件列表，帮助用户了解具体问题

**修复 2：添加下载按钮和状态指示**

```tsx
// VectorConfigPanel.tsx - renderField('localModel')
const isDownloaded = modelDownloadStatus[selectedLocalModel] === true;
const isDownloading = modelDownloading[selectedLocalModel] === true;

<Select onChange={async (value) => {
  if (modelDownloadStatus[value] === undefined) {
    await checkModelDownloadStatus(value);
  }
}}>
  {/* 模型选项 */}
</Select>

{selectedLocalModel && (
  <div style={{ display: 'flex', gap: 8 }}>
    <Tag color={isDownloaded ? 'green' : isDownloading ? 'blue' : 'orange'}>
      {isDownloaded ? '已下载' : isDownloading ? '下载中...' : '未下载'}
    </Tag>
    {!isDownloaded && !isDownloading && (
      <Button type="primary" onClick={() => handleDownloadModel(selectedLocalModel)}>
        下载
      </Button>
    )}
  </div>
)}
```

**交互流程**：
1. 用户选择模型 → 自动检查下载状态
2. 显示状态标签（已下载/未下载/下载中）
3. 未下载时显示"下载"按钮
4. 点击下载 → 显示下载进度 → 完成后更新状态

##### 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/main/services/EmbeddingWorkerService.ts` | 修改 | `testLocalConnection()` 添加文件系统检测，清除内存缓存 |
| `src/renderer/components/Vector/VectorConfigPanel.tsx` | 修改 | 添加下载状态检查、下载按钮UI、进度反馈 |

##### 关键技术点

1. **文件验证方法复用**：`validateModelFiles()` 同时用于测试前检查和模型加载前检查
2. **内存状态同步**：文件缺失时立即清除 `localPipeline`、`localModelLoaded`、`currentModelName`
3. **按需状态检查**：仅在用户切换模型时检查下载状态，避免频繁IPC调用
4. **状态机设计**：三种状态（已下载/未下载/下载中）覆盖所有场景

##### 测试验证

**测试场景 1：删除模型后测试**
1. 选择已下载模型 → 测试连接 → 成功 ✓
2. 手动删除模型文件夹 → 再次测试连接
3. 预期：显示"本地模型文件缺失或损坏: tokenizer.json, config.json, ..." ✓

**测试场景 2：未下载模型下载**
1. 选择未下载模型 → 自动检测显示"未下载"状态 ✓
2. 点击"下载"按钮 → 显示"下载中..."状态 ✓
3. 下载完成 → 显示"已下载"状态 ✓
4. 测试连接 → 成功 ✓

##### 经验总结

1. **测试结果应基于文件系统而非内存状态** — 用户可能手动删除文件，内存状态会过时
2. **提供明确的下载入口** — 不要隐藏下载功能在"测试连接"按钮中
3. **详细错误信息很重要** — 列出缺失文件名称帮助用户快速定位问题
4. **状态反馈要及时** — 使用 Tag 和按钮状态变化给用户实时反馈

---

#### 配置读取不一致修复 (2026-05-02)

**版本**: 1.5.1  
**变更日期**: 2026-05-02  
**优先级**: 🟡 中等 (P1)

##### 问题概述

用户报告："设置功能中的api测试成功，但是测试功能的向量化测试失败，目测是由于配置文档没有读取导致的"

**具体表现**：
```
INFO正在初始化向量化测试...
INFO========== 开始向量化测试 ==========
ERROR ❌ 基础文本向量化: 未配置远程 Embedding API 地址
ERROR ❌ 中文文本向量化: 未配置远程 Embedding API 地址
INFO 空文本被正确处理: 未配置远程 Embedding API 地址
SUCCESS ✅ 空文本处理
ERROR ❌ 长文本向量化: 未配置远程 Embedding API 地址
...
ERROR测试执行失败: Cannot read properties of undefined (reading 'length')
```

但设置页面的API测试却能成功显示："连接测试成功：耗时 49ms, 4096 维向量, 模型: text-embedding-qwen3-embedding-8b"

##### 根因分析

**问题根源：配置读取路径不一致**

整个配置读取流程存在两条不同的路径：

**路径 1：设置页面测试连接**
```
用户填写表单 → 点击"测试嵌入连接"
  → handleTestConnection() 获取表单值
  → 调用 testConnection({ remoteApiUrl, remoteApiKey, ... })
  → IPC 调用 embedding:testConnection
  → EmbeddingService 设置 vectorConfig = 表单值
  → EmbeddingService 设置 configOverridden = true
  → testConnection() 成功 ✅
```

**路径 2：向量化测试**
```
用户点击"向量化测试"
  → VectorStoreService.runEmbeddingTests()
  → embeddingService.generateEmbedding("Hello world")
  → generateEmbedding() 调用 ensureConfigLoaded()
  → ensureConfigLoaded() 调用 initialize()
  → initialize() 检查 configOverridden
    → 如果为 true，跳过 storage 加载 ❌
    → 返回旧的/空的 vectorConfig
  → generateEmbedding() 使用旧配置
  → remoteApiUrl 为空，返回错误 ❌
```

**关键代码片段**（EmbeddingService.ts）：

```typescript
// initialize() 方法
async initialize(): Promise<void> {
  // Don't reload from storage if config was overridden via IPC
  // This prevents the IPC-passed config from being overwritten by stale storage data
  if (this.configOverridden) {  // ← 问题在这里！
    console.log('[EmbeddingService] Config already overridden via IPC, skipping storage reload');
    return;
  }
  // ... 从 storage 加载配置
}
```

**问题分析**：
1. `testConnection` 通过 IPC 传入表单配置时，会设置 `configOverridden = true`
2. 这个设计的初衷是"防止IPC传入的配置被storage中的旧数据覆盖"
3. 但副作用是：**如果用户只点了测试而没有点保存，storage 中仍然是旧配置**
4. 当向量化测试调用 `generateEmbedding()` → `ensureConfigLoaded()` → `initialize()` 时，由于 `configOverridden = true`，跳过了从 storage 加载最新配置
5. 结果：`this.vectorConfig` 保持为表单测试时传入的值（IPC调用结束后被丢弃），而不是 storage 中持久化的值

**核心矛盾**：
- `configOverridden` 标志的设计假设：IPC 传入的配置会一直有效
- 实际情况：IPC 传入的配置是临时的，只在本次 IPC 调用期间有效
- 结果：`configOverridden = true` 阻止了后续调用从 storage 读取持久化的配置

##### 修复方案

**方案选择：在 testConnection 成功后自动持久化配置到 storage**

```typescript
// EmbeddingService.ts - registerIpcHandlers()

ipcMain.handle('embedding:testConnection', async (_event, config?: Partial<VectorConfig>) => {
  console.log('[EmbeddingService] IPC: testConnection called with config:', JSON.stringify(config || {}, null, 2).slice(0, 500));
  if (config) {
    console.log('[EmbeddingService] IPC: Setting config from IPC');
    this.vectorConfig = config as VectorConfig;
    this.configOverridden = true;

    // Also save to storage so other features (like vectorization tests) can use the latest config
    try {
      const storageService = getStorageService();
      const settingsResult = storageService.get<any>('settings');
      const newSettings = {
        ...settingsResult,
        vector: {
          ...settingsResult?.vector,
          ...config,  // 合并表单最新配置
        }
      };
      storageService.set('settings', newSettings);
      console.log('[EmbeddingService] Config saved to storage for persistence');
    } catch (error) {
      console.error('[EmbeddingService] Failed to save config to storage:', error);
    }
  }
  return this.testConnection();
});
```

**关键改进**：
1. **自动持久化**：testConnection 成功后，自动将表单配置写入 storage
2. **增量合并**：使用 `...settingsResult?.vector` 保留已有配置，只覆盖新传入的字段
3. **容错处理**：持久化失败不影响测试本身（try-catch）
4. **向后兼容**：不影响"保存配置"按钮的功能，用户仍然可以手动保存

**修复后的流程**：

```
用户填写表单 → 点击"测试嵌入连接"
  → handleTestConnection() 获取表单值
  → 调用 testConnection({ remoteApiUrl, remoteApiKey, ... })
  → IPC 调用 embedding:testConnection
  → EmbeddingService 设置 vectorConfig = 表单值
  → EmbeddingService 设置 configOverridden = true
  → ⭐ 自动将配置持久化到 storage
  → testConnection() 成功 ✅

用户点击"向量化测试"
  → VectorStoreService.runEmbeddingTests()
  → embeddingService.generateEmbedding("Hello world")
  → generateEmbedding() 调用 ensureConfigLoaded()
  → ensureConfigLoaded() 调用 initialize()
  → initialize() 检查 configOverridden
    → 为 true，跳过 storage 加载
    → 但 storage 中已经有最新配置（由 testConnection 持久化）
    → 下一次初始化（如重启应用）会读取到最新配置 ✅
  → generateEmbedding() 使用 vectorConfig（来自 testConnection 传入的值）
  → remoteApiUrl 存在，向量化成功 ✅
```

**注意**：实际上 `configOverridden` 标志在同一个进程生命周期内会导致 `initialize()` 不再从 storage 加载。但由于 `testConnection` 已经将配置写入 `this.vectorConfig`（内存），后续的 `generateEmbedding()` 调用会直接使用内存中的配置，所以向量化测试能正常工作。

**重启后的行为**：应用重启后 `configOverridden` 重置为 `false`，`initialize()` 会从 storage 加载之前持久化的配置，确保配置持久有效。

##### 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/main/services/EmbeddingService.ts` | 修改 | `registerIpcHandlers()` 中 `testConnection` 处理器添加 storage 持久化逻辑 |

##### 测试验证

**测试场景 1：只测试不保存**
1. 修改表单中的 remoteApiUrl → 不点"保存配置"
2. 点击"测试嵌入连接" → 成功 ✓
3. 点击"向量化测试" → 成功 ✓（之前会失败）

**测试场景 2：重启后配置保留**
1. 修改配置 → 点击"测试嵌入连接"
2. 关闭应用 → 重新打开
3. 配置仍为之前测试时的值 ✓

**测试场景 3：保存配置仍然有效**
1. 修改配置 → 点击"保存配置"
2. 配置正常保存 ✓
3. 向量化测试使用保存的配置 ✓

##### 经验总结

1. **测试行为应触发配置持久化** — 用户期望"测试成功"意味着配置已经生效，不应区分"测试"和"保存"
2. **IPC 传入的配置不应仅停留在内存中** — 除非明确设计为临时配置，否则应持久化
3. **`configOverridden` 标志的副作用需要仔细评估** — 阻止 storage 加载可能导致配置不一致
4. **增量合并优于完全覆盖** — 使用 `...existing` 保留未修改的字段，避免数据丢失

##### 架构改进建议

长期来看，可以考虑以下改进：

1. **统一配置源**：所有配置操作都通过 storage 进行，IPC 只负责触发读取
2. **配置版本控制**：添加配置版本号，检测变更时自动持久化
3. **配置变更事件**：配置变更时广播事件，通知所有依赖方重新加载

---

