# 设置模块页签化重构 Spec

## Why
当前 `Settings.tsx` 将 7 个设置面板（外观/高级、AI 引擎、SD WebUI、向量模型、网络搜索、标签自动推荐、RAG 标签库）纵向堆叠在单个长滚动页面中，用户需要大量滚动才能定位目标设置项，功能边界模糊、可发现性差。重构为按功能相关性分组的页签式布局，可显著提升设置项的定位效率与整体易用性。

## What Changes
- 将 `Settings.tsx` 的纵向堆叠布局替换为 antd `Tabs` 顶部页签布局，按功能相关性划分为 **5 个页签**。
- 每个页签内放置 1~2 个原有面板，**面板组件本身及其内部逻辑、props、ref 接口完全不改**。
- 所有页签的子面板使用 `forceRender: true` 强制挂载，确保「保存设置」时所有 ref（`getFormValues()`）均可用，且切换页签不丢失已填状态。
- 底部操作栏（保存设置 / 打开配置文件 / 重置设置）保持在 `Tabs` 之外、始终可见，沿用现有 `handleSave` / `handleOpenConfigFile` / `handleReset` 逻辑。
- 在 `Settings.css` 增补页签相关样式（首个卡片去顶距、页签内间距、选中/未选中态），保持与系统 UI 风格一致。
- 首次进入默认激活「通用」页签。
- **不修改**任何后端 IPC、store、数据结构、类型定义；**不修改**各面板内部的设置项交互逻辑与持久化读写逻辑。

### 页签分组方案（核心设计决策）

| 页签 key | 标签 | 包含面板 | 分组依据 |
|---|---|---|---|
| `general` | 通用 | `GeneralSettingsPanel`（外观设置 + 高级设置） | 应用级外观/调试/日志，最常用 |
| `ai-engine` | AI 引擎 | `AIEngineSettingsPanel` | 对话/润色/特征生成所用的 LLM 服务配置 |
| `image-gen` | 图像生成 | `SDWebuiSettings` | Stable Diffusion 图像生成后端 |
| `vector-rag` | 向量与 RAG | `VectorConfigPanel` + `TagRagSettings` | 共享 sqlite-vec 向量库基础设施 + RAG 标签库消费层，强相关 |
| `tags-search` | 标签与搜索 | `TagAutocompleteSettings` + `WebSearchSettings` | 辅助增强类功能（本地标签补全 + 智能体网络搜索工具） |

> 分组理由：`VectorConfigPanel`（向量模型/embedding/检索参数）与 `TagRagSettings`（基于向量库的 RAG 标签库）共用同一 `getDatabaseDir()` 路径与 sqlite-vec 后端，属同一基础设施栈，合并为一个页签避免用户跨页签配置；`TagAutocompleteSettings`（本地 CSV 标签补全）与 `WebSearchSettings`（智能体网络搜索工具）均为可选辅助增强功能，归为一组。

## Impact
- 受影响代码：
  - `src/renderer/components/Settings/Settings.tsx`（主改动：包裹 `Tabs`，新增 `activeTab` state）
  - `src/renderer/components/Settings/Settings.css`（新增页签样式规则）
- 不受影响：所有子面板组件、`stores/settingStore`、`stores/uiStore`、IPC、shared types、后端服务。
- 受影响 specs：无（纯 UI 层重构，不改变任何功能行为）。
- 兼容性：所有已持久化配置数据的读写路径不变；`handleSave` 收集各 ref `getFormValues()` 的逻辑不变；`form` 实例共享机制不变。

## ADDED Requirements

### Requirement: 页签式分组导航
系统 SHALL 在设置页面顶部提供水平页签导航，每个页签对应一个功能分组（通用 / AI 引擎 / 图像生成 / 向量与 RAG / 标签与搜索），点击页签平滑切换显示对应分组内容。

#### Scenario: 切换页签
- **WHEN** 用户点击任一未激活页签
- **THEN** 该页签内容显示，原页签内容隐藏但状态保留，切换过程无明显卡顿

#### Scenario: 首次进入默认页签
- **WHEN** 用户首次打开设置页面
- **THEN** 默认激活「通用」页签

### Requirement: 页签内设置状态保留
系统 SHALL 在页签切换时保留每个分组的当前设置状态（已填表单值、已选选项、ref 内部状态）。

#### Scenario: 切回已访问页签保留输入
- **GIVEN** 用户在「AI 引擎」页签修改了温度参数但未保存
- **WHEN** 用户切换到「图像生成」页签后再切回「AI 引擎」
- **THEN** 之前修改的温度参数值仍在

### Requirement: 跨页签统一保存
系统 SHALL 在底部「保存设置」按钮被点击时，收集所有页签（含当前未激活页签）面板的配置值一并保存，行为与重构前一致。

#### Scenario: 未访问页签的数据仍被保存
- **GIVEN** 用户进入设置页（停在「通用」页签）后直接点击保存
- **WHEN** 用户从未切换到「图像生成」「向量与 RAG」等页签
- **THEN** 这些页签内面板的配置仍被正确读取并保存，不发生数据丢失

## MODIFIED Requirements

### Requirement: 设置页面布局
设置页面由「单页纵向堆叠所有面板」改为「顶部页签 + 页签内堆叠该分组面板 + 底部固定操作栏」。各面板组件内部结构、Card 标题、表单项、交互逻辑保持不变。底部操作栏（保存 / 打开配置文件 / 重置）始终可见，位于页签内容区之外。

## REMOVED Requirements
无。
