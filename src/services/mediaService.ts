import { eq, and } from 'drizzle-orm';
import { AppDatabase } from '../drizzle/db';
import * as schema from '../drizzle/schema';
import { generateId, generateSecureToken } from './cryptoUtils';
import { buildPhotoAssetKey } from './assetKeyUtils';

export interface UploadFileInput {
  filename: string;
  byteSize: number;
  mimeType: string;
}

export class MediaService {
  constructor(private db: AppDatabase) {}

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
      const randomKey = generateSecureToken().slice(0, 16);
      const r2KeyOriginal = `originals/${householdId}/${photoId}_${randomKey}_${file.filename}`;

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
   * 完成原图写入并生成派生资源（状态流转为 ready）
   */
  async completeUpload(
    householdId: string,
    photoId: string,
    meta: {
      r2KeyOriginal: string;
      width: number;
      height: number;
      byteSize: number;
      exifSafeData?: Record<string, any>;
      locationName?: string;
      takenAtTimestamp?: number;
    }
  ) {
    const now = Date.now();
    const takenAt = meta.takenAtTimestamp || now;
    const dateStr = new Date(takenAt).toISOString().slice(0, 19).replace('T', ' ');

    // 1. 更新照片主表状态为 ready
    this.db
      .update(schema.photos)
      .set({
        status: 'ready',
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

    // 2. 插入多级 LOD 资产记录
    const variants = [
      { variant: 'original', r2Key: meta.r2KeyOriginal, byteSize: meta.byteSize },
      { variant: 'display', r2Key: buildPhotoAssetKey(householdId, photoId, 'display'), byteSize: Math.floor(meta.byteSize * 0.15) },
      { variant: 'thumb_high', r2Key: buildPhotoAssetKey(householdId, photoId, 'thumb_high'), byteSize: Math.floor(meta.byteSize * 0.05) },
      { variant: 'thumb_low', r2Key: buildPhotoAssetKey(householdId, photoId, 'thumb_low'), byteSize: 15 * 1024 },
    ];

    for (const v of variants) {
      this.db.insert(schema.photoAssets).values({
        id: generateId('ast'),
        photoId,
        variant: v.variant,
        r2Key: v.r2Key,
        mimeType: v.variant === 'original' ? 'image/jpeg' : 'image/webp',
        byteSize: v.byteSize,
        width: v.variant === 'thumb_low' ? 256 : v.variant === 'thumb_high' ? 1024 : meta.width,
        height: v.variant === 'thumb_low' ? 170 : v.variant === 'thumb_high' ? 680 : meta.height,
      }).run();
    }

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
