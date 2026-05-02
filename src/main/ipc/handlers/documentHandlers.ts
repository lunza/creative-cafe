import { ipcMain, dialog } from 'electron';
import { documentProcessorService } from '../../services/DocumentProcessorService';

export function documentHandlers() {
  ipcMain.handle('document:process', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!filePath) {
        return { success: false, error: '文件路径不能为空' };
      }
      const result = await documentProcessorService.processDocument(filePath);
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
}
