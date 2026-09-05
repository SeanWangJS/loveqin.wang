import { eq, and } from 'drizzle-orm';
import { AppDatabase } from '../drizzle/db';
import * as schema from '../drizzle/schema';
import { generateId, generateSecureToken } from './cryptoUtils';
import { buildPhotoAssetKey, PhotoVariant } from './assetKeyUtils';

export interface StorageBucket {
  head(key: string): Promise<{ size: number; etag?: string; httpMetadata?: Record<string, string> } | null>;
  get?(key: string): Promise<any>;
  put?(key: string, value: any): Promise<any>;
  delete?(key: string | string[]): Promise<void>;
}

export function createMemoryStorage(initialKeys: Record<string, { size: number }> = {}): StorageBucket {
  const store = new Map<string, { size: number }>(Object.entries(initialKeys));
  return {
    head: async (key: string) => store.get(key) || null,
    get: async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return { size: item.size, body: null };
    },
    put: async (key: string, data?: { size?: number }) => {
      store.set(key, { size: data?.size ?? 1024 });
    },
    delete: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((k) => store.delete(k));
    },
  };
}

export interface UploadFileInput {
  filename: string;
  byteSize: number;
  mimeType: string;
}

export interface CompleteUploadMeta {
  r2KeyOriginal: string;
  width: number;
  height: number;
  byteSize?: number;
  exifSafeData?: Record<string, any>;
  locationName?: string;
  takenAtTimestamp?: number;
  variants?: Array<{
    variant: PhotoVariant;
    r2Key?: string;
    byteSize?: number;
    width?: number;
    height?: number;
    mimeType?: string;
  }>;
}

export class MediaService {
  constructor(
    private db: AppDatabase,
    private storage?: StorageBucket
  ) {}

  /**
   * 开启批量上传会话（创建 pending 记录并下发 R2 Key）
   */
  async createUploadBatch(
    householdId: string,
    actorUserId: string,
    albumId: string,
    files: UploadFileInput[]
  ) {
    if (files.length > 200) {
      throw new Error('BATCH_LIMIT_EXCEEDED: 单批上传最多支持 200 个文件');
    }

    const now = Date.now();
    const results = [];

    for (const file of files) {
      if (file.byteSize > 50 * 1024 * 1024) {
        throw new Error(`FILE_TOO_LARGE: 文件 ${file.filename} 超出 50MiB 大小限制`);
      }

      const photoId = generateId('p');
      const extMatch = file.filename.match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0].toLowerCase() : '.jpg';
      const r2KeyOriginal = buildPhotoAssetKey(householdId, photoId, 'original', ext);

      // 插入 pending 状态的照片记录
      this.db.insert(schema.photos).values({
        id: photoId,
        householdId,
        albumId,
        originalFilename: file.filename,
        takenAtSort: now,
        takenAtLocal: new Date(now).toISOString().slice(0, 19).replace('T', ' '),
        status: 'pending',
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      }).run();

      results.push({
        photoId,
        filename: file.filename,
        r2KeyOriginal,
        uploadUrl: `/api/uploads/direct/${photoId}`, // 模拟/实际 R2 预签名 PUT 目标
      });
    }

    return results;
  }

  /**
   * 完成原图写入并生成派生资源（必须前置校验 R2 真实存在后方可推进为 ready）
   */
  async completeUpload(
    householdId: string,
    photoId: string,
    meta: CompleteUploadMeta,
    storage?: StorageBucket
  ) {
    const effectiveStorage = storage || this.storage;
    if (!effectiveStorage) {
      throw new Error('STORAGE_BINDING_REQUIRED: 确认上传必须提供 StorageBucket 以确认 R2 资产真实存在');
    }

    const now = Date.now();
    const takenAt = meta.takenAtTimestamp || now;
    const dateStr = new Date(takenAt).toISOString().slice(0, 19).replace('T', ' ');

    // 1. 资产变体列表准备
    const customVariants = meta.variants || [];
    const variants: Array<{
      variant: PhotoVariant;
      r2Key: string;
      byteSize: number;
      width: number;
      height: number;
      mimeType: string;
    }> = [
      {
        variant: 'original',
        r2Key: meta.r2KeyOriginal,
        byteSize: meta.byteSize || 0,
        width: meta.width,
        height: meta.height,
        mimeType: 'image/jpeg',
      },
      {
        variant: 'display',
        r2Key: buildPhotoAssetKey(householdId, photoId, 'display'),
        byteSize: 0,
        width: meta.width,
        height: meta.height,
        mimeType: 'image/webp',
      },
      {
        variant: 'thumb_high',
        r2Key: buildPhotoAssetKey(householdId, photoId, 'thumb_high'),
        byteSize: 0,
        width: 1024,
        height: Math.round((1024 / (meta.width || 1024)) * (meta.height || 680)),
        mimeType: 'image/webp',
      },
      {
        variant: 'thumb_low',
        r2Key: buildPhotoAssetKey(householdId, photoId, 'thumb_low'),
        byteSize: 0,
        width: 256,
        height: Math.round((256 / (meta.width || 256)) * (meta.height || 170)),
        mimeType: 'image/webp',
      },
    ];

    // 如果传入了自定义变体，合并覆盖
    for (const custom of customVariants) {
      const idx = variants.findIndex((v) => v.variant === custom.variant);
      if (idx >= 0) {
        if (custom.r2Key) variants[idx].r2Key = custom.r2Key;
        if (custom.byteSize) variants[idx].byteSize = custom.byteSize;
        if (custom.width) variants[idx].width = custom.width;
        if (custom.height) variants[idx].height = custom.height;
        if (custom.mimeType) variants[idx].mimeType = custom.mimeType;
      } else {
        variants.push({
          variant: custom.variant,
          r2Key: custom.r2Key || buildPhotoAssetKey(householdId, photoId, custom.variant),
          byteSize: custom.byteSize || 0,
          width: custom.width || meta.width,
          height: custom.height || meta.height,
          mimeType: custom.mimeType || 'image/webp',
        });
      }
    }

    // 2. 前置存在性检查与真实 ByteSize 提取：必须确认所有变体在 R2 真实存在
    for (const v of variants) {
      const headRes = await effectiveStorage.head(v.r2Key);
      if (!headRes) {
        // 关键防御：对象缺失，严禁发布为 ready！
        // 状态标记为 failed 并保存错误详情
        this.db
          .update(schema.photos)
          .set({
            status: 'failed',
            processingError: `R2_OBJECT_NOT_FOUND: 关键资源 ${v.r2Key} 在对象存储中不存在`,
            updatedAt: now,
          })
          .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
          .run();

        // 写入 media_jobs 待重试任务
        this.db
          .insert(schema.mediaJobs)
          .values({
            id: generateId('job'),
            photoId,
            jobType: 'derive_lods',
            status: 'pending',
            attempts: 1,
            maxAttempts: 3,
            availableAt: now,
            lastErrorCode: 'OBJECT_NOT_FOUND',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();

        throw new Error(`OBJECT_NOT_FOUND: 无法推进状态至 ready，R2 资产对象不存在: ${v.r2Key}`);
      }

      // 采用 R2 head 获取到的真实物理大小，彻底废除粗糙估算
      v.byteSize = headRes.size;
    }

    // 3. 事务包裹：确认无误后原子写入资产表并推进 photos 状态至 ready
    this.db.transaction((tx) => {
      for (const v of variants) {
        tx.insert(schema.photoAssets)
          .values({
            id: generateId('ast'),
            photoId,
            variant: v.variant,
            r2Key: v.r2Key,
            mimeType: v.mimeType,
            byteSize: v.byteSize,
            width: v.width,
            height: v.height,
          })
          .onConflictDoUpdate({
            target: [schema.photoAssets.photoId, schema.photoAssets.variant],
            set: {
              r2Key: v.r2Key,
              byteSize: v.byteSize,
              width: v.width,
              height: v.height,
            },
          })
          .run();
      }

      tx.update(schema.photos)
        .set({
          status: 'ready',
          processingError: null,
          width: meta.width,
          height: meta.height,
          takenAtSort: takenAt,
          takenAtLocal: dateStr,
          locationName: meta.locationName || '未命名地点',
          exifSafeJson: meta.exifSafeData ? JSON.stringify(meta.exifSafeData) : null,
          updatedAt: now,
        })
        .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
        .run();
    });

    return { photoId, status: 'ready' };
  }

  /**
   * 签发 5 分钟短期原图下载链接
   */
  async generatePresignedDownloadUrl(householdId: string, userId: string, photoId: string) {
    // 校验成员关系
    const member = this.db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, userId),
          eq(schema.householdMembers.status, 'active')
        )
      )
      .get();

    if (!member) {
      throw new Error('FORBIDDEN: 无权下载该空间原图');
    }

    const photo = this.db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
      .get();

    if (!photo) {
      throw new Error('NOT_FOUND: 照片不存在');
    }

    const token = generateSecureToken();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 分钟有效期

    return {
      downloadUrl: `/api/download/direct/${photoId}?token=${token}&exp=${expiresAt}`,
      expiresAt,
      filename: photo.originalFilename,
    };
  }
}
