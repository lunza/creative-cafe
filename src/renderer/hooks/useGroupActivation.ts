import { ActivationStrategy } from '../types/groupChat.types';

export interface ActivationCandidate {
  name: string;
  lastSpeakerOrder: number;
  talkativeness?: number;
}

function extractMentionedCharacter(messageContent: string, memberNames: string[]): string | null {
  const normalizedContent = messageContent.toLowerCase();
  for (const name of memberNames) {
    const normalizedName = name.toLowerCase();
    if (normalizedContent.includes(`@${normalizedName}`) || normalizedContent.includes(normalizedName)) {
      return name;
    }
  }
  return null;
}

function selectByTalkativeness(candidates: ActivationCandidate[]): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].name;

  const totalTalkativeness = candidates.reduce((sum, c) => sum + (c.talkativeness || 1), 0);
  let random = Math.random() * totalTalkativeness;

  for (const candidate of candidates) {
    random -= candidate.talkativeness || 1;
    if (random <= 0) return candidate.name;
  }

  return candidates[candidates.length - 1].name;
}

function selectRandomFromPool(candidates: ActivationCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex].name;
}

export function activateNaturalOrder(
  messageContent: string,
  members: ActivationCandidate[],
  lastSpeakerName: string | null,
  talkativenessEnabled: boolean
): string | null {
  if (members.length === 0) return null;

  const memberNames = members.map((m) => m.name);
  const mentioned = extractMentionedCharacter(messageContent, memberNames);
  if (mentioned) {
    return mentioned;
  }

  if (talkativenessEnabled) {
    const candidates = members.filter((m) => m.name !== lastSpeakerName);
    if (candidates.length > 0) {
      return selectByTalkativeness(candidates);
    }
  }

  const candidates = members.filter((m) => m.name !== lastSpeakerName);
  if (candidates.length > 0) {
    return selectRandomFromPool(candidates);
  }

  return selectRandomFromPool(members);
}

export function activateListOrder(
  members: ActivationCandidate[],
  lastIndex: number
): { name: string | null; nextIndex: number } {
  if (members.length === 0) return { name: null, nextIndex: 0 };

  const nextIndex = (lastIndex + 1) % members.length;
  return { name: members[nextIndex].name, nextIndex };
}

export function activatePooledOrder(
  members: ActivationCandidate[],
  lastSpeakerName: string | null,
  spokenMembers: Set<string>
): string | null {
  if (members.length === 0) return null;

  const unspoken = members.filter((m) => !spokenMembers.has(m.name) && m.name !== lastSpeakerName);

  if (unspoken.length > 0) {
    return selectRandomFromPool(unspoken);
  }

  const available = members.filter((m) => m.name !== lastSpeakerName);
  if (available.length > 0) {
    return selectRandomFromPool(available);
  }

  return selectRandomFromPool(members);
}

export function selectNextSpeaker(
  strategy: ActivationStrategy,
  messageContent: string,
  members: ActivationCandidate[],
  lastSpeakerName: string | null,
  lastListIndex: number,
  spokenMembers: Set<string>,
  talkativenessEnabled: boolean
): { name: string | null; nextListIndex: number } {
  switch (strategy) {
    case ActivationStrategy.NATURAL: {
      const name = activateNaturalOrder(messageContent, members, lastSpeakerName, talkativenessEnabled);
      return { name, nextListIndex: lastListIndex };
    }
    case ActivationStrategy.LIST: {
      const { name, nextIndex } = activateListOrder(members, lastListIndex);
      return { name, nextListIndex: nextIndex };
    }
    case ActivationStrategy.POOLED: {
      const name = activatePooledOrder(members, lastSpeakerName, spokenMembers);
      return { name, nextListIndex: lastListIndex };
    }
    default: {
      const name = activateNaturalOrder(messageContent, members, lastSpeakerName, talkativenessEnabled);
      return { name, nextListIndex: lastListIndex };
    }
  }
}
