# Tasks

## 阶段 1：类型定义（无依赖）

- [x] Task 1: 定义 ThoughtStep 类型并扩展 AuthoringProgressEvent
  - [x] SubTask 1.1: 在 `src/shared/types/worldbook-authoring.types.ts` 新增 `ThoughtStep` 接口（type/purpose/inputSummary/outputSummary/durationMs/success/phase/timestamp 字段）
  - [x] SubTask 1.2: 在 `AuthoringProgressEvent` 接口新增 `thoughtStep?: ThoughtStep` 可选字段
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 2：后端思考步骤采集（依赖阶段 1）

- [x] Task 2: 在 worldbookAuthoringService 的 LLM 调用点采集思考步骤
  - [x] SubTask 2.1: 新增 `emitThoughtStep()` 辅助方法 — 封装构建 ThoughtStep + emitProgress 的逻辑，避免在每个调用点重复代码
  - [x] SubTask 2.2: 在 `analyzePrompt` 调用前后采集 — purpose="分析用户提示"，inputSummary=用户提示前 300 字符，outputSummary=LLM 返回前 300 字符
  - [x] SubTask 2.3: 在 `generateClarifyingQuestions` 调用前后采集 — purpose="生成澄清问题"，outputSummary=问题数量 + 第一个问题文本
  - [x] SubTask 2.4: 在 `buildPlan` 调用前后采集 — purpose="构建编写计划"，outputSummary=维度数量 + 目标条目数
  - [x] SubTask 2.5: 在 `createDefaultEntryGenerator` 的 `callChatAPI` 调用前后采集 — purpose="生成「维度名」条目"，inputSummary=维度名+目标数，outputSummary=解析出的条目数+第一个条目名；解析步骤单独采集 purpose="解析条目数据"，inputSummary=原始 JSON 前 300 字符，outputSummary=解析成功 N 个条目
  - [x] SubTask 2.6: 在审计 LLM 调用前后采集 — purpose="一致性检查"/"完整性校验"，outputSummary=问题数量
  - [x] SubTask 2.7: 在网络搜索调用前后采集 — purpose="搜索资料：{query}"，outputSummary=结果数量+第一条标题
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 3：前端状态管理（依赖阶段 1）

- [x] Task 3: 在 useWorldBookAuthoring 中处理 thoughtStep 事件
  - [x] SubTask 3.1: 在 State 接口新增 `thoughtSteps: ThoughtStep[]` 字段（初始空数组）
  - [x] SubTask 3.2: 在 `handleProgressEvent` 中，当 `event.thoughtStep` 存在时将其追加到 `thoughtSteps` 数组（上限 100 条，超出丢弃最旧的）
  - [x] SubTask 3.3: 在 `reset()` 中清空 thoughtSteps
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 4：思考过程 UI 面板（依赖阶段 3）

- [x] Task 4: 在 WorldBookAuthoringModal 新增思考过程面板
  - [x] SubTask 4.1: 新增 `renderThoughtPanel()` 方法 — 可折叠面板，标题"思考过程"+ 步骤计数徽标
  - [x] SubTask 4.2: 面板内容为 Timeline 时间线 — 每个步骤显示：时间戳、purpose 标签、durationMs 耗时徽标、success/fail 图标
  - [x] SubTask 4.3: 点击步骤展开详情 — 显示 inputSummary 和 outputSummary（`<Text type="secondary">` 渲染，pre-wrap）
  - [x] SubTask 4.4: 面板默认展开，使用 antd Collapse 或自定义 div + useState 控制折叠
  - [x] SubTask 4.5: 自动滚动到最新步骤（useRef + useEffect，thoughtSteps 变化时触发）
  - [x] SubTask 4.6: 在 `renderRunningView()` 中，进度条下方、事件日志上方插入思考面板
  - [x] SubTask 4.7: 使用 CSS 变量适配主题（`var(--bg-container)` / `var(--text-primary)` / `var(--text-secondary)` / `var(--border-light)`）
  - [x] 验证：`npx tsc --noEmit` 0 新增错误

## 阶段 5：验证与文档

- [x] Task 5: 类型验证与回归测试
  - [x] SubTask 5.1: `npx tsc --noEmit` 0 新增错误
  - [x] SubTask 5.2: `npx vitest run` 现有测试无回归
  - [x] SubTask 5.3: 验证思考步骤在规划阶段（分析提示/生成问题/构建计划）正确推送
  - [x] SubTask 5.4: 验证思考步骤在编写阶段（条目生成/解析）正确推送
  - [x] SubTask 5.5: 验证思考面板折叠/展开、步骤展开详情、自动滚动

- [x] Task 6: 文档增量更新
  - [x] SubTask 6.1: `CODE_WIKI.md` 新增思考过程可视化章节
  - [x] SubTask 6.2: `CHANGELOG.md` 新增对应条目
  - [x] SubTask 6.3: `tasks.md` 各任务完成后勾选 checkbox

# Task Dependencies
- Task 1（类型定义）独立，无依赖
- Task 2（后端采集）依赖 Task 1
- Task 3（前端状态）依赖 Task 1
- Task 4（UI 面板）依赖 Task 3
- Task 5（验证）依赖 Task 2 + Task 4
- Task 6（文档）最后执行
