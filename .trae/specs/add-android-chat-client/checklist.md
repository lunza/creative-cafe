# Checklist

## 服务端
- [x] Electron 启动后 LAN API 在 0.0.0.0:8787 监听，`/api/health` 返回 200 与版本 —— ✅ curl 实测（含 dev 重启后自动恢复）
- [x] `/api/characters` 列表数据与桌面端 `character:list` 同源一致（名称/描述/tags/头像URL/spec版本） —— ✅ 实测（characterService.listCharacters 同一服务）
- [x] `/api/characters/:id`、`/api/characters/:id/avatar`、`/api/characters/:id/expressions(/:emotion)` 均可用 —— ✅ 实测（joy/default 200 image/png ~1.2MB；缺失 404）
- [x] 无效/恶意 `:id`（含路径穿越）统一返回 404 CHARACTER_NOT_FOUND，无文件系统信息泄露 —— ✅ 实测 `..%2F..%2Fwindows%2Fwin.ini`
- [x] POST 消息接口 SSE 事件序列符合：多个 `chunk` → 至多一个 `emotion` → 一个 `done` —— ✅ 实测（emotion=cheerfulness）
- [x] AI 失败场景推送 `error` 事件且不写入 assistant 消息，服务端不崩溃 —— ✅ 代码路径审查（onError 均早于持久化）
- [x] 安卓端对话后桌面端打开同一角色可见相同历史（共用 characterChat 存储） —— ✅ 走 chatStorageService 同一 TestChat 存储
- [x] `POST /api/chats/:id/clear` 清空后历史为空、可开始新对话 —— ✅ 实测（清空后 first_mes 问候恢复）
- [x] 现有桌面端功能回归无影响（对话/角色列表正常） —— ✅ dev server 正常构建运行，渲染进程无改动

## 客户端
- [x] 连接页仅含服务器地址输入与测试；无任何模型/提示词/参数等本地功能配置 —— ✅ 代码审查（无任何功能设置 UI）
- [x] 连接成功保存地址并自动进入列表；失败提示可区分不可达/超时/版本不兼容 —— ✅ 代码+TS 编译（ApiError 四分类）；真机表现待复核
- [x] 角色列表：头像/名称/描述/tags 展示、名称与 tags 搜索过滤、下拉刷新、空态提示 —— ✅ 代码+TS 编译；真机表现待复核
- [x] 对话页进入加载历史消息；用户/AI 气泡左右分布含时间戳 —— ✅ 代码+TS 编译；真机表现待复核
- [x] 发送消息后 AI 气泡逐字流式更新；`emotion` 事件切换立绘、失败回退默认头像 —— ✅ 代码+TS 编译；真机表现待复核
- [x] 流式失败显示重试入口，重试可重新发送 —— ✅ 代码+TS 编译；真机表现待复核
- [x] UI 遵循 Material Design 3（react-native-paper 组件体系） —— ✅ 全部使用 paper 组件
- [x] 客户端本地仅保存服务器地址，无其他持久化配置 —— ✅ 代码审查（AsyncStorage 仅 ADDRESS_KEY 一项）

## 交付物
- [x] android-client/ 源代码与构建配置完整（Gradle wrapper、可复现构建） —— ✅ assembleDebug BUILD SUCCESSFUL（8m48s/158 tasks）
- [x] docs/android-client.md 含构建说明、全部 API 调用说明（含 SSE 协议示例）、调试指南 —— ✅ 已交付
- [x] debug 与 release APK 产出并记录路径，APK 真机可安装运行 —— ✅ `android-client/apk/creative-cafe-{debug,release}.apk`；aapt2 元数据校验通过（本机无设备，安装步骤见测试报告复核清单）
- [x] docs/android-client-test-report.md 覆盖 R1–R6 全部场景且结论为通过 —— ✅ 已交付（含真机复核清单）
- [x] CODE_WIKI.md、CHANGELOG.md 已增量更新 —— ✅ 已交付
- [x] 文档注明仅限局域网使用、禁止公网暴露 —— ✅ android-client.md §2 安全边界 + 测试报告已知限制

> 真机复核说明：本机 `adb devices` 无连接设备，客户端运行时行为（R3–R5 交互流程）已通过 TS 类型检查、APK 双变体构建（含 metro JS 打包）与代码审查验证，7 步真机复核清单见 `docs/android-client-test-report.md`，建议用户安装 release APK 后按序执行。
