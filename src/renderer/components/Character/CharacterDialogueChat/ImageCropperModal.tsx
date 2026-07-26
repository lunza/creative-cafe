import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Slider, message } from 'antd';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';

/**
 * 表情图片裁剪弹窗（Spec: add-character-expression-system / Task 5）
 *
 * 基于 react-easy-crop 实现方形裁剪，用于从用户上传的全身图/大图中
 * 精确截取面部表情区域。输出 PNG data URL，长边超过 512px 时按比例
 * 压缩，符合 Spec「图像格式统一与压缩」要求。
 *
 * UI 风格与 CharacterEditModal 保持一致（暗色主题 + 项目 CSS 变量）。
 * 自包含 inline styles，不引入额外 CSS 文件（参照 ChatMessageBubble 模式）。
 */

interface ImageCropperModalProps {
  open: boolean;
  /** 用户上传图片的 data URL，为 null 时弹窗体显示占位 */
  imageSrc: string | null;
  /** 裁剪确认回调，返回 PNG data URL（已压缩） */
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

/** 圆形预览尺寸（px） */
const PREVIEW_SIZE = 64;
/** 输出图像长边上限（px），超过则等比缩放压缩 */
const MAX_LONG_SIDE = 512;

/**
 * 通过 canvas 从原图中截取指定像素区域，输出 PNG data URL。
 *
 * 实现 references：`CharacterEditModal.tsx` 的 `convertToPng`（同样的
 * `new Image()` + `onload` Promise 模式）。区别在于本函数按 `pixelCrop`
 * 子区域绘制而非整图，并在长边 > 512px 时按比例缩放压缩。
 *
 * 压缩策略：直接以目标尺寸创建 canvas，drawImage 自动缩放绘制，
 * 一次到位避免二次重绘开销。
 */
async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageSrc;
  });

  // 长边超过 MAX_LONG_SIDE 时计算等比缩放系数
  const longSide = Math.max(pixelCrop.width, pixelCrop.height);
  const scale = longSide > MAX_LONG_SIDE ? MAX_LONG_SIDE / longSide : 1;
  const targetWidth = Math.max(1, Math.round(pixelCrop.width * scale));
  const targetHeight = Math.max(1, Math.round(pixelCrop.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法获取 canvas 上下文');
  }

  // 从原图指定区域绘制到目标 canvas（drawImage 自动缩放到 canvas 尺寸）
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  return canvas.toDataURL('image/png');
}

const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  open,
  imageSrc,
  onConfirm,
  onCancel,
}) => {
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // 弹窗打开或图片切换时重置裁剪状态，避免上次裁剪位置残留
  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setMediaSize(null);
    }
  }, [open, imageSrc]);

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const onMediaLoaded = useCallback(
    (size: { naturalWidth: number; naturalHeight: number }) => {
      setMediaSize({ width: size.naturalWidth, height: size.naturalHeight });
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) {
      message.warning('请先调整裁剪区域');
      return;
    }
    setLoading(true);
    try {
      const dataUrl = await getCroppedImg(imageSrc, croppedAreaPixels);
      onConfirm(dataUrl);
    } catch (error) {
      // 【重点标记 - 异常容错】裁剪失败时不关闭弹窗，让用户可重试或取消
      console.error('[ImageCropperModal] 裁剪失败:', error);
      message.error('裁剪失败');
    } finally {
      setLoading(false);
    }
  }, [imageSrc, croppedAreaPixels, onConfirm]);

  // 圆形预览样式：用 CSS background-position 同步渲染，无 canvas 异步开销
  // 计算方式：将原图按裁剪框比例映射到 PREVIEW_SIZE × PREVIEW_SIZE 视口
  const previewStyle: React.CSSProperties =
    imageSrc && mediaSize && croppedAreaPixels
      ? {
          backgroundImage: `url(${imageSrc})`,
          backgroundSize: `${(mediaSize.width / croppedAreaPixels.width) * PREVIEW_SIZE}px ${(mediaSize.height / croppedAreaPixels.height) * PREVIEW_SIZE}px`,
          backgroundPosition: `-${(croppedAreaPixels.x / croppedAreaPixels.width) * PREVIEW_SIZE}px -${(croppedAreaPixels.y / croppedAreaPixels.height) * PREVIEW_SIZE}px`,
        }
      : {
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.8))',
        };

  return (
    <Modal
      title="裁剪表情图片"
      open={open}
      onCancel={onCancel}
      width={640}
      style={{ top: 20 }}
      styles={{ body: { padding: '16px 16px 0 16px' } }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={loading}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={loading}
          onClick={handleConfirm}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            borderColor: 'transparent',
          }}
        >
          确认裁剪
        </Button>,
      ]}
    >
      {imageSrc ? (
        <>
          {/* Cropper 容器：固定高度 400px + 暗色背景，便于透明 PNG 可见 */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: 400,
              overflow: 'hidden',
              background: '#0f0f1a',
              borderRadius: 8,
            }}
          >
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              showGrid
              zoomWithScroll
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              onMediaLoaded={onMediaLoaded}
              style={{ containerStyle: { background: '#0f0f1a' } }}
              classes={{}}
            />
          </div>

          {/* 缩放滑块 + 圆形预览 行 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '16px 0',
            }}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span
                style={{
                  color: 'var(--config-panel-label-color, #cbd5e1)',
                  fontSize: 13,
                  minWidth: 32,
                  flexShrink: 0,
                }}
              >
                缩放
              </span>
              <Slider
                min={0.5}
                max={5}
                step={0.1}
                value={zoom}
                onChange={setZoom}
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>

            {/* 裁剪预览圆形：64x64，使用 CSS 背景定位实时同步 */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: PREVIEW_SIZE,
                  height: PREVIEW_SIZE,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: `2px solid var(--primary-color, #6366f1)`,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  backgroundColor: '#0f0f1a',
                  ...previewStyle,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--config-panel-sub-text-color, #94a3b8)',
                }}
              >
                裁剪预览
              </span>
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            height: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--config-panel-sub-text-color, #94a3b8)',
            fontSize: 14,
          }}
        >
          图片加载中...
        </div>
      )}
    </Modal>
  );
};

export default ImageCropperModal;
