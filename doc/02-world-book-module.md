# 世界书模块 (World Book Module) 技术文档

> 模块路径: `src/renderer/components/WorldBook/`
> 源码文件: `WorldBookManager.tsx`, `WorldBookList.tsx`, `WorldBookEntryList.tsx`, `WorldBookCreateModal.tsx`, `WorldBookAddEntryModal.tsx`, `WorldBookVectorPanel.tsx`, `TagManager.tsx`
> 后端支撑: `src/main/ipc/handlers/worldBookHandlers.ts`, `src/main/services/worldBookService.ts`
> 状态管理: `src/renderer/stores/worldBookStore.ts`
> 类型定义: `src/renderer/types/worldBook.ts`

---

## 1. 模块功能描述

世界书模块是 Creative Cafe 的**核心数据管理模块**，提供对 SillyTavern 世界书（World Book/Lorebook）文件的完整生命周期管理。

### 核心能力

| 能力 | 描述 |
|------|------|
| **世界书 CRUD** | 创建、读取、查看、编辑、删除、导入世界书 JSON/JSON5 文件 |
| **条目管理** | 世界书内条目的增删改查、排序（标题排序/顺序排序/拖拽排序/AI 智能排序） |
| **条目字段编辑** | 编辑条目的关键词（key）、次要关键词（keysecondary）、内容（content）、备注（comment）等全字段 |
| **标签系统** | 独立的标签管理（TagManager），支持标签的增删改及与条目的关联映射 |
| **AI 辅助功能** | 一键翻译所有条目、一键润色所有条目、AI 生成关键词、AI 排序条目、AI 生成世界书条目（从描述批量生成） |
| **向量化集成** | 世界书条目向量化与语义搜索（WorldBookVectorPanel） |
| **标准化处理** | 自动标准化世界书格式为 SillyTavern V2/V3 兼容格式，兼容 JSON5 语法 |
| **条目内 AI 操作** | 单个条目的翻译、润色、AI 生成关键词 |
| **Markdown 编辑** | 集成 MarkdownEditor 组件编辑条目内容 |
| **文档导出** | 将世界书格式化为 Markdown 文档视图 |

### 操作类型

- **文件操作**: 创建、打开、保存、删除、导入世界书
- **条目操作**: 添加、编辑、删除、排序、展开/折叠、批量选择条目
- **AI 操作**: 翻译、润色、生成关键词、智能排序、批量生成条目
- **标签操作**: 标签 CRUD、标签-条目关联
- **向量操作**: 向量化世界书、语义搜索

### 功能边界

- 仅支持 JSON/JSON5 格式的世界书文件
- 排除 `.tags.json` 后缀的标签数据文件
- AI 操作依赖 Settings 模块配置的 AI 引擎

---

## 2. 模块定位与业务价值

### 战略角色

世界书模块在系统中扮演 **SillyTavern 核心数据资产的管理中心**角色，是连接文件系统原始世界书数据与 AI 增强能力的桥梁。

```
┌────────────────────────────────────────────────────────┐
│               WorldBookManager (入口组件)                │
│  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │ WorldBookList    │  │ WorldBookEntryList         │  │
│  │ (世界书列表)      │  │ (条目列表, 含排序/分页)      │  │
│  └──────────────────┘  └────────────────────────────┘  │
│  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │ TagManager       │  │ WorldBookVectorPanel       │  │
│  │ (标签管理)        │  │ (向量化与语义搜索)          │  │
│  └──────────────────┘  └────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **手动编辑世界书效率低**: 提供 AI 辅助翻译/润色/生成，大幅提升效率
2. **格式兼容性问题**: 自动标准化确保与 SillyTavern 完全兼容
3. **条目导航困难**: 分页、排序、搜索功能提升大型世界书的可管理性
4. **语义匹配能力缺失**: 向量化集成支持基于语义的条目触发

### 目标用户群体

- **SillyTavern 世界书创建者**: 需要高效编辑和管理工具
- **跨语言用户**: 需要翻译和润色功能
- **高级用户**: 需要向量化和语义搜索能力

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌──────────────────────────────────────────────────────┐
│                  WorldBookManager                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ WorldBookList│  │EntryList     │  │ TagManager │  │
│  │ (左侧面板)   │  │ (右侧主区域)  │  │ (Modal)    │  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
└──────────────────────────────────────────────────────┘
                          ↓ 状态管理
┌──────────────────────────────────────────────────────┐
│              useWorldBookStore (Zustand)              │
│  - worldBooks[]  - currentWorldBook  - tags[]        │
│  - loading       - error           - associations[]  │
└──────────────────────────────────────────────────────┘
                          ↓ IPC 通信
┌──────────────────────────────────────────────────────┐
│  window.electronAPI.worldBook.*                       │
└──────────────────────────────────────────────────────┘
                          ↓ 主进程
┌──────────────────────────────────────────────────────┐
│  worldBookHandlers → worldBookService                 │
│  ├── listWorldBooks / readWorldBook / writeWorldBook   │
│  ├── deleteWorldBook / importWorldBook                │
│  ├── readTags / writeTags / deleteTags                │
│  ├── vectorizeWorldBook                               │
│  └── standardizeWorldBookContent (标准化)             │
└──────────────────────────────────────────────────────┘
                          ↓ 集成服务
┌──────────────┐  ┌──────────────┐  ┌───────────────┐
│optimizerSvc  │  │embeddingSvc  │  │vectorStoreSvc │
└──────────────┘  └──────────────┘  └───────────────┘
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **主从视图 (Master-Detail)** | WorldBookList + EntryList | 左侧选择世界书，右侧显示条目详情 |
| **Strategy** | 排序方法选择 | 标题排序/顺序排序/拖拽排序/AI 排序 四种策略 |
| **Command** | AI 操作统一模式 | 翻译/润色/生成关键词均使用统一的 AI 请求流程 |
| **Adapter** | 世界书标准化 | `standardizeWorldBookContent` 将内部格式适配为 SillyTavern 标准 |
| **Observer** | Zustand Store | 所有组件订阅 `worldBookStore` 状态变化 |

### 3.3 核心算法

#### 世界书标准化 (SillyTavern 兼容)

```typescript
// worldBookService.standardizeWorldBookContent()
// 核心流程:
// 1. 添加缺失的根级字段 (is_creation, scan_depth, token_budget, extensions)
// 2. 修复 entries 对象: 重排索引、修正数据类型
// 3. 确保每个 entry 包含所有必需字段:
//    - position: 数字类型 (0=before_char, 1=after_char)
//    - delayUntilRecursion: 布尔→数字转换
//    - extensions: { depth, weight, addMemo, displayIndex, ... }
//    - characterFilter: { isExclude, names, tags }
//    - 数组字段: keysecondary, secondary_keys, tags, triggers
```

#### 字段迁移 (Creative-Cafe → SillyTavern)

```typescript
// worldBookService.migrateEntry()
// 关键字段映射:
// - useRegex → use_regex (SillyTavern 使用下划线命名)
// - caseSensitive → case_sensitive
// - key: string → string[] (需求数组化)
// - keysecondary: string → string[]
// - selectiveLogic/displayIndex 等内部字段→ extensions 子对象
```

#### AI 翻译/润色流程

```typescript
// 统一处理流程:
// 1. 获取 activeEngine 配置 (from settingStore)
// 2. 构造 systemPrompt (包含引擎自带的 system_prompt + 任务指令)
// 3. 发送 AI 请求 → 获取响应
// 4. 后处理: 清除思维链标记 (Thought/思考/Reasoning), 移除前缀/后缀标记
// 5. 特殊处理: tags 字段将顿号分隔转换为逗号分隔
// 6. 更新表单状态
```

### 3.4 组件树结构

```
WorldBookManager
├── Card[提示信息]
├── Space[操作栏] (刷新/导入/新建/标准化/导出文档/查看标签)
├── Row
│   ├── Col[左侧面板]
│   │   └── WorldBookList (世界书选择列表)
│   └── Col[右侧主区域]
│       ├── Space[条目排序/操作栏]
│       │   ├── 排序方法选择 (Radio)
│       │   ├── 添加条目 / 批量AI操作
│       │   └── 标记所有/向量化处理
│       └── WorldBookEntryList (条目表格, 分页)
│           └── 每个条目行:
│               ├── 展开/折叠 (显示 key/content/comment)
│               ├── MarkdownEditor (编辑内容)
│               ├── AI 操作按钮 (翻译/润色/生成关键词)
│               └── 删除/移动按钮
├── Modal[WorldBookCreateModal] (新建世界书 / AI 生成)
├── Modal[WorldBookAddEntryModal] (添加条目)
├── Modal[TagManager] (标签管理)
├── Modal[AI排序 / 拖拽排序]
├── Modal[AI润色需求输入]
└── WorldBookVectorPanel (向量化处理面板)
```

### 3.5 状态管理设计

`useWorldBookStore` 管理以下核心状态:

| 状态 | 类型 | 说明 |
|------|------|------|
| `worldBooks` | `WorldBookMeta[]` | 世界书文件列表 |
| `currentWorldBook` | `WorldBookData \| null` | 当前编辑的世界书完整数据 |
| `currentWorldBookPath` | `string \| null` | 当前世界书文件路径 |
| `tags` | `WorldBookTag[]` | 标签列表 |
| `associations` | `WorldBookTagAssociation[]` | 标签-条目关联 |
| `worldBookDir` | `string` | 世界书存储目录 |

组件内本地状态（约 30+ 个状态变量）:

| 类别 | 状态变量 |
|------|---------|
| **模态框** | `isViewModalOpen`, `isEditEntryModalOpen`, `isCreateModalOpen`, `isAddEntryModalOpen`, `isSortModalOpen`, `isDescriptionModalOpen`, `isDragSortModalOpen`, `isTagManagerOpen`, `isPolishModalOpen` |
| **表单值** | `formValues` (含 comment/key/keysecondary/content 等 20+ 字段) |
| **AI 操作** | `translatingField`, `polishingField`, `isTranslatingAll`, `isPolishingAll`, `isAISorting`, `generatingKeywordsUid` |
| **UI 状态** | `expandedEntries`, `selectedEntries`, `currentPage`, `pageSize`, `selectedSortMethod` |

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **SillyTavern 格式兼容** | 入口自动标准化 (`standardizeWorldBookContent`)，出口格式转换 (`exportToSillyTavernFormat`)，确保读写双向兼容 |
| **JSON5 语法支持** | 使用 `json5` 库替代原生 `JSON.parse`，支持注释、尾随逗号、无引号键名 |
| **大型世界书性能** | 条目分页（默认 20 条/页）、展开/折叠控制、按需渲染 `expandedEntries` |
| **AI 响应后处理** | 多层正则过滤思维链标记（Thought/思考/Reasoning），清除前缀（译文:/润色:/Translation:），处理顿号分隔 |
| **向量数据一致性** | 删除世界书时同步删除向量数据（从 Registry 查找 → 删除 VecStore 条目 → 清理文件 → 更新 Registry） |
| **路径占位符** | `__USER_DATA__` 宏在 setDirectory 时通过 `resolveUserDataPlaceholder` 解析为实际路径 |

### 4.2 性能优化策略

1. **按需加载**: 仅在选中世界书后才读取完整内容和标签数据
2. **批量处理**: `vectorizeAllEntries` 依次处理条目，避免并发导致的资源争抢
3. **状态缓存**: `useWorldBookStore` 维护 `currentWorldBook` 避免重复读取文件
4. **分页渲染**: 大量条目通过 `currentPage`/`pageSize` 分页展示

### 4.3 安全考虑

- 世界书目录通过 `__USER_DATA__` 路径宏限制在用户数据目录
- 所有文件操作通过主进程 IPC 代理，遵循 `contextIsolation` 安全模型
- 文件名安全化 (`sanitizeFileName`) 防止路径遍历攻击

### 4.4 边界情况处理

- 空世界书（无条目）时显示友好提示
- 导入世界书文件名冲突时自动处理
- 标签文件不存在时返回空 `{ tags: [], associations: [] }`
- AI 请求失败时保留原始内容不丢失

---

## 5. 模块间关系

### 5.1 依赖关系

```
WorldBook Module
    ├──→ Setting Module (AI 引擎配置, 存储路径)
    │       └──→ settingStore.fetchSetting()
    ├──→ Vector Module (向量化/搜索)
    │       └──→ embeddingService.generateEmbedding()
    │       └──→ vectorStoreService.add/search/deleteByPrefix()
    ├──→ Common/MarkdownEditor (条目内容编辑)
    ├──→ Common/AIService? (通过 characterAIUtils 间接使用)
    ├──→ optimizerService (AI 优化)
    ├──→ vectorRegistryService (向量注册表)
    └──→ storageService (读取向量配置)
```

### 5.2 被依赖关系

```
Character Module
    └──→ WorldBookRelationPanel (关联世界书)
Knowledge Base Module
    └──→ 世界书自动索引入知识库
Settings Module
    └──→ worldBookPath 目录配置
```

### 5.3 数据流

```
文件系统 (.json/.json5)
    ↓ read
worldBookService (标准化)
    ↓ return
worldBookStore.currentWorldBook
    ↓ subscribe
WorldBookManager → WorldBookEntryList
    ↓ 编辑/AI操作
formValues → worldBookService.writeWorldBook()
    ↓ (标准化 → SillyTavern格式)
文件系统
```

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 世界书主数据 | JSON (SillyTavern 兼容格式) | `{worldBookDir}/*.json` / `*.json5` |
| 标签数据 | JSON | `{worldBookDir}/{name}.tags.json` |
| 向量数据 | VecStore WASM 二进制 | 向量存储目录 |
| 向量注册表 | JSON (VectorRegistry) | `vecstore_metadata.json` |

### 6.2 标准化 Schema

世界书条目的完整 SillyTavern 兼容字段:

```typescript
interface WorldBookEntry {
  uid: number;                    // 唯一 ID
  id: number;                     // 显示 ID  
  key: string[];                  // 触发关键词
  keysecondary: string[];         // 次要关键词
  content: string;                // 条目内容
  comment: string;                // 备注
  order: number;                  // 排序权重
  position: number;               // 插入位置 (0-3)
  probability: number;            // 触发概率 (0-100)
  depth: number;                  // 搜索深度
  group: string;                  // 分组
  disable: boolean;               // 禁用
  constant: boolean;              // 恒定
  selective: boolean;             // 选择性
  enabled: boolean;               // 启用
  use_regex: boolean;             // 正则匹配
  case_sensitive: boolean;        // 大小写敏感
  vectorized: boolean;            // 已向量化
  extensions: {                   // 扩展属性
    depth: number;
    weight: number;
    addMemo: boolean;
    displayIndex: number;
    useProbability: boolean;
    characterFilter: { isExclude: boolean; names: string[]; tags: string[] } | null;
    excludeRecursion: boolean;
  };
  characterFilter: object;
  delayUntilRecursion: number;
  // ... 更多 SillyTavern 字段
}
```

### 6.3 数据生命周期

```
创建世界书 → 写入 JSON 文件 → 添加到列表
读取世界书 → JSON5.parse → 标准化 → 渲染条目
编辑条目 → 修改 formValues → 保存 → 标准化 → 写文件
删除世界书 → 删除向量数据 → 删除标签 → 删除文件
```

---

## 7. API 文档

### 7.1 世界书列表

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:list` |
| **调用方式** | `window.electronAPI.worldBook.list()` |
| **请求参数** | 无 |
| **返回结构** | `WorldBookMeta[]` —— `{ name: string; path: string; size: number; modified: Date }[]` |

### 7.2 读取世界书

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:read` |
| **调用方式** | `window.electronAPI.worldBook.read(path)` |
| **请求参数** | `path: string` — 世界书文件绝对路径 |
| **返回结构** | `WorldBookData \| null` —— 标准化后的世界书完整数据 |

### 7.3 写入世界书

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:write` |
| **调用方式** | `window.electronAPI.worldBook.write(path, data)` |
| **请求参数** | `path: string` — 文件路径; `data: any` — 世界书数据 |
| **返回结构** | `{ success: boolean; error?: string }` |

### 7.4 删除世界书

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:delete` |
| **调用方式** | `window.electronAPI.worldBook.delete(path)` |
| **请求参数** | `path: string` — 文件路径 |
| **返回结构** | `{ success: boolean; error?: string; deletedVectors?: number }` |

### 7.5 导入世界书

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:import` |
| **调用方式** | `window.electronAPI.worldBook.import(sourcePath, fileName)` |
| **请求参数** | `sourcePath: string` — 源文件路径; `fileName: string` — 目标文件名 |
| **返回结构** | `{ success: boolean; targetPath?: string; error?: string }` |

### 7.6 优化世界书

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:optimize` |
| **调用方式** | `window.electronAPI.worldBook.optimize(path)` |
| **请求参数** | `path: string` — 文件路径 |
| **返回结构** | `{ success: boolean; optimized?: any; error?: string }` |

### 7.7 获取/设置目录

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:getDirectory` / `worldBook:setDirectory` |
| **调用方式** | `worldBook.getDirectory()` / `worldBook.setDirectory(dir)` |
| **请求参数** | `getDirectory`: 无; `setDirectory`: `dir: string` (支持 `__USER_DATA__` 宏) |
| **返回结构** | `getDirectory`: `string`; `setDirectory`: `{ success: boolean; worldBookDir: string }` |

### 7.8 标签操作

| IPC 通道 | 调用方式 | 说明 |
|---------|---------|------|
| `worldBook:readTags` | `readTags(path)` | 读取标签数据 |
| `worldBook:writeTags` | `writeTags(path, data)` | 写入标签数据 |
| `worldBook:deleteTags` | `deleteTags(path)` | 删除标签数据 |

### 7.9 向量化世界书

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:vectorize` |
| **调用方式** | `window.electronAPI.worldBook.vectorize(path)` |
| **请求参数** | `path: string` — 世界书文件路径 |
| **返回结构** | `{ success: boolean; entriesVectorized: number; entriesFailed: number; entryVectorIds: string[]; error?: string }` |

### 7.10 AI 请求（间接调用）

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `ai:request` |
| **调用方式** | `window.electronAPI.ai.request({ url, method, headers, body, timeout, streaming })` |
| **请求参数** | `url: string`; `method: 'POST'`; `headers: Record<string,string>`; `body: any`; `timeout?: number`; `streaming?: boolean` |
| **返回结构** | `{ success: boolean; data?: any; error?: string }` |
