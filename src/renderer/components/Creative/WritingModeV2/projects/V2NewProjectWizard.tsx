import React, { useEffect, useState } from 'react';
import {
  Modal,
  Steps,
  Form,
  Input,
  Select,
  InputNumber,
  Slider,
  Button,
  Card,
  Descriptions,
  message,
  Alert,
  Space,
  theme,
} from 'antd';
import { NovelType, NarrativePerspective, WritingStyle } from '../../../../../shared/types/writing-v2.types';
import {
  V2_NOVEL_TYPE_OPTIONS,
  V2_PERSPECTIVE_OPTIONS,
  V2_WRITING_STYLE_OPTIONS,
  buildModelConfigFromEngine,
  buildV2WritingConfig,
} from '../shared/v2Labels';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';

interface EngineOption {
  id: string;
  name: string;
  model_name: string;
  temperature?: number;
  max_tokens?: number;
  api_url?: string;
  api_key?: string;
}

/** 第 0 步创意参数字段值（步骤切换时捕获，避免 Form 卸载后 getFieldsValue 取空） */
interface V2ParamsValues {
  creativeDescription?: string;
  novelType?: NovelType;
  narrativePerspective?: NarrativePerspective;
  writingStyle?: WritingStyle;
  targetWordCount?: number;
  chapterCount?: number;
  additionalRequirements?: string;
}

/**
 * V2 新建项目向导（Phase 1 / P0）
 * 三步分步表单：创意参数 → 模型配置 → 确认创建。
 * 资源绑定（世界书/角色卡/人设）在 P2 阶段补充，当前默认空绑定。
 */
const V2NewProjectWizard: React.FC = () => {
  const { token } = theme.useToken();
  const showWizard = useV2UIStore((s) => s.showWizard);
  const setShowWizard = useV2UIStore((s) => s.setShowWizard);
  const setStage = useV2UIStore((s) => s.setStage);
  const createProject = useV2ProjectStore((s) => s.createProject);

  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [engines, setEngines] = useState<EngineOption[]>([]);
  const [activeEngineId, setActiveEngineId] = useState<string>('');
  // 第 0 步校验通过后捕获的值（Form 在 step>0 时卸载，届时 getFieldsValue 取不到）
  const [paramsValues, setParamsValues] = useState<V2ParamsValues | null>(null);

  const [paramsForm] = Form.useForm();
  const [modelForm] = Form.useForm();

  useEffect(() => {
    if (!showWizard) return;
    (async () => {
      try {
        const loadResult = await window.electronAPI?.setting?.load?.();
        const allSettings = loadResult?.setting || loadResult;
        const list: EngineOption[] = allSettings?.aiEngines || [];
        setEngines(list);
        const activeId = allSettings?.activeEngineId
          ? list.find((e) => e.id === allSettings.activeEngineId)?.id || list[0]?.id || ''
          : list[0]?.id || '';
        setActiveEngineId(activeId);
        modelForm.setFieldsValue({ engineId: activeId });
      } catch {
        setEngines([]);
      }
    })();
  }, [showWizard, modelForm]);

  const close = () => {
    setShowWizard(false);
    setStep(0);
    setParamsValues(null);
  };

  const handleNextFromParams = async () => {
    try {
      const values = (await paramsForm.validateFields()) as V2ParamsValues;
      // 关键：Form 在 step>0 时卸载，必须在切换前捕获字段值
      setParamsValues(values);
      setStep(1);
    } catch {
      // 表单校验失败，停留在当前步骤
    }
  };

  const activeEngine = engines.find((e) => e.id === activeEngineId);

  const handleCreate = async () => {
    // 优先用第 0 步捕获的值（此时 paramsForm 已卸载，getFieldsValue 不可靠）
    const values = paramsValues ?? (paramsForm.getFieldsValue() as V2ParamsValues);
    if (!activeEngine) {
      message.error('请选择 AI 引擎');
      return;
    }
    if (!values.creativeDescription || values.creativeDescription.length < 10) {
      message.error('创意描述缺失，请返回第一步重新填写');
      setStep(0);
      return;
    }
    setCreating(true);
    try {
      const modelConfig = buildModelConfigFromEngine(activeEngine, {
        temperature: modelForm.getFieldValue('temperature'),
        maxTokens: modelForm.getFieldValue('maxTokens'),
      });
      const config = buildV2WritingConfig({
        creativeDescription: values.creativeDescription,
        // 其余字段表单有 initialValues，捕获值理论上必有；兜底与 initialValues 保持一致
        novelType: values.novelType ?? NovelType.WEB_NOVEL,
        targetWordCount: values.targetWordCount ?? 20000,
        chapterCount: values.chapterCount ?? 10,
        narrativePerspective: values.narrativePerspective ?? NarrativePerspective.THIRD_PERSON,
        writingStyle: values.writingStyle,
        additionalRequirements: values.additionalRequirements,
        modelConfig,
      });
      const projectId = await createProject(config);
      if (projectId) {
        message.success('项目创建成功');
        close();
        setStage('outline');
      } else {
        // 展示真实错误详情（store 不再吞错；await 后需经 getState 读最新值，闭包内是旧值）
        const detail = useV2ProjectStore.getState().lastCreateError;
        message.error(`创建失败：${detail || '未知错误，请重试'}`, 8);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="新建写作项目"
      open={showWizard}
      onCancel={close}
      width={640}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={close}>取消</Button>
          <Space>
            {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
            {step === 0 && (
              <Button type="primary" onClick={handleNextFromParams}>
                下一步
              </Button>
            )}
            {step === 1 && (
              <Button type="primary" onClick={() => setStep(2)}>
                下一步
              </Button>
            )}
            {step === 2 && (
              <Button type="primary" loading={creating} onClick={handleCreate}>
                创建项目
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Steps
        current={step}
        size="small"
        style={{ margin: '8px 0 24px' }}
        items={[{ title: '创意参数' }, { title: '模型配置' }, { title: '确认创建' }]}
      />

      {step === 0 && (
        <Form
          form={paramsForm}
          layout="vertical"
          initialValues={{
            novelType: NovelType.WEB_NOVEL,
            narrativePerspective: NarrativePerspective.THIRD_PERSON,
            writingStyle: WritingStyle.DETAILED,
            targetWordCount: 20000,
            chapterCount: 10,
          }}
        >
          <Form.Item
            name="creativeDescription"
            label="创意描述"
            rules={[
              { required: true, min: 10, message: '请至少输入 10 个字的创意描述' },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="用几句话描述你的作品：题材、核心设定、主角、想要讲的故事……"
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
            <Input.TextArea rows={2} placeholder="对写作提出的额外要求，如节奏、禁忌、风格参考等" />
          </Form.Item>
        </Form>
      )}

      {step === 1 && (
        <div>
          {engines.length === 0 && (
            <Alert
              type="warning"
              showIcon
              message="未找到可用的 AI 引擎"
              description="请先在设置中配置 AI 服务（API 地址、密钥与模型）后再创建项目。"
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={modelForm} layout="vertical">
            <Form.Item
              name="engineId"
              label="AI 引擎"
              rules={[{ required: true, message: '请选择 AI 引擎' }]}
            >
              <Select
                options={engines.map((e) => ({
                  value: e.id,
                  label: `${e.name}（${e.model_name}）`,
                }))}
                onChange={(id: string) => {
                  setActiveEngineId(id);
                  const engine = engines.find((e) => e.id === id);
                  modelForm.setFieldsValue({
                    temperature: engine?.temperature,
                    maxTokens: engine?.max_tokens,
                  });
                }}
              />
            </Form.Item>
            {activeEngine && (
              <Card size="small" style={{ marginBottom: 16, background: token_bg }}>
                <Descriptions
                  size="small"
                  column={1}
                  items={[
                    { key: 'model', label: '模型', children: activeEngine.model_name || '-' },
                    {
                      key: 'conn',
                      label: '连接状态',
                      children:
                        activeEngine.api_url && activeEngine.api_key ? (
                          <span style={{ color: token.colorSuccess }}>已配置</span>
                        ) : (
                          <span style={{ color: token.colorWarning }}>未配置完整</span>
                        ),
                    },
                  ]}
                />
              </Card>
            )}
            <Form.Item name="temperature" label="温度（temperature）">
              <Slider min={0} max={2} step={0.1} defaultValue={0.7} />
            </Form.Item>
            <Form.Item name="maxTokens" label="单次生成最大 tokens（maxTokens）">
              <InputNumber min={256} max={32768} step={256} style={{ width: 200 }} />
            </Form.Item>
          </Form>
        </div>
      )}

      {step === 2 && (
        <Card size="small">
          <Descriptions
            size="small"
            column={2}
            items={[
              { key: 'desc', label: '创意描述', children: paramsValues?.creativeDescription || '-', span: 2 },
              { key: 'type', label: '类型 / 视角 / 风格', children: `${paramsValues?.novelType ?? '-'} / ${paramsValues?.narrativePerspective ?? '-'} / ${paramsValues?.writingStyle ?? '-'}` },
              { key: 'words', label: '目标字数', children: String(paramsValues?.targetWordCount ?? '-') },
              { key: 'chapters', label: '章节数量', children: String(paramsValues?.chapterCount ?? '-') },
              { key: 'engine', label: 'AI 引擎', children: activeEngine ? `${activeEngine.name}（${activeEngine.model_name}）` : '-' },
            ]}
          />
        </Card>
      )}
    </Modal>
  );
};

const token_bg = 'var(--ant-color-fill-quaternary, #fafafa)';

export default V2NewProjectWizard;
