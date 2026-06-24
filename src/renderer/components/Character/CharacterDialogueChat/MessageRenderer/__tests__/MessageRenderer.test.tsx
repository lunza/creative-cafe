import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageRenderer } from '../MessageRenderer';

describe('MessageRenderer', () => {
  it('should render plain text', () => {
    render(<MessageRenderer content="Hello World" />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('should render bold text', () => {
    render(<MessageRenderer content="**bold text**" />);
    expect(screen.getByText('bold text')).toBeInTheDocument();
  });

  it('should render italic text', () => {
    render(<MessageRenderer content="*italic text*" />);
    expect(screen.getByText('italic text')).toBeInTheDocument();
  });

  it('should render links', () => {
    render(<MessageRenderer content="[Google](https://google.com)" />);
    const link = screen.getByRole('link', { name: /Google/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://google.com');
  });

  it('should render code blocks', () => {
    render(<MessageRenderer content="```javascript\nconst x = 1;\n```" />);
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });

  it('should render inline code', () => {
    render(<MessageRenderer content="Use `console.log()` to debug" />);
    expect(screen.getByText(/console\.log\(\)/)).toBeInTheDocument();
  });

  it('should render headings', () => {
    render(<MessageRenderer content="## Hello" />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('should render blockquotes', () => {
    render(<MessageRenderer content="> This is a quote" />);
    expect(screen.getByText('This is a quote')).toBeInTheDocument();
  });

  it('should render unordered lists', () => {
    const { container } = render(<MessageRenderer content="- Item 1\n- Item 2" />);
    const items = container.querySelectorAll('li');
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain('Item 1');
  });

  it('should render ordered lists', () => {
    const { container } = render(<MessageRenderer content="1. First\n2. Second" />);
    expect(container.textContent).toContain('First');
  });

  it('should render tables', () => {
    const tableContent = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`;
    const { container } = render(<MessageRenderer content={tableContent} />);
    expect(container.textContent).toContain('Header 1');
    expect(container.textContent).toContain('Cell 1');
  });

  it('should replace {{char}} template', () => {
    render(
      <MessageRenderer
        content="Hello from {{char}}!"
        charName="Alice"
      />
    );
    expect(screen.getByText(/Hello from Alice!/i)).toBeInTheDocument();
  });

  it('should sanitize script tags', () => {
    render(<MessageRenderer content='<script>alert("xss")</script>' />);
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
  });

  it('should sanitize onclick handlers', () => {
    const { container } = render(
      <MessageRenderer
        content='<button onclick="alert(1)">click me</button>'
        config={{ markdown: { enableQuoteNormalize: false, enableGFM: true, enableUnderscoreItalic: true, enableEmoji: true } }}
      />
    );
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.innerHTML).not.toContain('alert');
  });

  it('should sanitize onerror handlers', () => {
    const { container } = render(
      <MessageRenderer
        content='<img src=x onerror="alert(1)">'
        config={{ markdown: { enableQuoteNormalize: false, enableGFM: true, enableUnderscoreItalic: true, enableEmoji: true } }}
      />
    );
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.innerHTML).not.toContain('alert');
  });

  it('should sanitize javascript: protocol', () => {
    render(<MessageRenderer content="[click](javascript:alert(1))" />);
    const links = document.querySelectorAll('a');
    expect(links.length).toBeGreaterThan(0);
    const lastLink = links[links.length - 1];
    expect(lastLink.getAttribute('href')).not.toBe('javascript:alert(1)');
  });

  it('should allow safe protocols', () => {
    render(<MessageRenderer content="[link](https://example.com)" />);
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <MessageRenderer content="test" className="custom-class" />
    );
    expect(container.firstChild).toHaveClass('message-renderer');
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('should apply custom style', () => {
    const { container } = render(
      <MessageRenderer content="test" style={{ color: 'red' }} />
    );
    expect(container.firstChild).toHaveStyle({ color: 'rgb(255, 0, 0)' });
  });

  it('should handle empty content', () => {
    const { container } = render(<MessageRenderer content="" />);
    expect(container.querySelector('.message-renderer-content')).toBeInTheDocument();
  });

  it('should handle GFM strikethrough', () => {
    const { container } = render(<MessageRenderer content="~~deleted~~" />);
    expect(container.textContent).toContain('deleted');
  });

  it('should handle GFM task lists', () => {
    const { container } = render(<MessageRenderer content="- [x] Done\n- [ ] Todo" />);
    expect(container.textContent).toContain('Done');
    expect(container.textContent).toContain('Todo');
  });

  it('should handle horizontal rules', () => {
    render(<MessageRenderer content="---" />);
    const hr = document.querySelector('hr');
    expect(hr).toBeInTheDocument();
  });

  it('should handle nested blockquotes', () => {
    render(<MessageRenderer content="> Level 1" />);
    expect(screen.getByText('Level 1')).toBeInTheDocument();
  });

  it('should handle mixed formatting', () => {
    render(<MessageRenderer content="**Bold** and *italic* and `code`" />);
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
    expect(screen.getByText(/code/)).toBeInTheDocument();
  });

  it('should strip <think> tags and hide thinking content', () => {
    render(<MessageRenderer content="Visible text<think>Hidden thinking content</think>" />);
    expect(screen.getByText(/Visible text/)).toBeInTheDocument();
    expect(screen.queryByText(/Hidden thinking content/)).not.toBeInTheDocument();
  });

  it('should strip multiple thinking tags', () => {
    const { container } = render(<MessageRenderer content="Start<think>First thinking</think> middle<thinking>Second thinking</thinking> end" />);
    expect(container.textContent).toContain('Start');
    expect(container.textContent).toContain('middle');
    expect(container.textContent).toContain('end');
    expect(container.textContent).not.toContain('First thinking');
    expect(container.textContent).not.toContain('Second thinking');
  });

  it('should handle mixed thinking tags and normal content', () => {
    const { container } = render(
      <MessageRenderer content="Before<think>Thinking</think> **Bold text** <thought>More thinking</thought> after" />
    );
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('Bold text');
    expect(container.textContent).toContain('after');
    expect(container.textContent).not.toContain('Thinking');
    expect(container.textContent).not.toContain('More thinking');
  });

  it('should preserve normal content formatting with thinking tags', () => {
    render(<MessageRenderer content="<think>Thinking</think> **Bold** and *italic* and `code`" />);
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
    expect(screen.getByText(/code/)).toBeInTheDocument();
  });
});
