# 角色卡模块 (Character Card Module) 技术文档

> 模块路径: `src/renderer/components/Character/`
> 源码文件: `CharacterManager.tsx`, `CharacterManager.css`, `WorldBookRelationPanel.tsx`, `CharacterDialogueChat/` (子模块)
> 后端支撑: `src/main/ipc/handlers/characterHandlers.ts`, `src/main/ipc/handlers/characterChatHandlers.ts`, `src/main/services/characterService.ts`, `src/main/services/ChatStorageService.ts`
> 工具函数: `src/renderer/utils/characterAIUtils.ts`
> 状态管理: `src/renderer/stores/characterChatStore.ts`

---

## 1. 模块功能描述

角色卡模块是 Creative Cafe 的**核心模块之一**，提供对 SillyTavern 角色卡文件的完整生命周期管理，并内置 AI 辅助创作和对话测试沙箱。

### 1.1 角色卡管理子模块 (CharacterManager)

| 能力 | 描述 |
|------|------|
| **角色卡 CRUD** | 查看、编辑、删除、导入图片类角色卡（PNG/JPG/WebP） |
| **SillyTavern 规范兼容** | 支持 V2/V3 规范，识别 spec 版本标签（chara_card_v2/v3） |
| **缩略图展示** | 表格列表显示角色卡缩略图（异步 Base64 加载、5 秒超时、缓存 Map） |
| **角色卡详情查看** | 富文本渲染完整的角色卡信息（描述/个性/场景/初始消息/示例消息/系统提示/历史记录后指令/替代问候/创建者笔记/角色书/标签） |
| **AI 翻译** | 对角色卡所有字段进行 AI 翻译（中文） |
| **AI 润色** | 对任意字段进行 AI 文本润色，支持自定义润色要求弹窗 |
| **AI 生成** | 基于已有信息 AI 自动生成 9 类字段（描述/个性/场景/初始消息/示例消息/系统提示/历史记录后指令/替代问候/创建者笔记） |
| **世界书关联管理** | 关联/解绑世界书到角色卡，管理优先级/启用状态/过滤标签 |
| **原始值还原** | 每个字段保持 `originalValues` 备份，支持一键还原 |

### 1.2 角色对话聊天子模块 (CharacterDialogueChat)

| 能力 | 描述 |
|------|------|
| **实时对话测试** | 测试角色卡在对话中的表现 |
| **消息渲染管道** | react-markdown + remark/rehype 插件链渲染富文本消息 |
| **流式响应支持** | AI 回复时逐字流式显示（ChatEngine + SSE 解析） |
| **打字指示器** | AI 思考时显示动画打字效果 (ChatTypingIndicator) |
| **知识库绑定** | 对话中绑定知识库文档增强上下文 (KnowledgeBaseBindingPanel) |
| **Persona 配置** | 选择用户人设参与对话 (PersonaPanel) |
| **对话参数调节** | Temperature/Top-P/MaxTokens 等参数 (ParameterPanel) |
| **配置持久化** | 对话配置（人物卡绑定参数）通过 `characterConfig:save/load` 持久化 |
| **消息净化** | sanitizeConfig 清洗 + messageProcessor 预处理 |

### 操作类型

- **文件 CRUD**: 查看详情、编辑保存、删除、导入图片角色卡
- **AI 增强**: 翻译、润色、AI 生成（各自独立操作）
- **关联管理**: 世界书关联 CRUD
- **对话交互**: 发送消息、接收流式响应、管理对话历史

### 功能边界

- **仅图片类角色卡** (PNG/JPG/JPEG/WebP)，不支持 JSON 格式
- "新建角色卡"按钮存在但功能未完全实现
- AI 操作依赖 Settings 模块的 AI 引擎配置

---

## 2. 模块定位与业务价值

### 战略角色

角色卡模块连接**角色卡编辑**和 **AI 对话测试**，形成完整的创作-验证闭环。

```
┌──────────────────────────────────────────────────────┐
│                 Character Module                       │
│  ┌─────────────────────┐  ┌────────────────────────┐ │
│  │ CharacterManager     │  │ CharacterDialogueChat   │ │
│  │ (管理端)             │  │ (测试端)                │ │
│  │                     │  │                        │ │
│  │ · 导入/查看/编辑/删除│  │ · 实时对话              │ │
│  │ · AI 翻译/润色/生成  │  │ · 流式响应              │ │
│  │ · 世界书关联         │  │ · 知识库绑定            │ │
│  │ · 缩略图管理         │  │ · Persona 配置          │ │
│  └─────────────────────┘  └────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **角色卡内容创作困难**: AI 翻译/润色/生成功能降低创作门槛
2. **角色卡质量验证不便**: 内置对话测试沙箱即时验证
3. **跨语言内容管理**: 一键翻译所有字段到中文
4. **多角色卡管理**: 表格视图支持筛选、排序、分页

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌──────────────────────────────────────────────────────┐
│                CharacterManager (管理端)               │
│  ┌───────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ Table     │  │ View Modal    │  │ Edit Modal   │ │
│  │ (列表)    │  │ (详情查看)     │  │ (编辑表单)    │ │
│  └───────────┘  └───────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────┘
                          ↓ 触发
┌──────────────────────────────────────────────────────┐
│          CharacterDialogueChat (对话测试端)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ChatHeader│ │ChatInputBar│ │ChatMessageBubble    │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ MessageRenderer (react-markdown + remark/rehype) │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────┐
│  dataStore (characters)  +  characterChatStore        │
└──────────────────────────────────────────────────────┘
                          ↓ IPC
┌──────────────────────────────────────────────────────┐
│  characterHandlers → characterService                 │
│  characterChatHandlers → ChatStorageService           │
└──────────────────────────────────────────────────────┘
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Cache-Aside** | ThumbnailImage/AvatarImage | 全局 Map 缓存缩略图，含超时和重试机制 |
| **Memento** | formValues + originalValues | 保存编辑前的原始值，支持一键还原 |
| **Proxy** | electronAPI IPC | 渲染进程通过 preload 桥接调用主进程服务 |
| **Pipes and Filters** | MessageRenderer | remark/rehype 插件链处理消息内容 |

### 3.3 核心算法

#### 缩略图异步加载 (ThumbnailImage)

```typescript
// 全局缓存
const thumbnailCache: Map<string, string> = new Map();
const thumbnailErrorCache: Map<string, boolean> = new Map();

const load = async (retryCount = 0) => {
  // 1. 5秒超时保护
  timeoutTimer = setTimeout(() => { setError(true); }, 5000);
  // 2. 读取 Base64
  const result = await window.electronAPI.file.readAsBase64(filePath);
  // 3. 成功则缓存
  if (result.success && result.data) {
    thumbnailCache.set(filePath, result.data);
  } else if (retryCount < 2) {
    // 4. 失败重试 (最多2次, 每次延迟500ms)
    retryTimer = setTimeout(() => load(retryCount + 1), 500);
  }
};
```

#### AI 响应后处理

```typescript
// 清除 AI 思维链标记
const thoughtPatterns = [
  /思考[:：]\s*[^]*?(?=译文:|翻译:|\n\n|$)/gi,
  /Thought[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
  /Thinking[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
  /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
  // ... 更多模式
];
// 清除前缀
cleanedText = cleanedText.replace(/^(译文:|翻译:|Translation:)\s*/i, '').trim();
// 标签字段特殊处理 (顿号→逗号)
if (field === 'tags' && cleanedText.includes('、')) {
  cleanedText = parts.join(', ');
}
```

#### AI 生成字段逻辑

```typescript
// 基于角色卡已有信息，为指定字段生成内容
// 1. 收集所有已有字段信息作为上下文
// 2. 构造专业 systemPrompt (包含字段规范和生成规则)
// 3. 构造 userPrompt (含角色卡现有信息 + 目标字段说明)
// 4. 发送 AI 请求 → 后处理 → 更新表单
```

### 3.4 组件树结构

```
CharacterManager
├── Space[操作栏] (刷新/导入/新建)
├── Table[角色卡列表]
│   ├── 缩略图列 (ThumbnailImage)
│   ├── 文件名称 (可点击查看详情)
│   ├── 角色名称/卡片版本/版本信息/创建者
│   ├── 标签列 (最多3个 + 省略)
│   ├── 大小/修改时间
│   └── 操作列 (编辑/对话/删除)
├── Modal[查看详情] (1200px 宽)
│   ├── AvatarImage (角色头像)
│   ├── 基本信息卡片 (ReactMarkdown)
│   ├── 初始消息/示例消息/系统提示
│   ├── 历史记录后指令/替代问候
│   ├── 创建者笔记 (含多语言)
│   └── 角色书 (角色书条目列表)
├── Modal[编辑角色卡] (1200px 宽)
│   ├── 左列: 名称/昵称/来源/创建者/版本/标签
│   ├── 右列: 个性/场景
│   ├── 描述/初始消息/示例消息
│   ├── 系统提示/历史记录后指令/替代问候/创建者笔记
│   ├── 每个字段: [生成][翻译][润色][还原] 按钮
│   └── WorldBookRelationPanel
├── Modal[AI润色要求输入]
└── CharacterDialogueChat (对话测试 Modal)
    ├── ChatHeader
    ├── 消息列表 (ChatMessageBubble)
    │   └── MessageRenderer
    ├── ChatTypingIndicator
    ├── ChatInputBar
    ├── ConfigPanel
    │   ├── ParameterPanel
    │   ├── PersonaPanel
    │   └── KnowledgeBaseBindingPanel
    └── CharacterDialogueChat.hooks (业务逻辑)
```

### 3.5 MessageRenderer 插件体系

| 插件 | 类型 | 功能 |
|------|------|------|
| `rehype-code-highlight` | rehype | 代码块语法高亮 |
| `rehype-quote-highlight` | rehype | 引用块高亮样式 |
| `rehype-quote-normalize` | rehype | 引用块格式标准化 |
| `rehype-inline-html-parse` | rehype | 内联 HTML 解析 |
| `rehype-style-processor` | rehype | 样式处理 |
| `remark-underscore-italic` | remark | 下划线斜体支持 |
| `remark-table-cell-raw-html` | remark | 表格单元格原始 HTML |

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **图片角色卡解析** | 通过 `characterService.readCharacter` 解析嵌入元数据，识别 PNG 中的 SillyTavern tEXt chunk |
| **AI 内容后处理** | 多层正则过滤（思维链 + 前缀清理 + 特殊字段处理），防止 AI 返回格式不佳的内容 |
| **缩略图性能** | 全局 Map 缓存避免重复请求；超时和重试机制处理慢速文件系统 |
| **表单状态一致性** | 维护 `originalValues` 备份，防止 AI 操作覆盖后无法恢复 |
| **世界书关联同步** | 编辑保存时同步保存世界书关联到 `characterService.setWorldBookRelations` |
| **配置持久化** | 角色卡编辑配置通过 `characterConfig:save/load` 独立于角色卡文件持久化 |
| **【重点标记 - Bug 修复】图片替换** | 编辑已有角色卡时，通过 `imageChanged` 状态追踪用户是否更换图片，若更换则调用 `createFromImage` 重建 PNG 文件（替换基底图片+嵌入新数据），而非仅调用 `character.write` 更新 tEXt chunks |
| **【重点标记 - Bug 修复】图片格式兼容** | 上传图片时通过 canvas 统一转换为 PNG 格式，确保 JPG/WebP 等非 PNG 格式图片也可作为角色卡载体 |
| **【重点标记 - Bug 修复】缩略图缓存失效** | 通过发布-订阅机制（`invalidateCharacterImageCache`/`subscribeToImageInvalidation`），在角色卡保存/删除/导入时主动清除 LRU 缓存并通知 `ThumbnailImage`/`AvatarImage` 组件重新加载，解决编辑后列表和头像显示旧图片的问题 |
| **【重点标记 - 功能优化】翻译/润色上下文参考** | 翻译和润色操作通过 `buildCharacterContext` 函数自动收集角色卡其他已填字段（完整传递，不截断）作为上下文，拼接到 user prompt 末尾，确保翻译用词和润色风格与角色卡整体设定保持一致。与生成操作的 `existingFieldsInfo` 构建逻辑完全统一 |
| **【重点标记 - Bug 修复】上下文字段截断** | 移除 `buildCharacterContext` 和 `performGenerate` 中 `existingFieldsInfo` 构建的 `substring(0, 300)` 截断，完整传递角色卡字段内容给 AI。添加诊断日志记录上下文字符数和字段数 |

### 4.2 性能优化策略

1. **缩略图缓存**: `thumbnailCache` / `avatarCache` 全局 Map 减少 React 重新渲染
2. **分页加载**: 角色卡列表分页 (默认 10 条/页)
3. **按需加载**: 详情视图仅在打开 Modal 时才读取完整内容
4. **useMemo 优化**: 避免不必要的重复渲染

### 4.3 安全考虑

- 角色卡目录限制在 `__USER_DATA__/data/characters`
- 导入角色卡时仅复制到管理目录
- 消息内容通过 `sanitizeConfig` 净化处理
- AI 请求通过主进程代理，API Key 不暴露给渲染进程

### 4.4 边界情况处理

- 非图片文件显示默认 UserOutlined 图标
- 无标签/无版本/无创建者显示"无"
- 标签超过3个时显示省略标签
- 图片加载失败显示默认占位图

### 4.5 【重点标记 - Bug 修复记录】图片替换无效

**问题描述**: 在角色卡编辑弹窗中，用户点击"更换图片"上传新图片后点击保存，系统仍然展示原始图片，基底图片未被替换。

**根本原因**: `CharacterEditModal.handleEditModalOk` 中编辑已有角色卡的分支（`editingItem.path` 存在）仅调用 `character.write`，该函数从磁盘读取原始 PNG 文件并仅更新 tEXt chunks（chara/ccv3 角色数据），完全忽略了用户通过 `uploadedImage` 上传的新图片。

**修复方案**:
1. **`imageChanged` 状态追踪**: 新增 `imageChanged` 状态，在 `handleFileInputChange` 和 `handleRemoveImage` 中设置为 `true`，在模态框打开时重置为 `false`。以此区分"编辑时加载的原始图片"和"用户主动更换的新图片"。
2. **编辑已有卡时检测图片更换**: 在 `handleEditModalOk` 的已有卡分支中，当 `imageChanged && uploadedImage` 为真时，提取新图片的 base64 数据，调用 `character.createFromImage` 以新图片为载体重建 PNG 文件（包含新图片+新角色数据），替代原来的 `character.write` 调用。
3. **图片格式转换**: 新增 `convertToPng` 函数，在 `handleFileInputChange` 中通过 canvas 将任意格式图片（JPG/WebP等）统一转换为 PNG，确保与角色卡载体格式兼容（后端 `createCharacterFromImage` 通过 PNG 魔数校验仅接受 PNG）。

**涉及文件**:
- `src/renderer/components/Character/CharacterEditModal.tsx` — 核心修复
- `src/main/services/characterService.ts` — `createCharacterFromImage` 方法（无需修改，已支持从图片创建角色卡）

**测试场景覆盖**:
- JPG 格式图片替换（canvas 转换为 PNG 后正常工作）
- PNG 格式图片替换（直接通过，无需转换）
- 大尺寸图片处理（canvas 按原始尺寸绘制，不压缩）
- 连续多次替换操作（每次 `handleFileInputChange` 均设置 `imageChanged = true`，保存后重置）

### 4.6 【重点标记 - Bug 修复记录】缩略图/头像缓存未失效

**问题描述**: 编辑角色卡并替换图片保存后，列表视图缩略图和查看弹窗头像仍显示旧图片，且在 MemoryChat 的角色列表中也不更新。重新打开编辑弹窗则显示正确的新图片（因为 `handleEdit` 直接从磁盘读取，绕过缓存）。

**根本原因**: `characterThumbnailCache.tsx` 中的 `thumbnailCache` 和 `avatarCache` 是模块级 LRU 缓存，以文件路径 `filePath` 为键。角色卡编辑后 PNG 文件原地覆盖（路径不变），但 `CharacterManager.handleSaved` 仅调用 `fetchCharacters()` 刷新文件列表元数据，**未清除图片缓存**。同时 `ThumbnailImage`/`AvatarImage` 组件的 `useEffect` 依赖 `[filePath]`，路径不变时不会重新加载，即使手动清除了缓存也不会触发重新获取。

**修复方案**:
1. **发布-订阅机制**: 在 `characterThumbnailCache.tsx` 中新增 `invalidationListeners` Map 和两个导出函数：
   - `invalidateCharacterImageCache(filePath)`: 清除该路径的 4 个缓存条目（thumbnail/thumbnailError/avatar/avatarError），并通知所有订阅该路径的监听器
   - `subscribeToImageInvalidation(filePath, callback)`: 注册监听器，返回取消订阅函数
2. **组件订阅**: `ThumbnailImage` 和 `AvatarImage` 新增 `refreshKey` state，通过 `useEffect` 订阅 `subscribeToImageInvalidation`。当缓存失效事件触发时，`refreshKey` 递增，使加载 `useEffect`（依赖 `[filePath, refreshKey]`）重新执行，从磁盘加载最新图片
3. **调用时机**: 在 `CharacterManager` 的三个回调中调用 `invalidateCharacterImageCache`：
   - `handleSaved(savedPath)`: 编辑保存后（`savedPath` 为已有卡路径时）
   - `handleDelete(path)`: 删除角色卡后
   - `handleImportCharacter`: 导入成功后（`result.targetPath`，可能覆盖同名文件）

**涉及文件**:
- `src/renderer/components/Character/utils/characterThumbnailCache.tsx` — 发布-订阅机制 + 组件修改
- `src/renderer/components/Character/CharacterManager.tsx` — 三处回调添加缓存失效调用

**SillyTavern 兼容性**: 本次修复仅涉及渲染层缓存失效，不触碰主进程的 PNG 解析/写入逻辑（`characterService.ts`），`@lenml/char-card-reader` 的 tEXt chunk 解析完全不受影响。

**受益的组件（无需修改，自动生效）**:
- `CharacterListView` 中的 `ThumbnailImage` — 列表缩略图
- `CharacterListView` 中的 `AvatarImage` — 查看弹窗头像
- `MemoryChat/ChatManager.tsx` — 共享 `thumbnailCache`，缓存清除后下次访问自动重新加载

### 4.7 【重点标记 - 功能优化】翻译/润色上下文参考机制

**优化背景**: 角色卡编辑中的"生成"操作会自动收集角色卡其他已填字段作为上下文传入 AI，确保生成内容与角色卡整体设定一致。但"翻译"和"润色"操作仅处理当前字段的文本，不传入任何角色卡其他字段信息，导致翻译用词和润色风格可能与角色卡整体设定不协调。

**优化方案**: 在 `useCharacterAIOperations.ts` hook 层新增 `buildCharacterContext` 辅助函数，在翻译和润色操作的 user prompt 末尾追加角色卡其他字段上下文参考段落。

**实现细节**:
1. **`buildCharacterContext(formValues, excludeField)`**: 遍历 `FIELD_DESCRIPTIONS` 中除目标字段外的已填字段，完整传递每个字段的值（不截断），拼成 `- 标签：值` 格式的列表。与 `performGenerate` 中的 `existingFieldsInfo` 构建逻辑完全一致。
2. **翻译操作 (`handleTranslate`)**: user prompt 从纯字段文本变为 `字段文本 + 【角色卡其他字段参考】段落 + 参考提示语`。当其他字段全空时不追加上下文（保持原行为）。
3. **润色操作 (`performPolish`)**: 同上，user prompt 追加相同的上下文参考段落。
4. **不修改 `promptTemplateService.ts`**: 避免修改模板结构触发破坏性重置（SCHEMA_VERSION 不变，`mergeNewDefaultTemplates` 只添加缺失模板不更新已有模板）。上下文在 hook 层拼接到 user prompt，不干扰 system prompt 中的翻译/润色规则。

**涉及文件**:
- `src/renderer/components/Character/hooks/useCharacterAIOperations.ts` — 新增 `buildCharacterContext` + 修改 `handleTranslate` / `performPolish`

### 4.8 【重点标记 - Bug 修复】上下文字段内容截断

**问题描述**: 生成、翻译和润色功能在构建角色卡其他字段上下文参考时，将每个字段值截断到前 300 字符（`substring(0, 300)`），导致 AI 无法完整参考角色卡其他字段内容。

**排查过程**: 全链路追踪（前端 Hook → `characterAIUtils.ts` → `AIService.tsx` → `preload.ts` → `aiHandlers.ts` → `fetch` → AI API），确认：
- 日志系统本身不截断数据（`aiHandlers.ts` 明确标注"完整JSON，不截断"，`logger.ts` 使用 `fs.appendFileSync` 完整写入）
- 截断仅存在于前端 Hook 层的 2 处 `substring(0, 300)`
- 日志中看到的截断是实际发送数据的截断，而非日志记录过程的截断

**修复方案**: 移除 `buildCharacterContext`（第 146 行）和 `performGenerate` 中 `existingFieldsInfo` 构建（第 363 行）的 `substring(0, 300)` 截断，完整传递角色卡字段内容。同时在三个操作中添加诊断日志，记录上下文字符数和字段数。

**涉及文件**:
- `src/renderer/components/Character/hooks/useCharacterAIOperations.ts` — 移除 2 处截断 + 添加诊断日志

---

## 5. 模块间关系

### 5.1 依赖关系

```
Character Module
    ├──→ Setting Module (AI 引擎配置)
    ├──→ WorldBook Module (世界书关联)
    │       └──→ WorldBookRelationPanel
    ├──→ Knowledge Base Module (对话知识库绑定)
    │       └──→ KnowledgeBaseBindingPanel
    ├──→ Avatar Module (Persona 选择)
    │       └──→ PersonaPanel
    ├──→ Common/ChatEngine (聊天引擎)
    ├──→ Common/RichTextRenderer (react-markdown 渲染)
    ├──→ characterAIUtils (sendCharacterAIRequest)
    └──→ ChatStorageService (对话存储)
```

### 5.2 被依赖关系

```
Creative Module
    └──→ CharacterCardEditor (调用角色卡编辑能力)
Dashboard Module
    └──→ 角色卡数量统计
```

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 角色卡文件 | 图片 (PNG/JPG/WebP) + 嵌入元数据 | `{characterPath}/*.png` |
| 角色卡配置 | JSON | `{characterPath}/{name}.json` (与图片同名) |
| 世界书关联 | 嵌入在角色卡文件元数据中 | characterService 管理 |
| 对话记录 | ChatStorageService | 独立存储 |

### 6.2 角色卡 Schema

```typescript
interface CharacterCardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string[];
  system_prompt: string;
  post_history_instructions: string;
  creator_notes: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  nickname: string;
  source: string;
  group_only_greetings: boolean;
  character_book?: CharacterBook;
  spec?: 'chara_card_v2' | 'chara_card_v3';
  data?: CharacterCardData; // 嵌套结构
}
```

---

## 7. API 文档

### 7.1 角色卡管理 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `character:list` | `character.list()` | 无 | `Character[]` |
| `character:read` | `character.read(path)` | `path: string` | 角色卡完整数据 |
| `character:write` | `character.write(path, data)` | `path, data` | `{ success }` |
| `character:createFromImage` | `character.createFromImage(path, imgBase64, data)` | `path, imageDataBase64, characterData` | `{ success, error? }` — 以指定图片为载体重建 PNG 角色卡（用于新建和图片替换） |
| `character:delete` | `character.delete(path)` | `path: string` | `{ success }` |
| `character:import` | `character.import(src, name)` | `src, name` | `{ success, targetPath }` |
| `character:getDirectory` | `character.getDirectory()` | 无 | `string` |
| `character:setDirectory` | `character.setDirectory(dir)` | `dir: string` | `{ success, characterDir }` |
| `character:getWorldBookRelations` | `character.getWorldBookRelations(path)` | `path` | `Relation[]` |
| `character:setWorldBookRelations` | `character.setWorldBookRelations(path, rels)` | `path, relations[]` | `{ success }` |

### 7.2 角色卡配置 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `characterConfig:save` | `characterConfig.save(cardId, config)` | `cardId, config` | `{ success }` |
| `characterConfig:load` | `characterConfig.load(cardId)` | `cardId: string` | `{ success, config }` |

### 7.3 对话管理 API

| IPC 通道 | 调用方式 | 说明 |
|---------|---------|------|
| `characterChat:getTestChat` | `getTestChat(creativeId, cardId)` | 获取测试对话 |
| `characterChat:saveTestChat` | `saveTestChat(...)` | 保存对话 |
| `characterChat:deleteTestChat` | `deleteTestChat(...)` | 删除对话 |
| `characterChat:getAllTestChats` | `getAllTestChats()` | 获取所有对话 |
| `characterChat:clearCache` | `clearCache()` | 清除缓存 |

### 7.4 AI 请求 (通用)

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `ai:request` |
| **请求参数** | `{ url, method: 'POST', headers, body, timeout?, streaming? }` |
| **返回结构** | `{ success: boolean; data?: any; error?: string }` |
