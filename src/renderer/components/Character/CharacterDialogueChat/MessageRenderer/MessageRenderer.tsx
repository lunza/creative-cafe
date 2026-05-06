import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkEmoji from 'remark-emoji';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

import type { MessageRendererProps } from './MessageRenderer.types';
import { DEFAULT_RENDER_CONFIG, mergeConfig } from './MessageRenderer.config';
import { processMessage } from '../utils/messageProcessor';
import { createSanitizeSchema } from '../utils/sanitizeConfig';
import { remarkUnderscoreItalic } from '../utils/plugins/remark-underscore-italic';
import { remarkTableCellRawHtml } from '../utils/plugins/remark-table-cell-raw-html';
import { rehypeInlineHtmlParse } from '../utils/plugins/rehype-inline-html-parse';
import { rehypeQuoteNormalize } from '../utils/plugins/rehype-quote-normalize';
import { rehypeQuoteHighlight } from '../utils/plugins/rehype-quote-highlight';
import { rehypeCodeHighlight } from '../utils/plugins/rehype-code-highlight';
import { rehypeStyleProcessor } from '../utils/plugins/rehype-style-processor';

import './MessageRenderer.styles.css';

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    lineHeight: '1.7',
    color: 'inherit',
    fontSize: 'inherit',
    wordBreak: 'break-word',
    whiteSpace: 'normal',
  },
  h1: { fontSize: '1.5rem', fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' },
  h2: { fontSize: '1.3rem', fontWeight: 600, marginTop: '0.9rem', marginBottom: '0.45rem' },
  h3: { fontSize: '1.15rem', fontWeight: 600, marginTop: '0.8rem', marginBottom: '0.4rem' },
  h4: { fontSize: '1.05rem', fontWeight: 600, marginTop: '0.7rem', marginBottom: '0.35rem' },
  h5: { fontSize: '1rem', fontWeight: 600, marginTop: '0.6rem', marginBottom: '0.3rem' },
  h6: { fontSize: '0.95rem', fontWeight: 600, marginTop: '0.5rem', marginBottom: '0.25rem' },
  p: { marginTop: '0.3rem', marginBottom: '0.6rem' },
  a: { color: '#1890ff', textDecoration: 'underline' },
  img: { maxWidth: '100%', height: 'auto', borderRadius: '4px', marginTop: '0.5rem', marginBottom: '0.5rem' },
  pre: { backgroundColor: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', overflowX: 'auto', marginTop: '0.5rem', marginBottom: '0.5rem' },
  codeBlock: { fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '0.9rem' },
  codeInline: { backgroundColor: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '3px', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '0.9em' },
  blockquote: { borderLeft: '4px solid #4a9eff', paddingLeft: '12px', color: 'inherit', fontStyle: 'italic', marginTop: '0.5rem', marginBottom: '0.5rem', backgroundColor: 'rgba(74,158,255,0.05)', borderRadius: '0 4px 4px 0' },
  ul: { paddingLeft: '1.5rem', marginTop: '0.3rem', marginBottom: '0.6rem' },
  ol: { paddingLeft: '1.5rem', marginTop: '0.3rem', marginBottom: '0.6rem' },
  li: { marginBottom: '0.25rem' },
  tableContainer: { overflowX: 'auto', margin: '0.5rem 0', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  thead: { backgroundColor: 'rgba(0,0,0,0.2)' },
  tbody: { backgroundColor: 'transparent' },
  tr: { borderBottom: '1px solid rgba(255,255,255,0.1)' },
  th: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)' },
  td: { padding: '8px 12px', textAlign: 'left', border: '1px solid rgba(255,255,255,0.1)' },
  hr: { border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '1rem 0' },
  del: { color: 'inherit', textDecoration: 'line-through', opacity: 0.7 },
  ins: { color: '#52c41a', textDecoration: 'underline' },
  sup: { fontSize: '0.75em', verticalAlign: 'super' },
  sub: { fontSize: '0.75em', verticalAlign: 'sub' },
  strong: { fontWeight: 600 },
  em: { fontStyle: 'italic' },
};

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  content,
  charName = '',
  userName = 'User',
  config,
  className = '',
  style,
  onLinkClick,
  onImageClick,
}) => {
  const mergedConfig = useMemo(() => {
    return mergeConfig(DEFAULT_RENDER_CONFIG, config);
  }, [config]);

  const processedContent = useMemo(() => {
    return processMessage(content, {
      charName,
      userName,
      charPlaceholder: mergedConfig.template.charPlaceholder,
      userPlaceholder: mergedConfig.template.userPlaceholder,
      normalizeQuotes: false,
      encodeAngleBrackets: false,
    });
  }, [content, charName, userName, mergedConfig.template]);

  const sanitizeSchema = useMemo(() => {
    if (mergedConfig.sanitizeSchema) {
      return mergedConfig.sanitizeSchema;
    }
    return createSanitizeSchema({
      level: mergedConfig.html.sanitizeLevel,
      customTags: mergedConfig.html.customTags,
      customAttributes: mergedConfig.html.customAttributes,
    });
  }, [mergedConfig.sanitizeSchema, mergedConfig.html]);

  const remarkPlugins = useMemo(() => {
    const plugins: any[] = [];

    // GFM MUST run first to parse tables, strikethrough, etc.
    // remarkTableCellRawHtml runs after to handle inline HTML in table cells
    if (mergedConfig.markdown.enableGFM) {
      plugins.push(remarkGfm);
    }

    plugins.push(remarkTableCellRawHtml);

    if (mergedConfig.markdown.enableEmoji) {
      plugins.push(remarkEmoji);
    }

    if (mergedConfig.markdown.enableUnderscoreItalic) {
      plugins.push(remarkUnderscoreItalic);
    }

    return plugins;
  }, [mergedConfig.markdown]);

  const rehypePlugins = useMemo(() => {
    const plugins: any[] = [];

    if (mergedConfig.html.allowRawHTML) {
      plugins.push(rehypeRaw);
    }

    plugins.push(rehypeInlineHtmlParse);

    plugins.push([rehypeSanitize, sanitizeSchema]);

    if (mergedConfig.markdown.enableQuoteNormalize) {
      plugins.push(rehypeQuoteNormalize);
    }

    plugins.push(rehypeQuoteHighlight);

    if (mergedConfig.style.codeHighlight) {
      plugins.push(rehypeCodeHighlight);
    }

    plugins.push(rehypeStyleProcessor);

    return plugins;
  }, [mergedConfig, sanitizeSchema]);

  const components = useMemo(() => ({
    h1: ({ ...props }: any) => <h1 style={styles.h1} {...props} />,
    h2: ({ ...props }: any) => <h2 style={styles.h2} {...props} />,
    h3: ({ ...props }: any) => <h3 style={styles.h3} {...props} />,
    h4: ({ ...props }: any) => <h4 style={styles.h4} {...props} />,
    h5: ({ ...props }: any) => <h5 style={styles.h5} {...props} />,
    h6: ({ ...props }: any) => <h6 style={styles.h6} {...props} />,
    p: ({ ...props }: any) => <p style={styles.p} {...props} />,
    a: ({ href, children, ...props }: any) => (
      <a
        href={href}
        onClick={(e: React.MouseEvent) => onLinkClick?.(href || '', e)}
        target="_blank"
        rel="noopener noreferrer"
        style={styles.a}
        {...props}
      >
        {children}
      </a>
    ),
    img: ({ src, alt, ...props }: any) => (
      <img
        src={src}
        alt={alt || ''}
        onClick={(e: React.MouseEvent) => onImageClick?.(src || '', e)}
        loading="lazy"
        style={styles.img}
        {...props}
      />
    ),
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match;

      if (isInline) {
        return (
          <code style={styles.codeInline} {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="message-renderer-code-block" style={{ margin: '0.75em 0', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'rgba(0,0,0,0.2)', fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
            <span style={{ fontFamily: 'Consolas, Monaco, monospace', textTransform: 'lowercase' }}>{match?.[1] || 'code'}</span>
            <button
              style={{ padding: '2px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.6)', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer' }}
              onClick={(e) => {
                e.preventDefault();
                navigator.clipboard?.writeText(String(children).replace(/\n$/, ''));
              }}
              title="复制代码"
            >
              复制
            </button>
          </div>
          <pre style={styles.pre}>
            <code style={styles.codeBlock} {...props}>{children}</code>
          </pre>
        </div>
      );
    },
    blockquote: ({ children, ...props }: any) => (
      <blockquote style={styles.blockquote} {...props}>
        {children}
      </blockquote>
    ),
    ul: ({ ...props }: any) => <ul style={styles.ul} {...props} />,
    ol: ({ ...props }: any) => <ol style={styles.ol} {...props} />,
    li: ({ ...props }: any) => <li style={styles.li} {...props} />,
    table: ({ children, ...props }: any) => (
      <div style={styles.tableContainer}>
        <table style={styles.table} {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ ...props }: any) => <thead style={styles.thead} {...props} />,
    tbody: ({ ...props }: any) => <tbody style={styles.tbody} {...props} />,
    tr: ({ ...props }: any) => <tr style={styles.tr} {...props} />,
    th: ({ ...props }: any) => <th style={styles.th} {...props} />,
    td: ({ ...props }: any) => <td style={styles.td} {...props} />,
    hr: ({ ...props }: any) => <hr style={styles.hr} {...props} />,
    del: ({ ...props }: any) => <del style={styles.del} {...props} />,
    s: ({ ...props }: any) => <s style={styles.del} {...props} />,
    ins: ({ ...props }: any) => <ins style={styles.ins} {...props} />,
    sup: ({ ...props }: any) => <sup style={styles.sup} {...props} />,
    sub: ({ ...props }: any) => <sub style={styles.sub} {...props} />,
    strong: ({ ...props }: any) => <strong style={styles.strong} {...props} />,
    em: ({ ...props }: any) => <em style={styles.em} {...props} />,
  }), [onLinkClick, onImageClick]);

  return (
    <div
      className={`message-renderer ${className}`}
      style={{ ...styles.container, ...style }}
      data-theme={mergedConfig.style.theme}
    >
      <div className="message-renderer-content">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
      {mergedConfig.style.customCSS && (
        <style dangerouslySetInnerHTML={{ __html: mergedConfig.style.customCSS }} />
      )}
    </div>
  );
};

export default MessageRenderer;
