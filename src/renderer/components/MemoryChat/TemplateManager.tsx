/**
 * 表格模板管理组件
 * 用于管理表格模板的创建、编辑、删除等操作
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Table,
  Modal,
  Form,
  Input,
  Space,
  message,
  Popconfirm,
  Tabs,
  Tag,
  Divider,
  Row,
  Col,
  Typography,
  List,
  Empty,
  Select
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  HistoryOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { TABLE_STRUCTURE_CONFIG, DEFAULT_MEMORY_TEMPLATE } from './stMemoryTemplate';
import './MemoryChatManager.css';

// 表格类型默认字段配置
const TABLE_DEFAULT_FIELDS: Record<string, string[]> = {
  '时空表格': ['日期', '时间', '地点', '此地角色'],
  '物品表格': ['拥有人', '物品描述', '物品名', '重要原因'],
  '角色表格': ['角色名', '身份', '关系', '特征', '备注'],
  '社交表格': ['时间', '参与人', '事件', '结果', '备注'],
  '事件表格': ['时间', '事件名', '参与人', '描述', '影响', '备注']
};

const { Title, Text } = Typography;
const { TextArea } = Input;

interface ExcelTemplate {
  id: string;
  name: string;
  description: string;
  sheets: SheetTemplate[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

interface SheetTemplate {
  name: string;
  description: string;
  headers: string[];
  order: number;
}

const MemoryTemplateManager: React.FC = () => {
  const [templates, setTemplates] = useState<ExcelTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExcelTemplate | null>(null);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('list');
  const [activeSheetTab, setActiveSheetTab] = useState<string>('');
  const [sheetHeaders, setSheetHeaders] = useState<Record<string, string[]>>({});
  const [sheetDescriptions, setSheetDescriptions] = useState<Record<string, string>>({});
  const [bindingStatus, setBindingStatus] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // 加载所有模板
  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.memory.getAllTemplates();
      setTemplates(data);
      
      // 获取模板绑定状态
      const status = await window.electronAPI.memory.getTemplateBindingStatus();
      setBindingStatus(status);
    } catch (error) {
      message.error('加载模板失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // 打开新建/编辑模态框
  const handleOpenModal = (template?: ExcelTemplate) => {
    if (template) {
      setEditingTemplate(template);
      form.setFieldsValue({
        name: template.name,
        description: template.description
      });
      // 初始化表头数据
      const headers: Record<string, string[]> = {};
      const descriptions: Record<string, string> = {};
      template.sheets.forEach(sheet => {
        headers[sheet.name] = sheet.headers;
        descriptions[sheet.name] = sheet.description;
      });
      setSheetHeaders(headers);
      setSheetDescriptions(descriptions);
    } else {
      setEditingTemplate(null);
      form.resetFields();
      // 自动生成基于 st-memory-enhancement 插件规范的默认页签和字段
      const defaultHeaders: Record<string, string[]> = {};
      const defaultDescriptions: Record<string, string> = {};
      TABLE_STRUCTURE_CONFIG.forEach(config => {
        defaultHeaders[config.tableName] = config.columns;
        // 使用默认模板中的描述
        const defaultSheet = DEFAULT_MEMORY_TEMPLATE.sheets.find(s => s.name === config.tableName);
        defaultDescriptions[config.tableName] = defaultSheet?.description || '';
      });
      setSheetHeaders(defaultHeaders);
      setSheetDescriptions(defaultDescriptions);
      // 设置第一个页签为活动页签
      setActiveSheetTab(Object.keys(defaultHeaders)[0] || '');
    }
    setModalVisible(true);
  };

  // 保存模板
  const handleSaveTemplate = async () => {
    console.log('开始保存模板...');
    try {
      console.log('验证表单...');
      // 手动获取表单值，不使用 validateFields
      const name = form.getFieldValue('name');
      const description = form.getFieldValue('description');
      
      console.log('表单值:', { name, description });
      
      // 手动验证
      if (!name || !name.trim()) {
        message.error('请输入模板名称');
        return;
      }
      if (!description || !description.trim()) {
        message.error('请输入模板描述');
        return;
      }
      
      // 检查是否有表格数据
      if (Object.keys(sheetHeaders).length === 0) {
        message.error('请至少添加一个表格页签');
        return;
      }
      
      console.log('准备表格数据...');
      const sheets = Object.entries(sheetHeaders).map(([name, headers], index) => ({
        name,
        description: sheetDescriptions[name] || '',
        headers,
        order: index + 1
      }));
      console.log('表格数据:', sheets);

      // 构建模板数据
      const templateData = {
        name: name.trim(),
        description: description.trim(),
        sheets
      };
      console.log('模板数据:', templateData);

      if (editingTemplate) {
        // 更新现有模板
        console.log('更新现有模板:', editingTemplate.id);
        try {
          const updated = await window.electronAPI.memory.updateTemplate(editingTemplate.id, templateData);
          console.log('模板更新结果:', updated);
          console.log('模板更新结果类型:', typeof updated);
          console.log('模板更新结果是否为空:', updated === null);
          console.log('模板更新结果是否为对象:', updated !== null && typeof updated === 'object');
          if (updated !== null && typeof updated === 'object') {
            message.success('模板更新成功');
            loadTemplates();
          } else {
            message.error('模板更新失败');
          }
        } catch (apiError) {
          console.error('API调用失败:', apiError);
          message.error('保存模板失败，请检查网络连接');
        }
      } else {
        // 创建新模板
        console.log('创建新模板...');
        try {
          const created = await window.electronAPI.memory.createTemplate(templateData);
          console.log('模板创建结果:', created);
          message.success('模板创建成功');
          loadTemplates();
        } catch (apiError) {
          console.error('API调用失败:', apiError);
          message.error('保存模板失败，请检查网络连接');
        }
      }
      console.log('保存成功，关闭模态框');
      setModalVisible(false);
    } catch (error: any) {
      console.error('保存模板失败:', error);
      message.error('保存模板失败，请检查表单填写是否正确');
    }
  };

  // 删除模板
  const handleDeleteTemplate = async (templateId: string) => {
    try {
      const success = await window.electronAPI.memory.deleteTemplate(templateId);
      if (success) {
        message.success('模板删除成功');
        loadTemplates();
      }
    } catch (error) {
      message.error('删除模板失败');
      console.error(error);
    }
  };

  // 添加新页签
  const handleAddSheet = () => {
    const sheetName = `新页签${Object.keys(sheetHeaders).length + 1}`;
    const newHeaders = {
      ...sheetHeaders,
      [sheetName]: ['字段 1', '字段 2', '字段 3']
    };
    const newDescriptions = {
      ...sheetDescriptions,
      [sheetName]: ''
    };
    setSheetHeaders(newHeaders);
    setSheetDescriptions(newDescriptions);
    // 设置新页签为活动页签
    setActiveSheetTab(sheetName);
  };

  // 删除页签
  const handleRemoveSheet = (sheetName: string) => {
    const newHeaders = { ...sheetHeaders };
    delete newHeaders[sheetName];
    const newDescriptions = { ...sheetDescriptions };
    delete newDescriptions[sheetName];
    setSheetHeaders(newHeaders);
    setSheetDescriptions(newDescriptions);
    
    // 如果删除的是当前活动页签，设置新的活动页签
    if (activeSheetTab === sheetName) {
      const remainingTabs = Object.keys(newHeaders);
      setActiveSheetTab(remainingTabs[0] || '');
    }
  };

  // 添加表头字段
  const handleAddHeader = (sheetName: string) => {
    setSheetHeaders({
      ...sheetHeaders,
      [sheetName]: [...sheetHeaders[sheetName], `字段${sheetHeaders[sheetName].length + 1}`]
    });
  };

  // 删除表头字段
  const handleRemoveHeader = (sheetName: string, index: number) => {
    const newHeaders = sheetHeaders[sheetName].filter((_, i) => i !== index);
    setSheetHeaders({
      ...sheetHeaders,
      [sheetName]: newHeaders
    });
  };

  // 更新表头字段
  const handleUpdateHeader = (sheetName: string, index: number, value: string) => {
    const newHeaders = [...sheetHeaders[sheetName]];
    newHeaders[index] = value;
    setSheetHeaders({
      ...sheetHeaders,
      [sheetName]: newHeaders
    });
  };

  // 过滤模板
  const filteredTemplates = templates.filter(template => {
    if (filterStatus === 'all') {
      return true;
    } else if (filterStatus === 'bound') {
      return bindingStatus[template.id] || false;
    } else if (filterStatus === 'unbound') {
      return !(bindingStatus[template.id] || false);
    }
    return true;
  });

  // 表格列定义
  const columns = [
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name',
      width: 200
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '页签数量',
      key: 'sheets',
      width: 100,
      render: (_: any, record: ExcelTemplate) => record.sheets.length
    },
    {
      title: '绑定状态',
      key: 'bindingStatus',
      width: 100,
      render: (_: any, record: ExcelTemplate) => {
        const isBound = bindingStatus[record.id] || false;
        return (
          <Tag color={isBound ? 'green' : 'default'}>
            {isBound ? '已绑定' : '未绑定'}
          </Tag>
        );
      }
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 80
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (text: string) => new Date(text).toLocaleString('zh-CN')
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: ExcelTemplate) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            icon={<CopyOutlined />}
            onClick={() => handleOpenModal(record)}
          >
            复制
          </Button>
          <Popconfirm
            title="确定要删除此模板吗？"
            onConfirm={() => handleDeleteTemplate(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div className="memory-template-manager">
      <Card>
        <div className="template-manager-header">
          <Title level={3}>表格模板管理</Title>
          <Space>
            <Select
              value={filterStatus}
              onChange={(value) => setFilterStatus(value)}
              style={{ width: 150 }}
            >
              <Select.Option value="all">全部</Select.Option>
              <Select.Option value="bound">已绑定</Select.Option>
              <Select.Option value="unbound">未绑定</Select.Option>
            </Select>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => handleOpenModal()}
            >
              新建模板
            </Button>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={filteredTemplates}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10 }}
        />

        <Modal
          title={editingTemplate ? '编辑模板' : '新建模板'}
          open={modalVisible}
          onCancel={() => setModalVisible(false)}
          onOk={() => handleSaveTemplate()}
          width={800}
          okText="保存"
          cancelText="取消"
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="模板名称"
              rules={[{ required: true, message: '请输入模板名称' }]}
            >
              <Input placeholder="请输入模板名称" />
            </Form.Item>

            <Form.Item
              name="description"
              label="模板描述"
              rules={[{ required: true, message: '请输入模板描述' }]}
            >
              <TextArea rows={3} placeholder="请输入模板描述" />
            </Form.Item>
          </Form>

          <Divider>页签配置</Divider>

          <div className="sheet-config">
            <Space style={{ marginBottom: 16 }}>
              <Button icon={<PlusOutlined />} onClick={handleAddSheet}>
                添加页签
              </Button>
            </Space>

            <Tabs
              type="editable-card"
              activeKey={activeSheetTab || Object.keys(sheetHeaders)[0] || ''}
              onChange={(key) => {
                if (typeof key === 'string') {
                  setActiveSheetTab(key);
                  // 处理页签切换，确保字段配置正确
                  const currentHeaders = sheetHeaders[key];
                  const defaultFields = TABLE_DEFAULT_FIELDS[key];
                  
                  // 如果当前页签是预设表格类型且字段配置不匹配默认配置，则更新字段
                  if (defaultFields && JSON.stringify(currentHeaders) !== JSON.stringify(defaultFields)) {
                    const newHeaders = { ...sheetHeaders };
                    newHeaders[key] = defaultFields;
                    setSheetHeaders(newHeaders);
                  }
                }
              }}
              onEdit={(targetKey, action, newName) => {
                if (action === 'add') {
                  handleAddSheet();
                } else if (action === 'remove' && typeof targetKey === 'string') {
                  handleRemoveSheet(targetKey);
                } else if (action === 'edit' && typeof targetKey === 'string' && newName) {
                  // 处理页签名称编辑
                  const newHeaders = { ...sheetHeaders };
                  const newDescriptions = { ...sheetDescriptions };
                  const oldHeaders = newHeaders[targetKey];
                  const oldDescription = newDescriptions[targetKey];
                  delete newHeaders[targetKey];
                  delete newDescriptions[targetKey];
                  
                  // 检查新名称是否匹配预设表格类型
                  const defaultFields = TABLE_DEFAULT_FIELDS[newName] || oldHeaders || ['字段 1', '字段 2', '字段 3'];
                  newHeaders[newName] = defaultFields;
                  newDescriptions[newName] = oldDescription || '';
                  
                  setSheetHeaders(newHeaders);
                  setSheetDescriptions(newDescriptions);
                  
                  // 如果修改的是当前活动页签，更新活动页签
                  if (activeSheetTab === targetKey) {
                    setActiveSheetTab(newName);
                  }
                }
              }}
              items={Object.entries(sheetHeaders).map(([sheetName, headers]) => ({
                key: sheetName,
                label: sheetName,
                children: (
                  <div className="sheet-headers">
                    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                      <div>
                        <Text strong>表格用途描述</Text>
                        <TextArea
                          rows={3}
                          value={sheetDescriptions[sheetName] || ''}
                          onChange={(e) => {
                            setSheetDescriptions({
                              ...sheetDescriptions,
                              [sheetName]: e.target.value
                            });
                          }}
                          placeholder="请输入表格用途说明，帮助AI更好地理解表格功能"
                          style={{ marginTop: 8 }}
                        />
                      </div>
                      <Divider style={{ margin: '8px 0' }} />
                      <div>
                        <Text strong>字段配置</Text>
                        <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }} size="small">
                          {headers.map((header, index) => (
                            <Space key={index} style={{ width: '100%' }}>
                              <Input
                                value={header}
                                onChange={(e) => handleUpdateHeader(sheetName, index, e.target.value)}
                                style={{ flex: 1 }}
                                placeholder="字段名称"
                              />
                              <Button
                                danger
                                type="text"
                                icon={<DeleteOutlined />}
                                onClick={() => handleRemoveHeader(sheetName, index)}
                                disabled={headers.length === 1}
                              />
                            </Space>
                          ))}
                          <Button
                            icon={<PlusOutlined />}
                            onClick={() => handleAddHeader(sheetName)}
                          >
                            添加字段
                          </Button>
                        </Space>
                      </div>
                    </Space>
                  </div>
                )
              }))}
            />
          </div>
        </Modal>
      </Card>
    </div>
  );
};

export default MemoryTemplateManager;
