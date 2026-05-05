# Changelog

## [0.0.2] - 2026-05-02

### Fixed
- **【重点标记】修复向量测试模块WASM交互问题**：修复了VecstoreVectorStore.search()方法中WASM query()不返回metadata导致向量测试显示空结果的问题。通过引入元数据缓存机制，从metadataCache中补全搜索结果的完整元数据信息，确保相似性查询和向量查看功能正常工作
- **【重点标记】修复世界书条目分片串行问题**：重构了DocumentProcessorService.chunkText()方法，实现智能分块策略。世界书JSON文件按条目分块（每个条目一个完整分块，不分割），其他文档保持500字符分块标准。涉及文件：DocumentProcessorService.ts（新增chunkWorldBookEntries、chunkStandardText、isWorldBookFormat方法）
- 修复了向量维度不匹配问题（expected 384, got 4096），实现了动态维度支持
- 修复了元数据持久化问题，实现双文件存储机制（vecstore.json + vecstore_metadata.json）
- 修复了addBatchNoPersist方法未同步更新元数据缓存的问题

### Added
- 实现了元数据缓存机制（metadataCache），解决WASM query不返回metadata的根本问题
- 实现了启动时从文件加载元数据的功能
- 增加了详细的日志输出，便于调试向量存储相关问题
- 添加JSON文件类型支持，用于世界书JSON文件处理

### Changed
- **【重点标记】知识库版本字段替换为向量存储模式**：将知识库的"版本"(version)字段完全替换为"向量存储模式"(vectorStoreMode)字段，用于区分JSON向量和VecStore存储向量。移除了版本控制相关功能（版本历史、版本恢复），简化了知识条目管理逻辑。涉及文件：KnowledgeItem接口定义、KnowledgeBaseService、KnowledgeBaseManager UI组件、preload.ts IPC API、electron.d.ts类型定义
- **【重点标记】世界书向量化功能重构**：改进世界书向量化处理逻辑，以entries数组中的每个条目为基本单位进行拆分。每个条目向量包含完整字段信息（name、key、keysecondary、keys、secondary_keys、comment、content）。**description字段不再参与向量化**，仅作为元数据引用存储在条目元数据中。明确区分JSON存储和VecStore存储的差异，确保符合VecStore的存储规范。涉及文件：worldBookService.ts
- **【重点标记】文档分块策略优化**：DocumentProcessorService实现智能分块，世界书JSON按条目分块，其他文档按500字符分块

## [0.0.1] - 2026-04-04

### Added
- 实现了配置管理功能，包括API连接配置、模型参数、高级设置和模板管理
- 支持文本补全模式和聊天补全模式的配置
- 为每个参数添加了详细的问号提示，包含功能说明、影响分析和建议值范围
- 实现了配置的导入/导出功能
- 实现了Prompts数组的动态管理，支持添加、删除和查看prompts项
- 解决了{{}}格式通配符的显示问题

### Fixed
- 修复了导入配置导致白屏的问题
- 修复了导入配置时配置名称没有将文件名回显的问题
- 修复了缺少图标导入的问题

### Changed
- 优化了表单的布局和样式
- 提高了应用的稳定性和可靠性
