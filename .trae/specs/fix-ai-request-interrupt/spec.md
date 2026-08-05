# AI 请求中断功能修复 Spec

## Why

系统中所有与中断功能相关的按钮存在严重功能缺陷：用户点击中断按钮后，按钮状态不更新（始终显示"中断xxx"），系统日志缺乏中断反馈，核心问题是 AI 模型的 HTTP 连接未被有效切断——即使用户关闭页面或刷新浏览器，AI 请求仍在后台继续执行。根因有三层：(1) 前端中断处理函数仅设置本地 ref 标志，未调用后端 `ai:cancel` IPC 通道；(2) 后端 `ai:cancel` 仅注册了流式请求的 AbortController，非流式请求（世界书翻译/润色/审核/关键词生成等）的 controller 从未存入 `activeRequests` Map，无法被取消；(3) 无页面关闭/刷新时的清理机制。

## What Changes

- **修复 `electron.d.ts` 类型声明**：在 `ai` 接口中补充 `cancel` 方法类型声明，消除前端调用 `window.electronAPI.ai.cancel()` 的类型障碍
- **修复后端 `aiHandlers.ts`**：非流式请求分支也注册 AbortController 到 `activeRequests` Map；`activeRequests` 改为支持多并发请求（按 requestId 索引而非仅 senderId）
- **修复前端 `WorldBookManager.tsx` 的 `handleCancelAIRequest`**：调用 `window.electronAPI.ai.cancel()` 真正切断后端 HTTP 连接；重置所有 AI 操作状态（`isPolishingAll`/`isTranslatingAll`/`isAuditingAll`/`polishingField`/`translatingField`/`auditingField`/`isGeneratingKeywordsAll`/`isAISorting` 等）；输出详细操作日志
- **新增页面关闭/刷新清理**：在 WorldBookManager 挂载 `beforeunload` 事件监听器，页面关闭/刷新时调用 `ai.cancel()` 终止所有活跃请求
- **新增主进程退出清理**：在 `src/main/index.ts` 的 `before-quit` 中止所有 `activeRequests` 中的活跃请求
- **修复 AgentCenter 中断**：确保 Agent 对话中断按钮也调用 `ai.cancel()`

## Impact

- Affected specs: 无直接关联的已有 spec
- Affected code:
  - `src/renderer/types/electron.d.ts` — 补充 `ai.cancel` 类型声明
  - `src/main/ipc/handlers/aiHandlers.ts` — 修复非流式请求的 AbortController 注册 + 支持多并发
  - `src/renderer/components/WorldBook/WorldBookManager.tsx` — 修复 `handleCancelAIRequest` + 新增 `beforeunload` 清理
  - `src/renderer/components/WorldBook/hooks/useWorldBookFormState.ts` — 新增批量状态重置方法
  - `src/main/index.ts` — `before-quit` 中清理所有活跃 AI 请求
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 中断按钮调用 `ai.cancel()`

## ADDED Requirements

### Requirement: AI 请求取消类型声明

系统 SHALL 在 `src/renderer/types/electron.d.ts` 的 `ai` 接口中声明 `cancel` 方法，签名为 `cancel: () => Promise<{ success: boolean; error?: string }>`，与 `preload.ts` 中已暴露的 `cancel: () => ipcRenderer.invoke('ai:cancel')` 对齐。

#### Scenario: 前端类型检查通过

- **WHEN** 前端代码调用 `window.electronAPI.ai.cancel()`
- **THEN** TypeScript 编译无错误，方法签名与 preload 暴露的实现一致

### Requirement: 非流式 AI 请求可取消

系统 SHALL 在 `aiHandlers.ts` 的非流式请求分支（`streaming === false`）中，将创建的 `AbortController` 注册到 `activeRequests` Map，使 `ai:cancel` 通道能够中止非流式 HTTP 请求。注册 SHALL 在 fetch 调用前完成，并在请求完成（成功或失败）后从 Map 中清理。

#### Scenario: 取消非流式请求

- **WHEN** 世界书润色/翻译/审核等非流式 AI 请求进行中，用户点击中断按钮
- **THEN** 后端 `ai:cancel` 找到对应的 AbortController 并调用 `controller.abort()`
- **AND** fetch 请求抛出 AbortError，主进程返回 `{ success: false, errorType: 'timeout' }` 或 `{ success: false, error: '请求超时' }`
- **AND** 前端 AI 操作函数捕获错误后正常退出循环

### Requirement: 多并发 AI 请求支持

系统 SHALL 将 `activeRequests` Map 改为支持同一 sender 的多个并发请求。Map 的 key SHALL 从单一的 `senderId` 改为 `senderId` + `requestId` 的组合（或使用 `Map<number, Set<ActiveRequest>>` 结构）。`ai:cancel` SHALL 能取消指定 sender 的所有活跃请求。

#### Scenario: 取消所有活跃请求

- **WHEN** 同一渲染进程有多个 AI 请求并发执行，用户点击中断按钮
- **THEN** `ai:cancel` 取消该 sender 的所有活跃请求（非仅最后一个）
- **AND** 所有被取消的请求都记录日志

### Requirement: 前端中断按钮完整状态重置

系统 SHALL 在 `handleCancelAIRequest`（及其等效函数）中执行以下操作：
1. 调用 `window.electronAPI.ai.cancel()` 切断后端 HTTP 连接
2. 设置 `isProcessingRef.current = false`
3. 重置所有 AI 操作状态：`isPolishingAll=false`、`isTranslatingAll=false`、`isAuditingAll=false`、`polishingField=null`、`translatingField=null`、`auditingField=null`、`isGeneratingKeywordsAll=false`、`isAISorting=false`、`isGeneratingEntries=false`、`generatingKeywordsUid=null`
4. 关闭所有进行中的 AI Modal（润色/翻译/审核要求输入 Modal）
5. 输出详细日志：`addLog('[WorldBook] 用户中断AI请求，已调用后端取消并重置所有状态', 'warn')`
6. 显示用户反馈：`message.info('已中断AI请求，后台连接已切断')`

#### Scenario: 中断后按钮状态正确更新

- **WHEN** 用户在润色进行中点击"中断润色"按钮
- **THEN** `isPolishingAll` 被重置为 false，`polishingField` 被重置为 null
- **AND** 按钮文案从"中断润色"恢复为"一键润色选中条目"或"AI润色"
- **AND** 其他 AI 操作按钮从 disabled 恢复为可点击

#### Scenario: 中断后后端请求停止

- **WHEN** 用户点击中断按钮
- **THEN** 后端 `ai:cancel` handler 被调用，AbortController.abort() 被执行
- **AND** 主进程日志记录 `AI 请求已被用户取消`
- **AND** 进行中的 fetch 请求被中止，不再消耗网络资源

### Requirement: 页面关闭/刷新时清理 AI 请求

系统 SHALL 在 WorldBookManager 组件挂载时注册 `beforeunload` 事件监听器，在页面关闭或刷新时调用 `window.electronAPI.ai.cancel()` 终止所有活跃的 AI 请求。监听器 SHALL 在组件卸载时移除。

#### Scenario: 页面关闭时终止请求

- **WHEN** AI 请求进行中，用户关闭页面或刷新浏览器
- **THEN** `beforeunload` 触发 `ai.cancel()` 调用
- **AND** 后端所有活跃请求被中止
- **AND** 不会产生孤儿请求继续在后台运行

### Requirement: 主进程退出时清理所有活跃请求

系统 SHALL 在 `src/main/index.ts` 的 `before-quit` 事件中，遍历 `activeRequests` Map 并中止所有活跃请求（不仅是当前 sender 的）。

#### Scenario: 应用退出时终止所有请求

- **WHEN** 应用退出时仍有 AI 请求在后台执行
- **THEN** `before-quit` 遍历所有 `activeRequests`，逐个调用 `controller.abort()`
- **AND** 日志记录清理的请求数量

## MODIFIED Requirements

### Requirement: WorldBook AI 操作中断机制

原有实现：`handleCancelAIRequest` 仅设置 `isProcessingRef.current = false`，依赖循环检查退出，不调用后端取消。现修改为：调用 `window.electronAPI.ai.cancel()` 真正切断后端连接，并重置所有 AI 操作状态变量。`useWorldBookFormState.ts` SHALL 新增 `resetAllAIStates` 方法，集中重置所有 AI 相关状态，供 `handleCancelAIRequest` 调用。

### Requirement: `ai:cancel` IPC 通道

原有实现：`ai:cancel` 仅通过 `senderId` 查找单个活跃请求，且非流式请求未注册。现修改为：非流式请求也注册 AbortController；`ai:cancel` 取消指定 sender 的所有活跃请求（支持多并发）。
