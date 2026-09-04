import { describe, it, expect, vi } from 'vitest';
import { authenticateRequest, createAuthErrorResponse, D1DatabaseBinding } from '../../functions/api/_auth';

describe('Cloudflare Pages Functions Auth Guard (_auth.ts)', () => {
  it('应该拒绝没有任何凭据的普通请求并返回 null', async () => {
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    };
    const req = new Request('https://loveqin.wang/api/photos');
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('必须严禁使用 x-dev-auto-login 请求头绕过认证 (P0 安全防线)', async () => {
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    };
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        'x-dev-auto-login': 'true',
      },
    });
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('应该拒绝伪造或在数据库中不存在的 Bearer Token', async () => {
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    };
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        Authorization: 'Bearer non_existent_token_123',
      },
    });
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('P0-2: 执行的 SQL 必须严格查询 display_name 与 email_normalized，绝不查询 nickname 或 email', async () => {
    let capturedSql = '';
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        capturedSql = sql;
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        };
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        Authorization: 'Bearer test_token',
      },
    });
    await authenticateRequest(req, mockDb);

    // 验证严格对照 docs/DATABASE_DESIGN.md 的列名
    expect(capturedSql).toContain('u.display_name AS display_name');
    expect(capturedSql).toContain('u.email_normalized AS email');
    expect(capturedSql).not.toContain('u.nickname');
    expect(capturedSql).not.toContain('u.email,');
  });

  it('合法 Session 且版本一致时，应成功解析并返回用户信息与家庭空间角色', async () => {
    const mockRow = {
      session_id: 'sess_123',
      session_version: 1,
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_owner_default',
      display_name: '空间主人',
      email: 'owner@loveqin.wang',
      user_session_version: 1,
      user_status: 'active',
      household_id: 'household_default',
      role: 'owner',
      member_status: 'active',
    };

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(mockRow),
          all: vi.fn().mockResolvedValue({ results: [mockRow] }),
          run: vi.fn().mockResolvedValue({}),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        Authorization: 'Bearer valid_test_token',
      },
    });
    const auth = await authenticateRequest(req, mockDb);

    expect(auth).not.toBeNull();
    expect(auth?.user.id).toBe('user_owner_default');
    expect(auth?.user.displayName).toBe('空间主人');
    expect(auth?.user.email).toBe('owner@loveqin.wang');
    expect(auth?.user.nickname).toBe('空间主人');
    expect(auth?.householdId).toBe('household_default');
    expect(auth?.role).toBe('owner');
  });

  it('P1-5: 当 session_version 与 user_session_version 不匹配时 (用户已修改密码或全退)，必须拒绝', async () => {
    const staleSessionRow = {
      session_id: 'sess_old',
      session_version: 1, // 旧会话版本
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_owner_default',
      display_name: '空间主人',
      email: 'owner@loveqin.wang',
      user_session_version: 2, // 用户已升级版本号 (如修改了密码)
      user_status: 'active',
      household_id: 'household_default',
      role: 'owner',
      member_status: 'active',
    };

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(staleSessionRow),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        Authorization: 'Bearer stale_token',
      },
    });
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).toBeNull();
  });

  it('支持从 Cookie: session_token 解析并成功认证', async () => {
    const mockRow = {
      session_id: 'sess_cookie',
      session_version: 1,
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_member_1',
      display_name: '家庭成员',
      email: 'member@loveqin.wang',
      user_session_version: 1,
      user_status: 'active',
      household_id: 'household_default',
      role: 'member',
      member_status: 'active',
    };

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(mockRow),
          all: vi.fn().mockResolvedValue({ results: [mockRow] }),
          run: vi.fn().mockResolvedValue({}),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        Cookie: 'other=123; session_token=my_secret_token; foo=bar',
      },
    });
    const auth = await authenticateRequest(req, mockDb);
    expect(auth).not.toBeNull();
    expect(auth?.user.displayName).toBe('家庭成员');
    expect(auth?.role).toBe('member');
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
