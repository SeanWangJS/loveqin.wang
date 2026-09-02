import { PhotoItem } from '../types/gallery';

/**
 * 确定性伪随机数生成器 (Mulberry32)
 * 给定固定的 32 位整数种子，产出严密、均匀且绝对恒定的伪随机数列
 */
function createMulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 确定性字符串哈希 (DJB2 变体)
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 概念图同款：【时空邻近滑动窗口 + 确定性 Fisher-Yates 洗牌算法】
 * 
 * 算法目标：
 * 1. 杜绝同一照片在伴生层简单复制 9 份导致的视觉重复；
 * 2. 保证每张主照片周围的 9 个全息伴生虚影卡片互不相同、丰富多彩；
 * 3. 优先从同时间段/同画册前后邻近的照片群落中抽取，保持色调与故事氛围的和谐呼应；
 * 4. 严格确定性：相同照片集下多次计算结果绝对恒定，避免重渲染或贴图刷新引起的跳动。
 */
export function buildDeterministicGhostMap(
  photos: PhotoItem[],
  layerCount = 9
): Map<string, PhotoItem[]> {
  const map = new Map<string, PhotoItem[]>();
  const N = photos.length;
  if (N === 0) return map;

  photos.forEach((photo, i) => {
    if (N === 1) {
      map.set(photo.id, Array(layerCount).fill(photo));
      return;
    }

    // 1. 构建候选池：优先选取前后邻近的时空群落（窗口范围最多 24 张，兼顾主题呼应与多样性）
    const windowSize = Math.min(N - 1, 24);
    const candidates: PhotoItem[] = [];

    // 交替从左右邻居抽取：+1, -1, +2, -2, ...
    for (let step = 1; candidates.length < windowSize; step++) {
      const right = (i + step) % N;
      if (right !== i && !candidates.some((p) => p.id === photos[right].id)) {
        candidates.push(photos[right]);
      }
      if (candidates.length >= windowSize) break;

      const left = (i - step + N) % N;
      if (left !== i && !candidates.some((p) => p.id === photos[left].id)) {
        candidates.push(photos[left]);
      }
    }

    // 2. 使用以主照片 ID 为种子的确定性 PRNG 对候选池执行 Fisher-Yates 洗牌
    const seed = hashString(photo.id) + 1337;
    const rng = createMulberry32(seed);
    const shuffled = [...candidates];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      const temp = shuffled[k];
      shuffled[k] = shuffled[j];
      shuffled[j] = temp;
    }

    // 3. 截取前 layerCount 张照片作为该主照片的伴生虚影
    const selected: PhotoItem[] = [];
    for (let layer = 0; layer < layerCount; layer++) {
      selected.push(shuffled[layer % shuffled.length]);
    }

    map.set(photo.id, selected);
  });

  return map;
}
