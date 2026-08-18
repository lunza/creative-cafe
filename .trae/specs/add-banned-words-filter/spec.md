# 禁词表过滤功能规范

## Why

当前 AI 对话系统在生成回复后，没有任何内容过滤机制。AI 模型可能输出包含限制级词汇（暴力、色情、仇恨言论等）的回复，特别在角色扮演场景中，用户可能无意或有意引导 AI 生成不当内容。需要一个全局禁词表功能，在 AI 回复展示给用户之前进行实时过滤，确保输出内容符合安全规范。

## What Changes

### 架构位置决策

经过对项目架构的全面分析，禁词表功能的最佳实现位置如下：

**渲染层 — PostProcessingPipeline 插件（推荐方案）**

- **位置**：`src/renderer/components/Character/CharacterDialogueChat/pipeline/PostProcessingPipeline` 的新插件
- **优先级**：priority=750（在 DedupPlugin 700 之后、LogicEngine 之前）
- **原因**：
  - 禁词过滤是 AI 回复的后处理行为，与现有插件的定位完全一致
  - 插件架构提供独立的 `detect`/`process` 生命周期，易于测试和开关
  - 不需要修改核心管线流程（AIService、DialoguePipeline 等）
  - 与现有 ContentProtectionPlugin（内容长度保护）属于同一类安全过滤功能

**配置存储 — AppSetting 嵌套字段**

- **位置**：`src/shared/settings.ts` 的 `AppSetting` 接口新增 `blockedWords` 字段
- **模式**：与 `tagAutocomplete`、`tagRag`、`webSearch` 等配置块相同的嵌套对象模式
- **持久化**：随 `setting.save` / `setting.load` IPC 整体持久化到 `settings.json`

**设置 UI — Settings 标签页新增面板**

- **位置**：`src/renderer/components/Settings/` 新增 `BlockedWordsSettings.tsx`
- **集成**：在 `Settings.tsx` 的 Tabs 中新增「内容过滤」标签页

### 对比方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **PostProcessingPlugin（推荐）** | 符合架构、低侵入、可测试、可独立开关 | 仅覆盖对话管线 | **采用** |
| AIService 层过滤 | 覆盖所有 AI 调用 | 侵入核心服务、流式处理复杂、违背架构设计 | 不采用 |
| 主进程后处理服务 | 集中式处理 | 需要额外 IPC、增加复杂度 | 不采用 |

### 变化清单

- **新增** `src/shared/types/blockedWords.ts` — 禁词表类型定义
- **新增** `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/BlockedWordsPlugin.ts` — 禁词过滤后处理插件
- **修改** `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/index.ts` — 注册 BlockedWordsPlugin
- **修改** `src/shared/settings.ts` — AppSetting 新增 `blockedWords` 默认配置
- **修改** `src/renderer/types/setting.ts` — AppSetting 接口新增 `BlockedWordsConfig`
- **新增** `src/renderer/components/Settings/BlockedWordsSettings.tsx` — 禁词管理设置面板
- **修改** `src/renderer/components/Settings/Settings.tsx` — 新增「内容过滤」标签页
- **新增** `src/renderer/utils/blockedWordsMatcher.ts` — 禁词匹配工具函数（纯函数，可独立测试）

## Impact

### 影响的功能规格
- 对话管线（DialoguePipeline）— 新增后处理插件
- 设置系统（Settings）— 新增配置面板和存储字段
- AI 回复展示 — 过滤后的内容自动替换禁词

### 影响的代码
- `src/shared/settings.ts` — 新增默认配置
- `src/renderer/types/setting.ts` — 新增类型接口
- `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/` — 新增插件
- `src/renderer/components/Settings/` — 新增设置面板
- `src/renderer/components/Settings/Settings.tsx` — 新增标签页

### 不受影响的范围
- 不修改 DialoguePipeline 核心编排逻辑
- 不修改 AIService（AI 请求/响应流）
- 不修改 LogicEngine 任务调度
- 不修改现有插件行为
- 不修改主进程设置处理逻辑

## Requirements

### Requirement: 禁词表配置数据结构

The system SHALL provide a configuration data structure for the banned words list.

#### Scenario: 配置结构定义
- **GIVEN** 系统启动
- **WHEN** 加载设置
- **THEN** 禁词表配置包含以下字段：
  - `enabled: boolean` — 全局开关
  - `mode: 'full' | 'wildcard' | 'regex'` — 匹配模式（全词匹配/通配符匹配/正则匹配）
  - `words: string[]` — 禁词列表（根据 mode 不同解释为不同模式）
  - `replacement: string` — 替换文本（默认 `****`）
  - `caseSensitive: boolean` — 是否区分大小写（默认 false）
  - `scope: 'all' | 'dialogue-only'` — 应用范围（默认 `all`）

#### Scenario: 默认值
- **GIVEN** 首次安装
- **WHEN** 加载默认设置
- **THEN** 禁词表默认状态为 `enabled: false`（默认关闭，需用户手动开启）
- **AND** 默认匹配模式为 `full`（全词匹配，最安全）
- **AND** 默认替换文本为 `****`

### Requirement: 禁词管理界面

The system SHALL provide a management UI for adding, editing, and deleting banned words.

#### Scenario: 添加禁词
- **GIVEN** 用户在设置面板的禁词管理界面
- **WHEN** 用户输入禁词文本并点击添加
- **THEN** 该禁词被添加到列表中并自动保存
- **AND** 空文本或纯空白文本不允许添加

#### Scenario: 删除禁词
- **GIVEN** 禁词列表中已有条目
- **WHEN** 用户点击某条目的删除按钮
- **THEN** 该禁词从列表中移除并自动保存

#### Scenario: 批量添加
- **GIVEN** 用户在禁词管理界面
- **WHEN** 用户粘贴多行文本（每行一个禁词）
- **THEN** 系统解析每行作为独立禁词添加
- **AND** 自动过滤空白行和重复项

#### Scenario: 导入导出
- **GIVEN** 用户在禁词管理界面
- **WHEN** 用户点击导出按钮
- **THEN** 禁词列表被导出为 JSON 文件
- **WHEN** 用户点击导入按钮并选择 JSON 文件
- **THEN** 禁词列表被导入（合并或替换，由用户选择）

#### Scenario: 匹配模式切换
- **GIVEN** 用户在禁词管理界面
- **WHEN** 用户切换匹配模式（full / wildcard / regex）
- **THEN** 界面显示对应模式的说明提示
- **AND** 界面提示用户注意正则表达式的安全性

### Requirement: 实时过滤机制

The system SHALL filter AI response content in real-time through the PostProcessingPipeline.

#### Scenario: 禁词过滤 — 全词匹配模式
- **GIVEN** 禁词表已启用，匹配模式为 `full`
- **WHEN** AI 回复内容包含禁词表中的词汇（作为独立单词出现）
- **THEN** 该禁词被替换为配置的替换文本
- **AND** 禁词作为其他单词的一部分时不触发替换（例如禁词 `ass` 不匹配 `assembly`）

#### Scenario: 禁词过滤 — 通配符模式
- **GIVEN** 禁词表已启用，匹配模式为 `wildcard`
- **WHEN** AI 回复内容匹配禁词表中的通配符模式（如 `bad*` 匹配 `badword`、`badass`）
- **THEN** 匹配的内容被替换为替换文本

#### Scenario: 禁词过滤 — 正则模式
- **GIVEN** 禁词表已启用，匹配模式为 `regex`
- **WHEN** AI 回复内容匹配禁词表中的正则表达式
- **THEN** 匹配的内容被替换为替换文本
- **AND** 无效的正则表达式被捕获并记录到 context.errors，不中断管线

#### Scenario: 禁词过滤 — 大小写不敏感
- **GIVEN** 禁词表已启用，`caseSensitive` 为 false
- **WHEN** AI 回复内容包含大小写混合的禁词（如 `HeLL` 匹配 `hell`）
- **THEN** 匹配的内容被替换为替换文本

#### Scenario: 禁词过滤 — 大小写敏感
- **GIVEN** 禁词表已启用，`caseSensitive` 为 true
- **WHEN** AI 回复内容包含大小写精确匹配的禁词
- **THEN** 仅大小写完全匹配时触发替换

#### Scenario: 禁词过滤 — 禁用状态
- **GIVEN** 禁词表为禁用状态
- **WHEN** AI 回复内容包含禁词表中的词汇
- **THEN** 不过滤，原样输出

### Requirement: 性能优化

The system SHALL implement performance optimizations for the banned words filter.

#### Scenario: 预编译正则
- **GIVEN** 禁词表已配置
- **WHEN** 插件初始化或禁词表变更时
- **THEN** 所有禁词预编译为 RegExp 对象并缓存
- **AND** 每次过滤执行时直接使用缓存的 RegExp，避免重复编译

#### Scenario: 快速短路
- **GIVEN** 禁词表为空或未启用
- **WHEN** 执行过滤
- **THEN** 立即返回原始内容，不进行任何匹配操作

#### Scenario: 空列表优化
- **GIVEN** 禁词列表为空
- **WHEN** 执行过滤
- **THEN** 跳过整个过滤流程，零开销

#### Scenario: 大量禁词优化
- **GIVEN** 禁词列表包含大量条目（>1000）
- **WHEN** 执行过滤
- **THEN** 单次过滤的额外延迟不超过 50ms（通过合并正则优化）

### Requirement: 集成方案

The system SHALL integrate with the existing dialogue pipeline.

#### Scenario: 插件注册
- **GIVEN** DialoguePipeline 初始化
- **WHEN** `registerAllPlugins` 被调用
- **THEN** BlockedWordsPlugin 以 priority=750 被注册到 PostProcessingPipeline

#### Scenario: 配置注入
- **GIVEN** 插件执行时
- **WHEN** 需要读取禁词表配置
- **THEN** 插件从全局设置存储中读取 BlockedWordsConfig
- **AND** 插件不直接依赖 IPC，通过渲染进程的 settingStore 获取配置

#### Scenario: 错误处理
- **GIVEN** 禁词过滤过程中发生异常（如无效正则）
- **WHEN** 异常被捕获
- **THEN** 插件记录错误到 context.errors
- **AND** 不中断管线执行
- **AND** 返回原始未过滤内容（fail-safe）

### Requirement: 用户权限控制

The system SHALL implement access control for the banned words settings.

#### Scenario: 全局设置
- **GIVEN** 禁词表是全局设置
- **WHEN** 任何用户打开设置页面
- **THEN** 所有用户均可查看和编辑禁词表
- **AND** 禁词表对所有对话角色全局生效

#### Scenario: 无多用户体系
- **GIVEN** 当前应用为单用户桌面应用
- **WHEN** 考虑权限控制
- **THEN** 不实现多用户权限层级
- **AND** 禁词表修改记录到日志中（可追溯）

## REMOVED Requirements

无。此功能为全新添加，不涉及移除已有功能。

## 实现位置评估总结

### 方案一：PostProcessingPipeline 插件（推荐）

**可行性**：高
- 重用现有 PostProcessPlugin 接口（`name`、`priority`、`detect`、`process`）
- 与现有插件（ThinkTagPlugin、ExpressionPlugin 等）完全一致的架构模式
- 不增加新的 IPC 通道或主进程逻辑
- 配置通过已有的 settingStore 获取

**优劣**：
- 优点：最小侵入、符合现有架构、易于测试和独立开关
- 优点：可利用现有错误处理机制（不中断管线）
- 优点：可复用现有插件注册链路
- 局限：仅覆盖 CharacterDialogueChat 管线的 AI 回复

### 方案二：AIService 层过滤

**可行性**：低
- 需要修改核心 `AIService.ts` 的流式处理逻辑
- 流式场景下需要逐 chunk 判断和替换，逻辑复杂
- 与现有架构设计（AIService 只负责发送和接收）不一致

**结论**：不采用。

### 方案三：独立过滤服务（主进程）

**可行性**：中
- 需要新增 IPC 通道和主进程服务
- 增加了额外的进程间通信开销
- 需要同时修改渲染层展示逻辑

**结论**：过度设计，不采用。