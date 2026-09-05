import { buildClearSessionCookie } from './_authCrypto';

/**
 * POST/GET /api/auth/logout
 * 退出当前会话：清除本地残留凭据并返回 Cloudflare Access 官方注销地址
 */
export async function onRequest(context: { request: Request; [key: string]: unknown }): Promise<Response> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Set-Cookie', buildClearSessionCookie());

  const url = new URL(context.request.url);
  const logoutUrl = `${url.origin}/cdn-cgi/access/logout`;

  return new Response(
    JSON.stringify({
      success: true,
      loggedOut: true,
      logoutUrl,
    }),
    {
      status: 200,
      headers,
    }
  );
}

export const onRequestPost = onRequest;
