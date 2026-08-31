import * as THREE from 'three';

// 纹理全局缓存池
export const textureCache = new Map<string, THREE.Texture>();

const textureLoader = new THREE.TextureLoader();

// 简单的并发控制器：同时最多 4 个纹理在下载/解压，防止瞬时爆显存与主线程卡死
const MAX_CONCURRENT = 4;
let activeRequests = 0;
const queue: Array<() => void> = [];

function pumpQueue() {
  while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
    const nextTask = queue.shift();
    if (nextTask) {
      activeRequests++;
      nextTask();
    }
  }
}

/**
 * 安全的限流纹理加载器
 */
export function loadTextureThrottled(
  url: string,
  onSuccess: (texture: THREE.Texture) => void,
  onError?: () => void
): () => void {
  // 若已在缓存中，直接同步返回
  if (textureCache.has(url)) {
    onSuccess(textureCache.get(url)!);
    return () => {};
  }

  let isCanceled = false;

  const task = () => {
    if (isCanceled) {
      activeRequests--;
      pumpQueue();
      return;
    }

    textureLoader.load(
      url,
      (tex) => {
        activeRequests--;
        pumpQueue();
        if (isCanceled) return;

        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        textureCache.set(url, tex);
        onSuccess(tex);
      },
      undefined,
      () => {
        activeRequests--;
        pumpQueue();
        if (isCanceled) return;
        onError?.();
      }
    );
  };

  queue.push(task);
  pumpQueue();

  // 返回取消函数（若卡片快速滑出视野，直接从队列中丢弃）
  return () => {
    isCanceled = true;
    const index = queue.indexOf(task);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  };
}
