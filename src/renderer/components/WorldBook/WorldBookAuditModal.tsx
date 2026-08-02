import React from 'react';
import { Modal, Button, Input, Tag } from 'antd';
import { StopOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

/**
 * 世界书审核 Modal 集合。
 *
 * 包含三个 Modal：
 *  1. AI 单字段审核要求输入 Modal（输入审核要求后执行 performAudit）
 *  2. 一键审核要求输入 Modal（输入统一要求后执行 performAuditAll）
 *  3. 审核结果展示 Modal（展示通过/不通过状态 + 修改建议 + 修改后文本）
 *
 * 组件仅为 UI 容器，业务逻辑通过 props 由 WorldBookManager 编排层注入。
 * 审核结果 Modal 提供"采用审核文本"、"重新审核"、"关闭"三个操作按钮。
 */
export interface WorldBookAuditModalProps {
  // 单字段审核要求输入
  isAuditModalOpen: boolean;
  setIsAuditModalOpen: (open: boolean) => void;
  auditingField: string | null;
  auditRequirements: string;
  setAuditRequirements: (value: string) => void;
  setCurrentAuditField: (field: string | null) => void;
  setCurrentAuditText: (value: string) => void;
  performAudit: () => void;
  // 一键审核要求输入
  isAuditAllModalOpen: boolean;
  setIsAuditAllModalOpen: (open: boolean) => void;
  isAuditingAll: boolean;
  auditAllRequirements: string;
  setAuditAllRequirements: (value: string) => void;
  performAuditAll: () => void;
  // 审核结果展示
  isAuditResultModalOpen: boolean;
  auditResult: { passed: boolean; suggestions: string; revisedText: string } | null;
  applyAuditResult: () => void;
  applyAuditResultForBatch: () => void;
  closeAuditResult: () => void;
  reAudit: () => void;
  // 是否批量审核模式（决定采用按钮调用哪个函数）
  isBatchMode: boolean;
  // 中断
  onCancelAIRequest: () => void;
}

const WorldBookAuditModal: React.FC<WorldBookAuditModalProps> = ({
  isAuditModalOpen,
  setIsAuditModalOpen,
  auditingField,
  auditRequirements,
  setAuditRequirements,
  setCurrentAuditField,
  setCurrentAuditText,
  performAudit,
  isAuditAllModalOpen,
  setIsAuditAllModalOpen,
  isAuditingAll,
  auditAllRequirements,
  setAuditAllRequirements,
  performAuditAll,
  isAuditResultModalOpen,
  auditResult,
  applyAuditResult,
  applyAuditResultForBatch,
  closeAuditResult,
  reAudit,
  isBatchMode,
  onCancelAIRequest,
}) => {
  return (
    <>
      {/* AI审核要求模态框（单字段） */}
      <Modal
        title="AI审核"
        open={isAuditModalOpen}
        onCancel={() => {
          if (!auditingField) {
            setIsAuditModalOpen(false);
            setCurrentAuditField(null);
            setCurrentAuditText('');
            setAuditRequirements('');
          }
        }}
        closable={!auditingField}
        maskClosable={!auditingField}
        footer={auditingField ? [
          <Button key="interrupt" danger icon={<StopOutlined />} onClick={onCancelAIRequest}>
            中断请求
          </Button>
        ] : [
          <Button key="cancel" onClick={() => {
            setIsAuditModalOpen(false);
            setCurrentAuditField(null);
            setCurrentAuditText('');
            setAuditRequirements('');
          }}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={performAudit}>
            开始审核
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
          <p>请输入审核要求（例如：检查术语准确性、验证事实正确性、评估主题一致性等）：</p>
          <Input.TextArea
            rows={4}
            placeholder="请输入审核要求"
            value={auditRequirements}
            onChange={(e) => setAuditRequirements(e.target.value)}
            autoFocus
            disabled={auditingField !== null}
          />
        </div>
      </Modal>

      {/* 一键审核要求模态框 */}
      <Modal
        title="一键审核"
        open={isAuditAllModalOpen}
        onCancel={() => {
          if (!isAuditingAll) {
            setIsAuditAllModalOpen(false);
            setAuditAllRequirements('');
          }
        }}
        closable={!isAuditingAll}
        maskClosable={!isAuditingAll}
        footer={isAuditingAll ? [
          <Button key="interrupt" danger icon={<StopOutlined />} onClick={onCancelAIRequest}>
            中断请求
          </Button>
        ] : [
          <Button key="cancel" onClick={() => {
            setIsAuditAllModalOpen(false);
            setAuditAllRequirements('');
          }}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={performAuditAll}>
            开始审核
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
          <p>请输入审核要求（例如：检查术语准确性、验证事实正确性、评估主题一致性等）：</p>
          <Input.TextArea
            rows={4}
            placeholder="请输入审核要求"
            value={auditAllRequirements}
            onChange={(e) => setAuditAllRequirements(e.target.value)}
            autoFocus
            disabled={isAuditingAll}
          />
        </div>
      </Modal>

      {/* 审核结果展示模态框 */}
      <Modal
        title="审核结果"
        open={isAuditResultModalOpen}
        onCancel={closeAuditResult}
        closable
        maskClosable={false}
        footer={[
          <Button key="close" onClick={closeAuditResult}>
            关闭
          </Button>,
          <Button key="reaudit" onClick={reAudit}>
            重新审核
          </Button>,
          <Button key="apply" type="primary" onClick={isBatchMode ? applyAuditResultForBatch : applyAuditResult}>
            采用审核文本
          </Button>,
        ]}
        width={900}
        getContainer={() => document.body}
        zIndex={5000}
        maskStyle={{ zIndex: 5000 }}
        style={{
          zIndex: 5000
        }}
      >
        {auditResult && (
          <div style={{ color: 'var(--text-primary, #ffffff)' }}>
            {/* 审核状态 */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ marginRight: 8 }}>审核状态：</span>
              {auditResult.passed ? (
                <Tag icon={<CheckCircleOutlined />} color="success">通过</Tag>
              ) : (
                <Tag icon={<CloseCircleOutlined />} color="error">不通过</Tag>
              )}
            </div>

            {/* 修改建议 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>修改建议：</label>
              <Input.TextArea
                value={auditResult.suggestions}
                rows={3}
                readOnly
                style={{ backgroundColor: 'var(--bg-secondary, #1a1a1a)' }}
              />
            </div>

            {/* 修改后文本 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>审核并修改后的文本：</label>
              <Input.TextArea
                value={auditResult.revisedText}
                rows={8}
                readOnly
                style={{ backgroundColor: 'var(--bg-secondary, #1a1a1a)' }}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default WorldBookAuditModal;
