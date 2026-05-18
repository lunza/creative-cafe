# AI 系统提示词 (system_prompt) 拼接问题修复计划

## 一、问题分析

### 1. 全局 system_prompt 存储位置

全局系统提示词存储在 `src/shared/settings.ts` 中的 `AppSetting.defaultSetting.aiEngines[0].system_prompt` 字段，用户通过设置页面进行配置。

### 2. 问题根因

**全局 `system_prompt` 在所有 AI 功能中均未被引用或拼接。**

当前系统中的 AI 请求构建流程如下：

```
渲染进程（各功能模块）
  ├── 各自构建 messages 数组（硬编码模块级 system prompt，如 "你是一个专业的翻译助手..."）
  ├── 通过 window.electronAPI.ai.request(body) 发送到主进程
  └── body.messages 中不包含全局 system_prompt

主进程（aiHandlers.ts - handleRequest）
  ├── 接收 body（包含 messages）
  ├── 直接透传 body 到 fetch(url, { body: JSON.stringify(body) })
  └── 没有对 body.messages 做任何 system_prompt 处理
```

### 3. 影响范围 - 所有涉及 AI 请求的模块

| 文件 | 功能 | 当前 messages 构建方式 | 是否包含全局 system_prompt |
|------|------|----------------------|------------------------|
| `WorldBookManager.tsx` | 世界书 AI 生成条目 | 硬编码系统 prompt（第 2512-2612 行） | ❌ 否 |
| `WorldBookManager.tsx` | 世界书 AI 生成新条目 | 硬编码系统 prompt（约第 2770 行） | ❌ 否 |
| `MarkdownAITools.utils.ts` | Markdown 编辑器 AI 工具 | `generateSystemPrompt()` 生成工具级 prompt | ❌ 否 |
| `useCreativeAI.ts` | 创作模式 AI 功能 | 模块级 prompt | ❌ 否 |
| `CharacterCardEditPage.tsx` | 角色卡编辑页 AI 功能 | 模块级 prompt | ❌ 否 |
| `CharacterDialogueChat.hooks.ts` | 对话聊天 AI | 使用 PromptBuilder 构建 | ❌ 否 |

### 4. 世界书 AI 生成条目功能的具体情况

经检查，`WorldBookManager.tsx` 第 2640-2642 行的代码：
```typescript
messages: [
  { role: 'system', content: systemPrompt },  // 这是模块内硬编码的 prompt
  { role: 'user', content: themeDescription }
]
```
这里的 `systemPrompt` 是**模块内硬编码的**（第 2512 行定义），**不是**全局设置中的 `system_prompt`。

---

## 二、方案选择

### 方案一：在各功能模块中分别拼接 system_prompt

**实现方式：** 在每个 AI 功能模块中，读取全局设置，在构建 messages 时将全局 `system_prompt` 拼接到最前面。

**优点：**
- 各模块独立，互不影响
- 模块级 prompt 和全局 prompt 都清晰可见

**缺点：**
- 需要在 6+ 个模块中重复添加相同逻辑
- 容易遗漏或格式不一致
- 新增 AI 功能时容易忘记拼接
- 代码冗余，可维护性差

### 方案二：在 aiHandlers 统一处理层集中拼接（推荐 ✅）

**实现方式：** 在 `aiHandlers.ts` 的 `handleRequest` 函数中，在处理 `body.messages` 时统一注入全局 `system_prompt`。

**优点：**
- **唯一处理点：** 所有通过 `ai:request` IPC 通道发送的 AI 请求都会自动拼接
- **易于维护：** 只需修改一处代码
- **不会遗漏：** 新增 AI 功能无需关心拼接逻辑
- **可扩展：** 可在主进程层统一处理其他全局消息逻辑

**缺点：**
- 需要处理模块已有 `system` 消息的情况（避免重复）
- 需要在主进程层访问设置（需要通过 IPC 获取或缓存）

### 方案三：混合方案 - aiHandlers 集中拼接 + 模块级 prompt 可选（最佳 ✅）

**实现方式：** 
1. 在 `aiHandlers.ts` 统一注入全局 `system_prompt`（放在 messages 数组最前面）
2. 如果 messages 中已有 `system` 角色的消息，将全局 `system_prompt` 与模块级 prompt 合并（全局在前）
3. 提供一个可选参数 `skipGlobalSystemPrompt: true` 用于某些需要完全自定义 system prompt 的特殊场景

**优点：**
- 兼具方案二的所有优点
- 兼容现有的模块级 prompt（不会被覆盖）
- 支持特殊场景的自定义需求
- 保证全局 `system_prompt` 在所有场景下生效

---

## 三、实施方案 - 方案三（混合方案）

### 步骤 1：在主进程层缓存全局 system_prompt

**文件：** `src/main/ipc/handlers/settingsHandlers.ts`（现有文件，需要修改）

在主进程中，添加一个全局 system_prompt 的缓存机制：

```typescript
// 在主进程启动时缓存 system_prompt
let cachedGlobalSystemPrompt: string = '';

// 从设置文件读取全局 system_prompt
async function updateCachedSystemPrompt() {
  try {
    const settings = await readSettingsFile();
    if (settings?.aiEngines) {
      const activeEngineId = settings.activeEngineId || 'default';
      const activeEngine = settings.aiEngines.find((e: any) => e.id === activeEngineId);
      cachedGlobalSystemPrompt = activeEngine?.system_prompt || '';
    }
  } catch (e) {
    console.error('[AI Handlers] 读取全局 system_prompt 失败:', e);
  }
}

// 导出供 aiHandlers 使用
export function getGlobalSystemPrompt(): string {
  return cachedGlobalSystemPrompt;
}

// 监听设置变化，更新缓存
ipcMain.on('settings-changed', () => {
  updateCachedSystemPrompt();
});

// 在模块加载时初始化
updateCachedSystemPrompt();
```

### 步骤 2：在 aiHandlers.ts 中注入全局 system_prompt

**文件：** `src/main/ipc/handlers/aiHandlers.ts`

在 `handleRequest` 函数中，找到构建请求 body 的位置（约第 268 行和第 657 行），在发送请求前处理 `body.messages`：

```typescript
/**
 * 处理 body.messages，注入全局 system_prompt
 * - 如果 body.skipGlobalSystemPrompt === true，则跳过注入
 * - 如果 messages 中已有 system 角色消息，将全局 prompt 拼接到最前面
 * - 如果 messages 中没有 system 角色消息，在最前面添加全局 prompt
 */
function injectGlobalSystemPrompt(body: any): void {
  // 检查是否跳过全局 system_prompt 注入
  if (body.skipGlobalSystemPrompt) {
    return;
  }
  
  const globalPrompt = getGlobalSystemPrompt();
  if (!globalPrompt) {
    return;
  }
  
  if (!body.messages || !Array.isArray(body.messages)) {
    return;
  }
  
  // 检查是否已有 system 消息
  const existingSystemIndex = body.messages.findIndex(
    (msg: any) => msg && msg.role === 'system'
  );
  
  const globalSystemMessage = { role: 'system', content: globalPrompt };
  
  if (existingSystemIndex >= 0) {
    // 已有 system 消息，将全局 prompt 插入到最前面，原有 system 消息后移
    body.messages.splice(existingSystemIndex, 1); // 移除原有的
    body.messages.unshift(
      globalSystemMessage,
      ...body.messages.slice(existingSystemIndex)
    );
  } else {
    // 没有 system 消息，在最前面添加
    body.messages.unshift(globalSystemMessage);
  }
}
```

然后在流式请求和普通请求的 `fetch` 调用前调用此函数：

```typescript
// 在流式请求中（约第 315 行之前）
injectGlobalSystemPrompt(body);  // 新增

try {
  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: controller?.signal
  });
```

```typescript
// 在普通请求中（约第 680 行之前）
injectGlobalSystemPrompt(body);  // 新增

try {
  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: controller.signal
  });
```

### 步骤 3：确保 settings 变化时更新主进程缓存

**文件：** `src/renderer/stores/settingStore.ts`

在用户修改设置并保存时，通知主进程更新缓存：

```typescript
// 在保存设置的函数中，添加：
window.electronAPI.settings.changed();  // 通知主进程设置已变更
```

### 步骤 4：验证所有 AI 请求路径

确认系统中所有 AI 请求都通过 `window.electronAPI.ai.request()` IPC 通道发送，这样主进程的 `injectGlobalSystemPrompt` 函数会对所有请求生效。

经检查，以下模块都通过 `window.electronAPI.ai.request()` 发送请求：
- ✅ `WorldBookManager.tsx` - 世界书 AI 生成条目
- ✅ `MarkdownAITools.tsx` - Markdown 编辑器 AI 工具
- ✅ `useCreativeAI.ts` - 创作模式 AI
- ✅ `CharacterCardEditPage.tsx` - 角色卡编辑 AI
- ✅ `CharacterDialogueChat.hooks.ts` - 对话聊天

### 步骤 5：清理模块级重复的 system_prompt 拼接（可选）

由于主进程层已经统一处理全局 system_prompt，各模块的 messages 构建中：
- **保留模块级 system prompt**（如翻译助手的 "你是一个专业的翻译助手..."）
- 全局 system_prompt 会自动被注入到最前面
- 无需在各模块中单独处理全局 system_prompt

---

## 四、文件清单

### 修改文件

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `src/main/ipc/handlers/aiHandlers.ts` | 添加 `injectGlobalSystemPrompt` 函数，在流式请求和普通请求的 fetch 前调用 | P0 |
| `src/main/ipc/handlers/settingsHandlers.ts` | 添加全局 system_prompt 缓存机制，提供 `getGlobalSystemPrompt()` | P0 |
| `src/renderer/stores/settingStore.ts` | 在保存设置时通知主进程更新缓存 | P1 |

### 不需要修改的文件（由主进程统一处理）

| 文件 | 原因 |
|------|------|
| `WorldBookManager.tsx` | 主进程自动注入，无需修改 |
| `MarkdownAITools.tsx` | 主进程自动注入，无需修改 |
| `MarkdownAITools.utils.ts` | 主进程自动注入，无需修改 |
| `useCreativeAI.ts` | 主进程自动注入，无需修改 |
| `CharacterCardEditPage.tsx` | 主进程自动注入，无需修改 |
| `CharacterDialogueChat.hooks.ts` | 主进程自动注入，无需修改 |

---

## 五、验证清单

- [ ] 世界书 AI 生成条目功能能正确拼接全局 system_prompt
- [ ] Markdown 编辑器 AI 工具能正确拼接全局 system_prompt
- [ ] 创作模式 AI 功能能正确拼接全局 system_prompt
- [ ] 角色卡编辑 AI 功能能正确拼接全局 system_prompt
- [ ] 对话聊天 AI 能正确拼接全局 system_prompt
- [ ] 全局 system_prompt 在所有 AI 交互场景中被正确、唯一地拼接
- [ ] 全局 system_prompt 与模块级 prompt 共存（全局在前，模块在后）
- [ ] 当全局 system_prompt 为空时不影响原有功能
- [ ] 用户修改设置中的 system_prompt 后，新请求能使用最新值
- [ ] `skipGlobalSystemPrompt: true` 参数能正确跳过全局注入
- [ ] 没有重复拼接的情况（全局 prompt 只出现一次）
