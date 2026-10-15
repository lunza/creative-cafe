/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——素材生成提示词模板（NUDE_FIXED_TAGS / buildAssetPromptTemplate）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L1947-L2050。
 */
// ==================== 素材生成提示词模板（illustration / general / three-view）====================
// Spec: add-asset-and-trait-management / Task 10（原始实现，原位于 AssetGenerateModal.tsx）

/**
 * 裸体版三视图固定 tag 列表（Spec: fix-asset-trait-and-scene-defects / Task 1）。
 *
 * 【重点标记 - 固定包含】这些 tag 在生成 *-nude 槽位三视图时强制拼接，
 * 不可被用户配置覆盖，确保生成结果始终包含裸体特征。
 *
 * 扩展原因：原 spec 仅硬编码 `nude, naked, bare skin` 三个 tag，覆盖面不足，
 * 补充 `completely naked` / `no clothes` / `nsfw` 增强 SD 模型对裸体语义的理解。
 *
 * 本常量是 nude tag 的唯一数据源（single source of truth），`buildAssetPromptTemplate`
 * 的 three-view 分支通过 `NUDE_FIXED_TAGS.join(', ')` 拼接，禁止在其它位置重复硬编码。
 */
export const NUDE_FIXED_TAGS: readonly string[] = [
  // 【2026-08-06 标签库审计精简】原含 naked/completely naked/no clothes，但 Danbooru/e621 标签库
  // 验证确认这三个均为 nude 的别名（alias），重复注入无增益。精简为：
  // - nude（核心 tag，count≈2.1M）
  // - bare_skin（下划线版本，count=76，低频但有独特语义）
  // - nsfw（虽不在 Danbooru 标签库，但 NoobAI 训练时注入，模型理解）
  'nude',
  'bare_skin',
  'nsfw',
];

/**
 * 根据 mode 与目标构建素材生成的正面提示词模板（不含表情）。
 *
 * 【重点标记 - 函数迁移说明】
 * 原实现位于 `AssetGenerateModal.tsx` 内部（非导出函数），后迁移至 `PromptBuilder.ts`
 * 并改为导出函数，与其它 build* 工具函数集中管理。`AssetGenerateModal.tsx` 改为从本文件导入。
 *
 * 模板规则：
 * - 立绘（illustration）：`{camera}, {traits}, high quality, best quality, masterpiece`
 *   【2026-08-06 初版】追加 `{camera}` 占位符，由 AssetGenerateModal 视角镜头下拉选择填充
 *   【2026-08-06 重构】移除写死的 `full body`（改为 {camera} 下拉默认值注入），避免与用户选的 close-up 等同类 tag 冲突；
 *   弹窗打开时默认初始化 selectedCameraAngle='full body'（AssetGenerateModal getCameraDefaultForMode），用户可改选 upper body 等
 * - 一般图像（general）：`{traits}, {camera}, high quality, best quality`
 *   【2026-08-06 新增】追加 `{camera}` 占位符，由 AssetGenerateModal 的视角镜头下拉选择填充
 * - 三视图（three-view）：根据 targetSlot 选择 front / side / back view 模板
 *   （已有穿衣/裸体分组逻辑）
 *   【2026-08-06 重点标记 - 三视图多角色 bug 修复】移除 `character sheet`（Danbooru 训练数据中天然指多视角合集图，
 *   导致一张三视图出现多个角色/多视角 collage），改为 `solo`（强化单角色）；保留 `white background` 干净参考风格。
 *   配合 AssetGenerateModal 负面提示词追加多角色/多视角约束。详见 docs/FIX_RECORDS.md §5.10
 *
 * 【重点标记 - 固定包含（Spec: fix-asset-trait-and-scene-defects / Task 1）】
 * 三视图的 `*-nude` 槽位（front-nude / side-nude / back-nude）会强制拼接 `NUDE_FIXED_TAGS`
 * 常量数组中的全部 tag（`nude, bare_skin, nsfw`），
 * **固定包含，不可被用户配置覆盖**，确保生成结果始终包含裸体特征。
 * `NUDE_FIXED_TAGS` 是 nude tag 的唯一数据源（single source of truth），禁止在其它位置重复硬编码。
 *
 * 【占位符替换链路】
 * `{traits}` / `{camera}` 占位符均由 `sdGenerationService.applyTraitsAndLora`
 * 在 SD 调用前统一替换：
 *   - `{traits}`：options.characterTraits 拼接字符串（已有逻辑，Spec: add-asset-and-trait-management / Task 5）
 *   - `{camera}`：options.dynamicCamera（来自 AssetGenerateModal 视角镜头下拉选择；空则替换为空串并清理多余逗号）
 *     【2026-08-06 初版】illustration / general 模板含此占位符；three-view 模板不含（固定 view 不冲突）
 *     【2026-08-06 重构】表情模板（buildExpressionGenerationPrompt 默认模板）也含此占位符；
 *     各模式默认值：立绘='full body'，表情='portrait, looking at viewer'，一般图像=无默认（由 getCameraDefaultForMode 提供）
 *     移除立绘写死的 full body 与表情写死的 portrait/looking at viewer，改为 {camera} 默认值注入，避免同类 tag 冲突
 *
 * @param mode 生成模式（illustration / general / three-view）
 * @param targetSlot 三视图模式下的目标槽位（front / side / back / front-nude / side-nude / back-nude）
 * @returns 提示词模板字符串（含 {traits} / {camera} 占位符）
 */
export function buildAssetPromptTemplate(
  mode: 'illustration' | 'general' | 'three-view',
  targetSlot?: 'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude',
): string {
  switch (mode) {
    case 'illustration':
      // 立绘模板：{camera}（视角镜头，默认含 full body）+ 特征 + 高质量
      // 【2026-08-06 初版】追加 {camera} 占位符
      // 【2026-08-06 重构】移除写死的 `full body`（改为由 {camera} 下拉默认值注入），避免 full body 与用户选的 close-up 等同类 tag 冲突
      //   立绘模式弹窗打开时 selectedCameraAngle 默认初始化为 'full body'（由 AssetGenerateModal getCameraDefaultForMode 提供）
      //   用户可改选 upper body（半身立绘）等，无冲突（覆盖而非叠加）
      return '{camera}, {traits}, high quality, best quality, masterpiece';
    case 'general': {
      // 一般图像模板：特征 + {camera}（视角镜头，2026-08-06 新增）+ 高质量
      // 【2026-08-06 新增】{camera} 占位符由 AssetGenerateModal 视角镜头下拉填充
      return '{traits}, {camera}, high quality, best quality';
    }
    case 'three-view': {
      // 三视图模板：根据 targetSlot 选择 front / side / back（不改，已有穿衣/裸体分组逻辑）
      // 裸体变体（*-nude）剥离后缀取 viewName，并拼接 NUDE_FIXED_TAGS 常量数组（Spec: fix-asset-trait-and-scene-defects / Task 1）
      // 注：NUDE_FIXED_TAGS 为 nude tag 的唯一数据源，固定包含不可被用户配置覆盖
      //
      // 【2026-08-06 重点标记 - 三视图多角色 bug 修复】
      // 原模板含 `character sheet` tag，但该 tag 在 Danbooru 训练数据中天然指"角色设定合集图"——
      // 典型样式是一张图上展示多视角/多表情/多服装（如主视图+上半身+特写，或穿衣/不穿衣左右布局）。
      // SDXL/Pony 模型会优先生成 collage，导致一张三视图出现多个角色/多视角。
      // 修复：移除 `character sheet`，改为 `solo`（强化单角色），保留 `white background`（干净参考风格）。
      // 同时在 AssetGenerateModal 负面提示词追加多角色/多视角约束（见 buildSdOptions 上方负面初始化）。
      const isNude = !!targetSlot?.endsWith('-nude');
      const viewName = (isNude ? targetSlot!.replace('-nude', '') : targetSlot) || 'front';
      const nudeTags = isNude ? `, ${NUDE_FIXED_TAGS.join(', ')}` : '';
      // 【2026-08-06 标签库审计】full body → full_body, white background → white_background, viewName view → viewName_view
      return `${viewName}_view, full_body, solo, {traits}${nudeTags}, white_background, high quality`;
    }
    default:
      return '{traits}, high quality, best quality';
  }
}
