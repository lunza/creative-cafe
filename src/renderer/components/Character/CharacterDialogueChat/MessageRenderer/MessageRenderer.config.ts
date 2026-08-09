import type { Schema } from 'hast-util-sanitize';

export interface RenderConfig {
  markdown: {
    enableGFM: boolean;
    enableUnderscoreItalic: boolean;
    enableQuoteNormalize: boolean;
    enableEmoji: boolean;
    /** 显示思考过程：true=保留为折叠 details 块，false=移除（默认） */
    showThinking?: boolean;
  };
  
  html: {
    allowRawHTML: boolean;
    sanitizeLevel: 'strict' | 'moderate' | 'loose';
    customTags?: string[];
    customAttributes?: Record<string, string[]>;
  };
  
  style: {
    theme: 'default' | 'dark' | 'light' | string;
    codeHighlight: boolean;
    customCSS?: string;
  };
  
  template: {
    charPlaceholder: string;
    userPlaceholder: string;
  };

  sanitizeSchema?: Schema;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  markdown: {
    enableGFM: true,
    enableUnderscoreItalic: true,
    enableQuoteNormalize: true,
    enableEmoji: true,
  },
  html: {
    allowRawHTML: true,
    sanitizeLevel: 'moderate',
  },
  style: {
    theme: 'default',
    codeHighlight: true,
  },
  template: {
    charPlaceholder: '{{char}}',
    userPlaceholder: '{{user}}',
  },
};

export function mergeConfig(base: RenderConfig, override?: Partial<RenderConfig>): RenderConfig {
  if (!override) return base;
  
  return {
    markdown: {
      ...base.markdown,
      ...(override.markdown || {}),
    },
    html: {
      ...base.html,
      ...(override.html || {}),
    },
    style: {
      ...base.style,
      ...(override.style || {}),
    },
    template: {
      ...base.template,
      ...(override.template || {}),
    },
    sanitizeSchema: override.sanitizeSchema || base.sanitizeSchema,
  };
}
