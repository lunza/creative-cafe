import {
  PromptGenerationRequest,
  PromptGenerationResponse,
  PromptOptimizationRequest,
  PromptOptimizationResponse,
  PromptHistory,
  PromptTemplate,
  PreviewRequest,
  PreviewResponse,
  ApiResponse,
  PaginationRequest,
  PaginationResponse,
  OptimizationGoal,
  TemplateCategory,
  Improvement,
  BeforeAfterComparison
} from '../types/promptOptimizer';

// 生成唯一ID
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// 系统提示词优化服务
class PromptOptimizerService {
  private static instance: PromptOptimizerService;
  private history: PromptHistory[] = [];
  private templates: PromptTemplate[] = [];
  private readonly STORAGE_KEY_HISTORY = 'prompt_optimizer_history';
  private readonly STORAGE_KEY_TEMPLATES = 'prompt_optimizer_templates';

  private constructor() {
    this.loadFromStorage();
    this.initializeBuiltinTemplates();
  }

  public static getInstance(): PromptOptimizerService {
    if (!PromptOptimizerService.instance) {
      PromptOptimizerService.instance = new PromptOptimizerService();
    }
    return PromptOptimizerService.instance;
  }

  // 从本地存储加载数据
  private loadFromStorage() {
    try {
      const historyData = localStorage.getItem(this.STORAGE_KEY_HISTORY);
      if (historyData) {
        this.history = JSON.parse(historyData);
      }

      const templatesData = localStorage.getItem(this.STORAGE_KEY_TEMPLATES);
      if (templatesData) {
        this.templates = JSON.parse(templatesData);
      }
    } catch (error) {
      console.error('Failed to load data from storage:', error);
    }
  }

  // 保存到本地存储
  private saveToStorage() {
    try {
      localStorage.setItem(this.STORAGE_KEY_HISTORY, JSON.stringify(this.history));
      localStorage.setItem(this.STORAGE_KEY_TEMPLATES, JSON.stringify(this.templates));
    } catch (error) {
      console.error('Failed to save data to storage:', error);
    }
  }

  // 初始化内置模板
  private initializeBuiltinTemplates() {
    const builtinTemplates: PromptTemplate[] = [
      {
        id: 'builtin_assistant_1',
        name: '通用助手',
        description: '一个 helpful、harmless、honest 的AI助手',
        category: 'assistant',
        content: '你是一个 helpful、harmless、honest 的AI助手。请根据用户的问题提供准确、有用的回答。如果不确定，请坦诚告知。',
        variables: [],
        example: '用户：你好！\n助手：你好！很高兴为你服务。有什么我可以帮助你的吗？',
        usageCount: 0,
        isBuiltin: true,
        isFavorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builtin_creative_1',
        name: '创意写作助手',
        description: '帮助用户进行创意写作，包括故事、诗歌等',
        category: 'creative',
        content: '你是一位专业的创意写作助手，擅长创作各种文体的内容。你的任务是帮助用户激发创意、完善情节、提升文笔。请用生动、富有感染力的语言进行创作。',
        variables: [
          { name: 'genre', description: '文学体裁', required: false, defaultValue: '小说' },
          { name: 'style', description: '写作风格', required: false, defaultValue: '现代' }
        ],
        example: '用户：帮我写一个科幻短篇的开头\n助手：[生成科幻风格的创意开头]',
        usageCount: 0,
        isBuiltin: true,
        isFavorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builtin_technical_1',
        name: '代码审查助手',
        description: '专业的代码审查和优化建议',
        category: 'technical',
        content: '你是一位资深的代码审查专家，擅长发现代码中的问题并提供优化建议。请从代码质量、性能、安全性、可维护性等角度进行审查，并给出具体的改进建议。',
        variables: [
          { name: 'language', description: '编程语言', required: true },
          { name: 'focus', description: '审查重点', required: false, defaultValue: '全面审查' }
        ],
        example: '用户：请审查这段Python代码\n助手：[详细的代码审查报告]',
        usageCount: 0,
        isBuiltin: true,
        isFavorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builtin_business_1',
        name: '商业分析助手',
        description: '提供商业分析和决策支持',
        category: 'business',
        content: '你是一位经验丰富的商业分析师，擅长市场分析、竞争分析、商业策略制定。请基于数据和逻辑提供专业的商业洞察和建议。',
        variables: [
          { name: 'industry', description: '行业领域', required: false },
          { name: 'goal', description: '商业目标', required: true }
        ],
        example: '用户：分析当前AI市场的竞争格局\n助手：[详细的商业分析报告]',
        usageCount: 0,
        isBuiltin: true,
        isFavorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builtin_education_1',
        name: '教学助手',
        description: '个性化的教学辅导和学习支持',
        category: 'education',
        content: '你是一位耐心的教学助手，擅长将复杂的知识用简单易懂的方式解释清楚。请根据学生的学习水平和需求，提供个性化的教学内容和练习。',
        variables: [
          { name: 'subject', description: '学科', required: true },
          { name: 'level', description: '学习水平', required: false, defaultValue: '中级' }
        ],
        example: '用户：帮我理解量子力学的基本概念\n助手：[通俗易懂的量子力学解释]',
        usageCount: 0,
        isBuiltin: true,
        isFavorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    // 只添加不存在的内置模板
    builtinTemplates.forEach(template => {
      if (!this.templates.find(t => t.id === template.id)) {
        this.templates.push(template);
      }
    });

    this.saveToStorage();
  }

  // ==================== 自动生成功能 ====================

  public async generatePrompt(request: PromptGenerationRequest): Promise<ApiResponse<PromptGenerationResponse>> {
    try {
      // 构建生成提示词的prompt
      const generationPrompt = this.buildGenerationPrompt(request);
      
      // 调用大模型API生成提示词
      const response = await this.callLLMAPI(generationPrompt);
      
      // 解析响应
      const systemPrompt = this.extractSystemPrompt(response);
      
      const result: PromptGenerationResponse = {
        id: generateId(),
        systemPrompt,
        explanation: this.generateExplanation(request, systemPrompt),
        suggestedParameters: {
          temperature: 0.7,
          maxTokens: 2048,
          topP: 1.0
        },
        createdAt: new Date().toISOString()
      };

      // 保存到历史记录
      this.addToHistory({
        id: result.id,
        type: 'generation',
        title: `${request.applicationField} - ${request.functionalGoal}`,
        content: JSON.stringify(request),
        result: systemPrompt,
        metadata: {
          sceneRequirement: request.sceneRequirement,
          applicationField: request.applicationField,
          functionalGoal: request.functionalGoal
        },
        createdAt: result.createdAt,
        updatedAt: result.createdAt,
        tags: [request.applicationField, request.functionalGoal]
      });

      return { success: true, data: result };
    } catch (error) {
      console.error('Failed to generate prompt:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '生成提示词失败' 
      };
    }
  }

  // 构建生成提示词的prompt
  private buildGenerationPrompt(request: PromptGenerationRequest): string {
    const { sceneRequirement, applicationField, functionalGoal, language = 'zh', complexity = 'moderate' } = request;
    
    return `请根据以下要求，生成一个专业的系统提示词（System Prompt）：

【场景需求】
${sceneRequirement}

【应用领域】
${applicationField}

【功能目标】
${functionalGoal}

【复杂度级别】
${complexity === 'simple' ? '简单' : complexity === 'moderate' ? '中等' : '复杂'}

【输出要求】
1. 提示词应该清晰、具体、可操作
2. 明确AI的角色定位和行为准则
3. 包含必要的约束条件和输出格式要求
4. 使用${language === 'zh' ? '中文' : '英文'}输出

请直接输出系统提示词内容，不需要额外解释。`;
  }

  // 调用大模型API
  private async callLLMAPI(prompt: string): Promise<string> {
    // 这里应该调用实际的LLM API
    // 现在使用模拟数据
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return `你是一个专业的${prompt.includes('创意') ? '创意写作' : prompt.includes('代码') ? '代码审查' : prompt.includes('商业') ? '商业分析' : 'AI'}助手。

你的职责包括：
1. 理解用户需求并提供专业的建议
2. 保持客观、准确、有帮助的回答风格
3. 在不确定时坦诚告知，不编造信息
4. 根据上下文调整回答的深度和详细程度

请始终以用户为中心，提供高质量的服务。`;
  }

  // 提取系统提示词
  private extractSystemPrompt(response: string): string {
    // 清理响应内容
    return response.trim();
  }

  // 生成说明
  private generateExplanation(request: PromptGenerationRequest, prompt: string): string {
    return `基于您的需求，我为您生成了一个针对${request.applicationField}领域的系统提示词。该提示词定义了AI助手的角色定位、行为准则和输出要求，适合${request.functionalGoal}的场景使用。`;
  }

  // ==================== 优化功能 ====================

  public async optimizePrompt(request: PromptOptimizationRequest): Promise<ApiResponse<PromptOptimizationResponse>> {
    try {
      const { originalPrompt, optimizationGoals = ['clarity', 'specificity', 'roleDefinition'] } = request;
      
      // 构建优化提示词的prompt
      const optimizationPrompt = this.buildOptimizationPrompt(originalPrompt, optimizationGoals);
      
      // 调用大模型API优化提示词
      const response = await this.callLLMAPI(optimizationPrompt);
      
      // 解析优化结果
      const optimizedPrompt = this.extractSystemPrompt(response);
      
      // 分析改进点
      const improvements = this.analyzeImprovements(originalPrompt, optimizedPrompt, optimizationGoals);
      
      // 计算对比数据
      const beforeAfterComparison = this.calculateComparison(originalPrompt, optimizedPrompt);
      
      const result: PromptOptimizationResponse = {
        id: generateId(),
        originalPrompt,
        optimizedPrompt,
        improvements,
        beforeAfterComparison,
        confidence: 0.85,
        createdAt: new Date().toISOString()
      };

      // 保存到历史记录
      this.addToHistory({
        id: result.id,
        type: 'optimization',
        title: `优化: ${originalPrompt.substring(0, 30)}...`,
        content: originalPrompt,
        result: optimizedPrompt,
        metadata: {
          optimizationGoals
        },
        createdAt: result.createdAt,
        updatedAt: result.createdAt,
        tags: optimizationGoals
      });

      return { success: true, data: result };
    } catch (error) {
      console.error('Failed to optimize prompt:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '优化提示词失败' 
      };
    }
  }

  // 构建优化提示词的prompt
  private buildOptimizationPrompt(originalPrompt: string, goals: OptimizationGoal[]): string {
    const goalDescriptions: Record<OptimizationGoal, string> = {
      clarity: '提升清晰度，使表达更加明确易懂',
      specificity: '增强指令的具体性和可操作性',
      roleDefinition: '优化角色定位和职责描述',
      contextControl: '改进上下文控制和信息处理',
      outputFormat: '规范输出格式和结构',
      constraint: '完善约束条件和限制',
      example: '补充示例说明'
    };

    return `请对以下系统提示词进行优化：

【原始提示词】
${originalPrompt}

【优化目标】
${goals.map(goal => `- ${goalDescriptions[goal]}`).join('\n')}

【优化要求】
1. 保持原始提示词的核心意图
2. 针对优化目标进行改进
3. 使提示词更加专业、有效
4. 直接输出优化后的提示词内容

请输出优化后的系统提示词：`;
  }

  // 分析改进点
  private analyzeImprovements(original: string, optimized: string, goals: OptimizationGoal[]): Improvement[] {
    const improvements: Improvement[] = [];
    
    const goalDescriptions: Record<OptimizationGoal, { title: string; description: string }> = {
      clarity: {
        title: '清晰度提升',
        description: '优化了表达结构，使指令更加明确易懂'
      },
      specificity: {
        title: '指令具体化',
        description: '增加了具体的操作步骤和要求'
      },
      roleDefinition: {
        title: '角色定位优化',
        description: '明确了AI助手的角色定位和职责'
      },
      contextControl: {
        title: '上下文控制',
        description: '改进了上下文理解和信息处理能力'
      },
      outputFormat: {
        title: '输出格式规范',
        description: '规范了输出格式和结构要求'
      },
      constraint: {
        title: '约束条件完善',
        description: '补充了必要的约束和限制条件'
      },
      example: {
        title: '示例补充',
        description: '添加了示例说明，便于理解'
      }
    };

    goals.forEach(goal => {
      improvements.push({
        category: goal,
        description: goalDescriptions[goal].description,
        suggestion: `已针对${goalDescriptions[goal].title}进行优化`,
        priority: goal === 'clarity' || goal === 'roleDefinition' ? 'high' : 'medium'
      });
    });

    return improvements;
  }

  // 计算对比数据
  private calculateComparison(original: string, optimized: string): BeforeAfterComparison {
    const originalLength = original.length;
    const optimizedLength = optimized.length;
    
    // 模拟评分计算
    const baseScore = 60;
    const lengthBonus = Math.min((optimizedLength / originalLength) * 10, 20);
    
    return {
      clarity: { before: baseScore, after: Math.min(baseScore + 20 + lengthBonus, 95) },
      specificity: { before: baseScore + 5, after: Math.min(baseScore + 25 + lengthBonus, 95) },
      roleDefinition: { before: baseScore - 5, after: Math.min(baseScore + 15 + lengthBonus, 95) },
      overall: { before: baseScore, after: Math.min(baseScore + 25 + lengthBonus, 95) }
    };
  }

  // ==================== 历史记录管理 ====================

  private addToHistory(history: PromptHistory) {
    this.history.unshift(history);
    
    // 限制历史记录数量
    const maxHistory = 100;
    if (this.history.length > maxHistory) {
      this.history = this.history.slice(0, maxHistory);
    }
    
    this.saveToStorage();
  }

  public getHistory(pagination: PaginationRequest): ApiResponse<PaginationResponse<PromptHistory>> {
    const { page, pageSize, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    
    // 排序
    const sortedHistory = [...this.history].sort((a, b) => {
      const aValue = a[sortBy as keyof PromptHistory];
      const bValue = b[sortBy as keyof PromptHistory];
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
    
    // 分页
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = sortedHistory.slice(start, end);
    
    return {
      success: true,
      data: {
        items,
        total: this.history.length,
        page,
        pageSize,
        totalPages: Math.ceil(this.history.length / pageSize)
      }
    };
  }

  public deleteHistory(id: string): ApiResponse<void> {
    const index = this.history.findIndex(h => h.id === id);
    if (index === -1) {
      return { success: false, error: '历史记录不存在' };
    }
    
    this.history.splice(index, 1);
    this.saveToStorage();
    
    return { success: true, message: '删除成功' };
  }

  public updateHistoryTags(id: string, tags: string[]): ApiResponse<PromptHistory> {
    const history = this.history.find(h => h.id === id);
    if (!history) {
      return { success: false, error: '历史记录不存在' };
    }
    
    history.tags = tags;
    history.updatedAt = new Date().toISOString();
    this.saveToStorage();
    
    return { success: true, data: history };
  }

  // ==================== 模板库功能 ====================

  public getTemplates(category?: TemplateCategory): ApiResponse<PromptTemplate[]> {
    let templates = this.templates;
    
    if (category) {
      templates = templates.filter(t => t.category === category);
    }
    
    // 按使用次数和收藏排序
    templates.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      return b.usageCount - a.usageCount;
    });
    
    return { success: true, data: templates };
  }

  public createTemplate(template: Omit<PromptTemplate, 'id' | 'usageCount' | 'isBuiltin' | 'createdAt' | 'updatedAt'>): ApiResponse<PromptTemplate> {
    const newTemplate: PromptTemplate = {
      ...template,
      id: generateId(),
      usageCount: 0,
      isBuiltin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.templates.push(newTemplate);
    this.saveToStorage();
    
    return { success: true, data: newTemplate };
  }

  public updateTemplate(id: string, updates: Partial<PromptTemplate>): ApiResponse<PromptTemplate> {
    const template = this.templates.find(t => t.id === id);
    if (!template) {
      return { success: false, error: '模板不存在' };
    }
    
    if (template.isBuiltin) {
      return { success: false, error: '内置模板不能修改' };
    }
    
    Object.assign(template, updates, { updatedAt: new Date().toISOString() });
    this.saveToStorage();
    
    return { success: true, data: template };
  }

  public deleteTemplate(id: string): ApiResponse<void> {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) {
      return { success: false, error: '模板不存在' };
    }
    
    if (this.templates[index].isBuiltin) {
      return { success: false, error: '内置模板不能删除' };
    }
    
    this.templates.splice(index, 1);
    this.saveToStorage();
    
    return { success: true, message: '删除成功' };
  }

  public incrementTemplateUsage(id: string): void {
    const template = this.templates.find(t => t.id === id);
    if (template) {
      template.usageCount++;
      this.saveToStorage();
    }
  }

  public toggleFavoriteTemplate(id: string): ApiResponse<PromptTemplate> {
    const template = this.templates.find(t => t.id === id);
    if (!template) {
      return { success: false, error: '模板不存在' };
    }
    
    template.isFavorite = !template.isFavorite;
    template.updatedAt = new Date().toISOString();
    this.saveToStorage();
    
    return { success: true, data: template };
  }

  // ==================== 效果预览功能 ====================

  public async previewPrompt(request: PreviewRequest): Promise<ApiResponse<PreviewResponse>> {
    try {
      const { prompt, testInput, model, parameters } = request;
      
      // 构建完整的prompt
      const fullPrompt = `${prompt}\n\n用户输入：${testInput}\n\n请根据以上系统提示词和用户输入，提供合适的回答。`;
      
      // 调用大模型API
      const startTime = Date.now();
      const output = await this.callLLMAPI(fullPrompt);
      const latency = Date.now() - startTime;
      
      // 模拟token使用量
      const promptTokens = Math.ceil(fullPrompt.length / 4);
      const completionTokens = Math.ceil(output.length / 4);
      
      const result: PreviewResponse = {
        output,
        latency,
        tokenUsage: {
          prompt: promptTokens,
          completion: completionTokens,
          total: promptTokens + completionTokens
        }
      };
      
      return { success: true, data: result };
    } catch (error) {
      console.error('Failed to preview prompt:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '预览失败' 
      };
    }
  }

  // ==================== 工具方法 ====================

  public applyTemplate(templateId: string, variables: Record<string, string>): ApiResponse<string> {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) {
      return { success: false, error: '模板不存在' };
    }
    
    let content = template.content;
    
    // 替换变量
    template.variables.forEach(variable => {
      const value = variables[variable.name] || variable.defaultValue || '';
      content = content.replace(new RegExp(`{{${variable.name}}}`, 'g'), value);
    });
    
    // 增加使用次数
    this.incrementTemplateUsage(templateId);
    
    return { success: true, data: content };
  }

  public searchHistory(query: string): ApiResponse<PromptHistory[]> {
    const results = this.history.filter(h => 
      h.title.toLowerCase().includes(query.toLowerCase()) ||
      h.content.toLowerCase().includes(query.toLowerCase()) ||
      h.result.toLowerCase().includes(query.toLowerCase()) ||
      h.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
    );
    
    return { success: true, data: results };
  }

  public exportHistory(): ApiResponse<string> {
    try {
      const exportData = {
        history: this.history,
        templates: this.templates.filter(t => !t.isBuiltin),
        exportDate: new Date().toISOString()
      };
      
      return { success: true, data: JSON.stringify(exportData, null, 2) };
    } catch (error) {
      return { success: false, error: '导出失败' };
    }
  }

  public importHistory(jsonData: string): ApiResponse<void> {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.history) {
        this.history = [...data.history, ...this.history];
      }
      
      if (data.templates) {
        const customTemplates = data.templates.filter((t: PromptTemplate) => !t.isBuiltin);
        this.templates = [...customTemplates, ...this.templates];
      }
      
      this.saveToStorage();
      return { success: true, message: '导入成功' };
    } catch (error) {
      return { success: false, error: '导入失败，数据格式错误' };
    }
  }
}

export const promptOptimizerService = PromptOptimizerService.getInstance();
