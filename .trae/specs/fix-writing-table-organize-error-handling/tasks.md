# Tasks
- [x] 修改 `WritingStorageService.processChapterWithAI()` 返回类型为 `Promise<{ success: boolean; error?: string }>`，在AI返回空响应和解析失败时返回错误状态
  - [x] 1.1: 添加 `addLog` 导入（使用 `chatLogService` 的 `addLog`）
  - [x] 1.2: 修改 `processChapterWithAI` 返回 `Promise<{ success: boolean; error?: string }>`
  - [x] 1.3: AI返回空响应时返回 `{ success: false, error: 'AI未返回有效响应' }`
  - [x] 1.4: tableEdit解析失败时返回 `{ success: false, error: '未解析到tableEdit命令' }`
  - [x] 1.5: 成功时返回 `{ success: true }`
  - [x] 1.6: 添加与聊天模式一致的详细日志输出

- [x] 修改 `WritingStorageService.organizeTable()` 根据 `processChapterWithAI` 返回值正确统计错误
  - [x] 2.1: 获取 `processChapterWithAI` 返回值
  - [x] 2.2: 当 `success === false` 时，将错误信息加入 `progress.errors` 并累加 `progress.errorCount`
  - [x] 2.3: 当 `success === true` 时，累加 `progress.processedCount`

- [x] 验证修复效果：测试AI返回空响应时错误是否正确计数

# Task Dependencies
- Task 2 depends on Task 1
