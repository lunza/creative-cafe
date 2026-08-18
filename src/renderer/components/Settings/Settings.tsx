import React, { useEffect, useState, useMemo } from 'react';
import { Form, Button, Space, message, Divider, Tabs } from 'antd';
import { SaveOutlined, ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { AIEngineSetting } from '../../types/setting';
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

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const setting = useSettingStore(s => s.setting);
  const fetchSetting = useSettingStore(s => s.fetchSetting);
  const saveSetting = useSettingStore(s => s.saveSetting);
  const restoreDefault = useSettingStore(s => s.restoreDefault);
  const addLog = useLogStore(s => s.addLog);

  const [dashboardBackgroundImage, setDashboardBackgroundImage] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
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

  useEffect(() => {
    if (setting) {
      setDashboardBackgroundImage(setting.dashboardBackgroundImage || '');
      setDebugMode(setting.debugMode || false);
      const engines = setting.aiEngines || [];
      const engine = engines.find(e => e.id === setting.activeEngineId) || engines[0];
      form.setFieldsValue({
        debugMode: setting.debugMode || false,
        logLevel: setting.logLevel || 'info',
        api_url: engine?.api_url || 'http://127.0.0.1:5000',
        api_key: engine?.api_key || '',
        model_name: engine?.model_name || '',
        api_key_transmission: engine?.api_key_transmission || 'header',
        agentModeOverride: engine?.agentModeOverride || 'auto',
        max_tokens: (typeof engine?.max_tokens === 'number' && engine.max_tokens > 0) ? engine.max_tokens : 10240,
        temperature: (typeof engine?.temperature === 'number' && engine.temperature >= 0 && engine.temperature <= 2) ? engine.temperature : 0.7,
        top_p: engine?.top_p,
        top_k: engine?.top_k,
        min_p: engine?.min_p,
        frequency_penalty: engine?.frequency_penalty,
        presence_penalty: engine?.presence_penalty,
        n: engine?.n,
        connection_timeout: engine?.connection_timeout ?? 120000,
        request_timeout: engine?.request_timeout ?? 300000,
        system_prompt: engine?.system_prompt || '',
      });
    }
  }, [setting, form]);

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

  const handleSave = async () => {
    try {
      addLog('开始保存设置', 'info');
      const values = await form.validateFields();
      addLog(`表单验证成功: ${JSON.stringify(values)}`, 'info');

      if (setting && activeEngine) {
        addLog(`当前设置: ${JSON.stringify(setting)}`, 'info');

        const updatedEngines = (setting.aiEngines || []).map(engine => {
          if (engine.id === activeEngine.id) {
            return {
              ...engine,
              api_url: values.api_url || 'http://127.0.0.1:5000',
              api_key: values.api_key || '',
              model_name: values.model_name || '',
              api_key_transmission: values.api_key_transmission || 'header',
              agentModeOverride: values.agentModeOverride || 'auto',
              max_tokens: Number(values.max_tokens) || 10240,
              temperature: Number(values.temperature) ?? 0.7,
              top_p: Number(values.top_p) || undefined,
              top_k: Number(values.top_k) || undefined,
              min_p: Number(values.min_p) || undefined,
              frequency_penalty: Number(values.frequency_penalty) || undefined,
              presence_penalty: Number(values.presence_penalty) || undefined,
              n: Number(values.n) || 1,
              connection_timeout: values.connection_timeout !== undefined && values.connection_timeout !== '' ? Number(values.connection_timeout) : 120000,
              request_timeout: values.request_timeout !== undefined && values.request_timeout !== '' ? Number(values.request_timeout) : 300000,
              system_prompt: values.system_prompt || '',
            };
          }
          return engine;
        });

        const vectorConfig = vectorConfigRef.current?.getFormValues() || {};
        const sdWebuiConfig = sdWebuiConfigRef.current?.getFormValues();
        const webSearchConfig = webSearchConfigRef.current?.getFormValues();
        // Spec: implement-local-tag-autocomplete / Task 6
        const tagAutocompleteConfig = tagAutocompleteConfigRef.current?.getFormValues();
        // Spec: rag-tag-library-for-ai-trait-generation / Task 10
        const tagRagConfig = tagRagConfigRef.current?.getFormValues();
        // Spec: add-forbidden-words-prompt / Task 4
        const blockedWordsConfig = blockedWordsConfigRef.current?.getFormValues();

        const updatedSetting = {
          ...setting,
          aiEngines: updatedEngines,
          logLevel: values.logLevel || 'info',
          dashboardBackgroundImage: dashboardBackgroundImage,
          debugMode: debugMode,
          vector: vectorConfig,
          ...(sdWebuiConfig ? { sdWebui: sdWebuiConfig } : {}),
          ...(webSearchConfig ? { webSearch: webSearchConfig } : {}),
          ...(tagAutocompleteConfig ? { tagAutocomplete: tagAutocompleteConfig } : {}),
          ...(tagRagConfig ? { tagRag: tagRagConfig } : {}),
          ...(blockedWordsConfig ? { forbiddenWords: blockedWordsConfig } : {}),
        };

        addLog(`更新后的设置: ${JSON.stringify(updatedSetting)}`, 'info');

        try {
          await saveSetting(updatedSetting as any);
          addLog('设置保存成功', 'info');
          message.success('设置保存成功');
        } catch (saveError) {
          addLog('保存设置异常', 'error', {
            category: 'setting',
            error: saveError instanceof Error ? saveError : undefined,
            context: {
              errorType: saveError instanceof Error ? saveError.name : 'UnknownError',
              errorLocation: 'Settings.tsx:handleSave',
              errorMessage: saveError instanceof Error ? saveError.message : 'Unknown error',
            },
            details: '保存设置时发生异常，请检查设置值是否正确。',
          });
          message.error(`保存设置异常: ${saveError instanceof Error ? saveError.message : '未知错误'}`);
        }
      } else {
        addLog('设置为null', 'error');
        message.error('设置未加载');
      }
    } catch (error: any) {
      if (error?.errorFields && Array.isArray(error.errorFields)) {
        const errorMessages = error.errorFields
          .map((field: any) => `${field.name?.join('.') || '未知字段'}: ${field.errors?.join(', ') || '验证失败'}`)
          .join('; ');
        addLog(`表单验证失败: ${errorMessages}`, 'error');
        message.error(`表单验证失败: ${errorMessages}`);
        return;
      }
      addLog('保存设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:handleSave',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        details: '保存设置时发生错误，请检查设置值是否正确。',
      });
      message.error(`设置保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleReset = async () => {
    try {
      await restoreDefault();
      form.resetFields();
      message.info('设置已重置');
    } catch (error) {
      addLog('重置设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:handleReset',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        details: '重置设置时发生错误，请检查文件系统权限。',
      });
      message.error('重置设置失败');
    }
  };

  return (
    <div className="settings">
      <div className="settings-content">
        <h2>设置</h2>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          tabPlacement="top"
          items={[
            {
              key: 'general',
              label: '通用',
              forceRender: true,
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
              forceRender: true,
              children: <AIEngineSettingsPanel form={form} />,
            },
            {
              key: 'image-gen',
              label: '图像生成',
              forceRender: true,
              children: <SDWebuiSettings ref={sdWebuiConfigRef} />,
            },
            {
              key: 'vector-rag',
              label: '向量与 RAG',
              forceRender: true,
              children: (
                <>
                  <VectorConfigPanel ref={vectorConfigRef} />
                  <TagRagSettings ref={tagRagConfigRef} />
                </>
              ),
            },
            {
              key: 'tags-search',
              label: '标签与搜索',
              forceRender: true,
              children: (
                <>
                  <TagAutocompleteSettings ref={tagAutocompleteConfigRef} />
                  <WebSearchSettings ref={webSearchConfigRef} />
                </>
              ),
            },
            {
              key: 'content-filter',
              label: '内容约束',
              forceRender: true,
              children: <BlockedWordsSettings ref={blockedWordsConfigRef} />,
            },
          ]}
        />
        <Divider />
        <Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存设置</Button>
          <Button icon={<FileTextOutlined />} onClick={handleOpenConfigFile}>打开配置文件</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置设置</Button>
        </Space>
      </div>
    </div>
  );
};

export default Settings;
