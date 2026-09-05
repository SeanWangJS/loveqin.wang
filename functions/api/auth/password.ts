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
    const expectedSessionVersion = user.session_version || 1;
    const newSessionVersion = expectedSessionVersion + 1;
    const now = Date.now();

    // 6. 为当前设备签发基于新版本号的新会话凭证准备参数
    const rawToken = generateTokenWeb();
    const tokenHash = await sha256Web(rawToken);
    const sessionId = `sess_${rawToken.slice(0, 16)}`;
    const expiresAt = now + 30 * 24 * 3600 * 1000;

    // 7. D1 Batch 原子事务:
    // 语句 1: 乐观锁防并发版本竞争 - 当且仅当 session_version 等于当前读取的版本号时递增，
    //        若被并发请求抢先修改，则 session_version 赋值为 NULL 触发 NOT NULL 约束异常，导致整批原子回滚
    const stmtUpdateUser = db
      .prepare(
        `UPDATE users 
         SET password_hash = ?, 
             session_version = CASE WHEN session_version = ? THEN ? ELSE NULL END 
         WHERE id = ?`
      )
      .bind(newPasswordHash, expectedSessionVersion, newSessionVersion, userId);

    // 语句 2: 标记历史所有未撤销会话为 revoked
    const stmtRevokeSessions = db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(now, userId);

    // 语句 3: 为当前设备原子插入基于 newSessionVersion 的全新有效会话
    const stmtInsertSession = db
      .prepare(
        'INSERT INTO sessions (id, user_id, token_hash, session_version, expires_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
      )
      .bind(sessionId, userId, tokenHash, newSessionVersion, expiresAt, now);

    if (typeof db.batch === 'function') {
      await db.batch([stmtUpdateUser, stmtRevokeSessions, stmtInsertSession]);
    } else {
      await stmtUpdateUser.first();
      await stmtRevokeSessions.first();
      await stmtInsertSession.first();
    }

    // 8. 更新当前设备的 Cookie
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
    if (
      errMsg.includes('NOT NULL') ||
      errMsg.includes('constraint failed') ||
      errMsg.includes('CONCURRENT_VERSION_CONFLICT')
    ) {
      return new Response(
        JSON.stringify({ error: 'CONCURRENT_VERSION_CONFLICT', message: '检测到并发改密冲突，请刷新后重试' }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }
      );
    }
    return new Response(JSON.stringify({ error: 'CHANGE_PASSWORD_FAILED', details: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
