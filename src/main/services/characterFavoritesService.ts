/**
 * 角色收藏服务（Spec: 移动端角色列表排序对齐 PC 端）
 *
 * 收藏数据统一持久化在 userData/character-favorites.json（主进程文件），
 * PC 端（经 IPC）与移动端（经 LAN API）读写同一份数据，保证两端收藏互通、
 * 角色列表"收藏置顶"排序结果一致。
 *
 * 存储格式（name = 角色卡文件名，与角色目录解耦，目录迁移不失效）：
 * { "favorites": [{ "name": "Ceroba.png", "addedAt": 1234567890 }] }
 *
 * 对外接口按调用方需要返回 name（LAN API/移动端）或绝对 path（PC 渲染端 favoritesStore）。
 */

import fs from 'fs/promises';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';
import { characterService } from './characterService';

export interface StoredFavorite {
  /** 角色卡文件名（basename） */
  name: string;
  /** 收藏时间戳（ms） */
  addedAt: number;
}

export interface FavoriteWithPath {
  /** 角色卡绝对路径（PC 渲染端 favoritesStore 匹配用） */
  path: string;
  name: string;
  addedAt: number;
}

const FAVORITES_FILE = 'character-favorites.json';

function favoritesFilePath(): string {
  return path.join(getUserDataPath(), FAVORITES_FILE);
}

/** 归一化任意输入（path 或 name）为文件名 */
function toName(item: { path?: string; name?: string }): string {
  if (item.path) return path.basename(item.path);
  return item.name || '';
}

async function readRaw(): Promise<StoredFavorite[]> {
  try {
    const raw = await fs.readFile(favoritesFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.favorites)) {
      return parsed.favorites
        .filter((f: any) => f && typeof f.name === 'string' && f.name.length > 0)
        .map((f: any) => ({ name: f.name, addedAt: Number(f.addedAt) || Date.now() }));
    }
    return [];
  } catch {
    // 文件不存在或损坏：视为空收藏
    return [];
  }
}

async function writeRaw(items: StoredFavorite[]): Promise<void> {
  const dir = path.dirname(favoritesFilePath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(favoritesFilePath(), JSON.stringify({ favorites: items }, null, 2), 'utf-8');
}

class CharacterFavoritesService {
  /**
   * 读取收藏（PC 渲染端用：返回绝对 path 形式，与 favoritesStore 的
   * FavoriteCharacter { path, addedAt } 结构兼容）。
   */
  async readFavorites(): Promise<FavoriteWithPath[]> {
    const raw = await readRaw();
    return raw.map(f => ({ ...f, path: path.join(getCharacterDirSafe(), f.name) }));
  }

  /** 读取收藏（LAN API/移动端用：返回文件名形式） */
  async readFavoriteNames(): Promise<StoredFavorite[]> {
    return readRaw();
  }

  /**
   * 全量替换收藏。接受 path（PC 端绝对路径）或 name（移动端文件名），
   * 统一转文件名持久化。幂等。
   */
  async writeFavorites(items: Array<{ path?: string; name?: string; addedAt?: number }>): Promise<void> {
    const normalized: StoredFavorite[] = (items || [])
      .map(item => ({
        name: toName(item),
        addedAt: Number(item.addedAt) || Date.now(),
      }))
      .filter(f => f.name.length > 0);
    // 去重（同名保留首个）
    const seen = new Set<string>();
    const deduped = normalized.filter(f => {
      if (seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });
    await writeRaw(deduped);
  }

  /** 收藏文件是否存在且非空（用于 PC 端判断是否需要迁移 localStorage 旧数据） */
  async hasStoredFavorites(): Promise<boolean> {
    return (await readRaw()).length > 0;
  }
}

/** 角色目录（仅用于把文件名还原成绝对路径；目录取不到时用 userData 兜底） */
function getCharacterDirSafe(): string {
  try {
    const dir = characterService.getCharacterDir();
    if (typeof dir === 'string' && dir.length > 0) return dir;
  } catch { /* 忽略，走兜底 */ }
  return getUserDataPath();
}

export const characterFavoritesService = new CharacterFavoritesService();
