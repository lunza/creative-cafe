/**
 * 向量类型 re-export 兼容层
 *
 * 注意向量数据类型的统一真源已迁移至 `./vector.types.ts`。
 * 本文件保留为兼容入口，使历史引用 `from './types/vector'`（如
 * `src/shared/settings.ts`）继续可用，无需修改消费方。
 *
 * 后续消费方迁移至 `@shared/types` 后，本文件可移除。
 *
 * 详见 `./vector.types.ts` 获取字段语义与设计说明。
 */

export * from './vector.types';
