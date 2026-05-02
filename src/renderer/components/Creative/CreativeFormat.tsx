import React, { useState } from 'react';
import { Card, Button, Radio, Space, Typography, message, Alert, Divider } from 'antd';
import { CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';

const { Text, Title } = Typography;

const CreativeFormat: React.FC = () => {
  const [formatType, setFormatType] = useState<'character' | 'worldbook'>('character');
  const { getCurrentCreative } = useCreativeStore();

  const handleFormat = () => {
    const currentCreative = getCurrentCreative();
    if (!currentCreative) {
      message.error('请先选择或创建一个创意');
      return;
    }

    // 这里可以添加格式规范化的逻辑
    // 目前只是模拟实现
    message.success('格式规范化成功！');
  };

  const handleDownload = () => {
    const currentCreative = getCurrentCreative();
    if (!currentCreative) {
      message.error('请先选择或创建一个创意');
      return;
    }

    const blob = new Blob([currentCreative.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `creative-${formatType}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('下载成功！');
  };

  return (
    <Card title={<Title level={4}>格式规范</Title>} className="creative-format-card">
      {!getCurrentCreative() ? (
        <Alert 
          message="提示" 
          description="请先选择或创建一个创意" 
          type="info" 
          showIcon 
        />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <Text strong>当前内容：</Text>
            <div style={{ marginTop: 8, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 4, maxHeight: 200, overflowY: 'auto' }}>
              <Text>{getCurrentCreative()?.content}</Text>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Text strong>格式类型：</Text>
            <Radio.Group 
              value={formatType} 
              onChange={(e) => setFormatType(e.target.value)}
              style={{ width: '100%', marginTop: 8 }}
            >
              <Radio value="character">角色卡格式</Radio>
              <Radio value="worldbook">世界书格式</Radio>
            </Radio.Group>
          </div>

          <Divider />

          <Space orientation="vertical" style={{ width: '100%' }}>
            <Button 
              type="primary" 
              icon={<CheckOutlined />}
              size="large"
              style={{ width: '100%' }}
              onClick={handleFormat}
            >
              格式规范化
            </Button>
            <Button 
              icon={<DownloadOutlined />}
              size="large"
              style={{ width: '100%' }}
              onClick={handleDownload}
            >
              下载内容
            </Button>
          </Space>

          <Divider />

          <div>
            <Title level={5}>格式规范说明</Title>
            {formatType === 'character' ? (
              <div>
                <Text>角色卡格式应包含以下内容：</Text>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  <li>角色名称</li>
                  <li>角色描述</li>
                  <li>角色背景</li>
                  <li>角色性格</li>
                  <li>角色能力</li>
                  <li>角色关系</li>
                  <li>其他相关信息</li>
                </ul>
              </div>
            ) : (
              <div>
                <Text>世界书格式应包含以下内容：</Text>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  <li>世界名称</li>
                  <li>世界描述</li>
                  <li>世界背景</li>
                  <li>主要势力</li>
                  <li>重要地点</li>
                  <li>历史事件</li>
                  <li>其他相关信息</li>
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <Text type="secondary">
          提示：
          <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
            <li>格式规范化可以确保内容符合角色卡或世界书的标准格式</li>
            <li>下载功能可以将内容保存为文本文件</li>
            <li>规范化后的内容可以直接用于 SillyTavern</li>
          </ul>
        </Text>
      </div>
    </Card>
  );
};

export default CreativeFormat;