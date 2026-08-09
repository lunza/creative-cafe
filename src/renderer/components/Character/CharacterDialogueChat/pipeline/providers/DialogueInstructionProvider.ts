/**
 * 对话指令 Provider — DialogueInstructionProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildDialoguePrompt。
 * 使用模板系统（creative-chat.dialogue）构建对话模式的任务指令。
 *
 * 设计说明：角色上下文和人设段落由 CharacterContextProvider / PersonaProvider
 * 独立提供，本 Provider 仅构建指令部分（任务说明、约束规则、输出格式等），
 * 向模板传入空的 character_context / persona_section 以避免内容重复。
 *
 * 格式指令注入（injectDialogueFormatInstructions 的"追加"部分）由
 * FormatInstructionProvider 统一处理，本 Provider 仅执行"移除旧版禁止标记"清理。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';

/**
 * 移除旧版模板中"不要添加任何额外的标记或说明"语句。
 *
 * ⚠️【重点标记】修复 Bug：系统提示词模板可能来自数据库旧版
 * （mergeNewDefaultTemplates 不更新已有模板），旧模板写着"不要添加
 * 任何额外的标记或说明"，导致 AI 不使用 *动作* 格式。
 * 迁移自 PromptBuilder.ts::injectDialogueFormatInstructions 的移除部分。
 */
function removeOldFormatProhibition(systemPrompt: string): string {
  return systemPrompt.replace(
    /不要添加任何额外的标记或说明[。\n]?/g,
    ''
  );
}

export class DialogueInstructionProvider implements PromptProvider {
  readonly name = 'DialogueInstructionProvider';
  readonly priority = 300;
  readonly section = 'instruction' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.pipelineMode === 'dialogue';
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const { characterInfo, selectedPersona, sessionConfig } = context;
    const charName = characterInfo.characterCardName || 'Character';
    const userName = selectedPersona?.name || 'User';
    const organizeMode = sessionConfig.memoryTableOrganizeMode;

    // 根据 organizeMode 生成动态任务说明
    const tableEditInstruction = organizeMode === 'async'
      ? `并在续写完成后通过tableEdit完成数据整理。系统将在提示词末尾提供详细的表格整理指令，请严格按照指令要求在回复末尾生成详细的tableEdit标签，认真解析对话内容（时空、角色、社交、物品、事件等），不要忽略任何细节。`
      : '';

    // 从模板系统获取提示词（传入空的 character_context / persona_section，避免与独立 Provider 重复）
    try {
      const promptResult = await window.electronAPI.prompt.build('creative-chat.dialogue', {
        char_name: charName,
        user_name: userName,
        table_edit_instruction: tableEditInstruction,
        character_context: '',
        persona_section: ''
      });
      if (promptResult.success && promptResult.data) {
        // 仅执行旧版禁止标记移除，格式指令追加由 FormatInstructionProvider 统一处理
        return removeOldFormatProhibition(promptResult.data.systemPrompt);
      }
    } catch (e) {
      console.error('[DialogueInstructionProvider] 获取对话模式模板失败，使用硬编码回退:', e);
    }

    // 回退：使用硬编码内容（不含角色信息段落，由 CharacterContextProvider / PersonaProvider 提供）
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
8. 【格式要求】角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑* 或 *她低下头，脸微微泛红*），对话与动作可自然交替

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
- 星号 *动作描写* 是格式标记，不属于"额外标记或说明"

【输出格式】
直接输出角色的对话和行动描写。对话内容用英文双引号（" "）包裹，动作和神态描写用星号（* *）包裹。像真实的人在说话一样自然交替。`;
  }
}
