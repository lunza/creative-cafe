/**
 * 记忆表格查看弹层（Spec: fix-android-chat-feature-parity / Task 8）
 *
 * 展示服务端 GET /api/chats/:id/memory-table 返回的 sheets/headers/rows。
 * 简单可滚动表格（横向滚动），未启用或无数据时空态。
 * V3：亮暗主题适配（palette 驱动）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, Text as RNText } from 'react-native';
import {
  Portal,
  Modal,
  Text,
  Button,
  ActivityIndicator,
  SegmentedButtons,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fetchMemoryTable } from '../api/client';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';
import type { MemoryTableData } from '../types';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  baseUrl: string;
  characterId: string;
}

export function MemoryTableSheet({ visible, onDismiss, baseUrl, characterId }: Props) {
  const insets = useSafeAreaInsets();
  const themeMode = useAppStore(s => s.themeMode);
  const { palette } = themeOf(themeMode);
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<MemoryTableData | null>(null);
  const [sheet, setSheet] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemoryTable(baseUrl, characterId);
      setTable(data);
      setSheet(data.sheets?.[0] || '');
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(e ? e.message : `表格加载失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, characterId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const rows = table?.data?.[sheet] || [];
  const headers = table?.headers?.[sheet] || [];

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            记忆表格
          </Text>
          <Button mode="text" compact onPress={onDismiss} labelStyle={styles.closeLabel}>
            关闭
          </Button>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator animating />
            <Text style={styles.centerText}>正在加载表格…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button mode="contained-tonal" onPress={load}>
              重新加载
            </Button>
          </View>
        ) : !table?.enabled ? (
          <View style={styles.center}>
            <Text style={styles.centerText}>记忆表格未启用（可在会话配置中开启）</Text>
          </View>
        ) : table.sheets.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.centerText}>暂无表格数据（AI 编辑后将在此显示）</Text>
          </View>
        ) : (
          <>
            {table.sheets.length > 1 && (
              <SegmentedButtons
                value={sheet}
                onValueChange={setSheet}
                density="small"
                style={styles.segment}
                buttons={table.sheets.map(s => ({ value: s, label: s }))}
              />
            )}
            {table.sheetDescriptions?.[sheet] ? (
              <RNText style={styles.desc}>{table.sheetDescriptions[sheet]}</RNText>
            ) : null}
            <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableContent}>
              <View>
                <View style={styles.row}>
                  {headers.map((h, i) => (
                    <View key={i} style={styles.cellHeader}>
                      <RNText style={styles.cellHeaderText}>{h}</RNText>
                    </View>
                  ))}
                </View>
                {rows.length === 0 ? (
                  <RNText style={styles.emptyRow}>（空表）</RNText>
                ) : (
                  rows.map((row, ri) => (
                    <View key={ri} style={[styles.row, ri % 2 === 1 && styles.rowAlt]}>
                      {headers.map((_h, ci) => (
                        <View key={ci} style={styles.cell}>
                          <RNText style={styles.cellText}>
                            {row[ci] !== undefined && row[ci] !== null ? String(row[ci]) : ''}
                          </RNText>
                        </View>
                      ))}
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </>
        )}
      </Modal>
    </Portal>
  );
}

/** V4：主题化样式工厂（玻璃态弹层） */
function createStyles(p: Palette) {
  return StyleSheet.create({
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '80%',
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
    center: { alignItems: 'center', padding: 24, gap: 10 },
    centerText: { color: p.onSurfaceVariant, textAlign: 'center' },
    errorText: { color: p.error, textAlign: 'center', lineHeight: 20 },

    segment: { marginHorizontal: 16, marginBottom: 4 },
    desc: { color: p.onSurfaceVariant, fontSize: 12, marginHorizontal: 16, marginTop: 6 },

    tableScroll: { maxHeight: 420, marginHorizontal: 12, marginBottom: 8 },
    tableContent: { padding: 4 },
    row: { flexDirection: 'row' },
    rowAlt: { backgroundColor: p.surfaceVariant },
    cellHeader: {
      minWidth: 96,
      maxWidth: 180,
      paddingVertical: 8,
      paddingHorizontal: 8,
      backgroundColor: p.primary,
      borderRadius: 8,
      borderWidth: 0.5,
      borderColor: p.surface,
    },
    cellHeaderText: { color: p.onPrimary, fontSize: 12, fontWeight: '700' },
    cell: {
      minWidth: 96,
      maxWidth: 180,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderWidth: 0.5,
      borderColor: p.outline,
      justifyContent: 'center',
    },
    cellText: { color: p.onSurface, fontSize: 12, flexShrink: 1 },
    emptyRow: { color: p.onSurfaceVariant, fontSize: 12, padding: 12 },
  });
}
