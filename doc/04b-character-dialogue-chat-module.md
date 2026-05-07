# 角色对话聊天模块 (Character Dialogue Chat Module) 技术文档

> 模块路径: `src/renderer/components/Character/CharacterDialogueChat/`
> 源码文件: `CharacterDialogueChat.tsx`, `CharacterDialogueChat.hooks.ts`, `CharacterDialogueChat.types.ts`, `CharacterDialogueChat.utils.ts`, `ChatHeader.tsx`, `ChatInputBar.tsx`, `ChatMessageBubble.tsx`, `ChatTypingIndicator.tsx`, `ConfigPanel.tsx`, `ParameterPanel.tsx`, `PersonaPanel.tsx`, `KnowledgeBaseBindingPanel.tsx`, `MessageRenderer/` (子模块), `utils/` (消息处理工具链)
> 后端支撑: `src/main/ipc/handlers/characterChatHandlers.ts`, `src/main/services/ChatStorageService.ts`, `src/main/services/ChatVectorizationService.ts`
> 通用组件: `src/renderer/components/Common/ChatEngine/` (聊天引擎)
> 状态管理: `src/renderer/stores/characterChatStore.ts`

---

## 1. 模块功能描述

角色对话聊天模块是 Creative Cafe 的**AI 对话测试沙箱**，为角色卡提供真实的多轮 AI 对话测试环境，是角色卡"创作→测试→验证"闭环的关键组成部分。

### 核心能力

| 能力分类 | 具体能力 | 描述 |
|---------|---------|------|
| **对话交互** | 多轮对话 | 用户与 AI 角色的自然多轮对话，支持上下文理解和记忆 |
| | 流式响应 | AI 回复逐字流式输出，实时渲染到界面 |
| | 续写功能 | 对最后一轮 AI 回复进行内容续写，保持角色一致性 |
| | 重试机制 | 针对任一 AI 回复重新生成，支持回溯式修正 |
| | 编辑消息 | 编辑已有的用户或 AI 消息内容 |
| | 取消请求 | 中断正在进行的 AI 请求 |
| | 清空对话 | 清除全部对话历史，重置到初始状态 |
| **消息渲染** | Markdown 渲染 | react-markdown + 插件链实现完整 Markdown 渲染 |
| | 富文本增强 | 代码高亮、引用高亮、内联 HTML 解析、样式限定 |
| | 模板变量替换 | `{{char}}` / `{{user}}` 自动替换为实际名称（含大小写变体） |
| | 引号规范化 | 自动识别和统一中文/英文/弯曲引号格式 |
| | 思维链过滤 | AI 后处理清除思维链标记和前缀 |
| | HTML 安全净化 | 三重安全级别（strict/moderate/loose），防护 XSS 攻击 |
| **配置面板** | 人设选择 | 从人设库中选择用户身份参与对话 |
| | AI 参数调节 | Temperature/Top-P/MaxTokens/Frequency Penalty/Presence Penalty 滑块实时调节 |
| | 知识库绑定 | 绑定知识库文档，对话中自动检索并注入相关上下文 |
| | 配置持久化 | 对话配置自动保存到 localStorage + 主进程文件系统 |
| **UI/UX** | 打字指示器 | AI 思考时显示动画气泡（角色头像 + Loading 图标 + "Typing..."） |
| | 暗色主题 | 渐变背景、毛玻璃效果、彩色光晕、网格纹理 |
| | 全屏模式 | 一键切换全屏对话视图 |
| | 滚动控制 | 自动滚动到底部 + 浮动"回到底部"按钮 |
| | 导出对话 | 一键导出完整对话到剪贴板 |
| **对话管理** | 历史加载 | 自动从 ChatStorageService 加载上次对话记录 |
| | 对话存储 | 每次回复后自动持久化对话到主进程文件系统 |
| | 对话向量化 | 对话内容向量化后支持语义搜索（ChatVectorizationService） |
| **上下文增强** | 向量检索 | 调用 ContextManager 从知识库/世界书/记忆中检索相关上下文 |
| | 系统提示词 | 自动组装角色信息、人设信息、对话约束规则到系统提示词 |

### 操作类型

- **对话操作**: 发送消息、续写、重试、编辑、取消、清空
- **配置操作**: 选择人设、调节参数、绑定/解绑知识库、保存配置
- **UI 操作**: 全屏切换、导出对话、滚动控制
- **后台操作**: 历史加载、对话存储、向量检索、向量化

### 功能边界

- 对话仅作为测试功能，不直接导出到 SillyTavern 格式
- 不包含对话分支/多线剧情管理
- 向量化搜索功能依赖知识库模块的基础设施
- Persona 数据来自 Avatar 模块，不可在此新建

---

## 2. 模块定位与业务价值

### 战略角色

角色对话聊天模块在系统中是**连接角色卡创作与使用验证的关键桥梁**，形成"编辑 → 测试 → 再编辑"的迭代闭环。

```
┌──────────────────────────────────────────────────────────┐
│              角色卡创作工作流                              │
│                                                          │
│  ┌──────────────┐    ┌──────────────────┐               │
│  │ Character    │ →  │ CharacterDialogue│               │
│  │ Manager      │    │ Chat (本模块)     │               │
│  │ (编辑端)     │    │ (测试端)          │               │
│  │              │ ←  │                   │               │
│  │ · 编辑字段   │    │ · 多轮对话验证      │               │
│  │ · AI 翻译    │    │ · 角色表现评估      │               │
│  │ · AI 润色    │    │ · 发现问题回编辑    │               │
│  │ · AI 生成    │    │                   │               │
│  └──────────────┘    └──────────────────┘               │
└──────────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **角色卡质量无法即时验证**: 编辑完成后直接对话测试，实时发现 personality/scenario/first_mes 等问题
2. **对话测试环境缺失**: 无需启动 SillyTavern 即可测试角色卡对话效果
3. **上下文相关性不足**: 知识库绑定功能让 AI 角色能引用外部文档知识
4. **参数调优困难**: 可视化滑块实时调节 AI 参数，直观感受不同配置对回复质量的影响
5. **对话数据丢失**: 自动持久化保证对话历史不因页面切换而丢失

### 目标用户群体

- **角色卡创作者**: 验证角色设定是否能产生预期的对话效果
- **角色卡翻译者/润色者**: 测试翻译或润色后角色的对话质量
- **Prompt 工程师**: 调试和优化角色的 System Prompt

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌──────────────────────────────────────────────────────────────┐
│                   CharacterDialogueChat.tsx                     │
│  ┌────────────┐ ┌──────────────────┐ ┌────────────────────┐  │
│  │ ChatHeader │ │ 消息列表          │ │ ConfigPanel        │  │
│  │            │ │ ┌──────────────┐ │ │ ┌────────────────┐ │  │
│  │ 角色名/头像 │ │ │ChatMessage   │ │ │ │PersonaPanel    │ │  │
│  │ 消息统计   │ │ │Bubble        │ │ │ │                │ │  │
│  │ 清除/导出  │ │ │┌────────────┐│ │ │ │ParameterPanel  │ │  │
│  │ 全屏切换   │ │ ││Message     ││ │ │ │                │ │  │
│  └────────────┘ │ ││Renderer    ││ │ │ │KnowledgeBase   │ │  │
│                 │ │└────────────┘│ │ │ │BindingPanel    │ │  │
│                 │ └──────────────┘ │ │ └────────────────┘ │  │
│                 │ ChatTyping       │ └────────────────────┘  │
│                 │ Indicator        │                          │
│  ┌────────────┐ └──────────────────┘                          │
│  │ChatInputBar│                                                │
│  └────────────┘                                                │
└──────────────────────────────────────────────────────────────┘
                          ↓ Hooks
┌──────────────────────────────────────────────────────────────┐
│  CharacterDialogueChat.hooks.ts (业务逻辑层)                   │
│  ├── useCharacterConfig(characterCardId)  → 配置持久化        │
│  ├── usePersonas()                        → 人设加载          │
│  └── useCharacterDialogueChat(charInfo)   → 对话主逻辑        │
│      ├── sendMessage / continueConversation / retryMessage    │
│      ├── clearChat / cancelRequest / editMessage              │
│      ├── buildDialoguePrompt / buildContinuationPrompt        │
│      └── requestAIResponse (核心AI请求+向量检索)              │
└──────────────────────────────────────────────────────────────┘
                          ↓ 依赖
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐
│ ChatEngine   │ │ Message      │ │ Character    │ │ Context  │
│ (Factory)    │ │ Processor    │ │ Chat Store   │ │ Manager  │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────┘
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Factory** | ChatEngineFactory | 单例工厂管理聊天引擎实例，按配置获取或创建 |
| **Observer** | Zustand Stores | characterChatStore / settingStore / logStore 订阅 |
| **Mediator** | useCharacterDialogueChat Hook | 协调对话状态、引擎、配置、存储等多个子系统 |
| **Strategy** | buildDialoguePrompt / buildContinuationPrompt | 对话模式和续写模式使用不同的 Prompt 构建策略 |
| **Pipes and Filters** | MessageRenderer 插件链 | remark→rehype 插件管线处理 Markdown→HTML 转换 |
| **Command** | sendMessage / retryMessage / continueConversation | 统一的消息发送接口封装 |

### 3.3 核心算法

#### 对话 Prompt 构建 (buildDialoguePrompt)

```typescript
// 1. 构建角色上下文 (buildCharacterContext)
//    - 角色名 / 个性 / 描述 / 场景 / 示例消息 / 系统提示 / 创建者笔记
//    - 使用 replaceTemplates 替换 {{char}} / {{user}} 占位符
// 2. 构建人设段落 (buildPersonaSection)
//    - 当前选中人设的名称和描述
// 3. 组装最终 Prompt:
//    - 任务类型声明
//    - 角色信息 + 人设信息
//    - 对话任务说明
//    - 对话约束规则 (8条)
//    - 严格禁止列表 (8条)
//    - 输出格式说明
```

#### 向量上下文检索与注入

```typescript
// 在每次 AI 请求前:
// 1. 找到对话历史中最后一条用户消息
// 2. 调用 context:retrieve API
//    - 搜索范围: worldbook / knowledge / memory
//    - 过滤范围: 用户绑定的 KnowledgeBase scopeIds
//    - 参数: topK=5, minScore=0.3
// 3. 将检索结果格式化为 "相关背景知识" 段落
// 4. 追加到系统提示词末尾
```

#### 续写逻辑 (continueConversation)

```typescript
// 基于已有消息扩展回复:
// 1. 获取最后一条 assistant 消息的现有内容作为 initialContent
// 2. 设置 initialContentRef 为现有内容
// 3. AI 流式回复以现有内容为前缀开始追加
// 4. 使用 buildContinuationPrompt (续写专用 Prompt)
// 5. 流式回调中验证新内容不会破坏前缀
// 6. 如果流式累积内容短于 initialContent，使用 initialContent + serverResponse 作为回退
```

#### 流式响应后处理

```typescript
// ChatEngine 的 onStream 回调:
// - 累积 chunk 到 streamContentRef.current
// - 更新 targetMessageId 对应的消息内容
// - 状态: 'sending'
//
// ChatEngine 的 onComplete 回调:
// - 验证最终内容不为空
// - Content Protection: 防止最终内容短于流式累积内容
// - 状态: 'sent'
// - 触发 saveChatToStore 持久化
```

### 3.4 MessageRenderer 插件链架构

MessageRenderer 基于 unified 生态的 remark-rehype 管线，处理 **Markdown → HTML** 的完整转换：

```
Raw Content
    ↓
replaceTemplates ({{char}}/{{user}})
    ↓ normalizeQuotes (引号包裹为<q>标签)
    ↓ protectCodeBlocks (代码块占位符保护)
    ↓
【Remark 阶段 (Markdown → MDAST)】
    ├── remarkGfm              (GFM 表格/删除线/任务列表)
    ├── remarkTableCellRawHtml (表格中内联 HTML 解析)
    ├── remarkEmoji            (Emoji 表情符号)
    └── remarkUnderscoreItalic (_斜体_ 语法支持)
    ↓
【Rehype 阶段 (MDAST → HAST)】
    ├── rehypeRaw                    (原始 HTML 解析)
    ├── rehypeInlineHtmlParse        (内联 HTML: span/div/a/b/strong/i/em/u/s 等)
    ├── rehypeSanitize               (安全净化: strict/moderate/loose)
    ├── rehypeQuoteNormalize         (引号规范化: 中日英弯曲引号统一)
    ├── rehypeQuoteHighlight         (引号内容高亮, 支持多语言引号)
    ├── rehypeCodeHighlight          (代码块语言类标记)
    └── rehypeStyleProcessor         (样式作用域限定, 危险样式过滤)
    ↓
ReactMarkdown Components
    ↓
Rendered HTML (安全的富文本消息)
```

### 3.5 安全净化三级策略

| 级别 | 允许的标签 | 协议 | 场景 |
|------|-----------|------|------|
| **strict** | 基础标签 (b/i/u/s/del/code/pre/p/div 等) | http/https/mailto/tel | 严格安全环境 |
| **moderate** (默认) | + details/summary/abbr/kbd/figure 等 | + data: 协议 | 正常对话 |
| **loose** | + audio/video/ruby/bdi/wbr 等 | + blob:/ftp: 协议 | 富媒体场景 |

```typescript
// 配置方式
import { createSanitizeSchema } from '../utils/sanitizeConfig';
const schema = createSanitizeSchema({ level: 'moderate' });
```

### 3.6 组件树结构

```
CharacterDialogueChat (Modal 容器)
├── <style> (CSS 动画/背景/滚动条)
├── div.chat-area (对话主区域, 70%宽度)
│   ├── div.chat-area-bg (暗色渐变背景 + 光晕球体 + 网格纹理)
│   ├── ChatHeader
│   │   ├── 头像/角色名
│   │   ├── 消息统计
│   │   ├── 全屏切换按钮
│   │   ├── 清空对话 (Popconfirm)
│   │   ├── 导出对话
│   │   └── 关闭按钮
│   ├── div.chat-messages (可滚动消息列表)
│   │   ├── 空状态提示 (角色图标 + 欢迎文字)
│   │   ├── ChatMessageBubble[] (每条消息)
│   │   │   └── MessageRenderer (Markdown→HTML 渲染)
│   │   ├── ChatTypingIndicator (仅 AI 回复中)
│   │   ├── 错误提示 div
│   │   └── 滚动到底部按钮 (浮动)
│   └── ChatInputBar
│       ├── TextArea (消息输入)
│       │   ├── placeholder: "Message {角色名}..."
│       │   ├── Enter 发送 / Shift+Enter 换行
│       │   └── AutoSize (2-6 行)
│       └── 发送/取消按钮
└── ConfigPanel (配置右侧面板, 30%宽度)
    ├── PersonaPanel
    │   ├── 标题 "用户人设"
    │   ├── 人设卡片列表 (头像 Base64 + 名称)
    │   └── 选中态高亮
    ├── KnowledgeBaseBindingPanel
    │   ├── 标题 "知识库绑定"
    │   ├── 绑定状态标签
    │   ├── Select (多选知识库)
    │   └── 提示说明
    ├── ParameterPanel
    │   ├── 标题 "AI 参数配置"
    │   ├── 自定义状态徽章
    │   ├── 5 个参数滑块:
    │   │   ├── Max Tokens (256-32768)
    │   │   ├── Temperature (0.1-2.0)
    │   │   ├── Top P (0.1-1.0)
    │   │   ├── Frequency Penalty (-2.0-2.0)
    │   │   └── Presence Penalty (-2.0-2.0)
    │   └── 重置按钮
    └── 保存设置按钮
```

### 3.7 状态管理设计

#### ChatState (核心对话状态)

```typescript
interface ChatState {
  messages: ChatMessage[];       // 消息列表
  isLoading: boolean;            // 是否正在请求
  isStreaming: boolean;          // 是否流式输出中
  error: string | null;          // 错误信息
}
```

#### ChatMessage (消息模型)

```typescript
interface ChatMessage {
  id: string;                    // 唯一消息 ID
  role: 'user' | 'assistant' | 'system';
  content: string;               // 消息内容
  timestamp: number;             // 时间戳
  status?: 'sending' | 'sent' | 'error';  // 消息状态
}
```

#### 配置状态 (useCharacterConfig)

| 配置项 | 存储方式 | 说明 |
|--------|---------|------|
| `selectedPersonaId` | localStorage + 主进程 JSON | 当前选中的人设 ID |
| `customParameters` | localStorage + 主进程 JSON | 自定义 AI 参数覆盖 |
| `boundKnowledgeBaseIds` | localStorage + 主进程 JSON | 绑定的知识库 ID 列表 |

#### 引用状态 (useRef)

| Ref | 用途 |
|-----|------|
| `messagesRef` | 保持消息列表的最新引用，供异步回调读取 |
| `firstMessageSentRef` | 标记是否已发送过首条消息 |
| `initialContentRef` | 续写时的初始内容缓存 |
| `streamContentRef` | 流式响应的累积内容 |
| `targetMessageIdRef` | 当前正在生成的 AI 消息 ID |

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **Stream Closure 闭包陈旧问题** | 使用 `useRef` 持有最新状态引用（`messagesRef`, `targetMessageIdRef`, `streamContentRef`），流式回调中通过 ref 访问最新值而非闭包中的旧值 |
| **续写内容丢失保护** | 三层保护: (1) `streamContentRef` 累积; (2) `onComplete` 中比较服务器返回与累积内容; (3) Content Protection 防止最终内容短于流式阶段内容 |
| **配置实时生效** | `configRef` 在 `updateConfig` 中同步更新（不等 React 渲染），确保 sendMessage 立即读取最新配置 |
| **Prompt 质量保证** | 精心设计的对话/续写 Prompt 包含角色信息、约束规则、禁止项和输出格式四层结构，防止 AI "打破第四面墙" |
| **向量上下文注入** | 在每次 AI 请求前异步检索相关知识，以 "相关背景知识" 段落追加到系统提示词，失败时静默降级不影响对话 |
| **引号多语言兼容** | `normalizeQuotes` 处理 7 种引号配对（英文直引号/弯曲引号/全角引号/日文引号等），代码块内引号保护不变 |
| **安全渲染** | 三级 sanitize 策略 + rehypeStyleProcessor 过滤危险 CSS (expression/url-javascript/behavior)，样式作用域限定在 `.message-renderer` 下 |

### 4.2 性能优化策略

1. **useMemo 缓存**: `effectiveParams` 通过 `getEffectiveParams` + `useMemo` 避免重复计算
2. **MessageRenderer 插件缓存**: `remarkPlugins` / `rehypePlugins` / `components` / `sanitizeSchema` 全部使用 `useMemo`
3. **消息内容预处理**: 预处理在 `useMemo` 中完成，避免每次渲染重复执行
4. **懒加载人设**: Personas 通过 `useEffect` 异步加载，不影响首屏渲染
5. **按需渲染**: `ChatTypingIndicator` 仅在流式开始且最新消息为 user 时显示
6. **引擎单例复用**: `ChatEngineFactory` 按配置缓存引擎实例，避免重复创建

### 4.3 安全考虑

- 所有 HTML 渲染经过 `rehype-sanitize` 净化
- CSS 中的 `expression()` / `url(javascript:)` / `behavior:` 被过滤
- `<style>` 标签内的选择器限定在 `.message-renderer` 命名空间
- 用户输入不直接注入 Prompt，通过模板组装
- 对话历史存储在应用数据隔离目录
- AI 请求通过主进程代理，API Key 不暴露

### 4.4 边界情况处理

- 无历史对话且无 `first_mes` → 显示空状态欢迎提示
- 有 `first_mes` 且无历史 → 自动将首条消息设为对话起点
- AI 返回空响应 → 保持原内容并标记错误状态
- 流式响应中断 → 使用已累积的内容作为最终结果
- 保存失败 → 静默日志记录，不影响正常对话流程
- 全屏模式 → 锁定 body 滚动，显示独立的全屏 Modal
- 多字节字符截断 → 流式累积确保 Unicode 完整性

---

## 5. 模块间关系

### 5.1 依赖关系

```
CharacterDialogueChat
    ├──→ CharacterManager (触发入口, 传递 CharacterInfo)
    │       └──→ characterInfo: { creativeId, characterCardId, name, personality, ... }
    ├──→ Setting Module (AI 引擎配置)
    │       └──→ useSettingStore().setting.aiEngines / activeEngineId
    ├──→ Avatar Module (人设列表)
    │       └──→ window.electronAPI.avatar.list/read
    ├──→ Common/ChatEngine (聊天引擎工厂)
    │       └──→ ChatEngineFactory.getInstance()
    │       └──→ AIEngineConfig → Stream/Complete/Error 回调
    ├──→ Common/MessageRenderer (消息渲染)
    │       └──→ 7 个 remark/rehype 插件链
    ├──→ Knowledge Base Module (向量检索)
    │       └──→ context:retrieve (检索相关上下文)
    │       └──→ vector.getAvailableScopes (可用知识库列表)
    ├──→ Character Chat Store (对话持久化)
    │       └──→ saveTestChat / loadTestChat
    ├──→ Character Config (配置持久化)
    │       └──→ characterConfig:save/load
    ├──→ Chat Storage Service (主进程文件存储)
    │       └──→ getTestChat / saveTestChat / deleteTestChat
    └──→ Chat Vectorization Service (对话向量化)
            └──→ vectorizeChat / searchChatMessages
```

### 5.2 被依赖关系

```
CharacterManager
    └──→ 点击"对话"按钮 → 打开 CharacterDialogueChat Modal
Creative Module
    └──→ CharacterChat.tsx (创意工坊中的对话入口)
```

### 5.3 数据流

```
用户操作 (发送消息)
    ↓
useCharacterDialogueChat.sendMessage(content)
    ↓
创建 userMessage + 创建空 assistantMessage
    ↓ 更新 ChatState
    ↓
requestAIResponse(contextMessages, targetId, initialContent, 'dialogue')
    ├── 1. getActiveEngineConfig() → AI 引擎配置
    ├── 2. getEffectiveParams() → 合并参数 (custom > global > default)
    ├── 3. context:retrieve() → 向量检索相关知识
    ├── 4. buildDialoguePrompt() → 组装系统提示词
    ├── 5. ChatEngine.sendMessage() → 发送 AI 请求
    │       ├── onStream: 更新 streamContentRef → setState 更新消息内容
    │       └── onComplete: 验证内容 → 标记 sent → saveChatToStore 持久化
    └── 6. 错误处理: onError 回调 → 更新错误状态
```

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 对话历史 | JSON 文件 | `{userData}/data/character-chats/{角色名}.json` |
| 对话配置 | localStorage + JSON 文件 | `localStorage[character-session-{cardId}]` + `characterConfig:save` |
| 对话向量 | VecStore WASM | ChatVectorizationService 管理 |
| 模板缓存 | 内存 Map (CACHE_TTL=60s) | ChatStorageService 内部缓存 |

### 6.2 对话数据 Schema

```typescript
interface TestChatData {
  id: string;                    // "test-chat-{timestamp}"
  creativeId: string;            // 创意 ID (与角色卡路径关联)
  characterCardId: string;       // 角色卡 ID
  characterCardName: string;     // 角色名称
  messages: ChatMessage[];       // 消息列表
  createdAt: number;             // 创建时间
  updatedAt: number;             // 最后更新时间
}
```

### 6.3 对话配置 Schema

```typescript
interface CharacterSessionConfig {
  characterCardId: string;               // 角色卡 ID
  selectedPersonaId?: string;            // 选中的人设
  customParameters?: AIParameterConfig;  // 自定义 AI 参数
  boundKnowledgeBaseIds?: string[];      // 绑定的知识库
  lastUpdated: number;                   // 最后更新时间
}
```

### 6.4 数据生命周期

```
打开对话 → loadTestChat → 有历史? → 恢复对话
                                → 无历史 + 有 first_mes? → 自动创建首条消息
                                                          → 无 first_mes? → 空白状态
    ↓
发送消息 → 保存到 ChatState → AI 请求
    ↓
AI 回复完成 → saveChatToStore → 写入 JSON 文件
    ↓
关闭对话 Modal → 状态保留 (下次打开恢复)
    ↓
清除对话 → deleteTestChat → 删除 JSON 文件
```

### 6.5 缓存策略 (ChatStorageService)

- **L1 内存缓存**: `Map<string, CacheEntry>` —— TTL 60 秒
- **缓存键格式**: `{type}_{creativeId}_{characterCardId}`
- **缓存失效**: 保存/删除时主动 invalidate，TTL 过期自动清除
- **旧目录迁移**: 自动将 `test/` 子目录迁移到平级目录

---

## 7. API 文档

### 7.1 对话历史管理 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `characterChat:getTestChat` | `characterChat.getTestChat(creativeId, cardId)` | `creativeId: string; characterCardId: string` | `TestChatData \| null` |
| `characterChat:saveTestChat` | `characterChat.saveTestChat(creativeId, cardId, name, messages)` | `creativeId, cardId, name, messages[]` | `TestChatData` |
| `characterChat:deleteTestChat` | `characterChat.deleteTestChat(creativeId, cardId)` | `creativeId, cardId` | `boolean` |
| `characterChat:getAllTestChats` | `characterChat.getAllTestChats()` | 无 | `TestChatData[]` |
| `characterChat:clearCache` | `characterChat.clearCache()` | 无 | `{ success: true }` |

### 7.2 配置持久化 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `characterConfig:save` | `characterConfig.save(cardId, config)` | `cardId: string; config: CharacterSessionConfig` | `{ success: boolean; error?: string }` |
| `characterConfig:load` | `characterConfig.load(cardId)` | `cardId: string` | `{ success: boolean; config?: CharacterSessionConfig }` |

### 7.3 对话向量化 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `chatVector:vectorize` | `chatVector.vectorize(characterId, messages)` | `characterId: string; messages: ChatMessage[]` | `{ success: boolean }` |
| `chatVector:delete` | `chatVector.delete(characterId)` | `characterId: string` | `{ success: boolean }` |
| `chatVector:search` | `chatVector.search(characterId, query, topK?)` | `characterId, query, topK?` | `SearchResult[]` |

### 7.4 上下文检索 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `context:retrieve` | `context.retrieve(conversation, options)` | `conversation: {role, content}[]; options: { topK, minScore, sources, scopeIds }` | `{ success: boolean; items: ContextItem[] }` |
| `context:compress` | `context.compress(items, maxTokens)` | `items: ContextItem[]; maxTokens: number` | `{ success: boolean; compressed: string }` |

### 7.5 可用知识库列表 API

| IPC 通道 | 调用方式 | 参数 | 返回 |
|---------|---------|------|------|
| `vector:getAvailableScopes` | `vector.getAvailableScopes()` | 无 | `{ success: boolean; scopes: Array<{ id, sourceId, sourceName, sourceType, vectorCount }> }` |

### 7.6 AI 请求 (通用)

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `ai:request` (通过 ChatEngine 间接调用) |
| **请求参数** | `{ url, method: 'POST', headers, body, timeout?, streaming: true }` |
| **流式监听** | `electronAPI.on('ai:stream', callback)` / `electronAPI.on('ai:stream:complete', callback)` |
| **返回结构** | `{ success: boolean; data?: any; error?: string }` |

### 7.7 模块内部类型导出

```typescript
// CharacterDialogueChat.types.ts
export { ChatMessage, ChatState, CharacterInfo, ChatActions, ChatConfig }
export { UserPersona, AIParameterConfig, KnowledgeBaseBinding }
export { CharacterSessionConfig, EffectiveAIParams }
```

---

## 附录

### A. 插件体系详细说明

#### Remark 插件 (Markdown 解析阶段)

| 插件 | 文件 | 功能 |
|------|------|------|
| `remarkGfm` | 第三方 (remark-gfm) | GitHub Flavored Markdown: 表格、删除线、任务列表 |
| `remarkEmoji` | 第三方 (remark-emoji) | Emoji 短码转 Emoji 字符 |
| [remarkTableCellRawHtml](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/remark-table-cell-raw-html.ts) | 自研 | 表格单元格中的内联 HTML 解析（span/div/a/img 等） |
| [remarkUnderscoreItalic](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/remark-underscore-italic.ts) | 自研 | 下划线斜体语法 `_text_` → `<em>`，不破坏变量名中的下划线 |

#### Rehype 插件 (HTML 处理阶段)

| 插件 | 顺序 | 文件 | 功能 |
|------|------|------|------|
| `rehypeRaw` | ① | 第三方 | 解析原始 HTML 字符串 |
| [rehypeInlineHtmlParse](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-inline-html-parse.ts) | ② | 自研 | 内联 HTML 标签解析（span/a/b/i/u/img/code/br 等） |
| `rehypeSanitize` | ③ | 第三方 | XSS 防护，按配置的标签/属性/协议白名单过滤 |
| [rehypeQuoteNormalize](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-quote-normalize.ts) | ④ | 自研 | 7 种引号格式统一处理，包裹为高亮 span |
| [rehypeQuoteHighlight](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-quote-highlight.ts) | ⑤ | 自研 | 引号内文本 `<mark>` 高亮 |
| [rehypeCodeHighlight](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-code-highlight.ts) | ⑥ | 自研 | 代码块添加 `message-renderer-code` CSS 类 |
| [rehypeStyleProcessor](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/plugins/rehype-style-processor.ts) | ⑦ | 自研 | CSS 样式作用域限定 + 危险属性过滤 |

### B. 消息处理器工具链

| 函数 | 文件 | 功能 |
|------|------|------|
| `replaceTemplates` | [messageProcessor.ts](file:///d:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts) | 替换 `{{char}}`/`{{user}}` 模板变量（含 8 种大小写变体） |
| `normalizeQuotes` | 同上 | 统一引号格式，代码块内引号受保护 |
| `protectCodeBlocks` | 同上 | 代码块占位符保护（`` ``` `` / inline `` ` ``） |
| `restoreCodeBlocks` | 同上 | 还原占位符为原始代码块 HTML |
| `processMessage` | 同上 | 统一入口：模板替换 → 引号规范化 → 角括号编码 |
| `preprocessForMarkdown` | 同上 | Markdown 预处理：模板替换 → 引号规范化 → 代码块保护 |

### C. 使用示例

#### 从 CharacterManager 打开对话

```tsx
// CharacterManager.tsx 中的调用方式
const handleTestCharacter = async (record: Character) => {
  const content = await window.electronAPI.character.read(record.path);
  
  setTestChatCharacter({
    creativeId: record.path,
    characterCardId: record.path,
    characterCardName: content.data?.name || record.name,
    characterCardContent: content.data?.description || '',
    personality: content.data?.personality || '',
    scenario: content.data?.scenario || '',
    first_mes: content.data?.first_mes || '',
    mes_example: content.data?.mes_example || '',
    system_prompt: content.data?.system_prompt || '',
    creator_notes: content.data?.creator_notes || '',
    alternate_greetings: content.data?.alternate_greetings || [],
    tags: content.data?.tags || [],
  });
  
  setIsTestChatOpen(true);
};

// CharacterDialogueChat 使用:
<CharacterDialogueChat
  characterInfo={testChatCharacter}
  open={isTestChatOpen}
  onClose={() => setIsTestChatOpen(false)}
  avatarPath={testChatAvatar}
/>
```

#### MessageRenderer 独立使用

```tsx
import { MessageRenderer } from './MessageRenderer';

<MessageRenderer
  content={rawMarkdownContent}
  charName="克拉拉"
  userName="旅行者"
  config={{
    markdown: { enableGFM: true, enableEmoji: true },
    html: { allowRawHTML: true, sanitizeLevel: 'moderate' },
    style: { codeHighlight: true, theme: 'dark' },
    template: { charPlaceholder: '{{char}}', userPlaceholder: '{{user}}' }
  }}
  onLinkClick={(href, e) => console.log('Link clicked:', href)}
/>
```
