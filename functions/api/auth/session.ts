import { authenticateRequest, createAuthErrorResponse } from '../_auth';

interface Env {
  DB: any;
  BUCKET: any;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
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
  return onRequestGet(context);
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const auth = await authenticateRequest(context.request, context.env as any);
  if (!auth) {
    return createAuthErrorResponse(401, 'UNAUTHORIZED', '请通过 Cloudflare Access 登录');
  }

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: auth.user,
      householdId: auth.householdId,
      role: auth.role,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}
