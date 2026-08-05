/**
 * AI 辅助角色特征生成 IPC 处理器（Spec: add-asset-and-trait-management / Task 12）
 *
 * 通道列表：
 *   - ai:generateCharacterTraits       基于角色卡 description/personality/scenario 调用 LLM
 *                                      生成视觉特征 tag 列表（非流式）
 *   - ai:recognizeImageTraits          通过多模态模型识别角色卡 PNG 图片提取视觉特征 tag
 *   - ai:generateDynamicScenePrompts  将自然语言指令解析为三组英文 SD tag（服装/动作/场景）
 *                                      （Spec: add-dynamic-scene-prompt-generation / Task 3）
 *
 * 注册模式参照 registerCharacterTraitHandlers() / registerAssetHandlers()：
 * 导出 registerCharacterTraitAIHandlers() 函数，由 ipc/index.ts 调用。
 *
 * 参数与返回值与 characterTraitAIService 各方法签名对齐：
 *   - generateCharacterTraits：{ characterCardId, description, personality?, scenario? } → { success, traits?, error? }
 *   - recognizeImageTraits：{ characterCardPath, characterName? } → { success, traits?, error? }
 *   - generateDynamicScenePrompts：{ naturalLanguageInput, baseTraits? } → { success, clothing?, pose?, scene?, error? }
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
  GenerateDynamicScenePromptsParams,
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
   * 将自然语言指令解析为三组英文 SD tag（服装 / 动作 / 场景）。
   *
   * Spec: add-dynamic-scene-prompt-generation / Task 3
   *
   * 通道用途：
   *   - 接收用户的中文自然语言场景指令（如「让角色穿上一套哥特风的衣服，
   *     骑着摩托驰骋在高速公路上」），由主进程 LLM 解析为三组独立的英文 SD tag
   *   - 输出三组维度独立、未提及维度返回空字符串 ""，供前端写入
   *     `DynamicScenePrompt` 后在 SD 生成时替换 `{clothing}` / `{pose}` / `{scene}` 占位符
   *
   * 入参：
   *   - naturalLanguageInput：用户原始自然语言指令（必填非空，空/纯空白触发兜底错误）
   *   - baseTraits：角色基础特征拼接字符串（可选，给 LLM 提供角色上下文，
   *     避免生成与基础特征矛盾的 tag，例如基础特征有 tail 时不生成 no tail）
   *
   * 返回：
   *   - success=true：clothing / pose / scene 三组英文 SD tag 字符串
   *     （未提及的维度为空字符串 ""，与 spec「未提及的维度返回空」一致）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 错误场景（service 内部已兜底为 `{ success: false, error }`，handler 再 try/catch
   * 提供 IPC 序列化兜底，保证渲染进程永不收到 reject）：
   *   - 空输入：naturalLanguageInput 为空或纯空白 → 「请输入动态场景指令」（不调用 LLM）
   *   - AI 引擎未配置：baseUrl / apiKey / modelName / temperature / max_tokens 任一缺失
   *   - 调用失败：网络 / 超时 / HTTP 错误
   *   - 解析失败：LLM 返回空内容 / 无分隔符 / 无法识别三组 tag
   */
  ipcMain.handle(
    'ai:generateDynamicScenePrompts',
    async (_event, args: GenerateDynamicScenePromptsParams) => {
      try {
        return await characterTraitAIService.generateDynamicScenePrompts(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] generateDynamicScenePrompts failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
