import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkEmoji from 'remark-emoji';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

interface RichTextRendererProps {
  content: string;
  className?: string;
}

// 安全清理配置 - 只允许有限的 HTML 标签（组件外常量，避免重复创建）
const SANITIZE_SCHEMA = {
  tagNames: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
              'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'img',
              'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
              'ol', 'ul', 'li', 'pre', 'code', 'blockquote',
              'del', 's', 'ins', 'hr', 'sup', 'sub'],
  attributes: {
    '*': ['style', 'class', 'id'],
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'code': ['class'],
    'pre': ['class']
  },
  protocols: {
    'href': ['http', 'https'],
    'src': ['http', 'https', 'data']
  }
};

const RichTextRenderer: React.FC<RichTextRendererProps> = ({ content, className = '' }) => {
  // 使用 useMemo 缓存 rehypePlugins 数组，避免每次渲染创建新引用
  const rehypePlugins = useMemo(() => [
    rehypeRaw,
    [rehypeSanitize, SANITIZE_SCHEMA]
  ], []);

  const remarkPlugins = useMemo(() => [
    remarkGfm,
    remarkEmoji
  ], []);

  return (
    <div className={`rich-text-renderer ${className}`} style={styles.container}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          // 自定义组件样式
          h1: ({ ...props }) => <h1 style={styles.h1} {...props} />,
          h2: ({ ...props }) => <h2 style={styles.h2} {...props} />,
          h3: ({ ...props }) => <h3 style={styles.h3} {...props} />,
          h4: ({ ...props }) => <h4 style={styles.h4} {...props} />,
          h5: ({ ...props }) => <h5 style={styles.h5} {...props} />,
          h6: ({ ...props }) => <h6 style={styles.h6} {...props} />,
          p: ({ ...props }) => <p style={styles.p} {...props} />,
          a: ({ ...props }) => <a style={styles.a} target="_blank" rel="noopener noreferrer" {...props} />,
          img: ({ ...props }) => <img style={styles.img} loading="lazy" {...props} />,
          pre: ({ ...props }) => <pre style={styles.pre} {...props} />,
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            return match ? (
              <code className={className} style={styles.codeBlock} {...props}>{children}</code>
            ) : (
              <code style={styles.codeInline} {...props}>{children}</code>
            );
          },
          blockquote: ({ ...props }) => <blockquote style={styles.blockquote} {...props} />,
          ul: ({ ...props }) => <ul style={styles.ul} {...props} />,
          ol: ({ ...props }) => <ol style={styles.ol} {...props} />,
          li: ({ ...props }) => <li style={styles.li} {...props} />,
          table: ({ ...props }) => (
            <div style={styles.tableContainer}>
              <table style={styles.table} {...props} />
            </div>
          ),
          thead: ({ ...props }) => <thead style={styles.thead} {...props} />,
          tbody: ({ ...props }) => <tbody style={styles.tbody} {...props} />,
          tr: ({ ...props }) => <tr style={styles.tr} {...props} />,
          th: ({ ...props }) => <th style={styles.th} {...props} />,
          td: ({ ...props }) => <td style={styles.td} {...props} />,
          hr: ({ ...props }) => <hr style={styles.hr} {...props} />,
          br: ({ ...props }) => <br style={styles.br} {...props} />,
          del: ({ ...props }) => <del style={styles.del} {...props} />,
          s: ({ ...props }) => <s style={styles.del} {...props} />,
          ins: ({ ...props }) => <ins style={styles.ins} {...props} />,
          sup: ({ ...props }) => <sup style={styles.sup} {...props} />,
          sub: ({ ...props }) => <sub style={styles.sub} {...props} />,
          strong: ({ ...props }) => <strong style={styles.strong} {...props} />,
          em: ({ ...props }) => <em style={styles.em} {...props} />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

// 统一的样式
const styles: { [key: string]: React.CSSProperties } = {
  container: {
    lineHeight: '1.7',
    color: 'inherit',
    fontSize: 'inherit',
    wordBreak: 'break-word',
    whiteSpace: 'normal'
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
  pre: { backgroundColor: '#f5f5f5', padding: '12px', borderRadius: '6px', overflowX: 'auto', marginTop: '0.5rem', marginBottom: '0.5rem' },
  codeBlock: { fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '0.9rem' },
  codeInline: { backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: '3px', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '0.9em' },
  blockquote: { borderLeft: '4px solid #d9d9d9', paddingLeft: '12px', color: '#666', fontStyle: 'italic', marginTop: '0.5rem', marginBottom: '0.5rem' },
  ul: { paddingLeft: '1.5rem', marginTop: '0.3rem', marginBottom: '0.6rem' },
  ol: { paddingLeft: '1.5rem', marginTop: '0.3rem', marginBottom: '0.6rem' },
  li: { marginBottom: '0.25rem' },
  tableContainer: { overflowX: 'auto', margin: '0.5rem 0' },
  table: { width: '100%', borderCollapse: 'collapse', border: '1px solid #e8e8e8', fontSize: '0.9rem' },
  thead: { backgroundColor: '#fafafa' },
  tbody: { backgroundColor: '#fff' },
  tr: { borderBottom: '1px solid #e8e8e8' },
  th: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, border: '1px solid #e8e8e8' },
  td: { padding: '8px 12px', textAlign: 'left', border: '1px solid #e8e8e8' },
  hr: { border: 'none', borderTop: '1px solid #e8e8e8', margin: '1rem 0' },
  br: { marginBottom: '0.25rem' },
  del: { color: '#666', textDecoration: 'line-through' },
  ins: { color: '#52c41a', textDecoration: 'underline' },
  sup: { fontSize: '0.75em', verticalAlign: 'super' },
  sub: { fontSize: '0.75em', verticalAlign: 'sub' },
  strong: { fontWeight: 600 },
  em: { fontStyle: 'italic' }
};

export default RichTextRenderer;
