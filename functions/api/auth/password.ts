import { authenticateRequest, createAuthErrorResponse, D1DatabaseBinding } from '../_auth';
import {
  generateTokenWeb,
  sha256Web,
  hashPasswordWeb,
  verifyPasswordWeb,
  buildSessionCookie,
} from './_authCrypto';

interface Env {
  DB: D1DatabaseBinding;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

/**
 * POST /api/auth/password
 * 修改密码端点：校验旧密码，更新密码哈希并原子递增 session_version，使所有旧设备会话失效
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DATABASE_BINDING_MISSING' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // 1. 严格鉴权：必须持有有效会话才能修改密码
  const auth = await authenticateRequest(context.request, db);
  if (!auth) {
    return createAuthErrorResponse(401, 'UNAUTHORIZED: 请先登录');
  }

  const userId = auth.user.id;

  // 2. 解析请求负载
  let body: { oldPassword?: string; newPassword?: string } = {};
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'INVALID_JSON_PAYLOAD' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const oldPassword = body.oldPassword;
  const newPassword = body.newPassword;

  if (!oldPassword || typeof oldPassword !== 'string' || !newPassword || typeof newPassword !== 'string') {
    return new Response(JSON.stringify({ error: 'OLD_AND_NEW_PASSWORD_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (newPassword.length < 8) {
    return new Response(JSON.stringify({ error: 'PASSWORD_TOO_SHORT', minLength: 8 }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    // 3. 查询用户当前密码哈希与版本
    const user = await db
      .prepare('SELECT id, password_hash, session_version FROM users WHERE id = ?')
      .bind(userId)
      .first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'USER_NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 4. 校验旧密码
    const isOldValid = await verifyPasswordWeb(oldPassword, user.password_hash);
    if (!isOldValid) {
      return new Response(JSON.stringify({ error: 'INVALID_OLD_PASSWORD' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 5. 生成新密码加盐哈希
    const newPasswordHash = await hashPasswordWeb(newPassword);
    const newSessionVersion = (user.session_version || 1) + 1;
    const now = Date.now();

    // 6. 原子更新用户密码并递增版本号（使所有其他设备的旧 Token 立即失效）
    await db
      .prepare('UPDATE users SET password_hash = ?, session_version = ? WHERE id = ?')
      .bind(newPasswordHash, newSessionVersion, userId)
      .first();

    // 7. 标记历史所有会话为 revoked
    await db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, userId)
      .first();

    // 8. 为当前设备无缝签发基于新版本号的新会话凭证
    const rawToken = generateTokenWeb();
    const tokenHash = await sha256Web(rawToken);
    const sessionId = `sess_${rawToken.slice(0, 16)}`;
    const expiresAt = now + 30 * 24 * 3600 * 1000;

    await db
      .prepare(
        'INSERT INTO sessions (id, user_id, token_hash, session_version, expires_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
      )
      .bind(sessionId, userId, tokenHash, newSessionVersion, expiresAt, now)
      .first();

    // 9. 更新当前设备的 Cookie
    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.set('Set-Cookie', buildSessionCookie(rawToken, 30 * 24 * 3600));

    return new Response(
      JSON.stringify({
        success: true,
        message: 'PASSWORD_CHANGED_AND_ALL_OTHER_SESSIONS_INVALIDATED',
        token: rawToken,
      }),
      {
        status: 200,
        headers,
      }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'CHANGE_PASSWORD_FAILED', details: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
