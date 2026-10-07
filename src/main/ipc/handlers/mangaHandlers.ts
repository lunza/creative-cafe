/**
 * 漫画解析 IPC handler
 *
 * Spec: integrate-comic-parsing-mode
 *
 * 通道：
 *   - manga:scanFolder           扫描文件夹内图片文件
 *   - manga:analyzePage          单页多模态 AI 分析
 *   - manga:buildContextTable    生成跨页上下文表格
 *   - manga:generateOutline      生成故事大纲
 *   - manga:auditOutline         大纲 AI 审核（检测 AI 味，与世界书 AI 审核同款契约）
 *   - manga:generateProjectDraft AI 生成写作项目字段草稿
 *   - manga:generateCharacterInfo AI 基于人物图片+整体分析生成角色信息
 *   - manga:exportAnalysis       导出 Markdown
 */
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { mangaParsingService } from '../../services/manga/MangaParsingService';
import { addLog } from '../../services/memory/chatLogService';
import type {
  MangaPageSummary,
  MangaReadingOrder,
  MangaMetaInfo,
  MangaAnalysisResult,
  V2MangaScanResult,
  V2MangaAnalyzeResult,
  V2MangaContextResult,
  V2MangaOutlineResult,
  V2MangaAuditResult,
  V2MangaProjectDraftResult,
  V2MangaCharacterGenResult,
  V2MangaExportResult,
} from '../../../shared/types/writing-v2.types';

export function registerMangaHandlers(): void {
  // ========== 文件夹扫描 ==========
  ipcMain.handle('manga:scanFolder', async (_event, folderPath: string): Promise<V2MangaScanResult> => {
    try {
      if (!folderPath) {
        return { success: false, pages: [], total: 0, error: '文件夹路径不能为空' };
      }
      return mangaParsingService.scanFolder(folderPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : '扫描失败';
      addLog(`[Manga] scanFolder 失败: ${message}`, 'error');
      return { success: false, pages: [], total: 0, error: message };
    }
  });

  // ========== 单页分析 ==========
  ipcMain.handle(
    'manga:analyzePage',
    async (
      _event,
      params: {
        imagePath: string;
        readingOrder: MangaReadingOrder;
        previousSummaries: MangaPageSummary[];
        pageIndex: number;
        userGuidance?: string;
        mangaMeta?: MangaMetaInfo;
        customPrompt?: string;
      }
    ): Promise<V2MangaAnalyzeResult> => {
      try {
        if (!params?.imagePath) {
          return { success: false, analysis: null, summary: null, error: '图片路径不能为空' };
        }
        if (!params?.readingOrder) {
          return { success: false, analysis: null, summary: null, error: '阅读顺序不能为空' };
        }
        return await mangaParsingService.analyzePage({
          imagePath: params.imagePath,
          readingOrder: params.readingOrder,
          previousSummaries: params.previousSummaries || [],
          customPrompt: params.customPrompt,
          pageIndex: params.pageIndex || 1,
          userGuidance: params.userGuidance,
          mangaMeta: params.mangaMeta,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '分析失败';
        addLog(`[Manga] analyzePage 失败: ${message}`, 'error');
        return { success: false, analysis: null, summary: null, error: message };
      }
    }
  );

  // ========== 上下文表格 ==========
  ipcMain.handle(
    'manga:buildContextTable',
    async (_event, summaries: MangaPageSummary[]): Promise<V2MangaContextResult> => {
      try {
        return mangaParsingService.buildContextTable(summaries || []);
      } catch (error) {
        const message = error instanceof Error ? error.message : '生成上下文表格失败';
        return { success: false, table: '', error: message };
      }
    }
  );

  // ========== 故事大纲生成 ==========
  ipcMain.handle(
    'manga:generateOutline',
    async (
      _event,
      summaries: MangaPageSummary[],
      mangaMeta?: MangaMetaInfo,
      customPrompt?: string
    ): Promise<V2MangaOutlineResult> => {
      try {
        return await mangaParsingService.generateStoryOutline(summaries || [], mangaMeta, customPrompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : '大纲生成失败';
        addLog(`[Manga] generateOutline 失败: ${message}`, 'error');
        return { success: false, outline: '', error: message };
      }
    }
  );

  // ========== 大纲 AI 审核（检测 AI 味，漫画解析全文作为完整性/一致性参照） ==========
  ipcMain.handle(
    'manga:auditOutline',
    async (
      _event,
      outline: string,
      mangaMeta?: MangaMetaInfo,
      summaries?: MangaPageSummary[],
      customPrompt?: string
    ): Promise<V2MangaAuditResult> => {
      try {
        if (!outline || !outline.trim()) {
          return { success: false, audit: null, error: '大纲内容不能为空' };
        }
        return await mangaParsingService.auditOutline(outline, mangaMeta, summaries, customPrompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : '大纲审核失败';
        addLog(`[Manga] auditOutline 失败: ${message}`, 'error');
        return { success: false, audit: null, error: message };
      }
    }
  );

  // ========== 写作项目字段草稿（AI 生成） ==========
  ipcMain.handle(
    'manga:generateProjectDraft',
    async (
      _event,
      summaries: MangaPageSummary[],
      outline: string,
      mangaMeta?: MangaMetaInfo,
      customPrompt?: string
    ): Promise<V2MangaProjectDraftResult> => {
      try {
        return await mangaParsingService.generateProjectDraft(summaries || [], outline || '', mangaMeta, customPrompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : '项目草稿生成失败';
        addLog(`[Manga] generateProjectDraft 失败: ${message}`, 'error');
        return { success: false, draft: null, error: message };
      }
    }
  );

  // ========== 角色信息 AI 生成（人物图片 + 整体分析 + 自定义提示词，Spec: add-ai-character-gen-to-manga-meta） ==========
  ipcMain.handle(
    'manga:generateCharacterInfo',
    async (
      _event,
      params: {
        imagePath: string;
        summaries?: MangaPageSummary[];
        mangaMeta?: MangaMetaInfo;
        currentCharacters?: string;
        customPrompt?: string;
      }
    ): Promise<V2MangaCharacterGenResult> => {
      try {
        if (!params?.imagePath) {
          return { success: false, error: '图片路径不能为空' };
        }
        return await mangaParsingService.generateCharacterInfo({
          imagePath: params.imagePath,
          summaries: params.summaries || [],
          mangaMeta: params.mangaMeta,
          currentCharacters: params.currentCharacters,
          customPrompt: params.customPrompt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '角色信息生成失败';
        addLog(`[Manga] generateCharacterInfo 失败: ${message}`, 'error');
        return { success: false, error: message };
      }
    }
  );

  // ========== 中止进行中的漫画类 AI 请求（页面分析/大纲生成/大纲审核/项目草稿生成/角色信息生成） ==========
  ipcMain.handle(
    'manga:cancel',
    async (
      _event,
      key?: 'analyzePage' | 'generateOutline' | 'auditOutline' | 'generateProjectDraft' | 'generateCharacterInfo'
    ): Promise<{ success: boolean; cancelledCount: number }> => {
      try {
        const cancelledCount = mangaParsingService.cancel(key);
        return { success: true, cancelledCount };
      } catch (error) {
        const message = error instanceof Error ? error.message : '取消失败';
        addLog(`[Manga] cancel 失败: ${message}`, 'error');
        return { success: false, cancelledCount: 0 };
      }
    }
  );

  // ========== 导出 Markdown ==========
  ipcMain.handle(
    'manga:exportAnalysis',
    async (
      _event,
      params: { result: MangaAnalysisResult; savePath: string }
    ): Promise<V2MangaExportResult> => {
      try {
        if (!params?.result) {
          return { success: false, error: '分析结果不能为空' };
        }
        if (!params?.savePath) {
          return { success: false, error: '保存路径不能为空' };
        }
        // 确保目录存在
        const dir = path.dirname(params.savePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return mangaParsingService.exportAnalysis(params);
      } catch (error) {
        const message = error instanceof Error ? error.message : '导出失败';
        addLog(`[Manga] exportAnalysis 失败: ${message}`, 'error');
        return { success: false, error: message };
      }
    }
  );
}
