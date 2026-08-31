import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { TextureLRUPool } from './textureLRUPool';

describe('TextureLRUPool & GPU VRAM Management', () => {
  it('should maintain capacity limit and evict oldest textures', () => {
    const pool = new TextureLRUPool(3); // 容量为 3

    const fakeTex1 = new THREE.Texture();
    const fakeTex2 = new THREE.Texture();
    const fakeTex3 = new THREE.Texture();
    const fakeTex4 = new THREE.Texture();

    const disposeSpy1 = vi.spyOn(fakeTex1, 'dispose');

    // 内部手动测试 LRU 结构
    (pool as any).cache.set('url1', { url: 'url1', texture: fakeTex1, lastUsedAt: 100 });
    (pool as any).cache.set('url2', { url: 'url2', texture: fakeTex2, lastUsedAt: 200 });
    (pool as any).cache.set('url3', { url: 'url3', texture: fakeTex3, lastUsedAt: 300 });

    expect(pool.size).toBe(3);

    // 插入第 4 张贴图触发淘汰
    (pool as any).cache.set('url4', { url: 'url4', texture: fakeTex4, lastUsedAt: 400 });
    (pool as any).evictLRU();

    expect(pool.size).toBe(3);
    // 最旧的 url1 应当被淘汰并调用 dispose()
    expect((pool as any).cache.has('url1')).toBe(false);
    expect((pool as any).cache.has('url4')).toBe(true);
    expect(disposeSpy1).toHaveBeenCalledTimes(1);
  });

  it('should dispose all textures on clear', () => {
    const pool = new TextureLRUPool(10);
    const tex1 = new THREE.Texture();
    const tex2 = new THREE.Texture();
    const spy1 = vi.spyOn(tex1, 'dispose');
    const spy2 = vi.spyOn(tex2, 'dispose');

    (pool as any).cache.set('url1', { url: 'url1', texture: tex1, lastUsedAt: 100 });
    (pool as any).cache.set('url2', { url: 'url2', texture: tex2, lastUsedAt: 200 });

    pool.clear();
    expect(pool.size).toBe(0);
    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
  });
});
