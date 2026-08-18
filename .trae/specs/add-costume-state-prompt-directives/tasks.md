# Tasks

- [x] Task 1: 服装状态识别指令块构建 — `characterTraitAIService.ts` 新增 `buildCostumeStateGuidance()` 方法
  - [x] SubTask 1.1: 新增 `buildCostumeStateGuidance()` 私有方法，返回服装状态识别指令块字符串
  - [x] SubTask 1.2: 指令块包含 3 类标签的命名规范和示例（开合状态 / 位置变化 / 身体部位暴露）
  - [x] SubTask 1.3: 指令块包含服装状态与服装类型、身体部位的对应关系指导
  - [x] SubTask 1.4: 指令块包含条件触发规则（仅当对话描述服装变化时输出）+ 输出格式（`interaction:` 前缀）
  - [x] SubTask 1.5: 在 `buildDynamicTraitSystemPrompt` 中，将 `costumeStateGuidance` 拼接到 `interactionGuidance` 之后

- [x] Task 2: RAG 服装状态标签检索增强 — `characterTraitAIService.ts` `generateTraitPrompts` 方法
  - [x] SubTask 2.1: 定义服装状态 RAG 检索关键词常量（开合/位置/暴露三类关键词列表）
  - [x] SubTask 2.2: 在 `generateTraitPrompts` 中，用关键词列表拼接查询字符串，额外调用 `buildRagReferenceWithDebug` 检索服装状态标签
  - [x] SubTask 2.3: 将服装状态 RAG 检索结果以"服装状态标签参考"标题注入 system prompt（与现有 RAG 结果分区展示）
  - [x] SubTask 2.4: RAG 未启用/检索失败时静默跳过，不影响主流程

- [x] Task 3: 审核阶段 system prompt 扩展 — `characterTraitAIService.ts` `optimizeTraitsForContext` 方法
  - [x] SubTask 3.1: PART 1 REMOVAL 新增 "Clothing opening/closing change" 矛盾模式（扣上/拉开/合上 → 移除开合状态标签）
  - [x] SubTask 3.2: PART 1 REMOVAL 新增 "Clothing position reset" 矛盾模式（整理/穿好/复位 → 移除位移状态标签）
  - [x] SubTask 3.3: PART 2 SUPPLEMENT 新增 "Opening → exposure" 补充模式（开合标签存在 → 补充暴露特征）
  - [x] SubTask 3.4: PART 2 SUPPLEMENT 新增 "Displacement → exposure" 补充模式（位移标签存在 → 补充暴露特征）
  - [x] SubTask 3.5: PART 2 SUPPLEMENT 新增 "Displacement → body part" 补充模式（位移标签存在 → 补充身体部位标签）
  - [x] SubTask 3.6: 更新 JSON 返回示例，增加服装状态相关的 remove/add 示例

- [x] Task 4: TypeScript 编译验证 + 文档增量更新
  - [x] SubTask 4.1: `npx tsc --noEmit` 确认无新增类型错误
  - [x] SubTask 4.2: `docs/FIX_RECORDS.md` 新增 §7.42 记录实现过程与设计决策
  - [x] SubTask 4.3: `CODE_WIKI.md` 更新 AI 标签生成/审核章节（新增服装状态维度说明）
  - [x] SubTask 4.4: `CHANGELOG.md` 新增功能条目

# Task Dependencies

- Task 1 → Task 2（RAG 检索关键词需与指令块中的标签示例保持一致）
- Task 1 + Task 3 可并行（分别修改 `generateTraitPrompts` 和 `optimizeTraitsForContext` 两个独立方法）
- Task 1 + Task 2 + Task 3 → Task 4（文档更新依赖实现完成）
