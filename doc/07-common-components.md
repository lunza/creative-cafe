# 项目通用组件文档 (Project Common Components)

> 本文档涵盖 `src/renderer/components/Common/`、`src/renderer/components/Layout/`、`src/renderer/hooks/`、`src/renderer/utils/` 中的所有可复用组件、Hooks 和工具函数。

---

## 1. Common/ 通用业务组件

### 1.1 AIService — AI 服务组件

**文件**: `src/renderer/components/Common/AIService.tsx`

**功能**: 统一的 AI 请求服务，封装了向 AI 引擎（OpenAI 兼容 API）发送聊天补全和文本补全请求的能力。

**核心能力**:
- 非流式聊天请求 (`sendChatRequest`)
- 流式聊天请求 (`sendStreamChatRequest`) — 通过 SSE 解析实时接收
- Vercel AI SDK 集成 (`sendChatRequestVercel` / `sendStreamChatRequestVercel`)
- 自动重试机制（网络错误/5xx 错误）
- 请求取消（AbortController）
- 配置安全校验（AIConfigValidator）
- 错误分类处理（AIErrorHandler）

**使用示例**:
```typescript
import { AIService, defaultAIServiceConfig } from '../Common/AIService';

const config = {
  defaultModel: 'gpt-3.5-turbo',
  defaultBaseUrl: 'http://127.0.0.1:5000',
  defaultApiKey: 'sk-xxx',
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
  retryAttempts: 3,
  retryDelay: 1000,
  timeout: 60000,
};
const aiService = new AIService(config);

// 非流式
const result = await aiService.sendChatRequest({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'Hello' }]
});

// 流式
await aiService.sendStreamChatRequest(
  { model: 'gpt-3.5-turbo', messages: [...] },
  {
    onStream: (chunk, isDone) => { /* 逐字处理 */ },
    onComplete: (response) => { /* 完成 */ },
    onError: (error) => { /* 错误 */ }
  }
);
```

**自定义 Hook**:
```typescript
const { status, response, error, sendChatRequest, sendStreamChatRequest, reset } = useAIService(config);
```

**优化建议**:
- 进一步抽象为泛型请求处理器（支持不同 AI 提供商适配器）
- 添加请求队列和并发控制
- 内置 Token 计数和使用统计

---

### 1.2 DataPersistence — 数据持久化组件

**文件**: `src/renderer/components/Common/DataPersistence.tsx`

**功能**: 通用的键值对数据存储管理器，通过 IPC 与主进程的 StorageManager 通信。

**存储键分类**:
- `settings` — 全局设置
- `worldbooks` — 世界书数据
- `characters` — 角色卡数据
- `creatives` — 创意数据
- `chats` — 对话数据
- `templates` — 模板数据

**使用示例**:
```typescript
import { getDataPersistence } from '../Common/DataPersistence';

const dp = getDataPersistence();

// 通用方法
await dp.set('myKey', { data: 'value' });
const value = await dp.get('myKey');
await dp.update('myKey', (current) => ({ ...current, updated: true }));
await dp.delete('myKey');
const hasKey = await dp.has('myKey');

// 分类方法
await dp.setSettings({ theme: 'dark' });
const settings = await dp.getSettings();
await dp.setCharacter('char1', characterData);

// 批量操作
const allWorldBooks = await dp.getWorldBooks();
const exported = await dp.export();
await dp.import(exported);
```

**优化建议**:
- 与各模块 Zustand Store 深度集成（自动持久化中间件）
- 添加数据版本迁移机制
- 支持增量同步和冲突检测

---

### 1.3 RichTextRenderer — 富文本渲染器

**文件**: `src/renderer/components/Common/RichTextRenderer.tsx`

**功能**: 基于 `react-markdown` 的安全富文本渲染组件，支持 GFM 表格、表情符号和受限 HTML。

**支持的 Markdown 特性**:
- GFM (GitHub Flavored Markdown): 表格、任务列表、删除线
- Emoji 表情符号
- 安全 HTML: 通过 `rehype-sanitize` 限制允许的标签和协议
- 自定义样式: 每个 HTML 元素都有统一的 CSS 样式

**使用示例**:
```tsx
import RichTextRenderer from '../Common/RichTextRenderer';

<RichTextRenderer content="# Hello\n\nThis is **markdown**" />
```

**安全配置**:
- 只允许有限的 HTML 标签（p/div/span/h1-h6/table/code/blockquote 等）
- 链接仅允许 http/https 协议
- 图片允许 http/https/data 协议

**优化建议**:
- 添加代码语法高亮（Prism/highlight.js 集成）
- 支持自定义组件注册
- 添加 Mermaid 图表支持

---

### 1.4 ChatEngine — 聊天引擎

**文件**: `src/renderer/components/Common/ChatEngine/ChatEngine.ts`

**功能**: 基于策略模式的 AI 聊天引擎，封装流式/非流式对话逻辑。

**核心能力**:
- 消息历史管理
- 流式响应监听（`onStream` / `onComplete` / `onError`）
- 自定义系统提示词注入
- 取消请求
- 监听器生命周期管理

**使用示例**:
```typescript
import { ChatEngine } from '../Common/ChatEngine';

const engine = new ChatEngine();
engine.onStream((chunk) => { /* 流式文本 */ });
engine.onComplete((response) => { /* 完成 */ });
engine.onError((error) => { /* 错误 */ });

await engine.sendMessage(messages, systemPrompt, {
  api_url: 'http://127.0.0.1:5000',
  model_name: 'qwen3.5-27b-heretic-v3',
  api_key: 'sk-xxx',
  api_mode: 'chat_completion',
  api_key_transmission: 'header',
  temperature: 0.7,
  max_tokens: 10240,
});
```

**优化建议**:
- 支持更多 AI 提供商适配器（Anthropic/Google/本地模型）
- 添加对话历史压缩
- 内置 Token 预算管理

---

### 1.5 MarkdownEditor — Markdown 编辑器

**文件**: `src/renderer/components/Common/MarkdownEditor/MarkdownEditor.tsx`

**功能**: 基于 Milkdown 7 的所见即所得 Markdown 编辑器，集成 AI 工具栏。

**核心能力**:
- WYSIWYG Markdown 编辑体验
- AI 工具栏：翻译、润色、生成摘要
- 自定义默认内容和占位符
- 与顶部 AI 工具集成

**使用示例**:
```tsx
import MarkdownEditor from '../Common/MarkdownEditor';

<MarkdownEditor
  value={markdownContent}
  onChange={(value) => setMarkdownContent(value)}
  placeholder="请输入 Markdown 内容..."
/>
```

**相关配套**:
- `MarkdownAITools.tsx` — AI 工具按钮组件
- `MarkdownEditor.types.ts` — 类型定义
- `MarkdownEditor.utils.ts` — 工具函数
- `MarkdownEditor.defaults.ts` — 默认配置

**优化建议**:
- 抽取为独立 npm 包
- 添加插件系统
- 增强协作编辑能力

---

## 2. Layout/ 布局组件

### 2.1 Sidebar — 侧边栏导航

**文件**: `src/renderer/components/Layout/Sidebar.tsx`

**功能**: 应用左侧导航栏，基于 Ant Design Menu 组件实现 Tab 切换导航。

**导航项映射**:
| 导航项 | Tab 值 | 目标模块 |
|--------|--------|---------|
| 仪表盘 | `dashboard` | Dashboard |
| 创意工坊 | `creative` | CreativeManager |
| Prompt优化器 | `prompt-optimizer` | PromptOptimizer |
| 世界书 | `worldbook` | WorldBookManager |
| 用户人设 | `avatar` | AvatarManager |
| 角色卡 | `character` | CharacterManager |
| 插件 | `plugin` | PluginManager |
| 记忆 | `memory` | MemoryChatManager |
| 知识库 | `knowledge` | KnowledgeBaseManager |
| 设置 | `settings` | Settings |

**使用示例**:
```tsx
// 由 App.tsx 直接渲染，无需手动使用
import { Sidebar } from '../Layout/Sidebar';
```

### 2.2 Header — 顶部栏

**文件**: `src/renderer/components/Layout/Header.tsx`

**功能**: 应用顶部栏，显示应用标题和版本信息。

### 2.3 FloatingLogButton — 浮动日志按钮

**文件**: `src/renderer/components/Layout/FloatingLogButton.tsx`

**功能**: 全局浮动的日志按钮，点击显示日志面板。

### 2.4 GlobalLogPanel — 全局日志面板

**文件**: `src/renderer/components/Layout/GlobalLogPanel.tsx`

**功能**: 全局日志面板，从 `useLogStore` 读取日志显示。

---

## 3. Hooks/ 自定义 Hooks

### 3.1 useModal

**文件**: `src/renderer/hooks/useModal.ts`

**功能**: 通用 Modal 状态管理 Hook。

```typescript
import { useModal } from '../../hooks/useModal';

const { isOpen, openModal, closeModal, toggleModal } = useModal();
```

---

## 4. Utils/ 工具函数

### 4.1 animation — 动画常量

**文件**: `src/renderer/utils/animation.ts`

**功能**: 定义全局动画名称和延迟常量。

```typescript
import { ANIMATIONS, ANIMATION_DELAYS, CARD_ANIMATIONS } from '../../utils/animation';

// 使用示例
className={`${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['200']}`}
```

### 4.2 format / formatUtils — 格式化工具

**文件**: `src/renderer/utils/format.ts`, `src/renderer/utils/formatUtils.ts`

**功能**: 日期/数字/文件大小等格式化函数。

### 4.3 characterAIUtils — 角色卡 AI 工具

**文件**: `src/renderer/utils/characterAIUtils.ts`

**功能**: 封装角色卡相关的 AI 请求逻辑（翻译/润色/生成）。

```typescript
import { sendCharacterAIRequest } from '../../utils/characterAIUtils';

const result = await sendCharacterAIRequest(engineConfig, systemPrompt, userText);
```

### 4.4 apiUtils — API 工具

**文件**: `src/renderer/utils/apiUtils.ts`

**功能**: 通用 API 请求辅助函数。

### 4.5 persistence — 持久化工具

**文件**: `src/renderer/utils/persistence.tsx`

**功能**: 渲染进程端的数据持久化辅助。

### 4.6 worldBookUtils — 世界书工具

**文件**: `src/renderer/utils/worldBookUtils.ts`

**功能**: 世界书相关的工具函数（文件名安全化/条目排序/格式转换/AI 响应清理）。

```typescript
import {
  sanitizeFileName,
  formatWorldBookToDocument,
  formatEntryForEdit,
  createDefaultEntry,
  cleanAIThoughts,
  parseAIJsonResponse,
  sortEntriesByTitle,
  sortEntriesByOrder,
  moveEntry
} from '../../utils/worldBookUtils';
```

### 4.7 promptTemplates — Prompt 模板

**文件**: `src/renderer/utils/promptTemplates.ts`

**功能**: 预定义的 AI Prompt 模板集合。

---

## 5. 优化建议总结

### 5.1 当前可优化项

| 组件 | 问题 | 建议 |
|------|------|------|
| **AIService** | 硬编码 OpenAI 协议 | 抽象为 Provider 模式，支持多 AI 提供商 |
| **DataPersistence** | 与 Zustand Store 分离 | 集成 persist 中间件实现自动持久化 |
| **RichTextRenderer** | 无代码高亮 | 集成 Prism.js 或 highlight.js |
| **ChatEngine** | 仅支持 OpenAI 兼容 API | 实现适配器模式扩展 |
| **MarkdownEditor** | 与项目紧耦合 | 抽取为独立可发布的组件包 |
| **动画系统** | 分散在各组件中 | 统一为 AnimationProvider 上下文 |

### 5.2 潜在组件化能力

| 候选组件 | 当前状态 | 抽取价值 |
|---------|---------|---------|
| **ErrorBoundary** | 未实现 | 统一的错误边界组件，防止整个应用崩溃 |
| **LoadingState** | 各组自行实现 | 统一的 Loading 骨架屏组件 |
| **EmptyState** | 各组自行实现 | 统一的空状态提示组件 |
| **ConfirmDialog** | 使用 Popconfirm 分散 | 统一的确认对话框组件 |
| **FormModal** | 各组重复实现 | 通用的 Form + Modal 组合组件 |
| **PageHeader** | 各组重复实现 | 统一的页面头部组件（标题 + 操作栏） |

---

## 6. 组件地图

```
src/renderer/
├── components/
│   ├── Common/
│   │   ├── AIService.tsx           # AI 请求服务 (类 + Hook)
│   │   ├── DataPersistence.tsx     # 数据持久化服务 (类)
│   │   ├── RichTextRenderer.tsx    # 富文本渲染组件
│   │   ├── ChatEngine/             # 聊天引擎
│   │   │   ├── ChatEngine.ts       # 核心引擎类
│   │   │   ├── ChatEngine.factory.ts # 工厂函数
│   │   │   └── ChatEngine.types.ts # 类型定义
│   │   └── MarkdownEditor/         # Markdown 编辑器
│   │       ├── MarkdownEditor.tsx
│   │       ├── MarkdownAITools.tsx
│   │       └── *.types.ts / *.utils.ts
│   ├── Layout/
│   │   ├── Sidebar.tsx             # 侧边栏导航
│   │   ├── Header.tsx              # 顶部栏
│   │   ├── FloatingLogButton.tsx   # 浮动日志按钮
│   │   └── GlobalLogPanel.tsx      # 全局日志面板
│   ├── hooks/
│   │   └── useModal.ts             # Modal 状态 Hook
│   └── utils/
│       ├── animation.ts            # 动画常量
│       ├── format.ts / formatUtils.ts # 格式化
│       ├── characterAIUtils.ts     # 角色卡 AI 工具
│       ├── apiUtils.ts             # API 工具
│       ├── persistence.tsx         # 持久化辅助
│       ├── worldBookUtils.ts       # 世界书工具
│       └── promptTemplates.ts      # Prompt 模板
```
