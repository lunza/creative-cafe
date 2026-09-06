/**
 * 全屏图片查看器（Spec: fix-android-chat-interaction-parity / Task 4）
 *
 * 对齐 PC 端 ImagePreviewModal 全尺寸预览体验（黑遮罩 + 点击关闭），
 * 并提供移动端缩放控制：双指捏合 1x–4x、双击 1x/2.5x 切换、
 * 放大后单指拖拽平移（限幅防拖出屏幕）、单击关闭、右上角关闭按钮、
 * 系统返回键关闭（onRequestClose）。纯 RN 实现，无第三方依赖。
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Animated,
  Dimensions,
  PanResponder,
  View,
  Text as RNText,
  useWindowDimensions,
} from 'react-native';
import { IconButton } from 'react-native-paper';

interface Props {
  visible: boolean;
  /** 图片绝对 URL（null 时仅渲染遮罩，不显示图片） */
  url: string | null;
  onDismiss: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP = 8;
const DOUBLE_TAP_INTERVAL = 280;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function touchDist(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number }
): number {
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function AvatarViewer({ visible, url, onDismiss }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Animated.Value 的 ref 镜像（手势计算需要同步读当前值）
  const scaleRef = useRef(1);
  const translateXRef = useRef(0);
  const translateYRef = useRef(0);

  // 手势状态（非渲染数据）
  const gesture = useRef({
    isPinch: false,
    startDist: 0,
    startScale: 1,
    startTranslateX: 0,
    startTranslateY: 0,
    moved: false,
    lastTapAt: 0,
  });
  // 最新回调/可见性 ref（避免 PanResponder 重建）
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const s = scale.addListener(({ value }) => { scaleRef.current = value; });
    const x = translateX.addListener(({ value }) => { translateXRef.current = value; });
    const y = translateY.addListener(({ value }) => { translateYRef.current = value; });
    return () => {
      scale.removeListener(s);
      translateX.removeListener(x);
      translateY.removeListener(y);
    };
  }, [scale, translateX, translateY]);

  const reset = useCallback(
    (animated: boolean) => {
      if (animated) {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, overshootClamping: true }),
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
        ]).start();
      } else {
        scale.setValue(1);
        translateX.setValue(0);
        translateY.setValue(0);
      }
    },
    [scale, translateX, translateY]
  );

  // 打开/切换图片时复位变换
  useEffect(() => {
    if (visible) reset(false);
  }, [visible, url, reset]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: evt => {
          const g = gesture.current;
          g.moved = false;
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            g.isPinch = true;
            g.startDist = touchDist(touches[0], touches[1]);
            g.startScale = scaleRef.current;
          } else {
            g.isPinch = false;
            g.startTranslateX = translateXRef.current;
            g.startTranslateY = translateYRef.current;
          }
        },
        onPanResponderMove: (evt, gs) => {
          const g = gesture.current;
          if (Math.abs(gs.dx) > TAP_SLOP || Math.abs(gs.dy) > TAP_SLOP) g.moved = true;
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            // 双指捏合：按距离比例缩放（相对手势开始时的 scale）
            if (g.startDist > 0) {
              const d = touchDist(touches[0], touches[1]);
              const next = clamp((g.startScale * d) / g.startDist, MIN_SCALE, MAX_SCALE);
              scale.setValue(next);
            }
          } else if (!g.isPinch && scaleRef.current > 1.01) {
            // 单指拖拽平移（仅放大后生效），限幅防拖出屏幕
            const limitX = (winW * (scaleRef.current - 1)) / 2;
            const limitY = (winH * (scaleRef.current - 1)) / 2;
            translateX.setValue(clamp(g.startTranslateX + gs.dx, -limitX, limitX));
            translateY.setValue(clamp(g.startTranslateY + gs.dy, -limitY, limitY));
          }
        },
        onPanResponderRelease: (evt, gs) => {
          const g = gesture.current;
          const isTap =
            !g.moved && Math.abs(gs.dx) < TAP_SLOP && Math.abs(gs.dy) < TAP_SLOP;
          if (isTap) {
            const now = Date.now();
            if (now - g.lastTapAt < DOUBLE_TAP_INTERVAL) {
              // 双击：在 1x 与 2.5x 间切换
              g.lastTapAt = 0;
              const target = scaleRef.current > 1.01 ? MIN_SCALE : DOUBLE_TAP_SCALE;
              Animated.parallel([
                Animated.spring(scale, {
                  toValue: target,
                  useNativeDriver: true,
                  overshootClamping: true,
                }),
                Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
                Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
              ]).start();
            } else {
              // 单击：延迟判定（等待可能的第二次 tap），未构成双击则关闭
              g.lastTapAt = now;
              setTimeout(() => {
                if (g.lastTapAt === now && visibleRef.current) {
                  onDismissRef.current();
                }
              }, DOUBLE_TAP_INTERVAL + 40);
            }
          } else if (scaleRef.current <= 1.01) {
            // 未放大时拖拽结束：回弹居中
            Animated.parallel([
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
              Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
            ]).start();
          }
          g.isPinch = false;
        },
        onPanResponderTerminate: () => {
          gesture.current.isPinch = false;
        },
      }),
    [scale, translateX, translateY, winW, winH]
  );

  return (
    <Modal visible={visible} transparent onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        {/* 手势区域（撑满屏幕，承载单击/双击/捏合/拖拽） */}
        <Animated.View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
          <Animated.Image
            source={url ? { uri: url } : undefined}
            style={[
              styles.image,
              { width: winW, height: winH },
              { transform: [{ translateX }, { translateY }, { scale }] },
            ]}
            resizeMode="contain"
          />
        </Animated.View>

        {/* 关闭按钮（浮于手势区域上层） */}
        <View style={styles.closeWrap} pointerEvents="box-none">
          <IconButton
            icon="close"
            iconColor="rgba(255,255,255,0.92)"
            size={26}
            onPress={onDismiss}
            style={styles.closeBtn}
          />
        </View>

        <RNText style={styles.hint}>双指缩放 · 双击放大/还原 · 单击关闭</RNText>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  image: {
    flex: 1,
  },
  closeWrap: {
    position: 'absolute',
    top: 34,
    right: 10,
  },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  hint: {
    position: 'absolute',
    bottom: 26,
    left: 0,
    right: 0,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    textAlign: 'center',
  },
});
