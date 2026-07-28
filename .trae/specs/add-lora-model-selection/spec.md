# LoRA 模型选择与图片生成集成 Spec

## Why

现有 AI 素材生成模块（表情/立绘/场景图）不支持 LoRA 模型，用户无法利用 LoRA 提升角色风格一致性和特征连贯性。sd-webui-forge-neo 已提供 `GET /sdapi/v1/loras` API 枚举可用 LoRA，且 LoRA 通过 `<lora:name:weight>` 提示词标签应用，集成路径清晰。需新增 LoRA 模型选择界面并与现有图片生成流程无缝集成。

## What Changes

- 新增 LoRA 模型列表获取 IPC 通道：调用 `GET /sdapi/v1/loras` 获取可用 LoRA 列表，同时读取本地预览图和 JSON 元数据
- 新增 `LoraModel` 类型定义：包含 name/alias/path/metadata/previewUrl/description/category 字段
- 新增 LoRA 选择 Modal 组件：网格预览卡片 + 搜索 + 分类筛选 + 多选 + 权重调整 + 已选标签区
- 扩展 `SDWebuiConfig`：新增 `selectedLoras: Array<{ name: string; weight: number }>` 字段，持久化到设置
- 扩展 `AssetGenerateModal`：在生成参数区新增「LoRA 模型」选择入口，选中后构建 `<lora:name:weight>` 标签注入提示词
- 扩展 `sdGenerationService`：在构建请求前将 LoRA 标签追加到 prompt 前部
- 扩展 `ExpressionGenerateModal`：同步集成 LoRA 选择入口

## Impact

- Affected specs: `add-ai-expression-generation`（表情生成新增 LoRA）、`add-asset-and-trait-management`（素材生成新增 LoRA）、`integrate-nl-driven-sd-models`（NL 模型生成同步支持 LoRA）
- Affected code:
  - 新增：`src/main/services/loraService.ts` — LoRA 列表获取 + 预览图/JSON 读取
  - 新增：`src/main/ipc/handlers/loraHandlers.ts` — IPC 通道
  - 新增：`src/renderer/components/Character/CharacterDialogueChat/LoraSelectModal.tsx` — LoRA 选择 UI
  - 修改：`src/renderer/types/setting.ts` — `SDWebuiConfig` 新增 `selectedLoras` 字段
  - 修改：`src/shared/settings.ts` — 默认配置新增 `selectedLoras: []`
  - 修改：`src/main/preload.ts` + `src/renderer/types/electron.d.ts` — 暴露 LoRA IPC API
  - 修改：`src/main/services/sdGenerationService.ts` — prompt 注入 `<lora:name:weight>` 标签
  - 修改：`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 新增 LoRA 选择入口
  - 修改：`src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx` — 同步集成

## 技术方案

### LoRA 列表获取

**数据源组合**：
1. `GET {endpoint}/sdapi/v1/loras` — 获取 LoRA 列表 `[{name, alias, path, metadata}]`
2. 对每个 LoRA，从 `path` 字段（绝对路径）推导预览图 URL：`{endpoint}/sd_extra_networks/thumb?filename={encodeURIComponent(path)}`
3. 读取本地 JSON 元数据文件（`{model_basename}.json`），解析 `description`/`activation text`/`preferred weight`/`sd version`/`notes`
4. 从 `path` 的子目录名提取分类（如 `画风`/`身体、状态`/`物品、道具`/`风景`/`漫画`/`Anima`）

**LoRA 应用机制**：LoRA 通过 `<lora:name:weight>` 提示词标签应用（Forge Neo 的 prompt parser 自动解析），无需修改请求体结构。标签注入到 prompt 字符串前部（特征 tag 之前）。

### LoRA 选择 UI

```
┌─────────────────────────────────────────┐
│ LoRA 模型选择                    [关闭]  │
├─────────────────────────────────────────┤
│ [搜索框]  [分类筛选: 全部/画风/风景/...] │
├─────────────────────────────────────────┤
│ 已选: [LoRA1 w:0.8 x] [LoRA2 w:0.6 x]  │
├─────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ │预览图│ │预览图│ │预览图│ │预览图│       │
│ │name │ │name │ │name │ │name │       │
│ └─────┘ └─────┘ └─────┘ └─────┘       │
│ ...（网格滚动）                          │
├─────────────────────────────────────────┤
│              [确认选择]                  │
└─────────────────────────────────────────┘
```

- 预览卡片：缩略图 + 模型名，点击切换选中/取消
- 悬停 Tooltip：显示 JSON 元数据（description/activation text/sd version/notes）
- 选中后：在「已选」区域显示标签，含权重滑块（0-1，步进 0.05），可单独移除
- 缺失预览图：显示默认占位图（灰色背景 + 图标）
- 缺失 JSON：Tooltip 显示「无额外说明」

### 性能优化

- 预览图通过 Forge Neo 的 `/sd_extra_networks/thumb` 端点按需加载（浏览器懒加载 `<img loading="lazy">`）
- LoRA 列表获取后缓存在 renderer state，Modal 关闭后保留（避免重复请求）
- 分类筛选/搜索为前端纯计算，不触发网络请求

## ADDED Requirements

### Requirement: LoRA 模型列表获取
系统 SHALL 通过 SD WebUI API 获取可用 LoRA 模型列表，并读取关联的预览图和 JSON 元数据。

#### Scenario: 成功获取 LoRA 列表
- **WHEN** 用户打开 LoRA 选择界面
- **THEN** 系统调用 `GET /sdapi/v1/loras` 获取 LoRA 列表
- **AND** 为每个 LoRA 构建预览图 URL（`/sd_extra_networks/thumb?filename=...`）
- **AND** 读取本地 JSON 元数据文件提取 description/activation text 等信息
- **AND** 从文件路径提取分类（子目录名）
- **AND** 返回完整 LoRA 模型列表

#### Scenario: SD WebUI 不可用
- **WHEN** SD WebUI 未启动或 API 不可达
- **THEN** 显示错误提示「无法连接 SD WebUI，请检查连接状态」
- **AND** 不显示 LoRA 列表

#### Scenario: LoRA 无预览图
- **WHEN** 某个 LoRA 模型没有预览图文件
- **THEN** 显示默认占位图（灰色背景 + 图标）
- **AND** 不影响其他 LoRA 模型的正常显示

#### Scenario: LoRA 无 JSON 元数据
- **WHEN** 某个 LoRA 模型没有 JSON 说明文件
- **THEN** 悬停 Tooltip 显示「无额外说明」
- **AND** 不影响模型选择功能

### Requirement: LoRA 选择界面
系统 SHALL 提供直观的 LoRA 模型选择界面，支持网格预览、搜索、分类筛选、多选和权重调整。

#### Scenario: 浏览 LoRA 模型
- **WHEN** 用户打开 LoRA 选择 Modal
- **THEN** 以网格布局展示所有 LoRA 模型预览卡片
- **AND** 每张卡片显示预览图和模型名称
- **AND** 卡片悬停时显示 JSON 元数据 Tooltip

#### Scenario: 搜索 LoRA 模型
- **WHEN** 用户在搜索框输入关键词
- **THEN** 网格实时过滤显示名称匹配的 LoRA 模型
- **AND** 搜索不区分大小写

#### Scenario: 分类筛选
- **WHEN** 用户选择分类筛选条件
- **THEN** 网格仅显示该分类下的 LoRA 模型
- **AND** 分类列表从 LoRA 目录结构自动生成

#### Scenario: 多选 LoRA 模型
- **WHEN** 用户点击 LoRA 预览卡片
- **THEN** 该 LoRA 被选中并添加到「已选」区域
- **AND** 已选区域显示模型名称和权重滑块（默认 0.7）
- **AND** 用户可继续选择其他 LoRA 模型

#### Scenario: 调整 LoRA 权重
- **WHEN** 用户拖动已选 LoRA 的权重滑块
- **THEN** 权重值在 0-1 之间调整（步进 0.05）
- **AND** 实时显示当前权重值

#### Scenario: 移除已选 LoRA
- **WHEN** 用户点击已选 LoRA 标签的移除按钮
- **THEN** 该 LoRA 从已选列表中移除
- **AND** 对应的预览卡片恢复未选中状态

### Requirement: LoRA 与图片生成集成
系统 SHALL 在图片生成时将选中的 LoRA 模型作为提示词标签注入到生成请求中。

#### Scenario: 带 LoRA 生成图片
- **WHEN** 用户选中 LoRA 模型并点击生成
- **THEN** 系统将 `<lora:name:weight>` 标签注入到 prompt 前部
- **AND** 多个 LoRA 标签按选择顺序拼接
- **AND** 生成请求正常发送到 SD WebUI

#### Scenario: 无 LoRA 生成图片
- **WHEN** 用户未选中任何 LoRA 模型
- **THEN** prompt 不注入任何 LoRA 标签
- **AND** 生成行为与现有逻辑完全一致

### Requirement: LoRA 选择持久化
系统 SHALL 将用户选中的 LoRA 模型及权重持久化到 SD WebUI 配置中。

#### Scenario: 保存 LoRA 选择
- **WHEN** 用户在设置中保存 SD WebUI 配置
- **THEN** 选中的 LoRA 模型列表（含名称和权重）保存到配置文件
- **AND** 下次打开时自动恢复上次的选择

## MODIFIED Requirements

### Requirement: SD WebUI 配置（扩展 selectedLoras）
`SDWebuiConfig` 新增 `selectedLoras?: Array<{ name: string; weight: number }>` 字段，默认空数组。该字段持久化用户选择的 LoRA 模型组合，在生成时读取并注入 prompt。

### Requirement: 素材生成流程（AssetGenerateModal 扩展）
素材生成 Modal 的参数区新增「LoRA 模型」选择入口，点击打开 LoRA 选择 Modal，确认后将选中模型写入 `sdConfig.selectedLoras`，`buildSdOptions()` 透传到 IPC options，`sdGenerationService` 读取并注入 prompt。

### Requirement: 表情生成流程（ExpressionGenerateModal 扩展）
同步集成 LoRA 选择入口，与素材生成保持一致的用户体验。

## REMOVED Requirements

无。
