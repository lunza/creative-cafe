# Tasks

- [x] 1.1 新建 `src/shared/prompts/humanizerPolish.ts`：锚点常量 + 蒸馏规则块 + `withHumanizerRules()` 守卫注入
- [x] 1.2 新建 `src/shared/prompts/__tests__/humanizerPolish.test.ts`：开启注入 / 关闭跳过 / 锚点防重 / 空输入 / 规则内容完整性
- [x] 2.1 `useCharacterAIOperations.ts`：`polishDeAiFlavor` 状态（默认 true）+ performPolish 注入 + 默认要求措辞中性化 + 返回开关
- [x] 2.2 `CharacterEditModal.tsx`：润色 Modal 增加"去AI味"Switch（润色中禁用）
- [x] 3.1 `useWorldBookAIOperations.ts`：`polishText` 新增 `deAiFlavor` 参数 + 注入；performPolish / performPolishAll 传开关；返回开关
- [x] 3.2 `WorldBookPolishModal.tsx` 两个 Modal 加 Switch + `WorldBookManager.tsx` 接线
- [x] 4.1 运行测试 + tsc 验证（humanizerPolish 9/9 通过；tsc 零新增错误 14=基线14；相关套件 515 过 + 2 个存量失败与本次无关——PromptTemplateService 计数断言 21≠22/14≠15，stash 基线同样失败）
- [x] 4.2 增量更新技术文档（含 humanizer 技能蒸馏来源、运行时注入 vs 烘焙进模板的设计取舍、存量测试失败记录）
