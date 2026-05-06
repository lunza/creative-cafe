import { ipcMain, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { documentProcessorService } from '../services/DocumentProcessorService';
import { knowledgeBaseService } from '../services/KnowledgeBaseService';
import { worldBookService } from '../services/worldBookService';
import type { KnowledgeItem } from '../types/vectorConfig';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const SUPPORTED_FORMATS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md'];
const WORLD_BOOK_FORMATS = ['.json']; // World book files
const MAX_RETRY_ATTEMPTS = 3;

export interface DocumentUploadResult {
  success: boolean;
  documentId?: string;
  knowledgeItemsCreated?: number;
  chunkCount?: number;
  error?: string;
  isDuplicate?: boolean;
}

export interface UploadProgress {
  step: 'validating' | 'uploading' | 'extracting' | 'chunking' | 'vectorizing' | 'storing' | 'creating_kb_items' | 'done' | 'error';
  progress: number;
  message: string;
  fileName: string;
}

class KnowledgeBaseDocumentService {
  private uploadProgressListeners: Array<(progress: UploadProgress) => void> = [];
  private deduplicationPolicy: 'skip' | 'update' | 'create_new' = 'skip';

  setDeduplicationPolicy(policy: 'skip' | 'update' | 'create_new'): void {
    this.deduplicationPolicy = policy;
  }

  async selectDocumentFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  private validateFile(filePath: string): { valid: boolean; error?: string; fileName?: string; ext?: string; size?: number } {
    if (!filePath) return { valid: false, error: '文件路径不能为空' };

    const fileName = filePath.split(/[\\/]/).pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || !SUPPORTED_FORMATS.includes(`.${ext}`)) {
      return { valid: false, error: `不支持的文件格式: .${ext}` };
    }

    try {
      const stat = require('fs').statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return { valid: false, error: `文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)` };
      }
      return { valid: true, fileName, ext, size: stat.size };
    } catch {
      return { valid: false, error: '文件无法访问，可能已损坏或不存在' };
    }
  }

  private async checkDuplicate(fileName: string): Promise<{ isDuplicate: boolean; existingDocId?: string }> {
    const docs = await documentProcessorService.listDocuments();
    const existing = docs.find(d => d.metadata.fileName === fileName);
    if (existing) {
      return { isDuplicate: true, existingDocId: existing.documentId };
    }
    return { isDuplicate: false };
  }

  async uploadAndVectorizeDocument(
    filePath: string,
    options?: {
      category?: string[];
      tags?: string[];
      source?: string;
    }
  ): Promise<DocumentUploadResult> {
    const validation = this.validateFile(filePath);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { fileName } = validation;
    this.broadcastProgress({ step: 'validating', progress: 5, message: '验证文件...', fileName: fileName || '' });

    const duplicateCheck = await this.checkDuplicate(fileName || '');
    if (duplicateCheck.isDuplicate && this.deduplicationPolicy === 'skip') {
      return { success: true, isDuplicate: true, documentId: duplicateCheck.existingDocId, error: '文档已存在，已跳过' };
    }

    this.broadcastProgress({ step: 'extracting', progress: 10, message: '开始处理文件...', fileName: fileName || '' });

    let retries = 0;
    let result: DocumentUploadResult = { success: false };

    while (retries < MAX_RETRY_ATTEMPTS) {
      try {
        result = await this.processDocumentWithProgress(filePath, options);
        if (result.success) {
          return result;
        }
        retries++;
        if (retries < MAX_RETRY_ATTEMPTS) {
          this.broadcastProgress({
            step: 'vectorizing',
            progress: 50 + retries * 10,
            message: `向量化失败，正在重试 (${retries}/${MAX_RETRY_ATTEMPTS})...`,
            fileName: fileName || '',
          });
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      } catch (error) {
        retries++;
        if (retries >= MAX_RETRY_ATTEMPTS) {
          return {
            success: false,
            error: `处理失败，已重试 ${MAX_RETRY_ATTEMPTS} 次: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    }

    return result;
  }

  private isWorldBookFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ext === 'json';
  }

  private async processWorldBookFile(
    filePath: string,
    fileName: string,
    options?: { category?: string[]; tags?: string[]; source?: string }
  ): Promise<DocumentUploadResult> {
    const processStartTime = Date.now();

    this.broadcastProgress({ step: 'extracting', progress: 15, message: '解析世界书文件...', fileName });

    try {
      // 读取世界书JSON文件
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const worldBookData = JSON.parse(fileContent);

      // 检查是否为有效的世界书格式
      if (!worldBookData.entries || typeof worldBookData.entries !== 'object') {
        return { success: false, error: '无效的世界书文件格式' };
      }

      this.broadcastProgress({ step: 'chunking', progress: 30, message: '提取世界书条目...', fileName });

      const entries = Object.entries(worldBookData.entries);
      const knowledgeItems: KnowledgeItem[] = [];

      for (const [key, entry] of entries) {
        const e = entry as any;
        const entryUid = e.uid || key;

        // 跳过被禁用的条目
        if (e.disable || e.enabled === false) {
          continue;
        }

        // 跳过空内容条目
        if (!e.content || e.content.trim().length === 0) {
          continue;
        }

        // 每个世界书条目作为一个完整的知识条目（不分割）
        const itemContent = `## ${e.comment || e.name || `条目 ${entryUid}`}
关键词：${(e.key || []).join(', ')}${e.keysecondary && e.keysecondary.length > 0 ? ', ' + (e.keysecondary as string[]).join(', ') : ''}
${e.content}`;

        knowledgeItems.push({
          id: `kb_wb:${fileName}:${entryUid}`,
          title: `${fileName} - ${e.comment || e.name || `条目 ${entryUid}`}`,
          content: itemContent,
          source: options?.source || 'worldbook_upload',
          category: options?.category || ['世界书知识'],
          tags: options?.tags || [fileName.split('.')[0] || 'worldbook', ...(e.key || [])].filter(Boolean),
          relatedCharacterIds: [],
        relatedWorldBookPaths: [fileName],
        metadata: {
            documentId: `wb_${fileName}`,
            fileName: fileName,
            worldBookEntryUid: String(entryUid),
            worldBookEntryName: e.name || '',
            worldBookEntryKey: e.key || [],
            worldBookEntryKeySecondary: e.keysecondary || [],
            worldBookEntryComment: e.comment || '',
            worldBookEntryContent: e.content || '',
            worldBookDescription: worldBookData.description || '',
            chunkIndex: knowledgeItems.length,
            totalChunks: entries.length,
            uploadedAt: processStartTime,
            processedAt: Date.now(),
            processingTime: Date.now() - processStartTime,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: 'worldbook_upload',
            embeddingMode: 'remote' as const,
            embeddingModel: 'default',
            tokenCount: itemContent.length,
            entryOrder: e.order !== undefined ? e.order : 100,
            entryPosition: e.position !== undefined ? e.position : 1,
            entryProbability: e.probability !== undefined ? e.probability : 100,
            entryGroup: e.group || '',
            isWorldBookEntry: true
          }
        });
      }

      this.broadcastProgress({ step: 'creating_kb_items', progress: 80, message: `批量创建 ${knowledgeItems.length} 个知识条目...`, fileName });

      const itemsCreated = await knowledgeBaseService.createBatchDeferred(knowledgeItems);

      this.broadcastProgress({ step: 'done', progress: 100, message: '世界书处理完成！', fileName });

      return {
        success: true,
        documentId: `wb_${fileName}`,
        knowledgeItemsCreated: itemsCreated,
        chunkCount: knowledgeItems.length,
      };
    } catch (error) {
      this.broadcastProgress({
        step: 'error',
        progress: 0,
        message: `世界书处理失败: ${error instanceof Error ? error.message : String(error)}`,
        fileName,
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async processDocumentWithProgress(
    filePath: string,
    options?: { category?: string[]; tags?: string[]; source?: string }
  ): Promise<DocumentUploadResult> {
    const fileName = filePath.split(/[\\/]/).pop() || '';

    // 检查是否为世界书文件
    if (this.isWorldBookFile(fileName)) {
      return await this.processWorldBookFile(filePath, fileName, options);
    }

    this.broadcastProgress({ step: 'extracting', progress: 15, message: '提取文档内容...', fileName });

    const startTime = Date.now();
    const processStartTime = Date.now();

    let lastStep = 'extracting';
    const onProgress = (p: { step: string; progress: number; message: string }) => {
      if (p.step !== lastStep) {
        lastStep = p.step;
      }
      const adjustedProgress = 15 + Math.round(p.progress * 0.6);
      this.broadcastProgress({
        step: p.step as UploadProgress['step'],
        progress: adjustedProgress,
        message: p.message,
        fileName,
      });
    };

    try {
      const processResult = await documentProcessorService.processDocument(filePath, onProgress);

      if (!processResult.success) {
        return { success: false, error: processResult.error };
      }

      this.broadcastProgress({ step: 'creating_kb_items', progress: 80, message: '批量创建知识条目...', fileName });

      const docId = processResult.documentId;
      // Use chunks directly from processResult instead of reading from vector store
      const chunks = processResult.chunks || [];
      const embeddings = processResult.embeddings || [];
      const perfStart = Date.now();

      const knowledgeItems: KnowledgeItem[] = chunks.map((chunk, i) => ({
        id: `kb_doc:${docId}:${i}`,
        title: `${fileName} - 第 ${i + 1} 段`,
        content: chunk.text,
        source: options?.source || 'document_upload',
        category: options?.category || ['文档知识'],
        tags: options?.tags || [fileName.split('.')[0] || 'document'],
        relatedCharacterIds: [],
        relatedWorldBookPaths: [],
        vector: embeddings[i], // Use pre-computed embedding
        metadata: {
          documentId: docId,
          fileName: fileName,
          chunkIndex: i,
          totalChunks: chunks.length,
          uploadedAt: processStartTime,
          processedAt: Date.now(),
          processingTime: Date.now() - processStartTime,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'document_upload',
          embeddingMode: 'remote' as const,
          embeddingModel: 'default',
          tokenCount: chunk.text.length,
        },
      }));

      const itemsCreated = await knowledgeBaseService.createBatchWithVectors(knowledgeItems);
      const perfEnd = Date.now();
      console.log(`[KB Document] Batch created ${itemsCreated} KB items in ${perfEnd - perfStart}ms`);

      this.broadcastProgress({ step: 'done', progress: 100, message: '处理完成！', fileName });

      return {
        success: true,
        documentId: docId,
        knowledgeItemsCreated: itemsCreated,
        chunkCount: chunks.length,
      };
    } catch (error) {
      this.broadcastProgress({
        step: 'error',
        progress: 0,
        message: `处理失败: ${error instanceof Error ? error.message : String(error)}`,
        fileName,
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  onProgress(callback: (progress: UploadProgress) => void): () => void {
    this.uploadProgressListeners.push(callback);
    return () => {
      this.uploadProgressListeners = this.uploadProgressListeners.filter(l => l !== callback);
    };
  }

  private broadcastProgress(progress: UploadProgress): void {
    for (const listener of this.uploadProgressListeners) {
      try { listener(progress); } catch { /* ignore listener errors */ }
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle('knowledge:uploadDocument', async (_event, { filePath, options }: { filePath: string; options?: { category?: string[]; tags?: string[]; source?: string } }) => {
      try {
        return await this.uploadAndVectorizeDocument(filePath, options);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle('knowledge:selectDocumentFile', async () => {
      try {
        return await this.selectDocumentFile();
      } catch (error) {
        return null;
      }
    });
  }
}

export const knowledgeBaseDocumentService = new KnowledgeBaseDocumentService();
