import { describe, it, expect } from 'vitest';
import {
  scanTableData,
  preFlightCheckCommands,
  buildReport,
  validateIdConsistency,
  IdFixRecord,
} from '../IdConsistencyValidator';
import type { WritingTableData } from '../WritingTableRepository';
import type { TableEditCommand } from '../../memory/tableEditParser';

/** 构造测试表格：角色表(0) + 身体表(1)，存储键约定 "0"=流水号 "1"=唯一id "2+"=模板列 */
function makeTableData(overrides?: Partial<WritingTableData>): WritingTableData {
  return {
    sheets: ['角色表', '身体表'],
    headers: {
      角色表: ['姓名', '身份'],
      身体表: ['所属角色ID', '部位名称'],
    },
    data: {
      角色表: [
        { 0: '1', 1: 'zhudi_001', 2: '朱迪', 3: '警官' },
        { 0: '2', 1: 'nick_001', 2: '尼克', 3: '狐狸' },
      ],
      身体表: [
        { 0: '1', 1: 'zhudi_erduo_001', 2: 'zhudi_001', 3: '耳朵' },
      ],
    },
    sheetDescriptions: {},
    ...overrides,
  };
}

describe('scanTableData 数据扫描', () => {
  it('零问题数据：ok，无缺 ID / 重复 / 悬空', () => {
    const scan = scanTableData(makeTableData());
    expect(scan.sheets).toHaveLength(2);
    expect(scan.sheets[0].missingIdRows).toEqual([]);
    expect(scan.sheets[0].duplicateIds).toEqual([]);
    expect(scan.danglingRefs).toEqual([]);
  });

  it('检测缺 ID 行（1 基行号）', () => {
    const data = makeTableData();
    delete data.data['角色表'][0][1];
    const scan = scanTableData(data);
    expect(scan.sheets[0].missingIdRows).toEqual([1]);
    expect(scan.sheets[0].totalRows).toBe(2);
  });

  it('检测表内重复 ID', () => {
    const data = makeTableData();
    data.data['角色表'].push({ 0: '3', 1: 'zhudi_001', 2: '朱迪·霍普斯', 3: '警长' });
    const scan = scanTableData(data);
    expect(scan.sheets[0].duplicateIds).toEqual([{ id: 'zhudi_001', rows: [1, 3] }]);
  });

  it('检测悬空引用：所属角色ID 指向不存在的角色表 ID', () => {
    const data = makeTableData();
    data.data['身体表'].push({ 0: '2', 1: 'ghost_erduo_001', 2: 'ghost_001', 3: '耳朵' });
    const scan = scanTableData(data);
    expect(scan.danglingRefs).toEqual([
      { sheetName: '身体表', row: 2, column: '所属角色ID', value: 'ghost_001' },
    ]);
  });

  it('合法引用不算悬空（ID 存在于任意表中）', () => {
    const data = makeTableData();
    data.data['身体表'].push({ 0: '2', 1: 'nick_weiba_001', 2: 'nick_001', 3: '尾巴' });
    const scan = scanTableData(data);
    expect(scan.danglingRefs).toEqual([]);
  });

  it('validateIdConsistency 零问题返回 ok=true 与通过摘要', () => {
    const report = validateIdConsistency(makeTableData());
    expect(report.ok).toBe(true);
    expect(report.summary).toBe('校验通过：全部实体唯一 ID 完整且一致');
  });

  it('validateIdConsistency 有问题时摘要含计数', () => {
    const data = makeTableData();
    delete data.data['角色表'][1][1];
    const report = validateIdConsistency(data);
    expect(report.ok).toBe(false);
    expect(report.summary).toContain('缺ID 1 行');
  });
});

describe('preFlightCheckCommands 命令 pre-flight', () => {
  it('insertRow 重复 ID → 转 updateRow 指向已有行，剥离流水号与唯一id', () => {
    const cmds: TableEditCommand[] = [
      { type: 'insertRow', tableIndex: 0, data: { 2: '朱迪', 3: '警长', 1: 'zhudi_001' }, rawCommand: 'insertRow(1, {"2":"朱迪","3":"警长","1":"zhudi_001"})' },
    ];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.corrected).toHaveLength(1);
    expect(res.corrected[0].type).toBe('updateRow');
    expect(res.corrected[0].rowIndex).toBe(0);
    expect(res.corrected[0].data).toEqual({ 2: '朱迪', 3: '警长' });
    expect(res.fixes).toHaveLength(1);
    expect(res.fixes[0].action).toBe('insertToUpdate');
    expect(res.rejected).toHaveLength(0);
  });

  it('updateRow 篡改字段2 → 剥离，保持原 ID', () => {
    const cmds: TableEditCommand[] = [
      { type: 'updateRow', tableIndex: 0, rowIndex: 0, data: { 3: '警长', 1: 'hacker_999' } },
    ];
    const res = preFlightCheckCommands(cmds, makeTableData());
    const first = res.corrected[0]!;
    expect(first.data ?? {}).toEqual({ 3: '警长' });
    expect((first.data ?? {})['1']).toBeUndefined();
    expect(res.fixes).toHaveLength(1);
    expect(res.fixes[0]!.action).toBe('stripIdChange');
  });

  it('updateRow 未携带字段2 → 原样放行，无修正记录', () => {
    const cmds: TableEditCommand[] = [{ type: 'updateRow', tableIndex: 0, rowIndex: 0, data: { 3: '警长' } }];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.corrected).toHaveLength(1);
    expect(res.fixes).toHaveLength(0);
  });

  it('insertRow 空 ID → 拒绝执行并记录', () => {
    const cmds: TableEditCommand[] = [{ type: 'insertRow', tableIndex: 0, data: { 2: '新角色', 3: '路人' } }];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.rejected).toHaveLength(1);
    expect(res.corrected).toHaveLength(0);
    expect(res.fixes[0].action).toBe('rejectEmptyId');
  });

  it('同实体异 ID（名称字段完全一致）→ 转 updateRow 复用已有 ID', () => {
    const cmds: TableEditCommand[] = [
      { type: 'insertRow', tableIndex: 0, data: { 1: 'judy_new_002', 2: '朱迪', 3: '警官' } },
    ];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.corrected[0].type).toBe('updateRow');
    expect(res.corrected[0].rowIndex).toBe(0);
    expect(res.fixes[0].action).toBe('mergeSameEntity');
    expect(res.fixes[0].detail).toContain('zhudi_001');
  });

  it('部分相似（名称互为子串但不相等）→ unresolved 语义冲突，命令拒绝', () => {
    const cmds: TableEditCommand[] = [
      { type: 'insertRow', tableIndex: 0, data: { 1: 'zhudi_huops_002', 2: '朱迪·霍普斯', 3: '警官' } },
    ];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.unresolved).toHaveLength(1);
    expect(res.unresolved[0]).toContain('疑似同实体异ID');
    expect(res.rejected).toHaveLength(1);
    expect(res.corrected).toHaveLength(0);
  });

  it('全新实体正常插入放行', () => {
    const cmds: TableEditCommand[] = [
      { type: 'insertRow', tableIndex: 0, data: { 1: 'bogo_001', 2: '象副局长', 3: '领导' } },
    ];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.corrected).toHaveLength(1);
    expect(res.corrected[0].type).toBe('insertRow');
    expect(res.fixes).toHaveLength(0);
    expect(res.unresolved).toHaveLength(0);
  });

  it('批内可见性：前一条插入后，后一条重复 ID 命令被转为 updateRow', () => {
    const cmds: TableEditCommand[] = [
      { type: 'insertRow', tableIndex: 0, data: { 1: 'bogo_001', 2: '象副局长', 3: '领导' } },
      { type: 'insertRow', tableIndex: 0, data: { 1: 'bogo_001', 2: '象副局长', 3: '副局长' } },
    ];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.corrected[0].type).toBe('insertRow');
    expect(res.corrected[1].type).toBe('updateRow');
    expect(res.corrected[1].rowIndex).toBe(2);
    expect(res.fixes).toHaveLength(1);
  });

  it('deleteRow 原样放行', () => {
    const cmds: TableEditCommand[] = [{ type: 'deleteRow', tableIndex: 0, rowIndex: 1 }];
    const res = preFlightCheckCommands(cmds, makeTableData());
    expect(res.corrected).toHaveLength(1);
    expect(res.corrected[0]).toBe(cmds[0]);
  });
});

describe('buildReport 报告合成与存量标记', () => {
  it('存量问题标记：baseline 已有的重复 ID / 悬空引用 / 缺 ID 标记 preExisting', () => {
    const baseline = scanTableData(makeTableData());
    const after = makeTableData();
    // 新增一个悬空引用（非存量）
    after.data['身体表'].push({ 0: '2', 1: 'new_body_001', 2: 'missing_id', 3: '尾巴' });
    const report = buildReport(scanTableData(after), baseline, [], [], 0);
    expect(report.danglingRefs).toHaveLength(1);
    expect(report.danglingRefs[0].preExisting).toBe(false);
  });

  it('零问题报告 ok=true', () => {
    const report = buildReport(scanTableData(makeTableData()), undefined, [], [], 0);
    expect(report.ok).toBe(true);
    expect(report.summary).toContain('校验通过');
  });

  it('fixes / manualReview / dedupRemoved 透传进报告', () => {
    const fixes: IdFixRecord[] = [{ sheetName: '角色表', action: 'insertToUpdate', original: 'x', detail: 'y' }];
    const report = buildReport(scanTableData(makeTableData()), undefined, fixes, ['需人工核查项A'], 3);
    expect(report.fixes).toHaveLength(1);
    expect(report.manualReview).toEqual(['需人工核查项A']);
    expect(report.dedupRemoved).toBe(3);
    expect(report.ok).toBe(false);
    expect(report.summary).toContain('需人工核查 1 项');
  });
});
