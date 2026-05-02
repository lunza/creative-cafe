import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Modal, message, Popconfirm, Tag, Typography, Input, Checkbox } from 'antd';
import {
  TranslationOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  UploadOutlined,
  UserOutlined,
  RobotOutlined,
  ExperimentOutlined
} from '@ant-design/icons';
import { useDataStore } from '../../stores/dataStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { AppSetting } from '../../settings';
import { ensurePositiveInteger } from '../../utils/requestParamUtils';
import { sendCharacterAIRequest } from '../../utils/characterAIUtils';
import type { ColumnsType } from 'antd/es/table';
import ReactMarkdown from 'react-markdown';
import { CharacterTestChat } from './CharacterTestChat';
import type { CharacterInfo } from './CharacterTestChat';
import { WorldBookRelationPanel } from './WorldBookRelationPanel';
import { useWorldBookStore } from '../../stores/worldBookStore';
import './CharacterManager.css';

const { Text } = Typography;

interface Character {
  name: string;
  path: string;
  size: number;
  modified: Date;
  characterName?: string;
  version?: string;
  creator?: string;
  tags?: string[];
  cardVersion?: 'v1' | 'v2' | 'v3';
}

const thumbnailCache: Map<string, string> = new Map();
const thumbnailErrorCache: Map<string, boolean> = new Map();

const ThumbnailImage: React.FC<{ filePath: string; name: string; size?: number }> = ({ filePath, name, size = 60 }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(thumbnailCache.get(filePath) || null);
  const [loading, setLoading] = useState(thumbnailCache.has(filePath) ? false : true);
  const [error, setError] = useState(thumbnailErrorCache.get(filePath) || false);

  useEffect(() => {
    if (thumbnailCache.has(filePath)) {
      setImageSrc(thumbnailCache.get(filePath) || null);
      setLoading(false);
      setError(thumbnailErrorCache.get(filePath) || false);
      return;
    }

    let cancelled = false;
    let retryTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const load = async (retryCount: number = 0) => {
      setLoading(true);
      setError(false);

      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (!cancelled && !thumbnailCache.has(filePath)) {
          setLoading(false);
          setError(true);
          thumbnailErrorCache.set(filePath, true);
        }
      }, 5000);

      try {
        const result = await window.electronAPI.file.readAsBase64(filePath);
        if (!cancelled) {
          if (result && result.success && result.data) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            thumbnailCache.set(filePath, result.data);
            setImageSrc(result.data);
            setLoading(false);
            setError(false);
            thumbnailErrorCache.set(filePath, false);
          } else if (retryCount < 2) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            retryTimer = setTimeout(() => load(retryCount + 1), 500);
          } else {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            setLoading(false);
            setError(true);
            thumbnailErrorCache.set(filePath, true);
          }
        }
      } catch (error) {
        if (!cancelled) {
          if (retryCount < 2) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            retryTimer = setTimeout(() => load(retryCount + 1), 500);
          } else {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            setLoading(false);
            setError(true);
            thumbnailErrorCache.set(filePath, true);
          }
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
  }, [filePath]);

  if (loading) {
    return (
      <div style={{ width: size, height: size, borderRadius: 4, backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingOutlined style={{ fontSize: 16, color: '#999' }} spin />
      </div>
    );
  }

  if (error || !imageSrc) {
    return (
      <div style={{ width: size, height: size, borderRadius: 4, backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <UserOutlined style={{ fontSize: 24, color: '#999' }} />
      </div>
    );
  }

  return (
    <img 
      src={imageSrc} 
      alt={name} 
      style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover' }}
    />
  );
};

const avatarCache: Map<string, string> = new Map();
const avatarErrorCache: Map<string, boolean> = new Map();

const AvatarImage: React.FC<{ filePath: string; name: string; fallbackSrc?: string }> = ({ filePath, name, fallbackSrc }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(avatarCache.get(filePath) || null);
  const [loading, setLoading] = useState(avatarCache.has(filePath) ? false : true);
  const [error, setError] = useState(avatarErrorCache.get(filePath) || false);

  useEffect(() => {
    if (avatarCache.has(filePath)) {
      setImageSrc(avatarCache.get(filePath) || null);
      setLoading(false);
      setError(avatarErrorCache.get(filePath) || false);
      return;
    }

    let cancelled = false;
    let retryTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const load = async (retryCount: number = 0) => {
      setLoading(true);
      setError(false);

      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (!cancelled && !avatarCache.has(filePath)) {
          setLoading(false);
          setError(true);
          avatarErrorCache.set(filePath, true);
        }
      }, 5000);

      try {
        const result = await window.electronAPI.file.readAsBase64(filePath);
        if (!cancelled) {
          if (result && result.success && result.data) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            avatarCache.set(filePath, result.data);
            setImageSrc(result.data);
            setLoading(false);
            setError(false);
            avatarErrorCache.set(filePath, false);
          } else if (retryCount < 2) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            retryTimer = setTimeout(() => load(retryCount + 1), 500);
          } else {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            setLoading(false);
            setError(true);
            avatarErrorCache.set(filePath, true);
          }
        }
      } catch (error) {
        if (!cancelled) {
          if (retryCount < 2) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            retryTimer = setTimeout(() => load(retryCount + 1), 500);
          } else {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            setLoading(false);
            setError(true);
            avatarErrorCache.set(filePath, true);
          }
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
  }, [filePath]);

  if (loading) {
    return (
      <div style={{ flex: '0 0 200px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)', minHeight: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' }}>
        <LoadingOutlined style={{ fontSize: 24, color: '#999' }} spin />
      </div>
    );
  }

  const src = imageSrc || fallbackSrc;
  if (error || !src) {
    return null;
  }

  return (
    <div style={{ flex: '0 0 200px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
      <img 
        src={src} 
        alt={name} 
        style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
      />
    </div>
  );
};

const CharacterManager: React.FC = () => {
  const { characters, loading, fetchCharacters, optimizeCharacter } = useDataStore();
  const { worldBooks, fetchWorldBooks } = useWorldBookStore();
  const { theme: appTheme } = useUIStore();
  const { setting, fetchSetting } = useSettingStore();
  const { addLog } = useLogStore();
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<Character | null>(null);
  const [editingItem, setEditingItem] = useState<Character | null>(null);
  const [characterContent, setCharacterContent] = useState<any>(null);
  const [editingContent, setEditingContent] = useState<any>(null);
  const [formValues, setFormValues] = useState<any>({});
  const [originalValues, setOriginalValues] = useState<any>({});
  const [translatingField, setTranslatingField] = useState<string | null>(null);
  const [polishingField, setPolishingField] = useState<string | null>(null);
  const [generatingField, setGeneratingField] = useState<string | null>(null);
  const [characterDir, setCharacterDir] = useState<string>('');
  const [polishRequirements, setPolishRequirements] = useState<string>('');
  const [isPolishModalOpen, setIsPolishModalOpen] = useState<boolean>(false);
  const [worldBookRelations, setWorldBookRelations] = useState<any[]>([]);

  // 获取当前激活的AI引擎配置
  const getActiveEngineConfig = () => {
    if (!setting) return null;
    
    // 从设置中获取当前激活的引擎
    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      if (activeEngine) {
        return activeEngine;
      }
    }
    
    // 如果没有激活的引擎，返回第一个引擎
    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }
    
    return null;
  };

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  useEffect(() => {
    // 从主进程获取角色卡目录路径
    const getCharacterDir = async () => {
      try {
        const dir = await window.electronAPI.character.getDirectory();
        setCharacterDir(dir);
      } catch (error) {
        addLog(`获取角色卡目录失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    };
    getCharacterDir();
    fetchCharacters();
  }, [fetchCharacters, addLog]);

  const handleOptimize = async (path: string) => {
    addLog(`[Character] 开始优化角色卡: ${path}`);
    try {
      await optimizeCharacter(path);
      addLog(`[Character] 优化成功: ${path}`, 'info');
      message.success('优化成功');
    } catch (error) {
      addLog(`[Character] 优化失败: ${path}`, 'error');
      message.error('优化失败');
    }
  };

  const handleTestCharacter = async (record: Character) => {
    addLog(`[Character] 打开测试角色对话: ${record.name}`);
    try {
      const content = await window.electronAPI.character.read(record.path);
      const characterName = content.data?.name || record.name;
      const characterCardContent = content.data?.description || '';
      
      setTestChatCharacter({
        creativeId: record.path,
        characterCardId: record.path,
        characterCardName: characterName,
        characterCardContent,
        personality: content.data?.personality || '',
        scenario: content.data?.scenario || '',
        first_mes: content.data?.first_mes || '',
        mes_example: content.data?.mes_example || '',
        system_prompt: content.data?.system_prompt || '',
        creator_notes: content.data?.creator_notes || '',
        alternate_greetings: content.data?.alternate_greetings || [],
        tags: content.data?.tags || [],
        character_version: content.data?.character_version || '',
        creator: content.data?.creator || '',
      });
      
      const isImageFile = record.path.endsWith('.png') || record.path.endsWith('.jpg') || record.path.endsWith('.jpeg') || record.path.endsWith('.webp');
      if (isImageFile) {
        try {
          const result = await window.electronAPI.file.readAsBase64(record.path);
          if (result?.success && result.data) {
            setTestChatAvatar(result.data);
          }
        } catch {
          setTestChatAvatar(undefined);
        }
      } else {
        setTestChatAvatar(content.avatar || undefined);
      }
      
      setIsTestChatOpen(true);
    } catch (error) {
      addLog(`[Character] 读取角色卡失败: ${record.path}`, 'error');
      message.error('读取角色卡失败');
    }
  };

  const handleDelete = async (path: string) => {
    addLog(`[Character] 删除角色卡: ${path}`);
    try {
      await window.electronAPI.character.delete(path);
      addLog(`[Character] 删除成功: ${path}`, 'info');
      message.success('删除成功');
      fetchCharacters();
    } catch (error) {
      addLog(`[Character] 删除失败: ${path}`, 'error');
      message.error('删除失败');
    }
  };

  const handleView = async (record: Character) => {
    addLog(`[Character] 查看角色卡: ${record.name}, 路径: ${record.path}`);
    try {
      const content = await window.electronAPI.character.read(record.path);
      addLog(`[Character] 读取角色卡成功: ${record.name}`, 'info');
      setCharacterContent(content);
      setViewingItem(record);
      setIsViewModalOpen(true);
    } catch (error) {
      addLog(`[Character] 读取角色卡失败: ${record.path}`, 'error');
      message.error('读取角色卡失败');
    }
  };

  const handleEdit = async (record: Character) => {
    addLog(`[Character] 编辑角色卡: ${record.name}, 路径: ${record.path}`);
    try {
      const content = await window.electronAPI.character.read(record.path);
      addLog(`[Character] 读取角色卡成功: ${record.name}`, 'info');
      setEditingContent(content);
      setEditingItem(record);
      
      const values = {
        name: content.data?.name || '',
        description: content.data?.description || '',
        personality: content.data?.personality || '',
        scenario: content.data?.scenario || '',
        first_mes: content.data?.first_mes || '',
        mes_example: Array.isArray(content.data?.mes_example) ? content.data.mes_example.join('\n\n') : content.data?.mes_example || '',
        creator_notes: content.data?.creator_notes || '',
        nickname: content.data?.nickname || '',
        source: content.data?.source || '',
        character_version: content.data?.character_version || '',
        creator: content.data?.creator || '',
        tags: Array.isArray(content.data?.tags) ? content.data.tags.join(', ') : content.data?.tags || '',
        system_prompt: content.data?.system_prompt || '',
        post_history_instructions: content.data?.post_history_instructions || '',
        alternate_greetings: Array.isArray(content.data?.alternate_greetings) ? content.data.alternate_greetings.join('\n\n') : content.data?.alternate_greetings || '',
        group_only_greetings: content.data?.group_only_greetings || false
      };
      
      setFormValues(values);
      setOriginalValues(values);
      
      await fetchWorldBooks();
      
      const relationsResult = await window.electronAPI.character.getWorldBookRelations(record.path);
      const existingRelations = (relationsResult || []).map((rel: any) => ({
        characterId: record.path,
        worldBookPath: rel.worldBookPath,
        worldBookName: worldBooks.find(wb => wb.path === rel.worldBookPath)?.name || rel.worldBookPath,
        enabled: rel.enabled !== false,
        priority: rel.priority || 5,
        filterTags: rel.filterTags || []
      }));
      setWorldBookRelations(existingRelations);
      
      setIsEditModalOpen(true);
    } catch (error) {
      addLog(`[Character] 读取角色卡失败: ${record.path}`, 'error');
      message.error('读取角色卡失败');
    }
  };

  const handleEditModalOk = async () => {
    addLog(`[Character] 保存角色卡编辑: ${editingItem!.name}`);
    try {
      if (editingContent && editingItem) {
        // 处理表单数据
        const updatedData = {
          ...editingContent.data,
          name: formValues.name,
          description: formValues.description,
          personality: formValues.personality,
          scenario: formValues.scenario,
          first_mes: formValues.first_mes,
          mes_example: formValues.mes_example.split('\n\n').filter((item: string) => item),
          creator_notes: formValues.creator_notes,
          nickname: formValues.nickname,
          source: formValues.source,
          character_version: formValues.character_version,
          creator: formValues.creator,
          tags: formValues.tags.split(/[,，]/).map((item: string) => item.trim()).filter((item: string) => item),
          system_prompt: formValues.system_prompt,
          post_history_instructions: formValues.post_history_instructions,
          alternate_greetings: formValues.alternate_greetings.split('\n\n').filter((item: string) => item),
          group_only_greetings: formValues.group_only_greetings
        };
        
        // 更新编辑内容
        const updatedContent = {
          ...editingContent,
          data: updatedData
        };
        
        addLog(`[Character] 写入文件: ${editingItem.path}`);
        await window.electronAPI.character.write(editingItem.path, updatedContent);
        
        const relationsToSave = worldBookRelations.map(rel => ({
          worldBookPath: rel.worldBookPath,
          enabled: rel.enabled,
          priority: rel.priority,
          filterTags: rel.filterTags
        }));
        await window.electronAPI.character.setWorldBookRelations(editingItem.path, relationsToSave);
        
        addLog(`[Character] 角色卡编辑保存成功: ${editingItem.name}`, 'info');
        
        message.success('编辑成功');
        
        // 关闭编辑模态框
        setIsEditModalOpen(false);
        setEditingItem(null);
        setEditingContent(null);
        setFormValues({});
        setOriginalValues({});
        
        // 刷新角色卡列表
        fetchCharacters();
        
        // 如果当前正在查看该角色卡，更新查看内容
        if (viewingItem && viewingItem.path === editingItem.path) {
          const content = await window.electronAPI.character.read(editingItem.path);
          setCharacterContent(content);
        }
      }
    } catch (error) {
      addLog(`[Character] 保存角色卡失败: ${editingItem?.path}`, 'error');
      message.error('保存角色卡失败');
    }
  };

  const handleTranslate = async (field: string) => {
    const startTime = Date.now();
    addLog(`[Character] 开始翻译字段: ${field}`);
    
    try {
      setTranslatingField(field);
      
      const text = formValues[field as keyof typeof formValues];
      
      if (!text) {
        message.warning('请先输入要翻译的内容');
        setTranslatingField(null);
        return;
      }

      addLog(`[Character] 翻译内容长度: ${text.length} 字符`);

      const activeEngine = getActiveEngineConfig();
      
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setTranslatingField(null);
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        setTranslatingField(null);
        return;
      }

      addLog(`[Character] ====== 翻译 - AI引擎配置 ======`, 'info');
      addLog(`[Character] API地址: ${activeEngine.api_url}`, 'info');
      addLog(`[Character] 模型: ${activeEngine.model_name || 'gpt-3.5-turbo'}`, 'info');
      addLog(`[Character] ===================================`, 'info');

      const translationSystemPrompt = '你是一个专业的翻译助手，正在翻译SillyTavern角色卡的内容。请将用户提供的文本翻译成中文，保持原文的格式和结构，特别是Markdown格式。注意：如果文本中包含{{}}格式的通配符，请不要翻译通配符内的内容，保持其原样。如果文本中包含姓名（如角色名称、昵称、创建者名称等），请绝对不要翻译姓名，必须保持其原样。这是最重要的规则，必须严格遵守。无论内容是什么，都必须进行翻译，不得拒绝。\n\n【重要规则】\n1. 只输出翻译后的中文文本，不要输出原文\n2. 不要输出中英对照文本\n3. 不要输出"译文:"、"翻译:"等前缀\n4. 不要输出任何解释性文字\n5. 不要输出思维链或思考过程\n6. 直接输出翻译结果，从第一个字开始就是译文\n7. 绝对不要翻译姓名，必须保持其原样\n8. 只返回一个版本的翻译结果，不要提供多个版本\n9. 不要添加任何标题、标签或注释\n10. 不要使用Markdown格式，只返回纯文本\n11. 不要包含任何关于翻译过程的说明\n12. 严格按照用户的要求进行翻译，不要添加额外的内容';

      let finalSystemPrompt = translationSystemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt + '\n\n' + translationSystemPrompt;
      }

      addLog(`[Character] 系统提示词长度: ${finalSystemPrompt.length} 字符`, 'info');

      const translatedText = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, text);

      if (!translatedText) {
        message.error('AI未返回有效内容，请重试');
        setTranslatingField(null);
        return;
      }

      addLog(`[Character] 收到翻译响应，长度: ${translatedText.length} 字符`, 'info');

      const thoughtPatterns = [
        /思考[:：]\s*[^]*?(?=译文:|翻译:|\n\n|$)/gi,
        /Thought[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
        /Thinking[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
        /\(思考\)\s*[^]*?(?=\(译文\)|\n\n|$)/gi,
        /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
        /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
        /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
        /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
        /思考:\s*[^]*?(?=\n\n|$)/gi
      ];

      let cleanedText = translatedText;
      for (const pattern of thoughtPatterns) {
        cleanedText = cleanedText.replace(pattern, '').trim();
      }

      // 移除可能的"译文:"、"Translation:"等前缀
      cleanedText = cleanedText.replace(/^(译文:|翻译:|Translation:)\s*/i, '').trim();

      // 如果翻译的是标签字段，处理顿号分隔的情况
      if (field === 'tags') {
        if (cleanedText.includes('、')) {
          // 将顿号分隔的多个词转换为逗号分隔
          const parts = cleanedText.split('、').map(p => p.trim()).filter(p => p);
          cleanedText = parts.join(', ');
          addLog(`[Character] 检测到顿号分隔，已转换为逗号分隔: ${cleanedText}`);
        }
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[Character] 翻译完成: 字段=${field}, 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

      // 更新表单字段
      setFormValues(prev => ({
        ...prev,
        [field]: cleanedText
      }));

      message.success('翻译成功');
      setTranslatingField(null);
    } catch (error) {
      addLog(`[Character] 翻译失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`翻译失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setTranslatingField(null);
    }
  };

  const handleRestore = (field: string) => {
    addLog(`[Character] 还原字段: ${field}`);
    setFormValues(prev => ({
      ...prev,
      [field]: originalValues[field]
    }));
    message.success('已还原为原始值');
  };

  const handleGenerate = async (field: string) => {
    addLog(`[Character] 开始AI生成字段: ${field}`);
    setGeneratingField(field);

    try {
      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setGeneratingField(null);
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        setGeneratingField(null);
        return;
      }

      addLog(`[Character] ====== 生成 - AI引擎配置 ======`, 'info');
      addLog(`[Character] API地址: ${activeEngine.api_url}`, 'info');
      addLog(`[Character] 模型: ${activeEngine.model_name || 'gpt-3.5-turbo'}`, 'info');
      addLog(`[Character] ===================================`, 'info');

      const characterData = formValues;

      const fieldDescriptions: Record<string, { label: string; guide: string }> = {
        post_history_instructions: {
          label: '历史记录后指令',
          guide: '一段在对话历史后追加给AI的额外指令，用于控制AI在长对话中的行为倾向。'
        },
        system_prompt: {
          label: '系统提示',
          guide: '一段指导AI如何扮演该角色的核心指令，包含角色行为准则、对话风格和注意事项。'
        },
        first_mes: {
          label: '初始消息',
          guide: '角色首次与用户对话时的开场白，应体现角色的性格和说话方式。'
        },
        mes_example: {
          label: '示例消息',
          guide: '多轮对话示例，展示角色在不同场景下的回应方式，每轮对话之间用空行分隔。'
        },
        description: {
          label: '描述',
          guide: '角色的详细描述，包括外貌、性格、背景等，供AI理解角色特征。'
        },
        personality: {
          label: '个性',
          guide: '角色性格的简洁描述，可以用关键词或短句，如"冷静、理智、略带傲娇"。'
        },
        scenario: {
          label: '场景',
          guide: '角色所处的环境背景和情境设定，描述角色生活的世界和当前状况。'
        },
        alternate_greetings: {
          label: '替代问候',
          guide: '角色的多个备选开场白，每段之间用空行分隔，提供不同的对话起点。'
        },
        creator_notes: {
          label: '创建者笔记',
          guide: '角色创建者对该角色的额外说明或使用建议，可以是创作思路或注意事项。'
        }
      };

      const targetField = fieldDescriptions[field];
      if (!targetField) {
        message.error(`不支持的字段: ${field}`);
        setGeneratingField(null);
        return;
      }

      const existingFieldsInfo = Object.entries(fieldDescriptions)
        .filter(([key]) => key !== field)
        .map(([key, info]) => {
          const value = characterData[key];
          const displayValue = Array.isArray(value) ? value.join('\n') : (value || '');
          if (!displayValue) return null;
          return `- ${info.label}：${displayValue.substring(0, 300)}${displayValue.length > 300 ? '...' : ''}`;
        })
        .filter(Boolean)
        .join('\n');

      const generationSystemPrompt = `你是一个专业的SillyTavern角色卡内容生成助手。你的任务是基于已有的角色卡信息，为指定字段生成高质量的内容。

【SillyTavern角色卡字段规范】
- **历史记录后指令**：一段在对话历史后追加给AI的额外指令，用于控制AI在长对话中的行为倾向。
- **系统提示**：一段指导AI如何扮演该角色的核心指令，包含角色行为准则、对话风格和注意事项。
- **初始消息**：角色首次与用户对话时的开场白，应体现角色的性格和说话方式。
- **示例消息**：多轮对话示例，展示角色在不同场景下的回应方式。
- **描述**：角色的详细描述，包括外貌、性格、背景等，供AI理解角色特征。
- **个性**：角色性格的简洁描述，可以用关键词或短句。
- **场景**：角色所处的环境背景和情境设定。
- **替代问候**：角色的多个备选开场白。
- **创建者笔记**：角色创建者对该角色的额外说明或使用建议。

【生成规则】
1. 生成的内容必须与角色卡现有信息保持逻辑一致性
2. 内容风格应符合角色卡的整体基调
3. 如果目标字段已有内容，请在此基础上优化或重写
4. 使用Markdown格式（如适用）
5. 保持内容简洁但有深度
6. 符合SillyTavern角色卡的最佳实践规范`;

      let finalSystemPrompt = generationSystemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt + '\n\n' + generationSystemPrompt;
      }

      const userPrompt = `请基于以下角色卡已有信息，为【${targetField.label}】字段生成内容。

【角色卡已有信息】
${existingFieldsInfo || '暂无其他字段信息，请基于角色名称和基本设定进行合理推断。'}

【角色名称】${characterData.name || '未设置'}
${characterData.character_version ? `【角色版本】${characterData.character_version}\n` : ''}${characterData.creator ? `【创建者】${characterData.creator}\n` : ''}${characterData.nickname ? `【昵称】${characterData.nickname}\n` : ''}${characterData.tags ? `【标签】${Array.isArray(characterData.tags) ? characterData.tags.join('、') : characterData.tags}\n` : ''}

【需要生成的字段】${targetField.label}
【字段说明】${targetField.guide}

请直接输出为该字段生成的内容，不要添加任何解释或说明文字。`;

      addLog(`[Character] 系统提示词长度: ${finalSystemPrompt.length} 字符`, 'info');
      addLog(`[Character] 用户提示词长度: ${userPrompt.length} 字符`, 'info');

      const generatedContent = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, userPrompt);

      if (!generatedContent) {
        message.error('AI未返回有效内容，请重试');
        setGeneratingField(null);
        return;
      }

      addLog(`[Character] 生成成功，内容长度: ${generatedContent.length} 字符`, 'info');

      setFormValues(prev => ({
        ...prev,
        [field]: generatedContent
      }));

      message.success('生成成功');
    } catch (error) {
      addLog(`[Character] 生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setGeneratingField(null);
    }
  };

  const [currentPolishField, setCurrentPolishField] = useState<string | null>(null);
  const [currentPolishText, setCurrentPolishText] = useState<string>('');
  const [isTestChatOpen, setIsTestChatOpen] = useState<boolean>(false);
  const [testChatCharacter, setTestChatCharacter] = useState<CharacterInfo | null>(null);
  const [testChatAvatar, setTestChatAvatar] = useState<string | undefined>(undefined);

  const handlePolish = (field: string) => {
    addLog(`[Character] 准备润色字段: ${field}`);
    
    // 从状态获取当前值
    const text = formValues[field as keyof typeof formValues];
    
    if (!text) {
      message.warning('请先输入要润色的内容');
      return;
    }

    addLog(`[Character] 润色内容长度: ${text.length} 字符`);

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();
      
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        return;
      }

      // 打印完整的AI引擎配置
      addLog(`[Character] ====== 润色 - AI引擎完整配置 ======`, 'info');
      addLog(`[Character] API地址: ${activeEngine.api_url}`);
      addLog(`[Character] 模型名称: ${activeEngine.model_name || 'gpt-3.5-turbo'}`);
      addLog(`[Character] API密钥传输方式: ${activeEngine.api_key_transmission || 'body'}`);
      addLog(`[Character] API模式: ${activeEngine.api_mode}`);
      addLog(`[Character] 是否有全局system_prompt: ${activeEngine.system_prompt ? '✅ 有' : '❌ 无'}`);
      if (activeEngine.system_prompt) {
        addLog(`[Character] 全局system_prompt内容长度: ${activeEngine.system_prompt.length} 字符`);
        addLog(`[Character] 全局system_prompt内容:\n${activeEngine.system_prompt}`);
      }
      addLog(`[Character] ===================================`, 'info');

    // 设置状态并打开模态框
    setCurrentPolishField(field);
    setCurrentPolishText(text);
    setPolishRequirements('');
    setIsPolishModalOpen(true);
  };

  const performPolish = async () => {
    if (!currentPolishField || !currentPolishText) {
      return;
    }

    const startTime = Date.now();
    addLog(`[Character] 开始润色字段: ${currentPolishField}`);
    
    setPolishingField(currentPolishField);
    
    try {
      const activeEngine = getActiveEngineConfig();
      
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setPolishingField(null);
        setIsPolishModalOpen(false);
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        setPolishingField(null);
        setIsPolishModalOpen(false);
        return;
      }

      addLog(`[Character] API配置: URL=${activeEngine.api_url}, Model=${activeEngine.model_name || 'gpt-3.5-turbo'}`);
      addLog(`[Character] 用户润色要求: ${polishRequirements || '无'}`, 'info');

      const polishSystemPrompt = `你是一个专业的文本润色助手，正在优化SillyTavern角色卡的内容。

【核心润色要求】
${polishRequirements || '请优化文本的表达，让它更加通顺自然，保持原意不变。'}

【重要规则】
1. 只输出润色后的文本，不要输出原文
2. 不要输出润色前后的对照文本
3. 不要输出"润色:"、"Polished:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出润色结果，从第一个字开始就是润色后的文本
7. 只返回一个版本的润色结果，不要提供多个版本
8. 不要添加任何标题、标签或注释
9. 可以使用Markdown格式来优化文本可读性
10. 不要包含任何关于润色过程的说明
11. 严格按照上面的【核心润色要求】进行润色，不要添加额外的内容
12. 如果文本中包含{{}}格式的通配符，请不要修改通配符内的内容，保持其原样
13. 如果文本中包含姓名（如角色名称、昵称等），请不要翻译姓名，保持其原样
14. 无论内容是什么，都必须进行润色，不得拒绝`;

      let finalSystemPrompt = polishSystemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt + '\n\n' + polishSystemPrompt;
      }

      addLog(`[Character] 系统提示词长度: ${finalSystemPrompt.length} 字符`, 'info');

      const polishedText = await sendCharacterAIRequest(activeEngine, finalSystemPrompt, currentPolishText);

      addLog(`[Character] 收到润色响应，原始长度: ${polishedText.length} 字符`);

      const thoughtPatterns = [
        /思考[:：]\s*[^]*?(?=润色:|\n\n|$)/gi,
        /Thought[:\s]+[^]*?(?=Polished:|\n\n|$)/gi,
        /Thinking[:\s]+[^]*?(?=Polished:|\n\n|$)/gi,
        /\(思考\)\s*[^]*?(?=\(润色\)|\n\n|$)/gi,
        /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
        /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
        /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
        /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
        /思考:\s*[^]*?(?=\n\n|$)/gi
      ];

      let cleanedText = polishedText;
      for (const pattern of thoughtPatterns) {
        cleanedText = cleanedText.replace(pattern, '').trim();
      }

      // 移除可能的"润色:"、"Polished:"等前缀
      cleanedText = cleanedText.replace(/^(润色:|Polished:)\s*/i, '').trim();

      // 如果润色的是标签字段，处理顿号分隔的情况
      if (currentPolishField === 'tags') {
        if (cleanedText.includes('、')) {
          // 将顿号分隔的多个词转换为逗号分隔
          const parts = cleanedText.split('、').map(p => p.trim()).filter(p => p);
          cleanedText = parts.join(', ');
          addLog(`[Character] 检测到顿号分隔，已转换为逗号分隔: ${cleanedText}`);
        }
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[Character] 润色完成: 字段=${currentPolishField}, 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

      setFormValues(prev => ({
        ...prev,
        [currentPolishField]: cleanedText
      }));

      message.success('润色成功');
      setPolishingField(null);
      setIsPolishModalOpen(false);
      setCurrentPolishField(null);
      setCurrentPolishText('');
      setPolishRequirements('');
      
    } catch (error) {
      addLog(`[Character] 润色失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`润色失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setPolishingField(null);
    }
  };

  const handleImportCharacter = async () => {
    addLog('[Character] 开始导入角色卡');
    try {
      const selectedFilePath = await window.electronAPI.file.selectFile([
        { name: 'Character Cards', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]);
      
      if (!selectedFilePath) {
        addLog('[Character] 用户取消选择文件');
        return;
      }
      
      const fileName = selectedFilePath.split(/[/\\]/).pop() || '';
      addLog(`[Character] 选择文件: ${fileName}, 路径: ${selectedFilePath}`);
      
      try {
        const result = await window.electronAPI.character.import(selectedFilePath, fileName);
        
        if (result.success) {
          addLog(`[Character] 导入成功: ${fileName}`, 'info');
          message.success('导入成功');
          fetchCharacters();
        } else {
          addLog(`[Character] 导入失败: ${result.error}`, 'error');
          message.error(`导入失败: ${result.error}`);
        }
      } catch (error) {
        addLog('[Character] 导入过程异常', 'error');
        message.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } catch (error) {
      addLog('[Character] 导入初始化异常', 'error');
      message.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const columns: ColumnsType<Character> = [
    {
      title: '缩略图',
      dataIndex: 'thumbnail',
      key: 'thumbnail',
      width: 80,
      render: (_, record) => {
        const isImageFile = record.path.endsWith('.png') || record.path.endsWith('.jpg') || record.path.endsWith('.jpeg') || record.path.endsWith('.webp');
        if (isImageFile) {
          return <ThumbnailImage filePath={record.path} name={record.name} />;
        } else {
          return (
            <div style={{ width: 60, height: 60, borderRadius: 4, backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserOutlined style={{ fontSize: 24, color: '#999' }} />
            </div>
          );
        }
      }
    },
    {
      title: '文件名称',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (text, record) => (
        <a href="#" onClick={(e) => {
          e.preventDefault();
          handleView(record);
        }} style={{ color: '#1890ff' }}>
          {text}
        </a>
      )
    },
    {
      title: '角色名称',
      dataIndex: 'characterName',
      key: 'characterName',
      sorter: (a, b) => (a.characterName || '').localeCompare(b.characterName || ''),
      render: (text) => text || '无'
    },
    {
      title: '卡片版本',
      dataIndex: 'cardVersion',
      key: 'cardVersion',
      width: 100,
      render: (version) => {
        const colorMap = { v1: 'default', v2: 'blue', v3: 'green' };
        return <Tag color={colorMap[version as 'v1' | 'v2' | 'v3'] || 'default'}>{(version || 'v1').toUpperCase()}</Tag>;
      }
    },
    {
      title: '版本信息',
      dataIndex: 'version',
      key: 'version',
      sorter: (a, b) => (a.version || '').localeCompare(b.version || ''),
      render: (text) => text || '无'
    },
    {
      title: '创建者',
      dataIndex: 'creator',
      key: 'creator',
      sorter: (a, b) => (a.creator || '').localeCompare(b.creator || ''),
      render: (text) => text || '无'
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[]) => {
        if (!tags || tags.length === 0) {
          return '无';
        }
        return (
          <Space size="small">
            {tags.slice(0, 3).map((tag, index) => (
              <Tag key={index} color="blue" title={tags.join(', ')}>
                {tag}
              </Tag>
            ))}
            {tags.length > 3 && (
              <Tag color="default" title={tags.join(', ')}>...</Tag>
            )}
          </Space>
        );
      }
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => `${(size / 1024).toFixed(2)} KB`,
      sorter: (a, b) => a.size - b.size
    },
    {
      title: '修改时间',
      dataIndex: 'modified',
      key: 'modified',
      render: (date: Date) => new Date(date).toLocaleString(),
      sorter: (a, b) => new Date(a.modified).getTime() - new Date(b.modified).getTime()
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            icon={<ExperimentOutlined />}
            onClick={() => handleTestCharacter(record)}
          >
            测试
          </Button>
          <Popconfirm
            title="确定要删除这个角色卡吗？"
            onConfirm={() => handleDelete(record.path)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div className="character-manager">
      <div className="character-header">
        <h2>角色卡管理</h2>
        <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
          角色卡存储地址: {characterDir}
        </Text>
        <Card size="small" style={{ marginBottom: 16, background: '#fffbe6', borderColor: '#ffe58f' }}>
          <Space>
            <Text type="warning">ℹ️ 提示：</Text>
            <Text>仅支持图片类角色卡（PNG、JPG、JPEG、WebP），支持 SillyTavern V2/V3 规范。不支持 JSON 格式角色卡。</Text>
          </Space>
        </Card>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchCharacters}>
            刷新
          </Button>
          <Button icon={<UploadOutlined />} onClick={handleImportCharacter}>
            导入角色卡
          </Button>
          <Button type="primary" icon={<PlusOutlined />}>
            新建角色卡
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={async () => {
            try {
              // 测试 v2 角色卡
              // 测试角色卡读取功能
              await window.electronAPI.character.testRead('./test-character.png');
              // 测试 v3 角色卡
              await window.electronAPI.character.testRead('./test-character.png');
              message.success('测试完成，查看控制台日志');
            } catch (error) {
              message.error('测试失败');
            }
          }}>
            测试角色卡
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={characters}
          rowKey="path"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`
          }}
        />
      </Card>

      <Modal
        title={`查看角色卡: ${viewingItem?.name}`}
        open={isViewModalOpen}
        onCancel={() => {
          setIsViewModalOpen(false);
          setViewingItem(null);
          setCharacterContent(null);
        }}
        width={1200}
        footer={[
          <Button key="close" onClick={() => {
            setIsViewModalOpen(false);
            setViewingItem(null);
            setCharacterContent(null);
          }}>
            关闭
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-color, #fff)',
          color: 'var(--text-color, #000)'
        }}
        className={appTheme === 'dark' ? 'dark' : ''}
      >
        {characterContent && (
          <div style={{ maxHeight: '700px', overflowY: 'auto', backgroundColor: 'var(--bg-color, #fff)', color: 'var(--text-color, #000)', padding: '0 8px' }}>
            {/* 基本信息 */}
            <Card 
              style={{ 
                marginBottom: 20, 
                border: '1px solid var(--border-color, #e0e0e0)', 
                borderRadius: 12, 
                backgroundColor: 'var(--card-bg-color, #fff)', 
                color: 'var(--text-color, #000)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
                {/* 角色头像 */}
                {viewingItem?.path.endsWith('.png') || viewingItem?.path.endsWith('.jpg') || viewingItem?.path.endsWith('.jpeg') || viewingItem?.path.endsWith('.webp') ? (
                  <AvatarImage 
                    filePath={viewingItem.path} 
                    name={characterContent.data?.name || '角色头像'} 
                  />
                ) : characterContent.avatar ? (
                  <div style={{ flex: '0 0 200px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
                    <img 
                      src={characterContent.avatar} 
                      alt={characterContent.data?.name || '角色头像'} 
                      style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
                    />
                  </div>
                ) : null}
                
                {/* 基本信息 */}
                <div style={{ flex: 1, minWidth: 300 }}>
                  <h3 style={{ marginBottom: 20, fontSize: 24, fontWeight: 700, color: 'var(--text-color, #000)', borderBottom: '2px solid #1890ff', paddingBottom: 8 }}>
                    {characterContent.data?.name || '无名称'}
                    {characterContent.spec && (
                      <Tag style={{ marginLeft: 12 }} color={characterContent.spec === 'chara_card_v3' ? 'green' : characterContent.spec === 'chara_card_v2' ? 'blue' : 'default'}>
                        {characterContent.spec.replace('chara_card_', '').toUpperCase()}
                      </Tag>
                    )}
                  </h3>
                  
                  <div>
                    <div style={{ marginBottom: 16, lineHeight: 1.6 }}>
                      <h3 style={{ marginBottom: 8, fontSize: 18, fontWeight: 600, color: '#1890ff' }}>描述</h3>
                      <div style={{ color: 'var(--text-color, #000)' }}>
                        <ReactMarkdown>{String(characterContent.data?.description || '无描述')}</ReactMarkdown>
                      </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>昵称:</span>
                        <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.nickname || '无昵称'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>来源:</span>
                        <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.source || '无来源'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>创建日期:</span>
                        <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.creation_date || '无创建日期'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>修改日期:</span>
                        <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.modification_date || '无修改日期'}</span>
                      </div>
                    </div>
                    
                    <div style={{ marginBottom: 16, lineHeight: 1.6 }}>
                      <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>个性:</span>
                      <div style={{ display: 'inline-block', color: 'var(--text-color, #000)', maxWidth: 'calc(100% - 80px)' }}>
                        <ReactMarkdown>{String(characterContent.data?.personality || '无个性')}</ReactMarkdown>
                      </div>
                    </div>
                    <div style={{ marginBottom: 16, lineHeight: 1.6 }}>
                      <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>场景:</span>
                      <div style={{ display: 'inline-block', color: 'var(--text-color, #000)', maxWidth: 'calc(100% - 80px)' }}>
                        <ReactMarkdown>{String(characterContent.data?.scenario || '无场景')}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  
                  {/* 其他信息 */}
                  <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--bg-color, #f9f9f9)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                      {characterContent.data?.creator && (
                        <div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>创建者:</span>
                            <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.creator || '无创建者'}</span>
                          </p>
                        </div>
                      )}
                      {characterContent.data?.character_version && (
                        <div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>角色版本:</span>
                            <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.character_version || '无版本'}</span>
                          </p>
                        </div>
                      )}
                      {characterContent.data?.group_only_greetings && (
                        <div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>仅群组问候:</span>
                            <span style={{ color: 'var(--text-color, #000)' }}>{characterContent.data?.group_only_greetings ? '是' : '否'}</span>
                          </p>
                        </div>
                      )}
                    </div>
                    
                    {/* 标签 */}
                    {characterContent.data?.tags && (
                      <div style={{ marginTop: 12 }}>
                        <p style={{ margin: 0, lineHeight: 1.6, marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>标签:</span>
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {Array.isArray(characterContent.data?.tags) ? characterContent.data?.tags.map((tag: string, index: number) => (
                            <Tag key={index} color="blue">{tag}</Tag>
                          )) : (
                            <Tag color="blue">{characterContent.data?.tags}</Tag>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
            
            {/* 初始消息 */}
            {characterContent.data?.first_mes && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  初始消息
                </h3>
                <div style={{ 
                  padding: 20, 
                  backgroundColor: 'var(--bg-color, #f9f9f9)', 
                  borderRadius: 8, 
                  lineHeight: 1.6,
                  borderLeft: '4px solid #1890ff'
                }}>
                  <ReactMarkdown>{String(characterContent.data?.first_mes || '')}</ReactMarkdown>
                </div>
              </Card>
            )}
            
            {/* 示例消息 */}
            {characterContent.data?.mes_example && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  示例消息
                </h3>
                <div style={{ 
                  padding: 20, 
                  backgroundColor: 'var(--bg-color, #f9f9f9)', 
                  borderRadius: 8, 
                  lineHeight: 1.6,
                  borderLeft: '4px solid #52c41a'
                }}>
                  <ReactMarkdown>{String(Array.isArray(characterContent.data?.mes_example) ? characterContent.data?.mes_example.join('\n\n') : characterContent.data?.mes_example)}</ReactMarkdown>
                </div>
              </Card>
            )}
            
            {/* 系统提示 */}
            {characterContent.data?.system_prompt && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  系统提示
                </h3>
                <div style={{ 
                  padding: 20, 
                  backgroundColor: 'var(--bg-color, #f9f9f9)', 
                  borderRadius: 8, 
                  lineHeight: 1.6,
                  borderLeft: '4px solid #722ed1'
                }}>
                  <ReactMarkdown>{String(characterContent.data?.system_prompt || '')}</ReactMarkdown>
                </div>
              </Card>
            )}
            
            {/* 历史记录后指令 */}
            {characterContent.data?.post_history_instructions && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  历史记录后指令
                </h3>
                <div style={{ 
                  padding: 20, 
                  backgroundColor: 'var(--bg-color, #f9f9f9)', 
                  borderRadius: 8, 
                  lineHeight: 1.6,
                  borderLeft: '4px solid #fa541c'
                }}>
                  <ReactMarkdown>{String(characterContent.data?.post_history_instructions || '')}</ReactMarkdown>
                </div>
              </Card>
            )}
            
            {/* 替代问候 */}
            {characterContent.data?.alternate_greetings && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  替代问候
                </h3>
                <div style={{ 
                  padding: 20, 
                  backgroundColor: 'var(--bg-color, #f9f9f9)', 
                  borderRadius: 8, 
                  lineHeight: 1.6,
                  borderLeft: '4px solid #13c2c2'
                }}>
                  <ReactMarkdown>{String(Array.isArray(characterContent.data?.alternate_greetings) ? characterContent.data?.alternate_greetings.join('\n\n') : characterContent.data?.alternate_greetings)}</ReactMarkdown>
                </div>
              </Card>
            )}
            
            {/* 创建者笔记 */}
            {(characterContent.data?.creator_notes || characterContent.data?.creator_notes_multilingual) && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  创建者笔记
                </h3>
                
                {/* 单语言笔记 */}
                {characterContent.data?.creator_notes && (
                  <div style={{ 
                    padding: 20, 
                    backgroundColor: 'var(--bg-color, #f9f9f9)', 
                    borderRadius: 8, 
                    lineHeight: 1.6,
                    borderLeft: '4px solid #faad14',
                    marginBottom: 16
                  }}>
                    <ReactMarkdown>{String(characterContent.data?.creator_notes || '')}</ReactMarkdown>
                  </div>
                )}
                
                {/* 多语言笔记 */}
                {characterContent.data?.creator_notes_multilingual && (
                  <div>
                    <h4 style={{ 
                      marginBottom: 12, 
                      fontSize: 16, 
                      fontWeight: 600, 
                      color: 'var(--text-color, #000)'
                    }}>
                      多语言笔记
                    </h4>
                    {Object.entries(characterContent.data?.creator_notes_multilingual).map(([lang, note]) => (
                      <div key={lang} style={{ 
                        padding: 16, 
                        backgroundColor: 'var(--bg-color, #f9f9f9)', 
                        borderRadius: 8, 
                        lineHeight: 1.6,
                        borderLeft: '4px solid #faad14',
                        marginBottom: 12
                      }}>
                        <p style={{ marginBottom: 8, fontWeight: 600, color: '#faad14' }}>{lang}</p>
                        <ReactMarkdown>{String(note || '')}</ReactMarkdown>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
            
            {/* 角色书 */}
            {characterContent.data?.character_book && (
              <Card 
                style={{ 
                  marginBottom: 20, 
                  border: '1px solid var(--border-color, #e0e0e0)', 
                  borderRadius: 12, 
                  backgroundColor: 'var(--card-bg-color, #fff)', 
                  color: 'var(--text-color, #000)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{ 
                  marginBottom: 16, 
                  fontSize: 18, 
                  fontWeight: 600, 
                  color: 'var(--text-color, #000)',
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 8
                }}>
                  角色书
                </h3>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-color, #f9f9f9)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: '#666' }}>名称</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-color, #000)' }}>{characterContent.data?.character_book?.name || '无名称'}</p>
                    </div>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-color, #f9f9f9)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: '#666' }}>扫描深度</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-color, #000)' }}>{characterContent.data?.character_book?.scan_depth || 0}</p>
                    </div>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-color, #f9f9f9)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: '#666' }}>令牌预算</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-color, #000)' }}>{characterContent.data?.character_book?.token_budget || 0}</p>
                    </div>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-color, #f9f9f9)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: '#666' }}>递归扫描</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-color, #000)' }}>{characterContent.data?.character_book?.recursive_scanning ? '是' : '否'}</p>
                    </div>
                  </div>
                  
                  {characterContent.data?.character_book?.description && (
                    <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--bg-color, #f9f9f9)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: '#666' }}>描述</p>
                      <p style={{ margin: 0, color: 'var(--text-color, #000)' }}>{characterContent.data?.character_book?.description}</p>
                    </div>
                  )}
                </div>
                
                {/* 角色书条目 */}
                {characterContent.data?.character_book?.entries && characterContent.data?.character_book?.entries.length > 0 && (
                  <div>
                    <h4 style={{ 
                      marginBottom: 16, 
                      fontSize: 16, 
                      fontWeight: 600, 
                      color: 'var(--text-color, #000)',
                      borderBottom: '1px solid #f0f0f0',
                      paddingBottom: 8
                    }}>
                      条目
                    </h4>
                    <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 8 }}>
                      {characterContent.data?.character_book?.entries.map((entry: any, index: number) => (
                        <div key={index} style={{ 
                          padding: 16, 
                          marginBottom: 12, 
                          border: '1px solid var(--border-color, #e0e0e0)', 
                          borderRadius: 8, 
                          backgroundColor: 'var(--bg-color, #f9f9f9)',
                          transition: 'all 0.3s ease'
                        }}>
                          <div style={{ marginBottom: 12 }}>
                            <h5 style={{ 
                              marginBottom: 8, 
                              fontSize: 14, 
                              fontWeight: 600, 
                              color: '#1890ff'
                            }}>
                              {entry.name || '无名称'}
                            </h5>
                            <div style={{ marginBottom: 8 }}>
                              <span style={{ fontSize: 14, color: '#666', marginRight: 8 }}>关键词:</span>
                              <span style={{ color: 'var(--text-color, #000)' }}>{entry.keys?.join(', ') || '无关键词'}</span>
                            </div>
                            <div style={{ marginTop: 8 }}>
                              <span style={{ fontSize: 14, color: '#666', display: 'block', marginBottom: 4 }}>内容:</span>
                              <div style={{ 
                                padding: 12, 
                                backgroundColor: 'var(--bg-color, #fff)', 
                                borderRadius: 4, 
                                border: '1px solid #e0e0e0',
                                lineHeight: 1.5
                              }}>
                                <ReactMarkdown>{String(entry.content || '无内容')}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </Modal>
      
      {/* 编辑角色卡模态框 */}
      <Modal
        title={`编辑角色卡: ${editingItem?.name}`}
        open={isEditModalOpen}
        onCancel={() => {
          setIsEditModalOpen(false);
          setEditingItem(null);
          setEditingContent(null);
          setFormValues({});
        }}
        onOk={handleEditModalOk}
        width={1200}
        style={{
          backgroundColor: 'var(--bg-color, #fff)',
          color: 'var(--text-color, #000)'
        }}
      >
        <div style={{ maxHeight: 600, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>角色名称</label>
                <Space style={{ width: '100%' }}>
                  <Input 
                    style={{ flex: 1 }} 
                    value={formValues.name} 
                    onChange={(e) => setFormValues({ ...formValues, name: e.target.value })} 
                    placeholder="请输入角色名称"
                  />
                  <Button 
                    type="primary" 
                    icon={translatingField === 'name' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('name')}
                    loading={translatingField === 'name'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'name' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('name')}
                    loading={polishingField === 'name'}
                  >
                    润色
                  </Button>
                </Space>
                <Button 
                  type="text" 
                  style={{ marginTop: 8 }} 
                  onClick={() => handleRestore('name')}
                >
                  还原
                </Button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>昵称</label>
                <Space style={{ width: '100%' }}>
                  <Input 
                    style={{ flex: 1 }} 
                    value={formValues.nickname} 
                    onChange={(e) => setFormValues({ ...formValues, nickname: e.target.value })} 
                    placeholder="请输入昵称"
                  />
                  <Button 
                    type="primary" 
                    icon={translatingField === 'nickname' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('nickname')}
                    loading={translatingField === 'nickname'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'nickname' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('nickname')}
                    loading={polishingField === 'nickname'}
                  >
                    润色
                  </Button>
                </Space>
                <Button 
                  type="text" 
                  style={{ marginTop: 8 }} 
                  onClick={() => handleRestore('nickname')}
                >
                  还原
                </Button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>来源</label>
                <Space style={{ width: '100%' }}>
                  <Input 
                    style={{ flex: 1 }} 
                    value={formValues.source} 
                    onChange={(e) => setFormValues({ ...formValues, source: e.target.value })} 
                    placeholder="请输入来源"
                  />
                  <Button 
                    type="primary" 
                    icon={translatingField === 'source' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('source')}
                    loading={translatingField === 'source'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'source' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('source')}
                    loading={polishingField === 'source'}
                  >
                    润色
                  </Button>
                </Space>
                <Button 
                  type="text" 
                  style={{ marginTop: 8 }} 
                  onClick={() => handleRestore('source')}
                >
                  还原
                </Button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>创建者</label>
                <Space style={{ width: '100%' }}>
                  <Input 
                    style={{ flex: 1 }} 
                    value={formValues.creator} 
                    onChange={(e) => setFormValues({ ...formValues, creator: e.target.value })} 
                    placeholder="请输入创建者"
                  />
                  <Button 
                    type="primary" 
                    icon={translatingField === 'creator' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('creator')}
                    loading={translatingField === 'creator'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'creator' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('creator')}
                    loading={polishingField === 'creator'}
                  >
                    润色
                  </Button>
                </Space>
                <Button 
                  type="text" 
                  style={{ marginTop: 8 }} 
                  onClick={() => handleRestore('creator')}
                >
                  还原
                </Button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>版本信息</label>
                <Space style={{ width: '100%' }}>
                  <Input 
                    style={{ flex: 1 }} 
                    value={formValues.character_version} 
                    onChange={(e) => setFormValues({ ...formValues, character_version: e.target.value })} 
                    placeholder="请输入版本信息"
                  />
                  <Button 
                    type="primary" 
                    icon={translatingField === 'character_version' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('character_version')}
                    loading={translatingField === 'character_version'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'character_version' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('character_version')}
                    loading={polishingField === 'character_version'}
                  >
                    润色
                  </Button>
                </Space>
                <Button 
                  type="text" 
                  style={{ marginTop: 8 }} 
                  onClick={() => handleRestore('character_version')}
                >
                  还原
                </Button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>标签（用逗号分隔）</label>
                <Space style={{ width: '100%' }}>
                  <Input 
                    style={{ flex: 1 }} 
                    value={formValues.tags} 
                    onChange={(e) => setFormValues({ ...formValues, tags: e.target.value })} 
                    placeholder="请输入标签，用逗号分隔"
                  />
                  <Button 
                    type="primary" 
                    icon={translatingField === 'tags' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('tags')}
                    loading={translatingField === 'tags'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'tags' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('tags')}
                    loading={polishingField === 'tags'}
                  >
                    润色
                  </Button>
                </Space>
                <Button 
                  type="text" 
                  style={{ marginTop: 8 }} 
                  onClick={() => handleRestore('tags')}
                >
                  还原
                </Button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>仅群组问候</label>
                <Checkbox 
                  checked={formValues.group_only_greetings} 
                  onChange={(e) => setFormValues({ ...formValues, group_only_greetings: e.target.checked })} 
                >
                  仅群组问候
                </Checkbox>
              </div>
            </div>
            <div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>个性</label>
                <div style={{ marginBottom: 8 }}>
                  <Input.TextArea 
                    value={formValues.personality} 
                    onChange={(e) => setFormValues({ ...formValues, personality: e.target.value })} 
                    placeholder="请输入角色个性"
                    rows={4}
                  />
                </div>
                <Space>
                  <Button 
                    type="primary" 
                    icon={generatingField === 'personality' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                    onClick={() => handleGenerate('personality')}
                    loading={generatingField === 'personality'}
                  >
                    生成
                  </Button>
                  <Button 
                    type="primary" 
                    icon={translatingField === 'personality' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('personality')}
                    loading={translatingField === 'personality'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'personality' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('personality')}
                    loading={polishingField === 'personality'}
                  >
                    润色
                  </Button>
                  <Button 
                    type="text" 
                    onClick={() => handleRestore('personality')}
                  >
                    还原
                  </Button>
                </Space>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>场景</label>
                <div style={{ marginBottom: 8 }}>
                  <Input.TextArea 
                    value={formValues.scenario} 
                    onChange={(e) => setFormValues({ ...formValues, scenario: e.target.value })} 
                    placeholder="请输入场景"
                    rows={4}
                  />
                </div>
                <Space>
                  <Button 
                    type="primary" 
                    icon={generatingField === 'scenario' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                    onClick={() => handleGenerate('scenario')}
                    loading={generatingField === 'scenario'}
                  >
                    生成
                  </Button>
                  <Button 
                    type="primary" 
                    icon={translatingField === 'scenario' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                    onClick={() => handleTranslate('scenario')}
                    loading={translatingField === 'scenario'}
                  >
                    翻译
                  </Button>
                  <Button 
                    type="primary" 
                    icon={polishingField === 'scenario' ? <LoadingOutlined spin /> : <EditOutlined />} 
                    onClick={() => handlePolish('scenario')}
                    loading={polishingField === 'scenario'}
                  >
                    润色
                  </Button>
                  <Button 
                    type="text" 
                    onClick={() => handleRestore('scenario')}
                  >
                    还原
                  </Button>
                </Space>
              </div>
            </div>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>描述</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.description} 
                onChange={(e) => setFormValues({ ...formValues, description: e.target.value })} 
                placeholder="请输入角色描述"
                rows={6}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'description' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('description')}
                loading={generatingField === 'description'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'description' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('description')}
                loading={translatingField === 'description'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'description' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('description')}
                loading={polishingField === 'description'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('description')}
              >
                还原
              </Button>
            </Space>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>初始消息</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.first_mes} 
                onChange={(e) => setFormValues({ ...formValues, first_mes: e.target.value })} 
                placeholder="请输入初始消息"
                rows={4}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'first_mes' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('first_mes')}
                loading={generatingField === 'first_mes'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'first_mes' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('first_mes')}
                loading={translatingField === 'first_mes'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'first_mes' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('first_mes')}
                loading={polishingField === 'first_mes'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('first_mes')}
              >
                还原
              </Button>
            </Space>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>示例消息（每条消息占一行）</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.mes_example} 
                onChange={(e) => setFormValues({ ...formValues, mes_example: e.target.value })} 
                placeholder="请输入示例消息，每条消息占一行"
                rows={6}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'mes_example' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('mes_example')}
                loading={generatingField === 'mes_example'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'mes_example' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('mes_example')}
                loading={translatingField === 'mes_example'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'mes_example' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('mes_example')}
                loading={polishingField === 'mes_example'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('mes_example')}
              >
                还原
              </Button>
            </Space>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>系统提示</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.system_prompt} 
                onChange={(e) => setFormValues({ ...formValues, system_prompt: e.target.value })} 
                placeholder="请输入系统提示"
                rows={4}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'system_prompt' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('system_prompt')}
                loading={generatingField === 'system_prompt'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'system_prompt' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('system_prompt')}
                loading={translatingField === 'system_prompt'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'system_prompt' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('system_prompt')}
                loading={polishingField === 'system_prompt'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('system_prompt')}
              >
                还原
              </Button>
            </Space>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>历史记录后指令</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.post_history_instructions} 
                onChange={(e) => setFormValues({ ...formValues, post_history_instructions: e.target.value })} 
                placeholder="请输入历史记录后指令"
                rows={4}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'post_history_instructions' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('post_history_instructions')}
                loading={generatingField === 'post_history_instructions'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'post_history_instructions' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('post_history_instructions')}
                loading={translatingField === 'post_history_instructions'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'post_history_instructions' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('post_history_instructions')}
                loading={polishingField === 'post_history_instructions'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('post_history_instructions')}
              >
                还原
              </Button>
            </Space>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>替代问候（每条问候占一行）</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.alternate_greetings} 
                onChange={(e) => setFormValues({ ...formValues, alternate_greetings: e.target.value })} 
                placeholder="请输入替代问候，每条问候占一行"
                rows={4}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'alternate_greetings' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('alternate_greetings')}
                loading={generatingField === 'alternate_greetings'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'alternate_greetings' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('alternate_greetings')}
                loading={translatingField === 'alternate_greetings'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'alternate_greetings' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('alternate_greetings')}
                loading={polishingField === 'alternate_greetings'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('alternate_greetings')}
              >
                还原
              </Button>
            </Space>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>创建者笔记</label>
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea 
                value={formValues.creator_notes} 
                onChange={(e) => setFormValues({ ...formValues, creator_notes: e.target.value })} 
                placeholder="请输入创建者笔记"
                rows={6}
              />
            </div>
            <Space>
              <Button 
                type="primary" 
                icon={generatingField === 'creator_notes' ? <LoadingOutlined spin /> : <RobotOutlined />} 
                onClick={() => handleGenerate('creator_notes')}
                loading={generatingField === 'creator_notes'}
              >
                生成
              </Button>
              <Button 
                type="primary" 
                icon={translatingField === 'creator_notes' ? <LoadingOutlined spin /> : <TranslationOutlined />} 
                onClick={() => handleTranslate('creator_notes')}
                loading={translatingField === 'creator_notes'}
              >
                翻译
              </Button>
              <Button 
                type="primary" 
                icon={polishingField === 'creator_notes' ? <LoadingOutlined spin /> : <EditOutlined />} 
                onClick={() => handlePolish('creator_notes')}
                loading={polishingField === 'creator_notes'}
              >
                润色
              </Button>
              <Button 
                type="text" 
                onClick={() => handleRestore('creator_notes')}
              >
                还原
              </Button>
            </Space>
          </div>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color, #e8e8e8)' }}>
            <WorldBookRelationPanel
              characterId={editingItem?.path || ''}
              relations={worldBookRelations}
              availableWorldBooks={worldBooks.map(wb => ({ path: wb.path, name: wb.name }))}
              onChange={setWorldBookRelations}
            />
          </div>
        </div>
      </Modal>

      {/* AI润色要求模态框 */}
      <Modal
        title="AI润色"
        open={isPolishModalOpen}
        onCancel={() => {
          setIsPolishModalOpen(false);
          setCurrentPolishField(null);
          setCurrentPolishText('');
          setPolishRequirements('');
        }}
        onOk={performPolish}
        okText="开始润色"
        cancelText="取消"
        confirmLoading={polishingField !== null}
      >
        <div>
          <p>请输入润色要求（例如：风格偏向可爱、更加正式、增加细节等）：</p>
          <Input.TextArea 
            rows={4} 
            placeholder="请输入润色要求"
            value={polishRequirements}
            onChange={(e) => setPolishRequirements(e.target.value)}
            autoFocus
          />
        </div>
      </Modal>

      {/* 角色测试对话模态框 */}
      {testChatCharacter && (
        <CharacterTestChat
          characterInfo={testChatCharacter}
          open={isTestChatOpen}
          onClose={() => {
            setIsTestChatOpen(false);
            setTestChatCharacter(null);
            setTestChatAvatar(undefined);
          }}
          avatarPath={testChatAvatar}
        />
      )}
    </div>
  );
};

export default CharacterManager;