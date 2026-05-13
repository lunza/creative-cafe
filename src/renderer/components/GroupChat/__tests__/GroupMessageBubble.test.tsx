import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroupMessageBubble } from '../components/GroupChat/GroupMessageBubble';

describe('GroupMessageBubble', () => {
  const createMessage = (overrides: Partial<any> = {}) => ({
    id: 'msg-1',
    name: 'Alice',
    is_user: false,
    is_system: false,
    send_date: '2024-01-01T12:00:00Z',
    mes: 'Hello, this is a test message!',
    ...overrides,
  });

  it('should render AI message with character name', () => {
    const message = createMessage();
    render(<GroupMessageBubble message={message} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Hello, this is a test message!')).toBeInTheDocument();
  });

  it('should render user message with different styling', () => {
    const message = createMessage({ is_user: true, mes: 'User message' });
    render(<GroupMessageBubble message={message} />);

    expect(screen.getByText('User message')).toBeInTheDocument();
  });

  it('should display timestamp', () => {
    const message = createMessage();
    render(<GroupMessageBubble message={message} />);

    const timeText = '12:00:00';
    expect(screen.getByText((content, element) => {
      return element?.textContent?.includes('12:00') || false;
    })).toBeInTheDocument();
  });

  it('should show force_avatar when provided', () => {
    const message = createMessage({ force_avatar: 'https://example.com/avatar.png' });
    render(<GroupMessageBubble message={message} />);

    const avatar = screen.getByRole('img', { hidden: true });
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.png');
  });
});
