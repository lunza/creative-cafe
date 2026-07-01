import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { WritingStyleResource } from '../../../shared/types/writing.types';

/**
 * 写作风格索引文件结构
 */
export interface WritingStylesIndex {
  version: string;
  styles: {
    id: string;
    name: string;
    createdAt: number;
    status: string;
  }[];
}

// ==================== 路径 helper ====================

export function getWritingStylesDir(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const writingDir = path.join(dataDir, 'writing-projects');
  if (!fs.existsSync(writingDir)) {
    fs.mkdirSync(writingDir, { recursive: true });
  }
  const stylesDir = path.join(writingDir, 'writing-styles');
  if (!fs.existsSync(stylesDir)) {
    fs.mkdirSync(stylesDir, { recursive: true });
  }
  return stylesDir;
}

export function getWritingStylesIndexFilePath(): string {
  return path.join(getWritingStylesDir(), 'writing-styles-index.json');
}

export function loadWritingStylesIndex(): WritingStylesIndex {
  const indexPath = getWritingStylesIndexFilePath();
  try {
    if (fs.existsSync(indexPath)) {
      const data = fs.readFileSync(indexPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WritingStorage] Failed to load writing styles index:', error);
  }
  return { version: '1.0', styles: [] };
}

export function saveWritingStylesIndex(index: WritingStylesIndex): void {
  const indexPath = getWritingStylesIndexFilePath();
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save writing styles index:', error);
  }
}

/**
 * 写作风格资源存储仓储。
 *
 * 职责：
 * - 写作风格资源的 CRUD（saveWritingStyle/loadWritingStyle/listWritingStyles/deleteWritingStyle）
 * - 维护写作风格索引文件
 *
 * 所有方法签名与原 WritingStorageService 同名方法保持一致。
 */
export class WritingStyleRepository {
  async saveWritingStyle(resource: WritingStyleResource): Promise<boolean> {
    try {
      const stylesDir = getWritingStylesDir();
      const resourceDir = path.join(stylesDir, resource.id);
      if (!fs.existsSync(resourceDir)) {
        fs.mkdirSync(resourceDir, { recursive: true });
      }

      const resourceFile = path.join(resourceDir, `${resource.id}.json`);
      fs.writeFileSync(resourceFile, JSON.stringify(resource, null, 2), 'utf8');

      const sourceDir = path.join(resourceDir, 'source');
      if (!fs.existsSync(sourceDir)) {
        fs.mkdirSync(sourceDir, { recursive: true });
      }
      const sourceFile = path.join(sourceDir, 'source.txt');
      if (fs.existsSync(resource.sourceFile)) {
        fs.copyFileSync(resource.sourceFile, sourceFile);
      }

      const index = loadWritingStylesIndex();
      const existingIndex = index.styles.findIndex((s) => s.id === resource.id);
      const styleInfo = {
        id: resource.id,
        name: resource.name,
        createdAt: resource.createdAt,
        status: resource.status
      };

      if (existingIndex >= 0) {
        index.styles[existingIndex] = styleInfo;
      } else {
        index.styles.push(styleInfo);
      }

      saveWritingStylesIndex(index);

      return true;
    } catch (error) {
      console.error('[WritingStorage] Failed to save writing style:', error);
      return false;
    }
  }

  async loadWritingStyle(resourceId: string): Promise<WritingStyleResource | null> {
    try {
      const stylesDir = getWritingStylesDir();
      const resourceDir = path.join(stylesDir, resourceId);
      const resourceFile = path.join(resourceDir, `${resourceId}.json`);

      if (!fs.existsSync(resourceFile)) {
        return null;
      }

      const data = fs.readFileSync(resourceFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('[WritingStorage] Failed to load writing style:', error);
      return null;
    }
  }

  async listWritingStyles(): Promise<WritingStyleResource[]> {
    try {
      const index = loadWritingStylesIndex();
      const styles: WritingStyleResource[] = [];

      for (const styleInfo of index.styles) {
        const style = await this.loadWritingStyle(styleInfo.id);
        if (style) {
          styles.push(style);
        }
      }

      return styles.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error('[WritingStorage] Failed to list writing styles:', error);
      return [];
    }
  }

  async deleteWritingStyle(resourceId: string): Promise<boolean> {
    try {
      const stylesDir = getWritingStylesDir();
      const resourceDir = path.join(stylesDir, resourceId);

      if (fs.existsSync(resourceDir)) {
        fs.rmSync(resourceDir, { recursive: true, force: true });
      }

      const index = loadWritingStylesIndex();
      index.styles = index.styles.filter((s) => s.id !== resourceId);
      saveWritingStylesIndex(index);

      return true;
    } catch (error) {
      console.error('[WritingStorage] Failed to delete writing style:', error);
      return false;
    }
  }
}
