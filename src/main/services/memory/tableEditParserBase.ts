/**
 * TableEditParserBase —— tableEdit 命令解析器公共基类
 *
 * 背景：
 *  项目原有两个高度重复的解析器：
 *    - `src/main/services/memory/tableEditParser.ts`（对话/记忆/写作模式）
 *    - `src/main/services/game/GameTableEditParser.ts`（游戏模式）
 *  两者在「数据对象 JSON 容错解析」「命令行分派」「索引校验」等逻辑上几乎一致，
 *  但分别维护，导致 bug 修复不同步、行为易漂移。
 *
 * 职责（spec §一 F4 统一 + F3 越界校验）：
 *  1. 提供通用的「块提取」原语（按一组正则依次提取，剔除已消费部分避免重复）
 *  2. 提供通用的「数据对象 JSON 容错解析」（清理嵌套 HTML 注释 → 直接 parse → 规范化重试）
 *  3. 提供通用的「命令行分派 + 索引校验」原语（F3 越界校验统一在此实现）
 *  4. 提供通用的「字段索引 1-based → 0-based 转换」原语（含非负校验，跳过非法字段并警告）
 *
 * 不负责：
 *  - 对外 parse() 的返回结构（由两个适配层各自构造，保证对外 API 不变）
 *  - 标签提取策略与命令正则风格（由适配层通过 regexSpec / regexes 传入）
 *
 * 设计约束：
 *  - 所有校验失败一律「跳过 + 警告」，不抛异常、不中断整体流程（spec F3）
 *  - 对外 API 签名完全不变（spec F4 内部重构）
 */

import { createLogger } from '../logger';

const baseLogger = createLogger('tableEditParser');

/**
 * 内部统一日志函数（与既有 tableEditParser.ts 的 addLog 行为对齐）
 */
const logBase = (
  message: string,
  type: 'error' | 'warn' | 'info' | 'debug' = 'info'
): void => {
  switch (type) {
    case 'error':
      baseLogger.error(message);
      break;
    case 'warn':
      baseLogger.warn(message);
      break;
    case 'debug':
      baseLogger.debug(message);
      break;
    default:
      baseLogger.info(message);
      break;
  }
};

// ==================== 公共类型 ====================

/**
 * 三种命令正则规格（适配层各自提供，决定 anchored / flags 风格）
 */
export interface CommandRegexSpec {
  insertRow: RegExp;
  updateRow: RegExp;
  deleteRow: RegExp;
}

/**
 * 命令解析的中间统一表示。
 *
 * 适配层负责将其转换为各自的对外命令结构（TableEditCommand / GameTableEditCommand）。
 */
export interface ParsedCommandCore {
  kind: 'insertRow' | 'updateRow' | 'deleteRow';
  /** 表格索引：根据 opts.convertIndicesToZeroBased 决定 0-based 或 1-based */
  sheetIndex: number;
  /** 行索引：insertRow 时无此字段；其余根据 opts 决定 0-based 或 1-based */
  rowIndex?: number;
  /** 行数据：insertRow / updateRow 时存在；字段索引根据 opts.convertFieldIndices 决定是否转换 */
  data?: Record<string, string>;
  /** 原始命令文本（用于审计与错误定位） */
  raw: string;
}

/**
 * 命令解析选项
 */
export interface ParseLineOptions {
  /**
   * 是否将 sheetIndex / rowIndex 从 1-based 转换为 0-based。
   * - memory 适配层：true（parser 阶段转换，executor 直接用）
   * - game 适配层：false（保持 1-based，由 GameTableRepository.applyTableEdits 转换）
   */
  convertIndicesToZeroBased: boolean;
  /**
   * 是否将 data 的数字字段键从 1-based 转换为 0-based。
   * - memory 适配层：true
   * - game 适配层：false（保持原样）
   */
  convertFieldIndices: boolean;
  /**
   * 字段索引范围校验上限（0-based，可选）。
   * 未提供（undefined）时仅做整数与非负校验，不做范围校验。
   * parser 阶段通常不知道列数，列范围校验留给 executor。
   */
  maxColumnIndex?: number;
  /** 日志前缀（用于区分调用方） */
  logPrefix: string;
}

// ==================== 基类实现 ====================

export abstract class TableEditParserBase {
  // ---------- 块提取 ----------

  /**
   * 按一组正则依次从 text 中提取块内容（捕获组 1）。
   *
   * 为避免后续正则重复消费前面正则已匹配的部分，每轮正则执行完毕后，
   * 将原 text 中已被该正则匹配的部分剔除，再交给下一轮正则。
   *
   * 与原 GameTableEditParser.extractBlocks + parse 中「先注释块、后裸标签块」
   * 的去重策略等价；同时也兼容 memory 适配层单正则提取的场景。
   */
  protected extractBlocks(text: string, regexes: RegExp[]): string[] {
    const blocks: string[] = [];
    let current = text;

    for (const regex of regexes) {
      // 必须重新构造 RegExp 实例：带 g 标志的正则在 exec/test 时会维护 lastIndex，
      // 全局复用会导致漏匹配
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(current)) !== null) {
        const content = match[1];
        if (content && content.trim().length > 0) {
          blocks.push(content);
        }
      }
      // 剔除已匹配部分，避免下一轮正则重复提取
      if (blocks.length > 0) {
        current = current.replace(regex, '');
      }
    }

    return blocks;
  }

  // ---------- 数据对象解析 ----------

  /**
   * 解析 JSON 数据对象（容错策略，与既有两个 parser 行为完全对齐）。
   *
   * 1. 清理内嵌的 HTML 注释（如 `"朱迪<!-- 药 -->"` → `"朱迪"`）
   * 2. 尝试直接 JSON.parse
   * 3. 失败则规范化（给未加引号的键名加引号、单引号转双引号、清理尾逗号）后重试
   * 4. 仍失败则返回 null（调用方决定如何记入 errors）
   *
   * @returns 解析后的键值对象（值为字符串），失败返回 null
   */
  protected parseDataObject(dataStr: string): Record<string, string> | null {
    // 1. 清理嵌套 HTML 注释
    const cleaned = dataStr.replace(/<!--[\s\S]*?-->/g, '');

    // 2. 直接解析
    try {
      const parsed = JSON.parse(cleaned);
      if (this.isPlainObject(parsed)) {
        return this.toStringValueMap(parsed);
      }
    } catch {
      // 进入规范化重试路径
    }

    // 3. 规范化后重试
    try {
      const normalized = this.normalizeJsonObject(cleaned);
      const parsed = JSON.parse(normalized);
      if (this.isPlainObject(parsed)) {
        return this.toStringValueMap(parsed);
      }
    } catch {
      // 解析彻底失败
    }

    return null;
  }

  /**
   * 规范化 JSON 字符串（处理 AI 可能输出的非标准格式）。
   *
   * 处理顺序（重要）：
   * 1. 未加引号的键名 → 加双引号
   * 2. 单引号键名 → 双引号
   * 3. 单引号字符串值 → 双引号
   * 4. 清理尾逗号
   *
   * 注意：此方法可能破坏已包含冒号的合法 JSON 值（如 "00:00"），
   * 因此仅在直接 JSON.parse 失败时作为兜底使用。
   */
  protected normalizeJsonObject(str: string): string {
    let normalized = str.trim();

    // 1. 给未加引号的键名加双引号（如 {key: "value"} → {"key": "value"}）
    normalized = normalized.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');
    // 处理开头未加引号的键名
    normalized = normalized.replace(/^\s*(\w+)\s*:/, '"$1":');

    // 2. 单引号键名转双引号（如 {'key': ...} → {"key": ...}）
    //    必须在单引号值转换之前执行，避免误吞键名末尾的冒号
    normalized = normalized.replace(/(\{|,)\s*'([^']+?)'\s*:/g, '$1"$2":');

    // 3. 单引号字符串值转双引号
    normalized = normalized.replace(/:\s*'([^']*)'/g, ':"$1"');

    // 4. 清理尾逗号
    normalized = normalized.replace(/,\s*}/g, '}');
    normalized = normalized.replace(/,\s*]/g, ']');

    return normalized;
  }

  /**
   * 判断值是否为普通对象（非 null、非数组）
   */
  protected isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * 将对象的所有值转换为字符串（数字/布尔等也转字符串）。
   *
   * 与既有 parser 行为对齐，统一 rowData 的值类型：
   *  - null/undefined → ''
   *  - 嵌套对象/数组 → JSON 序列化（容错，罕见但需处理）
   *  - 其他 → String(value)
   */
  protected toStringValueMap(obj: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        result[key] = '';
      } else if (typeof value === 'object') {
        try {
          result[key] = JSON.stringify(value);
        } catch {
          result[key] = String(value);
        }
      } else {
        result[key] = String(value);
      }
    }
    return result;
  }

  // ---------- 字段索引转换（F3 越界校验） ----------

  /**
   * 将 data 的数字字段键从 1-based 转换为 0-based，并做非负校验。
   *
   * F3 校验规则（spec §一 F3）：
   *  - 仅对「纯整数键」做转换（含字符串形式的数字，如 "2"）
   *  - 转换后索引 < 0 时（即原键为 "0" 或负数）**跳过该字段**并记录警告（不崩溃）
   *  - 若提供 maxColumnIndex，转换后索引 > maxColumnIndex 时**跳过该字段**并警告
   *  - 非整数键（命名键，如 "name"）保持原样不转换（容错：AI 偶尔输出命名键）
   *
   * 注意：
   *  - 此方法只跳过「非法字段」，不会因单字段失败而丢弃整条命令
   *  - 「整条命令跳过」由 buildInsertCore/buildUpdateCore 在 sheetIndex/rowIndex 校验失败时处理
   *
   * @param data 原始数据对象
   * @param maxColumnIndex 当前 sheet 的最大列索引（0-based），可选；
   *                       未提供时仅做整数与非负校验
   * @returns 转换后的数据对象
   */
  protected convertFieldIndicesToZeroBased(
    data: Record<string, string>,
    maxColumnIndex?: number
  ): Record<string, string> {
    const converted: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      const numericKey = Number(key);
      if (Number.isInteger(numericKey)) {
        const zeroBased = numericKey - 1;
        if (zeroBased < 0) {
          logBase(
            `TableEditParserBase: 字段索引 ${key} 转换后为 ${zeroBased}（< 0），跳过该字段`,
            'warn'
          );
          continue;
        }
        if (maxColumnIndex !== undefined && zeroBased > maxColumnIndex) {
          logBase(
            `TableEditParserBase: 字段索引 ${key} 转换后为 ${zeroBased} 超出列范围 [0, ${maxColumnIndex}]，跳过该字段`,
            'warn'
          );
          continue;
        }
        converted[String(zeroBased)] = value;
      } else {
        // 非整数键（命名键）：保持原样，不转换（容错）
        converted[key] = value;
      }
    }

    return converted;
  }

  // ---------- 命令索引校验（F3 越界校验） ----------

  /**
   * 校验索引为正整数（1-based 协议下最小为 1）。
   * 用于 sheetIndex / rowIndex 的原始值校验（转换前）。
   */
  protected validatePositiveIndex(...values: number[]): boolean {
    return values.every(v => Number.isInteger(v) && v >= 1);
  }

  /**
   * 校验索引为非负整数（0-based 协议下最小为 0）。
   * 用于转换后的索引校验（如 executor 阶段）。
   */
  protected validateNonNegativeIndex(...values: number[]): boolean {
    return values.every(v => Number.isInteger(v) && v >= 0);
  }

  // ---------- 命令行分派（核心） ----------

  /**
   * 尝试用三种命令正则匹配单行，返回统一的中间结构 ParsedCommandCore。
   *
   * 分派顺序：updateRow → insertRow → deleteRow（参数最多的优先）。
   * 由于各正则都包含命令名（insertRow/updateRow/deleteRow），
   * 一行不可能同时匹配多个命令正则，因此顺序不影响结果，
   * 但「参数最多优先」是更稳健的工程实践。
   *
   * 校验失败（索引非整数 / 越界 / 数据解析失败）一律返回 null 并记录警告，
   * 不抛异常（spec F3）。
   *
   * @param line 已 trim 的单行命令文本
   * @param regexSpec 三种命令的正则规格（由适配层提供）
   * @param opts 解析选项（索引转换、字段转换、日志前缀等）
   * @returns 解析成功返回 ParsedCommandCore，无法匹配或校验失败返回 null
   */
  protected tryParseLine(
    line: string,
    regexSpec: CommandRegexSpec,
    opts: ParseLineOptions
  ): ParsedCommandCore | null {
    // 1. updateRow（参数最多，优先匹配）
    const updateRe = new RegExp(regexSpec.updateRow.source, regexSpec.updateRow.flags);
    const updateMatch = updateRe.exec(line);
    if (updateMatch) {
      return this.buildUpdateCore(updateMatch, line, opts);
    }

    // 2. insertRow
    const insertRe = new RegExp(regexSpec.insertRow.source, regexSpec.insertRow.flags);
    const insertMatch = insertRe.exec(line);
    if (insertMatch) {
      return this.buildInsertCore(insertMatch, line, opts);
    }

    // 3. deleteRow
    const deleteRe = new RegExp(regexSpec.deleteRow.source, regexSpec.deleteRow.flags);
    const deleteMatch = deleteRe.exec(line);
    if (deleteMatch) {
      return this.buildDeleteCore(deleteMatch, line, opts);
    }

    return null;
  }

  // ---------- 内部：命令构造（含 F3 校验） ----------

  private buildInsertCore(
    match: RegExpExecArray,
    raw: string,
    opts: ParseLineOptions
  ): ParsedCommandCore | null {
    const sheetIndexRaw = parseInt(match[1], 10);
    const dataStr = match[2];

    // F3: sheetIndex 整数与正整数校验（1-based 协议最小为 1）
    if (!this.validatePositiveIndex(sheetIndexRaw)) {
      logBase(
        `${opts.logPrefix}: insertRow sheetIndex 无效 (${sheetIndexRaw})，跳过该命令: ${raw.substring(0, 80)}`,
        'warn'
      );
      return null;
    }

    const data = this.parseDataObject(dataStr);
    if (data === null) {
      logBase(
        `${opts.logPrefix}: insertRow 数据解析失败: ${dataStr}`,
        'error'
      );
      return null;
    }

    // F3: 字段索引转换 + 非负校验（仅当 convertFieldIndices=true）
    const finalData = opts.convertFieldIndices
      ? this.convertFieldIndicesToZeroBased(data, opts.maxColumnIndex)
      : data;

    // sheetIndex 转换（1-based → 0-based）
    const finalSheetIndex = opts.convertIndicesToZeroBased
      ? sheetIndexRaw - 1
      : sheetIndexRaw;

    return {
      kind: 'insertRow',
      sheetIndex: finalSheetIndex,
      data: finalData,
      raw
    };
  }

  private buildUpdateCore(
    match: RegExpExecArray,
    raw: string,
    opts: ParseLineOptions
  ): ParsedCommandCore | null {
    const sheetIndexRaw = parseInt(match[1], 10);
    const rowIndexRaw = parseInt(match[2], 10);
    const dataStr = match[3];

    // F3: sheetIndex/rowIndex 整数与正整数校验
    if (!this.validatePositiveIndex(sheetIndexRaw, rowIndexRaw)) {
      logBase(
        `${opts.logPrefix}: updateRow 索引无效 (sheet=${sheetIndexRaw}, row=${rowIndexRaw})，跳过该命令: ${raw.substring(0, 80)}`,
        'warn'
      );
      return null;
    }

    const data = this.parseDataObject(dataStr);
    if (data === null) {
      logBase(
        `${opts.logPrefix}: updateRow 数据解析失败: ${dataStr}`,
        'error'
      );
      return null;
    }

    const finalData = opts.convertFieldIndices
      ? this.convertFieldIndicesToZeroBased(data, opts.maxColumnIndex)
      : data;

    const finalSheetIndex = opts.convertIndicesToZeroBased
      ? sheetIndexRaw - 1
      : sheetIndexRaw;
    const finalRowIndex = opts.convertIndicesToZeroBased
      ? rowIndexRaw - 1
      : rowIndexRaw;

    return {
      kind: 'updateRow',
      sheetIndex: finalSheetIndex,
      rowIndex: finalRowIndex,
      data: finalData,
      raw
    };
  }

  private buildDeleteCore(
    match: RegExpExecArray,
    raw: string,
    opts: ParseLineOptions
  ): ParsedCommandCore | null {
    const sheetIndexRaw = parseInt(match[1], 10);
    const rowIndexRaw = parseInt(match[2], 10);

    // F3: sheetIndex/rowIndex 整数与正整数校验
    if (!this.validatePositiveIndex(sheetIndexRaw, rowIndexRaw)) {
      logBase(
        `${opts.logPrefix}: deleteRow 索引无效 (sheet=${sheetIndexRaw}, row=${rowIndexRaw})，跳过该命令: ${raw.substring(0, 80)}`,
        'warn'
      );
      return null;
    }

    const finalSheetIndex = opts.convertIndicesToZeroBased
      ? sheetIndexRaw - 1
      : sheetIndexRaw;
    const finalRowIndex = opts.convertIndicesToZeroBased
      ? rowIndexRaw - 1
      : rowIndexRaw;

    return {
      kind: 'deleteRow',
      sheetIndex: finalSheetIndex,
      rowIndex: finalRowIndex,
      raw
    };
  }
}
