import React, { useEffect, useState } from 'react';
import { Card, Form, Switch, Select, Button, Space, message, Divider, Input, Upload, Modal, Table, Popconfirm, Alert } from 'antd';
import { SaveOutlined, ReloadOutlined, FolderOutlined, UndoOutlined, UploadOutlined, DeleteOutlined, PlusOutlined, EditOutlined, SettingOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, FileTextOutlined } from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { AIEngineSetting } from '../../types/setting';
import { VectorConfigPanel, VectorConfigPanelRef } from '../Vector/VectorConfigPanel';
import { AppSetting } from '../../settings';
import './Settings.css';

const Settings: React.FC = () => {
  const { theme, setTheme, animationEnabled, setAnimationEnabled, compactMode, setCompactMode } = useUIStore();
  const { setting, fetchSetting, saveSetting, restoreDefault, testConnection } = useSettingStore();
  const { addLog } = useLogStore();
  const [form] = Form.useForm();
  const [paths, setPaths] = useState({
    worldBookPath: '',
    characterPath: '',
    avatarPath: '',
    creativePath: '',
    memoryPath: '',
    pluginPath: ''
  });
  const [pathValidation, setPathValidation] = useState<Record<string, { valid: boolean; message?: string }>>({});
  const [dashboardBackgroundImage, setDashboardBackgroundImage] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const vectorConfigRef = React.useRef<VectorConfigPanelRef>(null);
  
  // AI 引擎管理相关状态
  const [activeEngine, setActiveEngine] = useState<AIEngineSetting | null>(null);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [editingEngine, setEditingEngine] = useState<AIEngineSetting | null>(null);
  const [engineForm] = Form.useForm();
  const [testResult, setTestResult] = useState<{ success: boolean; responseTime?: number; model?: string; error?: string; details?: string } | null>(null);

  // 加载设置
  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  // 当设置变化时，更新表单值
  useEffect(() => {
    if (setting) {
      setPaths({
        worldBookPath: setting.worldBookPath || '',
        characterPath: setting.characterPath || '',
        avatarPath: setting.avatarPath || '',
        creativePath: setting.creativePath || '',
        memoryPath: setting.memoryPath || '',
        pluginPath: setting.pluginPath || ''
      });
      setDashboardBackgroundImage(setting.dashboardBackgroundImage || '');
      
      // 找到当前激活的引擎
      const engines = setting.aiEngines || [];
      const engine = engines.find(e => e.id === setting.activeEngineId) || engines[0];
      setActiveEngine(engine);
      
      form.setFieldsValue({
        theme,
        animation: animationEnabled,
        compact: compactMode,
        autoOptimize: false,
        optimizeLevel: 'light',
        backupBeforeOptimize: true,
        debugMode: setting.debugMode || false,
        logLevel: setting.logLevel || 'info',
        api_url: engine?.api_url || 'http://127.0.0.1:5000',
        api_key: engine?.api_key || '',
        model_name: engine?.model_name || 'qwen3.5-27b-heretic-v3',
        api_mode: engine?.api_mode || 'text_completion',
        api_key_transmission: engine?.api_key_transmission || 'body',
        max_tokens: engine?.max_tokens || 10240,
        temperature: engine?.temperature ?? 0.7,
        top_p: engine?.top_p ?? 0.95,
        top_k: engine?.top_k ?? 0,
        min_p: engine?.min_p ?? 0.1,
        frequency_penalty: engine?.frequency_penalty ?? 0,
        presence_penalty: engine?.presence_penalty ?? 0,
        n: engine?.n ?? 1,
        system_prompt: engine?.system_prompt || '',
        worldBookPath: setting.worldBookPath || '',
        characterPath: setting.characterPath || '',
        avatarPath: setting.avatarPath || '',
        creativePath: setting.creativePath || '',
        memoryPath: setting.memoryPath || '',
        pluginPath: setting.pluginPath || ''
      });
    }
  }, [setting, theme, animationEnabled, compactMode, form]);

  // 处理路径选择
  const handleSelectDirectory = async (field: string) => {
    try {
      const result = await window.electronAPI.file.selectDirectory();
      if (result) {
        setPaths(prev => ({
          ...prev,
          [field]: result
        }));
        form.setFieldValue(field, result);
      }
    } catch (error) {
      addLog('选择目录失败', 'error', {
        category: 'user',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:82:handleSelectDirectory',
          field: field,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '选择目录时发生错误，请检查文件系统权限。'
      });
      message.error('选择目录失败');
    }
  };

  // 处理路径重置
  const handleResetPath = (field: string) => {
    let defaultPath = '';
    switch (field) {
      case 'worldBookPath':
        defaultPath = '__USER_DATA__/data/worldbooks';
        break;
      case 'characterPath':
        defaultPath = '__USER_DATA__/data/characters';
        break;
      case 'avatarPath':
        defaultPath = '__USER_DATA__/data/avatars';
        break;
      case 'creativePath':
        defaultPath = '__USER_DATA__/data/creatives';
        break;
      case 'memoryPath':
        defaultPath = '__USER_DATA__/data/memories';
        break;
      case 'pluginPath':
        defaultPath = '__USER_DATA__/data/plugins';
        break;
      default:
        break;
    }
    setPaths(prev => ({
      ...prev,
      [field]: defaultPath
    }));
    form.setFieldValue(field, defaultPath);
    message.info(`已重置${field}为默认路径`);
  };

  // 处理路径验证
  const handleValidatePath = async (field: string) => {
    const targetPath = paths[field as keyof typeof paths];
    if (!targetPath) {
      setPathValidation(prev => ({ ...prev, [field]: { valid: false, message: '路径为空' } }));
      return;
    }
    try {
      addLog(`开始验证路径 (${field}): ${targetPath}`, 'info');
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      addLog(`用户数据目录: ${userDataPath}`, 'info');
      const resolvedPath = targetPath.replace('__USER_DATA__', userDataPath);
      addLog(`解析后路径: ${resolvedPath}`, 'info');
      const result = await window.electronAPI.file.validatePath(resolvedPath);
      addLog(`路径验证结果: ${JSON.stringify(result)}`, 'info');
      setPathValidation(prev => ({
        ...prev,
        [field]: {
          valid: result.valid,
          message: result.exists
            ? (result.valid ? '路径有效' : result.error || '路径无效')
            : '路径不存在，保存后自动创建'
        }
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      addLog(`路径验证失败 (${field}): ${errorMsg}`, 'error');
      setPathValidation(prev => ({ ...prev, [field]: { valid: false, message: `验证失败: ${errorMsg}` } }));
    }
  };

  // 处理图片上传
  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setDashboardBackgroundImage(result);
      message.success('图片上传成功');
    };
    reader.readAsDataURL(file);
    return false;
  };

  // 处理删除图片
  const handleRemoveImage = () => {
    setDashboardBackgroundImage('');
    message.info('已删除背景图片');
  };

  const handleOpenFolder = async (pathValue: string) => {
    if (!pathValue) return;
    try {
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = pathValue.replace('__USER_DATA__', userDataPath);
      window.electronAPI.file.openFolder(resolvedPath);
    } catch {
      // ignore
    }
  };

  const handleOpenConfigFile = async () => {
    try {
      const result = await window.electronAPI.app.openConfigFile();
      if (!result) {
        message.warning('无法打开配置文件，请检查文件是否存在');
      }
    } catch (error) {
      message.error(`打开配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 处理保存设置
  const handleSave = async () => {
    try {
      addLog('开始保存设置', 'info');
      const values = await form.validateFields();
      addLog(`表单验证成功: ${JSON.stringify(values)}`, 'info');
      
      if (setting && activeEngine) {
        addLog(`当前设置: ${JSON.stringify(setting)}`, 'info');
        
        // 更新当前激活的引擎配置
        const updatedEngines = (setting.aiEngines || []).map(engine => {
          if (engine.id === activeEngine.id) {
            return {
              ...engine,
              api_url: values.api_url || 'http://127.0.0.1:5000',
              api_key: values.api_key || '',
              model_name: values.model_name || 'qwen3.5-27b-heretic-v3',
              api_mode: values.api_mode || 'text_completion',
              api_key_transmission: values.api_key_transmission || 'body',
              max_tokens: values.max_tokens || 10240,
              temperature: values.temperature ?? 0.7,
              top_p: values.top_p ?? 0.95,
              top_k: values.top_k ?? 0,
              min_p: values.min_p ?? 0.1,
              frequency_penalty: values.frequency_penalty ?? 0,
              presence_penalty: values.presence_penalty ?? 0,
              n: values.n ?? 1,
              system_prompt: values.system_prompt || ''
            };
          }
          return engine;
        });
        
        // 合并向量配置
        const vectorConfig = vectorConfigRef.current?.getFormValues() || {};
        
        // 创建一个简化的设置对象，只包含必要的属性
        const updatedSetting = {
          ...setting,
          aiEngines: updatedEngines,
          worldBookPath: values.worldBookPath,
          characterPath: values.characterPath,
          avatarPath: values.avatarPath,
          creativePath: values.creativePath,
          memoryPath: values.memoryPath,
          pluginPath: values.pluginPath,
          logLevel: values.logLevel || 'info',
          dashboardBackgroundImage: dashboardBackgroundImage,
          debugMode: debugMode,
          vector: vectorConfig,
          autoOptimize: values.autoOptimize ?? false,
          optimizeLevel: values.optimizeLevel ?? 'light',
          backupBeforeOptimize: values.backupBeforeOptimize ?? true,
        };
        
        addLog(`更新后的设置: ${JSON.stringify(updatedSetting)}`, 'info');
        
        // 尝试保存设置
        try {
          addLog('开始保存设置', 'info');
          await saveSetting(updatedSetting);
          addLog('设置保存成功', 'info');
          
          // 更新角色卡目录
          if (values.characterPath) {
            addLog(`更新角色卡目录: ${values.characterPath}`, 'info');
            try {
              const setDirectoryResult = await window.electronAPI.character.setDirectory(values.characterPath);
              addLog(`角色卡目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');
              if (setDirectoryResult.success) {
                addLog(`角色卡目录更新成功，最终路径: ${setDirectoryResult.characterDir}`, 'success');
              } else {
                addLog('角色卡目录更新失败', 'error');
              }
            } catch (setDirectoryError) {
              addLog(`更新角色卡目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
            }
          }
          
          // 更新世界书目录
          if (values.worldBookPath) {
            addLog(`更新世界书目录: ${values.worldBookPath}`, 'info');
            try {
              const setDirectoryResult = await window.electronAPI.worldBook.setDirectory(values.worldBookPath);
              addLog(`世界书目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');
              if (setDirectoryResult.success) {
                addLog(`世界书目录更新成功，最终路径: ${setDirectoryResult.worldBookDir}`, 'success');
              } else {
                addLog('世界书目录更新失败', 'error');
              }
            } catch (setDirectoryError) {
              addLog(`更新世界书目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
            }
          }
          
          // 更新用户设定目录
          if (values.avatarPath) {
            addLog(`更新用户设定目录: ${values.avatarPath}`, 'info');
            try {
              const setDirectoryResult = await window.electronAPI.avatar.setDirectory(values.avatarPath);
              addLog(`用户设定目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');
            } catch (setDirectoryError) {
              addLog(`更新用户设定目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
            }
          }
          
          // 更新记忆目录
          if (values.memoryPath) {
            addLog(`更新记忆目录: ${values.memoryPath}`, 'info');
            try {
              const setDirectoryResult = await window.electronAPI.memory.setDirectory(values.memoryPath);
              addLog(`记忆目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');
            } catch (setDirectoryError) {
              addLog(`更新记忆目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
            }
          }
          
          // 更新插件目录
          if (values.pluginPath) {
            addLog(`更新插件目录: ${values.pluginPath}`, 'info');
            try {
              const setDirectoryResult = await window.electronAPI.plugin.setDirectory(values.pluginPath);
              addLog(`插件目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');
            } catch (setDirectoryError) {
              addLog(`更新插件目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
            }
          }
          
          // 更新创意目录
          if (values.creativePath) {
            addLog(`更新创意目录: ${values.creativePath}`, 'info');
            try {
              const setDirectoryResult = await window.electronAPI.creative.setDirectory(values.creativePath);
              addLog(`创意目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');
            } catch (setDirectoryError) {
              addLog(`更新创意目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
            }
          }
          
          message.success('设置保存成功');
        } catch (saveError) {
          addLog('保存设置异常', 'error', {
            category: 'setting',
            error: saveError instanceof Error ? saveError : undefined,
            context: {
              errorType: saveError instanceof Error ? saveError.name : 'UnknownError',
              errorLocation: 'Settings.tsx:234:handleSave',
              errorMessage: saveError instanceof Error ? saveError.message : 'Unknown error'
            },
            details: '保存设置时发生异常，请检查设置值是否正确。'
          });
          message.error(`保存设置异常: ${saveError instanceof Error ? saveError.message : '未知错误'}`);
        }
      } else {
        addLog('设置为null', 'error');
        message.error('设置未加载');
      }
    } catch (error) {
      addLog('保存设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:242:handleSave',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '保存设置时发生错误，请检查设置值是否正确。'
      });
      message.error(`设置保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 处理重置设置
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
          errorLocation: 'Settings.tsx:254:handleReset',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '重置设置时发生错误，请检查文件系统权限。'
      });
      message.error('重置设置失败');
    }
  };
  
  // 处理引擎切换
  const handleEngineChange = (engineId: string) => {
    if (setting) {
      const updatedSetting = {
        ...setting,
        activeEngineId: engineId
      };
      saveSetting(updatedSetting);
    }
  };
  
  // 处理添加新引擎
  const handleAddEngine = () => {
    addLog('准备添加新引擎', 'info');
    const emptyEngine: Partial<AIEngineSetting> = {
      name: '新引擎',
      api_url: 'http://127.0.0.1:5000',
      api_key: '',
      model_name: 'qwen3.5-27b-heretic-v3',
      api_mode: 'text_completion',
      api_key_transmission: 'body',
      max_tokens: 10240,
      temperature: 0.7,
      top_p: 0.95,
      top_k: 0,
      min_p: 0.1,
      frequency_penalty: 0,
      presence_penalty: 0,
      n: 1,
      system_prompt: ''
    };
    setEditingEngine(emptyEngine as AIEngineSetting);
    engineForm.resetFields();
    engineForm.setFieldsValue(emptyEngine);
    setShowEngineModal(true);
  };
  
  // 处理编辑引擎
  const handleEditEngine = (engine: AIEngineSetting) => {
    setEditingEngine(engine);
    engineForm.setFieldsValue(engine);
    setShowEngineModal(true);
  };
  
  // 处理保存引擎
  const handleSaveEngine = async () => {
    try {
      addLog('开始保存引擎配置', 'info');
      const values = await engineForm.validateFields();
      addLog(`表单验证成功: ${JSON.stringify(values)}`, 'debug');
      
      if (setting) {
        let updatedEngines = [...(setting.aiEngines || [])];
        
        if (editingEngine && editingEngine.id) {
          // 更新现有引擎
          addLog(`更新现有引擎: ${editingEngine.id}`, 'info');
          updatedEngines = updatedEngines.map(engine => {
            if (engine.id === editingEngine.id) {
              return { ...engine, ...values };
            }
            return engine;
          });
        } else {
          // 添加新引擎
          addLog('添加新引擎', 'info');
          const defaultEngine = AppSetting.defaultSetting.aiEngines[0];
          const newEngine: AIEngineSetting = {
            ...defaultEngine,
            id: `engine_${Date.now()}`,
            name: values.name || '新引擎',
            api_url: values.api_url || 'http://127.0.0.1:5000',
            api_key: values.api_key || '',
            model_name: values.model_name || 'qwen3.5-27b-heretic-v3',
            api_mode: values.api_mode || 'text_completion',
            api_key_transmission: values.api_key_transmission || 'body',
            ...values,
          };
          updatedEngines.push(newEngine);
        }
        
        const updatedSetting = {
          ...setting,
          aiEngines: updatedEngines
        };
        
        addLog(`保存设置前检查: ${JSON.stringify(updatedSetting).length} bytes`, 'debug');
        await saveSetting(updatedSetting);
        addLog('设置保存成功', 'success');
        
        // 关闭模态框前重置状态
        setShowEngineModal(false);
        setEditingEngine(null);
        engineForm.resetFields();
        
        message.success(editingEngine?.id ? '引擎更新成功' : '引擎添加成功');
      } else {
        addLog('设置为 null，无法保存', 'error');
        message.error('设置未加载，请刷新页面后重试');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      addLog('保存引擎失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:462:handleSaveEngine',
          errorMessage: errorMessage
        },
        details: '保存引擎配置时发生错误，请检查引擎配置是否正确。'
      });
      message.error(`保存引擎失败: ${errorMessage}`);
    }
  };
  
  // 处理删除引擎
  const handleDeleteEngine = (engineId: string) => {
    if (setting) {
      const engines = setting.aiEngines || [];
      if (engines.length <= 1) {
        message.error('至少需要保留一个引擎设置');
        return;
      }
      
      let updatedEngines = engines.filter(engine => engine.id !== engineId);
      let activeEngineId = setting.activeEngineId;
      let defaultEngineId = setting.defaultEngineId;
      
      // 如果删除的是当前激活的引擎，切换到第一个引擎
      if (activeEngineId === engineId) {
        activeEngineId = updatedEngines[0].id;
      }
      
      // 如果删除的是默认引擎，设置第一个引擎为默认
      if (defaultEngineId === engineId) {
        defaultEngineId = updatedEngines[0].id;
      }
      
      const updatedSetting = {
        ...setting,
        aiEngines: updatedEngines,
        activeEngineId,
        defaultEngineId
      };
      
      saveSetting(updatedSetting);
      message.success('引擎删除成功');
    }
  };
  
  // 处理设置默认引擎
  const handleSetDefaultEngine = (engineId: string) => {
    if (setting) {
      const updatedSetting = {
        ...setting,
        defaultEngineId: engineId
      };
      saveSetting(updatedSetting);
      message.success('默认引擎设置成功');
    }
  };
  
  // 处理测试连通性
  const handleTestConnection = async () => {
    try {
      const values = await form.validateFields();
      setTestResult(null);
      addLog('开始测试 AI 引擎连通性', 'info');
      addLog(`API 密钥传输方式: ${values.api_key_transmission || 'body'}`, 'info');
      
      // 构建测试配置
      const testSetting = {
        ...setting,
        aiEngines: [
          {
            id: 'test_engine',
            name: '测试引擎',
            api_url: values.api_url,
            api_key: values.api_key,
            model_name: values.model_name,
            api_mode: values.api_mode,
            api_key_transmission: values.api_key_transmission
          }
        ],
        activeEngineId: 'test_engine'
      };
      
      // 添加详细的调试日志
      addLog('测试配置详细信息', 'debug', {
        context: {
          api_url: values.api_url,
          model_name: values.model_name,
          api_mode: values.api_mode,
          api_key_transmission: values.api_key_transmission,
          api_key_length: values.api_key ? values.api_key.length : 0
        }
      });
      
      // 显示加载消息
      const loadingMessage = message.loading('正在测试连通性...', 0);
      
      // 调用 testConnection 函数进行实际测试
      addLog('开始调用 testConnection 函数', 'debug');
      const result = await testConnection(testSetting);
      setTestResult(result);
      addLog('testConnection 函数调用完成', 'debug', {
        context: { success: result.success, details: result.details }
      });
      
      // 关闭加载消息
      loadingMessage();
      
      if (result.success) {
        addLog('AI 引擎连通性测试成功', 'success');
        message.success(`连接测试成功：${result.details || '成功'}`);
      } else {
        addLog('AI 引擎连通性测试失败', 'error');
        message.error('连接测试失败');
      }
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        details: `异常: ${error instanceof Error ? error.message : '未知错误'}`
      });
      addLog('测试连通性失败', 'error', {
        category: 'ai',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:571:handleTestConnection',
          error_message: error instanceof Error ? error.message : String(error),
          error_stack: error instanceof Error ? error.stack : undefined
        },
        details: '测试AI引擎连通性时发生错误，请检查API地址和API密钥是否正确。'
      });
      message.error('测试连通性失败');
    }
  };

  return (
    <div className="settings">
      <div className="settings-content">
        <h2>设置</h2>

        <Card title="外观设置">
        <Form form={form} layout="vertical">
          <Form.Item label="主题" name="theme">
            <Select
              value={theme}
              onChange={(value) => setTheme(value)}
              options={[
                { label: '亮色', value: 'light' },
                { label: '暗色', value: 'dark' }
              ]}
            />
          </Form.Item>

          <Form.Item label="启用动画" name="animation" valuePropName="checked" initialValue={true}>
            <Switch 
              checked={animationEnabled}
              onChange={(checked) => setAnimationEnabled(checked)}
            />
          </Form.Item>

          <Form.Item label="紧凑模式" name="compact" valuePropName="checked" initialValue={false}>
            <Switch 
              checked={compactMode}
              onChange={(checked) => setCompactMode(checked)}
            />
          </Form.Item>

          <Form.Item label="仪表盘背景图片">
            {dashboardBackgroundImage ? (
              <div style={{ marginBottom: 16 }}>
                <img
                  src={dashboardBackgroundImage}
                  alt="预览"
                  style={{ 
                    maxWidth: '100%', 
                    maxHeight: 200, 
                    objectFit: 'contain',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    marginBottom: 8
                  }}
                />
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleRemoveImage}
                >
                  删除图片
                </Button>
              </div>
            ) : (
              <Upload
                beforeUpload={handleImageUpload}
                showUploadList={false}
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              >
                <Button icon={<UploadOutlined />}>
                  选择图片
                </Button>
              </Upload>
            )}
          </Form.Item>
        </Form>
      </Card>

      <Card title="路径设置" style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
            所有路径默认存储在用户数据目录下。支持使用 <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>__USER_DATA__</code> 作为基础路径占位符。路径不存在时保存后会自动创建。
          </p>
        </div>
        <Form form={form} layout="vertical">
          {['worldBookPath', 'characterPath', 'avatarPath', 'creativePath', 'memoryPath', 'pluginPath'].map((field) => {
            const labels: Record<string, string> = {
              worldBookPath: '世界书存储',
              characterPath: '角色卡存储',
              avatarPath: '用户人设存储',
              creativePath: '创意存储',
              memoryPath: '记忆存储',
              pluginPath: '插件存储'
            };
            const validation = pathValidation[field];
            return (
              <Form.Item label={labels[field]} name={field} key={field} style={{ marginBottom: 16 }}>
                <Space style={{ width: '100%' }} align="baseline">
                  <Input 
                    style={{ flex: 1 }} 
                    value={paths[field as keyof typeof paths]} 
                    onChange={(e) => {
                      setPaths(prev => ({ ...prev, [field]: e.target.value }));
                      form.setFieldValue(field, e.target.value);
                      setPathValidation(prev => { const n = { ...prev }; delete n[field]; return n; });
                    }}
                    placeholder={`请输入${labels[field]}路径`}
                  />
                  <Button 
                    icon={<FolderOutlined />} 
                    onClick={() => handleSelectDirectory(field)}
                  >
                    浏览
                  </Button>
                  <Button 
                    icon={<UndoOutlined />} 
                    onClick={() => handleResetPath(field)}
                  >
                    重置
                  </Button>
                  <Button 
                    icon={validation ? (validation.valid ? <CheckCircleOutlined style={{ color: '#22c55e' }} /> : <CloseCircleOutlined style={{ color: '#ef4444' }} />) : null}
                    onClick={() => handleValidatePath(field)}
                    loading={validation?.message === '验证中...'}
                  >
                    {validation ? (validation.valid ? '有效' : '无效') : '验证'}
                  </Button>
                  {validation && (
                    <span style={{ fontSize: '12px', color: validation.valid ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>
                      {validation.message}
                    </span>
                  )}
                </Space>
              </Form.Item>
            );
          })}
        </Form>
      </Card>

      <Card title="优化设置" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item label="自动优化" name="autoOptimize" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>

          <Form.Item label="优化级别" name="optimizeLevel">
            <Select
              options={[
                { label: '轻度', value: 'light' },
                { label: '中度', value: 'medium' },
                { label: '深度', value: 'deep' }
              ]}
            />
          </Form.Item>

          <Form.Item label="备份优化前的数据" name="backupBeforeOptimize" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Card>

      <Card title="AI引擎设置" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item label="引擎选择">
            <Space style={{ width: '100%' }}>
              <Select
                style={{ flex: 1, minWidth: '200px' }}
                value={setting?.activeEngineId}
                onChange={handleEngineChange}
                options={(setting?.aiEngines ?? []).map(engine => ({
                  label: engine.name,
                  value: engine.id
                }))}
                placeholder="请选择 AI 引擎"
              />
              <Button
                icon={<SettingOutlined />}
                onClick={() => setShowEngineModal(true)}
              >
                管理引擎
              </Button>
            </Space>
          </Form.Item>

          <Form.Item label="API地址" name="api_url">
            <Input placeholder="例如: http://127.0.0.1:5000" />
          </Form.Item>

          <Form.Item label="API密钥" name="api_key">
            <Input.Password placeholder="请输入API密钥（可选）" />
          </Form.Item>

          <Form.Item label="模型名称" name="model_name">
            <Input placeholder="例如: qwen3.5-27b-heretic-v3" />
          </Form.Item>

          <Form.Item label="API模式" name="api_mode">
            <Select
              options={[
                { label: '文本补全', value: 'text_completion' },
                { label: '聊天补全', value: 'chat_completion' }
              ]}
            />
          </Form.Item>

          <Form.Item label="API密钥传输方式" name="api_key_transmission">
            <Select
              options={[
                { label: '请求头 (Authorization: Bearer)', value: 'header' },
                { label: '请求体', value: 'body' }
              ]}
            />
          </Form.Item>

          <Form.Item label="最大令牌数 (max_tokens)" name="max_tokens">
            <Input type="number" min={1} max={100000} placeholder="例如: 10240" />
          </Form.Item>

          <Form.Item label="温度参数 (temperature)" name="temperature">
            <Input type="number" min={0} max={2} step={0.1} placeholder="例如: 0.7" />
          </Form.Item>

          <Form.Item label="Top P (top_p)" name="top_p">
            <Input type="number" min={0} max={1} step={0.05} placeholder="例如: 0.95" />
          </Form.Item>

          <Form.Item label="Top K (top_k)" name="top_k">
            <Input type="number" min={0} max={200} step={1} placeholder="例如: 40" />
          </Form.Item>

          <Form.Item label="Min P (min_p)" name="min_p">
            <Input type="number" min={0} max={1} step={0.05} placeholder="例如: 0.1" />
          </Form.Item>

          <Form.Item label="频率惩罚 (frequency_penalty)" name="frequency_penalty">
            <Input type="number" min={-2} max={2} step={0.1} placeholder="例如: 0" />
          </Form.Item>

          <Form.Item label="存在惩罚 (presence_penalty)" name="presence_penalty">
            <Input type="number" min={-2} max={2} step={0.1} placeholder="例如: 0" />
          </Form.Item>

          <Form.Item label="生成数量 (n)" name="n">
            <Input type="number" min={1} max={10} step={1} placeholder="例如: 1" />
          </Form.Item>

          <Form.Item label="系统提示词 (system_prompt)" name="system_prompt">
            <Input.TextArea 
              rows={4} 
              placeholder="输入系统提示词，用于设置 AI 的行为和角色" 
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" onClick={handleTestConnection} icon={<SyncOutlined />}>
                测试连通性
              </Button>
              {activeEngine && activeEngine.api_url && (
                <span style={{ color: '#666', fontSize: 12 }}>
                  目标: {activeEngine.api_url}
                </span>
              )}
            </Space>
          </Form.Item>

          {testResult && (
            <div style={{ marginBottom: 16 }}>
              <Alert
                message={testResult.success ? 'AI 引擎连接测试成功' : 'AI 引擎连接测试失败'}
                description={
                  <div>
                    <p><strong>API 地址:</strong> {activeEngine?.api_url || 'N/A'}</p>
                    <p><strong>模型名称:</strong> {testResult.model || activeEngine?.model_name || 'N/A'}</p>
                    <p><strong>响应时间:</strong> {testResult.responseTime ? `${testResult.responseTime}ms` : 'N/A'}</p>
                    <p><strong>详细信息:</strong> {testResult.details || '无'}</p>
                    {testResult.error && <p style={{ color: 'red', marginTop: 8 }}><strong>错误:</strong> {testResult.error}</p>}
                  </div>
                }
                type={testResult.success ? 'success' : 'error'}
                showIcon
                closable
                onClose={() => setTestResult(null)}
              />
            </div>
          )}
        </Form>
      </Card>

      <Card title="高级设置" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item label="启用调试模式" name="debugMode" valuePropName="checked" initialValue={setting?.debugMode || false}>
            <Switch 
              checked={debugMode}
              onChange={(checked) => setDebugMode(checked)}
            />
          </Form.Item>

          <Form.Item label="日志级别" name="logLevel">
            <Select
              options={[
                { label: '错误', value: 'error' },
                { label: '警告', value: 'warn' },
                { label: '信息', value: 'info' },
                { label: '调试', value: 'debug' }
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

      <VectorConfigPanel ref={vectorConfigRef} />

      <Divider />

      <Space>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          保存设置
        </Button>
        <Button icon={<FileTextOutlined />} onClick={handleOpenConfigFile}>
          打开配置文件
        </Button>
        <Button icon={<ReloadOutlined />} onClick={handleReset}>
          重置设置
        </Button>
      </Space>

      {/* AI 引擎管理模态框 */}
      <Modal
        title={editingEngine && editingEngine.id ? '编辑引擎' : editingEngine ? '添加新引擎' : 'AI 引擎管理'}
        open={showEngineModal}
        onCancel={() => setShowEngineModal(false)}
        footer={[
          <Button key="cancel" onClick={() => setShowEngineModal(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" icon={<SaveOutlined />} onClick={handleSaveEngine}>
            {editingEngine?.id ? '保存修改' : '添加引擎'}
          </Button>
        ].filter(Boolean)}
        width={800}
      >
        {!editingEngine ? (
          <div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddEngine}
              style={{ marginBottom: 16 }}
            >
              添加新引擎
            </Button>
            <Table
              dataSource={setting?.aiEngines || []}
              rowKey="id"
              columns={[
                {
                  title: '引擎名称',
                  dataIndex: 'name',
                  key: 'name'
                },
                {
                  title: 'API地址',
                  dataIndex: 'api_url',
                  key: 'api_url',
                  ellipsis: true
                },
                {
                  title: '模型名称',
                  dataIndex: 'model_name',
                  key: 'model_name',
                  ellipsis: true
                },
                {
                  title: 'API模式',
                  dataIndex: 'api_mode',
                  key: 'api_mode',
                  render: (mode) => mode === 'text_completion' ? '文本补全' : '聊天补全'
                },
                {
                  title: '状态',
                  key: 'status',
                  render: (_, record) => (
                    <Space>
                      {record.id === setting?.activeEngineId && <span style={{ color: 'blue' }}>当前激活</span>}
                      {record.id === setting?.defaultEngineId && <span style={{ color: 'green' }}>默认</span>}
                    </Space>
                  )
                },
                {
                  title: '操作',
                  key: 'action',
                  render: (_, record) => (
                    <Space size="middle">
                      <Button
                        icon={<EditOutlined />}
                        onClick={() => handleEditEngine(record)}
                      >
                        编辑
                      </Button>
                      <Button
                        danger
                        onClick={() => handleDeleteEngine(record.id)}
                      >
                        删除
                      </Button>
                      {record.id !== setting?.defaultEngineId && (
                        <Button
                          onClick={() => handleSetDefaultEngine(record.id)}
                        >
                          设置默认
                        </Button>
                      )}
                    </Space>
                  )
                }
              ]}
            />
          </div>
        ) : (
          <Form form={engineForm} layout="vertical">
            <Form.Item label="引擎名称" name="name" rules={[{ required: true, message: '请输入引擎名称' }]}>
              <Input placeholder="请输入引擎名称" />
            </Form.Item>
            <Form.Item label="API地址" name="api_url" rules={[{ required: true, message: '请输入API地址' }]}>
              <Input placeholder="例如: http://127.0.0.1:5000" />
            </Form.Item>
            <Form.Item label="API密钥" name="api_key">
              <Input.Password placeholder="请输入API密钥（可选）" />
            </Form.Item>
            <Form.Item label="模型名称" name="model_name" rules={[{ required: true, message: '请输入模型名称' }]}>
              <Input placeholder="例如: qwen3.5-27b-heretic-v3" />
            </Form.Item>
            <Form.Item label="API模式" name="api_mode" rules={[{ required: true, message: '请选择API模式' }]}>
              <Select
                options={[
                  { label: '文本补全', value: 'text_completion' },
                  { label: '聊天补全', value: 'chat_completion' }
                ]}
              />
            </Form.Item>
            <Form.Item label="最大令牌数 (max_tokens)" name="max_tokens">
              <Input type="number" min={1} max={100000} placeholder="例如: 10240" />
            </Form.Item>
            <Form.Item label="温度参数 (temperature)" name="temperature">
              <Input type="number" min={0} max={2} step={0.1} placeholder="例如: 0.7" />
            </Form.Item>
            <Form.Item label="Top P (top_p)" name="top_p">
              <Input type="number" min={0} max={1} step={0.05} placeholder="例如: 0.95" />
            </Form.Item>
            <Form.Item label="Top K (top_k)" name="top_k">
              <Input type="number" min={0} max={200} step={1} placeholder="例如: 40" />
            </Form.Item>
            <Form.Item label="Min P (min_p)" name="min_p">
              <Input type="number" min={0} max={1} step={0.05} placeholder="例如: 0.1" />
            </Form.Item>
            <Form.Item label="频率惩罚 (frequency_penalty)" name="frequency_penalty">
              <Input type="number" min={-2} max={2} step={0.1} placeholder="例如: 0" />
            </Form.Item>
            <Form.Item label="存在惩罚 (presence_penalty)" name="presence_penalty">
              <Input type="number" min={-2} max={2} step={0.1} placeholder="例如: 0" />
            </Form.Item>
            <Form.Item label="生成数量 (n)" name="n">
              <Input type="number" min={1} max={10} step={1} placeholder="例如: 1" />
            </Form.Item>
            <Form.Item label="系统提示词 (system_prompt)" name="system_prompt">
              <Input.TextArea 
                rows={4} 
                placeholder="输入系统提示词，用于设置 AI 的行为和角色" 
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
      </div>
    </div>
  );
};

export default Settings;
