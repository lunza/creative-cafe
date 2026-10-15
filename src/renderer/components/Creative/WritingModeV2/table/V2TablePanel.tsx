import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  theme,
  message,
} from 'antd';
import {
  TableOutlined,
  PlayCircleOutlined,
  LinkOutlined,
  RollbackOutlined,
  CheckOutlined,
  ClearOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  TableOutlined as SheetOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type {
  WritingProject,
  WritingTableData,
  WritingTableConfig,
  V2TableTemplate,
  V2VersionSnapshotResult,
  V2ChapterOrganizeStatus,
  V2IdConsistencyReport,
  V2IdSheetStats,
  V2IdDuplicateGroup,
} from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { WRITING_DEFAULT_TABLE_TEMPLATE_ID } from '../../../../../shared/constants/writingTableTemplates';
import { buildTableCsv } from '../../../../../shared/utils/v2TableUtils';
import V2TableView from './V2TableView';
import V2TemplateManager from './V2TemplateManager';

interface V2TablePanelProps {
  project: WritingProject;
  /** 当前选中章节索引（整理时作为上下文） */
  chapterIndex: number;
}

const CHAPTER_STATUS_COLORS: Record<string, string> = {
  completed: 'green',
  organized: 'green',
  organizing: 'blue',
  processing: 'blue',
  failed: 'red',
  error: 'red',
  pending: 'default',
};

/**
 * 数据层行 key → UI 列名 key 映射。
 *
 * 主进程存储约定（与对话/记忆模块表格一致，TableEditCommandExecutor 落盘格式）：
 *   key "0" = 流水号（系统内部，UI 不展示）
 *   key "1" = 唯一id（实体去重键，UI 以虚拟首列「唯一id」完整展示，可编辑）
 *   key k(k≥2) = 模板表头第 k-1 列（headers[k-2]）
 * （AI prompt 字段索引 1 基 [1:流水号, 2:唯一id, 3+:模板字段]，解析器统一减 1 后落盘）
 *
 * V2TableView 用 header 字符串作为列 dataIndex（row["姓名"]）。
 * 此函数把数字 key 映射为 header 名；"1" 映射为虚拟列 UNIQUE_ID_COLUMN（保存时经
 * remapRowToIndexKeys 映射回 "1"）；"0"(流水号) 不映射（UI 不展示）；
 * 已是 header 名的 key 原样保留（幂等）。
 * ⚠️ 唯一id 展示列与存储键 "1" 的双向映射必须同步（本函数 + remapRowToIndexKeys + CSV 导出），
 * 任一侧漏改都会导致保存丢 ID。
 */
const UNIQUE_ID_COLUMN = '唯一id';

function remapRowToHeaderKeys(
  row: Record<string, unknown> | null | undefined,
  headers: string[]
): Record<string, unknown> {
  if (!row) return {};
  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (/^\d+$/.test(key)) {
      const idx = parseInt(key, 10);
      if (idx >= 2) {
        mapped[headers[idx - 2] ?? key] = row[key];
      } else if (idx === 1) {
        // "1"(唯一id)：虚拟首列展示（可编辑，保存回 "1"）
        mapped[UNIQUE_ID_COLUMN] = row[key];
      }
      // "0"(流水号)：系统键，不映射（UI 不展示）
    } else {
      mapped[key] = row[key];
    }
  }
  return mapped;
}

/**
 * remapRowToHeaderKeys 的逆操作：UI 列名 key → 数据层存储 key。
 * 保存前调用，确保落盘格式与主进程数据层一致（dedup/AI prompt 依赖存储键约定）。
 * 数字 key（含系统键 "0"/"1"）原样保留；「唯一id」列名映射回存储键 "1"；
 * 其余非数字 key（表头名）按 header 索引转回存储键（第 c 列 → String(c + 2)）。
 */
function remapRowToIndexKeys(
  row: Record<string, unknown> | null | undefined,
  headers: string[]
): Record<string, unknown> {
  if (!row) return {};
  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (/^\d+$/.test(key)) {
      mapped[key] = row[key];
    } else if (key === UNIQUE_ID_COLUMN) {
      mapped['1'] = row[key];
    } else {
      const idx = headers.indexOf(key);
      mapped[idx >= 0 ? String(idx + 2) : key] = row[key];
    }
  }
  return mapped;
}

/**
 * V2 表格整理子域面板（完整版）
 *
 * 能力：
 *  - 模板：写作域模板（内置 ⭐ + 自定义 CRUD）绑定
 *  - 整理：整表 / 当前表 / 仅跳过已整理章节，进度事件驱动，章节整理状态可查
 *  - 数据：行内编辑 / 增删行 / 保存 / 清空本表 / 导出 CSV / 单行 AI 重整理
 *  - 版本：整理后产生待确认快照（变更摘要 + 确认 / 回滚）
 */
const V2TablePanel: React.FC<V2TablePanelProps> = ({ project, chapterIndex }) => {
  const { token } = theme.useToken();
  const [data, setData] = useState<WritingTableData | null>(null);
  const [config, setConfig] = useState<WritingTableConfig | null>(null);
  const [templates, setTemplates] = useState<V2TableTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [organizingSheet, setOrganizingSheet] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [skipOrganized, setSkipOrganized] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string; percent: number } | null>(null);
  // 最近一次整理的持久结果（本地模型秒回时 toast/进度区一闪而过，用常驻卡片保证可见）
  const [lastResult, setLastResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [snapshot, setSnapshot] = useState<V2VersionSnapshotResult['snapshot']>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [editRows, setEditRows] = useState<Record<string, unknown>[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [chapterStatus, setChapterStatus] = useState<V2ChapterOrganizeStatus[]>([]);
  const [reorgModal, setReorgModal] = useState<{ rowIndex: number; row: Record<string, unknown> } | null>(null);
  const [reorgRequirement, setReorgRequirement] = useState('');
  const [reorganizingRow, setReorganizingRow] = useState<number | null>(null);
  // 最近一次 ID 一致性校验报告（整理结果携带 / 按需重扫）
  const [idReport, setIdReport] = useState<V2IdConsistencyReport | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [rescanningId, setRescanningId] = useState(false);

  const api = getWritingV2API();

  const reload = useCallback(async () => {
    if (!api) return;
    const [dataRes, configRes, snapRes] = await Promise.all([
      api.table.getTableData(project.id),
      api.table.getTableConfig(project.id),
      api.table.getVersionSnapshot(project.id),
    ]);
    setData(dataRes.success ? dataRes.data : null);
    setConfig(configRes.success ? configRes.config : null);
    setSnapshot(snapRes.success ? snapRes.snapshot : null);
  }, [api, project.id]);

  // 项目切换时重置并加载
  useEffect(() => {
    setData(null);
    setConfig(null);
    setSnapshot(null);
    setProgress(null);
    setDirty(false);
    setIdReport(null);
    setReportModalOpen(false);
    reload();
  }, [project.id, reload]);

  // 加载模板列表
  const loadTemplates = useCallback(async () => {
    if (!api) return;
    const res = await api.table.getAllTemplates();
    if (res.success) {
      const list = res.templates.filter((t) => !t.isCopy);
      setTemplates(list);
      setSelectedTemplateId((prev) => {
        if (prev && list.some((t) => t.id === prev)) return prev;
        return (
          list.find((t) => t.id === (config?.associatedTemplateId || WRITING_DEFAULT_TABLE_TEMPLATE_ID))?.id ||
          list.find((t) => t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID)?.id ||
          list[0]?.id ||
          null
        );
      });
    }
  }, [api, config?.associatedTemplateId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api) return;
      const res = await api.table.getAllTemplates();
      if (cancelled) return;
      if (res.success) {
        const list = res.templates.filter((t) => !t.isCopy);
        setTemplates(list);
        // 未绑定过模板时预选写作默认模板
        if (!selectedTemplateId) {
          setSelectedTemplateId(
            list.find((t) => t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID)?.id || list[0]?.id || null
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // 订阅整理进度（按项目过滤）
  // ⚠️ 仅更新进度显示，禁止在此判定"完成"——事件 current=正在处理的章节序号（最后一章"开始"
  // 时就满足 current>=total），单章整理时首个进度事件即会误判完成、提前卸载进度区（表现为"闪一下"）。
  // organizing 状态与 reload 一律由 handleOrganize/handleOrganizeSheet 的 IPC invoke 返回收尾。
  useEffect(() => {
    if (!api) return;
    const off = api.table.onOrganizeProgress((event) => {
      if (event.projectId !== project.id) return;
      setProgress(event);
    });
    return off;
  }, [api, project.id]);

  const sheetNames = useMemo(() => data?.sheets ?? [], [data]);

  useEffect(() => {
    if (sheetNames.length > 0 && !sheetNames.includes(activeSheet)) {
      setActiveSheet(sheetNames[0]);
    }
  }, [sheetNames, activeSheet]);

  // 当前 sheet 的列头（供 key 映射使用）
  const activeHeaders = useMemo(
    () => data?.headers?.[activeSheet] ?? [],
    [data, activeSheet]
  );

  // 数据/表切换时同步工作副本（未保存编辑会被覆盖，保存前请知悉）
  // 数据层行 key 为数字索引（"1","2",...），需映射为 header 名才能被 V2TableView 的
  // dataIndex 读取，否则单元格全空。
  useEffect(() => {
    setEditRows(
      ((data?.data?.[activeSheet] ?? []) as Record<string, unknown>[]).map((r) =>
        remapRowToHeaderKeys(r, activeHeaders)
      )
    );
    setDirty(false);
  }, [data, activeSheet, activeHeaders]);

  // 列头派生：唯一id 虚拟首列（完整展示实体去重键，可编辑修正）+ 模板表头
  const sheetHeaders = useMemo(() => {
    const fromConfig = data?.headers?.[activeSheet];
    if (fromConfig && fromConfig.length > 0) return [UNIQUE_ID_COLUMN, ...fromConfig];
    const row = editRows[0];
    return row ? [UNIQUE_ID_COLUMN, ...Object.keys(row).filter((k) => k !== UNIQUE_ID_COLUMN)] : [UNIQUE_ID_COLUMN];
  }, [data, activeSheet, editRows]);

  // ---------- 模板 ----------
  const handleBindTemplate = async () => {
    if (!api || !selectedTemplateId) {
      message.warning('请选择要绑定的表格模板');
      return;
    }
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    setBinding(true);
    try {
      const res = await api.table.associateTableTemplate(
        project.id,
        tpl.id,
        tpl.name,
        tpl.sheets.map((s) => ({ name: s.name, headers: s.headers, description: s.description }))
      );
      if (res.success) {
        message.success(`已绑定模板「${tpl.name}」`);
        reload();
      } else {
        message.error(res.error || '绑定模板失败');
      }
    } finally {
      setBinding(false);
    }
  };

  // ---------- 整理 ----------
  const handleOrganize = async () => {
    if (!api) return;
    setOrganizing(true);
    setProgress(null);
    setLastResult(null);
    const startAt = Date.now();
    try {
      const res = await api.table.organizeTable(
        project.id,
        project.config.modelConfig,
        chapterIndex,
        requirements.trim() || undefined,
        skipOrganized || undefined
      );
      const secs = ((Date.now() - startAt) / 1000).toFixed(1);
      // 整理结果携带的 ID 一致性报告（含取消收尾场景）
      if (res.idReport) setIdReport(res.idReport);
      if (res.cancelled) {
        message.warning(`整理已取消：已处理 ${res.processedCount} 章，结果已保留`);
        setLastResult({ ok: false, text: `整理已取消：已处理 ${res.processedCount} 章，结果已保留（耗时 ${secs}s）` });
      } else if (res.success) {
        message.success(`整理完成：成功 ${res.processedCount} 章，异常 ${res.errorCount}`);
        setLastResult({ ok: true, text: `整理完成：成功 ${res.processedCount} 章、异常 ${res.errorCount}，耗时 ${secs}s。变更已生成待确认快照，可在下方确认或回滚` });
      } else {
        message.error(res.error || res.errors?.[0] || '表格整理失败');
        setLastResult({ ok: false, text: `整理失败：${res.error || res.errors?.[0] || '未知错误'}` });
      }
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '表格整理失败');
      setLastResult({ ok: false, text: `整理失败：${err instanceof Error ? err.message : '未知错误'}` });
    } finally {
      setOrganizing(false);
    }
  };

  const handleOrganizeSheet = async () => {
    if (!api || !activeSheet) return;
    setOrganizingSheet(true);
    setProgress(null);
    setLastResult(null);
    const startAt = Date.now();
    try {
      const res = await api.table.organizeSingleSheet(
        project.id,
        activeSheet,
        project.config.modelConfig,
        chapterIndex,
        requirements.trim() || undefined
      );
      const secs = ((Date.now() - startAt) / 1000).toFixed(1);
      // 整理结果携带的 ID 一致性报告
      if (res.idReport) setIdReport(res.idReport);
      if (res.cancelled) {
        message.warning(`「${activeSheet}」整理已取消：已处理 ${res.processedCount} 章，结果已保留`);
        setLastResult({ ok: false, text: `「${activeSheet}」整理已取消：已处理 ${res.processedCount} 章，结果已保留（耗时 ${secs}s）` });
      } else if (res.success) {
        message.success(`「${activeSheet}」整理完成：成功 ${res.processedCount} 章`);
        setLastResult({ ok: true, text: `「${activeSheet}」整理完成：成功 ${res.processedCount} 章，耗时 ${secs}s。变更已生成待确认快照，可在下方确认或回滚` });
      } else {
        message.error(res.error || res.errors?.[0] || '整理失败');
        setLastResult({ ok: false, text: `「${activeSheet}」整理失败：${res.error || res.errors?.[0] || '未知错误'}` });
      }
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '整理失败');
      setLastResult({ ok: false, text: `「${activeSheet}」整理失败：${err instanceof Error ? err.message : '未知错误'}` });
    } finally {
      setOrganizingSheet(false);
    }
  };

  const handleCancelOrganize = async () => {
    if (!api) return;
    const res = await api.table.cancelOrganize(project.id);
    if (res.success) {
      message.info('已发送取消信号，将在当前分片完成后停止');
    } else {
      message.error(res.error || '取消失败');
    }
  };

  const handleOpenChapterStatus = async () => {
    if (!api) return;
    const res = await api.table.getChapterOrganizeStatus(project.id);
    if (res.success) {
      setChapterStatus(res.status);
      setStatusModalOpen(true);
    } else {
      message.error(res.error || '获取章节整理状态失败');
    }
  };

  // ID 一致性按需重扫：只读校验，不改数据、不触发整理
  const handleIdConsistency = async () => {
    if (!api) return;
    setRescanningId(true);
    try {
      const res = await api.table.getIdConsistencyReport(project.id);
      if (res.success && res.report) {
        setIdReport(res.report);
        setReportModalOpen(true);
        if (res.report.ok) message.success('ID 校验通过：全部实体唯一 ID 完整且一致');
        else message.warning(`ID 校验发现问题：${res.report.summary}`);
      } else {
        message.error(res.error || 'ID 一致性校验失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'ID 一致性校验失败');
    } finally {
      setRescanningId(false);
    }
  };

  // ---------- 数据编辑 ----------
  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    setEditRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, [column]: value } : r)));
    setDirty(true);
  };

  const handleAddRow = () => {
    setEditRows((prev) => [...prev, {}]);
    setDirty(true);
  };

  const handleDeleteRow = (rowIndex: number) => {
    setEditRows((prev) => prev.filter((_, i) => i !== rowIndex));
    setDirty(true);
  };

  const handleClearSheet = () => {
    setEditRows([]);
    setDirty(true);
  };

  const handleSaveRows = async () => {
    if (!api || !activeSheet) return;
    setSaving(true);
    try {
      // 保存前把 UI 列名 key 映射回数据层数字索引 key，与主进程存储格式保持一致
      const rowsToSave = editRows.map((r) => remapRowToIndexKeys(r, activeHeaders));
      const res = await api.table.saveTableData(project.id, activeSheet, rowsToSave);
      if (res.success) {
        message.success(`表格「${activeSheet}」已保存`);
        reload();
      } else {
        message.error(res.error || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    // 只剔除系统键 "0"（流水号）；唯一id 列完整导出（editRows 已是列名 key，含「唯一id」）
    const exportRows = editRows.map((r) => {
      const copy = { ...r };
      delete copy['0'];
      return copy;
    });
    const csv = buildTableCsv(sheetHeaders, exportRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title || '作品'}-${activeSheet || '表格'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('CSV 已导出');
  };

  // ---------- 单行 AI 重整理 ----------
  const confirmReorganizeRow = async () => {
    if (!api || !reorgModal) return;
    if (!reorgRequirement.trim()) {
      message.warning('请输入这一行的整理要求');
      return;
    }
    setReorganizingRow(reorgModal.rowIndex);
    try {
      const res = await api.table.reorganizeRow(
        project.id,
        activeSheet,
        reorgModal.rowIndex,
        remapRowToIndexKeys(reorgModal.row, activeHeaders),
        reorgRequirement.trim(),
        project.config.modelConfig
      );
      if (res.success && res.row) {
        setEditRows((prev) =>
          prev.map((r, i) => (i === reorgModal.rowIndex ? { ...res.row } : r))
        );
        setDirty(true);
        message.success('该行已重新整理（记得保存修改）');
        setReorgModal(null);
        setReorgRequirement('');
      } else {
        message.error(res.error || '重新整理失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重新整理失败');
    } finally {
      setReorganizingRow(null);
    }
  };

  // ---------- 版本快照 ----------
  const handleConfirmVersion = async () => {
    if (!api) return;
    const res = await api.table.confirmVersion(project.id);
    if (res.success) {
      message.success('已确认当前表格版本');
      reload();
    } else {
      message.error(res.error || '确认版本失败');
    }
  };

  const handleRollbackVersion = () => {
    if (!api) return;
    Modal.confirm({
      title: '回滚到整理前版本？',
      content: '当前表格数据将被恢复为最近一次整理前的快照，整理结果将丢弃。',
      okText: '回滚',
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await api.table.rollbackVersion(project.id);
        if (res.success) {
          message.success('已回滚到整理前版本');
          reload();
        } else {
          message.error(res.error || '回滚失败');
        }
      },
    });
  };

  const handleClearAll = async () => {
    if (!api) return;
    const res = await api.table.clearTableData(project.id);
    if (res.success) {
      message.success('表格数据已清空');
      reload();
    } else {
      message.error(res.error || '清空失败');
    }
  };

  // ---------- 未绑定模板 ----------
  if (!config || !config.associatedTemplateId) {
    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', height: '100%' }}>
        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
          表格整理用于把章节内容中的设定（角色/物品/事件等）自动沉淀为结构化表格，并在后续生成与剧情检查中作为上下文注入。
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>绑定表格模板</div>
        <Select
          placeholder="选择模板"
          value={selectedTemplateId}
          onChange={setSelectedTemplateId}
          style={{ width: '100%' }}
          options={templates.map((t) => ({
            label: (
              <span>
                {t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID && '⭐ '}
                {t.name}
                <span style={{ color: token.colorTextTertiary, fontSize: 11 }}>（{t.sheets.length} 个表）</span>
                {t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID && (
                  <span style={{ color: token.colorTextTertiary, fontSize: 11 }}> 默认</span>
                )}
                {t.custom && (
                  <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>
                    自定义
                  </Tag>
                )}
              </span>
            ),
            value: t.id,
          }))}
        />
        {selectedTemplateId &&
          (() => {
            const tpl = templates.find((t) => t.id === selectedTemplateId);
            return tpl ? (
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {tpl.sheets.map((s) => s.name).join(' / ')}
              </div>
            ) : null;
          })()}
        <Space>
          <Button
            type="primary"
            icon={<LinkOutlined />}
            loading={binding}
            disabled={templates.length === 0}
            onClick={handleBindTemplate}
          >
            绑定并初始化表格
          </Button>
          <Button icon={<AppstoreOutlined />} onClick={() => setManagerOpen(true)}>
            模板管理
          </Button>
        </Space>
        <V2TemplateManager
          open={managerOpen}
          templates={templates}
          onClose={() => setManagerOpen(false)}
          onChanged={loadTemplates}
        />
      </div>
    );
  }

  // ---------- 已绑定 ----------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      {/* 模板 + 整理操作 */}
      <Space size={8} wrap>
        <Tag icon={<TableOutlined />} style={{ marginInlineEnd: 0 }}>
          {config.associatedTemplateName}
        </Tag>
        <Button
          size="small"
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={organizing}
          disabled={organizing || organizingSheet}
          onClick={handleOrganize}
        >
          AI 整理全部
        </Button>
        <Button
          size="small"
          icon={<SheetOutlined />}
          loading={organizingSheet}
          disabled={organizing || organizingSheet || !activeSheet}
          onClick={handleOrganizeSheet}
        >
          整理当前表
        </Button>
        <Button size="small" icon={<UnorderedListOutlined />} onClick={handleOpenChapterStatus}>
          章节状态
        </Button>
        <Tooltip title="立即重新扫描全部表格的唯一 ID 完整性与一致性（缺 ID / 重复 / 悬空引用），只读不改数据">
          <Button size="small" icon={<SafetyCertificateOutlined />} loading={rescanningId} onClick={handleIdConsistency}>
            ID 一致性
          </Button>
        </Tooltip>
        <Button size="small" icon={<AppstoreOutlined />} onClick={() => setManagerOpen(true)}>
          模板管理
        </Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
        <Popconfirm title="确认清空全部表格数据？" onConfirm={handleClearAll} okButtonProps={{ danger: true }}>
          <Button size="small" danger icon={<ClearOutlined />}>
            清空
          </Button>
        </Popconfirm>
      </Space>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input.TextArea
          rows={2}
          size="small"
          placeholder="整理要求（可选）：如「只整理角色与物品信息，事件表按时间排序」"
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
          style={{ flex: 1 }}
        />
        <Checkbox checked={skipOrganized} onChange={(e) => setSkipOrganized(e.target.checked)}>
          跳过已整理章节
        </Checkbox>
      </div>

      {(organizing || organizingSheet) && (
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {progress ? (
            <>
              <Progress
                percent={Math.round(progress.percent)}
                size="small"
                format={() => `${progress.current}/${progress.total}`}
              />
              <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{progress.message}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: token.colorTextTertiary }}>正在整理中，请稍候…</div>
          )}
          <div>
            <Button size="small" danger ghost onClick={handleCancelOrganize}>
              取消整理
            </Button>
          </div>
        </div>
      )}

      {/* 最近一次整理结果（常驻，直到下次整理） */}
      {lastResult && !organizing && !organizingSheet && (
        <div
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 12,
            background: lastResult.ok ? token.colorSuccessBg : token.colorErrorBg,
            border: `1px solid ${lastResult.ok ? token.colorSuccessBorder : token.colorErrorBorder}`,
          }}
        >
          {lastResult.text}
        </div>
      )}

      {/* ID 一致性校验报告（整理后生成 / 按需重扫，常驻直到下一次） */}
      {idReport && !organizing && !organizingSheet && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 12,
            flexWrap: 'wrap',
            background: idReport.ok ? token.colorSuccessBg : token.colorWarningBg,
            border: `1px solid ${idReport.ok ? token.colorSuccessBorder : token.colorWarningBorder}`,
          }}
        >
          <SafetyCertificateOutlined />
          <span style={{ fontWeight: 600 }}>{idReport.ok ? 'ID 校验通过' : 'ID 校验发现问题'}</span>
          <span>{idReport.summary}</span>
          <span style={{ flex: 1 }} />
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setReportModalOpen(true)}>
            查看报告
          </Button>
        </div>
      )}

      {/* 待确认的版本快照 */}
      {snapshot ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: token.colorInfoBg,
            border: `1px solid ${token.colorInfoBorder}`,
            borderRadius: 8,
            fontSize: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600 }}>待确认的整理快照：</span>
          <Tag color="green">新增 {snapshot.changeRecord.addedRows.length} 行</Tag>
          <Tag color="blue">修改 {snapshot.changeRecord.modifiedCells.length} 格</Tag>
          <Tag color="red">删除 {snapshot.changeRecord.deletedRows.length} 行</Tag>
          <span style={{ flex: 1 }} />
          <Tooltip title="确认：保留整理结果并归档快照">
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleConfirmVersion}>
              确认
            </Button>
          </Tooltip>
          <Tooltip title="回滚：丢弃整理结果，恢复快照前数据">
            <Button size="small" danger icon={<RollbackOutlined />} onClick={handleRollbackVersion}>
              回滚
            </Button>
          </Tooltip>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginInlineStart: 4 }}>
          无待确认的整理变更
        </div>
      )}

      {/* 表格编辑 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {sheetNames.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: token.colorTextTertiary, fontSize: 12 }}>
            暂无表格数据，点击「AI 整理全部」基于章节内容生成
          </div>
        ) : (
          <Tabs
            size="small"
            activeKey={activeSheet}
            onChange={setActiveSheet}
            items={sheetNames.map((name) => ({
              key: name,
              label: name,
              forceRender: true,
              children:
                name === activeSheet ? (
                  <V2TableView
                    sheetName={name}
                    headers={sheetHeaders}
                    rows={editRows}
                    dirty={dirty}
                    saving={saving}
                    reorganizingRow={reorganizingRow}
                    onCellChange={handleCellChange}
                    onAddRow={handleAddRow}
                    onDeleteRow={handleDeleteRow}
                    onReorganizeRow={(rowIndex, row) => {
                      setReorgRequirement(requirements.trim() || '');
                      setReorgModal({ rowIndex, row });
                    }}
                    onSave={handleSaveRows}
                    onExportCsv={handleExportCsv}
                    onClearSheet={handleClearSheet}
                  />
                ) : null,
            }))}
          />
        )}
      </div>

      {/* 章节整理状态 */}
      <Modal
        title="章节整理状态"
        open={statusModalOpen}
        onCancel={() => setStatusModalOpen(false)}
        footer={null}
        width={480}
      >
        {chapterStatus.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: token.colorTextTertiary, fontSize: 12 }}>
            暂无整理记录
          </div>
        ) : (
          chapterStatus.map((s) => (
            <div
              key={s.chapterIndex}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: `1px solid ${token.colorFillQuaternary}`,
                fontSize: 12,
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                第 {s.chapterIndex + 1} 章 {s.title}
              </span>
              <Tag color={CHAPTER_STATUS_COLORS[s.status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                {s.status}
              </Tag>
            </div>
          ))
        )}
      </Modal>

      {/* ID 一致性校验报告（完整明细） */}
      <Modal
        title="ID 一致性校验报告"
        open={reportModalOpen}
        onCancel={() => setReportModalOpen(false)}
        footer={null}
        width={720}
      >
        {idReport && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Tag color={idReport.ok ? 'green' : 'orange'} style={{ marginInlineEnd: 0 }}>
                {idReport.ok ? '校验通过' : '发现问题'}
              </Tag>
              <span style={{ fontSize: 12 }}>{idReport.summary}</span>
              {idReport.dedupRemoved > 0 && (
                <Tag color="red">全局去重移除 {idReport.dedupRemoved} 行</Tag>
              )}
            </div>

            {/* 逐表统计 */}
            <Table
              size="small"
              rowKey="sheetName"
              pagination={false}
              dataSource={idReport.sheets}
              columns={[
                { title: '表名', dataIndex: 'sheetName', width: 90 },
                { title: '行数', dataIndex: 'totalRows', width: 56 },
                {
                  title: '缺 ID 行',
                  dataIndex: 'missingIdRows',
                  render: (rows: number[], r: V2IdSheetStats) =>
                    rows.length === 0 ? (
                      '—'
                    ) : (
                      <span>
                        {rows.length} 行（行 {rows.join(',')}）
                        {r.missingPreExisting > 0 && (
                          <Tag color="default" style={{ marginLeft: 4 }}>
                            存量 {r.missingPreExisting}
                          </Tag>
                        )}
                      </span>
                    ),
                },
                {
                  title: '重复 ID',
                  dataIndex: 'duplicateIds',
                  render: (groups: V2IdDuplicateGroup[]) =>
                    groups.length === 0 ? (
                      '—'
                    ) : (
                      groups.map((g) => (
                        <div key={g.id}>
                          {g.id}（行 {g.rows.join(',')}）
                          {g.preExisting && (
                            <Tag color="default" style={{ marginLeft: 4 }}>
                              存量
                            </Tag>
                          )}
                        </div>
                      ))
                    ),
                },
              ]}
            />

            {/* 悬空引用 */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
                悬空引用（{idReport.danglingRefs.length}）
              </div>
              {idReport.danglingRefs.length === 0 ? (
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                  无——所有引用型字段均指向真实存在的唯一 ID
                </div>
              ) : (
                idReport.danglingRefs.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '2px 0' }}>
                    {d.sheetName} 行{d.row}：{d.column}={d.value} 悬空
                    {d.preExisting && (
                      <Tag color="default" style={{ marginLeft: 4 }}>
                        存量
                      </Tag>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* 自动修正 */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
                自动修正（{idReport.fixes.length}）
              </div>
              {idReport.fixes.length === 0 ? (
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>无</div>
              ) : (
                idReport.fixes.map((f, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '2px 0' }}>
                    [{f.action}] {f.original} → {f.detail}
                  </div>
                ))
              )}
            </div>

            {/* 需人工核查 */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
                需人工核查（{idReport.manualReview.length}）
              </div>
              {idReport.manualReview.length === 0 ? (
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>无</div>
              ) : (
                idReport.manualReview.map((m, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '2px 0', color: token.colorWarning }}>
                    {m}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 单行 AI 重整理 */}
      <Modal
        title={
          <Space>
            <ThunderboltOutlined />
            重新整理该行（{activeSheet} 第 {(reorgModal?.rowIndex ?? 0) + 1} 行）
          </Space>
        }
        open={!!reorgModal}
        onCancel={() => setReorgModal(null)}
        onOk={confirmReorganizeRow}
        okText="开始整理"
        okButtonProps={{ loading: reorganizingRow !== null }}
        width={520}
      >
        <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
          AI 将按以下要求重新提取/改写这一行的各列内容：
        </div>
        <Input.TextArea
          rows={3}
          value={reorgRequirement}
          onChange={(e) => setReorgRequirement(e.target.value)}
          placeholder="如：这一行的关系描述不准确，请根据第 3 章内容修正"
        />
      </Modal>

      {/* 模板管理 */}
      <V2TemplateManager
        open={managerOpen}
        templates={templates}
        onClose={() => setManagerOpen(false)}
        onChanged={loadTemplates}
      />
    </div>
  );
};

export default V2TablePanel;
