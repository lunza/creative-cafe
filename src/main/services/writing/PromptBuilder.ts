import {
  NovelType,
  WritingStyle,
  NarrativePerspective,
  WritingParameters,
  WritingResourceConfig,
  ChapterOutline
} from '../../../shared/types/writing.types';
import { NovelTypeTemplates, PerspectiveGuidance, StyleGuidance } from './NovelTypeTemplates';

export class PromptBuilder {
  buildSystemPrompt(
    type: NovelType,
    style: WritingStyle,
    perspective: NarrativePerspective
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
6. 语言优美而不浮夸，追求文学性与可读性的平衡`;
  }

  buildOutlinePrompt(
    creativeDescription: string,
    resources: WritingResourceConfig,
    parameters: WritingParameters,
    resourceContext?: string
  ): string {
    const template = NovelTypeTemplates[parameters.novelType];
    const styleGuide = StyleGuidance[parameters.writingStyle || WritingStyle.SERIOUS];
    const perspectiveGuide = PerspectiveGuidance[parameters.narrativePerspective];

    return `# 小说大纲生成任务

## 创意描述
${creativeDescription}

## 创作参数
- 小说类型: ${template.name}
- 目标字数: ${parameters.targetWordCount}字
- 章节数量: ${parameters.chapterCount}章
- 叙事视角: ${perspectiveGuide}
- 写作风格: ${styleGuide}
${parameters.additionalRequirements ? `- 额外要求: ${parameters.additionalRequirements}` : ''}
${parameters.forbiddenContent && parameters.forbiddenContent.length > 0 ? `- 禁止内容: ${parameters.forbiddenContent.join('、')}` : ''}
${resourceContext ? `\n## 用户与角色信息\n${resourceContext}` : ''}

## 大纲结构要求
请按照以下结构生成完整的大纲（使用JSON格式）：

{
  "workInfo": {
    "suggestedTitle": "建议标题",
    "novelType": "${parameters.novelType}",
    "estimatedWordCount": ${parameters.targetWordCount},
    "chapterCount": ${parameters.chapterCount}
  },
  "storyLine": {
    "coreConflict": "核心冲突描述",
    "storyArc": {
      "beginning": "起：故事开端",
      "development": "承：故事发展",
      "climax": "转：故事高潮",
      "resolution": "合：故事结局"
    },
    "theme": "故事主题"
  },
  "chapters": [
    {
      "index": 1,
      "title": "第一章标题",
      "summary": "章节概要",
      "keyPlotPoints": ["关键情节点1", "关键情节点2"],
      "characters": ["出场角色"],
      "scenes": ["场景描述"],
      "suspensePoints": ["悬念点"],
      "targetWordCount": ${Math.round(parameters.targetWordCount / parameters.chapterCount)}
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
1. 共生成 ${parameters.chapterCount} 章的章节大纲
2. 每章目标字数约 ${Math.round(parameters.targetWordCount / parameters.chapterCount)} 字
3. 章节之间要有连贯性，情节递进
4. 遵循${template.name}类型的创作范式: ${template.outlineStructure.join('、')}
5. 合理安排起承转合，注意节奏控制
${parameters.forbiddenContent && parameters.forbiddenContent.length > 0 ? `6. 绝对不要包含以下内容: ${parameters.forbiddenContent.join('、')}` : ''}

## 输出格式要求
1. 只输出JSON格式的大纲，不要输出任何解释性文字、前言或后记
2. JSON必须是合法的格式，所有字符串值中的换行符必须转义为\\n，不能使用真实的换行符
3. 所有属性名必须使用双引号包裹
4. 字符串值必须使用双引号包裹，不能使用单引号
5. 不要在JSON末尾添加多余的逗号
6. 整个输出必须被包裹在\`\`\`json和\`\`\`代码块中
7. 确保所有字符串值都完整闭合，不要在字符串中间截断

请严格按照上述格式输出完整的JSON大纲。`;
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
    },
    parameters: {
      targetWordCount: number;
      style: string;
      perspective: string;
      constraints?: string[];
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

    if (context.resourceContext) {
      parts.push(`
## 相关背景资料
${context.resourceContext}`);
    }

    if (context.recentChapters) {
      parts.push(`
## 前序章节内容
${context.recentChapters}`);
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

    parts.push(`
## 生成要求
- 目标字数: 约${parameters.targetWordCount}字
- 叙事视角: ${parameters.perspective}
- 写作风格: ${parameters.style}`);

    if (parameters.constraints && parameters.constraints.length > 0) {
      parts.push(`- 特殊约束: ${parameters.constraints.join('、')}`);
    }

    parts.push(`
## 输出要求
请直接生成${chapterInfo.title}的正文内容，使用Markdown格式。
不要输出任何解释或说明，直接开始正文。`);

    return parts.join('\n');
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
}

export const promptBuilder = new PromptBuilder();
