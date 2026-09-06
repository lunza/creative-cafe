# 安卓对话客户端功能补全与布局修复（fix-android-chat-feature-parity）Spec

## Why

安卓客户端（add-android-chat-client V1）仅实现了最小对话闭环（纯文本 SSE + 表情立绘），与桌面端相比缺失用户人设、AI 参数配置、记忆表格、对话图片生成、知识库检索（RAG）五大功能模块；同时现有 UI 存在布局缺陷：立绘区固定高度裁切变形、键盘遮挡输入（RN 0.87 edge-to-edge 默认开启）、长文本溢出气泡、流式滚动抖动等，在小屏/大屏/横屏设备上表现异常。本变更补全功能差距并系统性修复布局，使安卓端达到"日常可用"的对等功能子集。

## 现状差距清单（调研结论）

### 功能缺失（安卓 V1 → 桌面端）
| 模块 | 桌面端实现 | 安卓 V1 | 存储位置 |
|---|---|---|---|
| 用户人设 | PersonaPanel 选择人设注入提示词 | ❌ 无 | 人设 JSON 文件（avatarService，主进程可读）；**选中项在渲染进程 localStorage** |
| AI 参数配置 | ConfigPanel（temperature/top_p/max_tokens/字数下限/语言/表情开关/图片尺寸等） | ❌ 无（仅用引擎级 temperature） | **渲染进程 localStorage（character-session-\<cardId\>）** |
| 记忆表格 | MemoryTablePanel：表格注入提示词 + AI 表格编辑指令 + 查看/编辑 | ❌ 无 | memoryService（主进程，`window.electronAPI.memory.*`） |
| 对话图片生成 | executeImageGeneration：特征标签+情绪动态标签+LoRA→SD 生成→素材落盘→气泡附属 | ❌ 无 | 特征/LoRA/素材均在磁盘（主进程可读）；**编排逻辑在渲染进程** |
| 知识库检索 | 对话历史 RAG（chatHistory.retrieve）+ 知识库绑定检索（context.retrieveWithKeywords） | ❌ 无 | 主进程服务可直接复用 |

### 布局问题（代码审查定位）
| # | 表现 | 根因 | 位置 |
|---|---|---|---|
| L1 | 立绘图裁切/压缩变形（尺寸异常） | `portraitWrap` 固定 `height:180` + `resizeMode:'cover'`，不同宽高比图片被强制裁切 | ChatScreen.tsx L351 |
| L2 | 键盘弹出遮挡输入框/消息（位置偏移） | RN 0.87 默认启用 edge-to-edge，`windowSoftInputMode=adjustResize` 失效，且 `KeyboardAvoidingView` 在 android 上 `behavior=undefined` 等于没配 | ChatScreen.tsx L269-272 / AndroidManifest |
| L3 | 长文本/长 URL 溢出气泡（尺寸异常） | RNText 无换行约束配置（缺 `flexShrink`/`breakStrategy`），连续无空格串不折行 | ChatScreen.tsx L214 |
| L4 | 流式输出时列表高频跳动（元素重叠感） | 每个 chunk 触发 `onContentSizeChange → scrollToEnd`，无节流 | ChatScreen.tsx L143/L293 |
| L5 | 小屏气泡占比过大 / 横屏气泡过窄（尺寸异常） | 气泡 `maxWidth:'82%'` 固定比例，未按屏宽分档 | ChatScreen.tsx L365 |
| L6 | 情绪徽章压在立绘主体上（重叠） | 徽章 `position:absolute` 贴边，无内容避让 | ChatScreen.tsx L253-266 |

## What Changes

### 服务端（src/main/services/lanApiServer/）
- 新增 LAN 会话配置存储：主进程 JSON 文件（每角色一份，`{userData}/data/lan-session-config/`），含人设选择、AI 参数子集、知识库绑定、记忆表格开关。**不迁移、不读取桌面端 localStorage（双源并存，文档注明差异）**
- `dialogue.ts` 管线增强：人设注入（复用 PromptBuilder 用户人设段）、会话参数生效（temperature/top_p/max_tokens/min_response_chars 字数约束/language/expression_display 开关/自定义停止序列）、RAG 注入（对话历史向量检索 + 知识库绑定检索，失败不阻塞）、记忆表格注入与 AI 表格编辑指令执行
- 新增 headless 图片生成管线：读角色特征 traits.json + LoRA + 父消息情绪动态表情标签（EMOTION_PROMPT_MAP，对齐 §7.43 修复逻辑）+ interaction_weight → 调用主进程 SD 服务 → 素材落盘 → 更新消息 imageAttachment 并持久化
- 新增/扩展 REST 端点与 SSE `table` 事件（详见 ADDED Requirements）

### 客户端（android-client/）
- 对话页新增：会话配置底部弹层（人设选择/参数/知识库绑定/表格开关）、图片气泡（展示/重新生成/历史版本切换/查看大图/失败重试）、记忆表格查看弹层
- 布局系统性修复（L1–L6）+ `useWindowDimensions` 响应式适配
- 重新构建 APK 并交付测试报告

### 明确不做（V2 范围边界）
- ❌ 不改动桌面端任何行为/存储（双端会话配置互不同步，各自独立）
- ❌ AI 标签优化 `ai_optimize_traits` 不移植（图片生成响应中标记 `unsupported`）
- ❌ 记忆表格模板管理、异步自动整理不移植（仅保留：开关 + 注入 + AI 编辑指令执行 + 查看）
- ❌ 图片标签审计面板（usedTags/usedPrompt 快照保留在数据中，安卓端 V2 不展示）
- ❌ 辅助模式推荐选项（suggestedOptions）、Token 管理面板、版本快照不移植
- ❌ 纯文本渲染不变（不引入 Markdown 渲染库）

## Impact

- Affected code:
  - 服务端：`src/main/services/lanApiServer/`（server.ts 路由扩展、dialogue.ts 管线增强、新增 sessionConfigStore.ts / imageGeneration.ts）
  - 复用主进程服务：avatarService（人设）、memoryService（表格）、chatHistory/context RAG 服务、characterTrait/LoRA 读取、sd 服务、asset 服务
  - 客户端：`android-client/src/`（types.ts 扩展、client.ts 新增 API、ChatScreen.tsx 增强+布局重构、新增 SessionConfigSheet/ImageBubble/TableViewer 组件）
  - 文档：docs/android-client.md（API 增量）、docs/android-client-test-report.md（v2 测试报告）、CHANGELOG.md、FIX_RECORDS.md（如遇 bug 重点标记）
- Affected specs: add-android-chat-client（V1 基础上扩展，不破坏既有 9 个端点与 SSE 协议既有事件）

## ADDED Requirements

### Requirement: LAN 会话配置服务（R1）
系统 SHALL 在服务端提供每角色的会话配置存储与 REST 接口，安卓客户端不保存任何功能配置（仅服务器地址）。

#### Scenario: 读取默认配置
- **WHEN** GET `/api/chats/:id/session-config` 且该角色无保存记录
- **THEN** 返回 200，字段为安全默认值（无选中人设、参数空对象、无 KB 绑定、memoryTableEnabled=false）

#### Scenario: 更新配置并生效
- **WHEN** PUT `/api/chats/:id/session-config`（合法 body）
- **THEN** 持久化到主进程 JSON 文件并返回保存后的完整配置；下一轮对话即按新配置执行

#### Scenario: 人设列表
- **WHEN** GET `/api/personas`
- **THEN** 返回人设清单（id/name/description/isGeneric/isSystem/avatarUrl）；GET `/api/personas/:id/avatar` 返回头像二进制或 404

### Requirement: headless 对话管线增强（R2）
对话 SSE 管线 SHALL 依会话配置注入人设、生效参数、执行 RAG 检索与记忆表格注入，并在 AI 回复含表格编辑指令时执行并通知。

#### Scenario: 人设注入
- **WHEN** 会话配置选中了人设 P，用户发送消息
- **THEN** 系统提示词包含 P 的用户人设段（对齐桌面端 PromptBuilder 用户人设构建），对话中 {{user}} 语义指向 P.name

#### Scenario: 参数生效
- **WHEN** 会话配置设置 temperature=0.5、max_tokens=2048、min_response_chars=300、language='zh'
- **THEN** AI 请求体携带对应字段（引擎级配置作为缺省回退）；系统提示词注入字数下限与语言约束；未设置的字段沿用引擎配置

#### Scenario: RAG 注入且失败不阻塞
- **WHEN** 历史消息数超过检索阈值（对齐桌面端常量）或绑定了知识库
- **THEN** 检索结果注入系统提示词对应区域；检索抛错时跳过该区域，对话正常进行

#### Scenario: 记忆表格编辑指令
- **WHEN** memoryTableEnabled=true 且 AI 回复中包含表格编辑指令标记（对齐桌面端包装格式）
- **THEN** 服务端解析并执行编辑命令（复用 memoryService），SSE 推送一个 `table` 事件（含更新摘要）；解析失败时忽略指令不中断

### Requirement: headless 图片生成服务（R3）
系统 SHALL 提供对话图片生成接口：基于角色特征、LoRA、父消息情绪动态表情标签组装 prompt，调用 SD 服务生成并落盘素材，更新消息 imageAttachment。

#### Scenario: 首次生成
- **WHEN** POST `/api/chats/:id/messages/:messageId/image`（无 body 或 `{regenerate:false}`），SD 已配置且可用
- **THEN** 生成图片落盘（asset:save），消息 imageAttachment 更新（history 追加、currentIndex 指向最新、status='idle'），响应返回 imageAttachment；表情标签按父消息 emotion 动态注入（对齐 §7.43），interaction 分类标签应用会话配置的权重提升

#### Scenario: 重新生成与历史
- **WHEN** 同一消息再次 POST（`{regenerate:true}`）
- **THEN** history 追加新版本不覆盖旧版本，响应含完整 history；客户端可切换查看

#### Scenario: 失败场景
- **WHEN** SD 未配置/未连接/生成超时
- **THEN** 返回结构化错误（如 SD_NOT_CONFIGURED / SD_UNAVAILABLE），imageAttachment 置 status='error' 含 errorMessage，不损坏既有 history

#### Scenario: 素材读取
- **WHEN** GET `/api/assets/:characterId/:assetId`（assetId 为磁盘素材 ID）
- **THEN** 返回 PNG 二进制；非法 ID 返回 404（白名单校验，无路径穿越）

### Requirement: 安卓功能 UI（R4）
安卓对话页 SHALL 提供会话配置入口（人设/参数/知识库/表格开关）、图片气泡交互与表格查看，全部数据经服务端 API 读写。

#### Scenario: 配置修改
- **WHEN** 用户在配置弹层修改人设/参数并保存
- **THEN** PUT session-config 成功后提示已保存；失败提示可重试错误；不写入任何本地配置存储

#### Scenario: 图片气泡交互
- **WHEN** 会话配置 image_gen_enabled=true，消息为非流式 assistant 消息
- **THEN** 气泡下方提供"生成图片"入口；生成中显示阶段 loading；完成后图片内嵌气泡（点击查看大图、‹›切换历史、可重新生成）；加载失败回退错误占位

#### Scenario: 表格查看
- **WHEN** 用户打开记忆表格查看弹层
- **THEN** 展示服务端返回的 sheet/headers/rows（简单可滚动表格）；表格为空显示空态

### Requirement: 布局修复与多尺寸适配（R5）
对话页 SHALL 在小屏手机（360dp）、常规手机、平板/横屏上无元素重叠、无溢出、无遮挡，图片按原始宽高比展示。

#### Scenario: 立绘自适应
- **WHEN** 任意宽高比立绘/头像
- **THEN** 立绘区按屏宽与图片宽高比自适应（contain + 限高），无裁切拉伸变形

#### Scenario: 键盘不遮挡
- **WHEN** 任意安卓真机弹出软键盘
- **THEN** 输入框始终可见（edge-to-edge 下显式处理键盘避让），消息列表随键盘收缩

#### Scenario: 长文本不溢出
- **WHEN** 气泡内含长中文段落/连续长串/URL
- **THEN** 全部在气泡内折行，不横向溢出屏幕

#### Scenario: 流式滚动稳定
- **WHEN** SSE 流式逐字更新
- **THEN** 列表跟随底部但无明显抖动（滚动调用节流）

### Requirement: 测试与交付（R6）
开发完成 SHALL 交付：全接口 curl 测试记录、客户端 tsc+构建+aapt2 验证、更新后的 APK（debug+release）、v2 测试报告（缺失功能对照矩阵 + 布局问题清单 + 根因分析 + 修复验证 + 真机复核清单）、文档增量更新。

## MODIFIED Requirements

### Requirement: 消息历史接口（原 add-android-chat-client R5 部分）
`GET /api/chats/:id` 返回的消息对象 SHALL 额外携带 `imageAttachment`（如存在，含 history/currentIndex/status/emotion），供安卓端渲染图片气泡；既有字段（id/role/content/timestamp/emotion）不变，V1 客户端向后兼容。

### Requirement: SSE 事件序列（原 add-android-chat-client R4 部分）
POST 消息 SSE 事件序列扩展为：多个 `chunk` → 至多一个 `emotion` → **零或一个 `table`（表格编辑已执行）** → 一个 `done`（或失败路径一个 `error`）。既有事件语义不变。

## REMOVED Requirements

（无——本变更不移除任何既有功能或端点）
