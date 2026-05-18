import fs from 'fs';
import path from 'path';
import { pathService } from './pathService';
import { getStorageService } from './storageService';
import { WorldBookContext, CharacterCardContext } from '../../shared/types/writing.types';

export class WritingResourceManager {
  async loadWorldBooks(worldBookIds: string[]): Promise<WorldBookContext[]> {
    const contexts: WorldBookContext[] = [];
    const storageService = getStorageService();
    const allWorldBooks = storageService.getWorldBooks();
    
    for (const id of worldBookIds) {
      try {
        const worldBook = allWorldBooks[id];
        if (worldBook) {
          contexts.push({
            id: worldBook.id || id,
            name: worldBook.name || 'Unknown',
            content: worldBook.content || '',
            entries: worldBook.entries?.map((entry: any) => ({
              uid: entry.uid || entry.id || '',
              name: entry.name || '',
              content: entry.content || '',
              keywords: entry.keywords || []
            })) || []
          });
        }
      } catch (error) {
        console.error(`[WritingResourceManager] Failed to load world book ${id}:`, error);
      }
    }
    
    return contexts;
  }

  async loadCharacterCards(characterCardIds: string[]): Promise<CharacterCardContext[]> {
    const contexts: CharacterCardContext[] = [];
    
    const characterDir = pathService.getCustomPath('character');
    if (!fs.existsSync(characterDir)) {
      return contexts;
    }

    const { characterService } = require('./characterService');

    for (const id of characterCardIds) {
      try {
        const data = await characterService.readCharacter(id);
        if (data && data.data) {
          const charData = data.data;
          contexts.push({
            id,
            name: charData.name || '',
            description: charData.description || '',
            personality: charData.personality || '',
            scenario: charData.scenario,
            firstMessage: charData.first_mes
          });
        }
      } catch (error) {
        console.error(`[WritingResourceManager] Failed to load character ${id}:`, error);
      }
    }
    
    return contexts;
  }

  buildResourceContextSummary(
    worldBooks: WorldBookContext[],
    characters: CharacterCardContext[]
  ): string {
    const parts: string[] = [];
    
    if (characters.length > 0) {
      parts.push('## 角色信息\n');
      for (const char of characters) {
        parts.push(`### ${char.name}`);
        if (char.description) parts.push(`描述: ${char.description}`);
        if (char.personality) parts.push(`性格: ${char.personality}`);
        parts.push('');
      }
    }
    
    if (worldBooks.length > 0) {
      parts.push('## 世界观设定\n');
      for (const wb of worldBooks) {
        parts.push(`### ${wb.name}`);
        if (wb.content) {
          parts.push(wb.content);
        }
        if (wb.entries && wb.entries.length > 0) {
          for (const entry of wb.entries) {
            parts.push(`#### ${entry.name}`);
            if (entry.content) parts.push(entry.content);
          }
        }
        parts.push('');
      }
    }
    
    return parts.join('\n');
  }
}

export const writingResourceManager = new WritingResourceManager();
