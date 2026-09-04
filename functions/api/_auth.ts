export interface AuthenticatedContext {
  user: {
    id: string;
    displayName: string;
    email: string;
    nickname?: string;
  };
  householdId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
}

export interface D1DatabaseBinding {
  prepare: (sql: string) => {
    bind: (...args: any[]) => {
      all: () => Promise<{ results: any[] }>;
      first: () => Promise<any>;
      run?: () => Promise<any>;
    };
  };
}

/**
 * 校验请求的会话凭证，并解析用户与家庭空间活跃成员身份
 * 严格遵照 docs/DATABASE_DESIGN.md 权威数据库设计规范
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

      // 单次原子 JOIN 查询：严格对照 docs/DATABASE_DESIGN.md 第五节权威 SQL 规范
      let sql = `
        SELECT 
          s.id AS session_id,
          s.session_version AS session_version,
          s.expires_at AS expires_at,
          s.revoked_at AS revoked_at,
          u.id AS user_id,
          u.display_name AS display_name,
          u.email_normalized AS email,
          u.session_version AS user_session_version,
          u.status AS user_status,
          m.household_id AS household_id,
          m.role AS role,
          m.status AS member_status
        FROM sessions s
        INNER JOIN users u ON s.user_id = u.id
        INNER JOIN household_members m ON u.id = m.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.status = 'active'
          AND m.status = 'active'
      `;

      const params: any[] = [tokenHash, now];
      if (targetHouseholdId) {
        sql += ' AND m.household_id = ?';
        params.push(targetHouseholdId);
      }
      sql += ' LIMIT 1';

      const row = await db.prepare(sql).bind(...params).first();
      if (!row) {
        return null;
      }

      // P1-5: 校验 Session Version (改密或一键登出全部设备后失效旧 Token)
      if (row.session_version !== row.user_session_version) {
        return null;
      }

      // 异步延展更新最后活跃时间 (非阻塞容错)
      try {
        db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.session_id).run?.();
      } catch {
        // 忽略活跃时间更新异常
      }

      return {
        user: {
          id: row.user_id,
          displayName: row.display_name,
          email: row.email,
          nickname: row.display_name, // 保持向后兼容
        },
        householdId: row.household_id,
        role: row.role as 'owner' | 'admin' | 'member' | 'guest',
      };
    } catch {
      return null;
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
