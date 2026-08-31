import { PhotoItem, SpatialPosition } from '../types/gallery';

/**
 * 简易确定性字符串哈希，保证同一 ID 在任何设备刷新后扰动值恒定不变
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // 转换为 32 位整数
  }
  return Math.abs(hash);
}

export interface SpatialMappingOptions {
  dMin?: number;        // 最小卡片物理间距（防连拍重叠），推荐 3.5
  alpha?: number;       // 对数时间拉伸系数，推荐 2.5
  tau?: number;         // 时间基准分母（默认 1 天 = 86400000 ms）
  channelWidth?: number;// 中央长廊通道半宽，推荐 3.8 ~ 4.2
  baseY?: number;       // 基准视线高度，推荐 0.0
  inwardAngle?: number; // 向内偏转弧度，推荐 0.22 弧度 (~12.6度)
}

export interface YearPortalInfo {
  year: number;
  z: number;
  photoCount: number;
}

/**
 * 将有序照片集计算为 3D 时光隧道中的三维空间坐标与旋转角
 */
export function computeTunnelPositions(
  photos: PhotoItem[],
  options: SpatialMappingOptions = {}
): Map<string, SpatialPosition> {
  const {
    dMin = 3.5,
    alpha = 2.5,
    tau = 86400000,
    channelWidth = 4.0,
    baseY = 0.0,
    inwardAngle = 0.22,
  } = options;

  const positions = new Map<string, SpatialPosition>();
  let currentZ = 0;

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
    const jitterX = ((hashX % 100) / 100 - 0.5) * 0.5;
    const jitterY = ((hashY % 100) / 100 - 0.5) * 0.6;

    // 左右交错分布
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (channelWidth + jitterX);
    const y = baseY + (i % 4 < 2 ? 0.2 : -0.2) + jitterY;
    const z = currentZ;

    // 朝向中央光轨的微弱向内偏转角
    const rotationY = side * inwardAngle;
    const rotationX = ((hashX % 50) / 50 - 0.5) * 0.04;
    const rotationZ = ((hashY % 50) / 50 - 0.5) * 0.03;

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

/**
 * 计算年份交界处的时光之门挂载点 (Time Portal Gates)
 */
export function computeYearPortals(
  photos: PhotoItem[],
  positions: Map<string, SpatialPosition>
): YearPortalInfo[] {
  if (photos.length === 0) return [];

  const yearMap = new Map<number, { count: number; firstZ: number; lastZ: number }>();

  for (const photo of photos) {
    const d = new Date(photo.takenAtSort);
    const year = d.getFullYear();
    const pos = positions.get(photo.id);
    if (!pos) continue;

    if (!yearMap.has(year)) {
      yearMap.set(year, { count: 1, firstZ: pos.z, lastZ: pos.z });
    } else {
      const entry = yearMap.get(year)!;
      entry.count++;
      entry.lastZ = Math.min(entry.lastZ, pos.z);
    }
  }

  const portals: YearPortalInfo[] = [];
  const years = Array.from(yearMap.keys()).sort((a, b) => b - a); // 年份降序（最近 -> 最久远）

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const data = yearMap.get(year)!;

    // 时光之门设置在该年份第一张照片前方约 3.5 个单位处
    const portalZ = data.firstZ + 3.5;
    portals.push({
      year,
      z: portalZ,
      photoCount: data.count,
    });
  }

  return portals;
}
