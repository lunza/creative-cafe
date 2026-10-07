# 漫画解析提示词优化：分镜顺序逐格解析 + 成人内容保留 + 全局提示词拼接统一

## 摘要

修改 `MangaParsingService` 的页面分析提示词（`buildSystemPrompt`）：
1. 强制 AI 按分镜自然顺序对每个分镜独立完整解析，禁止整页总结式描述
2. 声明模型为消融版、允许成人内容输入输出，要求保留并如实呈现成人元素
3. 将「全局提示词拼接」重构为统一函数，与 `recognizeImageTraits` 等既有功能的模式完全一致（`${全局提示词}\n\n${正文}`），并修正过时注释

## 现状分析（已核实）

文件：`src/main/services/manga/MangaParsingService.ts`

| 问题 | 现状 | 根因 |
|---|---|---|
| 1. 多分镜页只出整页总结 | `buildSystemPrompt`（L515-626）分析维度第 3 条仅一句「按阅读顺序逐格描述情节发展和关键事件」 | 无「每个分镜必须独立、完整、不合并、不遗漏」的强约束段落 |
| 2. AI 忽略成人元素 | 提示词中无任何成人内容处理说明 | 模型默认自我审查 |
| 3. 全局提示词拼接 | `buildSystemPrompt`（L530-532）与 `generateStoryOutline`（L363-364）均已在开头拼接 `engineSystemPrompt`，但两处各写各的；L534 注释「置于分析维度之后」与实际位置矛盾（过时注释） | 无统一拼接函数，与其他功能（`characterTraitAIService.ts` L1402：`${engineSystemPrompt.trim()}\n\n${业务prompt}`）模式不一致 |

「其他功能」对照基准（已核实）：
- `characterTraitAIService.ts` L1402-1403：`const systemContent = engineSystemPrompt.trim() ? \`${engineSystemPrompt.trim()}\n\n${dynamicImageSystemPromptWithRag}\` : dynamicImageSystemPromptWithRag;`
- 全局提示词来源：`aiConfigProvider.getAIConfig()` 的 `systemPrompt` 字段（= `engine.system_prompt`，AIConfigProvider L113），两条 manga 路径已正确读取

用户澄清结论（AskUserQuestion）：问题 3 选择「验证并统一模式」——保持全局提示词在最前的行为，统一两条路径的拼接实现，修正过时注释。

## 变更方案

### 变更 1：新增统一拼接函数（问题 3）

文件：`src/main/services/manga/MangaParsingService.ts`

在 `MANGA_LANGUAGE_LABELS` 常量之后新增模块级私有函数：

```ts
/**
 * 将引擎全局提示词拼接在业务提示词开头（与 characterTraitAIService.recognizeImageTraits
 * 等既有功能模式一致：`${engineSystemPrompt.trim()}\n\n${body}`）。
 * 全局提示词为空时原样返回业务提示词。
 */
function prependEnginePrompt(engineSystemPrompt: string, body: string): string {
  const global = (engineSystemPrompt || '').trim();
  return global ? `${global}\n\n${body}` : body;
}
```

### 变更 2：`buildSystemPrompt` 重构（问题 1 + 2 + 3）

同一文件，`buildSystemPrompt` 方法（L515-626）：

1. **删除** L528-532 中 `parts` 开头 push `engineSystemPrompt` 的分支，改为在方法末尾：
   ```ts
   return prependEnginePrompt(engineSystemPrompt, parts.join('\n\n'));
   ```
   （行为不变：全局提示词仍在最终 system prompt 最前）
2. **修正过时注释**（L534）：`// 漫画背景信息（用户提供的书级上下文，置于分析维度之后）` → `// 漫画背景信息（用户提供的书级上下文，置于全局提示词之后、分析师指令之前）`
3. **替换「分析维度」块**（L548-561 区间），新内容为：

   ```
   你是一个专业的漫画内容分析师。请对这一页漫画进行多维度分析，并以 JSON 格式输出。

   ## 分镜解析规则（必须严格遵守）
   1. 先识别并清点这一页漫画中的全部分镜（格子）总数
   2. 按漫画的自然阅读顺序（见下方「阅读顺序」）对每个分镜独立、完整地解析
   3. 每个分镜必须对应 panels 数组中且仅对应一条记录；禁止将多个分镜合并为一条描述，禁止遗漏任何一个分镜
   4. 禁止只生成整页的总结性描述；每个分镜的 plot / emotion / texts 必须基于该分镜内实际可见的视觉内容
   5. panelIndex 从 1 开始按阅读顺序连续递增，panels 数组条数必须等于该页分镜总数
   6. 若整页只有一个分镜，panels 数组也只有一条记录，但必须完整解析该分镜的全部视觉元素

   ## 成人内容处理
   本模型为消融版（abliterated），允许处理成人内容的输入与输出。请像处理普通内容一样处理画面中的成人元素（如裸露、亲吻、性暗示或性行为、血腥等）：
   - 在对应分镜的 plot 与 emotion 字段中如实、客观、简洁地描述，不要忽略、模糊化或自我审查
   - 文本提取时不得改写或删除成人内容的台词
   - 在输出中使用客观中性的描述语言即可，无需回避

   ## 分析维度
   1. **角色识别**：识别主要角色（姓名或外貌描述）、表情、动作
   2. **场景分析**：判断环境、时间、地点、氛围
   3. **剧情理解**：按阅读顺序对每个分镜独立描述情节发展和关键事件（不合并、不遗漏）
   4. **情感识别**：分析各分镜及整页的情绪氛围和角色情感
   5. **文本提取**：精确提取所有文本（对话/旁白/拟音），标注所在分镜与位置

   ## 阅读顺序：{orderText}
   格子编号（panelIndex）从阅读起点开始递增。
   ```

   （输出格式 JSON schema 部分保持不变）

### 变更 3：`generateStoryOutline` 统一拼接（问题 3）

同一文件，`generateStoryOutline` 方法（L332-449）：

1. `systemParts`（L363-372）中**删除**第一行的 `engineSystemPrompt && engineSystemPrompt.trim() ? engineSystemPrompt.trim() : ''` 及 `.filter(Boolean)`（避免空字符串残留）
2. L388 改为：
   ```ts
   const systemPrompt = prependEnginePrompt(engineSystemPrompt, systemParts.join('\n\n'));
   ```
   （行为不变：全局提示词仍在最前）

### 不做的事

- 不改 IPC / preload / 类型契约（纯 prompt 文本变更）
- 不改前端组件
- 不改变 `analyzePage` / `generateStoryOutline` 的调用参数

## 假设与决策

| 决策 | 说明 |
|---|---|
| 成人内容说明只注入页面分析 prompt | 用户诉求指向「单页漫画」分析；大纲由页面分析摘要派生，会自然继承 |
| 消融版措辞固定 | 按用户原话：「本模型为消融版（abliterated），允许处理成人内容的输入与输出」 |
| 全局提示词行为保持「在最前」 | 用户已确认选「验证并统一模式」，不追加额外强化指令 |
| `prependEnginePrompt` 放模块级而非类方法 | 纯函数无状态，模块私有函数即可，与文件内 `extractNumericOrder` 同级风格一致 |

## 实施步骤

1. `MangaParsingService.ts`：新增 `prependEnginePrompt` 函数
2. `MangaParsingService.ts`：`buildSystemPrompt` 删除开头 push 分支 + 末尾改 `prependEnginePrompt` 返回 + 修正 L534 注释 + 替换分析维度块（加入「分镜解析规则」「成人内容处理」两节）
3. `MangaParsingService.ts`：`generateStoryOutline` 的 `systemParts` 删除 engine 分支，拼接改用 `prependEnginePrompt`
4. 验证（见下）

## 验证

1. `npm run typecheck`：manga 相关文件零错误（项目其余预存错误不计）
2. `npx vitest run src/main/services/manga`：既有 6 个单测不回归
3. dev server 重启：查找 creative-cafe 的 vite/node/electron 进程（**禁止动 5000 端口进程**）→ Stop-Process → `npm run dev` 后台重启 → 确认 Electron 主进程初始化完成无异常
4. 静态核对：`buildSystemPrompt` 最终返回串以 `engineSystemPrompt` 开头（非空时）；「分镜解析规则」「成人内容处理」两节存在；`generateStoryOutline` 同样以全局提示词开头
5. `CODE_WIKI.md` 增量更新：漫画解析 Phase 10 章节追加「提示词优化（分镜逐格解析 + 成人内容 + 全局提示词拼接统一）」小节
