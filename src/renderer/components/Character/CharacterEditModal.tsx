import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Space, Checkbox, Input, message, Tabs, Alert } from 'antd';
import { PlusOutlined, StopOutlined, UserOutlined, MessageOutlined, SettingOutlined, SmileOutlined, RobotOutlined } from '@ant-design/icons';
import { FieldEditor } from './FieldEditor';
import { WorldBookRelationPanel } from './WorldBookRelationPanel';
import { useCharacterAIOperations } from './hooks/useCharacterAIOperations';
import { useCharacterCardAssistant } from './hooks/useCharacterCardAssistant';
import CharacterCardAssistant from './CharacterCardAssistant';
import AssetManagerModal from './CharacterDialogueChat/AssetManagerModal';
import type { AIEngine } from '../../types/setting';

/**
 * 将任意格式的图片 Data URL 转换为 PNG 格式的 Data URL。
 *
 * 角色卡载体格式要求为 PNG（tEXt chunks 仅能嵌入 PNG），但前端文件选择器
 * 接受 image/* 。对于 JPG/WebP 等非 PNG 格式，需要先通过 canvas 转换为
 * PNG，否则后端 createCharacterFromImage 的 PNG 魔数校验会失败。
 *
 * 【重点标记 - 图片格式兼容性修复】此函数解决了非 PNG 格式图片无法用作
 * 角色卡载体的问题。
 */
function convertToPng(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取 canvas 上下文'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

export interface CharacterEditCharacter {
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

export interface CharacterEditModalProps {
  open: boolean;
  editingItem: CharacterEditCharacter | null;
  editingContent: any;
  formValues: any;
  setFormValues: React.Dispatch<React.SetStateAction<any>>;
  originalValues: any;
  setOriginalValues: React.Dispatch<React.SetStateAction<any>>;
  setEditingItem: React.Dispatch<React.SetStateAction<CharacterEditCharacter | null>>;
  setEditingContent: React.Dispatch<React.SetStateAction<any>>;
  worldBookRelations: any[];
  setWorldBookRelations: React.Dispatch<React.SetStateAction<any[]>>;
  worldBooks: Array<{ path: string; name: string }>;
  uploadedImage: string | null;
  setUploadedImage: React.Dispatch<React.SetStateAction<string | null>>;
  uploadedImageName: string;
  setUploadedImageName: React.Dispatch<React.SetStateAction<string>>;
  characterDir: string;
  addLog: (msg: string, level?: 'info' | 'error' | 'warn' | 'debug') => void;
  getActiveEngineConfig: () => AIEngine | null;
  onCancel: () => void;
  /**
   * Called after a successful save. `savedPath` is the absolute path of the
   * saved card (existing-card edit) or `null` for newly-created cards.
   * Parent uses this to refresh the character list and (if applicable) the
   * currently-open View modal content.
   */
  onSaved: (savedPath: string | null) => void;
}

/**
 * Character edit Modal — migrated from `CharacterManager.handleEditModalOk`
 * (originally ~182 lines) and the inline edit-modal JSX.
 *
 * The AI translate/polish/generate operations are delegated to the
 * `useCharacterAIOperations` hook, which is instantiated here so that the
 * parent (CharacterManager) doesn't need to know about AI internals.
 *
 * Behavior (updated — image replacement bug fix):
 *  - New-card branch requires an uploaded PNG (extracted as base64 and passed
 *    to `character.createFromImage`).
 *  - Existing-card branch: if the user uploaded a new image (`imageChanged`),
 *    calls `character.createFromImage` to rebuild the PNG with the new base
 *    image. Otherwise, writes the JSON content back via `character.write`.
 *  - All uploaded images are converted to PNG via canvas before processing,
 *    ensuring compatibility with the PNG character card carrier format.
 *  - Both branches persist world-book relations.
 */
const CharacterEditModal: React.FC<CharacterEditModalProps> = ({
  open,
  editingItem,
  editingContent,
  formValues,
  setFormValues,
  originalValues,
  setOriginalValues,
  setEditingItem,
  setEditingContent,
  worldBookRelations,
  setWorldBookRelations,
  worldBooks,
  uploadedImage,
  setUploadedImage,
  uploadedImageName,
  setUploadedImageName,
  characterDir,
  addLog,
  getActiveEngineConfig,
  onCancel,
  onSaved,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUploadLoading, setImageUploadLoading] = useState<boolean>(false);
  // 追踪用户是否更换了图片（区别于编辑时加载的原始图片）
  // 【重点标记 - 图片替换无效 Bug 修复】此状态用于判断编辑已有角色卡时
  // 是否需要调用 createFromImage 重建 PNG 文件（替换基底图片）
  const [imageChanged, setImageChanged] = useState<boolean>(false);

  // 模态框打开时重置 imageChanged，确保每次编辑会话的图片更换状态独立
  useEffect(() => {
    if (open) {
      setImageChanged(false);
    }
  }, [open]);

  const aiOps = useCharacterAIOperations({
    formValues,
    setFormValues,
    originalValues,
    addLog,
    getActiveEngineConfig,
  });

  // 智能助手 hook（Spec: add-ai-assistant-for-character-card-editor / Task 6）
  // 传递当前表单全部字段作为角色卡上下文，关闭编辑弹窗（modalOpen=false）时自动销毁面板状态
  const assistant = useCharacterCardAssistant({
    characterData: formValues,
    getActiveEngineConfig,
    addLog,
    modalOpen: open,
  });

  const {
    translatingField,
    polishingField,
    generatingField,
    handleTranslate,
    handlePolish,
    openGenerateModal,
    handleRestore,
    handleCancelAIRequest,
    performPolish,
    performGenerate,
    isPolishModalOpen,
    setIsPolishModalOpen,
    polishRequirements,
    setPolishRequirements,
    setCurrentPolishField,
    setCurrentPolishText,
    isGenerateModalOpen,
    setIsGenerateModalOpen,
    generateRequirements,
    setGenerateRequirements,
    setCurrentGenerateField,
  } = aiOps;

  const handleEditModalOk = useCallback(async () => {
    addLog(`[Character] 开始保存角色卡: ${editingItem?.name || '未命名'}`);
    try {
      if (!editingItem) {
        addLog(`[Character] 错误: editingItem 为空`, 'error');
        message.error('保存失败: 编辑项为空');
        return;
      }

      addLog(`[Character] editingItem.path: ${editingItem.path || '(空，新建模式)'}`);
      addLog(`[Character] 已上传图片: ${uploadedImage ? '是' : '否'}`);
      addLog(`[Character] uploadedImageName: ${uploadedImageName || '(空)'}`);

      // 处理表单数据
      const updatedData = {
        ...(editingContent?.data || {}),
        name: formValues.name || '',
        description: formValues.description || '',
        personality: formValues.personality || '',
        scenario: formValues.scenario || '',
        first_mes: formValues.first_mes || '',
        mes_example: (formValues.mes_example || '').split('\n\n').filter((item: string) => item),
        creator_notes: formValues.creator_notes || '',
        nickname: formValues.nickname || '',
        source: formValues.source || '',
        character_version: formValues.character_version || '',
        creator: formValues.creator || '',
        tags: (formValues.tags || '').split(/[,，]/).map((item: string) => item.trim()).filter((item: string) => item),
        system_prompt: formValues.system_prompt || '',
        post_history_instructions: formValues.post_history_instructions || '',
        alternate_greetings: (formValues.alternate_greetings || '').split('\n\n').filter((item: string) => item),
        group_only_greetings: formValues.group_only_greetings || ''
      };

      addLog(`[Character] 处理后的表单数据字段数: ${Object.keys(updatedData).length}`);

      const updatedContent = {
        ...(editingContent || {}),
        data: updatedData
      };

      // 如果是新建角色卡且有上传的图片，需要先处理图片
      if (!editingItem.path && uploadedImage) {
        try {
          addLog(`[Character] === 新建角色卡流程 ===`);
          addLog(`[Character] 步骤1: 提取图片base64数据...`);

          const dataUrlPrefix = 'data:';
          if (!uploadedImage.startsWith(dataUrlPrefix)) {
            throw new Error('无效的图片数据格式');
          }

          const commaIndex = uploadedImage.indexOf(',');
          if (commaIndex === -1) {
            throw new Error('图片数据格式错误: 未找到逗号分隔符');
          }
          const base64String = uploadedImage.substring(commaIndex + 1);
          addLog(`[Character] Base64字符串长度: ${base64String.length}`);

          const charName = formValues.name || 'unnamed';
          const fileName = charName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_') + '.png';
          addLog(`[Character] 生成的文件名: ${fileName}`);

          addLog(`[Character] 步骤2: 获取角色卡目录...`);
          const charDir = characterDir || (await window.electronAPI.setting.getCharacterDir());
          addLog(`[Character] 角色卡目录: ${charDir}`);

          if (!charDir) {
            throw new Error('角色卡目录为空');
          }

          const fullPath = charDir.replace(/[/\\]+$/, '') + '/' + fileName;
          addLog(`[Character] 完整保存路径: ${fullPath}`);

          addLog(`[Character] 步骤3: 调用createFromImage...`);
          const createResult = await window.electronAPI.character.createFromImage(fullPath, base64String, updatedContent);
          addLog(`[Character] createFromImage 返回结果: ${JSON.stringify(createResult)}`);

          if (!createResult.success) {
            throw new Error(`创建角色卡PNG失败: ${createResult.error || '未知错误'}`);
          }
          addLog(`[Character] 角色卡PNG创建成功`);

          addLog(`[Character] 步骤4: 保存世界书关联...`);
          const relationsToSave = worldBookRelations.map(rel => ({
            worldBookPath: rel.worldBookPath,
            enabled: rel.enabled,
            priority: rel.priority,
            filterTags: rel.filterTags
          }));
          addLog(`[Character] 世界书关联数量: ${relationsToSave.length}`);

          const relationsResult = await window.electronAPI.character.setWorldBookRelations(fullPath, relationsToSave);
          addLog(`[Character] setWorldBookRelations 返回结果: ${JSON.stringify(relationsResult)}`);

          addLog(`[Character] === 新建角色卡流程完成 ===`, 'info');
          message.success('角色卡创建成功');

          // 关闭编辑模态框（与原实现一致：清除本地状态后由父组件刷新列表）
          setEditingItem(null);
          setEditingContent(null);
          setFormValues({});
          setOriginalValues({});
          setUploadedImage(null);
          setUploadedImageName('');
          setImageChanged(false);
          onSaved(null);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : '';
          addLog(`[Character] === 新建角色卡失败 ===`, 'error');
          addLog(`[Character] 错误信息: ${errorMsg}`, 'error');
          if (errorStack) {
            addLog(`[Character] 错误堆栈: ${errorStack.substring(0, 500)}`, 'error');
          }
          message.error(`保存角色卡失败: ${errorMsg}`);
          throw error; // Re-throw to be caught by outer catch
        }
      } else if (editingItem.path) {
        // 已有路径的编辑模式
        // 【重点标记 - 图片替换无效 Bug 修复】
        // 原实现仅调用 character.write，只更新 tEXt chunks，完全忽略用户上传的新图片。
        // 修复后：当检测到用户更换了图片（imageChanged && uploadedImage），使用
        // createFromImage 以新图片为载体重建 PNG 文件，确保基底图片被正确替换。
        if (imageChanged && uploadedImage) {
          addLog(`[Character] 检测到图片更换，使用新图片重建角色卡: ${editingItem.path}`);

          const dataUrlPrefix = 'data:';
          if (!uploadedImage.startsWith(dataUrlPrefix)) {
            throw new Error('无效的图片数据格式');
          }
          const commaIndex = uploadedImage.indexOf(',');
          if (commaIndex === -1) {
            throw new Error('图片数据格式错误: 未找到逗号分隔符');
          }
          const base64String = uploadedImage.substring(commaIndex + 1);
          addLog(`[Character] 新图片 base64 长度: ${base64String.length}`);

          addLog(`[Character] 调用 createFromImage 替换基底图片...`);
          const replaceResult = await window.electronAPI.character.createFromImage(
            editingItem.path, base64String, updatedContent
          );
          addLog(`[Character] createFromImage 返回: ${JSON.stringify(replaceResult)}`);

          if (!replaceResult.success) {
            throw new Error(`替换图片失败: ${replaceResult.error || '未知错误'}`);
          }
          addLog(`[Character] 基底图片替换成功`, 'info');
        } else {
          addLog(`[Character] 写入文件（仅更新数据）: ${editingItem.path}`);
          await window.electronAPI.character.write(editingItem.path, updatedContent);
        }

        const relationsToSave = worldBookRelations.map(rel => ({
          worldBookPath: rel.worldBookPath,
          enabled: rel.enabled,
          priority: rel.priority,
          filterTags: rel.filterTags
        }));
        await window.electronAPI.character.setWorldBookRelations(editingItem.path, relationsToSave);

        addLog(`[Character] 角色卡编辑保存成功: ${editingItem.name}`, 'info');
        message.success('编辑成功');

        setEditingItem(null);
        setEditingContent(null);
        setFormValues({});
        setOriginalValues({});
        setUploadedImage(null);
        setUploadedImageName('');
        setImageChanged(false);
        onSaved(editingItem.path);
      } else {
        // 新建角色卡但没有上传图片
        message.warning('请上传一张PNG格式的图片作为角色卡载体');
      }
    } catch (error) {
      // 检查是否已经处理过的错误（从内层重新抛出的）
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`[Character] === 保存角色卡异常 ===`, 'error');
      addLog(`[Character] 编辑项: ${editingItem?.name || '未命名'}`, 'error');
      addLog(`[Character] 编辑项路径: ${editingItem?.path || '(空，新建)'}`, 'error');
      addLog(`[Character] 错误信息: ${errorMsg}`, 'error');
      if (error instanceof Error && error.stack) {
        addLog(`[Character] 错误堆栈: ${error.stack.substring(0, 500)}`, 'error');
      }

      // 只有当错误信息还没有被内层处理时才显示message
      if (!errorMsg.includes('请上传') && !errorMsg.includes('新建角色卡')) {
        message.error(`保存角色卡失败: ${errorMsg}`);
      }
    }
  }, [
    addLog, characterDir, editingContent, editingItem, formValues, imageChanged, onSaved,
    originalValues, setEditingContent, setEditingItem, setFormValues,
    setOriginalValues, setUploadedImage, setUploadedImageName, uploadedImage,
    uploadedImageName, worldBookRelations,
  ]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageUploadLoading(true);
      try {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const rawDataUrl = ev.target?.result as string;
          try {
            // 【重点标记 - 图片格式兼容性修复】
            // 将任意格式图片转换为 PNG，确保与角色卡载体格式兼容。
            // canvas 转换会去除原始文件中的 tEXt chunks（包括旧的 chara/ccv3），
            // 这正是图片替换所需的——获得纯净的新图片作为载体。
            const pngDataUrl = await convertToPng(rawDataUrl);
            setUploadedImage(pngDataUrl);
          } catch {
            // 转换失败时回退到原始 Data URL（PNG 图片无需转换也能工作）
            setUploadedImage(rawDataUrl);
          }
          setUploadedImageName(file.name);
          setImageChanged(true);
          setImageUploadLoading(false);
        };
        reader.onerror = () => {
          message.error('图片读取失败');
          setImageUploadLoading(false);
        };
        reader.readAsDataURL(file);
      } catch (error) {
        message.error('图片读取失败');
        setImageUploadLoading(false);
      }
    }
    if (e.target) e.target.value = '';
  }, [setUploadedImage, setUploadedImageName]);

  const handleRemoveImage = useCallback(() => {
    setUploadedImage(null);
    setUploadedImageName('');
    setImageChanged(true);
  }, [setUploadedImage, setUploadedImageName]);

  const handlePolishModalClose = useCallback(() => {
    if (!polishingField) {
      setIsPolishModalOpen(false);
      setCurrentPolishField(null);
      setCurrentPolishText('');
      setPolishRequirements('');
    }
  }, [polishingField, setIsPolishModalOpen, setCurrentPolishField, setCurrentPolishText, setPolishRequirements]);

  const handlePolishModalCancel = useCallback(() => {
    setIsPolishModalOpen(false);
    setCurrentPolishField(null);
    setCurrentPolishText('');
    setPolishRequirements('');
  }, [setIsPolishModalOpen, setCurrentPolishField, setCurrentPolishText, setPolishRequirements]);

  const handleGenerateModalClose = useCallback(() => {
    if (!generatingField) {
      setIsGenerateModalOpen(false);
      setCurrentGenerateField(null);
      setGenerateRequirements('');
    }
  }, [generatingField, setIsGenerateModalOpen, setCurrentGenerateField, setGenerateRequirements]);

  const handleGenerateModalCancel = useCallback(() => {
    setIsGenerateModalOpen(false);
    setCurrentGenerateField(null);
    setGenerateRequirements('');
  }, [setIsGenerateModalOpen, setCurrentGenerateField, setGenerateRequirements]);

  const fieldEditorCommonProps = useMemo(() => ({
    onTranslate: handleTranslate,
    onPolish: handlePolish,
    onGenerate: openGenerateModal,
    onRestore: handleRestore,
    onCancelAIRequest: handleCancelAIRequest,
    translatingField,
    polishingField,
    generatingField,
  }), [handleTranslate, handlePolish, openGenerateModal, handleRestore, handleCancelAIRequest, translatingField, polishingField, generatingField]);

  const setField = useCallback((field: string) => (value: any) => {
    setFormValues((prev: any) => ({ ...prev, [field]: value }));
  }, [setFormValues]);

  // 【Task 2 - 立绘替换角色卡图片回调】
  // 用户在素材管理 Tab 的立绘子页签点击「设为角色卡图片」并确认后，AssetManagerModal
  // 通过 onCardImageReplaced 回调通知本组件。此时 PNG 文件已在磁盘上重建（新图 + 原 JSON），
  // 因此：1) 更新 uploadedImage 预览显示新图片；2) 重置 imageChanged=false，保存时仅 write JSON
  // 而非再次 createFromImage（避免重复重建）。
  const handleCardImageReplaced = useCallback((newImageDataUrl: string) => {
    setUploadedImage(newImageDataUrl);
    setImageChanged(false);
  }, [setUploadedImage, setImageChanged]);

  return (
    <>
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>编辑角色卡: {editingItem?.name}</span>
            <Button
              size="small"
              icon={<RobotOutlined />}
              type={assistant.isOpen ? 'primary' : 'default'}
              onClick={assistant.togglePanel}
              title={assistant.isOpen ? '收起智能助手' : '展开智能助手'}
            >
              智能助手
            </Button>
          </div>
        }
        open={open}
        onCancel={onCancel}
        onOk={handleEditModalOk}
        width="90vw"
        style={{ maxWidth: 1400, top: 20 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', paddingRight: 8 } }}
      >
        {/* 图片上传区域 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#1890ff' }}>
            角色图片{editingItem?.path ? '' : '（必需）'}
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {uploadedImage ? (
              <>
                <img
                  src={uploadedImage}
                  alt="角色图片"
                  style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-base, #333)' }}
                />
                <div>
                  <div style={{ color: 'var(--text-primary, #ffffff)', marginBottom: 4 }}>
                    {uploadedImageName}
                  </div>
                  <Space>
                    <Button
                      size="small"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={imageUploadLoading}
                    >
                      {imageUploadLoading ? '加载中...' : '更换图片'}
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={handleRemoveImage}
                    >
                      移除图片
                    </Button>
                  </Space>
                </div>
              </>
            ) : (
              <div>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageUploadLoading}
                >
                  {imageUploadLoading ? '加载图片中...' : '上传角色图片'}
                </Button>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary, #8c8c8c)' }}>
                  {editingItem?.path ? '更换图片将覆盖当前角色卡载体' : '保存角色卡需要PNG格式的图片载体'}
                </div>
              </div>
            )}
          </div>
        </div>

        <Tabs
          onChange={() => assistant.closePanel()}
          items={[
            {
              key: 'core',
              label: <span><UserOutlined /> 角色信息</span>,
              children: (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                  {/* 左列：基本信息 */}
                  <div>
                    <FieldEditor
                      label="角色名称"
                      field="name"
                      value={formValues.name}
                      onChange={setField('name')}
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="昵称"
                      field="nickname"
                      value={formValues.nickname}
                      onChange={setField('nickname')}
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="来源"
                      field="source"
                      value={formValues.source}
                      onChange={setField('source')}
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="创建者"
                      field="creator"
                      value={formValues.creator}
                      onChange={setField('creator')}
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="版本信息"
                      field="character_version"
                      value={formValues.character_version}
                      onChange={setField('character_version')}
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="标签（用逗号分隔）"
                      field="tags"
                      value={formValues.tags}
                      onChange={setField('tags')}
                      {...fieldEditorCommonProps}
                    />
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

                  {/* 右列：描述、个性、场景 */}
                  <div>
                    <FieldEditor
                      label="描述"
                      field="description"
                      value={formValues.description}
                      onChange={setField('description')}
                      inputType="textarea"
                      autoSize={{ minRows: 6, maxRows: 16 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="个性"
                      field="personality"
                      value={formValues.personality}
                      onChange={setField('personality')}
                      inputType="textarea"
                      autoSize={{ minRows: 4, maxRows: 12 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="场景"
                      field="scenario"
                      value={formValues.scenario}
                      onChange={setField('scenario')}
                      inputType="textarea"
                      autoSize={{ minRows: 4, maxRows: 10 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                  </div>
                </div>
              ),
            },
            {
              key: 'messages',
              label: <span><MessageOutlined /> 对话与指令</span>,
              children: (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                  {/* 左列：消息类字段 */}
                  <div>
                    <FieldEditor
                      label="初始消息"
                      field="first_mes"
                      value={formValues.first_mes}
                      onChange={setField('first_mes')}
                      inputType="textarea"
                      autoSize={{ minRows: 6, maxRows: 18 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="示例消息（每条消息占一行）"
                      field="mes_example"
                      value={formValues.mes_example}
                      onChange={setField('mes_example')}
                      inputType="textarea"
                      autoSize={{ minRows: 6, maxRows: 18 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="替代问候（每条问候占一行）"
                      field="alternate_greetings"
                      value={formValues.alternate_greetings}
                      onChange={setField('alternate_greetings')}
                      inputType="textarea"
                      autoSize={{ minRows: 4, maxRows: 12 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                  </div>

                  {/* 右列：指令类字段 */}
                  <div>
                    <FieldEditor
                      label="系统提示"
                      field="system_prompt"
                      value={formValues.system_prompt}
                      onChange={setField('system_prompt')}
                      inputType="textarea"
                      autoSize={{ minRows: 5, maxRows: 16 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="历史记录后指令"
                      field="post_history_instructions"
                      value={formValues.post_history_instructions}
                      onChange={setField('post_history_instructions')}
                      inputType="textarea"
                      autoSize={{ minRows: 4, maxRows: 12 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                    <FieldEditor
                      label="创建者笔记"
                      field="creator_notes"
                      value={formValues.creator_notes}
                      onChange={setField('creator_notes')}
                      inputType="textarea"
                      autoSize={{ minRows: 4, maxRows: 12 }}
                      showGenerate
                      {...fieldEditorCommonProps}
                    />
                  </div>
                </div>
              ),
            },
            {
              key: 'worldbook',
              label: <span><SettingOutlined /> 世界书关联</span>,
              children: (
                <WorldBookRelationPanel
                  characterId={editingItem?.path || ''}
                  relations={worldBookRelations}
                  availableWorldBooks={worldBooks}
                  onChange={setWorldBookRelations}
                />
              ),
            },
            {
              key: 'expressions',
              label: <span><SmileOutlined /> 素材管理</span>,
              // 【重点标记 - 体验优化】原 Tab 仅展示 Alert + 「打开表情管理」按钮，需二次点击才能
              // 进入管理面板，与其他三个 Tab（角色信息/对话与指令/世界书关联）的功能复杂度不成正比。
              // 现改为内联渲染 AssetManagerModal（inline=true），直接在 Tab 内呈现完整的 5 个子 Tab
              // （表情/立绘/一般图像/三视图/角色特征），与其他 Tab 体验一致。
              // Spec: add-asset-and-trait-management / Task 11 + 本次体验优化
              children: (
                <div style={{ padding: '8px 0' }}>
                  {editingItem?.path ? (
                    <AssetManagerModal
                      open={open}
                      inline={true}
                      characterCardId={editingItem.path}
                      characterName={formValues.name || editingItem?.name || '未命名'}
                      characterDescription={formValues.description || ''}
                      characterPersonality={formValues.personality || ''}
                      characterScenario={formValues.scenario || ''}
                      avatarPath={uploadedImage || undefined}
                      onClose={() => {}}
                      onCardImageReplaced={handleCardImageReplaced}
                    />
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="请先保存角色卡"
                      description="新建角色卡需先填写角色信息并保存（生成 PNG 文件）后，才能管理素材。请先保存，然后再次打开编辑即可管理素材。"
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
        {/* 智能助手悬浮面板（Spec: add-ai-assistant-for-character-card-editor / Task 6） */}
        <CharacterCardAssistant open={assistant.isOpen} assistant={assistant} />
      </Modal>

      {/* AI润色要求模态框 */}
      <Modal
        title="AI润色"
        open={isPolishModalOpen}
        onCancel={handlePolishModalClose}
        closable={!polishingField}
        maskClosable={!polishingField}
        footer={polishingField ? [
          <Button key="interrupt" danger icon={<StopOutlined />} onClick={handleCancelAIRequest}>
            中断请求
          </Button>
        ] : [
          <Button key="cancel" onClick={handlePolishModalCancel}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={performPolish}>
            开始润色
          </Button>
        ]}
      >
        <div>
          <p>请输入润色要求（例如：风格偏向可爱、更加正式、增加细节等）：</p>
          <Input.TextArea
            rows={4}
            placeholder="请输入润色要求"
            value={polishRequirements}
            onChange={(e) => setPolishRequirements(e.target.value)}
            autoFocus
            disabled={polishingField !== null}
          />
        </div>
      </Modal>

      {/* AI生成指导模态框 */}
      <Modal
        title="AI生成"
        open={isGenerateModalOpen}
        onCancel={handleGenerateModalClose}
        closable={!generatingField}
        maskClosable={!generatingField}
        footer={generatingField ? [
          <Button key="interrupt" danger icon={<StopOutlined />} onClick={handleCancelAIRequest}>
            中断请求
          </Button>
        ] : [
          <Button key="cancel" onClick={handleGenerateModalCancel}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={performGenerate}>
            确认生成
          </Button>
        ]}
      >
        <div>
          <p>请输入生成要求（例如：风格偏向可爱、更加正式、增加细节等）：</p>
          <Input.TextArea
            rows={4}
            placeholder="请输入生成要求（选填，如：风格偏向正式、增加细节描述等）"
            value={generateRequirements}
            onChange={(e) => setGenerateRequirements(e.target.value)}
            autoFocus
            disabled={generatingField !== null}
          />
        </div>
      </Modal>
    </>
  );
};

export default React.memo(CharacterEditModal);
