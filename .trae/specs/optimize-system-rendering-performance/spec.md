# 系统渲染性能优化方案 Spec

> change-id: `optimize-system-rendering-performance`
> 创建日期: 2026-08-06
> 遵循 Self-Improving + Proactive Agent 原则：先测量后优化、最小实现优先、可量化可验证。

## Why

用户反馈当前系统存在两类明显卡顿：

1. **列表类页面滚轮响应延迟达 1-2 秒**——角色卡列表、素材库网格、提示词列表、知识库列表、收藏夹等。
2. **图片较多页面首次加载卡顿**——素材管理弹窗（立绘 / 一般图像 / 三视图网格）打开后明显掉帧。

代码审计已定位根因（非猜测，均有点击可查的源码证据）：

- `@tanstack/react-virtual` 已安装（v3.14.9）但**仅在 2 个文件**使用：`WorldBookEntryTable.tsx`、`VirtualizedMessageList.tsx`。其余列表/网格组件（AssetManagerModal 资产网格、CharacterManager、PromptManagement、KnowledgeBase、Avatar/Favorites）均使用 `Array.map` 一次性渲染全部 DOM 节点。
- 图片 `<img>` 普遍未启用懒加载，仅 `MessageRenderer.tsx`、`LoraSelectModal.tsx`、`CharacterSelectorPanel.tsx` 3 个文件用了 `loading="lazy"`；素材网格既无懒加载、也无缩略图、也无 WebP。
- [routeConfig.ts](file:///g:/AI/creative-cafe/src/renderer/routeConfig.ts) 中所有路由均为同步 `import`，未使用 `React.lazy`；[vite.config.ts](file:///g:/AI/creative-cafe/vite.config.ts) 渲染进程 build 未配置 `manualChunks`，所有页面被打进单一 chunk，首屏体积过大。
- 无性能基线、无 bundle 分析工具，优化效果无法量化——这是最大的"自我改进"盲区。

**本方案目标**：列表滚动响应 ≤ 100ms、图片加载时间相对基线下降 ≥ 50%、初始 chunk 体积下降 ≥ 30%，且所有指标可量化、可验证。

## What Changes

- **新增性能基线与测量工具**：引入 `rollup-plugin-visualizer` 做包体积分析；新增渲染性能测量工具（Performance API），固化优化前基线数据。
- **路由级代码分割**：`routeConfig.ts` 改用 `React.lazy` + `Suspense`；`vite.config.ts` 增加 `manualChunks` 拆分 vendor（react / antd / milkdown / ai-sdk / markdown）。
- **列表虚拟滚动**：AssetManagerModal 资产网格、CharacterManager 角色卡列表、PromptManagement、KnowledgeBase、Avatar/Favorites 改用 `@tanstack/react-virtual`。
- **图片懒加载组件**：新增 `<LazyImage>` 组件（IntersectionObserver + 占位 + 错误降级 + Blob URL 释放），替换网格类 `<img>`。
- **缩略图管线（主进程）**：优先基于 Electron `nativeImage`（零新原生依赖，遵循"最小实现优先"）生成缩略图，磁盘缓存于 `userData/thumbnails/{hash}.webp`，配合渲染进程 LRU Blob URL 缓存；若质量不足再评估切换 `sharp` 并遵守 Native Module Test Gap Convention。
- **重渲染审计**：zustand store 订阅改用 selector；列表项 `React.memo` + `useCallback`。
- **文档增量更新**：CODE_WIKI.md 新增「§15 性能优化」章节；docs/FIX_RECORDS.md 记录基线/优化前后对比与重点问题；CHANGELOG.md 追加条目。

## Impact

- **受影响代码**：
  - `vite.config.ts`（manualChunks + visualizer）
  - `src/renderer/routeConfig.ts`（React.lazy 改造）+ `src/renderer/App.tsx`（Suspense 包裹）
  - `src/renderer/components/Character/CharacterDialogueChat/AssetManagerModal.tsx`（资产网格虚拟化 + LazyImage）
  - `src/renderer/components/Character/CharacterManager.tsx`（角色卡列表虚拟化）
  - `src/renderer/components/PromptManagement/`、`src/renderer/components/KnowledgeBase/`、`src/renderer/components/Avatar/`（列表虚拟化）
  - 新增 `src/renderer/components/Common/LazyImage.tsx`
  - 新增 `src/renderer/utils/perfBaseline.ts`、`src/renderer/utils/imageCache.ts`
  - 新增 `src/main/services/thumbnailService.ts` + `src/main/ipc/handlers/thumbnailHandlers.ts`
  - 各 store 订阅点（selector 化）
- **受影响文档**：CODE_WIKI.md（新增性能章节）、docs/FIX_RECORDS.md（基线/对比记录）、CHANGELOG.md
- **风险**：
  - 虚拟滚动需处理动态行高（资产网格卡片高度可能不一致）。
  - `nativeImage` 缩略图质量不及 `sharp`，若不满意需切换并增加原生构建复杂度（受 Native Module Test Gap Convention 约束）。
  - 路由懒加载后首屏切换会有 Spin fallback，需保证 fallback 体验。
  - 部分列表当前数据量小（< 50 项），无需虚拟化，需逐页判定阈值。

## ADDED Requirements

### Requirement: 性能基线与可量化验证
系统 SHALL 在优化前固化性能基线，并在优化后提供可量化对比。

#### Scenario: 基线测量
- **WHEN** 开发者执行性能基线测量
- **THEN** 系统记录：列表滚动平均帧间隔、图片网格首屏完成时间、初始 chunk 体积、长任务（>50ms）数量

#### Scenario: 优化后验证
- **WHEN** 优化完成并重测
- **THEN** 列表滚动响应 ≤ 100ms、图片加载时间相对基线下降 ≥ 50%、初始 chunk 体积下降 ≥ 30%

### Requirement: 路由级代码分割
系统 SHALL 对所有路由组件按需加载，并按 vendor 拆分 chunk。

#### Scenario: 首屏加载
- **WHEN** 用户启动应用进入仪表盘
- **THEN** 仅加载 dashboard chunk + vendor-react + vendor-antd 核心，其余页面 chunk 按需懒加载

#### Scenario: 切换页面
- **WHEN** 用户切换到「世界书」
- **THEN** 该页面 chunk 异步加载，期间显示 Suspense fallback（Spin），不阻塞主线程

### Requirement: 列表虚拟滚动
系统 SHALL 对渲染超过阈值（默认 50 项）的列表/网格使用虚拟滚动，仅渲染可视区域 DOM。

#### Scenario: 大列表滚动
- **WHEN** 列表数据 ≥ 50 项且用户滚动
- **THEN** DOM 节点数恒定在可视区域 + overscan 范围，滚动响应 ≤ 100ms

#### Scenario: 小列表回退
- **WHEN** 列表数据 < 50 项
- **THEN** 可回退为普通渲染（避免虚拟化开销）

### Requirement: 图片懒加载与缩略图管线
系统 SHALL 仅加载可视区域内图片，并通过主进程缩略图管线提供压缩缩略图。

#### Scenario: 网格首屏
- **WHEN** 用户打开含 100+ 图片的素材网格
- **THEN** 仅请求可视区域内缩略图，首屏完成时间相对基线下降 ≥ 50%

#### Scenario: 滚动加载
- **WHEN** 用户滚动使新图片进入可视区
- **THEN** 触发该图片缩略图加载，已滚出图片释放 Blob URL

#### Scenario: 加载失败降级
- **WHEN** 图片加载失败
- **THEN** 显示占位图与重试入口，不抛出未捕获异常

### Requirement: 重渲染最小化
系统 SHALL 通过 selector 订阅与 memoization 避免列表项无关重渲染。

#### Scenario: store 更新
- **WHEN** zustand store 局部字段更新
- **THEN** 仅订阅该字段的组件重渲染，列表项不因父级无关 state 更新而重渲染

## MODIFIED Requirements

### Requirement: 路由加载
- 原：`routeConfig.ts` 所有路由同步 `import`，全部打进主 chunk。
- 改：改为 `React.lazy(() => import(...))` 动态导入；`App.tsx` 包裹 `<Suspense fallback={<Spin />}>`。

### Requirement: 列表渲染
- 原：`Array.map` 全量渲染 DOM。
- 改：超过阈值（50 项）使用 `@tanstack/react-virtual` 虚拟滚动，仅渲染可视区域。

### Requirement: 图片渲染
- 原：`<img src={file://...}>` 全量加载原图。
- 改：`<LazyImage>` 走缩略图 IPC + 懒加载 + 渲染进程 Blob URL 缓存。

## REMOVED Requirements
无（本方案为增量优化，不删除既有功能；仅替换渲染策略）。
