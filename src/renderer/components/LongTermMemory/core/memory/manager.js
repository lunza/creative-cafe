import { ExcelManager } from '../excel/excelManager.js';

// 模拟SillyTavern的核心对象
const APP = {
  event_types: {
    CHARACTER_MESSAGE_RENDERED: 'character-message-rendered',
    CHAT_COMPLETION_PROMPT_READY: 'chat-completion-prompt-ready',
    CHAT_CHANGED: 'chat-changed',
    MESSAGE_EDITED: 'message-edited',
    MESSAGE_SWIPED: 'message-swiped',
    MESSAGE_DELETED: 'message-deleted'
  },
  eventSource: {
    on: function(event, callback) {
      // 实际实现中，这里会注册到SillyTavern的事件系统
      console.log(`注册事件监听器: ${event}`);
    }
  }
};

const USER = {
  getContext: function() {
    return {
      chat: [],
      saveChat: function() {
        // 实际实现中，这里会保存聊天数据
      },
      registerMacro: function(name, callback) {
        // 实际实现中，这里会注册宏
        console.log(`注册宏: ${name}`);
      }
    };
  },
  tableBaseSetting: {
    isExtensionAble: true,
    isAiReadTable: true,
    isAiWriteTable: true,
    injection_mode: 'deep_system',
    deep: 0,
    step_by_step: false
  }
};

const BASE = {
  // 初始化Excel管理器
  excelManager: null,
  
  // 初始化
  init: function() {
    this.excelManager = new ExcelManager();
  },
  
  // 获取记忆表格提示词
  getMemoryTablePrompt: function(eventData) {
    try {
      const chatId = this.getChatId();
      const tableData = this.excelManager.getTableData(chatId);
      if (!tableData) return '';
      
      return this.formatTablePrompt(tableData);
    } catch (error) {
      console.error('获取记忆表格提示词失败:', error);
      return '';
    }
  },
  
  // 格式化表格提示词
  formatTablePrompt: function(tableData) {
    let prompt = '以下是通过表格记录的当前场景信息以及历史记录信息，你需要以此为参考进行思考：\n';
    
    // 格式化表格数据为提示词
    prompt += '| 字段 | 值 |\n';
    prompt += '|------|-----|\n';
    
    Object.entries(tableData).forEach(([key, value]) => {
      prompt += `| ${key} | ${value} |\n`;
    });
    
    return prompt;
  },
  
  // 获取当前聊天ID
  getChatId: function() {
    // 实际实现中，这里会获取当前聊天的唯一标识
    return 'default';
  },
  
  // 处理表格编辑操作
  handleTableEdit: function(chat, mesIndex = -1) {
    try {
      const chatId = this.getChatId();
      const editActions = this.parseTableEditTag(chat.mes);
      
      editActions.forEach(action => {
        this.excelManager.executeAction(chatId, action);
      });
    } catch (error) {
      console.error('处理表格编辑操作失败:', error);
    }
  },
  
  // 解析表格编辑标签
  parseTableEditTag: function(mes) {
    const regex = /<memoryEdit>(.*?)<\/memoryEdit>/gs;
    const matches = [];
    let match;
    
    while ((match = regex.exec(mes)) !== null) {
      matches.push(match[1]);
    }
    
    // 解析编辑操作
    const actions = [];
    matches.forEach(match => {
      const actionRegex = /(update|insert|delete)\((.*?)\)/g;
      let actionMatch;
      
      while ((actionMatch = actionRegex.exec(match)) !== null) {
        const type = actionMatch[1];
        const params = actionMatch[2].split(',').map(p => p.trim());
        
        actions.push({
          type,
          params
        });
      }
    });
    
    return actions;
  }
};

// 初始化BASE
BASE.init();

export { APP, BASE, USER };