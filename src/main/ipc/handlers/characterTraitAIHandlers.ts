/**
 * AI 辅助角色特征生成 IPC 处理器（Spec: add-asset-and-trait-management / Task 12）
 *
 * 通道列表：
 *   - ai:generateCharacterTraits       基于角色卡 description/personality/scenario 调用 LLM
 *                                      生成视觉特征 tag 列表（非流式）
 *   - ai:recognizeImageTraits          通过多模态模型识别角色卡 PNG 图片提取视觉特征 tag
 *   - ai:generateTraitPrompts          将用户自由文本提示词解析为分类 SD tag（Spec: add-prompt-generation-in-asset-modal）
 *                                      在 AI 素材生成弹窗中提供「提示词生成」入口，
 *                                      生成结果携带 categoryId / translation / originalText，
 *                                      可直接追加到 editedTraits，复用 L0-L5 完整审计链
 *
 * 注册模式参照 registerCharacterTraitHandlers() / registerAssetHandlers()：
 * 导出 registerCharacterTraitAIHandlers() 函数，由 ipc/index.ts 调用。
 *
 * 参数与返回值与 characterTraitAIService 各方法签名对齐：
 *   - generateCharacterTraits：{ characterCardId, description, personality?, scenario? } → { success, traits?, error? }
 *   - recognizeImageTraits：{ characterCardPath, characterName? } → { success, traits?, error? }
 *   - generateTraitPrompts：{ prompt, baseTraits? } → { success, traits?, error?, ragDebug? }
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
  GenerateTraitPromptsParams,
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

  /**
   * 将用户自由文本提示词解析为分类 SD tag（Spec: add-prompt-generation-in-asset-modal）。
   *
   * 通道用途：
   *   - 接收用户在 AI 素材生成弹窗「提示词生成」面板输入的自由文本提示词
   *     （如 "red hair, blue dress, forest background"），由主进程 LLM 解析为
   *     分类特征 tag 列表（含 categoryId / translation / originalText）
   *   - 输出可直接追加到 AssetGenerateModal.editedTraits，无需二次处理
   *
   * 入参：
   *   - prompt：用户输入的提示词（必填非空，空/纯空白触发兜底错误）
   *   - baseTraits：当前已有特征文本（可选，逗号分隔，作为上下文避免重复生成）
   *
   * 返回：
   *   - success=true：traits 为分类特征数组（含 translation + originalText）
   *     ragDebug 为 RAG 标签库质检报告（与 generateCharacterTraits 结构兼容）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 错误场景（service 内部已兜底为 `{ success: false, error }`，handler 再 try/catch
   * 提供 IPC 序列化兜底，保证渲染进程永不收到 reject）：
   *   - 空输入：prompt 为空或纯空白 → 「请输入提示词」（不调用 LLM）
   *   - AI 引擎未配置：baseUrl / apiKey / modelName 任一缺失
   *   - 引擎参数缺失：temperature / max_tokens 未配置
   *   - 调用失败：网络 / 超时 / HTTP 错误
   *   - 解析失败：LLM 返回空内容 / 无法解析为分类 tag
   *
   * 审计流程（与 generateCharacterTraits 完全一致，L0-L5 完整审计链）：
   *   - L0 自定义同义词映射（userSynonymMapService）
   *   - L1 name 精确匹配 / L2 alias 精确匹配
   *   - L3 颜色复合词拆分 / L3b 否定性修饰词剥离
   *   - L4 语义 KNN 替换（score >= 0.3 自动替换）
   *   - L5 AI 兜底（LLM 生成候选词 → 再走 L0-L4 → 命中替换 + 持久化）
   */
  ipcMain.handle(
    'ai:generateTraitPrompts',
    async (_event, args: GenerateTraitPromptsParams) => {
      try {
        return await characterTraitAIService.generateTraitPrompts(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] generateTraitPrompts failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
