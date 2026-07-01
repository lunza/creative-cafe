/**
 * BatchProcessingStrategy - 批量添加策略接口
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService 中内联的 Strategy 类迁出到本目录独立文件。
 *
 * 设计目标：
 *   - 策略可替换（不污染主 Facade）
 *   - 通过 IVectorBackend 接口调用，避免 (store as any).addBatch 反射
 */

import type { VectorItem } from '../../../types/vectorConfig';
import type { IVectorBackend } from '../IVectorBackend';

/**
 * 批量处理策略接口
 */
export interface BatchProcessingStrategy {
  process(backend: IVectorBackend, items: VectorItem[]): Promise<void>;
}
