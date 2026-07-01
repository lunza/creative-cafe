# Checklist

## 阶段一：统一 AI 调用方式
- [x] `generateTagsForEntry` 函数不再使用直接 `fetch`，改为 `window.electronAPI.ai.request`
- [x] `handleGenerateFromCharacters` 函数不再使用 `sendCharacterAIRequest`，改为 `window.electronAPI.ai.request`
- [x] 世界书模块所有 11 个 AI 函数统一使用 `window.electronAPI.ai.request` 调用方式
- [x] ai-handler.log 中能查到世界书模块 AI 请求的完整入参和出参日志

## 阶段二：提示词模板定义
- [x] `PromptModuleId` 联合类型包含 13 个新 `world-book.*` moduleId
- [x] `getDefaultTemplates()` 返回的 Map 包含 16 个模板（3 角色卡 + 13 世界书）
- [x] 每个世界书模板的含变量 part 设置为 `type: 'fixed'`
- [x] 每个世界书模板的纯文本 part 设置为 `type: 'editable'`
- [x] 每个模板的 `moduleId` 与 `id` 一致
- [x] 每个模板的 `assemblyOrder` 与 parts 的 order 一致
- [x] `SCHEMA_VERSION` 递增为 5
- [x] `keywordMap` 包含 13 个新模块的关键词映射

## 阶段三：提示词管理界面
- [x] `MODULE_GROUPS` 包含"世界书管理"分组
- [x] 分组下列出 13 个模块条目，每个包含 moduleId/name/description
- [x] 提示词管理界面左侧能显示"世界书管理"分组及其下属模块

## 阶段四：业务调用方接入
- [x] `translateText` 通过 `prompt.build('world-book.translate', ...)` 获取提示词
- [x] `polishText` 根据字段类型调用对应的 `world-book.polish-*` 模板
- [x] `generateKeywords` 通过 `prompt.build('world-book.generate-keywords', ...)` 获取提示词
- [x] `generateTagsForEntry` 通过 `prompt.build('world-book.generate-tags', ...)` 获取提示词
- [x] `handleAISortEntries` 通过 `prompt.build('world-book.sort-entries', ...)` 获取提示词
- [x] `handleGenerateEntries` 通过 `prompt.build('world-book.generate-entries', ...)` 获取提示词
- [x] `handleTemplateGenerateEntries` 通过 `prompt.build('world-book.generate-from-template', ...)` 获取提示词
- [x] `handleExpandKeywords` 通过 `prompt.build('world-book.expand-keywords', ...)` 获取提示词
- [x] `handleGenerateDescription` 通过 `prompt.build('world-book.generate-description', ...)` 获取提示词
- [x] `handleGenerateNewEntries` 通过 `prompt.build('world-book.generate-new-entries', ...)` 获取提示词
- [x] `handleGenerateFromCharacters` 通过 `prompt.build('world-book.generate-from-characters', ...)` 获取提示词
- [x] 所有 AI 函数不再包含硬编码的 systemPrompt 字符串

## 阶段五：验证
- [x] `npx tsc --noEmit` 无新增类型错误（世界书相关文件零错误）
- [x] `npx vitest run` 现有测试全部通过
- [x] `PromptTemplateService.test.ts` 中默认模板数量断言更新为 16
- [x] 世界书模板结构断言测试通过
