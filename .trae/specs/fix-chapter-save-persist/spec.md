# Fix Chapter Save - updateOutline Does Not Persist Data Spec

## Why
经过深入排查发现真正的问题：`writingProjectStore` 的 `updateOutline` 方法只将章节数据推入撤销历史并触发自动保存，但完全没有更新项目中存储的 outline 数据。`saveProject` 保存的是未修改的旧项目对象，导致无论用户如何修改，持久化到磁盘的都是原始数据。同时 `updateOutline` 和 `saveProject` 方法中缺少关键日志输出，导致无法追踪问题。

## What Changes
- 修改 `updateOutline` 方法，使其真正更新当前项目的 outline 数据后再触发保存
- 添加关键日志输出到 `updateOutline`、`saveProject` 和 `triggerAutoSave` 方法
- 添加异常捕获并记录日志，防止静默失败

## Impact
- Affected specs: 大纲编辑功能、章节数据持久化
- Affected code: src/renderer/stores/writingProjectStore.ts

## ADDED Requirements
### Requirement: updateOutline 正确持久化章节数据
`updateOutline` 方法 SHALL 将传入的章节数据更新到当前项目的 outline 中，然后触发保存操作。

#### Scenario: 保存章节修改
- **WHEN** 用户调用 `updateOutline(chapters)`
- **THEN** 当前项目的 outline.chapters 被更新，项目被持久化到磁盘，控制台输出保存日志

### Requirement: 保存操作日志记录
系统 SHALL 在保存流程的关键节点输出日志，包括 `updateOutline` 调用、`saveProject` 执行结果等。

## MODIFIED Requirements
### Requirement: updateOutline 方法实现
现有的 `updateOutline` 仅推入历史不更新数据，需要修改为同时更新项目数据。

### Requirement: saveProject 日志输出
现有的 `saveProject` 缺少日志输出，需要添加执行日志。

## REMOVED Requirements
### Requirement: None
没有需求被移除。