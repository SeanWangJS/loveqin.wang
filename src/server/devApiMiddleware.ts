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

export function devApiPlugin(): Plugin {
  return {
    name: 'dev-gallery-api',
    configureServer(server) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
        const url = req.url || '';

        // 1. GET /api/photos - 查询 SQLite 真实照片列表
        if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/api/photos' || url.startsWith('/api/photos?'))) {
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
        if ((req.method === 'GET' || req.method === 'HEAD') && mediaMatch) {
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
        if ((req.method === 'GET' || req.method === 'HEAD') && downloadMatch) {
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
      });
    },
  };
}
