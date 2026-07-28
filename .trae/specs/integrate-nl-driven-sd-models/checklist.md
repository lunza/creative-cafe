# Checklist

## 模型类型系统
- [x] `SDModelType` 类型已定义：`'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2'`
- [x] `detectModelType()` 函数实现正确：qwen+edit → qwen-image-edit，qwen → qwen-image，klein/flux.2 → flux2，其余 → sdxl
- [x] `MODEL_TYPE_PRESETS` 推荐参数映射表覆盖 4 种模型类型
- [x] `SDWebuiConfig` 接口新增 `modelType`、`nlPromptTemplate`、`txt2imgWidth`、`txt2imgHeight` 字段
- [x] `defaultSetting.sdWebui` 包含所有新字段默认值

## 设置 UI
- [x] 模型类型 `Select` 控件可选 4 种类型 + 自动检测按钮
- [x] 切换模型类型时自动填充推荐参数
- [x] NL 模型时隐藏 ADetailer 配置区，显示 NL 提示词模板
- [x] txt2img 模型时显示 txt2img 宽高配置
- [x] qwen-image-edit denoising < 0.9 时显示警告

## Service 层
- [x] `generateTxt2Img()` 方法正确调用 `/sdapi/v1/txt2img`，请求体不含 init_images/denoising/alwayson_scripts
- [x] `generateExpression()` 根据 modelType 分流：sdxl 走现有逻辑，NL 模型跳过 ADetailer
- [x] qwen-image-edit 模式 denoising ≥ 0.9，不发送 alwayson_scripts
- [x] flux2 模式关闭 ADetailer
- [x] qwen-image 模式走 txt2img（无 baseImage）
- [x] `SDTxt2ImgParams` 接口已导出
- [x] 错误处理：denoising < 0.9 时返回 warning

## NL 提示词
- [x] `EMOTION_NL_PROMPT_MAP` 覆盖全部 30 种情绪，使用自然语言句子
- [x] `buildNLExpressionPrompt()` 正确替换 `{traits}` 和 `{emotion}` 占位符
- [x] qwen-image-edit 提示词为编辑指令风格
- [x] NL 负面提示词使用自然语言风格

## IPC 层
- [x] `sd:generateTxt2Img` 通道已注册并正确调用 `generateTxt2Img()`
- [x] `sd:generateExpression` 和 `sd:generateAllExpressions` 透传 `modelType`
- [x] `preload.ts` 暴露 `sd.generateTxt2Img` API
- [x] `electron.d.ts` 补全 `generateTxt2Img` 类型声明

## ExpressionGenerateModal
- [x] 显示当前模型类型
- [x] 根据 modelType 选择提示词构建函数（标签 vs NL）
- [x] NL 模型时隐藏 ADetailer 参数显示
- [x] qwen-image-edit denoising 警告显示
- [x] `buildSdOptions()` 传递 modelType

## 端到端验证
- [ ] qwen-image-edit 模型自动检测正确
- [ ] qwen-image-edit 批量生成 30 种表情，人物一致性良好
- [ ] qwen-image-edit 单个生成 + 重新生成
- [ ] qwen-image txt2img 文生图正常
- [ ] flux2 txt2img 文生图正常
- [ ] SDXL img2img + ADetailer 现有流程不受影响
- [ ] SD 未运行时错误提示正常
- [ ] 取消批量生成正常
- [ ] 模型类型切换时推荐参数自动更新

## 文档
- [x] CHANGELOG.md 新增 NL 模型集成条目
- [x] PROJECT_DOCUMENTATION_NEW.md 新增 NL 模型集成小节
- [x] CODE_WIKI.md 更新 sdGenerationService / SDWebuiSettings 条目
