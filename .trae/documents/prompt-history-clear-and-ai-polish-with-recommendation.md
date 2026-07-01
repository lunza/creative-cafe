# 提示词管理：清空历史记录 + AI 润色带模板推荐

## 概要

在提示词管理模块实现两项功能：

1. **清空历史记录按钮**：在 `PromptHistory` 抽屉中添加视觉清晰的"清空历史记录"按钮，带二次确认机制，仅清空当前模块的历史记录。
2. **AI 润色升级**：升级现有 `prompt:optimize` 通道，让 AI 自动接收「原始提示词 + 当前任务类型（产品模块）+ 19 种提示词工程框架（来自 `docs/提示词工程.md`）」组合请求，动态推荐最匹配的框架并返回润色后的内容、推荐理由、优化点说明，确保过程可解释、可追溯。

---

## 当前状态分析

### 历史记录功能现状
- **存储**：JSON 文件 `userData/data/prompt-templates-history.json`，内存中为 `Map<moduleId, PromptHistoryRecord[]>`（[promptTemplateService.ts:35](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts#L35)）
- **现有 API**：仅 `getHistory(moduleId)`、`rollback(moduleId, version, modifiedBy)`，**无任何清空 API**（服务层、IPC、preload、store 均无）
- **UI**：[PromptHistory.tsx](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptHistory.tsx) 渲染在 antd `Drawer`（宽 560）内，包含日期/修改人筛选 + Timeline 视图，**无清空按钮**
- **参考模式**：写作模块的 `writing:clearAIGenerationHistory`（[writingProjectHandlers.ts:270-281](file:///d:/AI/creative-cafe/src/main/ipc/handlers/writing/writingProjectHandlers.ts#L270-L281)）+ `Popconfirm` + `Button danger`（[AIGenerationHistoryModal.tsx:71-80](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/AIGenerationHistoryModal.tsx#L71-L80)）是干净的参考实现

### AI 润色现状
- **现有通道**：`prompt:optimize` → `service.optimizePrompt(content, framework)` → `aiService.streamChatAPI`（[promptTemplateService.ts:403-447](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts#L403-L447)）
- **现有签名**：`optimizePrompt(content: string, framework: string): Promise<string>` —— 仅返回润色后文本字符串，**无推荐、无理由**
- **现有系统提示词**：`getFrameworkSpec(framework)`（[promptTemplateService.ts:452-533](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts#L452-L533)）明确指示 AI "只输出优化后的提示词正文，不输出任何解释说明" —— 与新需求冲突
- **现有 UI**：[PromptEditor.tsx:81-104](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptEditor.tsx#L81-L104) 的 `handleOptimize` + [PromptEditor.tsx:223-259](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptEditor.tsx#L223-L259) 的对比 Modal（左右对比原文/优化文，放弃/接受按钮）
- **任务类型**：当前 3 个产品模块（生成/翻译/润色，[PromptManagement.tsx:37-46](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptManagement.tsx#L37-L46)），用户强调未来会扩展更多任务类型，**不能硬编码这 3 个**

### 文档分析
- `docs/提示词工程.md` 定义的是 **19 种提示词工程框架**（APE/BROKE/CHAT/CRISPE/CARE/COAST/CREATE/RACE/RISE/ROSES/RTF/SAGE/SCOPE/SPA/TAG/TRACE/LangGPT/Google 最佳实践/ICIO），**不是产品分类**
- 每个框架包含元素定义（如 CHAT = 角色/背景/目标/任务）
- 代码中 `PromptFramework` 类型（[promptTemplate.types.ts:2](file:///d:/AI/creative-cafe/src/shared/types/promptTemplate.types.ts#L2)）仅使用其中 5 种：`'CHAT' | 'BROKE' | 'ICIO' | 'CRISPE' | 'CUSTOM'`

---

## 决策与假设

### 关键决策（基于用户澄清）
1. **推荐模板库** = 19 种提示词工程框架（来自文档）。AI 接收「当前任务类型（产品模块）+ 原始提示词 + 19 种框架候选」组合，推荐最匹配的框架。任务类型作为输入上下文传递（不硬编码），未来扩展模块无需改 AI 逻辑。
2. **API 策略** = 升级现有 `prompt:optimize` 通道（破坏性变更），返回结构化对象。同步修改 `PromptEditor.tsx` 的对比弹窗。
3. **清空范围** = 仅清空当前模块历史（与 `moduleId` 抽屉上下文一致）。

### 假设
- AI 模型能稳定输出 JSON 格式（采用 `streamChatAPI` 收集完整内容后 `JSON.parse`，失败时降级为纯文本展示并提示错误）
- 19 种框架的定义文本将作为系统提示词的一部分内嵌（不依赖文档文件运行时读取，避免 IO 依赖）
- 现有 `optimizePrompt` 的调用方仅 `PromptEditor.tsx` 一处（已通过探索确认）

---

## 实施变更

### 任务 1：清空历史记录功能

#### 1.1 服务层 — `promptTemplateService.ts`
在 `rollback` 方法后（约 [L280](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts#L280) 附近）新增：

```typescript
clearHistory(moduleId: string): boolean {
  if (!this.history.has(moduleId)) {
    return false;
  }
  this.history.delete(moduleId);
  this.persistHistory();
  return true;
}
```

`persistHistory()` 已存在（用于 rollback 后保存），直接复用。

#### 1.2 IPC 处理器 — `promptHandlers.ts`
在 `prompt:rollback` 块后（约 [L75](file:///d:/AI/creative-cafe/src/main/ipc/handlers/promptHandlers.ts#L75)）新增 `prompt:clearHistory` 处理器，镜像 `writing:clearAIGenerationHistory` 模式：

```typescript
ipcMain.handle('prompt:clearHistory', async (_event, moduleId: string) => {
  try {
    const ok = service.clearHistory(moduleId);
    if (!ok) {
      return { success: false, error: '未找到该模块的历史记录' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});
```

#### 1.3 Preload 绑定 — `preload.ts`
在 `prompt` 命名空间（[L474-487](file:///d:/AI/creative-cafe/src/main/preload.ts#L474-L487)）新增：

```typescript
clearHistory: (moduleId: string) => ipcRenderer.invoke('prompt:clearHistory', moduleId),
```

#### 1.4 Store — `promptStore.ts`
在 `rollback` action 后新增 `clearHistory` action（镜像 [L108](file:///d:/AI/creative-cafe/src/renderer/stores/promptStore.ts#L108) 附近的 `rollback` 模式）：

```typescript
clearHistory: async (moduleId) => {
  const result = await window.electronAPI.prompt.clearHistory(moduleId);
  return result;
},
```

#### 1.5 UI — `PromptHistory.tsx`
在筛选区 `Space`（[L169](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptHistory.tsx#L169) 附近）或 Drawer 的 `extra` 属性中添加：

```tsx
<Popconfirm
  title="清空历史记录"
  description={`确定要清空「${moduleId}」的所有历史记录吗？此操作不可恢复。`}
  onConfirm={handleClearHistory}
  okText="确定清空"
  okButtonProps={{ danger: true }}
  cancelText="取消"
  placement="topRight"
>
  <Button danger icon={<DeleteOutlined />} size="small">
    清空历史记录
  </Button>
</Popconfirm>
```

新增 `handleClearHistory` 处理函数（镜像 [AIGenerationHistoryModal.tsx:46-58](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/AIGenerationHistoryModal.tsx#L46-L58)）：

```typescript
const handleClearHistory = async () => {
  try {
    const result = await window.electronAPI.prompt.clearHistory(moduleId);
    if (result.success) {
      message.success('历史记录已清空');
      setHistory([]);
      onClose(); // 清空后关闭抽屉（无内容可看）
    } else {
      message.error(result.error || '清空失败');
    }
  } catch (err) {
    message.error('清空历史记录失败');
  }
};
```

**视觉清晰性**：使用红色 `Button danger` + `DeleteOutlined` 图标 + `Popconfirm` 二次确认 + 描述文案明确"不可恢复"，确保易于识别且防误操作。

---

### 任务 2：AI 润色升级（带框架推荐 + 理由）

#### 2.1 类型定义 — `promptTemplate.types.ts`
新增润色结果类型（在 [L80](file:///d:/AI/creative-cafe/src/shared/types/promptTemplate.types.ts#L80) 文件末尾附近）：

```typescript
export interface PromptPolishResult {
  recommendedFramework: string;       // 推荐的框架名，如 "CHAT"
  frameworkReasoning: string;         // 选择该框架的详细理由
  polishedContent: string;            // 润色后的提示词内容
  optimizationPoints: string[];       // 具体优化点列表
}

export interface PromptPolishRequest {
  content: string;                    // 原始提示词
  framework: string;                  // 当前模板使用的框架（参考用）
  moduleId: string;                   // 当前任务类型（产品模块 ID）
  taskDescription?: string;           // 任务描述（可选，来自 MODULE_GROUPS）
}
```

#### 2.2 服务层 — `promptTemplateService.ts`

**步骤 A：新增 19 框架定义常量**

在 `getFrameworkSpec` 方法后（约 [L533](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts#L533)）新增 `getAllFrameworkSpecs()` 方法，返回 19 种框架的完整定义（元素名 + 简要说明）。内容来源于 `docs/提示词工程.md`，硬编码为常量数组，避免运行时读文件。

```typescript
private getAllFrameworkSpecs(): Array<{ name: string; elements: string; description: string }> {
  return [
    { name: 'APE', elements: '行动/目的/期望', description: '...' },
    { name: 'BROKE', elements: '背景/角色/目标/关键结果/演变', description: '...' },
    { name: 'CHAT', elements: '角色/背景/目标/任务', description: '...' },
    // ... 其余 16 种
  ];
}
```

**步骤 B：升级 `optimizePrompt` 方法**

修改 [L403-447](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts#L403-L447) 的 `optimizePrompt`，新签名：

```typescript
async optimizePrompt(request: PromptPolishRequest): Promise<PromptPolishResult> {
  const config = await aiService.getConfig();
  const engineConfig = await aiService.getEngineConfig();
  if (!config.baseUrl) throw new Error('AI 服务地址未配置，请在设置中配置 AI 引擎');
  if (!config.model) throw new Error('AI 模型名称未配置，请在设置中配置 AI 引擎');

  const frameworkCandidates = this.getAllFrameworkSpecs();
  const systemPrompt = this.buildPolishSystemPrompt(frameworkCandidates, request.moduleId, request.taskDescription);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.content },
  ];

  let fullContent = '';
  const result = await aiService.streamChatAPI(
    messages,
    { model: config.model, temperature: engineConfig.temperature, maxTokens: engineConfig.maxTokens, maxRetries: 2 },
    (chunk: string) => { fullContent += chunk; }
  );

  if (!result.content.trim()) throw new Error('AI 返回内容为空');

  // 解析 JSON（容错：去除可能的 markdown 代码块包裹）
  return this.parsePolishResult(result.content);
}
```

**步骤 C：新增 `buildPolishSystemPrompt` 方法**

构建系统提示词，结构为：角色定义 + 19 框架候选清单 + 当前任务上下文 + 输出格式要求（严格 JSON）。关键指令：
- "请根据用户提供的原始提示词和当前任务类型，从以下 19 种提示词工程框架中推荐最合适的一种"
- "结合原始提示词的内容特征和任务类型分析为什么该框架最匹配"
- "严格输出 JSON 格式，不要包含 markdown 代码块标记"
- JSON schema：`{ recommendedFramework, frameworkReasoning, polishedContent, optimizationPoints[] }`

**步骤 D：新增 `parsePolishResult` 方法**

```typescript
private parsePolishResult(raw: string): PromptPolishResult {
  // 去除可能的 ```json ... ``` 包裹
  const cleaned = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    // 字段校验 + 降级
    return {
      recommendedFramework: String(parsed.recommendedFramework || ''),
      frameworkReasoning: String(parsed.frameworkReasoning || ''),
      polishedContent: String(parsed.polishedContent || ''),
      optimizationPoints: Array.isArray(parsed.optimizationPoints)
        ? parsed.optimizationPoints.map(String)
        : [],
    };
  } catch {
    // JSON 解析失败时降级：把整段当作 polishedContent，其他字段留空
    return {
      recommendedFramework: '',
      frameworkReasoning: 'AI 返回格式异常，无法解析推荐理由',
      polishedContent: raw.trim(),
      optimizationPoints: [],
    };
  }
}
```

#### 2.3 IPC 处理器 — `promptHandlers.ts`
修改 `prompt:optimize` 处理器（[L110](file:///d:/AI/creative-cafe/src/main/ipc/handlers/promptHandlers.ts#L110)），签名升级为接收 `PromptPolishRequest` 对象：

```typescript
ipcMain.handle('prompt:optimize', async (_event, request: PromptPolishRequest) => {
  try {
    const data = await service.optimizePrompt(request);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});
```

#### 2.4 Preload 绑定 — `preload.ts`
修改 `optimize` 绑定（[L474-487](file:///d:/AI/creative-cafe/src/main/preload.ts#L474-L487) 范围内），参数从 `(content, framework)` 改为 `(request: PromptPolishRequest)`：

```typescript
optimize: (request: PromptPolishRequest) => ipcRenderer.invoke('prompt:optimize', request),
```

#### 2.5 UI — `PromptEditor.tsx`

**步骤 A：升级 `handleOptimize`**（[L81-104](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptEditor.tsx#L81-L104)）

需要收集 `moduleId` 和 `taskDescription` 上下文（从父组件 props 或 store 获取），构造 `PromptPolishRequest`：

```typescript
const handleOptimize = async () => {
  if (!part.content.trim()) {
    message.warning('请先输入提示词内容');
    return;
  }
  setOptimizing(true);
  try {
    const result = await window.electronAPI.prompt.optimize({
      content: part.content,
      framework: template.framework,
      moduleId: template.moduleId,
      taskDescription: moduleDescription, // 从 MODULE_GROUPS 查找
    });
    if (result.success && result.data) {
      setPolishResult(result.data);       // 新状态：PromptPolishResult | null
      setCompareVisible(true);
    } else {
      message.error(result.error || 'AI 润色失败');
    }
  } catch (err) {
    message.error('AI 润色请求失败');
  } finally {
    setOptimizing(false);
  }
};
```

**步骤 B：升级对比 Modal**（[L223-259](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptEditor.tsx#L223-L259)）

在原有左右对比（原文 vs 润色文）基础上，新增两个区块显示推荐信息：

```tsx
<Modal title="AI 润色结果" open={compareVisible} width={900} footer={...}>
  {/* 推荐框架 + 理由区块 */}
  <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <div>
        <Tag color="green" icon={<ThunderboltOutlined />}>推荐框架</Tag>
        <Text strong>{polishResult?.recommendedFramework || '未推荐'}</Text>
      </div>
      <div>
        <Text type="secondary">推荐理由：</Text>
        <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
          {polishResult?.frameworkReasoning}
        </Paragraph>
      </div>
      {polishResult?.optimizationPoints?.length > 0 && (
        <div>
          <Text type="secondary">优化点：</Text>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {polishResult.optimizationPoints.map((pt, i) => <li key={i}>{pt}</li>)}
          </ul>
        </div>
      )}
    </Space>
  </Card>

  {/* 原有左右对比区块 */}
  <Row gutter={16}>
    <Col span={12}>
      <Text type="secondary">原始提示词</Text>
      <pre style={...}>{part.content}</pre>
    </Col>
    <Col span={12}>
      <Text type="secondary">润色后</Text>
      <pre style={...}>{polishResult?.polishedContent}</pre>
    </Col>
  </Row>
</Modal>
```

**步骤 C：状态变量**

```typescript
const [polishResult, setPolishResult] = useState<PromptPolishResult | null>(null);
```

**步骤 D：接受/放弃按钮逻辑**

- "接受"：将 `polishResult.polishedContent` 写回 `part.content`（原逻辑）
- "放弃"：清空 `polishResult`，关闭 Modal（原逻辑）

#### 2.6 `MODULE_GROUPS` 查找辅助
在 `PromptEditor.tsx` 中需要根据 `template.moduleId` 查找任务描述。可从 `PromptManagement.tsx` 导出 `MODULE_GROUPS` 常量（[L37-46](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptManagement.tsx#L37-L46)），或通过 props 传入 `taskDescription`。推荐导出常量避免重复定义。

---

## 涉及文件清单

| # | 文件 | 变更类型 | 说明 |
|---|---|---|---|
| 1 | [promptTemplateService.ts](file:///d:/AI/creative-cafe/src/main/services/promptTemplateService.ts) | 修改 | 新增 `clearHistory`、`getAllFrameworkSpecs`、`buildPolishSystemPrompt`、`parsePolishResult`；升级 `optimizePrompt` 签名 |
| 2 | [promptHandlers.ts](file:///d:/AI/creative-cafe/src/main/ipc/handlers/promptHandlers.ts) | 修改 | 新增 `prompt:clearHistory`；升级 `prompt:optimize` |
| 3 | [preload.ts](file:///d:/AI/creative-cafe/src/main/preload.ts) | 修改 | 新增 `clearHistory` 绑定；升级 `optimize` 签名 |
| 4 | [promptStore.ts](file:///d:/AI/creative-cafe/src/renderer/stores/promptStore.ts) | 修改 | 新增 `clearHistory` action |
| 5 | [PromptHistory.tsx](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptHistory.tsx) | 修改 | 新增清空按钮 + Popconfirm + 处理函数 |
| 6 | [PromptEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptEditor.tsx) | 修改 | 升级 `handleOptimize` + 对比 Modal 显示推荐信息 |
| 7 | [promptTemplate.types.ts](file:///d:/AI/creative-cafe/src/shared/types/promptTemplate.types.ts) | 修改 | 新增 `PromptPolishResult`、`PromptPolishRequest` 类型 |
| 8 | [PromptManagement.tsx](file:///d:/AI/creative-cafe/src/renderer/components/PromptManagement/PromptManagement.tsx) | 修改 | 导出 `MODULE_GROUPS` 常量供 `PromptEditor` 使用 |

---

## 验证步骤

### 任务 1 验证（清空历史）
1. 启动应用，进入提示词管理，打开任一模块的历史记录抽屉
2. 确认"清空历史记录"按钮视觉清晰（红色 + 图标 + 文案）
3. 点击按钮 → 弹出 Popconfirm 二次确认，文案明确"不可恢复"
4. 点击"取消" → 历史记录不变
5. 点击"确定清空" → 历史记录清空，提示"历史记录已清空"，抽屉关闭
6. 重新打开历史记录抽屉 → 确认为空
7. 验证 `prompt-templates-history.json` 文件中该 moduleId 的记录已删除
8. 验证其他模块的历史记录未受影响

### 任务 2 验证（AI 润色升级）
1. 配置好 AI 引擎（设置页）
2. 进入提示词管理 → 任一模块 → 编辑某 editable part
3. 输入提示词内容，点击"AI 润色"按钮
4. 等待 AI 返回，对比 Modal 弹出
5. 验证 Modal 顶部显示：推荐框架名（绿色 Tag）+ 推荐理由（结合任务类型和原始提示词的分析）+ 优化点列表
6. 验证左右对比区块显示原文 vs 润色后内容
7. 点击"接受" → 润色内容写回编辑器
8. 点击"放弃" → Modal 关闭，内容不变
9. **容错测试**：若 AI 返回非 JSON（如纯文本），验证降级处理：润色内容字段显示原文，推荐理由显示"格式异常"提示
10. **任务类型上下文测试**：分别在"生成"、"翻译"、"润色"三个模块触发 AI 润色，验证 AI 推荐理由中提及当前任务类型

### TypeScript 编译验证
```bash
npx tsc --noEmit
```
确认无新增类型错误（基线 821 个错误，不应增加）。

### 单元测试
- 运行现有 `PromptTemplateService.test.ts`（351 行）确认未破坏现有用例
- 为 `clearHistory` 新增测试用例：清空存在的模块、清空不存在的模块、清空后其他模块不受影响
- 为 `parsePolishResult` 新增测试用例：正常 JSON、markdown 包裹 JSON、非法 JSON 降级

---

## 实施顺序

1. **任务 1（清空历史）** —— 独立、低风险，先完成
   - 1.1 服务层 → 1.2 IPC → 1.3 preload → 1.4 store → 1.5 UI → 验证
2. **任务 2（AI 润色升级）** —— 依赖类型定义，按依赖顺序
   - 2.1 类型 → 2.2 服务层（19 框架常量 + 系统提示词 + 解析） → 2.3 IPC → 2.4 preload → 2.6 MODULE_GROUPS 导出 → 2.5 UI → 验证
3. **统一验证**：tsc + 单元测试 + 手动 UI 回归
