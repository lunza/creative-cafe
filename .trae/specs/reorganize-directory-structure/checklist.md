# 目录结构重组验证清单

## 临时文件清理验证
- [ ] `temp_hooks.txt` 已从项目根目录删除
- [ ] `test-keyword-matching.js` 已移至 `scripts/` 目录
- [ ] 项目根目录无其他不必要的临时文件

## 主进程服务层验证 (`src/main/services/`)
- [ ] `src/main/services/ai/` 包含 ChatStorageService、ChatVectorizationService、ContextManager、ModelDownloadService、modelDownloader
- [ ] `src/main/services/character/` 包含 characterService
- [ ] `src/main/services/memory/` 保持现有结构（chatLogService、characterChatRecordService、tableEditParser、tableTemplateService）
- [ ] `src/main/services/knowledge-base/` 包含 KnowledgeBaseService、KnowledgeBaseDocumentService
- [ ] `src/main/services/vector/` 包含 VectorStoreService、VectorCache、VectorRegistryService、VecstoreVectorStore、EmbeddingService、EmbeddingWorkerService、DocumentProcessorService
- [ ] `src/main/services/world-book/` 包含 worldBookService、WorldBookKeywordMatcher
- [ ] `src/main/services/avatar/` 包含 avatarService
- [ ] `src/main/services/plugin/` 包含 pluginService
- [ ] `src/main/services/setting/` 包含 settingService
- [ ] `src/main/services/file/` 包含 fileService、pathService
- [ ] `src/main/services/storage/` 包含 storageManager、storageService、storage.types
- [ ] `src/main/services/optimization/` 包含 optimizerService

## IPC 处理器验证 (`src/main/ipc/handlers/`)
- [ ] handlers 已按功能域分组到子目录
- [ ] `src/main/ipc/index.ts` 的导入路径已全部更新
- [ ] 各 handler 文件引用 services 的路径已更新

## 渲染进程组件验证 (`src/renderer/components/`)
- [ ] `src/renderer/components/common/` 已创建并包含通用组件
- [ ] `src/renderer/components/markdown-editor/` 包含完整 MarkdownEditor 模块
- [ ] AIService 已移至 `src/renderer/services/`
- [ ] DataPersistence 已移至 `src/renderer/services/`
- [ ] ChatEngine 已移至 `src/renderer/services/chat-engine/`
- [ ] CharacterDialogueChat 已重命名为 character-dialogue
- [ ] CharacterManager 已重命名为 character-manager
- [ ] Creative 目录已按 editor/export/generate 分组整理

## 插件迁移验证
- [ ] `plugins/` 目录已创建在项目根目录
- [ ] `plugins/long-term-memory/` 包含完整的 LongTermMemory 插件文件
- [ ] 原 `src/renderer/components/LongTermMemory/` 已移除
- [ ] 插件相关引用路径已更新

## 文件命名规范验证
- [ ] 所有服务文件使用 `.service.ts` 后缀
- [ ] 所有工具文件使用 `.utils.ts` 后缀
- [ ] 所有类型文件使用 `.types.ts` 后缀
- [ ] 组件文件使用 PascalCase 命名
- [ ] Hook 文件使用 usePascalCase 命名

## 测试文件结构验证
- [ ] `src/test/unit/` 目录已创建
- [ ] `src/test/fixtures/` 目录已创建
- [ ] `src/test/vector/` 中的测试已分类到合适位置

## 导入路径验证
- [ ] 所有受影响的 import 语句已更新
- [ ] 无损坏的导入路径
- [ ] 相对路径和绝对路径使用一致

## 构建和测试验证
- [ ] TypeScript 类型检查通过 (`npm run typecheck`)
- [ ] ESLint 检查通过 (`npm run lint`)
- [ ] 测试套件全部通过 (`npm run test:run`)
- [ ] 项目构建成功 (`npm run build`)
- [ ] Electron 开发模式可正常启动
