import React, { useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Popconfirm, Space, Tag, message, theme } from 'antd';
import { HistoryOutlined, SaveOutlined, RollbackOutlined } from '@ant-design/icons';
import type { WritingProject, ChapterVersion } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';

interface V2VersionHistoryModalProps {
  project: WritingProject;
  chapterIndex: number;
  /** 编辑器当前正文（实时值，作为"保存当前版本"的快照内容） */
  currentContent: string;
  open: boolean;
  onClose: () => void;
  /** 恢复版本后由工作台同步编辑器（主进程已落盘，无需再次持久化） */
  onContentRestored: (content: string) => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function previewOf(content: string): string {
  const line = (content || '').replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/**
 * V2 章节版本快照对话框
 *
 * 版本来源（主进程 WritingProjectRepository）：
 *  - 手动快照：saveVersion（本对话框"保存当前版本"）
 *  - 自动存档：autoSaveChapter 内容变更时自动保留旧版本（note="自动保存"）
 *
 * 版本数据存于 chapter.versions（单一真相源 = 项目实体），
 * 操作后经 loadProjects 刷新渲染层投影。
 */
const V2VersionHistoryModal: React.FC<V2VersionHistoryModalProps> = ({
  project,
  chapterIndex,
  currentContent,
  open,
  onClose,
  onContentRestored,
}) => {
  const { token } = theme.useToken();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const chapter = project.outline?.chapters?.[chapterIndex];
  const versions = useMemo(
    () => [...(chapter?.versions ?? [])].sort((a, b) => b.timestamp - a.timestamp),
    [chapter?.versions]
  );

  const refresh = () => {
    void useV2ProjectStore.getState().loadProjects();
  };

  const handleSave = async () => {
    const api = getWritingV2API();
    if (!api) return;
    if (!currentContent || !currentContent.trim()) {
      message.warning('当前正文为空，无法保存版本');
      return;
    }
    setSaving(true);
    try {
      const result = await api.saveVersion({
        projectId: project.id,
        chapterIndex,
        content: currentContent,
        note: note.trim() || undefined,
      });
      if (result.success) {
        message.success('版本已保存');
        setNote('');
        refresh();
      } else {
        message.error(result.error || '保存版本失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存版本失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (version: ChapterVersion) => {
    const api = getWritingV2API();
    if (!api) return;
    setRestoringId(version.id);
    try {
      const result = await api.restoreVersion({
        projectId: project.id,
        chapterIndex,
        versionId: version.id,
      });
      if (result.success) {
        message.success('已恢复到该版本');
        onContentRestored(version.content);
        refresh();
      } else {
        message.error(result.error || '恢复版本失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '恢复版本失败');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <HistoryOutlined />
          历史版本
          <Tag>第 {chapterIndex + 1} 章 {chapter?.title || ''}</Tag>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="版本备注（可选）"
          maxLength={50}
          style={{ flex: 1 }}
        />
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!currentContent || !currentContent.trim()}
          onClick={handleSave}
        >
          保存当前版本
        </Button>
      </div>

      <div
        style={{
          maxHeight: 380,
          overflow: 'auto',
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
          padding: '4px 12px',
        }}
      >
        {versions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: token.colorTextTertiary, fontSize: 12 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无版本快照（编辑正文时系统会自动存档旧版本）" />
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              style={{
                padding: '8px 0',
                borderBottom: `1px solid ${token.colorFillQuaternary}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{formatTimestamp(v.timestamp)}</span>
                  <span style={{ color: token.colorTextTertiary }}>{v.content.length} 字</span>
                  {v.note && (
                    <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>{v.note}</Tag>
                  )}
                  {v.isAutoGenerated && (
                    <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                      自动生成
                    </Tag>
                  )}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 12,
                    color: token.colorTextTertiary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {previewOf(v.content) || '（空内容）'}
                </div>
              </div>
              <Popconfirm
                title="恢复到该版本？"
                description="当前正文将被该版本内容替换"
                okText="恢复"
                cancelText="取消"
                onConfirm={() => handleRestore(v)}
              >
                <Button
                  size="small"
                  icon={<RollbackOutlined />}
                  loading={restoringId === v.id}
                >
                  恢复
                </Button>
              </Popconfirm>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};

export default V2VersionHistoryModal;
