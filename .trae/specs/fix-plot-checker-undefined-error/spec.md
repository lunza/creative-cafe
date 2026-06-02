# Fix PlotCheckerService Undefined Match Error

## Why
剧情检查功能中存在 "Cannot read properties of undefined (reading 'match')" 运行时错误，发生在 PlotCheckerService.extractKeywords 方法中。该错误由未定义值调用 match() 方法导致，需要添加空值检查、改进错误处理，并确保 AI 提示词输出与后处理逻辑一致。

## What Changes
- 在 extractKeywords 方法中添加 description 参数的空值检查
- 增强 parseCheckResponse 方法中对 AI 返回数据的容错处理
- 修复 validateQuickFixSuggestion 方法中对未定义属性的处理
- 添加 JSON 解析失败的错误处理
- 确保所有字符串方法调用前都验证输入值

## Impact
- Affected specs: plot-checker
- Affected code: src/main/services/writing/PlotCheckerService.ts

## MODIFIED Requirements
### Requirement: Plot Chapter Check Error Handling
The system SHALL handle undefined values gracefully and not throw runtime errors when processing AI responses.

#### Scenario: Undefined description in extractKeywords
- **WHEN** extractKeywords receives an undefined description parameter
- **THEN** it shall return an empty array without throwing

#### Scenario: Invalid JSON from AI
- **WHEN** AI returns malformed JSON
- **THEN** parseCheckResponse shall catch the error and return a fallback report with appropriate error message

#### Scenario: Missing quickFixSuggestion fields
- **WHEN** quickFixSuggestion has undefined originalText or fixedText
- **THEN** validateQuickFixSuggestion shall return undefined gracefully
