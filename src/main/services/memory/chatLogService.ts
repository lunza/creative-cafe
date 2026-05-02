/**
 * 聊天记录管理服务
 * 负责管理聊天记录的读取、搜索、筛选和 AI 处理
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import { pathService } from '../pathService';
import { getUserDataPath } from '../../utils/appPath';

// 导入全局日志发送函数
import { sendLogToRenderer } from '../../index';

// 记录日志的函数
const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info') => {
  sendLogToRenderer(message, type);
};

// 定义聊天记录接口
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chatId: string;
}

export interface ChatSession {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  preview: string;
  characterName: string;
  templateId?: string;
  isTemplateAssociated?: boolean;
  isProcessed?: boolean; // 是否已完成整理
}

export interface AIProcessingResult {
  sheetName: string;
  updates: Record<string, any>[];
  preview: string;
}

// 定义 SillyTavern 消息接口
interface SillyTavernMessage {
  name: string;
  is_user: boolean;
  is_system: boolean;
  send_date: string;
  mes: string;
  extra?: any;
  swipes?: string[];
  swipe_id?: number;
  swipe_info?: any[];
  hash_sheets?: any;
}

// 定义 SillyTavern 聊天元数据接口
interface SillyTavernChatMetadata {
  chat_metadata: {
    integrity: string;
    sheets: any[];
    selected_sheets: string[];
  };
  user_name: string;
  character_name: string;
}

class ChatLogService {
  private chatsDir: string;
  private chatlogDir: string;

  constructor() {
    // 使用 getUserDataPath 获取用户数据目录
    const userDataPath = getUserDataPath();
    
    // 聊天记录目录 - 使用用户数据目录
    this.chatsDir = path.join(userDataPath, 'data', 'memories', 'chats');
    console.log('聊天记录目录:', this.chatsDir);
    
    // 设置聊天记录表格存储目录
    this.chatlogDir = path.join(userDataPath, 'data', 'memories', 'chatlog');
    console.log('聊天记录表格存储目录:', this.chatlogDir);
    
    // 确保目录存在
    if (!fs.existsSync(this.chatsDir)) {
      console.warn('聊天记录目录不存在，将在首次使用时创建:', this.chatsDir);
    } else {
      console.log('聊天记录目录存在');
    }
    
    // 确保聊天记录表格存储目录存在
    if (!fs.existsSync(this.chatlogDir)) {
      fs.mkdirSync(this.chatlogDir, { recursive: true });
      console.log('创建聊天记录表格存储目录:', this.chatlogDir);
    } else {
      console.log('聊天记录表格存储目录存在');
    }
  }

  /**
   * 动态设置聊天记录目录
   */
  setChatsDir(dir: string) {
    this.chatsDir = dir;
    console.log('聊天记录目录设置为:', dir);
  }

  /**
   * 获取聊天记录目录
   */
  getChatsDir(): string {
    return this.chatsDir;
  }

  /**
   * 获取所有聊天会话列表
   */
  public getChatSessions(): ChatSession[] {
    console.log('开始获取聊天会话列表...');
    console.log('聊天记录目录:', this.chatsDir);
    
    const sessions: ChatSession[] = [];
    
    try {
      if (fs.existsSync(this.chatsDir)) {
        console.log('聊天记录目录存在');
        // 读取角色目录
        const characterDirs = fs.readdirSync(this.chatsDir);
        console.log(`找到 ${characterDirs.length} 个角色目录: ${characterDirs.join(', ')}`);
        
        characterDirs.forEach(characterDir => {
        console.log(`处理角色目录: ${characterDir}`);
        const characterPath = path.join(this.chatsDir, characterDir);
        
        // 检查是否是目录
        if (fs.statSync(characterPath).isDirectory()) {
          // 读取该角色的所有聊天文件
          try {
            const chatFiles = fs.readdirSync(characterPath);
            console.log(`角色 ${characterDir} 有 ${chatFiles.length} 个文件`);
            
            chatFiles.forEach(chatFile => {
              if (chatFile.endsWith('.jsonl')) {
                const chatId = `${characterDir}/${chatFile.replace('.jsonl', '')}`;
                console.log(`处理聊天文件: ${chatId}`);
                const session = this.getChatSession(chatId);
                if (session) {
                  // 获取关联的模板
                  const templateId = this.getAssociatedTemplate(chatId);
                  session.templateId = templateId;
                  session.isTemplateAssociated = !!templateId;
                  // 获取是否已处理的状态
                  session.isProcessed = this.getSessionProcessedStatus(chatId);
                  sessions.push(session);
                  console.log(`添加聊天会话: ${session.name} (${session.characterName})${templateId ? ` - 已关联模板` : ''}${session.isProcessed ? ' - 已整理' : ''}`);
                }
              } else {
                console.log(`跳过非 JSONL 文件: ${chatFile}`);
              }
            });
          } catch (error) {
            console.error(`读取角色目录 ${characterDir} 失败:`, error);
          }
        } else {
          console.log(`跳过非目录: ${characterDir}`);
        }
      });
      } else {
        console.warn('聊天记录目录不存在:', this.chatsDir);
      }
    } catch (error) {
      console.error('获取聊天会话列表失败:', error);
    }
    
    console.log(`共获取到 ${sessions.length} 个聊天会话`);
    return sessions.sort((a, b) => 
      new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
    );
  }

  /**
   * 获取单个聊天会话信息
   */
  public getChatSession(chatId: string): ChatSession | null {
    // 解析 chatId，格式为 "characterDir/chatFileName"
    const [characterDir, chatFileName] = chatId.split('/');
    if (!characterDir || !chatFileName) {
      return null;
    }
    
    const chatFilePath = path.join(this.chatsDir, characterDir, `${chatFileName}.jsonl`);
    
    if (!fs.existsSync(chatFilePath)) {
      return null;
    }
    
    try {
      const stats = fs.statSync(chatFilePath);
      const fileContent = fs.readFileSync(chatFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        return null;
      }
      
      // 解析元数据行
      let characterName = characterDir;
      try {
        const metadataLine = lines[0];
        const metadata = JSON.parse(metadataLine) as SillyTavernChatMetadata;
        if (metadata.character_name && metadata.character_name !== 'unused') {
          characterName = metadata.character_name;
        }
      } catch (error) {
        // 元数据解析失败，使用目录名作为角色名
      }
      
      // 计算消息数量（减去元数据行）
      const messageCount = Math.max(0, lines.length - 1);
      
      // 获取预览文本
      let preview = '';
      if (lines.length > 1) {
        try {
          const firstMessageLine = lines[1];
          const firstMessage = JSON.parse(firstMessageLine) as SillyTavernMessage;
          preview = firstMessage.mes || '';
        } catch (error) {
          // 消息解析失败
        }
      }
      
      return {
        id: chatId,
        name: chatFileName,
        startTime: stats.birthtime.toISOString(),
        endTime: stats.mtime.toISOString(),
        messageCount,
        preview: preview.substring(0, 100),
        characterName
      };
    } catch (error) {
      console.error('读取聊天会话失败:', error);
      return null;
    }
  }

  /**
   * 获取聊天记录
   */
  public getChatMessages(chatId: string, page: number = 1, pageSize: number = 50): {
    messages: ChatMessage[],
    total: number,
    totalPages: number
  } {
    // 解析 chatId，格式为 "characterDir/chatFileName"
    const [characterDir, chatFileName] = chatId.split('/');
    if (!characterDir || !chatFileName) {
      return { messages: [], total: 0, totalPages: 0 };
    }
    
    const chatFilePath = path.join(this.chatsDir, characterDir, `${chatFileName}.jsonl`);
    
    if (!fs.existsSync(chatFilePath)) {
      return { messages: [], total: 0, totalPages: 0 };
    }
    
    try {
      const fileContent = fs.readFileSync(chatFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      const messages: ChatMessage[] = [];
      
      // 跳过元数据行，从第二行开始读取消息
      for (let i = 1; i < lines.length; i++) {
        try {
          const line = lines[i];
          const stMessage = JSON.parse(line) as SillyTavernMessage;
          
          messages.push({
            id: `${chatId}-${i}`,
            role: stMessage.is_user ? 'user' : stMessage.is_system ? 'system' : 'assistant',
            content: stMessage.mes || '',
            timestamp: stMessage.send_date || new Date().toISOString(),
            chatId
          });
        } catch (error) {
          // 消息解析失败，跳过
          console.error('解析聊天消息失败:', error);
        }
      }
      
      // 分页
      const total = messages.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const paginatedMessages = messages.slice(start, end);
      
      return {
        messages: paginatedMessages,
        total,
        totalPages
      };
    } catch (error) {
      console.error('读取聊天记录失败:', error);
      return { messages: [], total: 0, totalPages: 0 };
    }
  }

  /**
   * 搜索聊天记录
   */
  public searchChatMessages(keyword: string, chatId?: string): ChatMessage[] {
    const results: ChatMessage[] = [];
    
    if (fs.existsSync(this.chatsDir)) {
      if (chatId) {
        // 搜索指定的聊天记录
        const [characterDir, chatFileName] = chatId.split('/');
        if (characterDir && chatFileName) {
          const chatFilePath = path.join(this.chatsDir, characterDir, `${chatFileName}.jsonl`);
          if (fs.existsSync(chatFilePath)) {
            this.searchInChatFile(chatFilePath, chatId, keyword, results);
          }
        }
      } else {
        // 搜索所有聊天记录
        const characterDirs = fs.readdirSync(this.chatsDir);
        characterDirs.forEach(characterDir => {
          const characterPath = path.join(this.chatsDir, characterDir);
          if (fs.statSync(characterPath).isDirectory()) {
            const chatFiles = fs.readdirSync(characterPath);
            chatFiles.forEach(chatFile => {
              if (chatFile.endsWith('.jsonl')) {
                const chatId = `${characterDir}/${chatFile.replace('.jsonl', '')}`;
                const chatFilePath = path.join(characterPath, chatFile);
                this.searchInChatFile(chatFilePath, chatId, keyword, results);
              }
            });
          }
        });
      }
    }
    
    return results;
  }

  /**
   * 在单个聊天文件中搜索
   */
  private searchInChatFile(chatFilePath: string, chatId: string, keyword: string, results: ChatMessage[]): void {
    try {
      const fileContent = fs.readFileSync(chatFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      // 跳过元数据行，从第二行开始搜索
      for (let i = 1; i < lines.length; i++) {
        try {
          const line = lines[i];
          const stMessage = JSON.parse(line) as SillyTavernMessage;
          
          if (stMessage.mes && stMessage.mes.toLowerCase().includes(keyword.toLowerCase())) {
            results.push({
              id: `${chatId}-${i}`,
              role: stMessage.is_user ? 'user' : stMessage.is_system ? 'system' : 'assistant',
              content: stMessage.mes,
              timestamp: stMessage.send_date || new Date().toISOString(),
              chatId
            });
          }
        } catch (error) {
          // 消息解析失败，跳过
        }
      }
    } catch (error) {
      console.error('搜索聊天记录失败:', error);
    }
  }

  /**
   * 筛选聊天记录
   */
  public filterChatMessages(chatId: string, filters: {
    startTime?: string;
    endTime?: string;
  }): ChatMessage[] {
    // 解析 chatId，格式为 "characterDir/chatFileName"
    const [characterDir, chatFileName] = chatId.split('/');
    if (!characterDir || !chatFileName) {
      return [];
    }
    
    const chatFilePath = path.join(this.chatsDir, characterDir, `${chatFileName}.jsonl`);
    
    if (!fs.existsSync(chatFilePath)) {
      return [];
    }
    
    try {
      const fileContent = fs.readFileSync(chatFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      const messages: ChatMessage[] = [];
      
      // 跳过元数据行，从第二行开始筛选
      for (let i = 1; i < lines.length; i++) {
        try {
          const line = lines[i];
          const stMessage = JSON.parse(line) as SillyTavernMessage;
          
          // 检查时间范围
          if (filters.startTime || filters.endTime) {
            const messageTime = new Date(stMessage.send_date || new Date());
            
            if (filters.startTime) {
              const startTime = new Date(filters.startTime);
              if (messageTime < startTime) {
                continue;
              }
            }
            
            if (filters.endTime) {
              const endTime = new Date(filters.endTime);
              if (messageTime > endTime) {
                continue;
              }
            }
          }
          
          messages.push({
            id: `${chatId}-${i}`,
            role: stMessage.is_user ? 'user' : stMessage.is_system ? 'system' : 'assistant',
            content: stMessage.mes || '',
            timestamp: stMessage.send_date || new Date().toISOString(),
            chatId
          });
        } catch (error) {
          // 消息解析失败，跳过
        }
      }
      
      return messages;
    } catch (error) {
      console.error('筛选聊天记录失败:', error);
      return [];
    }
  }

  /**
   * AI 处理聊天记录，提取关键信息
   */
  public async processChatWithAI(
    chatId: string,
    templateId: string,
    apiKey: string,
    apiUrl: string,
    modelName: string
  ): Promise<AIProcessingResult[]> {
    // 读取聊天记录
    const messages = this.getChatMessages(chatId).messages;
    
    if (messages.length === 0) {
      throw new Error('没有聊天记录可处理');
    }
    
    // 获取模板信息
    const template = tableTemplateService.getTemplate(templateId);
    if (!template) {
      throw new Error(`模板 ${templateId} 不存在`);
    }
    
    // 构建提示词
    const prompt = this.buildAIPrompt(messages, template, chatId);
    
    // 调用 AI API
    const aiResponse = await this.callAIAPI(prompt, apiKey, apiUrl, modelName);
    
    // 解析 AI 响应
    const results = this.parseAIResponse(aiResponse);
    
    return results;
  }

  /**
   * 构建 AI 提示词
   */
  private buildAIPrompt(messages: ChatMessage[], template: any, chatId: string): string {
    const chatContent = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    // 构建模板结构描述
    const templateDescription = template.sheets.map((sheet: any) => {
      return `- ${sheet.name}：字段包括 [${sheet.headers.join(', ')}]
  表格用途：${sheet.description || '暂无描述'}`;
    }).join('\n');
    
    // 读取现有表格数据
    let existingDataDescription = "";
    try {
      const safeChatId = chatId
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .replace(/\s+/g, '_')
        .replace(/@/g, '_')
        .replace(/-/g, '_')
        .replace(/:/g, '_')
        .replace(/\*/g, '_')
        .replace(/\?/g, '_')
        .replace(/"/g, '_')
        .replace(/</g, '_')
        .replace(/>/g, '_')
        .replace(/\|/g, '_');
      
      const jsonPath = require('path').join(this.chatlogDir, `${safeChatId}.json`);
      const fs = require('fs');
      
      if (fs.existsSync(jsonPath)) {
        existingDataDescription = "【现有表格数据】\n";
        const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        
        template.sheets.forEach((sheet: any) => {
          if (jsonData.data[sheet.name] && jsonData.data[sheet.name].length > 0) {
            existingDataDescription += `${sheet.name}：\n`;
            
            // 显示所有数据
            jsonData.data[sheet.name].forEach((row: any, index: number) => {
              existingDataDescription += `  - ${JSON.stringify(row)}\n`;
            });
            
            existingDataDescription += `  共 ${jsonData.data[sheet.name].length} 条记录\n`;
          }
        });
      } else {
        existingDataDescription = "【现有表格数据】\n暂无数据\n";
      }
    } catch (error) {
      existingDataDescription = "【现有表格数据】\n读取失败：" + error.message + "\n";
    }
    
    return `【角色设定】
你是一个专业的信息提取和表格整理专家，擅长从聊天记录中提取关键信息并生成精确的表格操作指令。你特别擅长识别不同称呼（appellations）的同一元素，并通过唯一 ID 策略确保实体识别的一致性。

仔细阅读下面的聊天记录，提取所有重要信息，参考现有表格数据，根据提供的表格模板结构，生成相应的表格操作指令。

【核心任务：唯一 ID 策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一 ID（唯一id）的重要性**：
   - 唯一 ID 是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一 ID
   - 唯一 ID 应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**：
   - 识别并链接同一实体的不同称呼，包括但不限于：
     * 全名 vs 缩写："朱迪·霍普斯" vs "朱迪"
     * 全名 vs 昵称："朱迪·霍普斯" vs "朱迪小姐"
     * 全名 vs 敬称："张三" vs "张先生"
     * 姓名 vs 代号："007" vs "詹姆斯·邦德"
     * 上下文相关的称呼："她" vs "朱迪"（需要根据上下文判断）

3. **实体识别与一致性维护**：
   - 在整个对话过程中，建立和维护一致的实体识别
   - 跨越对话轮次和会话，保持同一实体的唯一 ID 一致性
   - 考虑上下文变化、语义关系和对话流程，进行系统的唯一元素识别

【不同实体类型的特定识别规则】

1. **角色表格（角色实体）**：
   - 变体称呼处理：全名、昵称、敬称、代号、上下文相关的指代
   - 识别标准：姓名、身份、关系、特征等属性的一致性
   - 示例：
     * "朱迪·霍普斯"、"朱迪"、"朱迪小姐" → 同一角色，使用相同唯一 ID
     * "张三"、"张先生"、"三儿" → 同一角色，使用相同唯一 ID

2. **时空表格（时空实体）**：
   - 变体称呼处理：地点名称的不同说法、时间的不同表达方式
   - 识别标准：地理位置、时间范围、环境特征的一致性
   - 示例：
     * "公园"、"中央公园"、"我们见面的地方" → 同一地点
     * "昨天"、"2026-04-07"、"我们上次见面的时间" → 同一时间

3. **社交表格（社会关系实体）**：
   - 变体称呼处理：关系名称的不同表达方式
   - 识别标准：关系双方、关系类型、关系状态的一致性
   - 示例：
     * "朋友"、"好友"、"死党" → 同一关系类型
     * "父亲"、"爸爸"、"老爸" → 同一关系

4. **物品表格（物品实体）**：
   - 变体称呼处理：物品名称的不同说法、描述方式
   - 识别标准：物品特征、拥有者、获取方式的一致性
   - 示例：
     * "手机"、"iPhone"、"我的智能手机" → 同一物品
     * "100元钱"、"人民币100元"、"那张纸币" → 同一物品

5. **事件表格（事件实体）**：
   - 变体称呼处理：事件名称的不同说法、描述方式
   - 识别标准：事件时间、地点、参与者、内容的一致性
   - 示例：
     * "聚会"、"生日派对"、"我们昨天的活动" → 同一事件
     * "会议"、"项目讨论会"、"那个重要的会" → 同一事件

【表格模板结构】
${templateDescription}

${existingDataDescription}

【聊天记录】
${chatContent}

【操作说明】
你需要生成JSON格式的操作指令数组，每个操作包含以下字段：
- sheetName：要操作的表格页签名称（必须与模板中的名称完全一致）
- operation：操作类型，可选值为 "insert"（新增）、"update"（修改）、"delete"（删除）
- data：要操作的数据对象，字段名必须与模板中的字段名完全一致
- condition：匹配条件对象，用于update和delete操作定位记录
- description：操作说明文字，简要描述这次操作的目的

【重要要求】
1. 必须返回有效的JSON数组，即使没有任何操作也要返回 "[]"
2. 所有字段名必须与模板中的字段名完全一致，包括大小写
3. 如果聊天记录中有多个可提取的信息，生成多个操作指令
4. 参考现有表格数据，避免重复添加相同信息
5. 如果需要修改或删除现有数据，使用update或delete操作
6. 只提取聊天记录中明确提到的信息，不要臆造
7. 确保JSON格式正确，没有语法错误
8. 只返回JSON数据，不要包含任何其他说明文字
9. **重中之重**：识别变体称呼并维护唯一 ID 一致性！
   - 当发现聊天记录中提到的实体与现有表格中的实体是同一实体时，即使称呼不同，也要使用相同的唯一 ID
   - 对于新实体，创建有意义的唯一 ID
   - 使用 update 操作更新现有实体信息，而不是使用 insert 创建新记录
10. **仔细阅读表格用途说明**：
    - 每个表格都有专门的"表格用途"说明，描述了该表格的功能和应记录的信息类型
    - 根据表格用途说明，准确判断哪些信息应该记录到哪个表格中
    - 确保提取的信息符合表格用途说明的要求

【唯一 ID 生成指南】
- 角色实体：使用姓名拼音或英文缩写 + 序号，如 "zhudi_001"、"zhangsan_001"
- 时空实体：使用地点/时间描述 + 序号，如 "park_001"、"20260407_001"
- 物品实体：使用物品名称 + 序号，如 "phone_001"、"money_001"
- 事件实体：使用事件描述 + 序号，如 "party_001"、"meeting_001"
- 确保唯一 ID 具有语义，便于识别

【变体称呼识别示例】
假设现有表格中有：
{
  "唯一id": "zhudi_001",
  "角色名": "朱迪·霍普斯",
  "身份": "警官",
  "关系": "主角",
  "特征": "兔子",
  "备注": ""
}

当聊天记录中出现：
- "朱迪说..." → 识别为 zhudi_001，使用 update 操作
- "朱迪小姐来了..." → 识别为 zhudi_001，使用 update 操作
- "那只兔子警官..." → 识别为 zhudi_001，使用 update 操作

【返回示例】
[
  {
    "sheetName": "物品表格",
    "operation": "insert",
    "data": {
      "流水号": "1",
      "唯一id": "money_001",
      "拥有人": "zhangsan_001",
      "物品描述": "人民币100元（拾取获得）",
      "物品名": "人民币100元",
      "重要原因": "拾取"
    },
    "condition": {},
    "description": "张三捡到100元钱，添加到物品表格"
  },
  {
    "sheetName": "角色表格",
    "operation": "update",
    "data": {
      "等级": "3",
      "力量": "10"
    },
    "condition": {
      "唯一id": "zhangsan_001"
    },
    "description": "张三升级，更新等级和力量值（识别为同一实体，使用update而非insert）"
  },
  {
    "sheetName": "角色表格",
    "operation": "insert",
    "data": {
      "流水号": "1",
      "唯一id": "zhudi_001",
      "角色名": "朱迪·霍普斯",
      "身份": "警官",
      "关系": "主角",
      "特征": "兔子",
      "备注": ""
    },
    "condition": {},
    "description": "朱迪·霍普斯首次出现，创建新角色记录"
  },
  {
    "sheetName": "角色表格",
    "operation": "update",
    "data": {
      "备注": "朱迪小姐帮助解决了案件"
    },
    "condition": {
      "唯一id": "zhudi_001"
    },
    "description": "朱迪小姐（识别为朱迪·霍普斯），更新备注信息"
  }
]

【现在开始处理】
请分析上述聊天记录，参考现有表格数据，重点关注变体称呼识别和唯一 ID 一致性，提取关键信息并生成JSON格式的操作指令。`;
  }

  /**
   * 调用 AI API
   */
  private async callAIAPI(
    prompt: string,
    apiKey: string,
    apiUrl: string,
    modelName: string
  ): Promise<string> {
    addLog('调用 AI API', 'debug');
    addLog(`API 地址: ${apiUrl}`, 'debug');
    addLog(`模型名称: ${modelName}`, 'debug');
    addLog(`提示词长度: ${prompt.length} 字符`, 'debug');
    addLog('===== AI 请求入参 =====', 'debug');
    addLog(prompt, 'debug');
    
    try {
      // 确定 API 模式（根据 URL 判断）
      const isChatCompletion = apiUrl.includes('/chat/completions');
      addLog(`API 模式: ${isChatCompletion ? '聊天补全' : '文本补全'}`, 'debug');
      
      // 构建请求体
      let requestBody: any;
      if (isChatCompletion) {
        // 聊天补全模式
        requestBody = {
          model: modelName,
          messages: [
            {
              role: "system",
              content: "你是一个专业的信息提取和表格整理助手，能够根据聊天记录和表格模板结构，准确提取关键信息并生成表格操作指令。"
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 10240,
          top_p: 0.9,
          frequency_penalty: 0.0,
          presence_penalty: 0.0,
          extra_body: {
            enable_thinking: false
          }
        };
      } else {
        // 文本补全模式
        requestBody = {
          model: modelName,
          prompt: prompt,
          temperature: 0.3,
          max_tokens: 10240,
          top_p: 0.9,
          frequency_penalty: 0.0,
          presence_penalty: 0.0
        };
      }
      
      addLog('发送 AI API 请求...', 'info');
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        addLog(`API 调用失败: ${response.status} ${response.statusText}`, 'error');
        addLog(`错误详情: ${errorText}`, 'error');
        throw new Error(`API 调用失败: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      addLog('等待 AI API 响应...', 'info');
      const data = await response.json();
      addLog('收到 AI API 完整响应', 'debug');
      addLog('===== AI 完整响应对象 =====', 'debug');
      addLog(JSON.stringify(data, null, 2), 'debug');
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error('API 响应格式错误: 没有返回 choices');
      }
      
      // 提取响应内容
      let aiResponse: string;
      if (isChatCompletion) {
        aiResponse = data.choices[0].message?.content?.trim() || '';
      } else {
        aiResponse = data.choices[0].text?.trim() || '';
      }
      
      // 验证响应内容
      if (!aiResponse) {
        throw new Error('AI 响应内容为空');
      }
      
      addLog('===== AI 回参文本 =====', 'debug');
      addLog(aiResponse, 'debug');
      addLog(`AI API 响应长度: ${aiResponse.length} 字符`, 'debug');
      
      return aiResponse;
    } catch (error) {
      addLog(`调用 AI API 失败: ${error}`, 'error');
      if (error instanceof Error) {
        addLog(`错误堆栈: ${error.stack}`, 'error');
      }
      throw error;
    }
  }

  /**
   * 带重试机制的 AI API 调用
   */
  private async callAIAPIWithRetry(
    prompt: string,
    apiKey: string,
    apiUrl: string,
    modelName: string,
    maxRetries: number = 3,
    retryDelay: number = 2000
  ): Promise<string> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`尝试调用 AI API (${i + 1}/${maxRetries})...`);
        const response = await this.callAIAPI(prompt, apiKey, apiUrl, modelName);
        console.log('AI API 调用成功');
        return response;
      } catch (error) {
        lastError = error as Error;
        console.error(`AI API 调用失败 (${i + 1}/${maxRetries}):`, lastError);
        
        if (i < maxRetries - 1) {
          console.log(`等待 ${retryDelay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('AI API 调用失败，已达到最大重试次数');
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(response: string): AIProcessingResult[] {
    try {
      const data = JSON.parse(response);
      const results: AIProcessingResult[] = [];
      
      Object.keys(data).forEach(sheetName => {
        const updates = data[sheetName];
        if (Array.isArray(updates)) {
          results.push({
            sheetName,
            updates,
            preview: `${sheetName}: ${updates.length} 条记录`
          });
        }
      });
      
      return results;
    } catch (error) {
      console.error('解析 AI 响应失败:', error);
      return [];
    }
  }

  /**
   * 解析 AI 操作指令
   */
  private parseAIOperations(response: string): any[] {
    addLog('开始解析 AI 操作指令', 'debug');
    addLog('原始响应内容:', 'debug');
    addLog(response, 'debug');
    
    try {
      // 清理响应内容，移除可能的前缀或后缀
      let cleanedResponse = response.trim();
      addLog(`清理后响应长度: ${cleanedResponse.length}`, 'debug');
      
      // 处理可能的JSON格式问题
      // 移除可能的代码块标记
      if (cleanedResponse.startsWith('```json')) {
        addLog('检测到 ```json 前缀，正在移除', 'debug');
        cleanedResponse = cleanedResponse.substring(7);
      }
      if (cleanedResponse.endsWith('```')) {
        addLog('检测到 ``` 后缀，正在移除', 'debug');
        cleanedResponse = cleanedResponse.substring(0, cleanedResponse.length - 3);
      }
      
      // 再次清理
      cleanedResponse = cleanedResponse.trim();
      addLog(`最终清理后响应: ${cleanedResponse}`, 'debug');
      
      // 尝试解析JSON
      addLog('尝试解析 JSON', 'debug');
      const operations = JSON.parse(cleanedResponse);
      addLog('JSON 解析成功', 'debug');
      
      // 确保返回的是数组
      if (Array.isArray(operations)) {
        addLog(`成功解析 ${operations.length} 个操作指令`, 'info');
        
        // 如果是空数组，记录警告但不抛出错误
        if (operations.length === 0) {
          addLog('警告: AI 返回了空操作指令数组', 'warn');
          // 这里不抛出错误，而是返回空数组，让上层处理
        }
        
        addLog('操作指令详情:', 'debug');
        operations.forEach((op, index) => {
          addLog(`  ${index + 1}. ${op.operation} - ${op.sheetName}`, 'debug');
        });
        
        return operations;
      } else {
        addLog(`AI 响应不是数组格式，类型: ${typeof operations}`, 'error');
        addLog(`响应内容: ${JSON.stringify(operations)}`, 'error');
        throw new Error('AI 响应不是数组格式');
      }
    } catch (error) {
      addLog(`解析 AI 操作指令失败: ${error}`, 'error');
      if (error instanceof Error) {
        addLog(`错误堆栈: ${error.stack}`, 'error');
      }
      addLog('AI 响应原始内容:', 'error');
      addLog(response, 'error');
      throw error;
    }
  }

  /**
   * 应用 AI 处理结果到表格文件（JSON格式）
   */
  public applyAIResults(chatId: string, results: AIProcessingResult[]): string {
    // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = chatId
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\s+/g, '_')
      .replace(/@/g, '_')
      .replace(/-/g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_');

    // 构建JSON文件路径
    const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);

    if (!fs.existsSync(jsonPath)) {
      throw new Error('表格文件不存在');
    }

    // 读取JSON文件
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    results.forEach(result => {
      if (jsonData.data[result.sheetName]) {
        // 添加新数据
        result.updates.forEach(update => {
          jsonData.data[result.sheetName].push(update);
        });
      }
    });

    // 保存JSON文件
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    return jsonPath;
  }

  /**
   * 生成唯一ID
   */
  private generateUniqueId(): string {
    return `id_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  /**
   * 生成流水号
   */
  private generateSerialNumber(sheetData: any[]): number {
    if (sheetData.length === 0) {
      return 1;
    }
    const serialNumbers = sheetData.map(item => parseInt(item['流水号'] || '0')).filter(num => !isNaN(num));
    return serialNumbers.length > 0 ? Math.max(...serialNumbers) + 1 : 1;
  }

  /**
   * 检查是否为现有实体
   */
  private isExistingEntity(sheetData: any[], data: any): boolean {
    if (!data['唯一id']) {
      return false;
    }
    return sheetData.some(item => item['唯一id'] === data['唯一id']);
  }

  /**
   * 执行表格操作（JSON格式）
   */
  private executeTableOperations(chatId: string, templateId: string, operations: any[]): string {
    try {
      // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
      const safeChatId = chatId
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .replace(/\s+/g, '_')
        .replace(/@/g, '_')
        .replace(/-/g, '_')
        .replace(/:/g, '_')
        .replace(/\*/g, '_')
        .replace(/\?/g, '_')
        .replace(/"/g, '_')
        .replace(/</g, '_')
        .replace(/>/g, '_')
        .replace(/\|/g, '_');
      
      // 确保目录存在
      if (!fs.existsSync(this.chatlogDir)) {
        addLog(`目录 ${this.chatlogDir} 不存在，创建目录`, 'info');
        fs.mkdirSync(this.chatlogDir, { recursive: true });
      }
      
      // 构建JSON文件路径
      const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
      addLog(`尝试访问 JSON 文件: ${jsonPath}`, 'info');
      addLog(`检查文件是否存在: ${fs.existsSync(jsonPath) ? '是' : '否'}`, 'info');
      
      // 读取或创建JSON文件
      let jsonData = { sheets: [], data: {} };
      if (fs.existsSync(jsonPath)) {
        addLog(`读取现有 JSON 文件: ${jsonPath}`, 'info');
        const existingData = fs.readFileSync(jsonPath, 'utf8');
        jsonData = JSON.parse(existingData);
      } else {
        addLog(`JSON 文件不存在，创建新文件: ${jsonPath}`, 'info');
        // 从模板中获取工作表信息
        const template = tableTemplateService.getTemplate(templateId);
        if (template) {
          addLog(`从模板 ${templateId} 中获取工作表信息`, 'info');
          // 初始化工作表和数据
          jsonData = {
            sheets: template.sheets.map(sheet => sheet.name),
            data: {}
          };
          // 为每个工作表初始化数据
          template.sheets.forEach(sheet => {
            jsonData.data[sheet.name] = [];
          });
        } else {
          addLog(`模板 ${templateId} 不存在，使用默认数据结构`, 'warn');
          // 初始化默认数据结构
          jsonData = { sheets: [], data: {} };
        }
      }
      
      addLog(`JSON 文件包含的工作表: ${jsonData.sheets.join(', ')}`, 'info');
      
      // 执行操作
      let operationCount = 0;
      operations.forEach((operation, index) => {
        try {
          const { sheetName, operation: opType, data, condition, description } = operation;
          
          addLog(`执行操作 ${index + 1}/${operations.length}: ${opType} 到 ${sheetName}`, 'info');
          addLog(`操作数据: ${JSON.stringify(data)}`, 'debug');
          addLog(`操作条件: ${JSON.stringify(condition)}`, 'debug');
          addLog(`操作说明: ${description}`, 'debug');
          
          // 确保工作表存在
          if (!jsonData.sheets.includes(sheetName)) {
            addLog(`工作表 ${sheetName} 不存在，创建新工作表`, 'info');
            jsonData.sheets.push(sheetName);
            jsonData.data[sheetName] = [];
          }
          
          let sheetData = jsonData.data[sheetName] || [];
          addLog(`工作表 ${sheetName} 当前数据行数: ${sheetData.length}`, 'debug');
          
          if (opType === 'insert') {
            // 检查是否为现有实体
            const isExisting = this.isExistingEntity(sheetData, data);
            if (isExisting) {
              // 更新现有实体
              for (let i = 0; i < sheetData.length; i++) {
                if (sheetData[i]['唯一id'] === data['唯一id']) {
                  Object.assign(sheetData[i], data);
                  addLog(`执行更新操作成功，更新现有实体`, 'info');
                  operationCount++;
                  break;
                }
              }
            } else {
              // 为新实体生成唯一ID和流水号
              const newData = { ...data };
              if (!newData['唯一id']) {
                newData['唯一id'] = this.generateUniqueId();
              }
              newData['流水号'] = this.generateSerialNumber(sheetData);
              sheetData.push(newData);
              addLog(`执行插入操作成功，创建新实体`, 'info');
              operationCount++;
            }
          } else if (opType === 'update') {
            // 执行更新操作
            for (let i = 0; i < sheetData.length; i++) {
              let match = true;
              for (const [key, value] of Object.entries(condition)) {
                if (sheetData[i][key] !== value) {
                  match = false;
                  break;
                }
              }
              if (match) {
                Object.assign(sheetData[i], data);
                addLog(`执行更新操作成功`, 'info');
                operationCount++;
                break;
              }
            }
          } else if (opType === 'delete') {
            // 执行删除操作
            const initialLength = sheetData.length;
            sheetData = sheetData.filter(row => {
              for (const [key, value] of Object.entries(condition)) {
                if (row[key] !== value) {
                  return true;
                }
              }
              return false;
            });
            if (sheetData.length < initialLength) {
              addLog(`执行删除操作成功`, 'info');
              operationCount++;
            }
          } else {
            addLog(`未知的操作类型: ${opType}`, 'warn');
          }
          
          // 更新工作表数据
          jsonData.data[sheetName] = sheetData;
          addLog(`更新工作表 ${sheetName} 成功`, 'info');
        } catch (error) {
          addLog(`执行操作 ${index + 1} 失败: ${error}`, 'error');
        }
      });
      
      // 保存 JSON 文件
      addLog(`保存 JSON 文件: ${jsonPath}`, 'info');
      try {
        fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
        addLog(`文件保存成功`, 'info');
      } catch (saveError) {
        addLog(`保存 JSON 文件失败: ${saveError}`, 'error');
        if (saveError instanceof Error) {
          addLog(`错误堆栈: ${saveError.stack}`, 'error');
        }
        throw saveError;
      }
      addLog(`保存 JSON 文件成功`, 'info');
      addLog(`共执行 ${operationCount} 个操作`, 'info');
      
      // 如果没有执行任何操作，记录警告但不抛出错误
      if (operationCount === 0) {
        addLog('警告: 没有执行任何表格操作（AI 可能没有从聊天记录中提取到可操作的信息）', 'warn');
      }
      
      return jsonPath;
    } catch (error) {
      addLog(`执行表格操作失败: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * 执行插入操作
   */
  private executeInsertOperation(data: any[], newRow: any): void {
    // 获取表头
    const headers = data[0];
    
    // 构建新行
    const row = headers.map(header => newRow[header] || '');
    
    // 添加新行
    data.push(row);
  }

  /**
   * 执行更新操作
   */
  private executeUpdateOperation(data: any[], updates: any, condition: any): void {
    // 获取表头
    const headers = data[0];
    
    // 遍历数据行
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let match = true;
      
      // 检查是否匹配条件
      for (const [key, value] of Object.entries(condition)) {
        const headerIndex = headers.indexOf(key);
        if (headerIndex === -1 || row[headerIndex] !== value) {
          match = false;
          break;
        }
      }
      
      // 如果匹配，更新数据
      if (match) {
        for (const [key, value] of Object.entries(updates)) {
          const headerIndex = headers.indexOf(key);
          if (headerIndex !== -1) {
            row[headerIndex] = value;
          }
        }
      }
    }
  }

  /**
   * 执行删除操作
   */
  private executeDeleteOperation(data: any[], condition: any): void {
    // 获取表头
    const headers = data[0];
    
    // 遍历数据行，从后往前删除
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      let match = true;
      
      // 检查是否匹配条件
      for (const [key, value] of Object.entries(condition)) {
        const headerIndex = headers.indexOf(key);
        if (headerIndex === -1 || row[headerIndex] !== value) {
          match = false;
          break;
        }
      }
      
      // 如果匹配，删除行
      if (match) {
        data.splice(i, 1);
      }
    }
  }

  /**
   * 删除聊天会话
   */
  public deleteChatSession(chatId: string): boolean {
    const excelPath = path.join(this.chatlogDir, `${chatId}.xlsx`);
    
    if (fs.existsSync(excelPath)) {
      fs.unlinkSync(excelPath);
      return true;
    }
    
    return false;
  }

  /**
   * 关联模板到聊天会话
   */
  public associateTemplate(chatId: string, templateId: string): void {
    console.log(`关联模板 ${templateId} 到聊天会话 ${chatId}`);
    
    try {
      // 1. 读取原始模板
      const originalTemplate = tableTemplateService.getTemplate(templateId);
      if (!originalTemplate) {
        throw new Error(`模板 ${templateId} 不存在`);
      }
      
      // 2. 创建模板副本
      // 移除 chatId 中的路径分隔符和特殊字符，避免文件路径错误
      const safeChatId = chatId
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .replace(/\s+/g, '_')
        .replace(/@/g, '_')
        .replace(/-/g, '_')
        .replace(/:/g, '_')
        .replace(/\*/g, '_')
        .replace(/\?/g, '_')
        .replace(/"/g, '_')
        .replace(/</g, '_')
        .replace(/>/g, '_')
        .replace(/\|/g, '_');
      
      const templateCopy = {
        ...originalTemplate,
        id: `${templateId}_${safeChatId}_${Date.now()}`,
        name: `${originalTemplate.name} - ${safeChatId}`,
        isCopy: true,
        originalTemplateId: templateId,
        chatId: chatId
      };
      
      // 3. 保存模板副本
      tableTemplateService.saveTemplate(templateCopy);
      console.log(`模板副本创建成功: ${templateCopy.id}`);
      
      // 4. 创建表格文件（JSON格式）
      const jsonPath = tableTemplateService.createTableFile(chatId, templateCopy.id, safeChatId);
      console.log(`表格文件创建成功: ${jsonPath}`);
      
      // 5. 存储关联关系
      this.saveAssociation(chatId, templateCopy.id);
      console.log(`关联关系存储成功: ${chatId} -> ${templateCopy.id}`);
      
    } catch (error) {
      console.error('关联模板失败:', error);
      throw error;
    }
  }

  /**
   * 保存关联关系
   */
  private saveAssociation(chatId: string, templateId: string): void {
    const associationsPath = path.join(this.chatsDir, 'associations.json');
    
    // 确保chats目录存在
    if (!fs.existsSync(this.chatsDir)) {
      fs.mkdirSync(this.chatsDir, { recursive: true });
    }
    
    let associations: Record<string, string> = {};
    
    // 读取现有关联关系
    if (fs.existsSync(associationsPath)) {
      try {
        const content = fs.readFileSync(associationsPath, 'utf-8');
        associations = JSON.parse(content);
      } catch (error) {
        console.error('读取关联关系失败:', error);
        associations = {};
      }
    }
    
    // 保存新的关联关系
    associations[chatId] = templateId;
    
    // 写入文件
    fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
  }



  /**
   * 获取聊天会话关联的模板
   */
  public getAssociatedTemplate(chatId: string): string | null {
    const associationsPath = path.join(this.chatsDir, 'associations.json');
    
    if (fs.existsSync(associationsPath)) {
      try {
        const content = fs.readFileSync(associationsPath, 'utf-8');
        const associations: Record<string, string> = JSON.parse(content);
        return associations[chatId] || null;
      } catch (error) {
        console.error('读取关联关系失败:', error);
      }
    }
    
    return null;
  }

  /**
   * 处理聊天记录，提取信息到表格
   */
  public async processChat(chatId: string, templateId: string, selectedMessageIds?: string[], config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }): Promise<void> {
    addLog(`开始处理聊天记录: ${chatId}`, 'info');
    addLog(`使用模板: ${templateId}`, 'info');
    addLog(`选中消息数量: ${selectedMessageIds?.length || '全部'}`, 'debug');
    
    try {
      // 1. 读取聊天记录
      addLog('步骤 1/12: 读取聊天记录', 'debug');
      const messages = this.getChatMessages(chatId).messages;
      addLog(`共读取 ${messages.length} 条消息`, 'debug');
      
      if (messages.length === 0) {
        throw new Error('没有聊天记录可处理');
      }
      
      // 2. 筛选选中的聊天记录（如果指定了）
      addLog('步骤 2/12: 筛选消息', 'debug');
      let targetMessages = messages;
      if (selectedMessageIds && selectedMessageIds.length > 0) {
        targetMessages = messages.filter(msg => selectedMessageIds.includes(msg.id));
        addLog(`筛选后剩余 ${targetMessages.length} 条消息`, 'debug');
        if (targetMessages.length === 0) {
          throw new Error('没有选中的聊天记录可处理');
        }
      }
      
      // 3. 按时间顺序排序
      addLog('步骤 3/12: 按时间排序', 'debug');
      targetMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // 4. 获取关联的模板
      addLog('步骤 4/12: 获取模板信息', 'debug');
      const template = tableTemplateService.getTemplate(templateId);
      if (!template) {
        throw new Error(`模板 ${templateId} 不存在`);
      }
      addLog(`模板名称: ${template.name}`, 'debug');
      addLog(`模板包含 ${template.sheets?.length || 0} 个页签`, 'debug');
      
      // 5. 构建提示词
      addLog('步骤 5/12: 构建 AI 提示词', 'debug');
      const prompt = this.buildAIPrompt(targetMessages, template, chatId);
      
      // 6. 确定 AI 配置
      addLog('步骤 6/12: 配置 AI 参数', 'debug');
      const aiConfig = {
        apiKey: config?.apiKey || '',
        apiUrl: config?.apiUrl || 'http://127.0.0.1:5000',
        modelName: config?.modelName || 'qwen3.5-27b-heretic-v3',
        apiMode: config?.apiMode || 'text_completion'
      };
      
      addLog('使用 AI 配置:', 'debug');
      addLog(`  API 密钥: ${aiConfig.apiKey ? '已设置' : '未设置'}`, 'debug');
      addLog(`  API 地址: ${aiConfig.apiUrl}`, 'debug');
      addLog(`  模型名称: ${aiConfig.modelName}`, 'debug');
      addLog(`  API 模式: ${aiConfig.apiMode}`, 'debug');
      
      // 根据 API 模式设置正确的 API 端点
      let apiEndpoint = aiConfig.apiUrl;
      if (aiConfig.apiMode === 'text_completion') {
        if (!apiEndpoint.endsWith('/v1/completions')) {
          apiEndpoint += '/v1/completions';
        }
      } else {
        if (!apiEndpoint.endsWith('/v1/chat/completions')) {
          apiEndpoint += '/v1/chat/completions';
        }
      }
      addLog(`最终 API 端点: ${apiEndpoint}`, 'debug');
      
      // 7. 调用 AI API
      addLog('步骤 7/12: 调用 AI API', 'info');
      
      // 发送实时更新：开始调用 AI
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer('表格整理: 正在发送请求到 AI 服务器...', 'info');
      }
      
      const aiResponse = await this.callAIAPIWithRetry(prompt, aiConfig.apiKey, apiEndpoint, aiConfig.modelName);
      
      // 发送实时更新：AI 响应完成
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer('表格整理: AI 响应完成，正在解析...', 'info');
      }
      
      // 8. 验证 AI 响应
      addLog('步骤 8/12: 验证 AI 响应', 'debug');
      if (!aiResponse || aiResponse.trim() === '') {
        throw new Error('AI 服务器未返回响应');
      }
      
      // 9. 解析 AI 响应
      addLog('步骤 9/12: 解析 AI 响应', 'debug');
      const operations = this.parseAIOperations(aiResponse);
      addLog(`AI 处理完成，得到 ${operations.length} 个操作指令`, 'info');
      
      // 发送实时更新：解析完成
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer(`表格整理: 解析完成，共 ${operations.length} 个操作指令`, 'info');
      }
      
      // 10. 执行表格操作
      addLog('步骤 10/12: 执行表格操作', 'info');
      
      // 发送实时更新：开始执行表格操作
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer('表格整理: 开始执行表格操作...', 'info');
      }
      
      const tablePath = this.executeTableOperations(chatId, templateId, operations);
      addLog(`执行表格操作完成，表格文件: ${tablePath}`, 'info');
      
      // 发送实时更新：表格操作完成
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer('表格整理: 表格操作完成', 'info');
      }
      
      // 11. 验证表格操作结果
      addLog('步骤 11/12: 验证操作结果', 'debug');
      if (!tablePath) {
        throw new Error('表格操作失败，未生成文件');
      }
      
      // 12. 存储处理结果
      addLog('步骤 12/12: 保存处理结果', 'debug');
      this.saveProcessingResult(chatId, templateId, operations);
      addLog(`处理聊天记录 ${chatId} 完成`, 'info');
      
      // 发送实时更新：处理完成
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer('表格整理: 处理完成', 'info');
      }
      
    } catch (error) {
      addLog(`处理聊天记录失败: ${error}`, 'error');
      if (error instanceof Error) {
        addLog(`错误堆栈: ${error.stack}`, 'error');
      }
      
      // 发送实时更新：处理失败
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer(`表格整理失败: ${error}`, 'error');
      }
      
      throw error;
    }
  }

  /**
   * 将聊天记录按逻辑段落分割
   */
  private splitChatIntoSegments(messages: ChatMessage[]): ChatMessage[][] {
    const segments: ChatMessage[][] = [];
    let currentSegment: ChatMessage[] = [];
    
    messages.forEach((message, index) => {
      currentSegment.push(message);
      
      // 按对话轮次分割（用户和 AI 各一条消息为一轮）
      if (message.role === 'assistant' && index < messages.length - 1 && messages[index + 1].role === 'user') {
        segments.push([...currentSegment]);
        currentSegment = [];
      }
    });
    
    // 添加最后一个段落
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
    
    return segments;
  }



  /**
   * 保存处理结果
   */
  private saveProcessingResult(chatId: string, templateId: string, operations: any[]): void {
    const resultsPath = path.join(this.chatlogDir, `${chatId}_processing_results.json`);
    
    const processingResult = {
      chatId,
      templateId,
      operations,
      processedAt: new Date().toISOString()
    };
    
    try {
      fs.writeFileSync(resultsPath, JSON.stringify(processingResult, null, 2), 'utf-8');
      console.log(`处理结果已保存: ${resultsPath}`);
      
      // 同时标记会话为已处理
      this.setSessionProcessedStatus(chatId, true);
      console.log(`会话 ${chatId} 已标记为已处理`);
    } catch (error) {
      console.error('保存处理结果失败:', error);
      // 不抛出错误，继续执行
    }
  }

  /**
   * 获取会话是否已处理的状态
   */
  private getSessionProcessedStatus(chatId: string): boolean {
    const statusPath = path.join(this.chatlogDir, 'processed_sessions.json');
    
    try {
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf-8');
        const statuses = JSON.parse(content);
        return statuses[chatId] || false;
      }
    } catch (error) {
      console.error('读取会话处理状态失败:', error);
    }
    
    return false;
  }

  /**
   * 设置会话是否已处理的状态
   */
  public setSessionProcessedStatus(chatId: string, isProcessed: boolean): void {
    const statusPath = path.join(this.chatlogDir, 'processed_sessions.json');
    
    try {
      // 确保目录存在
      if (!fs.existsSync(this.chatlogDir)) {
        fs.mkdirSync(this.chatlogDir, { recursive: true });
      }
      
      // 读取现有状态
      let statuses: Record<string, boolean> = {};
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf-8');
        statuses = JSON.parse(content);
      }
      
      // 更新状态
      statuses[chatId] = isProcessed;
      
      // 保存文件
      fs.writeFileSync(statusPath, JSON.stringify(statuses, null, 2), 'utf-8');
      console.log(`会话 ${chatId} 的处理状态已设置为: ${isProcessed}`);
    } catch (error) {
      console.error('设置会话处理状态失败:', error);
    }
  }

  /**
   * 获取表格数据（JSON格式）
   */
  public getTableData(chatId: string): any {
    // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = chatId
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\s+/g, '_')
      .replace(/@/g, '_')
      .replace(/-/g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_');
    
    // 构建JSON文件路径
    const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
    
    console.log('=== 开始获取表格数据 ===');
    console.log('原始 chatId:', chatId);
    console.log('转换后的 safeChatId:', safeChatId);
    console.log('聊天记录存储目录:', this.chatlogDir);
    console.log('使用JSON文件路径:', jsonPath);
    
    // 检查文件是否存在
    if (!fs.existsSync(jsonPath)) {
      console.error('文件不存在:', jsonPath);
      throw new Error(`文件不存在: ${jsonPath}`);
    }
    
    // 检查文件是否可读
    try {
      fs.accessSync(jsonPath, fs.constants.R_OK);
      console.log('文件可读');
    } catch (accessError) {
      console.error('文件不可读:', accessError);
      throw new Error(`文件不可读: ${jsonPath}`);
    }
    
    // 检查文件大小
    try {
      const stats = fs.statSync(jsonPath);
      console.log('文件大小:', stats.size, '字节');
    } catch (statError) {
      console.error('获取文件信息失败:', statError);
    }
    
    // 直接尝试读取文件
    try {
      console.log('开始读取JSON文件...');
      const jsonData = fs.readFileSync(jsonPath, 'utf8');
      const parsedData = JSON.parse(jsonData);
      
      // 确保数据结构正确
      const sheets = parsedData.sheets || [];
      const headers = parsedData.headers || {};
      const data = parsedData.data || {};
      
      console.log('工作表名称:', sheets);
      console.log('表头信息:', headers);
      Object.keys(data).forEach(sheetName => {
        console.log(`工作表 ${sheetName} 数据行数:`, data[sheetName].length);
      });
      
      console.log('=== 获取表格数据完成 ===');
      return { sheets, headers, data };
    } catch (error) {
      console.error('读取JSON文件失败:', error);
      throw new Error(`读取JSON文件失败: ${error.message}`);
    }
  }

  /**
   * 保存表格数据（JSON格式）
   */
  public saveTableData(chatId: string, sheetName: string, sheetData: any[]): void {
    try {
      // 替换 chatId 中的路径分隔符和特殊字符，避免文件路径错误
      const safeChatId = chatId
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .replace(/\s+/g, '_')
        .replace(/@/g, '_')
        .replace(/-/g, '_')
        .replace(/:/g, '_')
        .replace(/\*/g, '_')
        .replace(/\?/g, '_')
        .replace(/"/g, '_')
        .replace(/</g, '_')
        .replace(/>/g, '_')
        .replace(/\|/g, '_');
      
      // 确保目录存在
      if (!fs.existsSync(this.chatlogDir)) {
        fs.mkdirSync(this.chatlogDir, { recursive: true });
      }
      
      // 构建JSON文件路径
      const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
      
      console.log('保存表格数据:', chatId, sheetName, sheetData.length);
      
      // 读取现有文件或创建新文件
      let jsonData = { sheets: [], data: {} };
      if (fs.existsSync(jsonPath)) {
        console.log('读取现有JSON文件');
        const existingData = fs.readFileSync(jsonPath, 'utf8');
        jsonData = JSON.parse(existingData);
      } else {
        console.log('创建新JSON文件');
      }
      
      // 更新工作表数据
      if (!jsonData.sheets.includes(sheetName)) {
        jsonData.sheets.push(sheetName);
      }
      jsonData.data[sheetName] = sheetData;
      
      // 保存文件
      fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
      console.log('JSON文件保存成功:', jsonPath);
    } catch (error) {
      console.error('保存表格数据失败:', error);
      throw error;
    }
  }
}

// ========== 外部系统调用 API ==========

/**
 * 单条聊天记录整理请求参数
 */
export interface ExternalProcessSingleChatRequest {
  chatId: string;
  templateId: string;
  config?: {
    apiKey: string;
    apiUrl: string;
    modelName: string;
    apiMode: string;
  };
  selectedMessageIds?: string[];
}

/**
 * 多条聊天记录批量整理请求参数
 */
export interface ExternalProcessBatchChatRequest {
  chatIds: string[];
  templateId: string;
  config?: {
    apiKey: string;
    apiUrl: string;
    modelName: string;
    apiMode: string;
  };
  selectedMessageIds?: string[];
}

/**
 * 单条聊天记录整理响应
 */
export interface ExternalProcessSingleChatResponse {
  success: boolean;
  chatId: string;
  tablePath?: string;
  error?: string;
}

/**
 * 多条聊天记录批量整理响应
 */
export interface ExternalProcessBatchChatResponse {
  success: boolean;
  results: Array<{
    chatId: string;
    success: boolean;
    tablePath?: string;
    error?: string;
  }>;
  totalCount: number;
  successCount: number;
  failureCount: number;
}

/**
 * 外部系统调用服务
 * 提供给其他系统调用的表格整理接口
 */
export class ExternalTableProcessingService {
  private chatLogService: ChatLogService;

  constructor(chatLogService: ChatLogService) {
    this.chatLogService = chatLogService;
  }

  /**
   * 处理单条聊天记录
   * @param request 单条整理请求
   * @returns 整理结果
   */
  public async processSingleChat(request: ExternalProcessSingleChatRequest): Promise<ExternalProcessSingleChatResponse> {
    try {
      console.log('[External API] 开始处理单条聊天记录:', request.chatId);
      
      await this.chatLogService.processChat(
        request.chatId,
        request.templateId,
        request.selectedMessageIds,
        request.config
      );
      
      const tableData = this.chatLogService.getTableData(request.chatId);
      
      console.log('[External API] 单条聊天记录处理成功:', request.chatId);
      
      return {
        success: true,
        chatId: request.chatId,
        tablePath: tableData?.filePath || ''
      };
    } catch (error) {
      console.error('[External API] 单条聊天记录处理失败:', request.chatId, error);
      return {
        success: false,
        chatId: request.chatId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 批量处理多条聊天记录
   * @param request 批量整理请求
   * @returns 批量整理结果
   */
  public async processBatchChat(request: ExternalProcessBatchChatRequest): Promise<ExternalProcessBatchChatResponse> {
    console.log('[External API] 开始批量处理聊天记录，总数:', request.chatIds.length);
    
    const results: ExternalProcessBatchChatResponse['results'] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const chatId of request.chatIds) {
      try {
        console.log('[External API] 处理聊天记录:', chatId);
        
        await this.chatLogService.processChat(
          chatId,
          request.templateId,
          request.selectedMessageIds,
          request.config
        );
        
        const tableData = this.chatLogService.getTableData(chatId);
        
        results.push({
          chatId,
          success: true,
          tablePath: tableData?.filePath || ''
        });
        successCount++;
        
        console.log('[External API] 聊天记录处理成功:', chatId);
      } catch (error) {
        console.error('[External API] 聊天记录处理失败:', chatId, error);
        results.push({
          chatId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
        failureCount++;
      }
    }

    console.log('[External API] 批量处理完成，成功:', successCount, '失败:', failureCount);

    return {
      success: failureCount === 0,
      results,
      totalCount: request.chatIds.length,
      successCount,
      failureCount
    };
  }

  /**
   * 获取聊天会话列表
   * @returns 聊天会话列表
   */
  public getChatSessions() {
    return this.chatLogService.getChatSessions();
  }

  /**
   * 获取聊天消息
   * @param chatId 聊天会话ID
   * @param page 页码
   * @param pageSize 每页数量
   * @returns 聊天消息
   */
  public getChatMessages(chatId: string, page: number = 1, pageSize: number = 100) {
    return this.chatLogService.getChatMessages(chatId, page, pageSize);
  }

  /**
   * 获取表格数据
   * @param chatId 聊天会话ID
   * @returns 表格数据
   */
  public getTableData(chatId: string) {
    return this.chatLogService.getTableData(chatId);
  }

  /**
   * 关联模板到聊天会话
   * @param chatId 聊天会话ID
   * @param templateId 模板ID
   */
  public associateTemplate(chatId: string, templateId: string) {
    this.chatLogService.associateTemplate(chatId, templateId);
  }
}

// 先创建 chatLogService 实例
export const chatLogService = new ChatLogService();

// 再创建外部服务实例（确保 chatLogService 已初始化）
export const externalTableProcessingService = new ExternalTableProcessingService(chatLogService);
