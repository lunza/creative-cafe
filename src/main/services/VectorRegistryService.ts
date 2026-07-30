import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';
import { VectorSourceType, VectorSourceTypeStorageConfig } from '../types/vectorConfig';

export { VectorSourceType, VectorSourceTypeStorageConfig };

const REGISTRY_FILE = 'vector_registry.json';

export interface VectorRegistryEntry {
  id: string;
  vectorFileId: string;
  sourceType: VectorSourceType;
  sourceId: string;
  sourceName: string;
  vectorStorePath: string;
  vectorStoreFile: string;
  metadataFile: string;
  vectorCount: number;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'deleted';
  additionalMetadata?: {
    [key: string]: any;
  };
}

export interface VectorScopeOption {
  id: string;
  label: string;
  sourceType: VectorSourceType;
  sourceId: string;
  sourceName: string;
  vectorCount: number;
  description?: string;
  metadata?: {
    entryVectorIds?: string[];
    [key: string]: any;
  };
}

export interface VectorStoreStatistics {
  totalEntries: number;
  activeEntries: number;
  deletedEntries: number;
  totalVectorCount: number;
  bySourceType: {
    [key in VectorSourceType]?: {
      count: number;
      vectorCount: number;
    };
  };
}

export class VectorRegistryService {
  private registryPath: string;
  private registry: VectorRegistryEntry[] = [];
  private initialized: boolean = false;

  constructor() {
    this.registryPath = path.join(app.getPath('userData'), REGISTRY_FILE);
  }

  async initialize(): Promise<void> {
    try {
      console.log('[VectorRegistryService] Initializing registry...');
      
      const dir = path.dirname(this.registryPath);
      await fsPromises.mkdir(dir, { recursive: true });

      if (fs.existsSync(this.registryPath)) {
        const data = await fsPromises.readFile(this.registryPath, 'utf-8');
        this.registry = JSON.parse(data);
        console.log(`[VectorRegistryService] Loaded ${this.registry.length} registry entries`);
      } else {
        this.registry = [];
        await this.persist();
        console.log('[VectorRegistryService] Created new registry file');
      }

      this.initialized = true;
      console.log('[VectorRegistryService] Initialization complete');
    } catch (error) {
      console.error('[VectorRegistryService] Initialization failed:', error);
      this.registry = [];
      this.initialized = true;
    }
  }

  async registerVectorFile(entry: Partial<VectorRegistryEntry>): Promise<string> {
    // Auto-initialize if not initialized
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        console.error('[VectorRegistryService] Auto-initialization failed:', error);
        // Don't throw, just log and continue without registry
        return entry.id || `reg_${Date.now()}_auto`;
      }
    }

    const now = Date.now();
    const id = entry.id || `reg_${now}_${crypto.randomBytes(6).toString('hex')}`;
    
    const sourceType = entry.sourceType || VectorSourceType.WORLDBOOK;
    const storageConfig = VectorSourceTypeStorageConfig[sourceType];
    const safeSourceId = entry.sourceId 
      ? entry.sourceId.split(':').find(p => p.startsWith('doc_')) || entry.sourceId.split(':').filter(Boolean).pop() || entry.sourceId
      : 'default';
    
    // sqlite-vec 后端：向量与元数据统一存储在 vectors.db（无独立 metadata 文件）
    const vectorStorePath = `vectors/${storageConfig.storageDir}/${safeSourceId}/vectors.db`;
    const vectorStoreFile = 'vectors.db';
    const metadataFile = '';

    const newEntry: VectorRegistryEntry = {
      id,
      vectorFileId: entry.vectorFileId || '',
      sourceType,
      sourceId: entry.sourceId || '',
      sourceName: entry.sourceName || '',
      vectorStorePath,
      vectorStoreFile,
      metadataFile,
      vectorCount: entry.vectorCount || 0,
      createdAt: entry.createdAt || now,
      updatedAt: now,
      status: entry.status || 'active',
      additionalMetadata: entry.additionalMetadata || {},
    };

    const existingIndex = this.registry.findIndex(e => e.vectorFileId === newEntry.vectorFileId);
    if (existingIndex >= 0) {
      this.registry[existingIndex] = newEntry;
      console.log(`[VectorRegistryService] Updated registry entry: ${id}`);
    } else {
      this.registry.push(newEntry);
      console.log(`[VectorRegistryService] Registered new vector file: ${id} (${sourceType})`);
    }

    await this.persist();
    return id;
  }

  async updateVectorFile(id: string, updates: Partial<VectorRegistryEntry>): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    const index = this.registry.findIndex(e => e.id === id);
    if (index === -1) {
      throw new Error(`Registry entry not found: ${id}`);
    }

    this.registry[index] = {
      ...this.registry[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.persist();
    console.log(`[VectorRegistryService] Updated registry entry: ${id}`);
  }

  async deleteVectorFile(id: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    const index = this.registry.findIndex(e => e.id === id);
    if (index === -1) {
      console.warn(`[VectorRegistryService] Registry entry not found for deletion: ${id}`);
      return;
    }

    // 关键修复：物理删除注册表条目，而不是软删除
    const deletedEntry = this.registry.splice(index, 1)[0];
    console.log(`[VectorRegistryService] Physically removed registry entry: ${id} (was: ${deletedEntry.sourceName || deletedEntry.sourceId})`);

    await this.persist();
    console.log(`[VectorRegistryService] Registry persisted after deletion`);
  }

  async getVectorFileById(id: string): Promise<VectorRegistryEntry | null> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    return this.registry.find(e => e.id === id) || null;
  }

  async getVectorFilesBySource(sourceType: VectorSourceType): Promise<VectorRegistryEntry[]> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    return this.registry.filter(e => e.sourceType === sourceType && e.status === 'active');
  }

  async getVectorFilesBySourceId(sourceId: string): Promise<VectorRegistryEntry[]> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    return this.registry.filter(e => e.sourceId === sourceId && e.status === 'active');
  }

  async getAllActiveEntries(): Promise<VectorRegistryEntry[]> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    return this.registry.filter(e => e.status === 'active');
  }

  async getStatistics(): Promise<VectorStoreStatistics> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    const stats: VectorStoreStatistics = {
      totalEntries: this.registry.length,
      activeEntries: 0,
      deletedEntries: 0,
      totalVectorCount: 0,
      bySourceType: {},
    };

    for (const entry of this.registry) {
      if (entry.status === 'active') {
        stats.activeEntries++;
        stats.totalVectorCount += entry.vectorCount;

        if (!stats.bySourceType[entry.sourceType]) {
          stats.bySourceType[entry.sourceType] = { count: 0, vectorCount: 0 };
        }
        stats.bySourceType[entry.sourceType]!.count++;
        stats.bySourceType[entry.sourceType]!.vectorCount += entry.vectorCount;
      } else {
        stats.deletedEntries++;
      }
    }

    return stats;
  }

  async cleanupDeletedEntries(): Promise<number> {
    if (!this.initialized) {
      throw new Error('VectorRegistryService not initialized');
    }

    const beforeCount = this.registry.length;
    this.registry = this.registry.filter(e => e.status !== 'deleted');
    const removedCount = beforeCount - this.registry.length;

    if (removedCount > 0) {
      await this.persist();
      console.log(`[VectorRegistryService] Cleaned up ${removedCount} deleted entries`);
    }

    return removedCount;
  }

  async getAvailableScopes(): Promise<VectorScopeOption[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const scopes: VectorScopeOption[] = [];
    
    for (const entry of this.registry) {
      if (entry.status === 'active') {
        scopes.push({
          id: entry.id,
          label: `${entry.sourceName} (${entry.vectorCount}条)`,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          sourceName: entry.sourceName,
          vectorCount: entry.vectorCount,
          description: `${entry.sourceType} - ${entry.sourceName}`,
          metadata: entry.additionalMetadata,
        });
      }
    }
    
    return scopes;
  }

  async persist(): Promise<void> {
    try {
      const dir = path.dirname(this.registryPath);
      await fsPromises.mkdir(dir, { recursive: true });

      await fsPromises.writeFile(
        this.registryPath,
        JSON.stringify(this.registry, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[VectorRegistryService] Persist failed:', error);
      throw error;
    }
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}

export const vectorRegistryService = new VectorRegistryService();
