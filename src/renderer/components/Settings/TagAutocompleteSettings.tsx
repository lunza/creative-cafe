/**
 * TagAutocompleteSettings — 标签自动推荐配置面板（Spec: implement-local-tag-autocomplete / Task 6）
 *
 * 来源：spec: implement-local-tag-autocomplete §Task 6
 *
 * 职责：
 *  1. 全局开关（启用标签自动推荐）→ tagAutocomplete.enabled
 *  2. CSV 文件路径选择（只读 Input 显示 + "选择文件"按钮触发原生文件对话框）
 *     → tagAutocomplete.csvPath
 *  3. 默认排序规则（匹配度 / 使用频率 / 字母顺序）→ tagAutocomplete.sortBy
 *  4. 路径变更时立即触发 tag:setCsvPath IPC 重新加载标签库（保存前即时生效）
 *  5. 顶部展示当前标签库加载状态（loaded / totalCount / error，来自 tag:getLoadStatus）
 *
 * 配置读写方式（与 WebSearchSettings / SDWebuiSettings 一致）：
 *  - 读取：useSettingStore 的 setting.tagAutocomplete（Zustand store）
 *  - 保存：通过 forwardRef + useImperativeHandle 暴露 getFormValues()，
 *          由 Settings.tsx 的 handleSave 合并到 updatedSetting.tagAutocomplete 中保存
 *
 * 设计约束：
 *  - 文件选择取消不报错（selectFile 返回 null 时静默返回）
 *  - reload 失败展示错误 Alert（不阻塞表单保存）
 *  - 不引入新依赖（复用 antd + @ant-design/icons）
 *
 * 关键 IPC：
 *  - window.electronAPI.file.selectFile(filters: FileFilter[]) → Promise<string | null>
 *  - window.electronAPI.tag.setCsvPath({ csvPath }) → Promise<{ success, totalCount, error? }>
 *  - window.electronAPI.tag.getLoadStatus() → Promise<{ loaded, loading, totalCount, csvPath, error? }>
 *  - window.electronAPI.tag.reload(args?) → Promise<{ success, totalCount, error? }>
 */
import { forwardRef, useImperativeHandle, useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Switch,
  Space,
  Alert,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  TagsOutlined,
  FolderOpenOutlined,
  SyncOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import type { TagAutocompleteConfig } from '../../types/setting';

const { Text } = Typography;

/**
 * TagAutocompleteSettings 暴露给父组件的 ref 接口。
 * 与 WebSearchSettingsRef / SDWebuiSettingsRef 一致：
 * 通过 getFormValues() 取出表单当前值，由 Settings.tsx 的 handleSave 合并保存。
 */
export interface TagAutocompleteSettingsRef {
  getFormValues: () => TagAutocompleteConfig | undefined;
}

/**
 * 标签自动推荐默认配置（与 src/shared/settings.ts defaultSetting.tagAutocomplete 保持一致）。
 * 当 setting.tagAutocomplete 不存在时（旧配置迁移场景）用于初始化表单。
 */
const DEFAULT_TAG_AUTOCOMPLETE_CONFIG: TagAutocompleteConfig = {
  enabled: true,
  csvPath: '',
  sortBy: 'relevance',
};

/** 排序规则选项列表 */
const SORT_BY_OPTIONS: Array<{
  label: string;
  value: TagAutocompleteConfig['sortBy'];
  description: string;
}> = [
  {
    label: '匹配度（前缀 > 包含 > 别名 + 次数降序）',
    value: 'relevance',
    description: '默认排序。前缀匹配优先，其次子串包含，最后别名匹配；同等级按 count 降序',
  },
  {
    label: '使用频率（count 降序）',
    value: 'count',
    description: '按 CSV 中记录的标签出现次数从高到低排序',
  },
  {
    label: '字母顺序（name 升序）',
    value: 'alphabetical',
    description: '按标签名字母升序 A-Z 排序',
  },
];

/** CSV 文件选择对话框过滤器 */
const CSV_FILE_FILTERS = [
  { name: 'CSV 文件', extensions: ['csv'] },
  { name: '所有文件', extensions: ['*'] },
];

/** 加载状态快照（tag:getLoadStatus 返回值的渲染进程类型） */
interface TagLoadStatusSnapshot {
  loaded: boolean;
  loading: boolean;
  totalCount: number;
  csvPath: string;
  error?: string;
}

/** reload 结果（tag:setCsvPath / tag:reload 返回值的渲染进程类型） */
interface TagReloadResultSnapshot {
  success: boolean;
  totalCount: number;
  error?: string;
}

/**
 * 标签自动推荐设置面板（Spec: implement-local-tag-autocomplete / Task 6）。
 *
 * 父组件通过 ref.current.getFormValues() 在保存时获取表单值，
 * 与 WebSearchSettings / SDWebuiSettings 模式一致。
 */
const TagAutocompleteSettings = forwardRef<TagAutocompleteSettingsRef>((_props, ref) => {
  const [form] = Form.useForm<TagAutocompleteConfig>();
  const setting = useSettingStore(s => s.setting);

  // 文件选择按钮加载态
  const [selectingFile, setSelectingFile] = useState(false);
  // 重新加载按钮加载态
  const [reloading, setReloading] = useState(false);
  // 当前标签库加载状态（用于顶部 Alert 展示）
  const [loadStatus, setLoadStatus] = useState<TagLoadStatusSnapshot | null>(null);
  // reload 结果（成功/失败提示）
  const [reloadResult, setReloadResult] = useState<TagReloadResultSnapshot | null>(null);

  // 暴露 getFormValues 给父组件
  useImperativeHandle(ref, () => ({
    getFormValues: () => {
      const values = form.getFieldsValue(true) as Partial<TagAutocompleteConfig>;
      // 合并默认值，避免字段缺失（旧配置无 tagAutocomplete 时初始化场景）
      return {
        ...DEFAULT_TAG_AUTOCOMPLETE_CONFIG,
        ...values,
      } as TagAutocompleteConfig;
    },
  }));

  // 当 setting 加载/变化时，初始化表单值
  useEffect(() => {
    const saved = setting?.tagAutocomplete;
    const initialValues: TagAutocompleteConfig = {
      ...DEFAULT_TAG_AUTOCOMPLETE_CONFIG,
      ...(saved || {}),
    };
    form.setFieldsValue(initialValues);
  }, [setting, form]);

  /**
   * 拉取标签库加载状态并更新顶部 Alert。
   * 在面板挂载与 reload 完成后调用。
   */
  const refreshLoadStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.tag.getLoadStatus();
      setLoadStatus(status);
    } catch (error) {
      // getLoadStatus 失败不影响主流程，仅记录到状态用于展示
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setLoadStatus({
        loaded: false,
        loading: false,
        totalCount: 0,
        csvPath: '',
        error: `获取加载状态失败：${errorMsg}`,
      });
    }
  }, []);

  // 面板挂载时拉取一次加载状态
  useEffect(() => {
    refreshLoadStatus();
  }, [refreshLoadStatus]);

  /**
   * 文件选择按钮回调：
   *  1. 调用 file:selectFile 打开原生文件选择对话框（CSV 过滤器）
   *  2. 用户取消（返回 null）时静默返回，不报错
   *  3. 选中后更新表单 csvPath 字段
   *  4. 立即触发 tag:setCsvPath IPC 重新加载标签库（路径变更即时生效，不等保存）
   *  5. 展示加载结果（成功显示标签总数，失败显示错误 Alert）
   */
  const handleSelectFile = useCallback(async () => {
    setSelectingFile(true);
    try {
      const selectedPath = await window.electronAPI.file.selectFile(CSV_FILE_FILTERS);
      // 用户取消选择，静默返回
      if (!selectedPath) {
        return;
      }

      // 更新表单字段
      form.setFieldsValue({ csvPath: selectedPath });

      // 立即触发重新加载
      setReloading(true);
      setReloadResult(null);
      try {
        const result = await window.electronAPI.tag.setCsvPath({ csvPath: selectedPath });
        setReloadResult(result);
        if (result.success) {
          message.success(`标签库加载成功，共 ${result.totalCount} 条标签`);
        } else {
          message.error(`标签库加载失败：${result.error || '未知错误'}`);
        }
        // 刷新顶部加载状态展示
        await refreshLoadStatus();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        setReloadResult({ success: false, totalCount: 0, error: errorMsg });
        message.error(`标签库加载异常：${errorMsg}`);
      } finally {
        setReloading(false);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      message.error(`选择文件失败：${errorMsg}`);
    } finally {
      setSelectingFile(false);
    }
  }, [form, refreshLoadStatus]);

  /**
   * 重新加载按钮回调：
   *  1. 读取当前表单 csvPath
   *  2. 路径非空时传给 tag:reload 切换到该路径；路径为空时不传 csvPath，
   *     主进程 service.reload() 会沿用 this.csvPath（首次加载时已解析为内置 docs/ 路径）
   *  3. 展示加载结果
   *
   * 与 handleSelectFile 区别：本方法不打开文件选择对话框，仅刷新当前路径下的标签库
   * （用于 CSV 文件被外部更新后重新加载，或清空自定义路径后回退到内置标签库）。
   */
  const handleReload = useCallback(async () => {
    const csvPath = form.getFieldValue('csvPath');
    const trimmedPath = (csvPath || '').trim();

    setReloading(true);
    setReloadResult(null);
    try {
      // 路径非空时传给 reload（切换到用户指定路径）；
      // 路径为空时不传 csvPath，service 沿用 this.csvPath（即内置 docs/ 标签库）
      const result = trimmedPath
        ? await window.electronAPI.tag.reload({ csvPath: trimmedPath })
        : await window.electronAPI.tag.reload();
      setReloadResult(result);
      if (result.success) {
        message.success(`标签库重新加载成功，共 ${result.totalCount} 条标签`);
      } else {
        message.error(`标签库重新加载失败：${result.error || '未知错误'}`);
      }
      await refreshLoadStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setReloadResult({ success: false, totalCount: 0, error: errorMsg });
      message.error(`标签库重新加载异常：${errorMsg}`);
    } finally {
      setReloading(false);
    }
  }, [form, refreshLoadStatus]);

  return (
    <Card
      title={
        <Space>
          <TagsOutlined />
          <span>标签自动推荐</span>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      {/* 顶部说明 */}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: 'rgba(99, 102, 241, 0.08)',
          borderRadius: '8px',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          系统已内置 Danbooru/e621 合并标签库（
          <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
            docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv
          </code>
          ，约 31.7 万条 tag），无需额外配置即可使用。下方路径留空时自动使用内置标签库；
          也可选择自定义 CSV 文件覆盖。CSV 格式：
          <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
            tag_name,category,count,"aliases"
          </code>
          。
        </p>
      </div>

      <Form form={form} layout="vertical">
        {/* ==================== 当前标签库加载状态 ==================== */}
        {loadStatus && (
          <Alert
            type={loadStatus.error ? 'error' : loadStatus.loaded ? 'success' : 'info'}
            showIcon
            style={{ marginBottom: 16 }}
            message={
              loadStatus.error
                ? '标签库加载失败'
                : loadStatus.loaded
                ? `标签库已加载（共 ${loadStatus.totalCount} 条标签）`
                : loadStatus.loading
                ? '标签库加载中...'
                : '标签库未加载'
            }
            description={
              <div>
                <p style={{ margin: 0 }}>
                  <strong>当前路径：</strong>
                  {loadStatus.csvPath || (
                    <Text type="secondary">未配置</Text>
                  )}
                </p>
                {loadStatus.loaded && (
                  <p style={{ margin: '4px 0 0 0' }}>
                    <strong>标签总数：</strong>
                    {loadStatus.totalCount}
                  </p>
                )}
                {loadStatus.error && (
                  <p style={{ margin: '4px 0 0 0', color: 'red', whiteSpace: 'pre-line' }}>
                    <strong>错误：</strong>
                    {loadStatus.error}
                  </p>
                )}
              </div>
            }
          />
        )}

        {/* ==================== 全局开关 ==================== */}
        <Form.Item
          name="enabled"
          label="启用标签自动推荐"
          valuePropName="checked"
          tooltip="开启后，AssetGenerateModal 临时标签输入框将支持自动推荐；关闭时降级为普通 Input"
        >
          <Switch />
        </Form.Item>

        {/* ==================== CSV 文件路径选择 ==================== */}
        <Form.Item
          name="csvPath"
          label={
            <Space>
              <span>CSV 标签库路径</span>
              <Tooltip title={'留空使用内置标签库（docs/danbooru_e621_merged_2026-03-01_pt20-ia-dd-ed-spc.csv）。也可选择自定义 CSV 文件覆盖。文件格式：tag_name,category,count,"aliases"。选择后立即触发重新加载，无需点击保存'}>
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
          tooltip="留空使用内置标签库；选择 CSV 文件后立即重新加载（不等保存）。路径变更触发 tag:setCsvPath IPC"
        >
          <Input
            placeholder="留空使用内置标签库，或点击右侧按钮选择自定义 CSV 文件"
            readOnly
            addonAfter={
              <Button
                type="link"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={handleSelectFile}
                loading={selectingFile}
                style={{ padding: 0, height: 'auto' }}
              >
                选择文件
              </Button>
            }
          />
        </Form.Item>

        {/* ==================== 重新加载按钮（用于 CSV 文件外部更新后刷新）==================== */}
        <Form.Item>
          <Space>
            <Button
              icon={<SyncOutlined />}
              onClick={handleReload}
              loading={reloading}
            >
              重新加载标签库
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              CSV 文件被外部更新后点击此按钮刷新索引；路径为空时重新加载内置标签库
            </Text>
          </Space>
        </Form.Item>

        {/* reload 结果展示 */}
        {reloadResult && (
          <div style={{ marginBottom: 16 }}>
            <Alert
              message={reloadResult.success ? '标签库加载成功' : '标签库加载失败'}
              description={
                reloadResult.success ? (
                  <p style={{ margin: 0 }}>
                    <strong>标签总数：</strong>
                    {reloadResult.totalCount}
                  </p>
                ) : (
                  <p style={{ margin: 0, color: 'red', whiteSpace: 'pre-line' }}>
                    <strong>错误：</strong>
                    {reloadResult.error || '未知错误'}
                  </p>
                )
              }
              type={reloadResult.success ? 'success' : 'error'}
              showIcon
              closable
              onClose={() => setReloadResult(null)}
            />
          </div>
        )}

        {/* ==================== 默认排序规则 ==================== */}
        <Form.Item
          name="sortBy"
          label={
            <Space>
              <span>默认排序规则</span>
              <Tooltip title="TagAutocomplete 组件默认使用的排序规则。用户也可在输入框旁的 Dropdown 中临时切换">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
          tooltip="relevance=匹配度（前缀 > 包含 > 别名 + count 降序）/ count=使用频率降序 / alphabetical=字母升序"
        >
          <Select options={SORT_BY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} />
        </Form.Item>
      </Form>
    </Card>
  );
});

TagAutocompleteSettings.displayName = 'TagAutocompleteSettings';

export default TagAutocompleteSettings;
