# 技能系统修复与技能广场 Spec

## Why

技能系统存在三个阻塞性问题：(1) 预置智能体引用了 6 个不存在的技能 SKILL.md，导致技能面板显示"技能未安装或已移除"；(2) 技能列表通过 `skillsLoaded` 布尔标志永久缓存，新增技能必须重启应用才能生效；(3) 技能广场（参考 openclaw 的 ClawHub 集成）完全不存在，用户无法从外部导入技能。

## What Changes

### 修复项

- **修复技能显示异常**：为 6 个缺失技能创建 SKILL.md 文件（dialogue-agent 的 3 个 + worldbook-agent 的 3 个），或调整预置智能体的 skills 数组仅引用已存在的技能
- **移除永久缓存**：删除 `registerSkillHandlers()` 中的 `skillsLoaded` 布尔标志，每次 `skill:list` 调用时重新从文件系统加载，用户点击系统顶部刷新按钮（页面 reload）时自然触发重新加载
- **接入工作区技能加载**：`skill:list` handler 中同时加载 `loadBuiltinSkills()` + `loadWorkspaceSkills()`，使工作区技能可见

### 新增项

- **技能广场模块**：参考 openclaw 的技能管理设计，实现以下功能：
  - 技能广场入口（AgentCenter 内的 Tab 或独立页面）
  - 已安装技能列表展示（来源标识：内置/工作区/导入）
  - 从本地目录导入技能（openclaw 的 `source-install` 模式）
  - 从 URL 导入技能（下载 zip 归档并解压安装）
  - 技能的卸载（仅限非内置技能）
  - 技能详情查看（SKILL.md 内容预览）
- **新增 IPC 通道**：
  - `skill:importFromDir` — 从本地目录导入技能
  - `skill:importFromUrl` — 从 URL 下载并导入技能
  - `skill:uninstall` — 卸载工作区/导入的技能
  - `skill:getDetail` — 获取技能完整详情（含 SKILL.md body）

## Impact

- Affected specs: `add-agent-mode-management-and-center`（技能配置面板依赖 skill:list 返回正确数据）、`implement-worldbook-authoring-agent`（世界书智能体技能列表）
- Affected code:
  - `src/main/ipc/handlers/agentHandlers.ts` — skill:list handler 修复 + 新增 4 个 IPC 通道
  - `src/main/preload.ts` — 新增 IPC 桥接
  - `src/renderer/types/electron.d.ts` — 新增类型声明
  - `src/main/services/agent/skills/skillLoader.ts` — 接入工作区技能加载
  - `src/main/services/agent/skills/skillRegistry.ts` — 添加 clear 支持
  - `src/renderer/components/AgentCenter/AgentCenter.tsx` — 添加技能广场 Tab
  - `src/renderer/components/AgentCenter/SkillMarketplace.tsx` — 新建技能广场组件
  - `src/main/services/agent/management/agentConfigService.ts` — 修复预置智能体 skills 数组
  - `src/main/services/agent/skills/builtin-skills/` — 新增 6 个缺失 SKILL.md 或调整配置

## ADDED Requirements

### Requirement: 技能列表实时刷新

系统 SHALL 在每次 `skill:list` 调用时重新加载技能列表，无需重启应用。用户通过系统顶部刷新按钮（页面 reload）即可获取最新技能。

#### Scenario: 页面刷新后重新加载
- **WHEN** 用户点击系统顶部刷新按钮（亮色/暗色切换旁）
- **THEN** 页面重载，`skill:list` 被重新调用，系统重新扫描内置技能目录和工作区技能目录
- **AND** UI 显示刷新后的技能列表，新增的技能立即可见

#### Scenario: 新增工作区技能后刷新
- **WHEN** 用户在 userData/skills/ 目录下放入新的技能文件夹
- **AND** 点击系统顶部刷新按钮
- **THEN** 新技能出现在技能列表中，可被智能体配置使用

### Requirement: 技能广场模块

系统 SHALL 提供技能广场功能，支持用户从外部导入和管理技能。

#### Scenario: 浏览已安装技能
- **WHEN** 用户进入技能广场
- **THEN** 显示所有已安装技能的列表，包含名称、描述、来源标识（内置/工作区/导入）、状态

#### Scenario: 从本地目录导入技能
- **WHEN** 用户点击"从目录导入"按钮
- **AND** 选择包含 SKILL.md 的本地目录
- **THEN** 系统将技能复制到工作区技能目录，注册到 SkillRegistry
- **AND** 技能立即可在技能配置面板中使用

#### Scenario: 从 URL 导入技能
- **WHEN** 用户点击"从 URL 导入"按钮
- **AND** 输入技能归档 URL
- **THEN** 系统下载归档，校验完整性，解压到工作区技能目录，注册到 SkillRegistry

#### Scenario: 卸载非内置技能
- **WHEN** 用户点击技能的"卸载"按钮
- **AND** 确认卸载
- **THEN** 系统从工作区技能目录删除技能文件，从 SkillRegistry 注销
- **AND** 内置技能不允许卸载

### Requirement: 技能来源标识

系统 SHALL 在技能列表中标识每个技能的来源。

#### Scenario: 来源类型
- **GIVEN** 技能来源有三种：`builtin`（内置）、`workspace`（工作区/用户自定义）、`imported`（通过广场导入）
- **WHEN** 显示技能列表
- **THEN** 每个技能标注其来源类型，用户可按来源筛选

## MODIFIED Requirements

### Requirement: skill:list IPC 通道

`skill:list` 通道 SHALL 每次调用时重新加载技能列表，不使用永久缓存。

**修改前**：首次调用时通过 `skillsLoaded` 标志懒加载，后续调用直接读取缓存。
**修改后**：每次调用时清空 SkillRegistry 并重新扫描目录（内置 + 工作区），确保新增技能立即可见。

#### Scenario: 首次调用
- **WHEN** 渲染进程首次调用 `skill:list`
- **THEN** 加载内置技能 + 工作区技能，注册到 SkillRegistry，返回完整列表

#### Scenario: 后续调用（刷新）
- **WHEN** 渲染进程再次调用 `skill:list`（如用户点击刷新按钮）
- **THEN** 清空 SkillRegistry，重新扫描目录，返回更新后的列表

### Requirement: 预置智能体技能配置

预置智能体的 skills 数组 SHALL 仅引用已存在的技能，或为缺失技能创建 SKILL.md 定义。

**修改前**：
- dialogue-agent 引用 3 个不存在的技能（state-table-edit, chat-history-search, worldbook-search）
- worldbook-agent 引用 3 个不存在的技能（worldbook-generate, worldbook-keywords, worldbook-sort）

**修改后**：为 6 个缺失技能创建 SKILL.md 文件，使其在技能面板中正确显示。
