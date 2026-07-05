/**
 * 游戏模式 Prompt 构建器
 *
 * 构建 system prompt 与 user prompt，供 GameNarrativeService 调用
 * AIService.streamChatAPI 时使用。
 *
 * 设计原则：
 * - system prompt 包含游戏规则、输出格式要求、tableEdit 协议说明、表格 schema
 *   描述（仅在 async 模式下）；user prompt 包含剧情上下文、表格快照、玩家行动。
 * - tableEdit 协议严格对齐
 *   `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`
 *   的 buildAsyncTableOrganizeInstructions，确保 AI 输出可被
 *   GameTableEditParser 正确解析。
 * - 模板可提供额外 system prompt 片段（templateSystemPrompt，如经营模板的
 *   经济规则），由本类拼接到 system prompt 末尾。
 */

import type {
  GameMeta,
  GameTableSchema,
  GameTableData,
  GameNarrativeMessage,
  GameLocalConfig
} from '../../../shared/types/game.types';

// ==================== 配置常量 ====================

/**
 * user prompt 中携带的最近剧情消息数
 *
 * 太多会超出上下文预算，太少会丢失剧情连贯性。
 * 10 条对话约对应 5 个回合，对大多数游戏类型足够。
 */
const RECENT_NARRATIVE_MESSAGE_COUNT = 10;

/**
 * user prompt 中每个 sheet 最多展示的行数
 *
 * 超过的行数会以 "... (还有 N 行未展示)" 提示，避免上下文爆炸。
 */
const MAX_ROWS_PER_SHEET_IN_PROMPT = 20;

// ==================== Prompt 构建器实现 ====================

export class GamePromptBuilder {
  /**
   * 构建 system prompt
   *
   * 结构：
   * 1. 角色定位（你是 XX 游戏的旁白 AI）
   * 2. 游戏规则（gameMeta.gameplay 提供的玩法说明）
   * 3. 输出格式要求（先输出剧情文本，末尾附带 <tableEdit> 标签）
   * 4. tableEdit 协议说明（仅 async 模式）
   * 5. 表格 schema 描述（仅 async 模式 且 schema 非空）
   * 6. 模板额外 system prompt 片段（templateSystemPrompt，如有）
   *
   * @param gameMeta 游戏元数据
   * @param tableSchema 表格 schema（用于协议说明；如未提供则使用空 schema）
   * @param config 游戏本地配置（决定 organizeMode 是否启用 tableEdit 协议）
   * @param templateSystemPrompt 模板提供的额外 system prompt 片段
   */
  buildSystemPrompt(
    gameMeta: GameMeta,
    tableSchema: GameTableSchema | undefined,
    config: GameLocalConfig,
    templateSystemPrompt?: string
  ): string {
    const sections: string[] = [];

    // 1. 角色定位
    sections.push(this.buildRoleSection(gameMeta));

    // 2. 游戏规则
    sections.push(this.buildGameplaySection(gameMeta));

    // 3. 输出格式要求
    sections.push(this.buildOutputFormatSection());

    // 4 & 5. tableEdit 协议 + schema 描述（仅 async 模式）
    if (config.organizeMode === 'async') {
      sections.push(this.buildTableEditProtocolSection());
      sections.push(this.buildSchemaSection(tableSchema));
    }

    // 6. 模板额外 system prompt
    if (templateSystemPrompt && templateSystemPrompt.trim().length > 0) {
      sections.push(this.buildTemplateSection(templateSystemPrompt));
    }

    return sections.filter(s => s.trim().length > 0).join('\n\n');
  }

  /**
   * 构建 user prompt
   *
   * 结构：
   * 1. 当前剧情上下文（最近 N 条叙事消息）
   * 2. 当前表格数据快照（按 sheet 列出，每 sheet 限制最多 20 行）
   * 3. 玩家行动
   * 4. 提醒 AI 在回复末尾生成 tableEdit 标签（仅 async 模式）
   *
   * @param userAction 玩家行动
   * @param narrativeLog 剧情日志
   * @param tableData 当前表格数据（可能为 null 表示尚未初始化）
   * @param tableSchema 表格 schema（用于列头提示）
   * @param currentTurn 当前回合（可选，回合制游戏使用）
   */
  buildNarrativePrompt(
    userAction: string,
    narrativeLog: GameNarrativeMessage[],
    tableData: GameTableData | null,
    tableSchema: GameTableSchema | undefined,
    currentTurn?: number
  ): string {
    const sections: string[] = [];

    // 1. 当前回合（如有）
    if (currentTurn !== undefined && currentTurn !== null) {
      sections.push(`【当前回合】第 ${currentTurn} 回合`);
    }

    // 2. 剧情上下文
    sections.push(this.buildNarrativeContextSection(narrativeLog));

    // 3. 表格数据快照
    sections.push(this.buildTableSnapshotSection(tableData, tableSchema));

    // 4. 玩家行动
    sections.push(this.buildUserActionSection(userAction));

    return sections.filter(s => s.trim().length > 0).join('\n\n');
  }

  // ==================== System Prompt 子段 ====================

  private buildRoleSection(gameMeta: GameMeta): string {
    return [
      '【角色定位】',
      `你是游戏《${gameMeta.title}》的旁白 AI。`,
      gameMeta.subtitle ? `游戏简介：${gameMeta.subtitle}` : '',
      `你的职责是根据玩家行动推进剧情发展，描述场景、NPC 反应、事件结果，并维护游戏状态表格。`
    ].filter(line => line.length > 0).join('\n');
  }

  private buildGameplaySection(gameMeta: GameMeta): string {
    if (!gameMeta.gameplay || gameMeta.gameplay.trim().length === 0) {
      return '';
    }
    return `【游戏规则】\n${gameMeta.gameplay.trim()}`;
  }

  private buildOutputFormatSection(): string {
    return [
      '【输出格式要求】',
      '1. 先输出完整的剧情叙事文本（场景描述、对话、事件结果等）',
      '2. 叙事结束后，根据需要修改的表格内容，在回复末尾追加 <tableEdit> 命令标签',
      '3. tableEdit 标签必须位于回复最末尾，且使用 HTML 注释包裹格式',
      '4. 如果当前剧情不需要修改任何表格，仍然需要生成空的 <tableEdit></tableEdit> 标签',
      '5. 不要在叙事文本中泄露 tableEdit 协议的存在，它对玩家应是透明的'
    ].join('\n');
  }

  /**
   * tableEdit 协议说明
   *
   * 对齐 CharacterDialogueChat/PromptBuilder.ts 的 buildAsyncTableOrganizeInstructions，
   * 但精简为游戏场景所需的协议部分（去除角色对话特有的变体称呼识别等内容）。
   */
  private buildTableEditProtocolSection(): string {
    return [
      '【tableEdit 命令协议 - 必须严格遵守】',
      '',
      '标签格式（必须使用 HTML 注释包裹）：',
      '```',
      '<!--  <tableEdit>',
      'insertRow(表格索引, {"字段索引":"值", ...})',
      'updateRow(表格索引, 行索引, {"字段索引":"值", ...})',
      'deleteRow(表格索引, 行索引)',
      '</tableEdit> -->',
      '```',
      '',
      '参数说明：',
      '- 表格索引（sheetIndex）：从 1 开始，对应下方【表格模板结构】中列出的 sheet 顺序',
      '- 行索引（rowIndex）：从 1 开始，对应当前 sheet 中的数据行号（仅 updateRow/deleteRow 需要）',
      '- 字段索引（colIndex）：从 1 开始，对应当前 sheet 的列头顺序（key 为字符串形式的数字）',
      '- 所有值必须是字符串类型，用双引号包裹',
      '- 表格索引、行索引必须是数字字面量，不要加引号',
      '',
      '示例（假设角色表格为第 1 个 sheet，字段为 [1:流水号, 2:唯一id, 3:角色名, 4:身份]）：',
      '- insertRow(1, {"2":"zhudi_001","3":"朱迪","4":"警官"})',
      '  → 在第 1 个 sheet 新增一行：唯一id=zhudi_001, 角色名=朱迪, 身份=警官',
      '- updateRow(1, 2, {"4":"警长"})',
      '  → 修改第 1 个 sheet 的第 2 行，只更新身份字段为"警长"',
      '- deleteRow(1, 3)',
      '  → 删除第 1 个 sheet 的第 3 行',
      '',
      '【增量更新策略 - 重中之重】',
      '这是增量更新操作，不是从头整理！必须遵循以下规则：',
      '1. **重复性检查**：生成 insertRow 前，必须先在「当前表格数据快照」中查找相同或高度相似的实体',
      '   - 如果实体已存在 → 使用 updateRow 更新该行',
      '   - 如果实体不存在 → 使用 insertRow 新增',
      '2. **只更新变化部分**：使用 updateRow 时，只更新发生变化的字段，不要重复填写未变化的字段',
      '3. **避免重复插入**：绝不要为已存在的实体生成新的 insertRow 命令',
      '4. **唯一 ID 一致性**：同一实体在整局游戏中应保持相同的唯一 ID（字段 2）',
      '5. **谨慎删除**：仅在实体确实不再相关时使用 deleteRow',
      '',
      '【约束规则】',
      '- 标签必须用 <!--  <tableEdit> 开头，</tableEdit> --> 结尾',
      '- 标签必须位于回复文本最后',
      '- 标签内只含 tableEdit 命令，不含其他内容',
      '- 只提取当前玩家行动中明确提到的信息，不要臆造',
      '- 已存在实体必须用 updateRow，禁止 insertRow 重复插入'
    ].join('\n');
  }

  /**
   * 表格 schema 描述
   *
   * 列出所有 sheet 的顺序、列头、用途描述，供 AI 在生成 tableEdit 命令时参考。
   * 格式对齐 buildAsyncTableOrganizeInstructions 中的「表格模板结构」段。
   */
  private buildSchemaSection(schema: GameTableSchema | undefined): string {
    if (!schema || !schema.sheets || schema.sheets.length === 0) {
      return [
        '【表格模板结构】',
        '当前游戏未配置表格 schema。如玩家行动涉及状态变更，请仅在叙事中体现，不要生成 tableEdit 命令。'
      ].join('\n');
    }

    const lines: string[] = [
      '【表格模板结构】',
      '当前游戏配置了以下表格（请严格按照此结构生成 tableEdit 命令）：',
      ''
    ];

    schema.sheets.forEach((sheetName, index) => {
      const headers = schema.headers?.[sheetName] || [];
      const description = schema.sheetDescriptions?.[sheetName] || '';

      lines.push(`${index + 1}. **${sheetName}** (表格索引=${index + 1})`);
      if (description) {
        lines.push(`   - 表格用途：${description}`);
      }
      if (headers.length > 0) {
        const headerList = headers
          .map((h, i) => `${i + 1}:${h}`)
          .join(', ');
        lines.push(`   - 字段结构：[${headerList}]`);
      }
      lines.push('');
    });

    return lines.join('\n').trimEnd();
  }

  private buildTemplateSection(templateSystemPrompt: string): string {
    return `【模板额外规则】\n${templateSystemPrompt.trim()}`;
  }

  // ==================== User Prompt 子段 ====================

  /**
   * 构建剧情上下文段
   *
   * 截取最近 N 条叙事消息，按时间顺序排列。
   * 仅展示 user 与 assistant 消息（system 消息通常为系统提示，可选择性展示）。
   */
  private buildNarrativeContextSection(narrativeLog: GameNarrativeMessage[]): string {
    if (!narrativeLog || narrativeLog.length === 0) {
      return '【剧情上下文】\n（暂无历史剧情，这是游戏的开始）';
    }

    const recent = narrativeLog.slice(-RECENT_NARRATIVE_MESSAGE_COUNT);
    const lines: string[] = ['【剧情上下文】'];

    if (narrativeLog.length > recent.length) {
      lines.push(`（已省略较早的 ${narrativeLog.length - recent.length} 条消息）`);
    }

    for (const msg of recent) {
      const speaker = msg.speakerName || this.roleLabel(msg.role);
      const turnPrefix = msg.turn !== undefined ? `[回合${msg.turn}] ` : '';
      lines.push(`${turnPrefix}${speaker}: ${msg.content}`);
    }

    return lines.join('\n');
  }

  /**
   * 构建表格数据快照段
   *
   * 按 sheet 顺序列出当前数据，每行展示字段值。
   * 每 sheet 最多展示 MAX_ROWS_PER_SHEET_IN_PROMPT 行，超出则提示。
   */
  private buildTableSnapshotSection(
    tableData: GameTableData | null,
    schema: GameTableSchema | undefined
  ): string {
    if (!tableData || !tableData.sheets || tableData.sheets.length === 0) {
      return '【当前表格数据快照】\n（当前无表格数据，所有实体都需要 insertRow 创建）';
    }

    const lines: string[] = ['【当前表格数据快照】'];

    tableData.sheets.forEach((sheetName, sheetIdx) => {
      const headers = tableData.headers?.[sheetName] || schema?.headers?.[sheetName] || [];
      const rows = tableData.data?.[sheetName] || [];

      lines.push('');
      lines.push(`${sheetIdx + 1}. **${sheetName}** (表格索引=${sheetIdx + 1}, 当前 ${rows.length} 行)`);

      if (headers.length > 0) {
        const headerList = headers.map((h, i) => `${i + 1}:${h}`).join(', ');
        lines.push(`   字段：[${headerList}]`);
      }

      if (rows.length === 0) {
        lines.push('   （空表）');
        return;
      }

      const displayRows = rows.slice(0, MAX_ROWS_PER_SHEET_IN_PROMPT);
      displayRows.forEach((row, rowIdx) => {
        const cellStr = this.formatRowCells(row, headers);
        lines.push(`   行 ${rowIdx + 1}: ${cellStr}`);
      });

      if (rows.length > displayRows.length) {
        lines.push(`   ... (还有 ${rows.length - displayRows.length} 行未展示)`);
      }
    });

    return lines.join('\n');
  }

  private buildUserActionSection(userAction: string): string {
    return `【玩家行动】\n${userAction.trim()}`;
  }

  // ==================== 工具方法 ====================

  private roleLabel(role: 'user' | 'assistant' | 'system'): string {
    switch (role) {
      case 'user':
        return '玩家';
      case 'assistant':
        return '旁白';
      case 'system':
        return '系统';
    }
  }

  /**
   * 格式化行单元格为可读字符串
   *
   * 输出格式：{"2":"zhudi_001","3":"朱迪","4":"警官"}
   * 这样 AI 能直接看到字段索引与值的映射关系，便于生成 updateRow 命令。
   */
  private formatRowCells(
    row: Record<string, unknown>,
    headers: string[]
  ): string {
    const pairs: string[] = [];
    const seenKeys = new Set<string>();

    // 先按 headers 顺序输出已知字段
    headers.forEach((_, idx) => {
      const colKey = String(idx + 1);
      if (row[colKey] !== undefined && row[colKey] !== null && row[colKey] !== '') {
        pairs.push(`"${colKey}":"${this.escapeValue(row[colKey])}"`);
        seenKeys.add(colKey);
      }
    });

    // 再输出额外字段（非 header 定义的扩展字段）
    for (const [key, value] of Object.entries(row)) {
      if (seenKeys.has(key)) continue;
      if (value === undefined || value === null || value === '') continue;
      pairs.push(`"${key}":"${this.escapeValue(value)}"`);
    }

    return `{${pairs.join(',')}}`;
  }

  /**
   * 转义单元格值中的特殊字符
   *
   * 主要处理双引号与换行，确保输出在 JSON 字面量中安全。
   */
  private escapeValue(value: unknown): string {
    let str: string;
    if (typeof value === 'string') {
      str = value;
    } else if (value === null || value === undefined) {
      return '';
    } else if (typeof value === 'object') {
      try {
        str = JSON.stringify(value);
      } catch {
        str = String(value);
      }
    } else {
      str = String(value);
    }

    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }
}

// ==================== 单例导出 ====================

export const gamePromptBuilder = new GamePromptBuilder();
