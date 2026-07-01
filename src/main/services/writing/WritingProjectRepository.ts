import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { WritingProject, ExportFormat } from '../../../shared/types/writing.types';

/**
 * 项目索引文件结构
 */
export interface ProjectsIndex {
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

// ==================== 路径 helper ====================

export function getWritingProjectsPath(): string {
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

export function getProjectDir(projectId: string): string {
  const basePath = getWritingProjectsPath();
  const projectDir = path.join(basePath, projectId);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  return projectDir;
}

export function getChaptersDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const chaptersDir = path.join(projectDir, 'chapters');
  if (!fs.existsSync(chaptersDir)) {
    fs.mkdirSync(chaptersDir, { recursive: true });
  }
  return chaptersDir;
}

export function getChunksDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const chunksDir = path.join(projectDir, 'chunks');
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
  }
  return chunksDir;
}

export function getVersionsDir(projectId: string): string {
  const projectDir = getProjectDir(projectId);
  const versionsDir = path.join(projectDir, 'versions');
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }
  return versionsDir;
}

export function getIndexFilePath(): string {
  return path.join(getWritingProjectsPath(), 'projects-index.json');
}

// ==================== 通用文件操作 ====================

/**
 * 安全写入文件（先写 .tmp，再 rename），与原行为完全一致。
 * 同时被 TableOrganizeService 等模块复用。
 */
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

export function computeProjectMetadata(project: WritingProject): { totalWordCount: number; completedChapters: number } {
  let totalWordCount = 0;
  let completedChapters = 0;
  for (const ch of project.outline!.chapters) {
    const wordCount = ch.content ? ch.content.length : (ch.wordCount || 0);
    totalWordCount += wordCount;
    if (ch.status === 'completed') {
      completedChapters++;
    }
  }
  return { totalWordCount, completedChapters };
}

export function loadIndex(): ProjectsIndex {
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

export function saveIndex(index: ProjectsIndex): void {
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

/**
 * 项目/章节/版本持久化仓储。
 *
 * 职责：
 * - 项目 CRUD（saveProject/loadProject/loadAllProjects/deleteProject）
 * - 章节内容自动保存（autoSaveChapter）
 * - 章节版本管理（saveVersion/restoreVersion）
 * - 分片 checkpoint 持久化（saveChunkCheckpoint/loadChunkCheckpoint/clearChunkCheckpoints）
 * - 项目导出（exportProject/exportAsTxt/exportAsMarkdown）
 *
 * 所有方法签名与原 WritingStorageService 同名方法保持一致。
 */
export class WritingProjectRepository {
  private formatChapterIndex(index: number): string {
    return parseFloat(index.toFixed(10)).toString();
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

      // 序列化整个 project 对象，包括 outline.chapters[].chunks 分片数据
      // chunks 字段会随章节内容一起保存到 project.json 中
      // 向后兼容：旧项目没有 chunks 字段时，JSON.stringify 不会报错
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
      for (const chapter of project.outline!.chapters) {
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
      // chunks 数据随 project.json 一起反序列化
      // 向后兼容：旧项目没有 chunks 字段时，JSON.parse 不会报错，chunks 为 undefined

      if (!project.metadata) {
        project.metadata = {
          totalWordCount: 0,
          completedChapters: 0,
          generationSettings: { model: '', temperature: undefined },
          continuityInfo: { foreshadowing: [], plotThreads: [], characterDevelopment: {} }
        };
      }

      const chaptersDir = getChaptersDir(projectId);
      if (fs.existsSync(chaptersDir)) {
        const files = fs.readdirSync(chaptersDir);
        for (const file of files) {
          if (file.endsWith('.md') && !file.endsWith('.tmp')) {
            const match = file.match(/^chapter-(\d+(?:\.\d+)?)\.md$/);
            if (match) {
              const chapterIndex = parseFloat(match[1]);
              const chapter = project.outline!.chapters.find((c) => c.index === chapterIndex);
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
      } else {
        // No chapters directory found - skip loading chapter content
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
        return;
      }

      const chapter = project.outline!.chapters.find((c) => c.index === chapterIndex);
      if (!chapter) {
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
    } catch (error) {
      console.error('[WritingStorage] Failed to auto-save chapter:', error);
    }
  }

  async saveVersion(projectId: string, chapterIndex: number, content: string, note?: string, isAutoGenerated: boolean = false): Promise<boolean> {
    try {
      const project = await this.loadProject(projectId);
      if (!project) return false;

      const chapter = project.outline!.chapters.find((c) => c.index === chapterIndex);
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

      const chapter = project.outline!.chapters.find((c) => c.index === chapterIndex);
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

  // ==================== 分片 checkpoint 持久化 ====================

  /**
   * 保存分片 checkpoint 到磁盘
   * 每个分片生成后立即持久化，支持中断恢复
   */
  async saveChunkCheckpoint(
    projectId: string,
    chapterIndex: number,
    chunkIndex: number,
    content: string
  ): Promise<boolean> {
    try {
      const chunksDir = getChunksDir(projectId);
      const safeChapter = this.formatChapterIndex(chapterIndex);
      const checkpointFile = path.join(chunksDir, `chapter-${safeChapter}-chunk-${chunkIndex}.json`);

      const checkpointData = {
        projectId,
        chapterIndex,
        chunkIndex,
        content,
        savedAt: Date.now()
      };

      const saved = safeWriteFile(checkpointFile, JSON.stringify(checkpointData, null, 2), 'utf8');
      return saved;
    } catch (error) {
      console.error('[WritingStorage] 保存分片 checkpoint 失败:', error);
      return false;
    }
  }

  /**
   * 加载分片 checkpoint
   */
  async loadChunkCheckpoint(
    projectId: string,
    chapterIndex: number,
    chunkIndex: number
  ): Promise<string | null> {
    try {
      const chunksDir = getChunksDir(projectId);
      const safeChapter = this.formatChapterIndex(chapterIndex);
      const checkpointFile = path.join(chunksDir, `chapter-${safeChapter}-chunk-${chunkIndex}.json`);

      if (!fs.existsSync(checkpointFile)) {
        return null;
      }

      const data = fs.readFileSync(checkpointFile, 'utf8');
      const checkpointData = JSON.parse(data);

      return checkpointData.content || null;
    } catch (error) {
      console.error('[WritingStorage] 加载分片 checkpoint 失败:', error);
      return null;
    }
  }

  /**
   * 清理指定章节的所有分片 checkpoint
   */
  async clearChunkCheckpoints(
    projectId: string,
    chapterIndex: number
  ): Promise<boolean> {
    try {
      const chunksDir = getChunksDir(projectId);
      const safeChapter = this.formatChapterIndex(chapterIndex);
      const prefix = `chapter-${safeChapter}-chunk-`;

      if (!fs.existsSync(chunksDir)) {
        return true;
      }

      const files = fs.readdirSync(chunksDir);

      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith('.json')) {
          try {
            fs.unlinkSync(path.join(chunksDir, file));
          } catch {
            // 忽略单个文件删除失败
          }
        }
      }

      return true;
    } catch (error) {
      console.error('[WritingStorage] 清理分片 checkpoint 失败:', error);
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

    for (const chapter of project.outline!.chapters.sort((a, b) => a.index - b.index)) {
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

    for (const chapter of project.outline!.chapters.sort((a, b) => a.index - b.index)) {
      content += `## ${chapter.title}\n\n`;
      content += (chapter.content || '') + '\n\n';
    }

    return content;
  }
}
