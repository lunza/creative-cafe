import React, { useCallback, useMemo, useState } from 'react';
import { Card, Table, Button, Space, Modal, message, Popconfirm, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  UploadOutlined,
  UserOutlined,
  MessageOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { StoragePathDisplay } from '../common/StoragePathDisplay';
import { AvatarImage, ThumbnailImage } from './utils/characterThumbnailCache';
import '../../styles/list-common.css';

const { Text } = Typography;

export interface CharacterListItem {
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

export interface CharacterListViewProps {
  characters: CharacterListItem[];
  loading: boolean;
  characterDir: string;
  appTheme: 'dark' | 'light';
  pageSize: number;
  setPageSize: (size: number) => void;
  onRefresh: () => void;
  onImport: () => void;
  onCreate: () => void;
  onGenerateAI: () => void;
  onOpenFolder: () => void;
  onCopyPath: () => void;
  onEdit: (record: CharacterListItem) => void;
  onTest: (record: CharacterListItem) => void;
  onDelete: (path: string) => void;
  addLog: (msg: string, level?: 'info' | 'error' | 'warn' | 'debug') => void;
}

const IMAGE_EXT_REGEX = /\.(png|jpg|jpeg|webp)$/i;

/**
 * Character list view — header (title + storage path display + action buttons),
 * character table, and the read-only "view character card" Modal.
 *
 * Migrated from the inline JSX of `CharacterManager`. View-related state
 * (`viewingItem`, `characterContent`, modal open flag) is local to this
 * component because it has no upstream consumers. The View Modal's content
 * layout is preserved verbatim.
 */
const CharacterListView: React.FC<CharacterListViewProps> = ({
  characters,
  loading,
  characterDir,
  appTheme,
  pageSize,
  setPageSize,
  onRefresh,
  onImport,
  onCreate,
  onGenerateAI,
  onOpenFolder,
  onCopyPath,
  onEdit,
  onTest,
  onDelete,
  addLog,
}) => {
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<CharacterListItem | null>(null);
  const [characterContent, setCharacterContent] = useState<any>(null);

  const handleView = useCallback(async (record: CharacterListItem) => {
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
  }, [addLog]);

  const closeViewModal = useCallback(() => {
    setIsViewModalOpen(false);
    setViewingItem(null);
    setCharacterContent(null);
  }, []);

  const columns = useMemo<ColumnsType<CharacterListItem>>(() => [
    {
      title: '缩略图',
      dataIndex: 'thumbnail',
      key: 'thumbnail',
      width: 80,
      render: (_, record) => {
        const isImageFile = IMAGE_EXT_REGEX.test(record.path);
        if (isImageFile) {
          return <ThumbnailImage filePath={record.path} name={record.name} />;
        }
        return (
          <div style={{ width: 60, height: 60, borderRadius: 4, backgroundColor: 'var(--card-bg-color, #f0f0f0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserOutlined style={{ fontSize: 24, color: '#999' }} />
          </div>
        );
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
      width: 280,
      fixed: 'right' as const,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<MessageOutlined />}
            onClick={() => onTest(record)}
          >
            对话
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个角色卡吗？"
            onConfirm={() => onDelete(record.path)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ], [handleView, onTest, onEdit, onDelete]);

  // Note: original handler `handleOptimize` is invoked via the (now-removed)
  // optimize button on each row. It remains available to the parent through
  // `optimizeCharacter` if needed; the column set is preserved verbatim from
  // the original implementation, which did not render an optimize button.

  return (
    <>
      <div className="character-header list-header">
        <h2>角色卡管理</h2>
        <StoragePathDisplay
          label="角色卡存储路径"
          path={characterDir}
          onOpenFolder={onOpenFolder}
          onCopyPath={onCopyPath}
        />
        <Card size="small" style={{ marginBottom: 16, background: '#fffbe6', borderColor: '#ffe58f' }}>
          <Space>
            <Text type="warning">ℹ️ 提示：</Text>
            <Text>仅支持图片类角色卡（PNG、JPG、JPEG、WebP），支持 SillyTavern V2/V3 规范。不支持 JSON 格式角色卡。</Text>
          </Space>
        </Card>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新
          </Button>
          <Button icon={<UploadOutlined />} onClick={onImport}>
            导入角色卡
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            新建角色卡
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={onGenerateAI}>
            AI生成角色卡
          </Button>
        </Space>
      </div>

      <Card className="table-container">
        <Table
          columns={columns}
          dataSource={characters}
          rowKey="path"
          loading={loading}
          bordered
          pagination={{
            pageSize,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            className: 'table-pagination-wrapper',
            onChange: (_page, size) => { setPageSize(size); },
          }}
        />
      </Card>

      <Modal
        title={`查看角色卡: ${viewingItem?.name}`}
        open={isViewModalOpen}
        onCancel={closeViewModal}
        width={1200}
        footer={[
          <Button key="close" onClick={closeViewModal}>
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
                border: '1px solid var(--border-base, #333)',
                borderRadius: 8,
                backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                color: 'var(--text-primary, #ffffff)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
                {/* 角色头像 */}
                {viewingItem && IMAGE_EXT_REGEX.test(viewingItem.path) ? (
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
                  <h3 style={{ marginBottom: 20, fontSize: 24, fontWeight: 700, color: 'var(--text-primary, #ffffff)', borderBottom: '2px solid #1890ff', paddingBottom: 8 }}>
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
                      <div style={{ color: 'var(--text-primary, #ffffff)' }}>
                        <ReactMarkdown>{String(characterContent.data?.description || '无描述')}</ReactMarkdown>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>昵称:</span>
                        <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.nickname || '无昵称'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>来源:</span>
                        <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.source || '无来源'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>创建日期:</span>
                        <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.creation_date || '无创建日期'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>修改日期:</span>
                        <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.modification_date || '无修改日期'}</span>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16, lineHeight: 1.6 }}>
                      <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>个性:</span>
                      <div style={{ display: 'inline-block', color: 'var(--text-primary, #ffffff)', maxWidth: 'calc(100% - 80px)' }}>
                        <ReactMarkdown>{String(characterContent.data?.personality || '无个性')}</ReactMarkdown>
                      </div>
                    </div>
                    <div style={{ marginBottom: 16, lineHeight: 1.6 }}>
                      <span style={{ display: 'inline-block', width: 80, fontWeight: 600, color: '#1890ff' }}>场景:</span>
                      <div style={{ display: 'inline-block', color: 'var(--text-primary, #ffffff)', maxWidth: 'calc(100% - 80px)' }}>
                        <ReactMarkdown>{String(characterContent.data?.scenario || '无场景')}</ReactMarkdown>
                      </div>
                    </div>
                  </div>

                  {/* 其他信息 */}
                  <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--bg-elevated, #2a2a2a)', borderRadius: 8, border: '1px solid var(--border-base, #333)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                      {characterContent.data?.creator && (
                        <div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>创建者:</span>
                            <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.creator || '无创建者'}</span>
                          </p>
                        </div>
                      )}
                      {characterContent.data?.character_version && (
                        <div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>角色版本:</span>
                            <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.character_version || '无版本'}</span>
                          </p>
                        </div>
                      )}
                      {characterContent.data?.group_only_greetings && (
                        <div>
                          <p style={{ margin: 0, lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#1890ff', marginRight: 8 }}>仅群组问候:</span>
                            <span style={{ color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.group_only_greetings ? '是' : '否'}</span>
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  初始消息
                </h3>
                <div style={{
                  padding: 20,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  示例消息
                </h3>
                <div style={{
                  padding: 20,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  系统提示
                </h3>
                <div style={{
                  padding: 20,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  历史记录后指令
                </h3>
                <div style={{
                  padding: 20,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  替代问候
                </h3>
                <div style={{
                  padding: 20,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  创建者笔记
                </h3>

                {/* 单语言笔记 */}
                {characterContent.data?.creator_notes && (
                  <div style={{
                    padding: 20,
                    backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                      color: 'var(--text-primary, #ffffff)'
                    }}>
                      多语言笔记
                    </h4>
                    {Object.entries(characterContent.data?.creator_notes_multilingual).map(([lang, note]) => (
                      <div key={lang} style={{
                        padding: 16,
                        backgroundColor: 'var(--bg-elevated, #2a2a2a)',
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
                  border: '1px solid var(--border-base, #333)',
                  borderRadius: 12,
                  backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                  color: 'var(--text-primary, #ffffff)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}
              >
                <h3 style={{
                  marginBottom: 16,
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary, #ffffff)',
                  borderBottom: '1px solid var(--border-base, #333)',
                  paddingBottom: 8
                }}>
                  角色书
                </h3>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-container, #1f1f1f)', borderRadius: 8, border: '1px solid var(--border-base, #333)' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: 'var(--text-secondary, #8c8c8c)' }}>名称</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.character_book?.name || '无名称'}</p>
                    </div>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-container, #1f1f1f)', borderRadius: 8, border: '1px solid var(--border-base, #333)' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: 'var(--text-secondary, #8c8c8c)' }}>扫描深度</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.character_book?.scan_depth || 0}</p>
                    </div>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-container, #1f1f1f)', borderRadius: 8, border: '1px solid var(--border-base, #333)' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: 'var(--text-secondary, #8c8c8c)' }}>令牌预算</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.character_book?.token_budget || 0}</p>
                    </div>
                    <div style={{ padding: 12, backgroundColor: 'var(--bg-container, #1f1f1f)', borderRadius: 8, border: '1px solid var(--border-base, #333)' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: 'var(--text-secondary, #8c8c8c)' }}>递归扫描</p>
                      <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.character_book?.recursive_scanning ? '是' : '否'}</p>
                    </div>
                  </div>

                  {characterContent.data?.character_book?.description && (
                    <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--bg-container, #1f1f1f)', borderRadius: 8, border: '1px solid var(--border-base, #333)' }}>
                      <p style={{ marginBottom: 4, fontSize: 14, color: 'var(--text-secondary, #8c8c8c)' }}>描述</p>
                      <p style={{ margin: 0, color: 'var(--text-primary, #ffffff)' }}>{characterContent.data?.character_book?.description}</p>
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
    </>
  );
};

export default React.memo(CharacterListView);
