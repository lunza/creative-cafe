/**
 * NoPersistBatchStrategy - 不持久化的批量添加策略
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.NoPersistBatchStrategy 类迁出到此独立文件。
 *
 * 行为保持：
 *   调用 backend.addBatchNoPersist(items) 批量插入但不触发落盘，
 *   由调用方在合适时机显式 persist()。
 *
 * 修复点：
 *   删除原代码的 `(store as any).addBatchNoPersist` 反射调用，
 *   改为通过 IVectorBackend.addBatchNoPersist 接口直接调用。
 */

import type { VectorItem } from '../../../types/vectorConfig';
import type { IVectorBackend } from '../IVectorBackend';
import type { BatchProcessingStrategy } from './BatchProcessingStrategy';

export class NoPersistBatchStrategy implements BatchProcessingStrategy {
  async process(backend: IVectorBackend, items: VectorItem[]): Promise<void> {
    // 通过 IVectorBackend 接口直接调用（不再使用 (store as any).addBatchNoPersist 反射）
    await backend.addBatchNoPersist(items);
  }
}
