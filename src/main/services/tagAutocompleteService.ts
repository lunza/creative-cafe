/**
 * TagAutocompleteService — 主进程标签自动推荐服务
 *
 * 来源：spec: implement-local-tag-autocomplete / Task 2
 *       §Requirement: Tag Library Data Loading
 *       §Requirement: Real-time Tag Search
 *       §Requirement: Configurable Sorting
 *
 * 职责：
 *  1. 加载 CSV 标签库（流式逐行解析，不依赖第三方 CSV 库）
 *  2. 构建 Map<string, TagInfo> 内存索引（key=name 小写，value=完整 TagInfo）
 *  3. 延迟加载：首次 search 时触发，加载期间 await loadPromise
 *  4. 子串匹配查询（name + aliases，大小写不敏感）
 *  5. 三种排序（relevance / count / alphabetical）
 *  6. reload / getLoadStatus 管理接口
 *
 * 设计约束：
 *  - 仅使用 Node.js 内置 fs + readline，不引入第三方 CSV 解析库
 *  - 禁用 any，所有方法签名明确（tsconfig strict + noUnusedLocals + noUnusedParameters）
 *  - 错误不中断主进程：loadInternal 捕获所有异常，记录到 loadError，loaded 保持 false
 *  - 单例导出，主进程共享（IPC handler 与其他服务复用）
 *
 * 性能：
 *  - 加载 31.7 万条 ≈ 1-2 秒（readline 流式 + Map.set）
 *  - 单次 search 遍历 31.7 万条 ≈ 50ms（纯内存 includes；不构建前缀树，保持简单实现）
 *
 * 加载策略说明（与 spec 对齐）：
 *  - search() 内部 await ensureLoaded()：首次查询触发加载并等待完成后自动执行查询
 *    （满足 spec "加载完成后自动执行该次查询并返回结果"）
 *  - 加载期间调用方（IPC handler）的 invoke 处于 pending 态，渲染进程可据此展示 loading
 *  - getLoadStatus() 单独暴露 loading/loaded/error，供设置面板与加载状态提示复用
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { EventEmitter } from 'events';
import { createLogger } from './logger';
import type {
  TagInfo,
  TagSearchResult,
  TagSortBy,
  TagSearchRequest,
  TagSearchResponse,
  TagLoadStatus,
  TagReloadResult,
  TagMatchType,
} from '../../shared/types/tag.types';

const logger = createLogger('tag-autocomplete-service');

/**
 * 标签库 CSV 加载事件发射器。
 *
 * 事件：`tag-csv-loaded` — 载荷 `{ csvPath, csvHash, totalCount }`
 *
 * 用途：TagRagService 监听此事件，比对 csvHash 与索引 meta 中的 csvHash，
 * 不匹配时标记索引为 stale（需重新向量化）。
 */
export const tagCsvEmitter = new EventEmitter();

/** 默认返回结果上限（spec: top-50） */
const DEFAULT_LIMIT = 50;

/** 预置 CSV 标签库文件名（随项目分发，位于 docs/ 目录） */
const BUNDLED_CSV_FILENAME = 'danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv';

/**
 * 解析预置 CSV 标签库的绝对路径。
 *
 * 路径解析策略（与 logPathService.getLogBaseDir 一致）：
 *  1. 优先使用 Electron app.getAppPath()（生产环境 = 安装目录，开发环境 = 项目根目录）
 *  2. 降级方案：通过 __dirname 向上推导到项目根目录
 *     （src/main/services/tagAutocompleteService.ts → 项目根目录 = 向上 3 层）
 *
 * 最终路径：<appPath>/docs/<BUNDLED_CSV_FILENAME>
 */
function resolveBundledCsvPath(): string {
  try {
    // 优先使用 Electron 应用的安装路径
    const { app } = require('electron');
    const appPath = app.getAppPath();
    return path.join(appPath, 'docs', BUNDLED_CSV_FILENAME);
  } catch (e) {
    // 降级方案：__dirname 向上推导到项目根目录
    // src/main/services/tagAutocompleteService.ts -> 项目根目录
    const projectRoot = path.join(__dirname, '..', '..', '..');
    return path.join(projectRoot, 'docs', BUNDLED_CSV_FILENAME);
  }
}

/**
 * 默认 CSV 标签库路径（用户未配置 csvPath 时使用）。
 * 指向项目内置的 docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv（约 8MB，31.7 万条 tag）。
 * 本服务不与 settingStore 硬耦合：外部可通过 reload(csvPath) 注入新路径。
 */
const DEFAULT_CSV_PATH = resolveBundledCsvPath();

/**
 * CSV 行解析正则。
 *
 * 匹配格式：`tag_name,category,count` + 可选的 `,别名部分`
 *  - 第 1 组：tag_name（不含逗号；Danbooru tag 名不含逗号，安全）
 *  - 第 2 组：category（数字）
 *  - 第 3 组：count（数字）
 *  - 第 4 组（可选）：别名部分的原始字符串（由 parseAliases 进一步处理）
 *
 * ⚠️ 2026-08-06 修复：原正则要求第 4 列必须用双引号包裹（`,"([^"]*)"`），
 * 但实际 CSV 中 96% 的行别名不带引号（如 `shirt,0,2937876,shirts`），
 * 导致 31.7 万条中只加载了 1.2 万条。现改为第 4 列可选且不强制引号，
 * 由 parseAliases 兼容带引号 / 不带引号 / 空 / 缺失四种情况。
 * 详见 docs/FIX_RECORDS.md §6.4。
 */
const CSV_LINE_REGEX = /^([^,]+),(\d+),(\d+)(?:,(.*))?$/;

/** UTF-8 BOM（部分编辑器保存 CSV 时会写入，需剥离避免污染首行 tag_name） */
const UTF8_BOM = '\uFEFF';

/** matchType → 排序优先级（数字越小优先级越高：prefix > includes > alias） */
const MATCH_TYPE_PRIORITY: Record<TagMatchType, number> = {
  prefix: 0,
  includes: 1,
  alias: 2,
};

class TagAutocompleteService {
  /**
   * 内存索引：key = name.toLowerCase()，value = 完整 TagInfo（保留原始大小写）。
   * 约 31.7 万条，预估占用 50-80MB 内存（可接受）。
   */
  private tagMap: Map<string, TagInfo> = new Map();

  /**
   * 别名反向索引：key = alias.toLowerCase()，value = 对应的 TagInfo。
   *
   * 用于标签验证时按别名查找（getTagByAlias），补全 tagMap 只能按 name 查找的不足。
   * 构建：loadInternal 解析每个 tag 的 aliases 数组后，对每个 alias 执行 set。
   * 冲突策略：同 alias 被多个 tag 标注时，保留 count 更高的 tag（count 高 = 训练样本多 = 更主流）。
   * 内存增量：约 80-100 万条目，~50-80MB（与 tagMap 同级，可接受）。
   */
  private aliasMap: Map<string, TagInfo> = new Map();

  /** 是否已加载完成（成功） */
  private loaded: boolean = false;

  /** 是否正在加载中（防止并发触发） */
  private loading: boolean = false;

  /** 当前 CSV 文件路径（加载后更新；'' 表示尚未配置，将使用 DEFAULT_CSV_PATH） */
  private csvPath: string = '';

  /** 加载错误信息（加载失败时设置，成功时清空） */
  private loadError: string | undefined;

  /** 进行中的加载 Promise（并发去重；加载完成或失败后置 null） */
  private loadPromise: Promise<void> | null = null;

  // -------------------- 加载 --------------------

  /**
   * 确保标签库已加载（延迟加载入口）。
   *
   * - 已加载成功 → 立即返回
   * - 正在加载中 → 返回已有 loadPromise（避免重复触发，多个调用方共享同一加载过程）
   * - 未加载（首次 / 加载失败后重试）→ 触发 loadInternal
   *
   * 调用方（search / reload）应 await 本方法，加载完成后再执行后续逻辑。
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loading && this.loadPromise) {
      return this.loadPromise;
    }
    const pathToLoad = this.csvPath || DEFAULT_CSV_PATH;
    this.loadPromise = this.loadInternal(pathToLoad);
    return this.loadPromise;
  }

  /**
   * 加载 CSV 文件到内存索引。
   *
   * 流程：
   *  1. 标记 loading=true，清空旧 error，清空旧索引（reload 场景避免残留）
   *  2. 校验文件存在（不存在抛错，捕获后设置 loadError）
   *  3. createReadStream + readline 逐行解析（crlfDelay:Infinity 统一处理换行符）
   *  4. 每行用 CSV_LINE_REGEX 解析为 TagInfo，存入 tagMap（key=name 小写）
   *  5. 完成 → loaded=true；异常 → loadError=消息，loaded=false
   *  6. finally 重置 loading=false、loadPromise=null
   *
   * @param csvPath CSV 文件绝对路径
   */
  private async loadInternal(csvPath: string): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    this.csvPath = csvPath;
    this.tagMap.clear();
    this.aliasMap.clear();

    try {
      if (!fs.existsSync(csvPath)) {
        throw new Error(`文件不存在: ${csvPath}`);
      }

      const fileStream = fs.createReadStream(csvPath, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity, // 统一处理 \r\n / \n / \r
      });

      let count = 0;
      for await (const line of rl) {
        const parsed = this.parseCsvLine(line);
        if (parsed) {
          this.tagMap.set(parsed.name.toLowerCase(), parsed);
          count++;
          // 构建 alias 反向索引：对每个 alias 执行 set，冲突时保留 count 更高的 tag
          for (const alias of parsed.aliases) {
            const key = alias.toLowerCase();
            if (!key) continue;
            const existing = this.aliasMap.get(key);
            // 未占用 或 新 tag 的 count 更高时覆盖（count 高 = 训练样本多 = 更主流）
            if (!existing || (parsed.count || 0) > (existing.count || 0)) {
              this.aliasMap.set(key, parsed);
            }
          }
        }
      }

      this.loaded = true;
      logger.info(`标签库加载完成: ${count} tags, ${this.aliasMap.size} aliases from ${csvPath}`);

      // 广播 CSV 加载完成事件（含 csvHash），供 TagRagService 比对索引指纹
      this.notifyCsvLoaded(csvPath, count);
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      this.loaded = false;
      logger.error('标签库加载失败', this.loadError);
    } finally {
      this.loading = false;
      this.loadPromise = null;
    }
  }

  /**
   * 解析单行 CSV 为 TagInfo。
   *
   * 格式：`tag_name,category,count` + 可选的 `,别名部分`
   *  - 剥离行首 UTF-8 BOM（仅首行可能存在，逐行剥离无副作用）
   *  - 第 4 列（别名）可选；存在时由 parseAliases 处理（兼容带引号 / 不带引号）
   *  - 解析失败（空行 / 表头 / 格式不符）返回 null，调用方跳过
   *
   * @param line CSV 单行（不含换行符）
   * @returns TagInfo 或 null
   */
  private parseCsvLine(line: string): TagInfo | null {
    // 剥离行首 BOM（仅对首行有效，其他行无副作用）
    const cleaned = line.startsWith(UTF8_BOM) ? line.slice(UTF8_BOM.length) : line;
    const match = CSV_LINE_REGEX.exec(cleaned);
    if (!match) return null;

    const name = match[1];
    const category = parseInt(match[2], 10);
    const count = parseInt(match[3], 10);
    const aliasesRaw = match[4]; // 可能为 undefined（无第 4 列）或空字符串（末尾逗号）

    const aliases: string[] = this.parseAliases(aliasesRaw);

    return { name, category, count, aliases };
  }

  /**
   * 解析别名字段为别名数组。
   *
   * CSV 文件中别名列有多种格式（2026-08-06 修复后兼容）：
   *  1. 带引号（别名中可能含逗号）: `"alone,female_solo,single"`
   *  2. 不带引号（别名中不含逗号）: `shirts` 或 `/ngirls`
   *  3. 空字符串（末尾逗号但无内容）: ``（空）
   *  4. 缺失（无第 4 列）: undefined
   *
   * 带引号格式中，CSV 转义的双引号（`""`）还原为单引号 `"`。
   *
   * @param raw 别名列原始字符串（可能为 undefined / 空串 / 带引号 / 不带引号）
   * @returns 别名数组（已 trim + 过滤空串）
   */
  private parseAliases(raw: string | undefined): string[] {
    if (!raw) return [];

    let aliasContent: string;
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      // 带引号格式：剥离首尾引号，还原 CSV 转义的双引号（"" → "）
      aliasContent = raw.slice(1, -1).replace(/""/g, '"');
    } else {
      // 不带引号格式：直接使用原始内容
      aliasContent = raw;
    }

    return aliasContent
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }

  // -------------------- 查询 --------------------

  /**
   * 子串匹配查询。
   *
   * 流程：
   *  1. await ensureLoaded()（首次触发加载并等待完成；加载失败返回 error）
   *  2. 空查询 → 返回空结果
   *  3. 遍历 tagMap，对每条 tag 判定 matchType：
   *     - name（小写）以 query（小写）开头 → 'prefix'
   *     - name（小写）包含 query（小写）但非开头 → 'includes'
   *     - 否则检查 aliases，任一别名（小写）包含 query → 'alias'
   *     - 都不匹配 → 跳过
   *  4. 按 sortBy 排序（relevance / count / alphabetical）
   *  5. 截断到 limit（默认 50，上限 50）
   *
   * @param request 查询请求（query / sortBy? / limit?）
   * @returns 查询响应
   */
  async search(request: TagSearchRequest): Promise<TagSearchResponse> {
    // 延迟加载：首次调用触发，加载完成后自动执行本次查询
    await this.ensureLoaded();

    // 加载失败 → 返回错误（不抛异常给调用方）
    if (this.loadError && !this.loaded) {
      return {
        success: false,
        results: [],
        total: 0,
        error: this.loadError,
      };
    }

    const query = (request.query ?? '').trim();
    if (!query) {
      return { success: true, results: [], total: 0 };
    }

    const queryLower = query.toLowerCase();
    const sortBy: TagSortBy = request.sortBy ?? 'relevance';
    const requestedLimit = request.limit ?? DEFAULT_LIMIT;
    // 限制上限为 DEFAULT_LIMIT，下限为 0（负数视为 0 → 返回空）
    const effectiveLimit = Math.max(0, Math.min(requestedLimit, DEFAULT_LIMIT));

    // 遍历索引收集匹配项（Map key 已是小写，无需重复 toLowerCase）
    const matched: TagSearchResult[] = [];
    for (const [lowerName, tag] of this.tagMap) {
      let matchType: TagMatchType | null = null;

      // name 匹配判定（prefix 优先于 includes）
      if (lowerName.startsWith(queryLower)) {
        matchType = 'prefix';
      } else if (lowerName.includes(queryLower)) {
        matchType = 'includes';
      } else if (tag.aliases.length > 0) {
        // name 不匹配 → 检查别名（大小写不敏感子串匹配）
        for (const alias of tag.aliases) {
          if (alias.toLowerCase().includes(queryLower)) {
            matchType = 'alias';
            break;
          }
        }
      }

      if (matchType) {
        matched.push({ ...tag, matchType });
      }
    }

    // 排序
    this.sortResults(matched, sortBy);

    // 截断到 limit
    const results = effectiveLimit > 0 ? matched.slice(0, effectiveLimit) : [];

    return {
      success: true,
      results,
      total: matched.length,
    };
  }

  /**
   * 按指定规则对结果排序（原地排序）。
   *
   * - relevance：先按 matchType 优先级（prefix > includes > alias），同级内按 count 降序
   * - count：纯按 count 降序（高频 tag 优先）
   * - alphabetical：按 name 字母升序（localeCompare，A-Z）
   *
   * @param results 结果数组（原地排序）
   * @param sortBy 排序规则
   */
  private sortResults(results: TagSearchResult[], sortBy: TagSortBy): void {
    switch (sortBy) {
      case 'relevance':
        results.sort((a, b) => {
          const pa = MATCH_TYPE_PRIORITY[a.matchType];
          const pb = MATCH_TYPE_PRIORITY[b.matchType];
          if (pa !== pb) return pa - pb; // matchType 优先级升序
          return b.count - a.count; // 同级 count 降序
        });
        break;
      case 'count':
        results.sort((a, b) => b.count - a.count);
        break;
      case 'alphabetical':
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
  }

  /**
   * 获取所有已加载标签的完整副本（供 TagRagService 向量化使用）。
   *
   * @returns TagInfo 数组（从 tagMap values 提取），未加载时返回空数组
   */
  getAllTags(): TagInfo[] {
    if (!this.loaded) return [];
    return Array.from(this.tagMap.values());
  }

  /**
   * 检查标签是否存在于标签库中（大小写不敏感）。
   *
   * 用于 RAG 质检：AI 生成特征后，验证每个 tag 是否在 Danbooru/e621 标签库中。
   * tagMap 的 key 为 name.toLowerCase()，故直接用 lowerCase 查找。
   *
   * @param tagName 待验证的标签名
   * @returns 存在则返回 TagInfo，不存在返回 null
   */
  getTagByName(tagName: string): TagInfo | null {
    if (!this.loaded || !tagName) return null;
    return this.tagMap.get(tagName.toLowerCase()) ?? null;
  }

  /**
   * 按别名查找标签（大小写不敏感）。
   *
   * 用于 RAG 质检的 L2 alias 匹配层：当 tag 不在任何 tag 的 name 中，
   * 但在某个 tag 的 aliases 中时（如 slender 是 slim 的别名），通过本方法命中。
   *
   * aliasMap 的 key 为 alias.toLowerCase()，故直接用 lowerCase 查找。
   * 冲突策略在构建时已处理（保留 count 更高的），此处直接返回。
   *
   * @param alias 待查找的别名
   * @returns 存在则返回 TagInfo，不存在返回 null
   */
  getTagByAlias(alias: string): TagInfo | null {
    if (!this.loaded || !alias) return null;
    return this.aliasMap.get(alias.toLowerCase()) ?? null;
  }

  /**
   * 计算 CSV 文件指纹并广播 `tag-csv-loaded` 事件。
   *
   * 指纹算法：sha256(csvPath + ':' + fileSize + ':' + mtimeMs).slice(0,16)
   * —— 不读取文件内容（8MB 文件哈希耗时 ~50ms），仅用路径+大小+修改时间，
   *    足以检测文件替换/更新场景，性能优于全文件哈希。
   *
   * 失败不阻塞主流程（哈希计算异常时静默跳过）。
   */
  private notifyCsvLoaded(csvPath: string, count: number): void {
    try {
      const crypto = require('crypto');
      const stat = fs.statSync(csvPath);
      const hash = crypto
        .createHash('sha256')
        .update(`${csvPath}:${stat.size}:${stat.mtimeMs}`)
        .digest('hex')
        .slice(0, 16);
      tagCsvEmitter.emit('tag-csv-loaded', { csvPath, csvHash: hash, totalCount: count });
    } catch (err) {
      logger.warn('计算 CSV 哈希失败，跳过事件广播:', err instanceof Error ? err.message : String(err));
    }
  }

  // -------------------- 状态管理 --------------------

  /**
   * 获取当前加载状态快照。
   *
   * 供 tag:getLoadStatus IPC 与设置面板展示加载进度 / 错误 / 标签总数使用。
   *
   * @returns TagLoadStatus
   */
  getLoadStatus(): TagLoadStatus {
    return {
      loaded: this.loaded,
      loading: this.loading,
      totalCount: this.tagMap.size,
      csvPath: this.csvPath,
      error: this.loadError,
    };
  }

  /**
   * 重新加载标签库。
   *
   * - 传入 csvPath 时更新配置路径（用于切换 CSV 文件后重新加载）
   * - 重置 loaded=false + 清空 error，触发 ensureLoaded 重新加载
   * - 等待加载完成后返回结果（success / totalCount / error?）
   *
   * @param csvPath 可选，新的 CSV 文件路径；不传则沿用当前 csvPath
   * @returns TagReloadResult
   */
  async reload(csvPath?: string): Promise<TagReloadResult> {
    if (csvPath) {
      this.csvPath = csvPath;
    }
    // 重置状态以便 ensureLoaded 重新触发加载
    this.loaded = false;
    this.loadError = undefined;

    await this.ensureLoaded();

    if (this.loadError) {
      return {
        success: false,
        totalCount: this.tagMap.size,
        error: this.loadError,
      };
    }

    return {
      success: true,
      totalCount: this.tagMap.size,
    };
  }
}

/** TagAutocompleteService 单例（主进程共享，IPC handler 与其他服务复用） */
export const tagAutocompleteService = new TagAutocompleteService();
