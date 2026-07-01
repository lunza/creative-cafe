import React, { useMemo, useState, useEffect } from 'react';
import { Empty } from 'antd';
import type { PromptTemplate, PromptPart, PromptVariable } from '../../../shared/types/promptTemplate.types';

interface PromptFlowChartProps {
  template: PromptTemplate;
}

// Layout constants
const NODE_WIDTH = 180;
const NODE_HEIGHT = 40;
const H_GAP = 30;
const V_GAP = 80;
const PADDING = 20;

const OUTPUT_WIDTH = 200;
const OUTPUT_HEIGHT = 80;

// Color scheme
const COLORS = {
  fixedFill: '#f0f0f0',
  fixedStroke: '#d9d9d9',
  editableFill: '#e6f7ff',
  editableStroke: '#91d5ff',
  variableFill: '#f6ffed',
  variableStroke: '#b7eb8f',
  outputFill: '#fff7e6',
  outputStroke: '#ffd591',
  lineStroke: '#bbb',
  arrowFill: '#999',
  textPrimary: '#333',
  textSecondary: '#666',
};

/** Truncate text to fit within node width */
const truncateText = (text: string, maxLen: number = 22): string => {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
};

const loadEngineSystemPrompt = async (): Promise<string> => {
  try {
    const result = await window.electronAPI.setting.load();
    if (result.success && result.setting) {
      const engines = result.setting.aiEngines || [];
      const activeEngineId = result.setting.activeEngineId;
      const activeEngine = engines.find((e: any) => e.id === activeEngineId) || engines[0];
      return activeEngine?.system_prompt?.trim() || '';
    }
  } catch {}
  return '';
};

interface NodePosition {
  x: number;
  y: number;
  centerX: number;
  centerY: number;
}

const PromptFlowChart: React.FC<PromptFlowChartProps> = ({ template }) => {
  const [engineSystemPrompt, setEngineSystemPrompt] = useState('');
  useEffect(() => {
    loadEngineSystemPrompt().then(setEngineSystemPrompt);
  }, []);

  const { variables, parts } = useMemo(() => {
    const sortedParts = [...template.parts].sort((a, b) => a.order - b.order);
    return { variables: template.variables, parts: sortedParts };
  }, [template]);

  // Calculate layout positions
  const layout = useMemo(() => {
    const hasVariables = variables.length > 0;
    const hasParts = parts.length > 0;
    const hasEngine = engineSystemPrompt.length > 0;

    // Calculate row widths
    const varRowWidth = hasVariables
      ? variables.length * NODE_WIDTH + (variables.length - 1) * H_GAP
      : 0;
    const partRowWidth = hasParts
      ? parts.length * NODE_WIDTH + (parts.length - 1) * H_GAP
      : 0;

    const svgWidth =
      Math.max(varRowWidth, partRowWidth, OUTPUT_WIDTH, NODE_WIDTH) + PADDING * 2;

    // Y positions for each section
    let currentY = PADDING;

    // Engine node at the very top (centered)
    const engineY = hasEngine ? currentY : -1;
    if (hasEngine) {
      currentY += NODE_HEIGHT + V_GAP;
    }

    const varY = hasVariables ? currentY : -1;
    if (hasVariables) {
      currentY += NODE_HEIGHT + V_GAP;
    }

    const partY = hasParts ? currentY : -1;
    if (hasParts) {
      currentY += NODE_HEIGHT + V_GAP;
    }

    const outputY = currentY;
    const svgHeight = outputY + OUTPUT_HEIGHT + PADDING;

    // Engine node position (centered)
    const engineX = (svgWidth - NODE_WIDTH) / 2;
    const engineCenterX = engineX + NODE_WIDTH / 2;
    const engineCenterY = engineY + NODE_HEIGHT / 2;

    // Variable node positions
    const varStartX = (svgWidth - varRowWidth) / 2;
    const varPositions: NodePosition[] = variables.map((_v, i) => {
      const x = varStartX + i * (NODE_WIDTH + H_GAP);
      return { x, y: varY, centerX: x + NODE_WIDTH / 2, centerY: varY + NODE_HEIGHT / 2 };
    });

    // Part node positions
    const partStartX = (svgWidth - partRowWidth) / 2;
    const partPositions: NodePosition[] = parts.map((_p, i) => {
      const x = partStartX + i * (NODE_WIDTH + H_GAP);
      return { x, y: partY, centerX: x + NODE_WIDTH / 2, centerY: partY + NODE_HEIGHT / 2 };
    });

    // Output node position (diamond)
    const outputX = (svgWidth - OUTPUT_WIDTH) / 2;
    const outputCenterX = outputX + OUTPUT_WIDTH / 2;
    const outputCenterY = outputY + OUTPUT_HEIGHT / 2;

    return {
      svgWidth,
      svgHeight,
      engineX,
      engineY,
      engineCenterX,
      engineCenterY,
      varPositions,
      partPositions,
      outputX,
      outputY,
      outputCenterX,
      outputCenterY,
      hasVariables,
      hasParts,
      hasEngine,
    };
  }, [variables, parts, engineSystemPrompt]);

  // Build connection lines: variable -> part
  const varToPartLines = useMemo(() => {
    if (!layout.hasVariables || !layout.hasParts) return [];
    const lines: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }> = [];
    variables.forEach((variable: PromptVariable, vi: number) => {
      const varPos = layout.varPositions[vi];
      parts.forEach((part: PromptPart, pi: number) => {
        if (part.variables.includes(variable.name)) {
          const partPos = layout.partPositions[pi];
          lines.push({
            key: `v2p-${variable.name}-${part.id}`,
            x1: varPos.centerX,
            y1: varPos.y + NODE_HEIGHT,
            x2: partPos.centerX,
            y2: partPos.y,
          });
        }
      });
    });
    return lines;
  }, [variables, parts, layout]);

  // Build connection lines: part -> output
  const partToOutputLines = useMemo(() => {
    if (!layout.hasParts) return [];
    return parts.map((part: PromptPart, pi: number) => {
      const partPos = layout.partPositions[pi];
      return {
        key: `p2o-${part.id}`,
        x1: partPos.centerX,
        y1: partPos.y + NODE_HEIGHT,
        x2: layout.outputCenterX,
        y2: layout.outputY,
      };
    });
  }, [parts, layout]);

  // Build connection line: engine -> output (feeds directly into final system prompt)
  const engineToOutputLine = useMemo(() => {
    if (!layout.hasEngine) return null;
    return {
      key: 'e2o-engine-system-prompt',
      x1: layout.engineCenterX,
      y1: layout.engineY + NODE_HEIGHT,
      x2: layout.outputCenterX,
      y2: layout.outputY,
    };
  }, [layout]);

  if (!variables.length && !parts.length && !engineSystemPrompt) {
    return (
      <div style={{ padding: 40 }}>
        <Empty description="暂无流程图数据" />
      </div>
    );
  }

  // Diamond points for output node
  const diamondPoints = [
    `${layout.outputCenterX},${layout.outputY}`,
    `${layout.outputX + OUTPUT_WIDTH},${layout.outputCenterY}`,
    `${layout.outputCenterX},${layout.outputY + OUTPUT_HEIGHT}`,
    `${layout.outputX},${layout.outputCenterY}`,
  ].join(' ');

  return (
    <div
      style={{
        width: '100%',
        overflow: 'auto',
        padding: '16px 0',
      }}
    >
      <svg
        width="100%"
        viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`}
        style={{ maxHeight: layout.svgHeight, minWidth: layout.svgWidth * 0.6 }}
      >
        <defs>
          <marker
            id="flowchart-arrow"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={COLORS.arrowFill} />
          </marker>
        </defs>

        {/* Connection lines: variable -> part (drawn first so they appear behind nodes) */}
        {varToPartLines.map((line) => (
          <line
            key={line.key}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={COLORS.lineStroke}
            strokeWidth={1}
            markerEnd="url(#flowchart-arrow)"
          />
        ))}

        {/* Connection lines: part -> output */}
        {partToOutputLines.map((line) => (
          <line
            key={line.key}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={COLORS.lineStroke}
            strokeWidth={1}
            markerEnd="url(#flowchart-arrow)"
          />
        ))}

        {/* Connection line: engine -> output (direct feed to final system prompt) */}
        {engineToOutputLine && (
          <line
            key={engineToOutputLine.key}
            x1={engineToOutputLine.x1}
            y1={engineToOutputLine.y1}
            x2={engineToOutputLine.x2}
            y2={engineToOutputLine.y2}
            stroke={COLORS.lineStroke}
            strokeWidth={1}
            markerEnd="url(#flowchart-arrow)"
          />
        )}

        {/* Engine system prompt node (grey fixed rectangle at top) */}
        {layout.hasEngine && (
          <g key="engine-system-prompt">
            <rect
              x={layout.engineX}
              y={layout.engineY}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={4}
              ry={4}
              fill={COLORS.fixedFill}
              stroke={COLORS.fixedStroke}
              strokeWidth={1.5}
            />
            <text
              x={layout.engineCenterX}
              y={layout.engineY + 16}
              textAnchor="middle"
              fontSize={12}
              fontWeight="bold"
              fill={COLORS.textPrimary}
            >
              {truncateText('引擎系统提示词')}
            </text>
            <text
              x={layout.engineCenterX}
              y={layout.engineY + 32}
              textAnchor="middle"
              fontSize={10}
              fill={COLORS.textSecondary}
            >
              {truncateText('全局设置', 24)}
            </text>
          </g>
        )}

        {/* Variable nodes (green rounded rectangles) */}
        {variables.map((variable: PromptVariable, i: number) => {
          const pos = layout.varPositions[i];
          return (
            <g key={`var-${variable.name}`}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={10}
                ry={10}
                fill={COLORS.variableFill}
                stroke={COLORS.variableStroke}
                strokeWidth={1.5}
              />
              <text
                x={pos.centerX}
                y={pos.y + 16}
                textAnchor="middle"
                fontSize={12}
                fontWeight="bold"
                fill={COLORS.textPrimary}
              >
                {truncateText(variable.name)}
              </text>
              <text
                x={pos.centerX}
                y={pos.y + 32}
                textAnchor="middle"
                fontSize={10}
                fill={COLORS.textSecondary}
              >
                {truncateText(variable.source, 24)}
              </text>
            </g>
          );
        })}

        {/* Part nodes (rectangles: grey for fixed, blue for editable) */}
        {parts.map((part: PromptPart, i: number) => {
          const pos = layout.partPositions[i];
          const isFixed = part.type === 'fixed';
          const fill = isFixed ? COLORS.fixedFill : COLORS.editableFill;
          const stroke = isFixed ? COLORS.fixedStroke : COLORS.editableStroke;
          return (
            <g key={`part-${part.id}`}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={4}
                ry={4}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={pos.centerX}
                y={pos.y + 16}
                textAnchor="middle"
                fontSize={12}
                fontWeight="bold"
                fill={COLORS.textPrimary}
              >
                {truncateText(part.label)}
              </text>
              <text
                x={pos.centerX}
                y={pos.y + 32}
                textAnchor="middle"
                fontSize={10}
                fill={COLORS.textSecondary}
              >
                {part.role}
              </text>
            </g>
          );
        })}

        {/* Output node (diamond shape) */}
        <g>
          <polygon
            points={diamondPoints}
            fill={COLORS.outputFill}
            stroke={COLORS.outputStroke}
            strokeWidth={1.5}
          />
          <text
            x={layout.outputCenterX}
            y={layout.outputCenterY - 4}
            textAnchor="middle"
            fontSize={13}
            fontWeight="bold"
            fill={COLORS.textPrimary}
          >
            最终提示词
          </text>
          <text
            x={layout.outputCenterX}
            y={layout.outputCenterY + 14}
            textAnchor="middle"
            fontSize={10}
            fill={COLORS.textSecondary}
          >
            system / user
          </text>
        </g>
      </svg>
    </div>
  );
};

export default PromptFlowChart;
