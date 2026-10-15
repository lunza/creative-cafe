/**
 * 【Phase 4 / L5 - conversation-mode-optimization-report】角色风格学习类型。
 *
 * 参考实现：写作模式 WritingStyleLearningService（风格学习 → 风格资源）。
 * 对话模式差异：学习素材是**对话历史**（AI 回复为主）而非上传文本文件，
 * 学习产物按角色卡持久化（一角色一份最新风格档案，可覆盖重学）。
 */

/** 角色语言风格档案 */
export interface CharacterStyleProfile {
  /** 说话风格总述（语气、节奏、态度） */
  speakingStyle: string;
  /** 高频词汇与短语 */
  vocabulary: string[];
  /** 句式特征（长短句、反问、省略等） */
  sentencePatterns: string[];
  /** 情感表达方式（如何表达喜怒哀乐） */
  emotionalExpression: string;
  /** 口癖与标志性短语 */
  signaturePhrases: string[];
  /** 明显不会使用的表达（负向风格约束） */
  tabooPatterns: string[];
  /** 完整学习报告（可读文本） */
  fullReport: string;
}

export type CharacterStyleStatus = 'completed' | 'failed';

/** 角色风格学习资源（按角色卡一份） */
export interface CharacterStyleResource {
  id: string;
  characterCardId: string;
  characterCardName: string;
  /** 学习素材来源（当前仅对话历史） */
  source: 'dialogue';
  /** 参与学习的消息条数 */
  messageCount: number;
  profile: CharacterStyleProfile | null;
  createdAt: number;
  status: CharacterStyleStatus;
  error?: string;
}

/** 风格学习请求中的单条消息引用 */
export interface CharacterStyleMessageRef {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  speakerName?: string;
}

/** 风格学习请求 */
export interface CharacterStyleLearningRequest {
  characterCardId: string;
  characterCardName: string;
  /** 角色卡设定（风格学习的基准参考） */
  characterCard: {
    description: string;
    personality: string;
    mesExample: string;
  };
  /** 对话历史消息（服务内部会筛选 AI 回复并采样） */
  messages: CharacterStyleMessageRef[];
}
