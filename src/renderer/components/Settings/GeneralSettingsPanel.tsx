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
  // Spec: settings-feature-optimization-report / M-12, PF-3（整体订阅拆为逐字段 selector：
  // uiStore 的 activeTab/sidebarCollapsed/creativeTab 等变化不再触发本面板重渲染；
  // setter 引用稳定，不会引发额外重渲染）
  const theme = useUIStore(s => s.theme);
  const animationEnabled = useUIStore(s => s.animationEnabled);
  const compactMode = useUIStore(s => s.compactMode);
  const setTheme = useUIStore(s => s.setTheme);
  const setAnimationEnabled = useUIStore(s => s.setAnimationEnabled);
  const setCompactMode = useUIStore(s => s.setCompactMode);

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
          <Form.Item label="主题">
            <Select
              value={theme}
              onChange={(value) => setTheme(value)}
              options={[
                { label: '亮色', value: 'light' },
                { label: '暗色', value: 'dark' },
                { label: '跟随系统', value: 'auto' },
              ]}
            />
          </Form.Item>

          <Form.Item label="启用动画">
            <Switch
              checked={animationEnabled}
              onChange={(checked) => setAnimationEnabled(checked)}
            />
          </Form.Item>

          <Form.Item label="紧凑模式">
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
                    // Spec: settings-feature-optimization-report / UI-6（CT-3 主题适配）：
                    // 硬编码 #d9d9d9 在暗色主题下边框刺眼，改用全局主题变量（Settings.css 同源）
                    border: '1px solid var(--border-base, #d9d9d9)',
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
          {/* L-3/IX-6：theme/animation/compact/debugMode 原同时有 name 又用受控 value/checked
              （双驱动脱节）——resetFields 重置表单值但受控 UI 由 uiStore/useState 驱动不变，
              表单值与 UI 显示矛盾。这些 name 字段从未被 getFieldsValue 消费（Settings.tsx
              脏检测比较清单明确排除），现全部去 name 改纯受控驱动，仅保留布局/label 能力 */}
          <Form.Item label="启用调试模式">
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
