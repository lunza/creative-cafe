/**
 * 角色卡聊天记录管理组件
 * 以列表视图展示角色卡聊天记录，支持编辑、向量化、关联模板、表格整理和删除操作
 */

import React, { useState, useEffect } from 'react';
import { useSettingStore } from '../../stores/settingStore';
import {
  Button,
  Input,
  Space,
  message,
  Select,
  Modal,
  List,
  Tag,
  Typography,
  Divider,
  Spin,
  Empty,
  Form,
  Avatar,
  Popconfirm,
  Table
} from 'antd';
import {
  ThunderboltOutlined,
  EyeOutlined,
  DeleteOutlined,
  CheckOutlined,
  ReloadOutlined,
  EditOutlined,
  LinkOutlined,
  TableOutlined,
  UserOutlined
} from '@ant-design/icons';
import { useLogStore } from '../../stores/logStore';
import type { CharacterChatRecord, TableTemplate } from '../../types/memory';
import './MemoryChatManager.css';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  chatId: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const ChatManager: React.FC = () => {
  const [records, setRecords] = useState<CharacterChatRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TableTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [currentRecord, setCurrentRecord] = useState<CharacterChatRecord | null>(null);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const [associateModalVisible, setAssociateModalVisible] = useState(false);
  const [associateLoading, setAssociateLoading] = useState(false);

  const [processingModalVisible, setProcessingModalVisible] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingDetails, setProcessingDetails] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [shouldStopProcessing, setShouldStopProcessing] = useState(false);
  const [processingMessages, setProcessingMessages] = useState<ChatMessage[]>([]);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [processingConfig, setProcessingConfig] = useState<any>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);

  const [tablePreviewVisible, setTablePreviewVisible] = useState(false);
  const [tableData, setTableData] = useState<any[]>([]);
  const [currentSheet, setCurrentSheet] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [allSheetData, setAllSheetData] = useState<Record<string, any[]>>({});
  const [allSheetHeaders, setAllSheetHeaders] = useState<Record<string, string[]>>({});
  const [isTableLoading, setIsTableLoading] = useState(false);

  const [vectorizingRecord, setVectorizingRecord] = useState<string | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<string | null>(null);

  const { addLog } = useLogStore();
  const { setting, fetchSetting } = useSettingStore();

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.memory && window.electronAPI.memory.onLog) {
      console.log('ChatManager: 开始监听日志信息');
      window.electronAPI.memory.onLog((message: string, type: string) => {
        addLog(message, type as 'error' | 'warn' | 'info' | 'debug');
      });
    }

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

  const loadCharacterChatRecords = async () => {
    addLog('开始加载角色卡聊天记录...', 'info');
    setLoading(true);
    try {
      const data = await window.electronAPI.memory.getCharacterChatRecords();
      addLog(`成功加载 ${data.length} 条角色卡聊天记录`, 'info');

      const recordsWithThumbnails = await Promise.all(
        data.map(async (record: CharacterChatRecord) => {
          try {
            const thumbnailPath = await window.electronAPI.memory.getCharacterThumbnail(record.characterCardName);
            return { ...record, thumbnailPath };
          } catch {
            return { ...record, thumbnailPath: null };
          }
        })
      );

      setRecords(recordsWithThumbnails);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog('加载角色卡聊天记录失败', 'error', {
        error: error instanceof Error ? error : undefined,
        category: 'other',
        details: errorMsg
      });
      console.error('加载角色卡聊天记录失败:', error);
      message.error('加载角色卡聊天记录失败');
      setRecords([]);
    } finally {
      setLoading(false);
      addLog('角色卡聊天记录加载完成', 'info');
    }
  };

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
    loadCharacterChatRecords();
    loadTemplates();
  }, []);

  const handleOpenEdit = async (record: CharacterChatRecord) => {
    setCurrentRecord(record);
    setEditModalVisible(true);
    setEditLoading(true);
    try {
      const data = await window.electronAPI.memory.getCharacterChatRecord(record.fileName);
      setEditContent(JSON.stringify(data, null, 2));
    } catch (error) {
      message.error('加载聊天记录内容失败');
      setEditContent('');
    } finally {
      setEditLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!currentRecord) return;
    setEditSaving(true);
    try {
      const result = await window.electronAPI.memory.saveCharacterChatRecord(currentRecord.fileName, editContent);
      if (result.success) {
        message.success('保存成功');
        setEditModalVisible(false);
        loadCharacterChatRecords();
      } else {
        message.error('保存失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      message.error('保存失败: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setEditSaving(false);
    }
  };

  const handleVectorize = async (record: CharacterChatRecord) => {
    setVectorizingRecord(record.fileName);
    try {
      const result = await window.electronAPI.memory.vectorizeCharacterChat(record.fileName);
      if (result.success) {
        message.success('向量化成功');
        addLog(`向量化成功: ${record.fileName}, ${result.messagesVectorized} 条消息`, 'info');
      } else {
        message.error('向量化失败: ' + (result.error || '未知错误'));
        addLog(`向量化失败: ${record.fileName}`, 'error');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error('向量化失败: ' + errMsg);
      addLog(`向量化失败: ${record.fileName} - ${errMsg}`, 'error');
    } finally {
      setVectorizingRecord(null);
    }
  };

  const handleOpenAssociate = (record: CharacterChatRecord) => {
    setCurrentRecord(record);
    setAssociateModalVisible(true);
  };

  const handleAssociateTemplate = async () => {
    if (!currentRecord) return;
    if (!selectedTemplate) {
      message.error('请选择模板');
      return;
    }

    setAssociateLoading(true);
    try {
      addLog(`开始关联模板 ${selectedTemplate} 到 ${currentRecord.characterCardName}`, 'info');
      await window.electronAPI.memory.associateTemplate(currentRecord.characterCardName, selectedTemplate);
      addLog(`成功关联模板到 ${currentRecord.characterCardName}`, 'info');
      message.success('关联模板成功');
      setAssociateModalVisible(false);
    } catch (error) {
      addLog('关联模板失败', 'error');
      console.error('关联模板失败:', error);
      message.error('关联模板失败');
    } finally {
      setAssociateLoading(false);
    }
  };

  const handleOpenTableOrganize = async (record: CharacterChatRecord) => {
    setCurrentRecord(record);
    try {
      const chatData = await window.electronAPI.memory.getCharacterChatRecord(record.fileName);
      if (!chatData || !chatData.messages || chatData.messages.length === 0) {
        message.warning('该聊天记录没有消息');
        return;
      }

      const messages: ChatMessage[] = chatData.messages.map((msg: any, index: number) => ({
        id: `${record.characterCardName}_msg_${index}`,
        role: msg.role || 'user',
        content: msg.content || '',
        timestamp: msg.timestamp || new Date().toISOString(),
        chatId: record.characterCardName
      }));

      const messageIds = messages.map(m => m.id);
      setProcessingMessages(messages);
      setSelectedMessageIds(messageIds);
      setProcessingModalVisible(true);
      setProcessingProgress(0);
      setProcessingStatus('准备处理...');
      setProcessingDetails([]);
      setIsProcessing(true);
      setShouldStopProcessing(false);
      setProcessingIndex(0);

      addLog(`开始整理 ${messages.length} 条聊天记录`, 'info');

      const aiConfig = {
        apiKey: setting?.api_key || '',
        apiUrl: setting?.api_url || 'http://127.0.0.1:5000',
        modelName: setting?.model_name || 'qwen3.5-27b-heretic-v3',
        apiMode: setting?.api_mode || 'text_completion'
      };

      if (!aiConfig.modelName) {
        aiConfig.modelName = 'qwen3.5-27b-heretic-v3';
      }

      setProcessingConfig(aiConfig);
      console.log('使用 AI 配置:', aiConfig);

      const progressIncrement = 100 / messageIds.length;

      for (let i = 0; i < messageIds.length; i++) {
        if (shouldStopProcessing) {
          setProcessingStatus('处理已停止');
          setProcessingDetails(prev => [...prev, '处理已停止']);
          addLog('表格整理已停止', 'info');
          break;
        }

        setProcessingIndex(i);
        const messageId = messageIds[i];
        const currentMessage = messages.find(msg => msg.id === messageId);

        if (currentMessage) {
          setProcessingStatus(`处理消息 ${i + 1}/${messageIds.length}...`);
          setProcessingDetails(prev => [...prev, `开始处理消息 ${i + 1}/${messageIds.length}`]);

          setProcessingStatus('发送请求到AI服务器...');
          setProcessingDetails(prev => [...prev, '正在发送请求到 AI 服务器...']);

          await window.electronAPI.memory.processChat(record.characterCardName, selectedTemplate, [messageId], aiConfig);

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

        setTimeout(() => {
          setProcessingModalVisible(false);
          setIsProcessing(false);
          message.success(`成功整理 ${messageIds.length} 条聊天记录`);
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

  const handleStopProcessing = () => {
    setShouldStopProcessing(true);
    addLog('用户请求停止表格整理', 'info');
  };

  const handleDelete = async (record: CharacterChatRecord) => {
    setDeletingRecord(record.fileName);
    try {
      const result = await window.electronAPI.memory.deleteCharacterChatRecord(record.fileName, record.characterCardName);
      if (result.success) {
        message.success('删除成功');
        loadCharacterChatRecords();
      } else {
        message.error('删除失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      message.error('删除失败: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setDeletingRecord(null);
    }
  };

  const handlePreviewTable = async (record: CharacterChatRecord) => {
    setCurrentRecord(record);
    setIsTableLoading(true);
    try {
      const data = await window.electronAPI.memory.getTableData(record.characterCardName);

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
        addLog('表格文件不存在或为空', 'warn');
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

  const handleSheetChange = (sheetName: string) => {
    setCurrentSheet(sheetName);
    const sheetData = allSheetData[sheetName] || [];
    setTableData(sheetData);
    addLog(`切换到工作表 ${sheetName}，共 ${sheetData.length} 条数据`, 'debug');
    console.log('切换到工作表', sheetName, '表头信息:', allSheetHeaders[sheetName]);
  };

  const handleSaveTable = async () => {
    if (!currentRecord || !currentSheet) {
      message.error('请选择聊天记录和表格页签');
      return;
    }

    try {
      await window.electronAPI.memory.saveTableData(currentRecord.characterCardName, currentSheet, tableData);
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

  return (
    <div className="chat-record-manager">
      <div className="chat-record-header">
        <Title level={4}>角色卡聊天记录</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadCharacterChatRecords}>刷新</Button>
          <span>共 {records.length} 条记录</span>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      ) : records.length === 0 ? (
        <Empty description="暂无聊天记录" />
      ) : (
        <List
          className="chat-record-list"
          dataSource={records}
          renderItem={(record) => (
            <List.Item
              actions={[
                <Space key="actions" size="small" className="chat-record-actions">
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleOpenEdit(record)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={vectorizingRecord === record.fileName}
                    onClick={() => handleVectorize(record)}
                  >
                    向量化
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={() => handleOpenAssociate(record)}
                  >
                    关联模板
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<TableOutlined />}
                    onClick={() => handleOpenTableOrganize(record)}
                  >
                    表格整理
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => handlePreviewTable(record)}
                  >
                    表格预览
                  </Button>
                  <Popconfirm
                    title="确定要删除该聊天记录吗？此操作不可恢复"
                    onConfirm={() => handleDelete(record)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button
                      danger
                      type="link"
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={deletingRecord === record.fileName}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ]}
            >
              <List.Item.Meta
                className="chat-record-item-meta"
                avatar={
                  <Avatar
                    src={record.thumbnailPath ? `file://${record.thumbnailPath}` : undefined}
                    icon={<UserOutlined />}
                    size={48}
                  />
                }
                title={<span>{record.characterCardName || record.fileName}</span>}
                description={
                  <Space split={<Divider type="vertical" />}>
                    <span>文件: {record.fileName}</span>
                    <span>大小: {formatFileSize(record.fileSize)}</span>
                    <span>消息: {record.messageCount} 条</span>
                    <span>更新: {new Date(record.lastModified).toLocaleString('zh-CN')}</span>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}

      <Modal
        title="编辑聊天记录"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleSaveEdit}
        okText="保存"
        cancelText="取消"
        width={800}
        confirmLoading={editSaving}
      >
        {editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin tip="加载中..." />
          </div>
        ) : (
          <TextArea
            rows={20}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            style={{ fontFamily: 'monospace' }}
          />
        )}
      </Modal>

      <Modal
        title="关联模板"
        open={associateModalVisible}
        onCancel={() => setAssociateModalVisible(false)}
        onOk={handleAssociateTemplate}
        okText="确定"
        cancelText="取消"
        width={600}
        confirmLoading={associateLoading}
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
          {currentRecord && (
            <Form.Item label="关联角色">
              <Text>{currentRecord.characterCardName || currentRecord.fileName}</Text>
            </Form.Item>
          )}
        </Form>
      </Modal>

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

              <div style={{ overflowX: 'auto' }}>
                {allSheetHeaders[currentSheet] && allSheetHeaders[currentSheet].length > 0 ? (
                  <Table
                    dataSource={tableData.length > 0 ? tableData : [{ [allSheetHeaders[currentSheet][0]]: '' }]}
                    columns={allSheetHeaders[currentSheet].map(key => ({
                      title: key,
                      dataIndex: key,
                      key: key
                    }))}
                    rowKey={(_, index) => String(index)}
                    pagination={{ pageSize: 20 }}
                    locale={{ emptyText: '表格为空' }}
                  />
                ) : tableData.length > 0 ? (
                  <Table
                    dataSource={tableData}
                    columns={Object.keys(tableData[0] || {}).map(key => ({
                      title: key,
                      dataIndex: key,
                      key: key
                    }))}
                    rowKey={(_, index) => String(index)}
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
