# 计划：打通 llama.cpp reasoning_content 思考内容显示链路

## Context（背景与根因）

**问题**：用户开启思考，deepseek-v4-flash @ llama.cpp（127.0.0.1:5000）"怎么调都不思考"；直接测 llama.cpp 正常。

**根因**（日志 `logs/ai-handler/ai-handler_20260907_231807.log` req-427ac9927e97 已证实）：
- 模型**实际在思考**——服务端持续返回 `delta.reasoning_content` 增量
- llama.cpp 后端把思考放在**独立字段 `reasoning_content`**（`--reasoning-format deepseek` 风格），正文 `content` 无 `<think>` 标签
- 应用**全链路无任何一处消费 `reasoning_content`**：
  - PC 端 `ChatEngine.parseSSEChunk`（ChatEngine.ts:636）只解析 `delta.content`
  - LAN server `extractDeltaFromSSELine`（lanApiServer/dialogue.ts:341）同样只读 `delta.content`
- PC 端已有思考三态体系（ThinkTagMode strip/strip_render/fold + ConfigPanel 开关 + `<details>` 折叠渲染），但**全部只处理正文中的 `<think>` 标签**
- 日志中 6 处 `enable_thinking: false` 均为标签补发请求（故意关闭，正常行为，不动）

**目标**：`reasoning_content` 接入现有三态体系——strip 丢弃 / strip_render 存储不渲染 / fold 流式实时展示+折叠查看。PC 端与 LAN server（Android 链路）同步适配。

## 关键现状（复用基础）

| 现有设施 | 位置 | 复用方式 |
|---|---|---|
| 思考折叠 UI | `utils/messageProcessor.ts` `convertThinkingTags` → `<details class="message-renderer-thought-block">` | 气泡渲染 reasoning 时复用同款 details 结构/CSS |
| 三态配置 UI | `ConfigPanel.tsx`（thinkTagMode 控件）+ `deriveThinkTagMode()` | 不改，直接生效 |
| 回调架构 | `ChatEngine` 的 onStream/onComplete/onError 三回调 + IChatEngine 接口 | 并列新增 onReasoning |
| tool_calls 并行解析范式 | `ChatEngine.parseSSELineToolCalls`（与 parseSSEChunk 并行调用） | reasoning 解析照抄此模式 |
| Android 端消费 | `android-client/src/screens/ChatScreen.tsx`（m.reasoning + ThinkingPanel，流式 348-352 行） | LAN server 推 reasoning 事件后零改动生效 |
| 消息持久化 | `saveChatToStore` 直接存 ChatMessage[]（hooks.ts:588，无字段白名单） | 加 reasoning 字段即自动持久化 |

## 实施步骤

### Task 1：ChatEngine 解析 reasoning_content（渲染进程通用引擎）

**文件**：`src/renderer/components/Common/ChatEngine/ChatEngine.types.ts`、`ChatEngine.ts`

1. types.ts：
   - 新增 `export type ReasoningCallback = (delta: string) => void;`
   - `IChatEngine` 接口加 `onReasoning(callback: ReasoningCallback): void;`
   - `AIResponse` 加 `reasoning?: string;`（完成时回传累积思考全文）
2. ChatEngine.ts：
   - 新增 `private reasoningCallback: ReasoningCallback | null = null` + `onReasoning()` 方法（与 onStream 并列，cleanupListeners 一并清理）
   - 新增 `private parseSSEReasoningLine(line: string): string | null`：提取 `parsed.choices[0].delta.reasoning_content`（模式照抄 parseSSELineToolCalls，含跨行容错）
   - `setupEventListeners()`：
     - 新增 `let tempReasoning = ''` 累积
     - handleStream 两个分支（accumulatedData 增量行 / 旧格式 chunk）中，与 parseSSEChunk 并行调用 parseSSEReasoningLine；增量触发 `this.reasoningCallback?.(delta)`
     - handleComplete：补齐尾部残余行的 reasoning 解析（与 content 残余处理对称）；AIResponse 带 `reasoning: tempReasoning || undefined`

### Task 2：消息结构与流式状态通道

**文件**：`CharacterDialogueChat.types.ts`、`chatReducer.ts`、`CharacterDialogueChat.hooks.ts`

1. types.ts：`ChatMessage` 加 `/** 思考内容（llama.cpp reasoning_content 独立字段；think_tag_mode=strip_render/fold 时保留） */ reasoning?: string;`
2. chatReducer.ts：`STREAM_CHUNK` action 加 `reasoning?: string`；case 分支更新 `msg.reasoning: action.reasoning ?? msg.reasoning`
3. hooks.ts（sendMessage 流式段，~1410 行）：
   - 新增 `streamReasoningRef`（与 streamContentRef 并列）
   - `engine.onReasoning((delta) => { streamReasoningRef.current += delta; dispatch({ type: 'STREAM_CHUNK', targetMessageId, content: streamContentRef.current, reasoning: streamReasoningRef.current }); })`
   - onComplete：`const finalReasoning = response?.reasoning ?? streamReasoningRef.current;`
     - `deriveThinkTagMode(...) === 'strip'` → 消息不带 reasoning（丢弃，现状语义）
     - strip_render / fold → 最终消息写入 `reasoning: finalReasoning`
   - 提示引导：流式期间首次收到 reasoning 且当前三态为 strip 时，`addLog` + `message.info`（"检测到模型思考内容，当前思考内容处理为「不显示」；如需查看请在右侧配置切换为「折叠查看」"）——用 ref 防抖每会话一次
   - 现有正文 `<think>` 剥离逻辑（stripThinkingTags，~1488 行）**保持不变**（独立字段与正文标签互不干扰）

### Task 3：气泡渲染思考折叠块

**文件**：`ChatMessageBubble.tsx`（必要时补 CSS）

- `message.reasoning` 非空且 `showThinking=true`（fold）时，在正文 MessageRenderer **上方**渲染：

```tsx
<details className="message-renderer-thought-block" open={isStreaming}>
  <summary>💭 AI 思考过程{isStreaming && <span className="thinking-spinner" />}</summary>
  <div className="thinking-content">{message.reasoning}</div>
</details>
```

- 复用现有 `message-renderer-thought-block` 样式；流式时 `open` 自动展开，完成后收起（对齐 Android ThinkingPanel 行为）
- 正文 `<think>` 标签渲染路径（convertThinkingTags）不动
- strip_render 模式不渲染（showThinking=false 自然跳过），仅存储

### Task 4：LAN server 适配（Android 链路）

**文件**：`src/main/services/lanApiServer/dialogue.ts`

1. `extractDeltaFromSSELine`（341 行）改造：新增返回结构 `{ content: string; reasoning: string }`（提取 `delta.reasoning_content`），主循环调用点（720/730 行）同步解构
2. 主循环：reasoning 增量在 `thinkMode === 'fold'` 时直接 `handlers.onReasoning?.(reasoningDelta)`（不经过 StreamSanitizer——那是正文 `<think>` 的处理器，独立字段无需清洗）
3. 持久化：assistant 消息写入 `reasoning` 字段（strip 丢弃 / 其他模式保留），对齐 PC 端三态语义
4. server.ts 的 `onReasoning` → SSE `reasoning` 事件（378 行已存在）→ Android ChatScreen 已消费（352 行），**Android 端零改动**

### Task 5：验证与文档

1. `npx tsc --noEmit` 零新增错误（存量错误不算）
2. 相关单测通过（chatReducer 若有测试同步补 STREAM_CHUNK reasoning 用例）
3. 重启 dev server（杀 vite/electron 进程 → `npm run dev`），确认 Electron 加载新代码
4. 文档增量更新：
   - `docs/FIX_RECORDS.md` 新增 §7.67（根因：reasoning_content 独立字段全链路无消费；重点标记）
   - `.trae/documents/技术文档.md` 增补思考内容双通道（正文标签 + reasoning_content 字段）架构说明

## 验证方案（用户实测）

1. llama.cpp 加载 deepseek-v4-flash，应用对话模式开启思考
2. 右侧配置面板「思考内容处理」切到「折叠查看」（fold）
3. 发送消息 → 气泡上方出现"💭 AI 思考过程"折叠块，流式期间自动展开显示思考增量，完成后收起
4. 切回「不显示」（strip）→ 无思考块且日志出现一次引导提示
5. 重进会话 → fold/strip_render 模式下历史消息思考内容仍可见/已存储

## 风险与边界

- `enable_thinking: false` 的标签补发请求**不受影响**（补发场景无 reasoning 展示需求）
- 非 llama.cpp 后端（无 reasoning_content 字段）：parseSSEReasoningLine 返回 null，零影响
- ThinkTagPlugin / 世界书润色 / RAG 链路不消费 reasoning 字段，不受影响
- Android 端消息结构已含 m.reasoning，LAN 存储对齐后自动兼容
