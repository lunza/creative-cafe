export enum ActivationStrategy {
  NATURAL = 0,
  LIST = 1,
  POOLED = 3,
}

export enum GenerationMode {
  SWAP = 0,
  APPEND = 1,
  APPEND_DISABLED = 2,
}

export interface Group {
  id: string;
  name: string;
  members: string[];
  avatar_url: string;
  allow_self_responses: boolean;
  activation_strategy: ActivationStrategy;
  generation_mode: GenerationMode;
  disabled_members: string[];
  fav: boolean;
  chat_id: string;
  chats: string[];
  auto_mode_delay: number;
  generation_mode_join_prefix: string;
  generation_mode_join_suffix: string;
  hideMutedSprites: boolean;
  date_added: number;
  create_date: string;
  date_last_chat: number;
  chat_size: number;
}

export interface GroupChatMessage {
  id: string;
  name: string;
  is_user: boolean;
  is_system: boolean;
  send_date: string;
  mes: string;
  original_avatar?: string;
  force_avatar?: string;
  extra?: {
    gen_id?: number;
    display_text?: string;
    type?: string;
  };
}

export interface GroupChatHeader {
  chat_metadata: {
    integrity: string;
    tainted?: boolean;
    [key: string]: any;
  };
  user_name: string;
  character_name: string;
}

export interface GroupSessionConfig {
  characterCardId: string;
  characterCardName: string;
  temperature: number;
  maxTokens: number;
  contextLength: number;
  systemPrompt: string;
  stream: boolean;
}
