# Tasks

- [x] Task 1: 调色板与视觉语言基础（theme.ts）
  - [x] 1.1 重设计亮/暗调色板：中性暖色主色替换紫色，新增玻璃态语义色（glassBg、scrim、skeleton、bubbleGradientStart/End）
  - [x] 1.2 更新 Palette 接口，确保全部现有 `createStyles(palette)` 工厂兼容
  - [x] 1.3 更新 paperLightTheme / paperDarkTheme 映射
- [x] Task 2: 立绘头像化（ChatScreen.tsx 结构改造）
  - [x] 2.1 移除顶部 portraitWrap 横幅区域（原 L1 逻辑），删除 portraitHeight/portraitRatio/emotionBadge 渲染
  - [x] 2.2 renderItem 中 AI 气泡左侧新增圆形立绘头像（情绪表情图 → 角色头像回退），用户气泡右侧默认用户头像
  - [x] 2.3 流式期间头像呼吸/打字动画（opacity 脉冲）
  - [x] 2.4 情绪切换时立绘头像平滑过渡
- [x] Task 3: 图片气泡重设计（ImageBubble.tsx 全面重写）
  - [x] 3.1 尺寸策略：按原始宽高比自适应，限宽限高，大圆角（16dp）+ 内阴影，弃用 1:1 aspectRatio
  - [x] 3.2 加载态：骨架屏（skeleton 色脉冲动画）+ 渐进淡入过渡
  - [x] 3.3 生成中：阶段进度条或脉冲占位，匹配新视觉语言
  - [x] 3.4 历史切换：胶囊控件（浮于底边半透明，·‹ ·/·N ·›·），切换淡入过渡
  - [x] 3.5 全屏查看：玻璃态半透明遮罩 + 长按/点击关闭
- [x] Task 4: 气泡与输入区视觉统一
  - [x] 4.1 AI 气泡：玻璃感卡片（半透背景 + 阴影 ），情绪色点缀左边框
  - [x] 4.2 用户气泡：主色渐变背景 + 微圆角（22dp 左上右下，6dp 右上左下）
  - [x] 4.3 思考面板 / options chips / 生成图片按钮：全部按新视觉重绘
  - [x] 4.4 输入区：圆角胶囊容器 + 发送按钮渐变 + 聚焦时背景层级
- [x] Task 5: 其余屏幕统一
  - [x] 5.1 ConnectScreen / CharacterListScreen / CharacterEditScreen：背景渐变、卡片玻璃化、圆角统一
  - [x] 5.2 SessionConfigSheet / MemoryTableSheet：玻璃态弹层（半透遮罩 + 圆角卡 + 阴影）
- [x] Task 6: 验证与交付
  - [x] 6.1 客户端 tsc 0 错误
  - [x] 6.2 assembleRelease 构建通过，APK 复制
  - [ ] 6.3 模拟器实测：立绘/图片/气泡/输入/主题切换全流程（亮暗 + 窄屏/常规/横屏三档）
  - [ ] 6.4 文档增量更新（android-client.md / CHANGELOG）

# Task Dependencies
- Task 1 是 Task 2-5 的基础（调色板先定，后续组件取色）
- Task 2、3、4 可并行（ChatScreen 结构改造 / ImageBubble 重写 / 气泡样式统一）
- Task 5 依赖 Task 1（调色板就绪后统一）
- Task 6 依赖全部完成