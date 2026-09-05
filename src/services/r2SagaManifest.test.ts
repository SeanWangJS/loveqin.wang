import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  registerPendingR2Upload,
  commitPendingR2Upload,
  recordRolledBackKeys,
  reconcileOrphanR2Keys,
  loadSagaManifest,
} from './r2SagaManifest';

const TEST_MANIFEST_PATH = path.resolve(process.cwd(), '.temp-test-saga-manifest.json');

describe('R2 Saga Durable Manifest & Reconciliation', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_MANIFEST_PATH)) {
      try { fs.unlinkSync(TEST_MANIFEST_PATH); } catch {}
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_MANIFEST_PATH)) {
      try { fs.unlinkSync(TEST_MANIFEST_PATH); } catch {}
    }
  });

  it('1. registerPendingR2Upload: 应该在磁盘创建持久化清单并记录待上传 keys', () => {
    const photoId = 'p_household_test_1';
    const keys = ['photos/p1_thumb_low.webp', 'photos/p1_thumb_high.webp', 'photos/p1_display.webp', 'photos/p1_orig.jpg'];

    registerPendingR2Upload(TEST_MANIFEST_PATH, 'test-bucket', photoId, keys);

    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(true);
    const manifest = loadSagaManifest(TEST_MANIFEST_PATH);
    expect(manifest).not.toBeNull();
    expect(manifest?.bucketName).toBe('test-bucket');
    expect(manifest?.pendingPhotos[photoId]).toBeDefined();
    expect(manifest?.pendingPhotos[photoId].keys).toEqual(keys);
  });

  it('2. commitPendingR2Upload: 数据库事务提交后，应当移除该照片并在无剩余照片时删除清单文件', () => {
    const photoId = 'p_household_test_2';
    const keys = ['photos/p2_thumb.webp'];

    registerPendingR2Upload(TEST_MANIFEST_PATH, 'test-bucket', photoId, keys);
    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(true);

    commitPendingR2Upload(TEST_MANIFEST_PATH, photoId);
    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(false);
  });

  it('3. recordRolledBackKeys: 回滚成功部分 key 时保留未成功 key；全部回滚后删除清单', () => {
    const photoId = 'p_household_test_3';
    const keys = ['photos/k1.webp', 'photos/k2.webp', 'photos/k3.webp'];

    registerPendingR2Upload(TEST_MANIFEST_PATH, 'test-bucket', photoId, keys);

    // 假设 k1, k2 回滚成功，k3 失败
    recordRolledBackKeys(TEST_MANIFEST_PATH, photoId, ['photos/k1.webp', 'photos/k2.webp']);

    let manifest = loadSagaManifest(TEST_MANIFEST_PATH);
    expect(manifest?.pendingPhotos[photoId].keys).toEqual(['photos/k3.webp']);

    // 后续 k3 也回滚成功
    recordRolledBackKeys(TEST_MANIFEST_PATH, photoId, ['photos/k3.webp']);
    manifest = loadSagaManifest(TEST_MANIFEST_PATH);
    expect(manifest).toBeNull();
    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(false);
  });

  it('4. reconcileOrphanR2Keys: 启动自愈机制能够扫描遗留孤儿对象并调用 deleter 补偿清理', async () => {
    // 模拟上次进程崩溃遗留的 2 张照片的清单
    registerPendingR2Upload(TEST_MANIFEST_PATH, 'test-bucket', 'p_orphan_1', ['photos/o1.webp', 'photos/o2.webp']);
    registerPendingR2Upload(TEST_MANIFEST_PATH, 'test-bucket', 'p_orphan_2', ['photos/o3.webp']);

    const mockDeleter = vi.fn().mockImplementation(async (bucket: string, keys: string[]) => {
      expect(bucket).toBe('test-bucket');
      return {
        succeeded: keys,
        failed: [],
      };
    });

    const res = await reconcileOrphanR2Keys(TEST_MANIFEST_PATH, mockDeleter);

    expect(res.totalOrphans).toBe(3);
    expect(res.recovered).toEqual(['photos/o1.webp', 'photos/o2.webp', 'photos/o3.webp']);
    expect(res.failed).toEqual([]);
    expect(mockDeleter).toHaveBeenCalledTimes(1);

    // 所有孤儿均已清理，清单文件应当被自动解绑删除
    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(false);
  });

  it('5. reconcileOrphanR2Keys: 若自愈删除有失败项，应保留失败项供下次重试', async () => {
    registerPendingR2Upload(TEST_MANIFEST_PATH, 'test-bucket', 'p_orphan_fail', ['photos/f1.webp', 'photos/f2.webp']);

    const mockDeleter = vi.fn().mockResolvedValue({
      succeeded: ['photos/f1.webp'],
      failed: ['photos/f2.webp'],
    });

    const res = await reconcileOrphanR2Keys(TEST_MANIFEST_PATH, mockDeleter);

    expect(res.totalOrphans).toBe(2);
    expect(res.recovered).toEqual(['photos/f1.webp']);
    expect(res.failed).toEqual(['photos/f2.webp']);

    // 清单文件应仍然存在，且只保留 photos/f2.webp
    expect(fs.existsSync(TEST_MANIFEST_PATH)).toBe(true);
    const manifest = loadSagaManifest(TEST_MANIFEST_PATH);
    expect(manifest?.pendingPhotos['p_orphan_fail'].keys).toEqual(['photos/f2.webp']);
  });
});
