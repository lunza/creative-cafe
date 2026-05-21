# 修复重复项目显示 Bug

## Bug 描述

在生成大纲后，左侧项目列表出现两个完全相同的项目（标题相同），其中一个包含章节内容，另一个为空。

## 根因分析

通过代码分析，发现重复项目的根因是：

1. **loadAllProjects 函数没有对 index 文件中的重复条目进行去重**：在 `WritingStorageService.loadAllProjects()` 中，遍历 `index.projects` 数组时，如果同一项目被多次添加到 index 文件中（由于某些竞态条件或重复保存），就会加载多次。

2. **loadProjects 函数没有对返回的项目列表进行去重**：在 `writingProjectStore.loadProjects()` 中，直接从存储层获取项目列表并设置到 store 中，没有进行基于 projectId 的去重。

3. **saveProject 函数虽然检查了已存在的 ID，但在某些情况下可能仍会产生重复**：例如，如果项目 ID 生成逻辑在极短时间内产生相同的时间戳和随机数组合。

## 修复方案

### 步骤 1：在 WritingStorageService.loadAllProjects 中添加去重逻辑

修改 `loadAllProjects` 函数，使用 Map 按 projectId 去重，确保即使 index 文件中有重复条目，也只加载一次。

### 步骤 2：在 writingProjectStore.loadProjects 中添加防御性去重

在 store 层也添加去重逻辑，确保即使存储层返回了重复项目，store 中也只保存一份。

### 步骤 3：验证修复效果

确保 TypeScript 编译通过，并验证项目列表只显示唯一的项目。

## 影响范围

- 仅影响项目加载和显示逻辑
- 不改变项目创建、保存或删除的行为
- 保持向后兼容
