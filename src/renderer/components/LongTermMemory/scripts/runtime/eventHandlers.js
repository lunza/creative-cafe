import { BASE, USER } from '../../core/memory/manager.js';

// 获取注入角色
function getMesRole() {
  switch (USER.tableBaseSetting.injection_mode) {
    case 'deep_system':
      return 'system';
    case 'deep_user':
      return 'user';
    case 'deep_assistant':
      return 'assistant';
  }
}

// 聊天完成提示词准备时触发
async function onChatCompletionPromptReady(eventData) {
  try {
    // 仅当插件和AI读表功能开启,注入模式不是关闭注入时才注入
    if (USER.tableBaseSetting.isExtensionAble === true && 
        USER.tableBaseSetting.isAiReadTable === true && 
        USER.tableBaseSetting.injection_mode !== "injection_off") {
      
      const promptContent = BASE.getMemoryTablePrompt(eventData);
      if (promptContent) { // 确保有内容可注入
        if (USER.tableBaseSetting.deep === 0) {
          eventData.chat.push({ role: getMesRole(), content: promptContent });
        } else {
          eventData.chat.splice(-USER.tableBaseSetting.deep, 0, { role: getMesRole(), content: promptContent });
        }
        console.log("注入记忆表格数据", eventData.chat);
      }
    }
  } catch (error) {
    console.error(`记忆插件：表格数据注入失败\n原因：`, error.message, error);
  }
}

// 消息接收时触发
async function onMessageReceived(chat_id) {
  if (USER.tableBaseSetting.isExtensionAble === false) return;
  
  if (USER.tableBaseSetting.isAiWriteTable === false) return;
  
  const chat = USER.getContext().chat[chat_id];
  console.log("收到消息", chat_id);
  
  try {
    // 处理表格编辑操作
    BASE.handleTableEdit(chat);
    
    // 记录对话信息到表格
    const chatId = BASE.getChatId();
    // 这里需要获取用户消息和AI回复
    // 实际实现中，需要从聊天历史中获取
  } catch (error) {
    console.error("记忆插件：表格自动更改失败\n原因：", error.message, error);
  }
}

// 聊天变化时触发
async function onChatChanged() {
  try {
    // 这里可以添加聊天变化时的处理逻辑
    console.log("聊天发生变化");
  } catch (error) {
    console.error("记忆插件：处理聊天变更失败\n原因：", error.message, error);
  }
}

// 消息编辑时触发
async function onMessageEdited(this_edit_mes_id) {
  if (USER.tableBaseSetting.isExtensionAble === false) return;
  
  const chat = USER.getContext().chat[this_edit_mes_id];
  if (chat.is_user === true || USER.tableBaseSetting.isAiWriteTable === false) return;
  
  try {
    BASE.handleTableEdit(chat, parseInt(this_edit_mes_id));
  } catch (error) {
    console.error("记忆插件：表格编辑失败\n原因：", error.message, error);
  }
}

// 滑动切换消息事件
async function onMessageSwiped(chat_id) {
  if (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiWriteTable === false) return;
  
  const chat = USER.getContext().chat[chat_id];
  console.log("滑动切换消息", chat);
  
  try {
    BASE.handleTableEdit(chat);
  } catch (error) {
    console.error("记忆插件：swipe切换失败\n原因：", error.message, error);
  }
}

export { onChatCompletionPromptReady, onMessageReceived, onChatChanged, onMessageEdited, onMessageSwiped };