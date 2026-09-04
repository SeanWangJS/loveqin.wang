import { useGalleryStore } from '../stores/useGalleryStore';
import { globalTexturePool } from './textureLRUPool';

interface PreloadOptions {
  onProgress?: (percent: number) => void;
  onComplete?: () => void;
  minDurationMs?: number;
  maxDurationMs?: number;
}

let activePreloadSession: {
  cancel: () => void;
  fastForward: () => void;
} | null = null;

/**
 * 银河系加载阶段首屏纹理并行预热与平滑进度调度器
 * 确保 100% 稳定推进至 100%，绝不发生由于单张网络纹理异常而卡在 88% 的问题
 */
export function startGalaxyPreload({
  onProgress,
  onComplete,
  minDurationMs = 2000,
  maxDurationMs = 2600,
}: PreloadOptions = {}) {
  // 如果已有进行中的 session，先取消
  if (activePreloadSession) {
    activePreloadSession.cancel();
  }

  const { photos, positions, maxZ } = useGalleryStore.getState();

  // 1. 筛选出首屏长廊相机初始位置（Z=12）最近的前 8 张卡片
  const sortedPhotos = [...photos].sort((a, b) => {
    const posA = positions.get(a.id);
    const posB = positions.get(b.id);
    const distA = posA ? Math.abs(maxZ - posA.z) : 9999;
    const distB = posB ? Math.abs(maxZ - posB.z) : 9999;
    return distA - distB;
  });

  const priorityPhotos = sortedPhotos.slice(0, 8);
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
    const isTimedOut = elapsed >= maxDurationMs;
    const isAllAssetsSettled = settledAssets >= totalAssets;

    // 目标进度计算：若全部资源已决或达到最高保护时长，目标直奔 100%；否则平滑到 92% 等待
    let targetPercent = 0;
    if (isAllAssetsSettled || isTimedOut) {
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
    if (roundedProgress >= 100 && (isAllAssetsSettled || isTimedOut || elapsed >= minDurationMs)) {
      isCompleted = true;
      useGalleryStore.getState().setLoadingProgress(100);
      onProgress?.(100);
      onComplete?.();
      return;
    }

    rafId = requestAnimationFrame(updateLoop);
  };

  rafId = requestAnimationFrame(updateLoop);

  const fastForward = () => {
    if (isCancelled || isCompleted) return;
    isCompleted = true;
    cancelAnimationFrame(rafId);
    useGalleryStore.getState().setLoadingProgress(100);
    onProgress?.(100);
    onComplete?.();
  };

  const cancel = () => {
    isCancelled = true;
    cancelAnimationFrame(rafId);
    cancelCallbacks.forEach((cb) => cb());
  };

  activePreloadSession = { cancel, fastForward };
  return activePreloadSession;
}

export function skipGalaxyPreload() {
  if (activePreloadSession) {
    activePreloadSession.fastForward();
  }
}
