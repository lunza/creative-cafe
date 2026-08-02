/**
 * AgentFormModal —— 智能体创建/编辑模态表单
 *
 * 职责：
 *  1. 创建模式：所有字段可编辑，提交时调用 onCreate
 *  2. 编辑模式：所有字段可编辑（ID 不作为表单字段，通过 agent prop 传入），提交时调用 onUpdate
 *  3. 表单验证：名称必填/长度/重名校验、描述必填/长度、类型/模式必选
 *  4. 提交时显示 loading 状态，成功后由父组件关闭模态窗口
 */
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select } from 'antd';
import type { AgentConfig } from '@shared/types';

/** 创建智能体的 payload 类型 */
interface CreateAgentPayload {
  name: string;
  description: string;
  type: 'dialogue' | 'writing' | 'worldbook' | 'game' | 'custom';
  mode: 'dialogue' | 'writing' | 'game' | 'worldbook';
  status: 'enabled' | 'disabled';
  skills: string[];
  identity?: { emoji?: string; color?: string };
}

interface AgentFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  agent?: AgentConfig | null;
  existingNames: string[];
  onCreate?: (config: CreateAgentPayload) => Promise<void>;
  onUpdate?: (id: string, patch: Partial<AgentConfig>) => Promise<void>;
  onClose: () => void;
}

/** 智能体类型选项 */
const TYPE_OPTIONS = [
  { label: '对话', value: 'dialogue' },
  { label: '写作', value: 'writing' },
  { label: '世界书', value: 'worldbook' },
  { label: '游戏', value: 'game' },
  { label: '自定义', value: 'custom' },
];

/** 运行模式选项 */
const MODE_OPTIONS = [
  { label: '对话', value: 'dialogue' },
  { label: '写作', value: 'writing' },
  { label: '游戏', value: 'game' },
  { label: '世界书', value: 'worldbook' },
];

const AgentFormModal: React.FC<AgentFormModalProps> = ({
  open,
  mode,
  agent,
  existingNames,
  onCreate,
  onUpdate,
  onClose,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 模态窗口打开时根据模式填充或重置表单
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && agent) {
      form.setFieldsValue({
        name: agent.name,
        description: agent.description,
        type: agent.type,
        mode: agent.mode,
        emoji: agent.identity?.emoji || '',
      });
    } else {
      form.resetFields();
    }
  }, [open, mode, agent, form]);

  /** 提交表单：验证通过后调用 onCreate 或 onUpdate，消息提示由父组件处理 */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (mode === 'create' && onCreate) {
        await onCreate({
          name: values.name,
          description: values.description,
          type: values.type,
          mode: values.mode,
          status: 'enabled',
          skills: [],
          identity: { emoji: values.emoji || '🤖' },
        });
      } else if (mode === 'edit' && agent && onUpdate) {
        await onUpdate(agent.id, {
          name: values.name,
          description: values.description,
          type: values.type,
          mode: values.mode,
          identity: { emoji: values.emoji || '🤖', color: agent.identity?.color },
        });
      }
    } catch {
      // 验证失败或提交异常，不关闭模态窗口
    } finally {
      setSubmitting(false);
    }
  };

  /** 取消并重置表单 */
  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={mode === 'create' ? '创建智能体' : '编辑智能体'}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={submitting}
      okText={mode === 'create' ? '创建' : '保存'}
      cancelText="取消"
      width={520}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '请输入智能体名称' },
            { max: 50, message: '名称不能超过50字符' },
            {
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                // 编辑模式排除当前智能体名称
                if (mode === 'edit' && agent && value === agent.name) {
                  return Promise.resolve();
                }
                if (existingNames.includes(value)) {
                  return Promise.reject(new Error('名称已存在，请使用其他名称'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="请输入智能体名称" maxLength={50} />
        </Form.Item>

        <Form.Item
          name="description"
          label="描述"
          rules={[
            { required: true, message: '请输入描述' },
            { max: 200, message: '描述不能超过200字符' },
          ]}
        >
          <Input.TextArea
            placeholder="请输入描述"
            autoSize={{ minRows: 3, maxRows: 6 }}
            showCount
            maxLength={200}
          />
        </Form.Item>

        <Form.Item
          name="type"
          label="类型"
          rules={[{ required: true, message: '请选择类型' }]}
        >
          <Select options={TYPE_OPTIONS} placeholder="请选择类型" />
        </Form.Item>

        <Form.Item
          name="mode"
          label="模式"
          rules={[{ required: true, message: '请选择模式' }]}
        >
          <Select options={MODE_OPTIONS} placeholder="请选择模式" />
        </Form.Item>

        <Form.Item name="emoji" label="图标">
          <Input placeholder="如：🤖（可选，默认 🤖）" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AgentFormModal;
