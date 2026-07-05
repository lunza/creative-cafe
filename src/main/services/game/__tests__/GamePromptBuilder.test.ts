/**
 * GamePromptBuilder 单元测试
 *
 * 覆盖场景：
 * 1. system prompt 包含 schema 描述
 * 2. system prompt 包含角色定位与游戏规则
 * 3. system prompt 在 async 模式下包含 tableEdit 协议
 * 4. system prompt 在 sync 模式下不包含 tableEdit 协议
 * 5. system prompt 拼接模板额外片段
 * 6. user prompt 包含玩家行动
 * 7. user prompt 包含表格数据快照
 * 8. user prompt 包含剧情上下文
 * 9. user prompt 限制每 sheet 最多展示 20 行
 * 10. user prompt 限制最近 10 条剧情消息
 * 11. 空表格与空剧情日志的降级处理
 *
 * 验证目标（spec Task 3.4）：
 * - system prompt 能正确嵌入 schema 信息供 AI 参考
 * - user prompt 能正确传递玩家行动与当前状态
 * - organizeMode 切换能正确控制 tableEdit 协议的注入
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GamePromptBuilder } from '../GamePromptBuilder';
import {
  GameType,
  GameStatus,
  type GameMeta,
  type GameLocalConfig,
  type GameTableSchema,
  type GameTableData,
  type GameNarrativeMessage
} from '../../../../shared/types/game.types';

describe('GamePromptBuilder', () => {
  let builder: GamePromptBuilder;

  // 测试用 fixtures
  let gameMeta: GameMeta;
  let config: GameLocalConfig;
  let tableSchema: GameTableSchema;
  let tableData: GameTableData;
  let narrativeLog: GameNarrativeMessage[];

  beforeEach(() => {
    builder = new GamePromptBuilder();

    gameMeta = {
      id: 'pastoral_town',
      type: GameType.MANAGEMENT,
      title: '田园小镇',
      subtitle: '经营你的农场',
      description: '一款文字模拟经营游戏',
      gameplay: '资源经济：每回合产出食物、金币。\n回合制：每回合可建造一个设施。\n随机事件：每回合 30% 概率触发事件。',
      developer: 'CreativeCafe',
      version: '1.0.0',
      status: GameStatus.COMPLETED,
      tags: ['经营', '回合制'],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    config = {
      activeEngineId: 'engine-1',
      temperature: 0.7,
      maxTokens: 32768,
      organizeMode: 'async',
      ansiTheme: 'default',
      autoSave: true
    };

    tableSchema = {
      sheets: ['角色', '资源', '设施'],
      headers: {
        '角色': ['流水号', '唯一id', '角色名', '身份', '状态'],
        '资源': ['流水号', '唯一id', '资源名', '数量', '单位'],
        '设施': ['流水号', '唯一id', '设施名', '等级', '状态']
      },
      sheetDescriptions: {
        '角色': '记录小镇上的居民',
        '资源': '记录玩家持有的资源',
        '设施': '记录已建造的设施'
      }
    };

    tableData = {
      sheets: ['角色', '资源'],
      headers: {
        '角色': ['流水号', '唯一id', '角色名', '身份', '状态'],
        '资源': ['流水号', '唯一id', '资源名', '数量', '单位']
      },
      data: {
        '角色': [
          { '1': 1, '2': 'zhudi_001', '3': '朱迪', '4': '警官', '5': '活跃' },
          { '1': 2, '2': 'nick_001', '3': '尼克', '4': '狐警', '5': '活跃' }
        ],
        '资源': [
          { '1': 1, '2': 'food_001', '3': '食物', '4': 100, '5': '单位' },
          { '1': 2, '2': 'gold_001', '3': '金币', '4': 50, '5': '枚' }
        ]
      },
      sheetDescriptions: {
        '角色': '记录小镇上的居民',
        '资源': '记录玩家持有的资源'
      }
    };

    narrativeLog = [
      {
        id: 'm1',
        role: 'user',
        content: '建造农场',
        timestamp: 1000,
        turn: 1
      },
      {
        id: 'm2',
        role: 'assistant',
        content: '你建造了一座农场，开始产出食物。',
        timestamp: 1100,
        turn: 1
      },
      {
        id: 'm3',
        role: 'user',
        content: '招募农夫',
        timestamp: 1200,
        turn: 2
      },
      {
        id: 'm4',
        role: 'assistant',
        content: '一位农夫加入了你的小镇。',
        timestamp: 1300,
        turn: 2
      }
    ];
  });

  // ========== System Prompt ==========

  describe('buildSystemPrompt', () => {
    it('includes game title in role section', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('田园小镇');
      expect(prompt).toContain('旁白 AI');
    });

    it('includes subtitle in role section', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('经营你的农场');
    });

    it('includes gameplay rules section', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('【游戏规则】');
      expect(prompt).toContain('资源经济');
      expect(prompt).toContain('回合制');
    });

    it('includes output format requirements', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('【输出格式要求】');
      expect(prompt).toContain('tableEdit');
      expect(prompt).toContain('剧情叙事文本');
    });

    it('includes tableEdit protocol section in async mode', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('【tableEdit 命令协议');
      expect(prompt).toContain('insertRow');
      expect(prompt).toContain('updateRow');
      expect(prompt).toContain('deleteRow');
      expect(prompt).toContain('表格索引');
      expect(prompt).toContain('行索引');
      expect(prompt).toContain('字段索引');
      // 协议中应说明"表格索引：从 1 开始，对应下方【表格模板结构】中列出的 sheet 顺序"
      // 验证：要么提到 1-based，要么使用中文表述"从 1 开始"
      expect(prompt).toMatch(/1-based|从 1 开始/);
    });

    it('includes incremental update strategy in async mode', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('增量更新');
      expect(prompt).toContain('重复性检查');
      expect(prompt).toContain('updateRow');
    });

    it('includes schema description with sheet order and headers', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      expect(prompt).toContain('【表格模板结构】');
      // sheet 顺序与索引
      expect(prompt).toContain('1. **角色**');
      expect(prompt).toContain('2. **资源**');
      expect(prompt).toContain('3. **设施**');
      expect(prompt).toContain('表格索引=1');
      expect(prompt).toContain('表格索引=2');
      expect(prompt).toContain('表格索引=3');
      // 列头
      expect(prompt).toContain('1:流水号');
      expect(prompt).toContain('2:唯一id');
      expect(prompt).toContain('3:角色名');
      expect(prompt).toContain('4:身份');
      // 描述
      expect(prompt).toContain('记录小镇上的居民');
      expect(prompt).toContain('记录玩家持有的资源');
    });

    it('handles missing schema gracefully', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, undefined, config);
      expect(prompt).toContain('【表格模板结构】');
      expect(prompt).toContain('未配置表格');
    });

    it('handles empty schema (no sheets) gracefully', () => {
      const emptySchema: GameTableSchema = {
        sheets: [],
        headers: {},
        sheetDescriptions: {}
      };
      const prompt = builder.buildSystemPrompt(gameMeta, emptySchema, config);
      expect(prompt).toContain('未配置表格');
    });

    it('does NOT include tableEdit protocol in sync mode', () => {
      const syncConfig: GameLocalConfig = { ...config, organizeMode: 'sync' };
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, syncConfig);
      // sync 模式不应包含协议说明
      expect(prompt).not.toContain('【tableEdit 命令协议');
      // 也不应包含 schema 描述（因为不需要 AI 生成 tableEdit）
      expect(prompt).not.toContain('【表格模板结构】');
    });

    it('still includes output format section in sync mode', () => {
      const syncConfig: GameLocalConfig = { ...config, organizeMode: 'sync' };
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, syncConfig);
      // 输出格式仍然要求，但其中 tableEdit 部分在 sync 模式下意义不大
      // 这里只验证角色定位与游戏规则仍存在
      expect(prompt).toContain('【角色定位】');
      expect(prompt).toContain('【游戏规则】');
    });

    it('appends templateSystemPrompt at the end when provided', () => {
      const templateExtra = '【经营模板专属规则】\n每回合食物消耗 = 居民数 × 2\n金币产出 = 设施数 × 10';
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config, templateExtra);
      expect(prompt).toContain('【模板额外规则】');
      expect(prompt).toContain('经营模板专属规则');
      expect(prompt).toContain('每回合食物消耗');
    });

    it('does not append template section when templateSystemPrompt is empty', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config, '');
      expect(prompt).not.toContain('【模板额外规则】');
    });

    it('does not append template section when templateSystemPrompt is whitespace', () => {
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config, '   \n\n  ');
      expect(prompt).not.toContain('【模板额外规则】');
    });

    it('handles gameMeta with empty gameplay', () => {
      const metaWithoutGameplay: GameMeta = { ...gameMeta, gameplay: '' };
      const prompt = builder.buildSystemPrompt(metaWithoutGameplay, tableSchema, config);
      expect(prompt).not.toContain('【游戏规则】');
    });
  });

  // ========== User Prompt ==========

  describe('buildNarrativePrompt', () => {
    it('includes player action', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableData,
        tableSchema,
        3
      );
      expect(prompt).toContain('【玩家行动】');
      expect(prompt).toContain('建造农场');
    });

    it('includes current turn when provided', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableData,
        tableSchema,
        5
      );
      expect(prompt).toContain('【当前回合】');
      expect(prompt).toContain('第 5 回合');
    });

    it('does not include current turn section when not provided', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableData,
        tableSchema
      );
      expect(prompt).not.toContain('【当前回合】');
    });

    it('includes narrative context section', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableData,
        tableSchema,
        3
      );
      expect(prompt).toContain('【剧情上下文】');
      // 历史消息应被展示
      expect(prompt).toContain('建造农场');
      expect(prompt).toContain('你建造了一座农场');
      expect(prompt).toContain('招募农夫');
      expect(prompt).toContain('一位农夫加入了你的小镇');
    });

    it('handles empty narrative log', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        [],
        tableData,
        tableSchema
      );
      expect(prompt).toContain('【剧情上下文】');
      expect(prompt).toContain('暂无历史剧情');
      expect(prompt).toContain('游戏的开始');
    });

    it('includes table data snapshot section', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableData,
        tableSchema
      );
      expect(prompt).toContain('【当前表格数据快照】');
      // sheet 名称
      expect(prompt).toContain('**角色**');
      expect(prompt).toContain('**资源**');
      // sheet 索引
      expect(prompt).toContain('表格索引=1');
      expect(prompt).toContain('表格索引=2');
      // 行数信息
      expect(prompt).toContain('当前 2 行');
      // 字段结构
      expect(prompt).toContain('1:流水号');
      expect(prompt).toContain('2:唯一id');
      // 行数据
      expect(prompt).toContain('zhudi_001');
      expect(prompt).toContain('朱迪');
      expect(prompt).toContain('food_001');
    });

    it('handles null tableData', () => {
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        null,
        tableSchema
      );
      expect(prompt).toContain('【当前表格数据快照】');
      expect(prompt).toContain('当前无表格数据');
      expect(prompt).toContain('insertRow 创建');
    });

    it('handles tableData with empty sheets', () => {
      const emptyTableData: GameTableData = {
        sheets: [],
        headers: {},
        data: {},
        sheetDescriptions: {}
      };
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        emptyTableData,
        tableSchema
      );
      expect(prompt).toContain('【当前表格数据快照】');
      expect(prompt).toContain('当前无表格数据');
    });

    it('handles sheet with zero rows', () => {
      const tableWithEmptySheet: GameTableData = {
        sheets: ['角色'],
        headers: { '角色': ['流水号', '唯一id', '角色名'] },
        data: { '角色': [] },
        sheetDescriptions: { '角色': '居民表' }
      };
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableWithEmptySheet,
        tableSchema
      );
      expect(prompt).toContain('空表');
    });

    it('limits rows per sheet to 20', () => {
      // 构造 25 行的角色数据
      const manyRows = Array.from({ length: 25 }, (_, i) => ({
        '1': i + 1,
        '2': `worker_${String(i + 1).padStart(3, '0')}`,
        '3': `工人${i + 1}`,
        '4': '农夫',
        '5': '活跃'
      }));
      const largeTableData: GameTableData = {
        sheets: ['角色'],
        headers: { '角色': ['流水号', '唯一id', '角色名', '身份', '状态'] },
        data: { '角色': manyRows },
        sheetDescriptions: { '角色': '居民表' }
      };

      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        largeTableData,
        tableSchema
      );

      // 应展示前 20 行
      expect(prompt).toContain('worker_001');
      expect(prompt).toContain('worker_020');
      // 第 21-25 行不应展示
      expect(prompt).not.toContain('worker_021');
      // 应提示剩余行数
      expect(prompt).toContain('还有 5 行未展示');
    });

    it('limits narrative log to most recent 10 messages', () => {
      // 构造 15 条消息
      const longLog: GameNarrativeMessage[] = Array.from({ length: 15 }, (_, i) => ({
        id: `m${i + 1}`,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `消息 ${i + 1} 的内容`,
        timestamp: 1000 + i * 100,
        turn: Math.floor(i / 2) + 1
      }));

      const prompt = builder.buildNarrativePrompt(
        '当前行动',
        longLog,
        tableData,
        tableSchema
      );

      // 应展示最后 10 条消息
      expect(prompt).toContain('消息 6 的内容');
      expect(prompt).toContain('消息 15 的内容');
      // 前 5 条应被省略
      expect(prompt).not.toContain('消息 1 的内容');
      expect(prompt).not.toContain('消息 5 的内容');
      // 应有省略提示
      expect(prompt).toContain('已省略较早的 5 条消息');
    });

    it('includes turn prefix in narrative context when message has turn', () => {
      const logWithTurns: GameNarrativeMessage[] = [
        {
          id: 'm1',
          role: 'user',
          content: '行动 A',
          timestamp: 1000,
          turn: 1
        },
        {
          id: 'm2',
          role: 'assistant',
          content: '响应 A',
          timestamp: 1100,
          turn: 1
        }
      ];
      const prompt = builder.buildNarrativePrompt(
        '新行动',
        logWithTurns,
        null,
        tableSchema
      );
      expect(prompt).toContain('[回合1]');
    });

    it('uses speakerName when provided in message', () => {
      const logWithSpeaker: GameNarrativeMessage[] = [
        {
          id: 'm1',
          role: 'assistant',
          content: '你好，我是朱迪。',
          timestamp: 1000,
          speakerName: '朱迪'
        }
      ];
      const prompt = builder.buildNarrativePrompt(
        '对话',
        logWithSpeaker,
        null,
        tableSchema
      );
      expect(prompt).toContain('朱迪: 你好，我是朱迪。');
    });

    it('uses role label when speakerName is not provided', () => {
      const logWithoutSpeaker: GameNarrativeMessage[] = [
        {
          id: 'm1',
          role: 'user',
          content: '我的行动',
          timestamp: 1000
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'AI 响应',
          timestamp: 1100
        }
      ];
      const prompt = builder.buildNarrativePrompt(
        '新行动',
        logWithoutSpeaker,
        null,
        tableSchema
      );
      expect(prompt).toContain('玩家: 我的行动');
      expect(prompt).toContain('旁白: AI 响应');
    });

    it('escapes special characters in cell values', () => {
      const tableWithSpecialChars: GameTableData = {
        sheets: ['角色'],
        headers: { '角色': ['流水号', '唯一id', '角色名'] },
        data: {
          '角色': [
            { '1': 1, '2': 'special_001', '3': '包含"引号"的名字' }
          ]
        },
        sheetDescriptions: { '角色': '居民表' }
      };
      const prompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableWithSpecialChars,
        tableSchema
      );
      // 引号应被转义为 \"
      expect(prompt).toContain('\\"引号\\"');
    });
  });

  // ========== Integration-style assertions ==========

  describe('Prompt structure integration', () => {
    it('system prompt and user prompt together form a complete request', () => {
      const sysPrompt = builder.buildSystemPrompt(gameMeta, tableSchema, config, '经济规则补充');
      const userPrompt = builder.buildNarrativePrompt(
        '建造农场',
        narrativeLog,
        tableData,
        tableSchema,
        3
      );

      // system prompt 包含所有必要段
      expect(sysPrompt).toContain('【角色定位】');
      expect(sysPrompt).toContain('【游戏规则】');
      expect(sysPrompt).toContain('【输出格式要求】');
      expect(sysPrompt).toContain('【tableEdit 命令协议');
      expect(sysPrompt).toContain('【表格模板结构】');
      expect(sysPrompt).toContain('【模板额外规则】');

      // user prompt 包含所有必要段
      expect(userPrompt).toContain('【当前回合】');
      expect(userPrompt).toContain('【剧情上下文】');
      expect(userPrompt).toContain('【当前表格数据快照】');
      expect(userPrompt).toContain('【玩家行动】');
    });

    it('schema sheet order matches indices referenced in protocol', () => {
      // 验证：协议中说"表格索引从 1 开始对应 sheet 顺序"，
      // 而 schema 段也是按 1, 2, 3 顺序列出 sheet，二者一致
      const prompt = builder.buildSystemPrompt(gameMeta, tableSchema, config);
      // 第一个 sheet 是"角色"，对应表格索引=1
      const roleIdx = prompt.indexOf('1. **角色**');
      const roleIdxRef = prompt.indexOf('表格索引=1');
      expect(roleIdx).toBeGreaterThan(-1);
      expect(roleIdxRef).toBeGreaterThan(-1);
      // 协议中应明确说明"表格索引：从 1 开始，对应下方【表格模板结构】中列出的 sheet 顺序"
      expect(prompt).toContain('对应下方【表格模板结构】中列出的 sheet 顺序');
    });
  });
});
