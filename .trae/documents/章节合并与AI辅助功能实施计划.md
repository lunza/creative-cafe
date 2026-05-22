# 章节合并与AI辅助功能实施计划

## 目标
1. 开发章节合并功能，作为现有拆分功能的逆向操作
2. 为章节拆分和合并功能添加AI辅助生成能力
3. 确保功能稳定性和数据安全性

## 一、现状分析

### 现有功能
- **章节拆分**（已完成）：
  - 位置：`ContentWorkspace.tsx` 的 `handleConfirmSplit` 函数
  - 功能：将单个章节拆分为N个子章节，支持"按内容均分"和"仅创建空章节"两种模式
  - 索引生成：`baseIndex + (i+1) * 0.1`（如 1 → 1.1, 1.2, 1.3）
  
- **AI基础设施**（已完成）：
  - `OutlineGenerator.ts`：大纲生成
  - `ContentGenerator.ts`：章节内容生成
  - `PromptBuilder.ts`：提示词构建
  - `AiLogger.ts`：AI交互日志记录
  - `writingHandlers.ts`：IPC通信处理

### 需要新增的功能
1. **章节合并功能**：将多个章节合并为一个
2. **AI辅助章节拆分**：AI根据大纲智能建议拆分方案和生成子章节属性
3. **AI辅助章节合并**：AI根据大纲智能建议合并方案并生成合并后的章节属性
4. **AI生成历史记录**：支持查看和回溯AI生成结果

---

## 二、详细实施步骤

### 阶段一：类型定义和接口设计

#### 步骤1.1：扩展 writing.types.ts
**文件**：`src/shared/types/writing.types.ts`

新增类型定义：

```typescript
// AI辅助拆分/合并相关类型
export interface AISplitSuggestion {
  splitCount: number;
  titles: string[];
  summaries: string[];
  targetWordCounts: number[];
  keyPlotPoints: string[][];
  confidence: number; // AI信心度 0-1
  rawResponse?: string; // 原始AI响应
}

export interface AIMergeSuggestion {
  mergedTitle: string;
  mergedSummary: string;
  mergedTargetWordCount: number;
  mergedKeyPlotPoints: string[];
  chapterIndices: number[]; // 被合并的章节索引
  confidence: number;
  rawResponse?: string;
}

export interface AIGenerationHistory {
  id: string;
  type: 'split' | 'merge';
  timestamp: number;
  sourceChapterIndices: number[];
  suggestion: AISplitSuggestion | AIMergeSuggestion;
  isAccepted: boolean;
}

// 扩展 WritingProject 类型
export interface WritingProject {
  // ... 现有字段
  aiGenerationHistory?: AIGenerationHistory[]; // AI生成历史记录
}
```

#### 步骤1.2：扩展 writing.constants.ts
**文件**：`src/shared/constants/writing.constants.ts`

新增常量：

```typescript
export const MAX_AI_SUGGESTION_HISTORY = 20; // 最多保存20条AI生成历史
export const AI_SPLIT_TIMEOUT = 30000; // AI拆分请求超时 30秒
export const AI_MERGE_TIMEOUT = 30000; // AI合并请求超时 30秒
```

---

### 阶段二：AI提示词和生成逻辑

#### 步骤2.1：扩展 PromptBuilder.ts
**文件**：`src/main/services/writing/PromptBuilder.ts`

新增方法：

```typescript
// AI辅助章节拆分提示词
buildSplitPrompt(
  chapterTitle: string,
  chapterSummary: string,
  chapterContent: string,
  splitCount: number,
  outline: GeneratedOutline
): string

// AI辅助章节合并提示词
buildMergePrompt(
  chapters: ChapterOutline[],
  chapterContents: Record<number, string>,
  outline: GeneratedOutline
): string

// 系统提示词（复用现有的小说类型和写作风格）
// 复用 buildSystemPrompt 方法
```

**提示词设计要点**：

**拆分提示词**：
```
你是一个专业的小说编辑助手。请根据以下章节信息，将其拆分为{splitCount}个子章节。

【作品大纲】
{outline}

【当前章节】
标题：{chapterTitle}
摘要：{chapterSummary}
内容：{chapterContent}

请以JSON格式返回拆分方案：
{
  "titles": ["子章节1标题", "子章节2标题", ...],
  "summaries": ["子章节1摘要", "子章节2摘要", ...],
  "targetWordCounts": [3000, 3000, ...],
  "keyPlotPoints": [["情节1", "情节2"], ["情节1"], ...]
}

要求：
1. 子章节标题要有连贯性和吸引力
2. 每个子章节的摘要要体现该部分的核心情节
3. 关键情节要点要具体明确
4. 保持故事逻辑的连贯性
```

**合并提示词**：
```
你是一个专业的小说编辑助手。请将以下{chapterCount}个章节合并为一个新章节。

【作品大纲】
{outline}

【待合并章节】
{chapters}

请以JSON格式返回合并方案：
{
  "title": "合并后的章节标题",
  "summary": "合并后的章节摘要",
  "targetWordCount": 6000,
  "keyPlotPoints": ["情节1", "情节2", ...]
}

要求：
1. 合并后的标题要能概括所有章节的核心内容
2. 摘要要整合所有章节的关键情节
3. 关键情节要点要按逻辑顺序排列
4. 保持故事连贯性
```

#### 步骤2.2：创建 AIAssistedChapterService.ts
**文件**：`src/main/services/writing/AIAssistedChapterService.ts`（新建）

核心功能：

```typescript
export class AIAssistedChapterService {
  // AI辅助拆分
  async suggestSplit(request: AISplitRequest): Promise<AISplitSuggestion>
  
  // AI辅助合并
  async suggestMerge(request: AIMergeRequest): Promise<AIMergeSuggestion>
  
  // 解析AI响应
  private parseSplitResponse(rawContent: string): AISplitSuggestion
  private parseMergeResponse(rawContent: string): AIMergeSuggestion
  
  // 构建AI请求
  private buildSplitRequest(request: AISplitRequest): ChatMessage[]
  private buildMergeRequest(request: AIMergeRequest): ChatMessage[]
  
  // 调用AI服务（复用OutlineGenerator的流式读取逻辑）
  private callAIService(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    abortSignal?: AbortSignal
  ): Promise<string>
}
```

#### 步骤2.3：扩展 writingHandlers.ts
**文件**：`src/main/ipc/handlers/writingHandlers.ts`

新增IPC处理器：

```typescript
// AI辅助拆分
ipcMain.handle('writing:aiSuggestSplit', async (event, request) => {
  try {
    const result = await aiAssistedChapterService.suggestSplit(request);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
});

// AI辅助合并
ipcMain.handle('writing:aiSuggestMerge', async (event, request) => {
  try {
    const result = await aiAssistedChapterService.suggestMerge(request);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
});

// 保存AI生成历史
ipcMain.handle('writing:saveAIGenerationHistory', async (event, history) => {
  // 保存到项目
});

// 加载AI生成历史
ipcMain.handle('writing:loadAIGenerationHistory', async (event, projectId) => {
  // 从项目加载
});
```

---

### 阶段三：UI组件开发

#### 步骤3.1：创建 ChapterSplitModal.tsx
**文件**：`src/renderer/components/Creative/WritingMode/ChapterSplitModal.tsx`（新建）

功能需求：
- 显示当前章节信息（标题、摘要、字数）
- 选择拆分数量（2-10个子章节）
- 选择拆分模式：
  - 按内容均分（现有功能）
  - AI智能拆分（新功能）
- AI智能拆分时：
  - 显示加载状态
  - 显示AI建议的子章节标题、摘要、目标字数、关键情节
  - 支持编辑AI生成的内容
  - 显示AI信心度
  - 支持查看历史AI生成记录
- 预览拆分效果
- 确认/取消操作

**组件结构**：
```tsx
<Modal title="分解章节">
  <Form>
    <Form.Item label="当前章节">
      <Descriptions>标题、摘要、字数</Descriptions>
    </Form.Item>
    <Form.Item label="拆分数量">
      <InputNumber min={2} max={10} />
    </Form.Item>
    <Form.Item label="拆分模式">
      <Radio.Group>
        <Radio value="content">按内容均分</Radio>
        <Radio value="ai">AI智能拆分</Radio>
      </Radio.Group>
    </Form.Item>
    
    {mode === 'ai' && (
      <Space>
        <Button onClick={handleAISplit} loading={isGenerating}>
          请求AI生成拆分方案
        </Button>
        <Button onClick={handleShowHistory}>
          查看历史记录
        </Button>
      </Space>
    )}
    
    {aiSuggestion && (
      <Collapse>
        {aiSuggestion.titles.map((title, i) => (
          <Panel header={title} key={i}>
            <Form>
              <Form.Item label="标题"><Input /></Form.Item>
              <Form.Item label="摘要"><TextArea /></Form.Item>
              <Form.Item label="目标字数"><InputNumber /></Form.Item>
              <Form.Item label="关键情节"><Select mode="tags" /></Form.Item>
            </Form>
          </Panel>
        ))}
      </Collapse>
    )}
  </Form>
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
    <Button onClick={onCancel}>取消</Button>
    <Button type="primary" onClick={onConfirm}>确认拆分</Button>
  </div>
</Modal>
```

#### 步骤3.2：创建 ChapterMergeModal.tsx
**文件**：`src/renderer/components/Creative/WritingMode/ChapterMergeModal.tsx`（新建）

功能需求：
- 多选章节列表（支持拖拽排序）
- 显示选中章节的信息（标题、摘要、字数、状态）
- 合并模式选择：
  - 简单合并（仅拼接内容）
  - AI智能合并（新功能）
- AI智能合并时：
  - 显示加载状态
  - 显示AI建议的合并后标题、摘要、目标字数、关键情节
  - 支持编辑AI生成的内容
  - 显示AI信心度
  - 支持查看历史AI生成记录
- 预览合并效果
- 确认/取消操作

**组件结构**：
```tsx
<Modal title="合并章节">
  <Form>
    <Form.Item label="选择待合并章节">
      <Select mode="multiple" optionLabelProp="title">
        {outline.chapters.map(ch => (
          <Option key={ch.index} value={ch.index} title={ch.title}>
            <div>
              <div>{ch.title}</div>
              <Text type="secondary">{ch.summary?.substring(0, 50)}...</Text>
            </div>
          </Option>
        ))}
      </Select>
    </Form.Item>
    
    {selectedChapters.length > 0 && (
      <div>
        <Text strong>已选择 {selectedChapters.length} 个章节：</Text>
        <List size="small">
          {selectedChapters.map(ch => (
            <List.Item>{ch.title} ({ch.wordCount}字)</List.Item>
          ))}
        </List>
      </div>
    )}
    
    <Form.Item label="合并模式">
      <Radio.Group>
        <Radio value="simple">简单合并（拼接内容）</Radio>
        <Radio value="ai">AI智能合并</Radio>
      </Radio.Group>
    </Form.Item>
    
    {mode === 'ai' && (
      <Space>
        <Button onClick={handleAIMerge} loading={isGenerating}>
          请求AI生成合并方案
        </Button>
        <Button onClick={handleShowHistory}>
          查看历史记录
        </Button>
      </Space>
    )}
    
    {aiSuggestion && (
      <Form>
        <Form.Item label="合并后标题"><Input /></Form.Item>
        <Form.Item label="合并后摘要"><TextArea /></Form.Item>
        <Form.Item label="目标字数"><InputNumber /></Form.Item>
        <Form.Item label="关键情节"><Select mode="tags" /></Form.Item>
      </Form>
    )}
  </Form>
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
    <Button onClick={onCancel}>取消</Button>
    <Button type="primary" onClick={onConfirm} disabled={selectedChapters.length < 2}>
      确认合并
    </Button>
  </div>
</Modal>
```

#### 步骤3.3：创建 AIGenerationHistoryModal.tsx
**文件**：`src/renderer/components/Creative/WritingMode/AIGenerationHistoryModal.tsx`（新建）

功能需求：
- 显示AI生成历史记录列表
- 按时间倒序排列
- 显示记录类型（拆分/合并）、时间、是否采纳
- 点击可查看详细信息
- 支持回溯到某个历史方案
- 支持删除历史记录

**组件结构**：
```tsx
<Modal title="AI生成历史记录">
  <List
    dataSource={history}
    renderItem={(item) => (
      <List.Item actions={[<Button onClick={() => handleRestore(item)}>回溯</Button>]}>
        <List.Item.Meta
          avatar={item.type === 'split' ? <SplitOutlined /> : <MergeOutlined />}
          title={item.type === 'split' ? '章节拆分' : '章节合并'}
          description={
            <div>
              <div>{new Date(item.timestamp).toLocaleString()}</div>
              <div>状态：{item.isAccepted ? '已采纳' : '未采纳'}</div>
            </div>
          }
        />
      </List.Item>
    )}
  />
</Modal>
```

#### 步骤3.4：修改 ContentWorkspace.tsx
**文件**：`src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`

修改现有拆分按钮和逻辑：
- 将现有的 `handleSplitChapter` 改为打开 `ChapterSplitModal`
- 替换现有的拆分确认逻辑为新的 `ChapterSplitModal` 的 `onConfirm`
- 保留现有功能作为"按内容均分"模式

新增合并按钮和逻辑：
- 在操作栏添加"合并"按钮
- 点击打开 `ChapterMergeModal`
- 实现合并确认逻辑

**代码变更**：

```tsx
// 新增状态
const [showSplitModal, setShowSplitModal] = useState(false);
const [showMergeModal, setShowMergeModal] = useState(false);
const [showHistoryModal, setShowHistoryModal] = useState(false);
const [aiSplitSuggestion, setAISplitSuggestion] = useState<AISplitSuggestion | null>(null);
const [aiMergeSuggestion, setAIMergeSuggestion] = useState<AIMergeSuggestion | null>(null);
const [aiGenerationHistory, setAIGenerationHistory] = useState<AIGenerationHistory[]>([]);
const [isGeneratingAI, setIsGeneratingAI] = useState(false);

// 修改拆分处理
const handleSplitChapter = useCallback(() => {
  setShowSplitModal(true);
  setAISplitSuggestion(null);
}, []);

// 新增AI拆分处理
const handleAISplit = useCallback(async () => {
  if (!outline) return;
  const currentChapter = outline.chapters[selectedChapterIndex];
  if (!currentChapter) return;
  
  setIsGeneratingAI(true);
  try {
    const result = await window.electronAPI?.writing.aiSuggestSplit({
      chapterTitle: currentChapter.title,
      chapterSummary: currentChapter.summary,
      chapterContent: chapterContents[currentChapter.index] || '',
      splitCount,
      outline
    });
    
    if (result.success) {
      setAISplitSuggestion(result.data);
    } else {
      message.error(result.error?.message || 'AI拆分失败');
    }
  } catch (error) {
    message.error('AI拆分请求失败');
  } finally {
    setIsGeneratingAI(false);
  }
}, [outline, selectedChapterIndex, chapterContents, splitCount]);

// 新增合并处理
const handleMergeChapters = useCallback(() => {
  setShowMergeModal(true);
  setAIMergeSuggestion(null);
}, []);

const handleAIMerge = useCallback(async (selectedIndices: number[]) => {
  if (!outline) return;
  
  setIsGeneratingAI(true);
  try {
    const selectedChapters = outline.chapters.filter(ch => selectedIndices.includes(ch.index));
    const result = await window.electronAPI?.writing.aiSuggestMerge({
      chapters: selectedChapters,
      chapterContents,
      outline
    });
    
    if (result.success) {
      setAIMergeSuggestion(result.data);
    } else {
      message.error(result.error?.message || 'AI合并失败');
    }
  } catch (error) {
    message.error('AI合并请求失败');
  } finally {
    setIsGeneratingAI(false);
  }
}, [outline, chapterContents]);

// 新增按钮
<Button
  icon={<MergeCellsOutlined />}
  onClick={handleMergeChapters}
  disabled={outline.chapters.length < 2}
>
  合并
</Button>
```

#### 步骤3.5：修改 ManualOutlineEditor.tsx
**文件**：`src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx`

修改现有的合并按钮：
- 当前的 `mergeChapters` 函数是简单合并（拼接内容）
- 保留作为"简单合并"模式
- 添加AI辅助合并的入口

新增多选功能：
- 支持在树形结构中选择多个章节
- 添加多选模式切换按钮
- 选中后显示合并按钮

---

### 阶段四：数据持久化和状态管理

#### 步骤4.1：扩展 WritingStorageService.ts
**文件**：`src/main/services/WritingStorageService.ts`

新增方法：

```typescript
// 保存AI生成历史
async saveAIGenerationHistory(
  projectId: string,
  history: AIGenerationHistory
): Promise<boolean>

// 加载AI生成历史
async loadAIGenerationHistory(projectId: string): Promise<AIGenerationHistory[]>

// 更新项目AI历史
async updateProjectAIGenerationHistory(
  projectId: string,
  history: AIGenerationHistory[]
): Promise<boolean>
```

#### 步骤4.2：扩展 writingProjectStore.ts
**文件**：`src/renderer/stores/writingProjectStore.ts`

新增状态和方法：

```typescript
interface WritingProjectState {
  // ... 现有字段
  aiGenerationHistory: AIGenerationHistory[];
}

interface WritingProjectActions {
  // ... 现有方法
  addAIGenerationHistory: (history: AIGenerationHistory) => void;
  getAIGenerationHistory: () => AIGenerationHistory[];
  clearAIGenerationHistory: () => void;
}
```

---

### 阶段五：异常处理和性能优化

#### 步骤5.1：异常处理机制
**文件**：`src/main/services/writing/AIAssistedChapterService.ts`

实现：

```typescript
// 超时控制
const timeoutSignal = AbortSignal.timeout(AI_SPLIT_TIMEOUT);

// 重试机制（最多2次）
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries) throw error;
      console.log(`[AIAssistedChapter] Retry ${i + 1}/${maxRetries}`);
      await sleep(1000 * (i + 1)); // 递增延迟
    }
  }
}

// AI服务不可用处理
if (!baseUrl || !apiKey) {
  throw new Error('AI服务未配置，请在设置中配置AI服务');
}

// 响应解析失败
if (!rawContent) {
  throw new Error('AI返回内容为空');
}

// JSON解析失败
try {
  return JSON.parse(rawContent);
} catch {
  throw new Error('AI返回的内容格式不正确，请重试');
}
```

#### 步骤5.2：性能优化
- 使用流式响应显示AI生成进度
- 添加加载状态指示器
- 缓存AI请求结果（相同请求10分钟内不重复调用）
- 限制AI生成历史记录数量（最多20条）

---

### 阶段六：测试

#### 步骤6.1：单元测试
**文件**：`src/main/services/writing/__tests__/AIAssistedChapterService.test.ts`

测试用例：
1. AI拆分建议生成
2. AI合并建议生成
3. AI响应解析
4. 超时处理
5. 重试机制
6. 异常处理

#### 步骤6.2：集成测试
**文件**：`src/test/integration/ai-assisted-chapter.test.ts`

测试用例：
1. 完整的拆分流程（从UI到AI到保存）
2. 完整的合并流程
3. AI生成历史保存和加载
4. 多个AI请求并发处理

---

## 三、实施顺序和时间线

### 第1阶段：类型定义和接口设计（步骤1.1-1.2）
- 扩展 writing.types.ts
- 扩展 writing.constants.ts
- 预计：30分钟

### 第2阶段：AI提示词和生成逻辑（步骤2.1-2.3）
- 扩展 PromptBuilder.ts
- 创建 AIAssistedChapterService.ts
- 扩展 writingHandlers.ts
- 预计：2小时

### 第3阶段：UI组件开发（步骤3.1-3.5）
- 创建 ChapterSplitModal.tsx
- 创建 ChapterMergeModal.tsx
- 创建 AIGenerationHistoryModal.tsx
- 修改 ContentWorkspace.tsx
- 修改 ManualOutlineEditor.tsx
- 预计：3小时

### 第4阶段：数据持久化和状态管理（步骤4.1-4.2）
- 扩展 WritingStorageService.ts
- 扩展 writingProjectStore.ts
- 预计：1小时

### 第5阶段：异常处理和性能优化（步骤5.1-5.2）
- 实现异常处理机制
- 实现性能优化
- 预计：1小时

### 第6阶段：测试（步骤6.1-6.2）
- 编写单元测试
- 编写集成测试
- 预计：2小时

**总计**：约10小时

---

## 四、风险评估

### 高风险
1. **AI响应解析失败**：AI可能返回不符合预期的JSON格式
   - 缓解措施：实现多重解析策略和错误修复逻辑（参考OutlineGenerator的JSON修复策略）

2. **合并后数据丢失**：合并多个章节时可能丢失内容或元数据
   - 缓解措施：合并前创建备份，支持撤销操作

### 中风险
3. **UI复杂度增加**：多个模态框可能增加用户使用复杂度
   - 缓解措施：设计清晰的用户引导流程，添加帮助提示

4. **AI历史记录存储膨胀**：大量历史记录可能影响性能
   - 缓解措施：限制历史记录数量，定期清理旧记录

### 低风险
5. **流式响应中断**：网络不稳定可能导致AI响应中断
   - 缓解措施：实现重试机制和超时控制

---

## 五、技术决策

### 决策1：AI调用方式
- **选项A**：复用OutlineGenerator的流式响应逻辑
- **选项B**：创建独立的AI服务调用
- **选择**：选项A（复用现有逻辑，减少重复代码）

### 决策2：AI生成结果处理
- **选项A**：AI直接生成章节数据并保存
- **选项B**：AI生成建议，用户审核后保存
- **选择**：选项B（保留用户控制权，确保数据质量）

### 决策3：合并后章节索引
- **选项A**：使用第一个章节的索引
- **选项B**：使用新的连续索引
- **选择**：选项B（保持索引连续性和一致性）

---

## 六、文件变更清单

### 新增文件
1. `src/main/services/writing/AIAssistedChapterService.ts`
2. `src/renderer/components/Creative/WritingMode/ChapterSplitModal.tsx`
3. `src/renderer/components/Creative/WritingMode/ChapterMergeModal.tsx`
4. `src/renderer/components/Creative/WritingMode/AIGenerationHistoryModal.tsx`
5. `src/main/services/writing/__tests__/AIAssistedChapterService.test.ts`
6. `src/test/integration/ai-assisted-chapter.test.ts`

### 修改文件
1. `src/shared/types/writing.types.ts`
2. `src/shared/constants/writing.constants.ts`
3. `src/main/services/writing/PromptBuilder.ts`
4. `src/main/ipc/handlers/writingHandlers.ts`
5. `src/main/services/WritingStorageService.ts`
6. `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`
7. `src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx`
8. `src/renderer/stores/writingProjectStore.ts`

---

## 七、验收标准

### 功能验收
- [ ] 章节拆分支持AI智能拆分模式
- [ ] 章节合并支持简单合并和AI智能合并两种模式
- [ ] AI生成结果支持编辑和调整
- [ ] AI生成历史记录支持查看、回溯和删除
- [ ] 合并后章节内容完整，无数据丢失
- [ ] 拆分/合并后章节索引正确重新编号

### 质量验收
- [ ] TypeScript编译无错误
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] AI服务不可用时有明确的错误提示
- [ ] 超时和重试机制正常工作
- [ ] 无内存泄漏

### 性能验收
- [ ] AI请求响应时间 < 30秒
- [ ] UI响应流畅，无明显卡顿
- [ ] AI生成历史记录加载时间 < 1秒
