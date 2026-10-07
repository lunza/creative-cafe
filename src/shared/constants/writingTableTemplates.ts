/**
 * 写作模式专用表格模板（内置）
 *
 * 背景：`writing:table:getAllTemplates` 原先返回记忆（对话）模块的 tableTemplateService
 * 模板（"记忆增强插件默认模板"等），写作绑定的表格与对话场景不匹配。
 * 按"写作和对话要分开"的要求，写作表格整理改用本文件内置的写作域模板；
 * 记忆（对话）模块的模板仅保留给对话功能自身使用。
 *
 * sheet 结构刻意与记忆模块 TableSheet（name/description/headers/order）完全一致，
 * 保证 TableOrganizeService 按 id 解析模板后无需任何适配。
 */

export interface WritingTableTemplateSheet {
  name: string;
  headers: string[];
  description: string;
  order: number;
}

export interface WritingTableTemplate {
  id: string;
  name: string;
  description: string;
  sheets: WritingTableTemplateSheet[];
}

/** 写作域默认模板 id（V1/V2 绑定面板预选并标星） */
export const WRITING_DEFAULT_TABLE_TEMPLATE_ID = 'writing-novel-settings-default';

export const WRITING_TABLE_TEMPLATES: WritingTableTemplate[] = [
  {
    id: WRITING_DEFAULT_TABLE_TEMPLATE_ID,
    name: '小说设定总表',
    description:
      '长篇小说核心设定沉淀：角色、物品、事件、场景、伏笔五张表。AI 整理时从章节内容提取信息，供后续生成与剧情检查注入上下文。',
    sheets: [
      {
        name: '角色表',
        headers: ['姓名', '身份', '性格', '特征', '关键关系', '首次登场章节'],
        description: '核心角色的身份、性格、特征（含外貌/身体特征）、人物关系与首次登场章节',
        order: 0,
      },
      {
        name: '物品表',
        headers: ['名称', '类型', '持有者', '作用', '相关事件'],
        description: '关键物品/道具/武器的归属与剧情作用',
        order: 1,
      },
      {
        name: '事件表',
        headers: ['事件', '发生章节', '相关角色', '结果', '重要程度'],
        description: '已发生的关键剧情事件及其因果结果',
        order: 2,
      },
      {
        name: '场景表',
        headers: ['场景', '地点', '氛围', '相关角色'],
        description: '重要场景/地点及其氛围与关联角色',
        order: 3,
      },
      {
        name: '伏笔表',
        headers: ['伏笔内容', '埋设章节', '回收章节', '当前状态'],
        description: '已埋设伏笔及其回收状态（未回收/已回收），防止伏笔遗漏',
        order: 4,
      },
    ],
  },
  {
    id: 'writing-lightweight-settings',
    name: '轻量设定模板',
    description: '短篇或快节奏作品适用：仅角色、事件、物品三张核心表，整理更快。',
    sheets: [
      {
        name: '角色表',
        headers: ['姓名', '身份', '性格', '特征', '关键关系', '首次登场章节'],
        description: '核心角色的身份、性格、特征（含外貌/身体特征）与人物关系',
        order: 0,
      },
      {
        name: '事件表',
        headers: ['事件', '发生章节', '相关角色', '结果', '重要程度'],
        description: '已发生的关键剧情事件',
        order: 1,
      },
      {
        name: '物品表',
        headers: ['名称', '类型', '持有者', '作用', '相关事件'],
        description: '关键物品/道具的归属与剧情作用',
        order: 2,
      },
    ],
  },
  {
    id: 'writing-timeline',
    name: '时间线模板',
    description: '时间强驱动作品（悬疑/历史/末世倒计时）适用：以时间轴为主干的事件与场景表。',
    sheets: [
      {
        name: '时间轴',
        headers: ['时间点', '事件', '相关角色', '发生章节'],
        description: '按故事内时间顺序排列的关键事件',
        order: 0,
      },
      {
        name: '场景表',
        headers: ['场景', '地点', '氛围', '相关角色'],
        description: '重要场景/地点及其氛围',
        order: 1,
      },
    ],
  },
];
