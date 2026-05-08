import React from 'react';
import { Input, Space, Button } from 'antd';
import {
  TranslationOutlined,
  EditOutlined,
  LoadingOutlined,
  RobotOutlined
} from '@ant-design/icons';

interface FieldEditorProps {
  label: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  inputType?: 'input' | 'textarea';
  rows?: number;
  showGenerate?: boolean;
  onTranslate: (field: string) => void;
  onPolish: (field: string) => void;
  onGenerate?: (field: string) => void;
  onRestore: (field: string) => void;
  translatingField: string | null;
  polishingField: string | null;
  generatingField: string | null;
}

export const FieldEditor: React.FC<FieldEditorProps> = ({
  label,
  field,
  value,
  onChange,
  inputType = 'input',
  rows = 1,
  showGenerate = false,
  onTranslate,
  onPolish,
  onGenerate,
  onRestore,
  translatingField,
  polishingField,
  generatingField,
}) => {
  const isTranslating = translatingField === field;
  const isPolishing = polishingField === field;
  const isGenerating = generatingField === field;

  const InputComponent = inputType === 'textarea' ? Input.TextArea : Input;

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>{label}</label>
      <div style={{ marginBottom: 8 }}>
        <InputComponent
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          placeholder={`请输入${label}`}
          rows={inputType === 'textarea' ? rows : undefined}
        />
      </div>
      <Space>
        {showGenerate && onGenerate && (
          <Button
            type="primary"
            icon={isGenerating ? <LoadingOutlined spin /> : <RobotOutlined />}
            onClick={() => onGenerate(field)}
            loading={isGenerating}
          >
            生成
          </Button>
        )}
        <Button
          type="primary"
          icon={isTranslating ? <LoadingOutlined spin /> : <TranslationOutlined />}
          onClick={() => onTranslate(field)}
          loading={isTranslating}
        >
          翻译
        </Button>
        <Button
          type="primary"
          icon={isPolishing ? <LoadingOutlined spin /> : <EditOutlined />}
          onClick={() => onPolish(field)}
          loading={isPolishing}
        >
          润色
        </Button>
        <Button
          type="text"
          onClick={() => onRestore(field)}
        >
          还原
        </Button>
      </Space>
    </div>
  );
};
