/**
 * 漫画解析：漫画背景信息表单弹窗
 *
 * 填写漫画基本信息（名称/主要角色/主题/故事背景），辅助 AI 更准确地
 * 识别角色、理解剧情与生成大纲。所有字段均为可选。
 *
 * 两个入口复用本弹窗：
 *  - 空态「新建漫画解析」：确认后继续选择漫画文件夹
 *  - 导入后工具栏「漫画信息」：编辑已填信息（initial 回填）
 *
 * 「主要角色」字段附带 AI 生成能力（Spec: add-ai-character-gen-to-manga-meta）：
 *  - 用户可上传人物参考图片（JPG/PNG/WebP/BMP，≤8MB，data URI 预览兼容 CSP）
 *  - 「AI 生成角色信息」按钮：图片 + 整体分析结果（comicSummaries）+ 当前表单背景
 *    + 自定义提示词（永久约定三件套，Spec: add-ai-custom-prompt-and-interrupt）管线调用
 *  - 生成结果回填至主要角色字段，用户可继续手动编辑调整
 *  - 生成中按钮切换为「停止生成」（manga:cancel('generateCharacterInfo')）
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Select, Radio, Button, Tooltip, Image, theme, message } from 'antd';
import { DeleteOutlined, PictureOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';
import type { MangaMetaInfo, MangaPageSummary } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import CustomPromptPopover, { readCustomPrompt } from '../shared/CustomPromptPopover';

const LANGUAGE_OPTIONS = [
  { value: 'japanese', label: '日文' },
  { value: 'chinese', label: '中文' },
  { value: 'english', label: '英文' },
  { value: 'korean', label: '韩文' },
  { value: 'french', label: '法文' },
  { value: 'spanish', label: '西班牙文' },
  { value: 'german', label: '德文' },
  { value: 'russian', label: '俄文' },
  { value: 'other', label: '其他语言' },
];

const COMIC_TYPE_OPTIONS = [
  { value: 'doujinshi', label: '同人志（Doujinshi）' },
  { value: 'manga', label: '漫画（Manga）' },
  { value: 'artist-cg', label: '画师原创 CG 插画（Artist CG）' },
  { value: 'game-cg', label: '游戏 CG（Game CG）' },
  { value: 'western', label: '欧美向（Western）' },
  { value: 'non-h', label: '非成人向（Non-H）' },
  { value: 'image-set', label: '图片合集（Image Set）' },
  { value: 'cosplay', label: '角色扮演（Cosplay）' },
  { value: 'asian-porn', label: '亚洲成人影像（Asian Porn）' },
  { value: 'misc', label: '杂项（Misc）' },
];

// AI 生成角色信息：自定义提示词持久化 key（永久约定三件套之一）
const CHARACTER_GEN_CUSTOM_PROMPT_KEY = 'v2manga_meta_character_custom_prompt';

// 人物参考图片大小上限（与主进程 MAX_FILE_SIZE 一致）
const MAX_CHAR_IMAGE_SIZE = 8 * 1024 * 1024;

// 支持的图片扩展名（白名单校验，与 selectFile 过滤器一致）
const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp']);

interface Props {
  open: boolean;
  /** 弹窗标题（按场景区分，如「新建漫画解析」/「编辑漫画信息」） */
  title: string;
  /** 初始值（编辑模式回填，新建模式为空） */
  initial?: MangaMetaInfo | null;
  /** 确认按钮文案（如「下一步：选择漫画文件夹」/「保存」） */
  okText: string;
  /** 当前 AI 引擎是否支持视觉识别（缺省视为支持，不阻塞按钮） */
  supportsVision?: boolean;
  /** 当前漫画全部页面分析摘要（AI 生成角色信息时注入整体分析结果，新建模式为空） */
  comicSummaries?: MangaPageSummary[];
  onOk: (meta: MangaMetaInfo) => void;
  onCancel: () => void;
}

const V2MangaMetaModal: React.FC<Props> = ({
  open,
  title,
  initial,
  okText,
  supportsVision,
  comicSummaries,
  onOk,
  onCancel,
}) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<MangaMetaInfo>();

  // ===== AI 生成角色信息状态（Spec: add-ai-character-gen-to-manga-meta） =====
  const [charImagePath, setCharImagePath] = useState<string | null>(null);
  const [charImagePreview, setCharImagePreview] = useState<string | null>(null);
  const [charGenLoading, setCharGenLoading] = useState(false);
  // React state 更新异步批处理，不能防重入；并发控制必须用 ref
  const charGenLoadingRef = useRef(false);

  const visionEnabled = supportsVision !== false;
  const summaries = comicSummaries ?? [];

  // ⚠️ 每次打开时显式回填：form 实例（Form.useForm）在弹窗开关之间保持存活，
  // antd 的 initialValues 仅在 <Form> 首次挂载时写入 store，后续打开依赖内部
  // 回填机制（destroyOnHidden + preserve=false 的 prevWithoutPreserves 路径），
  // 曾出现二次打开回显为空的问题。显式 setFieldsValue 保证与最新 initial 一致。
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      title: initial?.title,
      characters: initial?.characters,
      theme: initial?.theme,
      background: initial?.background,
      sourceLanguage: initial?.sourceLanguage,
      comicType: initial?.comicType,
      colorMode: initial?.colorMode,
    });
  }, [open, initial, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onOk({
      title: values.title?.trim() || undefined,
      characters: values.characters?.trim() || undefined,
      theme: values.theme?.trim() || undefined,
      background: values.background?.trim() || undefined,
      sourceLanguage: values.sourceLanguage,
      colorMode: values.colorMode,
      comicType: values.comicType,
    });
  };

  // ===== AI 生成角色信息（人物图片 + 整体分析 + 自定义提示词） =====

  /** 选择并预览人物参考图片（扩展名 + 大小校验，data URI 预览兼容 CSP） */
  const handleSelectCharImage = async () => {
    try {
      const selected = await window.electronAPI.file.selectFile([
        { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
      ]);
      if (!selected) return; // 用户取消选择，静默返回

      const ext = selected.slice(selected.lastIndexOf('.') + 1).toLowerCase();
      if (!ALLOWED_IMAGE_EXTS.has(ext)) {
        message.error('仅支持 JPG / PNG / WebP / BMP 格式图片');
        return;
      }

      const result = await window.electronAPI.file.readAsBase64(selected);
      if (!result?.success || !result.data) {
        message.error(`图片读取失败：${result?.error || '未知错误'}`);
        return;
      }

      // 大小校验：data URI base64 段长度 × 3/4 ≈ 原始字节数（渲染层无法 stat 文件）
      const commaIdx = result.data.indexOf(',');
      const approxBytes = commaIdx >= 0 ? Math.floor(((result.data.length - commaIdx - 1) * 3) / 4) : 0;
      if (approxBytes > MAX_CHAR_IMAGE_SIZE) {
        message.error(`图片过大（${(approxBytes / 1024 / 1024).toFixed(1)}MB），请压缩到 8MB 以下`);
        return;
      }

      setCharImagePath(selected);
      setCharImagePreview(result.data);
    } catch (error) {
      message.error(`图片选择失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleRemoveCharImage = () => {
    setCharImagePath(null);
    setCharImagePreview(null);
  };

  /** 从当前表单取值构建漫画背景（字段均为可选，不做校验；characters 单独透传避免重复注入） */
  const buildCurrentMeta = (): MangaMetaInfo => {
    const values = form.getFieldsValue();
    return {
      title: values.title?.trim() || undefined,
      theme: values.theme?.trim() || undefined,
      background: values.background?.trim() || undefined,
      sourceLanguage: values.sourceLanguage,
      colorMode: values.colorMode,
      comicType: values.comicType,
    };
  };

  /** 触发 AI 生成角色信息（成功后回填主要角色字段，可继续手动调整） */
  const handleGenCharacterInfo = async () => {
    if (!charImagePath || charGenLoadingRef.current) return;
    charGenLoadingRef.current = true;
    setCharGenLoading(true);
    try {
      const api = getWritingV2API();
      const result = await api?.manga.generateCharacterInfo({
        imagePath: charImagePath,
        summaries,
        mangaMeta: buildCurrentMeta(),
        currentCharacters: form.getFieldValue('characters') || '',
        customPrompt: readCustomPrompt(CHARACTER_GEN_CUSTOM_PROMPT_KEY) || undefined,
      });

      if (!result) {
        message.error('写作 API 不可用，请重启应用');
        return;
      }
      if (result.cancelled) {
        message.info('已停止生成');
        return;
      }
      if (!result.success || !result.charactersText) {
        message.error(result.error || 'AI 生成失败，请重试');
        return;
      }

      form.setFieldValue('characters', result.charactersText);
      message.success('角色信息已生成并填充，可继续手动调整');
    } catch (error) {
      message.error(`AI 生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      charGenLoadingRef.current = false;
      setCharGenLoading(false);
    }
  };

  /** 停止本次生成（永久约定三件套之二） */
  const handleCancelCharGen = () => {
    void getWritingV2API()?.manga.cancel('generateCharacterInfo');
  };

  const charImageName = charImagePath ? charImagePath.split(/[\\/]/).pop() || '' : '';
  const genDisabledReason = !visionEnabled
    ? '当前 AI 引擎不支持视觉识别（无 vision 能力），无法基于图片生成角色信息'
    : !charImagePreview
      ? '请先上传人物参考图片'
      : '';

  return (
    <Modal
      open={open}
      title={title}
      okText={okText}
      cancelText="取消"
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnHidden
      maskClosable={false}
      width={520}
    >
      <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 12 }}>
        填写漫画基本信息可帮助 AI 更准确地识别角色、理解剧情并生成大纲。所有字段均为可选。
      </div>
      <Form form={form} layout="vertical" preserve={false} initialValues={initial ?? {}}>
        <Form.Item label="漫画名称" name="title">
          <Input placeholder="例如：一拳超人" maxLength={100} />
        </Form.Item>
        <Form.Item label="主要角色" name="characters">
          <Input.TextArea
            rows={4}
            placeholder={'例如：埼玉（主角，光头英雄）；杰诺斯（主角弟子，改造人）'}
            maxLength={2000}
            showCount
          />
        </Form.Item>

        {/* AI 生成角色信息（Spec: add-ai-character-gen-to-manga-meta） */}
        <div style={{ marginTop: -12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <Button
              size="small"
              icon={<PictureOutlined />}
              onClick={handleSelectCharImage}
              disabled={charGenLoading}
            >
              {charImagePreview ? '重新选择图片' : '上传人物图片'}
            </Button>
            {charImagePreview && (
              <Button
                size="small"
                icon={<DeleteOutlined />}
                onClick={handleRemoveCharImage}
                disabled={charGenLoading}
              >
                移除
              </Button>
            )}
            <Tooltip title={charGenLoading ? '点击停止本次生成' : genDisabledReason || '基于图片与整体分析结果生成角色信息'}>
              <Button
                size="small"
                type="primary"
                danger={charGenLoading}
                icon={charGenLoading ? <LoadingOutlined /> : <ThunderboltOutlined />}
                onClick={charGenLoading ? handleCancelCharGen : handleGenCharacterInfo}
                disabled={!charGenLoading && (!charImagePreview || !visionEnabled)}
              >
                {charGenLoading ? '停止生成' : 'AI 生成角色信息'}
              </Button>
            </Tooltip>
            <CustomPromptPopover
              storageKey={CHARACTER_GEN_CUSTOM_PROMPT_KEY}
              title="AI 生成角色信息 - 自定义提示词"
              placeholder="例如：重点描述服装细节；角色姓名保留日文原名；突出主视觉角色"
              disabled={charGenLoading}
            />
          </div>
          {charImagePreview ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Image src={charImagePreview} height={64} style={{ borderRadius: 4 }} />
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                {charImageName}
                <br />
                AI 将结合此图片{summaries.length > 0 ? '与整体分析结果' : ''}生成角色信息
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
              可选：上传一张人物参考图片（JPG/PNG/WebP/BMP，≤8MB），AI 将识别视觉特征并结合整体分析结果自动生成角色信息
            </div>
          )}
        </div>

        <Form.Item label="漫画主题" name="theme">
          <Input placeholder="例如：超级英雄 / 热血冒险 / 校园日常" maxLength={200} />
        </Form.Item>
        <Form.Item label="故事背景" name="background">
          <Input.TextArea
            rows={3}
            placeholder="选填：世界观设定、剧情背景或其他需要告知 AI 的信息"
            maxLength={1000}
            showCount
          />
        </Form.Item>
        <Form.Item label="源语言" name="sourceLanguage" tooltip="漫画文本的语言，帮助 AI 更准确地提取文字，不选则自动识别">
          <Select
            placeholder="自动识别（可不选）"
            allowClear
            options={LANGUAGE_OPTIONS}
          />
        </Form.Item>
        <Form.Item label="漫画类型" name="comicType" tooltip="作品类型，AI 会按类型特点（如游戏 UI、cos 实拍、图片合集等）调整解析策略，不选则按通用漫画处理">
          <Select
            placeholder="通用漫画（可不选）"
            allowClear
            options={COMIC_TYPE_OPTIONS}
          />
        </Form.Item>
        <Form.Item label="色彩" name="colorMode" tooltip="漫画的色彩模式，帮助 AI 更准确地分析场景，不选则自动识别">
          <Radio.Group>
            <Radio.Button value="bw">黑白</Radio.Button>
            <Radio.Button value="color">彩色</Radio.Button>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default V2MangaMetaModal;
