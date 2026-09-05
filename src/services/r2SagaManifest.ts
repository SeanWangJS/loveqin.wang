import fs from 'fs';
import path from 'path';

export const DEFAULT_SAGA_MANIFEST_FILE = '.r2-saga-manifest.json';

export interface PendingPhotoRecord {
  photoId: string;
  keys: string[];
  registeredAt: number;
}

export interface R2SagaManifest {
  bucketName: string;
  updatedAt: number;
  pendingPhotos: Record<string, PendingPhotoRecord>;
}

export interface ReconciliationResult {
  totalOrphans: number;
  recovered: string[];
  failed: string[];
}

/**
 * 读取本地持久化 Saga 清单文件
 */
export function loadSagaManifest(manifestPath: string): R2SagaManifest | null {
  try {
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as R2SagaManifest;
    if (parsed && typeof parsed === 'object' && parsed.pendingPhotos) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn(`[SagaManifest] 读取清单文件失败 (${manifestPath}):`, err);
    return null;
  }
}

/**
 * 保存本地持久化 Saga 清单文件；若待处理照片列表为空则自动移除清单文件
 */
export function saveSagaManifest(manifestPath: string, manifest: R2SagaManifest): void {
  try {
    const photoIds = Object.keys(manifest.pendingPhotos);
    if (photoIds.length === 0) {
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
      }
      return;
    }

    manifest.updatedAt = Date.now();
    const tempPath = `${manifestPath}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tempPath, manifestPath);
  } catch (err) {
    console.error(`[SagaManifest] 写入清单文件失败 (${manifestPath}):`, err);
  }
}

/**
 * 上传前预登记待上传的 R2 Key（如果中途断电/崩溃，Key 已落盘）
 */
export function registerPendingR2Upload(
  manifestPath: string,
  bucketName: string,
  photoId: string,
  keys: string[]
): void {
  const manifest: R2SagaManifest = loadSagaManifest(manifestPath) || {
    bucketName,
    updatedAt: Date.now(),
    pendingPhotos: {},
  };

  manifest.bucketName = bucketName;
  manifest.pendingPhotos[photoId] = {
    photoId,
    keys: Array.from(new Set(keys)),
    registeredAt: Date.now(),
  };

  saveSagaManifest(manifestPath, manifest);
}

/**
 * 数据库事务提交 ready 成功后，从清单中原子移除该照片
 */
export function commitPendingR2Upload(manifestPath: string, photoId: string): void {
  const manifest = loadSagaManifest(manifestPath);
  if (!manifest) return;

  if (manifest.pendingPhotos[photoId]) {
    delete manifest.pendingPhotos[photoId];
    saveSagaManifest(manifestPath, manifest);
  }
}

/**
 * 在回滚发生后，更新清单移除已成功删除的 Key；保留未删除成功的 Key 以备下次启动自愈
 */
export function recordRolledBackKeys(
  manifestPath: string,
  photoId: string,
  successfullyDeletedKeys: string[]
): void {
  const manifest = loadSagaManifest(manifestPath);
  if (!manifest) return;

  const record = manifest.pendingPhotos[photoId];
  if (!record) return;

  const deletedSet = new Set(successfullyDeletedKeys);
  const remainingKeys = record.keys.filter((k) => !deletedSet.has(k));

  if (remainingKeys.length === 0) {
    delete manifest.pendingPhotos[photoId];
  } else {
    record.keys = remainingKeys;
  }

  saveSagaManifest(manifestPath, manifest);
}

/**
 * 启动自愈机制：检查是否存在遗留清单，若存在则尝试调用 deleter 进行补偿删除
 */
export async function reconcileOrphanR2Keys(
  manifestPath: string,
  deleter: (bucketName: string, keys: string[]) => Promise<{ succeeded: string[]; failed: string[] }>
): Promise<ReconciliationResult> {
  const manifest = loadSagaManifest(manifestPath);
  if (!manifest) {
    return { totalOrphans: 0, recovered: [], failed: [] };
  }

  const allKeys: string[] = [];
  for (const record of Object.values(manifest.pendingPhotos)) {
    allKeys.push(...record.keys);
  }

  const uniqueKeys = Array.from(new Set(allKeys));
  if (uniqueKeys.length === 0) {
    if (fs.existsSync(manifestPath)) {
      try {
        fs.unlinkSync(manifestPath);
      } catch {}
    }
    return { totalOrphans: 0, recovered: [], failed: [] };
  }

  console.log(`\n🔍 [Saga 自愈] 检测到上次运行遗留的未提交 R2 对象清单: ${uniqueKeys.length} 个对象`);
  console.log(`   正在尝试执行孤儿对象清理补偿 (Bucket: ${manifest.bucketName})...`);

  const { succeeded, failed } = await deleter(manifest.bucketName, uniqueKeys);

  const succeededSet = new Set(succeeded);
  for (const [photoId, record] of Object.entries(manifest.pendingPhotos)) {
    record.keys = record.keys.filter((k) => !succeededSet.has(k));
    if (record.keys.length === 0) {
      delete manifest.pendingPhotos[photoId];
    }
  }

  saveSagaManifest(manifestPath, manifest);

  if (succeeded.length > 0) {
    console.log(`   ✓ [Saga 自愈] 成功清理 ${succeeded.length} 个遗留孤儿对象`);
  }
  if (failed.length > 0) {
    console.warn(`   ⚠️ [Saga 自愈] 仍有 ${failed.length} 个遗留孤儿对象清理失败，已保留在清单供下次重试`);
  }

  return {
    totalOrphans: uniqueKeys.length,
    recovered: succeeded,
    failed,
  };
}
