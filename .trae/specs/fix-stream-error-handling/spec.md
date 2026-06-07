# 优化流中断处理 Spec

## Why

当前流中断（如超时、网络错误）处理存在两个问题：
1. **流中断后未清空已生成内容**：用户看到的是部分生成内容残留，容易产生困惑
2. **错误提示不友好**：错误消息使用技术性描述（如"AI 流请求最终失败: ..."），普通用户难以理解

用户需要清晰的错误提示和干净的界面状态。

## What Changes

- 流中断（所有重试失败后）时自动清空已生成的流式内容（`streamingContent`）
- 在错误处理中添加更友好的用户提示消息
- 区分流中断和其他错误类型，提供针对性的提示

## Impact

- Affected specs: 章节内容生成、错误处理
- Affected code: `useChapterGeneration.ts`（错误处理回调）、`ContentGenerator.ts`（错误类型判断）

## ADDED Requirements

### Requirement: 流中断时清空内容
系统 SHALL 在流中断且所有重试失败后，自动清空当前章节已生成的流式内容。

#### Scenario: 流中断且重试耗尽
- **WHEN** AI 流请求在最大重试次数（3次）后仍然失败
- **THEN** 系统清空 `streamingContent` 状态，清空当前字数统计，确保用户界面干净

#### Scenario: 流中断但被用户主动停止
- **WHEN** 用户主动点击"停止生成"导致流中断
- **THEN** 系统不清空已生成内容，保留当前进度

### Requirement: 友好的错误提示
系统 SHALL 在流中断时向用户展示清晰、易懂的提示信息。

#### Scenario: 流超时导致中断
- **WHEN** 流请求因超时而中断
- **THEN** 显示提示："生成超时，请检查网络连接或减少章节字数后重试"

#### Scenario: 网络错误导致中断
- **WHEN** 流请求因网络问题而中断
- **THEN** 显示提示："网络连接异常，请检查网络后重试"

#### Scenario: AI 服务错误
- **WHEN** AI 服务返回错误或不可用
- **THEN** 显示提示："AI 服务暂时不可用，请稍后重试"

#### Scenario: 未知错误
- **WHEN** 发生其他类型的生成错误
- **THEN** 显示提示："生成失败，请稍后重试"

## MODIFIED Requirements

### Requirement: 流中断错误处理
原 `onStreamError` 回调中使用技术性错误消息（`data.error?.message`），修改为根据错误类型展示用户友好的提示信息。

### Requirement: 流中断后的状态清理
原流中断时不清空 `streamingContent`，修改为在错误回调中清空流式内容和字数统计。
