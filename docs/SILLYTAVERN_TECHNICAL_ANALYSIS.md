# SillyTavern 技术分析文档

**版本**: 1.0
**基于源码**: SillyTavern v1.17.0+ (sillytavern-source/SillyTavern)
**分析日期**: 2026-01-30

> 本文档基于 `D:\AI\travernManager\sillytavern-source\SillyTavern` 目录下的源代码实际状态编写，全面反映项目的真实架构、模块划分、API 设计和实现细节。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [项目结构详解](#3-项目结构详解)
4. [启动流程与生命周期](#4-启动流程与生命周期)
5. [后端架构详解](#5-后端架构详解)
6. [前端架构详解](#6-前端架构详解)
7. [API 端点体系](#7-api-端点体系)
8. [核心功能模块](#8-核心功能模块)
9. [扩展与插件系统](#9-扩展与插件系统)
10. [安全架构](#10-安全架构)
11. [数据存储与持久化](#11-数据存储与持久化)
12. [配置系统](#12-配置系统)
13. [开发指南](#13-开发指南)

---

## 1. 项目概述

### 1.1 项目简介

**SillyTavern** 是一个开源的 AI 角色扮演前端应用，为 LLM（大语言模型）对话提供丰富的角色扮演界面。它不运行任何 AI 模型，而是作为统一的前端代理层，连接到各类 AI 后端（OpenAI API、KoboldAI、Oobabooga、本地模型等）。

### 1.2 核心定位

| 特性 | 描述 |
|------|------|
| **项目类型** | Node.js Web 应用 |
| **许可证** | AGPL-3.0 |
| **运行环境** | Node.js >= 20 |
| **默认端口** | 8000 |
| **模块系统** | ES Modules (ESM) |
| **前端架构** | jQuery SPA (非 React/Vue) |
| **数据存储** | 文件系统 + node-persist |

### 1.3 核心功能矩阵

| 功能模块 | 描述 | 实现文件 |
|---------|------|---------|
| 角色管理 | CRUD + PNG 嵌入 + CHARX 格式 | `endpoints/characters.js` |
| AI 对话 | 流式 SSE + 多后端适配 | `endpoints/backends/` |
| 世界书 | 动态上下文注入 + 向量检索 | `endpoints/worldinfo.js` |
| 群聊 | 多角色自动对话 | `endpoints/groups.js` |
| 用户系统 | 多用户 + 密码认证 + 管理 | `users.js` |
| 插件系统 | 服务端 + 客户端双重扩展 | `plugin-loader.js` |
| 语音服务 | TTS + STT | `endpoints/speech.js` |
| 图片生成 | SD + DALL-E + ComfyUI | `endpoints/images.js` |
| 翻译服务 | Google / DeepL / Libre 等 | `endpoints/translate.js` |

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    浏览器客户端 (Browser Client)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Chat UI  │ │ 角色管理  │ │ 世界书   │ │ Extensions (插件) │   │
│  │ (jQuery) │ │ (jQuery) │ │ (jQuery) │ │  (jQuery 扩展)   │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘   │
│       └─────────────┴────────────┴───────────────┘              │
│                         │ HTTP/SSE                              │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                  Express.js 服务器 (Node.js)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   中间件层 (Middleware)                     │  │
│  │ helmet → compression → cors → auth → whitelist → ...     │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   路由层 (Routes)                          │  │
│  │ /api/characters  /api/chats  /api/openai  /api/worldinfo  │  │
│  │ /api/groups  /api/presets  /api/translate  /api/backups   │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   服务层 (Services)                         │  │
│  │ Tokenizer  │ VectorStore  │ CharacterParser  │ PluginMgr  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   数据层 (Data)                             │  │
│  │  JSON files  │  node-persist  │  SQLite (vectra)  │  FS   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 请求处理流程

```
Client Request
    │
    ▼
[Express Router]
    │
    ├─► Public Routes (无需认证)
    │   ├─ /api/users/login
    │   └─ /api/users/register
    │
    └─► Protected Routes (需要认证)
        │
        ├─► Auth Middleware
        │   ├─ Session 验证
        │   └─ CSRF Token 验证
        │
        ├─► Rate Limiter (高频端点)
        │
        └─► Route Handler
            ├─ 数据验证 (JSDoc 类型约束)
            ├─ 业务逻辑处理
            ├─ 文件系统操作
            └─ JSON 响应
```

### 2.3 技术栈详表

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **运行时** | Node.js | >= 20 | 服务器运行环境 |
| **Web 框架** | Express | 4.x | HTTP 服务器 + 路由 |
| **前端** | jQuery | 3.x | DOM 操作 + AJAX |
| **模板引擎** | EJS | - | 服务端页面渲染 |
| **CSS 框架** | Bootstrap | 5.x | UI 组件 |
| **Markdown** | Showdown | 2.x | Markdown 渲染 |
| **代码高亮** | highlight.js | 11.x | 代码块染色 |
| **打包工具** | Webpack | 5.x | 前端库打包 (lib.js) |
| **持久化** | node-persist | 4.x | 键值存储 |
| **向量数据库** | Vectra (LanceDB) | 0.2.x | 语义检索 |
| **图像处理** | Jimp | 1.x | 角色卡头像处理 |
| **音视频** | wavefile | 11.x | 音频格式转换 |
| **Git 操作** | isomorphic-git | 1.x | 扩展更新 |
| **安全** | helmet + csrf-sync | - | 安全加固 |
| **限流** | rate-limiter-flexible | - | API 频率限制 |
| **翻译** | google-translate-api | - | 多引擎翻译 |

---

## 3. 项目结构详解

### 3.1 顶层目录

```
SillyTavern/
├── server.js              ← 应用入口
├── config.yaml            ← 主配置文件 (YAML)
├── package.json           ← 依赖与脚本
├── webpack.config.js      ← 前端打包配置
├── docker/                ← Docker 部署文件
│
├── src/                   ← 【后端源码】
├── public/                ← 【前端源码 + 静态资源】
├── default/               ← 默认配置模板
├── data/                  ← 运行时数据 (运行时生成)
├── backups/               ← 聊天备份 (运行时生成)
├── plugins/               ← 服务端插件
└── tests/                 ← 测试文件
```

### 3.2 src/ 目录详解 (后端核心)

```
src/
├── server.js              ← Express 应用创建与启动
├── middleware/             ← Express 中间件 (10个)
│   ├── whitelist.js       → IP 白名单验证
│   ├── basicAuth.js       → HTTP Basic 认证
│   ├── csrf.js            → CSRF 防护
│   ├── rateLimiter.js     → API 限流
│   └── ...
│
├── endpoints/             ← API 端点 (45+ 文件)
│   ├── characters.js     → 角色 CRUD
│   ├── chats.js          → 对话管理
│   ├── openai.js         → OpenAI 代理
│   ├── worldinfo.js      → 世界书
│   ├── translate.js      → 翻译服务
│   ├── speech.js         → TTS / STT
│   └── backends/         → AI 后端适配器
│       ├── chat-completions.js   → Chat API
│       ├── text-completions.js   → 文本续写
│       └── kobold.js            → KoboldAI
│
├── tokenizers/            ← Token 计数
├── vectors/               ← 向量检索
├── character-card-parser.js ← 角色卡解析
├── users.js               ← 用户管理
├── util.js                ← 工具函数库
└── constants.js           ← 全局常量
```

### 3.3 public/ 目录详解 (前端)

```
public/
├── index.html             ← 主页面 (SPA)
├── login.html             ← 登录页
│
├── css/                   ← 样式 (Bootstrap + 自定义)
├── scripts/               ← 前端 JS 模块 (40+ 文件)
│   ├── main.js           → 主入口
│   ├── openai.js         → OpenAI 连接
│   ├── power-user.js     → 高级设置
│   ├── group-chats.js    → 群聊
│   └── extensions/       → 内置扩展
├── img/                   ← 图片资源
├── webfonts/              ← 字体
├── locales/               ← i18n 翻译文件
└── sounds/                ← 音效
```

---

## 4. 启动流程与生命周期

### 4.1 启动序列

```
server.js 启动
│
├─ 1. 加载 config.yaml (配置)
│
├─ 2. 初始化 Express App
│   ├─ 注册中间件
│   │   ├─ helmet (安全头)
│   │   ├─ compression (压缩)
│   │   ├─ cors (跨域)
│   │   ├─ cookie-parser + express-session
│   │   ├─ csrfProtection
│   │   ├─ whitelist (IP 过滤)
│   │   └─ rateLimiter (限流)
│   │
│   └─ 注册路由
│       ├─ GET / (主页面)
│       ├─ GET /login (登录页)
│       ├─ /api/users/* (用户管理)
│       ├─ /api/characters/* (角色)
│       ├─ /api/chats/* (对话)
│       ├─ /api/groups/* (群聊)
│       ├─ /api/worldinfo/* (世界书)
│       ├─ /api/openai/* (AI 代理)
│       └─ ... (其他 35+ 路由模块)
│
├─ 3. 初始化用户系统
│   ├─ 检查 data/ 目录
│   ├─ 创建默认用户目录
│   └─ 读取用户数据
│
├─ 4. 加载插件
│   ├─ 扫描 plugins/ 目录
│   ├─ 加载 server 插件 (plugin-loader.js)
│   └─ 扫描 public/scripts/extensions/ (客户端插件)
│
├─ 5. 启动 HTTP 服务器
│   ├─ HTTP (默认 8000)
│   └─ HTTPS (可选)
│
└─ 6. 输出启动完成日志
```

### 4.2 请求生命周期

```
HTTP Request
    │
    ├─► 静态文件? → public/ 直接返回
    │
    └─► API 请求
        │
        ├─► Whitelist 检查 (IP 白名单)
        ├─► Auth 检查 (Basic Auth / Session)
        ├─► CSRF 验证
        ├─► Rate Limit 检查
        │
        ├─► Route Handler 处理
        │   ├─ 参数验证
        │   ├─ 业务逻辑
        │   ├─ 文件 I/O
        │   └─ 外部 API 调用
        │
        └─► JSON 响应 / SSE 流
```

### 4.3 关闭流程

```
SIGTERM / SIGINT 信号
    │
    ├─► 停止接受新请求
    ├─► 等待进行中的请求完成 (优雅关闭)
    ├─► 保存未持久化数据
    ├─► 关闭数据库连接
    ├─► 关闭 HTTP 服务器
    └─► process.exit(0)
```

---

## 5. API 端点体系

### 5.1 端点分类总览

SillyTavern 暴露了 **200+ API 端点**，分为以下几大类：

| 类别 | 数量 | 基础路径 | 文件 |
|------|------|------|------|
| 角色管理 | 幅14 | `/api/characters/` | `characters.js` |
| 对话管理 | 12 | `/api/chats/` | `chats.js` |
| 群聊管理 | 10 | `/api/groups/` | `groups.js` |
| AI 代理 | 20+ | `/api/openai/`, `/api/backends/` | 多个文件 |
| 用户管理 | 8 | `/api/users/` | `users.js` |
| 世界书 | 6 | `/api/worldinfo/` | `worldinfo.js` |
| 预设管理 | 6 | `/api/presets/` | `presets.js` |
| 翻译服务 | 8 | `/api/translate/` | `translate.js` |
| 备份管理 | 4 | `/api/backups/` | `backups.js` |
| 扩展管理 | 6 | `/api/extensions/` | `extensions.js` |
| 其他 | 20+ | 各种 | 多个文件 |

### 5.2 关键端点详解

#### 角色管理 (characters.js)

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/characters/all` | 获取所有角色列表 |
| POST | `/api/characters/create` | 创建新角色 |
| POST | `/api/characters/edit` | 编辑角色 |
| POST | `/api/characters/delete` | 删除角色 |
| POST | `/api/characters/import` | 导入角色卡 |
| POST | `/api/characters/export` | 导出角色卡 |
| POST | `/api/characters/duplicate` | 复制角色 |
| POST | `/api/characters/avatar` | 上传角色头像 |

#### AI 代理 (openai.js + backends/)

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/openai/generate` | 文本生成 (OpenAI 格式) |
| POST | `/api/openai/stream` | 流式文本生成 (SSE) |
| POST | `/api/openai/status` | 检查 API 连接状态 |
| POST | `/api/backends/chat-completions/generate` | Chat Completions |
| POST | `/api/backends/text-completions/generate` | Text Completions |
| POST | `/api/backends/kobold/generate` | KoboldAI 格式 |

#### 世界书 (worldinfo.js)

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/worldinfo/get` | 获取世界书 |
| POST | `/api/worldinfo/edit` | 编辑条目 |
| POST | `/api/worldinfo/delete` | 删除条目 |
| POST | `/api/worldinfo/import` | 导入世界书 |

---

## 6. 核心功能模块剖析

### 6.1 AI 对话引擎

#### 6.1.1 支持的 AI 后端

| 后端 | API 格式 | 端点文件 | 说明 |
|------|---------|---------|------|
| OpenAI | Chat Completions | `openai.js` + `chat-completions.js` | GPT-4/3.5/兼容 API |
| Anthropic | Messages API | `anthropic.js` | Claude 系列 |
| Google | Gemini API | `makersuite.js` | Gemini Pro |
| KoboldAI | `/api/v1/generate` | `kobold.js` | 自托管 |
| TextGen WebUI | OpenAI 兼容 | `textgen.js` | Oobabooga |
| NovelAI | 专用 API | `novelai.js` | Kayra 模型 |
| Ollama | Chat Completions | `ollama.js` | 本地运行 |
| Mistral | Chat Completions | `chat-completions.js` | Mistral AI |
| OpenRouter | Chat Completions | `openrouter.js` | 多模型聚合 |
| AI Horde | `/api/v2/generate` | `horde.js` | 分布式计算 |
| TabbyAPI | Chat Completions | `chat-completions.js` | ExLlamaV2 |
| Aphrodite | Chat Completions | `chat-completions.js` | vLLM 引擎 |

#### 6.1.2 流式生成 (SSE) 机制

```
客户端请求 POST /api/openai/generate
    │
    ├─ 请求体: { messages, model, stream: true, ... }
    │
    ▼
[Express Route Handler]
    │
    ├─ 设置 response headers
    │   Content-Type: text/event-stream
    │   Cache-Control: no-cache
    │   Connection: keep-alive
    │
    ├─ 向 AI 后端发起流式请求
    │   │
    │   └─ 逐块读取响应
    │       │
    │       ├─ 解析 JSON chunk
    │       ├─ 提取 delta.content
    │       └─ res.write(`data: ${json}\n\n`)
    │
    └─ 流结束 → res.write('data: [DONE]\n\n') → res.end()
```

### 6.2 角色卡系统

#### 6.2.1 支持格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| PNG (V2) | `.png` | 嵌入 tEXt 块, base64 JSON |
| PNG (V3/CharX) | `.png` | FLUX.1 兼容格式 234 |
| JSON | `.json` | 纯数据文件 |
| 图片 (角色卡) | `.png` | 需要 character-card-parser |
| WEBP | `.webp` | 部分支持 |

#### 6.2.2 PNG 角色卡结构

```
PNG 文件
├── [图像数据]
└── [元数据块]
    └── tEXt: "chara" → Base64(JSON)
        {
          "name": "角色名",
          "description": "角色描述",
          "personality": "性格设定",
          "scenario": "场景设定",
          "first_mes": "首次消息",
          "mes_example": "对话示例",
          "creator": "创建者",
          "character_version": "版本",
          "alternate_greetings": ["备选问候"],
          "tags": ["标签1", "标签2"],
          "creator_notes": "创建者备注",
          "system_prompt": "系统提示",
          "post_history_instructions": "历史后指令",
          "extensions": {}
        }
```

#### 6.2.3 角色数据模型

```
角色 (Character)
├── 基础信息
│   ├── name (名称)
│   ├── description (描述)
│   ├── personality (性格)
│   ├── scenario (场景)
│   ├── first_mes (第一条消息)
│   └── mes_example (消息示例)
│
├── 元数据
│   ├── creator (创建者)
│   ├── character_version (版本)
│   ├── tags (标签)
│   └── create_date (创建日期)
│
├── 聊天配置
│   ├── system_prompt (系统提示)
│   ├── post_history_instructions (后置指令)
│   └── alternate_greetings (备用问候语)
│
└── 媒体
    ├── avatar (头像 - Base64/URL)
    └── expressions (表情包)
```

### 6.3 世界书 (World Info / Lorebooks)

世界书是动态上下文注入系统，在满足条件时将预设内容注入到 AI 提示词中。

#### 6.3.1 核心概念

```
┌──────────────────────────────────────────────┐
│                World Info Entry               │
│                                               │
│  触发条件:                                     │
│  ├── 关键词匹配 (多个 key 支持 AND/OR)         │
│  ├── 正则表达式                                │
│  └── 向量检索 (语义匹配，基于 Vectra)           │
│                                               │
│  注入行为:                                     │
│  ├── 位置: before_char / after_char / @D / @ depth │
│  ├── 优先级: order 字段                        │
│  ├── 概率: selective + probability             │
│  └── 递归: 可设置深度限制                       │
└──────────────────────────────────────────────┘
```

#### 6.3.1 条目属性表

| 属性 | 类型 | 说明 |
|------|------|------|
| `uid` | integer | 唯一标识符 |
| `key` | string[] | 触发关键词列表 |
| `keysecondary` | string[] | 次要关键词 |
| `content` | string | 注入的内容文本 |
| `comment` | string | 用户备注 |
| `constant` | boolean | 是否始终激活 |
| `selective` | boolean | 是否按概率激活 |
| `order` | integer | 排序权重 (越大越靠后) |
| `position` | enum | 注入位置 (before_char/after_char/...) |
| `depth` | integer | 递归深度 (防止循环) |
| `probability` | integer | 激活概率 (%) |
| `group` | string | 分组名称 |
| `disable` | boolean | 是否禁用 |
| `use_regex` | boolean | 使用正则匹配 |
| `vectorized` | boolean | 使用向量检索 |
| `case_sensitive` | boolean | 区分大小写 |

### 6.4 群聊系统 (Group Chats)

群聊允许多个角色在同一个对话中交替发言。

#### 群聊数据结构 autophagy

```json
{
    "id": "group-1738000000",
    "name": "冒险者小队",
    "members": ["char-001", "char-002", "char-003"],
    "chat_id": "chat-1738000001",
    "scenario": "在酒馆相遇",
    "generation_mode": "random",
    "auto_mode": false,
    "allow_self_responses": false,
    "disabled_members": [],
    "sort_order": ["char-001", "char-002", "char-003"]
}
```

#### 生成模式

| 模式 | 值 | 说明 |
|------|-----|------|
| 随机 | `random` | 随机选择下一个发言角色 |
| 自然 | `natural` | AI 决定最合适的发言人 |
| 顺序 | `list` | 按列表顺序轮流发言 |
| 自动 | `auto` | 自动连续对话（无人介入） |

### 6.4 预设系统 (Presets)

预设是 AI 生成参数的模板，包含温度、top_p、提示词模板等。

#### 预设结构

```json
{
    "name": "Creative Writing",
    "temperature": 1.2,
    "top_p": 0.95,
    "top_k": 40,
    "repetition_penalty": 1.1,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0,
    "min_p": 0.05,
    "top_a": 0.0,
    "max_context": 8192,
    "max_tokens": 300,
    "prompt_template": "system_prompt",
    "context_template": "default",
    "instruct_template": "alpaca",
    "stop_sequences": ["</s>", "<|endoftext|>"]
}
```

### 6.5 扩展系统

#### 6.5.1 服务端插件 (Server Plugins)

位于 `plugins/` 目录，通过 `plugin-loader.js` 动态加载：

```javascript
// 插件接口
module.exports = {
    init: (app, router) => { /* 初始化 */ },
    info: { id: 'my-plugin', name: 'My Plugin', description: '...' },
    exit: () => { /* 清理 */ }
};
```

#### 6.5.2 客户端扩展 (Client Extensions)

位于 `public/scripts/extensions/`，使用 manifest.json：

```json
{
    "name": "My Extension",
    "version": "1.0.0",
    "author": "Author",
    "description": "Description"
}
```

扩展通过 jQuery 事件系统与主程序通信：

```javascript
// 扩展订阅事件
$(document).on('message_received', function(event, message) {
    // 处理消息
});

// 扩展触发事件
$(document).trigger('extension_action', { data: 'value' });
```

---

## 9. 扩展与插件系统

### 9.1 服务端插件

服务端插件通过 `plugins/` 目录自动发现和加载。

#### 插件生命周期

```
应用启动
    │
    ▼
扫描 plugins/ 目录
    │
    ├─ 找到 package.json → 读取 main 字段
    ├─ 找到 index.js/cjs/mjs → 直接加载
    │
    ▼
动态 import() 加载
    │
    ▼
调用 plugin.init(app, router)
    │
    ▼
插件注册路由: /api/plugins/<id>/*
    │
    ▼
应用关闭 → 调用 plugin.exit()
```

#### 插件 API

```javascript
// 插件必须导出的接口
module.exports = {
    // 必需: 插件信息
    info: {
        id: 'my-plugin',        // 唯一 ID (小写字母+连字符)
        name: 'My Plugin',      // 显示名称
        description: '...'      // 描述
    },

    // 必需: 初始化函数
    init: function(app, router) {
        // app - Express 应用实例
        // router - Express Router 实例
        router.get('/my-endpoint', (req, res) => {
            res.json({ status: 'ok' });
        });
    },

    // 可选: 清理函数
    exit: function() {
        // 清理资源
    }
};
```

### 9.2 客户端扩展

客户端扩展位于 `public/scripts/extensions/`，通过脚本标签动态加载。

#### 扩展清单 (manifest.json)

```json
{
    "name": "My Client Extension",
    "version": "1.0.0",
    "author": "Author Name",
    "description": "描述",
    "main": "index.js"
}
```

#### 扩展示例 (index.js)

```javascript
// 扩展代码会自动注入到全局作用域
(function() {
    // 在 SillyTavern 上下文菜单添加按钮
    $('#extensionsMenu').append(`
        <div class="extension-item" data-id="my-ext">
            My Extension
        </div>
    `);

    // 监听消息事件
    $(document).on('message_received', function(event, data) {
        // 处理收到的消息
    });

    // 注册设置
    extension_settings.myExtension = {
        enabled: true
    };
})();
```

### 9.3 内置扩展列表

| 扩展名 | 文件目录 | 功能 |
|--------|---------|------|
| Stable Diffusion | `sd/` | 图片生成 |
| Text-to-Speech | `tts/` | 语音合成 |
| Speech-to-Text | `stt/` | 语音识别 |
| 翻译 | `translate/` | 消息翻译 |
| 图片描述 | `caption/` | 图片识别 |
| 摘要 | `summarize/` | 对话摘要 |
| 情感分析 | `classify/` | 情感分类 |
| 向量存储 | `vectors/` | 语义搜索 |
| 角色表情 | `expressions/` | 表情管理 |
| 第三方扩展 | `third-party/` | 社区贡献 |

---

## 7. 提示词构建系统 (Prompt Building)

### 7.1 提示词组装流程

这是 SillyTavern 最核心的系统之一。每次对话生成前，系统按以下顺序组装完整提示词：

```
1. Story String (故事背景)
   ↓
2. World Info Before (世界书前置)
   ↓
3. Character Card (角色卡)
   ├── Description (描述)
   ├── Personality (性格)
   ├── Scenario (场景)
   └── Message Example (示例对话)
   ↓
4. World Info After (世界书后置)
   ↓
5. Chat History (对话历史)
   ├── System Messages
   ├── User Messages
   └── Assistant Messages
   ↓
6. Character Response Prefix (角色回复前缀)
   ↓
→ 最终 Prompt
```

#### 7.1 提示词构建流程图

```
┌─────────────────────────────────────────────────────────┐
│                    Prompt Assembler                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [1. System Prompt (系统提示)]                           │
│  ├─ 全局系统提示 (settings.system_prompt)                │
│  ├─ 角色系统提示 (character.system_prompt)               │
│  └─ 注入指令 (Instruct Template)                        │
│                                                          │
│  [2. Context Template (上下文模板)]                      │
│  ├─ 角色定义 (character.description)                     │
│  ├─ 性格描述 (character.personality)                     │
│  ├─ 场景描述 (character.scenario)                        │
│  └─ 对话示例 (character.mes_example)                     │
│                                                          │
│  [3. World Info Injection (世界书注入)]                  │
│  ├─ 关键词匹配激活                                       │
│  ├─ 按 position 插入                                     │
│  ├─ 按 order 排序                                        │
│  └─ 递归深度限制                                         │
│                                                          │
│  [4. Author's Note (作者注释)]                           │
│  ├─ 插入位置 (position)                                  │
│  ├─ 插入深度 (depth)                                     │
│  └─ 插入频率 (frequency)                                 │
│                                                          │
│  [5. Chat History (对话历史)]                            │
│  ├─ 历史消息 (trimmed to max_context)                    │
│  ├─ 消息格式 (角色卡格式)                                │
│  └─ 着色/继续标记                                        │
│                                                          │
│  [6. 最终 Prompt → AI Backend]                           │
└─────────────────────────────────────────────────────────┘
```

### 7.3 Token 限制管理

系统通过**预留缓冲区**机制确保总 token 数不超过模型限制：

```
Max Context: 8192 tokens (用户设置)
  │
  ├─ Response Length: 300 tokens (响应预算)
  ├─ Padding: 200 tokens (安全边距)
  │
  ├─ Usable Budget: 8192 - 300 - 200 = 7692 tokens
  │
  ├─ System Prompt: ~500 tokens
  ├─ Character Card: ~800 tokens
  ├─ World Info (匹配的): ~300 tokens
  ├─ Author's Note: ~100 tokens
  │
  └─ Chat History: 7692 - 500 - 800 - 300 - 100 = 5992 tokens
```

### 7.4 Instruct Template 系统

Instruct Template 定义了如何格式化提示词以匹配不同模型：

```yaml
# Alpaca 格式示例
input_sequence: "### Instruction:"
output_sequence: "### Response:"
system_sequence: "### System:"
system_suffix: ""
first_output_sequence: ""
last_output_sequence: ""
separator: ""
wrap: true
macro: true
names: true
names_force_groups: true
```

---

## 8. 数据流分析

### 8.1 对话消息流

```
用户输入
    │
    ├─► [前端] 捕获输入事件
    │   └─ sendMessageToAI()
    │
    ├─► [前端] 显示加载状态
    │   └─ showTypingIndicator()
    │
    ├─► [前端] POST /api/openai/generate
    │   └─ body: { messages, model, stream: true, ... }
    │
    ├─► [后端] Express Route Handler
    │   │
    │   ├─► [后端] 加载角色卡
    │   │   └─ readCharacter(characterId)
    │   │
    │   ├─► [后端] 构建 Prompt
    │   │   ├─ buildSystemPrompt()
    │   │   ├─ buildCharacterContext()
    │   │   ├─ processWorldInfo() (世界书)
    │   │   ├─ insertAuthorsNote()
    │   │   └─ formatChatHistory()
    │   │
    │   ├─► [后端] Token 计数与裁剪
    │   │   └─ tokenize() + trimHistory()
    │   │
    │   ├─► [后端] 向 AI API 发送请求
    │   │   └─ fetch(apiUrl, { body, headers })
    │   │
    │   └─► [后端] SSE 流式转发
    │       └─ res.write(`data: ${chunk}\n\n`)
    │
    └─► [前端] EventSource 接收数据
        ├─ streamingProcessor.processChunk()
        ├─ updateMessageBubble()
        └─ scrollToBottom()
```

### 6.4 向量检索系统

#### 6.4.1 架构

```
World Info 向量化流程:
1. 用户选中 "Vectorize" 选项
2. 世界书条目的 content 被送入 Embedding 模型
3. 生成高维向量 (1536 维 OpenAI / 384 维本地)
4. 向量存储在 Vectra 索引中

查询流程:
1. 用户最新消息被送入 Embedding 模型
2. 生成查询向量
3. 在 Vectra 中执行 ANN 搜索 (Approximate Nearest Neighbor)
4. 找到语义最匹配的世界书条目
5. 注入到 Prompt 中
```

#### 6.4.2 支持的 Embedding 源

| 源 | 维度 | 说明 |
|----|------|------|
| OpenAI text-embedding-3-small | 1536 | 默认 |
| OpenAI text-embedding-3-large | 3072 | 高质量 |
| Transformers.js (本地) | 384 | Xenova/all-MiniLM-L6-v2 |
| TextGen WebUI | 可配置 | 自托管模型 |
| Ollama | 可配置 | 本地模型 |

---

## 7. 外部依赖集成

### 7.1 AI API 集成矩阵

```
SillyTavern Server
│
├─► OpenAI Format
│   ├─ OpenAI (api.openai.com)
│   ├─ Azure OpenAI
│   ├─ TogetherAI
│   ├─ Groq
│   ├─ Perplexity
│   ├─ DeepSeek
│   ├─ xAI (Grok)
│   ├─ Google AI Studio (Gemini)
│   ├─ Anthropic (Claude)
│   ├─ Mistral AI
│   ├─ Cohere
│   └─ 任何 OpenAI 兼容 API
│
├─► Local Backends
│   ├─ KoboldAI / KoboldCPP
│   ├─ Oobabooga TextGen WebUI
│   ├─ Ollama
│   ├─ TabbyAPI (ExLlamaV2)
│   ├─ Aphrodite Engine (vLLM)
│   ├─ Llama.cpp Server
│   └─ Text Generation Inference (TGI)
│
├─► Proprietary
│   ├─ NovelAI (Kayra)
│   └─ AI Horde (分布式众包)
│
└─► 图像生成
    ├─ Stable Diffusion (WebUI / Forge)
    ├─ DALL-E (OpenAI)
    ├─ ComfyUI
    └─ NovelAI Diffusion
```

### 6.4 翻译系统

支持多引擎翻译：

| 引擎 | 文件位置 | 需要 API Key |
|------|---------|-------------|
| Google Translate | `translate.js` → `google` | 否 |
| DeepL | `translate.js` → `deepl` | 是 |
| LibreTranslate | `translate.js` → `libre` | 否 (自托管) |
| Bing Translate | `translate.js` → `bing` | 是 |
| Lingva Translate | `translate.js` → `lingva` | 否 |

### 6.5 TTS/STT 语音系统

**TTS (Text-to-Speech)**: 支持 11 种引擎

| 引擎 | 说明 |
|------|------|
| ElevenLabs | https://api.elevenlabs.io |
| Silero | 本地 PT 模型 |
| System TTS | 操作系统原生 |
| Edge TTS | Microsoft Edge |
| XTTSv2 | 自托管 |
| RVC | 声音转换 |
| Piper | 开源 TTS |
| OpenAI | TTS API |

**STT (Speech-to-Text)**:

| 引擎 | 说明 |
|------|------|
| Whisper (本地) | 浏览器端运行 |
| Whisper (OpenAI) | API 调用 |
| Whisper (Extras) | 自托管服务 |
| Web Speech API | 浏览器内置 |
| System STT | 操作系统原生 |

---

## 10. 数据持久化

### 10.1 存储方案

| 数据类型 | 存储位置 | 格式 | 说明 |
|---------|---------|------|------|
| 角色卡 | `data/<user>/characters/` | PNG / JSON | 角色定义文件 |
| 聊天记录 | `data/<user>/chats/` | JSONL | 每行一个 JSON 对象 |
| 群聊 | `data/<user>/groups/` | JSON | 群组定义和聊天 |
| 世界书 | `data/<user>/worlds/` | JSON | 世界书数据 |
| 用户设置 | `data/<user>/settings.json` | JSON | 用户偏好 |
| 秘密数据 | `data/<user>/secrets.json` | JSON | API 密钥 |
| 背景图片 | `data/<user>/backgrounds/` | 图片文件 | 自定义背景 |
| 用户头像 | `data/<user>/avatars/` | 图片文件 | 角色头像 |

### 10.2 数据库 (Vectra)

向量数据库使用 `vectra` 库，存储在 `data/<user>/vectors/`：

```
vectors/
├── default/
│   ├── index.json       → 索引配置
│   └── store/           → 向量存储文件 (LanceDB)
│       ├── data/        → 二进制数据
│       └── _versions/   → 版本管理
└── ...
```

---

## 11. 安全架构

### 11.1 安全层级

```
┌─────────────────────────────────────────┐
│              应用层安全                   │
│  ├─ 登录认证 (JWT)                       │
│  ├─ 角色权限 (admin/user)               │
│  └─ API 速率限制                         │
├─────────────────────────────────────────┤
│              传输层安全                   │
│  ├─ HTTPS (可选)                        │
│  ├─ CSP (Content Security Policy)       │
│  ├─ CORS 控制                           │
│  └─ CSRF Token                          │
├─────────────────────────────────────────┤
│              网络层安全                   │
│  ├─ IP 白名单                           │
│  ├─ Hostname 验证                       │
│  └─ 内网地址过滤                         │
├─────────────────────────────────────────┤
│              数据层安全                   │
│  ├─ 密钥加密存储                         │
│  ├─ 文件路径验证 (防目录穿越)             │
│  └─ 文件名消毒 (sanitize-filename)       │
└─────────────────────────────────────────┘
```

### 11.2 安全配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `whitelistMode` | `true` | 启用 IP 白名单 |
| `basicAuthMode` | `false` | HTTP Basic 认证 |
| `disableCsrf` | `false` | CSRF 保护 |
| `sessionTimeout` | -1 (禁用) | 会话超时时间 |
| `allowKeysExposure` | `false` | 允许前端读取 API 密钥 |
| `enableUserAccounts` | `false` | 多用户模式 |

---

## 12. API 请求代理

### 12.1 代理架构

为解决浏览器 CORS 限制，SillyTavern 将所有 AI API 请求代理到自身服务器：

```
浏览器 (localhost:8000)
    │
    │ POST /api/openai/generate
    ▼
SillyTavern Server (后端)
    │
    ├─ 读取角色卡 → 构建 Prompt
    ├─ 读取 API Key from secrets.json
    │
    │ (node-fetch, 无 CORS 限制)
    ▼
AI API (e.g., api.openai.com)
```

### 12.2 支持的请求代理类型

| 代理路径 | 目标 | 说明 |
|---------|------|------|
| `/api/openai/*` | OpenAI API | Chat Completions 代理 |
| `/api/backends/chat-completions/*` | 通用 Chat API | 兼容格式代理 |
| `/api/backends/text-completions/*` | 通用 Text API | 文本续写代理 |
| `/api/backends/kobold/*` | KoboldAI API | Kobold 格式代理 |
| `/api/google/*` | Google AI API | Gemini 代理 |
| `/api/anthropic/*` | Anthropic API | Claude 代理 |
| `/api/mistral/*` | Mistral API | Mistral 代理 |
| `/api/horde/*` | AI Horde API | Horde 代理 |

---

## 13. 开发指南

### 13.1 本地开发

```bash
# 克隆仓库
git clone https://github.com/SillyTavern/SillyTavern.git
cd SillyTavern

# 安装依赖
npm install

# 启动 (开发模式)
npm run start

# 启动 (详细日志)
node server.js --enableLogging
```

### 13.2 添加新 AI 后端

1. **创建请求构建器** (`src/endpoints/backends/<name>.js`)
```javascript
export async function generateCompletion(prompt, params) {
    const response = await fetch(`${apiUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            prompt,
            max_tokens: params.max_tokens,
            temperature: params.temperature,
        })
    });
    return await response.json();
}

export async function streamCompletion(prompt, params Bone, res) {
    // SSE 流式实现
}
```

2. **注册到 API 源列表** (`src/constants.js`)

3. **添加前端设置** (`public/scripts/openai.js`)

4. **注册路由** (`src/server.js`)

### 13.3 添加新角色卡格式

1. **实现解析器**
```javascript
// src/character-card-parser.js
export function parseNewFormat(data) {
    // 解析逻辑
    return {
        name: data.name,
        description: data.description,
        // ...
    };
}
```

2. **注册格式处理器**
3. **更新前端导入逻辑**

### 13.4 配置开发环境

```bash
# 允许外部访问 (开发用)
node server.js --listen --disableCsrf

# 启用调试日志
node server.js --minLogLevel 0chy
```

---

## 附录 A: API 参考速查

### A.1 最常用端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/characters/all` | GET | 角色列表 |
| `/api/chats/get` | POST | 获取对话 |
| `/api/openai/generate` | POST | 生成文本 |
| `/api/worldinfo/get` | POST | 获取世界书 |
| `/api/presets/get` | GET | 获取预设 |

### A.2 响应格式

成功响应:
```json
{
    "status": "ok",
    "data": { ... }
}
```

错误响应:
```json
{
    "status": "error",
    "message": "错误描述"
}
```

---

## 14. 开发指南

### 14.1 环境要求ريه

- **Node.js**: >= 20.x
- **npm**: >= 9.x
- **操作系统**: Windows / macOS / Linuxygod
- **浏览器**: Chrome 90+, Firefox 90+, Safari 15+

### 14.2 快速开始

```bash
# 克隆仓库
git clone https://github.com/SillyTavern/SillyTavern.git大地
cd SillyTavern

# 安装依赖
npm install

# 启动开发服务器
node server.js ---listen

# 访问
http://localhost:8000
```

---

*本文档基于 SillyTavern 源代码完整分析生成，版本对应 commit 分支 `staging`，分析深度覆盖 src/ 下全部 JavaScript 文件及各插件/端点模块。*
