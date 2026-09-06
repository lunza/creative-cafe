/**
 * 内嵌 LAN HTTP API 服务（Spec: add-android-chat-client / Task 1 + 2 + 4）
 *
 * 基于 Node 内置 http 的极简路由实现（不引入新 npm 依赖），随 Electron 主进程启动。
 * 供同一局域网（WiFi）内的安卓客户端（android-client/）访问：
 *   - 角色卡列表 / 详情 / 头像
 *   - 表情立绘清单 / 立绘图片
 *   - 对话历史 / 清空 / SSE 流式发送消息
 *
 * 安全边界（spec R6）：
 *   - 所有 :id 路径参数先 URL 解码，再与角色卡目录 readdir 结果精确匹配（白名单），杜绝路径穿越
 *   - 仅绑定 0.0.0.0 供局域网访问，文档注明禁止暴露公网
 *   - 普通请求 30s 超时兜底；SSE 请求随对话管线自身的连接/请求超时终止
 */

import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { characterService } from '../characterService';
import { characterFavoritesService } from '../characterFavoritesService';
import { expressionService } from '../expressionService';
import { chatStorageService } from '../ChatStorageService';
import { getStorageService } from '../storageService';
import { runDialogueTurn } from './dialogue';
import { listPersonaRecords, findPersonaById } from './personas';
import {
  CardValidationError,
  updateCard,
  replaceAvatar,
  createCard,
  deleteCard,
  validateCardFieldsPatch,
  decodePngBase64,
  validateRelations,
  readWorldBookRelations,
  writeWorldBookRelations,
} from './characterWrite';
import { worldBookService } from '../worldBookService';
import { chatLogService } from '../memory/chatLogService';
import { generateConversationImage, readConversationAssetPng } from './imageGeneration';
import { vectorRegistryService } from '../VectorRegistryService';
import {
  sessionConfigStore,
  validateAndNormalizeSessionConfig,
  type LanSessionConfig,
} from './sessionConfigStore';

const DEFAULT_PORT = 8787;
let server: http.Server | null = null;

// ==================== 通用工具 ====================

interface ApiError {
  code: string;
  message: string;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, status: number, err: ApiError): void {
  sendJson(res, status, { error: err });
}

function sendBinary(res: http.ServerResponse, buffer: Buffer, contentType: string): void {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(buffer);
}

function contentTypeForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

function readRequestBody(req: http.IncomingMessage, limitBytes = 512 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ==================== 白名单校验（防路径穿越） ====================

/**
 * 将客户端传入的 characterId（角色卡文件名）解析为角色卡目录内的绝对路径。
 * 必须与目录内真实文件名精确匹配，否则返回 null（杜绝 ../ 等路径穿越）。
 */
async function resolveCharacterPath(characterId: string): Promise<string | null> {
  if (!characterId || characterId.includes('/') || characterId.includes('\\') || characterId.includes('..')) {
    return null;
  }
  const dir = characterService.getCharacterDir();
  try {
    const files = await fs.readdir(dir);
    if (!files.includes(characterId)) return null;
    return path.join(dir, characterId);
  } catch {
    return null;
  }
}

/** 情绪键白名单校验：仅允许 [a-z0-9_]（与 expressionService 命名规则一致） */
function isValidEmotionKey(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key);
}

// ==================== SSE ====================

function initSse(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
}

function sseEvent(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ==================== 路由处理 ====================

async function handleGetCharacters(res: http.ServerResponse): Promise<void> {
  const list = await characterService.listCharacters();
  // 补充描述摘要：listCharacters 内部已读卡但丢弃 description，此处补一次轻量读取
  const characters = await Promise.all(list.map(async (c: any) => {
    let description = '';
    try {
      const card = await characterService.readCharacter(c.path);
      description = (card?.data?.description || '').slice(0, 120);
    } catch { /* 读卡失败时摘要留空 */ }
    return {
      id: c.name,
      name: c.characterName || path.basename(c.name, path.extname(c.name)),
      fileName: c.name,
      description,
      tags: c.tags || [],
      creator: c.creator || '',
      version: c.version || '',
      cardVersion: c.cardVersion,
      avatarUrl: `/api/characters/${encodeURIComponent(c.name)}/avatar`,
      modified: c.modified,
    };
  }));
  sendJson(res, 200, { characters });
}

async function handleGetCharacter(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  const card = await characterService.readCharacter(filePath);
  if (!card) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡读取失败' });
    return;
  }
  sendJson(res, 200, { character: { id: characterId, ...card } });
}

async function handleGetAvatar(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  try {
    const buffer = await fs.readFile(filePath);
    sendBinary(res, buffer, contentTypeForFile(characterId));
  } catch {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '头像文件读取失败' });
  }
}

async function handleGetExpressions(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  const manifest = await expressionService.listExpressions(filePath);
  const customLabelMap = new Map<string, string>(
    (manifest.customEmotions || []).map(e => [e.key, e.label])
  );
  const emotions = Object.entries(manifest.expressions || {}).map(([key, entry]: [string, any]) => ({
    key,
    type: entry?.type || 'preset',
    label: customLabelMap.get(key) || key,
    url: `/api/characters/${encodeURIComponent(characterId)}/expressions/${key}`,
  }));
  sendJson(res, 200, { emotions, hasCustom: (manifest.customEmotions || []).length > 0 });
}

async function handleGetExpressionImage(res: http.ServerResponse, characterId: string, emotion: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath || !isValidEmotionKey(emotion)) {
    sendError(res, 404, { code: 'EXPRESSION_NOT_FOUND', message: '表情不存在' });
    return;
  }
  const imagePath = await expressionService.getImagePath(filePath, emotion);
  if (!imagePath) {
    sendError(res, 404, { code: 'EXPRESSION_NOT_FOUND', message: '该情绪未上传表情图' });
    return;
  }
  try {
    const buffer = await fs.readFile(imagePath);
    sendBinary(res, buffer, 'image/png');
  } catch {
    sendError(res, 404, { code: 'EXPRESSION_NOT_FOUND', message: '表情图读取失败' });
  }
}

async function handleGetChatHistory(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  const saved = await chatStorageService.getTestChat(filePath, filePath);
  let messages: any[] = Array.isArray(saved?.messages) ? saved!.messages : [];

  // 无历史且角色卡有 first_mes：合成问候消息（与桌面端首次打开行为一致；不持久化，
  // 首轮对话保存时由 dialogue 管线一并写入）
  if (messages.length === 0) {
    const card = await characterService.readCharacter(filePath);
    const firstMes = card?.data?.first_mes;
    if (firstMes && String(firstMes).trim()) {
      messages = [{ id: 'greeting', role: 'assistant', content: String(firstMes), timestamp: Date.now() }];
    }
  }
  sendJson(res, 200, { messages, updatedAt: saved?.updatedAt });
}

async function handleClearChat(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  await chatStorageService.deleteTestChat(filePath, filePath);
  sendJson(res, 200, { success: true });
}

/**
 * POST /api/chats/:id/rollback（Spec: fix-android-chat-interaction-parity / Task 2）
 *
 * 卷回：删除 messageId（必须为 user 消息）及其后全部消息并持久化，
 * 返回被卷回的用户消息内容。与 PC 端 rollbackToMessage 行为一致
 * （表格快照回退为后续增强，此处仅截断消息）。
 */
async function handleRollbackChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  characterId: string
): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }

  let messageId = '';
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body || '{}');
    messageId = typeof parsed?.messageId === 'string' ? parsed.messageId.trim() : '';
  } catch {
    sendError(res, 400, { code: 'BAD_REQUEST', message: '请求体必须是 JSON（含 messageId 字段）' });
    return;
  }
  if (!messageId) {
    sendError(res, 400, { code: 'BAD_REQUEST', message: 'messageId 不能为空' });
    return;
  }

  const savedChat = await chatStorageService.getTestChat(filePath, filePath);
  const messages: any[] = Array.isArray(savedChat?.messages) ? savedChat!.messages : [];
  const index = messages.findIndex(m => m?.id === messageId);
  if (index === -1) {
    sendError(res, 404, { code: 'MESSAGE_NOT_FOUND', message: '消息不存在' });
    return;
  }
  if (messages[index].role !== 'user') {
    sendError(res, 400, { code: 'NOT_USER_MESSAGE', message: '仅支持卷回用户消息' });
    return;
  }

  const content = String(messages[index].content || '');
  const updatedMessages = messages.slice(0, index);
  const removedCount = messages.length - index;
  const now = Date.now();

  // 空数组也保存（对齐 PC 端 saveChatToStore 行为：保留会话其他字段，
  // 客户端拉取历史时由 handleGetChatHistory 合成 first_mes 问候）
  await chatStorageService.saveTestChat({
    id: savedChat?.id || `test-chat-${now}`,
    creativeId: filePath,
    characterCardId: filePath,
    characterCardName: savedChat?.characterCardName || characterId,
    messages: updatedMessages,
    createdAt: savedChat?.createdAt || now,
    updatedAt: now,
  });

  console.log(`[LanApi] Rolled back chat for ${characterId}: removed ${removedCount} messages`);
  sendJson(res, 200, { success: true, content, removedCount });
}

async function handleSendMessage(req: http.IncomingMessage, res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }

  let content = '';
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body || '{}');
    content = typeof parsed?.content === 'string' ? parsed.content.trim() : '';
  } catch {
    sendError(res, 400, { code: 'BAD_REQUEST', message: '请求体必须是 JSON（含 content 字段）' });
    return;
  }
  if (!content) {
    sendError(res, 400, { code: 'BAD_REQUEST', message: 'content 不能为空' });
    return;
  }
  if (content.length > 20000) {
    sendError(res, 400, { code: 'BAD_REQUEST', message: 'content 过长（上限 20000 字符）' });
    return;
  }

  initSse(res);
  const aborted = () => res.destroyed || !res.writable;
  const heartbeat = setInterval(() => {
    if (aborted()) { clearInterval(heartbeat); return; }
    res.write(': ping\n\n'); // SSE 注释行心跳，防止中间层断开
  }, 15000);
  req.on('close', () => clearInterval(heartbeat));

  await runDialogueTurn(filePath, content, {
    onChunk: delta => { if (!aborted()) sseEvent(res, 'chunk', { delta }); },
    onReasoning: delta => { if (!aborted()) sseEvent(res, 'reasoning', { delta }); },
    onEmotion: emotion => { if (!aborted()) sseEvent(res, 'emotion', { emotion }); },
    onTable: table => { if (!aborted()) sseEvent(res, 'table', table); },
    onOptions: options => { if (!aborted()) sseEvent(res, 'options', { options }); },
    onDone: result => {
      clearInterval(heartbeat);
      if (!aborted()) {
        sseEvent(res, 'done', result);
        res.end();
      }
    },
    onError: err => {
      clearInterval(heartbeat);
      if (!aborted()) {
        sseEvent(res, 'error', err);
        res.end();
      }
    },
  });
}

// ==================== 会话配置与人设（Spec: fix-android-chat-feature-parity / Task 1） ====================

async function handleGetSessionConfig(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  const config = await sessionConfigStore.load(filePath);
  sendJson(res, 200, { config });
}

async function handlePutSessionConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  characterId: string
): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse((await readRequestBody(req)) || '{}');
  } catch {
    sendError(res, 400, { code: 'BAD_REQUEST', message: '请求体必须是 JSON 对象' });
    return;
  }

  const { issues, normalized } = validateAndNormalizeSessionConfig(body);
  if (!normalized) {
    sendError(res, 400, {
      code: 'VALIDATION_ERROR',
      message: issues.map(i => `${i.field}: ${i.reason}`).join('; '),
    });
    return;
  }

  // 字段级合并：PUT 中出现的白名单字段覆盖旧值，未出现的保持不变
  const current = await sessionConfigStore.load(filePath);
  const next: LanSessionConfig = {
    ...current,
    ...(normalized.selectedPersonaId !== undefined ? { selectedPersonaId: normalized.selectedPersonaId } : {}),
    // customParameters 整体替换（客户端保存时始终提交完整参数对象）
    ...(normalized.customParameters !== undefined ? { customParameters: normalized.customParameters } : {}),
    ...(normalized.boundKnowledgeBaseIds !== undefined ? { boundKnowledgeBaseIds: normalized.boundKnowledgeBaseIds } : {}),
    ...(normalized.memoryTableEnabled !== undefined ? { memoryTableEnabled: normalized.memoryTableEnabled } : {}),
    ...(normalized.customStopSequencesEnabled !== undefined ? { customStopSequencesEnabled: normalized.customStopSequencesEnabled } : {}),
    ...(normalized.customStopSequences !== undefined ? { customStopSequences: normalized.customStopSequences } : {}),
    lastUpdated: Date.now(),
  };
  await sessionConfigStore.save(filePath, next);
  sendJson(res, 200, { config: next });
}

// ==================== 角色收藏（与 PC 端共用同一份持久化数据） ====================

async function handleGetFavorites(res: http.ServerResponse): Promise<void> {
  const favorites = await characterFavoritesService.readFavoriteNames();
  sendJson(res, 200, { favorites });
}

async function handlePutFavorites(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse((await readRequestBody(req)) || '{}');
  } catch {
    sendError(res, 400, { code: 'BAD_REQUEST', message: '请求体必须是 JSON 对象' });
    return;
  }
  const items = (body as any)?.favorites;
  if (!Array.isArray(items)) {
    sendError(res, 400, { code: 'VALIDATION_ERROR', message: 'favorites 必须是数组（元素 { fileName, addedAt }）' });
    return;
  }
  // 归一化：接受 fileName / name / path 任一字段标识角色卡
  const normalized = items
    .map((it: any) => ({
      name: typeof it === 'string' ? it : (it?.fileName || it?.name || (typeof it?.path === 'string' ? path.basename(it.path) : '')),
      addedAt: Number(it?.addedAt) || Date.now(),
    }))
    .filter((it: { name: string }) => it.name.length > 0);
  await characterFavoritesService.writeFavorites(normalized);
  const favorites = await characterFavoritesService.readFavoriteNames();
  sendJson(res, 200, { favorites });
}

interface PersonaSummary {
  id: string;
  name: string;
  description: string;
  isGeneric: boolean;
  isSystem: boolean;
  avatarUrl: string | null;
}

async function handleGetPersonas(res: http.ServerResponse): Promise<void> {
  const records = await listPersonaRecords();
  const personas: PersonaSummary[] = records.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description.slice(0, 500),
    isGeneric: r.isGeneric,
    isSystem: r.isSystem,
    avatarUrl: r.avatarPath ? `/api/personas/${encodeURIComponent(r.id)}/avatar` : null,
  }));
  sendJson(res, 200, { personas });
}

async function handleGetPersonaAvatar(res: http.ServerResponse, personaId: string): Promise<void> {
  if (!personaId) {
    sendError(res, 404, { code: 'PERSONA_NOT_FOUND', message: '人设不存在' });
    return;
  }
  const hit = await findPersonaById(personaId);
  if (!hit || !hit.avatarPath) {
    sendError(res, 404, { code: 'PERSONA_NOT_FOUND', message: '人设不存在或未设置头像' });
    return;
  }
  try {
    const buffer = await fs.readFile(hit.avatarPath);
    sendBinary(res, buffer, contentTypeForFile(hit.avatarPath));
  } catch {
    sendError(res, 404, { code: 'PERSONA_NOT_FOUND', message: '人设头像文件读取失败' });
  }
}

/** GET /api/chats/:id/memory-table（Spec: fix-android-chat-feature-parity / Task 4） */
async function handleGetMemoryTable(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  const config = await sessionConfigStore.load(filePath);
  if (!config.memoryTableEnabled) {
    sendJson(res, 200, { enabled: false, sheets: [], headers: {}, data: {}, sheetDescriptions: {} });
    return;
  }
  try {
    const card = await characterService.readCharacter(filePath);
    const charName = card?.data?.name || path.basename(filePath, path.extname(filePath));
    const table = chatLogService.getTableData(charName);
    sendJson(res, 200, {
      enabled: true,
      sheets: table?.sheets || [],
      headers: table?.headers || {},
      data: table?.data || {},
      sheetDescriptions: table?.sheetDescriptions || {},
    });
  } catch (error) {
    // 表格文件不存在/损坏：返回启用态空结构（客户端展示空态）
    sendJson(res, 200, { enabled: true, sheets: [], headers: {}, data: {}, sheetDescriptions: {} });
  }
}

// ==================== 图片生成与素材（Spec: fix-android-chat-feature-parity / Task 5） ====================

/** POST /api/chats/:id/messages/:messageId/image（body 可选 { regenerate?: boolean, aiOptimizeTraits?: boolean }） */
async function handleGenerateImage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  characterId: string,
  messageId: string
): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }

  let regenerate = false;
  let aiOptimizeRequested = false;
  try {
    const parsed = JSON.parse((await readRequestBody(req)) || '{}');
    regenerate = parsed?.regenerate === true;
    aiOptimizeRequested = parsed?.aiOptimizeTraits === true || parsed?.customParameters?.ai_optimize_traits === true;
  } catch { /* 空/非法 body 按默认首次生成处理 */ }

  // SD 生成内部超时 120s + 状态检查/落盘余量：放宽该请求的空闲超时（默认 30s 会中途断开）
  req.setTimeout(300000);

  try {
    const result = await generateConversationImage(filePath, messageId, regenerate);
    const warnings = aiOptimizeRequested
      ? ['ai_optimize_traits: 该功能未在 LAN headless 管线移植（V2 范围边界），本次生成已忽略该开关']
      : undefined;
    if (result.ok) {
      sendJson(res, 200, { imageAttachment: result.imageAttachment, ...(warnings ? { warnings } : {}) });
    } else {
      const statusByCode: Record<string, number> = {
        SD_NOT_CONFIGURED: 400,
        SD_UNAVAILABLE: 503,
        SD_GENERATION_FAILED: 502,
        MESSAGE_NOT_FOUND: 404,
        IMAGE_GENERATION_IN_PROGRESS: 409,
      };
      sendJson(res, statusByCode[result.code] || 500, {
        error: { code: result.code, message: result.message },
        imageAttachment: result.imageAttachment,
        ...(warnings ? { warnings } : {}),
      });
    }
  } catch (error) {
    // generateConversationImage 的并发/前置校验异常（含 .code）
    const code = (error as any)?.code || 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      sendError(res, code === 'MESSAGE_NOT_FOUND' ? 404 : code === 'IMAGE_GENERATION_IN_PROGRESS' ? 409 : 500, { code, message });
    }
  }
}

/** GET /api/assets/:characterId/:assetId（对话图片素材，assetId 白名单校验防穿越） */
async function handleGetAsset(res: http.ServerResponse, characterId: string, assetId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'ASSET_NOT_FOUND', message: '素材不存在' });
    return;
  }
  // assetId 白名单：仅允许 conv_<ts> 等 [A-Za-z0-9_-] 短串（拒绝路径分隔符/点号/data: 前缀）
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(assetId) || assetId.startsWith('data:')) {
    sendError(res, 404, { code: 'ASSET_NOT_FOUND', message: '素材不存在' });
    return;
  }
  const buffer = await readConversationAssetPng(filePath, assetId);
  if (!buffer) {
    sendError(res, 404, { code: 'ASSET_NOT_FOUND', message: '素材文件不存在' });
    return;
  }
  sendBinary(res, buffer, 'image/png');
}

/** GET /api/knowledge-scopes（已向量化的知识库作用域清单，供会话配置绑定选择） */
async function handleGetKnowledgeScopes(res: http.ServerResponse): Promise<void> {
  try {
    const scopes = await vectorRegistryService.getAvailableScopes();
    sendJson(res, 200, {
      scopes: (scopes || []).map((s: any) => ({
        id: s.id,
        label: s.label || s.sourceName || s.id,
        sourceType: s.sourceType,
        sourceName: s.sourceName,
        vectorCount: s.vectorCount ?? 0,
      })),
    });
  } catch (error) {
    // 注册表未初始化等异常：返回空清单（客户端展示空态，不阻塞配置）
    console.warn('[LanApi] 知识库作用域清单读取失败:', error);
    sendJson(res, 200, { scopes: [] });
  }
}

// ==================== 角色卡编辑写端点（Spec: add-mobile-character-card-editor / Task 1.2） ====================

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  WRITE_NOT_SUPPORTED: 400,
  CHARACTER_READ_FAILED: 500,
  WRITE_FAILED: 500,
  CREATE_FAILED: 500,
  DELETE_FAILED: 500,
};

function sendCardError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof CardValidationError) {
    sendError(res, STATUS_BY_CODE[err.code] || 400, { code: err.code, message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendError(res, 500, { code: 'INTERNAL_ERROR', message });
}

/** PUT /api/characters/:id/card（body = 字段补丁，白名单字段级合并） */
async function handlePutCard(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  characterId: string
): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  try {
    const body = JSON.parse((await readRequestBody(req)) || '{}');
    const patch = validateCardFieldsPatch(body);
    await updateCard(filePath, patch);
    sendJson(res, 200, { success: true });
  } catch (err) {
    sendCardError(res, err);
  }
}

/** PUT /api/characters/:id/avatar（body = { imageBase64 }，PNG 载体重建，保留卡数据） */
async function handlePutAvatar(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  characterId: string
): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  try {
    // base64 载体图放宽请求体上限（原始 PNG ≤ 10MB → base64 约 13.4MB）
    const body = JSON.parse((await readRequestBody(req, 15 * 1024 * 1024)) || '{}');
    if (body?.imageBase64 && String(body.imageBase64).length > 15 * 1024 * 1024) {
      throw new CardValidationError('头像图片过大（上限 10MB）');
    }
    const png = decodePngBase64(body?.imageBase64);
    if (png.length > 10 * 1024 * 1024) {
      throw new CardValidationError('头像图片过大（上限 10MB）');
    }
    await replaceAvatar(filePath, png);
    sendJson(res, 200, { success: true });
  } catch (err) {
    if ((err as Error)?.message === 'REQUEST_TOO_LARGE') {
      sendError(res, 400, { code: 'REQUEST_TOO_LARGE', message: '请求体过大（头像上限 10MB）' });
      return;
    }
    sendCardError(res, err);
  }
}

/** POST /api/characters（body = { imageBase64, fields }，新建角色卡） */
async function handleCreateCharacter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = JSON.parse((await readRequestBody(req, 15 * 1024 * 1024)) || '{}');
    const fields = validateCardFieldsPatch(body?.fields ?? {});
    if (typeof fields.name !== 'string' || !fields.name.trim()) {
      throw new CardValidationError('角色名 name 不能为空');
    }
    const png = decodePngBase64(body?.imageBase64);
    if (png.length > 10 * 1024 * 1024) {
      throw new CardValidationError('头像图片过大（上限 10MB）');
    }
    const created = await createCard(fields, png);
    sendJson(res, 200, { success: true, id: created.fileName });
  } catch (err) {
    if ((err as Error)?.message === 'REQUEST_TOO_LARGE') {
      sendError(res, 400, { code: 'REQUEST_TOO_LARGE', message: '请求体过大（头像上限 10MB）' });
      return;
    }
    sendCardError(res, err);
  }
}

/** DELETE /api/characters/:id（与 PC 端 character:delete 一致：仅删卡文件） */
async function handleDeleteCharacter(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  try {
    await deleteCard(filePath);
    sendJson(res, 200, { success: true });
  } catch (err) {
    sendCardError(res, err);
  }
}

/** GET /api/characters/:id/worldbook-relations */
async function handleGetRelations(res: http.ServerResponse, characterId: string): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  try {
    const relations = await readWorldBookRelations(filePath);
    sendJson(res, 200, { relations });
  } catch (err) {
    sendCardError(res, err);
  }
}

/** PUT /api/characters/:id/worldbook-relations（body = { relations: [...] }，整组替换） */
async function handlePutRelations(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  characterId: string
): Promise<void> {
  const filePath = await resolveCharacterPath(characterId);
  if (!filePath) {
    sendError(res, 404, { code: 'CHARACTER_NOT_FOUND', message: '角色卡不存在' });
    return;
  }
  try {
    const body = JSON.parse((await readRequestBody(req)) || '{}');
    const books = await worldBookService.listWorldBooks();
    const relations = await validateRelations(books.map(b => b.name), body?.relations);
    await writeWorldBookRelations(filePath, relations);
    sendJson(res, 200, { success: true, relations });
  } catch (err) {
    sendCardError(res, err);
  }
}

/** GET /api/worldbooks（世界书清单，供绑定选择） */
async function handleGetWorldbooks(res: http.ServerResponse): Promise<void> {
  const books = await worldBookService.listWorldBooks();
  sendJson(res, 200, {
    worldbooks: books.map(b => ({
      name: b.name,
      path: b.path,
      size: b.size,
      modified: b.modified,
    })),
  });
}

// ==================== 请求分发 ====================

async function dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const method = (req.method || 'GET').toUpperCase();

  // CORS 预检（便于浏览器端调试工具直连）
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // /api/health
    if (segments[0] === 'api' && segments[1] === 'health' && method === 'GET' && segments.length === 2) {
      sendJson(res, 200, {
        status: 'ok',
        service: 'creative-cafe-lan-api',
        version: app.getVersion(),
        time: Date.now(),
      });
      return;
    }

    if (segments[0] !== 'api') {
      sendError(res, 404, { code: 'NOT_FOUND', message: '接口不存在' });
      return;
    }

    // /api/characters（角色卡列表）
    if (segments[1] === 'characters' && segments.length === 2 && method === 'GET') {
      return await handleGetCharacters(res);
    }
    if (segments[1] === 'favorites' && segments.length === 2 && method === 'GET') {
      return await handleGetFavorites(res);
    }
    if (segments[1] === 'favorites' && segments.length === 2 && method === 'PUT') {
      return await handlePutFavorites(req, res);
    }

    // /api/characters（新建角色卡：载体图 + 字段）
    if (segments[1] === 'characters' && segments.length === 2 && method === 'POST') {
      return await handleCreateCharacter(req, res);
    }

    // /api/worldbooks（世界书清单，供角色卡编辑绑定选择）
    if (segments[1] === 'worldbooks' && segments.length === 2 && method === 'GET') {
      return await handleGetWorldbooks(res);
    }

    // /api/personas（人设清单）
    if (segments[1] === 'personas' && segments.length === 2 && method === 'GET') {
      return await handleGetPersonas(res);
    }

    // /api/personas/:id/avatar
    if (segments[1] === 'personas' && segments.length === 4 && segments[3] === 'avatar' && method === 'GET') {
      return await handleGetPersonaAvatar(res, segments[2]);
    }

    // /api/knowledge-scopes（知识库作用域清单）
    if (segments[1] === 'knowledge-scopes' && segments.length === 2 && method === 'GET') {
      return await handleGetKnowledgeScopes(res);
    }

    if (segments.length < 3) {
      sendError(res, 404, { code: 'NOT_FOUND', message: '接口不存在' });
      return;
    }

    // /api/characters[...]
    if (segments[1] === 'characters') {
      const characterId = segments[2];
      if (segments.length === 3 && method === 'GET') return await handleGetCharacter(res, characterId);
      if (segments.length === 3 && method === 'DELETE') return await handleDeleteCharacter(res, characterId);
      if (segments.length === 4 && segments[3] === 'card' && method === 'PUT') return await handlePutCard(req, res, characterId);
      if (segments.length === 4 && segments[3] === 'avatar' && method === 'GET') return await handleGetAvatar(res, characterId);
      if (segments.length === 4 && segments[3] === 'avatar' && method === 'PUT') return await handlePutAvatar(req, res, characterId);
      if (segments.length === 4 && segments[3] === 'expressions' && method === 'GET') return await handleGetExpressions(res, characterId);
      if (segments.length === 5 && segments[3] === 'expressions' && method === 'GET') return await handleGetExpressionImage(res, characterId, segments[4]);
      if (segments.length === 4 && segments[3] === 'worldbook-relations' && method === 'GET') return await handleGetRelations(res, characterId);
      if (segments.length === 4 && segments[3] === 'worldbook-relations' && method === 'PUT') return await handlePutRelations(req, res, characterId);
      sendError(res, 404, { code: 'NOT_FOUND', message: '接口不存在' });
      return;
    }

    // /api/assets/:characterId/:assetId（对话图片素材二进制）
    if (segments[1] === 'assets' && segments.length === 4 && method === 'GET') {
      return await handleGetAsset(res, segments[2], segments[3]);
    }

    // /api/chats/:characterId/...
    if (segments[1] === 'chats') {
      const characterId = segments[2];
      if (segments.length === 3 && method === 'GET') return await handleGetChatHistory(res, characterId);
      if (segments.length === 4 && segments[3] === 'clear' && method === 'POST') return await handleClearChat(res, characterId);
      if (segments.length === 4 && segments[3] === 'rollback' && method === 'POST') return await handleRollbackChat(req, res, characterId);
      if (segments.length === 4 && segments[3] === 'messages' && method === 'POST') return await handleSendMessage(req, res, characterId);
      if (segments.length === 4 && segments[3] === 'session-config' && method === 'GET') return await handleGetSessionConfig(res, characterId);
      if (segments.length === 4 && segments[3] === 'session-config' && method === 'PUT') return await handlePutSessionConfig(req, res, characterId);
      if (segments.length === 4 && segments[3] === 'memory-table' && method === 'GET') return await handleGetMemoryTable(res, characterId);
      // /api/chats/:characterId/messages/:messageId/image（图片生成）
      if (segments.length === 6 && segments[3] === 'messages' && segments[5] === 'image' && method === 'POST') {
        return await handleGenerateImage(req, res, characterId, segments[4]);
      }
      sendError(res, 404, { code: 'NOT_FOUND', message: '接口不存在' });
      return;
    }

    sendError(res, 404, { code: 'NOT_FOUND', message: '接口不存在' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      sendError(res, 500, { code: 'INTERNAL_ERROR', message });
    } else {
      // SSE 进行中出错：尽力推送 error 事件并结束
      try { sseEvent(res, 'error', { code: 'INTERNAL_ERROR', message }); res.end(); } catch { /* ignore */ }
    }
  }
}

// ==================== 生命周期 ====================

export function startLanApiServer(): void {
  try {
    const settings = getStorageService().getSettings();
    const lanApi = (settings as any)?.lanApi || {};
    if (lanApi.enabled === false) {
      console.log('[LanApi] LAN API 已在设置中禁用（settings.lanApi.enabled=false）');
      return;
    }
    const port = typeof lanApi.port === 'number' && lanApi.port > 0 ? lanApi.port : DEFAULT_PORT;

    server = http.createServer((req, res) => {
      // 普通请求 30s 超时兜底（SSE 请求在 dispatch 内按需处理，此处仅设置空闲超时上限）
      req.setTimeout(30000);
      dispatch(req, res).catch(err => {
        console.error('[LanApi] dispatch error:', err);
        if (!res.headersSent) {
          sendError(res, 500, { code: 'INTERNAL_ERROR', message: '服务器内部错误' });
        } else {
          try { res.end(); } catch { /* ignore */ }
        }
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      console.error(`[LanApi] HTTP 服务启动/运行失败 (端口 ${port}):`, err.message);
      server = null;
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`[LanApi] LAN API 服务已启动: http://0.0.0.0:${port} （仅供局域网使用，请勿暴露公网）`);
    });
  } catch (error) {
    console.error('[LanApi] 启动失败:', error);
  }
}

export function stopLanApiServer(): void {
  if (server) {
    server.close();
    server = null;
    console.log('[LanApi] LAN API 服务已停止');
  }
}
