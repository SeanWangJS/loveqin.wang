export interface AuthenticatedContext {
  user: {
    id: string;
    nickname: string;
    email: string;
  };
  householdId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
}

export interface D1DatabaseBinding {
  prepare: (sql: string) => {
    bind: (...args: any[]) => {
      all: () => Promise<{ results: any[] }>;
      first: () => Promise<any>;
    };
  };
}

/**
 * 校验请求的会话凭证，并解析用户与家庭空间活跃成员身份
 */
export async function authenticateRequest(
  request: Request,
  db: D1DatabaseBinding,
  targetHouseholdId?: string
): Promise<AuthenticatedContext | null> {
  // 1. 从 Authorization 或 Cookie 中提取 session token
  let token = '';
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)session_token=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

  // 2. 如果存在有效 Token，在 D1 中进行哈希比对与鉴权
  if (token) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const now = Date.now();
      const session = await db
        .prepare('SELECT user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?')
        .bind(tokenHash)
        .first();

      if (!session || session.revoked_at !== null || session.expires_at <= now) {
        return null;
      }

      const user = await db
        .prepare('SELECT id, nickname, email, status FROM users WHERE id = ?')
        .bind(session.user_id)
        .first();

      if (!user || user.status !== 'active') {
        return null;
      }

      // 查询家庭空间成员身份
      const query = targetHouseholdId
        ? db
            .prepare('SELECT household_id, role, status FROM household_members WHERE user_id = ? AND household_id = ? AND status = ?')
            .bind(user.id, targetHouseholdId, 'active')
        : db
            .prepare('SELECT household_id, role, status FROM household_members WHERE user_id = ? AND status = ? LIMIT 1')
            .bind(user.id, 'active');

      const member = await query.first();
      if (!member) {
        return null;
      }

      return {
        user: { id: user.id, nickname: user.nickname, email: user.email },
        householdId: member.household_id,
        role: member.role,
      };
    } catch {
      return null;
    }
  }

  // 3. 开发环境备用 Owner 身份自动回退 (满足本地无需预先手动登录调试的需求)
  const isDevBypass = request.headers.get('x-dev-auto-login') === 'true' || process?.env?.NODE_ENV !== 'production';
  if (isDevBypass) {
    try {
      const devHousehold = targetHouseholdId || 'household_default';
      const ownerMember = await db
        .prepare('SELECT household_id, user_id, role, status FROM household_members WHERE household_id = ? AND role = ? AND status = ?')
        .bind(devHousehold, 'owner', 'active')
        .first();

      if (ownerMember) {
        return {
          user: { id: ownerMember.user_id, nickname: 'Household Owner', email: 'owner@loveqin.wang' },
          householdId: ownerMember.household_id,
          role: 'owner',
        };
      }
    } catch {
      // 容错忽略
    }
  }

  return null;
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
