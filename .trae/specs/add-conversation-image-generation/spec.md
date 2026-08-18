# 对话中生成图片功能 Spec

## Why
当前对话界面中，用户若想基于对话场景生成图片，需要手动打开素材管理弹窗、切换到一般图像 Tab、手动输入提示词。这割裂了对话沉浸感。通过在 AI 对话气泡下方新增"生成图片"按钮，用户可以一键基于当前对话上下文自动生成场景图片，并直接在对话流中展示结果，实现"对话即创作"的无缝体验。

## What Changes
- 在 `ChatMessageBubble.tsx` 的 AI 消息操作按钮区，"重新生成/从此版本重新生成"按钮右侧新增"生成图片"按钮
- 新增对话上下文分析服务：点击按钮后自动分析当前完整对话上下文，调用 AI 生成符合图片生成要求的 tag 提示词
- 复用现有 `ai:generateTraitPrompts` IPC 通道进行 tag 生成与 L0-L5 审计
- 将上下文 tag 与角色特征 tag 合并去重后，复用 `sd:generateTxt2Img` IPC 通道（与素材管理——一般图像完全相同的生成路径）
- 在 `ConfigPanel.tsx` 新增"图片生成设置"配置区域，包含"是否开启图片生成"开关和"图片大小"下拉选择
- 扩展 `AIParameterConfig` 类型，新增 `image_gen_enabled` / `image_gen_width` / `image_gen_height` 字段
- 扩展 `ChatMessage` 类型，新增 `generatedImage` 字段用于在对话流中展示生成图片
- 图片生成过程中显示加载状态，完成后在对话流中展示，失败时显示错误提示

## Impact
- Affected specs: `add-asset-and-trait-management`（复用素材生成链路）、`add-multi-round-tag-audit`（复用 L0-L5 审计）、`add-character-expression-system`（消息气泡渲染扩展）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 新增按钮与图片渲染
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — 新增状态管理与生成流程编排
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — 扩展类型定义
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — 新增配置区域
  - `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx` — 或新建 ImageGenPanel 子面板
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 按钮与图片样式
  - `src/main/services/sdGenerationService.ts` — 间接复用（不修改）
  - `src/main/services/characterTraitAIService.ts` — 间接复用（不修改）

## ADDED Requirements

### Requirement: 对话气泡"生成图片"按钮
系统 SHALL 在 AI 对话气泡下方的操作按钮区，"重新生成/从此版本重新生成"按钮的右侧，提供一个"生成图片"按钮。

#### Scenario: 按钮正常显示
- **WHEN** AI 消息处于已发送状态（非流式、非生成中）且图片生成功能已开启
- **THEN** "生成图片"按钮在操作按钮区可见且可点击

#### Scenario: 功能关闭时按钮禁用
- **WHEN** "是否开启图片生成"开关处于关闭状态
- **THEN** "生成图片"按钮显示为禁用状态（灰色不可点击），鼠标悬停时提示"图片生成功能未开启"

#### Scenario: 生成过程中按钮状态
- **WHEN** 图片正在生成中
- **THEN** "生成图片"按钮显示加载动画并禁用，防止重复点击

### Requirement: 对话上下文 Tag 生成与审计
系统 SHALL 在用户点击"生成图片"按钮时，自动分析当前完整对话上下文，通过 AI 生成符合图片生成要求的 tag 提示词，并经过 L0-L5 标签审计链验证。

#### Scenario: 上下文分析与 tag 生成
- **WHEN** 用户点击"生成图片"按钮
- **THEN** 系统将当前对话上下文（最近 N 条消息内容摘要）作为 prompt，调用 `ai:generateTraitPrompts` IPC 生成 tag 提示词
- **AND** 生成的 tag 经过 L0-L5 审计链验证（用户同义词映射 → 标签库精确匹配 → 别名匹配 → 颜色拆分 → KNN 语义替换 → AI 兜底）

#### Scenario: Tag 合并去重
- **WHEN** 上下文 tag 生成完成
- **THEN** 系统将上下文 tag 与角色特征 tag（从 `characterTraitStore` 获取已启用的特征）进行合并
- **AND** 执行大小写不敏感的去重处理
- **AND** 合并后的完整 tag 集合作为 `characterTraits` 传入 SD 生成选项

### Requirement: 图片生成引擎调用
系统 SHALL 使用合并后的完整 tag 集合，复用"素材管理——一般图像——AI 生成一般图像"路径下的 `sd:generateTxt2Img` 逻辑执行图片生成。

#### Scenario: 正常生成
- **WHEN** tag 合并完成且 SD WebUI 状态正常
- **THEN** 系统调用 `sd:generateTxt2Img` IPC，传入 endpoint、prompt（含 `{traits}` / `{camera}` 占位符模板）、negativePrompt、options（含 characterTraits、selectedLoras、宽高等参数）
- **AND** SD 服务层通过 `applyTraitsAndLora` 替换占位符、注入 LoRA、格式化权重后发送请求

#### Scenario: SD WebUI 未连接
- **WHEN** SD WebUI 状态检测失败
- **THEN** 显示错误提示"SD WebUI 未连接，请检查服务状态"，不执行生成

### Requirement: 对话流中展示生成结果
系统 SHALL 在图片生成完成后，将生成的图片以合适的方式展示在对话流中。

#### Scenario: 生成成功
- **WHEN** SD 引擎返回生成结果
- **THEN** 在当前 AI 消息气泡下方插入一条图片消息（role 为 assistant），展示生成的图片
- **AND** 图片消息带有时间戳和"生成图片"标识

#### Scenario: 生成失败
- **WHEN** SD 引擎返回错误或调用超时
- **THEN** 在对话流中显示错误提示消息，包含错误原因
- **AND** "生成图片"按钮恢复为可点击状态

### Requirement: 控制面板图片生成设置
系统 SHALL 在对话右侧控制面板内新增"图片生成设置"配置区域。

#### Scenario: 配置区域显示
- **WHEN** 用户打开对话界面的右侧控制面板
- **THEN** 在 ParameterPanel 下方（或记忆与上下文增强区域附近）显示"图片生成设置"区域
- **AND** 区域包含"是否开启图片生成"开关组件和"图片大小"下拉选择组件

#### Scenario: 开关控制
- **WHEN** 用户切换"是否开启图片生成"开关
- **THEN** 配置立即生效并持久化到 `character-session-<cardId>` localStorage
- **AND** 关闭时对话气泡上的"生成图片"按钮变为禁用状态

#### Scenario: 图片大小选择
- **WHEN** 用户从"图片大小"下拉中选择一个预设尺寸
- **THEN** 选中的尺寸（宽×高）持久化到角色会话配置
- **AND** 后续图片生成使用该尺寸作为 SD 请求的 width/height 参数

### Requirement: 兼容性与布局
系统 SHALL 确保新功能与现有对话系统无冲突，并在不同屏幕尺寸下保持布局合理。

#### Scenario: 现有功能不受影响
- **WHEN** 图片生成功能未开启
- **THEN** 对话界面的所有现有功能（重新生成、继续对话、编辑、版本管理等）行为不变

#### Scenario: 响应式布局
- **WHEN** 对话窗口在不同屏幕尺寸下显示
- **THEN** "生成图片"按钮在操作按钮区中正确排列，不溢出或遮挡其他按钮
- **AND** 生成的图片在对话流中按比例缩放显示，不破坏对话区域布局
