# Checklist

## SD WebUI API 集成层
- [ ] `sdGenerationService.ts` 实现 `checkStatus` 方法（GET /sdapi/v1/options）
- [ ] `sdGenerationService.ts` 实现 `getModels` 方法（GET /sdapi/v1/sd-models）
- [ ] `sdGenerationService.ts` 实现 `generateExpression` 方法（POST /sdapi/v1/img2img）
- [ ] `sdGenerationService.ts` 实现 `extractBaseImage` 方法（从角色卡 PNG 提取基底图片）
- [ ] img2img 请求体包含正确参数（denoising/steps/cfg_scale/width/height/sampler）
- [ ] ADetailer 通过 `alwayson_scripts` 正确配置（model: face_yolov8n.pt）
- [ ] 错误处理覆盖：API 不可达 / 超时 / 返回错误 / 模型未加载
- [ ] `sdGenerationHandlers.ts` 注册 5 个 IPC 通道（checkStatus/getModels/generateExpression/generateAllExpressions/cancelGeneration）
- [ ] `ipc/index.ts` 中调用 `registerSdGenerationHandlers()`
- [ ] `preload.ts` 暴露 `electronAPI.sd.*` API
- [ ] `electron.d.ts` 补全类型声明
- [ ] 批量生成通过 `webContents.send('sd:generationProgress', ...)` 推送进度

## 情绪-提示词映射
- [ ] `EMOTION_PROMPT_MAP` 覆盖全部 30 种预置情绪
- [ ] 每种情绪有 positive 提示词（英文，SD 语义）
- [ ] 通用负面提示词覆盖常见瑕疵（deformed/ugly/bad anatomy/text/watermark）
- [ ] `buildExpressionGenerationPrompt` 函数组合角色描述 + 情绪词 + 质量词
- [ ] 自定义情绪使用 label 作为提示词补充

## 表情生成 UI
- [ ] `ExpressionGenerateModal.tsx` 创建，支持 batch / single 两种模式
- [ ] 批量模式：进度条显示 current/total + 当前情绪名称
- [ ] 批量模式：已完成/失败/跳过统计
- [ ] 批量模式：取消按钮可中止生成
- [ ] 批量模式：生成完成后显示汇总
- [ ] 单个模式：提示词预览 + loading 状态 + 结果预览
- [ ] 单个模式：保存/重新生成/关闭按钮
- [ ] 监听 `sd:generationProgress` IPC 事件实时更新
- [ ] SD 不可达时显示错误提示 + 打开设置引导

## ExpressionManagerModal 入口
- [x] 顶部工具栏新增「AI 生成全部表情」按钮
- [x] 每个情绪格子新增「AI 生成」按钮（单个）
- [x] 点击后打开 ExpressionGenerateModal 传入正确参数
- [x] 生成完成后调用 `loadExpressions` 刷新缓存
- [x] 已有手动上传的表情，AI 生成时提示「将覆盖现有表情」

## 设置与配置
- [ ] 设置页新增「Stable Diffusion」配置区块
- [ ] 端点 URL 输入框（默认 http://localhost:7860）
- [ ] 模型选择下拉（从 sd:getModels 获取）
- [ ] denoising strength 滑块（0.1-0.9）
- [ ] steps 数字输入
- [ ] ADetailer 开关
- [ ] 自定义负面提示词 TextArea
- [ ] 配置持久化到 settings
- [ ] ExpressionGenerateModal 中可快速访问设置

## 数据与存储
- [ ] AI 生成的表情保存到与手动上传相同的存储路径
- [ ] AI 生成的表情与手动上传的表情在渲染上完全一致
- [ ] AI 生成的表情可被手动替换或删除
- [ ] 批量生成时每张图实时保存（非全部完成后才保存），避免中断丢失

## 文档
- [ ] `CHANGELOG.md` 新增 AI 表情生成特性条目
- [ ] `docs/PROJECT_DOCUMENTATION_NEW.md` 新增 AI 表情生成小节
- [ ] `CODE_WIKI.md` 新增 sdGenerationService / ExpressionGenerateModal 条目
- [ ] 标注【重点标记】：修改原 Spec 1.b 约束

## 回归
- [ ] 手动上传表情功能未被破坏
- [ ] 表情渲染/预加载/切换功能未被破坏
- [ ] CharacterEditModal 表情管理 Tab 未被破坏
- [ ] 未配置 SD WebUI 时，表情管理其他功能正常
