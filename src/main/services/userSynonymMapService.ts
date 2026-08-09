/**
 * 用户自定义同义词映射表服务（主进程）
 *
 * Spec: add-multi-round-tag-audit / Task 1
 *
 * 用途：
 *  - 持久化用户在「末轮人工审核入口」指定的标签替换映射（跨会话保留）
 *  - tagRagService.validateTagsAgainstLibrary 在 L1 之前查询本表（L0），
 *    人工审核结果下次同词首轮即命中
 *  - 撤销手动替换时删除对应映射（用户撤销 = 映射不正确）
 *
 * 存储路径设计（参考 categoryDictionaryService）：
 *  - 文件路径：`{userData}/data/user-synonym-map.json`
 *  - 文件结构：`Record<originalTagLowercase, replacementTag>`（扁平键值对）
 *  - 使用 `getUserDataPath()`（来自 `../utils/appPath`）解析 userData 根目录，
 *    与 characterTraitService / categoryDictionaryService 一致
 *
 * I/O 模式：
 *  - 同步 `fs.readFileSync` / `fs.writeFileSync` / `fs.existsSync` / `fs.mkdirSync`
 *  - 映射表预期很小（数十到数百条），同步 I/O 不会阻塞主进程事件循环
 *  - 与 categoryDictionaryService 一致采用同步 API，简化 IPC 调用链
 *
 * 错误处理约定（与 categoryDictionaryService 一致）：
 *  - 所有方法包裹 try/catch，永不抛异常
 *  - 文件不存在 → load() 返回空 Map
 *  - JSON 解析失败 → load() 返回空 Map + console.warn（不覆盖磁盘文件）
 *  - 写入失败 → console.error，方法静默返回（下次 load 仍能返回上次成功状态）
 *
 * 内存缓存：
 *  - 构造时不自动 load（避免主进程启动顺序依赖）
 *  - 由调用方（tagRagService.initialize）显式调用 load() 后再查询
 *  - 所有写操作（addMapping/removeMapping）同步更新内存 + 落盘
 */

import * as fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

/**
 * 文件结构：扁平键值对 `{ originalTagLowercase: replacementTag }`。
 *
 * key 统一为小写（lookup 时大小写不敏感）；value 保留原始大小写（canonicalName 直传）。
 */
type UserSynonymMapFile = Record<string, string>;

class UserSynonymMapService {
  /** 映射文件绝对路径：`{userData}/data/user-synonym-map.json` */
  private readonly mapPath: string;

  /** 映射文件所在目录：`{userData}/data/` */
  private readonly mapDir: string;

  /** 内存缓存（key 小写 → replacement），构造时为空，load() 后填充 */
  private cache: Map<string, string> = new Map();

  /** 是否已执行过 load（避免重复 I/O）；load 失败也标记为 true，避免反复尝试 */
  private loaded: boolean = false;

  constructor() {
    this.mapDir = path.join(getUserDataPath(), 'data');
    this.mapPath = path.join(this.mapDir, 'user-synonym-map.json');
    console.log('[UserSynonymMapService] Map path:', this.mapPath);
    this.ensureDirectoryExists();
  }

  /**
   * 确保映射文件所在目录存在（构造时同步调用一次）。
   *
   * 与 categoryDictionaryService.ensureDirectoryExists 一致：
   *  - 失败仅记录日志，不抛异常；后续 save() 会再次尝试 mkdir
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.mapDir)) {
        fs.mkdirSync(this.mapDir, { recursive: true });
        console.log('[UserSynonymMapService] Created map directory:', this.mapDir);
      }
    } catch (error) {
      console.error('[UserSynonymMapService] ensureDirectoryExists failed:', error);
    }
  }

  /**
   * 从磁盘加载映射表到内存 cache。
   *
   * 行为：
   *  - 文件不存在：返回空 Map（不抛异常、不写日志告警）
   *  - JSON 解析失败：返回空 Map + console.warn（不覆盖磁盘文件，便于人工排查）
   *  - 非对象 / 数组等异常结构：返回空 Map + console.warn
   *  - key 强制小写、value 必须为 string，否则跳过该项
   *  - 重复 load 幂等：覆盖旧 cache
   *
   * @returns 加载后的内存 Map（永不为 null，永不抛异常）
   */
  load(): Map<string, string> {
    try {
      if (!fs.existsSync(this.mapPath)) {
        this.cache = new Map();
        this.loaded = true;
        return this.cache;
      }

      const content = fs.readFileSync(this.mapPath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn('[UserSynonymMapService] load: file content is not a plain object, returning empty map');
        this.cache = new Map();
        this.loaded = true;
        return this.cache;
      }

      const next = new Map<string, string>();
      const obj = parsed as UserSynonymMapFile;
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val !== 'string' || !val) {
          // value 非字符串或空 → 跳过（避免污染内存）
          continue;
        }
        next.set(key.toLowerCase(), val);
      }
      this.cache = next;
      this.loaded = true;
      console.log('[UserSynonymMapService] load: entries=', this.cache.size);
      return this.cache;
    } catch (error) {
      console.warn('[UserSynonymMapService] load failed, returning empty map:', error);
      this.cache = new Map();
      this.loaded = true;
      return this.cache;
    }
  }

  /**
   * 将内存 cache 持久化到磁盘（同步 I/O）。
   *
   * 行为：
   *  - 自动创建目录（{recursive: true} 幂等）
   *  - 写入失败仅 console.error，不抛异常
   */
  private save(): void {
    try {
      fs.mkdirSync(this.mapDir, { recursive: true });
      const obj: UserSynonymMapFile = {};
      for (const [k, v] of this.cache) {
        obj[k] = v;
      }
      fs.writeFileSync(this.mapPath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (error) {
      console.error('[UserSynonymMapService] save failed:', error);
    }
  }

  /**
   * 返回映射表的浅拷贝（Record 形式，便于 IPC 序列化）。
   *
   * 若未执行过 load，则自动调 load() 再返回。
   */
  getMap(): Record<string, string> {
    if (!this.loaded) {
      this.load();
    }
    const result: Record<string, string> = {};
    for (const [k, v] of this.cache) {
      result[k] = v;
    }
    return result;
  }

  /**
   * 新增/更新一条映射：`original → replacement`。
   *
   * 行为：
   *  - original 为空字符串/纯空白：直接 return（不入参校验抛异常，与「永不抛异常」哲学一致）
   *  - replacement 为空字符串/纯空白：直接 return（无意义映射）
   *  - key 统一小写（lookup 大小写不敏感）
   *  - 写入即 save 落盘
   *  - 同 key 已存在：覆盖（用户重新指定 = 更新映射）
   *
   * @param original 原始 tag（如 "B-cup"）
   * @param replacement 替换 tag（如 "medium_breasts"）
   */
  addMapping(original: string, replacement: string): void {
    const o = typeof original === 'string' ? original.trim() : '';
    const r = typeof replacement === 'string' ? replacement.trim() : '';
    if (!o || !r) {
      console.warn('[UserSynonymMapService] addMapping: empty original or replacement, skipping');
      return;
    }
    if (!this.loaded) {
      this.load();
    }
    this.cache.set(o.toLowerCase(), r);
    this.save();
    console.log(`[UserSynonymMapService] addMapping: "${o}" -> "${r}"`);
  }

  /**
   * 删除一条映射（按 original，大小写不敏感）。
   *
   * 行为：
   *  - original 为空：直接 return
   *  - key 不存在：幂等成功（不抛异常、不写日志告警）
   *  - 删除即 save 落盘
   *
   * @param original 原始 tag
   */
  removeMapping(original: string): void {
    const o = typeof original === 'string' ? original.trim() : '';
    if (!o) {
      console.warn('[UserSynonymMapService] removeMapping: empty original, skipping');
      return;
    }
    if (!this.loaded) {
      this.load();
    }
    if (!this.cache.has(o.toLowerCase())) {
      console.log('[UserSynonymMapService] removeMapping: key not found, treat as no-op:', o);
      return;
    }
    this.cache.delete(o.toLowerCase());
    this.save();
    console.log(`[UserSynonymMapService] removeMapping: removed "${o}"`);
  }

  /**
   * 查询 tag 是否在映射表中（大小写不敏感）。
   *
   * @param tag 待查询的原始 tag
   * @returns 命中返回替换词；未命中或未 load 返回 null
   */
  lookup(tag: string): string | null {
    if (typeof tag !== 'string' || !tag.trim()) {
      return null;
    }
    if (!this.loaded) {
      this.load();
    }
    const hit = this.cache.get(tag.toLowerCase());
    return hit ?? null;
  }
}

/**
 * 全局同义词映射服务单例。
 *
 * 与 categoryDictionaryService 单例模式一致：模块加载时构造，全局共享。
 */
export const userSynonymMapService = new UserSynonymMapService();
