import { authenticateRequest, createAuthErrorResponse, D1DatabaseBinding } from '../_auth';
import { buildClearSessionCookie } from './_authCrypto';

interface Env {
  DB: D1DatabaseBinding;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

/**
 * POST /api/auth/logout-all
 * 全局登出端点：原子递增 users.session_version，使所有已签发的旧会话全部失效
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DATABASE_BINDING_MISSING' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // 1. 严格鉴权：必须持有有效会话才能触发全局登出
  const auth = await authenticateRequest(context.request, db);
  if (!auth) {
    return createAuthErrorResponse(401, 'UNAUTHORIZED: 请先登录');
  }

  const userId = auth.user.id;
  const now = Date.now();

  try {
    // 2. D1 Batch 原子事务：递增 session_version 并撤销所有活跃会话（保证跨表写入的强原子性）
    const stmtUpdateUser = db
      .prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')
      .bind(userId);

    const stmtRevokeSessions = db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, userId);

    if (typeof db.batch === 'function') {
      await db.batch([stmtUpdateUser, stmtRevokeSessions]);
    } else {
      await stmtUpdateUser.first();
      await stmtRevokeSessions.first();
    }

    // 4. 清除当前设备的 Cookie
    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.set('Set-Cookie', buildClearSessionCookie());

    return new Response(
      JSON.stringify({
        success: true,
        loggedOutAll: true,
        message: 'ALL_SESSIONS_INVALIDATED',
      }),
      {
        status: 200,
        headers,
      }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'LOGOUT_ALL_FAILED', details: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
