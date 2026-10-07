/**
 * 漫画解析：故事大纲生成 + 导入写作编辑器 + 导出 Markdown
 *
 * Spec: integrate-comic-parsing-mode / Requirement「内容输出与创作支持」
 *
 * - 「生成故事大纲」基于全部页面分析结果
 * - 「导入到写作编辑器」解析大纲并填入当前项目，跳转大纲设计阶段
 * - 「导出 Markdown」保存含大纲/角色表/逐页分析的 .md 文件
 */
import React, { useState } from 'react';
import {
  Button,
  Empty,
  Spin,
  message,
  Divider,
  theme,
  Alert,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Tag,
} from 'antd';
import {
  FileTextOutlined,
  EditOutlined,
  ExportOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { getWritingV2API } from '../../../../services/writingV2Service';
import CustomPromptPopover, { readCustomPrompt } from '../shared/CustomPromptPopover';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useMangaComicStore } from './useMangaComicStore';
import { useV2UIStore } from '../stores/useV2UIStore';
import { useSettingStore } from '../../../../stores/settingStore';
import {
  V2_NOVEL_TYPE_OPTIONS,
  V2_PERSPECTIVE_OPTIONS,
  V2_WRITING_STYLE_OPTIONS,
  buildModelConfigFromEngine,
  buildV2WritingConfig,
} from '../shared/v2Labels';
import { NovelType, NarrativePerspective, WritingStyle } from '../../../../../shared/types/writing.types';
import type {
  MangaPageAnalysis,
  MangaPageSummary,
  MangaMetaInfo,
  MangaAnalysisResult,
  V2MangaAudit,
} from '../../../../../shared/types/writing-v2.types';

/** 已分析页面（含页码，按页码升序） */
export interface AnalyzedPage {
  pageIndex: number;
  analysis: MangaPageAnalysis;
}

interface Props {
  folderPath: string;
  totalPages: number;
  analyzedPages: AnalyzedPage[];
  summaries: MangaPageSummary[];
  outline: string; // 已生成的大纲（由 Stage 持有，跨 Tab 保留）
  /** 用户提供的漫画背景信息（可选，注入大纲提示词 + 写入导出 Markdown） */
  mangaMeta?: MangaMetaInfo | null;
  onOutlineGenerated: (outline: string) => void;
}

const V2MangaOutlinePanel: React.FC<Props> = ({
  folderPath,
  totalPages,
  analyzedPages,
  summaries,
  outline,
  mangaMeta,
  onOutlineGenerated,
}) => {
  const { token } = theme.useToken();
  // 大纲生成流程阶段：idle / generating（生成中）/ auditing（生成后自动 AI 审核中，检测 AI 味）
  const [phase, setPhase] = useState<'idle' | 'generating' | 'auditing'>('idle');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 大纲 AI 审核结果（与世界书 AI 审核同款契约：通过/不通过 + 修订/优化文本）
  const [auditResult, setAuditResult] = useState<V2MangaAudit | null>(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);

  // 无项目时的 AI 项目草稿流程（生成 → 确认调整 → 创建项目 → 导入大纲）
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftForm] = Form.useForm();

  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const createProject = useV2ProjectStore((s) => s.createProject);
  const projects = useV2ProjectStore((s) => s.projects);
  const currentProjectId = useV2ProjectStore((s) => s.currentProjectId);
  const setStage = useV2UIStore((s) => s.setStage);
  const setting = useSettingStore((s) => s.setting);

  const currentProject = projects.find((p) => p.id === currentProjectId) || null;

  // 自定义提示词存储 key（按功能入口隔离，localStorage 持久化）
  const GEN_CUSTOM_PROMPT_KEY = 'v2manga_outline_gen_custom_prompt';
  const AUDIT_CUSTOM_PROMPT_KEY = 'v2manga_outline_audit_custom_prompt';
  const DRAFT_CUSTOM_PROMPT_KEY = 'v2manga_draft_custom_prompt';

  // 中止进行中的大纲生成/审核（按钮 danger 停止态触发）
  const handleStop = async (key: 'generateOutline' | 'auditOutline') => {
    const api = getWritingV2API();
    if (!api) return;
    await api.manga.cancel(key);
  };

  // 大纲 AI 审核（生成后自动调用 / 「AI 大纲审核」按钮 / 结果弹窗重新审核）
  // 审核管线：HUMANIZER_POLISH_RULES 审核规则 + 漫画解析全文（完整性/一致性源素材参照）+ 用户自定义审核要求
  const runAudit = async (text: string) => {
    const api = getWritingV2API();
    if (!api) return;
    setPhase('auditing');
    try {
      const res = await api.manga.auditOutline(
        text,
        mangaMeta ?? undefined,
        summaries,
        readCustomPrompt(AUDIT_CUSTOM_PROMPT_KEY) || undefined
      );
      if (res.cancelled) {
        message.info('已停止大纲审核');
      } else if (res.success && res.audit) {
        setAuditResult(res.audit);
        setAuditModalOpen(true);
      } else {
        message.warning(`AI 审核失败：${res.error || '未知错误'}`);
      }
    } finally {
      setPhase('idle');
    }
  };

  const handleGenerate = async () => {
    const api = getWritingV2API();
    if (!api) return;
    if (summaries.length === 0) {
      message.warning('请先完成至少 1 页漫画分析');
      return;
    }
    setPhase('generating');
    try {
      const res = await api.manga.generateOutline(
        summaries,
        mangaMeta ?? undefined,
        readCustomPrompt(GEN_CUSTOM_PROMPT_KEY) || undefined
      );
      if (res.cancelled) {
        message.info('已停止大纲生成');
        return;
      }
      if (!res.success || !res.outline) {
        message.error(res.error || '大纲生成失败');
        return;
      }
      onOutlineGenerated(res.outline);
      message.success('故事大纲生成完成，开始 AI 审核');
      // 生成的大纲默认带 AI 味，须经 AI 审核（与世界书 AI 审核同款机制）
      await runAudit(res.outline);
    } finally {
      // runAudit 的 finally 已复位阶段时不覆盖（防止审核刚结束被误置回）
      setPhase((p) => (p === 'auditing' ? p : 'idle'));
    }
  };

  // 采用审核文本（通过→优化文本，不通过→修订文本），更新大纲（随记录自动保存）
  const handleApplyAudit = () => {
    if (!auditResult) return;
    const adopted = auditResult.passed
      ? auditResult.optimizedText || auditResult.revisedText || outline
      : auditResult.revisedText || outline;
    if (adopted && adopted !== outline) {
      onOutlineGenerated(adopted);
      message.success('已采用审核文本，大纲已更新');
    }
    setAuditModalOpen(false);
  };

  // 重新审核（对当前大纲重跑）
  const handleReAudit = () => {
    if (!outline) return;
    setAuditModalOpen(false);
    void runAudit(outline);
  };

  const handleCopy = async () => {
    if (!outline) return;
    try {
      await navigator.clipboard.writeText(outline);
      message.success('大纲已复制到剪贴板');
    } catch {
      message.error('复制失败');
    }
  };

  // 将大纲导入指定项目（解析结构化 + 写入大纲 + 漫画信息 + 漫画全文素材 + 跳转大纲阶段）
  const doImportToProject = async (projectId: string, extraTitle?: string) => {
    const api = getWritingV2API();
    if (!api) return;
    setImporting(true);
    try {
      const res = await api.parseOutline(outline);
      if (res.success && res.outline) {
        // 漫画解析全文素材（与角色卡/世界书同级）：从漫画记录取逐页完整分析，
        // 随项目持久化，章节写作时主进程注入上下文（AI 可参考具体台词/动作/场景）
        const record = useMangaComicStore
          .getState()
          .comics.find((c) => c.folderPath === folderPath);
        patchProject(projectId, {
          outline: res.outline,
          outlineRaw: outline,
          mangaMeta: mangaMeta ?? record?.mangaMeta ?? undefined,
          mangaReference:
            record?.analyses?.length
              ? {
                  folderName: record.folderName,
                  mangaMeta: mangaMeta ?? record.mangaMeta,
                  analyses: record.analyses,
                }
              : undefined,
          ...(extraTitle ? { title: extraTitle } : {}),
        });
        setStage('outline');
        message.success('漫画大纲与全文素材已导入大纲工作台');
      } else {
        message.error(res.error || '大纲解析失败');
      }
    } finally {
      setImporting(false);
    }
  };

  // 「导入到写作编辑器」：已有项目 → 直接导入；无项目 → AI 生成项目草稿走确认流程
  const handleImportToEditor = () => {
    if (!outline) {
      message.warning('请先生成故事大纲');
      return;
    }
    if (currentProject) {
      void doImportToProject(currentProject.id);
      return;
    }
    void openDraftModal();
  };

  // 中止项目草稿生成（弹窗内停止按钮）
  const handleStopDraft = async () => {
    const api = getWritingV2API();
    if (!api) return;
    await api.manga.cancel('generateProjectDraft');
  };

  // 打开项目草稿弹窗：AI 基于全部解析内容 + 大纲自动生成项目字段（支持自定义提示词 + 中止）
  const openDraftModal = async () => {
    const api = getWritingV2API();
    if (!api) return;
    setDraftOpen(true);
    setDraftLoading(true);
    try {
      const res = await api.manga.generateProjectDraft(
        summaries,
        outline,
        mangaMeta ?? undefined,
        readCustomPrompt(DRAFT_CUSTOM_PROMPT_KEY) || undefined
      );
      if (res.success && res.draft) {
        // 显式回填（antd Form 的 initialValues 仅首次挂载生效，AI 结果到达时表单已挂载）
        draftForm.setFieldsValue(res.draft);
      } else if (res.cancelled) {
        message.info('已停止项目信息生成，可手动填写后创建');
      } else {
        message.warning(`AI 生成项目信息失败：${res.error || '未知错误'}，可手动填写后创建`);
      }
    } finally {
      setDraftLoading(false);
    }
  };

  // 确认草稿 → 创建项目 → 导入大纲
  const handleDraftConfirm = async () => {
    let values: {
      title: string;
      creativeDescription: string;
      novelType: NovelType;
      narrativePerspective: NarrativePerspective;
      writingStyle?: WritingStyle;
      targetWordCount: number;
      chapterCount: number;
      additionalRequirements?: string;
    };
    try {
      values = await draftForm.validateFields();
    } catch {
      return; // 表单校验失败，停留在弹窗
    }
    const activeEngine =
      setting?.aiEngines?.find((e) => e.id === setting?.activeEngineId) || setting?.aiEngines?.[0] || null;
    if (!activeEngine) {
      message.error('未找到可用的 AI 引擎，请先在设置中配置 AI 服务');
      return;
    }
    setCreating(true);
    try {
      const modelConfig = buildModelConfigFromEngine(activeEngine);
      const config = buildV2WritingConfig({
        creativeDescription: values.creativeDescription,
        novelType: values.novelType,
        targetWordCount: values.targetWordCount,
        chapterCount: values.chapterCount,
        narrativePerspective: values.narrativePerspective,
        writingStyle: values.writingStyle,
        additionalRequirements: values.additionalRequirements,
        modelConfig,
      });
      const projectId = await createProject(config);
      if (!projectId) {
        // 展示真实错误详情（await 后需经 getState 读最新值，闭包内是旧值）
        const detail = useV2ProjectStore.getState().lastCreateError;
        message.error(`项目创建失败：${detail || '未知错误，请重试'}`, 8);
        return;
      }
      setDraftOpen(false);
      await doImportToProject(projectId, values.title);
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async () => {
    const api = getWritingV2API();
    if (!api) return;
    if (analyzedPages.length === 0) {
      message.warning('没有已分析的页面，无法导出');
      return;
    }
    setExporting(true);
    try {
      const dir = await window.electronAPI.file.selectDirectory();
      if (!dir) return; // 用户取消
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const savePath = `${dir}\\manga_analysis_${ts}.md`;

      // 聚合角色汇总（渲染层聚合，跨页按角色名去重）
      const charMap = new Map<
        string,
        { name: string; appearances: { pageIndex: number; expression: string; action: string }[] }
      >();
      for (const { pageIndex, analysis } of analyzedPages) {
        for (const char of analysis.pageAnalysis.characters) {
          if (!charMap.has(char.name)) {
            charMap.set(char.name, { name: char.name, appearances: [] });
          }
          charMap.get(char.name)!.appearances.push({
            pageIndex,
            expression: char.expression,
            action: char.action,
          });
        }
      }
      const characters = Array.from(charMap.values());

      const result: MangaAnalysisResult = {
        pages: analyzedPages.map((p) => p.analysis),
        characters,
        storyOutline: outline,
        chapterSuggestions: [],
        folderPath,
        totalPages,
        analyzedAt: Date.now(),
        mangaMeta: mangaMeta ?? undefined,
      };

      const res = await api.manga.exportAnalysis({ result, savePath });
      if (res.success && res.filePath) {
        message.success(`已导出到：${res.filePath}`);
      } else {
        message.error(res.error || '导出失败');
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <Button
          type="primary"
          danger={phase === 'generating'}
          icon={<FileTextOutlined />}
          loading={phase === 'generating'}
          onClick={phase === 'generating' ? () => void handleStop('generateOutline') : handleGenerate}
          disabled={phase === 'generating' ? false : summaries.length === 0 || phase !== 'idle'}
        >
          {phase === 'generating' ? '停止生成' : '生成故事大纲'}
        </Button>
        <CustomPromptPopover
          storageKey={GEN_CUSTOM_PROMPT_KEY}
          title="自定义提示词 - 故事大纲生成"
          disabled={phase !== 'idle'}
        />
        <Button
          danger={phase === 'auditing'}
          icon={<AuditOutlined />}
          loading={phase === 'auditing'}
          onClick={phase === 'auditing' ? () => void handleStop('auditOutline') : () => void runAudit(outline)}
          disabled={phase === 'auditing' ? false : !outline || phase !== 'idle'}
        >
          {phase === 'auditing' ? '停止审核' : 'AI 大纲审核'}
        </Button>
        <CustomPromptPopover
          storageKey={AUDIT_CUSTOM_PROMPT_KEY}
          title="自定义提示词 - AI 大纲审核"
          disabled={phase !== 'idle'}
        />
        <Button
          icon={<EditOutlined />}
          loading={importing}
          onClick={handleImportToEditor}
          disabled={!outline}
        >
          导入到写作编辑器
        </Button>
        <CustomPromptPopover
          storageKey={DRAFT_CUSTOM_PROMPT_KEY}
          title="自定义提示词 - AI 项目信息生成"
          disabled={!outline || phase !== 'idle'}
        />
        <Button
          icon={<ExportOutlined />}
          loading={exporting}
          onClick={handleExport}
          disabled={analyzedPages.length === 0}
        >
          导出 Markdown
        </Button>
        {outline && (
          <Button icon={<CopyOutlined />} onClick={handleCopy}>
            复制大纲
          </Button>
        )}
      </div>

      {!currentProject && (
        <Alert
          type="info"
          showIcon
          message="未选择项目：点击「导入到写作编辑器」将由 AI 基于解析内容自动生成项目信息，确认后创建项目并导入大纲"
          style={{ flexShrink: 0 }}
        />
      )}

      {/* 大纲展示 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {phase !== 'idle' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              gap: 12,
            }}
          >
            <Spin size="large" />
            <div style={{ color: token.colorTextTertiary, fontSize: 12 }}>
              {phase === 'auditing' ? 'AI 正在审核大纲（检测 AI 味）…' : '正在生成大纲…'}
            </div>
          </div>
        ) : outline ? (
          <pre
            style={{
              margin: 0,
              padding: 16,
              background: token.colorFillQuaternary,
              borderRadius: token.borderRadius,
              fontSize: 13,
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {outline}
          </pre>
        ) : (
          <Empty
            description="完成多页分析后，点击「生成故事大纲」"
            style={{ marginTop: 48 }}
          />
        )}
      </div>

      <Divider style={{ margin: '0 0 8px' }} />
      <div style={{ fontSize: 12, color: token.colorTextTertiary, flexShrink: 0 }}>
        已分析 {analyzedPages.length} / {totalPages} 页
      </div>

      {/* 大纲 AI 审核结果（与世界书 AI 审核同款交互：通过/不通过 + 说明 + 采用审核文本/重新审核） */}
      <Modal
        title="大纲 AI 审核结果"
        open={auditModalOpen}
        onCancel={() => setAuditModalOpen(false)}
        maskClosable={false}
        width={900}
        footer={[
          <Button key="close" onClick={() => setAuditModalOpen(false)}>
            保持原文
          </Button>,
          <Button key="reaudit" onClick={handleReAudit}>
            重新审核
          </Button>,
          <Button key="apply" type="primary" onClick={handleApplyAudit}>
            采用修订文本
          </Button>,
        ]}
      >
        {auditResult && (
          <div>
            {/* 审核状态 */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ marginRight: 8 }}>审核状态：</span>
              {auditResult.passed ? (
                <Tag icon={<CheckCircleOutlined />} color="success">
                  通过
                </Tag>
              ) : (
                <Tag icon={<CloseCircleOutlined />} color="error">
                  不通过
                </Tag>
              )}
            </div>

            {/* 问题列表（逐条展示，对齐章节「检查 AI 味」的 issues 交互；无问题不渲染） */}
            {auditResult.issues.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  发现的问题（{auditResult.issues.length}）：
                </label>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                  {auditResult.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* 审核说明 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>审核说明：</label>
              <Input.TextArea value={auditResult.suggestions} rows={3} readOnly />
            </div>

            {/* 通过时：优化建议 + 优化后文本；不通过时：修改后文本 */}
            {auditResult.passed ? (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>优化建议：</label>
                  <Input.TextArea value={auditResult.optimizationSuggestions || ''} rows={3} readOnly />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>优化后的文本：</label>
                  <Input.TextArea
                    value={auditResult.optimizedText || auditResult.revisedText}
                    rows={8}
                    readOnly
                  />
                </div>
              </>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  审核并修改后的文本：
                </label>
                <Input.TextArea value={auditResult.revisedText} rows={8} readOnly />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 无项目时：AI 生成项目字段草稿，用户确认调整后创建项目并导入大纲 */}
      <Modal
        title="基于漫画解析结果创建写作项目"
        open={draftOpen}
        confirmLoading={draftLoading || creating}
        okText="确认创建"
        cancelText="取消"
        onOk={() => void handleDraftConfirm()}
        onCancel={() => !creating && setDraftOpen(false)}
        width={640}
        destroyOnHidden
        maskClosable={false}
      >
        <Alert
          type="info"
          showIcon
          message="AI 已根据全部漫画解析结果与故事大纲自动补全项目信息，请确认或调整后创建。"
          style={{ marginBottom: 16 }}
        />
        <Spin spinning={draftLoading} tip="AI 正在生成项目信息…">
          {draftLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <Button danger size="small" onClick={() => void handleStopDraft()}>
                停止生成
              </Button>
            </div>
          )}
          <Form
            form={draftForm}
            layout="vertical"
            initialValues={{
              novelType: NovelType.WEB_NOVEL,
              narrativePerspective: NarrativePerspective.THIRD_PERSON,
              writingStyle: WritingStyle.DETAILED,
              targetWordCount: 50000,
              chapterCount: 20,
            }}
          >
            <Form.Item
              name="title"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }]}
            >
              <Input placeholder="例如：一拳超人" maxLength={20} showCount />
            </Form.Item>
            <Form.Item
              name="creativeDescription"
              label="创意描述"
              rules={[{ required: true, min: 10, message: '请至少输入 10 个字的创意描述' }]}
            >
              <Input.TextArea
                rows={4}
                placeholder="基于漫画内容的题材、核心设定、主角与故事主线（AI 已自动生成，可调整）"
                maxLength={100000}
                showCount
              />
            </Form.Item>
            <div style={{ display: 'flex', gap: 12 }}>
              <Form.Item name="novelType" label="小说类型" style={{ flex: 1 }}>
                <Select options={V2_NOVEL_TYPE_OPTIONS} />
              </Form.Item>
              <Form.Item name="narrativePerspective" label="叙事视角" style={{ flex: 1 }}>
                <Select options={V2_PERSPECTIVE_OPTIONS} />
              </Form.Item>
              <Form.Item name="writingStyle" label="写作风格" style={{ flex: 1 }}>
                <Select options={V2_WRITING_STYLE_OPTIONS} />
              </Form.Item>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Form.Item
                name="targetWordCount"
                label="目标总字数"
                rules={[{ required: true, message: '请填写目标字数' }]}
                style={{ flex: 1 }}
              >
                <InputNumber min={1000} max={1000000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="chapterCount"
                label="章节数量"
                rules={[{ required: true, message: '请填写章节数量' }]}
                style={{ flex: 1 }}
              >
                <InputNumber min={1} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Form.Item name="additionalRequirements" label="附加要求（可选）">
              <Input.TextArea
                rows={2}
                placeholder="对写作的额外要求，如角色命名须与漫画一致、保留原叙事结构等"
              />
            </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
};

export default V2MangaOutlinePanel;
