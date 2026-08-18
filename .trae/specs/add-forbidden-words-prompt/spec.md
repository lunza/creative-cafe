# 禁词表提示词注入功能规范（修正版）

## Why

原方案（add-banned-words-filter）错误地将禁词表实现为**后处理内容过滤**（在 AI 回复生成后替换/删除禁词）。用户实际需求是**提示词注入**：在系统提示词中加入「Forbidden Word List (Strict Constraints)」指令块，让 AI 在生成回复时**主动避开**这些词汇，而非事后过滤。

两种方案的本质区别：
- **后处理过滤**：AI 先输出禁词，再被程序替换（治标不治本，会破坏语义连贯性）
- **提示词注入**：AI 从一开始就避免使用禁词，并以符合规范的方式表达（治本，语义更自然）

本规范修正原方案的实现方式。

## What Changes

### 架构变更

**方案变更：PostProcessPlugin → PromptProvider**

| 维度 | 原方案（错误） | 新方案（正确） |
|------|--------------|--------------|
| 实现机制 | PostProcessingPipeline 插件（渲染后过滤） | PromptComposer Provider（提示词注入） |
| 核心文件 | `BlockedWordsPlugin.ts` | `ForbiddenWordsPromptProvider.ts` |
| 注入位置 | 后处理阶段（AI 回复后） | prompt 的 **suffix** 区域 |
| 效果 | 事后替换禁词 | AI 生成时主动避开禁词 |

### 数据模型变更

原 `BlockedWordsConfig`（扁平 words 数组 + 匹配模式）废弃，改为**按类别分组**的结构：

```typescript
interface ForbiddenWordCategory {
  name: string;           // 类别名称，如 "Religious Terminology"
  description: string;    // 类别描述，如 "Do not use words related to religion"
  words: string[];        // 禁词列表
  note?: string;          // 可选备注：替代表达建议（如 Show, Don't Tell）
}

interface ForbiddenWordsConfig {
  enabled: boolean;       // 全局开关
  categories: ForbiddenWordCategory[];  // 类别列表
}
```

### 提示词输出格式（英文，suffix 区域）

```
Forbidden Word List (Strict Constraints):

No Religious Terminology: Do not use words related to religion, rituals, or divinity. Specifically, avoid terms such as "sacrifice", "offering", "sacred", "holy", and any similar descriptors.

No Extreme Emotion Labels: Do not use direct adjectives or nouns to label extreme psychological states. Specifically, avoid words such as "crazy", "fear", "despair", and any similar terms.
Note: Instead of labeling these emotions, describe the physical manifestations and behavioral reactions to convey the intensity (Show, Don't Tell).
```

### 变化清单

- **废弃（删除/回滚）**：
  - `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/BlockedWordsPlugin.ts`（删除）
  - `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/__tests__/BlockedWordsPlugin.test.ts`（删除）
  - `src/renderer/utils/blockedWordsMatcher.ts`（删除）
  - `src/renderer/utils/__tests__/blockedWordsMatcher.test.ts`（删除）
  - `plugins/index.ts` 回滚（移除 BlockedWordsPlugin 注册）
  - `src/shared/types/blockedWords.ts` 重写为 `forbiddenWords.ts` 新数据模型
  - `src/renderer/components/Settings/BlockedWordsSettings.tsx` 重写为类别管理界面

- **新增**：
  - `src/shared/types/forbiddenWords.ts` — 新数据模型类型
  - `src/renderer/components/Character/CharacterDialogueChat/pipeline/providers/ForbiddenWordsPromptProvider.ts` — 提示词注入 Provider
  - `src/renderer/components/Character/CharacterDialogueChat/pipeline/providers/__tests__/ForbiddenWordsPromptProvider.test.ts` — Provider 单元测试

- **修改**：
  - `src/shared/types/index.ts` — 导出类型改为 forbiddenWords
  - `src/shared/settings.ts` — 默认配置改为新结构
  - `src/renderer/types/setting.ts` — AppSetting 接口字段改为新类型
  - `src/renderer/components/Settings/Settings.tsx` — 组名改为「内容约束」，保留面板引用
  - `src/renderer/components/Character/CharacterDialogueChat/pipeline/providers/index.ts` — 注册 ForbiddenWordsPromptProvider
  - `src/renderer/components/Settings/BlockedWordsSettings.tsx` → 内容更新（保留文件名，更新实现）

## Impact

### 受影响的功能规格
- **add-banned-words-filter**：原规范的全部实现被废弃，由本规范替代
- 对话管线（DialoguePipeline）— PromptComposer 新增 Provider
- 设置系统（Settings）— 设置面板数据模型变更

### 受影响的代码
- `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/` — 删除 BlockedWordsPlugin
- `src/renderer/components/Character/CharacterDialogueChat/pipeline/providers/` — 新增 Provider
- `src/shared/` — 类型与默认配置同步更新
- `src/renderer/components/Settings/` — 设置面板重写

### 不受影响的范围
- DialoguePipeline 编排逻辑
- AIService（AI 请求/响应流）
- LogicEngine 任务调度
- 其他已有插件和 Provider

## ADDED Requirements

### Requirement: 禁词类别数据结构

The system SHALL provide a config data structure for forbidden words organized by category.

#### Scenario: 数据结构定义
- **GIVEN** 系统启动
- **WHEN** 加载设置
- **THEN** 禁词配置包含以下字段：
  - `enabled: boolean` — 全局开关
  - `categories: ForbiddenWordCategory[]` — 类别列表，每个类别包含：
    - `name: string` — 类别名称（如 "Religious Terminology"）
    - `description: string` — 类别描述（禁止内容说明）
    - `words: string[]` — 禁词列表
    - `note?: string` — 可选备注（替代表达建议）

#### Scenario: 默认值
- **GIVEN** 首次安装
- **WHEN** 加载默认设置
- **THEN** 禁词功能默认状态为 `enabled: false`（默认关闭）
- **AND** 默认 `categories: []` 空列表

### Requirement: 类别管理界面

The system SHALL provide a management UI for creating, editing, and deleting forbidden word categories.

#### Scenario: 添加类别
- **GIVEN** 用户在设置面板的禁词管理界面
- **WHEN** 用户点击「添加类别」
- **THEN** 表单出现，用户可填写类别名称、描述、禁词列表和备注
- **AND** 类别名称和描述为必填项，禁词列表至少 1 个

#### Scenario: 编辑类别
- **GIVEN** 已有类别列表
- **WHEN** 用户点击某个类别的编辑按钮
- **THEN** 弹出编辑表单，可修改所有字段

#### Scenario: 删除类别
- **GIVEN** 已有类别列表
- **WHEN** 用户点击某个类别的删除按钮
- **THEN** 弹出确认对话框，确认后删除该类别

### Requirement: 提示词注入

The system SHALL inject the forbidden word list as an instruction block into the system prompt.

#### Scenario: Provider 注册
- **GIVEN** DialoguePipeline 初始化
- **WHEN** `registerAllProviders` 被调用
- **THEN** ForbiddenWordsPromptProvider 以以下配置注册：
  - `name: 'ForbiddenWordsPromptProvider'`
  - `section: 'suffix'`（suffix 区域）
  - `priority: 460`（在 FormatInstructionProvider 450 之后）

#### Scenario: 提示词生成
- **GIVEN** 禁词功能启用且至少存在一个类别
- **WHEN** PromptComposer 组装系统提示词
- **THEN** 生成以下格式的指令块（英文）：

  ```
  Forbidden Word List (Strict Constraints):

  No {CategoryName}: {CategoryDescription} Specifically, avoid terms such as "word1", "word2", "word3", and any similar descriptors.

  No {CategoryName}: {CategoryDescription} Specifically, avoid terms such as "word4", and any similar descriptors.
  Note: {categoryNote}
  ```

#### Scenario: 禁词功能禁用
- **GIVEN** 禁词功能为禁用状态或所有类别为空
- **WHEN** `isActive()` 被调用
- **THEN** 返回 false，不注入指令块

#### Scenario: 中文禁词处理
- **GIVEN** 类别中包含中文禁词
- **WHEN** 生成提示词
- **THEN** 中文禁词以 `"中文词"` 格式原样出现在引导示例中

### Requirement: 适用模式

The system SHALL only inject the forbidden word list in appropriate pipeline modes.

#### Scenario: 对话模式
- **GIVEN** pipelineMode 为 `dialogue`
- **WHEN** Provider 的 `isActive()` 被调用
- **THEN** 返回禁词功能的实际启用状态

#### Scenario: 全部模式
- **GIVEN** 任意 pipelineMode
- **WHEN** Provider 的 `isActive()` 被调用
- **THEN** 只要禁词功能启用即返回 true（对所有 AI 生成场景生效）

### Requirement: 废弃实现清理

The system SHALL remove the obsolete post-processing filter implementation.

#### Scenario: 删除后处理插件
- **GIVEN** 原 add-banned-words-filter 已实现 BlockedWordsPlugin
- **WHEN** 执行本变更
- **THEN** BlockedWordsPlugin 及其测试被删除
- **AND** `plugins/index.ts` 中不再注册该插件

#### Scenario: 删除匹配工具
- **GIVEN** 原实现包含 blockedWordsMatcher
- **WHEN** 执行本变更
- **THEN** blockedWordsMatcher 及其测试被删除

## MODIFIED Requirements

### Requirement: 设置面板（重写）

原 BlockedWordsSettings 面板（匹配模式/大小写/替换文本）废弃，重写为**类别管理**界面：

- 全局开关（Switch 组件）
- 类别列表（可展开的卡片列表，显示名称、描述、禁词预览、备注）
- 添加类别（打开 Modal 表单：名称、描述、禁词多行输入、备注）
- 编辑类别（打开相同表单，预填数据）
- 删除类别（Popconfirm 确认）
- 导入/导出（JSON 格式，支持 categories 结构）
- 通过 ref 暴露 `getFormValues()` 方法

### Requirement: 配置持久化

`ForbiddenWordsConfig` 作为 AppSetting 嵌套字段（`forbiddenWords`）随 `setting.save`/`setting.load` 自动持久化到 settings.json，与 tagAutocomplete 等模式一致。

## REMOVED Requirements

### Requirement: 后处理禁词过滤（原 add-banned-words-filter 实现）

**Reason**：方案方向错误。后处理过滤会导致已输出的禁词被替换为 `****`，破坏语义连贯性和可读性；用户需求是让 AI 在生成时主动避开禁词。

**Migration**：原实现中的类型定义（BlockedWordsConfig）、插件（BlockedWordsPlugin）、工具（blockedWordsMatcher）及其测试全部删除。设置面板重写为类别管理。设置存储字段从 `blockedWords` 迁移为 `forbiddenWords`。

## 关键设计决策

### 为什么是 suffix 区域而非 instruction

- 用户明确指定放在格式指令之后（suffix），作为**最后追加的约束**
- suffix 区域内容为格式/语言类约束，与禁词约束的「输出约束」性质一致
- priority=460 紧跟 FormatInstructionProvider（450），确保禁词指令位于格式指令之后

### 为什么用英文生成指令

- 用户明确指定使用英文。多数 LLM 对英文指令的理解更准确
- 禁词本身保持原样（中文禁词以中文展示在引导示例中）

### 为什么删除正则匹配逻辑

- 提示词注入方案不需要正则匹配（AI 自行理解语义）
- 删除匹配模式（full/wildcard/regex）、大小写敏感、替换文本等复杂配置，简化数据模型
- 原有的性能优化（正则缓存、合并）不再需要