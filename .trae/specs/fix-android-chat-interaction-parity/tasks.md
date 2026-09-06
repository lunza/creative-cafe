# Tasks

- [x] Task 1: 初始化调试会话：创建 `debug-chat-interaction-defects.md`（项目根目录），记录 5 项缺陷假设与调研证据基线（PC 端基准行为表）
- [x] Task 2: 服务端 rollback 接口：`src/main/services/lanapiserver/server.ts` 新增 `POST /api/chats/:characterId/rollback`（body `{ messageId }`），加载 chatStorage 历史 → 校验 user 消息 → 截断持久化 → 返回 `{ success, content, removedCount }`；错误码 `CHARACTER_NOT_FOUND`/`MESSAGE_NOT_FOUND`/`NOT_USER_MESSAGE`；`npm test` 通过（含既有测试无回归）
  - [x] SubTask 2.1: handler 实现 + 路由注册
  - [x] SubTask 2.2: curl 实测（正常/异常路径）
- [x] Task 3: 客户端 API 封装：`android-client/src/api/client.ts` 新增 `rollbackChat(baseUrl, characterId, messageId)`，复用 apiPost 错误处理
- [x] Task 4: AvatarViewer 组件：新增 `android-client/src/components/AvatarViewer.tsx`——全屏 Modal 黑遮罩 + 双指捏合缩放（PanResponder，1x–4x）+ 双击 1x/2.5x 切换 + 放大后单指拖拽平移 + 单击关闭 + 右上角关闭按钮 + onRequestClose 支持系统返回键
- [x] Task 5: ChatScreen 气泡样式对齐 PC：圆角 18（用户右下小角 4 / AI 左下小角 4）、padding 16/12、用户气泡 indigo→violet 渐变、AI 气泡半透明深色 + 边框（亮色主题浅色玻璃底）；补名字行（用户名/角色名 + 情绪标签 + AI 序号徽章）；气泡文本 selectable；时间戳保留
- [x] Task 6: 头像点击查看集成：AI 头像/立绘 Pressable 包裹 → AvatarViewer（当前 portraitUrl 原图）；用户头像加载 persona 头像（sessionConfig.selectedPersonaId → `/api/personas/:id/avatar`，404 回退文字圈），有图可点击查看
- [x] Task 7: 消息操作按钮行：AI 气泡下方「复制（content-copied 图标 + Snackbar）/ 重新生成（refresh 图标）」小图标行，与「生成图片」胶囊并列；用户气泡下方「卷回到输入框（undo/rollback 图标）」；卷回调 rollbackChat → 截断本地 messages → 内容填入 input + Snackbar；重新生成 = rollback 最后 user 消息 + doSend(相同内容)；流式期间全部禁用
- [x] Task 8: 辅助模式修复：选项 `onPress` 改为 `setInput(opt)` + Snackbar「已填入输入框，可编辑后发送」，移除直接 doSend
- [x] Task 9: 构建验证：android-client `npx tsc --noEmit` 0 错误；`assembleRelease` 构建通过；APK 复制到 `android-client/apk/`；安装到模拟器
- [x] Task 10: 模拟器运行时实测（AVD test36）：五项功能全流程 + 边界条件（空历史卷回/流式禁用/无 persona 头像/长文本/图片消息共存）+ 三档屏幕（窄屏 <380 / 常规 / 横屏）+ 亮暗主题；截图留证并更新 debug 文件结论
- [x] Task 11: 文档增量更新：`docs/android-client.md`（新接口 + 交互说明）、`CHANGELOG.md`、`FIX_RECORDS.md`（重点标记本批缺陷）；输出测试报告（测试用例、结果、修复前后对比）

# Task Dependencies

- Task 3 依赖 Task 2；Task 7 依赖 Task 3；Task 6 依赖 Task 4
- Task 5、Task 8 相互独立，可并行
- Task 9 依赖 Task 2–8 全部完成；Task 10 依赖 Task 9；Task 11 依赖 Task 10
