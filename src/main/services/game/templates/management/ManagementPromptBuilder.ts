/**
 * 经营游戏 Prompt 构建器
 *
 * 构建"田园小镇"经营类游戏的模板专属 prompt 片段，作为
 * GameNarrativeRequest.templateSystemPrompt 注入到通用 GamePromptBuilder
 * 的 system prompt 末尾（拼接到【模板额外规则】段）。
 *
 * 设计要点：
 *
 * 1. **职责边界**：本类仅构建经营游戏专属的规则与示例片段，
 *    通用 prompt 框架（角色定位 / 输出格式 / tableEdit 协议 / schema 描述）
 *    由 `GamePromptBuilder` 负责。本类的输出会作为 templateSystemPrompt
 *    参数传入，由通用 builder 以 `【模板额外规则】` 段拼接到 system prompt 末尾。
 *
 * 2. **buildUserPrompt**：构建经营游戏视角下的 user prompt。该 prompt 在
 *    集成测试与独立调用场景下使用；生产环境中通用 GameNarrativeService
 *    会调用 `GamePromptBuilder.buildNarrativePrompt` 生成完整 user prompt
 *    （包含剧情上下文 / 表格快照 / 玩家行动），与本方法语义重合但实现独立。
 *
 * 3. **资源经济**：金币 / 食物 / 木材 / 人口 四种资源，每种有产出与消耗
 *
 * 4. **tableEdit 示例**：在 prompt 中提供经营场景下的 tableEdit 命令示例
 *    （如建造农场 → 在 facilities sheet 新增行 + 在 resources sheet 扣除金币）
 *
 * 5. **schema 描述**：将经营游戏的 5 个 sheet（characters / resources /
 *    facilities / events / stats）以英文 sheet 名声明，对齐 Task 14 的
 *    `managementSchema.ts`。注意 sheet 索引从 1 开始。
 */

import type {
  GameMeta,
  GameTableSchema,
  GameTableData
} from '../../../../../shared/types/game.types';

// ==================== 配置常量 ====================

/**
 * user prompt 中携带的最近事件数量
 *
 * 太多会重复上下文（narrativeLog 已含剧情），太少会丢失近期事件因果链。
 * 3 条对应最近 1-2 个回合的事件描述，与 spec Task 15.1 描述一致。
 */
const RECENT_EVENTS_COUNT = 3;

/**
 * user prompt 中每个 sheet 最多展示的行数
 *
 * 与 GamePromptBuilder.MAX_ROWS_PER_SHEET_IN_PROMPT 对齐（20 行），
 * 避免上下文爆炸。
 */
const MAX_ROWS_PER_SHEET = 20;

// ==================== Prompt 构建器实现 ====================

export class ManagementPromptBuilder {
  /**
   * 构建经营游戏 system prompt 片段
   *
   * 该片段作为 `templateSystemPrompt` 注入到 GamePromptBuilder 的输出末尾，
   * 最终以 `【模板额外规则】` 段呈现。包含：
   *
   * 1. 经营游戏角色定位（在通用角色定位基础上补充）
   * 2. 资源经济规则（4 种资源的产出与消耗）
   * 3. 回合制规则（每回合一个行动：build / recruit / end_turn）
   * 4. 随机事件规则（30% 丰收 / 20% 灾害 / 10% 旅人 / 40% 无事件）
   * 5. 经营场景下的 tableEdit 命令示例
   * 6. 经营游戏的 sheet 结构提示（基于 tableSchema 参数）
   *
   * @param meta 游戏元数据（含标题与玩法说明）
   * @param tableSchema 表格 schema（声明 5 个 sheet 结构）
   */
  buildSystemPrompt(meta: GameMeta, tableSchema: GameTableSchema): string {
    const sections: string[] = [];

    // 1. 经营游戏角色定位
    sections.push(this.buildRoleSection(meta));

    // 2. 资源经济规则
    sections.push(this.buildResourceEconomySection());

    // 3. 回合制规则
    sections.push(this.buildTurnBasedSection());

    // 4. 随机事件规则
    sections.push(this.buildRandomEventSection());

    // 5. 经营场景 tableEdit 示例
    sections.push(this.buildTableEditExamplesSection(tableSchema));

    // 6. 经营 sheet 结构提示
    sections.push(this.buildSchemaHintSection(tableSchema));

    return sections.filter(s => s.trim().length > 0).join('\n\n');
  }

  /**
   * 构建经营游戏 user prompt
   *
   * 该 prompt 在集成测试与独立调用场景下使用，包含：
   *
   * 1. 当前回合
   * 2. 当前资源快照（从 tableSnapshot 的 resources sheet 提取）
   * 3. 最近事件描述（最近 3 条，用于事件因果链）
   * 4. 玩家行动（如 'build:farm' / 'recruit:farmer' / 'end_turn' / 自由文本）
   *
   * 注意：通用 GameNarrativeService 在生产环境会调用
   * `GamePromptBuilder.buildNarrativePrompt` 生成完整 user prompt
   * （含剧情上下文 / 完整表格快照），与本方法语义重合但实现独立。
   * 本方法主要用于：
   * - 单元测试验证 prompt 拼装逻辑
   * - ManagementNarrativeService 在 endTurn 等场景下需要构造特殊 user prompt 时复用
   */
  buildUserPrompt(params: {
    /** 玩家行动（如 'build:farm' / 'recruit:farmer' / 'end_turn' / 自由文本） */
    userAction: string;
    /** 当前回合数（从 1 开始） */
    currentTurn: number;
    /** 当前表格数据快照（含 resources / facilities 等 sheet） */
    tableSnapshot: GameTableData;
    /** 最近 3 个事件描述（按时间顺序，最旧的在前） */
    recentEvents: string[];
  }): string {
    const { userAction, currentTurn, tableSnapshot, recentEvents } = params;
    const sections: string[] = [];

    // 1. 当前回合
    sections.push(`【当前回合】第 ${currentTurn} 回合`);

    // 2. 资源快照
    sections.push(this.buildResourceSnapshotSection(tableSnapshot));

    // 3. 最近事件
    sections.push(this.buildRecentEventsSection(recentEvents));

    // 4. 玩家行动
    sections.push(`【玩家行动】${userAction.trim()}`);

    return sections.filter(s => s.trim().length > 0).join('\n\n');
  }

  // ==================== System Prompt 子段 ====================

  /**
   * 经营游戏角色定位段
   *
   * 在通用角色定位（"你是 XX 游戏的旁白 AI"）基础上补充经营游戏的专属职责：
   * 资源管理 / 设施建造 / 角色招募 / 随机事件响应
   */
  private buildRoleSection(meta: GameMeta): string {
    return [
      '【经营游戏角色定位】',
      `你是经营游戏《${meta.title || '田园小镇'}》的旁白 AI，负责：`,
      '- 描述场景、推进剧情、响应玩家行动',
      '- 维护资源经济（金币 / 食物 / 木材 / 人口）',
      '- 处理设施建造、角色招募、回合结算',
      '- 触发与描述随机事件（丰收 / 灾害 / 旅人来访等）',
      '- 在回复末尾生成 <tableEdit> 命令以更新表格状态'
    ].join('\n');
  }

  /**
   * 资源经济规则段
   *
   * 4 种资源：金币 / 食物 / 木材 / 人口
   * 每种资源有产出与消耗路径，建造与招募需消耗对应资源
   */
  private buildResourceEconomySection(): string {
    return [
      '【资源经济规则】',
      '游戏包含 4 种核心资源：',
      '- 金币（gold）：建造设施、招募角色的通用货币',
      '- 食物（food）：维持人口消耗，每回合每人消耗 2 食物',
      '- 木材（wood）：建造农场、房屋等设施的必要材料',
      '- 人口（population）：影响食物消耗与产出，人口越多产出越多但消耗也越大',
      '',
      '资源变更原则：',
      '1. 建造设施（build:<facility_id>）：根据设施 cost 字段扣除对应资源',
      '2. 招募角色（recruit:<character_id>）：扣除金币，人口 +1',
      '3. 结束回合（end_turn）：按 facilities sheet 的 production 字段累加产出，按 resources sheet 的 change_per_turn 字段应用变化',
      '4. 资源不足时，应在叙事中提示玩家，不要执行扣减'
    ].join('\n');
  }

  /**
   * 回合制规则段
   *
   * 每回合玩家可执行一个行动：build / recruit / end_turn
   * 自由文本行动（如"巡视农场"）也消耗本回合
   */
  private buildTurnBasedSection(): string {
    return [
      '【回合制规则】',
      '1. 每回合玩家可执行一个行动：',
      '   - build:<facility_id>：建造指定设施',
      '   - recruit:<character_id>：招募指定角色',
      '   - end_turn：结束当前回合，结算产出并触发随机事件',
      '   - 自由文本：玩家可输入任意行动描述（如"巡视农场"、"与村民交谈"）',
      '2. 回合数记录在 stats sheet 的 turn 字段中',
      '3. end_turn 行动会推进回合数 +1，其他行动不改变回合数',
      '4. 叙事应明确反映当前回合数与剩余可执行行动'
    ].join('\n');
  }

  /**
   * 随机事件规则段
   *
   * 概率配置（仅在 end_turn 时按概率触发其一）：
   * - 30% 丰收：食物 +10
   * - 20% 灾害：食物 -20
   * - 10% 旅人来访：人口 +1
   * - 40% 无事件
   */
  private buildRandomEventSection(): string {
    return [
      '【随机事件规则】',
      '每回合结束（end_turn）时按概率触发以下事件之一：',
      '- 30% 概率触发丰收事件：食物 +10',
      '- 20% 概率触发灾害事件：食物 -20（如虫害、暴风雨）',
      '- 10% 概率触发旅人来访事件：人口 +1',
      '- 40% 概率无特殊事件',
      '',
      '事件描述要求：',
      '1. 触发事件时，叙事应详细描述事件场景与影响',
      '2. 未触发事件时，叙事可正常描述回合过渡',
      '3. 事件触发后应在 events sheet 中记录（id / turn / description / effect）'
    ].join('\n');
  }

  /**
   * 经营场景 tableEdit 命令示例段
   *
   * 提供具体的命令示例，指导 AI 在不同场景下生成正确的 tableEdit
   */
  private buildTableEditExamplesSection(tableSchema: GameTableSchema): string {
    // 通过 tableSchema 推断 sheet 索引（兼容不同命名）
    const sheetIndex = (name: string): number => {
      const idx = tableSchema.sheets.findIndex(s =>
        s.toLowerCase() === name.toLowerCase()
      );
      return idx >= 0 ? idx + 1 : 0;
    };

    const resourcesIdx = sheetIndex('resources');
    const facilitiesIdx = sheetIndex('facilities');
    const charactersIdx = sheetIndex('characters');
    const eventsIdx = sheetIndex('events');
    const statsIdx = sheetIndex('stats');

    const examples: string[] = [
      '【经营场景 tableEdit 命令示例】',
      '以下示例展示了经营游戏中常见的 tableEdit 命令模式。'
    ];

    if (resourcesIdx > 0) {
      examples.push(
        '',
        `// 扣除 50 金币（resources sheet 索引=${resourcesIdx}）`,
        `updateRow(${resourcesIdx}, 1, {"4":"50"})  // 假设第 1 行是金币，第 4 列是数量`,
        '',
        `// 食物 +10（丰收事件）`,
        `updateRow(${resourcesIdx}, 2, {"4":"60"})  // 假设第 2 行是食物`
      );
    }

    if (facilitiesIdx > 0) {
      examples.push(
        '',
        `// 新增农场设施（facilities sheet 索引=${facilitiesIdx}）`,
        `insertRow(${facilitiesIdx}, {"2":"farm_001","3":"农场","4":"1","5":"50","6":"food:5"})`
      );
    }

    if (charactersIdx > 0) {
      examples.push(
        '',
        `// 新增农夫角色（characters sheet 索引=${charactersIdx}）`,
        `insertRow(${charactersIdx}, {"2":"farmer_001","3":"农夫张三","4":"农夫","5":"活跃"})`
      );
    }

    if (eventsIdx > 0) {
      examples.push(
        '',
        `// 记录随机事件（events sheet 索引=${eventsIdx}）`,
        `insertRow(${eventsIdx}, {"2":"event_001","3":"3","4":"丰收年，作物产量大增","5":"food:+10"})`
      );
    }

    if (statsIdx > 0) {
      examples.push(
        '',
        `// 更新回合数（stats sheet 索引=${statsIdx}）`,
        `updateRow(${statsIdx}, 1, {"3":"4"})  // 假设第 1 行是 turn，第 3 列是 value`
      );
    }

    return examples.join('\n');
  }

  /**
   * 经营 sheet 结构提示段
   *
   * 基于传入的 tableSchema 列出 sheet 索引与列头，便于 AI 生成 tableEdit 命令时参考。
   * 注意：通用 GamePromptBuilder 的 schema 段已包含此信息，本段为经营游戏专属提示，
   * 与通用段语义重合但措辞更聚焦经营场景。
   */
  private buildSchemaHintSection(tableSchema: GameTableSchema): string {
    if (!tableSchema || !tableSchema.sheets || tableSchema.sheets.length === 0) {
      return '【经营 sheet 结构】\n当前未配置经营游戏 schema，跳过结构提示。';
    }

    const lines: string[] = [
      '【经营 sheet 结构】',
      '经营游戏的标准 sheet 结构（字段索引从 1 开始）：'
    ];

    const STANDARD_SHEETS: Array<{ name: string; headers: string[]; description: string }> = [
      {
        name: 'characters',
        headers: ['流水号', '唯一id', '角色名', '身份', '状态'],
        description: '记录小镇居民，每行一个角色'
      },
      {
        name: 'resources',
        headers: ['流水号', '唯一id', '资源名', '数量', '每回合变化'],
        description: '记录 4 种资源：金币 / 食物 / 木材 / 人口'
      },
      {
        name: 'facilities',
        headers: ['流水号', '唯一id', '设施名', '等级', '建造成本', '产出'],
        description: '记录已建设的设施，每行一个设施'
      },
      {
        name: 'events',
        headers: ['流水号', '唯一id', '回合', '描述', '效果'],
        description: '记录历史事件，按时间倒序追加'
      },
      {
        name: 'stats',
        headers: ['流水号', '唯一id', '键', '值'],
        description: '记录全局统计（如 turn / total_income / total_expense）'
      }
    ];

    // 按 tableSchema 实际顺序展示
    tableSchema.sheets.forEach((sheetName, idx) => {
      const standard = STANDARD_SHEETS.find(
        s => s.name.toLowerCase() === sheetName.toLowerCase()
      );
      const headers = tableSchema.headers?.[sheetName] || standard?.headers || [];
      const description =
        tableSchema.sheetDescriptions?.[sheetName] || standard?.description || '';

      lines.push(`${idx + 1}. **${sheetName}** (表格索引=${idx + 1})`);
      if (description) {
        lines.push(`   - 用途：${description}`);
      }
      if (headers.length > 0) {
        const headerList = headers.map((h, i) => `${i + 1}:${h}`).join(', ');
        lines.push(`   - 字段：[${headerList}]`);
      }
    });

    return lines.join('\n');
  }

  // ==================== User Prompt 子段 ====================

  /**
   * 构建资源快照段
   *
   * 从 tableSnapshot 的 resources sheet 提取并展示当前资源状态。
   * 若 resources sheet 不存在或为空，返回提示信息。
   */
  private buildResourceSnapshotSection(tableSnapshot: GameTableData): string {
    const lines: string[] = ['【当前资源快照】'];

    if (!tableSnapshot || !tableSnapshot.sheets || tableSnapshot.sheets.length === 0) {
      lines.push('（无表格数据，无法读取资源状态）');
      return lines.join('\n');
    }

    // 查找 resources sheet（大小写不敏感）
    const resourcesSheetName = tableSnapshot.sheets.find(
      s => s.toLowerCase() === 'resources'
    );

    if (!resourcesSheetName) {
      lines.push('（未找到 resources sheet）');
      return lines.join('\n');
    }

    const rows = tableSnapshot.data?.[resourcesSheetName] || [];
    if (rows.length === 0) {
      lines.push('（resources sheet 为空）');
      return lines.join('\n');
    }

    // 展示最多 MAX_ROWS_PER_SHEET 行
    const displayRows = rows.slice(0, MAX_ROWS_PER_SHEET);

    displayRows.forEach((row, idx) => {
      const name = row['3'] ?? row['2'] ?? `资源${idx + 1}`;
      const amount = row['4'] ?? '?';
      const change = row['5'];
      const changeStr = change !== undefined && change !== null && change !== ''
        ? ` (每回合 ${change})`
        : '';
      lines.push(`- ${name}: ${amount}${changeStr}`);
    });

    if (rows.length > displayRows.length) {
      lines.push(`... (还有 ${rows.length - displayRows.length} 行未展示)`);
    }

    return lines.join('\n');
  }

  /**
   * 构建最近事件段
   *
   * 截取最近 RECENT_EVENTS_COUNT 个事件描述，按时间顺序排列。
   * 若 recentEvents 为空，提示无最近事件。
   */
  private buildRecentEventsSection(recentEvents: string[]): string {
    if (!recentEvents || recentEvents.length === 0) {
      return '【最近事件】\n（暂无最近事件）';
    }

    const recent = recentEvents.slice(-RECENT_EVENTS_COUNT);
    const lines: string[] = ['【最近事件】'];

    if (recentEvents.length > recent.length) {
      lines.push(`（已省略较早的 ${recentEvents.length - recent.length} 个事件）`);
    }

    recent.forEach((event, idx) => {
      lines.push(`${idx + 1}. ${event}`);
    });

    return lines.join('\n');
  }
}

// ==================== 单例导出 ====================

export const managementPromptBuilder = new ManagementPromptBuilder();
