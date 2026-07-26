# 文档向量化测试 - 完整知识库

## 一、核心功能

### 1.1 功能概述

文档向量化测试模块是 Creative-Cafe 项目的核心功能之一，提供从文档上传、文本提取、分块处理、向量生成、向量存储到结果查看和语义测试的完整流水线。

### 1.2 核心功能清单

| 功能 | 说明 | 入口 |
|------|------|------|
| **文档上传** | 支持 PDF/DOCX/XLSX/TXT/MD 格式，最大 50MB | 测试页面 → 文档向量化 → Tab 1 |
| **自动分块** | 智能文本分段，每段最大 500 字符，重叠 50 字符 | 自动触发 |
| **批量向量化** | 使用远程/本地 Embedding API 批量生成向量（每批 10 条） | 自动触发 |
| **向量存储** | JSON 文件或 Vecstore WASM 模式存储 | 自动触发 |
| **向量查看** | 统计卡片 + 分块详情表格 | Tab 2：向量查看 |
| **相似性查询** | 语义搜索，支持限定文档范围和 TopK 选择 | Tab 3：向量测试 |
| **向量化测试** | 输入任意文本查看向量数据和维度信息 | Tab 3：向量测试 |

### 1.3 辅助功能

| 功能 | 说明 |
|------|------|
| 实时进度反馈 | 5 阶段进度（上传→解析→分块→向量化→存储） |
| 文档管理 | 列表展示、详情查看、删除文档及向量数据 |
| 向量统计 | 总向量数、文档数量、平均每文档向量数 |
| 相似度可视化 | 进度条 + 颜色区分（绿/黄/橙/红） |

### 1.4 边界情况处理

| 边界情况 | 处理方式 |
|----------|---------|
| 空文本 | 跳过向量化，记录警告 |
| 超长段落（>500 字符） | 智能分割，保持语义连贯性 |
| 无空格长文本（中文/日文） | 防护机制：确保每次分割后 remaining 缩短，防止无限循环 |
| 大文件（接近 50MB） | 分批处理，每批 10 个 chunk，避免内存溢出 |
| 网络异常 | 重试机制 + 错误捕获，返回明确错误信息 |
| API 超时 | 60 秒超时保护，防止永久等待 |
| WASM 初始化失败 | 30 秒超时 + 异步文件读取，避免主进程阻塞 |

---

## 二、实现方法

### 2.1 技术选型

| 组件 | 技术栈 | 版本 | 用途 |
|------|--------|------|------|
| 框架 | Electron | ^35.1.4 | 桌面应用运行时 |
| 前端 | React + TypeScript | ^19.1.0 | UI 组件和类型安全 |
| 状态管理 | Zustand | ^5.0.5 | 前端状态管理 |
| UI 组件 | Ant Design | ^6.0.0 | 界面组件库 |
| 向量存储 | Vecstore-wasm / JSON | - | 持久化向量数据 |
| 向量化 | EmbeddingService | - | 远程/本地 API 调用 |
| 文档解析 | mammoth / pdf-parse / xlsx | - | 提取文档文本 |

### 2.2 算法原理

#### 2.2.1 文本分块算法

```
输入: 原始文本 text
输出: DocumentChunk[] 数组

流程:
1. 清理换行符: \r\n → \n
2. 按段落分割: split(/\n\s*\n/)
3. 遍历每个段落:
   a. 段落长度 <= 500 字符: 合并到当前 chunk
   b. 段落长度 > 500 字符:
      - 在 500 字符处寻找最后空格作为分割点
      - 若无空格或分割点太小，强制在 500 处分割
      - 每次分割保留 50 字符重叠（CHUNK_OVERLAP）
      - 防护: 确保 newRemaining.length < remaining.length
4. 返回所有 chunks
```

**关键参数**:
- MAX_CHUNK_SIZE = 500 字符
- CHUNK_OVERLAP = 50 字符

#### 2.2.2 余弦相似度算法

```
cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)

其中:
- A · B = Σ(Ai × Bi)  (点积)
- ||A|| = √(Σ(Ai²))   (L2 范数)
- 结果范围: [0, 1]，1 表示完全相同
```

**实现**: 由 vecstore-wasm WASM 模块或 JSONVectorStore 计算。

#### 2.2.3 向量化批处理算法

```
输入: chunks[] (可能数百个)
流程:
1. 将 chunks 按 batchSize=10 分批
2. 对每批:
   a. 调用 EmbeddingService.generateBatchEmbeddings(texts)
   b. 等待 API 返回向量
   c. 收集 embeddings
3. 所有批完成后，一次性批量写入向量存储
4. 仅调用一次 persist() 写入磁盘
```

**优化点**: 
- 批量写入避免 O(n) 次磁盘 I/O
- 每批 10 条限制网络请求大小
- 异步 persist() 避免阻塞主进程

### 2.3 代码架构

```
DocumentVectorPage.tsx (UI Layer)
├── Tabs (3 个 Tab)
│   ├── Tab 1: 文档上传
│   ├── Tab 2: 向量查看
│   └── Tab 3: 向量测试
│
documentVectorService.ts (Service Layer - Renderer)
├── processDocument()
├── listDocuments()
├── getDocumentChunks()
├── searchDocumentVectors()
├── getVectorStats()
└── generateEmbedding()
│
IPC Channel (Communication Layer)
├── document:process
├── document:list
├── document:delete
├── document:getInfo
├── document:getChunks
├── document:searchVectors
├── document:getVectorStats
└── document:generateEmbedding
│
DocumentProcessorService.ts (Service Layer - Main)
├── processDocument()
│   ├── extractText() → 文档解析
│   ├── chunkText() → 分块处理
│   ├── generateBatchEmbeddings() → 向量化
│   └── addBatchNoPersist() → 存储
├── getDocumentChunks()
├── searchDocumentVectors()
└── getVectorStats()
│
EmbeddingService.ts (Vector Generation)
├── generateEmbedding() → 单条向量化
└── generateBatchEmbeddings() → 批量向量化
│
VectorStoreService.ts (Storage Layer)
├── JSONVectorStore → JSON 文件模式
└── VecstoreVectorStore → WASM 模式
```

### 2.4 关键逻辑说明

#### 2.4.1 无限循环防护

```typescript
// 修复前（存在无限循环风险）:
remaining = remaining.slice(Math.max(0, splitPoint - CHUNK_OVERLAP));

// 修复后（确保每次循环后 remaining 必然缩短）:
const overlapStart = Math.max(0, splitPoint - CHUNK_OVERLAP);
const newRemaining = remaining.slice(overlapStart).trimStart();
if (newRemaining.length >= remaining.length) {
  remaining = remaining.slice(Math.min(splitPoint + 1, remaining.length));
} else {
  remaining = newRemaining;
}
```

#### 2.4.2 批量存储优化

```typescript
// 修复前（O(n) 次磁盘写入）:
for (let i = 0; i < chunks.length; i++) {
  await vectorStoreService.add(...); // 每次触发 persist()
}

// 修复后（O(1) 次磁盘写入）:
const itemsToStore = chunks.map((chunk, i) => ({...}));
await vectorStoreService.addBatchNoPersist(itemsToStore); // 仅最后 persist() 一次
```

#### 2.4.3 WASM 初始化超时

```typescript
await Promise.race([
  init(),
  this.timeout(WASM_INIT_TIMEOUT)  // 30 秒超时
]);
```

---

## 三、测试规范

### 3.1 测试环境要求

| 要求项 | 最低配置 | 推荐配置 |
|--------|---------|---------|
| 操作系统 | Windows 10 / macOS 11 | Windows 11 / macOS 12+ |
| 内存 | 4 GB | 8 GB+ |
| 磁盘空间 | 500 MB 可用空间 | 2 GB+ 可用空间 |
| 网络 | 稳定的互联网连接（远程模式） | 低延迟网络（<200ms） |
| Node.js | v20+ | v22+ |
| 远程 API | 可用的 Embedding API 端点 | 响应时间 <2s |

### 3.2 测试用例设计标准

#### 3.2.1 功能测试用例

| 用例 ID | 测试场景 | 输入 | 预期输出 | 优先级 |
|---------|---------|------|---------|--------|
| DOC-001 | 上传 PDF 文件 | 有效 PDF (<50MB) | 成功处理，显示分块数 | P0 |
| DOC-002 | 上传 DOCX 文件 | 有效 DOCX | 成功处理 | P0 |
| DOC-003 | 上传 TXT 文件 | 有效 TXT | 成功处理 | P0 |
| DOC-004 | 上传 MD 文件 | 有效 Markdown | 成功处理 | P1 |
| DOC-005 | 上传 XLSX 文件 | 有效 Excel | 成功处理 | P1 |
| DOC-006 | 上传超大文件 | 文件 >50MB | 提示文件过大 | P1 |
| DOC-007 | 上传不支持格式 | .jpg/.png 等 | 提示格式不支持 | P1 |
| DOC-008 | 空文档处理 | 空白 TXT | 成功处理，0 分块 | P2 |
| DOC-009 | 中文文档 | 无空格中文文本 | 正确分块，无无限循环 | P0 |
| DOC-010 | 超长段落 | 单段 >5000 字符 | 正确分割为多个 chunks | P0 |

#### 3.2.2 向量查看测试用例

| 用例 ID | 测试场景 | 预期输出 | 优先级 |
|---------|---------|---------|--------|
| VIEW-001 | 查看向量统计 | 显示总向量数、文档数 | P0 |
| VIEW-002 | 查看分块详情 | 显示分块表格，文本完整 | P0 |
| VIEW-003 | 多文档分块 | 正确加载指定文档的分块 | P1 |
| VIEW-004 | 删除文档后查看 | 向量统计自动更新 | P1 |

#### 3.2.3 向量测试用例

| 用例 ID | 测试场景 | 输入 | 预期输出 | 优先级 |
|---------|---------|------|---------|--------|
| TEST-001 | 相似性查询 | 有意义查询文本 | 返回 TopK 结果，按相似度排序 | P0 |
| TEST-002 | 查询限定文档 | 选择特定文档 | 仅返回该文档的结果 | P0 |
| TEST-003 | 空查询 | 空文本 | 提示"查询文本不能为空" | P1 |
| TEST-004 | 向量化测试 | 任意文本 | 显示向量维度（384）和值 | P0 |
| TEST-005 | 向量化空文本 | 空文本 | 提示"文本不能为空" | P1 |
| TEST-006 | 相似度颜色 | 不同 score | ≥80%绿/≥60%黄/≥40%橙/<40%红 | P2 |

#### 3.2.4 性能测试用例

| 用例 ID | 测试场景 | 预期指标 | 优先级 |
|---------|---------|---------|--------|
| PERF-001 | 小文件处理 | <5s 完成 (1MB 文本) | P1 |
| PERF-002 | 中文件处理 | <30s 完成 (10MB PDF) | P1 |
| PERF-003 | 大文件处理 | <120s 完成 (50MB) | P2 |
| PERF-004 | 查询响应 | <2s 返回结果 | P1 |
| PERF-005 | 内存占用 | 处理过程 <500MB | P1 |

### 3.3 测试流程

```
1. 环境准备
   ├── 启动应用
   ├── 确认 Embedding API 配置正确
   └── 准备测试文件

2. 功能测试
   ├── 上传测试文件
   ├── 等待处理完成
   └── 验证处理结果（分块数、向量数）

3. 向量查看测试
   ├── 切换到"向量查看" Tab
   ├── 验证统计数据
   └── 点击"分块"查看分块详情

4. 向量测试
   ├── 切换到"向量测试" Tab
   ├── 执行相似性查询
   ├── 验证结果排序和相似度
   └── 执行向量化测试
   └── 验证向量维度和数据

5. 边界测试
   ├── 上传不支持格式
   ├── 上传超大文件
   ├── 输入空查询
   └── 断网环境测试

6. 结果记录
   ├── 记录通过/失败状态
   ├── 截图失败场景
   └── 输出测试报告
```

### 3.4 测试结果评估指标

| 指标 | 目标值 | 计算方法 |
|------|--------|---------|
| 功能通过率 | ≥95% | 通过用例数 / 总用例数 |
| 处理成功率 | ≥98% | 成功处理文档数 / 总尝试数 |
| 查询准确率 | ≥90% | 人工评估相关结果 / 总返回结果 |
| 平均处理时间 | <30s | 所有测试文件处理时间的平均值 |
| P95 查询延迟 | <3s | 95% 的查询在 3s 内返回 |
| 内存峰值 | <500MB | 监控进程内存最大值 |

---

## 四、常见问题解决方案

### 4.1 严重问题

#### Q1: 上传文档后系统完全卡死

**症状**: 点击"选择文档文件"后，UI 完全冻结，无任何响应

**根因**: 4 个缺陷共同导致
1. 文本分块无限循环（中文无空格文本）
2. 每次 add 触发 persist()，O(n) 次磁盘写入
3. WASM 初始化无超时
4. 同步文件操作阻塞主进程

**解决方案**: 已在 v1.6.2 中修复
- 无限循环防护
- addBatchNoPersist 批量写入
- WASM 30 秒超时
- 异步 fsPromises 文件操作

**验证方法**: 上传包含连续中文字符的文档（如技术文档），观察是否正常完成

---

#### Q2: 处理中文文档时向量化时间极长

**症状**: 中文文档处理时间远超英文文档

**根因**: chunkText 算法在找不到空格时可能重复扫描

**解决方案**: 已在 v1.6.2 修复，添加 remaining 长度检测

---

### 4.2 一般问题

#### Q3: 向量化测试报"未配置远程 Embedding API 地址"

**原因**: 设置页面未配置 API 地址或配置未保存

**解决方案**:
1. 进入设置 → 向量模型配置
2. 填写远程 API 地址
3. 点击"保存"
4. 重新测试

---

#### Q4: 搜索查询返回空结果

**原因**: 
1. 向量存储中无数据
2. 查询文本与存储内容语义不相关
3. 相似度阈值过高

**解决方案**:
1. 确认已处理文档并存储向量
2. 尝试更通用的查询词
3. 增加 TopK 数量

---

#### Q5: Vecstore WASM 模式加载缓慢

**原因**: vecstore.json 文件过大（积累了大量历史向量）

**解决方案**:
1. 定期清理不需要的文档
2. 切换到 JSON 模式（如果数据量不大）
3. 等待 v1.7+ 的异步加载优化

---

### 4.3 边界问题

#### Q6: 超大文件（接近 50MB）处理失败

**原因**: 内存限制或 API 超时

**解决方案**:
1. 分割文件为多个小文件
2. 增加 Embedding API 超时时间
3. 检查系统可用内存

---

#### Q7: 特殊格式文档解析乱码

**原因**: 文档编码非 UTF-8

**解决方案**:
1. 转换为 UTF-8 编码后上传
2. 对于 PDF，检查是否包含扫描图片（OCR 不支持）

---

## 五、最佳实践

### 5.1 文档准备

| 建议 | 说明 |
|------|------|
| 使用 UTF-8 编码 | 确保正确解析文本内容 |
| 文件大小 <10MB | 提高处理速度，降低失败率 |
| 优先使用 TXT/MD | 解析最快速，无依赖 |
| 避免扫描 PDF | 不含文本层的 PDF 无法提取内容 |

### 5.2 配置建议

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| 向量化模式 | 远程模式 | 本地模型仅推荐有 GPU 时使用 |
| 批量大小 | 10 | 默认值，平衡速度和稳定性 |
| 相似度阈值 | 0.7 | 平衡召回和精度 |
| TopK | 5-10 | 常规查询足够 |

### 5.3 性能优化

| 策略 | 效果 |
|------|------|
| 定期清理文档 | 减少向量存储大小，加快搜索 |
| 使用 JSON 模式 | 数据量 <5000 时更快 |
| 使用 Vecstore 模式 | 数据量 >5000 时搜索更快 |
| 限制查询范围 | 指定文档而非全部搜索 |

### 5.4 测试建议

| 建议 | 说明 |
|------|------|
| 准备测试文档集 | 包含各种格式、大小、语言 |
| 定期回归测试 | 每次版本更新后执行 |
| 监控内存使用 | 大文件处理时观察 Task Manager |
| 记录 API 响应时间 | 识别网络问题 |

---

## 六、版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| 1.6.0 | 2026-05-02 | 初始文档向量化功能 |
| 1.6.2 | 2026-05-02 | 修复卡死问题（无限循环/O(n) 写入/WASM 超时） |
| 1.7.0 | 2026-05-02 | 添加向量查看和测试功能 |
| 1.7.1 | 2026-05-02 | 知识库文档同步完成 |

---

## 七、参考链接

| 资源 | 链接 |
|------|------|
| 技术文档 | `docs/TECHNICAL_DOCUMENTATION.md` 第 3.11 节 |
| 前端组件 | `src/renderer/components/Test/DocumentVectorPage.tsx` |
| 主进程服务 | `src/main/services/DocumentProcessorService.ts` |
| 向量化服务 | `src/main/services/EmbeddingService.ts` |
| 向量存储 | `src/main/services/VectorStoreService.ts` |
| IPC 处理器 | `src/main/ipc/handlers/documentHandlers.ts` |
