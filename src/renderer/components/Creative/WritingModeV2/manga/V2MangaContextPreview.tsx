/**
 * 漫画解析：跨页上下文表格预览
 *
 * Spec: integrate-comic-parsing-mode / Requirement「AI 单页漫画分析」场景「跨页上下文注入」
 *
 * 展示注入下一页分析提示词的 Markdown 摘要表格，支持「重新生成」。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Spin, theme } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getWritingV2API } from '../../../../services/writingV2Service';
import type { MangaPageSummary } from '../../../../../shared/types/writing-v2.types';

interface Props {
  summaries: MangaPageSummary[];
}

const V2MangaContextPreview: React.FC<Props> = ({ summaries }) => {
  const { token } = theme.useToken();
  const [table, setTable] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const api = getWritingV2API();
    if (!api || summaries.length === 0) return;
    setLoading(true);
    try {
      const res = await api.manga.buildContextTable(summaries);
      if (res.success) setTable(res.table);
    } finally {
      setLoading(false);
    }
  }, [summaries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (summaries.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="完成页面分析后，此处展示携带到下一页的上下文表格"
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
          重新生成
        </Button>
      </div>
      {loading && !table ? (
        <div style={{ textAlign: 'center', padding: 12 }}>
          <Spin size="small" />
        </div>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
            fontSize: 12,
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {table}
        </pre>
      )}
    </div>
  );
};

export default V2MangaContextPreview;
