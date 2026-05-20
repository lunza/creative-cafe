// 世界书参数模板系统
// 提供多种世界书类型的预置参数集合

export interface TemplateParameter {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'checkbox';
  placeholder: string;
  description: string;
  required: boolean;
  options?: string[];
  defaultValue?: any;
}

export interface TemplateEntry {
  id: string;
  comment: string;
  key: string[];
  content: string;
  keysecondary: string[];
  order: number;
  probability: number;
  depth: number;
  position: string;
  group: string;
  constant: boolean;
  selective: boolean;
  disable: boolean;
}

export interface WorldBookTemplate {
  id: string;
  name: string;
  description: string;
  category: 'rule' | 'worldview' | 'location' | 'glossary' | 'faction' | 'item' | 'character_group' | 'event';
  icon: string;
  color: string;
  parameters: TemplateParameter[];
  generatePrompt: (params: Record<string, any>, theme: string) => string;
  defaultEntries: (params: Record<string, any>) => TemplateEntry[];
}

// 规则类模板
export const RULE_TEMPLATE: WorldBookTemplate = {
  id: 'rule',
  name: '规则类',
  description: '生成游戏规则、战斗系统、魔法系统等规则相关条目',
  category: 'rule',
  icon: 'BookOutlined',
  color: '#1890ff',
  parameters: [
    {
      key: 'ruleType',
      label: '规则类型',
      type: 'select',
      placeholder: '选择规则类型',
      description: '选择要生成的规则类型',
      required: true,
      options: ['战斗系统', '魔法系统', '技能系统', '经济系统', '社交规则', '天气系统', '时间系统', '升级系统', '其他']
    },
    {
      key: 'complexity',
      label: '复杂程度',
      type: 'select',
      placeholder: '选择复杂程度',
      description: '规则的详细程度',
      required: true,
      options: ['简单', '中等', '复杂', '极度详细']
    },
    {
      key: 'specificRules',
      label: '具体规则要求',
      type: 'textarea',
      placeholder: '描述具体的规则需求，例如：包含暴击系统、元素相克、装备耐久度等',
      description: '详细描述你想要包含的具体规则',
      required: true,
      defaultValue: ''
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '5',
      description: '生成多少个规则条目',
      required: true,
      defaultValue: 5
    }
  ],
  generatePrompt: (params, theme) => {
    const ruleType = params.ruleType || '战斗系统';
    const complexity = params.complexity || '中等';
    const specificRules = params.specificRules || '';
    const entryCount = params.entryCount || 5;
    return `请为"${theme}"这个主题生成关于${ruleType}的规则条目。

规则类型：${ruleType}
复杂程度：${complexity}
具体要求：${specificRules}

请生成${entryCount}个条目，每个条目应该：
1. 有明确的触发关键词
2. 详细描述规则机制
3. 包含具体的数值、公式或判定条件
4. 规则之间相互关联，形成一个完整的系统

请确保规则详细、可操作、符合主题设定。`;
  },
  defaultEntries: (params) => {
    const ruleType = params.ruleType || '战斗系统';
    const complexity = params.complexity || '中等';
    return [
      {
        id: 'rule_1',
        comment: `${ruleType}基础规则`,
        key: [ruleType, '规则', '基础'],
        content: `${ruleType}的基础规则和核心机制。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '规则',
        constant: false,
        selective: false,
        disable: false
      },
      {
        id: 'rule_2',
        comment: `${ruleType}进阶规则`,
        key: [ruleType, '进阶', '高级'],
        content: `${ruleType}的进阶规则和特殊机制。`,
        keysecondary: [],
        order: 2,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '规则',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 世界观类模板
export const WORLDVIEW_TEMPLATE: WorldBookTemplate = {
  id: 'worldview',
  name: '世界观类',
  description: '生成世界背景、历史、文化、势力等宏观设定条目',
  category: 'worldview',
  icon: 'GlobalOutlined',
  color: '#52c41a',
  parameters: [
    {
      key: 'worldType',
      label: '世界类型',
      type: 'select',
      placeholder: '选择世界类型',
      description: '世界的整体风格类型',
      required: true,
      options: ['奇幻世界', '科幻世界', '现代都市', '末日废土', '武侠世界', '仙侠世界', '历史架空', '其他']
    },
    {
      key: 'focusAreas',
      label: '重点领域',
      type: 'textarea',
      placeholder: '描述需要重点展开的领域，例如：魔法体系、科技发展、政治格局、宗教信仰等',
      description: '指定世界书中需要重点描述的领域',
      required: true,
      defaultValue: ''
    },
    {
      key: 'includeHistory',
      label: '包含历史背景',
      type: 'checkbox',
      placeholder: '',
      description: '是否生成世界历史相关的条目',
      required: false,
      defaultValue: true
    },
    {
      key: 'includeFactions',
      label: '包含势力设定',
      type: 'checkbox',
      placeholder: '',
      description: '是否生成势力和阵营相关的条目',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '6',
      description: '生成多少个世界观条目',
      required: true,
      defaultValue: 6
    }
  ],
  generatePrompt: (params, theme) => {
    const worldType = params.worldType || '奇幻世界';
    const focusAreas = params.focusAreas || '';
    const includeHistory = params.includeHistory !== false;
    const includeFactions = params.includeFactions !== false;
    const entryCount = params.entryCount || 6;
    return `请为"${theme}"这个主题生成关于${worldType}的世界观设定条目。

世界类型：${worldType}
重点领域：${focusAreas}
${includeHistory ? '需要包含历史背景设定。' : '不需要历史背景。'}
${includeFactions ? '需要包含势力和阵营设定。' : '不需要势力设定。'}

请生成${entryCount}个条目，涵盖世界的基本设定、文化背景、社会结构等内容。每个条目应该：
1. 有明确的触发关键词
2. 详细描述世界观要素
3. 与整体世界设定保持一致
4. 为角色扮演提供丰富的背景信息`;
  },
  defaultEntries: (params) => {
    const worldType = params.worldType || '奇幻世界';
    return [
      {
        id: 'world_1',
        comment: `${worldType}世界概述`,
        key: ['世界', '概述', '背景'],
        content: `${worldType}的基本世界概述。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '世界观',
        constant: false,
        selective: false,
        disable: false
      },
      {
        id: 'world_2',
        comment: `${worldType}文化背景`,
        key: ['文化', '社会', '风俗'],
        content: `${worldType}的文化和社会背景。`,
        keysecondary: [],
        order: 2,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '世界观',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 地点类模板
export const LOCATION_TEMPLATE: WorldBookTemplate = {
  id: 'location',
  name: '地点类',
  description: '生成城市、建筑、地标、场景等地点相关条目',
  category: 'location',
  icon: 'EnvironmentOutlined',
  color: '#fa8c16',
  parameters: [
    {
      key: 'locationType',
      label: '地点类型',
      type: 'select',
      placeholder: '选择地点类型',
      description: '主要生成的地点类型',
      required: true,
      options: ['城市', '建筑', '自然景观', '地下城', '商店', '酒馆', '神殿', '学院', '战场', '其他']
    },
    {
      key: 'detailLevel',
      label: '详细程度',
      type: 'select',
      placeholder: '选择详细程度',
      description: '地点描述的详细程度',
      required: true,
      options: ['概略', '详细', '非常详细']
    },
    {
      key: 'includeNPCs',
      label: '包含NPC信息',
      type: 'checkbox',
      placeholder: '',
      description: '是否为每个地点生成相关NPC',
      required: false,
      defaultValue: true
    },
    {
      key: 'includeSecrets',
      label: '包含隐藏要素',
      type: 'checkbox',
      placeholder: '',
      description: '是否为地点添加隐藏秘密或彩蛋',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '4',
      description: '生成多少个地点条目',
      required: true,
      defaultValue: 4
    }
  ],
  generatePrompt: (params, theme) => {
    const locationType = params.locationType || '城市';
    const detailLevel = params.detailLevel || '详细';
    const includeNPCs = params.includeNPCs !== false;
    const includeSecrets = params.includeSecrets !== false;
    const entryCount = params.entryCount || 4;
    return `请为"${theme}"这个主题生成关于${locationType}的地点条目。

地点类型：${locationType}
详细程度：${detailLevel}
${includeNPCs ? '需要包含相关NPC信息。' : '不需要NPC信息。'}
${includeSecrets ? '需要包含隐藏要素和秘密。' : '不需要隐藏要素。'}

请生成${entryCount}个地点条目，每个条目应该：
1. 有明确的地点名称和触发关键词
2. 详细描述地点的外观、氛围和功能
3. 包含地点的历史和背景故事
4. 为角色扮演提供丰富的场景信息`;
  },
  defaultEntries: (params) => {
    const locationType = params.locationType || '城市';
    return [
      {
        id: 'loc_1',
        comment: `重要${locationType}`,
        key: [locationType, '地点', '场景'],
        content: `一个重要的${locationType}。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '地点',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 名词解释类模板
export const GLOSSARY_TEMPLATE: WorldBookTemplate = {
  id: 'glossary',
  name: '名词解释类',
  description: '生成专有名词、术语、概念的解释条目',
  category: 'glossary',
  icon: 'BookOutlined',
  color: '#722ed1',
  parameters: [
    {
      key: 'glossaryType',
      label: '名词类型',
      type: 'select',
      placeholder: '选择名词类型',
      description: '主要解释的名词类型',
      required: true,
      options: ['专有名词', '魔法术语', '科技概念', '组织名称', '物品名称', '技能名称', '种族/物种', '其他']
    },
    {
      key: 'explanationStyle',
      label: '解释风格',
      type: 'select',
      placeholder: '选择解释风格',
      description: '名词解释的写作风格',
      required: true,
      options: ['学术式', '通俗式', '故事式', '简洁式']
    },
    {
      key: 'includeOrigin',
      label: '包含词源信息',
      type: 'checkbox',
      placeholder: '',
      description: '是否为名词添加词源或由来',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '8',
      description: '生成多少个名词解释条目',
      required: true,
      defaultValue: 8
    }
  ],
  generatePrompt: (params, theme) => {
    const glossaryType = params.glossaryType || '专有名词';
    const explanationStyle = params.explanationStyle || '通俗式';
    const includeOrigin = params.includeOrigin !== false;
    const entryCount = params.entryCount || 8;
    return `请为"${theme}"这个主题生成关于${glossaryType}的名词解释条目。

名词类型：${glossaryType}
解释风格：${explanationStyle}
${includeOrigin ? '需要包含词源或由来信息。' : '不需要词源信息。'}

请生成${entryCount}个名词解释条目，每个条目应该：
1. 有明确的名词和触发关键词
2. 清晰解释名词的含义和用途
3. 与整体世界设定保持一致
4. 帮助读者理解世界中的专业术语`;
  },
  defaultEntries: (params) => {
    const glossaryType = params.glossaryType || '专有名词';
    return [
      {
        id: 'gloss_1',
        comment: `${glossaryType}术语`,
        key: ['术语', '名词', '解释'],
        content: `一个${glossaryType}相关的术语解释。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '名词解释',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 势力类模板
export const FACTION_TEMPLATE: WorldBookTemplate = {
  id: 'faction',
  name: '势力类',
  description: '生成组织、阵营、公会、家族等势力相关条目',
  category: 'faction',
  icon: 'TeamOutlined',
  color: '#eb2f96',
  parameters: [
    {
      key: 'factionType',
      label: '势力类型',
      type: 'select',
      placeholder: '选择势力类型',
      description: '主要生成的势力类型',
      required: true,
      options: ['国家/王国', '公会/组织', '家族/氏族', '教派/宗教', '商业联盟', '佣兵团', '秘密结社', '其他']
    },
    {
      key: 'includeStructure',
      label: '包含组织结构',
      type: 'checkbox',
      placeholder: '',
      description: '是否描述势力的内部结构',
      required: false,
      defaultValue: true
    },
    {
      key: 'includeRelations',
      label: '包含势力关系',
      type: 'checkbox',
      placeholder: '',
      description: '是否描述与其他势力的关系',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '5',
      description: '生成多少个势力条目',
      required: true,
      defaultValue: 5
    }
  ],
  generatePrompt: (params, theme) => {
    const factionType = params.factionType || '公会/组织';
    const includeStructure = params.includeStructure !== false;
    const includeRelations = params.includeRelations !== false;
    const entryCount = params.entryCount || 5;
    return `请为"${theme}"这个主题生成关于${factionType}的势力条目。

势力类型：${factionType}
${includeStructure ? '需要包含组织结构描述。' : '不需要组织结构。'}
${includeRelations ? '需要包含与其他势力的关系。' : '不需要势力关系。'}

请生成${entryCount}个势力条目，每个条目应该：
1. 有明确的势力名称和触发关键词
2. 详细描述势力的背景、目标和特点
3. 包含势力的核心成员或领导者信息
4. 为角色扮演提供丰富的互动可能性`;
  },
  defaultEntries: (params) => {
    const factionType = params.factionType || '公会/组织';
    return [
      {
        id: 'faction_1',
        comment: `${factionType}`,
        key: ['势力', '组织', '阵营'],
        content: `一个重要的${factionType}。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '势力',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 物品类模板
export const ITEM_TEMPLATE: WorldBookTemplate = {
  id: 'item',
  name: '物品类',
  description: '生成武器、装备、道具、魔法物品等物品相关条目',
  category: 'item',
  icon: 'ToolOutlined',
  color: '#13c2c2',
  parameters: [
    {
      key: 'itemType',
      label: '物品类型',
      type: 'select',
      placeholder: '选择物品类型',
      description: '主要生成的物品类型',
      required: true,
      options: ['武器', '防具', '魔法道具', '消耗品', '任务物品', '珍贵物品', '日常用品', '其他']
    },
    {
      key: 'includeStats',
      label: '包含数值属性',
      type: 'checkbox',
      placeholder: '',
      description: '是否为物品添加数值属性',
      required: false,
      defaultValue: true
    },
    {
      key: 'includeLore',
      label: '包含背景故事',
      type: 'checkbox',
      placeholder: '',
      description: '是否为物品添加背景故事',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '6',
      description: '生成多少个物品条目',
      required: true,
      defaultValue: 6
    }
  ],
  generatePrompt: (params, theme) => {
    const itemType = params.itemType || '武器';
    const includeStats = params.includeStats !== false;
    const includeLore = params.includeLore !== false;
    const entryCount = params.entryCount || 6;
    return `请为"${theme}"这个主题生成关于${itemType}的物品条目。

物品类型：${itemType}
${includeStats ? '需要包含数值属性（如攻击力、防御力等）。' : '不需要数值属性。'}
${includeLore ? '需要包含物品的背景故事。' : '不需要背景故事。'}

请生成${entryCount}个物品条目，每个条目应该：
1. 有明确的物品名称和触发关键词
2. 详细描述物品的外观、功能和特性
3. 与整体世界设定保持一致
4. 为角色扮演提供有趣的道具选择`;
  },
  defaultEntries: (params) => {
    const itemType = params.itemType || '武器';
    return [
      {
        id: 'item_1',
        comment: `${itemType}`,
        key: ['物品', '道具', itemType],
        content: `一件特殊的${itemType}。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '物品',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 角色群类模板
export const CHARACTER_GROUP_TEMPLATE: WorldBookTemplate = {
  id: 'character_group',
  name: '角色群类',
  description: '生成种族、职业、NPC群体等角色群相关条目',
  category: 'character_group',
  icon: 'UsergroupAddOutlined',
  color: '#fa541c',
  parameters: [
    {
      key: 'groupType',
      label: '群体类型',
      type: 'select',
      placeholder: '选择群体类型',
      description: '主要生成的角色群体类型',
      required: true,
      options: ['种族/物种', '职业群体', 'NPC群体', '英雄/传奇人物', '反派/敌对势力', '其他']
    },
    {
      key: 'includeTraits',
      label: '包含群体特征',
      type: 'checkbox',
      placeholder: '',
      description: '是否描述群体的共同特征',
      required: false,
      defaultValue: true
    },
    {
      key: 'includeRelations',
      label: '包含群体关系',
      type: 'checkbox',
      placeholder: '',
      description: '是否描述与其他群体的关系',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '5',
      description: '生成多少个角色群条目',
      required: true,
      defaultValue: 5
    }
  ],
  generatePrompt: (params, theme) => {
    const groupType = params.groupType || '种族/物种';
    const includeTraits = params.includeTraits !== false;
    const includeRelations = params.includeRelations !== false;
    const entryCount = params.entryCount || 5;
    return `请为"${theme}"这个主题生成关于${groupType}的角色群条目。

群体类型：${groupType}
${includeTraits ? '需要包含群体共同特征描述。' : '不需要群体特征。'}
${includeRelations ? '需要包含与其他群体的关系。' : '不需要群体关系。'}

请生成${entryCount}个角色群条目，每个条目应该：
1. 有明确的群体名称和触发关键词
2. 详细描述群体的特征、文化和行为模式
3. 包含代表性个体或子群体
4. 为角色扮演提供丰富的互动对象`;
  },
  defaultEntries: (params) => {
    const groupType = params.groupType || '种族/物种';
    return [
      {
        id: 'char_group_1',
        comment: `${groupType}`,
        key: ['角色', '群体', groupType],
        content: `一个${groupType}的描述。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '角色群',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 事件类模板
export const EVENT_TEMPLATE: WorldBookTemplate = {
  id: 'event',
  name: '事件类',
  description: '生成历史事件、传说、预言、突发事件等事件相关条目',
  category: 'event',
  icon: 'CalendarOutlined',
  color: '#faad14',
  parameters: [
    {
      key: 'eventType',
      label: '事件类型',
      type: 'select',
      placeholder: '选择事件类型',
      description: '主要生成的事件类型',
      required: true,
      options: ['历史事件', '传说/神话', '预言/预兆', '突发事件', '节日/庆典', '战争/冲突', '其他']
    },
    {
      key: 'includeTimeline',
      label: '包含时间线',
      type: 'checkbox',
      placeholder: '',
      description: '是否为事件添加详细时间线',
      required: false,
      defaultValue: true
    },
    {
      key: 'includeImpact',
      label: '包含影响描述',
      type: 'checkbox',
      placeholder: '',
      description: '是否描述事件对世界的影响',
      required: false,
      defaultValue: true
    },
    {
      key: 'entryCount',
      label: '生成条目数量',
      type: 'number',
      placeholder: '5',
      description: '生成多少个事件条目',
      required: true,
      defaultValue: 5
    }
  ],
  generatePrompt: (params, theme) => {
    const eventType = params.eventType || '历史事件';
    const includeTimeline = params.includeTimeline !== false;
    const includeImpact = params.includeImpact !== false;
    const entryCount = params.entryCount || 5;
    return `请为"${theme}"这个主题生成关于${eventType}的事件条目。

事件类型：${eventType}
${includeTimeline ? '需要包含详细的时间线。' : '不需要时间线。'}
${includeImpact ? '需要描述事件对世界的影响。' : '不需要影响描述。'}

请生成${entryCount}个事件条目，每个条目应该：
1. 有明确的事件名称和触发关键词
2. 详细描述事件的起因、经过和结果
3. 与整体世界设定保持一致
4. 为角色扮演提供丰富的剧情线索`;
  },
  defaultEntries: (params) => {
    const eventType = params.eventType || '历史事件';
    return [
      {
        id: 'event_1',
        comment: `${eventType}`,
        key: ['事件', '历史', eventType],
        content: `一个重要的${eventType}。`,
        keysecondary: [],
        order: 1,
        probability: 100,
        depth: 0,
        position: 'after_char',
        group: '事件',
        constant: false,
        selective: false,
        disable: false
      }
    ];
  }
};

// 所有世界书模板列表
export const ALL_WORLDBOOK_TEMPLATES: WorldBookTemplate[] = [
  RULE_TEMPLATE,
  WORLDVIEW_TEMPLATE,
  LOCATION_TEMPLATE,
  GLOSSARY_TEMPLATE,
  FACTION_TEMPLATE,
  ITEM_TEMPLATE,
  CHARACTER_GROUP_TEMPLATE,
  EVENT_TEMPLATE
];

// 根据分类获取模板
export function getTemplatesByCategory(category: WorldBookTemplate['category']): WorldBookTemplate[] {
  return ALL_WORLDBOOK_TEMPLATES.filter(t => t.category === category);
}

// 根据ID获取模板
export function getTemplateById(id: string): WorldBookTemplate | undefined {
  return ALL_WORLDBOOK_TEMPLATES.find(t => t.id === id);
}

// 获取模板分类列表
export function getTemplateCategories(): { key: WorldBookTemplate['category']; name: string; icon: string; color: string }[] {
  return [
    { key: 'rule', name: '规则类', icon: 'BookOutlined', color: '#1890ff' },
    { key: 'worldview', name: '世界观类', icon: 'GlobalOutlined', color: '#52c41a' },
    { key: 'location', name: '地点类', icon: 'EnvironmentOutlined', color: '#fa8c16' },
    { key: 'glossary', name: '名词解释类', icon: 'BookOutlined', color: '#722ed1' },
    { key: 'faction', name: '势力类', icon: 'TeamOutlined', color: '#eb2f96' },
    { key: 'item', name: '物品类', icon: 'ToolOutlined', color: '#13c2c2' },
    { key: 'character_group', name: '角色群类', icon: 'UsergroupAddOutlined', color: '#fa541c' },
    { key: 'event', name: '事件类', icon: 'CalendarOutlined', color: '#faad14' }
  ];
}
