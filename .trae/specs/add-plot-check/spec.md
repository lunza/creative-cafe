# 剧情检查功能 Spec

## Why
AI在内容生成过程中容易出现设定不一致、情节矛盾（"吃书"）、设定遗漏（"吞设定"）等问题，影响作品质量。需要建立一个系统化的剧情检查机制，对章节内容进行多维度合规性检验，主动识别并预防这些问题。

## What Changes
- 在章节操作栏（ContentWorkspace）中添加"剧情检查"按钮
- 新增剧情检查服务（PlotCheckerService），支持多维度检查
- 新增剧情检查报告展示组件（PlotCheckReportModal）
- 新增IPC handler处理剧情检查请求
- 在writing types中添加剧情检查相关类型定义

## Impact
- Affected specs: creative-writing-mode
- Affected code: 
  - `src/main/services/writing/PlotCheckerService.ts` (新增)
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx` (新增)
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx` (修改)
  - `src/main/ipc/handlers/writingHandlers.ts` (修改)
  - `src/shared/types/writing.types.ts` (修改)
  - `src/main/ipc/writing.ipc.ts` (修改)

## ADDED Requirements

### Requirement: 剧情检查按钮
系统SHALL在章节内容编辑器的操作栏中提供一个"剧情检查"按钮，用户可以点击触发剧情检查功能。

#### Scenario: 触发剧情检查
- **WHEN** 用户点击"剧情检查"按钮
- **THEN** 系统显示加载状态，对当前章节内容进行检查

### Requirement: 多维度剧情检查
系统SHALL对章节内容进行以下五个维度的合规性检查：

1. **大纲一致性检查**: 验证章节内容是否符合项目大纲中的章节摘要和关键情节
2. **世界书遵循检查**: 验证章节内容是否遵循世界书中的设定（地名、组织、规则等）
3. **角色卡符合度检查**: 验证章节中出现的角色行为是否符合角色卡设定
4. **写作风格统一性检查**: 验证章节的写作风格是否与项目配置的风格一致
5. **剧情连贯性检查**: 验证当前章节与前文的剧情是否连贯

#### Scenario: 多维度检查执行
- **WHEN** 剧情检查被触发
- **THEN** 系统并行执行五个维度的检查，并汇总结果

### Requirement: 剧情检查报告
系统SHALL生成一份包含各维度评分的综合评估报告，包括：
- 每个维度的评分（0-100分）
- 每个维度发现的问题列表
- 每个问题的严重程度（高/中/低）
- 具体的改进建议

#### Scenario: 查看检查报告
- **WHEN** 剧情检查完成
- **THEN** 系统以弹窗形式展示检查报告，包含各维度评分和问题详情

### Requirement: 问题定位
系统SHALL在检查报告中提供问题定位功能，用户可以点击问题跳转到对应内容位置。

#### Scenario: 定位问题
- **WHEN** 用户点击报告中的问题描述
- **THEN** 编辑器跳转到该问题对应的文本位置并高亮

## MODIFIED Requirements

### Requirement: 操作按钮区域
在ContentWorkspace组件的操作按钮区域中，将"剧情检查"按钮添加到管理按钮行（第二行），位于"调整参数"按钮之前。
