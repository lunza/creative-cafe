# Checklist - 提示词拼接与日志系统修复

## 步骤1验证：ai-handler.log 文件日志写入模块
- [x] 1.1 `chatLogService.ts` 中 `writeToFileLog` 函数实现，日志文件路径正确 (`getUserDataPath()/logs/ai-handler.log`)
- [x] 1.2 日志格式正确: `[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [WRITING] [requestId] message`
- [x] 1.3 `addLog` 函数同时调用 `sendLogToRenderer` 和 `writeToFileLog`
- [x] 1.4 日志文件自动轮转: 超过10MB时备份为 `.1`, `.2`, `.3`
- [x] 1.5 请求ID机制: `generateNewRequestId`, `getCurrentRequestId`, `setRequestId` 正常工作
- [x] 1.6 日志写入异常处理: `try-catch` 不阻塞主流程

## 步骤2验证：章节生成日志记录
- [x] 2.1 `ContentGenerator.ts` 的 `generateStream` 方法6个阶段日志完整:
  - Stage 1/6: 接收请求 (章节ID、项目ID、模型配置、前序章节数量、素材资源数量)
  - Stage 2/6: 参数验证 (baseUrl、apiKey脱敏、modelName、temperature、maxTokens)
  - Stage 3/6: 提示词生成 (messages数量、完整提示词内容)
  - Stage 4/6: AI调用开始 (端点、请求体摘要)
  - Stage 5/6: 结果处理 (完整响应内容、生成耗时、token估算)
  - 错误日志: 章节索引、错误信息
- [x] 2.2 所有日志包含 `[writing]` 前缀标识
- [x] 2.3 `addLog` 在 `ContentGenerator.ts` 中记录完整内容

## 步骤3验证：提示词拼接模块补全素材资源
- [x] 3.1 `ContentGenerationRequest` 接口扩展: `userPersonaContext`, `knowledgeContext`, `resources`
- [x] 3.2 `writingHandlers.ts` 的 `writing:generateChapter` handler 加载所有素材资源:
  - worldBookIds -> worldBookContext
  - characterCardIds -> characterContext
  - userPersonaIds -> userPersonaContext
  - knowledgeItemIds -> knowledgeContext
  - writingStyleIds -> writingStyleContext
- [x] 3.3 `ContentGenerator.ts` 的 `buildResourceContext` 支持4种素材类型
- [x] 3.4 素材优先级正确: 角色信息 → 世界观设定 → 用户人设 → 知识库 → 写作风格
- [x] 3.5 素材完整性校验: 加载失败时记录warning但不阻塞生成

## 步骤4验证：构建和综合验证
- [x] 4.1 `npm run build` 编译通过无错误
- [x] 4.2 日志文件正确生成在 `userData/logs/` 目录
- [x] 4.3 日志文件包含完整入参出参信息
- [x] 4.4 提示词包含完整素材上下文
