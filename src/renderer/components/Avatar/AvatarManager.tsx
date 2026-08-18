import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Space, message, Input, Upload, Avatar, Typography, Form, Modal, Popconfirm, Row, Col, Empty, Tag, Spin, Tooltip, Switch, Divider } from 'antd';
import { PlusOutlined, UploadOutlined, UserOutlined, SaveOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined, FolderOpenOutlined, CopyOutlined, ExperimentOutlined, PictureOutlined, ThunderboltOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useDataStore } from '../../stores/dataStore';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';
import { StoragePathDisplay } from '../common/StoragePathDisplay';
import type { UploadFile } from 'antd/es/upload/interface';
import type { PersonaTrait } from '../Character/CharacterDialogueChat/CharacterDialogueChat.types';
import PersonaImageGenerateModal from './PersonaImageGenerateModal';
import './AvatarManager.css';

const { Text, Title } = Typography;
const { TextArea } = Input;

const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_AVATAR_SIZE_MB = 5;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

// [perf] 列表数据量典型 < 50 项（用户人设为手工创建的少量条目），未启用虚拟滚动
//        （阈值 50）；已应用 React.memo + useCallback。若数据量增长可改用 useVirtualizer。

interface AvatarCardProps {
  src: string;
}

const AvatarCard = React.memo<AvatarCardProps>(({ src }) => {
  const [displayUrl, setDisplayUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadAvatar = async () => {
      setLoading(true);
      try {
        const result = await window.electronAPI.file.readAsBase64(src);
        if (mounted && result.success && result.data) {
          setDisplayUrl(result.data);
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadAvatar();
    return () => { mounted = false; };
  }, [src]);

  return (
    <Avatar
      size={120}
      src={displayUrl || undefined}
      icon={!displayUrl && !loading ? <UserOutlined /> : undefined}
    />
  );
});

interface UserAvatarProfile {
  id: string;
  name: string;
  description: string;
  avatarPath: string;
  createdAt: number;
  updatedAt: number;
  isGeneric?: boolean;
  isSystem?: boolean;
  traits?: PersonaTrait[];
  appearanceDescription?: string;
}

interface ProfileCardProps {
  profile: UserAvatarProfile;
  onEdit: (profile: UserAvatarProfile) => void;
  onDelete: (profile: UserAvatarProfile) => void;
}

/**
 * 单个人设卡片（React.memo）。
 */
const ProfileCard = React.memo<ProfileCardProps>(({ profile, onEdit, onDelete }) => (
  <Card
    hoverable
    className="avatar-card"
    onClick={() => onEdit(profile)}
    cover={
      <div className="avatar-card-cover">
        {profile.avatarPath ? (
          <AvatarCard src={profile.avatarPath} />
        ) : (
          <Avatar size={120} icon={<UserOutlined />} />
        )}
      </div>
    }
    actions={[
      <Button
        key="edit"
        type="text"
        icon={<EditOutlined />}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(profile);
        }}
      >
        编辑
      </Button>,
      <Popconfirm
        key="delete"
        title="确定删除此人设？"
        onConfirm={(e) => {
          e?.stopPropagation();
          onDelete(profile);
        }}
        onCancel={(e) => e?.stopPropagation()}
      >
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={(e) => e.stopPropagation()}
        >
          删除
        </Button>
      </Popconfirm>,
    ]}
  >
    <Card.Meta
      title={profile.name || '未命名'}
      description={
        <div>
          <div style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical'
          }}>
            {profile.description || '暂无描述'}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Tag>
              {new Date(profile.updatedAt).toLocaleDateString()}
            </Tag>
            {profile.traits && profile.traits.length > 0 && (
              <Tag color="blue">{profile.traits.length} 特征</Tag>
            )}
          </div>
        </div>
      }
    />
  </Card>
));

/** 生成的素材图片缩略图 */
interface PersonaAssetImage {
  id: string;
  dataUrl: string;
  createdAt: string;
}

const AvatarManager: React.FC = () => {
  const fetchAvatars = useDataStore(s => s.fetchAvatars);
  const addLog = useLogStore(s => s.addLog);

  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [profiles, setProfiles] = useState<UserAvatarProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<UserAvatarProfile | null>(null);
  const [avatarDir, setAvatarDir] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [avatarFileList, setAvatarFileList] = useState<UploadFile[]>([]);
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string>('');

  const [profileForm, setProfileForm] = useState({
    name: '',
    description: '',
    avatarPath: ''
  });

  // 特征分析状态
  const [traits, setTraits] = useState<PersonaTrait[]>([]);
  const [appearanceDescription, setAppearanceDescription] = useState<string>('');
  const [analyzingTraits, setAnalyzingTraits] = useState(false);

  // 图片生成弹窗
  const [imageGenOpen, setImageGenOpen] = useState(false);

  // 生成的素材图片
  const [assetImages, setAssetImages] = useState<PersonaAssetImage[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  useEffect(() => {
    const getAvatarDir = async () => {
      try {
        const dir = await window.electronAPI.avatar.getDirectory();
        setAvatarDir(dir);
      } catch (error) {
        addLog(`[Avatar] 获取人设目录失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    };
    getAvatarDir();
  }, [addLog]);

  const handleOpenFolder = async () => {
    try {
      if (!avatarDir) return;
      await window.electronAPI.file.openFolder(avatarDir);
    } catch (error) {
      message.error('打开文件夹失败');
    }
  };

  const handleCopyPath = async () => {
    try {
      if (!avatarDir) return;
      await navigator.clipboard.writeText(avatarDir);
      message.success('路径已复制到剪贴板');
    } catch (error) {
      message.error('复制路径失败');
    }
  };

  useEffect(() => {
    if (avatarDir) {
      loadProfiles();
    }
  }, [avatarDir]);

  const loadProfiles = useCallback(async () => {
    try {
      addLog('[Avatar] 加载用户人设列表');
      const avatars = await window.electronAPI.avatar.list();
      
      const loadedProfiles: UserAvatarProfile[] = [];
      
      for (const avatar of avatars) {
        if (avatar.path.endsWith('.json') && !avatar.path.includes('user-profile.json')) {
          try {
            const content = await window.electronAPI.avatar.read(avatar.path);
            if (content) {
              loadedProfiles.push({
                id: content.id || avatar.name.replace('.json', ''),
                name: content.name || '未命名',
                description: content.description || '',
                avatarPath: content.avatarPath || '',
                createdAt: content.createdAt || Date.now(),
                updatedAt: content.updatedAt || Date.now(),
                isGeneric: content.isGeneric || false,
                isSystem: content.isSystem || false,
                traits: content.traits || [],
                appearanceDescription: content.appearanceDescription || '',
              });
            }
          } catch (error) {
            addLog(`[Avatar] 读取人设失败: ${avatar.name}`, 'warn');
          }
        }
      }
      
      loadedProfiles.sort((a, b) => b.updatedAt - a.updatedAt);
      setProfiles(loadedProfiles);
      addLog(`[Avatar] 加载完成，共 ${loadedProfiles.length} 个人设`, 'info');
    } catch (error) {
      addLog(`[Avatar] 加载人设列表失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  }, [addLog]);

  // 加载人设素材图片
  const loadAssetImages = useCallback(async (personaId: string) => {
    if (!personaId) return;
    setLoadingAssets(true);
    try {
      const manifest = await window.electronAPI.personaAsset.list(personaId);
      const images: PersonaAssetImage[] = [];
      const assetIds = Object.keys(manifest.assets);
      for (const assetId of assetIds) {
        try {
          const pathResult = await window.electronAPI.personaAsset.getImagePath({
            personaId,
            imageId: assetId,
          });
          if (pathResult?.success && pathResult.imagePath) {
            const base64Result = await window.electronAPI.file.readAsBase64(pathResult.imagePath);
            if (base64Result?.success && base64Result.data) {
              images.push({
                id: assetId,
                dataUrl: base64Result.data,
                createdAt: manifest.assets[assetId].createdAt,
              });
            }
          }
        } catch (e) {
          console.warn('[Avatar] 加载素材图片失败:', assetId, e);
        }
      }
      images.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setAssetImages(images);
    } catch (e) {
      console.error('[Avatar] 加载素材列表失败:', e);
      setAssetImages([]);
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  const handleCreateProfile = useCallback(() => {
    const newProfile: UserAvatarProfile = {
      id: `profile-${Date.now()}`,
      name: '',
      description: '',
      avatarPath: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    setEditingProfile(newProfile);
    setProfileForm({ name: '', description: '', avatarPath: '' });
    setAvatarFileList([]);
    setTraits([]);
    setAppearanceDescription('');
    setAssetImages([]);
    setViewMode('detail');
  }, []);

  const handleEditProfile = useCallback(async (profile: UserAvatarProfile) => {
    setEditingProfile(profile);
    setProfileForm({
      name: profile.name,
      description: profile.description,
      avatarPath: profile.avatarPath
    });
    setTraits(profile.traits || []);
    setAppearanceDescription(profile.appearanceDescription || '');
    
    if (profile.avatarPath) {
      const originalPath = profile.avatarPath.replace(/\//g, '\\');
      addLog(`[Avatar] 编辑人设，尝试加载头像: ${originalPath}`, 'info');
      
      const readResult = await window.electronAPI.file.readAsBase64(originalPath);
      addLog(`[Avatar] 读取结果: success=${readResult.success}, hasData=${!!readResult.data}, error=${readResult.error || 'none'}`, 'info');
      
      if (readResult.success && readResult.data) {
        addLog(`[Avatar] 头像加载成功，数据长度: ${readResult.data.length}`, 'info');
        setAvatarDisplayUrl(readResult.data);
        setAvatarFileList([{
          uid: '-1',
          name: 'avatar',
          status: 'done',
          url: readResult.data
        }]);
      } else {
        addLog(`[Avatar] 头像加载失败: ${readResult.error}`, 'warn');
        setAvatarDisplayUrl('');
        setAvatarFileList([]);
      }
    } else {
      setAvatarFileList([]);
      setAvatarDisplayUrl('');
    }

    // 加载素材图片
    loadAssetImages(profile.id);
    
    setViewMode('detail');
  }, [addLog, loadAssetImages]);

  const handleDeleteProfile = useCallback(async (profile: UserAvatarProfile) => {
    // 系统内置预设不可删除
    if (profile.isSystem) {
      message.warning('系统内置预设不可删除');
      return;
    }
    try {
      if (profile.avatarPath) {
        try {
          await window.electronAPI.file.delete(profile.avatarPath);
          addLog(`[Avatar] 删除关联头像文件: ${profile.avatarPath}`, 'info');
        } catch (fileError) {
          addLog(`[Avatar] 删除头像文件失败（可能已不存在）: ${fileError instanceof Error ? fileError.message : '未知错误'}`, 'warn');
        }
      }

      // 清除人设素材
      try {
        await window.electronAPI.personaAsset.clearAll(profile.id);
      } catch {
        // ignore
      }
      
      const filePath = `${avatarDir}/${profile.id}.json`;
      await window.electronAPI.avatar.delete(filePath);
      addLog(`[Avatar] 删除人设成功: ${profile.name}`, 'info');
      message.success('删除成功');
      loadProfiles();
      
      if (viewMode === 'detail' && editingProfile?.id === profile.id) {
        setViewMode('list');
        setEditingProfile(null);
      }
    } catch (error) {
      addLog(`[Avatar] 删除人设失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error('删除失败');
    }
  }, [avatarDir, addLog, loadProfiles, viewMode, editingProfile]);

  const handleSaveProfile = useCallback(async () => {
    if (!profileForm.name.trim()) {
      message.warning('人设名称不能为空');
      return;
    }

    if (!editingProfile) return;

    setSaving(true);
    addLog(`[Avatar] 保存用户人设: ${profileForm.name}`);

    try {
      const filePath = `${avatarDir}/${editingProfile.id}.json`;
      const profileData: UserAvatarProfile = {
        id: editingProfile.id,
        name: profileForm.name.trim(),
        description: profileForm.description,
        avatarPath: profileForm.avatarPath,
        createdAt: editingProfile.createdAt,
        updatedAt: Date.now(),
        traits: traits.length > 0 ? traits : undefined,
        appearanceDescription: appearanceDescription || undefined,
      };

      await window.electronAPI.avatar.write(filePath, profileData);
      
      addLog('[Avatar] 用户人设保存成功', 'info');
      message.success('保存成功');
      
      setEditingProfile(profileData);
      setViewMode('list');
      loadProfiles();
    } catch (error) {
      addLog(`[Avatar] 保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [profileForm, editingProfile, avatarDir, addLog, loadProfiles, traits, appearanceDescription]);

  const handleSelectAvatar = useCallback(async () => {
    if (!avatarDir) {
      message.error('人设目录未初始化');
      return;
    }

    try {
      const selectedFilePath = await window.electronAPI.file.selectFile([
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
      ]);

      if (!selectedFilePath) {
        addLog('[Avatar] 用户取消选择文件');
        return;
      }

      const fileName = selectedFilePath.split(/[/\\]/).pop() || '';
      const fileExt = fileName.split('.').pop() || 'png';

      addLog(`[Avatar] 选择文件: ${fileName}, 路径: ${selectedFilePath}`);
      addLog(`[Avatar] avatarDir: ${avatarDir}`, 'info');

      const targetPath = avatarDir.replace(/\\/g, '/') + '/avatar-' + editingProfile?.id + '-' + Date.now() + '.' + fileExt;
      addLog(`[Avatar] 目标路径: ${targetPath}`, 'info');

      const copyResult = await window.electronAPI.file.copyFile(selectedFilePath, targetPath);

      if (copyResult.success) {
        addLog('[Avatar] 文件复制成功', 'info');
        
        const normalizedPath = targetPath;
        setProfileForm(prev => ({ ...prev, avatarPath: normalizedPath }));
        
        const existsResult = await window.electronAPI.file.exists(targetPath);
        addLog(`[Avatar] 文件存在性检查: ${existsResult}`, 'info');
        
        const readResult = await window.electronAPI.file.readAsBase64(targetPath);
        addLog(`[Avatar] 读取结果: success=${readResult.success}, hasData=${!!readResult.data}, error=${readResult.error || 'none'}`, 'info');
        if (readResult.success && readResult.data) {
          addLog(`[Avatar] 头像读取成功，数据长度: ${readResult.data.length}`);
          setAvatarDisplayUrl(readResult.data);
          setAvatarFileList([{
            uid: '-1',
            name: fileName,
            status: 'done',
            url: readResult.data
          }]);
        } else {
          addLog(`[Avatar] 头像读取失败: ${readResult.error}`, 'error');
          message.error(`头像显示失败: ${readResult.error}`);
        }
        
        addLog('[Avatar] 头像上传成功', 'info');
        message.success('头像上传成功');
      } else {
        addLog(`[Avatar] 头像上传失败: ${copyResult.error}`, 'error');
        message.error(`头像上传失败: ${copyResult.error}`);
      }
    } catch (error) {
      addLog('[Avatar] 头像上传异常', 'error');
      message.error(`头像上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [avatarDir, editingProfile, addLog]);

  // AI 特征分析（复用 ai:generateCharacterTraits IPC，纯文本模式）
  const handleAnalyzeTraits = useCallback(async () => {
    if (!editingProfile) return;
    if (!profileForm.description.trim()) {
      message.warning('请先输入用户设定描述');
      return;
    }

    setAnalyzingTraits(true);
    addLog('[Avatar] 开始 AI 特征分析');

    try {
      // 复用角色卡特征生成 IPC，纯文本模式（不传 includeImage）
      // characterCardId 使用人设 ID 作为日志关联键
      const result = await window.electronAPI.ai.generateCharacterTraits({
        characterCardId: editingProfile.id,
        description: profileForm.description,
        includeImage: false,
      });

      if (result?.success && result.traits) {
        // 将 CategorizedTrait 转为轻量 PersonaTrait
        const personaTraits: PersonaTrait[] = result.traits.map((t: any) => ({
          text: t.text,
          translation: t.translation,
          enabled: true,
        }));
        setTraits(personaTraits);
        if (result.appearanceDescription) {
          setAppearanceDescription(result.appearanceDescription);
        }
        addLog(`[Avatar] AI 特征分析完成，生成 ${personaTraits.length} 个特征`, 'info');
        message.success(`分析完成，生成 ${personaTraits.length} 个视觉特征`);
      } else {
        addLog(`[Avatar] AI 特征分析失败: ${result?.error}`, 'error');
        message.error(result?.error || '特征分析失败');
      }
    } catch (error) {
      addLog(`[Avatar] AI 特征分析异常: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(error instanceof Error ? error.message : '特征分析异常');
    } finally {
      setAnalyzingTraits(false);
    }
  }, [editingProfile, profileForm.description, addLog]);

  // 切换特征启用状态
  const handleToggleTrait = useCallback((index: number, enabled: boolean) => {
    setTraits(prev => prev.map((t, i) => i === index ? { ...t, enabled } : t));
  }, []);

  // 删除特征
  const handleRemoveTrait = useCallback((index: number) => {
    setTraits(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 删除素材图片
  const handleDeleteAsset = useCallback(async (imageId: string) => {
    if (!editingProfile) return;
    try {
      const result = await window.electronAPI.personaAsset.delete({
        personaId: editingProfile.id,
        imageId,
      });
      if (result?.success) {
        setAssetImages(prev => prev.filter(img => img.id !== imageId));
        message.success('删除成功');
      } else {
        message.error(result?.error || '删除失败');
      }
    } catch (e) {
      message.error('删除失败');
    }
  }, [editingProfile]);

  // 将素材图片设为头像
  // 流程：获取素材磁盘路径 → 复制到人设目录（avatar- 前缀）→ 更新表单和预览
  const handleSetAsAvatar = useCallback(async (imageId: string, dataUrl: string) => {
    if (!editingProfile || !avatarDir) return;

    try {
      // 获取素材图片的磁盘路径
      const pathResult = await window.electronAPI.personaAsset.getImagePath({
        personaId: editingProfile.id,
        imageId,
      });
      if (!pathResult?.success || !pathResult.imagePath) {
        message.error('获取素材路径失败');
        return;
      }

      // 复制到人设目录作为头像文件
      const targetPath = avatarDir.replace(/\\/g, '/') + '/avatar-' + editingProfile.id + '-' + Date.now() + '.png';
      const copyResult = await window.electronAPI.file.copyFile(pathResult.imagePath, targetPath);

      if (copyResult?.success) {
        // 删除旧头像文件（如果存在且不是当前选择的）
        if (profileForm.avatarPath && profileForm.avatarPath !== targetPath) {
          try {
            await window.electronAPI.file.delete(profileForm.avatarPath);
          } catch {
            // 旧文件可能已不存在，忽略
          }
        }

        setProfileForm(prev => ({ ...prev, avatarPath: targetPath }));
        setAvatarDisplayUrl(dataUrl);
        setAvatarFileList([{
          uid: '-1',
          name: 'avatar',
          status: 'done',
          url: dataUrl,
        }]);
        addLog('[Avatar] 素材图片已设为头像', 'info');
        message.success('已设为头像');
      } else {
        message.error(copyResult?.error || '设为头像失败');
      }
    } catch (e) {
      addLog(`[Avatar] 设为头像失败: ${e instanceof Error ? e.message : '未知错误'}`, 'error');
      message.error('设为头像失败');
    }
  }, [editingProfile, avatarDir, profileForm.avatarPath, addLog]);

  // 图片生成弹窗保存回调
  const handleImageSaved = useCallback(() => {
    if (editingProfile) {
      loadAssetImages(editingProfile.id);
    }
  }, [editingProfile, loadAssetImages]);

  const handleBackToList = useCallback(() => {
    setViewMode('list');
    setEditingProfile(null);
    setAvatarFileList([]);
    setTraits([]);
    setAppearanceDescription('');
    setAssetImages([]);
  }, []);

  if (viewMode === 'detail' && editingProfile) {
    return (
      <div className="avatar-manager">
        <div className="avatar-header">
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={handleBackToList}
            style={{ marginBottom: 16 }}
          >
            返回列表
          </Button>
          <Title level={2} style={{ margin: 0 }}>
            {profileForm.name || '新建人设'}
          </Title>
        </div>

        <Card className="profile-detail-card">
          <Form layout="vertical">
            <Form.Item label="人设名称" required>
              <Input
                value={profileForm.name}
                onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="请输入人设名称"
                maxLength={MAX_NAME_LENGTH}
                showCount
              />
            </Form.Item>

            <Form.Item label="用户设定描述">
              <TextArea
                value={profileForm.description}
                onChange={(e) => setProfileForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="请输入用户设定描述"
                rows={10}
                maxLength={MAX_DESCRIPTION_LENGTH}
                showCount
              />
            </Form.Item>

            {/* 视觉特征分析 */}
            <Divider>视觉特征</Divider>
            <Form.Item>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  icon={<ExperimentOutlined />}
                  onClick={handleAnalyzeTraits}
                  loading={analyzingTraits}
                  disabled={!profileForm.description.trim()}
                >
                  AI 特征分析（从描述提取视觉特征）
                </Button>

                {appearanceDescription && (
                  <div style={{
                    padding: '8px 12px',
                    background: 'var(--bg-container)',
                    borderRadius: 6,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                  }}>
                    <strong>外观描述：</strong>{appearanceDescription}
                  </div>
                )}

                {traits.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {traits.map((trait, i) => (
                      <Tooltip key={i} title={trait.translation || ''}>
                        <Tag
                          color={trait.enabled ? 'blue' : 'default'}
                          closable
                          onClose={() => handleRemoveTrait(i)}
                          style={{ cursor: 'pointer', opacity: trait.enabled ? 1 : 0.5 }}
                          onClick={() => handleToggleTrait(i, !trait.enabled)}
                        >
                          {trait.text}
                        </Tag>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </Space>
            </Form.Item>

            <Form.Item label="头像">
              <div className="avatar-upload-section">
                <Button 
                  icon={<UploadOutlined />}
                  onClick={handleSelectAvatar}
                >
                  {profileForm.avatarPath ? '更换头像' : '上传头像'}
                </Button>
                
                <div className="avatar-preview">
                  {avatarDisplayUrl ? (
                    <Avatar 
                      size={120} 
                      src={avatarDisplayUrl}
                      onError={() => {
                        setProfileForm(prev => ({ ...prev, avatarPath: '' }));
                        setAvatarDisplayUrl('');
                        setAvatarFileList([]);
                        return false;
                      }}
                    />
                  ) : (
                    <Avatar size={120} icon={<UserOutlined />} />
                  )}
                </div>
              </div>
            </Form.Item>

            {/* AI 立绘生成 */}
            <Divider>立绘生成</Divider>
            <Form.Item>
              <Button
                type="primary"
                ghost
                icon={<PictureOutlined />}
                onClick={() => setImageGenOpen(true)}
                disabled={traits.length === 0}
              >
                生成立绘
              </Button>
              {traits.length === 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  请先进行特征分析
                </span>
              )}
            </Form.Item>

            {/* 已生成素材图片 */}
            {loadingAssets ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Spin tip="加载素材..." />
              </div>
            ) : assetImages.length > 0 ? (
              <Form.Item label="已生成素材">
                <Row gutter={[8, 8]}>
                  {assetImages.map((img) => (
                    <Col key={img.id} xs={12} sm={8} md={6}>
                      <div style={{ position: 'relative' }}>
                        <img
                          src={img.dataUrl}
                          alt="生成素材"
                          style={{
                            width: '100%',
                            borderRadius: 8,
                            border: '1px solid var(--border-base)',
                          }}
                        />
                        <Tooltip title="设为头像">
                          <Button
                            size="small"
                            type="primary"
                            icon={<UserSwitchOutlined />}
                            style={{
                              position: 'absolute',
                              top: 4,
                              left: 4,
                              opacity: 0.7,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetAsAvatar(img.id, img.dataUrl);
                            }}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="确定删除此图片？"
                          onConfirm={() => handleDeleteAsset(img.id)}
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              opacity: 0.7,
                            }}
                          />
                        </Popconfirm>
                      </div>
                    </Col>
                  ))}
                </Row>
              </Form.Item>
            ) : null}

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSaveProfile}
                  loading={saving}
                  size="large"
                >
                  保存人设
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        {/* 立绘生成弹窗 */}
        <PersonaImageGenerateModal
          open={imageGenOpen}
          personaId={editingProfile.id}
          personaName={profileForm.name || '未命名'}
          traits={traits}
          onClose={() => setImageGenOpen(false)}
          onSaved={handleImageSaved}
        />
      </div>
    );
  }

  return (
    <div className="avatar-manager">
      <div className="avatar-header">
        <h2>用户人设管理</h2>
        <StoragePathDisplay
          label="人设存储路径"
          path={avatarDir}
          onOpenFolder={handleOpenFolder}
          onCopyPath={handleCopyPath}
        />
        <Space>
          <Button onClick={loadProfiles}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateProfile}>
            新建人设
          </Button>
        </Space>
      </div>

      {profiles.length === 0 ? (
        <Card>
          <Empty 
            description="暂无用户人设，点击右上角新建开始创建"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {profiles.map((profile) => (
            <Col xs={24} sm={12} md={8} lg={6} key={profile.id}>
              <ProfileCard
                profile={profile}
                onEdit={handleEditProfile}
                onDelete={handleDeleteProfile}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default AvatarManager;
