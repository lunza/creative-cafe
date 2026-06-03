# 优化快速修复匹配逻辑 Spec

## Why
用户在剧情检查中发现快速修复按钮未显示，仅显示自动修正按钮。虽然 AI 返回了正确的 quickFixSuggestion 数据（包含 originalText、fixedText 和 reason），但系统验证逻辑过于严格，当 AI 返回的 originalText 与章节内容存在微小差异（如空格、换行符、标点符号等）时，validateQuickFixSuggestion 方法返回 undefined，导致快速修复按钮无法渲染。

此外，JSON 解析也存在稳定性问题，AI 返回的非标准 JSON 格式（如字面换行符、中文引号、trailing commas、单引号等）会导致 JSON.parse 失败，系统回退到 0 分的 fallback report。

## What Changes
- **MODIFIED**: `validateQuickFixSuggestion` 方法 - 从单一精确匹配改为多层级匹配策略（精确匹配 → 修剪匹配 → 锚点匹配 → position提取）
- **ADDED**: `findTextByAnchors` 方法 - 用首句和末句作为锚点定位并提取完整区间文本
- **MODIFIED**: `fixJsonForParsing` 方法 - 增强 JSON 修复能力，支持注释移除、单引号替换、未加引号键名、trailing commas、转义序列验证等
- **ADDED**: 详细的诊断日志 - 记录 JSON 提取状态、各维度分数、匹配策略执行情况等
- **MODIFIED**: prompt 提示词 - 增加详细的步骤指导 AI 如何确保 originalText 精确匹配原文
- **MODIFIED**: `buildCheckPrompt` 方法 - 修复了 `request.content`（待检测的章节正文）从未注入到 prompt 中的严重 Bug，导致 AI 从大纲摘要中读取原文
- **MODIFIED**: `fixChineseQuotes` 方法 - 修复了全局替换中文引号导致 JSON 结构被破坏的 Bug，改为只替换字符串外部（JSON 结构分隔符位置）的中文引号，保留字符串值内部的中文引号

## Impact
- Affected specs: 剧情检查与快速修复功能 (fix-quick-fix-functionality)
- Affected code:
  - `src/main/services/writing/PlotCheckerService.ts`
  - `src/shared/types/writing.types.ts`

## ADDED Requirements
### Requirement: 多层级快速修正匹配策略
系统 SHALL 在验证 quickFixSuggestion 时按以下优先级尝试匹配策略：
1. **精确匹配**：originalText 与章节内容完全一致
2. **修剪匹配**：去除首尾空白后匹配
3. **锚点匹配**：用 originalText 的首句和末句作为锚点，在章节内容中定位并提取完整区间文本
4. **Position 提取**：如果 AI 提供了 position 区间，直接从章节内容中提取对应文本

#### Scenario: 锚点匹配成功
- **WHEN** AI 返回的 originalText 与章节内容不完全一致，但首句和末句能在章节内容中找到
- **THEN** 系统提取首句到末句之间的完整文本作为 originalText，并设置对应的 position
- **THEN** 快速修复按钮正常显示，用户点击后能正确替换文本

### Requirement: 增强的 JSON 解析能力
系统 SHALL 能够解析 AI 返回的各种非标准 JSON 格式，包括：
- 字符串值中的字面换行符（应转义为 \n）
- 中文引号（应替换为英文引号）
- 单引号（应替换为双引号）
- 未加引号的键名（如 { key: "value" }）
- Trailing commas
- JSON 注释（// 和 /* */ 风格）
- 无效的转义序列

#### Scenario: AI 返回含字面换行符的 JSON
- **WHEN** AI 返回的 JSON 中 originalText 包含字面换行符而非 \n 转义
- **THEN** fixJsonForParsing 方法自动将其转义为 \n
- **THEN** JSON.parse 成功解析，剧情检查结果正确显示

### Requirement: 详细的诊断日志
系统 SHALL 在剧情检查过程中记录详细的诊断信息，包括：
- JSON 提取状态（是否找到代码块）
- 提取后 JSON 长度及预览
- 解析后的维度数据键名和各维度分数
- 各匹配策略的执行结果
- JSON 解析失败时的详细错误信息

#### Scenario: 排查剧情检查问题
- **WHEN** 剧情检查显示异常结果
- **THEN** 开发者可通过日志查看 JSON 提取、解析、维度分析、匹配策略执行的完整过程
- **THEN** 快速定位问题根因

## MODIFIED Requirements
### Requirement: validateQuickFixSuggestion 匹配逻辑
**原要求**：当 originalText 无法精确匹配时返回 undefined，导致快速修复按钮不显示

**修改后**：
- 保留精确匹配作为最优先策略
- 增加修剪匹配、锚点匹配、position提取作为 fallback 策略
- 所有匹配策略失败时才返回 undefined
- 每次匹配成功时记录详细日志，包括匹配策略、位置、提取文本长度等

### Requirement: fixJsonForParsing JSON 修复能力
**原要求**：仅处理字符串值中的字面换行符、制表符等控制字符

**修改后**：
- 步骤1: 移除 JSON 注释（// 和 /* */ 风格）
- 步骤2: 将单引号替换为双引号
- 步骤3: 处理未加引号的键名
- 步骤4: 移除 trailing commas
- 步骤5: 逐字符遍历，转义字符串内部的控制字符
- 增强转义序列验证，区分有效和无效的 JSON 转义序列

### Requirement: prompt 提示词约束
**原要求**：简单说明 originalText 必须是章节内容中一字不差的原文

**修改后**：
- 增加详细的步骤指导 AI 如何确保 originalText 精确匹配原文
- 强调必须完整复制原文，包含所有标点符号、换行符、特殊符号、空格
- 提供验证匹配的方法
- 说明如果无法完全复制时的替代方案（复制关键句子确保首末句能精确定位）
- **明确指示 AI 从「本章内容」部分复制 originalText，而非从大纲摘要或关键情节中复制**

## REMOVED Requirements
无
