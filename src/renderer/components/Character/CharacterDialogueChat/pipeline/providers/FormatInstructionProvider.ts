/**
 * 格式指令 Provider — FormatInstructionProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::injectDialogueFormatInstructions 的"追加"部分。
 *
 * ⚠️【重点标记】修复 Bug：系统提示词模板可能来自数据库旧版
 * （mergeNewDefaultTemplates 不更新已有模板），旧模板写着"不要添加
 * 任何额外的标记或说明"，导致 AI 不使用 *动作* 格式。
 *
 * 原函数包含"移除旧版禁止标记"和"追加格式指令"两部分。
 * 移除逻辑已迁移到 DialogueInstructionProvider（需处理模板输出），
 * 本 Provider 负责统一追加格式指令文本，对所有管线模式生效。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';

/**
 * 格式指令文本（迁移自 injectDialogueFormatInstructions 的追加部分）。
 */
const FORMAT_INSTRUCTION = `\n【输出格式要求】
- 角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹
- 角色的动作、神态、心理活动等非对话描写必须用星号包裹（如 *微微一笑* 或 *她低下头，脸微微泛红*）
- 对话与动作描写可自然交替，像真实的人在说话一样
- 星号 *动作描写* 是格式标记，不属于"额外标记或说明"`;

export class FormatInstructionProvider implements PromptProvider {
  readonly name = 'FormatInstructionProvider';
  readonly priority = 450;
  readonly section = 'suffix' as const;

  isActive(_context: DialoguePipelineContext): boolean {
    return true;
  }

  async build(_context: DialoguePipelineContext): Promise<string> {
    return FORMAT_INSTRUCTION;
  }
}
