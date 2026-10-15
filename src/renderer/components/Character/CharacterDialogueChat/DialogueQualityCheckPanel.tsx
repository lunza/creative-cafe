/**
 * 【Phase 4 / L4 - conversation-mode-optimization-report】对话质量检查与人设一致性检查面板。
 *
 * 参考实现：写作模式 V2PlotCheckPanel（多维度评分 + 问题清单 + 自动修正 + 检查历史/评分趋势）。
 * 对话模式将「章节」替换为「对话轮次」，「剧情检查」替换为「人设一致性检查」。
 *
 * 功能：
 * - 一键检查：三维度评分（人设一致性/对话连贯性/情感表达合理性）+ 问题清单
 * - 自动修正：对可定位的问题请求 AI 重写目标消息，预览后采纳（替换消息内容）
 * - 检查历史：评分趋势（最近若干次检查的综合评分）
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Spin, Tag, Empty, message, Collapse, Input, Popconfirm, Progress, Divider, Alert } from 'antd';
import { CheckCircleOutlined, HistoryOutlined, ClearOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { qualityCheck } from '../../../services/characterChatService';
import {
  DialogueQualityReport,
  DialogueQualityIssue,
  DialogueQualityHistoryEntry,
  DialogueQualityMessageRef,
  DialogueQualityCharacterCard,
  DIALOGUE_QUALITY_DIMENSION_LABELS,
  DIALOGUE_QUALITY_SEVERITY_LABELS,
} from '../../../../shared/types/dialogueQuality.types';
import type { ChatMessage } from '../../../../shared/types/chat.types';
import type { CharacterInfo } from './CharacterDialogueChat.types';
import { formatTimestamp } from '../../../../shared/utils/timeFormat';

interface DialogueQualityCheckPanelProps {
  open: boolean;
  onClose: () => void;
  characterInfo: CharacterInfo;
  messages: ChatMessage[];
  /** 采纳修正：替换指定消息的内容（内部走 editMessage，会同步持久化） */
  onApplyFix: (messageId: string, newContent: string) => void;
}

const SEVERITY_COLOR: Record<string, string> = { high: 'red', medium: 'orange', low: 'blue' };

/** 将渲染层 ChatMessage[] 转为 IPC 边界类型 */
function toMessageRefs(messages: ChatMessage[]): DialogueQualityMessageRef[] {
  return messages
    .filter(m => m.status !== 'error' && m.content && m.content.trim())
    .map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      speakerName: m.speakerName,
      timestamp: m.timestamp,
    }));
}

/** 取目标消息的上下文（前 2 条 + 后 1 条，用于修正时理解语境） */
function buildContextRefs(messages: ChatMessage[], targetId: string): DialogueQualityMessageRef[] {
  const idx = messages.findIndex(m => m.id === targetId);
  if (idx === -1) return [];
  const slice = messages.slice(Math.max(0, idx - 2), idx + 2).filter(m => m.id !== targetId);
  return slice.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    speakerName: m.speakerName,
    timestamp: m.timestamp,
  }));
}

function scoreColor(score: number): string {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  return '#ff4d4f';
}

const DialogueQualityCheckPanel: React.FC<DialogueQualityCheckPanelProps> = ({
  open,
  onClose,
  characterInfo,
  messages,
  onApplyFix,
}) => {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<DialogueQualityReport | null>(null);
  const [history, setHistory] = useState<DialogueQualityHistoryEntry[]>([]);
  // 修正预览态：issueId → AI 重写的候选内容
  const [fixingIssueId, setFixingIssueId] = useState<string | null>(null);
  const [fixPreview, setFixPreview] = useState<{ issue: DialogueQualityIssue; fixedContent: string } | null>(null);

  const buildCard = useCallback((): DialogueQualityCharacterCard => ({
    name: characterInfo.characterCardName,
    description: characterInfo.characterCardContent || '',
    personality: characterInfo.personality || '',
    mesExample: characterInfo.mes_example || '',
    scenario: characterInfo.scenario || '',
  }), [characterInfo]);

  const loadHistory = useCallback(async () => {
    try {
      const h = await qualityCheck.getHistory(characterInfo.characterCardId);
      setHistory(h);
    } catch {
      // 历史加载失败不阻塞主流程
    }
  }, [characterInfo.characterCardId]);

  // 打开时重置瞬态并加载历史
  useEffect(() => {
    if (open) {
      setReport(null);
      setFixingIssueId(null);
      setFixPreview(null);
      loadHistory();
    }
  }, [open, loadHistory]);

  const handleCheck = async () => {
    const refs = toMessageRefs(messages);
    if (refs.length < 2) {
      message.warning('对话内容过少（至少 2 条有效消息），无法进行质量检查');
      return;
    }
    setChecking(true);
    try {
      const result = await qualityCheck.check({
        characterCardId: characterInfo.characterCardId,
        characterCard: buildCard(),
        messages: refs,
      });
      if (result.success && result.report) {
        setReport(result.report);
        loadHistory();
      } else {
        message.error(result.error || '对话质量检查失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '对话质量检查失败');
    } finally {
      setChecking(false);
    }
  };

  const handleFix = async (issue: DialogueQualityIssue) => {
    if (!issue.fixable || issue.messageIds.length === 0) return;
    const targetId = issue.messageIds[0];
    const target = messages.find(m => m.id === targetId);
    if (!target) {
      message.warning('目标消息已不存在，无法修正');
      return;
    }
    setFixingIssueId(issue.id);
    setFixPreview(null);
    try {
      const result = await qualityCheck.fixIssue({
        characterCard: buildCard(),
        issue,
        targetMessage: {
          id: target.id,
          role: target.role,
          content: target.content,
          speakerName: target.speakerName,
          timestamp: target.timestamp,
        },
        contextMessages: buildContextRefs(messages, targetId),
      });
      if (result.success) {
        setFixPreview({ issue, fixedContent: result.fixedContent });
      } else {
        message.error(result.error || '自动修正失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自动修正失败');
    } finally {
      setFixingIssueId(null);
    }
  };

  const handleApplyFix = () => {
    if (!fixPreview) return;
    const targetId = fixPreview.issue.messageIds[0];
    onApplyFix(targetId, fixPreview.fixedContent);
    setFixPreview(null);
    message.success('已采纳修正，消息已更新');
  };

  const renderIssue = (issue: DialogueQualityIssue) => {
    const isFixing = fixingIssueId === issue.id;
    const previewing = fixPreview?.issue.id === issue.id;
    return (
      <Collapse.Panel
        key={issue.id}
        header={
          <span>
            <Tag color={SEVERITY_COLOR[issue.severity]}>
              {DIALOGUE_QUALITY_SEVERITY_LABELS[issue.severity]}
            </Tag>
            <Tag>{DIALOGUE_QUALITY_DIMENSION_LABELS[issue.dimension]}</Tag>
            {issue.title}
          </span>
        }
      >
        {issue.quote && (
          <Alert
            type="warning"
            showIcon
            message="问题原文"
            description={<span style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{issue.quote}</span>}
            style={{ marginBottom: 8 }}
          />
        )}
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <strong>问题描述：</strong>
          {issue.description}
        </div>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <strong>修正建议：</strong>
          {issue.suggestion}
        </div>
        {previewing && fixPreview && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>AI 修正预览（可编辑后再采纳）：</div>
            <Input.TextArea
              rows={4}
              value={fixPreview.fixedContent}
              onChange={e => setFixPreview({ issue, fixedContent: e.target.value })}
            />
            <Button type="primary" size="small" onClick={handleApplyFix} style={{ marginTop: 8 }}>
              采纳修正
            </Button>
          </div>
        )}
        {issue.fixable && !previewing && (
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={isFixing}
            onClick={() => handleFix(issue)}
          >
            获取 AI 修正
          </Button>
        )}
      </Collapse.Panel>
    );
  };

  return (
    <Modal
      title={
        <span>
          <CheckCircleOutlined style={{ marginRight: 8 }} />
          对话质量检查 · {characterInfo.characterCardName}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnClose
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={checking} onClick={handleCheck}>
          开始质量检查
        </Button>
        <span style={{ fontSize: 12, color: '#888' }}>
          将检查最近 {Math.min(messages.length, 100)} 条消息的人设一致性 / 对话连贯性 / 情感表达
        </span>
      </div>

      {checking && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#888' }}>AI 正在逐轮分析对话内容，请稍候...</div>
        </div>
      )}

      {!checking && report && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 140px', textAlign: 'center' }}>
              <Progress
                type="dashboard"
                percent={report.overallScore}
                format={p => <span style={{ fontSize: 20, color: scoreColor(report.overallScore) }}>{p}</span>}
                strokeColor={scoreColor(report.overallScore)}
                size={120}
              />
              <div style={{ fontSize: 12, color: '#888' }}>综合评分</div>
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              {report.dimensions.map(d => (
                <div key={d.dimension} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{DIALOGUE_QUALITY_DIMENSION_LABELS[d.dimension]}</span>
                    <span style={{ color: scoreColor(d.score) }}>{d.score}</span>
                  </div>
                  <Progress percent={d.score} showInfo={false} strokeColor={scoreColor(d.score)} size="small" />
                  {d.comment && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{d.comment}</div>}
                </div>
              ))}
            </div>
            <div style={{ flex: '0 0 120px', fontSize: 12, color: '#888', alignSelf: 'flex-end' }}>
              问题总数：{report.totalIssues}
              <br />
              高 {report.highSeverityCount} / 中 {report.mediumSeverityCount} / 低 {report.lowSeverityCount}
            </div>
          </div>

          {report.issues.length === 0 ? (
            <Empty description="未发现明显问题，对话质量良好" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Collapse defaultActiveKey={report.issues.filter(i => i.severity === 'high').map(i => i.id)}>
              {report.issues.map(renderIssue)}
            </Collapse>
          )}
        </>
      )}

      {!checking && !report && <Empty description="点击「开始质量检查」分析当前对话" image={Empty.PRESENTED_IMAGE_SIMPLE} />}

      {/* 检查历史与评分趋势 */}
      {history.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0 8px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#888' }}>
              <HistoryOutlined style={{ marginRight: 6 }} />
              检查历史（最近 {history.length} 次）
            </span>
            <Popconfirm title="确认清空该角色的检查历史？" onConfirm={async () => {
              await qualityCheck.clearHistory(characterInfo.characterCardId);
              setHistory([]);
            }}>
              <Button size="small" icon={<ClearOutlined />} type="text">
                清空
              </Button>
            </Popconfirm>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {history.slice(-10).map(h => (
              <div
                key={h.id}
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  minWidth: 90,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, color: scoreColor(h.overallScore) }}>{h.overallScore}</div>
                <div style={{ color: '#888' }}>
                  {new Date(h.checkedAt).toLocaleDateString()} {formatTimestamp(h.checkedAt)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};

export default DialogueQualityCheckPanel;
