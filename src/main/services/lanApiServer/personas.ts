/**
 * LAN API 人设目录共享模块（Spec: fix-android-chat-feature-parity / Task 1 + 2）
 *
 * 扫描 avatarService 人设目录（与桌面端 PersonaPanel 同源同过滤规则：排除 user-profile.json），
 * 供 server.ts（/api/personas 端点）与 dialogue.ts（人设注入）复用，避免两处扫描逻辑漂移。
 */

import { avatarService } from '../avatarService';
import type { UserPersona } from '../../../renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types';

/** 完整人设记录（桌面端 UserPersona 结构 + 便捷字段） */
export interface PersonaRecord {
  /** 人设 ID（content.id 或文件名去后缀） */
  id: string;
  name: string;
  description: string;
  isGeneric: boolean;
  isSystem: boolean;
  /** 头像文件绝对路径（未设置为 null） */
  avatarPath: string | null;
  /** 可直接传给 PromptBuilder.buildPersonaSection 的人设对象 */
  persona: UserPersona;
}

/** 扫描人设目录并解析全部人设记录 */
export async function listPersonaRecords(): Promise<PersonaRecord[]> {
  const files = await avatarService.listAvatars();
  const records: PersonaRecord[] = [];
  for (const f of files) {
    if (!f.name.endsWith('.json') || f.path.includes('user-profile.json')) continue;
    const content = await avatarService.readAvatar(f.path);
    if (!content || typeof content !== 'object') continue;
    const c = content as Record<string, unknown>;
    const id = String(c.id || f.name.replace(/\.json$/, ''));
    const name = String(c.name || '未命名');
    const description = String(c.description || '');
    const isGeneric = c.isGeneric === true;
    const isSystem = c.isSystem === true;
    const avatarPath = typeof c.avatarPath === 'string' && c.avatarPath ? c.avatarPath : null;
    records.push({
      id,
      name,
      description,
      isGeneric,
      isSystem,
      avatarPath,
      persona: {
        id,
        name,
        description,
        avatarPath: avatarPath || '',
        createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
        updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
        isGeneric,
        isSystem,
      },
    });
  }
  // 通用人设排在第一位（对齐桌面端排序）
  records.sort((a, b) => (a.isGeneric === b.isGeneric ? 0 : a.isGeneric ? -1 : 1));
  return records;
}

/** 按 ID 查找人设（找不到返回 null，不抛异常） */
export async function findPersonaById(personaId: string | null): Promise<PersonaRecord | null> {
  if (!personaId) return null;
  const records = await listPersonaRecords();
  return records.find(r => r.id === personaId) || null;
}
