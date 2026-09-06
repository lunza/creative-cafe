/**
 * 会话配置底部弹层（Spec: fix-android-chat-feature-parity / Task 7）
 *
 * 人设选择 / AI 参数 / 知识库绑定 / 记忆表格开关 / 图片生成参数。
 * V3 新增：思考内容处理三态 / 辅助模式开关 / 防重复强度三档预设；亮暗主题适配。
 * 全部数据经服务端 API 读写，客户端不落任何功能配置（仅草稿态在内存）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Image as RNImage,
  Text as RNText,
  Pressable,
  type StyleProp,
  type TextInputProps,
} from 'react-native';
import {
  Portal,
  Modal,
  Text,
  TextInput,
  Switch,
  Button,
  ActivityIndicator,
  Chip,
  Divider,
  SegmentedButtons,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApiError,
  assetUrl,
  fetchKnowledgeScopes,
  fetchPersonas,
  getSessionConfig,
  putSessionConfig,
} from '../api/client';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';
import type {
  KnowledgeScope,
  PersonaSummary,
  SessionConfig,
  SessionCustomParameters,
} from '../types';
import { ANTI_REPEAT_PRESETS } from '../types';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  baseUrl: string;
  characterId: string;
  /** 保存成功回调（携带最新配置，供对话页即时生效提示等） */
  onSaved?: (config: SessionConfig) => void;
}

/** 数值输入框的字符串草稿（空串 = 未设置，沿用引擎级配置） */
function NumberField({
  label,
  value,
  onChange,
  keyboardType = 'decimal-pad',
  hint,
  style,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  keyboardType?: 'decimal-pad' | 'numeric';
  hint?: string;
  style?: StyleProp<TextInputProps['style']>;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <TextInput
      mode="outlined"
      dense
      label={label}
      placeholder={hint || '未设置（沿用引擎配置）'}
      keyboardType={keyboardType}
      value={text}
      onChangeText={t => {
        setText(t);
        if (t.trim() === '') {
          onChange(undefined);
        } else {
          const n = Number(t);
          if (!isNaN(n)) onChange(n);
        }
      }}
      style={style}
    />
  );
}

export function SessionConfigSheet({ visible, onDismiss, baseUrl, characterId, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const themeMode = useAppStore(s => s.themeMode);
  const { palette } = themeOf(themeMode);
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [scopes, setScopes] = useState<KnowledgeScope[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [cp, setCp] = useState<SessionCustomParameters>({});
  const [memoryTableEnabled, setMemoryTableEnabled] = useState(false);
  const [boundIds, setBoundIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [config, personaList, scopeList] = await Promise.all([
        getSessionConfig(baseUrl, characterId),
        fetchPersonas(baseUrl).catch(() => [] as PersonaSummary[]),
        fetchKnowledgeScopes(baseUrl).catch(() => [] as KnowledgeScope[]),
      ]);
      setPersonas(personaList);
      setScopes(scopeList);
      setSelectedPersonaId(config.selectedPersonaId);
      setCp(config.customParameters || {});
      setMemoryTableEnabled(config.memoryTableEnabled === true);
      setBoundIds(config.boundKnowledgeBaseIds || []);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setLoadError(e ? e.message : `配置加载失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, characterId]);

  useEffect(() => {
    if (visible) {
      setSaved(false);
      setSaveError(null);
      load();
    }
  }, [visible, load]);

  const patchCp = (patch: Partial<SessionCustomParameters>) => {
    setCp(prev => ({ ...prev, ...patch }));
  };

  const toggleScope = (id: string) => {
    setBoundIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const doSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const config = await putSessionConfig(baseUrl, characterId, {
        selectedPersonaId,
        customParameters: cp,
        memoryTableEnabled,
        boundKnowledgeBaseIds: boundIds,
      });
      setSaved(true);
      onSaved?.(config);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setSaveError(e ? e.message : `保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [baseUrl, characterId, selectedPersonaId, cp, memoryTableEnabled, boundIds, onSaved]);

  const selectedPersona = useMemo(
    () => personas.find(p => p.id === selectedPersonaId) || null,
    [personas, selectedPersonaId],
  );

  /** 防重复预设当前选中档：freq/pres/dry 三值与某档完全一致时高亮，否则不选 */
  const antiRepeatKey = useMemo(() => {
    const freq = cp.frequency_penalty;
    const pres = cp.presence_penalty;
    const dry = cp.dry_multiplier;
    const hit = ANTI_REPEAT_PRESETS.find(
      p =>
        p.values.frequency_penalty === freq &&
        p.values.presence_penalty === pres &&
        p.values.dry_multiplier === dry,
    );
    return hit ? hit.key : '';
  }, [cp.frequency_penalty, cp.presence_penalty, cp.dry_multiplier]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            会话配置
          </Text>
          <Button mode="text" compact onPress={onDismiss} labelStyle={styles.closeLabel}>
            关闭
          </Button>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator animating />
            <Text style={styles.centerText}>正在加载配置…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button mode="contained-tonal" onPress={load}>
              重新加载
            </Button>
          </View>
        ) : (
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* ===== 用户人设 ===== */}
            <Text variant="titleSmall" style={styles.sectionTitle}>
              用户人设
            </Text>
            <Pressable
              style={[styles.personaRow, !selectedPersonaId && styles.personaRowActive]}
              onPress={() => setSelectedPersonaId(null)}
            >
              <View style={styles.personaAvatarPlaceholder}>
                <RNText style={styles.personaAvatarPlaceholderText}>无</RNText>
              </View>
              <View style={styles.personaInfo}>
                <RNText style={styles.personaName}>不使用人设（默认 User）</RNText>
              </View>
            </Pressable>
            {personas.map(p => {
              const active = selectedPersonaId === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.personaRow, active && styles.personaRowActive]}
                  onPress={() => setSelectedPersonaId(p.id)}
                >
                  {p.avatarUrl ? (
                    <RNImage
                      source={{ uri: assetUrl(baseUrl, p.avatarUrl) }}
                      style={styles.personaAvatar}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.personaAvatarPlaceholder}>
                      <RNText style={styles.personaAvatarPlaceholderText}>
                        {p.name.slice(0, 1)}
                      </RNText>
                    </View>
                  )}
                  <View style={styles.personaInfo}>
                    <RNText style={styles.personaName} numberOfLines={1}>
                      {p.name}
                      {active ? ' ✓' : ''}
                    </RNText>
                    {p.description ? (
                      <RNText style={styles.personaDesc} numberOfLines={2}>
                        {p.description}
                      </RNText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            {selectedPersona && (
              <RNText style={styles.hint}>
                当前选择：{selectedPersona.name}（对话中 {'{{user}}'} 指向该人设）
              </RNText>
            )}

            <Divider style={styles.divider} />

            {/* ===== AI 参数 ===== */}
            <Text variant="titleSmall" style={styles.sectionTitle}>
              AI 参数
            </Text>
            <View style={styles.fieldRow}>
              <NumberField
                label="温度 temperature"
                value={cp.temperature}
                onChange={v => patchCp({ temperature: v })}
                style={styles.field}
              />
              <NumberField
                label="top_p"
                value={cp.top_p}
                onChange={v => patchCp({ top_p: v })}
                style={styles.field}
              />
            </View>
            <View style={styles.fieldRow}>
              <NumberField
                label="max_tokens"
                value={cp.max_tokens}
                onChange={v => patchCp({ max_tokens: v })}
                keyboardType="numeric"
                style={styles.field}
              />
              <NumberField
                label="回复字数下限"
                value={cp.min_response_chars}
                onChange={v => patchCp({ min_response_chars: v })}
                keyboardType="numeric"
                style={styles.field}
              />
            </View>
            <Text variant="bodySmall" style={styles.fieldLabel}>
              回复语言
            </Text>
            <SegmentedButtons
              value={cp.language || 'zh'}
              onValueChange={v => patchCp({ language: v as SessionCustomParameters['language'] })}
              buttons={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
                { value: 'ja', label: '日本語' },
              ]}
              density="regular"
              style={styles.segment}
            />
            <Text variant="bodySmall" style={styles.fieldLabel}>
              思考内容处理
            </Text>
            <SegmentedButtons
              value={cp.think_tag_mode || 'strip'}
              onValueChange={v => patchCp({ think_tag_mode: v as SessionCustomParameters['think_tag_mode'] })}
              buttons={[
                { value: 'strip', label: '不显示' },
                { value: 'strip_render', label: '仅保留记录' },
                { value: 'fold', label: '可折叠查看' },
              ]}
              density="regular"
              style={styles.segment}
            />
            <RNText style={styles.switchDesc}>
              不显示=彻底剥离思考；仅保留记录=消息中保留但气泡内隐藏；可折叠查看=气泡内折叠展示思考过程
            </RNText>
            <Text variant="bodySmall" style={styles.fieldLabel}>
              防重复强度
            </Text>
            <SegmentedButtons
              value={antiRepeatKey}
              onValueChange={v => {
                const preset = ANTI_REPEAT_PRESETS.find(p => p.key === v);
                if (preset) {
                  patchCp({
                    frequency_penalty: preset.values.frequency_penalty,
                    presence_penalty: preset.values.presence_penalty,
                    dry_multiplier: preset.values.dry_multiplier,
                  });
                }
              }}
              buttons={ANTI_REPEAT_PRESETS.map(p => ({ value: p.key, label: p.label }))}
              density="regular"
              style={styles.segment}
            />
            <RNText style={styles.switchDesc}>
              宽松=关闭防重复；标准=轻微惩罚（推荐）；严格=强惩罚（可能缩短回复）
            </RNText>
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <RNText style={styles.switchTitle}>表情立绘显示</RNText>
                <RNText style={styles.switchDesc}>关闭后不解析情绪、不注入表情提示</RNText>
              </View>
              <Switch
                value={cp.expression_display !== false}
                onValueChange={v => patchCp({ expression_display: v })}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <RNText style={styles.switchTitle}>辅助模式</RNText>
                <RNText style={styles.switchDesc}>
                  AI 在回复末尾生成 3 个推荐选项，点击填入输入框，可编辑后发送
                </RNText>
              </View>
              <Switch
                value={cp.assist_mode === true}
                onValueChange={v => patchCp({ assist_mode: v })}
              />
            </View>

            <Divider style={styles.divider} />

            {/* ===== 图片生成 ===== */}
            <Text variant="titleSmall" style={styles.sectionTitle}>
              对话图片生成
            </Text>
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <RNText style={styles.switchTitle}>启用图片生成入口</RNText>
                <RNText style={styles.switchDesc}>在 AI 消息气泡下方显示「生成图片」按钮</RNText>
              </View>
              <Switch
                value={cp.image_gen_enabled === true}
                onValueChange={v => patchCp({ image_gen_enabled: v })}
              />
            </View>
            <View style={styles.fieldRow}>
              <NumberField
                label="宽度 px"
                value={cp.image_gen_width}
                onChange={v => patchCp({ image_gen_width: v })}
                keyboardType="numeric"
                hint="默认 1024"
                style={styles.field}
              />
              <NumberField
                label="高度 px"
                value={cp.image_gen_height}
                onChange={v => patchCp({ image_gen_height: v })}
                keyboardType="numeric"
                hint="默认 1024"
                style={styles.field}
              />
            </View>
            <NumberField
              label="互动元素权重 (1.0-2.0)"
              value={cp.interaction_weight}
              onChange={v => patchCp({ interaction_weight: v })}
              hint="默认 1.2"
              style={styles.field}
            />

            <Divider style={styles.divider} />

            {/* ===== 知识库绑定 ===== */}
            <Text variant="titleSmall" style={styles.sectionTitle}>
              知识库绑定（检索注入）
            </Text>
            {scopes.length === 0 ? (
              <RNText style={styles.hint}>
                暂无已向量化的知识库（可在桌面端知识库中向量化后绑定）
              </RNText>
            ) : (
              <View style={styles.chipWrap}>
                {scopes.map(s => (
                  <Chip
                    key={s.id}
                    selected={boundIds.includes(s.id)}
                    onPress={() => toggleScope(s.id)}
                    style={styles.chip}
                    compact
                  >
                    {s.label}
                  </Chip>
                ))}
              </View>
            )}

            <Divider style={styles.divider} />

            {/* ===== 记忆表格 ===== */}
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <RNText style={styles.switchTitle}>记忆表格</RNText>
                <RNText style={styles.switchDesc}>
                  注入表格数据并允许 AI 编辑（可在顶栏表格入口查看）
                </RNText>
              </View>
              <Switch value={memoryTableEnabled} onValueChange={setMemoryTableEnabled} />
            </View>

            {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
            {saved ? <Text style={styles.savedText}>已保存 ✓</Text> : null}

            <Button
              mode="contained"
              onPress={doSave}
              loading={saving}
              disabled={saving}
              style={styles.saveBtn}
            >
              保存配置
            </Button>
          </ScrollView>
        )}
      </Modal>
    </Portal>
  );
}

function createStyles(p: Palette) {
  return StyleSheet.create({
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '85%',
      backgroundColor: p.glassBg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 8,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -4 },
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    title: { fontWeight: '700', color: p.onSurface },
    closeLabel: { color: p.primary },
    body: { paddingHorizontal: 16 },
    center: { alignItems: 'center', padding: 24, gap: 10 },
    centerText: { color: p.onSurfaceVariant },
    errorText: { color: p.error, marginVertical: 8, lineHeight: 20 },
    savedText: { color: p.success, marginTop: 8 },

    sectionTitle: { color: p.primary, marginTop: 14, marginBottom: 6, fontWeight: '700' },
    divider: { marginTop: 16 },

    personaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      borderRadius: 12,
      marginBottom: 4,
    },
    personaRowActive: { backgroundColor: p.surfaceVariant },
    personaAvatar: { width: 40, height: 40, borderRadius: 20 },
    personaAvatarPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: p.surfaceVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    personaAvatarPlaceholderText: { color: p.primary, fontSize: 14, fontWeight: '700' },
    personaInfo: { flex: 1, marginLeft: 10 },
    personaName: { color: p.onSurface, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    personaDesc: { color: p.onSurfaceVariant, fontSize: 12, marginTop: 2, flexShrink: 1 },

    fieldRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    field: { flex: 1, backgroundColor: p.surface },
    fieldLabel: { color: p.onSurfaceVariant, marginBottom: 4 },
    segment: { marginBottom: 4 },

    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    switchTextWrap: { flex: 1, marginRight: 12 },
    switchTitle: { color: p.onSurface, fontSize: 15 },
    switchDesc: { color: p.onSurfaceVariant, fontSize: 12, marginTop: 2 },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { backgroundColor: p.surfaceVariant },

    hint: { color: p.onSurfaceVariant, fontSize: 12, marginTop: 6, lineHeight: 18 },
    saveBtn: { marginTop: 16, marginBottom: 8, backgroundColor: p.primary },
  });
}
