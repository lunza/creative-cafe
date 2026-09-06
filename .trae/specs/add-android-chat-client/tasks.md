# Tasks

## 服务端（creative-cafe）

- [x] Task 1: LAN HTTP 基础框架与 /api/health
  - [x] 新增 `src/main/services/lanApiServer/server.ts`：Node 内置 http 服务 + 极简路由 + 统一 JSON 错误处理 + 请求超时
  - [x] 端口/开关接入服务端设置（默认 8787、默认开启），主进程启动时拉起（`src/main/index.ts` 集成）
  - [x] 实现 `GET /api/health`（状态 + 版本）
  - [x] 验证：桌面端正常启动，`curl http://<局域网IP>:8787/api/health` 返回 200
- [x] Task 2: 角色卡与表情资源 API
  - [x] `GET /api/characters`（复用 character 服务列出角色卡：id/名称/描述摘要/tags/头像URL/spec版本）
  - [x] `GET /api/characters/:id`（完整卡片数据）、`GET /api/characters/:id/avatar`（PNG 二进制）
  - [x] `GET /api/characters/:id/expressions` 与 `/expressions/:emotion`（复用 expression 服务，返回情绪键清单与立绘二进制）
  - [x] 所有 `:id` 白名单校验（防路径穿越），不存在返回 404 CHARACTER_NOT_FOUND
  - [x] 验证：curl 逐一验证列表/详情/头像/立绘接口与错误码
- [x] Task 3: 服务端 headless 对话管线
  - [x] 抽取渲染进程对话纯逻辑到主进程可引用位置：提示词构建（角色卡主提示词 + 关联世界书注入 + 特征/表情 prompt）、上下文截断、回复情绪标签解析（对齐 EMOTION_PROMPT_MAP 行为）
  - [x] 主进程 AI 引擎流式调用（读取服务端当前启用的引擎配置；参考现有 main 进程 AI 服务的调用方式）
  - [x] 消息持久化复用 characterChat 存储（与桌面端同源）
  - [x] 单元自测：Node 侧直接调用管线函数验证提示词拼装与情绪解析输出
- [x] Task 4: 对话 API（SSE）
  - [x] `GET /api/chats/:characterId`（历史消息）、`POST /api/chats/:characterId/clear`（清空上下文）
  - [x] `POST /api/chats/:characterId/messages`：SSE 流式响应，事件 `chunk`/`emotion`/`done`/`error`；失败不写入 assistant 消息
  - [x] 验证：curl 发送消息观察 SSE 事件序列；失败场景（停用 AI 配置）验证 error 事件与服务端不崩溃

## 客户端（android-client/）

- [x] Task 5: 构建环境准备
  - [x] PowerShell 脚本自动安装 JDK17 + Android cmdline-tools + platform/build-tools（约 2-3GB），设置 ANDROID_HOME 并接受许可
  - [x] 验证：`java -version`、`sdkmanager --list_installed`、gradle wrapper 可用
- [x] Task 6: React Native 工程初始化
  - [x] `android-client/` 初始化 RN（当前稳定版），集成 react-native-paper（Material 3）、zustand、SSE 客户端（react-native-sse 或等价实现）
  - [x] 验证：`npx react-native run-android`（或 gradle assembleDebug）在模拟器/真机装起空白应用
- [x] Task 7: 网络层与连接页
  - [x] API client（baseURL、5s 连接超时、幂等 GET 重试 1 次、统一错误分类：不可达/超时/版本不兼容）
  - [x] 连接页：地址输入、测试连接（/api/health）、保存最近成功地址、启动自动重连
  - [x] 验证：正确/错误地址两种路径的表现
- [x] Task 8: 角色列表页
  - [x] Material 3 角色卡列表（头像/名称/描述摘要/tags）、按名称与 tags 即时搜索、空态提示、下拉刷新、点击进入对话页
  - [x] 验证：与服务端角色卡数据一致，搜索过滤正确
- [x] Task 9: 对话页
  - [x] 进入加载历史（GET /api/chats/:id）；消息气泡（用户右/AI 左 + 时间戳，纯文本渲染）
  - [x] 发送消息 → SSE 流式逐字更新气泡；`emotion` 事件切换表情立绘（失败回退默认头像）；`done` 定格
  - [x] 清空上下文按钮（POST clear）；流式失败显示重试；导航返回列表页
  - [x] 验证：真机全流程（历史/流式/立绘/清空/失败重试）

## 交付

- [x] Task 10: APK 构建
  - [x] `gradlew assembleDebug` + `assembleRelease`（release 使用 debug 签名占位并在文档注明）
  - [x] 产出 APK 复制到 `android-client/apk/` 并记录路径
  - [x] 验证：APK 可在真机安装运行
- [x] Task 11: 文档与测试报告
  - [x] `docs/android-client.md`：构建说明、API 调用说明（含 SSE 协议与示例）、调试指南（服务端日志、常见连接问题）
  - [x] `docs/android-client-test-report.md`：按 spec R1–R6 逐项功能测试结果
  - [x] `CODE_WIKI.md` 架构章节增量更新（新增 lanApiServer 与 android-client）、`CHANGELOG.md` 记录本次变更
  - [x] 验证：文档与实际接口/路径一致

# Task Dependencies
- Task 2、3、4 依赖 Task 1（服务端框架先行）
- Task 4 依赖 Task 3（管线先于 SSE 接口）
- Task 6 依赖 Task 5（构建环境）
- Task 7→8→9 顺序依赖；Task 7 可与服务端 Task 1–4 并行（按 spec.md 接口契约先行 mock）
- Task 10 依赖 Task 9；Task 11 依赖全部完成
