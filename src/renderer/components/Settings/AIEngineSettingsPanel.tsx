import React from 'react';
import { Card, Form, Input, Select, Button, Space, Alert, AutoComplete, Modal, Table, Tag, Tooltip, Switch } from 'antd';
import { SettingOutlined, SaveOutlined, PlusOutlined, EditOutlined, CopyOutlined, SearchOutlined, SyncOutlined, EyeOutlined, BulbOutlined, ToolOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { useAIEngineSettings } from './hooks/useAIEngineSettings';
import { AIEngineSetting, AIEngineCapabilities } from '../../types/setting';

/**
 * 渲染引擎能力徽章（文本/视觉/思维链/工具调用）。
 * Spec: add-model-capability-detection-and-image-recognition / Task 5.1
 */
const renderCapabilityBadges = (capabilities?: AIEngineCapabilities) => {
  if (!capabilities) return null;
  return (
    <Space size={4}>
      <Tooltip title="文本生成">
        <Tag icon={<EditOutlined />} color="blue" style={{ margin: 0 }} />
      </Tooltip>
      {capabilities.supportsVision && (
        <Tooltip title="视觉/图片识别">
          <Tag icon={<EyeOutlined />} color="green" style={{ margin: 0 }} />
        </Tooltip>
      )}
      {capabilities.supportsThinking && (
        <Tooltip title="思维链/推理">
          <Tag icon={<BulbOutlined />} color="purple" style={{ margin: 0 }} />
        </Tooltip>
      )}
      {capabilities.supportsToolCalling && (
        <Tooltip title="工具调用">
          <Tag icon={<ToolOutlined />} color="orange" style={{ margin: 0 }} />
        </Tooltip>
      )}
    </Space>
  );
};

interface AIEngineSettingsPanelProps {
  form: ReturnType<typeof Form.useForm>[0];
}

/**
 * AI 引擎设置面板
 *
 * 从 Settings.tsx 提取，包含三部分 UI：
 * 1. 主卡片：引擎选择 + 当前引擎参数表单 + 测试连通性
 * 2. 引擎管理模态框：引擎列表（增删改查/复制/设默认）+ 引擎编辑表单
 * 3. 复制重命名模态框
 *
 * 所有业务逻辑由 useAIEngineSettings Hook 提供。
 */
const AIEngineSettingsPanel: React.FC<AIEngineSettingsPanelProps> = ({ form }) => {
  const { setting } = useSettingStore();
  const {
    activeEngine,
    engines,
    showEngineModal,
    editingEngine,
    testResult,
    engineTestResult,
    engineModelOptions,
    engineModelLoading,
    showRenameModal,
    copyingEngine,
    newEngineName,
    nameError,
    copiedEngineId,
    engineForm,
    handleAddEngine,
    handleEditEngine,
    handleSaveEngine,
    handleDeleteEngine,
    handleSetDefaultEngine,
    handleEngineChange,
    handleCloseEngineModal,
    handleOpenEngineManager,
    handleCopyEngine,
    handleConfirmCopy,
    handleCancelCopy,
    handleEngineNameChange,
    handleTestConnection,
    handleTestEngineConnection,
    handleFetchEngineModels,
  } = useAIEngineSettings();

  return (
    <>
      <Card title="AI引擎设置" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item label="引擎选择">
            <Space style={{ width: '100%' }}>
              <Select
                style={{ flex: 1, minWidth: '200px' }}
                value={setting?.activeEngineId}
                onChange={handleEngineChange}
                options={engines.map(engine => ({
                  label: engine.name,
                  value: engine.id,
                  capabilities: engine.capabilities,
                }))}
                optionRender={(option) => (
                  <Space size={6}>
                    <span>{option.label}</span>
                    {renderCapabilityBadges(option.data?.capabilities)}
                  </Space>
                )}
                labelRender={(props) => {
                  const engine = engines.find(e => e.id === props.value);
                  return (
                    <Space size={4}>
                      <span>{props.label}</span>
                      {renderCapabilityBadges(engine?.capabilities)}
                    </Space>
                  );
                }}
                placeholder="请选择 AI 引擎"
              />
              <Button
                icon={<SettingOutlined />}
                onClick={handleOpenEngineManager}
              >
                管理引擎
              </Button>
            </Space>
          </Form.Item>

          <Form.Item label="API地址" name="api_url">
            <Input placeholder="例如: http://127.0.0.1:5000" />
          </Form.Item>

          <Form.Item label="API密钥" name="api_key">
            <Input placeholder="请输入API密钥（可选）" />
          </Form.Item>

          <Form.Item label="模型名称" name="model_name">
            <AutoComplete
              options={engineModelOptions}
              placeholder="例如: qwen3.5-27b-heretic-v3"
              filterOption={false}
            />
          </Form.Item>

          <Form.Item label="API模式" name="api_mode">
            <Select
              options={[
                { label: '文本补全', value: 'text_completion' },
                { label: '聊天补全', value: 'chat_completion' },
              ]}
            />
          </Form.Item>

          <Form.Item label="API密钥传输方式" name="api_key_transmission">
            <Select
              options={[
                { label: '请求头 (Authorization: Bearer)', value: 'header' },
                { label: '请求体', value: 'body' },
              ]}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={() => handleFetchEngineModels(form)}
              loading={engineModelLoading}
            >
              获取模型列表
            </Button>
          </Form.Item>

          <Form.Item label="最大令牌数 (max_tokens)" name="max_tokens">
            <Input type="number" min={1} max={1000000} placeholder="范围: 1-1000000，例如: 10240" />
          </Form.Item>

          <Form.Item label="温度参数 (temperature)" name="temperature">
            <Input type="number" min={0} max={2} step={0.1} placeholder="范围: 0-2，例如: 0.7" />
          </Form.Item>

          <Form.Item label="Top P (top_p)" name="top_p">
            <Input type="number" min={0} max={1} step={0.05} placeholder="范围: 0-1，例如: 0.95" />
          </Form.Item>

          <Form.Item label="Top K (top_k)" name="top_k">
            <Input type="number" min={0} max={200} step={1} placeholder="范围: 0-200，例如: 40" />
          </Form.Item>

          <Form.Item label="Min P (min_p)" name="min_p">
            <Input type="number" min={0} max={1} step={0.05} placeholder="范围: 0-1，例如: 0.1" />
          </Form.Item>

          <Form.Item label="频率惩罚 (frequency_penalty)" name="frequency_penalty">
            <Input type="number" min={-2} max={2} step={0.1} placeholder="范围: -2到2，例如: 0" />
          </Form.Item>

          <Form.Item label="存在惩罚 (presence_penalty)" name="presence_penalty">
            <Input type="number" min={-2} max={2} step={0.1} placeholder="范围: -2到2，例如: 0" />
          </Form.Item>

          <Form.Item label="生成数量 (n)" name="n">
            <Input type="number" min={1} max={10} step={1} placeholder="范围: 1-10，例如: 1" />
          </Form.Item>

          <Form.Item
            label="Agent 模式"
            name="enableAgentMode"
            valuePropName="checked"
            initialValue={false}
            extra={<span style={{ color: '#999', fontSize: 12 }}>启用 Agent 模式（需模型支持工具调用，否则自动降级为文本模式）</span>}
          >
            <Switch />
          </Form.Item>

          <Form.Item label="系统提示词 (system_prompt)" name="system_prompt">
            <Input.TextArea
              rows={4}
              placeholder="输入系统提示词，用于设置 AI 的行为和角色"
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                icon={<SyncOutlined />}
                onClick={async () => {
                  try {
                    const values = await form.validateFields();
                    handleTestConnection(values);
                  } catch {
                    // 表单校验失败，忽略
                  }
                }}
              >
                测试连通性
              </Button>
              {activeEngine && activeEngine.api_url && (
                <span style={{ color: '#666', fontSize: 12 }}>
                  目标: {activeEngine.api_url}
                </span>
              )}
            </Space>
          </Form.Item>

          {testResult && (
            <div style={{ marginBottom: 16 }}>
              <Alert
                message={testResult.success ? 'AI 引擎连接测试成功' : 'AI 引擎连接测试失败'}
                description={
                  <div>
                    <p><strong>API 地址:</strong> {activeEngine?.api_url || 'N/A'}</p>
                    <p><strong>模型名称:</strong> {testResult.model || activeEngine?.model_name || 'N/A'}</p>
                    <p><strong>响应时间:</strong> {testResult.responseTime ? `${testResult.responseTime}ms` : 'N/A'}</p>
                    <p><strong>详细信息:</strong> {testResult.details || '无'}</p>
                    {testResult.capabilities && (
                      <p><strong>模型能力:</strong> {renderCapabilityBadges(testResult.capabilities)}</p>
                    )}
                    {testResult.error && <p style={{ color: 'red', marginTop: 8 }}><strong>错误:</strong> {testResult.error}</p>}
                  </div>
                }
                type={testResult.success ? 'success' : 'error'}
                showIcon
                closable
                onClose={() => {/* testResult 由 hook 管理，这里仅触发关闭 */}}
              />
            </div>
          )}
        </Form>
      </Card>

      {/* AI 引擎管理模态框 */}
      <Modal
        title={editingEngine && (editingEngine as AIEngineSetting).id ? '编辑引擎' : editingEngine ? '添加新引擎' : 'AI 引擎管理'}
        open={showEngineModal}
        onCancel={handleCloseEngineModal}
        footer={[
          <Button key="cancel" onClick={handleCloseEngineModal}>
            取消
          </Button>,
          <Button key="save" type="primary" icon={<SaveOutlined />} onClick={handleSaveEngine}>
            {editingEngine && (editingEngine as AIEngineSetting).id ? '保存修改' : '添加引擎'}
          </Button>,
        ].filter(Boolean)}
        width={800}
      >
        {!editingEngine ? (
          <div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddEngine}
              style={{ marginBottom: 16 }}
            >
              添加新引擎
            </Button>
            <Table
              dataSource={engines}
              rowKey="id"
              rowClassName={(record) => record.id === copiedEngineId ? 'engine-row-highlighted' : ''}
              columns={[
                {
                  title: '引擎名称',
                  dataIndex: 'name',
                  key: 'name',
                  render: (name: string, record: AIEngineSetting) => (
                    <div>
                      <div>{name}</div>
                      {renderCapabilityBadges(record.capabilities)}
                    </div>
                  ),
                },
                {
                  title: 'API地址',
                  dataIndex: 'api_url',
                  key: 'api_url',
                  ellipsis: true,
                },
                {
                  title: '模型名称',
                  dataIndex: 'model_name',
                  key: 'model_name',
                  ellipsis: true,
                },
                {
                  title: 'API模式',
                  dataIndex: 'api_mode',
                  key: 'api_mode',
                  render: (mode: string) => mode === 'text_completion' ? '文本补全' : '聊天补全',
                },
                {
                  title: '状态',
                  key: 'status',
                  render: (_: any, record: AIEngineSetting) => (
                    <Space>
                      {record.id === setting?.activeEngineId && <span style={{ color: 'blue' }}>当前激活</span>}
                      {record.id === setting?.defaultEngineId && <span style={{ color: 'green' }}>默认</span>}
                    </Space>
                  ),
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 280,
                  render: (_: any, record: AIEngineSetting) => (
                    <Space size="small">
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => handleCopyEngine(record)}
                      >
                        复制
                      </Button>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => handleEditEngine(record)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => handleDeleteEngine(record.id)}
                      >
                        删除
                      </Button>
                      {record.id !== setting?.defaultEngineId && (
                        <Button
                          size="small"
                          onClick={() => handleSetDefaultEngine(record.id)}
                        >
                          设置默认
                        </Button>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <Form form={engineForm} layout="vertical">
            <Form.Item label="引擎名称" name="name" rules={[{ required: true, message: '请输入引擎名称' }]}>
              <Input placeholder="请输入引擎名称" />
            </Form.Item>
            <Form.Item label="API地址" name="api_url" rules={[{ required: true, message: '请输入API地址' }]}>
              <Input placeholder="例如: http://127.0.0.1:5000" />
            </Form.Item>
            <Form.Item label="API密钥" name="api_key">
              <Input placeholder="请输入API密钥（可选）" />
            </Form.Item>
            <Form.Item label="模型名称" name="model_name" rules={[{ required: true, message: '请输入模型名称' }]}>
              <AutoComplete
                options={engineModelOptions}
                placeholder="例如: qwen3.5-27b-heretic-v3"
                filterOption={false}
              />
            </Form.Item>
            <Form.Item label="API模式" name="api_mode" rules={[{ required: true, message: '请选择API模式' }]}>
              <Select
                options={[
                  { label: '文本补全', value: 'text_completion' },
                  { label: '聊天补全', value: 'chat_completion' },
                ]}
              />
            </Form.Item>
            <Form.Item label="API密钥传输方式" name="api_key_transmission">
              <Select
                options={[
                  { label: '请求头 (Authorization: Bearer)', value: 'header' },
                  { label: '请求体', value: 'body' },
                ]}
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={() => handleFetchEngineModels(engineForm)}
                loading={engineModelLoading}
              >
                获取模型列表
              </Button>
            </Form.Item>
            <Form.Item label="最大令牌数 (max_tokens)" name="max_tokens">
              <Input type="number" min={1} max={1000000} placeholder="范围: 1-1000000，例如: 10240" />
            </Form.Item>
            <Form.Item label="温度参数 (temperature)" name="temperature">
              <Input type="number" min={0} max={2} step={0.1} placeholder="范围: 0-2，例如: 0.7" />
            </Form.Item>
            <Form.Item label="Top P (top_p)" name="top_p">
              <Input type="number" min={0} max={1} step={0.05} placeholder="范围: 0-1，例如: 0.95" />
            </Form.Item>
            <Form.Item label="Top K (top_k)" name="top_k">
              <Input type="number" min={0} max={200} step={1} placeholder="范围: 0-200，例如: 40" />
            </Form.Item>
            <Form.Item label="Min P (min_p)" name="min_p">
              <Input type="number" min={0} max={1} step={0.05} placeholder="范围: 0-1，例如: 0.1" />
            </Form.Item>
            <Form.Item label="频率惩罚 (frequency_penalty)" name="frequency_penalty">
              <Input type="number" min={-2} max={2} step={0.1} placeholder="范围: -2到2，例如: 0" />
            </Form.Item>
            <Form.Item label="存在惩罚 (presence_penalty)" name="presence_penalty">
              <Input type="number" min={-2} max={2} step={0.1} placeholder="范围: -2到2，例如: 0" />
            </Form.Item>
            <Form.Item label="生成数量 (n)" name="n">
              <Input type="number" min={1} max={10} step={1} placeholder="范围: 1-10，例如: 1" />
            </Form.Item>
            <Form.Item label="系统提示词 (system_prompt)" name="system_prompt">
              <Input.TextArea
                rows={4}
                placeholder="输入系统提示词，用于设置 AI 的行为和角色"
              />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button type="primary" onClick={handleTestEngineConnection} icon={<SyncOutlined />}>
                  测试连通性
                </Button>
                {engineForm.getFieldValue('api_url') && (
                  <span style={{ color: '#666', fontSize: 12 }}>
                    目标: {engineForm.getFieldValue('api_url')}
                  </span>
                )}
              </Space>
            </Form.Item>

            {engineTestResult && (
              <div style={{ marginBottom: 16 }}>
                <Alert
                  message={engineTestResult.success ? '引擎连接测试成功' : '引擎连接测试失败'}
                  description={
                    <div>
                      <p><strong>API 地址:</strong> {engineForm.getFieldValue('api_url') || 'N/A'}</p>
                      <p><strong>模型名称:</strong> {engineTestResult.model || engineForm.getFieldValue('model_name') || 'N/A'}</p>
                      <p><strong>响应时间:</strong> {engineTestResult.responseTime ? `${engineTestResult.responseTime}ms` : 'N/A'}</p>
                      <p><strong>详细信息:</strong> {engineTestResult.details || '无'}</p>
                      {engineTestResult.capabilities && (
                        <p><strong>模型能力:</strong> {renderCapabilityBadges(engineTestResult.capabilities)}</p>
                      )}
                      {engineTestResult.error && <p style={{ color: 'red', marginTop: 8 }}><strong>错误:</strong> {engineTestResult.error}</p>}
                    </div>
                  }
                  type={engineTestResult.success ? 'success' : 'error'}
                  showIcon
                />
              </div>
            )}
          </Form>
        )}
      </Modal>

      {/* 引擎重命名对话框 */}
      <Modal
        title="复制引擎 - 重命名"
        open={showRenameModal}
        onCancel={handleCancelCopy}
        onOk={handleConfirmCopy}
        okText="确认复制"
        cancelText="取消"
        width={500}
        style={{ zIndex: 1001 }}
      >
        <div style={{ marginBottom: 16 }}>
          <p>正在复制引擎: <strong>{copyingEngine?.name}</strong></p>
          <p>请为新引擎输入名称：</p>
        </div>
        <Input
          value={newEngineName}
          onChange={handleEngineNameChange}
          placeholder="请输入新引擎名称"
          status={nameError ? 'error' : undefined}
          onPressEnter={handleConfirmCopy}
          autoFocus
        />
        {nameError && (
          <div style={{ color: '#ff4d4f', marginTop: 8, fontSize: 14 }}>
            {nameError}
          </div>
        )}
      </Modal>
    </>
  );
};

export default AIEngineSettingsPanel;
