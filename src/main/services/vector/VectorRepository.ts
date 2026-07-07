/**
 * VectorRepository - 多源向量存储仓储
 *
 * 三层抽象架构（Task 3）：
 *   - IVectorBackend        - 单源存储后端契约
 *   - VectorRepository      - 多源路由 + 反向索引 Map<id, sourceKey>（本类）
 *   - VectorStoreManager    - Facade（缓存 + Strategy + IPC 适配）
 *
 * 职责：
 *   1. 维护 Map<sourceKey, IVectorBackend>（按 source/sourceId 路由）
 *   2. 维护反向索引 Map<id, sourceKey>（修复 delete(id) 全源扫描 O(N) → O(1) 路由）
 *   3. 提供 CRUD + 批量操作的统一入口，不感知文件存储
 *   4. 维护一个默认 backend（source='default'）
 *
 * SubTask 3.3 实现。
 *
 * 注意：本类不直接处理 Strategy / Cache，那是 Facade 的职责。
 */

import type { VectorItem } from '../../types/vectorConfig';
import type { IVectorBackend } from './IVectorBackend';

export interface RepositoryBackendEntry {
  backend: IVectorBackend & {
    initialize(options?: { source?: string; sourceId?: string }): Promise<void>;
    destroy?(): Promise<void>;
    destroyAndDeleteFiles?(): Promise<void>;
    initialized: boolean;
    source: string;
    sourceId: string;
    getStoreFilePath?(): string;
    handleDimensionChange?(newDimension: number): Promise<void>;
  };
  source: string;
  sourceId: string;
}

/**
 * 反向索引条目：id → 所在的 sourceKey
 */
export interface IdReverseIndexEntry {
  sourceKey: string;
}

export type BackendFactory = (source: string, sourceId: string) => IVectorBackend & {
  initialize(options?: { source?: string; sourceId?: string }): Promise<void>;
  initialized: boolean;
  source: string;
  sourceId: string;
  destroyAndDeleteFiles?(): Promise<void>;
  handleDimensionChange?(newDimension: number): Promise<void>;
};

export class VectorRepository {
  /** 默认 backend（source='default'） */
  private defaultBackend: IVectorBackend & {
    initialize(options?: { source?: string; sourceId?: string }): Promise<void>;
    initialized: boolean;
    source: string;
    sourceId: string;
    handleDimensionChange?(newDimension: number): Promise<void>;
  };

  /**
   * 多源 backend 索引 Map<sourceKey, backend entry>
   * 不包含 default backend（由 defaultBackend 字段单独持有）
   */
  private sourceBackends: Map<string, RepositoryBackendEntry> = new Map();

  /**
   * 反向索引 Map<id, sourceKey>
   * 用途：delete(id) / getById(id) 时直接路由到正确的 backend，避免全源扫描
   */
  private idToSource: Map<string, string> = new Map();

  /** backend 工厂（用于创建新 backend 实例） */
  private backendFactory: BackendFactory;

  constructor(
    defaultBackend: IVectorBackend & {
      initialize(options?: { source?: string; sourceId?: string }): Promise<void>;
      initialized: boolean;
      source: string;
      sourceId: string;
      handleDimensionChange?(newDimension: number): Promise<void>;
    },
    backendFactory?: BackendFactory
  ) {
    this.defaultBackend = defaultBackend;
    this.backendFactory = backendFactory || (() => {
      // 默认工厂：动态加载 VecstoreBackend
      // 注意：为避免循环依赖，此处不直接 import VecstoreBackend；
      // 调用方应在构造 Repository 时显式传入工厂
      throw new Error('[VectorRepository] BackendFactory not provided. Pass a factory in constructor.');
    });
  }

  /**
   * 计算 source key
   */
  private sourceKey(source: string, sourceId: string): string {
    return `${source}:${sourceId}`;
  }

  /**
   * 获取默认 backend
   */
  getDefaultBackend(): IVectorBackend & {
    initialize(options?: { source?: string; sourceId?: string }): Promise<void>;
    initialized: boolean;
    source: string;
    sourceId: string;
    handleDimensionChange?(newDimension: number): Promise<void>;
  } {
    return this.defaultBackend;
  }

  /**
   * 获取（不存在则创建并注册）指定源的 backend
   */
  getBackendForSource(source: string, sourceId: string): RepositoryBackendEntry['backend'] {
    const key = this.sourceKey(source, sourceId);
    let entry = this.sourceBackends.get(key);
    if (!entry) {
      const backend = this.backendFactory(source, sourceId);
      entry = { backend, source, sourceId };
      this.sourceBackends.set(key, entry);
    }
    return entry.backend;
  }

  /**
   * 注册已有的 backend 实例到 source 索引（用于 loadExistingStoresFromRegistry）
   */
  registerBackend(source: string, sourceId: string, backend: RepositoryBackendEntry['backend']): void {
    const key = this.sourceKey(source, sourceId);
    this.sourceBackends.set(key, { backend, source, sourceId });
  }

  /**
   * 从缓存移除指定源的 backend（用于清理删除的源）
   */
  removeBackendFromCache(source: string, sourceId: string): boolean {
    const key = this.sourceKey(source, sourceId);
    const existed = this.sourceBackends.has(key);
    if (existed) {
      // 同步清理反向索引中属于该 source 的条目
      for (const [id, srcKey] of this.idToSource.entries()) {
        if (srcKey === key) {
          this.idToSource.delete(id);
        }
      }
      this.sourceBackends.delete(key);
      console.log(`[VectorRepository] Removed backend from cache: ${key}`);
    }
    return existed;
  }

  /**
   * 获取所有已注册 backend 条目（含 default）
   */
  getAllBackends(): RepositoryBackendEntry[] {
    const result: RepositoryBackendEntry[] = [
      {
        backend: this.defaultBackend as RepositoryBackendEntry['backend'],
        source: this.defaultBackend.source,
        sourceId: this.defaultBackend.sourceId,
      }
    ];
    for (const entry of this.sourceBackends.values()) {
      result.push(entry);
    }
    return result;
  }

  /**
   * 仅获取非默认的 source backends
   */
  getSourceBackends(): RepositoryBackendEntry[] {
    return Array.from(this.sourceBackends.values());
  }

  /**
   * 获取所有 source backends 的数量（不含 default）
   */
  get sourceBackendCount(): number {
    return this.sourceBackends.size;
  }

  /**
   * 通过 metadata 解析目标 backend
   * 修复：确保新创建的 source backend 在返回前完成 initialize()，
   * 否则 VecstoreBackend.add() 会抛出 "尚未初始化" 异常
   */
  private async resolveBackendByMetadata(metadata: Record<string, any>): Promise<{ backend: RepositoryBackendEntry['backend'], source: string, sourceId: string, sourceKey: string }> {
    const source = metadata?.source || 'default';
    const sourceId = metadata?.sourceId || metadata?.docId || source || 'default';

    if (source === 'default' && (sourceId === 'default' || !sourceId)) {
      return {
        backend: this.defaultBackend as RepositoryBackendEntry['backend'],
        source: 'default',
        sourceId: 'default',
        sourceKey: 'default:default'
      };
    }

    const backend = this.getBackendForSource(source, sourceId);
    // 新创建的 backend 未初始化时，在此处自动初始化
    if (!backend.initialized) {
      console.log(`[VectorRepository] Auto-initializing backend for source="${source}", sourceId="${sourceId}"`);
      await backend.initialize({ source, sourceId });
    }
    return {
      backend,
      source,
      sourceId,
      sourceKey: this.sourceKey(source, sourceId)
    };
  }

  /**
   * 添加单个向量：自动路由到正确的 source backend，并维护反向索引
   */
  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    const { backend, sourceKey } = await this.resolveBackendByMetadata(metadata);

    // 若 id 已存在但归属不同的 source，先在旧 source 删除（保持单一归属）
    const existingSourceKey = this.idToSource.get(id);
    if (existingSourceKey && existingSourceKey !== sourceKey) {
      console.log(`[VectorRepository] add: id "${id}" moving from source "${existingSourceKey}" to "${sourceKey}"`);
      await this.removeFromSource(id, existingSourceKey);
    }

    await backend.add(id, vector, metadata);
    this.idToSource.set(id, sourceKey);
  }

  /**
   * 批量添加：按 source 分组路由
   */
  async addBatch(items: VectorItem[]): Promise<void> {
    const grouped = this.groupItemsBySource(items);
    for (const [, group] of grouped) {
      const { backend, sourceKey } = await this.resolveBackendByMetadata({
        source: group.source,
        sourceId: group.sourceId
      });
      await backend.addBatch(group.items);
      for (const item of group.items) {
        this.idToSource.set(item.id, sourceKey);
      }
    }
  }

  /**
   * 批量添加（不 persist）
   */
  async addBatchNoPersist(items: VectorItem[]): Promise<void> {
    const grouped = this.groupItemsBySource(items);
    for (const [, group] of grouped) {
      const { backend, sourceKey } = await this.resolveBackendByMetadata({
        source: group.source,
        sourceId: group.sourceId
      });
      await backend.addBatchNoPersist(group.items);
      for (const item of group.items) {
        this.idToSource.set(item.id, sourceKey);
      }
    }
  }

  /**
   * 按 source 分组（内部辅助方法）
   */
  private groupItemsBySource(items: VectorItem[]): Map<string, { items: VectorItem[]; source: string; sourceId: string }> {
    const grouped = new Map<string, { items: VectorItem[]; source: string; sourceId: string }>();

    for (const item of items) {
      const source = item.metadata?.source || 'default';
      const sourceId = item.metadata?.sourceId || item.metadata?.docId || source || 'default';
      const key = `${source}:${sourceId}`;

      if (!grouped.has(key)) {
        grouped.set(key, { items: [], source, sourceId });
      }
      grouped.get(key)!.items.push(item);
    }

    return grouped;
  }

  /**
   * 更新向量
   */
  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    // 如果 metadata 中包含 source/sourceId 信息，按 source 路由
    if (metadata?.source || metadata?.sourceId) {
      const { backend, sourceKey } = await this.resolveBackendByMetadata(metadata);
      const existingSourceKey = this.idToSource.get(id);
      if (existingSourceKey && existingSourceKey !== sourceKey) {
        await this.removeFromSource(id, existingSourceKey);
      }
      await backend.update(id, vector, metadata);
      this.idToSource.set(id, sourceKey);
    } else {
      // 通过反向索引路由
      const sourceKey = this.idToSource.get(id);
      const backend = sourceKey ? this.findBackendBySourceKey(sourceKey) : this.defaultBackend;
      await backend.update(id, vector, metadata);
    }
  }

  /**
   * 删除向量：使用反向索引直接路由（O(1)），避免全源扫描
   */
  async remove(id: string): Promise<boolean> {
    const sourceKey = this.idToSource.get(id);
    if (sourceKey) {
      // 已知的反向索引：直接路由
      const backend = this.findBackendBySourceKey(sourceKey);
      await backend.remove(id);
      this.idToSource.delete(id);
      return true;
    }

    // 反向索引未命中：fallback 到全源扫描（极少数情况，如旧数据未在索引中）
    console.warn(`[VectorRepository] remove: id "${id}" not in reverse index, falling back to full scan`);
    for (const entry of this.getAllBackends()) {
      if (entry.backend.initialized) {
        try {
          const item = await entry.backend.getById(id);
          if (item) {
            await entry.backend.remove(id);
            this.idToSource.delete(id);
            return true;
          }
        } catch {
          // continue
        }
      }
    }
    return false;
  }

  /**
   * 从指定 source 删除 id（内部使用，不暴露给外部）
   */
  private async removeFromSource(id: string, sourceKey: string): Promise<void> {
    const backend = this.findBackendBySourceKey(sourceKey);
    if (backend) {
      try {
        await backend.remove(id);
      } catch (err) {
        console.warn(`[VectorRepository] removeFromSource: failed to remove "${id}" from "${sourceKey}":`, err);
      }
    }
    this.idToSource.delete(id);
  }

  /**
   * 通过 sourceKey 查找 backend
   */
  private findBackendBySourceKey(sourceKey: string): RepositoryBackendEntry['backend'] {
    if (sourceKey === 'default:default' || sourceKey === 'default') {
      return this.defaultBackend as RepositoryBackendEntry['backend'];
    }
    const entry = this.sourceBackends.get(sourceKey);
    if (entry) {
      return entry.backend;
    }
    // 尝试解析 source:sourceId
    const parts = sourceKey.split(':');
    if (parts.length >= 2) {
      const source = parts[0];
      const sourceId = parts.slice(1).join(':');
      return this.getBackendForSource(source, sourceId);
    }
    return this.defaultBackend as RepositoryBackendEntry['backend'];
  }

  /**
   * 按 id 查找：使用反向索引路由
   */
  async getById(id: string): Promise<VectorItem | null> {
    const sourceKey = this.idToSource.get(id);
    if (sourceKey) {
      const backend = this.findBackendBySourceKey(sourceKey);
      if (backend.initialized) {
        return await backend.getById(id);
      }
    }

    // fallback 到全源扫描
    for (const entry of this.getAllBackends()) {
      if (entry.backend.initialized) {
        try {
          const item = await entry.backend.getById(id);
          if (item) {
            this.idToSource.set(id, this.sourceKey(entry.source, entry.sourceId));
            return item;
          }
        } catch {
          // continue
        }
      }
    }
    return null;
  }

  /**
   * 统计所有 backend 的向量总数
   */
  async count(): Promise<number> {
    let total = 0;
    for (const entry of this.getAllBackends()) {
      if (entry.backend.initialized) {
        total += await entry.backend.count();
      }
    }
    return total;
  }

  /**
   * 按 prefix 统计向量数量（在所有 backend 中）
   */
  async countByPrefix(prefix: string): Promise<number> {
    let total = 0;
    for (const entry of this.getAllBackends()) {
      if (entry.backend.initialized) {
        total += await entry.backend.countByPrefix(prefix);
      }
    }
    return total;
  }

  /**
   * 按 prefix 删除向量（在所有 backend 中）
   */
  async deleteByPrefix(prefix: string, options?: { sourceType?: string; sourceId?: string }): Promise<number> {
    if (options?.sourceType) {
      const sourceId = options.sourceId || options.sourceType;
      const { backend, sourceKey } = await this.resolveBackendByMetadata({
        source: options.sourceType,
        sourceId
      });
      const deleted = await backend.deleteByPrefix(prefix);
      // 清理反向索引中匹配的条目
      for (const [id, srcKey] of this.idToSource.entries()) {
        if (srcKey === sourceKey && id.startsWith(prefix)) {
          this.idToSource.delete(id);
        }
      }
      return deleted;
    }

    let totalDeleted = 0;
    for (const entry of this.getAllBackends()) {
      if (entry.backend.initialized) {
        const deleted = await entry.backend.deleteByPrefix(prefix);
        totalDeleted += deleted;
        // 清理反向索引
        const srcKey = this.sourceKey(entry.source, entry.sourceId);
        for (const [id, sk] of this.idToSource.entries()) {
          if (sk === srcKey && id.startsWith(prefix)) {
            this.idToSource.delete(id);
          }
        }
      }
    }
    return totalDeleted;
  }

  /**
   * 持久化所有 backend
   */
  async persist(): Promise<void> {
    if (this.defaultBackend.initialized) {
      await this.defaultBackend.persist();
    }
    for (const entry of this.sourceBackends.values()) {
      if (entry.backend.initialized) {
        await entry.backend.persist();
      }
    }
  }

  /**
   * 清空所有 backend（clear 各自的 store）
   */
  async clear(): Promise<void> {
    if (this.defaultBackend.initialized) {
      await this.defaultBackend.clear();
    }
    for (const entry of this.sourceBackends.values()) {
      if (entry.backend.initialized) {
        await entry.backend.clear();
      }
    }
    this.idToSource.clear();
  }

  /**
   * 重建所有 backend 的索引
   */
  async rebuildAll(): Promise<void> {
    if (this.defaultBackend.initialized) {
      await this.defaultBackend.persist();
    }
    for (const entry of this.sourceBackends.values()) {
      if (entry.backend.initialized) {
        await entry.backend.persist();
      }
    }
  }

  /**
   * 维度变更：通知所有 backend 重建实例
   */
  async handleDimensionChange(newDimension: number): Promise<void> {
    console.log(`[VectorRepository] handleDimensionChange: ${newDimension}, notifying all backends`);

    if (this.defaultBackend.handleDimensionChange) {
      await this.defaultBackend.handleDimensionChange(newDimension);
    }
    for (const entry of this.sourceBackends.values()) {
      if (entry.backend.handleDimensionChange) {
        await entry.backend.handleDimensionChange(newDimension);
      }
    }
    // 维度变更后所有向量都失效，清空反向索引
    this.idToSource.clear();
  }
}
