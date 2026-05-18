# 目录结构重组任务清单

## 任务列表

- [x] 任务 1: 清理临时文件和根目录整理
  - [x] 子任务 1.1: 删除 `temp_hooks.txt` 临时文件
  - [x] 子任务 1.2: 将 `test-keyword-matching.js` 移至 `scripts/` 目录
  - [x] 子任务 1.3: 检查并清理其他不必要的根目录文件

- [x] 任务 2: 重组主进程服务层 (`src/main/services/`)
  - [x] 子任务 2.1: 创建 `src/main/services/ai/` 目录
    - 移动 `ChatStorageService.ts`、`ChatVectorizationService.ts`、`ContextManager.ts`
  - [x] 子任务 2.2: 创建 `src/main/services/character/` 目录
    - 移动 `characterService.ts`
  - [x] 子任务 2.3: 创建 `src/main/services/chat/` 目录
    - 保持 `memory/` 子目录不变
    - 移动 `ChatStorageService.ts` 等聊天相关服务（已在 2.1 完成，此项保留用于理解关联）
  - [x] 子任务 2.4: 保持 `src/main/services/memory/` 现有结构
    - 包含 `chatLogService.ts`、`characterChatRecordService.ts`、`tableEditParser.ts`、`tableTemplateService.ts`
  - [x] 子任务 2.5: 创建 `src/main/services/knowledge-base/` 目录
    - 移动 `KnowledgeBaseService.ts`、`KnowledgeBaseDocumentService.ts`
  - [x] 子任务 2.6: 创建 `src/main/services/vector/` 目录
    - 移动 `VectorStoreService.ts`、`VectorCache.ts`、`VectorRegistryService.ts`、`VecstoreVectorStore.ts`、`EmbeddingService.ts`、`EmbeddingWorkerService.ts`、`DocumentProcessorService.ts`
  - [x] 子任务 2.7: 创建 `src/main/services/world-book/` 目录
    - 移动 `worldBookService.ts`、`WorldBookKeywordMatcher.ts`
  - [x] 子任务 2.8: 创建 `src/main/services/avatar/` 目录
    - 移动 `avatarService.ts`
  - [x] 子任务 2.9: 创建 `src/main/services/plugin/` 目录
    - 移动 `pluginService.ts`
  - [x] 子任务 2.10: 创建 `src/main/services/setting/` 目录
    - 移动 `settingService.ts`
  - [x] 子任务 2.11: 创建 `src/main/services/file/` 目录
    - 移动 `fileService.ts`、`pathService.ts`
  - [x] 子任务 2.12: 创建 `src/main/services/model/` 目录
    - 移动 `ModelDownloadService.ts`、`modelDownloader.ts`
  - [x] 子任务 2.13: 创建 `src/main/services/optimization/` 目录
    - 移动 `optimizerService.ts`

- [x] 任务 3: 重组 IPC 处理器 (`src/main/ipc/handlers/`)
  - [x] 子任务 3.1: 创建功能子目录（character、chat、creative、memory、knowledge-base、world-book、setting、plugin、avatar、file、ai、app、update）
  - [x] 子任务 3.2: 移动各 handler 文件到对应子目录
  - [x] 子任务 3.3: 更新 `src/main/ipc/index.ts` 中的导入路径

- [x] 任务 4: 重组渲染进程组件 (`src/renderer/components/`)
  - [x] 子任务 4.1: 创建 `src/renderer/components/common/` 目录
    - 移动 `RichTextRenderer.tsx`、`StoragePathDisplay.tsx`
  - [x] 子任务 4.2: 将 `MarkdownEditor/` 移至顶级目录 `src/renderer/components/markdown-editor/`
  - [x] 子任务 4.3: 移动 `AIService.*` 到 `src/renderer/services/`
  - [x] 子任务 4.4: 移动 `DataPersistence.*` 到 `src/renderer/services/`
  - [x] 子任务 4.5: 移动 `ChatEngine/` 到 `src/renderer/services/chat-engine/`
  - [x] 子任务 4.6: 将 `CharacterDialogueChat/` 重命名为 `character-dialogue/`（kebab-case）
  - [x] 子任务 4.7: 将 `CharacterManager/` 重命名为 `character-manager/`
  - [x] 子任务 4.8: 清理 `Creative/` 目录下的散落文件，按 editor/export/generate 分组

- [x] 任务 5: 迁移 LongTermMemory 插件到独立目录
  - [x] 子任务 5.1: 在项目根目录创建 `plugins/` 目录
  - [x] 子任务 5.2: 移动 `LongTermMemory/` 到 `plugins/long-term-memory/`
  - [x] 子任务 5.3: 更新插件相关引用路径

- [ ] 任务 6: 统一文件命名规范
  - [ ] 子任务 6.1: 将服务文件重命名为 `.service.ts` 格式
  - [ ] 子任务 6.2: 将工具文件重命名为 `.utils.ts` 格式
  - [ ] 子任务 6.3: 将类型文件重命名为 `.types.ts` 格式

- [ ] 任务 7: 重组测试文件结构
  - [ ] 子任务 7.1: 创建 `src/test/unit/` 目录
  - [ ] 子任务 7.2: 创建 `src/test/fixtures/` 目录
  - [ ] 子任务 7.3: 将 `src/test/vector/` 中的测试文件分类到合适位置

- [ ] 任务 8: 更新所有导入路径和配置
  - [ ] 子任务 8.1: 更新所有受影响的 import 语句
  - [ ] 子任务 8.2: 验证 `vite.config.ts` 配置
  - [ ] 子任务 8.3: 验证 `tsconfig.json` 路径别名（如有）

- [ ] 任务 9: 验证和测试
  - [ ] 子任务 9.1: 运行 TypeScript 类型检查 (`npm run typecheck`)
  - [ ] 子任务 9.2: 运行 ESLint 检查 (`npm run lint`)
  - [ ] 子任务 9.3: 运行测试套件 (`npm run test:run`)
  - [ ] 子任务 9.4: 验证构建 (`npm run build`)

## 任务依赖关系

- [任务 3] 依赖 [任务 2] - IPC handlers 引用 services
- [任务 4] 可与 [任务 2]、[任务 3] 并行执行 - 组件重组独立于主进程
- [任务 5] 可独立执行 - 插件迁移相对独立
- [任务 6] 依赖 [任务 2]、[任务 3]、[任务 4] - 需在文件移动完成后统一重命名
- [任务 7] 可独立执行 - 测试重组相对独立
- [任务 8] 依赖所有前面的任务 - 需要所有文件就位后才能更新引用
- [任务 9] 依赖 [任务 8] - 需要所有路径更新完成后才能验证
