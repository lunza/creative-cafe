import React from 'react';
import { Card, Progress, Statistic, Space, Tag, Typography, theme } from 'antd';
import { BookOutlined, ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { ChapterStatus } from '../../../../shared/types/writing.types';
import { DEFAULT_WRITING_CONFIG } from '../../../../shared/constants/writing.constants';

const { Text } = Typography;

interface WritingProgressDashboardProps {
  projectId: string;
}

const AVERAGE_WRITING_SPEED = 2000;

const WritingProgressDashboard: React.FC<WritingProgressDashboardProps> = ({ projectId }) => {
  const project = useWritingProjectStore((state) => state.projects.find((p) => p.id === projectId));
  const { token } = theme.useToken();

  if (!project) {
    return <div style={{ padding: 24 }}>未找到项目</div>;
  }

  const chapters = project.outline?.chapters || [];
  const targetWords = project.config?.parameters?.targetWordCount || DEFAULT_WRITING_CONFIG.targetWordCount;
  const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);

  const completedChapters = chapters.filter((ch) => ch.status === ChapterStatus.COMPLETED).length;
  const totalChapters = chapters.length;

  const materialCount =
    (project.config?.resources?.worldBookIds?.length || 0) +
    (project.config?.resources?.characterCardIds?.length || 0);

  const remainingWords = Math.max(targetWords - totalWords, 0);
  const estimatedHours = remainingWords / AVERAGE_WRITING_SPEED;
  const estimatedTime =
    estimatedHours >= 1
      ? `${Math.floor(estimatedHours)}小时${Math.round((estimatedHours % 1) * 60)}分钟`
      : `${Math.round(estimatedHours * 60)}分钟`;

  const wordCountPercentage = Math.min(Math.round((totalWords / targetWords) * 100), 100);

  return (
    <Card style={{ marginBottom: token.marginMD }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Text strong style={{ marginBottom: token.marginXS, display: 'block' }}>
            字数进度
          </Text>
          <Progress
            percent={wordCountPercentage}
            format={() => `${totalWords.toLocaleString()} / ${targetWords.toLocaleString()} 字`}
            strokeColor={{
              '0%': '#1677ff',
              '100%': '#52c41a',
            }}
          />
        </div>

        <div>
          <Text strong style={{ marginBottom: token.marginXS, display: 'block' }}>
            章节完成状态
          </Text>
          <Space wrap>
            {chapters.map((ch) => {
              const statusConfig = {
                [ChapterStatus.COMPLETED]: { color: 'success', text: '✓' },
                [ChapterStatus.FAILED]: { color: 'error', text: '✗' },
                [ChapterStatus.GENERATING]: { color: 'warning', text: '...' },
                [ChapterStatus.PENDING]: { color: 'default', text: '○' },
              };
              const config = statusConfig[ch.status] || statusConfig[ChapterStatus.PENDING];
              return (
                <Tag key={ch.index} color={config.color} style={{ minWidth: 32, textAlign: 'center' }}>
                  {config.text}
                </Tag>
              );
            })}
          </Space>
        </div>

        <div style={{ display: 'flex', gap: token.marginLG }}>
          <Statistic
            title="参考资料"
            value={materialCount}
            prefix={<BookOutlined />}
            suffix="个"
            valueStyle={{ fontSize: 20 }}
          />
          <Statistic
            title="已完成章节"
            value={completedChapters}
            prefix={<CheckCircleOutlined />}
            suffix={`/ ${totalChapters}`}
            valueStyle={{ fontSize: 20 }}
          />
          <Statistic
            title="预计完成时间"
            value={estimatedTime}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ fontSize: 20 }}
          />
        </div>
      </Space>
    </Card>
  );
};

export default WritingProgressDashboard;
