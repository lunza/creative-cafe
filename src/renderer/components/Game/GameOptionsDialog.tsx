/**
 * 游戏设置对话框（Task 10 / SubTask 10.3）
 *
 * 职责：
 * - 加载并编辑当前游戏的本地配置（GameLocalConfig）
 * - 配置项：AI 引擎选择 / 温度 / 最大 token / 表格整理模式 / ANSI 配色主题
 * - 保存后通过 window.electronAPI.game.saveConfig 持久化，并同步到 gameUIStore
 *
 * 数据源：
 * - 挂载时通过 window.electronAPI.game.getConfig(currentGameId) 加载配置
 * - AI 引擎列表从 useSettingStore.setting.aiEngines 读取
 *
 * 设计要点：
 * - 使用 antd Form + Form.useForm 受控表单
 * - 加载中显示 Spin，避免用户在数据未就绪时操作
 * - 配置加载失败时使用默认配置（DEFAULT_GAME_LOCAL_CONFIG）兜底，不阻塞用户
 * - 保存成功后通过 message.success 提示并关闭对话框
 *
 * 注意：
 * - 温度范围 0-2，步长 0.1（与 OpenAI / Anthropic 通用范围对齐）
 * - 最大 token 范围 1000-32000（兼顾本地模型与远端模型）
 * - ANSI 主题选项与 gameUIStore.AnsiTheme 类型保持一致（default / dark / light）
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  Form,
  Select,
  Slider,
  InputNumber,
  Radio,
  Button,
  Spin,
  message
} from 'antd';
import { useGameStore } from '../../stores/gameStore';
import { useGameUIStore } from '../../stores/gameUIStore';
import { useSettingStore } from '../../stores/settingStore';
import {
  DEFAULT_GAME_LOCAL_CONFIG,
  type GameTableOrganizeMode
} from '../../../shared/types/game.types';
import type { GameLocalConfig } from '../../../shared/types/game.types';
import type { AnsiTheme } from '../../stores/gameUIStore';

export interface GameOptionsDialogProps {
  /** 对话框是否可见 */
  open: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
}

/** ANSI 主题选项（与 gameUIStore.AnsiTheme 对齐） */
const ANSI_THEME_OPTIONS: Array<{ value: AnsiTheme; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'dark', label: '暗色' },
  { value: 'light', label: '亮色' }
];

/** 表格整理模式选项 */
const ORGANIZE_MODE_OPTIONS: Array<{ value: GameTableOrganizeMode; label: string }> = [
  { value: 'sync', label: '同步整理（AI 回复后系统主动整理）' },
  { value: 'async', label: '异步整理（AI 回复末尾自带 tableEdit 标签）' }
];

export const GameOptionsDialog: React.FC<GameOptionsDialogProps> = ({ open, onClose }) => {
  const currentGameId = useGameStore((s) => s.currentGameId);
  const setAnsiTheme = useGameUIStore((s) => s.setAnsiTheme);

  // 从 settingStore 读取 AI 引擎列表（setting 可能为 null，需兜底）
  const setting = useSettingStore((s) => s.setting);
  const aiEngines = setting?.aiEngines ?? [];

  const [form] = Form.useForm<GameLocalConfig>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * 加载游戏本地配置
   *
   * 在 open 切换为 true 时调用。若加载失败，使用默认配置兜底。
   */
  const loadConfig = useCallback(async () => {
    if (!currentGameId) {
      return;
    }
    setLoading(true);
    try {
      // IPC 返回 { success, config }，需解构 config
      const result = await window.electronAPI?.game?.getConfig(currentGameId);
      const config = result?.success ? result.config : undefined;
      // 合并默认配置，避免主进程返回的配置缺少新增字段
      const merged: GameLocalConfig = {
        ...DEFAULT_GAME_LOCAL_CONFIG,
        ...(config ?? {})
      };
      form.setFieldsValue(merged);
    } catch (err) {
      console.error('[GameOptionsDialog] getConfig failed:', err);
      message.warning('配置加载失败，使用默认配置');
      form.setFieldsValue(DEFAULT_GAME_LOCAL_CONFIG);
    } finally {
      setLoading(false);
    }
  }, [currentGameId, form]);

  useEffect(() => {
    if (open) {
      void loadConfig();
    }
  }, [open, loadConfig]);

  /**
   * 保存配置
   *
   * 通过 Form.validateFields 校验后调用 saveConfig 持久化。
   * 保存成功后同步 ANSI 主题到 gameUIStore（保证后续渲染一致），关闭对话框。
   */
  const handleSave = async () => {
    if (!currentGameId) {
      message.error('未选择游戏，无法保存配置');
      return;
    }
    try {
      const values = await form.validateFields();
      setSaving(true);
      await window.electronAPI?.game?.saveConfig(currentGameId, values);
      // 同步 ANSI 主题到 gameUIStore
      if (values.ansiTheme) {
        setAnsiTheme(values.ansiTheme as AnsiTheme);
      }
      message.success('配置已保存');
      onClose();
    } catch (err: any) {
      if (err?.errorFields) {
        // 表单校验错误，不弹 message（antd Form 会显示字段错误）
        return;
      }
      console.error('[GameOptionsDialog] saveConfig failed:', err);
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="游戏选项"
      open={open}
      onCancel={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </>
      }
      width={560}
      destroyOnClose={false}
      maskClosable={false}
    >
      <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          initialValues={DEFAULT_GAME_LOCAL_CONFIG}
        >
          <Form.Item
            label="AI 引擎"
            name="activeEngineId"
            tooltip="选择该游戏使用的 AI 引擎；不选则使用全局默认引擎"
          >
            <Select
              allowClear
              placeholder="请选择 AI 引擎"
              options={aiEngines.map((engine) => ({
                value: engine.id,
                label: `${engine.name} (${engine.model_name || '未配置模型'})`
              }))}
            />
          </Form.Item>

          <Form.Item
            label="温度"
            name="temperature"
            tooltip="控制生成文本的随机性：0 较确定，2 较随机"
            rules={[
              { type: 'number', min: 0, max: 2, message: '温度范围为 0-2' }
            ]}
          >
            <Slider min={0} max={2} step={0.1} marks={{ 0: '0', 1: '1', 2: '2' }} />
          </Form.Item>

          <Form.Item
            label="最大 token"
            name="maxTokens"
            tooltip="单次生成的最大 token 数"
            rules={[
              { type: 'number', min: 1000, max: 32000, message: '范围为 1000-32000' }
            ]}
          >
            <InputNumber min={1000} max={32000} step={1000} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label="表格整理模式"
            name="organizeMode"
            tooltip="sync：AI 回复后系统主动整理；async：AI 自带 tableEdit 标签"
          >
            <Radio.Group options={ORGANIZE_MODE_OPTIONS} />
          </Form.Item>

          <Form.Item
            label="ANSI 配色主题"
            name="ansiTheme"
            tooltip="控制 ANSI 字符瓦片地图的配色"
          >
            <Select options={ANSI_THEME_OPTIONS} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
};

export default GameOptionsDialog;
