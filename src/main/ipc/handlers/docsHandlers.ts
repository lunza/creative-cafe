import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectRoot, app } from '../../utils/appPath';

/**
 * 文档读取 IPC 处理器
 * 暴露 docs:read 通道，供渲染进程读取项目根目录 docs/ 下的文档文件内容。
 *
 * 路径解析策略：
 *  - 开发环境（!app.isPackaged）：getProjectRoot()/docs
 *  - 生产环境（app.isPackaged）：process.resourcesPath/docs
 *
 * 安全：通过 fileName 校验防止路径穿越攻击（拒绝包含 ".." 或以 "/" / "\\" 开头的输入）。
 */
export function docsHandlers() {
  ipcMain.handle('docs:read', async (_event, fileName: string) => {
    try {
      // 校验 fileName，防止路径穿越攻击
      if (!fileName || fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\')) {
        return { success: false, error: '无效的文件名' };
      }

      // 解析 docs 目录路径
      let docsDir: string;
      try {
        if (app && typeof app.isPackaged === 'boolean' && app.isPackaged) {
          docsDir = path.join(process.resourcesPath, 'docs');
        } else {
          docsDir = path.join(getProjectRoot(), 'docs');
        }
      } catch {
        docsDir = path.join(getProjectRoot(), 'docs');
      }

      const filePath = path.join(docsDir, fileName);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取文档失败';
      return { success: false, error: message };
    }
  });
}
