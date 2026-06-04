# 修复章节内容生成问题的 Spec

## Why
章节内容生成功能存在三个关键问题：重复生成、长度异常和暂停/停止功能异常。同时，连续生成和暂停功能在生产中几乎未被使用，需要移除以简化界面和逻辑。

## What Changes
- 修复章节内容重复生成的竞态条件
- 修复max_tokens配置读取偶发失败导致的内容截断问题
- 移除连续生成和暂停功能，强化生成/重新生成/停止三个核心按钮
- 区分停止功能的正确行为

## Impact
- Affected specs: 章节生成、内容流式输出、生成控制
- Affected code: useChapterGeneration.ts, ContentWorkspace.tsx, writingHandlers.ts

## ADDED Requirements

### Requirement: 防重复生成机制
系统 SHALL 提供原子性的防重复检查，确保同一章节不会同时发起多个生成请求。

#### Scenario: 用户快速点击生成按钮
- **WHEN** 用户在短时间内多次点击"生成"或"重新生成"按钮
- **THEN** 系统只发起一次生成请求，后续点击被忽略

### Requirement: 稳定的max_tokens配置读取
系统 SHALL 正确读取用户的max_tokens配置，仅在配置缺失时使用默认值。

#### Scenario: 用户已配置max_tokens为51200
- **WHEN** 用户在设置中配置了max_tokens=51200
- **THEN** AI模型接收到的max_tokens参数为51200

#### Scenario: 配置读取失败时的降级
- **WHEN** 系统无法找到用户配置的引擎或max_tokens未设置
- **THEN** 系统使用32768作为默认值，并记录日志

### Requirement: 简化的生成控制按钮
系统 SHALL 提供生成、重新生成、停止三个核心按钮，移除连续生成和暂停功能。

#### Scenario: 正常生成流程
- **WHEN** 用户点击"生成"按钮
- **THEN** 系统开始流式生成，显示"停止"按钮

#### Scenario: 停止生成
- **WHEN** 用户在生成过程中点击"停止"按钮
- **THEN** 系统立即中止AI请求，保留已生成的内容

#### Scenario: 重新生成
- **WHEN** 用户点击"重新生成"按钮
- **THEN** 系统清空当前内容并重新开始生成

## REMOVED Requirements

### Requirement: 连续生成功能
**Reason**: 生产验证表明使用率几乎为0，正确的编写流程是逐章生成-检查-编辑-整理-引用历史-生成下一章
**Migration**: 移除按钮和相关逻辑

### Requirement: 暂停/继续生成功能
**Reason**: 暂停功能与停止功能效果混淆，且使用率几乎为0
**Migration**: 移除暂停/继续按钮，保留停止功能

### Requirement: 暂停与停止功能混淆
**Reason**: 暂停和停止应该有明确的区别，但实际两者效果相同
**Migration**: 直接移除暂停功能，保留停止功能
