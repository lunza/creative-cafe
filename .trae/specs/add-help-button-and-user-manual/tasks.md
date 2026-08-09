# Tasks

- [x] Task 1: 创建 IPC 文档读取通道
  - [x] SubTask 1.1: 创建 `src/main/ipc/handlers/docsHandlers.ts`，注册 `docs:read` 通道，从项目根目录 `docs/` 文件夹读取指定 Markdown 文件，返回文本内容；文件不存在时返回 `{ success: false, error }`。使用 `getProjectRoot()` (来自 `src/main/utils/appPath.ts`) 解析根路径，生产环境使用 `process.resourcesPath` 作为兜底。
  - [x] SubTask 1.2: 在 `src/main/ipc/index.ts` 中导入并调用 `docsHandlers()` 注册通道。
  - [x] SubTask 1.3: 在 `src/main/preload.ts` 的 `electronAPI` 对象中添加 `docs` 命名空间，暴露 `read: (fileName: string) => ipcRenderer.invoke('docs:read', fileName)` 方法。

- [x] Task 2: 配置生产环境文档打包
  - [x] SubTask 2.1: 在 `electron-builder.json` 中添加 `extraResources` 配置项，将 `docs/` 目录复制到 `resources/docs/`，确保生产环境可访问用户手册文件。

- [x] Task 3: 创建用户手册 Markdown 文档
  - [x] SubTask 3.1: 在 `docs/user-manual.md` 创建用户手册，严格按以下一级章节顺序编写：
    1. 总体导览和仪表盘 — 介绍系统整体布局、侧边栏导航、仪表盘功能概览
    2. 设置（重要） — 详细说明 AI 引擎配置（API Key、Base URL、模型选择）、模型能力检测、温度/Token 参数、主题切换等，包含分步操作指引和术语解释
    3. 角色卡 — 角色卡创建、编辑、导入导出、字段说明、角色卡对话
    4. 世界书 — 世界书概念解释、条目创建、关键词触发、AI 审计功能
    5. 创作中心 — 聊天模式、创作流程、Agent 模式、图片生成
    6. 记忆管理（高级） — 记忆表概念、会话记录、记忆整理
    7. 知识库（高级） — 文档上传、向量化、知识检索
    8. 提示词管理（高级） — 提示词模板创建与管理
  - [x] SubTask 3.2: 在文档末尾添加"常见问题解答（FAQ）"部分，覆盖新用户常见困惑（如 API 连接失败、模型不响应、角色卡导入失败等）。
  - [x] SubTask 3.3: 在"设置"章节中使用 Markdown 图片占位符（`![描述](图片路径)`）标注截图位置，使用文字详细描述每个配置项的含义和推荐值，确保即使无截图也能理解操作步骤。

- [x] Task 4: 创建 HelpViewer 组件
  - [x] SubTask 4.1: 创建 `src/renderer/components/Help/HelpViewer.tsx` 组件：
    - 接收 `open: boolean` 和 `onClose: () => void` props
    - 使用 antd `Modal` 全屏展示（width: '100vw', style: { top: 0, maxWidth: '100vw', paddingBottom: 0 }）
    - 左侧目录栏：解析 Markdown 文本提取一级标题（`# `）生成章节列表，使用 antd `Menu` 或自定义列表渲染，支持点击跳转
    - 右侧内容区：使用 `react-markdown` + `remark-gfm` + `remark-emoji` 渲染 Markdown 内容，包裹在可滚动容器中
    - 顶部搜索栏：使用 antd `Input.Search`，输入关键词时使用 `fuse.js` 对全文分段搜索，展示匹配结果列表
    - 滚动联动：监听内容区滚动事件，根据当前可见标题自动高亮左侧对应章节
    - 通过 `window.electronAPI.docs.read('user-manual.md')` 加载文档内容
  - [x] SubTask 4.2: 创建 `src/renderer/components/Help/HelpViewer.css` 样式文件：
    - 目录栏固定宽度 280px，内容区自适应
    - 响应式断点：≤ 768px 时目录栏可折叠
    - Markdown 内容区样式：标题、段落、列表、表格、代码块、引用块等均有良好排版
    - 搜索结果高亮样式
    - 兼容暗色主题（`.dark` 选择器）

- [x] Task 5: 在 Header 中添加帮助按钮
  - [x] SubTask 5.1: 在 `src/renderer/components/Layout/Header.tsx` 的 `header-right` 区域、刷新按钮之前添加"帮助"按钮：
    - 导入 `QuestionCircleOutlined` 图标
    - 导入 `HelpViewer` 组件
    - 添加 `useState` 控制 HelpViewer 弹窗开关
    - 按钮样式与刷新按钮一致（`type="text"`，带图标和文字标签）
    - 点击按钮打开 HelpViewer

- [x] Task 6: 增量更新技术文档
  - [x] SubTask 6.1: 在 `.trae/documents/技术文档.md` 中新增"帮助系统"章节，记录：
    - 帮助按钮位置和交互行为
    - HelpViewer 组件架构（目录导航、搜索、Markdown 渲染）
    - `docs:read` IPC 通道说明
    - `docs/user-manual.md` 文档维护规范
    - `electron-builder.json` extraResources 配置说明
  - [x] SubTask 6.2: 在根目录 `CODE_WIKI.md` 新增 §34 帮助文档查看器 HelpViewer 章节（用户规则：根目录技术文档增量更新）。

# Task Dependencies
- [Task 2] depends on [Task 1]（需要 IPC 通道路径逻辑与打包配置一致）
- [Task 4] depends on [Task 1]（HelpViewer 需要调用 `docs:read` IPC）
- [Task 4] depends on [Task 3]（HelpViewer 渲染用户手册内容）
- [Task 5] depends on [Task 4]（Header 引用 HelpViewer 组件）
- [Task 6] depends on [Task 1] ~ [Task 5] 全部完成
