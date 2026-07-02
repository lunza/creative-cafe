import React from 'react';
import { Input, Space, Button, Popconfirm } from 'antd';
import {
  TranslationOutlined,
  EditOutlined,
  LoadingOutlined,
  RobotOutlined,
  StopOutlined,
  CloseOutlined
} from '@ant-design/icons';

interface FieldEditorProps {
  label: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  inputType?: 'input' | 'textarea';
  rows?: number;
  autoSize?: { minRows: number; maxRows: number };
  showGenerate?: boolean;
  onTranslate: (field: string) => void;
  onPolish: (field: string) => void;
  onGenerate?: (field: string) => void;
  onRestore: (field: string) => void;
  onCancelAIRequest?: () => void;
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
  autoSize,
  showGenerate = false,
  onTranslate,
  onPolish,
  onGenerate,
  onRestore,
  onCancelAIRequest,
  translatingField,
  polishingField,
  generatingField,
}) => {
  const isTranslating = translatingField === field;
  const isPolishing = polishingField === field;
  const isGenerating = generatingField === field;
  const isProcessing = isTranslating || isPolishing || isGenerating;

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
          autoSize={inputType === 'textarea' ? (autoSize || { minRows: rows, maxRows: Math.max(rows * 2, 8) }) : undefined}
        />
      </div>
      <Space>
        {showGenerate && onGenerate && (
          isGenerating ? (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={onCancelAIRequest}
            >
              中断
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={() => onGenerate(field)}
            >
              生成
            </Button>
          )
        )}
        {isTranslating ? (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={onCancelAIRequest}
          >
            中断
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<TranslationOutlined />}
            onClick={() => onTranslate(field)}
          >
            翻译
          </Button>
        )}
        {isPolishing ? (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={onCancelAIRequest}
          >
            中断
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => onPolish(field)}
          >
            润色
          </Button>
        )}
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
