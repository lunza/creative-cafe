import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Form, Button, Space, message, Divider, Tabs, Modal } from 'antd';
import { SaveOutlined, ReloadOutlined, FileTextOutlined, HistoryOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { AIEngineSetting, AppSetting } from '../../types/setting';
import { VectorConfigPanel, VectorConfigPanelRef } from '../Vector/VectorConfigPanel';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import AIEngineSettingsPanel from './AIEngineSettingsPanel';
import SDWebuiSettings, { SDWebuiSettingsRef } from './SDWebuiSettings';
import WebSearchSettings, { WebSearchSettingsRef } from './WebSearchSettings';
// Spec: implement-local-tag-autocomplete / Task 6
import TagAutocompleteSettings, { TagAutocompleteSettingsRef } from './TagAutocompleteSettings';
// Spec: rag-tag-library-for-ai-trait-generation / Task 10
import TagRagSettings, { TagRagSettingsRef } from './TagRagSettings';
// Spec: add-banned-words-filter / Task 5
import BlockedWordsSettings, { BlockedWordsSettingsRef } from './BlockedWordsSettings';
import './Settings.css';
// 思考联动（model_series → thinking_mode 推导）已随 H-9 / CR-3 收敛进 settingMapper.mapEngineFormValues
// Spec: settings-feature-optimization-report / H-1（日志脱敏：api_key 不落日志）
import { redactSecrets } from '../../../shared/utils/redactSecrets';
// Spec: settings-feature-optimization-report / CR-4, M-20（错误日志 context 统一构建）
import { buildErrorContext } from '../../utils/logContext';
// Spec: settings-feature-optimization-report / H-9（handleSave 纯函数化 + 单测）
// Spec: settings-feature-optimization-report / M-1, UI-1（脏检测纯函数：期望值同源 + 脏字段清单）
import {
  buildUpdatedSetting,
  buildEngineFormValuesFromSetting,
  MAIN_FORM_DIRTY_FIELDS,
  SettingPanelRefs,
} from './settingMapper';

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const setting = useSettingStore(s => s.setting);
  const fetchSetting = useSettingStore(s => s.fetchSetting);
  const saveSetting = useSettingStore(s => s.saveSetting);
  const restoreDefault = useSettingStore(s => s.restoreDefault);
  // Spec: settings-feature-optimization-report / H-11（N1 版本历史 + 回滚）
  const getSettingHistory = useSettingStore(s => s.getSettingHistory);
  const rollbackToVersion = useSettingStore(s => s.rollbackToVersion);
  const addLog = useLogStore(s => s.addLog);

  const [dashboardBackgroundImage, setDashboardBackgroundImage] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  // N1 版本历史弹窗状态
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  // Spec: M-1, UI-1 — 保存中状态（loading 防双击重复提交）
  const [saving, setSaving] = useState(false);
  // Spec: M-1, UI-1 — 6 个 ref 面板的脏状态（面板 onDirtyChange 回调上抛）
  const [dirtyPanels, setDirtyPanels] = useState<Record<string, boolean>>({});
  // Spec: M-11, PF-1 — 访问过的页签缓存：未访问页签 children 渲染 null（ref 为 null，
  // 保存时经 buildUpdatedSetting 沿用 setting 现存值兜底）；已访问页签保留挂载（切页不丢值）
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(['general']));
  const vectorConfigRef = React.useRef<VectorConfigPanelRef>(null);
  const sdWebuiConfigRef = React.useRef<SDWebuiSettingsRef>(null);
  const webSearchConfigRef = React.useRef<WebSearchSettingsRef>(null);
  // Spec: implement-local-tag-autocomplete / Task 6
  const tagAutocompleteConfigRef = React.useRef<TagAutocompleteSettingsRef>(null);
  // Spec: rag-tag-library-for-ai-trait-generation / Task 10
  const tagRagConfigRef = React.useRef<TagRagSettingsRef>(null);
  // Spec: add-banned-words-filter / Task 5
  const blockedWordsConfigRef = React.useRef<BlockedWordsSettingsRef>(null);

  const activeEngine = useMemo<AIEngineSetting | null>(() => {
    const engines = setting?.aiEngines ?? [];
    return engines.find(e => e.id === setting?.activeEngineId) ?? engines[0] ?? null;
  }, [setting?.aiEngines, setting?.activeEngineId]);

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  // Spec: M-9 — 表单/顶层 state 与 setting 的同步抽为独立函数：
  // 初始化、保存失败回滚、重置、回滚后复用同一路径，避免多处映射漂移。
  // 映射逻辑收敛在 settingMapper.buildEngineFormValuesFromSetting（纯函数，与脏检测同源）。
  const syncFormFromSetting = useCallback((s: AppSetting) => {
    setDashboardBackgroundImage(s.dashboardBackgroundImage || '');
    setDebugMode(s.debugMode || false);
    form.setFieldsValue(buildEngineFormValuesFromSetting(s));
  }, [form]);

  useEffect(() => {
    if (setting) {
      syncFormFromSetting(setting);
    }
  }, [setting, syncFormFromSetting]);

  // ===== Spec: M-1, UI-1 — 保存按钮三态化（脏检测）=====
  // 主表单：全表单值监听 vs setting 推导的期望值（保存成功后 setting 更新 → 期望值 = 当前值 → 自动清零，
  // 规避 isFieldsTouched 保存后仍粘滞的问题）。debugMode/theme/animation/compact 不受表单驱动，不在比较清单内。
  const watchedMainValues = Form.useWatch([], form) as Record<string, unknown> | undefined;
  const expectedMainValues = useMemo(
    () => (setting ? buildEngineFormValuesFromSetting(setting) : null),
    [setting]
  );
  const mainFormDirty = useMemo(() => {
    if (!expectedMainValues || !watchedMainValues) return false;
    return MAIN_FORM_DIRTY_FIELDS.some(
      field => JSON.stringify(watchedMainValues[field]) !== JSON.stringify(expectedMainValues[field])
    );
  }, [expectedMainValues, watchedMainValues]);
  // 顶层 state（仪表盘背景图 / 调试模式）由组件 state 受控，直接与 setting 比较
  const extrasDirty =
    dashboardBackgroundImage !== (setting?.dashboardBackgroundImage ?? '') ||
    debugMode !== (setting?.debugMode ?? false);

  // 6 面板脏状态回调（引用稳定，面板侧 effect 不会因父组件重渲染循环触发）
  const makePanelDirtyHandler = useCallback(
    (key: string) => (dirty: boolean) => {
      setDirtyPanels(prev => (prev[key] === dirty ? prev : { ...prev, [key]: dirty }));
    },
    []
  );
  const onVectorDirty = useMemo(() => makePanelDirtyHandler('vector'), [makePanelDirtyHandler]);
  const onSdWebuiDirty = useMemo(() => makePanelDirtyHandler('sdWebui'), [makePanelDirtyHandler]);
  const onWebSearchDirty = useMemo(() => makePanelDirtyHandler('webSearch'), [makePanelDirtyHandler]);
  const onTagAutocompleteDirty = useMemo(() => makePanelDirtyHandler('tagAutocomplete'), [makePanelDirtyHandler]);
  const onTagRagDirty = useMemo(() => makePanelDirtyHandler('tagRag'), [makePanelDirtyHandler]);
  const onBlockedWordsDirty = useMemo(() => makePanelDirtyHandler('blockedWords'), [makePanelDirtyHandler]);

  const anyPanelDirty =
    dirtyPanels.vector || dirtyPanels.sdWebui || dirtyPanels.webSearch ||
    dirtyPanels.tagAutocomplete || dirtyPanels.tagRag || dirtyPanels.blockedWords;
  const anyDirty = mainFormDirty || extrasDirty || anyPanelDirty;

  // M-11：切页即挂载（visitedTabs 缓存），未访问页签保持 null
  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key);
    setVisitedTabs(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const handleOpenConfigFile = async () => {
    try {
      const result = await (window.electronAPI as any).app.openConfigFile();
      if (!result) {
        message.warning('无法打开配置文件，请检查文件是否存在');
      }
    } catch (error) {
      message.error(`打开配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // Spec: UI-1 — 校验失败按配置域分组（定位到域与字段，替换单一 message）
  const domainOfField = (fieldName: string): string => (fieldName === 'logLevel' ? '通用' : 'AI 引擎');

  // Spec: UI-1 — 成功时列出本次保存携带的配置域（未访问页签的域沿用现存值，不在此列）
  const describeSavedDomains = (refs: SettingPanelRefs): string => {
    const domains: string[] = ['通用', 'AI 引擎'];
    if (refs.vector?.current) domains.push('向量');
    if (refs.sdWebui?.current) domains.push('SD WebUI');
    if (refs.webSearch?.current) domains.push('网络搜索');
    if (refs.tagAutocomplete?.current) domains.push('标签自动推荐');
    if (refs.tagRag?.current) domains.push('RAG 标签库');
    if (refs.blockedWords?.current) domains.push('内容约束/对话自然度');
    return domains.join('、');
  };

  const handleSave = async () => {
    // Spec: M-1 — 保存中拦截（按钮 loading 已拦截点击，此处为双保险防重复提交）
    if (saving) return;
    try {
      addLog('开始保存设置', 'info');
      // Spec: M-11 — 全表单 store 值（含无 Form.Item 的隐藏采样字段，及未访问页签字段
      // 初始化时写入 store 的现存值）与校验结果合并：未挂载页签的字段不会因
      // validateFields 只返回已注册字段而掉到默认值。
      const storeValues = form.getFieldsValue(true) as Record<string, unknown>;
      const validatedValues = await form.validateFields();
      const values = { ...storeValues, ...validatedValues } as Record<string, unknown>;
      addLog(`表单验证成功: ${redactSecrets(JSON.stringify(values))}`, 'info');

      if (setting && activeEngine) {
        addLog(`当前设置: ${redactSecrets(JSON.stringify(setting))}`, 'info');

        // H-9 / CR-3：映射与聚合抽为 settingMapper 纯函数（含单测覆盖），
        // handleSave 仅保留「验证 → 调纯函数 → saveSetting → 反馈」骨架。
        const allValues = storeValues;
        const refs: SettingPanelRefs = {
          vector: vectorConfigRef,
          sdWebui: sdWebuiConfigRef,
          webSearch: webSearchConfigRef,
          tagAutocomplete: tagAutocompleteConfigRef,
          tagRag: tagRagConfigRef,
          blockedWords: blockedWordsConfigRef,
        };
        const updatedSetting = buildUpdatedSetting(setting, values, allValues, refs, {
          dashboardBackgroundImage,
          debugMode,
        });

        addLog(`更新后的设置: ${redactSecrets(JSON.stringify(updatedSetting))}`, 'info');

        // Spec: M-1 — 保存中置 loading（防双击重复提交）
        setSaving(true);
        try {
          await saveSetting(updatedSetting as any);
          addLog('设置保存成功', 'info');
          message.success(`设置保存成功（${describeSavedDomains(refs)}）`);
        } catch (saveError) {
          // 【CR-4/M-20】错误 context 三元组统一走 buildErrorContext
          addLog('保存设置异常', 'error', {
            category: 'setting',
            error: saveError instanceof Error ? saveError : undefined,
            context: buildErrorContext(saveError, 'Settings.tsx:handleSave'),
            details: '保存设置时发生异常，已回滚界面为上次保存的值。',
          });
          // Spec: M-9, ST-4 — 保存失败后 UI 回滚：settingStore 失败不改 setting，
          // 以旧 setting 重新同步主表单/顶层 state，并让 6 面板重初始化（快照复位 → 脏状态清零），
          // 不再「误以为已保存」。
          syncFormFromSetting(setting);
          vectorConfigRef.current?.refreshFromStore();
          sdWebuiConfigRef.current?.refreshFromStore();
          webSearchConfigRef.current?.refreshFromStore();
          tagAutocompleteConfigRef.current?.refreshFromStore();
          tagRagConfigRef.current?.refreshFromStore();
          blockedWordsConfigRef.current?.refreshFromStore();
          message.error(`保存设置失败，已还原为上次保存的值: ${saveError instanceof Error ? saveError.message : '未知错误'}`);
        } finally {
          setSaving(false);
        }
      } else {
        addLog('设置为null', 'error');
        message.error('设置未加载');
      }
    } catch (error: any) {
      if (error?.errorFields && Array.isArray(error.errorFields)) {
        // Spec: UI-1 — 校验失败按配置域分组，定位到域与字段
        const grouped: Record<string, string[]> = {};
        for (const field of error.errorFields) {
          const fieldLabel = `${field.name?.join('.') || '未知字段'}: ${field.errors?.join(', ') || '验证失败'}`;
          const domain = domainOfField(String(field.name?.[0] ?? ''));
          (grouped[domain] = grouped[domain] || []).push(fieldLabel);
        }
        const summary = Object.entries(grouped)
          .map(([domain, msgs]) => `${domain}: ${msgs.join('; ')}`)
          .join(' | ');
        addLog(`表单验证失败: ${summary}`, 'error');
        message.error(`表单验证失败 — ${summary}`);
        return;
      }
      // 【CR-4/M-20】错误 context 三元组统一走 buildErrorContext
      addLog('保存设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: buildErrorContext(error, 'Settings.tsx:handleSave'),
        details: '保存设置时发生错误，请检查设置值是否正确。',
      });
      message.error(`设置保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const doReset = async () => {
    try {
      await restoreDefault();
      // Spec: UI-3 — 统一重置契约：6 面板 resetFields 全覆盖（报告风险提示 2：
      // 任何面板漏实现会「半重置」）。未挂载面板 ref 为 null 跳过，其配置域已由
      // restoreDefault 在 store 侧复位，下次访问时按新 setting 初始化。
      vectorConfigRef.current?.resetFields();
      sdWebuiConfigRef.current?.resetFields();
      webSearchConfigRef.current?.resetFields();
      tagAutocompleteConfigRef.current?.resetFields();
      tagRagConfigRef.current?.resetFields();
      blockedWordsConfigRef.current?.resetFields();
      // 主表单与顶层 state（背景图/调试模式）同步为重置后的 setting。
      // 【重点标记 - 重置残留修复】此前 form.resetFields() 复位到 Form.Item 的
      // initialValue（多为 undefined）而非默认值，重置后引擎字段被清空。
      const resetSetting = useSettingStore.getState().setting;
      if (resetSetting) syncFormFromSetting(resetSetting);
      message.info('设置已重置');
    } catch (error) {
      // 【CR-4/M-20】错误 context 三元组统一走 buildErrorContext
      addLog('重置设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: buildErrorContext(error, 'Settings.tsx:handleReset'),
        details: '重置设置时发生错误，请检查文件系统权限。',
      });
      message.error('重置设置失败');
    }
  };

  // 【重点标记 - N2 重置二次确认（H-3）】重置会覆盖全部配置域为默认值，属破坏性操作。
  // 此前 handleReset 直接执行无确认（IX-2），易误操作且重置范围残缺。现弹 Modal 二次确认
  // 并明示影响范围：全部配置域复位默认值，knowledgeBase / 文件路径等接口外数据保留
  // （DC-4 白名单合并，见 mergePreservedKeys）。
  const handleReset = () => {
    Modal.confirm({
      title: '重置设置？',
      content: (
        <div>
          <p>以下配置域将恢复为默认值：</p>
          <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
            <li>通用（日志级别 / 调试模式 / 背景图）</li>
            <li>AI 引擎（API 地址 / 模型 / 温度 / 采样参数等）</li>
            <li>向量化 / SD WebUI / 网络搜索 / 标签自动推荐 / RAG 标签库</li>
            <li>内容约束（禁词）/ 对话自然度</li>
          </ul>
          <p style={{ color: '#faad14', marginBottom: 0 }}>
            知识库（knowledgeBase）与文件路径等数据将保留，不会被清除。
          </p>
        </div>
      ),
      okText: '确认重置',
      cancelText: '取消',
      onOk: doReset,
    });
  };

  // 【重点标记 - N1 版本历史（H-11）】加载真实快照历史（saveSetting 保存前自动留档）
  const openVersionHistory = async () => {
    const history = await getSettingHistory();
    setVersions(history ?? []);
    setVersionHistoryOpen(true);
  };

  // N1：回滚到指定版本（二次确认；回滚本身也会经 saveSetting 对回滚前状态留档）
  const handleRollback = (versionId: string) => {
    Modal.confirm({
      title: '回滚到此版本？',
      content: '当前设置会先留档，随后覆盖为所选版本快照的内容。',
      okText: '确认回滚',
      cancelText: '取消',
      onOk: async () => {
        setRollbackLoading(true);
        try {
          await rollbackToVersion(versionId);
          message.success('已回滚到所选版本');
          setVersionHistoryOpen(false);
          // UI-3：回滚后以新 setting 重同步表单（rollbackToVersion 经 saveSetting
          // 已更新 store，此处兜底确保界面与回滚结果一致）
          const rolledBack = useSettingStore.getState().setting;
          if (rolledBack) syncFormFromSetting(rolledBack);
        } catch (e) {
          message.error(`回滚失败: ${e instanceof Error ? e.message : '未知错误'}`);
        } finally {
          setRollbackLoading(false);
        }
      },
    });
  };

  return (
    <div className="settings">
      <div className="settings-content">
        <h2>设置</h2>
        {/* Spec: M-11, PF-1 — 去掉 6 页签全量 forceRender，改「访问过的页签缓存」：
            未访问页签 children 渲染 null（ref 为 null，保存时沿用 setting 现存值兜底），
            已访问页签保留挂载（destroyInactiveTabPane={false}，切页不丢值）。
            首屏 Form.Item 从 ~111 降至当前页签量级。 */}
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          tabPlacement="top"
          destroyInactiveTabPane={false}
          items={[
            {
              key: 'general',
              label: '通用',
              children: (
                <GeneralSettingsPanel
                  form={form}
                  dashboardBackgroundImage={dashboardBackgroundImage}
                  onBackgroundImageChange={setDashboardBackgroundImage}
                  debugMode={debugMode}
                  onDebugModeChange={setDebugMode}
                />
              ),
            },
            {
              key: 'ai-engine',
              label: 'AI 引擎',
              children: visitedTabs.has('ai-engine') ? <AIEngineSettingsPanel form={form} /> : null,
            },
            {
              key: 'image-gen',
              label: '图像生成',
              children: visitedTabs.has('image-gen') ? (
                <SDWebuiSettings ref={sdWebuiConfigRef} onDirtyChange={onSdWebuiDirty} />
              ) : null,
            },
            {
              key: 'vector-rag',
              label: '向量与 RAG',
              children: visitedTabs.has('vector-rag') ? (
                <>
                  <VectorConfigPanel ref={vectorConfigRef} onDirtyChange={onVectorDirty} />
                  {/* Spec: UI-5 — 页签内两异构域之间加 Divider + 区块标题明确边界 */}
                  <Divider plain style={{ margin: '24px 0 8px' }}>
                    RAG 标签库
                  </Divider>
                  <TagRagSettings ref={tagRagConfigRef} onDirtyChange={onTagRagDirty} />
                </>
              ) : null,
            },
            {
              key: 'tags-search',
              label: '标签与搜索',
              children: visitedTabs.has('tags-search') ? (
                <>
                  <TagAutocompleteSettings ref={tagAutocompleteConfigRef} onDirtyChange={onTagAutocompleteDirty} />
                  {/* Spec: UI-5 — 页签内两异构域之间加 Divider + 区块标题明确边界 */}
                  <Divider plain style={{ margin: '24px 0 8px' }}>
                    网络搜索
                  </Divider>
                  <WebSearchSettings ref={webSearchConfigRef} onDirtyChange={onWebSearchDirty} />
                </>
              ) : null,
            },
            {
              key: 'content-filter',
              label: '内容约束',
              children: visitedTabs.has('content-filter') ? (
                <BlockedWordsSettings ref={blockedWordsConfigRef} onDirtyChange={onBlockedWordsDirty} />
              ) : null,
            },
          ]}
        />
        <Divider />
        <Space>
          {/* Spec: M-1, UI-1 — 保存按钮三态化：无改动 disabled / 有改动可点 / 保存中 loading 防双击 */}
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!anyDirty}>
            保存设置
          </Button>
          <Button icon={<FileTextOutlined />} onClick={handleOpenConfigFile}>打开配置文件</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置设置</Button>
          {/* N1：版本历史 + 回滚 */}
          <Button icon={<HistoryOutlined />} onClick={openVersionHistory}>历史版本</Button>
        </Space>

        {/* N1 版本历史弹窗：列出自动保存快照，支持回滚 */}
        <Modal
          title="设置历史版本"
          open={versionHistoryOpen}
          onCancel={() => setVersionHistoryOpen(false)}
          footer={null}
          width={560}
        >
          {versions.length === 0 ? (
            <p style={{ color: '#999' }}>暂无历史版本（每次保存会自动留档，最近 20 条）。</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 420, overflowY: 'auto' }}>
              {versions.map((v: any) => (
                <li key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div>
                    <div>{v.note || '自动保存'}</div>
                    <div style={{ color: '#999', fontSize: 12 }}>
                      {new Date(v.timestamp).toLocaleString()}
                      {v.isAutoGenerated ? ' · 自动' : ''}
                    </div>
                  </div>
                  <Button size="small" loading={rollbackLoading} onClick={() => handleRollback(v.id)}>
                    回滚
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      </div>
    </div>
  );
};

export default Settings;
