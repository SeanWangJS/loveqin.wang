import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../drizzle/schema';
import { AuthService } from './authService';
import { PhotoService } from './photoService';
import { MediaService } from './mediaService';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      welcome_message TEXT,
      original_exif_policy TEXT DEFAULT 'preserve_all',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL UNIQUE,
      email_verified_at INTEGER,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_version INTEGER DEFAULT 1 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE household_members (
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      joined_at INTEGER NOT NULL,
      removed_at INTEGER,
      PRIMARY KEY (household_id, user_id)
    );

    CREATE TABLE member_invitations (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      email_normalized TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      session_version INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE albums (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      cover_photo_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE photos (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      title TEXT,
      story TEXT,
      taken_at_sort INTEGER NOT NULL,
      taken_at_local TEXT NOT NULL,
      timezone_offset_minutes INTEGER,
      time_precision TEXT DEFAULT 'second',
      time_source TEXT DEFAULT 'exif',
      location_name TEXT,
      width INTEGER,
      height INTEGER,
      original_filename TEXT NOT NULL,
      content_hash TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      processing_error TEXT,
      deleted_at INTEGER,
      purge_after INTEGER,
      exif_safe_json TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE photo_assets (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      variant TEXT NOT NULL,
      r2_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      UNIQUE(photo_id, variant)
    );

    CREATE TABLE likes (
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (photo_id, user_id)
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);

  return drizzle(sqlite, { schema });
}

describe('PhotoService & Media Upload State Machine', () => {
  let db: ReturnType<typeof createTestDb>;
  let authService: AuthService;
  let photoService: PhotoService;
  let mediaService: MediaService;
  let householdId: string;
  let ownerId: string;
  let albumId: string;

  beforeEach(async () => {
    db = createTestDb();
    authService = new AuthService(db);
    photoService = new PhotoService(db);
    mediaService = new MediaService(db);

    const init = await authService.initOwner({
      householdName: 'Qin & Wang 空间',
      email: 'owner@loveqin.wang',
      displayName: 'Qin',
      password: 'Password123!',
    });

    householdId = init.householdId;
    ownerId = init.userId;

    const album = db.select().from(schema.albums).get()!;
    albumId = album.id;
  });

  it('should handle batch upload state transition: pending -> ready', async () => {
    // 1. 发起批量上传
    const batch = await mediaService.createUploadBatch(householdId, ownerId, albumId, [
      { filename: 'IMG_001.JPG', byteSize: 4500000, mimeType: 'image/jpeg' },
      { filename: 'IMG_002.HEIC', byteSize: 3200000, mimeType: 'image/heic' },
    ]);

    expect(batch.length).toBe(2);
    expect(batch[0].photoId).toBeDefined();

    // 此时照片处于 pending 状态，listPhotos 应返回空
    let readyPhotos = await photoService.listPhotos(householdId);
    expect(readyPhotos.length).toBe(0);

    // 2. 模拟处理完成完成写入
    await mediaService.completeUpload(householdId, batch[0].photoId, {
      r2KeyOriginal: batch[0].r2KeyOriginal,
      width: 4000,
      height: 3000,
      byteSize: 4500000,
      locationName: '川西 · 折多山',
      takenAtTimestamp: Date.now(),
      exifSafeData: { cameraModel: 'Sony A7M4', iso: 100 },
    });

    // 此时第一张照片进入 ready 状态
    readyPhotos = await photoService.listPhotos(householdId);
    expect(readyPhotos.length).toBe(1);
    expect(readyPhotos[0].locationName).toBe('川西 · 折多山');
    expect(readyPhotos[0].urlThumbHigh).toBe(`/api/media/${batch[0].photoId}/thumb_high`);
  });

  it('should soft-delete to trash and restore correctly', async () => {
    const batch = await mediaService.createUploadBatch(householdId, ownerId, albumId, [
      { filename: 'sample.jpg', byteSize: 1024000, mimeType: 'image/jpeg' },
    ]);
    await mediaService.completeUpload(householdId, batch[0].photoId, {
      r2KeyOriginal: batch[0].r2KeyOriginal,
      width: 1920,
      height: 1080,
      byteSize: 1024000,
    });

    expect((await photoService.listPhotos(householdId)).length).toBe(1);

    // 移入回收站
    await photoService.trashPhoto(householdId, ownerId, batch[0].photoId);

    // 正常浏览列表立即隐藏
    expect((await photoService.listPhotos(householdId)).length).toBe(0);

    // 回收站可查到该项
    const trash = await photoService.listTrash(householdId);
    expect(trash.length).toBe(1);
    expect(trash[0].id).toBe(batch[0].photoId);

    // 一键恢复
    await photoService.restorePhoto(householdId, ownerId, batch[0].photoId);
    expect((await photoService.listPhotos(householdId)).length).toBe(1);
  });

  it('should support likes, comments, and presigned download url', async () => {
    const batch = await mediaService.createUploadBatch(householdId, ownerId, albumId, [
      { filename: 'sample.jpg', byteSize: 1024000, mimeType: 'image/jpeg' },
    ]);
    await mediaService.completeUpload(householdId, batch[0].photoId, {
      r2KeyOriginal: batch[0].r2KeyOriginal,
      width: 1920,
      height: 1080,
      byteSize: 1024000,
    });

    const photoId = batch[0].photoId;

    // 点赞与取消点赞
    const likeRes1 = await photoService.toggleLike(ownerId, photoId);
    expect(likeRes1.liked).toBe(true);

    const detail1 = await photoService.getPhotoDetail(householdId, photoId, ownerId);
    expect(detail1.likesCount).toBe(1);
    expect(detail1.isLiked).toBe(true);

    const likeRes2 = await photoService.toggleLike(ownerId, photoId);
    expect(likeRes2.liked).toBe(false);

    // 留言
    const cmt = await photoService.addComment(ownerId, photoId, '这是一段难忘的旅程！');
    expect(cmt.commentId).toBeDefined();

    const detail2 = await photoService.getPhotoDetail(householdId, photoId, ownerId);
    expect(detail2.comments.length).toBe(1);
    expect(detail2.comments[0].content).toBe('这是一段难忘的旅程！');

    // 签发 5 分钟原图下载链接
    const downloadInfo = await mediaService.generatePresignedDownloadUrl(householdId, ownerId, photoId);
    expect(downloadInfo.downloadUrl).toContain('/api/download/direct/');
    expect(downloadInfo.expiresAt).toBeGreaterThan(Date.now());
  });
});
