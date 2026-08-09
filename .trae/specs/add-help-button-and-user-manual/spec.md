# 帮助按钮与用户手册 Spec

## Why
用户缺少系统使用指引，首次接触 AI 系统的新用户难以独立完成配置和操作。需要在顶部导航栏添加"帮助"按钮，点击后展示本地 Markdown 用户手册，提供包含章节导航和内容搜索的阅读体验。

## What Changes
- 在 Header 组件的刷新按钮左侧添加"帮助"按钮（`QuestionCircleOutlined` 图标）
- 新增 `HelpViewer` 弹窗组件，使用 antd `Modal` 全屏展示用户手册
- 使用 `react-markdown` + `remark-gfm` 渲染 Markdown 内容（项目已有依赖）
- 实现文档内导航（左侧目录树，基于一级/二级标题自动生成）
- 实现文档内容搜索（使用项目已有的 `fuse.js` 依赖）
- 在 `docs/` 目录下创建 `user-manual.md` 用户手册文档，包含 8 个一级章节
- 新增 IPC 通道 `docs:read` 用于从磁盘读取文档文件
- 配置 `electron-builder.json` 的 `extraResources` 确保生产环境包含 docs 目录

## Impact
- Affected code:
  - `src/renderer/components/Layout/Header.tsx` — 添加帮助按钮
  - `src/renderer/components/Help/HelpViewer.tsx` — 新建帮助查看器组件
  - `src/renderer/components/Help/HelpViewer.css` — 新建样式文件
  - `src/main/ipc/handlers/docsHandlers.ts` — 新建文档读取 IPC handler
  - `src/main/preload.ts` — 暴露 `docs` 命名空间到渲染进程
  - `src/main/ipc/index.ts` — 注册 docsHandlers
  - `docs/user-manual.md` — 新建用户手册文档
  - `electron-builder.json` — 添加 extraResources 配置
  - `.trae/documents/技术文档.md` — 增量更新技术文档

## ADDED Requirements

### Requirement: 帮助按钮
系统 SHALL 在顶部导航栏 Header 右侧区域、刷新按钮的左侧提供一个"帮助"按钮，使用 `QuestionCircleOutlined` 图标，点击后打开用户手册查看器。

#### Scenario: 用户点击帮助按钮
- **WHEN** 用户点击 Header 中的"帮助"按钮
- **THEN** 系统打开 HelpViewer 弹窗，展示用户手册内容

#### Scenario: 响应式显示
- **WHEN** 窗口宽度 ≤ 480px
- **THEN** 帮助按钮仅显示图标，隐藏文字标签（与刷新按钮、主题切换按钮行为一致）

### Requirement: 用户手册查看器
系统 SHALL 提供一个全屏 Modal 弹窗作为用户手册查看器，包含左侧目录导航栏和右侧 Markdown 内容渲染区。

#### Scenario: 打开查看器
- **WHEN** HelpViewer 弹窗打开
- **THEN** 左侧显示基于 Markdown 一级标题自动生成的章节目录列表
- **AND** 右侧渲染用户手册 Markdown 内容
- **AND** 默认选中并定位到第一章"总体导览和仪表盘"

#### Scenario: 章节导航
- **WHEN** 用户点击左侧目录中的某个章节
- **THEN** 右侧内容区滚动到对应章节位置
- **AND** 左侧目录高亮当前选中章节

#### Scenario: 滚动联动
- **WHEN** 用户在右侧内容区滚动
- **THEN** 左侧目录自动高亮当前可见章节

#### Scenario: 关闭查看器
- **WHEN** 用户点击 Modal 关闭按钮或按 ESC 键
- **THEN** 关闭 HelpViewer 弹窗，返回原页面

### Requirement: 文档内容搜索
系统 SHALL 在 HelpViewer 中提供搜索框，支持全文模糊搜索。

#### Scenario: 搜索内容
- **WHEN** 用户在搜索框中输入关键词
- **THEN** 系统在用户手册全文中进行模糊搜索
- **AND** 展示匹配结果列表（包含匹配文本片段和高亮关键词）
- **WHEN** 用户点击某个搜索结果
- **THEN** 右侧内容区跳转到对应位置并高亮关键词

#### Scenario: 清空搜索
- **WHEN** 搜索框为空
- **THEN** 隐藏搜索结果列表，恢复完整目录导航

### Requirement: 响应式设计
HelpViewer SHALL 在不同窗口尺寸下提供良好的阅读体验。

#### Scenario: 宽屏显示（> 1024px）
- **WHEN** 窗口宽度 > 1024px
- **THEN** 左侧目录栏宽度 280px，右侧内容区自适应填充剩余空间

#### Scenario: 窄屏显示（≤ 768px）
- **WHEN** 窗口宽度 ≤ 768px
- **THEN** 左侧目录栏可折叠（通过按钮切换显示/隐藏），右侧内容区全宽显示

### Requirement: 用户手册文档
系统 SHALL 在 `docs/user-manual.md` 中维护用户手册，文档结构包含以下一级章节且严格遵循指定顺序：

1. 总体导览和仪表盘
2. 设置（重要）
3. 角色卡
4. 世界书
5. 创作中心
6. 记忆管理（高级）
7. 知识库（高级）
8. 提示词管理（高级）

#### Scenario: 文档内容要求
- **GIVEN** 用户手册文档已创建
- **THEN** 文档内容详尽且易于理解
- **AND** "设置"章节具有特别深度的内容和图文说明
- **AND** 包含面向新用户的引导流程
- **AND** 使用简洁语言，必要时提供术语解释
- **AND** 复杂操作提供分步说明
- **AND** 包含常见问题解答（FAQ）部分

### Requirement: 文档读取 IPC
系统 SHALL 提供 `docs:read` IPC 通道，用于从磁盘读取 docs 目录下的 Markdown 文件。

#### Scenario: 读取用户手册
- **WHEN** 渲染进程调用 `window.electronAPI.docs.read('user-manual.md')`
- **THEN** 主进程从项目根目录的 `docs/` 文件夹读取对应文件
- **AND** 返回 Markdown 文本内容

#### Scenario: 文件不存在
- **WHEN** 请求的文档文件不存在
- **THEN** 返回 `{ success: false, error: '文档文件不存在' }`

### Requirement: 生产环境文档打包
系统 SHALL 在 electron-builder 配置中通过 `extraResources` 将 `docs/` 目录包含到生产构建中，确保打包后用户手册可被读取。

#### Scenario: 生产环境读取文档
- **GIVEN** 应用已打包为生产版本
- **WHEN** 用户点击帮助按钮
- **THEN** 系统从 `resources/docs/user-manual.md` 读取文档内容并正常渲染
