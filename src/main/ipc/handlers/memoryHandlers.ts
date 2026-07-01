/**
 * 记忆插件 IPC 处理器 - 聚合注册入口
 *
 * Task 12: 将原本 680+ 行的 memoryHandlers.ts 按业务拆分为 4 个子文件：
 *   - memory/memoryTemplateHandlers.ts   模板管理（CRUD / 版本 / 复制）
 *   - memory/memoryTableHandlers.ts       表格文件 / tableEdit 命令 / 数据读写
 *   - memory/memorySessionHandlers.ts     聊天会话 / AI 处理 / 角色卡聊天记录
 *   - memory/memoryExternalHandlers.ts    外部批处理 API
 *
 * 本文件保留初始化逻辑（从设置加载 chatsDir），并调用 4 个子模块的 register 函数。
 *
 * 入口签名保持不变：
 *   - export function registerMemoryHandlers()
 *
 * utils/wrapHandler.ts 提供高阶函数统一 try/catch + console.error + throw 兜底。
 */
import path from 'path';
import { resolveUserDataPlaceholder } from '../../utils/appPath';
import { getStorageService } from '../../services/storageService';
import { chatLogService } from '../../services/memory/chatLogService';
import { registerMemoryTemplateHandlers } from './memory/memoryTemplateHandlers';
import { registerMemoryTableHandlers } from './memory/memoryTableHandlers';
import { registerMemorySessionHandlers } from './memory/memorySessionHandlers';
import { registerMemoryExternalHandlers } from './memory/memoryExternalHandlers';

export function registerMemoryHandlers() {
  // 初始化时从设置中加载聊天记录路径
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    if (settings && settings.memoryPath) {
      const resolvedPath = resolveUserDataPlaceholder(settings.memoryPath);
      const chatsDir = path.join(resolvedPath, 'chats');
      console.log('[registerMemoryHandlers] 从设置中加载聊天记录路径:', chatsDir);
      chatLogService.setChatsDir(chatsDir);
    } else {
      // 如果没有设置，使用默认路径
      const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/memories');
      const chatsDir = path.join(defaultPath, 'chats');
      console.log('[registerMemoryHandlers] 使用默认聊天记录路径:', chatsDir);
      chatLogService.setChatsDir(chatsDir);
    }
  } catch (error) {
    console.error('[registerMemoryHandlers] 加载聊天记录路径失败:', error);
    const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/memories');
    const chatsDir = path.join(defaultPath, 'chats');
    chatLogService.setChatsDir(chatsDir);
  }

  // 注册各业务子模块
  registerMemoryTemplateHandlers();
  registerMemoryTableHandlers();
  registerMemorySessionHandlers();
  registerMemoryExternalHandlers();

  console.log('记忆插件 IPC 处理器已注册');
}
