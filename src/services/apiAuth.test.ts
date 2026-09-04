import { describe, it, expect, vi } from 'vitest';
import { authenticateRequest, createAuthErrorResponse, D1DatabaseBinding } from '../../functions/api/_auth';

describe('Cloudflare Pages Functions Auth Guard (_auth.ts)', () => {
  const mockDb: D1DatabaseBinding = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    }),
  };

  it('应该拒绝没有任何凭据的普通请求并返回 null', async () => {
    const req = new Request('https://loveqin.wang/api/photos');
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('必须严禁使用 x-dev-auto-login 请求头绕过认证 (P0 安全防线)', async () => {
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        'x-dev-auto-login': 'true',
      },
    });
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('应该拒绝伪造的 Bearer Token 并返回 null', async () => {
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        Authorization: 'Bearer forged_fake_token_123',
      },
    });
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('createAuthErrorResponse 应该返回正确的状态码与 no-store 缓存头', async () => {
    const res401 = createAuthErrorResponse(401, 'UNAUTHORIZED');
    expect(res401.status).toBe(401);
    expect(res401.headers.get('Cache-Control')).toBe('no-store');
    const body401 = await res401.json();
    expect(body401).toEqual({ error: 'UNAUTHORIZED' });

    const res403 = createAuthErrorResponse(403, 'FORBIDDEN');
    expect(res403.status).toBe(403);
    const body403 = await res403.json();
    expect(body403).toEqual({ error: 'FORBIDDEN' });
  });
});
