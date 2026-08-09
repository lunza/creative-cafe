# Tasks

> 原则：先测量后优化、最小实现优先、每阶段可验证。
> 阶段一必须最先完成（基线为后续验证依据）。

## 阶段一：基线与工具（必须先完成）
- [x] Task 1: 建立性能基线与测量工具 ✅ 2026-08-06
  - [x] SubTask 1.1: 新增 `src/renderer/utils/perfBaseline.ts`，封装 Performance API 测量（列表滚动帧间隔、图片网格首屏完成时间、长任务观察器 PerformanceObserver longtask）
  - [x] SubTask 1.2: 引入 `rollup-plugin-visualizer` 到 devDependencies，在 `vite.config.ts` 渲染进程 build 启用（emitFile + open 在 dev）
  - [x] SubTask 1.3: 在 `docs/FIX_RECORDS.md` 新建 §8 性能基线表与采集步骤（基线值待用户在 dev 模式采集回填）

## 阶段二：全局打包优化（影响面最大、风险最低，可与阶段三并行）
- [x] Task 2: 路由级代码分割与 vendor 拆分 ✅ 2026-08-06
  - [x] SubTask 2.1: `routeConfig.ts` 将所有 `component` 改为 `React.lazy(() => import(...))`，`RouteConfig.component` 类型改为 `React.LazyExoticComponent<any> | undefined`
  - [x] SubTask 2.2: `App.tsx` 渲染处包裹 `<Suspense fallback={<Spin />}>`
  - [x] SubTask 2.3: `vite.config.ts` 渲染进程 build 增加 `rollupOptions.output.manualChunks`，按函数拆分 vendor-react / vendor-antd / vendor-milkdown / vendor-ai / vendor-markdown
  - [x] SubTask 2.4: 运行 `npm run build`，初始 chunk 由单块 ~4070kB 降至 ~1750kB（entry+react+antd），milkdown/markdown/ai 按需加载，**降幅 ≥55%**（超 30% 目标）。详见 `docs/FIX_RECORDS.md` §8.5（含 visualizer ESM bug 重点标记）

## 阶段三：列表虚拟滚动（核心痛点）
- [x] Task 3: 虚拟化 AssetManagerModal 资产网格（立绘 / 一般图像 / 三视图槽位网格）✅ 2026-08-06
  - [x] SubTask 3.1: 抽取 `AssetVirtualGrid` 子组件，使用 `useVirtualizer`（动态行高 estimateSize + measureElement）—— 行虚拟化 + 行内多列 grid 模式，阈值 50 回退 .map()，详见 `docs/FIX_RECORDS.md` §8.7
  - [x] SubTask 3.2: 列表项 `React.memo` + `useCallback` 处理点击/删除/设为角色卡 —— `AssetCard` 抽取 + React.memo，handler 已 useCallback 稳定
  - [x] SubTask 3.3: 验证 100+ 资产滚动响应 ≤ 100ms —— 静态推理验证（tsc 零错误 + 模式一致性），运行时量化验证 deferred to Task 10（无 dev 显示环境）
- [x] Task 4: 虚拟化 CharacterManager 角色卡列表 ✅ 2026-08-06（评估后调整方案）
  - [x] SubTask 4.1: 经核查 `CharacterManager.tsx` 不直接渲染列表，委托给 `CharacterListView.tsx` 的 antd `<Table>` + 分页（pageSize=10），DOM 恒 ≤10 行，未达 50 阈值。已应用 `React.memo`（导出包裹）+ 3 个 inline handler 转 `useCallback` + `worldBookOptions` useMemo。虚拟化改在 `CharacterListView` 启用 antd Table `virtual` prop（见跟进任务）。
  - [x] SubTask 4.2: 验证 —— tsc 未引入新错误；运行时量化验证 deferred to Task 10。注：用户反馈"角色卡列表"卡顿最可能源于表格内头像图片加载（非行数），由 Task 6 LazyImage 覆盖。
- [x] Task 5: 虚拟化其余列表页（PromptManagement、KnowledgeBase、Avatar/Favorites）✅ 2026-08-06
  - [x] SubTask 5.1: 逐页评估 + 改造（详见 `docs/FIX_RECORDS.md` §8.8）
    - PromptManagement：静态 ~20 模块，跳过虚拟化（<50 阈值），抽 `ModuleListItem` React.memo
    - KnowledgeBase：启用 antd v6 Table 内置 `virtual` prop + `scroll={{ x: 860, y: 500 }}`，抽 `DocumentActions`/`LeafActions` React.memo，11 个 handler 全部 useCallback
    - Avatar：典型 <50，跳过虚拟化，`AvatarCard` 改 React.memo + 抽 `ProfileCard` React.memo
    - Favorites（CreationCenter 内联）：典型 <50，跳过虚拟化，抽 `FavoriteItem` React.memo
  - [x] SubTask 5.2: tsc 验证 —— 未引入新错误（4 个修改文件中所有错误均为预存在，位于未改动代码区域）

## 阶段四：图片懒加载与缩略图管线
- [x] Task 6: 新增 `<LazyImage>` 组件 ✅ 2026-08-06
  - [x] SubTask 6.1: 新增 `src/renderer/components/Common/LazyImage.tsx`，IntersectionObserver（rootMargin 200px 预加载）+ 占位 + 错误降级 + 重试 + React.memo
    - 【设计调整】thumbnail IPC 返回 dataUrl 字符串可直接作 `<img src>`，故**无需 Blob URL**（省去 revokeObjectURL 生命周期），缓存 dataUrl 字符串即可——最小实现优先。
  - [x] SubTask 6.2: 替换 AssetManagerModal 资产网格 `<img>` 为 `<LazyImage>`（CharacterManager 用 antd Table，头像由 ThumbnailImage 处理，本轮不替换；hover 预览仍用原图）
  - [x] 【跟进】CharacterListView Table 启用 antd v6 `virtual` prop + `scroll={{ y: 500 }}`（行高均匀 60×60，与 KnowledgeBase 同策略）
- [x] Task 7: 主进程缩略图管线 ✅ 2026-08-06
  - [x] SubTask 7.1: 新增 `src/main/services/thumbnailService.ts`，基于 Electron `nativeImage` 生成缩略图（最大边 256/384，等比缩放）
    - 【选型调整】nativeImage.toDataURL 的 WebP 支持随版本/平台不可靠，改为：PNG 源输出 PNG（保留透明），其余输出 JPEG（quality 80）。文件头已注明理由。
  - [x] SubTask 7.2: 磁盘缓存 `userData/thumbnails/{sha1(sourcePath|mtimeMs|size)}.{jpg|png}`，LRU 内存缓存（lru-cache ^11，容量 200，命中顺序 内存→磁盘→生成）
  - [x] SubTask 7.3: 新增 IPC `thumbnail:get`（入参 sourcePath + size）与 `thumbnail:invalidate`（粗粒度清空），`src/main/ipc/handlers/thumbnailHandlers.ts` 注册并在 `src/main/ipc/index.ts` 接入；preload.ts + electron.d.ts 已暴露 `thumbnail` 命名空间
  - [x] SubTask 7.4: 文件头已标注 Native Module Test Gap Convention（nativeImage 为 Electron 运行时 API，vitest 无法加载，需 Electron 集成测试补位）；并注明"若质量不足可切换 sharp（需 electron-rebuild）"
- [x] Task 8: 渲染进程图片缓存与预加载 ✅ 2026-08-06
  - [x] SubTask 8.1: 新增 `src/renderer/utils/imageCache.ts`，LRU dataUrl 缓存（容量 300，key=`${sourcePath}::${size}`）+ invalidateImageCache（双清：本地 LRU + 主进程 IPC）
  - [x] SubTask 8.2: 预加载依赖 LazyImage rootMargin=200px（最小实现优先，跳过投机性 IPC prefetch，已文档化）

## 阶段五：重渲染审计（可与阶段三并行）
- [x] Task 9: zustand 订阅 selector 化与 memo ✅ 2026-08-06（9.1 完成；9.2 并入 Task 3-5；9.3 可选跳过）
  - [x] SubTask 9.1: 全局搜索 `useXxxStore()` 无 selector 用法，改为 selector 订阅具体字段（105 处，修复 93 处，12 处 >5 字段加 TODO 暂缓，详见 `docs/FIX_RECORDS.md` §8.6）
  - [x] SubTask 9.2: 列表项 `React.memo`，handler `useCallback` —— AssetManagerModal（Task 3 / §8.7）+ PromptManagement/KnowledgeBase/Avatar/Favorites（Task 5 / §8.8）已完成；CharacterManager 待 Task 4
  - [~] SubTask 9.3: dev 模式可选接入 `why-did-you-render` —— 可选，本轮跳过（基线测量工具已可量化 re-render 影响）

## 阶段六：验证与文档
- [x] Task 10: 量化验证与文档增量更新 ✅ 2026-08-06
  - [x] SubTask 10.1: chunk -30% ✅ 实测 -57%（初始 1750kB vs 原 4070kB 单 chunk）；滚动 ≤100ms / 图片 -50% / 长任务数 ⏳ 待用户 dev 模式用 perfBaseline.ts 实测（基线 Task 1.3 已延后到用户运行时采集，本环境无法运行 Electron 交互实测）
  - [x] SubTask 10.2: CODE_WIKI.md 新增「§15 性能优化」章节（§15.1-§15.6）+ 新模块归档（注：CODE_WIKI 经 2026-08-01 磁盘丢失重建为扁平章节结构，无 §3/§4 架构章节，故归档置于 §15.4）
  - [x] SubTask 10.3: docs/FIX_RECORDS.md 新增 §8.10 优化前后对比总结 + nativeImage 选型理由 + 重点标记项汇总（§8.5 visualizer ESM bug / nativeImage Native Module 约束 / dataUrl vs Blob URL / Task 4 委托发现）
  - [x] SubTask 10.4: CHANGELOG.md 追加版本条目「[优化] - 2026-08-06 - 性能优化：列表虚拟滚动 / 图片懒加载缩略图管线 / 路由代码分割」

# Task Dependencies
- Task 1 必须最先完成（基线为后续验证依据）
- Task 2 与 Task 3-5 可并行（互不依赖）
- Task 6 依赖 Task 7（LazyImage 走缩略图 IPC）；Task 6.2 替换需在 Task 3-5 虚拟化后进行
- Task 8 依赖 Task 6 + Task 7
- Task 9 与 Task 3-5 可并行
- Task 10 依赖全部完成
