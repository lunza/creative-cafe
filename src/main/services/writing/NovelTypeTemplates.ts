import { NovelType, WritingStyle, NarrativePerspective } from '../../../shared/types/writing.types';

export const NovelTypeTemplates: Record<NovelType, NovelTypeTemplate> = {
  [NovelType.WEB_NOVEL]: {
    name: '网文',
    systemPrompt: '你是一位专业的网络小说作家，擅长创作节奏明快、情节紧凑、每章设置悬念的网络文学作品。你的文字通俗易懂，善于运用对话推动情节发展，擅长制造爽点和期待感。',
    outlineStructure: ['故事背景', '主角设定', '金手指/特殊能力', '主线剧情', '章节大纲'],
    writingStyle: '节奏明快，每章结尾设置悬念，情节紧凑，对话生动，注重爽点和期待感的营造',
    typicalChapterLength: 3000
  },
  [NovelType.ROMANCE]: {
    name: '言情',
    systemPrompt: '你是一位专业的言情小说作家，擅长细腻的情感描写和心理刻画。你的文字优美流畅，善于营造浪漫氛围，塑造立体的人物形象，注重情感发展和人物成长。',
    outlineStructure: ['故事背景', '男女主角设定', '感情线发展', '冲突与阻碍', '章节大纲'],
    writingStyle: '情感细腻，注重心理描写，氛围营造浪漫，对话温柔含蓄，情节曲折动人',
    typicalChapterLength: 2500
  },
  [NovelType.MARTIAL_ARTS]: {
    name: '武侠',
    systemPrompt: '你是一位专业的武侠小说作家，深谙武侠文化精髓。你的文字古朴典雅，打斗场面描写精彩，注重武学修为和江湖道义，善于塑造侠义精神。',
    outlineStructure: ['江湖背景', '门派设定', '主角武功', '恩怨情仇', '章节大纲'],
    writingStyle: '古朴典雅，打斗场面精彩，注重武学描写，侠义精神贯穿始终，对话半文半白',
    typicalChapterLength: 3500
  },
  [NovelType.FANTASY]: {
    name: '玄幻',
    systemPrompt: '你是一位专业的玄幻小说作家，擅长构建宏大的世界观和修炼体系。你的想象力丰富，善于描写升级流和热血战斗，注重力量体系的严谨性。',
    outlineStructure: ['世界设定', '修炼体系', '主角天赋', '成长路线', '章节大纲'],
    writingStyle: '想象丰富，世界观宏大，战斗热血，升级体系严谨，节奏紧凑',
    typicalChapterLength: 3000
  },
  [NovelType.FANTASY_MAGIC]: {
    name: '奇幻',
    systemPrompt: '你是一位专业的奇幻小说作家，擅长创造独特的魔法世界和奇幻生物。你的文字富有异域风情，善于构建完整的魔法体系和种族设定。',
    outlineStructure: ['魔法世界设定', '种族与势力', '魔法体系', '冒险主线', '章节大纲'],
    writingStyle: '异域风情，想象力丰富，魔法描写细腻，世界观完整，冒险感强',
    typicalChapterLength: 3500
  },
  [NovelType.MYSTERY]: {
    name: '悬疑',
    systemPrompt: '你是一位专业的悬疑小说作家，擅长设置悬念和布局推理。你的逻辑严密，善于埋设线索和制造反转，注重推理过程的合理性和读者的参与感。',
    outlineStructure: ['案件背景', '核心谜题', '线索布置', '推理过程', '章节大纲'],
    writingStyle: '逻辑严密，悬念迭起，线索隐晦，推理精彩，反转合理，氛围紧张',
    typicalChapterLength: 3000
  },
  [NovelType.SCI_FI]: {
    name: '科幻',
    systemPrompt: '你是一位专业的科幻小说作家，具备扎实的科学素养和丰富的想象力。你的文字严谨而不失浪漫，善于将科学概念融入故事情节，探讨科技与人性的关系。',
    outlineStructure: ['科学设定', '未来世界', '核心科技', '故事主线', '章节大纲'],
    writingStyle: '科学合理，想象丰富，探讨深刻，未来感强，细节严谨',
    typicalChapterLength: 3500
  },
  [NovelType.HISTORICAL]: {
    name: '历史',
    systemPrompt: '你是一位专业的历史小说作家，深谙历史典故和文化背景。你的文字古朴庄重，善于在历史框架中创作引人入胜的故事，注重历史真实性和文学性的平衡。',
    outlineStructure: ['历史背景', '时代风貌', '主要人物', '历史事件', '章节大纲'],
    writingStyle: '古朴庄重，历史感强，考据严谨，情节跌宕，人物丰满',
    typicalChapterLength: 3500
  },
  [NovelType.URBAN]: {
    name: '都市',
    systemPrompt: '你是一位专业的都市小说作家，熟悉现代都市生活和职场文化。你的文字贴近现实，善于描写都市人的情感纠葛和职场奋斗，情节真实可信。',
    outlineStructure: ['都市背景', '人物设定', '职场/生活', '情感线索', '章节大纲'],
    writingStyle: '贴近现实，语言现代，情节真实，人物立体，节奏明快',
    typicalChapterLength: 2500
  },
  [NovelType.OTHER]: {
    name: '其他',
    systemPrompt: '你是一位专业的小说作家，具备广泛的创作风格和技巧。你能够根据创意描述灵活调整写作风格，创作出符合要求的文学作品。',
    outlineStructure: ['故事背景', '人物设定', '核心冲突', '发展脉络', '章节大纲'],
    writingStyle: '根据创意描述灵活调整，保持文学性和可读性',
    typicalChapterLength: 3000
  }
};

export interface NovelTypeTemplate {
  name: string;
  systemPrompt: string;
  outlineStructure: string[];
  writingStyle: string;
  typicalChapterLength: number;
}

export const PerspectiveGuidance: Record<NarrativePerspective, string> = {
  [NarrativePerspective.FIRST_PERSON]: '使用第一人称"我"进行叙述，以主角的视角展开故事，注意只描述"我"能感知到的内容。',
  [NarrativePerspective.THIRD_PERSON]: '使用第三人称进行叙述，以旁观者的视角讲述故事，可以聚焦于特定角色的内心，但要保持一定的客观性。',
  [NarrativePerspective.OMNISCIENT]: '使用全知视角进行叙述，可以自由切换不同角色的视角，了解所有人物的内心和事件的来龙去脉。'
};

export const StyleGuidance: Record<WritingStyle, string> = {
  [WritingStyle.RELAXED]: '整体基调轻松愉快，对话幽默，情节发展自然流畅，避免过于沉重的情节。',
  [WritingStyle.SERIOUS]: '整体基调严肃认真，情节深刻，注重人物内心刻画和社会意义的探讨。',
  [WritingStyle.HUMOROUS]: '语言诙谐幽默，善用比喻和夸张，情节中穿插笑点，让人在欢笑中感受故事。',
  [WritingStyle.SUSPENSEFUL]: '氛围紧张悬疑，善用悬念和伏笔，让读者始终保持好奇心和紧张感。',
  [WritingStyle.ROMANTIC]: '情感细腻温柔，注重氛围营造和心理描写，情节温暖动人。',
  [WritingStyle.EPIC]: '格局宏大，场面壮观，情节波澜壮阔，注重历史厚重感和英雄气概的描写。'
};
