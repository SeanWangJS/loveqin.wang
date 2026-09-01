import { PhotoItem, SpatialPosition } from '../types/gallery';

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
  dMin?: number;        // 最小卡片物理间距（沿走廊 Z 轴），推荐 4.0
  alpha?: number;       // 对数时间拉伸系数，推荐 2.2
  tau?: number;         // 时间基准分母（默认 1 天 = 86400000 ms）
  channelWidth?: number;// 中央长廊通道半宽，推荐 3.8（让照片环绕在近前，占据宏大视野）
  baseY?: number;       // 基准视线高度，推荐 0.35
  inwardAngle?: number; // 概念图黄金透视内倾角，推荐 0.38 弧度 (~22度)
}

/**
 * 概念设计图 1:1 空间尺度映射：
 * 放大卡片尺度与多层交错布局，使前景照片如概念图般宏伟沉浸、扑面而来
 */
export function computeTunnelPositions(
  photos: PhotoItem[],
  options: SpatialMappingOptions = {}
): Map<string, SpatialPosition> {
  const {
    dMin = 4.2,
    alpha = 2.2,
    tau = 86400000,
    channelWidth = 3.8,
    baseY = 0.35,
    inwardAngle = 0.38, // 约 22 度自然透视收敛角
  } = options;

  const positions = new Map<string, SpatialPosition>();
  let currentZ = 0;

  // 概念图多层交错高度（错落有致，高位高耸、中位端正、低位沉降）
  const Y_TIERS = [0.2, 1.2, -0.4, 0.8, -0.2, 1.4];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const prevPhoto = i > 0 ? photos[i - 1] : null;

    if (prevPhoto) {
      const timeDelta = Math.abs(photo.takenAtSort - prevPhoto.takenAtSort);
      const zDelta = dMin + alpha * Math.log(1 + timeDelta / tau);
      currentZ -= zDelta;
    } else {
      currentZ = 0;
    }

    const hashX = hashString(photo.id);
    const tierY = Y_TIERS[i % Y_TIERS.length];

    // 左右交错分布
    const side = i % 2 === 0 ? -1 : 1;
    const jitterX = ((hashX % 100) / 100 - 0.5) * 0.2;
    const x = side * (channelWidth + jitterX);
    const y = baseY + tierY;
    const z = currentZ;

    // 概念图同款向中央走廊的优雅内倾收敛透视
    const rotationY = -side * inwardAngle;
    const rotationX = 0;
    const rotationZ = 0;

    positions.set(photo.id, {
      x,
      y,
      z,
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

  // 视口焦点在相机前方约 6 ~ 10 个单位处
  const focusZ = cameraZ - 8;

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
