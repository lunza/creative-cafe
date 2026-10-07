/**
 * 漫画解析：渲染层摘要工具
 *
 * Spec: integrate-comic-parsing-mode
 *
 * 从（可能被用户修正过的）MangaPageAnalysis 派生 MangaPageSummary，
 * 用于构建跨页上下文（携带到下一页分析提示词）。
 * 与主进程 buildPageSummary 逻辑保持一致。
 */
import type {
  MangaPageAnalysis,
  MangaPageSummary,
} from '../../../../../shared/types/writing-v2.types';

/**
 * 从单页分析结果派生跨页上下文摘要（每页目标 ≥100 字）
 * ⚠️ 与主进程 MangaParsingService.buildPageSummary 逻辑保持一致（修改时需同步）
 */
export function analysisToSummary(pageIndex: number, analysis: MangaPageAnalysis): MangaPageSummary {
  const { characters, scene, panels, overallEmotion, narrativeContinuity } = analysis.pageAnalysis;

  const charactersStr = characters.map((c) => `${c.name}(${c.expression || '?'})`).join(', ');
  const sceneStr =
    [scene.location, scene.time, scene.atmosphere].filter(Boolean).join('/') ||
    scene.environment ||
    '';
  const keyPlot = panels[0]?.plot || overallEmotion || '';

  // 角色动作摘要
  const actions = characters
    .map((c) => (c.action && c.action.trim() ? `${c.name}: ${c.action.trim()}` : ''))
    .filter(Boolean)
    .join('; ');

  // 逐分镜剧情：保留全部分镜（此前只取第一个，其余分镜剧情丢失）
  const panelPlots =
    panels
      .map((p) => `分镜${p.panelIndex}: ${p.plot && p.plot.trim() ? p.plot.trim() : '（无剧情描述）'}`)
      .join('；') || '';

  let keyDialogue = '';
  for (const panel of panels) {
    for (const text of panel.texts) {
      if (text.type === 'dialogue' && text.content) {
        keyDialogue = `"${text.content}"`;
        break;
      }
    }
    if (keyDialogue) break;
  }

  // 关键文本摘录：全部对话/旁白/拟音，带类型标注，总长截断 300 字
  const textTypeLabel = (t: string): string =>
    t === 'dialogue' ? '对话' : t === 'narration' ? '旁白' : '拟音';
  const allTexts: string[] = [];
  for (const panel of panels) {
    for (const text of panel.texts) {
      const content = text.content?.trim();
      if (content) allTexts.push(`"${content}"(${textTypeLabel(text.type)})`);
    }
  }
  let texts = allTexts.join(' ');
  if (texts.length > 300) texts = `${texts.slice(0, 300)}…`;

  return {
    pageIndex,
    characters: charactersStr,
    scene: sceneStr,
    keyPlot,
    emotion: overallEmotion,
    keyDialogue,
    panelCount: panels.length,
    panelPlots,
    actions,
    texts,
    continuity: narrativeContinuity || '',
  };
}
