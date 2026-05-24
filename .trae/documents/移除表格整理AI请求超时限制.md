# 移除表格整理AI请求超时限制计划

## 问题
表格整理功能在调用AI API时，超时时间设置为60秒（`timeout: 60000`）。由于表格整理的提示词非常长（包含10个必要组成部分：角色设定、当前消息、历史表格数据、表格模板结构、表格提取规则、唯一ID生成指南、核心任务说明、增量更新策略、输出要求、示例输出），AI处理时间可能远超60秒，导致"AI请求超时"错误。

## 解决方案
移除或大幅延长表格整理AI请求的超时时间限制。

## 实施步骤

1. **修改 `WritingStorageService.ts` 中的 `callAIAPI` 方法**
   - 文件路径：`g:\AI\creative-cafe\src\main\services\WritingStorageService.ts`
   - 位置：约第1585行
   - 修改内容：将 `timeout: 60000` 改为 `timeout: 0`（Node.js中设置为0表示禁用超时）或改为更长的值如 `timeout: 300000`（5分钟）
   - 推荐使用 `timeout: 0` 来完全移除超时限制，因为长章节可能需要更长时间处理

2. **构建验证**
   - 运行 `npm run build` 确保编译成功
