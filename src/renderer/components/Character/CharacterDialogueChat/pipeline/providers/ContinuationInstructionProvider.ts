/**
 * 续写指令 Provider — ContinuationInstructionProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildContinuationPrompt。
 * 使用模板系统（creative-chat.continuation）构建续写模式的任务指令。
 *
 * 设计说明：与 DialogueInstructionProvider 对称，角色上下文和人设段落由
 * CharacterContextProvider / PersonaProvider 独立提供，本 Provider 仅构建指令部分。
 * 续写去重约束（continue_nudge_prompt）在指令末尾追加。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';
import { buildContinueNudgePrompt } from '../../PromptBuilder';

export class ContinuationInstructionProvider implements PromptProvider {
  readonly name = 'ContinuationInstructionProvider';
  readonly priority = 300;
  readonly section = 'instruction' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.pipelineMode === 'continuation';
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

    // 续写去重约束（Spec: optimize-chat-ai-intelligence / Task 8.1）
    const nudgeSection = `\n\n【续写去重约束】\n${buildContinueNudgePrompt()}`;

    // 从模板系统获取提示词（传入空的 character_context / persona_section，避免与独立 Provider 重复）
    try {
      const promptResult = await window.electronAPI.prompt.build('creative-chat.continuation', {
        char_name: charName,
        user_name: userName,
        table_edit_instruction: tableEditInstruction,
        character_context: '',
        persona_section: ''
      });
      if (promptResult.success && promptResult.data) {
        return promptResult.data.systemPrompt + nudgeSection;
      }
    } catch (e) {
      console.error('[ContinuationInstructionProvider] 获取续写模式模板失败，使用硬编码回退:', e);
    }

    // 回退：使用硬编码内容（不含角色信息段落）+ 续写去重约束
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
只输出纯粹的续写内容，不要有任何开场白、结束语或其他多余文字。直接从故事断点处继续叙述，保持原文的视角和时态。${nudgeSection}`;
  }
}
