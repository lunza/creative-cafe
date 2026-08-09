# RAG 标签库：防止 AI 生成标签库以外的无效标签

## Context

当前 AI 生成角色特征（`characterTraitAIService`）时，LLM 可能生成不在 Danbooru/e621 标签库中的无效 tag（如 `extreme long shot`）或格式不一致的 tag（如 `white fur` 但标签库中是 `white_fur`）。系统已有 31.7 万条标签的 `tagAutocompleteService.tagMap`，但 AI prompt 中未利用这个标签库。

用户选择 **RAG 向量检索方案**：将 32 万标签向量化存储到 sqlite-vec，AI 生成特征前用用户描述进行语义检索，将 top N 相关标签注入 prompt 作为参考，引导 LLM 使用有效标签。

**前置条件**：用户需在设置中配置 EmbeddingService（远程 API 如 OpenAI text-embedding-3-small，或本地 ONNX 模型）。

## 架构设计

```
一次性向量化（用户手动触发，带进度反馈）：
  tagAutocompleteService.tagMap (31.7万 TagInfo)
    → 分批 100条/批 → EmbeddingService.generateBatchEmbeddings()
    → VectorStoreService.addBatch() source='tag_library'
    → userData/vectors/tag_library/<csvHash>/<dim>/vectors.db

检索 + Prompt 注入（每次 AI 生成特征时）：
  characterTraitAIService.generateCharacterTraits(description)
    → tagRagService.searchRelevantTags(description, topK=40)
      → embeddingService.generateEmbedding(description)
      → vectorStoreService.search(queryVec, 40, {source:'tag_library'})
    → buildRagReferencePrompt(relevantTags)
    → 追加到 system prompt 尾部
    → LLM 调用
```

**降级保证**：RAG 任何环节失败（未配置/未向量化/检索失败）均返回空字符串，不阻塞现有 AI 生成功能。`settings.tagRag.enabled=false` 时完全跳过。

## 新增文件

| 文件 | 职责 |
|------|------|
| `src/shared/types/tagRag.types.ts` | 共享类型：TagRagStatus / TagRagState / TagRagProgressEvent / TagRagSearchRequest / TagRagSearchResultItem / TagRagMeta |
| `src/main/services/tagRagService.ts` | 核心服务（~600行）：vectorizeAll / searchRelevantTags / buildRagReferencePrompt / 状态管理 + meta 持久化 |
| `src/main/services/tagRagProgressEmitter.ts` | 进度事件发射器（~80行）：封装 webContents.send 广播 |
| `src/main/ipc/handlers/tagRagHandlers.ts` | IPC 处理器（~200行）：6 个 tagRag:* 通道 |
| `src/renderer/components/Settings/TagRagSettings.tsx` | 设置面板（~350行）：状态卡片 + 进度条 + 向量化按钮 + 检索测试区 |
| `src/main/services/__tests__/tagRagService.test.ts` | 单元测试 |

## 修改文件

| 文件 | 改动点 |
|------|--------|
| `src/main/types/vectorConfig.ts` | 新增 `VectorSourceType.TAG_LIBRARY = 'tag_library'` 枚举 + 配套 Label/StorageConfig |
| `src/shared/settings.ts` | `defaultSetting` 追加 `tagRag` 配置块（enabled/topK/minScore/batchSize 等） |
| `src/main/services/tagAutocompleteService.ts` | 新增 `getAllTags(): TagInfo[]` 公开方法；`loadInternal` 末尾广播 `tag-csv-loaded` 事件（含 csvHash） |
| `src/main/services/characterTraitAIService.ts` | 三个生成方法中新增 `buildRagReferenceSection(queryText)` 调用，注入 RAG 参考段落 |
| `src/main/ipc/index.ts` | 注册 `registerTagRagHandlers()` |
| `src/main/preload.ts` + `electron.d.ts` | 暴露 `tagRag` 命名空间（含 `onProgress` 订阅） |
| `src/renderer/components/Settings/Settings.tsx` | 追加 `<TagRagSettings>` 子面板 |

## 核心方法签名

```typescript
// TagRagService
class TagRagService {
  getStatus(): TagRagState;
  async vectorizeAll(options?: { force?: boolean }): Promise<{ success, vectorized, failed, error? }>;
  cancelVectorization(): void;
  async searchRelevantTags(request: TagRagSearchRequest): Promise<TagRagSearchResultItem[]>;
  buildRagReferencePrompt(tags: TagRagSearchResultItem[]): string;
  async clearIndex(): Promise<{ success, error? }>;
  async initialize(): Promise<void>;  // 注册 dimension/CSV 变更监听
}
```

## 向量化流程

1. **前置检查**：status != vectorizing → 进入 vectorizing 状态
2. **加载标签库**：`tagAutocompleteService.ensureLoaded()` → `getAllTags()` 获取 31.7 万条 TagInfo
3. **索引指纹**：csvHash = sha256(csvPath + fileSize + mtimeMs)；若 meta 匹配且 force=false → 跳过
4. **分批向量化**（核心循环）：
   - batchSize = 100（远程）/ 32（本地 ONNX）
   - 每批：`generateBatchEmbeddings(texts)` → 构造 VectorItem[] → `backend.addBatch(items)`
   - embedding 文本 = `tag.name`（简洁，Danbooru tag name 已语义化）
   - 失败重试 3 次（指数退避），整批失败计入 failedCount 继续下一批
   - 每批完成发射 progress 事件（current/total/percentage/eta）
5. **最终化**：写入 meta（csvHash/dimension/model/totalTags/vectorizedCount），状态转 ready

**取消机制**：`cancelVectorization()` 设置标志位，主循环每批开始时检查，取消后状态转 idle。

## Prompt 注入格式

```
【标签库参考】
以下是与你正在提取的角色特征语义相关的 Danbooru/e621 标签（按相似度降序，括号内为出现次数）。
请优先使用以下标签或其语义等价的下划线版本，不要凭空创造标签库以外的新标签。

相关标签（共 40 条）：
- white fur (892341)
- dog girl (456789)
- blue eyes (1234567)
- ...

注意事项：
1. 优先选用 count 较高的标签（模型训练时见过更多次）
2. 标签标准格式为下划线连接（如 long_hair）
3. 若角色特征与所有参考标签相似度都低，按你的判断输出最接近的标签
```

三个生成方法的 query 选择：
- `generateCharacterTraits` → `params.description`（角色描述）
- `recognizeImageTraits` → `params.characterName || 'character'`（图片无文本，用角色名）
- `generateDynamicScenePrompts` → `params.naturalLanguageInput`（自然语言指令）

## Task 分解（12 个任务）

| # | 任务 | 依赖 | 状态 |
|---|------|------|------|
| 1 | 共享类型定义 `tagRag.types.ts` | — | ✅ |
| 2 | 扩展 `VectorSourceType.TAG_LIBRARY` 枚举 | 1 | ✅ |
| 3 | `defaultSetting` 追加 `tagRag` 配置块 | 1 | ✅ |
| 4 | `TagRagProgressEmitter` 实现 | 1 | ✅ |
| 5 | **TagRagService 核心实现**（最复杂，含 vectorizeAll/searchRelevantTags/buildRagReferencePrompt/状态管理/meta 持久化/事件监听） | 1,2,4 | ✅ |
| 6 | `tagAutocompleteService` 新增 `getAllTags()` + 广播 CSV 加载事件 | 1 | ✅ |
| 7 | IPC handlers 注册 | 5 | ✅ |
| 8 | preload 暴露 `tagRag` API | 7 | ✅ |
| 9 | `characterTraitAIService` 注入 RAG 参考段落 | 5 | ✅ |
| 10 | `TagRagSettings` 渲染面板 | 8 | ✅ |
| 11 | 单元测试 | 5 | ✅（24 用例全部通过） |
| 12 | 文档增量更新（CODE_WIKI/CHANGELOG/FIX_RECORDS） | 全部 | ✅ |

> 12 个 Task 全部完成（2026-08-06）。实现记录详见 `docs/FIX_RECORDS.md` §7.1 ~ §7.8，架构描述详见 `CODE_WIKI.md`「RAG 标签库」章节。运行时端到端验证（向量化 / 检索 / AI 生成 / stale 事件链路）待 Electron 集成测试补位。

## 验证方案

### 单元测试
- mock EmbeddingService + VectorStoreService
- 覆盖：正常向量化 / 分批边界 / embedding 失败重试 / 取消机制 / 维度变更触发 stale / 检索降级 / minScore 过滤 / prompt 构建

### 集成测试（手动）
1. **向量化**：Settings → 标签库 RAG → 开始向量化 → 进度条 0→100% → 状态「就绪」
2. **检索测试**：输入「白色毛发的犬耳少女」→ 返回 white_fur / dog_girl / animal_ears 等相关标签
3. **AI 生成验证**：`tagRag.enabled=true` → 触发 AI 生成特征 → 日志确认 prompt 含「标签库参考」段落 → 返回的 traits 全在标签库中
4. **降级验证**：`tagRag.enabled=false` 或未向量化 → AI 生成正常完成，prompt 不含 RAG 段落
5. **维度变更**：切换 dimension → 状态变 stale → 旧维度数据保留 → 重新向量化写入新维度
6. **CSV 更新**：替换 CSV → reload → 状态变 stale → 提示重新向量化

### 性能目标
- 向量化耗时（远程 API）：~1 小时（3176 批 × 1s/批）
- 向量化耗时（本地 ONNX）：~2.5 小时（9925 批 × 1s/批）
- 单次检索延迟：< 100ms（sqlite-vec KNN）
- 端到端 AI 生成延迟增加：< 500ms
- DB 文件大小：~1.9GB（1536 维 × 31.7 万 × 4B）

## 成本与风险

| 风险 | 缓解措施 |
|------|----------|
| 向量化耗时长（1-2.5 小时） | 进度可视 + 可取消 + EmbeddingService 有 content-hash 缓存（重新向量化相同标签时秒完成） |
| 磁盘空间 1.9GB | 可选 384 维模型降至 500MB；日志提示空间需求 |
| 远程 API 配额 | 100 条/批远在 OpenAI 8192 token 限制内；重试 + 可取消 |
| LRU 缓存驱逐 | searchRelevantTags 前调用 ensureStoreInitialized，驱逐后自动重建 |
| 维度变更后查询失效 | status='stale' 时直接返回 []，避免无效查询 |
| 循环依赖 | characterTraitAIService 用动态 import('./tagRagService') |

## 关键复用点

- **EmbeddingService**（`src/main/services/EmbeddingService.ts`）：`generateEmbedding(text)` / `generateBatchEmbeddings(texts)`，含 content-hash 缓存
- **SqliteVecBackend**（`src/main/services/SqliteVecBackend.ts`）：`initialize({source, sourceId})` / `addBatch(items)` / `search(query, topK, filter)`
- **VectorStoreService**（`src/main/services/VectorStoreService.ts`）：`getVecstoreStoreForSource(source, sourceId)` 多源路由
- **tagAutocompleteService**（`src/main/services/tagAutocompleteService.ts`）：`tagMap`（31.7 万 TagInfo），需新增 `getAllTags()` 公开方法
- **vectorConfigManager** 事件：`VECTOR_DIMENSION_CHANGE_EVENT` 监听维度变更
