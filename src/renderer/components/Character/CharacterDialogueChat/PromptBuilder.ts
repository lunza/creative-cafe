import { UserPersona } from './CharacterDialogueChat.types';

const DEFAULT_USER_NAME = 'User';

// ==================== 类型定义 ====================

export interface CharacterInfoForPrompt {
  characterCardName?: string;
  personality?: string;
  characterCardContent?: string;
  scenario?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
}

export interface PromptCoreResult {
  characterContext: string;
  personaSection: string;
  charName: string;
}

export interface ContextVectorItem {
  source: string;
  score: number;
  content: string;
  metadata?: {
    source?: string;
    text?: string;
    entryUid?: string;
    matchedKeys?: string[];
    matchType?: string;
    matchScore?: number;
    entryName?: string;
    entryComment?: string;
    [key: string]: any;
  };
}

// ==================== 底层工具函数 ====================

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
  userName: string = 'User'
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
      context += `示例对话：\n`;
      examples.forEach((ex, i) => {
        if (i > 0) context += `<START>\n`;
        if (ex.user) context += `${userName}: ${ex.user}\n`;
        if (ex.char) context += `${charName}: ${ex.char}\n`;
      });
    }
  }

  return context.trim();
}

// ==================== 第二步：构建用户人设部分 ====================
// 数据来源：用户人设信息（selectedPersona 的 name 和 description 字段）

export function buildPersonaSection(persona?: UserPersona): string {
  if (!persona || !persona.name) return '';

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

// ==================== 第四步：构建基础任务提示词 ====================
// 数据来源：第三步（核心上下文）+ 任务类型（对话/续写）+ 约束规则

export async function buildDialoguePrompt(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona?: UserPersona,
  organizeMode?: 'sync' | 'async'
): Promise<string> {
  // 第一步：获取角色上下文和人设
  const { characterContext, personaSection, charName } = buildPromptCore(characterInfo, selectedPersona);
  // 第二步：获取用户名（来自人设或使用默认值）
  const userName = selectedPersona?.name || DEFAULT_USER_NAME;

  // 根据 organizeMode 生成动态任务说明
  const tableEditInstruction = organizeMode === 'async'
    ? `并在续写完成后通过tableEdit完成数据整理。系统将在提示词末尾提供详细的表格整理指令，请严格按照指令要求在回复末尾生成详细的tableEdit标签，认真解析对话内容（时空、角色、社交、物品、事件等），不要忽略任何细节。`
    : '';

  // 从模板系统获取提示词
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.dialogue', {
      char_name: charName,
      user_name: userName,
      table_edit_instruction: tableEditInstruction,
      character_context: characterContext,
      persona_section: personaSection
    });
    if (promptResult.success && promptResult.data) {
      return promptResult.data.systemPrompt;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取对话模式模板失败，使用硬编码回退:', e);
  }

  // 回退：使用硬编码内容（保留原始逻辑）
  return `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 {{char}} 这个角色，与 ${userName} 进行角色扮演对话。${tableEditInstruction}
在提示词中，{{char}} 代表 ${charName}，${userName} 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。${tableEditInstruction}
【对话约束规则】
1. 你就是 ${charName} 这个角色本人，不是AI助手，不是翻译工具，不是任何系统
2. 以角色的口吻、性格特点和语言习惯与用户交流
3. 积极回应用户的问题和行为，推动对话自然发展
4. 根据对话上下文和情境调整语气和态度
5. 使用符合角色身份的语言风格
6. 在回复中使用 ${charName} 代替 {{char}}，使用 ${userName} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置

【严格禁止】
- 禁止输出任何元信息、系统说明或格式说明
- 禁止输出技术术语、模型名称（如"Transformers"、"Oracle"等）
- 禁止输出与角色扮演无关的任何内容
- 禁止打破角色设定或承认自己是AI
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量，必须替换为实际名称
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【白名单例外 - 必须遵守】
以下标签为系统功能所需的特殊格式，【不属于禁止范围】，当系统提示词中出现相关指令时你必须按要求输出：
- HTML 注释标签 <!-- ... --> 是系统通信格式，用于传递控制指令
- <tableEdit> 标签及其内部命令（insertRow/updateRow/deleteRow）是系统记忆表格功能的必需格式
- 当你在提示词末尾看到"记忆表格异步整理指令"时，【必须】在回复最后生成 <!--  <tableEdit> ... </tableEdit> --> 标签

【输出格式】
直接输出角色的对话和行动描写，像真实的人在说话一样。不要添加任何额外的标记或说明。

【角色信息】
${characterContext}
${personaSection}`;
}

export async function buildContinuationPrompt(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona?: UserPersona,
  organizeMode?: 'sync' | 'async'
): Promise<string> {
  // 第一步：获取角色上下文和人设
  const { characterContext, personaSection, charName } = buildPromptCore(characterInfo, selectedPersona);
  // 第二步：获取用户名（来自人设或使用默认值）
  const userName = selectedPersona?.name || DEFAULT_USER_NAME;

  // 根据 organizeMode 生成动态任务说明
  const tableEditInstruction = organizeMode === 'async'
    ? `并在续写完成后通过tableEdit完成数据整理。系统将在提示词末尾提供详细的表格整理指令，请严格按照指令要求在回复末尾生成详细的tableEdit标签，认真解析对话内容（时空、角色、社交、物品、事件等），不要忽略任何细节。`
    : '';

  // 从模板系统获取提示词
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.continuation', {
      char_name: charName,
      user_name: userName,
      table_edit_instruction: tableEditInstruction,
      character_context: characterContext,
      persona_section: personaSection
    });
    if (promptResult.success && promptResult.data) {
      return promptResult.data.systemPrompt;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取续写模式模板失败，使用硬编码回退:', e);
  }

  // 回退：使用硬编码内容（保留原始逻辑）
  return `【任务类型：内容续写】

【续写任务说明】
你需要续写以下角色的叙述内容。请仔细阅读前文，然后自然地继续写下去，保持风格和上下文的连贯性。${tableEditInstruction}
在提示词中，{{char}} 代表 ${charName}，${userName} 代表当前对话用户。

【续写约束规则】
1. 自然地从已有内容继续，不要重复已写过的部分
2. 保持与原文相同的叙述风格、语气和节奏
3. 确保续写内容与前面的情节逻辑衔接
4. 严格遵守角色设定，不偏离角色性格
5. 像小说作者一样续写，直接输出故事内容
6. 在回复中使用 ${charName} 代替 {{char}}，使用 ${userName} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置

【严格禁止】
- 禁止添加任何标签、前缀或格式标记（如"Plain:"、"Article:"、"Terminate:"等）
- 禁止输出任何元说明文字（如"续写"、"继续"、"接下来"等）
- 禁止输出技术术语、模型名称
- 禁止输出与故事无关的任何内容
- 禁止解释、评论或总结已写内容
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【白名单例外 - 必须遵守】
以下标签为系统功能所需的特殊格式，【不属于禁止范围】，当系统提示词中出现相关指令时你必须按要求输出：
- HTML 注释标签 <!-- ... --> 是系统通信格式，用于传递控制指令
- <tableEdit> 标签及其内部命令（insertRow/updateRow/deleteRow）是系统记忆表格功能的必需格式
- 当你在提示词末尾看到"记忆表格异步整理指令"时，【必须】在回复最后生成 <!--  <tableEdit> ... </tableEdit> --> 标签

【输出格式】
只输出纯粹的续写内容，不要有任何开场白、结束语或其他多余文字。直接从故事断点处继续叙述，保持原文的视角和时态。

【角色信息】
${characterContext}
${personaSection}`;
}

// ==================== 第五步：格式化向量检索结果 ====================
// 数据来源：向量检索接口返回的 ContextVectorItem 数组（source、score、content）

export function formatVectorContextItems(items: ContextVectorItem[]): string {
  if (!items || items.length === 0) return '';

  console.log('[PromptBuilder] formatVectorContextItems - items:', items.map(item => ({
    source: item.source,
    content: item.content ? item.content.substring(0, 50) + '...' : '(empty)',
    metadata: item.metadata ? { entryName: item.metadata.entryName, source: item.metadata.source } : undefined,
  })));

  return items
    .map((item, index) => {
      const meta = item.metadata || {};
      // World book keyword match entries get special formatting
      if (meta.source === 'worldbook' || meta.matchType) {
        const entryName = meta.entryName || meta.entryComment || '世界书条目';
        const matchedKeys = meta.matchedKeys && meta.matchedKeys.length > 0 ? meta.matchedKeys.join(', ') : '';
        const header = matchedKeys 
          ? `[相关背景 ${index + 1}] ${entryName} (触发关键词: ${matchedKeys})`
          : `[相关背景 ${index + 1}] ${entryName}`;
        console.log(`[PromptBuilder] Formatting worldbook item ${index+1}: ${header}, content length=${item.content?.length || 0}`);
        return `${header}\n${item.content}`;
      }
      // Vector retrieval entries
      return `[相关上下文 ${index + 1}] (来源: ${item.source}, 相关性: ${(item.score * 100).toFixed(1)}%)\n${item.content}`;
    })
    .join('\n\n');
}

// ==================== 第六步：将向量上下文追加到提示词末尾 ====================
// 数据来源：第四步（基础任务提示词）+ 第五步（向量检索结果）

export async function buildFinalSystemPrompt(
  systemPrompt: string,
  vectorContextItems: ContextVectorItem[],
  memoryTableData?: string,
  organizeMode?: 'sync' | 'async',
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> }
): Promise<string> {
  console.log('[PromptBuilder] buildFinalSystemPrompt 开始:');
  console.log('  - systemPrompt 长度:', systemPrompt.length);
  console.log('  - vectorContextItems 数量:', vectorContextItems?.length || 0);
  console.log('  - memoryTableData 参数是否有值:', !!memoryTableData);
  console.log('  - memoryTableData 参数长度:', memoryTableData?.length || 0);
  if (memoryTableData) {
    console.log('  - memoryTableData 参数内容预览:', memoryTableData.substring(0, 100));
  }
  console.log('  - organizeMode:', organizeMode);
  console.log('  - tableStructure 是否有值:', !!tableStructure);
  console.log('  - tableStructure sheets:', tableStructure?.sheets);
  
  let result = systemPrompt;

  // 追加向量检索结果
  if (vectorContextItems && vectorContextItems.length > 0) {
    const vectorContextSection = formatVectorContextItems(vectorContextItems);
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 1：相关背景知识】（以下为从知识库检索的相关背景信息，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += vectorContextSection;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 1 结束 - 以上背景知识仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 向量上下文已追加, 追加后长度:', result.length);
  }

  // 追加记忆表格数据
  if (memoryTableData && memoryTableData.trim()) {
    console.log('  - memoryTableData 非空, 开始追加...');
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 2：记忆表格数据】（以下为已记录的记忆表格，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += memoryTableData;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 2 结束 - 以上记忆表格数据仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 记忆表格数据已追加, 最终长度:', result.length);
    console.log('  - 最终末尾 300 字符:', result.substring(Math.max(0, result.length - 300)));
  } else {
    console.log('  - memoryTableData 为空或 undefined, 跳过追加');
    console.log('    - memoryTableData === undefined:', memoryTableData === undefined);
    console.log('    - memoryTableData === "":', memoryTableData === '');
    console.log('    - memoryTableData?.trim():', memoryTableData?.trim());
  }

  // 异步整理模式：将完整指令拼接到 system prompt 末尾
  if (organizeMode === 'async') {
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 3：记忆表格异步整理指令】（以下为系统指令，不是对话内容，请严格按照要求执行）`;
    result += `\n═══════════════════════════════════════════════════════`;
    
    const asyncInstructions = await buildAsyncTableOrganizeInstructions(memoryTableData, tableStructure);
    result += asyncInstructions;
    
    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 3 结束 - 以上为系统指令】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 异步整理指令已追加到 system prompt, 最终长度:', result.length);
  }

  return result;
}

/**
 * 构建异步表格整理指令（完整版，与同步模式规则一致）
 * 固定指令部分从模板系统获取（creative-chat.async-table-instructions），
 * 动态部分（表格结构、当前表格状态、最终提醒）由代码构建并追加。
 */
export async function buildAsyncTableOrganizeInstructions(
  memoryTableData?: string,
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> }
): Promise<string> {
  // 从模板系统获取固定指令部分
  let baseInstructions = '';
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.async-table-instructions', {});
    if (promptResult.success && promptResult.data) {
      baseInstructions = promptResult.data.systemPrompt;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取异步表格指令模板失败，使用硬编码回退:', e);
  }

  // 如果模板获取失败，使用硬编码回退（固定指令部分）
  if (!baseInstructions) {
    baseInstructions = `\n\n【强制要求 - MANDATORY】
无论你输出了什么对话内容，你【必须】在回复的最后生成tableEdit命令标签。
这是系统功能的核心部分，不生成会导致数据处理失败！
即使没有新信息需要提取，也要生成空标签：<!--  <tableEdit>
</tableEdit> -->

【输出顺序 - 必须遵守】
1. 先输出完整的角色对话内容
2. 对话结束后换行，在文本末尾追加表格整理命令
3. 【最终确认】在输出结束前，检查是否已包含tableEdit标签，如果没有请立即生成

【tableEdit命令格式 - 严格遵循】
你需要将操作指令放在<tableEdit>标签内，使用HTML注释格式：

<!--  <tableEdit>
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
</tableEdit> -->

参数说明：
- 表格索引：从1开始，对应模板中页签的顺序
- 行索引：从1开始，对应该表格中的数据行索引
- 字段索引：从1开始，对应该表格表头的字段索引
- 每个表格的字段结构固定为：[1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增，通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成，需具有语义且保持一致性

示例(以角色表格为例，字段为[1:流水号,2:唯一id,3:角色名,4:身份,5:关系]):
- insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官","5":"主角"})
  → 在第1个表格新增一行：唯一id=zhudi_001,角色名=朱迪·霍普斯,身份=警官,关系=主角
- updateRow(1, 2, {"4":"警长"})
  → 修改第1个表格的第2条数据，只更新身份字段为"警长"
- deleteRow(1, 3)
  → 删除第1个表格的第3条数据

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段


增量更新决策流程：
1. 从当前消息中识别实体（角色、物品、地点、事件等）
2. 检查表格中是否已有该实体（通过唯一ID或关键特征匹配）
   a. 首先在"唯一ID快速查找索引"中查找
   b. 如果没找到，在"当前已有数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一ID=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(1, 1, {"4":"警长"})  ← 只更新身份字段
- 错误操作：insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**
   - 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID zhudi_001
   - 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
   - 代词回指："她"/"他"/"那个女孩" → 根据上下文指向判断对应的实体
   - 关键判断原则：如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID

3. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一


【约束规则】
- 标签必须用 <!--  <tableEdit> 开头，</tableEdit> --> 结尾，必须位于回复文本最后
- 标签内只含tableEdit命令，不含其他内容
- 只提取当前消息中明确提到的信息，不要造
- 已存在实体必须用updateRow，禁止insertRow重复插入
- 所有值必须是字符串类型，用双引号包裹
- 表格索引、行索引必须是数字，不是字符串


【错误格式示例 - 绝对禁止】

✗ insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(1, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

✗ insertRow("1", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

 insertRow(2, {"2":"judy_badge","3":"警官徽章","4":"身份证明"})  ← 把物品放到角色表格！
  错误原因：警官徽章是物品不是角色，应该用insertRow(4, ...)放到物品表格（索引4），角色表格（索引2）只放人物

 updateRow(1, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串


【表格分类快速判断】
在生成任何insertRow命令前，先问自己："这个实体是什么类型？"
- 是人/角色/生物？ → 角色表格（索引2）
- 是物品/装备/道具？ → 物品表格（索引4）
- 是时间/地点？ → 时空表格（索引1）
- 是事件/互动？ → 社交表格（索引3）或事件表格（索引5）
- 如果不确定，记住：角色持有的物品仍然是物品，不是角色！


【输出要求】
1. 只分析当前这条消息，不要分析其他消息
2. 从当前消息中提取关键信息，生成对应的tableEdit命令
3. 将命令放在<tableEdit>标签内
4. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
5. 确保使用正确的表格索引、行索引和字段索引
6. 参考现有表格数据，避免重复添加相同信息
7. 识别变体称呼，使用唯一ID保持一致性
8. 只提取当前消息中明确提到的信息，不要臆造
9. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
10. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"当前已有数据"中通过名称相似度查找
11. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
12. 【分类规则】人物/角色 → 角色表格(索引2)；物品/装备/道具 → 物品表格(索引4)；时间/地点 → 时空表格(索引1)；事件/互动 → 社交表格(索引3)或事件表格(索引5)
`;
  }

  // 动态追加表格结构信息（不纳入模板）
  let instructions = `\n\n` + baseInstructions;

  // 追加表格模板结构信息
  if (tableStructure && tableStructure.sheets && tableStructure.sheets.length > 0) {
    instructions += `\n\n【表格模板结构】\n`;
    instructions += `当前系统配置的模板包含以下表格（请严格按照此结构提取信息）：\n\n`;
    tableStructure.sheets.forEach((sheetName: string, index: number) => {
      const headers = tableStructure.headers?.[sheetName] || [];
      const description = tableStructure.descriptions?.[sheetName] || '';
      // 提取自定义字段（排除流水号和唯一id）
      const customFields = headers.filter((h: string) => h !== '流水号' && h !== '唯一id');
      instructions += `${index + 1}. **${sheetName}**\n`;
      if (description) {
        instructions += `   - 表格用途：${description}\n`;
      }
      instructions += `   - 字段结构：[1:流水号, 2:唯一id`;
      customFields.forEach((field: string, fi: number) => {
        instructions += `, ${fi + 3}:${field}`;
      });
      instructions += `]\n`;
      instructions += `   - 需要提取的字段：${customFields.join('、')}\n\n`;
    });
    instructions += `\n`;
  } else {
    // 默认模板结构（备用）
    instructions += `\n\n【表格模板结构】\n`;
    instructions += `当前系统使用默认模板，包含以下表格（请严格按照此结构提取信息）：\n\n`;
    instructions += `1. **时空表格**\n`;
    instructions += `   - 表格用途：记录对话中提到的**时间和地点信息**（注意：只记录时间/地点，不包括在这些时间地点发生的角色行为或物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:日期, 4:时间, 5:地点, 6:此地角色]\n`;
    instructions += `   - 需要提取的字段：日期、时间、地点、此地角色\n`;
    instructions += `   - **分类判断**：如果实体是"时间"（日期/时刻）、"地点"（位置/场所），放入此表格；如果是角色/物品/事件，则分别放入对应表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "2024年1月15日晚上8点" → 放入时空表格（索引1）\n`;
    instructions += `     * "纽约中央公园" → 放入时空表格（索引1）\n`;
    instructions += `     * "朱迪在中央公园" → 地点放入时空表格，角色放入角色表格\n\n`;
    instructions += `2. **角色表格**\n`;
    instructions += `   - 表格用途：记录对话中出现的**人物角色**（注意：只记录真实的人物/生物/角色，不包括他们持有的物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:角色名, 4:身份, 5:关系, 6:特征, 7:备注]\n`;
    instructions += `   - 需要提取的字段：角色名、身份、关系、特征、备注\n`;
    instructions += `   - **分类判断**：如果实体是"人"、"角色"、"生物"、"动物"等**有生命的存在**，放入此表格；如果是无生命的物品/装备/道具，则必须放入物品表格\n\n`;
    instructions += `3. **社交表格**\n`;
    instructions += `   - 表格用途：记录对话中发生的**社交互动和日常事件**（注意：记录人与人之间的互动、对话、关系变化，不包括重大事件或物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:时间, 4:参与人, 5:事件, 6:结果, 7:备注]\n`;
    instructions += `   - 需要提取的字段：时间、参与人、事件、结果、备注\n`;
    instructions += `   - **分类判断**：如果实体是"互动行为"（对话/见面/合作/冲突）、"关系变化"、"日常活动"，放入此表格；如果是重大事件（如犯罪/事故/任务），则放入事件表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "朱迪和尼克一起调查案件" → 放入社交表格（索引3）\n`;
    instructions += `     * "朱迪向牛局长汇报工作" → 放入社交表格（索引3）\n`;
    instructions += `     * "朱迪获得了警官徽章" → 物品放入物品表格，获得行为可放入社交表格\n\n`;
    instructions += `4. **物品表格**\n`;
    instructions += `   - 表格用途：记录对话中提到的**物品、装备、道具等**（注意：角色持有的物品、装备、道具等必须放在此表格，不要放入角色表格）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:物品名, 4:类型, 5:描述, 6:状态, 7:备注/持有人]\n`;
    instructions += `   - 需要提取的字段：物品名、类型、描述、状态、备注/持有人\n`;
    instructions += `   - **分类判断**：如果实体是"物品"、"装备"、"道具"、"工具"、"武器"、"服装"、"饰品"等**无生命的物体**，放入此表格；如果实体是人物/角色，则放入角色表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "朱迪的警官徽章" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * "胡萝卜录音笔" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * "防狼喷雾" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * 持有人信息应放在"备注/持有人"字段中，例如：{"3":"警官徽章","4":"身份证明","5":"朱迪的警官身份象征","6":"完好","7":"朱迪持有"}\n\n`;
    instructions += `5. **事件表格**\n`;
    instructions += `   - 表格用途：记录对话中发生的**重要事件**（注意：记录具有重大影响的事件，如犯罪/事故/任务/转折点，不包括日常社交互动）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:时间, 4:事件名, 5:参与人, 6:描述, 7:影响, 8:备注]\n`;
    instructions += `   - 需要提取的字段：时间、事件名、参与人、描述、影响、备注\n`;
    instructions += `   - **分类判断**：如果实体是"重大事件"（犯罪/事故/任务/转折点/冲突爆发），放入此表格；如果是日常互动/对话/关系变化，则放入社交表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "中央公园发生抢劫案" → 放入事件表格（索引5）\n`;
    instructions += `     * "朱迪成功破获重大案件" → 放入事件表格（索引5）\n`;
    instructions += `     * "朱迪和尼克一起吃午饭" → 放入社交表格（索引3），不是事件表格！\n\n`;
  }

  // 追加当前表格状态
  if (memoryTableData && memoryTableData.trim()) {
    instructions += `\n【当前表格状态】\n${memoryTableData}\n`;
  } else {
    instructions += `\n【当前表格状态】当前无表格数据。发现新实体请用insertRow创建。\n`;
  }

  instructions += `\n【最终提醒】请务必在回复最后生成tableEdit标签，这是强制要求！\n`;

  return instructions;
}

// ==================== 统一入口：一键构建完整 System Prompt ====================
// 完整拼接流程：第一步→第二步→第三步→第四步→第五步→第六步

export async function buildSystemPrompt(
  characterInfo: CharacterInfoForPrompt,
  selectedPersona: UserPersona | undefined,
  promptType: 'dialogue' | 'continuation',
  vectorContextItems: ContextVectorItem[],
  memoryTableData?: string,
  organizeMode?: 'sync' | 'async',
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> }
): Promise<string> {
  // 第四步：根据任务类型构建基础提示词
  const systemPrompt = promptType === 'continuation'
    ? await buildContinuationPrompt(characterInfo, selectedPersona, organizeMode)
    : await buildDialoguePrompt(characterInfo, selectedPersona, organizeMode);

  // 第六步：将向量上下文和记忆表格数据追加到提示词末尾
  return await buildFinalSystemPrompt(systemPrompt, vectorContextItems, memoryTableData, organizeMode, tableStructure);
}
