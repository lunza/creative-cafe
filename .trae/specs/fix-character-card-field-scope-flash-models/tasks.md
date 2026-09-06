# Tasks

- [x] Task 1: 输出越界防御函数 `extractTargetFieldContent`
  - [x] 1.1 实现：字段段落提取（其他字段中文名 + 冒号/【】/# 等标签模式识别，提取目标字段段落）
  - [x] 1.2 实现：无法提取但检测到 ≥2 个其他字段标签 → 返回越界判定（调用方恢复原文 + warning）
  - [x] 1.3 实现：标签残留清理（translate_target/polish_target/context_reference）
  - [x] 1.4 单测：多字段提取 / 无法提取回退 / 标签清理 / 正常透传 四类用例
- [x] Task 2: 翻译/润色 user prompt 标签化改造（useCharacterAIOperations.ts）
  - [x] 2.1 handleTranslate：`<translate_target>` 包裹原文 + `<context_reference>` 包裹上下文 + 作用域声明
  - [x] 2.2 performPolish：`<polish_target>` 同构改造
  - [x] 2.3 无上下文时不输出 context_reference 段落
- [x] Task 3: 模板种子更新 + 变量扩展（promptTemplateService.ts）
  - [x] 3.1 translate 模板：新增 `target_field_label` 变量 + 系统提示作用域段落（仅翻译该字段、禁止输出其他字段）
  - [x] 3.2 polish 模板：同构新增
  - [x] 3.3 generate 模板：user prompt 目标字段强调前置 + 系统提示生成规则追加"仅生成目标字段"
  - [x] 3.4 handleTranslate/performPolish/performGenerate 调用点传入 target_field_label
- [x] Task 4: 存量模板迁移（promptTemplateService.ts）
  - [x] 4.1 锚点迁移函数（参考 migrateContinuationWhitelist 模式）：旧种子一致→迁移，自定义→保留+日志
  - [x] 4.2 迁移单测（未修改迁移成功 / 自定义保留）
- [x] Task 5: 输出防御接入三个写回点
  - [x] 5.1 翻译/润色/生成最终写回前调用 extractTargetFieldContent（流式预览显示原始流，写回为净化结果）
  - [x] 5.2 越界回退：恢复原文 + message.warning + 日志记录
- [x] Task 6: 验证与文档
  - [x] 6.1 tsc 零新增错误 + 相关单测通过
  - [x] 6.2 重启 dev server 确认 Electron 加载新主进程模板代码
  - [x] 6.3 FIX_RECORDS.md 增量记录（含重点标记：模板存量副本迁移为必做项）
  - [x] 6.4 技术文档.md 增量更新

# Task Dependencies

- Task 1 独立（纯函数）
- Task 2、3 相互独立，可并行
- Task 4 依赖 Task 3（迁移锚点基于新种子）
- Task 5 依赖 Task 1、2
- Task 6 最后执行

# 实施备注

- Task 4 调试中发现：`OLD_GENERATE_SYSTEM` 旧种子误用长描述版字段规范（真实 HEAD 种子为短描述版）导致精确匹配失败、generate 迁移静默不生效。已修复并记入 FIX_RECORDS.md §7.66 教训。
- 顺带修复遗留测试失败：`world-book.audit-content` 模板此前加入种子后测试总数断言未同步（21→22、14→15）。
