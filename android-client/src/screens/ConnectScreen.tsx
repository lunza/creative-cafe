/**
 * 连接页（Spec: add-android-chat-client / R3）
 * 仅服务器地址输入 + 测试连接；启动时自动尝试最近成功地址。
 * V3：右上角主题切换按钮 + 亮/暗主题适配。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, Text, ActivityIndicator, HelperText, Surface, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, checkHealth, normalizeServerAddress } from '../api/client';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';

export function ConnectScreen() {
  const setConnected = useAppStore(s => s.setConnected);
  const autoConnecting = useAppStore(s => s.autoConnecting);
  const setAutoConnecting = useAppStore(s => s.setAutoConnecting);
  const loadSavedAddress = useAppStore(s => s.loadSavedAddress);
  const themeMode = useAppStore(s => s.themeMode);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const { palette } = themeOf(themeMode);

  const [address, setAddress] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const autoTriedRef = useRef(false);

  const styles = createStyles(palette);

  const connect = useCallback(
    async (addr: string, { silent }: { silent?: boolean } = {}) => {
      let normalized: string;
      try {
        normalized = normalizeServerAddress(addr);
      } catch (err) {
        if (!silent) setError({ kind: 'parse', message: (err as Error).message });
        return false;
      }
      if (!silent) setTesting(true);
      try {
        const info = await checkHealth(normalized);
        if (info.status !== 'ok') {
          throw new ApiError('http', `服务端状态异常：${info.status}`);
        }
        await setConnected(normalized);
        return true;
      } catch (err) {
        if (!silent) {
          const e = err instanceof ApiError ? err : new ApiError('unreachable', String(err));
          setError({ kind: e.kind, message: e.message });
        }
        return false;
      } finally {
        if (!silent) setTesting(false);
      }
    },
    [setConnected]
  );

  // 启动自动重连：尝试最近一次成功地址
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    (async () => {
      const saved = await loadSavedAddress();
      if (!saved) return;
      setAddress(saved);
      setAutoConnecting(true);
      const ok = await connect(saved, { silent: true });
      if (!ok) setError({ kind: 'auto', message: `自动连接 ${saved} 失败，请检查服务端与网络后重试` });
      setAutoConnecting(false);
    })();
  }, [connect, loadSavedAddress, setAutoConnecting]);

  const kindLabel: Record<string, string> = {
    unreachable: '[不可达]',
    timeout: '[超时]',
    http: '[服务端错误]',
    parse: '[地址无效]',
    auto: '[自动连接失败]',
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.themeBtnWrap}>
        <IconButton
          icon={themeMode === 'dark' ? 'white-balance-sunny' : 'weather-night'}
          onPress={toggleTheme}
          iconColor={palette.primary}
        />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? undefined : 'padding'}>
        <Surface style={styles.card} elevation={2}>
          <Text variant="headlineSmall" style={styles.title}>
            创想咖啡厅
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            局域网 AI 对话客户端{'\n'}请输入电脑端服务地址（同一 WiFi）
          </Text>

          <TextInput
            label="服务器地址（host:port）"
            value={address}
            onChangeText={t => {
              setAddress(t);
              setError(null);
            }}
            placeholder="例如 192.168.1.100:8787"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            mode="outlined"
            disabled={testing || autoConnecting}
            style={styles.input}
          />

          {error && (
            <HelperText type="error" visible style={styles.errorText}>
              {kindLabel[error.kind] || ''} {error.message}
            </HelperText>
          )}

          <Button
            mode="contained"
            onPress={() => connect(address)}
            loading={testing || autoConnecting}
            disabled={testing || autoConnecting || !address.trim()}
            style={styles.button}
          >
            {autoConnecting ? '正在自动连接…' : '测试并连接'}
          </Button>

          <Text variant="bodySmall" style={styles.hint}>
            默认端口 8787；服务端地址见桌面端启动日志{'\n'}（[LanApi] LAN API 服务已启动）
          </Text>
        </Surface>

        {(testing || autoConnecting) && (
          <View style={styles.loadingRow}>
            <ActivityIndicator animating size="small" />
            <Text variant="bodySmall" style={styles.loadingText}>
              正在检测 /api/health …
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(p: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: p.background },
    flex: { flex: 1, justifyContent: 'center', padding: 20 },
    themeBtnWrap: { position: 'absolute', top: 8, right: 8, zIndex: 10 },
    card: {
      borderRadius: 24,
      padding: 28,
      backgroundColor: p.glassBg,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    title: { textAlign: 'center', fontWeight: '700', color: p.primary },
    subtitle: { textAlign: 'center', marginTop: 8, marginBottom: 20, color: p.onSurfaceVariant, lineHeight: 20 },
    input: { backgroundColor: p.surface, borderRadius: 14 },
    errorText: { marginBottom: 4 },
    button: { marginTop: 8, paddingVertical: 6, borderRadius: 20 },
    hint: { textAlign: 'center', marginTop: 16, color: p.onSurfaceVariant, lineHeight: 18 },
    loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20, gap: 8 },
    loadingText: { color: p.onSurfaceVariant },
  });
}
