import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { CharacterCard } from '@lenml/char-card-reader';
import { optimizerService } from './optimizerService';
import extract from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';
import { crc32 } from 'crc';
import { pathService } from './pathService';
import { getStorageService } from './storageService';

/**
 * Encodes PNG chunks into a PNG file format buffer.
 * @param {Array<{ name: string; data: Uint8Array }>} chunks Array of PNG chunks
 * @returns {Uint8Array} Encoded PNG data
 * @copyright Based on https://github.com/hughsk/png-chunks-encode (MIT)
 */
function encode(chunks: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const uint8 = new Uint8Array(4);
  const int32 = new Int32Array(uint8.buffer);
  const uint32 = new Uint32Array(uint8.buffer);

  let totalSize = 8;
  let idx = totalSize;

  for (let i = 0; i < chunks.length; i++) {
    totalSize += chunks[i].data.length;
    totalSize += 12;
  }

  const output = new Uint8Array(totalSize);

  output[0] = 0x89;
  output[1] = 0x50;
  output[2] = 0x4E;
  output[3] = 0x47;
  output[4] = 0x0D;
  output[5] = 0x0A;
  output[6] = 0x1A;
  output[7] = 0x0A;

  for (let i = 0; i < chunks.length; i++) {
    const { name, data } = chunks[i];
    const size = data.length;
    const nameChars = [
      name.charCodeAt(0),
      name.charCodeAt(1),
      name.charCodeAt(2),
      name.charCodeAt(3),
    ];

    uint32[0] = size;
    output[idx++] = uint8[3];
    output[idx++] = uint8[2];
    output[idx++] = uint8[1];
    output[idx++] = uint8[0];

    output[idx++] = nameChars[0];
    output[idx++] = nameChars[1];
    output[idx++] = nameChars[2];
    output[idx++] = nameChars[3];

    for (let j = 0; j < size;) {
      output[idx++] = data[j++];
    }

    const crc = crc32(data, crc32(new Uint8Array(nameChars)));

    int32[0] = crc;
    output[idx++] = uint8[3];
    output[idx++] = uint8[2];
    output[idx++] = uint8[1];
    output[idx++] = uint8[0];
  }

  return output;
}

export { encode };

class CharacterService {
  private characterDir: string;

  constructor() {
    // 从 pathService 获取解析后的角色卡路径
    this.characterDir = pathService.getCustomPath('character');
    console.log('Character directory (from pathService):', this.characterDir);
  }

  async listCharacters() {
    try {
      const files = await fs.readdir(this.characterDir);
      const characters = await Promise.all(
        files
          .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp'))
          .map(async file => {
            const filePath = path.join(this.characterDir, file);
            const stats = await fs.stat(filePath);
            
            let characterName = '';
            let version = '';
            let creator = '';
            let tags: string[] = [];
            let cardVersion: 'v1' | 'v2' | 'v3' = 'v1';
            
            try {
              const characterData = await this.readCharacter(filePath);
              if (characterData && characterData.data) {
                characterName = characterData.data.name || '';
                version = characterData.data.character_version || '';
                creator = characterData.data.creator || '';
                tags = characterData.data.tags || [];
                cardVersion = this.detectCharacterVersion(characterData);
              }
            } catch (error) {
              console.error('Failed to read character info for', file, error);
            }
            
            return {
              name: file,
              path: filePath,
              size: stats.size,
              modified: stats.mtime,
              characterName,
              version,
              creator,
              tags,
              cardVersion
            };
          })
      );
      return characters;
    } catch (error) {
      console.error('Failed to list characters:', error);
      return [];
    }
  }

  detectCharacterVersion(data: any): 'v1' | 'v2' | 'v3' {
    if (data.spec === 'chara_card_v3') return 'v3';
    if (data.spec === 'chara_card_v2') return 'v2';
    return 'v1';
  }

  async readCharacter(filePath: string) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const card = await CharacterCard.from_file(fileBuffer);
      const specV3 = card.toSpecV3();
      
      console.log(`Read character card from image: ${filePath}`);
      console.log('CharacterCard spec:', card.spec);
      console.log('CharacterCard spec_version:', card.spec_version);
      console.log('SpecV3 object:', specV3);
      console.log('SpecV3 data:', specV3.data);
      console.log('All fields in data:', Object.keys(specV3.data));
      
      return specV3;
    } catch (error) {
      console.error('Failed to read character:', error);
      return null;
    }
  }

  async writeCharacter(filePath: string, data: any) {
    try {
      if (!filePath.endsWith('.png')) {
        return { success: false, error: 'Only PNG format is supported for character cards' };
      }

      const image = await fs.readFile(filePath);
      const chunks = extract(new Uint8Array(image));
      const tEXtChunks = chunks.filter(chunk => chunk.name === 'tEXt');

      for (const tEXtChunk of tEXtChunks) {
        const chunkData = PNGtext.decode(tEXtChunk.data);
        if (chunkData.keyword.toLowerCase() === 'chara' || chunkData.keyword.toLowerCase() === 'ccv3') {
          chunks.splice(chunks.indexOf(tEXtChunk), 1);
        }
      }

      const v2Data = JSON.stringify(data.data);
      const base64EncodedData = Buffer.from(v2Data, 'utf8').toString('base64');
      chunks.splice(-1, 0, PNGtext.encode('chara', base64EncodedData));

      try {
        const v3Data = {
          spec: 'chara_card_v3',
          spec_version: '3.0',
          data: data.data
        };

        const base64EncodedData = Buffer.from(JSON.stringify(v3Data), 'utf8').toString('base64');
        chunks.splice(-1, 0, PNGtext.encode('ccv3', base64EncodedData));
      } catch (error) {
        console.error('Error adding v3 chunk:', error);
      }

      const newBuffer = Buffer.from(encode(chunks));
      await fs.writeFile(filePath, newBuffer);
      console.log(`Character card saved as PNG: ${filePath}`);
      
      return { success: true };
    } catch (error) {
      console.error('Failed to write character:', error);
      return { success: false, error };
    }
  }

  async importCharacter(sourcePath: string, fileName: string): Promise<{ success: boolean; targetPath?: string; error?: string }> {
    try {
      await fs.mkdir(this.characterDir, { recursive: true });
      
      const targetPath = path.join(this.characterDir, fileName);
      
      if (await fs.stat(targetPath).then(() => true).catch(() => false)) {
        console.log(`Character card already exists, overwriting: ${fileName}`);
      }
      
      await fs.copyFile(sourcePath, targetPath);
      
      console.log(`Character card imported successfully: ${fileName} -> ${targetPath}`);
      return { success: true, targetPath };
    } catch (error) {
      console.error('Failed to import character:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Import failed' 
      };
    }
  }

  async deleteCharacter(filePath: string) {
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete character:', error);
      return { success: false, error };
    }
  }

  async optimizeCharacter(filePath: string) {
    try {
      const data = await this.readCharacter(filePath);
      if (!data) return { success: false, error: 'Failed to read character' };

      const optimized = await optimizerService.optimizeCharacter(data);
      await this.writeCharacter(filePath, optimized);

      return { success: true, optimized };
    } catch (error) {
      console.error('Failed to optimize character:', error);
      return { success: false, error };
    }
  }

  setCharacterDir(dir: string) {
    this.characterDir = dir;
    console.log('Character directory set to:', dir);
  }

  /**
   * 动态获取角色卡路径（解决初始化时机问题）
   */
  getCharacterDir(): string {
    return this.characterDir;
  }

  async testReadCharacter(filePath: string) {
    try {
      console.log('Testing character file:', filePath);
      const fileBuffer = await fs.readFile(filePath);
      const card = await CharacterCard.from_file(fileBuffer);
      console.log('CharacterCard object:', card);
      const specV3 = card.toSpecV3();
      console.log('SpecV3 object:', specV3);
      console.log('SpecV3 data:', specV3.data);
      console.log('All fields in data:', Object.keys(specV3.data));
      this.logNestedFields(specV3.data, '');
      return specV3;
    } catch (error) {
      console.error('Failed to test read character:', error);
      return null;
    }
  }

  private logNestedFields(obj: any, prefix: string) {
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        console.log(`Field: ${fullPath}`);
        if (typeof value === 'object' && value !== null) {
          this.logNestedFields(value, fullPath);
        }
      }
    }
  }

  async getWorldBookRelations(characterFilePath: string): Promise<Array<{ worldBookPath: string; enabled: boolean; priority: number; filterTags?: string[] }>> {
    try {
      const data: any = await this.readCharacter(characterFilePath);
      if (!data || !data.data) return [];
      
      const worldBooks = data.data.worldBooks || [];
      return worldBooks;
    } catch (error) {
      console.error('Failed to get world book relations:', error);
      return [];
    }
  }

  async setWorldBookRelations(characterFilePath: string, relations: Array<{ worldBookPath: string; enabled: boolean; priority: number; filterTags?: string[] }>): Promise<{ success: boolean; error?: string }> {
    try {
      const data: any = await this.readCharacter(characterFilePath);
      if (!data || !data.data) {
        return { success: false, error: '无法读取角色卡数据' };
      }

      data.data.worldBooks = relations;
      
      const result = await this.writeCharacter(characterFilePath, data);
      return result;
    } catch (error) {
      console.error('Failed to set world book relations:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async addWorldBookRelation(characterFilePath: string, worldBookPath: string, enabled: boolean = true, priority: number = 5, filterTags?: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const relations = await this.getWorldBookRelations(characterFilePath);
      
      const exists = relations.some(r => r.worldBookPath === worldBookPath);
      if (exists) {
        return { success: false, error: '该世界书已关联' };
      }

      relations.push({ worldBookPath, enabled, priority, filterTags });
      
      return await this.setWorldBookRelations(characterFilePath, relations);
    } catch (error) {
      console.error('Failed to add world book relation:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async removeWorldBookRelation(characterFilePath: string, worldBookPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const relations = await this.getWorldBookRelations(characterFilePath);
      const filtered = relations.filter(r => r.worldBookPath !== worldBookPath);
      
      return await this.setWorldBookRelations(characterFilePath, filtered);
    } catch (error) {
      console.error('Failed to remove world book relation:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async searchContextForCharacter(characterFilePath: string, query: string, topK: number = 5): Promise<Array<{ id: string; score: number; metadata: Record<string, any> }>> {
    try {
      const relations = await this.getWorldBookRelations(characterFilePath);
      const enabledWorldBooks = relations.filter(r => r.enabled);
      
      if (enabledWorldBooks.length === 0) {
        return [];
      }

      const { vectorStoreService } = await import('./VectorStoreService');
      const { embeddingService } = await import('./EmbeddingService');

      const embedResult = await embeddingService.generateEmbedding(query);
      if (!embedResult.success || !embedResult.vector) {
        return [];
      }

      const allResults: Array<{ id: string; score: number; metadata: Record<string, any> }> = [];
      
      for (const relation of enabledWorldBooks) {
        const results = await vectorStoreService.search(embedResult.vector, topK, {
          source: 'worldbook',
          worldBookPath: relation.worldBookPath
        });

        const weightedResults = results.map(r => ({
          ...r,
          score: r.score * (relation.priority / 10)
        }));

        allResults.push(...weightedResults);
      }

      allResults.sort((a, b) => b.score - a.score);
      
      return allResults.slice(0, topK);
    } catch (error) {
      console.error('Failed to search context for character:', error);
      return [];
    }
  }
}

export const characterService = new CharacterService();

(async () => {
  try {
    console.log('Testing v2 character card...');
    const testCardPath = path.join(process.cwd(), 'test-character.png');
    if (fsSync.existsSync(testCardPath)) {
      await characterService.testReadCharacter(testCardPath);
    } else {
      console.log('Test character card not found, skipping test');
    }
    console.log('Testing v3 character card...');
    if (fsSync.existsSync(testCardPath)) {
      await characterService.testReadCharacter(testCardPath);
    } else {
      console.log('Test character card not found, skipping test');
    }
  } catch (error) {
    console.error('Failed to test character cards:', error);
  }
})();
