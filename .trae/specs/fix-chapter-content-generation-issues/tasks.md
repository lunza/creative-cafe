# 任务列表

## 任务 1: 修复章节内容重复生成问题
- [x] 任务 1.1: 修复竞态条件导致的重复生成
  - [x] 使用useRef替代isGenerating状态进行同步防重复检查
  - [x] 添加requestKey机制确保同一章节不会同时发起多个请求
  - [x] 在finally块中清理requestKey

## 任务 2: 修复max_tokens配置读取问题
- [x] 任务 2.1: 修复配置读取的稳定性
  - [x] 统一使用aiEngines字段，移除ai_engines回退逻辑
  - [x] 添加配置读取失败的详细日志
  - [x] 确保engine.max_tokens为数字类型，处理undefined/null/NaN情况
  - [x] 将默认值提高到32768支持长内容生成
  - [x] 在ContentGenerator.ts中添加max_tokens参数的日志输出

## 任务 3: 移除连续生成和暂停功能，简化按钮逻辑
- [x] 任务 3.1: 移除连续生成相关代码
  - [x] 从useChapterGeneration.ts中移除handleContinuousGeneration和continuousGenerationRef
  - [x] 从ContentWorkspace.tsx中移除连续生成按钮

- [x] 任务 3.2: 移除暂停/继续功能
  - [x] 从useChapterGeneration.ts中移除handlePauseGeneration、handleResumeGeneration
  - [x] 移除isPaused状态和相关ref
  - [x] 从ContentWorkspace.tsx中移除暂停/继续按钮
  - [x] 生成中只显示"停止"按钮

- [x] 任务 3.3: 强化停止功能
  - [x] 确保停止时正确清理所有状态
  - [x] 确保停止后保留已生成的内容

## 任务 4: 验证修复
- [x] 任务 4.1: 快速点击生成按钮不会重复生成
- [x] 任务 4.2: max_tokens=51200时AI接收到正确的token数量
- [x] 任务 4.3: 停止按钮正确中止生成并保留内容
- [x] 任务 4.4: 界面只保留生成、重新生成、停止三个核心按钮

## 任务依赖关系
- 任务1.1 和 任务2.1 可以并行实施
- 任务3.1、3.2、3.3 可以并行实施
- 任务4 依赖于任务1-3完成
