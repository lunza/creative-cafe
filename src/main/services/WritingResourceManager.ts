import fs from 'fs';
import path from 'path';
import { pathService } from './pathService';
import { getStorageService } from './storageService';
import { characterService } from './characterService';
import { worldBookService } from './worldBookService';
import { writingStorageService } from './WritingStorageService';
import { WorldBookContext, CharacterCardContext, UserPersonaContext, WritingStyleResource, WritingStyleAnalysis } from '../../shared/types/writing.types';

export class WritingResourceManager {
  async loadWorldBooks(worldBookIds: string[]): Promise<WorldBookContext[]> {
    const contexts: WorldBookContext[] = [];
    
    for (const id of worldBookIds) {
      try {
        if (!id || typeof id !== 'string') {
          console.warn('[WritingResourceManager] Invalid world book ID:', id);
          continue;
        }

        const data = await worldBookService.readWorldBook(id);
        if (data) {
          const name = data.name || path.basename(id, path.extname(id));
          const entries = data.entries ? Object.values(data.entries) : [];
          
          contexts.push({
            id,
            name,
            content: data.content || '',
            entries: entries.map((entry: any) => ({
              uid: entry.uid || entry.id || '',
              name: entry.name || '',
              content: entry.content || '',
              keywords: entry.keywords || []
            }))
          });
        } else {
          console.warn('[WritingResourceManager] World book data is null for:', id);
        }
      } catch (error) {
        console.error(`[WritingResourceManager] Failed to load world book ${id}:`, error);
      }
    }
    
    console.log('[WritingResourceManager] loadWorldBooks result:', {
      requested: worldBookIds.length,
      loaded: contexts.length,
      names: contexts.map(c => c.name)
    });
    
    return contexts;
  }

  async loadCharacterCards(characterCardIds: string[]): Promise<CharacterCardContext[]> {
    const contexts: CharacterCardContext[] = [];
    
    const characterDir = pathService.getCustomPath('character');
    if (!fs.existsSync(characterDir)) {
      return contexts;
    }

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

  async loadUserPersonas(userPersonaIds: string[]): Promise<UserPersonaContext[]> {
    const contexts: UserPersonaContext[] = [];
    
    if (!userPersonaIds || userPersonaIds.length === 0) {
      return contexts;
    }

    let personaDir: string;
    try {
      personaDir = pathService.getCustomPath('avatar');
    } catch (error) {
      console.warn('[WritingResourceManager] Failed to get avatar directory path:', error);
      return contexts;
    }

    if (!personaDir || !fs.existsSync(personaDir)) {
      console.warn('[WritingResourceManager] Avatar directory does not exist:', personaDir);
      return contexts;
    }

    for (const id of userPersonaIds) {
      try {
        if (!id || typeof id !== 'string') {
          console.warn('[WritingResourceManager] Invalid persona ID:', id);
          continue;
        }

        const resolvedPath = id.startsWith(personaDir) ? id : path.join(personaDir, id);
        
        if (!fs.existsSync(resolvedPath)) {
          console.warn('[WritingResourceManager] Persona file not found:', resolvedPath);
          continue;
        }

        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const personaData = JSON.parse(content);
        
        if (!personaData || typeof personaData !== 'object') {
          console.warn('[WritingResourceManager] Invalid persona data format:', id);
          continue;
        }

        contexts.push({
          id,
          name: personaData.name || '未命名人设',
          description: personaData.description || '',
          avatarPath: personaData.avatarPath
        });
      } catch (error) {
        console.error(`[WritingResourceManager] Failed to load user persona ${id}:`, error);
      }
    }
    
    return contexts;
  }

  async loadWritingStyles(styleIds: string[]): Promise<WritingStyleResource[]> {
    const resources: WritingStyleResource[] = [];
    
    for (const id of styleIds) {
      try {
        const style = await writingStorageService.loadWritingStyle(id);
        if (style && style.status === 'COMPLETED' && style.analysis) {
          resources.push(style);
        }
      } catch (error) {
        console.error(`[WritingResourceManager] Failed to load writing style ${id}:`, error);
      }
    }
    
    return resources;
  }

  buildResourceContextSummary(
    worldBooks: WorldBookContext[],
    characters: CharacterCardContext[],
    userPersonas: UserPersonaContext[] = [],
    writingStyles: WritingStyleResource[] = []
  ): string {
    const parts: string[] = [];
    
    if (userPersonas.length > 0) {
      parts.push('## 用户信息\n');
      for (const persona of userPersonas) {
        parts.push(`### ${persona.name}`);
        if (persona.description) parts.push(persona.description);
        parts.push('');
      }
    }
    
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

    if (writingStyles.length > 0) {
      parts.push('## 写作风格参考\n');
      for (const style of writingStyles) {
        parts.push(`### ${style.name}`);
        if (style.analysis) {
          if (style.analysis.styleOverview) {
            parts.push(`风格概述: ${JSON.stringify(style.analysis.styleOverview)}`);
          }
          if (style.analysis.coreTechniques && style.analysis.coreTechniques.length > 0) {
            parts.push('核心写作技巧:');
            for (const technique of style.analysis.coreTechniques) {
              parts.push(`- ${technique}`);
            }
          }
          if (style.analysis.imitableElements) {
            parts.push(`可模仿要素: ${JSON.stringify(style.analysis.imitableElements)}`);
          }
        }
        parts.push('');
      }
    }
    
    return parts.join('\n');
  }
}

export const writingResourceManager = new WritingResourceManager();
