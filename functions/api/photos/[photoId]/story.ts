import { authenticateRequest, createApiErrorResponse, createAuthErrorResponse, createServerErrorResponse } from '../../_auth';

const MAX_STORY_LENGTH = 10000;
const MAX_BODY_BYTES = 64 * 1024;

interface Env {
  DB: {
    prepare: (sql: string) => {
      bind: (...args: any[]) => {
        all: () => Promise<{ results: any[] }>;
        first: () => Promise<any>;
        run: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
      };
    };
  };
  [key: string]: unknown;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function getPhotoId(params: PagesContext['params']): string {
  const photoId = params.photoId;
  return Array.isArray(photoId) ? photoId[0] || '' : photoId || '';
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'PATCH') {
    return createApiErrorResponse(405, 'METHOD_NOT_ALLOWED', '仅允许使用 PATCH 修改照片故事');
  }

  if (!isSameOrigin(context.request)) {
    return createApiErrorResponse(403, 'FORBIDDEN_ORIGIN', '请求来源无效');
  }

  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return createApiErrorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须使用 application/json');
  }

  const contentLength = Number(context.request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return createApiErrorResponse(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
  }

  try {
    const auth = await authenticateRequest(context.request, context.env.DB, undefined, context.env);
    if (!auth) {
      return createAuthErrorResponse(401, 'UNAUTHORIZED', '请通过 Cloudflare Access 登录并确认已在家庭访问名单');
    }

    const bodyText = await context.request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return createApiErrorResponse(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return createApiErrorResponse(400, 'INVALID_JSON', '请求内容不是有效的 JSON');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return createApiErrorResponse(400, 'INVALID_REQUEST', '请求内容格式无效');
    }

    const payload = body as Record<string, unknown>;
    if (Object.keys(payload).some((key) => key !== 'story') || typeof payload.story !== 'string') {
      return createApiErrorResponse(400, 'INVALID_REQUEST', '请求只允许包含字符串字段 story');
    }

    if (payload.story.length > MAX_STORY_LENGTH) {
      return createApiErrorResponse(413, 'STORY_TOO_LONG', `照片故事不能超过 ${MAX_STORY_LENGTH} 个字符`);
    }

    const photoId = getPhotoId(context.params);
    if (!photoId) {
      return createApiErrorResponse(400, 'INVALID_PHOTO_ID', '照片标识无效');
    }

    const updatedAt = Date.now();
    const result = await context.env.DB
      .prepare(`
        UPDATE photos
        SET story = ?, updated_at = ?
        WHERE id = ?
          AND household_id = ?
          AND status = 'ready'
          AND deleted_at IS NULL
      `)
      .bind(payload.story, updatedAt, photoId, auth.householdId)
      .run();

    if (!result.success || (result.meta?.changes ?? 0) !== 1) {
      return createApiErrorResponse(404, 'PHOTO_NOT_FOUND', '照片不存在或不可编辑');
    }

    return new Response(JSON.stringify({
      id: photoId,
      story: payload.story,
      updatedAt,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    return createServerErrorResponse(err, 'PhotoStoryAPI', context.request);
  }
}