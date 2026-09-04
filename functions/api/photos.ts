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

    const householdId = 'household_default';

    // 1. 查询已就绪且未被软删除的照片记录
    const { results: photos } = await db
      .prepare(
        `SELECT id, album_id, title, story, taken_at_sort, taken_at_local, location_name, width, height, exif_safe_json
         FROM photos
         WHERE household_id = ? AND status = 'ready' AND deleted_at IS NULL
         ORDER BY taken_at_sort ASC`
      )
      .bind(householdId)
      .all();

    if (!photos || photos.length === 0) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // 2. 批量查询关联资产
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

    return new Response(JSON.stringify(mapped), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
