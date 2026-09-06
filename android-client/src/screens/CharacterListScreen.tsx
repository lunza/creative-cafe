/**
 * 角色列表页（Spec: add-android-chat-client / R4）
 * Material 3 角色卡列表：头像/名称/描述摘要/tags、名称与 tags 即时搜索、下拉刷新、空态提示。
 * V3：主题切换按钮 + 亮/暗主题适配。
 * V6：收藏功能 + 排序对齐 PC 端（CharacterSelectorPanel）——收藏置顶（组内保持服务端
 *     返回顺序），非收藏在后；搜索先过滤再分组；收藏经服务端持久化与 PC 端数据互通。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {
  Appbar,
  Searchbar,
  Card,
  Text,
  Chip,
  ActivityIndicator,
  Button,
  Avatar,
  IconButton,
  FAB,
  Dialog,
  Portal,
  Snackbar,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  assetUrl,
  fetchCharacters,
  fetchFavorites,
  saveFavorites,
  deleteCharacter,
  type FavoriteItem,
} from '../api/client';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';
import type { CharacterSummary } from '../types';

export function CharacterListScreen() {
  const baseUrl = useAppStore(s => s.baseUrl)!;
  const disconnect = useAppStore(s => s.disconnect);
  const openChat = useAppStore(s => s.openChat);
  const openCardEditor = useAppStore(s => s.openCardEditor);
  const themeMode = useAppStore(s => s.themeMode);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const { palette } = themeOf(themeMode);

  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CharacterSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  const styles = useMemo(() => createStyles(palette), [palette]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        // 并行拉取角色列表与收藏（收藏失败不阻断列表：收藏为空仅影响置顶）
        const [list, favs] = await Promise.all([
          fetchCharacters(baseUrl),
          fetchFavorites(baseUrl).catch(() => [] as FavoriteItem[]),
        ]);
        setCharacters(list);
        setFavorites(favs);
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        setError(e ? e.message : `加载失败：${String(err)}`);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [baseUrl]
  );

  useEffect(() => {
    load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const favoriteNames = useMemo(
    () => new Set(favorites.map(f => f.fileName)),
    [favorites]
  );

  /**
   * 排序对齐 PC 端 CharacterSelectorPanel.sortedCharacters：
   * 先按搜索词过滤 → 收藏在前（组内保持服务端返回顺序）→ 非收藏在后（原顺序）。
   */
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? characters.filter(
          c =>
            c.name.toLowerCase().includes(q) ||
            c.tags.some(t => String(t).toLowerCase().includes(q))
        )
      : characters;
    if (favoriteNames.size === 0) return filtered;
    const favs = filtered.filter(c => favoriteNames.has(c.id));
    const rest = filtered.filter(c => !favoriteNames.has(c.id));
    return [...favs, ...rest];
  }, [characters, query, favoriteNames]);

  /** 收藏切换：乐观更新 + 全量 PUT（与 PC 端共用服务端持久化） */
  const toggleFavorite = useCallback(
    (item: CharacterSummary) => {
      const isFav = favoriteNames.has(item.id);
      const next: FavoriteItem[] = isFav
        ? favorites.filter(f => f.fileName !== item.id)
        : [...favorites, { fileName: item.id, addedAt: Date.now() }];
      setFavorites(next);
      setSnack(isFav ? '已取消收藏' : `已收藏「${item.name || item.fileName}」`);
      saveFavorites(baseUrl, next).catch(() => {
        // 保存失败回滚本地状态并提示（下次刷新以服务端为准）
        setFavorites(favorites);
        setSnack('收藏保存失败，请检查服务端连接');
      });
    },
    [baseUrl, favorites, favoriteNames]
  );

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCharacter(baseUrl, deleteTarget.id);
      setCharacters(prev => prev.filter(c => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(e ? `删除失败：${e.message}` : `删除失败：${String(err)}`);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [baseUrl, deleteTarget]);

  const renderItem = ({ item }: { item: CharacterSummary }) => {
    const isFav = favoriteNames.has(item.id);
    return (
      <TouchableOpacity onPress={() => openChat(item)} activeOpacity={0.7}>
        <Card style={styles.card} mode="elevated">
          <Card.Title
            title={item.name || item.fileName}
            titleStyle={styles.cardTitle}
            subtitle={item.description ? undefined : '暂无简介'}
            subtitleNumberOfLines={1}
            left={props => (
              <Avatar.Image
                {...props}
                size={48}
                source={{ uri: assetUrl(baseUrl, item.avatarUrl) }}
                style={styles.avatar}
              />
            )}
            right={props => (
              <View style={styles.cardActions}>
                <IconButton
                  icon={isFav ? 'heart' : 'heart-outline'}
                  size={18}
                  onPress={() => toggleFavorite(item)}
                  iconColor={isFav ? '#EC4899' : palette.onSurfaceVariant}
                />
                <IconButton
                  icon="pencil"
                  size={18}
                  onPress={() => openCardEditor(item.id)}
                  iconColor={palette.onSurfaceVariant}
                />
                <IconButton
                  icon="delete-outline"
                  size={18}
                  onPress={() => setDeleteTarget(item)}
                  iconColor={palette.error}
                />
              </View>
            )}
          />
          {item.description ? (
            <Card.Content>
              <Text variant="bodySmall" numberOfLines={2} style={styles.desc}>
                {item.description}
              </Text>
            </Card.Content>
          ) : null}
          {item.tags.length > 0 && (
            <Card.Content style={styles.tagRow}>
              {item.tags.slice(0, 4).map(t => (
                <Chip key={t} compact style={styles.tag} textStyle={styles.tagText}>
                  {t}
                </Chip>
              ))}
              {item.tags.length > 4 && (
                <Text variant="labelSmall" style={styles.tagMore}>
                  +{item.tags.length - 4}
                </Text>
              )}
            </Card.Content>
          )}
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="角色列表" titleStyle={styles.appbarTitle} />
        <Appbar.Action
          icon={themeMode === 'dark' ? 'white-balance-sunny' : 'weather-night'}
          onPress={toggleTheme}
        />
        <Appbar.Action icon="link-off" onPress={disconnect} />
      </Appbar.Header>

      <View style={styles.searchWrap}>
        <Searchbar
          placeholder="搜索名称或标签"
          value={query}
          onChangeText={setQuery}
          style={styles.search}
          elevation={1}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator animating size="large" />
          <Text style={styles.centerText}>正在同步角色卡…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button mode="contained-tonal" onPress={() => load('refresh')} style={styles.retryBtn}>
            重新加载
          </Button>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={palette.primary}
              colors={[palette.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.centerText}>
                {query ? `没有匹配“${query}”的角色` : '服务端暂无角色卡，请先在桌面端导入'}
              </Text>
            </View>
          }
        />
      )}

      {/* 新建角色 FAB */}
      <FAB
        icon="plus"
        label="新建角色"
        onPress={() => openCardEditor(null)}
        style={styles.fab}
        color={palette.onPrimary}
      />

      {/* 删除确认对话框 */}
      <Portal>
        <Dialog visible={deleteTarget !== null} onDismiss={() => setDeleteTarget(null)}>
          <Dialog.Title>确认删除</Dialog.Title>
          <Dialog.Content>
            <Text>删除「{deleteTarget?.name || deleteTarget?.fileName}」角色卡？{'\n'}仅删除卡文件，历史对话不受影响。</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteTarget(null)}>取消</Button>
            <Button onPress={doDelete} loading={deleting} textColor={palette.error}>删除</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={snack !== null} onDismiss={() => setSnack(null)} duration={2000}>
        {snack}
      </Snackbar>
    </SafeAreaView>
  );
}

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
    searchWrap: { padding: 12, paddingBottom: 4 },
    search: { borderRadius: 14, backgroundColor: p.glassBg },
    list: { padding: 12, paddingTop: 8 },
    card: {
      marginBottom: 10,
      borderRadius: 20,
      backgroundColor: p.surface,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    cardTitle: { fontWeight: '600', color: p.onSurface },
    avatar: { backgroundColor: p.surfaceVariant },
    desc: { color: p.onSurfaceVariant, marginTop: 2 },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8, gap: 6 },
    tag: { backgroundColor: p.surfaceVariant, height: 26 },
    tagText: { fontSize: 11, color: p.onSurfaceVariant },
    tagMore: { color: p.onSurfaceVariant },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
    centerText: { color: p.onSurfaceVariant, textAlign: 'center', lineHeight: 20 },
    errorText: { color: p.error, textAlign: 'center', lineHeight: 20 },
    retryBtn: { borderRadius: 12 },
    cardActions: { flexDirection: 'row', alignItems: 'center', marginRight: -4 },
    fab: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      backgroundColor: p.primary,
      borderRadius: 20,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
  });
}
