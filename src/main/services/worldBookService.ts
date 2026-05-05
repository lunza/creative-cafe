import fs from 'fs/promises';
import path from 'path';
import JSON5 from 'json5';
import { optimizerService } from './optimizerService';
import { getUserDataPath } from '../utils/appPath';
import { embeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { vectorRegistryService } from './VectorRegistryService';
import { getStorageService } from './storageService';
import { VectorSourceType, VectorSourceTypeStorageConfig } from '../types/vectorConfig';

class WorldBookService {
  private worldBookDir: string;
  private tagsDir: string;

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
            // Exclude .tags.json files (tag data files)
            if (f.endsWith('.tags.json')) return false;
            // Only include .json and .json5 files
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

  /**
   * 标准化世界书内容 - 确保符合 SillyTavern 规范
   */
  private standardizeWorldBookContent(data: any): any {
    if (!data) return data;
    
    const standardized = { ...data };
    
    // 1. 添加缺失的根级字段
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
    
    // 2. 修复 entries
    if (standardized.entries) {
      const entries = standardized.entries;
      const fixedEntries: any = {};
      let newIndex = 1;
      
      // 按原始索引排序
      const sortedKeys = Object.keys(entries).sort((a, b) => parseInt(a) - parseInt(b));
      
      for (const oldKey of sortedKeys) {
        const entry = entries[oldKey];
        
        // 标准化每个条目
        const fixedEntry = {
          ...entry,
          // 修正索引
          uid: newIndex,
          id: newIndex,
          // 确保必需字段存在
          priority: entry.priority !== undefined ? entry.priority : (entry.order || 100),
          insertion_order: entry.insertion_order !== undefined ? entry.insertion_order : (entry.order || 100),
          enabled: entry.enabled !== undefined ? entry.enabled : true,
          name: entry.name || entry.comment || `Entry ${newIndex}`,
          // 修正数据类型
          // 修正数据类型
      // position 字段：SillyTavern 使用数字类型 (0=before_char, 1=after_char, 2=before_example, 3=at_depth)
      position: typeof entry.position === 'number' ? entry.position : 1,
          delayUntilRecursion: typeof entry.delayUntilRecursion === 'boolean' 
            ? (entry.delayUntilRecursion ? 1 : 0) 
            : (entry.delayUntilRecursion || 0),
          // 确保 extensions 字段存在
          extensions: entry.extensions || {
            depth: entry.depth || 4,
            weight: 10,
            addMemo: entry.addMemo !== undefined ? entry.addMemo : true,
            displayIndex: entry.displayIndex || 0,
            useProbability: entry.useProbability !== undefined ? entry.useProbability : true,
            characterFilter: null,
            excludeRecursion: entry.excludeRecursion || false
          },
          // 确保数组字段存在
          keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
          secondary_keys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [],
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          triggers: Array.isArray(entry.triggers) ? entry.triggers : [],
          // 确保 characterFilter 存在
          characterFilter: entry.characterFilter || {
            isExclude: false,
            names: [],
            tags: []
          },
          // 确保其他必需字段
          caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : null,
          matchWholeWords: entry.matchWholeWords !== undefined ? entry.matchWholeWords : null,
          useGroupScoring: entry.useGroupScoring !== undefined ? entry.useGroupScoring : null,
          scanDepth: entry.scanDepth !== undefined ? entry.scanDepth : null,
          groupOverride: entry.groupOverride !== undefined ? entry.groupOverride : false,
          groupWeight: entry.groupWeight !== undefined ? entry.groupWeight : 100,
          outletName: entry.outletName || '',
          matchPersonaDescription: entry.matchPersonaDescription !== undefined ? entry.matchPersonaDescription : false,
          matchCharacterDescription: entry.matchCharacterDescription !== undefined ? entry.matchCharacterDescription : false,
          matchCharacterPersonality: entry.matchCharacterPersonality !== undefined ? entry.matchCharacterPersonality : false,
          matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt !== undefined ? entry.matchCharacterDepthPrompt : false,
          matchScenario: entry.matchScenario !== undefined ? entry.matchScenario : false,
          matchCreatorNotes: entry.matchCreatorNotes !== undefined ? entry.matchCreatorNotes : false,
          ignoreBudget: entry.ignoreBudget !== undefined ? entry.ignoreBudget : false,
          preventRecursion: entry.preventRecursion !== undefined ? entry.preventRecursion : false,
          vectorized: entry.vectorized !== undefined ? entry.vectorized : false,
          selectiveLogic: entry.selectiveLogic !== undefined ? entry.selectiveLogic : 0,
          automationId: entry.automationId || '',
          displayIndex: entry.displayIndex !== undefined ? entry.displayIndex : 0,
          useProbability: entry.useProbability !== undefined ? entry.useProbability : true,
          addMemo: entry.addMemo !== undefined ? entry.addMemo : true,
          excludeRecursion: entry.excludeRecursion !== undefined ? entry.excludeRecursion : false,
          depth: entry.depth !== undefined ? entry.depth : 4,
          probability: entry.probability !== undefined ? entry.probability : 100,
          group: entry.group || '',
          disable: entry.disable !== undefined ? entry.disable : false,
          constant: entry.constant !== undefined ? entry.constant : false,
          selective: entry.selective !== undefined ? entry.selective : true,
          order: entry.order !== undefined ? entry.order : 100
        };
        
        fixedEntries[newIndex.toString()] = fixedEntry;
        newIndex++;
      }
      
      standardized.entries = fixedEntries;
    }
    
    return standardized;
  }

  /**
   * 迁移单个世界书条目为 SillyTavern 兼容格式
   */
  private migrateEntry(entry: any): any {
    if (!entry) return entry;
    
    return {
      ...entry,
      // 迁移 key 为数组 (string → string[])
      key: Array.isArray(entry.key) 
        ? entry.key 
        : (typeof entry.key === 'string' && entry.key.trim() !== '' ? [entry.key] : []),
      // 迁移 keysecondary 为数组 (string → string[])
      keysecondary: Array.isArray(entry.keysecondary) 
        ? entry.keysecondary 
        : (typeof entry.keysecondary === 'string' && entry.keysecondary.trim() !== '' ? [entry.keysecondary] : []),
      // 确保数组字段存在
      secondary_keys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [],
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      triggers: Array.isArray(entry.triggers) ? entry.triggers : [],
      // 确保 characterFilter 存在
      characterFilter: entry.characterFilter || {
        isExclude: false,
        names: [],
        tags: []
      },
      // SillyTavern 标准字段默认值
      order: entry.order !== undefined ? entry.order : 100,
      // position 字段：SillyTavern 使用数字类型 (0=before_char, 1=after_char, 2=before_example, 3=at_depth)
      position: typeof entry.position === 'number' ? entry.position : 1,
      depth: entry.depth !== undefined ? entry.depth : 4,
      probability: entry.probability !== undefined ? entry.probability : 100,
      group: entry.group || '',
      disable: entry.disable !== undefined ? entry.disable : false,
      // 兼容两种命名方式
      useRegex: entry.useRegex !== undefined ? entry.useRegex : (entry.use_regex || false),
      vectorized: entry.vectorized !== undefined ? entry.vectorized : false,
      caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : (entry.case_sensitive || false),
      // 确保其他必需字段
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

  /**
   * 将 Creative-Cafe 内部格式导出为 SillyTavern 兼容格式
   */
  private exportToSillyTavernFormat(data: any): any {
    if (!data || !data.entries) return data;
    
    const exportedEntries: Record<string | number, any> = {};
    
    for (const [key, entry] of Object.entries(data.entries)) {
      const e = entry as any;
      exportedEntries[key] = {
        ...e,
        // 导出时使用 SillyTavern 的字段名
        use_regex: e.useRegex || false,
        case_sensitive: e.caseSensitive || false,
      };
      // 移除内部字段名
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
      
      // 标准化世界书内容
      const standardizedData = this.standardizeWorldBookContent(data);
      
      return standardizedData;
    } catch (error) {
      console.error('Failed to read world book:', error);
      return null;
    }
  }

  async writeWorldBook(filePath: string, data: any) {
    try {
      // 标准化数据以确保符合 SillyTavern 规范
      const standardizedData = this.standardizeWorldBookContent(data);
      
      // 导出时转换为 SillyTavern 兼容格式
      const exportData = this.exportToSillyTavernFormat(standardizedData);
      
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Failed to write world book:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteWorldBook(filePath: string) {
    try {
      console.log(`[WorldBookService] deleteWorldBook: starting deletion for ${filePath}`);
      
      // Extract worldbook name from file path (e.g., "狼人杀1.0_修复版" from path)
      const worldBookName = path.basename(filePath).replace(/\.(json|json5)$/, '');
      console.log(`[WorldBookService] deleteWorldBook: worldBookName=${worldBookName}`);
      
      // Step 1: Delete vectorized data from vecstore
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
          
          // Update or remove registry entry and delete vecstore files
          const remainingCount = await vectorStoreService.countByPrefix(`wb_${worldBookName}_`);
          if (remainingCount === 0) {
            console.log(`[WorldBookService] deleteWorldBook: removing registry entry ${entry.id} and deleting vecstore files`);
            await vectorRegistryService.deleteVectorFile(entry.id);
            
            // Delete vecstore files
            try {
              const store = vectorStoreService.getVecstoreStoreForSource(entry.sourceType, entry.sourceId);
              if (store) {
                await store.destroyAndDeleteFiles();
                console.log(`[WorldBookService] deleteWorldBook: vecstore files deleted for ${entry.sourceType}:${entry.sourceId}`);
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
        // Fallback: global delete without specific store targeting
        console.log(`[WorldBookService] deleteWorldBook: no registry entries, falling back to global delete`);
        totalDeleted = await vectorStoreService.deleteByPrefix(`wb_${worldBookName}_`);
        console.log(`[WorldBookService] deleteWorldBook: deleted ${totalDeleted} vectors from all stores`);
      }
      
      // Step 2: Delete the worldbook JSON file
      await fs.unlink(filePath);
      console.log(`[WorldBookService] deleteWorldBook: deleted worldbook file`);
      
      // Step 3: Delete tags
      await this.deleteTags(filePath);
      console.log(`[WorldBookService] deleteWorldBook: deleted tags`);
      
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

  async vectorizeEntry(worldBookPath: string, entryUid: number, entryContent: string, entryKey?: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const storageService = getStorageService();
      const settings = storageService.get<any>('settings');
      const vectorConfig = settings?.vector;

      if (!vectorConfig?.autoVectorizeWorldBook) {
        return { success: false, error: '自动向量化未启用' };
      }

      if (!entryContent || entryContent.trim().length === 0) {
        return { success: false, error: '条目内容为空' };
      }

      const embedResult = await embeddingService.generateEmbedding(entryContent);
      if (!embedResult.success || !embedResult.vector) {
        return { success: false, error: embedResult.error || '向量化失败' };
      }

      const vectorId = `wb_${path.basename(worldBookPath, path.extname(worldBookPath))}_${entryUid}`;
      await vectorStoreService.add(vectorId, embedResult.vector, {
        text: entryContent,
        source: VectorSourceType.WORLDBOOK,
        sourceId: worldBookPath,
        entryUid: String(entryUid),
        key: entryKey || [],
        worldBookPath: worldBookPath,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // 关键修复：向量化完成后立即执行持久化，确保数据不丢失
      await vectorStoreService.persist();
      console.log(`[WorldBookService] vectorizeEntry: persisted ${vectorId} after vectorization`);

      return { success: true };
    } catch (error) {
      console.error('Failed to vectorize entry:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async vectorizeAllEntries(worldBookPath: string, entries: Record<string, any>): Promise<{ success: boolean; processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    for (const [key, entry] of Object.entries(entries)) {
      const e = entry as any;
      if (e.content && e.enabled !== false) {
        const result = await this.vectorizeEntry(worldBookPath, e.uid || parseInt(key), e.content, e.key);
        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      }
    }

    return { success: true, processed, failed };
  }

  async searchWorldBookEntriesByVector(worldBookPath: string, query: string, topK: number = 5): Promise<Array<{ id: string; score: number; metadata: Record<string, any> }>> {
    try {
      const embedResult = await embeddingService.generateEmbedding(query);
      if (!embedResult.success || !embedResult.vector) {
        return [];
      }

      const results = await vectorStoreService.search(embedResult.vector, topK, {
        source: VectorSourceType.WORLDBOOK,
        worldBookPath: worldBookPath
      });

      return results;
    } catch (error) {
      console.error('Failed to search world book entries:', error);
      return [];
    }
  }

  /**
   * 世界书完整向量化处理 - 新的分片规则
   * 分片0: 世界书的 name + description
   * 分片1,2,3...: entries 按顺序编号，内容为 key+keysecondary+keys+secondary_keys+comment+content
   * @param worldBookPath 世界书文件路径
   * @returns 向量化处理结果
   */
  async vectorizeWorldBook(worldBookPath: string): Promise<{ 
    success: boolean; 
    entriesVectorized: number;
    entriesFailed: number;
    error?: string;
    entryVectorIds: string[];
  }> {
    try {
      console.log(`[WorldBookService] vectorizeWorldBook: starting for ${worldBookPath}`);
      
      // 读取世界书内容
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

      // 分片0: 世界书的 name + description
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

      // 分片1,2,3...: entries 按顺序编号
      if (worldBookData.entries && Object.keys(worldBookData.entries).length > 0) {
        console.log(`[WorldBookService] vectorizeWorldBook: vectorizing ${Object.keys(worldBookData.entries).length} entries as chunks 1,2,3...`);
        
        let chunkIndex = 1;
        for (const [key, entry] of Object.entries(worldBookData.entries)) {
          const e = entry as any;
          const entryUid = e.uid || key;
          
          // 跳过被禁用的条目
          if (e.disable || e.enabled === false) {
            console.log(`[WorldBookService] vectorizeWorldBook: skipping disabled entry ${entryUid}`);
            continue;
          }

          // 构建向量化文本：key+keysecondary+keys+secondary_keys+comment+content
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
      
      // 注册到向量注册表
      if (result.entriesVectorized > 0) {
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
}

export const worldBookService = new WorldBookService();
