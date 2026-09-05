import { authenticateRequest, createAuthErrorResponse } from './_auth';

interface Env {
  DB: {
    prepare: (sql: string) => {
      bind: (...args: any[]) => {
        all: () => Promise<{ results: any[] }>;
        first: () => Promise<any>;
      };
    };
  };
  BUCKET: any;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: 'DATABASE_BINDING_MISSING' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. 严格鉴权：校验用户会话与活跃家庭空间成员权限
    const auth = await authenticateRequest(context.request, db, undefined, context.env as any);
    if (!auth) {
      return createAuthErrorResponse(401, 'UNAUTHORIZED: 请通过 Cloudflare Access 登录并确认已在家庭访问名单');
    }

    const householdId = auth.householdId;

    // 2. 分页与过滤参数解析（默认 50 张，硬上限 100 张防内存爆破）
    const url = new URL(context.request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100);
    const cursor = url.searchParams.get('cursor');
    const orderParam = (url.searchParams.get('order') || 'asc').toLowerCase();
    const isDesc = orderParam === 'desc';
    const albumId = url.searchParams.get('album_id') || url.searchParams.get('albumId');

    let sql = `
      SELECT id, album_id, title, story, taken_at_sort, taken_at_local, location_name, width, height, exif_safe_json
      FROM photos
      WHERE household_id = ? AND status = 'ready' AND deleted_at IS NULL
    `;
    const params: any[] = [householdId];

    if (albumId) {
      sql += ` AND album_id = ?`;
      params.push(albumId);
    }

    // 复合游标推进条件 (杜绝同时间戳漏数据):
    // 规范格式为: `${taken_at_sort}:${id}`
    if (cursor) {
      if (cursor.includes(':')) {
        const colonIdx = cursor.indexOf(':');
        const sortVal = Number(cursor.substring(0, colonIdx));
        const idVal = cursor.substring(colonIdx + 1);
        if (!isNaN(sortVal) && idVal) {
          if (isDesc) {
            sql += ` AND (taken_at_sort < ? OR (taken_at_sort = ? AND id < ?))`;
          } else {
            sql += ` AND (taken_at_sort > ? OR (taken_at_sort = ? AND id > ?))`;
          }
          params.push(sortVal, sortVal, idVal);
        }
      } else {
        // 向后兼容旧版纯时间戳游标
        const cursorVal = Number(cursor);
        if (!isNaN(cursorVal)) {
          if (isDesc) {
            sql += ` AND taken_at_sort < ?`;
          } else {
            sql += ` AND taken_at_sort > ?`;
          }
          params.push(cursorVal);
        }
      }
    }

    sql += isDesc
      ? ` ORDER BY taken_at_sort DESC, id DESC LIMIT ?`
      : ` ORDER BY taken_at_sort ASC, id ASC LIMIT ?`;
    params.push(limit + 1); // 多查 1 条用于判断 hasMore

    // 3. 执行单页主表查询
    const { results: rawRows } = await db
      .prepare(sql)
      .bind(...params)
      .all();

    const rows = rawRows || [];
    const hasMore = rows.length > limit;
    const photos = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && photos.length > 0
      ? `${photos[photos.length - 1].taken_at_sort}:${photos[photos.length - 1].id}`
      : null;

    if (photos.length === 0) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Has-More': 'false',
          'Access-Control-Expose-Headers': 'X-Has-More, X-Next-Cursor',
        },
      });
    }

    // 4. 仅为当前页的有效照片批量查询资产表，彻底消除全量超大 SQL 参数隐患
    const photoIds = photos.map((p: any) => p.id);
    const placeholders = photoIds.map(() => '?').join(',');
    const { results: allAssets } = await db
      .prepare(`SELECT photo_id, variant, r2_key, mime_type FROM photo_assets WHERE photo_id IN (${placeholders})`)
      .bind(...photoIds)
      .all();

    const assetsByPhotoId = new Map<string, any[]>();
    for (const a of (allAssets || [])) {
      const list = assetsByPhotoId.get(a.photo_id) || [];
      list.push(a);
      assetsByPhotoId.set(a.photo_id, list);
    }

    const mapped = photos.map((p: any) => {
      const assets = assetsByPhotoId.get(p.id) || [];
      const low = assets.find((a: any) => a.variant === 'thumb_low');
      const high = assets.find((a: any) => a.variant === 'thumb_high');
      const disp = assets.find((a: any) => a.variant === 'display');

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

    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'private, no-cache');
    headers.set('X-Has-More', String(hasMore));
    if (nextCursor) {
      headers.set('X-Next-Cursor', nextCursor);
    }
    headers.set('Access-Control-Expose-Headers', 'X-Has-More, X-Next-Cursor');

    return new Response(JSON.stringify(mapped), {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
