import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

class ExcelManager {
  constructor() {
    // 使用用户数据目录下的 chatlog 文件夹，而不是硬编码路径
    const userDataPath = process.env.CREATIVE_CAFE_USER_DATA || '';
    this.baseDir = userDataPath ? path.join(userDataPath, 'data', 'chatlog') : '';
    this.init();
  }
  
  // 设置基础目录
  setBaseDir(dir) {
    this.baseDir = dir;
    this.init();
  }
  
  // 初始化
  init() {
    // 确保目录存在
    if (this.baseDir && !fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }
  
  // 获取表格文件路径
  getTablePath(chatId) {
    return path.join(this.baseDir, `${chatId}.xlsx`);
  }
  
  // 检查表格文件是否存在
  hasTable(chatId) {
    return fs.existsSync(this.getTablePath(chatId));
  }
  
  // 创建新表格
  createTable(chatId) {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([['字段', '值']]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, this.getTablePath(chatId));
  }
  
  // 读取表格数据
  getTableData(chatId) {
    const tablePath = this.getTablePath(chatId);
    
    if (!this.hasTable(chatId)) {
      this.createTable(chatId);
      return {};
    }
    
    const workbook = XLSX.readFile(tablePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // 转换为对象格式
    const result = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row && row.length >= 2) {
        result[row[0]] = row[1];
      }
    }
    
    return result;
  }
  
  // 写入表格数据
  setTableData(chatId, data) {
    const tablePath = this.getTablePath(chatId);
    
    // 转换为二维数组
    const rows = [['字段', '值']];
    Object.entries(data).forEach(([key, value]) => {
      rows.push([key, value]);
    });
    
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, tablePath);
  }
  
  // 执行表格操作
  executeAction(chatId, action) {
    const data = this.getTableData(chatId);
    
    switch (action.type) {
      case 'update':
        this.updateData(data, action.params);
        break;
      case 'insert':
        this.insertData(data, action.params);
        break;
      case 'delete':
        this.deleteData(data, action.params);
        break;
    }
    
    this.setTableData(chatId, data);
  }
  
  // 更新数据
  updateData(data, params) {
    if (params.length >= 2) {
      const key = params[0];
      const value = params[1];
      data[key] = value;
    }
  }
  
  // 插入数据
  insertData(data, params) {
    if (params.length >= 2) {
      const key = params[0];
      const value = params[1];
      data[key] = value;
    }
  }
  
  // 删除数据
  deleteData(data, params) {
    if (params.length >= 1) {
      const key = params[0];
      delete data[key];
    }
  }
  
  // 记录对话信息到表格
  recordConversation(chatId, userMessage, aiResponse) {
    const data = this.getTableData(chatId);
    
    // 记录最新的对话
    data['最新用户消息'] = userMessage;
    data['最新AI回复'] = aiResponse;
    data['最后对话时间'] = new Date().toISOString();
    
    this.setTableData(chatId, data);
  }
}

// 初始化Excel管理器
async function initExcelManager() {
  const manager = new ExcelManager();
  return manager;
}

export { ExcelManager, initExcelManager };