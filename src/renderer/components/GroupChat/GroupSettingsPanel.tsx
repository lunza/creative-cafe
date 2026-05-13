import React from 'react';
import { Form, Select, InputNumber, Switch, Input, Button, message } from 'antd';
import { SettingOutlined, SaveOutlined } from '@ant-design/icons';
import { ActivationStrategy, GenerationMode } from '../../../shared/types/groupChat.types';
import type { Group } from '../../../shared/types/groupChat.types';
import './GroupChat.css';

const { Option } = Select;

interface GroupSettingsPanelProps {
  group: Group | null;
  onSave: (config: Partial<Group>) => void;
}

export const GroupSettingsPanel: React.FC<GroupSettingsPanelProps> = ({ group, onSave }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (group) {
      form.setFieldsValue({
        activation_strategy: group.activation_strategy,
        generation_mode: group.generation_mode,
        allow_self_respond: group.allow_self_respond,
        auto_mode_delay: group.auto_mode_delay,
        generation_mode_join_prefix: group.generation_mode_join_prefix,
        generation_mode_join_suffix: group.generation_mode_join_suffix,
      });
    }
  }, [group, form]);

  const handleSave = async (values: any) => {
    if (!group) return;
    try {
      setSaving(true);
      await onSave(values);
      message.success('配置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!group) {
    return (
      <div className="gc-panel gc-panel-right">
        <div className="gc-panel-header">
          <h3 className="gc-panel-title">群组设置</h3>
        </div>
        <div className="gc-empty-settings">
          <SettingOutlined style={{ fontSize: 32, color: '#4b5563', marginBottom: 12 }} />
          <p>请先添加群组成员</p>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            从左侧拖拽角色到中间区域
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gc-panel gc-panel-right">
      <div className="gc-panel-header">
        <h3 className="gc-panel-title">群组设置</h3>
      </div>

      <div className="gc-settings-content">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          className="gc-settings-form"
        >
          <div className="gc-settings-section">
            <h4 className="gc-settings-section-title">激活策略</h4>
            <Form.Item
              name="activation_strategy"
              rules={[{ required: true, message: '请选择' }]}
            >
              <Select>
                <Option value={ActivationStrategy.NATURAL}>
                  <span className="gc-option-label">自然模式</span>
                  <span className="gc-option-desc">角色基于上下文自然响应</span>
                </Option>
                <Option value={ActivationStrategy.LIST}>
                  <span className="gc-option-label">列表模式</span>
                  <span className="gc-option-desc">按预设顺序依次发言</span>
                </Option>
                <Option value={ActivationStrategy.POOLED}>
                  <span className="gc-option-label">池化模式</span>
                  <span className="gc-option-desc">随机选择角色发言</span>
                </Option>
              </Select>
            </Form.Item>
          </div>

          <div className="gc-settings-section">
            <h4 className="gc-settings-section-title">生成模式</h4>
            <Form.Item
              name="generation_mode"
              rules={[{ required: true, message: '请选择' }]}
            >
              <Select>
                <Option value={GenerationMode.SWAP}>
                  <span className="gc-option-label">角色切换</span>
                  <span className="gc-option-desc">每次只有一位角色发言</span>
                </Option>
                <Option value={GenerationMode.APPEND}>
                  <span className="gc-option-label">追加模式</span>
                  <span className="gc-option-desc">所有角色依次追加回复</span>
                </Option>
                <Option value={GenerationMode.APPEND_DISABLED}>
                  <span className="gc-option-label">追加已禁用</span>
                  <span className="gc-option-desc">仅禁用角色追加回复</span>
                </Option>
              </Select>
            </Form.Item>
          </div>

          <div className="gc-settings-section">
            <h4 className="gc-settings-section-title">高级选项</h4>
            <Form.Item label="允许自回复" name="allow_self_respond" valuePropName="checked">
              <Switch size="small" />
            </Form.Item>

            <Form.Item label="自动模式延迟 (秒)" name="auto_mode_delay">
              <InputNumber min={1} max={60} className="gc-input-number" />
            </Form.Item>
          </div>

          <div className="gc-settings-section">
            <h4 className="gc-settings-section-title">Join 模板</h4>
            <Form.Item label="前缀模板" name="generation_mode_join_prefix">
              <Input.TextArea rows={2} placeholder="{{char}}" className="gc-textarea" />
            </Form.Item>

            <Form.Item label="后缀模板" name="generation_mode_join_suffix">
              <Input.TextArea rows={2} className="gc-textarea" />
            </Form.Item>
          </div>

          <Form.Item className="gc-save-btn-row">
            <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} block>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};
