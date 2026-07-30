# sqlite-vec 向量库后端升级方案（替换 vecstore）

## Context（为什么做这个改动）

当前 RAG 向量库后端基于 `vecstore-wasm`（WASM 内存索引 + JSON 文件落盘），数据量增长后存在性能瓶颈：全量 JSON 序列化、无原生 HNSW 近似搜索、metadata 靠 sidecar Map 维护、`search` 在内存中过滤。

项目已设计三层抽象（`IVectorBackend` → `VectorRepository` → `VectorStoreService`）为后端可替换而准备。本方案用 `sqlite-vec`（SQLite 向量扩展，复用项目已有 `better-sqlite3`）**完全替换** vecstore，作为唯一后端。

**用户决策**：舍弃 vecstore，全面使用 sqlite-vec，**不进行数据迁移和向后兼容**，降低技术复杂度。
- 不保留 vecstore 后端、不保留 `vecstore-wasm` 依赖
- 不提供迁移工具：现有 `vecstore.json` / `vecstore_metadata.json` 数据将被弃用，用户需对世界书/知识库**重新向量化**（一次性操作）
- `VectorStoreMode` 字段保留为单值 `'sqlite-vec'`（占位，便于将来再加后端），但代码路径无分支

## 设计要点

### 1. 数据库文件布局
每个 `(source, sourceId, dimension)` 一个独立 `.db` 文件，路径沿用 vecstore 的目录结构（仅换文件名）：
`vectors/{source}/{sourceId}/{dimension}/vectors.db`

维度变更隔离与 vecstore 一致（不同维度 → 不同 DB 文件）。

### 2. sqlite-vec 扩展加载
新增 `openVectorDatabase(dbPath)`（位于新文件 `src/main/services/vector/sqliteVecUtils.ts`），仿照 [sqliteUtils.ts:94](file:///g:/AI/creative-cafe/src/main/services/agent/infra/sqliteUtils.ts#L94) `openAgentDatabase` 的 WAL + synchronous=NORMAL + busy_timeout 配置，额外通过 `sqlite-vec` npm 包的 `load(db)` 加载 vec0 扩展。better-sqlite3 支持 `db.loadExtension()`，`sqlite-vec` 的 `load()` 自动定位预构建 `.dll/.so/.dylib`。

注意：agent 记忆库（`openAgentDatabase`）**不加载** sqlite-vec，保持职责分离；向量库用独立 DB 连接。

### 3. Schema（cosine 距离，对齐原 vecstore 行为）
每个 `vectors.db` 内：
```sql
-- vec0 虚拟表：id + embedding，cosine 距离（原 vecstore 用余弦，score=1-distance 保持一致）
CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[<dimension>] distance_metric=cosine
);

-- 元数据表：id → 完整 metadata（vec0 不存 metadata，join 取回）
CREATE TABLE IF NOT EXISTS item_metadata (
  id TEXT PRIMARY KEY,
  text TEXT,
  source TEXT,
  sourceId TEXT,
  characterId TEXT,
  worldBookPath TEXT,
  tags TEXT,            -- JSON array
  createdAt INTEGER,
  updatedAt INTEGER,
  extra TEXT            -- JSON：存放未列名的额外字段
);
CREATE INDEX IF NOT EXISTS idx_meta_source ON item_metadata(source, sourceId);
```

KNN 查询（带 metadata 过滤）：
```sql
SELECT v.id, v.distance, m.*
FROM vec_items v
JOIN item_metadata m ON v.id = m.id
WHERE v.embedding MATCH :query AND v.k = :topK
  [AND m.source = :source AND m.sourceId = :sourceId]
ORDER BY v.distance;
```
`score = 1 - distance`（cosine distance → similarity），与原 [VecstoreVectorStore.ts:845](file:///g:/AI/creative-cafe/src/main/services/VecstoreVectorStore.ts#L845) `similarity: 1 - r.score` 完全一致。

### 4. 相对 vecstore 的简化
镜像 [VecstoreVectorStore.ts](file:///g:/AI/creative-cafe/src/main/services/VecstoreVectorStore.ts) 的生命周期/维度处理/路径解析，但利用 SQLite 特性简化：
- **metadata 存 DB 表内**：无需 `metadataCache` sidecar Map、无需 `vecstore_metadata.json`；`getById`/`countByPrefix`/`deleteByPrefix` 直接 SQL，比 Map 遍历更可靠
- **自动持久化**：SQLite 事务即时落盘，`persist()` 简化为 no-op（或 WAL checkpoint），无需 debounce 定时器
- **原生 metadata 过滤**：search 过滤下推到 SQL `WHERE`，无需内存过滤
- 维度推断逻辑（`inferDimensionFromModel` 模型→维度映射表）直接内联到 `SqliteVecBackend`，单消费者无需抽共享文件

## 实现步骤

### 步骤 1：依赖与类型
- `pnpm add sqlite-vec`（预构建 loadable extension，非 Node addon，无需 electron-rebuild）
- [vectorConfig.ts:2](file:///g:/AI/creative-cafe/src/main/types/vectorConfig.ts#L2)：`VectorStoreMode = 'sqlite-vec'`（单值，占位保留字段）

### 步骤 2：SqliteVecBackend 实现
- 新建 `src/main/services/vector/sqliteVecUtils.ts`：`openVectorDatabase(dbPath)`（WAL + load sqlite-vec）+ `ensureVectorSchema(db, dimension)`（建 vec0 虚拟表 + metadata 表）
- 新建 `src/main/services/SqliteVecBackend.ts`：`class SqliteVecBackend implements IVectorBackend`
  - 实现 `IVectorBackend` 全部方法：add/addBatch/addBatchNoPersist/update/remove/getById/search/clear/persist/count/countByPrefix/deleteByPrefix/assertDimension/getDimension/size
  - 生命周期：initialize({source,sourceId})/destroy/destroyAndDeleteFiles/handleDimensionChange/getDbFilePath
  - 向量序列化：`new Float32Array(vector).buffer` 绑定到 vec0 embedding
  - 内联 `loadDimensionFromConfig` + `inferDimensionFromModel`（从 VecstoreVectorStore.ts:291-367 迁移）
  - 路径解析 `getDbFilePath()`：复用 vecstore 的 `getSafeSourceId` 逻辑，输出 `vectors/{source}/{sourceId}/{dimension}/vectors.db`

### 步骤 3：VectorStoreService 切换后端
[VectorStoreService.ts:119-140](file:///g:/AI/creative-cafe/src/main/services/VectorStoreService.ts#L119) 构造函数：
- `defaultBackend` / `storeBySource` 类型从 `VecstoreBackend` 改为 `SqliteVecBackend`
- `new VecstoreBackend()` → `new SqliteVecBackend()`（defaultBackend + backendFactory 两处）
- `getVecstoreStoreForSource` 重命名为 `getStoreForSource`（或保留旧名作别名，减少消费方改动），返回 `SqliteVecBackend`
- import 从 `./VecstoreVectorStore` 改为 `./SqliteVecBackend`

### 步骤 4：删除 vecstore
- 删除 `src/main/services/VecstoreVectorStore.ts`
- `pnpm remove vecstore-wasm`
- 全局搜索 `vecstore-wasm` / `VecstoreBackend` / `VecstoreVectorStore` 残留引用，清理
- 旧数据文件 `vecstore.json` / `vecstore_metadata.json` 自然弃用（不主动删除，避免误删用户数据；可选择性在日志提示「检测到旧 vecstore 数据，已弃用，请重新向量化」）

### 步骤 5：设置 UI
[VectorConfigPanel.tsx](file:///g:/AI/creative-cafe/src/renderer/components/Vector/VectorConfigPanel.tsx)：
- `DEFAULT_CONFIGS` 中 `vectorStoreMode: 'vecstore'` → `'sqlite-vec'`
- 无需后端选择器（唯一后端），但可在面板显示「向量存储后端：sqlite-vec」只读 Tag 供用户知情
- 可选：检测到旧 `vecstore.json` 时显示提示「检测到旧版向量数据，请重新向量化世界书/知识库以启用新后端」

### 步骤 6：打包配置
`package.json` electron-builder 配置：`sqlite-vec` 的预构建扩展二进制需包含在打包产物中（`asarUnpack` 或 `extraResources` 指向 `node_modules/sqlite-vec/` 的 `.dll/.so/.dylib`）。

## 关键文件
| 文件 | 改动 |
|------|------|
| `src/main/services/SqliteVecBackend.ts` | **新建** — IVectorBackend 的 sqlite-vec 实现 |
| `src/main/services/vector/sqliteVecUtils.ts` | **新建** — openVectorDatabase + schema ensure |
| `src/main/services/VecstoreVectorStore.ts` | **删除** |
| `src/main/services/VectorStoreService.ts` | 修改 — 切换到 SqliteVecBackend |
| `src/main/types/vectorConfig.ts` | 修改 — VectorStoreMode = 'sqlite-vec' |
| `src/renderer/components/Vector/VectorConfigPanel.tsx` | 修改 — 默认值 + 后端信息展示 |
| `package.json` | 修改 — +sqlite-vec / -vecstore-wasm / 打包配置 |

## 验证

1. **单元测试**：新建 `SqliteVecBackend.test.ts`，覆盖 add/search（含 metadata 过滤）/getById/countByPrefix/deleteByPrefix/clear/dimension 校验/批量插入。`npx vitest run` 全绿。
2. **行为等价性**：构造相同向量集，用 sqlite-vec 搜索，验证 cosine 排序与 score 数值符合预期（`score = 1 - distance`）。
3. **集成**：对世界书/知识库执行向量化，验证 `ChatVectorizationService.retrieveChatHistory` 返回正确结果。沿用 Task 22 的 hermetic 测试模式，mock `vectorConfigManager.loadVectorConfig` 返回 `{ embeddingMode: 'remote' }`（`vectorStoreMode` 现为常量 `'sqlite-vec'`）。
4. **降级**：sqlite-vec 扩展加载失败时（如打包缺失二进制），`openVectorDatabase` 抛清晰错误，上层 log 警告，向量化功能不可用但不崩溃主进程。
5. **清理验证**：`rg "vecstore-wasm|VecstoreBackend|VecstoreVectorStore"` 无残留引用。
6. **tsc**：`npx tsc --noEmit` 新增/修改文件 0 错误。

## 风险与对策
- **风险**：sqlite-vec 预构建扩展与 Electron 自带 SQLite 不兼容 → 对策：sqlite-vec 是 loadable extension 绑定 better-sqlite3 的 SQLite 引擎，版本兼容由 sqlite-vec 维护；首次启动 `SELECT vec_version()` 验证，失败抛清晰错误。
- **风险**：vec0 不支持 TEXT 主键 → 对策：sqlite-vec v0.1.x 已支持 `id TEXT PRIMARY KEY`（搜索结果确认）；若实际版本不支持则改 integer rowid + metadata 表映射（schema 已含 metadata 表，天然支持回退）。
- **风险**：打包漏掉扩展二进制 → 对策：步骤 6 asarUnpack 配置 + 首次启动 `vec_version()` 校验。
- **已知代价**（用户已接受）：现有 vecstore.json 向量数据弃用，需重新向量化世界书/知识库。
