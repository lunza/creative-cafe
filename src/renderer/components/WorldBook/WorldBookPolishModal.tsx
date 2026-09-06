import React from 'react';
import { Modal, Button, Input, Switch } from 'antd';
import { StopOutlined } from '@ant-design/icons';

/**
 * 世界书润色 Modal 集合（Task 8 拆分产物）。
 *
 * 从原 WorldBookManager.tsx 迁出的两块润色相关 JSX：
 *  1. AI 单字段润色 Modal（输入润色要求后对单个字段执行 performPolish）
 *  2. 一键润色 Modal（输入统一要求后对所有字段执行 performPolishAll）
 *
 * 组件仅为 UI 容器，业务逻辑（performPolish / performPolishAll /
 * handleCancelAIRequest）通过 props 由 WorldBookManager 编排层注入，
 * 与原实现保持完全一致的行为。
 *
 * 中断按钮在 polishingField / isPolishingAll 真值时显示，调用
 * handleCancelAIRequest 将 isProcessingRef.current 置为 false，AI 流式
 * 读取循环在下一个 tick 退出。
 *
 * Spec: polish-deai-humanizer — 两个 Modal 均提供"去AI味"开关（默认开启），
 * 控制润色 system prompt 的去AI味规则块注入。
 */
export interface WorldBookPolishModalProps {
  // 单字段润色
  isPolishModalOpen: boolean;
  setIsPolishModalOpen: (open: boolean) => void;
  polishingField: string | null;
  polishRequirements: string;
  setPolishRequirements: (value: string) => void;
  setCurrentPolishField: (field: string | null) => void;
  setCurrentPolishText: (value: string) => void;
  performPolish: () => void;
  // 一键润色
  isPolishAllModalOpen: boolean;
  setIsPolishAllModalOpen: (open: boolean) => void;
  isPolishingAll: boolean;
  polishAllRequirements: string;
  setPolishAllRequirements: (value: string) => void;
  performPolishAll: () => void;
  // Spec: polish-deai-humanizer — 去AI味开关
  polishDeAiFlavor: boolean;
  setPolishDeAiFlavor: (value: boolean) => void;
  // 中断
  onCancelAIRequest: () => void;
}

/** 去AI味开关行（两个 Modal 复用） */
const DeAiFlavorSwitch: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}> = ({ checked, onChange, disabled }) => (
  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
    <Switch size="small" checked={checked} onChange={onChange} disabled={disabled} />
    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
      去AI味（抑制"禁忌之美"式浮夸辞藻与套路句式）
    </span>
  </div>
);

const WorldBookPolishModal: React.FC<WorldBookPolishModalProps> = ({
  isPolishModalOpen,
  setIsPolishModalOpen,
  polishingField,
  polishRequirements,
  setPolishRequirements,
  setCurrentPolishField,
  setCurrentPolishText,
  performPolish,
  isPolishAllModalOpen,
  setIsPolishAllModalOpen,
  isPolishingAll,
  polishAllRequirements,
  setPolishAllRequirements,
  performPolishAll,
  polishDeAiFlavor,
  setPolishDeAiFlavor,
  onCancelAIRequest,
}) => {
  return (
    <>
      {/* AI润色要求模态框 */}
      <Modal
        title="AI润色"
        open={isPolishModalOpen}
        onCancel={() => {
          if (!polishingField) {
            setIsPolishModalOpen(false);
            setCurrentPolishField(null);
            setCurrentPolishText('');
            setPolishRequirements('');
          }
        }}
        closable={!polishingField}
        maskClosable={!polishingField}
        footer={polishingField ? [
          <Button key="interrupt" danger icon={<StopOutlined />} onClick={onCancelAIRequest}>
            中断请求
          </Button>
        ] : [
          <Button key="cancel" onClick={() => {
            setIsPolishModalOpen(false);
            setCurrentPolishField(null);
            setCurrentPolishText('');
            setPolishRequirements('');
          }}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={performPolish}>
            开始润色
          </Button>
        ]}
        width={800}
        getContainer={() => document.body}
        zIndex={4000}
        maskStyle={{ zIndex: 4000 }}
        style={{
          zIndex: 4000
        }}
      >
        <div>
          <p>请输入润色要求（例如：风格偏向可爱、更加正式、增加细节等）：</p>
          <Input.TextArea
            rows={4}
            placeholder="请输入润色要求"
            value={polishRequirements}
            onChange={(e) => setPolishRequirements(e.target.value)}
            autoFocus
            disabled={polishingField !== null}
          />
          <DeAiFlavorSwitch
            checked={polishDeAiFlavor}
            onChange={setPolishDeAiFlavor}
            disabled={polishingField !== null}
          />
        </div>
      </Modal>

      {/* 一键润色要求模态框 */}
      <Modal
        title="一键润色"
        open={isPolishAllModalOpen}
        onCancel={() => {
          if (!isPolishingAll) {
            setIsPolishAllModalOpen(false);
            setPolishAllRequirements('');
          }
        }}
        closable={!isPolishingAll}
        maskClosable={!isPolishingAll}
        footer={isPolishingAll ? [
          <Button key="interrupt" danger icon={<StopOutlined />} onClick={onCancelAIRequest}>
            中断请求
          </Button>
        ] : [
          <Button key="cancel" onClick={() => {
            setIsPolishAllModalOpen(false);
            setPolishAllRequirements('');
          }}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={performPolishAll}>
            开始润色
          </Button>
        ]}
        getContainer={() => document.body}
        zIndex={3000}
        maskStyle={{ zIndex: 3000 }}
        style={{
          zIndex: 3000
        }}
      >
        <div>
          <p>请输入润色要求（例如：风格偏向可爱、更加正式、增加细节等）：</p>
          <Input.TextArea
            rows={4}
            placeholder="请输入润色要求"
            value={polishAllRequirements}
            onChange={(e) => setPolishAllRequirements(e.target.value)}
            autoFocus
            disabled={isPolishingAll}
          />
          <DeAiFlavorSwitch
            checked={polishDeAiFlavor}
            onChange={setPolishDeAiFlavor}
            disabled={isPolishingAll}
          />
        </div>
      </Modal>
    </>
  );
};

export default WorldBookPolishModal;
