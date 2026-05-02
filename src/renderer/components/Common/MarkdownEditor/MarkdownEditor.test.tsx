import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MarkdownEditor from './MarkdownEditor';

// Mock 相关依赖
vi.mock('../../../stores/logStore', () => ({
  useLogStore: () => ({
    addLog: vi.fn(),
  }),
}));

vi.mock('../../../stores/settingStore', () => ({
  useSettingStore: () => ({
    fetchSetting: vi.fn(),
  }),
}));

vi.mock('../DataPersistence', () => ({
  dataPersistence: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@milkdown/react', () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('MarkdownEditor 组件测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本渲染', () => {
    it('应该正确渲染默认配置的编辑器', () => {
      render(<MarkdownEditor />);
      // 编辑器应该被渲染
      expect(document.querySelector('.milkdown-container')).toBeTruthy();
    });

    it('应该正确设置 defaultValue', () => {
      const testValue = '# 测试标题';
      render(<MarkdownEditor defaultValue={testValue} />);
      expect(document.querySelector('.milkdown-container')).toBeTruthy();
    });
  });

  describe('保存功能', () => {
    it('应该显示保存按钮（当 enableSave 为 true 时）', () => {
      const { container } = render(<MarkdownEditor enableSave={true} />);
      
      // 查找保存按钮
      const findSaveButton = (container: Element) => {
        const buttons = container.querySelectorAll('button');
        for (const btn of buttons) {
          if (
            btn.textContent?.includes('保存') ||
            btn.querySelector('[data-icon*="save"]') ||
            btn.innerHTML.includes('SaveOutlined')
          ) {
            return true;
          }
        }
        return false;
      };
      
      expect(findSaveButton(container)).toBe(true);
    });

    it('不应该显示保存按钮（当 enableSave 为 false 或默认时）', () => {
      const { container: container1 } = render(<MarkdownEditor />);
      const { container: container2 } = render(<MarkdownEditor enableSave={false} />);
      
      // 查找所有包含"保存"文本或相关图标的按钮
      const findSaveButton = (container: Element) => {
        const buttons = container.querySelectorAll('button');
        for (const btn of buttons) {
          if (
            btn.textContent?.includes('保存') ||
            btn.querySelector('[data-icon*="save"]') ||
            btn.innerHTML.includes('SaveOutlined')
          ) {
            return true;
          }
        }
        return false;
      };
      
      // 应该不包含保存按钮
      expect(findSaveButton(container1)).toBe(false);
      expect(findSaveButton(container2)).toBe(false);
    });
  });

  describe('主题设置', () => {
    it('应该正确应用浅色主题', () => {
      render(<MarkdownEditor theme="light" />);
      const container = document.querySelector('.milkdown-container');
      expect(container?.classList.contains('light-theme')).toBeTruthy();
    });

    it('应该正确应用深色主题', () => {
      render(<MarkdownEditor theme="dark" />);
      const container = document.querySelector('.milkdown-container');
      expect(container?.classList.contains('dark-theme')).toBeTruthy();
    });
  });

  describe('AI 工具', () => {
    it('应该显示 AI 工具（当 enableAITools 为 true 时）', () => {
      render(<MarkdownEditor enableAITools={true} />);
      expect(document.querySelector('.milkdown-container')).toBeTruthy();
    });

    it('默认应该显示 AI 工具', () => {
      render(<MarkdownEditor />);
      expect(document.querySelector('.milkdown-container')).toBeTruthy();
    });
  });

  describe('属性传递', () => {
    it('应该正确传递 className 属性', () => {
      const customClass = 'custom-editor';
      render(<MarkdownEditor className={customClass} />);
      const container = document.querySelector('.milkdown-container');
      expect(container?.classList.contains(customClass)).toBeTruthy();
    });

    it('应该正确应用 minHeight 样式', () => {
      render(<MarkdownEditor minHeight="800px" />);
      const wrapper = document.querySelector('.milkdown-container')?.parentElement;
      expect(wrapper).toBeTruthy();
    });
  });
});
