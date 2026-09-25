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

const DEFAULT_HOUSEHOLD_ID = 'household_default';

/** Verify Cloudflare Access identity and scope it to this single-household gallery. */
export async function authenticateRequest(
  request: Request,
  env?: AuthEnv,
  targetHouseholdId?: string
): Promise<AuthenticatedContext | null> {
  // 1. 从请求头提取 Cloudflare Access JWT Assertion
  const accessJwt =
    request.headers.get('CF-Access-Jwt-Assertion') ||
    request.headers.get('cf-access-jwt-assertion');

  let verifiedEmail = '';
  let verifiedSubject = '';
  let isLocalDevIdentity = false;

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
    verifiedSubject = payload.sub.trim();
  } else {
    // 2. 本地开发环境受控回退：仅当明确处于 local 环境时，允许从特定请求头模拟开发身份
    const isLocalDev = env?.ENVIRONMENT === 'local';
    if (isLocalDev) {
      const devMockEmail = request.headers.get('x-dev-mock-email');
      if (devMockEmail) {
        verifiedEmail = devMockEmail.trim().toLowerCase();
        verifiedSubject = `dev_${verifiedEmail}`;
        isLocalDevIdentity = true;
      }
    }
  }

  if (!verifiedEmail) {
    return null;
  }

  // This app serves one fixed household. Cloudflare Access controls membership;
  // keep the household scope here so a valid Access identity cannot select another one.
  if (targetHouseholdId && targetHouseholdId !== DEFAULT_HOUSEHOLD_ID) {
    return null;
  }

  const displayName = isLocalDevIdentity
    ? '本地开发用户'
    : verifiedEmail.split('@')[0] || verifiedEmail;

  return {
    user: {
      id: verifiedSubject || verifiedEmail,
      displayName,
      email: verifiedEmail,
      nickname: displayName,
    },
    householdId: DEFAULT_HOUSEHOLD_ID,
    role: 'viewer',
  };
}

export interface ApiErrorPayload {
  error: string;
  message?: string;
  requestId?: string;
}

/**
 * 构造标准脱敏的 API 错误响应，严格设置 Cache-Control: no-store
 */
export function createApiErrorResponse(
  status: number,
  error: string,
  message?: string,
  requestId?: string
): Response {
  const body: ApiErrorPayload = {
    error,
    ...(message ? { message } : {}),
    ...(requestId ? { requestId } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * 构造 500 服务器内部错误响应：
 * 将原始异常、堆栈与敏感信息仅记录在受控服务端日志，对外输出稳定统一的错误码和追踪 ID
 */
export function createServerErrorResponse(
  err: unknown,
  contextTag: string,
  request?: Request
): Response {
  const requestId =
    request?.headers.get('cf-ray') ||
    (typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

  const errMsg = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : undefined;

  // 内部敏感堆栈与存储/数据库细节仅写入服务端日志
  console.error(`[${contextTag}] 内部异常 [${requestId}]:`, {
    error: errMsg,
    stack: errStack,
  });

  return createApiErrorResponse(
    500,
    'INTERNAL_SERVER_ERROR',
    '服务器处理请求时发生异常，请稍后重试',
    requestId
  );
}

export function createAuthErrorResponse(status: 401 | 403, error: string, message?: string): Response {
  let errCode = error;
  let errMsg = message;
  if (!errMsg && error.includes(': ')) {
    const parts = error.split(': ');
    errCode = parts[0];
    errMsg = parts.slice(1).join(': ');
  }

  return createApiErrorResponse(status, errCode, errMsg);
}
