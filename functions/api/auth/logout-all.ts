/**
 * POST /api/auth/logout-all [已废弃 / Fail Closed]
 * 遵照 docs/reviews/2026-09-05-overall-security-review.md 架构规范：
 * 全局登出与会话撤销由 Cloudflare Access 统一接管
 */
export async function onRequest(_context?: unknown): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'AUTH_METHOD_DEPRECATED',
      message: '自建全局登出已安全下线，请通过 Cloudflare Access /cdn-cgi/access/logout 退出所有会话',
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export const onRequestPost = onRequest;
