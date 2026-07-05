/**
 * AnsiTileMap 组件
 *
 * 用于渲染 ANSI 字符瓦片地图。每个瓦片为单个字符或 ANSI 转义序列，
 * 支持 SGR 子集（前景/背景色、加粗、重置）。tileStyles 配置优先于 ANSI 解析结果。
 *
 * 用法示例：
 * ```tsx
 * <AnsiTileMap
 *   tiles={[
 *     ['@', '#', '.'],
 *     ['.', '@', '#'],
 *   ]}
 *   tileStyles={{ '@': { color: '#1890ff' } }}
 *   onTileClick={(row, col, tile) => console.log(row, col, tile)}
 *   showCoordinates
 * />
 * ```
 */

import React, { useMemo, useState } from 'react';
import './AnsiTileMap.css';

// =========================================================================
// ANSI 颜色映射表（标准 VGA 调色板）
// =========================================================================

/** SGR 前景色 30-37 → CSS 颜色 */
const ANSI_FG_COLORS: Record<number, string> = {
  30: '#000000', // black
  31: '#cc0000', // red
  32: '#4e9a06', // green
  33: '#c4a000', // yellow
  34: '#3465a4', // blue
  35: '#75507b', // magenta
  36: '#06989a', // cyan
  37: '#d3d7cf', // white
};

/** SGR 背景色 40-47 → CSS 颜色 */
const ANSI_BG_COLORS: Record<number, string> = {
  40: '#000000',
  41: '#cc0000',
  42: '#4e9a06',
  43: '#c4a000',
  44: '#3465a4',
  45: '#75507b',
  46: '#06989a',
  47: '#d3d7cf',
};

// =========================================================================
// 类型定义
// =========================================================================

/** 单个 ANSI 解析后的文本段（携带累积的样式状态） */
export interface ParsedAnsiSegment {
  text: string;
  color?: string;
  background?: string;
  bold?: boolean;
}

/** tileStyles 中单个字符的样式配置 */
export interface TileStyleConfig {
  color?: string;
  background?: string;
  /** 自定义显示文本（覆盖原字符，用于"标签"显示） */
  label?: string;
}

export interface AnsiTileMapProps {
  /** 字符矩阵，每个元素为单字符或 ANSI 转义序列（如 "\x1b[31mR\x1b[0m"） */
  tiles: string[][];
  /** 字符到样式的映射，key 为字符（如 "@"、"#"、"."），未配置的字符使用默认样式 */
  tileStyles?: Record<string, TileStyleConfig>;
  /** 瓦片点击回调，tile 参数为剥离 ANSI 转义后的纯字符 */
  onTileClick?: (row: number, col: number, tile: string) => void;
  /** 瓦片悬停回调（可选） */
  onTileHover?: (row: number, col: number, tile: string) => void;
  /** 等宽字体大小（px），默认 16 */
  fontSize?: number;
  /** 是否显示坐标轴（行号/列号），默认 false */
  showCoordinates?: boolean;
  /** 自定义类名 */
  className?: string;
}

// =========================================================================
// 工具函数
// =========================================================================

/**
 * 解析 ANSI 转义序列（仅支持 SGR 子集）。
 *
 * 支持的序列：
 * - `\x1b[0m` 或 `\x1b[m` 重置所有属性
 * - `\x1b[1m` 加粗
 * - `\x1b[30m` ~ `\x1b[37m` 前景色
 * - `\x1b[40m` ~ `\x1b[47m` 背景色
 *
 * 不支持的序列会被忽略（剥离转义后保留剩余字符的显示）。
 *
 * @example
 * parseAnsi('\x1b[31mR\x1b[0m') // => [{ text: 'R', color: '#cc0000' }]
 * parseAnsi('\x1b[1m@\x1b[0m')  // => [{ text: '@', bold: true }]
 */
export function parseAnsi(text: string): ParsedAnsiSegment[] {
  const segments: ParsedAnsiSegment[] = [];
  if (!text) {
    return segments;
  }

  // 匹配 SGR 转义序列：\x1b[<digits;digits;...>m
  const ansiRegex = /\x1b\[([\d;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let currentBg: string | undefined;
  let currentBold = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(text)) !== null) {
    // 转义序列之前的文本归入当前段
    if (match.index > lastIndex) {
      const segmentText = text.slice(lastIndex, match.index);
      if (segmentText) {
        segments.push({
          text: segmentText,
          color: currentColor,
          background: currentBg,
          bold: currentBold || undefined,
        });
      }
    }

    // 解析 SGR 参数
    const paramStr = match[1];
    if (paramStr === '') {
      // \x1b[m 等价于 \x1b[0m
      currentColor = undefined;
      currentBg = undefined;
      currentBold = false;
    } else {
      const params = paramStr.split(';').map((p) => parseInt(p, 10));
      for (const p of params) {
        if (Number.isNaN(p)) {
          continue;
        }
        if (p === 0) {
          currentColor = undefined;
          currentBg = undefined;
          currentBold = false;
        } else if (p === 1) {
          currentBold = true;
        } else if (p >= 30 && p <= 37) {
          currentColor = ANSI_FG_COLORS[p];
        } else if (p >= 40 && p <= 47) {
          currentBg = ANSI_BG_COLORS[p];
        }
        // 不支持的 SGR 码静默忽略（符合"退化为字符显示"的规格）
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // 末尾剩余文本
  if (lastIndex < text.length) {
    const segmentText = text.slice(lastIndex);
    if (segmentText) {
      segments.push({
        text: segmentText,
        color: currentColor,
        background: currentBg,
        bold: currentBold || undefined,
      });
    }
  }

  return segments;
}

/**
 * 剥离 ANSI 转义序列，仅保留可见文本。
 *
 * @example
 * stripAnsi('\x1b[31mR\x1b[0m') // => 'R'
 * stripAnsi('@')                // => '@'
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[\d;]*m/g, '');
}

// =========================================================================
// 组件实现
// =========================================================================

/** 默认字体大小（px） */
const DEFAULT_FONT_SIZE = 16;
/** 显示坐标轴时行号/列号列的固定宽度（px） */
const COORD_COLUMN_WIDTH = 28;

const AnsiTileMap: React.FC<AnsiTileMapProps> = ({
  tiles,
  tileStyles,
  onTileClick,
  onTileHover,
  fontSize = DEFAULT_FONT_SIZE,
  showCoordinates = false,
  className,
}) => {
  const [hoveredTile, setHoveredTile] = useState<{ row: number; col: number } | null>(null);

  const rows = tiles.length;
  const cols = rows > 0 ? tiles[0].length : 0;

  /**
   * 计算每个瓦片的最终样式与显示文本。
   * - tileStyles 优先于 ANSI 解析（如果 tileStyles 中有该字符的配置）
   * - 否则使用 ANSI 解析结果（取第一个非空段）
   */
  const tileRenderData = useMemo(() => {
    const result: Array<{
      displayText: string;
      color?: string;
      background?: string;
      bold?: boolean;
    }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const raw = tiles[r][c] ?? '';
        const stripped = stripAnsi(raw);

        const styleConfig = tileStyles?.[stripped];
        if (styleConfig) {
          result.push({
            displayText: styleConfig.label ?? stripped,
            color: styleConfig.color,
            background: styleConfig.background,
            bold: false,
          });
        } else {
          // ANSI 解析：取第一个非空文本段作为样式来源
          const segments = parseAnsi(raw);
          let chosenSeg: ParsedAnsiSegment | undefined;
          for (const seg of segments) {
            if (seg.text) {
              chosenSeg = seg;
              break;
            }
          }
          result.push({
            displayText: stripped,
            color: chosenSeg?.color,
            background: chosenSeg?.background,
            bold: chosenSeg?.bold,
          });
        }
      }
    }
    return result;
  }, [tiles, tileStyles, rows, cols]);

  const containerClass = ['ansi-tile-map', className].filter(Boolean).join(' ');

  // 边界场景：空矩阵或零列
  if (rows === 0 || cols === 0) {
    return <div className={containerClass} data-empty="true" />;
  }

  // 网格模板：如显示坐标轴，第一列为行号列
  const gridTemplate = showCoordinates
    ? `${COORD_COLUMN_WIDTH}px repeat(${cols}, 1fr)`
    : `repeat(${cols}, 1fr)`;

  return (
    <div
      className={containerClass}
      style={{ fontSize: `${fontSize}px` }}
      role="grid"
      aria-rowcount={rows}
      aria-colcount={cols}
    >
      <div
        className="ansi-tile-map__grid"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {/* 左上角空格 + 列号 */}
        {showCoordinates && (
          <>
            <div className="ansi-tile-map__corner" aria-hidden="true" />
            {Array.from({ length: cols }, (_, c) => (
              <div
                key={`coord-col-${c}`}
                className="ansi-tile-map__coord"
                role="columnheader"
              >
                {c}
              </div>
            ))}
          </>
        )}

        {/* 每行：行号 + 瓦片 */}
        {tiles.map((rowTiles, row) => (
          <React.Fragment key={`row-${row}`}>
            {showCoordinates && (
              <div
                className="ansi-tile-map__coord"
                role="rowheader"
              >
                {row}
              </div>
            )}
            {rowTiles.map((tile, col) => {
              const idx = row * cols + col;
              const data = tileRenderData[idx];
              const isHovered = hoveredTile?.row === row && hoveredTile?.col === col;

              const tileStyle: React.CSSProperties = {
                color: data.color,
                backgroundColor: data.background,
                fontWeight: data.bold ? 'bold' : undefined,
              };

              return (
                <div
                  key={`tile-${row}-${col}`}
                  className={[
                    'ansi-tile-map__tile',
                    isHovered ? 'ansi-tile-map__tile--hover' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={tileStyle}
                  data-row={row}
                  data-col={col}
                  data-char={data.displayText}
                  role="gridcell"
                  tabIndex={0}
                  onClick={() => {
                    const stripped = stripAnsi(tile);
                    onTileClick?.(row, col, stripped);
                  }}
                  onMouseEnter={() => {
                    setHoveredTile({ row, col });
                    const stripped = stripAnsi(tile);
                    onTileHover?.(row, col, stripped);
                  }}
                  onMouseLeave={() => {
                    setHoveredTile((cur) =>
                      cur?.row === row && cur?.col === col ? null : cur
                    );
                  }}
                  onFocus={() => {
                    setHoveredTile({ row, col });
                    const stripped = stripAnsi(tile);
                    onTileHover?.(row, col, stripped);
                  }}
                  onBlur={() => {
                    setHoveredTile((cur) =>
                      cur?.row === row && cur?.col === col ? null : cur
                    );
                  }}
                >
                  {data.displayText}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default AnsiTileMap;
