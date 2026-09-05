import { verifyCloudflareAccessJwt, AccessVerifyConfig } from './_accessJwt';

export interface AuthenticatedContext {
  user: {
    id: string;
    displayName: string;
    email: string;
    nickname?: string;
  };
  householdId: string;
  role: 'viewer';
}

export interface AuthEnv {
  ENVIRONMENT?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  [key: string]: unknown;
}

export interface D1PreparedStatementBinding {
  bind: (...args: any[]) => {
    all: () => Promise<{ results: any[] }>;
    first: () => Promise<any>;
    run?: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
  };
  all?: () => Promise<{ results: any[] }>;
  first?: () => Promise<any>;
  run?: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseBinding {
  prepare: (sql: string) => {
    bind: (...args: any[]) => {
      all: () => Promise<{ results: any[] }>;
      first: () => Promise<any>;
      run?: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
    };
    all?: () => Promise<{ results: any[] }>;
    first?: () => Promise<any>;
    run?: () => Promise<{ success: boolean; meta?: { changes?: number } }>;
  };
  batch?: (statements: any[]) => Promise<Array<{ success: boolean; meta?: { changes?: number }; results?: any[] }>>;
}

/**
 * 校验 Cloudflare Access 身份通行证 (CF-Access-Jwt-Assertion)，并核验 D1 活跃家庭访问白名单
 * 遵照 docs/reviews/2026-09-05-overall-security-review.md 架构规范：
 * 全员统一收敛为只读访客角色 (role: 'viewer')，禁止任何越权或双重身份体系
 */
export async function authenticateRequest(
  request: Request,
  db: D1DatabaseBinding,
  targetHouseholdId?: string,
  env?: AuthEnv
): Promise<AuthenticatedContext | null> {
  // 1. 从请求头提取 Cloudflare Access JWT Assertion
  const accessJwt =
    request.headers.get('CF-Access-Jwt-Assertion') ||
    request.headers.get('cf-access-jwt-assertion');

  let verifiedEmail = '';
  let verifiedIssuer = '';
  let verifiedSubject = '';

  if (accessJwt) {
    const config: AccessVerifyConfig = {
      teamDomain: env?.CF_ACCESS_TEAM_DOMAIN,
      aud: env?.CF_ACCESS_AUD,
      environment: env?.ENVIRONMENT,
    };
    const payload = await verifyCloudflareAccessJwt(accessJwt, config);
    if (!payload || !payload.email || !payload.sub || !payload.iss) {
      console.warn('[AuthGuard] Access JWT 验签未通过或 Claims 缺失');
      return null;
    }
    verifiedEmail = payload.email.trim().toLowerCase();
    verifiedIssuer = payload.iss.trim();
    verifiedSubject = payload.sub.trim();
  } else {
    // 2. 本地开发环境受控回退：仅当明确处于 local 环境时，允许从特定请求头模拟开发身份
    const isLocalDev = env?.ENVIRONMENT === 'local';
    if (isLocalDev) {
      const devMockEmail = request.headers.get('x-dev-mock-email');
      if (devMockEmail) {
        verifiedEmail = devMockEmail.trim().toLowerCase();
        verifiedIssuer = 'https://local.cloudflareaccess.com';
        verifiedSubject = `dev_${verifiedEmail}`;
      }
    }
  }

  if (!verifiedEmail) {
    return null;
  }

  // 3. 稳定身份映射与 D1 活跃家庭白名单核验
  try {
    // 阶段一：优先按 (issuer, subject) 稳定主体查询已绑定的活跃家庭成员
    if (verifiedIssuer && verifiedSubject) {
      try {
        let identitySql = `
          SELECT 
            u.id AS user_id,
            u.display_name AS display_name,
            u.email_normalized AS email,
            u.status AS user_status,
            m.household_id AS household_id,
            m.role AS member_role,
            m.status AS member_status,
            ai.id AS identity_id
          FROM auth_identities ai
          INNER JOIN users u ON ai.user_id = u.id
          INNER JOIN household_members m ON u.id = m.user_id
          WHERE ai.issuer = ? AND ai.subject = ?
            AND u.status = 'active'
            AND m.status = 'active'
        `;
        const identityParams: any[] = [verifiedIssuer, verifiedSubject];
        if (targetHouseholdId) {
          identitySql += ' AND m.household_id = ?';
          identityParams.push(targetHouseholdId);
        }
        identitySql += ' LIMIT 1';

        const identityRow = await db.prepare(identitySql).bind(...identityParams).first();
        if (identityRow) {
          // 刷新最后一次认证活跃时间戳
          try {
            const updateBound = db.prepare('UPDATE auth_identities SET last_authenticated_at = ? WHERE id = ?').bind(Date.now(), identityRow.identity_id);
            if (typeof updateBound.run === 'function') {
              await updateBound.run();
            }
          } catch {}

          console.info(`[AuthGuard] Access Granted via Identity: user_id=${identityRow.user_id}, email=${identityRow.email}, sub=${verifiedSubject}`);
          return {
            user: {
              id: identityRow.user_id,
              displayName: identityRow.display_name,
              email: identityRow.email,
              nickname: identityRow.display_name,
            },
            householdId: identityRow.household_id,
            role: 'viewer',
          };
        }
      } catch {
        // 若 D1 尚未初始化 auth_identities 表，平滑回退至邮箱白名单阶段
      }
    }

    // 阶段二：首次登录自动绑定：按已验证的 email_normalized 核验活跃白名单并建链
    let sql = `
      SELECT 
        u.id AS user_id,
        u.display_name AS display_name,
        u.email_normalized AS email,
        u.status AS user_status,
        m.household_id AS household_id,
        m.role AS member_role,
        m.status AS member_status
      FROM users u
      INNER JOIN household_members m ON u.id = m.user_id
      WHERE u.email_normalized = ?
        AND u.status = 'active'
        AND m.status = 'active'
    `;

    const params: any[] = [verifiedEmail];
    if (targetHouseholdId) {
      sql += ' AND m.household_id = ?';
      params.push(targetHouseholdId);
    }
    sql += ' LIMIT 1';

    const row = await db.prepare(sql).bind(...params).first();
    if (!row) {
      // 邮箱未在活跃家庭成员白名单内，坚决拒绝访问 (Fail Closed)
      console.warn(`[AuthGuard] Access Denied: email=${verifiedEmail}, sub=${verifiedSubject}, reason=NOT_IN_ACTIVE_HOUSEHOLD_WHITELIST`);
      return null;
    }

    // 自动建立新身份提供商主体 (Google OAuth / Email OTP) 与该用户的唯一绑定
    if (verifiedIssuer && verifiedSubject) {
      try {
        const identityId = `ident_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now()}`;
        const now = Date.now();
        const insertBound = db.prepare(
          'INSERT OR IGNORE INTO auth_identities (id, user_id, issuer, subject, email_at_link, created_at, last_authenticated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(identityId, row.user_id, verifiedIssuer, verifiedSubject, verifiedEmail, now, now);
        if (typeof insertBound.run === 'function') {
          await insertBound.run();
        }
      } catch (err) {
        console.error('[AuthGuard] 写入 auth_identities 失败:', err);
      }
    }

    console.info(`[AuthGuard] Access Granted via Email Link: user_id=${row.user_id}, email=${row.email}, linked_sub=${verifiedSubject}`);

    return {
      user: {
        id: row.user_id,
        displayName: row.display_name,
        email: row.email,
        nickname: row.display_name,
      },
      householdId: row.household_id,
      role: 'viewer', // 当前版本所有用户统一收敛为只读访客角色
    };
  } catch (err) {
    console.error('[AuthGuard] D1 鉴权查询异常:', err);
    return null;
  }
}

export function createAuthErrorResponse(status: 401 | 403, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
