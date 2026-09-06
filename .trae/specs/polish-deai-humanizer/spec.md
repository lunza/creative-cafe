# 润色功能"去 AI 味"优化 Spec（polish-deai-humanizer）

> 背景：世界书 / 角色卡润色产出大量 AI 腔浮夸辞藻（"禁忌之美"式正常人不会用的词）。
> 用户提议内置 humanizer-zh-enhanced 技能（Trae 技能包，本质是给 AI 编辑的提示词指南）。
>
> 结论：技能包不能"原样内置"（它不是应用可调用的库），正确形态是**蒸馏其规则为提示词模块，
> 在润色请求的 system prompt 中运行时注入**——这与技能的设计用途一致。
>
> 用户确认的决策：**接入范围 = 仅角色卡 + 世界书润色**（不含写作模式/主题描述生成）；
> **启用方式 = 润色 Modal 内"去AI味"开关，默认开启**。

---

## Why

### 根因

4 个润色模板（`character-card.polish` / `world-book.polish-keyword|comment|content`）均为
"专业文本润色助手"人设，**零去 AI 味约束**；且默认润色要求"让它更加通顺自然"对 LLM 而言
等价于"请堆砌华丽辞藻"——这是"禁忌之美"式浮夸表达的直接诱因。

### 方案要点（复用 reduce-dialogue-ai-flavor-and-repetition 已验证的模式）

- **运行时注入而非改模板**：规则块由代码持有，`withHumanizerRules()` 锚点守卫注入。
  理由：开关关闭时必须能完全撤下规则——若烘焙进模板（editable part），存量 DB 模板
  不更新（mergeNewDefaultTemplates 已知坑）且开关无法移除已烘焙内容；运行时注入对
  新老用户一致生效，且开关天然可控。
- **规则块内容**：从 humanizer-zh-enhanced 指南（27 种 AI 模式）蒸馏 ~250 字，
  含 5 条核心原则 + RP 域适配的 AI 腔警示表（禁忌之美/诉说着/编织交织/缱绻旖旎等）。
  警示表是"换具体表达"的引导而非机械禁词（humanizer 核心理念）。
- **用户要求优先**：规则块带"除非用户的润色要求明确指定了其他风格"例外条款，
  用户主动要求"华丽古风"时不阻拦。

---

## What Changes

1. 新增 `src/shared/prompts/humanizerPolish.ts`：
   - `HUMANIZER_POLISH_ANCHOR`（锚点）/ `HUMANIZER_POLISH_RULES`（蒸馏规则块）
   - `withHumanizerRules(systemPrompt, enabled)`：enabled=false 原样返回；
     已含锚点原样返回（防重复）；否则追加规则块
2. `useCharacterAIOperations.ts`：新增 `polishDeAiFlavor` 开关状态（默认 true），
   `performPolish` 中对模板产出 system prompt 注入；默认润色要求措辞中性化；
   hook 返回开关与 setter
3. `CharacterEditModal.tsx`：润色 Modal 增加"去AI味"Switch
4. `useWorldBookAIOperations.ts`：`polishText` 新增 `deAiFlavor` 参数（默认 true），
   模板产出后注入；单字段润色（performPolish）与一键润色（performPolishAll）传入开关
   状态；主题描述润色保持默认 true（世界书表面，无 UI 开关）；hook 返回开关与 setter
5. `WorldBookPolishModal.tsx`：单字段 + 一键润色两个 Modal 均增加"去AI味"Switch；
   `WorldBookManager.tsx` 接线传递
6. 模板文件 `promptTemplateService.ts` **不改**（运行时注入覆盖全体用户，零迁移风险）

### 明确不做

- 写作模式创意描述润色（writingStyleHandlers）与世界书主题描述生成（WorldBookSortModal 生成流）
- 对话模式润色（已有独立管线）
- 规则块烘焙进模板系统（可被开关完全控制是硬需求）

---

## Impact

- **Affected specs**：`reduce-dialogue-ai-flavor-and-repetition`（同一问题域的姊妹 spec：
  该 spec 治对话生成，本 spec 治润色功能）
- **Affected code**：
  - 新增 `src/shared/prompts/humanizerPolish.ts` + 测试
  - `src/renderer/components/Character/hooks/useCharacterAIOperations.ts`
  - `src/renderer/components/Character/CharacterEditModal.tsx`
  - `src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts`
  - `src/renderer/components/WorldBook/WorldBookPolishModal.tsx`、`WorldBookManager.tsx`
- **风险**：
  - 规则块被模型机械执行（把"删浮夸词"理解成"删一切形容词"）→ 措辞强调
    "换成具体的动作/感官/事实"而非单纯删除；例外条款兜底用户明确风格要求
  - RP 文本合理文学性被误伤（lore 允许氛围描写）→ 规则只打击"无信息量的浮夸"
  - 规则块稀释用户具体要求 → 控制在 ~250 字

---

## ADDED Requirements

### Requirement: 去 AI 味规则块注入

系统 SHALL 在润色请求构建时按开关状态注入去 AI 味规则块。

#### Scenario: 开关开启时注入
- **WHEN** 润色开关开启且模板产出 system prompt 不含锚点
- **THEN** system prompt 末尾追加规则块（含 RP 域 AI 腔警示表与用户要求优先例外条款）

#### Scenario: 开关关闭时不注入
- **WHEN** 润色开关关闭
- **THEN** system prompt 原样返回（已有锚点也不受影响——用户自定义模板含锚点属用户自身选择）

#### Scenario: 防重复注入
- **WHEN** system prompt 已含锚点且开关开启
- **THEN** 原样返回，不重复追加

#### Scenario: 空输入
- **WHEN** system prompt 为空串
- **THEN** 原样返回空串

### Requirement: 润色开关 UI

系统 SHALL 在角色卡与世界书润色 Modal 提供"去AI味"开关（默认开启）。

#### Scenario: 角色卡润色开关
- **WHEN** 打开角色卡 AI 润色 Modal
- **THEN** 显示"去AI味"Switch（默认开），润色进行中禁用，关闭后执行润色不注入规则块

#### Scenario: 世界书润色开关
- **WHEN** 打开世界书单字段润色或一键润色 Modal
- **THEN** 同上提供开关；一键润色对全部选中条目统一生效
