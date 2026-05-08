import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Card, Row, Col, Statistic, Button, Space, message, Modal, Typography } from 'antd';
import {
  BookOutlined,
  UserOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  LeftOutlined,
  RightOutlined,
  BulbOutlined,
  ThunderboltOutlined as AvatarIcon
} from '@ant-design/icons';
import { Carousel } from 'antd';
import { useDataStore } from '../../stores/dataStore';
import { useWorldBookStore } from '../../stores/worldBookStore';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { ANIMATIONS, ANIMATION_DELAYS, CARD_ANIMATIONS, HOVER_EFFECTS, BUTTON_ANIMATIONS } from '../../utils/animation';

import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { characters, installedPlugins, avatars, fetchCharacters, fetchInstalledPlugins, fetchAvatars, error: dataError } = useDataStore();
  const { worldBooks, fetchWorldBooks, error: worldBookError } = useWorldBookStore();
  const { setting, fetchSetting } = useSettingStore();
  const { addLog } = useLogStore();
  const animationEnabled = setting?.animationEnabled ?? true;
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const backgroundRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  const getAnimatedClass = (className: string, animationName: string): string => {
    return animationEnabled ? `${className} ${animationName}` : className;
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  const getBackgroundSize = () => {
    if (!setting?.dashboardBackgroundImage) {
      return { height: 200 };
    }
    const minHeight = 100;
    const maxHeight = 800;
    const { width, height } = imageSize;
    if (width === 0 || height === 0) {
      return { height: minHeight };
    }
    const aspectRatio = width / height;
    const calculatedHeight = containerWidth / aspectRatio;
    let finalHeight = calculatedHeight;
    if (finalHeight < minHeight) finalHeight = minHeight;
    if (finalHeight > maxHeight) finalHeight = maxHeight;
    return { height: finalHeight, objectFit: 'cover' as const };
  };

  useEffect(() => {
    const updateContainerWidth = () => {
      if (backgroundRef.current) {
        setContainerWidth(backgroundRef.current.offsetWidth);
      }
    };
    updateContainerWidth();
    window.addEventListener('resize', updateContainerWidth);
    return () => window.removeEventListener('resize', updateContainerWidth);
  }, []);

  const backgroundStyle = React.useMemo(() => {
    return getBackgroundSize();
  }, [containerWidth, imageSize, setting?.dashboardBackgroundImage]);

  useEffect(() => {
    fetchSetting();
    fetchWorldBooks();
    fetchCharacters();
    fetchInstalledPlugins();
    fetchAvatars();
  }, [fetchSetting, fetchWorldBooks, fetchCharacters, fetchInstalledPlugins, fetchAvatars]);

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    addLog('正在检查更新...', 'info');
    try {
      const result = await window.electronAPI.update.check();
      if (result.success) {
        const { hasUpdate, currentVersion, latestVersion } = result.data;
        if (hasUpdate) {
          addLog(`发现新版本: v${latestVersion} (当前版本: v${currentVersion})`, 'warn');
          Modal.confirm({
            title: '发现新版本',
            content: (
              <div>
                <p>当前版本: v{currentVersion}</p>
                <p>最新版本: v{latestVersion}</p>
                <p style={{ marginTop: 12 }}>是否下载并安装更新？</p>
              </div>
            ),
            onOk: async () => {
              addLog('开始下载更新...', 'info');
              try {
                const downloadResult = await window.electronAPI.update.download(latestVersion);
                if (downloadResult.success) {
                  addLog('更新下载完成，开始安装...', 'info');
                  const installResult = await window.electronAPI.update.install(downloadResult.data.downloadPath);
                  if (installResult.success) {
                    addLog('更新安装成功', 'info');
                    message.success('更新安装成功，请重启应用');
                  } else {
                    addLog('安装失败', 'error', { category: 'update', details: '安装更新时失败' });
                    message.error(`安装失败: ${installResult.message}`);
                  }
                } else {
                  addLog('下载失败', 'error', { category: 'update', details: '下载更新时失败' });
                  message.error(`下载失败: ${downloadResult.message}`);
                }
              } catch (error) {
                addLog('更新错误', 'error', { category: 'update', error: error instanceof Error ? error : undefined, details: '检查更新时发生错误' });
                message.error('更新失败');
              }
            },
            onCancel: () => { addLog('取消更新', 'info'); }
          });
        } else {
          addLog(`已是最新版本: v${currentVersion}`, 'info');
          message.success(`已是最新版本: v${currentVersion}`);
        }
      } else {
        addLog('检查更新失败', 'error', { category: 'update', details: '检查更新时失败' });
        message.error(`检查更新失败: ${result.message}`);
      }
    } catch (error) {
      addLog('检查更新错误', 'error', { category: 'update', error: error instanceof Error ? error : undefined, details: '检查更新时发生异常' });
      message.error('检查更新失败');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleOpenWorldBookFolder = async () => {
    try {
      addLog('打开世界书存储文件夹', 'info');
      const folderPath = setting?.worldBookPath || '__USER_DATA__/data/worldbooks';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      const result = await window.electronAPI.file.openFolder(resolvedPath);
      if (!result.success) throw new Error(result.message || '打开文件夹失败');
    } catch (error) {
      addLog('打开世界书存储文件夹失败', 'error', { category: 'file', error: error instanceof Error ? error : undefined, details: '打开世界书存储文件夹时发生错误' });
      message.error('打开文件夹失败');
    }
  };

  const handleOpenCharacterFolder = async () => {
    try {
      addLog('打开角色卡存储文件夹', 'info');
      const folderPath = setting?.characterPath || '__USER_DATA__/data/characters';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      const result = await window.electronAPI.file.openFolder(resolvedPath);
      if (!result.success) throw new Error(result.message || '打开文件夹失败');
    } catch (error) {
      addLog('打开角色卡存储文件夹失败', 'error', { category: 'file', error: error instanceof Error ? error : undefined, details: '打开角色卡存储文件夹时发生错误' });
      message.error('打开文件夹失败');
    }
  };

  const handleOpenAvatarFolder = async () => {
    try {
      addLog('打开用户设定存储文件夹', 'info');
      const folderPath = setting?.avatarPath || '__USER_DATA__/data/avatars';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      const result = await window.electronAPI.file.openFolder(resolvedPath);
      if (!result.success) throw new Error(result.message || '打开文件夹失败');
    } catch (error) {
      addLog('打开用户设定存储文件夹失败', 'error', { category: 'file', error: error instanceof Error ? error : undefined, details: '打开用户设定存储文件夹时发生错误' });
      message.error('打开文件夹失败');
    }
  };

  interface Tip {
    id: number;
    title: string;
    content: string;
  }

  const [tips, setTips] = useState<Tip[]>([]);
  const [tipsLoading, setTipsLoading] = useState(true);
  const carouselRef = useRef<any>(null);
  const tipsCacheRef = useRef<Tip[] | null>(null);

  useEffect(() => {
    const loadTips = async () => {
      if (tipsCacheRef.current) {
        setTips(tipsCacheRef.current);
        setTipsLoading(false);
        return;
      }
      
      try {
        const tipsData = await window.electronAPI.file.readJson('tips');
        if (tipsData && Array.isArray(tipsData)) {
          tipsCacheRef.current = tipsData;
          setTips(tipsData);
        }
      } catch (error) {
        console.error('Failed to load tips:', error);
        const defaultTips: Tip[] = [
          { id: 1, title: "使用提示", content: "欢迎使用 Creative-Cafe！这是一个强大的角色卡和世界书管理工具。" }
        ];
        tipsCacheRef.current = defaultTips;
        setTips(defaultTips);
      } finally {
        setTipsLoading(false);
      }
    };
    loadTips();
  }, []);

  const totalWorldBooks = worldBooks.length;
  const totalCharacters = characters.length;
  const totalPlugins = installedPlugins.length;
  const totalAvatars = avatars.length;
  const configLoaded = setting !== null;

  return (
    <div className={getAnimatedClass('dashboard', ANIMATIONS.fadeIn)}>
      <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', padding: '0 16px', boxSizing: 'border-box' }}>
        <h2>仪表盘</h2>

        <div
          ref={backgroundRef}
          className={getAnimatedClass('dashboard-background', ANIMATIONS.fadeInDown)}
          style={{ height: backgroundStyle.height }}
        >
          {setting?.dashboardBackgroundImage ? (
            <img
              src={setting.dashboardBackgroundImage}
              alt="仪表盘背景"
              onLoad={handleImageLoad}
              onError={() => {
                addLog('仪表盘背景图片加载失败', 'warn');
                setImageSize({ width: 0, height: 0 });
              }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '16px' }}
            />
          ) : (
            <div className="background-placeholder">
              <p>背景图片区域</p>
              <p style={{ fontSize: 12, marginTop: 8, color: '#888' }}>在设置页面上传自定义背景图片</p>
            </div>
          )}
        </div>

        <Row gutter={[16, 16]} style={{ marginTop: 24, width: '100%', marginLeft: 0, marginRight: 0 }}>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card onClick={handleOpenWorldBookFolder} style={{ cursor: 'pointer' }} hoverable className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['100']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic 
                title="世界书数量" 
                value={worldBookError ? '加载失败' : totalWorldBooks} 
                prefix={<BookOutlined />} 
                valueStyle={{ color: worldBookError ? '#cf1322' : '#3f8600' }} 
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card onClick={handleOpenCharacterFolder} style={{ cursor: 'pointer' }} hoverable className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['200']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic 
                title="角色卡数量" 
                value={dataError ? '加载失败' : totalCharacters} 
                prefix={<UserOutlined />} 
                valueStyle={{ color: dataError ? '#cf1322' : '#1890ff' }} 
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card onClick={handleOpenAvatarFolder} style={{ cursor: 'pointer' }} hoverable className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['300']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic 
                title="用户设定数量" 
                value={dataError ? '加载失败' : totalAvatars} 
                prefix={<AvatarIcon />} 
                valueStyle={{ color: dataError ? '#cf1322' : '#fa8c16' }} 
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['400']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic 
                title="已安装插件" 
                value={dataError ? '加载失败' : totalPlugins} 
                prefix={<ThunderboltOutlined />} 
                valueStyle={{ color: dataError ? '#cf1322' : '#722ed1' }} 
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['500']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic title="配置状态" value={configLoaded ? '已加载' : '未加载'} prefix={configLoaded ? <CheckCircleOutlined /> : <WarningOutlined />} valueStyle={{ color: configLoaded ? '#3f8600' : '#cf1322' }} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['600']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic title="系统状态" value="正常" prefix={<CheckCircleOutlined />} valueStyle={{ color: '#3f8600' }} />
            </Card>
          </Col>
        </Row>

        <div style={{ marginTop: 16, marginBottom: 80, width: '100%', boxSizing: 'border-box' }}>
          <Card
            title={<Space><BulbOutlined /> 使用技巧</Space>}
            className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['600']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}
            extra={
              <Space>
                <Button shape="circle" icon={<LeftOutlined />} onClick={() => carouselRef.current?.prev()} />
                <Button shape="circle" icon={<RightOutlined />} onClick={() => carouselRef.current?.next()} />
              </Space>
            }
          >
            {tipsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <LoadingOutlined style={{ fontSize: 24 }} spin />
                <div style={{ marginTop: 8 }}>加载中...</div>
              </div>
            ) : tips.length > 0 ? (
              <Carousel ref={carouselRef} dots autoplay autoplaySpeed={5000} easing="ease-in-out">
                {tips.map((tip) => (
                  <div key={tip.id} style={{ padding: '8px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 100, justifyContent: 'center' }}>
                      <Typography.Title level={4} style={{ marginBottom: 12, color: '#722ed1', marginTop: 0 }}>{tip.title}</Typography.Title>
                      <Typography.Paragraph style={{ fontSize: '16px', lineHeight: 1.8, marginBottom: 0 }}>{tip.content}</Typography.Paragraph>
                    </div>
                  </div>
                ))}
              </Carousel>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px' }}><p>暂无使用技巧</p></div>
            )}
          </Card>
        </div>
      </div>

      <div className={getAnimatedClass('dashboard-buttons', ANIMATIONS.fadeInUp)}>
        <Space>
          <Button
            size="large"
            icon={isCheckingUpdate ? <LoadingOutlined spin /> : <ReloadOutlined />}
            onClick={handleCheckUpdate}
            loading={isCheckingUpdate}
            className={getAnimatedClass('update-button', BUTTON_ANIMATIONS.animated)}
          >
            检查更新
          </Button>
        </Space>
      </div>
    </div>
  );
};

export default Dashboard;
