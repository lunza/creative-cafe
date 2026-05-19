# 世界书与角色卡AI生成增强功能 Spec

## Why
当前世界书创建和角色卡创建功能仅支持用户手动输入所有内容，易用度低、创建效率差。虽然已有部分AI辅助功能（如AI生成世界书条目），但生成过程完全依赖用户输入主题描述，无法利用系统中已有的角色卡、世界书等资源作为生成依据。通过引入"基于系统现有素材的AI生成"能力，可大幅提升创建效率和内容质量。

## What Changes
- **世界书新建流程增强**: 新建 `WorldBookGenerateModal.tsx` 模态框，允许用户选择多个角色卡作为参考，AI结合角色卡信息自动生成世界书
- **角色卡新建流程增强**: 新建 `CharacterCardGenerateModal.tsx` 模态框，允许用户选择多个世界书作为参考，结合自定义参数生成角色卡
- **参数配置面板**: 角色卡生成提供灵活的参数配置界面（角色定位、性格特征、能力设定等维度）
- **生成预览与调整**: 两个功能均提供生成预览，允许用户在正式保存前查看和调整生成内容
- **IPC API扩展**: 新增两个IPC handler用于AI生成

## Impact
- 受影响的 specs: 无（新功能增强）
- 受影响的代码:
  - 新建: `WorldBookGenerateModal.tsx`, `CharacterCardGenerateModal.tsx`
  - 修改: `WorldBookManager.tsx`, `CharacterManager.tsx`
  - 修改: IPC handlers 和 preload API

## ADDED Requirements

### Requirement: 世界书AI生成（基于角色卡参考）
系统 SHALL 允许用户在新建世界书时选择多个角色卡作为参考素材，AI自动分析角色卡的描述、性格、场景等信息，生成关联的世界书条目。

#### Scenario: 用户选择角色卡后生成世界书
- **WHEN** 用户在世界书管理器中点击"AI生成"，选择系统中一个或多个角色卡
- **THEN** AI分析所选角色卡的背景、关系、设定等信息，自动生成世界书（含名称建议、简介、条目列表）
- **AND** 生成的内容在预览区域展示，用户可编辑调整后再保存

### Requirement: 角色卡AI生成（基于世界书参考）
系统 SHALL 允许用户在新建角色卡时选择多个世界书作为背景参考，结合用户指定的角色参数生成角色卡。

#### Scenario: 用户选择世界书后生成角色卡
- **WHEN** 用户在角色卡管理器中点击"AI生成"，选择一个或多个世界书作为背景参考
- **AND** 用户填写角色定位、性格特征、能力设定等参数（均可选）
- **THEN** AI结合世界书背景信息和用户参数生成完整角色卡字段
- **AND** 生成的角色卡在预览区域展示，用户可编辑调整后再保存

### Requirement: 生成数据格式一致性
系统 SHALL 确保AI生成的世界书条目和角色卡符合系统现有数据格式标准。

#### Scenario: 世界书格式校验
- **WHEN** AI生成世界书时
- **THEN** 生成的条目包含所有必需字段（uid, comment, key, keysecondary, content, constant, order, position）

#### Scenario: 角色卡格式校验
- **WHEN** AI生成角色卡时
- **THEN** 生成的角色卡包含标准字段（name, description, personality, scenario, first_mes, mes_example等）

## MODIFIED Requirements

### Requirement: 世界书新建流程
**修改前**: 仅支持手动创建和基于主题描述生成条目
**修改后**: 在现有 `WorldBookCreateModal` 基础上，新增独立的 `WorldBookGenerateModal` 入口，提供基于角色卡参考的全自动世界书生成

### Requirement: 角色卡新建流程
**修改前**: 仅支持手动创建和PNG文件导入
**修改后**: 在现有 `CharacterManager` 中新增"AI生成"按钮入口，打开 `CharacterCardGenerateModal` 提供基于世界书参考+自定义参数的角色卡生成
