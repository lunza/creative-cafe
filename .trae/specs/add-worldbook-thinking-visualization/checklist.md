# Checklist

## 类型定义

- [x] `ThoughtStep` 接口已定义，含 type/purpose/inputSummary/outputSummary/durationMs/success/phase/timestamp 字段
- [x] `AuthoringProgressEvent` 新增 `thoughtStep?: ThoughtStep` 可选字段
- [x] `npx tsc --noEmit` 0 新增错误

## 后端思考步骤采集

- [x] `emitThoughtStep()` 辅助方法已实现
- [x] `analyzePrompt` 调用前后采集思考步骤（purpose="分析用户提示"）
- [x] `generateClarifyingQuestions` 调用前后采集思考步骤（purpose="生成澄清问题"）
- [x] `buildPlan` 调用前后采集思考步骤（purpose="构建编写计划"）
- [x] 条目生成 `callChatAPI` 调用前后采集思考步骤（purpose="生成「维度名」条目"）
- [x] 条目解析步骤采集思考步骤（purpose="解析条目数据" — 通过 emitThoughtStep 在 entryGenerator 调用层采集，包含解析结果信息）
- [x] 审计 LLM 调用前后采集思考步骤（purpose="一致性检查"/"完整性校验"）
- [x] 网络搜索调用前后采集思考步骤（purpose="搜索资料：{query}"）
- [x] inputSummary/outputSummary 截断到 300 字符
- [x] `npx tsc --noEmit` 0 新增错误

## 前端状态管理

- [x] State 接口新增 `thoughtSteps: ThoughtStep[]` 字段
- [x] `handleProgressEvent` 中 thoughtStep 追加到数组（上限 100 条）
- [x] `reset()` 中清空 thoughtSteps
- [x] `npx tsc --noEmit` 0 新增错误

## 思考过程 UI 面板

- [x] `renderThoughtPanel()` 方法已实现
- [x] 可折叠面板，标题"思考过程"+ 步骤计数徽标
- [x] Timeline 时间线显示每个步骤：时间戳、purpose、耗时徽标、成功/失败图标
- [x] 点击步骤展开详情（inputSummary + outputSummary）
- [x] 面板默认展开
- [x] 自动滚动到最新步骤
- [x] 在 renderRunningView 中进度条下方、事件日志上方插入
- [x] 使用 CSS 变量适配主题（亮/暗色）
- [x] `npx tsc --noEmit` 0 新增错误

## 测试与验证

- [x] `npx tsc --noEmit` 0 新增错误
- [x] `npx vitest run` 现有测试无回归
- [x] 规划阶段思考步骤正确推送
- [x] 编写阶段思考步骤正确推送
- [x] 思考面板折叠/展开正常
- [x] 步骤展开详情正常
- [x] 自动滚动正常

## 文档

- [x] `CODE_WIKI.md` 新增思考过程可视化章节
- [x] `CHANGELOG.md` 新增对应条目
- [x] `tasks.md` 所有完成任务已勾选
