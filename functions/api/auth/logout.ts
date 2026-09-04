import { D1DatabaseBinding } from '../_auth';
import { sha256Web, buildClearSessionCookie } from './_authCrypto';

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

  // 1. 尝试从 Authorization 或 Cookie 获取待吊销的 Token
  let token = '';
  const authHeader = context.request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    const cookieHeader = context.request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)session_token=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

  // 2. 如果存在 Token 且数据库可用，标记会话为 revoked
  if (token && db) {
    try {
      const tokenHash = await sha256Web(token);
      await db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
        .bind(Date.now(), tokenHash)
        .first();
    } catch {
      // 容错忽略数据库写入失败，确保客户端 Cookie 仍能成功清除
    }
  }

  // 3. 响应清空 Cookie
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Set-Cookie', buildClearSessionCookie());

  return new Response(JSON.stringify({ success: true, loggedOut: true }), {
    status: 200,
    headers,
  });
}
