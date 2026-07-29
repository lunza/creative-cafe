# Checklist

## 现状盘点真实性
- [x] 对话模式盘点引用真实文件（ChatEngine.ts / PromptBuilder.ts / tableEditParser.ts / WorldBookKeywordMatcher.ts / ChatVectorizationService.ts）
- [x] 写作模式盘点引用真实文件（AIAssistedChapterService.ts / OutlineGenerator.ts / PlotCheckerService.ts / DescriptionPolisher.ts / TableOrganizeService.ts / writing.types.ts）
- [x] 世界书盘点引用真实文件（worldBookService.ts / WorldBookKeywordMatcher.ts / ChatVectorizationService.ts / useWorldBookAIOperations.ts / worldBookHandlers.ts）
- [x] 明确指出工具调用能力"已检测但未使用"（引用 storageService.ts:234）
- [x] 识别出现有 `<tableEdit>` 文本协议是"伪工具调用"（fire-and-forget），可作为迁移起点
- [x] 识别出世界书已有 15+ AI 操作但全部用户手动触发
- [x] 识别出写作模式 PlotCheckerService 已有 5 维审核 + autoFix 能力

## 方向覆盖与四要素完整性
- [x] 提出 1 个共享基础设施方向（方向 0 工具调用引擎）+ 3 个模式智能体化方向（A/B/C）
- [x] 覆盖用户三大诉求：对话角色卡智能体（A）/ 写作智能体（B）/ 世界书自驱（C）
- [x] 方向 0：实现方案 / 能力组合 / 预期收益 / 技术挑战与对策 — 四要素齐全
- [x] 方向 A：实现方案 / 能力组合 / 预期收益 / 技术挑战与对策 — 四要素齐全
- [x] 方向 B：实现方案 / 能力组合 / 预期收益 / 技术挑战与对策 — 四要素齐全
- [x] 方向 C：实现方案 / 能力组合 / 预期收益 / 技术挑战与对策 — 四要素齐全

## 智能体化深度（核心诉求）
- [x] 每个方向均以"工具调用 + 智能体循环"为核心机制（非简单 prompt 工程）
- [x] 每个方向说明如何复用现有服务作为工具（而非推倒重来）
- [x] 方向 A 明确 `<tableEdit>` 升级为原生 updateStateTable 工具并闭环
- [x] 方向 B 明确编排「读大纲→写章→自审→修复→更新表格→下一章」自驱闭环
- [x] 方向 C 明确 AI 在对话/写作中自主发现实体并创建条目
- [x] 每个方向说明降级策略（supportsToolCalling=false 时回退现有体验）

## 三维度评估
- [x] 从「功能实用性」维度评估每个方向
- [x] 从「技术可行性」维度评估每个方向
- [x] 从「用户价值」维度评估每个方向
- [x] 提供三维评估矩阵汇总表
- [x] 提供综合优先级排序（P0/P1）
- [x] 提供实施顺序建议（第一波：方向 0 + B；第二波：A + C；跨波协同 C↔B）

## 后续可执行性
- [x] 提供后续独立 Spec 立项清单（4 个 change-id）
- [x] 方向 0 明确为基础必须最先实施
- [x] 方向 B 预留与方向 C 的对接点（expandFromContext）
- [x] 每个方向的工具定义足够具体，可作为独立 Spec 的技术方案起点
