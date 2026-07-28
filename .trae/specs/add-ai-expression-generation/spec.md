# AI 表情生成 Spec

## Why

角色卡表情管理系统（Spec: add-character-expression-system）已支持用户手动上传表情图片，但为 30 种预置情绪逐一上传工作量巨大。用户希望利用本地 Stable Diffusion（sd-webui-forge-neo @ `G:\AI\sd-webui-forge-neo`，RTX PRO 6000 96GB VRAM）通过图生图（img2img）自动生成一组表情包，以角色卡 PNG 中的图片为基底，配合情绪提示词和面部一致性锁定，批量产出 30 种情绪表情。

## What Changes

- 新增 SD WebUI API 集成服务（主进程），通过 `/sdapi/v1/img2img` 端点调用本地 Forge Neo
- 新增情绪-提示词映射表（30 种情绪 → SD 正面/负面提示词）
- 新增表情生成 UI：ExpressionGenerateModal（支持批量 + 单个两种模式）
- 修改 ExpressionManagerModal：添加「AI 生成全部表情」入口 + 每个情绪格子的「AI 生成」按钮
- 新增 SD WebUI 设置项（端点 URL / 模型 / denoising strength / ADetailer 开关）
- **修改原 Spec 约束**：原 Spec 1.b 条款「不允许系统自动生成」现修改为「允许通过本地 SD WebUI AI 生成，用户也可手动上传，两种方式并存」

## Impact

- Affected specs: `add-character-expression-system`（修改约束 1.b，新增 AI 生成入口）
- Affected code:
  - 新建：`src/main/services/sdGenerationService.ts` / `src/main/ipc/handlers/sdGenerationHandlers.ts` / `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`
  - 修改：`src/main/preload.ts` / `src/main/ipc/index.ts` / `src/renderer/types/electron.d.ts` / `src/renderer/components/Character/CharacterDialogueChat/ExpressionManagerModal.tsx` / `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（新增 EMOTION_PROMPT_MAP）
  - 设置页：新增 SD WebUI 配置区块

## 技术方案

### 图生图 + ADetailer 方案（无需额外下载模型）

```
角色卡 PNG → 提取基底图片（avatarService）
     ↓
对每种情绪：
  1. img2img(baseImage, emotionPrompt, denoising=0.55)
  2. ADetailer 面部修复（已安装，通过 alwayson_scripts 触发）
  3. 输出 512×512 PNG → 保存到表情存储
```

### 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| endpoint | `http://localhost:7860` | SD WebUI Forge Neo API 地址 |
| denoising_strength | 0.55 | 表情变化幅度（0.4=微调，0.7=大幅变化） |
| steps | 28 | SDXL 推荐步数 |
| cfg_scale | 7 | 提示词遵循度 |
| width × height | 512×512 | 匹配表情系统尺寸 |
| sampler | DPM++ 2M Karras | SDXL 推荐采样器 |
| ADetailer | 开启 | 面部检测 + 修复（model: face_yolov8n.pt） |

### 可选增强（用户后续可配置）

- **ControlNet Reference**：Forge 内置，无需额外模型，通过 `alwayson_scripts` 触发，提升角色一致性
- **IP-Adapter**：需额外安装扩展 + 下载模型，一致性最佳

## ADDED Requirements

### Requirement: AI 表情生成服务
系统 SHALL 提供通过本地 SD WebUI API 自动生成角色表情图片的能力。

#### Scenario: 批量生成全部表情
- **WHEN** 用户在 ExpressionManagerModal 中点击「AI 生成全部表情」按钮
- **THEN** 系统提取角色卡基底图片，对 30 种预置情绪逐一调用 SD img2img API 生成表情
- **AND** 显示进度条（当前/总数 + 当前情绪名称）
- **AND** 每生成一张即保存到表情存储并实时刷新网格
- **AND** 用户可随时点击「取消」中止生成

#### Scenario: 单个情绪生成
- **WHEN** 用户点击某个情绪格子的「AI 生成」按钮
- **THEN** 系统仅生成该情绪的表情
- **AND** 生成完成后该格子缩略图自动刷新

#### Scenario: SD WebUI 未运行
- **WHEN** 用户点击生成但 SD WebUI API 不可达
- **THEN** 显示错误提示「无法连接 SD WebUI，请确认 Forge Neo 已启动且开启了 API（--api 参数）」
- **AND** 不执行任何生成操作

#### Scenario: 自定义情绪生成
- **WHEN** 用户为自定义情绪点击「AI 生成」
- **THEN** 系统使用自定义情绪的 label 作为提示词补充，生成表情

### Requirement: SD WebUI 配置
系统 SHALL 在设置页面提供 SD WebUI 相关配置项。

#### Scenario: 配置端点
- **WHEN** 用户在设置页修改 SD WebUI 端点 URL
- **THEN** 后续生成操作使用新端点

#### Scenario: 配置生成参数
- **WHEN** 用户调整 denoising strength / steps / ADetailer 开关
- **THEN** 下次生成使用新参数

## MODIFIED Requirements

### Requirement: 表情图片来源（原 Spec 1.b 修改）
表情图片可通过两种方式获得：
1. **用户手动上传**（原有功能，保留不变）
2. **AI 自动生成**（新增，通过本地 SD WebUI img2img）

两种方式生成的表情在存储和渲染上完全相同，AI 生成的表情可被用户手动替换或删除。
