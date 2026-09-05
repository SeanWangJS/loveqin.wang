import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { authenticateRequest, createAuthErrorResponse, D1DatabaseBinding } from '../../functions/api/_auth';
import { verifyCloudflareAccessJwt, setJwksForTesting, JwkKey } from '../../functions/api/_accessJwt';
import { onRequestPost as handleLogin } from '../../functions/api/auth/login';
import { onRequestPost as handlePassword } from '../../functions/api/auth/password';
import { onRequestPost as handleLogoutAll } from '../../functions/api/auth/logout-all';
import { onRequestPost as handleLogout } from '../../functions/api/auth/logout';
import { onRequestGet as handleSession } from '../../functions/api/auth/session';
import { onRequestGet as handleMe } from '../../functions/api/auth/me';

// Helper: base64url encoding
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/_/g, '/').replace(/=+$/, '');
}

function stringToBase64Url(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

async function createSignedTestJwt(payload: any, privateKey: CryptoKey, kid: string, headerOverrides?: any): Promise<string> {
  const header = { alg: 'RS256', kid, typ: 'JWT', ...headerOverrides };
  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

describe('Cloudflare Access JWT Verifier (_accessJwt.ts)', () => {
  let keyPair: CryptoKeyPair;
  let testKid = 'test-access-kid-1';
  let teamDomain = 'loveqin';
  let teamAud = 'app-aud-test-123';

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const testJwk: JwkKey = {
      kid: testKid,
      kty: publicJwk.kty!,
      alg: 'RS256',
      n: publicJwk.n!,
      e: publicJwk.e!,
    };
    setJwksForTesting(teamDomain, [testJwk]);
  });

  afterEach(() => {
    // 保留测试 JWKS，若有需要清空可按测试用例进行
  });

  it('有效 RS256 签名与合法 Claims 应成功验签并返回用户信息', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'viewer@loveqin.wang',
      sub: 'access_sub_123',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);
    const verified = await verifyCloudflareAccessJwt(token, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).not.toBeNull();
    expect(verified?.email).toBe('viewer@loveqin.wang');
    expect(verified?.sub).toBe('access_sub_123');
  });

  it('支持 aud 字段为数组时的匹配校验', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: [teamAud, 'another-aud'],
      email: 'viewer2@loveqin.wang',
      sub: 'access_sub_456',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);
    const verified = await verifyCloudflareAccessJwt(token, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).not.toBeNull();
    expect(verified?.email).toBe('viewer2@loveqin.wang');
  });

  it('过期的 JWT (exp 在当前时间之前超过时钟容差) 应该被拒绝并返回 null', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'expired@loveqin.wang',
      sub: 'access_sub_exp',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec - 120, // 2 分钟前过期
      iat: nowSec - 3600,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);
    const verified = await verifyCloudflareAccessJwt(token, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).toBeNull();
  });

  it('Audience 不匹配时应该被拒绝并返回 null', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: 'wrong-aud',
      email: 'viewer@loveqin.wang',
      sub: 'access_sub_wrong_aud',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);
    const verified = await verifyCloudflareAccessJwt(token, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).toBeNull();
  });

  it('Issuer 与配置的 teamDomain 不匹配时应该被拒绝', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'viewer@loveqin.wang',
      sub: 'access_sub_wrong_iss',
      iss: 'https://attacker.cloudflareaccess.com',
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);
    const verified = await verifyCloudflareAccessJwt(token, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).toBeNull();
  });

  it('签名被篡改时必须拒绝', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'viewer@loveqin.wang',
      sub: 'access_sub_tampered',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);
    const parts = token.split('.');
    // 篡改签名最后几个字符
    const tamperedToken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}XXXX`;

    const verified = await verifyCloudflareAccessJwt(tamperedToken, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).toBeNull();
  });

  it('Key ID (kid) 未在 JWKS 中找到时必须拒绝', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'viewer@loveqin.wang',
      sub: 'access_sub_unknown_kid',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, 'unknown-kid');
    const verified = await verifyCloudflareAccessJwt(token, {
      teamDomain,
      aud: teamAud,
    });

    expect(verified).toBeNull();
  });

  it('缺少 team domain 或 audience 配置时必须拒绝，即使 JWT 签名有效', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'viewer@loveqin.wang',
      sub: 'access_sub_missing_config',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };
    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);

    await expect(verifyCloudflareAccessJwt(token, { teamDomain })).resolves.toBeNull();
    await expect(verifyCloudflareAccessJwt(token, { aud: teamAud })).resolves.toBeNull();
  });
});

describe('Cloudflare Pages Functions Auth Guard (_auth.ts)', () => {
  let keyPair: CryptoKeyPair;
  let testKid = 'guard-access-kid-1';
  let teamDomain = 'loveqin';
  let teamAud = 'app-aud-guard';

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    setJwksForTesting(teamDomain, [
      {
        kid: testKid,
        kty: publicJwk.kty!,
        alg: 'RS256',
        n: publicJwk.n!,
        e: publicJwk.e!,
      },
    ]);
  });

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
    const auth = await authenticateRequest(req, mockDb, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });
    expect(auth).toBeNull();
  });

  it('必须严禁使用 x-dev-auto-login 或伪造 Bearer Token 绕过认证 (P0 安全防线)', async () => {
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
        Authorization: 'Bearer fake_token_123',
      },
    });
    const auth = await authenticateRequest(req, mockDb, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });
    expect(auth).toBeNull();
  });

  it('生产/非 local 环境下必须忽略 x-dev-mock-email 请求头', async () => {
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    };
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        'x-dev-mock-email': 'owner@loveqin.wang',
      },
    });
    // 未传递 ENVIRONMENT: 'local'
    const auth = await authenticateRequest(req, mockDb, undefined, {
      ENVIRONMENT: 'production',
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });
    expect(auth).toBeNull();
  });

  it('local 环境下通过 x-dev-mock-email 且白名单活跃时，应成功解析并统一返回 role: viewer', async () => {
    const mockRow = {
      user_id: 'user_dev_1',
      display_name: '本地开发用户',
      email: 'dev@loveqin.wang',
      user_status: 'active',
      household_id: 'household_default',
      member_role: 'owner', // 数据库中原有的历史角色
      member_status: 'active',
    };

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(mockRow),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        'x-dev-mock-email': 'dev@loveqin.wang',
      },
    });

    const auth = await authenticateRequest(req, mockDb, undefined, {
      ENVIRONMENT: 'local',
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    expect(auth).not.toBeNull();
    expect(auth?.user.id).toBe('user_dev_1');
    expect(auth?.user.displayName).toBe('本地开发用户');
    expect(auth?.user.email).toBe('dev@loveqin.wang');
    expect(auth?.householdId).toBe('household_default');
    // 全员收敛为只读访客角色
    expect(auth?.role).toBe('viewer');
  });

  it('持有合法 Cloudflare Access JWT Assertion 且在家庭活跃白名单中时成功认证为 viewer', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'family@loveqin.wang',
      sub: 'cf_sub_family_1',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);

    const mockRow = {
      user_id: 'user_family_1',
      display_name: '家庭成员秦秦',
      email: 'family@loveqin.wang',
      user_status: 'active',
      household_id: 'hh_main',
      member_role: 'member',
      member_status: 'active',
    };

    const capturedQueries: string[] = [];
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        capturedQueries.push(sql);
        // 如果是 auth_identities 快速查询，模拟首次登录尚未建立映射 (返回 null)，触发邮箱白名单查询和建链
        if (sql.includes('auth_identities') && sql.includes('SELECT')) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(null),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(mockRow),
            run: vi.fn().mockResolvedValue({ success: true }),
          }),
        };
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        'CF-Access-Jwt-Assertion': token,
      },
    });

    const auth = await authenticateRequest(req, mockDb, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    expect(auth).not.toBeNull();
    expect(auth?.user.id).toBe('user_family_1');
    expect(auth?.user.displayName).toBe('家庭成员秦秦');
    expect(auth?.user.email).toBe('family@loveqin.wang');
    expect(auth?.role).toBe('viewer');

    // 验证 SQL 查询列名与条件规范
    const emailWhitelistSql = capturedQueries.find((s) => s.includes('u.email_normalized = ?'));
    expect(emailWhitelistSql).toBeDefined();
    expect(emailWhitelistSql).toContain("u.status = 'active'");
    expect(emailWhitelistSql).toContain("m.status = 'active'");
    expect(emailWhitelistSql).toContain('u.display_name AS display_name');
  });

  it('白名单防御: 当 Access 认证通过但 D1 用户不存在或未加入活跃家庭时，坚决拒绝并返回 null', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: teamAud,
      email: 'stranger@gmail.com', // 未授权的局外人邮箱
      sub: 'cf_sub_stranger',
      iss: `https://${teamDomain}.cloudflareaccess.com`,
      exp: nowSec + 3600,
      iat: nowSec,
    };

    const token = await createSignedTestJwt(payload, keyPair.privateKey, testKid);

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null), // 白名单无匹配
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/photos', {
      headers: {
        'CF-Access-Jwt-Assertion': token,
      },
    });

    const auth = await authenticateRequest(req, mockDb, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

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

describe('Web Crypto 认证辅助工具 (_authCrypto.ts)', () => {
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
    expect(key).toHaveLength(128);

    const isValid = await verifyPasswordWeb(password, storedHash);
    expect(isValid).toBe(true);

    const isWrong = await verifyPasswordWeb('WrongPassword!', storedHash);
    expect(isWrong).toBe(false);
  });
});

describe('Fail-Closed: 弃用旧自建口令接口与新只读会话契约', () => {
  it('POST /api/auth/login: 自建密码登录必须永久弃用并返回 410 GONE', async () => {
    const req = new Request('https://loveqin.wang/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@loveqin.wang', password: 'password123' }),
    });

    const res = await handleLogin({
      request: req,
      env: {} as any,
      params: {},
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('AUTH_METHOD_DEPRECATED');
    expect(body.message).toContain('Cloudflare Access');
  });

  it('POST /api/auth/password: 网页端改密接口必须永久弃用并返回 410 GONE', async () => {
    const req = new Request('https://loveqin.wang/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: 'old', newPassword: 'new' }),
    });

    const res = await handlePassword({
      request: req,
      env: {} as any,
      params: {},
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('AUTH_METHOD_DEPRECATED');
  });

  it('POST /api/auth/logout-all: 全局注销接口必须永久弃用并返回 410 GONE', async () => {
    const req = new Request('https://loveqin.wang/api/auth/logout-all', {
      method: 'POST',
    });

    const res = await handleLogoutAll({
      request: req,
      env: {} as any,
      params: {},
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('AUTH_METHOD_DEPRECATED');
  });

  it('POST /api/auth/logout: 应该返回 200、清空 Cookie 并重定向到 Cloudflare Access 登出地址', async () => {
    const req = new Request('https://loveqin.wang/api/auth/logout', {
      method: 'POST',
    });

    const res = await handleLogout({
      request: req,
      env: {} as any,
      params: {},
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toContain('session_token=;');
    expect(cookie).toContain('Max-Age=0');

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.loggedOut).toBe(true);
    expect(body.logoutUrl).toContain('/cdn-cgi/access/logout');
  });

  it('GET /api/auth/session 与 /api/auth/me: 未认证时返回 401 UNAUTHORIZED', async () => {
    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/auth/session');
    const resSession = await handleSession({
      request: req,
      env: { DB: mockDb } as any,
      params: {},
    });

    expect(resSession.status).toBe(401);
    const bodySession = await resSession.json();
    expect(bodySession.error).toContain('UNAUTHORIZED');

    const resMe = await handleMe({
      request: req,
      env: { DB: mockDb } as any,
      params: {},
    });
    expect(resMe.status).toBe(401);
    const bodyMe = await resMe.json();
    expect(bodyMe.error).toContain('UNAUTHORIZED');
  });

  it('GET /api/auth/session: 认证通过时返回 viewer 角色', async () => {
    const mockRow = {
      user_id: 'user_auth_1',
      display_name: '认证用户',
      email: 'auth@loveqin.wang',
      user_status: 'active',
      household_id: 'hh_main',
      member_role: 'owner',
      member_status: 'active',
    };

    const mockDb: D1DatabaseBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(mockRow),
        }),
      }),
    };

    const req = new Request('https://loveqin.wang/api/auth/session', {
      headers: {
        'x-dev-mock-email': 'auth@loveqin.wang',
      },
    });

    const res = await handleSession({
      request: req,
      env: { DB: mockDb, ENVIRONMENT: 'local' } as any,
      params: {},
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.role).toBe('viewer');
    expect(body.user.email).toBe('auth@loveqin.wang');
  });
});
