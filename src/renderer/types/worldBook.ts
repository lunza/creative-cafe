export interface WorldBookCharacterFilter {
  isExclude: boolean;
  names: string[];
  tags: string[];
}

export interface WorldBookEntryExtensions {
  depth: number;
  weight: number;
  addMemo: boolean;
  displayIndex: number;
  useProbability: boolean;
  characterFilter: WorldBookCharacterFilter | null;
  excludeRecursion: boolean;
}

export interface WorldBookEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  keys: string[];
  secondary_keys: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  order: number;
  position: number;
  disable: boolean;
  displayIndex: number;
  addMemo: boolean;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  sticky: number;
  cooldown: number;
  delay: number;
  probability: number;
  depth: number;
  useProbability: boolean;
  role: null | any;
  vectorized: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  automationId: string;
  tags: string[];
  selectiveLogic: number;
  ignoreBudget: boolean;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  outletName: string;
  triggers: any[];
  characterFilter: WorldBookCharacterFilter;
  id: number;
  priority: number;
  insertion_order: number;
  enabled: boolean;
  name: string;
  extensions: WorldBookEntryExtensions;
}

export interface WorldBookExport {
  name: string;
  description: string;
  entries: Record<string, WorldBookEntry>;
}

export interface WorldBookMeta {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

export interface WorldBookData {
  name: string;
  description: string;
  entries: Record<string, WorldBookEntry>;
  is_creation?: boolean;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, any>;
}

export interface WorldBookTag {
  id: string;
  name: string;
  color: string;
}

export interface WorldBookTagAssociation {
  tagId: string;
  entryUid: string | number;
}

export interface WorldBookTagData {
  tags: WorldBookTag[];
  associations: WorldBookTagAssociation[];
}
