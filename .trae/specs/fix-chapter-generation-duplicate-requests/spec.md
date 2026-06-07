# 修复章节生成重复请求问题 Spec

## Why

当用户生成第N章内容时，AI会连续返回N次不同的章节内容，导致字数呈倍数增长。生成第一章正常（2万字），第二章生成约4万字（2次），第三章生成约6万字（3次）。这是因为事件监听器被重复注册且旧监听器未被正确清理，导致同一个`onStreamComplete`事件触发了多次回调。

## What Changes

- 修改`useChapterGeneration.ts`中事件监听器的`useEffect`依赖，从`[outline]`改为空数组`[]`，避免outline变化时重复注册监听器
- 使用refs存储需要在回调中访问的最新状态值（如`outlineRef`），避免闭包陈旧值问题
- 确保IPC监听器在整个组件生命周期内只注册一次

## Impact

- Affected specs: 章节内容生成、事件监听器生命周期管理
- Affected code: `useChapterGeneration.ts` 中的事件监听器 useEffect

## 问题根因分析

### 问题复现路径

1. `useChapterGeneration.ts` 中有一个 `useEffect` 依赖 `[outline]`，每次outline变化都会重新注册事件监听器
2. 当用户生成第一章后，`onStreamComplete` 回调调用 `updateProject` 更新项目数据
3. `updateProject` 导致 `projects` 状态变化 → `currentProject` 变化 → `outline` prop 引用变化
4. `outline` 引用变化 → `useEffect` cleanup 执行 → 尝试移除旧监听器 → 重新注册新监听器
5. **关键问题**：如果 `outline` 在短时间内多次变化（如项目加载、内容更新等场景），React 的批处理机制可能导致多次 cleanup 和重新注册发生，旧监听器未被正确移除
6. 每次生成章节前，累积的监听器数量 = outline 变化次数 ≈ 章节序号
7. 当主进程发送 `writing:stream:complete` 事件时，所有累积的监听器都会触发回调，导致内容被重复处理

### 监听器累积过程

- 初始化阶段：outline 变化 N 次（项目加载、状态初始化等）
- 每次变化都注册新的监听器，但旧监听器可能由于时序问题未被完全清理
- 生成第M章时，已有M个监听器在监听同一个事件
- 事件触发 → M个回调同时执行 → 内容被更新M次

## ADDED Requirements

### Requirement: 事件监听器单次注册
系统 SHALL 确保所有 IPC 事件监听器在组件生命周期内只注册一次，不受 outline 或其他状态变化影响。

#### Scenario: 组件挂载和更新
- **WHEN** ContentWorkspace 组件挂载并随 outline 变化而更新
- **THEN** IPC 事件监听器（onStreamChunk、onStreamComplete、onStreamError）只注册一次，不会被重复注册

#### Scenario: 章节生成完成
- **WHEN** 第N章内容生成完成，outline 状态更新
- **THEN** 只收到一次 onStreamComplete 事件，章节内容只被更新一次

### Requirement: 使用 Refs 避免闭包问题
系统 SHALL 使用 refs 存储回调中需要访问的最新状态值，确保监听器使用最新的 outline 数据。

#### Scenario: 监听器回调访问 outline
- **WHEN** onStreamComplete 回调需要访问 outline 数据
- **THEN** 通过 outlineRef.current 获取最新值，而非依赖闭包捕获的旧值

## MODIFIED Requirements

### Requirement: 事件监听器 useEffect 依赖
原依赖 `[outline]` 修改为 `[]`（空数组），配合 refs 使用最新状态值。
