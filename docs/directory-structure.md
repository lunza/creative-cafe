# 项目目录分区规范

> 本文件定义 creative-cafe 的目录分区、各目录用途与存放规范。
> 配套 `.gitignore` 使用：凡「跟踪策略 = 忽略」的目录，克隆后不存在，由运行时自动创建。
> 原则：**根目录不再堆放分区归属明确的文件**——任何新文件必须先判断它属于哪一区。

## 总览（六区）

```
creative-cafe/
├── 代码区        src/  scripts/  android-client/
├── 文档区        docs/  README.md  CHANGELOG.md  CODE_WIKI.md  AGENTS.md
├── 数据区        appData/  database/  models/  data/  knowledge_base/
├── 日志区        logs/
├── 临时区        tmp/
└── 测试数据区    scripts/test-output/
```

## 1. 代码区（跟踪）

| 目录/文件 | 用途 |
|---|---|
| `src/main/` | Electron 主进程：服务、IPC handler、preload、工具 |
| `src/renderer/` | 渲染层：React 组件、hooks、页面 |
| `src/shared/` | 主/渲染共享类型与工具 |
| `scripts/` | 构建辅助与开发脚本（图标生成、提示词优化、冒烟测试等） |
| `android-client/` | Android 聊天客户端（React Native，独立 package.json） |
| `package.json` / `package-lock.json` | 依赖声明与锁定（**lock 必须入库**，保证克隆后 `npm ci` 可复现安装） |
| `tsconfig.json` / `vite.config.ts` / `vitest.config.ts` / `vitest.debug.*` | 编译、构建、测试配置 |
| `electron-builder.json` | 打包配置 |
| `.eslintrc.js` / `.prettierrc.js` | 代码风格配置 |
| `start.bat` / `start.sh` | 一键启动脚本 |

**规范**：源码只进 `src/`；一次性调试脚本不落在根目录（见临时区）。

## 2. 文档区（跟踪）

| 目录/文件 | 用途 |
|---|---|
| `docs/` | 项目文档：用户手册、设计文档、API 文档、测试报告 |
| `docs/debug/` | 调试与缺陷分析报告 |
| `docs/ai-scenarios/` | AI 场景清单与测评题库 |
| `docs/werewolf-game/` | 狼人杀游戏设计文档系列 |
| `README.md` | 项目入口说明 |
| `CHANGELOG.md` | 版本变更日志 |
| `CODE_WIKI.md` | 代码 wiki |
| `AGENTS.md` | AI 代理工作区规则 |

**规范**：新文档按主题归入 `docs/` 子目录，不散落根目录。

## 3. 数据区（忽略，运行时创建）

| 目录 | 用途 | 创建方 |
|---|---|---|
| `appData/` | dev 模式用户数据根（设置、角色、世界书、记忆、Agent 等，由 `%APPDATA%` 迁移而来） | `dataMigrationService` + 各数据服务 |
| `database/` | 活跃向量库（sqlite-vec，`database/vectors/...`） | `SqliteVecBackend` |
| `models/` | 本地嵌入/重排模型缓存（embedding-reranker 等） | `EmbeddingWorkerService` / `ModelDownloadService` |
| `data/` | 项目根数据（Dashboard tips.json 等，`fileService.getDataDir()`） | `fileService` |
| `knowledge_base/` | 知识库文档 | `KnowledgeBaseService` |

**规范**：代码路径一律经 `appPath.ts`（`getDataRoot` / `getDatabaseDir` / `getProjectRoot`）推导，禁止硬编码。数据区目录可整体删除重建（会丢用户数据，勿在生产环境删）。

## 4. 日志区（忽略）

| 目录 | 用途 |
|---|---|
| `logs/` | 运行日志，按模块分子目录（`logs/<module>/`） |

**规范**：日志只经 `logPathService.getLogDir()` / `getModuleLogDir()` 写入，禁止在根目录或其他位置落 `.log` 文件。

## 5. 临时区（忽略）

| 目录 | 用途 |
|---|---|
| `tmp/` | **所有**运行时临时产物唯一存放地：调试截图、UI 树 dump、tsc/eslint 错误快照、一次性脚本、中间 JSON |

**规范**：
- 任何临时文件（`.tmp-*`、`*.png` 调试截图、`*-errors*.txt`、一次性 `tmp-*.js`）只准写 `tmp/`，禁止落项目根
- `tmp/` 内容可随时整体清空，无任何保留价值
- 由 `.gitkeep` 占位保证目录存在

## 6. 测试数据区（忽略）

| 目录 | 用途 |
|---|---|
| `scripts/test-output/` | 测试脚本运行时输出（PNG / log 产物） |

**规范**：测试脚本的输出统一写这里，不进 `tmp/`（测试产物需要可追溯，临时产物不需要）。

## git 跟踪策略汇总

| 跟踪 | 忽略 |
|---|---|
| 代码区全部、文档区全部 | 数据区（appData/database/models/data/knowledge_base）、日志区（logs/）、临时区（tmp/）、测试数据区（scripts/test-output/） |
| | 依赖（node_modules）、构建产物（dist/build/release）、IDE 工作区（.trae/.dbg/.learnings/.vscode）、环境敏感（.env*/*.local/*.keystore）、OS 文件（Thumbs.db/.DS_Store） |
