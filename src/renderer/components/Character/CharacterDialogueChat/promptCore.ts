/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——角色上下文与核心提示词（replaceTemplates / parseMesExample / buildCharacterContext / buildPersonaSection / buildPromptCore / injectDialogueFormatInstructions）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L743-L978。
 */
import { CharacterInfoForPrompt, PromptCoreResult, DEFAULT_USER_NAME } from './promptTypes';
import { UserPersona } from './CharacterDialogueChat.types';
import { buildLengthGuidancePrompt } from './dialogueRules';

export function replaceTemplates(text: string, charName: string, userName: string = 'User'): string {
  if (!text) return '';
  return text
    .replace(/\{\{char\}\}/g, charName)
    .replace(/\{\{Char\}\}/g, charName)
    .replace(/\{\{CHAR\}\}/g, charName)
    .replace(/\{\{user\}\}/g, userName)
    .replace(/\{\{User\}\}/g, userName)
    .replace(/\{\{USER\}\}/g, userName);
}

export function parseMesExample(mesExample: string): Array<{ user: string; char: string }> {
  if (!mesExample) return [];

  let mesString: string;
  if (typeof mesExample === 'string') {
    mesString = mesExample;
  } else if (Array.isArray(mesExample)) {
    mesString = mesExample.join('\n');
  } else {
    mesString = String(mesExample);
  }

  if (!mesString.trim()) return [];

  const examples: Array<{ user: string; char: string }> = [];
  const parts = mesString.split(/<START>/i);

  parts.forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const lines = trimmed.split('\n').filter(line => line.trim());
    const parsed: Array<{ user: string; char: string }> = [];
    let currentUser = '';
    let currentChar = '';

    lines.forEach(line => {
      if (line.startsWith('You:') || line.startsWith('{{user}}:')) {
        if (currentChar) {
          parsed.push({ user: currentUser, char: currentChar });
          currentUser = '';
          currentChar = '';
        }
        currentUser += line.replace(/^(You|{{user}}):\s*/, '') + '\n';
      } else if (line.includes(':')) {
        currentChar += line.replace(/^[^:]+:\s*/, '') + '\n';
      } else {
        currentChar += line + '\n';
      }
    });

    if (currentChar) {
      parsed.push({ user: currentUser.trim(), char: currentChar.trim() });
    }

    examples.push(...parsed);
  });

  return examples;
}

// ==================== 第一步：构建角色上下文 ====================
// 数据来源：角色卡信息（characterCardName、personality、description、scenario、mes_example、system_prompt、creator_notes）

export function buildCharacterContext(
  characterInfo: {
    name?: string;
    personality?: string;
    description?: string;
    scenario?: string;
    mes_example?: string;
    system_prompt?: string;
    creator_notes?: string;
  },
  userName: string = 'User',
  /**
   * 长度引导约束选项（Spec: fix-ai-response-length-degradation / Task 3.3）。
   * 可选；未传入时不追加任何长度引导约束，保持向后兼容。
   * - `minResponseChars`：最小回复字数（中文字符数），>0 时追加约束
   * - `strengthenLength`：是否启用强化模式（连续 3 轮短回复时为 true）
   */
  options?: {
    minResponseChars?: number;
    strengthenLength?: boolean;
  }
): string {
  const { name, personality, description, scenario, mes_example, system_prompt, creator_notes } = characterInfo;
  const charName = name || 'Character';
  let context = '';

  context += `角色名称：${charName}\n`;

  if (personality) {
    context += `角色个性：${personality}\n`;
  }

  if (description) {
    context += `角色描述：${description}\n`;
  }

  if (scenario) {
    context += `场景背景：${scenario}\n`;
  }

  if (creator_notes) {
    context += `创作者备注：${creator_notes}\n`;
  }

  if (system_prompt) {
    context += `系统提示：${system_prompt}\n`;
  }

  if (mes_example) {
    const examples = parseMesExample(mes_example);
    if (examples.length > 0) {
      // Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
      // 标注为"风格范本"：few-shot 范例对"人味"的引导效率远高于规则指令，
      // 但需明确"模仿语气节奏、不照抄内容"，避免示例内容被逐句复述（长程重复来源之一）。
      context += `示例对话（${charName} 的说话风格范本——模仿其语气、用词与节奏，但不要照抄内容）：\n`;
      examples.forEach((ex, i) => {
        if (i > 0) context += `<START>\n`;
        if (ex.user) context += `${userName}: ${ex.user}\n`;
        if (ex.char) context += `${charName}: ${ex.char}\n`;
      });
    }
  }

  // 角色卡为绝对权威约束（Spec: optimize-chat-ai-intelligence / Task 4.3）
  // 与深度锚定（Task 4.1/4.2）形成"系统提示 + 深度锚定"双重角色一致性保障：
  // 头部 system prompt 显式声明角色卡权威性，深处 depth=4 注入精简摘要防止长对话漂移。
  // 注：{{char}} 在此处已替换为实际 charName，避免模板变量残留。
  context += `\n【重要】角色卡设定为绝对权威，必须严格遵循 ${charName} 的性格、背景与说话方式，不得偏离。`;

  // 回复长度引导约束（Spec: fix-ai-response-length-degradation / Task 3.3）
  // 在角色卡权威约束之后追加字数下限引导，防止 AI 在持续对话中复制逐渐缩短的回复模式。
  // strengthenLength=true 时（连续 3 轮短回复）追加强化约束段落。
  if (options?.minResponseChars && options.minResponseChars > 0) {
    context += buildLengthGuidancePrompt(
      options.minResponseChars,
      options.strengthenLength === true,
      charName
    );
  }

  return context.trim();
}

// ==================== 第二步：构建用户人设部分 ====================
// 数据来源：用户人设信息（selectedPersona 的 name 和 description 字段）

export function buildPersonaSection(persona?: UserPersona): string {
  if (!persona || !persona.name) return '';

  // 通用人设：不注入固定人设描述，而是引导 AI 根据角色卡中 {{user}} 的设定动态确定用户身份
  if (persona.isGeneric) {
    return `
## 用户人设（通用人设）

用户当前使用的是"通用人设"，没有预设特定的身份背景。请根据角色卡中关于 {{user}} 的描述（如身份、关系、背景等）来确定用户在当前对话中的角色定位。

角色卡中关于 {{user}} 的设定即为用户的身份依据；角色卡中未指定的细节，你可以根据对话场景自由发挥，但需保持与世界观和角色关系的一致性。
`;
  }

  return `
## 用户人设

你正在与用户 **${persona.name}** 进行对话。

${persona.description ? `### 用户信息\n${persona.description}` : ''}

请根据上述用户人设信息调整你的对话风格和回应方式。
`;
}

// ==================== 第三步：组合核心上下文 ====================
// 数据来源：第一步（角色上下文）+ 第二步（用户人设）

export function buildPromptCore(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona?: UserPersona
): PromptCoreResult {
  const charName = characterInfo.characterCardName || 'Character';
  const characterContext = buildCharacterContext({
    name: charName,
    personality: characterInfo.personality,
    description: characterInfo.characterCardContent,
    scenario: characterInfo.scenario,
    mes_example: characterInfo.mes_example,
    system_prompt: characterInfo.system_prompt,
    creator_notes: characterInfo.creator_notes,
  }, DEFAULT_USER_NAME);

  const personaSection = buildPersonaSection(selectedPersona);

  return { characterContext, personaSection, charName };
}

/**
 * ⚠️【重点标记】对话格式指令注入器
 *
 * 修复 Bug：系统提示词模板可能来自数据库旧版（mergeNewDefaultTemplates 不更新已有模板），
 * 旧模板写着"不要添加任何额外的标记或说明"，导致 AI 不使用 *动作* 格式，
 * 动作描写渲染样式（message-renderer-action）永远不触发。
 *
 * 此函数在提示词返回前做后处理：
 * 1. 移除"不要添加任何额外的标记或说明"语句
 * 2. 追加格式要求指令（对话用双引号，动作用星号）
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
 * 守卫短语从完整旧句放宽为子串"用星号包裹"，覆盖新旧两版格式规则表述，
 * 保证任意模板版本下格式规则至多注入一次。
 */
export function injectDialogueFormatInstructions(systemPrompt: string): string {
  let result = systemPrompt;

  // 移除旧版禁止标记语句（覆盖多种变体写法）
  result = result.replace(
    /不要添加任何额外的标记或说明[。\n]?/g,
    ''
  );

  // 追加格式指令（若已包含则不重复注入）
  const formatInstruction = `\n【输出格式要求】
- 角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹
- 角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑* 或 *她低下头，脸微微泛红*）
- 对话与动作描写可自然交替，像真实的人在说话一样
- 星号 *动作描写* 是格式标记，不属于"额外标记或说明"`;

  if (!result.includes('用星号包裹')) {
    result = result.trimEnd() + '\n' + formatInstruction;
  }

  return result;
}
