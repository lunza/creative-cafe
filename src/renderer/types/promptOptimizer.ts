// 系统提示词优化模块类型定义

// 提示词生成请求
export interface PromptGenerationRequest {
  sceneRequirement: string;      // 场景需求
  applicationField: string;      // 应用领域
  functionalGoal: string;        // 功能目标
  language?: string;             // 语言，默认中文
  complexity?: 'simple' | 'moderate' | 'complex';  // 复杂度
}

// 提示词生成响应
export interface PromptGenerationResponse {
  id: string;
  systemPrompt: string;          // 生成的系统提示词
  explanation: string;           // 提示词说明
  suggestedParameters: {         // 建议的参数
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  createdAt: string;
}

// 提示词优化请求
export interface PromptOptimizationRequest {
  originalPrompt: string;        // 原始提示词
  optimizationGoals?: OptimizationGoal[];  // 优化目标
  targetModel?: string;          // 目标模型
}

// 优化目标
export type OptimizationGoal = 
  | 'clarity'           // 清晰度提升
  | 'specificity'       // 指令明确性
  | 'roleDefinition'    // 角色定位
  | 'contextControl'    // 上下文控制
  | 'outputFormat'      // 输出格式
  | 'constraint'        // 约束条件
  | 'example';          // 示例补充

// 提示词优化响应
export interface PromptOptimizationResponse {
  id: string;
  originalPrompt: string;
  optimizedPrompt: string;
  improvements: Improvement[];   // 改进点列表
  beforeAfterComparison: BeforeAfterComparison;
  confidence: number;            // 优化置信度 0-1
  createdAt: string;
}

// 改进点
export interface Improvement {
  category: OptimizationGoal;
  description: string;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
}

// 前后对比
export interface BeforeAfterComparison {
  clarity: { before: number; after: number; };
  specificity: { before: number; after: number; };
  roleDefinition: { before: number; after: number; };
  overall: { before: number; after: number; };
}

// 提示词历史记录
export interface PromptHistory {
  id: string;
  type: 'generation' | 'optimization';
  title: string;
  content: string;
  result: string;
  metadata: {
    sceneRequirement?: string;
    applicationField?: string;
    functionalGoal?: string;
    optimizationGoals?: OptimizationGoal[];
  };
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

// 提示词模板
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  content: string;
  variables: TemplateVariable[];  // 模板变量
  example: string;                // 示例
  usageCount: number;             // 使用次数
  isBuiltin: boolean;             // 是否内置
  isFavorite: boolean;            // 是否收藏
  createdAt: string;
  updatedAt: string;
}

// 模板分类
export type TemplateCategory =
  | 'assistant'      // 助手类
  | 'creative'       // 创意类
  | 'technical'      // 技术类
  | 'business'       // 商业类
  | 'education'      // 教育类
  | 'entertainment'  // 娱乐类
  | 'custom';        // 自定义

// 模板变量
export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

// 效果预览请求
export interface PreviewRequest {
  prompt: string;
  testInput: string;
  model?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
  };
}

// 效果预览响应
export interface PreviewResponse {
  output: string;
  latency: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// 模块配置
export interface PromptOptimizerConfig {
  enabled: boolean;
  defaultModel: string;
  maxHistoryItems: number;
  autoSave: boolean;
  language: 'zh' | 'en';
}

// API响应包装
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 分页请求
export interface PaginationRequest {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// 分页响应
export interface PaginationResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
