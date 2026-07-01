# 世界书模块 AI 提示词纳入提示词管理系统 Spec

## Why

世界书模块包含 11 个 AI 交互功能（翻译、3 种润色、关键词生成、标签生成、AI 排序、条目生成、模板生成、关键词扩写、描述生成、新条目生成、基于角色卡生成），全部使用硬编码提示词，无法通过提示词管理系统进行统一管理、版本控制和在线编辑。同时，世界书模块存在 3 种不同的 AI 调用方式（`ai.request` IPC、`sendCharacterAIRequest` 封装、直接 `fetch`），其中 1 处直接 `fetch` 绕过了 ai-handler，导致日志缺失且存在 CORS 风险。

## What Changes

### 阶段一：统一 AI 调用方式
- 将 `generateTagsForEntry` 中的直接 `fetch` 改为 `window.electronAPI.ai.request` IPC 调用，确保所有 AI 请求经过 ai-handler 并记录完整日志
- 将 `handleGenerateFromCharacters` 中的 `sendCharacterAIRequest` 统一为 `window.electronAPI.ai.request` 调用方式（与其他 9 个函数一致）

### 阶段二：新增 13 个世界书提示词模板
- `world-book.translate` — 文本翻译
- `world-book.polish-keyword` — 关键词润色
- `world-book.polish-comment` — 注释润色
- `world-book.polish-content` — 内容润色
- `world-book.generate-keywords` — 关键词生成
- `world-book.generate-tags` — 标签生成
- `world-book.sort-entries` — AI 智能排序
- `world-book.generate-entries` — 世界书条目生成
- `world-book.generate-from-template` — 模板生成条目
- `world-book.expand-keywords` — 关键词扩写
- `world-book.generate-description` — 描述生成
- `world-book.generate-new-entries` — 新条目生成
- `world-book.generate-from-characters` — 基于角色卡生成

### 阶段三：业务调用方接入
- 修改 `useWorldBookAIOperations.ts` 中 11 个 AI 函数，将硬编码提示词替换为 `window.electronAPI.prompt.build(moduleId, variables)` 调用
- 在 `PromptManagement.tsx` 的 `MODULE_GROUPS` 中新增"世界书管理"分组

### 阶段四：校验与版本控制
- 递增 `SCHEMA_VERSION` 从 4 到 5
- 在 `validateTemplate` 的 `keywordMap` 中添加 13 个新模块的关键词映射
- 更新 `PromptModuleId` 联合类型

## Impact

- **Affected code**:
  - `src/shared/types/promptTemplate.types.ts` — 新增 13 个 PromptModuleId
  - `src/main/services/promptTemplateService.ts` — 新增 13 个默认模板定义、递增 SCHEMA_VERSION、扩展 keywordMap
  - `src/renderer/components/PromptManagement/PromptManagement.tsx` — 新增"世界书管理"模块分组
  - `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 11 个 AI 函数改造（统一调用方式 + 接入提示词模板）
- **Affected specs**: 无
- **BREAKING**: SCHEMA_VERSION 升级将重置所有用户自定义提示词模板（已有设计机制）

## ADDED Requirements

### Requirement: 统一世界书 AI 调用方式

世界书模块中所有 AI 交互功能 SHALL 统一使用 `window.electronAPI.ai.request` IPC 调用，确保请求经过 ai-handler 主进程模块，完整记录请求/响应日志到 `logs/ai-handler/` 目录。

#### Scenario: generateTagsForEntry 统一调用
- **WHEN** 用户触发标签生成功能
- **THEN** 请求通过 `window.electronAPI.ai.request` 发送，而非直接 `fetch`
- **AND** ai-handler.log 中记录完整的请求入参和响应出参

#### Scenario: handleGenerateFromCharacters 统一调用
- **WHEN** 用户基于角色卡生成世界书
- **THEN** 请求通过 `window.electronAPI.ai.request` 发送，而非 `sendCharacterAIRequest`
- **AND** 与其他 9 个 AI 函数使用相同的调用模式

### Requirement: 世界书提示词模板定义

系统 SHALL 在 `getDefaultTemplates()` 中为世界书模块定义 13 个提示词模板，遵循现有模板结构规范。

#### Scenario: 模板结构合规
- **WHEN** 系统加载默认模板
- **THEN** 每个世界书模板包含正确的 `id`、`moduleId`、`name`、`description`、`framework`、`parts`、`variables`、`metadata` 字段
- **AND** 含变量的 parts 设置为 `type: 'fixed'`，纯文本 parts 设置为 `type: 'editable'`
- **AND** parts 的 `role` 正确分配（系统提示词为 `system`，任务数据为 `user`）

#### Scenario: 模块 ID 命名规范
- **WHEN** 定义新模板的 moduleId
- **THEN** 使用 `world-book.<功能动作>` 格式（如 `world-book.translate`、`world-book.generate-keywords`）

### Requirement: 世界书提示词业务接入

世界书模块的 11 个 AI 函数 SHALL 通过 `window.electronAPI.prompt.build(moduleId, variables)` 获取提示词，而非使用硬编码字符串。

#### Scenario: 翻译功能接入
- **WHEN** 用户触发世界书条目翻译
- **THEN** 系统调用 `prompt.build('world-book.translate', {})` 获取系统提示词
- **AND** 使用返回的 `systemPrompt` 构建 AI 请求

#### Scenario: 润色功能接入（3 种类型）
- **WHEN** 用户触发关键词/注释/内容润色
- **THEN** 系统分别调用 `prompt.build('world-book.polish-keyword', ...)`、`prompt.build('world-book.polish-comment', ...)`、`prompt.build('world-book.polish-content', ...)` 获取对应提示词
- **AND** 将 `polish_requirements` 变量传递给模板

#### Scenario: 生成功能接入
- **WHEN** 用户触发关键词生成/标签生成/条目生成等功能
- **THEN** 系统调用对应的 `prompt.build` 方法，传入所需变量
- **AND** 使用返回的 `systemPrompt` 和 `userPrompt` 构建 AI 请求

### Requirement: 提示词管理界面集成

提示词管理界面 SHALL 新增"世界书管理"分组，展示 13 个世界书提示词模板。

#### Scenario: 管理界面展示
- **WHEN** 用户打开提示词管理界面
- **THEN** 左侧模块列表显示"世界书管理"分组
- **AND** 分组下列出 13 个世界书模板，每个模板显示名称和描述

### Requirement: 校验规则扩展

`validateTemplate` 的 `keywordMap` SHALL 包含 13 个新模块的关键词映射。

#### Scenario: 关键词校验
- **WHEN** 用户编辑世界书模板并保存
- **THEN** 校验器检查系统提示词是否包含对应的关键词（如 `world-book.translate` 检查"翻译"）
- **AND** 缺少关键词时返回 warning 级别提示

## MODIFIED Requirements

### Requirement: SCHEMA_VERSION 升级

`SCHEMA_VERSION` 从 4 升级至 5，触发已有用户的模板数据重置为新的默认模板（含 3 个角色卡模板 + 13 个世界书模板）。

### Requirement: PromptModuleId 类型扩展

`PromptModuleId` 联合类型新增 13 个世界书模块 ID，确保 TypeScript 类型安全。
