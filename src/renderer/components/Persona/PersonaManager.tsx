// Avatar → Persona 渐进式重命名
// 此文件提供向后兼容的别名，方便逐步迁移
// 最终将移除 AvatarManager，统一使用 PersonaManager

export { AvatarManager as PersonaManager } from './AvatarManager';
export type { UserAvatarProfile as PersonaProfile } from './AvatarManager.types';
