# AI 调用处理模块全面多模态兼容升级 Spec

## Why

前序 Spec（add-model-capability-detection-and-image-recognition）已实现模型能力检测和图片识别特征提取，但系统中 AI 调用链路仍存在兼容性隐患：`AIService.enrichSystemPrompt` 对多模态 content 存在潜在 bug（字符串拼接数组会产生 `[object Object]`）；用户无法在主界面直观了解当前模型能力组合，可能在不具备特定能力时误用功能。需对所有 AI 调用点进行全面兼容性审计与适配，并在主界面 logo 旁显示能力标识。

## What Changes

- 修复 `AIService.enrichSystemPrompt` 多模态兼容性潜在 bug（数组 content 拼接问题）
- 在主界面 Header logo 旁新增全局模型能力标识（眼睛=视觉、思考=思维链、扳手=工具调用），实时反映当前 AI 引擎能力
- 审计所有 AI 调用点，为涉及 `ChatMessage` 类型的调用添加能力感知逻辑与注释
- 确保 `ChatEngine` 在构建请求体时感知 `supportsThinking` / `supportsToolCalling`（如注入思维链参数或 tools 参数）
- 为所有新增兼容性逻辑添加详细中文注释

## Impact

- Affected specs: `add-model-capability-detection-and-image-recognition`（能力检测已完成，本 Spec 消费检测结果）
- Affected code:
  - 修改：`src/main/services/AIService.ts` — 修复 `enrichSystemPrompt` 多模态兼容性
  - 修改：`src/renderer/components/Layout/Header.tsx` — logo 旁新增能力标识
  - 修改：`src/renderer/components/Common/ChatEngine/ChatEngine.ts` — 请求构建时感知能力
  - 修改：`src/renderer/components/Common/ChatEngine/ChatEngine.types.ts` — 能力适配辅助函数
  - 审计（可能修改）：所有 writing 服务中的 `enrichSystemPrompt` 实现

## 技术方案

### enrichSystemPrompt 修复

```typescript
// 修复前（潜在 bug）：
content: engineSystemPrompt.trim() + '\n\n' + msg.content

// 修复后：
content: typeof msg.content === 'string'
  ? engineSystemPrompt.trim() + '\n\n' + msg.content
  : msg.content  // 数组 content 不做拼接，直接保留
```

### Header 能力标识

在 `Header.tsx` 的 `.logo-container` 中 `.title-container` 之后新增能力标识区域：
- 从 `useSettingStore` 读取当前活跃引擎的 `capabilities`
- 渲染 `renderCapabilityBadges`（复用 `AIEngineSettingsPanel` 中的逻辑或提取为公共组件）
- 能力标识为小尺寸 Tag/图标，不占用过多空间

### ChatEngine 能力感知

`ChatEngine.sendMessage` 构建请求体时：
- `supportsThinking=true`：可注入思维链相关参数（如 `enable_thinking: true`，取决于模型 API 支持）
- `supportsToolCalling=true`：保留现有 `use_function_calling` 逻辑（已有）
- `supportsVision=true`：当前聊天流程暂不发送图片（聊天内容为文本），但标识已知可用

## ADDED Requirements

### Requirement: 全局模型能力标识
系统 SHALL 在主界面 Header 的 logo 旁实时显示当前 AI 模型的能力组合标识。

#### Scenario: 显示能力标识
- **WHEN** 用户打开应用主界面
- **THEN** 在 logo 旁显示当前活跃引擎的能力图标
- **AND** 编辑图标（文本生成）始终显示
- **AND** 眼睛图标仅在 supportsVision=true 时显示
- **AND** 思考图标仅在 supportsThinking=true 时显示
- **AND** 扳手图标仅在 supportsToolCalling=true 时显示

#### Scenario: 切换引擎后更新标识
- **WHEN** 用户在设置中切换活跃 AI 引擎
- **THEN** Header 中的能力标识立即更新为新引擎的能力组合

#### Scenario: 未测试能力的引擎
- **WHEN** 引擎未执行过连通性测试（capabilities 为 undefined 或仅有默认值）
- **THEN** 仅显示编辑图标（文本生成），不显示其他能力标识
- **AND** 悬浮提示「请先测试连通性以检测模型能力」

### Requirement: enrichSystemPrompt 多模态兼容
系统 SHALL 确保 `enrichSystemPrompt` 方法在遇到数组类型 content 时不会产生错误输出。

#### Scenario: 系统消息为字符串 content
- **WHEN** `enrichSystemPrompt` 处理首条 system message 且 content 为字符串
- **THEN** 正常拼接引擎 system prompt（现有行为不变）

#### Scenario: 系统消息为数组 content
- **WHEN** `enrichSystemPrompt` 处理首条 system message 且 content 为数组
- **THEN** 保留原 content 数组不变，不进行字符串拼接
- **AND** 引擎 system prompt 的注入由调用方在构建 messages 时自行处理

### Requirement: AI 调用全面兼容性
系统 SHALL 确保所有 AI 调用点在模型具备或不具备特定能力时均能正常运行。

#### Scenario: 不支持视觉的模型调用特征生成
- **WHEN** 模型 supportsVision=false 且用户点击「AI 生成特征」
- **THEN** 仅发送文本描述，不发送图片
- **AND** 功能正常运行，无错误

#### Scenario: 不支持思维链的模型进行聊天
- **WHEN** 模型 supportsThinking=false 且用户进行角色对话
- **THEN** 请求体不注入思维链相关参数
- **AND** 聊天功能正常运行

#### Scenario: 所有 writing 服务调用
- **WHEN** 任何 writing 服务（大纲生成、内容生成、描述润色等）调用 AI
- **THEN** 使用字符串 content（这些服务不涉及多模态）
- **AND** 不受 ChatMessage 联合类型影响

## MODIFIED Requirements

无（本 Spec 为新增兼容性保障，不修改已有功能行为）。

## REMOVED Requirements

无。
