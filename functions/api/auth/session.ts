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

  const auth = await authenticateRequest(context.request, db, undefined, context.env as any);
  if (!auth) {
    return createAuthErrorResponse(401, 'UNAUTHORIZED: 请通过 Cloudflare Access 登录并确认已在家庭访问名单');
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
