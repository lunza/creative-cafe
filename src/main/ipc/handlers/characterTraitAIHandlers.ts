/**
 * AI 辅助角色特征生成 IPC 处理器（Spec: add-asset-and-trait-management / Task 12）
 *
 * 通道列表：
 *   - ai:generateCharacterTraits  基于角色卡 description/personality/scenario 调用 LLM
 *                                 生成视觉特征 tag 列表（非流式）
 *
 * 注册模式参照 registerCharacterTraitHandlers() / registerAssetHandlers()：
 * 导出 registerCharacterTraitAIHandlers() 函数，由 ipc/index.ts 调用。
 *
 * 参数与返回值与 characterTraitAIService.generateCharacterTraits 方法签名对齐：
 *   - 入参对象：{ characterCardId, description, personality?, scenario? }
 *   - 返回值：{ success, traits?: string[], error?: string }
 *
 * 与 aiHandlers.ts（ai:request / ai:cancel / ai:listModels）的关系：
 *   - aiHandlers.ts 提供通用 HTTP 转发（前端自己拼 messages），是低层通道
 *   - 本 handler 是高层业务通道（service 内部读 AI 配置 + 拼 prompt + 解析响应）
 *   - 命名空间统一在 ai: 下，与 Spec SubTask 12.3 要求一致
 *
 * service 内部已 try/catch 兜底；外层 handler 再 try/catch 提供 IPC 序列化兜底，
 * 保证渲染进程永不收到 reject（与 characterTraitHandlers / assetHandlers 一致）。
 */
import { ipcMain } from 'electron';
import { characterTraitAIService } from '../../services/characterTraitAIService';
import type {
  GenerateCharacterTraitsParams,
  RecognizeImageTraitsParams
} from '../../services/characterTraitAIService';

export function registerCharacterTraitAIHandlers() {
  /**
   * 调用 LLM 生成角色视觉特征 tag 列表。
   *
   * 入参：
   *   - characterCardId：角色卡 ID（必填，用于日志关联）
   *   - description：角色描述（必填）
   *   - personality：角色性格（可选）
   *   - scenario：角色场景（可选）
   *
   * 返回：
   *   - success=true：traits 为 tag 字符串数组（可能为空，表示 LLM 未提取到）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 错误场景：
   *   - AI 引擎未配置（baseUrl/apiKey/modelName 缺失）
   *   - 调用失败（网络/超时/HTTP 错误）
   *   - 返回格式异常（空内容/无法解析）
   */
  ipcMain.handle(
    'ai:generateCharacterTraits',
    async (_event, args: GenerateCharacterTraitsParams) => {
      try {
        return await characterTraitAIService.generateCharacterTraits(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] generateCharacterTraits failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 通过多模态模型识别角色卡图片，提取视觉特征 tag 列表（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
   *
   * 入参：
   *   - characterCardPath：角色卡 PNG 图片路径（必填）
   *   - characterName：角色名（可选，注入 prompt 提供上下文）
   *
   * 返回：
   *   - success=true：traits 为 tag 字符串数组（可能为空，表示模型未提取到）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 前置条件：当前 AI 引擎需 supportsVision=true（由前端判断，handler 不重复检测）
   *
   * 错误场景：
   *   - AI 引擎未配置（baseUrl/apiKey/modelName 缺失）
   *   - 角色卡图片读取失败（文件不存在/无权限）
   *   - 调用失败（网络/超时/HTTP 错误）
   *   - 返回格式异常（空内容/无法解析）
   */
  ipcMain.handle(
    'ai:recognizeImageTraits',
    async (_event, args: RecognizeImageTraitsParams) => {
      try {
        return await characterTraitAIService.recognizeImageTraits(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] recognizeImageTraits failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
