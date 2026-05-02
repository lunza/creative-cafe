/**
 * 聊天记录管理组件
 * 用于查看、搜索、筛选聊天记录，并触发 AI 处理
 */

import React, { useState, useEffect } from 'react';
import { useSettingStore } from '../../stores/settingStore';
import {
  Card,
  Button,
  Tree,
  Table,
  Input,
  Space,
  message,
  Select,
  Modal,
  List,
  Tag,
  Typography,
  Row,
  Col,
  Divider,
  Spin,
  Empty,
  Form
} from 'antd';
import {
  SearchOutlined,
  FilterOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  DeleteOutlined,
  CheckOutlined,
  FolderOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useLogStore } from '../../stores/logStore';
import './MemoryChatManager.css';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface ChatSession {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  preview: string;
  characterName: string;
  templateId?: string; // 关联的模板ID
  isTemplateAssociated?: boolean; // 是否已关联模板
  isProcessed?: boolean; // 是否已完成整理
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chatId: string;
}

interface AIProcessingResult {
  sheetName: string;
  updates: Record<string, any>[];
  preview: string;
}

const ChatManager: React.FC = () => {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [processing, setProcessing] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [aiResults, setAiResults] = useState<AIProcessingResult[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [treeData, setTreeData] = useState<any[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [associateModalVisible, setAssociateModalVisible] = useState(false);
  const [processingModalVisible, setProcessingModalVisible] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingDetails, setProcessingDetails] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [shouldStopProcessing, setShouldStopProcessing] = useState(false);
  const [processingMessages, setProcessingMessages] = useState<string[]>([]);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [processingConfig, setProcessingConfig] = useState<any>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [tablePreviewVisible, setTablePreviewVisible] = useState(false);
  const [tableData, setTableData] = useState<any[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [allSheetData, setAllSheetData] = useState<Record<string, any[]>>({});
  const [allSheetHeaders, setAllSheetHeaders] = useState<Record<string, string[]>>({});
  const [isTableLoading, setIsTableLoading] = useState(false);
  const { addLog } = useLogStore();
  const { setting, fetchSetting } = useSettingStore();
  
  // 组件加载时加载配置
  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);
  
  // 监听来自主进程的日志信息
  useEffect(() => {
    // 监听主进程发送的日志信息
    if (window.electronAPI && window.electronAPI.memory && window.electronAPI.memory.onLog) {
      console.log('ChatManager: 开始监听日志信息');
      window.electronAPI.memory.onLog((message: string, type: string) => {
        addLog(message, type as 'error' | 'warn' | 'info' | 'debug');
      });
    }
    
    // 同时也监听直接的 IPC 事件
    if (window.electronAPI && window.electronAPI.on) {
      console.log('ChatManager: 开始监听直接 IPC 日志事件');
      const removeListener = window.electronAPI.on('memory:log', (message: string, type: string) => {
        addLog(message, type as 'error' | 'warn' | 'info' | 'debug');
      });
      
      return () => {
        removeListener();
      };
    }
  }, [addLog]);

  // 加载聊天会话列表
  const loadChatSessions = async () => {
    addLog('开始加载聊天会话列表...', 'info');
    setLoading(true);
    try {
      addLog('调用 getChatSessions API...', 'debug');
      const data = await window.electronAPI.memory.getChatSessions();
      addLog(`成功加载 ${data.length} 个聊天会话`, 'info');
      console.log('聊天会话数据:', data);
      // 检查数据格式
      if (Array.isArray(data)) {
        addLog(`数据是数组，长度为 ${data.length}`, 'debug');
        // 检查第一个元素的结构
        if (data.length > 0) {
          addLog(`第一个元素: ${JSON.stringify(data[0])}`, 'debug');
        }
        setChatSessions(data);
        // 转换为树形结构
        const tree = convertToTree(data);
        console.log('树形结构数据:', tree);
        addLog(`转换为树形结构，得到 ${tree.length} 个角色节点`, 'debug');
        setTreeData(tree);
        // 自动展开所有节点
        const expanded = tree.map(node => node.key);
        console.log('展开的节点:', expanded);
        setExpandedKeys(expanded);
      } else {
        addLog('数据不是数组，设置为空数组', 'error');
        console.error('聊天会话数据不是数组:', data);
        setChatSessions([]);
        setTreeData([]);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog('加载聊天会话失败', 'error', {
        error: error instanceof Error ? error : undefined,
        category: 'other',
        details: errorMsg
      });
      console.error('加载聊天会话失败:', error);
      message.error('加载聊天会话失败');
      setChatSessions([]);
      setTreeData([]);
    } finally {
      setLoading(false);
      addLog('聊天会话加载完成', 'info');
    }
  };

  // 将聊天会话列表转换为树形结构
  const convertToTree = (sessions: ChatSession[]): any[] => {
    const roleMap: Record<string, ChatSession[]> = {};
    
    // 按角色分组
    sessions.forEach(session => {
      if (!roleMap[session.characterName]) {
        roleMap[session.characterName] = [];
      }
      roleMap[session.characterName].push(session);
    });
    
    // 构建树形结构
    const tree: any[] = Object.entries(roleMap).map(([roleName, sessions]) => {
      const children = sessions.map(session => ({
        title: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{session.name}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {session.isProcessed && (
                  <Tag color="blue">✓ 已整理</Tag>
                )}
                {session.isTemplateAssociated && (
                  <Tag color="green">已关联模板</Tag>
                )}
              </div>
            </div>
            <span style={{ fontSize: '12px', color: '#999' }}>{session.messageCount} 条消息</span>
          </div>
        ),
        key: session.id,
        icon: <FileTextOutlined />,
        children: []
      }));
      
      return {
        title: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{roleName}</span>
            <span style={{ fontSize: '12px', color: '#999' }}>{sessions.length} 个会话</span>
          </div>
        ),
        key: roleName,
        icon: <FolderOutlined />,
        children
      };
    });
    
    return tree;
  };

  // 加载模板列表
  const loadTemplates = async () => {
    try {
      const data = await window.electronAPI.memory.getAllTemplates();
      setTemplates(data);
      if (data.length > 0 && !selectedTemplate) {
        setSelectedTemplate(data[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    loadChatSessions();
    loadTemplates();
  }, []);

  // 加载聊天记录
  const loadChatMessages = async (chatId: string) => {
    addLog(`开始加载聊天记录: ${chatId}`, 'info');
    try {
      addLog(`调用 getChatMessages API 加载聊天记录`, 'debug');
      const data = await window.electronAPI.memory.getChatMessages(chatId, 1, 100);
      addLog(`成功加载 ${data.messages.length} 条聊天记录`, 'info');
      console.log('聊天记录数据:', data);
      setMessages(data.messages);
      // 重置消息选择状态
      setSelectedMessages([]);
      setSelectAll(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog('加载聊天记录失败', 'error', {
        error: error instanceof Error ? error : undefined,
        category: 'other',
        details: errorMsg
      });
      console.error('加载聊天记录失败:', error);
    }
  };

  // 处理消息全选/取消全选
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedMessages([]);
    } else {
      setSelectedMessages(messages.map(msg => msg.id));
    }
    setSelectAll(!selectAll);
  };

  // 处理单个消息选择/取消选择
  const handleSelectMessage = (messageId: string) => {
    setSelectedMessages(prev => {
      if (prev.includes(messageId)) {
        return prev.filter(id => id !== messageId);
      } else {
        return [...prev, messageId];
      }
    });
  };

  // 选择聊天会话
  const handleSelectSession = (chatId: string) => {
    setSelectedSession(chatId);
    loadChatMessages(chatId);
  };

  // 搜索聊天记录
  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      message.warning('请输入搜索关键词');
      return;
    }

    setLoading(true);
    try {
      const results = await window.electronAPI.memory.searchChatMessages(
        searchKeyword,
        selectedSession || undefined
      );
      setMessages(results);
    } catch (error) {
      message.error('搜索失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // AI 处理聊天记录
  const handleProcessWithAI = async () => {
    if (!selectedSession) {
      message.warning('请先选择一个聊天会话');
      return;
    }

    if (!selectedTemplate) {
      message.warning('请先选择一个 Excel 模板');
      return;
    }

    setProcessing(true);
    try {
      // 获取设置（从 setting.ts 读取）
      const setting = {
        apiKey: '',
        apiUrl: 'http://127.0.0.1:5000/v1/chat/completions',
        modelName: 'qwen3.5-27b-heretic-v3'
      };

      const results = await window.electronAPI.memory.processChatWithAI(
        selectedSession,
        selectedTemplate,
        setting
      );

      setAiResults(results);
      setPreviewVisible(true);
      message.success('AI 处理完成，请预览结果');
    } catch (error) {
      message.error('AI 处理失败');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  // 应用 AI 处理结果
  const handleApplyResults = async () => {
    try {
      await window.electronAPI.memory.applyAIResults(selectedSession, aiResults);
      message.success('结果已应用到 Excel 表格');
      setPreviewVisible(false);
    } catch (error) {
      message.error('应用结果失败');
      console.error(error);
    }
  };

  // 处理关联模板
  const handleAssociateTemplate = async () => {
    if (!selectedTemplate) {
      message.error('请选择模板');
      return;
    }
    
    setAssociateModalVisible(false);
    setLoading(true);
    
    try {
      addLog(`开始关联模板 ${selectedTemplate} 到 ${selectedSessions.length} 个聊天会话`, 'info');
      
      for (const sessionId of selectedSessions) {
        await window.electronAPI.memory.associateTemplate(sessionId, selectedTemplate);
        addLog(`成功关联模板到聊天会话 ${sessionId}`, 'info');
      }
      
      message.success(`成功关联模板到 ${selectedSessions.length} 个聊天会话`);
      await loadChatSessions();
    } catch (error) {
      addLog('关联模板失败', 'error');
      console.error('关联模板失败:', error);
      message.error('关联模板失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理表格整理
  const handleProcessChats = async () => {
    if (selectedMessages.length === 0) {
      message.error('请选择聊天记录条目');
      return;
    }
    
    if (!selectedSession) {
      message.error('请选择聊天会话');
      return;
    }
    
    // 如果正在处理，显示之前的弹窗并返回
    if (isProcessing) {
      setProcessingModalVisible(true);
      return;
    }
    
    setProcessingModalVisible(true);
    setProcessingProgress(0);
    setProcessingStatus('准备处理...');
    setProcessingDetails([]);
    setIsProcessing(true);
    setShouldStopProcessing(false);
    setProcessingMessages(selectedMessages);
    setProcessingIndex(0);
    
    try {
      addLog(`开始整理 ${selectedMessages.length} 条聊天记录`, 'info');
      
      // 获取设置（从 settingStore 读取）
      const aiConfig = {
        apiKey: setting?.api_key || '',
        apiUrl: setting?.api_url || 'http://127.0.0.1:5000',
        modelName: setting?.model_name || 'qwen3.5-27b-heretic-v3',
        apiMode: setting?.api_mode || 'text_completion'
      };
      
      // 确保 modelName 不为空
      if (!aiConfig.modelName) {
        aiConfig.modelName = 'qwen3.5-27b-heretic-v3';
      }
      
      setProcessingConfig(aiConfig);
      console.log('使用 AI 配置:', aiConfig);
      
      // 计算每条消息的进度增量
      const progressIncrement = 100 / selectedMessages.length;
      
      // 逐条处理聊天记录
      for (let i = 0; i < selectedMessages.length; i++) {
        // 检查是否需要停止处理
        if (shouldStopProcessing) {
          setProcessingStatus('处理已停止');
          setProcessingDetails(prev => [...prev, '处理已停止']);
          addLog('表格整理已停止', 'info');
          break;
        }
        
        setProcessingIndex(i);
        const messageId = selectedMessages[i];
        const currentMessage = messages.find(msg => msg.id === messageId);
        
        if (currentMessage) {
          setProcessingStatus(`处理消息 ${i + 1}/${selectedMessages.length}...`);
          setProcessingDetails(prev => [...prev, `开始处理消息 ${i + 1}/${selectedMessages.length}`]);
          
          // 发送请求到AI服务器
          setProcessingStatus('发送请求到AI服务器...');
          setProcessingDetails(prev => [...prev, '正在发送请求到 AI 服务器...']);
          
          // 调用处理聊天记录的API，一次处理一条
          await window.electronAPI.memory.processChat(selectedSession, selectedTemplate, [messageId], aiConfig);
          
          // 更新进度
          const newProgress = Math.round((i + 1) * progressIncrement);
          setProcessingProgress(newProgress);
          
          addLog(`成功整理聊天记录 ${currentMessage.id}`, 'info');
          setProcessingDetails(prev => [...prev, `成功整理消息 ${i + 1}`]);
        }
      }
      
      if (!shouldStopProcessing) {
        setProcessingStatus('处理完成');
        setProcessingProgress(100);
        setProcessingDetails(prev => [...prev, '表格整理完成！']);
        
        // 更新聊天会话，标记为已整理
        if (selectedSession) {
          const updatedChatSessions = chatSessions.map(session => 
            session.id === selectedSession 
              ? { ...session, isProcessed: true } 
              : session
          );
          setChatSessions(updatedChatSessions);
          // 重新转换为树形结构
          const tree = convertToTree(updatedChatSessions);
          setTreeData(tree);
        }
        
        setTimeout(() => {
          setProcessingModalVisible(false);
          setIsProcessing(false);
          message.success(`成功整理 ${selectedMessages.length} 条聊天记录`);
        }, 1000);
      } else {
        setTimeout(() => {
          setProcessingModalVisible(false);
          setIsProcessing(false);
        }, 1000);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      
      addLog(`表格整理失败: ${errorMessage}`, 'error', {
        error: error instanceof Error ? error : undefined,
        category: 'other'
      });
      if (errorStack) {
        addLog(`错误堆栈: ${errorStack}`, 'error');
      }
      console.error('表格整理失败:', error);
      setProcessingStatus('处理失败');
      setProcessingDetails(prev => [...prev, `错误: ${errorMessage}`]);
      
      setTimeout(() => {
        setProcessingModalVisible(false);
        setIsProcessing(false);
        message.error(`表格整理失败: ${errorMessage}`);
      }, 1000);
    }
  };

  // 删除聊天会话
  const handleDeleteSession = async (chatId: string) => {
    try {
      await window.electronAPI.memory.deleteChatSession(chatId);
      message.success('删除成功');
      loadChatSessions();
      if (selectedSession === chatId) {
        setSelectedSession('');
        setMessages([]);
      }
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  // 停止表格整理
  const handleStopProcessing = () => {
    setShouldStopProcessing(true);
    addLog('用户请求停止表格整理', 'info');
  };

  // 处理表格预览
  const handlePreviewTable = async () => {
    if (!selectedSession) {
      message.error('请选择聊天会话');
      return;
    }

    setIsTableLoading(true);
    try {
      // 构建表格文件的绝对路径
      const chatlogDir = './data/chatlog';
      const safeChatId = selectedSession
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .replace(/\s+/g, '_')
        .replace(/@/g, '_')
        .replace(/-/g, '_')
        .replace(/:/g, '_')
        .replace(/\*/g, '_')
        .replace(/\?/g, '_')
        .replace(/"/g, '_')
        .replace(/</g, '_')
        .replace(/>/g, '_')
        .replace(/\|/g, '_');
      const jsonPath = `${chatlogDir}\${safeChatId}.json`;
      const directPath = `${chatlogDir}\${selectedSession}.json`;
      
      addLog(`开始预览聊天会话 ${selectedSession} 的表格`, 'info');
      addLog(`尝试读取表格文件: ${jsonPath} 或 ${directPath}`, 'debug');
      
      // 调用主进程 API 读取表格数据
      const data = await window.electronAPI.memory.getTableData(selectedSession);
      
      console.log('获取到的表格数据:', data);
      addLog(`获取到 ${data?.sheets?.length || 0} 个工作表`, 'debug');
      
      if (data && data.sheets && data.sheets.length > 0) {
        setSheets(data.sheets);
        setCurrentSheet(data.sheets[0]);
        const sheetData = data.data || {};
        const sheetHeaders = data.headers || {};
        setAllSheetData(sheetData);
        setAllSheetHeaders(sheetHeaders);
        const firstSheetData = sheetData[data.sheets[0]] || [];
        setTableData(firstSheetData);
        setTablePreviewVisible(true);
        addLog('表格预览加载成功', 'info');
        addLog(`第一个工作表 ${data.sheets[0]} 包含 ${firstSheetData.length} 条数据`, 'debug');
        console.log('获取到的表头信息:', sheetHeaders);
      } else {
        message.warning('表格文件不存在或为空');
        addLog(`表格文件不存在或为空，文件的地址是 ${jsonPath} 或 ${directPath}`, 'warn');
        console.log('表格文件不存在或为空，文件的地址是:', jsonPath, '或', directPath);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`表格预览失败: ${errorMsg}`, 'error', {
        error: error instanceof Error ? error : undefined,
        category: 'other'
      });
      console.error('表格预览失败:', error);
      message.error('表格预览失败');
    } finally {
      setIsTableLoading(false);
    }
  };

  // 切换表格页签
  const handleSheetChange = (sheetName: string) => {
    setCurrentSheet(sheetName);
    // 从已存储的所有页签数据中获取对应页签的数据
    const sheetData = allSheetData[sheetName] || [];
    setTableData(sheetData);
    addLog(`切换到工作表 ${sheetName}，共 ${sheetData.length} 条数据`, 'debug');
    console.log('切换到工作表', sheetName, '表头信息:', allSheetHeaders[sheetName]);
  };

  // 保存表格修改
  const handleSaveTable = async () => {
    if (!selectedSession || !currentSheet) {
      message.error('请选择聊天会话和表格页签');
      return;
    }

    try {
      // 调用主进程 API 保存表格数据
      await window.electronAPI.memory.saveTableData(selectedSession, currentSheet, tableData);
      message.success('表格保存成功');
      addLog('表格保存成功', 'info');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`表格保存失败: ${errorMsg}`, 'error', {
        error: error instanceof Error ? error : undefined,
        category: 'other'
      });
      console.error('表格保存失败:', error);
      message.error('表格保存失败');
    }
  };

  // 聊天会话表格列定义
  const sessionColumns = [
    {
      title: '角色',
      dataIndex: 'characterName',
      key: 'characterName',
      width: 150,
      ellipsis: true
    },
    {
      title: '会话名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true
    },
    {
      title: '消息数量',
      dataIndex: 'messageCount',
      key: 'messageCount',
      width: 100
    },
    {
      title: '最后更新时间',
      dataIndex: 'endTime',
      key: 'endTime',
      width: 180,
      render: (text: string) => new Date(text).toLocaleString('zh-CN')
    },
    {
      title: '预览',
      dataIndex: 'preview',
      key: 'preview',
      ellipsis: true
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: ChatSession) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleSelectSession(record.id)}
          >
            查看
          </Button>
          <Button
            danger
            type="link"
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteSession(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div className="memory-chat-manager">
      <Row gutter={16}>
        {/* 左侧：聊天会话列表 */}
        <Col span={12}>
          <Card title="聊天会话列表">
            <div className="session-list-header" style={{ marginBottom: 16 }}>
              <Space>
                <Button onClick={loadChatSessions}>刷新</Button>
              </Space>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Space>
                <Button 
                  type="primary" 
                  onClick={() => setAssociateModalVisible(true)}
                  disabled={selectedSessions.length === 0}
                >
                  关联模板
                </Button>
              </Space>
            </div>
            {loading && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Spin size="large" />
              </div>
            )}
            <Tree
              treeData={treeData}
              expandedKeys={expandedKeys}
              selectedKeys={selectedSessions}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              onSelect={(selectedKeys) => {
                // 只保留叶子节点（聊天会话）的选中状态
                const leafKeys = (selectedKeys as string[]).filter(key => key.includes('/'));
                setSelectedSessions(leafKeys);
                if (leafKeys.length === 1) {
                  handleSelectSession(leafKeys[0]);
                }
              }}
              onDoubleClick={(e, node) => {
                // 只有叶子节点（聊天会话）才可以双击查看
                if ((node.key as string).includes('/')) {
                  handleSelectSession(node.key as string);
                }
              }}
              className="chat-sessions-tree"
              checkable
              multiple
            />
            <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
              聊天会话数量: {chatSessions.length}
            </div>
          </Card>
        </Col>

        {/* 右侧：聊天记录详情 */}
        <Col span={12}>
          <Card
            title="聊天记录详情"
            extra={
              <Space>
                <Select
                  value={selectedTemplate}
                  onChange={setSelectedTemplate}
                  options={templates.map(t => ({ label: t.name, value: t.id }))}
                  style={{ width: 150 }}
                  placeholder="选择模板"
                />
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={handleProcessChats}
                  loading={processing}
                  disabled={selectedMessages.length === 0 || !selectedSession}
                >
                  表格整理
                </Button>
                <Button
                  type="default"
                  icon={<EyeOutlined />}
                  onClick={handlePreviewTable}
                  disabled={!selectedSession}
                >
                  表格预览
                </Button>
              </Space>
            }
          >
            {messages.length > 0 ? (
              <>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
                  <Button
                    type="link"
                    onClick={handleSelectAll}
                    icon={selectAll ? <CheckOutlined /> : undefined}
                  >
                    {selectAll ? '取消全选' : '全选'}
                  </Button>
                  <span style={{ marginLeft: 16, fontSize: 12, color: '#666' }}>
                    已选择 {selectedMessages.length} / {messages.length} 条记录
                  </span>
                </div>
                <List
                  dataSource={messages}
                  renderItem={(item) => (
                    <List.Item
                      style={{ 
                        border: selectedMessages.includes(item.id) ? '1px solid #1890ff' : '1px solid transparent',
                        borderRadius: 4,
                        padding: 12
                      }}
                    >
                      <div style={{ marginRight: 16 }}>
                        <input
                          type="checkbox"
                          checked={selectedMessages.includes(item.id)}
                          onChange={() => handleSelectMessage(item.id)}
                        />
                      </div>
                      <List.Item.Meta
                        title={
                          <Space>
                            <Tag color={item.role === 'user' ? 'blue' : 'green'}>
                              {item.role === 'user' ? '用户' : 'AI'}
                            </Tag>
                            <Text type="secondary">
                              {new Date(item.timestamp).toLocaleString('zh-CN')}
                            </Text>
                          </Space>
                        }
                        description={<Paragraph ellipsis={{ rows: 3 }}>{item.content}</Paragraph>}
                      />
                    </List.Item>
                  )}
                />
              </>
            ) : (
              <Empty description="暂无聊天记录" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 关联模板模态窗口 */}
      <Modal
        title="关联模板"
        open={associateModalVisible}
        onCancel={() => setAssociateModalVisible(false)}
        onOk={handleAssociateTemplate}
        okText="确定"
        cancelText="取消"
        width={600}
      >
        <Form layout="vertical">
          <Form.Item
            label="选择模板"
            name="templateId"
            rules={[{ required: true, message: '请选择模板' }]}
          >
            <Select
              value={selectedTemplate}
              onChange={setSelectedTemplate}
              placeholder="请选择模板"
              style={{ width: '100%' }}
            >
              {templates.map(template => (
                <Select.Option key={template.id} value={template.id}>
                  {template.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="关联说明">
            <TextArea
              rows={4}
              placeholder="请输入关联说明（可选）"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 表格整理模态窗口 */}
      <Modal
        title="表格整理"
        open={processingModalVisible}
        onCancel={() => setProcessingModalVisible(false)}
        footer={isProcessing ? (
          <Button danger onClick={handleStopProcessing}>
            停止
          </Button>
        ) : null}
        width={700}
      >
        <div style={{ padding: '20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
            <Spin tip={processingStatus} size="large" />
            <div style={{ marginLeft: 20, flex: 1 }}>
              <div style={{ marginBottom: 10 }}>处理进度: {processingProgress}%</div>
              <div style={{ width: '100%', height: 10, background: '#f0f0f0', borderRadius: 5 }}>
                <div 
                  style={{ 
                    width: `${processingProgress}%`, 
                    height: '100%', 
                    background: '#1890ff', 
                    borderRadius: 5 
                  }} 
                />
              </div>
            </div>
          </div>
          
          <div style={{ marginTop: 30 }}>
            <h4 style={{ marginBottom: 12, color: '#1890ff' }}>处理详情</h4>
            <div style={{ 
              maxHeight: 300, 
              overflowY: 'auto', 
              border: '1px solid #e8e8e8', 
              borderRadius: 4, 
              padding: 12 
            }}>
              {processingDetails.length > 0 ? (
                <List
                  dataSource={processingDetails}
                  renderItem={(item, index) => (
                    <List.Item style={{ padding: '4px 0' }}>
                      <span style={{ fontSize: 12, color: '#666' }}>
                        [{index + 1}] {item}
                      </span>
                    </List.Item>
                  )}
                />
              ) : (
                <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                  等待处理开始...
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* AI 处理结果预览 */}
      <Modal
        title="AI 处理结果预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        onOk={handleApplyResults}
        width={800}
        okText="应用结果"
        cancelText="取消"
        okButtonProps={{ icon: <CheckOutlined /> }}
      >
        {aiResults.map((result, index) => (
          <Card key={index} title={result.sheetName} size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary">{result.preview}</Text>
            <List
              dataSource={result.updates}
              size="small"
              renderItem={(update) => (
                <List.Item>
                  <Space orientation="vertical" style={{ width: '100%' }} size="small">
                    {Object.entries(update).map(([key, value]) => (
                      <div key={key}>
                        <Text strong>{key}: </Text>
                        <Text>{String(value)}</Text>
                      </div>
                    ))}
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        ))}
      </Modal>

      {/* 表格预览模态窗口 */}
      <Modal
        title="表格预览"
        open={tablePreviewVisible}
        onCancel={() => setTablePreviewVisible(false)}
        onOk={handleSaveTable}
        width={1000}
        okText="保存修改"
        cancelText="取消"
        okButtonProps={{ icon: <CheckOutlined /> }}
      >
        <div style={{ padding: '20px 0' }}>
          {isTableLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin tip="加载表格数据..." size="large" />
            </div>
          ) : (
            <>
              {/* 表格页签选择 */}
              <div style={{ marginBottom: 20 }}>
                <Space>
                  {sheets.map(sheet => (
                    <Button
                      key={sheet}
                      type={currentSheet === sheet ? 'primary' : 'default'}
                      onClick={() => handleSheetChange(sheet)}
                    >
                      {sheet}
                    </Button>
                  ))}
                </Space>
              </div>

              {/* 表格内容 */}
              <div style={{ overflowX: 'auto' }}>
                {allSheetHeaders[currentSheet] && allSheetHeaders[currentSheet].length > 0 ? (
                  <Table
                    dataSource={tableData.length > 0 ? tableData : [{ [allSheetHeaders[currentSheet][0]]: '' }]}
                    columns={allSheetHeaders[currentSheet].map(key => ({
                      title: key,
                      dataIndex: key,
                      key: key,
                      editable: true
                    }))}
                    rowKey={(record, index) => index}
                    pagination={{ pageSize: 20 }}
                    locale={{ emptyText: '表格为空' }}
                  />
                ) : tableData.length > 0 ? (
                  <Table
                    dataSource={tableData}
                    columns={Object.keys(tableData[0] || {}).map(key => ({
                      title: key,
                      dataIndex: key,
                      key: key,
                      editable: true
                    }))}
                    rowKey={(record, index) => index}
                    pagination={{ pageSize: 20 }}
                  />
                ) : (
                  <Empty description="表格为空" />
                )}
              </div>

              <div style={{ marginTop: 20, fontSize: 12, color: '#666' }}>
                提示：修改表格内容后点击"保存修改"按钮保存更改
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ChatManager;
