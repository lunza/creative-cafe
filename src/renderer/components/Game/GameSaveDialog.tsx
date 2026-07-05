/**
 * 游戏存档选择对话框（Task 10 / SubTask 10.2）
 *
 * 职责：
 * - 加载并展示当前游戏的存档列表（每个存档项含名称 / 最后保存时间 / 当前剧情节点）
 * - 支持删除存档（Popconfirm 二次确认）
 * - 支持选中存档后确认加载（Popconfirm 二次确认 → loadSave → setCurrentView('main') → 关闭对话框）
 *
 * 数据源：
 * - 挂载时通过 window.electronAPI.game.listSaves(currentGameId) 加载存档列表
 * - 删除存档通过 window.electronAPI.game.deleteSave(saveId) 直接调用主进程
 *   （gameStore 未提供 deleteSave action，避免存档删除与状态管理耦合）
 *
 * 设计要点：
 * - open 与 onClose 由父组件（GameDetailPage）控制
 * - 删除/读取成功后通过 onClose 关闭对话框，由父组件按需触发后续视图切换
 * - 空状态使用 antd Empty，文案"暂无存档，请开始新游戏"
 *
 * 注意：
 * - gameStore 没有 deleteSave action（Task 6 设计取舍），此处直接调用 preload API
 * - 读取存档通过 gameStore.loadSave 完成，确保 store 状态与存档数据同步
 */

import { useEffect, useState, useCallback } from 'react';
import { Modal, List, Button, Empty, Popconfirm, Typography, message, Spin } from 'antd';
import { useGameStore } from '../../stores/gameStore';
import { useGameUIStore } from '../../stores/gameUIStore';
import type { GameSaveMeta } from '../../../shared/types/game.types';

const { Text, Paragraph } = Typography;

export interface GameSaveDialogProps {
  /** 对话框是否可见 */
  open: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
}

/**
 * 格式化时间戳为本地化字符串
 *
 * @param timestamp ms 时间戳
 * @returns 格式化后的字符串（如 "2026/07/05 14:30:25"），无效时间戳返回 "—"
 */
function formatTimestamp(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '—';
  }
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return String(timestamp);
  }
}

export const GameSaveDialog: React.FC<GameSaveDialogProps> = ({ open, onClose }) => {
  const currentGameId = useGameStore((s) => s.currentGameId);
  const loadSave = useGameStore((s) => s.loadSave);
  const setCurrentView = useGameUIStore((s) => s.setCurrentView);

  const [saves, setSaves] = useState<GameSaveMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingSaveId, setLoadingSaveId] = useState<string | null>(null);

  /**
   * 加载存档列表
   *
   * 在 open 切换为 true 时调用，避免对话框隐藏时也发起请求。
   * 若 currentGameId 为空则跳过。
   */
  const reloadSaves = useCallback(async () => {
    if (!currentGameId) {
      setSaves([]);
      return;
    }
    setLoading(true);
    try {
      // IPC 返回 { success, saves }，需解构 saves 数组
      const result = await window.electronAPI?.game?.listSaves(currentGameId);
      setSaves(result?.success ? (result.saves ?? []) : []);
    } catch (err) {
      console.error('[GameSaveDialog] listSaves failed:', err);
      message.error('加载存档列表失败');
      setSaves([]);
    } finally {
      setLoading(false);
    }
  }, [currentGameId]);

  useEffect(() => {
    if (open) {
      void reloadSaves();
    }
  }, [open, reloadSaves]);

  /**
   * 删除存档
   *
   * 通过 preload API 直接调用主进程，删除后刷新列表。
   */
  const handleDelete = async (saveId: string) => {
    setDeletingId(saveId);
    try {
      await window.electronAPI?.game?.deleteSave(saveId);
      message.success('存档已删除');
      await reloadSaves();
    } catch (err) {
      console.error('[GameSaveDialog] deleteSave failed:', err);
      message.error('删除存档失败');
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * 读取存档
   *
   * 调用 gameStore.loadSave 完成存档加载（store 会同步 narrativeLog / tableData），
   * 然后切换到 main 视图并关闭对话框。
   */
  const handleLoadSave = async (saveId: string) => {
    setLoadingSaveId(saveId);
    try {
      await loadSave(saveId);
      setCurrentView('main');
      onClose();
    } catch (err) {
      console.error('[GameSaveDialog] loadSave failed:', err);
      message.error('读取存档失败');
    } finally {
      setLoadingSaveId(null);
    }
  };

  return (
    <Modal
      title="读取存档"
      open={open}
      onCancel={onClose}
      footer={
        <Button onClick={onClose}>关闭</Button>
      }
      width={640}
      destroyOnClose={false}
    >
      <Spin spinning={loading}>
        {saves.length === 0 && !loading ? (
          <Empty
            description="暂无存档，请开始新游戏"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <List
            dataSource={saves}
            rowKey={(item) => item.id}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="load"
                    title="确认读取此存档？"
                    description={item.name}
                    onConfirm={() => handleLoadSave(item.id)}
                    okText="确认"
                    cancelText="取消"
                  >
                    <Button
                      type="link"
                      loading={loadingSaveId === item.id}
                    >
                      读取
                    </Button>
                  </Popconfirm>,
                  <Popconfirm
                    key="delete"
                    title="确认删除此存档？"
                    description="删除后无法恢复"
                    onConfirm={() => handleDelete(item.id)}
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                  >
                    <Button
                      type="link"
                      danger
                      loading={deletingId === item.id}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta
                  title={<Text strong>{item.name}</Text>}
                  description={
                    <Paragraph style={{ marginBottom: 0 }}>
                      <Text type="secondary">
                        最后保存：{formatTimestamp(item.updatedAt || item.createdAt)}
                      </Text>
                      <br />
                      <Text type="secondary">
                        当前节点：{item.nodeTitle || '未开始'}
                      </Text>
                      <br />
                      <Text type="secondary">
                        消息数：{item.messageCount ?? 0}　·　回合数：{item.turnCount ?? 0}
                      </Text>
                    </Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Spin>
    </Modal>
  );
};

export default GameSaveDialog;
