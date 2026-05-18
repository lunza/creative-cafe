# AI 对话响应调用栈溢出和超时修复 Spec

## Why
在修改对话逻辑后，系统出现两个关键错误：
1. `Maximum call stack size exceeded` - 调用栈溢出错误，发生在 AI 响应结束后的保存逻辑中
2. `Stream timeout (120s)` - AI 响应流超时，导致对话无法正常完成

这两个问题严重影响用户体验，需要彻底修复。

## What Changes
- 重构 `saveChatToStore` 调用逻辑，避免在 `setState` 回调中执行异步操作
- 修复 IPC 序列化时的循环引用问题
- 检查并修复 AI 响应流处理机制的超时问题
- 添加完整的测试用例验证修复效果

## Impact
- Affected specs: AI 对话系统核心功能
- Affected code: `CharacterDialogueChat.hooks.ts`, `characterChatStore.ts`, `preload.ts`, 流处理相关代码

## ADDED Requirements
### Requirement: 调用栈溢出修复
系统 SHALL 正确处理对话保存操作，避免循环引用导致的调用栈溢出。

#### Scenario: AI 响应完成后保存
- **WHEN** AI 响应完成
- **THEN** 系统安全地保存聊天记录到存储，不产生调用栈溢出

### Requirement: 流超时修复
系统 SHALL 在合理时间内完成 AI 响应流的处理，不超过 120 秒超时。

#### Scenario: 正常流处理
- **WHEN** AI 开始响应
- **THEN** 流处理在 120 秒内完成，或正确报告错误

## MODIFIED Requirements
### Requirement: 聊天记录保存逻辑
重构 `CharacterDialogueChat.hooks.ts` 中的 `onComplete` 回调逻辑，将保存操作移出 `setState` 回调。

### Requirement: IPC 序列化保护
增强 `characterChatStore.ts` 中的数据清理逻辑，确保传递的数据是可序列化的纯数据对象。

## REMOVED Requirements
无
