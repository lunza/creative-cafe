/**
 * useSettingsPanel — 6 个设置面板的共享骨架 hook（Spec: settings-feature-optimization-report / M-2, CR-2）
 *
 * 背景：WebSearchSettings / TagAutocompleteSettings / TagRagSettings / SDWebuiSettings /
 * BlockedWordsSettings / VectorConfigPanel 六个面板各自重复同一套骨架：
 *   useForm + useSettingStore 订阅 + initializeFromSetting（默认值合并 + setFieldsValue
 *   + 快照）+ setting 变化 effect + Form.useWatch 脏检测上抛 + useImperativeHandle
 *   四方法契约（getFormValues/isDirty/resetFields/refreshFromStore），合计 ~287 行样板。
 *
 * 本 hook 把骨架收敛为一处实现，面板只保留：
 *   - Form.Item 声明（UI 本体）
 *   - 个性化钩子（buildInitialValues 自定义初始化 / getExtraSaveValues 额外保存字段 /
 *     isExtraDirty 本地 state 脏检测 / onResetExtras 本地 state 复位 / onInitialized 初始化副作用）
 *
 * 面板侧用法：
 *   const { form, refHandle } = useSettingsPanel({
 *     configKey: 'webSearch',
 *     defaults: DEFAULT_WEB_SEARCH_CONFIG,
 *     onDirtyChange,
 *   });
 *   useImperativeHandle(ref, () => refHandle, [refHandle]);
 *
 * 默认值单一来源：defaults 参数必须传 shared/settingDefaults 的域常量
 * （DEFAULT_*_CONFIG / DEFAULT_VECTOR_CONFIGS），禁止面板内联复制。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Form, type FormInstance } from 'antd';
import type { AppSetting } from '../../../types/setting';
import { useSettingStore } from '../../../stores/settingStore';
import { areFormValuesEqual } from '../settingMapper';

/** 支持共享骨架的配置域（AppSetting 上六个面板对应的键） */
export type SettingsPanelConfigKey =
  | 'sdWebui'
  | 'webSearch'
  | 'tagAutocomplete'
  | 'tagRag'
  | 'forbiddenWords'
  | 'vector';

/** 面板 ref 四方法契约（M-1/UI-1 脏检测 + UI-3 统一重置 + M-9 失败回滚） */
export interface SettingsPanelRefHandle<T> {
  /** 取表单当前值并合并默认值（面板额外字段经 getExtraSaveValues 并入） */
  getFormValues: () => T;
  /** 当前表单值（+ 额外本地 state）与初始化快照是否不一致 */
  isDirty: () => boolean;
  /** 复位为默认配置（含 onResetExtras 的本地 state 复位） */
  resetFields: () => void;
  /** 从 store 当前 setting 重新初始化（保存失败回滚用） */
  refreshFromStore: () => void;
}

export interface UseSettingsPanelOptions<T extends object> {
  /** 配置域键（决定读写 setting 的哪个字段） */
  configKey: SettingsPanelConfigKey;
  /** 域默认值（shared/settingDefaults 常量，单一来源） */
  defaults: T;
  /** 脏状态变化上抛（驱动 Settings.tsx 保存按钮三态化） */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * 自定义初始值构造（默认 `{ ...defaults, ...saved }`）。
   * VectorConfigPanel 用：按 embeddingMode 选默认集 + 模型名迁移 + disabled 分支。
   */
  buildInitialValues?: (saved: Partial<T> | undefined) => T;
  /**
   * 重置值构造（默认 `{ ...defaults }`）。
   * VectorConfigPanel 用：重置固定回到 remote 模式默认集（含 embeddingMode 字段），
   * 而非跟随当前模式的 defaults。
   */
  buildResetValues?: () => T;
  /**
   * 额外保存字段（非表单字段的参与保存值，SDWebui 的 selectedLoras 由 setting 直传）。
   * 返回的对象并入 getFormValues 结果（优先级高于表单值）。
   */
  getExtraSaveValues?: (formValues: Partial<T>) => Partial<T>;
  /**
   * 从 getFormValues 结果中剔除的表单字段（Spec: L-2, IX-5）。
   * BlockedWords 的 dn_deAiEnabled / dn_samplingPresetEnabled 在表单内参与
   * 脏检测/重置，但属于 dialogueNaturalness 配置域（经 getDialogueNaturalnessValues
   * 单独通道保存），不能混入本面板的 forbiddenWords 域输出。
   */
  excludeSaveFields?: readonly string[];
  /**
   * 额外本地 state 脏检测（BlockedWords 的 categories / dialogueNaturalness）。
   * 返回 true 时整体判脏。
   */
  isExtraDirty?: () => boolean;
  /** resetFields 时的额外本地 state 复位（BlockedWords 复位 categories 等） */
  onResetExtras?: () => void;
  /** 每次初始化完成后的副作用（VectorConfigPanel 同步 activeEmbeddingMode） */
  onInitialized?: (initialValues: T) => void;
}

export interface UseSettingsPanelResult<T extends object> {
  form: FormInstance<T>;
  /** 四方法契约，面板侧包进 useImperativeHandle 暴露给父组件 */
  refHandle: SettingsPanelRefHandle<T>;
}

export function useSettingsPanel<T extends object>({
  configKey,
  defaults,
  onDirtyChange,
  buildInitialValues,
  buildResetValues,
  getExtraSaveValues,
  excludeSaveFields,
  isExtraDirty,
  onResetExtras,
  onInitialized,
}: UseSettingsPanelOptions<T>): UseSettingsPanelResult<T> {
  const [form] = Form.useForm<T>();
  const setting = useSettingStore(s => s.setting);

  // defaults / 回调经 ref 传递，避免面板侧传计算值（如 Vector 按模式取的默认集）
  // 时 hook 闭包读到过期值
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const buildInitialValuesRef = useRef(buildInitialValues);
  buildInitialValuesRef.current = buildInitialValues;
  const buildResetValuesRef = useRef(buildResetValues);
  buildResetValuesRef.current = buildResetValues;
  const getExtraSaveValuesRef = useRef(getExtraSaveValues);
  getExtraSaveValuesRef.current = getExtraSaveValues;
  const excludeSaveFieldsRef = useRef(excludeSaveFields);
  excludeSaveFieldsRef.current = excludeSaveFields;
  const isExtraDirtyRef = useRef(isExtraDirty);
  isExtraDirtyRef.current = isExtraDirty;
  const onResetExtrasRef = useRef(onResetExtras);
  onResetExtrasRef.current = onResetExtras;
  const onInitializedRef = useRef(onInitialized);
  onInitializedRef.current = onInitialized;

  // 初始化快照：保存三态化（M-1）的脏检测基准。
  // 保存成功（setting 更新 → effect 重跑）/ 失败回滚（refreshFromStore）/
  // 重置（resetFields）都会刷新快照，保证「未改动 ⇔ 与快照相等」。
  const initialValuesRef = useRef<Record<string, unknown> | null>(null);

  /** 从指定配置初始化表单并记录快照（setting 变化 effect 与 M-9 回滚共用） */
  const initializeFromSetting = useCallback((saved: Partial<T> | undefined) => {
    const initialValues = buildInitialValuesRef.current
      ? buildInitialValuesRef.current(saved)
      : { ...defaultsRef.current, ...(saved || {}) };
    form.setFieldsValue(initialValues);
    initialValuesRef.current = initialValues as unknown as Record<string, unknown>;
    onInitializedRef.current?.(initialValues);
  }, [form]);

  // setting 加载/变化时初始化（保存成功后 setting 更新，effect 自动刷新快照 → 脏状态清零）
  useEffect(() => {
    initializeFromSetting((setting?.[configKey] as Partial<T> | undefined) ?? undefined);
  }, [setting, configKey, initializeFromSetting]);

  // 全表单值监听，与快照比较得出脏状态并上抛（值比较覆盖 UI 驱动的 setFieldsValue 变更，
  // 规避 isFieldsTouched 保存后粘滞问题）
  const watchedValues = Form.useWatch([], form);
  const isDirtyNow = useMemo(() => {
    const snap = initialValuesRef.current;
    if (!snap || !watchedValues) return false;
    if (!areFormValuesEqual(watchedValues, snap)) return true;
    return isExtraDirtyRef.current?.() ?? false;
  }, [watchedValues]);
  useEffect(() => {
    onDirtyChange?.(isDirtyNow);
  }, [isDirtyNow, onDirtyChange]);

  const refHandle = useMemo<SettingsPanelRefHandle<T>>(() => ({
    getFormValues: () => {
      const values = form.getFieldsValue(true) as Partial<T>;
      const merged = {
        ...defaultsRef.current,
        ...values,
        ...(getExtraSaveValuesRef.current?.(values) ?? {}),
      } as Record<string, unknown>;
      // L-2/IX-5：剔除跨域表单字段（如 dn_* 属 dialogueNaturalness 域，
      // 经面板独立通道保存，不能混入本域输出污染 settings.json）
      for (const key of excludeSaveFieldsRef.current ?? []) {
        delete merged[key];
      }
      return merged as T;
    },
    isDirty: () => {
      const snap = initialValuesRef.current;
      if (!snap) return false;
      if (!areFormValuesEqual(form.getFieldsValue(true), snap)) return true;
      return isExtraDirtyRef.current?.() ?? false;
    },
    resetFields: () => {
      const resetValue = buildResetValuesRef.current
        ? buildResetValuesRef.current()
        : { ...defaultsRef.current };
      form.setFieldsValue(resetValue);
      initialValuesRef.current = resetValue as unknown as Record<string, unknown>;
      onResetExtrasRef.current?.();
    },
    refreshFromStore: () => {
      const s = useSettingStore.getState().setting as AppSetting | null;
      initializeFromSetting((s?.[configKey] as Partial<T> | undefined) ?? undefined);
    },
  }), [form, configKey, initializeFromSetting]);

  return { form, refHandle };
}
