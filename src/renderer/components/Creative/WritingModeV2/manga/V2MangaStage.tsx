/**
 * 漫画解析：主容器
 *
 * Spec: integrate-comic-parsing-mode
 *
 * 布局：
 *  - 顶部工具栏：导入漫画 / 漫画信息 / 阅读顺序 / 分析全部页面（+批量进度）
 *  - 左侧：图片浏览（V2MangaViewer）
 *  - 右侧：子 Tab（当前页分析 / 上下文预览 / 大纲与导出）
 *
 * 状态管理：
 *  - folderPath / pages / currentIndex / readingOrder
 *  - mangaMeta（用户提供的漫画背景信息，注入 AI 提示词辅助理解）
 *  - analysisMap: Map<pageIndex, MangaPageAnalysis>（内存态，含用户修正）
 *  - analyzingPage（单页）/ 批量串行分析（useRef 防重入 ⚠️ 项目规则）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Empty,
  Modal,
  Progress,
  Tabs,
  Tag,
  message,
  theme,
  Tooltip,
} from 'antd';
import {
  FolderOpenOutlined,
  ThunderboltOutlined,
  StopOutlined,
  PlusOutlined,
  ProfileOutlined,
  UnorderedListOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useSettingStore } from '../../../../stores/settingStore';
import type {
  MangaPage,
  MangaPageAnalysis,
  MangaPageSummary,
  MangaReadingOrder,
  MangaMetaInfo,
  MangaComicRecord,
} from '../../../../../shared/types/writing-v2.types';
import V2MangaViewer from './V2MangaViewer';
import V2MangaReadingOrderToggle from './V2MangaReadingOrderToggle';
import V2MangaAnalysisPanel from './V2MangaAnalysisPanel';
import V2MangaContextPreview from './V2MangaContextPreview';
import V2MangaOutlinePanel, { type AnalyzedPage } from './V2MangaOutlinePanel';
import V2MangaMetaModal from './V2MangaMetaModal';
import { analysisToSummary } from './mangaSummaryUtils';
import { useMangaComicStore } from './useMangaComicStore';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import CustomPromptPopover, { readCustomPrompt } from '../shared/CustomPromptPopover';

/** 页面分析自定义提示词 localStorage key（单页与批量共用同一入口，按功能隔离） */
const ANALYZE_CUSTOM_PROMPT_KEY = 'v2manga_page_analyze_custom_prompt';

const V2MangaStage: React.FC = () => {
  const { token } = theme.useToken();

  // ===== 导入与浏览状态 =====
  const [folderPath, setFolderPath] = useState('');
  const [pages, setPages] = useState<MangaPage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(1);
  const [readingOrder, setReadingOrder] = useState<MangaReadingOrder>('leftToRight');
  const [importing, setImporting] = useState(false);

  // ===== 漫画背景信息（辅助 AI 理解，可选；持久化到当前 V2 项目） =====
  const [mangaMeta, setMangaMeta] = useState<MangaMetaInfo | null>(null);
  const [metaModal, setMetaModal] = useState<{ open: boolean; mode: 'create' | 'edit' }>({
    open: false,
    mode: 'create',
  });

  // 项目持久化（单一真相源 = 项目实体）：漫画信息随当前项目保存/恢复
  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const projects = useV2ProjectStore((s) => s.projects);
  const currentProjectId = useV2ProjectStore((s) => s.currentProjectId);
  const currentProject = projects.find((p) => p.id === currentProjectId) || null;

  // 项目级 mangaMeta 仅在「无漫画打开」时作为初始值同步。
  // ⚠️ 有漫画打开时必须跳过：当前漫画的信息以记录快照/表单提交为准，
  // 否则切换项目会用项目的 mangaMeta（通常为 null）覆盖当前漫画信息，
  // 且 upsert effect 会随即把 null 写回记录，造成「漫画信息」回显空白 + 记录数据丢失
  useEffect(() => {
    if (folderPath) return;
    if (!currentProjectId) {
      setMangaMeta(null);
      return;
    }
    const proj = useV2ProjectStore.getState().projects.find((p) => p.id === currentProjectId);
    setMangaMeta(proj?.mangaMeta ?? null);
  }, [currentProjectId, folderPath]);

  // ===== 分析状态 =====
  const [analysisMap, setAnalysisMap] = useState<Map<number, MangaPageAnalysis>>(new Map());
  const [analyzingPage, setAnalyzingPage] = useState<number | null>(null);
  const [outline, setOutline] = useState('');

  // ===== 批量分析状态（⚠️ 防重入必须用 useRef，不能用 state）=====
  const batchRunningRef = useRef(false);
  const batchCancelRef = useRef(false);
  const [batchState, setBatchState] = useState<{ running: boolean; current: number; total: number }>({
    running: false,
    current: 0,
    total: 0,
  });

  // ===== 已解析漫画记录（应用级全局持久化，页签空态以列表展示、可恢复继续解析）=====
  // ⚠️ 全局 store（localStorage）而非项目级：漫画解析页签无需项目即可使用，
  // 项目级存储会在未选项目时静默丢失数据
  const mangaComics = useMangaComicStore((s) => s.comics);
  const upsertComic = useMangaComicStore((s) => s.upsertComic);
  const removeComic = useMangaComicStore((s) => s.removeComic);

  // 当前打开漫画的记录快照（持久化层）与信息兜底值：
  // 状态 mangaMeta 为空时回退到记录快照（⚠️ 历史 bug 期曾出现状态为空但记录仍有数据的情况，
  // 以及记录被空值覆盖的情况，此处双层兜底 + 自愈保证「漫画信息」回显正确）
  const currentRecord = mangaComics.find((c) => c.folderPath === folderPath) ?? null;
  const effectiveMangaMeta = mangaMeta ?? currentRecord?.mangaMeta ?? null;

  // 当前漫画变化（导入/分析/修正/阅读顺序/漫画信息）时，upsert 到全局 store
  useEffect(() => {
    if (!folderPath || pages.length === 0) return;
    const analyses = pages
      .map((p) => ({ pageIndex: p.index, analysis: analysisMap.get(p.index) }))
      .filter((a): a is { pageIndex: number; analysis: MangaPageAnalysis } => Boolean(a.analysis));
    const now = Date.now();
    const existing = useMangaComicStore.getState().comics.find((r) => r.folderPath === folderPath);
    upsertComic({
      id: existing?.id ?? `manga_${now}_${Math.random().toString(36).slice(2, 8)}`,
      folderPath,
      folderName: folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath,
      pages,
      readingOrder,
      analyses,
      // ⚠️ 状态为空时保留记录已有快照，防止空值覆盖持久化数据
      mangaMeta: mangaMeta ?? existing?.mangaMeta ?? undefined,
      // 大纲同样随记录持久化（此前只存内存，重开漫画/重启应用后丢失）
      outline: outline || existing?.outline || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }, [folderPath, pages, analysisMap, readingOrder, mangaMeta, outline, upsertComic]);

  // 打开列表中的漫画：重扫来源文件夹刷新页面列表，恢复逐页分析
  const handleOpenRecord = useCallback(async (record: MangaComicRecord) => {
    const api = getWritingV2API();
    if (!api) return;
    let nextPages = record.pages;
    const res = await api.manga.scanFolder(record.folderPath);
    if (res.success && res.pages.length > 0) {
      nextPages = res.pages;
    } else {
      message.warning('来源文件夹不存在或无图片，已按保存的页面列表恢复（部分图片可能无法加载）');
    }
    const restored = new Map<number, MangaPageAnalysis>();
    for (const entry of record.analyses) {
      if (nextPages.some((p) => p.index === entry.pageIndex)) {
        restored.set(entry.pageIndex, entry.analysis);
      }
    }
    setFolderPath(record.folderPath);
    setPages(nextPages);
    setCurrentIndex(1);
    setReadingOrder(record.readingOrder);
    setAnalysisMap(restored);
    // 还原记录内的大纲快照（随记录持久化，重开漫画不丢）
    setOutline(record.outline ?? '');
    // 还原记录内的漫画背景信息快照（记录自包含，与项目解耦）
    setMangaMeta(record.mangaMeta ?? null);
    message.info(`已恢复「${record.folderName}」：${restored.size}/${nextPages.length} 页已解析`);
  }, []);

  // 删除漫画记录（全局 store）
  const handleDeleteRecord = useCallback(
    (record: MangaComicRecord) => {
      Modal.confirm({
        title: `删除「${record.folderName}」？`,
        content: '将删除该漫画的页面列表与逐页分析结果（来源文件夹与图片不受影响）。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          removeComic(record.id);
          // 若当前打开的正是被删除的漫画，返回空态列表
          if (folderPath === record.folderPath) {
            setFolderPath('');
            setPages([]);
            setAnalysisMap(new Map());
            setOutline('');
            setCurrentIndex(1);
          }
          message.success('已删除漫画记录');
        },
      });
    },
    [removeComic, folderPath]
  );

  // 返回漫画列表（关闭当前漫画）
  const handleBackToList = useCallback(() => {
    if (batchRunningRef.current || analyzingPage !== null) return;
    setFolderPath('');
    setPages([]);
    setAnalysisMap(new Map());
    setOutline('');
    setCurrentIndex(1);
  }, [analyzingPage]);

  // ===== supportsVision 检测（复用能力检测 spec）=====
  const setting = useSettingStore((s) => s.setting);
  const activeEngine = setting?.aiEngines?.find((e) => e.id === setting?.activeEngineId);
  const supportsVision = activeEngine?.capabilities?.supportsVision === true;
  // setting === null 表示设置 store 尚未加载完成（App 启动已触发全局 fetchSetting）。
  // 此时视觉能力「未确定」，不视为「不支持」，避免误报「AI 模型不支持图片识别」。
  // 仅当设置已加载且激活引擎明确无 supportsVision 时才提示。
  const visionUnsupported = setting !== null && !supportsVision;

  // ===== 导入漫画文件夹 =====
  const handleImport = useCallback(async () => {
    const api = getWritingV2API();
    if (!api) return;
    setImporting(true);
    try {
      const dir = await window.electronAPI.file.selectDirectory();
      if (!dir) return; // 用户取消
      const res = await api.manga.scanFolder(dir);
      if (res.success && res.pages.length > 0) {
        // 切换到不同文件夹时，漫画信息与大纲以目标文件夹已有记录为准，
        // 避免上一本漫画的信息串到新漫画（「新建漫画解析」刚提交的信息在无记录时保留）
        if (dir !== folderPath) {
          const targetRecord = useMangaComicStore
            .getState()
            .comics.find((c) => c.folderPath === dir);
          if (targetRecord?.mangaMeta) {
            setMangaMeta(targetRecord.mangaMeta);
          }
          // 还原目标记录的大纲快照（重新导入同一漫画不丢已生成大纲）
          setOutline(targetRecord?.outline ?? '');
        }
        setFolderPath(dir);
        setPages(res.pages);
        setCurrentIndex(1);
        setAnalysisMap(new Map());
        message.success(`已导入 ${res.total} 页漫画`);
      } else {
        message.error(res.error || '未找到支持的图片文件');
      }
    } finally {
      setImporting(false);
    }
  }, [folderPath]);

  // ===== 漫画背景信息保存（先持久化到当前项目，再继续后续流程） =====
  const handleMetaOk = useCallback(
    (meta: MangaMetaInfo) => {
      const hasContent = Boolean(
        meta.title || meta.characters || meta.theme || meta.background ||
          meta.sourceLanguage || meta.colorMode || meta.comicType
      );
      const nextMeta: MangaMetaInfo | null = hasContent ? meta : null;
      setMangaMeta(nextMeta);
      // 先持久化：项目实体是单一真相源，保存成功后再进入下一步
      if (currentProject) {
        patchProject(currentProject.id, { mangaMeta: nextMeta ?? undefined });
      }
      const mode = metaModal.mode;
      setMetaModal((s) => ({ ...s, open: false }));
      if (mode === 'create') {
        if (!currentProject) {
          message.info('未选择项目，漫画信息仅在本次会话生效');
        }
        void handleImport();
      } else {
        message.success('漫画信息已保存');
      }
    },
    [metaModal.mode, handleImport, currentProject, patchProject]
  );

  // ===== 收集指定页之前的摘要（用于跨页上下文）=====
  const buildPrevSummaries = useCallback(
    (upToIndex: number, map: Map<number, MangaPageAnalysis>): MangaPageSummary[] => {
      const result: MangaPageSummary[] = [];
      for (const [pageIndex, analysis] of map) {
        if (pageIndex < upToIndex) {
          result.push(analysisToSummary(pageIndex, analysis));
        }
      }
      result.sort((a, b) => a.pageIndex - b.pageIndex);
      return result;
    },
    []
  );

  // ===== 单页分析（可携带用户引导） =====
  const handleAnalyzePage = useCallback(async (userGuidance?: string) => {
    const api = getWritingV2API();
    if (!api) return;
    if (analyzingPage !== null || batchRunningRef.current) return;
    if (visionUnsupported) {
      message.warning('当前 AI 模型不支持图片识别，请切换到多模态模型');
      return;
    }

    const page = pages.find((p) => p.index === currentIndex);
    if (!page) return;

    setAnalyzingPage(currentIndex);
    try {
      const previousSummaries = buildPrevSummaries(currentIndex, analysisMap);
      const res = await api.manga.analyzePage({
        imagePath: page.absolutePath,
        readingOrder,
        previousSummaries,
        pageIndex: currentIndex,
        userGuidance,
        mangaMeta: mangaMeta ?? undefined,
        // 自定义分析要求（可选，最高优先级）
        customPrompt: readCustomPrompt(ANALYZE_CUSTOM_PROMPT_KEY) || undefined,
      });
      if (res.success && res.analysis) {
        const analysis = res.analysis;
        setAnalysisMap((prev) => {
          const next = new Map(prev);
          next.set(currentIndex, analysis);
          return next;
        });
        message.success(`第 ${currentIndex} 页分析完成`);
      } else if (res.cancelled) {
        // 用户主动停止：提示"已停止"而非报错
        message.info(`第 ${currentIndex} 页分析已停止`);
      } else {
        message.error(res.error || '分析失败');
      }
    } finally {
      setAnalyzingPage(null);
    }
  }, [pages, currentIndex, readingOrder, analysisMap, analyzingPage, visionUnsupported, buildPrevSummaries, mangaMeta]);

  // ===== 批量分析（串行逐页）=====
  // initialMap 显式传入工作集：重新分析（清空后重跑）时传空 Map，
  // 避免闭包里的旧 analysisMap 被跳过逻辑误用
  const runBatchAnalyze = useCallback(
    async (initialMap?: Map<number, MangaPageAnalysis>) => {
      const api = getWritingV2API();
      if (!api) return;
      if (pages.length === 0 || analyzingPage !== null || batchRunningRef.current) return;

      batchCancelRef.current = false;
      batchRunningRef.current = true;
      let successCount = 0;
      let failCount = 0;
      const workMap = new Map(initialMap ?? analysisMap);
      setBatchState({ running: true, current: 0, total: pages.length });

    for (let i = 0; i < pages.length; i++) {
      if (batchCancelRef.current) break;
      const page = pages[i];
      setBatchState({ running: true, current: i + 1, total: pages.length });

      // 跳过已分析（含用户修正过）的页
      if (workMap.has(page.index)) {
        successCount++;
        continue;
      }

      const previousSummaries = buildPrevSummaries(page.index, workMap);
      const res = await api.manga.analyzePage({
        imagePath: page.absolutePath,
        readingOrder,
        previousSummaries,
        pageIndex: page.index,
        mangaMeta: mangaMeta ?? undefined,
        // 自定义分析要求（可选，最高优先级）
        customPrompt: readCustomPrompt(ANALYZE_CUSTOM_PROMPT_KEY) || undefined,
      });

      if (res.cancelled) {
        // 用户停止：当前页请求已被 manga:cancel 中止，结束批量（已分析页保留）
        break;
      }
      if (res.success && res.analysis) {
        workMap.set(page.index, res.analysis);
        setAnalysisMap(new Map(workMap));
        successCount++;
      } else {
        failCount++;
        // 逐页失败提示（此前静默跳过，用户只见「分析完成」但页面空白）
        message.warning(`第 ${page.index} 页分析失败：${res.error || '未知错误'}（可点击该页重试）`);
      }
      // 失败不中断批量流程，继续下一页（详细错误日志见主进程控制台）
    }

      batchRunningRef.current = false;
      setBatchState({ running: false, current: 0, total: 0 });
      if (batchCancelRef.current) {
        message.info(`批量分析已停止：已完成 ${successCount} 页 / 共 ${pages.length} 页（已分析页保留）`);
      } else if (failCount > 0) {
        message.warning(`批量分析结束：成功 ${successCount} 页，失败 ${failCount} 页 / 共 ${pages.length} 页`);
      } else {
        message.success(`批量分析结束：成功 ${successCount} / ${pages.length} 页`);
      }
    },
    [pages, readingOrder, analysisMap, analyzingPage, buildPrevSummaries, mangaMeta]
  );

  // 「分析全部页面」按钮：已有分析结果时先确认删除重跑
  // （典型场景：用户修改漫画信息后希望按新信息重新分析；此前会静默跳过已分析页，用户以为在重跑实际没跑）
  const handleBatchAnalyze = useCallback(() => {
    if (pages.length === 0 || analyzingPage !== null || batchRunningRef.current) return;
    if (visionUnsupported) {
      message.warning('当前 AI 模型不支持图片识别，请切换到多模态模型');
      return;
    }
    if (analysisMap.size === 0) {
      void runBatchAnalyze();
      return;
    }
    Modal.confirm({
      title: '重新分析全部页面',
      content: `当前已有 ${analysisMap.size}/${pages.length} 页分析结果。确认后将删除全部分析结果与上下文预览，并按当前漫画信息与图片重新分析。`,
      okText: '删除并重新分析',
      cancelText: '保留当前结果',
      onOk: () => {
        // 清空分析结果（上下文预览表格由分析结果派生，随之清空），以空工作集重跑
        setAnalysisMap(new Map());
        void runBatchAnalyze(new Map());
      },
    });
  }, [pages.length, analyzingPage, visionUnsupported, analysisMap, runBatchAnalyze]);

  const handleBatchCancel = useCallback(() => {
    batchCancelRef.current = true;
    // 同时中止进行中的单页分析请求（manga:cancel），避免用户需等当前页跑完
    void getWritingV2API()?.manga.cancel('analyzePage');
  }, []);

  // ===== 保存手动修正 =====
  const handleSaveAnalysis = useCallback(
    (updated: MangaPageAnalysis) => {
      setAnalysisMap((prev) => {
        const next = new Map(prev);
        next.set(currentIndex, updated);
        return next;
      });
      message.success('修正已保存');
    },
    [currentIndex]
  );

  // ===== 派生数据 =====
  const analyzedSet = new Set(analysisMap.keys());
  const analyzedPages: AnalyzedPage[] = Array.from(analysisMap.entries())
    .map(([pageIndex, analysis]) => ({ pageIndex, analysis }))
    .sort((a, b) => a.pageIndex - b.pageIndex);
  const summaries: MangaPageSummary[] = analyzedPages.map((p) =>
    analysisToSummary(p.pageIndex, p.analysis)
  );

  // ===== 未导入：空态（存在已解析漫画时以列表展示）=====
  if (pages.length === 0) {
    const sortedComics = [...mangaComics].sort((a, b) => b.updatedAt - a.updatedAt);
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: sortedComics.length > 0 ? 'flex-start' : 'center',
          gap: 16,
          overflowY: 'auto',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setMetaModal({ open: true, mode: 'create' })}
          >
            新建漫画解析
          </Button>
          <Button icon={<FolderOpenOutlined />} loading={importing} onClick={handleImport}>
            直接导入文件夹
          </Button>
        </div>

        {sortedComics.length > 0 ? (
          /* 已解析漫画列表 */
          <div style={{ width: '100%', maxWidth: 720 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 8 }}>
              已解析漫画（{sortedComics.length}）
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sortedComics.map((record) => (
                <div
                  key={record.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {record.folderName}
                    </div>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
                      共 {record.pages.length} 页 · 已解析 {record.analyses.length} 页
                      {record.analyses.length > 0 && (
                        <Tag color="green" style={{ marginLeft: 8 }}>含分析结果</Tag>
                      )}
                    </div>
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => void handleOpenRecord(record)}
                  >
                    打开
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteRecord(record)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <Empty
              description={
                <span style={{ color: token.colorTextSecondary }}>
                  选择包含漫画图片的文件夹开始解析
                  <br />
                  <span style={{ fontSize: 12 }}>
                    支持 JPG / PNG / WebP / BMP / TIFF，按文件名数字序号（01 起）排列
                  </span>
                </span>
              }
            />
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
              推荐使用「新建漫画解析」，填写漫画名称/角色/主题可让 AI 识别更准确
            </span>
          </>
        )}

        <V2MangaMetaModal
          open={metaModal.open}
          title="新建漫画解析"
          okText="保存并选择漫画文件夹"
          onOk={handleMetaOk}
          onCancel={() => setMetaModal((s) => ({ ...s, open: false }))}
          supportsVision={!visionUnsupported}
          comicSummaries={summaries}
        />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        <Button
          icon={<UnorderedListOutlined />}
          onClick={handleBackToList}
          disabled={batchState.running || analyzingPage !== null}
          title="返回已解析漫画列表"
        >
          漫画列表
        </Button>
        <Button icon={<FolderOpenOutlined />} loading={importing} onClick={handleImport}>
          重新导入
        </Button>
        <Button
          icon={<ProfileOutlined />}
          onClick={() => {
            // 自愈：状态为空但记录快照有数据时（历史 bug 期可能丢失状态），先恢复状态，
            // 防止后续 upsert 把空值写回记录
            if (!mangaMeta && currentRecord?.mangaMeta) {
              setMangaMeta(currentRecord.mangaMeta);
            }
            console.info(
              '[MangaInfo] 打开编辑弹窗：',
              `状态=${mangaMeta ? '有' : '空'}`,
              `记录快照=${currentRecord?.mangaMeta ? '有' : '空'}`,
              mangaMeta ?? currentRecord?.mangaMeta ?? null
            );
            setMetaModal({ open: true, mode: 'edit' });
          }}
          disabled={batchState.running}
        >
          漫画信息
        </Button>
        {effectiveMangaMeta?.title ? (
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            {effectiveMangaMeta.title}
          </Tag>
        ) : (
          <Tooltip title="该漫画尚未填写信息。点击「漫画信息」填写名称/角色/主题等，可帮助 AI 更准确地识别">
            <Tag style={{ marginInlineEnd: 0 }}>未填写信息</Tag>
          </Tooltip>
        )}
        <Tooltip title="影响缩略图排列与 AI 分析的格子编号顺序">
          <V2MangaReadingOrderToggle value={readingOrder} onChange={setReadingOrder} disabled={batchState.running} />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip title="分析结果、手动修正、漫画信息、阅读顺序等所有变更均已自动保存，关闭后可从「漫画列表」恢复">
          <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginInlineEnd: 0 }}>
            已自动保存
          </Tag>
        </Tooltip>
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          {folderPath}
        </span>
        {batchState.running ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={Math.round((batchState.current / batchState.total) * 100)}
              size="small"
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
              {batchState.current}/{batchState.total}
            </span>
            <Button size="small" danger icon={<StopOutlined />} onClick={handleBatchCancel}>
              取消
            </Button>
          </div>
        ) : (
          <>
            <CustomPromptPopover
              storageKey={ANALYZE_CUSTOM_PROMPT_KEY}
              title="页面分析 - 自定义提示词"
              placeholder="输入分析要求（如：重点识别角色动作与表情、注意画面文字等），将作为最高优先级约束附加到单页与批量分析（可选）"
              disabled={analyzingPage !== null}
            />
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleBatchAnalyze}
              disabled={analyzingPage !== null}
            >
              分析全部页面
            </Button>
          </>
        )}
      </div>

      {/* 主体：左浏览 + 右分析 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        {/* 左侧：图片浏览 */}
        <div style={{ flex: '5 1 0', minWidth: 0 }}>
          <V2MangaViewer
            pages={pages}
            currentIndex={currentIndex}
            readingOrder={readingOrder}
            analyzedPages={analyzedSet}
            onPageChange={setCurrentIndex}
          />
        </div>

        {/* 右侧：分析/上下文/大纲 */}
        <div style={{ flex: '4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            size="small"
            className="v2-manga-stage-tabs"
            style={{ flex: 1, minHeight: 0 }}
            items={[
              {
                key: 'analysis',
                label: `第 ${currentIndex} 页分析`,
                children: (
                  <V2MangaAnalysisPanel
                    pageIndex={currentIndex}
                    analysis={analysisMap.get(currentIndex) || null}
                    analyzing={analyzingPage === currentIndex || batchState.running}
                    supportsVision={!visionUnsupported}
                    onAnalyze={handleAnalyzePage}
                    onSaveAnalysis={handleSaveAnalysis}
                    onStopAnalyzing={() => {
                      // 批量运行中：停止整个批量；否则仅中止当前单页请求
                      if (batchState.running) {
                        handleBatchCancel();
                      } else {
                        void getWritingV2API()?.manga.cancel('analyzePage');
                      }
                    }}
                  />
                ),
              },
              {
                key: 'context',
                label: '上下文预览',
                children: (
                  <div style={{ padding: 12 }}>
                    <V2MangaContextPreview summaries={summaries} />
                  </div>
                ),
              },
              {
                key: 'outline',
                label: '大纲与导出',
                children: (
                  <V2MangaOutlinePanel
                    folderPath={folderPath}
                    totalPages={pages.length}
                    analyzedPages={analyzedPages}
                    summaries={summaries}
                    outline={outline}
                    mangaMeta={mangaMeta}
                    onOutlineGenerated={setOutline}
                  />
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 编辑漫画信息弹窗（initial 用兜底值：状态为空时回退到记录快照） */}
      <V2MangaMetaModal
        open={metaModal.open}
        title="编辑漫画信息"
        initial={effectiveMangaMeta}
        okText="保存"
        onOk={handleMetaOk}
        onCancel={() => setMetaModal((s) => ({ ...s, open: false }))}
        supportsVision={!visionUnsupported}
        comicSummaries={summaries}
      />
    </div>
  );
};

export default V2MangaStage;
