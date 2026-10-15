/**
 * 【Phase 4 / L5 - conversation-mode-optimization-report】角色风格学习服务。
 *
 * 参考实现：WritingStyleLearningService（风格分析 → 风格资源持久化）。
 * 对话模式差异：学习素材是对话历史中的 AI 回复（而非上传文件），
 * 产物按角色卡一份持久化：{userData}/data/character-styles/{characterCardId}.json
 */
import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { aiService, ChatMessage } from '../AIService';
// Spec: settings-feature-optimization-report / H-5（默认值单一来源）
import { DEFAULT_ENGINE_PARAMS } from '../../../shared/settingDefaults';
import { addLog } from '../memory/chatLogService';
import {
  CharacterStyleLearningRequest,
  CharacterStyleProfile,
  CharacterStyleResource,
  CharacterStyleMessageRef,
} from '../../../shared/types/characterStyle.types';

/** 风格学习 AI 超时（毫秒） */
const STYLE_LEARN_TIMEOUT = 300000;
/** 参与学习的 AI 回复条数上限（取最近 N 条） */
const MAX_ASSISTANT_MESSAGES = 60;
/** 单条回复送入 prompt 的最大字符数 */
const MAX_MESSAGE_CHARS = 1500;

export class CharacterStyleLearningService {
  private getStylesDir(): string {
    const dataDir = path.join(getUserDataPath(), 'data');
    const dir = path.join(dataDir, 'character-styles');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private styleFile(characterCardId: string): string {
    const safe = characterCardId.replace(/[\\/:*?"<>|]/g, '_');
    return path.join(this.getStylesDir(), `${safe}.json`);
  }

  private buildLearnPrompt(request: CharacterStyleLearningRequest): string {
    // 仅取 AI 回复（assistant）作为风格样本，用户消息不参与角色风格分析
    const assistantMessages = request.messages.filter(m => m.role === 'assistant').slice(-MAX_ASSISTANT_MESSAGES);

    let parts = '## 角色卡设定（风格学习的基准参考）\n';
    parts += `- 角色名: ${request.characterCardName}\n`;
    if (request.characterCard.description) {
      parts += `- 角色描述: ${request.characterCard.description}\n`;
    }
    if (request.characterCard.personality) {
      parts += `- 性格: ${request.characterCard.personality}\n`;
    }
    parts += '\n';

    parts += `## 角色历史回复（${assistantMessages.length} 条，风格样本）\n`;
    assistantMessages.forEach((msg: CharacterStyleMessageRef, i: number) => {
      let content = msg.content;
      if (content.length > MAX_MESSAGE_CHARS) {
        content = content.substring(0, MAX_MESSAGE_CHARS) + '…（已截断）';
      }
      parts += `--- 回复 ${i + 1} ---\n${content}\n`;
    });

    parts += `
## 输出格式要求
请基于上述角色历史回复，提炼该角色的语言风格档案，严格按照以下 JSON 格式返回（不要包含 markdown 代码块标记，只返回纯 JSON）：
{
  "speakingStyle": "说话风格总述（语气、节奏、态度，2-3 句）",
  "vocabulary": ["高频词汇或短语1", "高频词汇或短语2"],
  "sentencePatterns": ["句式特征1", "句式特征2"],
  "emotionalExpression": "情感表达方式（如何表达喜怒哀乐，1-2 句）",
  "signaturePhrases": ["口癖或标志性短语1", "口癖或标志性短语2"],
  "tabooPatterns": ["该角色明显不会使用的表达1", "该角色明显不会使用的表达2"],
  "fullReport": "完整的风格学习报告（可读文本，涵盖以上所有维度的详细分析）"
}`;
    return parts;
  }

  private parseProfileResponse(rawContent: string): CharacterStyleProfile | null {
    let jsonText = rawContent.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText.substring(start, end + 1));
    } catch (error) {
      addLog(`[CharacterStyle] 风格档案 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return null;
    }

    const toStringArray = (v: any): string[] =>
      Array.isArray(v) ? v.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()) : [];
    const toString = (v: any): string => (typeof v === 'string' ? v : '');

    const profile: CharacterStyleProfile = {
      speakingStyle: toString(parsed.speakingStyle),
      vocabulary: toStringArray(parsed.vocabulary),
      sentencePatterns: toStringArray(parsed.sentencePatterns),
      emotionalExpression: toString(parsed.emotionalExpression),
      signaturePhrases: toStringArray(parsed.signaturePhrases),
      tabooPatterns: toStringArray(parsed.tabooPatterns),
      fullReport: toString(parsed.fullReport),
    };
    if (!profile.speakingStyle && !profile.fullReport) return null;
    return profile;
  }

  /**
   * 基于对话历史学习角色风格。
   */
  async learnFromDialogue(request: CharacterStyleLearningRequest): Promise<CharacterStyleResource> {
    addLog('===== 角色风格学习: learnFromDialogue 开始 =====', 'debug');
    addLog(`角色: ${request.characterCardName}, 消息数: ${request.messages.length}`, 'debug');

    const assistantCount = request.messages.filter(m => m.role === 'assistant').length;
    if (assistantCount < 3) {
      throw new Error(`对话中的角色回复过少（${assistantCount} 条，至少需要 3 条），无法进行风格学习`);
    }

    const config = await aiService.getConfig();
    const engineConfig = await aiService.getEngineConfig();

    const systemPrompt =
      '你是一个专业的语言风格分析师，擅长从对话样本中提炼说话者的语言风格特征（用词、句式、语气、口癖、情感表达方式）。请严格以 JSON 格式返回风格档案。';
    const userPrompt = this.buildLearnPrompt(request);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    addLog(`【角色风格学习】提示词总长度: ${systemPrompt.length + userPrompt.length} 字符`, 'debug');

    const rawContent = await aiService.callChatAPI(messages, {
      model: config.model,
      temperature: engineConfig.temperature,
      // EngineConfig.maxTokens 为可选字段，缺省回退默认值（settingDefaults 单一来源）
      maxTokens: engineConfig.maxTokens ?? DEFAULT_ENGINE_PARAMS.maxTokens,
      timeoutMs: STYLE_LEARN_TIMEOUT,
    });

    const profile = this.parseProfileResponse(rawContent);
    if (!profile) {
      const resource: CharacterStyleResource = {
        id: `style_${Date.now()}`,
        characterCardId: request.characterCardId,
        characterCardName: request.characterCardName,
        source: 'dialogue',
        messageCount: assistantCount,
        profile: null,
        createdAt: Date.now(),
        status: 'failed',
        error: 'AI 返回的风格档案解析失败，请重试',
      };
      this.saveResource(resource);
      return resource;
    }

    const resource: CharacterStyleResource = {
      id: `style_${Date.now()}`,
      characterCardId: request.characterCardId,
      characterCardName: request.characterCardName,
      source: 'dialogue',
      messageCount: assistantCount,
      profile,
      createdAt: Date.now(),
      status: 'completed',
    };
    this.saveResource(resource);

    addLog(`角色风格学习完成: 角色=${request.characterCardName}, 样本=${assistantCount} 条`, 'info');
    return resource;
  }

  private saveResource(resource: CharacterStyleResource): void {
    try {
      fs.writeFileSync(this.styleFile(resource.characterCardId), JSON.stringify(resource, null, 2), 'utf-8');
    } catch (error) {
      addLog(`[CharacterStyle] 保存风格档案失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /**
   * 列出全部角色的风格档案。
   */
  list(): CharacterStyleResource[] {
    try {
      const dir = this.getStylesDir();
      const results: CharacterStyleResource[] = [];
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          if (raw && typeof raw.characterCardId === 'string') {
            results.push(raw as CharacterStyleResource);
          }
        } catch {
          // 跳过损坏文件
        }
      }
      results.sort((a, b) => b.createdAt - a.createdAt);
      return results;
    } catch (error) {
      addLog(`[CharacterStyle] 列出风格档案失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return [];
    }
  }

  /**
   * 获取指定角色的风格档案。
   */
  get(characterCardId: string): CharacterStyleResource | null {
    try {
      const file = this.styleFile(characterCardId);
      if (!fs.existsSync(file)) return null;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return raw && typeof raw.characterCardId === 'string' ? (raw as CharacterStyleResource) : null;
    } catch (error) {
      addLog(`[CharacterStyle] 读取风格档案失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return null;
    }
  }

  /**
   * 删除指定角色的风格档案。
   */
  delete(characterCardId: string): boolean {
    try {
      const file = this.styleFile(characterCardId);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      return true;
    } catch (error) {
      addLog(`[CharacterStyle] 删除风格档案失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return false;
    }
  }
}

export const characterStyleLearningService = new CharacterStyleLearningService();
