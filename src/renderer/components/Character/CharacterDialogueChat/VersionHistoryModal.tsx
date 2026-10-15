/**
 * 【Phase 2 / M6 - conversation-mode-optimization-report】消息版本历史与全局快照（N1，参考 V2VersionHistoryModal）。
 *
 * 能力：
 * - 历史列表：自动存档 + 手动快照（chatVersion.getVersions），显示序号/时间/消息数
 * - 手动快照：备注 + 一键创建全局快照（createLinkedVersion：聊天版本 + 记忆表格快照联动）
 * - 恢复：读取版本内容（getVersionContent）→ 整段对话回退到该时间点（UPDATE_MESSAGES）
 * - 删除：移除版本文件
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, List, Modal, Popconfirm, Space, Spin, Tag, message } from 'antd';
import { CameraOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import { ChatMessage } from './CharacterDialogueChat.types';
import { ChatVersionEntry, chatVersion as chatVersionService } from '../../../services/characterChatService';

interface VersionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  characterCardName: string;
  /** 当前对话消息（手动快照时显式携带，IPC 无状态，主进程读不到渲染侧内存） */
  currentMessages: ChatMessage[];
  /** 恢复整个对话到指定版本的消息列表 */
  onRestore: (messages: ChatMessage[]) => void;
}

const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  open,
  onClose,
  characterCardName,
  currentMessages,
  onRestore,
}) => {
  const [versions, setVersions] = useState<ChatVersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [remark, setRemark] = useState('');

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await chatVersionService.getVersions(characterCardName);
      // 序号倒序（最新在前）
      setVersions([...(list || [])].sort((a, b) => b.sequenceNumber - a.sequenceNumber));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [characterCardName]);

  useEffect(() => {
    if (open) {
      setRemark('');
      loadVersions();
    }
  }, [open, loadVersions]);

  const handleSnapshot = async () => {
    setSnapshotting(true);
    try {
      const result = await chatVersionService.createLinkedVersion(characterCardName, {
        description: remark.trim() || undefined,
        triggerType: 'manual',
        source: 'user',
        // 显式携带当前消息（IPC 无状态，主进程无法读取渲染侧内存）
        messages: currentMessages,
      });
      if (result?.success && result.versionLinkId) {
        message.success('快照已创建');
        setRemark('');
        loadVersions();
      } else {
        message.error(result?.error || '快照创建失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '快照创建失败');
    } finally {
      setSnapshotting(false);
    }
  };

  const handleRestore = async (entry: ChatVersionEntry) => {
    setRestoringId(entry.filePath);
    try {
      const content = await chatVersionService.getVersionContent(entry.filePath);
      // 版本文件由本应用写入（消息列表即 ChatMessage[] 序列化），服务层返回 unknown[] 故此处断言
      const msgs: ChatMessage[] = Array.isArray(content?.messages) ? (content.messages as ChatMessage[]) : [];
      if (msgs.length === 0) {
        message.warning('该版本没有可恢复的消息');
        return;
      }
      onRestore(msgs);
      message.success(`已恢复到版本 #${entry.sequenceNumber}（${msgs.length} 条消息）`);
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '版本恢复失败');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (entry: ChatVersionEntry) => {
    try {
      const ok = await chatVersionService.deleteVersion(entry.filePath);
      if (ok) {
        message.success('版本已删除');
        loadVersions();
      } else {
        message.error('版本删除失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '版本删除失败');
    }
  };

  return (
    <Modal
      title="消息版本历史"
      open={open}
      onCancel={onClose}
      width={640}
      footer={null}
    >
      <div style={{ marginBottom: 16 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="快照备注（可选，如：剧情转折点）"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            onPressEnter={handleSnapshot}
          />
          <Button type="primary" icon={<CameraOutlined />} loading={snapshotting} onClick={handleSnapshot}>
            创建快照
          </Button>
        </Space.Compact>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : versions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>
          暂无历史版本（自动存档与手动快照会出现在这里）
        </div>
      ) : (
        <List
          size="small"
          bordered
          dataSource={versions}
          locale={{ emptyText: '暂无版本' }}
          renderItem={(entry) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="restore"
                  title="恢复到该版本？"
                  description="当前对话内容将被替换为该版本快照，此操作不可撤销。"
                  onConfirm={() => handleRestore(entry)}
                  okText="恢复"
                  cancelText="取消"
                >
                  <Button
                    size="small"
                    icon={<RollbackOutlined />}
                    loading={restoringId === entry.filePath}
                  >
                    恢复
                  </Button>
                </Popconfirm>,
                <Popconfirm
                  key="delete"
                  title="删除该版本？"
                  onConfirm={() => handleDelete(entry)}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={8}>
                    <Tag>#{entry.sequenceNumber}</Tag>
                    <span>{new Date(entry.timestamp).toLocaleString()}</span>
                  </Space>
                }
                description={`${entry.messageCount} 条消息${entry.versionLinkId ? ` · 关联表格快照 ${entry.versionLinkId}` : ''}`}
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
};

export default VersionHistoryModal;
