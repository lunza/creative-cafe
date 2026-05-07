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
