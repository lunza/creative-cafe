/**
 * 占位游戏主组件
 *
 * 用于尚未完整实现的占位模板（Mystery / DatingSim / Werewolf / TextRpg）。
 * 渲染一行"该游戏类型正在开发中"提示，避免懒加载时 import 失败。
 *
 * 当某游戏类型完整实现后，应将其模板的 Component 字段切换到专属主组件，
 * 此占位组件仍可保留作为未来新模板的初始 placeholder。
 */

import type { GameTemplateProps } from '../../../../shared/types/game.types';

/**
 * 占位主组件
 *
 * 不依赖外部 store / IPC，仅静态展示提示信息。
 */
export default function PlaceholderGameMain(_props: GameTemplateProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 320,
        padding: 32,
        textAlign: 'center',
        color: 'rgba(0, 0, 0, 0.45)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }} aria-hidden>
        🚧
      </div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: 'rgba(0, 0, 0, 0.65)' }}>
        该游戏类型正在开发中
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 360 }}>
        模板元数据已注册，可在游戏大厅查看。
        主玩法组件尚在规划中，敬请期待后续版本更新。
      </div>
    </div>
  );
}
