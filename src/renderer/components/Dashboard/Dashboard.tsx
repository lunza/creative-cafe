import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Card, Row, Col, Statistic, Button, Space, message, Modal, Typography, Tag } from 'antd';
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
  ThunderboltOutlined as AvatarIcon,
  DatabaseOutlined,
  ThunderboltOutlined as EngineIcon,
  ThunderboltOutlined as VectorIcon,
  FolderOpenOutlined
} from '@ant-design/icons';
import { Carousel } from 'antd';
import { useDataStore } from '../../stores/dataStore';
import { useWorldBookStore } from '../../stores/worldBookStore';
import { useSettingStore } from '../../stores/settingStore';
import { useUIStore } from '../../stores/uiStore';
import { useLogStore } from '../../stores/logStore';
import { useVectorStore } from '../../stores/vectorStore';
import { ANIMATIONS, ANIMATION_DELAYS, CARD_ANIMATIONS, HOVER_EFFECTS, BUTTON_ANIMATIONS } from '../../utils/animation';

import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { characters, installedPlugins, avatars, fetchCharacters, fetchInstalledPlugins, fetchAvatars, error: dataError } = useDataStore();
  const { worldBooks, fetchWorldBooks, error: worldBookError } = useWorldBookStore();
  const { setting, fetchSetting, testConnection } = useSettingStore();
  const { animationEnabled } = useUIStore();
  const { addLog } = useLogStore();
  const { testConnection: testVectorConnection, testStorage: testVectorStorage, lastTestResult, clearTestResult } = useVectorStore();
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const backgroundRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // AI engine status
  const [aiEngineStatus, setAiEngineStatus] = useState<{ connected: boolean; engineName: string; model: string; responseTime?: number } | null>(null);
  const [aiEngineLoading, setAiEngineLoading] = useState(true);

  // Storage usage
  const [storageSize, setStorageSize] = useState<string>('加载中...');
  const [storageLoading, setStorageLoading] = useState(true);

  // Vector engine status
  const [vectorEngineStatus, setVectorEngineStatus] = useState<{ connected: boolean; mode: string; dimension?: number; responseTime?: number } | null>(null);
  const [vectorEngineLoading, setVectorEngineLoading] = useState(true);

  // Vector storage status
  const [vectorStorageStatus, setVectorStorageStatus] = useState<{ success: boolean; mode: string; vectorCount: number } | null>(null);
  const [vectorStorageLoading, setVectorStorageLoading] = useState(true);

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

  // Fetch storage size on mount
  useEffect(() => {
    const fetchStorageSize = async () => {
      try {
        const result = await window.electronAPI.app.getUserDataSize();
        if (result.success) {
          setStorageSize(result.formattedSize || '0 B');
        } else {
          setStorageSize('获取失败');
        }
      } catch {
        setStorageSize('获取失败');
      } finally {
        setStorageLoading(false);
      }
    };
    fetchStorageSize();
  }, []);

  // Test AI engine connection on mount
  useEffect(() => {
    const testAiEngine = async () => {
      try {
        const testSetting = setting || (await window.electronAPI.setting.load()).setting;
        if (!testSetting || !testSetting.aiEngines || testSetting.aiEngines.length === 0) {
          setAiEngineStatus({ connected: false, engineName: '未配置', model: '-' });
          setAiEngineLoading(false);
          return;
        }

        const activeEngine = testSetting.activeEngineId
          ? testSetting.aiEngines.find(e => e.id === testSetting.activeEngineId)
          : testSetting.aiEngines[0];

        if (!activeEngine || !activeEngine.api_url) {
          setAiEngineStatus({ connected: false, engineName: '未配置', model: '-' });
          setAiEngineLoading(false);
          return;
        }

        const result = await testConnection(testSetting);
        if (result.success) {
          setAiEngineStatus({
            connected: true,
            engineName: activeEngine.name || '未知引擎',
            model: activeEngine.model_name || '-',
            responseTime: result.responseTime
          });
        } else {
          setAiEngineStatus({
            connected: false,
            engineName: activeEngine.name || '未知引擎',
            model: activeEngine.model_name || '-'
          });
        }
      } catch {
        setAiEngineStatus(null);
      } finally {
        setAiEngineLoading(false);
      }
    };
    testAiEngine();
  }, [setting, testConnection]);

  // Test vector engine connection on mount
  useEffect(() => {
    const testVectorEngine = async () => {
      try {
        const result = await testVectorConnection();
        if (result.success) {
          // Parse response time from details string like "成功: 维度=4096, 向量数量=1, 耗时=50ms"
          let responseTime: number | undefined;
          if (result.details && result.details.includes('耗时=')) {
            const match = result.details.match(/耗时=(\d+)ms/);
            if (match) {
              responseTime = parseInt(match[1]);
            }
          }
          setVectorEngineStatus({
            connected: true,
            mode: result.mode,
            dimension: result.dimension,
            responseTime
          });
        } else {
          setVectorEngineStatus({
            connected: false,
            mode: result.mode || '未知'
          });
        }
      } catch {
        setVectorEngineStatus({ connected: false, mode: '未知' });
      } finally {
        setVectorEngineLoading(false);
      }
    };
    testVectorEngine();
  }, [testVectorConnection]);

  // Test vector storage on mount
  useEffect(() => {
    const testVectorStorageFn = async () => {
      try {
        const result = await testVectorStorage();
        if (result.success) {
          setVectorStorageStatus({
            success: true,
            mode: result.mode,
            vectorCount: result.vectorCount || 0
          });
        } else {
          setVectorStorageStatus({
            success: false,
            mode: result.mode || '未知',
            vectorCount: 0
          });
        }
      } catch {
        setVectorStorageStatus({ success: false, mode: '未知', vectorCount: 0 });
      } finally {
        setVectorStorageLoading(false);
      }
    };
    testVectorStorageFn();
  }, [testVectorStorage]);

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    addLog('正在检查更新...', 'info');
    try {
      const result = await window.electronAPI.update.check();
      if (result.success && result.data) {
        const { hasUpdate, currentVersion, latestVersion, commits } = result.data;
        if (hasUpdate) {
          addLog(`发现新版本: ${latestVersion} (当前版本: ${currentVersion})`, 'warn');
          Modal.confirm({
            title: '发现新版本',
            content: (
              <div>
                <p>当前版本: {currentVersion}</p>
                <p>最新版本: {latestVersion}</p>
                {commits && commits.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontWeight: 'bold' }}>更新内容：</p>
                    <ul style={{ maxHeight: 200, overflowY: 'auto', margin: 0, paddingLeft: 20 }}>
                      {commits.map((commit, index) => (
                        <li key={index} style={{ marginBottom: 4 }}>
                          <span style={{ color: '#999', fontSize: 12 }}>{commit.hash}</span> {commit.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p style={{ marginTop: 12 }}>是否拉取最新代码并重新编译？</p>
              </div>
            ),
            onOk: async () => {
              addLog('开始拉取更新...', 'info');
              try {
                const pullResult = await window.electronAPI.update.pull();
                if (pullResult.success) {
                  if (pullResult.data?.compiled) {
                    addLog('更新完成，项目已重新编译', 'info');
                    message.success('更新成功，项目已重新编译');
                  } else {
                    addLog('代码已更新，但编译失败', 'warn');
                    message.warning('代码已更新，但编译失败，请查看日志');
                  }
                  if (pullResult.logs && pullResult.logs.length > 0) {
                    pullResult.logs.forEach(log => addLog(log, pullResult.data?.compiled ? 'info' : 'warn'));
                  }
                } else {
                  addLog(pullResult.message || '更新失败', 'error');
                  message.error(pullResult.message || '更新失败');
                }
              } catch (error) {
                addLog('更新错误', 'error', { category: 'update', error: error instanceof Error ? error : undefined, details: '拉取更新时发生错误' });
                message.error('更新失败');
              }
            },
            onCancel: () => { addLog('取消更新', 'info'); }
          });
        } else {
          addLog(`已是最新版本: ${currentVersion}`, 'info');
          message.success(`已是最新版本: ${currentVersion}`);
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

  const handleOpenUserDataFolder = async () => {
    try {
      addLog('打开数据存储文件夹', 'info');
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const result = await window.electronAPI.file.openFolder(userDataPath);
      if (!result.success) throw new Error(result.message || '打开文件夹失败');
    } catch (error) {
      addLog('打开数据存储文件夹失败', 'error', { category: 'file', error: error instanceof Error ? error : undefined, details: '打开数据存储文件夹时发生错误' });
      message.error('打开文件夹失败');
    }
  };

  const handleOpenVectorStorageFolder = async () => {
    try {
      addLog('打开向量存储文件夹', 'info');
      const vectorPath = await window.electronAPI.vector.getStorePath();
      const result = await window.electronAPI.file.openFolder(vectorPath);
      if (!result.success) throw new Error(result.message || '打开文件夹失败');
    } catch (error) {
      addLog('打开向量存储文件夹失败', 'error', { category: 'file', error: error instanceof Error ? error : undefined, details: '打开向量存储文件夹时发生错误' });
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
            <Card onClick={handleOpenUserDataFolder} style={{ cursor: 'pointer' }} hoverable className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['400']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              <Statistic
                title="已占用存储空间"
                value={storageLoading ? <LoadingOutlined spin /> : storageSize}
                prefix={<DatabaseOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['500']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              {aiEngineLoading ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <Statistic
                    title="AI引擎状态"
                    value={<LoadingOutlined spin />}
                    prefix={<EngineIcon />}
                    valueStyle={{ color: '#1890ff' }}
                  />
                </div>
              ) : aiEngineStatus ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ marginBottom: 8 }}>
                    <Tag color={aiEngineStatus.connected ? 'success' : 'error'}>
                      {aiEngineStatus.connected ? '已连接' : '未连接'}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {aiEngineStatus.engineName}
                    {aiEngineStatus.model && ` · ${aiEngineStatus.model}`}
                    {aiEngineStatus.responseTime && ` · ${aiEngineStatus.responseTime}ms`}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <Statistic
                    title="AI引擎状态"
                    value="未知"
                    prefix={<EngineIcon />}
                    valueStyle={{ color: '#cf1322' }}
                  />
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['600']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              {vectorEngineLoading ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <Statistic
                    title="向量模型状态"
                    value={<LoadingOutlined spin />}
                    prefix={<VectorIcon />}
                    valueStyle={{ color: '#1890ff' }}
                  />
                </div>
              ) : vectorEngineStatus ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ marginBottom: 8 }}>
                    <Tag color={vectorEngineStatus.connected ? 'success' : 'error'}>
                      {vectorEngineStatus.connected ? '已连接' : '未连接'}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {vectorEngineStatus.mode === 'remote' ? '远程模型' : '本地模型'}
                    {vectorEngineStatus.dimension && ` · ${vectorEngineStatus.dimension}维`}
                    {vectorEngineStatus.responseTime && ` · ${vectorEngineStatus.responseTime}ms`}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <Statistic
                    title="向量模型状态"
                    value="未知"
                    prefix={<VectorIcon />}
                    valueStyle={{ color: '#cf1322' }}
                  />
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} sm={12} md={4} style={{ paddingLeft: 8, paddingRight: 8 }}>
            <Card onClick={handleOpenVectorStorageFolder} style={{ cursor: 'pointer' }} hoverable className={getAnimatedClass('', `${ANIMATIONS.fadeInUp} ${ANIMATION_DELAYS['700']} ${CARD_ANIMATIONS.animated} ${HOVER_EFFECTS.lift}`)}>
              {vectorStorageLoading ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <Statistic
                    title="向量存储情况"
                    value={<LoadingOutlined spin />}
                    prefix={<FolderOpenOutlined />}
                    valueStyle={{ color: '#1890ff' }}
                  />
                </div>
              ) : vectorStorageStatus ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ marginBottom: 8 }}>
                    <Tag color={vectorStorageStatus.success ? 'success' : 'error'}>
                      {vectorStorageStatus.mode === 'vecstore' ? 'VecStore (vecstore-wasm)' : vectorStorageStatus.mode}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    总向量数量: {vectorStorageStatus.vectorCount}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <Statistic
                    title="向量存储情况"
                    value="未知"
                    prefix={<FolderOpenOutlined />}
                    valueStyle={{ color: '#cf1322' }}
                  />
                </div>
              )}
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
