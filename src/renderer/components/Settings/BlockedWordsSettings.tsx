/**
 * ForbiddenWordsSettings — 禁词提示词注入设置面板
 *
 * Spec: add-forbidden-words-prompt / Task 4
 * Spec: enforce-forbidden-words-and-dialogue-naturalness / Task 2（执行模式 + 对话自然度分组）
 *
 * 职责：
 *  1. 全局开关（启用禁词提示词注入）→ forbiddenWords.enabled
 *  2. 禁词类别管理（添加/编辑/删除/导入/导出）→ forbiddenWords.categories
 *  3. 输出合规执行模式（prompt-only / retry / retry-and-replace）→ forbiddenWords.enforcement 等
 *  4. 对话自然度分组（去AI味开关 + 采样预设开关）→ dialogueNaturalness
 *
 * 配置读写方式（与 TagAutocompleteSettings / WebSearchSettings 一致）：
 *  - 读取：useSettingStore 的 setting.forbiddenWords（Zustand store）
 *  - 保存：通过 forwardRef + useImperativeHandle 暴露 getFormValues() / getDialogueNaturalnessValues()，
 *          由 Settings.tsx 的 handleSave 合并到 updatedSetting 中保存
 */
import { forwardRef, useImperativeHandle, useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Button,
  Switch,
  Space,
  Typography,
  Tooltip,
  message,
  Popconfirm,
  Modal,
  Collapse,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  ExportOutlined,
  QuestionCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import type { ForbiddenWordsConfig, ForbiddenWordCategory, ForbiddenWordsEnforcement } from '@shared/types/forbiddenWords';
import { DEFAULT_FORBIDDEN_WORDS_CONFIG, DEFAULT_ENFORCEMENT, DEFAULT_REPLACEMENT_TEXT, DEFAULT_MAX_RETRIES } from '@shared/types/forbiddenWords';
import type { DialogueNaturalnessConfig } from '../../types/setting';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

/**
 * BlockedWordsSettings 暴露给父组件的 ref 接口。
 * 保留旧文件名以兼容 Settings.tsx 导入。
 */
export interface BlockedWordsSettingsRef {
  getFormValues: () => ForbiddenWordsConfig | undefined;
  /** 对话自然度配置（Spec: enforce-forbidden-words-and-dialogue-naturalness / Task 2） */
  getDialogueNaturalnessValues: () => DialogueNaturalnessConfig | undefined;
}

/** JSON 文件选择对话框过滤器 */
const JSON_FILE_FILTERS = [
  { name: 'JSON 文件', extensions: ['json'] },
  { name: '所有文件', extensions: ['*'] },
];

/** 空类别模板 */
const EMPTY_CATEGORY: ForbiddenWordCategory = {
  name: '',
  description: '',
  words: [],
  note: '',
};

/**
 * 禁词提示词注入设置面板。
 * 保留旧文件名 BlockedWordsSettings 以兼容 Settings.tsx 的导入引用。
 */
const BlockedWordsSettings = forwardRef<BlockedWordsSettingsRef>((_props, ref) => {
  const [form] = Form.useForm<ForbiddenWordsConfig>();
  const setting = useSettingStore(s => s.setting);

  // 本地类别列表状态
  const [categories, setCategories] = useState<ForbiddenWordCategory[]>([]);
  // 类别编辑 Modal 可见性
  const [modalVisible, setModalVisible] = useState(false);
  // 当前编辑的类别索引（-1 表示添加新模式）
  const [editingIndex, setEditingIndex] = useState(-1);
  // 编辑表单数据
  const [editForm, setEditForm] = useState<ForbiddenWordCategory>({ ...EMPTY_CATEGORY });
  // 对话自然度配置（Spec: enforce-forbidden-words-and-dialogue-naturalness / Task 2）
  const [dialogueNaturalness, setDialogueNaturalness] = useState<DialogueNaturalnessConfig>({});

  // 暴露 getFormValues 给父组件
  useImperativeHandle(ref, () => ({
    getFormValues: () => {
      const values = form.getFieldsValue(true) as Partial<ForbiddenWordsConfig>;
      return {
        ...DEFAULT_FORBIDDEN_WORDS_CONFIG,
        ...values,
        categories, // 使用本地列表状态
      } as ForbiddenWordsConfig;
    },
    getDialogueNaturalnessValues: () => ({ ...dialogueNaturalness }),
  }));

  // 当 setting 加载/变化时，初始化表单和列表
  useEffect(() => {
    const saved = setting?.forbiddenWords;
    const initialValues: ForbiddenWordsConfig = {
      ...DEFAULT_FORBIDDEN_WORDS_CONFIG,
      ...(saved || {}),
      // 兼容旧配置：已保存的配置中 categories 为空时，从默认配置继承
      // 这解决已持久化的 categories:[] 覆盖代码默认值的问题
      categories: (saved?.categories && saved.categories.length > 0)
        ? saved.categories
        : DEFAULT_FORBIDDEN_WORDS_CONFIG.categories,
    };
    form.setFieldsValue(initialValues);
    setCategories(initialValues.categories || []);
    // 对话自然度：存量配置缺字段取默认语义（deAiEnabled 默认开 / samplingPresetEnabled 默认关），
    // 此处落显式值，保存后写入 settings.json
    const savedDn = setting?.dialogueNaturalness;
    setDialogueNaturalness({
      deAiEnabled: savedDn?.deAiEnabled !== false,
      samplingPresetEnabled: savedDn?.samplingPresetEnabled === true,
    });
  }, [setting, form]);

  // ===== 类别编辑 Modal 操作 =====

  /** 打开添加类别 Modal */
  const handleOpenAdd = useCallback(() => {
    setEditForm({ ...EMPTY_CATEGORY });
    setEditingIndex(-1);
    setModalVisible(true);
  }, []);

  /** 打开编辑类别 Modal */
  const handleOpenEdit = useCallback((index: number) => {
    setEditForm({ ...categories[index] });
    setEditingIndex(index);
    setModalVisible(true);
  }, [categories]);

  /** 保存类别（添加或编辑） */
  const handleSaveCategory = useCallback(() => {
    const { name, description, words } = editForm;
    if (!name.trim()) {
      message.warning('请输入类别名称');
      return;
    }
    if (!description.trim()) {
      message.warning('请输入类别描述');
      return;
    }

    const cleanedWords = (words || [])
      .map(w => w.trim())
      .filter(w => w.length > 0);

    if (cleanedWords.length === 0) {
      message.warning('请输入至少一个禁词');
      return;
    }

    const category: ForbiddenWordCategory = {
      name: name.trim(),
      description: description.trim(),
      words: cleanedWords,
      note: editForm.note?.trim() || undefined,
    };

    setCategories(prev => {
      const next = [...prev];
      if (editingIndex >= 0) {
        next[editingIndex] = category;
      } else {
        next.push(category);
      }
      return next;
    });

    setModalVisible(false);
    message.success(editingIndex >= 0 ? '类别已更新' : '类别已添加');
  }, [editForm, editingIndex]);

  /** 删除类别 */
  const handleDeleteCategory = useCallback((index: number) => {
    setCategories(prev => prev.filter((_, i) => i !== index));
    message.success('类别已删除');
  }, []);

  /** 清空所有类别 */
  const handleClearAll = useCallback(() => {
    setCategories([]);
    message.success('已清空所有类别');
  }, []);

  // ===== 导入导出 =====

  /** 导入类别列表（JSON 文件，合并模式） */
  const handleImport = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.file.selectFile(JSON_FILE_FILTERS);
      if (!filePath) return;

      const content = await window.electronAPI.file.read(filePath);
      let imported: ForbiddenWordCategory[];
      try {
        const parsed = JSON.parse(content);
        if (parsed.categories && Array.isArray(parsed.categories)) {
          imported = parsed.categories;
        } else if (Array.isArray(parsed)) {
          imported = parsed;
        } else {
          message.error('无效的导入格式：需要 { categories: [...] } 或 [...]');
          return;
        }
      } catch {
        message.error('JSON 解析失败，请检查文件格式');
        return;
      }

      // 验证每个类别基本结构
      const valid = imported.filter(
        (c: any) => c.name && c.description && Array.isArray(c.words) && c.words.length > 0,
      );
      if (valid.length === 0) {
        message.error('导入文件中没有有效的类别数据');
        return;
      }

      // 合并（去重：同名类别不重复添加）
      const existingNames = new Set(categories.map(c => c.name));
      const newCategories = valid.filter((c: ForbiddenWordCategory) => !existingNames.has(c.name));

      if (newCategories.length === 0) {
        message.info('所有类别已存在，无需重复导入');
        return;
      }

      setCategories(prev => [...prev, ...newCategories]);
      message.success(`成功导入 ${newCategories.length} 个类别${valid.length !== newCategories.length ? `（${valid.length - newCategories.length} 个重复已跳过）` : ''}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      message.error(`导入失败：${errorMsg}`);
    }
  }, [categories]);

  /** 导出类别列表（JSON 文件） */
  const handleExport = useCallback(async () => {
    if (categories.length === 0) {
      message.warning('没有可导出的类别');
      return;
    }

    try {
      const exportData = JSON.stringify({ categories }, null, 2);
      const filePath = await window.electronAPI.file.selectFile(JSON_FILE_FILTERS);
      if (!filePath) return;

      const finalPath = filePath.endsWith('.json') ? filePath : `${filePath}.json`;
      const result = await window.electronAPI.file.write(finalPath, exportData);
      if (result.success) {
        message.success(`已导出 ${categories.length} 个类别到 ${finalPath}`);
      } else {
        message.error(`导出失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      message.error(`导出失败：${errorMsg}`);
    }
  }, [categories]);

  return (
    <Card
      title={
        <Space>
          <WarningOutlined />
          <span>内容约束（禁词提示词注入）</span>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      {/* 顶部说明 */}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.08)',
          borderRadius: '8px',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }}
      >
        <Paragraph style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          启用后，系统会在 AI 提示词末尾追加「Forbidden Word List」指令块，
          引导 AI 在生成回复时主动避开指定词汇，而非事后替换。
          建议按类别（如宗教术语、极端情绪标签等）组织禁词，并为每个类别提供
          清晰的行为描述和替代表达建议（Show, Don't Tell）。
          默认关闭，开启后请测试对话确认效果符合预期。
        </Paragraph>
      </div>

      <Form form={form} layout="vertical">
        {/* ==================== 全局开关 ==================== */}
        <Form.Item
          name="enabled"
          label="启用内容约束"
          valuePropName="checked"
          tooltip="开启后，系统 prompt 末尾会追加 Forbidden Word List 指令块"
        >
          <Switch />
        </Form.Item>

        {/* ==================== 输出合规执行模式 ==================== */}
        <Form.Item
          name="enforcement"
          label={
            <Space>
              <span>输出合规执行模式</span>
              <Tooltip title="提示词注入是软约束，模型仍可能输出禁词。执行模式决定命中后的处理策略；仅 retry-and-replace 能保证 100% 合规">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
          initialValue={DEFAULT_ENFORCEMENT}
        >
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="prompt-only">
                仅提示词约束（软约束） — 命中后仅记录日志，不处理
              </Radio>
              <Radio value="retry">
                命中后自动重试 — 带违规反馈重新生成，超限后保留原文
              </Radio>
              <Radio value="retry-and-replace">
                重试 + 硬替换（默认，100% 合规） — 重试超限后替换命中词入库
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>

        {/* 替换文本 / 重试次数：按执行模式条件显示 */}
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.enforcement !== cur.enforcement}>
          {({ getFieldValue }) => {
            const enforcement: ForbiddenWordsEnforcement =
              getFieldValue('enforcement') || DEFAULT_ENFORCEMENT;
            return (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {enforcement === 'retry-and-replace' && (
                  <Form.Item
                    name="replacementText"
                    label={
                      <Space>
                        <span>替换文本</span>
                        <Tooltip title="重试超限后，命中词将替换为此文本（默认 ***）">
                          <QuestionCircleOutlined />
                        </Tooltip>
                      </Space>
                    }
                    initialValue={DEFAULT_REPLACEMENT_TEXT}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="***" style={{ maxWidth: 240 }} />
                  </Form.Item>
                )}
                {enforcement !== 'prompt-only' && (
                  <Form.Item
                    name="maxRetries"
                    label={
                      <Space>
                        <span>合规重试上限</span>
                        <Tooltip title="命中禁词后最多重新生成的次数（1-5，默认 2）">
                          <QuestionCircleOutlined />
                        </Tooltip>
                      </Space>
                    }
                    initialValue={DEFAULT_MAX_RETRIES}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={1} max={5} precision={0} style={{ width: 120 }} />
                  </Form.Item>
                )}
              </Space>
            );
          }}
        </Form.Item>
      </Form>

      {/* ==================== 对话自然度分组 ==================== */}
      {/* 注：antd v7 Divider orientation 类型损坏（TagRagSettings 同款存量错误），改用样式标题 */}
      <div
        style={{
          margin: '20px 0 12px',
          paddingBottom: 8,
          fontWeight: 600,
          fontSize: 14,
          borderBottom: '1px solid rgba(128, 128, 128, 0.2)',
        }}
      >
        对话自然度
      </div>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Text strong>对话去AI味</Text>
            <Paragraph style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>
              注入真人化说话方式约束（RP 词表 + 27 种 AI 写作模式修正），降低对话的机器感
            </Paragraph>
          </div>
          <Switch
            checked={dialogueNaturalness.deAiEnabled !== false}
            onChange={checked => setDialogueNaturalness(prev => ({ ...prev, deAiEnabled: checked }))}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Text strong>对话采样预设（按模型系列）</Text>
            <Paragraph style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>
              按当前引擎模型系列覆盖请求采样参数（qwen: temp 0.7 / top_p 0.8；gemma: temp 1.0 / top_p 0.95），
              仅影响请求体，不修改引擎配置。默认关闭
            </Paragraph>
          </div>
          <Switch
            checked={dialogueNaturalness.samplingPresetEnabled === true}
            onChange={checked => setDialogueNaturalness(prev => ({ ...prev, samplingPresetEnabled: checked }))}
          />
        </div>
      </Space>

      {/* ==================== 类别管理 ==================== */}
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
              添加类别
            </Button>
            <Button icon={<ImportOutlined />} onClick={handleImport} size="small">
              导入
            </Button>
            <Button icon={<ExportOutlined />} onClick={handleExport} size="small">
              导出
            </Button>
            {categories.length > 0 && (
              <Popconfirm
                title="确认清空所有禁词类别？"
                onConfirm={handleClearAll}
                okText="确认"
                cancelText="取消"
              >
                <Button danger size="small">
                  清空全部
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>

        {categories.length > 0 ? (
          <Collapse
            items={categories.map((cat, index) => ({
              key: String(index),
              label: (
                <Space>
                  <Text strong>{cat.name}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {cat.words.length} 个禁词
                  </Text>
                </Space>
              ),
              extra: (
                <Space onClick={e => e.stopPropagation()}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleOpenEdit(index)}
                  />
                  <Popconfirm
                    title={`确认删除类别「${cat.name}」？`}
                    onConfirm={() => handleDeleteCategory(index)}
                    okText="确认"
                    cancelText="取消"
                  >
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
              children: (
                <div>
                  <Paragraph style={{ marginBottom: 8 }}>
                    <Text type="secondary">描述：</Text>
                    <br />
                    {cat.description}
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 8 }}>
                    <Text type="secondary">禁词：</Text>
                    <br />
                    <Space wrap>
                      {cat.words.map((w, i) => (
                        <Text code key={i}>{w}</Text>
                      ))}
                    </Space>
                  </Paragraph>
                  {cat.note && (
                    <Paragraph style={{ marginBottom: 0 }}>
                      <Text type="secondary">备注：</Text>
                      <br />
                      <Text style={{ fontStyle: 'italic' }}>{cat.note}</Text>
                    </Paragraph>
                  )}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty
            description="暂无禁词类别，点击上方「添加类别」按钮创建"
            style={{ margin: '32px 0' }}
          />
        )}
      </div>

      {/* ==================== 添加/编辑类别 Modal ==================== */}
      <Modal
        title={editingIndex >= 0 ? '编辑类别' : '添加类别'}
        open={modalVisible}
        onOk={handleSaveCategory}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>类别名称 *</Text>
            <Input
              placeholder="如 Religious Terminology、Extreme Emotion Labels"
              value={editForm.name}
              onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
              style={{ marginTop: 4 }}
            />
          </div>

          <div>
            <Text strong>类别描述 *</Text>
            <TextArea
              placeholder="描述该类禁词的范围和原因，如：Do not use words related to religion, rituals, or divinity."
              value={editForm.description}
              onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              style={{ marginTop: 4 }}
            />
          </div>

          <div>
            <Text strong>
              禁词列表 *
              <Tooltip title="每行一个禁词，支持中文和英文。AI 将自动理解并避免使用这些词汇">
                <QuestionCircleOutlined style={{ marginLeft: 4 }} />
              </Tooltip>
            </Text>
            <TextArea
              placeholder={"sacrifice\noffering\nsacred\nholy"}
              value={editForm.words.join('\n')}
              onChange={e => setEditForm(prev => ({ ...prev, words: e.target.value.split('\n') }))}
              rows={5}
              style={{ marginTop: 4, fontFamily: 'monospace' }}
            />
          </div>

          <div>
            <Text strong>
              备注（可选）
              <Tooltip title="替代表达建议，如 Show, Don't Tell 引导。AI 会参考此备注调整表达方式">
                <QuestionCircleOutlined style={{ marginLeft: 4 }} />
              </Tooltip>
            </Text>
            <TextArea
              placeholder="如：Instead of labeling these emotions, describe the physical manifestations and behavioral reactions to convey the intensity (Show, Don't Tell)."
              value={editForm.note || ''}
              onChange={e => setEditForm(prev => ({ ...prev, note: e.target.value }))}
              rows={2}
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </Card>
  );
});

BlockedWordsSettings.displayName = 'BlockedWordsSettings';

export default BlockedWordsSettings;