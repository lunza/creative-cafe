/**
 * MangaParsingService 单元测试
 *
 * Spec: integrate-comic-parsing-mode
 *
 * 覆盖 scanFolder 的确定性逻辑（过滤 + 数字序号排序），
 * AI 分析路径依赖外部模型，不在此单测覆盖。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mangaParsingService } from '../MangaParsingService';
import type {
  MangaPageAnalysis,
  MangaPageSummary,
} from '../../../../shared/types/writing-v2.types';

/** 构造一页富信息分析结果（用于跨页上下文验证） */
function makeAnalysis(): MangaPageAnalysis {
  return {
    pageAnalysis: {
      characters: [
        { name: '林晚', expression: '惊讶', action: '猛地后退半步，双手撑住桌沿，视线锁定门口的身影' },
        { name: '苏哲', expression: '冷静', action: '缓步走入，指尖夹着一枚旧怀表，目光扫过满桌文件' },
      ],
      scene: {
        environment: '深夜的档案室，台灯昏黄，墙上挂满泛黄照片',
        time: '深夜',
        location: '市图书馆地下档案室',
        atmosphere: '紧张而压抑，空气里弥漫着旧纸张的味道',
      },
      panels: [
        {
          panelIndex: 1,
          plot: '林晚独自坐在档案室中央的长桌前，台灯照亮摊开的案卷，她眉头紧锁，指尖反复摩挲一张黑白照片的边缘，背景墙上密集的旧照片在昏黄灯光下投下阴影。',
          emotion: '焦灼、专注，带一丝不安',
          texts: [
            { content: '二十年前的真相，到底藏在哪里……', type: 'narration', position: '页面顶部' },
          ],
        },
        {
          panelIndex: 2,
          plot: '门被推开，苏哲逆光而入，怀表在指间轻轻翻转，他环视四周后把目光停在林晚身上，两人之间隔着半张长桌与一室沉默，桌面上散落的文件被穿堂风吹起一角。',
          emotion: '对峙、试探',
          texts: [
            { content: '你比我想象中来得早。', type: 'dialogue', position: '苏哲对话框' },
            { content: '你怎么知道我会在这里？', type: 'dialogue', position: '林晚对话框' },
          ],
        },
      ],
      overallEmotion: '悬念递进，从独处焦灼转为双人博弈的紧张',
      narrativeContinuity: '承接上一页林晚潜入档案室的行动，本页引入关键角色苏哲，矛盾正式激化',
    },
    readingOrder: 'rightToLeft',
    analyzedAt: Date.now(),
    userModified: false,
  };
}

/** 主进程 buildPageSummary 的等价调用：通过 analyzePage 不便，直接构造 summary 走 buildContextTable */
function makeSummary(pageIndex: number): MangaPageSummary {
  // 复刻主进程 buildPageSummary 的组装逻辑（与 mangaSummaryUtils.analysisToSummary 一致）
  const a = makeAnalysis();
  const pa = a.pageAnalysis;
  const characters = pa.characters.map((c) => `${c.name}(${c.expression || '?'})`).join(', ');
  const actions = pa.characters
    .map((c) => (c.action && c.action.trim() ? `${c.name}: ${c.action.trim()}` : ''))
    .filter(Boolean)
    .join('; ');
  const scene =
    [pa.scene.location, pa.scene.time, pa.scene.atmosphere].filter(Boolean).join('/') ||
    pa.scene.environment ||
    '';
  const panelPlots = pa.panels
    .map((p) => `分镜${p.panelIndex}: ${p.plot && p.plot.trim() ? p.plot.trim() : '（无剧情描述）'}`)
    .join('；');
  const allTexts: string[] = [];
  for (const panel of pa.panels) {
    for (const t of panel.texts) {
      const c = t.content?.trim();
      if (c) allTexts.push(`"${c}"(${t.type === 'dialogue' ? '对话' : t.type === 'narration' ? '旁白' : '拟音'})`);
    }
  }
  let texts = allTexts.join(' ');
  if (texts.length > 300) texts = `${texts.slice(0, 300)}…`;
  return {
    pageIndex,
    characters,
    scene,
    keyPlot: pa.panels[0]?.plot || '',
    emotion: pa.overallEmotion,
    keyDialogue: pa.panels[0]?.texts.find((t) => t.type === 'dialogue')?.content || '',
    panelCount: pa.panels.length,
    panelPlots,
    actions,
    texts,
    continuity: pa.narrativeContinuity || '',
  };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-test-'));

function touch(name: string, size = 100): void {
  fs.writeFileSync(path.join(tmpDir, name), Buffer.alloc(size));
}

beforeAll(() => {
  touch('01.png');
  touch('02.png');
  touch('10.png');
  touch('100.jpg');
  touch('2.webp');
  touch('abc.bmp'); // 无数字前缀
  touch('notes.txt'); // 非图片，应被过滤
  touch('page45.tiff');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MangaParsingService.scanFolder', () => {
  it('过滤非图片文件，仅保留支持的扩展名', () => {
    const res = mangaParsingService.scanFolder(tmpDir);
    expect(res.success).toBe(true);
    expect(res.total).toBe(7);
    expect(res.pages.map((p) => p.fileName)).not.toContain('notes.txt');
  });

  it('按数字序号升序排列（无数字的排在最后）', () => {
    const res = mangaParsingService.scanFolder(tmpDir);
    expect(res.success).toBe(true);
    const names = res.pages.map((p) => p.fileName);
    // 数字排序：2 < 10 < 45 < 100（而非字典序的 10 < 2）
    expect(names.indexOf('2.webp')).toBeLessThan(names.indexOf('10.png'));
    expect(names.indexOf('10.png')).toBeLessThan(names.indexOf('page45.tiff'));
    expect(names.indexOf('page45.tiff')).toBeLessThan(names.indexOf('100.jpg'));
    // 无数字前缀的排最后
    expect(names[names.length - 1]).toBe('abc.bmp');
  });

  it('页面 index 从 1 开始连续编号', () => {
    const res = mangaParsingService.scanFolder(tmpDir);
    expect(res.pages[0].index).toBe(1);
    expect(res.pages[res.pages.length - 1].index).toBe(res.total);
    for (let i = 0; i < res.pages.length; i++) {
      expect(res.pages[i].index).toBe(i + 1);
    }
  });

  it('返回正确的绝对路径和文件大小', () => {
    const res = mangaParsingService.scanFolder(tmpDir);
    const first = res.pages.find((p) => p.fileName === '01.png');
    expect(first).toBeDefined();
    expect(first!.absolutePath).toBe(path.join(tmpDir, '01.png'));
    expect(first!.fileSize).toBe(100);
  });

  it('空目录返回失败 + 明确错误信息', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-empty-'));
    try {
      const res = mangaParsingService.scanFolder(emptyDir);
      expect(res.success).toBe(false);
      expect(res.error).toContain('未找到支持的图片文件');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('不存在的目录返回失败', () => {
    const res = mangaParsingService.scanFolder(path.join(tmpDir, 'not-exist'));
    expect(res.success).toBe(false);
    expect(res.error).toContain('不存在');
  });
});

describe('MangaParsingService.buildContextTable（富信息跨页上下文）', () => {
  it('输出 8 列富信息格式，页码列含分镜数', () => {
    const res = mangaParsingService.buildContextTable([makeSummary(1), makeSummary(2)]);
    expect(res.success).toBe(true);
    expect(res.table).toContain('| 页码 | 角色(表情) | 角色动作 | 场景 | 逐分镜剧情 | 关键文本 | 情感 | 叙事衔接 |');
    expect(res.table).toContain('P1(2格)');
    expect(res.table).toContain('P2(2格)');
  });

  it('每页信息量不少于 100 字（逐分镜剧情 + 文本摘录保留全部分镜）', () => {
    const res = mangaParsingService.buildContextTable([
      makeSummary(1),
      makeSummary(2),
      makeSummary(3),
    ]);
    expect(res.success).toBe(true);
    const lines = res.table.split('\n').filter((l) => l.startsWith('| P'));
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // 去除 Markdown 表格符号后统计信息量
      const infoLen = line.replace(/\|/g, '').replace(/-/g, '').trim().length;
      expect(infoLen).toBeGreaterThanOrEqual(100);
    }
  });

  it('保留全部逐分镜剧情而非仅第一格', () => {
    const res = mangaParsingService.buildContextTable([makeSummary(1)]);
    expect(res.table).toContain('分镜1:');
    expect(res.table).toContain('分镜2:');
  });

  it('超长内容单元格软截断（不破坏表格结构）', () => {
    const long = makeSummary(1);
    long.panelPlots = `分镜1: ${'画面细节描述'.repeat(80)}`; // >300 字
    const res = mangaParsingService.buildContextTable([long]);
    expect(res.success).toBe(true);
    const line = res.table.split('\n').find((l) => l.startsWith('| P1'));
    expect(line).toContain('…');
    // 每行仍为 8 列（7 个内部分隔符）
    expect(line!.split('|').length).toBe(10);
  });

  it('空摘要返回空表格', () => {
    const res = mangaParsingService.buildContextTable([]);
    expect(res.success).toBe(true);
    expect(res.table).toBe('');
  });
});
