# 剧情逻辑验证与记忆表格集成 Spec

## Why
现有剧情检查功能已实现了基本的多维度检查（大纲一致性、世界书遵循、角色卡符合度、写作风格、剧情连贯性），但缺乏对逻辑矛盾的系统性检测能力。用户需要智能识别物品状态矛盾、经济系统矛盾、角色状态矛盾等深层逻辑问题，并将检查结果结构化存储到记忆表格中，实现长期记忆与表格联动管理。

## What Changes
- 在 PlotCheckerService 中增强逻辑矛盾检测能力
- 新增逻辑检查类型定义（LogicContradictionType、LogicCheckIssue）
- 创建 LogicCheckRecorder 服务，将检查结果写入记忆表格
- 更新 PlotCheckReportModal 展示逻辑异常详情
- 在 ContentWorkspace 中提供查看逻辑检查表格的入口

## Impact
- Affected specs: add-plot-check（扩展）
- Affected code:
  - `src/shared/types/writing.types.ts`（修改 - 新增逻辑检查类型）
  - `src/main/services/writing/PlotCheckerService.ts`（修改 - 增强逻辑检测）
  - `src/main/services/writing/LogicCheckRecorder.ts`（新增 - 记录到记忆表格）
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`（修改 - 展示逻辑异常）
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`（修改 - 表格查看入口）
  - `src/main/ipc/handlers/writingHandlers.ts`（修改 - 新增记录 handler）
  - `src/main/preload.ts`（修改 - 暴露新 API）

## ADDED Requirements

### Requirement: 逻辑异常检测系统
系统SHALL在剧情检查中增加智能逻辑矛盾检测，识别以下类型的逻辑异常：
- 物品状态矛盾：已消耗物品无解释地再次出现
- 经济系统矛盾：已花费金钱/资源无来源地重新出现
- 角色状态矛盾：已死亡/重伤角色无解释地复活/恢复
- 物理规律矛盾：明显违背基本物理定律
- 剧情设定矛盾：与已建立世界观/规则冲突
- 数学逻辑矛盾：数量关系矛盾

#### Scenario: 检测逻辑异常
- **WHEN** 用户触发剧情检查
- **THEN** 系统在原有五维度检查基础上，执行逻辑异常检测

### Requirement: 检查结果记录机制
系统SHALL将检测到的逻辑异常结构化存储至记忆表格，每条记录包含：
- 异常类型
- 具体情节描述
- 矛盾点分析
- 出现位置/章节信息
- 严重程度评估

#### Scenario: 自动记录逻辑异常
- **WHEN** 剧情检查检测到逻辑异常
- **THEN** 系统自动将异常信息写入记忆表格的 Logic Contradictions 表

### Requirement: 表格模板管理
系统SHALL提供表格模板绑定功能，确保检查结果以统一格式存储，并支持 tableEdit 命令实时更新、编辑和维护表格内容。

#### Scenario: 管理记忆表格
- **WHEN** 用户查看逻辑异常记录
- **THEN** 系统展示格式化的记忆表格，支持编辑和维护

### Requirement: 集成到现有剧情检查按钮
逻辑验证功能SHALL无缝集成至现有"剧情检查"按钮，用户点击后同时执行原五维度检查和逻辑异常检测。

## MODIFIED Requirements

### Requirement: 剧情检查报告
检查报告SHALL增加逻辑异常检查维度，在原五个维度评分之外，单独展示逻辑异常检查结果，包括：
- 检测到的逻辑矛盾列表
- 每个矛盾的严重程度（高/中/低）
- 矛盾点的详细分析
- 查看记忆表格的入口
