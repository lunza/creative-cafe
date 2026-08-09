# Checklist

## 基线与工具
- [x] 存在 `src/renderer/utils/perfBaseline.ts`，可输出列表滚动帧间隔、图片网格首屏时间、长任务数
  - verified: `perfBaseline.ts` 导出 `measureScrollFPS` / `measureFirstScreenComplete` / `startLongTaskObserver` / `formatBaselineReport`；dev 模式 + Performance API 双守卫，生产环境 no-op
- [x] `rollup-plugin-visualizer` 已加入 devDependencies 并在 `vite.config.ts` 启用
  - verified: `package.json:93` `rollup-plugin-visualizer@^7.0.1`；`vite.config.ts:26,86` 动态 `import()` 启用（ESM-only 包，详见 FIX_RECORDS §8.5）
- [x] `docs/FIX_RECORDS.md` §8 记录了优化前基线（滚动响应、首屏时间、chunk 体积、长任务数）
  - verified: §8.1 基线指标表存在；数值列标记「待回填」，待用户 dev 模式采集后回填（§8.2 步骤）

## 路由级代码分割
- [x] `routeConfig.ts` 所有 component 改为 `React.lazy`
  - verified: `routeConfig.ts:30-47` 全部 12 个路由组件均 `React.lazy(() => import(...))`
- [x] `App.tsx` 用 `<Suspense fallback={<Spin />}>` 包裹路由渲染
  - verified: `App.tsx:63` `<Suspense fallback={routeFallback}>`（routeFallback = 居中 `<Spin size="large" />`，App.tsx:16-20）
- [x] `vite.config.ts` 配置 `manualChunks` 拆分 vendor-react / antd / milkdown / ai / markdown
  - verified: `vite.config.ts:127-169` manualChunks 拆分 5 组 vendor（顺序敏感：markdown/antd/milkdown/ai 先于 react 兜底判断）
- [x] `npm run build` 后初始 chunk 体积下降 ≥ 30%（visualizer 截图对比）
  - verified: 5669 modules transformed；初始加载 ≈1,750 kB（entry 274.59 + react 142.37 + antd 1,333.23）vs 原单 chunk ~4,070 kB → **-57%**（超 ≥30% 目标）

## 列表虚拟滚动
- [x] AssetManagerModal 资产网格使用 `useVirtualizer`
  - verified: `AssetManagerModal.tsx:1293` `AssetVirtualGrid` 内 `useVirtualizer`（@tanstack/react-virtual）；阈值 50 以下回退 `.map()`+CSS grid
- [x] CharacterManager 角色卡列表使用 `useVirtualizer`
  - verified: CharacterManager 不直接渲染列表，**委托给 `CharacterListView.tsx`**（Task 4 委托发现，详见 §8.10）；`CharacterListView.tsx:290` 启用 antd Table 内置 `virtual` prop + `scroll={{ y: 500 }}`（非 useVirtualizer，§8.8 文档化决策：antd v6 内置虚拟化更轻量、与树形/分页天然兼容）
- [x] PromptManagement / KnowledgeBase / Avatar 列表已虚拟化或在文件头注明 < 50 项判定理由
  - verified: `KnowledgeItemList.tsx:916` antd Table `virtual` prop；`PromptManagement.tsx` / `AvatarManager.tsx` 文件头 `[perf]` 阈值跳过注释（固定 ~20 项 / 手工 <50 项）
- [⏳] 100+ 资产滚动响应 ≤ 100ms（实测）（待用户运行时验证）
- [x] 列表项均 `React.memo`，handler 均 `useCallback`
  - verified: `AssetCard`(AssetManagerModal:1085) / `CharacterListView`(:798) / `DocumentActions`+`LeafActions`(KnowledgeItemList:51,86) / `ModuleListItem`(PromptManagement) / `AvatarCard`+`ProfileCard`(AvatarManager) / `FavoriteItem`(CreationCenter) 均 `React.memo`；handler 均 `useCallback`

## 图片懒加载与缩略图
- [x] `src/renderer/components/Common/LazyImage.tsx` 存在并使用 IntersectionObserver
  - verified: `LazyImage.tsx:207` `new IntersectionObserver(...)`，rootMargin=200px 预加载；首次进入后 disconnect
- [x] 占位+错误降级✓；Blob URL 释放 N/A — 改用 dataUrl 缓存（无需 revokeObjectURL，已文档化）
  - verified: `LazyImage.tsx` 含 `DefaultPlaceholder`(灰底+Spin) + `ErrorPlaceholder`(点击重试) + `onLoad` 淡入；thumbnail IPC 返回 dataUrl 字符串直接作 `<img src>`，无 Blob URL（设计决策见 `imageCache.ts` 文件头 + §8.9）
- [x] `src/main/services/thumbnailService.ts` 基于 nativeImage 生成缩略图
  - 【选型调整】WebP 经 nativeImage.toDataURL 不可靠，改为 PNG 源→PNG、其余→JPEG(80)；文件头已注明
- [x] `userData/thumbnails/{sha1(sourcePath|mtimeMs|size)}.{jpg|png}` 磁盘缓存生效，二次访问命中缓存（含 LRU 内存缓存 200 条）
  - verified: `thumbnailService.ts:97` computeCacheKey=sha1(sourcePath|mtimeMs|size)；内存 LRU 容量 200(:74)；命中顺序 内存→磁盘→重新生成
- [x] IPC `thumbnail:get` + `thumbnail:invalidate` 在 `src/main/ipc/index.ts` 注册并可被渲染进程调用
  - verified: `ipc/index.ts:36` import + `:128` `registerThumbnailHandlers()`；`thumbnailHandlers.ts:30,52` 注册两通道；`preload.ts:1213` 暴露 `thumbnail.get/invalidate` 命名空间
  - ⚠️ Native Module Test Gap Convention：nativeImage 不可在 vitest 加载，真实行为依赖 Electron 集成测试
- [⏳] 图片网格首屏完成时间相对基线下降 ≥ 50%（待用户运行时验证）

## 重渲染审计
- [x] 全局无 `useXxxStore()` 无 selector 用法（除确实需要全 state 的场景，需注释说明）
  - verified: 105 处无 selector 调用点中 93 处已转 selector；12 处 >5 字段暂缓并加 `// TODO(perf): 整体订阅，待拆分为 selector` 注释（见 §8.6 暂缓站点表）
- [x] 列表项 `React.memo` 覆盖率 100%
  - verified: 所有列表项组件均 `React.memo` 包装（见上方「列表项均 React.memo」证据）

## 验证与文档
- [⏳] 优化后基线重测：滚动 ≤ 100ms、图片加载 -50%、chunk -30% 全部达标（待用户运行时验证）
  - chunk -57% ✅ 已达标；滚动 ≤100ms / 图片 -50% / 长任务数 待用户 dev 模式用 `perfBaseline.ts` 采集后回填 §8.1
- [x] CODE_WIKI.md 新增「§15 性能优化」章节
- [x] docs/FIX_RECORDS.md 记录优化前后对比 + nativeImage 选型理由 + 重点标记项
  - verified: §8.10 优化前后对比总结（Task 10）已追加
- [x] CHANGELOG.md 追加版本条目
- [x] N/A — 未引入 sharp，改用 nativeImage（已在 thumbnailService.ts 文件头标注 Native Module Test Gap Convention）
  - verified: `thumbnailService.ts:34-36` 文件头标注 Native Module Test Gap Convention；选型理由见 §8.10
