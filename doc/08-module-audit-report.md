# 7 模块文档补充审查报告

> 审查时间: 2026-05-07
> 审查范围: 仪表盘、世界书、用户人设、角色卡、角色对话、知识库、设置
> 产出文件: `doc/08-module-audit-report.md`

---

## 一、审查总览

| 模块 | P0（影响功能） | P1（影响维护） | P2（优化建议） | 最高风险 |
|------|:---:|:---:|:---:|------|
| 仪表盘 (Dashboard) | 2 | 4 | 9 | `fetchAvatars` 死代码 + `update:check` 无后端 |
| 世界书 (World Book) | 3 | 4 | 5 | 标准化函数三份重复 + `vectorizeEntry` 类型不安全 |
| 用户人设 (User Persona) | 2 | 4 | 3 | 路径格式不一致 + 孤儿头像文件泄漏 |
| 角色卡 (Character Card) | 2 | 5 | 4 | "新建角色卡"无实现 + 1200行重复渲染 |
| 角色对话 (Dialogue Chat) | 1 | 6 | 8 | `firstMessageSentRef` 只写不读 + 15项死代码 |
| 知识库 (Knowledge Base) | 3 | 5 | 2 | `knowledge:create` IPC 参数不匹配 + 无事务回滚 |
| 设置 (Settings) | 3 | 4 | 5 | `autoOptimize` 永不被读取 + `update:check` 不存在 |

---

## 二、各模块详细审查

### 2.1 仪表盘模块 (Dashboard)

#### 系统关键行为

**配置加载优先级链**：

```
Dashboard.tsx:L78 useEffect() → fetchSetting() → IPC setting:load
  → 成功 → store.setting = result.setting
  → 失败/null → AppSetting.defaultSetting → 自动 persist 到磁盘
```

⚠️ **双源状态冲突**：`animationEnabled` 同时存在于 `uiStore`（persist 到 `ui-storage`）和 `settingStore`（persist 到 `setting.json`）。Dashboard 使用 `useUIStore().animationEnabled`，但 Settings 页面写入 `setting.animationEnabled`——用户更改动画开关后，Dashboard 可能不响应，形成「幽灵设置」。

**IPC 调用全景**：

| 通道 | 触发条件 | ⚠️ 风险 |
|------|---------|------|
| `worldBook:list` | useEffect mount | 静默失败——用户看到计数 0，无法区分「无数据」还是「加载失败」 |
| `character:list` | useEffect mount | 同上 |
| `avatar:list` | **❌ 从未被调用！** `fetchAvatars` 在 deps 中但不在 effect 主体 | 🔴 用户人设计数永远为 0 |
| `plugin:getInstalled` | useEffect mount | 静默失败 |
| `setting:load` | useEffect mount | setting 为 null 时路径回退使用未解析的 `__USER_DATA__` 原始字符串 |
| `update:check/download/install` | 用户点击 | 🔴 **主进程完全没有注册这三个 IPC handler！** 更新功能 100% 死代码 |
| `file:openFolder` | 点击统计卡片 | setting 为 null 时路径未解析 |
| `file:readJson` | useEffect mount | 文件损坏时仅退回到单条默认提示 |

#### 代码质量

**冗余代码**：
- `Dashboard.tsx:L23` — `AppSetting` 未使用的 import
- `Dashboard.tsx:L5,L14` — `ThunderboltOutlined` 双次导入（原始名 + `AvatarIcon` 别名）
- `dataStore.ts:L148-155` — `optimizeCharacter` 空函数存根
- `animation.ts:L20` — `ANIMATION_DELAYS.none` 从未使用

**命名问题**：
- `configLoaded` 实际检查 `setting !== null`——应命名为 `hasSetting`
- `totalAvatars` 实际值不变（`fetchAvatars` 从未调用）

**未生效功能**：
- 🔴 `fetchAvatars` 死代码
- 🔴 `update:check/download/install` 无 IPC handler
- 🟡 插件统计卡片无 onClick 处理器

---

### 2.2 世界书模块 (World Book)

#### 系统关键行为

**标准化边界**：

`standardizeWorldBookContent()` 与 `migrateEntry()` 存在 **33 个重叠字段**。两函数各自定义了 entry 的完整字段集，任何字段变更需要同步修改两处。`keysecondary`（内部名）和 `secondary_keys`（SillyTavern 名）同时被填充，增加了维护负担。

⚠️ `position` 字段：SillyTavern 使用数字（0=before_char, 1=after_char），但如果输入是字符串 `"after_char"`，`typeof entry.position === 'number' ? entry.position : 1` 会静默回退到 1，不报告格式错误。

⚠️ `delayUntilRecursion`：`typeof entry.delayUntilRecursion === 'boolean' ? (entry.delayUntilRecursion ? 1 : 0) : (entry.delayUntilRecursion || 0)`——如果原值是数字：`false` 变为 `0`，`true` 变为 `1`，`0` 变为 `0`，`1` 变为 `1`。**功能正确，但 `0` 值可能被后续逻辑当作 "未设置"**。

**缓存**：
- `currentWorldBook` 在 `readWorldBook` 时写入，在 `clearCurrentWorldBook` 时清除
- `clearCurrentWorldBook` 仅在手动关闭详情时调用——**切换 Tab 时不清除**，存在脏数据风险

#### 代码质量

**冗余代码**：
- `formatWorldBookToDocument` / `sanitizeFileName` 在 `WorldBookManager.tsx` 和 `worldBookUtils.ts` 中**重复定义**
- WorldBookManager.tsx 中定义了 `formatWorldBookToDocument` 和 `sanitizeFileName` 两个同名本地函数，同时从 `worldBookUtils` import了相同的函数——import 被 shadow
- `standardizeWorldBookContent` 与 `migrateEntry` 33 个重叠字段

**命名问题**：
- `keysecondary` vs `secondary_keys` — 同名双义
- `useRegex` vs `use_regex` — 内部驼峰 vs SillyTavern 下划线，导出时做映射转换
- `probability` (0-100 数字) vs `useProbability` (boolean entry property)——混淆风险

**未生效配置**：
- `vectorizeEntry` 在 `vectorConfig.autoVectorizeWorldBook` 为 false 时返回 `{ success: false, error: '自动向量化未启用' }`——但 checker 代码中直接用 `vectorConfig?.autoVectorizeWorldBook`，**如果 vectorConfig 为 null/undefined，会静默返回 false**，等同于禁用向量化

---

### 2.3 用户人设模块 (User Persona)

#### 系统关键行为

**配置加载优先级**：

```
Settings save → setting:save IPC → storageService.setSettings → file write
  ↓ 但 Settings.tsx handleSave 不调用 avatar.setDirectory!
  ↓ avatarHandlers 的 setDirectory 仅在应用启动时从 settings 读取一次
  ↓ 用户修改 avatarPath 后保存 → 设置文件更新 → 但 avatarService 目录不更新（需重启）
```

⚠️ **孤儿文件泄漏**：头像文件被复制到 `avatarDir/avatar-{profileId}-{timestamp}.{ext}`。删除人设时只删除 `{id}.json`，不删除关联的头像文件。长期使用后磁盘会积累大量孤儿文件。

⚠️ **路径格式不一致**：`profileForm.avatarPath` 使用正斜杠存储（normalize），但 `handleEditProfile` 使用正则 `/\//g → '\\'` 转回反斜杠读取。macOS/Linux 上此转换会被跳过，导致路径正确。

**Base64 加载失败处理**：
- AvatarCard: 异步加载，无重试逻辑（仅 `mounted` 标志防卸载后更新），失败时回退 `UserOutlined`
- 详情视图 `handleEditProfile`: 含 `readResult.error` 日志但无重试

#### 代码质量

**冗余代码**：
- `AvatarCard` 和 `handleEditProfile` 两处各自实现了异步 Base64 头像加载逻辑（IPC 调用 `readAsBase64`）

**命名问题**：
- 组件文件名 `Avatar/AvatarManager`，概念上应为 `UserPersona/PersonaManager`（UI 标签为"用户人设管理"）
- `MAX_AVATAR_SIZE_MB = 5` / `ALLOWED_IMAGE_TYPES` 常量已定义但未被代码 enforce（无文件大小校验逻辑）

**未使用配置**：
- `dataStore.fetchAvatars` 定义了但 `AvatarManager` 用自己的 `loadProfiles` 替代
- `MAX_AVATAR_SIZE_MB` 常量无人读取——5MB 限制形同虚设
- `ALLOWED_IMAGE_TYPES` 常量无人读取——文件类型过滤仅靠文件选择器 filter，不校验扩展名

---

### 2.4 角色卡模块 (Character Card)

#### 系统关键行为

**AI 操作后处理**：

翻译/润色/生成各自维护了独立但几乎相同的后处理逻辑：
- 思维链过滤：10 个正则模式在 `handleTranslate` (L566-576) 和 `handlePolish` (L886-896) 中**逐字重复**
- 前缀清除：`/^(译文:|翻译:|Translation:)\s*/i` 在翻译和润色中各自定义
- 标签字段特殊处理：顿号 → 逗号转换在翻译和润色中各自实现

⚠️ AI 操作中 `sendCharacterAIRequest` 异常可能抛出后未重置对应的 loading state (`translatingField`/`polishingField`/`generatingField`)，导致 UI 上的按钮永久处于 loading 状态。

**缓存内存风险**：
- `thumbnailCache` / `thumbnailErrorCache`：全局 Map，**无容量限制、无 TTL、无 LRU 淘汰**。大量角色卡会导致内存持续增长
- `thumbnailErrorCache` 中的错误条目**永远不会被清除**——一旦某图片加载失败，它的 `filePath` 被永久标记为 error，即使后来图片可供加载

#### 代码质量

**冗余代码 — 大规模重复**：
- 编辑 Modal 中 **9 个字段**（name/nickname/source/creator/version/tags/personality/scenario/description/first_mes/mes_example/system_prompt/post_history_instructions/alternate_greetings/creator_notes 共 15 个字段）每个都有 [生成][翻译][润色][还原] 按钮组，相同的结构重复约 1000 行
- `AvatarImage` 和 `ThumbnailImage` 两个组件实现几乎相同的异步 Base64 加载逻辑（5 秒超时、2 次重试、缓存 Map）

**命名问题**：
- `translatingField` / `polishingField` / `generatingField` — 三个独立的 nullable string 状态，其实可以合并为一个 `aiOperationState: { type: string; field: string } | null`
- `character:getWorldBookRelations` IPC 返回类型依赖 `characterService.ts` 中的 `relations` 类型但前端无类型定义——用 `any[]`

**🔴 未生效功能**：
- "新建角色卡"按钮：`<Button type="primary" icon={<PlusOutlined />}>新建角色卡</Button>` — 无 onClick handler
- "优化角色卡"按钮 (ThunderboltOutlined)：调用 `dataStore.optimizeCharacter()` — 该函数为空 noop

---

### 2.5 角色对话聊天模块 (Character Dialogue Chat)

#### 系统关键行为

**配置合并策略**：`customParameters > globalEngine > 硬编码默认值`

⚠️ **dual persistence 不一致风险**：
- 读取：仅从 `localStorage`（`getStoredConfig`）
- 写入：同时写 `localStorage` + 文件 IPC（`saveStoredConfig` + `characterConfig:save`）
- `characterConfig:load` IPC **已注册但从未被调用**——文件存储只写不读
- 用户清除浏览器 localStorage 后配置丢失，文件备用数据无法恢复

**流式响应防护机制**：
- 续写模式有 **三层防护**：`streamContentRef` 累积 → `onComplete` 比较 → Content Protection `existingContent.length > finalContent.length`
- ⚠️ 无 SSE 断连超时：若连接静默断开（不发 error 也不发 complete），`isLoading`/`isStreaming` 永久保持 true
- ⚠️ Unicode 边界：若 API 在多字节字符中间拆分 chunk，JSON.parse 失败 → 该 chunk 静默丢弃 → 字符丢失

#### 代码质量

**死代码清单（15 项）**：

| 代码 | 位置 | 性质 |
|------|------|------|
| `firstMessageSentRef` | hooks.ts:L230 | 只写不读——4 个写操作全部无效 |
| `ChatConfig` 接口 | types.ts:L49-54 | 定义但从未实现/引用 |
| `ChatActions` 接口 | types.ts:L40-46 | 定义但从未实现/引用 |
| `KnowledgeBaseBinding` 接口 | types.ts:L78-83 | 定义但只使用 `boundKnowledgeBaseIds: string[]` |
| `generateMessageId()` | utils.ts:L28-30 | 定义但 hooks 用内联表达式替代 |
| `throttle()` | utils.ts:L54-66 | 定义但从未调用，且与 format.ts 重复 |
| `sanitizeMessageContent()` | utils.ts:L68-71 | 定义但从未调用 |
| `replaceTemplates()` (utils版) | utils.ts:L73 | hooks.ts import 了但从不调用 |
| `clearConfig()` | hooks.ts:L70-75 | 函数实现完整但未从 UI 暴露 |
| `characterConfig:load` | characterHandlers.ts | IPC 注册但无渲染进程调用 |
| `chatVector:vectorize` | characterChatHandlers.ts | IPC 注册但无渲染进程调用 |
| `chatVector:delete` | characterChatHandlers.ts | IPC 注册但无渲染进程调用 |
| `chatVector:search` | characterChatHandlers.ts | IPC 注册但无渲染进程调用 |

**冗余**：
- `buildDialoguePrompt` 和 `buildContinuationPrompt` 约 **58% 代码重复**（32/55 行）
- `DEFAULT_USER_NAME = 'User'` 硬编码——用户无法自定义默认称呼

---

### 2.6 知识库模块 (Knowledge Base)

#### 系统关键行为

**IPC 调用全景** — 关键发现：

🔴 `knowledge:create` IPC 参数不匹配：
- `preload.ts`: `ipcRenderer.invoke('knowledge:create', { data })` — 包裹在 `{ data }` 对象中
- `knowledgeHandlers.ts` 可能期望 `{ item }` 或其他参数名
- 若 handler 解构 `event, item` 或 `event, data` 与 preload 封装的 key 不匹配，整个创建功能将静默失败

**缓存机制**：
- **VectorCache**: L1 内存 Map + L2 磁盘文件——触发条件和失效策略由 `EmbeddingService` 控制
- **VecstoreVectorStore**: WASM 持久化——`persist()` 在 `vectorizeEntry` 后手动调用
- **VectorRegistryService**: 追踪 vector→file 映射——⚠️ 无事务保护：如果文档删除时向量删除成功但 Registry 更新失败，会产生孤儿注册表条目

⚠️ **文档删除无事务回滚**：`handleDeleteDocument` 调用 `document:delete`，main 进程删除向量 → 更新注册表。如果注册表更新失败，向量已被删除，无法恢复。如果向量删除部分成功，注册表中残留指向已删除条目的引用。

⚠️ **上传进度永无更新**：`uploadProgress` 在 `knowledgeBaseStore` 中定义，`uploadDocument` 中在 `setUploadProgress(null)` 之间设置，但**后端从未通过 IPC 推送进度更新**——进度条变为永不更新的静态显示。

#### 代码质量

**冗余代码**：
- `loadTreeData` vs `fetchDocumentGroups` — 两者都调用 `document:list`，但各自构建不同的数据结构
- `KnowledgeItem` 接口在 `KnowledgeBaseManager.tsx:L16-26` 和 `knowledgeBaseStore.ts:L3-15` 中**独立定义**，Store 版本多了 `documentName` 字段

**命名问题**：
- `documentId` vs `sourceId` vs `scopeId` — 三个概念在不同上下文中混用
- `vectorizeItem` / `handleVectorize` / `vectorizeEntry` — 多层命名的同一概念

**死代码**：
- `searchItems` 完整链路存在但 UI 中无入口（仅定义了函数，但"向量测试"标签走的是 `searchWithScopes` 而非 `searchItems`）
- `selectedId`, `searchResults`, `isSearching`, `uploadProgress`, `vectorSearchResults`, `isVectorSearching` 在 store 中定义但未被消费

---

### 2.7 设置模块 (Settings)

#### 系统关键行为

**设置加载→修改→保存→联动更新链路**：

```
应用启动 → settingHandlers init → loadSetting() → storageService
  → 成功: return setting
  → 失败/null: AppSetting.defaultSetting → return default → 自动 persist
  ↓
渲染进程: useSettingStore.fetchSetting() → setting:load IPC → store.setting
  ↓
设置页面: handleSave()
  → saveSetting(updatedSetting) → IPC setting:save → 文件写入 ✅
  → character.setDirectory() ✅
  → worldBook.setDirectory() ✅
  → ❌ avatar.setDirectory()  — 不调用
  → ❌ memory.setDirectory()  — 不调用
  → ❌ plugin.setDirectory()  — 不调用
  → ❌ creative.setDirectory() — 不调用
```

⚠️ **4/6 模块目录不会实时更新**：用户通过设置修改 avatar/memory/plugin/creative 路径后保存，只有 character 和 worldBook 的目录会实时切换，其他 4 个模块需要重启应用才能应用新路径。

**`__USER_DATA__` 解析分散在 7 个位置**：
| 位置 | 替换方式 | 函数 |
|------|---------|------|
| `Settings.tsx handleValidatePath` | `String.replace` | `app.getUserDataPath()` |
| `Settings.tsx handleOpenFolder` | `String.replace` | `app.getUserDataPath()` |
| `characterHandlers.ts` | `RegExp /g` | `getUserDataPath()` |
| `worldBookHandlers.ts` | `RegExp /g` | `getUserDataPath()` |
| `memoryHandlers.ts` | `String.replace` | `getUserDataPath()` |
| `pluginHandlers.ts` | `String.replace` | `getUserDataPath()` |
| `fileHandlers.ts` | `String.replace` | `app.getPath('userData')` |

⚠️ `fileHandlers.ts` 使用 `app.getPath('userData')`（Electron 原生 API），而其他 6 个位置使用 `getUserDataPath()`（自定义封装）。正常情况下应返回相同值，但 `getUserDataPath` 的兜底逻辑在 Electron app 未完全初始化时取 `process.env.APPDATA`，可能存在微小差异。

#### 代码质量

**冗余代码**：
- `handleSave` 中约 50 行日志/localeStorage 检查与**设置保存到主进程文件系统无关**（设置通过 IPC 保存，不经过 localStorage）
- `handleSaveEngine` 新增引擎约 120 行硬编码字段初始化——应引用 `AppSetting.defaultSetting.aiEngines[0]` 作为模板

**命名问题**：
- `AppSetting` 从两处导入：`../settings`（值对象）和 `../types/setting`（接口类型）→ 类型导入被迫使用 `as AppSettingType` 别名
- `AIEngineSetting` 接口约 80 字段中 `top_p` / `top_k` / `min_p` / `rep_pen` 等字段在**两个区块中各出现一次**（chat_completion 特有 + SillyTavern 官方预设），字段重名但语义可能不同

**🔴 未生效/冗余配置**：
- `autoOptimize` / `optimizeLevel` / `backupBeforeOptimize` — Settings.tsx 有效表单但 `handleSave` 中**不写入 `updatedSetting`** → 表单填写后值被丢弃
- `AIEngineSetting` 约 80 字段，UI 表单仅暴露 13 个 → 67 个字段仅能通过手动编辑配置文件修改
- `settingSchema.ts` (Zod) — 定义但**无任何 .ts 文件 import**
- `exportSetting` / `importSetting` / `getSettingHistory` — 已实现但无 UI 入口
- `settingService.ts:L29-36` 中 `validateSetting` 直接返回 `{ valid: true }`（注释："暂时跳过验证"）

---

## 三、跨模块共性问题汇总

### 3.1 IPC 调用模式共性问题

| 问题 | 影响模块 |
|------|---------|
| **IPC handler 注册但无渲染进程调用**（孤立的 handler） | Character Card (`characterConfig:load`, `chatVector:*`), Dialogue Chat (同上), Knowledge Base (`searchItems`) |
| **IPC 暴露在 preload 但无 handler 注册**（永不回复） | Dashboard (`update:*`), Settings (`update:*`) |
| **静默失败——数据获取错误不给用户反馈** | Dashboard, World Book, Avatar（均只设置 store.error 但 UI 不渲染） |
| **IPC 参数封装不一致**（有的 `{ data }` 包裹，有的直接传） | Knowledge Base (`knowledge:create` 参数不匹配) |

### 3.2 缓存策略共性问题

| 问题 | 影响模块 |
|------|---------|
| **全局 Map 缓存无容量限制**（缓慢 OOM 风险） | Character Card (`thumbnailCache`, `thumbnailErrorCache`), Character Dialogue Chat (`L1 cache 60s TTL`) |
| **错误缓存永不清除**（一次失败 = 永久失败） | Character Card (`thumbnailErrorCache` 无清理机制) |
| **Dual Persistence 不一致风险**（localStorage + 文件） | Character Dialogue Chat (读写不同源), Settings (`animationEnabled` 两源) |
| **无事务保护的删除操作**（部分成功 = 孤儿数据） | World Book (向量删除→Registry 更新链路), Knowledge Base (文档删除) |

### 3.3 命名规范共性问题

| 问题 | 影响模块 |
|------|---------|
| **中文命名 vs 英文命名混用** | 全模块（文件名为 `AvatarManager` 但 UI 标签为"用户人设"） |
| **同名多义**（同一概念在不同模块用不同命名） | World Book (`keysecondary` vs `secondary_keys`), Knowledge Base (`documentId` vs `sourceId` vs `scopeId`) |
| **重复 import**（同一符号导入两次） | Dashboard (`ThunderboltOutlined` 双次导入) |
| **类型 vs 值同名冲突** | Settings (`AppSetting` 两处导入, 用 `as` 别名区分) |
| **Magic String 硬编码** | Dialogue Chat (`DEFAULT_USER_NAME = 'User'`, `STORAGE_KEY_PREFIX`) |

### 3.4 死代码/Fake Feature 共性问题

| 问题 | 影响模块 |
|------|---------|
| **按钮已渲染但 onClick 为空/noop** | Character Card ("新建角色卡", "优化角色卡"), Dashboard ("更新检查") |
| **完整 IPC 链路已布线但从未触发** | Character Card (`characterConfig:load`), Dialogue Chat (`chatVector:*`), Knowledge Base (`searchItems`) |
| **表单值填写后不被持久化** | Settings (`autoOptimize`, `optimizeLevel`, `backupBeforeOptimize`) |
| **Middleware/Schema 已定义但从未生效** | Settings (`settingSchema.ts` Zod schema, `validateSetting()` 默认返回 `true`) |

---

## 四、优先级行动清单

### 🔴 P0 — 影响功能正确性（需立即修复）

| # | 模块 | 问题 | 建议 |
|---|------|------|------|
| 1 | Dashboard | `fetchAvatars` 在 useEffect 中未调用——用户人设计数永远为 0 | 在 effect 主体中添加 `fetchAvatars()` 调用 |
| 2 | Dashboard | `update:check/download/install` IPC handler 不存在——"检查更新"按钮 100% 死代码 | 实现 `updateHandlers.ts` 并在 `ipc/index.ts` 中注册 |
| 3 | Settings | `autoOptimize`/`optimizeLevel`/`backupBeforeOptimize` 表单值在 handleSave 中被丢弃 | 在 `updatedSetting` 构建中写入这三个字段 |
| 4 | Settings | AI Engine 新增时约 60 个关键字段使用空值/空数组而非默认模板 | 引用 `AppSetting.defaultSetting.aiEngines[0]` 作为模板填充非编辑字段 |
| 5 | Settings | avatar/memory/plugin/creative 路径变更不触发 setDirectory | 在 `handleSave` 中补充调用 |
| 6 | World Book | `standardizeWorldBookContent` 与 `migrateEntry` 33 个字段重叠 | 合并为单一标准化函数 |
| 7 | Character Card | "新建角色卡"按钮无 onClick handler | 实现或移除按钮 |
| 8 | Knowledge Base | `knowledge:create` IPC 参数封装可能不匹配 | 检查 handler 的参数解构方式并修复 |

### 🟡 P1 — 影响可维护性（建议近期修复）

| # | 模块 | 问题 | 建议 |
|---|------|------|------|
| 9 | Dashboard | 数据加载失败不告知用户（静默显示 0） | 错误发生时在各统计卡片上显示错误指示器 |
| 10 | Dashboard | `animationEnabled` 双源冲突（uiStore vs settingStore） | 合并为单一数据源 |
| 11 | World Book | `formatWorldBookToDocument`/`sanitizeFileName` 在 Manager.tsx 和 utils.ts 中重复定义 | 移除 Manager.tsx 中的本地定义，仅保留 utils.ts 版本 |
| 12 | World Book | `keysecondary` vs `secondary_keys`，`useRegex` vs `use_regex` 命名双轨制 | 统一使用 SillyTavern 下划线规范，内部保持一致 |
| 13 | Avatar | 删除人设时不删除关联头像文件→孤儿文件积累 | 在 `handleDeleteProfile` 中增加头像文件删除逻辑 |
| 14 | Character Card | 1200+ 行重复的字段编辑按钮渲染 | 抽取为 `FieldEditor` 通用组件 |
| 15 | Character Card | `thumbnailCache`/`thumbnailErrorCache` 无容量限制 | 添加 LRU 限制或改为 WeakMap |
| 16 | Character Card | `dataStore.optimizeCharacter` 是空 noop | 实现或彻底移除 |
| 17 | Dialogue Chat | `buildDialoguePrompt`/`buildContinuationPrompt` 58% 代码重复 | 提取 `buildCharacterSection` 公共函数 |
| 18 | Dialogue Chat | `firstMessageSentRef` 只写不读（4 个写操作无效） | 移除或补充读取逻辑 |
| 19 | Dialogue Chat | 15 项死代码（接口/函数/IPC handler） | 清理不必要的类型定义、未调用的 handler、未使用的工具函数 |
| 20 | Dialogue Chat | SSE 连接断开无超时检测 | 添加流式响应超时机制 |
| 21 | Knowledge Base | 文档删除无事务回滚 | 删除操作确保向量 → 注册表的一致性 |
| 22 | Knowledge Base | `KnowledgeItem` 接口在 Store 和组件中重复定义 | 统一到 `types/` 目录 |
| 23 | Settings | handleSave 中冗余的 localStorage 检查（与设置保存无关） | 移除或移动到专门的诊断工具 |

### 🟢 P2 — 优化建议（可择机处理）

| # | 模块 | 问题 | 建议 |
|---|------|------|------|
| 24 | Dashboard | 背景图片无 onError 处理 | 为 `<img>` 添加 onError handler |
| 25 | Dashboard | Tips 每次挂载均重新读取文件（无缓存） | 添加内存缓存 |
| 26 | Dashboard | 未使用的 `AppSetting` import、`ANIMATION_DELAYS.none` | 移除 |
| 27 | World Book | `currentWorldBook` Tab 切换时未清除 | 在 Tab 切换时调用 `clearCurrentWorldBook` |
| 28 | World Book | `vectorizeEntry` 依赖的 `autoVectorizeWorldBook` 配置可能为 null | 添加 null 检查 |
| 29 | Avatar | 组件文件名 `AvatarManager` 应为 `PersonaManager` | 渐进式重命名 |
| 30 | Character Card | 9 个 AI 操作状态使用三个独立 nullable string 而非一个对象 | 合并为 `aiOperationState` 对象 |
| 31 | Settings | `handleSaveEngine` 约 120 行硬编码字段 | 引用默认模板 |
| 32 | Settings | `settingSchema.ts` Zod schema 无人引用 | 集成到 runtime 验证或标记为废弃 |
| 33 | Knowledge Base | `searchItems` 完整链路无 UI 入口 | 添加 UI 入口或标记为 planned feature |
| 34 | 全模块 | 中文/英文命名混用 | 制定命名规范文档 |
| 35 | 全模块 | IPC 参数封装格式不一致 | 统一预加载层参数封装规范 |

---

## 附录：文件索引

| 模块 | 关键源文件 |
|------|-----------|
| Dashboard | `src/renderer/components/Dashboard/Dashboard.tsx`, `src/renderer/stores/dataStore.ts`, `src/renderer/stores/uiStore.ts` |
| World Book | `src/renderer/components/WorldBook/WorldBookManager.tsx`, `src/main/services/worldBookService.ts`, `src/renderer/utils/worldBookUtils.ts` |
| User Persona | `src/renderer/components/Avatar/AvatarManager.tsx`, `src/main/ipc/handlers/avatarHandlers.ts` |
| Character Card | `src/renderer/components/Character/CharacterManager.tsx`, `src/main/ipc/handlers/characterHandlers.ts`, `src/main/services/characterService.ts` |
| Dialogue Chat | `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`, `src/main/services/ChatStorageService.ts` |
| Knowledge Base | `src/renderer/components/KnowledgeBase/KnowledgeBaseManager.tsx`, `src/renderer/stores/knowledgeBaseStore.ts` |
| Settings | `src/renderer/components/Settings/Settings.tsx`, `src/renderer/stores/settingStore.ts`, `src/main/ipc/handlers/settingHandlers.ts` |
