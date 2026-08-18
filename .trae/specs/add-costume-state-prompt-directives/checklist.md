# Checklist

## Task 1: 服装状态识别指令块
- [x] `buildCostumeStateGuidance()` 方法已实现，返回包含 3 类标签命名规范和示例的指令块字符串
- [x] 指令块包含服装开合状态示例（open_clothes, open_jacket, open_shirt, unbuttoned_shirt, zipper_open 等）
- [x] 指令块包含服装位置变化示例（shorts_around_one_leg, shorts_aside, panties_aside, bra_lift, shirt_lift, skirt_lift 等）
- [x] 指令块包含身体部位暴露示例（one_breast_out, both_breasts_out, off_shoulder, cleavage, underboob 等）
- [x] 指令块包含条件触发规则（仅当对话描述服装变化时输出，无变化不输出）
- [x] 指令块输出格式使用 `interaction:` 前缀（与现有互动标签一致，不新建分类）
- [x] `buildDynamicTraitSystemPrompt` 中 `costumeStateGuidance` 已拼接到 `interactionGuidance` 之后

## Task 2: RAG 服装状态标签检索
- [x] 服装状态 RAG 检索关键词常量已定义（含开合/位置/暴露三类关键词）
- [x] `generateTraitPrompts` 中额外调用 `buildRagReferenceWithDebug` 检索服装状态标签
- [x] 检索结果以"服装状态标签参考"标题注入 system prompt，与现有 RAG 结果分区
- [x] RAG 未启用/检索失败时静默跳过，不影响主流程（无异常抛出）

## Task 3: 审核阶段 system prompt 扩展
- [x] PART 1 REMOVAL 新增 "Clothing opening/closing change" 矛盾模式（含中英文触发词示例）
- [x] PART 1 REMOVAL 新增 "Clothing position reset" 矛盾模式（含中英文触发词示例）
- [x] PART 2 SUPPLEMENT 新增 "Opening → exposure" 补充模式（open_shirt → cleavage/one_breast_out 等）
- [x] PART 2 SUPPLEMENT 新增 "Displacement → exposure" 补充模式（panties_aside → pussy 等）
- [x] PART 2 SUPPLEMENT 新增 "Displacement → body part" 补充模式（shirt_lift → navel/midriff 等）
- [x] JSON 返回示例已更新，包含服装状态相关的 remove/add 示例

## Task 4: 编译验证 + 文档
- [x] `npx tsc --noEmit` 无新增类型错误
- [x] `docs/FIX_RECORDS.md` §7.42 已记录实现过程与设计决策
- [x] `CODE_WIKI.md` AI 标签生成/审核章节已更新（新增服装状态维度）
- [x] `CHANGELOG.md` 已新增功能条目

## 扩展性验证
- [x] `buildCostumeStateGuidance()` 为独立方法，后续可平行新增 `buildPoseStateGuidance()` 等方法
- [x] `optimizeTraitsForContext` system prompt 中服装状态模式以独立条目组织，后续可平行新增其他维度条目
- [x] 新增服装状态维度不需要修改现有互动标签指令代码
