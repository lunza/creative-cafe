import fs from 'fs/promises';
import path from 'path';
import JSON5 from 'json5';
import { optimizerService } from './optimizerService';
import { getUserDataPath } from '../utils/appPath';
import { embeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { vectorRegistryService } from './VectorRegistryService';
import { VectorSourceType } from '../types/vectorConfig';
import { WorldBookKeywordMatcher } from './WorldBookKeywordMatcher';
import { vectorConfigManager } from './VectorConfigManager';

// ==================== 关键词匹配器缓存辅助类型与函数（Task 11.2） ====================

/**
 * 关键词匹配器缓存条目。
 * - matcher：已构建 AC 自动机 + 倒排索引的匹配器，按 scope 复用
 * - fileMtimes：构建时各文件 mtime，用于下次命中校验
 * - resolvedPaths：该 matcher 覆盖的文件路径（用于按路径失效）
 * - allEntries：构建时加载的条目（供空判断与日志）
 */
interface KeywordMatcherCacheEntry {
  matcher: WorldBookKeywordMatcher;
  optionKey: string;
  fileMtimes: Map<string, number>;
  resolvedPaths: string[];
  allEntries: any[];
}

/** 选项签名：caseSensitive|matchWholeWords|useGroupScoring。不同选项不复用。 */
function makeOptionKey(options: {
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  useGroupScoring?: boolean;
}): string {
  return [
    options.caseSensitive ? '1' : '0',
    options.matchWholeWords ? '1' : '0',
    options.useGroupScoring ? '1' : '0',
  ].join('|');
}

/** scope 签名：排序后路径拼接，避免顺序差异导致缓存未命中。 */
function makeCacheKey(resolvedPaths: string[], optionKey: string): string {
  return [...resolvedPaths].sort().join('\n') + '::' + optionKey;
}

/** mtime 比对：键集合与值均一致才视为未变更。 */
function mtimesEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

class WorldBookService {
  private worldBookDir: string;
  private tagsDir: string;

  /**
   * 关键词匹配器缓存（spec §二 Task 11.2：索引增量更新 / 复用）。
   *
   * 热路径 ContextManager 每条消息都会调用 matchKeywords，原实现每次都
   * 重新读盘 + 重建 matcher。此处按「解析后路径集合 + 选项签名」缓存
   * WorldBookKeywordMatcher，并通过文件 mtime 校验 + 写路径显式失效保证
   * 一致性。缓存命中时跳过读盘 / JSON 解析 / AC 自动机重建。
   *
   * 失效策略（双重保障）：
   *  1. 显式：writeWorldBook / deleteWorldBook / importWorldBook / optimizeWorldBook
   *     调用 invalidateKeywordMatcherCache(path) 清除受影响 scope
   *  2. 隐式：getOrBuildMatcher 内对每个文件 stat mtime，任一变化即重建
   *     （兜底外部编辑，如用户在文件管理器中改 json）
   */
  private readonly keywordMatcherCache = new Map<string, KeywordMatcherCacheEntry>();
  private readonly keywordMatcherCacheMaxSize = 16;

  constructor() {
    const userDataPath = getUserDataPath();
    this.worldBookDir = path.join(userDataPath, 'data', 'worldbooks');
    this.tagsDir = path.join(userDataPath, 'data', 'worldbooks');
    console.log('World book directory:', this.worldBookDir);
    console.log('Tags directory:', this.tagsDir);
    this.ensureWorldBookDirExists();
  }

  private async ensureWorldBookDirExists() {
    try {
      await fs.access(this.worldBookDir);
    } catch {
      try {
        await fs.mkdir(this.worldBookDir, { recursive: true });
        console.log('Created world book directory:', this.worldBookDir);
      } catch (err) {
        console.error('Failed to create world book directory:', err);
      }
    }
  }

  async listWorldBooks() {
    try {
      await this.ensureWorldBookDirExists();
      const files = await fs.readdir(this.worldBookDir);
      const worldBooks = await Promise.all(
        files
          .filter(f => {
            if (f.endsWith('.tags.json')) return false;
            return f.endsWith('.json') || f.endsWith('.json5');
          })
          .map(async file => {
            const filePath = path.join(this.worldBookDir, file);
            const stats = await fs.stat(filePath);
            return {
              name: file,
              path: filePath,
              size: stats.size,
              modified: stats.mtime,
            };
          }),
      );
      return worldBooks;
    } catch (error) {
      console.error('Failed to list world books:', error);
      return [];
    }
  }

  private standardizeWorldBookContent(data: any): any {
    if (!data) return data;
    
    const standardized = { ...data };
    
    if (standardized.is_creation === undefined) standardized.is_creation = false;
    if (standardized.scan_depth === undefined) standardized.scan_depth = 50;
    if (standardized.token_budget === undefined) standardized.token_budget = 1082;
    if (standardized.recursive_scanning === undefined) standardized.recursive_scanning = true;
    if (!standardized.extensions) {
      standardized.extensions = {
        chub: {
          id: 0,
          full_path: '',
          expressions: null,
          alt_expressions: {},
          related_lorebooks: []
        }
      };
    }
    
    if (standardized.entries) {
      const entries = standardized.entries;
      const fixedEntries: any = {};
      let newIndex = 1;
      
      const sortedKeys = Object.keys(entries).sort((a, b) => parseInt(a) - parseInt(b));
      
      for (const oldKey of sortedKeys) {
        const entry = entries[oldKey];
        const migratedEntry = this.migrateEntry(entry);
        const fixedEntry = {
          ...migratedEntry,
          uid: newIndex,
          id: newIndex,
          name: migratedEntry.name || `Entry ${newIndex}`
        };
        fixedEntries[newIndex.toString()] = fixedEntry;
        newIndex++;
      }
      standardized.entries = fixedEntries;
    }
    return standardized;
  }

  private migrateEntry(entry: any): any {
    if (!entry) return entry;
    
    const secondaryKeys = Array.isArray(entry.secondaryKeys) 
      ? entry.secondaryKeys 
      : Array.isArray(entry.keysecondary) 
        ? entry.keysecondary 
        : (typeof entry.keysecondary === 'string' && entry.keysecondary.trim() !== '' ? [entry.keysecondary] : []);
    
    return {
      ...entry,
      key: Array.isArray(entry.key) 
        ? entry.key 
        : (typeof entry.key === 'string' && entry.key.trim() !== '' ? [entry.key] : []),
      secondaryKeys,
      keysecondary: secondaryKeys,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      triggers: Array.isArray(entry.triggers) ? entry.triggers : [],
      characterFilter: entry.characterFilter || {
        isExclude: false,
        names: [],
        tags: []
      },
      order: entry.order !== undefined ? entry.order : 100,
      position: typeof entry.position === 'number' ? entry.position : 1,
      depth: entry.depth !== undefined ? entry.depth : 4,
      probability: entry.probability !== undefined ? entry.probability : 100,
      group: entry.group || '',
      disable: entry.disable !== undefined ? entry.disable : false,
      useRegex: entry.useRegex !== undefined ? entry.useRegex : (entry.use_regex || false),
      vectorized: entry.vectorized !== undefined ? entry.vectorized : false,
      caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : (entry.case_sensitive || false),
      id: entry.id || entry.uid,
      name: entry.name || entry.comment || `Entry ${entry.uid}`,
      priority: entry.priority !== undefined ? entry.priority : (entry.order || 100),
      insertion_order: entry.insertion_order !== undefined ? entry.insertion_order : (entry.order || 100),
      enabled: entry.enabled !== undefined ? entry.enabled : true,
      extensions: entry.extensions || {
        depth: entry.depth || 4,
        weight: 10,
        addMemo: entry.addMemo !== undefined ? entry.addMemo : true,
        displayIndex: entry.displayIndex || 0,
        useProbability: entry.useProbability !== undefined ? entry.useProbability : true,
        characterFilter: null,
        excludeRecursion: entry.excludeRecursion || false
      },
      delayUntilRecursion: typeof entry.delayUntilRecursion === 'boolean' 
        ? (entry.delayUntilRecursion ? 1 : 0) 
        : (entry.delayUntilRecursion || 0),
      selectiveLogic: entry.selectiveLogic !== undefined ? entry.selectiveLogic : 0,
      displayIndex: entry.displayIndex !== undefined ? entry.displayIndex : 0,
      useProbability: entry.useProbability !== undefined ? entry.useProbability : true,
      addMemo: entry.addMemo !== undefined ? entry.addMemo : true,
      excludeRecursion: entry.excludeRecursion !== undefined ? entry.excludeRecursion : false,
      automationId: entry.automationId || '',
      outletName: entry.outletName || '',
      matchPersonaDescription: entry.matchPersonaDescription !== undefined ? entry.matchPersonaDescription : false,
      matchCharacterDescription: entry.matchCharacterDescription !== undefined ? entry.matchCharacterDescription : false,
      matchCharacterPersonality: entry.matchCharacterPersonality !== undefined ? entry.matchCharacterPersonality : false,
      matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt !== undefined ? entry.matchCharacterDepthPrompt : false,
      matchScenario: entry.matchScenario !== undefined ? entry.matchScenario : false,
      matchCreatorNotes: entry.matchCreatorNotes !== undefined ? entry.matchCreatorNotes : false,
      ignoreBudget: entry.ignoreBudget !== undefined ? entry.ignoreBudget : false,
      preventRecursion: entry.preventRecursion !== undefined ? entry.preventRecursion : false,
      constant: entry.constant !== undefined ? entry.constant : false,
      selective: entry.selective !== undefined ? entry.selective : true
    };
  }

  private exportToSillyTavernFormat(data: any): any {
    if (!data || !data.entries) return data;
    
    const exportedEntries: Record<string | number, any> = {};
    
    for (const [key, entry] of Object.entries(data.entries)) {
      const e = entry as any;
      exportedEntries[key] = {
        ...e,
        secondary_keys: e.secondaryKeys || e.keysecondary || [],
        use_regex: e.useRegex || false,
        case_sensitive: e.caseSensitive || false,
      };
      delete exportedEntries[key].secondaryKeys;
      delete exportedEntries[key].keysecondary;
      delete exportedEntries[key].useRegex;
      delete exportedEntries[key].caseSensitive;
    }
    
    return {
      ...data,
      entries: exportedEntries,
    };
  }

  async readWorldBook(filePath: string) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON5.parse(content);
      const standardizedData = this.standardizeWorldBookContent(data);
      return standardizedData;
    } catch (error) {
      console.error('Failed to read world book:', error);
      return null;
    }
  }

  async writeWorldBook(filePath: string, data: any) {
    try {
      const standardizedData = this.standardizeWorldBookContent(data);
      const exportData = this.exportToSillyTavernFormat(standardizedData);
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      // 失效覆盖该文件的关键词匹配器缓存（Task 11.2）
      this.invalidateKeywordMatcherCache(filePath);
      return { success: true };
    } catch (error) {
      console.error('Failed to write world book:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteWorldBook(filePath: string) {
    try {
      console.log(`[WorldBookService] deleteWorldBook: starting deletion for ${filePath}`);
      const worldBookName = path.basename(filePath).replace(/\.(json|json5)$/, '');
      console.log(`[WorldBookService] deleteWorldBook: worldBookName=${worldBookName}`);
      
      const registryEntries = await vectorRegistryService.getVectorFilesBySourceId(worldBookName);
      console.log(`[WorldBookService] deleteWorldBook: found ${registryEntries.length} registry entries`);
      
      let totalDeleted = 0;
      if (registryEntries.length > 0) {
        for (const entry of registryEntries) {
          console.log(`[WorldBookService] deleteWorldBook: deleting vectors from ${entry.sourceType}:${entry.sourceId}`);
          const deleted = await vectorStoreService.deleteByPrefix(`wb_${worldBookName}_`, {
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
          });
          totalDeleted += deleted;
          console.log(`[WorldBookService] deleteWorldBook: deleted ${deleted} vectors`);
          
          const remainingCount = await vectorStoreService.countByPrefix(`wb_${worldBookName}_`);
          if (remainingCount === 0) {
            console.log(`[WorldBookService] deleteWorldBook: removing registry entry ${entry.id} and deleting vecstore files`);
            await vectorRegistryService.deleteVectorFile(entry.id);
            try {
              const store = vectorStoreService.getVecstoreStoreForSource(entry.sourceType, entry.sourceId);
              if (store) {
                await store.destroyAndDeleteFiles();
                vectorStoreService.removeStoreFromCache(entry.sourceType, entry.sourceId);
                console.log(`[WorldBookService] deleteWorldBook: vecstore files deleted and cache cleaned for ${entry.sourceType}:${entry.sourceId}`);
              }
            } catch (err) {
              console.warn(`[WorldBookService] deleteWorldBook: failed to delete vecstore files`, err);
            }
          } else {
            console.log(`[WorldBookService] deleteWorldBook: updating vectorCount to ${remainingCount}`);
            await vectorRegistryService.updateVectorFile(entry.id, { vectorCount: remainingCount });
          }
        }
      } else {
        console.log(`[WorldBookService] deleteWorldBook: no registry entries, falling back to global delete`);
        totalDeleted = await vectorStoreService.deleteByPrefix(`wb_${worldBookName}_`);
        console.log(`[WorldBookService] deleteWorldBook: deleted ${totalDeleted} vectors from all stores`);
      }
      
      await fs.unlink(filePath);
      console.log(`[WorldBookService] deleteWorldBook: deleted worldbook file`);
      await this.deleteTags(filePath);
      console.log(`[WorldBookService] deleteWorldBook: deleted tags`);
      // 失效覆盖该文件的关键词匹配器缓存（Task 11.2）
      this.invalidateKeywordMatcherCache(filePath);
      console.log(`[WorldBookService] deleteWorldBook: completed, totalDeleted=${totalDeleted}`);
      return { success: true, deletedVectors: totalDeleted };
    } catch (error) {
      console.error(`[WorldBookService] deleteWorldBook failed for ${filePath}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async importWorldBook(sourcePath: string, fileName: string) {
    try {
      await this.ensureWorldBookDirExists();
      const targetPath = path.join(this.worldBookDir, fileName);
      await fs.copyFile(sourcePath, targetPath);
      // 新导入文件影响「全量 scope」缓存；若覆盖同名文件也失效对应 scope（Task 11.2）
      this.invalidateKeywordMatcherCache(targetPath);
      return { success: true, targetPath };
    } catch (error) {
      console.error('Failed to import world book:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async optimizeWorldBook(filePath: string) {
    try {
      const data = await this.readWorldBook(filePath);
      if (!data) return { success: false, error: 'Failed to read world book' };
      const optimized = await optimizerService.optimizeWorldBook(data);
      await this.writeWorldBook(filePath, optimized);
      return { success: true, optimized };
    } catch (error) {
      console.error('Failed to optimize world book:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  setWorldBookDir(dir: string) {
    let resolvedPath = dir;
    if (!path.isAbsolute(dir)) {
      const appRootDir = process.cwd();
      resolvedPath = path.resolve(appRootDir, dir);
    }
    this.worldBookDir = path.normalize(resolvedPath);
    console.log('World book directory set to:', this.worldBookDir);
    // 目录变更 → 所有缓存路径失效，清空整个关键词匹配器缓存（Task 11.2）
    this.invalidateKeywordMatcherCache();
    this.ensureWorldBookDirExists();
  }

  getWorldBookDir() {
    return this.worldBookDir;
  }

  getTagsDir() {
    return this.tagsDir;
  }

  private getTagFilePath(worldBookPath: string): string {
    const fileName = path.basename(worldBookPath, path.extname(worldBookPath));
    return path.join(this.tagsDir, `${fileName}.tags.json`);
  }

  private async ensureTagsDirExists() {
    try {
      await fs.access(this.tagsDir);
    } catch {
      await fs.mkdir(this.tagsDir, { recursive: true });
    }
  }

  async readTags(worldBookPath: string) {
    try {
      await this.ensureTagsDirExists();
      const tagFilePath = this.getTagFilePath(worldBookPath);
      const content = await fs.readFile(tagFilePath, 'utf-8');
      return JSON5.parse(content);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return { tags: [], associations: [] };
      }
      console.error('Failed to read tags:', error);
      return null;
    }
  }

  async writeTags(worldBookPath: string, data: any) {
    try {
      await this.ensureTagsDirExists();
      const tagFilePath = this.getTagFilePath(worldBookPath);
      await fs.writeFile(tagFilePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Failed to write tags:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteTags(worldBookPath: string) {
    try {
      const tagFilePath = this.getTagFilePath(worldBookPath);
      await fs.unlink(tagFilePath);
      return { success: true };
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return { success: true };
      }
      console.error('Failed to delete tags:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchWorldBookEntriesByVector(query: string, topK: number = 5): Promise<Array<{ id: string; score: number; metadata: Record<string, any> }>> {
    try {
      console.log(`[WorldBookService] 开始搜索条目: query="${query?.substring(0, 50)}...", topK=${topK}`);
      
      const embedResult = await embeddingService.generateEmbedding(query);
      if (!embedResult.success || !embedResult.vector) {
        console.log(`[WorldBookService] 向量嵌入失败: ${embedResult.error}`);
        return [];
      }
      console.log(`[WorldBookService] 向量嵌入成功，维度=${embedResult.vector.length}`);
      
      // 只搜索条目类型，排除描述chunk
      const results = await vectorStoreService.search(embedResult.vector, topK, {
        source: VectorSourceType.WORLDBOOK,
        sourceType: 'entry'
      });
      console.log(`[WorldBookService] 搜索到 ${results.length} 个条目`);
      
      return results;
    } catch (error) {
      console.error('Failed to search world book entries:', error);
      return [];
    }
  }

  async vectorizeWorldBook(worldBookPath: string): Promise<{
    success: boolean;
    entriesVectorized: number;
    entriesFailed: number;
    error?: string;
    entryVectorIds: string[];
  }> {
    try {
      const vectorConfig = vectorConfigManager.loadVectorConfig();
      if (vectorConfig.embeddingMode === 'disabled') {
        console.log(`[worldBookService] 向量化已禁用，跳过 vectorizeWorldBook path=${worldBookPath}`);
        return { success: false, entriesVectorized: 0, entriesFailed: 0, error: '向量化已禁用，请先在系统设置中启用向量化', entryVectorIds: [] };
      }

      console.log(`[WorldBookService] vectorizeWorldBook: starting for ${worldBookPath}`);
      const worldBookData = await this.readWorldBook(worldBookPath);
      if (!worldBookData) {
        return { success: false, entriesVectorized: 0, entriesFailed: 0, error: '读取世界书失败', entryVectorIds: [] };
      }
      const worldBookName = path.basename(worldBookPath, path.extname(worldBookPath));
      const result = {
        success: true,
        entriesVectorized: 0,
        entriesFailed: 0,
        entryVectorIds: [] as string[]
      };
      if (worldBookData.description || worldBookName) {
        console.log(`[WorldBookService] vectorizeWorldBook: creating chunk 0 (name + description)`);
        const chunk0Text = `世界书名称: ${worldBookName}\n描述: ${worldBookData.description || ''}`;
        const chunk0Id = `wb_${worldBookName}_0`;
        try {
          const chunk0EmbedResult = await embeddingService.generateEmbedding(chunk0Text);
          if (chunk0EmbedResult.success && chunk0EmbedResult.vector) {
            const chunk0Metadata: Record<string, any> = {
              text: chunk0Text,
              source: VectorSourceType.WORLDBOOK,
              sourceId: worldBookName,
              sourceType: 'description',
              worldBookPath: worldBookPath,
              worldBookName: worldBookName,
              chunkIndex: 0,
              entryUid: '0',
              entryName: '世界书描述',
              isDescriptionChunk: true,
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            await vectorStoreService.add(chunk0Id, chunk0EmbedResult.vector, chunk0Metadata);
            result.entriesVectorized++;
            result.entryVectorIds.push(chunk0Id);
            console.log(`[WorldBookService] vectorizeWorldBook: chunk 0 (description) vectorized successfully`);
          } else {
            result.entriesFailed++;
            console.warn(`[WorldBookService] vectorizeWorldBook: chunk 0 vectorization failed: ${chunk0EmbedResult.error}`);
          }
        } catch (error) {
          result.entriesFailed++;
          console.error(`[WorldBookService] vectorizeWorldBook: chunk 0 vectorization error:`, error);
        }
      }
      if (worldBookData.entries && Object.keys(worldBookData.entries).length > 0) {
        console.log(`[WorldBookService] vectorizeWorldBook: vectorizing ${Object.keys(worldBookData.entries).length} entries as chunks 1,2,3...`);
        let chunkIndex = 1;
        for (const [key, entry] of Object.entries(worldBookData.entries)) {
          const e = entry as any;
          const entryUid = e.uid || key;
          if (e.disable || e.enabled === false) {
            console.log(`[WorldBookService] vectorizeWorldBook: skipping disabled entry ${entryUid}`);
            continue;
          }
          const vectorizeText = [
            ...(e.key || []),
            ...(e.keysecondary || []),
            ...(e.secondary_keys || []),
            e.comment || '',
            e.content || ''
          ].filter(Boolean).join('\n');
          
          if (!vectorizeText.trim()) {
            console.log(`[WorldBookService] vectorizeWorldBook: skipping empty entry ${entryUid}`);
            continue;
          }
          const entryVectorId = `wb_${worldBookName}_${chunkIndex}`;
          try {
            console.log(`[WorldBookService] vectorizeWorldBook: vectorizing chunk ${chunkIndex} (uid: ${entryUid})`);
            const entryEmbedResult = await embeddingService.generateEmbedding(vectorizeText);
            if (entryEmbedResult.success && entryEmbedResult.vector) {
              const entryMetadata: Record<string, any> = {
                text: vectorizeText,
                source: VectorSourceType.WORLDBOOK,
                sourceId: worldBookName,
                sourceType: 'entry',
                worldBookPath: worldBookPath,
                worldBookName: worldBookName,
                chunkIndex: chunkIndex,
                entryUid: String(entryUid),
                entryName: e.name || e.comment || `Entry ${entryUid}`,
                entryKey: e.key || [],
                entryKeySecondary: e.keysecondary || [],
                entryKeys: [...(e.key || []), ...(e.keysecondary || [])],
                entrySecondaryKeys: e.secondary_keys || e.keysecondary || [],
                entryComment: e.comment || '',
                entryContent: e.content || '',
                isEntry: true,
                isDescriptionChunk: false,
                entryOrder: e.order !== undefined ? e.order : 100,
                entryPosition: e.position !== undefined ? e.position : 1,
                entryProbability: e.probability !== undefined ? e.probability : 100,
                entryGroup: e.group || '',
                entryConstant: e.constant !== undefined ? e.constant : false,
                entrySelective: e.selective !== undefined ? e.selective : true,
                entryDepth: e.depth !== undefined ? e.depth : 4,
                entryDisplayIndex: e.displayIndex !== undefined ? e.displayIndex : 0,
                entryAddMemo: e.addMemo !== undefined ? e.addMemo : true,
                entryUseProbability: e.useProbability !== undefined ? e.useProbability : true,
                createdAt: Date.now(),
                updatedAt: Date.now()
              };
              await vectorStoreService.add(entryVectorId, entryEmbedResult.vector, entryMetadata);
              result.entriesVectorized++;
              result.entryVectorIds.push(entryVectorId);
              console.log(`[WorldBookService] vectorizeWorldBook: chunk ${chunkIndex} (uid: ${entryUid}) vectorized successfully`);
            } else {
              result.entriesFailed++;
              console.warn(`[WorldBookService] vectorizeWorldBook: chunk ${chunkIndex} (uid: ${entryUid}) vectorization failed: ${entryEmbedResult.error}`);
            }
          } catch (error) {
            result.entriesFailed++;
            console.error(`[WorldBookService] vectorizeWorldBook: chunk ${chunkIndex} (uid: ${entryUid}) vectorization error:`, error);
          }
          chunkIndex++;
        }
      } else {
        console.log(`[WorldBookService] vectorizeWorldBook: no entries to vectorize`);
      }
      console.log(`[WorldBookService] vectorizeWorldBook: completed - entriesVectorized=${result.entriesVectorized}, entriesFailed=${result.entriesFailed}`);
      if (result.entriesVectorized > 0) {
        // 修复：显式持久化向量数据到磁盘，确保向量落盘后再注册到注册表
        // sqlite-vec 后端：SQLite 通过 WAL 自动落盘，persist() 为 no-op + WAL checkpoint，
        // 此处调用确保 WAL 刷盘，向量数据安全写入磁盘
        try {
          await vectorStoreService.persist();
          console.log(`[WorldBookService] vectorizeWorldBook: persisted ${result.entryVectorIds.length} vectors to disk`);
        } catch (error) {
          console.error('[WorldBookService] vectorizeWorldBook: failed to persist vectors:', error);
        }
        try {
          await vectorRegistryService.registerVectorFile({
            vectorFileId: worldBookName,
            sourceType: VectorSourceType.WORLDBOOK,
            sourceId: worldBookName,
            sourceName: worldBookName,
            vectorCount: result.entriesVectorized,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active',
            additionalMetadata: {
              entriesVectorized: result.entriesVectorized,
              entriesFailed: result.entriesFailed,
              entryVectorIds: result.entryVectorIds,
            }
          });
          console.log(`[WorldBookService] vectorizeWorldBook: registered to vector registry with sourceType=${VectorSourceType.WORLDBOOK}, sourceId=${worldBookName}`);
        } catch (error) {
          console.error('[WorldBookService] vectorizeWorldBook: failed to register to registry:', error);
        }
      }
      return result;
    } catch (error) {
      console.error('[WorldBookService] vectorizeWorldBook: fatal error:', error);
      return { 
        success: false, 
        entriesVectorized: 0, 
        entriesFailed: 0, 
        error: error instanceof Error ? error.message : 'Unknown error',
        entryVectorIds: []
      };
    }
  }

  /**
   * 将注册表ID解析为世界书文件路径
   * @param scopeIds 注册表ID或文件路径的混合数组
   * @returns 解析后的世界书文件路径数组
   */
  private async resolveWorldBookPaths(scopeIds: string[]): Promise<string[]> {
    const resolvedPaths: string[] = [];
    const allWorldBooks = await this.listWorldBooks();
    
    for (const scopeId of scopeIds) {
      // 检查是否是实际文件路径
      if (scopeId.includes(path.sep) || scopeId.includes('/') || scopeId.includes('\\')) {
        // 可能是文件路径，检查是否实际存在
        const exists = allWorldBooks.some(wb => wb.path === scopeId);
        if (exists) {
          resolvedPaths.push(scopeId);
          continue;
        }
      }
      
      // 尝试作为注册表ID解析
      try {
        const entry = await vectorRegistryService.getVectorFileById(scopeId);
        if (entry && entry.sourceType === 'worldbook') {
          // 注册表中的 sourceId 是 worldBookName（文件名不含扩展名）
          const worldBookName = entry.sourceId || entry.vectorFileId || entry.sourceName;
          if (worldBookName) {
            // 查找对应的世界书文件
            const matchedBook = allWorldBooks.find(wb => {
              const wbName = path.basename(wb.path, path.extname(wb.path));
              return wbName === worldBookName;
            });
            if (matchedBook) {
              resolvedPaths.push(matchedBook.path);
              console.log(`[WorldBookService] Resolved registry ID ${scopeId} to file path: ${matchedBook.path}`);
              continue;
            }
          }
        }
      } catch (error) {
        console.warn(`[WorldBookService] Failed to resolve registry ID ${scopeId}:`, error);
      }
      
      console.warn(`[WorldBookService] Could not resolve scopeId: ${scopeId}`);
    }
    
    return resolvedPaths;
  }

  // ==================== 关键词匹配器缓存（Task 11.2） ====================

  /**
   * 获取或构建指定 scope 的关键词匹配器。
   *
   * 命中条件（全部满足才复用）：
   *  1. 缓存键（路径签名 + 选项签名）一致
   *  2. 每个文件的 mtime 与缓存时一致（兜底外部编辑）
   *
   * 任一不满足 → 重新读盘加载条目 → 构建 matcher → 写入缓存（LRU 淘汰）。
   *
   * @returns matcher（无条目时返回 null）；resolvedPaths（供日志/失效用）
   */
  private async getOrBuildKeywordMatcher(
    resolvedPaths: string[],
    options: { caseSensitive?: boolean; matchWholeWords?: boolean; useGroupScoring?: boolean }
  ): Promise<{ matcher: WorldBookKeywordMatcher | null; allEntries: any[] }> {
    const optionKey = makeOptionKey(options);
    const cacheKey = makeCacheKey(resolvedPaths, optionKey);

    // 1. mtime 校验：任一文件 mtime 变化则视为失效
    const currentMtimes = await this.collectMtimes(resolvedPaths);
    const cached = this.keywordMatcherCache.get(cacheKey);
    if (cached && mtimesEqual(cached.fileMtimes, currentMtimes)) {
      return { matcher: cached.matcher, allEntries: cached.allEntries };
    }

    // 2. 未命中：读盘加载所有条目
    const allEntries: any[] = [];
    for (const worldBookPath of resolvedPaths) {
      const data = await this.readWorldBook(worldBookPath);
      if (data && data.entries) {
        allEntries.push(...Object.values(data.entries));
      }
    }

    if (allEntries.length === 0) {
      // 无条目：仍写入空 matcher 缓存以避免反复读盘，但标记可被快速重建
      // （下次有写入会显式失效；mtime 变化也会失效）
      const emptyMatcher = new WorldBookKeywordMatcher([], options);
      this.putMatcherCache(cacheKey, {
        matcher: emptyMatcher,
        optionKey,
        fileMtimes: currentMtimes,
        resolvedPaths,
        allEntries,
      });
      return { matcher: emptyMatcher, allEntries };
    }

    // 3. 构建 matcher（内部构建 AC 自动机 + 倒排索引）
    const matcher = new WorldBookKeywordMatcher(allEntries, options);
    this.putMatcherCache(cacheKey, {
      matcher,
      optionKey,
      fileMtimes: currentMtimes,
      resolvedPaths,
      allEntries,
    });
    console.log(`[WorldBookService] keyword matcher ${cached ? 'rebuilt' : 'built'} for scope (${resolvedPaths.length} files, ${allEntries.length} entries)`);
    return { matcher, allEntries };
  }

  /** 写入缓存并执行 LRU 淘汰。 */
  private putMatcherCache(key: string, entry: KeywordMatcherCacheEntry): void {
    // 已存在则先删再插，使其成为最新（Map 迭代顺序 = 插入顺序，实现 LRU）
    this.keywordMatcherCache.delete(key);
    this.keywordMatcherCache.set(key, entry);
    while (this.keywordMatcherCache.size > this.keywordMatcherCacheMaxSize) {
      const oldestKey = this.keywordMatcherCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.keywordMatcherCache.delete(oldestKey);
    }
  }

  /**
   * 收集各文件 mtime（ms）。文件不存在记为 -1（与存在时区分，删除即失效）。
   */
  private async collectMtimes(paths: string[]): Promise<Map<string, number>> {
    const mtimes = new Map<string, number>();
    await Promise.all(
      paths.map(async p => {
        try {
          const stat = await fs.stat(p);
          mtimes.set(p, stat.mtimeMs);
        } catch {
          mtimes.set(p, -1);
        }
      })
    );
    return mtimes;
  }

  /**
   * 失效关键词匹配器缓存。
   * @param affectedPath 指定文件路径时，仅清除覆盖该路径的 scope（及全量 scope）；
   *                     未指定时清空整个缓存。
   */
  invalidateKeywordMatcherCache(affectedPath?: string): void {
    if (!affectedPath) {
      if (this.keywordMatcherCache.size > 0) {
        this.keywordMatcherCache.clear();
      }
      return;
    }
    for (const [key, entry] of this.keywordMatcherCache) {
      // 覆盖该路径，或为全量 scope（resolvedPaths 为空表示所有世界书）→ 失效
      if (entry.resolvedPaths.length === 0 || entry.resolvedPaths.includes(affectedPath)) {
        this.keywordMatcherCache.delete(key);
      }
    }
  }

  /**
   * 关键词匹配 - 基于关键词匹配的世界书条目激活
   *
   * 性能优化（spec §二 Task 11）：复用按 scope 缓存的 WorldBookKeywordMatcher
   * （内部 AC 自动机 + 倒排索引），命中时跳过读盘 / 解析 / 重建。文件未变更时
   * 单次匹配仅 AC 扫描文本 O(|text|)，替代原 O(Σ|key| × |text|) 朴素扫描。
   * 异常时自动降级到「重新读盘 + 新建 matcher」旧路径，保证不阻断。
   */
  async matchKeywords(
    text: string,
    worldBookPaths?: string[],
    options?: {
      caseSensitive?: boolean;
      matchWholeWords?: boolean;
      useGroupScoring?: boolean;
      maxResults?: number;
    }
  ): Promise<{
    success: boolean;
    matches: Array<{
      entry: any;
      matchedKeys: string[];
      matchType: 'primary' | 'secondary' | 'both';
      matchScore: number;
      content: string;
      comment?: string;
      name?: string;
    }>;
    count: number;
    error?: string;
  }> {
    try {
      if (!text || !text.trim()) {
        return { success: false, matches: [], count: 0, error: '匹配文本为空' };
      }

      // 1. 解析 scope → 实际文件路径
      let resolvedPaths: string[] = [];
      if (worldBookPaths && worldBookPaths.length > 0) {
        resolvedPaths = await this.resolveWorldBookPaths(worldBookPaths);
        if (resolvedPaths.length === 0) {
          console.warn(`[WorldBookService] matchKeywords: no world book files found for scopeIds: ${JSON.stringify(worldBookPaths)}`);
          return { success: true, matches: [], count: 0 };
        }
      } else {
        // 未指定 scope：覆盖所有世界书
        const worldBooks = await this.listWorldBooks();
        resolvedPaths = worldBooks.map(b => b.path);
      }

      // 2. 获取/构建缓存的 matcher（命中时跳过读盘/解析/重建）
      let matcher: WorldBookKeywordMatcher | null = null;
      let allEntries: any[] = [];
      try {
        const built = await this.getOrBuildKeywordMatcher(resolvedPaths, {
          caseSensitive: options?.caseSensitive,
          matchWholeWords: options?.matchWholeWords,
          useGroupScoring: options?.useGroupScoring,
        });
        matcher = built.matcher;
        allEntries = built.allEntries;
      } catch (cacheErr) {
        // 降级：缓存路径异常 → 回退到「重新读盘 + 新建 matcher」旧路径
        console.warn('[WorldBookService] matchKeywords: matcher cache miss/degraded, falling back to fresh load:', cacheErr instanceof Error ? cacheErr.message : cacheErr);
        for (const p of resolvedPaths) {
          const data = await this.readWorldBook(p);
          if (data && data.entries) {
            allEntries = allEntries.concat(Object.values(data.entries));
          }
        }
        matcher = allEntries.length > 0
          ? new WorldBookKeywordMatcher(allEntries, {
              caseSensitive: options?.caseSensitive,
              matchWholeWords: options?.matchWholeWords,
              useGroupScoring: options?.useGroupScoring,
            })
          : null;
      }

      if (!matcher || allEntries.length === 0) {
        return { success: true, matches: [], count: 0 };
      }

      // 3. 执行匹配（matcher.match 内部用 AC 倒排索引筛候选）
      const results = matcher.match(text);
      const maxResults = options?.maxResults || 10;
      const limitedResults = results.slice(0, maxResults);
      const matches = limitedResults.map(result => ({
        entry: result.entry,
        matchedKeys: result.matchedKeys,
        matchType: result.matchType,
        matchScore: result.matchScore,
        content: result.entry.content || '',
        comment: result.entry.comment || result.entry.name || '',
        name: result.entry.name || '',
      }));

      if (matches.length > 0) {
        console.log(`[WorldBookService] matchKeywords: ${matches.length} matches (scope=${resolvedPaths.length} files, entries=${allEntries.length})`);
      }

      return {
        success: true,
        matches,
        count: matches.length,
      };
    } catch (error) {
      console.error('[WorldBookService] matchKeywords failed:', error);
      return {
        success: false,
        matches: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 格式化关键词匹配结果为可注入的文本
   */
  formatKeywordMatchesForInjection(results: Array<{
    entry: any;
    matchedKeys: string[];
    matchType: string;
    matchScore: number;
    content: string;
    comment?: string;
    name?: string;
  }>): string {
    if (!results || results.length === 0) return '';
    return results
      .map((result, index) => {
        const header = `[关键词匹配 ${index + 1}] ${result.comment || result.name || '未命名条目'} (${result.matchType === 'both' ? '主+次关键词' : result.matchType === 'primary' ? '主关键词' : '次关键词'}, 匹配度: ${result.matchScore})`;
        const keys = `触发关键词: ${result.matchedKeys.join(', ')}`;
        return `${header}\n${keys}\n${result.content}`;
      })
      .join('\n\n---\n\n');
  }

  // ==================== Task 17.2: autoGenerated 草稿条目管理 ====================
  //
  // 世界书自驱（spec §二 Task 17）：agent 通过 createEntry/expandFromContext 工具
  // 写入的条目均带 autoGenerated=true 标记，进入"待审阅区"。用户在 UI 中审阅后：
  //  - approve：清除 autoGenerated 标记，条目转为正式条目（provenance 保留以备溯源）
  //  - reject：从世界书中删除该草稿条目
  //
  // 设计约束（spec §5.1 双轨并行 + §5.3 数据迁移）：
  //  - 不改动现有手动 CRUD 路径；autoGenerated 是附加字段，旧读取逻辑忽略它
  //  - 草稿条目与正式条目存储在同一 JSON 文件，仅以 autoGenerated 字段区分
  //  - approve/reject 失败时返回清晰错误，不损坏原文件

  /**
   * 列出指定世界书中所有 autoGenerated=true 的草稿条目（待审阅）。
   *
   * @param worldBookPath 世界书文件绝对路径
   * @returns 草稿条目数组（含 uid/name/content/key/secondaryKeys/comment/provenance）
   */
  async listAutoGeneratedEntries(
    worldBookPath: string
  ): Promise<{ success: boolean; entries: any[]; error?: string }> {
    try {
      const worldBook = await this.readWorldBook(worldBookPath);
      if (!worldBook) {
        return { success: false, entries: [], error: '读取世界书失败' };
      }
      const entriesRaw = (worldBook as any).entries;
      let allEntries: any[];
      if (Array.isArray(entriesRaw)) {
        allEntries = entriesRaw;
      } else if (entriesRaw && typeof entriesRaw === 'object') {
        allEntries = Object.values(entriesRaw);
      } else {
        allEntries = [];
      }
      const drafts = allEntries.filter(
        (e: any) => e && e.autoGenerated === true
      );
      return { success: true, entries: drafts };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[WorldBookService] listAutoGeneratedEntries failed:', errMsg);
      return { success: false, entries: [], error: errMsg };
    }
  }

  /**
   * 批准一个 autoGenerated 草稿条目（清除 autoGenerated 标记，转为正式条目）。
   *
   * @param worldBookPath 世界书文件绝对路径
   * @param entryUid 要批准的条目 UID（字符串或数字）
   * @returns 操作结果
   */
  async approveAutoGeneratedEntry(
    worldBookPath: string,
    entryUid: string | number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const worldBook = await this.readWorldBook(worldBookPath);
      if (!worldBook) {
        return { success: false, error: '读取世界书失败' };
      }
      const uidStr = String(entryUid);
      let modified = false;
      const entriesRaw = (worldBook as any).entries;

      const approveEntry = (e: any): any => {
        if (e && String(e.uid || '') === uidStr && e.autoGenerated === true) {
          modified = true;
          // 清除草稿标记；保留 provenance 用于溯源（可选，不删除）
          const { autoGenerated: _ag, ...rest } = e;
          void _ag;
          return rest;
        }
        return e;
      };

      let newEntries: any;
      if (Array.isArray(entriesRaw)) {
        newEntries = entriesRaw.map(approveEntry);
      } else if (entriesRaw && typeof entriesRaw === 'object') {
        newEntries = {};
        for (const [k, v] of Object.entries(entriesRaw)) {
          newEntries[k] = approveEntry(v);
        }
      } else {
        newEntries = entriesRaw;
      }

      if (!modified) {
        return {
          success: false,
          error: `未找到 UID 为 ${uidStr} 的草稿条目（autoGenerated=true）`,
        };
      }

      const writeResult = await this.writeWorldBook(worldBookPath, {
        ...(worldBook as any),
        entries: newEntries,
      });
      if (!writeResult.success) {
        return { success: false, error: writeResult.error || '写入世界书失败' };
      }
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[WorldBookService] approveAutoGeneratedEntry failed:', errMsg);
      return { success: false, error: errMsg };
    }
  }

  /**
   * 拒绝（删除）一个 autoGenerated 草稿条目。
   *
   * @param worldBookPath 世界书文件绝对路径
   * @param entryUid 要拒绝的条目 UID（字符串或数字）
   * @returns 操作结果
   */
  async rejectAutoGeneratedEntry(
    worldBookPath: string,
    entryUid: string | number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const worldBook = await this.readWorldBook(worldBookPath);
      if (!worldBook) {
        return { success: false, error: '读取世界书失败' };
      }
      const uidStr = String(entryUid);
      let removed = false;
      const entriesRaw = (worldBook as any).entries;

      const shouldRemove = (e: any): boolean => {
        return !!(
          e &&
          String(e.uid || '') === uidStr &&
          e.autoGenerated === true
        );
      };

      let newEntries: any;
      if (Array.isArray(entriesRaw)) {
        const before = entriesRaw.length;
        newEntries = entriesRaw.filter((e: any) => !shouldRemove(e));
        removed = newEntries.length < before;
      } else if (entriesRaw && typeof entriesRaw === 'object') {
        newEntries = {};
        for (const [k, v] of Object.entries(entriesRaw)) {
          if (shouldRemove(v)) {
            removed = true;
            continue;
          }
          newEntries[k] = v;
        }
      } else {
        newEntries = entriesRaw;
      }

      if (!removed) {
        return {
          success: false,
          error: `未找到 UID 为 ${uidStr} 的草稿条目（autoGenerated=true）`,
        };
      }

      const writeResult = await this.writeWorldBook(worldBookPath, {
        ...(worldBook as any),
        entries: newEntries,
      });
      if (!writeResult.success) {
        return { success: false, error: writeResult.error || '写入世界书失败' };
      }
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[WorldBookService] rejectAutoGeneratedEntry failed:', errMsg);
      return { success: false, error: errMsg };
    }
  }

  /**
   * 批量批准所有 autoGenerated 草稿条目。
   *
   * @param worldBookPath 世界书文件绝对路径
   * @returns 操作结果（含批准数量）
   */
  async approveAllAutoGeneratedEntries(
    worldBookPath: string
  ): Promise<{ success: boolean; approvedCount: number; error?: string }> {
    try {
      const worldBook = await this.readWorldBook(worldBookPath);
      if (!worldBook) {
        return { success: false, approvedCount: 0, error: '读取世界书失败' };
      }
      let approvedCount = 0;
      const entriesRaw = (worldBook as any).entries;

      const approveEntry = (e: any): any => {
        if (e && e.autoGenerated === true) {
          approvedCount++;
          const { autoGenerated: _ag, ...rest } = e;
          void _ag;
          return rest;
        }
        return e;
      };

      let newEntries: any;
      if (Array.isArray(entriesRaw)) {
        newEntries = entriesRaw.map(approveEntry);
      } else if (entriesRaw && typeof entriesRaw === 'object') {
        newEntries = {};
        for (const [k, v] of Object.entries(entriesRaw)) {
          newEntries[k] = approveEntry(v);
        }
      } else {
        newEntries = entriesRaw;
      }

      if (approvedCount === 0) {
        return { success: true, approvedCount: 0 };
      }

      const writeResult = await this.writeWorldBook(worldBookPath, {
        ...(worldBook as any),
        entries: newEntries,
      });
      if (!writeResult.success) {
        return { success: false, approvedCount: 0, error: writeResult.error || '写入世界书失败' };
      }
      return { success: true, approvedCount };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[WorldBookService] approveAllAutoGeneratedEntries failed:', errMsg);
      return { success: false, approvedCount: 0, error: errMsg };
    }
  }
}

export const worldBookService = new WorldBookService();
