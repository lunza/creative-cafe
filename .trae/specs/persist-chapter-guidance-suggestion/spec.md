# 持久化章节生成建议 Spec

## Why

当前章节生成建议面板（`add-generation-suggestion-panel`）功能已实现，但用户输入的建议仅在单次生成时生效，无法跨会话保存。用户在为某章节编写了详细的创作指导后，下次生成或重新生成时需要重新输入，降低了工作效率。通过将建议持久化存储到章节大纲中，用户可以在每次生成前查看、编辑历史建议，AI 生成逻辑也会自动引用这些持久化的建议。

## What Changes

- 在 `ChapterOutline` 类型中新增 `generationGuidance` 字段用于存储用户指导建议
- 在 `ContentWorkspace` 中实现建议面板加载和显示已保存建议的逻辑
- 在章节保存流程中自动持久化 `generationGuidance` 字段
- 修改 AI 内容生成逻辑，将 `generationGuidance` 作为默认参考指令拼接到提示词中
- 在建议面板中提供查看、编辑、清空已保存建议的能力

## Impact

- Affected specs: `add-generation-suggestion-panel`（功能增强）
- Affected code:
  - `writing.types.ts` - `ChapterOutline` 接口新增字段
  - `ContentWorkspace.tsx` - 建议面板加载已保存建议、保存逻辑
  - `GenerationSuggestionModal.tsx` - 新增编辑和清空已保存建议的能力
  - `RegenerationSuggestionModal.tsx` - 可选：新增显示持久化建议的能力
  - `ContentGenerator.ts` (main) - 提示词构建引用持久化建议
  - `WritingStorageService.ts` - 确保章节保存包含新字段

## ADDED Requirements

### Requirement: 章节生成建议持久化存储
系统 SHALL 在 `ChapterOutline` 结构中提供专用字段存储用户生成建议文本。

#### Scenario: 数据结构定义
- **WHEN** 查看 `ChapterOutline` 类型定义
- **THEN** 包含可选字段 `generationGuidance?: string`，用于存储用户对当前章节的生成指导建议

#### Scenario: 建议自动保存
- **WHEN** 用户在生成建议面板中提交建议（生成模式或重新生成模式）
- **THEN** 系统将建议文本保存到当前章节的 `generationGuidance` 字段中
- **THEN** 触发项目保存流程，确保建议写入 `project.json`

#### Scenario: 建议跨会话持久化
- **WHEN** 用户关闭应用并重新打开项目
- **THEN** 之前保存的章节生成建议从 `project.json` 中正确加载
- **THEN** 用户可在建议面板中查看之前保存的建议

### Requirement: 建议面板显示已保存建议
系统 SHALL 在用户打开生成建议面板时显示已保存的 `generationGuidance`。

#### Scenario: 打开生成建议面板
- **WHEN** 用户点击"生成"按钮
- **THEN** 系统检查当前章节是否存在 `generationGuidance`
- **THEN** 若存在，建议面板的文本框预填充已保存的建议内容
- **THEN** 若不存在，文本框保持空白

#### Scenario: 打开重新生成建议面板
- **WHEN** 用户点击"重新生成"按钮
- **THEN** 系统在面板中显示当前章节的已保存建议（如存在）
- **THEN** 用户可查看已保存建议作为参考，同时填写结构化建议

### Requirement: 用户编辑和清空已保存建议
系统 SHALL 允许用户在生成前查看、编辑或清空已保存的建议。

#### Scenario: 用户编辑已保存建议
- **WHEN** 用户在建议面板中修改了预填充的已保存建议
- **THEN** 提交后，更新后的建议覆盖原有的 `generationGuidance`
- **THEN** 触发项目保存

#### Scenario: 用户清空已保存建议
- **WHEN** 用户在建议面板中删除了所有建议文本并提交
- **THEN** 系统将 `generationGuidance` 字段设为空字符串或 `undefined`
- **THEN** 触发项目保存

#### Scenario: 用户取消编辑
- **WHEN** 用户打开建议面板后点击取消
- **THEN** 已保存的建议不变，不触发保存

### Requirement: AI 生成逻辑引用持久化建议
系统 SHALL 在 AI 内容生成时将 `generationGuidance` 作为参考指令拼接到提示词中。

#### Scenario: 生成时带有持久化建议
- **WHEN** 用户触发生成且当前章节存在 `generationGuidance`
- **THEN** 系统将 `generationGuidance` 作为默认附加指令拼接到提示词中
- **THEN** 格式为：`## 章节创作指导\n{generationGuidance}`

#### Scenario: 用户提交新建议时
- **WHEN** 用户在建议面板中提交了新的建议（覆盖了预填充的内容）
- **THEN** 新建议同时用于：1) 更新 `generationGuidance` 字段 2) 作为本次生成的附加指令

#### Scenario: 持久化建议和即时建议共存
- **WHEN** 章节存在 `generationGuidance` 且用户又提交了即时建议
- **THEN** 系统将两者合并到提示词中，即时建议优先显示

#### Scenario: 无持久化建议
- **WHEN** 章节无 `generationGuidance` 且用户未提交即时建议
- **THEN** 系统使用原有基础提示词，行为与未修改前一致

### Requirement: 数据验证和错误处理
系统 SHALL 验证建议内容并提供用户操作反馈。

#### Scenario: 空建议输入
- **WHEN** 用户提交空的建议文本
- **THEN** 系统将 `generationGuidance` 设为空或清除，不报错
- **THEN** 显示提示"已清空章节创作指导"

#### Scenario: 保存失败
- **WHEN** 章节建议保存到磁盘失败
- **THEN** 系统在控制台记录错误日志
- **THEN** 向用户显示提示"建议保存失败，但已用于本次生成"

## MODIFIED Requirements

### Requirement: 生成建议面板组件
`GenerationSuggestionModal` SHALL 支持接收和显示已保存的建议内容。

#### Modified GenerationSuggestionModal Props
- 新增可选 prop `savedGuidance?: string` - 已保存的章节指导建议
- 新增可选 prop `onClearGuidance?: () => void` - 清空已保存建议的回调
- 当 `savedGuidance` 存在时，TextArea 预填充该内容
- 提供"清空指导"按钮，调用 `onClearGuidance`

### Requirement: 重新生成建议面板组件
`RegenerationSuggestionModal` SHALL 支持显示已保存的章节指导建议作为参考。

#### Modified RegenerationSuggestionModal Props
- 新增可选 prop `savedGuidance?: string` - 已保存的章节指导建议
- 在面板中增加一个可折叠区域展示已保存建议（如存在）

### Requirement: 提示词构建逻辑
`ContentGenerator.buildPrompt` SHALL 在构建提示词时引用 `generationGuidance`。

#### Modified Prompt Building
在 `buildPrompt` 方法中：
1. 首先检查 `request.generationGuidance`（持久化建议）
2. 若存在，将其作为"章节创作指导"拼接到提示词
3. 然后检查 `request.userSuggestion`（即时建议）
4. 若两者都存在，即时建议追加在持久化建议之后

## REMOVED Requirements

无。本功能是对现有建议面板的增强，不移除任何现有功能。
