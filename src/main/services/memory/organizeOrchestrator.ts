/**
 * 整理编排器
 * - 整理流程编排：processChat / processChatProgressive / processChatFull / processMessagesCore / processChatWithAI
 * - 并发控制：整理锁（organizingLocks）与 AbortController 管理、断点续传
 * - 锁工具：canStartOrganize / setOrganizingLock / releaseOrganizingLock / stopOrganizing
 *
 * 已迁出的原"工具方法"（避免本文件超 800 行）：
 * - buildOrganizeConfig/aiClient.ts、rollbackTableData+saveProcessingResult/tableFileRepository.ts
 * - sendOrganizeNotification/logger.ts、readAndFilterMessages+splitChatIntoSegments/chatSessionRepository.ts
 *
 * Task 6 性能优化保留：processMessagesCore 内的 cachedTableData/refreshTableCache/maybeSaveProgress（每 10 条批量落盘）、buildTableContext 第三参数 cachedJsonData
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import type { TableTemplate } from './tableTemplateService';
import { tableEditParser } from './tableEditParser';
import {
  addLog, logger, getSafeChatId, sendOrganizeNotification,
  ChatMessage, ChatLogContext, OrganizeOptions, AIProcessingResult,
} from './logger';
import { getChatMessages, readAndFilterMessages } from './chatSessionRepository';
import { buildAIPrompt, buildAIPromptForProgressive, buildTableContext } from './aiPromptBuilder';
import {
  getEngineAIParams, buildOrganizeConfig,
  callAIAPI, callAIAPIWithRetry, parseAIResponse, parseAIOperations,
} from './aiClient';
import { executeTableEditCommands, executeTableOperations } from './tableOperationExecutor';
import { rollbackTableData, saveProcessingResult } from './tableFileRepository';
import {
  getOrganizingProgress, getAssociatedTemplate, saveAssociation,
  clearOrganizingProgress, saveOrganizingProgress, setSessionProcessedStatus,
} from './associationRepository';

/**
 * 表格数据文件结构（chatlog/<safeChatId>.json）
 * 与 aiPromptBuilder / tableFileRepository / tableOperationExecutor 中的同名接口保持结构一致。
 */
interface TableDataFile {
  sheets: string[];
  headers?: Record<string, string[]>;
  data: Record<string, Record<string, unknown>[]>;
  sheetDescriptions?: Record<string, string>;
}

// ========== 并发控制（锁与 AbortController） ==========

/**
 * 检查是否可以开始整理（防抖和并发控制）
 */
export function canStartOrganize(ctx: ChatLogContext, chatId: string, minInterval: number = 3000): boolean {
  const lock = ctx.organizingLocks.get(chatId);

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
 */
export function setOrganizingLock(ctx: ChatLogContext, chatId: string, organizeType: 'auto' | 'manual' = 'auto'): void {
  ctx.organizingLocks.set(chatId, {
    isOrganizing: true,
    lastOrganizeTime: Date.now(),
    organizeType
  });
  addLog(`[${chatId}] 设置整理锁 (${organizeType === 'auto' ? '实时整理' : '完全整理'})`, 'debug');
}

/**
 * 释放整理锁
 */
export function releaseOrganizingLock(ctx: ChatLogContext, chatId: string): void {
  const lock = ctx.organizingLocks.get(chatId);
  if (lock) {
    ctx.organizingLocks.set(chatId, {
      isOrganizing: false,
      lastOrganizeTime: Date.now(),
      organizeType: lock.organizeType
    });
    addLog(`[${chatId}] 释放整理锁`, 'debug');
  }
}

/**
 * 停止正在进行的整理任务
 */
export function stopOrganizing(ctx: ChatLogContext, chatId: string): boolean {
  const lock = ctx.organizingLocks.get(chatId);
  if (!lock || !lock.isOrganizing) {
    addLog(`[${chatId}] 当前没有正在执行的整理任务`, 'info');
    return false;
  }

  const controller = ctx.organizeAbortControllers.get(chatId);
  if (controller) {
    controller.abort();
    ctx.organizeAbortControllers.delete(chatId);
    addLog(`[${chatId}] 已发送整理任务取消信号`, 'info');
  }

  releaseOrganizingLock(ctx, chatId);
  return true;
}

// ========== 核心处理 ==========

export interface ProcessMessagesCoreParams {
  messages: ChatMessage[];
  startIndex: number;
  totalMessages: number;
  aiConfig: { apiKey: string; apiUrl: string; modelName: string; apiMode: string };
  apiEndpoint: string;
  effectiveTemplateId: string;
  template: TableTemplate;
  chatId: string;
  signal?: AbortSignal;
  logger: string;
  onProgress?: (current: number, total: number, message: string, percent?: number) => void;
}

export async function processMessagesCore(ctx: ChatLogContext, params: ProcessMessagesCoreParams): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> {
  const {
    messages, startIndex, totalMessages, aiConfig, apiEndpoint,
    effectiveTemplateId, template, chatId, signal, logger: logPrefix, onProgress
  } = params;

  const result = { success: true, processedCount: 0, errorCount: 0, errors: [] as string[] };

  const checkAborted = () => {
    if (signal?.aborted) {
      throw new Error('整理任务已取消');
    }
  };

  // 性能优化：在循环开始前缓存表格数据，避免每条消息都重复读盘
  const PROGRESS_BATCH_SIZE = 10;
  let lastSavedProgressIndex = startIndex > 0 ? startIndex : 0;
  const safeChatIdForCache = getSafeChatId(chatId);
  const tableFilePathForCache = path.join(ctx.chatlogDir, `${safeChatIdForCache}.json`);
  let cachedTableData: TableDataFile | null | undefined = undefined; // undefined=未初始化, null=文件不存在, object=已缓存
  try {
    if (fs.existsSync(tableFilePathForCache)) {
      cachedTableData = JSON.parse(fs.readFileSync(tableFilePathForCache, 'utf-8')) as TableDataFile;
    } else {
      cachedTableData = null;
    }
  } catch (cacheError) {
    addLog(`${logPrefix} 初始化表格数据缓存失败: ${cacheError}`, 'warn');
    cachedTableData = null;
  }

  // 刷新缓存（在 executeTableEditCommands 写盘后调用，单次同步 IO）
  const refreshTableCache = () => {
    try {
      if (fs.existsSync(tableFilePathForCache)) {
        cachedTableData = JSON.parse(fs.readFileSync(tableFilePathForCache, 'utf-8')) as TableDataFile;
      } else {
        cachedTableData = null;
      }
    } catch (refreshError) {
      addLog(`${logPrefix} 刷新表格数据缓存失败，保留旧缓存: ${refreshError}`, 'warn');
      // 保留旧缓存（旧数据总比崩溃好）
    }
  };

  // 批量保存整理进度（每 PROGRESS_BATCH_SIZE 条或最后一条消息时落盘）
  const maybeSaveProgress = (absoluteIndex: number, isLastIteration: boolean) => {
    if (isLastIteration || absoluteIndex - lastSavedProgressIndex >= PROGRESS_BATCH_SIZE) {
      saveOrganizingProgress(ctx, chatId, absoluteIndex, totalMessages);
      lastSavedProgressIndex = absoluteIndex;
    }
  };

  for (let i = startIndex; i < totalMessages; i++) {
    checkAborted();

    const message = messages[i];
    const absoluteMessageIndex = i + 1;
    const processedCount = i - startIndex + 1;

    addLog(`${logPrefix} 处理消息 ${absoluteMessageIndex}/${totalMessages}: ${message.role}`, 'info');

    if (onProgress) {
      const progressPercent = Math.round((processedCount / (totalMessages - startIndex)) * 100);
      onProgress(absoluteMessageIndex, totalMessages, `处理消息 ${absoluteMessageIndex}/${totalMessages}...`, progressPercent);
    }

    sendOrganizeNotification(chatId, `${logPrefix} 处理消息 ${absoluteMessageIndex}/${totalMessages} (${message.role})`, 'info');

    try {
      const tableContext = buildTableContext(ctx, chatId, effectiveTemplateId, cachedTableData);
      const prompt = buildAIPromptForProgressive(message, template, chatId, tableContext);
      const engineAIParams = getEngineAIParams();
      const aiResponse = await callAIAPIWithRetry(prompt, aiConfig.apiKey, apiEndpoint, aiConfig.modelName, 3, 2000, signal, engineAIParams ?? undefined);

      if (!aiResponse || aiResponse.trim() === '') {
        addLog(`${logPrefix} AI未返回有效响应 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
        result.errors.push(`消息 ${absoluteMessageIndex}: AI未返回有效响应`);
        result.errorCount++;
        maybeSaveProgress(absoluteMessageIndex, i === totalMessages - 1);
        continue;
      }

      addLog(`${logPrefix} AI响应长度: ${aiResponse.length} 字符 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'debug');

      const parseResult = tableEditParser.parse(aiResponse);

      if (!parseResult.success && parseResult.commands.length === 0) {
        addLog(`${logPrefix} 未解析到tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
        if (parseResult.errors.length > 0) {
          addLog(`${logPrefix} 解析错误: ${parseResult.errors.join('; ')}`, 'warn');
        }
        result.processedCount++;
        maybeSaveProgress(absoluteMessageIndex, i === totalMessages - 1);
        continue;
      }

      if (parseResult.errors.length > 0) {
        addLog(`${logPrefix} 解析警告: ${parseResult.errors.join('; ')} (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
      }

      if (parseResult.commands.length > 0) {
        addLog(`${logPrefix} 执行 ${parseResult.commands.length} 个tableEdit命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');
        const execResult = executeTableEditCommands(ctx, chatId, parseResult.commands);

        if (execResult.errors.length > 0) {
          addLog(`${logPrefix} 命令执行错误: ${execResult.errors.join('; ')} (消息 ${absoluteMessageIndex}/${totalMessages})`, 'warn');
          result.errors.push(`消息 ${absoluteMessageIndex}: ${execResult.errors.join('; ')}`);
        }

        addLog(`${logPrefix} 成功执行 ${execResult.executed} 个命令 (消息 ${absoluteMessageIndex}/${totalMessages})`, 'info');

        // executeTableEditCommands 通过 tableTemplateService 写盘，刷新缓存以反映最新数据
        refreshTableCache();
      }

      result.processedCount++;
      maybeSaveProgress(absoluteMessageIndex, i === totalMessages - 1);
      addLog(`${logPrefix} 消息 ${absoluteMessageIndex}/${totalMessages} 处理完成`, 'info');

    } catch (error) {
      const errorMsg = `${logPrefix} 处理消息 ${absoluteMessageIndex} 失败: ${error instanceof Error ? error.message : String(error)}`;
      addLog(errorMsg, 'error');
      if (error instanceof Error && error.stack) {
        addLog(`${logPrefix} 错误堆栈: ${error.stack}`, 'debug');
      }
      result.errors.push(errorMsg);
      result.errorCount++;
      addLog(`${logPrefix} 跳过消息 ${absoluteMessageIndex}，继续处理下一条`, 'info');
    }
  }

  return result;
}

/**
 * AI 处理聊天记录，提取关键信息
 */
export async function processChatWithAI(
  ctx: ChatLogContext,
  chatId: string,
  templateId: string,
  apiKey: string,
  apiUrl: string,
  modelName: string
): Promise<AIProcessingResult[]> {
  // 读取聊天记录
  const messages = getChatMessages(ctx, chatId).messages;

  if (messages.length === 0) {
    throw new Error('没有聊天记录可处理');
  }

  // 获取模板信息
  const template = tableTemplateService.getTemplate(templateId);
  if (!template) {
    throw new Error(`模板 ${templateId} 不存在`);
  }

  // 构建提示词
  const prompt = buildAIPrompt(ctx, messages, template, chatId);

  // 获取 AI 引擎配置参数
  const engineAIParams = getEngineAIParams();

  // 调用 AI API（原实现使用 callAIAPI，非重试版本）
  const aiResponse = await callAIAPI(prompt, apiKey, apiUrl, modelName, undefined, engineAIParams ?? undefined);

  // 解析 AI 响应
  const results = parseAIResponse(aiResponse);

  return results;
}

/**
 * 处理聊天记录，提取信息到表格
 */
export async function processChat(
  ctx: ChatLogContext,
  chatId: string,
  templateId: string,
  selectedMessageIds?: string[],
  config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }
): Promise<void> {
  addLog(`开始处理聊天记录: ${chatId}`, 'info');
  addLog(`使用模板: ${templateId}`, 'info');
  addLog(`选中消息数量: ${selectedMessageIds?.length || '全部'}`, 'debug');

  try {
    // 1. 读取聊天记录
    addLog('步骤 1/12: 读取聊天记录', 'debug');
    const messages = getChatMessages(ctx, chatId).messages;
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
    const prompt = buildAIPrompt(ctx, targetMessages, template, chatId);

    // 6. 确定 AI 配置
    addLog('步骤 6/12: 配置 AI 参数', 'debug');
    const aiConfig = {
      apiKey: config?.apiKey || '',
      apiUrl: config?.apiUrl || 'http://127.0.0.1:5000',
      modelName: config?.modelName || (() => { throw new Error('未配置 AI 模型名称'); })(),
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
    logger.info('表格整理: 正在发送请求到 AI 服务器...');

    const engineAIParams = getEngineAIParams();
    const aiResponse = await callAIAPIWithRetry(prompt, aiConfig.apiKey, apiEndpoint, aiConfig.modelName, undefined, undefined, undefined, engineAIParams ?? undefined);

    logger.info('表格整理: AI 响应完成，正在解析...');

    // 8. 验证 AI 响应
    addLog('步骤 8/12: 验证 AI 响应', 'debug');
    if (!aiResponse || aiResponse.trim() === '') {
      throw new Error('AI 服务器未返回响应');
    }

    // 9. 解析 AI 响应
    addLog('步骤 9/12: 解析 AI 响应', 'debug');
    const operations = parseAIOperations(aiResponse);
    addLog(`AI 处理完成，得到 ${operations.length} 个操作指令`, 'info');
    logger.info(`表格整理: 解析完成，共 ${operations.length} 个操作指令`);

    // 10. 执行表格操作
    addLog('步骤 10/12: 执行表格操作', 'info');
    logger.info('表格整理: 开始执行表格操作...');

    const tablePath = executeTableOperations(ctx, chatId, templateId, operations);
    addLog(`执行表格操作完成，表格文件: ${tablePath}`, 'info');
    logger.info('表格整理: 表格操作完成');

    // 11. 验证表格操作结果
    addLog('步骤 11/12: 验证操作结果', 'debug');
    if (!tablePath) {
      throw new Error('表格操作失败，未生成文件');
    }

    // 12. 存储处理结果
    addLog('步骤 12/12: 保存处理结果', 'debug');
    saveProcessingResult(ctx, chatId, templateId, operations);
    addLog(`处理聊天记录 ${chatId} 完成`, 'info');
    logger.info('表格整理: 处理完成');

  } catch (error) {
    addLog(`处理聊天记录失败: ${error}`, 'error');
    if (error instanceof Error) {
      addLog(`错误堆栈: ${error.stack}`, 'error');
    }
    logger.error(`表格整理失败: ${error}`);
    throw error;
  }
}

// ========== 整理模式处理器（策略模式） ==========

/**
 * 起始索引计算结果
 * - completed=true 表示所有消息已处理完成，调用方应跳过核心处理直接返回
 * - resumed=true 表示本次为断点续传
 */
interface StartIndexResult {
  startIndex: number;
  completed: boolean;
  resumed: boolean;
}

/**
 * 整理模式处理器接口
 * 实时整理与完全整理实现该接口以处理各自的差异逻辑，公共流程由 processChatWithCommonFlow 统一编排
 */
interface OrganizeModeHandler {
  modeName: string;
  minInterval: number;
  organizeType: 'auto' | 'manual';

  calculateStartIndex(
    ctx: ChatLogContext,
    chatId: string,
    targetMessages: ChatMessage[]
  ): Promise<StartIndexResult> | StartIndexResult;

  prepareTableFile(
    ctx: ChatLogContext,
    chatId: string,
    effectiveTemplateId: string,
    tableFilePath: string
  ): Promise<void> | void;

  saveInitialProgress?(
    ctx: ChatLogContext,
    chatId: string,
    startIndex: number,
    totalMessages: number
  ): void;
}

/**
 * 整理公共流程：封装实时整理和完全整理的公共逻辑
 * 包括锁管理、AbortController、表格备份、消息读取排序、模板获取、AI配置、核心处理、错误回滚等
 */
async function processChatWithCommonFlow(
  ctx: ChatLogContext,
  chatId: string,
  templateId: string,
  config: { apiKey: string; apiUrl: string; modelName: string; apiMode: string } | undefined,
  handler: OrganizeModeHandler,
  onProgress?: (current: number, total: number, message: string, percent?: number) => void
): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; resumed: boolean }> {
  const result = { success: true, processedCount: 0, errorCount: 0, errors: [] as string[], resumed: false };
  const { modeName, minInterval, organizeType } = handler;

  addLog(`[TableOrganize][${modeName}] 开始整理: ${chatId}`, 'info');

  // 1. 防抖/并发检查
  if (!canStartOrganize(ctx, chatId, minInterval)) {
    return {
      success: false,
      processedCount: 0,
      errorCount: 0,
      errors: [minInterval > 0 ? '整理间隔过短，已跳过' : '已有整理任务在执行中'],
      resumed: false
    };
  }

  // 2. 设置整理锁
  setOrganizingLock(ctx, chatId, organizeType);

  // 3. 创建 AbortController 用于取消整理任务
  const controller = new AbortController();
  ctx.organizeAbortControllers.set(chatId, controller);

  let tableDataBackup: string | null = null;
  let tableFilePath = '';

  const checkAborted = () => {
    if (controller.signal.aborted) {
      throw new Error('整理任务已取消');
    }
  };

  try {
    checkAborted();

    // 4. 确定表格文件路径并备份当前数据（用于错误回滚）
    const safeChatId = getSafeChatId(chatId);
    tableFilePath = path.join(ctx.chatlogDir, `${safeChatId}.json`);

    try {
      if (fs.existsSync(tableFilePath)) {
        tableDataBackup = fs.readFileSync(tableFilePath, 'utf-8');
        addLog(`[TableOrganize][${modeName}] 表格数据备份完成`, 'debug');
      }
    } catch (backupError) {
      addLog(`[TableOrganize][${modeName}] 备份表格数据失败: ${backupError}`, 'warn');
    }

    // 5. 读取并过滤聊天记录
    addLog(`[TableOrganize][${modeName}] 步骤 1/5: 读取并过滤聊天记录`, 'debug');
    checkAborted();
    const targetMessages = readAndFilterMessages(ctx, chatId);
    addLog(`[TableOrganize][${modeName}] 共读取并过滤 ${targetMessages.length} 条消息`, 'debug');

    if (targetMessages.length === 0) {
      throw new Error('没有可处理的消息（user或assistant）');
    }

    // 6. 按时间顺序排序
    addLog(`[TableOrganize][${modeName}] 步骤 2/5: 按时间排序`, 'debug');
    targetMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // 7. 计算起始索引（模式特定）
    const startResult = await handler.calculateStartIndex(ctx, chatId, targetMessages);
    result.resumed = startResult.resumed;

    if (startResult.completed) {
      addLog(`[TableOrganize][${modeName}] 所有消息已处理完成，无需重复整理`, 'info');
      result.processedCount = startResult.startIndex;
      return result;
    }

    const startIndex = startResult.startIndex;
    addLog(`[TableOrganize][${modeName}] 待处理消息: ${startIndex + 1} ~ ${targetMessages.length} (共 ${targetMessages.length - startIndex} 条)`, 'info');

    // 8. 获取模板信息
    addLog(`[TableOrganize][${modeName}] 步骤 3/5: 获取模板信息`, 'debug');
    let effectiveTemplateId = templateId;
    if (!effectiveTemplateId || effectiveTemplateId.trim() === '') {
      addLog(`[TableOrganize][${modeName}] 模板ID为空，自动使用默认模板`, 'info');
      const defaultTemplates = tableTemplateService.getAllTemplates();
      if (defaultTemplates && defaultTemplates.length > 0) {
        effectiveTemplateId = defaultTemplates[0].id;
        addLog(`[TableOrganize][${modeName}] 使用默认模板: ${effectiveTemplateId} (${defaultTemplates[0].name})`, 'info');
      } else {
        throw new Error('没有可用的表格模板，请先在表格模板管理中创建模板');
      }
    }
    const template = tableTemplateService.getTemplate(effectiveTemplateId);
    if (!template) {
      throw new Error(`模板 ${effectiveTemplateId} 不存在`);
    }
    addLog(`[TableOrganize][${modeName}] 模板名称: ${template.name}`, 'debug');
    addLog(`[TableOrganize][${modeName}] 模板包含 ${template.sheets?.length || 0} 个页签`, 'debug');

    // 9. 配置AI参数
    addLog(`[TableOrganize][${modeName}] 步骤 4/5: 配置AI参数`, 'debug');
    const { aiConfig, apiEndpoint } = buildOrganizeConfig(config);
    addLog(`[TableOrganize][${modeName}] 使用AI配置:`, 'debug');
    addLog(`  API密钥: ${aiConfig.apiKey ? '已设置' : '未设置'}`, 'debug');
    addLog(`  API地址: ${apiEndpoint}`, 'debug');
    addLog(`  模型名称: ${aiConfig.modelName}`, 'debug');
    addLog(`  API模式: ${aiConfig.apiMode}`, 'debug');

    // 10. 保存关联关系（如果还没有的话）
    const currentTemplateId = getAssociatedTemplate(ctx, chatId);
    if (!currentTemplateId) {
      saveAssociation(ctx, chatId, effectiveTemplateId);
    }

    // 11. 准备表格文件（模式特定：创建/删除重建等）
    addLog(`[TableOrganize][${modeName}] 步骤 5/5: 准备表格文件`, 'debug');
    await handler.prepareTableFile(ctx, chatId, effectiveTemplateId, tableFilePath);

    // 12. 保存关联关系（确保associations.json中有该chatId的记录）
    saveAssociation(ctx, chatId, effectiveTemplateId);

    // 13. 保存初始进度（如果模式需要）
    if (handler.saveInitialProgress) {
      handler.saveInitialProgress(ctx, chatId, startIndex, targetMessages.length);
    }

    // 14. 调用核心处理方法
    const totalMessages = targetMessages.length;
    addLog(`[TableOrganize][${modeName}] 开始处理 ${totalMessages - startIndex} 条消息${startIndex > 0 ? ` (从第 ${startIndex + 1} 条开始)` : ''}`, 'info');

    const coreResult = await processMessagesCore(ctx, {
      messages: targetMessages,
      startIndex,
      totalMessages,
      aiConfig,
      apiEndpoint,
      effectiveTemplateId,
      template,
      chatId,
      signal: controller.signal,
      logger: `[TableOrganize][${modeName}]`,
      onProgress
    });

    result.processedCount = coreResult.processedCount;
    result.errorCount = coreResult.errorCount;
    result.errors = coreResult.errors;
    result.success = coreResult.success;

    addLog(`[TableOrganize][${modeName}] 处理完成: 成功 ${result.processedCount}, 失败 ${result.errorCount}`, 'info');

    if (result.errorCount > 0) {
      addLog(`[TableOrganize][${modeName}] 处理过程中有 ${result.errorCount} 条消息处理失败`, 'warn');
      result.success = result.processedCount > 0;
    }

    sendOrganizeNotification(
      chatId,
      `[TableOrganize][${modeName}] 整理完成: 成功 ${result.processedCount}, 失败 ${result.errorCount}`,
      result.success ? 'info' : 'warn'
    );

    // 15. 标记会话为已处理
    setSessionProcessedStatus(ctx, chatId, result.success);

    return result;

  } catch (error) {
    if (error instanceof Error && error.message === '整理任务已取消') {
      addLog(`[TableOrganize][${modeName}] 整理任务已被用户取消`, 'info');
      sendOrganizeNotification(chatId, `[TableOrganize][${modeName}] 整理任务已取消`, 'info');
      result.success = false;
      result.errors.push('整理任务已取消');
      return result;
    }

    addLog(`[TableOrganize][${modeName}] 整理失败: ${error}`, 'error');
    if (error instanceof Error) {
      addLog(`[TableOrganize][${modeName}] 错误堆栈: ${error.stack}`, 'error');
    }

    // 发生严重错误时回滚表格数据
    rollbackTableData(tableDataBackup, tableFilePath);

    // 发送失败通知
    sendOrganizeNotification(chatId, `[TableOrganize][${modeName}] 整理失败: ${error}`, 'error');

    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    ctx.organizeAbortControllers.delete(chatId);
    // 释放整理锁
    releaseOrganizingLock(ctx, chatId);
  }
}

/**
 * 创建实时整理模式处理器
 * @param continueFromLast 是否启用断点续传
 * @param minInterval 防抖间隔（ms）
 */
function createProgressiveHandler(continueFromLast: boolean, minInterval: number = 3000): OrganizeModeHandler {
  return {
    modeName: 'Sync',
    minInterval,
    organizeType: 'auto',

    calculateStartIndex(ctx, chatId, targetMessages) {
      const existingProgress = getOrganizingProgress(ctx, chatId);

      if (continueFromLast && existingProgress && existingProgress.processedCount > 0 && existingProgress.totalMessages === targetMessages.length) {
        const startIndex = existingProgress.processedCount;
        addLog(`[TableOrganize][Sync] 检测到断点续传记录: 已处理 ${startIndex}/${targetMessages.length} 条消息`, 'info');
        if (startIndex >= targetMessages.length) {
          return { startIndex, completed: true, resumed: true };
        }
        return { startIndex, completed: false, resumed: true };
      }

      if (existingProgress && existingProgress.totalMessages !== targetMessages.length) {
        addLog(`[TableOrganize][Sync] 消息数量变化 (${existingProgress.totalMessages} -> ${targetMessages.length})，仅处理新增消息`, 'info');
        if (existingProgress.totalMessages < targetMessages.length) {
          const startIndex = existingProgress.totalMessages;
          addLog(`[TableOrganize][Sync] 检测到新增 ${targetMessages.length - existingProgress.totalMessages} 条消息，从第 ${startIndex + 1} 条开始处理`, 'info');
          return { startIndex, completed: false, resumed: false };
        }
      }

      return { startIndex: 0, completed: false, resumed: false };
    },

    prepareTableFile(_ctx, chatId, effectiveTemplateId, tableFilePath) {
      const safeChatId = getSafeChatId(chatId);
      if (!fs.existsSync(tableFilePath)) {
        addLog('[TableOrganize][Sync] 创建初始表格数据文件', 'info');
        tableTemplateService.createTableFile(chatId, effectiveTemplateId, safeChatId);
        addLog(`[TableOrganize][Sync] 表格文件已创建: ${tableFilePath}`, 'info');
      } else {
        addLog(`[TableOrganize][Sync] 表格文件已存在: ${tableFilePath}`, 'debug');
      }
    },

    saveInitialProgress(ctx, chatId, startIndex, totalMessages) {
      saveOrganizingProgress(ctx, chatId, startIndex, totalMessages);
    }
  };
}

/**
 * 完全整理模式处理器
 */
const fullModeHandler: OrganizeModeHandler = {
  modeName: 'Full',
  minInterval: 0,
  organizeType: 'manual',

  calculateStartIndex() {
    return { startIndex: 0, completed: false, resumed: false };
  },

  prepareTableFile(ctx, chatId, effectiveTemplateId, tableFilePath) {
    clearOrganizingProgress(ctx, chatId);

    if (fs.existsSync(tableFilePath)) {
      fs.unlinkSync(tableFilePath);
      addLog('[TableOrganize][Full] 已删除现有表格数据文件', 'info');
    }

    tableTemplateService.createTableFile(chatId, effectiveTemplateId);
    addLog('[TableOrganize][Full] 已创建新的空表格文件', 'info');
  }
};

/**
 * 实时整理：逐条处理聊天记录，仅处理新增消息（增量更新）
 */
export async function processChatProgressive(
  ctx: ChatLogContext,
  chatId: string,
  templateId: string,
  config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
  onProgress?: (current: number, total: number, message: string, percent?: number) => void,
  options?: OrganizeOptions
): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; resumed: boolean }> {
  const { continueFromLast = true, minInterval = 3000 } = options || {};
  const handler = createProgressiveHandler(continueFromLast, minInterval);
  return processChatWithCommonFlow(ctx, chatId, templateId, config, handler, onProgress);
}

/**
 * 完全整理：清空表格数据，重新处理所有消息
 */
export async function processChatFull(
  ctx: ChatLogContext,
  chatId: string,
  templateId: string,
  config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
  onProgress?: (current: number, total: number, message: string, percent?: number) => void
): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> {
  const result = await processChatWithCommonFlow(ctx, chatId, templateId, config, fullModeHandler, onProgress);
  return {
    success: result.success,
    processedCount: result.processedCount,
    errorCount: result.errorCount,
    errors: result.errors
  };
}
