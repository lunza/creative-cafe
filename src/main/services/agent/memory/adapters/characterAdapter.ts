/**
 * Character 记忆适配器 —— 桥接 characterService 到 IMemoryAdapter
 *
 * 来源：spec §二 Task 8.3（adapters/characterAdapter）
 * 决策：适配（spec §三）。现有 characterService 管理角色卡 PNG 文件，
 *       本适配器将角色卡信息转换为 MemoryEntry 格式，供 MemoryStore 检索。
 *
 * 职责：
 *  1. 桥接 characterService → MemoryEntry[]（角色卡信息检索）
 *  2. 仅提供只读检索，写入走原 characterService
 *
 * 设计约束（spec §5.1 双轨并行）：
 *  - 不修改 characterService 源码
 *  - 适配器失败不中断 MemoryStore.search
 */

import type { MemoryEntry, MemoryQuery, MemoryType } from '../../contracts';
import type { IMemoryAdapter } from '../memoryStore';

// ==================== Character 适配器 ====================

/**
 * Character 服务接口（characterService 的子集，用于解耦）。
 */
export interface ICharacterService {
  /** 列出所有角色卡 */
  listCharacters(): Promise<Array<{ id: string; name: string; path: string }>>;
  /** 读取角色卡详情 */
  readCharacter(id: string): Promise<{
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    firstMes?: string;
    mesExample?: string;
    systemPrompt?: string;
    tags?: string[];
    creator?: string;
    [key: string]: unknown;
  } | null>;
}

/**
 * Character 记忆适配器。
 *
 * 将角色卡信息转换为 MemoryEntry 格式。
 * type='persona'（角色卡信息）。
 *
 * 检索策略：按角色名/标签关键词匹配。
 */
export class CharacterAdapter implements IMemoryAdapter {
  readonly type: MemoryType = 'persona';

  constructor(private readonly characterService: ICharacterService) {}

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    try {
      const characters = await this.characterService.listCharacters();
      const limit = query.limit ?? 5;
      const results: MemoryEntry[] = [];

      for (const char of characters) {
        // 若指定 characterId，仅返回该角色
        if (query.characterId && char.id !== query.characterId) continue;

        const detail = await this.characterService.readCharacter(char.id);
        if (!detail) continue;

        // 关键词匹配（在 name / description / personality / tags 中搜索）
        const searchText = [
          detail.name,
          detail.description,
          detail.personality,
          (detail.tags ?? []).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();

        const score = query.query
          ? this.computeScore(searchText, query.query.toLowerCase())
          : 1;

        if (score <= 0) continue;

        const content = this.formatCharacterContent(detail);
        results.push({
          id: `persona_${char.id}`,
          type: 'persona',
          content,
          source: `character:${char.id}`,
          score,
          metadata: {
            name: detail.name,
            tags: detail.tags,
            creator: detail.creator,
          },
          characterId: char.id,
          timestamp: Date.now(),
        });

        if (results.length >= limit) break;
      }

      return results;
    } catch (err) {
      console.warn('[CharacterAdapter] search failed:', err);
      return [];
    }
  }

  async read(source: string): Promise<MemoryEntry | null> {
    try {
      // source 格式：character:<characterId>
      const parts = source.split(':');
      if (parts.length < 2) return null;
      const characterId = parts[1];
      const detail = await this.characterService.readCharacter(characterId);
      if (!detail) return null;

      return {
        id: `persona_${characterId}`,
        type: 'persona',
        content: this.formatCharacterContent(detail),
        source,
        metadata: {
          name: detail.name,
          tags: detail.tags,
        },
        characterId,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.warn('[CharacterAdapter] read failed:', err);
      return null;
    }
  }

  /**
   * 格式化角色卡内容为 prompt 文本。
   */
  private formatCharacterContent(detail: {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    firstMes?: string;
  }): string {
    const parts: string[] = [];
    if (detail.name) parts.push(`Name: ${detail.name}`);
    if (detail.description) parts.push(`Description: ${detail.description}`);
    if (detail.personality) parts.push(`Personality: ${detail.personality}`);
    if (detail.scenario) parts.push(`Scenario: ${detail.scenario}`);
    return parts.join('\n');
  }

  /**
   * 计算关键词匹配分数（简化实现）。
   *
   * @returns 0-1 分数，0 表示不匹配
   */
  private computeScore(text: string, query: string): number {
    if (!query) return 1;
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length === 0) return 1;
    let matched = 0;
    for (const word of queryWords) {
      if (text.includes(word)) matched += 1;
    }
    return matched / queryWords.length;
  }
}
