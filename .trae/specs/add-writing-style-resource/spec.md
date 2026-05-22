# 写作风格资源管理功能规格

## Why

写作模式辅助面板目前仅支持世界书、角色卡、用户人设和知识库等素材资源，缺乏基于用户上传文本的AI文风学习与分析能力。用户希望能够上传电子书籍（如《三体》《龙与地下城》等），让AI学习其写作风格、方法及核心优点，并在后续大纲和章节内容生成中应用所学文风，实现真正的风格模仿创作。

## What Changes

- 新增"写作风格"资源类型，支持用户上传txt格式电子书籍文件
- 实现文本预处理模块，包含智能文本分割算法处理超长文本
- 实现分批次AI文风分析机制与结果整合系统
- 在辅助面板素材目录中新增写作风格资源管理标签页
- 实现学习进度实时展示与后台处理机制
- 开发提示词动态拼接系统，将文风特征整合到AI请求中
- 实现文件上传大小限制与格式验证

## Impact

- 影响规格：`creative-writing-mode`、`writing-mode-ui-redesign`
- 影响代码：
  - `src/shared/types/writing.types.ts` - 新增写作风格相关类型定义
  - `src/renderer/components/Creative/WritingMode/WritingModeRightPanel.tsx` - 新增写作风格资源标签
  - `src/renderer/components/Creative/WritingMode/useWritingMaterials.ts` - 新增写作风格资源加载逻辑
  - `src/main/services/WritingResourceManager.ts` - 新增写作风格资源加载方法
  - `src/main/services/WritingStyleLearningService.ts` - **新增** 文风学习服务
  - `src/main/services/TextSplitterService.ts` - **新增** 文本分割服务
  - `src/main/services/WritingStorageService.ts` - 新增写作风格存储方法
  - `src/main/ipc/handlers/writingHandlers.ts` - 新增写作风格相关IPC处理器
  - `src/renderer/types/electron.d.ts` - 新增写作风格API类型定义
  - `src/main/services/writing/PromptBuilder.ts` - 增强提示词构建逻辑

## ADDED Requirements

### Requirement: 写作风格资源上传
系统 SHALL 提供txt格式电子书籍文件上传功能：
- 支持上传单个txt文件，文件大小不超过50MB
- 上传时自动验证文件格式（仅允许.txt扩展名）
- 上传后提取文件元数据（文件名、大小、上传时间）

#### Scenario: 用户上传文风学习文件
- **WHEN** 用户在写作风格资源面板点击"上传文件"
- **THEN** 系统弹出文件选择对话框，仅显示txt文件
- **WHEN** 用户选择文件并确认
- **THEN** 系统验证文件大小和格式，验证通过后开始学习流程

### Requirement: 文本智能分割
系统 SHALL 实现智能文本分割算法：
- 根据AI模型上下文限制（默认128K tokens）计算最佳分割大小
- 分割时保持段落完整性，不在句子中间切断
- 每个分割块保留适当的重叠上下文（建议500-1000字符）以维持语义连贯性
- 分割结果存储供后续批次分析使用

#### Scenario: 处理超长文本
- **WHEN** 用户上传的文本超过单次分析上限
- **THEN** 系统将文本分割为多个块，每块保持段落完整且包含上下文重叠
- **THEN** 系统记录分割信息（总块数、每块范围）用于进度展示

### Requirement: 分批次文风分析
系统 SHALL 实现分批次AI文风分析机制：
- 将分割后的文本块依次发送至AI进行分析
- 每个批次分析内容包括：写作风格特征、修辞手法、叙事结构、语言特点、核心优点
- 支持取消正在进行的分析任务
- 分析结果临时存储供最终整合使用

#### Scenario: 批次分析进行中
- **WHEN** 系统正在分析第N个文本块（共M个）
- **THEN** 系统向渲染进程发送进度更新事件
- **THEN** 用户界面显示当前进度（N/M）和预计剩余时间

### Requirement: 分析结果整合
系统 SHALL 开发结果整合系统：
- 收集所有批次的分析结果
- 将所有批次结果整合后再次发送至AI进行综合总结
- 生成完整的文风分析报告，包含：
  - 整体写作风格概述
  - 核心写作技巧总结
  - 语言特色与修辞偏好
  - 叙事结构与节奏特点
  - 可模仿的关键要素列表
- 分析报告以结构化JSON格式存储

#### Scenario: 生成完整分析报告
- **WHEN** 所有批次分析完成
- **THEN** 系统整合所有结果并发送至AI进行总结
- **THEN** 生成结构化的文风分析报告并存储
- **THEN** 向用户展示学习完成通知

### Requirement: 写作风格资源管理
系统 SHALL 在资源选择目录中展示已学习完成的写作风格资源：
- 列表显示：风格名称（源文件名）、学习完成时间、简要风格描述
- 支持选择/取消选择写作风格资源
- 支持删除已学习的写作风格资源
- 与现有素材类型（世界书、角色卡等）并列展示

#### Scenario: 浏览和选择写作风格
- **WHEN** 用户打开辅助面板的"写作风格"标签
- **THEN** 系统显示已学习的写作风格列表
- **WHEN** 用户点击某个写作风格
- **THEN** 该风格被选中并应用到当前写作项目

### Requirement: 提示词动态拼接
系统 SHALL 开发提示词动态拼接系统：
- 在大纲生成时，自动将用户选择的文风特征整合到系统提示词中
- 在章节内容生成时，将文风特征作为写作风格要求添加到提示词中
- 文风提示词应包含：风格概述、核心技巧、语言特色、叙事特点、可模仿要素
- 确保文风特征不影响原有类型、视角等风格设定的正常运作

#### Scenario: 应用文风生成大纲
- **WHEN** 用户选择了特定写作风格并点击"生成大纲"
- **THEN** 系统在大纲生成提示词中自动拼接该文风特征
- **THEN** AI生成的大纲体现所选文风的结构和风格特点

#### Scenario: 应用文风生成章节内容
- **WHEN** 用户选择了特定写作风格并点击"生成章节"
- **THEN** 系统在内容生成提示词中自动拼接该文风特征
- **THEN** AI生成的章节内容模仿所选文风的写作风格

### Requirement: 学习进度展示
系统 SHALL 提供学习进度实时展示：
- 阶段一：文件读取与预处理（显示文件大小、字符数）
- 阶段二：文本分割（显示分割块数量）
- 阶段三：批次分析（显示当前进度 N/M）
- 阶段四：结果整合（显示"正在生成分析报告"）
- 阶段五：完成（显示"学习完成"及简要报告预览）

#### Scenario: 查看学习进度
- **WHEN** 文风学习正在进行
- **THEN** 用户在写作风格面板中看到实时进度条和阶段说明
- **THEN** 用户可以随时查看详细进度信息

### Requirement: 后台处理机制
系统 SHALL 实现后台处理机制：
- 文风学习过程不阻塞用户界面
- 用户可以在学习进行时进行其他操作（如编辑章节、浏览素材等）
- 学习完成后通过通知提示用户查看结果
- 支持中途取消学习任务

#### Scenario: 后台学习进行中
- **WHEN** 文风学习正在后台运行
- **THEN** 用户可以正常使用写作模式的其他功能
- **WHEN** 学习完成
- **THEN** 系统弹出通知提示用户查看结果

### Requirement: 学习结果预览
系统 SHALL 提供学习结果预览功能：
- 点击已完成的写作风格资源可查看详细分析报告
- 报告以模态框形式展示，包含所有分析维度
- 支持复制报告内容或导出为文本文件

#### Scenario: 预览文风分析报告
- **WHEN** 用户点击已完成的写作风格资源
- **THEN** 系统弹出模态框显示完整的文风分析报告
- **THEN** 用户可以浏览各维度分析结果

### Requirement: 文件安全与存储
系统 SHALL 确保文件上传安全与数据安全：
- 文件上传前验证格式和大小
- 原始txt文件存储在安全的用户数据目录
- 分析结果以加密或结构化JSON格式存储
- 支持导出和删除操作

#### Scenario: 文件验证失败
- **WHEN** 用户上传非txt文件或超过50MB的文件
- **THEN** 系统显示错误提示并拒绝上传

## MODIFIED Requirements

### Requirement: 素材面板扩展
现有辅助面板（WritingModeRightPanel）SHALL 新增"写作风格"资源标签：
- 在素材库标签页中添加"写作风格"子标签
- 与现有的世界书、角色卡、用户人设、知识库标签并列
- 支持搜索和筛选写作风格资源

### Requirement: 资源类型扩展
MaterialType 类型 SHALL 新增 'writing-style' 类型：
- MaterialItem 接口需支持写作风格特有的元数据字段
- 使用学习服务的类型标识

### Requirement: 提示词构建增强
PromptBuilder SHALL 增强提示词构建逻辑：
- buildSystemPrompt 方法增加可选的 writingStyleContext 参数
- buildOutlinePrompt 方法在资源上下文中包含文风特征
- buildContentPrompt 方法在生成要求中添加文风模仿指令

### Requirement: WritingResourceConfig 扩展
WritingResourceConfig 接口 SHALL 新增 writingStyleIds 字段：
- 支持关联多个写作风格资源
- 在多风格选择时，按选择顺序优先级应用

## REMOVED Requirements

无移除需求。
