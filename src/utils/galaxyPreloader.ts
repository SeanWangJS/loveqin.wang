import { useGalleryStore } from '../stores/useGalleryStore';
import { globalTexturePool } from './textureLRUPool';

interface PreloadOptions {
  onProgress?: (percent: number) => void;
  onComplete?: () => void;
  minDurationMs?: number;
}

let activePreloadSession: {
  cancel: () => void;
} | null = null;

/**
 * 银河系加载阶段首屏纹理并行预热与平滑进度调度器
 * 只有初始相机可见范围内的纹理全部完成（高清或低清 fallback）后才推进至 100%
 */
export function startGalaxyPreload({
  onProgress,
  onComplete,
  minDurationMs = 2000,
}: PreloadOptions = {}) {
  // 如果已有进行中的 session，先取消
  if (activePreloadSession) {
    activePreloadSession.cancel();
  }

  const { photos, positions, maxZ } = useGalleryStore.getState();

  // 1. 预加载初始相机可见范围内的全部卡片，避免进入后仍出现大片占位图。
  //    更深处的卡片仍由 PhotoCard 按需懒加载，避免大相册启动时下载全部资源。
  const sortedPhotos = [...photos].sort((a, b) => {
    const posA = positions.get(a.id);
    const posB = positions.get(b.id);
    const distA = posA ? Math.abs(maxZ - posA.z) : 9999;
    const distB = posB ? Math.abs(maxZ - posB.z) : 9999;
    return distA - distB;
  });

  const initialVisiblePhotos = sortedPhotos.filter((photo) => {
    const position = positions.get(photo.id);
    if (!position) return false;
    const zDiff = maxZ - position.z;
    return zDiff >= -15 && zDiff <= 110;
  });
  const priorityPhotos = initialVisiblePhotos.length > 0 ? initialVisiblePhotos : sortedPhotos.slice(0, 8);
  const totalAssets = Math.max(1, priorityPhotos.length);
  let settledAssets = 0;
  let isCancelled = false;
  let isCompleted = false;

  const cancelCallbacks: Array<() => void> = [];

  const startTime = performance.now();
  let displayedProgress = 0;

  const markOneSettled = () => {
    if (isCancelled) return;
    settledAssets++;
  };

  // 2. 并行调用 LRU 显存池加载首屏纹理（容错：成功或失败均标记为已处理）
  if (priorityPhotos.length > 0) {
    priorityPhotos.forEach((photo) => {
      let cancelLow: (() => void) | null = null;

      const cancelHigh = globalTexturePool.load(
        photo.urlThumbHigh,
        () => {
          markOneSettled();
        },
        () => {
          // Fallback to low res
          cancelLow = globalTexturePool.load(
            photo.urlThumbLow,
            () => {
              markOneSettled();
            },
            () => {
              // 失败或本地 mock 占位同样视为已决
              markOneSettled();
            }
          );
        }
      );

      cancelCallbacks.push(() => {
        cancelHigh();
        cancelLow?.();
      });
    });
  } else {
    settledAssets = totalAssets;
  }

  let rafId = 0;

  const updateLoop = (now: number) => {
    if (isCancelled || isCompleted) return;

    const elapsed = now - startTime;
    const timeProgress = Math.min(1, elapsed / minDurationMs);
    const isAllAssetsSettled = settledAssets >= totalAssets;

    // 目标进度计算：只有全部初始可见资源已决，目标才允许推进到 100%。
    let targetPercent = 0;
    if (isAllAssetsSettled) {
      targetPercent = Math.min(100, Math.floor(timeProgress * 100));
      if (elapsed >= minDurationMs) {
        targetPercent = 100;
      }
    } else {
      targetPercent = Math.min(92, Math.floor(timeProgress * 92));
    }

    if (displayedProgress < targetPercent) {
      const step = Math.max(1, (targetPercent - displayedProgress) * 0.18);
      displayedProgress += step;
      if (displayedProgress > 100) displayedProgress = 100;
    }

    const roundedProgress = Math.min(100, Math.round(displayedProgress));
    useGalleryStore.getState().setLoadingProgress(roundedProgress);
    onProgress?.(roundedProgress);

    // 达成 100% 条件
    if (roundedProgress >= 100 && isAllAssetsSettled && elapsed >= minDurationMs) {
      isCompleted = true;
      useGalleryStore.getState().setLoadingProgress(100);
      onProgress?.(100);
      onComplete?.();
      return;
    }

    rafId = requestAnimationFrame(updateLoop);
  };

  rafId = requestAnimationFrame(updateLoop);

  const cancel = () => {
    isCancelled = true;
    cancelAnimationFrame(rafId);
    cancelCallbacks.forEach((cb) => cb());
  };

  activePreloadSession = { cancel };
  return activePreloadSession;
}
