import type { Plugin, Connect } from 'vite';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { getLocalObjectPath, buildPhotoAssetKey, PhotoVariant } from '../services/assetKeyUtils';

const require = createRequire(import.meta.url);

interface SqliteDatabase {
  prepare: (sql: string) => {
    all: (...args: any[]) => any[];
    get: (...args: any[]) => any;
  };
}

let syncDb: SqliteDatabase | null = null;

function getLocalSyncDb(): SqliteDatabase | null {
  if (syncDb) return syncDb;
  const dbPath = path.resolve(process.cwd(), '.local-d1.sqlite');
  if (!fs.existsSync(dbPath)) return null;

  try {
    // 优先使用 Node 22+ 原生内置 node:sqlite，保障与 Vite 热更新与 GC 的完全兼容
    const { DatabaseSync } = require('node:sqlite');
    syncDb = new DatabaseSync(dbPath, { readOnly: true });
    return syncDb;
  } catch {
    return null;
  }
}

/**
 * 校验请求来源是否为本机回环地址 (127.0.0.1 / ::1 / localhost)
 * 杜绝局域网内其他设备未鉴权读取开发者本地数据库与私密照片
 */
export function isLoopbackAddress(remoteAddress?: string): boolean {
  if (!remoteAddress) return true; // 单元测试或 mock socket 无地址时安全默认放行
  const clean = remoteAddress.replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
}

export interface DevAuthResult {
  authenticated: boolean;
  user?: {
    id: string;
    displayName: string;
    email: string;
  };
  reason?: string;
}

/**
 * 提取并校验本地开发认证凭据 (Cookie dev_session 或 Header x-local-dev-auth / x-dev-mock-email / Bearer)
 */
export function extractDevAuth(req: Connect.IncomingMessage): DevAuthResult {
  const authHeader = req.headers['authorization'];
  const devAuthHeader = req.headers['x-local-dev-auth'];
  const devMockEmail = req.headers['x-dev-mock-email'];
  const cookieHeader = req.headers['cookie'] || '';

  // 1. 检查 Cookie 中是否携带 dev_session 活跃会话凭据
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const devSessionCookie = cookies.find((c) => c.startsWith('dev_session='));
  const hasDevSession = Boolean(devSessionCookie && devSessionCookie.split('=')[1]);

  // 2. 检查显式开发请求头
  const secret = process.env.LOCAL_DEV_AUTH_SECRET || 'dev_secret';
  const hasDevAuthHeader =
    devAuthHeader === '1' ||
    devAuthHeader === 'true' ||
    devAuthHeader === secret;

  const hasMockEmail = typeof devMockEmail === 'string' && devMockEmail.trim().length > 0;
  const hasBearerDev = typeof authHeader === 'string' && authHeader.startsWith('Bearer dev_');

  if (hasDevSession || hasDevAuthHeader || hasMockEmail || hasBearerDev) {
    const email = hasMockEmail ? (devMockEmail as string).trim() : 'dev@loveqin.wang';
    return {
      authenticated: true,
      user: {
        id: 'user_dev_local',
        displayName: '本地开发用户',
        email,
      },
    };
  }

  return {
    authenticated: false,
    reason: 'DEV_AUTH_REQUIRED',
  };
}

/**
 * 创建 Vite 开发 API 中间件处理器，便于在单元测试与 Vite 插件中复用
 */
export function createDevApiMiddleware() {
  return async (req: Connect.IncomingMessage, res: any, next: () => void) => {
    const url = req.url || '';

    // 仅拦截 /api/* 路径
    if (!url.startsWith('/api/')) {
      next();
      return;
    }

    // 0. 网络防线：强制仅允许本机回环地址访问开发 API，杜绝局域网未鉴权暴露
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          error: 'FORBIDDEN_NON_LOOPBACK',
          message: '开发 API 代理仅允许通过本机回环地址 (127.0.0.1 / localhost) 访问',
        })
      );
      return;
    }

    // 0.1 POST /api/auth/dev-login - 专门用于本地开发环境显式登录并建立 Cookie
    if (req.method === 'POST' && (url === '/api/auth/dev-login' || url.startsWith('/api/auth/dev-login?'))) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', 'dev_session=local_viewer; Path=/; SameSite=Strict; HttpOnly');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          success: true,
          message: '本地开发会话已建立',
          authenticated: true,
          user: {
            id: 'user_dev_local',
            displayName: '本地开发用户',
            email: 'dev@loveqin.wang',
          },
          householdId: 'household_default',
          role: 'viewer',
        })
      );
      return;
    }

    // 0.2 只读契约防线：统一拦截针对 /api/* 的所有其余写操作 (POST/PUT/DELETE/PATCH)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          error: 'METHOD_NOT_ALLOWED',
          message: '只读发布版本不允许在线写操作，请使用受控离线 CLI 运维流水线',
        })
      );
      return;
    }

    // 0.3 GET /api/auth/session & /api/auth/me - 本地开发会话探测
    if (url === '/api/auth/session' || url === '/api/auth/me') {
      const auth = extractDevAuth(req);
      if (!auth.authenticated) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            authenticated: false,
            error: 'DEV_AUTH_REQUIRED',
            message: '未提供本地开发凭据，请携带 Cookie: dev_session 或 Header x-local-dev-auth / x-dev-mock-email',
          })
        );
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', 'dev_session=local_viewer; Path=/; SameSite=Strict; HttpOnly');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          authenticated: true,
          user: auth.user,
          householdId: 'household_default',
          role: 'viewer',
        })
      );
      return;
    }

    // 0.4 私密数据防线：读取 /api/photos、媒体资源或原图下载，必须提供合法开发凭据
    const auth = extractDevAuth(req);
    if (!auth.authenticated) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          error: 'DEV_AUTH_REQUIRED',
          message: '未提供本地开发凭据，拒绝访问私密相册数据。请提供 dev_session Cookie 或开发鉴权头',
        })
      );
      return;
    }

    // 1. GET /api/photos - 查询 SQLite 真实照片列表
    if (url === '/api/photos' || url.startsWith('/api/photos?')) {
      try {
        const db = getLocalSyncDb();
        let photos: any[] = [];
        let hasMore = false;
        let nextCursor: string | null = null;

        const parsedUrl = new URL(req.url || '/api/photos', 'http://localhost');
        const limitParam = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100);
        const cursor = parsedUrl.searchParams.get('cursor');
        const orderParam = (parsedUrl.searchParams.get('order') || 'asc').toLowerCase();
        const isDesc = orderParam === 'desc';
        const albumId = parsedUrl.searchParams.get('album_id') || parsedUrl.searchParams.get('albumId');

        if (db) {
          let sql = 'SELECT * FROM photos WHERE status = ? AND deleted_at IS NULL';
          const params: any[] = ['ready'];

          if (albumId) {
            sql += ' AND album_id = ?';
            params.push(albumId);
          }

          if (cursor) {
            if (cursor.includes(':')) {
              const colonIdx = cursor.indexOf(':');
              const sortVal = Number(cursor.substring(0, colonIdx));
              const idVal = cursor.substring(colonIdx + 1);
              if (!isNaN(sortVal) && idVal) {
                if (isDesc) {
                  sql += ' AND (taken_at_sort < ? OR (taken_at_sort = ? AND id < ?))';
                } else {
                  sql += ' AND (taken_at_sort > ? OR (taken_at_sort = ? AND id > ?))';
                }
                params.push(sortVal, sortVal, idVal);
              }
            } else {
              const cursorVal = Number(cursor);
              if (!isNaN(cursorVal)) {
                if (isDesc) {
                  sql += ' AND taken_at_sort < ?';
                } else {
                  sql += ' AND taken_at_sort > ?';
                }
                params.push(cursorVal);
              }
            }
          }

          sql += isDesc
            ? ' ORDER BY taken_at_sort DESC, id DESC LIMIT ?'
            : ' ORDER BY taken_at_sort ASC, id ASC LIMIT ?';
          params.push(limit + 1);

          const rawRows = db.prepare(sql).all(...params) as any[];
          hasMore = rawRows.length > limit;
          const rows = hasMore ? rawRows.slice(0, limit) : rawRows;
          nextCursor = hasMore && rows.length > 0
            ? `${rows[rows.length - 1].taken_at_sort}:${rows[rows.length - 1].id}`
            : null;

          photos = rows.map((p) => {
            const assets = db.prepare('SELECT * FROM photo_assets WHERE photo_id = ?').all(p.id) as any[];
            const low = assets.find((a) => a.variant === 'thumb_low');
            const high = assets.find((a) => a.variant === 'thumb_high');
            const disp = assets.find((a) => a.variant === 'display');

            let exif = {};
            try {
              if (p.exif_safe_json) exif = JSON.parse(p.exif_safe_json);
            } catch {}

            return {
              id: p.id,
              albumId: p.album_id,
              title: p.title || '无题回忆',
              story: p.story || '',
              takenAt: p.taken_at_sort,
              takenAtSort: p.taken_at_sort,
              takenAtLocal: p.taken_at_local,
              locationName: p.location_name || 'Family Memories',
              width: p.width || 1920,
              height: p.height || 1080,
              urlThumbLow: low ? `/api/media/${p.id}/thumb_low` : '',
              urlThumbHigh: high ? `/api/media/${p.id}/thumb_high` : '',
              urlDisplay: disp ? `/api/media/${p.id}/display` : '',
              exif,
              likesCount: 0,
            };
          });
        } else {
          // 备用 fallback: src/data/photos.json
          const fallbackPath = path.resolve(process.cwd(), 'src', 'data', 'photos.json');
          if (fs.existsSync(fallbackPath)) {
            photos = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
          }
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Has-More', String(hasMore));
        if (nextCursor) {
          res.setHeader('X-Next-Cursor', nextCursor);
        }
        res.setHeader('Access-Control-Expose-Headers', 'X-Has-More, X-Next-Cursor');

        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(JSON.stringify(photos));
        return;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('API /api/photos 错误:', errMsg);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: errMsg }));
        return;
      }
    }

    // 2. GET /api/media/:photoId/:variant - 受保护媒体资源流式读取
    const mediaMatch = url.match(/^\/api\/media\/([a-zA-Z0-9_-]+)\/(thumb_low|thumb_high|display|original)(?:\?.*)?$/);
    if (mediaMatch) {
      const photoId = mediaMatch[1];
      const variant = mediaMatch[2] as PhotoVariant;

      try {
        const db = getLocalSyncDb();
        let targetFilePath = '';
        let mimeType = variant === 'original' ? 'image/jpeg' : 'image/webp';

        if (db) {
          const photo = db.prepare('SELECT id, household_id, status, deleted_at FROM photos WHERE id = ?').get(photoId) as any;
          if (!photo || photo.status !== 'ready' || photo.deleted_at !== null) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'PHOTO_NOT_ACCESSIBLE', photoId }));
            return;
          }

          const asset = db.prepare('SELECT * FROM photo_assets WHERE photo_id = ? AND variant = ?').get(photoId, variant) as any;
          if (asset && asset.r2_key) {
            targetFilePath = getLocalObjectPath(asset.r2_key);
            mimeType = asset.mime_type || mimeType;
          }
        }

        if (!targetFilePath || !fs.existsSync(targetFilePath)) {
          // 容错备用推导
          const fallbackKey = buildPhotoAssetKey('household_default', photoId, variant);
          targetFilePath = getLocalObjectPath(fallbackKey);
        }

        if (!fs.existsSync(targetFilePath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'MEDIA_NOT_FOUND', photoId, variant }));
          return;
        }

        const stat = fs.statSync(targetFilePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'private, max-age=300'); // 符合 PRD 隐私缓存规范

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        const stream = fs.createReadStream(targetFilePath);
        stream.pipe(res);
        return;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`媒体流读取错误 [${photoId}/${variant}]:`, errMsg);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: errMsg }));
        return;
      }
    }

    // 3. GET /api/photos/:photoId/download - 原图私密下载
    const downloadMatch = url.match(/^\/api\/photos\/([a-zA-Z0-9_-]+)\/download(?:\?.*)?$/);
    if (downloadMatch) {
      const photoId = downloadMatch[1];
      try {
        const db = getLocalSyncDb();
        let photo: any = null;
        let asset: any = null;

        if (db) {
          photo = db.prepare('SELECT id, household_id, original_filename, status, deleted_at FROM photos WHERE id = ?').get(photoId) as any;
          if (!photo || photo.status !== 'ready' || photo.deleted_at !== null) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'PHOTO_NOT_ACCESSIBLE', photoId }));
            return;
          }
          asset = db.prepare("SELECT * FROM photo_assets WHERE photo_id = ? AND variant = 'original'").get(photoId);
        }

        let filePath = asset?.r2_key ? getLocalObjectPath(asset.r2_key) : '';
        if (!filePath || !fs.existsSync(filePath)) {
          const fallbackKey = buildPhotoAssetKey('household_default', photoId, 'original');
          filePath = getLocalObjectPath(fallbackKey);
        }

        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'RAW_FILE_NOT_FOUND' }));
          return;
        }

        const filename = encodeURIComponent(photo?.original_filename || `${photoId}.jpg`);
        const stat = fs.statSync(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', asset?.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        fs.createReadStream(filePath).pipe(res);
        return;
      } catch (err: unknown) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
    }

    next();
  };
}

export function devApiPlugin(): Plugin {
  const middleware = createDevApiMiddleware();
  return {
    name: 'dev-gallery-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
