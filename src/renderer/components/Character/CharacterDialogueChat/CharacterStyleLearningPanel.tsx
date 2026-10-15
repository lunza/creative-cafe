/**
 * 【Phase 4 / L5 - conversation-mode-optimization-report】角色风格学习面板。
 *
 * 参考实现：写作模式 V2StyleLearningPanel（学习 / 报告 / 删除）。
 * 对话模式差异：学习素材是**当前对话历史中的 AI 回复**而非上传文本文件，
 * 产物按角色卡一份持久化（一角色一份最新风格档案，可覆盖重学）。
 *
 * 挂载位置：AssetManagerModal「风格学习」Tab（第 6 个 Tab）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Spin, Tag, Empty, message, Popconfirm, Alert, Descriptions, Collapse } from 'antd';
import { ReadOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { styleLearn } from '../../../services/characterChatService';
import { CharacterStyleResource } from '../../../../shared/types/characterStyle.types';
import type { ChatMessage } from '../../../../shared/types/chat.types';

interface CharacterStyleLearningPanelProps {
  characterCardId: string;
  characterName: string;
  characterDescription?: string;
  characterPersonality?: string;
  /** 当前对话历史（可选；内联模式如 CharacterEditModal 无对话上下文时不传） */
  dialogueMessages?: ChatMessage[];
}

const CharacterStyleLearningPanel: React.FC<CharacterStyleLearningPanelProps> = ({
  characterCardId,
  characterName,
  characterDescription,
  characterPersonality,
  dialogueMessages,
}) => {
  const [resource, setResource] = useState<CharacterStyleResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(false);

  const assistantCount = (dialogueMessages || []).filter(m => m.role === 'assistant').length;

  const loadResource = useCallback(async () => {
    setLoading(true);
    try {
      const style = await styleLearn.get(characterCardId);
      setResource(style);
    } catch {
      setResource(null);
    } finally {
      setLoading(false);
    }
  }, [characterCardId]);

  useEffect(() => {
    if (characterCardId) {
      loadResource();
    }
  }, [characterCardId, loadResource]);

  const handleLearn = async () => {
    if ((dialogueMessages || []).length === 0) {
      message.warning('当前无对话历史，请先进行对话再学习风格');
      return;
    }
    setLearning(true);
    try {
      const result = await styleLearn.learn({
        characterCardId,
        characterCardName: characterName,
        characterCard: {
          description: characterDescription || '',
          personality: characterPersonality || '',
          mesExample: '',
        },
        messages: (dialogueMessages || []).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          speakerName: m.speakerName,
        })),
      });
      if (result.success && result.resource) {
        setResource(result.resource);
        message.success('风格学习完成');
      } else {
        message.error(result.error || '风格学习失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '风格学习失败');
    } finally {
      setLearning(false);
    }
  };

  const handleDelete = async () => {
    await styleLearn.delete(characterCardId);
    setResource(null);
    message.success('风格档案已删除');
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const profile = resource?.status === 'completed' ? resource.profile : null;

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={learning}
          onClick={handleLearn}
          disabled={!dialogueMessages || dialogueMessages.length === 0}
        >
          从当前对话学习风格
        </Button>
        <span style={{ fontSize: 12, color: '#888' }}>
          {dialogueMessages && dialogueMessages.length > 0
            ? `将分析最近 ${assistantCount} 条角色回复的语言风格`
            : '当前无对话历史，无法学习'}
        </span>
        {resource && (
          <Popconfirm title="确认删除该角色的风格档案？" onConfirm={handleDelete}>
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除档案
            </Button>
          </Popconfirm>
        )}
      </div>

      {/* 无对话上下文（内联模式，如 CharacterEditModal）提示 */}
      {!dialogueMessages && (
        <Alert
          type="info"
          showIcon
          message="风格学习基于对话历史，请在对话模式中打开素材管理后使用"
          style={{ marginBottom: 12 }}
        />
      )}

      {learning && (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#888' }}>AI 正在分析角色回复的语言风格，请稍候...</div>
        </div>
      )}

      {!learning && resource && resource.status === 'failed' && (
        <Alert type="error" showIcon message={`上次学习失败：${resource.error || '未知错误'}`} style={{ marginBottom: 12 }} />
      )}

      {!learning && resource && profile && (
        <>
          <Descriptions
            size="small"
            column={1}
            bordered
            items={[
              { key: 'style', label: '说话风格', children: profile.speakingStyle || '—' },
              { key: 'emotion', label: '情感表达', children: profile.emotionalExpression || '—' },
              {
                key: 'vocab',
                label: '高频词汇',
                children:
                  profile.vocabulary.length > 0 ? (
                    profile.vocabulary.map(v => <Tag key={v}>{v}</Tag>)
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'patterns',
                label: '句式特征',
                children:
                  profile.sentencePatterns.length > 0 ? (
                    profile.sentencePatterns.map(p => <Tag key={p} color="blue">{p}</Tag>)
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'signatures',
                label: '口癖与标志短语',
                children:
                  profile.signaturePhrases.length > 0 ? (
                    profile.signaturePhrases.map(s => <Tag key={s} color="purple">{s}</Tag>)
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'taboos',
                label: '负向风格约束',
                children:
                  profile.tabooPatterns.length > 0 ? (
                    profile.tabooPatterns.map(t => <Tag key={t} color="red">{t}</Tag>)
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'meta',
                label: '学习信息',
                children: (
                  <span style={{ fontSize: 12, color: '#888' }}>
                    基于 {resource.messageCount} 条角色回复 · 学习于 {new Date(resource.createdAt).toLocaleString()}
                  </span>
                ),
              },
            ]}
          />
          {profile.fullReport && (
            <Collapse
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'report',
                  label: (
                    <span>
                      <ReadOutlined style={{ marginRight: 6 }} />
                      完整学习报告
                    </span>
                  ),
                  children: (
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{profile.fullReport}</div>
                  ),
                },
              ]}
            />
          )}
        </>
      )}

      {!learning && !profile && !resource && (
        <Empty
          description="尚未学习该角色的语言风格，点击上方按钮基于对话历史学习"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </div>
  );
};

export default CharacterStyleLearningPanel;
