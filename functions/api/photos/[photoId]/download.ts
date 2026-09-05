import {
  authenticateRequest,
  createAuthErrorResponse,
  createApiErrorResponse,
  createServerErrorResponse,
  D1DatabaseBinding,
} from '../../_auth';

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
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Allow: 'GET, HEAD',
        'Cache-Control': 'no-store',
      },
    });
  }

  const { photoId } = context.params;
  if (!photoId) {
    return createApiErrorResponse(400, 'PHOTO_ID_REQUIRED', '未提供目标照片 ID');
  }

  try {
    const { DB, BUCKET } = context.env;
    if (!DB || !BUCKET) {
      return createServerErrorResponse(new Error('BINDINGS_MISSING'), 'DownloadAPI', context.request);
    }

    // 1. 严格校验照片存在、就绪且未被移入回收站
    const photo = await DB
      .prepare('SELECT id, household_id, original_filename, status, deleted_at FROM photos WHERE id = ?')
      .bind(photoId)
      .first();

    if (!photo || photo.status !== 'ready' || photo.deleted_at !== null) {
      return createApiErrorResponse(404, 'PHOTO_NOT_ACCESSIBLE', '请求的照片不存在或不可访问');
    }

    // 2. 严格权限校验：校验请求者是否拥有该照片所属家庭空间的活跃成员权限
    const auth = await authenticateRequest(context.request, DB, photo.household_id, context.env as any);
    if (!auth) {
      return createAuthErrorResponse(403, 'FORBIDDEN', '无权下载该家庭空间的私密原图资产');
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
      // 内部存储 key 与结构仅在服务端受控日志记录，响应体绝不泄露 r2Key
      console.warn('[DownloadAPI] R2 原图对象未找到:', { photoId, r2Key });
      return createApiErrorResponse(404, 'RAW_FILE_NOT_FOUND', '原图文件不存在');
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
    return createServerErrorResponse(err, 'DownloadAPI', context.request);
  }
}
