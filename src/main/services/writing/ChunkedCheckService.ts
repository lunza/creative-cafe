import { addLog } from '../memory/chatLogService';
import { plotCheckerService, PlotCheckRequestData } from './PlotCheckerService';
import { PlotCheckReport, GeneratedOutline } from '../../../shared/types/writing.types';

export interface CheckChunk {
  index: number;
  title: string;
  content: string;
  chapterIndex: number;
  status: 'pending' | 'checking' | 'completed' | 'error';
  report: PlotCheckReport | null;
}

export interface ChunkedCheckProgress {
  totalChunks: number;
  completedChunks: number;
  currentChunkIndex: number;
  chunks: CheckChunk[];
  isRunning: boolean;
  isPaused: boolean;
  overallScore: number | null;
}

export interface ChunkedCheckConfig {
  projectId: string;
  outline: GeneratedOutline | null;
  chapterContents: Record<string, string>;
  resources: any;
  novelType?: string;
  writingStyle?: string;
  modelConfig?: any;
}

export class ChunkedCheckService {
  private progress: ChunkedCheckProgress = {
    totalChunks: 0,
    completedChunks: 0,
    currentChunkIndex: -1,
    chunks: [],
    isRunning: false,
    isPaused: false,
    overallScore: null
  };
  
  private abortController: AbortController | null = null;

  getProgress(): ChunkedCheckProgress {
    return { ...this.progress, chunks: this.progress.chunks.map(c => ({ ...c })) };
  }

  /**
   * 按章节自动分片
   */
  createChunksByChapter(config: ChunkedCheckConfig): CheckChunk[] {
    const chunks: CheckChunk[] = [];
    
    if (!config.outline?.chapters) {
      addLog('[ChunkedCheckService] 大纲中没有章节', 'warn');
      return chunks;
    }

    for (const chapter of config.outline.chapters) {
      const content = config.chapterContents[chapter.index.toString()] || '';
      if (!content.trim()) continue;

      chunks.push({
        index: chunks.length,
        title: chapter.title || `第${chapter.index + 1}章`,
        content,
        chapterIndex: chapter.index,
        status: 'pending',
        report: null
      });
    }

    addLog(`[ChunkedCheckService] 按章节分片: 共 ${chunks.length} 个分片`, 'info');
    return chunks;
  }

  /**
   * 按字数手动分片
   */
  createChunksByWordCount(content: string, maxWordsPerChunk: number = 3000, chapterTitle: string = '', chapterIndex: number = 0): CheckChunk[] {
    const chunks: CheckChunk[] = [];
    
    if (!content || content.length === 0) return chunks;

    // 按段落分割
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
    let currentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > maxWordsPerChunk && currentChunk.length > 0) {
        chunks.push({
          index: chunkIndex++,
          title: `${chapterTitle} - 片段 ${chunkIndex}`,
          content: currentChunk.trim(),
          chapterIndex,
          status: 'pending',
          report: null
        });
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        index: chunkIndex,
        title: `${chapterTitle} - 片段 ${chunkIndex + 1}`,
        content: currentChunk.trim(),
        chapterIndex,
        status: 'pending',
        report: null
      });
    }

    addLog(`[ChunkedCheckService] 按字数分片: 共 ${chunks.length} 个分片 (每片最多 ${maxWordsPerChunk} 字)`, 'info');
    return chunks;
  }

  /**
   * 开始分片检查
   */
  async startCheck(config: ChunkedCheckConfig, chunks?: CheckChunk[]): Promise<ChunkedCheckProgress> {
    if (this.progress.isRunning) {
      throw new Error('分片检查正在运行中');
    }

    const finalChunks = chunks || this.createChunksByChapter(config);
    
    if (finalChunks.length === 0) {
      throw new Error('没有可检查的内容');
    }

    this.abortController = new AbortController();
    this.progress = {
      totalChunks: finalChunks.length,
      completedChunks: 0,
      currentChunkIndex: -1,
      chunks: finalChunks.map(c => ({ ...c })),
      isRunning: true,
      isPaused: false,
      overallScore: null
    };

    addLog(`[ChunkedCheckService] 开始分片检查: ${finalChunks.length} 个分片`, 'info');

    for (let i = 0; i < finalChunks.length; i++) {
      // 检查是否被中止
      if (this.abortController.signal.aborted) {
        addLog('[ChunkedCheckService] 分片检查已中止', 'info');
        break;
      }

      // 检查是否暂停
      while (this.progress.isPaused && !this.abortController.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.abortController.signal.aborted) break;

      const chunk = this.progress.chunks[i];
      this.progress.currentChunkIndex = i;
      chunk.status = 'checking';

      addLog(`[ChunkedCheckService] 检查分片 ${i + 1}/${finalChunks.length}: ${chunk.title}`, 'info');

      try {
        const previousChapters = config.outline?.chapters
          ?.filter(ch => ch.index < chunk.chapterIndex)
          .slice(-2)
          .map(ch => ({
            index: ch.index,
            title: ch.title || '',
            content: (config.chapterContents[ch.index.toString()] || '').substring(0, 2000)
          })) || [];

        const request: PlotCheckRequestData = {
          projectId: config.projectId,
          chapterIndex: chunk.chapterIndex,
          content: chunk.content,
          outline: config.outline,
          resources: config.resources,
          novelType: config.novelType as any,
          writingStyle: config.writingStyle,
          modelConfig: config.modelConfig,
          previousChapters
        };

        const report = await plotCheckerService.checkChapter(request);
        chunk.report = report;
        chunk.status = 'completed';
        this.progress.completedChunks++;

        addLog(`[ChunkedCheckService] 分片 ${i + 1} 检查完成: 评分=${report.overallScore}`, 'info');
      } catch (error) {
        chunk.status = 'error';
        addLog(`[ChunkedCheckService] 分片 ${i + 1} 检查失败: ${error}`, 'error');
      }
    }

    // 计算总体评分
    const completedReports = this.progress.chunks
      .filter(c => c.report)
      .map(c => c.report!.overallScore);
    
    this.progress.overallScore = completedReports.length > 0
      ? Math.round(completedReports.reduce((a, b) => a + b, 0) / completedReports.length)
      : null;

    this.progress.isRunning = false;
    this.progress.currentChunkIndex = -1;

    addLog(`[ChunkedCheckService] 分片检查完成: 总体评分=${this.progress.overallScore}`, 'info');
    return this.getProgress();
  }

  /**
   * 暂停检查
   */
  pause() {
    this.progress.isPaused = true;
    addLog('[ChunkedCheckService] 分片检查已暂停', 'info');
  }

  /**
   * 继续检查
   */
  resume() {
    this.progress.isPaused = false;
    addLog('[ChunkedCheckService] 分片检查已继续', 'info');
  }

  /**
   * 停止检查
   */
  stop() {
    this.progress.isRunning = false;
    this.progress.isPaused = false;
    this.progress.currentChunkIndex = -1;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    addLog('[ChunkedCheckService] 分片检查已停止', 'info');
  }

  /**
   * 获取指定分片的检查结果
   */
  getChunkReport(chunkIndex: number): PlotCheckReport | null {
    if (chunkIndex < 0 || chunkIndex >= this.progress.chunks.length) return null;
    return this.progress.chunks[chunkIndex].report;
  }

  /**
   * 获取所有分片的汇总报告
   */
  getSummaryReport(): { overallScore: number | null; totalIssues: number; highSeverityCount: number; chunkResults: { index: number; title: string; score: number | null; issues: number }[] } {
    const chunkResults = this.progress.chunks.map(c => ({
      index: c.index,
      title: c.title,
      score: c.report?.overallScore || null,
      issues: c.report?.totalIssues || 0
    }));

    let totalIssues = 0;
    let highSeverityCount = 0;
    for (const c of this.progress.chunks) {
      if (c.report) {
        totalIssues += c.report.totalIssues;
        highSeverityCount += c.report.highSeverityCount;
      }
    }

    return {
      overallScore: this.progress.overallScore,
      totalIssues,
      highSeverityCount,
      chunkResults
    };
  }
}

export const chunkedCheckService = new ChunkedCheckService();
