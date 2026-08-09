/**
 * TableEditPlugin — 表格编辑命令后处理插件
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 *
 * 检测 AI 响应中的表格编辑命令标签（<tableEdit>...</tableEdit>），
 * 提取原始命令文本写入 context.tableEditCommands，并从内容中剥离标签。
 *
 * 注意：本插件仅负责检测、提取和剥离标签，实际的命令解析与执行
 * 由 LogicEngine 的 ExecuteTableEditTask 通过 electronAPI.memory.parseTableEdit
 * 完成。此处将原始命令文本存入 TableEditCommand.rawCommand 字段。
 *
 * 迁移自 CharacterDialogueChat.hooks.ts::onComplete 中的 tableEdit 检测逻辑。
 */

import type { PostProcessPlugin, DialoguePipelineContext, DetectedIntent, TableEditCommand } from '../pipeline.types';
import { AIIntentRecognizer } from '../AIIntentRecognizer';

export class TableEditPlugin implements PostProcessPlugin {
  readonly name = 'TableEditPlugin';
  readonly priority = 400;

  /** AIIntentRecognizer 实例，用于检测 table_edit 意图 */
  private readonly recognizer: AIIntentRecognizer;

  constructor() {
    this.recognizer = new AIIntentRecognizer();
  }

  /**
   * 检测内容中是否包含表格编辑命令标签。
   * 使用 AIIntentRecognizer 检测 'table_edit' 类型的意图。
   *
   * @param content 当前内容
   * @returns 包含 tableEdit 标签时返回 true
   */
  detect(content: string, _context: DialoguePipelineContext): boolean {
    if (!content) return false;
    const intents = this.recognizer.detect(content);
    return intents.some((i) => i.type === 'table_edit');
  }

  /**
   * 提取表格编辑命令并剥离标签。
   *
   * - 从检测到的 table_edit 意图中提取原始命令文本
   * - 写入 context.tableEditCommands（原始命令存入 rawCommand 字段，
   *   实际的结构化解析由 LogicEngine 的 ExecuteTableEditTask 完成）
   * - 使用 AIIntentRecognizer.stripIntents 剥离 tableEdit 标签
   *
   * @param content 当前内容
   * @param context 管线上下文
   * @returns 剥离 tableEdit 标签后的内容
   */
  process(content: string, context: DialoguePipelineContext): string {
    const intents = this.recognizer.detect(content);
    const tableEditIntents: DetectedIntent[] = intents.filter(
      (i) => i.type === 'table_edit',
    );

    if (tableEditIntents.length === 0) {
      return content;
    }

    // 将每个意图的原始命令文本转换为 TableEditCommand
    // 实际的结构化解析（insertRow/updateRow/deleteRow）由 LogicEngine 完成
    const commands: TableEditCommand[] = tableEditIntents.map((intent) => {
      const data = intent.data as { rawContent: string };
      return {
        // 占位类型，LogicEngine 解析后会替换为实际命令类型
        type: 'insertRow',
        tableIndex: 0,
        rawCommand: data.rawContent,
      };
    });

    context.tableEditCommands = commands;

    // 剥离 tableEdit 标签
    const result = this.recognizer.stripIntents(content, tableEditIntents);

    context.logs.push({
      level: 'info',
      stage: this.name,
      timestamp: Date.now(),
      message: `检测到 ${commands.length} 个 tableEdit 命令块，已剥离标签`,
    });

    return result;
  }
}
