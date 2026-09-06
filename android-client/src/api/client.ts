/**
 * LAN API 客户端（Spec: add-android-chat-client / R3 R6）
 *
 * - 统一 baseURL（仅保存服务器地址，无任何功能配置）
 * - 连接/请求超时（默认 5s）
 * - 幂等 GET 网络类失败自动重试 1 次
 * - 错误分类：unreachable（不可达）/ timeout（超时）/ http（服务端错误）/ parse（响应异常）
 */

export type ApiErrorKind = 'unreachable' | 'timeout' | 'http' | 'parse';

export class ApiError extends Error {
  kind: ApiErrorKind;
  code?: string;
  status?: number;
  /** 图片生成等接口失败时，服务端错误响应体附带的错误态数据（如 imageAttachment） */
  attachment?: unknown;

  constructor(kind: ApiErrorKind, message: string, code?: string, status?: number) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT = 5000;
const SLOW_TIMEOUT = 15000; // 历史/列表等一次性较大响应

/** 规范化服务器地址：去除协议前缀与尾部斜杠，校验 host[:port] 格式 */
export function normalizeServerAddress(input: string): string {
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/+$/, '');
  if (!s) {
    throw new ApiError('parse', '服务器地址不能为空');
  }
  if (!/^[a-zA-Z0-9._-]+(:\d{1,5})?$/.test(s)) {
    throw new ApiError('parse', '地址格式无效，应为 host:port（例如 192.168.1.100:8787）');
  }
  return s;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function classifyNetworkError(err: unknown): ApiError {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof ApiError) {
    return err;
  }
  const name = (err as { name?: string })?.name || '';
  if (name === 'AbortError' || /abort/i.test(msg)) {
    return new ApiError('timeout', '连接超时，请确认服务端已启动且在同一局域网');
  }
  return new ApiError('unreachable', '无法连接到服务器，请检查地址与网络（需与电脑同一 WiFi）');
}

async function requestOnce<T>(
  baseUrl: string,
  path: string,
  init: RequestInit & { timeoutMs: number }
): Promise<T> {
  const { timeoutMs, ...rest } = init;
  const { signal, cancel } = withTimeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(`http://${baseUrl}${path}`, { ...rest, signal });
  } catch (err) {
    throw classifyNetworkError(err);
  } finally {
    cancel();
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON 响应 */
    }
  }

  if (!res.ok) {
    const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error;
    const apiErr = new ApiError(
      'http',
      errBody?.message || `服务端错误 HTTP ${res.status}`,
      errBody?.code,
      res.status
    );
    // 错误响应体附带的业务数据透出（如图片生成失败的 error 态 imageAttachment）
    const extra = body as { imageAttachment?: unknown } | null;
    if (extra?.imageAttachment) {
      apiErr.attachment = extra.imageAttachment;
    }
    throw apiErr;
  }
  return body as T;
}

/** JSON GET：幂等 → 网络类失败（不可达/超时）自动重试 1 次 */
export async function apiGet<T>(
  baseUrl: string,
  path: string,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  try {
    return await requestOnce<T>(baseUrl, path, { method: 'GET', timeoutMs });
  } catch (err) {
    if (err instanceof ApiError && (err.kind === 'unreachable' || err.kind === 'timeout')) {
      return await requestOnce<T>(baseUrl, path, { method: 'GET', timeoutMs });
    }
    throw err;
  }
}

export async function apiPost<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  return requestOnce<T>(baseUrl, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: opts.timeoutMs ?? SLOW_TIMEOUT,
  });
}

export async function apiPut<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  return requestOnce<T>(baseUrl, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: opts.timeoutMs ?? SLOW_TIMEOUT,
  });
}

export async function apiDelete<T>(
  baseUrl: string,
  path: string,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  return requestOnce<T>(baseUrl, path, {
    method: 'DELETE',
    timeoutMs: opts.timeoutMs ?? SLOW_TIMEOUT,
  });
}

// ==================== 业务接口封装 ====================

import type {
  CharacterSummary,
  CharacterDetail,
  CharacterCardEditData,
  CharacterWorldBookRelation,
  WorldBookSummary,
  ChatMessage,
  ExpressionEntry,
  SessionConfig,
  PersonaSummary,
  KnowledgeScope,
  ImageAttachment,
  ImageGenResponse,
  MemoryTableData,
} from '../types';

export interface HealthInfo {
  status: string;
  service: string;
  version: string;
  time: number;
}

export function checkHealth(baseUrl: string): Promise<HealthInfo> {
  return apiGet<HealthInfo>(baseUrl, '/api/health');
}

export function fetchCharacters(baseUrl: string): Promise<CharacterSummary[]> {
  return apiGet<{ characters: CharacterSummary[] }>(baseUrl, '/api/characters', {
    timeoutMs: SLOW_TIMEOUT,
  }).then(r => r.characters);
}

/** 收藏项（name = 角色卡文件名，与 PC 端共用服务端同一份持久化数据） */
export interface FavoriteItem {
  fileName: string;
  addedAt: number;
}

/** 获取收藏列表（与 PC 端 favoritesStore 数据互通） */
export function fetchFavorites(baseUrl: string): Promise<FavoriteItem[]> {
  return apiGet<{ favorites: Array<{ name: string; addedAt: number }> }>(baseUrl, '/api/favorites')
    .then(r => (r.favorites || []).map(f => ({ fileName: f.name, addedAt: f.addedAt })));
}

/** 全量替换收藏列表（服务端持久化，PC 端下次同步生效） */
export function saveFavorites(baseUrl: string, favorites: FavoriteItem[]): Promise<FavoriteItem[]> {
  return apiPut<{ favorites: Array<{ name: string; addedAt: number }> }>(
    baseUrl,
    '/api/favorites',
    { favorites: favorites.map(f => ({ fileName: f.fileName, addedAt: f.addedAt })) }
  ).then(r => (r.favorites || []).map(f => ({ fileName: f.name, addedAt: f.addedAt })));
}

export function fetchExpressions(baseUrl: string, characterId: string): Promise<ExpressionEntry[]> {
  return apiGet<{ emotions: ExpressionEntry[] }>(
    baseUrl,
    `/api/characters/${encodeURIComponent(characterId)}/expressions`
  ).then(r => r.emotions);
}

export function fetchChatHistory(baseUrl: string, characterId: string): Promise<ChatMessage[]> {
  // 服务端持久化字段为 options（dialogue.ts assistantMessage），客户端渲染字段为 suggestedOptions——此处映射
  return apiGet<{ messages: Array<ChatMessage & { options?: unknown }> }>(
    baseUrl,
    `/api/chats/${encodeURIComponent(characterId)}`,
    { timeoutMs: SLOW_TIMEOUT }
  ).then(r =>
    (r.messages || []).map(({ options, ...rest }) => ({
      ...rest,
      suggestedOptions:
        Array.isArray(options) && options.every(x => typeof x === 'string') && options.length > 0
          ? (options as string[])
          : rest.suggestedOptions,
    }))
  );
}

export function clearChat(baseUrl: string, characterId: string): Promise<void> {
  return apiPost(baseUrl, `/api/chats/${encodeURIComponent(characterId)}/clear`);
}

/**
 * 卷回消息（Spec: fix-android-chat-interaction-parity / Task 3）
 * 删除 messageId（须为 user 消息）及其后全部消息并持久化，返回被卷回内容。
 */
export function rollbackChat(
  baseUrl: string,
  characterId: string,
  messageId: string
): Promise<{ success: boolean; content: string; removedCount: number }> {
  return apiPost<{ success: boolean; content: string; removedCount: number }>(
    baseUrl,
    `/api/chats/${encodeURIComponent(characterId)}/rollback`,
    { messageId }
  );
}

/** 二进制资源（头像/立绘）绝对 URL */
export function assetUrl(baseUrl: string, relativeUrl: string): string {
  return `http://${baseUrl}${relativeUrl}`;
}

// ==================== 会话配置 / 人设 / 图片 / 表格（Spec: fix-android-chat-feature-parity / Task 6） ====================

export function getSessionConfig(baseUrl: string, characterId: string): Promise<SessionConfig> {
  return apiGet<{ config: SessionConfig }>(
    baseUrl,
    `/api/chats/${encodeURIComponent(characterId)}/session-config`
  ).then(r => r.config);
}

/** PUT 会话配置（服务端字段级合并：请求中出现的白名单字段覆盖，其余保持） */
export function putSessionConfig(
  baseUrl: string,
  characterId: string,
  config: Partial<SessionConfig>
): Promise<SessionConfig> {
  return apiPut<{ config: SessionConfig }>(
    baseUrl,
    `/api/chats/${encodeURIComponent(characterId)}/session-config`,
    config
  ).then(r => r.config);
}

export function fetchPersonas(baseUrl: string): Promise<PersonaSummary[]> {
  return apiGet<{ personas: PersonaSummary[] }>(baseUrl, '/api/personas', {
    timeoutMs: SLOW_TIMEOUT,
  }).then(r => r.personas || []);
}

/** 知识库作用域清单（已向量化条目，供会话配置绑定选择） */
export function fetchKnowledgeScopes(baseUrl: string): Promise<KnowledgeScope[]> {
  return apiGet<{ scopes: KnowledgeScope[] }>(baseUrl, '/api/knowledge-scopes', {
    timeoutMs: SLOW_TIMEOUT,
  }).then(r => r.scopes || []);
}

/**
 * 触发消息图片生成（SD 生成为长耗时操作，超时 5 分钟对齐服务端请求空闲上限）。
 * HTTP 非 2xx（SD 未配置/不可用/生成失败）时抛 ApiError，
 * 错误响应体中的 imageAttachment（status='error') 挂在 err.attachment 供 UI 渲染。
 */
export function generateImage(
  baseUrl: string,
  characterId: string,
  messageId: string,
  regenerate: boolean
): Promise<ImageGenResponse> {
  return apiPost<ImageGenResponse>(
    baseUrl,
    `/api/chats/${encodeURIComponent(characterId)}/messages/${encodeURIComponent(messageId)}/image`,
    { regenerate },
    { timeoutMs: 300000 }
  );
}

/** 对话图片素材绝对 URL（assetId 为磁盘 ID；data: URL 原样返回供 <Image> 直接使用） */
export function conversationImageUrl(baseUrl: string, characterId: string, assetId: string): string {
  if (assetId.startsWith('data:')) return assetId;
  return `http://${baseUrl}/api/assets/${encodeURIComponent(characterId)}/${encodeURIComponent(assetId)}`;
}

export function fetchMemoryTable(baseUrl: string, characterId: string): Promise<MemoryTableData> {
  return apiGet<MemoryTableData>(
    baseUrl,
    `/api/chats/${encodeURIComponent(characterId)}/memory-table`,
    { timeoutMs: SLOW_TIMEOUT }
  );
}

// ==================== 角色卡编辑（Spec: add-mobile-character-card-editor / Task 2.2） ====================

/** 角色卡详情（含完整 data 与 worldBooks） */
export function fetchCharacterCard(baseUrl: string, characterId: string): Promise<CharacterDetail> {
  return apiGet<{ character: CharacterDetail }>(
    baseUrl,
    `/api/characters/${encodeURIComponent(characterId)}`,
    { timeoutMs: SLOW_TIMEOUT }
  ).then(r => r.character);
}

/** 更新角色卡字段（白名单字段级合并） */
export function putCharacterCard(
  baseUrl: string,
  characterId: string,
  patch: Partial<CharacterCardEditData>
): Promise<void> {
  return apiPut(baseUrl, `/api/characters/${encodeURIComponent(characterId)}/card`, patch);
}

/** 更换头像（base64 PNG 载体图） */
export function putCharacterAvatar(
  baseUrl: string,
  characterId: string,
  imageBase64: string
): Promise<void> {
  return apiPut(
    baseUrl,
    `/api/characters/${encodeURIComponent(characterId)}/avatar`,
    { imageBase64 },
    { timeoutMs: 30000 }
  );
}

/** 新建角色卡（载体图 + 字段） */
export function createCharacter(
  baseUrl: string,
  imageBase64: string,
  fields: Partial<CharacterCardEditData>
): Promise<{ id: string }> {
  return apiPost<{ id: string }>(
    baseUrl,
    '/api/characters',
    { imageBase64, fields },
    { timeoutMs: 30000 }
  );
}

/** 删除角色卡（仅删卡文件，对话历史不动） */
export function deleteCharacter(baseUrl: string, characterId: string): Promise<void> {
  return apiDelete<{ success: boolean }>(
    baseUrl,
    `/api/characters/${encodeURIComponent(characterId)}`
  ).then(() => undefined);
}

/** 读世界书绑定 */
export function getWorldBookRelations(
  baseUrl: string,
  characterId: string
): Promise<CharacterWorldBookRelation[]> {
  return apiGet<{ relations: CharacterWorldBookRelation[] }>(
    baseUrl,
    `/api/characters/${encodeURIComponent(characterId)}/worldbook-relations`
  ).then(r => r.relations || []);
}

/** 写世界书绑定（整组替换） */
export function putWorldBookRelations(
  baseUrl: string,
  characterId: string,
  relations: CharacterWorldBookRelation[]
): Promise<void> {
  return apiPut(
    baseUrl,
    `/api/characters/${encodeURIComponent(characterId)}/worldbook-relations`,
    { relations }
  );
}

/** 世界书清单（供绑定选择） */
export function fetchWorldbooks(baseUrl: string): Promise<WorldBookSummary[]> {
  return apiGet<{ worldbooks: WorldBookSummary[] }>(baseUrl, '/api/worldbooks', {
    timeoutMs: SLOW_TIMEOUT,
  }).then(r => r.worldbooks || []);
}
