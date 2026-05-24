# 增强表格整理默认模板选择与关联功能

## 问题分析

当前 WritingTablePreviewModal 中的"模板绑定"功能存在以下缺失：

1. **无默认模板选择机制**：模板绑定 Modal 中只显示模板列表，没有提示用户选择默认模板或推荐模板
2. **无模板关联状态显示**：绑定后无法显示"已关联: xxx"状态，用户不知道当前绑定了哪个模板
3. **无启用前置检查**：对话模式中启用记忆表格前会检查是否已关联模板，写作模式缺少此机制
4. **模板绑定后无表格结构展示**：绑定后应自动加载并展示表格结构和表头

参考对话模式 MemoryTablePanel 的实现：
- 有"关联模板"按钮，显示当前关联状态（已关联: xxx 或 关联模板）
- 启用前检查是否已关联模板，未关联时弹出模板选择 Modal
- 模板列表在组件挂载时自动加载
- 关联后持久化到配置中

## 实现方案

### 步骤 1：在 WritingTablePreviewModal 中添加模板配置状态管理

**文件**: `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`

添加以下状态：
- `tableConfig` - 存储当前项目的表格配置（enabled, autoOrganize, organizeMode, associatedTemplateId, associatedTemplateName）
- `associatedTemplateName` - 显示当前已关联的模板名称

在组件加载时调用 `getTableConfig(projectId)` 获取当前配置

### 步骤 2：增强模板绑定 Modal，添加默认模板推荐

**文件**: `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`

修改模板绑定 Modal：
- 添加默认模板推荐（标记默认模板）
- 显示每个模板的 sheets 数量和描述
- 如果已关联模板，在 Select 中预选当前模板
- 显示当前关联状态（类似对话模式的"已关联: xxx"）
- 添加模板列表为空时的提示

### 步骤 3：在表格预览中显示当前关联的模板信息

**文件**: `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`

- 在 Modal 标题或顶部区域显示当前关联的模板名称
- 模板绑定按钮显示当前状态（已绑定: xxx 或 绑定模板）

### 步骤 4：添加启用/配置面板（可选增强）

**文件**: `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`

在表格预览 Modal 中添加一个小型配置区域：
- 是否启用表格整理（开关）
- 整理模式选择（同步/异步）
- 关联模板状态显示

### 步骤 5：更新后端 associateTableTemplate 以正确存储模板信息

**文件**: `src/main/services/WritingStorageService.ts`

确保 associateTableTemplate 方法正确保存：
- associatedTemplateId
- associatedTemplateName
- enabled 状态设为 true
- organizeMode 默认为 'sync'

### 步骤 6：构建验证

运行 `npm run build` 确保编译成功

## 参考实现对照

| 功能 | 对话模式 (MemoryTablePanel) | 写作模式 (WritingTablePreviewModal) | 实现方案 |
|------|---------------------------|-----------------------------------|----------|
| 模板列表加载 | useEffect 自动加载 | handleOpenTemplateModal 懒加载 | 保留懒加载，增加配置加载 |
| 关联状态显示 | "已关联: xxx" 按钮文字 | 无 | 添加配置状态读取和显示 |
| 启用前检查 | 检查 associatedTemplateId | 无 | 开始整理前检查 |
| 默认模板推荐 | 无 | 无 | 添加默认模板标记 |
| 模板描述展示 | 无 | 有 | 保留 |

## 实现细节

### 默认模板识别逻辑

从 tableTemplateService 获取模板时，默认模板特征：
- `id: 'st-memory-enhancement-default'`
- `name: '记忆增强插件默认模板'`

在模板列表中，默认模板应显示为：
- 添加 "⭐ 默认模板" 标记
- 在列表顶部显示
- 如果用户未选择任何模板，默认选中此模板

### 关联状态持久化

使用 WritingStorageService 的 getTableConfig / saveTableConfig 方法：
- 绑定模板时同时保存 associatedTemplateId 和 associatedTemplateName
- 加载表格数据时同时加载配置
- 显示当前关联状态
