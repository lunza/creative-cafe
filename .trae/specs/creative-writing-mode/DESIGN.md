# 创意中心——写作模式功能系统设计书

## 文档信息

| 项目 | 内容 |
|------|------|
| 产品名称 | Creative Cafe - 写作模式 |
| 文档版本 | v1.0 |
| 创建日期 | 2026-05-18 |
| 文档状态 | 评审中 |

---

## 一、总体架构设计

### 1.1 架构概述

写作模式功能采用 Electron 应用的三层架构（主进程、渲染进程、共享层），基于项目现有的技术栈进行扩展。整体架构遵循模块化和分层设计原则，确保功能的可维护性和可扩展性。

### 1.2 技术栈

| 层级 | 技术 | 版本/说明 |
|------|------|-----------|
| 桌面框架 | Electron | 项目现有版本 |
| 前端框架 | React 18 | + TypeScript |
| UI 组件库 | Ant Design | 项目现有版本 |
| 状态管理 | Zustand | 项目现有方案 |
| 构建工具 | Vite | 项目现有版本 |
| AI SDK | Vercel AI SDK | 通过 @ai-sdk/openai |
| Markdown 编辑器 | Milkdown | 项目现有 MarkdownEditor |
| IPC 通信 | Electron IPC | 主进程与渲染进程通信 |

### 1.3 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                     渲染进程 (Renderer)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 用户交互层 (UI Components)                                │ │
│  │ - WritingModeEntry.tsx (入口组件)                         │ │
│  │ - WritingProjectList.tsx (项目列表)                       │ │
│  │ - WritingConfigPanel.tsx (配置面板)                       │ │
│  │ - ResourceSelector.tsx (资源选择器)                       │ │
│  │ - OutlineEditor.tsx (大纲编辑器)                          │ │
│  │ - ContentGenerator.tsx (内容生成器)                       │ │
│  │ - ChapterNavigator.tsx (章节导航)                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 状态管理层 (Zustand Stores)                               │ │
│  │ - writingModeStore.ts (写作模式状态)                      │ │
│  │ - writingProjectStore.ts (项目状态)                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 服务层 (Renderer Services)                                │ │
│  │ - WritingPromptBuilder.ts (Prompt 构建器)                 │ │
│  │ - WritingContextManager.ts (上下文管理)                   │ │
│  │ - WritingExportService.ts (导出服务)                      │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬─────────────────────────────────┘
                              │ Electron IPC
┌─────────────────────────────┴─────────────────────────────────┐
│                     主进程 (Main)                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ IPC 处理层                                                │ │
│  │ - writingHandlers.ts (写作模式 IPC 处理器)                │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ AI 处理引擎                                               │ │
│  │ - WritingEngine.ts (写作引擎)                             │ │
│  │   - OutlineGenerator.ts (大纲生成器)                      │ │
│  │   - ContentGenerator.ts (内容生成器)                      │ │
│  │   - NovelTypeTemplates.ts (类型模板)                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 资源管理层                                                │ │
│  │ - WritingResourceManager.ts (资源管理器)                  │ │
│  │ - ContextRetriever.ts (上下文检索)                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 数据持久层                                                │ │
│  │ - WritingStorageService.ts (存储服务)                     │ │
│  │ - PathManager.ts (路径管理)                               │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬─────────────────────────────────┘
                              │
┌─────────────────────────────┴─────────────────────────────────┐
│                     共享层 (Shared)                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 类型定义                                                  │ │
│  │ - writing.types.ts (写作模式类型)                         │ │
│  │ - writing.constants.ts (常量定义)                         │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 模块依赖关系

```
                    ┌──────────────────┐
                    │  writing.types   │
                    │  (共享类型定义)    │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  UI 组件层   │ │  Zustand     │ │  主进程服务  │
    │              │ │  Stores      │ │              │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │                │                │
           │         ┌──────┴───────┐        │
           └────────►│  IPC 通信    │◄───────┘
                     └──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  AI 引擎     │ │  资源管理    │ │  数据存储    │
    └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 二、模块详细设计

### 2.1 用户交互层 (UI Components)

#### 2.1.1 模块文件结构

```
src/renderer/components/Creative/WritingMode/
├── WritingModeEntry.tsx          # 写作模式入口组件
├── WritingProjectList.tsx        # 项目列表页
├── WritingConfigPanel.tsx        # 创作配置页
│   ├── ResourceSelector.tsx      # 资源选择器
│   │   ├── WorldBookSelector.tsx # 世界书选择
│   │   └── CharacterSelector.tsx # 角色卡选择
│   └── ParameterForm.tsx         # 参数表单
├── OutlineEditor.tsx             # 大纲编辑器
├── ContentWorkspace.tsx          # 内容工作区
│   ├── ChapterNavigator.tsx      # 章节导航
│   ├── ContentGenerator.tsx      # 内容生成控制
│   └── ChapterEditor.tsx         # 章节编辑器
├── WritingProgressBar.tsx        # 进度条组件
├── WritingStatusIndicator.tsx    # 状态指示器
└── index.ts                      # 统一导出
```

#### 2.1.2 核心组件设计

**WritingModeEntry.tsx - 入口组件**

```typescript
// 职责：写作模式的入口，根据当前状态路由到不同子页面
// 状态流转：List -> Config -> Outline -> Content

interface WritingModeEntryProps {
  // 继承自 CreativeManager 的 props
}

// 内部状态
enum WritingModeView {
  PROJECT_LIST = 'project_list',      // 项目列表
  CONFIG = 'config',                  // 创作配置
  OUTLINE_GENERATING = 'outline_generating', // 大纲生成中
  OUTLINE_EDITING = 'outline_editing',       // 大纲编辑
  CONTENT_GENERATING = 'content_generating', // 内容生成中
  CONTENT_EDITING = 'content_editing'        // 内容编辑
}
```

**WritingConfigPanel.tsx - 配置面板**

```typescript
// 职责：收集创作资源配置和参数
// 包含两个主要区域：
// 1. 资源选择区：世界书、角色卡的多选器
// 2. 参数输入区：创意描述、小说类型、目标字数、章节数等

interface WritingConfigPanelProps {
  onConfirm: (config: WritingConfig) => void;
  onCancel: () => void;
  initialConfig?: Partial<WritingConfig>;
}
```

**OutlineEditor.tsx - 大纲编辑器**

```typescript
// 职责：展示和编辑 AI 生成的大纲
// 使用 Ant Design 的 Tree/Collapse 组件展示结构化大纲
// 支持内联编辑各层级的内容

interface OutlineEditorProps {
  outline: GeneratedOutline;
  onChange: (outline: GeneratedOutline) => void;
  onConfirm: () => void;
  onRegenerate: () => void;
}
```

**ContentWorkspace.tsx - 内容工作区**

```typescript
// 职责：内容生成和编辑的主工作区
// 包含章节导航、内容生成控制、Markdown 编辑器

interface ContentWorkspaceProps {
  outline: GeneratedOutline;
  project: WritingProject;
  onSave: (chapterIndex: number, content: string) => void;
}
```

### 2.2 状态管理层 (Zustand Stores)

#### 2.2.1 writingModeStore.ts

```typescript
interface WritingModeState {
  // 视图状态
  currentView: WritingModeView;
  
  // 配置状态
  config: WritingConfig | null;
  
  // 大纲状态
  outline: GeneratedOutline | null;
  isOutlineGenerating: boolean;
  
  // 内容生成状态
  currentChapterIndex: number;
  isContentGenerating: boolean;
  generationMode: GenerationMode; // 'single' | 'continuous'
  generatedContent: Map<number, string>; // chapterIndex -> content
  
  // 控制状态
  isPaused: boolean;
  abortController: AbortController | null;
  
  // 错误状态
  error: WritingError | null;
  
  // Actions
  setCurrentView: (view: WritingModeView) => void;
  setConfig: (config: WritingConfig) => void;
  startOutlineGeneration: () => void;
  setOutline: (outline: GeneratedOutline) => void;
  setOutlineGenerating: (generating: boolean) => void;
  startContentGeneration: (chapterIndex: number, mode: GenerationMode) => void;
  updateGeneratedContent: (chapterIndex: number, content: string) => void;
  pauseGeneration: () => void;
  resumeGeneration: () => void;
  stopGeneration: () => void;
  setError: (error: WritingError | null) => void;
  reset: () => void;
}
```

#### 2.2.2 writingProjectStore.ts

```typescript
interface WritingProjectState {
  projects: WritingProject[];
  currentProjectId: string | null;
  isLoading: boolean;
  
  // Actions
  loadProjects: () => Promise<void>;
  createProject: (config: WritingConfig) => string;
  updateProject: (id: string, updates: Partial<WritingProject>) => void;
  deleteProject: (id: string) => void;
  setCurrentProject: (id: string | null) => void;
  saveProject: () => Promise<void>;
  exportProject: (id: string, format: ExportFormat) => Promise<void>;
  
  // Getters
  getCurrentProject: () => WritingProject | null;
  getProjectById: (id: string) => WritingProject | null;
}

interface WritingProject {
  id: string;
  title: string;
  status: 'draft' | 'outlining' | 'writing' | 'completed';
  config: WritingConfig;
  outline: GeneratedOutline | null;
  chapters: {
    index: number;
    title: string;
    content: string;
    status: 'pending' | 'generating' | 'completed' | 'failed';
    wordCount: number;
    lastModified: number;
    versions?: {
      id: string;
      content: string;
      timestamp: number;
      note?: string;
    }[];
  }[];
  createdAt: number;
  updatedAt: number;
  metadata: {
    totalWordCount: number;
    completedChapters: number;
    generationSettings: {
      model: string;
      temperature: number;
    };
  };
}
```

### 2.3 资源管理模块

#### 2.3.1 WritingResourceManager.ts

```typescript
// 位置: src/main/services/WritingResourceManager.ts

class WritingResourceManager {
  // 加载选中的世界书内容
  async loadWorldBooks(worldBookIds: string[]): Promise<WorldBookContext[]>;
  
  // 加载选中的角色卡内容
  async loadCharacterCards(characterCardIds: string[]): Promise<CharacterCardContext[]>;
  
  // 根据当前内容动态检索相关世界书条目
  async retrieveRelevantContext(
    worldBookIds: string[],
    currentContent: string,
    options: RetrieveOptions
  ): Promise<ContextItem[]>;
  
  // 构建资源上下文摘要（用于 Prompt）
  buildResourceContextSummary(
    worldBooks: WorldBookContext[],
    characters: CharacterCardContext[]
  ): string;
}
```

#### 2.3.2 上下文检索策略

```typescript
interface ContextRetrievalStrategy {
  // 短期上下文：最近 2-3 章的完整内容
  getRecentChapters(chapters: Chapter[], count: number): string;
  
  // 中期上下文：所有章节摘要
  getAllChapterSummaries(outline: GeneratedOutline): string;
  
  // 长期上下文：角色信息和世界观设定
  getLongTermContext(project: WritingProject): string;
  
  // 动态检索：根据当前情节检索相关世界书条目
  async retrieveDynamicContext(
    currentContent: string,
    worldBookIds: string[]
  ): Promise<ContextItem[]>;
}
```

### 2.4 AI 处理引擎

#### 2.4.1 WritingEngine.ts

```typescript
// 位置: src/main/services/WritingEngine.ts

class WritingEngine {
  private outlineGenerator: OutlineGenerator;
  private contentGenerator: ContentGenerator;
  private promptBuilder: PromptBuilder;
  
  // 生成大纲
  async generateOutline(request: OutlineGenerationRequest): Promise<GeneratedOutline>;
  
  // 生成章节内容
  async generateChapterContent(
    request: ContentGenerationRequest,
    onStream: (chunk: string) => void
  ): Promise<GeneratedContent>;
  
  // 取消生成
  cancelGeneration(requestId: string): void;
}
```

#### 2.4.2 OutlineGenerator.ts

```typescript
// 位置: src/main/services/writing/OutlineGenerator.ts

class OutlineGenerator {
  // 构建大纲生成的 Prompt
  buildPrompt(request: OutlineGenerationRequest): ChatMessage[];
  
  // 执行生成
  async generate(
    messages: ChatMessage[],
    modelConfig: ModelConfig
  ): Promise<GeneratedOutline>;
  
  // 解析 AI 响应为结构化大纲
  parseOutlineResponse(response: string): GeneratedOutline;
}
```

#### 2.4.3 ContentGenerator.ts

```typescript
// 位置: src/main/services/writing/ContentGenerator.ts

class ContentGenerator {
  // 构建内容生成的 Prompt
  buildPrompt(request: ContentGenerationRequest): ChatMessage[];
  
  // 执行流式生成
  async generateStream(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    onStream: (chunk: string) => void,
    abortSignal: AbortSignal
  ): Promise<GeneratedContent>;
  
  // 构建连贯性约束
  buildContinuityConstraints(request: ContentGenerationRequest): string;
}
```

#### 2.4.4 PromptBuilder.ts

```typescript
// 位置: src/main/services/writing/PromptBuilder.ts

class PromptBuilder {
  // 构建系统提示
  buildSystemPrompt(type: NovelType, style: WritingStyle, perspective: NarrativePerspective): string;
  
  // 构建大纲生成 Prompt
  buildOutlinePrompt(
    creativeDescription: string,
    resources: WritingResourceConfig,
    parameters: WritingParameters
  ): string;
  
  // 构建内容生成 Prompt
  buildContentPrompt(
    chapterInfo: ChapterInfo,
    context: WritingContext,
    parameters: WritingParameters
  ): string;
}
```

#### 2.4.5 NovelTypeTemplates.ts

```typescript
// 位置: src/main/services/writing/NovelTypeTemplates.ts

// 各类型小说的创作范式模板
const NovelTypeTemplates: Record<NovelType, NovelTypeTemplate> = {
  web_novel: {
    name: '网文',
    systemPrompt: '你是一位专业的网络小说作家...',
    outlineStructure: [...],
    writingStyle: '节奏明快，每章设置悬念...',
    typicalChapterLength: 3000,
  },
  romance: {
    name: '言情',
    systemPrompt: '你是一位专业的言情小说作家...',
    outlineStructure: [...],
    writingStyle: '情感细腻，注重心理描写...',
    typicalChapterLength: 2500,
  },
  // ... 其他类型
};
```

### 2.5 数据持久层

#### 2.5.1 WritingStorageService.ts

```typescript
// 位置: src/main/services/WritingStorageService.ts

class WritingStorageService {
  // 获取写作项目存储路径
  getStoragePath(): string;
  
  // 保存项目
  async saveProject(project: WritingProject): Promise<boolean>;
  
  // 加载项目
  async loadProject(projectId: string): Promise<WritingProject | null>;
  
  // 加载所有项目
  async loadAllProjects(): Promise<WritingProject[]>;
  
  // 删除项目
  async deleteProject(projectId: string): Promise<boolean>;
  
  // 导出项目
  async exportProject(projectId: string, format: ExportFormat): Promise<string>;
  
  // 自动保存（增量保存章节内容）
  async autoSaveChapter(projectId: string, chapterIndex: number, content: string): Promise<void>;
}
```

---

## 三、核心业务流程图

### 3.1 大纲生成流程

```
用户确认配置
      │
      ▼
┌─────────────────┐
│  校验输入参数    │
└────────┬────────┘
         │ 校验通过
         ▼
┌─────────────────┐
│  加载选中的资源  │◄── 世界书内容、角色卡信息
│  (主进程)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  构建 Prompt    │◄── 系统提示 + 资源上下文 + 创作参数
│  (PromptBuilder)│     + 类型范式模板
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  调用 AI 生成   │◄── 流式请求
│  (AI Handler)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  解析响应        │◄── JSON 解析为 GeneratedOutline
│  (OutlineGen.)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  返回前端展示    │
└─────────────────┘
```

### 3.2 内容连续生成流程

```
用户确认大纲，启动连续生成
              │
              ▼
    ┌──────────────────────┐
    │ 初始化生成状态        │
    │ - currentChapter = 0 │
    │ - mode = continuous  │
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  是否还有未生成章节?  │──── 否 ────► 生成完成，保存项目
    └──────────┬───────────┘
               │ 是
               ▼
    ┌──────────────────────┐
    │ 准备章节上下文        │
    │ - 加载前序章节内容    │
    │ - 加载相关世界书      │
    │ - 加载角色信息        │
    │ - 构建连贯性约束      │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ 构建内容生成 Prompt   │
    │ - 系统提示 (类型范式) │
    │ - 大纲信息            │
    │ - 上下文              │
    │ - 当前章节概要        │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ 发起流式 AI 请求      │◄── 用户可随时暂停/停止
    └──────────┬───────────┘
               │
         ┌─────┴─────┐
         │           │
    生成完成      用户中断
         │           │
         ▼           ▼
    ┌────────┐  ┌─────────┐
    │自动保存│  │保留已生成│
    │章节内容│  │内容      │
    └───┬────┘  └────┬────┘
        │            │
        ▼            ▼
    ┌─────────────────────┐
    │ currentChapter++    │
    │ 返回循环开始         │
    └─────────────────────┘
```

### 3.3 上下文管理流程

```
生成第 N 章
      │
      ▼
┌──────────────────────────────────────┐
│            上下文分层加载               │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ 短期上下文 (完整内容)             │ │
│  │ - 第 N-1 章完整内容              │ │
│  │ - 第 N-2 章完整内容 (如存在)     │ │
│  │ - 第 N-3 章完整内容 (如存在)     │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ 中期上下文 (摘要)                 │ │
│  │ - 第 1 至 N-4 章摘要             │ │
│  │ - 第 N+1 至最后章 大纲           │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ 长期上下文 (关键信息)             │ │
│  │ - 主要角色档案                   │ │
│  │ - 世界观核心设定                  │ │
│  │ - 已埋设伏笔列表                  │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ 动态检索 (关键词/向量)            │ │
│  │ - 根据当前章节内容检索            │ │
│  │   相关世界书条目                 │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────┐
│         Token 预算分配                 │
│                                      │
│  总 Token 预算: maxTokens             │
│  - System Prompt:      ~500 tokens   │
│  - 短期上下文:         ~4000 tokens  │
│  - 中期上下文:         ~2000 tokens  │
│  - 长期上下文:         ~1500 tokens  │
│  - 动态检索:           ~1000 tokens  │
│  - 当前章节大纲:       ~500 tokens   │
│  - 生成预留:           ~4000 tokens  │
│  - 安全缓冲:           ~1000 tokens  │
│                                      │
│  若超出预算，按优先级压缩上下文         │
└──────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────┐
│         构建最终 Messages             │
│                                      │
│  Message[0]: System (系统提示)        │
│  Message[1]: User (资源上下文)        │
│  Message[2]: User (大纲信息)          │
│  Message[3]: User (上下文信息)        │
│  Message[4]: User (当前章节要求)      │
└──────────────────────────────────────┘
      │
      ▼
  发起 AI 生成请求
```

---

## 四、数据模型设计

### 4.1 核心数据模型

#### 4.1.1 WritingConfig (创作配置)

```typescript
interface WritingConfig {
  // 资源配置
  resources: {
    worldBookIds: string[];
    characterCardIds: string[];
    referenceMaterials?: ReferenceMaterial[];
  };
  
  // 创作参数
  parameters: {
    creativeDescription: string;
    novelType: NovelType;
    targetWordCount: number;
    chapterCount: number;
    narrativePerspective: NarrativePerspective;
    writingStyle?: WritingStyle;
    additionalRequirements?: string;
    forbiddenContent?: string[];
  };
  
  // AI 模型配置
  modelConfig: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

interface ReferenceMaterial {
  id: string;
  type: 'text' | 'file';
  content: string;
  name: string;
}
```

#### 4.1.2 WritingProject (创作项目)

```typescript
interface WritingProject {
  id: string;
  title: string;
  status: ProjectStatus;
  config: WritingConfig;
  
  // 大纲
  outline: GeneratedOutline | null;
  outlineHistory: {
    outline: GeneratedOutline;
    timestamp: number;
    note?: string;
  }[];
  
  // 章节
  chapters: Chapter[];
  
  // 时间戳
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
  
  // 元数据
  metadata: ProjectMetadata;
}

interface Chapter {
  index: number;
  title: string;
  outline: {
    summary: string;
    keyPlotPoints: string[];
    characters: string[];
    scenes: string[];
    suspensePoints?: string[];
    targetWordCount: number;
  };
  content: string;
  status: ChapterStatus;
  wordCount: number;
  
  // 版本历史
  versions: ChapterVersion[];
  
  // 生成信息
  generationInfo?: {
    model: string;
    temperature: number;
    tokensUsed: number;
    generationTime: number;
    generatedAt: number;
  };
  
  lastModified: number;
}

interface ChapterVersion {
  id: string;
  content: string;
  timestamp: number;
  note?: string;
  isAutoGenerated: boolean;
}

enum ProjectStatus {
  DRAFT = 'draft',              // 草稿（未完成配置）
  OUTLINING = 'outlining',      // 大纲阶段
  WRITING = 'writing',          // 创作中
  COMPLETED = 'completed'       // 已完成
}

enum ChapterStatus {
  PENDING = 'pending',          // 待生成
  GENERATING = 'generating',    // 生成中
  COMPLETED = 'completed',      // 已完成
  FAILED = 'failed'             // 生成失败
}

interface ProjectMetadata {
  totalWordCount: number;
  completedChapters: number;
  generationSettings: {
    model: string;
    temperature: number;
  };
  continuityInfo: {
    foreshadowing: string[];
    plotThreads: string[];
    characterDevelopment: Record<string, string>;
  };
}
```

### 4.2 存储数据结构

#### 4.2.1 项目存储格式 (JSON)

```json
{
  "version": "1.0",
  "projects": [
    {
      "id": "writing_project_1234567890",
      "title": "我的小说",
      "status": "writing",
      "config": { ... },
      "outline": { ... },
      "chapters": [
        {
          "index": 0,
          "title": "第一章 开端",
          "outline": { ... },
          "content": "# 第一章 开端\n\n正文内容...",
          "status": "completed",
          "wordCount": 3200,
          "versions": [ ... ],
          "generationInfo": { ... },
          "lastModified": 1716000000000
        }
      ],
      "createdAt": 1716000000000,
      "updatedAt": 1716000000000,
      "lastSavedAt": 1716000000000,
      "metadata": { ... }
    }
  ],
  "lastProjectId": "writing_project_1234567890"
}
```

#### 4.2.2 章节文件存储

```
userData/
└── writing-projects/
    ├── projects-index.json          # 项目索引
    └── [projectId]/
        ├── project.json             # 项目元数据
        ├── chapters/
        │   ├── chapter-0.md         # 第1章内容
        │   ├── chapter-1.md         # 第2章内容
        │   └── ...
        └── versions/
            ├── chapter-0-v1.md      # 第1章版本1
            ├── chapter-0-v2.md      # 第1章版本2
            └── ...
```

---

## 五、API 接口定义

### 5.1 IPC 接口

#### 5.1.1 项目管理接口

| 通道 | 方向 | 参数 | 返回值 | 说明 |
|------|------|------|--------|------|
| `writing:loadProjects` | R→M | 无 | `{ success: boolean; projects: WritingProject[] }` | 加载所有项目 |
| `writing:createProject` | R→M | `config: WritingConfig` | `{ success: boolean; projectId: string }` | 创建新项目 |
| `writing:saveProject` | R→M | `project: WritingProject` | `{ success: boolean }` | 保存项目 |
| `writing:deleteProject` | R→M | `projectId: string` | `{ success: boolean }` | 删除项目 |
| `writing:exportProject` | R→M | `projectId: string; format: ExportFormat` | `{ success: boolean; filePath?: string }` | 导出项目 |

#### 5.1.2 AI 生成接口

| 通道 | 方向 | 参数 | 返回值 | 说明 |
|------|------|------|--------|------|
| `writing:generateOutline` | R→M | `request: OutlineGenerationRequest` | `{ success: boolean; outline?: GeneratedOutline; error?: string }` | 生成大纲 |
| `writing:generateChapter` | R→M | `request: ContentGenerationRequest` | `{ success: boolean }` | 生成章节内容 (触发流式) |
| `writing:cancelGeneration` | R→M | `projectId: string` | `{ success: boolean }` | 取消生成 |

#### 5.1.3 流式事件

| 事件 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `writing:stream:chunk` | M→R | `{ projectId: string; chapterIndex: number; chunk: string }` | 流式内容片段 |
| `writing:stream:complete` | M→R | `{ projectId: string; chapterIndex: number; content: string; metadata: GenerationMetadata }` | 生成完成 |
| `writing:stream:error` | M→R | `{ projectId: string; chapterIndex: number; error: WritingError }` | 生成错误 |

### 5.2 渲染进程接口

#### 5.2.1 window.electronAPI.writing

```typescript
interface WritingAPI {
  // 项目管理
  loadProjects(): Promise<{ success: boolean; projects: WritingProject[] }>;
  createProject(config: WritingConfig): Promise<{ success: boolean; projectId: string }>;
  saveProject(project: WritingProject): Promise<{ success: boolean }>;
  deleteProject(projectId: string): Promise<{ success: boolean }>;
  exportProject(projectId: string, format: ExportFormat): Promise<{ success: boolean; filePath?: string }>;
  
  // AI 生成
  generateOutline(request: OutlineGenerationRequest): Promise<{ success: boolean; outline?: GeneratedOutline; error?: string }>;
  generateChapter(request: ContentGenerationRequest): Promise<{ success: boolean }>;
  cancelGeneration(projectId: string): Promise<{ success: boolean }>;
  
  // 事件监听
  onStreamChunk(callback: (data: StreamChunkData) => void): void;
  onStreamComplete(callback: (data: StreamCompleteData) => void): void;
  onStreamError(callback: (data: StreamErrorData) => void): void;
  offStreamChunk(callback: (data: StreamChunkData) => void): void;
  offStreamComplete(callback: (data: StreamCompleteData) => void): void;
  offStreamError(callback: (data: StreamErrorData) => void): void;
}
```

---

## 六、技术选型

### 6.1 核心技术选型

| 技术领域 | 选型 | 理由 |
|----------|------|------|
| 状态管理 | Zustand | 项目已有方案，轻量、类型友好 |
| UI 组件 | Ant Design | 项目已有方案，组件丰富 |
| Markdown 编辑 | Milkdown (通过 MarkdownEditor) | 项目已有，支持 AI 工具集成 |
| AI 通信 | Electron IPC + Fetch | 避免 CORS，项目已有实现 |
| 数据存储 | JSON 文件 | 简单可靠，与项目现有方案一致 |
| 类型定义 | TypeScript | 项目已有方案 |

### 6.2 新增依赖评估

| 依赖 | 用途 | 必要性 | 备注 |
|------|------|--------|------|
| 无 | - | - | 充分利用现有依赖，不引入新包 |

---

## 七、关键技术难点与解决方案

### 7.1 上下文窗口限制

**问题**: AI 模型的上下文窗口有限（通常 4K-128K tokens），长篇小说创作时容易超出限制。

**解决方案**:
1. **分层上下文管理**: 将上下文分为短期（完整内容）、中期（摘要）、长期（关键信息）三层
2. **动态 Token 预算**: 根据当前章节位置和内容长度，动态分配 Token 预算
3. **上下文压缩**: 当接近 Token 限制时，对早期章节进行智能摘要压缩
4. **相关性检索**: 使用向量检索和关键词匹配，仅加载与当前情节相关的上下文

```typescript
// 上下文压缩策略
async compressContextIfNeeded(
  context: WritingContext,
  maxTokens: number,
  currentUsage: number
): Promise<WritingContext> {
  if (currentUsage <= maxTokens * 0.8) return context; // 80% 阈值
  
  // 1. 首先压缩动态检索内容（按相关性排序）
  // 2. 压缩中期上下文摘要（减少细节）
  // 3. 压缩长期上下文（保留核心设定）
  // 4. 短期上下文最后考虑（对连贯性最重要）
  
  return compressedContext;
}
```

### 7.2 剧情连贯性保证

**问题**: 连续生成多章时，容易出现剧情矛盾、角色行为不一致、世界观冲突等问题。

**解决方案**:
1. **连贯性约束系统**: 在 Prompt 中显式加入连贯性约束
2. **伏笔追踪**: 记录和管理已埋设的伏笔，在后续章节中提醒 AI 回收
3. **角色状态追踪**: 维护角色在故事中的状态变化（关系、能力、位置等）
4. **前序章节引用**: 生成当前章节时，强制包含前 2-3 章的完整内容
5. **一致性校验**: 生成后对关键元素进行一致性检查

```typescript
// 连贯性约束示例
const continuityConstraints = `
## 连贯性要求
1. 角色行为必须与之前章节中建立的性格和动机一致
2. 场景转换需要合理的过渡
3. 已埋设的伏笔需要适时回收，当前伏笔列表：
   ${foreshadowing.map(f => `- ${f}`).join('\n')}
4. 角色关系状态（更新至第 ${lastChapter} 章）：
   ${characterRelationships}
5. 世界观约束：
   ${worldbuildingRules}
`;
```

### 7.3 流式生成控制

**问题**: 连续生成时需要支持暂停、继续、停止等操作，且需要保证状态一致性。

**解决方案**:
1. **AbortController 管理**: 每个生成请求绑定独立的 AbortController
2. **状态机管理**: 使用明确的状态机管理生成过程
3. **内容缓存**: 流式内容实时累积，中断后保留已生成部分
4. **断点续传**: 记录生成进度，支持从断点继续

```typescript
// 状态机
enum GenerationState {
  IDLE = 'idle',
  PREPARING = 'preparing',    // 准备上下文
  GENERATING = 'generating',  // AI 生成中
  STREAMING = 'streaming',    // 接收流式响应
  SAVING = 'saving',          // 保存中
  PAUSED = 'paused',          // 已暂停
  COMPLETED = 'completed',    // 当前章节完成
  STOPPED = 'stopped',        // 用户停止
  ERROR = 'error'             // 错误
}
```

### 7.4 大纲生成的结构化解析

**问题**: AI 生成的大纲需要解析为结构化数据，但 AI 输出可能格式不规范。

**解决方案**:
1. **明确 JSON Schema**: 在 Prompt 中明确指定输出的 JSON 结构
2. **格式修复**: 对 AI 输出进行预处理，修复常见的 JSON 格式问题
3. **降级解析**: 如果 JSON 解析失败，使用正则表达式提取关键信息
4. **用户确认**: 解析后展示给用户确认，允许手动调整

```typescript
// 解析策略
async parseOutlineResponse(response: string): Promise<GeneratedOutline> {
  // 1. 尝试直接解析
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    return JSON.parse(jsonStr);
  } catch (e) {
    // 2. 格式修复后重试
    const fixed = this.fixJsonFormat(response);
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      // 3. 降级解析
      return this.parseWithRegex(response);
    }
  }
}
```

### 7.5 自动生成中断恢复

**问题**: 应用崩溃、网络中断等异常情况下，需要能够恢复生成进度。

**解决方案**:
1. **实时保存**: 流式生成过程中定期保存已接收的内容（每 10 秒或每 500 字）
2. **项目状态快照**: 每次状态变更时保存项目快照
3. **恢复机制**: 应用启动时检测未完成的生成任务，提示用户恢复

```typescript
// 自动保存策略
class AutoSaveManager {
  private saveInterval: NodeJS.Timeout | null = null;
  private lastSaveContent = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  
  start(projectId: string, chapterIndex: number): void {
    // 每 10 秒自动保存一次
    this.saveInterval = setInterval(async () => {
      await this.save(projectId, chapterIndex);
    }, 10000);
  }
  
  // 内容变更时，防抖保存（2 秒无新内容后保存）
  onContentChange(content: string): void {
    this.lastSaveContent = content;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      await this.save();
    }, 2000);
  }
  
  stop(): void {
    if (this.saveInterval) clearInterval(this.saveInterval);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}
```

### 7.6 类型范式的 Prompt 工程

**问题**: 不同小说类型有不同的创作范式，需要为每种类型设计有效的 Prompt。

**解决方案**:
1. **模板化系统**: 为每种类型建立独立的 Prompt 模板
2. **动态参数注入**: 根据用户选择的类型、风格、视角动态注入参数
3. **分段 Prompt**: 将 Prompt 分为系统级、类型级、上下文级、任务级多个层次

```typescript
// Prompt 分层结构
const promptLayers = {
  // 系统层：定义 AI 角色和基本行为准则
  system: '你是一位专业的小说创作助手...',
  
  // 类型层：根据小说类型注入创作范式
  type: this.getNovelTypeTemplate(novelType),
  
  // 风格层：根据写作风格调整
  style: this.getStyleGuidance(writingStyle),
  
  // 视角层：根据叙事视角调整
  perspective: this.getPerspectiveGuidance(narrativePerspective),
  
  // 上下文层：注入相关上下文信息
  context: this.buildContextSection(context),
  
  // 任务层：具体的生成任务描述
  task: this.buildTaskDescription(chapterInfo)
};
```

---

## 八、部署架构

### 8.1 本地部署架构

写作模式作为 Creative Cafe 的功能模块，随应用一起部署，无需独立服务器。

```
┌─────────────────────────────────────────────────────────────┐
│                    用户桌面环境                               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Creative Cafe 应用                         │  │
│  │                                                       │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │  │
│  │  │ 渲染进程     │    │ 主进程       │    │ 本地存储    │ │  │
│  │  │ - UI 组件   │◄──►│ - AI 引擎   │◄──►│ - 项目文件  │ │  │
│  │  │ - 状态管理  │    │ - IPC 处理  │    │ - 索引文件  │ │  │
│  │  │ - 服务层    │    │ - 资源管理  │    │ - 版本历史  │ │  │
│  │  └─────────────┘    └──────┬──────┘    └─────────────┘ │  │
│  │                            │                            │  │
│  └────────────────────────────┼────────────────────────────┘  │
│                               │                               │
│                               ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              外部 AI 服务 (用户配置)                     │  │
│  │  - OpenAI 兼容 API                                      │  │
│  │  - 本地部署模型 (可选)                                    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 文件目录结构

```
userData/
├── creative-data.json              # 现有创意数据（不变）
├── character-cards/                # 现有角色卡（不变）
├── world-books/                    # 现有世界书（不变）
├── writing-projects/               # 新增：写作项目存储
│   ├── projects-index.json         # 项目索引
│   ├── [projectId-1]/
│   │   ├── project.json            # 项目元数据
│   │   ├── chapters/
│   │   │   ├── chapter-0.md
│   │   │   ├── chapter-1.md
│   │   │   └── ...
│   │   └── versions/
│   │       ├── chapter-0-v1.md
│   │       └── ...
│   └── [projectId-2]/
│       └── ...
└── settings.json                   # 现有设置（不变）
```

### 8.3 与现有模块集成

| 现有模块 | 集成方式 |
|----------|----------|
| creativeStore | 扩展支持 WritingProject 类型，或创建独立 Store |
| characterService | 通过 WritingResourceManager 读取角色卡 |
| worldBookService | 通过 WritingResourceManager 读取世界书 |
| AIService | 复用现有的 AI 请求和流式响应机制 |
| ContextManager | 扩展支持写作模式的上下文检索 |
| MarkdownEditor | 直接复用现有编辑器组件 |
| Settings | 新增写作模式相关设置项 |

---

## 九、实施计划

### 9.1 开发阶段划分

#### 阶段一：基础架构与数据模型 (3天)

1. 定义 TypeScript 类型（writing.types.ts）
2. 创建 Zustand Store（writingModeStore, writingProjectStore）
3. 实现数据持久层（WritingStorageService）
4. 实现资源管理器（WritingResourceManager）
5. 注册 IPC 处理接口（writingHandlers）

#### 阶段二：配置与大纲功能 (3天)

1. 实现 WritingConfigPanel 组件
2. 实现资源选择器组件
3. 实现 PromptBuilder 和 NovelTypeTemplates
4. 实现 OutlineGenerator
5. 实现 OutlineEditor 组件

#### 阶段三：内容生成核心 (4天)

1. 实现 ContentGenerator
2. 实现内容生成流式通信
3. 实现上下文管理系统
4. 实现 ContentWorkspace 组件
5. 实现章节导航和控制

#### 阶段四：编辑与导出 (2天)

1. 集成 MarkdownEditor
2. 实现章节编辑器
3. 实现版本管理
4. 实现导出服务（TXT/Markdown）
5. 实现自动保存机制

#### 阶段五：集成与优化 (3天)

1. 与 CreativeManager 集成
2. 更新 CreationCenter 启用写作模式
3. 性能优化和内存管理
4. 错误处理和边界情况
5. UI 美化和用户体验优化

### 9.2 文件清单

| 文件 | 层级 | 说明 |
|------|------|------|
| `src/shared/types/writing.types.ts` | Shared | 类型定义 |
| `src/shared/constants/writing.constants.ts` | Shared | 常量定义 |
| `src/renderer/stores/writingModeStore.ts` | Renderer | 写作模式状态 |
| `src/renderer/stores/writingProjectStore.ts` | Renderer | 项目状态 |
| `src/renderer/services/WritingPromptBuilder.ts` | Renderer | Prompt 构建（渲染进程侧） |
| `src/renderer/components/Creative/WritingMode/` | Renderer | UI 组件目录 |
| `src/main/services/WritingEngine.ts` | Main | 写作引擎 |
| `src/main/services/WritingResourceManager.ts` | Main | 资源管理器 |
| `src/main/services/WritingStorageService.ts` | Main | 存储服务 |
| `src/main/services/writing/OutlineGenerator.ts` | Main | 大纲生成器 |
| `src/main/services/writing/ContentGenerator.ts` | Main | 内容生成器 |
| `src/main/services/writing/PromptBuilder.ts` | Main | Prompt 构建器 |
| `src/main/services/writing/NovelTypeTemplates.ts` | Main | 类型模板 |
| `src/main/ipc/handlers/writingHandlers.ts` | Main | IPC 处理 |

---

## 十、风险与应对

### 10.1 技术风险

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| AI 模型 Token 限制 | 长章节可能无法一次性生成 | 中 | 采用分段生成策略 |
| 上下文窗口不足 | 长篇创作时连贯性下降 | 中 | 分层上下文管理 + 动态压缩 |
| AI 输出格式不规范 | 大纲解析失败 | 高 | 多策略解析 + 用户确认 |
| 流式响应中断 | 内容生成不完整 | 低 | 断点恢复机制 |

### 10.2 用户体验风险

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 生成时间过长 | 用户等待体验差 | 中 | 进度提示 + 预估时间 + 可后台运行 |
| 生成质量不稳定 | 内容需要大量修改 | 中 | 提供重生成 + 参数调节 + 手动编辑 |
| 界面复杂 | 学习成本高 | 低 | 分步引导 + 默认值 + 工具提示 |

### 10.3 兼容性风险

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 现有数据结构变更 | 可能导致旧数据不兼容 | 低 | 数据迁移脚本 + 版本兼容 |
| 不同 AI 模型差异 | 生成效果不一致 | 中 | 模型适配层 + 用户可选模型 |
