import { WritingTableData } from './WritingTableRepository';
import { TableEditCommand } from '../memory/tableEditParser';
import type {
  V2IdConsistencyReport,
  V2IdSheetStats,
  V2IdDuplicateGroup,
  V2DanglingRef,
  V2IdFixRecord,
} from '../../../shared/types/writing-v2.types';

/**
 * 唯一 ID 一致性校验器（纯函数，无副作用，可单测）。
 *
 * 背景：表格存储约定 key "0"=流水号、"1"=唯一id（实体去重键）、k(k≥2)=模板第 k-2 列。
 * 此前唯一 ID 完全依赖 prompt 约束，AI 输出重复 insertRow / 篡改 ID / 漏填 ID / 悬空引用
 * 均无运行时防线。本模块提供三段校验能力：
 *  - scanTableData: 数据扫描（缺 ID / 表内重复 ID / 跨表悬空引用）
 *  - preFlightCheckCommands: AI 命令执行前校验与自动修正（冲突暂停-修正-继续）
 *  - buildReport: 整理后一致性报告合成（含存量问题标记）
 *
 * 引用型字段动态识别规则：表头以「ID」结尾且非「唯一id」本身的列（如身体表「所属角色ID」），
 * 其值必须存在于全部表的唯一 ID 集合中，否则记为悬空引用。
 */

// 报告结构以 shared/types/writing-v2.types.ts 为单一真源（主进程/渲染层共用）
export type IdConsistencyReport = V2IdConsistencyReport;
export type IdSheetStats = V2IdSheetStats;
export type IdDuplicateGroup = V2IdDuplicateGroup;
export type DanglingRef = V2DanglingRef;
export type IdFixRecord = V2IdFixRecord;

/** 数据扫描结果（buildReport 的输入，可作存量基线） */
export interface ScanResult {
  sheets: IdSheetStats[];
  danglingRefs: DanglingRef[];
}

/** pre-flight 校验结果 */
export interface PreFlightResult {
  /** 修正后（或原样保留的）可执行命令 */
  corrected: TableEditCommand[];
  /** 被拒绝执行的命令（空 ID / 语义冲突） */
  rejected: TableEditCommand[];
  /** 无法确定性判定的语义冲突描述（触发该章剩余分片暂停） */
  unresolved: string[];
  /** 自动修正清单 */
  fixes: IdFixRecord[];
}

/** 唯一id 存储键 */
const UID_KEY = '1';
/** 流水号存储键 */
const SEQ_KEY = '0';
/** 模板列起始存储键（第 i 个模板列 → String(i + 2)） */
const TEMPLATE_KEY_OFFSET = 2;
/** 同实体判定的关键名称字段：前 2~3 个非 ID 字段（0 基字段索引） */
const NAME_FIELD_KEYS = ['2', '3'];

function normalize(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function uidOf(row: Record<string, any> | null | undefined): string {
  return normalize(row?.[UID_KEY]);
}

/** 命令描述（用于报告展示） */
function describeCommand(cmd: TableEditCommand): string {
  const where = `表格${cmd.tableIndex + 1}${typeof cmd.rowIndex === 'number' ? `,行${cmd.rowIndex + 1}` : ''}`;
  return `${cmd.type}(${where})${cmd.rawCommand ? ` ← ${cmd.rawCommand.slice(0, 120)}` : ''}`;
}

/**
 * 扫描表格数据：缺 ID 行、表内重复 ID、跨表悬空引用。
 * 不修改输入数据。
 */
export function scanTableData(tableData: WritingTableData): ScanResult {
  const sheets: IdSheetStats[] = [];
  const allIds = new Set<string>();

  for (const sheetName of tableData.sheets ?? []) {
    const rows = tableData.data?.[sheetName] ?? [];
    for (const row of rows) {
      const uid = uidOf(row);
      if (uid) allIds.add(uid);
    }
  }

  for (const sheetName of tableData.sheets ?? []) {
    const rows = tableData.data?.[sheetName] ?? [];
    const missingIdRows: number[] = [];
    const idToRows = new Map<string, number[]>();
    rows.forEach((row, i) => {
      const rowNo = i + 1;
      const uid = uidOf(row);
      if (!uid) {
        missingIdRows.push(rowNo);
        return;
      }
      const list = idToRows.get(uid) ?? [];
      list.push(rowNo);
      idToRows.set(uid, list);
    });
    const duplicateIds: IdDuplicateGroup[] = [];
    for (const [id, rowNos] of idToRows) {
      if (rowNos.length > 1) duplicateIds.push({ id, rows: rowNos });
    }
    sheets.push({ sheetName, totalRows: rows.length, missingIdRows, missingPreExisting: 0, duplicateIds });
  }

  // 悬空引用：表头以「ID」结尾且非「唯一id」的列，值不在全部表唯一 ID 集合中
  const danglingRefs: DanglingRef[] = [];
  for (const sheetName of tableData.sheets ?? []) {
    const headers = tableData.headers?.[sheetName] ?? [];
    const rows = tableData.data?.[sheetName] ?? [];
    headers.forEach((header, idx) => {
      if (!/ID$/.test(header) || header === '唯一id') return;
      const storageKey = String(idx + TEMPLATE_KEY_OFFSET);
      rows.forEach((row, i) => {
        const v = normalize(row[storageKey]);
        if (v && !allIds.has(v)) {
          danglingRefs.push({ sheetName, row: i + 1, column: header, value: String(row[storageKey]).trim() });
        }
      });
    });
  }

  return { sheets, danglingRefs };
}

/**
 * 同实体异 ID 判定：关键名称字段（前 2~3 个非 ID 字段）中，
 * 所有非空字段与已有行完全一致（至少 1 个字段参与比较）。
 * 返回匹配行的 0 基索引，未命中返回 -1。
 */
function findSameEntity(rows: Record<string, any>[], data: Record<string, string>): number {
  for (let i = 0; i < rows.length; i++) {
    let compared = 0;
    let allEqual = true;
    for (const key of NAME_FIELD_KEYS) {
      const nv = normalize(data[key]);
      const ov = normalize(rows[i][key]);
      if (!nv || !ov) continue;
      compared++;
      if (nv !== ov) {
        allEqual = false;
        break;
      }
    }
    if (compared >= 1 && allEqual) return i;
  }
  return -1;
}

/**
 * 部分相似（语义冲突候选）：主名称字段（字段索引 "2"）非空且与某已有行
 * 互为子串但不相等（如 "朱迪" vs "朱迪·霍普斯"），无法确定性判定同一实体。
 */
function findPartialSimilar(rows: Record<string, any>[], data: Record<string, string>): { rowNo: number; uid: string } | null {
  const v = normalize(data['2']);
  if (!v) return null;
  for (let i = 0; i < rows.length; i++) {
    const ov = normalize(rows[i]['2']);
    if (!ov || ov === v) continue;
    if (ov.includes(v) || v.includes(ov)) {
      return { rowNo: i + 1, uid: uidOf(rows[i]) || '(空)' };
    }
  }
  return null;
}

/**
 * AI 命令执行前 pre-flight 校验：冲突先暂停、核查修正、ID 统一后方可继续。
 *
 * 修正规则：
 *  - insertRow 唯一 ID 已存在于目标表 → 转 updateRow 指向已有行（只合并变更字段）
 *  - insertRow 关键名称字段与已有行完全一致但 ID 不同 → 转 updateRow 复用已有 ID
 *  - updateRow 修改字段 2（唯一id）且与原 ID 不同 → 剥离该字段修改
 *  - insertRow 唯一 ID 为空 → 拒绝执行
 *  - 部分相似的语义冲突 → 记入 unresolved，命令拒绝执行（由调用方暂停该章剩余分片）
 *
 * 批内后续命令可见前面命令的插入/更新（内部维护工作副本）。
 */
export function preFlightCheckCommands(
  commands: TableEditCommand[],
  tableData: WorkingTableLike
): PreFlightResult {
  const corrected: TableEditCommand[] = [];
  const rejected: TableEditCommand[] = [];
  const unresolved: string[] = [];
  const fixes: IdFixRecord[] = [];

  // 工作副本：批内命令的插入/更新对后续命令可见
  const rows: Record<string, Record<string, any>[]> = {};
  for (const s of tableData.sheets ?? []) {
    rows[s] = (tableData.data?.[s] ?? []).map((r) => ({ ...r }));
  }

  for (const cmd of commands) {
    const sheetName = (tableData.sheets ?? [])[cmd.tableIndex];
    if (!sheetName || cmd.type === 'deleteRow') {
      corrected.push(cmd);
      continue;
    }
    const sheetRows = rows[sheetName] ?? [];

    if (cmd.type === 'insertRow') {
      const data = { ...(cmd.data || {}) };
      const uid = normalize(data[UID_KEY]);

      if (!uid) {
        rejected.push(cmd);
        fixes.push({
          sheetName,
          action: 'rejectEmptyId',
          original: describeCommand(cmd),
          detail: 'insertRow 缺少唯一id（字段2），已拒绝执行',
        });
        continue;
      }

      const existingIdx = sheetRows.findIndex((r) => uidOf(r) === uid);
      if (existingIdx >= 0) {
        const { [SEQ_KEY]: _seq, [UID_KEY]: _uid, ...rest } = data;
        corrected.push({ type: 'updateRow', tableIndex: cmd.tableIndex, rowIndex: existingIdx, data: rest, rawCommand: cmd.rawCommand });
        sheetRows[existingIdx] = { ...sheetRows[existingIdx], ...rest };
        fixes.push({
          sheetName,
          action: 'insertToUpdate',
          original: `insertRow 唯一id=${uid}`,
          detail: `唯一id ${uid} 已存在（第 ${existingIdx + 1} 行），转 updateRow 合并更新`,
        });
        continue;
      }

      const sameEntityIdx = findSameEntity(sheetRows, data);
      if (sameEntityIdx >= 0) {
        const existingUid = uidOf(sheetRows[sameEntityIdx]) || '(空)';
        const { [SEQ_KEY]: _seq, [UID_KEY]: _uid, ...rest } = data;
        corrected.push({ type: 'updateRow', tableIndex: cmd.tableIndex, rowIndex: sameEntityIdx, data: rest, rawCommand: cmd.rawCommand });
        sheetRows[sameEntityIdx] = { ...sheetRows[sameEntityIdx], ...rest };
        fixes.push({
          sheetName,
          action: 'mergeSameEntity',
          original: `insertRow 唯一id=${uid}，名称字段=${NAME_FIELD_KEYS.map((k) => data[k]).filter(Boolean).join('/')}`,
          detail: `名称字段与第 ${sameEntityIdx + 1} 行（唯一id=${existingUid}）完全一致，判定同实体异ID，转 updateRow 复用已有ID`,
        });
        continue;
      }

      const partial = findPartialSimilar(sheetRows, data);
      if (partial) {
        const nameVal = String(data['2'] ?? '').trim();
        rejected.push(cmd);
        unresolved.push(
          `${sheetName} 疑似同实体异ID：新行唯一id=${uid}（名称字段"${nameVal}"）与第 ${partial.rowNo} 行（唯一id=${partial.uid}）名称仅部分相似，无法自动判定，需人工核查`
        );
        continue;
      }

      corrected.push(cmd);
      sheetRows.push({ ...data });
    } else if (cmd.type === 'updateRow') {
      const data = { ...(cmd.data || {}) };
      if (UID_KEY in data) {
        const existingUid =
          typeof cmd.rowIndex === 'number' && cmd.rowIndex >= 0 && cmd.rowIndex < sheetRows.length
            ? uidOf(sheetRows[cmd.rowIndex])
            : '';
        if (normalize(data[UID_KEY]) !== existingUid) {
          fixes.push({
            sheetName,
            action: 'stripIdChange',
            original: `updateRow 行${(cmd.rowIndex ?? 0) + 1} 唯一id ${existingUid || '(空)'} → ${String(data[UID_KEY]).trim()}`,
            detail: 'updateRow 试图修改唯一id，已剥离，保持原 ID',
          });
        }
        delete data[UID_KEY];
      }
      corrected.push({ ...cmd, data });
      if (typeof cmd.rowIndex === 'number' && cmd.rowIndex >= 0 && cmd.rowIndex < sheetRows.length) {
        sheetRows[cmd.rowIndex] = { ...sheetRows[cmd.rowIndex], ...data };
      }
    } else {
      corrected.push(cmd);
    }
  }

  return { corrected, rejected, unresolved, fixes };
}

/** preFlightCheckCommands 需要的最小表格结构（与 WritingTableData 兼容） */
export interface WorkingTableLike {
  sheets: string[];
  data?: Record<string, Record<string, any>[]>;
}

/**
 * 合成 ID 一致性报告。
 * @param scan 整理后终扫结果
 * @param baseline 整理前预扫描结果（用于标记「存量」问题，可缺省）
 * @param fixes 本次整理累计的自动修正记录
 * @param manualReview 需人工核查项
 * @param dedupRemoved 全局去重移除行数
 */
export function buildReport(
  scan: ScanResult,
  baseline: ScanResult | undefined,
  fixes: IdFixRecord[],
  manualReview: string[],
  dedupRemoved: number
): IdConsistencyReport {
  const sheets: IdSheetStats[] = scan.sheets.map((s) => {
    const base = baseline?.sheets.find((b) => b.sheetName === s.sheetName);
    // 缺 ID 行：按表内数量标记存量（整理新增行可能使行号漂移，按数量而非行号匹配）
    const missingPreExisting = Math.min(s.missingIdRows.length, base?.missingIdRows.length ?? 0);
    const duplicateIds: IdDuplicateGroup[] = s.duplicateIds.map((d) => ({
      ...d,
      preExisting: base?.duplicateIds.some((b) => b.id === d.id) ?? false,
    }));
    return { ...s, missingPreExisting, duplicateIds };
  });

  const danglingRefs: DanglingRef[] = scan.danglingRefs.map((d) => ({
    ...d,
    preExisting:
      baseline?.danglingRefs.some((b) => b.sheetName === d.sheetName && b.column === d.column && b.value === d.value) ?? false,
  }));

  const missingTotal = sheets.reduce((a, s) => a + s.missingIdRows.length, 0);
  const dupTotal = sheets.reduce((a, s) => a + s.duplicateIds.length, 0);
  const ok = missingTotal === 0 && dupTotal === 0 && danglingRefs.length === 0 && manualReview.length === 0;
  const summary = ok
    ? '校验通过：全部实体唯一 ID 完整且一致'
    : `缺ID ${missingTotal} 行、重复ID ${dupTotal} 组、悬空引用 ${danglingRefs.length} 处、自动修正 ${fixes.length} 条、需人工核查 ${manualReview.length} 项`;

  return { ok, sheets, danglingRefs, fixes, manualReview, dedupRemoved, summary };
}

/** 独立重扫（按需 ID 一致性检查，无修正、无去重记录） */
export function validateIdConsistency(tableData: WorkingTableLike): IdConsistencyReport {
  return buildReport(scanTableData(tableData as WritingTableData), undefined, [], [], 0);
}
