# Checklist

## 类型定义

- [x] `AuthoringProgressEvent` 新增 `generatedEntries?: Array<{ name: string; content: string }>` 字段
- [x] `AuthoringProgressEvent` 新增 `auditDetail?` 联合类型字段（mini 和 full 两种）
- [x] `npx tsc --noEmit` 0 新增错误

## 后端填充

- [x] 条目生成完成后 `emitProgress` 填充 `generatedEntries`（最近 5 条，content 截断 200 字符）
- [x] 微型审计完成后 `emitProgress` 填充 `auditDetail`（type='mini'）
- [x] 完整审计完成后 `emitProgress` 填充 `auditDetail`（type='full'）
- [x] `npx tsc --noEmit` 0 新增错误

## 前端面板展示

- [x] `buildAuthoringProgressPanel` 新增"📝 最近生成条目"区块
- [x] 条目展示 name（加粗）+ content 前 200 字符（灰色引用块）
- [x] `buildAuthoringProgressPanel` 新增"🔍 审计结果"区块
- [x] 微型审计展示维度名、问题数、关键问题列表
- [x] 完整审计展示通过/未通过、分数、三维度摘要、修复数、决策项
- [x] 思考步骤 inputSummary/outputSummary 展示长度从 120 提升到 300 字符
- [x] `GetDiagnostics` 0 新增错误

## Loading 状态指示器

- [x] 编写进行中（phase 不在 complete/cancelled/error）时标题旁显示 LoadingOutlined 旋转图标
- [x] phase=complete 显示 ✅
- [x] phase=cancelled 显示 🚫
- [x] phase=error 显示 ❌
- [x] `GetDiagnostics` 0 新增错误
