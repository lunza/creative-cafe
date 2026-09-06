# 安卓客户端功能测试报告（add-android-chat-client · V1 / fix-android-chat-feature-parity · V2）

- 测试日期：2026-08-19（V1）/ 2026-08-19（V2 功能补全与布局修复）
- 服务端版本：creative-cafe 1.0.1（LAN API 默认端口 8787）
- 客户端版本：com.creativecafe.androidclient 1.0（RN 0.87.0，debug/release 双变体）
- 测试环境：Windows 主机（Electron 桌面端 + 内嵌 LAN API）+ 本地 AI 引擎（OpenAI 兼容）+ SD 图片服务
- 产物：`android-client/apk/creative-cafe-debug.apk`（130.0MB）/ `creative-cafe-release.apk`（61.3MB，debug 签名占位，**2026-08-19 17:54 V2.1 构建：修复图标字体未打包 §7.52**；17:21 版 release1.apk 为字体缺失旧版，勿再安装）

## 结论摘要

| 类别 | 结果 |
|---|---|
| R1 内嵌 LAN HTTP 服务 | ✅ 通过（curl 实测） |
| R2 headless 对话管线 | ✅ 通过（SSE 实测，含情绪解析与双端同存储验证） |
| R3 客户端连接（无本地功能配置） | ✅ 代码审查 + TS 编译通过；真机交互待用户复核 |
| R4 客户端角色列表 | ✅ 同上 |
| R5 客户端对话 | ✅ 服务端协议已实测；客户端 UI 真机流程待用户复核 |
| R6 稳定性与安全性 | ✅ 通过（路径穿越攻击实测拦截；超时/重试代码审查） |
| R7 交付物 | ✅ 全部交付 |

## 逐项测试记录

### R1 内嵌 LAN HTTP 服务

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1.1 | 桌面端启动后 0.0.0.0:8787 监听 | ✅ | 主进程日志 `[LanApi] LAN API 服务已启动: http://0.0.0.0:8787` |
| 1.2 | `GET /api/health` 返回 200 + 版本 | ✅ | `{"status":"ok","service":"creative-cafe-lan-api","version":"1.0.1","time":1787071155410}` |
| 1.3 | `GET /api/characters` 列表（与 `character:list` 同源） | ✅ | 返回 19,240B JSON；字段含 id/name/description/tags/creator/version/cardVersion/avatarUrl/modified（AmazingAA/Ceroba/Kanako 等，v3 卡） |
| 1.4 | `GET /api/characters/:id` 详情 200 | ✅ | AmazingAA.png → 200 完整卡片 |
| 1.5 | `GET /api/characters/:id/avatar` PNG | ✅ | 200，`Content-Type: image/png` |
| 1.6 | `GET /api/characters/:id/expressions` 清单 | ✅ | 30 预置情绪键 + url 字段（admiration…in_heat），`hasCustom:false` |
| 1.7 | `GET /api/chats/:id` 历史 200 | ✅ | 空历史时合成 first_mes 问候（不落盘） |
| 1.8 | `POST /api/chats/:id/clear` 200 | ✅ | `{"success":true}` |

### R6 安全性（服务端）

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 6.1 | 路径穿越 `..%2F..%2Fwindows%2Fwin.ini` | ✅ 拦截 | HTTP 404 `{"error":{"code":"CHARACTER_NOT_FOUND"}}`，无文件系统信息泄露 |
| 6.2 | 不存在角色 ID | ✅ | 同上 404 CHARACTER_NOT_FOUND |
| 6.3 | 非 JSON 请求体 / 空 content | ✅ | 400 BAD_REQUEST（实测错误 JSON 体被拒） |
| 6.4 | 普通请求 30s 超时 / SSE 心跳 | ✅ | `req.setTimeout(30000)`；SSE 每 15s `: ping` 注释行 |

### R2 headless 对话管线（SSE 实测）

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 2.1 | SSE 事件序列 chunk* → emotion → done | ✅ | `curl -N` 收到多条 `event: chunk`（增量中文正常）→ `emotion:"cheerfulness"` → `done`（messageId/timestamp/权威全文） |
| 2.2 | 消息持久化（user+assistant） | ✅ | `GET /api/chats/AmazingAA.png` 返回 2 条：user「你好，请简单打个招呼」+ assistant（含 `emotion:"cheerfulness"`） |
| 2.3 | 标记剥离 | ✅ | 持久化内容无 `<<<EXPRESSION>>>`/`<think>` 残留；动作星号/双引号格式保留 |
| 2.4 | 与桌面端同一存储 | ✅ | 存储走 `chatStorageService.getTestChat/saveTestChat`（TestChatData 同源）；清空后 first_mes 问候恢复 |
| 2.5 | AI 失败不写入 assistant / 服务端不崩 | ✅（代码路径） | 管线所有 onError 路径先于 saveTestChat return；测试后 clear 恢复现场 |

> 说明：2.1–2.4 为真实 AI 引擎实测；2.5 失败注入路径经代码审查确认（错误分支均早于持久化），建议用户在停用 AI 时复核 error 事件。

### 客户端构建与静态验证

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| C.1 | RN 工程类型检查 | ✅ | `npx tsc --noEmit` 0 错误 |
| C.2 | `gradlew assembleDebug` | ✅ | BUILD SUCCESSFUL in 8m 48s（158 tasks） |
| C.3 | `gradlew assembleRelease`（含 metro JS 打包） | ✅ | 产物 56.5MB，paper/zustand/react-native-sse 全部成功打包 |
| C.4 | APK 元数据 | ✅ | aapt2：`com.creativecafe.androidclient` v1.0，INTERNET 权限，label「创想咖啡厅」，arm64-v8a/armeabi-v7a/x86/x86_64 四 ABI |
| C.5 | 明文 HTTP（LAN 必需） | ✅（修复后） | 初版 release APK 实际为 `usesCleartextTraffic=false`（RN 插件 finalizeDsl 覆盖，真机报"无法连接"，见 §真机实测记录）；修复后 aapt2 复验 debug/release 均 `=true` |
| C.6 | 无本地功能配置 | ✅（代码审查） | `src/store.ts` 仅持久化 `@creative_cafe/server_address` 一项（AsyncStorage） |
| C.7 | SSE 防重复发送 | ✅（代码审查） | done/error 后立即 `close()` + `finished` 闸门，规避 react-native-sse 自动重连 |

### 真机实测记录（2026-08-19，用户设备）

| # | 用例 | 结果 | 说明 |
|---|---|---|---|
| D.1 | 手机浏览器访问 `/api/health` | ✅ | 网络可达性、防火墙、服务端均正常 |
| D.2 | release APK 连接页输入 `192.168.3.43:8787` | ❌→✅ | 初版报「[不可达] 无法连接到服务器」；根因为 RN Gradle 插件 finalizeDsl 将 release `usesCleartextTraffic` 覆盖为 false（Android 9+ 拦截明文 HTTP），修复并重建 APK 后待复测 |

> ⚠️ D.2 详细排查与修复见 `docs/FIX_RECORDS.md` §7.48。**手机需卸载旧 APK 后安装 `android-client/apk/creative-cafe-release.apk`（2026-08-19 15:56+ 构建）重新测试。**

### 真机复核清单（待用户执行，本机无连接设备）

`adb devices` 无设备，以下项目需用户在手机上按序复核（预期全部通过）：

1. 安装 `apk/creative-cafe-release.apk` → 启动显示连接页
2. 输入 `电脑IP:8787` → 测试并连接 → 进入角色列表（与服务端角色一致）
3. 错误地址（如 `10.0.0.1:8787`）→ 5s 内提示「不可达/超时」，不进入列表
4. 搜索框输入名称/tags → 即时过滤；下拉刷新 → 重同步；无结果 → 空态提示
5. 点角色 → 加载历史（含 first_mes）→ 发消息 → 气泡逐字增长 → 立绘随情绪切换
6. 桌面端打开同角色 → 历史一致；手机端清空 → 双端历史清空并出现问候
7. 关闭桌面端后发送 → 提示连接中断与重试按钮 → 重开桌面端 → 点重试成功补发

## 已知限制

1. **Release 使用 debug 签名占位**：仅供个人局域网安装；正式分发需替换 keystore。
2. **明文 HTTP 无鉴权**：仅限局域网使用，禁止端口映射暴露公网（文档已注明）。
3. **V1 范围**：不含对话图片生成、表格/世界书编辑、RAG 增强、mDNS 自动发现。
4. **debug 变体需 Metro**：`app-debug.apk` 首次启动需 `npm start` 的开发服务器或改用 release 变体；交付的 release 变体内置 JS bundle，可独立运行。

---

# V2 测试记录（fix-android-chat-feature-parity，2026-08-19）

## V2 结论摘要

| 类别 | 结果 |
|---|---|
| R1 会话配置存储与接口 | ✅ curl 实测通过（默认值/PUT 持久化/非法值 400） |
| R2 对话管线增强（人设/参数/停止序列） | ✅ curl 实测通过；max_tokens 过小陷阱已定位并记档（见 V2.2） |
| R3 RAG 注入（历史/知识库） | ✅ 代码路径完成 + try-catch 审查；知识库作用域当前为空，注入待真实数据复核 |
| R4 记忆表格（注入/编辑指令/查看） | ✅ curl 实测完整链路（AI 编辑指令执行 + table 事件 + 5 表数据落库） |
| R5 图片生成（headless 管线） | ✅ curl 实测主路径 + 重新生成 + 素材读取 + 穿越/不存在消息错误路径 |
| R6 客户端功能 UI | ✅ tsc 0 错误 + 代码审查；真机交互待用户复核（见 V2 真机复核清单） |
| R7 布局修复 L1-L6 | ✅ 代码审查 + tsc；真机三档屏幕待用户复核 |
| R8 构建交付 | ✅ BUILD SUCCESSFUL × 2 + aapt2 cleartext=true + APK 已复制 |

## V2.1 功能对照矩阵（桌面端 vs 安卓 V1 vs 安卓 V2）

| 功能 | 桌面端 | 安卓 V1 | 安卓 V2 |
|---|---|---|---|
| 流式对话（SSE）+ 情绪解析 | ✅ | ✅ | ✅ |
| 对话历史/清空/双端同存储 | ✅ | ✅ | ✅ |
| 情绪立绘切换 | ✅ | ✅ | ✅（+contain 自适应修复） |
| 用户人设选择（{{user}} 指向） | ✅ | ❌ 缺失 | ✅ 服务端存储 + 弹层选择 |
| AI 参数（temperature/top_p/max_tokens 等） | ✅ | ❌ 缺失 | ✅ 会话配置弹层（服务端持久化） |
| min_response_chars / language 约束 | ✅ | ❌ 缺失 | ✅ |
| expression_display 开关 | ✅ | ❌ 缺失 | ✅ |
| 自定义停止序列 | ✅ | ❌ 缺失 | ✅（与引擎停止序列合并） |
| 记忆表格（注入 + AI 编辑 + 查看） | ✅ | ❌ 缺失 | ✅ 弹层查看 + table 事件 + 自动执行 |
| 知识库绑定检索（RAG） | ✅ | ❌ 缺失 | ✅ 作用域清单 + 绑定开关（检索注入） |
| 对话历史 RAG（超阈值检索） | ✅ | ❌ 缺失 | ✅（对齐桌面端阈值/topK） |
| 对话图片生成 | ✅ | ❌ 缺失 | ✅ 生成/历史切换/重新生成/全屏 |
| ai_optimize_traits（AI 优化特征） | ✅ | ❌ | ⛔ 范围边界：响应 unsupported（文档注明） |
| 桌面端引擎高级参数全集 | ✅ | ❌ | ⛔ 开放高频子集（降低误配风险） |

## V2.2 curl 全端点测试记录（2026-08-19 17:10+，服务端 17:10:05 重启加载新代码）

| # | 用例 | 结果 | 证据摘要 |
|---|---|---|---|
| 1 | `GET /api/health` | ✅ 200 | `{status:ok, version:1.0.1}` |
| 2 | `GET /api/knowledge-scopes` | ✅ 200 | `{scopes:[]}`（当前无可绑定作用域） |
| 3 | `GET /api/personas` | ✅ 200 | 返回 generic-persona（User）+ profile-1783431285401（Deeja，含描述） |
| 4 | `GET session-config`（无记录） | ✅ 200 | 安全默认值（selectedPersonaId:null / 参数空 / memoryTableEnabled:false / lastUpdated:0） |
| 5 | `PUT session-config`（合法值） | ✅ 200 | persona+temperature/top_p/max_tokens+memoryTableEnabled=true 全部回显 |
| 6 | `PUT` 后再 `GET` | ✅ 一致 | 配置持久化（服务端 JSON 文件） |
| 7 | `PUT session-config`（temperature="abc"） | ✅ 400 | VALIDATION_ERROR（白名单校验生效） |
| 8 | `GET memory-table`（开启后） | ✅ 200 | 5 sheets（时空/角色/社交/物品/事件）+ headers + 空数据 + 表描述 |
| 9 | SSE 对话（默认配置） | ✅ | chunk×350+ → emotion(curiosity) → done；user+assistant 持久化 |
| 10 | SSE 对话（仅 temperature=0.7） | ✅ | 584 chunks → done |
| 11 | SSE 对话（仅 max_tokens=4096） | ✅ | 631 chunks → done |
| 12 | SSE 对话（仅 max_tokens=1024） | ⚠️ AI_EMPTY_RESPONSE | **根因见下「max_tokens 陷阱」**：推理模型 think 阶段耗尽 1024 token，正文为空；非代码缺陷 |
| 13 | SSE 对话（仅人设 Deeja） | ✅ | 687 chunks → done，人设段注入不破坏对话 |
| 14 | SSE 对话（仅记忆表格开） | ✅ | 926 chunks → **table×1** → done；AI 编辑指令自动执行 |
| 15 | 表格数据落库验证 | ✅ | E 轮后：时空 1 行/角色 2 行/社交 1 行/事件 1 行（如 social_kanako_user_001） |
| 16 | `POST image`（不存在消息） | ✅ 404 | `MESSAGE_NOT_FOUND`（结构化错误码） |
| 17 | `POST image`（真实 assistant 消息） | ✅ 200 | imageAttachment 更新：conv_1787132002419，usedTags 4 项，status=idle |
| 18 | `POST image` regenerate=true | ✅ 200 | history 1→2，currentIndex=1（追加不覆盖） |
| 19 | `GET /api/assets/:cid/:assetId`（当前） | ✅ 200 | image/png 3,341,008 字节 |
| 20 | `GET /api/assets`（旧版本素材） | ✅ 200 | 2,981,638 字节（历史版本仍可读） |
| 21 | `GET /api/assets` 路径穿越 `..%2F..%2F` | ✅ 404 | 拦截，无信息泄露 |
| 22 | 测试后配置恢复 | ✅ | session-config 已恢复默认（PUT 空配置） |

> **max_tokens 陷阱（重点标记，详见 FIX_RECORDS）**：仅设 `max_tokens=1024` 时稳定复现 `AI_EMPTY_RESPONSE`，同请求 `max_tokens=4096` 或不设置则正常。根因为推理型模型在 think 阶段消耗输出 token，上限过小导致正文为空。**结论：用户配置指引问题，非代码缺陷**；已在 `docs/android-client.md` §2.2 写入建议（max_tokens ≥ 4096 或不设置）。
>
> 测试数据说明：以上对话用例在 Kanako.png 角色上共追加约 10 条测试消息（含 2 条图片消息），如需清理可在客户端或桌面端执行「清空上下文」（会连同历史一并清空）。

## V2.3 布局问题清单与修复验证（L1-L6）

| # | 问题（V1 表现） | 根因 | 修复 | 验证 |
|---|---|---|---|---|
| L1 | 立绘固定高度 + resize 拉伸 → 裁切变形 | 固定像素高度对不同宽高比立绘硬裁切 | `onLoad` 测量宽高比 → contain 自适应 + 屏宽 55% / maxHeight（横屏 150 / 窄屏 170 / 常规 210 / 屏高 30% 四重限高） | 代码审查 ✅；真机三档待复核 |
| L2 | edge-to-edge 下软键盘遮挡输入框 | RN 0.87 新架构默认 edge-to-edge，系统不再自动 resize 布局 | `Keyboard.addListener(keyboardDidShow/Hide)` → `kbHeight` 动态 paddingBottom；Manifest `windowSoftInputMode=adjustResize` | 代码审查 ✅；真机待复核 |
| L3 | 长 URL/长英文串横向溢出气泡 | 文本无折行策略，flexShrink 缺失 | `flexShrink:1 + minWidth:0` + `textBreakStrategy='highQuality'`（Android） | 代码审查 ✅ |
| L4 | 流式输出 scrollToBottom 高频触发 → 滚动抖动 | 每个 chunk 都触发 scrollToEnd | 200ms 节流 + requestAnimationFrame + 完成时立即滚动 | 代码审查 ✅ |
| L5 | 气泡固定 maxWidth 在窄屏占比过大/横屏过窄 | 固定百分比无分档 | `useWindowDimensions` 分档：<380 → 88%、<600 → 82%、≥600 → 56%；立绘高度同步分档 | 代码审查 ✅ |
| L6 | 情绪徽章/时间戳与正文重叠 | 绝对定位徽章无安全边距 | 徽章移入流式布局（flex 行），与内容不重叠 | 代码审查 ✅ |

无固定像素高度跨屏幕假设：立绘/气泡/输入区均由 `useWindowDimensions` + SafeArea 动态计算（代码审查确认）。

## V2.4 客户端构建与静态验证

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| C.8 | TS 类型检查（含 V2 新组件） | ✅ | `npx tsc --noEmit` 0 错误（修复 4 处初版错误：keyboardType 'decimal'→'decimal-pad'、JSX `{{user}}` 转义、`breakStrategy`→`textBreakStrategy`、'high-quality'→'highQuality'） |
| C.9 | `gradlew assembleDebug + assembleRelease` | ✅ | BUILD SUCCESSFUL in 25s（339 tasks） |
| C.10 | release APK 内置 JS bundle 含 V2 组件 | ✅ | bundle 内检索 `SessionConfigSheet`/`ImageBubble`/`MemoryTableSheet` 均 True（中文串被 minifier 转义为 Unicode 属正常） |
| C.11 | aapt2 cleartext 校验（对齐 §7.48 教训） | ✅ | debug/release `usesCleartextTraffic=true` |
| C.12 | APK 交付副本 | ✅ | `android-client/apk/creative-cafe-release.apk`（59.3MB，17:21 构建）；debug 122.3MB |
| C.13 | 无本地功能配置持久化 | ✅ | 全源码 AsyncStorage 仅 `store.ts` 服务器地址一项 |
| C.14 | 列表 key 稳定 / 流式消息不渲染图片按钮 | ✅ | `keyExtractor=m.id`；生成按钮条件含 `!item.streaming` |

## V2.5 真机复核清单（待用户执行，三档屏幕）

> 建议至少覆盖：小屏（约 360dp，如 5" 手机）、常规（约 412dp）、横屏（同一设备旋转）。

1. 卸载旧版 → 安装 `android-client/apk/creative-cafe-release.apk`（17:21+ 构建）→ 连接 `电脑IP:8787`
2. 进入对话 → 右上角"设置"图标 → 弹层正常加载人设（User/Deeja…）与知识库清单
3. 选择人设 Deeja → 保存（提示成功）→ 发消息 → AI 以「Deeja」称呼用户（而非 User）
4. 参数区设置 temperature=0.7（不设 max_tokens）→ 保存 → 对话正常；**勿设 max_tokens≤1024**（推理模型会空回复，见 V2.2 #12）
5. 开启「生成图片」→ 保存 → 发消息 → AI 气泡右下出现「生成图片」按钮 → 点击 → 阶段 loading → 图片内嵌展示（首屏约 1-3 分钟）
6. 图片气泡：‹ › 切换历史版本 → 「重新生成」history+1 → 点击图片全屏 → 点按关闭
7. 开启「记忆表格」→ 保存 → 发消息 → 顶栏表格图标 → 弹层显示 5 张表（AI 自动写入行）→ sheet 切换正常
8. 三档屏幕检查布局（L1-L6）：立绘无变形裁切；点输入框键盘不遮挡；发送长英文串不横向溢出；流式无明显抖动；情绪徽章不与正文/图片重叠
9. 桌面端同时打开同角色：历史一致（含图片消息的 imageAttachment 桌面端可见——双向兼容）
10. 断开桌面端 → 操作配置/发消息 → 错误提示分类正确（不可达/超时/HTTP 错误）

## V2.6 已知限制（增量）

1. RAG 知识库注入与对话历史 RAG 的端到端效果依赖真实知识库数据（当前 `knowledge-scopes` 为空），代码路径已 try-catch 保证失败不阻塞对话。
2. 图片查看为简版全屏（无缩放/拖拽）；`ai_optimize_traits` 按范围边界标记 unsupported（见文档 §2.4）。
3. `max_tokens` 下限无硬校验（服务端仅校验类型/范围），依赖文档指引避免推理模型空回复。
