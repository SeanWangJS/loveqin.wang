import { authenticateRequest, createAuthErrorResponse, D1DatabaseBinding } from '../../_auth';

interface Env {
  DB: D1DatabaseBinding;
  BUCKET: {
    get: (key: string) => Promise<{
      body: ReadableStream;
      size: number;
      httpEtag: string;
      httpMetadata?: {
        contentType?: string;
      };
    } | null>;
  };
}

interface PagesContext {
  request: Request;
  env: Env;
  params: {
    photoId: string;
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { photoId } = context.params;
  if (!photoId) {
    return new Response(JSON.stringify({ error: 'PHOTO_ID_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { DB, BUCKET } = context.env;
    if (!DB || !BUCKET) {
      return new Response(JSON.stringify({ error: 'BINDINGS_MISSING' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. 严格校验照片存在、就绪且未被移入回收站
    const photo = await DB
      .prepare('SELECT id, household_id, original_filename, status, deleted_at FROM photos WHERE id = ?')
      .bind(photoId)
      .first();

    if (!photo || photo.status !== 'ready' || photo.deleted_at !== null) {
      return new Response(JSON.stringify({ error: 'PHOTO_NOT_ACCESSIBLE', photoId }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. 严格权限校验：校验请求者是否拥有该照片所属家庭空间的活跃成员权限
    const auth = await authenticateRequest(context.request, DB, photo.household_id);
    if (!auth) {
      return createAuthErrorResponse(403, 'FORBIDDEN: 无权下载该家庭空间的私密原图资产');
    }

    // 3. 查询原图资产
    const asset = await DB
      .prepare("SELECT r2_key, mime_type FROM photo_assets WHERE photo_id = ? AND variant = 'original'")
      .bind(photoId)
      .first();

    const householdId = photo.household_id;
    const r2Key = asset?.r2_key || `originals/${householdId}/${photoId}.jpg`;
    const mimeType = asset?.mime_type || 'application/octet-stream';

    // 4. 从 R2 私有桶获取原图
    const object = await BUCKET.get(r2Key);
    if (!object) {
      return new Response(JSON.stringify({ error: 'RAW_FILE_NOT_FOUND', r2Key }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filename = encodeURIComponent(photo.original_filename || `${photoId}.jpg`);
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || mimeType);
    headers.set('Content-Length', String(object.size));
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Cache-Control', 'private, no-cache');

    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, { status: 200, headers });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
