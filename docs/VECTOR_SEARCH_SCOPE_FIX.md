# 向量查询范围管理系统与搜索相关性修复

> **提取自**: TECHNICAL_DOCUMENTATION.md §3.11.10.1  
> **日期**: 2026-05-04  
> **版本**: v1.9.3 (Bug 4) / v1.9.4 (Bug 5-7) / v1.9.5 (Bug 8-11) / v1.9.6 (Bug 12-13) / v1.9.7 (Bug 14)

---

## 概述

**【严重 BUG 修复】** (2026-05-04) — 向量查询范围管理系统实现 + 搜索相关性回归修复

### 功能实现：向量查询范围管理系统

**需求描述**: 基于 `vector_registry.json` 实现多 scope 向量查询系统，支持用户在测试/对话等场景中按文档范围过滤搜索。

### 实现文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `VectorStoreService.ts` | 新增方法 | `loadExistingStoresFromRegistry()` — 启动时从注册表加载已存在的 source-specific stores |
| `VectorStoreService.ts` | 方法修改 | `search()` 支持 `scopeIds` 参数，按选中的 scope 过滤搜索；`testStorageConnection()` 支持按 scope 测试 |
| `VecstoreVectorStore.ts` | 新增方法 | `getSafeSourceId()` — 净化 sourceId 去除 Windows 不允许的字符（冒号等） |
| `VecstoreVectorStore.ts` | 方法修改 | `getStoreFilePath()`, `getMetadataFilePath()`, `ensureStoreDir()` 改用 `getSafeSourceId()` |
| `VectorRegistryService.ts` | 新增方法 | `getAvailableScopes()` — 返回所有活跃的 scope 选项列表 |
| `preload.ts` | 新增方法 | `vector.getAvailableScopes()`，`vector.testStorage(scopeIds)`，`vector.search(query, topK, filter, scopeIds)` |
| `vectorStore.ts` (renderer) | 新增接口 | `VectorScope` 接口定义；新增 `availableScopes`, `selectedScopes`, `scopesLoading` 状态 |
| `vectorStore.ts` (renderer) | 新增方法 | `getAvailableScopes()`, `setSelectedScopes()`, `toggleScope()`, `searchWithScopes()` |
| `vectorStore.ts` (renderer) | 新增中间件 | Zustand `persist` 中间件，持久化 `selectedScopes` 状态 |
| `VectorScopeSelector.tsx` | 新增组件 | 多选下拉框组件，支持全选/取消全选/刷新/标签渲染 |
| `VectorConfigPanel.tsx` | 集成 | 集成 `VectorScopeSelector` 组件，测试存储连接时传递选中的 scopeIds |
| `KnowledgeBaseManager.tsx` | 集成 | 向量测试 Tab 集成 `VectorScopeSelector`，搜索逻辑改为统一使用 `searchWithScopes` |
| `ContextManager.ts` | 方法修改 | `retrieveContext()` 支持 `scopeIds` 选项，传递给 `vectorStoreService.search()` |
| `vectorConfig.ts` | 接口修改 | `RetrieveOptions` 新增 `scopeIds?: string[]` 字段 |
| `electron.ts` | 类型修改 | `vector.search`, `vector.testStorage`, `vector.getAvailableScopes`, `context.retrieve` 类型签名更新 |

---

## 搜索相关性回归 BUG 修复

**问题描述**: 在实现向量文件拆分存储（按 source/sourceId 分目录）后，搜索"疯狂动物城"返回了完全不相关的结果（"艾咪"、"罗克珊·沃尔夫"等），相似度仅 38% 左右，而之前修复后能正确返回相关结果。

**根因分析**: 存在七个关键缺陷（Bug 1-3 已在前期修复，Bug 4-7 为深层数据格式兼容问题）：

### Bug 1: Store 未初始化导致搜索跳过

**位置**: `VectorStoreService.search()` — 第 551 行

**根因**: 当使用 `scopeIds` 搜索时，代码检查 `sourceStore.initialized`，若为 false 则**跳过搜索**。但 `loadExistingStoresFromRegistry()` 只在 `VectorStoreService.initialize()` 时调用，store 在搜索时可能尚未初始化。

```typescript
// 修复前（跳过未初始化的 store）:
if (sourceStore.initialized) {
  const scopeResults = await sourceStore.search(query, topK * 2, filter);
  allResults.push(...scopeResults);
}

// 修复后（先初始化再搜索）:
if (!sourceStore.initialized) {
  await sourceStore.initialize({ source: entry.sourceType, sourceId: entry.sourceId });
}
const scopeResults = await sourceStore.search(query, topK * 2, filter);
allResults.push(...scopeResults);
```

### Bug 2: Windows 路径包含冒号导致搜索失败

**位置**: `VecstoreVectorStore.ts` — `getStoreFilePath()` 等方法

**根因**: 注册表中的 `sourceId` 是 `kb_doc:doc_1777872618318_0q468s:0`（含冒号），Windows 文件系统不允许路径中包含冒号。实际磁盘目录是 `doc_1777872618318_0q468s`。当代码用 `sourceId` 直接拼接路径时，Windows 报错 `ENOENT: no such file or directory`。

```typescript
// 修复前（直接使用 sourceId，含冒号）:
getStoreFilePath(): string {
  return path.join(app.getPath('userData'), 'vectors', this.source, this.sourceId, STORE_FILE);
}

// 修复后（净化 sourceId）:
private getSafeSourceId(): string {
  let safeId = this.sourceId;
  // 按冒号拆分，提取核心ID（如 doc_1777872618318_0q468s）
  const parts = safeId.split(':');
  if (parts.length >= 2) {
    const docPart = parts.find(p => p.startsWith('doc_'));
    if (docPart) safeId = docPart;
    // ... 其他回退逻辑
  }
  safeId = safeId.replace(/[\\/:*?"<>|]/g, '_');
  return safeId || this.sourceId;
}

getStoreFilePath(): string {
  return path.join(app.getPath('userData'), 'vectors', this.source, this.getSafeSourceId(), STORE_FILE);
}
```

### Bug 3: 测试存储连接未支持 scopeIds

**位置**: `VectorStoreService.testStorageConnection()` 和 `preload.ts`

**根因**: 测试按钮固定测试 `default/default/vecstore.json`，没有根据选中的 scope 测试对应文件，导致用户选中 scope 后测试结果显示 0 条。

**修复方案**: 所有相关文件已更新支持 `scopeIds` 参数。

### Bug 4: 元数据缓存被 WASM 导出数据覆盖（严重 — 查询返回空/不相关结果）

**位置**: `VecstoreVectorStore.ts` — `initialize()` 第 202-206 行

**问题描述**: 在完成向量化文件存储路径重构后，尽管 `vecstore_metadata.json` 中已存在"疯狂动物城"相关条目数据，但执行文本查询时返回的是不相关的结果（或空结果）。

**根因**: `initialize()` 方法中元数据加载流程存在致命缺陷：

```typescript
// 修复前的 initialize() 流程:
async initialize(): Promise<void> {
  // 第1步: 从 vecstore_metadata.json 加载完整元数据到缓存
  await this.loadMetadataFromFile();  // ✅ 正确加载了所有元数据
  
  // 第2步: 从 WASM store 重新构建缓存
  await this.buildMetadataCache();    // ❌ 灾难！
}
```

`buildMetadataCache()` 方法内部执行了以下操作：
```typescript
private async buildMetadataCache(): Promise<void> {
  this.metadataCache.clear();  // ❌ 致命！清除了刚从文件加载的完整元数据
  const data = this.store.export_json();
  const parsed = JSON.parse(data);
  // 重新从 WASM 导出数据构建缓存（数据可能不完整）
  for (const item of parsed) {
    this.metadataCache.set(item.id, metadata);
  }
}
```

**问题流程详解**:
1. 世界书向量化后，数据正确写入 `vecstore.json` 和 `vecstore_metadata.json`（包含"疯狂动物城"条目 v10, v11, v35, v36 等）
2. 执行文本查询时，`initialize()` 被调用
3. `loadMetadataFromFile()` 正确从 `vecstore_metadata.json` 加载了完整元数据（包含 `entryKeys` 等完整字段）
4. `buildMetadataCache()` 被调用，首先执行 `this.metadataCache.clear()` **清除所有已加载的元数据**
5. 然后从 WASM store 的 `export_json()` 重新构建缓存
6. `export_json()` 返回的数据格式可能不完整，缺少关键元数据字段（如 `entryKeys`）
7. 最终 `metadataCache` 中的元数据不完整或缺失，搜索时无法找到正确的条目

**修复方案**:

```typescript
// 修复后: 只从持久化文件加载元数据，不再用 WASM 导出数据覆盖
async initialize(): Promise<void> {
  if (this.initialized) return;
  // ... store 初始化 ...
  
  // 从持久化文件加载元数据（唯一可信源）
  await this.loadMetadataFromFile();
  
  // 关键修复: 移除了 buildMetadataCache() 调用！
  // 不再用 WASM 的 export_json() 覆盖已加载的完整元数据
}
```

同时删除了不再使用的方法（约 100 行死代码）：
- `supplementMetadataFromWasm()` — 补充 WASM 元数据（不再需要）
- `buildMetadataCache()` — 从 WASM 构建缓存（会导致数据丢失）

### Bug 5: 维度检测不支持 `.records` 格式（严重 — WASM store 使用错误维度创建）

**位置**: `VecstoreVectorStore.ts` — `initialize()` 维度检测阶段（第 78-89 行）

**问题描述**: Bug 4 修复后首次重启应用，搜索仍然失败。通过编写完整的调试脚本模拟 `initialize()` 流程，发现 119 条向量数据、元数据、文件路径全部正确，但 WASM store 创建的维度不正确。

**根因**: 向量文件 `vecstore.json` 的实际格式为 `{"dimension": 4096, "records": [...]}`，但维度检测代码只检查 `.vectors`、`.data` 或 `.entries` 字段，**完全没有检查 `.records` 字段**。导致：
1. `vectors` 数组为空，无法从向量长度推断维度
2. `existingDimension` 始终为 `null`
3. 最终使用默认维度 `384` 创建 WASM store（而非实际的 `4096`）
4. 维度不匹配导致向量无法正确导入或搜索时返回错误结果

```typescript
// 修复前的维度检测（缺少 .records 分支）:
if (parsed.vectors && Array.isArray(parsed.vectors)) {
  vectors = parsed.vectors;
} else if (parsed.data && Array.isArray(parsed.data)) {
  vectors = parsed.data;
}
//  缺少 .records 分支，导致 vectors 为空，existingDimension 为 null

// 修复后的维度检测:
if (parsed.records && Array.isArray(parsed.records)) {
  vectors = parsed.records;
  // ⭐ 直接从文件头读取维度值
  if (parsed.dimension && typeof parsed.dimension === 'number') {
    existingDimension = parsed.dimension;  // 4096
  }
} else if (parsed.vectors && Array.isArray(parsed.vectors)) {
  vectors = parsed.vectors;
} else if (parsed.data && Array.isArray(parsed.data)) {
  vectors = parsed.data;
}

// 如果文件头没有维度，则从第一条向量的长度推断
if (vectors.length > 0 && existingDimension === null) {
  const firstVector = vectors[0];
  if (firstVector?.vector && Array.isArray(firstVector.vector)) {
    existingDimension = firstVector.vector.length;
  }
}
```

**调试过程**: 编写了 `debug-vector-search.js` 和 `debug-vector-store-full.js` 脚本，模拟完整的初始化流程。发现数据层面全部正确（119 条向量、2 个"疯狂动物城"条目、维度 4096），确认问题出在应用运行时的维度检测逻辑。

### Bug 6: 向量导入未处理 `.records` 字段（严重 — 119 个向量全部导入失败）

**位置**: `VecstoreVectorStore.ts` — `initialize()` 向量导入阶段（第 147 行）

**根因**: 与 Bug 5 同理，向量导入代码同样没有检查 `.records` 字段。在解析 `vecstore.json` 后，`parsed.records || parsed.vectors || parsed.data || parsed.entries` 这一行中，如果 `.records` 不在前面，它会被 `parsed.entries` 的错误匹配覆盖（或返回空数组），导致 `vectors` 数组为空。

```typescript
// 修复前的向量导入:
vectors = parsed.vectors || parsed.data || parsed.entries || [];

// 修复后的向量导入（.records 优先级最高）:
vectors = parsed.records || parsed.vectors || parsed.data || parsed.entries || [];
```

**影响**: 119 个向量全部无法导入到 WASM store 中，导致 `store.len()` 为 0，搜索时没有任何结果可返回。

### Bug 7: `metadata.fields` 嵌套结构未解包（严重 — 元数据字段丢失）

**位置**: `VecstoreVectorStore.ts` — `initialize()` 向量导入阶段（第 163 行）

**根因**: `vecstore.json` 中 metadata 的实际存储格式为嵌套结构：
```json
{
  "id": "wb_狼人杀1.0_修复版_0",
  "vector": [0.1, 0.2, ...],
  "metadata": {
    "fields": {
      "text": "## 世界书：狼人杀1.0_修复版.json...",
      "source": "worldbook",
      "sourceId": "狼人杀1.0_修复版",
      "entryKeys": ["B101", "朱迪", "疯狂动物城"]
    }
  }
}
```

这是 WASM store 的 `export_json()` 导出格式，metadata 被包装在 `{"fields": {...}}` 结构中。但 upsert 导入时直接传递了 `v.metadata`（即 `{"fields": {...}}`），导致：
1. WASM store 中存储的 metadata 是 `{"fields": {...}}` 而不是扁平的 `{text: ..., source: ...}`
2. 搜索返回结果时，`metadataCache` 中查找到的元数据字段结构不正确
3. 前端显示的内容异常或缺失

```typescript
// 修复前（直接使用嵌套的 metadata）:
this.store.upsert(v.id, new Float32Array(v.vector), v.metadata || {});

// 修复后（解包 metadata.fields）:
let metadata = v.metadata || {};
if (metadata && typeof metadata === 'object' && 'fields' in metadata && typeof metadata.fields === 'object') {
  metadata = metadata.fields;  // 解包嵌套结构
}
this.store.upsert(v.id, new Float32Array(v.vector), metadata);
```

### Bug 8: `deleteByPrefix` 在 vecstore 模式下跳过未初始化的 store（严重 — 删除操作静默失败）

**位置**: `VectorStoreService.ts` — `deleteByPrefix()` 第 768-777 行

**问题描述**: 用户点击"删除整个文档"按钮后，文档数据未被删除，注册表也未更新。

**根因**: 在 vecstore 模式下，`deleteByPrefix()` 遍历所有 store 时，只检查 `store.initialized`，如果为 `false` 则**直接跳过**，不执行任何删除操作：

```typescript
// 修复前（跳过未初始化的 store）:
for (const [, store] of this.storeBySource) {
  if (store.initialized) {  // ← 未初始化的 store 被跳过！
    totalDeleted += await store.deleteByPrefix(prefix);
  }
}
```

当文档向量化时创建的 store（如 `vectors/doc/doc_xxx/vecstore.json`），在应用重启后可能不在 `storeBySource` 缓存中（懒加载机制）。搜索时 store 会被初始化，但删除操作不会。导致 `store.initialized` 为 `false`，删除被跳过，`totalDeleted` 为 0。

```typescript
// 修复后（先初始化再删除）:
for (const [, store] of this.storeBySource) {
  if (!store.initialized) {
    // 关键修复：初始化未初始化的 store
    const parts = store.key.split(':');
    const source = parts[0];
    const sourceId = parts.slice(1).join(':');
    await store.initialize({ source, sourceId });
  }
  totalDeleted += await store.deleteByPrefix(prefix);
}
```

同时，当通过 `options.sourceType` 指定来源删除时，也增加了初始化逻辑：
```typescript
if (options?.sourceType) {
  const sourceStore = this.getVecstoreStoreForSource(options.sourceType, options.sourceId || options.sourceType);
  if (!sourceStore.initialized) {
    await sourceStore.initialize({ source: options.sourceType, sourceId: options.sourceId || options.sourceType });
  }
  totalDeleted = await sourceStore.deleteByPrefix(prefix);
}
```

### Bug 9: `deleteDocument` 未更新 vector_registry.json 注册表（严重 — 注册表数据不一致）

**位置**: `DocumentProcessorService.ts` — `deleteDocument()` 第 234-242 行

**根因**: 删除操作只做了两件事：
1. 调用 `vectorStoreService.deleteByPrefix()` 删除向量数据
2. 调用 `fs.unlink()` 删除文档元数据文件

**完全没有**更新 `vector_registry.json` 注册表：
- 没有调用 `vectorRegistryService.deleteVectorFile()` 删除或标记条目
- 没有更新条目的 `vectorCount` 字段
- 注册表中的条目状态仍然是 `'active'`，计数仍然是旧值

这导致：
1. 查询范围下拉框中仍然显示已删除的文档
2. 注册表统计信息不准确
3. 用户可能尝试查询已删除的文档

```typescript
// 修复前（不更新注册表）:
async deleteDocument(docId: string): Promise<boolean> {
  const metaPath = this.getDocMetaPath(docId);
  try {
    await vectorStoreService.deleteByPrefix(`doc:${docId}:`);
    await fs.unlink(metaPath);
    return true;
  } catch {
    return false;
  }
}

// 修复后（完整流程）:
async deleteDocument(docId: string): Promise<boolean> {
  // Step 1: 从注册表查找条目
  const registryEntries = await vectorRegistryService.getVectorFilesBySourceId(docId);
  
  // Step 2: 从向量存储中删除数据
  for (const entry of registryEntries) {
    const deleted = await vectorStoreService.deleteByPrefix(`doc:${docId}:`, {
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
    });
    
    // Step 2.5: 更新注册表
    const remainingCount = await vectorStoreService.countByPrefix(`doc:${docId}:`);
    if (remainingCount === 0) {
      await vectorRegistryService.deleteVectorFile(entry.id);  // 标记为已删除
    } else {
      await vectorRegistryService.updateVectorFile(entry.id, { vectorCount: remainingCount });
    }
  }
  
  // Step 3: 删除文档元数据文件
  await fs.unlink(metaPath);
  return true;
}
```

### Bug 10: `deleteDocument` 未删除 vecstore.json 和 vecstore_metadata.json 文件（磁盘泄漏）

**位置**: `DocumentProcessorService.ts` — `deleteDocument()` 

**根因**: 删除操作只删除了 `doc_meta/{docId}.meta.json` 文件和向量数据，但没有删除 vecstore 文件本身：
- `vectors/{sourceType}/{sourceId}/vecstore.json`
- `vectors/{sourceType}/{sourceId}/vecstore_metadata.json`

这导致磁盘空间泄漏，长期运行后会产生大量 orphan 文件。

**修复方案**: 通过 `VecstoreVectorStore.deleteByPrefix()` 删除所有向量后，`persist()` 方法会自动保存空 store 到 `vecstore.json`。对于完全没有向量的 store，文件会被清空（只保留 `{ "dimension": N, "records": [] }`）。虽然文件本身仍然存在，但内容已被清空。

如果需要彻底删除文件，可以在 `VecstoreVectorStore` 中添加 `destroyAndDeleteFiles()` 方法：
```typescript
async destroyAndDeleteFiles(): Promise<void> {
  await this.persist();  // 先保存
  if (this.store) {
    this.store.free();  // 释放 WASM 内存
  }
  // 删除 vecstore.json 和 vecstore_metadata.json
  if (fs.existsSync(this.storeFilePath)) {
    await fsPromises.unlink(this.storeFilePath);
  }
  if (fs.existsSync(this.metadataFilePath)) {
    await fsPromises.unlink(this.metadataFilePath);
  }
}
```

### Bug 11: `deleteDocument` 错误被静默吞没（可维护性问题 — 无法诊断失败原因）

**位置**: `DocumentProcessorService.ts` — `deleteDocument()` 第 240-242 行

**根因**: 删除失败时，`catch` 块只返回 `false`，不输出任何错误信息：

```typescript
// 修复前（静默吞没错误）:
} catch {
  return false;  // ← 没有任何日志！
}

// 修复后（详细日志）:
} catch (error) {
  console.error(`[DocumentProcessorService] deleteDocument failed for docId=${docId}:`, error);
  return false;
}
```

修复后的版本在每个关键步骤都添加了详细的日志输出，便于诊断问题：
```typescript
console.log(`[DocumentProcessorService] deleteDocument: starting deletion for docId=${docId}`);
console.log(`[DocumentProcessorService] deleteDocument: found ${registryEntries.length} registry entries`);
console.log(`[DocumentProcessorService] deleteDocument: deleted ${deleted} vectors from ${entry.sourceType}:${entry.sourceId}`);
console.log(`[DocumentProcessorService] deleteDocument: removing registry entry ${entry.id}`);
console.log(`[DocumentProcessorService] deleteDocument: completed, totalDeleted=${totalDeleted}`);
```

### Bug 12: `deleteWorldBook` 未删除向量化数据（严重 — 世界书删除后 vecstore 数据残留）

**位置**: `worldBookService.ts` — `deleteWorldBook()` 第 320-329 行

**问题描述**: 用户在世界书列表中点击"删除"按钮后，世界书 JSON 文件被删除，但向量化数据（存储在 `vectors/worldbook/{worldBookName}/vecstore.json`）仍然存在。

**根因**: `deleteWorldBook()` 方法只做了两件事：
1. 删除世界书 JSON 文件：`fs.unlink(filePath)`
2. 删除标签文件：`this.deleteTags(filePath)`

**完全没有**删除向量化数据。

**修复方案**: 重构 `deleteWorldBook()` 方法，新增完整的向量数据删除流程：
```typescript
async deleteWorldBook(filePath: string) {
  // Step 1: 从世界书文件路径提取名称
  const worldBookName = path.basename(filePath).replace(/\.(json|json5)$/, '');
  
  // Step 2: 从注册表查找条目
  const registryEntries = await vectorRegistryService.getVectorFilesBySourceId(worldBookName);
  
  // Step 3: 删除向量数据
  for (const entry of registryEntries) {
    const deleted = await vectorStoreService.deleteByPrefix(`wb_${worldBookName}_`, {
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
    });
    
    // 更新或移除注册表条目
    const remainingCount = await vectorStoreService.countByPrefix(`wb_${worldBookName}_`);
    if (remainingCount === 0) {
      await vectorRegistryService.deleteVectorFile(entry.id);
    } else {
      await vectorRegistryService.updateVectorFile(entry.id, { vectorCount: remainingCount });
    }
  }
  
  // Step 4: 删除世界书 JSON 文件和标签
  await fs.unlink(filePath);
  await this.deleteTags(filePath);
  
  return { success: true, deletedVectors: totalDeleted };
}
```

注意：向量 ID 前缀为 `wb_{worldBookName}_`（如 `wb_狼人杀1.0_修复版_0`），与文档的 `doc:{docId}:` 前缀不同。

### Bug 13: 删除世界书未更新 vector_registry.json 注册表（严重 — 注册表数据不一致）

**位置**: `worldBookService.ts` — `deleteWorldBook()`

**根因**: 与 Bug 9 同理，删除世界书后没有更新注册表中的 `vectorCount` 字段或标记条目为 `'deleted'`。

**影响**:
1. 查询范围下拉框中仍然显示已删除的世界书
2. 注册表统计信息不准确
3. 用户可能尝试查询已删除的世界书

**修复方案**: 已在 Bug 12 的修复中一并处理。

### Bug 14: `deleteDocument` 使用注册表 ID 时无法找到条目（严重 — 注册表 ID 与 sourceId 不匹配）

**位置**: `DocumentProcessorService.ts` — `deleteDocument()` 第 240-273 行

**问题描述**: 前端传递的 `docId` 是注册表 ID（如 `reg_1777917018256_099df188709b`），但 `getVectorFilesBySourceId(docId)` 按 `sourceId` 字段查找，而注册表中的 `sourceId` 是 `"狼人杀1.0_修复版"`，导致查找结果为空。即使找到了注册表条目，删除前缀 `doc:reg_xxx:` 也无法匹配实际的向量 ID（worldbook 类型使用 `wb_{name}_` 前缀，而非 `doc:` 前缀）。

**根因**: 存在两个层面的 ID 不匹配：
1. **查找不匹配**: 前端传递注册表 ID（`reg_xxx`），但 `getVectorFilesBySourceId()` 按 `sourceId` 字段查找
2. **前缀不匹配**: worldbook 类型的向量 ID 前缀是 `wb_{vectorFileId}_`（如 `wb_狼人杀1.0_修复版_0`），而删除代码硬编码使用 `doc:{docId}:` 前缀

错误日志证明了这个问题：
```
[DocumentProcessorService] deleteDocument: deleted 0 vectors from all stores 
[DocumentProcessorService] deleteDocument: meta file not found: C:\Users\master\AppData\Roaming\creative-cafe\data\vector-docs\reg_1777917018256_099df188709b.meta.json
[DocumentProcessorService] deleteDocument: completed, totalDeleted=0
```

**修复方案**: 重构 `deleteDocument()` 方法，支持两种 docId 格式并根据 sourceType 动态构建前缀：
```typescript
// Step 1: 支持两种 docId 格式
let registryEntries = await vectorRegistryService.getVectorFilesBySourceId(docId);

// 如果按 sourceId 没找到，尝试按注册表 ID 查找
if (registryEntries.length === 0) {
  registryEntries = await vectorRegistryService.getVectorFileById(docId);
}

// Step 2: 根据 sourceType 动态构建删除前缀
if (entry.sourceType === 'worldbook') {
  prefix = `wb_${entry.vectorFileId}_`;  // wb_狼人杀1.0_修复版_
} else {
  prefix = `doc:${entry.sourceId}:`;      // doc:doc_xxx:
}

const deleted = await vectorStoreService.deleteByPrefix(prefix, {
  sourceType: entry.sourceType,
  sourceId: entry.sourceId,
});

// Step 2.5: 使用相同的前缀检查剩余计数
const remainingCount = await vectorStoreService.countByPrefix(prefix);

// 回退方案：尝试两种前缀
const deleted1 = await vectorStoreService.deleteByPrefix(`doc:${docId}:`);
const deleted2 = await vectorStoreService.deleteByPrefix(`wb_${docId}_`);
totalDeleted = deleted1 + deleted2;
```

**影响**:
- 修复前：删除世界书时 `totalDeleted=0`，向量数据残留
- 修复后：正确识别注册表条目，使用正确的 `wb_` 前缀删除 119 个向量

---

## 修复效果

- ✅ `vecstore_metadata.json` 中已存在的条目数据（如"疯狂动物城"）不再被覆盖
- ✅ 查询"疯狂动物城"正确返回相关结果（相似度 51.8%）
- ✅ 元数据缓存直接从持久化文件加载，确保完整性
- ✅ 删除约 100 行死代码，简化了维护
- ✅ WASM store 正确以维度 4096 创建（而非默认 384）
- ✅ 119 个向量全部成功导入到 WASM store
- ✅ metadata 正确解包为扁平结构，前端显示正常
- ✅ 查询范围下拉框正确显示可用的向量文件列表
- ✅ 选中 scope 后，"测试存储连接"正确显示对应文件的向量数量（122条）
- ✅ 搜索"疯狂动物城"正确返回相关结果，第一条即为"疯狂动物城"相关内容
- ✅ 选中状态跨会话持久化（Zustand persist 中间件）
- ✅ 对话模块 context.retrieve 支持 scopeIds 过滤
- ✅ 应用已重新编译，所有修复已包含在 `dist/main/index.js` 中
- ✅ 删除世界书时正确删除向量化数据（vecstore 文件）
- ✅ 删除世界书时正确更新 vector_registry.json 注册表

---

## Bug 修复时间线

| 版本 | 日期 | Bug 编号 | 描述 |
|------|------|---------|------|
| v1.9.3 | 2026-05-04 | Bug 4 | 元数据缓存被 WASM 导出数据覆盖（`buildMetadataCache()` 中的 `clear()`） |
| v1.9.4 | 2026-05-04 | Bug 5 | 维度检测不支持 `.records` 格式（WASM store 使用错误维度 384 创建） |
| v1.9.4 | 2026-05-04 | Bug 6 | 向量导入未处理 `.records` 字段（119 个向量全部导入失败） |
| v1.9.4 | 2026-05-04 | Bug 7 | `metadata.fields` 嵌套结构未解包（元数据字段丢失） |
| v1.9.5 | 2026-05-04 | Bug 8 | `deleteByPrefix` 在 vecstore 模式下未初始化目标 store（跳过未初始化的 store 导致删除失败） |
| v1.9.5 | 2026-05-04 | Bug 9 | `deleteDocument` 未更新 vector_registry.json 注册表（注册表计数与实际不符，条目残留） |
| v1.9.5 | 2026-05-04 | Bug 10 | `deleteDocument` 未删除 vecstore.json 和 vecstore_metadata.json 文件（磁盘文件残留） |
| v1.9.5 | 2026-05-04 | Bug 11 | `deleteDocument` 错误被静默吞没（`catch { return false }` 不输出任何错误日志） |
| v1.9.6 | 2026-05-04 | Bug 12 | `deleteWorldBook` 未删除向量化数据（世界书删除时只删除 JSON 文件，vecstore 数据残留） |
| v1.9.6 | 2026-05-04 | Bug 13 | 删除世界书未更新 vector_registry.json 注册表（注册表计数与实际不符） |
| v1.9.7 | 2026-05-04 | Bug 14 | `deleteDocument` 使用注册表 ID 时无法找到条目（传入 `reg_xxx` 但注册表按 `sourceId` 查找，且 worldbook 类型使用 `wb_{name}_` 前缀而非 `doc:` 前缀） |
| v1.9.8 | 2026-05-05 | Bug 15 | **⚠️ 重点标记：Bug 1 的再现 — 聚合搜索路径（无 scopeIds）跳过未初始化的 store**（`VectorStoreService.search()` 第 580-599 行的 `storeBySource` 遍历中，`if (store.initialized)` 条件跳过已销毁但未清理 Map 的 store，与 Bug 1 的 scopeIds 路径缺陷完全同源）。同步修复 sourceType-only 路径的相同缺陷 |
| v1.9.8 | 2026-05-05 | Bug 16 | **⚠️ 重点标记：`destroyAndDeleteFiles()` 后 `storeBySource` Map 残留**（删除世界书/文档后 store 实例留在 Map 中但 `initialized = false`，导致 `loadExistingStoresFromRegistry()` 和聚合搜索双重跳过）。新增 `removeStoreFromCache()` 方法解决 |
| v1.9.8 | 2026-05-05 | Bug 17 | `loadMetadataFromFile()` 路径回退缺陷（`metadataFilePath` 为空时回退到根级默认路径 `userData/METADATA_FILE`，应为 source-specific 路径 `userData/vectors/{source}/{safeSourceId}/METADATA_FILE`） |

**注意**: Bug 4 修复后首次重启应用仍然失败，是因为 Bug 5-7 尚未修复。需要同时修复 Bug 4-7 才能彻底解决问题。

---

## 经验总结

1. **Store 懒加载陷阱**: 当使用 Map 管理多个 store 时，初始化阶段加载的 store 和搜索时的 store 可能不一致，必须在搜索路径上也做初始化检查
2. **Windows 路径兼容性**: 注册表中的逻辑 ID 可能包含文件系统不允许的字符（如冒号），必须在路径构建时进行净化
3. **搜索路径一致性**: 测试和实际搜索应该走相同的代码路径，避免测试通过但实际搜索失败的情况
4. **调试日志重要性**: 在搜索路径上添加详细的 console.log 日志，可以快速定位搜索命中了哪个文件
5. **持久化数据优先原则**: 当存在持久化文件（如 `vecstore_metadata.json`）时，应将其作为唯一可信数据源。不要从内存/缓存导出数据重新覆盖持久化数据
6. **警惕 clear() 调用**: 在数据加载流程中，`this.metadataCache.clear()` 这类清除操作是高风险代码，必须在 clear 之前确认数据已经备份或不再需要
7. **调试技巧**: 通过直接读取 `vecstore_metadata.json` 文件内容可以验证数据是否正确写入，排除写入阶段的问题，聚焦到加载/缓存阶段
8. **单一数据源模式**: 元数据应该只有一个写入点（persist）和一个读取点（loadMetadataFromFile），避免在中间环节被其他数据源覆盖
9. **WASM 数据格式一致性**: WASM store 的 `export_json()` 导出的格式可能与 `import_json()` 期望的输入格式不完全一致。`export_json()` 会将 metadata 包装在 `{"fields": {...}}` 中，而导入时需要解包。必须在导入和导出之间保持格式对称
10. **文件头元数据优先**: vecstore.json 的文件头包含 `dimension` 字段，应优先从文件头读取维度值，而不是依赖第一条向量的长度推断。这既提高了性能，也避免了向量维度不一致时的错误
11. **多层级 Bug 的隐蔽性**: Bug 4 修复后问题仍然存在，说明存在多层级的问题。数据层面正确不代表运行时正确，必须通过编写完整的调试脚本模拟实际运行流程来逐层验证
12. **编译与源码一致性**: 修改 TypeScript 源码后必须重新编译，否则 Electron 应用仍在使用旧的 `dist/` 目录中的代码。编译失败或缓存可能导致修复未生效
13. **⚠️ 重点标记：修复 bug 时应全面审查所有搜索路径**：Bug 1 修复了 scopeIds 路径但遗漏了聚合路径和 sourceType-only 路径，导致 Bug 15。修复流程必须对所有代码路径进行一致性审查，确保同类问题不会在不同模式间重复出现
14. **⚠️ 重点标记：生命周期管理的完整性**：`destroyAndDeleteFiles()` 清理了物理文件和内部状态但未通知容器（`storeBySource` Map），导致 Bug 16。资源的创建和销毁必须对称，销毁时必须通知所有持有引用的容器
15. **⚠️ 重点标记：回退路径的风险**：`loadMetadataFromFile()` 的回退路径指向全局默认文件而非 source-specific 文件，可能导致读取到错误的元数据。回退代码应该只在确实无法构造正确路径时才使用，且应记录警告

---

## Bug 15: 聚合搜索路径 Store 未初始化 (v1.9.8) ⚠️ 重点标记

**严重程度**: 🔴 高 — 导致无 scope 选择的搜索返回不完整或空结果

**发现日期**: 2026-05-05

### 现象
- 用户未选择任何 scope 时，搜索"疯狂动物城"返回空结果或不包含预期条目
- 磁盘数据文件（vecstore.json、metadata、registry）全部正确
- 只有选中特定 scope 时搜索才正常

### 原因
`VectorStoreService.search()` 第 580-599 行的聚合搜索路径：
```typescript
for (const [, store] of this.storeBySource) {
  if (store.initialized) {  // ← 跳过未初始化的 store！
    const sourceResults = await store.search(query, topK * 2, filter);
    allResults.push(...sourceResults);
  }
}
```

Bug 1 的 scopeIds 路径已修复（先初始化再搜索），但聚合路径和 sourceType-only 路径未同步修复。

### 修复
在三个搜索路径（scopeIds、sourceType-only、aggregate）中统一处理未初始化 store：
```typescript
if (!store.initialized) {
  await store.initialize({ source, sourceId });
}
await store.search(...)
```

### 修复文件
- [VectorStoreService.ts](file:///g:/AI/creative-cafe/src/main/services/VectorStoreService.ts#L580-L599)

---

## Bug 16: destroyAndDeleteFiles() 后 Map 残留 (v1.9.8) ⚠️ 重点标记

**严重程度**: 🔴 高 — 导致删除后重新向量化的搜索功能不可用

**发现日期**: 2026-05-05

### 现象
- 删除世界书后重新向量化，搜索时仍跳过该世界书的向量数据
- `loadExistingStoresFromRegistry()` 找不到新向量化数据

### 原因
`VecstoreVectorStore.destroyAndDeleteFiles()` 将 `this.initialized = false` 但并不从 `storeBySource` Map 中移除自身。之后：
1. `loadExistingStoresFromRegistry()` 检查 `storeBySource.has(key)` → true → 跳过初始化
2. 聚合搜索检查 `store.initialized` → false → 跳过搜索

### 修复
1. 在 `VectorStoreService` 添加 `removeStoreFromCache(source, sourceId)` 公开方法
2. 在 `worldBookService.deleteWorldBook()` 的 `destroyAndDeleteFiles()` 后调用 `removeStoreFromCache()`
3. 在 `loadExistingStoresFromRegistry()` 中增加对已存在但未初始化 store 的重新初始化逻辑

### 修复文件
- [VectorStoreService.ts](file:///g:/AI/creative-cafe/src/main/services/VectorStoreService.ts#L77-L85)
- [worldBookService.ts](file:///g:/AI/creative-cafe/src/main/services/worldBookService.ts#L351-L356)

---

## Bug 17: Metadata 路径回退缺陷 (v1.9.8)

**严重程度**: 🟡 中 — 极端情况下可能加载错误的元数据文件

**发现日期**: 2026-05-05

### 现象
- 当 `metadataFilePath` 未提前设置时，回退路径指向全局默认文件而非 source-specific 文件

### 原因
```typescript
if (!this.metadataFilePath) {
  this.metadataFilePath = path.join(app.getPath('userData'), METADATA_FILE);
  // 错误：使用了根级 vecstore_metadata.json，而非 vectors/worldbook/{name}/vecstore_metadata.json
}
```

### 修复
将回退路径改为 source-specific 路径：
```typescript
if (!this.metadataFilePath) {
  this.metadataFilePath = path.join(app.getPath('userData'), 'vectors', this.source, this.getSafeSourceId(), METADATA_FILE);
}
```

### 修复文件
- [VecstoreVectorStore.ts](file:///g:/AI/creative-cafe/src/main/services/VecstoreVectorStore.ts#L840-L843)
