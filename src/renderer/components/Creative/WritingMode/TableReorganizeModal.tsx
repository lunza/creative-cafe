import React, { useState, useCallback, useEffect } from 'react';
import { Modal, Input, Typography, message } from 'antd';
import type { AIEngineSetting } from '../../../types/setting';

const { Text } = Typography;
const { TextArea } = Input;

export interface TableReorganizeModalProps {
  /** 受控：是否可见 */
  visible: boolean;
  /** 受控：要重整的行索引 */
  rowIndex: number;
  /** 项目 ID */
  projectId?: string;
  /** 当前 sheet 名 */
  currentSheet: string;
  /** 当前 sheet 的全部行数据（按行索引读取原始行） */
  sheetData: Record<string, unknown>[];
  /** 关闭 Modal 的回调（同时清空表单） */
  onClose: () => void;
  /**
   * 重整成功后的回调，父组件负责更新本地表格状态
   * @param updatedRow 服务端返回的最新行数据
   */
  onSuccess: (updatedRow: Record<string, unknown>) => void;
}

/**
 * 重新整理单行 Modal
 *
 * 抽自原 TableOrganizePanelContent 的「重新整理行数据模态框」子功能：
 * - 用户输入整理要求后通过 AI 重整该行
 * - 行数据保持唯一 ID 不变
 *
 * 该组件自包含整理要求 state 与整理中 loading state，
 * 与父组件的接口仅通过 visible / rowIndex / onSuccess 暴露。
 */
const TableReorganizeModal: React.FC<TableReorganizeModalProps> = ({
  visible,
  rowIndex,
  projectId,
  currentSheet,
  sheetData,
  onClose,
  onSuccess,
}) => {
  const [reorganizeDescription, setReorganizeDescription] = useState('');
  const [reorganizing, setReorganizing] = useState(false);

  // Modal 关闭/打开时重置描述
  useEffect(() => {
    if (!visible) {
      setReorganizeDescription('');
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    if (reorganizing) return; // 整理中不允许关闭
    setReorganizeDescription('');
    onClose();
  }, [reorganizing, onClose]);

  const handleReorganizeRow = useCallback(async () => {
    if (!reorganizeDescription.trim()) {
      message.warning('请输入整理要求');
      return;
    }
    if (!projectId || !currentSheet || rowIndex < 0) return;

    setReorganizing(true);
    try {
      const row = sheetData?.[rowIndex];
      if (!row) {
        message.error('行数据不存在');
        return;
      }

      // 获取当前活跃的 AI 引擎配置（与 handleStartOrganize 保持一致）
      const settingResponse = await window.electronAPI.setting.load();
      if (!settingResponse.success) {
        throw new Error('无法获取系统设置');
      }
      const currentSetting = settingResponse.setting;
      const activeEngineId = currentSetting?.activeEngineId;
      const engines: AIEngineSetting[] = currentSetting?.aiEngines || [];
      const currentActiveEngine = engines.find((e) => e.id === activeEngineId) || engines[0];
      if (!currentActiveEngine) {
        throw new Error('未配置 AI 引擎，请在设置中配置');
      }

      const temperature =
        typeof currentActiveEngine.temperature === 'number' &&
        currentActiveEngine.temperature >= 0 &&
        currentActiveEngine.temperature <= 2
          ? currentActiveEngine.temperature
          : 0.7;
      const maxTokens =
        typeof currentActiveEngine.max_tokens === 'number' && currentActiveEngine.max_tokens > 0
          ? currentActiveEngine.max_tokens
          : 10240;
      const modelConfig = { temperature, maxTokens };

      const result = await window.electronAPI.writing.table.reorganizeRow(
        projectId,
        currentSheet,
        rowIndex,
        row,
        reorganizeDescription.trim(),
        modelConfig
      );

      if (result.success) {
        message.success('重新整理完成');
        onSuccess(result.updatedRow || row);
        setReorganizeDescription('');
        onClose();
      } else {
        message.error(`重新整理失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`重新整理出错: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReorganizing(false);
    }
  }, [reorganizeDescription, projectId, currentSheet, rowIndex, sheetData, onSuccess, onClose]);

  return (
    <Modal
      title={`重新整理第 ${rowIndex + 1} 行`}
      open={visible}
      onCancel={handleClose}
      onOk={handleReorganizeRow}
      confirmLoading={reorganizing}
      okText="提交整理"
      cancelText="取消"
      width={600}
      maskClosable={false}
    >
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          请输入整理要求，系统将对该行数据进行 AI 优化整理（唯一 ID 将保持不变）
        </Text>
      </div>
      <TextArea
        placeholder="例如：补充角色的外观描述、完善战斗数据数值、整理魔法体系层级等"
        value={reorganizeDescription}
        onChange={(e) => setReorganizeDescription(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 6 }}
        disabled={reorganizing}
      />
    </Modal>
  );
};

export default React.memo(TableReorganizeModal);
