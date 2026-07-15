import React from 'react';
import { Card, Form, Switch, Select, Button, Upload, message } from 'antd';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';

interface GeneralSettingsPanelProps {
  form: ReturnType<typeof Form.useForm>[0];
  dashboardBackgroundImage: string;
  onBackgroundImageChange: (image: string) => void;
  debugMode: boolean;
  onDebugModeChange: (mode: boolean) => void;
}

/**
 * 外观设置 + 高级设置面板
 *
 * 从 Settings.tsx 提取，负责：
 * - 主题、动画、紧凑模式切换
 * - 仪表盘背景图片上传/删除
 * - 调试模式开关
 * - 日志级别选择
 */
const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({
  form,
  dashboardBackgroundImage,
  onBackgroundImageChange,
  debugMode,
  onDebugModeChange,
}) => {
  const { theme, setTheme, animationEnabled, setAnimationEnabled, compactMode, setCompactMode } = useUIStore();

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      onBackgroundImageChange(result);
      message.success('图片上传成功');
    };
    reader.readAsDataURL(file);
    return false;
  };

  const handleRemoveImage = () => {
    onBackgroundImageChange('');
    message.info('已删除背景图片');
  };

  return (
    <>
      <Card title="外观设置">
        <Form form={form} layout="vertical">
          <Form.Item label="主题" name="theme">
            <Select
              value={theme}
              onChange={(value) => setTheme(value)}
              options={[
                { label: '亮色', value: 'light' },
                { label: '暗色', value: 'dark' },
              ]}
            />
          </Form.Item>

          <Form.Item label="启用动画" name="animation" valuePropName="checked" initialValue={true}>
            <Switch
              checked={animationEnabled}
              onChange={(checked) => setAnimationEnabled(checked)}
            />
          </Form.Item>

          <Form.Item label="紧凑模式" name="compact" valuePropName="checked" initialValue={false}>
            <Switch
              checked={compactMode}
              onChange={(checked) => setCompactMode(checked)}
            />
          </Form.Item>

          <Form.Item label="仪表盘背景图片">
            {dashboardBackgroundImage ? (
              <div style={{ marginBottom: 16 }}>
                <img
                  src={dashboardBackgroundImage}
                  alt="预览"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 200,
                    objectFit: 'contain',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    marginBottom: 8,
                  }}
                />
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleRemoveImage}
                >
                  删除图片
                </Button>
              </div>
            ) : (
              <Upload
                beforeUpload={handleImageUpload}
                showUploadList={false}
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              >
                <Button icon={<UploadOutlined />}>
                  选择图片
                </Button>
              </Upload>
            )}
          </Form.Item>
        </Form>
      </Card>

      <Card title="高级设置" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item label="启用调试模式" name="debugMode" valuePropName="checked" initialValue={false}>
            <Switch
              checked={debugMode}
              onChange={(checked) => onDebugModeChange(checked)}
            />
          </Form.Item>

          <Form.Item label="日志级别" name="logLevel">
            <Select
              options={[
                { label: '错误', value: 'error' },
                { label: '警告', value: 'warn' },
                { label: '信息', value: 'info' },
                { label: '调试', value: 'debug' },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>
    </>
  );
};

export default GeneralSettingsPanel;
