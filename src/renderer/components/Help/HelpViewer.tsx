import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Modal, Input, Spin, Alert, Empty } from 'antd';
import { SearchOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkEmoji from 'remark-emoji';
import Fuse from 'fuse.js';
import './HelpViewer.css';

interface HelpViewerProps {
  open: boolean;
  onClose: () => void;
}

interface TocItem {
  id: string;
  title: string;
  level: number;
}

interface SearchResult {
  sectionTitle: string;
  sectionId: string;
  snippet: string;
}

interface MarkdownSection {
  title: string;
  id: string;
  content: string;
}

/** 将标题文本转为合法的 HTML id（保留中文、字母、数字、连字符） */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** 从 ReactNode 中递归提取纯文本，用于生成 heading id */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement).props.children);
  }
  return '';
}

/** 从 markdown 文本中提取所有 H1 标题，构建目录 */
function extractToc(markdown: string): TocItem[] {
  const lines = markdown.split('\n');
  const toc: TocItem[] = [];
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      const title = match[1].trim();
      toc.push({ id: slugify(title), title, level: 1 });
    }
  }
  return toc;
}

const HelpViewer: React.FC<HelpViewerProps> = ({ open, onClose }) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [activeSection, setActiveSection] = useState<string>('');
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const contentCache = useRef<string | null>(null);

  // 打开时加载 markdown 文档（命中缓存则直接复用）
  useEffect(() => {
    if (!open) return;
    if (contentCache.current) {
      setContent(contentCache.current);
      return;
    }
    setLoading(true);
    setError(null);
    window.electronAPI.docs
      .read('user-manual.md')
      .then((result: string | { success: false; error: string }) => {
        if (typeof result === 'string') {
          contentCache.current = result;
          setContent(result);
        } else {
          setError(result.error || '文档加载失败');
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '文档加载失败');
      })
      .finally(() => setLoading(false));
  }, [open]);

  // 从内容构建目录
  const tocItems = useMemo(() => extractToc(content), [content]);

  // 内容加载后默认高亮首个章节
  useEffect(() => {
    if (tocItems.length > 0 && !activeSection) {
      setActiveSection(tocItems[0].id);
    }
  }, [tocItems, activeSection]);

  // 按 H1 章节切分内容，构建 Fuse.js 检索实例
  const fuse = useMemo<Fuse<MarkdownSection> | null>(() => {
    if (!content) return null;
    const sections = content.split(/^#\s+/m).filter((s) => s.trim());
    const sectionData: MarkdownSection[] = sections.map((section) => {
      const titleLine = section.split('\n')[0].trim();
      return {
        title: titleLine,
        id: slugify(titleLine),
        content: section,
      };
    });
    return new Fuse(sectionData, {
      keys: ['content'],
      includeMatches: true,
      threshold: 0.3,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }, [content]);

  // 处理搜索：输入非空时调用 Fuse.search，截取匹配片段
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || !fuse) {
      setSearchResults([]);
      return;
    }
    const results = fuse.search(query).slice(0, 20);
    const mapped: SearchResult[] = results.map((r) => {
      const text = r.item.content;
      const match = r.matches?.[0];
      let snippet = text.replace(/[#*`>]/g, '').trim().slice(0, 120);
      if (match && match.indices && match.indices.length > 0) {
        const start = Math.max(0, match.indices[0][0] - 30);
        const end = Math.min(text.length, match.indices[0][1] + 50);
        snippet =
          (start > 0 ? '...' : '') +
          text.substring(start, end).replace(/[#*`>]/g, '').trim() +
          (end < text.length ? '...' : '');
      }
      return {
        sectionTitle: r.item.title,
        sectionId: r.item.id,
        snippet,
      };
    });
    setSearchResults(mapped);
  }, [searchQuery, fuse]);

  // 移动端输入搜索词时自动展开侧栏
  useEffect(() => {
    if (searchQuery.trim() && window.innerWidth <= 768) {
      setSidebarVisible(true);
    }
  }, [searchQuery]);

  // 滚动到指定章节并高亮
  const scrollToSection = useCallback((sectionId: string) => {
    const element = sectionRefs.current[sectionId];
    const container = contentRef.current;
    if (element && container) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const offset = elementRect.top - containerRect.top + container.scrollTop - 20;
      container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    }
    setActiveSection(sectionId);
    if (window.innerWidth <= 768) {
      setSidebarVisible(false);
    }
  }, []);

  // 滚动监听：根据当前可视位置自动高亮对应章节
  useEffect(() => {
    if (!content || tocItems.length === 0) return;
    const container = contentRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let current = tocItems[0].id;
      for (const item of tocItems) {
        const el = sectionRefs.current[item.id];
        if (el) {
          const elTop = el.getBoundingClientRect().top - containerTop;
          if (elTop - 80 <= 0) {
            current = item.id;
          }
        }
      }
      setActiveSection(current);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [content, tocItems]);

  // 自定义 h1 渲染：注入 slugified id + ref，供目录导航与滚动追踪使用
  const markdownComponents = useMemo<Components>(
    () => ({
      h1: ({ node, children, ...props }) => {
        void node; // node 来自 react-markdown ExtraProps，此处不需使用
        const id = slugify(extractText(children));
        return (
          <h1
            id={id}
            ref={(el) => {
              sectionRefs.current[id] = el;
            }}
            className="help-md-h1"
            {...props}
          >
            {children}
          </h1>
        );
      },
    }),
    []
  );

  // 在搜索结果片段中高亮匹配词（利用 split 捕获组的奇偶下标判定匹配段）
  const highlightSnippet = (text: string, term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return text;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="help-search-highlight">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{ top: 0, maxWidth: '100vw', paddingBottom: 0 }}
      className="help-viewer-modal"
      destroyOnHidden={false}
      closable={false}
      title={null}
    >
      <div className="help-viewer-container">
        {/* 固定顶部栏 */}
        <header className="help-topbar">
          <button type="button" className="help-back-btn" onClick={onClose}>
            <ArrowLeftOutlined />
            <span>返回</span>
          </button>
          <span className="help-viewer-title">使用手册</span>
          <Input
            placeholder="搜索文档内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            prefix={<SearchOutlined />}
            className="help-search-input"
          />
        </header>

        <div className="help-viewer-body">
          {loading ? (
            <div className="help-loading">
              <Spin size="large" />
            </div>
          ) : error ? (
            <Alert message="加载失败" description={error} type="error" showIcon />
          ) : (
            <>
              <aside className={`help-sidebar ${sidebarVisible ? 'help-sidebar-open' : ''}`}>
                {searchQuery && searchResults.length > 0 ? (
                  <div className="help-search-results">
                    <div className="help-search-count">找到 {searchResults.length} 条结果</div>
                    {searchResults.map((result, index) => (
                      <div
                        key={index}
                        className="help-search-result-item"
                        onClick={() => {
                          scrollToSection(result.sectionId);
                          setSearchQuery('');
                        }}
                      >
                        <div className="help-search-result-title">{result.sectionTitle}</div>
                        <div className="help-search-result-snippet">
                          {highlightSnippet(result.snippet, searchQuery)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : searchQuery ? (
                  <Empty description="未找到匹配内容" />
                ) : (
                  <nav className="help-toc">
                    {tocItems.map((item) => (
                      <div
                        key={item.id}
                        className={`help-toc-item ${activeSection === item.id ? 'active' : ''}`}
                        onClick={() => scrollToSection(item.id)}
                      >
                        {item.title}
                      </div>
                    ))}
                  </nav>
                )}
              </aside>

              <button
                type="button"
                className="help-sidebar-toggle"
                onClick={() => setSidebarVisible(!sidebarVisible)}
                aria-label="切换目录"
              >
                {sidebarVisible ? '◀' : '▶'}
              </button>

              <div className="help-content" ref={contentRef}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkEmoji]}
                  components={markdownComponents}
                >
                  {content}
                </ReactMarkdown>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default HelpViewer;
