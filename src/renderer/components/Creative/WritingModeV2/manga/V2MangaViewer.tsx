/**
 * 漫画解析：逐页浏览 + 前后翻页 + 缩略图导航
 *
 * Spec: integrate-comic-parsing-mode / Requirement「漫画导入与分页浏览」
 *
 * - 通过 file:readAsBase64 读取图片为 data URI 展示
 * - 上一页/下一页按钮（边界禁用）
 * - 页码指示器 X / N
 * - 点击缩略图跳转
 * - 缩略图排列顺序随阅读顺序（rightToLeft 时反转）
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Button, Spin, theme } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { MangaPage, MangaReadingOrder } from '../../../../../shared/types/writing-v2.types';

interface Props {
  pages: MangaPage[];
  currentIndex: number; // 1-based
  readingOrder: MangaReadingOrder;
  analyzedPages: Set<number>;
  onPageChange: (index: number) => void;
}

const V2MangaViewer: React.FC<Props> = ({
  pages,
  currentIndex,
  readingOrder,
  analyzedPages,
  onPageChange,
}) => {
  const { token } = theme.useToken();
  const [dataUri, setDataUri] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const currentPage = pages.find((p) => p.index === currentIndex) || null;

  // 加载当前页图片
  useEffect(() => {
    let cancelled = false;
    if (!currentPage) {
      setDataUri('');
      return;
    }
    setLoading(true);
    window.electronAPI.file
      .readAsBase64(currentPage.absolutePath)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setDataUri(res.data);
        } else {
          setDataUri('');
        }
      })
      .catch(() => {
        if (!cancelled) setDataUri('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPage?.absolutePath]);

  const goPrev = useCallback(() => {
    if (currentIndex > 1) onPageChange(currentIndex - 1);
  }, [currentIndex, onPageChange]);

  const goNext = useCallback(() => {
    if (currentIndex < pages.length) onPageChange(currentIndex + 1);
  }, [currentIndex, pages.length, onPageChange]);

  // 缩略图排列：rightToLeft 时反转
  const orderedPages = readingOrder === 'rightToLeft' ? [...pages].reverse() : pages;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* 主图区 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token.colorFillQuaternary,
          borderRadius: token.borderRadius,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <Spin size="large" />
        ) : dataUri ? (
          <img
            src={dataUri}
            alt={`第 ${currentIndex} 页`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ color: token.colorTextTertiary }}>图片加载失败</span>
        )}
        {/* 左右翻页按钮（覆盖在主图上） */}
        <Button
          shape="circle"
          icon={<LeftOutlined />}
          disabled={currentIndex <= 1}
          onClick={goPrev}
          style={{ position: 'absolute', left: 12 }}
        />
        <Button
          shape="circle"
          icon={<RightOutlined />}
          disabled={currentIndex >= pages.length}
          onClick={goNext}
          style={{ position: 'absolute', right: 12 }}
        />
      </div>

      {/* 页码指示器 */}
      <div style={{ textAlign: 'center', fontSize: 13, color: token.colorTextSecondary, flexShrink: 0 }}>
        第 <strong style={{ color: token.colorPrimary }}>{currentIndex}</strong> / {pages.length} 页
      </div>

      {/* 缩略图导航 */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          flexShrink: 0,
          padding: '4px 0',
        }}
      >
        {orderedPages.map((page) => (
          <div
            key={page.index}
            onClick={() => onPageChange(page.index)}
            style={{
              width: 48,
              height: 64,
              flexShrink: 0,
              borderRadius: 4,
              cursor: 'pointer',
              border: page.index === currentIndex ? `2px solid ${token.colorPrimary}` : '1px solid ' + token.colorBorderSecondary,
              background: token.colorFillQuaternary,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, color: token.colorTextSecondary, zIndex: 1 }}>
              {page.index}
            </span>
            {analyzedPages.has(page.index) && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: token.colorSuccess,
                  zIndex: 1,
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default V2MangaViewer;
