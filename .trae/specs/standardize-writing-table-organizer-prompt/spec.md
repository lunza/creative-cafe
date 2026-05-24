# 标准化写作模式表格整理提示词 Spec

## Why
当前写作模式中的表格整理功能（`WritingStorageService.buildChapterPrompt`）使用的提示词过于简单，缺少必要的结构化组成部分，导致AI无法正确识别实体、维护唯一ID一致性、执行增量更新。需要参照聊天模式已验证的提示词结构（`chatLogService.buildAIPromptForProgressive`），标准化写作模式的提示词拼接逻辑，确保提示词完整性与业务流程连续性。

## What Changes
- 重构 `WritingStorageService.buildChapterPrompt` 方法，按固定顺序拼接完整提示词
- 新增 `buildTableContextForPrompt` 方法，构建包含历史表格数据和唯一ID快速查找索引的上下文
- 新增章节内容智能拆分逻辑，支持按段落+字数拆分后分多次整理
- 新增 `buildWritingTableOrganizePrompt` 方法，参照聊天模式标准提示词结构
- 修改 `processChapterWithAI` 支持分批次处理长章节内容
- **BREAKING**: 旧的简单提示词格式将被完全替换，AI返回格式必须为 `<tableEdit>` 标签命令

## Impact
- Affected specs: writing-mode-table-organizer, implement-single-chapter-table-organize
- Affected code:
  - `src/main/services/WritingStorageService.ts` - 重构提示词构建逻辑，新增章节拆分方法
  - `src/main/services/memory/chatLogService.ts` - 作为参考标准（无需修改）

## ADDED Requirements

### Requirement: 标准化提示词结构
系统 SHALL 按以下固定顺序拼接完整提示词，严禁任何章节内容截断：

1. **角色设定** - AI角色定义与核心任务说明
2. **当前消息** - 当前章节/段落内容
3. **历史表格数据上下文** - 当前已有数据 + 唯一ID快速查找索引
4. **表格模板结构** - 模板页签描述、字段索引、表格用途说明
5. **表格提取规则** - 各表格提取字段说明
6. **唯一ID生成指南** - 各表格唯一ID命名规范
7. **核心任务：唯一ID策略与变体称呼识别** - 实体识别与一致性维护规则
8. **增量更新策略** - 强制重复性检查、唯一ID匹配规则、名称相似度匹配
9. **输出要求** - tableEdit命令格式规范、错误格式示例
10. **示例输出** - 精确格式约束的示例

#### Scenario: 提示词拼接完整性
- **WHEN** 系统构建表格整理提示词
- **THEN** 必须包含上述10个组成部分，缺一不可
- **THEN** 每个部分必须完整输出，不得截断

### Requirement: 历史表格数据上下文构建
系统 SHALL 构建包含当前表格数据和唯一ID索引的上下文信息。

#### Scenario: 构建表格上下文
- **WHEN** 章节内容需要整理
- **THEN** 系统读取当前项目的表格数据
- **THEN** 生成"当前已有数据"部分，展示每个页签的现有记录
- **THEN** 生成"唯一ID快速查找索引"部分，便于AI快速定位实体

### Requirement: 章节内容智能拆分
系统 SHALL 支持对过长章节内容按段落+字数进行拆分，分多次进行整理。

#### Scenario: 章节内容过长
- **WHEN** 章节内容超过设定阈值（如8000字符）
- **THEN** 系统按段落边界拆分章节内容
- **THEN** 每段内容保持合理字数（如3000-5000字符）
- **THEN** 分批次调用AI，每批次使用完整提示词结构
- **THEN** 每批次都必须正确返回tableEdit命令

#### Scenario: 拆分后分批处理
- **WHEN** 章节被拆分为多段
- **THEN** 每段处理时都携带完整的历史表格数据上下文
- **THEN** 每段处理结果依次执行tableEdit命令
- **THEN** 表格数据在批次间保持连续性

### Requirement: tableEdit命令格式强制校验
系统 SHALL 确保AI正确返回tableEdit命令，对返回格式进行严格校验。

#### Scenario: AI返回有效tableEdit命令
- **WHEN** AI响应中包含 `<tableEdit>` 标签
- **THEN** 系统解析标签内的命令
- **THEN** 校验命令格式（insertRow/updateRow/deleteRow）
- **THEN** 执行有效的tableEdit命令

#### Scenario: AI返回无效格式
- **WHEN** AI响应中未包含 `<tableEdit>` 标签或命令格式错误
- **THEN** 系统记录错误并返回失败状态
- **THEN** 错误信息包含具体的格式问题描述

## MODIFIED Requirements

### Requirement: buildChapterPrompt 方法
**修改原因**: 当前提示词过于简单，缺少必要的结构化组成部分

```
重构 WritingStorageService.buildChapterPrompt 方法:
- 按固定顺序拼接10个必要组成部分
- 参照 chatLogService.buildAIPromptForProgressive 的提示词结构
- 确保历史表格数据、表格模板结构、提取规则、唯一ID指南、输出要求完整拼接
- 支持章节内容智能拆分
```

### Requirement: processChapterWithAI 方法
**修改原因**: 当前方法不支持长章节拆分处理

```
修改 WritingStorageService.processChapterWithAI 方法:
- 检测章节内容长度，超过阈值时进行拆分
- 拆分后分批次调用AI，每批次使用完整提示词
- 每批次处理结果依次执行tableEdit命令
- 确保表格数据在批次间保持连续性
```

## REMOVED Requirements

### Requirement: 简单提示词格式
**Reason**: 旧提示词缺少必要的结构化组成部分，AI无法正确执行增量更新和唯一ID一致性维护
**Migration**: 完全替换为标准化提示词结构，参照聊天模式已验证的提示词模板
