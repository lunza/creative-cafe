import { ipcMain, dialog } from 'electron';
import * as fs from 'fs/promises';
import { documentProcessorService } from '../../services/DocumentProcessorService';
import { getEmbeddingService } from '../../services/EmbeddingService';

export function documentHandlers() {
  ipcMain.handle('document:process', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!filePath) {
        return { success: false, error: '文件路径不能为空' };
      }
      const result = await documentProcessorService.processDocument(filePath);
      
      // If processing succeeded, store the vectors with document ID format
      // 文档上传功能统一标记为 KNOWLEDGE 类型（仅世界书管理页面的向量化按钮才标记为 WORLDBOOK）
      if (result.success && result.embeddings && result.chunks) {
        const stored = await documentProcessorService.storeDocumentVectors(
          result.documentId,
          result.metadata.fileName,
          result.metadata.fileType,
          result.chunks,
          result.embeddings
        );
        if (!stored) {
          console.error('[document:process] Failed to store document vectors');
        }
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        documentId: '',
        metadata: {} as any,
        chunkCount: 0,
      };
    }
  });

  ipcMain.handle('document:list', async () => {
    try {
      return await documentProcessorService.listDocuments();
    } catch (error) {
      console.error('Failed to list documents:', error);
      return [];
    }
  });

  ipcMain.handle('document:delete', async (_event, { docId }: { docId: string }) => {
    try {
      if (!docId) {
        return false;
      }
      return await documentProcessorService.deleteDocument(docId);
    } catch (error) {
      console.error('Failed to delete document:', error);
      return false;
    }
  });

  ipcMain.handle('document:deleteBatch', async (_event, { docIds }: { docIds: string[] }) => {
    try {
      const deletePromises = docIds.map(docId => documentProcessorService.deleteDocument(docId).catch(() => false));
      const results = await Promise.all(deletePromises);
      return results.filter(Boolean).length;
    } catch (error) {
      console.error('Failed to batch delete documents:', error);
      return 0;
    }
  });

  ipcMain.handle('document:getInfo', async (_event, { docId }: { docId: string }) => {
    try {
      if (!docId) {
        return null;
      }
      return await documentProcessorService.getDocumentInfo(docId);
    } catch (error) {
      console.error('Failed to get document info:', error);
      return null;
    }
  });

  ipcMain.handle('document:getChunks', async (_event, { docId }: { docId: string }) => {
    try {
      if (!docId) {
        return [];
      }
      return await documentProcessorService.getDocumentChunks(docId);
    } catch (error) {
      console.error('Failed to get document chunks:', error);
      return [];
    }
  });

  ipcMain.handle('document:searchVectors', async (_event, { queryText, topK, docId }: { queryText: string; topK: number; docId?: string }) => {
    try {
      if (!queryText || queryText.trim().length === 0) {
        return { success: false, error: '查询文本不能为空' };
      }
      const results = await documentProcessorService.searchDocumentVectors(queryText, topK || 5, docId);
      return { success: true, results };
    } catch (error) {
      console.error('Failed to search document vectors:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error), results: [] };
    }
  });

  ipcMain.handle('document:getVectorStats', async () => {
    try {
      return await documentProcessorService.getVectorStats();
    } catch (error) {
      console.error('Failed to get vector stats:', error);
      return { totalVectors: 0, documentCount: 0, documents: [] };
    }
  });

  ipcMain.handle('document:selectFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (error) {
      console.error('Failed to select file:', error);
      return null;
    }
  });

  ipcMain.handle('document:generateEmbedding', async (_event, { text }: { text: string }) => {
    try {
      if (!text || text.trim().length === 0) {
        return { success: false, error: '文本不能为空', vector: null, dimension: 0 };
      }
      const embeddingService = getEmbeddingService();
      const result = await embeddingService.generateEmbedding(text);
      return result;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error), vector: null, dimension: 0 };
    }
  });
}
