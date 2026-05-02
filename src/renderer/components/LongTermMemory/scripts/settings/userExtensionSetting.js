// 插件设置
const defaultSettings = {
  isExtensionAble: true,
  isAiReadTable: true,
  isAiWriteTable: true,
  injection_mode: 'deep_system',
  deep: 0,
  step_by_step: false
};

// 加载设置
function loadSettings() {
  try {
    // 实际实现中，这里会从localStorage或其他存储中加载设置
    // 现在使用默认设置
    console.log('加载插件设置');
    return defaultSettings;
  } catch (error) {
    console.error('加载设置失败:', error);
    return defaultSettings;
  }
}

// 保存设置
function saveSettings(settings) {
  try {
    // 实际实现中，这里会将设置保存到localStorage或其他存储中
    console.log('保存插件设置:', settings);
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}

export { loadSettings, saveSettings, defaultSettings };