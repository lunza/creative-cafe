import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { CustomNovelTypeTemplate, CustomWritingStyleTemplate } from '../../../shared/types/writing.types';
import { safeWriteFile } from './WritingProjectRepository';

// ==================== 路径 helper ====================

function getWritingTemplatesBasePath(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, {recursive: true});
  }
  const templatesDir = path.join(dataDir, 'writing-templates');
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, {recursive: true});
  }
  return templatesDir;
}

function getNovelTypesDir(): string {
  const dir = path.join(getWritingTemplatesBasePath(), 'novel-types');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
  return dir;
}

function getWritingStylesDir(): string {
  const dir = path.join(getWritingTemplatesBasePath(), 'writing-styles');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
  return dir;
}

// ==================== 仓储实现 ====================

export class WritingTemplateRepository {

  // ---------- 小说类型模板 ----------

  async listCustomNovelTypeTemplates(): Promise<CustomNovelTypeTemplate[]> {
    const dir = getNovelTypesDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const templates: CustomNovelTypeTemplate[] = [];
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const data = fs.readFileSync(filePath, 'utf8');
        templates.push(JSON.parse(data));
      } catch (error) {
        console.error(`[WritingTemplateRepository] Failed to read novel type template ${file}:`, error);
      }
    }
    return templates.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getCustomNovelTypeTemplate(id: string): Promise<CustomNovelTypeTemplate | null> {
    const filePath = path.join(getNovelTypesDir(), `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`[WritingTemplateRepository] Failed to read novel type template ${id}:`, error);
      return null;
    }
  }

  async saveCustomNovelTypeTemplate(template: CustomNovelTypeTemplate): Promise<void> {
    const filePath = path.join(getNovelTypesDir(), `${template.id}.json`);
    const content = JSON.stringify(template, null, 2);
    if (!safeWriteFile(filePath, content)) {
      throw new Error(`Failed to save novel type template: ${template.id}`);
    }
  }

  async deleteCustomNovelTypeTemplate(id: string): Promise<void> {
    const filePath = path.join(getNovelTypesDir(), `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // ---------- 写作风格模板 ----------

  async listCustomWritingStyleTemplates(): Promise<CustomWritingStyleTemplate[]> {
    const dir = getWritingStylesDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const templates: CustomWritingStyleTemplate[] = [];
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const data = fs.readFileSync(filePath, 'utf8');
        templates.push(JSON.parse(data));
      } catch (error) {
        console.error(`[WritingTemplateRepository] Failed to read writing style template ${file}:`, error);
      }
    }
    return templates.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getCustomWritingStyleTemplate(id: string): Promise<CustomWritingStyleTemplate | null> {
    const filePath = path.join(getWritingStylesDir(), `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`[WritingTemplateRepository] Failed to read writing style template ${id}:`, error);
      return null;
    }
  }

  async saveCustomWritingStyleTemplate(template: CustomWritingStyleTemplate): Promise<void> {
    const filePath = path.join(getWritingStylesDir(), `${template.id}.json`);
    const content = JSON.stringify(template, null, 2);
    if (!safeWriteFile(filePath, content)) {
      throw new Error(`Failed to save writing style template: ${template.id}`);
    }
  }

  async deleteCustomWritingStyleTemplate(id: string): Promise<void> {
    const filePath = path.join(getWritingStylesDir(), `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export const writingTemplateRepository = new WritingTemplateRepository();
