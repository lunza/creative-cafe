# Add Chapter Save Button Spec

## Why
在章节属性编辑界面中缺少明确标识的保存按钮，用户完成章节信息编辑后无法直观地知道如何保存修改内容。当前虽然有全局的保存按钮，但在章节属性编辑面板中没有专门的"保存当前章节信息"按钮，用户体验不够友好。

## What Changes
- 在ManualOutlineEditor的章节属性编辑面板底部或右上角添加"保存当前章节信息"按钮
- 实现数据验证和保存逻辑
- 添加保存成功/失败的明确反馈
- 确保只保存当前正在编辑的章节数据

## Impact
- Affected specs: 大纲编辑功能
- Affected code: src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx

## ADDED Requirements
### Requirement: 章节属性编辑面板保存按钮
系统SHALL在章节属性编辑面板中提供明确标识的"保存当前章节信息"按钮，该按钮应在用户完成章节信息编辑后能够将修改内容保存到系统中。

#### Scenario: 成功保存章节信息
- **WHEN** 用户编辑完章节属性并点击"保存当前章节信息"按钮
- **THEN** 系统验证数据有效性，将修改保存到当前编辑的章节，并显示保存成功的提示消息

#### Scenario: 数据验证失败
- **WHEN** 用户填写的章节信息不符合验证规则并点击保存按钮
- **THEN** 系统显示具体的错误提示，不执行保存操作

## MODIFIED Requirements
### Requirement: 章节编辑界面交互
现有的章节编辑界面需要增加更明确的保存操作入口，使用户能够直观地完成编辑和保存流程。

## REMOVED Requirements
### Requirement: None
没有需求被移除。