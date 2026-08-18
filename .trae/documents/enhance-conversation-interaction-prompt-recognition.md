# 增强对话动作互动提示词识别 — 实施计划

## Summary

对话图片生成时，AI 提示词提取管线对「用户与角色的动作互动」敏感度不足。当对话描述「用手触摸她的身体」「舔她的手」等交互场景时，AI 仅提取角色本身的基础特征（发色/瞳色/服饰等），未能输出 `disembodied_hand` / `hand_on_breast` / `disembodied_tongue` / `licking` 等 Danbooru 风格的互动标签，导致生成的图片缺少交互性质。

**根因**：当前系统提示词 `buildDynamicTraitSystemPrompt` 完全聚焦于「角色视觉特征提取」，分类体系（basic/head/body/top/bottom/accessories/underwear/background/pose/expression）中无任何「互动元素」分类或识别指令。即使对话上下文已传递给 AI，系统提示词也未引导 AI 识别交互动作。

**方案**：新增 `interaction` 系统分类 + 在 `buildDynamicTraitSystemPrompt` 中追加互动元素识别指令，引导 AI 从对话上下文中提取 `disembodied_*` + `hand_on_*` + `licking_*` 等互动标签。

## Current State Analysis

### 数据流（当前）

```
用户消息（最近N条）
  → CharacterDialogueChat.tsx L430-433 构建 conversationContext
  → characterTraitAIService.generateTraitPrompts(prompt=conversationContext, baseTraits=角色卡特征)
  → buildDynamicTraitSystemPrompt(globalCategories) 构建 system prompt（仅角色视觉特征分类）
  → buildTraitPromptUserMessage(prompt, baseTraits) 构建 user message
  → LLM 调用 → 返回 traits（仅角色特征，无互动标签）
  → mergedTraits = 角色卡特征 + 上下文特征（无互动标签）
  → buildSdOptionsFromConfig → SD 生成（图片缺少交互元素）
```

### 关键发现

1. **标签库已包含互动标签**（`docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv`）：
   - `disembodied_hand`（count=71413，cat=0）别名：disembodied_arms/hands/paw, floating_hand
   - `disembodied_tongue`（count=1172，cat=0）别名：floating_tongue, magic_tongue
   - `hand_on_breast`（count=90710，cat=7）别名：hand_on_breasts, hands_on_breast(s)
   - `hand_on_butt`（count=111070，cat=7）
   - `hand_on_hip`（count=71573，cat=7）
   - `hand_on_leg`（count=39119，cat=7）
   - `breast_grab`（count=49231，cat=7）别名：boob_grab, breast_grope
   - `licking_lips` / `cunnilingus` / `penis_lick` / `foot_lick` / `face_lick` / `breast_lick` 等
   - `disembodied_penis` / `disembodied_foot` / `disembodied_mouth` 等

2. **系统提示词完全无互动识别逻辑**（`characterTraitAIService.ts` L1555-1625 `buildDynamicTraitSystemPrompt`）：
   - 10 个分类全部是角色自身视觉属性
   - `pose` 分类定义为「人物姿势（身体姿态、动作）」— 是角色自己的姿势，不是交互
   - 无任何指令引导 AI 识别「用户与角色的动作互动」

3. **ConfigPanel 自动渲染系统分类**（`ConfigPanel.tsx` L179-180）：
   ```typescript
   const traitCategories = React.useMemo<TraitCategory[]>(() => {
     return [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories, UNCATEGORIZED_CATEGORY];
   ```
   - 新增系统分类会自动出现在 ConfigPanel，无需修改 UI 代码

4. **标签审核链（L0-L5）兼容**：互动标签已存在于 CSV，AI 输出后会通过 L1（name 精确匹配）或 L2（alias 精确匹配）验证，无需修改审核逻辑

5. **`generateTraitPrompts` 与 `generateCharacterTraits` 共用 `buildDynamicTraitSystemPrompt`**：两者使用同一系统提示词。互动指令采用「当对话上下文描述了…时」的条件触发表述，对角色卡描述场景（无互动描述）自然不触发，安全无副作用

## Proposed Changes

### 改动 1：新增 `interaction` 系统分类

**文件**：`src/shared/types/characterTrait.types.ts` L247-258

**改动**：在 `SYSTEM_TRAIT_CATEGORIES` 数组末尾（`expression` 之后）新增：
```typescript
{ id: 'interaction', name: '互动元素', isSystem: true, order: 10 },
```

**原因**：
- 与 `pose`（角色自身姿势）语义分离 — 互动元素是「另一个实体（用户）与角色的交互」，不是角色自己的姿势
- ConfigPanel 中独立展示「互动元素」分类，用户可批量启用/禁用
- 符合用户「专门的动作互动提示词识别机制」要求

**向后兼容**：现有角色卡 manifest 无 `interaction` 分类特征，加载时正常（分类为空则 ConfigPanel 跳过渲染，已有 `catTraits.length === 0` 跳过逻辑）

### 改动 2：扩展 `buildDynamicTraitSystemPrompt` — 互动元素识别指令

**文件**：`src/main/services/characterTraitAIService.ts` L1555-1625

**改动点 2a**：`systemCategoryDescriptions` 对象新增 `interaction` 描述（L1558-1570 之间）：
```typescript
interaction: '互动元素（用户与角色之间的身体接触、肢体动作等交互场景，含两种模式：A) POV 脱离身体风格如 disembodied_hand / hand_on_breast / disembodied_tongue / licking；B) 双角色互动风格如 hugging_another / holding_hands / hand_on_another\'s_head / grabbing_another\'s_breast / sitting_on_another。用于引导 SD 生成包含交互性质的图片）',
```

**改动点 2b**：`systemGuidance` 数组新增互动元素 guidance（L1586-1599 之间）：
```typescript
'- 用户与角色的动作互动（触摸身体 → disembodied_hand + hand_on_breast/hand_on_butt/hand_on_hip/hand_on_leg；舔 → disembodied_tongue + licking/face_lick/breast_lick/foot_lick；亲吻 → kissing；拥抱 → hugging_another/hug；牵手 → holding_hands；手放在他人身上 → hand_on_another\'s_head/shoulder/face/cheek/chin/back/arm/chest/thigh/waist；抓握 → grabbing_another\'s_breast/ass/arm/hair；坐/抱 → sitting_on_another/carrying_another）→ interaction',
```

**改动点 2c**：在分类建议（`${categoryGuidance}`）之后、要求（`要求：`）之前，新增「互动元素识别要求」专门指令块：
```
【互动元素识别要求（重要）】
当对话上下文描述了用户与角色的动作互动（如"用手触摸她的身体"、"舔她的手"、"亲吻她"、"拥抱她"等）时，必须提取对应的 Danbooru 互动标签，使用 interaction 分类前缀输出。互动标签分两种模式：

■ 模式 A — POV/脱离身体风格（用户不完整出现在画面中，仅出现交互的身体部位）：
- 身体接触类（手触摸角色）：
  · disembodied_hand（脱离身体的手 — 表示画面中出现一只不属于任何完整角色的手）
  · 配合具体部位：hand_on_breast（手放在胸部）/ hand_on_butt（手放在臀部）/ hand_on_hip（手放在腰间）/ hand_on_leg（手放在腿上）/ hand_on_own_face 等
- 舔舐类（舌头接触角色）：
  · disembodied_tongue（脱离身体的舌头）
  · 配合具体部位：licking（舔）/ face_lick（舔脸）/ breast_lick（舔胸）/ foot_lick（舔脚）等
- 其他：disembodied_penis / disembodied_foot / disembodied_mouth 等脱离身体的部位

■ 模式 B — 双角色互动风格（用户作为"another"完整出现在画面中，与角色互动）：
- 拥抱/牵手：hugging_another（拥抱他人）/ hug / holding_hands（牵手）
- 手放在他人身上：hand_on_another's_head（手放在他人头上）/ hand_on_another's_shoulder（肩）/ hand_on_another's_face（脸）/ hand_on_another's_cheek（脸颊）/ hand_on_another's_chin（下巴）/ hand_on_another's_back（背）/ hand_on_another's_arm（手臂）/ hand_on_another's_chest（胸）/ hand_on_another's_thigh（腿）/ hand_on_another's_waist（腰）
- 抓握他人：grabbing_another's_breast（抓胸）/ grabbing_another's_ass（抓臀）/ grabbing_another's_arm（抓手臂）/ grabbing_another's_hair（抓头发）/ grabbing_another's_wrist（抓手腕）
- 持握他人：holding_another's_wrist（握手腕）/ holding_another's_hair（握头发）/ holding_another's_arm（握手臂）/ hand_in_another's_hair（手插入他人头发）
- 其他互动：sitting_on_another（坐在他人身上）/ carrying_another（抱着他人）/ facing_another（面向他人）/ smiling_at_another（对他人微笑）/ kissing（亲吻）

关键原则：
1. 互动元素独立于角色的完整形象 — 即使用户设定了完整形象，也必须添加 disembodied_* 标签（脱离身体的部位+动作），而非试图生成用户的完整角色
2. 互动标签必须成对出现：disembodied_hand 配合 hand_on_*，disembodied_tongue 配合 *_lick/licking_*
3. 仅当对话明确描述互动动作时才输出互动标签；角色独自站立/坐着的描述不输出互动标签
4. 互动标签使用 interaction 分类前缀，如 interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部, interaction:hugging_another|拥抱他人
5. 根据对话语境选择模式：第一人称描述（"我用手触摸…"）倾向模式 A（disembodied_*）；第三人称或描述两个角色互动倾向模式 B（*_another）
```

**原因**：
- 仅靠分类描述和 guidance 不够 — AI 不知道「disembodied_hand」这种 Danbooru 特有约定的存在
- 显式列举常见互动标签模式（disembodied_* + hand_on_* / *_lick），AI 能直接套用
- 「关键原则」明确「允许不生成用户完整形象，但必须添加 disembodied_* 标签」的核心需求

### 改动 3：同步更新 `CHARACTER_TRAIT_SYSTEM_PROMPT` 基线常量

**文件**：`src/main/services/characterTraitAIService.ts` L305-346

**改动**：在 `CHARACTER_TRAIT_SYSTEM_PROMPT` 常量中同步新增 `interaction` 分类描述 + guidance + 互动识别指令块（与改动 2 保持一致）。

**原因**：虽然该常量「不再直接用于生产调用」（L303 注释），但作为「基线参考（文档化 prompt 结构）」需与动态构建版本保持一致，避免文档失真。代码注释已说明生产使用 `buildDynamicTraitSystemPrompt`。

### 改动 4（不动）：`buildDynamicImageTraitSystemPrompt` 与 `IMAGE_TRAIT_SYSTEM_PROMPT`

**不改动原因**：图片识别（`recognizeImageTraits`）是从已有角色图片中提取特征，输入是 PNG 图片而非对话上下文。互动元素是「对话场景描述」驱动的，图片识别场景不涉及。保持不动以最小化改动范围。

### 改动 5（不动）：标签审核链（L0-L5）/ RAG 检索 / ConfigPanel UI

**不改动原因**：
- **审核链**：互动标签已存在于 CSV（`disembodied_hand` count=71413 等），AI 输出后会通过 L1（name 精确匹配）或 L2（alias 精确匹配）自然验证
- **RAG 检索**：`buildRagReferenceWithDebug(prompt)` 用对话上下文做向量检索，可能已检索到部分互动标签作为参考；系统提示词的显式指令才是主要驱动，RAG 是辅助
- **ConfigPanel UI**：L179-180 已通过 `[...SYSTEM_TRAIT_CATEGORIES, ...]` 自动渲染新分类，无需改代码

## Assumptions & Decisions

### 决策 1：新增 `interaction` 系统分类（而非扩展 `pose`）

- **选 A（新增 interaction）**：语义清晰，ConfigPanel 独立展示，用户可批量控制
- **否决 B（扩展 pose）**：`pose` 是角色自身姿势，混入 `disembodied_hand` 语义错误，用户无法独立控制

### 决策 2：互动指令加入共享 `buildDynamicTraitSystemPrompt`（而非仅 `generateTraitPrompts`）

- **选 A（共享）**：`generateTraitPrompts`（对话）与 `generateCharacterTraits`（角色卡）共用同一 system prompt。互动指令采用「当对话上下文描述了…时」条件触发，角色卡描述场景自然不触发
- **否决 B（仅 generateTraitPrompts）**：需给 `buildDynamicTraitSystemPrompt` 加参数区分调用来源，增加复杂度且无实际收益（条件触发已足够安全）

### 决策 3：不新增用户配置项（如「启用互动识别」开关）

- 用户需求是「自动识别并添加」，非「可配置」。互动指令已条件触发（仅对话描述互动时输出），无需额外开关
- 如后续用户反馈需控制，可通过 ConfigPanel 的分类级 Checkbox 批量禁用 `interaction` 分类

### 假设

1. **AI 模型能力**：假设使用的 LLM（如 GPT-4 / Claude 等）能理解「disembodied_hand」这种 Danbooru 约定并正确输出。如果模型能力不足，可能需要补充更多 few-shot 示例
2. **RAG 辅助**：假设 RAG 检索能从「触摸身体」等中文描述检索到部分互动标签作为参考。即使 RAG 未检索到，系统提示词的显式列举也能引导 AI 输出
3. **对话上下文格式**：当前 `conversationContext` 拼接为 `用户: xxx\n\n角色名: xxx`，AI 能区分用户说的话与角色的回应。互动描述通常在用户消息中

## Verification Steps

### 1. TypeScript 编译验证
```powershell
npx tsc --noEmit
```
- `characterTrait.types.ts` 新增 `interaction` 分类后无类型错误
- `characterTraitAIService.ts` 系统提示词修改后无类型错误

### 2. 互动场景端到端测试

**测试用例 A — 手触摸身体**：
- 对话输入：`用户: 我用手轻轻触摸她的身体`
- 预期 AI 输出含：`interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部`（或 hand_on_butt/hand_on_hip 等，取决于上下文）
- 验证：mergedTraits 含互动标签 → finalPrompt 含 `disembodied_hand, hand_on_breast` → SD 生成含交互元素的图片

**测试用例 B — 舔手**：
- 对话输入：`用户: 我舔她的手`
- 预期 AI 输出含：`interaction:disembodied_tongue|脱离身体的舌头, interaction:hand_lick|舔手`（或 licking_hands，需确认标签库中是否存在 `hand_lick` — 若不存在则走 L5 AI 兜底）
- 验证：标签审核链通过（L1/L2 命中或 L5 兜底）

**测试用例 C — 无互动（回归测试）**：
- 对话输入：`用户: 你好 / 角色名: 你好呀`
- 预期 AI 不输出任何 `interaction:` 前缀的标签
- 验证：现有行为不受影响

### 3. ConfigPanel 渲染验证
- 进入对话图片生成配置面板
- 确认「互动元素」分类出现在分类列表中（位于「人物表情」之后、「未分类」之前）
- 确认空分类（无互动标签时）跳过渲染（已有 `catTraits.length === 0` 逻辑）

### 4. 标签审核链验证
- 查看 `logs/image-generation/` 日志（Spec: enhance-conversation-image-auditability）
- 确认互动标签的 `source` 字段为 `name`（L1）或 `alias`（L2）— 表示标签库命中
- 若互动标签不在标签库中（如 `hand_lick`），确认走 L5 AI 兜底并持久化到 userSynonymMap

### 5. 旧数据兼容验证
- 加载现有角色卡（无 `interaction` 分类特征）
- 确认 ConfigPanel 正常渲染，不报错
- 确认现有角色卡 manifest 未被污染（`interaction` 是系统分类，不写入 manifest）

## 涉及文件清单

| 文件 | 改动 | 行号范围（参考） |
|------|------|------------------|
| `src/shared/types/characterTrait.types.ts` | `SYSTEM_TRAIT_CATEGORIES` 新增 `interaction` 项 | L247-258 |
| `src/main/services/characterTraitAIService.ts` | `buildDynamicTraitSystemPrompt` 新增 interaction 描述 + guidance + 互动识别指令块 | L1555-1625 |
| `src/main/services/characterTraitAIService.ts` | `CHARACTER_TRAIT_SYSTEM_PROMPT` 基线常量同步更新 | L305-346 |
| `docs/FIX_RECORDS.md` | 新增 §7.35 记录本次改动 | 末尾追加 |
| `CODE_WIKI.md` | 新增 §40 记录 `interaction` 分类 + 互动识别机制 | 末尾追加 |
| `CHANGELOG.md` | 新增版本条目 | 顶部插入 |

**不改动的文件**（验证后确认无需修改）：
- `ConfigPanel.tsx` — 已通过 `SYSTEM_TRAIT_CATEGORIES` 自动渲染
- `tagAutocompleteService.ts` — 标签库已含互动标签
- `tagRagService.ts` — RAG 检索无需修改
- `CharacterDialogueChat.tsx` — 对话上下文构建无需修改
- `PromptBuilder.ts` / `buildSdOptions.ts` — traits 合并逻辑无需修改
- `buildDynamicImageTraitSystemPrompt` / `IMAGE_TRAIT_SYSTEM_PROMPT` — 图片识别场景不涉及互动
