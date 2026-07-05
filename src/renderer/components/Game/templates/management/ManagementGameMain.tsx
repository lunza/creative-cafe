/**
 * 文字模拟经营游戏主组件（Task 14 / SubTask 14.3 + Task 16 端到端循环）
 *
 * 由 GameMainPage 框架注入 GameTemplateProps，渲染经营游戏的模板面板区：
 * - 顶部：当前回合 + 结束回合按钮
 * - 主体（按顺序）：
 *   1. 资源（ResourcePanel，默认展开）
 *   2. 设施（FacilityPanel，默认展开，onBuild 接管 → onAction('build:<facility_id>')）
 *   3. 招募（RecruitPanel，硬编码角色列表，点击 → onAction('recruit:<character_id>')）
 *   4. 统计（StatisticsPanel，默认展开）
 *
 * 设计要点：
 * - 不重复渲染 GameStateBar（已由 GameMainPage 顶部状态栏统一渲染）
 * - 不重复订阅 store 流式事件（由 gameStore 模块加载时已订阅）
 * - 玩家行动通过 props.onAction 回调传递给 GameMainPage，
 *   由其包装 gameStore.generateNarrative({ userAction }) 触发叙事生成
 *   （避免直接调用 store，便于 GameMainPage 统一注入 templateSystemPrompt / tableSchema）
 * - 生成中禁用所有按钮（end_turn / build:* / recruit:*），避免并发请求
 * - currentTurn 响应 tableData 变化（订阅 useGameStore selector），
 *   AI 在 endTurn 中通过 tableEdit 更新 stats sheet 的 turn 行后，UI 自动反映新回合数
 *
 * 布局：
 * ```
 * ┌──────────────────────────────────┐
 * │ [回合 N] [结束回合] (顶部工具条)    │
 * ├──────────────────────────────────┤
 * │ ▼ 资源（ResourcePanel）           │
 * │ ▼ 设施（FacilityPanel）           │
 * │ ▼ 招募（RecruitPanel，硬编码）    │
 * │ ▼ 统计（StatisticsPanel）         │
 * └──────────────────────────────────┘
 * ```
 *
 * 【招募角色与成本】
 * 与 ManagementNarrativeService.RECRUIT_COSTS 表保持一致（Task 15 实现）：
 * - farmer    (农夫)   消耗 20 金币 → 增加 1 人口
 * - lumberjack (木匠)  消耗 30 金币 → 增加 1 人口
 * - merchant  (商人)   消耗 50 金币 → 增加 1 人口
 *
 * 注意：cost 仅用于 UI 展示，实际扣减由主进程 ManagementNarrativeService.applyCharacterRecruit
 * 通过 tableEdit 命令应用。前端不做硬性校验（避免与后端规则不同步）。
 *
 * 参考：
 * - src/renderer/components/Game/templates/PlaceholderGameMain.tsx（占位组件参考）
 * - src/renderer/components/Game/GameMainPage.tsx（框架注入的 props）
 * - src/renderer/components/Game/panels/* （已实现面板）
 * - src/main/services/game/templates/management/ManagementNarrativeService.ts（RECRUIT_COSTS）
 */

import React, { useMemo, useCallback } from 'react';
import { Button, Space, Typography, Tag, List, Card } from 'antd';
import { ForwardOutlined, UserAddOutlined } from '@ant-design/icons';
import type { GameTemplateProps } from '../../../../../shared/types/game.types';
import { useGameStore } from '../../../../stores/gameStore';
import { ResourcePanel } from '../../panels/ResourcePanel';
import { FacilityPanel } from '../../panels/FacilityPanel';
import { StatisticsPanel } from '../../panels/StatisticsPanel';
import { CollapsiblePanel } from '../../panels/CollapsiblePanel';

const { Text } = Typography;

// ==================== 可招募角色配置（硬编码） ====================

/**
 * 可招募角色定义
 *
 * 与 ManagementNarrativeService.RECRUIT_COSTS（Task 15）对齐：
 * - id:        角色唯一 ID（与 userAction 'recruit:<id>' 拼接）
 * - name:      角色中文名（UI 显示）
 * - role:      角色身份（写入 characters sheet 的 role 字段）
 * - cost:      招募成本描述（UI 显示用；实际扣减由主进程处理）
 * - costGold:  金币成本数值（用于 UI 资源不足提示）
 *
 * 注意：UI 不做硬性资源校验（前端无法读取 facilities production 等
 * 复杂状态），仅展示成本。后端 ManagementNarrativeService 会做实际扣减。
 */
interface RecruitOption {
  id: string;
  name: string;
  role: string;
  cost: string;
  costGold: number;
}

const RECRUIT_OPTIONS: RecruitOption[] = [
  { id: 'farmer',    name: '农夫',   role: '生产者', cost: '20 金币 / +1 人口', costGold: 20 },
  { id: 'lumberjack', name: '木匠',  role: '生产者', cost: '30 金币 / +1 人口', costGold: 30 },
  { id: 'merchant',  name: '商人',   role: '经济',   cost: '50 金币 / +1 人口', costGold: 50 }
];

// ==================== 工具函数 ====================

/**
 * 从 tableData 派生当前回合数
 *
 * 读取 stats sheet 中 key='turn' 的行，取其 value 字段（数字字符串）。
 * 容错：缺省 / 非数字 / 小于 1 时回退到 1。
 *
 * 注意：与 ManagementNarrativeService.resolveCurrentTurn 的字段读取约定
 * 不同 —— 此处使用 schema 字段名 'key' / 'value'（managementSchema.ts
 * 定义的语义化字段名），而非主进程使用的 '2' / '4' 列号。
 * 因为 ResourcePanel / FacilityPanel / StatisticsPanel 都按字段名读取，
 * 此处保持一致。
 */
function deriveCurrentTurn(tableData: ReturnType<typeof useGameStore.getState>['tableData']): number {
  if (!tableData) return 1;
  const statsRows = tableData.data?.stats;
  if (!Array.isArray(statsRows)) return 1;
  const turnRow = statsRows.find((row) => row?.key === 'turn');
  const rawValue = turnRow?.value;
  const parsed = parseInt(String(rawValue ?? '1'), 10);
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
}

/**
 * 从 tableData 派生当前金币数量（用于招募按钮的资源不足提示）
 *
 * 读取 resources sheet 中 name='金币' 的行，取其 amount 字段。
 * 容错：缺省 / 非数字时回退到 0。
 */
function deriveCurrentGold(tableData: ReturnType<typeof useGameStore.getState>['tableData']): number {
  if (!tableData) return 0;
  const resourceRows = tableData.data?.resources;
  if (!Array.isArray(resourceRows)) return 0;
  const goldRow = resourceRows.find((row) => row?.name === '金币');
  if (!goldRow) return 0;
  const raw = goldRow.amount;
  if (typeof raw === 'number') return raw;
  const parsed = parseFloat(String(raw ?? '0'));
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ==================== 招募面板（内联组件） ====================

/**
 * 招募面板组件
 *
 * 硬编码 3 种可招募角色（farmer / lumberjack / merchant），
 * 点击"招募"按钮通过 props.onRecruit(characterId) 上抛行动。
 *
 * 设计要点：
 * - 纯展示 + 回调：不修改 store，不直接调用 generateNarrative
 * - 生成中禁用所有招募按钮
 * - 资源不足时按钮仍可点击（由后端校验），但 Tooltip 提示金币不足
 * - 不依赖 antd Form / Modal，简单 List 渲染，便于 renderToStaticMarkup 测试
 */
interface RecruitPanelProps {
  /** 当前金币（用于资源不足提示；null 表示无法判定（tableData 未加载）） */
  currentGold: number;
  /** 是否正在生成叙事（true 时禁用所有招募按钮） */
  isGenerating: boolean;
  /** 招募回调，参数为角色 ID（如 'farmer'） */
  onRecruit: (characterId: string) => void;
}

const RecruitPanel: React.FC<RecruitPanelProps> = ({
  currentGold,
  isGenerating,
  onRecruit
}) => {
  return (
    <Card className="game-panel" title="招募" size="small" data-testid="management-recruit-panel-card">
      <List
        size="small"
        dataSource={RECRUIT_OPTIONS}
        renderItem={(item) => {
          const insufficient = currentGold < item.costGold;
          const disabled = isGenerating;
          return (
            <List.Item>
              <div className="game-panel__facility-item">
                <Space>
                  <span>{item.name}</span>
                  <Tag color="blue">{item.role}</Tag>
                  <span className="game-panel__facility-cost">
                    消耗：{item.cost}
                  </span>
                </Space>
                <Button
                  type="primary"
                  size="small"
                  icon={<UserAddOutlined />}
                  className="game-panel__build-button"
                  disabled={disabled}
                  onClick={() => onRecruit(item.id)}
                  data-testid={`management-recruit-button-${item.id}`}
                >
                  招募
                </Button>
              </div>
              {/* 资源不足的视觉提示（不影响按钮可点击性，由后端校验） */}
              {insufficient && !isGenerating ? (
                <div style={{ marginTop: 4, fontSize: 12, color: '#faad14' }}>
                  金币不足（当前 {currentGold} / 需要 {item.costGold}）
                </div>
              ) : null}
            </List.Item>
          );
        }}
      />
    </Card>
  );
};

// ==================== 主组件 ====================

/**
 * 经营游戏主组件
 *
 * 接收 GameTemplateProps（saveId / gameId / tableData / onAction），
 * 仅消费 tableData 派生展示数据；玩家行动通过 onAction 回调上抛。
 *
 * 同时通过 useGameStore 读取 isGenerating / tableData，
 * 用于禁用按钮与响应 tableData 变化（如 endTurn 后回合数 +1）。
 */
const ManagementGameMain: React.FC<GameTemplateProps> = ({
  onAction
}) => {
  const isGenerating = useGameStore((s) => s.isGenerating);
  // 订阅 tableData：使其变化时自动重渲染（endTurn 后 stats sheet 的 turn 行被
  // tableEdit 更新，组件需重读 currentTurn）
  const tableData = useGameStore((s) => s.tableData);

  // ----- 当前回合派生：从 tableData.stats 读取 key='turn' 的行 -----
  // 响应 tableData 变化（如 endTurn 后 AI 通过 tableEdit 更新 turn 行），
  // 让 UI 自动反映新回合数
  const currentTurn = useMemo(() => deriveCurrentTurn(tableData), [tableData]);

  // ----- 当前金币派生：用于招募按钮的资源不足提示 -----
  const currentGold = useMemo(() => deriveCurrentGold(tableData), [tableData]);

  // ----- 结束回合按钮：触发 onAction('end_turn') -----
  // 由 GameMainPage 包装为 generateNarrative({ userAction: 'end_turn' })
  // 主进程 ManagementNarrativeService.endTurn 流程：结算产出 → 随机事件 → 回合+1 → AI 叙事
  const handleEndTurn = useCallback(() => {
    if (isGenerating) return;
    onAction('end_turn');
  }, [isGenerating, onAction]);

  // ----- 设施建造回调：触发 onAction('build:<facilityId>') -----
  // 由 GameMainPage 包装为 generateNarrative({ userAction: 'build:farm' })
  // 主进程 ManagementNarrativeService.applyFacilityBuild 处理资源扣减
  const handleBuild = useCallback(
    (facilityId: string) => {
      if (isGenerating) return;
      onAction(`build:${facilityId}`);
    },
    [isGenerating, onAction]
  );

  // ----- 招募回调：触发 onAction('recruit:<characterId>') -----
  // 由 GameMainPage 包装为 generateNarrative({ userAction: 'recruit:farmer' })
  // 主进程 ManagementNarrativeService.applyCharacterRecruit 处理金币扣减 + 人口增加
  const handleRecruit = useCallback(
    (characterId: string) => {
      if (isGenerating) return;
      onAction(`recruit:${characterId}`);
    },
    [isGenerating, onAction]
  );

  return (
    <div
      className="management-game-main"
      data-testid="management-game-main"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* ---------- 顶部工具条：当前回合 + 结束回合按钮 ---------- */}
      <div
        className="management-game-main__toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(0, 0, 0, 0.15)',
          borderRadius: 6
        }}
      >
        <Space size="middle" align="center">
          <Tag color="blue" data-testid="management-game-turn-tag">
            第 {currentTurn} 回合
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            建造设施 / 招募角色 / 结束回合以推进游戏
          </Text>
        </Space>
        <Button
          type="primary"
          icon={<ForwardOutlined />}
          onClick={handleEndTurn}
          disabled={isGenerating}
          loading={isGenerating}
          data-testid="management-game-end-turn-button"
        >
          结束回合
        </Button>
      </div>

      {/* ---------- 资源面板（默认展开） ---------- */}
      <CollapsiblePanel
        title="资源"
        panelKey="management-resource-panel"
        defaultOpen
      >
        <ResourcePanel sheetName="resources" />
      </CollapsiblePanel>

      {/* ---------- 设施面板（默认展开） ---------- */}
      <CollapsiblePanel
        title="设施"
        panelKey="management-facility-panel"
        defaultOpen
      >
        <FacilityPanel sheetName="facilities" onBuild={handleBuild} />
      </CollapsiblePanel>

      {/* ---------- 招募面板（默认展开） ---------- */}
      <CollapsiblePanel
        title="招募"
        panelKey="management-recruit-panel"
        defaultOpen
      >
        <RecruitPanel
          currentGold={currentGold}
          isGenerating={isGenerating}
          onRecruit={handleRecruit}
        />
      </CollapsiblePanel>

      {/* ---------- 统计面板（默认展开） ---------- */}
      <CollapsiblePanel
        title="统计"
        panelKey="management-statistics-panel"
        defaultOpen
      >
        <StatisticsPanel sheetName="stats" />
      </CollapsiblePanel>
    </div>
  );
};

export default ManagementGameMain;
