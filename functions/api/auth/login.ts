/**
 * POST /api/auth/login [已废弃 / Fail Closed]
 * 遵照 docs/reviews/2026-09-05-overall-security-review.md 架构规范：
 * 废除自建密码登录，统一托管至 Cloudflare Access (Google OAuth / Email OTP)
 */
export async function onRequest(_context?: unknown): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'AUTH_METHOD_DEPRECATED',
      message: '自建密码认证已安全下线，请通过 Cloudflare Access (Google OAuth / Email OTP) 访问',
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
