/**
 * 角色卡写操作用例（Spec: add-mobile-character-card-editor / Task 1.1）
 *
 * 复用 characterService 既有 CRUD（与 PC 端 IPC 同一实现，双端数据同源）：
 *   - updateCard：白名单字段级合并后 writeCharacter（v2 chara + v3 ccv3 双写）
 *   - replaceAvatar：base64 载体图校验后以 createFromImage 语义重建 PNG（保留现有卡数据）
 *   - createCard：文件名清洗 + 去重后 createCharacterFromImage
 *   - deleteCard：仅删卡文件（与 PC 端 character:delete 一致，历史会话存储不动）
 * 世界书关系直接使用 characterService.getWorldBookRelations/setWorldBookRelations。
 */

import fs from 'fs/promises';
import path from 'path';
import extract from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';
import { characterService } from '../characterService';

/** 可编辑字段白名单（与 PC 端 CharacterEditModal 保存字段一致） */
const CARD_STRING_FIELDS = [
  'name', 'nickname', 'description', 'personality', 'scenario',
  'creator_notes', 'creator', 'character_version', 'source',
  'system_prompt', 'post_history_instructions', 'first_mes',
] as const;

/** 兼容单值或数组的字段（v3 规范允许 mes_example 与 group_only_greetings 为 string 或 array） */
const CARD_STRING_OR_LIST_FIELDS = ['mes_example', 'group_only_greetings'] as const;

const CARD_LIST_FIELDS = ['alternate_greetings', 'tags'] as const;

const MAX_TEXT_LEN = 100_000;
const MAX_NAME_LEN = 200;
const MAX_LIST_ITEMS = 64;
const MAX_LIST_ITEM_LEN = 20_000;
const MAX_TAGS = 50;
const MAX_TAG_LEN = 100;

export class CardValidationError extends Error {
  code: string;
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.code = code;
  }
}

/** 校验并规范化字段补丁：仅接受白名单内字段，越权字段直接拒绝（防误写 spec/extensions 等结构） */
export function validateCardFieldsPatch(patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new CardValidationError('请求体必须是字段对象');
  }
  const src = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of CARD_STRING_OR_LIST_FIELDS) {
    if (!(key in src)) continue;
    const v = src[key];
    if (v === undefined || v === null) { out[key] = ''; continue; }
    if (typeof v === 'string') {
      out[key] = v;
    } else if (Array.isArray(v)) {
      if (v.length > MAX_LIST_ITEMS) throw new CardValidationError(`字段 ${key} 条目过多（上限 ${MAX_LIST_ITEMS}）`);
      for (const item of v) {
        if (typeof item !== 'string') throw new CardValidationError(`字段 ${key} 的条目必须是字符串`);
        if (item.length > MAX_LIST_ITEM_LEN) throw new CardValidationError(`字段 ${key} 的条目过长（上限 ${MAX_LIST_ITEM_LEN} 字符）`);
      }
      out[key] = v;
    } else {
      throw new CardValidationError(`字段 ${key} 必须是字符串或字符串数组`);
    }
  }

  for (const key of CARD_STRING_FIELDS) {
    if (!(key in src)) continue;
    const v = src[key];
    if (v === undefined || v === null) { out[key] = ''; continue; }
    if (typeof v !== 'string') throw new CardValidationError(`字段 ${key} 必须是字符串`);
    if (v.length > MAX_TEXT_LEN) throw new CardValidationError(`字段 ${key} 过长（上限 ${MAX_TEXT_LEN} 字符）`);
    if (key === 'name' && !v.trim()) throw new CardValidationError('角色名 name 不能为空');
    if (key === 'name' && v.length > MAX_NAME_LEN) throw new CardValidationError(`角色名过长（上限 ${MAX_NAME_LEN} 字符）`);
    out[key] = v;
  }

  for (const key of CARD_LIST_FIELDS) {
    if (!(key in src)) continue;
    const v = src[key];
    if (v === undefined || v === null) { out[key] = []; continue; }
    if (!Array.isArray(v)) throw new CardValidationError(`字段 ${key} 必须是字符串数组`);
    if (v.length > MAX_LIST_ITEMS) throw new CardValidationError(`字段 ${key} 条目过多（上限 ${MAX_LIST_ITEMS}）`);
    const itemLimit = key === 'tags' ? MAX_TAG_LEN : MAX_LIST_ITEM_LEN;
    const countLimit = key === 'tags' ? MAX_TAGS : MAX_LIST_ITEMS;
    if (v.length > countLimit) throw new CardValidationError(`字段 ${key} 条目过多（上限 ${countLimit}）`);
    for (const item of v) {
      if (typeof item !== 'string') throw new CardValidationError(`字段 ${key} 的条目必须是字符串`);
      if (item.length > itemLimit) throw new CardValidationError(`字段 ${key} 的条目过长（上限 ${itemLimit} 字符）`);
    }
    out[key] = v;
  }

  const known = new Set<string>([...CARD_STRING_FIELDS, ...CARD_LIST_FIELDS]);
  const illegal = Object.keys(src).filter(k => !known.has(k));
  if (illegal.length > 0) {
    throw new CardValidationError(`包含不可编辑字段: ${illegal.join(', ')}`);
  }
  if (!('name' in out) && Object.keys(out).length === 0) {
    throw new CardValidationError('请求体不能为空');
  }
  return out;
}

/**
 * raw 级读取角色卡数据（不经过 char-card-reader 的 toSpecV3 白名单过滤）。
 * 直接解 PNG tEXt chunk（优先 v3 ccv3，回退 v2 chara），
 * 保证 worldBooks 等非标准字段在移动端编辑链路（改字段/换头像/改关系）中保真不丢。
 * @returns 与 toSpecV3 同构的 { spec, spec_version, data }；失败返回 null
 */
export async function readRawCardData(filePath: string): Promise<{ spec?: string; spec_version?: string; data: Record<string, unknown> } | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return null;
  }
  const chunks = extract(new Uint8Array(buf));
  let ccv3: any = null;
  let chara: any = null;
  for (const chunk of chunks) {
    if (chunk.name !== 'tEXt') continue;
    try {
      const decoded = PNGtext.decode(chunk.data);
      if (decoded.keyword.toLowerCase() === 'ccv3') {
        ccv3 = JSON.parse(Buffer.from(decoded.text, 'base64').toString('utf8'));
      } else if (decoded.keyword.toLowerCase() === 'chara') {
        chara = JSON.parse(Buffer.from(decoded.text, 'base64').toString('utf8'));
      }
    } catch { /* 忽略损坏 chunk */ }
  }
  if (ccv3 && typeof ccv3.data === 'object' && ccv3.data) {
    return { spec: 'chara_card_v3', spec_version: '3.0', data: ccv3.data };
  }
  if (chara && typeof chara.data === 'object' && chara.data) {
    return { data: chara.data };
  }
  return null;
}

/** 解析 base64 载体图（容忍 data:image/...;base64, 前缀）并校验 PNG 魔数 */
export function decodePngBase64(input: unknown): Buffer {
  if (typeof input !== 'string' || !input.trim()) {
    throw new CardValidationError('imageBase64 不能为空', 'BAD_REQUEST');
  }
  const b64 = input.includes(',') && input.trim().startsWith('data:')
    ? input.slice(input.indexOf(',') + 1)
    : input;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 8 || buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new CardValidationError('不是有效的 PNG 图片（仅支持 PNG 作为角色卡载体）');
  }
  return buf;
}

/** PUT /api/characters/:id/card：字段级合并写回（raw 读 → 合并 → 双 spec 写回，保留 worldBooks 等非标准字段） */
export async function updateCard(filePath: string, patch: Record<string, unknown>): Promise<void> {
  if (!filePath.endsWith('.png')) {
    throw new CardValidationError('该角色卡载体不是 PNG，无法写字段（请先更换头像转换为 PNG）', 'WRITE_NOT_SUPPORTED');
  }
  const card = await readRawCardData(filePath);
  if (!card || !card.data) {
    throw new CardValidationError('角色卡读取失败', 'CHARACTER_READ_FAILED');
  }
  const merged = { ...card.data, ...patch };
  const result = await characterService.writeCharacter(filePath, { data: merged });
  if (!result.success) {
    throw new CardValidationError(`写入失败: ${String(result.error)}`, 'WRITE_FAILED');
  }
}

/** PUT /api/characters/:id/avatar：base64 新载体图 + 保留现有卡数据重建 PNG（raw 读保真） */
export async function replaceAvatar(filePath: string, pngBuffer: Buffer): Promise<void> {
  if (!filePath.endsWith('.png')) {
    throw new CardValidationError('该角色卡载体不是 PNG，无法更换头像（与 PC 端一致：仅 PNG 卡可写）', 'WRITE_NOT_SUPPORTED');
  }
  const card = await readRawCardData(filePath);
  if (!card || !card.data) {
    throw new CardValidationError('角色卡读取失败', 'CHARACTER_READ_FAILED');
  }
  const result = await characterService.createCharacterFromImage(
    filePath,
    pngBuffer.toString('base64'),
    { data: card.data }
  );
  if (!result.success) {
    throw new CardValidationError(`头像替换失败: ${String(result.error)}`, 'WRITE_FAILED');
  }
}

/** 文件名清洗：去除非法字符，限长，空名回退 */
function sanitizeFileName(name: string): string {
  const base = (name || '').trim()
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 50);
  return base || 'character';
}

/** POST /api/characters：新建角色卡，返回新文件名（目录内唯一） */
export async function createCard(
  fields: Record<string, unknown>,
  pngBuffer: Buffer
): Promise<{ fileName: string }> {
  const name = typeof fields.name === 'string' ? fields.name : '';
  if (!name.trim()) throw new CardValidationError('角色名 name 不能为空');

  const dir = characterService.getCharacterDir();
  await fs.mkdir(dir, { recursive: true });
  const base = sanitizeFileName(name);
  let fileName = `${base}.png`;
  for (let i = 2; ; i++) {
    const exists = await fs.access(path.join(dir, fileName)).then(() => true).catch(() => false);
    if (!exists) break;
    fileName = `${base}-${i}.png`;
  }
  const targetPath = path.join(dir, fileName);

  // 卡内完整字段：白名单字段 + 默认 spec 元数据
  const cardData: Record<string, unknown> = {
    name,
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    ...fields,
  };

  const result = await characterService.createCharacterFromImage(
    targetPath,
    pngBuffer.toString('base64'),
    { data: cardData }
  );
  if (!result.success) {
    throw new CardValidationError(`新建失败: ${String(result.error)}`, 'CREATE_FAILED');
  }
  return { fileName };
}

/** DELETE /api/characters/:id：仅删卡文件（与 PC 端 character:delete 一致） */
export async function deleteCard(filePath: string): Promise<void> {
  const result = await characterService.deleteCharacter(filePath);
  if (!result.success) {
    throw new CardValidationError(`删除失败: ${String(result.error)}`, 'DELETE_FAILED');
  }
}

// ==================== 世界书关系（Spec: add-mobile-character-card-editor / Task 1.1） ====================

export interface WorldBookRelationInput {
  worldBookPath: string;
  worldBookName?: string;
  enabled: boolean;
  priority: number;
  filterTags?: string[];
}

/** GET /api/characters/:id/worldbook-relations：raw 读卡，返回 worldBooks 数组（不存在返回 []） */
export async function readWorldBookRelations(filePath: string): Promise<WorldBookRelationInput[]> {
  const card = await readRawCardData(filePath);
  if (!card || !card.data) return [];
  const wb = card.data.worldBooks;
  return Array.isArray(wb) ? (wb as WorldBookRelationInput[]) : [];
}

/** PUT /api/characters/:id/worldbook-relations：raw 读 → 整组替换 worldBooks → 双 spec 写回 */
export async function writeWorldBookRelations(
  filePath: string,
  relations: WorldBookRelationInput[]
): Promise<void> {
  if (!filePath.endsWith('.png')) {
    throw new CardValidationError('该角色卡载体不是 PNG，无法写关系', 'WRITE_NOT_SUPPORTED');
  }
  const card = await readRawCardData(filePath);
  if (!card || !card.data) {
    throw new CardValidationError('角色卡读取失败', 'CHARACTER_READ_FAILED');
  }
  const next = { ...card.data, worldBooks: relations };
  const result = await characterService.writeCharacter(filePath, { data: next });
  if (!result.success) {
    throw new CardValidationError(`保存失败: ${String(result.error)}`, 'WRITE_FAILED');
  }
}

/** 校验关系数组（worldBookPath 必须命中服务端世界书目录真实文件，防路径穿越） */
export async function validateRelations(
  worldBookDirFiles: string[],
  input: unknown
): Promise<WorldBookRelationInput[]> {
  if (!Array.isArray(input)) {
    throw new CardValidationError('relations 必须是数组');
  }
  if (input.length > 32) throw new CardValidationError('绑定世界书过多（上限 32）');

  const validPaths = new Set(worldBookDirFiles);
  return input.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new CardValidationError(`relations[${idx}] 必须是对象`);
    }
    const r = item as Record<string, unknown>;
    const worldBookPath = typeof r.worldBookPath === 'string' ? r.worldBookPath : '';
    if (!worldBookPath || worldBookPath.includes('..')) {
      throw new CardValidationError(`relations[${idx}].worldBookPath 无效`);
    }
    // 与 PC 端一致按绝对路径存储；校验 basename 命中世界书目录
    const base = path.basename(worldBookPath);
    if (!validPaths.has(base)) {
      throw new CardValidationError(`relations[${idx}] 世界书不存在: ${base}`);
    }
    const enabled = r.enabled === undefined ? true : r.enabled === true;
    let priority = 5;
    if (r.priority !== undefined) {
      if (typeof r.priority !== 'number' || !Number.isInteger(r.priority) || r.priority < 0 || r.priority > 100) {
        throw new CardValidationError(`relations[${idx}].priority 须为 0-100 整数`);
      }
      priority = r.priority;
    }
    let filterTags: string[] | undefined;
    if (r.filterTags !== undefined) {
      if (!Array.isArray(r.filterTags) || r.filterTags.some(t => typeof t !== 'string' || t.length > 100)) {
        throw new CardValidationError(`relations[${idx}].filterTags 须为字符串数组`);
      }
      filterTags = r.filterTags as string[];
    }
    const worldBookName = typeof r.worldBookName === 'string' ? r.worldBookName.slice(0, 200) : undefined;
    const out: WorldBookRelationInput = { worldBookPath, enabled, priority };
    if (worldBookName !== undefined) out.worldBookName = worldBookName;
    if (filterTags !== undefined) out.filterTags = filterTags;
    return out;
  });
}
