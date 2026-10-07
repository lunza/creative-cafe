import { ExportFormat } from '../types/writing.types';
import type { WritingProject, ChapterOutline } from '../types/writing.types';

/** JSON 导出结构（稳定契约，便于外部工具消费） */
export interface V2JsonExportChapter {
  index: number;
  title: string;
  wordCount: number;
  content: string;
}

export interface V2JsonExportPayload {
  title: string;
  exportedAt: string;
  format: 'json';
  chapterCount: number;
  chapters: V2JsonExportChapter[];
}

/**
 * 将章节列表渲染为导出文本（TXT / Markdown / JSON）。
 * 纯函数：主进程 writingV2:exportWithChapters 与单元测试共用。
 */
export function buildExportContent(
  project: WritingProject,
  chapters: ChapterOutline[],
  format: ExportFormat
): string {
  const title = project.title || '未命名作品';

  if (format === ExportFormat.JSON) {
    const payload: V2JsonExportPayload = {
      title,
      exportedAt: new Date().toISOString(),
      format: 'json',
      chapterCount: chapters.length,
      chapters: chapters.map((c) => {
        const content = (c.content || '').trim();
        return {
          index: c.index,
          title: c.title,
          // 字数与导出的（trim 后）正文保持一致
          wordCount: c.wordCount || content.length,
          content,
        };
      }),
    };
    return JSON.stringify(payload, null, 2);
  }

  const separator = format === ExportFormat.MARKDOWN ? '\n\n---\n\n' : '\n\n' + '─'.repeat(40) + '\n\n';
  const blocks: string[] = [format === ExportFormat.MARKDOWN ? `# ${title}` : title];
  for (const chapter of chapters) {
    const header = format === ExportFormat.MARKDOWN ? `## ${chapter.title}` : chapter.title;
    blocks.push(`${header}\n\n${(chapter.content || '').trim()}`);
  }
  return blocks.join(separator);
}
