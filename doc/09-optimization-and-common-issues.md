# 项目优化建议与跨模块共性问题详录

> 来源: 7 模块文档补充审查 (`doc/08-module-audit-report.md`)
> 目标读者: 开发团队（用于后续迭代规划和重构参考）
> 最后更新: 2026-05-07

---

## 目录

1. [跨模块 IPC 调用模式共性问题](#一跨模块-ipc-调用模式共性问题)
2. [跨模块缓存策略共性问题](#二跨模块缓存策略共性问题)
3. [跨模块命名规范共性问题](#三跨模块命名规范共性问题)
4. [跨模块死代码与 Fake Feature 共性问题](#四跨模块死代码与-fake-feature-共性问题)
5. [跨模块错误处理共性问题](#五跨模块错误处理共性问题)
6. [P0 级问题详细方案](#六p0-级问题详细方案)
7. [P1 级问题详细方案](#七p1-级问题详细方案)
8. [P2 级问题详细方案](#八p2-级问题详细方案)
9. [各模块死代码清理清单](#九各模块死代码清理清单)
10. [建议的重构路线图](#十建议的重构路线图)

---

## 一、跨模块 IPC 调用模式共性问题

### 1.1 IPC Handler 注册但无渲染进程调用（孤立的 Handler）

**问题描述**：主进程（`src/main/ipc/handlers/`）中注册了完整的 `ipcMain.handle()` 监听器，preload.ts 中也暴露了对应的 `electronAPI` 方法，但渲染进程中**从未有任何组件调用这些 API**。这导致完整的功能链路已布线但完全死寂。

**影响模块及具体条目**：

| IPC 通道 | Handler 文件 | Handler 行号 | Preload 行号 | 预期调用方 | 遗漏原因分析 |
|---------|------------|------------|------------|-----------|-------------|
| `characterConfig:load` | `characterHandlers.ts` | L127-L134 | `preload.ts:L77` | `useCharacterConfig` Hook | 设计时预留了文件持久化读取路径，但实际实现时只用了 localStorage 读取；文件写入 (`characterConfig:save`) 正常工作，形成「只写不读」的半实现 |
| `chatVector:vectorize` | `characterChatHandlers.ts` | L74-L77 | `preload.ts:L269` | `useCharacterDialogueChat` | 对话向量化功能已完整实现后端（`ChatVectorizationService`），但前端对话流程中走的是 `context:retrieve` 而非此专用通道，从未被集成 |
| `chatVector:delete` | `characterChatHandlers.ts` | L79-L82 | `preload.ts:L270` | 同上 | 同上 |
| `chatVector:search` | `characterChatHandlers.ts` | L84-L87 | `preload.ts:L271` | 同上 | 同上 |
| `searchItems` (Store 函数) | `knowledgeBaseStore.ts` | L290-L303 | `preload.ts:L222` | `KnowledgeBaseManager` | 知识库 UI 的「向量测试」标签走的是 `searchWithScopes`（直接调 `vector:search`），而 `searchItems` 走的是 `knowledge:search` IPC，后者在 UI 中完全没有入口 |

**清理建议**：
- **选项 A（保留以待集成）**：如果功能确实 planned for future，在对应文件头部添加 `// TODO: Planned for vX.X - see doc/09-optimization-and-common-issues.md` 注释
- **选项 B（立即清理）**：如果近期无集成计划，移除 handler 注册代码、preload 暴露代码，减少 maintenance surface

### 1.2 IPC 暴露在 Preload 但无 Handler 注册（永不回复）

**问题描述**：`preload.ts` 中通过 `ipcRenderer.invoke()` 暴露了 IPC 通道，但主进程中**完全没有**对应的 `ipcMain.handle()` 注册。渲染进程调用后永远收不到响应，表现为**无限等待**（IPC invoke 无超时机制，默认永久 pending）。

**影响模块及具体条目**：

| IPC 通道 | Preload 行号 | 调用组件 | 调用位置 | 影响 |
|---------|------------|---------|---------|------|
| `update:check` | `preload.ts:L111` | `Dashboard.tsx` | L91 `handleCheckUpdate` | 用户点击"检查更新"后，Promise 永久 pending，按钮 loading 状态永不恢复 |
| `update:download` | `preload.ts:L112` | `Dashboard.tsx` | L108 `handleCheckUpdate` | 同上（仅在 check 成功后才触发，但 check 本身已失败） |
| `update:install` | `preload.ts:L113` | `Dashboard.tsx` | L111 `handleCheckUpdate` | 同上 |

**修复建议**：
1. 创建 `src/main/ipc/handlers/updateHandlers.ts`，实现三个 handler
2. 在 `src/main/ipc/index.ts` 中 `setupIpcHandlers()` 函数内注册
3. 若暂无更新功能后端实现，**至少应返回 `{ success: false, error: '更新功能尚未实现' }`** 避免 Promise 永久 pending

### 1.3 静默失败——数据获取错误不给用户反馈

**问题描述**：多个模块在数据加载失败时仅设置 `store.error`，但 UI 层**从不读取或渲染 `store.error`**，用户看到的是空列表/计数 0，无法判断是「无数据」还是「加载失败」。

**影响模块及详细分析**：

| 模块 | Store | Error 状态字段 | 设置位置 | UI 是否渲染 error | 用户感知 |
|------|-------|--------------|---------|-----------------|---------|
| Dashboard | `dataStore` | `error: string \| null` | `fetchCharacters()` catch 块 | ❌ 不渲染 | 角色计数永远显示 0，误以为没有角色卡 |
| Dashboard | `worldBookStore` | `error: string \| null` | `fetchWorldBooks()` catch 块 | ❌ 不渲染 | 世界书计数永远显示 0 |
| Dashboard | `dataStore` | `error: string \| null` | `fetchInstalledPlugins()` catch 块 | ❌ 不渲染 | 插件计数永远显示 0 |
| World Book | `worldBookStore` | `error: string \| null` | `readWorldBook()`, `writeWorldBook()` 等 | ❌ 不渲染 | 世界书读取失败后静默返回 null |
| Avatar | `dataStore` | `error: string \| null` | `fetchAvatars()` catch 块 | ❌ 本就不调用 | 无影响（本来就是死代码） |

**修复建议**：
- 在各统计卡片上添加错误状态指示器（红色边框/ErrorBadge/警告图标）
- 或者在全局层面增加一个 `ErrorBoundary` 或 toast 通知，统一定阅各 store 的 error 字段

### 1.4 IPC 参数封装不一致

**问题描述**：preload.ts 向主进程发送 IPC invoke 时，有的将参数封装在 `{ }` 对象中，有的直接传递裸参数。Handler 端解构方式必须与 preload 封装方式严格匹配，否则参数为 undefined。

**具体案例**：

```
Preload:  ipcRenderer.invoke('knowledge:create', { data })      →  { data: KnowledgeItem }
Handler:  需要检查是否解构为 (event, { data }) 还是 (event, data)

Preload:  ipcRenderer.invoke('knowledge:update', { id, updates }) → { id, updates }
Handler:  需要检查是否解构为 (event, { id, updates })

Preload:  ipcRenderer.invoke('vector:add', { id, vector, metadata }) → { id, vector, metadata }
Handler:  需要检查解构方式

对比:
Preload:  ipcRenderer.invoke('worldBook:read', path) → 直接传 string
Handler:  (event, filePath: string) → 直接接收
```

**修复建议**：制定统一的 IPC 参数传递规范，建议所有 IPC invoke 使用对象封装：

```typescript
// 规范格式（推荐）
ipcRenderer.invoke('channel:action', { param1, param2 })
ipcMain.handle('channel:action', (event, { param1, param2 }) => { ... })

// 而非混用裸参数
ipcRenderer.invoke('channel:action', param1, param2)  // ❌ 不一致
```

---

## 二、跨模块缓存策略共性问题

### 2.1 全局 Map 缓存无容量限制（缓慢 OOM 风险）

**问题描述**：模块级别的全局 `Map` 用于缓存频繁访问的数据，但没有任何容量上限、TTL 过期或 LRU 淘汰机制。随着用户使用时间增长和使用数据量增加，内存持续膨胀。

**具体条目**：

| 缓存名称 | 文件 | 行号 | 类型 | 容量上限 | TTL | 淘汰策略 | 最大风险场景 |
|---------|------|------|------|---------|-----|---------|-------------|
| `thumbnailCache` | `CharacterManager.tsx` | L48 | `Map<string, string>` | 无限制 | 无 | 无 | 用户有 500+ 角色卡时，所有缩略图 Base64 常驻内存 |
| `thumbnailErrorCache` | `CharacterManager.tsx` | L49 | `Map<string, boolean>` | 无限制 | 无 | 无 | 同上，且**错误条目永不清除**——见 2.2 |
| `avatarCache` | `CharacterManager.tsx` | L149 | `Map<string, string>` | 无限制 | 无 | 无 | 同上，大尺寸角色头像 Base64 |
| `avatarErrorCache` | `CharacterManager.tsx` | L150 | `Map<string, boolean>` | 无限制 | 无 | 无 | 同上 |
| L1 Cache | `ChatStorageService.ts` | 构造函数内 | `Map<string, CacheEntry>` | 无限制 | 60s | TTL 过期清除 | 对话历史缓存持续增长（每次新对话创建新条目） |

**修复建议**：

1. **thumbnailCache / avatarCache**：改用 LRU Cache，建议容量上限 200 条
   ```typescript
   // 简易 LRU 实现或使用 lru-cache 库
   import { LRUCache } from 'lru-cache';
   const thumbnailCache = new LRUCache<string, string>({ max: 200 });
   const avatarCache = new LRUCache<string, string>({ max: 50 });
   ```

2. **thumbnailErrorCache / avatarErrorCache**：改为 TTL 缓存，错误状态 5 分钟后自动过期
   ```typescript
   const thumbnailErrorCache = new Map<string, { timestamp: number }>();
   // 读取时检查: if (Date.now() - entry.timestamp > 300000) { cache.delete(key); return false; }
   ```

3. **ChatStorageService L1 Cache**：添加容量上限（建议 100 条对话）

### 2.2 错误缓存永不清除（一次失败 = 永久失败）

**问题描述**：`thumbnailErrorCache` 和 `avatarErrorCache` 在文件加载失败时写入 `true`，但**永远不被清理**。即使用户后来修复了文件（如重新导入角色卡），该 `filePath` 被永久标记为 error，导致后续永远显示默认占位图。

**影响位置**：

| 缓存 | 文件:行号 | 写入位置 | 清理位置 |
|------|----------|---------|---------|
| `thumbnailErrorCache` | `CharacterManager.tsx:L49` | L77 / L98 / L110 (`load` 函数超时/失败分支) | **无清理逻辑** |
| `avatarErrorCache` | `CharacterManager.tsx:L150` | L179 / L199 / L212 (`load` 函数超时/失败分支) | **无清理逻辑** |

**修复建议**：
- 方案一（推荐）：改用 TTL 缓存（见 2.1）
- 方案二：在角色卡重新导入/刷新列表时清空这两个 error cache
  ```typescript
  // 在 fetchCharacters() 成功后:
  thumbnailErrorCache.clear();
  avatarErrorCache.clear();
  ```

### 2.3 Dual Persistence 不一致风险（localStorage + 文件）

**问题描述**：部分配置数据同时持久化到 `localStorage`（渲染进程）和文件系统（主进程 IPC），但读取路径和写入路径不对称，导致两份数据可能不一致。

**具体案例**：

**案例 A — CharacterDialogueChat 配置**：

```
读取: 仅从 localStorage (getStoredConfig)
写入: 同时写 localStorage + 文件 IPC (saveStoredConfig + characterConfig:save)
文件读取: characterConfig:load IPC 已注册但从未被调用
```

后果：用户清除浏览器 localStorage 后，配置文件中的备用数据无法自动恢复，用户的所有对话配置（人设选择、知识库绑定、自定义 AI 参数）全部丢失。

**案例 B — animationEnabled 双源**：

```
uiStore.animationEnabled:    persist 到 localStorage ('ui-storage')
settingStore.animationEnabled: persist 到文件 (setting.json)
Dashboard:                    读取 uiStore.animationEnabled
Settings 页面:                 写入 settingStore.animationEnabled
```

后果：用户在 Settings 页面关闭动画 → 写入 setting.json → 但 Dashboard 读的是 uiStore → 动画仍然播放。形成「幽灵设置」。

**修复建议**：
- 案例 A：在 `useCharacterConfig` 初始化时增加 `characterConfig:load` IPC 调用作为 localStorage 读取失败时的 fallback
- 案例 B：二选一——要么 Dashboard 改读 `settingStore.animationEnabled`，要么 Settings 页面改写 `uiStore.animationEnabled`

### 2.4 无事务保护的删除操作（部分成功 = 孤儿数据）

**问题描述**：删除操作涉及多步骤（删除文件 + 删除向量数据 + 更新注册表），但没有任何事务回滚机制。如果中间步骤失败，已完成的步骤造成的数据变更无法撤销，产生孤儿数据。

**具体案例**：

**案例 A — World Book 删除**（`worldBookService.deleteWorldBook`）：

```
步骤 1: 从 VecStore 删除向量数据          ← 若失败，跳到步骤 2
步骤 2: 从 VectorRegistry 删除注册表条目    ← 若步骤 1 成功但此步骤失败
步骤 3: 删除 .json 文件                    ← 可能失败
步骤 4: 删除 .tags.json 文件               ← 可能失败
```

可能的孤儿状态：
- 步骤 1 成功，步骤 2 失败 → 向量数据已删除，但 Registry 中仍记录该世界书的引用（指向不存在的向量）
- 步骤 2 成功，步骤 3 失败 → Registry 已更新，但 .json 文件仍然存在（用户再次打开会看到已"删除"的世界书）
- 步骤 3 成功，步骤 4 失败 → 世界书已删除，但标签数据残留磁盘

**案例 B — Knowledge Base 文档删除**（`handleDeleteDocument`）：

```
步骤 1: 调用 document:delete IPC
步骤 2: 主进程删除向量 → 更新 Registry
```

同样面临步骤间失败导致的不一致。

**修复建议**：
- 短期方案：调整删除顺序——先删除非关键数据（Registry 最后更新），确保失败时数据可恢复
- 长期方案：实现补偿事务或两阶段提交

---

## 三、跨模块命名规范共性问题

### 3.1 中文命名 vs 英文命名混用

**问题描述**：文件系统中使用英文命名（`Avatar/AvatarManager.tsx`），但 UI 标签显示中文（"用户人设管理"）。用户在文档、代码和 UI 之间切换时产生认知负担。

**具体条目**：

| 文件/目录名 | UI 标签 | 建议统一名称 |
|-----------|--------|-------------|
| `Avatar/AvatarManager.tsx` | 用户人设管理 | `Persona/PersonaManager.tsx` |
| `WorldBook/` | 世界书 | 维持不变（中英文一致） |
| `Character/` | 角色卡 | 维持不变 |
| `KnowledgeBase/` | 知识库 | 维持不变 |

### 3.2 同名多义（同一概念在不同模块用不同命名）

**问题描述**：同一个业务概念在不同模块中被赋予了不同的变量名/字段名，增加理解成本。

**具体条目**：

| 概念 | 模块 A 命名 | 模块 B 命名 | 建议统一 |
|------|-----------|-----------|---------|
| 世界书条目的次要关键词 | `keysecondary` (World Book 内部) | `secondary_keys` (SillyTavern 导出) | 统一为 `secondaryKeys`（内部）/ `secondary_keys`（导出映射） |
| 是否使用正则匹配 | `useRegex` (内部驼峰) | `use_regex` (SillyTavern 下划线) | 制定显式的内部↔外部 命名映射表 |
| 向量/文档/作用域 ID | `documentId` (Knowledge) | `sourceId` (Vector) | `scopeId` (Context) | 制定术语表：`sourceId` 指数据源标识，`scopeId` 指搜索范围标识，`documentId` 指上传文档标识 |
| 条目向量化操作 | `vectorizeItem` (Store) | `handleVectorize` (Component) | `vectorizeEntry` (Service) | 统一为 `vectorizeItem`（CRUD 概念） |

### 3.3 重复 Import（同一符号导入两次）

**具体条目**：

| 文件 | 行号 | 重复符号 | 说明 |
|------|------|---------|------|
| `Dashboard.tsx` | L5, L14 | `ThunderboltOutlined` | 第一个作为原始名（插件卡片），第二个别名为 `AvatarIcon`（人设卡片）。建议统一使用别名方案或直接复用原始名 |

### 3.4 类型 vs 值同名冲突

**具体条目**：

| 文件 | 行号 | 冲突详情 |
|------|------|---------|
| `settingStore.ts` | L2-L3 | `import { AppSetting } from '../settings'`（值对象） vs `import { AppSetting as AppSettingType } from '../types/setting'`（接口类型）。被迫使用 `as AppSettingType` 区分，说明命名设计有问题。建议将 `shared/settings.ts` 的导出重命名为 `DEFAULT_APP_SETTINGS` 或 `AppSettingDefaults` |

### 3.5 Magic String 硬编码

**具体条目**：

| 硬编码值 | 文件 | 行号 | 建议 |
|---------|------|------|------|
| `'User'` | `hooks.ts` | L13 | 抽取为 `DEFAULT_USER_DISPLAY_NAME` 常量，并允许通过配置覆盖 |
| `'character-session-'` | `hooks.ts` | L17 | 抽取为 `CHARACTER_SESSION_STORAGE_PREFIX` 常量 |
| `'profile-'` | `AvatarManager.tsx` | — | 抽取为 `PROFILE_ID_PREFIX` 常量 |
| `'engine_'` | `Settings.tsx` | L462 | 抽取为 `ENGINE_ID_PREFIX` 常量 |

---

## 四、跨模块死代码与 Fake Feature 共性问题

### 4.1 按钮已渲染但 onClick 为空/noop

**问题描述**：UI 上存在可点击的按钮，但点击后无任何效果（无 handler、或 handler 为空函数）。用户看到这些按钮会产生「功能可用」的错觉。

**具体条目**：

| 按钮文字 | 文件 | 行号 | 实际行为 | 严重性 |
|---------|------|------|---------|--------|
| "新建角色卡" | `CharacterManager.tsx` | L1129-L1131 | `<Button>` **无 onClick handler**，点击无响应 | 🔴 用户困惑 |
| "优化角色卡" (ThunderboltOutlined) | `CharacterManager.tsx` | — | `dataStore.optimizeCharacter()` — 空 noop 函数，什么都不做 | 🔴 虚假功能 |
| "检查更新" | `Dashboard.tsx` | L87-L91 | `update:check` IPC 无 handler，Promise 永久 pending | 🔴 虚假功能（见 1.2） |
| 插件统计卡片 | `Dashboard.tsx` | L270-L278 | 无 `onClick`，无法点击打开插件文件夹（对比世界书/角色/人设卡片均可点击） | 🟡 交互不一致 |

### 4.2 完整 IPC 链路已布线但从未触发

见 [一、跨模块 IPC 调用模式共性问题 > 1.1](#11-ipc-handler-注册但无渲染进程调用孤立的-handler)。

### 4.3 表单值填写后不被持久化

| 表单字段 | 文件 | 行号 | 问题 |
|---------|------|------|------|
| `autoOptimize` | `Settings.tsx` | L881 | 表单 Switch 可切换，但 `handleSave` 中的 `updatedSetting` 构建**不包含**此字段，值被丢弃 |
| `optimizeLevel` | `Settings.tsx` | L885 | 同上 |
| `backupBeforeOptimize` | `Settings.tsx` | L895 | 同上 |

### 4.4 Middleware/Schema 已定义但从未生效

| 定义 | 文件 | 行号 | 问题 |
|------|------|------|------|
| Zod Schema | `shared/schemas/settingSchema.ts` | 全文 | 定义了完整的设置验证 Schema，但**没有任何 .ts 文件 import 它** |
| `validateSetting()` | `settingService.ts` | L29-L36 | 函数体直接 `return { valid: true }`，注释写「暂时跳过验证」 |
| `MAX_AVATAR_SIZE_MB = 5` | `AvatarManager.tsx` | L14 | 常量已定义但文件大小校验逻辑从未实现，5MB 限制形同虚设 |
| `ALLOWED_IMAGE_TYPES` | `AvatarManager.tsx` | L15 | 同上，仅靠文件选择器的 extensions filter，不校验实际文件类型 |

---

## 五、跨模块错误处理共性问题

### 5.1 AI 操作异常后 Loading 状态不重置

**问题描述**：Character Card 模块中，`handleTranslate` / `handlePolish` / `handleGenerate` 在设置 loading 状态（`setTranslatingField(field)` / `setPolishingField(field)` / `setGeneratingField(field)`）后，如果在 `sendCharacterAIRequest` 抛出未捕获异常，catch 块虽然会 `setXxxField(null)`，但中间某些代码路径（如 API 返回后但在 finally 之前抛出）可能导致 loading 状态永久锁定。

**具体场景**：

```typescript
// CharacterManager.tsx handleTranslate(L511-L613) 简化示意:
setTranslatingField(field);                  // 开始 loading
try {
  const translatedText = await sendCharacterAIRequest(...);  // ← 若此处抛出
  // L556-566 的大量后处理...
  setFormValues(...);                        // ← 或此处抛出
  message.success('翻译成功');
} catch (error) {
  message.error(...);
} finally {
  // ❌ 没有 setTranslatingField(null)！
}
setTranslatingField(null);                  // ← 在 try-catch 外部
```

⚠️ **风险**：若异常在 `sendCharacterAIRequest` 内部被吞掉或重新包装后再抛出，`setTranslatingField(null)` 在 try-catch 外部可能不会被执行到（取决于异常是否被 catch 块完全处理）。

**修复建议**：将 `setXxxField(null)` 移到 finally 块中。

### 5.2 SSE 流式连接静默断开无超时

**问题描述**：角色对话模块中，AI 流式响应通过 SSE 传输。如果 TCP 连接静默断开（不触发 error 事件也不触发 complete 事件），`isLoading` 和 `isStreaming` 将永久保持 `true`，UI 上打字指示器永远旋转，输入框永远禁用。

**影响位置**：`CharacterDialogueChat.hooks.ts` - `requestAIResponse` 函数

**修复建议**：添加流式响应超时机制：
```typescript
const streamTimeout = setTimeout(() => {
  engine.cancelRequest();
  setState(prev => ({ ...prev, isLoading: false, isStreaming: false, error: '响应超时' }));
}, 120000); // 2分钟超时

engine.onComplete(() => clearTimeout(streamTimeout));
engine.onError(() => clearTimeout(streamTimeout));
```

### 5.3 多字节 Unicode 字符在 SSE Chunk 边界截断

**问题描述**：`ChatEngine.ts` 的 `parseSSEChunk` 函数（L288-L338）用 `JSON.parse` 解析每个 SSE chunk。如果 API 在一个多字节 UTF-8 字符的中间拆分 chunk，该 chunk 的 JSON 字符串不合法，`JSON.parse` 失败 → 该 chunk 被静默跳过 → 字符丢失。

**修复建议**：在 SSE 解析层增加未完成 chunk 的缓冲拼接逻辑：
```typescript
let incompleteChunk = '';
function parseSSEChunk(rawChunk: string): string {
  const combined = incompleteChunk + rawChunk;
  try {
    // 尝试解析 combined
    const result = JSON.parse(combined);
    incompleteChunk = '';
    return extractContent(result);
  } catch {
    // 解析失败 → 保存到 incompleteChunk 等待下一个 chunk
    incompleteChunk = combined;
    return '';
  }
}
```

---

## 六、P0 级问题详细方案

### P0-1: Dashboard `fetchAvatars` 未调用 —— 用户人设计数永远为 0

| 属性 | 内容 |
|------|------|
| **文件** | `src/renderer/components/Dashboard/Dashboard.tsx` |
| **行号** | L78-L83 (useEffect) |
| **当前代码** | `useEffect(() => { fetchSetting(); fetchWorldBooks(); fetchCharacters(); fetchInstalledPlugins(); }, [...])` |
| **缺失** | 缺少 `fetchAvatars()` 调用 |

**修复**：
```diff
 useEffect(() => {
   fetchSetting();
   fetchWorldBooks();
   fetchCharacters();
   fetchInstalledPlugins();
+  fetchAvatars();
 }, [fetchSetting, fetchWorldBooks, fetchCharacters, fetchInstalledPlugins, fetchAvatars]);
```

### P0-2: `update:check/download/install` 无 IPC Handler

**修复方案**：
1. 新建 `src/main/ipc/handlers/updateHandlers.ts`:
```typescript
import { ipcMain } from 'electron';

export function updateHandlers() {
  ipcMain.handle('update:check', async () => {
    // TODO: 实现实际的更新检查逻辑
    return { success: false, message: '更新功能尚未实现' };
  });
  ipcMain.handle('update:download', async (_event, latestVersion: string) => {
    return { success: false, message: '更新功能尚未实现' };
  });
  ipcMain.handle('update:install', async (_event, downloadPath: string) => {
    return { success: false, message: '更新功能尚未实现' };
  });
}
```
2. 在 `src/main/ipc/index.ts` 中注册：`updateHandlers();`
3. Dashboard 端增加超时处理，避免永久 pending

**关键**：即使不实现真正的更新功能，也**必须返回响应**（哪怕是 error），否则渲染进程的 IPC invoke 永久 pending 会导致内存泄漏和 UI 冻结。

### P0-3: Settings `autoOptimize`/`optimizeLevel`/`backupBeforeOptimize` 不被持久化

| 属性 | 内容 |
|------|------|
| **文件** | `src/renderer/components/Settings/Settings.tsx` |
| **行号** | L261-L274 (`handleSave` 中 `updatedSetting` 构建) |

**修复**：在 `updatedSetting` 对象中补充三个字段：
```diff
 const updatedSetting = {
   ...setting,
   aiEngines: updatedEngines,
   worldBookPath: values.worldBookPath,
   // ...
   debugMode: debugMode,
   vector: vectorConfig,
+  autoOptimize: values.autoOptimize ?? false,
+  optimizeLevel: values.optimizeLevel ?? 'light',
+  backupBeforeOptimize: values.backupBeforeOptimize ?? true,
 };
```

### P0-4: AI Engine 新增时约 60 个字段使用空值

| 属性 | 内容 |
|------|------|
| **文件** | `src/renderer/components/Settings/Settings.tsx` |
| **行号** | L461-L583 (`handleAddEngine` → `handleSaveEngine` 中 newEngine 初始化) |

**修复**：将约 120 行硬编码替换为引用默认模板：
```typescript
import { AppSetting } from '../../settings'; // from shared/settings.ts

const newEngine: AIEngineSetting = {
  ...AppSetting.defaultSetting.aiEngines[0],  // 复制默认引擎的全部字段
  id: `engine_${Date.now()}`,
  name: values.name || '新引擎',
  api_url: values.api_url || 'http://127.0.0.1:5000',
  api_key: values.api_key || '',
  model_name: values.model_name || 'qwen3.5-27b-heretic-v3',
  api_mode: values.api_mode || 'text_completion',
  api_key_transmission: values.api_key_transmission || 'body',
  // 只覆盖用户在表单中填写的字段
};
```

### P0-5: Settings 保存后 4/6 模块目录不同步

| 属性 | 内容 |
|------|------|
| **文件** | `src/renderer/components/Settings/Settings.tsx` |
| **行号** | L310-L339 (handleSave 中 setDirectory 调用) |

**修复**：在 `handleSave` 中补充四个缺失的 `setDirectory` 调用：
```diff
 if (values.characterPath) {
   await window.electronAPI.character.setDirectory(values.characterPath);
 }
 if (values.worldBookPath) {
   await window.electronAPI.worldBook.setDirectory(values.worldBookPath);
 }
+if (values.avatarPath) {
+  await window.electronAPI.avatar.setDirectory(values.avatarPath);
+}
+if (values.memoryPath) {
+  await window.electronAPI.memory.getMemoryDirectory(); // 确认 memory 模块的 API 名称
+}
+if (values.pluginPath) {
+  await window.electronAPI.plugin.setDirectory(values.pluginPath);
+}
+if (values.creativePath) {
+  await window.electronAPI.creative.setDirectory(values.creativePath); // 确认 API 是否存在
+}
```

### P0-6: World Book `standardizeWorldBookContent` 与 `migrateEntry` 33 个重叠字段

| 属性 | 内容 |
|------|------|
| **文件** | `src/main/services/worldBookService.ts` |
| **行号** | `standardizeWorldBookContent` (约 L110-L210), `migrateEntry` (约 L220-L310) |

**修复策略**：
- 将 `migrateEntry` 的字段定义合并到 `standardizeWorldBookContent` 中
- `standardizeWorldBookContent` 调用 `migrateEntry` 处理单个条目
- 删除 `migrateEntry` 中的独立字段定义，改为引用 `standardizeWorldBookContent` 内的字段集

### P0-7: Character Card "新建角色卡"按钮无 onClick

| 属性 | 内容 |
|------|------|
| **文件** | `src/renderer/components/Character/CharacterManager.tsx` |
| **行号** | L1129-L1131 |

**修复选项**：
- 选项 A：实现新建角色卡功能（创建空白角色卡、打开编辑 Modal）
- 选项 B：暂时隐藏按钮，添加 `{/* TODO: 新建角色卡功能待实现 */}` 注释

### P0-8: Knowledge Base `knowledge:create` IPC 参数可能不匹配

| 属性 | 内容 |
|------|------|
| **涉及文件** | `src/main/preload.ts` (L219), `src/main/ipc/handlers/` (knowledge handlers) |

**排查步骤**：
1. 检查 Knowledge Base 的 Handler 文件中 `knowledge:create` 的 handler 签名
2. 确认参数解构方式与 preload.ts 的 invoke 封装方式匹配
3. 若 Handler 期望 `(event, item)` 但 preload 传 `{ data }` → 修复为 `(event, { data })`
4. 添加单元测试覆盖参数传递

---

## 七、P1 级问题详细方案

### P1-1: Dashboard 数据加载失败不给用户反馈

**修复方案**：在各 Statistic 卡片上添加错误状态渲染
```tsx
<Card>
  <Statistic 
    title="世界书数量" 
    value={worldBookStore.error ? '⚠️' : totalWorldBooks}
    valueStyle={{ color: worldBookStore.error ? '#cf1322' : '#3f8600' }}
    prefix={worldBookStore.error ? <WarningOutlined /> : <BookOutlined />}
  />
</Card>
```

### P1-2: `animationEnabled` 双源冲突

**修复方案**：Dashboard 改为从 `useSettingStore().setting?.animationEnabled` 读取，删除对 `useUIStore().animationEnabled` 的依赖。同步清理 `uiStore` 中冗余的 `animationEnabled` 字段。

### P1-3: World Book Manager.tsx 中的本地函数 shadow import

| 文件 | 行号 | 本地函数 |
|------|------|---------|
| `WorldBookManager.tsx` | 组件体内 | `formatWorldBookToDocument`, `sanitizeFileName` |

**修复**：删除 Manager.tsx 中的本地定义，统一使用 `worldBookUtils.ts` 的 import。

### P1-4: World Book 命名双轨制

**修复方案**：
- 内部统一使用 `secondaryKeys`（camelCase）
- 在 `exportToSillyTavernFormat` 中统一映射为 `secondary_keys`（snake_case）
- 同样处理 `useRegex → use_regex`

### P1-5: 删除人设时不删除关联头像文件

**修复方案**：在 `AvatarManager.tsx` 的 `handleDeleteProfile` 中增加：
```typescript
const handleDeleteProfile = async (profile: UserAvatarProfile) => {
  // 先删除关联的头像文件
  if (profile.avatarPath) {
    try {
      await window.electronAPI.file.delete(profile.avatarPath); // 或 unlink
    } catch { /* 头像文件可能已被手动删除 */ }
  }
  // 再删除 JSON 文件
  const filePath = `${avatarDir}/${profile.id}.json`;
  await window.electronAPI.avatar.delete(filePath);
  // ...
};
```

### P1-6: Character Card 1200+ 行重复的字段编辑按钮

**修复方案**：抽取 `FieldEditor` 通用组件：
```tsx
interface FieldEditorProps {
  label: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  inputType: 'input' | 'textarea';
  rows?: number;
  onTranslate: (field: string) => void;
  onPolish: (field: string) => void;
  onGenerate?: (field: string) => void; // 仅部分字段有
  onRestore: (field: string) => void;
  translatingField: string | null;
  polishingField: string | null;
  generatingField: string | null;
}

const FieldEditor: React.FC<FieldEditorProps> = ({ ... }) => {
  // 统一的 [生成][翻译][润色][还原] 按钮组渲染
};
```

### P1-7: `thumbnailCache`/`thumbnailErrorCache` 无容量限制

见 [二、跨模块缓存策略共性问题 > 2.1](#21-全局-map-缓存无容量限制缓慢-oom-风险)。

### P1-8: `dataStore.optimizeCharacter` 空 noop

**修复选项**：
- 选项 A：实现优化功能（调用 `window.electronAPI.character.optimize(path)` 并处理结果）
- 选项 B：彻底移除函数和所有调用方（CharacterManager 中的"优化角色卡"按钮）

### P1-9: Dialogue Chat `buildDialoguePrompt`/`buildContinuationPrompt` 58% 重复

**修复方案**：提取公共函数：
```typescript
function buildCharacterSection(characterInfo: CharacterInfo, selectedPersona: UserPersona | null, defaultUserName: string): string {
  const characterContext = buildCharacterContext({...}, defaultUserName);
  const personaSection = buildPersonaSection(selectedPersona);
  return `【角色信息】\n${characterContext}\n${personaSection}`;
}
```

### P1-10: `firstMessageSentRef` 只写不读

**文件**: `CharacterDialogueChat.hooks.ts:L230`

**修复**：若确实无需读取，直接从代码中移除该 ref 及所有写操作。

### P1-11: Dialogue Chat 15 项死代码清理

详见 [九、各模块死代码清理清单](#九各模块死代码清理清单)。

### P1-12: Dialogue Chat SSE 无超时

见 [五、跨模块错误处理共性问题 > 5.2](#52-sse-流式连接静默断开无超时)。

### P1-13: Knowledge Base 文档删除无事务回滚

见 [二、跨模块缓存策略共性问题 > 2.4](#24-无事务保护的删除操作部分成功--孤儿数据)。

### P1-14: `KnowledgeItem` 接口重复定义

**修复方案**：统一到 `src/renderer/types/knowledgeBase.ts`（新建），Store 和组件均 import 此类型。

### P1-15: Settings handleSave 中冗余的 localStorage 检查

**修复方案**：将约 50 行 localStorage 检查/日志代码抽取为独立的诊断函数或完全移除（因为设置保存走的是主进程 IPC，不依赖 localStorage）。

---

## 八、P2 级问题详细方案

### P2-1: Dashboard 背景图片无 onError 处理

```diff
 <img
   src={setting.dashboardBackgroundImage}
   alt="仪表盘背景"
   onLoad={handleImageLoad}
+  onError={() => { setImageSize({ width: 0, height: 0 }); }}
   style={{...}}
 />
```

### P2-2: Dashboard Tips 每次挂载均重新读取文件

**修复方案**：在 dataStore 或独立模块中缓存 tips 数据，避免每次 Tab 切换重复 I/O。

### P2-3: Dashboard 未使用的 import 清理

| 文件 | 行号 | 清理项 |
|------|------|--------|
| `Dashboard.tsx` | L23 | `AppSetting`（仅 settingStore 使用） |
| `animation.ts` | L20 | `none: ''` 映射 |

### P2-4: World Book `currentWorldBook` Tab 切换时未清除

**修复方案**：在 App.tsx 的 Tab 切换逻辑中（或 WorldBookManager 的 useEffect cleanup 中）调用 `clearCurrentWorldBook()`。

### P2-5: World Book `vectorizeEntry` null 检查

```diff
- if (!vectorConfig?.autoVectorizeWorldBook) {
+ if (!vectorConfig || !vectorConfig.autoVectorizeWorldBook) {
```

### P2-6: Avatar 组件渐进式重命名

- 阶段 1：添加 `PersonaManager` 别名，保持 `AvatarManager` 向后兼容
- 阶段 2：更新所有 import 引用
- 阶段 3：移除旧文件

### P2-7: Character Card AI 操作状态合并

```typescript
// 替换三个独立 state:
// const [translatingField, setTranslatingField] = useState<string | null>(null);
// const [polishingField, setPolishingField] = useState<string | null>(null);
// const [generatingField, setGeneratingField] = useState<string | null>(null);

// 为一个对象:
interface AIOperationState {
  type: 'translate' | 'polish' | 'generate';
  field: string;
}
const [aiOperation, setAiOperation] = useState<AIOperationState | null>(null);
```

### P2-8: Settings `handleSaveEngine` 引用默认模板

见 P0-4 修复方案（本质相同，P2 是因为这是新建引擎场景而非影响现有数据）。

### P2-9: `settingSchema.ts` Zod Schema 集成或废弃

- 选项 A：在 `settingService.validateSetting` 中集成 Zod 验证
- 选项 B：删除文件（标记为 deprecated）

### P2-10: Knowledge Base `searchItems` 添加 UI 入口

**方案**：在"知识列表"标签的操作栏中增加"文本搜索"按钮，触发 `searchItems` 流程。

### P2-11: 全模块命名规范制定

建议制定文档 `docs/CODING_STANDARDS.md`，包含：
- 文件命名：PascalCase for components, camelCase for utils/hooks
- 变量命名：camelCase, boolean 加 `is`/`has`/`should` 前缀
- IPC 通道命名：`module:action` 格式（如 `worldBook:list`）
- 类型导入：使用 `import type` 语法
- Magic String：必须抽取为命名常量

### P2-12: IPC 参数封装规范统一

建议制定规范：所有 IPC invoke 第二个参数必须为对象 `{ ... }`

---

## 九、各模块死代码清理清单

### 9.1 Dashboard 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| `import { AppSetting } from ...` | `Dashboard.tsx:L23` | 移除未使用的 import |
| `ThunderboltOutlined` 双次导入 | `Dashboard.tsx:L5, L14` | 合并为单一 import |
| `ANIMATION_DELAYS.none` | `animation.ts:L20` | 移除或添加使用注释 |
| `dataStore.optimizeCharacter` | `dataStore.ts:L148-155` | 移除空 noop 函数 |

### 9.2 World Book 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| 本地 `formatWorldBookToDocument` | `WorldBookManager.tsx` 组件体内 | 删除，使用 `worldBookUtils.ts` 版本 |
| 本地 `sanitizeFileName` | `WorldBookManager.tsx` 组件体内 | 删除，使用 `worldBookUtils.ts` 版本 |

### 9.3 User Persona 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| `dataStore.fetchAvatars` | `dataStore.ts` | 保留但确认 AvatarManager 是否改用此函数 |
| `MAX_AVATAR_SIZE_MB` | `AvatarManager.tsx:L14` | 实现校验或移除常量 |
| `ALLOWED_IMAGE_TYPES` | `AvatarManager.tsx:L15` | 实现校验或移除常量 |

### 9.4 Character Card 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| `<Button>新建角色卡</Button>` | `CharacterManager.tsx:L1129-1131` | 实现 onClick 或移除按钮 |
| `dataStore.optimizeCharacter` | `dataStore.ts:L148-155` | 同 Dashboard 9.1 |

### 9.5 Character Dialogue Chat 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| `firstMessageSentRef` | `hooks.ts:L230` + L329/L345/L827 | 只写不读，移除 |
| `ChatConfig` 接口 | `types.ts:L49-54` | 移除未使用的接口定义 |
| `ChatActions` 接口 | `types.ts:L40-46` | 移除未使用的接口定义 |
| `KnowledgeBaseBinding` 接口 | `types.ts:L78-83` | 移除（实际只用 `boundKnowledgeBaseIds: string[]`） |
| `generateMessageId()` | `utils.ts:L28-30` | hooks 中改用内联表达式；移除此函数 |
| `throttle()` | `utils.ts:L54-66` | 从未调用，且与 `format.ts` 重复；移除 |
| `sanitizeMessageContent()` | `utils.ts:L68-71` | 从未调用；移除 |
| `replaceTemplates()` (utils 版) | `utils.ts:L73` | hooks.ts import 了但从不调用；移除 |
| `clearConfig()` | `hooks.ts:L70-75` | 函数实现完整但未从 UI 暴露；添加 UI 入口或移除 |
| `characterConfig:load` handler | `characterHandlers.ts:L127-134` | IPC 注册但无调用；保留待集成（见 P1 方案） |
| `chatVector:vectorize` handler | `characterChatHandlers.ts:L74-77` | IPC 注册但无调用；保留待集成或移除 |
| `chatVector:delete` handler | `characterChatHandlers.ts:L79-82` | 同上 |
| `chatVector:search` handler | `characterChatHandlers.ts:L84-87` | 同上 |

### 9.6 Knowledge Base 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| `KnowledgeItem` 重复定义 | `KnowledgeBaseManager.tsx:L16-26` | 统一到 `types/knowledgeBase.ts`，组件从 Store 的类型导入 |
| `searchItems` Store 函数 | `knowledgeBaseStore.ts:L290-303` | 完整链路存在但无 UI 入口；添加 UI 入口或标记为 planned |
| `selectedId` | `knowledgeBaseStore.ts:L17` | Store 中定义但从未被消费；移除 |
| `searchResults` | `knowledgeBaseStore.ts:L18` | 同上 |
| `isSearching` | `knowledgeBaseStore.ts:L19` | 同上 |
| `vectorSearchResults` | `knowledgeBaseStore.ts:L57` | 同上 |
| `isVectorSearching` | `knowledgeBaseStore.ts:L58` | 同上 |
| `vectorTestResult` | `knowledgeBaseStore.ts:L59` | 同上 |
| `isVectorTesting` | `knowledgeBaseStore.ts:L60` | 同上 |
| `uploadProgress` | `knowledgeBaseStore.ts:L54` | 后端从未推送进度更新，UI 进度条永不变化；修复或移除 |

### 9.7 Settings 模块

| 代码 | 文件:行号 | 清理建议 |
|------|----------|---------|
| `settingSchema.ts` (Zod) | `shared/schemas/settingSchema.ts` | 集成到 `validateSetting` 或标记为废弃 |
| `validateSetting()` | `settingService.ts:L29-36` | 函数体直接 `return { valid: true }`；实现验证逻辑或移除 |
| `exportSetting()` | `settingStore.ts:L409-428` | 已实现但无 UI 入口；添加 UI 入口 |
| `importSetting()` | `settingStore.ts:L430-448` | 同上 |
| `getSettingHistory()` | `settingStore.ts:L449-476` | 同上 |
| localStorage 检查代码 | `Settings.tsx:L282-L301` | 约 20 行与设置保存无关的检测逻辑；抽取或移除 |
| `handleSaveEngine` 硬编码 120 行 | `Settings.tsx:L461-L583` | 改为引用默认模板 |

---

## 十、建议的重构路线图

### 第一阶段：修复 P0 问题（预计 3-5 个工作日）

| 顺序 | 任务 | 涉及文件 | 预计工时 |
|------|------|---------|---------|
| 1 | 修复 `fetchAvatars` 未调用 | `Dashboard.tsx` (1 行) | 0.5h |
| 2 | 注册 `update:*` IPC Handler（至少返回错误） | 新建 `updateHandlers.ts` + `ipc/index.ts` | 1h |
| 3 | 修复 `autoOptimize` 表单值不持久化 | `Settings.tsx` (3 行) | 0.5h |
| 4 | AI Engine 新增时引用默认模板 | `Settings.tsx` (删除 ~120 行，新增 ~10 行) | 1h |
| 5 | 补充 avatar/memory/plugin/creative 的 setDirectory | `Settings.tsx` (新增 ~15 行) | 1h |
| 6 | 合并 World Book 标准化函数 | `worldBookService.ts` | 3h |
| 7 | "新建角色卡"按钮处理 | `CharacterManager.tsx` | 1h 或 0.5h |
| 8 | 排查 `knowledge:create` 参数匹配 | `preload.ts` + handlers | 1h |

### 第二阶段：修复 P1 问题（预计 5-8 个工作日）

| 顺序 | 任务 | 涉及文件 |
|------|------|---------|
| 1 | 添加数据加载失败的用户反馈（Dashboard 统计卡片） | `Dashboard.tsx` |
| 2 | 合并 `animationEnabled` 双源 | `Dashboard.tsx` + `uiStore.ts` |
| 3 | 清理 World Book Manager 本地 shadow import | `WorldBookManager.tsx` |
| 4 | 统一 World Book 命名（secondaryKeys, use_regex） | `worldBookService.ts` + `worldBookUtils.ts` |
| 5 | 删除人设时清理关联头像文件 | `AvatarManager.tsx` |
| 6 | 抽取 Character Card `FieldEditor` 组件 | 新建 `FieldEditor.tsx` + `CharacterManager.tsx` |
| 7 | 添加 thumbnailCache LRU 限制 | `CharacterManager.tsx` |
| 8 | 清理 `dataStore.optimizeCharacter` 空 noop | `dataStore.ts` + `CharacterManager.tsx` |
| 9 | 提取 Dialogue Chat `buildCharacterSection` 公共函数 | `CharacterDialogueChat.hooks.ts` |
| 10 | 清理 Dialogue Chat 15 项死代码 | `hooks.ts` + `types.ts` + `utils.ts` |
| 11 | 添加 SSE 流式响应超时 | `CharacterDialogueChat.hooks.ts` |
| 12 | Knowledge Base 文档删除事务保护 | `KnowledgeBaseService.ts` |
| 13 | 统一 `KnowledgeItem` 类型定义 | 新建 `types/knowledgeBase.ts` |
| 14 | 清理 Settings handleSave 冗余日志 | `Settings.tsx` |

### 第三阶段：优化 P2 问题（按需进行）

| 顺序 | 任务 | 涉及文件 |
|------|------|---------|
| 1 | 添加 Dashboard 背景图片 onError | `Dashboard.tsx` |
| 2 | Tips 数据内存缓存 | `Dashboard.tsx` 或 `dataStore.ts` |
| 3 | 清理 Dashboard 未使用 import | `Dashboard.tsx` + `animation.ts` |
| 4 | World Book Tab 切换时清除 currentWorldBook | `worldBookStore.ts` + `WorldBookManager.tsx` |
| 5 | World Book vectorizeEntry null 检查 | `worldBookService.ts` |
| 6 | Avatar → Persona 渐进式重命名 | 多个文件 |
| 7 | Character Card AI 操作状态合并 | `CharacterManager.tsx` |
| 8 | Settings `settingSchema.ts` 集成或废弃 | `settingSchema.ts` + `settingService.ts` |
| 9 | Knowledge Base `searchItems` UI 入口 | `KnowledgeBaseManager.tsx` |
| 10 | 制定全模块命名规范文档 | 新建 `docs/CODING_STANDARDS.md` |
| 11 | 统一 IPC 参数封装规范 | `preload.ts` + 各 handlers |

---

## 已修复问题记录

### [BUG-001] 聊天记录管理中角色卡缩略图不显示

**问题描述**：在记忆管理模块的聊天记录管理功能中，角色卡列表项的缩略图不显示，只显示默认的加载动画图标。

**原因分析**：
- 聊天记录组件中直接使用 `file://` 协议加载本地资源（`file://${record.thumbnailPath}`）
- Electron 中浏览器安全限制不允许直接使用 `file://` 协议加载本地资源
- 错误信息：`Not allowed to load local resource: file://...`

**修复方案**：
1. 创建 `CharacterThumbnail` 组件，通过 `window.electronAPI.file.readAsBase64(filePath)` 读取文件
2. 将读取的 base64 data URL 用于 `<img>` 标签的 `src` 属性
3. 添加缓存机制 (`thumbnailCache`) 避免重复读取同一文件
4. 添加错误重试机制，最多重试 2 次
5. 添加加载状态和错误状态的 UI 显示

**涉及文件**：
- `src/renderer/components/MemoryChat/ChatManager.tsx`
- `src/renderer/components/MemoryChat/MemoryChatManager.css`

**修复详情**：
- 将 `Avatar` 组件替换为自定义的 `CharacterThumbnail` 组件
- 头像改为圆形（`borderRadius: '50%'`），64x64 像素
- 添加边框和阴影效果，提升视觉效果
- 优化整体布局，头像与文字垂直居中对齐
- 移除调试日志，保持代码整洁

**修复日期**：2026-05-07

---

### [BUG-003] 聊天记录保存后重启应用无法加载历史对话

**问题描述**：与角色卡完成对话后聊天记录已保存，但重启应用后打开对话窗口显示空白，历史对话无法恢复。

**原因分析**：
- `ChatStorageService.saveTestChat()` 保存文件时使用 `characterCardName` 作为文件名（如 `狼人杀助手2.0.json`）
- `ChatStorageService.getTestChat()` 和 `deleteTestChat()` 在查找文件时传入空字符串 `''` 作为 `characterCardName` 参数
- `getChatFilePath()` 方法逻辑为 `sanitizeFileName(characterCardName || shortId)`，当 `characterCardName` 为空时回退到 `shortId`（如 `test-chat-1778087266347`）
- 导致保存和读取使用不同的文件名：保存为 `狼人杀助手2.0.json`，读取时查找 `test-chat-1778087266347.json`，永远找不到文件

**修复方案**：
1. 修改 `getTestChat()` 方法：不再依赖文件名匹配，改为扫描目录中所有 JSON 文件，通过文件内容中的 `creativeId` 和 `characterCardId` 字段匹配
2. 修改 `deleteTestChat()` 方法：同样改为扫描匹配，确保删除操作能正确找到文件
3. 保持 `saveTestChat()` 逻辑不变，仍使用角色卡名称作为友好文件名

**涉及文件**：
- `src/main/services/ChatStorageService.ts`

**修复详情**：
- `getTestChat()`: 扫描目录下所有 `.json` 文件，逐个解析并比对 `creativeId` 和 `characterCardId`
- `deleteTestChat()`: 同样改为扫描匹配后删除
- 缓存机制保持不变，匹配成功后仍会将数据写入缓存

**验证结果**：
- 对话保存后重启应用，历史对话能正确恢复
- 删除对话功能正常工作
- 缓存机制依然生效

**修复日期**：2026-05-07

---

### [BUG-002] 聊天记录向量化功能报"自动向量化未启用"错误

**问题描述**：在记忆管理模块的聊天记录管理中，点击"向量化"按钮时出现错误提示"向量化失败: 自动向量化未启用"，无法进行聊天记录向量化。

**原因分析**：
- `ChatVectorizationService.vectorizeChat()` 方法中错误地检查了 `autoVectorizeWorldBook` 配置项
- 该配置项仅用于控制世界书的自动向量化，不应该影响手动触发的聊天记录向量化
- 世界书的手动向量化不受此检查限制，但聊天记录向量化却有此限制，逻辑不一致

**修复方案**：
1. 移除 `ChatVectorizationService.vectorizeChat()` 中对 `autoVectorizeWorldBook` 配置的强制检查
2. 手动触发的向量化功能应该直接执行，不依赖自动向量化配置
3. 与世界书模块的向量化逻辑保持一致

**涉及文件**：
- `src/main/services/ChatVectorizationService.ts`

**修复详情**：
- 移除了第 40-46 行的配置检查代码
- 添加注释说明手动按钮触发的向量化不需要检查自动向量化配置
- 向量化流程保持不变：生成 embedding → 存储到 vectorStore → 注册到 vector_registry.json

**存储路径说明**：
- 向量化文件存储路径与世界书模块完全一致
- 世界书：`vectors/worldbook/{worldBookName}/vecstore.json`
- 角色卡聊天记录：`vectors/character_chat/{characterId}/vecstore.json`
- 都遵循 `{userData}/vectors/{source}/{sourceId}/vecstore.json` 的格式

**验证结果**：
- 向量化过程无错误提示
- vector_registry.json 文件正确更新
- 向量化结果正确注册到文件知识库
- 支持向量搜索功能

**修复日期**：2026-05-07

---

## 附录：快速参考卡片

### 常见 IPC 模式速查

```
✅ 正确模式（handler 已注册 + preload 已暴露 + 渲染进程已调用）：
   worldBook:list → useWorldBookStore.fetchWorldBooks → Dashboard / WorldBookManager

⚠️ 缺失渲染调用（handler + preload 存在但无调用方）：
   characterConfig:load, chatVector:vectorize, chatVector:delete, chatVector:search

🔴 缺失 Handler（preload 已暴露但主进程无注册 → Promise 永久 pending）：
   update:check, update:download, update:install

⚠️ 缺失 UI 渲染（error 状态已设但 UI 不读）：
   所有 dataStore.error / worldBookStore.error
```

### 关键缓存一览

| 缓存 | 位置 | 容量 | TTL | 清理时机 |
|------|------|------|-----|---------|
| thumbnailCache | CharacterManager.tsx | ❌ 无限制 | ❌ 无 | ❌ 从不清理 |
| thumbnailErrorCache | CharacterManager.tsx | ❌ 无限制 | ❌ 无 | ❌ 从不清理 |
| avatarCache | CharacterManager.tsx | ❌ 无限制 | ❌ 无 | ❌ 从不清理 |
| avatarErrorCache | CharacterManager.tsx | ❌ 无限制 | ❌ 无 | ❌ 从不清理 |
| L1 Chat Cache | ChatStorageService.ts | ❌ 无限制 | ✅ 60s | save/delete 时主动清除 |
| shared L2 | VectorCache | ✅ 配置控制 | ✅ 配置控制 | ✅ 配置控制 |
| VecStore WASM | VecstoreVectorStore | ✅ 磁盘限制 | N/A | persist() 手动调用 |
