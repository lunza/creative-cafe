# 修复对话模式AI回复过于简短问题 Spec

## Why
在对话模式中，AI仅回复简短的两句话，未能提供完整、详细的响应。经分析，根本原因是Token管理配置的默认值过于保守，导致对话上下文被严重截断，AI缺乏足够的对话历史来生成详细回复。

## What Changes
- **修改 `maxContextTokens` 默认值**：从 6000 提升至 32000，适配现代AI模型的上下文窗口
- **修改 `reservedForResponse` 默认值**：从 1024 提升至 4096，为AI响应预留充足空间
- **优化 Token 管理面板的预设配置**：更新模型预设的默认值，使其更合理
- **添加 Token 预算警告日志**：当可用预算过低时输出警告，便于调试

## Impact
- Affected specs: Token管理、对话上下文截断
- Affected code: 
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` - 默认配置值
  - `src/renderer/components/Character/CharacterDialogueChat/TokenManagementPanel.tsx` - 模型预设配置
  - `src/renderer/components/Character/CharacterDialogueChat/TokenManagement/ContextTruncator.ts` - 添加预算警告

## ADDED Requirements
### Requirement: Token预算警告
当可用Token预算低于阈值时，系统 SHALL 输出警告日志，提示用户调整配置。

#### Scenario: 预算过低警告
- **WHEN** 可用预算（maxContextTokens - systemPromptTokens - reservedForResponse）低于 2000 tokens
- **THEN** 系统输出警告日志，包含当前预算值和推荐配置

## MODIFIED Requirements
### Requirement: Token管理默认配置
系统 SHALL 使用更合理的默认Token管理配置，确保AI有足够上下文生成详细回复。

**修改前**：
- maxContextTokens: 6000
- reservedForResponse: 1024
- minMessagesToKeep: 2
- maxMessagesToKeep: 40

**修改后**：
- maxContextTokens: 32000
- reservedForResponse: 4096
- minMessagesToKeep: 3
- maxMessagesToKeep: 60

### Requirement: 模型预设配置
Token管理面板中的模型预设 SHALL 使用更合理的默认值。

**修改内容**：
- Qwen3.5-27B: maxContextTokens 128000, reservedForResponse 8192 (保持不变)
- Gemma 4 31B: maxContextTokens 128000, reservedForResponse 8192 (保持不变)
- DeepSeek V3.2: maxContextTokens 64000, reservedForResponse 8192 (原4096)
- DeepSeek V4 Pro/Flash: maxContextTokens 512000, reservedForResponse 32768 (保持不变)
- Gemini 2.5 Pro / 3 Pro: maxContextTokens 512000, reservedForResponse 16384 (保持不变)
- GPT-5 / GPT-5.5: maxContextTokens 272000, reservedForResponse 16384 (保持不变)

## REMOVED Requirements
无

## 问题分析

### 根本原因
Token管理配置的默认值过于保守：
1. `maxContextTokens` 默认 6000 tokens - 对于现代AI模型来说太小
2. `reservedForResponse` 默认 1024 tokens - 限制了响应空间
3. 系统提示词本身可能占用 4000-6000+ tokens（角色信息+记忆表格指令+向量上下文）

### 预算计算示例
```
可用预算 = maxContextTokens - systemPromptTokens - reservedForResponse
         = 6000 - 5000 - 1024
         = -24 tokens (负值！)
```

当预算为负或接近0时，`ContextTruncator` 会严重截断对话历史，导致AI只看到最近1-2条消息，无法生成详细回复。

### 问题定位
1. **文件**: `CharacterDialogueChat.hooks.ts` 第670-676行
   - `maxContextTokens` 默认值 6000 过低
   - `reservedForResponse` 默认值 1024 过低

2. **文件**: `TokenManagementPanel.tsx` 第22-95行
   - 模型预设配置中部分模型的 `reservedForResponse` 值偏低

3. **文件**: `ContextTruncator.ts` 第17-19行
   - 预算计算逻辑正确，但输入参数不合理导致截断过度
