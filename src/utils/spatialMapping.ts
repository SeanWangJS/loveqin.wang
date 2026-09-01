import { PhotoItem, SpatialPosition } from '../types/gallery';
import { GALLERY_GEOMETRY } from '../config/galleryGeometry';

/**
 * 简易确定性字符串哈希，保证同一 ID 在任何设备刷新后扰动值恒定不变
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface SpatialMappingOptions {
  dMin?: number;        // 沿走廊 Z 轴的最小间距，推荐 3.2
  zJitter?: number;     // Z 轴额外间距的确定性随机幅度，推荐 0.16
  channelWidth?: number;// 照片中心线到走廊中心的半宽
  xSpread?: number;     // 照片沿 X 轴相对中心线的最大偏移
  baseY?: number;       // 基准视线高度，推荐 0.25
  inwardAngle?: number; // 照片朝向走廊中心的基础角度
}

/**
 * 画廊走廊照片布局：
 * 以正对屏幕为 0 度，照片挂在长廊两侧，并以小角度朝向走廊中心。
 */
export function computeTunnelPositions(
  photos: PhotoItem[],
  options: SpatialMappingOptions = {}
): Map<string, SpatialPosition> {
  const {
    dMin = 3.2,
    zJitter = 0.16,
    channelWidth = GALLERY_GEOMETRY.photoLineHalfWidth,
    xSpread = 0.9,
    baseY = 0.25,
    inwardAngle = Math.PI / 2,
  } = options;

  const positions = new Map<string, SpatialPosition>();
  let currentZ = 0;

  // 概念图多层交错高度（错落有致的艺术展墙）
  const Y_TIERS = [-0.65, 0.45, 1.45, 0.1, 0.85, -0.25];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const prevPhoto = i > 0 ? photos[i - 1] : null;

    if (prevPhoto) {
      const hashZ = hashString(`${photo.id}:z`);
      const normalizedZ = (hashZ % 1000) / 999;
      const randomFactor = 1 + normalizedZ * zJitter;
      const zDelta = dMin * randomFactor;
      currentZ -= zDelta;
    } else {
      currentZ = 0;
    }

    const hashX = hashString(photo.id);
    const tierY = Y_TIERS[i % Y_TIERS.length];

    // 左右交错挂载在走廊两侧墙壁上 (side = -1 为左墙，side = 1 为右墙)
    const side = i % 2 === 0 ? -1 : 1;
    const normalizedX = (hashX % 1000) / 999;
    const xOffset = (normalizedX - 0.5) * 2 * xSpread;
    const x = side * (channelWidth + xOffset);
    const y = baseY + tierY;
    const z = currentZ;

    const angleJitter = (((hashX >> 8) % 100) / 100 - 0.5) * 0.12;
    const rotationY = -side * (inwardAngle + angleJitter);
    const rotationX = 0;
    const rotationZ = 0;
    const scale = i < 4 ? 1.3 - i * 0.1 : 1;

    positions.set(photo.id, {
      x,
      y,
      z,
      scale,
      rotationY,
      rotationX,
      rotationZ,
    });
  }

  return positions;
}

/**
 * 根据相机当前 Z 坐标，找到最靠近视口焦点的照片及其时间信息
 */
export function getActivePhotoAtZ(
  photos: PhotoItem[],
  positions: Map<string, SpatialPosition>,
  cameraZ: number
): PhotoItem | null {
  if (photos.length === 0) return null;

  let closestPhoto: PhotoItem | null = null;
  let minDistance = Infinity;

  // 视口焦点在相机前方约 8 ~ 12 个单位处
  const focusZ = cameraZ - 10;

  for (const photo of photos) {
    const pos = positions.get(photo.id);
    if (!pos) continue;
    const dist = Math.abs(pos.z - focusZ);
    if (dist < minDistance) {
      minDistance = dist;
      closestPhoto = photo;
    }
  }

  return closestPhoto || photos[0];
}
