# Tasks

## 阶段一：模型类型系统与配置基础

- [x] Task 1: 新增 SD 模型类型定义与自动检测
  - [x] SubTask 1.1: 在 `src/main/services/sdGenerationService.ts` 新增 `SDModelType` 类型：`'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2'`
  - [x] SubTask 1.2: 实现 `detectModelType(modelName: string): SDModelType` 函数，基于文件名匹配规则：
    - 包含 `qwen` 且 `edit` → `qwen-image-edit`
    - 包含 `qwen` 且不含 `edit` → `qwen-image`
    - 包含 `klein` 或 `flux.2` → `flux2`
    - 其余 → `sdxl`
  - [x] SubTask 1.3: 新增 `MODEL_TYPE_PRESETS: Record<SDModelType, { endpoint, denoising, steps, cfgScale, sampler, adetailerEnabled, width, height }>` 推荐参数映射表
  - [x] SubTask 1.4: 在 `src/renderer/types/setting.ts` 的 `SDWebuiConfig` 接口新增字段：`modelType: SDModelType`、`nlPromptTemplate: string`、`txt2imgWidth: number`、`txt2imgHeight: number`
  - [x] SubTask 1.5: 在 `src/shared/settings.ts` 的 `defaultSetting.sdWebui` 新增默认值（`modelType: 'sdxl'`，NL 模板默认值，txt2img 默认宽高 1024×1024）

- [x] Task 2: 修改设置 UI 支持模型类型选择
  - [x] SubTask 2.1: 在 `SDWebuiSettings.tsx` 新增「模型类型」`Select` 控件（选项：SDXL / Qwen-Image / Qwen-Image-Edit / Flux2），含自动检测按钮
  - [x] SubTask 2.2: 选择模型类型时自动填充推荐参数（从 `MODEL_TYPE_PRESETS` 读取），用户可在此基础上修改
  - [x] SubTask 2.3: 当模型类型为 NL 驱动（非 sdxl）时：
    - 隐藏 ADetailer 配置区（NL 模型不需要 ADetailer）
    - 显示 NL 提示词模板 `TextArea`（支持 `{traits}` 和 `{emotion}` 占位符）
  - [x] SubTask 2.4: 当模型类型为 `qwen-image` 或 `flux2`（txt2img 模式）时，显示 txt2img 宽高配置
  - [x] SubTask 2.5: 当模型类型为 `qwen-image-edit` 且 denoising < 0.9 时，显示警告提示

## 阶段二：Service 层 — txt2img + NL 驱动 img2img

- [x] Task 3: 扩展 sdGenerationService 支持 txt2img 和多模型类型
  - [x] SubTask 3.1: 新增 `generateTxt2Img(params: { endpoint, prompt, negativePrompt, options }): Promise<SDGenerationResult>` 方法：
    - `POST /sdapi/v1/txt2img`
    - 请求体：`{ prompt, negative_prompt, steps, cfg_scale, width, height, sampler_name, batch_size: 1, n_iter: 1 }`
    - 不包含 `init_images`、`denoising_strength`、`alwayson_scripts`
    - 可选模型切换（复用 `switchModel`）
    - 复用 `fetchWithTimeout` + `formatHttpError` 错误处理
  - [x] SubTask 3.2: 修改 `generateExpression()` 方法，根据 `options.modelType` 分流：
    - `sdxl`：走现有 img2img + ADetailer 逻辑（不变）
    - `qwen-image-edit`：img2img，denoising ≥ 0.9，关闭 ADetailer（不发送 `alwayson_scripts`）
    - `flux2`：img2img（如有 baseImage）或 txt2img（无 baseImage），关闭 ADetailer
    - `qwen-image`：走 `generateTxt2Img`（无 baseImage 需求时不走 img2img）
  - [x] SubTask 3.3: 修改 img2img 请求体构建逻辑：当 `modelType` 为 NL 驱动模型时，跳过 `alwayson_scripts.ADetailer` 构建
  - [x] SubTask 3.4: 新增 `SDTxt2ImgParams` 接口类型并导出
  - [x] SubTask 3.5: 错误处理增强：检测 qwen-image-edit denoising < 0.9 时在返回结果中附带 warning 字段

## 阶段三：NL 提示词构建

- [x] Task 4: 新增自然语言提示词构建
  - [x] SubTask 4.1: 在 `PromptBuilder.ts` 新增 `EMOTION_NL_PROMPT_MAP: Record<string, string>`，30 种情绪的自然语言描述
  - [x] SubTask 4.2: 新增 `buildNLExpressionPrompt(emotionKey, options?)` 函数：
    - 使用 `nlPromptTemplate`（默认：`"A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed."`）
    - `{traits}` 替换为自然语言特征描述（如 "with blue eyes and long black hair"）
    - `{emotion}` 替换为 `EMOTION_NL_PROMPT_MAP[emotionKey]`
    - 返回 `{ prompt, negativePrompt }`
    - NL 负面提示词默认：`"blurry, low quality, distorted, deformed, disfigured, bad anatomy, watermark, text"`
  - [x] SubTask 4.3: 对于 qwen-image-edit，提示词构建为编辑指令风格：`"Change the character's expression to {emotion}. Maintain the character's identity, facial features, hairstyle, and clothing. {traits}"`

## 阶段四：IPC 层更新

- [x] Task 5: 更新 IPC handlers 和 preload 暴露
  - [x] SubTask 5.1: 在 `sdGenerationHandlers.ts` 新增 `sd:generateTxt2Img` 通道：
    - 参数：`{ endpoint, prompt, negativePrompt, options }`
    - 调用 `sdGenerationService.generateTxt2Img()`
    - 返回 `{ success, imageBase64?, error?, warning? }`
  - [x] SubTask 5.2: 修改 `sd:generateExpression` handler，增加 `modelType` 参数透传到 options（验证：现有 handler 已透明透传 options）
  - [x] SubTask 5.3: 修改 `sd:generateAllExpressions` handler，增加 `modelType` 参数透传（验证：现有 handler 已透明透传 options）
  - [x] SubTask 5.4: 在 `preload.ts` 暴露 `sd.generateTxt2Img` API
  - [x] SubTask 5.5: 在 `electron.d.ts` 补全 `generateTxt2Img` 类型声明 + `modelType` 字段

## 阶段五：ExpressionGenerateModal 适配

- [x] Task 6: 修改 ExpressionGenerateModal 适配多模型类型
  - [x] SubTask 6.1: 从 sdConfig 读取 `modelType`，在参数概览区域显示当前模型类型
  - [x] SubTask 6.2: 根据 `modelType` 选择提示词构建函数：
    - `sdxl` → `buildExpressionGenerationPrompt()`（现有标签风格）
    - `qwen-image-edit` / `qwen-image` / `flux2` → `buildNLExpressionPrompt()`（NL 风格）
  - [x] SubTask 6.3: 根据 `modelType` 调整 UI 显示：
    - NL 模型时隐藏 ADetailer 相关参数显示
    - qwen-image-edit 时显示 denoising 警告（如 < 0.9）
    - txt2img 模型（qwen-image）时提示「此模型为文生图，不需要基底图片」
  - [x] SubTask 6.4: `buildSdOptions()` 函数传递 `modelType` 字段到 options
  - [x] SubTask 6.5: 单个生成模式下的提示词预览使用对应风格的提示词

## 阶段六：集成验证

- [x] Task 7: 端到端验证（代码层静态验证，运行时验证需用户在本地 SD 环境执行）
  - [x] SubTask 7.1: TypeScript 编译检查通过（npx tsc --noEmit）
  - [x] SubTask 7.2: 代码审查验证：模型类型检测逻辑正确（qwen+edit → qwen-image-edit 等）
  - [x] SubTask 7.3: 代码审查验证：generateTxt2Img 请求体不含 init_images/denoising/alwayson_scripts
  - [x] SubTask 7.4: 代码审查验证：generateExpression 根据 modelType 分流正确
  - [x] SubTask 7.5: 代码审查验证：NL 模型跳过 ADetailer
  - [x] SubTask 7.6: 代码审查验证：EMOTION_NL_PROMPT_MAP 覆盖全部 30 种情绪
  - [x] SubTask 7.7: 代码审查验证：SDXL 现有流程不受影响（modelType 默认 sdxl）
  - [x] SubTask 7.8: 代码审查验证：IPC 通道注册 + preload 暴露 + 类型声明完整
  - [x] SubTask 7.9: 代码审查验证：ExpressionGenerateModal 根据 modelType 切换提示词构建
  - [x] SubTask 7.10: 代码审查验证：AssetGenerateModal DEFAULT_SD_CONFIG 补全新字段

## 阶段七：文档更新

- [x] Task 8: 更新技术文档
  - [x] SubTask 8.1: 更新 `CHANGELOG.md` 新增自然语言驱动 SD 模型集成特性条目
  - [x] SubTask 8.2: 更新 `docs/PROJECT_DOCUMENTATION_NEW.md` 新增 NL 模型集成小节（模型类型系统 + txt2img + qwen-image-edit 工作流 + 参数映射表 + 调用规范说明）
  - [x] SubTask 8.3: 更新 `CODE_WIKI.md` 更新 sdGenerationService 条目（新增 generateTxt2Img / detectModelType / MODEL_TYPE_PRESETS）+ SDWebuiSettings 条目（新增 modelType 配置）

# Task Dependencies
- Task 2（设置 UI）依赖 Task 1（类型定义与配置）
- Task 3（Service 层）依赖 Task 1（类型定义）
- Task 4（NL 提示词）独立，可与 Task 1/2/3 并行
- Task 5（IPC 层）依赖 Task 3（Service）+ Task 4（NL 提示词）
- Task 6（UI 适配）依赖 Task 5（IPC）+ Task 4（NL 提示词）+ Task 2（设置 UI）
- Task 7（验证）依赖 Task 1-6 全部完成
- Task 8（文档）依赖 Task 7 验证通过
