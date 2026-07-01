import React, { useEffect, useState, useMemo } from 'react';
import {
  Modal,
  Input,
  Button,
  Alert,
  Typography,
  Space,
  List,
  Spin,
  Tag,
  Empty,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type {
  PromptTemplate,
  ValidationResult,
  ValidationIssue,
} from '../../../shared/types/promptTemplate.types';

const { Text, Title } = Typography;

interface PromptSaveDialogProps {
  visible: boolean;
  template: PromptTemplate;
  onCancel: () => void;
  onConfirm: (changeSummary: string) => void;
}

const IMPACT_DESCRIPTIONS: Record<string, string> = {
  'character-card.generate': '此修改将影响角色卡生成功能的所有后续 AI 请求',
  'character-card.translate': '此修改将影响角色卡翻译功能的所有后续 AI 请求',
  'character-card.polish': '此修改将影响角色卡润色功能的所有后续 AI 请求',
};

const PromptSaveDialog: React.FC<PromptSaveDialogProps> = ({
  visible,
  template,
  onCancel,
  onConfirm,
}) => {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');

  useEffect(() => {
    if (visible && template) {
      setChangeSummary('');
      setValidation(null);
      runValidation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, template]);

  const runValidation = async () => {
    setLoading(true);
    setValidation(null);
    try {
      const result = await window.electronAPI.prompt.validate(template);
      if (result.success && result.data) {
        setValidation(result.data as ValidationResult);
      } else {
        setValidation({
          valid: false,
          issues: [
            {
              level: 'error',
              message: result.error || '校验请求失败',
            },
          ],
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '校验时发生错误';
      setValidation({
        valid: false,
        issues: [{ level: 'error', message: msg }],
      });
    } finally {
      setLoading(false);
    }
  };

  const errorIssues = useMemo<ValidationIssue[]>(
    () => validation?.issues.filter((i) => i.level === 'error') ?? [],
    [validation]
  );

  const warningIssues = useMemo<ValidationIssue[]>(
    () => validation?.issues.filter((i) => i.level === 'warning') ?? [],
    [validation]
  );

  const hasErrors = errorIssues.length > 0;
  // 校验结果仅作为参考提醒，不强制阻止保存（只要填写了变更摘要且校验已完成即可）
  const canConfirm = changeSummary.trim().length >= 1 && !loading;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(changeSummary.trim());
  };

  const impactDescription =
    IMPACT_DESCRIPTIONS[template.moduleId] ||
    '此修改将影响相关功能的所有后续 AI 请求';

  const renderIssue = (issue: ValidationIssue) => (
    <List.Item>
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space>
          {issue.level === 'error' ? (
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          )}
          <Text>{issue.message}</Text>
          {issue.partId && <Tag>part: {issue.partId}</Tag>}
        </Space>
        {issue.suggestion && (
          <Text type="secondary" style={{ paddingLeft: 22, fontSize: 12 }}>
            建议：{issue.suggestion}
          </Text>
        )}
      </Space>
    </List.Item>
  );

  return (
    <Modal
      title="保存确认"
      open={visible}
      onCancel={onCancel}
      width={600}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          确认保存
        </Button>,
      ]}
    >
      <Spin spinning={loading}>
        {/* Template info */}
        <div style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">模板名称：</Text>
              <Text strong>{template.name}</Text>
            </div>
            <div>
              <Text type="secondary">模块 ID：</Text>
              <Text>{template.moduleId}</Text>
            </div>
            <div>
              <Text type="secondary">描述：</Text>
              <Text>{template.description}</Text>
            </div>
          </Space>
        </div>

        {/* Impact description */}
        <Alert
          message="影响说明"
          description={impactDescription}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {/* Validation results */}
        <div style={{ marginBottom: 16 }}>
          <Title level={5} style={{ marginBottom: 8 }}>
            校验结果
          </Title>
          {validation ? (
            <>
              {validation.issues.length === 0 ? (
                <Alert
                  message="校验通过"
                  type="success"
                  showIcon
                  icon={<CheckCircleOutlined />}
                  style={{ marginBottom: 8 }}
                />
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <Space>
                      {hasErrors && (
                        <Space>
                          <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                          <Text type="danger">{errorIssues.length} 个错误</Text>
                        </Space>
                      )}
                      {warningIssues.length > 0 && (
                        <Space>
                          <WarningOutlined style={{ color: '#faad14' }} />
                          <Text style={{ color: '#faad14' }}>
                            {warningIssues.length} 个警告
                          </Text>
                        </Space>
                      )}
                    </Space>
                  </div>
                  {hasErrors && (
                    <List
                      size="small"
                      bordered
                      dataSource={errorIssues}
                      renderItem={renderIssue}
                      style={{ marginBottom: 8 }}
                    />
                  )}
                  {warningIssues.length > 0 && (
                    <List
                      size="small"
                      bordered
                      dataSource={warningIssues}
                      renderItem={renderIssue}
                      style={{ marginBottom: 8 }}
                    />
                  )}
                </>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {errorIssues.length} 个错误, {warningIssues.length} 个警告
              </Text>
            </>
          ) : (
            <Empty description="等待校验..." />
          )}
        </div>

        {/* Change summary input */}
        <div>
          <Text style={{ display: 'block', marginBottom: 8 }}>
            变更摘要 <Text type="danger">*</Text>
          </Text>
          <Input.TextArea
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder="请输入本次变更的摘要说明（必填）"
            rows={3}
            maxLength={200}
            showCount
          />
        </div>
      </Spin>
    </Modal>
  );
};

export default PromptSaveDialog;
