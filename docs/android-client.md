# 安卓客户端（android-client）开发与集成文档

> Spec: `add-android-chat-client`（V1）/ `fix-android-chat-feature-parity`（V2 功能补全与布局修复）/ `fix-android-chat-parity-v3`（V3 对话模式对齐 + 主题切换）/ `add-mobile-character-card-editor`（V4 移动端角色卡编辑）/ `redesign-mobile-chat-ui`（V5 移动端 UI 全面重新设计）· 客户端为**纯客户端**形态：不含任何模型/提示词/生成参数等本地功能配置，全部功能由服务端 LAN API 决定；本地仅保存最近一次成功连接的服务器地址、界面主题偏好（亮/暗，纯外观）与角色卡编辑草稿（编辑中暂存，保存成功后清除，属数据暂存而非功能配置）。

## 1. 架构总览

```
┌─────────────────────────┐        同一 WiFi（HTTP 明文，仅限局域网）        ┌──────────────────────────────┐
│  Android 客户端          │ ─────────────────────────────────────────────▶ │  creative-cafe 桌面端          │
│  android-client/ (RN)   │   http://<电脑IP>:8787/api/...                  │  Electron 主进程内嵌 LAN API   │
│  - 连接页（地址+测试）    │                                                │  src/main/services/lanApiServer│
│  - 角色列表页（搜索/刷新）│ ◀───────────────────────────────────────────── │  /server.ts（HTTP 路由）        │
│  - 对话页（SSE 流式）     │        JSON / PNG / SSE(chunk|emotion|done)    │  /dialogue.ts（headless 管线）│
└─────────────────────────┘                                                └──────────────────────────────┘
```

- **服务端**：Electron 主进程内嵌 Node `http` 服务，绑定 `0.0.0.0:8787`（默认），随桌面端启动自动开启；关闭桌面端即下线。对话历史与桌面端**共用同一存储**（`chatStorageService` / TestChatData），两端实时同源。V4 新增角色卡写端点，复用 `characterService` 既有 CRUD（与 PC 端 IPC 同一实现），双端数据同源。
- **客户端**：React Native 0.87（新架构）+ react-native-paper（Material 3）+ zustand + react-native-sse + react-native-image-picker。四屏结构：连接页 → 角色列表页 → 对话页 → 角色卡编辑页。

## 2. 服务端 LAN API 说明

Base URL：`http://<电脑局域网IP>:8787`（端口可通过设置文件 `lanApi.port` 修改；`lanApi.enabled=false` 可关闭）

> ⚠️ **安全边界**：服务仅供局域网使用，**禁止端口映射/暴露公网**（明文 HTTP，无鉴权）。所有 `:id` 参数做白名单校验（与角色卡目录内真实文件名精确匹配），杜绝路径穿越。

所有错误统一返回 JSON：`{ "error": { "code": string, "message": string } }`

| 方法 | 路径 | 说明 | 成功响应 |
|---|---|---|---|
| GET | `/api/health` | 连接测试 | `{ status:"ok", service:"creative-cafe-lan-api", version, time }` |
| GET | `/api/characters` | 角色卡列表 | `{ characters: [{ id, name, description, tags, creator, version, cardVersion, avatarUrl, modified }] }` |
| GET | `/api/characters/:id` | 角色卡详情 | `{ character: { id, spec, data: {...} } }` |
| GET | `/api/characters/:id/avatar` | 头像二进制 | `image/png` 等 |
| GET | `/api/characters/:id/expressions` | 表情清单 | `{ emotions: [{ key, type, label, url }], hasCustom }` |
| GET | `/api/characters/:id/expressions/:emotion` | 情绪立绘二进制 | `image/png` |
| GET | `/api/chats/:characterId` | 历史消息 | `{ messages: [{ id, role, content, timestamp, emotion?, imageAttachment? }], updatedAt }` |
| POST | `/api/chats/:characterId/messages` | 发送消息（SSE） | `text/event-stream` |
| POST | `/api/chats/:characterId/clear` | 清空上下文 | `{ success: true }` |
| POST | `/api/chats/:characterId/rollback` | 卷回消息（V5，body `{ messageId }`，从该 user 消息起截断） | `{ success: true, content, removedCount }` |
| GET | `/api/favorites` | 角色收藏列表（V6，与 PC 端共用 `userData/character-favorites.json`） | `{ favorites: [{ name, addedAt }] }`（name=文件名） |
| PUT | `/api/favorites` | 全量替换收藏（V6，body `{ favorites: [{ fileName, addedAt }] }`，幂等） | `{ favorites: [...] }` |
| GET | `/api/chats/:characterId/session-config` | 读取会话配置（V2） | `{ config: {...} }` |
| PUT | `/api/chats/:characterId/session-config` | 保存会话配置（V2） | `{ config: {...} }` |
| GET | `/api/personas` | 用户人设清单（V2） | `{ personas: [{ id, name, description, avatarUrl? }] }` |
| GET | `/api/personas/:id/avatar` | 人设头像二进制（V2） | `image/png` 或 404 |
| GET | `/api/knowledge-scopes` | 知识库作用域清单（V2） | `{ scopes: [{ id, label, sourceType, sourceName, vectorCount }] }` |
| GET | `/api/chats/:characterId/memory-table` | 记忆表格数据（V2） | `{ enabled, sheets, headers, data, sheetDescriptions }` |
| POST | `/api/chats/:characterId/messages/:messageId/image` | 生成对话图片（V2） | `{ imageAttachment: {...} }` |
| GET | `/api/assets/:characterId/:assetId` | 读取素材图片（V2） | `image/png` |
| PUT | `/api/characters/:id/card` | 更新角色卡字段（V4，白名单字段级合并） | `{ success: true }` |
| PUT | `/api/characters/:id/avatar` | 更换头像载体图（V4，base64 PNG，保留卡数据） | `{ success: true }` |
| POST | `/api/characters` | 新建角色卡（V4，载体图+字段） | `{ success: true, id: "xxx.png" }` |
| DELETE | `/api/characters/:id` | 删除角色卡（V4，仅删卡，与 PC 端 character:delete 一致） | `{ success: true }` |
| GET | `/api/characters/:id/worldbook-relations` | 读世界书绑定（V4） | `{ relations: [{ worldBookPath, worldBookName?, enabled, priority, filterTags? }] }` |
| PUT | `/api/characters/:id/worldbook-relations` | 写世界书绑定（V4，整组替换） | `{ success: true, relations }` |
| GET | `/api/worldbooks` | 世界书清单（V4） | `{ worldbooks: [{ name, path, size, modified }] }` |

- `:id` 即角色卡文件名（如 `AmazingAA.png`），请求时需 `encodeURIComponent`。
- 无历史且有 `first_mes` 时，history 接口会合成一条问候消息（不落盘）。

### 2.1 SSE 对话协议

请求：

```http
POST /api/chats/AmazingAA.png/messages
Content-Type: application/json

{"content": "你好，请简单打个招呼"}
```

响应（`text/event-stream`，每 15s 一条 `: ping` 注释心跳）：

```
event: chunk
data: {"delta":"*坐在电竞椅上"}

event: chunk
data: {"delta":"，微微一笑* \"嗨~\""}

event: emotion
data: {"emotion":"cheerfulness"}

event: done
data: {"messageId":"assistant-1787071212087-n2fsx3","emotion":"cheerfulness","content":"...权威全文...","timestamp":1787071212087}
```

事件语义：

| 事件 | 次数 | data 字段 | 说明 |
|---|---|---|---|
| `chunk` | 0..N | `delta: string` | 增量文本（已剥离 `<think>` 与 `<<<EXPRESSION>>>` 标记）；`done.content` 为权威全文 |
| `reasoning` | 0..N | `delta: string` | **V3**：思考过程增量（仅 `think_tag_mode=fold` 时流式推送；存储/权威全文处理见 §2.2 think 三态） |
| `emotion` | 0..1 | `emotion: string` | 解析出的情绪键（在 `done` 前推送） |
| `table` | 0..N | `{ enabled, sheets, headers, data, sheetDescriptions }` | **V2**：AI 输出表格编辑指令并执行成功后推送最新表格数据（在 `emotion` 后、`done` 前） |
| `options` | 0..1 | `options: string[]` | **V3**：辅助模式推荐选项（`assist_mode=true` 时 AI 回复末尾生成 3 条，服务端解析剥离后推送；客户端渲染为可点击 chips，**V5 起点击填入输入框可编辑后发送**） |
| `done` | 1 | `messageId/userMessageId/emotion/content/timestamp` | 本轮完成，user+assistant 已持久化；`userMessageId`（V5）供卷回/重新生成按服务端 id 定位 |
| `error` | 1（失败时） | `{ code, message }` | 失败；**不写入** assistant 消息，历史保持原样 |

事件序列（V3）：`reasoning*?` → `chunk*` → `emotion?` → `table?` → `options?` → `done`，向后兼容（未开启思考折叠/辅助模式时无 `reasoning`/`options` 事件）。

错误码：`AI_NOT_CONFIGURED`（服务端未配置引擎）/ `AI_TIMEOUT` / `AI_REQUEST_FAILED` / `AI_EMPTY_RESPONSE` / `CHARACTER_NOT_FOUND` / `BAD_REQUEST`。

### 2.2 会话配置（V2 起，session-config）

每角色独立持久化于服务端（`{userData}/data/lan-session-config/<hash>.json`，与桌面端配置互不影响）：

```jsonc
{
  "selectedPersonaId": "profile-xxx" | null,   // 用户人设（{{user}} 指向人设名）
  "customParameters": {                         // AI 参数子集（未设置时沿用桌面端引擎配置）
    "temperature": 0.7, "top_p": 0.9, "max_tokens": 4096,
    "min_response_chars": 0,                    // 回复字数下限（注入提示词约束）
    "language": "zh" | "en" | "",               // 回复语言约束
    "expression_display": true,                 // false 时无表情提示注入、不解析情绪
    "image_gen_enabled": false,                 // 安卓端"生成图片"入口开关
    "image_size": "768x1024",                   // 图片尺寸
    "think_tag_mode": "strip",                  // V3 思考内容处理三态，见下
    "assist_mode": false,                       // V3 辅助模式（回复末尾 3 个推荐选项）
    "frequency_penalty": 0.1,                   // V3 防重复参数（三档预设写入，见下）
    "presence_penalty": 0.1,
    "dry_multiplier": 0.4
  },
  "boundKnowledgeBaseIds": [],                  // 绑定的知识库作用域（RAG 检索注入）
  "memoryTableEnabled": false,                  // 记忆表格（注入 + 编辑指令执行 + table 事件）
  "customStopSequencesEnabled": false,
  "customStopSequences": []                     // 自定义停止序列（与引擎停止序列合并）
}
```

- PUT 仅接受白名单字段，非法值返回 `400 VALIDATION_ERROR`；读缺省自动返回默认值。
- **双源差异**：该配置仅作用于 LAN（安卓）会话管线；桌面端对话仍读桌面端自己的设置，两端互不干扰（历史消息存储仍同一份）。

**V3 思考内容处理三态（`think_tag_mode`，对齐桌面端）**：

| 取值 | 存储内容 | 气泡渲染 | 流式行为 |
|---|---|---|---|
| `strip`（默认） | 彻底剥离 `<think>` | 无思考 | 无 |
| `strip_render` | 保留 `<think>` 于消息 content（其他端可查看） | 渲染时剥离，不显示思考 | 无 |
| `fold` | 保留 `<think>` 于消息 content | 气泡内折叠面板（点击展开/收起，流式期间自动展开） | 服务端经 `reasoning` 事件推送思考增量 |

**V3 防重复强度三档预设（客户端选择器写入以下参数组合）**：

| 档位 | frequency_penalty | presence_penalty | dry_multiplier |
|---|---|---|---|
| 宽松 | 0 | 0 | 0（关闭 DRY） |
| 标准（推荐） | 0.1 | 0.1 | 0.4 |
| 严格 | 0.3 | 0.3 | 0.8（可能缩短回复） |

**V3 辅助模式（`assist_mode`）**：开启后服务端注入提示词，要求 AI 在回复末尾以固定标记输出 3 个推荐选项；服务端解析剥离后经 SSE `options` 事件推送，客户端渲染为可点击 chips（点击即作为用户消息发送）。正文存储不含选项标记。

> ⚠️ **max_tokens 配置陷阱（重点）**：若角色使用推理型模型（think 阶段消耗输出 token），`max_tokens` 设得过小（如 1024）会导致思考未完成即截断、正文为空，客户端收到 `AI_EMPTY_RESPONSE`。**建议 max_tokens ≥ 4096** 或不设置（沿用引擎配置）。

### 2.3 对话图片生成（V2）

`POST /api/chats/:cid/messages/:messageId/image`（body：`{"regenerate": false}`）：

- 仅对 **assistant 消息**生效（用户消息 404 `MESSAGE_NOT_FOUND`）；`regenerate=true` 时 history 追加不覆盖。
- 服务端 headless 管线：角色 traits + LoRA（含权重）→ 父消息 emotion 动态表情标签（对齐桌面端 §7.43 冲突过滤 + interaction 权重提升）→ SD txt2img → 素材落盘 → 更新消息 `imageAttachment`。
- SD 未配置/未连接/超时返回结构化错误码（`SD_NOT_CONFIGURED` 等），旧 history 不受影响。
- 响应 `imageAttachment`：`{ currentAssetId, emotion, createdAt, history: [{ assetId, usedTags, usedPrompt, usedLoras }], currentIndex, status }`；图片本体走 `GET /api/assets/:cid/:assetId`（白名单校验，路径穿越 404）。
- 生成耗时较长（客户端超时 300s），进行中重复请求返回 `IMAGE_GENERATION_IN_PROGRESS`。

### 2.4 V2 范围边界（未移植清单）

| 桌面端功能 | V2 处理 | 原因 |
|---|---|---|
| `ai_optimize_traits`（AI 优化特征再生成图） | 响应 `notices` 标记 `unsupported`，忽略执行 | headless 管线依赖桌面端交互上下文，收益低 |
| 图片查看器缩放/拖拽 | 简版全屏查看（点按关闭） | 最低风险优先，后续可增强 |
| 桌面端其余引擎高级参数（rep_pen/top_k 等） | 不暴露 | 会话配置仅开放高频子集，降低误配风险 |

curl 示例：

```powershell
'{"content":"你好"}' | Out-File -Encoding utf8 "$env:TEMP\msg.json"
curl.exe -N -X POST -H "Content-Type: application/json" --data "@$env:TEMP\msg.json" `
  "http://192.168.x.x:8787/api/chats/AmazingAA.png/messages"
```

## 3. 客户端源码结构

```
android-client/
├─ App.tsx                      # PaperProvider（动态亮/暗主题）+ 四屏切换（connect/list/chat/edit）+ StatusBar 明暗
├─ index.js                     # RN 入口（模板默认）
├─ src/
│  ├─ types.ts                  # 全部类型（V4 新增 CharacterCardEditData/CharacterWorldBookRelation/
│  │                            #   WorldBookSummary/CharacterDetail）
│  ├─ theme.ts                  # V5 主题系统：中性暖色主色调 + 玻璃态语义色（glassBg/scrim/skeleton/accentBar）+ themeOf(mode)
│  ├─ store.ts                  # zustand：baseUrl + 导航 + AsyncStorage（服务器地址 + 主题偏好 + 角色卡编辑草稿）
│  ├─ api/
│  │  ├─ client.ts              # fetch 封装（V4 新增 apiDelete + 角色卡编辑接口：
│  │  │                         #   fetchCharacterCard/putCharacterCard/putCharacterAvatar/
│  │  │                         #   createCharacter/deleteCharacter/getWorldBookRelations/
│  │  │                         #   putWorldBookRelations/fetchWorldbooks）
│  │  └─ sse.ts                 # react-native-sse 封装（V1/V2/V3，V4 未改动）
│  ├─ components/               # V2-V3 组件（V5 全部玻璃态化）
│  │  ├─ SessionConfigSheet.tsx # 会话配置弹层（V5 玻璃态底部弹层）
│  │  ├─ ImageBubble.tsx        # 对话图片气泡（**V5 重写**：自适应宽高比/16dp 圆角/骨架屏/胶囊控件）
│  │  ├─ MemoryTableSheet.tsx   # 记忆表格弹层（V5 玻璃态底部弹层）
│  │  └─ AvatarViewer.tsx       # 头像/立绘全屏查看器（V5 新增：双指捏合 1x-4x/双击 1x↔2.5x/放大后拖拽平移/单击或返回键关闭）
│  └─ screens/
│     ├─ ConnectScreen.tsx      # 连接页（V5 玻璃态卡片）
│     ├─ CharacterListScreen.tsx# 角色列表页（V5 20dp 圆角卡片/阴影；**V6：收藏置顶排序对齐 PC 端**——
│     │                         #   收藏在前（组内保持服务端 readdir 顺序）/非收藏在后/搜索先过滤再分组，
│     │                         #   卡片心形按钮 toggle，收藏经服务端 /api/favorites 持久化与 PC 端互通）
│     ├─ ChatScreen.tsx         # 对话页（**V5：立绘头像化**+ 对话交互对齐 PC：气泡圆角 18/小角 4/名字行+情绪标签+#n 序号徽章、
│     │                         #   头像点击全屏查看、AI 消息「复制/重新生成」与用户消息「卷回到输入框」操作按钮行、
│     │                         #   辅助模式选项点击填入输入框、头像与名字行顶对齐、用户消息整体右对齐）
│     └─ CharacterEditScreen.tsx# 角色卡编辑屏（V5 玻璃态卡片/统一圆角）
└─ android/                     # Gradle 工程（applicationId com.creativecafe.androidclient）
```

关键实现约定：

- **地址规范化**：`normalizeServerAddress` 去协议前缀，校验 `host[:port]`，默认端口需显式输入（8787）。
- **明文 HTTP**：`android/app/build.gradle` 中 `manifestPlaceholders = [usesCleartextTraffic: true]`（debug/release 均生效），仅用于局域网。
- **立绘回退**：`emotion` 事件先查表情清单（`expressionKeys`），有立绘才请求 `/expressions/:emotion`；`onError` 置 `expressionFailed` 回退头像。
- **失败重试**：失败气泡标记 `failed`，点"重试"移除该气泡与对应用户消息后原样重发。
- **主题系统（V3）**：`theme.ts` 定义亮/暗两套 Palette + Paper MD3 主题；`store.themeMode` 持久化于 AsyncStorage（纯外观偏好，非功能配置），`toggleTheme` 即时切换。所有自绘样式经 `createStyles(palette)` 工厂取色，Paper 组件由 `PaperProvider theme` 自动跟随；连接页/列表页右上角太阳/月亮按钮切换。RN 0.87 edge-to-edge 下 `StatusBar` 仅设置 `barStyle`（`backgroundColor` 属性已移除）。
- **思考三态渲染（V3）**：`splitThink()` 以正则提取全部 `<think>` 块；`strip`/`strip_render` 渲染剥离正文，`fold` 模式由 `ThinkingPanel` 折叠展示（流式期间自动展开+加载指示，完成后收起，点击切换）；流式思考优先用 SSE `reasoning` 增量，完成态从 content 提取。
- **对话交互对齐 PC（V5）**：气泡圆角 18（用户右下小角 4/AI 左下小角 4）、内边距 16/12、名字行（用户名/角色名 + 情绪标签 + AI `#n` 序号徽章，颜色 `palette.nameUser/nameAI` 对齐 PC `#818cf8/#a78bfa`）；头像点击弹出 `AvatarViewer` 全屏查看；AI 气泡下方操作行「复制/重新生成」、用户气泡下方「卷回到输入框」（`rollbackChat` 截断服务端+本地历史，内容回填输入框；重新生成 = rollback 最后 user 消息 + 原文重发，SSE `done.userMessageId` 保证按服务端 id 定位）；辅助模式选项点击 `setInput` 填入输入框（不直接发送）；流式期间操作按钮不渲染（`!item.streaming`）。
- **滚动跟随（L7，⚠️ 重点，见 FIX_RECORDS §7.53）**：三层防护——① `onContentSizeChange` 仅在 `streaming` 期间触发跟随（静态浏览历史时图片加载/windowing 重布局不滚底）；② 用户上滑离底 >80px 暂停跟随、滚回底部自动恢复（`onScroll` 的 `contentSize.height` 在 Android Fabric 上可能为 0，用 `onContentSizeChange(_, contentH)` 参数缓存到 `lastContentHRef` 作可靠回退）；③ 主动场景（发送消息/历史加载完成）`scrollToBottom(true)` 强制回底。另注意：发送后 `input disabled` 会导致键盘自动收起，此时按系统 BACK 会直接退出应用并取消 SSE 流。

## 4. 构建说明

环境要求：Node ≥ 22、JDK 17、Android SDK（platform-tools + platforms;android-35 + build-tools;35.0.0）。

```powershell
# 环境变量（首次）
$env:JAVA_HOME   = "C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"   # 本机安装路径
$env:ANDROID_HOME= "G:\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

# 安装依赖 & 构建（在 android-client/ 下）
npm install
cd android
.\gradlew.bat assembleDebug     # Debug APK
.\gradlew.bat assembleRelease   # Release APK（当前使用 debug 签名占位，见下）
```

产物路径：

| 变体 | 路径 |
|---|---|
| Debug | `android-client/android/app/build/outputs/apk/debug/app-debug.apk` |
| Release | `android-client/android/app/build/outputs/apk/release/app-release.apk` |
| 交付副本 | `android-client/apk/creative-cafe-{debug,release}.apk` |

> ⚠️ **Release 签名占位**：`signingConfig signingConfigs.debug`（模板默认）。仅供个人局域网使用；若需正式分发，请生成自有 keystore 并修改 `android/app/build.gradle` 的 `signingConfigs.release`。

> ⚠️ **图标字体集成（§7.52 教训，勿删）**：`android/app/build.gradle` 中必须保留
> `apply from: "../../node_modules/react-native-vector-icons/fonts.gradle"`
> （dependencies 块内）。缺失时构建不报错，但 APK 无任何 .ttf → 所有图标渲染为空（按钮只剩背景色）。构建后可解包抽验：APK `assets/fonts/` 应含 MaterialCommunityIcons.ttf 等 19 个字体。

## 5. 调试指南

### 5.1 找服务端地址

桌面端启动日志中查找（主进程控制台）：

```
[LanApi] LAN API 服务已启动: http://0.0.0.0:8787 （仅供局域网使用，请勿暴露公网）
```

电脑局域网 IP：`ipconfig` → WLAN 适配器 IPv4。手机浏览器验证 `http://<IP>:8787/api/health`。

### 5.2 常见连接问题

| 现象（客户端提示） | 排查 |
|---|---|
| `[不可达]` | 手机与电脑不同 WiFi/网段；电脑防火墙拦截 8787（首次放行或入站规则放行 Node/Electron）；桌面端未启动 |
| `[超时]` | 地址可达但无响应：确认端口（默认 8787，是否被设置改为其他）；路由器 AP 隔离 |
| `[服务端错误] HTTP xxx` | 服务端异常，看桌面端主进程日志 |
| 连接成功但发送消息 error 事件 `AI_NOT_CONFIGURED` | 桌面端未配置 AI 引擎（API 地址/模型名），先在桌面端设置 |

### 5.3 日志

- 客户端：`adb logcat -s ReactNativeJS`（`console.warn` 的 SSE 错误码/消息）。
- 服务端：桌面端主进程控制台 `[LanApi]` 前缀日志（启动、dispatch 异常）。
- Metro 调试（开发期）：`cd android-client && npm start`，设备摇晃/开发者菜单 → Settings → Debug server host 设置电脑 IP:8081。

### 5.4 功能自测清单（快速）

1. 桌面端启动 → 手机连同一 WiFi → 客户端输入 `IP:8787` → 测试并连接 → 进入角色列表
2. 搜索框输入角色名/tags → 过滤正确；下拉刷新 → 数据重同步
3. 点角色 → 加载历史（含 first_mes 问候）→ 发消息 → 气泡逐字增长 → 立绘切换情绪
4. 桌面端打开同一角色 → 历史与手机端一致（同一存储）
5. 对话页右上角清空 → 双端历史清空 → 出现 first_mes 问候
6. 桌面端关闭 → 手机发消息 → 提示连接中断 → 重开桌面端 → 点重试 → 成功补发
7. （V2）对话页右上角"设置" → 弹层加载人设/知识库清单 → 选择人设保存 → 发消息验证 AI 以人设名称呼用户
8. （V2）设置弹层开启"生成图片"→ 保存 → AI 回复气泡出现"生成图片"按钮 → 点击 → loading → 图片内嵌展示 → ‹›切换历史 → 重新生成 → 点图全屏
9. （V3）设置弹层"思考内容处理"切到"可折叠查看" → 保存 → 发消息 → 气泡内出现"思考过程"折叠面板（流式期间自动展开）→ 完成后收起 → 点击可再展开
10. （V3/V5）设置弹层开启"辅助模式" → 保存 → 发消息 → AI 回复下方出现 3 个推荐选项 chips → 点击任一 → **文本填入输入框**（Snackbar「已填入输入框，可编辑后发送」）→ 可编辑 → 手动发送收到新回复
11. （V3）设置弹层"防重复强度"分别选 宽松/标准/严格 → 保存 → 重新打开弹层确认选中档位正确回显
12. （V3）连接页/列表页右上角主题按钮 → 亮↔暗即时切换 → 三屏（连接/列表/对话）与弹层（配置/表格）、气泡/思考面板/选项 chips 均配色正确 → 杀进程重启后主题记忆
13. （V2）设置弹层开启"记忆表格"→ 保存 → 发消息 → AI 回复后点顶栏表格图标 → 弹层显示 5 张表数据（AI 编辑指令自动执行）
14. （V2）小屏（360dp 级）/常规/横屏三档检查：立绘无裁切变形、键盘不遮挡输入框、长文本折行不溢出、情绪徽章不与正文重叠
15. （V5）点击 AI 气泡左侧头像/立绘 → 全屏查看器（黑遮罩）→ 双击在 1x/2.5x 间切换 → 放大后单指拖拽平移 → 单击遮罩/右上角 ✕/系统返回键均可关闭；用户头像（persona 设置头像后）同样可查看，未设置时点击提示「当前人设未设置头像」
16. （V5）AI 消息气泡下方出现「复制 / 重新生成」操作行 → 复制后 Snackbar 反馈且剪贴板可粘贴；点击重新生成 → 消息被卷回重发（历史无重复 user 消息）→ 出现新回复
17. （V5）用户消息气泡下方「卷回到输入框」→ 该条及其后消息从列表移除（服务端同步）→ 内容回填输入框（Snackbar「已卷回到输入框」）；流式回复期间所有操作按钮隐藏/禁用；历史仅剩问候语时无卷回按钮
18. （V6）角色列表排序对齐 PC 端：列表页并行拉取 `/api/characters` + `/api/favorites` → **收藏角色置顶**（组内保持服务端返回顺序）→ 非收藏按原顺序在后；搜索时先过滤再分组（收藏仍置顶）
19. （V6）角色卡右上角心形按钮 toggle：点击 → 实心粉心 + Snackbar「已收藏/已取消收藏」+ 该卡移入/移出置顶区；服务端 GET 验证收藏已持久化；PC 端下次启动后收藏状态同步一致（共用 `userData/character-favorites.json`）
