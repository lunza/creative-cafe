# Tasks

- [x] Task 1: 删除前端组件文件
  - [x] SubTask 1.1: 删除 CreativeManager.tsx 和 CreativeManager.css
  - [x] SubTask 1.2: 删除 CreativeSubNav.tsx 和 CreativeSubNav.css
  - [x] SubTask 1.3: 删除 CreativeListPage.tsx 和 CreativeEditPage.tsx
  - [x] SubTask 1.4: 删除 CharacterCardListPage.tsx 和 CharacterCardEditPage.tsx
  - [x] SubTask 1.5: 删除 WorldBookListPage.tsx、WorldBookEditPage.tsx 和 WorldBookEditor.tsx
  - [x] SubTask 1.6: 删除 hooks/useCreativeAI.ts
  - [x] SubTask 1.7: 删除 utils/exportFormatters.ts
  - [x] SubTask 1.8: 删除 FormatExport/ 目录下全部 3 个文件（FormatExport.tsx、CharacterCardExport.tsx、WorldBookExport.tsx）
  - [x] SubTask 1.9: 确认 WritingMode/ 子目录未被删除

- [x] Task 2: 删除前端状态管理和工具文件
  - [x] SubTask 2.1: 删除 src/renderer/stores/creativeStore.ts
  - [x] SubTask 2.2: 删除 src/renderer/utils/promptTemplates.ts

- [x] Task 3: 删除后端 IPC 处理器
  - [x] SubTask 3.1: 删除 src/main/ipc/handlers/creativeHandlers.ts
  - [x] SubTask 3.2: 移除 src/main/ipc/index.ts 中的 registerCreativeHandlers 导入和调用（第 11 行 import、第 54 行调用）

- [x] Task 4: 清理 preload 和类型声明
  - [x] SubTask 4.1: 移除 src/main/preload.ts 中的 creative API 定义（第 306-313 行）
  - [x] SubTask 4.2: 移除 src/renderer/types/electron.d.ts 中的 creative 类型声明（第 488-495 行）

- [x] Task 5: 清理路由配置
  - [x] SubTask 5.1: 移除 src/renderer/routeConfig.ts 中的 CreativeManager 导入（第 35 行）
  - [x] SubTask 5.2: 移除 routeConfigs 数组中 key 为 'creative' 的路由项（第 72-76 行）

- [x] Task 6: 清理 uiStore
  - [x] SubTask 6.1: 移除 CreativeTabType 和 CreativeViewType 类型导出
  - [x] SubTask 6.2: 移除 UIState 中的 creativeTab、creativeView、setCreativeTab、setCreativeView 字段
  - [x] SubTask 6.3: 移除 TabType 联合类型中的 'creative' 字面量
  - [x] SubTask 6.4: 移除 store 实现中的 creativeTab、creativeView 初始值和 setter
  - [x] SubTask 6.5: 清理 setActiveTab 中对 creativeView 的重置逻辑

- [x] Task 7: 清理后端服务中的 creative 残留
  - [x] SubTask 7.1: 移除 src/main/services/pathService.ts 中 MODULE_DIR_MAP 的 creative 条目（第 18 行）
  - [x] SubTask 7.2: 移除 src/main/services/storageService.ts 中的 CREATIVES 存储键常量、getCreative/setCreative/getCreatives 方法，以及初始化/迁移代码中对 'creatives' 的引用

- [x] Task 8: 清理共享类型注释
  - [x] SubTask 8.1: 移除 src/shared/types/chat.types.ts 中对 creativeStore 的注释引用

- [x] Task 9: TypeScript 编译验证
  - [x] SubTask 9.1: 运行 `npx tsc --noEmit` 确保无编译错误
  - [x] SubTask 9.2: 修复因移除 creative 模块导致的任何残留引用错误

- [x] Task 10: 更新技术文档
  - [x] SubTask 10.1: 在 .trae/documents/技术文档.md 中记录创意管理模块的移除

# Task Dependencies
- Task 1, Task 2, Task 3 可并行执行（无相互依赖）
- Task 4 依赖 Task 3（需要先移除 handler 才能清理 preload）
- Task 5 依赖 Task 1（需要先删除 CreativeManager 才能移除路由）
- Task 6 依赖 Task 1（需要先删除使用 creativeTab 的组件）
- Task 7 可与 Task 1-6 并行执行
- Task 8 可与 Task 1-7 并行执行
- Task 9 依赖 Task 1-8 全部完成
- Task 10 依赖 Task 9（编译通过后更新文档）
