# 安卓 AI 对话客户端（add-android-chat-client）Spec

## Why
用户希望在局域网（同一 WiFi）内用安卓手机与 creative-cafe 的 AI 角色对话。现有 creative-cafe 是 Electron 桌面应用，渲染进程与主进程通过 IPC 通信，**没有对外 HTTP API**，且对话管线（提示词构建、流式调用、情绪解析）运行在渲染进程中。因此需要：①在 Electron 主进程内嵌一个 LAN HTTP API 服务（含 headless 对话管线）；②新建一个纯客户端的 React Native 安卓应用。

已确认的方案决策：
- 服务端形态：**Electron 主进程内嵌 HTTP 服务**（复用现有服务层数据与配置，不新建独立进程）
- 客户端框架：**React Native**（与现有 React 代码风格一致）
- 构建环境：本机未安装 JDK/Android SDK，**授权自动安装**（JDK17 + Android cmdline-tools + SDK）
- V1 功能范围：**核心对话 + 表情立绘**（不含对话图片生成、表格编辑、RAG 增强等高级管线）

## What Changes
- **服务端（creative-cafe 仓库内）**
  - 新增 `src/main/services/lanApiServer/`：基于 Node 内置 `http` 的 LAN API 服务（不引入新 npm 依赖），提供角色卡、表情立绘、对话 SSE 流式等 REST 接口
  - 新增服务端 **headless 对话管线**：把渲染进程中与 DOM 无关的对话纯逻辑（提示词构建、上下文截断、情绪标签解析）抽取到可被主进程复用的位置，并在主进程完成 AI 引擎流式调用
  - 对话历史与服务端桌面端**共用同一存储**（characterChat 记录），保证两端历史一致
  - 主进程启动时自动开启 LAN API（默认端口 8787，端口/开关由服务端设置控制）
- **客户端（新目录 `android-client/`）**
  - React Native 工程：连接页、角色列表页（分类标签/搜索/下拉刷新）、对话页（历史加载、SSE 流式气泡、表情立绘切换、清空上下文）
  - 客户端**无任何功能配置项**：模型、提示词、生成参数全部由服务端决定；客户端仅保存服务器地址（连接信息，非功能配置）
  - UI 遵循 Material Design 3（react-native-paper）
- **交付物**
  - 源代码与构建配置（Gradle wrapper 等）
  - `docs/android-client.md`：构建说明 + API 调用说明 + 调试指南
  - debug 与 release APK
  - `docs/android-client-test-report.md`：功能测试报告
  - `CODE_WIKI.md`、`CHANGELOG.md` 增量更新（遵循用户规则：开发完成后增量更新技术文档）
- 无 **BREAKING** 变更：现有桌面端功能与数据结构不动（管线逻辑仅"抽取/复用"，不改变渲染进程行为）

## Impact
- Affected code:
  - `src/main/index.ts`（启动 LAN API 服务）
  - 新增 `src/main/services/lanApiServer/**`（HTTP 服务、路由、headless 对话管线）
  - 渲染进程对话管线纯逻辑抽取（`CharacterDialogueChat/PromptBuilder.ts`、ContextTruncator、`EMOTION_PROMPT_MAP` 等）→ 主进程可引用的共享模块
  - 复用（只读调用，不修改）：`characterHandlers`/`characterChatHandlers`/`expressionHandlers` 背后的服务层、AI 引擎配置（settingStore/electron-store）
  - 新增 `android-client/**`（React Native 工程）
  - 新增 `docs/android-client.md`、`docs/android-client-test-report.md`；更新 `CODE_WIKI.md`、`CHANGELOG.md`
- Out of scope（V1 明确不做）：对话图片生成、表格/世界书编辑、RAG 标签库增强、Agent 中心、mDNS 自动发现、公网访问与 HTTPS

## ADDED Requirements

### Requirement: R1 内嵌 LAN HTTP 服务
系统 SHALL 在 Electron 主进程内启动一个基于 Node 内置 `http` 的 API 服务，绑定 `0.0.0.0`，默认端口 8787，端口与启停开关由服务端设置控制；SHALL 提供以下接口（所有错误统一返回 JSON `{ error: { code, message } }`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态与版本，供连接测试 |
| GET | `/api/characters` | 角色卡列表（与桌面端 `character:list` 同源数据：id、名称、描述摘要、tags、头像 URL、spec 版本） |
| GET | `/api/characters/:id` | 角色卡详情（完整卡片数据） |
| GET | `/api/characters/:id/avatar` | 角色头像 PNG 二进制 |
| GET | `/api/characters/:id/expressions` | 表情清单（情绪键 → 立绘图片 URL，含 default/neutral） |
| GET | `/api/characters/:id/expressions/:emotion` | 指定情绪立绘二进制 |
| GET | `/api/chats/:characterId` | 该角色的历史消息（复用 characterChat 存储） |
| POST | `/api/chats/:characterId/messages` | 发送用户消息，响应为 SSE 流（事件：`chunk`/`emotion`/`done`/`error`） |
| POST | `/api/chats/:characterId/clear` | 清空该角色对话上下文（开新对话） |

#### Scenario: 服务启动
- **WHEN** Electron 应用启动且 LAN API 开关为开（默认开）
- **THEN** 主进程在 0.0.0.0:8787 监听，`GET /api/health` 返回 200 与版本信息

#### Scenario: 无效角色 ID
- **WHEN** 请求的 `:id` 不存在于角色卡目录（含路径穿越尝试）
- **THEN** 返回 404 `{ error: { code: "CHARACTER_NOT_FOUND" } }`，不泄露文件系统信息

### Requirement: R2 服务端 headless 对话管线
系统 SHALL 在主进程提供与服务端桌面端核心路径一致的对话处理：输入用户消息 → 构建提示词（角色卡主提示词 + 关联世界书注入 + 特征/表情 prompt + 上下文截断）→ 使用服务端当前启用的 AI 引擎配置流式调用 → SSE 推送增量文本 → 解析回复中的情绪标签并推送 `emotion` 事件 → 完整回复持久化到与桌面端相同的 characterChat 存储。

#### Scenario: 流式对话
- **WHEN** 客户端 POST 用户消息
- **THEN** SSE 依序推送多个 `chunk`（增量文本）、至多一个 `emotion`（解析出的情绪键）、一个 `done`（最终消息 id/时间戳），历史中新增 user+assistant 两条消息

#### Scenario: AI 调用失败
- **WHEN** AI 引擎请求超时或报错
- **THEN** SSE 推送 `error` 事件并正常结束响应，历史中不写入 assistant 消息，服务端不崩溃

#### Scenario: 桌面端历史一致
- **WHEN** 安卓端完成一轮对话后在桌面端打开同一角色对话
- **THEN** 桌面端能看到相同的消息历史（同一存储）

### Requirement: R3 客户端连接（无本地功能配置）
客户端 SHALL 仅提供服务器地址（host:port）输入与连接测试；SHALL 仅在本地保存最近一次成功连接的地址；SHALL NOT 提供任何模型、提示词、生成参数等功能设置（全部由服务端决定）。

#### Scenario: 连接成功
- **WHEN** 用户输入正确地址并点击测试
- **THEN** 调用 `/api/health` 成功后进入角色列表页，地址被记住，下次启动自动尝试

#### Scenario: 连接失败提示
- **WHEN** 地址不可达 / 超时 / 返回非 200
- **THEN** 显示可区分的错误提示（不可达 / 超时 / 版本不兼容），不进入列表页

### Requirement: R4 客户端角色列表
客户端 SHALL 展示与服务端同步的角色卡列表（Material 3 卡片：头像、名称、描述摘要、tags 标签）；SHALL 提供按名称/标签的即时搜索过滤（与桌面端一致的客户端过滤语义）；SHALL 支持下拉刷新重新同步；点击角色 SHALL 进入对话页。

#### Scenario: 搜索过滤
- **WHEN** 用户在搜索框输入关键词
- **THEN** 列表即时过滤出名称或 tags 命中的角色，空结果显示空态提示

### Requirement: R5 客户端对话
客户端 SHALL 在进入对话页时加载历史消息；发送消息后 SHALL 通过 SSE 流式接收并逐字更新 AI 气泡；收到 `emotion` 事件 SHALL 切换表情立绘（加载失败回退默认头像）；SHALL 支持清空上下文开新对话（调用服务端 clear）；流式失败 SHALL 显示错误与重试入口。

#### Scenario: 流式接收与立绘切换
- **WHEN** AI 回复流式返回且携带情绪标签
- **THEN** 气泡逐字增长，立绘切换为对应情绪图片，`done` 后消息定格并持久化

#### Scenario: 断线与重试
- **WHEN** 流式中网络中断或 SSE error
- **THEN** 气泡显示失败标记与"重试"按钮；重试重新发送该条消息

### Requirement: R6 稳定性与安全性
服务端 SHALL 对所有路径参数做白名单校验（防路径穿越）、设置请求超时；客户端 SHALL 实现连接超时（5s）、幂等 GET 自动重试 1 次、SSE 进行中断开自动结束并提示；文档 SHALL 注明仅限局域网使用、禁止暴露公网。

### Requirement: R7 交付物
SHALL 交付：①完整源代码与构建配置；②`docs/android-client.md`（构建、API 调用说明、调试指南）；③debug + release APK 及构建产出路径说明；④`docs/android-client-test-report.md` 功能测试报告；⑤`CODE_WIKI.md`/`CHANGELOG.md` 增量更新。

## REMOVED Requirements
无（纯新增能力）。
