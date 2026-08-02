/**
 * AgentQuestionModal —— 智能体逐项问答弹窗组件
 *
 * 职责：
 *  1. 逐项展示智能体提出的澄清问题，每次仅展示一个问题
 *  2. 提供预设选项卡片（可点击选中）和"其他"自定义输入区域
 *  3. 用户确认或跳过后通过 onAnswer 回调通知父组件
 *  4. ESC 键和点击外部不关闭弹窗，必须显式操作
 */
import React, { useState } from 'react';
import { Modal, Tag, Button, Input } from 'antd';
import './AgentQuestionModal.css';

interface AgentQuestionModalProps {
  /** 问题内容 */
  question: string;
  /** 上下文说明（为什么需要这个信息） */
  why: string;
  /** 预设选项列表 */
  options: string[];
  /** 当前问题序号（从 1 开始） */
  currentIndex: number;
  /** 总问题数 */
  totalCount: number;
  /** 用户确认或跳过时的回调 */
  onAnswer: (answer: string | undefined, skipped: boolean) => void;
}

const AgentQuestionModal: React.FC<AgentQuestionModalProps> = ({
  question,
  why,
  options,
  currentIndex,
  totalCount,
  onAnswer,
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [customInput, setCustomInput] = useState('');

  /** 点击预设选项：高亮选中，取消"其他"状态 */
  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
    setIsOtherSelected(false);
    setCustomInput('');
  };

  /** 点击"其他"选项：展开输入框，取消预设选项高亮 */
  const handleOtherClick = () => {
    setIsOtherSelected(true);
    setSelectedOption(null);
  };

  /** 确认按钮禁用条件：未选择任何选项且"其他"输入框为空 */
  const isConfirmDisabled = !selectedOption && (!isOtherSelected || !customInput.trim());

  /** 点击确认：提交选中的预设选项或自定义输入 */
  const handleConfirm = () => {
    const answer = selectedOption || customInput.trim();
    onAnswer(answer || undefined, false);
  };

  /** 点击跳过：标记为跳过，不提交答案 */
  const handleSkip = () => {
    onAnswer(undefined, true);
  };

  return (
    <Modal
      open={true}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      width={520}
      title="🤔 智能体需要确认"
      className="agent-question-modal"
      centered
    >
      {/* 问题序号 */}
      <div className="aqm-header">
        <Tag color="blue" className="aqm-index-tag">
          问题 {currentIndex}/{totalCount}
        </Tag>
      </div>

      {/* 问题内容 */}
      <div className="aqm-question">{question}</div>

      {/* 上下文说明 */}
      {why && (
        <div className="aqm-why">
          <span className="aqm-why-icon">💡</span>
          <span>{why}</span>
        </div>
      )}

      {/* 预设选项列表 */}
      <div className="aqm-options">
        {options.map((option, idx) => (
          <div
            key={idx}
            className={`aqm-option-card${selectedOption === option ? ' selected' : ''}`}
            onClick={() => handleOptionClick(option)}
          >
            {option}
          </div>
        ))}

        {/* "其他"选项 */}
        <div
          className={`aqm-option-card aqm-other-option${isOtherSelected ? ' selected' : ''}`}
          onClick={handleOtherClick}
        >
          <span className="aqm-other-icon">✏️</span>
          <span>其他</span>
        </div>
      </div>

      {/* "其他"自定义输入区域 */}
      {isOtherSelected && (
        <div className="aqm-custom-input">
          <Input.TextArea
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="请输入自定义答案..."
            autoSize={{ minRows: 3, maxRows: 6 }}
            autoFocus
          />
        </div>
      )}

      {/* 底部按钮 */}
      <div className="aqm-footer">
        <Button onClick={handleSkip}>跳过</Button>
        <Button
          type="primary"
          onClick={handleConfirm}
          disabled={isConfirmDisabled}
        >
          确认
        </Button>
      </div>
    </Modal>
  );
};

export default AgentQuestionModal;
