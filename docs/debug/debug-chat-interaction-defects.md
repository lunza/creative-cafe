# Debug Session: chat-interaction-defects

- **Status**: [CLOSED]（2026-08-20 全部修复并实测通过）
- **Started**: 2026-08-20
- **Spec**: `.trae/specs/fix-android-chat-interaction-parity/`
- **Scope**: 移动端对话界面 5 项功能缺陷（对齐 PC 端）

## 1. 症状（用户报告）

1. 头像点击无全屏查看（需支持放大/缩放/关闭）
2. 对话气泡形状、边角、颜色、对齐、内外边距与 PC 端不一致
3. 「卷回」「重新生成」按钮丢失
4. 辅助模式选项点击直接发送，应先填入输入框可编辑
5. 其他与 PC 端差异项（全面检查）

## 2. 假设与静态证据（Step 1-2，未改动任何业务代码）

| # | 假设（可证伪） | 静态证据 | 判定 |
|---|----------------|----------|------|
| H1 | AI/用户头像均未绑定 onPress，且无缩放查看器 | `ChatScreen.tsx` L482-493（AI 头像 Image 无 onPress）、L539-545（用户头像为纯文字圈） | 待运行时确认 |
| H2 | 气泡几何/配色偏离 PC CSS 基准：小角在顶角 6dp（PC 底角 4px）、圆角 20（PC 18）、padding 14/10（PC 16/12）、无名字行/序号徽章、文本不可选中 | `ChatScreen.tsx` L779-816 vs `ChatMessageBubble.css` L262-290 | 待运行时确认 |
| H3 | 卷回/重新生成从未实现；LAN API 无消息截断接口 | `server.ts` L809-824 路由清单无 rollback；`ChatScreen.tsx` 仅 retryLast（失败态） | 待运行时确认 |
| H4 | 辅助模式选项 `onPress={() => doSend(opt)}` 直接发送 | `ChatScreen.tsx` L554 | 待运行时确认 |
| H5 | 服务端 SSE 每轮 append user 消息（`dialogue.ts` L833 `messagesToSave = [...history, ...greeting, userMessage, assistantMessage]`），重新生成若不先回退历史会产生重复 user 消息 | `dialogue.ts` L833-847 | 待运行时确认 |

## 3. 修复方案（最小改动）

- 服务端：`POST /api/chats/:characterId/rollback`（截断 chatStorage 历史并持久化）
- 客户端：AvatarViewer 缩放查看器、气泡样式对齐 PC CSS、操作按钮行（复制/重新生成/卷回）、辅助模式填入输入框
- 重新生成 = rollback 最后 user 消息 + 相同内容重发（规避 H5 重复问题）

## 4. 运行时验证记录（实施后补充）

### 4.1 服务端 curl 实测（SubTask 2.2，2026-08-20）

| 用例 | 请求 | 结果 |
|---|---|---|
| 卷回正常路径 | 发送 "rollback test V5" → rollback user 消息 | 3→1 条，`{success:true, content:"rollback test V5", removedCount:2}` ✓ |
| MESSAGE_NOT_FOUND | rollback 不存在 id | 404 ✓ |
| NOT_USER_MESSAGE | rollback assistant(greeting) 消息 | 400 ✓ |
| CHARACTER_NOT_FOUND | rollback 不存在角色 | 404 ✓ |
| BAD_REQUEST | messageId 为空 | 400 ✓ |
| done.userMessageId | SSE done 事件 | 含 `userMessageId` 字段 ✓ |

### 4.2 模拟器实测（AVD test36，release APK，2026-08-20）

**通过项：**
- 消息流全链路：发送 "hello_test_v5" → SSE 流式回复 ✓（服务端 3 条记录）
- 名字行：AI "Lucky" [168,456] / 用户 "User" [269,627] ✓
- 情绪标签："(尴尬)" [269,988]（emotion=embarrassment）✓
- 序号徽章："#1" [286,460] / "#2" [380,992] ✓
- 操作按钮：AI「复制」[158,520]「重新生成」[335,520]；用户「卷回到输入框」[749,881] ✓
- 卷回交互：点击后本地列表截断至 greeting、输入框填入 "hello_test_v5"、服务端同步 1 条 ✓
- 用户头像无 persona 图时回退字母圈 "U" ✓
- 气泡颜色：AI 气泡浅玻璃 #FAF6F1 底、名字行紫色 #8B76C9（palette.nameAI）✓（像素级验证）

**发现缺陷 D1（已修复）：AvatarViewer 未挂载**
- 症状：点击 AI 头像无任何反应（屏幕保持亮色，无黑遮罩）
- 根因：`ChatScreen.tsx` 中 AvatarViewer 已 import、`avatarViewerUrl` state 与 `openAvatarViewer` 均存在，但组件**从未加入 JSX 渲染树**（上下文截断导致的半成品）
- 修复：在 Snackbar 前挂载 `<AvatarViewer visible={avatarViewerUrl !== null} url={avatarViewerUrl} onDismiss={...} />`
- 复测：✓ 已通过（见 4.3 AvatarViewer 实测）

**发现缺陷 D2（已修复）：AI 头像沉底——长消息时头像对齐到消息底部甚至滚出屏幕**
- 症状：初始屏幕点击 AI 名字行左侧（x=100, y=690）无任何反应；像素扫描头像列（x=28-140, y=628-750）纯背景色。滚动 3 屏后在消息底部（y=1450-1545）发现头像图片
- 根因：`styles.bubbleRow` 使用 `alignItems: 'flex-end'`；AI 头像的 `alignSelf: 'flex-start'` 写在**内层 Animated.View（avatarWrap）**上，而外层 `Pressable` 无 style——alignSelf 只影响 Pressable 内部（无效果），Pressable 本身继承容器的 flex-end 底对齐。对比：用户头像的 Pressable 直接带 style（avatarWrap），alignSelf 生效所以顶对齐正常
- 修复：`bubbleRow.alignItems` 改为 `'flex-start'`（对齐 PC `.chat-msg-inner` 默认顶对齐——PC CSS 无 align-items 覆盖，固定高度头像顶对齐）
- 复测：✓ 已通过（22:55 重建 APK，头像 y≈1470 与名字行 y=1466 顶对齐，见 4.4）

**发现缺陷 D3（已修复）：用户消息整体靠左显示（PC 端右对齐）**
- 症状：像素级验证用户气泡 x=31-462、名字行 "User" x=382-449、头像 x=490-580——全部堆在屏幕左侧；PC 端 `.chat-msg-wrapper.is-user { justify-content: flex-end }` 用户消息右对齐
- 根因：`bubbleRow` 无 `justifyContent`（row 默认 flex-start），`contentColUser` 的 `alignItems: 'flex-end'` 只让名字/气泡在 contentCol **内部**右对齐，而 contentCol 本身 shrink-to-fit 紧贴左侧
- 修复：新增 `bubbleRowUser: { justifyContent: 'flex-end' }`，renderItem 中 `isUser && styles.bubbleRowUser`
- 复测：✓ 已通过（名字 User x=662-729、气泡 x=415-698、头像 x=761-866、卷回按钮 x=749-1049 全部右对齐，见 4.4）

### 4.3 AvatarViewer 全屏查看实测（AVD test36，2026-08-20，D1 修复后构建）

| 用例 | 操作 | 结果 |
|---|---|---|
| 打开查看器 | 点击 AI 头像（消息底部 y=1465，D2 修复前位置） | ✓ 黑遮罩 (25,24,24) + 中心立绘内容 |
| 双击放大 | tap(540,1200) ×2 | ✓ 1x→2.5x，图片覆盖全屏（四角均为图片色） |
| 双击还原 | tap(540,1200) ×2 | ✓ 2.5x→1x，恢复黑边框+居中图 |
| 单击关闭 | tap(540,1200)（延迟判定窗口后触发） | ✓ 恢复对话页亮色背景 |
| 关闭按钮 | tap(982,160)（右上角白色 X 图标） | ✓ 恢复对话页 |
| 系统返回键 | keyevent 4 | ✓ 关闭查看器且未退出对话页 |
| 用户头像无图提示 | 点击用户消息头像（无 persona 头像） | ✓ Snackbar「当前人设未设置头像」 |
| 双指捏合 | adb 无法模拟多点触控 | ⚠ 代码审查通过（PanResponder 双指距离比例缩放，1x–4x 限幅），留待真机复核 |

**测试方法学备注：**
- uiautomator dump 对 RN Fabric 的 FlatList 转储不稳定（有时丢失大量节点），需多次滚动后重新 dump 交叉验证
- 中文命令行参数经 PowerShell 传递会因编码损坏（curl -d 中文 JSON 报 BAD_REQUEST），服务端测试须用英文内容
- 像素分析（screencap + System.Drawing）可有效弥补 uiautomator 缺失：验证了名字行紫色文本、气泡底色
- dump 有时显示**滞后的旧内容**（如流式完成 12 秒后 dump 仍显示流式中间态），必须以"重新 dump + 服务端 API 状态"双源交叉验证

### 4.4 五项功能全流程复测（AVD test36，D2/D3 修复后 22:55 构建 APK，2026-08-20）

| # | 用例 | 操作 | 结果 |
|---|---|---|---|
| 1 | 气泡布局（D2+D3） | 滚动至用户消息区 | ✓ AI 头像 y≈1470 与名字行 y=1466 顶对齐；用户名字 x=662/气泡 x=415-698/头像 x=761-866/卷回按钮 x=749-1049 全部右对齐 |
| 2 | 辅助模式 | 点击第 1 个推荐选项 | ✓ Snackbar「已填入输入框，可编辑后发送」+ 文本进输入框（y=2147-2311）；服务端消息数不变（未直接发送） |
| 3 | 卷回 | 点击用户消息「卷回到输入框」按钮 | ✓ Snackbar「已卷回到输入框」+ 内容填入输入框 + 本地列表截断至 greeting；服务端同步 3→1 条 |
| 4 | 空历史卷回（边界） | 卷回后列表仅剩 greeting | ✓ 无用户消息 → 无卷回按钮可点，无异常 |
| 5 | 发送+流式 | 输入 regen_v7 发送 | ✓ 流式逐字输出、自动跟随底部；流式期间操作按钮行不渲染（`!item.streaming`）、完成后出现 |
| 6 | 流式期间按钮禁用 | 流式中点击「重新生成」位置 | ✓ 点击无效（disabled={streaming}），UI 与服务端无变化 |
| 7 | 重新生成 | 流式完成后点击「重新生成」 | ✓ 服务端 rollback 截断 regen_v7 对（5→3 条）→ 重发 → 5 条含新回复，**无重复 user 消息**；客户端显示新回复与服务端一致 |
| 8 | 窄屏（900x2400@420dpi ≈ 343dp < 380） | wm size 900x2400 | ✓ 顶栏/气泡（x=186-723 自适应）/输入区无错位重叠 |
| 9 | 常规（1080x2400 ≈ 411dp） | 默认 | ✓ 全部测试在此档完成 |
| 10 | 横屏（2400x1080） | wm size 2400x1080 | ✓ 气泡限宽 x=192-1295（isLandscape 分支生效）不占满全宽 |
| 11 | 暗色主题 | 列表页右上角切换 | ✓ 页面背景 RGB(20,17,16)=#141110、AI 气泡 RGB(28,27,40)≈rgba(30,30,46,0.8) 与 PC 端原值一致 |
| 12 | 亮色主题 | 切回 | ✓ 恢复亮色（此前所有测试均在亮色下通过） |

**回归检查（既有功能）**：思考面板/图片气泡/记忆表格/会话配置弹层在测试过程中正常打开与渲染（4.2 会话配置弹层实测截图记录在案），无回归。

## 5. 结论

**全部 5 项缺陷已修复并通过模拟器运行时实测**（AVD test36，release APK）：

| 缺陷 | 修复 | 状态 |
|---|---|---|
| 1. 头像无全屏查看 | AvatarViewer 组件（捏合 1x–4x/双击 1x↔2.5x/拖拽平移/三种关闭方式）+ JSX 挂载 | ✅ 实测通过（捏合留待真机） |
| 2. 气泡渲染与 PC 不一致 | 圆角 18/小角 4、padding 16/12、名字行+情绪标签+序号徽章、顶对齐（D2）、用户右对齐（D3）、亮暗双主题配色 | ✅ 像素级验证通过 |
| 3. 卷回/重新生成按钮丢失 | 服务端 rollback 接口 + 客户端 API/UI 按钮 + onDone 同步 userMessageId | ✅ 全流程通过（含边界） |
| 4. 辅助模式直接发送 | 选项 onPress → setInput + Snackbar 提示 | ✅ 实测通过 |
| 5. 其他差异 | 发现并修复 D1（Viewer 未挂载）/D2（头像沉底）/D3（用户消息靠左） | ✅ 复测通过 |

会话状态：CLOSED（2026-08-20）
