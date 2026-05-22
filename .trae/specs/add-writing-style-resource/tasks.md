# Tasks

- [x] 任务 1: 新增写作风格相关类型定义
  - [x] 步骤 1.1: 在 `writing.types.ts` 中新增 `WritingStyleResource` 接口
  - [x] 步骤 1.2: 在 `writing.types.ts` 中新增 `WritingStyleAnalysis` 接口（分析报告结构）
  - [x] 步骤 1.3: 在 `writing.types.ts` 中新增 `WritingStyleProgress` 接口（进度信息）
  - [x] 步骤 1.4: 扩展 `MaterialType` 类型，新增 `'writing-style'` 值
  - [x] 步骤 1.5: 扩展 `WritingResourceConfig` 接口，新增 `writingStyleIds` 字段

- [x] 任务 2: 实现文本分割服务（TextSplitterService）
  - [x] 步骤 2.1: 创建 `TextSplitterService.ts` 服务类
  - [x] 步骤 2.2: 实现 `splitText` 方法，基于段落边界智能分割
  - [x] 步骤 2.3: 实现重叠上下文逻辑，保持语义连贯性
  - [x] 步骤 2.4: 实现基于 token 估算的分割大小计算
  - [x] 步骤 2.5: 编写单元测试验证分割逻辑

- [x] 任务 3: 实现文风学习服务（WritingStyleLearningService）
  - [x] 步骤 3.1: 创建 `WritingStyleLearningService.ts` 服务类
  - [x] 步骤 3.2: 实现文件读取与验证方法
  - [x] 步骤 3.3: 实现文本预处理（调用 TextSplitterService）
  - [x] 步骤 3.4: 实现分批次AI分析方法
  - [x] 步骤 3.5: 实现结果整合与总结方法
  - [x] 步骤 3.6: 实现进度事件发送机制
  - [x] 步骤 3.7: 实现任务取消功能
  - [x] 步骤 3.8: 实现分析报告生成与存储

- [x] 任务 4: 扩展 WritingStorageService 支持写作风格存储
  - [x] 步骤 4.1: 新增 `saveWritingStyle` 方法
  - [x] 步骤 4.2: 新增 `loadWritingStyle` 方法
  - [x] 步骤 4.3: 新增 `listWritingStyles` 方法
  - [x] 步骤 4.4: 新增 `deleteWritingStyle` 方法
  - [x] 步骤 4.5: 创建写作风格专用存储目录

- [x] 任务 5: 新增写作风格相关 IPC 处理器
  - [x] 步骤 5.1: 新增 `writing:style:upload` 处理器（触发学习流程）
  - [x] 步骤 5.2: 新增 `writing:style:list` 处理器（获取已学习列表）
  - [x] 步骤 5.3: 新增 `writing:style:get` 处理器（获取分析报告）
  - [x] 步骤 5.4: 新增 `writing:style:delete` 处理器（删除学习资源）
  - [x] 步骤 5.5: 新增 `writing:style:cancel` 处理器（取消学习）
  - [x] 步骤 5.6: 注册进度事件监听：`writing:style:progress`
  - [x] 步骤 5.7: 注册完成事件监听：`writing:style:complete`
  - [x] 步骤 5.8: 注册错误事件监听：`writing:style:error`

- [x] 任务 6: 扩展 renderer 端 electron.d.ts 类型定义
  - [x] 步骤 6.1: 新增 `writing.style` API 类型定义
  - [x] 步骤 6.2: 新增进度/完成/错误事件监听类型

- [x] 任务 7: 扩展 WritingResourceManager 支持写作风格加载
  - [x] 步骤 7.1: 新增 `loadWritingStyles` 方法
  - [x] 步骤 7.2: 在 `buildResourceContextSummary` 中整合文风信息

- [x] 任务 8: 增强 PromptBuilder 支持文风提示词拼接
  - [x] 步骤 8.1: `buildSystemPrompt` 新增可选 `writingStyleContext` 参数
  - [x] 步骤 8.2: `buildOutlinePrompt` 在资源上下文中包含文风特征
  - [x] 步骤 8.3: `buildContentPrompt` 在生成要求中添加文风模仿指令
  - [x] 步骤 8.4: 新增 `buildWritingStylePrompt` 辅助方法

- [x] 任务 9: 扩展 WritingModeRightPanel 新增写作风格资源标签
  - [x] 步骤 9.1: 在素材子标签中新增"写作风格"tab
  - [x] 步骤 9.2: 实现写作风格列表展示组件
  - [x] 步骤 9.3: 实现文件上传入口与验证
  - [x] 步骤 9.4: 实现学习进度实时展示
  - [x] 步骤 9.5: 实现分析报告预览模态框
  - [x] 步骤 9.6: 实现删除写作风格功能

- [x] 任务 10: 扩展 useWritingMaterials hook 支持写作风格
  - [x] 步骤 10.1: 新增 `writingStyles` 状态
  - [x] 步骤 10.2: 新增 `loadWritingStyles` 方法
  - [x] 步骤 10.3: 新增 `toggleWritingStyle` 方法
  - [x] 步骤 10.4: 新增学习进度状态管理
  - [x] 步骤 10.5: 更新返回值包含写作风格相关状态和方法

- [x] 任务 11: 扩展 writingHandlers 集成文风应用到AI生成
  - [x] 步骤 11.1: 在 `generateOutline` 处理器中加载并拼接文风上下文
  - [x] 步骤 11.2: 在 `generateChapter` 处理器中加载并拼接文风上下文
  - [x] 步骤 11.3: 确保文风特征与原有类型/视角风格协同工作

- [x] 任务 12: 验证与测试
  - [x] 步骤 12.1: 运行 TypeScript 类型检查
  - [x] 步骤 12.2: 运行构建验证
  - [x] 步骤 12.3: 测试文本分割逻辑（边界情况）
  - [x] 步骤 12.4: 测试文件上传验证（格式、大小）
  - [x] 步骤 12.5: 端到端测试完整学习流程

# Task Dependencies

- [任务 2] 无依赖（可并行）
- [任务 1] 无依赖（可并行）
- [任务 3] 依赖于 [任务 1], [任务 2]
- [任务 4] 依赖于 [任务 1]
- [任务 5] 依赖于 [任务 3], [任务 4]
- [任务 6] 依赖于 [任务 5]
- [任务 7] 依赖于 [任务 1], [任务 3]
- [任务 8] 依赖于 [任务 1]
- [任务 9] 依赖于 [任务 6], [任务 10]
- [任务 10] 依赖于 [任务 1]
- [任务 11] 依赖于 [任务 7], [任务 8]
- [任务 12] 依赖于所有其他任务

# 可并行任务组

- **Group A**: [任务 1], [任务 2]（无依赖，可并行）
- **Group B**: [任务 4], [任务 6], [任务 8], [任务 10]（仅依赖任务 1，可在任务 1 完成后并行）
- **Group C**: [任务 9], [任务 11]（各自依赖不同前置任务，可在对应依赖完成后并行）
