# Tasks

## 阶段一：SD WebUI API 集成层

- [x] Task 1: 创建 SD WebUI API 客户端服务
  - [x] SubTask 1.1: 创建 `src/main/services/sdGenerationService.ts`，实现以下方法：
    - `checkStatus(endpoint)` — GET `/sdapi/v1/options`，检测 API 是否可用 + 当前模型
    - `getModels(endpoint)` — GET `/sdapi/v1/sd-models`，获取可用模型列表
    - `generateExpression({ endpoint, baseImage, prompt, negativePrompt, options })` — POST `/sdapi/v1/img2img`，返回生成图片 base64
    - `extractBaseImage(characterCardPath)` — 从角色卡 PNG 提取基底图片 base64（复用 avatarService 逻辑）
  - [x] SubTask 1.2: img2img 请求体构建：
    - `init_images`: [baseImage base64]
    - `prompt` / `negative_prompt`
    - `denoising_strength`: 0.55（可配置）
    - `steps`: 28, `cfg_scale`: 7, `width`: 512, `height`: 512
    - `sampler_name`: "DPM++ 2M Karras"
    - `alwayson_scripts`: ADetailer 配置（model: face_yolov8n.pt, prompt: 同主 prompt, denoising: 0.4）
  - [x] SubTask 1.3: 错误处理：API 不可达 / 超时 / 返回错误 / 模型未加载

- [x] Task 2: 创建 IPC handlers + preload 暴露
  - [x] SubTask 2.1: 创建 `src/main/ipc/handlers/sdGenerationHandlers.ts`，注册通道：
    - `sd:checkStatus` — 检测 SD WebUI 是否可用
    - `sd:getModels` — 获取模型列表
    - `sd:generateExpression` — 生成单个表情（参数：characterCardPath, emotionKey, prompt, negativePrompt, options）
    - `sd:generateAllExpressions` — 批量生成（参数：characterCardPath, emotionList, options；通过 webContents.send 推送进度事件）
    - `sd:cancelGeneration` — 取消正在进行的生成
  - [x] SubTask 2.2: 在 `src/main/ipc/index.ts` 注册 `registerSdGenerationHandlers()`
  - [x] SubTask 2.3: 在 `src/main/preload.ts` 暴露 `electronAPI.sd.*` API
  - [x] SubTask 2.4: 在 `src/renderer/types/electron.d.ts` 补全类型声明

## 阶段二：情绪-提示词映射

- [x] Task 3: 创建 30 种情绪的 SD 提示词映射
  - [x] SubTask 3.1: 在 `PromptBuilder.ts`（或新文件 `EmotionPromptMap.ts`）中创建 `EMOTION_PROMPT_MAP: Record<string, { positive: string; negative?: string }>`，覆盖 30 种预置情绪：
    - default → "neutral expression, calm face, gentle look"
    - admiration → "admiring expression, awestruck, starry eyes, inspired"
    - amusement → "amused, playful smile, twinkling eyes, lighthearted"
    - anger → "angry expression, furrowed brows, intense glare, clenched teeth"
    - annoyance → "annoyed expression, slight frown, irritated look"
    - approval → "approving nod, satisfied smile, warm expression"
    - caring → "caring expression, tender look, soft smile, worried eyes"
    - confusion → "confused expression, tilted head, raised eyebrow, puzzled"
    - curiosity → "curious expression, wide eyes, eager look, leaning forward"
    - desire → "desiring expression, longing gaze, intense eyes"
    - disappointment → "disappointed expression, downcast eyes, sad smile"
    - disapproval → "disapproving look, frown, shaking head, stern expression"
    - disgust → "disgusted expression, wrinkled nose, grimace"
    - embarrassment → "embarrassed expression, blushing cheeks, averted gaze"
    - excitement → "excited expression, wide grin, sparkling eyes, energetic"
    - fear → "fearful expression, wide eyes, pale face, trembling"
    - gratitude → "grateful expression, warm smile, thankful eyes"
    - grief → "grief expression, teary eyes, sorrowful face, mourning"
    - joy → "joyful expression, bright smile, radiant, happy tears"
    - love → "loving expression, tender gaze, warm smile, heart eyes"
    - nervousness → "nervous expression, biting lip, anxious eyes, fidgeting"
    - neutral → "neutral expression, calm, composed face"
    - optimism → "optimistic expression, hopeful smile, bright outlook"
    - pride → "proud expression, confident smile, chin up, chest out"
    - realization → "realization expression, widened eyes, open mouth, eureka"
    - relief → "relieved expression, sigh, relaxed shoulders, gentle smile"
    - remorse → "remorseful expression, guilty look, downcast, apologetic"
    - sadness → "sad expression, teary eyes, downturned mouth, melancholic"
    - surprise → "surprised expression, wide eyes, open mouth, shocked"
    - cheerfulness → "cheerful expression, bright smile, sunny disposition, joyful laugh"
  - [x] SubTask 3.2: 创建 `buildExpressionGenerationPrompt(charDescription, emotionKey, customLabel?)` 函数：
    - 组合角色描述 + 情绪提示词 + 质量词
    - 返回 `{ prompt, negativePrompt }`
    - 通用负面提示词："deformed, ugly, bad anatomy, multiple faces, text, watermark, low quality, blurry, mutated hands, extra digits"

## 阶段三：表情生成 UI

- [x] Task 4: 创建 ExpressionGenerateModal 组件
  - [x] SubTask 4.1: 创建 `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`
  - [x] SubTask 4.2: Props: `{ open, characterCardId, characterCardPath, characterName, characterDescription, mode: 'batch' | 'single', targetEmotionKey?, onClose }`
  - [x] SubTask 4.3: 批量模式 UI：
    - 进度条（antd Progress）显示 `current/total`
    - 当前正在生成的情绪名称
    - 已完成/失败/跳过统计
    - 「取消」按钮
    - 生成完成后显示汇总（成功 N 张 / 失败 N 张）
  - [x] SubTask 4.4: 单个模式 UI：
    - 显示目标情绪名称 + 提示词预览
    - 生成中的 loading 状态
    - 生成完成后显示结果预览 + 「保存」/「重新生成」/「关闭」按钮
  - [x] SubTask 4.5: 监听 IPC 进度事件 `sd:generationProgress`，实时更新进度条
  - [x] SubTask 4.6: 错误处理：SD 不可达时显示提示 + 「打开设置」按钮

- [x] Task 5: 修改 ExpressionManagerModal 添加 AI 生成入口
  - [x] SubTask 5.1: 在弹窗顶部工具栏添加「AI 生成全部表情」按钮（antd Button + ThunderboltOutlined 图标）
  - [x] SubTask 5.2: 在每个情绪格子的操作区添加「AI 生成」按钮（仅图标，RobotOutlined）
  - [x] SubTask 5.3: 点击后打开 ExpressionGenerateModal，传入相应参数
  - [x] SubTask 5.4: 生成完成后调用 `loadExpressions` 刷新缓存（复用 expressionStore）

## 阶段四：设置与配置

- [x] Task 6: 添加 SD WebUI 设置项
  - [x] SubTask 6.1: 在设置页（Settings 组件）新增「Stable Diffusion」配置区块
  - [x] SubTask 6.2: 配置项：
    - 端点 URL（默认 `http://localhost:7860`）
    - 模型选择（下拉，从 `sd:getModels` 获取）
    - denoising strength 滑块（0.1-0.9，默认 0.55）
    - steps 数字输入（默认 28）
    - ADetailer 开关（默认开启）
    - 自定义负面提示词（TextArea，可选）
  - [x] SubTask 6.3: 持久化到 `shared/settings.ts` 的 settings 结构中
  - [x] SubTask 6.4: 在 ExpressionGenerateModal 中可快速访问设置（齿轮图标）

## 阶段五：集成与文档

- [ ] Task 7: 端到端验证
  - [ ] SubTask 7.1: 启动 SD WebUI Forge Neo（`--api` 参数），确认 API 可达
  - [ ] SubTask 7.2: 为测试角色卡生成全部 30 种表情，验证进度条 + 实时刷新
  - [ ] SubTask 7.3: 单个情绪生成 + 重新生成
  - [ ] SubTask 7.4: SD 未运行时的错误提示
  - [ ] SubTask 7.5: 取消正在进行的批量生成
  - [ ] SubTask 7.6: 自定义情绪的 AI 生成
  - [ ] SubTask 7.7: 【重点标记 - CSP 裂图 BUG 回归验证】生成/上传保存表情后，确认表情管理列表与对话气泡头像位置正常显示图片（无裂开图标）；下次进入对话 `loadExpressions` 重新加载也能正常显示

- [x] Task 8: 更新技术文档
  - [x] SubTask 8.1: 更新 `CHANGELOG.md` 新增 AI 表情生成特性条目（综合条目覆盖 Task 1-6，含【重点标记】Spec 约束修改 + IPC 通道冲突修复 + characterCardId 即文件路径 + base64 前缀处理）
  - [x] SubTask 8.2: 更新 `docs/PROJECT_DOCUMENTATION_NEW.md` 新增 AI 表情生成小节（§7.3.2 扩展：完整管线架构图 + 批量/单个工作流 + 错误处理表 + SD WebUI 设置表 + IPC 通道表 + 关键文件清单 +【重点标记】Spec 约束修改）
  - [x] SubTask 8.3: 更新 `CODE_WIKI.md` 新增 sdGenerationService / ExpressionGenerateModal 条目（§14.14-§14.17 已存在且完整，本次在 §14.14 开头新增【重点标记】Spec 约束修改说明，并更新「增量进行中」标记为完成状态）
  - [x] SubTask 8.4: 标注【重点标记】：修改了原 Spec 1.b 约束（从「不允许自动生成」到「允许 AI 生成 + 手动上传并存」）—— 已在 CHANGELOG.md / PROJECT_DOCUMENTATION_NEW.md §7.3.2 / CODE_WIKI.md §14.14 三处文档同步标注
  - [x] SubTask 8.5: 【重点标记 - CSP 裂图 BUG 修复文档增量】更新 `CHANGELOG.md` 新增「修复表情列表显示裂开图片图标（CSP 拦截磁盘绝对路径）」条目；更新 `CODE_WIKI.md` expressionStore 条目说明 imageCache 改为只存 data URL；更新 `docs/PROJECT_DOCUMENTATION_NEW.md` 表情系统小节补充 CSP 兼容性说明
  - [x] SubTask 8.6: 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展文档增量（2026-07-27）】更新 `CHANGELOG.md` 新增「修复 ADetailer-Neo pydantic 校验报错 + 扩展采样器与 ADetailer 高级参数」条目；更新 `CODE_WIKI.md` §14.14 img2img 请求体示例与 ADetailer args 字段说明、§14.16 SDWebuiSettings 配置项扩展采样器与 ADetailer 高级参数折叠面板；更新 `docs/PROJECT_DOCUMENTATION_NEW.md` §7.3.2 SD WebUI 设置表新增 Sampling Method 与 ADetailer 高级参数行 + ADetailer-Neo 兼容性修复说明

## 阶段六：ADetailer-Neo 兼容性 + 参数扩展（2026-07-27 增量）

- [x] Task 9: 【重点标记】修复 ADetailer-Neo pydantic 校验报错 + 扩展采样器与 ADetailer 高级参数
  - [x] SubTask 9.1: `sdGenerationService.ts` 修复 ADetailer args 字段名（移除 `ad_inpaint_full_res`，`ad_dilation` → `ad_dilate_erode`，新增 `ad_inpaint_only_masked_padding`），字段名严格对齐 `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs` 定义
  - [x] SubTask 9.2: `sdGenerationService.ts` 扩展 `SDGenerationOptions` 接口新增 16 个 ADetailer 高级参数字段；`generateExpression` 读取并构建 args dict（含可选独立采样参数）
  - [x] SubTask 9.3: `setting.ts` `SDWebuiConfig` 新增 `sampler` 字段 + 16 个 ADetailer 高级参数字段
  - [x] SubTask 9.4: `settings.ts` `defaultSetting.sdWebui` 新增全部新字段默认值
  - [x] SubTask 9.5: `SDWebuiSettings.tsx` 基础参数区新增「Sampling Method 采样器」`AutoComplete` 控件（10 个 SDXL 推荐预设 + 自由输入）；新增「ADetailer 高级参数」`Collapse` 折叠面板暴露全套参数
  - [x] SubTask 9.6: `ExpressionGenerateModal.tsx` `DEFAULT_SD_CONFIG` 补全新字段；`buildSdOptions` 透传全部新参数；参数概览 Tag 新增采样器与 ADetailer 检测模型/去噪强度显示
  - [x] SubTask 9.7: TypeScript 类型检查通过（修改文件无新增错误）
  - [x] SubTask 9.8: 文档增量更新（CHANGELOG / CODE_WIKI §14.14 + §14.16 / PROJECT_DOCUMENTATION_NEW §7.3.2 / tasks.md）

# Task Dependencies
- Task 2（IPC）依赖 Task 1（Service）
- Task 3（提示词映射）独立，可与 Task 1/2 并行
- Task 4（UI）依赖 Task 2（IPC）+ Task 3（提示词）
- Task 5（入口修改）依赖 Task 4（UI 组件）
- Task 6（设置）独立，可与 Task 4/5 并行
- Task 7（验证）依赖 Task 1-6 全部完成
- Task 8（文档）依赖 Task 7 验证通过
