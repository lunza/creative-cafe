/**
 * 漫画解析：跨页上下文表格预览
 *
 * Spec: integrate-comic-parsing-mode / Requirement「AI 单页漫画分析」场景「跨页上下文注入」
 *
 * 展示注入下一页分析提示词的 Markdown 摘要表格，支持「重新生成」。
 * 2026-10-08 视觉迭代（两轮）：
 * 1. <pre> 直出 Markdown 源码（管道符满屏）→ react-markdown 渲染为真实表格
 * 2. 8 列表格在 ~300px 窄侧栏被压成一字一行 → **每页一张卡片**（标签+值纵向堆叠）：
 *    解析 GFM 表格后按行渲染卡片，第一列（页码）作卡片标题，其余列作标签-值行。
 *    表格格式变化时回退 react-markdown 渲染，不白屏。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Spin, theme } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getWritingV2API } from '../../../../services/writingV2Service';
import type { MangaPageSummary } from '../../../../../shared/types/writing-v2.types';

interface Props {
  summaries: MangaPageSummary[];
}

/** 解析 GFM 表格（buildContextTable 的固定输出格式）为表头 + 数据行；非表格返回 null */
function parseGfmTable(markdown: string): { headers: string[]; rows: string[][] } | null {
  const lines = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  if (lines.length < 3) return null;
  const splitRow = (line: string): string[] =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const headers = splitRow(lines[0]);
  // 第二行必须是分隔行（---）
  if (!/^\|?[\s:-]+\|/.test(lines[1]) && !lines[1].includes('---')) return null;
  const rows = lines.slice(2).map(splitRow);
  return rows.length > 0 ? { headers, rows } : null;
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

  // 窄栏卡片化：第一列（页码）= 卡片标题，其余列 = 标签-值行
  const parsed = table ? parseGfmTable(table) : null;

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
      ) : parsed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
          {parsed.rows.map((row, ri) => (
            <div
              key={ri}
              style={{
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
                padding: '8px 10px',
              }}
            >
              {/* 第一列（页码，如 P1(5格)）作卡片标题 */}
              <div style={{ fontSize: 12, fontWeight: 600, color: token.colorPrimary, marginBottom: 6 }}>
                {row[0] || `第 ${ri + 1} 行`}
              </div>
              {/* 其余列：标签（表头）+ 值，空值（-）跳过 */}
              {parsed.headers.slice(1).map((label, ci) => {
                const value = row[ci + 1];
                if (!value || value === '-') return null;
                return (
                  <div key={ci} style={{ marginBottom: ci === parsed.headers.length - 2 ? 0 : 5 }}>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, lineHeight: 1.4 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 12, color: token.colorText, lineHeight: 1.6, wordBreak: 'break-word' }}>
                      {value}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        // 兜底：格式变化时回退 Markdown 渲染（GFM 表格）
        <div
          style={{
            padding: 10,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
            maxHeight: 480,
            overflowY: 'auto',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{table}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

export default V2MangaContextPreview;
