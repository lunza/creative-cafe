# Checklist

## 数据层扩展
- [x] `expressionService.ts` 中 `CustomEmotion` 接口新增 `prompts?` 字段（含 positive / negative / nlPrompt）
- [x] `addCustomEmotion` 方法接受并持久化 `prompts` 参数
- [x] `updateCustomEmotion` 方法实现（更新 label + prompts）
- [x] `removeCustomEmotion` 方法兼容 prompts 字段（整体删除条目）
- [x] `saveImage` 方法中 isCustom 分支正确传递 prompts（使用 .find() 保留已有 prompts）
- [x] 旧 manifest（无 prompts 字段）读取不报错，回退兜底逻辑

## IPC 通道
- [x] `expression:updateCustomEmotion` IPC 通道注册
- [x] `expression:addCustomEmotion` 通道参数增加可选 prompts 字段
- [x] `preload.ts` 暴露 `expression.updateCustomEmotion` API
- [x] `preload.ts` 中 `expression.addCustomEmotion` 参数类型更新
- [x] `electron.d.ts` 类型声明补全

## AI 提示词生成
- [x] `characterTraitAIService.ts` 新增 `generateEmotionPrompts(emotionLabel)` 方法
- [x] 系统提示词要求 LLM 输出 4 段分隔符格式（---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND---）
- [x] 系统提示词要求使用 Danbooru 标准下划线格式
- [x] 系统提示词要求输出 NL 自然语言描述（---NL--- 段）
- [x] LLM 响应解析为 `{ face, action, symbol, background, nl }` 结构
- [x] 4 维度 tag 执行标签审计链（L0-L5 或等价逻辑）
- [x] 审计结果记录命中层级 + failed 标记
- [x] 合并 4 维度为 positive 字符串
- [x] 返回 `{ positive, negative, nlPrompt, auditDetails }` 结构
- [x] 解析容错（无分隔符 / 段落缺失 / tag 含空格）
- [x] `ai:generateEmotionPrompts` IPC 通道注册
- [x] `preload.ts` 暴露 `ai.generateEmotionPrompts` API
- [x] `electron.d.ts` 类型声明补全

## UI 交互层
- [x] 「添加自定义情绪」弹窗新增情绪关键词输入
- [x] 「AI 生成提示词」按钮 + loading 状态
- [x] 4 维度 tag 预览展示（分组 + 展开/折叠）
- [x] NL 提示词预览展示
- [x] positive 提示词手动编辑（TextArea）
- [x] 保存时传递 prompts 字段
- [x] 自定义情绪「编辑」按钮 + 编辑弹窗
- [x] 编辑弹窗中「重新生成提示词」功能
- [x] expressionStore `addCustomEmotion` action 传递 prompts
- [x] expressionStore 新增 `updateCustomEmotion` action
- [x] expressionStore `loadExpressions` 正确读取 prompts 字段
- [x] expressionStore `CustomEmotion` 接口含 `prompts?` 字段

## 提示词构建函数
- [x] `buildExpressionGenerationPrompt` 新增 `customPrompts` 参数
- [x] 优先级：customPrompts > EMOTION_PROMPT_MAP > customLabel 兜底 > neutral
- [x] `buildNLExpressionPrompt` 新增 `customNlPrompt` 参数
- [x] 优先级：customNlPrompt > EMOTION_NL_PROMPT_MAP > customLabel 兜底 > neutral

## 表情生成对齐
- [x] `ExpressionGenerateModal.tsx` 单个生成模式传入 customPrompts
- [x] `ExpressionGenerateModal.tsx` 批量生成模式包含自定义情绪
- [x] `AssetGenerateModal.tsx` buildEmotionPrompt 传入 customPrompts
- [x] `AssetGenerateModal.tsx` 批量生成模式包含自定义情绪
- [x] 自定义情绪使用 prompts.positive（SDXL 模式）
- [x] 自定义情绪使用 prompts.nlPrompt（NL 模型模式）
- [x] expression 分类特征过滤对自定义情绪同样生效（getAvailableEmotionKeys 含自定义情绪）
- [x] 批量生成保存时 isCustom 正确判断 + label 传递
- [x] 批量生成进度总数包含自定义情绪
- [x] 标签查找（currentEmotionLabel/singleEmotionLabel）含自定义情绪

## 回归验证
- [x] 预置情绪表情生成功能未被破坏（batch 仍先遍历 EMOTION_PRESETS）
- [x] 手动上传表情功能未被破坏（无相关修改）
- [x] 表情渲染/预加载/切换功能未被破坏（resolveExpressionImage/imageCache 逻辑未改）
- [x] 对话中情绪标记解析功能未被破坏（无相关修改）
- [x] 旧数据（无 prompts 的自定义情绪）兼容正常（prompts 为可选字段 + 兜底逻辑）

## 文档
- [x] `docs/AI_USAGE_INVENTORY.md` 新增自定义情绪提示词生成场景
- [x] `docs/user-manual.md` 角色卡表情管理章节更新
