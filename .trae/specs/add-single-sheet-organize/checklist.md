# Checklist

- [x] `WritingStorageService.ts` 中新增 `organizeSingleSheet` 方法
- [x] `WritingStorageService.ts` 中新增 `buildSingleSheetOrganizePrompt` 方法
- [x] `writingHandlers.ts` 中新增 `writing:table:organizeSingleSheet` handler
- [x] `preload.ts` 中暴露 `organizeSingleSheet` 方法
- [x] 前端添加"整理单个表格"按钮，与"整理全部表格"样式一致
- [x] 点击按钮显示表格选择 Modal
- [x] 选择 sheet 后调用 API 进行单表格整理
- [x] 整理进度显示正常工作
