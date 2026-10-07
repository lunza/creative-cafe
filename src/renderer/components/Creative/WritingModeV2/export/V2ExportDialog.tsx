import React, { useMemo, useState } from 'react';
import { Checkbox, Divider, Modal, Radio, Space, Tag, message, theme } from 'antd';
import { ExportOutlined, CheckCircleFilled } from '@ant-design/icons';
import type { WritingProject } from '../../../../../shared/types/writing-v2.types';
import { ExportFormat } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2UIStore } from '../stores/useV2UIStore';

interface V2ExportDialogProps {
  project: WritingProject;
}

/**
 * V2 导出对话框（Phase 1 / P0）
 *
 * 格式：TXT / Markdown / JSON；章节：多选（默认全选）。
 * 通过 writingV2:exportWithChapters 通道导出（主进程实现），成功后展示文件路径。
 */
const V2ExportDialog: React.FC<V2ExportDialogProps> = ({ project }) => {
  const { token } = theme.useToken();
  const showExportDialog = useV2UIStore((s) => s.showExportDialog);
  const setShowExportDialog = useV2UIStore((s) => s.setShowExportDialog);

  const chapters = project.outline?.chapters ?? [];
  const [format, setFormat] = useState<ExportFormat>(ExportFormat.TXT);
  const [selected, setSelected] = useState<number[]>(() => chapters.map((c) => c.index));
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  const allIndices = useMemo(() => chapters.map((c) => c.index), [chapters]);
  const allChecked = selected.length === allIndices.length && allIndices.length > 0;
  const indeterminate = selected.length > 0 && !allChecked;

  const toggleAll = (checked: boolean) => setSelected(checked ? allIndices : []);

  const handleExport = async () => {
    const api = getWritingV2API();
    if (!api) return;
    if (selected.length === 0) {
      message.warning('请至少选择一个章节');
      return;
    }
    setExporting(true);
    setExportedPath(null);
    try {
      const result = await api.exportWithChapters(project.id, format, selected);
      if (result.success && result.filePath) {
        setExportedPath(result.filePath);
        message.success('导出成功');
      } else {
        message.error(result.error || '导出失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleClose = () => {
    setShowExportDialog(false);
    setExportedPath(null);
  };

  return (
    <Modal
      title={
        <Space>
          <ExportOutlined />
          导出作品
          <Tag>{project.title || '未命名作品'}</Tag>
        </Space>
      }
      open={showExportDialog}
      onOk={handleExport}
      onCancel={handleClose}
      confirmLoading={exporting}
      okText="导出"
      okButtonProps={{ disabled: selected.length === 0 }}
      width={560}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>导出格式</div>
        <Radio.Group
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: 'TXT', value: ExportFormat.TXT },
            { label: 'Markdown', value: ExportFormat.MARKDOWN },
            { label: 'JSON', value: ExportFormat.JSON },
          ]}
        />
      </div>

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox
          checked={allChecked}
          indeterminate={indeterminate}
          onChange={(e) => toggleAll(e.target.checked)}
        >
          全选
        </Checkbox>
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          已选 {selected.length}/{chapters.length} 章
        </span>
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: '4px 12px' }}>
        {chapters.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: token.colorTextTertiary, fontSize: 12 }}>
            暂无章节
          </div>
        ) : (
          chapters.map((c) => {
            const hasContent = !!c.content && c.content.trim().length > 0;
            return (
              <div
                key={c.index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: `1px solid ${token.colorFillQuaternary}`,
                }}
              >
                <Checkbox
                  checked={selected.includes(c.index)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, c.index] : prev.filter((i) => i !== c.index)
                    )
                  }
                >
                  <span style={{ fontSize: 13 }}>
                    {c.index + 1}. {c.title}
                  </span>
                </Checkbox>
                <span style={{ flex: 1 }} />
                {hasContent ? (
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>
                    {c.wordCount || 0} 字
                  </Tag>
                ) : (
                  <Tag style={{ marginInlineEnd: 0 }}>无内容</Tag>
                )}
              </div>
            );
          })
        )}
      </div>

      {exportedPath && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: token.colorSuccessBg,
            border: `1px solid ${token.colorSuccessBorder}`,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircleFilled style={{ color: token.colorSuccess }} />
          <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{exportedPath}</span>
        </div>
      )}
    </Modal>
  );
};

export default V2ExportDialog;
