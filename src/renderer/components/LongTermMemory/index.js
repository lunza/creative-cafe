import { APP, BASE, USER } from './core/memory/manager.js';
import { loadSettings } from './scripts/settings/userExtensionSetting.js';
import { initExcelManager } from './core/excel/excelManager.js';
import { onChatCompletionPromptReady, onMessageReceived, onChatChanged, onMessageEdited, onMessageSwiped } from './scripts/runtime/eventHandlers.js';

console.log('______________________长期记忆插件：开始加载______________________')

const VERSION = '1.0.0'

// 初始化Excel管理器
async function initExcelManagerWrapper() {
  try {
    await initExcelManager();
    console.log('______________________Excel管理器：初始化成功______________________');
  } catch (error) {
    console.error('Excel管理器初始化失败:', error);
  }
}

// 注册API
function registerAPI() {
  window.longTermMemory = {
    VERSION,
  };
}

// 注册宏
function registerMacros() {
  USER.getContext().registerMacro("memoryTablePrompt", () => {
    try {
      return BASE.getMemoryTablePrompt();
    } catch (error) {
      console.error("记忆插件：宏提示词注入失败\n原因：", error.message, error);
      return "";
    }
  });
}

jQuery(async () => {
  // 注册API
  registerAPI();
  
  // 初始化Excel管理器
  await initExcelManagerWrapper();
  
  // 加载设置
  loadSettings();
  
  // 注册宏
  registerMacros();
  
  // 监听主程序事件
  APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
  APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
  APP.eventSource.on(APP.event_types.CHAT_CHANGED, onChatChanged);
  APP.eventSource.on(APP.event_types.MESSAGE_EDITED, onMessageEdited);
  APP.eventSource.on(APP.event_types.MESSAGE_SWIPED, onMessageSwiped);
  APP.eventSource.on(APP.event_types.MESSAGE_DELETED, onChatChanged);
  
  console.log('______________________长期记忆插件：加载完成______________________')
});