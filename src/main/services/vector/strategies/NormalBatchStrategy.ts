/**
 * NormalBatchStrategy - 普通批量添加策略
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.NormalBatchStrategy 类迁出到此独立文件。
 *
 * 行为保持：
 *   调用 backend.addBatch(items) 批量插入并自动落盘（VecstoreBackend.addBatch 末尾会触发一次 persist）。
 *
 * 修复点：
 *   删除原代码的 `(store as any).addBatch` 反射调用，改为通过 IVectorBackend.addBatch 接口直接调用。
 */

import type { VectorItem } from '../../../types/vectorConfig';
import type { IVectorBackend } from '../IVectorBackend';
import type { BatchProcessingStrategy } from './BatchProcessingStrategy';

export class NormalBatchStrategy implements BatchProcessingStrategy {
  async process(backend: IVectorBackend, items: VectorItem[]): Promise<void> {
    // 通过 IVectorBackend 接口直接调用（不再使用 (store as any).addBatch 反射）
    await backend.addBatch(items);
  }
}
