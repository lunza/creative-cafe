/**
 * IVectorBackend - 向量存储后端抽象接口
 *
 * 三层抽象架构（Task 3）:
 *   IVectorBackend        - 单源存储后端契约（WASM/SQLite/远程 等可替换）
 *   VectorRepository      - 多源路由 + 反向索引（id → sourceKey）
 *   VectorStoreManager    - Facade（缓存 + Strategy + IPC 适配）
 *
 * 设计目标：
 *   - 单一职责：Backend 仅负责单一源的向量读写
 *   - 可替换：实现该接口即可挂载新后端（无需改动 Repository/Facade）
 *   - 性能契约：实现方必须保证 getById O(1)、clear O(1)（重建实例）
 *
 * 注意：本接口仅描述"存储操作"。生命周期方法（initialize / destroy / getStoreFilePath）
 * 由具体类自行提供，Facade 需要时通过具体类型访问。
 */

import type { VectorItem, SearchResult } from '../../types/vectorConfig';

export interface IVectorBackend {
  // ============ 核心 CRUD ============
  /**
   * 添加/更新单个向量。
   * 实现约定：默认不触发全量 persist（避免每次 add 阻塞）。
   * 由调用方在合适时机（addBatch 末尾 / 显式 persist）落盘。
   */
  add(id: string, vector: number[], metadata: Record<string, any>): Promise<void>;

  /**
   * 批量添加（默认在末尾触发一次 persist）。
   */
  addBatch(items: VectorItem[]): Promise<void>;

  /**
   * 批量添加但不 persist（由调用方决定何时落盘）。
   * 实现必须保证每个 item 的维度被 assertDimension 校验。
   */
  addBatchNoPersist(items: VectorItem[]): Promise<void>;

  /**
   * 更新向量（含 metadata 合并）。
   */
  update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void>;

  /**
   * 删除单个向量。
   */
  remove(id: string): Promise<void>;

  /**
   * 按 id 获取向量元数据。
   * 性能契约：必须 O(1) 查找（基于 Map 索引），禁止全表扫。
   * 返回 null 表示未找到。
   */
  getById(id: string): Promise<VectorItem | null>;

  // ============ 搜索 ============
  /**
   * 向量相似度搜索。
   * @param query 查询向量
   * @param topK 返回前 K 条
   * @param filter 元数据过滤条件（key=value 形式）
   */
  search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]>;

  // ============ 批量操作 ============
  /**
   * 清空当前 store 的所有向量。
   * 性能契约：必须 O(1)（重建实例），禁止 O(n²) 循环 remove。
   */
  clear(): Promise<void>;

  /**
   * 持久化到磁盘。
   */
  persist(): Promise<void>;

  /**
   * 当前 store 向量总数。
   */
  count(): Promise<number>;

  /**
   * 按前缀统计向量数（用于按 docId/characterId 统计）。
   */
  countByPrefix(prefix: string): Promise<number>;

  /**
   * 按前缀删除向量。
   * @returns 删除的向量数量
   */
  deleteByPrefix(prefix: string): Promise<number>;

  // ============ 维度管理 ============
  /**
   * 校验向量维度是否匹配。不匹配时抛出 Error。
   */
  assertDimension(vector: number[]): void;

  /**
   * 当前 store 的向量维度。
   */
  getDimension(): number;

  /**
   * 当前 store 中的向量数量（同步）。
   */
  size(): number;
}

/**
 * 维度变更事件名。
 * VectorConfigManager 在模型切换导致 dimension 变化时通过 EventEmitter 触发此事件。
 * 所有 VecstoreBackend 实例监听该事件，触发时清空缓存或重建实例。
 */
export const VECTOR_DIMENSION_CHANGE_EVENT = 'vector:dimension-change';

/**
 * 维度变更事件 payload
 */
export interface DimensionChangeEvent {
  oldDimension: number;
  newDimension: number;
  source?: string;
  sourceId?: string;
}
