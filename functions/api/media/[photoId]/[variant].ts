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
    variant: string;
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { photoId, variant } = context.params;
  const validVariants = new Set(['thumb_low', 'thumb_high', 'display', 'original']);
  if (!photoId || !variant || !validVariants.has(variant)) {
    return new Response(JSON.stringify({ error: 'INVALID_PARAMETERS' }), {
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

    // 1. 严格校验照片存在性、就绪状态与软删除状态
    const photo = await DB
      .prepare('SELECT id, household_id, status, deleted_at FROM photos WHERE id = ?')
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
      return createAuthErrorResponse(403, 'FORBIDDEN: 无权访问该家庭空间的私密媒体资产');
    }

    // 3. 查询资产表定位精确 R2 Key
    const asset = await DB
      .prepare('SELECT r2_key, mime_type FROM photo_assets WHERE photo_id = ? AND variant = ?')
      .bind(photoId, variant)
      .first();

    const householdId = photo.household_id;
    let r2Key = asset?.r2_key;
    let mimeType = asset?.mime_type || (variant === 'original' ? 'image/jpeg' : 'image/webp');

    // 4. 规范对齐的备用 Key 推导（严格使用复数 thumbs_low 与 thumbs_high）
    if (!r2Key) {
      if (variant === 'original') {
        r2Key = `originals/${householdId}/${photoId}.jpg`;
      } else {
        const folder = variant === 'thumb_low' ? 'thumbs_low' : variant === 'thumb_high' ? 'thumbs_high' : 'display';
        r2Key = `${folder}/${householdId}/${photoId}.webp`;
      }
    }

    // 5. 从 R2 私有存储桶安全流式拉取
    const object = await BUCKET.get(r2Key);
    if (!object) {
      return new Response(JSON.stringify({ error: 'MEDIA_OBJECT_NOT_FOUND', r2Key }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || mimeType);
    headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'private, max-age=300');
    if (object.httpEtag) {
      headers.set('ETag', object.httpEtag);
    }

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
