import Database from 'better-sqlite3';
import { authenticateRequest, D1DatabaseBinding } from '../functions/api/_auth';
import { verifyCloudflareAccessJwt, setJwksForTesting, JwkKey } from '../functions/api/_accessJwt';

/**
 * Cloudflare Access 身份接入与双 IdP 绑定冒烟测试脚本
 * 
 * 验证目标：
 * 1. 验证 Cloudflare Access RS256 JWT 证书解析与验签逻辑
 * 2. 验证 Google OAuth + Email OTP 双登录源安全归一化绑定至同一个 D1 用户
 * 3. 验证稳定 Subject 快速命中阶段一
 * 4. 验证局外人未入家庭白名单强行拦截 (Fail Closed)
 * 5. 验证成员移除后即刻失效
 */

function createD1Adapter(sqlite: Database.Database): D1DatabaseBinding {
  const stmtCache = new Map<string, Database.Statement>();
  const getStmt = (q: string) => {
    let stmt = stmtCache.get(q);
    if (!stmt) {
      stmt = sqlite.prepare(q);
      stmtCache.set(q, stmt);
    }
    return stmt;
  };

  return {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          const stmt = getStmt(query);
          return { results: stmt.all(...args) };
        },
        first: async () => {
          const stmt = getStmt(query);
          return stmt.get(...args) || null;
        },
        run: async () => {
          const stmt = getStmt(query);
          const info = stmt.run(...args);
          return { success: true, meta: { changes: info.changes } };
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

async function runAccessSmokeTests() {
  console.log('========================================================');
  console.log('🛡️  正在启动 Cloudflare Access 身份接入与部署冒烟验证...');
  console.log('========================================================\n');

  let passedSteps = 0;
  const totalSteps = 6;

  // 1. 初始化测试密钥与环境
  console.log('步骤 1: 初始化 RS256 签名密钥对与 Access JWKS 模拟环境...');
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const testKid = 'smoke-access-kid-01';
  const teamDomain = 'loveqin';
  const teamAud = 'prod-smoke-aud-tag-001';
  const issuer = `https://${teamDomain}.cloudflareaccess.com`;

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const testJwk: JwkKey = {
    kid: testKid,
    kty: publicJwk.kty!,
    alg: 'RS256',
    n: publicJwk.n!,
    e: publicJwk.e!,
  };
  setJwksForTesting(teamDomain, [testJwk]);

  // 直接验证 RS256 JWT 证书解析与验签逻辑
  const smokeToken = await createSignedJwt(
    {
      aud: teamAud,
      email: 'verify@loveqin.wang',
      sub: 'test-smoke-sub-01',
      iss: issuer,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    },
    keyPair.privateKey,
    testKid
  );
  const verifiedPayload = await verifyCloudflareAccessJwt(smokeToken, {
    teamDomain,
    aud: teamAud,
  });
  if (!verifiedPayload || verifiedPayload.email !== 'verify@loveqin.wang') {
    throw new Error('直接调用 verifyCloudflareAccessJwt 验签失败');
  }
  console.log('   ✓ RS256 密钥对生成成功，JWKS 验签与 Claims 校验就绪\n');
  passedSteps++;

  // 2. 初始化测试 D1 数据库
  console.log('步骤 2: 构建内存 D1 SQLite 数据库并应用 0002_add_auth_identities 模式...');
  const sqlite = new Database(':memory:');
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
  const householdId = 'hh_smoke_test';
  const userId = 'user_qin_smoke';
  const userEmail = 'qin@loveqin.wang';

  sqlite.prepare('INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)').run(householdId, '琴境相册空间', now);
  sqlite.prepare(
    'INSERT INTO users (id, email_normalized, display_name, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, userEmail, '琴琴', 'unused_pw_hash', 'active', now);
  sqlite.prepare(
    'INSERT INTO household_members (household_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).run(householdId, userId, 'member', 'active', now);

  const d1Db = createD1Adapter(sqlite);
  console.log('   ✓ D1 数据库结构与初始白名单成员初始化完成\n');
  passedSteps++;

  // 3. 验证 Google OAuth 首次登录建链绑定
  console.log('步骤 3: 模拟 Google OAuth 首次登录与 auth_identities 自动绑定...');
  const nowSec = Math.floor(Date.now() / 1000);
  const googleSub = 'google-oauth2|109876543210';

  const googleJwt = await createSignedJwt(
    {
      aud: teamAud,
      email: userEmail,
      sub: googleSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    },
    keyPair.privateKey,
    testKid
  );

  const googleReq = new Request('https://loveqin.wang/api/photos', {
    headers: { 'CF-Access-Jwt-Assertion': googleJwt },
  });

  const authGoogle = await authenticateRequest(googleReq, d1Db, undefined, {
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: teamAud,
  });

  if (!authGoogle || authGoogle.user.id !== userId || authGoogle.role !== 'viewer') {
    throw new Error(`Google OAuth 首次认证失败: ${JSON.stringify(authGoogle)}`);
  }

  const identityGoogle = sqlite
    .prepare('SELECT * FROM auth_identities WHERE issuer = ? AND subject = ?')
    .get(issuer, googleSub) as any;
  if (!identityGoogle || identityGoogle.user_id !== userId) {
    throw new Error('Google OAuth 身份记录未成功落库 auth_identities');
  }
  console.log(`   ✓ Google OAuth 成功映射至 user_id: ${authGoogle.user.id}，角色已限制为: ${authGoogle.role}\n`);
  passedSteps++;

  // 4. 验证 Email OTP 登录归一化至同一个 D1 用户
  console.log('步骤 4: 模拟 Cloudflare Email OTP 登录归一化至同一 D1 用户...');
  const otpSub = 'cf-otp|uuid-otp-88776655';
  const otpJwt = await createSignedJwt(
    {
      aud: teamAud,
      email: userEmail,
      sub: otpSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    },
    keyPair.privateKey,
    testKid
  );

  const otpReq = new Request('https://loveqin.wang/api/timeline', {
    headers: { 'CF-Access-Jwt-Assertion': otpJwt },
  });

  const authOtp = await authenticateRequest(otpReq, d1Db, undefined, {
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: teamAud,
  });

  if (!authOtp || authOtp.user.id !== userId) {
    throw new Error(`Email OTP 未能归一化绑定到同一个 D1 用户: ${JSON.stringify(authOtp)}`);
  }

  const userCount = (sqlite.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  if (userCount !== 1) {
    throw new Error(`出现重复用户，当前 users 记录数为: ${userCount}`);
  }
  console.log(`   ✓ Email OTP 成功归一化至同一个 D1 用户 ${userId}，未生成冗余用户\n`);
  passedSteps++;

  // 5. 验证未授权的局外人强行拦截
  console.log('步骤 5: 验证白名单防御机制 (局外人虽通过 Access 但未入 D1 家庭白名单)...');
  const strangerSub = 'google-oauth2|attacker_112233';
  const strangerJwt = await createSignedJwt(
    {
      aud: teamAud,
      email: 'attacker@untrusted.com',
      sub: strangerSub,
      iss: issuer,
      exp: nowSec + 3600,
      iat: nowSec,
    },
    keyPair.privateKey,
    testKid
  );

  const strangerReq = new Request('https://loveqin.wang/api/photos', {
    headers: { 'CF-Access-Jwt-Assertion': strangerJwt },
  });

  const authStranger = await authenticateRequest(strangerReq, d1Db, undefined, {
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: teamAud,
  });

  if (authStranger !== null) {
    throw new Error(`安全漏洞：未入白名单的外部用户未被拦截!`);
  }
  console.log('   ✓ 局外人访问被坚决拦截 (Fail Closed: 401/403)\n');
  passedSteps++;

  // 6. 验证成员移除后即刻失效
  console.log('步骤 6: 验证成员权限移除后即刻失效 (Fail Safe)...');
  sqlite
    .prepare("UPDATE household_members SET status = 'removed' WHERE household_id = ? AND user_id = ?")
    .run(householdId, userId);

  const removedReq = new Request('https://loveqin.wang/api/photos', {
    headers: { 'CF-Access-Jwt-Assertion': googleJwt },
  });

  const authRemoved = await authenticateRequest(removedReq, d1Db, undefined, {
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: teamAud,
  });

  if (authRemoved !== null) {
    throw new Error('安全漏洞：已被移除的家庭成员仍可继续访问!');
  }
  console.log('   ✓ 已移除成员即刻失效，照片数据访问被阻断\n');
  passedSteps++;

  sqlite.close();

  console.log('========================================================');
  console.log(`🎉 冒烟测试全部通过! (${passedSteps}/${totalSteps} 项全部达标)`);
  console.log('========================================================\n');
}

runAccessSmokeTests().catch((err) => {
  console.error('\n❌ Cloudflare Access 冒烟测试失败:', err);
  process.exit(1);
});
