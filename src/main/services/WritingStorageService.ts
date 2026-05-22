import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';
import { WritingProject, ExportFormat, Chapter, WritingStyleResource } from '../../shared/types/writing.types';

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
          generationSettings: { model: '', temperature: 0.7 },
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
}

export const writingStorageService = new WritingStorageService();