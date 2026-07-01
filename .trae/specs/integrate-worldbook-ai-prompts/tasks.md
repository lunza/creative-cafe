# Tasks

## 阶段一：统一 AI 调用方式

- [x] Task 1: 统一 generateTagsForEntry 的 AI 调用方式
  - [x] SubTask 1.1: 将 `useWorldBookAIOperations.ts` 中 `generateTagsForEntry` 函数（约行 342）的直接 `fetch` 调用改为 `window.electronAPI.ai.request` IPC 调用
  - [x] SubTask 1.2: 保持原有的请求参数构建逻辑（url/headers/body），改为传入 `ai.request` 的 config 对象
  - [x] SubTask 1.3: 验证响应解析逻辑兼容 `ai.request` 返回的 `{ success, data }` 格式

- [x] Task 2: 统一 handleGenerateFromCharacters 的 AI 调用方式
  - [x] SubTask 2.1: 将 `useWorldBookAIOperations.ts` 中 `handleGenerateFromCharacters` 函数（约行 2670）的 `sendCharacterAIRequest` 调用改为 `window.electronAPI.ai.request` IPC 调用
  - [x] SubTask 2.2: 参考其他 9 个函数的调用模式，手动构建 requestUrl/requestHeaders/requestBody
  - [x] SubTask 2.3: 验证响应解析逻辑兼容

## 阶段二：新增世界书提示词模板定义

- [x] Task 3: 扩展类型定义
  - [x] SubTask 3.1: 在 `src/shared/types/promptTemplate.types.ts` 的 `PromptModuleId` 联合类型中添加 13 个新 moduleId

- [x] Task 4: 在 promptTemplateService.ts 中定义 13 个默认模板
  - [x] SubTask 4.1: 定义 `world-book.translate` 模板（翻译，1 个 editable system part）
  - [x] SubTask 4.2: 定义 `world-book.polish-keyword` 模板（关键词润色，1 editable + 1 fixed）
  - [x] SubTask 4.3: 定义 `world-book.polish-comment` 模板（注释润色，1 editable + 1 fixed）
  - [x] SubTask 4.4: 定义 `world-book.polish-content` 模板（内容润色，1 editable + 1 fixed）
  - [x] SubTask 4.5: 定义 `world-book.generate-keywords` 模板（关键词生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.6: 定义 `world-book.generate-tags` 模板（标签生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.7: 定义 `world-book.sort-entries` 模板（AI 排序，1 editable system + 1 fixed user）
  - [x] SubTask 4.8: 定义 `world-book.generate-entries` 模板（条目生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.9: 定义 `world-book.generate-from-template` 模板（模板生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.10: 定义 `world-book.expand-keywords` 模板（关键词扩写，1 editable system + 1 fixed user）
  - [x] SubTask 4.11: 定义 `world-book.generate-description` 模板（描述生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.12: 定义 `world-book.generate-new-entries` 模板（新条目生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.13: 定义 `world-book.generate-from-characters` 模板（基于角色卡生成，1 editable system + 1 fixed user）
  - [x] SubTask 4.14: 递增 `SCHEMA_VERSION` 从 4 到 5
  - [x] SubTask 4.15: 在 `validateTemplate` 的 `keywordMap` 中添加 13 个新模块的关键词映射

## 阶段三：提示词管理界面集成

- [x] Task 5: 在 PromptManagement.tsx 中新增"世界书管理"模块分组
  - [x] SubTask 5.1: 在 `MODULE_GROUPS` 数组中新增 `{ groupName: '世界书管理', modules: [...] }` 条目
  - [x] SubTask 5.2: 为 13 个模块分别定义 `{ moduleId, name, description }` 条目

## 阶段四：业务调用方接入提示词模板

- [x] Task 6: 改造 useWorldBookAIOperations.ts 中的 11 个 AI 函数
  - [x] SubTask 6.1: 改造 `translateText` — 调用 `prompt.build('world-book.translate', {})`
  - [x] SubTask 6.2: 改造 `polishText` — 根据字段类型分别调用 `prompt.build('world-book.polish-keyword/comment/content', { polish_requirements })`
  - [x] SubTask 6.3: 改造 `generateKeywords` — 调用 `prompt.build('world-book.generate-keywords', { comment, content, world_book_description })`
  - [x] SubTask 6.4: 改造 `generateTagsForEntry` — 调用 `prompt.build('world-book.generate-tags', { entry_comment, entry_content, entry_keys })`
  - [x] SubTask 6.5: 改造 `handleAISortEntries` — 调用 `prompt.build('world-book.sort-entries', { entries_list })`
  - [x] SubTask 6.6: 改造 `handleGenerateEntries` — 调用 `prompt.build('world-book.generate-entries', { theme_description })`
  - [x] SubTask 6.7: 改造 `handleTemplateGenerateEntries` — 调用 `prompt.build('world-book.generate-from-template', { template_params })`
  - [x] SubTask 6.8: 改造 `handleExpandKeywords` — 调用 `prompt.build('world-book.expand-keywords', { keywords })`
  - [x] SubTask 6.9: 改造 `handleGenerateDescription` — 调用 `prompt.build('world-book.generate-description', { theme_description, keywords })`
  - [x] SubTask 6.10: 改造 `handleGenerateNewEntries` — 调用 `prompt.build('world-book.generate-new-entries', { count, expected_content })`
  - [x] SubTask 6.11: 改造 `handleGenerateFromCharacters` — 调用 `prompt.build('world-book.generate-from-characters', { characters_info, instructions })`

## 阶段五：验证

- [x] Task 7: 编译验证
  - [x] SubTask 7.1: 运行 `npx tsc --noEmit` 确认无新增类型错误
  - [x] SubTask 7.2: 运行 `npx vitest run` 确认现有测试通过

- [x] Task 8: 单元测试更新
  - [x] SubTask 8.1: 更新 `PromptTemplateService.test.ts`，将默认模板数量从 3 改为 16
  - [x] SubTask 8.2: 添加世界书模板的结构断言测试

# Task Dependencies

- Task 3（类型定义）必须在 Task 4（模板定义）之前完成
- Task 4（模板定义）必须在 Task 6（业务接入）之前完成
- Task 5（界面集成）和 Task 6（业务接入）可在 Task 4 完成后并行
- Task 1、Task 2（统一调用方式）可与 Task 3-5 并行，但必须在 Task 6 之前完成（因为 Task 6 改造函数时需要同时处理调用方式和提示词获取）
- Task 7、Task 8 必须在所有前序任务完成后执行
