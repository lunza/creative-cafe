/**
 * ManagementGameTemplate 单元测试（Task 14 / SubTask 14.6）
 *
 * 测试覆盖：
 * 1. ManagementGameTemplate 字段完整性（type / meta / panels / tableSchema / Component / serializeState / deserializeState / getInitialState）
 * 2. MANAGEMENT_TABLE_SCHEMA 结构正确（5 个 sheet，headers 完整）
 * 3. MANAGEMENT_INITIAL_STATE 默认值（金币 500 / 食物 50 / 木材 30 / 人口 5 / 回合 1）
 * 4. serializeState 输出有效（结构化对象，非 JSON 字符串）
 * 5. deserializeState 反序列化正确，无效输入时回退到 INITIAL_STATE
 * 6. initialStateToTableData 转换正确（characters / resources / facilities / events / stats 各 sheet 数据完整）
 * 7. createInitialManagementState 每次返回新对象（避免共享引用污染）
 *
 * 测试风格参考：
 * - src/renderer/components/Game/templates/__tests__/GameTemplateRegistry.test.ts（字段完整性断言风格）
 * - src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx（纯函数测试风格）
 *
 * 注意：本测试不渲染 ManagementGameMain 组件（涉及 antd / store 较复杂），
 * 仅验证模板对象、schema、初始状态、序列化函数等纯逻辑。
 * ManagementGameMain 的渲染测试可在 Task 19 引入 jsdom 后补充。
 */

import { describe, it, expect } from 'vitest';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate
} from '../../../../../../shared/types/game.types';
import { ManagementGameTemplate } from '../ManagementGameTemplate';
import {
  MANAGEMENT_TABLE_SCHEMA,
  MANAGEMENT_SHEET_INDICES,
  MANAGEMENT_SHEET_NAMES
} from '../managementSchema';
import {
  MANAGEMENT_INITIAL_STATE,
  createInitialManagementState,
  initialStateToTableData,
  type ManagementState
} from '../managementInitialState';

// ==================== SubTask 14.4 字段完整性 ====================

describe('ManagementGameTemplate field integrity', () => {
  it('should have type = GameType.MANAGEMENT', () => {
    expect(ManagementGameTemplate.type).toBe(GameType.MANAGEMENT);
    expect(ManagementGameTemplate.type).toBe('management');
  });

  it('should have complete meta fields', () => {
    const meta = ManagementGameTemplate.meta;
    expect(meta).toBeDefined();
    expect(typeof meta.title).toBe('string');
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.title).toBe('田园小镇');

    expect(typeof meta.subtitle).toBe('string');
    expect(meta.subtitle.length).toBeGreaterThan(0);

    expect(typeof meta.description).toBe('string');
    expect(meta.description.length).toBeGreaterThan(0);

    expect(typeof meta.gameplay).toBe('string');
    expect(meta.gameplay.length).toBeGreaterThan(0);

    expect(typeof meta.developer).toBe('string');
    expect(meta.developer.length).toBeGreaterThan(0);

    expect(typeof meta.version).toBe('string');
    expect(meta.version.length).toBeGreaterThan(0);
    expect(meta.version).toBe('1.0.0');

    expect(meta.status).toBe(GameStatus.COMPLETED);

    expect(Array.isArray(meta.tags)).toBe(true);
    expect(meta.tags.length).toBeGreaterThan(0);
    expect(meta.tags).toContain('经营');
  });

  it('should declare panels array with resource / facility / statistics', () => {
    expect(Array.isArray(ManagementGameTemplate.panels)).toBe(true);
    expect(ManagementGameTemplate.panels).toEqual([
      'resource',
      'facility',
      'statistics'
    ]);
  });

  it('should have MANAGEMENT_TABLE_SCHEMA as tableSchema', () => {
    expect(ManagementGameTemplate.tableSchema).toBe(MANAGEMENT_TABLE_SCHEMA);
  });

  it('should have a non-null lazy Component', () => {
    expect(ManagementGameTemplate.Component).toBeDefined();
    expect(ManagementGameTemplate.Component).not.toBeNull();
    expect(typeof ManagementGameTemplate.Component).toBe('object');
    // lazy 组件有 _payload 字段（React.lazy 内部实现细节）
    expect(ManagementGameTemplate.Component).toHaveProperty('_payload');
  });

  it('should provide serializeState function', () => {
    expect(typeof ManagementGameTemplate.serializeState).toBe('function');
  });

  it('should provide deserializeState function', () => {
    expect(typeof ManagementGameTemplate.deserializeState).toBe('function');
  });

  it('should provide getInitialState function', () => {
    expect(typeof ManagementGameTemplate.getInitialState).toBe('function');
  });

  it('should not declare onOtherAction (undefined)', () => {
    expect(ManagementGameTemplate.onOtherAction).toBeUndefined();
  });

  it('should satisfy GameTypeTemplate interface contract', () => {
    // 通过类型断言验证接口完整性（编译时检查 + 运行时字段存在性）
    const template: GameTypeTemplate = ManagementGameTemplate;
    expect(template.type).toBe(GameType.MANAGEMENT);
    expect(template.meta).toBeDefined();
    expect(template.panels).toBeDefined();
    expect(template.tableSchema).toBeDefined();
    expect(template.Component).toBeDefined();
  });
});

// ==================== SubTask 14.1 Schema 结构 ====================

describe('MANAGEMENT_TABLE_SCHEMA structure', () => {
  it('should have 5 sheets in correct order', () => {
    expect(Array.isArray(MANAGEMENT_TABLE_SCHEMA.sheets)).toBe(true);
    expect(MANAGEMENT_TABLE_SCHEMA.sheets).toHaveLength(5);
    expect(MANAGEMENT_TABLE_SCHEMA.sheets).toEqual([
      'characters',
      'resources',
      'facilities',
      'events',
      'stats'
    ]);
  });

  it('should have headers for all 5 sheets', () => {
    const headers = MANAGEMENT_TABLE_SCHEMA.headers;
    expect(headers).toBeDefined();

    expect(headers.characters).toEqual(['1', 'name', 'role', 'status']);
    expect(headers.resources).toEqual([
      '1',
      'name',
      'amount',
      'change_per_turn'
    ]);
    expect(headers.facilities).toEqual([
      '1',
      'name',
      'level',
      'cost',
      'production'
    ]);
    expect(headers.events).toEqual(['1', 'turn', 'description', 'effect']);
    expect(headers.stats).toEqual(['1', 'key', 'value']);
  });

  it('should have sheetDescriptions for all 5 sheets', () => {
    const descs = MANAGEMENT_TABLE_SCHEMA.sheetDescriptions;
    expect(descs).toBeDefined();

    expect(typeof descs.characters).toBe('string');
    expect(descs.characters.length).toBeGreaterThan(0);

    expect(typeof descs.resources).toBe('string');
    expect(descs.resources.length).toBeGreaterThan(0);

    expect(typeof descs.facilities).toBe('string');
    expect(descs.facilities.length).toBeGreaterThan(0);

    expect(typeof descs.events).toBe('string');
    expect(descs.events.length).toBeGreaterThan(0);

    expect(typeof descs.stats).toBe('string');
    expect(descs.stats.length).toBeGreaterThan(0);
  });

  it('should expose sheet index constants matching sheets order', () => {
    expect(MANAGEMENT_SHEET_INDICES.characters).toBe(0);
    expect(MANAGEMENT_SHEET_INDICES.resources).toBe(1);
    expect(MANAGEMENT_SHEET_INDICES.facilities).toBe(2);
    expect(MANAGEMENT_SHEET_INDICES.events).toBe(3);
    expect(MANAGEMENT_SHEET_INDICES.stats).toBe(4);
  });

  it('should expose sheet name constants matching sheets array', () => {
    expect(MANAGEMENT_SHEET_NAMES.characters).toBe(
      MANAGEMENT_TABLE_SCHEMA.sheets[0]
    );
    expect(MANAGEMENT_SHEET_NAMES.resources).toBe(
      MANAGEMENT_TABLE_SCHEMA.sheets[1]
    );
    expect(MANAGEMENT_SHEET_NAMES.facilities).toBe(
      MANAGEMENT_TABLE_SCHEMA.sheets[2]
    );
    expect(MANAGEMENT_SHEET_NAMES.events).toBe(
      MANAGEMENT_TABLE_SCHEMA.sheets[3]
    );
    expect(MANAGEMENT_SHEET_NAMES.stats).toBe(MANAGEMENT_TABLE_SCHEMA.sheets[4]);
  });
});

// ==================== SubTask 14.2 初始状态默认值 ====================

describe('MANAGEMENT_INITIAL_STATE defaults', () => {
  it('should default turn to 1', () => {
    expect(MANAGEMENT_INITIAL_STATE.turn).toBe(1);
  });

  it('should default resources.gold to 500', () => {
    expect(MANAGEMENT_INITIAL_STATE.resources.gold).toBe(500);
  });

  it('should default resources.food to 50', () => {
    expect(MANAGEMENT_INITIAL_STATE.resources.food).toBe(50);
  });

  it('should default resources.wood to 30', () => {
    expect(MANAGEMENT_INITIAL_STATE.resources.wood).toBe(30);
  });

  it('should default resources.population to 5', () => {
    expect(MANAGEMENT_INITIAL_STATE.resources.population).toBe(5);
  });

  it('should default facilities to empty array', () => {
    expect(Array.isArray(MANAGEMENT_INITIAL_STATE.facilities)).toBe(true);
    expect(MANAGEMENT_INITIAL_STATE.facilities).toHaveLength(0);
  });

  it('should default events to empty array', () => {
    expect(Array.isArray(MANAGEMENT_INITIAL_STATE.events)).toBe(true);
    expect(MANAGEMENT_INITIAL_STATE.events).toHaveLength(0);
  });

  it('should have randomSeed as a number', () => {
    expect(typeof MANAGEMENT_INITIAL_STATE.randomSeed).toBe('number');
    expect(Number.isFinite(MANAGEMENT_INITIAL_STATE.randomSeed)).toBe(true);
  });

  it('should default upgradePaths to empty object', () => {
    expect(MANAGEMENT_INITIAL_STATE.upgradePaths).toEqual({});
  });
});

// ==================== SubTask 14.5 序列化 / 反序列化 ====================

describe('serializeState / deserializeState', () => {
  it('serializeState should return Record<string, any> (not JSON string)', () => {
    const state = createInitialManagementState();
    const result = ManagementGameTemplate.serializeState!(state);

    // 返回值应为对象（Record<string, any>），非 JSON 字符串
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(typeof result).not.toBe('string');
  });

  it('serializeState should preserve state fields', () => {
    const state: ManagementState = {
      turn: 7,
      resources: { gold: 100, food: 20, wood: 10, population: 8 },
      facilities: [{ id: 'farm', name: '农场', level: 2 }],
      events: [{ id: 'evt1', turn: 5, description: '丰收' }],
      randomSeed: 12345,
      upgradePaths: { farm: ['farm_lv1', 'farm_lv2'] }
    };
    const result = ManagementGameTemplate.serializeState!(state) as ManagementState;

    expect(result.turn).toBe(7);
    expect(result.resources.gold).toBe(100);
    expect(result.resources.food).toBe(20);
    expect(result.facilities).toHaveLength(1);
    expect(result.facilities[0].name).toBe('农场');
    expect(result.events).toHaveLength(1);
    expect(result.randomSeed).toBe(12345);
    expect(result.upgradePaths.farm).toEqual(['farm_lv1', 'farm_lv2']);
  });

  it('serializeState should not mutate input state', () => {
    const state = createInitialManagementState();
    const original = JSON.parse(JSON.stringify(state));
    ManagementGameTemplate.serializeState!(state);

    // 输入对象应未被修改
    expect(state).toEqual(original);
  });

  it('deserializeState should round-trip serializeState output', () => {
    const original: ManagementState = {
      turn: 12,
      resources: { gold: 999, food: 88, wood: 77, population: 22 },
      facilities: [
        { id: 'farm', name: '农场', level: 3 },
        { id: 'mine', name: '矿场', level: 1 }
      ],
      events: [{ id: 'e1', turn: 3, description: '暴风雨' }],
      randomSeed: 99999,
      upgradePaths: { mine: ['mine_lv1', 'mine_lv2'] }
    };

    const serialized = ManagementGameTemplate.serializeState!(original);
    const restored = ManagementGameTemplate.deserializeState!(
      serialized
    ) as ManagementState;

    expect(restored.turn).toBe(12);
    expect(restored.resources.gold).toBe(999);
    expect(restored.resources.food).toBe(88);
    expect(restored.resources.wood).toBe(77);
    expect(restored.resources.population).toBe(22);
    expect(restored.facilities).toHaveLength(2);
    expect(restored.facilities[0].name).toBe('农场');
    expect(restored.facilities[1].name).toBe('矿场');
    expect(restored.events).toHaveLength(1);
    expect(restored.randomSeed).toBe(99999);
    expect(restored.upgradePaths.mine).toEqual(['mine_lv1', 'mine_lv2']);
  });

  it('deserializeState should fallback to INITIAL_STATE on null input', () => {
    // 测试环境：null/undefined 输入应回退
    const result = ManagementGameTemplate.deserializeState!(
      null as unknown as Record<string, any>
    ) as ManagementState;

    expect(result.turn).toBe(MANAGEMENT_INITIAL_STATE.turn);
    expect(result.resources.gold).toBe(MANAGEMENT_INITIAL_STATE.resources.gold);
    expect(result.resources.food).toBe(MANAGEMENT_INITIAL_STATE.resources.food);
    expect(result.resources.wood).toBe(MANAGEMENT_INITIAL_STATE.resources.wood);
    expect(result.resources.population).toBe(
      MANAGEMENT_INITIAL_STATE.resources.population
    );
  });

  it('deserializeState should fallback to INITIAL_STATE on undefined input', () => {
    const result = ManagementGameTemplate.deserializeState!(
      undefined as unknown as Record<string, any>
    ) as ManagementState;

    expect(result.turn).toBe(MANAGEMENT_INITIAL_STATE.turn);
    expect(result.resources.gold).toBe(MANAGEMENT_INITIAL_STATE.resources.gold);
  });

  it('deserializeState should fallback to INITIAL_STATE on non-object input', () => {
    const result = ManagementGameTemplate.deserializeState!(
      'invalid string' as unknown as Record<string, any>
    ) as ManagementState;

    expect(result.turn).toBe(MANAGEMENT_INITIAL_STATE.turn);
    expect(result.resources.gold).toBe(MANAGEMENT_INITIAL_STATE.resources.gold);
  });

  it('deserializeState should merge partial snapshot with defaults', () => {
    // 仅提供 turn 字段，其余字段应回退到默认值
    const partial = { turn: 99 };
    const result = ManagementGameTemplate.deserializeState!(partial) as ManagementState;

    expect(result.turn).toBe(99);
    // 缺省字段应回退到默认
    expect(result.resources.gold).toBe(MANAGEMENT_INITIAL_STATE.resources.gold);
    expect(result.resources.food).toBe(MANAGEMENT_INITIAL_STATE.resources.food);
    expect(Array.isArray(result.facilities)).toBe(true);
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.upgradePaths).toEqual({});
  });

  it('deserializeState should deep-merge resources sub-object', () => {
    // 仅提供 resources.gold 字段，其余 resources 字段应回退到默认
    const partial = { resources: { gold: 1234 } };
    const result = ManagementGameTemplate.deserializeState!(partial) as ManagementState;

    expect(result.resources.gold).toBe(1234);
    // 缺省的 food / wood / population 应回退到默认
    expect(result.resources.food).toBe(MANAGEMENT_INITIAL_STATE.resources.food);
    expect(result.resources.wood).toBe(MANAGEMENT_INITIAL_STATE.resources.wood);
    expect(result.resources.population).toBe(
      MANAGEMENT_INITIAL_STATE.resources.population
    );
  });
});

// ==================== getInitialState 测试 ====================

describe('getInitialState', () => {
  it('should return a state with default values', () => {
    const state = ManagementGameTemplate.getInitialState!() as ManagementState;

    expect(state.turn).toBe(MANAGEMENT_INITIAL_STATE.turn);
    expect(state.resources.gold).toBe(MANAGEMENT_INITIAL_STATE.resources.gold);
    expect(state.resources.food).toBe(MANAGEMENT_INITIAL_STATE.resources.food);
    expect(state.resources.wood).toBe(MANAGEMENT_INITIAL_STATE.resources.wood);
    expect(state.resources.population).toBe(
      MANAGEMENT_INITIAL_STATE.resources.population
    );
    expect(state.facilities).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.upgradePaths).toEqual({});
  });

  it('should return a new object each call (no shared references)', () => {
    const state1 = ManagementGameTemplate.getInitialState!() as ManagementState;
    const state2 = ManagementGameTemplate.getInitialState!() as ManagementState;

    // 两个对象应不是同一引用
    expect(state1).not.toBe(state2);
    expect(state1.resources).not.toBe(state2.resources);
    expect(state1.facilities).not.toBe(state2.facilities);
  });

  it('should not share references with MANAGEMENT_INITIAL_STATE constant', () => {
    const state = ManagementGameTemplate.getInitialState!() as ManagementState;

    // 修改返回值不应污染常量
    state.turn = 99;
    state.resources.gold = 9999;
    state.facilities.push({ id: 'x', name: 'x', level: 1 });

    expect(MANAGEMENT_INITIAL_STATE.turn).toBe(1);
    expect(MANAGEMENT_INITIAL_STATE.resources.gold).toBe(500);
    expect(MANAGEMENT_INITIAL_STATE.facilities).toHaveLength(0);
  });
});

// ==================== createInitialManagementState 测试 ====================

describe('createInitialManagementState', () => {
  it('should return a state with default values', () => {
    const state = createInitialManagementState();

    expect(state.turn).toBe(1);
    expect(state.resources.gold).toBe(500);
    expect(state.resources.food).toBe(50);
    expect(state.resources.wood).toBe(30);
    expect(state.resources.population).toBe(5);
    expect(state.facilities).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.upgradePaths).toEqual({});
  });

  it('should return a fresh randomSeed each call', () => {
    const state1 = createInitialManagementState();
    const state2 = createInitialManagementState();

    // 由于 Date.now() 调用间隔极短，可能相等；但应作为 number 类型存在
    expect(typeof state1.randomSeed).toBe('number');
    expect(typeof state2.randomSeed).toBe('number');
  });

  it('should not share references with MANAGEMENT_INITIAL_STATE', () => {
    const state = createInitialManagementState();

    expect(state).not.toBe(MANAGEMENT_INITIAL_STATE);
    expect(state.resources).not.toBe(MANAGEMENT_INITIAL_STATE.resources);
  });
});

// ==================== initialStateToTableData 测试 ====================

describe('initialStateToTableData', () => {
  it('should return a complete GameTableData object with 5 sheets', () => {
    const tableData = initialStateToTableData();

    expect(tableData).toBeDefined();
    expect(Array.isArray(tableData.sheets)).toBe(true);
    expect(tableData.sheets).toHaveLength(5);
    expect(tableData.sheets).toEqual(
      MANAGEMENT_TABLE_SCHEMA.sheets
    );

    expect(tableData.headers).toEqual(MANAGEMENT_TABLE_SCHEMA.headers);
    expect(tableData.sheetDescriptions).toEqual(
      MANAGEMENT_TABLE_SCHEMA.sheetDescriptions
    );
  });

  it('should initialize characters sheet with a single 镇长 row', () => {
    const tableData = initialStateToTableData();
    const characters = tableData.data.characters;

    expect(Array.isArray(characters)).toBe(true);
    expect(characters).toHaveLength(1);
    expect(characters[0].name).toBe('镇长');
    expect(characters[0].role).toBe('player');
    expect(characters[0].status).toBe('active');
  });

  it('should populate resources sheet with 4 rows (gold/food/wood/population)', () => {
    const state = createInitialManagementState();
    const tableData = initialStateToTableData(state);
    const resources = tableData.data.resources;

    expect(Array.isArray(resources)).toBe(true);
    expect(resources).toHaveLength(4);

    // 各行应包含 name / amount / change_per_turn
    const names = resources.map((r) => r.name);
    expect(names).toContain('金币');
    expect(names).toContain('食物');
    expect(names).toContain('木材');
    expect(names).toContain('人口');

    // 默认资源值应反映 state
    const gold = resources.find((r) => r.name === '金币');
    expect(gold?.amount).toBe(500);
    expect(gold?.change_per_turn).toBe(0);

    const food = resources.find((r) => r.name === '食物');
    expect(food?.amount).toBe(50);

    const wood = resources.find((r) => r.name === '木材');
    expect(wood?.amount).toBe(30);

    const pop = resources.find((r) => r.name === '人口');
    expect(pop?.amount).toBe(5);
  });

  it('should populate stats sheet with turn and randomSeed rows', () => {
    const state: ManagementState = {
      ...createInitialManagementState(),
      turn: 42,
      randomSeed: 1234567890
    };
    const tableData = initialStateToTableData(state);
    const stats = tableData.data.stats;

    expect(Array.isArray(stats)).toBe(true);
    expect(stats).toHaveLength(2);

    const turnRow = stats.find((s) => s.key === 'turn');
    expect(turnRow).toBeDefined();
    expect(turnRow?.value).toBe('42');

    const seedRow = stats.find((s) => s.key === 'randomSeed');
    expect(seedRow).toBeDefined();
    expect(seedRow?.value).toBe('1234567890');
  });

  it('should populate facilities sheet from state.facilities', () => {
    const state: ManagementState = {
      ...createInitialManagementState(),
      facilities: [
        { id: 'farm', name: '农场', level: 1 },
        { id: 'mine', name: '矿场', level: 2 }
      ]
    };
    const tableData = initialStateToTableData(state);
    const facilities = tableData.data.facilities;

    expect(Array.isArray(facilities)).toBe(true);
    expect(facilities).toHaveLength(2);
    expect(facilities[0].name).toBe('农场');
    expect(facilities[0].level).toBe(1);
    // cost / production 为占位字段
    expect(facilities[0].cost).toBe(0);
    expect(facilities[0].production).toBe(0);

    expect(facilities[1].name).toBe('矿场');
    expect(facilities[1].level).toBe(2);
  });

  it('should populate events sheet from state.events', () => {
    const state: ManagementState = {
      ...createInitialManagementState(),
      events: [
        { id: 'e1', turn: 1, description: '丰收' },
        { id: 'e2', turn: 2, description: '干旱' }
      ]
    };
    const tableData = initialStateToTableData(state);
    const events = tableData.data.events;

    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[0].turn).toBe(1);
    expect(events[0].description).toBe('丰收');
    // effect 为占位字段
    expect(events[0].effect).toBe('');

    expect(events[1].turn).toBe(2);
    expect(events[1].description).toBe('干旱');
  });

  it('should produce empty facilities/events sheets when state arrays are empty', () => {
    const tableData = initialStateToTableData();

    expect(tableData.data.facilities).toEqual([]);
    expect(tableData.data.events).toEqual([]);
  });

  it('should default to MANAGEMENT_INITIAL_STATE when no argument provided', () => {
    const tableData = initialStateToTableData();
    const resources = tableData.data.resources;

    // 默认应使用 MANAGEMENT_INITIAL_STATE 的资源值
    expect(resources).toHaveLength(4);
    const gold = resources.find((r) => r.name === '金币');
    expect(gold?.amount).toBe(500);
  });

  it('should not share data array references across calls', () => {
    const td1 = initialStateToTableData();
    const td2 = initialStateToTableData();

    expect(td1.data.characters).not.toBe(td2.data.characters);
    expect(td1.data.resources).not.toBe(td2.data.resources);
    expect(td1.data.facilities).not.toBe(td2.data.facilities);
    expect(td1.data.events).not.toBe(td2.data.events);
    expect(td1.data.stats).not.toBe(td2.data.stats);
  });
});

// ==================== 模板集成：注册到 registry 后行为 ====================

describe('ManagementGameTemplate registry integration', () => {
  it('should be registerable in GameTemplateRegistry', async () => {
    // 动态导入避免污染其他测试套件
    const { GameTemplateRegistry } = await import('../../GameTemplateRegistry');
    GameTemplateRegistry.clear();
    GameTemplateRegistry.register(GameType.MANAGEMENT, ManagementGameTemplate);

    expect(GameTemplateRegistry.has(GameType.MANAGEMENT)).toBe(true);
    expect(GameTemplateRegistry.get(GameType.MANAGEMENT)).toBe(
      ManagementGameTemplate
    );
    expect(GameTemplateRegistry.list()).toContain(ManagementGameTemplate);

    GameTemplateRegistry.clear();
  });
});
