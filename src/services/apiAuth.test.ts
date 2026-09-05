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

describe('Web Crypto 认证工具模块 (_authCrypto.ts)', () => {
  it('generateTokenWeb 应该生成 64 字符的十六进制高熵字符串', async () => {
    const { generateTokenWeb } = await import('../../functions/api/auth/_authCrypto');
    const token = generateTokenWeb();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it('sha256Web 应该生成正确的 SHA-256 哈希', async () => {
    const { sha256Web } = await import('../../functions/api/auth/_authCrypto');
    const hash = await sha256Web('hello world');
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('hashPasswordWeb 与 verifyPasswordWeb 应该支持加盐慢哈希与恒定时间验证', async () => {
    const { hashPasswordWeb, verifyPasswordWeb } = await import('../../functions/api/auth/_authCrypto');
    const password = 'CorrectHorseBatteryStaple123!';
    const storedHash = await hashPasswordWeb(password);

    expect(storedHash).toContain(':');
    const [salt, key] = storedHash.split(':');
    expect(salt).toHaveLength(32);
    expect(key).toHaveLength(128); // 64 bytes = 128 hex chars

    const isValid = await verifyPasswordWeb(password, storedHash);
    expect(isValid).toBe(true);

    const isWrong = await verifyPasswordWeb('WrongPassword!', storedHash);
    expect(isWrong).toBe(false);
  });
});

describe('Cloudflare Pages Functions Login & Logout API', () => {
  it('POST /api/auth/login: 凭证错误时应该返回 401', async () => {
    const { onRequestPost: handleLogin } = await import('../../functions/api/auth/login');
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null), // 用户不存在
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@loveqin.wang', password: 'bad' }),
    });

    const res = await handleLogin({
      request: req,
      env: { DB: mockDb },
      params: {},
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/auth/login: 密码正确时应该返回 200 并设置 HttpOnly Cookie', async () => {
    const { onRequestPost: handleLogin } = await import('../../functions/api/auth/login');
    const { hashPasswordWeb } = await import('../../functions/api/auth/_authCrypto');

    const password = 'SecurePassword123';
    const passwordHash = await hashPasswordWeb(password);

    const mockUser = {
      id: 'user_1',
      email_normalized: 'owner@loveqin.wang',
      display_name: '空间主人',
      password_hash: passwordHash,
      session_version: 1,
      status: 'active',
    };

    const mockMember = {
      household_id: 'household_default',
      role: 'owner',
      status: 'active',
    };

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        return {
          bind: vi.fn().mockImplementation((..._args: any[]) => {
            if (sql.includes('FROM users')) {
              return { first: vi.fn().mockResolvedValue(mockUser) };
            }
            if (sql.includes('FROM household_members')) {
              return { first: vi.fn().mockResolvedValue(mockMember) };
            }
            if (sql.includes('INSERT INTO sessions')) {
              return { first: vi.fn().mockResolvedValue({}) };
            }
            return { first: vi.fn().mockResolvedValue(null) };
          }),
        };
      }),
    };

    const req = new Request('https://loveqin.wang/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@loveqin.wang', password }),
    });

    const res = await handleLogin({
      request: req,
      env: { DB: mockDb },
      params: {},
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toContain('session_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.user.displayName).toBe('空间主人');
    expect(data.householdId).toBe('household_default');
    expect(data.role).toBe('owner');
  });

  it('POST /api/auth/logout: 应该返回 200 并清空 Cookie', async () => {
    const { onRequestPost: handleLogout } = await import('../../functions/api/auth/logout');
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({}),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test_logout_token',
      },
    });

    const res = await handleLogout({
      request: req,
      env: { DB: mockDb },
      params: {},
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toContain('session_token=;');
    expect(cookie).toContain('Max-Age=0');

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.loggedOut).toBe(true);
  });

  it('POST /api/auth/logout-all: 未登录时返回 401，已登录时递增 session_version 并清空 Cookie', async () => {
    const { onRequestPost: handleLogoutAll } = await import('../../functions/api/auth/logout-all');

    // 1. 未登录调用
    const mockDbUnauth: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    };

    const unauthReq = new Request('https://loveqin.wang/api/auth/logout-all', { method: 'POST' });
    const unauthRes = await handleLogoutAll({ request: unauthReq, env: { DB: mockDbUnauth }, params: {} });
    expect(unauthRes.status).toBe(401);

    // 2. 已登录调用
    let updatedSessionVersionSql = false;
    const mockAuthRow = {
      session_id: 'sess_1',
      session_version: 1,
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_1',
      display_name: '空间主人',
      email: 'owner@loveqin.wang',
      user_session_version: 1,
      user_status: 'active',
      household_id: 'household_default',
      role: 'owner',
      member_status: 'active',
    };

    const mockBatch = vi.fn().mockResolvedValue([{ success: true }, { success: true }]);
    const mockDbAuth: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('UPDATE users SET session_version = session_version + 1')) {
          updatedSessionVersionSql = true;
        }
        return {
          bind: vi.fn().mockImplementation((..._args: any[]) => {
            if (sql.includes('FROM sessions s')) {
              return { first: vi.fn().mockResolvedValue(mockAuthRow) };
            }
            return { first: vi.fn().mockResolvedValue({}) };
          }),
        };
      }),
      batch: mockBatch,
    };

    const authReq = new Request('https://loveqin.wang/api/auth/logout-all', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token' },
    });

    const authRes = await handleLogoutAll({ request: authReq, env: { DB: mockDbAuth }, params: {} });
    expect(authRes.status).toBe(200);
    expect(updatedSessionVersionSql).toBe(true);
    expect(mockBatch).toHaveBeenCalledTimes(1);
    const cookie = authRes.headers.get('Set-Cookie');
    expect(cookie).toContain('session_token=;');
    expect(cookie).toContain('Max-Age=0');
  });

  it('POST /api/auth/password: 校验旧密码、更新哈希并通过 D1 batch 原子递增 session_version', async () => {
    const { onRequestPost: handlePassword } = await import('../../functions/api/auth/password');
    const { hashPasswordWeb } = await import('../../functions/api/auth/_authCrypto');

    const oldPassword = 'OldSecretPassword123';
    const oldHash = await hashPasswordWeb(oldPassword);

    const mockAuthRow = {
      session_id: 'sess_1',
      session_version: 1,
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_1',
      display_name: '空间主人',
      email: 'owner@loveqin.wang',
      user_session_version: 1,
      user_status: 'active',
      household_id: 'household_default',
      role: 'owner',
      member_status: 'active',
    };

    const mockUserRecord = {
      id: 'user_1',
      password_hash: oldHash,
      session_version: 1,
    };

    let sessionVersionIncremented = false;
    const mockBatch = vi.fn().mockResolvedValue([{ success: true }, { success: true }, { success: true }]);

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('UPDATE users') && sql.includes('session_version = CASE WHEN session_version = ?')) {
          sessionVersionIncremented = true;
        }
        return {
          bind: vi.fn().mockImplementation((..._args: any[]) => {
            if (sql.includes('FROM sessions s')) {
              return { first: vi.fn().mockResolvedValue(mockAuthRow) };
            }
            if (sql.includes('SELECT id, password_hash, session_version FROM users')) {
              return { first: vi.fn().mockResolvedValue(mockUserRecord) };
            }
            return { first: vi.fn().mockResolvedValue({}) };
          }),
        };
      }),
      batch: mockBatch,
    };

    // 1. 旧密码错误校验
    const wrongReq = new Request('https://loveqin.wang/api/auth/password', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: 'WrongOldPassword', newPassword: 'BrandNewPassword123' }),
    });
    const wrongRes = await handlePassword({ request: wrongReq, env: { DB: mockDb }, params: {} });
    expect(wrongRes.status).toBe(400);
    const wrongData = await wrongRes.json();
    expect(wrongData.error).toBe('INVALID_OLD_PASSWORD');

    // 2. 正确修改密码
    const correctReq = new Request('https://loveqin.wang/api/auth/password', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword: 'BrandNewPassword123' }),
    });
    const correctRes = await handlePassword({ request: correctReq, env: { DB: mockDb }, params: {} });
    expect(correctRes.status).toBe(200);
    expect(sessionVersionIncremented).toBe(true);
    expect(mockBatch).toHaveBeenCalledTimes(1);

    const cookie = correctRes.headers.get('Set-Cookie');
    expect(cookie).toContain('session_token=');
    expect(cookie).toContain('HttpOnly');

    const correctData = await correctRes.json();
    expect(correctData.success).toBe(true);
    expect(correctData.token).toBeDefined();
  });

  it('P2 故障注入: 当 D1 batch 事务中途失败时，全局登出/改密必须整体回滚并返回 500', async () => {
    const { onRequestPost: handleLogoutAll } = await import('../../functions/api/auth/logout-all');
    const { onRequestPost: handlePassword } = await import('../../functions/api/auth/password');
    const { hashPasswordWeb } = await import('../../functions/api/auth/_authCrypto');

    const mockAuthRow = {
      session_id: 'sess_1',
      session_version: 1,
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_1',
      display_name: '空间主人',
      email: 'owner@loveqin.wang',
      user_session_version: 1,
      user_status: 'active',
      household_id: 'household_default',
      role: 'owner',
      member_status: 'active',
    };

    // 1. logout-all 故障注入：batch 抛错
    const failingDbLogout: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockImplementation((..._args: any[]) => ({
          first: vi.fn().mockResolvedValue(mockAuthRow),
        })),
      }),
      batch: vi.fn().mockRejectedValue(new Error('D1_BATCH_ROLLBACK_SIMULATED')),
    };

    const logoutReq = new Request('https://loveqin.wang/api/auth/logout-all', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token' },
    });
    const logoutRes = await handleLogoutAll({ request: logoutReq, env: { DB: failingDbLogout }, params: {} });
    expect(logoutRes.status).toBe(500);
    const logoutData = await logoutRes.json();
    expect(logoutData.error).toBe('LOGOUT_ALL_FAILED');
    expect(logoutRes.headers.get('Set-Cookie')).toBeNull();

    // 2. password 故障注入：batch 抛错（模拟 session 插入冲突导致整批回滚）
    const oldPassword = 'OldPassword123';
    const oldHash = await hashPasswordWeb(oldPassword);
    const failingDbPassword: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => ({
        bind: vi.fn().mockImplementation((..._args: any[]) => {
          if (sql.includes('FROM sessions s')) {
            return { first: vi.fn().mockResolvedValue(mockAuthRow) };
          }
          if (sql.includes('SELECT id, password_hash, session_version FROM users')) {
            return { first: vi.fn().mockResolvedValue({ id: 'user_1', password_hash: oldHash, session_version: 1 }) };
          }
          return { first: vi.fn().mockResolvedValue({}) };
        }),
      })),
      batch: vi.fn().mockRejectedValue(new Error('D1_INSERT_SESSION_FAILED')),
    };

    const passReq = new Request('https://loveqin.wang/api/auth/password', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword: 'BrandNewPassword123' }),
    });
    const passRes = await handlePassword({ request: passReq, env: { DB: failingDbPassword }, params: {} });
    expect(passRes.status).toBe(500);
    const passData = await passRes.json();
    expect(passData.error).toBe('CHANGE_PASSWORD_FAILED');
    expect(passRes.headers.get('Set-Cookie')).toBeNull();
  });

  it('P2 并发防竞争: 并发改密且版本已变时，乐观锁触发约束失败回滚并返回 409 Conflict', async () => {
    const { onRequestPost: handlePassword } = await import('../../functions/api/auth/password');
    const { hashPasswordWeb } = await import('../../functions/api/auth/_authCrypto');

    const oldPassword = 'OldPassword123';
    const oldHash = await hashPasswordWeb(oldPassword);

    const mockAuthRow = {
      session_id: 'sess_1',
      session_version: 1,
      expires_at: Date.now() + 86400000,
      revoked_at: null,
      user_id: 'user_1',
      display_name: '空间主人',
      email: 'owner@loveqin.wang',
      user_session_version: 1,
      user_status: 'active',
      household_id: 'household_default',
      role: 'owner',
      member_status: 'active',
    };

    // 模拟并发竞态：其他并发请求已将 session_version 递增，导致 CASE WHEN ... ELSE NULL 触发 NOT NULL 约束失败
    const conflictDb: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => ({
        bind: vi.fn().mockImplementation((..._args: any[]) => {
          if (sql.includes('FROM sessions s')) {
            return { first: vi.fn().mockResolvedValue(mockAuthRow) };
          }
          if (sql.includes('SELECT id, password_hash, session_version FROM users')) {
            return { first: vi.fn().mockResolvedValue({ id: 'user_1', password_hash: oldHash, session_version: 1 }) };
          }
          return { first: vi.fn().mockResolvedValue({}) };
        }),
      })),
      batch: vi.fn().mockRejectedValue(new Error('D1_ERROR: NOT NULL constraint failed: users.session_version')),
    };

    const passReq = new Request('https://loveqin.wang/api/auth/password', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword: 'BrandNewPassword123' }),
    });
    const res = await handlePassword({ request: passReq, env: { DB: conflictDb }, params: {} });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('CONCURRENT_VERSION_CONFLICT');
    expect(data.message).toContain('并发');
  });
});


