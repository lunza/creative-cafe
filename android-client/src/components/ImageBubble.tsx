/**
 * 对话图片气泡组件（Spec: redesign-mobile-chat-ui / Task 3）
 *
 * 自适应卡片式图片展示：按原始宽高比缩放（限宽限高不裁切）、16dp 圆角 + 内阴影、
 * 骨架屏加载 + 淡入过渡、生成中阶段进度、历史版本切换胶囊控件悬于底边、
 * 全屏查看采用玻璃态半透明遮罩。亮/暗主题 palette 驱动。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Image as RNImage,
  Text as RNText,
  Modal,
  Pressable,
  Dimensions,
  ScrollView,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { IconButton, TouchableRipple } from 'react-native-paper';
import { conversationImageUrl } from '../api/client';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';
import type { ImageAttachment } from '../types';

interface Props {
  baseUrl: string;
  characterId: string;
  messageId: string;
  attachment: ImageAttachment | undefined;
  /** 客户端本地生成中标记（请求 pending） */
  generating: boolean;
  /** 气泡内容可用宽度（限宽用；由调用方传入避免依赖布局引擎） */
  maxImageWidth: number;
  onRegenerate: (messageId: string) => void;
  onRetry: (messageId: string) => void;
}

export function ImageBubble({
  baseUrl,
  characterId,
  messageId,
  attachment,
  generating,
  maxImageWidth,
  onRegenerate,
  onRetry,
}: Props) {
  const themeMode = useAppStore(s => s.themeMode);
  const { palette } = themeOf(themeMode);
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [viewIndex, setViewIndex] = useState<number>(-1);
  const [fullscreen, setFullscreen] = useState(false);
  /** 图片加载完成前显示骨架 */
  const [loaded, setLoaded] = useState(false);
  /** 当前展示项的实际宽高比（骨架期给保守高度） */
  const [ratio, setRatio] = useState<number>(1);
  /** 淡入动画 */
  const fadeAnim = useRef(new Animated.Value(0)).current;
  /** 骨架脉冲动画 */
  const pulseAnim = useRef(new Animated.Value(0.45)).current;

  // 骨架脉冲：loop
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useEffect(() => {
    setViewIndex(attachment?.currentIndex ?? -1);
    setLoaded(false);
    fadeAnim.setValue(0);
    setRatio(1);
  }, [attachment?.currentIndex, attachment?.history.length, fadeAnim]);

  const item = useMemo(() => {
    if (!attachment?.history?.length) return null;
    const idx = viewIndex >= 0 && viewIndex < attachment.history.length ? viewIndex : attachment.currentIndex;
    return attachment.history[idx] || null;
  }, [attachment, viewIndex]);

  const fadeIn = useCallback(() => {
    setLoaded(true);
    Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [fadeAnim]);

  if (!attachment && !generating) return null;

  // 生成中：阶段 loading 占位（暖色脉冲 + 阶段文案）
  if (generating) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.placeholder, { width: maxImageWidth }]}>
          <Animated.View style={[styles.skeletonBlock, { opacity: pulseAnim, width: maxImageWidth - 24, height: 120 }]}>
            <ActivityIndicator animating color={palette.primary} style={styles.loader} />
          </Animated.View>
          <RNText style={styles.placeholderText}>
            {attachment?.status === 'error' ? '生成失败，点击重试' : '正在生成图片…（SD 绘制约 10-120 秒）'}
          </RNText>
        </View>
      </View>
    );
  }

  // 失败态：错误占位 + 重试（玻璃卡）
  if (attachment?.status === 'error') {
    return (
      <View style={[styles.wrap, styles.errorCard]}>
        <View style={styles.placeholderError}>
          <RNText style={styles.errorText}>图片生成失败</RNText>
          {attachment.errorMessage ? (
            <RNText style={styles.errorDetail} numberOfLines={3}>
              {attachment.errorMessage}
            </RNText>
          ) : null}
          <IconButton
            icon="refresh"
            mode="contained-tonal"
            size={20}
            onPress={() => onRetry(messageId)}
          />
        </View>
      </View>
    );
  }

  if (!item) return null;

  const url = conversationImageUrl(baseUrl, characterId, item.assetId);
  const idx = viewIndex >= 0 && viewIndex < attachment!.history.length ? viewIndex : attachment!.currentIndex;
  const total = attachment!.history.length;
  // 尺寸策略：限宽 = maxImageWidth；限高（纵向长图压缩到气泡可用高度 60%）
  const availableW = maxImageWidth;
  const maxH = availableW * 1.4;
  const imgW = ratio >= 1 ? availableW : Math.max(120, availableW * ratio);
  const imgH = ratio >= 1 ? Math.min(availableW, maxH) : availableW;
  // 未加载前给方形骨架位，加载后按真实比例过渡
  const displayW = loaded || ratio > 0 ? imgW : availableW;
  const displayH = loaded || /* placeholder */ true ? (loaded ? imgH : availableW * 0.8) : availableW;

  return (
    <View style={styles.wrap}>
      {/* 骨架（未加载完成时） */}
      {!loaded && (
        <Animated.View
          style={[
            styles.skeletonBlock,
            styles.skeletonOverlay,
            { opacity: pulseAnim, width: availableW, height: availableW * 0.8 },
          ]}
        />
      )}

      <TouchableRipple onPress={() => setFullscreen(true)} borderless style={styles.imageRipple}>
        <Animated.Image
          source={{ uri: url }}
          style={[
            styles.image,
            {
              width: Math.min(displayW, availableW),
              aspectRatio: ratio,
              opacity: fadeAnim,
            },
          ]}
          resizeMode="cover"
          onLoad={e => {
            const { width: w, height: h } = e.nativeEvent.source;
            if (w && h) {
              setRatio(w / h);
              fadeIn();
            }
          }}
          onError={() => fadeIn()}
        />
      </TouchableRipple>

      {/* 历史版本切换：胶囊控件悬于底边中央（不占独立行） */}
      {total > 1 && (
        <View style={styles.capsule} pointerEvents="box-none">
          <View style={styles.capsuleInner}>
            <IconButton
              icon="chevron-left"
              size={14}
              iconColor="rgba(255,255,255,0.9)"
              disabled={idx <= 0}
              onPress={() => setViewIndex(Math.max(0, idx - 1))}
              style={styles.capsuleBtn}
            />
            <RNText style={styles.capsuleText}>
              {idx + 1}/{total}
            </RNText>
            <IconButton
              icon="chevron-right"
              size={14}
              iconColor="rgba(255,255,255,0.9)"
              disabled={idx >= total - 1}
              onPress={() => setViewIndex(Math.min(total - 1, idx + 1))}
              style={styles.capsuleBtn}
            />
            <View style={styles.capsuleDivider} />
            <IconButton
              icon="refresh"
              size={14}
              iconColor="rgba(255,255,255,0.9)"
              onPress={() => onRegenerate(messageId)}
              style={styles.capsuleBtn}
            />
          </View>
        </View>
      )}
      {total <= 1 && (
        <View style={styles.capsule} pointerEvents="box-none">
          <View style={styles.capsuleInner}>
            <IconButton
              icon="refresh"
              size={14}
              iconColor="rgba(255,255,255,0.9)"
              onPress={() => onRegenerate(messageId)}
              style={styles.capsuleBtn}
            />
          </View>
        </View>
      )}

      {/* 全屏查看（玻璃态遮罩 + 点击关闭 + 横向滑动切换版本） */}
      <Modal visible={fullscreen} transparent onRequestClose={() => setFullscreen(false)}>
        <Pressable style={styles.fullscreenBackdrop} onPress={() => setFullscreen(false)}>
          <ScrollView
            horizontal
            pagingEnabled
            style={styles.fullscreenPager}
            contentContainerStyle={styles.fullscreenPagerContent}
          >
            {attachment!.history.map((h, i) => (
              <RNImage
                key={h.createdAt + '-' + i}
                source={{ uri: conversationImageUrl(baseUrl, characterId, h.assetId) }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
            ))}
          </ScrollView>
          <RNText style={styles.fullscreenHint}>点击任意处关闭 · 左右滑动切换版本</RNText>
        </Pressable>
      </Modal>
    </View>
  );
}

/** 主题化样式工厂 */
function createStyles(p: Palette) {
  return StyleSheet.create({
    wrap: {
      marginTop: 6,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: p.glassBg,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    imageRipple: { borderRadius: 16 },
    image: {
      borderRadius: 16,
      backgroundColor: 'transparent',
    },
    // 骨架屏
    skeletonBlock: {
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.skeleton,
      overflow: 'hidden',
    },
    skeletonOverlay: { position: 'absolute', top: 0, left: 0, zIndex: 1 },
    loader: { opacity: 0.9 },

    // 生成中/失败占位
    placeholder: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      gap: 10,
    },
    placeholderText: { color: p.onSurfaceVariant, fontSize: 12, textAlign: 'center' },
    errorCard: {
      backgroundColor: 'rgba(179,58,46,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(179,58,46,0.25)',
    },
    placeholderError: { alignItems: 'center', justifyContent: 'center', padding: 12, gap: 4 },
    errorText: { color: p.error, fontSize: 13, fontWeight: '600' },
    errorDetail: { color: p.error, fontSize: 11, textAlign: 'center', opacity: 0.8 },

    // 历史切换胶囊（浮层）
    capsule: {
      position: 'absolute',
      bottom: 8,
      alignSelf: 'center',
      zIndex: 5,
    },
    capsuleInner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 20,
      paddingHorizontal: 2,
    },
    capsuleBtn: { margin: 0, width: 28, height: 28 },
    capsuleText: { color: 'rgba(255,255,255,0.92)', fontSize: 12, marginHorizontal: 2, minWidth: 28, textAlign: 'center' },
    capsuleDivider: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.3)' },

    // 全屏
    fullscreenBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.88)', // 玻璃态深遮罩
      justifyContent: 'center',
    },
    fullscreenPager: { width: '100%' },
    fullscreenPagerContent: { alignItems: 'center' },
    fullscreenImage: {
      width: Dimensions.get('window').width,
      height: Dimensions.get('window').height * 0.8,
    },
    fullscreenHint: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: 12,
      textAlign: 'center',
      paddingVertical: 16,
    },
  });
}