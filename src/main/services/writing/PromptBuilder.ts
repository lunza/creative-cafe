import {
  NovelType,
  WritingStyle,
  NarrativePerspective,
  WritingParameters,
  WritingResourceConfig,
  ChapterOutline,
  ShardOutline
} from '../../../shared/types/writing.types';
import { WritingStyleResource, WritingStyleAnalysis } from '../../../shared/types/writing.types';
import { NovelTypeTemplates, PerspectiveGuidance, StyleGuidance } from './NovelTypeTemplates';

export class PromptBuilder {
  buildSystemPrompt(
    type: NovelType,
    style: WritingStyle,
    perspective: NarrativePerspective,
    writingStyleContext?: string
  ): string {
    const template = NovelTypeTemplates[type];
    const styleGuide = StyleGuidance[style];
    const perspectiveGuide = PerspectiveGuidance[perspective];

    return `${template.systemPrompt}

## 写作风格要求
${template.writingStyle}
${styleGuide}

## 叙事视角
${perspectiveGuide}

## 创作原则
1. 保持剧情逻辑一致性和人物行为合理性
2. 描写生动具体，善用五感描写增强代入感
3. 对话自然流畅，符合人物性格和身份
4. 注意段落和章节之间的过渡衔接
5. 控制节奏张弛有度，高潮与铺垫交替
6. 语言优美而不浮夸，追求文学性与可读性的平衡${writingStyleContext ? `\n## 学习文风参考\n${writingStyleContext}\n\n## 重要提示\n请将上述学习文风的特征融入到本次创作中，模仿其写作风格、修辞手法和叙事特点。` : ''}`;
  }

  buildOutlinePrompt(
    creativeDescription: string,
    resources: WritingResourceConfig,
    parameters: WritingParameters,
    resourceContext?: string,
    writingStyleContext?: string
  ): string {
    const template = NovelTypeTemplates[parameters.novelType];
    const styleGuide = StyleGuidance[parameters.writingStyle || WritingStyle.SERIOUS];
    const perspectiveGuide = PerspectiveGuidance[parameters.narrativePerspective];

    const includeEnding = parameters.includeEnding !== false;
    const rangeStart = parameters.chapterRangeStart || 1;
    const rangeEnd = parameters.chapterRangeEnd || parameters.chapterCount;
    const effectiveChapterCount = rangeEnd - rangeStart + 1;
    const wordsPerChapter = Math.round(parameters.targetWordCount / parameters.chapterCount);

    let chapterGenerationInstruction = '';
    if (!includeEnding) {
      chapterGenerationInstruction = `
## 重要说明：本大纲为"未完结"状态
1. 本作品为连载式创作，**不要生成结局章节**
2. 故事弧线中的"合"（结局）部分请标记为"待定"
3. 最后一章应为开放式结尾或悬念收尾，为后续章节留出空间
4. workInfo.isComplete 请设置为 false
5. storyArc.resolution 请设置为"待定"
`;
    }

    let chapterRangeInstruction = '';
    if (rangeStart > 1 || rangeEnd < parameters.chapterCount) {
      chapterRangeInstruction = `
## 章节范围说明
本次仅生成第 ${rangeStart} 章至第 ${rangeEnd} 章的大纲（共 ${effectiveChapterCount} 章）
请专注于指定范围内的章节，不要生成范围之外的章节
`;
    }

    return `# 小说大纲生成任务

## 创意描述
${creativeDescription}

## 创作参数
- 小说类型: ${template.name}
- 目标字数: ${parameters.targetWordCount}字
- 章节数量: ${parameters.chapterCount}章
${!includeEnding ? '- 连载状态: 未完结（不生成结局）' : '- 连载状态: 完整（包含结局）'}
${chapterRangeInstruction ? `- 生成范围: 第${rangeStart}章至第${rangeEnd}章` : '- 生成范围: 全部章节'}
- 叙事视角: ${perspectiveGuide}
- 写作风格: ${styleGuide}
${parameters.additionalRequirements ? `- 额外要求: ${parameters.additionalRequirements}` : ''}
${parameters.forbiddenContent && parameters.forbiddenContent.length > 0 ? `- 禁止内容: ${parameters.forbiddenContent.join('、')}` : ''}
${resourceContext ? `\n## 用户与角色信息\n${resourceContext}` : ''}${writingStyleContext ? `\n\n## 学习文风参考\n${writingStyleContext}` : ''}

## 大纲结构要求
请按照以下结构生成完整的大纲（使用JSON格式）：

{
  "workInfo": {
    "suggestedTitle": "建议标题",
    "novelType": "${parameters.novelType}",
    "estimatedWordCount": ${parameters.targetWordCount},
    "chapterCount": ${parameters.chapterCount}${!includeEnding ? ',\n    "isComplete": false' : ''}
  },
  "storyLine": {
    "coreConflict": "核心冲突描述",
    "storyArc": {
      "beginning": "起：故事开端",
      "development": "承：故事发展",
      "climax": "转：故事高潮"${!includeEnding ? ',\n      "resolution": "待定"' : ',\n      "resolution": "合：故事结局"'}
    },
    "theme": "故事主题"
  },
  "chapters": [
    {
      "index": ${rangeStart - 1},
      "title": "章节标题",
      "summary": "章节概要",
      "keyPlotPoints": ["关键情节点1", "关键情节点2"],
      "characters": ["出场角色"],
      "scenes": ["场景描述"],
      "suspensePoints": ["悬念点"],
      "targetWordCount": ${wordsPerChapter},
      "importantSpans": ["需要加粗显示的重要文本1", "需要加粗显示的重要文本2"]
    }
  ],
  "characterRelationships": [
    {
      "name": "角色名",
      "role": "角色定位",
      "relationships": [
        {
          "targetCharacter": "目标角色",
          "relationshipType": "关系类型",
          "description": "关系描述"
        }
      ]
    }
  ],
  "worldbuildingNotes": [
    {
      "category": "类别",
      "points": ["设定要点"]
    }
  ]
}

## 章节大纲生成要求
1. 共生成 ${effectiveChapterCount} 章的章节大纲${rangeStart > 1 || rangeEnd < parameters.chapterCount ? `（第${rangeStart}章至第${rangeEnd}章）` : ''}
2. 每章目标字数约 ${wordsPerChapter} 字
3. 章节之间要有连贯性，情节递进
4. 遵循${template.name}类型的创作范式: ${template.outlineStructure.join('、')}
5. 合理安排起承转合，注意节奏控制
6. 合理使用 importantSpans 字段标记需要在前端加粗显示的重要文本，包括但不限于：具体金额、重要物品名称、人物关系发展关键描述、剧情推动点、关键线索等。importantSpans 中的文本必须是 summary 或 keyPlotPoints 中出现的原文片段（精确匹配），纯文本格式，不要包含任何Markdown标记
${!includeEnding ? '7. 不要生成结局章节，故事保持开放式发展' : ''}
${chapterRangeInstruction ? `${!includeEnding ? '8' : '7'}. 仅生成指定范围的章节：第${rangeStart}章至第${rangeEnd}章` : ''}
${parameters.forbiddenContent && parameters.forbiddenContent.length > 0 ? `${(!includeEnding || chapterRangeInstruction) ? '8' : '7'}. 绝对不要包含以下内容: ${parameters.forbiddenContent.join('、')}` : ''}

` + this.getJsonFormatRequirements({
      rule1TypeName: '大纲',
      rule8: '不要在JSON字符串值中使用任何Markdown格式标记（如**加粗**、*斜体*、_下划线_、~~删除线~~等），如需标记重要内容请使用 importantSpans 字段',
      finalTypeName: '大纲'
    });
  }

  buildContentPrompt(
    chapterInfo: {
      index: number;
      title: string;
      outline: string;
      characters: string[];
      scenes: string[];
    },
    context: {
      resourceContext: string;
      recentChapters: string;
      chapterSummaries: string;
      longTermContext: string;
      continuityConstraints: string;
      tableContext?: string;
    },
    parameters: {
      targetWordCount: number;
      style: string;
      perspective: string;
      constraints?: string[];
      writingStyleContext?: string;
    }
  ): string {
    const parts: string[] = [];

    parts.push(`# 小说内容生成任务

## 当前章节
**${chapterInfo.title}**

## 章节大纲
${chapterInfo.outline}

## 出场角色
${chapterInfo.characters.join('、')}

## 场景
${chapterInfo.scenes.join('、')}`);

    parts.push(...this.buildContextSections(context));

    parts.push(`
## 生成要求
- 目标字数: 不少于${parameters.targetWordCount}字
- 叙事视角: ${parameters.perspective}
- 写作风格: ${parameters.style}`);

    if (parameters.constraints && parameters.constraints.length > 0) {
      parts.push(`- 特殊约束: ${parameters.constraints.join('、')}`);
    }

    const writingStyleSection = this.buildWritingStyleContextSection(parameters.writingStyleContext);
    if (writingStyleSection) {
      parts.push(writingStyleSection);
    }

    parts.push(`
## 输出要求
请直接生成${chapterInfo.title}的正文内容，使用Markdown格式。
不要输出任何解释或说明，直接开始正文。`);

    return parts.join('\n');
  }

  buildWritingStylePrompt(styles: WritingStyleResource[]): string {
    if (!styles || styles.length === 0) {
      return '';
    }

    const parts: string[] = [];
    for (const style of styles) {
      if (!style.analysis) continue;
      
      parts.push(`### ${style.name} 的文风特征`);
      
      if (style.analysis.styleOverview) {
        parts.push(`整体风格: ${this.formatStyleOverview(style.analysis.styleOverview)}`);
      }
      
      if (style.analysis.coreTechniques && style.analysis.coreTechniques.length > 0) {
        parts.push('核心技巧:');
        for (const technique of style.analysis.coreTechniques) {
          parts.push(`- ${technique}`);
        }
      }
      
      if (style.analysis.languageFeatures) {
        parts.push(`语言特色: ${JSON.stringify(style.analysis.languageFeatures)}`);
      }
      
      if (style.analysis.narrativeStructure) {
        parts.push(`叙事结构: ${JSON.stringify(style.analysis.narrativeStructure)}`);
      }
      
      if (style.analysis.imitableElements) {
        parts.push(`可模仿要素: ${JSON.stringify(style.analysis.imitableElements)}`);
      }
      
      parts.push('');
    }
    
    return parts.join('\n');
  }

  private formatStyleOverview(overview: Record<string, any>): string {
    if (typeof overview === 'string') return overview;
    return JSON.stringify(overview);
  }

  /**
   * 统一构建 JSON 输出格式要求段落。
   * 规则 2-7 在所有需要 JSON 输出的提示词中保持一致，规则 1 与规则 8 因场景而异，
   * 由调用方通过 rule1TypeName / rule8 / finalTypeName 指定。
   */
  private getJsonFormatRequirements(options: {
    rule1TypeName: string;
    rule8: string;
    finalTypeName: string;
  }): string {
    const { rule1TypeName, rule8, finalTypeName } = options;
    const rules = [
      `只输出JSON格式的${rule1TypeName}，不要输出任何解释性文字、前言或后记`,
      'JSON必须是合法的格式，所有字符串值中的换行符必须转义为\\n，不能使用真实的换行符',
      '所有属性名必须使用双引号包裹',
      '字符串值必须使用双引号包裹，不能使用单引号',
      '不要在JSON末尾添加多余的逗号',
      '整个输出必须被包裹在```json和```代码块中',
      '确保所有字符串值都完整闭合，不要在字符串中间截断',
      rule8
    ];
    return `## 输出格式要求
${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

请严格按照上述格式输出完整的JSON${finalTypeName}。`;
  }

  /**
   * 统一构建内容生成提示词中重复出现的上下文段落
   * （相关背景资料 / 表格上下文 / 所有章节概要 / 长期设定信息 / 连贯性约束）。
   * 各段落的拼接顺序与原文保持一致，未提供的段落会被跳过。
   */
  private buildContextSections(context: {
    resourceContext?: string;
    tableContext?: string;
    chapterSummaries?: string;
    longTermContext?: string;
    continuityConstraints?: string;
  }): string[] {
    const parts: string[] = [];

    if (context.resourceContext) {
      parts.push(`
## 相关背景资料
${context.resourceContext}`);
    }

    if (context.tableContext) {
      parts.push(`
${context.tableContext}`);
    }

    if (context.chapterSummaries) {
      parts.push(`
## 所有章节概要
${context.chapterSummaries}`);
    }

    if (context.longTermContext) {
      parts.push(`
## 长期设定信息
${context.longTermContext}`);
    }

    if (context.continuityConstraints) {
      parts.push(`
## 连贯性约束
${context.continuityConstraints}`);
    }

    return parts;
  }

  /**
   * 统一构建"学习文风模仿"段落，未提供文风上下文时返回 null 以便调用方跳过。
   */
  private buildWritingStyleContextSection(writingStyleContext?: string): string | null {
    if (!writingStyleContext) return null;
    return `
## 学习文风模仿
请模仿以下文风特征进行创作:
${writingStyleContext}`;
  }

  buildContinuityConstraints(
    previousChapters: { index: number; title: string; summary: string }[],
    foreshadowing: string[],
    characterDevelopment: Record<string, string>,
    worldbuildingRules: string
  ): string {
    const parts: string[] = ['## 剧情连贯性要求'];

    if (previousChapters.length > 0) {
      parts.push('\n### 前序剧情要点');
      for (const ch of previousChapters) {
        parts.push(`- 第${ch.index + 1}章 ${ch.title}: ${ch.summary}`);
      }
    }

    if (foreshadowing.length > 0) {
      parts.push('\n### 伏笔处理');
      parts.push('以下伏笔需要适时回收或继续埋设:');
      for (const f of foreshadowing) {
        parts.push(`- ${f}`);
      }
    }

    if (Object.keys(characterDevelopment).length > 0) {
      parts.push('\n### 角色状态（最新）');
      for (const [name, status] of Object.entries(characterDevelopment)) {
        parts.push(`- ${name}: ${status}`);
      }
    }

    if (worldbuildingRules) {
      parts.push(`\n### 世界观约束\n${worldbuildingRules}`);
    }

    parts.push('\n### 基本原则');
    parts.push('1. 角色行为必须与已建立的性格和动机一致');
    parts.push('2. 场景转换需要合理的过渡');
    parts.push('3. 已发生的事件不可逆转或否定');
    parts.push('4. 新增设定不得与已有设定冲突');

    return parts.join('\n');
  }

  buildPolishDescriptionPrompt(description: string, resourceContext?: string, instruction?: string): { role: 'system' | 'user'; content: string }[] {
    const systemPrompt = `你是一位专业的文案润色专家，擅长优化创意描述文本的表达质量。

## 润色目标
1. **保持核心不变**：保留原创意的核心思想、主题和关键要素
2. **提升流畅度**：优化语句结构，使表达更加自然流畅
3. **增强文采**：运用恰当的修辞手法，提升文本的文学性和感染力
4. **提高专业度**：使用更精准、专业的词汇，增强文本的说服力

## 润色原则
- 不改变原意，不添加原文未提及的新概念
- 保持文本的长度适中，不过度扩展
- 根据上下文语境选择合适的表达方式
- 输出纯文本格式，不包含任何解释性文字或 Markdown 标记

## 输出要求
直接输出润色后的文本，不要包含任何前言、后记或说明文字。`;

    const userPromptParts: string[] = [
      '请对以下创意描述进行润色：',
      '',
      '## 原始创意描述',
      description
    ];

    if (resourceContext) {
      userPromptParts.push('', '## 相关背景资料', resourceContext);
      userPromptParts.push('', '请结合上述背景资料进行润色，确保润色后的描述与背景设定保持一致。');
    }

    if (instruction) {
      userPromptParts.push('', '## 用户润色指令', instruction);
      userPromptParts.push('', '请根据上述用户指令调整润色方向，同时保持核心不变。');
    }

    userPromptParts.push('', '请直接输出润色后的文本：');

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPromptParts.join('\n') }
    ];
  }

  /**
   * 构建分片大纲生成提示词
   * 将一章规划为多个分片，要求AI输出 ShardOutline[] 的 JSON
   */
  buildShardOutlinePrompt(
    chapterInfo: { index: number; title: string; outline: string; characters: string[]; scenes: string[] },
    shardCount: number,
    targetWordCount: number,
    resourceContext?: string,
    userSuggestion?: string,
    generationGuidance?: string
  ): string {
    const perShardWords = shardCount > 0 ? Math.round(targetWordCount / shardCount) : targetWordCount;
    const lastIndex = Math.max(0, shardCount - 1);
    const parts: string[] = [];

    parts.push(`# 分片大纲生成任务

## 当前章节
**${chapterInfo.title}**

## 章节大纲
${chapterInfo.outline}

## 出场角色
${chapterInfo.characters.join('、')}

## 场景
${chapterInfo.scenes.join('、')}`);

    if (resourceContext) {
      parts.push(`
## 相关背景资料
${resourceContext}`);
    }

    parts.push(`
## 分片规划要求
请将本章内容规划为 ${shardCount} 个分片。
- 全章目标字数: ${targetWordCount} 字
- 每个分片目标字数: 约 ${perShardWords} 字
- 分片之间剧情连贯，按顺序逐步推进本章情节
- 每个分片需有明确的剧情走向与重点，覆盖章节大纲中的相应内容
- 第一个分片负责本章开篇，最后一个分片负责本章收尾`);

    parts.push(`
## 输出结构
请按以下JSON结构输出分片大纲（JSON数组，长度为 ${shardCount}）：

[
  {
    "index": 0,
    "title": "分片1标题",
    "summary": "分片1剧情简介",
    "targetWordCount": ${perShardWords}
  },
  {
    "index": ${lastIndex},
    "title": "分片${shardCount}标题",
    "summary": "分片${shardCount}剧情简介",
    "targetWordCount": ${perShardWords}
  }
]`);

    parts.push(`
## 分片大纲生成要求
1. 共生成 ${shardCount} 个分片
2. 每个分片目标字数约 ${perShardWords} 字
3. index 从 0 开始，递增至 ${lastIndex}
4. title 简洁概括该分片内容
5. summary 详细描述该分片的剧情走向、关键事件与人物表现
6. 分片内容不得重叠，不得遗漏章节大纲中的关键情节`);

    if (generationGuidance) {
      parts.push(`
## 章节创作指导
${generationGuidance}`);
    }

    if (userSuggestion) {
      parts.push(`
## 附加指令
${userSuggestion}`);
    }

    parts.push('\n' + this.getJsonFormatRequirements({
      rule1TypeName: '分片大纲数组',
      rule8: '输出必须是JSON数组（以 [ 开始，以 ] 结束），不要包裹在对象中',
      finalTypeName: '分片大纲'
    }));

    return parts.join('\n');
  }

  /**
   * 构建分片内容生成提示词
   * 整体结构与 buildContentPrompt 一致，新增"当前分片"、"分片剧情简介"、
   * "前置分片完整内容"等段落，并显式要求与前序分片衔接连贯。
   */
  buildShardContentPrompt(
    shardOutline: ShardOutline,
    shardIndex: number,
    totalShards: number,
    previousShardContents: string,
    chapterInfo: { index: number; title: string; outline: string; characters: string[]; scenes: string[] },
    parameters: { targetWordCount: number; style: string; perspective: string; constraints?: string[]; writingStyleContext?: string },
    context?: { resourceContext?: string; chapterSummaries?: string; longTermContext?: string; continuityConstraints?: string; tableContext?: string },
    userSuggestion?: string,
    generationGuidance?: string
  ): string {
    const parts: string[] = [];

    parts.push(`# 分片内容生成任务

## 当前章节
**${chapterInfo.title}**

## 章节大纲
${chapterInfo.outline}

## 出场角色
${chapterInfo.characters.join('、')}

## 场景
${chapterInfo.scenes.join('、')}

## 当前分片
第 ${shardIndex + 1}/${totalShards} 个分片
标题：${shardOutline.title}

## 分片剧情简介
${shardOutline.summary}`);

    if (context) {
      parts.push(...this.buildContextSections(context));
    }

    if (previousShardContents) {
      parts.push(`
## 前置分片完整内容
以下是本章已生成的前序分片完整正文，新生成内容必须与之叙事连贯、逻辑顺畅、风格统一，不得重复或矛盾：

${previousShardContents}`);
    }

    parts.push(`
## 生成要求
- 目标字数: 不少于${shardOutline.targetWordCount}字
- 叙事视角: ${parameters.perspective}
- 写作风格: ${parameters.style}`);

    if (parameters.constraints && parameters.constraints.length > 0) {
      parts.push(`- 特殊约束: ${parameters.constraints.join('、')}`);
    }

    parts.push(`
## 分片衔接要求
- 与前置分片衔接自然，承接其结尾继续推进剧情
- 保持风格统一，与前序分片在文风、节奏、用词上保持一致
- 不要重复前文已写过的情节、对话或描写
- 保持人物行为与性格一致，不得与前序分片产生矛盾${shardIndex === totalShards - 1 ? '\n- 这是本章最后一个分片，请确保本章剧情完整收尾' : ''}`);

    const writingStyleSection = this.buildWritingStyleContextSection(parameters.writingStyleContext);
    if (writingStyleSection) {
      parts.push(writingStyleSection);
    }

    if (generationGuidance) {
      parts.push(`
## 章节创作指导
${generationGuidance}`);
    }

    if (userSuggestion) {
      parts.push(`
## 附加指令
${userSuggestion}`);
    }

    parts.push(`
## 输出要求
请直接生成本分片的正文内容，使用Markdown格式。
不要输出任何解释或说明，直接开始正文。`);

    return parts.join('\n');
  }
}

export const promptBuilder = new PromptBuilder();
