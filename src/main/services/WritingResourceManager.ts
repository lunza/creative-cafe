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
    
    // Task 2.1: 去重处理
    const originalCount = worldBookIds.length;
    const uniqueIds = [...new Set(worldBookIds)];
    const deduplicatedCount = uniqueIds.length;
    if (originalCount !== deduplicatedCount) {
      console.log(`[WritingResourceManager] loadWorldBooks 去重: ${originalCount} -> ${deduplicatedCount} 个资源`);
    }
    
    console.log(`[WritingResourceManager] loadWorldBooks 请求加载 ${deduplicatedCount} 个世界书:`, uniqueIds);
    
    for (const id of uniqueIds) {
      try {
        if (!id || typeof id !== 'string') {
          console.warn('[WritingResourceManager] Invalid world book ID:', id);
          continue;
        }

        const data = await worldBookService.readWorldBook(id);
        if (data) {
          const name = data.name || path.basename(id, path.extname(id));
          const entries = data.entries ? Object.values(data.entries) : [];
          
          // Task 3.1: 内容检查
          const hasContent = data.content && data.content.trim().length > 0;
          const hasEntries = entries.length > 0;
          if (!hasContent && !hasEntries) {
            console.warn(`[WritingResourceManager] World book "${name}" 内容为空 (content: ${hasContent}, entries: ${hasEntries})`);
          }
          
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
      requested: deduplicatedCount,
      loaded: contexts.length,
      names: contexts.map(c => c.name)
    });
    
    return contexts;
  }

  async loadCharacterCards(characterCardIds: string[]): Promise<CharacterCardContext[]> {
    const contexts: CharacterCardContext[] = [];
    
    const characterDir = pathService.getCustomPath('character');
    if (!fs.existsSync(characterDir)) {
      console.warn('[WritingResourceManager] Character directory does not exist:', characterDir);
      return contexts;
    }

    // Task 2.2: 去重处理
    const originalCount = characterCardIds.length;
    const uniqueIds = [...new Set(characterCardIds)];
    const deduplicatedCount = uniqueIds.length;
    if (originalCount !== deduplicatedCount) {
      console.log(`[WritingResourceManager] loadCharacterCards 去重: ${originalCount} -> ${deduplicatedCount} 个资源`);
    }
    
    console.log(`[WritingResourceManager] loadCharacterCards 请求加载 ${deduplicatedCount} 个角色卡:`, uniqueIds);

    for (const id of uniqueIds) {
      try {
        const data = await characterService.readCharacter(id);
        if (data && data.data) {
          const charData = data.data;
          
          let mesExample: string | undefined;
          if (Array.isArray(charData.mes_example)) {
            mesExample = charData.mes_example.join('\n\n');
          } else if (charData.mes_example && typeof charData.mes_example === 'string') {
            mesExample = charData.mes_example;
          }
          
          // Task 3.2: 内容检查
          const hasDescription = charData.description && charData.description.trim().length > 0;
          const hasPersonality = charData.personality && charData.personality.trim().length > 0;
          const hasMesExample = mesExample && mesExample.trim().length > 0;
          if (!hasDescription && !hasPersonality && !hasMesExample) {
            console.warn(`[WritingResourceManager] Character "${charData.name || id}" 内容为空 (description: ${hasDescription}, personality: ${hasPersonality}, mesExample: ${hasMesExample})`);
          }
          
          contexts.push({
            id,
            name: charData.name || '',
            description: charData.description || '',
            personality: charData.personality || '',
            scenario: charData.scenario,
            firstMessage: charData.first_mes,
            mesExample
          });
        }
      } catch (error) {
        console.error(`[WritingResourceManager] Failed to load character ${id}:`, error);
      }
    }
    
    console.log('[WritingResourceManager] loadCharacterCards result:', {
      requested: deduplicatedCount,
      loaded: contexts.length,
      names: contexts.map(c => c.name)
    });
    
    return contexts;
  }

  async loadUserPersonas(userPersonaIds: string[]): Promise<UserPersonaContext[]> {
    const contexts: UserPersonaContext[] = [];
    
    if (!userPersonaIds || userPersonaIds.length === 0) {
      return contexts;
    }

    // Task 2.3: 去重处理
    const originalCount = userPersonaIds.length;
    const uniqueIds = [...new Set(userPersonaIds)];
    const deduplicatedCount = uniqueIds.length;
    if (originalCount !== deduplicatedCount) {
      console.log(`[WritingResourceManager] loadUserPersonas 去重: ${originalCount} -> ${deduplicatedCount} 个资源`);
    }
    
    console.log(`[WritingResourceManager] loadUserPersonas 请求加载 ${deduplicatedCount} 个用户人设:`, uniqueIds);

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

    for (const id of uniqueIds) {
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

        // Task 3.3: 内容检查
        const hasDescription = personaData.description && personaData.description.trim().length > 0;
        if (!hasDescription) {
          console.warn(`[WritingResourceManager] Persona "${personaData.name || id}" description 为空`);
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
    
    console.log('[WritingResourceManager] loadUserPersonas result:', {
      requested: deduplicatedCount,
      loaded: contexts.length,
      names: contexts.map(c => c.name)
    });
    
    return contexts;
  }

  async loadWritingStyles(styleIds: string[]): Promise<WritingStyleResource[]> {
    const resources: WritingStyleResource[] = [];
    
    // 去重处理
    const uniqueIds = [...new Set(styleIds)];
    
    for (const id of uniqueIds) {
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
    let skippedCount = 0;
    
    // Task 1.4: 记录各类资源的数量
    console.log('[WritingResourceManager] buildResourceContextSummary 资源统计:', {
      userPersonas: userPersonas.length,
      characters: characters.length,
      worldBooks: worldBooks.length,
      writingStyles: writingStyles.length
    });
    
    if (userPersonas.length > 0) {
      parts.push('## 用户信息\n');
      for (const persona of userPersonas) {
        // Task 3.4: 跳过内容为空的资源项
        if (!persona.description || persona.description.trim().length === 0) {
          skippedCount++;
          console.warn(`[WritingResourceManager] 跳过空内容的用户人设: ${persona.name}`);
          continue;
        }
        parts.push(`### ${persona.name}`);
        parts.push(persona.description);
        parts.push('');
      }
    }
    
    if (characters.length > 0) {
      parts.push('## 角色信息\n');
      for (const char of characters) {
        // Task 3.4: 跳过内容为空的资源项
        const hasContent = (char.description && char.description.trim().length > 0) ||
                          (char.personality && char.personality.trim().length > 0) ||
                          (char.mesExample && char.mesExample.trim().length > 0);
        if (!hasContent) {
          skippedCount++;
          console.warn(`[WritingResourceManager] 跳过空内容的角色: ${char.name}`);
          continue;
        }
        parts.push(`### ${char.name}`);
        if (char.description) parts.push(`描述: ${char.description}`);
        if (char.personality) parts.push(`性格: ${char.personality}`);
        if (char.mesExample) parts.push(`对话示例:\n${char.mesExample}`);
        parts.push('');
      }
    }
    
    if (worldBooks.length > 0) {
      parts.push('## 世界观设定\n');
      for (const wb of worldBooks) {
        // Task 3.4: 跳过内容为空的资源项
        const hasContent = (wb.content && wb.content.trim().length > 0) ||
                          (wb.entries && wb.entries.some(e => e.content && e.content.trim().length > 0));
        if (!hasContent) {
          skippedCount++;
          console.warn(`[WritingResourceManager] 跳过空内容的世界书: ${wb.name}`);
          continue;
        }
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
    
    const result = parts.join('\n');
    
    // Task 1.4: 记录最终拼接的上下文长度和跳过的资源数量
    console.log('[WritingResourceManager] buildResourceContextSummary 结果:', {
      contextLength: result.length,
      skippedResources: skippedCount
    });
    
    return result;
  }
}

export const writingResourceManager = new WritingResourceManager();
