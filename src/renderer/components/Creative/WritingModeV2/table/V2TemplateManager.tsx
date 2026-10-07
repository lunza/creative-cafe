import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  theme,
  message,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  MinusCircleOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type {
  V2TableTemplate,
  V2TableTemplateInput,
} from '../../../../../shared/types/writing-v2.types';
import type { WritingTableTemplateSheet } from '../../../../../shared/constants/writingTableTemplates';
import { WRITING_DEFAULT_TABLE_TEMPLATE_ID } from '../../../../../shared/constants/writingTableTemplates';
import { getWritingV2API } from '../../../../services/writingV2Service';

interface V2TemplateManagerProps {
  open: boolean;
  templates: V2TableTemplate[];
  onClose: () => void;
  /** 保存/删除成功后刷新列表 */
  onChanged: () => void;
}

interface DraftSheet {
  name: string;
  description: string;
  headers: string[];
}

/**
 * V2 写作表格模板管理
 *
 * 内置模板只读（⭐默认 + 其余内置）；自定义模板可新建/编辑/删除。
 * 模板 sheet 结构（name/description/headers/order）与主进程 TableSheet 对齐。
 */
const V2TemplateManager: React.FC<V2TemplateManagerProps> = ({
  open,
  templates,
  onClose,
  onChanged,
}) => {
  const { token } = theme.useToken();
  const [editingId, setEditingId] = useState<string>('new');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sheets, setSheets] = useState<DraftSheet[]>([]);
  const [saving, setSaving] = useState(false);

  const isBuiltin = useMemo(() => {
    const t = templates.find((x) => x.id === editingId);
    return !!t && !t.custom;
  }, [templates, editingId]);

  // 选择编辑目标时载入草稿
  useEffect(() => {
    if (!open) return;
    if (editingId === 'new') {
      setName('');
      setDescription('');
      setSheets([
        {
          name: '角色表',
          description: '核心角色的身份、性格、特征与关系',
          headers: ['姓名', '身份', '性格', '特征'],
        },
      ]);
      return;
    }
    const t = templates.find((x) => x.id === editingId);
    if (!t) return;
    setName(t.name);
    setDescription(t.description);
    setSheets(
      t.sheets.map((s) => ({
        name: s.name,
        description: s.description ?? '',
        headers: [...s.headers],
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, open]);

  const patchSheet = (idx: number, patch: Partial<DraftSheet>) => {
    setSheets((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const handleSave = async () => {
    const api = getWritingV2API();
    if (!api) return;
    const input: V2TableTemplateInput = {
      id: editingId === 'new' ? '' : editingId,
      name: name.trim(),
      description: description.trim(),
      sheets: sheets.map((s, i) => ({
        name: s.name.trim(),
        headers: s.headers.map((h) => h.trim()).filter(Boolean),
        description: s.description.trim(),
        order: i,
      })) as WritingTableTemplateSheet[],
    };
    if (!input.name) {
      message.warning('请输入模板名称');
      return;
    }
    setSaving(true);
    try {
      const res = await api.table.saveTableTemplate(input);
      if (res.success) {
        message.success(editingId === 'new' ? '模板已创建' : '模板已更新');
        setEditingId('new');
        onChanged();
      } else {
        message.error(res.error || '保存模板失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const api = getWritingV2API();
    if (!api) return;
    const res = await api.table.deleteTableTemplate(editingId);
    if (res.success) {
      message.success('模板已删除');
      setEditingId('new');
      onChanged();
    } else {
      message.error(res.error || '删除模板失败');
    }
  };

  return (
    <Modal
      title={
        <Space>
          <AppstoreOutlined />
          表格模板管理
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      footer={
        <Space>
          {!isBuiltin && editingId !== 'new' && (
            <Popconfirm title="删除这个自定义模板？" onConfirm={handleDelete} okText="删除" okButtonProps={{ danger: true }}>
              <Button danger icon={<DeleteOutlined />}>
                删除模板
              </Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>关闭</Button>
          {!isBuiltin && (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              {editingId === 'new' ? '创建模板' : '保存修改'}
            </Button>
          )}
        </Space>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select
          value={editingId}
          onChange={setEditingId}
          style={{ flex: 1 }}
          options={[
            { label: '＋ 新建自定义模板', value: 'new' },
            ...templates.map((t) => ({
              label: (
                <span>
                  {t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID && '⭐ '}
                  {t.name}
                  {t.custom ? (
                    <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>
                      自定义
                    </Tag>
                  ) : (
                    <Tag style={{ marginLeft: 6, fontSize: 10 }}>内置·只读</Tag>
                  )}
                </span>
              ),
              value: t.id,
            })),
          ]}
        />
      </div>

      {isBuiltin && (
        <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 8 }}>
          内置模板不可修改。如需调整，请「新建自定义模板」后参考其结构编辑。
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>模板名称</div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBuiltin}
            placeholder="如：我的悬疑小说设定表"
            maxLength={30}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>模板描述</div>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isBuiltin}
            rows={2}
            placeholder="说明该模板适用的作品类型与沉淀内容"
            maxLength={100}
          />
        </div>

        {sheets.map((s, si) => (
          <div
            key={si}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: token.colorTextTertiary, width: 32 }}>
                表 {si + 1}
              </span>
              <Input
                size="small"
                value={s.name}
                disabled={isBuiltin}
                onChange={(e) => patchSheet(si, { name: e.target.value })}
                placeholder="表名（如：角色表）"
                style={{ width: 140 }}
              />
              <Input
                size="small"
                value={s.description}
                disabled={isBuiltin}
                onChange={(e) => patchSheet(si, { description: e.target.value })}
                placeholder="表描述（AI 整理时按此提取信息）"
                style={{ flex: 1 }}
              />
              {!isBuiltin && (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<MinusCircleOutlined />}
                  disabled={sheets.length <= 1}
                  onClick={() => setSheets((prev) => prev.filter((_, i) => i !== si))}
                >
                  删除表
                </Button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {s.headers.map((h, hi) => (
                <div key={hi} style={{ display: 'flex', gap: 8 }}>
                  <Input
                    size="small"
                    value={h}
                    disabled={isBuiltin}
                    onChange={(e) =>
                      patchSheet(si, {
                        headers: s.headers.map((x, i) => (i === hi ? e.target.value : x)),
                      })
                    }
                    placeholder={`列 ${hi + 1}（如：姓名）`}
                  />
                  {!isBuiltin && (
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      disabled={s.headers.length <= 1}
                      onClick={() =>
                        patchSheet(si, { headers: s.headers.filter((_, i) => i !== hi) })
                      }
                    />
                  )}
                </div>
              ))}
              {!isBuiltin && (
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => patchSheet(si, { headers: [...s.headers, ''] })}
                >
                  添加列
                </Button>
              )}
            </div>
          </div>
        ))}

        {!isBuiltin && (
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setSheets((prev) => [
                ...prev,
                { name: '', description: '', headers: [''] },
              ])
            }
          >
            添加表
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default V2TemplateManager;
