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

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DATABASE_BINDING_MISSING' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await authenticateRequest(context.request, db);
  if (!auth) {
    return createAuthErrorResponse(401, 'UNAUTHORIZED: 请先登录或提供有效的会话令牌');
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
