# 自然语言驱动 SD 模型集成 Spec

## Why

项目现有 SD 集成（Spec: add-ai-expression-generation）仅支持传统 SDXL img2img + ADetailer 方案生成表情，使用逗号分隔的标签提示词。本地 sd-webui-forge-neo（`G:\AI\sd-webui-forge-neo`）已支持 qwen-image、qwen-image-edit、flux2 等自然语言驱动模型，其中 qwen-image-edit 通过视觉编码（vision encoding）内置人物一致性能力，在表情生成等需要高度人物一致性的任务中显著优于 ADetailer 方案。需将这些模型能力完整接入系统，使用户可通过自然语言指令调用模型生成高一致性图片。

## What Changes

- 新增 SD 模型类型系统：`'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2'`，根据模型文件名自动检测 + 支持手动选择
- 新增 txt2img 生成能力：通过 `/sdapi/v1/txt2img` 端点支持 qwen-image 和 flux2 的文生图
- 新增 NL 提示词构建：为自然语言驱动模型提供自然语言描述风格提示词（区别于 SDXL 的标签风格）
- 修改 img2img 生成流程：支持 qwen-image-edit 模式（denoising ≥ 0.9，无需 ADetailer，视觉编码保证一致性）
- 新增模型类型参数映射：各模型类型的默认参数、采样器、调度器差异处理
- 修改设置页：新增模型类型选择 + 模型类型专属参数配置
- 修改 ExpressionGenerateModal：适配多模型类型，展示当前模型类型与参数概览
- **修改原 Spec 约束**：add-ai-expression-generation 的技术方案从「仅 SDXL img2img + ADetailer」扩展为「多模型类型可选，qwen-image-edit 为推荐方案」

## Impact

- Affected specs: `add-ai-expression-generation`（技术方案扩展，新增模型类型选择）
- Affected code:
  - 修改：`src/main/services/sdGenerationService.ts` — 新增 txt2img 方法、模型类型检测、NL 参数映射
  - 修改：`src/main/ipc/handlers/sdGenerationHandlers.ts` — 新增 `sd:generateTxt2Img` 通道，现有通道增加 modelType 参数
  - 修改：`src/main/preload.ts` — 暴露 `sd.generateTxt2Img` API
  - 修改：`src/renderer/types/electron.d.ts` — 补全类型声明
  - 修改：`src/renderer/types/setting.ts` — `SDWebuiConfig` 新增 `modelType` 及模型专属参数字段
  - 修改：`src/shared/settings.ts` — 默认值更新
  - 修改：`src/renderer/components/Settings/SDWebuiSettings.tsx` — 模型类型选择 + 专属参数 UI
  - 修改：`src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` — 适配多模型类型
  - 修改：`src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 新增 NL 提示词构建函数

## 技术方案

### sd-webui-forge-neo 调用规范

所有模型均使用标准 API 端点，无自定义路由：

| 模型类型 | 端点 | 提示词风格 | 关键参数差异 |
|----------|------|------------|-------------|
| sdxl（现有） | `/sdapi/v1/img2img` | 逗号分隔标签 | denoising 0.55, ADetailer 面部修复 |
| qwen-image | `/sdapi/v1/txt2img` | 自然语言描述 | 无 init_images，无 ADetailer |
| qwen-image-edit | `/sdapi/v1/img2img` | 自然语言指令 | denoising ≥ 0.9（强制），无需 ADetailer，视觉编码保证一致性 |
| flux2 | `/sdapi/v1/txt2img` 或 `/sdapi/v1/img2img` | 自然语言描述 | 调度器自动选择 "Flux2"，无需 ADetailer |

### 模型类型自动检测规则

基于 sd-webui-forge-neo 的 `backend/loader.py` 检测逻辑：

| 模型类型 | 文件名匹配规则 | 示例 |
|----------|---------------|------|
| qwen-image-edit | 包含 `qwen` 且包含 `edit`（不区分大小写） | `qwen_image_edit_2511_fp8mixed.safetensors` |
| qwen-image | 包含 `qwen` 且不包含 `edit` | `qwen_image_2512_fp8_e4m3fn.safetensors` |
| flux2 | 包含 `klein` 或 `flux.2`（不区分大小写） | `FLUX.2-klein-4B.safetensors` |
| sdxl | 以上均不匹配 | 默认走现有 SDXL 逻辑 |

### qwen-image-edit 表情生成工作流（推荐方案）

```
角色卡 PNG → 提取基底图片 base64
     ↓
加载 qwen-image-edit 模型（文件名含 qwen + edit → 自动进入 edit 模式）
     ↓
对每种情绪：
  1. img2img(init_images=[base64], prompt=NL指令, denoising=0.95)
     - 模型内部视觉编码：将输入图片编码为 vision embedding + reference latent
     - 视觉模板自动注入："maintaining consistency with the original input"
     - 无需 ADetailer（模型自带面部一致性）
  2. 输出 PNG → 保存到表情存储
```

### NL 提示词 vs 标签提示词

| 场景 | SDXL 标签风格 | NL 自然语言风格 |
|------|-------------|-----------------|
| 表情生成 | `portrait, {traits}, looking at viewer, {emotion tags}, high quality` | `A portrait of a character with {traits description}. The character has a {emotion description} expression, looking at the viewer. High quality, detailed.` |
| 文生图 | N/A | `A full-body illustration of a character with {traits description}. {scene description}. High quality digital art.` |

### 参数映射表

| 参数 | sdxl | qwen-image | qwen-image-edit | flux2 |
|------|------|------------|-----------------|-------|
| 端点 | img2img | txt2img | img2img | txt2img / img2img |
| denoising | 0.55 | N/A | ≥ 0.95 | 0.8 |
| steps | 28 | 28 | 28 | 28 |
| cfg_scale | 7 | 7 | 7 | 7 |
| sampler | DPM++ 2M Karras | Euler | Euler | Euler |
| scheduler | 默认 | 默认 | 默认 | Flux2（自动） |
| ADetailer | 开启 | 关闭 | 关闭 | 关闭 |
| 宽高 | 512×512 | 1024×1024 | 原图比例 | 1024×1024 |

## ADDED Requirements

### Requirement: SD 模型类型检测
系统 SHALL 根据模型文件名自动检测模型类型，并支持用户手动覆盖。

#### Scenario: 自动检测模型类型
- **WHEN** 用户在设置页选择一个模型（如 `qwen_image_edit_2511_fp8mixed.safetensors`）
- **THEN** 系统根据文件名自动检测模型类型为 `qwen-image-edit`
- **AND** 在 UI 上显示检测到的模型类型
- **AND** 自动切换到该模型类型的推荐参数

#### Scenario: 手动覆盖模型类型
- **WHEN** 用户在设置页手动选择模型类型为 `flux2`
- **THEN** 系统使用用户指定的模型类型，不依赖自动检测
- **AND** 自动切换到 flux2 的推荐参数

### Requirement: txt2img 生成能力
系统 SHALL 支持通过 `/sdapi/v1/txt2img` 端点进行文生图，用于 qwen-image 和 flux2 模型。

#### Scenario: qwen-image 文生图
- **WHEN** 系统使用 qwen-image 模型生成图片
- **THEN** 调用 `POST /sdapi/v1/txt2img`，请求体包含 `prompt`（自然语言）、`steps`、`cfg_scale`、`width`、`height`、`sampler_name`
- **AND** 不包含 `init_images`、`denoising_strength`、`alwayson_scripts`
- **AND** 返回生成的图片 base64

#### Scenario: flux2 文生图
- **WHEN** 系统使用 flux2 模型进行文生图
- **THEN** 调用 `POST /sdapi/v1/txt2img`，参数同上
- **AND** Forge Neo 内部自动选择 "Flux2" 调度器

### Requirement: qwen-image-edit 表情生成
系统 SHALL 支持通过 qwen-image-edit 模型进行高一致性表情生成。

#### Scenario: 使用 qwen-image-edit 生成表情
- **WHEN** 用户使用 qwen-image-edit 模型生成表情
- **THEN** 系统调用 `POST /sdapi/v1/img2img`，请求体包含 `init_images`（基底图片 base64）、`prompt`（自然语言指令）、`denoising_strength`（≥ 0.95）
- **AND** 不包含 `alwayson_scripts`（ADetailer 关闭，模型视觉编码自带一致性）
- **AND** Forge Neo 自动检测 edit 模式并启用视觉编码
- **AND** 生成的图片保持人物面部特征、姿态和风格的一致性

#### Scenario: denoising 强度不足警告
- **WHEN** 用户使用 qwen-image-edit 模型但 denoising_strength < 0.9
- **THEN** 系统在 UI 上显示警告「qwen-image-edit 模型推荐 denoising ≥ 0.9，当前值可能导致编辑效果不佳」
- **AND** 允许用户继续或调整

### Requirement: NL 提示词构建
系统 SHALL 为自然语言驱动模型提供自然语言风格的提示词构建能力。

#### Scenario: 构建 NL 表情提示词
- **WHEN** 系统使用 NL 驱动模型生成表情
- **THEN** 提示词为自然语言描述格式，包含角色特征描述 + 情绪描述 + 质量描述
- **AND** 提示词风格区别于 SDXL 的逗号分隔标签格式

#### Scenario: NL 提示词模板
- **WHEN** 用户配置 NL 提示词模板
- **THEN** 模板支持 `{traits}` 和 `{emotion}` 占位符
- **AND** 占位符替换为自然语言描述而非标签

### Requirement: 模型类型参数映射
系统 SHALL 根据模型类型自动映射推荐参数。

#### Scenario: 切换模型类型时更新推荐参数
- **WHEN** 用户切换模型类型
- **THEN** 系统自动更新 denoising、steps、cfg_scale、sampler、ADetailer 开关等参数为该模型类型的推荐值
- **AND** 用户可在推荐值基础上进一步自定义

## MODIFIED Requirements

### Requirement: 表情生成技术方案（原 add-ai-expression-generation 扩展）
表情生成支持以下模型类型，用户可在设置中选择：
1. **SDXL img2img + ADetailer**（原有方案，保留不变）
2. **qwen-image-edit img2img**（新增，推荐方案，视觉编码保证一致性）
3. **flux2 img2img**（新增，可选）

qwen-image-edit 为推荐方案，在人物表情生成场景中一致性表现优于 ADetailer。

### Requirement: SD WebUI 配置（原 add-ai-expression-generation 扩展）
设置页新增模型类型选择项。选择模型类型后自动切换到推荐参数，用户可进一步自定义。各模型类型的配置项：
- sdxl：denoising、steps、cfg、sampler、ADetailer 全套参数（现有）
- qwen-image：txt2img 参数（steps、cfg、sampler、宽高），无 ADetailer
- qwen-image-edit：img2img 参数（denoising ≥ 0.9、steps、cfg、sampler），无 ADetailer
- flux2：txt2img/img2img 参数（denoising、steps、cfg、sampler），无 ADetailer

## REMOVED Requirements

无。所有现有功能保留，新增模型类型为扩展而非替换。
