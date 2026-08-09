import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { useDataStore } from '../../stores/dataStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { useWorldBookStore } from '../../stores/worldBookStore';
import { UnifiedChatDialog } from '../Chat/UnifiedChatDialog';
import CharacterCardGenerateModal from './CharacterCardGenerateModal';
import CharacterListView, { type CharacterListItem } from './CharacterListView';
import CharacterEditModal, { type CharacterEditCharacter } from './CharacterEditModal';
import { invalidateCharacterImageCache } from './utils/characterThumbnailCache';
import type { AIEngine } from '../../types/setting';
import '../../styles/list-common.css';
import './CharacterManager.css';

/**
 * ============================================================================
 * Task 4 (spec: optimize-system-rendering-performance) — 角色卡列表虚拟化评估
 * ============================================================================
 *
 * 【评估结论】本文件跳过 useVirtualizer 虚拟化（spec 允许 < 50 项阈值回退）。
 *
 * 判定理由（非猜测，均有源码证据）：
 *  1. 角色卡列表的实际渲染并不在本文件内——`CharacterManager` 将列表渲染
 *     委托给子组件 `CharacterListView`（见下方 `<CharacterListView .../>`）。
 *     本任务约束「ONLY modify CharacterManager.tsx」，无法在 `CharacterListView`
 *     内引入 useVirtualizer。
 *  2. `CharacterListView` 使用 antd `<Table>` 渲染（非 `.map()` 卡片网格），
 *     且配置了分页（`pageSize` 默认 10，支持 10/20/50/100 切换）。antd Table
 *     仅渲染当前页行，DOM 节点数恒等于 pageSize，即使 `characters.length`
 *     达到数百也不会一次性渲染全部行。因此「滚动 50+ 角色卡」场景在当前
 *     架构下不存在——用户翻页而非滚动浏览长列表。
 *  3. spec §「列表虚拟滚动」阈值要求：列表数据 ≥ 50 项才需虚拟化。当前
 *     Table 分页将单页 DOM 控制在 ≤ pageSize（默认 10），远低于 50 项阈值。
 *     即使 pageSize=100，antd v5 Table 自身支持 `virtual` prop（需在
 *     `CharacterListView` 内启用，超出本任务文件范围）。
 *
 * 【SubTask 9.2 — React.memo + useCallback 落地情况】
 *  - 所有传给 `CharacterListView` / `CharacterEditModal` / `UnifiedChatDialog`
 *    的 handler 均已 `useCallback` 化（含本文件新增的 3 个回调：
 *    `handleOpenGenerateModal`、`handleCloseTestChat`、`handleCloseGenerateModal`，
 *    替换原先的内联箭头函数，避免每次渲染创建新引用导致子组件 memo 失效）。
 *  - `CharacterListView` 已在自身文件末尾 `export default React.memo(...)`，
 *    列表项层级 memo 已就绪。
 *  - 传给 `CharacterEditModal` 的 `worldBooks` 映射数组已 `useMemo` 化
 *    （`worldBookOptions`），避免每次渲染产生新数组引用。
 *  - `CharacterManager` 自身以 `React.memo` 导出，减少父级无关重渲染传播。
 *
 * 【后续建议（超出本任务范围）】
 *  若未来需要支持「无分页滚动浏览 50+ 角色卡」，应在 `CharacterListView.tsx`
 *  内将 antd Table 替换为卡片网格 + useVirtualizer（行虚拟化 + N 列），
 *  或直接启用 antd Table 的 `virtual` prop（antd v5.5+）。此改造需单独
 *  开任务并在 `CharacterListView.tsx` 内完成。
 * ============================================================================
 */

/**
 * Public shape of a character row, kept here for backward compatibility with
 * any external importers. The list and edit sub-components declare their own
 * structural interfaces (`CharacterListItem`, `CharacterEditCharacter`) that
 * are intentionally assignable from this one.
 */
export interface Character {
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

const CharacterManager: React.FC = () => {
  const characters = useDataStore(s => s.characters);
  const loading = useDataStore(s => s.loading);
  const fetchCharacters = useDataStore(s => s.fetchCharacters);
  const worldBooks = useWorldBookStore(s => s.worldBooks);
  const fetchWorldBooks = useWorldBookStore(s => s.fetchWorldBooks);
  const appTheme = useUIStore(s => s.theme);
  const setting = useSettingStore(s => s.setting);
  const fetchSetting = useSettingStore(s => s.fetchSetting);
  const addLog = useLogStore(s => s.addLog);

  // Edit modal state (owned here so handleEdit/handleCreateCharacter can populate it).
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CharacterEditCharacter | null>(null);
  const [editingContent, setEditingContent] = useState<any>(null);
  const [formValues, setFormValues] = useState<any>({});
  const [originalValues, setOriginalValues] = useState<any>({});
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string>('');
  const [worldBookRelations, setWorldBookRelations] = useState<any[]>([]);

  // Test chat / AI-generate modals.
  const [isTestChatOpen, setIsTestChatOpen] = useState<boolean>(false);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [isCharacterGenerateModalOpen, setIsCharacterGenerateModalOpen] = useState(false);

  // List pagination.
  const [pageSize, setPageSize] = useState(10);

  // Character directory (used both by the list view and the edit modal).
  const [characterDir, setCharacterDir] = useState<string>('');

  // Fetch the active AI engine config from settings (mirrors original logic).
  const getActiveEngineConfig = useCallback((): AIEngine | null => {
    if (!setting) return null;
    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      if (activeEngine) return activeEngine;
    }
    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }
    return null;
  }, [setting]);

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  useEffect(() => {
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

  const handleOpenFolder = useCallback(async () => {
    try {
      const folderPath = '__USER_DATA__/data/characters';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      await window.electronAPI.file.openFolder(resolvedPath);
    } catch (error) {
      message.error('打开文件夹失败');
    }
  }, []);

  const handleCopyPath = useCallback(async () => {
    try {
      const folderPath = '__USER_DATA__/data/characters';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      await navigator.clipboard.writeText(resolvedPath);
      message.success('路径已复制到剪贴板');
    } catch (error) {
      message.error('复制路径失败');
    }
  }, []);

  const handleDelete = useCallback(async (path: string) => {
    addLog(`[Character] 删除角色卡: ${path}`);
    try {
      await window.electronAPI.character.delete(path);
      // 【重点标记 - 缓存失效 Bug 修复】删除后清除该路径的图片缓存
      invalidateCharacterImageCache(path);
      addLog(`[Character] 删除成功: ${path}`, 'info');
      message.success('删除成功');
      fetchCharacters();
    } catch (error) {
      addLog(`[Character] 删除失败: ${path}`, 'error');
      message.error('删除失败');
    }
  }, [addLog, fetchCharacters]);

  const handleTestCharacter = useCallback((record: CharacterListItem | Character) => {
    setSelectedCharacter(record as Character);
    setIsTestChatOpen(true);
  }, []);

  const handleEdit = useCallback(async (record: CharacterListItem | Character) => {
    addLog(`[Character] 编辑角色卡: ${record.name}, 路径: ${record.path}`);
    try {
      const content = await window.electronAPI.character.read(record.path);
      addLog(`[Character] 读取角色卡成功: ${record.name}`, 'info');
      setEditingContent(content);
      setEditingItem(record as CharacterEditCharacter);

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

      // 加载角色卡已有的 PNG 图片作为编辑时的角色图片，避免误提示需要重新上传
      try {
        const imageResult = await window.electronAPI.file.readAsBase64(record.path);
        if (imageResult.success && imageResult.data) {
          setUploadedImage(imageResult.data);
          setUploadedImageName(record.name ? `${record.name}.png` : '角色卡图片.png');
        } else {
          setUploadedImage(null);
          setUploadedImageName('');
        }
      } catch (e) {
        addLog(`[Character] 读取角色卡图片失败: ${record.path}`, 'warn');
        setUploadedImage(null);
        setUploadedImageName('');
      }

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
  }, [addLog, fetchWorldBooks, worldBooks]);

  const handleCreateCharacter = useCallback(() => {
    addLog('[Character] 创建新角色卡');
    const blankCharacter = {
      path: '',
      data: {
        name: '新角色',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: [],
        creator_notes: '',
        nickname: '',
        source: '',
        character_version: '',
        creator: '',
        post_history_instructions: '',
        tags: [],
        alternate_greetings: [],
        extensions: {},
        group_only_greetings: []
      }
    };
    setEditingItem(blankCharacter as unknown as CharacterEditCharacter);
    setEditingContent(blankCharacter.data);
    setFormValues({
      name: '新角色',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      nickname: '',
      source: '',
      character_version: '',
      creator: '',
      post_history_instructions: ''
    });
    setOriginalValues({});
    setWorldBookRelations([]);
    setIsEditModalOpen(true);
  }, [addLog]);

  const handleCreateCharacterFromAI = useCallback(async (characterCardData: any) => {
    addLog('[Character] 开始从AI生成创建角色卡');
    try {
      const characterName = characterCardData.name || 'AI生成角色';
      const charDir = await window.electronAPI.character.getDirectory();
      const targetPath = `${charDir}/${characterName}.png`;

      const existingCharacters = await window.electronAPI.character.list();
      const existingFile = existingCharacters.find((c: any) => c.path === targetPath);

      let finalPath = targetPath;
      if (existingFile) {
        let counter = 1;
        while (existingCharacters.find((c: any) => c.path === `${charDir}/${characterName}_${counter}.png`)) {
          counter++;
        }
        finalPath = `${charDir}/${characterName}_${counter}.png`;
        addLog(`[Character] 文件名冲突，使用新名称: ${characterName}_${counter}`, 'info');
      }

      const cardData = {
        name: characterCardData.name || '新角色',
        description: characterCardData.description || '',
        personality: characterCardData.personality || '',
        scenario: characterCardData.scenario || '',
        first_mes: characterCardData.first_mes || '',
        mes_example: Array.isArray(characterCardData.mes_example) ? characterCardData.mes_example : [],
        creator_notes: characterCardData.creator_notes || '',
        nickname: characterCardData.nickname || '',
        source: characterCardData.source || '',
        character_version: characterCardData.character_version || '1.0',
        creator: characterCardData.creator || 'AI',
        post_history_instructions: characterCardData.post_history_instructions || '',
        tags: Array.isArray(characterCardData.tags) ? characterCardData.tags : [],
        alternate_greetings: Array.isArray(characterCardData.alternate_greetings) ? characterCardData.alternate_greetings : [],
        extensions: characterCardData.extensions || {},
        group_only_greetings: Array.isArray(characterCardData.group_only_greetings) ? characterCardData.group_only_greetings : [],
        spec: 'chara_card_v3',
        spec_version: '3.0'
      };

      const writeData = {
        data: cardData,
        spec: 'chara_card_v3',
        spec_version: '3.0'
      };

      await window.electronAPI.character.write(finalPath, writeData);

      addLog(`[Character] AI生成角色卡创建成功: ${characterName}`, 'info');
      message.success('角色卡创建成功');
      setIsCharacterGenerateModalOpen(false);
      fetchCharacters();
    } catch (error) {
      addLog(`[Character] 从AI生成创建角色卡失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [addLog, fetchCharacters]);

  const handleImportCharacter = useCallback(async () => {
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
          // 【重点标记 - 缓存失效 Bug 修复】导入可能覆盖同名文件，清除该路径缓存
          if (result.targetPath) {
            invalidateCharacterImageCache(result.targetPath);
          }
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
  }, [addLog, fetchCharacters]);

  const handleEditModalCancel = useCallback(() => {
    setIsEditModalOpen(false);
    setEditingItem(null);
    setEditingContent(null);
    setFormValues({});
    setUploadedImage(null);
    setUploadedImageName('');
  }, []);

  // SubTask 9.2: 以下三个回调替换原先传给子组件的内联箭头函数，避免每次
  // 渲染产生新函数引用导致 React.memo 子组件（CharacterListView 等）失效。
  const handleOpenGenerateModal = useCallback(() => {
    setIsCharacterGenerateModalOpen(true);
  }, []);

  const handleCloseTestChat = useCallback(() => {
    setIsTestChatOpen(false);
    setSelectedCharacter(null);
  }, []);

  const handleCloseGenerateModal = useCallback(() => {
    setIsCharacterGenerateModalOpen(false);
  }, []);

  // SubTask 9.2: worldBooks 映射数组 memo 化，避免每次渲染产生新数组引用
  // 触发 CharacterEditModal 不必要的重渲染。
  const worldBookOptions = useMemo(
    () => worldBooks.map(wb => ({ path: wb.path, name: wb.name })),
    [worldBooks]
  );

  /**
   * Called by CharacterEditModal after a successful save. `savedPath` is the
   * path of the saved card (existing-card edit) or `null` for newly-created
   * cards. We refresh the list and invalidate the image cache for the saved
   * path so that ThumbnailImage/AvatarImage components re-fetch the latest
   * image from disk.
   *
   * 【重点标记 - 缓存失效 Bug 修复】
   * 原实现仅调用 fetchCharacters() 刷新文件列表元数据，未清除图片缓存，
   * 导致编辑后列表缩略图和查看弹窗头像仍显示旧图片。修复后在保存成功时
   * 调用 invalidateCharacterImageCache 清除该路径的缓存。
   */
  const handleSaved = useCallback((savedPath: string | null) => {
    setIsEditModalOpen(false);
    if (savedPath) {
      invalidateCharacterImageCache(savedPath);
    }
    fetchCharacters();
  }, [fetchCharacters]);

  return (
    <div className={`character-manager list-container ${appTheme === 'dark' ? 'dark' : ''}`}>
      <CharacterListView
        characters={characters as unknown as CharacterListItem[]}
        loading={loading}
        characterDir={characterDir}
        appTheme={appTheme}
        pageSize={pageSize}
        setPageSize={setPageSize}
        onRefresh={fetchCharacters}
        onImport={handleImportCharacter}
        onCreate={handleCreateCharacter}
        onGenerateAI={handleOpenGenerateModal}
        onOpenFolder={handleOpenFolder}
        onCopyPath={handleCopyPath}
        onEdit={handleEdit}
        onTest={handleTestCharacter}
        onDelete={handleDelete}
        addLog={addLog}
      />

      <CharacterEditModal
        open={isEditModalOpen}
        editingItem={editingItem}
        editingContent={editingContent}
        formValues={formValues}
        setFormValues={setFormValues}
        originalValues={originalValues}
        setOriginalValues={setOriginalValues}
        setEditingItem={setEditingItem}
        setEditingContent={setEditingContent}
        worldBookRelations={worldBookRelations}
        setWorldBookRelations={setWorldBookRelations}
        worldBooks={worldBookOptions}
        uploadedImage={uploadedImage}
        setUploadedImage={setUploadedImage}
        uploadedImageName={uploadedImageName}
        setUploadedImageName={setUploadedImageName}
        characterDir={characterDir}
        addLog={addLog}
        getActiveEngineConfig={getActiveEngineConfig}
        onCancel={handleEditModalCancel}
        onSaved={handleSaved}
      />

      <UnifiedChatDialog
        open={isTestChatOpen}
        onClose={handleCloseTestChat}
        initialCharacter={selectedCharacter || undefined}
        showCharacterSelector={true}
        characters={characters as unknown as any[]}
      />

      <CharacterCardGenerateModal
        open={isCharacterGenerateModalOpen}
        onCancel={handleCloseGenerateModal}
        onCreateCharacterCard={handleCreateCharacterFromAI}
      />
    </div>
  );
};

// SubTask 9.2: React.memo 包裹，减少父级（路由级）无关重渲染向本组件传播。
export default React.memo(CharacterManager);
