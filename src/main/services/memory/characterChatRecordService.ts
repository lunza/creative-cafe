import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { createLogger } from '../logger';
import { chatVectorizationService } from '../../services/ChatVectorizationService';
import { pathService } from '../../services/pathService';
import { characterService } from '../../services/characterService';

const logger = createLogger('writing');

interface CharacterChatRecord {
  fileName: string;
  characterCardName: string;
  fileSize: number;
  lastModified: string;
  messageCount: number;
  filePath: string;
  creativeId: string;
  characterCardId: string;
}

class CharacterChatRecordService {
  private getCharacterChatsDir(): string {
    return path.join(getUserDataPath(), 'data', 'memories', 'chats');
  }

  getCharacterChatRecords(): CharacterChatRecord[] {
    try {
      const dirPath = this.getCharacterChatsDir();
      console.log(`[CharacterChatRecordService] Scanning directory: ${dirPath}`);

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`[CharacterChatRecordService] Created directory: ${dirPath}`);
        return [];
      }

      const files = fs.readdirSync(dirPath);
      const records: CharacterChatRecord[] = [];

      const excludedFiles = ['associations.json'];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (excludedFiles.includes(file)) continue;

        const filePath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(filePath);
          const data = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(data);

          records.push({
            fileName: file,
            characterCardName: parsed.characterCardName || '',
            fileSize: stats.size,
            lastModified: stats.mtime.toISOString(),
            messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
            filePath,
            creativeId: parsed.creativeId || '',
            characterCardId: parsed.characterCardId || ''
          });
        } catch (err) {
          console.warn(`[CharacterChatRecordService] Failed to read file: ${file}`, err);
          logger.warn(`Failed to read chat record: ${file}`);
        }
      }

      console.log(`[CharacterChatRecordService] Found ${records.length} character chat records`);
      return records;
    } catch (error) {
      console.error('[CharacterChatRecordService] getCharacterChatRecords error:', error);
      logger.error('Failed to get character chat records');
      return [];
    }
  }

  getCharacterChatRecord(fileName: string): any | null {
    try {
      const filePath = path.join(this.getCharacterChatsDir(), fileName);
      console.log(`[CharacterChatRecordService] Reading: ${filePath}`);

      if (!fs.existsSync(filePath)) {
        console.warn(`[CharacterChatRecordService] File not found: ${fileName}`);
        logger.warn(`Chat record not found: ${fileName}`);
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`[CharacterChatRecordService] getCharacterChatRecord error for ${fileName}:`, error);
      logger.error(`Failed to read chat record: ${fileName}`);
      return null;
    }
  }

  saveCharacterChatRecord(fileName: string, content: string): { success: boolean; error?: string } {
    try {
      const filePath = path.join(this.getCharacterChatsDir(), fileName);
      console.log(`[CharacterChatRecordService] Saving: ${filePath}`);

      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8');

      console.log(`[CharacterChatRecordService] Saved successfully: ${fileName}`);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CharacterChatRecordService] saveCharacterChatRecord error for ${fileName}:`, error);
      logger.error(`Failed to save chat record: ${fileName}`);
      return { success: false, error: errMsg };
    }
  }

  deleteCharacterChatRecord(fileName: string, characterCardName: string): { success: boolean; error?: string } {
    try {
      const dirPath = this.getCharacterChatsDir();
      const filePath = path.join(dirPath, fileName);
      console.log(`[CharacterChatRecordService] Deleting: ${filePath}`);

      if (!fs.existsSync(filePath)) {
        logger.warn(`Chat record not found: ${fileName}`);
        return { success: false, error: 'File not found' };
      }

      fs.unlinkSync(filePath);
      console.log(`[CharacterChatRecordService] Deleted file: ${fileName}`);

      if (characterCardName) {
        try {
          chatVectorizationService.deleteVectorization(characterCardName);
          console.log(`[CharacterChatRecordService] Started vector deletion for: ${characterCardName}`);
        } catch (vecError) {
          console.warn(`[CharacterChatRecordService] Vector deletion failed for ${characterCardName}:`, vecError);
          logger.warn(`Vector deletion warning for ${characterCardName}`);
        }
      }

      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CharacterChatRecordService] deleteCharacterChatRecord error for ${fileName}:`, error);
      logger.error(`Failed to delete chat record: ${fileName}`);
      return { success: false, error: errMsg };
    }
  }

  async getCharacterThumbnail(characterCardName: string): Promise<string | null> {
    try {
      if (!characterCardName || characterCardName.trim().length === 0) {
        return null;
      }

      const characterDir = pathService.getCustomPath('character');
      console.log(`[CharacterChatRecordService] Searching thumbnail for: ${characterCardName} in ${characterDir}`);

      if (!fs.existsSync(characterDir)) {
        return null;
      }

      const files = fs.readdirSync(characterDir);
      const imageFiles = files.filter(f =>
        f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp')
      );

      for (const file of imageFiles) {
        try {
          const filePath = path.join(characterDir, file);
          const cardData = await characterService.readCharacter(filePath);
          if (cardData && cardData.data && cardData.data.name === characterCardName) {
            console.log(`[CharacterChatRecordService] Found thumbnail: ${filePath}`);
            return filePath;
          }
        } catch (err) {
          console.warn(`[CharacterChatRecordService] Failed to read card ${file}:`, err);
        }
      }

      console.log(`[CharacterChatRecordService] No thumbnail found for: ${characterCardName}`);
      return null;
    } catch (error) {
      console.error(`[CharacterChatRecordService] getCharacterThumbnail error for ${characterCardName}:`, error);
      logger.error(`Failed to get thumbnail for ${characterCardName}`);
      return null;
    }
  }
}

export const characterChatRecordService = new CharacterChatRecordService();
