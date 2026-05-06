import { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';

const DEFAULT_ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup',
  'blockquote', 'q', 'cite',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'img',
  'pre', 'code',
  'hr',
  'br',
  'div', 'span', 'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'font',
];

const DEFAULT_ALLOWED_ATTRIBUTES: Schema['attributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  table: ['border', 'cellpadding', 'cellspacing'],
  '*': ['class', 'style', 'id'],
};

const DEFAULT_ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];

const DEFAULT_ANNOTATIONS = ['data-*'];

export type SanitizeLevel = 'strict' | 'moderate' | 'loose';

export interface SanitizeConfigOptions {
  level?: SanitizeLevel;
  customTags?: string[];
  customAttributes?: Record<string, string[]>;
  customProtocols?: string[];
}

function createStrictSchema(): Schema {
  return {
    ...defaultSchema,
    tagNames: DEFAULT_ALLOWED_TAGS,
    attributes: DEFAULT_ALLOWED_ATTRIBUTES,
    protocols: {
      ...defaultSchema.protocols,
      href: DEFAULT_ALLOWED_PROTOCOLS,
      src: DEFAULT_ALLOWED_PROTOCOLS,
    },
    clobberPrefix: 'user-content-',
    clobber: ['name', 'id'],
    allowComments: false,
  };
}

function createModerateSchema(): Schema {
  const attrs: Schema['attributes'] = {
    ...DEFAULT_ALLOWED_ATTRIBUTES,
    details: ['open'],
    '*': ['class', 'style', 'id', 'data-*'],
  };
  return {
    ...defaultSchema,
    tagNames: [
      ...DEFAULT_ALLOWED_TAGS,
      'details', 'summary',
      'abbr', 'acronym', 'dfn', 'kbd', 'samp', 'var',
      'figure', 'figcaption',
    ],
    attributes: attrs,
    protocols: {
      ...defaultSchema.protocols,
      href: DEFAULT_ALLOWED_PROTOCOLS,
      src: [...DEFAULT_ALLOWED_PROTOCOLS, 'data'],
    },
    clobberPrefix: 'user-content-',
    clobber: ['name', 'id'],
    allowComments: false,
  };
}

function createLooseSchema(): Schema {
  const attrs: Schema['attributes'] = {
    ...DEFAULT_ALLOWED_ATTRIBUTES,
    details: ['open'],
    video: ['controls', 'autoplay', 'loop', 'muted', 'poster', 'preload'],
    audio: ['controls', 'autoplay', 'loop', 'muted', 'preload'],
    source: ['src', 'type'],
    track: ['kind', 'src', 'srclang', 'label', 'default'],
    '*': ['class', 'style', 'id', 'data-*'],
  };
  return {
    ...defaultSchema,
    tagNames: [
      ...DEFAULT_ALLOWED_TAGS,
      'details', 'summary',
      'abbr', 'acronym', 'dfn', 'kbd', 'samp', 'var',
      'figure', 'figcaption',
      'audio', 'video', 'source', 'track',
      'ruby', 'rt', 'rp', 'bdi', 'bdo',
      'wbr',
    ],
    attributes: attrs,
    protocols: {
      ...defaultSchema.protocols,
      href: [...DEFAULT_ALLOWED_PROTOCOLS, 'ftp'],
      src: [...DEFAULT_ALLOWED_PROTOCOLS, 'data', 'blob'],
    },
    clobberPrefix: 'user-content-',
    clobber: ['name', 'id'],
    allowComments: false,
  };
}

const SCHEMA_FACTORIES: Record<SanitizeLevel, () => Schema> = {
  strict: createStrictSchema,
  moderate: createModerateSchema,
  loose: createLooseSchema,
};

export function createSanitizeSchema(options: SanitizeConfigOptions = {}): Schema {
  const {
    level = 'moderate',
    customTags = [],
    customAttributes = {},
    customProtocols = [],
  } = options;

  const factory = SCHEMA_FACTORIES[level] || SCHEMA_FACTORIES.moderate;
  const schema = factory();

  if (customTags.length > 0) {
    schema.tagNames = [...(schema.tagNames || []), ...customTags];
  }

  if (customAttributes) {
    schema.attributes = {
      ...(schema.attributes || {}),
      ...customAttributes,
    };
  }

  if (customProtocols.length > 0) {
    const protocols = { ...(schema.protocols || {}) };
    for (const [key, values] of Object.entries(protocols)) {
      if (Array.isArray(values)) {
        protocols[key as keyof typeof protocols] = [...values, ...customProtocols];
      }
    }
    schema.protocols = protocols;
  }

  return schema;
}

export const sanitizeConfig = {
  strict: createStrictSchema(),
  moderate: createModerateSchema(),
  loose: createLooseSchema(),
};

export {
  DEFAULT_ALLOWED_TAGS,
  DEFAULT_ALLOWED_ATTRIBUTES,
  DEFAULT_ALLOWED_PROTOCOLS,
  DEFAULT_ANNOTATIONS,
};
