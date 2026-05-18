import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';
import { WritingProject, ExportFormat, Chapter } from '../../shared/types/writing.types';

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
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (error) {
    console.error('[WritingStorage] Failed to save index:', error);
  }
}

export class WritingStorageService {
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
      
      project.lastSavedAt = Date.now();
      project.updatedAt = Date.now();
      
      fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), 'utf8');
      
      for (const chapter of project.chapters) {
        const chapterFile = path.join(getChaptersDir(project.id), `chapter-${chapter.index}.md`);
        fs.writeFileSync(chapterFile, chapter.content, 'utf8');
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
      const project: WritingProject = JSON.parse(data);
      
      const chaptersDir = getChaptersDir(projectId);
      if (fs.existsSync(chaptersDir)) {
        const files = fs.readdirSync(chaptersDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const match = file.match(/^chapter-(\d+)\.md$/);
            if (match) {
              const chapterIndex = parseInt(match[1], 10);
              const chapter = project.chapters.find((c) => c.index === chapterIndex);
              if (chapter) {
                chapter.content = fs.readFileSync(path.join(chaptersDir, file), 'utf8');
              }
            }
          }
        }
      }
      
      return project;
    } catch (error) {
      console.error('[WritingStorage] Failed to load project:', error);
      return null;
    }
  }

  async loadAllProjects(): Promise<WritingProject[]> {
    try {
      const index = loadIndex();
      const projects: WritingProject[] = [];
      
      for (const projectInfo of index.projects) {
        const project = await this.loadProject(projectInfo.id);
        if (project) {
          projects.push(project);
        }
      }
      
      return projects;
    } catch (error) {
      console.error('[WritingStorage] Failed to load all projects:', error);
      return [];
    }
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

  async autoSaveChapter(projectId: string, chapterIndex: number, content: string): Promise<void> {
    try {
      const chapterFile = path.join(getChaptersDir(projectId), `chapter-${chapterIndex}.md`);
      fs.writeFileSync(chapterFile, content, 'utf8');

      const project = await this.loadProject(projectId);
      if (project) {
        const chapter = project.chapters.find((c) => c.index === chapterIndex);
        if (chapter) {
          if (chapter.content && chapter.content !== content) {
            chapter.versions = chapter.versions || [];
            chapter.versions.push({
              id: `v${Date.now()}`,
              content: chapter.content,
              timestamp: Date.now(),
              note: '自动保存',
              isAutoGenerated: false
            });
          }
          chapter.content = content;
          chapter.wordCount = content.length;
          chapter.lastModified = Date.now();
          await this.saveProject(project);
        }
      }
    } catch (error) {
      console.error('[WritingStorage] Failed to auto-save chapter:', error);
    }
  }

  async saveVersion(projectId: string, chapterIndex: number, content: string, note?: string): Promise<boolean> {
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
        note: note || '手动保存',
        isAutoGenerated: false
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
      content += chapter.content + '\n\n';
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
      content += chapter.content + '\n\n';
    }
    
    return content;
  }
}

export const writingStorageService = new WritingStorageService();
