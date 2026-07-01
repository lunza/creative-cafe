import React, { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Modal, Button, Typography, message } from 'antd';
import { RollbackOutlined, CheckOutlined } from '@ant-design/icons';
import TableVersionCompareModal from './TableVersionCompareModal';

const { Text } = Typography;

export interface TableVersionControlHandle {
  /** 触发检查是否有未确认版本快照 */
  checkPendingVersion: () => Promise<void>;
  /** 打开回退确认弹窗 */
  openRollback: () => void;
  /** 打开版本对比弹窗 */
  openConfirm: () => void;
  /** 当前是否有未确认版本 */
  hasPendingVersion: boolean;
}

export interface TableVersionControlProps {
  projectId?: string;
  /** 当前章节 ID，用于检测章节切换时是否提示用户处理未确认版本 */
  chapterId?: number;
  /** 是否正处于整理中状态，用于禁用版本控制按钮 */
  organizing: boolean;
  /** 是否正处于单表整理中状态，用于禁用版本控制按钮 */
  singleSheetOrganizing: boolean;
  /** 切换章节时的回调（父组件用于在用户选择保留后更新 prevChapterIdRef） */
  onChapterSwitchResolved?: (newChapterId: number) => void;
  /** 重新加载表格数据的回调（回退/确认后调用） */
  reloadTableData: () => Promise<void> | void;
  /** hasPendingVersion 变化时的回调（父组件用于显示版本状态提示条） */
  onPendingVersionChange?: (hasPending: boolean) => void;
}

/**
 * 表格版本控制组件
 *
 * 抽自原 TableOrganizePanelContent 的版本控制相关逻辑：
 * - 检查是否有未确认的整理版本快照
 * - 章节切换时提示用户保留 / 放弃整理结果
 * - 回退 / 确认版本（含对比弹窗 TableVersionCompareModal）
 *
 * 通过 forwardRef + useImperativeHandle 暴露：
 * - checkPendingVersion(): 整理完成后调用以刷新待确认状态
 * - openRollback() / openConfirm(): 由父组件的按钮触发
 * - hasPendingVersion: 当前状态（同步读取最新值）
 *
 * 父组件负责根据 onPendingVersionChange 渲染顶部提示条与回退/确认按钮，
 * 按钮点击时调用 ref 上的方法。
 */
const TableVersionControl = forwardRef<TableVersionControlHandle, TableVersionControlProps>(
  (
    {
      projectId,
      chapterId,
      organizing,
      singleSheetOrganizing,
      onChapterSwitchResolved,
      reloadTableData,
      onPendingVersionChange,
    },
    ref
  ) => {
    const [hasPendingVersion, setHasPendingVersion] = useState(false);
    const [versionCompareModalVisible, setVersionCompareModalVisible] = useState(false);
    const [chapterSwitchModalVisible, setChapterSwitchModalVisible] = useState(false);
    const [rollbackModalVisible, setRollbackModalVisible] = useState(false);
    const [rollbackLoading, setRollbackLoading] = useState(false);

    const prevChapterIdRef = useRef<number | undefined>(chapterId);
    const pendingChapterIdRef = useRef<number | null>(null);
    const hasPendingRef = useRef(false);

    const checkPendingVersion = useCallback(async () => {
      if (!projectId) return;
      try {
        const response = await window.electronAPI.writing.table.getVersionSnapshot(projectId);
        if (response.success && response.snapshot) {
          setHasPendingVersion(true);
          hasPendingRef.current = true;
          onPendingVersionChange?.(true);
        } else {
          setHasPendingVersion(false);
          hasPendingRef.current = false;
          onPendingVersionChange?.(false);
        }
      } catch (error) {
        console.error('检查版本快照失败:', error);
        setHasPendingVersion(false);
        hasPendingRef.current = false;
        onPendingVersionChange?.(false);
      }
    }, [projectId, onPendingVersionChange]);

    useImperativeHandle(
      ref,
      () => ({
        checkPendingVersion,
        openRollback: () => setRollbackModalVisible(true),
        openConfirm: () => setVersionCompareModalVisible(true),
        get hasPendingVersion() {
          return hasPendingRef.current;
        },
      }),
      [checkPendingVersion]
    );

    useEffect(() => {
      checkPendingVersion();
    }, [checkPendingVersion]);

    // 监听章节切换，提示用户处理未确认的版本
    useEffect(() => {
      if (prevChapterIdRef.current !== chapterId && hasPendingVersion) {
        pendingChapterIdRef.current = chapterId ?? null;
        setChapterSwitchModalVisible(true);
      }
      // 只有在用户明确选择"保留并离开"或"放弃整理结果"后才更新 ref
      // 如果用户点击"取消"，不更新 ref，下次切换章节时仍会提示
    }, [chapterId, hasPendingVersion]);

    // 章节切换确认 - 保留并离开
    const handleChapterSwitchKeep = useCallback(() => {
      prevChapterIdRef.current = pendingChapterIdRef.current ?? chapterId;
      setChapterSwitchModalVisible(false);
      if (pendingChapterIdRef.current != null) {
        onChapterSwitchResolved?.(pendingChapterIdRef.current);
      }
    }, [chapterId, onChapterSwitchResolved]);

    // 章节切换确认 - 放弃整理结果
    const handleChapterSwitchDiscard = useCallback(async () => {
      if (projectId) {
        await window.electronAPI.writing.table.clearVersionSnapshot(projectId);
        setHasPendingVersion(false);
        hasPendingRef.current = false;
        onPendingVersionChange?.(false);
      }
      prevChapterIdRef.current = pendingChapterIdRef.current ?? chapterId;
      setChapterSwitchModalVisible(false);
      if (pendingChapterIdRef.current != null) {
        onChapterSwitchResolved?.(pendingChapterIdRef.current);
      }
    }, [projectId, chapterId, onChapterSwitchResolved, onPendingVersionChange]);

    // 章节切换确认 - 取消
    const handleChapterSwitchCancel = useCallback(() => {
      setChapterSwitchModalVisible(false);
    }, []);

    const handleRollbackVersion = useCallback(async () => {
      if (!projectId) return;
      setRollbackLoading(true);
      try {
        const response = await window.electronAPI.writing.table.rollbackVersion(projectId);
        if (response.success) {
          message.success('已恢复到整理前的状态');
          setHasPendingVersion(false);
          hasPendingRef.current = false;
          onPendingVersionChange?.(false);
          await reloadTableData();
        } else {
          message.error(`回退失败: ${response.error || '未知错误'}`);
        }
      } catch (error) {
        console.error('回退版本失败:', error);
        message.error(`回退出错: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setRollbackLoading(false);
        setRollbackModalVisible(false);
      }
    }, [projectId, reloadTableData, onPendingVersionChange]);

    const handleVersionCompareConfirm = useCallback(async () => {
      if (!projectId) return;
      try {
        const response = await window.electronAPI.writing.table.confirmVersion(projectId);
        if (response.success) {
          message.success('数据已成功覆盖');
          setHasPendingVersion(false);
          hasPendingRef.current = false;
          onPendingVersionChange?.(false);
          setVersionCompareModalVisible(false);
          await reloadTableData();
        } else {
          message.error(`确认覆盖失败: ${response.error || '未知错误'}`);
        }
      } catch (error) {
        console.error('确认覆盖失败:', error);
        message.error(`确认覆盖出错: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, [projectId, reloadTableData, onPendingVersionChange]);

    return (
      <>
        {/* 版本对比弹窗 */}
        <TableVersionCompareModal
          visible={versionCompareModalVisible}
          projectId={projectId!}
          onClose={() => setVersionCompareModalVisible(false)}
          onConfirm={handleVersionCompareConfirm}
          onRollback={handleRollbackVersion}
        />

        {/* 章节切换确认弹窗 */}
        <Modal
          title="未确认的表格整理结果"
          open={chapterSwitchModalVisible}
          onCancel={handleChapterSwitchCancel}
          footer={null}
        >
          <Text>有未确认的表格整理结果，是否保留？</Text>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button danger onClick={handleChapterSwitchDiscard}>
              放弃整理结果
            </Button>
            <Button onClick={handleChapterSwitchCancel}>
              取消
            </Button>
            <Button type="primary" onClick={handleChapterSwitchKeep}>
              保留并离开
            </Button>
          </div>
        </Modal>

        {/* 回退确认弹窗 */}
        <Modal
          title="确认回退"
          open={rollbackModalVisible}
          onOk={handleRollbackVersion}
          onCancel={() => setRollbackModalVisible(false)}
          okText="确认回退"
          cancelText="取消"
          confirmLoading={rollbackLoading}
        >
          <Text>回退将恢复到整理前的状态，放弃本次整理结果。确定要回退吗？</Text>
        </Modal>
      </>
    );
  }
);

TableVersionControl.displayName = 'TableVersionControl';

export default React.memo(TableVersionControl);

// 默认导出按钮小组件，便于父组件复用（保持按钮样式与原行为一致）
interface VersionActionButtonsProps {
  organizing: boolean;
  singleSheetOrganizing: boolean;
  onRollback: () => void;
  onConfirm: () => void;
  size?: 'small' | 'middle' | 'large';
}

export const VersionActionButtons: React.FC<VersionActionButtonsProps> = ({
  organizing,
  singleSheetOrganizing,
  onRollback,
  onConfirm,
  size = 'small',
}) => {
  return (
    <>
      <Button
        icon={<RollbackOutlined />}
        onClick={onRollback}
        disabled={organizing || singleSheetOrganizing}
        size={size}
      >
        回退
      </Button>
      <Button
        icon={<CheckOutlined />}
        onClick={onConfirm}
        disabled={organizing || singleSheetOrganizing}
        size={size}
        type="primary"
      >
        确认
      </Button>
    </>
  );
};
