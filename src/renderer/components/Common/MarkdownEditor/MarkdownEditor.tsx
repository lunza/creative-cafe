import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useState,
  useMemo,
  createContext,
  useContext,
} from 'react';
import { Button, Tooltip, message } from 'antd';
import { SaveOutlined, CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import { MilkdownProvider } from '@milkdown/react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/nord.css';
import '@milkdown/crepe/theme/nord-dark.css';
import '../../../styles/milkdownFixes.css';
import { useSettingStore } from '../../../stores/settingStore';
import { useLogStore } from '../../../stores/logStore';
import { dataPersistence } from '../DataPersistence';
import {
  MarkdownEditorProps,
  MarkdownEditorHandle,
  MarkdownEditorContextType,
} from './MarkdownEditor.types';
import {
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_EDITOR_CONTENT,
  DEFAULT_CONTAINER_STYLE,
} from './MarkdownEditor.defaults';
import {
  applyThemeStyles,
  createEditorInstance,
  destroyEditorInstance,
  getMilkdownElement,
  generateContainerClassName,
  safeParseContent,
} from './MarkdownEditor.utils';
import MarkdownAITools from './MarkdownAITools';

const MarkdownEditorContext = createContext<MarkdownEditorContextType | null>(null);

function useMarkdownEditorContext(): MarkdownEditorContextType {
  const context = useContext(MarkdownEditorContext);
  if (!context) {
    throw new Error('useMarkdownEditorContext must be used within MarkdownEditorProvider');
  }
  return context;
}

const MarkdownEditorComponent = (
  props: MarkdownEditorProps,
  ref: React.Ref<MarkdownEditorHandle>
) => {
  const {
    theme = DEFAULT_EDITOR_CONFIG.theme,
    value,
    defaultValue = DEFAULT_EDITOR_CONTENT,
    onChange,
    placeholder = DEFAULT_EDITOR_CONFIG.placeholder,
    enableAITools = DEFAULT_EDITOR_CONFIG.enableAITools,
    enableSave = DEFAULT_EDITOR_CONFIG.enableSave,
    storageKey = DEFAULT_EDITOR_CONFIG.storageKey,
    onSave,
    onLoad,
    className,
    style,
    minHeight = DEFAULT_EDITOR_CONFIG.minHeight,
    containerStyle,
  } = props;

  const { fetchSetting } = useSettingStore();
  const { addLog } = useLogStore();

  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const contentRef = useRef<string>('');
  const editorInstanceRef = useRef<any>(null);
  const cursorStateRef = useRef<any>(null);
  const lastSavedContentRef = useRef<string>('');
  const onLoadRef = useRef(onLoad);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  
  // 保持 ref 同步
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);
  
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  
  const [contentKey, setContentKey] = useState(0);
  const [internalContent, setInternalContent] = useState(() => {
    const initialContent = value !== undefined ? value : '';
    const safeContent = safeParseContent(initialContent);
    console.log('[MarkdownEditor] Initializing internalContent', { initialLength: initialContent.length, safeLength: safeContent.length });
    return safeContent;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const initCountRef = useRef(0);
  const instanceIdRef = useRef(Math.random().toString(36).substring(2, 8));

  useEffect(() => {
    console.log(`[MarkdownEditor #${instanceIdRef.current}] useEffect: isReady set to true`, {
      storageKey,
      callStack: new Error().stack?.split('\n').slice(1, 5).join('\n')
    });
    initCountRef.current += 1;
    console.log(`[MarkdownEditor #${instanceIdRef.current}] initCount:`, initCountRef.current);
    setIsReady(true);
  }, []);

  useEffect(() => {
    console.log(`[MarkdownEditor #${instanceIdRef.current}] value prop changed`, { 
      newValueLength: value?.length || 0, 
      oldInternalLength: internalContent.length,
      storageKey,
      callStack: new Error().stack?.split('\n').slice(1, 3).join('\n')
    });
    if (value !== undefined && value !== internalContent) {
      console.log(`[MarkdownEditor #${instanceIdRef.current}] Syncing value prop to internalContent`);
      const safeContent = safeParseContent(value);
      setInternalContent(safeContent);
      contentRef.current = safeContent;
      setContentKey(prev => prev + 1);
    }
  }, [value]);

  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  
  console.log(`[MarkdownEditor] Render #${renderCountRef.current}`, {
    storageKey,
    valueLength: value?.length || 0,
    value: value?.substring(0, 20),
    internalContentLength: internalContent.length,
    contentKey,
    enableSave,
    enableAITools
  });

  // ==================== 核心函数（提前定义）====================

  // 获取编辑器当前内容
  const getMarkdown = useCallback((): string => {
    // 优先使用 contentRef.current 获取最新内容
    // 这样可以确保获取到最新的编辑器内容，避免使用可能过时的 internalContent
    const currentContent = contentRef.current || internalContent || '';
    
    addLog('MarkdownEditor: 获取编辑器内容', 'debug', {
      category: 'system',
      context: { 
        contentLength: currentContent.length,
        content: currentContent.substring(0, 20) + '...',
        source: contentRef.current ? 'contentRef' : 'internalContent'
      }
    });
    
    return currentContent;
  }, [internalContent, addLog]);

  // 设置编辑器内容
  const setMarkdown = useCallback((newContent: string): void => {
    const safeContent = safeParseContent(newContent);
    console.log('[MarkdownEditor] setMarkdown called', { contentLength: safeContent.length, source: newContent.substring(0, 50) });
    addLog('MarkdownEditor: 设置编辑器内容', 'debug', {
      category: 'system',
      context: { contentLength: safeContent.length }
    });
    
    // 如果编辑器已存在，优先使用 Milkdown API 更新内容，避免重建编辑器丢失光标
    if (crepeRef.current && editorInstanceRef.current) {
      try {
        crepeRef.current.editor.cmd.update(safeContent);
        contentRef.current = safeContent;
        setInternalContent(safeContent);
        setHasUnsavedChanges(true);
        onChangeRef.current?.(safeContent);
        console.log('[MarkdownEditor] setMarkdown completed via Milkdown API');
        return;
      } catch (e) {
        // 如果 API 更新失败，回退到重建编辑器
        addLog('MarkdownEditor: Milkdown API 更新失败，回退到重建', 'warn', {
          category: 'system',
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    
    // 回退：重建编辑器
    setInternalContent(safeContent);
    setContentKey(prev => prev + 1);
    setHasUnsavedChanges(true);
    onChangeRef.current?.(safeContent);
    console.log('[MarkdownEditor] setMarkdown completed via rebuild');
  }, [addLog]);

  const getEditorElement = useCallback((): HTMLElement | null => {
    return getMilkdownElement(rootRef.current);
  }, []);

  // ==================== 存储相关函数 ====================

  // 从本地存储加载内容
  const loadFromStorage = useCallback(async () => {
    console.log('[MarkdownEditor] loadFromStorage called', { enableSave, storageKey });
    if (!enableSave) {
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      setLoadError(null);
      addLog('MarkdownEditor: 开始从本地存储加载内容', 'info', {
        category: 'system',
        context: { storageKey }
      });
      const savedContent = await dataPersistence.get<string>(storageKey);
      if (savedContent && savedContent.trim()) {
        addLog('MarkdownEditor: 从本地存储加载内容成功', 'info', {
          category: 'system',
          context: { storageKey, contentLength: savedContent.length }
        });
        console.log('[MarkdownEditor] Loaded content from storage, calling setInternalContent');
        setInternalContent(savedContent);
        setContentKey(prev => prev + 1);
        setHasUnsavedChanges(false);
        console.log('[MarkdownEditor] Calling onLoad callback');
        onLoadRef.current?.(savedContent);
        console.log('[MarkdownEditor] onLoad callback completed');
      } else {
        addLog('MarkdownEditor: 本地存储中没有找到内容，初始化为空', 'debug', {
          category: 'system',
          context: { storageKey }
        });
        // 如果 defaultValue 有值，使用 defaultValue（作为可选的初始占位）
        if (defaultValue && defaultValue.trim()) {
          setInternalContent(defaultValue);
          setContentKey(prev => prev + 1);
        }
      }
    } catch (error) {
      const err = error as Error;
      addLog('MarkdownEditor: 从本地存储加载内容失败', 'error', {
        category: 'system',
        error: err,
        context: { storageKey }
      });
      console.error('MarkdownEditor: 从本地存储加载内容失败:', error);
      setLoadError(err.message || '加载内容失败');
    } finally {
      setIsLoading(false);
    }
  }, [enableSave, storageKey, defaultValue, addLog]);

  // 保存到本地存储
  const saveToStorage = useCallback(async (content: string, showNotification: boolean = true) => {
    if (!enableSave) return;

    addLog('MarkdownEditor: 开始保存内容到本地存储', 'info', {
      category: 'system',
      context: { storageKey, contentLength: content.length, showNotification }
    });
    
    // 设置保存状态
    setIsSaving(true);
    
    // 完全异步执行保存操作，不阻塞主线程
    return new Promise<void>((resolve, reject) => {
      // 使用 setTimeout 确保在新的事件循环中执行
      setTimeout(async () => {
        try {
          // 执行存储操作
          await dataPersistence.set<string>(storageKey, content);
          
          // 保存成功后更新状态
          setHasUnsavedChanges(false);
          lastSavedContentRef.current = content; // 记录已保存的内容
          setIsSaved(true);
          
          addLog('MarkdownEditor: 保存内容到本地存储成功', 'info', {
            category: 'system',
            context: { storageKey, contentLength: content.length }
          });
          
          // 触发保存成功回调
          onSaveRef.current?.(content);
          
          // 只有在需要显示通知时才显示
          if (showNotification) {
            message.success('保存成功', {
              duration: 1.5,
              className: 'markdown-editor-save-notification'
            });
            
            // 确保提示框在 2 秒后自动消失
            setTimeout(() => {
              message.destroy();
            }, 2000);
          }
          
          // 3秒后清除已保存状态
          setTimeout(() => {
            setIsSaved(false);
          }, 3000);
          
          resolve();
        } catch (error) {
          const err = error as Error;
          addLog('MarkdownEditor: 保存内容到本地存储失败', 'error', {
            category: 'system',
            error: err,
            context: { 
              storageKey,
              errorMessage: err.message,
              errorStack: err.stack,
              errorType: typeof error
            }
          });
          console.error('MarkdownEditor: 保存内容到本地存储失败:', error);
          
          // 显示更详细的错误信息给用户
          message.error(`保存失败: ${err.message || '未知错误'}`, {
            duration: 3
          });
          
          reject(error);
        } finally {
          // 无论成功还是失败，都设置保存状态为 false
          setIsSaving(false);
        }
      }, 0);
    });
  }, [enableSave, storageKey, addLog]);

  // 手动保存
  const handleSave = useCallback(async (): Promise<void> => {
    // 使用 getMarkdown() 获取最新内容，确保保存的是最新的编辑器内容
    const currentContent = getMarkdown();
    
    addLog('MarkdownEditor: 手动保存触发', 'info', {
      category: 'system',
      context: { storageKey, contentLength: currentContent.length }
    });
    
    // 执行保存操作
    await saveToStorage(currentContent);
  }, [getMarkdown, saveToStorage, storageKey, addLog]);

  // 键盘快捷键保存 (Ctrl+S / Cmd+S)
  useEffect(() => {
    if (!enableSave) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enableSave, handleSave]);

  // ==================== 配置对象 ====================

  const editorConfig = useMemo(() => {
    return {
      defaultValue: internalContent,
      placeholder,
      features: {
        blockEdit: DEFAULT_EDITOR_CONFIG.features.blockEdit,
        placeholder: { text: placeholder },
      },
    };
  }, [internalContent, placeholder]);

  console.log('[MarkdownEditor] editorConfig changed', { contentLength: internalContent.length, contentKey });

  // ==================== 暴露给外部的接口 ====================

  useImperativeHandle(ref, () => ({
    getMarkdown,
    setMarkdown,
    getEditorElement,
    save: handleSave,
  }), [getMarkdown, setMarkdown, getEditorElement, handleSave]);

  // ==================== 上下文值 ====================

  const contextValue = useMemo<MarkdownEditorContextType>(
    () => ({
      getEditorContent: getMarkdown,
      setEditorContent: setMarkdown,
      getEditorElement,
    }),
    [getMarkdown, setMarkdown, getEditorElement]
  );

  // ==================== 样式 ====================

  const combinedContainerStyle = useMemo(() => {
    return {
      ...DEFAULT_CONTAINER_STYLE,
      ...containerStyle,
    };
  }, [containerStyle]);

  const wrapperStyle = useMemo(() => {
    return {
      minHeight,
      background: theme === 'dark' ? '#1b1c1d' : '#fdfcff',
      borderRadius: '8px',
      padding: '20px',
      color: theme === 'dark' ? '#f8f9ff' : '#1b1c1d',
      ...style,
    };
  }, [theme, minHeight, style]);

  // ==================== 副作用处理 ====================

  // 监听外部 value 变化（仅在外部 value 真正变化时同步，避免与用户输入冲突）
  useEffect(() => {
    if (value !== undefined) {
      const safeValue = safeParseContent(value);
      
      // 检测是否是受控模式的反馈循环：
      // 如果新 value 与 contentRef 相同，说明是 onChange 回调触发的父组件更新，
      // 不需要重新同步（用户正在输入，编辑器内容已经是最新的）
      if (safeValue === contentRef.current) {
        // 这是反馈循环，不做任何操作，保持编辑器状态不变
        return;
      }
      
      // 只有当外部 value 与内部状态不同时才同步（说明是真正的外部更新，而非用户输入）
      if (safeValue !== internalContent) {
        addLog('MarkdownEditor: 外部 value 变化，同步到内部状态', 'debug', {
          category: 'system',
          context: { newValue: safeValue.substring(0, 50), currentInternal: internalContent.substring(0, 50) }
        });
        setInternalContent(safeValue);
        
        // 如果编辑器已存在，直接更新内容而不重建
        if (crepeRef.current && editorInstanceRef.current) {
          try {
            // 修复：ProseMirror 不接受空字符串作为文档内容
            // 空内容时需要重建编辑器以确保正确的文档结构
            if (safeValue.trim() === '') {
              addLog('MarkdownEditor: 检测到空内容，重建编辑器实例', 'debug', {
                category: 'system',
                context: { contentLength: 0 }
              });
              // 空内容时递增 contentKey 重建编辑器，确保光标可见
              setContentKey(prev => prev + 1);
            } else {
              crepeRef.current.editor.cmd.update(safeValue);
              contentRef.current = safeValue;
              addLog('MarkdownEditor: 通过 Milkdown API 更新内容（流式兼容）', 'debug', {
                category: 'system',
                context: { contentLength: safeValue.length }
              });
            }
          } catch (e) {
            // 如果 API 更新失败，回退到重建编辑器
            addLog('MarkdownEditor: Milkdown API 更新失败，回退到重建', 'warn', {
              category: 'system',
              error: e instanceof Error ? e.message : String(e)
            });
            setContentKey(prev => prev + 1);
          }
        } else {
          setContentKey(prev => prev + 1);
        }
        
        // 同步更新 contentRef，防止 markdownUpdated 监听器的干扰
        contentRef.current = safeValue;
      }
    }
  }, [value, addLog]);

  // 初始化时加载设置和存储的内容
  useEffect(() => {
    console.log('[MarkdownEditor] useEffect: init triggered', { 
      enableSave, 
      valueIsUndefined: value === undefined,
      storageKey
    });
    fetchSetting();
    if (enableSave && value === undefined) {
      loadFromStorage();
    } else {
      setIsLoading(false);
    }
  }, [fetchSetting, enableSave, loadFromStorage, value]);

  // 注意：组件卸载时不再自动保存内容。
  // 所有内容保存必须通过用户明确的手动操作（点击保存按钮或 Ctrl+S）完成。
  // 这样可以避免自动保存干扰用户的编辑体验。

  // 编辑器初始化和更新
  // 修复：添加 isReady 依赖确保 DOM 已挂载后再初始化
  useEffect(() => {
    if (!isReady) {
      console.log('[MarkdownEditor] Component not ready yet, skipping initialization');
      return;
    }

    console.log('[MarkdownEditor] useEffect: 初始化/更新编辑器 triggered', {
      theme,
      contentKey,
      hasRootRef: !!rootRef.current,
      editorConfigContentLength: editorConfig.defaultValue?.length || 0
    });

    if (!rootRef.current) {
      console.log('[MarkdownEditor] rootRef.current is null, skipping initialization');
      return;
    }

    addLog('MarkdownEditor: 初始化/更新编辑器', 'debug', {
      category: 'system',
      context: { theme, contentKey }
    });

    // 销毁旧实例
    destroyEditorInstance(crepeRef.current);
    rootRef.current.innerHTML = '';
    applyThemeStyles(rootRef.current, theme);

    console.log('[MarkdownEditor] Creating editor instance...');

    // 创建新实例
    createEditorInstance(rootRef.current, editorConfig).then((crepe) => {
      console.log('[MarkdownEditor] Editor instance created successfully');
      crepeRef.current = crepe;

      const editorElement = getMilkdownElement(rootRef.current);
      if (editorElement) {
        applyThemeStyles(editorElement, theme);
      }

      // 监听 markdown 更新事件，实时同步内容
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          const prevContent = contentRef.current;
          // 先更新 ref，避免状态更新的延迟
          contentRef.current = markdown;
          
          // 只有当内容真正改变时才执行操作
          // 使用 prevContent (ref) 而非 internalContent (stale closure) 进行比较
          if (prevContent !== markdown) {
            // 1. 触发 onChange 回调
            onChangeRef.current?.(markdown);
            
            // 2. 延迟更新 hasUnsavedChanges 状态
            setTimeout(() => {
              setHasUnsavedChanges(true);
            }, 0);
            
            // 3. 延迟记录日志，避免影响输入性能
            setTimeout(() => {
              addLog('MarkdownEditor: 检测到编辑器内容变更（markdownUpdated 事件）', 'debug', {
                category: 'system',
                context: { contentLength: markdown.length, content: markdown.substring(0, 50) + '...' }
              });
            }, 0);
          }
        });
      });

      // 当编辑器失去焦点时更新 internalContent 状态，确保状态一致性
      if (editorElement) {
        editorElement.addEventListener('blur', () => {
          const currentContent = contentRef.current;
          if (currentContent && currentContent !== internalContent) {
            addLog('MarkdownEditor: 编辑器失去焦点，同步内容到内部状态', 'debug', {
              category: 'system',
              context: { contentLength: currentContent.length }
            });
            // 更新 internalContent 状态，但不触发 contentKey 变化，避免编辑器重新渲染
            setInternalContent(currentContent);
          }
          addLog('MarkdownEditor: 编辑器失去焦点', 'debug', {
            category: 'system'
          });
        });
      }
    }).catch((error) => {
      console.error('MarkdownEditor: 创建编辑器实例失败', error);
      addLog('MarkdownEditor: 创建编辑器实例失败', 'error', {
        category: 'system',
        error: error as Error
      });
    });

    return () => {
      destroyEditorInstance(crepeRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, contentKey, placeholder, isReady]);

  // ==================== 渲染 ====================

  return (
    <MarkdownEditorContext.Provider value={contextValue}>
      <div style={wrapperStyle}>
        {/* 加载状态 */}
        {isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            color: theme === 'dark' ? '#a0aec0' : '#718096',
            fontSize: '14px'
          }}>
            <LoadingOutlined style={{ fontSize: '20px', marginRight: '8px', animation: 'spin 1s linear infinite' }} />
            加载内容中...
          </div>
        )}

        {/* 错误提示 */}
        {loadError && !isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            backgroundColor: theme === 'dark' ? '#4a1f1f' : '#fff5f5',
            color: theme === 'dark' ? '#fc8181' : '#e53e3e',
            borderRadius: '8px',
            marginBottom: '12px',
            fontSize: '14px'
          }}>
            <span style={{ marginRight: '8px' }}>⚠️</span>
            加载失败: {loadError}
            <Button
              type="link"
              size="small"
              onClick={loadFromStorage}
              style={{ color: theme === 'dark' ? '#90cdf4' : '#3182ce', marginLeft: '8px' }}
            >
              重试
            </Button>
          </div>
        )}

        {/* 工具栏 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
          {enableSave && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isSaved && (
                <span style={{
                  color: '#52c41a',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <CheckOutlined style={{ marginRight: '4px' }} /> 已保存
                </span>
              )}
              {hasUnsavedChanges && !isSaving && (
                <span style={{
                  color: theme === 'dark' ? '#faad14' : '#fa8c16',
                  fontSize: '12px'
                }}>
                  • 有未保存的更改
                </span>
              )}
              <Tooltip title={
                isSaving ? '保存中...' :
                hasUnsavedChanges ? '有未保存的更改，点击保存（或按 Ctrl+S）' :
                isSaved ? '内容已保存' : '点击保存'
              }>
                <Button
                  type={hasUnsavedChanges ? 'primary' : 'default'}
                  icon={isSaving ? <LoadingOutlined spin /> : isSaved ? <CheckOutlined /> : <SaveOutlined />}
                  onClick={handleSave}
                  loading={isSaving}
                  disabled={isSaving}
                >
                  {isSaving ? '保存中...' : isSaved ? '已保存' : '保存'}
                </Button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* AI 工具 */}
        {enableAITools && !isLoading && (
          <MarkdownAITools
            getEditorContent={getMarkdown}
            setEditorContent={setMarkdown}
            editorElement={getEditorElement()}
          />
        )}

        {/* 编辑器容器 - 仅在未加载时隐藏 */}
        {!isLoading && (
          <div
            ref={rootRef}
            className={generateContainerClassName(theme, className)}
            style={combinedContainerStyle}
          />
        )}
      </div>
    </MarkdownEditorContext.Provider>
  );
};

const MarkdownEditorInternal = forwardRef(MarkdownEditorComponent);
MarkdownEditorInternal.displayName = 'MarkdownEditorInternal';

const MarkdownEditor = forwardRef((props: MarkdownEditorProps, ref: React.Ref<MarkdownEditorHandle>) => {
  return (
    <MilkdownProvider>
      <MarkdownEditorInternal ref={ref} {...props} />
    </MilkdownProvider>
  );
});

MarkdownEditor.displayName = 'MarkdownEditor';

export default MarkdownEditor;
export { MarkdownEditorContext, useMarkdownEditorContext };
