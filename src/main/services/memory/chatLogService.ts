/**
 * 聊天记录管理服务
 * 负责管理聊天记录的读取、搜索、筛选和 AI 处理
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import { tableEditParser, TableEditCommand } from './tableEditParser';
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
  organizingProgress?: { processedCount: number; totalMessages: number; lastProcessedAt?: string };
}

export interface AssociationRecord {
  templateId: string;
  processedCount: number;
  totalMessages: number;
  lastProcessedAt?: string;
}

export interface AIProcessingResult {
  sheetName: string;
  updates: Record<string, any>[];
  preview: string;
}

// 整理选项接口
export interface OrganizeOptions {
  continueFromLast?: boolean; // 是否从上次位置继续（实时整理）
  restart?: boolean; // 是否重新开始（完全整理）
  minInterval?: number; // 最小间隔时间（毫秒），用于防抖
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
  
  // 整理锁机制，防止并发整理
  private organizingLocks: Map<string, { isOrganizing: boolean; lastOrganizeTime: number; organizeType: 'auto' | 'manual' }> = new Map();

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
   * 检查是否可以开始整理（防抖和并发控制）
   * @param chatId 聊天ID
   * @param minInterval 最小间隔时间（毫秒），默认3000ms
   * @returns 是否可以开始整理
   */
  private canStartOrganize(chatId: string, minInterval: number = 3000): boolean {
    const lock = this.organizingLocks.get(chatId);
    
    if (!lock) {
      return true; // 没有锁记录，可以开始
    }
    
    if (lock.isOrganizing) {
      addLog(`[${chatId}] 整理任务正在执行中，跳过本次请求`, 'warn');
      return false; // 正在整理中
    }
    
    const now = Date.now();
    const timeSinceLastOrganize = now - lock.lastOrganizeTime;
    
    if (timeSinceLastOrganize < minInterval) {
      addLog(`[${chatId}] 整理间隔过短（${timeSinceLastOrganize}ms < ${minInterval}ms），跳过本次整理`, 'warn');
      return false; // 间隔过短
    }
    
    return true;
  }

  /**
   * 设置整理锁
   * @param chatId 聊天ID
   * @param organizeType 整理类型
   */
  private setOrganizingLock(chatId: string, organizeType: 'auto' | 'manual' = 'auto'): void {
    this.organizingLocks.set(chatId, {
      isOrganizing: true,
      lastOrganizeTime: Date.now(),
      organizeType
    });
    addLog(`[${chatId}] 设置整理锁 (${organizeType === 'auto' ? '实时整理' : '完全整理'})`, 'debug');
  }

  /**
   * 释放整理锁
   * @param chatId 聊天ID
   */
  private releaseOrganizingLock(chatId: string): void {
    const lock = this.organizingLocks.get(chatId);
    if (lock) {
      this.organizingLocks.set(chatId, {
        isOrganizing: false,
        lastOrganizeTime: Date.now(),
        organizeType: lock.organizeType
      });
      addLog(`[${chatId}] 释放整理锁`, 'debug');
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
                  const templateId = this.getAssociatedTemplate(chatId);
                  session.templateId = templateId;
                  session.isTemplateAssociated = !!templateId;
                  session.isProcessed = this.getSessionProcessedStatus(chatId);
                  const progress = this.getOrganizingProgress(chatId);
                  if (progress) {
                    session.organizingProgress = progress;
                  }
                  sessions.push(session);
                  console.log(`添加聊天会话: ${session.name} (${session.characterName})${templateId ? ` - 已关联模板` : ''}${session.isProcessed ? ' - 已整理' : ''}${progress ? ` - 整理进度 ${progress.processedCount}/${progress.totalMessages}` : ''}`);
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
   * 读取角色卡聊天记录（.json 格式）
   * 角色卡聊天记录存储在 data/memories/chats/ 目录下，格式为 { messages: [...] }
   */
  private readCharacterChatMessages(chatId: string): ChatMessage[] {
    try {
      const jsonFilePath = path.join(this.chatsDir, `${chatId}.json`);

      if (!fs.existsSync(jsonFilePath)) {
        addLog(`角色卡聊天记录文件不存在: ${jsonFilePath}`, 'debug');
        return [];
      }

      const content = fs.readFileSync(jsonFilePath, 'utf-8');
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed.messages)) {
        return [];
      }

      const messages: ChatMessage[] = [];
      parsed.messages.forEach((msg: any, index: number) => {
        const role = msg.role || (msg.is_user ? 'user' : (msg.is_system ? 'system' : 'assistant'));
        messages.push({
          id: `${chatId}-json-${index}`,
          role,
          content: msg.content || msg.mes || '',
          timestamp: msg.timestamp || msg.send_date || new Date().toISOString(),
          chatId
        });
      });

      addLog(`从角色卡聊天记录读取到 ${messages.length} 条消息`, 'debug');
      return messages;
    } catch (error) {
      addLog(`读取角色卡聊天记录失败: ${error}`, 'warn');
      return [];
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
   * 构建逐条处理模式的AI提示词(支持tableEdit命令格式)
   * @param message 当前要处理的消息
   * @param template 模板信息
   * @param chatId 聊天ID
   * @param tableContext 当前表格数据上下文
   * @returns 格式化的提示词
   */
  private buildAIPromptForProgressive(
    message: ChatMessage,
    template: any,
    chatId: string,
    tableContext: string
  ): string {
    // 构建模板结构描述
    const templateDescription = template.sheets.map((sheet: any, index: number) => {
      return `- [索引${index + 1}] ${sheet.name}：字段包括 [${sheet.headers.map((h: string, i: number) => `${i + 1}:${h}`).join(', ')}]
  表格用途：${sheet.description || '暂无描述'}`;
    }).join('\n');

    return `【角色设定】
你是一个专业的信息提取和表格整理专家，擅长从单条消息中提取关键信息并生成精确的tableEdit命令。你特别擅长识别不同称呼（appellations）的同一元素，并通过唯一ID策略确保实体识别的一致性。

【当前消息】
${message.role}: ${message.content}

${tableContext}

【表格模板结构】
${templateDescription}

【tableEdit命令格式】
你需要将操作指令放在<tableEdit>标签内,使用HTML注释格式:

<tableEdit>
<!-- 
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
-->
</tableEdit>

参数说明:
- 表格索引: 从1开始,对应模板中页签的顺序
- 行索引: 从1开始,对应该表格中的数据行索引
- 字段索引: 从1开始,对应该表格表头的字段索引
- 每个表格的字段结构固定为: [1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增,通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成,需具有语义且保持一致性

示例(以时空表格为例,字段为[1:流水号,2:唯一id,3:时间,4:地点,5:描述,6:备注]):
- insertRow(1, {"2":"oct_school_001","3":"十月","4":"学校","5":"下雪天","6":""}) 
  → 在第1个表格新增一行:唯一id=oct_school_001,时间=十月,地点=学校,描述=下雪天
- updateRow(5, 2, {"2":"xiaohua_001","3":"小花","4":"破坏表白失败"})
  → 修改第5个表格的第2条数据,更新唯一id、角色名等字段
- deleteRow(2, 3)
  → 删除第2个表格的第3条数据

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致（如"典狱长使用的电子面罩"和"典狱长使用的电子面具"）
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段

增量更新决策流程：
1. 从当前消息中识别实体（角色、物品、地点、事件等）
2. 检查表格中是否已有该实体（通过唯一ID或关键特征匹配）
   a. 首先在"唯一ID快速查找索引"中查找
   b. 如果没找到，在"当前已有数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一ID=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(2, 1, {"4":"警长"})  ← 只更新身份字段（假设角色表格是表格2，身份是字段4）
- 错误操作：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

重复检测特殊场景处理：
- 场景1：消息中提到"电子面罩"，但表格中已有"电子面罩"(mask_001)和"电子面罩"(electronic_mask_001)
  处理：这两条记录很可能是同一物品，应合并为一条，使用updateRow更新其中一条，并删除另一条
- 场景2：消息中提到"万能房卡"，表格中已有"万能房卡"(universal_room_card_001)和"万能房卡"(card_001)
  处理：检查描述是否一致，如果一致则合并；如果不一致则保留两条但确保唯一ID不同
- 场景3：消息中提到"神经刺激遥控器"，表格中已有"神经刺激遥控器"(remote_001)和"神经刺激遥控器"(nerve_stimulator_001)
  处理：这两条记录很可能是同一物品，应合并为一条


【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**。请根据上下文和语义情景判断：
     * 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID
     * 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
     * 姓名 vs 代号/职业："007" = "詹姆斯·邦德" → 同一个唯一ID
     * 代词回指："她" / "他" / "那个女孩" → 根据上下文指向判断对应的实体
   - **关键判断原则**：
     * 如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID
     * 例："朱迪"、"朱迪·霍普斯"、"Judy"、"兔子"都出现在同一个场景且行为连贯 → 同一个角色
     * 例：对话中出现"白兔子"和"灰兔子"两个不同实体，各自有独立描述和行为 → 两个不同的唯一ID
     * 例："学校"和"第一中学"如果上下文明确指同一所学校 → 同一个地点

3. **实体识别与一致性维护**：
   - 在整个对话过程中，建立和维护一致的实体识别
   - 跨越对话轮次和会话，保持同一实体的唯一ID一致性
   - 考虑上下文变化、语义关系和对话流程，进行系统的唯一元素识别
   - 当不确定时，优先假设是同一实体（基于已有记录中的唯一ID判断）

4. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一

【表格提取规则】
当前模板包含以下表格，请根据表格名称和描述提取对应信息，同一实体的不同称呼共用唯一ID：
${template.sheets.map((sheet: any, index: number) => {
  const fields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id').join('、');
  return `${index + 1}. **${sheet.name}**：${sheet.description || '暂无描述'} | 提取字段：${fields}`;
}).join('；')}

【唯一ID生成指南】
${template.sheets.map((sheet: any) => {
  const keyFields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id' && h !== '备注').slice(0, 3);
  return `- ${sheet.name}：使用关键字段"${keyFields.join('、')}"的语义组合 + 序号，确保唯一且有语义`;
}).join('\n')}

【输出要求】
1. 只分析当前这条消息，不要分析其他消息
2. 从当前消息中提取关键信息，生成对应的tableEdit命令
3. 将命令放在<tableEdit>标签内
4. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
5. 确保使用正确的表格索引、行索引和字段索引
6. 参考现有表格数据，避免重复添加相同信息
7. 识别变体称呼，使用唯一ID保持一致性
8. 只提取当前消息中明确提到的信息，不要臆造
9. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
10. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"当前已有数据"中通过名称相似度查找
11. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
12. 操作结果确认：在生成tableEdit命令后，简要说明每个操作的目的（如："updateRow行3：更新电子面罩的状态为待使用"）

【示例输出 - 精确格式约束】

假设当前对话场景如下：
- 消息："朱迪说她昨天在中央公园遇到了尼克，尼克给她展示了一枚金色徽章。另外，之前提到的电子面罩已经被典狱长收回了。"
- 现有表格数据：
  【角色表格】(表格索引: 2)
  行1: 唯一id=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官, 关系=主角
  行2: 唯一id=nick_001, 角色名=尼克·王尔德, 身份=狐狸, 关系=配角
  【物品表格】(表格索引: 4)
  行1: 唯一id=mask_001, 物品名=电子面罩, 类型=装备, 状态=使用中, 备注/持有人=典狱长
  行3: 唯一id=card_001, 物品名=万能房卡, 类型=钥匙, 状态=可用, 备注/持有人=朱迪

正确输出格式：

<tableEdit>
<!-- 
=== 新增操作 ===
insertRow(2, {"2":"badge_001","3":"金色徽章","4":"物品","5":"尼克展示给朱迪的金色徽章","6":"已发现","7":"尼克"})
说明：在角色表格(索引2)中新增一行，添加"金色徽章"物品记录
  字段2(唯一id): badge_001 - 语义化命名，badge表示徽章，001表示序号
  字段3(物品名): 金色徽章
  字段4(类型): 物品
  字段5(描述): 尼克展示给朱迪的金色徽章
  字段6(状态): 已发现
  字段7(备注/持有人): 尼克

=== 更新操作 ===
updateRow(2, 2, {"6":"已见面","7":"狐狸骗子"})
说明：更新角色表格(索引2)中第2行(尼克·王尔德)的信息
  行2对应的是唯一id=nick_001的记录
  只更新变化的字段：字段6(关系)从"配角"改为"已见面"，字段7(特征)更新为"狐狸骗子"
  不要重复填写未变化的字段(唯一id、角色名、身份)

updateRow(4, 1, {"6":"已收回"})
说明：更新物品表格(索引4)中第1行(电子面罩)的状态
  行1对应的是唯一id=mask_001的记录
  只更新字段6(状态)从"使用中"改为"已收回"

=== 删除操作 ===
deleteRow(4, 1)
说明：删除物品表格(索引4)中第1行(电子面罩)
  行1对应的是唯一id=mask_001的记录
  仅在确认该物品已不再相关时使用删除操作
-->
</tableEdit>

【格式规范总结】

1. insertRow(表格索引, {字段数据对象})
   - 表格索引：数字，从1开始，对应模板页签顺序
   - 字段数据对象：JSON格式，键为字段索引(字符串)，值为字段内容(字符串)
   - 示例：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官"})
   - 注意：字段索引2(唯一id)必须填写，字段1(流水号)由系统自动生成无需填写
   - 注意：所有值必须是字符串类型，用双引号包裹

2. updateRow(表格索引, 行索引, {字段数据对象})
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始，对应当前表格中的数据行号
   - 字段数据对象：JSON格式，只包含需要更新的字段
   - 示例：updateRow(2, 1, {"4":"警长"})
   - 注意：只更新变化的字段，不要重复填写未变化的字段
   - 注意：行索引必须在当前表格数据范围内(参考"唯一ID快速查找索引")

3. deleteRow(表格索引, 行索引)
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始
   - 示例：deleteRow(4, 1)
   - 注意：删除操作需谨慎，仅在确认记录不再相关时使用
   - 注意：合并重复记录时，应先updateRow保留的记录，再deleteRow删除重复的记录

【错误格式示例 - 绝对禁止】

✗ insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"}) 
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(2, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

✗ insertRow("2", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

✗ updateRow(2, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串

【现在开始处理】
请分析上述消息，参考现有表格数据，提取关键信息并生成tableEdit命令。记住：这是增量更新，不要重复插入已存在的实体！`;
  }

  /**
   * 检测两个名称是否相似（用于重复检测）
   * @param name1 名称1
   * @param name2 名称2
   * @returns 是否相似
   */
  private isSimilarName(name1: string, name2: string): boolean {
    if (!name1 || !name2) return false;
    
    const n1 = name1.trim().toLowerCase();
    const n2 = name2.trim().toLowerCase();
    
    // 完全相同
    if (n1 === n2) return true;
    
    // 一个包含另一个（长度差异不能太大）
    if (n1.includes(n2) || n2.includes(n1)) {
      const lengthRatio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
      if (lengthRatio > 0.5) return true; // 长度比例大于50%认为是相似
    }
    
    // 计算编辑距离（Levenshtein distance）
    const distance = this.levenshteinDistance(n1, n2);
    const maxLength = Math.max(n1.length, n2.length);
    const similarity = 1 - distance / maxLength;
    
    // 相似度大于70%认为是相似的
    return similarity > 0.7;
  }

  /**
   * 计算两个字符串的Levenshtein编辑距离
   * @param s1 字符串1
   * @param s2 字符串2
   * @returns 编辑距离
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    
    // 创建二维数组
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    // 初始化
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    // 动态规划计算编辑距离
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,     // 删除
            dp[i][j - 1] + 1,     // 插入
            dp[i - 1][j - 1] + 1  // 替换
          );
        }
      }
    }
    
    return dp[m][n];
  }

  /**
   * 执行tableEdit命令
   * @param chatId 聊天ID
   * @param commands tableEdit命令列表
   * @returns 执行结果
   */
  private executeTableEditCommands(chatId: string, commands: any[]): { success: boolean; executed: number; errors: string[] } {
    const result = { success: true, executed: 0, errors: [] as string[] };

    if (!commands || commands.length === 0) {
      addLog('没有需要执行的tableEdit命令', 'debug');
      return result;
    }

    addLog(`开始执行 ${commands.length} 个tableEdit命令`, 'info');

    // 确保表格JSON文件存在（创建初始空文件）
    // 这是异步模式与同步模式的关键差异：同步模式在processChatProgressive中创建，异步模式需要在这里创建
    try {
      // 使用与 tableTemplateService 相同的 safeChatId 计算方法
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
      
      const tableFilePath = path.join(this.chatlogDir, `${safeChatId}.json`);
      
      if (!fs.existsSync(tableFilePath)) {
        const associatedTemplateId = this.getAssociatedTemplate(chatId);
        let templateIdToUse: string | null = null;
        
        // 先检查关联的模板是否真实存在
        if (associatedTemplateId) {
          const associatedTemplate = tableTemplateService.getTemplate(associatedTemplateId);
          if (associatedTemplate) {
            addLog(`[Async Execute] 表格文件不存在，使用关联模板 ${associatedTemplateId} 创建初始文件`, 'info');
            templateIdToUse = associatedTemplateId;
          } else {
            addLog(`[Async Execute] 关联模板 ${associatedTemplateId} 不存在于磁盘，尝试使用默认模板`, 'warn');
          }
        }
        
        // 如果关联模板不存在，使用默认模板
        if (!templateIdToUse) {
          const defaultTemplates = tableTemplateService.getAllTemplates();
          if (defaultTemplates && defaultTemplates.length > 0) {
            const defaultTemplateId = defaultTemplates[0].id;
            addLog(`[Async Execute] 使用默认模板 ${defaultTemplateId} 创建初始文件`, 'info');
            templateIdToUse = defaultTemplateId;
          } else {
            addLog('[Async Execute] 没有可用的模板，无法创建表格文件', 'error');
            return { success: false, executed: 0, errors: ['没有可用的表格模板，请先在表格模板管理中创建模板'] };
          }
        }
        
        // 创建表格文件
        try {
          tableTemplateService.createTableFile(chatId, templateIdToUse, safeChatId);
          addLog(`[Async Execute] 表格文件已创建: ${tableFilePath}`, 'info');
        } catch (createError) {
          addLog(`[Async Execute] 创建表格文件失败: ${createError}`, 'error');
          return { success: false, executed: 0, errors: [`创建表格文件失败: ${createError}`] };
        }
      }

    commands.forEach((command, index) => {
      try {
        const { type, tableIndex, rowIndex, data } = command;

        addLog(`执行命令 ${index + 1}/${commands.length}: ${type}(表格${tableIndex}${rowIndex !== undefined ? `,行${rowIndex}` : ''})`, 'debug');

        let success = false;

        switch (type) {
          case 'insertRow':
            // 去重检查：读取当前表格数据，检查是否已存在相同唯一ID或相似名称的记录
            const existingTable = tableTemplateService.getTableByIndex(chatId, tableIndex);
            if (existingTable && existingTable.data && Array.isArray(existingTable.data)) {
              const uniqueId = data['1']; // 字段索引1是唯一id（0-based，AI的字段2转换后为1）
              const itemName = data['2'] || ''; // 字段索引2是物品名/角色名等（0-based）
              
              // 1. 首先检查唯一ID是否重复
              const isDuplicateById = uniqueId && existingTable.data.some((row: any) => row['1'] === uniqueId);
              
              // 2. 如果唯一ID不重复，检查名称是否相似（物品名、角色名等）
              let isDuplicateByName = false;
              let similarRowIndex = -1;
              if (!isDuplicateById && itemName) {
                for (let i = 0; i < existingTable.data.length; i++) {
                  const existingName = existingTable.data[i]['2'] || ''; // 字段索引2是名称
                  if (existingName && this.isSimilarName(itemName, existingName)) {
                    isDuplicateByName = true;
                    similarRowIndex = i;
                    addLog(`检测到名称相似重复(新名称="${itemName}", 现有名称="${existingName}")，行索引=${i + 1}`, 'warn');
                    break;
                  }
                }
              }
              
              if (isDuplicateById) {
                addLog(`检测到重复插入(唯一id=${uniqueId})，转换为更新操作`, 'warn');
                // 找到已存在记录的行索引（0-based）
                const existingRowIndex = existingTable.data.findIndex((row: any) => row['1'] === uniqueId);
                if (existingRowIndex >= 0) {
                  // 转换为updateRow命令
                  success = tableTemplateService.updateRowInTable(chatId, tableIndex, existingRowIndex, data);
                  if (success) {
                    addLog(`insertRow转updateRow执行成功: 表格${tableIndex},行${existingRowIndex + 1}`, 'info');
                  } else {
                    result.errors.push(`insertRow转updateRow失败: 表格${tableIndex},行${existingRowIndex + 1}`);
                  }
                } else {
                  success = tableTemplateService.insertRowToTable(chatId, tableIndex, data || {});
                }
              } else if (isDuplicateByName && similarRowIndex >= 0) {
                addLog(`检测到名称相似重复，转换为更新操作(行${similarRowIndex + 1})`, 'warn');
                // 名称相似，转换为updateRow
                success = tableTemplateService.updateRowInTable(chatId, tableIndex, similarRowIndex, data);
                if (success) {
                  addLog(`insertRow转updateRow(名称相似)执行成功: 表格${tableIndex},行${similarRowIndex + 1}`, 'info');
                } else {
                  result.errors.push(`insertRow转updateRow(名称相似)失败: 表格${tableIndex},行${similarRowIndex + 1}`);
                }
              } else {
                success = tableTemplateService.insertRowToTable(chatId, tableIndex, data || {});
                if (success) {
                  addLog(`insertRow 执行成功: 表格${tableIndex}`, 'info');
                } else {
                  result.errors.push(`insertRow 失败: 表格${tableIndex}`);
                }
              }
            } else {
              success = tableTemplateService.insertRowToTable(chatId, tableIndex, data || {});
            }
            break;

          case 'updateRow':
            if (rowIndex === undefined) {
              result.errors.push(`updateRow 失败: 缺少行索引参数`);
              addLog('updateRow 失败: 缺少行索引参数', 'error');
            } else {
              success = tableTemplateService.updateRowInTable(chatId, tableIndex, rowIndex, data || {});
              if (success) {
                addLog(`updateRow 执行成功: 表格${tableIndex},行${rowIndex + 1}`, 'info');
              } else {
                result.errors.push(`updateRow 失败: 表格${tableIndex},行${rowIndex + 1}`);
              }
            }
            break;

          case 'deleteRow':
            if (rowIndex === undefined) {
              result.errors.push(`deleteRow 失败: 缺少行索引参数`);
              addLog('deleteRow 失败: 缺少行索引参数', 'error');
            } else {
              success = tableTemplateService.deleteRowFromTable(chatId, tableIndex, rowIndex);
              if (success) {
                addLog(`deleteRow 执行成功: 表格${tableIndex},行${rowIndex + 1}`, 'info');
              } else {
                result.errors.push(`deleteRow 失败: 表格${tableIndex},行${rowIndex + 1}`);
              }
            }
            break;

          default:
            result.errors.push(`未知命令类型: ${type}`);
            addLog(`未知命令类型: ${type}`, 'error');
            break;
        }

        if (success) {
          result.executed++;
        }
      } catch (error) {
        const errorMsg = `命令 ${index + 1} 执行异常: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        addLog(errorMsg, 'error');
        if (error instanceof Error && error.stack) {
          addLog(`错误堆栈: ${error.stack}`, 'debug');
        }
      }
    });

    if (result.errors.length > 0) {
      addLog(`命令执行完成，但有 ${result.errors.length} 个错误`, 'warn');
      result.errors.forEach(err => addLog(`  错误: ${err}`, 'warn'));
    } else {
      addLog(`所有 ${result.executed} 个命令执行成功`, 'info');
    }

    return result;
  }

  /**
   * 构建表格数据上下文,格式化为AI可读格式
   * @param chatId 聊天ID
   * @param templateId 模板ID
   * @returns 格式化的表格上下文字符串
   */
  private buildTableContext(chatId: string, templateId: string): string {
    // 获取模板
    const template = tableTemplateService.getTemplate(templateId);
    if (!template) {
      addLog(`模板 ${templateId} 不存在，无法构建表格上下文`, 'error');
      return '【当前表格数据状态】\n模板不存在\n';
    }

    // 尝试读取现有表格数据
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

    const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
    
    let jsonData: any = null;
    try {
      if (fs.existsSync(jsonPath)) {
        const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
        jsonData = JSON.parse(jsonContent);
        addLog(`成功读取表格数据文件: ${jsonPath}`, 'debug');
      } else {
        addLog(`表格数据文件不存在: ${jsonPath}`, 'debug');
      }
    } catch (error) {
      addLog(`读取表格数据文件失败: ${error}`, 'error');
    }

    // 构建表格上下文 - 使用清晰的行格式，便于AI理解
    let context = '【当前表格数据状态 - 已存在的数据，请勿重复插入】\n';

    template.sheets.forEach((sheet: any, sheetIndex: number) => {
      const tableIndex = sheetIndex + 1;
      context += `\n=== ${sheet.name} (表格索引: ${tableIndex}) ===\n`;
      context += `表格用途：${sheet.description || '暂无描述'}\n`;
      context += `表头结构：[1:流水号, 2:唯一id`;
      sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id').forEach((h: string, i: number) => {
        context += `, ${i + 3}:${h}`;
      });
      context += ']\n';

      // 检查是否有数据
      if (jsonData && jsonData.data && jsonData.data[sheet.name]) {
        const sheetData = jsonData.data[sheet.name];
        if (Array.isArray(sheetData) && sheetData.length > 0) {
          context += `当前已有数据（共${sheetData.length}条）：\n`;
          
          // 构建唯一ID索引，便于AI快速查找
          const uniqueIdIndex: Map<string, number> = new Map();
          
          sheetData.forEach((row: any, rowIndex: number) => {
            const rowDisplay = rowIndex + 1;
            const uniqueId = row['1']; // 0-based索引，字段2(唯一id)对应索引1
            
            // 记录唯一ID与行号的映射
            if (uniqueId) {
              uniqueIdIndex.set(uniqueId, rowDisplay);
            }
            
            const fields = Object.entries(row)
              .filter(([key]) => key !== '0')
              .map(([key, value]) => {
                const headerIndex = parseInt(key) + 1;
                const headerName = sheet.headers[parseInt(key) - 2] || `字段${headerIndex}`;
                return `${headerName}=${value}`;
              })
              .join(', ');
            context += `  行${rowDisplay}: ${fields}\n`;
          });
          
          // 添加唯一ID快速查找索引
          if (uniqueIdIndex.size > 0) {
            context += `\n【唯一ID快速查找索引】\n`;
            uniqueIdIndex.forEach((rowNum, uniqueId) => {
              context += `  ${uniqueId} → 行${rowNum}\n`;
            });
            context += '\n使用指南：当需要更新某实体时，先在此索引中查找唯一ID，找到对应行号后使用updateRow(表格索引, 行号, {更新的字段})\n';
          }
          
          context += '\n【重要警告】上述数据已存在，如需修改请使用updateRow(表格索引, 行索引, {...})，绝对不要使用insertRow重复插入！\n';
        } else {
          context += '当前数据：暂无数据\n';
        }
      } else {
        context += '当前数据：暂无数据\n';
      }
    });

    return context;
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
      const trimmedApiKey = apiKey?.trim() || '';
      let authHeader: Record<string, string> = {};
      if (trimmedApiKey) {
        if (trimmedApiKey.startsWith('Bearer ')) {
          authHeader['Authorization'] = trimmedApiKey;
          addLog('API密钥已包含Bearer前缀，直接使用', 'debug');
        } else {
          authHeader['Authorization'] = `Bearer ${trimmedApiKey}`;
          addLog('API密钥不包含Bearer前缀，自动添加', 'debug');
        }
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader
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
    
    if (!fs.existsSync(this.chatsDir)) {
      fs.mkdirSync(this.chatsDir, { recursive: true });
    }
    
    let associations: Record<string, AssociationRecord> = {};
    
    if (fs.existsSync(associationsPath)) {
      try {
        const content = fs.readFileSync(associationsPath, 'utf-8');
        const rawData = JSON.parse(content);
        associations = this.migrateAssociations(rawData);
      } catch (error) {
        console.error('读取关联关系失败:', error);
        associations = {};
      }
    }
    
    const existing = associations[chatId];
    associations[chatId] = {
      templateId,
      processedCount: existing?.processedCount || 0,
      totalMessages: existing?.totalMessages || 0,
      lastProcessedAt: existing?.lastProcessedAt
    };
    
    fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
  }

  private migrateAssociations(rawData: any): Record<string, AssociationRecord> {
    const result: Record<string, AssociationRecord> = {};
    for (const [chatId, value] of Object.entries(rawData)) {
      if (typeof value === 'string') {
        result[chatId] = { templateId: value, processedCount: 0, totalMessages: 0 };
      } else if (typeof value === 'object' && value !== null) {
        result[chatId] = value as AssociationRecord;
      }
    }
    return result;
  }



  /**
   * 获取聊天会话关联的模板
   */
  public getAssociatedTemplate(chatId: string): string | null {
    const associationsPath = path.join(this.chatsDir, 'associations.json');
    
    if (fs.existsSync(associationsPath)) {
      try {
        const content = fs.readFileSync(associationsPath, 'utf-8');
        const rawData = JSON.parse(content);
        const associations = this.migrateAssociations(rawData);
        return associations[chatId]?.templateId || null;
      } catch (error) {
        console.error('读取关联关系失败:', error);
      }
    }
    
    return null;
  }

  public clearOrganizingProgress(chatId: string): void {
    const associationsPath = path.join(this.chatsDir, 'associations.json');
    
    if (!fs.existsSync(associationsPath)) {
      return;
    }
    
    try {
      const content = fs.readFileSync(associationsPath, 'utf-8');
      const rawData = JSON.parse(content);
      const associations = this.migrateAssociations(rawData);
      
      if (associations[chatId]) {
        associations[chatId].processedCount = 0;
        associations[chatId].totalMessages = 0;
        associations[chatId].lastProcessedAt = undefined;
        fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
        addLog(`已清除聊天记录 ${chatId} 的整理进度`, 'info');
      }
    } catch (error) {
      console.error('清除整理进度失败:', error);
    }
  }

  /**
   * 清理已整理的表格数据（仅删除 chatlog 目录下的表格JSON文件，不影响原始聊天记录）
   */
  public clearTableData(chatId: string): void {
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
    
    // 仅删除 chatlog 目录下的表格数据文件（原始聊天记录在 chats/ 目录，不会被删除）
    const tableFilePath = path.join(this.chatlogDir, `${safeChatId}.json`);
    if (fs.existsSync(tableFilePath)) {
      fs.unlinkSync(tableFilePath);
      addLog(`已删除表格数据文件: ${tableFilePath}`, 'info');
    } else {
      addLog(`表格数据文件不存在: ${tableFilePath}`, 'debug');
    }

    // 重置关联进度（associations.json 在 chats/ 目录下）
    this.clearOrganizingProgress(chatId);

    // 重置处理状态
    this.setSessionProcessedStatus(chatId, false);

    addLog(`已清理聊天记录 ${chatId} 的表格数据和进度`, 'info');
  }

  public getOrganizingProgress(chatId: string): { processedCount: number; totalMessages: number; lastProcessedAt?: string } | null {
    const associationsPath = path.join(this.chatsDir, 'associations.json');
    
    if (fs.existsSync(associationsPath)) {
      try {
        const content = fs.readFileSync(associationsPath, 'utf-8');
        const rawData = JSON.parse(content);
        const associations = this.migrateAssociations(rawData);
        const record = associations[chatId];
        if (record) {
          return {
            processedCount: record.processedCount,
            totalMessages: record.totalMessages,
            lastProcessedAt: record.lastProcessedAt
          };
        }
      } catch (error) {
        console.error('读取整理进度失败:', error);
      }
    }
    
    return null;
  }

  private saveOrganizingProgress(chatId: string, processedCount: number, totalMessages: number): void {
    const associationsPath = path.join(this.chatsDir, 'associations.json');
    
    if (!fs.existsSync(this.chatsDir)) {
      fs.mkdirSync(this.chatsDir, { recursive: true });
    }
    
    let associations: Record<string, AssociationRecord> = {};
    
    if (fs.existsSync(associationsPath)) {
      try {
        const content = fs.readFileSync(associationsPath, 'utf-8');
        const rawData = JSON.parse(content);
        associations = this.migrateAssociations(rawData);
      } catch (error) {
        console.error('读取关联关系失败:', error);
        associations = {};
      }
    }
    
    if (associations[chatId]) {
      associations[chatId].processedCount = processedCount;
      associations[chatId].totalMessages = totalMessages;
      associations[chatId].lastProcessedAt = new Date().toISOString();
      fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
    }
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
   * 实时整理：逐条处理聊天记录，仅处理新增消息（增量更新）
   * @param chatId 聊天ID
   * @param templateId 模板ID
   * @param config AI配置
   * @param onProgress 进度回调
   * @param options 整理选项
   * @returns 整理结果
   */
  public async processChatProgressive(
    chatId: string,
    templateId: string,
    config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
    onProgress?: (current: number, total: number, message: string, percent?: number) => void,
    options?: OrganizeOptions
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; resumed: boolean }> {
    const result = { success: true, processedCount: 0, errorCount: 0, errors: [] as string[], resumed: false };
    const { continueFromLast = true, minInterval = 3000 } = options || {};

    addLog(`[Auto Organize] 开始实时整理: ${chatId}`, 'info');

    // 防抖检查
    if (!this.canStartOrganize(chatId, minInterval)) {
      return { success: false, processedCount: 0, errorCount: 0, errors: ['整理间隔过短，已跳过'], resumed: false };
    }

    // 设置整理锁
    this.setOrganizingLock(chatId, 'auto');

    let tableDataBackup: string | null = null;
    let tableFilePath = '';

    try {
      // 1. 读取聊天记录（支持两种格式）
      addLog('[Auto Organize] 步骤 1/5: 读取聊天记录', 'debug');
      const allMessages = this.getChatMessages(chatId).messages;

      // 如果 .jsonl 格式没读到，尝试从 .json 格式（角色卡聊天记录）读取
      let messages: ChatMessage[] = allMessages;
      if (allMessages.length === 0) {
        const jsonMessages = this.readCharacterChatMessages(chatId);
        if (jsonMessages.length > 0) {
          addLog(`[Auto Organize] 从角色卡聊天记录格式读取到 ${jsonMessages.length} 条消息`, 'debug');
          messages = jsonMessages;
        }
      }

      addLog(`[Auto Organize] 共读取 ${messages.length} 条消息`, 'debug');

      if (messages.length === 0) {
        throw new Error('没有聊天记录可处理');
      }

      // 2. 过滤消息（仅处理user和assistant消息）
      addLog('[Auto Organize] 步骤 2/5: 过滤消息', 'debug');
      const targetMessages = messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
      addLog(`[Auto Organize] 过滤后剩余 ${targetMessages.length} 条消息（排除system消息）`, 'debug');

      if (targetMessages.length === 0) {
        throw new Error('没有可处理的消息（user或assistant）');
      }

      // 3. 按时间顺序排序
      addLog('[Auto Organize] 步骤 3/5: 按时间排序', 'debug');
      targetMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // 检查断点续传
      let startIndex = 0;
      const existingProgress = this.getOrganizingProgress(chatId);
      if (continueFromLast && existingProgress && existingProgress.processedCount > 0 && existingProgress.totalMessages === targetMessages.length) {
        startIndex = existingProgress.processedCount;
        addLog(`[Auto Organize] 检测到断点续传记录: 已处理 ${startIndex}/${targetMessages.length} 条消息`, 'info');
        if (startIndex >= targetMessages.length) {
          addLog('[Auto Organize] 所有消息已处理完成，无需重复整理', 'info');
          result.resumed = true;
          result.processedCount = startIndex;
          return result;
        }
        result.resumed = true;
      } else if (existingProgress && existingProgress.totalMessages !== targetMessages.length) {
        addLog(`[Auto Organize] 消息数量变化 (${existingProgress.totalMessages} -> ${targetMessages.length})，仅处理新增消息`, 'info');
        // 如果消息数量变化，计算新增消息的起始位置
        if (existingProgress.totalMessages < targetMessages.length) {
          startIndex = existingProgress.totalMessages;
          addLog(`[Auto Organize] 检测到新增 ${targetMessages.length - existingProgress.totalMessages} 条消息，从第 ${startIndex + 1} 条开始处理`, 'info');
        }
      }

      addLog(`[Auto Organize] 待处理消息: ${startIndex + 1} ~ ${targetMessages.length} (共 ${targetMessages.length - startIndex} 条)`, 'info');

      // 4. 获取模板信息
      addLog('[Auto Organize] 步骤 4/5: 获取模板信息', 'debug');
      // 如果模板ID为空，使用默认模板
      let effectiveTemplateId = templateId;
      if (!effectiveTemplateId || effectiveTemplateId.trim() === '') {
        addLog('[Auto Organize] 模板ID为空，自动使用默认模板', 'info');
        // 获取默认模板列表中的第一个
        const defaultTemplates = tableTemplateService.getAllTemplates();
        if (defaultTemplates && defaultTemplates.length > 0) {
          effectiveTemplateId = defaultTemplates[0].id;
          addLog(`[Auto Organize] 使用默认模板: ${effectiveTemplateId} (${defaultTemplates[0].name})`, 'info');
        } else {
          throw new Error('没有可用的表格模板，请先在表格模板管理中创建模板');
        }
      }
      const template = tableTemplateService.getTemplate(effectiveTemplateId);
      if (!template) {
        throw new Error(`模板 ${effectiveTemplateId} 不存在`);
      }
      addLog(`[Auto Organize] 模板名称: ${template.name}`, 'debug');
      addLog(`[Auto Organize] 模板包含 ${template.sheets?.length || 0} 个页签`, 'debug');

      // 5. 确定AI配置
      addLog('[Auto Organize] 步骤 5/5: 配置AI参数', 'debug');
      const aiConfig = {
        apiKey: config?.apiKey || '',
        apiUrl: config?.apiUrl || 'http://127.0.0.1:5000',
        modelName: config?.modelName || 'qwen3.5-27b-heretic-v3',
        apiMode: config?.apiMode || 'text_completion'
      };

      // 根据API模式设置正确的API端点
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
      addLog(`[Auto Organize] 最终API端点: ${apiEndpoint}`, 'debug');

      addLog('[Auto Organize] 使用AI配置:', 'debug');
      addLog(`  API密钥: ${aiConfig.apiKey ? '已设置' : '未设置'}`, 'debug');
      addLog(`  API地址: ${apiEndpoint}`, 'debug');
      addLog(`  模型名称: ${aiConfig.modelName}`, 'debug');
      addLog(`  API模式: ${aiConfig.apiMode}`, 'debug');

      // 保存关联关系（如果还没有的话）
      const currentTemplateId = this.getAssociatedTemplate(chatId);
      if (!currentTemplateId) {
        this.saveAssociation(chatId, effectiveTemplateId);
      }

      // 确保表格JSON文件存在（创建初始空文件）
      // 使用与 tableTemplateService 相同的 safeChatId 计算方法
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
      tableFilePath = path.join(this.chatlogDir, `${safeChatId}.json`);
      if (!fs.existsSync(tableFilePath)) {
        addLog('[Auto Organize] 创建初始表格数据文件', 'info');
        tableTemplateService.createTableFile(chatId, effectiveTemplateId, safeChatId);
        addLog(`[Auto Organize] 表格文件已创建: ${tableFilePath}`, 'info');
      } else {
        addLog(`[Auto Organize] 表格文件已存在: ${tableFilePath}`, 'debug');
      }

      // 备份当前表格数据（用于错误回滚）
      try {
        if (fs.existsSync(tableFilePath)) {
          tableDataBackup = fs.readFileSync(tableFilePath, 'utf-8');
          addLog('[Auto Organize] 表格数据备份完成', 'debug');
        }
      } catch (backupError) {
        addLog(`[Auto Organize] 备份表格数据失败: ${backupError}`, 'warn');
      }

      // 开始逐条处理
      const totalMessages = targetMessages.length;
      const messagesToProcess = totalMessages - startIndex;
      addLog(`[Auto Organize] 开始增量处理 ${messagesToProcess} 条新消息${startIndex > 0 ? ` (从第 ${startIndex + 1} 条开始)` : ''}`, 'info');

      // 初始化进度
      this.saveOrganizingProgress(chatId, startIndex, totalMessages);

      for (let i = startIndex; i < totalMessages; i++) {
        const message = targetMessages[i];
        const absoluteMessageIndex = i + 1;
        const processedCount = i - startIndex + 1;

        addLog(`[Auto Organize] 处理消息 ${absoluteMessageIndex}/${totalMessages}: ${message.role}`, 'info');

        // 进度回调：传递绝对消息位置用于前端显示，同时传递计算好的百分比
        if (onProgress) {
          // 计算正确的进度百分比（基于相对进度：已处理数/当前批次待处理总数）
          const progressPercent = Math.round((processedCount / messagesToProcess) * 100);
          
          // 前端需要显示绝对进度（如 4/5），所以传递 absoluteMessageIndex 和 totalMessages
          // 同时传递计算好的百分比值，避免前端计算错误
          onProgress(absoluteMessageIndex, totalMessages, `处理消息 ${absoluteMessageIndex}/${totalMessages}...`, progressPercent);
        }

        // 发送实时更新
        if (global.sendLogToRenderer) {
          global.sendLogToRenderer(`[Auto Organize] 处理消息 ${absoluteMessageIndex}/${totalMessages} (${message.role})`, 'info');
        }

        try {
          // 构建表格数据上下文
          addLog(`[Auto Organize] 构建表格上下文 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');
          const tableContext = this.buildTableContext(chatId, effectiveTemplateId);

          // 构建提示词
          addLog(`[Auto Organize] 构建AI提示词 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');
          const prompt = this.buildAIPromptForProgressive(message, template, chatId, tableContext);

          // 调用AI API
          addLog(`[Auto Organize] 调用AI API (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
          const aiResponse = await this.callAIAPIWithRetry(prompt, aiConfig.apiKey, apiEndpoint, aiConfig.modelName);

          if (!aiResponse || aiResponse.trim() === '') {
            addLog(`[Auto Organize] AI未返回有效响应 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
            result.errors.push(`消息 ${absoluteMessageIndex}: AI未返回有效响应`);
            result.errorCount++;
            // 保存进度（即使AI没有返回有效响应，这条消息也算处理过了）
            this.saveOrganizingProgress(chatId, absoluteMessageIndex, totalMessages);
            continue;
          }

          addLog(`[Auto Organize] AI响应长度: ${aiResponse.length} 字符 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');

          // 解析tableEdit命令
          addLog(`[Auto Organize] 解析tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');
          const parseResult = tableEditParser.parse(aiResponse);

          if (!parseResult.success && parseResult.commands.length === 0) {
            addLog(`[Auto Organize] 未解析到tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
            if (parseResult.errors.length > 0) {
              addLog(`[Auto Organize] 解析错误: ${parseResult.errors.join('; ')}`, 'warn');
            }
            // 不视为错误，可能消息中没有可提取的信息
            result.processedCount++;
            this.saveOrganizingProgress(chatId, absoluteMessageIndex, totalMessages);
            continue;
          }

          if (parseResult.errors.length > 0) {
            addLog(`[Auto Organize] 解析警告: ${parseResult.errors.join('; ')} (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
          }

          // 执行tableEdit命令
          if (parseResult.commands.length > 0) {
            addLog(`[Auto Organize] 执行 ${parseResult.commands.length} 个tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
            const execResult = this.executeTableEditCommands(chatId, parseResult.commands);

            if (execResult.errors.length > 0) {
              addLog(`[Auto Organize] 命令执行错误: ${execResult.errors.join('; ')} (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
              result.errors.push(`消息 ${absoluteMessageIndex}: ${execResult.errors.join('; ')}`);
            }

            addLog(`[Auto Organize] 成功执行 ${execResult.executed} 个命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
          }

          result.processedCount++;
          // 每处理一条消息就保存进度
          this.saveOrganizingProgress(chatId, absoluteMessageIndex, totalMessages);
          addLog(`[Auto Organize] 消息 ${absoluteMessageIndex}/${totalMessages} 处理完成`, 'info');

        } catch (error) {
          const errorMsg = `[Auto Organize] 处理消息 ${absoluteMessageIndex} 失败: ${error instanceof Error ? error.message : String(error)}`;
          addLog(errorMsg, 'error');
          if (error instanceof Error && error.stack) {
            addLog(`[Auto Organize] 错误堆栈: ${error.stack}`, 'debug');
          }
          result.errors.push(errorMsg);
          result.errorCount++;
          // 单条消息处理失败不影响后续处理
          addLog(`[Auto Organize] 跳过消息 ${absoluteMessageIndex}，继续处理下一条`, 'info');
        }
      }

      // 处理完成
      addLog(`[Auto Organize] 增量处理完成: 成功 ${result.processedCount}, 失败 ${result.errorCount}`, 'info');

      if (result.errorCount > 0) {
        addLog(`[Auto Organize] 处理过程中有 ${result.errorCount} 条消息处理失败`, 'warn');
        result.success = result.processedCount > 0; // 只要有成功的消息就认为整体成功
      }

      // 发送完成通知
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer(`[Auto Organize] 实时整理完成: 成功 ${result.processedCount}, 失败 ${result.errorCount}`, result.success ? 'info' : 'warn');
      }

      // 标记会话为已处理
      this.setSessionProcessedStatus(chatId, result.success);

      return result;

    } catch (error) {
      addLog(`[Auto Organize] 实时整理失败: ${error}`, 'error');
      if (error instanceof Error) {
        addLog(`[Auto Organize] 错误堆栈: ${error.stack}`, 'error');
      }

      // 发生严重错误时回滚表格数据
      if (tableDataBackup && tableFilePath && fs.existsSync(tableFilePath)) {
        try {
          addLog('[Auto Organize] 检测到严重错误，正在回滚表格数据到备份状态...', 'error');
          fs.writeFileSync(tableFilePath, tableDataBackup, 'utf-8');
          addLog('[Auto Organize] 表格数据已回滚到处理前的状态', 'info');
        } catch (rollbackError) {
          addLog(`[Auto Organize] 回滚表格数据失败: ${rollbackError}`, 'error');
        }
      }

      // 发送失败通知
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer(`[Auto Organize] 实时整理失败: ${error}`, 'error');
      }

      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      // 释放整理锁
      this.releaseOrganizingLock(chatId);
    }
  }

  /**
   * 完全整理：清空表格数据，重新处理所有消息
   * @param chatId 聊天ID
   * @param templateId 模板ID
   * @param config AI配置
   * @param onProgress 进度回调
   * @returns 整理结果
   */
  public async processChatFull(
    chatId: string,
    templateId: string,
    config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
    onProgress?: (current: number, total: number, message: string, percent?: number) => void
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> {
    const result = { success: true, processedCount: 0, errorCount: 0, errors: [] as string[] };

    addLog(`[Full Reorganize] 开始完全整理: ${chatId}`, 'info');

    // 检查是否可以开始整理（不允许并发）
    if (!this.canStartOrganize(chatId, 0)) {
      return { success: false, processedCount: 0, errorCount: 0, errors: ['已有整理任务在执行中'] };
    }

    // 设置整理锁
    this.setOrganizingLock(chatId, 'manual');

    let tableDataBackup: string | null = null;
    let tableFilePath = '';

    try {
      // 1. 备份当前表格数据
      // 使用与 tableTemplateService 相同的 safeChatId 计算方法
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
      tableFilePath = path.join(this.chatlogDir, `${safeChatId}.json`);
      try {
        if (fs.existsSync(tableFilePath)) {
          tableDataBackup = fs.readFileSync(tableFilePath, 'utf-8');
          addLog('[Full Reorganize] 表格数据备份完成', 'debug');
        }
      } catch (backupError) {
        addLog(`[Full Reorganize] 备份表格数据失败: ${backupError}`, 'warn');
      }

      // 2. 读取聊天记录（支持两种格式）
      addLog('[Full Reorganize] 步骤 1/5: 读取聊天记录', 'debug');
      const allMessages = this.getChatMessages(chatId).messages;

      // 如果 .jsonl 格式没读到，尝试从 .json 格式（角色卡聊天记录）读取
      let messages: ChatMessage[] = allMessages;
      if (allMessages.length === 0) {
        const jsonMessages = this.readCharacterChatMessages(chatId);
        if (jsonMessages.length > 0) {
          addLog(`[Full Reorganize] 从角色卡聊天记录格式读取到 ${jsonMessages.length} 条消息`, 'debug');
          messages = jsonMessages;
        }
      }

      addLog(`[Full Reorganize] 共读取 ${messages.length} 条消息`, 'debug');

      if (messages.length === 0) {
        throw new Error('没有聊天记录可处理');
      }

      // 3. 过滤消息（仅处理user和assistant消息）
      addLog('[Full Reorganize] 步骤 2/5: 过滤消息', 'debug');
      const targetMessages = messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
      addLog(`[Full Reorganize] 过滤后剩余 ${targetMessages.length} 条消息（排除system消息）`, 'debug');

      if (targetMessages.length === 0) {
        throw new Error('没有可处理的消息（user或assistant）');
      }

      // 4. 按时间顺序排序
      addLog('[Full Reorganize] 步骤 3/5: 按时间排序', 'debug');
      targetMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // 5. 获取模板信息
      addLog('[Full Reorganize] 步骤 4/5: 获取模板信息', 'debug');
      // 如果模板ID为空，使用默认模板
      let effectiveTemplateId = templateId;
      if (!effectiveTemplateId || effectiveTemplateId.trim() === '') {
        addLog('[Full Reorganize] 模板ID为空，自动使用默认模板', 'info');
        // 获取默认模板列表中的第一个
        const defaultTemplates = tableTemplateService.getAllTemplates();
        if (defaultTemplates && defaultTemplates.length > 0) {
          effectiveTemplateId = defaultTemplates[0].id;
          addLog(`[Full Reorganize] 使用默认模板: ${effectiveTemplateId} (${defaultTemplates[0].name})`, 'info');
        } else {
          throw new Error('没有可用的表格模板，请先在表格模板管理中创建模板');
        }
      }
      const template = tableTemplateService.getTemplate(effectiveTemplateId);
      if (!template) {
        throw new Error(`模板 ${effectiveTemplateId} 不存在`);
      }
      addLog(`[Full Reorganize] 模板名称: ${template.name}`, 'debug');
      addLog(`[Full Reorganize] 模板包含 ${template.sheets?.length || 0} 个页签`, 'debug');

      // 6. 确定AI配置
      addLog('[Full Reorganize] 步骤 5/5: 配置AI参数', 'debug');
      const aiConfig = {
        apiKey: config?.apiKey || '',
        apiUrl: config?.apiUrl || 'http://127.0.0.1:5000',
        modelName: config?.modelName || 'qwen3.5-27b-heretic-v3',
        apiMode: config?.apiMode || 'text_completion'
      };

      // 根据API模式设置正确的API端点
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
      addLog(`[Full Reorganize] 最终API端点: ${apiEndpoint}`, 'debug');

      addLog('[Full Reorganize] 使用AI配置:', 'debug');
      addLog(`  API密钥: ${aiConfig.apiKey ? '已设置' : '未设置'}`, 'debug');
      addLog(`  API地址: ${apiEndpoint}`, 'debug');
      addLog(`  模型名称: ${aiConfig.modelName}`, 'debug');
      addLog(`  API模式: ${aiConfig.apiMode}`, 'debug');

      // 7. 重置进度和表格数据
      addLog('[Full Reorganize] 重置整理进度和表格数据', 'info');
      this.clearOrganizingProgress(chatId);
      
      // 删除现有表格数据文件，重新创建
      if (fs.existsSync(tableFilePath)) {
        fs.unlinkSync(tableFilePath);
        addLog('[Full Reorganize] 已删除现有表格数据文件', 'info');
      }
      
      // 创建新的空表格文件
      tableTemplateService.createTableFile(chatId, effectiveTemplateId);
      addLog('[Full Reorganize] 已创建新的空表格文件', 'info');

      // 保存关联关系
      this.saveAssociation(chatId, effectiveTemplateId);

      // 8. 开始逐条处理所有消息
      const totalMessages = targetMessages.length;
      addLog(`[Full Reorganize] 开始处理所有 ${totalMessages} 条消息`, 'info');

      for (let i = 0; i < totalMessages; i++) {
        const message = targetMessages[i];
        const absoluteMessageIndex = i + 1;
        const processedCount = i + 1;

        addLog(`[Full Reorganize] 处理消息 ${absoluteMessageIndex}/${totalMessages}: ${message.role}`, 'info');

        // 进度回调
        if (onProgress) {
          const progressPercent = Math.round((processedCount / totalMessages) * 100);
          onProgress(absoluteMessageIndex, totalMessages, `处理消息 ${absoluteMessageIndex}/${totalMessages}...`, progressPercent);
        }

        // 发送实时更新
        if (global.sendLogToRenderer) {
          global.sendLogToRenderer(`[Full Reorganize] 处理消息 ${absoluteMessageIndex}/${totalMessages} (${message.role})`, 'info');
        }

        try {
          // 构建表格数据上下文
          addLog(`[Full Reorganize] 构建表格上下文 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');
          const tableContext = this.buildTableContext(chatId, effectiveTemplateId);

          // 构建提示词
          addLog(`[Full Reorganize] 构建AI提示词 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');
          const prompt = this.buildAIPromptForProgressive(message, template, chatId, tableContext);

          // 调用AI API
          addLog(`[Full Reorganize] 调用AI API (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
          const aiResponse = await this.callAIAPIWithRetry(prompt, aiConfig.apiKey, apiEndpoint, aiConfig.modelName);

          if (!aiResponse || aiResponse.trim() === '') {
            addLog(`[Full Reorganize] AI未返回有效响应 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
            result.errors.push(`消息 ${absoluteMessageIndex}: AI未返回有效响应`);
            result.errorCount++;
            // 保存进度
            this.saveOrganizingProgress(chatId, absoluteMessageIndex, totalMessages);
            continue;
          }

          addLog(`[Full Reorganize] AI响应长度: ${aiResponse.length} 字符 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');

          // 解析tableEdit命令
          addLog(`[Full Reorganize] 解析tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');
          const parseResult = tableEditParser.parse(aiResponse);

          if (!parseResult.success && parseResult.commands.length === 0) {
            addLog(`[Full Reorganize] 未解析到tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
            if (parseResult.errors.length > 0) {
              addLog(`[Full Reorganize] 解析错误: ${parseResult.errors.join('; ')}`, 'warn');
            }
            // 不视为错误，可能消息中没有可提取的信息
            result.processedCount++;
            this.saveOrganizingProgress(chatId, absoluteMessageIndex, totalMessages);
            continue;
          }

          if (parseResult.errors.length > 0) {
            addLog(`[Full Reorganize] 解析警告: ${parseResult.errors.join('; ')} (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
          }

          // 执行tableEdit命令
          if (parseResult.commands.length > 0) {
            addLog(`[Full Reorganize] 执行 ${parseResult.commands.length} 个tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
            const execResult = this.executeTableEditCommands(chatId, parseResult.commands);

            if (execResult.errors.length > 0) {
              addLog(`[Full Reorganize] 命令执行错误: ${execResult.errors.join('; ')} (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
              result.errors.push(`消息 ${absoluteMessageIndex}: ${execResult.errors.join('; ')}`);
            }

            addLog(`[Full Reorganize] 成功执行 ${execResult.executed} 个命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
          }

          result.processedCount++;
          // 每处理一条消息就保存进度
          this.saveOrganizingProgress(chatId, absoluteMessageIndex, totalMessages);
          addLog(`[Full Reorganize] 消息 ${absoluteMessageIndex}/${totalMessages} 处理完成`, 'info');

        } catch (error) {
          const errorMsg = `[Full Reorganize] 处理消息 ${absoluteMessageIndex} 失败: ${error instanceof Error ? error.message : String(error)}`;
          addLog(errorMsg, 'error');
          if (error instanceof Error && error.stack) {
            addLog(`[Full Reorganize] 错误堆栈: ${error.stack}`, 'debug');
          }
          result.errors.push(errorMsg);
          result.errorCount++;
          // 单条消息处理失败不影响后续处理
          addLog(`[Full Reorganize] 跳过消息 ${absoluteMessageIndex}，继续处理下一条`, 'info');
        }
      }

      // 处理完成
      addLog(`[Full Reorganize] 完全整理完成: 成功 ${result.processedCount}, 失败 ${result.errorCount}`, 'info');

      if (result.errorCount > 0) {
        addLog(`[Full Reorganize] 处理过程中有 ${result.errorCount} 条消息处理失败`, 'warn');
        result.success = result.processedCount > 0; // 只要有成功的消息就认为整体成功
      }

      // 发送完成通知
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer(`[Full Reorganize] 完全整理完成: 成功 ${result.processedCount}, 失败 ${result.errorCount}`, result.success ? 'info' : 'warn');
      }

      // 标记会话为已处理
      this.setSessionProcessedStatus(chatId, result.success);

      return result;

    } catch (error) {
      addLog(`[Full Reorganize] 完全整理失败: ${error}`, 'error');
      if (error instanceof Error) {
        addLog(`[Full Reorganize] 错误堆栈: ${error.stack}`, 'error');
      }

      // 发生严重错误时回滚表格数据
      if (tableDataBackup && fs.existsSync(tableFilePath)) {
        try {
          addLog('[Full Reorganize] 检测到严重错误，正在回滚表格数据到备份状态...', 'error');
          fs.writeFileSync(tableFilePath, tableDataBackup, 'utf-8');
          addLog('[Full Reorganize] 表格数据已回滚到处理前的状态', 'info');
        } catch (rollbackError) {
          addLog(`[Full Reorganize] 回滚表格数据失败: ${rollbackError}`, 'error');
        }
      }

      // 发送失败通知
      if (global.sendLogToRenderer) {
        global.sendLogToRenderer(`[Full Reorganize] 完全整理失败: ${error}`, 'error');
      }

      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      // 释放整理锁
      this.releaseOrganizingLock(chatId);
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
   * 自动初始化聊天会话（首次对话时自动绑定默认模板并创建空表格）
   */
  public autoInitializeChatSession(chatId: string): boolean {
    // 检查是否已存在关联关系（避免重复初始化）
    const existingTemplateId = this.getAssociatedTemplate(chatId);
    if (existingTemplateId) {
      addLog(`[AutoInit] 聊天会话 ${chatId} 已有关联模板 ${existingTemplateId}，跳过初始化`, 'info');
      return false;
    }

    addLog(`[AutoInit] 开始自动初始化聊天会话: ${chatId}`, 'info');

    try {
      // 获取默认模板ID（取第一个可用模板）
      const allTemplates = tableTemplateService.getAllTemplates();
      if (!allTemplates || allTemplates.length === 0) {
        addLog('[AutoInit] 没有可用的表格模板，无法自动初始化', 'error');
        return false;
      }

      const defaultTemplateId = allTemplates[0].id;
      addLog(`[AutoInit] 使用默认模板: ${defaultTemplateId} (${allTemplates[0].name})`, 'info');

      // 调用现有的 associateTemplate 方法完成初始化
      // associateTemplate 内部会：
      //   - 创建模板副本（包含 originalTemplateId, chatId 等元数据）
      //   - 调用 createTableFile 创建空表格JSON文件
      //   - 调用 saveAssociation 保存关联关系
      this.associateTemplate(chatId, defaultTemplateId);

      addLog(`[AutoInit] 聊天会话 ${chatId} 自动初始化完成`, 'info');
      return true;
    } catch (error) {
      addLog(`[AutoInit] 自动初始化失败: ${error}`, 'error');
      console.error('[AutoInit] Auto initialization error:', error);
      return false;
    }
  }

  /**
   * 获取表格数据（JSON格式）
   */
  public getTableData(chatId: string): any {
    // tableTemplateService 将表格数据保存在 chatlog/ 目录下
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
    
    // 从 chatlog 目录读取（tableTemplateService 保存的位置）
    const jsonPath = path.join(this.chatlogDir, `${safeChatId}.json`);
    
    console.log('=== 开始获取表格数据 ===');
    console.log('原始 chatId:', chatId);
    console.log('转换后的 safeChatId:', safeChatId);
    console.log('=== 获取表格数据开始 ===');
    console.log('chatId:', chatId);
    console.log('表格数据目录:', this.chatlogDir);
    console.log('使用JSON文件路径:', jsonPath);
    console.log('文件是否存在:', fs.existsSync(jsonPath));
    
    if (!fs.existsSync(jsonPath)) {
      console.log('[getTableData] 表格文件不存在 (新对话或尚未创建表格):', jsonPath);
      // 尝试从 chats 目录查找（旧版 processChat 可能保存到这里）
      const fallbackPath = path.join(this.chatsDir, `${safeChatId}.json`);
      if (fs.existsSync(fallbackPath)) {
        console.log('[getTableData] 从 chats 目录找到备份文件:', fallbackPath);
        try {
          const content = fs.readFileSync(fallbackPath, 'utf8');
          const jsonData = JSON.parse(content);
          const hasData = (jsonData.sheets && jsonData.sheets.length > 0) || 
                          (jsonData.data && Object.keys(jsonData.data).length > 0);
          
          if (hasData) {
            console.log('[getTableData] 备份文件包含有效数据，直接返回');
            return { sheets: jsonData.sheets || [], headers: jsonData.headers || {}, data: jsonData.data || {}, sheetDescriptions: {} };
          }
          
          console.log('[getTableData] 备份文件存在但数据为空，尝试自动初始化');
          // fall through to auto-init
        } catch (e) {
          console.error('[getTableData] 读取备份文件失败:', e);
          // fall through to auto-init
        }
      }
      
      console.log('[getTableData] 尝试自动初始化聊天会话');
      const initSuccess = this.autoInitializeChatSession(chatId);
      
      if (initSuccess) {
        addLog('[getTableData] 自动初始化成功，重新读取表格数据', 'info');
        return this.getTableData(chatId);
      }
      
      console.log('[getTableData] 自动初始化失败，返回空数据');
      return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
    }
    
    try {
      const content = fs.readFileSync(jsonPath, 'utf8');
      const jsonData = JSON.parse(content);
      
      const sheets = jsonData.sheets || [];
      const headers = jsonData.headers || {};
      const data = jsonData.data || {};
      
      console.log('工作表名称:', sheets);
      console.log('表头信息:', headers);
      Object.keys(data).forEach(sheetName => {
        console.log(`工作表 ${sheetName} 数据行数:`, data[sheetName].length);
      });
      
      // 获取关联模板的表格描述信息
      let sheetDescriptions: Record<string, string> = {};
      try {
        const templateId = this.getAssociatedTemplate(chatId);
        if (templateId) {
          const templates = tableTemplateService.getAllTemplates();
          const template = templates?.find((t: any) => t.id === templateId);
          if (template && template.sheets) {
            template.sheets.forEach((sheet: any) => {
              if (sheet.name) {
                sheetDescriptions[sheet.name] = sheet.description || '';
              }
            });
            console.log('表格描述信息:', sheetDescriptions);
          }
        }
      } catch (descError) {
        console.warn('获取表格描述信息失败:', descError);
      }
      
      console.log('=== 获取表格数据完成 ===');
      return { sheets, headers, data, sheetDescriptions };
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
