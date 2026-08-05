/**
 * 全局分类字典 IPC 处理器（Spec: fix-asset-trait-and-scene-defects / Task 3.4）
 *
 * 通道列表：
 *   - category-dictionary:load    读取全局分类字典（含所有自定义分类）
 *   - category-dictionary:add     新增自定义分类（重名时返回既有分类）
 *   - category-dictionary:delete  按 id 删除自定义分类（幂等）
 *   - category-dictionary:rename  按 id 重命名自定义分类
 *   - category-dictionary:has     检查全局字典中是否已存在指定名称的分类（大小写不敏感）
 *
 * 注册模式参照 registerCharacterTraitHandlers() / registerCharacterTraitAIHandlers()：
 * 导出 registerCategoryDictionaryHandlers() 函数，由 ipc/index.ts 调用。
 *
 * service 内部已 try/catch 兜底（除入参校验失败的 throw 路径外，永不抛异常）；
 * 外层 handler 再 try/catch 是为 IPC 序列化失败等极端场景提供最后兜底，
 * 保证渲染进程永不收到 reject（与 characterTraitHandlers 风格一致）。
 *
 * 返回值约定：
 *  - 成功：`{ success: true, ...payload }`（payload 因通道而异）
 *  - 失败：`{ success: false, error }`（error 为友好信息，非堆栈）
 */
import { ipcMain } from 'electron';
import { categoryDictionaryService } from '../../services/categoryDictionaryService';

export function registerCategoryDictionaryHandlers() {
  /**
   * 读取全局分类字典。
   *
   * 返回 `{ success: true, dictionary: GlobalTraitCategoryDictionary }`。
   * 文件不存在或损坏时返回空白字典（categories=[]）。
   */
  ipcMain.handle('category-dictionary:load', async () => {
    try {
      const dictionary = categoryDictionaryService.loadDictionary();
      return { success: true, dictionary };
    } catch (error) {
      console.error('[CategoryDictionaryHandler] load failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * 新增自定义分类。
   *
   * 入参：`{ name: string, icon?: string }`
   * 返回：`{ success: true, category: TraitCategory }`（重名时 category 为既有分类）
   * 失败：`{ success: false, error }`（name 为空时）
   */
  ipcMain.handle(
    'category-dictionary:add',
    async (_event, args: { name: string; icon?: string }) => {
      try {
        const { name, icon } = args ?? {};
        const category = categoryDictionaryService.addCategory(name, icon);
        return { success: true, category };
      } catch (error) {
        console.error('[CategoryDictionaryHandler] add failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 按 id 删除自定义分类（幂等：id 不存在视为成功）。
   *
   * 入参：`{ id: string }`
   * 返回：`{ success: true }`
   */
  ipcMain.handle(
    'category-dictionary:delete',
    async (_event, args: { id: string }) => {
      try {
        const { id } = args ?? {};
        categoryDictionaryService.deleteCategory(id);
        return { success: true };
      } catch (error) {
        console.error('[CategoryDictionaryHandler] delete failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 按 id 重命名自定义分类。
   *
   * 入参：`{ id: string, newName: string }`
   * 返回：`{ success: true }`
   * 失败：`{ success: false, error }`（newName 为空 / 重名 / id 不存在视为幂等成功不在此列）
   */
  ipcMain.handle(
    'category-dictionary:rename',
    async (_event, args: { id: string; newName: string }) => {
      try {
        const { id, newName } = args ?? {};
        categoryDictionaryService.renameCategory(id, newName);
        return { success: true };
      } catch (error) {
        console.error('[CategoryDictionaryHandler] rename failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 检查全局字典中是否已存在指定名称的分类（大小写不敏感）。
   *
   * 入参：`{ name: string }`
   * 返回：`{ success: true, exists: boolean }`
   */
  ipcMain.handle(
    'category-dictionary:has',
    async (_event, args: { name: string }) => {
      try {
        const { name } = args ?? {};
        const exists = categoryDictionaryService.hasCategory(name);
        return { success: true, exists };
      } catch (error) {
        console.error('[CategoryDictionaryHandler] has failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
