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

  if (accessJwt) {
    const config: AccessVerifyConfig = {
      teamDomain: env?.CF_ACCESS_TEAM_DOMAIN,
      aud: env?.CF_ACCESS_AUD,
      environment: env?.ENVIRONMENT,
    };
    const payload = await verifyCloudflareAccessJwt(accessJwt, config);
    if (!payload || !payload.email) {
      return null;
    }
    verifiedEmail = payload.email.trim().toLowerCase();
  } else {
    // 2. 本地开发环境受控回退：仅当明确处于 local 环境时，允许从特定请求头模拟开发身份
    const isLocalDev = env?.ENVIRONMENT === 'local';
    if (isLocalDev) {
      const devMockEmail = request.headers.get('x-dev-mock-email');
      if (devMockEmail) {
        verifiedEmail = devMockEmail.trim().toLowerCase();
      }
    }
  }

  if (!verifiedEmail) {
    return null;
  }

  // 3. 在 D1 数据库中核验家庭成员白名单
  try {
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
      return null;
    }

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
