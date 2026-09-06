/**
 * 创想咖啡厅 · 安卓 LAN 对话客户端（Spec: add-android-chat-client）
 *
 * 纯客户端：所有功能配置（模型/提示词/生成参数）均由服务端决定，
 * 本地仅保存最近一次成功连接的服务器地址（见 src/store.ts）
 * 与界面主题偏好（亮/暗，纯外观，见 src/theme.ts）。
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppStore } from './src/store';
import { themeOf } from './src/theme';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { CharacterListScreen } from './src/screens/CharacterListScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { CharacterEditScreen } from './src/screens/CharacterEditScreen';

function Root() {
  const screen = useAppStore(s => s.screen);
  const baseUrl = useAppStore(s => s.baseUrl);
  const activeCharacter = useAppStore(s => s.activeCharacter);

  if (!baseUrl || screen === 'connect') {
    return <ConnectScreen />;
  }
  if (screen === 'chat' && activeCharacter) {
    return <ChatScreen />;
  }
  if (screen === 'edit') {
    return <CharacterEditScreen />;
  }
  return <CharacterListScreen />;
}

export default function App() {
  const themeMode = useAppStore(s => s.themeMode);
  const initTheme = useAppStore(s => s.initTheme);
  const { theme, palette } = themeOf(themeMode);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return (
    <PaperProvider theme={theme}>
      <SafeAreaProvider>
        {/* RN 0.87 edge-to-edge：StatusBar 不再支持 backgroundColor，仅控制图标明暗 */}
        <StatusBar barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'} />
        <Root />
      </SafeAreaProvider>
    </PaperProvider>
  );
}
