import type { Plugin, Connect } from 'vite';
import fs from 'fs';
import { getDatabase } from '../drizzle/db';
import * as schema from '../drizzle/schema';
import { PhotoService } from '../services/photoService';
import { eq, and } from 'drizzle-orm';
import { getLocalObjectPath, buildPhotoAssetKey, PhotoVariant } from '../services/assetKeyUtils';

export function devApiPlugin(): Plugin {
  return {
    name: 'dev-gallery-api',
    configureServer(server) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
        const url = req.url || '';

        // 1. GET /api/photos - 查询 SQLite 真实照片列表
        if ((req.method === 'GET' || req.method === 'HEAD') && (url === '/api/photos' || url.startsWith('/api/photos?'))) {
          try {
            const db = getDatabase();
            const photoService = new PhotoService(db);
            const householdId = 'household_default';

            const photos = await photoService.listPhotos(householdId);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
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
            const db = getDatabase();
            // 先查 photo_assets 表
            let asset = db
              .select()
              .from(schema.photoAssets)
              .where(and(eq(schema.photoAssets.photoId, photoId), eq(schema.photoAssets.variant, variant)))
              .get();

            let targetFilePath = '';
            let mimeType = variant === 'original' ? 'image/jpeg' : 'image/webp';

            if (asset && asset.r2Key) {
              targetFilePath = getLocalObjectPath(asset.r2Key);
              mimeType = asset.mimeType || mimeType;
            } else {
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
        if (req.method === 'GET' && downloadMatch) {
          const photoId = downloadMatch[1];
          try {
            const db = getDatabase();
            const photo = db.select().from(schema.photos).where(eq(schema.photos.id, photoId)).get();
            const asset = db
              .select()
              .from(schema.photoAssets)
              .where(and(eq(schema.photoAssets.photoId, photoId), eq(schema.photoAssets.variant, 'original')))
              .get();

            if (!photo || !asset) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'PHOTO_NOT_FOUND' }));
              return;
            }

            const filePath = getLocalObjectPath(asset.r2Key);
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'RAW_FILE_NOT_FOUND' }));
              return;
            }

            const filename = encodeURIComponent(photo.originalFilename || `${photoId}.jpg`);
            res.statusCode = 200;
            res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
