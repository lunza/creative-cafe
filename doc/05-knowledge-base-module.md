# 知识库模块 (Knowledge Base Module) 技术文档

> 模块路径: `src/renderer/components/KnowledgeBase/`
> 源码文件: `KnowledgeBaseManager.tsx`
> 状态管理: `src/renderer/stores/knowledgeBaseStore.ts`
> 后端服务链: `KnowledgeBaseService` → `DocumentProcessorService` → `EmbeddingService` → `VectorStoreService` → `VecstoreVectorStore`
> 配套服务: `VectorCache.ts`, `VectorRegistryService.ts`, `ContextManager.ts`, `KnowledgeBaseDocumentService.ts`

---

## 1. 模块功能描述

知识库模块是 Creative Cafe 的**知识中心与语义检索引擎**，负责管理结构化知识条目和外部文档，并通过向量嵌入实现语义级别的搜索和检索。

### 核心能力

| 能力 | 描述 |
|------|------|
| **知识条目 CRUD** | 创建、编辑、删除、查看知识条目（标题/内容/分类/标签/来源） |
| **文档上传与解析** | 支持 PDF、Word(.docx)、Excel(.xlsx)、TXT、Markdown 格式文档上传，最大 50MB |
| **自动分块处理** | 上传文档后自动按段落分块，每块独立向量化并入库 |
| **树形知识浏览** | 按文档-知识条目层级树形展示，支持懒加载展开子节点 |
| **语义相似性搜索** | 向量化查询文本后余弦相似度匹配，支持 Top K (5/10/20) 返回 |
| **向量化测试** | 测试文本的向量化结果（维度/范围/前20分量） |
| **一键全部向量化** | 批量向量化所有未处理的条目 |
| **文档分块查看** | 查看文档的分块详情（分块索引/文本内容/字符数） |
| **世界书自动索引** | 世界书的向量化条目自动纳入知识库管理 |

### 三标签设计

| 标签 | 功能 |
|------|------|
| **知识列表** | 树形文档-条目浏览、新建/编辑/删除条目、向量化操作 |
| **文档上传** | 文件选择上传、处理进度展示、已处理文档列表、批量删除 |
| **向量测试** | 语义查询测试 + 向量化测试 |

### 功能边界

- 文档支持格式: .pdf, .docx, .doc, .xlsx, .xls, .txt, .md
- 最大文件大小: 50MB
- 向量嵌入依赖本地模型 (@xenova/transformers) 或远程 API

---

## 2. 模块定位与业务价值

### 战略角色

知识库模块是系统的**语义记忆层**，为 AI 对话提供上下文增强能力。

```
┌────────────────────────────────────────────────────┐
│                  对话上下文增强                       │
│  ┌──────────┐  ┌──────────────────────────────────┐│
│  │ AI 对话   │←─│ ContextManager                  ││
│  │          │  │ (检索相关知识 → 压缩 → 注入上下文)  ││
│  └──────────┘  └───────────┬──────────────────────┘│
│                            ↓                        │
│  ┌──────────────────────────────────────────────┐  │
│  │         Knowledge Base (知识库)                │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │  │
│  │  │手动条目  │ │文档分块  │ │世界书条目        │ │  │
│  │  └─────────┘ └─────────┘ └─────────────────┘ │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **长对话记忆不足**: 通过语义搜索检索历史相关知识
2. **外部知识整合**: 将 PDF/Word 等文档纳入 AI 可达知识范围
3. **世界书语义匹配**: 向量化世界书条目后支持语义级选中
4. **知识复用**: 跨对话、跨角色共享知识库

---

## 3. 技术实现方案

### 3.1 后端服务链架构

```
上传文档
  ↓
DocumentProcessorService (解析 PDF/Word/Excel/TXT/MD)
  ├── mammoth (Word)
  ├── pdf-parse (PDF)
  └── 原生解析 (TXT/MD/XLSX)
  ↓                          
分块处理 (按段落/大小分割)     
  ↓                          
EmbeddingService (向量化)     
  ├── 本地: @xenova/transformers (Xenova/all-MiniLM-L6-v2)
  └── 远程: OpenAI 兼容 API
  ↓                          
VecstoreVectorStore (WASM 存储)
  ├── 余弦相似度搜索
  └── 持久化到磁盘
  ↓
VectorRegistryService (注册表)
  └── 追踪向量文件与来源
  ↓
KnowledgeBaseService (统一入口)
  └── 条目管理 + 搜索 API

缓存层: VectorCache (L1 内存 + L2 磁盘)
上下文: ContextManager (检索 → 压缩 → 注入)
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Pipeline** | DocumentProcessorService | 文档解析 → 分块 → 向量化 → 入库 |
| **Strategy** | EmbeddingService | 本地/远程嵌入模式切换 |
| **Registry** | VectorRegistryService | 跟踪向量文件的注册和查找 |
| **Cache-Aside** | VectorCache | L1 内存 + L2 磁盘双层缓存 |
| **Facade** | KnowledgeBaseService | 统一外部接口 |
| **Repository** | VecstoreVectorStore | WASM 向量数据访问抽象 |

### 3.3 核心算法

#### 文档分块策略

```typescript
// DocumentProcessorService
// 1. 解析文档文本
// 2. 按段落分割 (双换行)
// 3. 每个分块限制最大字符数 (约 500-1000 字符)
// 4. 为每个分块生成向量
// 5. 逐块入库存储
```

#### 余弦相似度搜索

```typescript
// VecstoreVectorStore (WASM)
// 1. 生成查询文本的向量 embedding
// 2. 在向量空间中计算余弦距离
// 3. 按相似度排序返回 Top K
```

#### 树形知识库懒加载

```typescript
// KnowledgeBaseManager
// 1. 加载文档列表 (根节点)
// 2. 展开文档时懒加载子条目
//    - 文档: knowledge.list({ documentId })
//    - 世界书: vector.getAvailableScopes()
// 3. 子条目标记 isLeaf: true
```

### 3.4 组件树结构

```
KnowledgeBaseManager
└── Tabs
    ├── Tab[知识列表]
    │   ├── Space[操作栏] (新建/全部向量化/刷新)
    │   └── Table[树形数据]
    │       ├── 文档节点 (可展开)
    │       │   └── 子条目 (isLeaf)
    │       └── 操作: 编辑/向量化/删除/查看
    ├── Tab[文档上传]
    │   ├── Card[上传文档] (上传按钮+进度)
    │   └── Card[已处理文档] (Table+批量删除)
    └── Tab[向量测试]
        ├── Card[测试1: 语义查询]
        │   ├── VectorScopeSelector
        │   ├── TextArea[查询文本] + Select[Top K]
        │   ├── Button[执行查询]
        │   └── Table[查询结果]
        └── Card[测试2: 向量化测试]
            ├── TextArea[测试文本]
            ├── Button[生成向量]
            └── Descriptions[向量信息]

Modal[新建/编辑知识] → Form (标题/内容/分类/标签/来源)
Modal[查看知识条目] → Descriptions
Modal[文档详情] → Descriptions
Modal[文档分块详情] → Table (分块索引/文本/长度)
```

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **WASM 向量存储性能** | 使用 `vecstore-wasm` 的 WASM 实现高效余弦距离计算；L1 内存缓存 + L2 磁盘缓存 |
| **文档格式多样性** | mammoth (Word)、pdf-parse (PDF)、XLSX 库 (Excel)、原生解析 (TXT/MD) |
| **跨源数据聚合** | `searchWithScopes` 统一搜索多个向量源；`getAvailableScopes` 动态列出可用数据源 |
| **嵌入模式切换** | `embeddingService.setMode()` 动态切换本地/远程模式 |
| **重复文档检测** | 上传文档时检测是否已存在（通过 documentId），返回 `isDuplicate` 标志 |

### 4.2 性能优化策略

1. **WASM 加速**: 向量计算在 WebAssembly 中执行
2. **双层缓存**: L1 (内存 Map) + L2 (磁盘文件) 缓存热点向量
3. **懒加载**: 树形知识库按需加载子节点
4. **批处理**: `vectorizeAll` 批量处理防止 UI 阻塞

### 4.3 安全考虑

- 文档类型白名单限制（仅支持 5 种格式）
- 文件大小限制 50MB
- 所有文件操作通过主进程 IPC
- 向量数据存储在独立隔离目录

---

## 5. 模块间关系

### 5.1 依赖关系

```
Knowledge Base Module
    ├──→ Setting Module (向量配置: 嵌入模式/缓存策略)
    ├──→ Vector Module (VectorScopeSelector, searchWithScopes)
    ├──→ WorldBook Module (世界书自动索引)
    ├──→ EmbeddingService (本地/远程向量化)
    │       └──→ @xenova/transformers (本地) / OpenAI API (远程)
    ├──→ VectorStoreService (向量 CRUD)
    │       └──→ VecstoreVectorStore (WASM)
    ├──→ VectorRegistryService (向量注册表)
    ├──→ VectorCache (L1/L2 缓存)
    ├──→ ContextManager (上下文检索+压缩)
    └──→ DocumentProcessorService (文档处理)
```

### 5.2 被依赖关系

```
Character Module
    └──→ KnowledgeBaseBindingPanel (对话知识库绑定)
Context Module
    └──→ context:retrieve / context:compress
```

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 知识条目元数据 | JSON (Vector DB) | VecStore 索引 |
| 向量数据 | WASM 二进制 | VecStore 文件 |
| 文档元数据 | JSON | document 服务管理 |
| 向量注册表 | JSON | `vecstore_metadata.json` |
| L2 缓存 | 磁盘文件 | VectorCache 目录 |

### 6.2 知识条目 Schema

```typescript
interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source: string;          // 'manual' | 'memory_extract' | 'import' | 'document_upload'
  category: string[];      // 角色信息/关系/事件/地点/物品/设定
  tags: string[];
  relatedCharacterIds: string[];
  relatedWorldBookPaths: string[];
  metadata: Record<string, any>;
  documentId?: string;
}
```

### 6.3 数据生命周期

```
手动创建 → 写入向量 DB → 可选向量化
文档上传 → 解析分块 → 批量向量化 → 入库
世界书变更 → 自动同步索引 → 更新向量
删除条目 → 删除向量 + 更新注册表
```

---

## 7. API 文档

### 7.1 知识条目 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `knowledge:list` | `knowledge.list(filter?, page?, pageSize?)` | `filter`, `page`, `pageSize` | `{ success, items, total }` |
| `knowledge:create` | `knowledge.create(data)` | `{ data: KnowledgeItem }` | `{ success, id }` |
| `knowledge:update` | `knowledge.update(id, updates)` | `{ id, updates }` | `{ success }` |
| `knowledge:delete` | `knowledge.delete(id)` | `{ id }` | `{ success }` |
| `knowledge:deleteBatch` | `knowledge.deleteBatch(ids)` | `{ ids: string[] }` | `{ success }` |
| `knowledge:search` | `knowledge.search(query, options?)` | `{ query, options }` | `{ success, results }` |
| `knowledge:vectorize` | `knowledge.vectorize(id)` | `{ id }` | `{ success }` |
| `knowledge:vectorizeAll` | `knowledge.vectorizeAll()` | 无 | `{ success, count }` |
| `knowledge:uploadDocument` | `knowledge.uploadDocument(path, options?)` | `{ filePath, options }` | `{ success, chunkCount, knowledgeItemsCreated }` |
| `knowledge:selectDocumentFile` | `knowledge.selectDocumentFile()` | 无 | `string \| null` |

### 7.2 文档 API

| IPC 通道 | 调用方式 | 说明 |
|---------|---------|------|
| `document:list` | `document.list()` | 获取已处理文档列表 |
| `document:delete` | `document.delete(docId)` | 删除文档及其向量 |
| `document:deleteBatch` | `document.deleteBatch(docIds)` | 批量删除 |
| `document:getInfo` | `document.getInfo(docId)` | 获取文档信息 |
| `document:getChunks` | `document.getChunks(docId)` | 获取文档分块 |
| `document:searchVectors` | `document.searchVectors(query, topK, docId?)` | 文档内语义搜索 |

### 7.3 向量/嵌入 API

| IPC 通道 | 调用方式 | 说明 |
|---------|---------|------|
| `embedding:generate` | `embedding.generate(text)` | 生成文本向量 |
| `embedding:generateBatch` | `embedding.generateBatch(texts)` | 批量向量化 |
| `embedding:setMode` | `embedding.setMode(mode)` | 切换本地/远程模式 |
| `embedding:getMode` | `embedding.getMode()` | 获取当前模式 |
| `vector:search` | `vector.search(query, topK, filter?, scopeIds?)` | 语义搜索 |
| `vector:add` | `vector.add(id, vector, metadata)` | 添加向量 |
| `vector:addBatch` | `vector.addBatch(items)` | 批量添加 |
| `vector:delete` | `vector.delete(id)` | 删除向量 |
| `vector:getAvailableScopes` | `vector.getAvailableScopes()` | 获取可用数据源 |

### 7.4 上下文 API

| IPC 通道 | 调用方式 | 说明 |
|---------|---------|------|
| `context:retrieve` | `context.retrieve(conversation, options)` | 从知识库检索相关上下文 |
| `context:compress` | `context.compress(items, maxTokens)` | 压缩检索到的上下文 |
