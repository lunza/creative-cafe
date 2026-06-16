# 修复表格整理唯一ID重复问题 Spec

## Why

表格整理过程中，同一实体（如"night_seaside_motel_107_015"）出现多条完全相同的记录。问题根因是 `processChapterWithAI` 将章节切分为多个 chunk 处理，每个 chunk 的 AI 响应包含相同的表格行。虽然提示词中要求 AI 使用 `updateRow` 而非 `insertRow` 来避免重复，但实际 AI 并不总是遵守。`executeTableEditCommands` 的 `insertRow` 实现直接追加行，不做唯一 ID 检查，导致重复行累积。

## What Changes

- 在 `executeTableEditCommands` 的 `insertRow` 执行逻辑中增加唯一 ID 去重检查
- 当新行与现有行具有相同的唯一 ID 字段时，跳过插入或合并更新
- 整理流程完成后增加全局去重阶段，清除重复行
- 提示词中强化唯一 ID 去重说明（可选优化）

## Impact

- 受影响的代码：
  - `WritingStorageService.ts` — `executeTableEditCommands` 方法增加去重逻辑
  - `WritingStorageService.ts` — 整理完成后增加去重清理
  - `WritingStorageService.ts` — 提示词中强化去重说明

## ADDED Requirements

### Requirement: insertRow 唯一 ID 去重
系统 SHALL 在执行 `insertRow` 命令时检查目标 sheet 中是否已存在相同唯一 ID 的行。

#### Scenario: 检测到重复唯一 ID
- **WHEN** AI 返回 `insertRow` 命令，新行的唯一 ID 字段值与现有行相同
- **THEN** 系统跳过该插入操作，或使用 `updateRow` 合并数据
- **THEN** 不创建重复行

#### Scenario: 新行唯一 ID 不存在
- **WHEN** AI 返回 `insertRow` 命令，新行的唯一 ID 字段值在现有数据中不存在
- **THEN** 系统正常插入新行

### Requirement: 整理完成后去重清理
系统 SHALL 在章节整理完成后对每个 sheet 进行一次全局去重扫描。

#### Scenario: 全局去重
- **WHEN** 章节的所有 chunk 处理完成
- **THEN** 系统对每个 sheet 扫描，发现并移除唯一 ID 重复的行（保留第一条）
- **THEN** 保存去重后的数据

## MODIFIED Requirements

### Requirement: 提示词去重说明
在 `buildWritingTableOrganizePrompt` 和 `buildRowReorganizePrompt` 中，强化对 AI 的去重指令：明确说明插入新行前必须检查唯一 ID，已存在的实体必须使用 `updateRow`。

## REMOVED Requirements

无。
