import { D1DatabaseBinding } from '../_auth';
import { generateTokenWeb, sha256Web, verifyPasswordWeb, buildSessionCookie } from './_authCrypto';

interface Env {
  DB: D1DatabaseBinding;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DATABASE_BINDING_MISSING' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // 1. CSRF 防护：校验请求来源 (允许同源或本机调试)
  const origin = context.request.headers.get('Origin');
  const host = context.request.headers.get('Host');
  if (origin && host && !host.includes('localhost') && !origin.includes('localhost')) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return new Response(JSON.stringify({ error: 'CSRF_ORIGIN_MISMATCH' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
    } catch {}
  }

  // 2. 解析登录表单负载
  let body: { email?: string; password?: string } = {};
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'INVALID_JSON_PAYLOAD' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const rawEmail = body.email;
  const rawPassword = body.password;

  if (!rawEmail || typeof rawEmail !== 'string' || !rawPassword || typeof rawPassword !== 'string') {
    return new Response(JSON.stringify({ error: 'EMAIL_AND_PASSWORD_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const emailNormalized = rawEmail.trim().toLowerCase();

  try {
    // 3. 严格依据 docs/DATABASE_DESIGN.md 查询用户主表
    const user = await db
      .prepare(
        'SELECT id, email_normalized, display_name, password_hash, session_version, status FROM users WHERE email_normalized = ?'
      )
      .bind(emailNormalized)
      .first();

    if (!user || user.status !== 'active') {
      return new Response(JSON.stringify({ error: 'INVALID_CREDENTIALS' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 4. 校验密码哈希
    const isPasswordValid = await verifyPasswordWeb(rawPassword, user.password_hash);
    if (!isPasswordValid) {
      return new Response(JSON.stringify({ error: 'INVALID_CREDENTIALS' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 5. 查询用户归属的活跃家庭空间成员身份
    const member = await db
      .prepare(
        'SELECT household_id, role, status FROM household_members WHERE user_id = ? AND status = ? ORDER BY role = ? DESC, joined_at ASC LIMIT 1'
      )
      .bind(user.id, 'active', 'owner')
      .first();

    if (!member) {
      return new Response(JSON.stringify({ error: 'NO_ACTIVE_HOUSEHOLD' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 6. 签发高熵会话凭证并写入 sessions 表
    const rawToken = generateTokenWeb();
    const tokenHash = await sha256Web(rawToken);
    const sessionId = `sess_${rawToken.slice(0, 16)}`;
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 3600 * 1000; // 30 天有效期

    await db
      .prepare(
        'INSERT INTO sessions (id, user_id, token_hash, session_version, expires_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
      )
      .bind(sessionId, user.id, tokenHash, user.session_version, expiresAt, now)
      .first();

    // 7. 返回安全 Cookie 与用户信息
    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.set('Set-Cookie', buildSessionCookie(rawToken, 30 * 24 * 3600));

    return new Response(
      JSON.stringify({
        success: true,
        token: rawToken,
        user: {
          id: user.id,
          displayName: user.display_name,
          email: user.email_normalized,
          nickname: user.display_name,
        },
        householdId: member.household_id,
        role: member.role,
      }),
      {
        status: 200,
        headers,
      }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'LOGIN_FAILED', details: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
