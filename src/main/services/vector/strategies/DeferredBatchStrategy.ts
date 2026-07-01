/**
 * DeferredBatchStrategy - 延迟持久化的批量添加策略
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.DeferredBatchStrategy 类迁出到此独立文件。
 *
 * 行为保持：
 *   先逐个 add（每个 add 触发 debounced persist），末尾显式 persist 一次保证落盘。
 */

import type { VectorItem } from '../../../types/vectorConfig';
import type { IVectorBackend } from '../IVectorBackend';
import type { BatchProcessingStrategy } from './BatchProcessingStrategy';

export class DeferredBatchStrategy implements BatchProcessingStrategy {
  async process(backend: IVectorBackend, items: VectorItem[]): Promise<void> {
    for (const item of items) {
      await backend.add(item.id, item.vector, item.metadata);
    }
    await backend.persist();
  }
}
