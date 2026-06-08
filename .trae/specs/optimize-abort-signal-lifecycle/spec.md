# 优化 Abort 信号生命周期管理 Spec

## Why

当前 abort 信号机制存在多个缺陷，导致用户点击"停止生成"后，刷新页面回到对应章节时，系统仍在后台继续生成内容。这会造成资源泄漏、状态不一致、以及意外的内容覆盖。根本原因包括：abort controller 注册后缺乏页面级生命周期清理、IPC 层和前端层的 abort 信号状态未同步、以及页面刷新时无法通知后端中止已有请求。

## What Changes

- 在 Electron 主进程中添加应用级窗口关闭/页面刷新时的 abort 清理拦截
- 在 `writing:generateChapter` 处理函数中，开始生成前检查并中止同一章节的已有请求
- 前端在组件挂载时主动调用 `writing:cancelGeneration` 清理后端残留任务
- 统一 abort 错误判断逻辑，确保所有 abort 相关错误都被正确归类
- 前端 unload 时自动发送取消请求

## Impact

- Affected specs: `fix-chapter-generation-duplicate-requests`、`fix-stream-error-handling`
- Affected code:
  - `writingHandlers.ts` - IPC 层 abort controller 管理
  - `useChapterGeneration.ts` - 前端 abort 信号管理、组件生命周期
  - `ContentGenerator.ts` - abort 错误判断逻辑

## ADDED Requirements

### Requirement: 页面级 abort 清理
系统 SHALL 在用户刷新页面或关闭写作模式窗口时，主动中止该窗口关联的所有生成任务。

#### Scenario: 前端页面刷新
- **WHEN** 用户在章节生成过程中刷新页面
- **THEN** 前端 `beforeunload` 事件触发，发送 `writing:cancelGeneration` 请求到主进程
- **THEN** 主进程中止该 `projectId` 关联的所有 abort controller
- **THEN** 页面刷新后，新加载的组件在挂载时会再次发送清理请求确保无残留

#### Scenario: 前端导航到其他页面
- **WHEN** 用户从写作模式导航到其他功能页面
- **THEN** 组件卸载时触发 `useEffect` cleanup，调用 `abort()` 中止请求
- **THEN** 组件卸载后，新挂载的组件（如再次进入写作模式）会执行清理逻辑

### Requirement: 生成前自动中止已有请求
系统 SHALL 在开始新的章节生成前，检查并中止同一章节的已有请求。

#### Scenario: 重复生成同一章节
- **WHEN** 用户在同一章节触发新的生成，而旧请求尚未完成
- **THEN** 主进程在 `writing:generateChapter` 中检测到该章节已有活跃的 abort controller
- **THEN** 主进程先中止旧请求，再创建新的 abort controller 开始新请求

### Requirement: 组件挂载时主动清理残留任务
系统 SHALL 在写作模式组件挂载时主动清理后端可能存在的残留生成任务。

#### Scenario: 页面刷新后进入写作模式
- **WHEN** 用户刷新页面后进入写作模式界面
- **THEN** `useChapterGeneration` hook 在初始化时调用 `writing:cancelGeneration`
- **THEN** 后端清理所有属于当前 `projectId` 的 abort controller
- **THEN** 用户点击"生成"时不会与残留任务冲突

### Requirement: 统一 abort 错误判断
系统 SHALL 在主进程流请求中正确识别所有形式的 abort 错误，包括 DOMException 和非 DOMException。

#### Scenario: Node.js 环境的 abort 错误
- **WHEN** Node.js fetch 被 abort 时抛出非 DOMException 错误（消息包含 "aborted"）
- **THEN** catch 逻辑正确识别为 abort 错误，不进行重试
- **THEN** 向渲染进程发送适当的完成/错误事件

## MODIFIED Requirements

### Requirement: `activeAbortControllers` 管理
原 `writingHandlers.ts` 中的 abort controller 管理仅在请求完成后清理。修改为：
1. 请求开始前检查并清理同 key 的已有 controller
2. 在页面级事件中主动清理所有 controller
3. `cancelGeneration` 处理器增加更细粒度的取消能力

### Requirement: 前端 abort 生命周期管理
原 `useChapterGeneration.ts` 仅在组件卸载时清理 abort controller。修改为：
1. 组件挂载时主动清理后端残留任务
2. 组件卸载时不仅 abort 本地 controller，还发送 IPC 取消请求到主进程
3. 在窗口 `beforeunload` 事件中发送取消请求

### Requirement: abort 错误判断逻辑
原 `ContentGenerator.ts` 使用 `error instanceof DOMException && error.name === 'AbortError'` 判断 abort。修改为同时检查错误消息是否包含 "abort" 关键词，覆盖 Node.js fetch 的非标准 abort 错误。

## REMOVED Requirements

无。
