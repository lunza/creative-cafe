/**
 * SkillFormModal —— 技能创建/编辑模态表单
 *
 * 职责：
 *  1. 创建模式：所有字段可编辑，提交时调用 onCreate
 *  2. 编辑模式：技能名只读（disabled），其余字段可编辑，提交时调用 onEdit
 *  3. 表单验证：技能名格式/重复校验、描述/正文字数限制
 *  4. 提交时显示 loading 状态，消息提示由父组件处理
 */
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input } from 'antd';

/** 技能表单参数 */
interface SkillFormParams {
  name: string;
  description: string;
  emoji?: string;
  body: string;
}

interface SkillFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  skill?: { name: string; description: string; emoji?: string; body: string } | null;
  existingNames: string[];
  onCreate: (params: SkillFormParams) => Promise<void>;
  onEdit: (params: SkillFormParams) => Promise<void>;
  onClose: () => void;
}

const SkillFormModal: React.FC<SkillFormModalProps> = ({
  open,
  mode,
  skill,
  existingNames,
  onCreate,
  onEdit,
  onClose,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 模态窗口打开时根据模式填充或重置表单
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && skill) {
      form.setFieldsValue({
        name: skill.name,
        description: skill.description,
        emoji: skill.emoji || '',
        body: skill.body,
      });
    } else {
      form.resetFields();
    }
  }, [open, mode, skill, form]);

  /** 提交表单：验证通过后调用 onCreate 或 onEdit，消息提示由父组件处理 */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (mode === 'create') {
        await onCreate(values);
      } else {
        await onEdit(values);
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
      title={mode === 'create' ? '创建技能' : '编辑技能'}
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
          label="技能名"
          rules={[
            { required: true, message: '请输入技能名' },
            { pattern: /^[a-z0-9-]+$/, message: '技能名仅支持小写字母、数字和连字符' },
            {
              validator: (_, value) => {
                if (mode === 'create' && value && existingNames.includes(value)) {
                  return Promise.reject(new Error('技能名已存在'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="如：my-skill" disabled={mode === 'edit'} />
        </Form.Item>

        <Form.Item
          name="description"
          label="技能描述"
          rules={[
            { required: true, message: '请输入技能描述' },
            { max: 500, message: '描述不能超过500字符' },
          ]}
        >
          <Input.TextArea
            placeholder="技能描述（模型可见）"
            autoSize={{ minRows: 2, maxRows: 6 }}
            showCount
            maxLength={500}
          />
        </Form.Item>

        <Form.Item name="emoji" label="图标">
          <Input placeholder="如：📝（可选）" />
        </Form.Item>

        <Form.Item
          name="body"
          label="技能正文"
          rules={[
            { required: true, message: '请输入技能正文' },
            { max: 10000, message: '正文不能超过10000字符' },
          ]}
        >
          <Input.TextArea
            placeholder="SKILL.md 正文（markdown）"
            autoSize={{ minRows: 6, maxRows: 20 }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SkillFormModal;
