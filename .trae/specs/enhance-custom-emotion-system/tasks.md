# Tasks

## 阶段一：数据层扩展

- [x] Task 1: 扩展 CustomEmotion 类型与 expressionService 持久化
  - [x] SubTask 1.1: 修改 `src/main/services/expressionService.ts` 中 `CustomEmotion` 接口，新增 `prompts?: { positive: string; negative?: string; nlPrompt: string }` 字段
  - [x] SubTask 1.2: 修改 `addCustomEmotion` 方法，接受可选的 `prompts` 参数并写入 manifest
  - [x] SubTask 1.3: 新增 `updateCustomEmotion` 方法，支持更新已有自定义情绪的 `label` 和 `prompts` 字段
  - [x] SubTask 1.4: 修改 `removeCustomEmotion` 方法，确保删除时同步清理 `prompts` 数据（现有逻辑已删除整个条目，验证兼容性）
  - [x] SubTask 1.5: 修改 `saveImage` 方法中 `isCustom` 分支，传递 `prompts` 字段（若传入）

- [x] Task 2: 扩展 IPC 通道与 preload API
  - [x] SubTask 2.1: 在 `src/main/ipc/handlers/expressionHandlers.ts` 新增 `expression:updateCustomEmotion` IPC 通道
  - [x] SubTask 2.2: 修改 `expression:addCustomEmotion` 通道参数，增加可选 `prompts` 字段
  - [x] SubTask 2.3: 在 `src/main/preload.ts` 暴露 `expression.updateCustomEmotion` API + 修改 `expression.addCustomEmotion` 参数
  - [x] SubTask 2.4: 在 `src/renderer/types/electron.d.ts` 补全类型声明

## 阶段二：AI 提示词生成

- [x] Task 3: 实现 `generateEmotionPrompts` 方法
  - [x] SubTask 3.1: 在 `src/main/services/characterTraitAIService.ts` 新增 `generateEmotionPrompts(emotionLabel: string)` 方法
  - [x] SubTask 3.2: 构建专用系统提示词，要求 LLM 输出 4 段分隔符格式（---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND---），使用 Danbooru 标准下划线格式
  - [x] SubTask 3.3: 构建 NL 自然语言描述请求（要求 LLM 同时输出 `---NL---` 段，生成一句自然语言情绪描述）
  - [x] SubTask 3.4: 解析 LLM 响应为 `{ face, action, symbol, background, nl }` 四维数组 + NL 字符串
  - [x] SubTask 3.5: 对 4 维度 tag 执行标签审计链（复用 `applyTagAudit` 或等价逻辑），记录审计结果
  - [x] SubTask 3.6: 合并 4 维度为 `positive` 字符串（逗号分隔），返回 `{ positive, negative, nlPrompt, auditDetails }`
  - [x] SubTask 3.7: 解析容错：LLM 输出无分隔符 / 段落缺失 / tag 含空格时兜底处理

- [x] Task 4: 注册 AI 提示词生成 IPC 通道
  - [x] SubTask 4.1: 在 `src/main/ipc/handlers/characterTraitAIHandlers.ts` 新增 `ai:generateEmotionPrompts` IPC 通道
  - [x] SubTask 4.2: 在 `src/main/preload.ts` 暴露 `ai.generateEmotionPrompts` API
  - [x] SubTask 4.3: 在 `src/renderer/types/electron.d.ts` 补全类型声明

## 阶段三：UI 交互层

- [x] Task 5: 增强 ExpressionManagerModal 的添加/编辑自定义情绪弹窗
  - [x] SubTask 5.1: 修改「添加自定义情绪」弹窗，新增情绪关键词输入框（用于 AI 生成提示词的输入，与 label 字段同步或独立）
  - [x] SubTask 5.2: 新增「AI 生成提示词」按钮，点击后调用 `ai.generateEmotionPrompts` 并展示 loading 状态
  - [x] SubTask 5.3: 展示 AI 生成的 4 维度 tag 预览（FACE / ACTION / SYMBOL / BACKGROUND 分组展示，支持展开/折叠）
  - [x] SubTask 5.4: 展示 NL 提示词预览
  - [x] SubTask 5.5: 支持用户手动编辑 positive 提示词（TextArea）
  - [x] SubTask 5.6: 保存时将 `prompts` 字段传递给 `addCustomEmotion`
  - [x] SubTask 5.7: 新增自定义情绪「编辑」按钮，打开编辑弹窗（复用添加弹窗结构，预填已有数据）
  - [x] SubTask 5.8: 编辑弹窗中「重新生成提示词」功能，调用 AI 生成并更新预览

- [x] Task 6: 修改 expressionStore 支持 prompts 传递
  - [x] SubTask 6.1: 修改 `addCustomEmotion` action，接受可选 `prompts` 参数
  - [x] SubTask 6.2: 新增 `updateCustomEmotion` action，调用 `expression.updateCustomEmotion` IPC
  - [x] SubTask 6.3: 修改 `loadExpressions`，确保读取的 `customEmotions` 包含 `prompts` 字段

## 阶段四：表情生成对齐

- [x] Task 7: 修改提示词构建函数
  - [x] SubTask 7.1: 修改 `PromptBuilder.ts` 中 `buildExpressionGenerationPrompt`，新增 `customPrompts` 参数，优先使用 `customPrompts.positive`
  - [x] SubTask 7.2: 修改 `PromptBuilder.ts` 中 `buildNLExpressionPrompt`，新增 `customNlPrompt` 参数，优先使用 `customNlPrompt`
  - [x] SubTask 7.3: 更新调用优先级：`customPrompts` > `EMOTION_PROMPT_MAP[key]` > `customLabel` 兜底 > neutral

- [x] Task 8: 修改表情生成 UI 支持自定义情绪提示词
  - [x] SubTask 8.1: 修改 `ExpressionGenerateModal.tsx`，单个生成模式传入 `customPrompts`（从 manifest.customEmotions 中查找）
  - [x] SubTask 8.2: 修改 `ExpressionGenerateModal.tsx` 批量生成模式，遍历 `EMOTION_PRESETS` + `manifest.customEmotions`，自定义情绪使用其 `prompts`
  - [x] SubTask 8.3: 修改 `AssetGenerateModal.tsx` 中 `buildEmotionPrompt` 函数，同样传入 `customPrompts`
  - [x] SubTask 8.4: 修改 `AssetGenerateModal.tsx` 批量生成模式，包含自定义情绪

## 阶段五：集成与验证

- [x] Task 9: 端到端验证
  - [x] SubTask 9.1: 添加自定义情绪 + AI 生成提示词 → 保存 → 检查 manifest 中 prompts 字段完整
  - [x] SubTask 9.2: 单个生成自定义表情 → 验证使用 prompts.positive 而非兜底
  - [x] SubTask 9.3: 批量生成 → 验证包含自定义情绪 + 总数正确
  - [x] SubTask 9.4: 编辑自定义情绪关键词 → 重新生成提示词 → 验证 manifest 更新
  - [x] SubTask 9.5: 删除自定义情绪 → 验证 manifest 清理 + 图片删除
  - [x] SubTask 9.6: 旧数据兼容性：无 prompts 字段的自定义情绪 → 验证回退兜底逻辑
  - [x] SubTask 9.7: NL 模型模式下自定义情绪生成 → 验证使用 prompts.nlPrompt
  - [x] SubTask 9.8: 预置情绪功能回归 → 验证未被破坏

- [x] Task 10: 更新技术文档
  - [x] SubTask 10.1: 更新 `docs/AI_USAGE_INVENTORY.md` 新增自定义情绪提示词生成场景
  - [x] SubTask 10.2: 更新 `docs/user-manual.md` 角色卡表情管理章节，补充自定义情绪 AI 提示词功能说明

# Task Dependencies
- Task 2（IPC）依赖 Task 1（数据层）
- Task 4（AI IPC）依赖 Task 3（AI Service）
- Task 5（UI）依赖 Task 2 + Task 4
- Task 6（Store）依赖 Task 2
- Task 7（PromptBuilder）独立，可与 Task 5/6 并行
- Task 8（生成 UI）依赖 Task 7 + Task 6
- Task 9（验证）依赖 Task 1-8 全部完成
- Task 10（文档）依赖 Task 9 验证通过
