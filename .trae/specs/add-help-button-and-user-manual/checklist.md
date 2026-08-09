# Checklist

## IPC 文档读取通道
- [x] `docsHandlers.ts` 文件已创建，注册了 `docs:read` 通道
- [x] `docs:read` 通道能正确从 `docs/` 目录读取指定 Markdown 文件并返回文本内容
- [x] 文件不存在时返回 `{ success: false, error }` 错误结构
- [x] 开发环境路径解析使用 `getProjectRoot()`，生产环境使用 `process.resourcesPath` 兜底
- [x] `index.ts` 中已导入并调用 `docsHandlers()` 注册通道
- [x] `preload.ts` 中已添加 `docs` 命名空间，暴露 `read` 方法

## 生产环境打包配置
- [x] `electron-builder.json` 已添加 `extraResources` 配置，将 `docs/` 复制到 `resources/docs/`
- [x] 配置格式正确，不影响现有打包流程

## 用户手册文档
- [x] `docs/user-manual.md` 文件已创建
- [x] 文档包含 8 个一级章节，顺序严格为：总体导览和仪表盘 → 设置（重要） → 角色卡 → 世界书 → 创作中心 → 记忆管理（高级） → 知识库（高级） → 提示词管理（高级）
- [x] "设置"章节内容深度充足，包含每个配置项的详细说明和推荐值
- [x] 包含面向首次接触 AI 系统的新用户引导流程
- [x] 使用简洁语言，专业术语有解释
- [x] 复杂操作有分步说明
- [x] 包含常见问题解答（FAQ）部分
- [x] Markdown 格式正确，支持 GFM（表格、任务列表等）

## HelpViewer 组件
- [x] `HelpViewer.tsx` 组件已创建，接收 `open` 和 `onClose` props
- [x] 使用 antd `Modal` 全屏展示
- [x] 左侧目录栏基于 Markdown 一级标题自动生成章节列表
- [x] 点击目录章节可跳转到对应内容位置
- [x] 右侧内容区使用 `react-markdown` + `remark-gfm` + `remark-emoji` 渲染 Markdown
- [x] 搜索框支持全文模糊搜索（使用 `fuse.js`）
- [x] 搜索结果展示匹配文本片段并高亮关键词
- [x] 点击搜索结果可跳转到对应位置
- [x] 内容区滚动时左侧目录自动高亮当前章节
- [x] 通过 `window.electronAPI.docs.read('user-manual.md')` 加载文档内容
- [x] `HelpViewer.css` 样式文件已创建
- [x] 宽屏（> 1024px）时目录栏 280px，内容区自适应
- [x] 窄屏（≤ 768px）时目录栏可折叠
- [x] 暗色主题下显示正常
- [x] Markdown 元素（标题、段落、列表、表格、代码块、引用块）排版良好

## Header 帮助按钮
- [x] Header.tsx 中已在刷新按钮左侧添加"帮助"按钮
- [x] 按钮使用 `QuestionCircleOutlined` 图标
- [x] 按钮样式与刷新按钮、主题切换按钮一致（`type="text"`）
- [x] 点击按钮打开 HelpViewer 弹窗
- [x] 窄屏（≤ 480px）时按钮仅显示图标

## 技术文档更新
- [x] `.trae/documents/技术文档.md` 已新增"帮助系统"章节
- [x] 记录了帮助按钮位置、HelpViewer 架构、IPC 通道、文档维护规范、打包配置
- [x] 根目录 `CODE_WIKI.md` 已新增 §34 帮助文档查看器章节（用户规则：根目录技术文档增量更新）

## TypeScript 验证
- [x] `npx tsc --noEmit` 检查通过：`Header.tsx`、`HelpViewer.tsx`、`electron.d.ts` 零错误
- [x] 未引入新的 TypeScript 错误（项目仅存 1 个历史遗留错误：`writing.constants.ts` 的 `ProjectStatus.ARCHIVED`，与本次改动无关）
