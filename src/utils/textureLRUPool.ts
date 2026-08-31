import * as THREE from 'three';

interface LRUEntry {
  url: string;
  texture: THREE.Texture;
  lastUsedAt: number;
}

export class TextureLRUPool {
  private cache = new Map<string, LRUEntry>();
  private maxCapacity: number;
  private textureLoader = new THREE.TextureLoader();
  private maxConcurrent = 4;
  private activeRequests = 0;
  private queue: Array<() => void> = [];

  constructor(maxCapacity = 50) {
    this.maxCapacity = maxCapacity;
  }

  public get size(): number {
    return this.cache.size;
  }

  private pumpQueue() {
    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        this.activeRequests++;
        nextTask();
      }
    }
  }

  /**
   * 淘汰最久未使用的纹理并调用 texture.dispose() 彻底释放 GPU 显存
   */
  private evictLRU() {
    if (this.cache.size <= this.maxCapacity) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [url, entry] of this.cache.entries()) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = url;
      }
    }

    if (oldestKey) {
      const evicted = this.cache.get(oldestKey);
      if (evicted) {
        evicted.texture.dispose();
      }
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 获取或加载纹理（带自动 LRU 淘汰与并发限流）
   */
  public load(
    url: string,
    onSuccess: (tex: THREE.Texture) => void,
    onError?: () => void
  ): () => void {
    const existing = this.cache.get(url);
    if (existing) {
      existing.lastUsedAt = Date.now();
      onSuccess(existing.texture);
      return () => {};
    }

    let isCanceled = false;

    const task = () => {
      if (isCanceled) {
        this.activeRequests--;
        this.pumpQueue();
        return;
      }

      this.textureLoader.load(
        url,
        (loadedTex) => {
          this.activeRequests--;
          this.pumpQueue();
          if (isCanceled) {
            loadedTex.dispose();
            return;
          }

          loadedTex.colorSpace = THREE.SRGBColorSpace;
          loadedTex.generateMipmaps = true;
          loadedTex.minFilter = THREE.LinearMipmapLinearFilter;

          this.cache.set(url, {
            url,
            texture: loadedTex,
            lastUsedAt: Date.now(),
          });

          this.evictLRU();
          onSuccess(loadedTex);
        },
        undefined,
        () => {
          this.activeRequests--;
          this.pumpQueue();
          if (isCanceled) return;
          onError?.();
        }
      );
    };

    this.queue.push(task);
    this.pumpQueue();

    return () => {
      isCanceled = true;
      const idx = this.queue.indexOf(task);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
      }
    };
  }

  /**
   * 智能预加载前方卡片贴图
   */
  public prefetch(urls: string[]) {
    urls.forEach((url) => {
      if (!this.cache.has(url)) {
        this.load(url, () => {}, () => {});
      }
    });
  }

  public clear() {
    for (const entry of this.cache.values()) {
      entry.texture.dispose();
    }
    this.cache.clear();
    this.queue = [];
  }
}

// 全局单例 LRU 贴图池（上限 50 张）
export const globalTexturePool = new TextureLRUPool(50);
