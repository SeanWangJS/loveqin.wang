import { eq, and, desc, asc, isNull, sql } from 'drizzle-orm';
import { AppDatabase } from '../drizzle/db';
import * as schema from '../drizzle/schema';
import { generateId } from './cryptoUtils';

export interface PhotoListOptions {
  albumId?: string;
  searchQuery?: string;
  limit?: number;
}

export class PhotoService {
  constructor(private db: AppDatabase) {}

  /**
   * 查询已就绪（Ready）的照片列表（支持相册过滤与关键词检索）
   */
  async listPhotos(householdId: string, options: PhotoListOptions = {}) {
    const conditions = [
      eq(schema.photos.householdId, householdId),
      eq(schema.photos.status, 'ready'),
      isNull(schema.photos.deletedAt),
    ];

    if (options.albumId) {
      conditions.push(eq(schema.photos.albumId, options.albumId));
    }

    const query = this.db
      .select({
        id: schema.photos.id,
        albumId: schema.photos.albumId,
        title: schema.photos.title,
        story: schema.photos.story,
        takenAtSort: schema.photos.takenAtSort,
        takenAtLocal: schema.photos.takenAtLocal,
        locationName: schema.photos.locationName,
        width: schema.photos.width,
        height: schema.photos.height,
        exifSafeJson: schema.photos.exifSafeJson,
      })
      .from(schema.photos)
      .where(and(...conditions))
      .orderBy(asc(schema.photos.takenAtSort));

    const rows = query.all();

    // 关联查询对应的 photo_assets 资源路径与点赞数
    return rows.map((photo) => {
      const assets = this.db
        .select()
        .from(schema.photoAssets)
        .where(eq(schema.photoAssets.photoId, photo.id))
        .all();

      const lowAsset = assets.find((a) => a.variant === 'thumb_low');
      const highAsset = assets.find((a) => a.variant === 'thumb_high');
      const displayAsset = assets.find((a) => a.variant === 'display');

      const likesCount = this.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.likes)
        .where(eq(schema.likes.photoId, photo.id))
        .get()?.count || 0;

      let exif = {};
      try {
        if (photo.exifSafeJson) {
          exif = JSON.parse(photo.exifSafeJson);
        }
      } catch {}

      return {
        id: photo.id,
        albumId: photo.albumId,
        title: photo.title || '无题回忆',
        story: photo.story || '',
        takenAt: photo.takenAtSort,
        takenAtSort: photo.takenAtSort,
        takenAtLocal: photo.takenAtLocal,
        locationName: photo.locationName || '未知地点',
        width: photo.width || 1920,
        height: photo.height || 1080,
        urlThumbLow: lowAsset ? `/api/media/${photo.id}/thumb_low` : '',
        urlThumbHigh: highAsset ? `/api/media/${photo.id}/thumb_high` : '',
        urlDisplay: displayAsset ? `/api/media/${photo.id}/display` : '',
        exif,
        likesCount,
      };
    });
  }

  /**
   * 查询单张照片详情与留言互动
   */
  async getPhotoDetail(householdId: string, photoId: string, currentUserId: string) {
    const photo = this.db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
      .get();

    if (!photo) {
      throw new Error('NOT_FOUND: 照片不存在');
    }

    const comments = this.db
      .select({
        id: schema.comments.id,
        content: schema.comments.content,
        createdAt: schema.comments.createdAt,
        user: {
          id: schema.users.id,
          displayName: schema.users.displayName,
        },
      })
      .from(schema.comments)
      .innerJoin(schema.users, eq(schema.comments.userId, schema.users.id))
      .where(and(eq(schema.comments.photoId, photoId), isNull(schema.comments.deletedAt)))
      .orderBy(asc(schema.comments.createdAt))
      .all();

    const isLiked = !!this.db
      .select()
      .from(schema.likes)
      .where(and(eq(schema.likes.photoId, photoId), eq(schema.likes.userId, currentUserId)))
      .get();

    const likesCount = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.likes)
      .where(eq(schema.likes.photoId, photoId))
      .get()?.count || 0;

    return {
      photo,
      comments,
      isLiked,
      likesCount,
    };
  }

  /**
   * Owner 修改照片信息（时间、地点、故事、标题）
   */
  async updatePhoto(
    householdId: string,
    _actorUserId: string,
    photoId: string,
    updates: {
      title?: string;
      story?: string;
      locationName?: string;
      takenAtSort?: number;
    }
  ) {
    const now = Date.now();
    this.db
      .update(schema.photos)
      .set({
        ...updates,
        updatedAt: now,
      })
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
      .run();
  }

  /**
   * 移入回收站（30 天软删除）
   */
  async trashPhoto(householdId: string, _actorUserId: string, photoId: string) {
    const now = Date.now();
    const purgeAfter = now + 30 * 86400000;

    this.db
      .update(schema.photos)
      .set({
        status: 'trashed',
        deletedAt: now,
        purgeAfter,
        updatedAt: now,
      })
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
      .run();
  }

  /**
   * 从回收站一键恢复
   */
  async restorePhoto(householdId: string, _actorUserId: string, photoId: string) {
    const now = Date.now();
    this.db
      .update(schema.photos)
      .set({
        status: 'ready',
        deletedAt: null,
        purgeAfter: null,
        updatedAt: now,
      })
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
      .run();
  }

  /**
   * 查询回收站照片列表
   */
  async listTrash(householdId: string) {
    return this.db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.status, 'trashed')))
      .orderBy(desc(schema.photos.deletedAt))
      .all();
  }

  /**
   * 永久清理彻底删除照片
   */
  async purgePhoto(householdId: string, _actorUserId: string, photoId: string) {
    this.db
      .delete(schema.photos)
      .where(and(eq(schema.photos.householdId, householdId), eq(schema.photos.id, photoId)))
      .run();
  }

  /**
   * 幂等点赞与取消点赞
   */
  async toggleLike(userId: string, photoId: string) {
    const existing = this.db
      .select()
      .from(schema.likes)
      .where(and(eq(schema.likes.photoId, photoId), eq(schema.likes.userId, userId)))
      .get();

    if (existing) {
      this.db
        .delete(schema.likes)
        .where(and(eq(schema.likes.photoId, photoId), eq(schema.likes.userId, userId)))
        .run();
      return { liked: false };
    } else {
      this.db.insert(schema.likes).values({
        photoId,
        userId,
        createdAt: Date.now(),
      }).run();
      return { liked: true };
    }
  }

  /**
   * 发表时光寄语留言
   */
  async addComment(userId: string, photoId: string, content: string) {
    const commentId = generateId('cmt');
    const now = Date.now();

    this.db.insert(schema.comments).values({
      id: commentId,
      photoId,
      userId,
      content: content.trim(),
      createdAt: now,
    }).run();

    return {
      commentId,
      createdAt: now,
    };
  }
}
