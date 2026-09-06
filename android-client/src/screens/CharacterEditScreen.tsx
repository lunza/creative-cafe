/**
 * 角色卡编辑屏（Spec: add-mobile-character-card-editor / Task 3）
 *
 * 五分区顶部 Tab 表单（基本/设定/对话/高级/关系），响应式布局，亮暗主题适配。
 * 新建模式（characterId=null）与编辑模式共用。
 * 本地草稿自动暂存（Task 4），草稿横幅提示。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Text as RNText,
  Pressable,
  TextInput as RNTextInput,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  Appbar,
  TextInput,
  Button,
  Text,
  Chip,
  Switch,
  Dialog,
  Portal,
  SegmentedButtons,
  Snackbar,
  List,
  IconButton,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';
import {
  fetchCharacterCard,
  putCharacterCard,
  putCharacterAvatar,
  createCharacter,
  deleteCharacter,
  getWorldBookRelations,
  putWorldBookRelations,
  fetchWorldbooks,
} from '../api/client';
import type { CharacterCardEditData, CharacterWorldBookRelation, WorldBookSummary } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_KEY_PREFIX = '@creative_cafe/card_draft/';

type TabKey = 'basic' | 'settings' | 'dialogue' | 'advanced' | 'relations';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: '基本' },
  { key: 'settings', label: '设定' },
  { key: 'dialogue', label: '对话' },
  { key: 'advanced', label: '高级' },
  { key: 'relations', label: '关系' },
];

const DEFAULT_EDIT: CharacterCardEditData = {
  name: '', nickname: '', description: '', personality: '', scenario: '',
  first_mes: '', mes_example: '', creator_notes: '', creator: '',
  character_version: '', source: '', system_prompt: '', post_history_instructions: '',
  alternate_greetings: [], group_only_greetings: [], tags: [],
};

export function CharacterEditScreen() {
  const baseUrl = useAppStore(s => s.baseUrl)!;
  const characterId = useAppStore(s => s.editingCharacterId);
  const backToList = useAppStore(s => s.backToList);
  const themeMode = useAppStore(s => s.themeMode);
  const { palette } = themeOf(themeMode);
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { width: screenW } = useWindowDimensions();
  const isNew = characterId === null;

  // 表单状态
  const [form, setForm] = useState<CharacterCardEditData>({ ...DEFAULT_EDIT });
  const [relations, setRelations] = useState<CharacterWorldBookRelation[]>([]);
  const [worldbooks, setWorldbooks] = useState<WorldBookSummary[]>([]);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('basic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState<boolean>(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [newAltGreeting, setNewAltGreeting] = useState('');
  const [newGroupGreeting, setNewGroupGreeting] = useState('');

  const draftKey = isNew ? `${DRAFT_KEY_PREFIX}__new__` : `${DRAFT_KEY_PREFIX}${characterId}`;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 加载数据
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        if (!isNew && characterId) {
          const [card, rels, wbs] = await Promise.all([
            fetchCharacterCard(baseUrl, characterId),
            getWorldBookRelations(baseUrl, characterId),
            fetchWorldbooks(baseUrl),
          ]);
          setForm({ ...DEFAULT_EDIT, ...(card.data as CharacterCardEditData) });
          setRelations(rels);
          setWorldbooks(wbs);
          setAvatarUrl(`http://${baseUrl}/api/characters/${encodeURIComponent(characterId)}/avatar`);
        } else {
          const wbs = await fetchWorldbooks(baseUrl);
          setWorldbooks(wbs);
        }
        // 检查草稿
        const saved = await AsyncStorage.getItem(draftKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.form) setForm(prev => ({ ...prev, ...parsed.form }));
            if (parsed.relations) setRelations(parsed.relations);
            setDraftBanner(true);
          } catch { /* 草稿损坏忽略 */ }
        }
      } catch (err) {
        setSnack(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [baseUrl, characterId, isNew, draftKey]);

  // 自动存草稿（debounce 1s）
  const patchForm = useCallback((patch: Partial<CharacterCardEditData>): void => {
    setForm(prev => {
      const next = { ...prev, ...patch };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        AsyncStorage.setItem(draftKey, JSON.stringify({ form: next, relations })).catch(() => {});
      }, 1000);
      return next;
    });
  }, [draftKey, relations]);

  const patchRelations = useCallback((next: CharacterWorldBookRelation[]): void => {
    setRelations(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      AsyncStorage.setItem(draftKey, JSON.stringify({ form, relations: next })).catch(() => {});
    }, 1000);
  }, [draftKey, form]);

  const clearDraft = useCallback(() => {
    AsyncStorage.removeItem(draftKey).catch(() => {});
    setDraftBanner(false);
  }, [draftKey]);

  // 保存
  const doSave = useCallback(async () => {
    if (!form.name.trim()) {
      setSnack('角色名 name 不能为空');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        if (!avatarBase64) {
          setSnack('请先选择头像图片');
          setSaving(false);
          return;
        }
        const created = await createCharacter(baseUrl, avatarBase64, form);
        // 保存关系
        if (relations.length > 0) {
          await putWorldBookRelations(baseUrl, created.id, relations);
        }
        clearDraft();
        setSnack('新建成功');
        setTimeout(() => backToList(), 800);
      } else if (characterId) {
        await putCharacterCard(baseUrl, characterId, form);
        if (avatarBase64) {
          await putCharacterAvatar(baseUrl, characterId, avatarBase64);
        }
        await putWorldBookRelations(baseUrl, characterId, relations);
        clearDraft();
        setSnack('保存成功');
      }
    } catch (err) {
      setSnack(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [form, isNew, characterId, avatarBase64, baseUrl, relations, clearDraft, backToList]);

  // 删除
  const doDelete = useCallback(async () => {
    if (!characterId) return;
    setSaving(true);
    try {
      await deleteCharacter(baseUrl, characterId);
      clearDraft();
      setSnack('已删除');
      setTimeout(() => backToList(), 800);
    } catch (err) {
      setSnack(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
      setDeleteConfirm(false);
    }
  }, [characterId, baseUrl, clearDraft, backToList]);

  // 选图
  const pickImage = useCallback(async () => {
    try {
      const { launchImageLibrary } = require('react-native-image-picker');
      const result = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, includeBase64: true });
      if (result.didCancel) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        setSnack('无法读取图片数据，请重试');
        return;
      }
      setAvatarBase64(asset.base64);
      setAvatarUrl(`data:${asset.type || 'image/jpeg'};base64,${asset.base64}`);
    } catch (err) {
      setSnack(`选图失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Appbar.Header style={styles.appbar}>
          <Appbar.BackAction onPress={backToList} color={palette.onAppbar} />
          <Appbar.Content title={isNew ? '新建角色' : '编辑角色'} titleStyle={styles.appbarTitle} />
        </Appbar.Header>
        <View style={styles.center}>
          <ActivityIndicator animating color={palette.primary} />
          <Text style={styles.centerText}>加载中…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isCompact = screenW < 380;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.BackAction onPress={backToList} color={palette.onAppbar} />
        <Appbar.Content title={isNew ? '新建角色' : '编辑角色'} titleStyle={styles.appbarTitle} />
        {!isNew && (
          <Appbar.Action icon="delete" color={palette.onAppbar} onPress={() => setDeleteConfirm(true)} />
        )}
        <Button
          mode="contained"
          onPress={doSave}
          loading={saving}
          disabled={saving}
          style={styles.saveBtn}
          labelStyle={styles.saveBtnLabel}
        >
          保存
        </Button>
      </Appbar.Header>

      {/* 草稿横幅 */}
      {draftBanner && (
        <View style={styles.draftBanner}>
          <RNText style={styles.draftBannerText}>检测到本地草稿</RNText>
          <Pressable onPress={clearDraft}>
            <RNText style={styles.draftBannerAction}>放弃</RNText>
          </Pressable>
        </View>
      )}

      {/* Tab 分区 */}
      <SegmentedButtons
        value={tab}
        onValueChange={v => setTab(v as TabKey)}
        buttons={TABS.map(t => ({ value: t.key, label: t.label }))}
        style={styles.tabs}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {tab === 'basic' && renderBasic(form, patchForm, avatarUrl, pickImage, palette, styles)}
        {tab === 'settings' && renderSettings(form, patchForm, palette, styles)}
        {tab === 'dialogue' && renderDialogue(form, patchForm, newAltGreeting, setNewAltGreeting, newGroupGreeting, setNewGroupGreeting, palette, styles)}
        {tab === 'advanced' && renderAdvanced(form, patchForm, palette, styles)}
        {tab === 'relations' && renderRelations(relations, patchRelations, worldbooks, palette, styles)}
      </ScrollView>

      {/* 删除确认 */}
      <Portal>
        <Dialog visible={deleteConfirm} onDismiss={() => setDeleteConfirm(false)}>
          <Dialog.Title>确认删除</Dialog.Title>
          <Dialog.Content>
            <Text>删除后角色卡将从电脑和所有设备上移除，历史对话不受影响。确定删除「{form.name}」？</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteConfirm(false)}>取消</Button>
            <Button onPress={doDelete} loading={saving} textColor={palette.error}>删除</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={snack !== null}
        onDismiss={() => setSnack(null)}
        duration={3000}
        action={{ label: '关闭', onPress: () => setSnack(null) }}
      >
        {snack}
      </Snackbar>
    </SafeAreaView>
  );
}

// ==================== 分区渲染函数 ====================

function renderBasic(
  form: CharacterCardEditData,
  patch: (p: Partial<CharacterCardEditData>) => void,
  avatarUrl: string | null,
  pickImage: () => void,
  palette: Palette,
  styles: ReturnType<typeof createStyles>,
) {
  return (
    <View>
      {/* 头像 */}
      <View style={styles.avatarSection}>
        <Pressable onPress={pickImage} style={styles.avatarWrap}>
          {avatarUrl ? (
            <View style={styles.avatarPreview}>
              <RNText style={styles.avatarText}>点击更换</RNText>
            </View>
          ) : (
            <View style={styles.avatarPlaceholder}>
              <RNText style={styles.avatarPlaceholderText}>+</RNText>
              <RNText style={styles.avatarPlaceholderLabel}>选择头像</RNText>
            </View>
          )}
        </Pressable>
      </View>
      {/* 提示：头像仍存在于 Picker 后 */}
      {!avatarUrl && (
        <RNText style={{ color: palette.onSurfaceVariant, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
          载入中或未设置头像
        </RNText>
      )}
      <TextInput mode="outlined" label="* 角色名" value={form.name} onChangeText={v => patch({ name: v })} style={styles.field} />
      <TextInput mode="outlined" label="昵称" value={form.nickname} onChangeText={v => patch({ nickname: v })} style={styles.field} />
      <TextInput mode="outlined" label="作者" value={form.creator} onChangeText={v => patch({ creator: v })} style={styles.field} />
      <TextInput mode="outlined" label="角色版本" value={form.character_version} onChangeText={v => patch({ character_version: v })} style={styles.field} />
      <TextInput mode="outlined" label="来源" value={form.source} onChangeText={v => patch({ source: v })} style={styles.field} />
      {/* Tags */}
      <Text style={styles.fieldLabel}>标签</Text>
      <View style={styles.tagsWrap}>
        {(form.tags || []).map((t, i) => (
          <Chip key={`tag-${i}`} onClose={() => patch({ tags: form.tags.filter((_, j) => j !== i) })} style={styles.tag}>
            {t}
          </Chip>
        ))}
      </View>
      <TextInput
        mode="outlined"
        label="添加标签（回车确认）"
        placeholder="输入标签后回车"
        onSubmitEditing={e => {
          const v = e.nativeEvent.text.trim();
          if (v && !form.tags.includes(v)) patch({ tags: [...form.tags, v] });
          (e.target as any)?.clear?.();
        }}
        style={styles.field}
      />
    </View>
  );
}

function renderSettings(
  form: CharacterCardEditData,
  patch: (p: Partial<CharacterCardEditData>) => void,
  palette: Palette,
  styles: ReturnType<typeof createStyles>,
) {
  return (
    <View>
      <Text style={styles.sectionTitle}>背景故事</Text>
      <TextInput mode="outlined" label="描述" value={form.description} onChangeText={v => patch({ description: v })} multiline style={styles.fieldLarge} />
      <Text style={styles.sectionTitle}>角色设定</Text>
      <TextInput mode="outlined" label="性格" value={form.personality} onChangeText={v => patch({ personality: v })} multiline style={styles.fieldLarge} />
      <TextInput mode="outlined" label="场景" value={form.scenario} onChangeText={v => patch({ scenario: v })} multiline style={styles.fieldLarge} />
    </View>
  );
}

function renderDialogue(
  form: CharacterCardEditData,
  patch: (p: Partial<CharacterCardEditData>) => void,
  newAlt: string,
  setNewAlt: (v: string) => void,
  newGroup: string,
  setNewGroup: (v: string) => void,
  palette: Palette,
  styles: ReturnType<typeof createStyles>,
) {
  const removeAlt = (idx: number) =>
    patch({ alternate_greetings: (form.alternate_greetings || []).filter((_, j) => j !== idx) });
  const removeGroup = (idx: number) =>
    patch({ group_only_greetings: (form.group_only_greetings || []).filter((_, j) => j !== idx) });
  return (
    <View>
      <Text style={styles.sectionTitle}>开场白</Text>
      <TextInput mode="outlined" label="first_mes" value={form.first_mes} onChangeText={v => patch({ first_mes: v })} multiline style={styles.fieldLarge} />

      <Text style={styles.sectionTitle}>备选开场白</Text>
      {(form.alternate_greetings || []).map((g: string, i: number) => (
        <View key={`alt-${i}`} style={styles.listItemRow}>
          <RNText style={styles.listItemText} numberOfLines={2}>{g}</RNText>
          <IconButton icon="close" size={18} onPress={() => removeAlt(i)} />
        </View>
      ))}
      <TextInput mode="outlined" label="添加备选开场白" value={newAlt} onChangeText={setNewAlt}
        onSubmitEditing={() => {
          if (newAlt.trim()) { patch({ alternate_greetings: [...(form.alternate_greetings || []), newAlt.trim()] }); setNewAlt(''); }
        }}
        style={styles.field}
      />

      <Text style={styles.sectionTitle}>群聊开场白</Text>
      {(form.group_only_greetings || []).map((g: string, i: number) => (
        <View key={`grp-${i}`} style={styles.listItemRow}>
          <RNText style={styles.listItemText} numberOfLines={2}>{g}</RNText>
          <IconButton icon="close" size={18} onPress={() => removeGroup(i)} />
        </View>
      ))}
      <TextInput mode="outlined" label="添加群聊开场白" value={newGroup} onChangeText={setNewGroup}
        onSubmitEditing={() => {
          if (newGroup.trim()) { patch({ group_only_greetings: [...(form.group_only_greetings || []), newGroup.trim()] }); setNewGroup(''); }
        }}
        style={styles.field}
      />

      <Text style={styles.sectionTitle}>对话示例</Text>
      <TextInput mode="outlined" label="mes_example" value={form.mes_example} onChangeText={v => patch({ mes_example: v })} multiline style={styles.fieldLarge} />
    </View>
  );
}

function renderAdvanced(
  form: CharacterCardEditData,
  patch: (p: Partial<CharacterCardEditData>) => void,
  palette: Palette,
  styles: ReturnType<typeof createStyles>,
) {
  return (
    <View>
      <Text style={styles.sectionTitle}>系统提示词</Text>
      <TextInput mode="outlined" label="system_prompt" value={form.system_prompt} onChangeText={v => patch({ system_prompt: v })} multiline style={styles.fieldLarge} />
      <Text style={styles.sectionTitle}>对话后指令</Text>
      <TextInput mode="outlined" label="post_history_instructions" value={form.post_history_instructions} onChangeText={v => patch({ post_history_instructions: v })} multiline style={styles.fieldLarge} />
      <Text style={styles.sectionTitle}>作者备注</Text>
      <TextInput mode="outlined" label="creator_notes" value={form.creator_notes} onChangeText={v => patch({ creator_notes: v })} multiline style={styles.fieldLarge} />
    </View>
  );
}

function renderRelations(
  relations: CharacterWorldBookRelation[],
  patchRelations: (r: CharacterWorldBookRelation[]) => void,
  worldbooks: WorldBookSummary[],
  palette: Palette,
  styles: ReturnType<typeof createStyles>,
) {
  return (
    <View>
      <Text style={styles.sectionTitle}>世界书绑定</Text>
      {relations.length === 0 && (
        <RNText style={styles.emptyText}>暂未绑定世界书，点击下方按钮添加</RNText>
      )}
      {relations.map((r: CharacterWorldBookRelation, i: number) => (
        <View key={`rel-${i}`} style={styles.relationCard}>
          <View style={styles.relationHeader}>
            <RNText style={styles.relationName} numberOfLines={1}>{r.worldBookPath.split(/[\\/]/).pop() || r.worldBookPath}</RNText>
            <IconButton icon="close" size={18} onPress={() => patchRelations(relations.filter((_, j) => j !== i))} />
          </View>
          <View style={styles.relationRow}>
            <RNText style={styles.relationLabel}>启用</RNText>
            <Switch value={r.enabled} onValueChange={v => {
              const next = [...relations];
              next[i] = { ...next[i], enabled: v };
              patchRelations(next);
            }} />
          </View>
          <View style={styles.relationRow}>
            <RNText style={styles.relationLabel}>优先级（0-100）</RNText>
            <TextInput
              mode="outlined"
              dense
              value={String(r.priority)}
              keyboardType="numeric"
              onChangeText={v => {
                const n = parseInt(v, 10);
                if (!isNaN(n) && n >= 0 && n <= 100) {
                  const next = [...relations];
                  next[i] = { ...next[i], priority: n };
                  patchRelations(next);
                }
              }}
              style={styles.relationPriorityInput}
            />
          </View>
        </View>
      ))}
      {/* 添加关系按钮 */}
      {worldbooks.length > 0 && (
        <Button
          mode="outlined"
          icon="plus"
          onPress={() => {
            const unbound = worldbooks.filter(
              (wb: WorldBookSummary) => !relations.some(r => r.worldBookPath === wb.path)
            );
            if (unbound.length === 0) {
              Alert.alert('提示', '所有世界书已绑定');
              return;
            }
            // 简单：直接绑定第一个未绑定的
            const wb = unbound[0];
            patchRelations([...relations, { worldBookPath: wb.path, enabled: true, priority: 5 }]);
          }}
          style={styles.addRelationBtn}
        >
          添加世界书绑定
        </Button>
      )}
    </View>
  );
}

// ==================== 样式 ====================

function createStyles(p: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: p.background },
    appbar: {
      backgroundColor: p.appbar,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    appbarTitle: { color: p.onAppbar, fontWeight: '700' },
    saveBtn: { marginRight: 4, borderRadius: 20 },
    saveBtnLabel: { fontSize: 13, marginHorizontal: 4 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    centerText: { color: p.onSurfaceVariant },
    draftBanner: {
      backgroundColor: p.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    draftBannerText: { color: p.onPrimary, fontSize: 13 },
    draftBannerAction: { color: p.onPrimary, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
    tabs: { marginHorizontal: 12, marginVertical: 8 },
    scroll: { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: 40 },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: p.onSurface, marginTop: 16, marginBottom: 4 },
    field: { marginBottom: 10 },
    fieldLarge: { marginBottom: 10, minHeight: 100 },
    fieldLabel: { fontSize: 13, color: p.onSurfaceVariant, marginBottom: 4 },
    tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    tag: { backgroundColor: p.surfaceVariant },
    avatarSection: { alignItems: 'center', marginBottom: 16 },
    avatarWrap: { borderRadius: 60, overflow: 'hidden', width: 100, height: 100, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
    avatarPreview: { width: 100, height: 100, backgroundColor: p.surfaceVariant, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: p.outline, borderRadius: 60 },
    avatarText: { color: p.primary, fontSize: 12 },
    avatarPlaceholder: { width: 100, height: 100, backgroundColor: p.surfaceVariant, alignItems: 'center', justifyContent: 'center', borderRadius: 60, borderWidth: 2, borderColor: p.outline, borderStyle: 'dashed' },
    avatarPlaceholderText: { color: p.primary, fontSize: 28, fontWeight: '600' },
    avatarPlaceholderLabel: { color: p.primary, fontSize: 10, marginTop: 2 },
    listItemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: p.surface, borderRadius: 12, paddingLeft: 8, marginBottom: 4 },
    listItemText: { flex: 1, fontSize: 13, color: p.onSurface },
    emptyText: { color: p.onSurfaceVariant, fontSize: 13, textAlign: 'center', padding: 16 },
    relationCard: { backgroundColor: p.glassBg, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: p.outline, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    relationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    relationName: { fontSize: 13, fontWeight: '600', color: p.onSurface, flex: 1 },
    relationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
    relationLabel: { fontSize: 13, color: p.onSurfaceVariant },
    relationPriorityInput: { width: 80, height: 36 },
    addRelationBtn: { marginTop: 8, borderRadius: 18 },
  });
}