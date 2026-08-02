/**
 * SkillMarketplace —— 技能广场
 *
 * 来源：spec §fix-skill-system-and-add-marketplace Task 4
 *
 * 职责：
 *  1. 通过 skill:list IPC 加载已安装技能列表
 *  2. 以 antd Table 渲染技能列表（名称/描述/来源/操作）
 *  3. 支持来源筛选（全部/内置/工作区/导入）
 *  4. 从本地目录导入技能（file.selectDirectory + skill.importFromDir）
 *  5. 从 URL 导入技能（Modal 输入 + skill.importFromUrl）
 *  6. 创建/编辑技能（SkillFormModal + skill:create/skill:edit）
 *  7. 删除非内置技能（Modal.confirm 确认 + skill.uninstall）
 *  8. 查看技能详情（Drawer 展示 SKILL.md body 内容）
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Table,
  Tag,
  Button,
  Space,
  Segmented,
  Modal,
  Input,
  Drawer,
  Empty,
  Spin,
  Typography,
  message,
} from 'antd';
import { FolderOpenOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import SkillFormModal from './SkillFormModal';

/** 已安装技能（来自 skill:list IPC 返回） */
interface AvailableSkill {
  name: string;
  title?: string;
  description?: string;
  emoji?: string;
  source?: string;
}

/** 技能详情（来自 skill:getDetail IPC 返回） */
interface SkillDetail {
  name: string;
  description: string;
  body: string;
  source: string;
  filePath: string;
}

/** 来源 → 标签 + 颜色映射 */
const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  builtin: { label: '内置', color: 'blue' },
  workspace: { label: '工作区', color: 'green' },
  imported: { label: '导入', color: 'orange' },
  unknown: { label: '未知', color: 'default' },
};

const SkillMarketplace: React.FC = () => {
  const [skills, setSkills] = useState<AvailableSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // 从 URL 导入弹窗
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [importing, setImporting] = useState(false);

  // 技能详情抽屉
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);

  // 技能表单弹窗
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingSkill, setEditingSkill] = useState<{ name: string; description: string; emoji?: string; body: string } | null>(null);

  /** 加载已安装技能列表 */
  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.skill.list();
      if (result.success && result.skills) {
        setSkills(result.skills);
      } else {
        setSkills([]);
      }
    } catch {
      // 降级：加载失败时保持空数组
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  /** 按来源筛选 */
  const filteredSkills = useMemo(() => {
    if (sourceFilter === 'all') return skills;
    return skills.filter(s => (s.source || 'unknown') === sourceFilter);
  }, [skills, sourceFilter]);

  /** 从本地目录导入：调用 file.selectDirectory 选择目录后导入 */
  const handleImportFromDir = async () => {
    // 项目无 dialog 命名空间，使用 file.selectDirectory() 选择目录
    const selectedPath = await window.electronAPI.file.selectDirectory();
    if (!selectedPath) return; // 用户取消选择

    setImporting(true);
    try {
      const result = await window.electronAPI.skill.importFromDir(selectedPath);
      if (result.success) {
        message.success(`技能导入成功${result.skillName ? `：${result.skillName}` : ''}`);
        await loadSkills();
      } else {
        message.error(result.error || '从目录导入失败');
      }
    } catch {
      message.error('从目录导入异常');
    } finally {
      setImporting(false);
    }
  };

  /** 从 URL 导入：提交弹窗输入的 URL */
  const handleImportFromUrl = async () => {
    const url = urlInput.trim();
    if (!url) {
      message.warning('请输入技能归档 URL');
      return;
    }

    setImporting(true);
    try {
      const result = await window.electronAPI.skill.importFromUrl(url);
      if (result.success) {
        message.success(`技能导入成功${result.skillName ? `：${result.skillName}` : ''}`);
        setUrlInput('');
        setUrlModalOpen(false);
        await loadSkills();
      } else {
        message.error(result.error || '从 URL 导入失败');
      }
    } catch {
      message.error('从 URL 导入异常');
    } finally {
      setImporting(false);
    }
  };

  /** 卸载技能：弹出确认弹窗 */
  const handleUninstall = (skill: AvailableSkill) => {
    Modal.confirm({
      title: '确认删除技能',
      content: `确定要删除技能「${skill.title || skill.name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await window.electronAPI.skill.uninstall(skill.name);
          if (result.success) {
            message.success('技能已删除');
            await loadSkills();
          } else {
            message.error(result.error || '删除失败');
          }
        } catch {
          message.error('删除异常');
        }
      },
    });
  };

  /** 查看技能详情：加载 SKILL.md 内容并弹出抽屉 */
  const handleViewDetail = async (skill: AvailableSkill) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await window.electronAPI.skill.getDetail(skill.name);
      if (result.success && result.detail) {
        setDetail(result.detail);
      } else {
        message.error(result.error || '获取技能详情失败');
        setDetailOpen(false);
      }
    } catch {
      message.error('获取技能详情异常');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  /** 打开创建技能弹窗 */
  const handleCreateSkill = () => {
    setFormMode('create');
    setEditingSkill(null);
    setFormModalOpen(true);
  };

  /** 打开编辑技能弹窗 — 先获取完整 SKILL.md 内容 */
  const handleEditSkill = async (skill: AvailableSkill) => {
    try {
      const result = await window.electronAPI.skill.getDetail(skill.name);
      if (result.success && result.detail) {
        setFormMode('edit');
        setEditingSkill({
          name: result.detail.name,
          description: result.detail.description,
          emoji: skill.emoji,
          body: result.detail.body,
        });
        setFormModalOpen(true);
      } else {
        message.error(result.error || '获取技能详情失败');
      }
    } catch {
      message.error('获取技能详情异常');
    }
  };

  /** 提交创建技能 */
  const handleSkillCreate = async (params: { name: string; description: string; emoji?: string; body: string }) => {
    try {
      const result = await window.electronAPI.skill.create(params);
      if (result.success) {
        message.success('技能创建成功');
        setFormModalOpen(false);
        await loadSkills();
      } else {
        message.error(result.error || '创建技能失败');
      }
    } catch {
      message.error('创建技能异常');
    }
  };

  /** 提交编辑技能 */
  const handleSkillEdit = async (params: { name: string; description: string; emoji?: string; body: string }) => {
    try {
      const result = await window.electronAPI.skill.edit(params);
      if (result.success) {
        message.success('技能更新成功');
        setFormModalOpen(false);
        await loadSkills();
      } else {
        message.error(result.error || '更新技能失败');
      }
    } catch {
      message.error('更新技能异常');
    }
  };

  /** 表格列定义 */
  const columns: ColumnsType<AvailableSkill> = useMemo(() => [
    {
      title: '技能名',
      dataIndex: 'name',
      key: 'name',
      render: (_text, record) => (
        <span>
          {record.emoji && <span style={{ marginRight: 4 }}>{record.emoji}</span>}
          {record.title || record.name}
        </span>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (text: string) =>
        text || <Typography.Text type="secondary">暂无描述</Typography.Text>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      render: (source: string) => {
        const cfg = SOURCE_CONFIG[source || 'unknown'] || SOURCE_CONFIG.unknown;
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_text, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          {record.source !== 'builtin' && (
            <>
              <Button type="link" size="small" onClick={() => handleEditSkill(record)}>
                编辑
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() => handleUninstall(record)}
              >
                删除
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ], []);

  return (
    <div className="skill-marketplace">
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Segmented
          value={sourceFilter}
          onChange={(val) => setSourceFilter(val as string)}
          options={[
            { label: '全部', value: 'all' },
            { label: '内置', value: 'builtin' },
            { label: '工作区', value: 'workspace' },
            { label: '导入', value: 'imported' },
          ]}
        />
        <Space>
          <Button
            icon={<FolderOpenOutlined />}
            loading={importing}
            onClick={handleImportFromDir}
          >
            从目录导入
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreateSkill}
          >
            创建技能
          </Button>
          <Button
            icon={<LinkOutlined />}
            onClick={() => setUrlModalOpen(true)}
          >
            从 URL 导入
          </Button>
        </Space>
      </div>

      {/* 技能列表 */}
      <Table<AvailableSkill>
        columns={columns}
        dataSource={filteredSkills}
        rowKey="name"
        loading={loading}
        pagination={false}
        locale={{ emptyText: <Empty description="暂无已安装技能" /> }}
        scroll={{ x: 'max-content' }}
      />

      {/* 从 URL 导入弹窗 */}
      <Modal
        title="从 URL 导入技能"
        open={urlModalOpen}
        onCancel={() => {
          setUrlModalOpen(false);
          setUrlInput('');
        }}
        onOk={handleImportFromUrl}
        confirmLoading={importing}
        okText="导入"
        cancelText="取消"
      >
        <Input
          placeholder="请输入技能归档 URL（支持 zip）"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onPressEnter={handleImportFromUrl}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          系统将下载归档并解压到工作区技能目录，导入后可在技能配置面板中使用。
        </Typography.Paragraph>
      </Modal>

      {/* 技能详情抽屉 */}
      <Drawer
        title="技能详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={560}
      >
        {detailLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : detail ? (
          <div>
            <Typography.Paragraph>
              <Typography.Text type="secondary">名称：</Typography.Text>
              {detail.name}
            </Typography.Paragraph>
            <Typography.Paragraph>
              <Typography.Text type="secondary">描述：</Typography.Text>
              {detail.description}
            </Typography.Paragraph>
            <Typography.Paragraph>
              <Typography.Text type="secondary">来源：</Typography.Text>
              {(SOURCE_CONFIG[detail.source] || SOURCE_CONFIG.unknown).label}
            </Typography.Paragraph>
            <Typography.Title level={5}>SKILL.md 内容</Typography.Title>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'rgba(0, 0, 0, 0.02)',
                padding: 12,
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {detail.body}
            </div>
          </div>
        ) : (
          <Empty description="无详情数据" />
        )}
      </Drawer>

      {/* 技能创建/编辑弹窗 */}
      <SkillFormModal
        open={formModalOpen}
        mode={formMode}
        skill={editingSkill}
        existingNames={skills.map(s => s.name)}
        onCreate={handleSkillCreate}
        onEdit={handleSkillEdit}
        onClose={() => setFormModalOpen(false)}
      />
    </div>
  );
};

export default SkillMarketplace;
