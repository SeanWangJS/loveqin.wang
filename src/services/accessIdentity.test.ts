import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { authenticateRequest, D1DatabaseBinding } from '../../functions/api/_auth';
import { setJwksForTesting, JwkKey } from '../../functions/api/_accessJwt';

function createD1Adapter(sqlite: Database.Database): D1DatabaseBinding {
  return {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          try {
            const stmt = sqlite.prepare(query);
            const rows = stmt.all(...args);
            return { results: rows };
          } catch (err) {
            console.error('SQL all error:', query, args, err);
            throw err;
          }
        },
        first: async () => {
          try {
            const stmt = sqlite.prepare(query);
            const row = stmt.get(...args);
            return row || null;
          } catch (err) {
            console.error('SQL first error:', query, args, err);
            throw err;
          }
        },
        run: async () => {
          try {
            const stmt = sqlite.prepare(query);
            const info = stmt.run(...args);
            return { success: true, meta: { changes: info.changes } };
          } catch (err) {
            console.error('SQL run error:', query, args, err);
            throw err;
          }
        },
      }),
    }),
  };
}

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

async function createSignedJwt(payload: any, privateKey: CryptoKey, kid: string): Promise<string> {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

describe('Cloudflare Access 稳定身份映射与多登录方式归一化测试 (_auth.ts & auth_identities)', () => {
  let sqlite: Database.Database;
  let d1Db: D1DatabaseBinding;
  let keyPair: CryptoKeyPair;
  const testKid = 'access-identity-kid-1';
  const teamDomain = 'loveqin';
  const teamAud = 'app-aud-identity-test';
  const issuer = `https://${teamDomain}.cloudflareaccess.com`;

  const householdId = 'hh_family_main';
  const userId = 'user_qin_main';
  const userEmail = 'qin@loveqin.wang';

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

    // 初始化内存 SQLite 数据库
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    sqlite.exec(`
      CREATE TABLE households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email_normalized TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        session_version INTEGER DEFAULT 1 NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE household_members (
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        joined_at INTEGER NOT NULL,
        removed_at INTEGER,
        PRIMARY KEY (household_id, user_id)
      );

      CREATE TABLE auth_identities (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        email_at_link TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_authenticated_at INTEGER NOT NULL,
        UNIQUE(issuer, subject)
      );
      CREATE INDEX idx_auth_identities_user_id ON auth_identities(user_id);
    `);

    const now = Date.now();
    sqlite.prepare('INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)').run(householdId, '琴境相册', now);
    sqlite.prepare(
      'INSERT INTO users (id, email_normalized, display_name, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, userEmail, '琴琴', 'unused_pw_hash', 'active', now);
    sqlite.prepare(
      'INSERT INTO household_members (household_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)'
    ).run(householdId, userId, 'member', 'active', now);

    d1Db = createD1Adapter(sqlite);
  });

  it('多登录源归一化：Google OAuth 与 Email OTP 登录同一邮箱，必须安全绑定到同一个 D1 用户', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const googleSub = 'google-oauth2|109283746501';
    const otpSub = 'cf-otp|uuid-9988-7766-5544';

    // 1. 模拟 Google OAuth 首次登录
    const googlePayload = {
      aud: teamAud,
      email: userEmail,
      sub: googleSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    };
    const googleToken = await createSignedJwt(googlePayload, keyPair.privateKey, testKid);
    const googleReq = new Request('https://loveqin.wang/api/photos', {
      headers: { 'CF-Access-Jwt-Assertion': googleToken },
    });

    const auth1 = await authenticateRequest(googleReq, d1Db, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    expect(auth1).not.toBeNull();
    expect(auth1?.user.id).toBe(userId);
    expect(auth1?.user.email).toBe(userEmail);
    expect(auth1?.role).toBe('viewer');

    // 检查 auth_identities 表已记录 Google 绑定
    const googleIdentity = sqlite
      .prepare('SELECT * FROM auth_identities WHERE issuer = ? AND subject = ?')
      .get(issuer, googleSub) as any;
    expect(googleIdentity).toBeDefined();
    expect(googleIdentity.user_id).toBe(userId);
    expect(googleIdentity.email_at_link).toBe(userEmail);

    // 2. 模拟该成员下次换用 Cloudflare One-Time PIN (Email OTP) 登录
    const otpPayload = {
      aud: teamAud,
      email: userEmail,
      sub: otpSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    };
    const otpToken = await createSignedJwt(otpPayload, keyPair.privateKey, testKid);
    const otpReq = new Request('https://loveqin.wang/api/photos', {
      headers: { 'CF-Access-Jwt-Assertion': otpToken },
    });

    const auth2 = await authenticateRequest(otpReq, d1Db, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    expect(auth2).not.toBeNull();
    // 关键断言：绝不产生新用户，严格归一化映射到同一个 D1 user_id
    expect(auth2?.user.id).toBe(userId);
    expect(auth2?.householdId).toBe(householdId);
    expect(auth2?.role).toBe('viewer');

    // 检查 auth_identities 表同时具备 Google 和 OTP 双向绑定
    const allIdentities = sqlite
      .prepare('SELECT * FROM auth_identities WHERE user_id = ?')
      .all(userId) as any[];
    expect(allIdentities).toHaveLength(2);
    const subjects = allIdentities.map((i) => i.subject);
    expect(subjects).toContain(googleSub);
    expect(subjects).toContain(otpSub);

    // 数据库中 users 表记录仍然只有一条，无冗余脏数据
    const userCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get() as any;
    expect(userCount.cnt).toBe(1);
  });

  it('稳定 Subject 快速命中：已绑定的身份后续请求直接通过阶段一 (issuer, subject) 识别', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const googleSub = 'google-oauth2|109283746501';

    const payload = {
      aud: teamAud,
      email: userEmail,
      sub: googleSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    };
    const token = await createSignedJwt(payload, keyPair.privateKey, testKid);
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: { 'CF-Access-Jwt-Assertion': token },
    });

    const auth = await authenticateRequest(req, d1Db, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    expect(auth).not.toBeNull();
    expect(auth?.user.id).toBe(userId);
  });

  it('白名单防御：未加入家庭的局外人即使持有有效 Access Token 也无法建链并被坚决拦截', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const strangerSub = 'google-oauth2|stranger_99999';
    const strangerEmail = 'stranger@gmail.com';

    const payload = {
      aud: teamAud,
      email: strangerEmail,
      sub: strangerSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    };
    const token = await createSignedJwt(payload, keyPair.privateKey, testKid);
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: { 'CF-Access-Jwt-Assertion': token },
    });

    const auth = await authenticateRequest(req, d1Db, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    expect(auth).toBeNull();

    // 确认未向 auth_identities 插入任何记录
    const identity = sqlite
      .prepare('SELECT * FROM auth_identities WHERE subject = ?')
      .get(strangerSub);
    expect(identity).toBeUndefined();
  });

  it('成员撤销防御：当家庭成员被标记为 removed 时，即使其在 auth_identities 中已绑定也立即失效', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const googleSub = 'google-oauth2|109283746501';

    // 模拟空间管理员将该成员从家庭空间移除
    sqlite
      .prepare("UPDATE household_members SET status = 'removed' WHERE household_id = ? AND user_id = ?")
      .run(householdId, userId);

    const payload = {
      aud: teamAud,
      email: userEmail,
      sub: googleSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    };
    const token = await createSignedJwt(payload, keyPair.privateKey, testKid);
    const req = new Request('https://loveqin.wang/api/photos', {
      headers: { 'CF-Access-Jwt-Assertion': token },
    });

    const auth = await authenticateRequest(req, d1Db, undefined, {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: teamAud,
    });

    // 即刻拦截，杜绝已撤销成员继续读取私密照片
    expect(auth).toBeNull();
  });
});
