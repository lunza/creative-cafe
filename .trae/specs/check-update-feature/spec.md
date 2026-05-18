# 检查更新功能 Spec

## Why
当前「检查更新」功能在 [`updateHandlers.ts`](file:///g:/AI/creative-cafe/src/main/ipc/handlers/updateHandlers.ts) 中仅返回"更新功能尚未实现"的占位响应，需要实现完整的 GitHub 更新检查流程，包括检测远程代码变更、展示修改记录、用户确认后拉取并重新编译。

## What Changes
- **实现 GitHub 更新检测** - 通过 GitHub API 或 Git 命令检查远程仓库是否有新提交
- **展示变更列表** - 将新提交的 commit message 展示给用户
- **用户确认后拉取** - 用户确认后执行 `git pull` 拉取最新代码
- **重新编译项目** - 拉取完成后自动执行 `npm run build` 重新编译
- **更新 UI 反馈** - 整个过程提供进度提示和操作日志

## Impact
- **受影响的规范**: 更新检测规范、Git 操作规范、编译流程规范
- **受影响的代码**: 
  - IPC 处理器：[`src/main/ipc/handlers/updateHandlers.ts`](file:///g:/AI/creative-cafe/src/main/ipc/handlers/updateHandlers.ts)
  - 预加载脚本：[`src/main/preload.ts`](file:///g:/AI/creative-cafe/src/main/preload.ts)
  - 前端组件：[`src/renderer/components/Dashboard/Dashboard.tsx`](file:///g:/AI/creative-cafe/src/renderer/components/Dashboard/Dashboard.tsx)（已有 UI，无需大改）
  - 已有依赖：`simple-git`（已在 package.json 中）

## ADDED Requirements

### Requirement: 检查更新 IPC 处理器
系统 SHALL 提供 `update:check` IPC 处理器，通过 Git 命令检查远程仓库最新提交并获取 commit 差异。

#### Scenario: 检查更新成功
- **WHEN** 用户点击「检查更新」按钮
- **THEN** 处理器执行 `git fetch --dry-run` 检查是否有新更新
- **AND** 获取本地与远程的 commit 差异列表
- **AND** 返回 `{ success: true, hasUpdate: boolean, currentVersion: string, latestVersion: string, commits: CommitInfo[] }`

#### Scenario: 检查更新失败（非 Git 仓库）
- **WHEN** 应用所在目录不是 Git 仓库
- **THEN** 返回 `{ success: false, message: '当前目录不是 Git 仓库，无法检查更新' }`

### Requirement: 拉取更新 IPC 处理器
系统 SHALL 提供 `update:pull` IPC 处理器，执行 `git pull` 并触发项目重新编译。

#### Scenario: 拉取更新成功
- **WHEN** 用户确认更新
- **THEN** 处理器执行 `git pull` 拉取最新代码
- **AND** 拉取完成后自动执行 `npm run build` 重新编译
- **AND** 编译完成后返回成功状态和变更文件列表

#### Scenario: 拉取更新失败
- **WHEN** `git pull` 或编译过程中出现冲突/错误
- **THEN** 返回错误信息和详细日志
- **AND** 不破坏用户本地未提交的更改

## MODIFIED Requirements

### Requirement: Dashboard 检查更新流程
**变更内容**: 
- 修改 [`Dashboard.tsx`](file:///g:/AI/creative-cafe/src/renderer/components/Dashboard/Dashboard.tsx#L88-L141) 中的 `handleCheckUpdate` 逻辑
- 显示 commit 变更列表供用户确认
- 使用新的 `update:pull` IPC 替代现有的 `update:download` + `update:install` 流程

**迁移方案**:
- 保留现有 UI 结构（Modal.confirm）
- 将内容改为显示变更列表（commit message）
- onOk 回调改为调用 `window.electronAPI.update.pull()`

### Requirement: IPC 处理器
**变更内容**:
- 将 [`updateHandlers.ts`](file:///g:/AI/creative-cafe/src/main/ipc/handlers/updateHandlers.ts) 中的三个处理器替换为 `update:check` 和 `update:pull`
- 移除不再需要的 `update:download` 和 `update:install`

## REMOVED Requirements
### Requirement: 下载和安装更新
**Reason**: 本项目通过 GitHub 源码更新，不需要下载二进制包的方式
**Migration**: 移除 `update:download` 和 `update:install` 处理器，用 `update:pull` 替代
