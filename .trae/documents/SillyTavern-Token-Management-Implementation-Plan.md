# SillyTavern Token管理机制实现计划

## 研究总结

### SillyTavern Token管理核心机制

#### 1. Token计数策略
SillyTavern使用三种主要的tokenizer方式：

**a) Tiktoken (OpenAI模型)**
- 使用 `tiktoken` 库，通过 `tiktoken.encoding_for_model(model)` 获取tokenizer
- 精确计数：对每条消息的每个字段进行tokenize
- 包含消息格式开销：`tokensPerMessage = 3/4`（取决于模型），`tokensPerName = 1/-1`
- 缓存机制：`tokenizersCache` 对象缓存已加载的tokenizer实例

**b) Sentencepiece (Llama、Mistral等)**
- 使用 `@agnai/sentencepiece-js` 库
- 需要加载模型文件（.model）
- 支持多种变体：llama、nerdstash、mistral、yi、gemma、jamba
- 返回token IDs和count

**c) Web Tokenizer (Claude、Llama3等)**
- 使用 `@agnai/web-tokenizers` 库
- 从JSON文件加载tokenizer
- 支持：claude、llama3、command-r、command-a、qwen2、nemo、deepseek
- 需要先将消息转换为特定格式（如Claude prompt）

**d) 快速估算 (Fallback)**
- 公式：`Math.ceil(byteLength / 3.35)`
- 在tokenizer加载失败时使用
- 快速但不精确

#### 2. 上下文窗口控制策略

**关键发现：SillyTavern在前端没有硬性的上下文截断**
- SillyTavern主要依赖后端API的token计数和错误处理
- 在 `chat-completions.js` 中，通过 `context_length` 参数传递给后端
- 使用预算分配：`calculateClaudeBudgetTokens`、`calculateGoogleBudgetTokens` 等函数
- 这些预算函数根据模型的总上下文长度减去system prompt、character card等固定开销，计算出可用于对话历史的token数

**预算计算公式：**
```
可用token预算 = 模型总上下文长度 - system prompt tokens - character card tokens - 预留响应空间
```

#### 3. 消息处理和格式化

**Prompt转换系统 (`prompt-converters.js`)**
- `convertClaudePrompt()`: 将消息数组转换为Claude格式
- `convertChatMLPrompt()`: 转换为ChatML格式
- 合并连续相同角色的消息以节省token
- 处理system prompt、工具调用等特殊内容

**消息数组token计数：**
```javascript
// 在 tokenizers.js 的 /openai/count 端点
for (const msg of messages) {
    num_tokens += tokensPerMessage;
    for (const [key, value] of Object.entries(msg)) {
        num_tokens += tokenizer.encode(value).length;
        if (key == 'name') {
            num_tokens += tokensPerName;
        }
    }
}
num_tokens += tokensPadding; // 通常是3
```

#### 4. 重要信息保护机制

**优先级层次：**
1. **System Prompt** - 始终保留，不被截断
2. **Character Card** - 包含角色设定，始终保留
3. **最近对话** - 优先保留最近的对话轮次
4. **早期对话** - 在token超限时被截断

**SillyTavern的策略：**
- 不在前端截断历史，而是发送完整历史
- 依赖后端API返回错误（如token超限）时再提示用户
- 通过配置让用户手动管理上下文深度

### 当前项目现状分析

#### 现有架构

**核心文件：**
- `PromptBuilder.ts` (646行) - 构建system prompt的完整流程
  - `buildCharacterContext()` - 角色上下文
  - `buildPersonaSection()` - 用户人设
  - `buildDialoguePrompt()` / `buildContinuationPrompt()` - 基础任务提示词
  - `buildFinalSystemPrompt()` - 追加向量上下文和记忆表格
  - `buildSystemPrompt()` - 统一入口

- `CharacterDialogueChat.hooks.ts` (1187行) - 对话业务逻辑
  - `requestAIResponse()` - AI请求核心流程
  - `sendMessage()` - 发送消息
  - 第920行：`await engine.sendMessage(messagesToSend, finalSystemPrompt, ...)`

- `ChatEngine.ts` (378行) - AI引擎封装
  - `sendMessage()` - 构建请求体并发送
  - `buildRequestBody()` - 组合system prompt和chat history

**当前问题：**
1. **无Token计数** - 没有对发送的上下文进行token计数
2. **无上下文限制** - `contextMessages` 直接使用 `[...state.messages, userMessage]`（第971行），可能包含全部历史
3. **无截断策略** - 没有限制发送给AI的消息数量或长度
4. **性能风险** - 随着对话增长，system prompt已包含角色卡+向量检索+记忆表格，再加上完整历史，容易超限

#### 数据流
```
用户输入 → sendMessage() → requestAIResponse() 
  → 向量检索 → 记忆表格 → buildCompleteSystemPrompt() 
  → engine.sendMessage(messagesToSend, finalSystemPrompt)
  → ChatEngine.buildRequestBody() → AI API
```

**关键集成点：**
- `requestAIResponse()` 第920行调用 `engine.sendMessage(messagesToSend, finalSystemPrompt)`
- `messagesToSend` 是 `contextMessages` 参数（第919行），来自 `sendMessage()` 第971行 `[...state.messages, userMessage]`
- `finalSystemPrompt` 已包含角色卡、向量上下文、记忆表格（第619-625行）

---

## 实施方案

### 设计目标
1. 在发送给AI前，控制上下文消息的token总数
2. 保留system prompt、角色卡等关键信息
3. 优先保留最近的对话
4. 支持配置上下文窗口大小
5. 提供token计数和预估功能

### 架构设计

```
TokenManagement/
├── TokenCounter.ts          # Token计数服务（支持多种估算策略）
├── ContextTruncator.ts      # 上下文截断服务
└── types.ts                 # 类型定义
```

**为什么不集成到PromptBuilder？**
- PromptBuilder负责构建system prompt（静态内容）
- Token管理负责控制对话历史（动态内容）
- 职责分离，更符合单一职责原则

### 详细实现步骤

#### 步骤1：创建类型定义 `types.ts`

```typescript
// Token计数结果
export interface TokenCountResult {
  totalTokens: number;
  systemPromptTokens: number;
  messagesTokens: number;
  reservedForResponse: number;
}

// 截断配置
export interface TruncationConfig {
  maxContextTokens: number;      // 最大上下文token数
  reservedForResponse: number;   // 为AI响应预留的token数
  minMessagesToKeep: number;     // 最少保留的消息轮次数
  maxMessagesToKeep: number;     // 最多保留的消息轮次数（额外保护）
}

// 消息token信息
export interface MessageTokenInfo {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  tokenCount: number;
}
```

#### 步骤2：实现TokenCounter.ts

**策略选择：快速估算为主，精确计数为辅**

考虑到：
- 浏览器端无法直接使用tiktoken（需要wasm）
- web-tokenizers需要加载大文件
- 需要快速响应，不能阻塞对话

**实现方案：**
1. **主要方法**：基于字符长度的快速估算
   - UTF-8字节长度 / 3.35（与SillyTavern的guesstimate一致）
   - 对中英文混合文本足够准确
   
2. **辅助方法**：消息格式开销估算
   - 每条消息添加固定开销（类似SillyTavern的tokensPerMessage）
   - System prompt额外开销

3. **可选精确模式**：如果后端提供token计数API，可调用获取精确值

```typescript
export class TokenCounter {
  // 快速估算：UTF-8字节长度 / 3.35
  static estimateTokens(text: string): number {
    const byteLength = new TextEncoder().encode(text).length;
    return Math.ceil(byteLength / 3.35);
  }

  // 计算单条消息的token数（含格式开销）
  static countMessageTokens(message: ChatMessage): number {
    const contentTokens = this.estimateTokens(message.content);
    const formatOverhead = 4; // 每条消息的格式开销
    return contentTokens + formatOverhead;
  }

  // 计算消息数组的总token数
  static countMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessageTokens(msg), 0);
  }

  // 计算system prompt的token数
  static countSystemPromptTokens(systemPrompt: string): number {
    return this.estimateTokens(systemPrompt);
  }

  // 计算总token使用情况
  static countTotalUsage(
    systemPrompt: string,
    messages: ChatMessage[],
    reservedForResponse: number = 1024
  ): TokenCountResult {
    const systemPromptTokens = this.countSystemPromptTokens(systemPrompt);
    const messagesTokens = this.countMessagesTokens(messages);
    return {
      totalTokens: systemPromptTokens + messagesTokens + reservedForResponse,
      systemPromptTokens,
      messagesTokens,
      reservedForResponse,
    };
  }
}
```

#### 步骤3：实现ContextTruncator.ts

**截断策略（参考SillyTavern的优先级）：**

```
总预算 = 模型上下文长度（如8192/16384/32768等）
可用消息预算 = 总预算 - system prompt tokens - 响应预留

截断规则：
1. 从最旧的消息开始移除
2. 始终保持对话成对（user+assistant）
3. 至少保留minMessagesToKeep轮
4. 最多保留maxMessagesToKeep轮（防止即使token足够也发送过多消息）
```

```typescript
export class ContextTruncator {
  static truncateMessages(
    messages: ChatMessage[],
    systemPromptTokens: number,
    config: TruncationConfig
  ): ChatMessage[] {
    // 计算可用预算
    const availableBudget = config.maxContextTokens 
      - systemPromptTokens 
      - config.reservedForResponse;

    // 如果预算不足，返回最少消息
    if (availableBudget <= 0) {
      return this.getMinimumMessages(messages, config.minMessagesToKeep);
    }

    // 从后往前累加，直到超出预算
    const result: ChatMessage[] = [];
    let currentTokens = 0;

    // 从最新消息开始（保持对话连贯性）
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = TokenCounter.countMessageTokens(messages[i]);
      
      // 检查是否超出预算
      if (currentTokens + msgTokens > availableBudget) {
        // 如果是第一条消息，至少保留它
        if (result.length === 0) {
          result.unshift(messages[i]);
        }
        break;
      }

      result.unshift(messages[i]); // 插入到开头
      currentTokens += msgTokens;

      // 检查是否达到最大消息数限制
      if (result.length >= config.maxMessagesToKeep) {
        break;
      }
    }

    // 确保至少保留最小消息数
    if (result.length < config.minMessagesToKeep) {
      return this.getMinimumMessages(messages, config.minMessagesToKeep);
    }

    // 确保消息成对（user + assistant）
    return this.ensureMessagePairs(result);
  }

  // 获取最旧的N轮对话
  private static getMinimumMessages(
    messages: ChatMessage[],
    minRounds: number
  ): ChatMessage[] {
    const messagesPerRound = 2; // user + assistant
    const maxMessages = minRounds * messagesPerRound;
    
    // 从最近的消息开始取
    const start = Math.max(0, messages.length - maxMessages);
    return messages.slice(start);
  }

  // 确保消息成对
  private static ensureMessagePairs(messages: ChatMessage[]): ChatMessage[] {
    // 如果第一条是assistant的消息，移除它（缺少对应的user消息）
    if (messages.length > 0 && messages[0].role === 'assistant') {
      return messages.slice(1);
    }
    return messages;
  }
}
```

#### 步骤4：集成到对话流程

**修改位置：`CharacterDialogueChat.hooks.ts` 的 `requestAIResponse()` 函数**

在第487行（向量检索之前）或第618行（构建system prompt之后）添加token管理和截断逻辑：

```typescript
// 在 buildCompleteSystemPrompt 之后添加
import { TokenCounter, ContextTruncator } from './TokenManagement';

// 默认配置（可从characterConfig读取）
const truncationConfig: TruncationConfig = {
  maxContextTokens: characterConfig?.maxContextTokens ?? 6000, // 默认6000token给上下文
  reservedForResponse: 1024,  // 为AI响应预留1024token
  minMessagesToKeep: 2,       // 至少保留2轮对话
  maxMessagesToKeep: 40,      // 最多保留40条消息
};

// 计算system prompt的token数
const systemPromptTokens = TokenCounter.countSystemPromptTokens(finalSystemPrompt);

// 截断上下文消息
const truncatedMessages = ContextTruncator.truncateMessages(
  messagesToSend,
  systemPromptTokens,
  truncationConfig
);

// 记录截断信息
if (truncatedMessages.length < messagesToSend.length) {
  addLog(
    `[TokenManagement] Context truncated: ${messagesToSend.length} -> ${truncatedMessages.length} messages`,
    'warn'
  );
}

// 使用截断后的消息发送给AI
await engine.sendMessage(truncatedMessages, finalSystemPrompt, engineConfigWithParams);
```

#### 步骤5：添加配置支持

**扩展 `CharacterSessionConfig` 类型：**

在 `CharacterDialogueChat.types.ts` 中添加：

```typescript
export interface CharacterSessionConfig {
  // ... 现有字段 ...
  maxContextTokens?: number;      // 最大上下文token数
  reservedForResponse?: number;   // 响应预留token数
  minMessagesToKeep?: number;     // 最少保留消息轮数
  maxMessagesToKeep?: number;     // 最多保留消息数
}
```

**在ConfigPanel中添加Token管理配置项：**
- 最大上下文token数输入框
- 响应预留token数输入框
- 最少/最多消息数设置
- 当前token使用量显示（可选）

### 性能优化措施

1. **Token计数缓存**
   - 对相同内容的消息缓存token计数结果
   - 使用Map<messageId, tokenCount>缓存

2. **增量计算**
   - 新消息发送时，只计算新消息的token
   - 累加到之前的总token数

3. **异步处理**
   - Token计数和截断在请求前同步执行（耗时极短，<1ms）
   - 不影响用户体验

4. **估算精度平衡**
   - 默认使用快速估算（足够准确）
   - 可选接入后端精确计数API

### 测试方案

1. **单元测试**
   - TokenCounter.estimateTokens() 准确性测试
   - ContextTruncator.truncateMessages() 各种边界情况测试
   - 配置参数验证测试

2. **集成测试**
   - 短对话不触发截断
   - 长对话正确截断
   - 关键信息保留验证
   - 消息成对验证

3. **性能测试**
   - 测量token计数耗时
   - 验证不阻塞UI
   - 对比截断前后的响应时间

### 实施顺序

1. ✅ 研究SillyTavern实现
2. ⏳ 创建TokenManagement模块（types.ts, TokenCounter.ts, ContextTruncator.ts）
3. ⏳ 编写单元测试
4. ⏳ 集成到CharacterDialogueChat.hooks.ts
5. ⏳ 扩展配置类型
6. ⏳ 在ConfigPanel添加配置界面（可选）
7. ⏳ 端到端测试验证
8. ⏳ 性能优化和边界情况处理
