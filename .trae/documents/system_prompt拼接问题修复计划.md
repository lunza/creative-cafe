# System Prompt 拼接问题修复计划

## 问题描述

AI生成条目功能（世界书AI生成）的system提示词开头未正确拼接设置功能中的系统提示词（system_prompt），导致全局system_prompt配置未被应用。

## 问题分析结果

### 1. 涉及AI请求的功能模块梳理

| 模块 | 文件 | system_prompt拼接状态 | 问题 |
|------|------|---------------------|------|
| **角色卡管理-翻译** | `CharacterManager.tsx` L630-633 | ✅ 已拼接 | 无 |
| **角色卡管理-生成** | `CharacterManager.tsx` L808-811 | ✅ 已拼接 | 无 |
| **角色卡管理-润色** | `CharacterManager.tsx` L953-956 | ✅ 已拼接 | 无 |
| **Markdown编辑器AI工具** | `MarkdownAITools.tsx` L404-410 | ✅ 已拼接 | 无 |
| **角色对话** | `CharacterDialogueChat.hooks.ts` + `PromptBuilder.ts` | ❌ 未拼接 | 全局system_prompt未被注入 |
| **世界书AI生成** | `WorldBookEditor.tsx` L223-229 | ❌ 未拼接 | 全局system_prompt未被注入 |

### 2. 问题根源

#### 问题模块1：世界书AI生成（`WorldBookEditor.tsx`）
- 直接使用 `template.systemPrompt` 作为 system message
- 未读取 `activeEngine.system_prompt`
- 未进行任何拼接处理

#### 问题模块2：角色对话（`CharacterDialogueChat.hooks.ts` + `PromptBuilder.ts`）
- `PromptBuilder.ts` 的 `buildSystemPrompt` 函数只构建角色相关的提示词
- 未包含全局 `system_prompt` 的拼接逻辑
- 全局 `system_prompt` 存储在 `activeEngine.system_prompt` 中，但在发送AI请求时未将其与角色提示词拼接

### 3. 代码规律分析

**已正确拼接的模块遵循的模式：**
```typescript
let finalSystemPrompt = taskSpecificPrompt;
if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
  finalSystemPrompt = activeEngine.system_prompt + '\n\n' + taskSpecificPrompt;
}
```

**缺失拼接的模块：**
- 直接传递 task-specific prompt，未检查或拼接 `activeEngine.system_prompt`

## 解决方案评估

### 方案一：在各功能模块中分别进行system_prompt拼接

**优点：**
- 最小改动，只修复问题模块
- 不影响已正确工作的模块
- 风险低，易于测试和回滚

**缺点：**
- 代码重复，多个模块都有相似的拼接逻辑
- 维护成本较高，新增模块需手动添加拼接逻辑
- 容易遗漏或出错

### 方案二：在aiHandlers统一处理层对所有AI发出的system请求进行集中拼接

**优点：**
- 统一处理，避免遗漏
- 代码集中，易于维护
- 新增功能自动生效

**缺点：**
- 改动范围广，可能影响所有AI请求
- aiHandlers.ts是底层IPC通信层，不持有engine配置信息
- 需要在请求传递时携带engine的system_prompt，改动侵入性大
- 可能破坏现有已正确拼接的逻辑（导致双重拼接）

## 推荐方案

**选择方案一（各模块分别拼接）**

### 理由：
1. **可行性**：方案二在当前架构下不可行，因为：
   - `aiHandlers.ts` 是底层IPC转发层，只接收HTTP请求配置（URL/headers/body）
   - 它不持有 `AIEngine` 对象，无法获取 `system_prompt`
   - 要实现方案二需要重构整个AI请求的传递链路，改动巨大

2. **风险控制**：系统已有3个模块正确实现了拼接逻辑，说明此模式稳定可靠

3. **代码清晰性**：每个模块的system_prompt拼接逻辑明确，易于理解和调试

## 具体实施步骤

### 第一步：修复世界书AI生成（WorldBookEditor.tsx）

**文件：** `g:\AI\creative-cafe\src\renderer\components\Creative\WorldBookEditor.tsx`

**修改位置：** 第222-237行（handleGenerate函数中的请求构建部分）

**修改内容：**
在构建 `requestBody` 前，添加system_prompt拼接逻辑：
```typescript
// 拼接全局system_prompt
let finalSystemPrompt = template.systemPrompt;
if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
  finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + template.systemPrompt;
}
```

然后将 `requestBody` 中的 `template.systemPrompt` 替换为 `finalSystemPrompt`

### 第二步：修复角色对话system_prompt拼接（CharacterDialogueChat.hooks.ts）

**文件：** `g:\AI\creative-cafe\src\renderer\components\Character\CharacterDialogueChat\CharacterDialogueChat.hooks.ts`

**修改位置：** `requestAIResponse` 回调中构建AI引擎配置部分（约第475行附近）

**修改内容：**
在获取 `engineConfigWithParams` 后，在构建发送给ChatEngine的messages时，需要将 `activeEngine.system_prompt` 拼接到 `finalSystemPrompt` 前面：

```typescript
// 拼接全局system_prompt到角色提示词
const globalSystemPrompt = activeEngine.system_prompt?.trim();
const effectiveSystemPrompt = globalSystemPrompt 
  ? globalSystemPrompt + '\n\n' + finalSystemPrompt
  : finalSystemPrompt;
```

然后使用 `effectiveSystemPrompt` 替换原有的 `finalSystemPrompt` 构建messages。

### 第三步：清理重复拼接逻辑（如适用）

检查是否有任何模块存在双重拼接的情况（即模块内拼接了system_prompt，又在其他地方再次拼接），如有则清理。

### 第四步：验证修复

1. 测试世界书AI生成功能，确认全局system_prompt被正确应用
2. 测试角色对话功能，确认全局system_prompt被正确应用
3. 验证已有的翻译/润色/生成/Markdown AI工具功能不受影响
4. 检查是否有其他遗漏的AI交互场景

## 涉及文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `WorldBookEditor.tsx` | 修改 | 添加system_prompt拼接 |
| `CharacterDialogueChat.hooks.ts` | 修改 | 添加system_prompt拼接 |
| 技术文档 | 增量更新 | 记录修复过程 |
