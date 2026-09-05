import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { onRequestGet } from '../../functions/api/photos';
import { useGalleryStore } from '../stores/useGalleryStore';
import { hashToken } from './cryptoUtils';

function createD1Adapter(sqlite: Database.Database) {
  return {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          try {
            const stmt = sqlite.prepare(query);
            const rows = stmt.all(...args);
            return { results: rows };
          } catch (err) {
            console.error('SQL all error:', query, args, err);
            throw err;
          }
        },
        first: async () => {
          try {
            const stmt = sqlite.prepare(query);
            const row = stmt.get(...args);
            return row || null;
          } catch (err) {
            console.error('SQL first error:', query, args, err);
            throw err;
          }
        },
        run: async () => {
          try {
            const stmt = sqlite.prepare(query);
            const info = stmt.run(...args);
            return { success: true, meta: { changes: info.changes } };
          } catch (err) {
            console.error('SQL run error:', query, args, err);
            throw err;
          }
        },
      }),
    }),
  };
}

describe('P1 复合游标分页测试 (functions/api/photos.ts & useGalleryStore)', () => {
  let sqlite: Database.Database;
  let d1Db: ReturnType<typeof createD1Adapter>;
  const testToken = 'test_session_token_p1_pagination';
  const testTokenHash = hashToken(testToken);
  const householdId = 'hh_pagination_test';
  const userId = 'user_pagination_test';
  const albumId = 'album_pagination_test';

  beforeEach(() => {
    sqlite = new Database(':memory:');
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

      CREATE TABLE auth_identities (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        email_at_link TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_authenticated_at INTEGER NOT NULL,
        UNIQUE(issuer, subject)
      );
      CREATE INDEX idx_auth_identities_user_id ON auth_identities(user_id);

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
        status TEXT DEFAULT 'ready' NOT NULL,
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
        height INTEGER
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

      CREATE INDEX idx_photos_album_sort ON photos (album_id, status, taken_at_sort, id);
    `);

    // 初始化测试用户与有效 Session
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)
    `).run(householdId, 'Test Family', now);

    sqlite.prepare(`
      INSERT INTO users (id, email_normalized, display_name, password_hash, session_version, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(userId, 'test@loveqin.wang', 'Tester', 'hashed_pw', 1, now);

    sqlite.prepare(`
      INSERT INTO household_members (household_id, user_id, role, status, joined_at)
      VALUES (?, ?, 'owner', 'active', ?)
    `).run(householdId, userId, now);

    sqlite.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, session_version, expires_at, last_seen_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run('sess_pagination_1', userId, testTokenHash, now + 86400000, now);

    sqlite.prepare(`
      INSERT INTO albums (id, household_id, name, created_by, created_at, updated_at)
      VALUES (?, ?, 'Default Album', ?, ?, ?)
    `).run(albumId, householdId, userId, now, now);

    d1Db = createD1Adapter(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('同时间戳照片分页：limit=2 步进时必须完整遍历 5 张照片，0 遗漏 0 重复', async () => {
    const fixedTimestamp = 1700000000000;
    const now = Date.now();

    // 插入 5 张具有完全相同 taken_at_sort 的照片
    const insertStmt = sqlite.prepare(`
      INSERT INTO photos (id, household_id, album_id, title, taken_at_sort, taken_at_local, original_filename, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '2023-11-14T22:13:20', 'test.jpg', 'ready', ?, ?, ?)
    `);

    insertStmt.run('photo_1', householdId, albumId, 'Photo 1', fixedTimestamp, userId, now, now);
    insertStmt.run('photo_2', householdId, albumId, 'Photo 2', fixedTimestamp, userId, now, now);
    insertStmt.run('photo_3', householdId, albumId, 'Photo 3', fixedTimestamp, userId, now, now);
    insertStmt.run('photo_4', householdId, albumId, 'Photo 4', fixedTimestamp, userId, now, now);
    insertStmt.run('photo_5', householdId, albumId, 'Photo 5', fixedTimestamp, userId, now, now);

    // 第 1 页：limit=2, 无游标
    const req1 = new Request('https://loveqin.wang/api/photos?limit=2', {
      headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
    });
    const res1 = await onRequestGet({ request: req1, env: { DB: d1Db as any, BUCKET: {}, ENVIRONMENT: 'local' } as any, params: {} });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-Has-More')).toBe('true');
    const cursor1 = res1.headers.get('X-Next-Cursor');
    expect(cursor1).toBe(`${fixedTimestamp}:photo_2`);
    const page1Data = await res1.json();
    expect(page1Data.map((p: any) => p.id)).toEqual(['photo_1', 'photo_2']);

    // 第 2 页：limit=2, 传入游标 cursor1
    const req2 = new Request(`https://loveqin.wang/api/photos?limit=2&cursor=${encodeURIComponent(cursor1!)}`, {
      headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
    });
    const res2 = await onRequestGet({ request: req2, env: { DB: d1Db as any, BUCKET: {}, ENVIRONMENT: 'local' } as any, params: {} });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Has-More')).toBe('true');
    const cursor2 = res2.headers.get('X-Next-Cursor');
    expect(cursor2).toBe(`${fixedTimestamp}:photo_4`);
    const page2Data = await res2.json();
    expect(page2Data.map((p: any) => p.id)).toEqual(['photo_3', 'photo_4']);

    // 第 3 页：limit=2, 传入游标 cursor2
    const req3 = new Request(`https://loveqin.wang/api/photos?limit=2&cursor=${encodeURIComponent(cursor2!)}`, {
      headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
    });
    const res3 = await onRequestGet({ request: req3, env: { DB: d1Db as any, BUCKET: {}, ENVIRONMENT: 'local' } as any, params: {} });
    expect(res3.status).toBe(200);
    expect(res3.headers.get('X-Has-More')).toBe('false');
    expect(res3.headers.get('X-Next-Cursor')).toBeNull();
    const page3Data = await res3.json();
    expect(page3Data.map((p: any) => p.id)).toEqual(['photo_5']);

    // 汇总验证：5 张照片全部获取，绝无漏传与重复
    const allFetched = [...page1Data, ...page2Data, ...page3Data].map((p: any) => p.id);
    expect(allFetched).toEqual(['photo_1', 'photo_2', 'photo_3', 'photo_4', 'photo_5']);
  });

  it('倒序分页 (order=desc)：正确按时间与 ID 复合倒序游标步进', async () => {
    const fixedTimestamp = 1700000000000;
    const now = Date.now();

    const insertStmt = sqlite.prepare(`
      INSERT INTO photos (id, household_id, album_id, title, taken_at_sort, taken_at_local, original_filename, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '2023-11-14T22:13:20', 'test.jpg', 'ready', ?, ?, ?)
    `);

    insertStmt.run('photo_1', householdId, albumId, 'Photo 1', fixedTimestamp, userId, now, now);
    insertStmt.run('photo_2', householdId, albumId, 'Photo 2', fixedTimestamp, userId, now, now);
    insertStmt.run('photo_3', householdId, albumId, 'Photo 3', fixedTimestamp, userId, now, now);

    // 第 1 页：limit=2, order=desc
    const req1 = new Request('https://loveqin.wang/api/photos?limit=2&order=desc', {
      headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
    });
    const res1 = await onRequestGet({ request: req1, env: { DB: d1Db as any, BUCKET: {}, ENVIRONMENT: 'local' } as any, params: {} });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-Has-More')).toBe('true');
    const cursor1 = res1.headers.get('X-Next-Cursor');
    expect(cursor1).toBe(`${fixedTimestamp}:photo_2`);
    const page1Data = await res1.json();
    expect(page1Data.map((p: any) => p.id)).toEqual(['photo_3', 'photo_2']);

    // 第 2 页：limit=2, order=desc, cursor=cursor1
    const req2 = new Request(`https://loveqin.wang/api/photos?limit=2&order=desc&cursor=${encodeURIComponent(cursor1!)}`, {
      headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
    });
    const res2 = await onRequestGet({ request: req2, env: { DB: d1Db as any, BUCKET: {}, ENVIRONMENT: 'local' } as any, params: {} });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Has-More')).toBe('false');
    const page2Data = await res2.json();
    expect(page2Data.map((p: any) => p.id)).toEqual(['photo_1']);
  });

  it('向后兼容纯数字时间戳游标 (legacy cursor)', async () => {
    const now = Date.now();
    const insertStmt = sqlite.prepare(`
      INSERT INTO photos (id, household_id, album_id, title, taken_at_sort, taken_at_local, original_filename, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '2023-11-14T22:13:20', 'test.jpg', 'ready', ?, ?, ?)
    `);

    insertStmt.run('p_early', householdId, albumId, 'Early', 1000, userId, now, now);
    insertStmt.run('p_mid', householdId, albumId, 'Mid', 2000, userId, now, now);
    insertStmt.run('p_late', householdId, albumId, 'Late', 3000, userId, now, now);

    // 使用纯数字旧游标 cursor=1500
    const req = new Request('https://loveqin.wang/api/photos?cursor=1500', {
      headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
    });
    const res = await onRequestGet({ request: req, env: { DB: d1Db as any, BUCKET: {}, ENVIRONMENT: 'local' } as any, params: {} });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.map((p: any) => p.id)).toEqual(['p_mid', 'p_late']);
  });

  it('前端 useGalleryStore.fetchPhotos() 能够循环读取 X-Has-More 并拉取全部页', async () => {
    // 模拟前后端通信交互
    const page1Photos = [
      { id: 'p_store_1', takenAt: 1000, takenAtSort: 1000, title: 'One' },
      { id: 'p_store_2', takenAt: 1000, takenAtSort: 1000, title: 'Two' },
    ];
    const page2Photos = [
      { id: 'p_store_3', takenAt: 2000, takenAtSort: 2000, title: 'Three' },
    ];

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('cursor=')) {
        return new Response(JSON.stringify(page2Photos), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Has-More': 'false',
          },
        });
      }
      return new Response(JSON.stringify(page1Photos), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Has-More': 'true',
          'X-Next-Cursor': '1000:p_store_2',
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    // 调用 fetchPhotos
    await useGalleryStore.getState().fetchPhotos();

    // 验证 store 中包含全部 3 张照片
    const photos = useGalleryStore.getState().photos;
    expect(photos.length).toBe(3);
    const ids = photos.map((p) => p.id);
    expect(ids).toContain('p_store_1');
    expect(ids).toContain('p_store_2');
    expect(ids).toContain('p_store_3');
  });

  it('PhotoService.listPhotos: Drizzle 复合游标能够精准过滤相同时间戳数据', async () => {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const schema = await import('../drizzle/schema');
    const { PhotoService } = await import('./photoService');

    const db = drizzle(sqlite, { schema });
    const photoService = new PhotoService(db);

    const fixedTimestamp = 1700000000000;
    const now = Date.now();

    const insertStmt = sqlite.prepare(`
      INSERT INTO photos (id, household_id, album_id, title, taken_at_sort, taken_at_local, original_filename, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '2023-11-14T22:13:20', 'test.jpg', 'ready', ?, ?, ?)
    `);

    insertStmt.run('drizzle_p1', householdId, albumId, 'D1', fixedTimestamp, userId, now, now);
    insertStmt.run('drizzle_p2', householdId, albumId, 'D2', fixedTimestamp, userId, now, now);
    insertStmt.run('drizzle_p3', householdId, albumId, 'D3', fixedTimestamp, userId, now, now);

    // 查询带游标 cursor: fixedTimestamp:drizzle_p1
    const res = await photoService.listPhotos(householdId, {
      cursor: `${fixedTimestamp}:drizzle_p1`,
    });

    expect(res.map((p) => p.id)).toEqual(['drizzle_p2', 'drizzle_p3']);
  });
});
