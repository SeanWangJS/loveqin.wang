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
  dMin?: number;        // 最小卡片物理间距，推荐 3.2
  alpha?: number;       // 对数时间拉伸系数，推荐 2.4
  tau?: number;         // 时间基准分母（默认 1 天 = 86400000 ms）
  channelWidth?: number;// 中央长廊通道半宽，推荐 4.4
  baseY?: number;       // 基准视线高度，推荐 0.2
  inwardAngle?: number; // 向内偏转弧度，推荐 0.26 弧度
}

/**
 * 将有序照片集计算为 3D 时光隧道中的多层立体展廊坐标
 */
export function computeTunnelPositions(
  photos: PhotoItem[],
  options: SpatialMappingOptions = {}
): Map<string, SpatialPosition> {
  const {
    dMin = 3.2,
    alpha = 2.4,
    tau = 86400000,
    channelWidth = 4.5,
    baseY = 0.2,
    inwardAngle = 0.26,
  } = options;

  const positions = new Map<string, SpatialPosition>();
  let currentZ = 0;

  // 概念图中的多层交错高度阵列（高中低三层错落展廊）
  const Y_TIERS = [-0.65, 0.35, 1.45, 0.1, 0.85, -0.3];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const prevPhoto = i > 0 ? photos[i - 1] : null;

    if (prevPhoto) {
      const timeDelta = Math.abs(photo.takenAtSort - prevPhoto.takenAtSort);
      // 非线性对数深度压缩增量
      const zDelta = dMin + alpha * Math.log(1 + timeDelta / tau);
      currentZ -= zDelta;
    } else {
      currentZ = 0;
    }

    const hashX = hashString(photo.id);
    const hashY = hashString(photo.id + '_y');

    // 稳定微弱抖动扰动
    const jitterX = ((hashX % 100) / 100 - 0.5) * 0.4;
    const tierY = Y_TIERS[i % Y_TIERS.length];

    // 左右交错分布
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (channelWidth + jitterX);
    const y = baseY + tierY;
    const z = currentZ;

    // 朝向中央光轨的微弱向内偏转角（形成包围弧度）
    const rotationY = side * inwardAngle;
    const rotationX = ((hashX % 50) / 50 - 0.5) * 0.02;
    const rotationZ = ((hashY % 50) / 50 - 0.5) * 0.02;

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
