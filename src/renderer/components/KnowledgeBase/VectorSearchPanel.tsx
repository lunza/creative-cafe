/**
 * 向量测试面板 - 对应原 KnowledgeBaseManager 的 "向量测试" Tab。
 *
 * 包含两部分：
 * 1. 相似性语义查询：将输入文本向量化后与向量库做余弦相似度匹配
 * 2. 向量化测试：查看任意文本生成的向量数据与维度信息
 */
import React, { useState, useMemo } from 'react';
import {
  Card, Input, Select, Button, Space, Tag, Table, Alert, Empty,
  Descriptions, message,
} from 'antd';
import { SearchOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useVectorStore } from '../../stores/vectorStore';
import { VectorScopeSelector } from '../Vector/VectorScopeSelector';
import type { VectorSearchResult, VectorTestResult } from './shared';

const { TextArea } = Input;
const { Option } = Select;

const VectorSearchPanel: React.FC = () => {
  const searchWithScopes = useVectorStore(s => s.searchWithScopes);

  // 相似性查询状态
  const [vectorSearchQuery, setVectorSearchQuery] = useState('');
  const [vectorSearchResults, setVectorSearchResults] = useState<VectorSearchResult[]>([]);
  const [vectorSearchLoading, setVectorSearchLoading] = useState(false);
  const [vectorSearchTopK, setVectorSearchTopK] = useState(5);
  const [vectorSearchError, setVectorSearchError] = useState('');

  // 向量化测试状态
  const [vectorTestText, setVectorTestText] = useState('');
  const [vectorTestResult, setVectorTestResult] = useState<VectorTestResult | null>(null);
  const [vectorTestLoading, setVectorTestLoading] = useState(false);

  const handleVectorSearch = async () => {
    if (!vectorSearchQuery.trim()) {
      message.warning('请输入查询文本');
      return;
    }
    setVectorSearchLoading(true);
    setVectorSearchResults([]);
    setVectorSearchError('');
    try {
      // 统一使用向量搜索，后端会自动聚合所有数据源
      const queryVector = await window.electronAPI.embedding.generate(vectorSearchQuery);
      if (!queryVector.success || !queryVector.vector) {
        setVectorSearchError(queryVector.error || '向量化失败');
        message.error(queryVector.error || '向量化失败');
        return;
      }

      // 使用 searchWithScopes 进行搜索（当没有选中 scope 时，后端会自动聚合所有源）
      const results = await searchWithScopes(queryVector.vector, vectorSearchTopK);

      if (results && results.length > 0) {
        const formattedResults: VectorSearchResult[] = results.map(r => ({
          id: r.id,
          score: r.similarity || r.score,
          metadata: {
            text: r.metadata?.text || r.content || '',
            source: r.metadata?.source || 'vector',
            title: r.metadata?.title,
            category: r.metadata?.category,
            tags: r.metadata?.tags,
          },
        }));

        message.success(`找到 ${formattedResults.length} 条相关结果`);
        setVectorSearchResults(formattedResults);
      } else {
        message.warning('未找到相关结果，请尝试其他查询词');
        setVectorSearchResults([]);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setVectorSearchError(msg);
      message.error(`搜索异常: ${msg}`);
    } finally {
      setVectorSearchLoading(false);
    }
  };

  const handleVectorTest = async () => {
    if (!vectorTestText.trim()) {
      message.warning('请输入测试文本');
      return;
    }
    setVectorTestLoading(true);
    setVectorTestResult(null);
    try {
      const embedResult = await window.electronAPI.embedding.generate(vectorTestText);
      if (embedResult.success && embedResult.vector) {
        const vector = embedResult.vector;
        const result: VectorTestResult = {
          vector,
          dimension: vector.length,
          min: Math.min(...vector),
          max: Math.max(...vector),
          first20: vector.slice(0, 20),
        };
        setVectorTestResult(result);
        message.success('向量化成功');
      } else {
        message.error(embedResult.error || '向量化失败');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(`向量化异常: ${msg}`);
    } finally {
      setVectorTestLoading(false);
    }
  };

  // 查询结果表格列定义
  const resultColumns = useMemo(
    () => [
      { title: '相似度', dataIndex: 'score', key: 'score', width: 100, render: (s: number) => `${(s * 100).toFixed(1)}%` },
      { title: '来源', dataIndex: ['metadata', 'source'], key: 'source', width: 100 },
      { title: '内容', dataIndex: ['metadata', 'text'], key: 'content', ellipsis: true },
    ],
    []
  );

  return (
    <>
      <Alert
        message="使用说明"
        description={
          <div>
            <p style={{ margin: '0 0 8px' }}><strong>1. 相似性查询：</strong>输入查询文本，系统将其向量化后与存储的向量进行余弦相似度匹配，返回最相似的文本分块。可在上方"查询范围"中选择特定的已向量化文件进行针对性查询，不选则查询全部。</p>
            <p style={{ margin: '0 0 8px' }}><strong>2. 向量化测试：</strong>输入任意文本，查看其生成的向量数据和维度信息。</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card title="测试 1: 相似性语义查询" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <VectorScopeSelector placeholder="不选则查询所有已向量化的文件" />
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>查询文本</label>
              <TextArea
                rows={3}
                placeholder="输入您要查询的内容，系统将找到最相似的文本分块..."
                value={vectorSearchQuery}
                onChange={(e) => setVectorSearchQuery(e.target.value)}
              />
            </div>
            <div style={{ width: 200 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>返回数量</label>
              <Select
                style={{ width: '100%' }}
                value={vectorSearchTopK}
                onChange={(val) => setVectorSearchTopK(val as number)}
              >
                <Option value={5}>Top 5</Option>
                <Option value={10}>Top 10</Option>
                <Option value={20}>Top 20</Option>
              </Select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleVectorSearch}
                loading={vectorSearchLoading}
                size="large"
              >
                执行查询
              </Button>
            </div>
          </div>
        </Space>
      </Card>

      {vectorSearchResults.length > 0 && (
        <Card
          title={
            <Space>
              <span>查询结果</span>
              <Tag color="success">{vectorSearchResults.length} 条匹配</Tag>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Table
            columns={resultColumns}
            dataSource={vectorSearchResults}
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ y: 300 }}
          />
        </Card>
      )}

      {!vectorSearchLoading && vectorSearchResults.length === 0 && vectorSearchQuery.trim() && !vectorSearchError && (
        <Empty
          description="未找到匹配的文本分块，请尝试其他查询文本"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card title="测试 2: 向量化测试">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>测试文本</label>
            <TextArea
              rows={3}
              placeholder="输入任意文本，查看其向量表示..."
              value={vectorTestText}
              onChange={(e) => setVectorTestText(e.target.value)}
            />
          </div>
          <Button
            type="primary"
            icon={<ExperimentOutlined />}
            onClick={handleVectorTest}
            loading={vectorTestLoading}
          >
            生成向量
          </Button>

          {vectorTestResult && (
            <Card title="向量信息" size="small">
              <Descriptions bordered column={2} size="small">
                <Descriptions.Item label="向量维度">{vectorTestResult.dimension}</Descriptions.Item>
                <Descriptions.Item label="向量类型">Float32</Descriptions.Item>
                <Descriptions.Item label="向量范围">
                  [{vectorTestResult.min.toFixed(6)}, {vectorTestResult.max.toFixed(6)}]
                </Descriptions.Item>
                <Descriptions.Item label="前 20 个分量" span={2}>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, maxHeight: 100, overflow: 'auto' }}>
                    [{vectorTestResult.first20.map(v => v.toFixed(6)).join(', ')}...]
                  </div>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}
        </Space>
      </Card>
    </>
  );
};

export default VectorSearchPanel;
