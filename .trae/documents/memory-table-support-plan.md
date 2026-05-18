# 记忆表格支持功能开发计划

## 概述
在角色对话配置面板中新增"记忆表格设置"板块，支持在对话提示词中整合记忆管理模块的表格数据，以及自动触发表格整理功能。

## 实施步骤

### 步骤 1: 类型定义扩展
**文件**: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts`

- 在 `CharacterSessionConfig` 接口中新增字段：
  - `memoryTableEnabled?: boolean` - 是否启用记忆表格
  - `memoryTableAutoOrganize?: boolean` - 是否实时整理表格
- 新增 `MemoryTableConfig` 接口定义表格数据结构

### 步骤 2: 创建 MemoryTablePanel 组件
**文件**: `src/renderer/components/Character/CharacterDialogueChat/MemoryTablePanel.tsx`

- 创建独立的设置面板组件
- 包含两个 Switch 开关：
  - "是否启用记忆表格"
  - "是否实时整理表格"
- 实时显示当前关联的表格数据预览（可选）
- 样式与现有 VectorizationPanel、ParameterPanel 保持一致

### 步骤 3: 创建 CSS 样式
**文件**: 在 `ConfigPanel.css` 中新增样式

- `.memory-table-panel` 面板容器样式
- `.memory-table-panel-header` 头部样式（可折叠）
- `.memory-table-toggle` 开关行样式
- 复用现有的 `.config-panel-divider` 等通用样式

### 步骤 4: ConfigPanel 集成
**文件**: `src/renderer/components/Character/CharacterDialogueChat\ConfigPanel.tsx`

- 导入 MemoryTablePanel 组件
- 在 VectorizationPanel 和 ParameterPanel 之间插入 MemoryTablePanel
- 新增 props：
  - `memoryTableEnabled: boolean`
  - `memoryTableAutoOrganize: boolean`
  - `onMemoryTableToggle: (enabled: boolean) => void`
  - `onMemoryTableAutoOrganizeToggle: (enabled: boolean) => void`

### 步骤 5: Hooks 层状态管理
**文件**: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`

- 在 `useCharacterConfig` hook 中支持 `memoryTableEnabled` 和 `memoryTableAutoOrganize` 字段
- 在 `useCharacterDialogueChat` hook 中新增：
  - `fetchMemoryTableData` - 从记忆模块获取表格数据的方法
  - `triggerTableOrganize` - 触发表格整理的方法
  - 在 `onComplete` 回调中，如果开启实时整理，自动调用 `triggerTableOrganize`

### 步骤 6: PromptBuilder 集成表格数据
**文件**: `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`

- 修改 `buildCompleteSystemPrompt` 函数签名，新增可选参数 `memoryTableData?: string`
- 新增 `formatMemoryTableData` 函数，将表格数据格式化为 AI 可读的文本格式
- 在最终提示词中，在向量上下文之后追加记忆表格数据（如果启用）

### 步骤 7: CharacterDialogueChat 主组件集成
**文件**: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`

- 从 hook 中获取 `memoryTableEnabled` 和 `memoryTableAutoOrganize` 状态
- 将新 props 传递给 ConfigPanel
- 处理状态变更回调

### 步骤 8: 配置持久化
**文件**: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` (saveStoredConfig)

- 确保 `memoryTableEnabled` 和 `memoryTableAutoOrganize` 在保存配置时正确持久化到 localStorage
- 确保加载配置时正确恢复这两个字段

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `CharacterDialogueChat.types.ts` | 修改 | 新增类型定义 |
| `MemoryTablePanel.tsx` | 新建 | 记忆表格设置面板组件 |
| `ConfigPanel.css` | 修改 | 新增样式 |
| `ConfigPanel.tsx` | 修改 | 集成新面板 |
| `CharacterDialogueChat.hooks.ts` | 修改 | 状态管理和业务逻辑 |
| `PromptBuilder.ts` | 修改 | 提示词中整合表格数据 |
| `CharacterDialogueChat.tsx` | 修改 | 主组件集成 |

## 依赖关系
- 步骤 1 是所有步骤的前置依赖
- 步骤 2 和 步骤 6 可并行
- 步骤 4 依赖步骤 2
- 步骤 5 依赖步骤 1
- 步骤 7 依赖步骤 4 和 步骤 5
- 步骤 8 依赖步骤 5

## 风险与注意事项
1. 表格数据可能较大，需要考虑提示词长度限制
2. 实时整理表格应在后台异步执行，不阻塞用户操作
3. 需要处理表格数据获取失败的情况
