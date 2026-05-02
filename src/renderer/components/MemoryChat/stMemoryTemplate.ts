/**
 * 记忆增强插件默认模板
 * 基于 st-memory-enhancement 插件设计规范
 */

import { ExcelTemplate, SheetTemplate } from '../types/memory';

// 基于 st-memory-enhancement 插件的默认模板配置
export const DEFAULT_MEMORY_TEMPLATE: ExcelTemplate = {
  id: 'st-memory-enhancement-default',
  name: '记忆增强插件默认模板',
  description: '基于 st-memory-enhancement 插件设计规范的默认模板，包含时空、角色、社交、物品、事件等核心表格',
  sheets: [
    {
      name: '时空表格',
      description: '记录时空信息的表格，应保持在一行。记录时间和地点信息，帮助AI理解当前场景的时空背景。',
      headers: ['时间', '地点', '描述', '备注'],
      order: 1
    },
    {
      name: '角色表格',
      description: '角色天生或不易改变的特征表格，思考本轮有否有其中的角色，他应作出什么反应。记录角色的基本信息、身份、关系和特征。',
      headers: ['角色名', '身份', '关系', '特征', '备注'],
      order: 2
    },
    {
      name: '社交表格',
      description: '思考如果有角色和其他角色互动，应记录他们之间的关系和互动情况。记录角色之间的社交关系、互动历史和关系状态。',
      headers: ['时间', '参与人', '事件', '结果', '备注'],
      order: 3
    },
    {
      name: '物品表格',
      description: '对某人很贵重或有特殊纪念意义的物品。记录物品的拥有人、描述、名称和重要性等信息。',
      headers: ['物品名', '类型', '描述', '状态', '备注'],
      order: 4
    },
    {
      name: '事件表格',
      description: '记录角色经历的重要事件。记录事件的时间、名称、参与人、描述和影响等信息。',
      headers: ['时间', '事件名', '参与人', '描述', '影响', '备注'],
      order: 5
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: '1.0.0'
};

// 基于 st-memory-enhancement 插件的表格结构配置
export const TABLE_STRUCTURE_CONFIG = [
  {
    tableIndex: 0,
    tableName: '时空表格',
    columns: ['时间', '地点', '描述', '备注'],
    note: '记录场景的时间和空间信息',
    initNode: '以下是时空表格的初始数据：',
    insertNode: '在时空表格中添加新记录：',
    updateNode: '更新时空表格中的记录：',
    deleteNode: '从时空表格中删除记录：',
    enable: true,
    tochat: true,
    Required: false,
    triggerSend: false,
    triggerSendDeep: 1
  },
  {
    tableIndex: 1,
    tableName: '角色表格',
    columns: ['角色名', '身份', '关系', '特征', '备注'],
    note: '记录角色信息和关系网络',
    initNode: '以下是角色表格的初始数据：',
    insertNode: '在角色表格中添加新记录：',
    updateNode: '更新角色表格中的记录：',
    deleteNode: '从角色表格中删除记录：',
    enable: true,
    tochat: true,
    Required: false,
    triggerSend: false,
    triggerSendDeep: 1
  },
  {
    tableIndex: 2,
    tableName: '社交表格',
    columns: ['时间', '参与人', '事件', '结果', '备注'],
    note: '记录社交互动和关系变化',
    initNode: '以下是社交表格的初始数据：',
    insertNode: '在社交表格中添加新记录：',
    updateNode: '更新社交表格中的记录：',
    deleteNode: '从社交表格中删除记录：',
    enable: true,
    tochat: true,
    Required: false,
    triggerSend: false,
    triggerSendDeep: 1
  },
  {
    tableIndex: 3,
    tableName: '物品表格',
    columns: ['物品名', '类型', '描述', '状态', '备注'],
    note: '记录物品信息和状态变化',
    initNode: '以下是物品表格的初始数据：',
    insertNode: '在物品表格中添加新记录：',
    updateNode: '更新物品表格中的记录：',
    deleteNode: '从物品表格中删除记录：',
    enable: true,
    tochat: true,
    Required: false,
    triggerSend: false,
    triggerSendDeep: 1
  },
  {
    tableIndex: 4,
    tableName: '事件表格',
    columns: ['时间', '事件名', '参与人', '描述', '影响', '备注'],
    note: '记录重要事件和影响',
    initNode: '以下是事件表格的初始数据：',
    insertNode: '在事件表格中添加新记录：',
    updateNode: '更新事件表格中的记录：',
    deleteNode: '从事件表格中删除记录：',
    enable: true,
    tochat: true,
    Required: false,
    triggerSend: false,
    triggerSendDeep: 1
  }
];

// 基于 st-memory-enhancement 插件的默认设置
export const DEFAULT_SETTINGS = {
  // 插件基本设置
  isExtensionAble: true,
  tableDebugModeAble: false,
  isAiReadTable: true,
  isAiWriteTable: true,
  
  // 注入设置
  injection_mode: 'deep_system',
  deep: 0,
  message_template: '{{tableData}}',
  
  // 分步填表设置
  step_by_step: false,
  step_by_step_user_prompt: '请根据对话内容，填写以下表格：\n\n{{tableData}}\n\n请按照表格格式填写，确保信息准确完整。',
  separateReadContextLayers: 3,
  separateReadLorebook: true,
  
  // 表格推送设置
  isTableToChat: true,
  table_to_chat_mode: 'macro',
  table_to_chat_can_edit: true,
  
  // 表格样式设置
  table_cell_width_mode: 'single_line',
  
  // 清理设置
  clear_up_stairs: 10,
  use_token_limit: false,
  rebuild_token_limit_value: 5000,
  
  // API 设置
  use_main_api: false,
  step_by_step_use_main_api: false,
  custom_api_url: 'http://127.0.0.1:5000/v1/chat/completions',
  custom_model_name: 'qwen3.5-27b-heretic-v3',
  custom_temperature: 0.7,
  
  // 其他设置
  confirm_before_execution: false,
  bool_ignore_del: false,
  ignore_user_sent: false,
  bool_silent_refresh: false,
  show_settings_in_extension_menu: true,
  alternate_switch: false,
  show_drawer_in_extension_list: true,
  
  // 表格结构
  tableStructure: TABLE_STRUCTURE_CONFIG,
  
  // 模板设置
  lastSelectedTemplate: 'rebuild_base',
  rebuild_message_template_list: {
    rebuild_base: '请根据对话内容，整理并更新表格数据。确保信息准确完整，符合表格结构要求。'
  },
  
  // 版本信息
  updateIndex: 4
};

// 基于 st-memory-enhancement 插件的 API 配置
export const API_CONFIG = {
  custom_api_url: 'http://127.0.0.1:5000/v1/chat/completions',
  custom_model_name: 'qwen3.5-27b-heretic-v3',
  custom_api_key: '',
  table_proxy_address: '',
  table_proxy_key: ''
};

// 生成符合 st-memory-enhancement 插件规范的模板
export function generateSTMemoryTemplate(): ExcelTemplate {
  return {
    ...DEFAULT_MEMORY_TEMPLATE,
    sheets: DEFAULT_MEMORY_TEMPLATE.sheets.map((sheet, index) => {
      const config = TABLE_STRUCTURE_CONFIG[index];
      return {
        ...sheet,
        // 扩展配置以符合 st-memory-enhancement 插件规范
        config: {
          enable: config.enable,
          tochat: config.tochat,
          required: config.Required,
          triggerSend: config.triggerSend,
          triggerSendDeep: config.triggerSendDeep
        },
        data: {
          note: config.note,
          initNode: config.initNode,
          insertNode: config.insertNode,
          updateNode: config.updateNode,
          deleteNode: config.deleteNode
        }
      };
    })
  };
}

// 验证模板是否符合 st-memory-enhancement 插件规范
export function validateSTMemoryTemplate(template: ExcelTemplate): boolean {
  if (!template.name || !template.sheets || template.sheets.length === 0) {
    return false;
  }
  
  for (const sheet of template.sheets) {
    if (!sheet.name || !sheet.headers || sheet.headers.length === 0) {
      return false;
    }
  }
  
  return true;
}

// 转换为 st-memory-enhancement 插件的模板格式
export function convertToSTMemoryFormat(template: ExcelTemplate): any {
  return {
    uid: template.id,
    name: template.name,
    domain: 'global',
    type: 'dynamic',
    enable: true,
    tochat: true,
    required: false,
    triggerSend: false,
    triggerSendDeep: 1,
    hashSheet: template.sheets.map(sheet => {
      // 构建 hashSheet 结构，第一行是表头
      const headers = ['', ...sheet.headers]; // 第一个元素为空字符串，对应 st-memory-enhancement 的格式
      return headers.map((header, index) => {
        // 生成唯一的单元格 ID
        return `cell_${template.id}_${sheet.name}_${index}`;
      });
    }),
    cellHistory: [], // 初始为空
    data: {
      note: '',
      initNode: '',
      insertNode: '',
      updateNode: '',
      deleteNode: ''
    },
    source: {
      required: false,
      data: {
        note: '',
        initNode: '',
        insertNode: '',
        updateNode: '',
        deleteNode: ''
      }
    }
  };
}
