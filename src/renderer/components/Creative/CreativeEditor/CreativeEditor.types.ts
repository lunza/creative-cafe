export interface CreativeTheme {
  genre: string;
  tone: string;
  setting: string;
  targetAudience: string;
}

export const GENRE_OPTIONS = [
  { label: '奇幻', value: 'fantasy' },
  { label: '科幻', value: 'sci-fi' },
  { label: '现代', value: 'modern' },
  { label: '古风', value: 'ancient' },
  { label: '悬疑', value: 'mystery' },
  { label: '恐怖', value: 'horror' },
  { label: '恋爱', value: 'romance' },
  { label: '冒险', value: 'adventure' },
];

export const TONE_OPTIONS = [
  { label: '轻松', value: 'lighthearted' },
  { label: '严肃', value: 'serious' },
  { label: '黑暗', value: 'dark' },
  { label: '温馨', value: 'warm' },
  { label: '搞笑', value: 'comedic' },
  { label: '悲壮', value: 'tragic' },
  { label: '神秘', value: 'mysterious' },
  { label: '热血', value: 'passionate' },
];

export interface ThemeEditorProps {
  theme?: CreativeTheme;
  onChange?: (theme: CreativeTheme) => void;
}

export interface CreativeEditorProps {
  creativeId: string | null;
  title: string;
  description: string;
  content: string;
  theme?: CreativeTheme;
  onTitleChange?: (title: string) => void;
  onDescriptionChange?: (description: string) => void;
  onContentChange?: (content: string) => void;
  onThemeChange?: (theme: CreativeTheme) => void;
  onSave?: () => void;
  onExport?: (type: 'character-card-v3' | 'worldbook-json') => void;
  isSaving?: boolean;
}
