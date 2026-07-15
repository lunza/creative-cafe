import React from 'react';
import { Card, Form, Input, Button, Space } from 'antd';
import { FolderOutlined, UndoOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { PathField, PathState, PathValidation } from './hooks/usePathSettings';

interface PathSettingsPanelProps {
  form: ReturnType<typeof Form.useForm>[0];
  paths: PathState;
  pathValidation: Record<string, PathValidation>;
  onSelectDirectory: (field: PathField) => void;
  onResetPath: (field: PathField) => void;
  onValidatePath: (field: PathField) => void;
  onPathInputChange: (field: PathField, value: string) => void;
  getPathLabel: (field: PathField) => string;
}

const PATH_FIELDS: PathField[] = [
  'worldBookPath',
  'characterPath',
  'avatarPath',
  'creativePath',
  'memoryPath',
  'pluginPath',
];

/**
 * 路径设置面板（展示组件）
 *
 * 从 Settings.tsx 提取，负责渲染 6 个目录路径的输入、浏览、重置、验证 UI。
 * 路径状态和操作由父组件通过 usePathSettings Hook 提供。
 */
const PathSettingsPanel: React.FC<PathSettingsPanelProps> = ({
  form,
  paths,
  pathValidation,
  onSelectDirectory,
  onResetPath,
  onValidatePath,
  onPathInputChange,
  getPathLabel,
}) => {
  return (
    <Card title="路径设置" style={{ marginTop: 16 }}>
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          所有路径默认存储在用户数据目录下。支持使用 <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>__USER_DATA__</code> 作为基础路径占位符。路径不存在时保存后会自动创建。
        </p>
      </div>
      <Form form={form} layout="vertical">
        {PATH_FIELDS.map((field) => {
          const validation = pathValidation[field];
          return (
            <Form.Item label={getPathLabel(field)} name={field} key={field} style={{ marginBottom: 16 }}>
              <Space style={{ width: '100%' }} align="baseline">
                <Input
                  style={{ flex: 1 }}
                  value={paths[field]}
                  onChange={(e) => onPathInputChange(field, e.target.value)}
                  placeholder={`请输入${getPathLabel(field)}路径`}
                />
                <Button
                  icon={<FolderOutlined />}
                  onClick={() => onSelectDirectory(field)}
                >
                  浏览
                </Button>
                <Button
                  icon={<UndoOutlined />}
                  onClick={() => onResetPath(field)}
                >
                  重置
                </Button>
                <Button
                  icon={validation ? (validation.valid ? <CheckCircleOutlined style={{ color: '#22c55e' }} /> : <CloseCircleOutlined style={{ color: '#ef4444' }} />) : null}
                  onClick={() => onValidatePath(field)}
                  loading={validation?.message === '验证中...'}
                >
                  {validation ? (validation.valid ? '有效' : '无效') : '验证'}
                </Button>
                {validation && (
                  <span style={{ fontSize: '12px', color: validation.valid ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>
                    {validation.message}
                  </span>
                )}
              </Space>
            </Form.Item>
          );
        })}
      </Form>
    </Card>
  );
};

export default PathSettingsPanel;
