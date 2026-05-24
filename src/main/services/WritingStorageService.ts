import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';
import { WritingProject, ExportFormat, Chapter, WritingStyleResource, ModelConfig } from '../../shared/types/writing.types';
import { tableTemplateService } from './memory/tableTemplateService';
import { getStorageService } from './storageService';
import { tableEditParser } from './memory/tableEditParser';
import { addLog } from './memory/chatLogService';

interface ProjectsIndex {
  version: string;
  projects: {
    id: string;
    title: string;
    status: string;
    createdAt: number;
    updatedAt: number;
    totalWordCount: number;
    completedChapters: number;
  }[];
  lastProjectId: string | null;
}

interface WritingStylesIndex {
  version: string;
  styles: {
    id: string;
    name: string;
    createdAt: number;
    status: string;
  }[];
}

function getWritingProjectsPath(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const writingDir = path.join(dataDir, 'writing-projects');
  if (!fs.existsSync(writingDir)) {
    fs.mkdirSync(writingDir, { recursive: true });
  }
  return writingDir;
}

function getProjectDir(projectId: string): string {
  const basePath = getWritingProjectsPath();
  const projectDir = path.join(basePath, projectId);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  return projectDir;
}

function getChaptersDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const chaptersDir = path.join(projectDir, 'chapters');
  if (!fs.existsSync(chaptersDir)) {
    fs.mkdirSync(chaptersDir, { recursive: true });
  }
  return chaptersDir;
}

function getVersionsDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const versionsDir = path.join(projectDir, 'versions');
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }
  return versionsDir;
}

function getIndexFilePath(): string {
  return path.join(getWritingProjectsPath(), 'projects-index.json');
}

function getWritingStylesDir(): string {
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

function getWritingStylesIndexFilePath(): string {
  return path.join(getWritingStylesDir(), 'writing-styles-index.json');
}

function getWritingTablesDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const tablesDir = path.join(projectDir, 'tables');
  if (!fs.existsSync(tablesDir)) {
    fs.mkdirSync(tablesDir, { recursive: true });
  }
  return tablesDir;
}

function getWritingTableFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'table-data.json');
}

function getWritingTableConfigFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'table-config.json');
}

interface WritingTableData {
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, Record<string, any>[]>;
  sheetDescriptions: Record<string, string>;
}

interface WritingTableConfig {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async';
  associatedTemplateId: string | null;
  associatedTemplateName: string;
}

interface WritingOrganizeProgress {
  projectId: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  currentChapter: number;
  totalChapters: number;
  processedCount: number;
  errorCount: number;
  errors: string[];
  lastProcessedAt?: string;
  startedAt?: number;
}

function getWritingOrganizeProgressFile(projectId: string): string {
  const tablesDir = getWritingTablesDir(projectId);
  return path.join(tablesDir, 'organize-progress.json');
}

function loadTableData(projectId: string): WritingTableData | null {
  const tableFile = getWritingTableFile(projectId);
  try {
    if (fs.existsSync(tableFile)) {
      const data = fs.readFileSync(tableFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WritingStorage] Failed to load table data:', error);
  }
  return null;
}

function saveTableDataFile(projectId: string, data: WritingTableData): void {
  const tableFile = getWritingTableFile(projectId);
  try {
    fs.writeFileSync(tableFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save table data:', error);
  }
}

function loadTableConfig(projectId: string): WritingTableConfig | null {
  const configFile = getWritingTableConfigFile(projectId);
  try {
    if (fs.existsSync(configFile)) {
      const data = fs.readFileSync(configFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WritingStorage] Failed to load table config:', error);
  }
  return null;
}

function saveTableConfigFile(projectId: string, config: WritingTableConfig): void {
  const configFile = getWritingTableConfigFile(projectId);
  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save table config:', error);
  }
}

function loadWritingStylesIndex(): WritingStylesIndex {
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

function saveWritingStylesIndex(index: WritingStylesIndex): void {
  const indexPath = getWritingStylesIndexFilePath();
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save writing styles index:', error);
  }
}

function loadIndex(): ProjectsIndex {
  const indexPath = getIndexFilePath();
  try {
    if (fs.existsSync(indexPath)) {
      const data = fs.readFileSync(indexPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WritingStorage] Failed to load index:', error);
  }
  return { version: '1.0', projects: [], lastProjectId: null };
}

function saveIndex(index: ProjectsIndex): void {
  const indexPath = getIndexFilePath();
  try {
    const content = JSON.stringify(index, null, 2);
    const tempPath = indexPath + '.tmp';
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, indexPath);
  } catch (error) {
    console.error('[WritingStorage] Failed to save index:', error);
  }
}

export function safeWriteFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): boolean {
  try {
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, content, encoding);
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error('[WritingStorage] Safe write failed for:', filePath, error);
    try {
      fs.unlinkSync(filePath + '.tmp');
    } catch {
    }
    return false;
  }
}

function computeProjectMetadata(project: WritingProject): { totalWordCount: number; completedChapters: number } {
  let totalWordCount = 0;
  let completedChapters = 0;
  for (const ch of project.chapters) {
    const wordCount = ch.content ? ch.content.length : (ch.wordCount || 0);
    totalWordCount += wordCount;
    if (ch.status === 'completed') {
      completedChapters++;
    }
  }
  return { totalWordCount, completedChapters };
}

export class WritingStorageService {
  private formatChapterIndex(index: number): string {
    return parseFloat(index.toFixed(10)).toString();
  }

  private migrateProjectIndices(project: WritingProject): WritingProject {
    const firstChapter = project.chapters[0];
    if (firstChapter && firstChapter.index === 0 && project.chapters.length > 1) {
      const hasZeroBased = project.chapters.some((ch, idx) => ch.index === idx);
      if (hasZeroBased) {
        console.log('[WritingStorage] Migrating project from 0-based to 1-based indexing:', project.id);
        return {
          ...project,
          chapters: project.chapters.map((ch, idx) => ({
            ...ch,
            index: idx + 1
          }))
        };
      }
    }
    return project;
  }

  getStoragePath(): string {
    return getWritingProjectsPath();
  }

  getProjectDirPath(projectId: string): string | null {
    const projectDir = getProjectDir(projectId);
    if (fs.existsSync(projectDir)) {
      return projectDir;
    }
    return null;
  }

  async saveProject(project: WritingProject): Promise<boolean> {
    try {
      const projectDir = getProjectDir(project.id);
      const projectFile = path.join(projectDir, 'project.json');
      
      const computedMeta = computeProjectMetadata(project);
      project.metadata.totalWordCount = computedMeta.totalWordCount;
      project.metadata.completedChapters = computedMeta.completedChapters;
      project.lastSavedAt = Date.now();
      project.updatedAt = Date.now();

      const projectJson = JSON.stringify(project, null, 2);
      const projectSaved = safeWriteFile(projectFile, projectJson, 'utf8');
      if (!projectSaved) {
        console.error('[WritingStorage] Failed to safely write project.json');
        return false;
      }

      const chaptersDir = getChaptersDir(project.id);
      if (!fs.existsSync(chaptersDir)) {
        fs.mkdirSync(chaptersDir, { recursive: true });
      }

      const existingChapterFiles = new Set<string>();
      if (fs.existsSync(chaptersDir)) {
        const files = fs.readdirSync(chaptersDir);
        for (const file of files) {
          if (file.endsWith('.md') && !file.endsWith('.tmp')) {
            existingChapterFiles.add(file);
          }
        }
      }

      const expectedChapterFiles = new Set<string>();
      for (const chapter of project.chapters) {
        if (chapter.content && chapter.content.trim().length > 0) {
          const safeIndex = this.formatChapterIndex(chapter.index);
          const chapterFile = `chapter-${safeIndex}.md`;
          expectedChapterFiles.add(chapterFile);
          const chapterFilePath = path.join(chaptersDir, chapterFile);
          safeWriteFile(chapterFilePath, chapter.content, 'utf8');
        }
      }

      for (const existingFile of existingChapterFiles) {
        if (!expectedChapterFiles.has(existingFile)) {
          const orphanPath = path.join(chaptersDir, existingFile);
          try {
            fs.unlinkSync(orphanPath);
          } catch {
          }
        }
      }
      
      const index = loadIndex();
      const existingIndex = index.projects.findIndex((p) => p.id === project.id);
      const projectInfo = {
        id: project.id,
        title: project.title,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        totalWordCount: project.metadata.totalWordCount,
        completedChapters: project.metadata.completedChapters
      };
      
      if (existingIndex >= 0) {
        index.projects[existingIndex] = projectInfo;
      } else {
        index.projects.push(projectInfo);
      }
      
      index.lastProjectId = project.id;
      saveIndex(index);
      
      return true;
    } catch (error) {
      console.error('[WritingStorage] Failed to save project:', error);
      return false;
    }
  }

  async loadProject(projectId: string): Promise<WritingProject | null> {
    try {
      const projectFile = path.join(getProjectDir(projectId), 'project.json');
      if (!fs.existsSync(projectFile)) {
        return null;
      }
      
      const data = fs.readFileSync(projectFile, 'utf8');
      let project: WritingProject = JSON.parse(data);

      if (!project.metadata) {
        project.metadata = {
          totalWordCount: 0,
          completedChapters: 0,
          generationSettings: { model: '', temperature: undefined },
          continuityInfo: { foreshadowing: [], plotThreads: [], characterDevelopment: {} }
        };
      }
      
      project = this.migrateProjectIndices(project);
      
      const chaptersDir = getChaptersDir(projectId);
      if (fs.existsSync(chaptersDir)) {
        const files = fs.readdirSync(chaptersDir);
        for (const file of files) {
          if (file.endsWith('.md') && !file.endsWith('.tmp')) {
            const match = file.match(/^chapter-(\d+(?:\.\d+)?)\.md$/);
            if (match) {
              const chapterIndex = parseFloat(match[1]);
              const chapter = project.chapters.find((c) => c.index === chapterIndex);
              if (chapter) {
                const filePath = path.join(chaptersDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                if (content.length > (chapter.content?.length || 0)) {
                  chapter.content = content;
                  chapter.wordCount = content.length;
                }
              }
            }
          }
        }
      }

      const computedMeta = computeProjectMetadata(project);
      project.metadata.totalWordCount = computedMeta.totalWordCount;
      project.metadata.completedChapters = computedMeta.completedChapters;
      
      return project;
    } catch (error) {
      console.error('[WritingStorage] Failed to load project:', error);
      return null;
    }
  }

  async loadAllProjects(): Promise<WritingProject[]> {
    const index = loadIndex();
    const projects: WritingProject[] = [];
    const seenIds = new Set<string>();
    
    for (const projectInfo of index.projects) {
      if (seenIds.has(projectInfo.id)) {
        continue;
      }
      seenIds.add(projectInfo.id);
      
      const project = await this.loadProject(projectInfo.id);
      if (project) {
        projects.push(project);
      }
    }
    
    return projects;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    try {
      const projectDir = getProjectDir(projectId);
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
      
      const index = loadIndex();
      index.projects = index.projects.filter((p) => p.id !== projectId);
      if (index.lastProjectId === projectId) {
        index.lastProjectId = index.projects.length > 0 ? index.projects[0].id : null;
      }
      saveIndex(index);
      
      return true;
    } catch (error) {
      console.error('[WritingStorage] Failed to delete project:', error);
      return false;
    }
  }

  async exportProject(projectId: string, format: ExportFormat): Promise<string> {
    try {
      const project = await this.loadProject(projectId);
      if (!project) {
        throw new Error('Project not found');
      }
      
      const exportDir = path.join(getWritingProjectsPath(), 'exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      
      let content = '';
      let fileName = `${project.title || 'untitled'}-export`;
      
      switch (format) {
        case ExportFormat.TXT:
          content = this.exportAsTxt(project);
          fileName += '.txt';
          break;
        case ExportFormat.MARKDOWN:
          content = this.exportAsMarkdown(project);
          fileName += '.md';
          break;
        case ExportFormat.JSON:
          content = JSON.stringify(project, null, 2);
          fileName += '.json';
          break;
      }
      
      const exportPath = path.join(exportDir, fileName);
      fs.writeFileSync(exportPath, content, 'utf8');
      
      return exportPath;
    } catch (error) {
      console.error('[WritingStorage] Failed to export project:', error);
      throw error;
    }
  }

  async autoSaveChapter(projectId: string, chapterIndex: number, content: string, isAutoGenerated: boolean = false): Promise<void> {
    try {
      const project = await this.loadProject(projectId);
      if (!project) {
        console.log('[WritingStorage] Auto-save skipped: project not found', projectId);
        return;
      }

      const chapter = project.chapters.find((c) => c.index === chapterIndex);
      if (!chapter) {
        console.log('[WritingStorage] Auto-save skipped: chapter not found', chapterIndex);
        return;
      }

      const hasContent = content && content.trim().length > 0;
      const hasPreviousContent = chapter.content && chapter.content.trim().length > 0;

      if (hasPreviousContent && chapter.content !== content) {
        chapter.versions = chapter.versions || [];
        chapter.versions.push({
          id: `v${Date.now()}`,
          content: chapter.content,
          timestamp: Date.now(),
          note: '自动保存',
          isAutoGenerated: false
        });
      }

      if (hasContent) {
        chapter.content = content;
        chapter.wordCount = content.length;
        if (chapter.status !== 'completed') {
          chapter.status = 'completed';
        }
      } else if (!hasPreviousContent) {
        chapter.content = '';
        chapter.wordCount = 0;
      }

      chapter.lastModified = Date.now();

      const chapterFile = this.formatChapterIndex(chapterIndex);
      const chaptersDir = getChaptersDir(projectId);
      const chapterFilePath = path.join(chaptersDir, `chapter-${chapterFile}.md`);

      if (hasContent) {
        safeWriteFile(chapterFilePath, content, 'utf8');
      } else if (fs.existsSync(chapterFilePath)) {
        try {
          fs.unlinkSync(chapterFilePath);
        } catch {
        }
      }

      const computedMeta = computeProjectMetadata(project);
      project.metadata.totalWordCount = computedMeta.totalWordCount;
      project.metadata.completedChapters = computedMeta.completedChapters;

      await this.saveProject(project);
      console.log('[WritingStorage] Auto-save complete: chapter', chapterIndex, 'wordCount:', chapter.wordCount);
    } catch (error) {
      console.error('[WritingStorage] Failed to auto-save chapter:', error);
    }
  }

  async saveVersion(projectId: string, chapterIndex: number, content: string, note?: string, isAutoGenerated: boolean = false): Promise<boolean> {
    try {
      const project = await this.loadProject(projectId);
      if (!project) return false;

      const chapter = project.chapters.find((c) => c.index === chapterIndex);
      if (!chapter) return false;

      chapter.versions = chapter.versions || [];
      chapter.versions.push({
        id: `v${Date.now()}`,
        content,
        timestamp: Date.now(),
        note: note || (isAutoGenerated ? '自动生成' : '手动保存'),
        isAutoGenerated
      });

      chapter.content = content;
      chapter.wordCount = content.length;
      chapter.lastModified = Date.now();

      const versionFile = path.join(getVersionsDir(projectId), `chapter-${chapterIndex}-v${chapter.versions.length}.md`);
      fs.writeFileSync(versionFile, content, 'utf8');

      await this.saveProject(project);
      return true;
    } catch (error) {
      console.error('[WritingStorage] Failed to save version:', error);
      return false;
    }
  }

  async restoreVersion(projectId: string, chapterIndex: number, versionId: string): Promise<boolean> {
    try {
      const project = await this.loadProject(projectId);
      if (!project) return false;

      const chapter = project.chapters.find((c) => c.index === chapterIndex);
      if (!chapter) return false;

      const version = chapter.versions.find((v) => v.id === versionId);
      if (!version) return false;

      chapter.content = version.content;
      chapter.wordCount = version.content.length;
      chapter.lastModified = Date.now();

      await this.saveProject(project);
      return true;
    } catch (error) {
      console.error('[WritingStorage] Failed to restore version:', error);
      return false;
    }
  }

  private exportAsTxt(project: WritingProject): string {
    let content = `${project.title || 'Untitled'}\n`;
    content += '='.repeat(50) + '\n\n';
    
    if (project.outline) {
      content += `类型: ${project.config.parameters.novelType}\n`;
      content += `目标字数: ${project.config.parameters.targetWordCount}\n`;
      content += `章节数: ${project.config.parameters.chapterCount}\n\n`;
    }
    
    for (const chapter of project.chapters.sort((a, b) => a.index - b.index)) {
      content += `${chapter.title}\n`;
      content += '-'.repeat(30) + '\n\n';
      content += (chapter.content || '') + '\n\n';
    }
    
    return content;
  }

  private exportAsMarkdown(project: WritingProject): string {
    let content = `# ${project.title || 'Untitled'}\n\n`;
    
    if (project.outline) {
      content += `> 类型: ${project.config.parameters.novelType}  `;
      content += `| 目标字数: ${project.config.parameters.targetWordCount}  `;
      content += `| 章节数: ${project.config.parameters.chapterCount}\n\n`;
    }
    
    for (const chapter of project.chapters.sort((a, b) => a.index - b.index)) {
      content += `## ${chapter.title}\n\n`;
      content += (chapter.content || '') + '\n\n';
    }
    
    return content;
  }

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

  async getTableData(projectId: string): Promise<WritingTableData | null> {
    return loadTableData(projectId);
  }

  async saveTableData(projectId: string, sheetName: string, sheetData: Record<string, any>[]): Promise<void> {
    const existing = loadTableData(projectId) || { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
    existing.data[sheetName] = sheetData;
    saveTableDataFile(projectId, existing);
  }

  async clearTableData(projectId: string): Promise<void> {
    const tableFile = getWritingTableFile(projectId);
    if (fs.existsSync(tableFile)) {
      fs.unlinkSync(tableFile);
    }
  }

  async updateRowInTable(projectId: string, sheetName: string, rowIndex: number, rowData: Record<string, any>): Promise<boolean> {
    const existing = loadTableData(projectId);
    if (!existing || !existing.data[sheetName]) return false;
    if (rowIndex >= existing.data[sheetName].length) return false;
    existing.data[sheetName][rowIndex] = rowData;
    saveTableDataFile(projectId, existing);
    return true;
  }

  async getTableConfig(projectId: string): Promise<WritingTableConfig | null> {
    return loadTableConfig(projectId);
  }

  async saveTableConfig(projectId: string, config: WritingTableConfig): Promise<void> {
    saveTableConfigFile(projectId, config);
  }

  async associateTableTemplate(projectId: string, templateId: string, templateName: string, templateSheets: Array<{ name: string; headers: string[]; description?: string }>): Promise<void> {
    console.log('[DEBUG Service] associateTableTemplate 接收参数:', {
      projectId,
      templateId,
      templateName,
      templateSheetsType: typeof templateSheets,
      templateSheetsIsArray: Array.isArray(templateSheets),
      templateSheetsLength: templateSheets?.length,
      templateSheetsContent: JSON.stringify(templateSheets?.slice(0, 1))
    });

    if (!templateSheets || !Array.isArray(templateSheets) || templateSheets.length === 0) {
      console.error('[DEBUG Service] 模板页签数据为空');
      throw new Error('模板页签数据为空');
    }

    console.log('[DEBUG Service] 开始创建表格结构，页签:', templateSheets.map(s => s.name).join(', '));

    const tableData: WritingTableData = {
      sheets: templateSheets.map(s => s.name),
      headers: {},
      data: {},
      sheetDescriptions: {}
    };

    for (const sheet of templateSheets) {
      tableData.headers[sheet.name] = sheet.headers;
      tableData.data[sheet.name] = [];
      tableData.sheetDescriptions[sheet.name] = sheet.description || '';
    }

    saveTableDataFile(projectId, tableData);

    const config: WritingTableConfig = {
      enabled: true,
      autoOrganize: false,
      organizeMode: 'sync',
      associatedTemplateId: templateId,
      associatedTemplateName: templateName
    };
    saveTableConfigFile(projectId, config);
  }

  async getOrganizeProgress(projectId: string): Promise<WritingOrganizeProgress | null> {
    const progressFile = getWritingOrganizeProgressFile(projectId);
    try {
      if (fs.existsSync(progressFile)) {
        const data = fs.readFileSync(progressFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[WritingStorage] Failed to load organize progress:', error);
    }
    return null;
  }

  private saveOrganizeProgress(projectId: string, progress: WritingOrganizeProgress): void {
    const progressFile = getWritingOrganizeProgressFile(projectId);
    try {
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8');
    } catch (error) {
      console.error('[WritingStorage] Failed to save organize progress:', error);
    }
  }

  async organizeTable(
    projectId: string,
    modelConfig: ModelConfig,
    chapterIndex?: number,
    onProgress?: (current: number, total: number, message: string, percent?: number) => void
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> {
    const result = { success: false, processedCount: 0, errorCount: 0, errors: [] as string[] };
    const startTime = Date.now();

    console.log('[WritingOrganize] 开始整理表格:', projectId, 'chapterIndex:', chapterIndex);

    try {
      const project = await this.loadProject(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      const tableConfig = await this.getTableConfig(projectId);
      if (!tableConfig || !tableConfig.associatedTemplateId) {
        throw new Error('未关联表格模板，请先绑定模板');
      }

      const tableData = loadTableData(projectId);
      if (!tableData || !tableData.sheets || tableData.sheets.length === 0) {
        throw new Error('表格数据不存在，请先绑定模板');
      }

      const template = tableTemplateService.getTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      console.log('[WritingOrganize] 使用模板:', template.name);
      console.log('[WritingOrganize] 模板包含', template.sheets?.length || 0, '个页签');

      // 确定要处理的章节列表
      let chaptersToProcess: Chapter[];
      if (chapterIndex !== undefined) {
        // 单章节模式：仅处理指定章节
        const targetChapter = project.chapters.find(ch => ch.index === chapterIndex);
        if (!targetChapter) {
          throw new Error(`章节 ${chapterIndex} 不存在`);
        }
        if (!targetChapter.content || targetChapter.content.trim().length === 0) {
          throw new Error(`章节 ${targetChapter.title} 没有内容`);
        }
        chaptersToProcess = [targetChapter];
        console.log('[WritingOrganize] 单章节模式 - 处理章节:', targetChapter.title);
      } else {
        // 全项目模式：处理所有有内容的章节
        chaptersToProcess = project.chapters.filter(ch => ch.content && ch.content.trim().length > 0);
        console.log('[WritingOrganize] 全项目模式 - 待处理章节数:', chaptersToProcess.length);
      }

      const totalChapters = chaptersToProcess.length;
      if (totalChapters === 0) {
        throw new Error('没有可处理的章节内容');
      }

      // 预计算总分片数，用于精确进度计算
      let totalChunks = 0;
      for (const chapter of chaptersToProcess) {
        const chunks = this.splitChapterContent(chapter.content || '');
        totalChunks += chunks.length;
      }
      console.log(`[WritingOrganize] 预计算总分片数: ${totalChunks}`);

      const progress: WritingOrganizeProgress = {
        projectId,
        status: 'running',
        currentChapter: 0,
        totalChapters,
        processedCount: 0,
        errorCount: 0,
        errors: [],
        startedAt: startTime
      };
      this.saveOrganizeProgress(projectId, progress);

      const apiEndpoint = this.buildApiEndpoint(modelConfig);

      // 累计已处理的分片数，用于精确进度计算
      let processedChunks = 0;

      for (let i = 0; i < chaptersToProcess.length; i++) {
        const chapter = chaptersToProcess[i];
        progress.currentChapter = chapter.index;
        this.saveOrganizeProgress(projectId, progress);

        console.log(`[WritingOrganize] 处理章节 ${i + 1}/${totalChapters}: ${chapter.title}`);

        if (onProgress) {
          const percent = Math.round((processedChunks / totalChunks) * 100);
          onProgress(i + 1, totalChapters, `处理章节: ${chapter.title}`, percent);
        }

        // 计算当前章节的分片数
        const chapterChunks = this.splitChapterContent(chapter.content || '');
        const chapterStartChunks = processedChunks;

        try {
          const chapterResult = await this.processChapterWithAI(
            projectId,
            chapter,
            template,
            tableData,
            apiEndpoint,
            modelConfig,
            // 分片级进度回调
            (chunkIndex: number, totalChapterChunks: number, chapterTitle: string) => {
              processedChunks = chapterStartChunks + chunkIndex;
              if (onProgress) {
                const percent = Math.round((processedChunks / totalChunks) * 100);
                onProgress(
                  i + 1,
                  totalChapters,
                  `处理章节 "${chapterTitle}" 分片 ${chunkIndex}/${totalChapterChunks}`,
                  percent
                );
              }
            }
          );

          if (chapterResult.success) {
            progress.processedCount++;
            addLog(`[WritingOrganize] 章节处理成功: ${chapter.title}`, 'info');
          } else {
            const errorMsg = chapterResult.error || '未知错误';
            addLog(`[WritingOrganize] 章节处理失败: ${chapter.title} - ${errorMsg}`, 'error');
            progress.errors.push(`章节 ${chapter.title}: ${errorMsg}`);
            progress.errorCount++;
          }
        } catch (chapterError) {
          const errorMsg = chapterError instanceof Error ? chapterError.message : String(chapterError);
          addLog(`[WritingOrganize] 章节处理异常: ${chapter.title} - ${errorMsg}`, 'error');
          progress.errors.push(`章节 ${chapter.title}: ${errorMsg}`);
          progress.errorCount++;
        }

        this.saveOrganizeProgress(projectId, progress);
      }

      progress.status = progress.errorCount > 0 ? 'error' : 'completed';
      progress.lastProcessedAt = new Date().toISOString();
      this.saveOrganizeProgress(projectId, progress);

      result.success = progress.processedCount > 0;
      result.processedCount = progress.processedCount;
      result.errorCount = progress.errorCount;
      result.errors = progress.errors;

      console.log('[WritingOrganize] 整理完成:', result);
      return result;
    } catch (error) {
      console.error('[WritingOrganize] 整理失败:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      const errorProgress: WritingOrganizeProgress = {
        projectId,
        status: 'error',
        currentChapter: 0,
        totalChapters: 0,
        processedCount: 0,
        errorCount: 1,
        errors: [errorMsg],
        startedAt: startTime,
        lastProcessedAt: new Date().toISOString()
      };
      this.saveOrganizeProgress(projectId, errorProgress);

      result.errors.push(errorMsg);
      throw error;
    }
  }

  private getActiveEngine(): any {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    if (engines.length > 0) {
      return engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
    }
    return null;
  }

  private getApiKey(): string {
    const engine = this.getActiveEngine();
    const apiKey = engine?.api_key;
    if (!apiKey) {
      throw new Error('未配置 API Key，请在设置 → AI引擎设置中配置');
    }
    return apiKey;
  }

  private getApiKeyTransmission(): string {
    const engine = this.getActiveEngine();
    return engine?.api_key_transmission || 'header';
  }

  private getBaseUrl(): string {
    const engine = this.getActiveEngine();
    if (!engine?.api_url) {
      throw new Error('未配置 AI 服务地址，请在设置 → AI引擎设置中配置');
    }
    return engine.api_url.replace(/\/v1\/chat\/completions$/, '').replace(/\/v1\/completions$/, '');
  }

  private getModelName(): string {
    const engine = this.getActiveEngine();
    if (!engine?.model_name) {
      throw new Error('未配置模型名称，请在设置 → AI引擎设置中配置');
    }
    return engine.model_name;
  }

  private buildApiEndpoint(modelConfig: ModelConfig): {
    apiUrl: string;
    apiMode: string;
    apiKey: string;
    apiKeyTransmission: string;
    modelName: string;
  } {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

    const apiKey = this.getApiKey();
    const apiKeyTransmission = this.getApiKeyTransmission();
    const modelName = this.getModelName();

    let apiUrl = activeEngine?.api_url || 'http://127.0.0.1:5000';
    const apiMode = activeEngine?.api_mode || 'chat_completion';

    if (apiMode === 'text_completion') {
      if (!apiUrl.endsWith('/v1/completions')) {
        apiUrl += '/v1/completions';
      }
    } else {
      if (!apiUrl.endsWith('/v1/chat/completions')) {
        apiUrl += '/v1/chat/completions';
      }
    }

    return { apiUrl, apiMode, apiKey, apiKeyTransmission, modelName };
  }

  private splitChapterContent(content: string, maxWordCount: number = 8000): string[] {
    const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0);
    const chunks: string[] = [];
    let currentChunk = '';
    let currentWordCount = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length;
      
      if (currentWordCount + paragraphLength > maxWordCount && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
        currentWordCount = paragraphLength;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        currentWordCount += paragraphLength;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private async processChapterWithAI(
    projectId: string,
    chapter: Chapter,
    template: any,
    existingTableData: WritingTableData,
    apiEndpoint: { apiUrl: string; apiMode: string; apiKey: string; apiKeyTransmission: string; modelName: string },
    modelConfig: ModelConfig,
    onChunkProgress?: (chunkIndex: number, totalChunks: number, chapterTitle: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    const content = chapter.content || '';
    const chunks = this.splitChapterContent(content);

    addLog(`[WritingOrganize] 处理章节: ${chapter.title}, 分块数: ${chunks.length}`, 'info');

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunkContent = chunks[chunkIndex];
      addLog(`[WritingOrganize] 处理分块 ${chunkIndex + 1}/${chunks.length}, 长度: ${chunkContent.length} 字符`, 'debug');

      // 每批分片处理前重新加载最新的表格数据，确保上下文包含之前分片的整理结果
      const latestTableData = loadTableData(projectId);
      if (latestTableData) {
        // 更新 existingTableData 引用为最新数据
        existingTableData.sheets = latestTableData.sheets;
        existingTableData.headers = latestTableData.headers;
        existingTableData.data = latestTableData.data;
        existingTableData.sheetDescriptions = latestTableData.sheetDescriptions;
        addLog(`[WritingOrganize] 已重新加载最新表格数据 (分块 ${chunkIndex + 1})`, 'debug');
      }

      const tableContext = this.buildTableContextForPrompt(projectId, template);
      const prompt = this.buildWritingTableOrganizePrompt(chunkContent, template, tableContext);

      addLog(`[WritingOrganize] 开始调用AI API (分块 ${chunkIndex + 1})`, 'debug');

      const aiResponse = await this.callAIAPI(prompt, modelConfig, apiEndpoint);

      if (!aiResponse || aiResponse.trim() === '') {
        addLog(`[WritingOrganize] AI未返回有效响应: ${chapter.title} (分块 ${chunkIndex + 1})`, 'warn');
        // 通知前端分片处理完成（即使没有返回有效响应）
        if (onChunkProgress) {
          onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
        }
        continue;
      }

      addLog(`[WritingOrganize] AI响应长度: ${aiResponse.length} 字符 (分块 ${chunkIndex + 1})`, 'debug');

      const parseResult = tableEditParser.parse(aiResponse);

      if (!parseResult.success && parseResult.commands.length === 0) {
        addLog(`[WritingOrganize] 未解析到tableEdit命令: ${chapter.title} (分块 ${chunkIndex + 1})`, 'warn');
        if (parseResult.errors.length > 0) {
          addLog(`[WritingOrganize] 解析错误: ${parseResult.errors.join('; ')}`, 'warn');
        }
        // 通知前端分片处理完成
        if (onChunkProgress) {
          onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
        }
        continue;
      }

      if (parseResult.errors.length > 0) {
        addLog(`[WritingOrganize] 解析警告: ${parseResult.errors.join('; ')}`, 'warn');
      }

      if (parseResult.commands.length > 0) {
        addLog(`[WritingOrganize] 执行 ${parseResult.commands.length} 个tableEdit命令 (分块 ${chunkIndex + 1})`, 'info');
        this.executeTableEditCommands(projectId, parseResult.commands, existingTableData);
        addLog(`[WritingOrganize] 分块 ${chunkIndex + 1} 整理结果已录入表格`, 'info');
      }

      // 通知前端分片处理完成，触发UI刷新
      if (onChunkProgress) {
        onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
      }
    }

    addLog(`[WritingOrganize] 章节处理完成: ${chapter.title}`, 'info');
    return { success: true };
  }

  private buildTableContextForPrompt(projectId: string, template: any): string {
    const tableData = loadTableData(projectId);
    if (!tableData) return '【现有表格数据】\n暂无数据\n';

    let context = '【现有表格数据】\n';
    let quickIndex = '【唯一ID快速查找索引】\n';

    template.sheets.forEach((sheet: any, sheetIndex: number) => {
      const rows = tableData.data[sheet.name] || [];
      const tableIndex = sheetIndex + 1;

      if (rows.length > 0) {
        context += `\n【${sheet.name}】(表格索引: ${tableIndex})\n`;
        rows.forEach((row: any, rowIndex: number) => {
          const rowIdx = rowIndex + 1;
          context += `行${rowIdx}: `;
          const parts: string[] = [];
          for (const [key, value] of Object.entries(row)) {
            if (key !== '流水号') {
              parts.push(`${key}=${value}`);
            }
          }
          context += parts.join(', ') + '\n';

          const uniqueId = row['唯一id'];
          if (uniqueId) {
            quickIndex += `- ${uniqueId} → ${sheet.name}, 行${rowIdx}\n`;
          }
        });
        context += `共 ${rows.length} 条记录\n`;
      }
    });

    if (quickIndex === '【唯一ID快速查找索引】\n') {
      quickIndex += '暂无数据\n';
    }

    return context + '\n' + quickIndex;
  }

  private buildTableContext(projectId: string, template: any): string {
    const tableData = loadTableData(projectId);
    if (!tableData) return '';

    let context = '当前表格数据状态:\n';
    for (const sheetName of tableData.sheets) {
      const rows = tableData.data[sheetName] || [];
      context += `\n页签: ${sheetName}\n`;
      context += `列: ${tableData.headers[sheetName]?.join(', ') || '无'}\n`;
      context += `行数: ${rows.length}\n`;
      if (rows.length > 0 && rows.length <= 5) {
        context += '最近数据:\n';
        rows.slice(-3).forEach((row: any, idx: number) => {
          context += `  - ${JSON.stringify(row)}\n`;
        });
      }
    }
    return context;
  }

  private buildWritingTableOrganizePrompt(
    chapterContent: string,
    template: any,
    tableContext: string
  ): string {
    const templateDescription = template.sheets.map((sheet: any, index: number) => {
      return `- [索引${index + 1}] ${sheet.name}：字段包括 [${sheet.headers.map((h: string, i: number) => `${i + 1}:${h}`).join(', ')}]
  表格用途：${sheet.description || '暂无描述'}`;
    }).join('\n');

    const extractionRules = template.sheets.map((sheet: any, index: number) => {
      const fields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id').join('、');
      return `${index + 1}. **${sheet.name}**：${sheet.description || '暂无描述'} | 提取字段：${fields}`;
    }).join('；');

    const uniqueIdGuide = template.sheets.map((sheet: any) => {
      const keyFields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id' && h !== '备注').slice(0, 3);
      return `- ${sheet.name}：使用关键字段"${keyFields.join('、')}"的语义组合 + 序号，确保唯一且有语义`;
    }).join('\n');

    return `【角色设定】
你是一个专业的信息提取和表格整理专家，擅长从文本中提取关键信息并生成精确的tableEdit命令。你特别擅长识别不同称呼（appellations）的同一元素，并通过唯一ID策略确保实体识别的一致性。

【当前消息】
${chapterContent}

${tableContext}

【表格模板结构】
${templateDescription}

【表格提取规则】
当前模板包含以下表格，请根据表格名称和描述提取对应信息，同一实体的不同称呼共用唯一ID：
${extractionRules}

【唯一ID生成指南】
${uniqueIdGuide}

【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**。请根据上下文和语义情景判断：
     * 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID
     * 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
     * 姓名 vs 代号/职业："007" = "詹姆斯·邦德" → 同一个唯一ID
     * 代词回指："她" / "他" / "那个女孩" → 根据上下文指向判断对应的实体
   - **关键判断原则**：
     * 如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID
     * 例："朱迪"、"朱迪·霍普斯"、"Judy"、"兔子"都出现在同一个场景且行为连贯 → 同一个角色
     * 例：对话中出现"白兔子"和"灰兔子"两个不同实体，各自有独立描述和行为 → 两个不同的唯一ID
     * 例："学校"和"第一中学"如果上下文明确指同一所学校 → 同一个地点

3. **实体识别与一致性维护**：
   - 在整个对话过程中，建立和维护一致的实体识别
   - 跨越对话轮次和会话，保持同一实体的唯一ID一致性
   - 考虑上下文变化、语义关系和对话流程，进行系统的唯一元素识别
   - 当不确定时，优先假设是同一实体（基于已有记录中的唯一ID判断）

4. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致（如"典狱长使用的电子面罩"和"典狱长使用的电子面具"）
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段

增量更新决策流程：
1. 从当前消息中识别实体（角色、物品、地点、事件等）
2. 检查表格中是否已有该实体（通过唯一ID或关键特征匹配）
   a. 首先在"唯一ID快速查找索引"中查找
   b. 如果没找到，在"当前已有数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一ID=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(2, 1, {"4":"警长"})  ← 只更新身份字段（假设角色表格是表格2，身份是字段4）
- 错误操作：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

重复检测特殊场景处理：
- 场景1：消息中提到"电子面罩"，但表格中已有"电子面罩"(mask_001)和"电子面罩"(electronic_mask_001)
  处理：这两条记录很可能是同一物品，应合并为一条，使用updateRow更新其中一条，并删除另一条
- 场景2：消息中提到"万能房卡"，表格中已有"万能房卡"(universal_room_card_001)和"万能房卡"(card_001)
  处理：检查描述是否一致，如果一致则合并；如果不一致则保留两条但确保唯一ID不同
- 场景3：消息中提到"神经刺激遥控器"，表格中已有"神经刺激遥控器"(remote_001)和"神经刺激遥控器"(nerve_stimulator_001)
  处理：这两条记录很可能是同一物品，应合并为一条

【输出要求】
1. 从当前消息中提取关键信息，生成对应的tableEdit命令
2. 将命令放在<tableEdit>标签内
3. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
4. 确保使用正确的表格索引、行索引和字段索引
5. 参考现有表格数据，避免重复添加相同信息
6. 识别变体称呼，使用唯一ID保持一致性
7. 只提取当前消息中明确提到的信息，不要臆造
8. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
9. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"当前已有数据"中通过名称相似度查找
10. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
11. 操作结果确认：在生成tableEdit命令后，简要说明每个操作的目的

【tableEdit命令格式】
你需要将操作指令放在<tableEdit>标签内,使用HTML注释格式:

<tableEdit>
<!-- 
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
-->
</tableEdit>

参数说明:
- 表格索引: 从1开始,对应模板中页签的顺序
- 行索引: 从1开始,对应该表格中的数据行索引
- 字段索引: 从1开始,对应该表格表头的字段索引
- 每个表格的字段结构固定为: [1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增,通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成,需具有语义且保持一致性

【示例输出 - 精确格式约束】

假设当前对话场景如下：
- 消息："朱迪说她昨天在中央公园遇到了尼克，尼克给她展示了一枚金色徽章。另外，之前提到的电子面罩已经被典狱长收回了。"
- 现有表格数据：
  【角色表格】(表格索引: 2)
  行1: 唯一id=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官, 关系=主角
  行2: 唯一id=nick_001, 角色名=尼克·王尔德, 身份=狐狸, 关系=配角
  【物品表格】(表格索引: 4)
  行1: 唯一id=mask_001, 物品名=电子面罩, 类型=装备, 状态=使用中, 备注/持有人=典狱长
  行3: 唯一id=card_001, 物品名=万能房卡, 类型=钥匙, 状态=可用, 备注/持有人=朱迪

正确输出格式：

<tableEdit>
<!-- 
=== 新增操作 ===
insertRow(2, {"2":"badge_001","3":"金色徽章","4":"物品","5":"尼克展示给朱迪的金色徽章","6":"已发现","7":"尼克"})
说明：在角色表格(索引2)中新增一行，添加"金色徽章"物品记录
  字段2(唯一id): badge_001 - 语义化命名，badge表示徽章，001表示序号
  字段3(物品名): 金色徽章
  字段4(类型): 物品
  字段5(描述): 尼克展示给朱迪的金色徽章
  字段6(状态): 已发现
  字段7(备注/持有人): 尼克

=== 更新操作 ===
updateRow(2, 2, {"6":"已见面","7":"狐狸骗子"})
说明：更新角色表格(索引2)中第2行(尼克·王尔德)的信息
  行2对应的是唯一id=nick_001的记录
  只更新变化的字段：字段6(关系)从"配角"改为"已见面"，字段7(特征)更新为"狐狸骗子"
  不要重复填写未变化的字段(唯一id、角色名、身份)

updateRow(4, 1, {"6":"已收回"})
说明：更新物品表格(索引4)中第1行(电子面罩)的状态
  行1对应的是唯一id=mask_001的记录
  只更新字段6(状态)从"使用中"改为"已收回"

=== 删除操作 ===
deleteRow(4, 1)
说明：删除物品表格(索引4)中第1行(电子面罩)
  行1对应的是唯一id=mask_001的记录
  仅在确认该物品已不再相关时使用删除操作
-->
</tableEdit>

【格式规范总结】

1. insertRow(表格索引, {字段数据对象})
   - 表格索引：数字，从1开始，对应模板页签顺序
   - 字段数据对象：JSON格式，键为字段索引(字符串)，值为字段内容(字符串)
   - 示例：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官"})
   - 注意：字段索引2(唯一id)必须填写，字段1(流水号)由系统自动生成无需填写
   - 注意：所有值必须是字符串类型，用双引号包裹

2. updateRow(表格索引, 行索引, {字段数据对象})
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始，对应当前表格中的数据行号
   - 字段数据对象：JSON格式，只包含需要更新的字段
   - 示例：updateRow(2, 1, {"4":"警长"})
   - 注意：只更新变化的字段，不要重复填写未变化的字段
   - 注意：行索引必须在当前表格数据范围内(参考"唯一ID快速查找索引")

3. deleteRow(表格索引, 行索引)
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始
   - 示例：deleteRow(4, 1)
   - 注意：删除操作需谨慎，仅在确认记录不再相关时使用
   - 注意：合并重复记录时，应先updateRow保留的记录，再deleteRow删除重复的记录

【错误格式示例 - 绝对禁止】

✗ insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"}) 
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(2, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

✗ insertRow("2", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

✗ updateRow(2, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串

【现在开始处理】
请分析上述消息，参考现有表格数据，提取关键信息并生成tableEdit命令。记住：这是增量更新，不要重复插入已存在的实体！`;
  }

  private buildChapterPrompt(chapter: Chapter, template: any, tableContext: string): string {
    let prompt = `你是一个小说数据整理助手。请分析以下章节内容，并根据模板结构提取关键信息到表格中。\n\n`;
    prompt += `章节标题: ${chapter.title}\n`;
    prompt += `章节索引: ${chapter.index}\n\n`;
    prompt += `章节内容:\n${chapter.content?.substring(0, 8000)}\n\n`;

    // 详细日志：打印构建的 prompt
    console.log('=== [Prompt构建] 开始 ===');
    console.log('[Prompt构建] 章节:', chapter.title);
    console.log('[Prompt构建] 章节索引:', chapter.index);
    console.log('[Prompt构建] 章节内容长度:', chapter.content?.length || 0, '字符');
    console.log('[Prompt构建] 模板页签数:', template.sheets?.length || 0);
    console.log('[Prompt构建] tableContext 长度:', tableContext?.length || 0, '字符');
    console.log('[Prompt构建] 完整 Prompt:\n', prompt);
    console.log('=== [Prompt构建] 结束 ===');

    prompt += `表格模板结构:\n`;
    for (const sheet of template.sheets) {
      prompt += `页签: ${sheet.name}\n`;
      prompt += `描述: ${sheet.description || '无'}\n`;
      prompt += `列: ${sheet.headers.join(', ')}\n\n`;
    }

    if (tableContext) {
      prompt += `${tableContext}\n\n`;
    }

    prompt += `请提取章节中的关键信息，使用以下格式更新表格：\n`;
    prompt += `\`\`\`tableEdit\n`;
    prompt += `sheet: 页签名称\n`;
    prompt += `action: insert\n`;
    prompt += `data: {"列名1": "值1", "列名2": "值2", ...}\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `请只返回tableEdit命令，不要返回其他内容。`;

    return prompt;
  }

  private async callAIAPI(
    prompt: string,
    modelConfig: ModelConfig,
    apiEndpoint: { apiUrl: string; apiMode: string; apiKey: string; apiKeyTransmission: string; modelName: string }
  ): Promise<string> {
    const http = require('http');
    const https = require('https');

    const parsedUrl = new URL(apiEndpoint.apiUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    if (!modelConfig.temperature && modelConfig.temperature !== 0) {
      throw new Error('未提供 temperature 参数');
    }
    if (!modelConfig.maxTokens) {
      throw new Error('未提供 maxTokens 参数');
    }

    const { apiKey, apiKeyTransmission, modelName, apiMode } = apiEndpoint;

    const payload: Record<string, any> = {
      model: modelName,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
    };

    if (apiMode === 'text_completion') {
      Object.assign(payload, { prompt });
    } else {
      Object.assign(payload, {
        messages: [
          { role: 'system', content: '你是一个小说数据整理助手，负责从章节内容中提取结构化信息到表格中。' },
          { role: 'user', content: prompt }
        ]
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKeyTransmission === 'header') {
      const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      headers['Authorization'] = authValue;
    } else {
      payload.api_key = apiKey;
    }

    addLog(`[WritingOrganize] AI请求 - 完整 Payload:`, 'debug');
    addLog(JSON.stringify(payload, null, 2), 'debug');

    console.log('=== [AI请求参数] 开始 ===');
    console.log('[AI请求参数] 端点:', apiEndpoint.apiUrl);
    console.log('[AI请求参数] 模式:', apiMode);
    console.log('[AI请求参数] 模型:', modelName);
    console.log('[AI请求参数] Temperature:', modelConfig.temperature);
    console.log('[AI请求参数] MaxTokens:', modelConfig.maxTokens);
    console.log('[AI请求参数] API Key 传输方式:', apiKeyTransmission);
    console.log('[AI请求参数] API Key 长度:', apiKey?.length || 0);
    console.log('[AI请求参数] 完整 Prompt 长度:', prompt.length, '字符');
    console.log('[AI请求参数] 完整 Payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('=== [AI请求参数] 结束 ===');

    const requestBody = JSON.stringify(payload);
    const contentLength = Buffer.byteLength(requestBody);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': contentLength,
        },
        timeout: 0,
      };

      const req = transport.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            console.log('=== [AI响应参数] 开始 ===');
            console.log('[AI响应参数] 完整原始响应:');
            console.log(data);
            console.log('[AI响应参数] 完整解析JSON:');
            console.log(JSON.stringify(response, null, 2));
            console.log('=== [AI响应参数] 结束 ===');
            addLog(`[WritingOrganize] AI响应 - 完整原始数据:`, 'debug');
            addLog(data, 'debug');
            addLog(`[WritingOrganize] AI响应 - 完整解析后JSON:`, 'debug');
            addLog(JSON.stringify(response, null, 2), 'debug');
            if (apiMode === 'text_completion') {
              resolve(response.choices?.[0]?.text || '');
            } else {
              resolve(response.choices?.[0]?.message?.content || '');
            }
          } catch (e) {
            console.log('[AI响应参数] 解析失败，完整原始数据:');
            console.log(data);
            addLog(`[WritingOrganize] AI响应 - 解析失败，原始数据:`, 'error');
            addLog(data, 'error');
            reject(new Error(`AI响应解析失败: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('AI请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  private executeTableEditCommands(
    projectId: string,
    commands: any[],
    existingTableData: WritingTableData
  ): void {
    for (const command of commands) {
      try {
        const { type, tableIndex, rowIndex, data } = command;

        // 将 0-based tableIndex 转换为 sheet 名称
        if (tableIndex === undefined || tableIndex === null) {
          addLog(`[WritingOrganize] 命令缺少 tableIndex: ${JSON.stringify(command)}`, 'warn');
          continue;
        }

        const sheetName = existingTableData.sheets[tableIndex];
        if (!sheetName) {
          addLog(`[WritingOrganize] 页签不存在: tableIndex=${tableIndex}, sheets=${JSON.stringify(existingTableData.sheets)}`, 'warn');
          continue;
        }

        if (!existingTableData.data[sheetName]) {
          addLog(`[WritingOrganize] 页签数据不存在: ${sheetName}`, 'warn');
          continue;
        }

        addLog(`[WritingOrganize] 执行命令: ${type}(表格${tableIndex + 1}=${sheetName}${rowIndex !== undefined ? `,行${rowIndex + 1}` : ''})`, 'debug');

        if (type === 'insertRow') {
          existingTableData.data[sheetName].push(data || {});
          addLog(`[WritingOrganize] insertRow 成功: ${sheetName}, 新增1行`, 'debug');
        } else if (type === 'updateRow' && typeof rowIndex === 'number') {
          if (rowIndex >= 0 && rowIndex < existingTableData.data[sheetName].length) {
            existingTableData.data[sheetName][rowIndex] = {
              ...existingTableData.data[sheetName][rowIndex],
              ...data
            };
            addLog(`[WritingOrganize] updateRow 成功: ${sheetName}, 行${rowIndex + 1}`, 'debug');
          } else {
            addLog(`[WritingOrganize] updateRow 行索引越界: rowIndex=${rowIndex}, 总行数=${existingTableData.data[sheetName].length}`, 'warn');
          }
        } else if (type === 'deleteRow' && typeof rowIndex === 'number') {
          if (rowIndex >= 0 && rowIndex < existingTableData.data[sheetName].length) {
            existingTableData.data[sheetName].splice(rowIndex, 1);
            addLog(`[WritingOrganize] deleteRow 成功: ${sheetName}, 行${rowIndex + 1}`, 'debug');
          } else {
            addLog(`[WritingOrganize] deleteRow 行索引越界: rowIndex=${rowIndex}, 总行数=${existingTableData.data[sheetName].length}`, 'warn');
          }
        } else {
          addLog(`[WritingOrganize] 未知命令类型: ${type}`, 'warn');
        }
      } catch (error) {
        addLog(`[WritingOrganize] 执行命令失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
        console.error('[WritingOrganize] 执行命令失败:', error);
      }
    }

    saveTableDataFile(projectId, existingTableData);
    addLog(`[WritingOrganize] 表格数据已保存到文件`, 'debug');
  }
}

export const writingStorageService = new WritingStorageService();