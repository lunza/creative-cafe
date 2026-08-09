/**
 * 渲染系统 — RenderSystem
 *
 * Spec: redesign-dialogue-pipeline-architecture / RenderSystem
 *
 * 与管线逻辑分离的渲染系统，支持自定义渲染规则和多端适配。
 * 职责：
 * 1. preprocess — 在 ReactMarkdown 解析前清理和规范化内容
 * 2. getMarkdownConfig — 返回 remark/rehype 插件链和组件映射
 * 3. registerComponent / getRegisteredComponents — 自定义渲染组件注册
 *
 * 预处理管线：
 *   content → replaceTemplates → processThinkTags → stripSystemTags → normalizeQuotes → [encodeAngleBrackets]
 */

import type React from 'react';
import type { RenderOptions } from './pipeline.types';

// 从现有 messageProcessor 导入预处理函数（不重新实现）
import {
  replaceTemplates,
  stripThinkingTags,
  convertThinkingTags,
  stripSystemTags,
  normalizeQuotes,
  encodeAngleBrackets,
} from '../utils/messageProcessor';

// 从现有 sanitizeConfig 导入消毒 schema 工厂
import { createSanitizeSchema } from '../utils/sanitizeConfig';

// remark 插件
import remarkGfm from 'remark-gfm';
import remarkEmoji from 'remark-emoji';
import { remarkTableCellRawHtml } from '../utils/plugins/remark-table-cell-raw-html';
import { remarkUnderscoreItalic } from '../utils/plugins/remark-underscore-italic';

// rehype 插件
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { rehypeInlineHtmlParse } from '../utils/plugins/rehype-inline-html-parse';
import { rehypeQuoteNormalize } from '../utils/plugins/rehype-quote-normalize';
import { rehypeQuoteHighlight } from '../utils/plugins/rehype-quote-highlight';
import { rehypeCodeHighlight } from '../utils/plugins/rehype-code-highlight';
import { rehypeStyleProcessor } from '../utils/plugins/rehype-style-processor';

// ===== 渲染组件样式常量 =====

/** 组件内联样式表 — 迁移自 MessageRenderer.tsx */
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
  a: { color: 'var(--mr-link, #4a9eff)', textDecoration: 'underline' },
  img: { maxWidth: '100%', height: 'auto', borderRadius: '4px', marginTop: '0.5rem', marginBottom: '0.5rem' },
  pre: { backgroundColor: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', overflowX: 'auto', marginTop: '0.5rem', marginBottom: '0.5rem' },
  codeBlock: { fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '0.9rem' },
  codeInline: { backgroundColor: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '3px', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '0.9em' },
  blockquote: { borderLeft: '4px solid var(--mr-blockquote-border, #4a9eff)', paddingLeft: '12px', color: 'inherit', fontStyle: 'italic', marginTop: '0.5rem', marginBottom: '0.5rem', backgroundColor: 'var(--mr-blockquote-bg, rgba(74,158,255,0.05))', borderRadius: '0 4px 4px 0' },
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

export class RenderSystem {
  /** 自定义渲染组件映射（tag → 组件） */
  private customComponents: Map<string, React.ComponentType<any>> = new Map();

  /**
   * 预处理：在 ReactMarkdown 解析前清理和规范化内容。
   *
   * 预处理管线（按顺序执行）：
   * 1. replaceTemplates — 模板占位符替换（{{char}} / {{user}}）
   * 2. processThinkTags — Think 标签处理（showThinking=true 时保留为折叠块，否则剥离）
   * 3. stripSystemTags — 始终剥离系统控制标签（expression/options 等）
   * 4. normalizeQuotes — 引号规范化（可选）
   * 5. encodeAngleBrackets — 尖括号编码（可选）
   *
   * @param content 原始内容
   * @param options 渲染配置
   * @returns 预处理后的内容
   */
  preprocess(content: string, options: RenderOptions): string {
    if (!content) return '';

    let result = content;

    // 1. 模板替换
    result = replaceTemplates(result, {
      charName: options.charName ?? '',
      userName: options.userName ?? 'User',
      charPlaceholder: options.charPlaceholder ?? '{{char}}',
      userPlaceholder: options.userPlaceholder ?? '{{user}}',
    });

    // 2. Think 标签处理：showThinking=true 时保留为折叠 details 块，否则剥离
    if (options.showThinking) {
      result = convertThinkingTags(result);
    } else {
      result = stripThinkingTags(result);
    }

    // 3. 始终剥离系统控制标签（expression/options 等），防止 rehypeRaw 解析损坏
    result = stripSystemTags(result);

    // 4. 引号规范化（可选）
    if (options.normalizeQuotes) {
      result = normalizeQuotes(result);
    }

    // 5. 尖括号编码（可选）
    if (options.encodeAngleBrackets) {
      result = encodeAngleBrackets(result);
    }

    return result;
  }

  /**
   * 获取 ReactMarkdown 配置（插件链 + 组件映射）。
   * 根据 options 动态构建 remark/rehype 插件链，
   * 合并默认组件映射与自定义注册组件。
   *
   * @param options 渲染配置
   * @returns { remarkPlugins, rehypePlugins, components }
   */
  getMarkdownConfig(options: RenderOptions): {
    remarkPlugins: any[];
    rehypePlugins: any[];
    components: Record<string, React.ComponentType<any>>;
  } {
    // ===== 构建 remark 插件链 =====
    const remarkPlugins: any[] = [];

    // GFM 必须先运行（解析表格、删除线等），remarkTableCellRawHtml 在其后处理表格单元格内联 HTML
    if (options.enableGFM !== false) {
      remarkPlugins.push(remarkGfm);
    }

    remarkPlugins.push(remarkTableCellRawHtml);

    if (options.enableEmoji !== false) {
      remarkPlugins.push(remarkEmoji);
    }

    if (options.enableUnderscoreItalic !== false) {
      remarkPlugins.push(remarkUnderscoreItalic);
    }

    // ===== 构建 rehype 插件链 =====
    const rehypePlugins: any[] = [];

    if (options.allowRawHTML !== false) {
      rehypePlugins.push(rehypeRaw);
    }

    rehypePlugins.push(rehypeInlineHtmlParse);

    // 消毒 schema 根据 sanitizeLevel 构建
    const sanitizeSchema = createSanitizeSchema({
      level: options.sanitizeLevel ?? 'moderate',
    });
    rehypePlugins.push([rehypeSanitize, sanitizeSchema]);

    if (options.enableQuoteNormalize !== false) {
      rehypePlugins.push(rehypeQuoteNormalize);
    }

    rehypePlugins.push(rehypeQuoteHighlight);

    if (options.codeHighlight !== false) {
      rehypePlugins.push(rehypeCodeHighlight);
    }

    rehypePlugins.push(rehypeStyleProcessor);

    // ===== 构建组件映射 =====
    const components: Record<string, React.ComponentType<any>> = {
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
                onClick={(e: React.MouseEvent) => {
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
      // 动作描写渲染：*text* → <em> → 紫色斜体样式
      em: ({ ...props }: any) => <em className="message-renderer-action" {...props} />,
    };

    // 合并自定义注册组件（覆盖默认组件）
    for (const [tag, component] of this.customComponents) {
      components[tag] = component;
    }

    return { remarkPlugins, rehypePlugins, components };
  }

  /**
   * 注册自定义渲染组件。
   * 注册的组件会覆盖默认组件映射中同名的标签。
   *
   * @param tag 标签名（如 'em'、'blockquote'、'custom-tag'）
   * @param component React 组件
   */
  registerComponent(tag: string, component: React.ComponentType<any>): void {
    this.customComponents.set(tag, component);
  }

  /**
   * 获取所有已注册的自定义渲染组件。
   *
   * @returns 标签名 → 组件的映射
   */
  getRegisteredComponents(): Map<string, React.ComponentType<any>> {
    return this.customComponents;
  }
}
