import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSettingStore } from './settingStore';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type LogCategory = 'system' | 'ai' | 'setting' | 'network' | 'user' | 'other';

interface LogEntry {
  id: string;
  timestamp: string;
  isoTimestamp: string;
  message: string;
  type: LogLevel;
  category: LogCategory;
  details?: string;
  stack?: string;
  context?: any;
}

interface LogState {
  logs: LogEntry[];
  isLogPanelOpen: boolean;
  unreadCount: number;
  addLog: (message: string, type?: LogLevel, options?: {
    details?: string;
    error?: Error;
    context?: any;
    category?: LogCategory;
  }) => void;
  clearLogs: () => void;
  toggleLogPanel: () => void;
  setLogPanelOpen: (open: boolean) => void;
  markAsRead: () => void;
  filterByCategory: (category: LogCategory | 'all') => LogEntry[];
  filterByLevel: (level: LogLevel | 'all') => LogEntry[];
  searchLogs: (keyword: string) => LogEntry[];
}

// 日志级别优先级映射
const logLevelPriority: Record<LogLevel, number> = {
  error: 4,
  warn: 3,
  info: 2,
  debug: 1
};

// 获取当前配置的日志级别
const getCurrentLogLevel = (): LogLevel => {
  try {
    const settingStore = useSettingStore.getState();
    return settingStore.setting?.logLevel || 'info';
  } catch (error) {
    // 如果无法获取配置，默认为info级别
    return 'info';
  }
};

// 检查日志级别是否应该输出
const shouldLog = (level: LogLevel): boolean => {
  const currentLevel = getCurrentLogLevel();
  return logLevelPriority[level] >= logLevelPriority[currentLevel];
};

export const useLogStore = create<LogState>()(
  persist(
    (set, get) => ({
      logs: [],
      isLogPanelOpen: false,
      unreadCount: 0,
      
      addLog: (message, type = 'info', options = {}) => {
    const { details, error, context, category = 'other' } = options;

    if (!shouldLog(type)) {
      return;
    }

    // 安全转换 message 为字符串
    const safeMessage = (() => {
      if (typeof message === 'string') {
        return message;
      }
      if (message === null || message === undefined) {
        return String(message);
      }
      if (typeof message === 'object' && 'message' in message && typeof (message as any).message === 'string') {
        return (message as any).message || String(message);
      }
      try {
        return JSON.stringify(message);
      } catch {
        return String(message);
      }
    })();

    // 安全转换 details 为字符串
    const safeDetails = (() => {
      if (details === null || details === undefined) {
        return undefined;
      }
      if (typeof details === 'string') {
        return details;
      }
      try {
        return JSON.stringify(details, null, 2);
      } catch {
        return String(details);
      }
    })();

    const now = new Date();
    const isoTimestamp = now.toISOString();
    const displayTime = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const newLog: LogEntry = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: displayTime,
      isoTimestamp,
      message: safeMessage,
      type,
      category,
      details: safeDetails,
      stack: error?.stack,
      context
    };

    const levelPrefix = `[${type.toUpperCase().padEnd(5)}]`;
    const timePrefix = `[${displayTime}]`;
    const categoryPrefix = `[${category.toUpperCase().padEnd(7)}]`;
    const logMessage = `${timePrefix} ${categoryPrefix} ${levelPrefix} ${safeMessage}`;

    const contextInfo = context ? JSON.stringify(context, null, 2) : '';
    const detailsInfo = safeDetails ? safeDetails : '';

    switch (type) {
      case 'error':
        console.error('%c' + logMessage, 'color: red; font-weight: bold;');
        if (detailsInfo) console.error('%cDetails:', 'color: red; font-weight: bold;', detailsInfo);
        if (error) console.error('%cError:', 'color: red; font-weight: bold;', error);
        if (contextInfo) console.error('%cContext:', 'color: red; font-weight: bold;', contextInfo);
        break;
      case 'warn':
        console.warn('%c' + logMessage, 'color: orange; font-weight: bold;');
        if (detailsInfo) console.warn('%cDetails:', 'color: orange; font-weight: bold;', detailsInfo);
        if (contextInfo) console.warn('%cContext:', 'color: orange; font-weight: bold;', contextInfo);
        break;
      case 'info':
        console.info('%c' + logMessage, 'color: blue; font-weight: bold;');
        if (detailsInfo) console.info('%cDetails:', 'color: blue; font-weight: bold;', detailsInfo);
        if (contextInfo) console.info('%cContext:', 'color: blue; font-weight: bold;', contextInfo);
        break;
      case 'debug':
        console.debug('%c' + logMessage, 'color: green; font-weight: bold;');
        if (detailsInfo) console.debug('%cDetails:', 'color: green; font-weight: bold;', detailsInfo);
        if (contextInfo) console.debug('%cContext:', 'color: green; font-weight: bold;', contextInfo);
        break;
    }

    set((state) => {
      const newLogs = [...state.logs, newLog];
      if (newLogs.length > 1000) {
        newLogs.shift();
      }
      return {
        logs: newLogs,
        unreadCount: state.isLogPanelOpen ? 0 : state.unreadCount + 1
      };
    });
  },
      
      clearLogs: () => set({ logs: [], unreadCount: 0 }),
      
      toggleLogPanel: () => set((state) => ({ 
        isLogPanelOpen: !state.isLogPanelOpen,
        unreadCount: !state.isLogPanelOpen ? 0 : state.unreadCount
      })),
      
      setLogPanelOpen: (open) => set({ 
        isLogPanelOpen: open,
        unreadCount: open ? 0 : get().unreadCount
      }),
      
      markAsRead: () => set({ unreadCount: 0 }),

      filterByCategory: (category: LogCategory | 'all') => {
        const { logs } = get();
        if (category === 'all') {
          return logs;
        }
        return logs.filter(log => log.category === category);
      },

      filterByLevel: (level: LogLevel | 'all') => {
        const { logs } = get();
        if (level === 'all') {
          return logs;
        }
        return logs.filter(log => log.type === level);
      },

      searchLogs: (keyword: string) => {
        const { logs } = get();
        if (!keyword) {
          return logs;
        }
        const lowerKeyword = keyword.toLowerCase();
        return logs.filter(log => {
          const messageMatch = log.message.toLowerCase().includes(lowerKeyword);
          const contextMatch = log.context ? JSON.stringify(log.context).toLowerCase().includes(lowerKeyword) : false;
          const detailsMatch = log.details ? log.details.toLowerCase().includes(lowerKeyword) : false;
          return messageMatch || contextMatch || detailsMatch;
        });
      }
    }),
    {
      name: 'log-storage',
      partialize: (state) => ({ logs: state.logs })
    }
  )
);
