import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupInputBar } from '../components/GroupChat/GroupInputBar';

describe('GroupInputBar', () => {
  it('should render input textarea', () => {
    render(<GroupInputBar onSend={vi.fn()} isGenerating={false} />);

    const textarea = screen.getByPlaceholderText(/输入消息/i);
    expect(textarea).toBeInTheDocument();
  });

  it('should show send button when not generating', () => {
    render(<GroupInputBar onSend={vi.fn()} isGenerating={false} />);

    expect(screen.getByText('发送')).toBeInTheDocument();
    expect(screen.queryByText('停止')).not.toBeInTheDocument();
  });

  it('should show stop button when generating', () => {
    render(<GroupInputBar onSend={vi.fn()} isGenerating={true} onStop={vi.fn()} />);

    expect(screen.getByText('停止')).toBeInTheDocument();
    expect(screen.queryByText('发送')).not.toBeInTheDocument();
  });

  it('should call onSend when send button clicked', () => {
    const onSend = vi.fn();
    render(<GroupInputBar onSend={onSend} isGenerating={false} />);

    const textarea = screen.getByPlaceholderText(/输入消息/i);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    const sendButton = screen.getByText('发送');
    fireEvent.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('should clear input after sending', () => {
    const onSend = vi.fn();
    render(<GroupInputBar onSend={onSend} isGenerating={false} />);

    const textarea = screen.getByPlaceholderText(/输入消息/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    const sendButton = screen.getByText('发送');
    fireEvent.click(sendButton);

    expect(textarea.value).toBe('');
  });

  it('should disable input when generating', () => {
    render(<GroupInputBar onSend={vi.fn()} isGenerating={true} />);

    const textarea = screen.getByPlaceholderText(/正在生成/i);
    expect(textarea).toBeDisabled();
  });

  it('should call onStop when stop button clicked', () => {
    const onStop = vi.fn();
    render(<GroupInputBar onSend={vi.fn()} isGenerating={true} onStop={onStop} />);

    const stopButton = screen.getByText('停止');
    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalled();
  });

  it('should disable send button when input is empty', () => {
    render(<GroupInputBar onSend={vi.fn()} isGenerating={false} />);

    const sendButton = screen.getByText('发送');
    expect(sendButton).toBeDisabled();
  });
});
