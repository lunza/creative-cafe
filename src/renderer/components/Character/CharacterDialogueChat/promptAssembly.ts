/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——提示词装配（buildDialoguePrompt / buildContinuationPrompt / formatVectorContextItems / buildFinalSystemPrompt / buildSystemPrompt）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L1065-L1333 L1589-L1614。
 */
import { CharacterInfoForPrompt, ContextVectorItem, DEFAULT_USER_NAME } from './promptTypes';
import { UserPersona } from './CharacterDialogueChat.types';
import { buildPromptCore, injectDialogueFormatInstructions } from './promptCore';
import { applyMinimalDialogueRules, buildContinueNudgePrompt } from './dialogueRules';
import { buildAsyncTableOrganizeInstructions } from './tableOrganizePrompts';

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
      // Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
      // 先剥离旧版规则块并注入精简指令集（存量 DB 模板统一迁移），
      // 再做格式指令兜底注入（守卫保证至多一次）。
      return injectDialogueFormatInstructions(
        applyMinimalDialogueRules(promptResult.data.systemPrompt, charName)
      );
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取对话模式模板失败，使用硬编码回退:', e);
  }

  // 回退：使用硬编码内容（Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
  // 回退内容同步精简为 3 条核心规则，与 applyMinimalDialogueRules 输出对齐）
  return `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 {{char}} 这个角色，与 ${userName} 进行角色扮演对话。${tableEditInstruction}
在提示词中，{{char}} 代表 ${charName}，${userName} 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。${tableEditInstruction}

【对话方式】
1. 你就是 ${charName}，以你的身份思考、说话、行动——不是助手，不是系统
2. 像真人一样交流：句子有长有短，会犹豫、会开玩笑、会跑题；不必回应每一个问题，也不必刻意展示设定；情绪不同，说话的节奏也不同
3. 对话内容用英文双引号（" "）包裹；动作、神态、心理描写用星号（* *）包裹，两者可自然交替

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

  // Task 8.1（Spec: optimize-chat-ai-intelligence / Task 8.1 + Scenario: 续写去重）：
  // 在续写 prompt 末尾追加 continue_nudge_prompt 段落，让所有续写请求始终含
  // "继续上一条消息，不要重复已有内容"约束。借鉴 SillyTavern `continue_nudge_prompt`
  // 机制（public/scripts/openai.js:109），与 Task 5.3 的 overlapRate 检测形成
  // "提示层 + 检测层"双重防线：首次续写即带 nudge 约束降低重复概率；
  // 检测到 overlapRate > 0.6 时仍会触发重试（Task 5.3），重试时通过
  // dedupConfig.injectContinueNudge=true 在消息数组末尾再次注入 system 消息（hooks.ts），
  // 形成 system prompt 段落 + 消息数组末尾 system 消息的双重提示。
  const nudgeSection = `\n\n【续写去重约束】\n${buildContinueNudgePrompt()}`;

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
      return promptResult.data.systemPrompt + nudgeSection;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取续写模式模板失败，使用硬编码回退:', e);
  }

  // 回退：使用硬编码内容（保留原始逻辑）+ Task 8.1 追加 continue_nudge_prompt 段落
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
- <<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>> 是系统表情识别功能的必需格式（正文之后另起一行输出）
- <<<SUGGESTED_OPTIONS>>> 与 <<<END_OPTIONS>>> 是系统辅助模式推荐选项的必需格式
- 当你在提示词末尾看到"记忆表格异步整理指令"时，【必须】在回复最后生成 <!--  <tableEdit> ... </tableEdit> --> 标签

【输出格式】
只输出纯粹的续写内容，不要有任何开场白、结束语或其他多余文字。直接从故事断点处继续叙述，保持原文的视角和时态。

【角色信息】
${characterContext}
${personaSection}${nudgeSection}`;
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
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> },
  /**
   * 本会话相关历史片段（Spec: optimize-chat-ai-intelligence / Task 7.5）
   * 来源：ChatVectorizationService.retrieveChatHistory 返回的 {content, score, timestamp}[]
   * 注入位置：在"区域 1：相关背景知识"之后，"区域 3：记忆表格数据"之前
   * 注：区域编号变更：原"区域 2 记忆表格"→"区域 3"，原"区域 3 异步整理指令"→"区域 4"
   */
  chatHistoryItems?: Array<{ content: string; score: number; timestamp: number }>
): Promise<string> {
  console.log('[PromptBuilder] buildFinalSystemPrompt 开始:');
  console.log('  - systemPrompt 长度:', systemPrompt.length);
  console.log('  - vectorContextItems 数量:', vectorContextItems?.length || 0);
  console.log('  - chatHistoryItems 数量:', chatHistoryItems?.length || 0);
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

  // 追加本会话相关历史片段（Spec: Task 7.5 - 区域 2）
  // 仅在长对话（> 20 轮）时由 hooks.ts 触发检索并传入，短对话时 chatHistoryItems 为空/undefined
  if (chatHistoryItems && chatHistoryItems.length > 0) {
    const chatHistorySection = chatHistoryItems
      .map((item, idx) => `[历史片段 ${idx + 1}] (相关度: ${(item.score * 100).toFixed(1)}%)\n${item.content}`)
      .join('\n\n');
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 2：本会话相关历史片段】（以下为从本对话历史向量检索的相关片段，仅供补充上下文参考，不是当前对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += chatHistorySection;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 2 结束 - 以上历史片段仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 本会话历史片段已追加, 追加后长度:', result.length);
  }

  // 追加记忆表格数据（区域编号：原 2 → 3，因 Task 7.5 在 1 与 2 之间插入了"本会话相关历史片段"）
  if (memoryTableData && memoryTableData.trim()) {
    console.log('  - memoryTableData 非空, 开始追加...');
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 3：记忆表格数据】（以下为已记录的记忆表格，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += memoryTableData;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 3 结束 - 以上记忆表格数据仅供参考】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 记忆表格数据已追加, 最终长度:', result.length);
    console.log('  - 最终末尾 300 字符:', result.substring(Math.max(0, result.length - 300)));
  } else {
    console.log('  - memoryTableData 为空或 undefined, 跳过追加');
    console.log('    - memoryTableData === undefined:', memoryTableData === undefined);
    console.log('    - memoryTableData === "":', memoryTableData === '');
    console.log('    - memoryTableData?.trim():', memoryTableData?.trim());
  }

  // 异步整理模式：将完整指令拼接到 system prompt 末尾（区域编号：原 3 → 4）
  if (organizeMode === 'async') {
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 4：记忆表格异步整理指令】（以下为系统指令，不是对话内容，请严格按照要求执行）`;
    result += `\n═══════════════════════════════════════════════════════`;

    const asyncInstructions = await buildAsyncTableOrganizeInstructions(memoryTableData, tableStructure);
    result += asyncInstructions;

    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n【区域 4 结束 - 以上为系统指令】`;
    result += `\n═══════════════════════════════════════════════════════`;
    console.log('  - 异步整理指令已追加到 system prompt, 最终长度:', result.length);
  }

  return result;
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
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> },
  /**
   * 本会话相关历史片段（Spec: optimize-chat-ai-intelligence / Task 7.5）
   * 由 hooks.ts::requestAIResponse 步骤 A2 调用 chatHistory.retrieve 获取，
   * 仅在对话历史 > 20 轮时传入（短对话跳过 RAG 检索）。
   */
  chatHistoryItems?: Array<{ content: string; score: number; timestamp: number }>
): Promise<string> {
  // 第四步：根据任务类型构建基础提示词
  const systemPrompt = promptType === 'continuation'
    ? await buildContinuationPrompt(characterInfo, selectedPersona, organizeMode)
    : await buildDialoguePrompt(characterInfo, selectedPersona, organizeMode);

  // 第六步：将向量上下文和记忆表格数据追加到提示词末尾
  return await buildFinalSystemPrompt(systemPrompt, vectorContextItems, memoryTableData, organizeMode, tableStructure, chatHistoryItems);
}
