import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Space, message, Input, Upload, Avatar, Typography, Form, Modal, Popconfirm, Row, Col, Empty, Tag } from 'antd';
import { PlusOutlined, UploadOutlined, UserOutlined, SaveOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined, FolderOpenOutlined, CopyOutlined } from '@ant-design/icons';
import { useDataStore } from '../../stores/dataStore';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';
import { StoragePathDisplay } from '../common/StoragePathDisplay';
import type { UploadFile } from 'antd/es/upload/interface';
import './AvatarManager.css';

const { Text, Title } = Typography;
const { TextArea } = Input;

const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_AVATAR_SIZE_MB = 5;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

interface AvatarCardProps {
  src: string;
}

const AvatarCard: React.FC<AvatarCardProps> = ({ src }) => {
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
};

interface UserAvatarProfile {
  id: string;
  name: string;
  description: string;
  avatarPath: string;
  createdAt: number;
  updatedAt: number;
  isGeneric?: boolean;
  isSystem?: boolean;
}

const AvatarManager: React.FC = () => {
  const { fetchAvatars } = useDataStore();
  const { addLog } = useLogStore();

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
                isSystem: content.isSystem || false
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
    setViewMode('detail');
  }, []);

  const handleEditProfile = useCallback(async (profile: UserAvatarProfile) => {
    setEditingProfile(profile);
    setProfileForm({
      name: profile.name,
      description: profile.description,
      avatarPath: profile.avatarPath
    });
    
    if (profile.avatarPath) {
      // 将存储的正斜杠路径转换为 Windows 原始路径格式用于读取
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
    
    setViewMode('detail');
  }, [addLog]);

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
        updatedAt: Date.now()
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
  }, [profileForm, editingProfile, avatarDir, addLog, loadProfiles]);

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

      // 使用 path.join 风格的路径拼接，确保 Windows 兼容性
      const targetPath = avatarDir.replace(/\\/g, '/') + '/avatar-' + editingProfile?.id + '-' + Date.now() + '.' + fileExt;
      addLog(`[Avatar] 目标路径: ${targetPath}`, 'info');

      const copyResult = await window.electronAPI.file.copyFile(selectedFilePath, targetPath);

      if (copyResult.success) {
        addLog('[Avatar] 文件复制成功', 'info');
        
        // 存储文件路径用于保存（统一使用正斜杠）
        const normalizedPath = targetPath;
        setProfileForm(prev => ({ ...prev, avatarPath: normalizedPath }));
        
        // 验证文件是否存在
        const existsResult = await window.electronAPI.file.exists(targetPath);
        addLog(`[Avatar] 文件存在性检查: ${existsResult}`, 'info');
        
        // 使用相同路径读取 base64
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

  const handleBackToList = useCallback(() => {
    setViewMode('list');
    setEditingProfile(null);
    setAvatarFileList([]);
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
              <Card
                hoverable
                className="avatar-card"
                onClick={() => handleEditProfile(profile)}
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
                      handleEditProfile(profile);
                    }}
                  >
                    编辑
                  </Button>,
                  <Popconfirm
                    key="delete"
                    title="确定删除此人设？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDeleteProfile(profile);
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
                  </Popconfirm>
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
                      <div style={{ marginTop: 8 }}>
                        <Tag>
                          {new Date(profile.updatedAt).toLocaleDateString()}
                        </Tag>
                      </div>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default AvatarManager;
