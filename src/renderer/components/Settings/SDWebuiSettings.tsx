import { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Form, Input, Select, AutoComplete, Button, Slider, InputNumber, Switch, Tooltip, Alert, Space, Collapse, Radio, message } from 'antd';
import { ApiOutlined, SyncOutlined, QuestionCircleOutlined, SettingOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { SDWebuiConfig } from '../../types/setting';

// Spec: add-ai-expression-generation / Task 6

/**
 * SDWebuiSettings 暴露给父组件的 ref 接口。
 * 与 VectorConfigPanelRef 一致：通过 getFormValues() 取出表单当前值，
 * 由 Settings.tsx 的 handleSave 合并到 updatedSetting.sdWebui 中保存。
 */
export interface SDWebuiSettingsRef {
  getFormValues: () => SDWebuiConfig | undefined;
}

/**
 * SD WebUI 默认配置（与 src/shared/settings.ts defaultSetting.sdWebui 保持一致）。
 * 当 setting.sdWebui 不存在时（旧配置迁移场景）用于初始化表单。
 */
const DEFAULT_SD_WEBUI_CONFIG: SDWebuiConfig = {
  endpoint: 'http://localhost:7860',
  model: '',
  denoisingStrength: 0.55,
  steps: 28,
  cfgScale: 7,
  sampler: 'DPM++ 3M SDE',
  scheduler: 'Karras',
  clipSkip: 2,
  adetailerEnabled: true,
  // 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】
  // 默认模板含 {traits} 与 {emotion} 两个占位符；与 src/shared/settings.ts defaultSetting.sdWebui 保持一致
  positivePromptTemplate: 'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face',
  customNegativePrompt: '',
  // ADetailer 高级参数默认值（与 sdGenerationService ADETAILER_* 常量一致）
  // 【重点标记 - ADetailer 参数优化（2026-07-29）】表情图模糊修复：
  // 降低降噪强度、增大蒙版模糊/膨胀、提高修复分辨率
  adModel: 'face_yolov8n.pt',
  adConfidence: 0.3,
  adDenoisingStrength: 0.3,
  adMaskBlur: 8,
  adDilateErode: 8,
  adInpaintOnlyMasked: true,
  adInpaintOnlyMaskedPadding: 64,
  adUseInpaintWidthHeight: true,
  adInpaintWidth: 1024,
  adInpaintHeight: 1024,
  adUseSteps: true,
  adSteps: 30,
  adUseCfgScale: true,
  adCfgScale: 5.0,
  adUseSampler: true,
  adSampler: 'DPM++ 2M SDE',
  adScheduler: 'Use same scheduler',
  // 【重点标记 - ADetailer 面部修复专用参数（2026-07-29 源码核验）】
  adNegativePrompt: '',
  adUseNoiseMultiplier: true,
  adNoiseMultiplier: 1.0,
  // 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
  // 仅 YOLO-World 系列模型生效，空字符串=使用模型默认 COCO 80 类。
  adModelClasses: '',
  // NL 模型相关（Spec: integrate-nl-driven-sd-models / Task 2）
  modelType: 'sdxl',
  nlPromptTemplate: 'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.',
  txt2imgWidth: 1024,
  txt2imgHeight: 1024,
  selectedLoras: [],
  // 【Hires.fix】默认开启修复与放大，4x-AnimeSharp 放大器
  hrFixEnabled: true,
  hrUpscaler: '4x-AnimeSharp',
  hrSteps: 50,
  hrScale: 2.0,
  hrDenoisingStrength: 0.55,
  hrPrompt: '',
  hrNegativePrompt: '',
  hrCfg: 5.0,
  hrSamplerName: 'DPM++ 2M SDE',
  hrScheduler: 'Karras',
  img2imgExtraNoise: 0.05,
  initialNoiseMultiplier: 1.0,
  // 【重点标记 - img2img 高清模式（2026-07-29）】
  // Forge Neo img2img 不支持 Hires.fix，通过两种替代方案实现高清修复
  img2imgHiresMode: 'two-step',
};

/**
 * SD WebUI 常用采样器预设列表（用户也可手动输入自定义采样器名）。
 * 来源：SD WebUI /sdapi/v1/samplers 常见返回值 + SDXL 推荐采样器。
 * 【重点标记 - 采样器可配置】早期版本无此下拉，导致 Sampling Method 固定无法更改。
 */
const SAMPLER_OPTIONS = [
  { label: 'DPM++ 3M SDE（SDXL 精细，默认）', value: 'DPM++ 3M SDE' },
  { label: 'DPM++ 2M SDE（SDXL 高质量）', value: 'DPM++ 2M SDE' },
  { label: 'DPM++ 2M（SDXL 通用）', value: 'DPM++ 2M' },
  { label: 'DPM++ SDE', value: 'DPM++ SDE' },
  { label: 'Euler a', value: 'Euler a' },
  { label: 'Euler', value: 'Euler' },
  { label: 'DDIM', value: 'DDIM' },
  { label: 'UniPC', value: 'UniPC' },
  { label: 'LCM', value: 'LCM' },
];

/**
 * Forge Neo 调度器预设列表（2026-07-29 新增）。
 * Forge Neo 将采样器与调度器分离，scheduler 控制 sigma 调度曲线。
 */
const SCHEDULER_OPTIONS = [
  { label: 'Karras（默认，适合大多数场景）', value: 'Karras' },
  { label: 'Automatic（自动选择）', value: 'Automatic' },
  { label: 'Exponential（更快，细节略少）', value: 'Exponential' },
  { label: 'Normal', value: 'Normal' },
  { label: 'Simple', value: 'Simple' },
  { label: 'Uniform', value: 'Uniform' },
  { label: 'Align Your Steps', value: 'Align Your Steps' },
  { label: 'Beta', value: 'Beta' },
];

/**
 * ADetailer 检测模型预设列表（用户也可手动输入）。
 * 来源：ADetailer-Neo 内置模型 + 常见下载模型。
 * - face_yolov8n.pt：2D/真实人脸，速度快（默认）
 * - face_yolov8s.pt：2D/真实人脸，精度更高（参数量 3 倍）
 * - face_yolov9c.pt：更高精度
 * - hand_yolov8n.pt：手部检测
 * - person_yolov8n-seg.pt：全身分割
 * - mediapipe_face_*：真实人脸专用
 *
 * 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
 * 新增 3 个模型，覆盖 furry/兽人/动物面部场景（详见 docs/FIX_RECORDS.md §7.18）：
 * - yolov8x-worldv2.pt：YOLO-World 开放词汇，ADetailer-Neo 预装，
 *   配合 adModelClasses 字段可零样本检测任意类别（如 furry face, anthro head）
 * - Anzhc HeadHair seg y8m.pt：社区头部+毛发分割，对兽人头部覆盖更全（含耳朵/毛发）
 * - Anzhc Face seg 640 v4 y11n.pt：高精度插画人脸（mAP50=0.835，远超 face_yolov8n 的 0.660）
 */
const ADETAILER_MODEL_OPTIONS = [
  { label: 'face_yolov8n.pt（默认，2D/真实人脸，速度快）', value: 'face_yolov8n.pt' },
  { label: 'face_yolov8s.pt（2D/真实人脸，精度更高）', value: 'face_yolov8s.pt' },
  { label: 'face_yolov9c.pt（更高精度）', value: 'face_yolov9c.pt' },
  { label: 'hand_yolov8n.pt（手部检测）', value: 'hand_yolov8n.pt' },
  { label: 'person_yolov8n-seg.pt（全身分割）', value: 'person_yolov8n-seg.pt' },
  { label: 'person_yolov8s-seg.pt（全身分割，精度更高）', value: 'person_yolov8s-seg.pt' },
  { label: 'mediapipe_face_full（真实人脸）', value: 'mediapipe_face_full' },
  { label: 'mediapipe_face_short（真实人脸）', value: 'mediapipe_face_short' },
  { label: 'mediapipe_face_mesh（真实人脸网格）', value: 'mediapipe_face_mesh' },
  // 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
  // 3 个新增模型，覆盖 furry/兽人/动物面部场景：
  // - yolov8x-worldv2.pt：YOLO-World 开放词汇，ADetailer-Neo 预装，
  //   配合 adModelClasses 字段检测任意类别（选择后下方出现「检测类别」输入框）
  // - Anzhc HeadHair seg y8m.pt：社区头部+毛发分割，对兽人头部覆盖更全（含耳朵/毛发）
  // - Anzhc Face seg 640 v4 y11n.pt：高精度插画人脸（mAP50=0.835，远超 face_yolov8n 的 0.660）
  { label: 'yolov8x-worldv2.pt（YOLO-World 开放词汇，furry/兽人，需配合下方「检测类别」）', value: 'yolov8x-worldv2.pt' },
  { label: 'Anzhc HeadHair seg y8m.pt（社区头部+毛发分割，兽人覆盖更全，需下载）', value: 'Anzhc HeadHair seg y8m.pt' },
  { label: 'Anzhc Face seg 640 v4 y11n.pt（高精度插画人脸，mAP 0.835，需下载）', value: 'Anzhc Face seg 640 v4 y11n.pt' },
];

/**
 * 模型类型预设参数（Spec: integrate-nl-driven-sd-models / Task 2）
 * 与 src/main/services/sdGenerationService.ts 的 MODEL_TYPE_PRESETS 保持一致。
 * 为避免跨进程导入问题，在组件内内联定义。
 */
const MODEL_TYPE_PRESETS: Record<string, { denoising: number; steps: number; cfgScale: number; sampler: string; scheduler: string; adetailerEnabled: boolean; width: number; height: number }> = {
  'sdxl': { denoising: 0.55, steps: 28, cfgScale: 7, sampler: 'DPM++ 3M SDE', scheduler: 'Karras', adetailerEnabled: true, width: 512, height: 512 },
  'qwen-image': { denoising: 1.0, steps: 28, cfgScale: 7, sampler: 'Euler', scheduler: 'Normal', adetailerEnabled: false, width: 1024, height: 1024 },
  'qwen-image-edit': { denoising: 0.95, steps: 28, cfgScale: 7, sampler: 'Euler', scheduler: 'Normal', adetailerEnabled: false, width: 512, height: 512 },
  'flux2': { denoising: 0.8, steps: 28, cfgScale: 7, sampler: 'Euler', scheduler: 'Beta', adetailerEnabled: false, width: 1024, height: 1024 },
};

/**
 * 根据模型文件名自动检测模型类型（Spec: integrate-nl-driven-sd-models / Task 2）
 * 与 src/main/services/sdGenerationService.ts 的 detectModelType 逻辑一致。
 */
const detectModelTypeFromName = (modelName: string): 'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2' => {
  const lower = (modelName || '').toLowerCase();
  if (lower.includes('qwen') && lower.includes('edit')) return 'qwen-image-edit';
  if (lower.includes('qwen')) return 'qwen-image';
  if (lower.includes('klein') || lower.includes('flux.2')) return 'flux2';
  return 'sdxl';
};

/**
 * Stable Diffusion WebUI 设置面板（Spec: add-ai-expression-generation / Task 6）
 *
 * UI 组成：
 *  - 端点 URL 输入 + 连接测试按钮（调用 window.electronAPI.sd.checkStatus）
 *  - 模型下拉（调用 window.electronAPI.sd.getModels 拉取，含「使用当前」选项）
 *  - Denoising Strength 滑块（0.1-0.9，步进 0.05）
 *  - Steps 数值输入（1-100）
 *  - CFG Scale 数值输入（1-20）
 *  - ADetailer 面部修复开关（默认开）+ 说明 tooltip
 *  - 自定义负面提示词 TextArea（可选）
 *
 * 与 VectorConfigPanel 同样使用 forwardRef + 自有 Form 实例：
 * 父组件通过 ref.current.getFormValues() 在保存时获取表单值，
 * 不混入 Settings.tsx 主表单的扁平字段命名空间。
 */
const SDWebuiSettings = forwardRef<SDWebuiSettingsRef>((_props, ref) => {
  const setting = useSettingStore(s => s.setting);
  const [form] = Form.useForm<SDWebuiConfig>();

  // 模型下拉选项：[{ label, value }]，空 value 选项表示「使用当前」
  const [modelOptions, setModelOptions] = useState<{ label: string; value: string }[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  // 连接测试结果：null 表示未测试
  const [testResult, setTestResult] = useState<{
    available: boolean;
    currentModel?: string;
    error?: string;
  } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // 【重点标记 - AutoComplete 搜索词分离（2026-08-07）】
  // AutoComplete 的 filterOption 默认用输入框值（inputValue）过滤选项。
  // 当输入框有默认值（如 face_yolov8n.pt）时，filterOption 会用该值过滤，
  // 导致只显示完全匹配的 1 个选项（用户反馈"下拉只有一个模型"）。
  // 解决方案：分离「输入框值」与「搜索词」，onFocus 时清空搜索词（显示全部
  // 12 个选项），onSearch 时更新搜索词（按输入过滤）。filterOption={false}
  // 禁用 AutoComplete 内部过滤，改由 filteredAdModelOptions 手动过滤。
  const [adModelSearch, setAdModelSearch] = useState('');
  const filteredAdModelOptions = useMemo(() => {
    const search = adModelSearch.toLowerCase().trim();
    if (!search) return ADETAILER_MODEL_OPTIONS;
    return ADETAILER_MODEL_OPTIONS.filter((opt) =>
      (opt.value ?? '').toLowerCase().includes(search),
    );
  }, [adModelSearch]);

  // 监听模型类型与去噪强度，用于条件渲染（Spec: integrate-nl-driven-sd-models / Task 2）
  // modelType 默认 'sdxl'（初始渲染时 useWatch 返回 undefined 的兜底）
  const modelType = Form.useWatch('modelType', form) ?? 'sdxl';
  const denoisingStrength = Form.useWatch('denoisingStrength', form);

  // 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
  // 监听 adModel 用于条件渲染：
  // - YOLO-World 系列（文件名含 "world"）→ 显示「检测类别」输入框（ad_model_classes）
  // - Anzhc 系列（文件名以 "Anzhc" 开头）→ 显示下载提示 Alert
  const adModelValue = Form.useWatch('adModel', form) ?? 'face_yolov8n.pt';
  const isYoloWorldModel = (adModelValue as string).toLowerCase().includes('world');
  const isAnzhcModel = (adModelValue as string).startsWith('Anzhc');

  useImperativeHandle(ref, () => ({
    getFormValues: () => {
      const values = form.getFieldsValue(true) as Partial<SDWebuiConfig>;
      // 合并默认值，避免字段缺失（旧配置无 sdWebui 时初始化场景）
      return {
        ...DEFAULT_SD_WEBUI_CONFIG,
        // 保留已持久化的 selectedLoras（不在表单中编辑，由 LoRA 选择 Modal 设置）
        ...(setting?.sdWebui?.selectedLoras ? { selectedLoras: setting.sdWebui.selectedLoras } : {}),
        ...values,
      } as SDWebuiConfig;
    },
  }));

  // 当 setting 加载/变化时，初始化表单值
  useEffect(() => {
    const saved = setting?.sdWebui;
    const initialValues: SDWebuiConfig = {
      ...DEFAULT_SD_WEBUI_CONFIG,
      ...(saved || {}),
    };
    form.setFieldsValue(initialValues);
  }, [setting, form]);

  /**
   * 连接测试：调用主进程 sd:checkStatus，更新 testResult 状态。
   * 端点为空时给出警告，不发请求。
   */
  const handleTestConnection = useCallback(async () => {
    const endpoint = form.getFieldValue('endpoint');
    if (!endpoint || !endpoint.trim()) {
      message.warning('请先填写 SD WebUI 端点 URL');
      return;
    }

    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await window.electronAPI.sd.checkStatus(endpoint.trim());
      setTestResult(result);
      if (result.available) {
        message.success(`连接成功，当前模型：${result.currentModel || '未知'}`);
      } else {
        message.error(`连接失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setTestResult({ available: false, error: errorMsg });
      message.error(`连接测试异常：${errorMsg}`);
    } finally {
      setTestLoading(false);
    }
  }, [form]);

  /**
   * 拉取模型列表：调用主进程 sd:getModels，更新 modelOptions。
   * 拉取成功后弹出成功提示，失败时保留空列表（仅「使用当前」选项）。
   */
  const handleFetchModels = useCallback(async () => {
    const endpoint = form.getFieldValue('endpoint');
    if (!endpoint || !endpoint.trim()) {
      message.warning('请先填写 SD WebUI 端点 URL');
      return;
    }

    setModelLoading(true);
    try {
      const result = await window.electronAPI.sd.getModels(endpoint.trim());
      if (result.success && result.models.length > 0) {
        const options = result.models.map((m) => ({
          label: m.title,
          value: m.title,
        }));
        setModelOptions(options);
        message.success(`成功获取 ${result.models.length} 个模型`);
      } else {
        // 拉取失败时清空非「使用当前」选项，避免显示陈旧数据
        setModelOptions([]);
        message.warning(result.error || '未获取到模型列表，请确认 SD WebUI 已启动');
      }
    } catch (error) {
      setModelOptions([]);
      message.error(`获取模型列表失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setModelLoading(false);
    }
  }, [form]);

  /**
   * 模型类型切换时自动填充推荐参数（Spec: integrate-nl-driven-sd-models / Task 2）
   * 根据 MODEL_TYPE_PRESETS 预设值更新 denoisingStrength/steps/cfgScale/sampler/adetailerEnabled/txt2img 尺寸。
   */
  const handleModelTypeChange = useCallback((value: string) => {
    const preset = MODEL_TYPE_PRESETS[value];
    if (preset) {
      form.setFieldsValue({
        denoisingStrength: preset.denoising,
        steps: preset.steps,
        cfgScale: preset.cfgScale,
        sampler: preset.sampler,
        adetailerEnabled: preset.adetailerEnabled,
        txt2imgWidth: preset.width,
        txt2imgHeight: preset.height,
      });
    }
  }, [form]);

  /**
   * 自动检测模型类型：读取当前模型名并推断类型（Spec: integrate-nl-driven-sd-models / Task 2）
   */
  const handleAutoDetect = useCallback(() => {
    const modelName = form.getFieldValue('model') || '';
    if (!modelName) {
      message.warning('请先选择模型，或点击「获取模型列表」');
      return;
    }
    const detected = detectModelTypeFromName(modelName);
    form.setFieldsValue({ modelType: detected });
    handleModelTypeChange(detected);
    message.success(`检测到模型类型：${detected}`);
  }, [form, handleModelTypeChange]);

  return (
    <Card
      title={
        <Space>
          <ApiOutlined />
          <span>Stable Diffusion 设置</span>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: 'rgba(99, 102, 241, 0.08)',
          borderRadius: '8px',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          用于角色卡 AI 表情生成（img2img）。需先启动 Stable Diffusion WebUI（推荐 Forge
          Neo）并以 <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>--api</code>{' '}
          参数开启 API。默认端点 <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>http://localhost:7860</code>。
        </p>
      </div>

      <Form form={form} layout="vertical">
        <Form.Item
          label="端点 URL"
          name="endpoint"
          tooltip="SD WebUI API 地址，例如 http://localhost:7860"
          rules={[{ required: true, message: '请输入端点 URL' }]}
        >
          <Input placeholder="http://localhost:7860" />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={handleTestConnection}
              loading={testLoading}
            >
              连接测试
            </Button>
            <span style={{ color: '#666', fontSize: 12 }}>
              目标: {form.getFieldValue('endpoint') || '未设置'}
            </span>
          </Space>
        </Form.Item>

        {testResult && (
          <div style={{ marginBottom: 16 }}>
            <Alert
              message={testResult.available ? 'SD WebUI 连接成功' : 'SD WebUI 连接失败'}
              description={
                <div>
                  <p>
                    <strong>端点:</strong> {form.getFieldValue('endpoint') || 'N/A'}
                  </p>
                  <p>
                    <strong>当前模型:</strong>{' '}
                    {testResult.currentModel || '未知'}
                  </p>
                  {testResult.error && (
                    <p style={{ color: 'red', marginTop: 8, whiteSpace: 'pre-line' }}>
                      <strong>错误:</strong> {testResult.error}
                    </p>
                  )}
                </div>
              }
              type={testResult.available ? 'success' : 'error'}
              showIcon
              closable
              onClose={() => setTestResult(null)}
            />
          </div>
        )}

        <Form.Item
          label={
            <Space>
              <span>模型</span>
              <Tooltip title="选择 SD WebUI 中已加载的模型；选择「使用当前」则不切换模型，沿用 SD WebUI 当前 checkpoint">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="model"
          tooltip="留空表示使用 SD WebUI 当前已加载模型；如需切换，点击右侧按钮拉取可用模型列表"
        >
          <Select
            placeholder="选择模型或使用当前"
            allowClear
            options={[
              { label: '使用当前', value: '' },
              ...modelOptions,
            ]}
          />
        </Form.Item>

        <Form.Item>
          <Button
            icon={<SyncOutlined />}
            onClick={handleFetchModels}
            loading={modelLoading}
          >
            获取模型列表
          </Button>
        </Form.Item>

        {/* ===== 模型类型选择（Spec: integrate-nl-driven-sd-models / Task 2）===== */}
        <Form.Item
          label={
            <Space>
              <span>模型类型 (Model Type)</span>
              <Tooltip title="选择 SD 模型类型。不同类型使用不同的生成方式（txt2img/img2img）与推荐参数。点击「自动检测」根据模型名推断类型">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="modelType"
          tooltip="SDXL 使用 img2img + ADetailer；Qwen-Image 使用 txt2img；Qwen-Image-Edit 使用 img2img（推荐用于表情生成）；Flux2 支持 txt2img/img2img"
        >
          <Select
            placeholder="选择模型类型"
            onChange={handleModelTypeChange}
            options={[
              { label: 'SDXL (img2img + ADetailer)', value: 'sdxl' },
              { label: 'Qwen-Image (txt2img)', value: 'qwen-image' },
              { label: 'Qwen-Image-Edit (img2img, 推荐用于表情生成)', value: 'qwen-image-edit' },
              { label: 'Flux2 (txt2img/img2img)', value: 'flux2' },
            ]}
          />
        </Form.Item>

        <Form.Item>
          <Button
            icon={<SyncOutlined />}
            onClick={handleAutoDetect}
          >
            自动检测
          </Button>
        </Form.Item>

        {/* ===== txt2img 输出尺寸（仅 txt2img 模型：qwen-image / flux2）===== */}
        {(modelType === 'qwen-image' || modelType === 'flux2') && (
          <>
            <Form.Item
              label={
                <Space>
                  <span>txt2img 输出宽度</span>
                  <Tooltip title="txt2img 模式的输出图像宽度（像素）。qwen-image / flux2 推荐 1024">
                    <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                  </Tooltip>
                </Space>
              }
              name="txt2imgWidth"
              tooltip="64-2048，推荐 1024"
            >
              <InputNumber min={64} max={2048} step={64} style={{ width: '100%' }} placeholder="例如: 1024" />
            </Form.Item>

            <Form.Item
              label={
                <Space>
                  <span>txt2img 输出高度</span>
                  <Tooltip title="txt2img 模式的输出图像高度（像素）。qwen-image / flux2 推荐 1024">
                    <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                  </Tooltip>
                </Space>
              }
              name="txt2imgHeight"
              tooltip="64-2048，推荐 1024"
            >
              <InputNumber min={64} max={2048} step={64} style={{ width: '100%' }} placeholder="例如: 1024" />
            </Form.Item>
          </>
        )}

        <Form.Item
          label={
            <Space>
              <span>Denoising Strength（去噪强度）</span>
              <Tooltip title="0=不改变原图，1=完全重绘。SDXL 表情生成推荐 0.5-0.6；qwen-image-edit 推荐 ≥ 0.9">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="denoisingStrength"
          tooltip="0.1-1.0，步进 0.05。SDXL 推荐 0.55；qwen-image-edit 推荐 0.95"
        >
          <Slider min={0.1} max={1.0} step={0.05} marks={{ 0.1: '0.1', 0.55: '0.55', 0.9: '0.9', 1.0: '1.0' }} />
        </Form.Item>

        {/* qwen-image-edit 去噪强度警告（Spec: integrate-nl-driven-sd-models / Task 2）*/}
        {modelType === 'qwen-image-edit' && denoisingStrength !== undefined && denoisingStrength < 0.9 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="qwen-image-edit 模型推荐 denoising ≥ 0.9，当前值可能导致编辑效果不佳"
          />
        )}

        <Form.Item
          label="Steps（采样步数）"
          name="steps"
          tooltip="1-100，SDXL 推荐 28。步数越多细节越丰富但耗时越长"
        >
          <InputNumber min={1} max={100} step={1} style={{ width: '100%' }} placeholder="例如: 28" />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <span>CFG Scale（提示词遵循度）</span>
              <Tooltip title="1-20，值越高越严格遵循提示词，但过高会导致画面过饱和。推荐 7">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="cfgScale"
          tooltip="1-20，推荐 7"
        >
          <InputNumber min={1} max={20} step={0.5} style={{ width: '100%' }} placeholder="例如: 7" />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <span>Sampling Method（采样器）</span>
              <Tooltip title="采样算法。SDXL 推荐 DPM++ 2M Karras（速度/质量平衡）或 DPM++ 2M SDE Karras（更高质量）。也可手动输入 SD WebUI 支持的其他采样器名">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="sampler"
          tooltip="SDXL 推荐 DPM++ 2M Karras。支持下拉选择或手动输入自定义采样器名"
        >
          <AutoComplete
            options={SAMPLER_OPTIONS}
            placeholder="选择或输入采样器名"
            filterOption={(inputValue, option) =>
              (option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())
            }
            allowClear
          />
        </Form.Item>

        {/* 【重点标记 - 调度器 + CLIP Skip（2026-07-29）】 */}
        <Space style={{ display: 'flex', marginBottom: 8 }} align="start">
          <Form.Item
            label="调度器"
            name="scheduler"
            tooltip="Forge Neo 将采样器与调度器分离。Karras 适合大多数场景，Exponential 更快但细节略少"
            style={{ flex: 1, marginBottom: 0, minWidth: 200 }}
          >
            <AutoComplete
              options={SCHEDULER_OPTIONS}
              placeholder="选择调度器"
              allowClear
            />
          </Form.Item>
          <Form.Item
            label="CLIP Skip"
            name="clipSkip"
            tooltip="CLIP 停止层数。SD1.5 推荐 2，SDXL 推荐 1~2。通过 override_settings 注入"
            style={{ width: 120, marginBottom: 0 }}
          >
            <InputNumber min={1} max={12} style={{ width: '100%' }} />
          </Form.Item>
        </Space>

        {/* ADetailer 面部修复（仅 SDXL）/ NL 提示词模板（非 SDXL 模型）- Spec: integrate-nl-driven-sd-models / Task 2 */}
        {modelType === 'sdxl' ? (
          <Form.Item
            label={
              <Space>
                <span>ADetailer 面部修复</span>
                <Tooltip title="启用 ADetailer 对生成图像中的面部进行二次修复，提升面部细节与角色一致性。建议保持开启。下方「ADetailer 高级参数」可调整检测模型与修复参数">
                  <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                </Tooltip>
              </Space>
            }
            name="adetailerEnabled"
            valuePropName="checked"
            tooltip="启用后将在 img2img 后追加 ADetailer 面部修复，提升角色一致性"
          >
            <Switch />
          </Form.Item>
        ) : (
          <Form.Item
            label={
              <Space>
                <span>NL 提示词模板</span>
                <Tooltip title="自然语言驱动的模型（Qwen-Image / Flux2 等）使用此模板构建提示词。支持 {traits}（角色视觉特征）与 {emotion}（情绪描述）两个占位符">
                  <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                </Tooltip>
              </Space>
            }
            name="nlPromptTemplate"
            tooltip="支持 {traits} 与 {emotion} 占位符。例如：A portrait of a character. {traits} The character has {emotion}, looking at the viewer."
          >
            <Input.TextArea
              rows={4}
              placeholder="使用 {traits} 与 {emotion} 标记位置。例如：A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed."
            />
          </Form.Item>
        )}

        <Form.Item
          label={
            <Space>
              <span>正面提示词模板</span>
              <Tooltip title="支持 {traits} 与 {emotion} 两个占位符。{traits} 由角色视觉特征 tag 替换（如 white fur, dog girl），{emotion} 由情绪专用提示词替换。可在此输入角色外观 tag（如 1girl, silver hair, blue eyes），不再自动注入角色卡 description 长文本。留空使用默认模板">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="positivePromptTemplate"
          tooltip="支持 {traits} 与 {emotion} 两个占位符。例如：1girl, silver hair, {traits}, {emotion}, portrait, high quality"
        >
          <Input.TextArea
            rows={4}
            placeholder="使用 {traits} 与 {emotion} 标记位置。例如：1girl, silver hair, blue eyes, {traits}, {emotion}, portrait, looking at viewer, high quality, masterpiece"
          />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <span>自定义负面提示词</span>
              <Tooltip title="留空则使用 PromptBuilder 默认负面提示词。填写后将完全替换默认负面提示词">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Tooltip>
            </Space>
          }
          name="customNegativePrompt"
          tooltip="可选；留空使用默认负面提示词"
        >
          <Input.TextArea
            rows={4}
            placeholder="可选；留空则使用默认负面提示词。例如：lowres, bad anatomy, bad hands, text, error"
          />
        </Form.Item>

        {/* ===== ADetailer 高级参数（仅 SDXL 模型显示）- Spec: integrate-nl-driven-sd-models / Task 2 =====
         * 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展】
         * 早期版本仅暴露 adetailerEnabled 开关，无检测模型/置信度/去噪强度等高级参数，
         * 且 ADetailer args 字段名错误（ad_inpaint_full_res / ad_dilation）导致 Neo 报错。
         * 此折叠面板暴露全套 ADetailer-Neo 支持的参数，字段名严格对齐
         * `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs` 定义。
         */}
        {modelType === 'sdxl' && (
        <Collapse
          ghost
          style={{ marginTop: 8, background: 'rgba(99, 102, 241, 0.04)', borderRadius: 8 }}
          items={[
            {
              key: 'adetailer-advanced',
              label: (
                <Space>
                  <SettingOutlined style={{ color: 'var(--primary-color, #6366f1)' }} />
                  <span style={{ fontWeight: 500 }}>ADetailer 高级参数</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>
                    （检测模型 / 置信度 / 去噪强度 / mask / 独立采样参数）
                  </span>
                </Space>
              ),
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="ADetailer-Neo 兼容性"
                    description="字段名严格对齐 ADetailer-Neo 的 ADetailerArgs 定义（extra=forbid）。检测模型决定面部/手部/全身检测；mask 参数控制修复区域；独立采样参数允许 ADetailer 使用与主图不同的 steps/CFG/sampler 获得更精细的面部修复。"
                  />

                  <Form.Item
                    label={
                      <Space>
                        <span>检测模型（ad_model）</span>
                        <Tooltip title="YOLO 模型检测人脸/手/全身；mediapipe 仅适合真实人脸。face_yolov8n.pt 速度快（默认），face_yolov8s.pt 精度更高">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adModel"
                    tooltip="face_yolov8n.pt 默认；face_yolov8s.pt 精度更高；hand_yolov8n.pt 手部；person_yolov8n-seg.pt 全身"
                  >
                    <AutoComplete
                      options={filteredAdModelOptions}
                      placeholder="选择或输入检测模型名"
                      onSearch={setAdModelSearch}
                      onFocus={() => setAdModelSearch('')}
                      filterOption={false}
                      allowClear
                    />
                  </Form.Item>

                  {/* 【重点标记 - YOLO-World 检测类别（2026-08-07）】仅 YOLO-World 系列模型显示 */}
                  {/* ad_model_classes 透传给 ultralytics_predict 的 classes 参数，实现零样本开放词汇检测 */}
                  {isYoloWorldModel && (
                    <Form.Item
                      label={
                        <Space>
                          <span>检测类别（ad_model_classes）</span>
                          <Tooltip title="仅 YOLO-World 模型生效。逗号分隔的文本提示，零样本检测任意对象。例如：furry face, anthro head, animal head, kemono face。留空则使用模型默认 COCO 80 类">
                            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                          </Tooltip>
                        </Space>
                      }
                      name="adModelClasses"
                      tooltip="逗号分隔的检测类别文本提示，仅 YOLO-World 模型生效"
                    >
                      <Input.TextArea
                        rows={2}
                        placeholder="furry face, anthro head, animal head, kemono face（留空=使用默认 COCO 80 类）"
                      />
                    </Form.Item>
                  )}

                  {/* 【重点标记 - Anzhc 社区模型下载提示（2026-08-07）】仅选择 Anzhc 模型时显示 */}
                  {isAnzhcModel && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="此模型需手动下载"
                      description={
                        <div style={{ fontSize: 12 }}>
                          从 HuggingFace 下载：
                          <a
                            href="https://huggingface.co/Anzhc/Anzhcs_YOLOs"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Anzhc/Anzhcs_YOLOs
                          </a>
                          <br />
                          下载后放入 SD WebUI 的 <code>models/adetailer/</code> 目录，文件名必须与上方完全一致。
                        </div>
                      }
                    />
                  )}

                  <Form.Item
                    label={
                      <Space>
                        <span>检测置信度（ad_confidence）</span>
                        <Tooltip title="0.0-1.0。越高越严格（只检测高置信度区域），越低越宽松（可能误检）。默认 0.3">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adConfidence"
                    tooltip="0.0-1.0，推荐 0.3。值越高越严格"
                  >
                    <Slider min={0} max={1} step={0.05} marks={{ 0: '0', 0.3: '0.3', 0.5: '0.5', 1: '1' }} />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>面部修复去噪强度（ad_denoising_strength）</span>
                        <Tooltip title="0.0-1.0。ADetailer 局部修复的去噪强度，独立于主图 denoising。0.3-0.5 推荐范围，过高会导致面部失真">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adDenoisingStrength"
                    tooltip="0.0-1.0，推荐 0.4。独立于主图去噪强度"
                  >
                    <Slider min={0} max={1} step={0.05} marks={{ 0: '0', 0.4: '0.4', 0.7: '0.7', 1: '1' }} />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>Mask 模糊（ad_mask_blur）</span>
                        <Tooltip title="mask 边缘模糊像素数（0-20）。平滑修复区域与原图的过渡，避免硬边。默认 4">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adMaskBlur"
                    tooltip="0-20 像素，默认 4"
                  >
                    <InputNumber min={0} max={20} step={1} style={{ width: '100%' }} placeholder="例如: 4" />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>Mask 膨胀/腐蚀（ad_dilate_erode）</span>
                        <Tooltip title="像素。正值膨胀（扩大修复区域），负值腐蚀（缩小）。默认 4。扩大可确保面部边缘完全覆盖">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adDilateErode"
                    tooltip="正值膨胀，负值腐蚀，默认 4"
                  >
                    <InputNumber min={-20} max={20} step={1} style={{ width: '100%' }} placeholder="例如: 4" />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>仅修复 Mask 区域（ad_inpaint_only_masked）</span>
                        <Tooltip title="开启后仅对检测到的 mask 区域进行高分辨率修复，再融合回原图。关闭则对全图重绘（速度慢、可能改变背景）。建议开启">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adInpaintOnlyMasked"
                    valuePropName="checked"
                    tooltip="开启=局部高分辨率修复（推荐）；关闭=全图重绘"
                  >
                    <Switch />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>Mask Padding（ad_inpaint_only_masked_padding）</span>
                        <Tooltip title="像素。仅 ad_inpaint_only_masked=true 时生效。mask 外扩 padding 后再修复，确保边缘自然融合。默认 32">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adInpaintOnlyMaskedPadding"
                    tooltip="0-128 像素，默认 32"
                  >
                    <InputNumber min={0} max={128} step={1} style={{ width: '100%' }} placeholder="例如: 32" />
                  </Form.Item>

                  <Alert
                    type="info"
                    showIcon
                    style={{ margin: '16px 0' }}
                    message="独立采样参数（可选）"
                    description="开启后 ADetailer 使用独立的修复尺寸/步数/CFG/采样器，可获得更精细的面部修复效果。关闭则沿用主图参数。"
                  />

                  <Form.Item
                    label={
                      <Space>
                        <span>使用独立修复尺寸（ad_use_inpaint_width_height）</span>
                        <Tooltip title="开启后 ADetailer 在指定尺寸（ad_inpaint_width/height）下修复面部，再缩放回原图。可提升面部细节">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adUseInpaintWidthHeight"
                    valuePropName="checked"
                    tooltip="开启后使用独立的修复尺寸"
                  >
                    <Switch />
                  </Form.Item>

                  <Form.Item
                    label="修复宽度（ad_inpaint_width）"
                    name="adInpaintWidth"
                    tooltip="ADetailer 修复区域宽度，默认 512"
                  >
                    <InputNumber min={64} max={2048} step={64} style={{ width: '100%' }} placeholder="例如: 512" />
                  </Form.Item>

                  <Form.Item
                    label="修复高度（ad_inpaint_height）"
                    name="adInpaintHeight"
                    tooltip="ADetailer 修复区域高度，默认 512"
                  >
                    <InputNumber min={64} max={2048} step={64} style={{ width: '100%' }} placeholder="例如: 512" />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>使用独立步数（ad_use_steps）</span>
                        <Tooltip title="开启后 ADetailer 使用独立的采样步数（ad_steps），可获得更精细的面部细节">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adUseSteps"
                    valuePropName="checked"
                    tooltip="开启后使用独立的步数"
                  >
                    <Switch />
                  </Form.Item>

                  <Form.Item
                    label="独立步数（ad_steps）"
                    name="adSteps"
                    tooltip="1-150，默认 20。ADetailer 局部修复步数"
                  >
                    <InputNumber min={1} max={150} step={1} style={{ width: '100%' }} placeholder="例如: 20" />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>使用独立 CFG（ad_use_cfg_scale）</span>
                        <Tooltip title="开启后 ADetailer 使用独立的 CFG（ad_cfg_scale）。面部修复通常用较低 CFG（4.0）避免过饱和">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adUseCfgScale"
                    valuePropName="checked"
                    tooltip="开启后使用独立的 CFG"
                  >
                    <Switch />
                  </Form.Item>

                  <Form.Item
                    label="独立 CFG（ad_cfg_scale）"
                    name="adCfgScale"
                    tooltip="1.0-24.0，默认 4.0。ADetailer 局部修复 CFG"
                  >
                    <InputNumber min={1} max={24} step={0.5} style={{ width: '100%' }} placeholder="例如: 4.0" />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space>
                        <span>使用独立采样器（ad_use_sampler）</span>
                        <Tooltip title="开启后 ADetailer 使用独立的采样器（ad_sampler）。面部修复可用更精细的采样器如 DPM++ SDE Karras">
                          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
                        </Tooltip>
                      </Space>
                    }
                    name="adUseSampler"
                    valuePropName="checked"
                    tooltip="开启后使用独立的采样器"
                  >
                    <Switch />
                  </Form.Item>

                  <Form.Item
                    label="独立采样器（ad_sampler）"
                    name="adSampler"
                    tooltip="默认 'Use same sampler' 沿用主采样器。可手动输入其他采样器名"
                  >
                    <AutoComplete
                      options={SAMPLER_OPTIONS}
                      placeholder="Use same sampler 或输入采样器名"
                      filterOption={(inputValue, option) =>
                        (option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())
                      }
                      allowClear
                    />
                  </Form.Item>

                  {/* 【重点标记 - ADetailer 面部修复专用参数（2026-07-29 源码核验）】 */}
                  {/* 源码：ADetailer-Neo args.py:50/78/79 */}
                  <Form.Item
                    label="ADetailer 独立负面提示词（ad_negative_prompt）"
                    name="adNegativePrompt"
                    tooltip="ADetailer 面部修复专用负面提示词。留空则沿用主负面提示词。可针对性优化面部，如 'deformed, distorted, disfigured, bad face, wrong anatomy'"
                  >
                    <Input.TextArea
                      rows={2}
                      placeholder="留空则沿用主负面提示词。例如：deformed, distorted, bad face, wrong anatomy"
                    />
                  </Form.Item>
                  <Space style={{ display: 'flex', marginBottom: 8 }} align="start">
                    <Form.Item
                      label="启用独立噪声倍率"
                      name="adUseNoiseMultiplier"
                      valuePropName="checked"
                      tooltip="开启后使用独立的 ADetailer 噪声倍率，控制面部修复细节丰富度"
                      style={{ marginBottom: 0 }}
                    >
                      <Switch />
                    </Form.Item>
                    <Form.Item
                      label="噪声倍率（ad_noise_multiplier）"
                      name="adNoiseMultiplier"
                      tooltip="0.5-1.5。增大可增加面部细节，但过高可能引入噪声。默认 1.0"
                      style={{ flex: 1, marginBottom: 0, minWidth: 200 }}
                    >
                      <InputNumber min={0.5} max={1.5} step={0.05} style={{ width: '100%' }} />
                    </Form.Item>
                  </Space>
                </>
              ),
            },
          ]}
        />
      )}

        {/* ===== Hires.fix 高分辨率修复参数（2026-07-29 新增）===== */}
        <Collapse
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'hires-fix',
              label: <span style={{ fontWeight: 500 }}>Hires.fix 修复与放大</span>,
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Hires.fix 高分辨率修复"
                    description="启用后生成的图片会经过第二轮高分辨率放大修复，提升细节和画质。默认 Upscaler=Latent，Steps=50。其他参数沿用 webui-forge-neo 默认值。"
                  />
                  <Form.Item
                    label="启用 Hires.fix"
                    name="hrFixEnabled"
                    valuePropName="checked"
                    tooltip="默认开启。启用后生成的图片会经过第二轮高分辨率放大修复"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    label="放大器（hr_upscaler）"
                    name="hrUpscaler"
                    tooltip="高分辨率修复使用的放大算法。Latent=在潜空间放大（推荐，细节更丰富）；其他如 Lanczos/ESRGAN_4x 等为像素空间放大"
                  >
                    <Select
                      options={[
                        { label: 'Latent（推荐）', value: 'Latent' },
                        { label: 'Latent (antialiased)', value: 'Latent (antialiased)' },
                        { label: 'None', value: 'None' },
                        { label: 'Lanczos', value: 'Lanczos' },
                        { label: 'Nearest', value: 'Nearest' },
                        { label: 'ESRGAN_4x', value: 'ESRGAN_4x' },
                        { label: 'R-ESRGAN 4x+', value: 'R-ESRGAN 4x+' },
                        { label: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
                        { label: 'SwinIR 4x', value: 'SwinIR 4x' },
                      ]}
                      placeholder="选择放大器"
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        Hires Steps
                        <Tooltip title="高分辨率修复的采样步数，默认 50。步数越高细节越丰富但生成越慢">
                          <QuestionCircleOutlined style={{ marginLeft: 4 }} />
                        </Tooltip>
                      </span>
                    }
                    name="hrSteps"
                  >
                    <InputNumber min={1} max={150} style={{ width: '100%' }} placeholder="50" />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        放大倍数（hr_scale）
                        <Tooltip title="图片放大倍数，默认 2.0。1.5=放大1.5倍，2.0=放大2倍">
                          <QuestionCircleOutlined style={{ marginLeft: 4 }} />
                        </Tooltip>
                      </span>
                    }
                    name="hrScale"
                  >
                    <InputNumber min={1} max={4} step={0.1} style={{ width: '100%' }} placeholder="2.0" />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        去噪强度（hr_denoising_strength）
                        <Tooltip title="高分辨率修复的去噪强度（0-1），默认 0.55。0=不改变原图，1=完全重绘">
                          <QuestionCircleOutlined style={{ marginLeft: 4 }} />
                        </Tooltip>
                      </span>
                    }
                    name="hrDenoisingStrength"
                  >
                    <Slider min={0} max={1} step={0.05} />
                  </Form.Item>
                  <Form.Item
                    label="Hires 提示词（可选）"
                    name="hrPrompt"
                    tooltip="高分辨率修复第二轮使用的提示词。留空则沿用第一轮 prompt"
                  >
                    <Input.TextArea
                      rows={2}
                      placeholder="留空则沿用第一轮提示词"
                    />
                  </Form.Item>
                  <Form.Item
                    label="Hires 负面提示词（可选）"
                    name="hrNegativePrompt"
                    tooltip="高分辨率修复第二轮使用的负面提示词。留空则沿用第一轮"
                  >
                    <Input.TextArea
                      rows={2}
                      placeholder="留空则沿用第一轮负面提示词"
                    />
                  </Form.Item>
                  {/* 【重点标记 - Hires 高质量参数（2026-07-29）】 */}
                  <Space style={{ display: 'flex', marginBottom: 8 }} align="start">
                    <Form.Item
                      label="Hires CFG"
                      name="hrCfg"
                      tooltip="Hires 第二轮 CFG。Forge Neo 默认 1.0（不使用负提示），设为 5~7 显著提升细节"
                      style={{ width: 120, marginBottom: 0 }}
                    >
                      <InputNumber min={1} max={30} step={0.5} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      label="Hires 采样器"
                      name="hrSamplerName"
                      tooltip="Hires 第二轮独立采样器（默认 DPM++ 2M SDE）"
                      style={{ flex: 1, marginBottom: 0, minWidth: 180 }}
                    >
                      <AutoComplete
                        options={SAMPLER_OPTIONS}
                        placeholder="Hires 采样器"
                        allowClear
                      />
                    </Form.Item>
                    <Form.Item
                      label="Hires 调度器"
                      name="hrScheduler"
                      tooltip="Hires 第二轮独立调度器（默认 Karras）"
                      style={{ width: 150, marginBottom: 0 }}
                    >
                      <AutoComplete
                        options={SCHEDULER_OPTIONS}
                        placeholder="Hires 调度器"
                        allowClear
                      />
                    </Form.Item>
                  </Space>
                  {/* img2img 噪声参数 */}
                  <Space style={{ display: 'flex', marginBottom: 8 }} align="start">
                    <Form.Item
                      label="img2img 额外噪声"
                      name="img2imgExtraNoise"
                      tooltip="img2img 降采样后添加的微量噪声（0~1），>0 增加细节丰富度"
                      style={{ width: 160, marginBottom: 0 }}
                    >
                      <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      label="初始噪声倍率"
                      name="initialNoiseMultiplier"
                      tooltip="添加到 init_images 的噪声倍率（0~1.5），略 >1 可增加细节"
                      style={{ width: 160, marginBottom: 0 }}
                    >
                      <InputNumber min={0} max={1.5} step={0.05} style={{ width: '100%' }} />
                    </Form.Item>
                  </Space>
                </>
              ),
            },
            {
              key: 'img2img-hires-mode',
              label: <span style={{ fontWeight: 500 }}>img2img 高清模式</span>,
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="img2img 高清修复方案"
                    description="Forge Neo 的 img2img 不支持 Hires.fix，通过以下两种替代方案实现高清修复效果。两种方案均启用 ADetailer 面部修复。"
                  />
                  <Form.Item label="高清模式" name="img2imgHiresMode">
                    <Radio.Group>
                      <Radio value="direct">直接高分辨率（1024 一步生成）</Radio>
                      <Radio value="two-step">两步放大（768 生成 → 1024 修复）</Radio>
                    </Radio.Group>
                  </Form.Item>
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="参数已针对高性能显卡优化"
                    description="直接模式：1024 分辨率 + 30 步 + ADetailer 1024×1024 面部修复。两步模式：第一步 768/30步 → 第二步 1024/20步低降噪放大 + ADetailer 1024×1024。"
                  />
                </>
              ),
            },
          ]}
        />
      </Form>
    </Card>
  );
});

SDWebuiSettings.displayName = 'SDWebuiSettings';

export default SDWebuiSettings;
