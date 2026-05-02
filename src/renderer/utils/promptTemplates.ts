/**
 * 提示词模板系统
 * 支持多种生成模式的预定义模板
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'character' | 'game_master' | 'worldbook';
  systemPrompt: string;
  buildPrompt: (creative: string) => string;
}

/**
 * 具体角色卡生成模板 - 创建详细人物角色
 */
export const CHARACTER_CARD_TEMPLATE: PromptTemplate = {
  id: 'character_card',
  name: '具体角色卡',
  description: '创建具有详细人物特征、背景故事和能力设定的具象化角色',
  category: 'character',
  systemPrompt: `你是一个专业的角色卡创建助手，正在为SillyTavern生成角色卡内容。
请根据用户提供的创意，生成详细、生动、符合要求的角色卡。
要求：
- 角色形象鲜明，性格特点突出
- 背景故事丰富有深度
- 能力设定合理且有趣
- 适合在角色扮演场景中使用`,
  buildPrompt: (creative: string) => `基于以下创意，生成一个详细的标准角色卡：

创意内容：${creative}

请生成一个完整的角色卡，包括以下部分：
1. 角色名称 - 给角色起一个合适的名字
2. 角色描述 - 简洁生动的角色介绍（50-100字）
3. 角色背景 - 详细的身世背景和成长经历
4. 角色性格 - 性格特点、行为习惯、喜恶等
5. 角色能力 - 特殊能力、技能或天赋
6. 角色关系 - 与他人的关系、社交圈子
7. 外貌特征 - 体型、面容、穿着风格
8. 其他相关信息 - 任何补充说明

请确保生成的内容详细、生动、符合创意要求，使用Markdown格式，每个部分用标题和内容组织。`
};

/**
 * 文字游戏卡生成模板 - 创建系统性功能角色
 */
export const GAME_MASTER_TEMPLATE: PromptTemplate = {
  id: 'game_master',
  name: '文字游戏卡',
  description: '创建非具象化的系统性角色，如RPG游戏的游戏主持人(GM)、狼人杀游戏的法官、桌游的规则执行者等',
  category: 'game_master',
  systemPrompt: `你是一个专业的文字游戏角色卡创建助手，正在为SillyTavern生成游戏主持人/系统角色卡。
请根据用户提供的创意，生成详细、专业、功能完善的系统角色卡。
要求：
- 明确的功能定位和职责
- 清晰的游戏机制描述
- 可操作的决策流程
- 适合在文字游戏中执行规则和推进剧情`,
  buildPrompt: (creative: string) => `基于以下创意，生成一个详细的系统类型角色卡（游戏主持人/法官/规则执行者）：

创意内容：${creative}

请生成一个完整的系统角色卡，包括以下部分：
1. 角色类型 - 明确标识角色类型（如游戏大师、法官、规则AI等）
2. 功能职责 - 详细描述该角色在游戏中的核心职责和功能
3. 游戏机制 - 说明该角色如何影响和管理游戏机制
4. 权限范围 - 明确该角色的权限边界和决策范围
5. 操作指南 - 提供具体的操作流程和决策依据
6. 交互模式 - 描述该角色与其他玩家的互动方式
7. 特殊规则 - 列出该角色特有的规则和处理方式
8. 注意事项 - 使用时需要特别注意的要点

请确保生成的内容详细、清晰，符合系统类型角色的特性，关注功能和机制而非个人属性，使用Markdown格式，每个部分用标题和内容组织。`
};

/**
 * 世界书生成模板 - 创建世界背景
 */
export const WORLDBOOK_TEMPLATE: PromptTemplate = {
  id: 'worldbook',
  name: '世界书',
  description: '创建详细的世界背景设定，包括世界设定、势力分布、重要地点等',
  category: 'worldbook',
  systemPrompt: `你是一个专业的世界书创建助手，正在为SillyTavern生成世界书内容。
请根据用户提供的创意，生成详细、生动、完整的世界背景设定。
要求：
- 世界观完整且有逻辑
- 势力关系清晰
- 地点设置有特色
- 适合作为角色扮演游戏的场景背景`,
  buildPrompt: (creative: string) => `基于以下创意，生成一个详细的世界书：

创意内容：${creative}

请生成一个完整的世界书，包括以下部分：
1. 世界名称 - 给这个世界起一个合适的名字
2. 世界概述 - 简短的世界观介绍
3. 地理环境 - 大陆、地形、气候等
4. 主要势力 - 不同的国家、组织或阵营
5. 重要地点 - 关键城市、地点、地标等
6. 历史事件 - 重要的历史背景
7. 文化习俗 - 社会结构、文化、风俗等
8. 其他相关信息 - 任何补充说明

请确保生成的内容详细、生动、符合创意要求，使用Markdown格式，每个部分用标题和内容组织。`
};

/**
 * 简洁角色卡模板 - 快速生成简单角色
 */
export const SIMPLE_CHARACTER_TEMPLATE: PromptTemplate = {
  id: 'simple_character',
  name: '简洁角色卡',
  description: '快速生成精简的角色卡，适合快速测试',
  category: 'character',
  systemPrompt: `你是一个角色卡创建助手，生成简洁但完整的角色卡。`,
  buildPrompt: (creative: string) => `基于以下创意，生成一个简洁的角色卡：

创意内容：${creative}

请包括：
1. 角色名称
2. 简短描述（50字）
3. 性格特点
4. 一两个关键能力

使用Markdown格式，简洁明了。`
};

/**
 * 复杂角色卡模板 - 创建极详细的角色
 */
export const DETAILED_CHARACTER_TEMPLATE: PromptTemplate = {
  id: 'detailed_character',
  name: '超详角色卡',
  description: '创建极其详细的角色卡，包含大量背景和设定',
  category: 'character',
  systemPrompt: `你是一个专业的角色卡创建助手，擅长生成极其详细和深入的角色设定。
要求每个部分都尽可能详细，提供丰富的背景信息。`,
  buildPrompt: (creative: string) => `基于以下创意，生成一个极其详细的角色卡：

创意内容：${creative}

请生成一个完整且详细的角色卡，包括：
1. 基本信息
   - 姓名
   - 年龄/生日
   - 身高/体重
   - 职业/身份

2. 外貌特征
   - 发型发色
   - 眼睛颜色
   - 体型姿态
   - 标志性特征
   - 穿着风格

3. 性格特点
   - 核心性格
   - 优点
   - 缺点
   - 常见口头禅
   - 行为习惯

4. 背景故事
   - 童年经历
   - 成长环境
   - 关键事件
   - 重要关系
   - 现状

5. 能力设定
   - 特殊能力
   - 战斗风格
   - 技能特长
   - 优势劣势

6. 世界观关联
   - 所处世界的身份
   - 与其他势力的关系
   - 目标与动机

请使用Markdown格式，详细描述每个部分。`
};

/**
 * 所有可用模板列表
 */
export const ALL_TEMPLATES: PromptTemplate[] = [
  CHARACTER_CARD_TEMPLATE,
  GAME_MASTER_TEMPLATE,
  SIMPLE_CHARACTER_TEMPLATE,
  DETAILED_CHARACTER_TEMPLATE,
  WORLDBOOK_TEMPLATE
];

/**
 * 根据分类获取模板列表
 */
export function getTemplatesByCategory(category: 'character' | 'game_master' | 'worldbook'): PromptTemplate[] {
  return ALL_TEMPLATES.filter(template => template.category === category);
}

/**
 * 根据ID获取模板
 */
export function getTemplateById(id: string): PromptTemplate | undefined {
  return ALL_TEMPLATES.find(template => template.id === id);
}

/**
 * 获取角色卡相关模板（包含character和game_master）
 */
export function getCharacterTemplates(): PromptTemplate[] {
  return ALL_TEMPLATES.filter(template => 
    template.category === 'character' || template.category === 'game_master'
  );
}

/**
 * 获取世界书相关模板
 */
export function getWorldbookTemplates(): PromptTemplate[] {
  return ALL_TEMPLATES.filter(template => template.category === 'worldbook');
}
