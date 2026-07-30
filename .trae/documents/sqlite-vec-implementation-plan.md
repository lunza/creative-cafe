# sqlite-vec 向量库后端实施计划

> 本文件是 [sqlite-vec-vector-backend-upgrade.md](./sqlite-vec-vector-backend-upgrade.md) 方案文档的**可执行实施清单**。方案文档阐述「为什么 / 设计要点」，本计划阐述「具体改哪些文件 / 每步怎么做 / 如何验证」。

## 一、当前状态分析

### 1.1 现有架构（三层抽象，已为后端替换做好准备）
- `IVectorBackend`（接口契约）→ `VectorRepository`（多源路由 + 反向索引）→ `VectorStoreService`（Facade）
- 当前唯一实现：`VecstoreBackend`（基于 `vecstore-wasm` WASM + JSON 落盘 + sidecar `metadataCache` Map）

### 1.2 已确认的依赖现状
- `better-sqlite3@11.10.0` 已安装（项目已有依赖，agent 记忆库在用）
- `sqlite-vec` **未安装**（需新增）
- `vecstore-wasm@1.0.0` 已安装（需移除）
- 项目中**从未使用** `db.loadExtension()`（本方案首次引入）
- `electron-builder.json` 当前**无** `asarUnpack` / `extraResources` 配置（需新增以打包扩展二进制）

### 1.3 sqlite-vec Node.js API（已通过官方文档确认）
```js
import * as sqliteVec from "sqlite-vec";
import Database from "better-sqlite3";
const db = new Database(":memory:");
sqliteVec.load(db);  // 自动定位预构建 .dll/.so/.dylib 并 db.loadExtension()
// 验证：SELECT vec_version()
// 向量绑定：better-sqlite3 原生支持 Float32Array，直接传入即可
const emb = new Float32Array([0.1, 0.2, ...]);
db.prepare("INSERT INTO ... VALUES (?)").run(emb);
```

### 1.4 所有需修改的引用点（基于 `rg` 全量搜索结果）

**A. 类型定义（4 文件）**
| 文件 | 行号 | 改动 |
|------|------|------|
| `src/main/types/vectorConfig.ts` | L2 | `VectorStoreMode = 'vecstore'` → `'sqlite-vec'` |
| `src/renderer/types/vectorConfig.ts` | L10 | `vectorStoreMode: 'vecstore'` → `'sqlite-vec'` |
| `src/renderer/types/setting.ts` | L390 | `vectorStoreMode?: 'vecstore'` → `'sqlite-vec'` |
| `src/shared/types/vectorConfigSchema.ts` | L17,55,70 | 注释/字段说明中的 `'vecstore'` 字样更新（schema 字段名 `vectorStoreMode` 保留）|

**B. 核心服务（1 文件，重点）**
| 文件 | 行号 | 改动 |
|------|------|------|
| `src/main/services/VectorStoreService.ts` | L26 | import 从 `./VecstoreVectorStore` 改为 `./SqliteVecBackend` |
| 同上 | L102,107 | 类型 `VecstoreBackend` → `SqliteVecBackend` |
| 同上 | L120,121,133,135 | `new VecstoreBackend()` → `new SqliteVecBackend()` |
| 同上 | L149,153,190,191 | `getVecstoreStoreForSource` 返回类型 + 内部 `new VecstoreBackend()` |
| 同上 | L403,451,585,667 | 日志/调用点（无需改逻辑，类型自动跟随）|
| 同上 | L605-607 | `getMode()` 返回 `'vecstore'` → `'sqlite-vec'` |
| 同上 | L692,696,706 | `testStorageConnection` 中 `mode: 'vecstore'` → `'sqlite-vec'`，文案「VecStore」→「sqlite-vec」|

**C. 消费方（2 文件，调用 `getVecstoreStoreForSource`）**
| 文件 | 行号 | 改动 |
|------|------|------|
| `src/main/services/worldBookService.ts` | L318 | 调用 `getVecstoreStoreForSource` → 保留方法名（见决策 2.3）|
| `src/main/services/DocumentProcessorService.ts` | L290 | 同上 |

**D. UI（2 文件）**
| 文件 | 行号 | 改动 |
|------|------|------|
| `src/renderer/components/Vector/VectorConfigPanel.tsx` | L22,36 | `DEFAULT_CONFIGS.*.vectorStoreMode: 'vecstore'` → `'sqlite-vec'` |
| 同上 | L674 | 存储模式显示文案 `vecstore ? 'VecStore (vecstore-wasm)' : 'JSON'` → `sqlite-vec` 显示 |
| 同上 | L409 | Tooltip 文案「当前使用 VecStore 向量存储引擎」→「sqlite-vec」|
| `src/renderer/components/Dashboard/Dashboard.tsx` | L570 | `vecstore ? 'VecStore (vecstore-wasm)'` 文案更新 |

**E. 配置清理（2 文件，无需功能改动）**
- `src/main/services/ConfigCleanupService.ts:20` — `vectorStoreMode` 在清理白名单，保留
- `src/main/services/storageService.ts:612` — 同上

**F. 注释清理（5 文件，可选但建议）**
- `src/main/services/VectorConfigManager.ts:7`
- `src/main/services/vector/VectorRepository.ts:91,92,193`
- `src/main/services/vector/strategies/NormalBatchStrategy.ts:8`
- `src/main/services/vector/IVectorBackend.ts:114`
- `src/main/services/vector/index.ts:13`
将注释中的 `VecstoreBackend` 改为 `SqliteVecBackend`，保持代码可读性。

**G. 待删除**
- `src/main/services/VecstoreVectorStore.ts`（整个文件）

**H. 测试文件（2 文件，需检查 mock 是否依赖 vectorStoreMode 值）**
- `src/main/services/__tests__/ChatVectorizationService.test.ts`
- `src/renderer/components/Character/CharacterDialogueChat/__tests__/e2e-performance.test.ts`
这两个测试已 mock `vectorConfigManager.loadVectorConfig` 返回 `{ embeddingMode: 'remote' }`，未 mock `vectorStoreMode`，应不受影响，但需运行验证。

## 二、关键决策

### 2.1 vec0 虚拟表主键策略
- **首选**：`id TEXT PRIMARY KEY`（sqlite-vec v0.1.x 文档声明支持，与现有 VectorItem.id 字符串语义一致）
- **降级方案**：若运行时发现 TEXT 主键不工作，改为 `rowid INTEGER` + `id_map` 表映射（`id_map(rowid INTEGER PK, id TEXT UNIQUE)`），search 后 JOIN 取回字符串 id
- **验证时机**：步骤 2 实现完 `openVectorDatabase` 后，立即写一个 smoke test 验证 `CREATE VIRTUAL TABLE ... id TEXT PRIMARY KEY` + INSERT + SELECT 是否正常

### 2.2 metadata 存储策略
- vec0 虚拟表**只存向量**，metadata 存独立 `item_metadata` 表（id TEXT PRIMARY KEY）
- 这消除了 vecstore 的 `metadataCache` sidecar Map、`vecstore_metadata.json` 文件、内存过滤逻辑
- `getById`/`countByPrefix`/`deleteByPrefix` 全部走 SQL，比 Map 遍历更可靠

### 2.3 `getVecstoreStoreForSource` 方法名处理
- **保留旧方法名**，仅改返回类型为 `SqliteVecBackend`。理由：
  1. 两个消费方（worldBookService、DocumentProcessorService）调用时只用了 `destroyAndDeleteFiles()` 方法，该方法在新 backend 中同样实现，调用代码零改动
  2. 重命名为 `getStoreForSource` 需改 5+ 处调用点，收益低、风险高
  3. 方法名是内部实现细节，不影响外部 API
- 在方法上方加注释说明「方法名保留历史命名，实际返回 SqliteVecBackend」

### 2.4 持久化策略
- SQLite 事务即时落盘，`persist()` 简化为 **no-op**（可加 `db.pragma('wal_checkpoint(PASSIVE)')` 主动 checkpoint）
- 删除 vecstore 的 `persistDebounceTimer` / `persistInFlight` / `scheduleDebouncedPersist` 逻辑
- `add()` 默认走事务直接落盘，无需 debounce

### 2.5 维度变更处理
- 沿用 vecstore 的「不同维度 → 不同 DB 文件」策略：路径 `vectors/{source}/{sourceId}/{dimension}/vectors.db`
- `handleDimensionChange(newDimension)`：关闭当前 db 连接 → 更新 dimension → 打开新维度对应的 db 文件（若存在则加载已有数据，不存在则新建）
- 不删除旧维度数据文件（用户切回时可恢复）

### 2.6 不做数据迁移（用户已确认）
- 旧 `vecstore.json` / `vecstore_metadata.json` 文件**不主动删除**（避免误删用户数据）
- 首次启动时检测到旧文件，在日志打印一次性提示：「检测到旧版 vecstore 数据，已弃用，请重新向量化世界书/知识库以启用 sqlite-vec 后端」
- UI 可选提示（步骤 5）

## 三、实施步骤（按依赖顺序）

### 步骤 0：安装依赖
- `pnpm add sqlite-vec`（纯预构建扩展，非 Node addon，**无需 electron-rebuild**）
- 验证：`node -e "const s=require('sqlite-vec'); console.log(Object.keys(s))"` 应输出 `['load', 'loadablePath']` 等
- **不要**立即 `pnpm remove vecstore-wasm`，等步骤 4 删除 VecstoreVectorStore.ts 时再移除（避免中间状态编译错误）

### 步骤 1：类型定义更新（4 文件，A 类）
按 1.4-A 表格修改 4 个类型文件，`VectorStoreMode` 改为 `'sqlite-vec'`。
- 注意 `src/shared/types/vectorConfigSchema.ts` 的 schema 字段名 `vectorStoreMode` **保留**（仅值域变更），因为 ConfigCleanupService / storageService 按字段名清理，改字段名会破坏配置持久化。

### 步骤 2：新建 `sqliteVecUtils.ts`（工具函数）
**文件**：`src/main/services/vector/sqliteVecUtils.ts`

**导出**：
1. `openVectorDatabase(dbPath: string): Promise<SqliteDatabase>`
   - 动态 `require('better-sqlite3')`（复用 `sqliteUtils.ts` 的动态加载模式，避免编译期依赖）
   - `new Database(dbPath)`
   - pragma: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`
   - `sqliteVec.load(db)`：加载 vec0 扩展（动态 `require('sqlite-vec')`）
   - 验证：`db.prepare("SELECT vec_version() as v").get()`，失败抛清晰错误
   - 返回类型复用 `sqliteUtils.ts` 的 `SqliteDatabase` 接口（需扩展声明 `loadExtension`）

2. `ensureVectorSchema(db: SqliteDatabase, dimension: number): void`
   - 幂等建表（参考已有方案文档 §3 Schema）：
   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
     id TEXT PRIMARY KEY,
     embedding float[<dimension>] distance_metric=cosine
   );
   CREATE TABLE IF NOT EXISTS item_metadata (
     id TEXT PRIMARY KEY,
     text TEXT, source TEXT, sourceId TEXT,
     characterId TEXT, worldBookPath TEXT,
     tags TEXT, createdAt INTEGER, updatedAt INTEGER,
     extra TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_meta_source ON item_metadata(source, sourceId);
   ```
   - **降级**：若 `id TEXT PRIMARY KEY` 建表失败，捕获错误，改用 rowid 方案并打印警告

3. `VEC0_TEXT_PK_SUPPORTED` 常量（首次建表后置位，供 backend 判断走哪条路径）

**参考**：[sqliteUtils.ts:94-108](file:///g:/AI/creative-cafe/src/main/services/agent/infra/sqliteUtils.ts#L94) `openAgentDatabase` 的 pragma 配置；不复用 `openAgentDatabase` 因为它不加载 sqlite-vec（职责分离）。

### 步骤 3：新建 `SqliteVecBackend.ts`（核心实现）
**文件**：`src/main/services/SqliteVecBackend.ts`

**类**：`class SqliteVecBackend implements IVectorBackend`

**字段**（对齐 VecstoreBackend 的 public 字段，保证 Repository 兼容）：
- `public source: string = 'default'`
- `public sourceId: string = ''`
- `private db: SqliteDatabase | null = null`
- `private dimension: number = 1024`
- `private _initialized = false`
- `private dbFilePath: string = ''`
- 预编译语句缓存（Map<string, SqliteStatement>）

**生命周期方法**：
- `initialize(options?: {source?, sourceId?})`：
  1. 幂等检查
  2. 设置 source/sourceId
  3. `loadDimensionFromConfig()`（从 VecstoreVectorStore.ts:291-327 迁移，内联）
  4. `ensureStoreDir()`（mkdir -p）
  5. `db = await openVectorDatabase(getDbFilePath())`
  6. `ensureVectorSchema(db, dimension)`
  7. 预编译常用语句（add/getById/search/count/remove）
  8. `_initialized = true`
- `destroy()`：关闭 db 连接（SQLite 事务已即时落盘，无需 persist）
- `destroyAndDeleteFiles()`：关闭连接 + `fs.unlink(dbFilePath)` + 删除 `-wal`/`-shm` 文件
- `handleDimensionChange(newDimension)`：关闭旧 db → 更新 dimension/dbFilePath → 打开新维度 db → ensureSchema
- `getStoreFilePath()`：返回 `dbFilePath`（对齐 Repository 期望的方法名；保留 `getStoreFilePath` 名以减少 VectorStoreService.ts 改动）
- `get initialized` / `getDimension()` / `ensureInitialized()`

**IVectorBackend 方法实现要点**：
- `add(id, vector, metadata)`：
  - `assertDimension(vector)`
  - 事务内：`INSERT OR REPLACE INTO vec_items(id, embedding) VALUES (?, ?)` + `INSERT OR REPLACE INTO item_metadata(...) VALUES (...)`
  - embedding 绑定 `new Float32Array(vector)`（better-sqlite3 原生支持）
  - metadata 序列化：列名字段直接存，未列名字段进 `extra`（JSON）
- `addBatch(items)`：事务内循环 add（单事务提交，性能远优于 vecstore 的逐条 upsert + 末尾 persist）
- `addBatchNoPersist(items)`：与 addBatch 相同（SQLite 事务即持久化，无需区分；保留方法签名以满足接口契约）
- `update(id, vector, metadata?)`：`INSERT OR REPLACE` 语义（同 add）
- `remove(id)`：事务内 `DELETE FROM vec_items WHERE id=?` + `DELETE FROM item_metadata WHERE id=?`
- `getById(id)`：`SELECT * FROM item_metadata WHERE id=?` → 返回 `{id, vector:[], metadata}`（vector 返回空数组，对齐 vecstore 行为，因为现有消费方只用 metadata）
- `search(query, topK, filter?)`：
  ```sql
  SELECT v.id, v.distance, m.text, m.source, m.sourceId, m.characterId, m.worldBookPath, m.tags, m.createdAt, m.updatedAt, m.extra
  FROM vec_items v
  JOIN item_metadata m ON v.id = m.id
  WHERE v.embedding MATCH ? AND v.k = ?
    [AND m.<key> = ? ...]   -- filter 下推到 SQL
  ORDER BY v.distance
  ```
  - query 绑定 `new Float32Array(query)`
  - `score = 1 - distance`（cosine distance → similarity，对齐 vecstore）
  - filter 的每个 key-value 转为 `AND m.<key> = ?`（白名单列名防注入）
  - extra 字段 JSON.parse 后合并进 metadata
- `clear()`：`DELETE FROM vec_items` + `DELETE FROM item_metadata`（单事务，O(1) 等效；无需像 vecstore 重建实例）
- `persist()`：no-op（可调用 `db.pragma('wal_checkpoint(PASSIVE)')`）
- `count()`：`SELECT COUNT(*) FROM vec_items`
- `countByPrefix(prefix)`：`SELECT COUNT(*) FROM item_metadata WHERE id LIKE ? ESCAPE '\\'`（转义 LIKE 通配符）
- `deleteByPrefix(prefix)`：事务内 `DELETE FROM vec_items WHERE id LIKE ? ESCAPE '\\'` + `DELETE FROM item_metadata WHERE id LIKE ? ESCAPE '\\'`，返回 changes
- `assertDimension(vector)`：同 vecstore
- `size()`：`SELECT COUNT(*) FROM vec_items`（同步）

**辅助方法**（从 VecstoreVectorStore.ts 迁移）：
- `loadDimensionFromConfig()`（L291-327）
- `inferDimensionFromModel(modelName)`（L329-367）
- `getSafeSourceId()`（L646-664）
- `getDbFilePath()`（对应 vecstore 的 `getStoreFilePath`，输出 `vectors/{source}/{sourceId}/{dimension}/vectors.db`）
- `ensureStoreDir()`（L666-675）

**参考**：[VecstoreVectorStore.ts](file:///g:/AI/creative-cafe/src/main/services/VecstoreVectorStore.ts)（路径解析、维度推断逻辑直接迁移）；[sqliteBackend.ts](file:///g:/AI/creative-cafe/src/main/services/agent/memory/sqliteBackend.ts)（SQLite 后端单例 + ensureSchema 模式参考）。

### 步骤 4：VectorStoreService 切换后端（1 文件，B 类）
按 1.4-B 表格修改 `VectorStoreService.ts`：
- import 改为 `import { SqliteVecBackend } from './SqliteVecBackend';`
- 所有 `VecstoreBackend` 类型 → `SqliteVecBackend`
- 所有 `new VecstoreBackend()` → `new SqliteVecBackend()`
- `getMode()` 返回 `'sqlite-vec'`
- `testStorageConnection` 中 mode 字段和文案更新
- `getVecstoreStoreForSource` **保留方法名**，仅改返回类型（决策 2.3），加注释

### 步骤 5：UI 更新（2 文件，D 类）
- `VectorConfigPanel.tsx`：DEFAULT_CONFIGS 两处 `vectorStoreMode` 改 `'sqlite-vec'`；L674 存储模式显示改为 `sqlite-vec`；L409 tooltip 文案更新
- `Dashboard.tsx`：L570 文案更新
- 可选：在 VectorConfigPanel 添加只读 Tag「后端：sqlite-vec」

### 步骤 6：删除 vecstore
- 删除 `src/main/services/VecstoreVectorStore.ts`
- `pnpm remove vecstore-wasm`
- 运行 `rg "vecstore-wasm|VecstoreBackend|VecstoreVectorStore"` 确认无残留（注释中的旧名按 F 类清理）

### 步骤 7：打包配置
**`electron-builder.json`** 新增 `asarUnpack`（让原生扩展二进制不被打包进 asar，否则 `sqlite-vec` 的 `load()` 无法通过文件路径加载）：
```json
{
  "asarUnpack": [
    "node_modules/sqlite-vec/**",
    "node_modules/better-sqlite3/**"
  ],
  "files": [
    "dist/**/*",
    "package.json"
  ],
  ...
}
```
**`vite.config.ts`** 主进程 rollupOptions.external 追加 `'sqlite-vec'`、`'better-sqlite3'`（与 `@xenova/transformers` 同级，避免被打包进 bundle）：
```ts
external: ['electron', '@xenova/transformers', 'onnxruntime-node', 'onnxruntime-common', 'sqlite-vec', 'better-sqlite3', ...builtinModules],
```

### 步骤 8：注释清理（F 类，可选但建议）
按 1.4-F 表格更新 5 个文件的注释，将 `VecstoreBackend` 改为 `SqliteVecBackend`。

## 四、单元测试

### 4.1 新建 `SqliteVecBackend.test.ts`
**文件**：`src/main/services/__tests__/SqliteVecBackend.test.ts`

**覆盖用例**：
1. initialize 幂等性（重复调用不报错）
2. add + getById 往返（metadata 字段完整保留，含 extra 字段）
3. add 维度不匹配抛错
4. addBatch 批量插入 + count 校验
5. addBatchNoPersist 行为等同 addBatch
6. search cosine 排序正确性（构造已知向量，验证 score = 1 - distance）
7. search 带 metadata filter（source/sourceId 过滤下推）
8. search 维度不匹配返回空数组
9. update（metadata 合并语义）
10. remove + getById 返回 null
11. countByPrefix（LIKE 转义，含特殊字符 `_` `%`）
12. deleteByPrefix 返回删除数 + 二次查询为 0
13. clear（清空后 count=0）
14. handleDimensionChange（切换维度后旧 db 文件保留、新 db 文件创建）
15. destroyAndDeleteFiles（文件物理删除）
16. vec0 TEXT 主键支持检测（若降级到 rowid 方案，测试需适配）

**测试环境注意**（从过去 bug 学习，Self-Improving）：
- better-sqlite3 是原生模块，vitest 环境下需确保 electron-rebuild 已执行（`pnpm rebuild:native`）
- 若 vitest 报 ABI 不匹配，参考 agent 模块的 `fakeBackend.ts` 思路，但本测试**必须用真实 better-sqlite3 + sqlite-vec**，因为要验证 vec0 虚拟表行为，无法 fake
- mock `vectorConfigManager.loadVectorConfig` 返回 `{ embeddingMode: 'remote', dimension: 8 }`（用小维度 8 加速测试）
- 测试间隔离：每个用例用唯一 sourceId + beforeAll/afterAll 清理 db 文件

### 4.2 既有测试回归
- `ChatVectorizationService.test.ts`：运行验证不受影响（已 mock vectorConfigManager）
- `e2e-performance.test.ts`：同上
- 全量 `npx vitest run` 应保持 1397/1397 全绿（Task 22 基线）

## 五、验证清单

| 验证项 | 命令/方法 | 期望 |
|--------|-----------|------|
| TypeScript 编译 | `npx tsc --noEmit` | 0 错误 |
| 单元测试 | `npx vitest run src/main/services/__tests__/SqliteVecBackend.test.ts` | 全绿 |
| 全量测试回归 | `npx vitest run` | 1397+ 全绿（含新增用例）|
| 残留引用检查 | `rg "vecstore-wasm\|VecstoreBackend\|VecstoreVectorStore" src` | 仅注释残留（F 类清理后为 0）|
| 扩展加载验证 | 启动 app，查看日志 `vec_version=` | 打印版本号 |
| 行为等价性 | 对世界书执行向量化 + 检索 | retrieveChatHistory 返回正确结果 |
| 降级验证 | 临时删除 sqlite-vec 扩展文件，启动 | 主进程不崩溃，向量化功能报清晰错误 |
| 打包验证 | `pnpm electron:build` 后检查 release 目录 | `sqlite-vec` 的 `.dll` 在 `resources/app.asar.unpacked/node_modules/sqlite-vec/` 下 |

## 六、风险与对策（含 Self-Improving 经验）

### 6.1 技术风险
| 风险 | 对策 |
|------|------|
| vec0 不支持 TEXT 主键 | 步骤 2 优先验证；降级 rowid + id_map 表映射 |
| sqlite-vec 扩展打包后路径找不到 | asarUnpack + vite external 双重保障；`sqliteVec.loadablePath` 可手动指定 |
| better-sqlite3 ABI 与 Electron 不匹配 | 已有 `postinstall: electron-rebuild` 脚本，sqlite-vec 是纯扩展不受影响 |
| search filter 列名注入 | 白名单列名（source/sourceId/characterId/worldBookPath），拒绝未知列 |

### 6.2 从过去 bug 学习的预防措施（Self-Improving）
1. **测试隔离**（来自 ChatVectorizationService 测试崩溃教训）：mock `vectorConfigManager`，不读真实磁盘 settings.json
2. **IPC 环境 guard**（来自 storageService.setupIPC 崩溃教训）：本方案不改 IPC，但若 SqliteVecBackend 在测试环境初始化，需确保 `app.getPath('userData')` 可用或 mock
3. **makeStmt 参数传递**（来自 fakeBackend bug）：使用 better-sqlite3 原生 `stmt.run(...params)` / `stmt.get(...params)`，**不要**自己包装 makeStmt
4. **维度变更状态判断**（来自 goalTracker bug）：handleDimensionChange 后确保 `_initialized` 正确置位，避免后续操作报「未初始化」
5. **复合格式解析**（来自 pacing bug）：本方案无 cron 解析，但 LIKE 转义需注意 `\` 转义字符的正确使用

### 6.3 文档增量更新（遵循用户规则）
完成后更新：
- `CHANGELOG.md`：新增 Task 记录（sqlite-vec 后端替换）
- `CODE_WIKI.md`：新增章节描述 SqliteVecBackend 设计与 IPC
- `tasks.md`：标记本任务完成
- 若发现 bug 或反复调试才解决的问题，在文档中加 ⚠️ 重点标记

## 七、执行顺序与里程碑

1. **步骤 0-3**（依赖安装 + 类型 + utils + Backend 实现）：核心实现，可独立验证
2. **步骤 4**（VectorStoreService 切换）：切换后端，此时项目应可启动
3. **步骤 4.1**（单元测试）：验证 Backend 正确性
4. **步骤 5-6**（UI + 删除 vecstore）：清理旧代码
5. **步骤 7**（打包配置）：确保打包后可用
6. **步骤 8**（注释清理）：收尾
7. **五-验证清单**：全量验证
8. **六.3-文档更新**：增量更新技术文档

预计影响文件数：新建 2 + 修改 ~10 + 删除 1 = 13 文件。
